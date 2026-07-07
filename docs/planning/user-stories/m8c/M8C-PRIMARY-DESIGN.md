---
name: M8C Tier 5 — Primary/Standby Device-Linking Design
type: design
date: 2026-07-07
milestone: M8C
topics: [multi-daemon, primary-standby, device-linking, frost, db-sync, threat-model]
status: draft
description: >
  DOD-PRIMARY-DESIGN-1's full design log — hard gate for all Tier 5 code. Covers the device-linking
  handshake (how daemon B proves it belongs to the same operator as daemon A), the threat model, and
  the DB-sync conflict model for two hash-chained SQLCipher databases. Grounded in a research pass
  over existing K_local/FROST storage, the directory's registration schema, the per-session hash-
  chain structure, and existing crypto primitives — not speculative.
---

# M8C Tier 5 — Primary/Standby Device-Linking Design

## Purpose and scope

This is the design log DOD-PRIMARY-DESIGN-1 requires before any Tier 5 code (DOD-PRIMARY-1,
DOD-POLICY-1, DOD-PORTAB-1). Per M8C-PROCEDURE §6, Tier 5 is design-significant and this is a hard
gate — no PRIMARY code until this is written and journaled.

Three things the DoD line demands, in order: (1) how daemon B proves to daemon A it belongs to the
same operator — the device-linking handshake's authentication story; (2) the threat model; (3) the
DB-sync conflict model for two independently hash-chained SQLCipher databases.

## Terrain — what already exists (grounds every decision below)

A dedicated research pass (not speculation) established the following, with file:line citations:

1. **K_local + FROST share storage** (`core/daemon/src/db-identity-store.ts:40-79`): one `agents`
   table row per agent (keyed by `agent_id`), holding the K_local Ed25519 seed (BLOB), an ML-DSA
   keypair, AND the FROST signing share (`frost_signing_share`, `frost_identifier`, `frost_epoch_id`,
   `frost_threshold`, `frost_participants`, `frost_directory_node_ids`) — all in ONE row. Zero
   existing multi-device/Standby/Primary-transfer scaffolding anywhere in the codebase.

2. **Directory's registration model** (trustless-cello `V9__agent_profiles.sql:13-24`):
   `agent_profiles` has `k_local_pubkey` UNIQUE and `primary_pubkey` UNIQUE — the schema assumes
   exactly one profile per identity, keyed by the Ed25519 pubkey itself, not by "which physical
   daemon." **This is the crux of the whole problem**: the directory literally cannot distinguish
   daemon A from daemon B if both hold a copy of the same K_local + FROST share — nothing in FROST
   itself prevents two devices holding the same share from each independently producing a valid
   partial signature under the same identifier. DOD-INV-ONE-PRIMARY is therefore a *coordination*
   problem, not a crypto one, UNLESS the design ensures the share is never actually duplicated (see
   Decision 3 below).

