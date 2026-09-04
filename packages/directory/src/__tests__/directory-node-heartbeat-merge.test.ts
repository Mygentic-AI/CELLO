/**
 * DOD-M15-HEARTBEAT-1 — directory_nodes heartbeat merge (Tier-B, wall-clock LWW).
 *
 * The merge resolves the one mutable column of `directory_nodes` when two sovereign nodes hold the
 * same `node_id` with different heartbeats. Anti-entropy input arrives from OTHER nodes and
 * authentication is not honesty, so the properties that matter are totality (no input crashes or
 * returns undefined), commutativity (arg order never decides), and that a malformed value can never
 * displace a valid one.
 */

import { describe, it, expect } from "vitest";
import {
  mergeDirectoryNodeHeartbeat,
  directoryNodeHeartbeatStillDivergent,
  DIRECTORY_NODE_HEARTBEAT_MERGE_COLUMNS,
  type DirectoryNodeHeartbeatRecord,
} from "../directory-node-heartbeat-merge.js";

const rec = (
  node_id: string,
  last_heartbeat_at: string,
  status = "active",
): DirectoryNodeHeartbeatRecord => ({
  node_id,
  status,
  last_heartbeat_at,
});

describe("DOD-M15-HEARTBEAT-1: directory_nodes heartbeat merge", () => {
  it("the FRESHER heartbeat wins, in both argument orders", () => {
    const stale = rec("us-central1", "1785200000000");
    const fresh = rec("us-central1", "1785200060000");
    expect(mergeDirectoryNodeHeartbeat(stale, fresh)).toEqual(fresh);
    expect(mergeDirectoryNodeHeartbeat(fresh, stale)).toEqual(fresh);
  });

  it("epoch 0 ('registered, never heartbeated') LOSES to any real heartbeat", () => {
    // V65's backfill value. This is the case the whole line exists for: a node that has never been
    // heard from must not overwrite a node that has.
    const never = rec("europe-west1", "0");
    const heard = rec("europe-west1", "1785200000000");
    expect(mergeDirectoryNodeHeartbeat(never, heard)).toEqual(heard);
    expect(mergeDirectoryNodeHeartbeat(heard, never)).toEqual(heard);
  });

  it("is idempotent — merging a record with itself returns it unchanged", () => {
    const r = rec("asia-northeast1", "1785200000000");
    expect(mergeDirectoryNodeHeartbeat(r, r)).toEqual(r);
  });

  it("compares NUMERICALLY, not lexicographically", () => {
    // "9" > "10" as strings but 9 < 10 as numbers. A string compare would pick the older heartbeat
    // whenever the digit count changed, which is every ~3 years at millisecond scale — and would
    // pass a test that only ever used same-length values.
    const older = rec("n", "999999999999");
    const newer = rec("n", "1000000000000");
    expect(mergeDirectoryNodeHeartbeat(older, newer)).toEqual(newer);
    expect(mergeDirectoryNodeHeartbeat(newer, older)).toEqual(newer);
  });

  it("a NON-FINITE value from a hostile peer always LOSES to a valid timestamp", () => {
    // The clause names its cases, so the test uses those values rather than a representative:
    // Number() of each of these is NaN, which would make `>` always-false and hand the result to
    // whichever record was passed second.
    for (const bad of ["not-a-number", "", "NaN", "undefined"]) {
      const hostile = rec("n", bad);
      const valid = rec("n", "1785200000000");
      expect(mergeDirectoryNodeHeartbeat(hostile, valid), `${JSON.stringify(bad)} must lose`).toEqual(valid);
      expect(mergeDirectoryNodeHeartbeat(valid, hostile), `${JSON.stringify(bad)} must lose (reversed)`).toEqual(valid);
    }
  });

  it("two INVALID values still converge deterministically (commutative, not arg-order dependent)", () => {
    const a = rec("n", "garbage-a");
    const b = rec("n", "garbage-b");
    expect(mergeDirectoryNodeHeartbeat(a, b)).toEqual(mergeDirectoryNodeHeartbeat(b, a));
  });

  it("an exact TIE converges to the same record regardless of argument order", () => {
    const a = rec("n", "1785200000000");
    const b = rec("n", "1785200000000");
    expect(mergeDirectoryNodeHeartbeat(a, b)).toEqual(mergeDirectoryNodeHeartbeat(b, a));
  });

  it("declares exactly the columns it reads — node_id, status and last_heartbeat_at, nothing else", () => {
    // Asserts the VALUE, not merely that the export is non-empty: the version spec is compared
    // against this list, so a wrong list would make that comparison agree about the wrong thing.
    expect([...DIRECTORY_NODE_HEARTBEAT_MERGE_COLUMNS].sort())
      .toEqual(["last_heartbeat_at", "node_id", "status"]);
  });

  it("carries NO region/endpoint — a peer cannot rewrite a node's identity via this merge", () => {
    // The Tier-A/Tier-B column split is the counterbalance for this unit. If `region` were merge
    // input, a peer that simply reports a newer heartbeat would also get to restate our record of
    // another node's region. `status` LEFT this list on 2026-09-04 (DOD-M15-FORKQUIET-1) and the
    // property it was protecting did not: it is carried so the two nodes can compare it, and the
    // test below proves the peer still cannot move it.
    for (const forbidden of ["region", "endpoint", "created_at"]) {
      expect(DIRECTORY_NODE_HEARTBEAT_MERGE_COLUMNS).not.toContain(forbidden);
    }
  });

  // ── DOD-M15-FORKQUIET-1: `status` is a witness, not replicated state ────────────────────────
  it("keeps the RECEIVING node's `status` even when the peer's heartbeat wins", () => {
    // The counterbalance for putting the column on the wire at all. `applyTierB` calls this as
    // merge(local, incoming) and its UPDATE writes only `last_heartbeat_at`, so if the merge let the
    // peer's status through, the returned record and the row that actually lands in the database
    // would disagree — and a peer could silence a divergence alarm by reporting a newer timestamp.
    const local = rec("n", "1785200000000", "drained");
    const peer = rec("n", "1785200060000", "active"); // peer is FRESHER, and disagrees on status
    const merged = mergeDirectoryNodeHeartbeat(local, peer);
    expect(merged.last_heartbeat_at, "the fresher heartbeat still wins").toBe("1785200060000");
    expect(merged.status, "the peer's status must NOT come through").toBe("drained");
  });

  it("keeps the receiving node's `status` on the TIE branch too", () => {
    // Two branches return a record and both had to be pinned. The tiebreak picks a winner by a
    // canonical string, so on equal heartbeats the winner can be the peer — and this is the branch a
    // test that only exercised the fresher-wins case would leave uncovered.
    const local = rec("n", "1785200000000", "drained");
    const peer = rec("n", "1785200000000", "active");
    expect(mergeDirectoryNodeHeartbeat(local, peer).status).toBe("drained");
    expect(mergeDirectoryNodeHeartbeat(peer, local).status).toBe("active");
  });

  it("the divergence verdict reads `status` and IGNORES the heartbeat", () => {
    // The whole unit in two assertions. A node rewrites its own heartbeat every ~30s, so a dialer
    // always holds a fresher copy of its own row than any peer does — judged on the heartbeat, that
    // is a permanent fork on a healthy fleet.
    expect(
      directoryNodeHeartbeatStillDivergent(rec("n", "1785200060000"), rec("n", "1785200000000")),
      "a difference that is only a heartbeat is not a disagreement",
    ).toBe(false);
    expect(
      directoryNodeHeartbeatStillDivergent(
        rec("n", "1785200000000", "active"), rec("n", "1785200000000", "drained"),
      ),
      "a status disagreement is real and unresolvable — it must alarm",
    ).toBe(true);
    // And a status fork is NOT hidden by the heartbeats also differing, which on a live fleet they
    // almost always do.
    expect(
      directoryNodeHeartbeatStillDivergent(
        rec("n", "1785200060000", "active"), rec("n", "1785200000000", "drained"),
      ),
    ).toBe(true);
  });
});
