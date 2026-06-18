---
name: M7 Definition of Done
type: definition-of-done
date: 2026-06-18
milestone: M7
status: open
description: >
  The single consolidated "what M7 done actually means" checklist. Assembled by
  reading every M7 scope document: outline.md, the E2E-001 gate, the four
  postmortem stories (MSG-001, SESSION-002/003/004), the POSTMORTEM (Parts 3-4),
  the daemon-transport / bidirectional-auth / transport-security-audit /
  peer-reconnect design logs, the April-8 delivery-failure tree, and the May-14
  relay-recovery log. Every requirement scattered across those sources is pulled
  here into one ordered list so nothing keeps getting dropped. This document is
  the YARDSTICK; the live binary test is the ENFORCER — each DoD line maps to a
  journey the test must drive against the real shipped binaries. Status tags are
  the current honest ground truth, not aspirations.
---

# M7 — Definition of Done

## How to use this

- This document is the **target**. It is the consolidation of the discovered
  scope that no single prior doc held — the outline only had the happy path; the
  unhappy paths, the relay-recovery substrate, and the seal-value work live in
  the postmortem and the four stories. They are all pulled in here.
- The **live binary test** (`docs/.../M7-CLOSE` harness, to be written) is what
  proves each line. A DoD line is "done" only when its journey is green against
  the real `cello-daemon` / `cello-mcp` / directory / relay binaries — not when a
  unit test against an internal seam passes. Tier and §"Verification harness"
  below map DoD IDs to test journeys.
- **Critical caveat (from STATE-OF-THE-UNION):** the live multi-process run has
  NEVER happened in the daemon era. Every line marked BUILT is built-and-unit-
  green only. Nothing here is yet proven against the gate it actually requires.

## Status legend

- ✅ **BUILT+MERGED** — in `main`, once-reviewed as a story; unit/in-process green.
- 🟡 **BUILT / UNVERIFIED-LIVE** — code exists (main or assembly) but never run live
  multi-process; or is wired OFF.
- 🟠 **PARTIAL** — one half built, the other missing or dead-stack-homed.
- ❌ **NOT BUILT** — greenfield; only a story YAML, or nothing.
- ⬜ **NOT STORIED** — designed in the postmortem, no story written yet.

> Reminder: ✅ here still means "unit-green and once-reviewed," NOT "proven live."
> The live run reclassifies every ✅/🟡 to pass/fail for real.

---

## Tier 0 — Cross-cutting invariants (must hold in EVERY journey)

These are not a journey; they are properties every line below must preserve.

- **DOD-INV-1 — Sovereign nodes.** No journey assumes co-located directories,
  shared state, single provider, or that all nodes are up. Failover routes around
  a down node. Manifest lists multiple nodes across regions/providers. *(outline;
  CLAUDE.md)* — 🟡 (asserted in design; never exercised against a real cluster)
- **DOD-INV-2 — No single party can forge.** No code path lets one node, the
  relay, the directory, or a peer produce a valid ceremony/seal output alone.
  B's acknowledgement is always B's own node's signature. *(audit; SESSION-003
  SI; DAEMON-004 SI-003)* — 🟡
- **DOD-INV-3 — Relay never sees plaintext.** Content is peer↔peer; the relay
  sees only hashes (Structure 2) and, for parked content, ciphertext it cannot
  decrypt. *(M1; MSG-001 SI-001)* — ✅ for hash layer / ❌ for the encrypted park
  store (not built)
- **DOD-INV-4 — Client verifies sender = counterparty.** The relay-stream
  receive path checks `senderPubkey === session.counterparty_pubkey` independently
  of the relay (the 5-line audit fix). *(transport-security-audit §4b — was BROKEN
  2026-06-11)* — ❓ VERIFY (status unconfirmed in the daemon path)
- **DOD-INV-5 — Ephemeral session Peer ID is session-scoped.** After seal +
  teardown, a dial to the old session multiaddr fails; a session node accepts only
  its one counterparty (connectionGater) before the Noise handshake. *(daemon-
  transport-arch; E2E-001 SI-001/SI-002; DAEMON-002)* — 🟡 (gater built; the
  dial-after-teardown SI never run live)
- **DOD-INV-6 — Error discipline.** Every distinct failure cause → a distinct
  code; every catch logs `error.message` (never `${error}`/`[object Object]`);
  every MCP failure carries an actionable `guidance` field. *(outline Rules 1&2)*
  — 🟡 (per-story in built code; un-audited across the assembly)
