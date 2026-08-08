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

/**
 * seal_certificate_fields (V58). Natural key `(session_id, seal_type)`, mirroring
 * `seal_notarizations` — the two are read together as one certificate.
 *
 * THIS TABLE MUST REPLICATE OR THE FEATURE DOES NOT WORK. A client that missed the `session_sealed`
 * push reconnects to WHICHEVER node it happens to pick, and asks that one. If these rows lived only
 * on the node that adjudicated the seal, the pull would answer `not_found` from the other two — the
 * same per-node-state failure as the notification queue this whole line exists to route around.
 *
 * Every column is in `immutableColumns` deliberately: the AE body carries EXACTLY this set
 * (`pg-ae-store` builds both the SELECT and the INSERT from it), so a column omitted here is a
 * column that never reaches another node. There is nothing local or mutable to exclude — the row
 * describes a signature that has already been made.
 *
 * The types are chosen for `recordHash`, which refuses a JS `number`: `leaf_count` is BIGINT (pg
 * yields a string) and `legibility` is TEXT holding the JSON verbatim. `legibility` must NOT be
 * JSONB — it is bound into the signed TBS, and JSONB reorders keys, so a round trip would return
 * bytes that differ from the bytes that were signed and every pulled certificate would fail
 * verification. `signer_pubkey` is BYTEA and is hex-encoded at the SELECT via the `bytea` list.
 */
