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
import type { Logger } from "@cello-protocol/interfaces";

/** The well-known genesis constant, same for all tables and all environments. */
export const CHAIN_GENESIS = createHash("sha256")
  .update(Buffer.from("CELLO_CHAIN_GENESIS", "utf8"))
  .digest("hex");

/**
 * Columns excluded from chain serialization.
 *
 * - chain_hash: the value being computed — including it would be circular (SI-001)
 * - id: auto-generated BIGSERIAL — not present in the record at INSERT time
 * - *_at columns: auto-generated DEFAULT now() timestamps — not present in the
 *   caller-supplied record at INSERT time; including them would cause verifyChain
 *   (which uses SELECT *) to produce a different hash than computeChainHash at
 *   INSERT time. All tables use the pattern "column_name ending in _at" for these.
 */
/**
 * Columns always excluded from chain serialization regardless of table.
 * These are DB-generated fields never present in the caller-supplied record.
 */
const ALWAYS_EXCLUDED_FROM_CHAIN = new Set([
  "chain_hash",
  "id",
  // Auto-generated timestamps (DEFAULT now())
  "created_at",
  "registered_at",
  "requested_at",
  "attested_at",
  "sent_at",
  "recorded_at",
  "last_run_at",
  "applied_at",
  "signed_at",
]);

/**
 * Per-table additional excluded columns: nullable optional fields that are NOT
 * set at initial INSERT time. Including these would cause chain breaks when they
 * are later populated, since verifyChain reads NULL for them at INSERT time but
 * the actual value at verify time.
 *
 * Rule: only add a column here if it is nullable, has no DEFAULT, and is set
 * by a separate UPDATE or a later INSERT (not at the initial row creation time).
 */
const TABLE_EXTRA_EXCLUDED: Record<string, ReadonlySet<string>> = {
  notification_events: new Set(["sender_pseudonym"]),
  connection_requests: new Set([
    "conversation_id",        // set after conversation is created from this request
    "escalation_expires_at",  // set when escalation is triggered
    "rejection_reason",       // set on rejection
    "via_alias_id",           // set when request came via an alias
  ]),
  // SEAL-2: seal_date is a DATE — node-pg returns it as a LOCAL-midnight Date and toISOString()
  // shifts it by the tz offset, so insert-time (a Date with time) and verify-time (SELECT * →
  // local-midnight Date) serialize DIFFERENTLY (the M4 bug #7 family). Exclude it: the integrity
  // target is merkle_root + close_type + participant_count (all chained). (close_reason_code is
  // nullable, set post-INSERT.)
  conversation_seals: new Set(["close_reason_code", "seal_date"]),
  conversation_proof_leaves: new Set([
    "checkpoint_id",          // NULL at INSERT; set via join table at checkpoint confirmation
  ]),
  // FEDERATION-003: deregistered_at is nullable — only set when a relay is explicitly deregistered,
  // not at initial registration time. If omitted here, verifyChain returns { valid: false } because
  // the stored chain_hash was computed without deregistered_at, but SELECT * includes it as NULL.
  // This is the same M4 bug #7 pattern that broke seal_notarizations in M4 live testing.
  relay_registrations: new Set(["deregistered_at"]),
  // ACCOUNT-001: email_stub_hash is excluded so rows written WITHOUT it (or that acquire one
  // later) still verify — SELECT would return null where chain_hash was computed without the
  // column at all (the M4 bug #7 family).
  //
  // DOD-ACCOUNTS-CHAIN-1 — CORRECTING THE OLD JUSTIFICATION, which said "absent from initial
  // INSERT". That is NOT true of the path that matters: the production registration path always
  // supplies email_stub_hash at creation. The exclusion is kept for backward compatibility with
  // rows that have no email, but the CONSEQUENCE must be stated rather than implied: the email
  // half of the human↔agent binding is stored and NOT tamper-evident — it can be swapped by
  // anyone with UPDATE and verifyChain stays green. Chaining it now would break every row that
  // lacks an email, so it needs its own unit with a rechain step, not a one-line flip here.
  // Tracked as DOD-ACCOUNTS-EMAIL-CHAIN-1.
  user_accounts: new Set(["email_stub_hash"]),
  // M6B-010: initiator_pubkey_hex and target_pubkey_hex were added to the sessions table
  // by V29 with DEFAULT ''. Rows written by writeSession() (called by FEDERATION-001) do not
  // include these columns — the chain_hash is computed without them. After V29, SELECT returns
  // these columns as '' for all rows, causing verifyChain to compute a different hash.
  // Exclude both per the M4 bug #7 pattern. The chain still proves session ownership
  // (session_id + owning_node_id) which is the security property — participant data is
  // operational, not the integrity target.
  sessions: new Set(["initiator_pubkey_hex", "target_pubkey_hex"]),
  // CELLO-M7-UPGRADE-001 (DOD-UP-1): V31 added seal_type (NOT NULL DEFAULT 'bilateral')
  // and supersedes_notarization_id (nullable, no DEFAULT) to seal_notarizations.
  //  - seal_type: same M4 bug #7 / sessions-V29 pattern — pre-V31 rows read back the
  //    'bilateral' default while their chain_hash was computed without the column, so
  //    including it would break verifyChain for every existing notarization. The integrity
  //    target is sealed_root + frost_signature + participants (all still chained); seal_type
  //    is a directory-side label whose truth is the FROST signature itself, which the client
  //    re-verifies at cert time (AC-008). A label flip without a valid bilateral signature is
  //    inert — it cannot forge B's co-signature.
  //  - supersedes_notarization_id: nullable, no DEFAULT, set only on the superseding bilateral
  //    row and NULL on every other row (unilateral + all pre-V31). Textbook exclusion case
  //    (cf. relay_registrations.deregistered_at): a pointer, not an integrity target.
  seal_notarizations: new Set(["seal_type", "supersedes_notarization_id"]),
};

