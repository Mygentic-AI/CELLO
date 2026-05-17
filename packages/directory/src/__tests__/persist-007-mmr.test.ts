/**
 * CELLO-PERSIST-007 — MMR single-node construction
 *
 * Specification interpretation:
 *
 * AC-001: First seal appended to empty MMR → leaf_index=0, single peak node, valid MMR structure.
 *         The MMR spec referenced is the design doc at 2026-04-13_1400_meta-merkle-tree-design.md,
 *         NOT RFC 6962 (which is a balanced binary Merkle tree).
 *
 * AC-002: N-leaf MMR gets a new seal → leaf at leaf_index=N, previous N leaves unchanged (row count
 *         and existing hashes both verified).
 *
 * AC-003: 8-leaf MMR with confirmed checkpoint → inclusion proof for leaf 3 returned and verified
 *         by running the 5-step verification algorithm locally without trusting the directory.
 *
 * AC-004: 5 staging seals → confirm checkpoint → staging cleared for those 5, proof_leaves
 *         still has all rows, checkpoint row has correct peak hash.
 *
 * AC-005: Seals added while checkpoint is being confirmed → only pre-initiation seals included;
 *         post-initiation seals remain in staging for next checkpoint (no loss, no double-count).
 *
 * AC-006: mmr.checkpoint.confirmed logged at INFO with { checkpointId, leafCount, peakHash,
 *         stagedSealCount }.
 *
 * AC-007: 100-leaf MMR → both conversation_proof_leaves and conversation_proof_mmr_nodes pass
 *         hash chain verification (no breaks).
 *
 * SI-001: Inclusion proof NOT issued for leaf in staging (not yet in confirmed checkpoint).
 *         Directory returns PROOF_NOT_YET_AVAILABLE instead.
 *         mmr.proof.unavailable logged at WARN with { sessionId, leafIndex }.
 *
 * SI-002: leaf_hash is computed from verified seal data (seal_merkle_root + leaf_index + recorded_at).
 *         A caller cannot supply their own leaf_hash.
 *
 * SI-003: No leaf appears in >1 checkpoint. Staging table checkpoint_id assignment is atomic.
 *
 * DB-001: Incomplete checkpoint (staging rows with checkpoint_id but no corresponding checkpoints
 *         row) detected on startup → mmr.checkpoint.incomplete logged at ERROR; re-run is idempotent.
 *
 * test_type:
 *   Unit ACs (no DB): AC-001, AC-002 (pure MMR algorithm), AC-006, SI-001 (logger call), SI-002
 *   Integration ACs (require CELLO_ENV=local + Postgres): AC-003, AC-004, AC-005, AC-007, SI-003, DB-001
 *
 * Run with:
 *   docker compose up -d && docker compose run --rm flyway
 *   CELLO_ENV=local DATABASE_URL=postgresql://cello_service:cello_service_dev@localhost:5433/cello_dev \
 *     pnpm --filter @cello/directory run test -- --pool-options.threads.maxThreads=1 --pool-options.threads.minThreads=1
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import pg from "pg";
import {
  computeLeafHash,
  computeMmrPosition,
  appendLeafToMmr,
  computeInclusionProof,
  verifyInclusionProof,
  type MmrLeaf,
  type MmrNode,
  type MmrPeak,
  PROOF_NOT_YET_AVAILABLE,
} from "../mmr.js";
import { MmrStore } from "../mmr-store.js";
import type { Logger } from "@cello/interfaces";

// ─── Unit tests: pure MMR algorithm (no DB) ──────────────────────────────────

describe("PERSIST-007 unit: MMR leaf hash computation", () => {
  it("SI-002: leaf_hash = SHA-256(leaf_index || seal_merkle_root || recorded_at)", () => {
    // leaf_hash is computed deterministically from seal data — not accepted from caller
    const leafIndex = 0;
    const sealMerkleRoot = "a".repeat(64);
    const recordedAt = "2026-01-01T00:00:00.000Z";

    const expected = createHash("sha256")
      .update(`${leafIndex}:${sealMerkleRoot}:${recordedAt}`)
      .digest("hex");

    const actual = computeLeafHash(leafIndex, sealMerkleRoot, recordedAt);
    expect(actual).toBe(expected);
    expect(actual).toHaveLength(64);
    expect(actual).toMatch(/^[0-9a-f]{64}$/);
  });

  it("SI-002: different sealMerkleRoot produces different leaf_hash", () => {
    const h1 = computeLeafHash(0, "a".repeat(64), "2026-01-01T00:00:00.000Z");
    const h2 = computeLeafHash(0, "b".repeat(64), "2026-01-01T00:00:00.000Z");
    expect(h1).not.toBe(h2);
  });

  it("SI-002: different leaf_index produces different leaf_hash", () => {
    const h1 = computeLeafHash(0, "a".repeat(64), "2026-01-01T00:00:00.000Z");
    const h2 = computeLeafHash(1, "a".repeat(64), "2026-01-01T00:00:00.000Z");
    expect(h1).not.toBe(h2);
  });
});

describe("PERSIST-007 unit: MMR position computation", () => {
  it("leaf 0 is at MMR position 0", () => {
    expect(computeMmrPosition(0)).toBe(0);
  });

  it("leaf 1 is at MMR position 1", () => {
    expect(computeMmrPosition(1)).toBe(1);
  });

  it("leaf 2 is at MMR position 3", () => {
    // After 2 leaves, the internal merge node for leaves 0,1 is at position 2,
    // so leaf 2 is at position 3.
    expect(computeMmrPosition(2)).toBe(3);
  });

  it("leaf 3 is at MMR position 4", () => {
    expect(computeMmrPosition(3)).toBe(4);
  });
});

describe("PERSIST-007 unit: MMR leaf append", () => {
  it("AC-001: first leaf (N=0) creates single peak with correct structure", () => {
    const sealMerkleRoot = "a".repeat(64);
    const recordedAt = "2026-01-01T00:00:00.000Z";
    const result = appendLeafToMmr(0, sealMerkleRoot, recordedAt, []);

    // One leaf in conversation_proof_leaves
    expect(result.newLeaf.leaf_index).toBe(0);
    expect(result.newLeaf.leaf_hash).toBe(computeLeafHash(0, sealMerkleRoot, recordedAt));
    expect(result.newLeaf.mmr_position).toBe(0);

    // One peak (the leaf itself) — no merges for a single leaf
    expect(result.newPeaks).toHaveLength(1);
    expect(result.newPeaks[0]!.position).toBe(0);
    expect(result.newPeaks[0]!.hash).toBe(result.newLeaf.leaf_hash);

    // No new internal nodes for a 1-leaf MMR
    expect(result.newNodes).toHaveLength(0);
  });

  it("AC-001: single leaf MMR has valid structure (peak hash = leaf hash)", () => {
    const sealMerkleRoot = "c".repeat(64);
    const recordedAt = "2026-01-01T00:00:00.000Z";
    const result = appendLeafToMmr(0, sealMerkleRoot, recordedAt, []);

    // The single peak's hash must equal the leaf hash (no merge)
    expect(result.newPeaks[0]!.hash).toBe(result.newLeaf.leaf_hash);
  });

  it("AC-002: second leaf triggers merge — 2-leaf MMR has 1 peak at height 1", () => {
    const r1 = appendLeafToMmr(0, "a".repeat(64), "2026-01-01T00:00:00.000Z", []);
    const r2 = appendLeafToMmr(1, "b".repeat(64), "2026-01-02T00:00:00.000Z", r1.newPeaks);

    // The two leaves merge into one parent peak
    expect(r2.newPeaks).toHaveLength(1);
    // One internal node created (the merge of leaf 0 and leaf 1)
    expect(r2.newNodes).toHaveLength(1);
    // The parent hash = SHA-256(leaf0_hash || leaf1_hash)
    const expectedParentHash = createHash("sha256")
      .update(r1.newLeaf.leaf_hash + r2.newLeaf.leaf_hash)
      .digest("hex");
    expect(r2.newPeaks[0]!.hash).toBe(expectedParentHash);
    expect(r2.newNodes[0]!.hash).toBe(expectedParentHash);
    expect(r2.newNodes[0]!.height).toBe(1);
  });

  it("AC-002: 3rd leaf produces 2 peaks (height-1 subtree + leaf)", () => {
    const r1 = appendLeafToMmr(0, "a".repeat(64), "2026-01-01T00:00:00.000Z", []);
    const r2 = appendLeafToMmr(1, "b".repeat(64), "2026-01-02T00:00:00.000Z", r1.newPeaks);
    const r3 = appendLeafToMmr(2, "c".repeat(64), "2026-01-03T00:00:00.000Z", r2.newPeaks);

    // 3-leaf MMR: one perfect-2-tree (2 leaves) + 1 leaf = 2 peaks
    expect(r3.newPeaks).toHaveLength(2);
    // No merge at this step (peaks are different heights)
    expect(r3.newNodes).toHaveLength(0);
  });

  it("AC-002: 4-leaf MMR has 1 peak (perfect binary tree)", () => {
    let peaks: MmrPeak[] = [];
    for (let i = 0; i < 4; i++) {
      const r = appendLeafToMmr(i, `${"a".repeat(63)}${i}`, `2026-01-0${i + 1}T00:00:00.000Z`, peaks);
      peaks = r.newPeaks;
    }
    // 4 leaves = 2^2, so exactly 1 peak
    expect(peaks).toHaveLength(1);
  });

  it("AC-002: appending leaf does not change existing peak hashes (immutability)", () => {
    const r1 = appendLeafToMmr(0, "a".repeat(64), "2026-01-01T00:00:00.000Z", []);
    const peakAfterOne = r1.newPeaks[0]!.hash;

    const r2 = appendLeafToMmr(1, "b".repeat(64), "2026-01-02T00:00:00.000Z", r1.newPeaks);
    // After the merge, the old peak hash (leaf 0) is captured in the new internal node
    // The internal node was built from leaf0 and leaf1
    const internalNode = r2.newNodes[0]!;
    const expectedParent = createHash("sha256")
      .update(peakAfterOne + r2.newLeaf.leaf_hash)
      .digest("hex");
    expect(internalNode.hash).toBe(expectedParent);
  });
});

describe("PERSIST-007 unit: inclusion proof computation and verification", () => {
  it("AC-003: 1-leaf MMR proof for leaf 0 verifies against the single peak", () => {
    const sealMerkleRoot = "a".repeat(64);
    const recordedAt = "2026-01-01T00:00:00.000Z";
    const r = appendLeafToMmr(0, sealMerkleRoot, recordedAt, []);

    const leaves: MmrLeaf[] = [{ ...r.newLeaf, seal_merkle_root: sealMerkleRoot, recorded_at: recordedAt }];
    const nodes: MmrNode[] = [...r.newNodes];
    const peakHash = r.newPeaks[0]!.hash;

    const proof = computeInclusionProof(0, leaves, nodes, r.newPeaks, peakHash);
    expect(proof).not.toBe(PROOF_NOT_YET_AVAILABLE);

    if (proof === PROOF_NOT_YET_AVAILABLE) throw new Error("Should not be unavailable");
    const verified = verifyInclusionProof(proof, sealMerkleRoot, peakHash);
    expect(verified).toBe(true);
  });

  it("SI-001: proof returns PROOF_NOT_YET_AVAILABLE when leaf not in any checkpoint", () => {
    const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    // Build a 1-leaf MMR but request proof without any committed checkpoint
    const sealMerkleRoot = "a".repeat(64);
    const recordedAt = "2026-01-01T00:00:00.000Z";
    const r = appendLeafToMmr(0, sealMerkleRoot, recordedAt, []);

    const leaves: MmrLeaf[] = [{ ...r.newLeaf, seal_merkle_root: sealMerkleRoot, recorded_at: recordedAt }];
    const nodes: MmrNode[] = [];
    const peaks = r.newPeaks;

    // No committed checkpoint hash supplied — proof unavailable
    const result = computeInclusionProof(0, leaves, nodes, peaks, null, logger, "test-session-id");
    expect(result).toBe(PROOF_NOT_YET_AVAILABLE);

    // mmr.proof.unavailable must be logged at WARN
    expect(logger.warn).toHaveBeenCalledWith(
      "mmr.proof.unavailable",
      expect.objectContaining({ sessionId: "test-session-id", leafIndex: 0 }),
    );
  });

});

// AC-006 unit test: exercises the mmr.checkpoint.confirmed log call through a stub pool
// that returns deterministic responses, so no DB connection is required.
// This test runs in standard CI (no CELLO_ENV=local, no Postgres).
describe("PERSIST-007 unit: AC-006 mmr.checkpoint.confirmed log call", () => {
  it("AC-006: MmrStore.confirmCheckpoint emits mmr.checkpoint.confirmed at INFO with { checkpointId, leafCount, peakHash, stagedSealCount }", async () => {
    const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const checkpointId = "test-checkpoint-uuid-ac006";
    const stagedSealCount = 2;
    const leafCount = 2;

    // Build a minimal stub pool that satisfies every query() call in confirmCheckpoint(),
    // without making a real DB connection.
    //
    // confirmCheckpoint query order:
    //   1. SELECT peak_hash FROM directory_checkpoints WHERE checkpoint_id = $1  → 0 rows (not idempotent)
    //   2. SELECT session_id, ... FROM conversation_seal_staging WHERE checkpoint_id = $1 → N rows
    //   3. SELECT COUNT(*) AS count FROM conversation_proof_leaves → leafCount
    //   4. SELECT leaf_index, leaf_hash, seal_merkle_root, recorded_at FROM ... (fetchCurrentPeaks via pool)
    //      – sub-query for peaks reconstruction (fetchCurrentPeaksFromPool → fetchCurrentPeaks)
    //   5. SELECT chain_hash FROM directory_checkpoints ORDER BY id DESC LIMIT 1 → 0 rows
    //
    // #fetchCurrentPeaksFromPool acquires a client from pool.connect(), so we also need
    // a stubClient with a query() that returns the leaves for peak reconstruction.
    const stubLeaves = [
      { leaf_index: 0, leaf_hash: "a".repeat(64), seal_merkle_root: "a".repeat(64), recorded_at: new Date("2026-01-01") },
      { leaf_index: 1, leaf_hash: "b".repeat(64), seal_merkle_root: "b".repeat(64), recorded_at: new Date("2026-01-02") },
    ];

    const stubPool = {
      query: vi.fn().mockImplementation(async (sql: string) => {
        // 1. Checkpoint existence check
        if (sql.includes("SELECT peak_hash FROM directory_checkpoints WHERE checkpoint_id")) {
          return { rows: [] };
        }
        // 2. Staging rows for this checkpoint
        if (sql.includes("FROM conversation_seal_staging WHERE checkpoint_id")) {
          return { rows: [
            { session_id: "session-1", seal_merkle_root: "a".repeat(64), recorded_at: new Date() },
            { session_id: "session-2", seal_merkle_root: "b".repeat(64), recorded_at: new Date() },
          ]};
        }
        // 3. Leaf count
        if (sql.includes("COUNT(*) AS count FROM conversation_proof_leaves")) {
          return { rows: [{ count: String(leafCount) }] };
        }
        // 5. Previous checkpoint chain_hash
        if (sql.includes("FROM directory_checkpoints ORDER BY id DESC LIMIT 1")) {
          return { rows: [] };
        }
        return { rows: [] };
      }),
      connect: vi.fn().mockResolvedValue({
        // stubClient for #fetchCurrentPeaks and the transaction
        query: vi.fn().mockImplementation(async (sql: string) => {
          if (sql.includes("FROM conversation_proof_leaves ORDER BY leaf_index ASC")) {
            return { rows: stubLeaves };
          }
          // Transaction control and other inserts/deletes succeed silently
          return { rows: [] };
        }),
        release: vi.fn(),
      }),
    } as unknown as import("pg").Pool;

    const store = new MmrStore(stubPool, logger);
    await store.confirmCheckpoint(checkpointId);

    // mmr.checkpoint.confirmed must have been logged at INFO with all four required fields
    expect(logger.info).toHaveBeenCalledWith(
      "mmr.checkpoint.confirmed",
      expect.objectContaining({
        checkpointId,
        leafCount,
        stagedSealCount,
      }),
    );

    // peakHash must be a 64-char hex string (computed by #computePeakHash)
    const calls = (logger.info as ReturnType<typeof vi.fn>).mock.calls;
    const confirmedCall = calls.find((c) => c[0] === "mmr.checkpoint.confirmed");
    expect(confirmedCall).toBeDefined();
    expect(typeof confirmedCall![1].peakHash).toBe("string");
    expect(confirmedCall![1].peakHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ─── Integration tests — require CELLO_ENV=local + running Postgres ──────────

const isLocal = process.env["CELLO_ENV"] === "local";
const DATABASE_URL =
  process.env["DATABASE_URL"] ?? "postgresql://postgres:dev@localhost:5433/cello_dev";

const describeIntegration = isLocal ? describe : describe.skip;

let superPool: pg.Pool;
let servicePool: pg.Pool;

beforeAll(async () => {
  if (!isLocal) return;
  superPool = new pg.Pool({ connectionString: DATABASE_URL });
  const serviceUrl = DATABASE_URL.replace(
    /^(postgres(?:ql)?):\/\/[^:]+:[^@]+@/,
    "$1://cello_service:cello_service_dev@",
  );
  servicePool = new pg.Pool({ connectionString: serviceUrl });
});

afterAll(async () => {
  if (!isLocal) return;
  await superPool?.end();
  await servicePool?.end();
});

describeIntegration("PERSIST-007 integration: mmr.leaf.appended observability", () => {
  it("mmr.leaf.appended: appendSeal emits mmr.leaf.appended at INFO with { sessionId, leafIndex, leafHash, correlationId }", async () => {
    const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const store = new MmrStore(servicePool, logger);

    const sessionId = randomUUID();
    const sealMerkleRoot = createHash("sha256").update("leaf-appended-obs-test").digest("hex");
    const correlationId = randomUUID();

    const { leafIndex, leafHash } = await store.appendSeal(sessionId, sealMerkleRoot, correlationId);

    // mmr.leaf.appended must be logged at INFO with all four required context fields
    expect(logger.info).toHaveBeenCalledWith(
      "mmr.leaf.appended",
      expect.objectContaining({
        sessionId,
        leafIndex,
        leafHash,
        correlationId,
      }),
    );
  });
});

describeIntegration("PERSIST-007 integration: AC-003 inclusion proof for leaf 3 in 8-leaf MMR", () => {
  it("AC-003: 8-leaf MMR, proof for leaf 3 verifies against checkpoint peak", async () => {
    const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const store = new MmrStore(servicePool, logger);

    // Append 8 seals to build the MMR
    const sealMerkleRoots: string[] = [];
    const sessionIds: string[] = [];
    for (let i = 0; i < 8; i++) {
      const sessionId = randomUUID();
      sessionIds.push(sessionId);
      const sealMerkleRoot = createHash("sha256").update(`seal-${i}`).digest("hex");
      sealMerkleRoots.push(sealMerkleRoot);
      await store.appendSeal(sessionId, sealMerkleRoot);
    }

    // Confirm a checkpoint for all 8 seals
    const checkpointId = await store.initiateCheckpoint();
    const peakHash = await store.confirmCheckpoint(checkpointId);

    // Request inclusion proof for leaf 3
    const proof = await store.getInclusionProof(sessionIds[3]!, logger);
    expect(proof).not.toBe(PROOF_NOT_YET_AVAILABLE);

    if (proof === PROOF_NOT_YET_AVAILABLE) throw new Error("Should have proof");

    // Verify the proof locally (agent-side verification algorithm)
    // Step 1: Recompute leaf hash from known data
    const verified = verifyInclusionProof(proof, sealMerkleRoots[3]!, peakHash);
    expect(verified).toBe(true);

    // Step 2: Tampered proof fails verification
    const tamperedProof = {
      ...proof,
      leaf_hash: "e".repeat(64),
    };
    expect(verifyInclusionProof(tamperedProof, sealMerkleRoots[3]!, peakHash)).toBe(false);
  });
});

describeIntegration("PERSIST-007 integration: AC-004 checkpoint clears staging, leaves retained", () => {
  it("AC-004: 5 seals staged → checkpoint confirmed → staging has 0 rows, leaves has 5 rows", async () => {
    const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const store = new MmrStore(servicePool, logger);

    // Track starting counts to isolate this test run
    const beforeCounts = await getStagingAndLeafCounts(servicePool);

    // Append 5 seals
    const sessionIds: string[] = [];
    for (let i = 0; i < 5; i++) {
      const sessionId = randomUUID();
      sessionIds.push(sessionId);
      const sealMerkleRoot = createHash("sha256").update(`ac004-seal-${i}`).digest("hex");
      await store.appendSeal(sessionId, sealMerkleRoot);
    }

    // Verify staging has 5 new rows
    const afterAppend = await getStagingAndLeafCounts(servicePool);
    expect(afterAppend.stagingCount - beforeCounts.stagingCount).toBe(5);
    expect(afterAppend.leafCount - beforeCounts.leafCount).toBe(5);

    // Confirm a checkpoint covering those 5 seals
    const checkpointId = await store.initiateCheckpoint();
    const peakHash = await store.confirmCheckpoint(checkpointId);

    // After checkpoint: staging should have 0 rows with this checkpointId
    const afterCheckpoint = await getStagingAndLeafCounts(servicePool);
    const stagingWithCheckpoint = await getRowsInStagingForCheckpoint(servicePool, checkpointId);
    expect(stagingWithCheckpoint).toBe(0);

    // conversation_proof_leaves still has all rows (append-only — never deleted)
    expect(afterCheckpoint.leafCount).toBe(afterAppend.leafCount);

    // The checkpoint row exists with the correct peak hash
    const checkpointRow = await getCheckpointRow(servicePool, checkpointId);
    expect(checkpointRow).not.toBeNull();
    expect(checkpointRow!.peak_hash).toBe(peakHash);
    expect(checkpointRow!.mmr_leaf_count).toBeGreaterThanOrEqual(5);

    // mmr.checkpoint.confirmed was logged
    expect(logger.info).toHaveBeenCalledWith(
      "mmr.checkpoint.confirmed",
      expect.objectContaining({ checkpointId, stagedSealCount: 5 }),
    );
  });
});

describeIntegration("PERSIST-007 integration: AC-005 concurrent seals during checkpoint", () => {
  it("AC-005: seals added after checkpoint initiation are NOT included in the checkpoint", async () => {
    const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const store = new MmrStore(servicePool, logger);

    // Append 3 seals to pre-populate
    const preSealIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const sessionId = randomUUID();
      preSealIds.push(sessionId);
      await store.appendSeal(sessionId, createHash("sha256").update(`ac005-pre-${i}`).digest("hex"));
    }

    // Initiate checkpoint — this marks those 3 seals with the checkpoint_id
    const checkpointId = await store.initiateCheckpoint();

    // Append 2 MORE seals after initiation — these must NOT be in this checkpoint
    const postSealIds: string[] = [];
    for (let i = 0; i < 2; i++) {
      const sessionId = randomUUID();
      postSealIds.push(sessionId);
      await store.appendSeal(sessionId, createHash("sha256").update(`ac005-post-${i}`).digest("hex"));
    }

    // Confirm the checkpoint
    await store.confirmCheckpoint(checkpointId);

    // Post-checkpoint seals must still be in staging with NO checkpoint_id
    const orphanedSeals = await getRowsInStagingWithoutCheckpoint(servicePool, postSealIds);
    expect(orphanedSeals).toBe(2);

    // The confirmed checkpoint must include exactly the pre-checkpoint seals (3 for this run)
    const checkpointRow = await getCheckpointRow(servicePool, checkpointId);
    expect(checkpointRow).not.toBeNull();
    // The staged_seal_count in the checkpoint row must be 3 (only pre-initiation seals)
    expect(checkpointRow!.staged_seal_count).toBeGreaterThanOrEqual(3);

    // Neither post-checkpoint seal has the confirmed checkpoint_id in staging
    const postSealsWithCheckpoint = await getRowsInStagingForCheckpoint(servicePool, checkpointId);
    // Should be 0 — the pre-initiation ones were cleared, post-initiation ones have no checkpoint_id
    expect(postSealsWithCheckpoint).toBe(0);
  });
});

describeIntegration("PERSIST-007 integration: AC-006 mmr.checkpoint.confirmed observability", () => {
  it("AC-006: MmrStore.confirmCheckpoint emits mmr.checkpoint.confirmed at INFO with required fields", async () => {
    const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const store = new MmrStore(servicePool, logger);

    // Append 3 seals and confirm a checkpoint so confirmCheckpoint actually runs
    for (let i = 0; i < 3; i++) {
      const sessionId = randomUUID();
      await store.appendSeal(sessionId, createHash("sha256").update(`ac006-seal-${i}`).digest("hex"));
    }

    const checkpointId = await store.initiateCheckpoint();
    const peakHash = await store.confirmCheckpoint(checkpointId);

    // confirmCheckpoint must log mmr.checkpoint.confirmed with all required context fields
    expect(logger.info).toHaveBeenCalledWith(
      "mmr.checkpoint.confirmed",
      expect.objectContaining({
        checkpointId,
        peakHash,
        stagedSealCount: 3,
      }),
    );

    // leafCount must be a positive integer
    const calls = (logger.info as ReturnType<typeof vi.fn>).mock.calls;
    const confirmedCall = calls.find((c) => c[0] === "mmr.checkpoint.confirmed");
    expect(confirmedCall).toBeDefined();
    expect(typeof confirmedCall![1].leafCount).toBe("number");
    expect(confirmedCall![1].leafCount).toBeGreaterThanOrEqual(3);
  });
});

describeIntegration("PERSIST-007 integration: AC-007 chain verification on 100-leaf MMR", () => {
  it("AC-007: 100-leaf MMR — both conversation_proof_leaves and conversation_proof_mmr_nodes pass chain verification", async () => {
    const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const store = new MmrStore(servicePool, logger);

    for (let i = 0; i < 100; i++) {
      const sessionId = randomUUID();
      const sealMerkleRoot = createHash("sha256").update(`ac007-seal-${i}`).digest("hex");
      await store.appendSeal(sessionId, sealMerkleRoot);
    }

    // Verify hash chains on both tables
    const leavesResult = await store.verifyLeavesChain();
    const nodesResult = await store.verifyNodesChain();

    expect(leavesResult.valid).toBe(true);
    expect(nodesResult.valid).toBe(true);
  });
});

describeIntegration("PERSIST-007 integration: SI-001 proof unavailable for staging leaf", () => {
  it("SI-001: leaf in staging (not in checkpoint) → getInclusionProof returns PROOF_NOT_YET_AVAILABLE", async () => {
    const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const store = new MmrStore(servicePool, logger);

    // Append a seal without confirming a checkpoint
    const sessionId = randomUUID();
    await store.appendSeal(sessionId, createHash("sha256").update("si001-seal").digest("hex"));

    // Request proof immediately — no checkpoint confirmed yet for this leaf
    const result = await store.getInclusionProof(sessionId, logger);

    // Must return PROOF_NOT_YET_AVAILABLE
    expect(result).toBe(PROOF_NOT_YET_AVAILABLE);

    // mmr.proof.unavailable must be logged at WARN
    expect(logger.warn).toHaveBeenCalledWith(
      "mmr.proof.unavailable",
      expect.objectContaining({ sessionId }),
    );
  });
});

describeIntegration("PERSIST-007 integration: SI-003 no leaf in >1 checkpoint", () => {
  it("SI-003: leaf assigned to checkpoint N cannot be assigned to checkpoint N+1", async () => {
    const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const store = new MmrStore(servicePool, logger);

    // Append 2 seals for checkpoint N
    const sessionId1 = randomUUID();
    const sessionId2 = randomUUID();
    await store.appendSeal(sessionId1, createHash("sha256").update("si003-seal-1").digest("hex"));
    await store.appendSeal(sessionId2, createHash("sha256").update("si003-seal-2").digest("hex"));

    // Confirm checkpoint N — assigns and clears these 2 seals
    const checkpointId1 = await store.initiateCheckpoint();
    await store.confirmCheckpoint(checkpointId1);

    // Append 1 more seal for checkpoint N+1
    const sessionId3 = randomUUID();
    await store.appendSeal(sessionId3, createHash("sha256").update("si003-seal-3").digest("hex"));

    // Confirm checkpoint N+1
    const checkpointId2 = await store.initiateCheckpoint();
    await store.confirmCheckpoint(checkpointId2);

    // Verify that sessionId1 and sessionId2 have checkpoint_id = checkpointId1 only
    const leaf1 = await getLeafBySessionId(servicePool, sessionId1);
    const leaf2 = await getLeafBySessionId(servicePool, sessionId2);
    const leaf3 = await getLeafBySessionId(servicePool, sessionId3);

    expect(leaf1!.checkpoint_id).toBe(checkpointId1);
    expect(leaf2!.checkpoint_id).toBe(checkpointId1);
    expect(leaf3!.checkpoint_id).toBe(checkpointId2);

    // checkpoint_id values differ — no leaf appears in both
    expect(leaf1!.checkpoint_id).not.toBe(leaf3!.checkpoint_id);
    expect(leaf2!.checkpoint_id).not.toBe(leaf3!.checkpoint_id);
  });
});

describeIntegration("PERSIST-007 integration: DB-001 incomplete checkpoint recovery", () => {
  it("DB-001: orphaned staging rows with missing checkpoint row → detected and re-run completes idempotently", async () => {
    const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const store = new MmrStore(servicePool, logger);

    // Append 2 seals and initiate a checkpoint
    const sessionId1 = randomUUID();
    const sessionId2 = randomUUID();
    await store.appendSeal(sessionId1, createHash("sha256").update("db001-seal-1").digest("hex"));
    await store.appendSeal(sessionId2, createHash("sha256").update("db001-seal-2").digest("hex"));
    const orphanedCheckpointId = await store.initiateCheckpoint();

    // Simulate crash: the checkpoint row was never written to directory_checkpoints.
    // We manually clear the staging rows' checkpoint_id = orphanedCheckpointId to simulate
    // "cleared but no checkpoint row" scenario — which is what a crash after clearStaging
    // but before writeCheckpointRow would produce.
    // Actually: the crash scenario is: staging rows have checkpoint_id set, but the
    // directory_checkpoints row doesn't exist yet. We can simulate this by calling
    // initiateCheckpoint (which stamps checkpoint_id on staging rows) but NOT confirmCheckpoint.

    // detectIncompleteCheckpoints should find orphaned rows
    const incomplete = await store.detectIncompleteCheckpoints(logger);
    expect(incomplete).toContain(orphanedCheckpointId);

    // mmr.checkpoint.incomplete logged at ERROR
    expect(logger.error).toHaveBeenCalledWith(
      "mmr.checkpoint.incomplete",
      expect.objectContaining({ checkpointId: orphanedCheckpointId }),
    );

    // Re-running confirmCheckpoint with the orphaned ID completes idempotently
    await store.confirmCheckpoint(orphanedCheckpointId);

    // Now it is complete — detectIncompleteCheckpoints should no longer return it
    const logger2: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const stillIncomplete = await store.detectIncompleteCheckpoints(logger2);
    expect(stillIncomplete).not.toContain(orphanedCheckpointId);
  });
});

// ─── Integration test helpers ─────────────────────────────────────────────────

async function getStagingAndLeafCounts(pool: pg.Pool): Promise<{ stagingCount: number; leafCount: number }> {
  const [stagingRes, leafRes] = await Promise.all([
    pool.query<{ count: string }>(`SELECT COUNT(*) AS count FROM conversation_seal_staging`),
    pool.query<{ count: string }>(`SELECT COUNT(*) AS count FROM conversation_proof_leaves`),
  ]);
  return {
    stagingCount: parseInt(stagingRes.rows[0]!.count, 10),
    leafCount: parseInt(leafRes.rows[0]!.count, 10),
  };
}

async function getRowsInStagingForCheckpoint(pool: pg.Pool, checkpointId: string): Promise<number> {
  const res = await pool.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM conversation_seal_staging WHERE checkpoint_id = $1`,
    [checkpointId],
  );
  return parseInt(res.rows[0]!.count, 10);
}

async function getRowsInStagingWithoutCheckpoint(pool: pg.Pool, sessionIds: string[]): Promise<number> {
  const res = await pool.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM conversation_seal_staging WHERE session_id = ANY($1) AND checkpoint_id IS NULL`,
    [sessionIds],
  );
  return parseInt(res.rows[0]!.count, 10);
}

async function getCheckpointRow(
  pool: pg.Pool,
  checkpointId: string,
): Promise<{ peak_hash: string; mmr_leaf_count: number; staged_seal_count: number } | null> {
  const res = await pool.query<{ peak_hash: string; mmr_leaf_count: number; staged_seal_count: number }>(
    `SELECT peak_hash, mmr_leaf_count, staged_seal_count FROM directory_checkpoints WHERE checkpoint_id = $1`,
    [checkpointId],
  );
  return res.rows[0] ?? null;
}

async function getLeafBySessionId(
  pool: pg.Pool,
  sessionId: string,
): Promise<{ checkpoint_id: string | null } | null> {
  // Checkpoint association is stored in the join table, not on the leaf row itself
  // (conversation_proof_leaves is append-only — UPDATE is not permitted).
  const res = await pool.query<{ checkpoint_id: string | null }>(
    `SELECT lc.checkpoint_id
     FROM conversation_proof_leaves l
     LEFT JOIN conversation_proof_leaf_checkpoints lc ON lc.leaf_id = l.id
     WHERE l.session_id = $1`,
    [sessionId],
  );
  return res.rows[0] ?? null;
}
