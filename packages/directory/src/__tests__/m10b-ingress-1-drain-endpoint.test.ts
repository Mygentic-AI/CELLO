/**
 * M10B / DOD-END-INGRESS-1 — the directory's drain surface.
 *
 * `DOD-END-QUEUE-1` built the mailbox and its repository; nothing exposed it. The portal is a
 * separate process in a separate account and reaches the directory only over `/internal/*`, so
 * without these two routes the queue is a table that fills up and is never read.
 *
 * TWO ROUTES, NOT ONE, and the split is the exactly-once property. Drain READS (it does not delete),
 * so a portal that crashes mid-mint sees the row again on the next pass rather than losing it. The
 * row leaves only when the portal ACKS a terminal outcome — minted, rejected, or poison. Delete-on-
 * read would make every crash a silent data loss, and the loss would be of a submission the operator
 * was told had been queued.
 *
 * These run in-process against a real Postgres (docker-compose), like every other internal-API test.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createInternalApiServer } from "../internal-api-server.js";
import { enqueueSubmission } from "../submission-queue-repository.js";

const describeIntegration = process.env.CELLO_ENV === "local" ? describe : describe.skip;
const noopLogger = { debug() {}, info() {}, warn() {}, error() {} };
const API_KEY = "test-internal-key-ingress-1";

describeIntegration("DOD-END-INGRESS-1 — /internal/submissions", () => {
  let pool: Pool;
  let server: Server;
  let base: string;
  const tag = `ingress1-${Math.floor(Date.now() / 1000)}-${Math.random().toString(16).slice(2, 8)}`;
  const ID = (s: string): string => `${tag}-${s}`;

  const post = (path: string, body: unknown, key: string | null = API_KEY): Promise<Response> =>
    fetch(`${base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(key ? { "x-cello-internal-api-key": key } : {}) },
      body: JSON.stringify(body),
    });

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL || "postgresql://postgres:dev@localhost:5433/cello_dev" });
    server = createInternalApiServer({ pool, internalApiKey: API_KEY, logger: noopLogger, owningNodeId: "ingress-test-node" });
    await new Promise<void>((r) => server.listen(0, () => r()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    if (server) await new Promise<void>((r) => server.close(() => r()));
    await pool.query("DELETE FROM submission_queue WHERE submission_id LIKE $1", [`${tag}-%`]).catch(() => {});
    await pool.end();
  });

  it("REFUSES an unauthenticated drain — the queue is not world-readable", async () => {
    // The ciphertext is opaque, but the SET of queued ids and their intake key ids is still traffic
    // analysis: who is submitting, how often, and to which key generation.
    expect((await post("/internal/submissions/drain", {}, null)).status).toBe(401);
    expect((await post("/internal/submissions/ack", { submission_id: ID("x") }, "wrong")).status).toBe(401);
  });

  it("drains oldest-first and returns the sealed blob as hex", async () => {
    await enqueueSubmission(pool, { submissionId: ID("a"), intakeKeyId: "intake-1", ciphertext: Buffer.from([1, 2, 3]) });
    await enqueueSubmission(pool, { submissionId: ID("b"), intakeKeyId: "intake-1", ciphertext: Buffer.from([4, 5, 6]) });

    const res = await post("/internal/submissions/drain", { limit: 50 });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { submissions: Array<{ submission_id: string; intake_key_id: string; ciphertext: string }> };
    const mine = body.submissions.filter((s) => s.submission_id.startsWith(tag));
    expect(mine.map((s) => s.submission_id)).toEqual([ID("a"), ID("b")]);
    // Hex, because JSON has no bytes. The portal seals/opens with bytes, so the encoding must be
    // lossless and unambiguous — base64 would be too, but hex matches every other blob on this API.
    expect(mine[0].ciphertext).toBe("010203");
    expect(mine[0].intake_key_id).toBe("intake-1");
  });

  it("DRAIN DOES NOT DELETE — a portal that crashes mid-mint sees the row again", async () => {
    // The exactly-once property lives here. If drain deleted, a crash between reading and minting
    // would lose a submission the operator was told was queued, silently and permanently.
    const first = (await (await post("/internal/submissions/drain", {})).json()) as { submissions: Array<{ submission_id: string }> };
    const second = (await (await post("/internal/submissions/drain", {})).json()) as { submissions: Array<{ submission_id: string }> };
    const inFirst = first.submissions.filter((s) => s.submission_id.startsWith(tag)).map((s) => s.submission_id);
    const inSecond = second.submissions.filter((s) => s.submission_id.startsWith(tag)).map((s) => s.submission_id);
    expect(inFirst.length).toBeGreaterThan(0);
    expect(inSecond).toEqual(inFirst);
  });

  it("ACK removes the row, and is idempotent", async () => {
    expect((await post("/internal/submissions/ack", { submission_id: ID("a") })).status).toBe(200);
    const after = (await (await post("/internal/submissions/drain", {})).json()) as { submissions: Array<{ submission_id: string }> };
    expect(after.submissions.map((s) => s.submission_id)).not.toContain(ID("a"));
    // Idempotent: the portal may ack a row it already acked after a retry, and that must not error.
    // 200 with removed:false — the outcome the caller wanted is true either way.
    const again = await post("/internal/submissions/ack", { submission_id: ID("a") });
    expect(again.status).toBe(200);
    expect((await again.json()) as { removed: boolean }).toEqual({ removed: false });
  });

  it("REFUSES a malformed ack rather than silently doing nothing", async () => {
    // A missing/!string submission_id that returned 200 would let a broken portal believe it was
    // acking rows forever while the queue grew without bound.
    const res = await post("/internal/submissions/ack", {});
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("malformed_request");
  });

  it("clamps an absurd drain limit instead of letting a caller ask for everything", async () => {
    const res = await post("/internal/submissions/drain", { limit: 10_000_000 });
    expect(res.status).toBe(200);
    // Not an error — a large limit is a reasonable thing to ask for, it just must not become an
    // unbounded read that pins the database or the portal's memory.
    const body = (await res.json()) as { submissions: unknown[]; limit: number };
    expect(body.limit).toBeLessThanOrEqual(500);
  });
});
