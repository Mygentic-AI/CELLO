/**
 * Tier-A per-table record encoders for anti-entropy append-only sync (M12 DOD-AE-APPEND-1;
 * M12-ANTI-ENTROPY-DESIGN §2 Tier A).
 *
 * A Tier-A table's record hash covers only its **stable, cross-node-identical** columns. Three
 * classes of column are deliberately EXCLUDED, because including any of them forks the hash and
 * makes two nodes holding the same logical record fail to converge — the exact silent-divergence
 * failure this milestone exists to prevent:
 *
 *  - **Local surrogate/audit columns:** `id` (BIGSERIAL — different on every node),
 *    `chain_hash` (a table-wide hash chain that forks under multi-master), `created_at`
 *    (`DEFAULT now()` — each node stamps its own arrival time).
 *  - **Mutable columns** on an otherwise-append-only table: e.g. `agent_profiles.account_id`
 *    (backfilled after registration) and `.status` (active→retired). These are NOT part of the
 *    append-only identity; they ride the Tier-B version-summary path (§2 Tier B), so hashing them
 *    here would make an append-only record spuriously "change".
 *
 * **Value-type obligation on the consumer.** `recordHash` forbids `number` (to avoid 2^53
 * aliasing) and takes only string|boolean|null. BIGINT already arrives as a string (`pg` default),
 * so numerics are fine. **BYTEA does NOT** — `pg` returns it as a Node `Buffer`, and there is no
 * bytea type-parser override in `pg-type-config.ts` (only DATE/TIMESTAMP are overridden). So the
 * AE consumer that reads these rows MUST hex-encode every BYTEA column before calling
 * `encodeTierARecord` — either `SELECT encode(col,'hex') AS col` or a `pg.types.setTypeParser(17,…)`.
 * Passing a raw Buffer would hash `{"type":"Buffer","data":[…]}`, a different (and silently
 * divergent) content address than the intended hex. `agent_revocations.signature` is the only
 * BYTEA column in the populated specs.
 */

import { recordHash, type CanonicalValue } from "./record-hash.js";

/** A row as the query layer yields it — column → scalar (BIGINT/BYTEA already stringified). */
export type TableRow = Record<string, CanonicalValue | undefined>;

export interface TierATableSpec {
  /** Logical table name (also domain-separates the record hash across tables). */
  readonly table: string;
  /** Columns forming the record's stable natural key (used for dedup + apply). */
  readonly naturalKey: readonly string[];
  /** The stable columns that feed the record hash. Excludes local + mutable columns (see header). */
  readonly immutableColumns: readonly string[];
}

/**
 * agent_profiles (V9). Natural key `k_local_pubkey`. Hashed: the immutable identity/registration
 * columns. EXCLUDED: `id`/`chain_hash`/`created_at` (local), and `account_id`/`status` (mutable →
 * Tier B). `registered_at` is a BIGINT set once at registration and replicated verbatim, so it is
 * stable and included (as a string).
 */
export const AGENT_PROFILES_SPEC: TierATableSpec = {
  table: "agent_profiles",
  naturalKey: ["k_local_pubkey"],
  // `agent_id` is here because THE KILL SWITCH JOINS ON IT. `isAgentSuspended` / `isAgentBurned` /
  // `listBurnedAgentPubkeys` all do `JOIN agent_profiles p ON p.agent_id = s.agent_id`, so a
  // replicated profile without it is a profile the gates cannot evaluate: `NULL = s.agent_id` is
  // never true, the join returns zero rows, and the gate answers "not suspended". Omitting it meant
  // a paused or burned agent kept being co-signed by every node that learned it by replication
  // (observed live on gcp-usc1, 2026-07-30: four of eight profiles had a NULL agent_id).
  //
  // It qualifies as immutable in the strict sense this list requires: set in both registration
  // INSERTs and never UPDATEd anywhere.
  immutableColumns: ["k_local_pubkey", "agent_id", "primary_pubkey", "ml_dsa_pubkey", "phone_stub_hash", "registered_at"],
};

/**
 * agent_revocations (V32). Natural key `agent_id` (one permanent tombstone per agent — INSERT/
 * SELECT only, no UPDATE grant, so every column is immutable). `created_at` (per-node now()) is
 * excluded. `signature` is BYTEA — the consumer MUST hex-encode it before calling (see header);
 * `revoked_at` is BIGINT (already a string from pg).
 */
export const AGENT_REVOCATIONS_SPEC: TierATableSpec = {
  table: "agent_revocations",
  naturalKey: ["agent_id"],
  immutableColumns: ["agent_id", "epoch_id", "reason", "signature", "revoked_at"],
};

