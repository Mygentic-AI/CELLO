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
    supersedes_hash: null,
    status: "active",
    accepting_node: "us-east-1",
    scanner_version: "scan-v1",
    ...over,
  });

  const insert = (c: PoolClient, r: Record<string, unknown>): Promise<unknown> =>
    c.query(
      `INSERT INTO signal_records
         (signal_hash, accepting_node, subject_kind, subject, issuer_kind, issuer_pubkey, type,
          supersedes_hash, status, scanner_version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [r.signal_hash, r.accepting_node, r.subject_kind, r.subject, r.issuer_kind, r.issuer_pubkey,
       r.type, r.supersedes_hash ?? null, r.status, r.scanner_version],
    );

  /** The AUTHORITATIVE status read — never a bare `status` column (see V46's header). */
  const effective = async (c: PoolClient, h: string): Promise<string | undefined> => {
    const { rows } = await c.query(
      "SELECT effective_status FROM signal_records_effective WHERE signal_hash = $1", [h]);
    return rows[0]?.effective_status;
  };

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
    it("holds EXACTLY the known columns — an ALLOWLIST, so any new column must be justified", async () => {
      // This was a denylist of nine names ("payload", "envelope", ...) and it was HOLLOW: a column
      // called `envelope_bytes`, `body`, `plaintext` or `raw` passed every assertion. The invariant is
      // "this table holds only hashes and metadata" — an ALLOWLIST property. Stating it as a denylist
      // inverted it (the project's own rule: allowlist in prose, denylist in code — and this is the
      // code side, where the wire names must be pinned exactly).
      //
      // Now the column set is asserted EXACTLY. Any new column — whatever it is named, however
      // innocuous — goes red here and has to be justified against DOD-INV-DIR-DUMB. That is the point:
      // the next person to add `payload_preview TEXT` for debugging must argue with this test first.
      const { rows } = await pool.query(
        "SELECT column_name FROM information_schema.columns WHERE table_name = 'signal_records'",
      );
      const cols = (rows as Array<{ column_name: string }>).map((r) => r.column_name).sort();
      expect(cols).toEqual([
        "accepting_node", "created_at", "is_tombstone", "issuer_kind", "issuer_pubkey", "revoked_at",
        "scanner_version", "signal_hash", "status", "subject", "subject_kind",
        "supersedes_hash", "type",
      ].sort());
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

    it("supersession is DERIVED from the superseding row's existence — no UPDATE required", async () => {
      // The failure this design avoids: a replicated UPDATE that reaches a node BEFORE the row it
      // targets is SILENTLY SKIPPED by the apply worker (no error, no retry), so that node would serve
      // a superseded signal as live forever. Supersession therefore rides on the NEW record's own
      // INSERT, via the hashed `supersedes_hash` field — and an INSERT cannot be lost the way an
      // UPDATE can.
      await asCelloService(async (c) => {
        await insert(c, record({ signal_hash: H("old") }));
        expect(await effective(c, H("old"))).toBe("active");

        // Nothing but the new record's INSERT. No UPDATE of the old row at all.
        await insert(c, record({ signal_hash: H("new"), supersedes_hash: H("old") }));

        expect(await effective(c, H("old"))).toBe("superseded");
        expect(await effective(c, H("new"))).toBe("active");
        // The superseded record still EXISTS — a counterparty holding a stale copy has to be able to
        // learn that it is stale, which requires the old hash to keep resolving.
        const { rows } = await c.query("SELECT 1 FROM signal_records WHERE signal_hash = $1", [H("old")]);
        expect(rows).toHaveLength(1);
      });
    });

    it("a REVOKED replacement supersedes nothing", async () => {
      await asCelloService(async (c) => {
        await insert(c, record({ signal_hash: H("o2") }));
        await insert(c, record({ signal_hash: H("n2"), supersedes_hash: H("o2"), status: "revoked" }));
        // If the replacement is itself revoked it cannot displace the original, or revoking a
        // re-mint would silently kill the signal it replaced.
        expect(await effective(c, H("o2"))).toBe("active");
      });
    });

    it("REVOCATION BEATS SUPERSESSION — the stronger statement wins", async () => {
      await asCelloService(async (c) => {
        await insert(c, record({ signal_hash: H("o3") }));
        await insert(c, record({ signal_hash: H("n3"), supersedes_hash: H("o3") }));
        expect(await effective(c, H("o3"))).toBe("superseded");
        await c.query("UPDATE signal_records SET status='revoked', revoked_at=now() WHERE signal_hash=$1", [H("o3")]);
        // A revoked signal that is also superseded is REVOKED. Supersession must not soften it.
        expect(await effective(c, H("o3"))).toBe("revoked");
      });
    });
  });

  describe("MULTI-MASTER SAFETY — the trap that would wedge federation (M10-D20)", () => {
    it("TWO NODES may notarize the SAME hash without colliding", async () => {
      // THE BUG THIS PREVENTS, and it is not exotic — it rides the DESIGNED path. The portal reaches
      // the directory through an ordered failover list (M10-D11). Submit hash H to us-east-1; the row
      // lands; the RESPONSE IS LOST; the portal dutifully fails over and re-submits to eu-central-1,
      // which has not yet received H and inserts its own row. Both replicate.
      //
      // With `signal_hash` as a lone PRIMARY KEY, each node's INSERT is unapplicable at the other:
      // the apply worker (which DOES enforce PK/UNIQUE — measured) errors, retries forever, and THE
      // WHOLE SUBSCRIPTION STOPS. All 20 published tables. Seals, profiles, presence, registrations —
      // federation down, because a request timed out.
      //
      // PK is therefore (signal_hash, accepting_node). Safe because the record is CONTENT-ADDRESSED:
      // every hashed field is derived from the envelope, so two rows sharing a hash necessarily agree
      // on all of them. They differ only in provenance.
      await asCelloService(async (c) => {
        await insert(c, record({ signal_hash: H("mm"), accepting_node: "us-east-1" }));
        await insert(c, record({ signal_hash: H("mm"), accepting_node: "eu-central-1" }));

        const { rows } = await c.query("SELECT COUNT(*) AS n FROM signal_records WHERE signal_hash = $1", [H("mm")]);
        expect(Number(rows[0].n)).toBe(2);
        // ...and the READ dedupes them back to one signal.
        const { rows: eff } = await c.query(
          "SELECT signal_hash, notarized_by, effective_status FROM signal_records_effective WHERE signal_hash = $1",
          [H("mm")],
        );
        expect(eff).toHaveLength(1);
        expect(eff[0].notarized_by.sort()).toEqual(["eu-central-1", "us-east-1"]);
        expect(eff[0].effective_status).toBe("active");
      });
    });

    it("the SAME node cannot notarize the same hash twice — idempotence is still enforced", async () => {
      // The composite PK must not weaken same-node idempotence: a retry against the SAME node is a
      // duplicate and must conflict, so the write path can treat it as a no-op.
      await asCelloService(async (c) => {
        await insert(c, record({ signal_hash: H("dup"), accepting_node: "us-east-1" }));
        await expect(insert(c, record({ signal_hash: H("dup"), accepting_node: "us-east-1" })))
          .rejects.toThrow(/duplicate key|unique/i);
      });
    });

    it("a revocation TOMBSTONE from ANY node revokes the signal everywhere (convergent)", async () => {
      // The other half of the same problem: a revoke that arrives at a node BEFORE the row it targets
      // would UPDATE zero rows and be lost. So a node lacking the row inserts a revoked row instead —
      // and `revoked` from ANY copy wins, so the answer converges regardless of arrival order.
      await asCelloService(async (c) => {
        await insert(c, record({ signal_hash: H("rv"), accepting_node: "us-east-1" }));
        expect(await effective(c, H("rv"))).toBe("active");
        await insert(c, record({ signal_hash: H("rv"), accepting_node: "ap-northeast-1", status: "revoked" }));
        expect(await effective(c, H("rv"))).toBe("revoked");
      });
    });
  });

  describe("authorized_issuers — the chokepoint's key set (determination §3.2)", () => {
    it("exists, and is EMPTY — an unseeded directory notarizes NOTHING rather than falling open", async () => {
      // ABSENT IS NOT FINE. A placeholder key here would look configured while authorizing nobody;
      // no key at all means every submission is refused, which is the correct failure.
      const { rows } = await pool.query("SELECT COUNT(*) AS n FROM authorized_issuers");
      expect(Number(rows[0].n)).toBe(0);
    });

    it("cello_service can READ the set but NOT add to it", async () => {
      // The write path is checked AGAINST this set; it must never be able to add to the set it is
      // checked against, or a compromised directory process could authorize itself.
      await asCelloService(async (c) => {
        await expect(c.query("SELECT * FROM authorized_issuers")).resolves.toBeTruthy();
        await expect(
          c.query("INSERT INTO authorized_issuers (pubkey, role) VALUES ('deadbeef','submitter')"),
        ).rejects.toThrow(/permission denied/i);
      });
    });

    it("constrains role and status — these are protocol enumerations, not an open axis", async () => {
      await pool.query("INSERT INTO authorized_issuers (pubkey, role, label) VALUES ($1,'submitter','t')", [`k-${tag}`]);
      await expect(
        pool.query("INSERT INTO authorized_issuers (pubkey, role) VALUES ($1,'god-mode')", [`k2-${tag}`]),
      ).rejects.toThrow(/violates check constraint/i);
      await pool.query("DELETE FROM authorized_issuers WHERE pubkey LIKE $1", [`k%-${tag}`]);
    });
  });
});
