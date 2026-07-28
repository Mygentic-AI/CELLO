---
name: M12 Anti-Entropy Design — directory state sync over libp2p
type: design
date: 2026-07-28
milestone: M12
status: draft
topics: [m12, anti-entropy, replication, kill-switch, libp2p, security, design]
description: >
  The DOD-AE-DESIGN-1 deliverable: how directory nodes synchronize state over their
  authenticated libp2p transport, replacing the Postgres logical-replication mesh. Sync sets
  and per-table merge rules, the mutual identity handshake, the kill-switch convergence rules,
  what never syncs, and the mesh retirement list. Inputs:
  research/replication-surface-map.md and research/libp2p-identity-surface-map.md.
---

# M12 Anti-Entropy Design

**Goal.** Directories converge on shared state by talking to each other over the existing
Noise-encrypted libp2p transport, authenticated against the officer-signed consortium manifest.
No VPN, no PSA, no logical replication, no slot/worker/sequence machinery (DOD-INV-NO-VPN).
Nothing external ever connects to a node's Postgres.

**Non-goals.** No consensus, no leader, no ordering agreement. Anti-entropy reconciles *sets of
records* with per-table merge rules. `T = majority(validators)` continues to do all the
security work it does today; sync only carries state, it never authorizes anything.

---

## 1. The channel: `/cello/anti-entropy/1.0.0`

