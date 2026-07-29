/**
 * M10B / DOD-END-QUEUE-1 — V51 submission_queue migration integration gate.
 *
 * The directory's half of the client-supplied ingress is a MAILBOX IT CANNOT READ, and almost every
 * assertion here is about something the schema must NOT have. Mirrors the V46 posture test.
 *
 * Verifies (against a database with all prior migrations applied — docker-compose flyway):
 *   - the column set EXACTLY (not an absence list — see below).
 *   - no column can carry a submitter, a subject, a signal kind, a type, or plaintext.
 *   - a retry of the same body is a STRICT no-op: the stored ciphertext is never replaced.
 *   - drain is oldest-first; delete is idempotent; sweep only takes aged rows.
 *   - `submission_queue` is ABSENT from the replication publication list (M10B-D21).
 *
 * WHY THE COLUMN SET IS ASSERTED EXACTLY. An "these named columns are absent" test passes trivially
 * against a column called `meta` or `ctx` holding the same data. Asserting the whole set means the
 * next person to add `submitter_agent_id` for debugging has to argue with this test first — which is
 * the entire privacy property of DOD-END-DISCOVER-1, made mechanical.
 *
 * Gated on CELLO_ENV=local (Docker Postgres). Run: docker compose up -d && docker compose run --rm
 * flyway migrate, then CELLO_ENV=local vitest run this file.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool, type PoolClient } from "pg";
import {
  enqueueSubmission,
  drainSubmissions,
  deleteSubmission,
  sweepStaleSubmissions,
  intakeKeyIdsInUse,
} from "../submission-queue-repository.js";

const describeIntegration = process.env.CELLO_ENV === "local" ? describe : describe.skip;

describeIntegration("V51 submission_queue (DOD-END-QUEUE-1)", () => {
  let pool: Pool;
  const tag = `v51test-${Math.floor(Date.now() / 1000)}-${Math.random().toString(16).slice(2, 8)}`;
  const ID = (s: string): string => `${tag}-${s}`;

  async function asCelloService<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await pool.connect();
    try {
      await c.query("SET ROLE cello_service");
      return await fn(c);
    } finally {
      await c.query("RESET ROLE").catch(() => {});
      c.release();
    }
  }

  beforeAll(() => {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL || "postgresql://postgres:dev@localhost:5433/cello_dev",
    });
  });

  afterAll(async () => {
    if (pool) {
      await pool.query("RESET ROLE").catch(() => {});
      await pool.query("DELETE FROM submission_queue WHERE submission_id LIKE $1", [`${tag}%`]).catch(() => {});
      await pool.end();
    }
  });

  describe("the schema knows nothing about what it holds (INV-DIR-DUMB)", () => {
    it("has EXACTLY the four intended columns and no others", async () => {
      const { rows } = await pool.query(
        "SELECT column_name FROM information_schema.columns WHERE table_name = 'submission_queue'",
      );
      const cols = (rows as Array<{ column_name: string }>).map((r) => r.column_name).sort();
      expect(cols).toEqual(["ciphertext", "created_at", "intake_key_id", "submission_id"].sort());
    });

    it("carries no submitter, subject, kind, type or plaintext column under ANY name", async () => {
      // A second, independent guard on the same property: even if the set above were loosened, no
      // column may be NAMED for the things that would re-create the endorsement pairing. Both are
      // needed — the set catches `meta`, this catches a set someone widened "just for one field".
      const { rows } = await pool.query(
        "SELECT column_name FROM information_schema.columns WHERE table_name = 'submission_queue'",
      );
      const cols = (rows as Array<{ column_name: string }>).map((r) => r.column_name);
      for (const forbidden of ["agent_id", "submitter", "subject", "signal_kind", "type", "payload", "plaintext", "reason"]) {
        expect(cols).not.toContain(forbidden);
      }
    });

    it("is ABSENT from the replication publication list (M10B-D21)", () => {
      // The queue is deliberately unreplicated: a replicated queue lets the portal drain the same row
      // from a second node while its ack to the first is in flight — double-drain, double-mint.
      // Nothing in Postgres enforces the exclusion; the mechanism is this shell variable, so this is
      // the only place it can be asserted. Asserting the table EXISTS as well keeps the test honest —
      // otherwise it would pass before the table was ever created.
      const script = readFileSync(join(__dirname, "../../../../infra/setup-replication.sh"), "utf8");
      const line = script.split("\n").find((l) => l.startsWith("PUBLICATION_TABLES="));
      expect(line).toBeDefined();
      const tables = line!.replace(/^PUBLICATION_TABLES="/, "").replace(/"$/, "").split(",");
      expect(tables).toContain("signal_records"); // control: the list parsed correctly
      expect(tables).not.toContain("submission_queue");
    });

    it("cello_service CANNOT UPDATE a queued submission", async () => {
      // A queued submission is write-once-then-delete. Nothing in the system updates one, and the
      // absence of the grant is what makes "the first writer of an id wins" enforceable at the DB
      // rather than merely intended by `ON CONFLICT DO NOTHING` — an UPDATE grant would let a caller
      // swap the ciphertext under an id someone else chose, and the directory cannot open either blob
      // to notice. Discovered by this suite: the first draft of the sweep test tried to UPDATE as
      // cello_service and was correctly refused.
      await asCelloService(async (c) => {
        await enqueueSubmission(c, { submissionId: ID("nomod"), intakeKeyId: "key-1", ciphertext: Buffer.from([0x07]) });
        await expect(
          c.query("UPDATE submission_queue SET ciphertext = $1 WHERE submission_id = $2", [Buffer.from([0xff]), ID("nomod")]),
        ).rejects.toThrow(/permission denied/i);
      });
    });
  });

  describe("enqueue is idempotent on the content-derived id", () => {
    it("a retry of the same body is a STRICT no-op and never replaces the ciphertext", async () => {
      await asCelloService(async (c) => {
        await enqueueSubmission(c, { submissionId: ID("a"), intakeKeyId: "key-1", ciphertext: Buffer.from([0x01]) });
        // Same id, DIFFERENT bytes — the case that matters. DO UPDATE here would let a later writer
        // swap the payload under an id someone else chose, and the directory cannot open either blob
        // to notice.
        await enqueueSubmission(c, { submissionId: ID("a"), intakeKeyId: "key-9", ciphertext: Buffer.from([0xde, 0xad]) });
        const { rows } = await c.query(
          "SELECT encode(ciphertext,'hex') AS hex, intake_key_id FROM submission_queue WHERE submission_id = $1",
          [ID("a")],
        );
        expect(rows).toHaveLength(1);
        expect(rows[0].hex).toBe("01");
        expect(rows[0].intake_key_id).toBe("key-1");
      });
    });
  });

  describe("drain, delete, sweep", () => {
    it("drains oldest-first and reports the intake keys still in use", async () => {
      await asCelloService(async (c) => {
        await enqueueSubmission(c, { submissionId: ID("b"), intakeKeyId: "key-1", ciphertext: Buffer.from([0x02]) });
        await enqueueSubmission(c, { submissionId: ID("c"), intakeKeyId: "key-2", ciphertext: Buffer.from([0x03]) });
        const drained = (await drainSubmissions(c, 500)).filter((s) => s.submissionId.startsWith(tag));
        const ids = drained.map((s) => s.submissionId);
        expect(ids.indexOf(ID("b"))).toBeLessThan(ids.indexOf(ID("c")));
        expect(drained.find((s) => s.submissionId === ID("c"))!.intakeKeyId).toBe("key-2");

        // Rotation retention (M10B-D11) is driven by THIS, not a timer.
        const keys = await intakeKeyIdsInUse(c);
        expect(keys).toEqual(expect.arrayContaining(["key-1", "key-2"]));
      });
    });

    it("delete removes exactly one row and is idempotent", async () => {
      await asCelloService(async (c) => {
        await enqueueSubmission(c, { submissionId: ID("d"), intakeKeyId: "key-1", ciphertext: Buffer.from([0x04]) });
        expect(await deleteSubmission(c, ID("d"))).toBe(true);
        expect(await deleteSubmission(c, ID("d"))).toBe(false);
      });
    });

    it("sweep takes aged rows and leaves fresh ones", async () => {
      await asCelloService(async (c) => {
        await enqueueSubmission(c, { submissionId: ID("old"), intakeKeyId: "key-1", ciphertext: Buffer.from([0x05]) });
        await enqueueSubmission(c, { submissionId: ID("new"), intakeKeyId: "key-1", ciphertext: Buffer.from([0x06]) });
      });
      // Age the row as the OWNER, not as cello_service — the service role deliberately has no UPDATE
      // grant here (see the posture test below). This is a fixture concern, not a production path:
      // nothing in the system ever updates a queued submission.
      await pool.query("UPDATE submission_queue SET created_at = now() - interval '48 hours' WHERE submission_id = $1", [ID("old")]);
      await asCelloService(async (c) => {
        const swept = await sweepStaleSubmissions(c, 24);
        expect(swept).toBeGreaterThanOrEqual(1);
        const { rows } = await c.query("SELECT submission_id FROM submission_queue WHERE submission_id IN ($1,$2)", [ID("old"), ID("new")]);
        expect(rows.map((r: { submission_id: string }) => r.submission_id)).toEqual([ID("new")]);
      });
    });
  });
});
