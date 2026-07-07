---
name: M8C Tier 5 — Primary/Standby Device-Linking Design
type: design
date: 2026-07-07
milestone: M8C
topics: [multi-daemon, primary-standby, device-linking, frost, db-sync, threat-model]
status: reviewed
description: >
  DOD-PRIMARY-DESIGN-1's full design log — hard gate for all Tier 5 code. Covers the device-linking
  handshake (how daemon B proves it belongs to the same operator as daemon A), the threat model, and
  the DB-sync conflict model for two hash-chained SQLCipher databases. Grounded in a research pass
  over existing K_local/FROST storage, the directory's registration schema, the per-session hash-
  chain structure, and existing crypto primitives — not speculative. Revised after an independent
  adversarial security review found 3 blocking gaps (pairing had no sender authentication /
  phishing resistance; the directory-arbitration mechanism was modeled on the wrong existing
  pattern for a federated multi-node directory; DB-sync ordering/atomicity was asserted, not
  defined) — all four fixes incorporated below, inline, dated.
---

# M8C Tier 5 — Primary/Standby Device-Linking Design

## Revision note (2026-07-07)

The first draft of this design was adversarially reviewed (a security-focused independent pass,
specifically tasked with trying to break it before any Tier 5 code gets built) before being
accepted as the Tier 5 gate. The review found three genuine, blocking gaps and one documentation-
precision issue — all fixed inline below (search "adversarial review" for each correction):

1. **Decision 1 (pairing handshake)** had no sender authentication on the link-request round trip —
   whoever redeemed an intercepted token first would receive K_local, and the design had no defense
   against device-code-phishing (the operator's physical action is genuine, but their intent is
   manipulated). **Fixed:** added a mandatory mutual fingerprint confirmation step.
2. **Decision 4 (directory arbitration)** was modeled on `agent_presence`, a node-local pattern —
   but the "exactly one Primary" fact must be agreed CONSISTENTLY across all of CELLO's sovereign
   directory nodes, and best-effort replication would reopen the exact split-brain window this
   decision claims to close. **Fixed:** reuse CELLO's existing quorum-registration mechanism
   (T = majority(N), already proven in M8B) instead of inventing per-node replication.
3. **Decision 2 (DB-sync)** asserted the snapshot is "authoritative and unambiguous" without
   defining the ordering between quiescing the old Primary, taking the snapshot, and committing the
   transfer, or naming an atomic backup mechanism for a live SQLCipher/WAL database. **Fixed:** an
   explicit 6-step transfer sequence with a named atomic-backup primitive (`VACUUM INTO`) and reuse
   of the existing relay-park mechanism for messages arriving mid-transfer.
4. **Decision 3 (share moved, never copied)** overstated local deletion as the safety mechanism.
   **Fixed:** reworded — deletion is hygiene; Decision 4's quorum-agreed gate is what's actually
   load-bearing, independent of whether the old Primary's local delete succeeds.

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

