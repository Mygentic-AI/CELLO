/**
 * J-TRUST — M10-D18 trust-signal delivery, live binaries (re-pointed from CELLO-M8-TRUST-001).
 *
 * The trust-signal pipe end-to-end at the daemon-pickup scope, ON THE M10 PATH: an account-subject
 * CBOR envelope, sealed to A's k_local and seeded into the directory pickup queue WITH ITS OWN hash
 * (M10-D22 — the pickup carries `signal_hash`; the anchor is `signal_records`, not the retired identity
 * tree), is DELIVERED to A's daemon on reconnect, DECODED with the shared codec, its DOD-CBOR-1 hash
 * RE-DERIVED and checked against the pickup's claimed hash (deliverWalletSignal), STORED in
 * `wallet_trust_signals`, and ACKed — after which the directory holds no ciphertext. Stub-resistant: the
 * ciphertext is sealed to A's real k_local pubkey, so only A's daemon (a separate process holding the
 * seed) can open it; the store assertion reads the daemon's OWN encrypted SQLCipher DB (j-persist pattern).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";
import {
  startSpineCluster,
  startDaemon,
  connectMcp,
  cello,
  psqlSpine,
  CELLO_CLIENT_ROOT,
  type SpineCluster,
  type Proc,
  type McpConn,
} from "./live-harness.js";

type KeyedStmt = { get(...p: unknown[]): unknown };
type KeyedDb = { prepare(sql: string): KeyedStmt; close(): void };
async function openEncryptedDb(dbPath: string): Promise<KeyedDb> {
  const mod = (await import(
    pathToFileURL(join(CELLO_CLIENT_ROOT, "core/daemon/dist/sqlcipher-db.js")).href
  )) as { openEncryptedDatabaseAtPath(p: string): KeyedDb };
  return mod.openEncryptedDatabaseAtPath(dbPath);
}

// Seal + SHA-256 with the SAME local crypto build the daemon opens with.
async function loadSealer(): Promise<{
  sealToRecipient: (pub: Uint8Array, plaintext: Uint8Array) => Uint8Array;
  hash: (d: Uint8Array) => Uint8Array;
}> {
  const crypto = (await import(pathToFileURL(join(CELLO_CLIENT_ROOT, "core/crypto/dist/index.js")).href)) as {
    sealToRecipient: (pub: Uint8Array, plaintext: Uint8Array) => Uint8Array;
    hash: (d: Uint8Array) => Uint8Array;
  };
  return { sealToRecipient: crypto.sealToRecipient, hash: crypto.hash };
}

// The M10 envelope codec, from the SAME local build the daemon decodes with (INV-CANONICAL / M10-D7).
interface Envelope {
  subject_kind: "account" | "agent"; subject: string; issuer_kind: "portal" | "agent"; issuer_pubkey: string;
  type: string; schema_version: number; payload: Uint8Array; issued_at: number;
  expires_at: number | null; supersedes_hash: Uint8Array | null;
}
async function loadCodec(): Promise<{
  encodeTrustSignalEnvelope: (e: Envelope) => Uint8Array;
  hashTrustSignalEnvelope: (e: Envelope) => Uint8Array;
  encodeCbor: (v: unknown) => Uint8Array;
}> {
  const pt = (await import(pathToFileURL(join(CELLO_CLIENT_ROOT, "core/protocol-types/dist/index.js")).href)) as {
    encodeTrustSignalEnvelope: (e: Envelope) => Uint8Array;
    hashTrustSignalEnvelope: (e: Envelope) => Uint8Array;
    encodeCbor: (v: unknown) => Uint8Array;
  };
  return { encodeTrustSignalEnvelope: pt.encodeTrustSignalEnvelope, hashTrustSignalEnvelope: pt.hashTrustSignalEnvelope, encodeCbor: pt.encodeCbor };
}

const hexToBytes = (h: string): Uint8Array => new Uint8Array(Buffer.from(h, "hex"));
const hex = (b: Uint8Array): string => Buffer.from(b).toString("hex");

let cluster: SpineCluster;
const daemons: Proc[] = [];
const dirs: string[] = [];
const mcpConns: McpConn[] = [];

beforeAll(async () => {
  cluster = await startSpineCluster({});
}, 180_000);

afterAll(async () => {
  for (const c of mcpConns) await c.close();
  for (const d of daemons) await d.stop();
  await cluster?.stop();
  for (const dir of dirs) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});

type Status = { directory_signaling?: string };
const status = (dir: string): Status => JSON.parse(cello(["status"], { CELLO_DIR: dir }).stdout) as Status;
const waitConnected = async (dir: string): Promise<void> => {
  for (let i = 0; i < 50; i++) {
    if ((status(dir).directory_signaling ?? "") === "connected") return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`directory_signaling never connected for ${dir}`);
};

describe("J-TRUST — M10 sealed-envelope pickup end-to-end (M10-D18 / M10-D22)", () => {
  it("a seeded sealed ENVELOPE is decoded+verified+stored into wallet_trust_signals; the directory then holds only the hash", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cello-trust-"));
    dirs.push(dir);
    daemons.push(await startDaemon(dir, cluster.directoryUrl, "trust"));
    const c = JSON.parse(cello(["create-agent", "tagent"], { CELLO_DIR: dir }).stdout) as { pubkey: string };
    const pubA = c.pubkey;
    await waitConnected(dir);
    // NB: the CLI command is `register-agent` (the old `register` alias was removed) — the M8-era spine
    // test used the stale name, which silently printed help + exited 1 (pre-existing test rot, unrelated
    // to M10). This is the correct command.
    expect(cello(["register-agent", "tagent", `DEV-trust-${randomBytes(6).toString("hex")}`], { CELLO_DIR: dir }).status).toBe(0);

    const agentId = psqlSpine(`SELECT agent_id FROM agent_profiles WHERE k_local_pubkey = '${pubA}'`);
    expect(agentId, "A must have a directory agent_id after registration").toMatch(/\S/);

    // Seed the pipe AS THE M10 DELIVERY writes it (M10-D22): compose an account-subject webauthn envelope,
    // seal the ENVELOPE bytes to A's k_local, and put the sealed copy + its OWN hash on the pickup queue.
    // No identity_tree_entries — the M10 pickup carries `signal_hash` (V47); there is no anchor to JOIN.
    const { sealToRecipient, hash } = await loadSealer();
    const { encodeTrustSignalEnvelope, hashTrustSignalEnvelope, encodeCbor } = await loadCodec();
    const credId = `cred-${randomBytes(4).toString("hex")}`;
    const envelope: Envelope = {
      subject_kind: "account", subject: `acct-${randomBytes(4).toString("hex")}`,
      issuer_kind: "portal", issuer_pubkey: "ab".repeat(32), type: "webauthn", schema_version: 1,
      payload: encodeCbor({
        claim: "This operator enrolled a WebAuthn hardware authenticator with the CELLO portal.",
        credential_stub: hex(hash(new TextEncoder().encode(credId))),
      }),
      issued_at: 1_700_000_000, expires_at: null, supersedes_hash: null,
    };
    const envBytes = encodeTrustSignalEnvelope(envelope);
    const signalHash = hex(hashTrustSignalEnvelope(envelope));
    const sealedHex = hex(sealToRecipient(hexToBytes(pubA), envBytes));

    psqlSpine(
      `INSERT INTO pickup_queue (agent_id, signal_kind, ciphertext, signal_hash) ` +
      `VALUES ('${agentId}', 'webauthn', decode('${sealedHex}', 'hex'), '${signalHash}')`,
    );
    expect(psqlSpine(`SELECT count(*)::int FROM pickup_queue WHERE agent_id = '${agentId}' AND acked_at IS NULL`)).toBe("1");

    // Restart the daemon so its registered agent reconnects fresh → the directory's reconnect drain
    // delivers the seeded pickup over a new authenticated stream.
    await daemons[daemons.length - 1].stop();
    const d2 = await startDaemon(dir, cluster.directoryUrl, "trust2");
    daemons.push(d2);
    const conn = await connectMcp(dir, "trust-A");
    mcpConns.push(conn);
    expect(((await conn.call("cello_start_agent", { name: "tagent" })) as { ok?: boolean }).ok).toBe(true);
    await waitConnected(dir);

    // The daemon (a separate process) opens with k_local, decodes the envelope, re-derives + verifies the
    // hash, stores in wallet_trust_signals, and ACKs.
    let got: string;
    try {
      got = await d2.waitForLine(/daemon\.trust_signal\.received/, 25_000);
    } catch (e) {
      const dirOut = cluster.directory.output.split("\n").filter((l) => /trust_signal|pickup/i.test(l)).slice(-10).join("\n");
      const dOut = d2.output.split("\n").filter((l) => /trust_signal|pickup/i.test(l)).slice(-10).join("\n");
      throw new Error(`no daemon.trust_signal.received.\n--- directory trust logs ---\n${dirOut}\n--- daemon trust logs ---\n${dOut}\n${(e as Error).message}`);
    }
    expect(got, "the daemon must receive + verify the signal").toMatch(/verified.*true|"verified":true/);

    // after the ACK the pickup queue holds NO ciphertext for this agent.
    let pq = "1";
    for (let i = 0; i < 20; i++) {
      pq = psqlSpine(`SELECT count(*)::int FROM pickup_queue WHERE agent_id = '${agentId}'`);
      if (pq === "0") break;
      await new Promise((r) => setTimeout(r, 250));
    }
    expect(pq, "the pickup queue must be empty after the daemon ACK").toBe("0");

    // SI-001 / store: the daemon's OWN encrypted DB holds the verified envelope in wallet_trust_signals
    // (the M8 `trust_signals` table is dropped). type is webauthn; the payload carries the no-PII stub.
    const db = await openEncryptedDb(join(dir, "sessions.db"));
    try {
      const row = db
        .prepare("SELECT type, payload FROM wallet_trust_signals WHERE signal_hash = ?")
        .get(signalHash) as { type: string; payload: Uint8Array } | undefined;
      expect(row, "the daemon must have stored the verified signal in wallet_trust_signals").toBeDefined();
      expect(row!.type).toBe("webauthn");
      // M10-D23: the raw credential is NEVER in the stored payload (only its sha256 stub).
      expect(Buffer.from(row!.payload).toString("latin1"), "no raw credential in the stored payload").not.toContain(credId);
    } finally {
      db.close();
    }

    // The plaintext credentialId is absent from the directory's pickup queue too (dump).
    expect(psqlSpine(`SELECT coalesce(string_agg(encode(ciphertext, 'escape'), ','), '') FROM pickup_queue WHERE agent_id = '${agentId}'`)).not.toContain(credId);

    // ── HASH-MISMATCH negative — the daemon's re-derived DOD-CBOR-1 hash is AUTHORITATIVE. Seed a NEW
    // sealed envelope but claim a BOGUS `signal_hash` on the pickup. The daemon decodes it, re-derives
    // hashTrustSignalEnvelope(env) ≠ the claimed hash → MUST reject: delivery_rejected, NOT stored, NOT
    // ACKed (the row stays). A daemon that self-attested / skipped the compare would wrongly store+ack.
    const env2: Envelope = { ...envelope, subject: `acct-mismatch-${randomBytes(4).toString("hex")}` };
    const sealed2Hex = hex(sealToRecipient(hexToBytes(pubA), encodeTrustSignalEnvelope(env2)));
    const bogusHash = "f".repeat(64);
    psqlSpine(`INSERT INTO pickup_queue (agent_id, signal_kind, ciphertext, signal_hash) VALUES ('${agentId}', 'webauthn', decode('${sealed2Hex}', 'hex'), '${bogusHash}')`);

    await d2.stop();
    const d3 = await startDaemon(dir, cluster.directoryUrl, "trust3");
    daemons.push(d3);
    const conn3 = await connectMcp(dir, "trust-A3");
    mcpConns.push(conn3);
    expect(((await conn3.call("cello_start_agent", { name: "tagent" })) as { ok?: boolean }).ok).toBe(true);
    await waitConnected(dir);

    const mismatchLine = await d3.waitForLine(/daemon\.trust_signal\.(delivery_rejected|received)/, 25_000);
    expect(mismatchLine, "a claimed-hash mismatch must trigger delivery_rejected, NOT received").toMatch(/delivery_rejected/);
    // NOT ACKed → the mismatched pickup row is still there; NOT stored under the bogus hash.
    expect(psqlSpine(`SELECT count(*)::int FROM pickup_queue WHERE agent_id = '${agentId}'`)).toBe("1");
    const db2 = await openEncryptedDb(join(dir, "sessions.db"));
    try {
      const bogusRow = db2.prepare("SELECT signal_hash FROM wallet_trust_signals WHERE signal_hash = ?").get(bogusHash);
      expect(bogusRow, "a hash-mismatched signal must NOT be stored").toBeUndefined();
    } finally {
      db2.close();
    }
  }, 200_000);
});
