---
name: client-db-schema-design
type: discussion
date: 2026-05-30
topics: [client, persistence, SQLCipher, FROST, schema, M7]
status: decision
description: >
  Full client-side SQLCipher database schema. Triggered by discovering that
  the FROST share (threshold signing material) is not persisted — only the
  client_store key/value table exists. This document defines 16 tables covering
  everything that must survive a process restart or device migration.
---

# Client-Side SQLCipher Database Schema

## Context

During DEMO-001 deployment (2026-05-30), we discovered that `cello-mcp` loses
the FROST key share on every process restart. The demo agent service (`systemd`)
couldn't start because `registered=false` after restart — the FROST share was
in an in-memory `Map` and was gone.

Investigation revealed the root cause: **PERSIST-009 (M4) created one generic
key/value table (`client_store`) as a foundation, but no structured schema was
ever designed or written**. Every client-side story assumed "persistence will
come later" — and no milestone ever defined what the full schema should be.

This document is the output of a multi-agent workflow that scanned all stories
(M0–M9) and all client code to determine what the database must hold.

---

## What Must Survive a Restart or Device Migration

Everything in this schema is lost if it's not persisted. The test: "if the
laptop battery dies, what is gone?"

| Data | Currently | After This Schema |
|---|---|---|
| K_local seed (private key) | File on disk ✓ | File on disk (unchanged) |
| FROST key share | RAM only ✗ | `frost_key_shares` ✓ |
| ML-DSA-44 keypair | RAM only ✗ | `ml_dsa_keypairs` ✓ |
| Registration state (agent_id, primary_pubkey) | RAM only ✗ | `registration_state` ✓ |
| Session history + Merkle leaves | RAM only ✗ | `sessions` + `session_tree_leaves` ✓ |
| Sealed receipts | RAM only ✗ | `sessions` (seal columns) ✓ |
| Connection records | RAM only ✗ | `connections` ✓ |
| Connection policy | RAM only ✗ | `connection_policy` ✓ |
| Trust signals (endorsements, attestations) | Not persisted ✗ | `endorsements` + `attestations` ✓ |
| Peer registry (K_local → libp2p Peer ID) | RAM only ✗ | `peers` ✓ |
| Pending hash queue | Partially ✗ | `pending_hashes` ✓ |
| Relay ACK receipts | Partially ✓ | `relay_ack_receipts` ✓ |
| Backup metadata | Not persisted ✗ | `backup_metadata` ✓ |

**What is intentionally ephemeral (not persisted, correctly so):**
- Open transport streams (relay, directory, signaling)
- Pending Promise resolver closures
- In-flight connection ceremony state (counterparty will timeout)
- Active receive queues

---

## The 18 Tables (15 structured + 3 gap tables)

### Dependency Order

```
agents                          ← root; everything else FKs here
  ├── registration_state
  ├── frost_key_shares
  ├── ml_dsa_keypairs
  ├── connection_policy
  │     └── connection_policy_requirements
  ├── connections
  ├── endorsements
  ├── attestations
  ├── peers
  ├── sessions
  │     └── session_tree_leaves
  ├── pending_hashes
  ├── relay_ack_receipts
  └── backup_metadata
```

---

## Full Schema