House conventions apply: registered in `CelloDirectoryNode.start()` with a bounded
`maxInboundStreams`; one request/response per stream; it-length-prefixed framing; CBOR via
`new Encoder({ tagUint8Array: false })`. Dial + reconnect loop modeled on
`NetworkRelayAdapter.connect()` (the transport's `newStream()` never dials — verified).

### 1a. Peer discovery — the manifest grows a `peerId` field

The manifest is the only trust anchor, but today it carries no dial identity (PeerIds live in
unsigned SSM only). **Add `peerId` to `ConsortiumNode`** so the officer signature covers the
dial identity end to end. (This rides the same manifest schema change as `role` from
DOD-ROLE-MANIFEST-1 — one schema bump, one client release.) Multiaddr is derived from
`endpoint` + `peerId`; a node whose live PeerId mismatches its manifest entry is refused.

### 1b. The directory starts verifying its manifest

`FileDirectoryManifestStore` explicitly does not verify officer signatures ("only a
transport"). That premise ends here: **at load, the directory runs `verifyManifest(manifest,
rootKeys, threshold)`** with root keys + threshold pinned via env/IaC (same anchor shape as the
client's bundled constants). A manifest that fails verification is rejected loudly and the
previous verified manifest stays active.

### 1c. Mutual identity handshake — step-6 made symmetric, fail-closed

Each side proves possession of its **manifest-pinned node key** (not merely a PeerId):

1. Dialer opens the stream and sends `ae_hello { nodeId_a, nonce_a(32B) }`.
2. Responder replies `ae_auth_b { nodeId_b, nonce_b(32B), sig_b }` where `sig_b` =
   Ed25519(node key B) over the shared TBS (below) with roles (a,b) fixed by who dialed.
3. Dialer replies `ae_auth_a { sig_a }` over the same TBS with its own key.
4. Each side verifies the peer's signature against the **manifest pubkey for the claimed
   nodeId**, checks the peer's libp2p PeerId (from the Noise-authenticated connection) equals
   the manifest `peerId` for that nodeId, checks both nonces match what it sent/received, and
   checks `|now − timestamp| ≤ 60s`.

**TBS** (canonical builder in `@cello-protocol/crypto`, per the shared-TBS pattern):

```
"cello-ae-peer-auth-v1\n" + nodeId_a + "\n" + nodeId_b + "\n"
  + peerId_a + "\n" + peerId_b + "\n" + nonce_a_hex + "\n" + nonce_b_hex + "\n" + isoTimestamp
```

New domain string (none of the existing domains are reused); both PeerIds are inside the TBS,
binding the manifest identity to the actual Noise channel — closing the channel-binding gap
step-6 has. Nonces both directions kill replay in both directions.

**Fail closed, always.** No unsigned variant, no fallback path, no "log and continue" — a
failed handshake terminates the stream and the peer is not synced with. (Deliberate break from
the house fail-open style; this channel has no legacy peers to accommodate.) Replicas and
validators both authenticate the same way; **role changes what a node holds, never who it is.**

### 1d. Transport placement

Sync runs over the standard libp2p listener (8080/ws today; whatever the GCP node exposes).
CONTEXT.md's "port 4001 inter-node" was never real (no listener, no PortMapping — docs-only)
and is corrected rather than implemented. Between GCP nodes and across clouds alike, the
channel rides the public endpoint — Noise + the handshake above are the security boundary,
which is the whole point of DOD-INV-NO-VPN.

---

## 2. What syncs — three tiers and per-table merge rules

Terminology: a **record** is one row serialized to canonical CBOR with its natural key; every
record has a **record hash** = SHA-256(domain-separated canonical bytes). Sync carries records
by natural key — **BIGSERIAL ids never cross the wire**, which deletes the sequence-staggering
machinery outright.

### Tier A — append-only, content-addressed (insert-if-absent, no merge logic)

| Set | Natural key | Notes |
|---|---|---|
| `agent_profiles` | `k_local_pubkey` | `account_id` backfill rides Tier B rules below |
| `conversation_seals` **+ its children** | `conversation_id` | seal + `conversation_participation` + `conversation_attestations` travel as ONE record — fixes the standing defect where children never replicated and remote seal detail is broken |
| `seal_notarizations` | `(session_id, seal_type)` | |
| `user_accounts` | `account_id` | |
| `agent_revocations` | `agent_id` | permanent tombstone; insert-only |
| `signal_records` | `(signal_hash, accepting_node)` | already the model citizen — content-addressed, revocation-as-tombstone, supersession derived |
| `directory_checkpoints` | `checkpoint_id` | records sync; semantics per §5 |
| `checkpoint_node_signatures` | `(checkpoint_id, node_id)` | |
| `relay_registrations` | `relay_id` | `deregistered_at` is a single-flip: set dominates unset |

Apply rule: insert by natural key, `ON CONFLICT DO NOTHING`. Divergence detection is a pure
set-reconciliation problem (§3). RLS already makes these physically append-only for
`cello_service` — the sync writer needs no new privileges beyond INSERT it already has.

### Tier B — mutable, explicit merge rule per table

| Set | Key | Merge rule |
|---|---|---|
| `agent_suspensions` | `agent_id` | **The kill switch — §4. Its own rules, its own review.** |
| `agent_presence` | `k_local_pubkey` | LWW on `updated_at`; `owning_node_id` is part of the value (ownership legitimately migrates on connect) |
| `directory_nodes` | `node_id` | LWW on `last_heartbeat_at` — heals the single-row anomaly (root cause: BIGSERIAL collision + silently-dropped updates) |
| `sessions` | `session_id` | **Owner-wins:** the row's `owning_node_id` is authoritative; non-owners only insert-if-absent. Participant-column updates come only from the owner |
| `pre_authorization_tokens` | `id` | Monotonic single-flip: `consumed_at` set dominates unset; earliest set wins ties. (Cross-node double-spend window is unchanged from today — the nonce binder remains the real gate) |
| `capability_claim_codes` | `code` | Same single-flip rule on `redeemed_at` |
| `pickup_queue` | `id` (UUID) | Insert-if-absent **plus ack-tombstones**: an ACK deletes the row and records `(id, acked_at)` in a small `pickup_acks` tombstone table (id + timestamp only — NO ciphertext). Tombstone dominates forever: a synced row whose id has a tombstone is never inserted. Sealed ciphertext deleted on ACK can never resurrect |
| `pending_notifications` | `notification_id` | Same insert + tombstone shape as pickup_queue |

### Tier C — NEVER syncs (each for a named reason)

- **`agent_key_shares`** — DOD-INV-SHARES-LOCAL. Not in any set, any exchange, any message.
- **`primary_holder`** — V44 is explicit: each node holds only what a daemon directly attested
  *to it*; syncing would let a superseded daemon resurrect on a node it never dialed. The
  security argument requires node-local truth.
- **`conversation_seal_staging`** — ephemeral node-local staging for the node's own MMR.
- **`authorized_issuers`** — deliberately operator-only (app has SELECT alone); distributed by
  per-node operations, not by a channel the app writes through.
- **Nonce-binding tables, `registry_documents`, `connections`, analytics** — node-local by
  design or out of scope, exactly as they are absent from today's publication.
- **`registrations` / ops-agent tables** — the ops-agent is a single global service (one
  Telegram bot); its state needs no multi-node convergence. Drops out of the sync problem.

### Hash chains under anti-entropy

The table-wide chains (`insertWithChain` ordering by local BIGSERIAL `id`) fork by construction
under any multi-master scheme and are already knowingly unverified cross-node. Ruling:
**table-wide chain columns become node-local audit trails** — still written locally, never
compared across nodes, excluded from record canonical bytes. Cross-node integrity is carried by
content addressing (the record hash) + the MMR (§5). `registrations`' per-row chain converges
and is unaffected (and doesn't sync anyway).

---

## 3. The reconciliation mechanism

Per synced table, per peer, a round is:

1. **Digest exchange.** Each side computes a **bucketed set digest**: records are bucketed by
   the first byte of their record hash (256 buckets); each bucket digest = SHA-256 of the
   sorted record hashes in it; the table digest = SHA-256 of the 256 bucket digests. One
   message carries all table digests.
2. **Bucket walk.** Tables whose digests differ exchange bucket-digest vectors; differing
   buckets exchange their sorted record-hash lists; each side computes what the other is
   missing (set difference — order-independent, no clocks involved).
3. **Record transfer.** Missing records are pulled in batches and applied inside a
   transaction with per-table merge rules (§2). Application order within a batch respects FK
   dependencies (profiles → suspensions; accounts → profiles; seals → notarizations) — under
   app-level sync the subscriber-side FK bypass (`session_replication_role=replica`) no longer
   exists, so ordering is enforced, not hoped for.
4. Tier-B tables also exchange **per-record version summaries** (the merge-relevant columns:
   `updated_at`, flip fields, `suspension_seq`) for keys both sides hold, so a mutation on an
   existing row propagates even though the key set matches. Bucketing identical to step 1-2,
   over `SHA-256(key ‖ merge-columns)` instead of the record hash.

**Cadence:** a full round per peer every 30s (jittered), plus **write-hints**: a node that
applies a local write to a Tier-B security table (`agent_suspensions` above all) immediately
sends a small `ae_hint {table, keys[]}` to every connected peer, which pulls those records
right away. Hints are best-effort; the periodic round is the guarantee.

**Scaling:** O(N) connections per node with N = consortium size; digests are O(1) per table
per round when converged. No apply workers, no slots, no WAL retention. At launch N=3 this is
trivial; the same mechanism holds to any N the threshold table supports.

**New tables:** `pickup_acks` / `notification_acks` tombstones (§2B) and `ae_peer_state`
(per-peer per-table last-completed-round bookkeeping, purely local, advisory).

---

## 4. The kill switch — convergence rules that fail toward suspended

`agent_suspensions` gets special treatment because §replication-surface-map finding 3: a
spurious `burned=true` **irreversibly destroys FROST share material**, and a lost `paused=true`
lets a compromised agent keep sealing.

**Schema additions:** `suspension_seq BIGINT NOT NULL DEFAULT 0`, `origin_node TEXT`,
plus the k_local_pubkey denormalized into the row (see below).

**Write rule (local, at the accepting node):** every state change increments
`suspension_seq = max(local_seq)+1` and stamps `origin_node = self`.

**Merge rule (on sync), in strict order:**
1. `burned`: **OR — monotonic, irreversible.** A burn can never be un-burned by any merge. (A
   spurious burn therefore cannot arise from merging — only from a forged record; records
   arrive exclusively over the mutually-authenticated channel from manifest-pinned peers.)
2. Higher `suspension_seq` wins for `paused`/`reason`/`authorized_by_account`.
3. **Equal seq, conflicting `paused`: suspended wins.** (The DoD tie rule, literally.)
4. Wall-clock `updated_at` is never a merge input — display only. Clock skew cannot un-pause.

An un-suspension is therefore only applied when it carries a strictly higher `suspension_seq`
than the pause it clears — "verifiably newer authenticated state": *newer* by the sequence,
*authenticated* by the channel handshake (records are only ever accepted from peers that
proved manifest-pinned identity in §1c).

**Closing the fails-open JOIN hole.** Today the honor-check JOINs `agent_suspensions` →
`agent_profiles` and a missing profile resolves to "not suspended" — the node signs blind
(documented production gap). Two-part fix:
- Tier A syncs `agent_profiles` everywhere, so the JOIN input converges; and
- the suspension record **denormalizes `k_local_pubkey` into `agent_suspensions`** so
  `isAgentSuspended(pubkey)` matches directly, with the JOIN kept only as a fallback. A
  suspension is honorable even by a node that has never seen the agent's profile.

The existing asymmetry is preserved exactly: DB error → fail closed (`return true`); the new
rules only remove the silent fail-open path.

**Propagation target:** pause reaches every *up, connected* node within one hint round-trip
(sub-second on healthy links; ≤30s worst-case via the periodic round). A node that was down
converges on its first completed round after rejoin — and until it has completed a round it
has no share-bearing traffic anyway, since it was down.

**Review requirement (DOD-AE-MUTABLE-1):** this section's implementation gets adversarial
review with the named scenarios: pause during partition; node restart mid-sync; stale-node
rejoin; un-pause racing pause (seq tie → suspended); burn racing un-pause (burn wins); clock
skew ±24h (no effect); forged-record attempt from an unauthenticated peer (refused at §1c).

---

## 5. Checkpoints and the MMR — scope ruling

Finding 2 of the surface map: cross-node checkpoint signing **has never worked** — the MMR
tables don't replicate, every node's peaks differ, `verifyAndSign` refuses by construction, and
`CHECKPOINT_PEER_ADDRS` is empty in every environment. The `identity_merkle_root` slot has
never been computed. This design does not pretend otherwise:

- **In M12 scope:** checkpoint *records* and *signatures* sync as Tier A data (they already
  have natural keys). The `/cello/checkpoint/1.0.0` proposal channel — currently
  unauthenticated in both directions and trusting responder-supplied pubkeys — is **retired**;
  when cross-signing is rebuilt it rides the §1 authenticated channel.
- **Deliberately out of M12 scope:** making cross-signed checkpoints actually work (a
  deterministic shared leaf order over the synced seal set is the obvious direction — the
  coordinator's `(recorded_at, conversation_id)` batch sort already exists). That is a
  post-rebuild story; it was broken before M12 and M12 leaves it *visibly* parked, not
  silently broken. → recorded as Parked item **M12-P5**.

Per-node MMRs keep running unchanged over each node's own notarized seals (in-session
inclusion proofs are unaffected).

---

## 6. Observability (first-class ACs for the implementing units)

Events (injected logger, `domain.noun.verb`, correlationId = one per round, threaded through
every event of that round):

- `antientropy.peer.authenticated` / `antientropy.peer.auth_failed` (ctx: peerNodeId, reason —
  reason names the CAUSE: `manifest_pubkey_mismatch`, `peerid_mismatch`, `nonce_mismatch`,
  `timestamp_skew`, `manifest_unverified`)
- `antientropy.round.started` / `antientropy.round.completed` (ctx: peer, tables, pulled,
  pushed, durationMs) / `antientropy.round.failed`
- `antientropy.delta.applied` (ctx: table, inserted, merged, tombstoned)
- `antientropy.suspension.applied` (ctx: agentId, paused, burned, seq, originNode) — the
  kill-switch audit trail
- `antientropy.hint.sent` / `antientropy.hint.received`
- Alarm thresholds: `round.failed` > 3 consecutive per peer → alarm; suspension hint latency
  > 60s → alarm; peer unauthenticated-attempt count > 0 → alarm (should be zero in a healthy
  consortium).

## 7. Mesh retirement list (DOD-TEARDOWN-MESH-1 input)

Code/config that exists only for the Postgres mesh, deletable once anti-entropy is live:
`infra/setup-replication.sh` (already un-runnable — still lists the V48-dropped
`identity_tree_entries`); the SEQ_INCREMENT/NODE_SEQ_OFFSET staggering (Step 5c) and its
runbook entries; publications/subscriptions/slots and their monitoring; the
`REFRESH PUBLICATION` runbooks; `max_logical_replication_workers`-class parameter tuning in
`cello-rds.yaml`; the V34 "INCREMENT BY 3" stale comment; `CHECKPOINT_PEER_ADDRS` and
`Libp2pCheckpointTransport` (§5). Deletion discipline per procedure §5 (proven deadness,
built-artifact absence, test triage by subject).

## 8. What this design does NOT change

FROST, DKG, T=majority(validators), SEC-2 client authorization, session brokering, the relay
(no consortium state — DOD-INV-RELAY-EXTRACTABLE), the client protocol, seal semantics,
`pgaudit` (though sync chatter should be measured against it — flagged for the node IaC unit).

---

## Open items folded into later units

- Exact canonical-CBOR record encodings per table + the record-hash domain prefixes →
  DOD-AE-APPEND-1 (S/P phases).
- `ae_hint` batching/backpressure under burst writes → DOD-AE-APPEND-1.
- Cloud SQL connection path for the node (PSA vs connector) — the invariant bans *cross-cloud*
  tunnels; intra-GCP Cloud SQL private-IP plumbing is a node-IaC decision → DOD-NODE-DIR-GCP-1
  (journaled Entry 1).
- Whether `agent_profiles.account_id` backfill needs its own single-flip rule or rides LWW →
  DOD-AE-APPEND-1 pseudocode phase.
