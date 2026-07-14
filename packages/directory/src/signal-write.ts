/**
 * M10 / DOD-DIR-WRITE-1 — the ONE write path into the directory's trust-signal store.
 *
 * ══ THIS MODULE *IS* INV-CHOKEPOINT ════════════════════════════════════════════════════════════
 * A hash enters `signal_records` ONLY through here, only via a signed submission from a key in
 * `authorized_issuers`. Everything else is refused, loudly. "Notarized ⇒ scanned-clean-at-birth"
 * (spec §14.1) is true only because this is the sole door.
 *
 * The chokepoint is NET-NEW, not a hardening. Today's reality (investigation §4): ONE static bearer
 * key, non-constant-time compared, over plaintext HTTP on a public ALB — and it is the SAME secret
 * the ops-agent holds. Any key-holder can write a trust-signal hash for any account. This REPLACES
 * that seam for signals (M10-D10); it does not extend it. Extending it would have made the
 * chokepoint a lie told in a nicer voice.
 *
 * ══ THE RE-HASH IS THE WHOLE POINT ═════════════════════════════════════════════════════════════
 * The submitter sends (envelope bytes, claimed hash). We RE-DERIVE the hash from the bytes with the
 * shared canonical component (@cello-protocol/protocol-types — the same code the portal, the holder
 * and the recipient run, proven byte-identical by the frozen cross-party vectors) and REJECT a
 * mismatch. Without that, a submitter could hand us the hash of one thing and the bytes of another,
 * and the directory would happily notarize a hash that corresponds to nothing it ever saw.
 *
 * A check the submitter performs on its own behalf is not a check.
 *
 * ══ TYPE IS OPAQUE HERE. NO BRANCHING ON IT. EVER. (DOD-INV-ZERO-BUMP) ═════════════════════════
 * This file must never contain a type enum, a `switch (type)`, or a validation that knows what a
 * type MEANS. A type the directory has never seen must submit, store and serve exactly like a known
 * one — that is what the zero-bump canary proves, and this handler is where it would first be
 * betrayed.
 *
 * ══ REPLAY IS STATUS-HARMLESS BY CONSTRUCTION — AND THAT CLAIM IS EARNED, NOT ASSERTED ═════════
 * There is deliberately no nonce store. A replay cannot change any signal's effective STATUS,
 * because of two rules, each with a negative test:
 *   1. A duplicate submit is a STRICT NO-OP. It never touches the existing row — `status` included.
 *      An `ON CONFLICT DO UPDATE` here would let a replayed submit RESURRECT A REVOKED SIGNAL.
 *      (The client-side store shipped exactly this bug one tier down and had to have it removed.
 *      Once is a bug; twice is a pattern — so it is tested on both sides.)
 *   2. Supersession rides on the new record's own hashed `supersedes_hash`; the old row is never
 *      mutated to express it. So a replayed submit cannot launder a `revoked` row into `superseded`.
 * What a replay CAN do is inflate PROVENANCE breadth by being replayed to another node — bounded only
 * by the `issued_at` skew window. See CLOCK_SKEW_SECONDS. Status integrity holds either way.
 */

import { createHash } from "node:crypto";
import { verify } from "@cello-protocol/crypto";
import { encodeCbor, decodeCbor, hashTrustSignalEnvelope, type TrustSignalEnvelope } from "@cello-protocol/protocol-types";
import type { Pool } from "pg";
import type { Logger } from "@cello-protocol/interfaces";

/** This module logs at info/warn only; narrowing to that keeps it compatible with the internal-api
 *  server's own narrowed logger without forcing a `debug` it never calls. */
type WriteLogger = Pick<Logger, "info" | "warn" | "error">;

/** Domain separation for the REQUEST signature. Distinct from the envelope's own `CELLO-TSIG-v1`, so
 *  a signed submission can never be replayed as a signed envelope, or vice versa. */
export const SIGNAL_REQUEST_DOMAIN = "CELLO-TSIG-REQ-v1";

