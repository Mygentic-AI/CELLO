/**
 * Internal API Server — OPS-AGENT-001 + READ-001
 *
 * Endpoints (all API-key protected, never internet-exposed):
 *   POST /internal/pre-authorize          — OPS-AGENT-001: issue a pre-auth token.
 *   POST /internal/account-by-email-stub   — READ-001: resolve an account by email_stub_hash
 *                                            (the portal's ceremony-gated sign-in lookup).
 *   POST /internal/agents-by-account        — READ-001/PRESENCE-001: the account's agents with
 *                                            honest presence (online iff row online AND node fresh).
 *
 * Security:
 *   SI-001: Protected by API key validation (x-cello-internal-api-key header).
 *   Returns 401 immediately if the key is missing or incorrect.
 *   No token is issued on 401.
 *
 *   This server must NOT be exposed to the internet. In production, ALB listener
 *   rules reject /internal/* paths (implemented in OPS-AGENT-005A). The API key
 *   validation here provides defense-in-depth at the application layer.
 *
 * Pseudocode for POST /internal/pre-authorize:
 *   1. Mint correlationId for this request (hex from randomBytes(16))
 *   2. Check x-cello-internal-api-key header
 *      - Missing or invalid → log preauth.auth.failed (WARN) → return 401
 *   3. Parse body: { phoneStubHash, emailStubHash, registrationId }
 *      - Missing fields → return 400
 *   4. Call issuePreAuthToken(pool, { phoneStubHash, emailStubHash, registrationId })
 *      - On error → log preauth.token.issue.failed (ERROR) → return 500
 *   5. Log preauth.token.issued (INFO) with { tokenId, phoneStubHashPrefix, emailStubHash, correlationId }
 *      phoneStubHashPrefix = first 8 hex chars of phoneStubHash
 *   6. Return 200 with { token, expiresAt: ISO-8601 }
 */

import { createServer, type Server } from "node:http";
import { randomBytes } from "node:crypto";
import type pg from "pg";
import type { Logger } from "@cello-protocol/interfaces";
import { issuePreAuthToken } from "./pre-auth-token-repository.js";
import { listAccountAgentsWithPresence } from "./agent-presence-repository.js";
import { validateWritePayload } from "./agent-write-validation.js";
import {
  isAgentOwnedByAccount,
  applyRevocationFlag,
  upsertIdentityHash,
  enqueuePickup,
} from "./agent-write-repository.js";

// READ-001: a node is considered "fresh" for the presence read rule if it heartbeat within this
// window (2× the 45s heartbeat cadence + slack). A staler owning node ages its agents to last-seen.
const PRESENCE_NODE_FRESHNESS_MS = 120_000;

export interface InternalApiServerOptions {
  pool: pg.Pool;
  internalApiKey: string;
  logger: Pick<Logger, "info" | "warn" | "error">;
}

/**
 * Create the internal API HTTP server.
 * Returns the server — caller must call .listen().
 */
