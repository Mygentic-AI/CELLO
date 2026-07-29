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
import type { KeyProvider } from "@cello-protocol/crypto";
import { issuePreAuthToken, issuePreAuthCapability } from "./pre-auth-token-repository.js";
import { listAccountAgentsWithPresence, PRESENCE_NODE_FRESHNESS_MS } from "./agent-presence-repository.js";
import { validateWritePayload } from "./agent-write-validation.js";
import { submitSignal, deliverSignal, revokeSignal, publishRegistry, getRegistryDocument, queryAccountFacts, SubmitRejected } from "./signal-write.js";
import {
  isAgentOwnedByAccount,
  applyRevocationFlag,
} from "./agent-write-repository.js";
import { drainSubmissions, deleteSubmission } from "./submission-queue-repository.js";

// READ-001 freshness window is now shared from agent-presence-repository (one source of truth for
// the account-presence read and the cross-node discovery lookup).

export interface InternalApiServerOptions {
  pool: pg.Pool;
  internalApiKey: string;
  logger: Pick<Logger, "info" | "warn" | "error">;
  owningNodeId: string;
  /**
   * M8B-PREAUTH-CAP: when provided, /internal/pre-authorize issues a SIGNED CAPABILITY (verified
   * independently by every directory) instead of an opaque token. Absent → legacy token issuance.
   */
  issuerKeyProvider?: KeyProvider;
}

/**
 * Create the internal API HTTP server.
 * Returns the server — caller must call .listen().
 */
/** Default rows per drain when the caller does not say. */
const DEFAULT_DRAIN_LIMIT = 100;
/** Hard ceiling on a single drain — see the clamp comment on the route. */
const MAX_DRAIN_LIMIT = 500;