/**
 * How far a submission's `issued_at` may sit from our clock.
 *
 * STATUS integrity does not depend on this window — the two idempotence rules make a replay unable to
 * change any signal's effective status (a duplicate is a strict no-op; `revoked` is monotonic across
 * the hash group in `signal_records_effective`). A revoke-then-replay is harmless regardless of age.
 *
 * But PROVENANCE breadth DOES depend on it, and this is the bound. A captured, validly-signed submit
 * replayed to a DIFFERENT node has no PK conflict (the PK is `(signal_hash, accepting_node)`), so it
 * inserts a genuine new row `(H, otherNode, active)` — inflating `signal_records_effective.notarized_by`
 * to assert an independent notarization that node never performed. The skew window is the only thing
 * bounding that inflation, so it IS doing security work here, and any path that ever treats
 * "notarized by N nodes" as assurance must authenticate provenance rather than count `accepting_node`
 * rows. (No consumer of `notarized_by` is wired today; this is a standing caveat, not a live hole.)
 */
const CLOCK_SKEW_SECONDS = 600;

export type IssuerRole = "submitter" | "registry";

/** Every refusal names its CAUSE, not the exit point it surfaced at. An operator reading
 *  `signal_submission_rejected: envelope_hash_mismatch` knows to look at the submitter's encoder;
 *  one reading `bad_request` learns nothing and starts guessing. */
export type SubmitRejection =
  | "malformed_request"          // the body is not the canonical shape we require
  | "unknown_issuer"             // the pubkey is not in authorized_issuers at all
  | "issuer_revoked"             // it is there, and it has been revoked
  | "issuer_wrong_role"          // it is active, but not a `submitter`
  | "signature_invalid"          // the signature does not verify against the claimed pubkey
  | "stale_request"              // issued_at is outside the skew window
  | "envelope_undecodable"       // the envelope bytes are not a canonical trust-signal envelope (bad FORM)
  | "envelope_invalid"           // canonical form, but a field violates the envelope's own rules (bad MEANING)
  | "envelope_hash_mismatch";    // WE re-hashed the bytes and got a different hash — the chokepoint

export class SubmitRejected extends Error {
  readonly reason: SubmitRejection;
  /** The upstream cause, preserved. A mapper that collapses many conditions into one terminal string
   *  must let the real reason survive in the payload, or the operator is sent to the wrong subsystem
   *  (repo rule: errors name their cause, not their exit point). */
  readonly detail: string;
  constructor(reason: SubmitRejection, detail: string) {
    super(`${reason}: ${detail}`);
    this.name = "SubmitRejected";
    this.reason = reason;
    this.detail = detail;
  }
}

/** The signed request envelope (NOT the trust-signal envelope — a different thing, different domain
 *  tag). Canonical CBOR, so the signer and the verifier agree on the bytes byte-for-byte. */
export interface SignalSubmitRequest {
  v: 1;
  op: "submit";
  /** The trust-signal envelope, as canonical CBOR bytes. OPAQUE to the transport — we decode it only
   *  to re-hash it, never to interpret its payload. */
  envelope: Uint8Array;
  /** The submitter's claim about the envelope's hash. Checked, never trusted. */
  signal_hash: string;
  /** The scanner that cleared this content at birth. THE SUBMITTER'S ASSERTION — the directory cannot
   *  see the payload and can never re-run the scan. It is inside the SIGNED body precisely because
   *  outside it, it would be forgeable, and a forged scanner_version is a lie stored as evidence. */
  scanner_version: string;
  /** Epoch SECONDS (the protocol's unit everywhere — see the envelope). */
  issued_at: number;
}

/** The to-be-signed bytes for a request: domain tag || sha256(canonical body). */
export function buildSignalRequestTbs(bodyCbor: Uint8Array): Uint8Array {
  const digest = createHash("sha256").update(bodyCbor).digest();
  return Buffer.concat([Buffer.from(SIGNAL_REQUEST_DOMAIN, "utf8"), digest]);
}

const hexToBytes = (h: string): Uint8Array => new Uint8Array(Buffer.from(h, "hex"));

/**
 * Look the submitter up in `authorized_issuers` and say precisely why it is refused.
 *
 * ABSENT IS NOT FINE. A missing row, a revoked key, and a wrong-role key are THREE DIFFERENT
 * refusals, and each says so. Collapsing them into one `unauthorized` would tell the operator
 * nothing — and, worse, a `SELECT` that returned no row and was allowed to mean "fine" is exactly
 * the defect class this project has found five times.
 */