export function createInternalApiServer(opts: InternalApiServerOptions): Server {
  const { pool, internalApiKey, logger } = opts;

  const server = createServer(async (req, res) => {
    // Mint a correlation ID for every incoming request
    const correlationId = randomBytes(16).toString("hex");
    const remoteAddr = req.socket?.remoteAddress ?? "unknown";

    if (req.method === "POST" && req.url === "/internal/pre-authorize") {
      // Step 1: API key authentication (SI-001)
      const providedKey = req.headers["x-cello-internal-api-key"];
      if (!providedKey || providedKey !== internalApiKey) {
        logger.warn("preauth.auth.failed", {
          remoteAddr,
          correlationId,
        });
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "unauthorized" }));
        return;
      }

      // Step 2: Parse request body
      let body: Buffer;
      try {
        body = await readBody(req);
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "could not read request body" }));
        return;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(body.toString("utf8"));
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "invalid JSON body" }));
        return;
      }

      const p = parsed as Record<string, unknown>;
      const phoneStubHash = typeof p["phoneStubHash"] === "string" ? p["phoneStubHash"] : null;
      const emailStubHash = typeof p["emailStubHash"] === "string" ? p["emailStubHash"] : null;
      const registrationId = typeof p["registrationId"] === "string" ? p["registrationId"] : null;

      if (!phoneStubHash || !emailStubHash || !registrationId) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "missing required fields: phoneStubHash, emailStubHash, registrationId" }));
        return;
      }

      // Step 3: Issue token
      let result: Awaited<ReturnType<typeof issuePreAuthToken>>;
      try {
        result = await issuePreAuthToken(pool, { phoneStubHash, emailStubHash, registrationId });
      } catch (err: unknown) {
        // LOW-2: Sanitize Postgres errors to avoid leaking internal schema details.
        // Postgres driver errors have a numeric `code` property (e.g. "23505" for unique violation).
        // Log only the error code for DB errors; log the message for non-DB errors.
        const pgErr = err as { code?: string; constructor?: { name?: string } };
        const isDbError = typeof pgErr.code === "string" && /^\d{5}$/.test(pgErr.code);
        const reason = isDbError
          ? `database_error:${pgErr.code}`
          : err instanceof Error ? err.message : String(err);
        logger.error("preauth.token.issue.failed", {
          reason,
          correlationId,
        });
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "token issuance failed" }));
        return;
      }

      // Step 4: Log success
      // phoneStubHashPrefix = first 8 hex characters of phoneStubHash (per observability spec)
      const phoneStubHashPrefix = phoneStubHash.slice(0, 8);
      logger.info("preauth.token.issued", {
        tokenId: result.tokenId,
        phoneStubHashPrefix,
        emailStubHash,
        correlationId,
      });

      // Step 5: Return token
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        token: result.token,
        expiresAt: result.expiresAt.toISOString(),
      }));
      return;
    }

    // ─── POST /internal/account-by-email-stub (READ-001) ─────────────────────────
    // Resolve an operator account by the SHA-256 hash of their email. The portal calls this to
    // gate sign-in (DOD-INV-1): a hit means a real ceremony-minted account exists; a 404 means
    // "no account" → the portal shows the signpost and mints nothing. Hash-only; no plaintext.
    if (req.method === "POST" && req.url === "/internal/account-by-email-stub") {
      const providedKey = req.headers["x-cello-internal-api-key"];
      if (!providedKey || providedKey !== internalApiKey) {
        logger.warn("account.lookup.auth.failed", { remoteAddr, correlationId });
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "unauthorized" }));
        return;
      }

      let body: Buffer;
      try {
        body = await readBody(req);
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "could not read request body" }));
        return;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(body.toString("utf8"));
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "invalid JSON body" }));
        return;
      }

      const p = parsed as Record<string, unknown>;
      const emailStubHash = typeof p["emailStubHash"] === "string" ? p["emailStubHash"] : null;
      if (!emailStubHash) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "missing required field: emailStubHash" }));
        return;
      }

      let accountId: string | null;
      try {
        const result = await pool.query<{ account_id: string }>(
          "SELECT account_id FROM user_accounts WHERE email_stub_hash = $1",
          [emailStubHash],
        );
        accountId = result.rows[0]?.account_id ?? null;
      } catch (err: unknown) {
        const pgErr = err as { code?: string };
        const isDbError = typeof pgErr.code === "string" && /^\d{5}$/.test(pgErr.code);
        const reason = isDbError
          ? `database_error:${pgErr.code}`
          : err instanceof Error ? err.message : String(err);
        logger.error("account.lookup.failed", { reason, correlationId });
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "account lookup failed" }));
        return;
      }

      if (!accountId) {
        logger.info("account.lookup.miss", { correlationId });
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "not found" }));
        return;
      }

      logger.info("account.lookup.hit", { accountId, correlationId });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ account_id: accountId }));
      return;
    }

    // ─── POST /internal/agents-by-account (READ-001 / PRESENCE-001) ──────────────
    // The account's agents with HONEST presence (online iff the presence row is online AND the
    // owning node's heartbeat is fresh). Account-scoped by the body's accountId; hashes/flags only.
    if (req.method === "POST" && req.url === "/internal/agents-by-account") {
      const providedKey = req.headers["x-cello-internal-api-key"];
      if (!providedKey || providedKey !== internalApiKey) {
        logger.warn("agents.lookup.auth.failed", { remoteAddr, correlationId });
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "unauthorized" }));
        return;
      }

      let body: Buffer;
      try {
        body = await readBody(req);
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "could not read request body" }));
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(body.toString("utf8"));
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "invalid JSON body" }));
        return;
      }
      const accountId =
        typeof (parsed as Record<string, unknown>)["accountId"] === "string"
          ? ((parsed as Record<string, unknown>)["accountId"] as string)
          : null;
      if (!accountId) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "missing required field: accountId" }));
        return;
      }

      let agents: Awaited<ReturnType<typeof listAccountAgentsWithPresence>>;
      try {
        agents = await listAccountAgentsWithPresence(
          pool,
          accountId,
          PRESENCE_NODE_FRESHNESS_MS,
        );
      } catch (err: unknown) {
        const pgErr = err as { code?: string };
        const isDbError = typeof pgErr.code === "string" && /^\d{5}$/.test(pgErr.code);
        const reason = isDbError
          ? `database_error:${pgErr.code}`
          : err instanceof Error ? err.message : String(err);
        logger.error("agents.lookup.failed", { reason, correlationId });
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "agents lookup failed" }));
        return;
      }

      logger.info("agents.lookup.ok", { accountId, count: agents.length, correlationId });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          agents: agents.map((a) => ({
            k_local_pubkey: a.kLocalPubkey,
            agent_id: a.agentId,
            online: a.online,
            last_seen_at: a.lastSeenAt ? a.lastSeenAt.toISOString() : null,
            paused: a.paused,
          })),
        }),
      );
      return;
    }

    // ─── POST /internal/agent-write (WRITEAPI-001) ───────────────────────────────
    // The portal's one authenticated, account-scoped write seam. Accepts ONLY hashes, flags, and
    // sealed ciphertext (DOD-INV-2) and only for an agent OWNED by the calling account (SI-001).
    // Everything written replicates to every sovereign node, so the discipline is structural: a
    // strict per-kind schema with no free-text slot.
    if (req.method === "POST" && req.url === "/internal/agent-write") {
      const providedKey = req.headers["x-cello-internal-api-key"];
      if (!providedKey || providedKey !== internalApiKey) {
        logger.warn("directory.write.auth.failed", { remoteAddr, correlationId });
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "unauthorized" }));
        return;
      }

      let body: Buffer;
      try {
        body = await readBody(req);
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "could not read request body" }));
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(body.toString("utf8"));
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "invalid JSON body" }));
        return;
      }

      const p = parsed as Record<string, unknown>;
      const accountId = typeof p["accountId"] === "string" ? p["accountId"] : null;
      const agentId = typeof p["agentId"] === "string" ? p["agentId"] : null;
      const writeKind = p["writeKind"];
      if (!accountId || !agentId || typeof writeKind !== "string") {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "missing required fields: accountId, agentId, writeKind" }));
        return;
      }

      // Payload discipline FIRST — reject a disallowed shape before touching the DB (so a smuggled
      // plaintext/PII/token never even reaches a query). Distinct reason per cause.
      const validation = validateWritePayload(writeKind, p["payload"]);
      if (!validation.ok) {
        logger.warn("directory.write.rejected", {
          accountId,
          agentId,
          reason: validation.reason,
          correlationId,
        });
        res.writeHead(422, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "invalid write", reason: validation.reason }));
        return;
      }

      // Account-scoping: the target agent must be OWNED by the calling account. Derived from the
      // ownership check, never from a request field — so account A cannot write account B's agent.
      let owned: boolean;
      try {
        owned = await isAgentOwnedByAccount(pool, agentId, accountId);
      } catch (err: unknown) {
        const pgErr = err as { code?: string };
        const isDbError = typeof pgErr.code === "string" && /^\d{5}$/.test(pgErr.code);
        const reason = isDbError
          ? `database_error:${pgErr.code}`
          : err instanceof Error ? err.message : String(err);
        logger.error("directory.write.failed", { accountId, reason, correlationId });
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "write failed" }));
        return;
      }
      if (!owned) {
        logger.warn("directory.write.rejected", { accountId, agentId, reason: "not_owner", correlationId });
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "forbidden", reason: "not_owner" }));
        return;
      }

      // Persist the validated write to its target table.
      try {
        const w = validation.write;
        switch (w.kind) {
          case "revocation_flag": {
            const result = await applyRevocationFlag(pool, { agentId, mode: w.mode, accountId });
            if (result === "burned_immutable") {
              // A burn is permanent — a clear cannot lift it (DOD-LEVER-2). Distinct rejection.
              logger.warn("directory.write.rejected", { accountId, agentId, reason: "burned_immutable", correlationId });
              res.writeHead(409, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "burned", reason: "burned_immutable" }));
              return;
            }
            break;
          }
          case "trust_signal_hash":
            await upsertIdentityHash(pool, { agentId, signalKind: w.signalKind, signalHash: w.signalHash });
            break;
          case "trust_signal_ciphertext":
            await enqueuePickup(pool, { agentId, signalKind: w.signalKind, ciphertext: w.ciphertext });
            break;
        }
      } catch (err: unknown) {
        const pgErr = err as { code?: string };
        const isDbError = typeof pgErr.code === "string" && /^\d{5}$/.test(pgErr.code);
        const reason = isDbError
          ? `database_error:${pgErr.code}`
          : err instanceof Error ? err.message : String(err);
        logger.error("directory.write.failed", { accountId, reason, correlationId });
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "write failed" }));
        return;
      }

      logger.info("directory.write.accepted", {
        accountId,
        agentId,
        writeKind,
        correlationId,
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, writeKind }));
      return;
    }

    // All other paths → 404
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });

  return server;
}

// ─── Helper ───────────────────────────────────────────────────────────────────

// Hard cap on a request body. All internal endpoints carry small JSON (hashes, flags, a sealed
// blob bounded to 64KB by MAX_SEALED_BYTES). 256KB leaves comfortable headroom while preventing an
// unbounded body from exhausting memory — a request exceeding it is rejected, never truncated.
const MAX_BODY_BYTES = 256 * 1024;

/** Read the full request body as a Buffer, rejecting if it exceeds MAX_BODY_BYTES. */
function readBody(req: import("node:http").IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (chunk) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
      total += buf.length;
      if (total > MAX_BODY_BYTES) {
        reject(new Error("request body too large"));
        req.destroy();
        return;
      }
      chunks.push(buf);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
