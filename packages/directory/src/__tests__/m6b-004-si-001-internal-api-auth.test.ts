/**
 * SI-001 (CELLO-M6B-004) — every `/internal/*` route has a door, and no route answers a stranger.
 *
 * ─── What this file used to be, and why it never ran ───────────────────────────────────────────
 *
 * It fetched `http://localhost:9090/health` and `http://localhost:8081/internal/pre-authorize`,
 * against a directory server it did not start. Its own comments said so: *"This test assumes the
 * directory server is already running via docker-compose"*, *"we'll test against the assumption"*,
 * *"if docker-compose does not expose this port, this test will fail with connection refused"*.
 *
 * Nothing in the documented dev loop starts that server, so the `beforeAll` polled for ten seconds
 * and threw. Vitest reports a failed `beforeAll` by marking its tests **skipped** — three ↓ lines,
 * no red — and without `CELLO_ENV=local` the whole suite is `describe.skip` anyway. So a test
 * written to prove that unauthenticated callers are refused had, in practice, proven nothing since
 * it was written. `DOD-M15-DIRECTORY-ROT-1`.
 *
 * ─── Why it now checks something stronger than it originally did ───────────────────────────────
 *
 * The old file tested ONE route. The invariant is about all of them, and the reason is in SI-001's
 * own wording: **the ALB forwards every `/internal/*` request** and the directory code — not the
 * load balancer — is what refuses. There is no perimeter to fall back on. Each route carries its own
 * inline check, which is precisely the shape where the sixteenth route ships without one.
 *
 * So the routes are enumerated FROM THE SERVER'S SOURCE rather than listed here. A new route is
 * covered the day it is added, by nobody remembering to do anything.
 *
 * ─── The two doors ─────────────────────────────────────────────────────────────────────────────
 *
 * Not every route uses the bearer key, and a test demanding 401 everywhere would be wrong:
 *
 *   - **Bearer key** (`x-cello-internal-api-key`) — the portal-facing reads and writes. No key ⇒ 401.
 *   - **Request signature** — the `/internal/signal/*` chokepoint (M10-D10, INV-CHOKEPOINT) is
 *     authenticated by an Ed25519 signature over canonical CBOR, checked against the authorized
 *     issuers set. That is a stronger door than a shared static secret, and it deliberately does not
 *     carry the bearer check. An unsigned request is refused with a NAMED reason, not a bare 401.
 *
 * What the invariant actually forbids is a route with **neither**. That is what is asserted: no
 * `/internal/*` route answers 2xx to a caller carrying no credentials at all.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg, { Pool } from "pg";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createInternalApiServer } from "../internal-api-server.js";
import { txnPool } from "./helpers/txn-pool.js";
import type { Logger } from "@cello-protocol/interfaces";

const describeIntegration = process.env.CELLO_ENV === "local" ? describe : describe.skip;
const noopLogger: Logger = { debug() {}, info() {}, warn() {}, error() {} };

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * The routes the server actually handles, read out of its source.
 *
 * A hand-kept array here would be a second list to maintain, and the whole failure this file is
 * recovering from is a check that stopped tracking the thing it was checking.
 */
function internalRoutesFromSource(): string[] {
  const src = readFileSync(join(HERE, "..", "internal-api-server.ts"), "utf8");
  const found = new Set<string>();
  for (const m of src.matchAll(/req\.url === "(\/internal\/[^"]+)"/g)) found.add(m[1]);
  return [...found].sort();
}

