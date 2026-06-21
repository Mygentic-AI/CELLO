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
  + `daemon.ipc.connected (clientType: cli)` logged. — ✅ **PROVEN LIVE (daemon-up)** by
  J-SPINE (2026-06-18, commits `92f82e3` → `034e487`): real relay+directory+daemon+cli
  on localhost; daemon running, `cello login` connects <5s, `directory_signaling:
  connected` **directory-corroborated** (the directory's own `[AUTH]` log shows it
  authenticated this agent's signaling stream — not the daemon's self-report), ≥1 agent,
  `connections` list, `daemon.started` + `daemon.login.validation.complete`. **Two-sided,
  non-tautological** (reviewer H1 fix). CORRECTION: `daemon.ipc.connected` fires only on
  an `ipc.connect` frame, which only `cello-mcp` sends (`clientType: "mcp"`, NOT "cli");
  the bare CLI never sends it → that event is asserted in **DOD-SPINE-2** (the IPC/MCP
  surface), not here.
- **DOD-SPINE-2 — Two IPC sessions, independent current-agent.** Two distinct
  socket connections; switching current in one does not affect the other;
  `agent.current.switched` fires only for the switching connection. — ✅ **PROVEN LIVE**
  by J-SPINE (2026-06-18, commit `e1592dc`): two real `cello-mcp` processes (SDK
  `StdioClientTransport`) on one daemon; `daemon.ipc.connected{clientType:"mcp"}` logged;
  conn1's `cello_use_agent` makes agentA `current` on conn1 while conn2 still sees
  `online`; `agent.current.switched` logged for the switch. Caught + fixed a real
  cello-mcp bug (ignored `CELLO_DIR`, cello-client `e31b646`).
- **DOD-SPINE-3 — Three-state model.** `registered → online → current` observable
  in sequence via `cello_list_agents`; login does NOT auto-start agents. — ✅ **PROVEN
  LIVE** by J-SPINE (commit `e1592dc`): registered (loaded) → online (`cello_start_agent`)
  → current (`cello_use_agent`), each state observed via real `cello_list_agents`.
- **DOD-SPINE-4 — Register two agents (real DKG).** `cello register <agent>` →
  pre-auth token → `register_request` → FROST DKG against the directory →
  `register_success` → per-agent files under `~/.cello/agents/<name>/` + agent→user
  link. Two agents under one account (always via Telegram; no parent/child ceremony).
  — ✅ **PROVEN LIVE** by J-SPINE (2026-06-18/19, cello-client `17ea7b1` + trustless-cello
  `39a3619`): TWO agents register on ONE daemon, each its OWN real FROST DKG, both deduped
  to ONE account — corroborated against the directory's OWN `cello_spine` DB (2
  `agent_profiles` rows carrying the DKG primary_pubkeys, 1 `user_accounts` row, shared
  non-null `account_id`) + per-agent files (`registration-state`/`ml-dsa-keypair`/
  `frost-share`/`agent-user-link`.json). Reviewer APPROVED. **Built the missing capability:**
  per-agent directory signaling streams (each agent authenticates its own stream; the
  directory routes by authed pubkey) — the multi-agent single-daemon registration M7
  intended. **Fixed** a directory account-link race (insert-with-account_id atomically).
  Note: non-primary agents' INBOUND session routing is the **SPINE-5** follow-on (their
  per-agent stream has no session inbound handler yet — registration works; sessions next).
