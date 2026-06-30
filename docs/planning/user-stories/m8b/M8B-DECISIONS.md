# M8B Federation Build — Decisions Log

Every fork hit during the autonomous run is recorded here: timestamp, the fork, the choice, why, and how
to reverse. The rule is **pick the reversible option and keep going** — never block (M8B-PROCEDURE §3a).
Genuine undecidable forks are PARKED (journal + DoD "Parked decisions" + here), never block the run.

## Pre-resolved with Andre (2026-06-29 ~20:00, before he slept)
- **Authorization:** full — dev AWS deploys + npm publish allowed (alpha, solo, no users; recoverable). Not a live grenade.
- **T-of-N coordination:** client-as-coordinator relay (client fans out to N directory nodes, relays DKG round-2; NO directory↔directory).
- **Directory↔relay:** Option B (client carries relay-signed receipts; directory never dials a relay).
- **Cross-node state:** replicate presence + directory_nodes + pickup (pickup→UUID) into cello_pub; sweep gated to owning node.
- **Scope:** widest — T-of-N wiring + share-refresh + relay-signed ordering + Option B + cross-node replication.
- **Proof bar:** local 3-directory spine first → then deploy to dev and prove on the live 3-region cluster.

---

## Decisions made during the run

### 2026-06-29 ~20:10 — RUN — execution model (CORRECTED after re-reading M7-PROCEDURE)
- Fork: my initial plan (sequential branch-per-unit + dispatched coder agents + cron) vs the proven M7 model.
- Chose: **ONE coder thread (the main loop), ONE assembly branch per repo (`m8b-assembly`), read-only
  reviewers only, cron drift-check.** No parallel implementation agents, no per-unit branch sprawl.
- Why: M7-PROCEDURE §5 is explicit — "parallel branches are what produced the sprawl that buried this
  milestone." A dispatched-coder-per-unit plan reintroduces exactly that. The main loop codes; subagents
  are read-only (reviewer / test-attacker / fallback-finder / done-auditor / explorer).
- Reverse: trivial — it's a working-style choice, not a code artifact.

### 2026-06-29 ~20:10 — RUN — deploys authorized but sequenced as the close gate
- Andre authorized dev deploys + npm publish (alpha). Chose to USE them only at the CLOSE GATE: local
  3-directory spine green → publish beta → deploy dev → prove live. Not a discovery loop (M7 lesson:
  "no deploys as a discovery tool"). Reverse: n/a (sequencing only).

### 2026-06-29 ~20:15 — RUN — docs relocated federation-milestone/ → user-stories/m8b/
- Andre: keep DECISIONS (new, liked) + SPEC; fold WORKLOG's status board INTO the build journal (best of
  both). Restructured to the M7 5-doc shape under `docs/planning/user-stories/m8b/`. The old
  `docs/planning/federation-milestone/` folder is removed. Reverse: git history.

### 2026-06-29 ~20:45 — RUN — work directly on main (SUPERSEDES the assembly-branch decision)
- Fork: keep the `m8b-assembly` branch (no-merge-to-main) vs work directly on `main`.
- Chose: **work directly on `main` in both repos.** Merged `m8b-assembly` → main (ff) and deleted it.
- Why: Andre — solo, no other coders, and we're deploying from main anyway, so branch isolation +
  no-merge is pure overhead. Supersedes the earlier "one assembly branch / never merge to main" choice.
- Caveat carried into PROCEDURE §5: a push touching `packages/directory/**` or `packages/relay/**`
  triggers the ~25-30 min CI/CD deploy, so commit often locally but BATCH directory/relay pushes (don't
  push per-commit); cello-client + e2e/spine pushes are free.
- Reverse: branch off main again if ever needed.

### 2026-06-30 ~21:05 — FED-SPINE-001 — stopped a stale worktree postgres holding :5433
- Fork: the spine harness needs local Postgres on `localhost:5433`, but the orphan container
  `trustless-cello-m8-read001-postgres-1` (a long-closed M8-READ-001 worktree, Up 41h) still held
  `0.0.0.0:5433`, so `docker compose up postgres` in the canonical repo failed to bind.
- Chose: `docker stop trustless-cello-m8-read001-postgres-1` to free the port; the canonical
  `trustless-cello` project's postgres then binds 5433 (where the harness expects it).
- Why: M8-READ-001 is closed; the container is a stale leftover. Reversible + correct; never-block.
- Reverse: `docker start trustless-cello-m8-read001-postgres-1` (but it should stay stopped — stale).
  Note: dozens of OTHER `*-postgres-1` containers exist in `Created` (not running) state from old
  worktrees — harmless (they hold no port); a future cleanup could `docker rm` them, not this unit's job.