/**
 * user_accounts (V22, RLS INSERT+SELECT only — no UPDATE path). Natural key `account_id` (UUID
 * PK). Hashed: `account_id` + `phone_stub_hash` (both set at INSERT, immutable). EXCLUDED:
 * `id`/`created_at`/`chain_hash` (local). **`email_stub_hash` is excluded conservatively** — it
 * is nullable and often absent at INSERT (phone-only signups), and associating an email is a
 * post-signup / portal-login concern (see `project_no_pii_in_directory_hash_only`), i.e. the field
 * most likely to grow a backfill path later. Keeping it off the append-only identity hash means a
 * future backfill can never fork the hash — it would ride Tier B. (No current UPDATE path exists;
 * this is the safe direction, not a claim that it is mutable today. `hash-chain.ts` also omits it,
 * but for a different reason — null-at-INSERT chain serialization, not mutability.)
 */
export const USER_ACCOUNTS_SPEC: TierATableSpec = {
  table: "user_accounts",
  naturalKey: ["account_id"],
  immutableColumns: ["account_id", "phone_stub_hash"],
};

/**
 * seal_notarizations (V12 + V31). Natural key `(session_id, seal_type)`. Append-only in
 * production (no UPDATE grant path; supersession INSERTs a new row with a different seal_type).
 * Hashed: the immutable notarization content. EXCLUDED: `id`/`chain_hash`/`created_at` (local),
 * and **`supersedes_notarization_id`** — a BIGINT foreign key pointing at ANOTHER row's local
 * BIGSERIAL `id`, which differs on every node and would fork the hash. The BYTEA columns
 * (session_id, sealed_root, participant pubkeys, frost_signature) are hex-encoded by the consumer
 * (see header). (`correlation_id` belongs to conversation_seal_staging, not this table; it is kept
 * in the FORBIDDEN test set only as a defensive guard, not because it is a column here.)
 */
export const SEAL_NOTARIZATIONS_SPEC: TierATableSpec = {
  table: "seal_notarizations",
  naturalKey: ["session_id", "seal_type"],
  immutableColumns: [
    "session_id",
    "seal_type",
    "sealed_root",
    "participant_a_pubkey",
    "participant_b_pubkey",
    "close_timestamp",
    "frost_signature",
  ],
};

// ─── THE TABLES THAT WERE REPLICATED ON AWS BUT MISSING HERE ───────────────────────────────────
// The AWS Postgres mesh replicated 21 tables. Only 4 were ported to AE. The remaining 15 were
// noticed on 2026-07-31 when registration broke because capability_claim_codes was one of them.
// The specs below restore the missing cross-node consistency. Node-local tables (sessions,
// pickup_queue, pending_notifications, directory_checkpoints, checkpoint_node_signatures,
// registrations, pre_authorization_tokens) are NOT included — they are intentionally per-node.

/**
 * capability_claim_codes (V43). Short CELLO- codes the ops-agent hands to operators; the agent
 * redeems against whichever directory it connects to (the migration comment says exactly this).
 * Natural key: `code` (TEXT PK). Immutable at insert; `redeemed_at` is a one-time audit stamp
 * excluded from the hash to avoid the apply-side UPDATE. `expires_at` IS stable and included so
 * stale codes are not silently accepted as valid after convergence.
 */
export const CAPABILITY_CLAIM_CODES_SPEC: TierATableSpec = {
  table: "capability_claim_codes",
  naturalKey: ["code"],
  immutableColumns: ["code", "capability", "expires_at"],
};

/**
 * authorized_issuers (V46). The set of Ed25519 pubkeys the directory trusts to submit trust signals.
 * Needs to be the same on every node — a portal key enrolled on one and not the others produces
 * exactly the manual three-node enrolment that was done today because this was missing.
 * Natural key: `pubkey`. `status` (active/revoked) is mutable → excluded; it rides Tier B when
 * that gets wired. `added_at`/`revoked_at` are per-node timestamps → excluded.
 */
export const AUTHORIZED_ISSUERS_SPEC: TierATableSpec = {
  table: "authorized_issuers",
  naturalKey: ["pubkey"],
  immutableColumns: ["pubkey", "role", "label"],
};

/**
 * signal_records (V46, as amended through V55). Trust-signal notarizations. Natural key:
 * (signal_hash, accepting_node). All identity columns are immutable. `supersedes_hash` is the one
 * nullable column and IS included — it is part of the record's semantic identity (the supersession
 * chain) and never changes after insert.
 *
 * NO `subject` COLUMN. V55 dropped it. Writing this spec from the CREATE TABLE in V46 alone named a
 * column that nine later migrations had removed, and the cost was not local: the digest query for
 * ONE bad table throws, `handling_ae_state_req` fails, and the peer's whole round dies — so a single
 * wrong column name silently halted replication of ALL eleven Tier-A tables across all three nodes.
 * Registration then failed with CLAIM_CODE_INVALID, because claim codes minted on one node never
 * reached the node the client actually picked. Read the table's migrations to HEAD, never its
 * CREATE TABLE; `ae-spec-schema.test.ts` now asserts every spec column against the built schema.
 */
