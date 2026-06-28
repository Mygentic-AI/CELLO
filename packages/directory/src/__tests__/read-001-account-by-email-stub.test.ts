// READ-001: POST /internal/account-by-email-stub
//
// In-process test of the endpoint contract — a real HTTP server on an ephemeral port with a
// recording stub pool (no docker). Proves: API-key auth, the parameterized lookup, 404 on miss,
// 200 {account_id} on hit. The full real-Postgres + portal-adapter path is exercised when the
// directory is stood up in the J-SPINE harness.

import { describe, it, expect, afterEach } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import type pg from "pg";
import { createInternalApiServer } from "../internal-api-server.js";

const API_KEY = "test-api-key-12345678";
const KNOWN_HASH = "a".repeat(64);
const KNOWN_ACCOUNT = "00000000-0000-0000-0000-0000000000a1";

const noopLogger = { info() {}, warn() {}, error() {} };

/** Stub pg.Pool that records the last query and returns canned rows for the known hash. */
function makePool() {
  const calls: { text: string; values: unknown[] }[] = [];
  const pool = {
    async query(text: string, values: unknown[]) {
      calls.push({ text, values });
      const hash = values?.[0];
      return hash === KNOWN_HASH
        ? { rows: [{ account_id: KNOWN_ACCOUNT }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    },
  } as unknown as pg.Pool;
  return { pool, calls };
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

function post(base: string, body: unknown, key?: string) {
  return fetch(`${base}/internal/account-by-email-stub`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(key ? { "x-cello-internal-api-key": key } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("READ-001 — /internal/account-by-email-stub", () => {
  it("401 without the API key", async () => {
    const { pool } = makePool();
    const base = await start(pool);
    expect((await post(base, { emailStubHash: KNOWN_HASH })).status).toBe(401);
  });

  it("401 with a wrong API key", async () => {
    const { pool } = makePool();
    const base = await start(pool);
    expect((await post(base, { emailStubHash: KNOWN_HASH }, "wrong")).status).toBe(401);
  });

  it("400 when emailStubHash is missing", async () => {
    const { pool } = makePool();
    const base = await start(pool);
    expect((await post(base, {}, API_KEY)).status).toBe(400);
  });

  it("404 for an unknown email stub (the signpost path)", async () => {
    const { pool } = makePool();
    const base = await start(pool);
    const res = await post(base, { emailStubHash: "b".repeat(64) }, API_KEY);
    expect(res.status).toBe(404);
  });

  it("200 { account_id } for a known email stub, queried by the hash", async () => {
    const { pool, calls } = makePool();
    const base = await start(pool);
    const res = await post(base, { emailStubHash: KNOWN_HASH }, API_KEY);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ account_id: KNOWN_ACCOUNT });
    // Lookup is parameterized by the email stub against user_accounts.
    expect(calls[0].text).toMatch(/user_accounts/i);
    expect(calls[0].values).toEqual([KNOWN_HASH]);
  });
});