### 2026-06-30 ~21:55 — FED-MANIFEST-001 — manifest `endpoint` is the node's HTTP bootstrap base
- Fork: a manifest `ConsortiumNode.endpoint` is documented as `wss://host:port`, but the live directory
  resolution path is HTTP `{base}/bootstrap` → multiaddr. To resolve N nodes I need an HTTP bootstrap base
  per node. Reuse `endpoint` vs add a new `bootstrapUrl` field?
- Chose: **reuse `endpoint` as the node's HTTP base for `/bootstrap`** — if it starts `http`, use as-is;
  if `wss://host[:port]`, map → `http://host[:port]`. Spine 3-node manifest sets `endpoint =
  http://127.0.0.1:{healthPort}` (the real bootstrap URL = directoryUrls[i]).
- Why: API-parsimony — `endpoint` already names the node's reachable address; the single-endpoint path
  already treats CELLO_DIRECTORY_URL / PRODUCTION_DIRECTORY_URL as `http://…` bases. Adding a field for
  the same intent is the continuation-bias trap.
- Reverse: if production directories are WSS-only with no HTTP `/bootstrap`, add a dedicated
  `bootstrapUrl` field to the manifest node + the mapping fn. Schema + one function — cheap.

### 2026-06-30 ~21:50 — FED-SPINE-001 — pre-existing j-auth poll failures parked (not a regression)
- Fork: j-auth fails 2/6 (DOD-AUTH-2 poll-refresh + poll-rejects-forged); is it my SPINE-1 harness change?
- Chose: **PARK as pre-existing, continue.** Proven via the M7-baseline harness (`059134d2`) failing the
  same 2 identically. Full record in DoD "Parked decisions". Out of SPINE-1/MANIFEST-1 resolution scope.
- Why: not a federation regression; rabbit-holing a pre-existing M7 manifest-poll bug would stall the
  milestone. Revisit during/after MANIFEST-1 (same manifest area).
- Reverse: n/a (investigation deferral, not a code choice).

### 2026-07-01 ~00:05 — FED-DKG-001 — CORRECTION: DKG needs ALL N present (refusal gate = resolved<N)
- Refines Fork C below. **Crypto correctness:** FROST **DKG** (key generation) requires ALL N declared
  directory nodes present — a node absent DURING DKG receives no share, so the resulting key is held by
  only the present subset (a smaller, different consortium). The "kill any one node and the ceremony still
  completes" tolerance (DOD-INV-NODE / DOD-SIGN-1) is a **SIGNING** property (only T need be online to
  sign), NOT a DKG property. So:
  - DKG-1 refusal gate = **resolved roster < N (declared) → refuse** (`dkg_below_threshold` /
    `consortium_incomplete`) — you cannot DKG a partial consortium. (Not "< T" as Fork C first said.)
  - The threshold T (Fork B) is baked into the DKG via FROST `signers = {min: T, max: N+1}` so the
    GENERATED key is T-of-(N+1) for later signing; DKG itself still runs with all N+1 participants.
  - DOD-DKG-1 spine test: all 3 directories UP → DKG produces the 2-of-3 key. The "kill a node, still
    works" assertion belongs to DOD-SIGN-1 (signing), not here. The only-1-resolves case → refuse.
- Reverse: n/a (correctness).

