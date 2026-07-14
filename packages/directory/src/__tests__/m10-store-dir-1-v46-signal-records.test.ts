/**
 * M10 / DOD-STORE-DIR-1 — V46 signal_records migration integration gate.
 *
 * Verifies (against a database with ALL prior migrations already applied — docker-compose flyway):
 *   - V46 is present in flyway_schema_history and NO migration V1..V46 has a checksum/apply failure.
 *   - cello_service can INSERT / SELECT / UPDATE signal_records, and CANNOT DELETE it (a notary
 *     ledger is append-and-amend: revoked or superseded, never erased).
 *   - `type` is an OPAQUE STRING — a type string this directory has never seen INSERTs fine, and
 *     there is NO CHECK constraint and NO index predicated on a type value (DOD-INV-ZERO-BUMP).
 *     This is the whole architectural claim of M10, asserted at the schema level.
 *   - status/subject_kind/issuer_kind ARE constrained (they are protocol-level, not per-type).
 *   - the table holds NO envelope content — no payload column, no PII (DOD-INV-DIR-DUMB).
 *   - supersession links records; revocation stamps revoked_at.
 *
 * Gated on CELLO_ENV=local (Docker Postgres). Run: docker compose up -d && docker compose run --rm
 * flyway migrate, then CELLO_ENV=local vitest run this file.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool, type PoolClient } from "pg";

const describeIntegration = process.env.CELLO_ENV === "local" ? describe : describe.skip;

describeIntegration("V46 signal_records migration (DOD-STORE-DIR-1)", () => {
  let pool: Pool;
  const tag = `v46test-${Math.floor(Date.now() / 1000)}-${Math.random().toString(16).slice(2, 8)}`;
  const H = (s: string): string => `${tag}-${s}`.padEnd(64, "0").slice(0, 64);

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

  /** A whole record. `type` is opaque at every layer below. */
  const record = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    signal_hash: H("a"),
    subject_kind: "agent",
    subject: `${tag}-agent-1`,
    issuer_kind: "portal",
    issuer_pubkey: "aabb",
    type: "phone",
    status: "active",
    accepting_node: "us-east-1",
    scanner_version: "scan-v1",
    ...over,
  });

  const insert = (c: PoolClient, r: Record<string, unknown>): Promise<unknown> =>
    c.query(
      `INSERT INTO signal_records
         (signal_hash, subject_kind, subject, issuer_kind, issuer_pubkey, type, status,
          accepting_node, scanner_version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [r.signal_hash, r.subject_kind, r.subject, r.issuer_kind, r.issuer_pubkey, r.type, r.status,
       r.accepting_node, r.scanner_version],
    );

  beforeAll(() => {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL || "postgresql://postgres:dev@localhost:5433/cello_dev",
    });
  });

  afterAll(async () => {
    if (pool) {
      await pool.query("RESET ROLE").catch(() => {});
      await pool.query("DELETE FROM signal_records WHERE subject LIKE $1", [`${tag}%`]).catch(() => {});
      await pool.end();
    }
  });

  describe("migration integrity", () => {
    it("V46 applied, and NO prior migration has a checksum or apply failure", async () => {
      const { rows } = await pool.query(
        "SELECT version, success FROM flyway_schema_history WHERE version IS NOT NULL ORDER BY installed_rank",
      );
      const failed = rows.filter((r: { success: boolean }) => !r.success);
      expect(failed, "a failed/checksum-mismatched migration — never modify an applied migration").toEqual([]);
      expect(rows.map((r: { version: string }) => r.version)).toContain("46");
    });
  });

  describe("DOD-INV-ZERO-BUMP — `type` is an opaque string at the schema level", () => {
    it("accepts a type string this directory has NEVER seen, with no code change and no deploy", async () => {
      // The milestone's entire architectural claim, asserted where it would actually break. If a
      // future hand adds CHECK (type IN (...)), this fails — and it fails HERE, at the schema, rather
      // than three hops away as a mysterious mint error the day the portal invents a type.
      await asCelloService(async (c) => {
        await insert(c, record({ signal_hash: H("z"), type: "some_type_invented_next_year" }));
        const { rows } = await c.query("SELECT type FROM signal_records WHERE signal_hash = $1", [H("z")]);
        expect(rows[0].type).toBe("some_type_invented_next_year");
      });
    });

    it("has NO CHECK constraint on `type` and NO index predicated on a type VALUE", async () => {
      const { rows: checks } = await pool.query(
        `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
          WHERE conrelid = 'signal_records'::regclass AND contype = 'c'`,
      );
      const typeChecks = checks
        .map((r: { def: string }) => r.def)
        .filter((d: string) => /\btype\b/i.test(d));
      expect(typeChecks, "a CHECK on `type` is a per-type construct — it breaks zero-bump").toEqual([]);

      const { rows: idx } = await pool.query(
        "SELECT indexdef FROM pg_indexes WHERE tablename = 'signal_records'",
      );
      const typeIdx = idx
        .map((r: { indexdef: string }) => r.indexdef)
        .filter((d: string) => /WHERE.*\btype\b/i.test(d));
      expect(typeIdx, "an index predicated on a type VALUE is a per-type construct").toEqual([]);
    });

    it("but status / subject_kind / issuer_kind ARE constrained — those are protocol-level, not per-type", async () => {
      // The distinction that makes zero-bump coherent rather than an excuse for an unconstrained
      // schema: the KIND fields are fixed by the protocol and adding a signal type touches none of
      // them; `type` is the only open axis.
      const { rows } = await pool.query(
        `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
          WHERE conrelid = 'signal_records'::regclass AND contype = 'c'`,
      );
      const defs = rows.map((r: { def: string }) => r.def).join(" ");
      expect(defs).toMatch(/status/);
      expect(defs).toMatch(/subject_kind/);
      expect(defs).toMatch(/issuer_kind/);

      await asCelloService(async (c) => {
        await expect(insert(c, record({ signal_hash: H("bad"), status: "totally-made-up" })))
          .rejects.toThrow(/violates check constraint/i);
      });
    });
  });

  describe("DOD-INV-DIR-DUMB — the directory holds hashes, never content", () => {
    it("has NO payload column and no PII-shaped column", async () => {
      // A directory that held envelope content could read every operator's phone number and email
      // domain. One that holds only hashes cannot, even if fully compromised. The convenient column
      // must stay absent.
      const { rows } = await pool.query(
        "SELECT column_name FROM information_schema.columns WHERE table_name = 'signal_records'",
      );
      const cols = rows.map((r: { column_name: string }) => r.column_name);
      for (const forbidden of ["payload", "envelope", "content", "blob", "ciphertext",
                               "phone", "email", "claim", "value"]) {
        expect(cols, `signal_records must not carry '${forbidden}'`).not.toContain(forbidden);
      }
      expect(cols).toContain("signal_hash");
    });
  });

  describe("the notary ledger is append-and-amend", () => {
    it("cello_service can INSERT, SELECT and UPDATE", async () => {
      await asCelloService(async (c) => {
        await insert(c, record({ signal_hash: H("b") }));
        await c.query("UPDATE signal_records SET status = 'revoked', revoked_at = now() WHERE signal_hash = $1", [H("b")]);
        const { rows } = await c.query("SELECT status, revoked_at FROM signal_records WHERE signal_hash = $1", [H("b")]);
        expect(rows[0].status).toBe("revoked");
        expect(rows[0].revoked_at).not.toBeNull();
      });
    });

    it("cello_service CANNOT DELETE — a revoked signal is amended, never erased", async () => {
      // Otherwise "never notarized here" and "notarized, then quietly removed" become
      // indistinguishable, and the record stops being evidence.
      await asCelloService(async (c) => {
        await insert(c, record({ signal_hash: H("c") }));
        await expect(c.query("DELETE FROM signal_records WHERE signal_hash = $1", [H("c")]))
          .rejects.toThrow(/permission denied/i);
      });
    });

    it("supersession LINKS records rather than overwriting one", async () => {
      await asCelloService(async (c) => {
        await insert(c, record({ signal_hash: H("old") }));
        await insert(c, record({ signal_hash: H("new") }));
        await c.query(
          "UPDATE signal_records SET status = 'superseded', superseded_by = $2 WHERE signal_hash = $1",
          [H("old"), H("new")],
        );
        const { rows } = await c.query(
          "SELECT status, superseded_by FROM signal_records WHERE signal_hash = $1", [H("old")],
        );
        expect(rows[0].status).toBe("superseded");
        expect(rows[0].superseded_by).toBe(H("new"));
        // The superseded record still EXISTS — a counterparty holding a stale copy must be able to
        // learn that it is stale, which requires the old hash to still resolve here.
        const { rows: still } = await c.query("SELECT 1 FROM signal_records WHERE signal_hash = $1", [H("old")]);
        expect(still).toHaveLength(1);
      });
    });

    it("re-submitting the same hash conflicts — idempotence is by content-address, not a dedup rule", async () => {
      await asCelloService(async (c) => {
        await insert(c, record({ signal_hash: H("dup") }));
        await expect(insert(c, record({ signal_hash: H("dup") })))
          .rejects.toThrow(/duplicate key|unique/i);
      });
    });
  });
});
