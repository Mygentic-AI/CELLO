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

// A recording stub pool: answers the ownership probe (agent_profiles WHERE agent_id AND account_id)
// — AGENT_A is owned by ACCOUNT_A only — and records every INSERT/UPDATE so a test can assert that a
// REJECTED write persisted nothing. Reads are classified by the SQL text.
function makePool() {
  const writes: { text: string; values: unknown[] }[] = [];
  const pool = {
    async query(text: string, values: unknown[]) {
      if (/from\s+agent_profiles/i.test(text)) {
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
  server = createInternalApiServer({ pool, internalApiKey: API_KEY, logger: noopLogger });
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

  // ─── AC-002: payload discipline — permitted shapes accepted ──────────────────
  it("AC-002: a trust-signal HASH (64-hex) is accepted + persisted to the identity tree", async () => {
    const { pool, writes } = makePool();
    const res = await write(await start(pool), {
      accountId: ACCOUNT_A,
      agentId: AGENT_A,
      writeKind: "trust_signal_hash",
      payload: { signalKind: "webauthn", signalHash: VALID_HASH },
    }, API_KEY);
    expect(res.status).toBe(200);
    expect(writes).toHaveLength(1);
    expect(writes[0].text).toMatch(/identity_tree_entries/i);
  });

  it("AC-002: sealed CIPHERTEXT is accepted + enqueued to the pickup queue", async () => {
    const { pool, writes } = makePool();
    const res = await write(await start(pool), {
      accountId: ACCOUNT_A,
      agentId: AGENT_A,
      writeKind: "trust_signal_ciphertext",
      payload: { ciphertext: SEALED_B64, signalKind: "webauthn" },
    }, API_KEY);
    expect(res.status).toBe(200);
    expect(writes).toHaveLength(1);
    expect(writes[0].text).toMatch(/pickup_queue/i);
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

  it("AC-002 / SI-001: a raw email smuggled as a 'hash' is rejected (not hex)", async () => {
    const { pool, writes } = makePool();
    const res = await write(await start(pool), {
      accountId: ACCOUNT_A,
      agentId: AGENT_A,
      writeKind: "trust_signal_hash",
      payload: { signalKind: "webauthn", signalHash: "operator@example.com" },
    }, API_KEY);
    expect(res.status).toBe(422);
    expect(writes).toHaveLength(0);
  });

  it("AC-002: sealed ciphertext in base64url (and MIME-wrapped) encoding is accepted", async () => {
    const raw = Uint8Array.from({ length: 64 }, (_, i) => (i * 41 + 19) % 256);
    const b64url = Buffer.from(raw).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const { pool, writes } = makePool();
    const base = await start(pool);
    const r1 = await write(base, {
      accountId: ACCOUNT_A, agentId: AGENT_A, writeKind: "trust_signal_ciphertext", payload: { ciphertext: b64url, signalKind: "webauthn" },
    }, API_KEY);
    expect(r1.status).toBe(200);
    // wrapped standard base64 (embedded newlines) is tolerated too
    const wrapped = Buffer.from(raw).toString("base64").replace(/(.{20})/g, "$1\n");
    const r2 = await write(base, {
      accountId: ACCOUNT_A, agentId: AGENT_A, writeKind: "trust_signal_ciphertext", payload: { ciphertext: wrapped, signalKind: "webauthn" },
    }, API_KEY);
    expect(r2.status).toBe(200);
    expect(writes).toHaveLength(2);
    expect(writes.every((w) => /pickup_queue/i.test(w.text))).toBe(true);
  });

  it("AC-002 / SI-001: a plaintext token smuggled as 'ciphertext' is rejected (all-printable)", async () => {
    const { pool, writes } = makePool();
    // base64 of a printable OAuth-looking token — valid base64, but decodes to plaintext ASCII.
    const tokenB64 = Buffer.from("ya29.A0ARrdaM-secret-oauth-token-value-here").toString("base64");
    const res = await write(await start(pool), {
      accountId: ACCOUNT_A,
      agentId: AGENT_A,
      writeKind: "trust_signal_ciphertext",
      payload: { ciphertext: tokenB64, signalKind: "webauthn" },
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
