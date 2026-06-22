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
  C-1; SESSION-004)* — 🟢 **PROVEN LIVE** (J-LEGIBILITY, 2026-06-21): the seal certificate carries
  `attests:'receipt'` + `implies_assent:false` + a plain disclaimer as first-class machine-readable
  fields, surfaced cross-process on B's daemon read; a malicious "…you agreed to send me $1000" tail
  reads as delivered-but-unanswered (`answered:false`), never agreed. Client surfacing IS built (the
  DAEMON seam, not the dead seal-manager).
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
  poll every 6–12h. *(MANIFEST-001/002)* — ✅ **PROVEN LIVE** (J-AUTH, 2026-06-22;
  `cello-done-auditor` EARNED — ran j-auth 6/6 cold against the shipped binaries,
  falsified four ways). Threshold officer-sig verification (3-of-5 over the canonical
  body), expiry refusal, AND anti-rollback were already live (2026-06-21). The
  remaining periodic poll is now ALSO proven live: the daemon's keystone signaling
  manager re-polls the directory on the (env-injectable) 6–12h interval and adopts a
  newer signed manifest end-to-end across REAL separate processes —
  `directory.auth.manifest.poll.dispatched` → directory serves
  (`directory.manifest.poll.response`) → `directory.auth.manifest.poll.success`
  `oldVersion:1 newVersion:2` → `manifest-version.json lastSeenVersion:2`. And the
  daemon does NOT trust the directory for content: a FORGED manifest the directory
  serves (bad officer sigs, version 9 > trusted) → `directory.auth.manifest.signature.invalid`
  → never adopted, trusted version held at 1. The poll loop is self-healing
  (re-armed from the dispatch side, so a lost/ignored response can't stall it), mints
  a per-cycle correlationId, and refuses adoption at `threshold < 1`. The producer
  side is a file-re-reading `FileDirectoryManifestStore` wired from
  `CELLO_DIRECTORY_CONSORTIUM_MANIFEST` (the production-faithful TUF roll-forward seam).
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
  graceful close on lid-shut/crash). *(MSG-001 AC-003/004/005)* — ✅ **PROVEN LIVE**
  (J-CONTENT, 2026-06-21). Both park triggers work: (a) LIVE park on a not-confirmed
  send (TTF expiry or direct-fail → seal + deposit, increment 2); (b) STARTUP-FLUSH
  park — a sender that recorded un-acked content then CRASHED re-parks it on restart
  from PERSISTED session state (the per-session relay endpoint is now a `sessions`
  column → `content.park.deposited source:startup_flush`), and the recipient recovers
  it. Not flush-on-close — the SIGKILL-restart path is what re-parks.
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
  *(MSG-001 AC-009/010/011, SI-005)* — ✅ **DONE + LIVE-PROVEN** (J-CONTENT, 2026-06-22; the AC —
  recovery-not-desync, ordered, session-alive — is met on every path, 3× reviewed). One beyond-AC
  hardening is DEFERRED (Andre 2026-06-22, "A now, C track"): **Finding 2 — relay-signed sequence
  verification.** Today B verifies the SENDER's signature (safe: a lying sender only self-DoSes via
  root divergence). Verifying the RELAY's committed sequence requires plumbing the relay's SIGNING
  identity to the daemon (today it knows only the relay peer id) — the SAME relay-identity gap the
  transport-security-audit flagged. **Named target:** the relay-identity hardening tracked in
  `discussion_logs/2026-06-11_0822_transport-security-audit-and-libp2p-primitives.md` ("client trusts
  relay for sender identity"); Finding 2 bundles there (see the deferral list at the bottom of this DoD).
  pull from relay → `openContentSeal` in-daemon → cross-check → accept (the recipient
  recovers the parked message it missed while offline, into its interrupted session, and
  the session stays alive). **DECIDED 2026-06-22 (Andre) — strict in-order, NOT gap-repair**
  (see discussion log `2026-06-22_1745_strict-in-order-content-recovery`): the receiver only
  accepts the next expected sequence; an out-of-order direct arrival is HELD, and the missing
  in-between message is fetched from the relay mailbox first, then appended in order. This is
  safe because the sender already knows whether each message landed (delivery ack, DOD-MSG-1)
  and parks anything un-acked — so the next message is always fetchable. The old "reserve a slot /
  request resend from sender" machinery is DROPPED — strict in-order prevents the out-of-order
  arrival, so there is nothing to repair. The only unfetchable case (sender crashed before ack OR
  park) is true loss → DOD-MSG-8.
  **LANDED 2026-06-22 (gate + witness):** the receiver gate is built and UNIT-PROVEN
  (`core/daemon/src/__tests__/msg-001-strict-in-order.test.ts`): `ingestReceivedContent` holds a
  content frame whose relay-witnessed canonical sequence is ahead of the next expected leaf
  (`#heldContent`), and `#releaseHeld` drains held entries in canonical order once the gap fills —
  leaf index === canonical sequence by construction. The ordering authority is the RELAY, never a
  sender-stamped field (sovereign-node): `onLeafDeliver` feeds `recordWitnessedSequence` the
  `(content_hash → sequence)` binding (1-based relay seq normalized to the 0-based leaf index).
  Held content is NOT acked `persisted` (not durable). The full live suite is GREEN with the witness
  active — j-content 7/7, j-loopback bilateral seal byte-identical root (no regression). cello-client
  `4d8676c`. *(This pass also fixed three j-content fixture lags the DOD-LOOP-1 re-key had silently
  broken — MSG-2/MSG-3 standing-receiver + awaiting-queue agent scoping — caught by the live test.)*
  **DESIGN CORRECTION — self-ordering content frame (Andre, 2026-06-22).** The remaining work is NOT
  a hold/wait policy for a race; it is to RESTORE the intended design where the content stream is
  self-ordering, so the race cannot exist. Today the content frame carries only
  `{ session_id, content_hash, content_bytes, correlation_id }` — no ordering record — so B learns
  the canonical position ONLY from the SEPARATE relay `leaf_deliver` witness stream, and a direct
  frame that beats its witness has no sequence (the source of the content-before-witness race). The
  fix: **the content frame carries the full signed `Structure2`** — the relay's committed ordering
  record `{ sequence_number, sender_pubkey, content_hash, sender_signature, scan_result, prev_root }`.
  B then verifies and orders from the content frame ALONE (the `sender_signature` over the content
  hash is cryptographically verifiable from the frame; `sequence_number` + `prev_root` are the relay's
  committed position), and the `leaf_deliver` witness stream becomes redundant corroboration. There is
  nothing to wait for, so the race is removed BY DESIGN — the pending-witness-buffer / hold-wait
  approach is DROPPED.
  **BUILT + LIVE-PROVEN 2026-06-22 (increments 1–4):**
  (1) ✅ **Relay** returns the full `Structure2` in `hash_submit_ack` (unsigned + PERSIST-012 signed
      shapes). trustless-cello `a6f38c2e`. (1b) ✅ the daemon relay client threads
      `{sequence_number, structure1_cbor, structure2_cbor}` through `SubmitResult`. cello-client `c2d5941`.
  (2) ✅ **Daemon (sender)** stamps `structure1_cbor`+`structure2_cbor` into the DIRECT content frame.
      cello-client `00c4bd7`. *(2b — parked entry carries Structure2 — NOT yet done; see below.)*
  (3) ✅ **Daemon (receiver)** `#recordFrameOrdering` decodes the record, verifies the sender's
      Ed25519 signature over `structure1_cbor`, binds it to the content hash, cross-checks the signer
      is the session counterparty, and feeds the gate the canonical sequence FROM THE FRAME before
      ingest — `session.content.ordering.recorded source:content_frame`. cello-client `00c4bd7`.
  (4) ✅ **Live-proven** (J-CONTENT, the new self-ordering test): A→online-B, B verifies + orders from
      the frame, reads in order; deterministic, no witness-stream dependence. trustless-cello `1332acfd`.
      The hold/release under a genuine gap is proven by the deterministic unit test
      `msg-001-strict-in-order`. Daemon suite 365, j-content 8/8, j-loopback bilateral seal — all green.
  **2b — parked entry self-orders — ✅ DONE + LIVE-PROVEN (cello-client `a42b72d`, tc `c9ac8d8d`).**
  The daemon seals an ORDERING ENVELOPE `[1, content, structure1_cbor|null, structure2_cbor|null]`
  (`encodeParkEnvelope`) instead of bare content — the relay still holds only ciphertext (INV-3). On
  recover, `decodeParkEnvelope` extracts the content + record; if present, `recordOrderingRecord`
  verifies the sender signature and feeds the gate the canonical sequence BEFORE ingest (same path as a
  direct frame, `source:park`) — closing review finding #3. Daemon-only (no relay/interfaces/WAL schema
  change); backward-compatible (bare/old seals fall back to content-only). Live-proven: the J-CONTENT
  recover test asserts `ordering.recorded source:park`; envelope round-trip + fallback unit-tested;
  j-content 8/8, j-loopback, daemon 365 — green.
  **STATUS (all resolved — MSG-4 is ✅; nothing blocks the tag):**
  - **Finding 2 — relay-signed sequence — ❌ DEFERRED (Andre 2026-06-22, "A now, C track").** RESOLVED:
    ship sender-signature ordering (Option A — safe; a lying sender only self-DoSes via root
    divergence), defer the relay-signed verification (Option C). Verifying the relay's committed
    position needs the relay's SIGNING identity plumbed to the daemon + a relay-identity binding — the
    same family as the transport-audit relay-identity gap. Tracked with a named home in the "Deferred
    hardening" roster at the bottom of this DoD; do NOT read this as still-open. The verification that
    IS shipped (sender signature + counterparty cross-check + hash-bind) is adversarially tested
    (`msg-001-strict-in-order.test.ts` — bad_signature / wrong_signer / hash_mismatch; teeth proven by
    neutering the checks → red).
  - **Auto-recover-on-reconnect — ✅ DONE + LIVE-PROVEN (cello-client `2dd84bd`, tc `a74adbb2`).**
    Found a real PRODUCTION GAP: `content_park_recover` had ZERO production callers — nothing pulled a
    recipient's store-and-forward mailbox, so parked content was never delivered outside tests. Now the
    agent-online hook (`cello_start_agent`) auto-drains the mailbox from every relay the agent has
    sessions on (`getAgentRelayEndpoints` → `recoverParkedFromRelay`), symmetric to the SENDER's
    `flushAwaitingContent`. Live-proven: B reads a parked message on reconnect with NO explicit recover
    call (`content.recover.auto.completed`). Also fixed a dedup miscount (dedup now returns
    `appendedCount: 0`). j-content 9/9, daemon 366.
  - The offline-gap-hold LIVE scenario stays UNIT-proven (deterministic); a live version is flaky
    because direct redelivery to a freshly-RESTARTED peer depends on session reconnection timing, not
    the gate — not worth a flaky enforcer.
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
  DB-003)* — ✅ **PROVEN LIVE** (J-CONTENT, 2026-06-22; `cello-done-auditor` EARNED —
  ran the test cold against the shipped binaries, falsified four ways). DB-003 is the
  irreducible case strict-in-order (DOD-MSG-4) cannot recover, and the AC states verbatim
  "No new test obligation beyond AC-011 (recovery-exhausted keeps session alive) and the
  dedup/sealed-session guard in AC-012/AC-011" — the mechanisms already exist, so this is a
  live-test unit proven by THREE pillars:
  (1) **post-seal straggler rejected (AC-012, the otherwise-unasserted half — proven here):**
  A↔B seal bilaterally (sealed_root byte-identical); a VALID straggler parked for the sealed
  session is recovered by B → `content.recover.ingest_failed reason:session_committed`,
  recovered:0, and B's `content_frontier_seq` + the sealed root are READ from the certificate
  and asserted UNCHANGED (the rejected straggler cannot inflate the frontier or re-enter the
  transcript). Teeth: neuter the sealed-session guard → the straggler recovers (recovered:1) →
  red. (2) **recovery-exhausted keeps the session alive (AC-011):** DOD-MSG-7 — an unrecoverable
  parked entry never lands, session stays alive, frontier excludes it. (3) **honest per-party
  frontier from signed leaves:** J-LEGIBILITY — DISTINCT per-party `content_frontier_seq`
  derived only from each party's own signed leaves, so a message a party never signed for
  cannot appear in its frontier. The truly-deterministic "committed-hash-but-content-never-
  received" repro needs a fault-injection seam the binary harness doesn't expose; rather than
  fake it, the three live tests together pin DB-003 (exactly the AC's AC-011 + AC-012).

### Unilateral seal → real notarization (SESSION-002)

- **DOD-SEAL-1 — Verify reported root.** Directory rebuilds + verifies the root
  from the signed-leaf chain; rejects `unilateral_root_unverifiable` /
  `unilateral_leaves_unavailable` / `unilateral_seal_leaf_invalid`. Stops trusting
  `reported_root`. *(SESSION-002 AC-001..004, SI-001)* — 🟢 **PROVEN LIVE** (J-UNILATERAL,
  happy path): directory fetches the leaf chain via the new `get_seal_leaves` RPC,
  rebuilds the **content-hash root** (the client-verifiable root — see journal "two roots")
  + verifies the encodeStructure2 chain (sigs/prev_root/causal) + requires exactly one SEAL
  ctrl leaf, then `session.unilateral.leaves.fetched` → `notarized`. The three reject paths
  are implemented + logged but the LIVE adversarial assertions (forged root, etc.) are the
  next increment.
- **DOD-SEAL-2 — FROST notarization, counterparty ABSENT.** Signer = initiator +
  directory threshold; counterparty NEVER a signer, never receives `seal_verified`;
  single-key fallback pre-DKG; persisted signed append-only upgrade-ready
  `SealNotarization`, `close_type SEAL_UNILATERAL`, counterparty `ABSENT`. *(SESSION-002
  AC-005..008, SI-002)* — 🟡 FROST-with-B-ABSENT + signed durable `SealNotarization` +
  `session.unilateral.notarized` (present/absent pubkeys) PROVEN LIVE; B never signs/never
  gets `seal_verified`. The `close_type='SEAL_UNILATERAL'` + `conversation_attestations`
  'ABSENT' discriminator rows are NOT yet written — that 3-table write does not exist for
  bilateral either; it is upgrade-readiness coupled to DOD-UP-1 (Tier-4, deferred).
- **DOD-SEAL-3 — Verifiable certificate, channel-independent.** Confirm/notify
  frames carry the full cert; client rebuilds the canonical TBS and verifies the
  signature against an independently-trusted key; a channel-swapped `sealed_root`
  is rejected. *(SESSION-002 AC-009/010/011, SI-003)* — 🟢 PROVEN LIVE (present-party half):
  `seal_unilateral_confirmed` carries the full `SealCertificate`; the daemon's
  `verifyUnilateralCertificate` rebuilds `buildSealTbs` + verifies the FROST sig vs the
  agent's own primary_pubkey BEFORE sealing (`session.unilateral.certificate.verified`).
  The adversarial channel-swap REJECT (SI-003 / AC-011) + the absent-party notification
  half are the next increment.

### Session-path liveness (SESSION-003)

- **DOD-LIVE-1 — Liveness on the session-carrying component, never the directory.**
  Relay is the authority for relay-path (acts on onPeerConnect/Disconnect, not
  log-only; `session_liveness_query/response`); peer↔peer session node is the
  authority for direct (client acts on onPeerDisconnect + transport keepalive).
  *(SESSION-003 AC-001..005, SI-002)* — 🟢 **PROVEN LIVE**: the parked relay liveness
  authority (orphaned `9832b1e`) is grafted + green (own test 5/5) — `recordRecipientAlive/Gone`
  keyed by the recipient's authenticated standing relay stream, `gone` only on a positively-
  observed disconnect. The directory consults it via a `get_session_liveness` directory-relay
  RPC at seal time (NOT the directory self-observing). The daemon `#sessionLiveness` direct half
  remains in main for the direct-authority case.
- **DOD-LIVE-2 — The ABSENT gate.** `gone → ABSENT`, `alive → DELIVERED`,
  `unknown → DELIVERED` (fail-safe). Alive-but-silent (busy) is NEVER sealed ABSENT;
  ABSENT requires a POSITIVE connection-gone observation; relay-path ABSENT must come
  from the relay, not self-asserted. *(SESSION-003 AC-006..010, SI-001/003/004)* — 🟢
  **PROVEN LIVE** (J-UNILATERAL DOD-LIVE-2, both cases): kill B → relay observes the
  disconnect → directory queries relay → ABSENT; B alive-but-silent → DELIVERED, never ABSENT.
  The seal ALWAYS completes (timeout-driven); liveness only colours the attestation
  (`session.unilateral.attestation` + `notarized` carry `attestation:ABSENT|DELIVERED`).
  KNOWN LIMITATION: `attestation_mode` is carried in the cert but NOT bound in the seal TBS,
  so a channel attacker could flip ABSENT↔DELIVERED in the delivered copy without breaking the
  signature; the authoritative record is the directory's server-side notarization. Tamper-binding
  the attestation in the TBS is a DOD-LEG hardening follow-on.
- **DOD-LIVE-3 — No agent heartbeat.** Liveness is connection/node-level only;
  `last_seen_seq` is the sole engagement signal; DELIVERED is never promoted to
  CLEAN/FLAGGED by a liveness signal. *(SESSION-003 AC-011)* — 🟢 satisfied by construction:
  the authority is the relay's standing-connection observation / the peer↔peer node's
  onPeerDisconnect (connection-level), never an agent-level heartbeat.

### Seal certificate legibility (SESSION-004)

> ✅ **INTEGRITY CLOSED (legibility-TBS-binding, 2026-06-22, Andre-approved option A).** The legibility
> object is now BOUND into the FROST-signed seal TBS: the signed bytes are `buildSealTbs(...) ‖
> SHA-256(canonicalLegibility)`. So `final_message.answered`, `content_frontier_seq`, and
> `attestation_mode` are covered by the signature — a MITM tampering them breaks it. The directory binds
> the hash and verifies it; the daemon co-signs the same bound TBS; the INITIATOR verifies the bound cert
> live against its own primary (a tampered legibility → REJECT). A unit test proves the hash covers every
> tamperable field; j-legibility + SPINE-7 prove valid seals verify and that the directory/daemon hashes
> agree. BOTH PARTIES now verify the bound legibility LIVE: the initiator against its own primary, and
> the RESPONDER against the initiator's primary which it stores from the FROST-signed SessionAssignment's
> `signer_pubkey` (j-legibility asserts the responder logs `signature.checked verified:true`). This
> unified the deferred attestation_mode-TBS-binding item; DOD-LEG-2's client re-derive guard is now
> superseded (the signature IS the verification). NO remaining follow-on — the integrity gap is fully
> closed (live + out-of-band, both parties).

- **DOD-LEG-1 — Receipt-not-assent, first-class.** Cert carries `attests:'receipt'`,
  `implies_assent:false`, plain-language disclaimer; no field parseable as agreement.
  *(SESSION-004 AC-001, SI-001)* — 🟢 **PROVEN LIVE** (J-LEGIBILITY, 2026-06-21). The directory
  derivation grafted onto the REAL processSeal (single + FROST paths), carried on the
  `session_sealed` frame; the daemon (Option A — `registerSessionSealedListener`, NOT the dead
  seal-manager) surfaces + persists it (inline SQLite ALTER, no Flyway) and exposes it via
  `cello_get_sealed_receipt`. Live malicious-tail bilateral seal → B's daemon reads the cert from a
  DIFFERENT process: `attests:'receipt'`, `implies_assent:false`, disclaimer present, no content echo.
- **DOD-LEG-2 — Per-party content frontier.** `content_frontier_seq` (max signed
  `last_seen_seq`) + `last_authored_seq` per party, derived only from that party's
  signed leaves; client re-derives and rejects `certificate_frontier_unverifiable`
  on an inflated published frontier. *(SESSION-004 AC-002/005, SI-002)* — 🟡 **DERIVATION + SURFACING
  PROVEN LIVE** (J-LEGIBILITY): per-party `content_frontier_seq` + `last_authored_seq` derived from each
  party's OWN signed leaves (directory), carried on the cert, surfaced by B's daemon — live cert shows
  DISTINCT per-party frontiers (A=2, B=3). REMAINING: the client-side SI-002 re-derive guard (reject
  `certificate_frontier_unverifiable` on an inflated published frontier) is the one distinct sub-line not
  yet built — a focused follow-on. (The asymmetric-frontier DERIVATION is unit-proven, AC-002.)
- **DOD-LEG-3 — Live/recovered/absent marker.** `attestation_mode` per party,
  always exactly one of the three. *(SESSION-004 AC-003)* — 🟢 **PROVEN LIVE** (J-LEGIBILITY): both
  parties' `attestation_mode` = 'live' in the contemporaneous bilateral seal, surfaced on B's cert read.
  ('absent' is set by the SESSION-002 unilateral path on its own cert; 'recovered' by Workstream C.)
- **DOD-LEG-4 — Final-message-answered.** The malicious tail ("…you agreed to send
  me $1000") reads as `final_message.answered:false`, delivered-but-unanswered,
  never agreed. All four interruption cases legible. *(SESSION-004 AC-004/006/007, SI-001)*
  — 🟢 **PROVEN LIVE** (J-LEGIBILITY): live malicious tail → cert `final_message{sender=A, answered:false}`,
  B's frontier REACHES the tail (delivered) yet answered stays false — the DELIVERED-BUT-UNANSWERED
  shape, read cross-process. AC-007's four interruption cases are unit-proven (parameterised); AC-006c's
  strict "tail NEVER received" frontier-exclusion is the present-party-sealed-tail variant (unit-proven
  AC-002; a live present-party-sealed-tail case is a candidate follow-on — see journal deferred ledger).

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
  — 🟢 **PROVEN LIVE** (J-UPGRADE, 2026-06-22). B's daemon auto-co-signs on ingesting the
  counterparty's SEAL ctrl leaf (the live `onLeafDeliver` path) — A closes, B's agent issues NO
  close call, B's NODE auto-acks (`session.seal.autoacknowledged`) → BILATERAL seal completes with a
  byte-identical sealed_root (not a unilateral fallback). SI-001: B's leaf is signed by B's own
  K_local (reuses `submitSealLeaf`); SI-002 verifiability gate: a `content_hash_mismatch` (tamper) →
  `#contentDesynced` → skip + `session.seal.autoack.skipped` (disagreement is NOT a gate failure).
  Idempotent (synchronous `#responderSealSubmitted` guard in submitSealLeaf — no double-submit in the
  both-close race). `counterparty_closing` is informational by construction (no daemon-side
  instruction exists on the live path). INTERACTION: this SUPERSEDES the old DOD-LIVE-2 "alive B +
  silent agent → unilateral DELIVERED" outcome — an alive+verified B now auto-acks to bilateral; the
  invariant "an alive B is never sealed ABSENT" is preserved more strongly (B SIGNED). The j-unilateral
  alive-but-silent test was updated accordingly. The MSG-001-3b note is moot — UPGRADE-002 needs only
  the cross-check (a tamper flag), not full canonical reconciliation.

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
  (INV-2). No wire/directory/relay change. *(**CELLO-M7-SESSION-CORE-REKEY-001**)* — ✅ DONE,
  LIVE-PROVEN. j-loopback.spine.test.ts is GREEN against the real binaries: A↔B converse on ONE
  daemon, exchange a message, BOTH close → bilateral FROST seal, byte-identical sealed_root, no
  2nd daemon. The re-key covers the 7 in-memory maps + sessions/session_tree_leaves/
  seal_interrupted_artifacts composite PKs + the retry-queue awaiting path + the daemon-level seal
  bookkeeping (sealInterruptedInProgress, pendingSealWaiters) + the ownership/double-accept guards.
  Daemon unit suite 361 green. (Follow-ons, non-blocking: the existing-DB rebuild migration for
  upgrading an operator's old single-key DB — fresh DBs already use the composite schema; and
  full `(agent, session_id)` scoping of the direct-retry queue + nonce-dedup store, not exercised
  by the loopback happy path.)

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
  encrypted transcript; closes the daemon at-rest encryption gap) — ❌ NOT BUILT; and J-LOOPBACK
  (SESSION-CORE-REKEY-001 — two agents on one daemon) — ✅ DONE + LIVE-PROVEN 2026-06-22 (DOD-LOOP-1,
  j-loopback GREEN; bilateral seal, byte-identical root, no 2nd daemon).

### Deferred hardening (RC-1: named target, not silent)

- **DOD-MSG-4 Finding 2 — relay-signed sequence verification** — ❌ DEFERRED (Andre 2026-06-22).
  MSG-4's AC is met with sender-signature ordering (safe — a lying sender only self-DoSes). Verifying
  the RELAY's committed sequence (so a sender cannot mis-sequence at all) needs the relay's SIGNING
  identity plumbed to the daemon and a relay-identity binding (B must know its session relay's expected
  signing pubkey, not just its peer id). This is the SAME family as the transport-audit HIGH gap.
  **Named target / home:** the relay-identity hardening scoped in
  `discussion_logs/2026-06-11_0822_transport-security-audit-and-libp2p-primitives.md` ("client trusts
  relay for sender identity" + the connectionGater/peer-allowlist story list). Finding 2 is appended to
  that scope so the two are built together. A story is the next durable step when that hardening is
  scheduled — to be written via `/cello-story` on Andre's go (do NOT auto-create). The
  `cello-done-auditor` + the close gate below enforce that this line cannot be silently dropped.

M7 is done when journeys J-SPINE through J-LOOPBACK are green against the real
binaries, every Tier-0 invariant holds, and every Tier-4/5/6 item AND every Deferred-hardening item is
built or explicitly carried to a named future milestone/story (not silently deferred — that is RC-1).