async function authorizeIssuer(pool: Pool, pubkey: string, required: IssuerRole): Promise<void> {
  const { rows } = await pool.query(
    "SELECT role, status FROM authorized_issuers WHERE pubkey = $1",
    [pubkey],
  );
  if (rows.length === 0) {
    // Note: an EMPTY authorized_issuers table lands here for every submission — which is the correct
    // failure for an unseeded directory. It notarizes nothing rather than falling open.
    throw new SubmitRejected("unknown_issuer", `pubkey ${pubkey.slice(0, 16)}… is not an authorized issuer`);
  }
  const { role, status } = rows[0] as { role: string; status: string };
  if (status !== "active") {
    throw new SubmitRejected("issuer_revoked", `pubkey ${pubkey.slice(0, 16)}… has status '${status}'`);
  }
  if (role !== required) {
    throw new SubmitRejected("issuer_wrong_role", `pubkey ${pubkey.slice(0, 16)}… has role '${role}', needs '${required}'`);
  }
}

/** Decode + shape-check the signed request body. Nothing here interprets the trust signal itself. */
function parseRequest(bodyCbor: Uint8Array): SignalSubmitRequest {
  let decoded: unknown;
  try {
    decoded = decodeCbor(bodyCbor);
  } catch (err) {
    throw new SubmitRejected("malformed_request", `body is not decodable CBOR: ${err instanceof Error ? err.message : String(err)}`);
  }
  const r = decoded as Partial<SignalSubmitRequest>;
  if (r === null || typeof r !== "object") throw new SubmitRejected("malformed_request", "body is not a map");
  if (r.v !== 1) throw new SubmitRejected("malformed_request", `unsupported request version ${String(r.v)}`);
  if (r.op !== "submit") throw new SubmitRejected("malformed_request", `unsupported op ${String(r.op)}`);
  if (!(r.envelope instanceof Uint8Array) && !Buffer.isBuffer(r.envelope)) {
    throw new SubmitRejected("malformed_request", "envelope must be raw CBOR bytes");
  }
  if (typeof r.signal_hash !== "string" || !/^[0-9a-f]{64}$/.test(r.signal_hash)) {
    throw new SubmitRejected("malformed_request", "signal_hash must be 64 lowercase hex chars");
  }
  if (typeof r.scanner_version !== "string" || r.scanner_version.length === 0) {
    throw new SubmitRejected("malformed_request", "scanner_version is required (it is the submitter's signed assertion that the content was scanned)");
  }
  if (!Number.isInteger(r.issued_at)) {
    throw new SubmitRejected("malformed_request", "issued_at must be an integer (epoch SECONDS)");
  }
  return r as SignalSubmitRequest;
}

export interface SubmitResult {
  signalHash: string;
  /** True when this node had never seen the hash before. A duplicate is a NO-OP, not an error — the
   *  portal retries, and a retry must be safe. */
  inserted: boolean;
}

/**
 * The chokepoint. Verify, re-hash, store.
 *
 * `acceptingNode` is supplied BY THIS NODE, never taken from the request: it is half the primary key
 * (M10-D20), and a submitter that could choose it could deliberately collide rows.
 */