- **DOD-SPINE-5 — Initiate session, ephemeral nodes.** `cello_initiate_session`
  creates an ephemeral session node (fresh key/Peer ID), reports it to the
  directory, receives a FROST-signed SessionAssignment carrying both session Peer
  IDs + multiaddrs; session node Peer ID ≠ directory-facing Peer ID; standing
  receiver pre-exists. — ✅ **PROVEN LIVE** by J-SPINE (2026-06-19, cello-client `c0b806b`
  + `8e8a189`, trustless-cello `d28c42e`): two agents registered on ONE daemon, agentA
  online+current initiates to agentB → the directory brokers + **FROST-signs** a
  SessionAssignment (parsed: requires both participants' session Peer IDs + multiaddrs)
  and the daemon receives it; directory-corroborated (`[SESS] Session request` broker log).
  **Built two missing capabilities:** (1) a real client-side `SessionNegotiator` (was
  `directory_signaling_not_configured`), and (2) the **session FROST ceremony participation**
  handler over per-agent signaling — the directory delegates signing to the initiator
  (`ceremony_request`→`ceremony_result`); the daemon reconstructs the agent's threshold
  signer from `frost-share.json` and answers (was `ceremony_timeout`). The actual P2P **dial**
  (no `transportDialer` wired in the binary) is **DOD-SPINE-6**.
- **DOD-SPINE-6 — Send / receive.** A `cello_send` → B `cello_receive`; relay log
  shows `hash_submit` from A's *session* Peer ID and `leaf_deliver` to B's *session*
  Peer ID; content never in relay logs. — ✅ **PROVEN LIVE** by J-SPINE (2026-06-20,
  cello-client `cbd2b9f` + trustless-cello `4731417`): TWO daemons (two parties),
  agentA@daemonA + agentB@daemonB → B `cello_await_session` → A `cello_initiate_session`
  → **A `cello_send` → B `cello_receive` with byte-identical plaintext** over the direct
  `/cello/content/1.0.0` P2P stream, AND the relay witnessed the leaf: relay log shows
  `hash_submit witnessed … from <A session pubkey>` then `leaf_deliver … to <B session
  pubkey>`; plaintext NEVER appears in the relay logs (INV-3 — non-tautological: the relay
  IS in the witness path). **Built three missing capabilities:** (1) GAP 1 — the WIRE-002
  `wants_session_offer` opt-in is now carried through the directory's typed allowlist
  decoder (was silently dropped → empty counterparty endpoint), so the
  `session_offer→accept` round-trip folds B's standing-receiver endpoint into the
  FROST-signed assignment and A's dial reaches N_B; (2) GAP 2 — the daemon-side relay
  witness client (`session-relay-client.ts`): each session node connects + Ed25519
  challenge-response auths to the relay over `/cello/relay/1.0.0` and submits signed
  Structure-1 message-leaf hashes; the relay assigns the canonical sequence + forwards
  `leaf_deliver`; (3) the session gater now admits the relay OUTBOUND-only (the session
  node must reach the relay; INBOUND stays counterparty-only, INV-5 preserved). Relay
  gained observable `relay.hash.submitted` / `relay.leaf.delivered` events (DOD-INV-8).
  Note: the relay-assigned canonical sequence is witnessed, but the receiver's full
  canonical-sequence reconciliation against its local tree (vs the direct-content local
  index) is MSG-001-3b's recovery scope (J-CONTENT) — the SPINE happy path is green.
- **DOD-SPINE-7 — Bilateral seal.** Both parties submit SEAL ctrl leaves →
  directory rebuilds + verifies the whole signed Merkle chain → FROST notarization
  → `session_sealed` to both with byte-identical `sealed_root`. — ✅ **PROVEN LIVE**
  by J-SPINE (2026-06-20, cello-client `fecb22a` + trustless-cello harness `1c59feb`):
  two daemons, a message, then BOTH `cello_close_session` → each daemon submits a SEAL
  **ctrl** leaf (0x02) via the relay witness → relay `#maybeProcessSeal` (two
  distinct-sender ctrl leaves) → directory `processSeal` rebuilds + verifies the signed
  3-leaf chain → **FROST notarization** (the initiator coordinates the seal FROST ceremony,
  `cello-frost-seal-v1`, the daemon's reconstructed threshold signer co-signs with the
  directory's K_server shares) → `session_sealed` delivered to BOTH parties with a
  **byte-identical `sealed_root`**. **Built (relay-mediated path):** (1) the daemon SEAL
  ctrl leaf + `submitLeaf`; (2) `cello_close_session` relay-mediated branch (submit + await
  `session_sealed`, directory-mediated fallback); (3) the `session_sealed` listener; (4) the
  harness relay→directory wiring (pre-derived relay peer id + fixed port, directory-first);
  (5) the `last_seen_seq` counterparty-seen fix (the SI-003 causal-chain correctness bug);
  (6) the **daemon SEAL FROST ceremony** (`wireSealCeremonyHandler` — `seal_verified` →
  reconstruct signer → `participateInCeremony` → `seal_frost_signature`). The full happy
  spine (SPINE-1→7) now runs end-to-end against the real binaries — the FIRST time in the
  daemon era.

---

## Tier 2 — Resilience & trust (built, OFF or unverified-live)

- **DOD-AUTH-1 — Directory bidirectional auth (steps 5–6).** Directory signs its
  challenge response; client verifies against pinned node keys from the manifest;
  a rogue node (key not in manifest) is rejected at step 6 with
  `directory_challenge_failed`; daemon falls back to another manifest node.
  *(MANIFEST-002; bidirectional-auth log)* — ✅ **PROVEN LIVE** (J-AUTH, 2026-06-21).
  Step-6 is now ON as an opt-in: the directory binary signs step-5 with a per-node
  Ed25519 key (`CELLO_DIRECTORY_NODE_KEY_HEX` → `DirectoryKeyProvider`), and a
  manifest-configured daemon (`CELLO_CONSORTIUM_MANIFEST` + root keys/threshold →
  `FileManifestProvider` + `ManifestDirectoryChallengeVerifier`) verifies it at
  step-6 (`directory.auth.challenge.verified`, `verified:true`). Rogue node (nodeId
  not in the manifest) → `directory.auth.challenge.failed` `key_not_in_manifest`,
  never connects. Unset env = M6 backward-compat (verify off) — J-SPINE still green.
  SCOPE: multi-node *failover* is not modelled by the single-directory harness
  (REJECTION is the proven security property); the separate inbound-assignment FROST
  verify is tracked under the session path, not here.
- **DOD-AUTH-2 — Manifest enforcement (TUF).** Schema `version / not_before /
  expires` + threshold sig over N root keys; reject `version ≤ trusted`; reject
  expired (refuse ALL connections); persist trusted version (never downgrade);
  poll every 6–12h. *(MANIFEST-001/002)* — 🟡 **MOSTLY PROVEN LIVE** (J-AUTH,
  2026-06-21): threshold officer-sig verification (3-of-5 over the canonical body),
  expiry refusal, AND anti-rollback are all live. Expired manifest →
  `directory.auth.manifest.expired` + daemon refuses to start (ADV-002, no silent
  downgrade). A regressed version (v1 after a trusted v2, across a restart, valid
  sigs) → `directory.auth.manifest.version.rollback` + refusal — the binary now wires
  `FileManifestVersionStore` under `CELLO_DIR` (persist-trusted-version). REMAINING:
  only the periodic 6–12h `manifest_poll` background refresh is not yet exercised
  live (time-based; the daemon has the poll path + `manifestPollScheduler`).
- **DOD-SIG-1 — Signaling resilience.** Heartbeat (DIR-PING-001 pong) → on kill,
  `directory_signaling: reconnecting`, exponential backoff, reconnect to a
  **different** directory node from the manifest, drain queued outbound ops; tool
  calls during the window return `signaling_reconnecting` + guidance (never silent,
  never hang); full re-auth on reconnect (no resume token). *(SIGNAL-001; Q5)* —
  🟢 **DEGRADATION + RECOVERY PROVEN LIVE** (J-SIG, 2026-06-21). Degradation: kill the
  directory → `cello status` flips `directory_signaling` to `reconnecting`, and a
  signaling-dependent tool call (`cello_initiate_session`) returns a DISTINCT bounded
  reason + actionable guidance — never silent, never an unbounded hang. (BINARY NOTE:
  the reason on the per-agent initiate path is `directory_signaling_timeout` — the
  per-agent stream waits ≤10s then times out — not the DoD's example
  `signaling_reconnecting`; both satisfy the invariant.) Recovery: the directory returns
  on the same bootstrap URL (harness `restartDirectory`) → the daemon re-discovers it
  and reconnects → `directory_signaling` back to `connected` with a FULL re-auth (a
  second `directory.signaling.connected`, no resume token). REMAINING (minor): an
  explicit queued-op DRAIN assertion (the internal queue drain is unit-covered), and
  multi-node *failover* (not modelled by the single-directory harness).
- **DOD-INT-1 — Interrupted session.** Daemon stop while a session is active →
  row marked `interrupted` in SQLCipher; surfaced at next login BEFORE other ops
  with sessionId / counterparty / messageCount; `session.interrupted.detected` with
  `source: daemon_restart` (distinct from `relay_frame` / `stream_close`).
  *(SESSION-001)* — ✅ **RE-VERIFIED LIVE** (J-INT, 2026-06-21). Two parties establish
  a session + send a message; daemonA is SIGKILLed (crash, no graceful shutdown);
  restarted on the same `CELLO_DIR` → `SessionNodeManager.initialize()` finds the
  `active` row, marks it `interrupted`, logs `session.interrupted.detected`
  `source:daemon_restart` with the sessionId; `cello login` → `cello status` surfaces
  it with sessionId / counterparty / messageCount≥1. BUG FOUND + FIXED: the initiator's
  session row stored an EMPTY counterparty (handler read `counterparty_pubkey` but the
  tool sends `target_pubkey`) — fixed in cello-client (daemon `6c93b1a`); needs a
  `@cello-protocol/connect` publish to reach operators.
- **DOD-INT-2 — Seal-interrupted flow.** Remaining party can run the bilateral
  seal-interrupted agreement at next contact (both sign SEAL ctrl leaves over the
  interruption state → FROST). *(SESSION-001; daemon-transport-arch §10.3)* —
  ✅ **PROVEN LIVE** (J-INT, 2026-06-21). Both parties SIGKILLed mid-session →
  both restart `interrupted` → A `cello_close_session` signs its SEAL-INTERRUPTED
  leaf + sends `seal_interrupted_request` → B's daemon auto-validates + co-signs its
  OWN leaf (`session.interrupted.responder.acked`) → A verifies (nonce L-2 + leafCount
  + Ed25519) → bilateral commitment, status `seal_interrupted_pending`. BUG FOUND +
  FIXED: the directory's typed frame decoder dropped the `nonce` on the
  `seal_interrupted_ack` relay → every bilateral seal-interrupted failed
  `seal_interrupted_nonce_mismatch` (the GAP-1 pattern); carried through (directory
  `89c9825`). The terminal FROST notarization (`pending`→`sealed`) is the directory
  ceremony step, tracked separately.
- **DOD-RETRY-1 — Retry queue + nonce dedup survive restart.** Queue holds
  messages across disconnect, drains in FIFO order on reconnect; nonce dedup
  rejects duplicates; both survive a real daemon restart (SQLCipher). FIFO cap
  1000; nonce set cap 10,000. *(DAEMON-003)* — ✅ **SURVIVAL PROVEN LIVE** (J-INT,
  2026-06-21): two messages queued + a nonce marked seen → SIGKILL + restart on the
  same `CELLO_DIR` → `drain_session` shows both entries in FIFO order, the pre-crash
  nonce is still a duplicate, a fresh nonce is not. (The reconnect-drain-and-actually-
  redeliver path still overlaps the missing MSG-001-3b content path.)

---

## Tier 3 — Discovered scope (the postmortem work; NOT in the outline gate)

This tier is the heart of what kept getting dropped. Authority: POSTMORTEM Parts
3–4 + the four stories + the April-8 / May-14 logs.

### Content delivery (MSG-001)

- **DOD-MSG-1 — Delivery ACK ladder.** Unsigned, Noise-authenticated ACK
  `received → persisted`; protocol acts on `persisted` ONLY; ACK is NEVER an input
  to the seal / Merkle root / `last_seen_seq`. *(MSG-001 AC-001/002, SI-004)* —
  ✅ **PROVEN LIVE** (J-CONTENT, 2026-06-21). A→online-B: B's `persisted` delivery ACK
  resolves A's awaiting timer (`content.delivery.acked` level `persisted`), and because
  it is confirmed persisted the content is NOT handed to the park backstop. The ACK
  handler (`#resolveAwaitingAck`) only clears the timer + durable entry + logs — it never
  appends a leaf, touches the root, or advances `last_seen_seq` (verified by inspection).
- **DOD-MSG-2 — TTF park model.** On TTF with no `persisted` ACK → park; on
  startup → flush locally-persisted un-acked content. NOT flush-on-close (no
  graceful close on lid-shut/crash). *(MSG-001 AC-003/004/005)* — 🟠 (retry_queue
  TTF trigger + startup flush in main; the park *target* depends on 3b)
- **DOD-MSG-3 — Relay store-and-forward (durable, encrypted, recipient-keyed).**
  WAL-backed, fsync-durable, recipient-pubkey-keyed; holds CIPHERTEXT the relay
  cannot read; TTL 7d, delete-on-pickup; survives relay restart. *(MSG-001
  AC-006/007/008/016, SI-001)* — ✅ **PROVEN LIVE** (J-CONTENT, 2026-06-21). The daemon
  side (3b) is built: `ContentParkClient` (deposit + auth-gated pull), the live
  send-path auto-park on a not-confirmed send (R1 — `content.park.deposited`), and the
  receive-path recover (`content_park_recover`). A→relay→B round-trip through the real
  relay binary, ciphertext only (INV-3). Relay side (ContentStore/FileContentStore) was
  already merged + tested.
- **DOD-MSG-4 — Recovery instead of desync.** Hash-without-content past grace →
  request resend from sender → if unreachable, pull from relay queue → cross-check
  → accept at the already-assigned sequence (no new leaf). Session stays alive.
  *(MSG-001 AC-009/010/011, SI-005)* — 🟡 **CORE PROVEN LIVE** (J-CONTENT, 2026-06-21):
  pull from relay → `openContentSeal` in-daemon → cross-check → accept (the recipient
  recovers the parked message it missed while offline, into its interrupted session, and
  the session stays alive). REMAINING for the FULL line: the "request resend from sender
  first" preamble, and "no new leaf / accept at the already-assigned sequence" — empirically
  `onLeafDeliver` is a no-op today, so recovery APPENDS the missed tail (B's root grows to
  the canonical/complete one before any seal). For the real case (crash → miss the tail →
  append in order) this reproduces the sender's exact tree; the general witness-then-fill
  reconciliation (so B's root tracks canonical before content, with dedup) is DOD-MSG-5.
- **DOD-MSG-5 — Resend vs replay dedup.** A `content_hash` satisfies at most one
  Merkle leaf, exactly once; duplicates/replays never double-count. *(MSG-001
  AC-012, SI-002)* — ✅ **PROVEN LIVE** (J-CONTENT, 2026-06-21). `ingestReceivedContent`
  checks whether the `content_hash` is already a leaf before appending; if so it logs
  `session.content.deduplicated` at the existing sequence and does NOT append a second
  leaf. Test: a message delivered BOTH directly (leaf 0) AND via the relay park →
  recovered → deduplicated, exactly one `session.content.received` for the hash. Normal
  single-delivery is unchanged (the find is -1).
- **DOD-MSG-6 — Content size cap.** Single named 1 MB constant enforced at send
  AND inbound decode, strictly below the 4 MB transport default; `content_too_large`
  + guidance; replaces the silent 4 MB decode→desync. *(MSG-001 AC-013/014/018, SI-003)*
  — ✅ (3a; size cap + IPC-buffer fix in main)
- **DOD-MSG-7 — Desync ONLY on tamper.** The only content-path desync is
  `content_hash_mismatch`; mere absence / recovery-failure / oversize keep the
  session alive. *(MSG-001 AC-015, SI-005)* — ✅ **PROVEN LIVE** (J-CONTENT, 2026-06-21).
  Three parked entries recovered: HONEST (hash matches → accepted), TAMPER (valid seal,
  mismatched hash → `content_hash_mismatch` — the one desync signal — rejected), CORRUPT
  (unsealable → `content.recover.unseal_failed`, skipped, NOT a desync). recovered=1/3,
  the session stays alive, the honest message is read. Oversize is DOD-MSG-6 (✅).
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

## Tier 4 — Designed + STORIED, NOT yet built (J-UPGRADE)

Storied 2026-06-20 (CELLO-M7-UPGRADE-001 / -002) — no longer NOT STORIED; now ❌
NOT BUILT (real story machinery applied; awaiting implementation).

- **DOD-UP-1 — Unilateral → bilateral upgrade (Workstream C).** Returning absent
  party recovers + verifies content, signs an ack leaf over the sealed root →
  promote to bilateral (append-only superseding row); reverse PERSIST-015 SI-002;
  refuse only on unverifiability (D-3). Content possession is the precondition.
  *(postmortem C-3/C-4, Part 4 row C; **CELLO-M7-UPGRADE-001**)* — ❌ NOT BUILT
  (storied). Owns the directory Flyway migration that relaxes the
  one-row-per-session constraint for the superseding row (SESSION-002 deferred it
  here). Cannot be IMPLEMENTED until MSG-001-3b content recovery lands (the C-4
  precondition).
- **DOD-UP-2 — Auto-acknowledge close (Workstream E).** B's node auto-co-signs the
  responder SEAL leaf on ingesting A's SEAL ctrl leaf + verified content, no agent
  prompt; `counterparty_closing` becomes informational; verifiability-gated; B's
  signature always from B's own node. *(postmortem C-5; **CELLO-M7-UPGRADE-002**)*
  — ❌ NOT BUILT (storied). Implementable once DAEMON-004 content cross-check +
  SPINE-7 seal path exist; does NOT require MSG-001-3b.

---

## Tier 5 — Recovery substrate from the old logs (DECIDED 2026-06-20)

These appeared in the April-8 and May-14 design logs and underpin Tier 3. All three
are now decided (disposition: `discussion_logs/2026-06-20_2220_tier5-recovery-substrate-disposition.md`)
so M7 carries no silent Tier-5 deferral (RC-1). None needs a new story.

- **DOD-REC-1 — Signed relay ACK as a cryptographic receipt.** The relay's ACK
  over `(H || seq || timestamp)` as evidence a hash entered the record. *(May-14 log
  §"Signed Relay ACKs")* — ✅ **SATISFIED by CELLO-PERSIST-012** (M4): relay signs
  `(H || seq || timestamp)`, client stores it, used in disputes + relay reassignment;
  `__tests__/persist-012-relay-signed-ack.test.js` passes. Caveat for the impl thread
  (not a story): confirm the daemon-side `session-relay-client.ts` (SPINE-6) STORES the
  signed ACK durably — the M4 storage was in the now-dead ClientStore.
- **DOD-REC-2 — Pre-seal reconciliation / gap-fill.** Both parties exchange last
  confirmed seq before CLOSE; on divergence the relay serves missing leaves from WAL
  (relay-authoritative, not counterparty). *(May-14 log §"Pre-Seal Reconciliation")*
  — ✅ **SUBSUMED** by the M7 directory-authoritative seal model: the directory rebuilds
  the canonical root from the relay's witnessed leaf chain (SESSION-002 AC-001) + MSG-001
  leaf recovery is the gap-fill + POSTMORTEM D-3 is the disagreement outcome. The distinct
  bilateral pre-CLOSE handshake is not needed. (Reopens only if a live journey shows a
  divergence the directory rebuild + MSG-001 cannot resolve — recorded.)
- **DOD-REC-3 — Delivery-failure tree coverage.** The A/B/C/D branches + time
  dimension (within-grace / after-grace-active / after-dead / never). *(April-8 log)*
  — ✅ **ABSORBED** by MSG-001 (B-branches: recovery + tamper-desync), SESSION-004
  (B4/straggler/frontier), PERSIST-012 (C-branch hash queue), DAEMON-003 (D-branch retry).
  Every branch has a defined, non-silent outcome — branch-by-branch map in the disposition
  log. (Each runs live in J-CONTENT / J-UNILATERAL / J-LEGIBILITY.)

---

## Tier 6 — Data custody & local loopback (2026-06-20 scope additions)

New M7 scope decided with Andre 2026-06-20 (not in the original outline gate).
Logs: `discussion_logs/2026-06-20_2217_client-data-custody-and-encryption-at-rest.md`,
`discussion_logs/2026-06-20_2225_local-loopback-session-core-rekey-and-agent-default.md`.

### Client data custody (J-PERSIST)

- **DOD-LOG-1 — Durable, encrypted readable transcript survives restart.** The daemon
  durably stores sent + received plaintext per session, encrypted at rest (SQLCipher OR
  envelope+sqlite — the live daemon uses plain node:sqlite today; encryption-at-rest is
  absent and deferred-with-no-home), joined to the hash chain; readable after a restart via
  a read surface; relay/directory still see only hashes (INV-3). *(**CELLO-M7-PERSIST-LOG-001**)*
  — ❌ NOT BUILT (storied). Closes the at-rest encryption gap (broader than the transcript:
  retry_queue content blob, key files).
- **DOD-LOG-2 — Dispute-export bundle.** A verifiable bundle (transcript + certificate +
  hash chain) the operator can export for dispute resolution. *(J-PERSIST follow-on; design
  in the data-custody log)* — ⬜ NOT STORIED (builds on DOD-LOG-1; story when J-PERSIST is built).
- **DOD-LOG-3 — Abuse-report bundle.** A bundle for reporting malicious counterparty
  behaviour. *(J-PERSIST follow-on)* — ⬜ NOT STORIED (builds on DOD-LOG-1).

### Local loopback (J-LOOPBACK)

- **DOD-LOOP-1 — Two agents converse on ONE daemon.** Two of the operator's own K_locals
  (agents A and B) are the two ends of one session on a single daemon — no unnecessary
  process spawning. Re-key the session core from `session_id` to `(agent, session_id)`
  (sessions/session_tree_leaves PKs, the five in-memory maps, the ownership check, the
  inbound double-accept guard) + a daemon-DB migration; each end signs with its own K_local
  (INV-2). No wire/directory/relay change. *(**CELLO-M7-SESSION-CORE-REKEY-001**)* — ❌ NOT
  BUILT (storied).

> Agent-designation default (D-E1): auto-select the sole online agent on first session
> tool — a contained fix recorded as a note for the implementation thread (not a story).
> See the loopback decision log + the build journal.

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
8. **J-UPGRADE** → DOD-UP-1/2 (storied 2026-06-20; UP-1 gated on MSG-001-3b). Absent
   party returns → recovers + verifies content → signs ack leaf → bilateral
   (superseding row); B online + verified → auto-co-sign with no agent action.
9. **J-PERSIST** → DOD-LOG-1. A sends + receives → daemon restart → the readable
   transcript is recoverable (encrypted at rest); relay/directory show only hashes.
10. **J-LOOPBACK** → DOD-LOOP-1. Two agents (two K_locals) on ONE daemon converse +
    bilateral seal; each end signs with its own K_local; no second daemon process.

The adversarial SIs (every story's SI block) are journey assertions, not extras:
ephemeral-Peer-ID-dies (INV-5), third-party-dial-rejected (INV-5), relay-can't-read
-plaintext (INV-3), channel-swap-rejected (DOD-SEAL-3), busy-never-ABSENT (DOD-LIVE-2),
no-double-count (DOD-MSG-5), no-assent-field (DOD-LEG-4).

---

## The bottom line

- **Tier 1** is built and proven in-process; **never run live as one journey.**
- **Tier 2** is built but step-6 auth is OFF and none of it has touched a real cluster.
- **Tier 3** is the real remaining work: **MSG-001-3b, SESSION-002, SESSION-004
  client, the SESSION-003 ABSENT gate** are NOT built (or are parked/dead-stack-homed).
- **Tier 4** is now STORIED (UPGRADE-001/002, 2026-06-20) — ❌ NOT BUILT; UP-1 is
  gated on the MSG-001-3b content-recovery precondition.
- **Tier 5** is DECIDED (2026-06-20): REC-1 satisfied (PERSIST-012), REC-2 subsumed,
  REC-3 absorbed — no silent deferral remains.
- **Tier 6** is new 2026-06-20 scope, STORIED: J-PERSIST (PERSIST-LOG-001 — durable
  encrypted transcript; closes the daemon at-rest encryption gap) and J-LOOPBACK
  (SESSION-CORE-REKEY-001 — two agents on one daemon). Both ❌ NOT BUILT.

M7 is done when journeys J-SPINE through J-LOOPBACK are green against the real
binaries, every Tier-0 invariant holds, and every Tier-4/5/6 item is built or
explicitly moved to a named future milestone (not silently deferred — that is RC-1).
