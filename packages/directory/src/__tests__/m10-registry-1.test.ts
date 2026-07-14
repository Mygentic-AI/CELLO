/**
 * M10 / DOD-REGISTRY-1 — the type registry as served signed data (directory half).
 *
 * The directory verifies only the OUTER role=`registry` submission signature and serves the document
 * as OPAQUE BYTES (INV-DIR-DUMB) — it never parses the registry, and the CLIENT verifies the inner
 * signature against its pinned key. A registry update requires NO release anywhere (INV-ZERO-BUMP):
 * the portal publishes a new version, clients poll it. These tests are the directory side.
 *
 * Gated on CELLO_ENV=local (Docker Postgres).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Pool } from "pg";
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { generateKeypair } from "@cello-protocol/crypto";
import { encodeCbor } from "@cello-protocol/protocol-types";
import { publishRegistry, getRegistryDocument, buildSignalRequestTbs } from "../signal-write.js";
import { createInternalApiServer } from "../internal-api-server.js";
import type { Logger } from "@cello-protocol/interfaces";

const describeIntegration = process.env.CELLO_ENV === "local" ? describe : describe.skip;
const silent: Logger = { debug() {}, info() {}, warn() {}, error() {} };
const hex = (b: Uint8Array): string => Buffer.from(b).toString("hex");
interface Signer { sign(d: Uint8Array): Promise<Uint8Array>; }

describeIntegration("DOD-REGISTRY-1 — the type registry (directory half)", () => {
  let pool: Pool;
  const tag = `reg1-${Math.floor(Date.now() / 1000)}-${randomBytes(3).toString("hex")}`;
  let regKey: Signer, regPub: string;       // dedicated registry key (M10-D9)
  let subKey: Signer, subPub: string;       // a submitter key — must NOT be able to publish
  const nowSec = (): number => Math.floor(Date.now() / 1000);

  /** A registry document is opaque bytes to the directory. Its real shape (canonical-JSON + inner
   *  signature) is the CLIENT's concern; here it is just some bytes we round-trip. */
  const doc = (label: string): Uint8Array => new TextEncoder().encode(JSON.stringify({ registry: label, types: {} }));

  async function publishArgs(document: Uint8Array, version: number, signer: Signer, pub: string) {
    const body = encodeCbor({ v: 1, op: "registry-publish", document, version, issued_at: nowSec() });
    return {
      pool, logger: silent, correlationId: "c", bodyCbor: body,
      signerPubkeyHex: pub, signatureHex: hex(await signer.sign(buildSignalRequestTbs(body))),
    };
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL || "postgresql://postgres:dev@localhost:5433/cello_dev" });
    const mk = async (): Promise<[Signer, string]> => { const kp = generateKeypair(); return [kp, hex(await kp.getPublicKey())]; };
    [regKey, regPub] = await mk(); [subKey, subPub] = await mk();
    await pool.query(
      "INSERT INTO authorized_issuers (pubkey, role, status, label) VALUES ($1,'registry','active',$3),($2,'submitter','active',$3)",
      [regPub, subPub, tag]);
  });

  afterAll(async () => {
    if (pool) {
      await pool.query("DELETE FROM registry_documents WHERE id=1").catch(() => {});
      await pool.query("DELETE FROM authorized_issuers WHERE label=$1", [tag]).catch(() => {});
      await pool.end();
    }
  });

  beforeEach(async () => { await pool.query("DELETE FROM registry_documents WHERE id=1"); });

  it("a registry-role key publishes; the served bytes round-trip exactly", async () => {
    const d = doc("v1");
    const res = await publishRegistry(await publishArgs(d, 1, regKey, regPub));
    expect(res.stored).toBe(true);
    const got = await getRegistryDocument(pool);
    expect(got).not.toBeNull();
    expect(got!.version).toBe(1);
    expect(new Uint8Array(got!.document)).toEqual(d); // opaque bytes, unchanged
  });

  it("REFUSES a submitter-role key — publishing the registry needs the dedicated registry role", async () => {
    // A submission key must not be able to overwrite the served registry (M10-D9 — the registry key
    // is dedicated, not the submission key).
    await expect(publishRegistry(await publishArgs(doc("evil"), 1, subKey, subPub)))
      .rejects.toMatchObject({ reason: "issuer_wrong_role" });
    expect(await getRegistryDocument(pool)).toBeNull();
  });

  it("REFUSES a forged signature and an unknown key", async () => {
    const stranger = generateKeypair();
    await expect(publishRegistry(await publishArgs(doc("x"), 1, stranger, hex(await stranger.getPublicKey()))))
      .rejects.toMatchObject({ reason: "unknown_issuer" });
    // registry pubkey, signed by a stranger
    const args = await publishArgs(doc("x"), 1, stranger, regPub);
    await expect(publishRegistry(args)).rejects.toMatchObject({ reason: "signature_invalid" });
  });

  it("ANTI-ROLLBACK: only a STRICTLY GREATER version replaces; lower AND equal are refused", async () => {
    await publishRegistry(await publishArgs(doc("v2"), 2, regKey, regPub));

    // A rollback to v1 is refused server-side (hygiene) — not an error, just not stored.
    const rollback = await publishRegistry(await publishArgs(doc("v1-rollback"), 1, regKey, regPub));
    expect(rollback.stored).toBe(false);
    expect((await getRegistryDocument(pool))!.version).toBe(2);
    expect(new Uint8Array((await getRegistryDocument(pool))!.document)).toEqual(doc("v2"));

    // An EQUAL version with DIFFERENT bytes must NOT overwrite — otherwise the version number would
    // stop uniquely identifying content (a cached v2 client and a fresh v2 client would disagree).
    // This is the case the strictly-greater `>` guards; a `>=` would silently store the new bytes.
    const equal = await publishRegistry(await publishArgs(doc("v2-DIFFERENT-bytes"), 2, regKey, regPub));
    expect(equal.stored, "an equal version must not overwrite with different bytes").toBe(false);
    expect(new Uint8Array((await getRegistryDocument(pool))!.document)).toEqual(doc("v2")); // unchanged

    // A forward publish replaces.
    const forward = await publishRegistry(await publishArgs(doc("v3"), 3, regKey, regPub));
    expect(forward.stored).toBe(true);
    expect((await getRegistryDocument(pool))!.version).toBe(3);
  });

  it("ADDING A TYPE is a data update, not a deploy — the directory stores an unseen type OPAQUELY", async () => {
    // INV-ZERO-BUMP at the registry. This cannot prove the ABSENCE of a type branch (that is a code-
    // structure property), but it pins the observable half: the directory accepts and serves a
    // registry naming a type it has never seen, unchanged, with no per-type handling. If someone added
    // a directory-side type validator, a registry naming `some_type_invented_today` would be the thing
    // it choked on.
    const withNewType = new TextEncoder().encode(JSON.stringify({ types: { some_type_invented_today: { class: 2 } } }));
    const res = await publishRegistry(await publishArgs(withNewType, 1, regKey, regPub));
    expect(res.stored).toBe(true);
    expect(new Uint8Array((await getRegistryDocument(pool))!.document)).toEqual(withNewType);
  });

  it("REFUSES a negative version", async () => {
    const bad = encodeCbor({ v: 1, op: "registry-publish", document: doc("x"), version: -1, issued_at: nowSec() });
    await expect(publishRegistry({
      pool, logger: silent, correlationId: "c", bodyCbor: bad,
      signerPubkeyHex: regPub, signatureHex: hex(await regKey.sign(buildSignalRequestTbs(bad))),
    })).rejects.toMatchObject({ reason: "malformed_request" });
  });

  it("REFUSES a version past MAX_SAFE_INTEGER — precision loss would corrupt the anti-rollback ordering", async () => {
    const body = encodeCbor({ v: 1, op: "registry-publish", document: doc("x"), version: Number.MAX_SAFE_INTEGER + 2, issued_at: nowSec() });
    await expect(publishRegistry({
      pool, logger: silent, correlationId: "c", bodyCbor: body,
      signerPubkeyHex: regPub, signatureHex: hex(await regKey.sign(buildSignalRequestTbs(body))),
    })).rejects.toMatchObject({ reason: "malformed_request" });
  });

  it("REFUSES a MISSING document (the branch T6 previously named but never hit)", async () => {
    const body = encodeCbor({ v: 1, op: "registry-publish", version: 1, issued_at: nowSec() }); // no document
    await expect(publishRegistry({
      pool, logger: silent, correlationId: "c", bodyCbor: body,
      signerPubkeyHex: regPub, signatureHex: hex(await regKey.sign(buildSignalRequestTbs(body))),
    })).rejects.toMatchObject({ reason: "malformed_request" });
  });

  describe("the served route", () => {
    let server: Server;
    let base: string;
    beforeAll(async () => {
      server = createInternalApiServer({ pool, internalApiKey: "unused", logger: silent, owningNodeId: "reg-node" });
      await new Promise<void>((r) => server.listen(0, () => r()));
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });
    afterAll(async () => { if (server) await new Promise<void>((r) => server.close(() => r())); });

    it("GET /registry serves the stored bytes verbatim with the version header", async () => {
      const d = doc("served");
      await publishRegistry(await publishArgs(d, 5, regKey, regPub));
      const res = await fetch(`${base}/registry`);
      expect(res.status).toBe(200);
      expect(res.headers.get("x-cello-registry-version")).toBe("5");
      const bytes = new Uint8Array(await res.arrayBuffer());
      expect(bytes).toEqual(d);
    });

    it("GET /registry returns 404 when nothing is published — absent registry is not an error", async () => {
      await pool.query("DELETE FROM registry_documents WHERE id=1");
      const res = await fetch(`${base}/registry`);
      // 404 is the honest "no registry" signal (INV-TYPE-CARRY: every type is then unclassified). The
      // client treats this as all-unclassified, never as a hard failure.
      expect(res.status).toBe(404);
      expect((await res.json() as { error: string }).error).toBe("no_registry_published");
    });

    it("POST /internal/signal/registry-publish over HTTP, 422 on wrong role", async () => {
      const args = await publishArgs(doc("http"), 9, subKey, subPub);
      const res = await fetch(`${base}/internal/signal/registry-publish`, {
        method: "POST",
        headers: { "content-type": "application/cbor", "x-cello-signer-pubkey": subPub, "x-cello-signature": args.signatureHex },
        body: Buffer.from(args.bodyCbor),
      });
      expect(res.status).toBe(422);
      expect((await res.json() as { error: string }).error).toBe("issuer_wrong_role");
    });
  });
});