- **DOD-INV-7 — Receipt, not assent.** "Sealed" never means "agreed," anywhere in
  protocol or UX. The seal attests receipt + integrity + ordering only. *(postmortem
  C-1; SESSION-004)* — ❌ (legibility client side not built)
- **DOD-INV-8 — No console.log; injected Logger; correlationId threaded per async
  flow.** *(outline; M4+ rules)* — 🟡
- **DOD-INV-9 — Transport mode is explicit.** Direct vs relay is read from the
  `transport_mode` field, NEVER inferred from address format. *(WIRE-001; SESSION-003)*
  — 🟡

---

## Tier 1 — The happy spine (the first journey to make green)

Source: outline Milestone Close Gate + E2E-001 AC-001–012. Mostly built/merged;
**never run live as one journey.**

- **DOD-SPINE-1 — Daemon up.** `cello login` starts (or connects to) the daemon
  within 5s; `cello status` shows daemon running, `directory_signaling: connected`,
  ≥1 agent, connections list; `daemon.started` + `daemon.login.validation.complete`
  + `daemon.ipc.connected (clientType: cli)` logged. — 🟡 (Keystone wires the dial;
  never run against a real directory)
- **DOD-SPINE-2 — Two IPC sessions, independent current-agent.** Two distinct
  socket connections; switching current in one does not affect the other;
  `agent.current.switched` fires only for the switching connection. — ✅ (MCP-001/002)
- **DOD-SPINE-3 — Three-state model.** `registered → online → current` observable
  in sequence via `cello_list_agents`; login does NOT auto-start agents. — ✅
- **DOD-SPINE-4 — Register two agents (real DKG).** `cello register <agent>` →
  pre-auth token → `register_request` → FROST DKG against the directory →
  `register_success` → per-agent files under `~/.cello/agents/<name>/` + agent→user
  link. Two agents under one account (always via Telegram; no parent/child ceremony).
  — 🟡 (Registration built + 249 tests; live DKG never run in daemon era)
- **DOD-SPINE-5 — Initiate session, ephemeral nodes.** `cello_initiate_session`
  creates an ephemeral session node (fresh key/Peer ID), reports it to the
  directory, receives a FROST-signed SessionAssignment carrying both session Peer
  IDs + multiaddrs; session node Peer ID ≠ directory-facing Peer ID; standing
  receiver pre-exists. — 🟡 (proven in-process seams 1a/1b/2; never live)
- **DOD-SPINE-6 — Send / receive.** A `cello_send` → B `cello_receive`; relay log
  shows `hash_submit` from A's *session* Peer ID and `leaf_deliver` to B's *session*
  Peer ID; content never in relay logs. — 🟡 (proven in-process seam 3/4; never live)
- **DOD-SPINE-7 — Bilateral seal.** Both parties submit SEAL ctrl leaves →
  directory rebuilds + verifies the whole signed Merkle chain → FROST notarization
  → `session_sealed` to both with byte-identical `sealed_root`. — 🟡 (DAEMON-004
  active-seal wired via interrupted plumbing; never run live)

---

## Tier 2 — Resilience & trust (built, OFF or unverified-live)

- **DOD-AUTH-1 — Directory bidirectional auth (steps 5–6).** Directory signs its
  challenge response; client verifies against pinned node keys from the manifest;
  a rogue node (key not in manifest) is rejected at step 6 with
  `directory_challenge_failed`; daemon falls back to another manifest node.
  *(MANIFEST-002; bidirectional-auth log)* — 🟡 **STEP 6 IS OFF** (Keystone shipped
  with verify off; inbound-assignment FROST verify also deferred). Highest-risk
  trust gap.
- **DOD-AUTH-2 — Manifest enforcement (TUF).** Schema `version / not_before /
  expires` + threshold sig over N root keys; reject `version ≤ trusted`; reject
  expired (refuse ALL connections); persist trusted version (never downgrade);
  poll every 6–12h. *(MANIFEST-001/002)* — 🟡 (built; never polled/verified live;
  directory-side production key/manifest wiring uncertain)
- **DOD-SIG-1 — Signaling resilience.** Heartbeat (DIR-PING-001 pong) → on kill,
  `directory_signaling: reconnecting`, exponential backoff, reconnect to a
  **different** directory node from the manifest, drain queued outbound ops; tool
  calls during the window return `signaling_reconnecting` + guidance (never silent,
  never hang); full re-auth on reconnect (no resume token). *(SIGNAL-001; Q5)* — 🟡