export const SIGNAL_RECORDS_SPEC: TierATableSpec = {
  table: "signal_records",
  naturalKey: ["signal_hash", "accepting_node"],
  immutableColumns: [
    "signal_hash",
    "accepting_node",
    "subject_kind",
    "issuer_kind",
    "issuer_pubkey",
    "type",
    "supersedes_hash",
  ],
};

/**
 * submission_results (V56). The outcome the portal wrote back per submission. Natural key:
 * (submission_id, accepting_node). `ciphertext` is BYTEA — consumer must hex-encode. All columns
 * set at INSERT, no UPDATE path.
 */
export const SUBMISSION_RESULTS_SPEC: TierATableSpec = {
  table: "submission_results",
  naturalKey: ["submission_id", "accepting_node"],
  immutableColumns: [
    "submission_id",
    "accepting_node",
    "issuer_pubkey",
    "outcome",
    "reason",
    "signal_hash",
    "ciphertext",
  ],
};

/**
 * relay_registrations (V19). One row per relay. Natural key: `relay_id` (UNIQUE TEXT). The
 * `deregistered_at` column is a one-time NULL→timestamp flip and is EXCLUDED from the hash
 * (mutable → Tier B when wired). `chain_hash` and `id` (BIGSERIAL) are local → excluded.
 * `registered_at` is a stable TIMESTAMPTZ set at INSERT → included.
 */
export const RELAY_REGISTRATIONS_SPEC: TierATableSpec = {
  table: "relay_registrations",
  naturalKey: ["relay_id"],
  immutableColumns: ["relay_id", "public_key_hex", "region", "registered_at"],
};

/**
 * directory_nodes (V17). The consortium's own node registry. Natural key: `node_id` (UNIQUE TEXT).
 * `endpoint` and `status` are mutable → excluded. `created_at` is per-node → excluded.
 */
export const DIRECTORY_NODES_SPEC: TierATableSpec = {
  table: "directory_nodes",
  naturalKey: ["node_id"],
  immutableColumns: ["node_id", "region"],
};

/**
 * conversation_seals (V2). Sealed conversation records. Natural key: `conversation_id` (UUID UNIQUE).
 * `chain_hash` and `id` (BIGSERIAL) are local → excluded. All other columns are set at seal time
 * and never updated.
 */
export const CONVERSATION_SEALS_SPEC: TierATableSpec = {
  table: "conversation_seals",
  naturalKey: ["conversation_id"],
  immutableColumns: [
    "conversation_id",
    "merkle_root",
    "close_type",
    "close_reason_code",
    "participant_count",
    "seal_date",
  ],
};

/**
 * The registered Tier-A specs — all tables that must converge to the same value across nodes.
 * Previously four; expanded 2026-07-31 to cover the tables that were in the AWS Postgres mesh
 * but were never registered for AE.
 *
 * NOT included (node-local by design):
 *   sessions, pickup_queue, pending_notifications — per-node delivery state
 *   directory_checkpoints, checkpoint_node_signatures — parked checkpoint machinery (M12-P5)
 *   registrations, pre_authorization_tokens — per-node Telegram registration state machine
 *   conversation_seal_staging — ephemeral staging rows consumed during the seal ceremony
 */
export const TIER_A_SPECS: readonly TierATableSpec[] = [
  AGENT_PROFILES_SPEC,
  AGENT_REVOCATIONS_SPEC,
  USER_ACCOUNTS_SPEC,
  SEAL_NOTARIZATIONS_SPEC,
  CAPABILITY_CLAIM_CODES_SPEC,
  AUTHORIZED_ISSUERS_SPEC,
  SIGNAL_RECORDS_SPEC,
  SUBMISSION_RESULTS_SPEC,
  RELAY_REGISTRATIONS_SPEC,
  DIRECTORY_NODES_SPEC,
  CONVERSATION_SEALS_SPEC,
];

/**
 * Encode one Tier-A row into its natural key + record hash.
 *
 * A column absent from the row (or `undefined`) is treated as SQL NULL, so a row read with a
 * missing column hashes identically on every node rather than depending on whether the driver
 * omitted or nulled it.
 */
export function encodeTierARecord(spec: TierATableSpec, row: TableRow): { key: string; hash: string } {
  const fields: Record<string, CanonicalValue> = {};
  for (const col of spec.immutableColumns) {
    const v = row[col];
    fields[col] = v === undefined ? null : v;
  }
  const hash = recordHash(spec.table, fields);
  // Natural-key columns are part of immutableColumns (asserted in tests), so they are never
  // undefined for a valid row. Composite keys are NUL-joined — NUL never appears in an
  // id/hash/enum column value, so the joined key is unambiguous (seal_notarizations, etc.).
  const key = spec.naturalKey.map((k) => String(row[k])).join("\u0000");
  return { key, hash };
}