export async function submitSignal(args: {
  pool: Pool;
  logger: WriteLogger;
  acceptingNode: string;
  bodyCbor: Uint8Array;
  signerPubkeyHex: string;
  signatureHex: string;
  correlationId: string;
  nowSec?: number;
}): Promise<SubmitResult> {
  const { pool, logger, acceptingNode, bodyCbor, signerPubkeyHex, signatureHex, correlationId } = args;
  const nowSec = args.nowSec ?? Math.floor(Date.now() / 1000);

  const reject = (e: SubmitRejected): never => {
    logger.warn("signal.submission.rejected", {
      reason: e.reason, detail: e.detail, issuer: signerPubkeyHex.slice(0, 16), correlationId,
    });
    throw e;
  };

  try {
    // 1+2. The pubkey is well-formed, it is an active `submitter`, and it signed these exact bytes.
    //      The SAME helper revoke uses — one copy of the security-critical auth, so the two write
    //      paths cannot drift apart.
    await verifySignedRequest(pool, signerPubkeyHex, signatureHex, bodyCbor, "submitter");

    // 3. Shape.
    const req = parseRequest(bodyCbor);

    if (Math.abs(nowSec - req.issued_at) > CLOCK_SKEW_SECONDS) {
      throw new SubmitRejected("stale_request", `issued_at ${req.issued_at} is more than ${CLOCK_SKEW_SECONDS}s from this node's clock (${nowSec})`);
    }

    // 4. THE CHOKEPOINT: re-derive the hash from the BYTES and refuse a mismatch. We decode the
    //    envelope ONLY to re-hash it — never to interpret its payload, and never to branch on its
    //    type.
    const envelopeBytes = new Uint8Array(req.envelope);

    // FORM: is this canonical trust-signal-envelope bytes at all? (bad CBOR, wrong arity, wrong
    // domain tag, non-canonical encoding → `envelope_undecodable`.)
    let envelope: TrustSignalEnvelope;
    try {
      envelope = decodeTrustSignalEnvelope(envelopeBytes);
    } catch (err) {
      throw new SubmitRejected("envelope_undecodable", err instanceof Error ? err.message : String(err));
    }

    // MEANING: the re-hash RE-VALIDATES — hashTrustSignalEnvelope → toPreimage enforces the semantic
    // rules (enum membership, NFC, lowercase-hex pubkey, integer bounds, 32-byte supersedes_hash) and
    // throws a PLAIN Error on a violation. It MUST be caught and named here, or a canonical-but-
    // invalid envelope (an out-of-enum subject_kind round-trips fine at the byte level) escapes as an
    // unmapped exception: an HTTP 500 with no `signal.submission.rejected` log, on the security-core
    // module, on hostile input. Form is checked above; meaning is checked here; both are loud + named.
    let derived: string;
    try {
      derived = Buffer.from(hashTrustSignalEnvelope(envelope)).toString("hex");
    } catch (err) {
      throw new SubmitRejected("envelope_invalid", err instanceof Error ? err.message : String(err));
    }
    if (derived !== req.signal_hash) {
      // The submitter's claim and the bytes disagree. This is the check that makes "notarized"
      // mean anything.
      throw new SubmitRejected(
        "envelope_hash_mismatch",
        `submitter claimed ${req.signal_hash} but the envelope bytes hash to ${derived}`,
      );
    }

    // 5. Store. STRICT no-op on a duplicate — never an upsert (see the header: an upsert would let a
    //    replayed submit resurrect a revoked signal).
    const res = await pool.query(
      `INSERT INTO signal_records
         (signal_hash, accepting_node, subject_kind, subject, issuer_kind, issuer_pubkey, type,
          supersedes_hash, status, scanner_version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active',$9)
       ON CONFLICT (signal_hash, accepting_node) DO NOTHING`,
      [
        derived, acceptingNode, envelope.subject_kind, envelope.subject, envelope.issuer_kind,
        envelope.issuer_pubkey, envelope.type,
        envelope.supersedes_hash === null ? null : Buffer.from(envelope.supersedes_hash).toString("hex"),
        req.scanner_version,
      ],
    );

    const inserted = (res.rowCount ?? 0) > 0;
    logger.info("signal.submission.accepted", {
      signalHash: derived,
      type: envelope.type,               // an opaque STRING in the log, never a gate
      issuerKind: envelope.issuer_kind,
      subjectKind: envelope.subject_kind,
      acceptingNode,
      inserted,                          // false = duplicate, a benign no-op
      correlationId,
    });
    return { signalHash: derived, inserted };
  } catch (err) {
    if (err instanceof SubmitRejected) return reject(err);
    throw err;
  }
}

/**
 * Shared front half of EVERY signed write (submit, revoke, and registry-publish later): the pubkey
 * is well-formed, it is an active issuer with the REQUIRED role, and it actually signed these exact
 * bytes. Any failure throws a named SubmitRejected.
 *
 * Factored out so revoke cannot drift from submit on the security-critical path — the auth on a
 * revocation must be exactly as strong as the auth on a submission, and the only way to guarantee
 * that is to run the same code.
 */