- **DOD-INT-1 — Interrupted session.** Daemon stop while a session is active →
  row marked `interrupted` in SQLCipher; surfaced at next login BEFORE other ops
  with sessionId / counterparty / messageCount; `session.interrupted.detected` with
  `source: daemon_restart` (distinct from `relay_frame` / `stream_close`).
  *(SESSION-001)* — ✅ (merged; not re-verified post-collapse)
- **DOD-INT-2 — Seal-interrupted flow.** Remaining party can run the bilateral
  seal-interrupted agreement at next contact (both sign SEAL ctrl leaves over the
  interruption state → FROST). *(SESSION-001; daemon-transport-arch §10.3)* — 🟡
  (interrupted-seal plumbing exists; reused by DAEMON-004; not run live)
- **DOD-RETRY-1 — Retry queue + nonce dedup survive restart.** Queue holds
  messages across disconnect, drains in FIFO order on reconnect; nonce dedup
  rejects duplicates; both survive a real daemon restart (SQLCipher). FIFO cap
  1000; nonce set cap 10,000. *(DAEMON-003)* — ✅ (logic merged; the
  reconnect-drain-and-actually-redeliver path overlaps the missing MSG-001-3b)

---

## Tier 3 — Discovered scope (the postmortem work; NOT in the outline gate)

This tier is the heart of what kept getting dropped. Authority: POSTMORTEM Parts
3–4 + the four stories + the April-8 / May-14 logs.

### Content delivery (MSG-001)

- **DOD-MSG-1 — Delivery ACK ladder.** Unsigned, Noise-authenticated ACK
  `received → persisted`; protocol acts on `persisted` ONLY; ACK is NEVER an input
  to the seal / Merkle root / `last_seen_seq`. *(MSG-001 AC-001/002, SI-004)* — 🟡
  (3a ACK round-trip in main; over the daemon path)
- **DOD-MSG-2 — TTF park model.** On TTF with no `persisted` ACK → park; on
  startup → flush locally-persisted un-acked content. NOT flush-on-close (no
  graceful close on lid-shut/crash). *(MSG-001 AC-003/004/005)* — 🟠 (retry_queue
  TTF trigger + startup flush in main; the park *target* depends on 3b)
- **DOD-MSG-3 — Relay store-and-forward (durable, encrypted, recipient-keyed).**
  WAL-backed, fsync-durable, recipient-pubkey-keyed; holds CIPHERTEXT the relay
  cannot read; TTL 7d, delete-on-pickup; survives relay restart. *(MSG-001
  AC-006/007/008/016, SI-001)* — 🟠 (relay ContentStore/FileContentStore/handler
  merged in trustless-cello main; the daemon side that deposits/pulls = 3b, NOT built)
- **DOD-MSG-4 — Recovery instead of desync.** Hash-without-content past grace →
  request resend from sender → if unreachable, pull from relay queue → cross-check
  → accept at the already-assigned sequence (no new leaf). Session stays alive.
  *(MSG-001 AC-009/010/011, SI-005)* — ❌ **NOT BUILT (MSG-001-3b)** — biggest gap.
- **DOD-MSG-5 — Resend vs replay dedup.** A `content_hash` satisfies at most one
  Merkle leaf, exactly once; duplicates/replays never double-count. *(MSG-001
  AC-012, SI-002)* — ❌ (part of 3b)
- **DOD-MSG-6 — Content size cap.** Single named 1 MB constant enforced at send
  AND inbound decode, strictly below the 4 MB transport default; `content_too_large`
  + guidance; replaces the silent 4 MB decode→desync. *(MSG-001 AC-013/014/018, SI-003)*
  — ✅ (3a; size cap + IPC-buffer fix in main)
- **DOD-MSG-7 — Desync ONLY on tamper.** The only content-path desync is
  `content_hash_mismatch`; mere absence / recovery-failure / oversize keep the
  session alive. *(MSG-001 AC-015, SI-005)* — 🟠 (naming in 3a; full behavior needs 3b)
- **DOD-MSG-8 — Irreducible loss is honest.** Device loss before any flush → hash
  already committed → receiver seals "sent, not received" (content frontier excludes
  it); a straggler post-seal is rejected, never re-enters a sealed session. *(MSG-001
  DB-003)* — ❌ (depends on 3b + SESSION-004 frontier)

