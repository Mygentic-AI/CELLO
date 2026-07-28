/**
 * M12 DOD-AE-APPEND-1/MUTABLE-1 — the /cello/anti-entropy/1.0.0 channel protocol, wire-level
 * (design §1c handshake + §3 rounds), over an in-memory duplex — no libp2p, REAL crypto.
 *
 * What must hold:
 *  - The mutual handshake succeeds between two manifest-pinned nodes (real Ed25519 over the real
 *    buildAePeerAuthTbs) and FAILS CLOSED on: unknown node, wrong signing key, live-PeerId mismatch
 *    (channel binding), self-dial (A==B), and a peer whose auth frame never arrives (timeout).
 *  - After auth, a full anti-entropy round runs over the wire: the dialer's RemoteStoreView drives
 *    the PROVEN engine (runAntiEntropyRound) against the responder's served state, records land,
 *    and the second round pulls nothing (termination end-to-end over frames).
 *  - The responder REFUSES to serve any round frame before the handshake completes (fail closed).
 */

import { describe, it, expect } from "vitest";
import { ed25519 } from "@noble/curves/ed25519.js";
import type { ConsortiumManifest } from "@cello-protocol/protocol-types";
import {
  runAeDialer, serveAeResponder, type AeWire, type AeNodeIdentity,
} from "../ae-channel.js";
import type { AeStoreView, TierARecord, TierBRecord } from "../anti-entropy-engine.js";
import { encodeTierARecord, AGENT_REVOCATIONS_SPEC } from "../ae-table-encoders.js";
import { encodeTierBVersion, SUSPENSION_VERSION_SPEC } from "../ae-mutable-version.js";
import { mergeSuspension, type SuspensionRecord } from "../suspension-merge.js";

// ── In-memory duplex wire pair ────────────────────────────────────────────────────────────────
function wirePair(): [AeWire, AeWire] {
  const qA: Uint8Array[] = [];
  const qB: Uint8Array[] = [];
  let closed = false;
  const waitersA: Array<(v: Uint8Array | null) => void> = [];
  const waitersB: Array<(v: Uint8Array | null) => void> = [];
  const make = (inbox: Uint8Array[], waiters: Array<(v: Uint8Array | null) => void>, outbox: Uint8Array[], peerWaiters: Array<(v: Uint8Array | null) => void>): AeWire => ({
    send(bytes) {
      if (closed) return;
      const w = peerWaiters.shift();
      if (w) w(bytes);
      else outbox.push(bytes);
    },
    next() {
      if (inbox.length > 0) return Promise.resolve(inbox.shift()!);
      if (closed) return Promise.resolve(null);
      return new Promise((resolve) => waiters.push(resolve));
    },
    close() {
      closed = true;
      for (const w of [...waitersA, ...waitersB]) w(null);
      waitersA.length = 0;
      waitersB.length = 0;
    },
  });
  const a = make(qA, waitersA, qB, waitersB);
  const b = make(qB, waitersB, qA, waitersA);
  return [a, b];
}

// ── Nodes + manifest (real keys) ─────────────────────────────────────────────────────────────
const seedA = new Uint8Array(32).fill(0xa1);
const seedB = new Uint8Array(32).fill(0xb2);
const pub = (s: Uint8Array): string => Buffer.from(ed25519.getPublicKey(s)).toString("hex");

const manifest: ConsortiumManifest = {
  version: 2,
  not_before: "2026-01-01T00:00:00Z",
  expires: "2027-01-01T00:00:00Z",
  nodes: [
    { nodeId: "aws-use1", pubkey: pub(seedA), region: "us-east-1", provider: "aws", endpoint: "https://a", role: "validator", peerId: "12D3KooWAAA" },
    { nodeId: "gcp-usc1", pubkey: pub(seedB), region: "us-central1", provider: "gcp", endpoint: "https://b", role: "validator", peerId: "12D3KooWBBB" },
  ],
  signatures: [],
};

function identity(nodeId: string, seed: Uint8Array, peerId: string): AeNodeIdentity {
  return {
    nodeId,
    peerId,
    sign: (tbs) => ed25519.sign(tbs, seed),
  };
}
const A = identity("aws-use1", seedA, "12D3KooWAAA");
const B = identity("gcp-usc1", seedB, "12D3KooWBBB");

