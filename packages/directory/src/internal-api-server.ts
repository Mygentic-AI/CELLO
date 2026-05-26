/**
 * Internal API Server — OPS-AGENT-001
 *
 * Provides the POST /internal/pre-authorize endpoint for the Operations Agent
 * to request pre-authorization tokens after phone + email verification.
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
 *   3. Parse body: { phoneStubHash, emailDomain, registrationId }
 *      - Missing fields → return 400
 *   4. Call issuePreAuthToken(pool, { phoneStubHash, emailDomain, registrationId })
 *      - On error → log preauth.token.issue.failed (ERROR) → return 500
 *   5. Log preauth.token.issued (INFO) with { tokenId, phoneStubHashPrefix, emailDomain, correlationId }
 *      phoneStubHashPrefix = first 8 hex chars of phoneStubHash
 *   6. Return 200 with { token, expiresAt: ISO-8601 }
 */

import { createServer, type Server } from "node:http";
import { randomBytes } from "node:crypto";
import type pg from "pg";
import type { Logger } from "@cello-protocol/interfaces";
import { issuePreAuthToken } from "./pre-auth-token-repository.js";

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
      const emailDomain = typeof p["emailDomain"] === "string" ? p["emailDomain"] : null;
      const registrationId = typeof p["registrationId"] === "string" ? p["registrationId"] : null;

      if (!phoneStubHash || !emailDomain || !registrationId) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "missing required fields: phoneStubHash, emailDomain, registrationId" }));
        return;
      }

      // Step 3: Issue token
      let result: Awaited<ReturnType<typeof issuePreAuthToken>>;
      try {
        result = await issuePreAuthToken(pool, { phoneStubHash, emailDomain, registrationId });
      } catch (err: unknown) {
        const reason = err instanceof Error ? err.message : String(err);
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
        emailDomain,
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

    // All other paths → 404
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });

  return server;
}

// ─── Helper ───────────────────────────────────────────────────────────────────

/** Read the full request body as a Buffer. */
function readBody(req: import("node:http").IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => {
      if (Buffer.isBuffer(chunk)) {
        chunks.push(chunk);
      } else {
        chunks.push(Buffer.from(chunk as string));
      }
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