export function createInternalApiServer(opts: InternalApiServerOptions): Server {
  const { pool, internalApiKey, logger, owningNodeId } = opts;

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

      // Step 3 (M8B-PREAUTH-CAP): if an issuer key is wired, issue a SIGNED CAPABILITY and return it in
      // the `token` field (the operator pastes it into `cello register`). Every directory verifies it
      // independently — no consume race. Falls through to legacy token issuance when no issuer key.
      if (opts.issuerKeyProvider) {
        try {
          const capResult = await issuePreAuthCapability(pool, opts.issuerKeyProvider, {
            phoneStubHash,
            emailStubHash,
            registrationId,
          });
          logger.info("directory.auth.capability.issued", {
            tokenId: capResult.tokenId,
            phoneStubHashPrefix: phoneStubHash.slice(0, 8),
            emailStubHash,
            correlationId,
          });
          res.writeHead(200, { "Content-Type": "application/json" });
          // #2b: also return the short claim-code. `token` stays the full capability for back-compat; the
          // ops-agent now relays `claim_code` (short) to the operator, and the agent redeems it.
          res.end(JSON.stringify({
            token: capResult.capability,
            claim_code: capResult.claimCode,
            expiresAt: capResult.expiresAt.toISOString(),
          }));
        } catch (err: unknown) {
          const pgErr = err as { code?: string };
          const isDbError = typeof pgErr.code === "string" && /^\d{5}$/.test(pgErr.code);
          const reason = isDbError ? `database_error:${pgErr.code}` : err instanceof Error ? err.message : String(err);
          logger.error("directory.auth.capability.issue.failed", { reason, correlationId });
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "capability issuance failed" }));
        }
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
            burned: a.burned,
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
          // M10-D18: the `trust_signal_hash` / `trust_signal_ciphertext` arms are RETIRED. Trust signals
          // enter through the signed chokepoint (/internal/signal/submit) and deliver via
          // /internal/signal/deliver — never this API-key seam. `revocation_flag` is the only kind now.
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

    // ── M10 / DOD-DIR-WRITE-1: the signed-submission chokepoint ──────────────────────────────────
    // NOTE: NO bearer-key check here. This surface is authenticated by REQUEST SIGNATURE against the
    // authorized_issuers set (INV-CHOKEPOINT) — a fundamentally stronger model than the shared static
    // bearer key the routes above use, which is why signals get their own door (M10-D10). The body is
    // canonical CBOR (raw bytes), not JSON; the signer's pubkey hint and signature ride in headers.
    if (req.method === "POST" && req.url === "/internal/signal/submit") {
      let body: Buffer;
      try {
        body = await readBody(req);
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "could not read request body" }));
        return;
      }
      const signerPubkeyHex = String(req.headers["x-cello-signer-pubkey"] ?? "");
      const signatureHex = String(req.headers["x-cello-signature"] ?? "");

      try {
        const result = await submitSignal({
          pool, logger, acceptingNode: owningNodeId,
          bodyCbor: new Uint8Array(body), signerPubkeyHex, signatureHex, correlationId,
        });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, signal_hash: result.signalHash, inserted: result.inserted }));
      } catch (err) {
        if (err instanceof SubmitRejected) {
          // A refusal is a 4xx with its CAUSE named — never a bare 401/500. The reason is already
          // logged by submitSignal via signal.submission.rejected; the wire echoes it so the caller
          // (the portal) can act on it. `detail` is safe to surface: it names fields and hashes,
          // never payload or key material (verified in review).
          res.writeHead(422, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err.reason, detail: err.detail }));
        } else {
          logger.error("signal.submission.failed", {
            reason: err instanceof Error ? err.message : String(err), correlationId,
          });
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "submission failed" }));
        }
      }
      return;
    }

    // ── M10 / DOD-REVOKE-1: revocation through the SAME chokepoint ───────────────────────────────
    if (req.method === "POST" && req.url === "/internal/signal/revoke") {
      let body: Buffer;
      try {
        body = await readBody(req);
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "could not read request body" }));
        return;
      }
      try {
        const result = await revokeSignal({
          pool, logger, acceptingNode: owningNodeId,
          bodyCbor: new Uint8Array(body),
          signerPubkeyHex: String(req.headers["x-cello-signer-pubkey"] ?? ""),
          signatureHex: String(req.headers["x-cello-signature"] ?? ""),
          correlationId,
        });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, signal_hash: result.signalHash, revoked_rows: result.revokedRows }));
      } catch (err) {
        if (err instanceof SubmitRejected) {
          res.writeHead(422, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err.reason, detail: err.detail }));
        } else {
          logger.error("signal.revocation.failed", {
            reason: err instanceof Error ? err.message : String(err), correlationId,
          });
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "revocation failed" }));
        }
      }
      return;
    }

    // ── M10 / DOD-MINT-INTERNAL-1 (M10-D22): queue a notarized signal's sealed envelope for its holder's
    //    agents. Same signer/role auth as submit; the ciphertext is opaque (sealed to k_local). REPLACES
    //    the M8 `trust_signal_ciphertext` agent-write arm. ──────────────────────────────────────────────
    if (req.method === "POST" && req.url === "/internal/signal/deliver") {
      let body: Buffer;
      try {
        body = await readBody(req);
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "could not read request body" }));
        return;
      }
      try {
        const result = await deliverSignal({
          pool, logger, acceptingNode: owningNodeId,
          bodyCbor: new Uint8Array(body),
          signerPubkeyHex: String(req.headers["x-cello-signer-pubkey"] ?? ""),
          signatureHex: String(req.headers["x-cello-signature"] ?? ""),
          correlationId,
        });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, delivered: result.delivered }));
      } catch (err) {
        if (err instanceof SubmitRejected) {
          res.writeHead(422, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err.reason, detail: err.detail }));
        } else {
          logger.error("signal.delivery.failed", {
            reason: err instanceof Error ? err.message : String(err), correlationId,
          });
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "delivery failed" }));
        }
      }
      return;
    }

    // ── M10 / DOD-REGISTRY-1: publish the type registry (signed, role `registry`) ────────────────
    if (req.method === "POST" && req.url === "/internal/signal/registry-publish") {
      let body: Buffer;
      try {
        body = await readBody(req);
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "could not read request body" }));
        return;
      }
      try {
        const result = await publishRegistry({
          pool, logger, bodyCbor: new Uint8Array(body),
          signerPubkeyHex: String(req.headers["x-cello-signer-pubkey"] ?? ""),
          signatureHex: String(req.headers["x-cello-signature"] ?? ""),
          correlationId,
        });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, version: result.version, stored: result.stored }));
      } catch (err) {
        if (err instanceof SubmitRejected) {
          res.writeHead(422, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err.reason, detail: err.detail }));
        } else {
          logger.error("signal.registry.failed", { reason: err instanceof Error ? err.message : String(err), correlationId });
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "registry publish failed" }));
        }
      }
      return;
    }

    // ── M10 / DOD-REGISTRY-1: serve the registry (PUBLIC, opaque bytes — like GET /manifest) ─────
    // No auth: the registry is public signed data; a client verifies its INNER signature against the
    // build-time-pinned registry pubkey. The directory serves bytes it never interprets (INV-DIR-DUMB).
    if (req.method === "GET" && req.url === "/registry") {
      try {
        const doc = await getRegistryDocument(pool);
        if (doc === null) {
          // No registry published yet → every type is valid-but-unclassified (INV-TYPE-CARRY). 404 is
          // the honest signal "there is no registry", NOT an error condition the client should choke on.
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "no_registry_published" }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/octet-stream", "x-cello-registry-version": String(doc.version) });
        res.end(doc.document);
      } catch (err) {
        logger.error("signal.registry.serve_failed", { reason: err instanceof Error ? err.message : String(err), correlationId });
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "registry unavailable" }));
      }
      return;
    }

    // ── M10 / DOD-MINT-INTERNAL-1 dep: verified-account-facts read (signed, role submitter) ──────
    if (req.method === "POST" && req.url === "/internal/signal/query") {
      let body: Buffer;
      try {
        body = await readBody(req);
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "could not read request body" }));
        return;
      }
      try {
        const result = await queryAccountFacts({
          pool, logger, bodyCbor: new Uint8Array(body),
          signerPubkeyHex: String(req.headers["x-cello-signer-pubkey"] ?? ""),
          signatureHex: String(req.headers["x-cello-signature"] ?? ""),
          correlationId,
        });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
      } catch (err) {
        if (err instanceof SubmitRejected) {
          res.writeHead(422, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err.reason, detail: err.detail }));
        } else {
          logger.error("signal.query.failed", { reason: err instanceof Error ? err.message : String(err), correlationId });
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "query failed" }));
        }
      }
      return;
    }

    // ── M10B: which of THESE hashes are still active? ───────────────────────────────────────────
    // ── M10B / DOD-END-INGRESS-1: the portal drains the sealed submission queue ──────────────────
    //
    // TWO ROUTES, and the split IS the exactly-once property. `drain` READS; it does not delete. A
    // portal that dies between reading a row and minting from it sees that row again on its next
    // pass. Delete-on-read would turn every crash into a silent loss of a submission whose operator
    // was told it had been queued — and since the ciphertext is opaque here, nothing downstream
    // could ever notice it had gone.
    //
    // The row leaves only on `ack`, which the portal sends after a TERMINAL outcome: minted,
    // rejected, or poison. All three delete; they differ only in what the portal sends back to the
    // submitter (M10B-D22b: poison sends nothing, because an unverifiable submission is
    // unattributable by construction).
    //
    // The directory still reads nothing. It hands back the same opaque bytes it was given, and it
    // cannot tell an endorsement from a withdrawal from a refusal — that discriminator (`op`) rides
    // INSIDE the seal (INV-DIR-DUMB).
    if (req.method === "POST" && req.url === "/internal/submissions/drain") {
      const providedKey = req.headers["x-cello-internal-api-key"];
      if (!internalApiKey || providedKey !== internalApiKey) {
        // LOGGED, like every other /internal/ auth failure. Without it a credential-guessing sweep
        // is invisible — and, more mundanely, a rotated key produces a portal-side "all nodes
        // unreachable" with NOTHING on the directory side to correlate it against.
        logger.warn("signal.ingress.auth.failed", { route: "drain", remoteAddr: req.socket.remoteAddress, owningNodeId });
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "unauthorized" }));
        return;
      }
      // AUTH MATTERS EVEN THOUGH THE PAYLOAD IS OPAQUE. The set of queued ids, their arrival order
      // and their intake key ids is traffic analysis: how much is being submitted, how often, and
      // against which key generation. "It is encrypted" is not a reason to serve it to anyone.
      let limit = DEFAULT_DRAIN_LIMIT;
      try {
        const body = await readBody(req);
        if (body.length > 0) {
          const parsed = JSON.parse(body.toString("utf8")) as { limit?: unknown };
          if (parsed.limit !== undefined) {
            const n = Number(parsed.limit);
            if (!Number.isFinite(n) || n < 1) {
              res.writeHead(400, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "malformed_request", detail: "limit must be a positive number" }));
              return;
            }
            // CLAMPED, not refused. A caller asking for a million rows is being reasonable about its
            // own appetite and unreasonable about ours; an unbounded read pins the database and the
            // portal's memory at once. The applied limit is ECHOED so the caller can tell it was
            // clamped and page, rather than believing it drained everything.
            limit = Math.min(Math.floor(n), MAX_DRAIN_LIMIT);
          }
        }
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "malformed_request", detail: err instanceof Error ? err.message : String(err) }));
        return;
      }
      try {
        const rows = await drainSubmissions(pool, limit);
        logger.info("signal.ingress.drained", { count: rows.length, limit, owningNodeId });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          limit,
          submissions: rows.map((r) => ({
            submission_id: r.submissionId,
            intake_key_id: r.intakeKeyId,
            // Hex because JSON has no bytes. Lossless and unambiguous, and it matches every other
            // blob this API hands out. NEVER empty: the portal refuses a zero-length ciphertext,
            // because an empty `bytea` is exactly what transport truncation looks like.
            ciphertext: Buffer.from(r.ciphertext).toString("hex"),
          })),
        }));
      } catch (err) {
        logger.error("signal.ingress.drain.failed", { error: err instanceof Error ? err.message : String(err), owningNodeId });
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "drain failed" }));
      }
      return;
    }

    if (req.method === "POST" && req.url === "/internal/submissions/ack") {
      const providedKey = req.headers["x-cello-internal-api-key"];
      if (!internalApiKey || providedKey !== internalApiKey) {
        logger.warn("signal.ingress.auth.failed", { route: "ack", remoteAddr: req.socket.remoteAddress, owningNodeId });
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "unauthorized" }));
        return;
      }
      let submissionId: string;
      try {
        const parsed = JSON.parse((await readBody(req)).toString("utf8")) as { submission_id?: unknown };
        if (typeof parsed.submission_id !== "string" || parsed.submission_id.length === 0) {
          throw new Error("submission_id must be a non-empty string");
        }
        submissionId = parsed.submission_id;
      } catch (err) {
        // REFUSED, not quietly accepted. A malformed ack answered with 200 would let a broken portal
        // believe it was clearing rows forever while the queue grew without bound — and the symptom
        // would surface days later as a full disk, nowhere near the cause.
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "malformed_request", detail: err instanceof Error ? err.message : String(err) }));
        return;
      }
      try {
        const removed = await deleteSubmission(pool, submissionId);
        // IDEMPOTENT: `removed: false` is not an error. A portal retrying an ack after a timeout
        // wants the row gone, and it is gone — reporting a failure would push it into a retry loop
        // over an outcome it has already achieved.
        logger.info("signal.ingress.acked", { submissionId, removed, owningNodeId });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ removed }));
      } catch (err) {
        logger.error("signal.ingress.ack.failed", { submissionId, error: err instanceof Error ? err.message : String(err), owningNodeId });
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "ack failed" }));
      }
      return;
    }

    // POST /internal/signals/active-among  { "hashes": ["<64 hex>", …] } → { "active": [...] }
    //
    // THE NOTARY-SHAPED QUESTION, and the replacement for /internal/active-signals. That route asks
    // "what signals does this ACCOUNT have?", which forces the directory to keep `subject` and
    // `issuer_pubkey` as queryable columns — i.e. to store the EDGE (who a signal is about, who
    // issued it) so it can answer on someone else's behalf. This route asks only "of these hashes,
    // which are live?", which needs nothing but the hash.
    //
    // The caller supplies the hashes because the caller MINTED them and therefore already knows
    // them. The knowledge stays with the party that produced it; the directory stops being a
    // queryable graph of relationships and goes back to being a notary.
    if (req.method === "POST" && req.url === "/internal/signals/active-among") {
      const providedKey = req.headers["x-cello-internal-api-key"];
      if (!internalApiKey || providedKey !== internalApiKey) {
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
      let hashes: string[];
      try {
        const parsed = JSON.parse(body.toString("utf8")) as { hashes?: unknown };
        // Shape-check every element rather than trusting the array: these go straight into a query,
        // and a caller getting the wire format wrong should be told so, not silently return nothing.
        if (!Array.isArray(parsed.hashes) || !parsed.hashes.every((h) => typeof h === "string" && /^[0-9a-f]{64}$/.test(h))) {
          throw new Error("hashes must be an array of 64-char lowercase hex strings");
        }
        hashes = parsed.hashes as string[];
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "malformed_request", detail: err instanceof Error ? err.message : String(err) }));
        return;
      }
      if (hashes.length === 0) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ active: [] }));
        return;
      }
      try {
        const { rows } = await pool.query<{ signal_hash: string }>(
          `SELECT signal_hash FROM signal_records_effective
            WHERE signal_hash = ANY($1) AND effective_status = 'active'`,
          [hashes],
        );
        logger.info("signal.active_among.ok", { asked: hashes.length, active: rows.length, correlationId });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ active: rows.map((r) => r.signal_hash) }));
      } catch (err) {
        logger.error("signal.active_among.failed", { reason: err instanceof Error ? err.message : String(err), correlationId });
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "query failed" }));
      }
      return;
    }

    // ── M10 / DOD-DIRDATA-READ-1: track-record aggregate for a given agent pubkey ────────────────
    // GET /internal/track-record/<agentPubkeyHex>
    // Computes session_count and clean_close_rate from seal_notarizations + conversation_seals
    // (both in PUBLICATION_TABLES → cross-node consistent). No PII, aggregate-only.
    // Auth: same bearer key as all internal routes (SI-001).
    const trackRecordPrefix = "/internal/track-record/";
    if (req.method === "GET" && req.url?.startsWith(trackRecordPrefix)) {
      const providedKey = req.headers["x-cello-internal-api-key"];
      if (!providedKey || providedKey !== internalApiKey) {
        logger.warn("track_record.auth.failed", { remoteAddr, correlationId });
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "unauthorized" }));
        return;
      }

      const agentPubkeyHex = req.url.slice(trackRecordPrefix.length);
      if (!/^[0-9a-f]{64}$/i.test(agentPubkeyHex)) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "invalid agent pubkey — expected 64 hex chars" }));
        return;
      }

      // participant_a_pubkey and participant_b_pubkey are stored as BYTEA (raw 32 bytes).
      // decode($1, 'hex') converts the hex string to the matching BYTEA for comparison.
      // The join from seal_notarizations to conversation_seals uses:
      //   encode(sn.session_id, 'hex') = replace(cs.conversation_id::text, '-', '')
      // because session_id is stored as 16-byte BYTEA and conversation_id as UUID derived
      // from those same bytes (see directory-node.ts #recordConversationSealBestEffort).
      let result: {
        session_count: string;
        clean_close_count: string;
        last_sealed_at: number | null;
      };
      try {
        const qResult = await pool.query<{
          session_count: string;
          clean_close_count: string;
          last_sealed_at: string | null;
        }>(
          `SELECT
             COUNT(*)::text AS session_count,
             COUNT(*) FILTER (
               WHERE cs.close_type = 'MUTUAL_SEAL'
             )::text AS clean_close_count,
             MAX(sn.close_timestamp) AS last_sealed_at
           FROM seal_notarizations sn
           LEFT JOIN conversation_seals cs
             ON encode(sn.session_id, 'hex') = replace(cs.conversation_id::text, '-', '')
           WHERE sn.participant_a_pubkey = decode($1, 'hex')
              OR sn.participant_b_pubkey = decode($1, 'hex')`,
          [agentPubkeyHex.toLowerCase()],
        );
        const row = qResult.rows[0];
        result = {
          session_count: row?.session_count ?? "0",
          clean_close_count: row?.clean_close_count ?? "0",
          last_sealed_at: row?.last_sealed_at != null ? Number(row.last_sealed_at) : null,
        };
      } catch (err: unknown) {
        const pgErr = err as { code?: string };
        const isDbError = typeof pgErr.code === "string" && /^\d{5}$/.test(pgErr.code);
        const reason = isDbError
          ? `database_error:${pgErr.code}`
          : err instanceof Error ? err.message : String(err);
        logger.error("track_record.query.failed", { reason, correlationId });
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "track record query failed" }));
        return;
      }

      const sessionCount = parseInt(result.session_count, 10);
      const cleanCloseCount = parseInt(result.clean_close_count, 10);
      const cleanCloseRate = sessionCount > 0 ? cleanCloseCount / sessionCount : null;

      logger.info("track_record.query.ok", {
        agentPubkeyPrefix: agentPubkeyHex.slice(0, 16),
        sessionCount,
        correlationId,
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          session_count: sessionCount,
          clean_close_count: cleanCloseCount,
          clean_close_rate: cleanCloseRate,
          last_sealed_at: result.last_sealed_at,
        }),
      );
      return;
    }

    // ── DOD-PORTAL-SIGNAL-READ-1: active signals for a given account ───────────────────────────
    // GET /internal/active-signals/<accountId>
    // Returns all non-revoked, non-superseded signal types from signal_records_effective for an
    // ── /internal/active-signals/<accountId> — REMOVED in V55 ───────────────────────────────────
    // It answered "what signals does this ACCOUNT have?", and answering it was the ONLY reason
    // `signal_records` carried `subject` and `issuer_pubkey` — the directory had to store WHO a
    // signal was about and WHO issued it in order to answer on the portal's behalf. That made a
    // notary into a queryable graph of relationships, replicated to every node.
    //
    // The portal mints these signals, so it already holds that metadata; it records it itself and
    // now asks only `/internal/signals/active-among` — of THESE hashes, which are live? Verification
    // never used the removed columns: `signal-present.ts` is hash-in, hash-out.
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
