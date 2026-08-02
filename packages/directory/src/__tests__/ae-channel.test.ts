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

import { describe, it, expect, vi } from "vitest";
import { ed25519 } from "@noble/curves/ed25519.js";
import { decode as cborDecode } from "cbor-x";
import type { ConsortiumManifest } from "@cello-protocol/protocol-types";
import {
  runAeDialer, serveAeResponder, type AeWire, type AeNodeIdentity,
} from "../ae-channel.js";
import type { AeStoreView, TierARecord, TierBRecord } from "../anti-entropy-engine.js";
import { computeTableDigest } from "../set-reconciliation.js";
import { tierBTableDigest } from "../ae-round.js";
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
const seedC = new Uint8Array(32).fill(0xc3);
const pub = (s: Uint8Array): string => Buffer.from(ed25519.getPublicKey(s)).toString("hex");

const manifest: ConsortiumManifest = {
  version: 2,
  not_before: "2026-01-01T00:00:00Z",
  expires: "2027-01-01T00:00:00Z",
  nodes: [
    { nodeId: "aws-use1", pubkey: pub(seedA), region: "us-east-1", provider: "aws", endpoint: "https://a", role: "validator", peerId: "12D3KooWAAA" },
    { nodeId: "gcp-usc1", pubkey: pub(seedB), region: "us-central1", provider: "gcp", endpoint: "https://b", role: "validator", peerId: "12D3KooWBBB" },
    // A third member so "we dialed X and a DIFFERENT valid member answered" is expressible without
    // the dialer targeting its own nodeId — which is now refused as a self-dial before any I/O.
    { nodeId: "gcp-euw1", pubkey: pub(seedC), region: "europe-west1", provider: "gcp", endpoint: "https://c", role: "validator", peerId: "12D3KooWCCC" },
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
const C = identity("gcp-euw1", seedC, "12D3KooWCCC");

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
  // Digest-first advertisement: the O(1)-per-table divergence check (design §3 step 1).
  tierATableDigest(): string { return computeTableDigest(this.tierARecordHashes()); }
  tierBTableDigest(): string { return tierBTableDigest(this.tierBVersions()); }
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
  /** M12-P9: observe tables the responder could not advertise. Default undefined = today's behaviour. */
  responderOnTableError?: (tier: "A" | "B", table: string, err: unknown) => void;
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
    onTableError: opts?.responderOnTableError,
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
    // Termination over the wire is now a 7-field claim: nothing PLANNED either, and no table failed.
    // Planned-zero is what separates real convergence from a peer that advertised differing digests
    // and then served nothing.
    expect(dialerResult.rounds[1]).toEqual({
      tierAPulled: 0, tierBPulled: 0, tierAApplied: 0, tierBApplied: 0,
      tierAPlanned: 0, tierBPlanned: 0, failures: [],
    });
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

  it("FAILS CLOSED: a nodeId absent from the manifest → node_not_in_manifest", async () => {
    const ghost: AeNodeIdentity = { nodeId: "azure-xyz", peerId: "12D3KooWGhost", sign: (tbs) => ed25519.sign(tbs, seedB) };
    const { dialerResult } = await runBoth({ responderId: ghost });
    expect(dialerResult.ok).toBe(false);
    if (dialerResult.ok) return;
    expect(dialerResult.reason).toBe("node_not_in_manifest");
  });

  it("FAILS CLOSED: a VALID consortium member answering for a node we did not dial → node_id_mismatch", async () => {
    // We dial expecting aws-use1 but the (legitimate, manifest-listed) gcp-usc1 answers — a
    // routing/endpoint mis-binding. Deliberately NOT peerid_mismatch: the §1c rotation-skew retry
    // keys on manifest/peerid mismatches and must never fire on a plain wrong-endpoint dial.
    const [wireA, wireB] = wirePair();
    // Dialer A, TARGET gcp-usc1, and gcp-euw1 answers — three distinct members. The old fixture had
    // A dialing its OWN nodeId and only reached node_id_mismatch because B happened to answer, so it
    // exercised the mis-binding by accident; that shape is now refused earlier as a self-dial.
    const responder = serveAeResponder({
      wire: wireB, manifest, identity: C, actualRemotePeerId: A.peerId, store: new MemStore(),
      nowMs: () => Date.parse("2026-07-28T10:00:00Z"),
    });
    const dialer = runAeDialer({
      wire: wireA, manifest, identity: A, remoteNodeId: "gcp-usc1", actualRemotePeerId: C.peerId,
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

  it("FAILS CLOSED: self-dial (nodeId_a === nodeId_b) is refused as self_dial (anti-reflection)", async () => {
    const { dialerResult } = await runBoth({ responderId: A, responderActualRemotePeerId: A.peerId, dialerActualRemotePeerId: A.peerId });
    expect(dialerResult.ok).toBe(false);
    if (dialerResult.ok) return;
    // The REASON, not just the refusal. This used to surface as `signature_invalid` — because
    // buildAePeerAuthTbs throws on nodeIdA === nodeIdB and verifyAePeerAuth swallows that to false —
    // pointing the operator at key material for what is actually reflection, or a manifest where two
    // entries share an identity. Asserting only `ok === false` is why nothing noticed.
    expect(dialerResult.reason).toBe("self_dial");
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
  // ── DOD-AE-APPEND-1: "divergence detection is O(compare)" ────────────────────────────────────
  it("a CONVERGED round sends only digests — no hash list, no version map crosses the wire", async () => {
    // The AC, made observable. Both sides hold identical state, so the round must cost one digest
    // per table and nothing more. Before the digest-first change the advertisement carried the full
    // hash list every round, so this counted 1+ detail fetches and would fail.
    const shared = new MemStore();
    shared.revocations.set("agX", rev("agX"));
    shared.suspensions.set("agZ", susp("agZ", 1, true));
    const clone = new MemStore();
    clone.revocations.set("agX", rev("agX"));
    clone.suspensions.set("agZ", susp("agZ", 1, true));

    const [wireA, wireB] = wirePair();
    // Count what the DIALER asks for: detail requests are the O(table) cost the AC forbids here.
    const asked: string[] = [];
    const countingWire: AeWire = {
      send(bytes) {
        const t = (cborDecode(bytes) as { type?: string }).type;
        if (t) asked.push(t);
        wireA.send(bytes);
      },
      next: () => wireA.next(),
      close: () => wireA.close(),
    };
    const responder = serveAeResponder({
      wire: wireB, manifest, identity: B, actualRemotePeerId: A.peerId, store: shared,
      nowMs: () => Date.parse("2026-07-28T10:00:00Z"),
    });
    const result = await runAeDialer({
      wire: countingWire, manifest, identity: A, remoteNodeId: B.nodeId, actualRemotePeerId: B.peerId,
      store: clone, nowMs: () => Date.parse("2026-07-28T10:00:00Z"),
    });
    await responder.catch(() => undefined);

    expect(result.ok).toBe(true);
    expect(asked).toContain("ae_state_req"); // the digest exchange DID happen
    // …of a REAL converged round. Without this, an implementation whose refresh() returned empty
    // advertisements would send no detail frames either and pass identically — "nothing crossed the
    // wire" has to mean "there was something to compare and it matched".
    expect(result.ok && result.rounds[0]).toEqual({
      tierAPulled: 0, tierBPulled: 0, tierAApplied: 0, tierBApplied: 0,
      tierAPlanned: 0, tierBPlanned: 0, failures: [],
    });
    // …and nothing beyond it: no bucket walk, no hash list, no version map, no body pull.
    for (const detail of ["ae_buckets_req", "ae_bucket_hashes_req", "ae_versions_req", "ae_pull_a", "ae_pull_b"]) {
      expect(asked, `converged round must not send ${detail}`).not.toContain(detail);
    }
  });

  it("a DIVERGENT table walks buckets — only the differing buckets' hashes are fetched", async () => {
    // Divergence detection stays cheap even when it fires: the bucket vector localises the
    // difference to a handful of the 256 buckets, and only those buckets' hashes cross the wire.
    const peer = new MemStore();
    const local = new MemStore();
    for (let i = 0; i < 40; i++) {
      const r = rev(`shared-${i}`);
      peer.revocations.set(r.agent_id, r);
      local.revocations.set(r.agent_id, r);
    }
    peer.revocations.set("only-on-peer", rev("only-on-peer")); // one divergence in one bucket

    // Count the FRAMES, not just the outcome. The name makes a wire-level claim — "only the differing
    // buckets' hashes are fetched" — and asserting ok/pulled/landed cannot see it: an implementation
    // that requested all 256 buckets, or skipped the walk and asked for the full hash list, produces
    // exactly the same outcome and passed this test unchanged.
    const [wireA, wireB] = wirePair();
    const sent: Array<Record<string, unknown>> = [];
    const countingWire: AeWire = {
      send(bytes) { sent.push(cborDecode(bytes) as Record<string, unknown>); wireA.send(bytes); },
      next: () => wireA.next(),
      close: () => wireA.close(),
    };
    const responder = serveAeResponder({
      wire: wireB, manifest, identity: B, actualRemotePeerId: A.peerId, store: peer,
      nowMs: () => Date.parse("2026-07-28T10:00:00Z"),
    });
    const dialerResult = await runAeDialer({
      wire: countingWire, manifest, identity: A, remoteNodeId: B.nodeId, actualRemotePeerId: B.peerId,
      store: local, nowMs: () => Date.parse("2026-07-28T10:00:00Z"),
    });
    await responder.catch(() => undefined);

    expect(dialerResult.ok).toBe(true);
    if (!dialerResult.ok) return;
    expect(dialerResult.rounds[0].tierAPulled).toBe(1);
    expect(local.revocations.has("only-on-peer")).toBe(true);

    // The walk happened, and it asked for ONE bucket — 41 records over 256 buckets put the single
    // divergence in exactly one.
    const req = sent.find((f) => f["type"] === "ae_bucket_hashes_req");
    expect(req, "a divergent table must trigger a bucket-hash request").toBeDefined();
    const buckets = req!["buckets"] as number[];
    expect(Array.isArray(buckets)).toBe(true);
    expect(buckets.length, `expected ONE differing bucket, asked for ${buckets.length}`).toBe(1);
  });

  it("REFUSES a peer that serves the same record repeatedly to fake a full response", async () => {
    const { encodeAeFrame } = await import("../ae-channel.js");
    // The `requested` filter is membership, not consumption, so duplicates used to survive it: a peer
    // could satisfy an N-record plan by sending record #1 N times. `pulled` then reached `planned`, so
    // the shortfall alarm stayed silent, and because one row DID apply the fork streak reset — a peer
    // withholding the rest of agent_suspensions looked like a clean converged round forever.
    const peer2 = new MemStore();
    const local2 = new MemStore();
    for (let i = 0; i < 3; i++) peer2.revocations.set(`dup-${i}`, rev(`dup-${i}`));

    const [wA, wB] = wirePair();
    // Duplicate the RESPONSE, not the request. My first attempt rewrote `ae_pull_a`'s hash list to
    // three copies — which proved nothing, because MemStore.serveTierA maps over ITS OWN records and
    // filters by the requested set, so it still returned one. The duplicate has to be injected into
    // the `ae_records_a` frame travelling back, which is the hop RemoteStoreView's filter guards.
    const dupWire: AeWire = {
      send: (bytes) => wA.send(bytes),
      async next() {
        const b = await wA.next();
        if (!b) return b;
        const f = cborDecode(b) as Record<string, unknown>;
        if (f["type"] === "ae_records_a" && Array.isArray(f["records"]) && f["records"].length > 0) {
          const one = (f["records"] as unknown[])[0];
          f["records"] = [one, one, one];
          return encodeAeFrame(f);
        }
        return b;
      },
      close: () => wA.close(),
    };
    const responder2 = serveAeResponder({
      wire: wB, manifest, identity: B, actualRemotePeerId: A.peerId, store: peer2,
      nowMs: () => Date.parse("2026-07-28T10:00:00Z"),
    });
    const res2 = await runAeDialer({
      wire: dupWire, manifest, identity: A, remoteNodeId: B.nodeId, actualRemotePeerId: B.peerId,
      store: local2, nowMs: () => Date.parse("2026-07-28T10:00:00Z"),
    });
    await responder2.catch(() => undefined);

    expect(res2.ok).toBe(true);
    if (!res2.ok) return;
    // Deduped: the three copies count ONCE, so pulled stays below planned and the shortfall is visible
    // to the sync service instead of being papered over.
    // Three copies of one record must count ONCE — otherwise pulled reaches planned, the shortfall
    // alarm stays silent, and the applied row resets the fork streak.
    expect(res2.rounds[0].tierAPulled).toBe(1);
    expect(res2.rounds[0].tierAPlanned).toBe(3);
    expect(res2.rounds[0].tierAPlanned).toBeGreaterThan(res2.rounds[0].tierAPulled);
  });
});

/**
 * M12-P9 — one unreadable table must not stop every other table from replicating.
 *
 * `buildWireState` looped over every table with no isolation. On 2026-08-01 a Tier-A spec named a
 * column a later migration had dropped, so ONE table's digest query threw; the throw escaped
 * `handling_ae_state_req` and killed the peer's ENTIRE round. All eleven Tier-A tables stopped
 * replicating across all three nodes, for days, surfacing a layer away as CLAIM_CODE_INVALID during
 * Telegram registration.
 *
 * The spec bug is fixed and guarded (ae-spec-schema.test.ts). This covers the AMPLIFIER, and the two
 * properties pull against each other: the round must SURVIVE, and the skip must be LOUD. A test
 * asserting only the first would pass an implementation that swallows the error — trading a crash
 * for a mesh that reports itself healthy while one table drifts apart forever.
 */
describe("M12-P9: a table that cannot be read is skipped, not fatal", () => {
  /** A responder whose Tier-B digest throws, exactly as a bad column did in production. */
  class OneBadTableStore extends MemStore {
    override tierBTableDigest(): string {
      throw new Error(`column "subject" does not exist`);
    }
  }

  it("the round SURVIVES and the healthy tier still converges", async () => {
    const responderStore = new OneBadTableStore();
    responderStore.revocations.set("agX", rev("agX"));
    responderStore.suspensions.set("agZ", susp("agZ", 3, true));

    const { dialerResult, dialerStore } = await runBoth({ responderStore, responderOnTableError: () => {} });

    // Before the fix this was ok:false — the responder threw mid-advertisement and took the round.
    expect(dialerResult.ok).toBe(true);
    if (!dialerResult.ok) return;
    // And the tier that WAS readable replicated normally, which is the entire point.
    expect(dialerResult.rounds[0].tierAApplied).toBe(1);
    expect((dialerStore as MemStore).revocations.has("agX")).toBe(true);
  });

  it("the unreadable tier is OMITTED rather than advertised empty", async () => {
    // Omission is load-bearing. The planner walks the PEER'S table list, and
    // RemoteStoreView.tierBTables() is Object.keys(state.tierB) — so an omitted table is simply not
    // reconciled. Advertising "" would instead DIFFER from the real digest and send the dialer into
    // a detail fetch over a table we just proved unreadable.
    const responderStore = new OneBadTableStore();
    responderStore.suspensions.set("agZ", susp("agZ", 3, true));

    const { dialerResult, dialerStore } = await runBoth({ responderStore, responderOnTableError: () => {} });
    expect(dialerResult.ok).toBe(true);
    if (!dialerResult.ok) return;
    expect(dialerResult.rounds[0].tierBApplied).toBe(0);
    expect((dialerStore as MemStore).suspensions.has("agZ")).toBe(false); // not pulled, not invented
  });

  it("REPORTS the skip, naming the table and the underlying cause", async () => {
    // The property separating this fix from a silent fallback.
    const onTableError = vi.fn();
    const responderStore = new OneBadTableStore();
    responderStore.revocations.set("agX", rev("agX"));

    await runBoth({ responderStore, responderOnTableError: onTableError });

    expect(onTableError).toHaveBeenCalled();
    const [tier, table, err] = onTableError.mock.calls[0]!;
    expect(tier).toBe("B");
    expect(table).toBe("agent_suspensions");
    // The CAUSE must survive, not merely the fact of failure — the 2026-08-01 outage was
    // diagnosable only because this string reached a log at all.
    expect(String((err as Error).message)).toContain("does not exist");
  });

  /**
   * TIER A specifically. Every other test in this block throws from Tier B, and a review proved the
   * gap by reverting ONLY the Tier-A try/catch: all 18 tests stayed green. The parked item names
   * Tier A ("one bad Tier-A column"), and Tier A carries `agent_revocations` — so the tier that has
   * to survive is the one that had no test.
   */
  it("isolates the TIER-A branch too, not just Tier B", async () => {
    class BadTierAStore extends MemStore {
      override tierATableDigest(): string {
        throw new Error(`column "subject" does not exist`);
      }
    }
    const onTableError = vi.fn();
    const responderStore = new BadTierAStore();
    responderStore.revocations.set("agX", rev("agX"));
    responderStore.suspensions.set("agZ", susp("agZ", 3, true));

    const { dialerResult, dialerStore } = await runBoth({ responderStore, responderOnTableError: onTableError });

    expect(dialerResult.ok).toBe(true);
    if (!dialerResult.ok) return;
    const [tier, table] = onTableError.mock.calls[0]!;
    expect(tier).toBe("A");
    expect(table).toBe("agent_revocations");
    // Tier A omitted, so nothing invented — and Tier B, the readable tier, still converged.
    expect((dialerStore as MemStore).revocations.has("agX")).toBe(false);
    expect(dialerResult.rounds[0].tierBApplied).toBe(1);
  });

  it("a healthy store reports nothing — the callback is not chatty", async () => {
    const onTableError = vi.fn();
    const responderStore = new MemStore();
    responderStore.revocations.set("agX", rev("agX"));

    const { dialerResult } = await runBoth({ responderStore, responderOnTableError: onTableError });
    expect(dialerResult.ok).toBe(true);
    expect(onTableError).not.toHaveBeenCalled();
  });
});
