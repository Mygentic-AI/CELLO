/**
 * M10 / DOD-REVOKE-1 — revocation is re-auth through the SAME chokepoint (spec §14.2).
 *
 * The load-bearing decisions, each with a test:
 *   - ROLE-BASED auth, not exact-pubkey: ANY active submitter key may revoke a portal record, so a
 *     KMS key rotation does not strand old records unrevocable (M10-D6 / STORE-DIR review F4).
 *   - The SUBJECT cannot revoke — nothing here consults the subject.
 *   - A revoke that finds no local row writes a TOMBSTONE, so an out-of-order replicated revoke is
 *     not silently lost (STORE-DIR review F3).
 *
 * Gated on CELLO_ENV=local (Docker Postgres).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Pool } from "pg";
import { randomBytes } from "node:crypto";
import { generateKeypair } from "@cello-protocol/crypto";
import { encodeCbor, encodeTrustSignalEnvelope, hashTrustSignalEnvelope, type TrustSignalEnvelope } from "@cello-protocol/protocol-types";
import { submitSignal, revokeSignal, buildSignalRequestTbs } from "../signal-write.js";
import type { Logger } from "@cello-protocol/interfaces";

const describeIntegration = process.env.CELLO_ENV === "local" ? describe : describe.skip;
const silent: Logger = { debug() {}, info() {}, warn() {}, error() {} };
const hex = (b: Uint8Array): string => Buffer.from(b).toString("hex");
interface Signer { sign(d: Uint8Array): Promise<Uint8Array>; }

describeIntegration("DOD-REVOKE-1 — revocation through the chokepoint", () => {
  let pool: Pool;
  const tag = `rv1-${Math.floor(Date.now() / 1000)}-${randomBytes(3).toString("hex")}`;
  const NODE = "us-east-1";
  // TWO distinct submitter keys — modelling a KMS key rotation. Key A mints; key B (a later key)
  // must be able to revoke A's record. And a registry-role key that must NOT be able to revoke.
  let keyA: Signer, pubA: string, keyB: Signer, pubB: string, keyReg: Signer, pubReg: string;
  const nowSec = (): number => Math.floor(Date.now() / 1000);

  function envelope(over: Partial<TrustSignalEnvelope> = {}): TrustSignalEnvelope {
    return {
      subject_kind: "agent", subject: `${tag}-agent`, issuer_kind: "portal", issuer_pubkey: pubA,
      type: "phone", schema_version: 1, payload: new Uint8Array([1, 2, 3]),
      issued_at: nowSec(), expires_at: null, supersedes_hash: null, ...over,
    };
  }

  async function mint(env: TrustSignalEnvelope, node = NODE): Promise<string> {
    const body = encodeCbor({
      v: 1, op: "submit", envelope: encodeTrustSignalEnvelope(env),
      signal_hash: hex(hashTrustSignalEnvelope(env)), scanner_version: "scan-v1", issued_at: nowSec(),
    });
    const r = await submitSignal({
      pool, logger: silent, acceptingNode: node, correlationId: "c", bodyCbor: body,
      signerPubkeyHex: pubA, signatureHex: hex(await keyA.sign(buildSignalRequestTbs(body))),
    });
    return r.signalHash;
  }

  async function revokeArgs(signalHash: string, signer: Signer, pub: string, node = NODE) {
    const body = encodeCbor({ v: 1, op: "revoke", signal_hash: signalHash, issued_at: nowSec() });
    return {
      pool, logger: silent, acceptingNode: node, correlationId: "c", bodyCbor: body,
      signerPubkeyHex: pub, signatureHex: hex(await signer.sign(buildSignalRequestTbs(body))),
    };
  }

  const effective = async (h: string): Promise<string | undefined> => {
    const { rows } = await pool.query("SELECT effective_status FROM signal_records_effective WHERE signal_hash=$1", [h]);
    return rows[0]?.effective_status;
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL || "postgresql://postgres:dev@localhost:5433/cello_dev" });
    const mk = async (): Promise<[Signer, string]> => { const kp = generateKeypair(); return [kp, hex(await kp.getPublicKey())]; };
    [keyA, pubA] = await mk(); [keyB, pubB] = await mk(); [keyReg, pubReg] = await mk();
    await pool.query(
      `INSERT INTO authorized_issuers (pubkey, role, status, label) VALUES
         ($1,'submitter','active',$4),($2,'submitter','active',$4),($3,'registry','active',$4)`,
      [pubA, pubB, pubReg, tag]);
  });

  afterAll(async () => {
    if (pool) {
      await pool.query("DELETE FROM signal_records WHERE subject LIKE $1 OR subject='(tombstone)'", [`${tag}%`]).catch(() => {});
      await pool.query("DELETE FROM authorized_issuers WHERE label=$1", [tag]).catch(() => {});
      await pool.end();
    }
  });

  beforeEach(async () => {
    await pool.query("DELETE FROM signal_records WHERE subject LIKE $1 OR (is_tombstone AND signal_hash LIKE $2)", [`${tag}%`, "%"]);
  });

  it("revokes a signal it minted, and the effective status becomes revoked", async () => {
    const h = await mint(envelope());
    expect(await effective(h)).toBe("active");
    const res = await revokeSignal(await revokeArgs(h, keyA, pubA));
    expect(res.revokedRows).toBe(1);
    expect(await effective(h)).toBe("revoked");
  });

  it("ROLE-BASED: a DIFFERENT active submitter key can revoke (survives KMS key rotation)", async () => {
    // The record was signed by key A. Key B — a later rotation of the portal's key — revokes it.
    // Exact-pubkey auth would have stranded this record unrevocable the moment A was retired.
    const h = await mint(envelope());
    const res = await revokeSignal(await revokeArgs(h, keyB, pubB));
    expect(res.revokedRows).toBe(1);
    expect(await effective(h)).toBe("revoked");
  });

  it("REFUSES a registry-role key — revocation needs a submitter, distinctly named", async () => {
    const h = await mint(envelope());
    await expect(revokeSignal(await revokeArgs(h, keyReg, pubReg)))
      .rejects.toMatchObject({ reason: "issuer_wrong_role" });
    expect(await effective(h)).toBe("active");
  });

  it("REFUSES an unknown key, and REFUSES a forged signature", async () => {
    const h = await mint(envelope());
    const stranger = generateKeypair();
    await expect(revokeSignal(await revokeArgs(h, stranger, hex(await stranger.getPublicKey()))))
      .rejects.toMatchObject({ reason: "unknown_issuer" });

    // authorized pubkey (A), but signed by the stranger
    const args = await revokeArgs(h, stranger, pubA);
    await expect(revokeSignal(args)).rejects.toMatchObject({ reason: "signature_invalid" });
    expect(await effective(h)).toBe("active");
  });

  it("TOMBSTONE: a revoke that arrives before its row is NOT lost", async () => {
    // The out-of-order replication case (STORE-DIR review F3). Revoke a hash this node has never
    // seen a real row for; a plain UPDATE would touch 0 rows and vanish. Instead a tombstone is
    // written, and the effective status is revoked.
    const orphanHash = "a".repeat(64);
    const res = await revokeSignal(await revokeArgs(orphanHash, keyA, pubA));
    expect(res.revokedRows).toBe(1);
    expect(await effective(orphanHash)).toBe("revoked");
    const { rows } = await pool.query("SELECT is_tombstone, status FROM signal_records WHERE signal_hash=$1", [orphanHash]);
    expect(rows[0].is_tombstone).toBe(true);
    expect(rows[0].status).toBe("revoked");
    await pool.query("DELETE FROM signal_records WHERE signal_hash=$1", [orphanHash]);
  });

  it("TOMBSTONE + real row: status is revoked, but the view surfaces the REAL subject, not the placeholder", async () => {
    // After convergence a node holds BOTH the real row (from the minting node) and a tombstone (from
    // the node that got the revoke first). effective_status must be revoked, AND the descriptive
    // fields must be the real ones — the is_tombstone FILTER in the view is what guarantees the
    // placeholder never surfaces.
    const env = envelope({ subject: `${tag}-real-subject` });
    const h = await mint(env, "us-east-1");                       // real row on us-east-1
    await revokeSignal(await revokeArgs(h, keyA, pubA, "ap-northeast-1")); // no local row there → tombstone

    expect(await effective(h)).toBe("revoked");
    const { rows } = await pool.query(
      "SELECT subject, subject_kind, notarized_by FROM signal_records_effective WHERE signal_hash=$1", [h]);
    expect(rows[0].subject, "the placeholder must not win the MIN()").toBe(`${tag}-real-subject`);
    expect(rows[0].subject_kind).toBe("agent");
    // provenance lists the REAL notarizing node only, never the tombstone's node.
    expect(rows[0].notarized_by).toEqual(["us-east-1"]);
    await pool.query("DELETE FROM signal_records WHERE signal_hash=$1", [h]);
  });

  it("revoke is idempotent — revoking twice is harmless", async () => {
    const h = await mint(envelope());
    await revokeSignal(await revokeArgs(h, keyA, pubA));
    const second = await revokeSignal(await revokeArgs(h, keyA, pubA));
    // Already revoked → the UPDATE matches 0 active rows AND a real row exists → no tombstone, no-op.
    expect(second.revokedRows).toBe(0);
    expect(await effective(h)).toBe("revoked");
  });

  it("REFUSES a stale revoke request", async () => {
    const h = await mint(envelope());
    const body = encodeCbor({ v: 1, op: "revoke", signal_hash: h, issued_at: nowSec() - 3600 });
    await expect(revokeSignal({
      pool, logger: silent, acceptingNode: NODE, correlationId: "c", bodyCbor: body,
      signerPubkeyHex: pubA, signatureHex: hex(await keyA.sign(buildSignalRequestTbs(body))),
    })).rejects.toMatchObject({ reason: "stale_request" });
  });
});