function isExcluded(tableName: string, column: string): boolean {
  if (ALWAYS_EXCLUDED_FROM_CHAIN.has(column)) return true;
  return TABLE_EXTRA_EXCLUDED[tableName]?.has(column) ?? false;
}

/**
 * Serialize record contents deterministically for chain hashing.
 * Keys are sorted lexicographically; DB-generated fields are excluded.
 *
 * Type normalization: string values that are valid integers are coerced to
 * JavaScript numbers before serialization. The pg driver returns BIGINT/BIGSERIAL
 * columns as strings; application code uses JavaScript numbers. Normalizing
 * string-integers to numbers makes serialization identical at INSERT time
 * (application supplies numbers) and at chain-verification time (pg returns strings).
 */
export function serializeRecord(record: Record<string, unknown>, tableName?: string): string {
  const keys = Object.keys(record)
    .filter((k) => !isExcluded(tableName ?? "", k))
    .sort();
  const obj: Record<string, unknown> = {};
  for (const k of keys) {
    const v = record[k];
    if (typeof v === "string" && /^-?\d+$/.test(v)) {
      // Normalize pg BIGINT strings to numbers — pg returns BIGINT/BIGSERIAL as
      // strings; application code supplies JS numbers at INSERT time.
      obj[k] = Number(v);
    } else if (v instanceof Date) {
      // Normalize Date objects to UTC ISO string — pg returns DATE/TIMESTAMP columns
      // as JS Date objects. toISOString() gives a canonical UTC representation.
      obj[k] = v.toISOString();
    } else if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
      // Normalize bare YYYY-MM-DD date strings to UTC midnight ISO — production
      // callers should always pass Date objects, but tests may pass strings.
      // Matches what pg returns for a DATE column when read back as a Date object
      // set to UTC midnight.
      obj[k] = new Date(`${v}T00:00:00.000Z`).toISOString();
    } else {
      obj[k] = v;
    }
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
    const serialized = serializeRecord(row, tableName);
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
 *
 * PERSIST-020: connections added — established connection records are tamper-evident.
 * FEDERATION-001: sessions added — session rows are hash-chained; ownership enforcement
 *   is the application-layer guard (see PgDirectoryStore.writeSession).
 */
export const HASH_CHAINED_TABLES = [
  // agent_registrations removed — table dropped in V16; agent_profiles (V9) is the authoritative agent identity table
  "connection_requests",
  "conversation_seals",
  "conversation_attestations",
  "conversation_participation",
  "notification_events",
  "seal_notarizations",
  "connections",
  "sessions",
  // FEDERATION-003: relay registrations are hash-chained; deregistered_at excluded via TABLE_EXTRA_EXCLUDED.
  "relay_registrations",
  // ACCOUNT-001: user_accounts is hash-chained to provide tamper-evidence for the
  // account identity table. append-only per RLS policy.
  "user_accounts",
] as const;

export type HashChainedTable = (typeof HASH_CHAINED_TABLES)[number];