```sql
-- ============================================================
-- V2__client_schema_structured.sql
-- CELLO Client — structured tables
--
-- Dependency order: agents → all other tables.
-- Timestamps: TEXT ISO-8601 unless arithmetic needed (then INTEGER ms).
-- Crypto material: BLOB unless used as index/key (then TEXT hex).
-- SQLCipher AES-256-CBC; db_key = HKDF(K_local seed) at runtime.
-- K_local PRIVATE KEY is NEVER stored here — it lives in key_file_path.
-- ============================================================

-- ── 1. agents ────────────────────────────────────────────────
-- Root identity anchor. One row per K_local keypair on this device.
-- All other agent-scoped tables FK to agents(pubkey).
-- key_file_path: absolute path to 37-byte seed file (4-byte magic +
--   1-byte version + 32-byte seed), permissions 0o600.
-- The db_key is HKDF-derived from that seed — this table is only
-- readable if the caller already holds the seed.
CREATE TABLE IF NOT EXISTS agents (
    pubkey              TEXT    NOT NULL,  -- Ed25519 K_local pubkey, 32-byte hex
    agent_name          TEXT    NOT NULL DEFAULT '',
    key_file_path       TEXT    NOT NULL,  -- absolute path to seed file
    ml_dsa_key_file_path TEXT,            -- legacy flat file path; NULL when in ml_dsa_keypairs
    created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
    last_seen_at        TEXT    NOT NULL DEFAULT (datetime('now')),
    is_active           INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (pubkey)
);

-- ── 2. registration_state ────────────────────────────────────
-- Directory registration result. One row per agent.
-- agent_id: directory-assigned opaque identifier (16-byte hex).
-- primary_pubkey: FROST group public key produced by DKG.
-- ml_dsa_pubkey: 1312-byte post-quantum signing key (hex, 2624 chars).
CREATE TABLE IF NOT EXISTS registration_state (
    agent_pubkey    TEXT    NOT NULL,
    agent_id        TEXT    NOT NULL,   -- directory-assigned, hex
    primary_pubkey  TEXT    NOT NULL,   -- FROST group pubkey, hex
    ml_dsa_pubkey   TEXT    NOT NULL,   -- ML-DSA-44 pubkey, hex
    registered_at   INTEGER NOT NULL,   -- Unix ms
    status          TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active')),
    created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (agent_pubkey),
    FOREIGN KEY (agent_pubkey) REFERENCES agents(pubkey) ON DELETE CASCADE,
    UNIQUE (agent_id)
);

-- ── 3. frost_key_shares ──────────────────────────────────────
-- FROST DKG output. One active row per agent.
-- signing_share: 32-byte secret scalar — SENSITIVE, never log.
-- commitments_cbor / verifying_shares_cbor: CBOR-encoded variable-length
--   arrays from FrostPublic.commitments and FrostPublic.verifyingShares.
-- Partial UNIQUE index enforces single-active-share invariant.
-- THIS IS THE TABLE THAT FIXES THE DEMO-001 RESTART BUG.
CREATE TABLE IF NOT EXISTS frost_key_shares (
    agent_pubkey            TEXT    NOT NULL,
    epoch_id                TEXT    NOT NULL,   -- e.g. "{pubkeyHex}:epoch:1"
    primary_pubkey          TEXT    NOT NULL,   -- FROST group pubkey hex
    identifier              TEXT    NOT NULL,   -- FrostSecret.identifier hex
    signing_share           BLOB    NOT NULL,   -- 32 bytes — SENSITIVE
    threshold               INTEGER NOT NULL,
    participants            INTEGER NOT NULL,
    commitments_cbor        BLOB    NOT NULL,   -- FrostPublic.commitments[]
    verifying_shares_cbor   BLOB    NOT NULL,   -- FrostPublic.verifyingShares
    dkg_method              TEXT    NOT NULL CHECK (dkg_method IN ('trusted_dealer','network_dkg')),
    is_active               INTEGER NOT NULL DEFAULT 1,
    created_at              TEXT    NOT NULL DEFAULT (datetime('now')),
    validated_at            TEXT,
    PRIMARY KEY (agent_pubkey, epoch_id),
    FOREIGN KEY (agent_pubkey) REFERENCES agents(pubkey) ON DELETE CASCADE
);
-- Single active share per agent enforced at DB level
CREATE UNIQUE INDEX IF NOT EXISTS uq_frost_key_shares_active
    ON frost_key_shares(agent_pubkey) WHERE is_active = 1;

-- ── 4. ml_dsa_keypairs ───────────────────────────────────────
-- ML-DSA-44 post-quantum keypair generated at cello_register.
-- secret_key_blob: raw 2560-byte secret key as BLOB (encrypted by SQLCipher).
-- Needed to sign ConnectionPackages. Lost on restart without this table.
CREATE TABLE IF NOT EXISTS ml_dsa_keypairs (
    agent_pubkey        TEXT    NOT NULL,
    ml_dsa_pubkey       TEXT    NOT NULL,   -- hex, 2624 chars
    secret_key_blob     BLOB    NOT NULL,   -- 2560 bytes — SENSITIVE
    algorithm           TEXT    NOT NULL DEFAULT 'ML-DSA-44',
    created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (agent_pubkey),
    FOREIGN KEY (agent_pubkey) REFERENCES agents(pubkey) ON DELETE CASCADE
);

-- ── 5. connection_policy ─────────────────────────────────────
-- Agent's current connection policy. One row per agent.
CREATE TABLE IF NOT EXISTS connection_policy (
    agent_pubkey    TEXT    NOT NULL,
    mode            TEXT    NOT NULL CHECK (mode IN ('open','selective','guarded','closed')),
    review_mode     TEXT    NOT NULL CHECK (review_mode IN ('deterministic','inference')),
    updated_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (agent_pubkey),
    FOREIGN KEY (agent_pubkey) REFERENCES agents(pubkey) ON DELETE CASCADE
);

-- ── 6. connection_policy_requirements ───────────────────────
-- Ordered SignalRequirements for the agent's policy.
-- position is 0-based; evaluated in order.
CREATE TABLE IF NOT EXISTS connection_policy_requirements (
    agent_pubkey    TEXT    NOT NULL,
    position        INTEGER NOT NULL,
    signal_type     TEXT    NOT NULL CHECK (signal_type IN ('endorsement','attestation','pseudonym_age','registration_age')),
    condition_json  TEXT    NOT NULL,   -- JSON-encoded SignalCondition
    PRIMARY KEY (agent_pubkey, position),
    FOREIGN KEY (agent_pubkey) REFERENCES connection_policy(agent_pubkey) ON DELETE CASCADE
);

-- ── 7. connections ───────────────────────────────────────────
-- Established connections after CONNREQ-002 ceremony.
-- One row per (agent, counterparty) pair.
CREATE TABLE IF NOT EXISTS connections (
    connection_id               TEXT    NOT NULL,
    agent_pubkey                TEXT    NOT NULL,
    counterparty_pubkey         TEXT    NOT NULL,   -- hex
    counterparty_primary_pubkey TEXT    NOT NULL DEFAULT '',
    counterparty_ml_dsa_pubkey  TEXT    NOT NULL DEFAULT '',
    established_at              INTEGER NOT NULL,   -- Unix ms
    status                      TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active')),
    profile_unchecked           INTEGER NOT NULL DEFAULT 0,
    created_at                  TEXT    NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (connection_id),
    FOREIGN KEY (agent_pubkey) REFERENCES agents(pubkey) ON DELETE CASCADE,
    UNIQUE (agent_pubkey, counterparty_pubkey)
);
CREATE INDEX IF NOT EXISTS idx_connections_agent ON connections(agent_pubkey);

-- ── 8. endorsements ──────────────────────────────────────────
-- External endorsements held for outbound ConnectionPackages.
CREATE TABLE IF NOT EXISTS endorsements (
    agent_pubkey            TEXT    NOT NULL,
    endorser_pubkey         TEXT    NOT NULL,
    endorser_ml_dsa_pubkey  BLOB    NOT NULL,   -- 1312 bytes
    target_pubkey           TEXT    NOT NULL,
    endorsement_type        TEXT    NOT NULL,
    created_at              INTEGER NOT NULL,   -- Unix ms
    expires_at              INTEGER NOT NULL,   -- Unix ms
    endorser_ml_dsa_sig     BLOB    NOT NULL,   -- 2420-byte ML-DSA-44 signature
    received_at             TEXT    NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (agent_pubkey, endorser_pubkey),
    FOREIGN KEY (agent_pubkey) REFERENCES agents(pubkey) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_endorsements_expires ON endorsements(expires_at);

-- ── 9. attestations ──────────────────────────────────────────
-- Attestations held by this agent (self-issued or third-party).
CREATE TABLE IF NOT EXISTS attestations (
    agent_pubkey            TEXT    NOT NULL,
    attester_pubkey         TEXT    NOT NULL,
    attestation_type        TEXT    NOT NULL,
    attester_ml_dsa_pubkey  BLOB    NOT NULL,   -- 1312 bytes
    attestation_data        BLOB    NOT NULL,
    created_at              INTEGER NOT NULL,   -- Unix ms
    expires_at              INTEGER NOT NULL,   -- Unix ms
    attester_ml_dsa_sig     BLOB    NOT NULL,   -- 2420 bytes
    received_at             TEXT    NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (agent_pubkey, attester_pubkey, attestation_type),
    FOREIGN KEY (agent_pubkey) REFERENCES agents(pubkey) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_attestations_expires ON attestations(expires_at);

-- ── 10. peers ────────────────────────────────────────────────
-- Known libp2p peers. Maps K_local pubkey → libp2p Peer ID + multiaddrs.
-- connected is always written as 0 — live state is not durable.
CREATE TABLE IF NOT EXISTS peers (
    agent_pubkey    TEXT    NOT NULL,
    peer_pubkey_hex TEXT    NOT NULL,   -- CELLO K_local pubkey hex
    peer_id         TEXT    NOT NULL,   -- libp2p Peer ID string
    multiaddrs      TEXT    NOT NULL,   -- JSON array of multiaddr strings
    added_at        TEXT    NOT NULL DEFAULT (datetime('now')),
    last_seen_at    TEXT,
    updated_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (agent_pubkey, peer_pubkey_hex),
    FOREIGN KEY (agent_pubkey) REFERENCES agents(pubkey) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_peers_peer_id ON peers(agent_pubkey, peer_id);

-- ── 11. sessions ─────────────────────────────────────────────
-- Per-session metadata (active and sealed).
-- Merkle leaves are in session_tree_leaves (NOT stored here as BLOB).
-- close_timestamp is INTEGER for arithmetic. All crypto material is BLOB.
CREATE TABLE IF NOT EXISTS sessions (
    session_id              TEXT    NOT NULL,
    agent_pubkey            TEXT    NOT NULL,
    counterparty_pubkey     BLOB    NOT NULL,   -- 32 bytes
    counterparty_peer_id    TEXT    NOT NULL,
    counterparty_multiaddrs TEXT    NOT NULL,   -- JSON array
    relay_peer_id           TEXT    NOT NULL,
    relay_multiaddrs        TEXT    NOT NULL,   -- JSON array
    directory_peer_id       TEXT    NOT NULL,
    directory_multiaddrs    TEXT    NOT NULL,   -- JSON array
    directory_pubkey        BLOB    NOT NULL,   -- 32 bytes
    genesis_prev_root       BLOB    NOT NULL,   -- 32 bytes
    last_seen_seq           INTEGER NOT NULL DEFAULT 0,
    last_sent_seq           INTEGER NOT NULL DEFAULT 0,
    next_expected_seq       INTEGER NOT NULL DEFAULT 1,
    status                  TEXT    NOT NULL CHECK (status IN ('active','transport_lost','sealing','sealed','seal_rejected','seal_deferred')),
    desynchronized          INTEGER NOT NULL DEFAULT 0,
    leaf_count              INTEGER NOT NULL DEFAULT 0,
    -- Seal fields (NULL until seal ceremony completes)
    sealed_root             BLOB,               -- 32 bytes
    seal_type               TEXT    CHECK (seal_type IN ('frost','bilateral','unilateral')),
    close_timestamp         INTEGER,            -- Unix ms
    frost_signature         BLOB,               -- 64-byte FROST combined signature
    signer_pubkey           BLOB,               -- 32 bytes (initiator's primary_pubkey)
    directory_signature     BLOB,               -- Ed25519 fallback signature
    -- MMR checkpoint (PERSIST-017)
    checkpoint_status       TEXT    NOT NULL DEFAULT 'pending' CHECK (checkpoint_status IN ('pending','confirmed')),
    checkpoint_peak_hash    TEXT,
    checkpoint_leaf_index   INTEGER,
    checkpoint_sibling_hashes TEXT,             -- JSON array of hex strings
    created_at              TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at              TEXT    NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (session_id, agent_pubkey),
    FOREIGN KEY (agent_pubkey) REFERENCES agents(pubkey) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_sessions_agent ON sessions(agent_pubkey, status);

-- ── 12. session_tree_leaves ──────────────────────────────────
-- Ordered Merkle leaf log. APPEND-ONLY. Never update or delete.
-- s2_cbor: raw Structure 2 CBOR verbatim — never re-encode.
-- Loss of any row makes SEAL impossible (root cannot be recomputed).
-- This is the most critical data in the local DB.
CREATE TABLE IF NOT EXISTS session_tree_leaves (
    session_id      TEXT    NOT NULL,
    agent_pubkey    TEXT    NOT NULL,
    leaf_index      INTEGER NOT NULL,   -- 0-based insertion order
    leaf_kind       TEXT    NOT NULL CHECK (leaf_kind IN ('msg','ctrl')),
    s2_cbor         BLOB    NOT NULL,   -- raw Structure 2 CBOR
    sequence_number INTEGER NOT NULL,   -- relay global sequence number
    accepted_at     TEXT    NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (session_id, agent_pubkey, leaf_index),
    FOREIGN KEY (agent_pubkey) REFERENCES agents(pubkey) ON DELETE CASCADE,
    FOREIGN KEY (session_id, agent_pubkey) REFERENCES sessions(session_id, agent_pubkey) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_session_tree_leaves_seq
    ON session_tree_leaves(session_id, agent_pubkey, sequence_number);

-- ── 13. pending_hashes ───────────────────────────────────────
-- FIFO queue of Structure 1 hashes awaiting relay ACK.
-- Deleted only AFTER the ACK is stored in relay_ack_receipts.
CREATE TABLE IF NOT EXISTS pending_hashes (
    id              INTEGER NOT NULL PRIMARY KEY,   -- insertion order = FIFO
    agent_pubkey    TEXT    NOT NULL,
    session_id      TEXT    NOT NULL,
    hash_hex        TEXT    NOT NULL,   -- SHA-256 hex
    enqueued_at     INTEGER NOT NULL,   -- Unix ms
    FOREIGN KEY (agent_pubkey) REFERENCES agents(pubkey) ON DELETE CASCADE,
    UNIQUE (agent_pubkey, session_id, hash_hex)
);
CREATE INDEX IF NOT EXISTS idx_pending_hashes_agent_session
    ON pending_hashes(agent_pubkey, session_id);

-- ── 14. relay_ack_receipts ───────────────────────────────────
-- Immutable signed relay ACK log. INSERT OR IGNORE — first ACK wins.
-- relay_timestamp is INTEGER (it is part of the signed TBS, exact integer).
CREATE TABLE IF NOT EXISTS relay_ack_receipts (
    hash_hex            TEXT    NOT NULL,
    agent_pubkey        TEXT    NOT NULL,
    session_id          TEXT    NOT NULL,
    relay_id            TEXT    NOT NULL,
    relay_pubkey_hex    TEXT    NOT NULL,   -- 32-byte Ed25519 pubkey, hex
    sequence_number     INTEGER NOT NULL,
    relay_timestamp     INTEGER NOT NULL,   -- Unix ms, from signed TBS
    signature_hex       TEXT    NOT NULL,   -- 64-byte Ed25519 signature, hex
    acked_at            TEXT    NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (hash_hex, agent_pubkey),
    FOREIGN KEY (agent_pubkey) REFERENCES agents(pubkey) ON DELETE CASCADE
);

-- ── 15. backup_metadata ──────────────────────────────────────
-- Most recent successful cloud backup. backup_key NOT stored here.
CREATE TABLE IF NOT EXISTS backup_metadata (
    agent_pubkey    TEXT    NOT NULL,
    completed_at    TEXT    NOT NULL,
    destination_url TEXT    NOT NULL,
    checksum        TEXT    NOT NULL,   -- SHA-256 hex of ciphertext blob
    updated_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (agent_pubkey),
    FOREIGN KEY (agent_pubkey) REFERENCES agents(pubkey) ON DELETE CASCADE
);

```