4. **Mutual confirmation — REQUIRED before any secret transfers (added after adversarial review,
   2026-07-07).** A sealed box provides no sender authentication (Terrain #5 says this explicitly:
   "anyone can encrypt *to* a known public identity key"). Without a further check, whoever
   intercepts the token and completes the round trip *first* — not necessarily the operator's real
   second device — receives K_local. This is a genuine race, not merely a "possession proves
   identity" tradeoff, and it is also the anchor for a device-code-phishing variant (T2b below): an
   attacker could trick the operator into pasting the token into an attacker-controlled "B." Close
   both with one mechanism, modeled on Signal-style safety numbers: A derives a short (e.g. 6-digit)
   fingerprint from the received link-request's ephemeral pubkey and displays it; B's CLI displays
   the same fingerprint (computed from the same value, which B itself generated); **A's `cello
   device link` command blocks on an explicit operator confirmation that the two match** before
   proceeding to step 5. This converts "first valid-token redeemer wins" into "the operator visually
   attests this specific redemption is the one they intended" — closing the interception race AND
   giving the operator a concrete tell if they're being socially engineered (a phishing flow cannot
   produce a fingerprint matching what their real second device shows).

5. **A verifies and transfers K_local (only), after confirmation:** A checks the token's signature,
   expiry, and single-use status (mirrors the existing pre-auth capability's `consumed_at` pattern —
   verified in production via `preauth.token.reuse.rejected`), AND the operator's fingerprint
   confirmation from step 4. Only then does A seal the K_local seed (NOT the FROST share) to B's
   ephemeral pubkey via `sealToRecipient` and send it. B decrypts and now holds the same K_local as
   A — sufficient for Ed25519 identity operations (signing session assignments, etc.) but NOT
   sufficient to participate in a FROST ceremony.

6. **The FROST share is never copied — see Decision 3.**

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

**Explicit transfer sequence and atomicity (added after adversarial review, 2026-07-07).**
"Authoritative and unambiguous" was previously asserted without pinning down ordering relative to
Decision 4's daemon_id gate, or how the DB copy is made atomic against a live, possibly WAL-mode
SQLCipher process. Both are correctness preconditions for this decision's own claim, not
implementation detail to leave open. The sequence:

1. Directory flips `primary_holder` to a `transferring` state for this agent — from this instant,
   the directory refuses to route *new* session/message activity to the old Primary's `daemon_id`
   (extends Decision 4's gate with an intermediate state, not just holder/no-holder).
2. Old Primary finishes any in-flight session writes and checkpoints its WAL
   (`PRAGMA wal_checkpoint(TRUNCATE)`), so the on-disk file reflects a consistent, complete state.
3. New Primary reads the snapshot via an atomic backup primitive — `VACUUM INTO` (or SQLite's
   online backup API) against the checkpointed file, never a raw filesystem copy of a
   possibly-open database.
4. Old Primary submits the signed "share released" attestation (Decision 3).
5. Directory commits the new `holding_daemon_id` (via the quorum mechanism in Decision 4's revision
   below) — only now does the transfer complete from the directory's perspective.
6. New Primary resumes: it may now hold a live session node and attempt a FROST ceremony.

Any relay-delivered message for this agent arriving between steps 1 and 6 is parked via the
EXISTING relay store-and-forward mechanism (Terrain #5 / DOD-LEAVEMSG-1, built earlier this
milestone) rather than being routed to whichever daemon happens to be reachable — the new Primary
recovers it via the existing RELAYWAKE pull once it resumes at step 6. This reuses proven
machinery instead of inventing a transfer-window-specific buffer.

## Decision 3 — The FROST share is MOVED, never copied

Per Terrain #2, nothing in the FROST math itself prevents two devices holding the same share from
each producing a valid partial signature. Therefore: **the FROST share is never transmitted to
Standby at pairing time** — a device that has never been Primary never possesses the share at all;
it only receives it (encrypted, via the same sealed-box mechanism as Decision 1) at the moment it
actually becomes Primary through a transfer. Primary-transfer requires the OLD Primary to submit a
signed "share released" attestation as part of the transfer sequence (Decision 2, step 4).

**Correction after adversarial review (2026-07-07): local deletion is hygiene, NOT the safety
mechanism — Decision 4 is what's load-bearing.** The original text claimed this decision, via the
old Primary "deleting its local share copy," was what made double-sign prevention structural. That
overstates it: a signature over "share released" attests to a *claim*, not a verified *action* —
nothing here confirms deletion actually happened, and a crash between signing the attestation and
completing the delete could leave the share sitting in the old daemon's DB indefinitely. The
correctness guarantee against double-signing does NOT rest on this deletion succeeding — it rests
entirely on Decision 4's directory-side gate refusing ceremony participation from any daemon_id
other than the current holder, independent of what a non-current daemon still has sitting in its
own local DB. A retained share on a de-authorized old Primary is a *latent exposure* concern (an
old device that's since been compromised or repurposed retains sensitive material longer than
necessary) — worth closing, but a hygiene matter, not an invariant-correctness one. Recommended
hygiene (not a correctness requirement): after the local delete, run `PRAGMA secure_delete = ON`
(or an explicit overwrite) before the delete and follow with `VACUUM` to reduce the chance the
share persists in reclaimable SQLCipher pages.

## Decision 4 — Directory-enforced Primary arbitration, QUORUM-agreed (not per-node replicated)

A new table, `primary_holder`, is keyed by `k_local_pubkey` with a `holding_daemon_id` column (a
fresh per-device UUID minted at pairing time — NOT the shared K_local pubkey, since multiple
daemons now share that identity) and a heartbeat-freshness gate. Every daemon connection to the
directory now carries its own `daemon_id`. The directory refuses to route a FROST ceremony request
for an agent unless the requesting connection's `daemon_id` matches `primary_holder.holding_daemon_id`
with a fresh heartbeat.

**Correction after adversarial review (2026-07-07): this must be QUORUM-agreed, not modeled on
`agent_presence`'s per-node replication.** The original text modeled `primary_holder` directly on
`agent_presence` (Terrain #3), but that pattern is node-local by nature — an agent connects to one
specific directory node, so no cross-node agreement is ever required for `agent_presence` to be
correct. `primary_holder.holding_daemon_id` is the opposite: it is a single fact that must be true
CONSISTENTLY across ALL of CELLO's sovereign directory nodes, because a ceremony request can land
on any of them. If updates propagated by unspecified best-effort replication, a node that hasn't
yet heard about a transfer could validly serve the OLD Primary's ceremony request after the
transfer is supposed to be complete — reopening exactly the split-brain this decision claims to
close, especially combined with Decision 3's now-corrected point that the old Primary's share may
still be physically present locally.

**The fix reuses CELLO's own existing quorum-agreement mechanism, not a new one.** M8B's
quorum-registration work already established the pattern this needs: `T = majority(N)`, the client
drives an operation that must be recorded durably across a QUORUM Q (Q ≥ T) of directory nodes
before it is considered official (see the M8B quorum-registration plan — "register among the
available quorum Q... record the quorum as the share-holder set"). Primary-transfer reuses this
directly: the transfer's `holding_daemon_id` update is submitted to the SAME recorded quorum Q for
that agent (not an arbitrary/best-effort subset of nodes), and is only complete once ≥T of Q have
durably committed it. Each directory node's OWN ceremony-participation gate reads only its own
durably-committed local value — never a value still in flight — so a node that hasn't yet
committed the transfer simply has no record of a NEW holder yet, and (combined with the transfer
sequence in Decision 2, which already refuses new routing to the old Primary from step 1) cannot
be tricked into serving the old Primary either. This is directory-ENFORCED at quorum strength (the
same strength CELLO already trusts for registration and sealing), not a single node's opinion and
not best-effort replication — combined with Decision 3 (a device that was never Primary never
receives the share in the first place), a compromised or buggy Standby cannot complete a ceremony:
it lacks the share, and even a retained-but-stale old Primary is refused once quorum has committed
the transfer.

## Threat model

- **T1 — pairing token intercepted in transit** (e.g., a bystander photographs the QR code).
  **Corrected after adversarial review (2026-07-07):** the original claim — "intercepting the token
  alone does not leak K_local" — was true but incomplete: since the link-request round trip
  (Decision 1) uses a one-directional sealed box with NO sender authentication, whoever completes
  the round trip *first* with a valid intercepted token receives K_local, not necessarily the
  operator's real second device. This is a genuine race, not a benign interception. Mitigated (now)
  by Decision 1's mutual fingerprint confirmation: A will not transfer K_local until the operator
  confirms the fingerprint shown on A matches what B displays, so an attacker racing the redemption
  is caught at the confirmation step even if they won the race to redeem the token first.
- **T2 — an attacker's machine impersonates "daemon B" without the operator's knowledge.**
  Mitigated: the out-of-band step is physically performed by the operator (scanning/pasting on a
  device they hold) — the same presence-required trust model as the existing pre-auth registration
  flow. There is no path for a remote attacker to complete pairing without the operator taking some
  action.
- **T2b — the operator's action is genuine but their INTENT is manipulated (device-code phishing).**
  Added after adversarial review (2026-07-07) — the original threat model assumed operator
  physical presence implies correct intent, which a phishing flow (e.g., "support" asks the
  operator to read out the token "to help troubleshoot," or a fake portal says "paste your linking
  token here to verify your account") can subvert while the physical action still genuinely occurs.
  Same root cause as T1 (no mutual confirmation), same fix: the fingerprint the operator must
  confirm on A can only be produced by the device the operator is ACTUALLY looking at as "B" — a
  phishing site relaying the token server-side cannot make its own fingerprint appear on the
  operator's real second device, giving the operator a concrete, visible mismatch to notice.
- **T3 — split-brain: both daemons believe they are Primary simultaneously.** Mitigated in depth:
  (a) the FROST share is moved, never copied (Decision 3) — a device that was never Primary simply
  cannot sign, and Decision 3 no longer overstates local deletion as the safety net; (b) the
  directory's `primary_holder` record, agreed at QUORUM strength (Decision 4, corrected), refuses
  ceremony participation from a non-matching `daemon_id` — this is what actually closes the
  invariant, not client-side coordination; (c) the explicit transfer sequence (Decision 2) refuses
  new routing to the old Primary from the moment transfer begins, before any snapshot or share
  release occurs.
- **T4 — DB replay/rollback.** An attacker with filesystem access to an old DB snapshot restores it
  to make a daemon falsely believe it is still (or again) Primary after a legitimate transfer.
  Mitigated: `primary_holder`'s freshness is directory-witnessed at quorum strength (a restored
  snapshot's stale heartbeat ages out immediately), and the FROST ceremony gate is checked at the
  DIRECTORY's quorum-committed state — never trusted from a daemon's local claim about its own
  Primary status.
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
migration") hold by construction: FROST double-sign is prevented primarily by Decision 4's
quorum-agreed directory gate (a device without the share cannot sign regardless, per Decision 3,
but the gate is what closes the split-brain window during a transfer — see the T3 correction
above); double-accept is prevented by Decision 4's same gate applied to session negotiation; live
session migration is explicitly excluded by Decision 2's explicit transfer sequence (sessions only
ever live on the current Primary; a transfer syncs state through a defined quiesce→snapshot→commit
ordering, it does not migrate a live session).

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
