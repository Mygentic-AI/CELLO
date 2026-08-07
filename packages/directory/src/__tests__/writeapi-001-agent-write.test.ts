// WRITEAPI-001: POST /internal/agent-write — in-process contract test.
//
// Real HTTP server + a recording stub pool (no docker). Proves the write seam's discipline:
//   AC-001  auth + account-scoping (ownership) — A may write A's agent; A may NOT write B's agent;
//           unauthenticated is rejected; scoping derives from the ownership check, not a request field.
//   AC-002  payload discipline — only hashes/flags/sealed-ciphertext are accepted; plaintext, PII,
//           and tokens are rejected and nothing is persisted (no schema slot accepts them).
// The persistence against the real schema + the SI-001 directory dump are proven by the .live test.

import { describe, it, expect, afterEach } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import type pg from "pg";
import { createInternalApiServer } from "../internal-api-server.js";

const API_KEY = "test-writeapi-key-1234";
const ACCOUNT_A = "00000000-0000-0000-0000-00000000a001";
const AGENT_A = "agent-owned-by-A";
const AGENT_B = "agent-owned-by-B";
const noopLogger = { info() {}, warn() {}, error() {} };

// A recording stub pool: answers the ownership probe (agent_account_links WHERE agent_id AND
// account_id) — AGENT_A is owned by ACCOUNT_A only — and records every INSERT/UPDATE so a test can
// assert that a REJECTED write persisted nothing. Reads are classified by the SQL text.
//
// V59 moved the probe off `agent_profiles.account_id`, which is mutable and therefore never
// replicated, onto the append-only `agent_account_links`. Because this stub classifies BY SQL TEXT,
// the old matcher stopped recognising the probe and fell through to the write branch — which
// answers rowCount 1, i.e. "owned". Every caller became an owner: the cross-account test got 200
// where it demanded 403, and rejected writes were recorded as persisted. A stub that fails OPEN on
// an unrecognised query is worth noting — it turned a table rename into a silent authorization
// bypass in the tests rather than a missing-table error.
function makePool() {
  const writes: { text: string; values: unknown[] }[] = [];
  const pool = {
    async query(text: string, values: unknown[]) {
      if (/from\s+agent_account_links/i.test(text)) {
        const [agentId, accountId] = values as [string, string];
        const owned = agentId === AGENT_A && accountId === ACCOUNT_A;
        return { rows: owned ? [{ agent_id: agentId }] : [], rowCount: owned ? 1 : 0 };
      }
      // anything that is not the ownership probe is a persistence write
      writes.push({ text, values });
      return { rows: [{ id: "1" }], rowCount: 1 };
    },
  } as unknown as pg.Pool;
  return { pool, writes };
}

