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

**Distinctness checks (anti-reflection):** refuse a handshake where `nodeId_a == nodeId_b`, and
the manifest loader (§1b) refuses any manifest with a duplicate `pubkey`, `peerId`, or `nodeId`
across entries. Reflection of `sig_b` back as `sig_a` already fails because verification uses
each side's *distinct* manifest key — these checks guarantee the keys are in fact distinct. The
nonces (both directions, each side checks the one it minted for *this* stream) are the replay
gate; the ±60s `timestamp` is defense-in-depth, not the gate (so its looseness vs the 30s
client-nonce TTL is harmless — the AE nonce is stream-scoped, needing no store or TTL).

**Manifest-rotation skew.** During a rollout, peer A may hold manifest vN+1 (new `peerId`/
`pubkey` for B) while B still runs vN. To avoid a sync outage — which is also a kill-switch
propagation outage — a node MUST, on `manifest_pubkey_mismatch`/`peerid_mismatch`, re-read its
manifest and retry once, and accept a peer identity that matches **either** the current verified
manifest **or** the immediately-previous one while that previous manifest is still within its
`not_before`/`expires` validity. `antientropy.peer.auth_failed` is emitted only after both fail.

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

> ⚠️ **STATUS 2026-08-07 — this table is a DESIGN, not a description of what exists.** Two of these
> eight are built (`agent_suspensions`, `agent_presence`). The other six are not, and
> `ae-table-encoders.ts` describes five of them as "node-local by design" — which contradicts this
> section. Neither document records which decision superseded which. `capability_claim_codes` and
> `directory_nodes` were on that node-local list until they moved to Tier A, the former only after it
> broke Telegram registration in production, so the drift has already run in the
> under-replicating direction twice.
>
> The consequence of the unbuilt six, and the mutable columns that were told to "ride Tier B rules"
> and had nowhere to ride: the kill switch authorized from a link that never left its node, sign-in
> resolved only against the node that registered the operator, and revocation state stayed local.
> Fixed for the links by V59–V61 as append-only FACTS rather than Tier-B columns — a wrong merge rule
> is worse than no replication, and `agent_revocations` already proves the shape.
>
> Full account: `docs/planning/discussion_logs/2026-08-07_1912_replication-gap-what-m12-left-unfinished.md`

### Tier B — mutable, explicit merge rule per table

| Set | Key | Merge rule |
|---|---|---|
| `agent_suspensions` | `agent_id` | **The kill switch — §4. Its own rules, its own review.** |
| `agent_presence` | `k_local_pubkey` | LWW on `updated_at`; `owning_node_id` is part of the value (ownership legitimately migrates on connect). **Deliberately unlike §4:** presence is liveness-only, so wall-clock LWW is acceptable here — a skew-induced wrong presence self-heals on the next connect/disconnect edge, whereas a skew-induced un-pause would not, which is why the kill switch forbids wall-clock merges |
| `directory_nodes` | `node_id` | LWW on `last_heartbeat_at` — heals the single-row anomaly (root cause: BIGSERIAL collision + silently-dropped updates) |
| `sessions` | `session_id` | **Owner-wins:** the row's `owning_node_id` is authoritative; non-owners only insert-if-absent. Participant-column updates come only from the owner |
| `pre_authorization_tokens` | `id` | Monotonic single-flip: `consumed_at` set dominates unset; earliest set wins ties. (Cross-node double-spend window is unchanged from today — the nonce binder remains the real gate) |
| `capability_claim_codes` | `code` | Same single-flip rule on `redeemed_at` |
| `pickup_queue` | `id` (UUID) | Insert-if-absent **plus ack-tombstones**: an ACK deletes the row and records `(id, acked_at)` in a small `pickup_acks` tombstone table (id + timestamp only — NO ciphertext). Tombstone dominates: a synced row whose id has a tombstone is never inserted. **Bounded GC (avoids research finding 6):** tombstones are retained for a window `RETAIN` that strictly exceeds max plausible peer lag; and sync **never inserts** a pickup/notification row whose `created_at` is older than `RETAIN`. So a tombstone can be GC'd only after any row it could suppress is itself too old to be inserted — a lagging peer can never resurrect deleted ciphertext |
| `pending_notifications` | `notification_id` | Same insert + tombstone shape and bounded-GC rule as pickup_queue |