// ── Minimal in-memory store (same shape the engine test proves) ──────────────────────────────
type RevRow = { agent_id: string; epoch_id: string | null; reason: string | null; signature: string; revoked_at: string };
class MemStore implements AeStoreView {
  revocations = new Map<string, RevRow>();
  suspensions = new Map<string, SuspensionRecord>();
  tierATables(): string[] { return ["agent_revocations"]; }
  tierBTables(): string[] { return ["agent_suspensions"]; }
  tierARecordHashes(): string[] {
    return [...this.revocations.values()].map((r) => encodeTierARecord(AGENT_REVOCATIONS_SPEC, r).hash);
  }
  tierBVersions(): Map<string, string> {
    const m = new Map<string, string>();
    for (const [k, s] of this.suspensions) {
      m.set(k, encodeTierBVersion(SUSPENSION_VERSION_SPEC, {
        agent_id: s.agent_id, paused: s.paused, burned: s.burned, reason: s.reason,
        authorized_by_account: s.authorized_by_account, suspension_seq: String(s.suspension_seq), origin_node: s.origin_node,
      }).versionHash);
    }
    return m;
  }
  serveTierA(_t: string, hashes: readonly string[]): TierARecord[] {
    const want = new Set(hashes);
    return [...this.revocations.values()]
      .map((r) => ({ hash: encodeTierARecord(AGENT_REVOCATIONS_SPEC, r).hash, body: r }))
      .filter((rec) => want.has(rec.hash));
  }
  serveTierB(_t: string, keys: readonly string[]): TierBRecord[] {
    return keys.filter((k) => this.suspensions.has(k)).map((k) => ({ key: k, body: this.suspensions.get(k)! }));
  }
  applyTierA(_t: string, records: readonly TierARecord[]): number {
    let n = 0;
    for (const rec of records) {
      const r = rec.body as RevRow;
      if (!this.revocations.has(r.agent_id)) { this.revocations.set(r.agent_id, r); n++; }
    }
    return n;
  }
  applyTierB(_t: string, records: readonly TierBRecord[]): number {
    let n = 0;
    for (const rec of records) {
      const inc = rec.body as SuspensionRecord;
      const ex = this.suspensions.get(inc.agent_id);
      const merged = ex ? mergeSuspension(ex, inc) : inc;
      if (!ex || JSON.stringify(merged) !== JSON.stringify(ex)) n++;
      this.suspensions.set(inc.agent_id, merged);
    }
    return n;
  }
}

const rev = (id: string): RevRow => ({ agent_id: id, epoch_id: "e1", reason: "compromise", signature: "ab".repeat(64), revoked_at: "1785200000000" });
const susp = (id: string, seq: number, paused: boolean): SuspensionRecord => ({
  agent_id: id, paused, burned: false, reason: null, authorized_by_account: "acc", suspension_seq: seq, origin_node: "n",
});

/** Run dialer + responder concurrently over a wire pair; return the dialer's outcome. */
async function runBoth(opts?: {
  dialerId?: AeNodeIdentity; responderId?: AeNodeIdentity;
  dialerActualRemotePeerId?: string; responderActualRemotePeerId?: string;
  dialerStore?: AeStoreView; responderStore?: AeStoreView;
  rounds?: number;
}) {
  const [wireA, wireB] = wirePair();
  const dialerStore = opts?.dialerStore ?? new MemStore();
  const responderStore = opts?.responderStore ?? new MemStore();
  const responder = serveAeResponder({
    wire: wireB,
    manifest,
    identity: opts?.responderId ?? B,
    actualRemotePeerId: opts?.responderActualRemotePeerId ?? A.peerId,
    store: responderStore,
    nowMs: () => Date.parse("2026-07-28T10:00:00Z"),
  });
  const dialer = runAeDialer({
    wire: wireA,
    manifest,
    identity: opts?.dialerId ?? A,
    remoteNodeId: (opts?.responderId ?? B).nodeId,
    actualRemotePeerId: opts?.dialerActualRemotePeerId ?? B.peerId,
    store: dialerStore,
    rounds: opts?.rounds ?? 1,
    nowMs: () => Date.parse("2026-07-28T10:00:00Z"),
  });
  const [dialerResult] = await Promise.all([dialer, responder.catch(() => undefined)]);
  return { dialerResult, dialerStore, responderStore };
}

