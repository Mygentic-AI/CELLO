---
name: Missing Table Investigations — seal_notarizations, notification_queue, connections, pending_connection_requests
type: discussion
date: 2026-05-18 06:00
topics: [M4, postgres, schema, migrations, PgDirectoryStore, persistence]
status: active
description: Investigation of four tables referenced by PgDirectoryStore but missing from the Flyway migration set, discovered during the first live M4 agent-to-agent session. Documents what each table is, what it stores, its design requirements, and the story it belongs in.
---

# Missing Table Investigations

Four tables are referenced by `PgDirectoryStore` but have no Flyway migration. All four produce silent `adapter.write.failed` log errors during live sessions. This document records what each table is, what it stores, and the story it should belong to.

Discovered via: the first live M4 agent-to-agent session (2026-05-18), where `[CONN] Connection established` was immediately followed by two `adapter.write.failed` errors.

---

## 1. `seal_notarizations`

### What it stores

A completed FROST seal notarization — the final output of a session's seal ceremony. Called by `recordNotarization()` after `[SEAL] Sealed` is logged.

```typescript
interface SealNotarization {
  session_id: Uint8Array;          // 16-byte session identifier
  sealed_root: Uint8Array;         // 32-byte Merkle root
  participant_a_pubkey: Uint8Array; // 32-byte Ed25519 pubkey
  participant_b_pubkey: Uint8Array; // 32-byte Ed25519 pubkey
  close_timestamp: number;          // Unix ms
  frost_signature: Uint8Array;      // 64-byte FROST threshold signature
}
```

### Design requirements

- **Append-only**: once written, a notarization is permanent. A session can only be sealed once.
- **RLS**: INSERT + SELECT for `cello_service`. No UPDATE or DELETE.
- **Chain hash**: yes — this is a tamper-evident record. `chain_hash` column required.
- **Lookup**: by `session_id` (UNIQUE constraint).
- **Relation**: `session_id` should reference `conversation_seals.conversation_id` if that FK makes sense, or be standalone. Given `conversation_seals` already contains `merkle_root`, this table adds the FROST signature that co-signs it.

### Story assignment

**PERSIST-017**: `seal_notarizations` migration + `getNotarization()` implementation in `PgDirectoryStore`. Currently `getNotarization()` returns `undefined` (stub). This table makes sealed_root independently verifiable via FROST signature lookup.

---

## 2. `notification_queue`

### What it stores

Pending directory notifications for agents that are currently offline. When the directory needs to deliver a `DirectoryNotification` to an agent that isn't connected, it enqueues the notification. When the agent reconnects, `drainNotifications()` dequeues all pending items.

```typescript
type DirectoryNotification =
  | SessionAbandoned
  | SessionSealed
  | SessionSealRejected
  | SealVerified
  | ConnectionEstablished;
```

The queue stores: `pubkey_hex` (target agent) + `payload` (JSON-serialized `DirectoryNotification`).

### Design requirements

- **Mutable**: rows are consumed (deleted) when `drainNotifications()` runs. This table is NOT append-only.
- **RLS**: INSERT + SELECT + DELETE for `cello_service`. No UPDATE.
- **No chain hash**: this is a delivery queue, not an audit record. Entries are ephemeral.
- **Lookup**: by `pubkey_hex` (index, not unique — multiple notifications per agent).
- **Ordering**: `created_at DESC` or FIFO via `id` ordering.

### Current stub behavior

`drainNotifications()` currently returns `[]` always — notifications are never delivered to offline agents. This means the unilateral seal notification (PERSIST-015 AC-005: "B receives SEAL_UNILATERAL notification on reconnect") is NOT working in production even though PERSIST-015 passed its unit tests. The unit test used in-memory state; the real path requires this table.

### Story assignment

**PERSIST-018**: `notification_queue` migration + `enqueueNotification()` + `drainNotifications()` implementation. This unblocks PERSIST-E2E-001 AC-005 (unilateral seal notification on reconnect).

---

## 3. `connections`

### What it stores

Established connection records — the outcome of a successful `cello_request_connection` / `cello_accept_connection` flow.

```sql
connections (
  connection_id     TEXT PRIMARY KEY,  -- connection_id from CONNREQ-002
  participant_a     TEXT NOT NULL,     -- k_local_pubkey of initiator
  participant_b     TEXT NOT NULL,     -- k_local_pubkey of target
  established_at    BIGINT NOT NULL,   -- Unix ms
  status            TEXT NOT NULL      -- 'active'
)
```

### Design requirements

- **Append-only**: connections are never deleted. Status changes (revocation, M5+) would be a new row in a separate table.
- **RLS**: INSERT + SELECT for `cello_service`. No UPDATE or DELETE.
- **Chain hash**: yes — connection establishment is a protocol event that should be tamper-evident.
- **Lookup**: by `(participant_a, participant_b)` pair (for `hasConnection()`) AND by `connection_id` (for `getConnection()`).

### Current stub behavior

`hasConnection()` always returns `null` — the directory's connection gate currently relies entirely on in-memory state. If the directory restarts, all connection state is lost. This means after a directory restart, agents cannot initiate sessions even though they had established connections — they must re-run `cello_request_connection`.

### Story assignment

**PERSIST-019**: `connections` migration + `hasConnection()` + `getConnection()` implementation. This makes connection state survive directory restarts — currently a known limitation that requires re-registering after every restart.

---

## 4. `pending_connection_requests`

### What it stores

Connection requests queued for offline agents. When A sends a `connection_request` to B but B is not currently connected to the directory, the directory queues the request so it can be delivered when B reconnects.

```sql
pending_connection_requests (
  id            BIGSERIAL PRIMARY KEY,
  target_pubkey TEXT NOT NULL,           -- k_local_pubkey of offline target
  payload       JSONB NOT NULL,          -- JSON PendingConnectionRequest
  created_at    TIMESTAMPTZ DEFAULT now()
)
```

### Design requirements

- **Mutable**: rows are consumed (deleted) when `dequeuePendingConnectionRequests()` runs.
- **RLS**: INSERT + SELECT + DELETE for `cello_service`. No UPDATE.
- **No chain hash**: delivery queue, not audit record.
- **Lookup**: by `target_pubkey` (index, not unique).
- **Expiry**: pending requests should expire (TTL). Without expiry the table grows unboundedly. TTL of ~24h is reasonable — a connection request older than a day is stale.

### Current stub behavior

`dequeuePendingConnectionRequests()` always returns `[]` — queued connection requests for offline agents are silently discarded. This means if B is offline when A sends a connection request, the request is lost. B never receives it on reconnect.

### Story assignment

**PERSIST-020**: `pending_connection_requests` migration + `queuePendingConnectionRequest()` + `dequeuePendingConnectionRequests()` implementation + TTL/expiry. This unblocks the offline-target connection flow that CONNREQ-001 designed but never persisted.

---

## Summary

| Table | Category | Append-only | Chain hash | Current stub | Blocks |
|---|---|---|---|---|---|
| `seal_notarizations` | Audit record | Yes | Yes | `getNotarization()` returns undefined | FROST signature lookup |
| `notification_queue` | Delivery queue | No | No | `drainNotifications()` returns [] | E2E-001 AC-005 |
| `connections` | Audit record | Yes | Yes | `hasConnection()` returns null | Directory restart recovery |
| `pending_connection_requests` | Delivery queue | No | No | `dequeuePendingConnectionRequests()` returns [] | Offline agent connection |

All four tables should be implemented as M4 stories (PERSIST-017 through PERSIST-020), since they were part of the M4 persistence design from the start — the implementations were just stubbed out and the migrations never written.
