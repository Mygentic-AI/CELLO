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

  it("A TOMBSTONE WITH NO REVOKER IS INERT AGAINST AN AGENT RECORD — the bypass, closed", async () => {
    // THIS TEST PREVIOUSLY ASSERTED THE OPPOSITE, and that is the finding worth keeping. The first
    // version of V53 had a "NULL revoker ⇒ revoked" branch justified as preserving legacy semantics,
    // and this test — using an AGENT record — asserted `revoked` and called it correct.
    //
    // It defeated the entire unit. A missing revoker is not a property of AGE: nothing distinguishes
    // a pre-V53 tombstone from one written a minute ago with the fields simply omitted. And the only
    // revoke producer in the system (the portal's directory-submit) sends no revoker at all, so
    // EVERY revoke took that path and exact-pubkey authority was unreachable in production.
    await record("h11");                       // issuer_kind: agent, issuer bobkey
    await tombstone("h11", null);              // no inner authorization at all
    expect(await statusOf("h11")).toBe("active");
  });

  it("...but an institutional record with a NULL-revoker tombstone STILL revokes", async () => {
    // The other half, and the reason the NULL branch was not needed: branch 3's institutional escape
    // already carries every pre-V53 revocation. Verified against the data too — signal_records holds
    // zero agent-issued rows and zero tombstones, so no legacy agent tombstone exists to grandfather.
    await row({ hash: "p1", node: "n1", issuerKind: "portal", issuerPubkey: "portalkey" });
    await tombstone("p1", null);
    expect(await statusOf("p1")).toBe("revoked");

    await row({ hash: "d1", node: "n1", issuerKind: "directory", issuerPubkey: "dirkey" });
    await tombstone("d1", null);
    expect(await statusOf("d1")).toBe("revoked");
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

  it("PERSISTS the revoker signature — asserted on the stored bytes, not on nullability", async () => {
    // The previous version asserted `is_nullable = 'YES'`, which ANY nullable BYTEA column satisfies
    // — including one nothing ever writes. It tested the schema, not the claim in its own name.
    await record("h14");
    await pool.query(
      `INSERT INTO signal_records
         (signal_hash, accepting_node, subject_kind, subject, issuer_kind, issuer_pubkey, type,
          status, is_tombstone, revoker_pubkey, revoker_signature, scanner_version)
       VALUES ('h14','n2','agent','subj','portal','(tombstone)','endorsement','revoked',true,'bobkey',$1,'test-v0')`,
      [Buffer.alloc(64, 7)],
    );
    const { rows } = await pool.query(
      "SELECT revoker_signature FROM signal_records WHERE signal_hash='h14' AND is_tombstone");
    expect((rows[0] as { revoker_signature: Buffer }).revoker_signature.length).toBe(64);
    // ...and it is AUDIT EVIDENCE, not a defense: the view reaches `revoked` from revoker_pubkey
    // alone and never looks at these bytes, because a view cannot verify Ed25519. Stated by asserting
    // the status is decided WITHOUT the signature having been checked by anything.
    expect(await statusOf("h14")).toBe("revoked");
  });

  // ── Review F4 (pre-existing since V46) — supersession must consult EFFECTIVE status ────────────
  describe("a withdrawn successor does not strand its predecessor", () => {
    it("Bob re-endorses then WITHDRAWS the new one — the original comes BACK", async () => {
      // The defect: V46's guard was `s.status <> 'revoked'`, and it has been INERT since revocation
      // became a tombstone (the real row's status stays 'active'). So this sequence left v1
      // `superseded` and v2 `revoked` — BOTH unpresentable, nothing saying so, and the subject
      // simply has nothing. Withdrawal is one of the two mechanisms this milestone IS, so a
      // withdrawal that silently destroys the endorsement it replaced is not a corner.
      await record("v1");
      await row({ hash: "v2", node: "n1", issuerKind: "agent", issuerPubkey: "bobkey", supersedes: "v1" });
      await tombstone("v2", "bobkey");                     // authorized: the issuer's own withdrawal
      expect(await statusOf("v2")).toBe("revoked");
      expect(await statusOf("v1")).toBe("active");         // ← was `superseded` before the fix
    });

    it("but an UNAUTHORIZED tombstone on the successor does NOT resurrect the predecessor", async () => {
      // The naive repair — "ignore a successor that has any tombstone" — is a RESURRECTION ATTACK:
      // Mallory tombstones v2 and v1 springs back to presentable. The successor has to be judged by
      // the SAME authority rules, which is what computing revoked-ness once in a CTE buys.
      await record("w1");
      await row({ hash: "w2", node: "n1", issuerKind: "agent", issuerPubkey: "bobkey", supersedes: "w1" });
      await tombstone("w2", "mallorykey");                 // unauthorized
      expect(await statusOf("w2")).toBe("active");         // the tombstone is inert...
      expect(await statusOf("w1")).toBe("superseded");     // ...so it cannot revive w1 either
    });

    it("ordinary supersession is untouched", async () => {
      await record("x1");
      await row({ hash: "x2", node: "n1", issuerKind: "agent", issuerPubkey: "bobkey", supersedes: "x1" });
      expect(await statusOf("x1")).toBe("superseded");
      expect(await statusOf("x2")).toBe("active");
    });
  });
});