export const SEAL_CERTIFICATE_FIELDS_SPEC: TierATableSpec = {
  table: "seal_certificate_fields",
  naturalKey: ["session_id", "seal_type"],
  immutableColumns: [
    "session_id",
    "seal_type",
    "leaf_count",
    "signer_pubkey",
    "legibility",
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
 * agent_account_links (V59). The agent↔account binding, as an append-only FACT.
 *
 * Replaces the replication of `agent_profiles.account_id`, which never happened: that column is
 * mutable, Tier A carries only immutable columns by construction, and the Tier B rule the M12 design
 * assigned it was never built. Live on 2026-08-07 one operator's three agents were linked on three
 * different nodes — 0, 2 and 1 — so the KILL SWITCH refused two of them as `not_owner`, and the
 * account leg of the self-endorsement check was silently dead wherever the link was absent.
 *
 * Both columns are immutable, so there is nothing to merge and no clock-skew hazard — the same
 * reason `agent_revocations` has always replicated correctly while the column form did not.
 * `linked_at` is a per-node wall clock and is excluded: it differs between nodes for the same fact
 * and would fork the content hash.
 */
export const AGENT_ACCOUNT_LINKS_SPEC: TierATableSpec = {
  table: "agent_account_links",
  naturalKey: ["agent_id"],
  immutableColumns: ["agent_id", "account_id"],
};

/**
 * account_email_stubs (V60). The email↔account binding as an append-only FACT.
 *
 * `user_accounts.email_stub_hash` is nullable and set after the row exists, so it is excluded from
 * that table's hashed set — correctly, because `user_accounts` is hash-chained and a
 * populated-later column would fork the chain. The consequence was that the email hash lived only
 * on the node that registered the operator: the portal asked a different node first, was told "no
 * such account", and sign-in was impossible (2026-08-07).
 *
 * Both columns are immutable, so there is nothing to merge. Keyed by the STUB because that is the
 * direction sign-in asks in, and because it leaves one account with several verified addresses
 * representable rather than forbidden by accident.
 */
export const ACCOUNT_EMAIL_STUBS_SPEC: TierATableSpec = {
  table: "account_email_stubs",
  naturalKey: ["email_stub_hash"],
  immutableColumns: ["email_stub_hash", "account_id"],
};

/**
 * conversation_participation + conversation_attestations (V2, natural keys added V61).
 *
 * THE SEAL'S CHILDREN. `recordConversationSeal` writes the header and both of these in ONE
 * transaction, but only the header was registered — so a node receiving a seal by anti-entropy
 * learned neither who took part nor what was attested, and `analytics-job` derives `pseudonym_stats`
 * and `graph_edges` from exactly these two. The track-record surface therefore differed per node
 * with nothing reporting it. Live 2026-08-07: 22 rows on gcp-use1, 38 on gcp-usc1.
 *
 * These were never weighed and excluded — they were never considered, which the file above says
 * plainly rather than laundering into the "by design" list.
 *
 * Keyed by (conversation_id, party) because the PRIMARY KEY is a BIGSERIAL that differs per node for
 * the same fact. `id` and `chain_hash` are local. `attested_at` is excluded for the reason every
 * other per-node timestamp is: it defaults to now() at the writing node, and a TIMESTAMPTZ rendered
 * under a different session TZ corrupts the instant and forks the hash. What identifies the fact is
 * the attestation and the signature over it, both of which are here.
 */
export const CONVERSATION_PARTICIPATION_SPEC: TierATableSpec = {
  table: "conversation_participation",
  naturalKey: ["conversation_id", "party_pseudonym"],
  immutableColumns: ["conversation_id", "party_pseudonym"],
};

export const CONVERSATION_ATTESTATIONS_SPEC: TierATableSpec = {
  table: "conversation_attestations",
  naturalKey: ["conversation_id", "participant_pseudonym"],
  immutableColumns: ["conversation_id", "participant_pseudonym", "attestation", "seal_signature"],
};

/**
 * signal_revocations (V62). The revocation fact, in a form that replicates.
 *
 * The tombstone in `signal_records` already has its own natural key, so it DOES replicate — but
 * `applyTierA` copies only the hashed columns, and `is_tombstone` / `revoker_pubkey` are not among
 * them. So on every peer the tombstone landed with `is_tombstone` false and `status` 'active': the
 * revocation had no effect AND the row then counted as a real one in the effective-status view's
 * aggregation, polluting the descriptive fields with its '(tombstone)' placeholders.
 *
 * Adding those columns to SIGNAL_RECORDS_SPEC would rehash every historical row and make all three
 * nodes report divergence on data that never changed (the trap V58 documents), so the fact moves to
 * its own table instead. `signal_records` is untouched.
 *
 * `recorded_at` is excluded: it is a per-node wall clock, and the moment a node learned of a
 * revocation is not part of the revocation.
 */
export const SIGNAL_REVOCATIONS_SPEC: TierATableSpec = {
  table: "signal_revocations",
  naturalKey: ["signal_hash", "revoker_pubkey"],
  immutableColumns: ["signal_hash", "revoker_pubkey", "revoker_signature"],
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
 *
 * ⚠️ THAT LIST CONTRADICTS `M12-ANTI-ENTROPY-DESIGN.md` — RESOLVED 2026-08-08 IN FAVOUR OF THIS ONE.
 *
 * The design doc's Tier-B table gives EXPLICIT MERGE RULES to five of the tables called "node-local
 * by design" above: `sessions` (owner-wins), `pre_authorization_tokens` and `capability_claim_codes`
 * (monotonic single-flip on consumed_at/redeemed_at), and `pickup_queue` + `pending_notifications`
 * (insert-plus-ack-tombstones with a bounded GC window, designed specifically so a lagging peer
 * cannot resurrect deleted ciphertext). A table with a written merge rule is not a table someone
 * decided was node-local.
 *
 * Neither document records which decision superseded which, and the evidence points at drift rather
 * than a reversal: `capability_claim_codes` and `directory_nodes` were on this "node-local" list
 * until they moved to Tier A — capability_claim_codes only after it broke Telegram registration in
 * production on 2026-07-31. So the list has already been wrong, twice, in the direction of
 * under-replicating.
 *
 * THE DETERMINATION, and the reasoning, so it is not re-litigated:
 *
 * The delivery-state tables — `sessions`, `pickup_queue`, `pending_notifications` — STAY NODE-LOCAL.
 * The design's merge rules for them are superseded by a better pattern that the codebase discovered
 * afterwards and wrote down in `#deliverOrEnqueue`: **replicate the FACT, let the client learn it.**
 *
 * The case that forced it: a seal result for a participant homed on another node is enqueued on the
 * ADJUDICATING node, so it strands and is never collected. That is real — but replicating the queue
 * is the wrong repair, for two reasons the code states itself. Replicating delivery state invites
 * double-delivery, and it is unnecessary: `seal_notarizations` is already Tier A, so the stranded
 * participant's OWN home node has the notarization and the receipt can be learned locally. That is
 * what DOD-TERMINAL-STATE-DIVERGENCE-1 / V58 builds, and it is why the queue does not need to move.
 *
 * `pre_authorization_tokens` also stays local, on the design's own admission: replicating it leaves
 * the cross-node double-spend window unchanged because the nonce binder is the real gate.
 *
 * So of the design's eight Tier-B tables: two are built (`agent_suspensions`, `agent_presence`), two
 * were solved better by becoming Tier A (`directory_nodes`, `capability_claim_codes`), and the
 * remaining four are deliberately NOT built. Tier B is finished, not abandoned.
 *
 * WHAT WOULD REOPEN THIS: a fact that a client cannot learn from replicated state and that must
 * therefore be pushed. Every case so far has turned out to be learnable. Full account:
 * `docs/planning/discussion_logs/2026-08-07_1912_replication-gap-what-m12-left-unfinished.md`.
 *
 * NOT included and NOT a decision — unregistered and unassessed (found 2026-08-03, RESOLVED 2026-08-07
 * by V61, which added their natural keys and registered them):
 *   conversation_participation, conversation_attestations
 *
 * `recordConversationSeal` writes all three of `conversation_seals`, `conversation_participation`
 * and `conversation_attestations` in ONE transaction. Only the first is registered here, so a node
 * that receives a seal by anti-entropy gets the seal header and learns neither who took part nor
 * what was attested — and `analytics-job` derives `pseudonym_stats` and `graph_edges` from exactly
 * those two tables, so the track-record surface differs per node with nothing reporting it.
 *
 * They are listed separately from the block above on purpose. Everything there was weighed and
 * excluded; these two were never considered. Writing them into the "by design" list would launder
 * an oversight into a decision — the distinction a reader cannot recover once it is lost.
 */
export const TIER_A_SPECS: readonly TierATableSpec[] = [
  AGENT_PROFILES_SPEC,
  AGENT_ACCOUNT_LINKS_SPEC,
  ACCOUNT_EMAIL_STUBS_SPEC,
  AGENT_REVOCATIONS_SPEC,
  USER_ACCOUNTS_SPEC,
  SEAL_NOTARIZATIONS_SPEC,
  SEAL_CERTIFICATE_FIELDS_SPEC,
  CAPABILITY_CLAIM_CODES_SPEC,
  AUTHORIZED_ISSUERS_SPEC,
  SIGNAL_RECORDS_SPEC,
  SIGNAL_REVOCATIONS_SPEC,
  SUBMISSION_RESULTS_SPEC,
  RELAY_REGISTRATIONS_SPEC,
  DIRECTORY_NODES_SPEC,
  CONVERSATION_SEALS_SPEC,
  CONVERSATION_PARTICIPATION_SPEC,
  CONVERSATION_ATTESTATIONS_SPEC,
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