async function verifySignedRequest(
  pool: Pool, signerPubkeyHex: string, signatureHex: string, bodyCbor: Uint8Array, requiredRole: IssuerRole,
): Promise<void> {
  if (!/^[0-9a-f]{64}$/.test(signerPubkeyHex)) {
    throw new SubmitRejected("malformed_request", "signer pubkey must be 64 lowercase hex chars");
  }
  // Authorize BEFORE crypto — cheap check first; an unknown key never exercises the verifier.
  await authorizeIssuer(pool, signerPubkeyHex, requiredRole);
  let sigOk = false;
  try {
    sigOk = verify(hexToBytes(signerPubkeyHex), buildSignalRequestTbs(bodyCbor), hexToBytes(signatureHex));
  } catch (err) {
    throw new SubmitRejected("signature_invalid", `signature could not be checked: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!sigOk) throw new SubmitRejected("signature_invalid", "signature does not verify against the requester's registered pubkey");
}

/** The revoke request body. Just the hash — a revocation says "this signal is dead", nothing more. */
interface SignalRevokeRequest {
  v: 1;
  op: "revoke";
  signal_hash: string;
  issued_at: number;
}

export interface RevokeResult {
  signalHash: string;
  /** How many local rows for this hash were moved to `revoked` (0 = we had no row for it yet, which
   *  is NOT an error — see the tombstone note in revokeSignal). */
  revokedRows: number;
}

/**
 * M10 / DOD-REVOKE-1 — revocation is re-auth through the SAME chokepoint (spec §14.2).
 *
 * ROLE-BASED authorization, not exact-pubkey (M10-D6/determination §3.5, STORE-DIR review F4). ANY
 * active `submitter`-role key may revoke a portal-issued record. Exact-pubkey matching
 * (`requester == record.issuer_pubkey`) would strand every record signed by an OLD key the moment
 * the portal rotates its KMS key — the record would become permanently unrevocable, or retirement
 * would have to keep dead keys active, defeating its own purpose. The portal is ONE logical issuer;
 * its keys are rotating instruments.
 *
 * THE SUBJECT CANNOT REVOKE. Nothing here consults the signal's subject — revocation authority is the
 * issuer's, and the subject's lever is selective disclosure (they simply don't present it), not
 * erasure of a fact the issuer attested. (Exact-pubkey for `issuer_kind: agent` is the post-v1
 * endorsement model, where the key IS the identity; not this path.)
 *
 * EXPIRY IS NOT REVOCATION. A signal past its `expires_at` is dead without anyone writing anything —
 * the verifier evaluates it against the clock (spec §14.2). Revocation is the EARLY, explicit death
 * of a not-yet-expired signal.
 *
 * A REVOKE THAT FINDS NO LOCAL ROW WRITES A TOMBSTONE, it does not fail. Under mesh replication a
 * revoke can reach a node before the row it targets (M10-D20) — a plain UPDATE would match zero rows,
 * return "success", and be silently lost, leaving that node serving a dead signal as live forever. So
 * absence of the row is met with an INSERT of a `revoked` tombstone, which replicates and cannot be
 * lost the way an UPDATE can; `revoked` is monotonic in `signal_records_effective`, so any node's
 * revocation wins and the system converges. This is the STORE-DIR review's F3, closed at the source.
 */
export async function revokeSignal(args: {
  pool: Pool;
  logger: WriteLogger;
  acceptingNode: string;
  bodyCbor: Uint8Array;
  signerPubkeyHex: string;
  signatureHex: string;
  correlationId: string;
  nowSec?: number;
}): Promise<RevokeResult> {
  const { pool, logger, acceptingNode, bodyCbor, signerPubkeyHex, signatureHex, correlationId } = args;
  const nowSec = args.nowSec ?? Math.floor(Date.now() / 1000);

  const reject = (e: SubmitRejected): never => {
    logger.warn("signal.revocation.rejected", {
      reason: e.reason, detail: e.detail, issuer: signerPubkeyHex.slice(0, 16), correlationId,
    });
    throw e;
  };

  try {
    await verifySignedRequest(pool, signerPubkeyHex, signatureHex, bodyCbor, "submitter");

    let decoded: unknown;
    try {
      decoded = decodeCbor(bodyCbor);
    } catch (err) {
      throw new SubmitRejected("malformed_request", `body is not decodable CBOR: ${err instanceof Error ? err.message : String(err)}`);
    }
    const r = decoded as Partial<SignalRevokeRequest>;
    if (r === null || typeof r !== "object") throw new SubmitRejected("malformed_request", "body is not a map");
    if (r.v !== 1) throw new SubmitRejected("malformed_request", `unsupported request version ${String(r.v)}`);
    if (r.op !== "revoke") throw new SubmitRejected("malformed_request", `unsupported op ${String(r.op)} (expected 'revoke')`);
    if (typeof r.signal_hash !== "string" || !/^[0-9a-f]{64}$/.test(r.signal_hash)) {
      throw new SubmitRejected("malformed_request", "signal_hash must be 64 lowercase hex chars");
    }
    if (typeof r.issued_at !== "number" || !Number.isInteger(r.issued_at)) {
      throw new SubmitRejected("malformed_request", "issued_at must be an integer (epoch SECONDS)");
    }
    const issuedAt = r.issued_at;
    if (Math.abs(nowSec - issuedAt) > CLOCK_SKEW_SECONDS) {
      throw new SubmitRejected("stale_request", `issued_at ${issuedAt} is more than ${CLOCK_SKEW_SECONDS}s from this node's clock (${nowSec})`);
    }

    const signalHash = r.signal_hash;

    // REVOCATION IS ALWAYS A TOMBSTONE INSERT — never an UPDATE of the notarization row. This single
    // decision closes three failure modes the review found (F1/F3/F4), and it is worth stating why:
    //
    //   - It NEVER collides with a real notarization. The tombstone's PK is
    //     `(signal_hash, "revoke:" + node)`; a real record is `(signal_hash, node)`. So a submit that
    //     arrives AFTER a revoke (a legitimate revoke-before-submit ordering, or an attacker
    //     pre-revoking a hash at every node) still inserts its real row and keeps its provenance —
    //     the signal reads `revoked`, but the notarization is NOT silently dropped. An UPDATE-or-
    //     tombstone design squatted the real PK and lost the record (F1).
    //   - It is RACE-FREE. One INSERT … ON CONFLICT DO NOTHING; `rowCount` is the truth. The earlier
    //     SELECT-exists-then-INSERT could report success while a concurrent submit slipped in between
    //     and left the signal active (F3, a TOCTOU false-success).
    //   - It REPLICATES ROBUSTLY. An INSERT cannot be skipped the way a replicated UPDATE is when it
    //     reaches a node before the row it targets (F4). The revocation does not depend on the
    //     notarization row existing anywhere.
    //
    // The notarization row's own `status` column is left untouched (stays `active`); correctness lives
    // in `signal_records_effective`, which reports `revoked` whenever ANY row for the hash — here, this
    // tombstone — is revoked (BOOL_OR). Nothing reads a bare `status` column for a decision.
    //
    // `is_tombstone` keeps this row's placeholder descriptive fields out of the view's aggregation, and
    // the `revoke:`-prefixed node keeps it out of `notarized_by`. Per-node idempotence falls out of the
    // PK: a second revoke at the same node is ON CONFLICT DO NOTHING.
    const revokeNode = `revoke:${acceptingNode}`;
    const ins = await pool.query(
      `INSERT INTO signal_records
         (signal_hash, accepting_node, subject_kind, subject, issuer_kind, issuer_pubkey, type,
          supersedes_hash, status, revoked_at, scanner_version, is_tombstone)
       VALUES ($1,$2,'agent','(tombstone)','portal','(tombstone)','(tombstone)',NULL,'revoked',now(),'(tombstone)',true)
       ON CONFLICT (signal_hash, accepting_node) DO NOTHING`,
      [signalHash, revokeNode],
    );
    const revokedRows = ins.rowCount ?? 0; // 1 = newly revoked at this node; 0 = this node already had

    logger.info("signal.revocation.accepted", {
      signalHash, issuer: signerPubkeyHex.slice(0, 16), acceptingNode, revokedRows, correlationId,
    });
    return { signalHash, revokedRows };
  } catch (err) {
    if (err instanceof SubmitRejected) return reject(err);
    throw err;
  }
}

