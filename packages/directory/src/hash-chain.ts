/**
 * CELLO-PERSIST-004 — Application-layer SHA-256 hash chain for append-only tables.
 *
 * Every INSERT into a protected table extends a running hash chain:
 *   chain_hash = SHA-256(serialize(record_contents) || previous_chain_hash)
 *
 * Genesis constant: SHA-256(b'CELLO_CHAIN_GENESIS') — same for all tables and environments.
 *
 * Concurrency: callers must hold a pg_advisory_xact_lock(hashtext(tableName))
 * before calling computeChainHash() to prevent chain forks. Advisory locks are
 * used because cello_service has INSERT+SELECT only — FOR UPDATE requires UPDATE
 * privilege which RLS blocks.
 *
 * References: RFC 6234 (SHA-256), NIST FIPS 180-4.
 */

import { createHash } from "node:crypto";
import type { Logger } from "@cello/interfaces";

/** The well-known genesis constant, same for all tables and all environments. */
export const CHAIN_GENESIS = createHash("sha256")
  .update(Buffer.from("CELLO_CHAIN_GENESIS", "utf8"))
  .digest("hex");

/**
 * Columns excluded from chain serialization.
 *
 * - chain_hash: the value being computed — including it would be circular (SI-001)
 * - id: auto-generated BIGSERIAL — not present in the record at INSERT time; pg
 *   returns it as a string (bigint) at SELECT time, causing a type mismatch
 * - created_at: auto-generated DEFAULT now() — same reason as id
 */
const EXCLUDED_FROM_CHAIN = new Set(["chain_hash", "id", "created_at"]);

/**
 * Serialize record contents deterministically for chain hashing.
 * Keys are sorted lexicographically; DB-generated fields are excluded.
 * Values are stringified using JSON.stringify for determinism.
 */
export function serializeRecord(record: Record<string, unknown>): string {
  const keys = Object.keys(record)
    .filter((k) => !EXCLUDED_FROM_CHAIN.has(k))
    .sort();
  const obj: Record<string, unknown> = {};
  for (const k of keys) {
    obj[k] = record[k];
  }
  return JSON.stringify(obj);
}

/**
 * Compute the chain_hash for a new row.
 *
 * chain_hash = SHA-256(serialize(record_contents) || previous_chain_hash)
 *
 * SI-001: The concatenation order (record_contents || previous_hash) is fixed and not configurable.
 * The genesis constant is fixed. Any change to either breaks chain compatibility.
 */
export function computeChainHash(
  serializedRecord: string,
  previousChainHash: string,
): string {
  return createHash("sha256")
    .update(serializedRecord + previousChainHash)
    .digest("hex");
}

/**
 * Result of a chain verification pass.
 */
export interface ChainVerificationResult {
  valid: boolean;
  rowCount: number;
  /** If a break was found, the sequence position (1-indexed) of the first break. */
  breakAtSequence?: number;
  /** The stored chain_hash at the break point. */
  storedHash?: string;
  /** The recomputed chain_hash at the break point. */
  recomputedHash?: string;
}

/**
 * Verify the hash chain for a set of rows (ordered by insertion sequence).
 *
 * Each row must have a `chain_hash` field and the serializable content fields.
 * Returns the verification result. Does not throw on chain break — reports it.
 *
 * AC-003: clean chain returns { valid: true, rowCount: N }
 * AC-004: tampered row reports break at that position
 * AC-005: deleted row causes sequence gap (detected by chain recomputation)
 */
export function verifyChain(
  rows: Array<Record<string, unknown>>,
  logger: Logger,
  tableName: string,
): ChainVerificationResult {
  const startTime = Date.now();

  if (rows.length === 0) {
    logger.info("db.chain.verified", { tableName, rowCount: 0, durationMs: 0 });
    return { valid: true, rowCount: 0 };
  }

  let previousHash = CHAIN_GENESIS;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const storedHash = row["chain_hash"] as string;
    const serialized = serializeRecord(row);
    const recomputed = computeChainHash(serialized, previousHash);

    if (recomputed !== storedHash) {
      logger.error("db.chain.break.detected", {
        tableName,
        breakAtSequence: i + 1,
        storedHash,
        recomputedHash: recomputed,
        durationMs: Date.now() - startTime,
      });
      return {
        valid: false,
        rowCount: rows.length,
        breakAtSequence: i + 1,
        storedHash,
        recomputedHash: recomputed,
      };
    }

    previousHash = storedHash;
  }

  logger.info("db.chain.verified", { tableName, rowCount: rows.length, durationMs: Date.now() - startTime });
  return { valid: true, rowCount: rows.length };
}

/**
 * Hash-chained tables that support the chain mechanism in M4.
 * These are the "active" tables with full column definitions.
 */
export const HASH_CHAINED_TABLES = [
  "agent_registrations",
  "connection_requests",
  "conversation_seals",
  "conversation_attestations",
  "conversation_participation",
  "notification_events",
] as const;

export type HashChainedTable = (typeof HASH_CHAINED_TABLES)[number];