let server: Server | null = null;
function start(pool: pg.Pool): Promise<string> {
  server = createInternalApiServer({ pool, internalApiKey: API_KEY, logger: noopLogger, owningNodeId: "test-node" });
  return new Promise((resolve) => {
    server!.listen(0, () => {
      const { port } = server!.address() as AddressInfo;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}
afterEach(async () => {
  if (server) await new Promise<void>((r) => server!.close(() => r()));
  server = null;
});

function write(base: string, body: unknown, key?: string) {
  return fetch(`${base}/internal/agent-write`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(key ? { "x-cello-internal-api-key": key } : {}),
    },
    body: JSON.stringify(body),
  });
}

// A 64-char SHA-256 hex (a permitted trust-signal hash) and a plausibly-sealed ciphertext (>=48
// high-entropy bytes, base64) used across the permitted-payload cases.
const VALID_HASH = "a".repeat(64);
const SEALED_B64 = Buffer.from(
  Uint8Array.from({ length: 64 }, (_, i) => (i * 37 + 11) % 256),
).toString("base64");

describe("WRITEAPI-001 — POST /internal/agent-write", () => {
  // ─── AC-001: auth + account-scoping ──────────────────────────────────────────
  it("401 without the API key (and nothing persisted)", async () => {
    const { pool, writes } = makePool();
    const res = await write(await start(pool), {
      accountId: ACCOUNT_A,
      agentId: AGENT_A,
      writeKind: "revocation_flag",
      payload: { mode: "pause" },
    });
    expect(res.status).toBe(401);
    expect(writes).toHaveLength(0);
  });

  it("400 when accountId / agentId / writeKind is missing", async () => {
    const { pool } = makePool();
    const base = await start(pool);
    expect((await write(base, { agentId: AGENT_A, writeKind: "revocation_flag", payload: { mode: "pause" } }, API_KEY)).status).toBe(400);
  });

  it("AC-001: account A may write its OWN agent (revocation_flag accepted + persisted)", async () => {
    const { pool, writes } = makePool();
    const res = await write(await start(pool), {
      accountId: ACCOUNT_A,
      agentId: AGENT_A,
      writeKind: "revocation_flag",
      payload: { mode: "pause" },
    }, API_KEY);
    expect(res.status).toBe(200);
    expect((await res.json())).toMatchObject({ ok: true });
    // exactly one persistence write, to agent_suspensions
    expect(writes).toHaveLength(1);
    expect(writes[0].text).toMatch(/agent_suspensions/i);
  });

  it("AC-001 / SI-001: account A may NOT write account B's agent (403, nothing persisted)", async () => {
    const { pool, writes } = makePool();
    const res = await write(await start(pool), {
      accountId: ACCOUNT_A,
      agentId: AGENT_B, // not owned by A
      writeKind: "revocation_flag",
      payload: { mode: "pause" },
    }, API_KEY);
    expect(res.status).toBe(403);
    expect(writes).toHaveLength(0);
  });

  // ─── M10-D18: the trust-signal arms are RETIRED — revocation_flag is the only kind ───
  it("M10-D18: the retired trust_signal_hash + trust_signal_ciphertext arms are rejected (422, nothing persisted)", async () => {
    // Trust signals now enter ONLY through the signed chokepoint (POST /internal/signal/submit) and are
    // delivered via POST /internal/signal/deliver — never this API-key seam. Both former arms are
    // unsupported_kind now; the seam accepts revocation_flag alone.
    const { pool, writes } = makePool();
    const base = await start(pool);
    for (const arm of [
      { writeKind: "trust_signal_hash", payload: { signalKind: "webauthn", signalHash: VALID_HASH } },
      { writeKind: "trust_signal_ciphertext", payload: { ciphertext: SEALED_B64, signalKind: "webauthn" } },
    ]) {
      const res = await write(base, { accountId: ACCOUNT_A, agentId: AGENT_A, ...arm }, API_KEY);
      expect(res.status, `${arm.writeKind} must be rejected as unsupported_kind`).toBe(422);
    }
    expect(writes, "a retired arm persists nothing").toHaveLength(0);
  });

  // ─── AC-002 / SI-001: disallowed shapes rejected, nothing persisted ──────────
  it("AC-002: an unknown writeKind is rejected (422, nothing persisted)", async () => {
    const { pool, writes } = makePool();
    const res = await write(await start(pool), {
      accountId: ACCOUNT_A,
      agentId: AGENT_A,
      writeKind: "plaintext_blob",
      payload: { text: "anything" },
    }, API_KEY);
    expect(res.status).toBe(422);
    expect(writes).toHaveLength(0);
  });

  it("LEVER-2: a revocation_flag with mode=burn is accepted + persisted to agent_suspensions", async () => {
    const { pool, writes } = makePool();
    const res = await write(await start(pool), {
      accountId: ACCOUNT_A,
      agentId: AGENT_A,
      writeKind: "revocation_flag",
      payload: { mode: "burn" },
    }, API_KEY);
    expect(res.status).toBe(200);
    expect(writes).toHaveLength(1);
    expect(writes[0].text).toMatch(/agent_suspensions/i);
  });

  it("AC-002: a revocation_flag with a non-enum mode is rejected", async () => {
    const { pool, writes } = makePool();
    const res = await write(await start(pool), {
      accountId: ACCOUNT_A,
      agentId: AGENT_A,
      writeKind: "revocation_flag",
      payload: { mode: "destroy-everything-plaintext" },
    }, API_KEY);
    expect(res.status).toBe(422);
    expect(writes).toHaveLength(0);
  });

  it("AC-002 / SI-001: an extra/unexpected field in the payload is rejected (no plaintext slot)", async () => {
    const { pool, writes } = makePool();
    const res = await write(await start(pool), {
      accountId: ACCOUNT_A,
      agentId: AGENT_A,
      writeKind: "revocation_flag",
      payload: { mode: "pause", email: "operator@example.com" },
    }, API_KEY);
    expect(res.status).toBe(422);
    expect(writes).toHaveLength(0);
  });
});