/** The registry-publish request body. The document itself is opaque bytes the directory never
 *  interprets — it carries its own inner signature that CLIENTS verify against their pinned key. */
interface RegistryPublishRequest {
  v: 1;
  op: "registry-publish";
  /** The signed registry document, opaque to the directory. */
  document: Uint8Array;
  /** Monotonic anti-rollback counter. */
  version: number;
  issued_at: number;
}

export interface RegistryPublishResult {
  version: number;
  /** True if this publish updated the stored registry; false if it was refused as a rollback but the
   *  request was otherwise valid (a lower/equal version is not an ERROR — the client is the real gate). */
  stored: boolean;
}

/**
 * M10 / DOD-REGISTRY-1 — publish the type registry through the SAME chokepoint, role `registry`.
 *
 * The directory is a DUMB NOTARY here too: it verifies the OUTER submission signature (role
 * `registry` — so a random party, or even a `submitter` key, cannot overwrite the served registry),
 * then stores the document as OPAQUE BYTES. It does NOT verify the document's INNER signature and does
 * NOT parse it — clients verify the inner signature against their build-time-pinned registry pubkey
 * (M10-D9), and clients enforce the real anti-rollback. INV-DIR-DUMB.
 *
 * Server-side anti-rollback (refuse a lower version) is HYGIENE, applied atomically in the UPDATE's
 * WHERE so two concurrent publishes cannot race a rollback in.
 */