---

## Gaps — Not Covered by This Schema

These are real needs identified during the analysis but intentionally excluded
from V2 because they belong to specific future milestones:

### Immediate gaps (should be fixed soon)

**1. Relay registry**
`lookupRelayPubkey(relayId)` needs a source of truth for relay Ed25519 signing
pubkeys. Currently implicit in config or directory lookup. A `known_relays`
table is needed for offline ACK verification.

```sql
CREATE TABLE IF NOT EXISTS known_relays (
    relay_id        TEXT NOT NULL PRIMARY KEY,
    relay_pubkey_hex TEXT NOT NULL,
    source          TEXT NOT NULL,  -- 'directory' | 'config'
    last_seen_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
```

**2. Pending inbound connection requests**
If a connection request arrives while the process is restarting, it is lost.
A `pending_connection_requests` table is needed.

**3. Decided connection requests Set**
`#decidedRequests = new Set<string>()` is ephemeral. A crash between sending
`acceptConnection` and receiving the directory ACK could cause double-decision.
A `decided_connection_requests` table prevents this.

### Future milestone gaps (M7–M9 scope)

- **M7 retry queue and nonce deduplication** (`retry_queue`, `session_seen_nonces`)
- **M9 security layer** (`security_layer_config`, `security_audit_log`, `llm_call_governor`, source classification lists, financial allowlist)

---

## The Immediate Fix (DEMO-001 Unblock)

The minimum change to unblock the demo agent:

1. Add `frost_key_shares` and `ml_dsa_keypairs` tables as a V2 migration
2. Wire `storeDkgResult()` in `frost-threshold-signer.ts` to write to `frost_key_shares` instead of the in-memory Map
3. On startup, load active FROST share from DB and pass to `createClient` as `thresholdSigner`
4. Wire `FileMlDsaKeyProvider` (or equivalent) to read/write `ml_dsa_keypairs`

This is a targeted 2-table migration + wiring change. The full 16-table V2
schema should be implemented as a dedicated M7 persistence sprint.

---

## Related Documents

- [[CELLO-PERSIST-009]] — M4 V1 schema (unstructured foundation this design replaces)
- [[CELLO-PERSIST-011]] — M4 backup/restore
- [[CELLO-PERSIST-E2E-001]] — M4 persistence E2E gate
- [[CONTEXT]] — K_local, FROST, primary_pubkey definitions
