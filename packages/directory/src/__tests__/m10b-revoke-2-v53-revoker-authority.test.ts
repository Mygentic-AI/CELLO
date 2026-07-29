/**
 * M10B / DOD-END-REVOKE-2 — revocation AUTHORITY (V53, M10B-D12r4).
 *
 * The defect being closed (M10 DOD-REVOKE-1 review F6, deferred with "revisit with intake"): revoke
 * authorises on the generic `submitter` role and writes a tombstone that never reads its target, so
 * the moment a person can issue an endorsement, ONE submitter key can tombstone ANYONE's.
 *
 * WHY THESE SHAPES, AND WHY ALL OF THEM. Four consecutive versions of this expression were wrong,
 * and every one of them read correctly in prose — NULL aggregates falling through a CASE,
 * `{NULL} && {'x'}` being false, a legacy row judged by a rule younger than itself, a "fix" that was
 * a no-op because it supplemented the branch it needed to replace. None were visible by inspection;
 * all were seconds of work to expose by running them. So this file pins the whole truth table, and
 * each case names the specific way its branch failed when it was missing.
 *
 * The property under test: EXACTLY ONE shape changes from V46's behavior, and it is the defect.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Pool } from "pg";

const describeIntegration = process.env.CELLO_ENV === "local" ? describe : describe.skip;

describeIntegration("DOD-END-REVOKE-2 / V53 — revoker authority in signal_records_effective", () => {
  let pool: Pool;

  beforeAll(() => {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL || "postgresql://postgres:dev@localhost:5433/cello_dev",
    });
  });
  afterAll(async () => { await pool.end(); });
  beforeEach(async () => { await pool.query("DELETE FROM signal_records"); });

  /** One row. `is_tombstone` + `revoker_pubkey` are what this unit is about; the rest is scaffolding. */
  const row = async (o: {
    hash: string; node: string; issuerKind: string; issuerPubkey: string;
    status?: string; supersedes?: string | null; tombstone?: boolean; revoker?: string | null;
  }) => {
    await pool.query(
      `INSERT INTO signal_records
         (signal_hash, accepting_node, subject_kind, subject, issuer_kind, issuer_pubkey, type,
          status, supersedes_hash, is_tombstone, revoker_pubkey, scanner_version)
       VALUES ($1,$2,'agent','subj',$3,$4,'endorsement',$5,$6,$7,$8,'test-v0')`,
      [o.hash, o.node, o.issuerKind, o.issuerPubkey, o.status ?? "active",
       o.supersedes ?? null, o.tombstone ?? false, o.revoker ?? null],
    );
  };
  const record = (hash: string, node = "n1", issuerPubkey = "bobkey", issuerKind = "agent") =>
    row({ hash, node, issuerKind, issuerPubkey });
  const tombstone = (hash: string, revoker: string | null, node = "n2") =>
    row({ hash, node, issuerKind: "portal", issuerPubkey: "(tombstone)", status: "revoked", tombstone: true, revoker });

  const statusOf = async (hash: string): Promise<string | undefined> => {
    const { rows } = await pool.query(
      "SELECT effective_status FROM signal_records_effective WHERE signal_hash = $1", [hash],
    );
    return (rows[0] as { effective_status: string } | undefined)?.effective_status;
  };

  it("THE FIX: a tombstone whose revoker is NOT the issuer is INERT (F6)", async () => {
    // The defect, and the ONLY shape whose verdict changes. Mallory holds a submitter-role key and
    // tombstones Bob's endorsement; before V53 that killed it. An unauthorised tombstone is INERT
    // rather than REJECTED, which is what keeps arrival order free — the write path stays blind.
    await record("h4");
    await tombstone("h4", "mallorykey");
    expect(await statusOf("h4")).toBe("active");
  });

  it("an AUTHORIZED agent withdrawal still revokes", async () => {
    // The other side of the same branch. Without it the fix would be indistinguishable from
    // "revocation no longer works for agents", which is not a fix.
    await record("h3");
    await tombstone("h3", "bobkey");
    expect(await statusOf("h3")).toBe("revoked");
  });

  it("a TOMBSTONE-ONLY hash reads revoked — fail-closed, and it converges deny → allow", async () => {
    // Branch 1. The revoke may arrive BEFORE its record under mesh replication; with no record to
    // judge against, the tombstone stands. Without this the directory would confirm as LIVE a hash
    // it has only ever seen a revocation for. An earlier version of this expression returned
    // `active` here — `ARRAY_AGG … FILTER` over zero rows is NULL, not '{}', and a NULL WHEN falls
    // through to ELSE.
    await tombstone("h1", "bobkey", "n1");
    expect(await statusOf("h1")).toBe("revoked");
  });

  it("a LEGACY tombstone (NULL revoker) keeps its OLD role-based semantics", async () => {
    // Branch 2, and the migration-safety property: every tombstone written before V53 has
    // revoker_pubkey NULL. Omit this branch and the migration SILENTLY UN-REVOKES every existing
    // revocation — `{NULL} && {'bobkey'}` is false. Unreachable for agent-issued records today,
    // which is exactly why §5a says to handle it.
    await record("h5");
    await tombstone("h5", null);
    expect(await statusOf("h5")).toBe("revoked");
  });

  it("a PORTAL record is revocable by a ROTATED portal key — role-based authority survives", async () => {
    // Branch 4. The portal is ONE logical issuer whose keys are rotating instruments; exact-pubkey
    // matching would strand every portal-issued record the moment the KMS key rotates.
    await row({ hash: "h6", node: "n1", issuerKind: "portal", issuerPubkey: "portalkey_v1" });
    await tombstone("h6", "portalkey_v2");
    expect(await statusOf("h6")).toBe("revoked");
  });

  it("a DIRECTORY record is revocable too — institutions get role-based authority", async () => {
    // The tenth shape (fourth review MEDIUM-1). V46 deliberately admits `directory` and nothing
    // issues it yet; testing only 'portal' in branch 4 makes directory-issued records PERMANENTLY
    // unrevocable on the first key rotation. Measured: without 'directory' in the IN-list this
    // returns `active`. The general rule — role-based for INSTITUTIONS, exact-pubkey for AGENTS,
    // and an unrecognised future issuer_kind falls to the stricter agent side.
    await row({ hash: "h10", node: "n1", issuerKind: "directory", issuerPubkey: "dirkey_v1" });
    await tombstone("h10", "dirkey_v2");
    expect(await statusOf("h10")).toBe("revoked");
  });

  it("a REAL row carrying status='revoked' still reads revoked", async () => {
    // Branch 3. No writer produces this today — but UPDATE is granted, 'revoked' is in the column
    // CHECK, and signal-write.ts already does `UPDATE … SET status='superseded'`. Measured: without
    // this branch it regresses to `active`.
    await row({ hash: "h7", node: "n1", issuerKind: "agent", issuerPubkey: "bobkey", status: "revoked" });
    expect(await statusOf("h7")).toBe("revoked");
  });

  it("REVOKED beats SUPERSEDED — the revoke branches must precede supersession", async () => {
    // The ordering claim, and the only one the old fragment fixture could not reach: V46's
    // supersession branch is a correlated EXISTS, not an aggregate. Measured: with supersession
    // first this reads `superseded`, and a withdrawn endorsement that happened to have a successor
    // would quietly downgrade to a weaker status.
    await record("h8");
    await tombstone("h8", "bobkey");
    await row({ hash: "h8s", node: "n1", issuerKind: "agent", issuerPubkey: "bobkey", supersedes: "h8" });
    expect(await statusOf("h8")).toBe("revoked");
  });

  it("supersession is UNTOUCHED — the five new branches do not swallow it", async () => {
    await record("h9");
    await row({ hash: "h9s", node: "n1", issuerKind: "agent", issuerPubkey: "bobkey", supersedes: "h9" });
    expect(await statusOf("h9")).toBe("superseded");
    expect(await statusOf("h9s")).toBe("active");
  });

  it("an untouched record is active", async () => {
    await record("h2");
    expect(await statusOf("h2")).toBe("active");
  });

  it("the tombstone's placeholders never surface as descriptive fields", async () => {
    // V46's property, re-asserted because this migration rewrote the view: descriptive columns
    // aggregate over REAL rows only, so '(tombstone)' must never appear as an issuer_pubkey.
    await record("h3");
    await tombstone("h3", "bobkey");
    const { rows } = await pool.query(
      "SELECT issuer_pubkey, issuer_kind FROM signal_records_effective WHERE signal_hash = 'h3'",
    );
    expect((rows[0] as { issuer_pubkey: string }).issuer_pubkey).toBe("bobkey");
    expect((rows[0] as { issuer_kind: string }).issuer_kind).toBe("agent");
  });

  it("carries revoker_signature as AUDIT EVIDENCE — nullable, and nothing verifies it", async () => {
    // Named honestly (M10B-D28, third review F6): logical replication applies rows and never re-runs
    // revokeSignal, so a peer node accepts whatever revoker the originating node wrote. The column
    // makes forgery detectable IN PRINCIPLE and prevents nothing, because the read path is a view
    // and a view cannot check Ed25519. The compromised-node case stays OPEN.
    const { rows } = await pool.query(
      "SELECT is_nullable FROM information_schema.columns WHERE table_name='signal_records' AND column_name='revoker_signature'",
    );
    expect((rows[0] as { is_nullable: string }).is_nullable).toBe("YES");
  });
});