export async function publishRegistry(args: {
  pool: Pool;
  logger: WriteLogger;
  bodyCbor: Uint8Array;
  signerPubkeyHex: string;
  signatureHex: string;
  correlationId: string;
  nowSec?: number;
}): Promise<RegistryPublishResult> {
  const { pool, logger, bodyCbor, signerPubkeyHex, signatureHex, correlationId } = args;
  const nowSec = args.nowSec ?? Math.floor(Date.now() / 1000);

  const reject = (e: SubmitRejected): never => {
    logger.warn("signal.registry.rejected", {
      reason: e.reason, detail: e.detail, issuer: signerPubkeyHex.slice(0, 16), correlationId,
    });
    throw e;
  };

  try {
    // ROLE `registry`, not `submitter` — the registry key is dedicated (M10-D9), and a submission key
    // must not be able to publish a registry.
    await verifySignedRequest(pool, signerPubkeyHex, signatureHex, bodyCbor, "registry");

    let decoded: unknown;
    try {
      decoded = decodeCbor(bodyCbor);
    } catch (err) {
      throw new SubmitRejected("malformed_request", `body is not decodable CBOR: ${err instanceof Error ? err.message : String(err)}`);
    }
    const r = decoded as Partial<RegistryPublishRequest>;
    if (r === null || typeof r !== "object") throw new SubmitRejected("malformed_request", "body is not a map");
    if (r.v !== 1) throw new SubmitRejected("malformed_request", `unsupported request version ${String(r.v)}`);
    if (r.op !== "registry-publish") throw new SubmitRejected("malformed_request", `unsupported op ${String(r.op)}`);
    if (!(r.document instanceof Uint8Array) && !Buffer.isBuffer(r.document)) {
      throw new SubmitRejected("malformed_request", "document must be raw bytes");
    }
    if (typeof r.version !== "number" || !Number.isInteger(r.version) || r.version < 0) {
      throw new SubmitRejected("malformed_request", "version must be a non-negative integer");
    }
    if (typeof r.issued_at !== "number" || !Number.isInteger(r.issued_at)) {
      throw new SubmitRejected("malformed_request", "issued_at must be an integer (epoch SECONDS)");
    }
    if (Math.abs(nowSec - r.issued_at) > CLOCK_SKEW_SECONDS) {
      throw new SubmitRejected("stale_request", `issued_at ${r.issued_at} is more than ${CLOCK_SKEW_SECONDS}s from this node's clock (${nowSec})`);
    }

    const version = r.version;
    const documentBuf = Buffer.from(r.document);

    // Upsert the singleton. The WHERE on DO UPDATE is the ATOMIC anti-rollback: a lower version leaves
    // the stored document untouched. A first publish (no row) always stores.
    const res = await pool.query(
      `INSERT INTO registry_documents (id, version, document, published_at)
         VALUES (1, $1, $2, now())
       ON CONFLICT (id) DO UPDATE
         SET version = EXCLUDED.version, document = EXCLUDED.document, published_at = now()
         WHERE EXCLUDED.version >= registry_documents.version`,
      [version, documentBuf],
    );
    const stored = (res.rowCount ?? 0) > 0;

    if (stored) {
      logger.info("signal.registry.published", { version, bytes: documentBuf.length, correlationId });
    } else {
      // Not an error — a rollback attempt (or an exact-version re-publish that the WHERE treated as a
      // no-op). The client is the real anti-rollback gate; server-side is hygiene.
      logger.info("signal.registry.rollback_ignored", { version, correlationId });
    }
    return { version, stored };
  } catch (err) {
    if (err instanceof SubmitRejected) return reject(err);
    throw err;
  }
}