### Unilateral seal → real notarization (SESSION-002)

- **DOD-SEAL-1 — Verify reported root.** Directory rebuilds + verifies the root
  from the signed-leaf chain; rejects `unilateral_root_unverifiable` /
  `unilateral_leaves_unavailable` / `unilateral_seal_leaf_invalid`. Stops trusting
  `reported_root`. *(SESSION-002 AC-001..004, SI-001)* — ❌ **GREENFIELD** (only YAML;
  directory bilateral notarization exists to reuse)
- **DOD-SEAL-2 — FROST notarization, counterparty ABSENT.** Signer = initiator +
  directory threshold; counterparty NEVER a signer, never receives `seal_verified`;
  single-key fallback pre-DKG; persisted signed append-only upgrade-ready
  `SealNotarization`, `close_type SEAL_UNILATERAL`, counterparty `ABSENT`. *(SESSION-002
  AC-005..008, SI-002)* — ❌
- **DOD-SEAL-3 — Verifiable certificate, channel-independent.** Confirm/notify
  frames carry the full cert; client rebuilds the canonical TBS and verifies the
  signature against an independently-trusted key; a channel-swapped `sealed_root`
  is rejected. *(SESSION-002 AC-009/010/011, SI-003)* — ❌ (client side; re-home onto
  daemon seal path)

### Session-path liveness (SESSION-003)

- **DOD-LIVE-1 — Liveness on the session-carrying component, never the directory.**
  Relay is the authority for relay-path (acts on onPeerConnect/Disconnect, not
  log-only; `session_liveness_query/response`); peer↔peer session node is the
  authority for direct (client acts on onPeerDisconnect + transport keepalive).
  *(SESSION-003 AC-001..005, SI-002)* — 🟠 (daemon `#sessionLiveness` direct half
  built + tested in-process in main; relay/directory server half PARKED at `e081efe`,
  NOT in main)
- **DOD-LIVE-2 — The ABSENT gate.** `gone → ABSENT`, `alive → DELIVERED`,
  `unknown → DELIVERED` (fail-safe). Alive-but-silent (busy) is NEVER sealed ABSENT;
  ABSENT requires a POSITIVE connection-gone observation; relay-path ABSENT must come
  from the relay, not self-asserted. *(SESSION-003 AC-006..010, SI-001/003/004)* — ❌
  (the seal-ABSENT gate is dead-stack-homed; re-home onto daemon seal path)
- **DOD-LIVE-3 — No agent heartbeat.** Liveness is connection/node-level only;
  `last_seen_seq` is the sole engagement signal; DELIVERED is never promoted to
  CLEAN/FLAGGED by a liveness signal. *(SESSION-003 AC-011)* — 🟡

### Seal certificate legibility (SESSION-004)

- **DOD-LEG-1 — Receipt-not-assent, first-class.** Cert carries `attests:'receipt'`,
  `implies_assent:false`, plain-language disclaimer; no field parseable as agreement.
  *(SESSION-004 AC-001, SI-001)* — 🟠 (protocol-types schema in main; directory
  derivation half PARKED at `f466946`; client surfacing GREENFIELD)
- **DOD-LEG-2 — Per-party content frontier.** `content_frontier_seq` (max signed
  `last_seen_seq`) + `last_authored_seq` per party, derived only from that party's
  signed leaves; client re-derives and rejects `certificate_frontier_unverifiable`
  on an inflated published frontier. *(SESSION-004 AC-002/005, SI-002)* — ❌
- **DOD-LEG-3 — Live/recovered/absent marker.** `attestation_mode` per party,
  always exactly one of the three. *(SESSION-004 AC-003)* — ❌
