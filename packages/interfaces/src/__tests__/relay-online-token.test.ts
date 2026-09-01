/**
 * 008-RELAY — the online token, the thing that separates a registered agent from a minted keypair.
 *
 * A relay holds a fixed number of circuit reservation slots. Until now it granted them to anyone who
 * could sign a challenge, which proves possession of *a* key and nothing else — so an attacker mints
 * keypairs and takes the whole table. This token is what the directory hands an agent when it marks
 * it online, and what the relay checks before it lets that agent keep a slot.
 *
 * The properties tested here are the ones the check has no teeth without:
 *  - it is bound to ONE public key, so a lifted token is useless without that key's private half;
 *  - it expires, so revocation is a matter of waiting rather than of plumbing;
 *  - an over-long lifetime is refused by the VERIFIER, so a buggy or captured directory cannot mint
 *    a pass that outlives the incident;
 *  - with no directory key to verify against, it refuses. It does not wave the caller through.
 */

import { describe, it, expect } from "vitest";
import { ed25519 } from "@noble/curves/ed25519.js";
import {
  ONLINE_TOKEN_BYTES,
  ONLINE_TOKEN_MAX_LIFETIME_MS,
  mintOnlineToken,
  onlineTokenTbs,
  verifyOnlineToken,
} from "../relay-online-token.js";

const NOW = 1_756_700_000_000;

function directoryKeypair(seed: number): { priv: Uint8Array; pub: Uint8Array } {
  const priv = new Uint8Array(32).fill(seed);
  return { priv, pub: ed25519.getPublicKey(priv) };
}

function agentPubkey(seed: number): Uint8Array {
  return ed25519.getPublicKey(new Uint8Array(32).fill(seed));
}

async function mint(opts: {
  dir: { priv: Uint8Array; pub: Uint8Array };
  agent: Uint8Array;
  expiresAtMs: number;
}): Promise<Uint8Array> {
  return mintOnlineToken({
    agentPubkey: opts.agent,
    expiresAtMs: opts.expiresAtMs,
    sign: async (tbs) => ed25519.sign(tbs, opts.dir.priv),
  });
}