### Role → tier matrix (validators vs replicas)

A **validator** holds shares and signs; it syncs Tier A and Tier B (it must honor suspensions
and serve lookups). A **replica** holds no shares and never signs, but exists for redundancy and
reads, so it **syncs Tier A and Tier B too** — a replica serving a lookup or a presence read
needs the same converged state; it simply never has Tier C share material and never enters the
threshold arithmetic (DOD-INV-THRESHOLD). The only role-conditioned behavior in sync is that a
replica is skipped as a *source* for nothing and a *target* for nothing — role changes ceremony
participation, not sync participation. (The manifest `role` field itself is defined by
DOD-ROLE-MANIFEST-1; this matrix is the sync contract that unit's tests assert against.)

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
   over a **version hash** `SHA-256(key ‖ merge-columns)` instead of the record hash. A
   differing version hash identifies changed *bytes*, not a key, so the pull is
   **pull-by-key** (the version summary carries the key alongside its hash); the sender returns
   the full current record for each requested key, and the merge rule (§2/§4) — not arrival
   order — decides the result. Because every Tier-B merge is commutative (§4 for suspensions;
   LWW for the rest), both sides converge to identical bytes and the version hash then matches.

Because the merge rules are commutative, the §3 double-pull (each side pulls the other's copy of
a shared key) is safe: both compute the same merged row and the next round's version hashes
agree. A non-commutative merge would re-exchange forever — which is exactly why §4 is specified
as a total order.

**Cadence:** a full round per peer every 30s (jittered), plus **write-hints**: a node that
applies a local write to a Tier-B security table (`agent_suspensions` above all) immediately
sends a small `ae_hint {table, keys[]}` to every connected peer, which pulls those records
right away. Hints are best-effort; the periodic round is the guarantee.

**Scaling:** O(N) connections per node with N = consortium size; digests are O(1) per table
per round when converged. No apply workers, no slots, no WAL retention. At launch N=3 this is
trivial; the same mechanism holds to any N the threshold table supports. The 256 buckets are a
single fixed level, so a bucket's record-hash list grows O(table/256); record hashes are
user-grindable (content-addressed) so buckets are not adversarially uniform, but amplification
is bounded by insert rate and vanishes at convergence. If a table ever grows large enough that
per-bucket lists dominate a round, the split goes to a second prefix byte (65 536 buckets) —
named here so it is not rediscovered as a scaling surprise.

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

**Merge rule (on sync) — a TOTAL, deterministic, commutative order.** Two nodes that accept
independent writes for the same agent both mint `suspension_seq = max+1` (equal seq, differing
content is reachable), so the rule must resolve *every* field deterministically or the Tier-B
version summaries mismatch forever and the security table never converges:
1. `burned`: **OR — monotonic, irreversible.** A burn can never be un-burned by any merge.
2. Higher `suspension_seq` wins outright (carries all of `paused`/`reason`/`authorized_by_account`).
3. **Equal seq: `paused` resolves suspended-wins** (the DoD tie rule). The remaining non-flag
   fields (`reason`, `authorized_by_account`, `origin_node`) are taken from the record with the
   greater **record-hash** (deterministic, content-derived, identical on every node). The merged
   row keeps the tie `seq`. This makes the merge commutative: any order of arrival converges to
   the same bytes, so the version summary stabilizes.
4. Wall-clock `updated_at` is never a merge input — display only. Clock skew cannot un-pause.

An un-suspension is therefore only applied when it carries a strictly higher `suspension_seq`
than the pause it clears — "verifiably newer authenticated state": *newer* by the sequence,
*authenticated* by the channel handshake (records are only ever accepted from peers that
proved manifest-pinned identity in §1c).

**The trust model, stated plainly (no overclaim).** Records are **node-attested, not
end-user-authorized**: the portal pause is an API-key call to a node, and the node vouches for
it. Channel authentication (§1c) proves the *immediate* peer is a manifest-pinned consortium
node — it does **not** prove the record's content was authorized by the agent's owner, and
anti-entropy is transitive, so `origin_node` is **advisory bookkeeping a relaying peer can
fabricate**, never a security input. Consequence, said out loud: **one compromised in-roster
node can mint `burned=true` for any agent, and burn-OR propagates it irreversibly to every node
(each runs `destroyShares` on observe).** This is **no new power** — under today's Postgres
mesh a compromised node's writes to its own DB replicate identically — but it is the real trust
boundary, and closing it (end-to-end owner-signed suspension authorization, mirroring the M8B
FROST-stream-auth deferral) is hardening parked as **M12-P6**, not a property this channel
provides.

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
(typically fast on healthy links; ≤30s via the periodic round). **What actually bounds the
damage of a not-yet-propagated pause is the threshold, not sync latency:** a stale minority
(< T validators still unaware of the pause) cannot complete a ceremony alone, because the
honoring majority refuses its shares. The genuine window is a **partition** in which a pause is
accepted only on a side that *is* T-sized: that side can still seal until heal. (This window
exists under the Postgres mesh today, identically.) A restarted node serves FROST immediately —
participation is **not** gated on sync freshness today; optionally gating ceremony
participation on "first anti-entropy round completed since restart" is a hardening lever, noted
for DOD-AE-MUTABLE-1, not assumed here.

**Review requirement (DOD-AE-MUTABLE-1):** this section's implementation gets adversarial
review with the named scenarios: pause during partition; node restart mid-sync; **restart then
serve a ceremony before the first completed round**; stale-node rejoin; un-pause racing pause
(seq tie → suspended); **equal-seq writes with differing `reason`/`authorized_by_account`
(must converge to identical bytes via the record-hash tiebreak)**; burn racing un-pause (burn
wins); clock skew ±24h (no effect); forged-record attempt from an unauthenticated peer (refused
at §1c); **a compromised in-roster node minting a spurious burn (must be acknowledged as
mesh-wide and irreversible — the M12-P6 boundary, not something this layer defends).**

---

## 5. Checkpoints and the MMR — scope ruling

Finding 2 of the surface map: cross-node checkpoint signing **has never worked** — the MMR
tables don't replicate, every node's peaks differ, `verifyAndSign` refuses by construction, and
`CHECKPOINT_PEER_ADDRS` is empty in every environment. The `identity_merkle_root` slot has
never been computed. This design does not pretend otherwise:

- **In M12 scope:** checkpoint *records* and *signatures* sync as Tier A data (they already
  have natural keys). The `/cello/checkpoint/1.0.0` proposal channel — currently
  unauthenticated in both directions and trusting responder-supplied pubkeys — is **retired**;
  `CheckpointCoordinator`'s proposal loop is **disabled** (not merely left transport-less — it
  is inert today because `CHECKPOINT_PEER_ADDRS` is empty, but the mesh-retirement unit removes
  the wiring rather than leaving a dead loop running). When cross-signing is rebuilt it rides
  the §1 authenticated channel.
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

**The security-relevant footprint — this is the milestone's biggest security win and must be
on the list, because "nothing external connects to a node's Postgres" is only true once it is
gone:**
- The per-region `cello_replication` roles (with `REPLICATION` privilege) and **their passwords
  in Secrets Manager** (`setup-replication.sh` ~lines 17, 233-269).
- `rds.logical_replication: "1"` and `max_replication_slots`/`max_wal_senders` in
  `cello-rds.yaml`.
- **The cross-node 5432 network path** — SG rules / peering / reachability that let one region's
  subscriber reach another region's Postgres. Anti-entropy needs none of it; while it exists,
  a node's database is reachable off-box.

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