/** Read the currently-served registry document bytes (for GET /registry). Null if none published. */
export async function getRegistryDocument(pool: Pool): Promise<{ version: number; document: Buffer } | null> {
  const { rows } = await pool.query("SELECT version, document FROM registry_documents WHERE id = 1");
  if (rows.length === 0) return null;
  return { version: Number(rows[0].version), document: rows[0].document as Buffer };
}

/**
 * Decode canonical envelope bytes back into the envelope.
 *
 * The preimage is a fixed-order ARRAY (M10-D15) — element 0 is the domain tag. Refuse anything that
 * is not exactly that shape: a submission we cannot canonicalize must never be stored "best effort",
 * because a best-effort hash is a hash two parties can disagree about.
 */
function decodeTrustSignalEnvelope(bytes: Uint8Array): TrustSignalEnvelope {
  const arr = decodeCbor(bytes);
  if (!Array.isArray(arr) || arr.length !== 11) {
    throw new Error(`envelope must be an 11-element CBOR array (the fixed preimage), got ${Array.isArray(arr) ? `${arr.length} elements` : typeof arr}`);
  }
  const [domain, subject_kind, subject, issuer_kind, issuer_pubkey, type, schema_version, payload, issued_at, expires_at, supersedes_hash] = arr as unknown[];
  if (domain !== "CELLO-TSIG-v1") {
    throw new Error(`envelope domain tag is '${String(domain)}', expected 'CELLO-TSIG-v1' — this is not a trust-signal envelope`);
  }
  const toBytes = (v: unknown): Uint8Array =>
    v instanceof Uint8Array ? v : Buffer.isBuffer(v) ? new Uint8Array(v) : (() => { throw new Error("expected raw bytes"); })();

  const env: TrustSignalEnvelope = {
    subject_kind: subject_kind as "account" | "agent",
    subject: subject as string,
    issuer_kind: issuer_kind as "portal" | "agent",
    issuer_pubkey: issuer_pubkey as string,
    type: type as string,
    schema_version: Number(schema_version),
    payload: toBytes(payload),
    issued_at: Number(issued_at),
    expires_at: expires_at === null || expires_at === undefined ? null : Number(expires_at),
    supersedes_hash: supersedes_hash === null || supersedes_hash === undefined ? null : toBytes(supersedes_hash),
  };

  // Re-encoding must reproduce the input EXACTLY. This is what makes the decode safe: if any field
  // round-trips differently (a number that came back as a float, a byte string we mis-read), the
  // bytes differ and we refuse — rather than hashing our RE-encoding of what we think they meant and
  // notarizing a hash the submitter never computed.
  const reencoded = encodeCbor([
    "CELLO-TSIG-v1", env.subject_kind, env.subject, env.issuer_kind, env.issuer_pubkey, env.type,
    env.schema_version > 0xffff_ffff ? BigInt(env.schema_version) : env.schema_version,
    env.payload,
    env.issued_at > 0xffff_ffff ? BigInt(env.issued_at) : env.issued_at,
    env.expires_at === null ? null : (env.expires_at > 0xffff_ffff ? BigInt(env.expires_at) : env.expires_at),
    env.supersedes_hash,
  ]);
  if (Buffer.compare(Buffer.from(reencoded), Buffer.from(bytes)) !== 0) {
    throw new Error("envelope bytes are not canonical — re-encoding them does not reproduce the input");
  }
  return env;
}