describe("ae-channel: mutual handshake + rounds over the wire", () => {
  it("handshake succeeds and one round converges the dialer onto the responder's state", async () => {
    const responderStore = new MemStore();
    responderStore.revocations.set("agX", rev("agX"));
    responderStore.suspensions.set("agZ", susp("agZ", 3, true));

    const { dialerResult, dialerStore } = await runBoth({ responderStore });
    expect(dialerResult.ok).toBe(true);
    if (!dialerResult.ok) return;
    expect(dialerResult.rounds[0].tierAApplied).toBe(1);
    expect(dialerResult.rounds[0].tierBApplied).toBe(1);
    expect((dialerStore as MemStore).revocations.has("agX")).toBe(true);
    expect((dialerStore as MemStore).suspensions.get("agZ")?.paused).toBe(true);
  });

  it("a second round over the wire pulls nothing (termination end-to-end)", async () => {
    const responderStore = new MemStore();
    responderStore.revocations.set("agX", rev("agX"));

    const { dialerResult } = await runBoth({ responderStore, rounds: 2 });
    expect(dialerResult.ok).toBe(true);
    if (!dialerResult.ok) return;
    expect(dialerResult.rounds[1]).toEqual({ tierAPulled: 0, tierBPulled: 0, tierAApplied: 0, tierBApplied: 0 });
  });

  it("FAILS CLOSED: responder signing with the WRONG key → signature_invalid, no round runs", async () => {
    const evilB: AeNodeIdentity = { ...B, sign: (tbs) => ed25519.sign(tbs, new Uint8Array(32).fill(0xcc)) };
    const { dialerResult } = await runBoth({ responderId: evilB });
    expect(dialerResult.ok).toBe(false);
    if (dialerResult.ok) return;
    expect(dialerResult.reason).toBe("signature_invalid");
  });

  it("FAILS CLOSED: live PeerId mismatch (attacker relaying frames over its own connection)", async () => {
    // The dialer observes the attacker's PeerId on the Noise connection, not B's manifest peerId.
    const { dialerResult } = await runBoth({ dialerActualRemotePeerId: "12D3KooWEvil" });
    expect(dialerResult.ok).toBe(false);
    if (dialerResult.ok) return;
    expect(dialerResult.reason).toBe("peerid_mismatch");
  });

  it("FAILS CLOSED: a nodeId absent from the manifest → manifest_pubkey_mismatch", async () => {
    const ghost: AeNodeIdentity = { nodeId: "azure-xyz", peerId: "12D3KooWGhost", sign: (tbs) => ed25519.sign(tbs, seedB) };
    const { dialerResult } = await runBoth({ responderId: ghost });
    expect(dialerResult.ok).toBe(false);
    if (dialerResult.ok) return;
    expect(dialerResult.reason).toBe("manifest_pubkey_mismatch");
  });

  it("FAILS CLOSED: a VALID consortium member answering for a node we did not dial → node_id_mismatch", async () => {
    // We dial expecting aws-use1 but the (legitimate, manifest-listed) gcp-usc1 answers — a
    // routing/endpoint mis-binding. Deliberately NOT peerid_mismatch: the §1c rotation-skew retry
    // keys on manifest/peerid mismatches and must never fire on a plain wrong-endpoint dial.
    const [wireA, wireB] = wirePair();
    const responder = serveAeResponder({
      wire: wireB, manifest, identity: B, actualRemotePeerId: A.peerId, store: new MemStore(),
      nowMs: () => Date.parse("2026-07-28T10:00:00Z"),
    });
    const dialer = runAeDialer({
      wire: wireA, manifest, identity: A, remoteNodeId: "aws-use1", actualRemotePeerId: B.peerId,
      store: new MemStore(), nowMs: () => Date.parse("2026-07-28T10:00:00Z"),
    });
    const [result] = await Promise.all([dialer, responder.catch(() => undefined)]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("node_id_mismatch");
  });

  it("RESPONDER-side fail closed: a dialer signing with the WRONG key is refused, nothing served", async () => {
    // The mirror of the wrong-key dialer test — this one pins the RESPONDER's verification of
    // ae_auth_a. Deleting the responder's verdict check would pass every dialer-side test; this
    // one fails (the revert test the review demanded).
    const evilA: AeNodeIdentity = { ...A, sign: (tbs) => ed25519.sign(tbs, new Uint8Array(32).fill(0xdd)) };
    const [wireA, wireB] = wirePair();
    const responderStore = new MemStore();
    responderStore.revocations.set("agX", rev("agX"));
    const responder = serveAeResponder({
      wire: wireB, manifest, identity: B, actualRemotePeerId: A.peerId, store: responderStore,
      nowMs: () => Date.parse("2026-07-28T10:00:00Z"),
    });
    const dialer = runAeDialer({
      wire: wireA, manifest, identity: evilA, remoteNodeId: B.nodeId, actualRemotePeerId: B.peerId,
      store: new MemStore(), nowMs: () => Date.parse("2026-07-28T10:00:00Z"),
    });
    const [respOutcome, dialOutcome] = await Promise.allSettled([responder, dialer]);
    expect(respOutcome.status).toBe("rejected"); // responder refused the invalid counter-signature
    if (respOutcome.status === "rejected") {
      expect(String(respOutcome.reason)).toMatch(/signature_invalid/);
    }
    // And the dialer never got a served round (its state request met a closed wire).
    if (dialOutcome.status === "fulfilled") {
      expect(dialOutcome.value.ok).toBe(false);
    }
  });

  it("FAILS CLOSED: a peer that goes silent after hello times out (frame deadline)", async () => {
    const [wireA] = wirePair(); // responder end never driven — silence
    const result = await runAeDialer({
      wire: wireA, manifest, identity: A, remoteNodeId: B.nodeId, actualRemotePeerId: B.peerId,
      store: new MemStore(), frameTimeoutMs: 50,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("protocol_error");
    expect(result.detail).toMatch(/timed out/);
  });

  it("FAILS CLOSED: self-dial (nodeId_a === nodeId_b) is refused (anti-reflection)", async () => {
    const { dialerResult } = await runBoth({ responderId: A, responderActualRemotePeerId: A.peerId, dialerActualRemotePeerId: A.peerId });
    expect(dialerResult.ok).toBe(false);
  });

  it("responder refuses round frames from a peer that never authenticated", async () => {
    const [wireA, wireB] = wirePair();
    const responderStore = new MemStore();
    responderStore.revocations.set("agX", rev("agX"));
    const responder = serveAeResponder({
      wire: wireB, manifest, identity: B, actualRemotePeerId: A.peerId, store: responderStore,
      nowMs: () => Date.parse("2026-07-28T10:00:00Z"),
    });
    // Skip the handshake entirely — send a state request cold. CBOR-encode by hand via the wire:
    // the responder must terminate, not serve.
    const { encodeAeFrame } = await import("../ae-channel.js");
    wireA.send(encodeAeFrame({ type: "ae_state_req" }));
    // The responder must terminate (expected ae_hello, got a round frame) — and serve NOTHING.
    await expect(responder).rejects.toThrow(/expected ae_hello/i);
    expect(await wireA.next()).toBeNull(); // no ae_state was ever sent back
  });

  it("FAILS CLOSED: stale timestamp → timestamp_skew (freshness window enforced over the wire)", async () => {
    const [wireA, wireB] = wirePair();
    const responder = serveAeResponder({
      wire: wireB, manifest, identity: B, actualRemotePeerId: A.peerId, store: new MemStore(),
      nowMs: () => Date.parse("2026-07-28T10:00:00Z"), // responder stamps 10:00
    });
    const dialer = runAeDialer({
      wire: wireA, manifest, identity: A, remoteNodeId: B.nodeId, actualRemotePeerId: B.peerId,
      store: new MemStore(),
      nowMs: () => Date.parse("2026-07-28T10:05:00Z"), // dialer's clock is 5 min ahead — outside 60s
    });
    const [result] = await Promise.all([dialer, responder.catch(() => undefined)]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("timestamp_skew");
  });
});
