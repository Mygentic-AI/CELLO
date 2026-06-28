// READ-001 / PRESENCE-001: POST /internal/agents-by-account — in-process contract test.
//
// Real HTTP server + a recording stub pool (no docker). Proves auth, routing, account-scoping
// param, and the response shape. The read-rule SQL itself (online iff row online AND owning node
// fresh) is proven against the real schema by presence-001-repository.test.ts.

import { describe, it, expect, afterEach } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import type pg from "pg";
import { createInternalApiServer } from "../internal-api-server.js";

const API_KEY = "test-api-key-12345678";
const ACCOUNT = "00000000-0000-0000-0000-0000000000e4";
const noopLogger = { info() {}, warn() {}, error() {} };

function makePool() {
  const calls: { text: string; values: unknown[] }[] = [];
  const pool = {
    async query(text: string, values: unknown[]) {
      calls.push({ text, values });
      if (/agent_profiles/i.test(text)) {
        return {
          rows: [
            { k_local_pubkey: "kp-online", online: true, last_seen_at: new Date("2026-06-27T10:00:00Z") },
            { k_local_pubkey: "kp-offline", online: false, last_seen_at: new Date("2026-06-26T10:00:00Z") },
          ],
          rowCount: 2,
        };
      }
      return { rows: [], rowCount: 0 };
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
  return fetch(`${base}/internal/agents-by-account`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(key ? { "x-cello-internal-api-key": key } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("READ-001 — /internal/agents-by-account", () => {
  it("401 without the API key", async () => {
    const { pool } = makePool();
    expect((await post(await start(pool), { accountId: ACCOUNT })).status).toBe(401);
  });

  it("400 when accountId is missing", async () => {
    const { pool } = makePool();
    expect((await post(await start(pool), {}, API_KEY)).status).toBe(400);
  });

  it("200 returns the account's agents with presence, scoped by accountId", async () => {
    const { pool, calls } = makePool();
    const res = await post(await start(pool), { accountId: ACCOUNT }, API_KEY);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { agents: { k_local_pubkey: string; online: boolean }[] };
    expect(body.agents).toHaveLength(2);
    expect(body.agents[0]).toMatchObject({ k_local_pubkey: "kp-online", online: true });
    expect(body.agents[1]).toMatchObject({ k_local_pubkey: "kp-offline", online: false });
    // The read is scoped by the account id from the body.
    expect(calls[0].values[0]).toBe(ACCOUNT);
  });
});
