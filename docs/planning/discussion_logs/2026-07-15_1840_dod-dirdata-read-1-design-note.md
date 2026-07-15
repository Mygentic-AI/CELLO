---
name: DOD-DIRDATA-READ-1 Design Note
type: discussion
date: 2026-07-15
topics: [trust-signals, track-record, directory-data, replication, Class-3]
status: draft
description: >
  Design note for DOD-DIRDATA-READ-1: how the portal's Class-3 job reads track-record
  aggregates from the directory without introducing cross-node inconsistency.
---

# DOD-DIRDATA-READ-1 — Directory Data Read Path Design

## The Problem

The portal needs to compute track-record trust signals (Class 3: session count, clean-close rate)
from directory data. The DOD constraint: **aggregates must be reproducible from any node** — no
cross-node disagreement.

The existing `pseudonym_stats` table is computed from `conversation_participation` and
`conversation_attestations`, which are **NOT replicated** (absent from `PUBLICATION_TABLES`).
Each node computes its own stats independently → nodes disagree → a signal minted from node A's
stats would not verify against node B's → **not reproducible**.

## The Solution: Compute from Already-Replicated Data

Two replicated tables contain everything we need:

| Table | Replicated | Key fields for track-record |
|-------|------------|----------------------------|
| `seal_notarizations` | ✅ | `participant_a_pubkey`, `participant_b_pubkey`, `close_timestamp` |
| `conversation_seals` | ✅ | `conversation_id`, `close_type`, `seal_date`, `participant_count` |

### Derivation

**Session count (per agent):**
```sql
SELECT COUNT(*) as session_count
FROM seal_notarizations
WHERE participant_a_pubkey = $1 OR participant_b_pubkey = $1
```

**Clean-close rate (per agent):**
```sql
SELECT
  COUNT(*) as total,
  COUNT(*) FILTER (WHERE cs.close_type = 'MUTUAL_SEAL') as clean_closes
FROM seal_notarizations sn
JOIN conversation_seals cs ON cs.conversation_id = sn.session_id::uuid
WHERE sn.participant_a_pubkey = $1 OR sn.participant_b_pubkey = $1
```

Since both source tables are replicated, every node holds the same data → the same query on any
node returns the same result → **reproducible**.

### The Join Semantics

`seal_notarizations.session_id` is BYTEA (the raw session ID bytes). `conversation_seals.conversation_id`
is UUID. The join requires a type cast — verify the encoding convention before implementing.

If the cast is lossy or ambiguous, an alternative is to add `conversation_id UUID` to
`seal_notarizations` in a future migration. But let's verify first whether the existing schema
supports the join directly.

## What the Route Exposes

A new internal route on the directory: `GET /internal/track-record/:agentPubkey`

Returns:
```json
{
  "session_count": 42,
  "clean_close_count": 38,
  "clean_close_rate": 0.905,
  "last_sealed_at": 1752000000
}
```

**Authentication:** Same pattern as `/internal/signal/deliver` — the portal authenticates via
the shared submission-seed HMAC. The route is internal-only (not exposed to clients).

**No PII:** The response is aggregate-only. The pubkey in the URL is the lookup key; the response
contains no counterparty identities, conversation content, or pseudonyms.

## What the Portal Does With It

The portal's Class-3 background job:
1. Queries `GET /internal/track-record/:agentPubkey` for each agent it manages
2. Composes a trust-signal envelope: `type: "track_record"`, `subject_kind: "agent"`,
   `subject: <agentPubkey>`, payload = `{ session_count, clean_close_rate, computed_at }`
3. Mints via the existing write path: compose → notarize → deliver (INV-CHOKEPOINT unchanged)
4. Supersedes the previous track-record signal (DOD-SUPERSEDE-1)

## Decision: Why NOT `pseudonym_stats`

| Approach | Cross-node consistent | Requires migration | Requires new replication |
|----------|----------------------|-------------------|------------------------|
| Read `pseudonym_stats` | ❌ (unreplicated inputs) | No | Yes (replicate 3 tables) |
| Compute from `seal_notarizations` + `conversation_seals` | ✅ | No (tables exist) | No |
| Compute from replicated-only tables | ✅ | Possibly (join clarity) | No |

**Decision: compute from `seal_notarizations` + `conversation_seals`.** No new replication needed.
The `pseudonym_stats` table and its job remain for internal analytics but are NOT the source for
externally-verified track-record signals.

## Open Items

1. **Join feasibility:** Verify `seal_notarizations.session_id` (BYTEA) can be joined to
   `conversation_seals.conversation_id` (UUID) — check encoding convention in the seal path.
2. **Pubkey format in `seal_notarizations`:** Is it raw 32 bytes or hex-encoded? The route
   parameter will be hex; the query must match.
3. **Index:** `seal_notarizations` has no index on participant pubkeys. For low row counts
   (alpha) this is fine; add a composite index before scale.
4. **Staleness window:** The portal job runs periodically. How stale can the track-record be
   before it's misleading? The envelope's `issued_at` + TTL handles this — the recipient checks
   freshness per DOD-VERIFY-1.

## Scope Note (Launch Triage)

At launch, session count and clean-close rate from replicated data is sufficient. The full
`pseudonym_stats` aggregation (unique counterparties, flagged count, graph edges) is not needed
for the initial track-record signal — it serves internal analytics only. The migration to
replicate `conversation_participation` is deferred until a signal type needs per-counterparty
breakdown.