### 2026-06-30 ~23:25 — FED-DKG-001 — T-of-N topology + threshold formula + refusal gate
- **Fork A (topology source):** who decides N (and T) for the DKG — the client, a single directory, or
  the signed manifest? **Chose:** the threshold-signed consortium manifest — both client and directory
  derive N = manifest node count from their OWN verified manifest and cross-check; mismatch aborts.
  **Why:** neither party can unilaterally shrink/inflate the quorum (a malicious client can't weaken it,
  a malicious node can't pad it); the officer-signed manifest is the tamper-proof source. **Reverse:**
  change the derivation source in the shared topology helper.
- **Fork B (threshold formula — the genuine fork):** what FROST threshold T? **Chose:** participants =
  N_dirs+1 (client always present); N_dirs=1 → T=2 (current 2-of-2, unchanged); **N_dirs≥2 → T=N_dirs**
  (= max−1: client + any N_dirs−1 directory nodes, tolerates exactly ONE directory outage, no single
  directory mandatory). N_dirs=3 → T=3 of 4 (the DoD's "2-of-3"). **Why:** DOD-INV-NODE requires "kill
  any one of N and the ceremony still completes"; T=max−1 is the tightest threshold meeting that
  (maximizes forge-resistance while tolerating 1 outage). A lower T tolerates more outages but lets fewer
  nodes forge (weaker security). **This is the security/availability knob — change this line if Andre
  wants higher outage tolerance for large N.** T is derived in a shared helper, NOT a manifest field yet.
  **Reverse:** edit the threshold helper; add a signed `signingThreshold` manifest field if a deploy needs
  a configurable T.
- **Fork C (degraded roster):** run the ceremony on whatever resolved, or refuse below quorum? **Chose:**
  REFUSE with a distinct `dkg_below_threshold` error when fewer than T of N directory endpoints resolve.
  **Why:** closes the silent fallback cello-fallback-finder flagged (MANIFEST-1 #1) as HIGH-if-DKG-1-skips
  — a degraded consortium must not silently run a ceremony on too few nodes. **Reverse:** n/a (a
  correctness/security gate, not a preference).

### 2026-07-01 ~05:00 — FED-SUSPEND-001 — quorum-aware suspension DEPENDS on replicated profile+flag
- **Finding.** `pg-directory-store.isAgentSuspended(kLocalPubkeyHex)` JOINs `agent_suspensions` →
  `agent_profiles ON agent_id WHERE p.k_local_pubkey=$1`. A node honors a suspension only if it has BOTH
  the agent's `agent_profiles` row (pubkey→agent_id) AND the `agent_suspensions` row. Registration writes
  `agent_profiles` ONLY on the node that ran the reply (node 0; DKG-1 proved db1=db2=0). So nodes 1,2
  CANNOT honor a suspension today — `isAgentSuspended` returns false (no profile row) → they sign anyway →
  the suspension is effectively SINGLE-NODE (node 0's view), NOT the intended quorum-aware T-of-N refusal.
- **Fork.** (a) Block SUSPEND-1 on the replication (Tier C), or (b) prove the honor-ARITHMETIC now by
  SEEDING `agent_profiles` + `agent_suspensions` on the consortium nodes (mimicking `cello_pub`
  replication) and defer the real replication.
- **Chose (b):** seed the per-node state in the spine to prove "≥2 directories honoring ⇒ no signature; 1 ⇒
  still signs" (the DOD-SUSPEND-1 requirement is the ARITHMETIC, which is the honor-check + threshold). The
  mechanism (`#isAgentPaused` per-node share refusal, fails closed) is built and correct.
- **Why:** SUSPEND-1 precedes PRESENCE/PICKUP (replication) in the DoD order; the honor-arithmetic is
  independently provable by seeding. Don't block.
- **REQUIRED follow-on (tracked, not dropped):** production quorum-aware suspension needs `agent_suspensions`
  AND `agent_profiles` in `cello_pub` logical replication so every sovereign node can honor the flag — fold
  this into DOD-PRESENCE-1/PICKUP (Tier C replication) which already adds tables to `cello_pub`. Without it,
  suspension is single-node in production. Logged in DoD "Parked decisions".
- **Reverse:** n/a (a real architectural dependency + a test-seeding choice).

<!-- Append below. Format:
### YYYY-MM-DD HH:MM — <unit-id> — <short title>
- Fork: …  Chose: …  Why: …  Reverse: …
-->

## 2026-07-01 — DOD-RELAYSIG-1: relay pubkey source = directory relay_pubkey_request (not the assignment)
The daemon must verify the relay's ACK signature against a TRUSTED relay pubkey (never the pubkey from the
ACK itself — circular). Two sources considered: (a) embed relay_pubkey in the directory-signed session
assignment, (b) the existing `relay_pubkey_request`/`relay_pubkey_response` directory frame (directory-node.ts:951).
**Chose (b)** — the directory side ALREADY exists (zero directory change ⇒ no deploy batching for RELAYSIG-1;
keeps the unit a focused daemon-only port), and the manifest does NOT list relays. The daemon queries the
directory (relay_id → public_key_hex) over its signaling stream, caches per relay_id. Reversible: embedding
the pubkey in the assignment can be added in OPTIONB-SETUP-1 if a round-trip-free path is wanted. RELAYSIG-1
is therefore a pure daemon port of the dead core/client receipt store + verifyRelayAck into the live daemon.

## 2026-07-01 (revised) — DOD-RELAYSIG-1: verify ACK SELF-CONSISTENCY (relayId-derived pubkey), defer relay-registration check to OPTIONB-SEAL
SUPERSEDES the earlier "relay_pubkey_request round-trip" decision. Found: the relay uses SEPARATE
ack-signing + transport keys (relay.ts:196/200), `relayId = hex(ack-signing pubkey)` (relay.ts:197), and
the daemon connects to the DIRECTORY-ATTESTED assigned relay over a transport-authenticated libp2p stream.
So RELAYSIG-1's "client verifies" = verify the ACK is SELF-CONSISTENT: `relayPubkey = unhex(relay_id)`
(reject non-64-hex), `verifyRelayAck(content_hash, seq, ts, sig, relayPubkey)` — a forged SEQUENCE changes
the TBS so its signature fails (the DoD's "forged sequence is rejected"). The receipt stores relay_id +
signature so the FULL trust binding (is relay_id the directory-REGISTERED relay for this session?) is done
by the DIRECTORY at seal time — DOD-OPTIONB-SEAL-1 ("directory rebuilds + verifies the tree offline"),
which is exactly where the receipts are carried. This is the any-relay separation (client stores
self-consistent relay receipts; directory does the authoritative verification at seal), NOT a minimization:
the relay-registration check is not dropped, it lives where the receipts are consumed. No directory
round-trip in RELAYSIG-1 ⇒ a focused daemon wiring (inject RelayReceiptStore into session-relay-client,
verify+store in #dispatch, + a cello_get_relay_receipts query path for the spine).

## 2026-07-01 — Sequencing: front-load the Opus-hard units (Andre directive)
Andre may hit an Opus quota and downgrade the coder thread to Sonnet. Do the HARDEST / most
design-and-crypto-critical units FIRST while on Opus: (1) OPTIONB-SETUP-1 (any-relay/any-directory —
delete the directory→relay dial + relays[0] pin; client carries the FROST/directory-signed assignment;
relay verifies vs the consortium; the recurring relay_unavailable root cause — high blast radius), then
(2) OPTIONB-SEAL-1 (directory rebuilds + verifies the Merkle tree OFFLINE from client-carried relay
receipts + FROST-seals with NO directory→relay call — crypto-adjacent, the hardest remaining). PRESENCE-1
+ PICKUP-1 (cross-node replication: cello_pub schema, REPLICA IDENTITY, UUID PK, sweep gating) are more
mechanical and can survive a Sonnet downgrade. DEPLOY-1 is operational. The `feature-dev:code-reviewer`
reviewers are pinned `model:'opus'`, so adversarial review stays Opus-grade even if the coder downgrades.
This matches the DoD order (SETUP→SEAL→PRESENCE→PICKUP→DEPLOY), so no reordering needed — just keep pace.

## 2026-07-01 — DOD-OPTIONB-SETUP-1 design refinements (post-investigation)
Two refinements to Design A after reading the relay auth model + the network-relay-adapter:
1. **New client-presented frame (NOT the existing record_assignment).** The relay's `record_assignment`
   frame is gated by DIRECTORY-ADMIN auth — a body-level `directory_signature` verified vs `#directoryPubkey`
   (relay-node.ts:345-364) that only the directory can produce. A client cannot sign that. So add a NEW
   `client_record_assignment` frame: after the client's K_local relay auth, it carries {session_id,
   participant_a/b, session_timestamp, initiator/counterparty_session_peer_id, assignment_signature =
   the directory's per-node relayDirSig over the 6-field relay TBS}. The relay verifies assignment_signature
   over the reconstructed 6-field TBS (binds the peer ids) vs the consortium directory keys — NO admin-auth
   body signature (the client isn't the directory). The directory provides relayDirSig to the client in the
   session_assignment frame as `relay_directory_signature` (explicit new field; never reuse
   `directory_signature` = frostedSig). The directory's relayDirSig at directory-node.ts:3125 is ALREADY
   over the 6-field TBS — reuse it; the network-relay-adapter that re-signs a 4-field TBS is being DELETED.
2. **Relay verifies vs a CONFIGURED set of directory pubkeys, not by parsing the manifest.** Adding full
   threshold-manifest verification (officer root keys + sig) to the relay is a large lift. Minimal
   any-directory: `CELLO_DIRECTORY_PUBKEYS` (comma-separated hex, the N consortium directory node pubkeys),
   falling back to the single `CELLO_DIRECTORY_PUBKEY`. The relay verifies the assignment vs ANY of them.
   The deployment configures these (same trust source as today's single CELLO_DIRECTORY_PUBKEY). Reversible:
   full in-relay manifest verification is a parked hardening if wanted. Spine: give the relay all 3 node
   pubkeys so a non-node-0 directory's assignment verifies (the any-directory teeth).
