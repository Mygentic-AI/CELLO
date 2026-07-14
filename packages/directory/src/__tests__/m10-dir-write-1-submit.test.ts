/**
 * M10 / DOD-DIR-WRITE-1 — the signed-submission chokepoint (INV-CHOKEPOINT).
 *
 * A hash enters `signal_records` ONLY via a signed submission from a key in `authorized_issuers`.
 * These tests are the proof, and most of them are NEGATIVE — a chokepoint is defined by what it
 * REFUSES, so a suite that only shows the happy path proves nothing about it.
 *
 * Gated on CELLO_ENV=local (Docker Postgres).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Pool } from "pg";
import { randomBytes } from "node:crypto";
import { generateKeypair } from "@cello-protocol/crypto";
import { encodeCbor, encodeTrustSignalEnvelope, hashTrustSignalEnvelope, type TrustSignalEnvelope } from "@cello-protocol/protocol-types";
import { submitSignal, buildSignalRequestTbs, SubmitRejected } from "../signal-write.js";
import type { Logger } from "@cello-protocol/interfaces";

/** The signing surface the portal actually has: in production this is AWS KMS (M10-D6 — the portal
 *  holds no private key), so the test must sign through the same async interface, not a raw key. */
interface Signer { sign(data: Uint8Array): Promise<Uint8Array>; }

const describeIntegration = process.env.CELLO_ENV === "local" ? describe : describe.skip;

const silent: Logger = { debug() {}, info() {}, warn() {}, error() {} };
const hex = (b: Uint8Array): string => Buffer.from(b).toString("hex");

