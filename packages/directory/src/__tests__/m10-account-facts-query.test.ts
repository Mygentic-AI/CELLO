/**
 * M10 / DOD-MINT-INTERNAL-1 dependency — the verified-account-facts read (determination §3.3 arm c).
 *
 * The mint reads this to compose phone/email envelopes. It returns PRESENCE + STUB HASHES ONLY —
 * never a phone number, never an email address (the portal holds no phone data; the fact lives here).
 * Signed with a submitter key. A missing account is `found:false`, distinct from an account with no
 * verified email.
 *
 * Gated on CELLO_ENV=local (Docker Postgres).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { randomBytes, createHash, randomUUID } from "node:crypto";
import { generateKeypair } from "@cello-protocol/crypto";
import { encodeCbor } from "@cello-protocol/protocol-types";
import { queryAccountFacts, buildSignalRequestTbs } from "../signal-write.js";
import type { Logger } from "@cello-protocol/interfaces";

const describeIntegration = process.env.CELLO_ENV === "local" ? describe : describe.skip;
const silent: Logger = { debug() {}, info() {}, warn() {}, error() {} };
const hex = (b: Uint8Array): string => Buffer.from(b).toString("hex");
interface Signer { sign(d: Uint8Array): Promise<Uint8Array>; }

describeIntegration("DOD-MINT-INTERNAL-1 dep — verified-account-facts query (arm c)", () => {
  let pool: Pool;
  const tag = `af-${Math.floor(Date.now() / 1000)}-${randomBytes(3).toString("hex")}`;
  let subKey: Signer, subPub: string, regKey: Signer, regPub: string;
  const acctBoth = randomUUID();   // phone + email verified
  const acctPhoneOnly = randomUUID();
  const nowSec = (): number => Math.floor(Date.now() / 1000);

  async function queryArgs(accountId: string, signer: Signer, pub: string) {
    const body = encodeCbor({ v: 1, op: "query", query: "account-facts", account_id: accountId, issued_at: nowSec() });
    return {
      pool, logger: silent, correlationId: "c", bodyCbor: body,
      signerPubkeyHex: pub, signatureHex: hex(await signer.sign(buildSignalRequestTbs(body))),
    };
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL || "postgresql://postgres:dev@localhost:5433/cello_dev" });
    const mk = async (): Promise<[Signer, string]> => { const kp = generateKeypair(); return [kp, hex(await kp.getPublicKey())]; };
    [subKey, subPub] = await mk(); [regKey, regPub] = await mk();
    await pool.query(
      "INSERT INTO authorized_issuers (pubkey, role, status, label) VALUES ($1,'submitter','active',$3),($2,'registry','active',$3)",
      [subPub, regPub, tag]);
    const stub = (s: string): string => createHash("sha256").update(tag + s).digest("hex");
    await pool.query(
      "INSERT INTO user_accounts (account_id, phone_stub_hash, email_stub_hash, chain_hash) VALUES ($1,$2,$3,'seed')",
      [acctBoth, stub("both-phone"), stub("both-email")]);
    await pool.query(
      "INSERT INTO user_accounts (account_id, phone_stub_hash, email_stub_hash, chain_hash) VALUES ($1,$2,NULL,'seed')",
      [acctPhoneOnly, stub("phoneonly-phone")]);
  });

  afterAll(async () => {
    if (pool) {
      await pool.query("DELETE FROM user_accounts WHERE account_id = ANY($1)", [[acctBoth, acctPhoneOnly]]).catch(() => {});
      await pool.query("DELETE FROM authorized_issuers WHERE label = $1", [tag]).catch(() => {});
      await pool.end();
    }
  });

  it("returns phone + email PRESENCE and STUBS for a fully-verified account", async () => {
    const res = await queryAccountFacts(await queryArgs(acctBoth, subKey, subPub));
    expect(res.found).toBe(true);
    if (!res.found) throw new Error("unreachable");
    expect(res.facts.phone.verified).toBe(true);
    expect(res.facts.email.verified).toBe(true);
    // The stubs are the directory's own SHA-256 stubs — hashes, not recoverable PII.
    expect(res.facts.phone.stub).toMatch(/^[0-9a-f]{64}$/);
    expect(res.facts.email.stub).toMatch(/^[0-9a-f]{64}$/);
  });

  it("distinguishes 'no verified email' from 'no such account'", async () => {
    const phoneOnly = await queryAccountFacts(await queryArgs(acctPhoneOnly, subKey, subPub));
    expect(phoneOnly.found).toBe(true);
    if (!phoneOnly.found) throw new Error("unreachable");
    expect(phoneOnly.facts.phone.verified).toBe(true);
    expect(phoneOnly.facts.email.verified, "email not verified — but the account EXISTS").toBe(false);
    expect(phoneOnly.facts.email.stub).toBeNull();

    const missing = await queryAccountFacts(await queryArgs(randomUUID(), subKey, subPub));
    expect(missing.found, "a missing account is found:false, NOT an empty fact set").toBe(false);
  });

  it("NEVER returns recoverable PII — only presence booleans and stub hashes", async () => {
    // The whole point: the mint attests a fact without the directory (or the mint) ever handling the
    // number or address. Assert the response shape carries nothing but booleans and 64-hex stubs.
    const res = await queryAccountFacts(await queryArgs(acctBoth, subKey, subPub));
    if (!res.found) throw new Error("unreachable");
    const json = JSON.stringify(res);
    // No field name that would carry raw PII, and every stub is a 64-hex hash.
    expect(json).not.toMatch(/"(number|address|phone_number|email_address)"/i);
    for (const stub of [res.facts.phone.stub, res.facts.email.stub]) {
      if (stub !== null) expect(stub).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("REFUSES an unknown key, a forged signature, and a registry-role key", async () => {
    const stranger = generateKeypair();
    await expect(queryAccountFacts(await queryArgs(acctBoth, stranger, hex(await stranger.getPublicKey()))))
      .rejects.toMatchObject({ reason: "unknown_issuer" });
    // authorized submitter pubkey, signed by the stranger
    const forged = await queryArgs(acctBoth, stranger, subPub);
    await expect(queryAccountFacts(forged)).rejects.toMatchObject({ reason: "signature_invalid" });
    // a registry key is the wrong role for a facts read (the reader is the minting submitter)
    await expect(queryAccountFacts(await queryArgs(acctBoth, regKey, regPub)))
      .rejects.toMatchObject({ reason: "issuer_wrong_role" });
  });

  it("REFUSES a stale query", async () => {
    const body = encodeCbor({ v: 1, op: "query", query: "account-facts", account_id: acctBoth, issued_at: nowSec() - 3600 });
    await expect(queryAccountFacts({
      pool, logger: silent, correlationId: "c", bodyCbor: body,
      signerPubkeyHex: subPub, signatureHex: hex(await subKey.sign(buildSignalRequestTbs(body))),
    })).rejects.toMatchObject({ reason: "stale_request" });
  });
});
