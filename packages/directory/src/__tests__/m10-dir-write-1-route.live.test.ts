/**
 * M10 / DOD-DIR-WRITE-1 — the wired HTTP route.
 *
 * `m10-dir-write-1-submit.test.ts` exercises `submitSignal()` directly. This proves the same door is
 * actually OPEN over HTTP: the route reads the body as raw CBOR bytes (not JSON), takes the pubkey
 * hint and signature from headers, calls the chokepoint, and maps a refusal to a 422 with its cause
 * named — never a bare 401/500. A green unit test on the handler proves nothing if the route never
 * calls it, or calls it wrong.
 *
 * Gated on CELLO_ENV=local (Docker Postgres).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { generateKeypair } from "@cello-protocol/crypto";
import { encodeCbor, encodeTrustSignalEnvelope, hashTrustSignalEnvelope, type TrustSignalEnvelope } from "@cello-protocol/protocol-types";
import { createInternalApiServer } from "../internal-api-server.js";
import { buildSignalRequestTbs } from "../signal-write.js";
import type { Logger } from "@cello-protocol/interfaces";

const describeIntegration = process.env.CELLO_ENV === "local" ? describe : describe.skip;
const noopLogger: Logger = { debug() {}, info() {}, warn() {}, error() {} };
const hex = (b: Uint8Array): string => Buffer.from(b).toString("hex");

describeIntegration("DOD-DIR-WRITE-1 — the wired /internal/signal/submit route", () => {
  let pool: Pool;
  let server: Server;
  let base: string;
  const tag = `dw1r-${Math.floor(Date.now() / 1000)}-${randomBytes(3).toString("hex")}`;
  let submitterPub: string;
  let submitterKey: { sign(d: Uint8Array): Promise<Uint8Array> };

  const nowSec = (): number => Math.floor(Date.now() / 1000);

  function envelope(over: Partial<TrustSignalEnvelope> = {}): TrustSignalEnvelope {
    return {
      subject_kind: "agent", subject: `${tag}-agent`, issuer_kind: "portal",
      issuer_pubkey: submitterPub, type: "phone", schema_version: 1,
      payload: new Uint8Array([1, 2, 3]), issued_at: nowSec(), expires_at: null, supersedes_hash: null,
      ...over,
    };
  }

  async function post(env: TrustSignalEnvelope, opts: { pub?: string; claimedHash?: string } = {}) {
    const body = encodeCbor({
      v: 1, op: "submit", envelope: encodeTrustSignalEnvelope(env),
      signal_hash: opts.claimedHash ?? hex(hashTrustSignalEnvelope(env)),
      scanner_version: "scan-v1", issued_at: nowSec(),
    });
    return fetch(`${base}/internal/signal/submit`, {
      method: "POST",
      headers: {
        "content-type": "application/cbor",
        "x-cello-signer-pubkey": opts.pub ?? submitterPub,
        "x-cello-signature": hex(await submitterKey.sign(buildSignalRequestTbs(body))),
      },
      body: Buffer.from(body),
    });
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL || "postgresql://postgres:dev@localhost:5433/cello_dev" });
    const kp = generateKeypair();
    submitterPub = hex(await kp.getPublicKey());
    submitterKey = kp;
    await pool.query(
      "INSERT INTO authorized_issuers (pubkey, role, status, label) VALUES ($1,'submitter','active',$2)",
      [submitterPub, tag]);
    server = createInternalApiServer({ pool, internalApiKey: "unused-here", logger: noopLogger, owningNodeId: "route-test-node" });
    await new Promise<void>((r) => server.listen(0, () => r()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    if (server) await new Promise<void>((r) => server.close(() => r()));
    await pool.query("DELETE FROM signal_records WHERE subject LIKE $1", [`${tag}%`]).catch(() => {});
    await pool.query("DELETE FROM authorized_issuers WHERE label = $1", [tag]).catch(() => {});
    await pool.end();
  });

  it("accepts a signed submission over HTTP and returns the stored hash + accepting node", async () => {
    const env = envelope();
    const res = await post(env);
    expect(res.status).toBe(200);
    const json = await res.json() as { ok: boolean; signal_hash: string; inserted: boolean };
    expect(json.ok).toBe(true);
    expect(json.signal_hash).toBe(hex(hashTrustSignalEnvelope(env)));
    expect(json.inserted).toBe(true);

    const { rows } = await pool.query("SELECT accepting_node FROM signal_records WHERE signal_hash = $1", [json.signal_hash]);
    // accepting_node is the SERVER's owningNodeId, never anything the caller sent.
    expect(rows[0].accepting_node).toBe("route-test-node");
  });

  it("maps a REFUSAL to 422 with the cause NAMED — not a bare 401/500", async () => {
    // An unknown issuer. The wire must carry the reason so the portal can act on it (enrol a key vs
    // fix a role vs retry), instead of a generic status the caller has to guess at.
    const stranger = generateKeypair();
    const strangerPub = hex(await stranger.getPublicKey());
    const env = envelope();
    const body = encodeCbor({
      v: 1, op: "submit", envelope: encodeTrustSignalEnvelope(env),
      signal_hash: hex(hashTrustSignalEnvelope(env)), scanner_version: "scan-v1", issued_at: nowSec(),
    });
    const res = await fetch(`${base}/internal/signal/submit`, {
      method: "POST",
      headers: {
        "content-type": "application/cbor",
        "x-cello-signer-pubkey": strangerPub,
        "x-cello-signature": hex(await stranger.sign(buildSignalRequestTbs(body))),
      },
      body: Buffer.from(body),
    });
    expect(res.status).toBe(422);
    const json = await res.json() as { error: string; detail: string };
    expect(json.error).toBe("unknown_issuer");
    expect(json.detail).toMatch(/not an authorized issuer/);
  });

  it("maps a hash mismatch to 422 with envelope_hash_mismatch", async () => {
    const res = await post(envelope(), { claimedHash: "f".repeat(64) });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toBe("envelope_hash_mismatch");
  });

  it("a duplicate over HTTP returns 200 inserted:false — a retry is safe", async () => {
    const env = envelope({ subject: `${tag}-dup` });
    expect(((await (await post(env)).json()) as { inserted: boolean }).inserted).toBe(true);
    const second = await post(env);
    expect(second.status).toBe(200);
    expect(((await second.json()) as { inserted: boolean }).inserted).toBe(false);
  });
});