- **DOD-LEG-4 — Final-message-answered.** The malicious tail ("…you agreed to send
  me $1000") reads as `final_message.answered:false`, delivered-but-unanswered,
  never agreed. All four interruption cases legible. *(SESSION-004 AC-004/006/007, SI-001)*
  — ❌

---

## Tier 4 — Designed, NOT yet storied (must be written before claimed done)

- **DOD-UP-1 — Unilateral → bilateral upgrade (Workstream C).** Returning absent
  party recovers + verifies content, signs an ack leaf over the sealed root →
  promote to bilateral (append-only superseding row); reverse PERSIST-015 SI-002;
  refuse only on unverifiability (D-3). Content possession is the precondition.
  *(postmortem C-3/C-4, Part 4 row C)* — ⬜ NOT STORIED
- **DOD-UP-2 — Auto-acknowledge close (Workstream E).** B's node auto-co-signs the
  responder SEAL leaf on ingesting A's SEAL ctrl leaf + verified content, no agent
  prompt; `counterparty_closing` becomes informational; verifiability-gated; B's
  signature always from B's own node. *(postmortem C-5)* — ⬜ NOT STORIED

---

## Tier 5 — Recovery substrate flagged in the old logs (verify carried or drop)

These appear in the April-8 and May-14 design logs and underpin Tier 3. Confirm
they are either captured by the four stories or explicitly decided out.

- **DOD-REC-1 — Signed relay ACK as a cryptographic receipt.** The relay's ACK
  over `(H || seq || timestamp)` as evidence a hash entered the record. *(May-14 log
  §"Signed Relay ACKs")* — ❓ NOT clearly carried into the four stories. FLAG.
- **DOD-REC-2 — Pre-seal reconciliation / gap-fill.** Both parties exchange last
  confirmed seq before CLOSE; on divergence the relay serves missing leaves from WAL
  (relay-authoritative, not counterparty). *(May-14 log §"Pre-Seal Reconciliation")*
  — ❓ Partially implied by MSG-001 recovery, but the bilateral pre-seal handshake
  is not explicitly storied. FLAG.
- **DOD-REC-3 — Delivery-failure tree coverage.** The A/B/C/D branches + time
  dimension (within-grace / after-grace-active / after-dead / never). *(April-8 log)*
  — partially absorbed by MSG-001 (recovery) + SESSION-004 (post-session straggler).
  Confirm each adversarial branch has a defined outcome. FLAG.

---

## The verification harness (DoD → live test journeys)

The test spawns the **real binaries** on localhost (no AWS deploy): directory(s),
relay, and the daemon(s). Real TCP, Noise, crypto, IPC. Journeys, in build order —
each must stay green once passed:

1. **J-SPINE** → DOD-SPINE-1..7 (+ INV-3/5/8/9). Two agents register, one message,
   bilateral seal.
2. **J-AUTH** → DOD-AUTH-1/2 (+ INV-1/2). Rogue node rejected at step 6; expired
   manifest refuses all. *(turns DOD-AUTH-1 from OFF to on)*
3. **J-SIG** → DOD-SIG-1. Kill signaling → reconnect to a different node → ops drain.
4. **J-INT** → DOD-INT-1/2, DOD-RETRY-1. Kill daemon mid-session → interrupted →
   surfaced → seal-interrupted; queue/nonce survive restart.
5. **J-CONTENT** → DOD-MSG-1..8 (+ INV-3/4). A sends, B offline → park encrypted →
   B returns → pull/decrypt/recover; oversize rejected; replay deduped; tamper desyncs.
6. **J-UNILATERAL** → DOD-SEAL-1..3, DOD-LIVE-1/2/3. A seals while B is gone vs
   busy-silent → ABSENT vs DELIVERED → verifiable cert.
7. **J-LEGIBILITY** → DOD-LEG-1..4. Malicious-tail transcript → cert reads
   delivered-but-unanswered; four interruption cases legible.
8. **J-UPGRADE** → DOD-UP-1/2 (after stories written).

The adversarial SIs (every story's SI block) are journey assertions, not extras:
ephemeral-Peer-ID-dies (INV-5), third-party-dial-rejected (INV-5), relay-can't-read
-plaintext (INV-3), channel-swap-rejected (DOD-SEAL-3), busy-never-ABSENT (DOD-LIVE-2),
no-double-count (DOD-MSG-5), no-assent-field (DOD-LEG-4).

---

## Honest bottom line

- **Tier 1** is built and proven in-process; **never run live as one journey.**
- **Tier 2** is built but step-6 auth is OFF and none of it has touched a real cluster.
- **Tier 3** is the real remaining work: **MSG-001-3b, SESSION-002, SESSION-004
  client, the SESSION-003 ABSENT gate** are NOT built (or are parked/dead-stack-homed).
- **Tier 4** isn't even storied.
- **Tier 5** has 2–3 items that may have been dropped between the old logs and the
  four stories — decide them in or out, don't let them evaporate again.

M7 is done when journeys J-SPINE through J-LEGIBILITY are green against the real
binaries, every Tier-0 invariant holds, and Tier-4 is either built or explicitly
moved to a named future milestone (not silently deferred — that is RC-1).