describeIntegration("SI-001: no /internal/* route answers a caller with no credentials", () => {
  let pool: Pool;
  let client: pg.PoolClient;
  let server: Server;
  let base: string;
  const API_KEY = "test-api-key-12345678";

  beforeAll(async () => {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL || "postgresql://postgres:dev@localhost:5433/cello_dev",
    });
    // A real pool, so a route that reaches the database behaves as it would in production — but
    // inside a transaction that is rolled back, so an unauthenticated probe that DID get through
    // cannot leave a row behind for another suite to trip over.
    client = await pool.connect();
    await client.query("BEGIN");

    server = createInternalApiServer({
      pool: txnPool(client),
      internalApiKey: API_KEY,
      logger: noopLogger,
      owningNodeId: "si-001-test-node",
    });
    await new Promise<void>((r) => server.listen(0, () => r()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    if (server) await new Promise<void>((r) => server.close(() => r()));
    if (client) {
      await client.query("ROLLBACK").catch(() => { /* the connection is going back regardless */ });
      client.release();
    }
    await pool.end();
  });

  /** POST with whatever headers are given — never any credentials unless a test adds them. */
  const post = (path: string, headers: Record<string, string> = {}): Promise<Response> =>
    fetch(`${base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({ agentId: "test-agent-id", accountId: "00000000-0000-0000-0000-000000000000" }),
    });

  it("enumeration finds the routes — a scan that quietly matched nothing would pass everything below", () => {
    const routes = internalRoutesFromSource();
    expect(routes, "no /internal/* routes were found in internal-api-server.ts").not.toEqual([]);
    // The server carried 15 routes when this was written. The floor is a vacuous-pass guard, not a
    // ceiling: routes may be added freely, and each new one is checked by the tests below.
    expect(routes.length).toBeGreaterThanOrEqual(15);
    expect(routes).toContain("/internal/pre-authorize");
    expect(routes).toContain("/internal/signal/submit");
  });

  it("the signature-door routes refuse an UNSIGNED request — never 2xx, never a bare 500", async () => {
    /**
     * The `/internal/signal/*` chokepoint carries no bearer check by design, so the assertion here
     * is the weaker one: an unsigned caller must be refused, with a status that names a client
     * fault rather than a server one.
     *
     * BOUND, stated because a green line here should not be read as more than it is: this cannot
     * distinguish "refused because unsigned" from "refused because the body was nonsense", since a
     * doorless route would also 4xx on this body. It catches a signal route that ANSWERS. The exact
     * refusal reasons are the signal suites' subject.
     */
    const signalRoutes = internalRoutesFromSource().filter((r) => r.startsWith("/internal/signal"));
    expect(signalRoutes.length, "the chokepoint routes should exist to be checked").toBeGreaterThan(0);
    for (const route of signalRoutes) {
      const res = await post(route);
      expect(res.status, `${route} answered an unsigned caller`).toBeGreaterThanOrEqual(400);
      expect(res.status, `${route} failed INSIDE rather than at the door on an unsigned request`).toBeLessThan(500);
    }
  });

  it("the bearer-key routes refuse with 401 specifically, and say why", async () => {
    /**
     * THIS is the load-bearing one, and it covers every route that is not on the signature door —
     * including one added tomorrow, because the list comes from the source.
     *
     * It must be an exact 401, not merely "not 2xx". A route whose auth check was removed still
     * rejects this deliberately-thin body with a 400, so anything looser passes a wide-open route.
     * Verified by deleting the check on `/internal/agent-by-pubkey`: this test and the wrong-key one
     * go red, and nothing else does.
     */
    const bearerRoutes = internalRoutesFromSource().filter((r) => !r.startsWith("/internal/signal"));
    for (const route of bearerRoutes) {
      const res = await post(route);
      expect(res.status, `${route} must answer 401 without a key`).toBe(401);
      const body = (await res.text()).toLowerCase();
      expect(body, `${route} returned 401 with no reason a caller can read`).toMatch(
        /(unauthorized|missing|api key)/,
      );
    }
  });

  it("a WRONG key is refused exactly like a missing one — no oracle for guessing", async () => {
    for (const route of internalRoutesFromSource().filter((r) => !r.startsWith("/internal/signal"))) {
      const res = await post(route, { "x-cello-internal-api-key": "wrong-api-key-value" });
      expect(res.status, `${route} must not distinguish a wrong key from a missing one`).toBe(401);
    }
  });

  it("the correct key gets past the door — the refusal is authentication, not a broken route", async () => {
    // Without this, every assertion above is satisfied by a server that answers 401 to everything,
    // including a correctly authenticated caller. `/internal/pre-authorize` may then answer 400 or
    // 500 on this deliberately thin body — what matters is that it is no longer 401.
    const res = await post("/internal/pre-authorize", { "x-cello-internal-api-key": API_KEY });
    expect(res.status).not.toBe(401);
  });
});