3. **Closest existing "exactly one owner" pattern**: `agent_presence` (`V33__agent_presence.sql`) —
   one mutable row per `k_local_pubkey`, an `owning_node_id` column, edge-triggered online/offline
   writes, gated by a per-node heartbeat-freshness check so a crashed owner's stale "online" state
   ages out safely. Directly reusable template: same shape, different key ("which daemon is
   Primary" instead of "which directory node owns the connection").

4. **SQLCipher DB structure / hash-chaining** (`core/daemon/src/session-node-manager.ts:483-626`):
   `session_tree_leaves`' primary key is `(agent_name, session_id, leaf_index)` — **the hash chain
   is per-session, not global.** No existing vector-clock/CRDT primitive anywhere. This means
   cross-session DB merging is naturally tractable (independent append-only logs) — the only
   genuinely dangerous case is two daemons appending to the SAME session concurrently, which forks
   the hash chain unrecoverably (not a mergeable conflict — an architectural invariant to prevent,
   not repair after the fact).

5. **Existing ECDH primitive** (`core/crypto/src/content-seal.ts`, exported from `index.ts`): a
   complete, tested, production Ed25519→X25519 (RFC 7748 §4.1 birational map) ECDH + HKDF-SHA256 +
   AES-256-GCM sealed-box (`sealToRecipient`/`openSealed`) — already reused tonight for
   DOD-LEAVEMSG-1's relay park. It is a **one-directional** sealed box: anyone can encrypt *to* a
   known public identity key; only the seed-holder decrypts. It is NOT a mutual challenge-response
   handshake, and device B has no identity yet at handshake time (it's *receiving* one) — so proving
   "belongs to the same operator" needs a separate out-of-band factor.

6. **Existing signed-capability pattern** (M8B-PREAUTH-CAP, `core/crypto/src` — pre-auth token
   sign/verify + base64url wire form, already shipped and covered by DOD-ONBOARD-WARN-1's own
   verified facts: "single-use, 24h, consumed-on-success... `preauth.token.reuse.rejected`"). This
   is a directly reusable template for a short-lived, signed, single-use, out-of-band capability —
   exactly what a pairing token needs to be.

7. **UPGRADE-001** (`core/daemon/src/seal-upgrade.ts:1-50`): when a session unilaterally seals and
   the absent party later returns, that daemon signs a ratification ack over the *existing* root
   (never a new seal), gated by `evaluateSealUpgrade`, which refuses unless the returning party
   genuinely possesses and integrity-verifies the content. DOD-PORTAB-1's "re-proven under
   multi-daemon" therefore means: whichever daemon is *currently* Primary at ratification time must
   have synced session/content state sufficient to pass that existing kernel check — DB sync is a
   prerequisite for UPGRADE-001 to keep working, not something UPGRADE-001 itself needs to change.

No existing FROST-ceremony single-completion lock was found beyond `agent_presence`'s shape — this
design proposes a new, analogous table (Decision 4).

## Decision 1 — Device-linking is operator-mediated pairing, not device-to-device trust

CELLO has no PKI and no central authority. Daemon B has no prior identity at pairing time, so it
cannot present a credential proving anything on its own. The authentication story is therefore:
**the operator's own physical presence and action is the root of trust** — the same trust model
CELLO's existing pre-auth registration flow already relies on (an operator manually moves a
short-lived signed token out-of-band).

**Handshake, step by step:**

1. **Initiation on the current Primary (daemon A):** a new CLI command, `cello device link`,
   generates a short-lived (2-minute TTL — matching the precedent DOD-PRIMARY-1 already sets for
   the primary-transfer offer), single-use pairing capability: `{agent_pubkey, expiry, nonce,
   ephemeral_x25519_pubkey}`, signed by A's K_local. Structurally identical to the existing
   pre-auth capability (Decision reuses M8B-PREAUTH-CAP's sign/verify + wire-encode helpers
   directly — no new crypto primitive).

2. **Out-of-band transfer:** the operator moves this token to daemon B's machine (QR code shown by
   A's CLI / portal, scanned or pasted on B) — this is the required out-of-band factor, and it is
   the SAME class of manual step operators already perform for `CELLO_PREAUTH_TOKEN`.

3. **Redemption on daemon B:** `cello device link --token <token>`. B generates its own ephemeral
   X25519 keypair and, using the EXISTING one-directional sealed-box primitive
   (`sealToRecipient`/`openSealed`, extended to an interactive round trip), encrypts a link-request
   to A's ephemeral pubkey. This round trip travels over the SAME directory-mediated
   signaling/session-negotiation channel M7 already proved for session establishment — no new
   transport is invented.

4. **A verifies and transfers K_local (only):** A checks the token's signature, expiry, and
   single-use status (mirrors the existing pre-auth capability's `consumed_at` pattern — verified
   in production via `preauth.token.reuse.rejected`). A then seals the K_local seed (NOT the FROST
   share) to B's ephemeral pubkey via `sealToRecipient` and sends it. B decrypts and now holds the
   same K_local as A — sufficient for Ed25519 identity operations (signing session assignments,
   etc.) but NOT sufficient to participate in a FROST ceremony.

5. **The FROST share is never copied — see Decision 3.**

## Decision 2 — DB-sync is one-directional snapshot transfer at a coordinated handoff, never continuous merge

Because the hash chain is per-session (Terrain #4), and because Decision 4 makes the CURRENTLY
Primary daemon the ONLY one ever allowed to hold a live session node / append new leaves, the
outgoing Primary's DB is authoritative and unambiguous at the moment of transfer — there is nothing
to merge, only to copy. "User-initiated DB sync" (DOD-PRIMARY-1's own words) is therefore: at
transfer time, the new Primary pulls a full, integrity-verified snapshot of the outgoing Primary's
SQLCipher DB (sessions, contacts, message_watermarks, telegram_settings, transcript, etc.) BEFORE
it is allowed to resume any active session or attempt a FROST ceremony. This sidesteps CRDT/vector-
clock complexity entirely — it is a discrete, verified copy at a well-defined moment, not a
continuously-reconciled distributed database. The Standby, before becoming Primary, is expected to
have been idle on session/content activity (same "polls cold" idle-until-transfer principle D6
already established for the Telegram poller) — so there is no divergent state on the Standby side
to reconcile against the incoming snapshot.

## Decision 3 — The FROST share is MOVED, never copied

This is the single most important decision in this design, because it is what makes
DOD-INV-ONE-PRIMARY's "no FROST double-sign" a structural guarantee rather than a hope resting on
coordination discipline. Per Terrain #2, nothing in the FROST math itself prevents two devices
holding the same share from each producing a valid partial signature. Therefore: **the FROST share
is never transmitted to Standby at pairing time, and primary-transfer is defined as a signed,
directory-witnessed operation in which the OLD Primary must submit a signed "share released"
attestation BEFORE the directory will recognize the NEW Primary as the current holder** (extending
the existing primary-transfer-offer 2-minute-TTL mechanism DOD-PRIMARY-1 already specifies). The
old Primary deletes its local share copy as part of completing that attestation. A device that has
never been Primary never possesses the share at all — it only receives it (encrypted, via the same
sealed-box mechanism as Decision 1 step 4) at the moment it actually becomes Primary through a
transfer.

## Decision 4 — Directory-enforced Primary arbitration, extending `agent_presence`'s pattern

A new table, `primary_holder`, mirrors `agent_presence`'s shape: one row per `k_local_pubkey`,
`holding_daemon_id` (a fresh per-device UUID minted at pairing time — NOT the shared K_local
pubkey, since multiple daemons now share that identity), and a heartbeat-freshness gate identical
to `agent_presence`'s existing staleness handling. Every daemon connection to the directory now
carries its own `daemon_id`. The directory refuses to route a FROST ceremony request for an agent
unless the requesting connection's `daemon_id` matches `primary_holder.holding_daemon_id` with a
fresh heartbeat. This is directory-ENFORCED (network-level), not merely client-side discipline —
combined with Decision 3 (the share physically isn't on the Standby machine), a compromised or
buggy Standby cannot complete a ceremony even if it tried, because it both lacks the share and is
refused at the network layer.

## Threat model

- **T1 — pairing token intercepted in transit** (e.g., a bystander photographs the QR code).
  Mitigated: 2-minute TTL, single-use enforcement (mirrors the proven `consumed_at`/
  `preauth.token.reuse.rejected` pattern), and the token itself carries no secret material — only
  an ephemeral pubkey and a capability to *request* linking. K_local transfer happens only after
  the interactive round trip, sealed to B's freshly-generated ephemeral key, so intercepting the
  token alone does not leak K_local.
- **T2 — an attacker's machine impersonates "daemon B."** Mitigated: the out-of-band step is
  physically performed by the operator (scanning/pasting on a device they hold) — the same
  presence-required trust model as the existing pre-auth registration flow. There is no path for a
  remote attacker to complete pairing without the operator's own action.
- **T3 — split-brain: both daemons believe they are Primary simultaneously.** Mitigated in depth:
  (a) the FROST share is moved, never copied (Decision 3) — a device that was never Primary simply
  cannot sign; (b) the directory's `primary_holder` record refuses ceremony participation from a
  non-matching `daemon_id` (Decision 4); (c) transfer is a signed, directory-witnessed operation
  requiring the old Primary's "share released" attestation before the new Primary is recognized, so
  there is no window where the directory considers both current.
- **T4 — DB replay/rollback.** An attacker with filesystem access to an old DB snapshot restores it
  to make a daemon falsely believe it is still (or again) Primary after a legitimate transfer.
  Mitigated: `primary_holder`'s freshness is directory-witnessed (a restored snapshot's stale
  heartbeat ages out immediately, per the existing `agent_presence` staleness pattern), and the
  FROST ceremony gate is checked at the DIRECTORY — which has its own authoritative state — never
  trusted from a daemon's local claim about its own Primary status.
- **T5 — a compromised Standby attempts to read/exfiltrate the K_local it legitimately holds.**
  Out of scope for this design specifically (K_local possession is inherent to being a linked
  device at all, by definition — the same exposure a single compromised daemon already has today).
  Mitigated only by the operator's own device security, same as single-daemon K_local exposure.

## Open items deliberately NOT resolved here (belong to DOD-PRIMARY-1/POLICY-1/PORTAB-1 implementation)

- Exact wire schema for the pairing capability and the interactive link-request round trip.
- Exact `primary_holder` migration (version number reserved at DOD-PRIMARY-1 implementation start,
  per the M5 retrospective rule: schema design complete before parallel implementation begins).
- Whether primary-transfer requires BOTH daemons online simultaneously, or supports an
  unreachable-Primary directory-initiated offer (DOD-PRIMARY-1's own text says both: "Standby
  requests baton; directory offers on unreachable-Primary" — the unreachable case necessarily can't
  get a live "share released" attestation from the old Primary, so it needs its own sub-design:
  likely a directory-witnessed timeout + the OLD primary's share being unrecoverable rather than
  actively released, which is a materially different trust story from the cooperative case and
  deserves its own short design note at DOD-PRIMARY-1's implementation time, not invented here).
- DOD-POLICY-1's exact policy schema (falls out of policies already being daemon-local per the DoD
  text — no new mechanism, just proving/testing the transfer boundary).

## Relation to DOD-INV-ONE-PRIMARY

This design makes DOD-INV-ONE-PRIMARY ("no double-accept, no FROST double-sign, no live session
migration") hold by construction: FROST double-sign is prevented by Decision 3 (share never
duplicated) reinforced by Decision 4 (directory-enforced ceremony gating); double-accept is
prevented by Decision 4's same gate applied to session negotiation; live session migration is
explicitly excluded by Decision 2 (sessions only ever live on the current Primary; a transfer syncs
state, it does not migrate a live session).

---

## Related Documents

- [[M8C-SPEC]] — §3's Tier 5 summary this design log elaborates; the pre-stated constraints (same
  K_local, one Primary, 2-min transfer TTL, user-initiated DB sync, no live session migration) this
  design must satisfy
- [[M8C-DEFINITION-OF-DONE]] — DOD-PRIMARY-DESIGN-1 (this gate), DOD-PRIMARY-1/POLICY-1/PORTAB-1
  (the Tier 5 units this design unblocks), DOD-INV-ONE-PRIMARY (the invariant this design must hold)
- [[M8C-BUILD-JOURNAL]] — Entry 32, the design's build-journal summary and status flip
- [[M8C-DECISIONS]] — D10 rubric (reuse proven patterns over inventing new mechanisms) applied
  throughout this design's four decisions