describe("008-RELAY — relay online token", () => {
  it("mints a fixed-size token that verifies against the issuing directory key", async () => {
    const dir = directoryKeypair(1);
    const agent = agentPubkey(9);
    const token = await mint({ dir, agent, expiresAtMs: NOW + 3_600_000 });

    expect(token.length).toBe(ONLINE_TOKEN_BYTES);

    const result = verifyOnlineToken(token, [dir.pub], NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Buffer.from(result.agentPubkey).toString("hex")).toBe(Buffer.from(agent).toString("hex"));
    expect(result.expiresAtMs).toBe(NOW + 3_600_000);
  });

  it("verifies against ANY key in the consortium set, not just the first", async () => {
    const nodeA = directoryKeypair(1);
    const nodeB = directoryKeypair(2);
    const token = await mint({ dir: nodeB, agent: agentPubkey(9), expiresAtMs: NOW + 3_600_000 });

    expect(verifyOnlineToken(token, [nodeA.pub, nodeB.pub], NOW).ok).toBe(true);
  });

  it("refuses a token signed by a key outside the consortium set", async () => {
    const consortium = directoryKeypair(1);
    const stranger = directoryKeypair(7);
    const token = await mint({ dir: stranger, agent: agentPubkey(9), expiresAtMs: NOW + 3_600_000 });

    const result = verifyOnlineToken(token, [consortium.pub], NOW);
    expect(result).toEqual({ ok: false, reason: "online_token_signature_invalid" });
  });

  it("refuses when the verifier holds NO directory keys — it never waves the caller through", async () => {
    const dir = directoryKeypair(1);
    const token = await mint({ dir, agent: agentPubkey(9), expiresAtMs: NOW + 3_600_000 });

    const result = verifyOnlineToken(token, [], NOW);
    expect(result).toEqual({ ok: false, reason: "online_token_no_directory_key" });
  });

  it("refuses an expired token, and accepts one that expires in the very next millisecond", async () => {
    const dir = directoryKeypair(1);
    const token = await mint({ dir, agent: agentPubkey(9), expiresAtMs: NOW });

    // expires_at is exclusive: at exactly expires_at the token is spent.
    expect(verifyOnlineToken(token, [dir.pub], NOW)).toEqual({ ok: false, reason: "online_token_expired" });
    expect(verifyOnlineToken(token, [dir.pub], NOW - 1).ok).toBe(true);
  });

  it("refuses a lifetime longer than the verifier's ceiling, however well signed", async () => {
    const dir = directoryKeypair(1);
    const token = await mint({
      dir,
      agent: agentPubkey(9),
      expiresAtMs: NOW + ONLINE_TOKEN_MAX_LIFETIME_MS + 1,
    });

    const result = verifyOnlineToken(token, [dir.pub], NOW);
    expect(result).toEqual({ ok: false, reason: "online_token_lifetime_too_long" });

    // Exactly at the ceiling is fine — the refusal is for going beyond it.
    const atCeiling = await mint({
      dir,
      agent: agentPubkey(9),
      expiresAtMs: NOW + ONLINE_TOKEN_MAX_LIFETIME_MS,
    });
    expect(verifyOnlineToken(atCeiling, [dir.pub], NOW).ok).toBe(true);
  });

  it("refuses a token of the wrong length rather than reading past its end", async () => {
    const dir = directoryKeypair(1);
    const token = await mint({ dir, agent: agentPubkey(9), expiresAtMs: NOW + 3_600_000 });

    for (const bad of [new Uint8Array(0), token.slice(0, ONLINE_TOKEN_BYTES - 1), new Uint8Array(ONLINE_TOKEN_BYTES + 1)]) {
      expect(verifyOnlineToken(bad, [dir.pub], NOW)).toEqual({ ok: false, reason: "online_token_malformed" });
    }
  });

  it("the signature covers the agent key: swapping it invalidates the token", async () => {
    const dir = directoryKeypair(1);
    const token = await mint({ dir, agent: agentPubkey(9), expiresAtMs: NOW + 3_600_000 });

    const tampered = new Uint8Array(token);
    tampered.set(agentPubkey(10), 0);

    expect(verifyOnlineToken(tampered, [dir.pub], NOW)).toEqual({
      ok: false,
      reason: "online_token_signature_invalid",
    });
  });

  it("the signature covers the expiry: extending it invalidates the token", async () => {
    const dir = directoryKeypair(1);
    const token = await mint({ dir, agent: agentPubkey(9), expiresAtMs: NOW + 1_000 });

    const tampered = new Uint8Array(token);
    new DataView(tampered.buffer, tampered.byteOffset).setBigUint64(32, BigInt(NOW + 3_600_000), false);

    expect(verifyOnlineToken(tampered, [dir.pub], NOW)).toEqual({
      ok: false,
      reason: "online_token_signature_invalid",
    });
  });

  it("is domain-separated, so a directory signature made for something else cannot be replayed as a token", async () => {
    const dir = directoryKeypair(1);
    const agent = agentPubkey(9);
    const expiresAtMs = NOW + 3_600_000;

    // Same fields, no domain prefix — what a naive producer elsewhere in the system might sign.
    const undomained = new Uint8Array(40);
    undomained.set(agent, 0);
    new DataView(undomained.buffer).setBigUint64(32, BigInt(expiresAtMs), false);

    const forged = new Uint8Array(ONLINE_TOKEN_BYTES);
    forged.set(agent, 0);
    new DataView(forged.buffer).setBigUint64(32, BigInt(expiresAtMs), false);
    forged.set(ed25519.sign(undomained, dir.priv), 40);

    expect(verifyOnlineToken(forged, [dir.pub], NOW)).toEqual({
      ok: false,
      reason: "online_token_signature_invalid",
    });

    // ...and the real TBS does carry the domain, so the two are not the same bytes.
    const tbs = onlineTokenTbs(agent, expiresAtMs);
    expect(Buffer.from(tbs).equals(Buffer.from(undomained))).toBe(false);
    expect(Buffer.from(tbs).subarray(0, 27).toString("utf8")).toBe("cello-relay-online-token-v1");
  });

  it("refuses a negative or non-integer expiry at MINT time rather than emitting a token nobody can verify", async () => {
    const dir = directoryKeypair(1);
    await expect(mint({ dir, agent: agentPubkey(9), expiresAtMs: -1 })).rejects.toThrow(/expiresAtMs/);
    await expect(mint({ dir, agent: agentPubkey(9), expiresAtMs: 1.5 })).rejects.toThrow(/expiresAtMs/);
  });

  it("refuses to mint for anything that is not a 32-byte key", async () => {
    const dir = directoryKeypair(1);
    await expect(
      mintOnlineToken({
        agentPubkey: new Uint8Array(31),
        expiresAtMs: NOW + 1000,
        sign: async (tbs) => ed25519.sign(tbs, dir.priv),
      }),
    ).rejects.toThrow(/agentPubkey/);
  });

  it("refuses a signer that returns something other than a 64-byte signature", async () => {
    await expect(
      mintOnlineToken({
        agentPubkey: agentPubkey(9),
        expiresAtMs: NOW + 1000,
        sign: async () => new Uint8Array(32),
      }),
    ).rejects.toThrow(/signature/);
  });
});
