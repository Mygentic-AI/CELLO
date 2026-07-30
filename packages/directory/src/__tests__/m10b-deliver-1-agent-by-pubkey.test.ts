/**
 * M10B / DOD-END-DELIVER-1 — resolve an agent subject to its delivery identity.
 *
 * WHY THIS ROUTE HAS TO EXIST. A client-supplied endorsement names its subject by K_LOCAL PUBKEY —
 * the only identifier a contact actually holds, and the only one the submission wire carries (no
 * account identifier ever crosses it, by design). But `/internal/signal/deliver` queues a sealed
 * copy per `agent_id`. Without a pubkey → agent_id resolution the portal can NOTARIZE an endorsement
 * about Alice and then have no way to deliver it to her: minted, permanent, and invisible to its own
 * subject.
 *
 * The submission wire's own contract anticipates this — "the portal resolves an agent subject to an
 * account when it needs one" — and this is that resolution.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createInternalApiServer } from "../internal-api-server.js";

const describeIntegration = process.env.CELLO_ENV === "local" ? describe : describe.skip;
const noopLogger = { debug() {}, info() {}, warn() {}, error() {} };
const API_KEY = "test-internal-key-deliver-1";

describeIntegration("DOD-END-DELIVER-1 — /internal/agent-by-pubkey", () => {
  let pool: Pool;
  let server: Server;
  let base: string;
  const tag = `deliver1-${Math.floor(Date.now() / 1000)}-${Math.random().toString(16).slice(2, 8)}`;
  const PUBKEY = "ab".repeat(32);
  const AGENT_ID = `${tag}-agent`;

  const post = (body: unknown, key: string | null = API_KEY): Promise<Response> =>
    fetch(`${base}/internal/agent-by-pubkey`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(key ? { "x-cello-internal-api-key": key } : {}) },
      body: JSON.stringify(body),
    });

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL || "postgresql://postgres:dev@localhost:5433/cello_dev" });
    await pool.query(
      `INSERT INTO agent_profiles (k_local_pubkey, primary_pubkey, agent_id, status)
       VALUES ($1, $2, $3, 'active') ON CONFLICT DO NOTHING`,
      [PUBKEY, "cd".repeat(32), AGENT_ID],
    );
    server = createInternalApiServer({ pool, internalApiKey: API_KEY, logger: noopLogger, owningNodeId: "deliver-test-node" });
    await new Promise<void>((r) => server.listen(0, () => r()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    if (server) await new Promise<void>((r) => server.close(() => r()));
    await pool.query("DELETE FROM agent_profiles WHERE agent_id = $1", [AGENT_ID]).catch(() => {});
    await pool.end();
  });

  it("REFUSES unauthenticated — this maps a public key to an account", async () => {
    // Not a harmless lookup: it links a pubkey seen on the wire to an ACCOUNT, which is exactly the
    // correlation the directory's no-PII posture exists to withhold from everyone but the portal.
    expect((await post({ k_local_pubkey: PUBKEY }, null)).status).toBe(401);
  });

  it("resolves a known pubkey to its agent_id", async () => {
    const res = await post({ k_local_pubkey: PUBKEY });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { found: boolean; agent_id: string | null };
    expect(body.found).toBe(true);
    expect(body.agent_id).toBe(AGENT_ID);
  });

  it("answers found:false for an unknown pubkey — NOT a 404, and not an error", async () => {
    // "This agent is not registered here" is a legitimate answer, not a failure. A 404 would be
    // indistinguishable from a routing mistake, and an error would make the drain loop treat an
    // ordinary unknown subject as an outage.
    const res = await post({ k_local_pubkey: "ff".repeat(32) });
    expect(res.status).toBe(200);
    expect((await res.json()) as { found: boolean }).toEqual({ found: false, agent_id: null, account_id: null });
  });

  it("REFUSES a malformed pubkey rather than querying with it", async () => {
    const res = await post({ k_local_pubkey: "nope" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("malformed_request");
  });

  it("is case-insensitive on the pubkey — hex case must not decide deliverability", async () => {
    // A subject arriving upper-cased would otherwise resolve to found:false and the endorsement
    // would be minted and never delivered, with nothing anywhere reporting a problem.
    const res = await post({ k_local_pubkey: PUBKEY.toUpperCase() });
    expect(((await res.json()) as { found: boolean }).found).toBe(true);
  });
});