describeIntegration("DOD-DIR-WRITE-1 — the signed-submission chokepoint", () => {
  let pool: Pool;
  const tag = `dw1-${Math.floor(Date.now() / 1000)}-${randomBytes(3).toString("hex")}`;
  const NODE = "us-east-1";

  // The portal's submitter key (in production this is an AWS KMS Ed25519 key — M10-D6, the portal
  // holds no private key; here we hold one because the TEST must be able to sign).
  let submitterPub: string;
  let submitterKey: Signer;
  // A key with the WRONG role, and a REVOKED key — both must be refused, and refused DIFFERENTLY.
  let registryPub: string;
  let registryKey: Signer;
  let revokedPub: string;
  let revokedKey: Signer;
  // A key that is not in the table at all.
  let strangerPub: string;
  let strangerKey: Signer;

  const nowSec = (): number => Math.floor(Date.now() / 1000);

  function envelope(over: Partial<TrustSignalEnvelope> = {}): TrustSignalEnvelope {
    return {
      subject_kind: "agent",
      subject: `${tag}-agent`,
      issuer_kind: "portal",
      issuer_pubkey: submitterPub,
      type: "phone",
      schema_version: 1,
      payload: new Uint8Array([1, 2, 3]),
      issued_at: nowSec(),
      expires_at: null,
      supersedes_hash: null,
      ...over,
    };
  }

  /** Build a signed submission exactly as the portal would. */
  async function signedSubmit(opts: {
    env?: TrustSignalEnvelope;
    priv?: Signer;
    pub?: string;
    claimedHash?: string;
    issuedAt?: number;
    scannerVersion?: string;
    bodyOverride?: Uint8Array;
  } = {}) {
    const env = opts.env ?? envelope();
    const envBytes = encodeTrustSignalEnvelope(env);
    const body = opts.bodyOverride ?? encodeCbor({
      v: 1,
      op: "submit",
      envelope: envBytes,
      signal_hash: opts.claimedHash ?? hex(hashTrustSignalEnvelope(env)),
      scanner_version: opts.scannerVersion ?? "scan-v1",
      issued_at: opts.issuedAt ?? nowSec(),
    });
    const priv = opts.priv ?? submitterKey;
    const pub = opts.pub ?? submitterPub;
    return {
      pool, logger: silent, acceptingNode: NODE, correlationId: "c1",
      bodyCbor: body,
      signerPubkeyHex: pub,
      signatureHex: hex(await priv.sign(buildSignalRequestTbs(body))),
    };
  }

  beforeAll(async () => {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL || "postgresql://postgres:dev@localhost:5433/cello_dev",
    });
    const mk = async (): Promise<[string, Signer]> => {
      const kp = generateKeypair();
      return [hex(await kp.getPublicKey()), kp];
    };
    [submitterPub, submitterKey] = await mk();
    [registryPub, registryKey] = await mk();
    [revokedPub, revokedKey] = await mk();
    [strangerPub, strangerKey] = await mk();

    await pool.query(
      `INSERT INTO authorized_issuers (pubkey, role, status, label) VALUES
         ($1,'submitter','active',$4), ($2,'registry','active',$4), ($3,'submitter','revoked',$4)`,
      [submitterPub, registryPub, revokedPub, tag],
    );
  });

  afterAll(async () => {
    if (pool) {
      await pool.query("DELETE FROM signal_records WHERE subject LIKE $1", [`${tag}%`]).catch(() => {});
      await pool.query("DELETE FROM authorized_issuers WHERE label = $1", [tag]).catch(() => {});
      await pool.end();
    }
  });

  beforeEach(async () => {
    await pool.query("DELETE FROM signal_records WHERE subject LIKE $1", [`${tag}%`]);
  });

  describe("the happy path", () => {
    it("accepts a correctly signed submission and stores the record", async () => {
      const env = envelope();
      const res = await submitSignal(await signedSubmit({ env }));
      expect(res.inserted).toBe(true);
      expect(res.signalHash).toBe(hex(hashTrustSignalEnvelope(env)));

      const { rows } = await pool.query(
        "SELECT * FROM signal_records WHERE signal_hash = $1", [res.signalHash]);
      expect(rows).toHaveLength(1);
      expect(rows[0].type).toBe("phone");
      expect(rows[0].accepting_node).toBe(NODE);
      expect(rows[0].scanner_version).toBe("scan-v1");
      expect(rows[0].status).toBe("active");
    });

    it("accepts a type it has NEVER seen — no enum, no gate, no deploy (INV-ZERO-BUMP)", async () => {
      // The milestone's architectural claim, at the write path — the first place it would be betrayed.
      const env = envelope({ type: "some_type_invented_next_year" });
      const res = await submitSignal(await signedSubmit({ env }));
      expect(res.inserted).toBe(true);
      const { rows } = await pool.query("SELECT type FROM signal_records WHERE signal_hash = $1", [res.signalHash]);
      expect(rows[0].type).toBe("some_type_invented_next_year");
    });
  });

  describe("INV-CHOKEPOINT — a hash enters ONLY through a signed, authorized submission", () => {
    it("REFUSES a submitter that is not in authorized_issuers at all", async () => {
      await expect(submitSignal(await signedSubmit({ pub: strangerPub, priv: strangerKey })))
        .rejects.toMatchObject({ reason: "unknown_issuer" });
      const { rows } = await pool.query("SELECT COUNT(*) AS n FROM signal_records WHERE subject LIKE $1", [`${tag}%`]);
      expect(Number(rows[0].n), "nothing may be written on a refused submission").toBe(0);
    });

    it("REFUSES a REVOKED issuer — and says so, distinctly from 'unknown'", async () => {
      // Three different refusals, three different causes. Collapsing them into one `unauthorized`
      // would tell the operator nothing about whether to enrol a key, un-revoke one, or fix a role.
      await expect(submitSignal(await signedSubmit({ pub: revokedPub, priv: revokedKey })))
        .rejects.toMatchObject({ reason: "issuer_revoked" });
    });

    it("REFUSES a key with the WRONG ROLE (registry key cannot submit signals)", async () => {
      await expect(submitSignal(await signedSubmit({ pub: registryPub, priv: registryKey })))
        .rejects.toMatchObject({ reason: "issuer_wrong_role" });
    });

    it("REFUSES a forged signature — an authorized pubkey with someone else's signature", async () => {
      // The attack: claim to be the portal, sign with a key you actually have.
      const args = await signedSubmit({ priv: strangerKey });  // signed by the stranger...
      args.signerPubkeyHex = submitterPub;                // ...but claiming to be the portal
      await expect(submitSignal(args)).rejects.toMatchObject({ reason: "signature_invalid" });
    });

    it("REFUSES a TAMPERED body — the signature covers the bytes, so any edit breaks it", async () => {
      const args = await signedSubmit();
      const tampered = Buffer.from(args.bodyCbor);
      tampered[tampered.length - 1] ^= 0xff;
      args.bodyCbor = new Uint8Array(tampered);
      await expect(submitSignal(args)).rejects.toMatchObject({ reason: "signature_invalid" });
    });

    it("REFUSES a HASH MISMATCH — the submitter's claim and its bytes disagree", async () => {
      // THE check that makes "notarized" mean anything. Without the re-hash, a submitter could hand
      // us the hash of one thing and the bytes of another, and the directory would notarize a hash
      // corresponding to nothing it ever saw. A check the submitter performs on its own behalf is
      // not a check.
      const lie = "f".repeat(64);
      await expect(submitSignal(await signedSubmit({ claimedHash: lie })))
        .rejects.toMatchObject({ reason: "envelope_hash_mismatch" });
    });

    it("the hash-mismatch error NAMES ITS CAUSE — both hashes, so the operator can see the drift", async () => {
      // An error that says "bad_request" sends a competent operator hunting. This one says exactly
      // what was claimed and what the bytes actually hash to.
      try {
        await submitSignal(await signedSubmit({ claimedHash: "f".repeat(64) }));
        throw new Error("should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(SubmitRejected);
        expect((e as SubmitRejected).detail).toMatch(/claimed f{64} but the envelope bytes hash to [0-9a-f]{64}/);
      }
    });

    it("REFUSES a NON-CANONICAL envelope rather than re-encoding it into something valid", async () => {
      // If we hashed our RE-ENCODING of what we think the bytes meant, we would notarize a hash the
      // submitter never computed — and it would verify nowhere.
      const env = envelope();
      const bad = Buffer.from(encodeTrustSignalEnvelope(env));
      bad[0] = 0x8c; // claim 12 elements in the array header; the preimage has exactly 11
      const body = encodeCbor({
        v: 1, op: "submit", envelope: new Uint8Array(bad),
        signal_hash: hex(hashTrustSignalEnvelope(env)), scanner_version: "scan-v1", issued_at: nowSec(),
      });
      await expect(submitSignal({
        pool, logger: silent, acceptingNode: NODE, correlationId: "c1", bodyCbor: body,
        signerPubkeyHex: submitterPub,
        signatureHex: hex(await submitterKey.sign(buildSignalRequestTbs(body))),
      })).rejects.toMatchObject({ reason: "envelope_undecodable" });
    });

    it("REFUSES a stale request (issued_at far from this node's clock)", async () => {
      await expect(submitSignal(await signedSubmit({ issuedAt: nowSec() - 3600 })))
        .rejects.toMatchObject({ reason: "stale_request" });
    });

    it("REFUSES a canonical-but-SEMANTICALLY-INVALID envelope with a NAMED rejection, not a raw throw", async () => {
      // The gap the review found: an out-of-enum subject_kind round-trips fine at the byte level (it
      // IS canonical CBOR), so it passes the form check — but the re-hash's own validation rejects it.
      // That rejection must flow through the named/logged path, not escape as an unmapped Error (which
      // would be an HTTP 500 with no `signal.submission.rejected` line, on the security-core module).
      const env = envelope();
      const arr = [
        "CELLO-TSIG-v1", "user" /* not account|agent */, env.subject, env.issuer_kind,
        env.issuer_pubkey, env.type, env.schema_version, env.payload, env.issued_at, null, null,
      ];
      const badEnvBytes = encodeCbor(arr);
      const body = encodeCbor({
        v: 1, op: "submit", envelope: badEnvBytes,
        // The signal_hash never gets compared — the envelope is refused for its invalid subject_kind
        // first — so any well-formed hex placeholder does.
        signal_hash: "0".repeat(64),
        scanner_version: "scan-v1", issued_at: nowSec(),
      });
      const err = await submitSignal({
        pool, logger: silent, acceptingNode: NODE, correlationId: "c1", bodyCbor: body,
        signerPubkeyHex: submitterPub,
        signatureHex: hex(await submitterKey.sign(buildSignalRequestTbs(body))),
      }).then(() => null, (e) => e);
      expect(err, "a semantic violation must be a named SubmitRejected, never a raw Error").toBeInstanceOf(SubmitRejected);
      expect((err as SubmitRejected).reason).toBe("envelope_invalid");
    });

    it("REQUIRES scanner_version INSIDE the signed body — it is unforgeable only there", async () => {
      const env = envelope();
      const body = encodeCbor({
        v: 1, op: "submit", envelope: encodeTrustSignalEnvelope(env),
        signal_hash: hex(hashTrustSignalEnvelope(env)), issued_at: nowSec(),
        // scanner_version omitted
      });
      await expect(submitSignal({
        pool, logger: silent, acceptingNode: NODE, correlationId: "c1", bodyCbor: body,
        signerPubkeyHex: submitterPub,
        signatureHex: hex(await submitterKey.sign(buildSignalRequestTbs(body))),
      })).rejects.toMatchObject({ reason: "malformed_request" });
    });
  });

  describe("REPLAY IS HARMLESS — the claim that buys us no nonce store, EARNED not asserted", () => {
    it("a duplicate submit is a strict NO-OP, not an error", async () => {
      const env = envelope();
      const first = await submitSignal(await signedSubmit({ env }));
      expect(first.inserted).toBe(true);
      const second = await submitSignal(await signedSubmit({ env }));
      expect(second.inserted, "a duplicate is a benign no-op — the portal retries, and a retry must be safe").toBe(false);

      const { rows } = await pool.query("SELECT COUNT(*) AS n FROM signal_records WHERE signal_hash = $1", [first.signalHash]);
      expect(Number(rows[0].n)).toBe(1);
    });

    it("THE NEGATIVE AC: replaying a captured submit after REVOCATION does not resurrect it", async () => {
      // This is the test the whole no-nonce-store decision rests on. If an ON CONFLICT DO UPDATE ever
      // creeps into the insert, a replayed submission silently flips a revoked signal back to active —
      // and an attacker does not need to break anything, only to REPLAY a request they captured.
      //
      // (The client-side store shipped exactly this bug one tier down and had to have it removed.
      // Once is a bug; twice is a pattern — so it is now tested on both sides.)
      const env = envelope();
      const captured = await signedSubmit({ env });          // capture the exact bytes, as an attacker would
      const { signalHash } = await submitSignal(captured);

      await pool.query(
        "UPDATE signal_records SET status='revoked', revoked_at=now() WHERE signal_hash=$1", [signalHash]);

      const replay = await submitSignal(captured);     // byte-identical replay of the captured request
      expect(replay.inserted).toBe(false);

      const { rows } = await pool.query("SELECT status FROM signal_records WHERE signal_hash = $1", [signalHash]);
      expect(rows[0].status, "a replayed submit must NEVER launder a revoked signal back to active").toBe("revoked");

      const { rows: eff } = await pool.query(
        "SELECT effective_status FROM signal_records_effective WHERE signal_hash = $1", [signalHash]);
      expect(eff[0].effective_status).toBe("revoked");
    });

    it("a CROSS-NODE replay cannot change STATUS, but DOES add a provenance row (pins M10-D20)", async () => {
      // The review's Finding B, made explicit. The same-node negative AC above only proves the
      // same-node no-op; this proves the cross-node behavior the design actually leans on. A captured,
      // validly-signed submit re-sent to a DIFFERENT node has no PK conflict (PK is
      // (signal_hash, accepting_node)), so it inserts a real second row.
      const env = envelope();
      const captured = await signedSubmit({ env });

      const atUsEast = await submitSignal({ ...captured, acceptingNode: "us-east-1" });
      expect(atUsEast.inserted).toBe(true);
      await pool.query("UPDATE signal_records SET status='revoked', revoked_at=now() WHERE signal_hash=$1 AND accepting_node='us-east-1'", [atUsEast.signalHash]);

      // Replay the IDENTICAL captured bytes to a second node.
      const atEuCentral = await submitSignal({ ...captured, acceptingNode: "eu-central-1" });
      expect(atEuCentral.inserted, "no PK conflict at a different node — a genuine second row is inserted").toBe(true);

      // Two provenance rows now exist. If the PK had regressed to a lone `signal_hash`, the second
      // insert would have hit ON CONFLICT DO NOTHING and inserted:false — so this line pins M10-D20.
      const { rows } = await pool.query("SELECT COUNT(*) AS n FROM signal_records WHERE signal_hash = $1", [atUsEast.signalHash]);
      expect(Number(rows[0].n)).toBe(2);

      // STATUS INTEGRITY HOLDS: revoked is monotonic across the hash group, so the replay to a fresh
      // node did NOT resurrect the signal. This is the guarantee that survives cross-node replay.
      const { rows: eff } = await pool.query(
        "SELECT effective_status, notarized_by FROM signal_records_effective WHERE signal_hash = $1", [atUsEast.signalHash]);
      expect(eff[0].effective_status, "a cross-node replay must not un-revoke a revoked signal").toBe("revoked");
      // ...and provenance breadth IS inflated (the documented caveat — bounded only by the skew window).
      expect(eff[0].notarized_by.sort()).toEqual(["eu-central-1", "us-east-1"]);
    });

    it("supersession rides the NEW record's own INSERT — the old row is never mutated", async () => {
      // So a replayed submit cannot launder a `revoked` row into `superseded` either: nothing about
      // the old row is written at submit time at all.
      const oldEnv = envelope();
      const { signalHash: oldHash } = await submitSignal(await signedSubmit({ env: oldEnv }));

      const newEnv = envelope({
        issued_at: nowSec() + 1,
        supersedes_hash: new Uint8Array(Buffer.from(oldHash, "hex")),
      });
      await submitSignal(await signedSubmit({ env: newEnv }));

      const { rows } = await pool.query(
        "SELECT effective_status FROM signal_records_effective WHERE signal_hash = $1", [oldHash]);
      expect(rows[0].effective_status).toBe("superseded");

      // ...and the old row's own `status` column was never touched. The derivation did the work.
      const { rows: raw } = await pool.query("SELECT status FROM signal_records WHERE signal_hash = $1", [oldHash]);
      expect(raw[0].status).toBe("active");
    });
  });

  describe("accepting_node is OURS, never the submitter's", () => {
    it("ignores any accepting_node the submitter might try to smuggle in", async () => {
      // It is half the primary key (M10-D20). A submitter that could choose it could deliberately
      // collide rows across nodes — the very thing the composite PK exists to make impossible.
      const env = envelope();
      const body = encodeCbor({
        v: 1, op: "submit", envelope: encodeTrustSignalEnvelope(env),
        signal_hash: hex(hashTrustSignalEnvelope(env)), scanner_version: "scan-v1", issued_at: nowSec(),
        accepting_node: "attacker-chosen-node",   // smuggled — and it is simply not read
      });
      const res = await submitSignal({
        pool, logger: silent, acceptingNode: NODE, correlationId: "c1", bodyCbor: body,
        signerPubkeyHex: submitterPub,
        signatureHex: hex(await submitterKey.sign(buildSignalRequestTbs(body))),
      });
      const { rows } = await pool.query("SELECT accepting_node FROM signal_records WHERE signal_hash = $1", [res.signalHash]);
      expect(rows[0].accepting_node).toBe(NODE);
    });
  });

  describe("an EMPTY authorized_issuers table refuses everything (ABSENT IS NOT FINE)", () => {
    it("a directory with no enrolled issuer notarizes NOTHING rather than falling open", async () => {
      // The unseeded state. It must be a closed door, not an open one — a directory that authorized
      // everyone because it had been told about no one would be the worst possible default.
      await pool.query("UPDATE authorized_issuers SET status='revoked' WHERE label = $1", [tag]);
      try {
        await expect(submitSignal(await signedSubmit())).rejects.toMatchObject({ reason: "issuer_revoked" });
      } finally {
        await pool.query("UPDATE authorized_issuers SET status='active' WHERE pubkey IN ($1,$2)", [submitterPub, registryPub]);
      }
    });
  });
});
