---
name: M7 Daemon-Migration Audit & Session Handover
type: handover
date: 2026-06-17
topics: [m7, daemon, cello-client-stranding, migration-ledger, audit, option-a, registration, signaling-wiring, handover]
status: open
description: >
  Durable handover for the 2026-06-17 session. Captures the grounded M6→M7 history, the
  systemic finding (M7 re-platformed only a slice of CelloClient into the daemon; the
  thin-proxy switch orphaned the rest), the four-auditor gap synthesis with file:line
  evidence, an accuracy ledger of what is verified vs what was earlier mis-stated, the
  work committed this session, the workflows still running, and the open decisions. Read
  this BEFORE acting on M7 daemon scope.
---

# M7 Daemon-Migration Audit & Session Handover (2026-06-17)

## 0. TL;DR — the one-sentence finding

**M7 was a deliberately narrow re-platforming of the transport/session layer into a daemon, but it also turned `cello-mcp` into a thin IPC proxy — so the in-process `CelloClient` stopped being the production server, orphaning every M6 capability M7 didn't explicitly re-home (registration client-side, connections, M3 trust policy, relay-ACK hash chain, content/seal/tree). The daemon also ships without its directory-trust wiring (signaling/manifest never passed to `startDaemon`), so even the merged transport/session stories are non-functional end-to-end in production.** This is not a cluster of bugs — it is one scope-vs-blast-radius mismatch, plus one missing composition-root wiring.

---

## 1. Grounded M6→M7 history (read from the actual docs — not inferred)

Sources read this session: `milestone-writeups/M6-beta-launch.md` (lines 1–504), `milestone-writeups/M6B-beta-hardening.md`, `user-stories/m6/E2E-001-findings.md`, `milestone-writeups/M7-daemon-architecture.md`, `user-stories/m7/outline.md` (Why + Scope Boundaries). Primary design doc NOT yet read: `discussion_logs/2026-06-11_1030_daemon-transport-architecture.md` (cited as "supersedes all prior transport assumptions") and `transport-security-audit-and-libp2p-primitives` — read these next for the authoritative daemon-scope intent.

- **M6 (Beta Launch, closed 2026-06-10)** built the full protocol on the in-process `CelloClient`. The onboarding flow (confirmed by Andre and by OPS-AGENT-001/002):
  1. **Operations Agent (Telegram bot)** verifies phone+email → issues a **pre-authorization token** (`CELLO-` + 33 base58 chars). *This token is the "ephemeral cello key."*
  2. Operator's **client** calls `cello_register` with the token → runs the **client side of FROST DKG** (`client.register()` → `runNetworkDkg` → dkgRound1/2/3) against the **directory**, which consumes the token and completes the ceremony. *This is "plop the key in your client → generate address → register."*
  - Three moving parts: **bot issues token · client runs DKG · directory gates+completes.** Bot side and directory-DKG side are LIVE in production. The CLIENT side lives in `CelloClient`.
- **M6B (Hardening)** refactored the 6,198-line `client.ts` into 11 manager classes (`registration-manager.ts`, `session-manager.ts`, `seal-manager.ts`, `relay-stream-manager.ts`, …). **These manager files are exactly what is now stranded.**
- **M7 original (archived in `m7-archived/`)** assumed one `CelloClient` per agent with a persistent libp2p node.
- **Transport security audit (2026-06-11)** killed that model on **three** grounds: (1) DDoS/unlinkability from persistent per-agent Peer IDs → ephemeral session nodes; (2) multi-session concurrency → daemon required; (3) directory-trust gap (handshake steps 5–6 never built).
- **M7 current** = daemon + ephemeral session nodes. `outline.md` **Scope Boundaries** scope it to: daemon process/IPC, CLI, MCP thin-proxy rewrite, ephemeral session nodes, SessionAssignment wire format, AutoNAT/direct-P2P, **application-level delivery receipt (explicitly in-scope)**, interrupted-session handling, signaling resilience, nonce/retry rehoused, manifest schema+verification+polling, cross-repo CI/CD, the E2E gate. **NOT listed in scope:** registration, connection establishment, M3 trust policy, relay-ACK hash chain. Only "portal/UI" and "Flyway migrations" are under explicit "NOT in scope."

---

## 2. The dead stack vs the live stack (verified)

- **DEAD (M6 in-process `CelloClient`)** — `core/client/src/`: `client.ts` (`CelloClientImpl` at :602), `session-manager.ts`, `seal-manager.ts`, `relay-stream-manager.ts`, `registration-manager.ts`, `network-directory-node.ts` (DKG), `connection-manager.ts`, `connection-inbound-handler.ts`, `connection-policy.ts`, `agent-hash-queue.ts`, `client-backup.ts`, etc.
  - **Reachability proof:** `new CelloClient*` appears only in `client.ts` (+ ignored worktrees). `createClient`/`createMcpServer` are exported (`index.ts`, `adapter-claude-code/src/server.ts:88` — type-only import, erased) but wired to **no shipped binary**. The only shipped bin is `cello-mcp` (thin stdio→IPC proxy, no keys/DB). `core/daemon` has **no `@cello-protocol/client` dependency** and imports none of those files.
- **LIVE (M7 daemon)** — `core/daemon/src/`: `daemon.ts` (`startDaemon`), `session-node-manager.ts`, `retry-queue.ts`, `nonce-dedup.ts`, `session-connection-gater.ts`, `bin/cello-daemon.ts`.
- **LIVE (server-side, trustless-cello)** — directory (`processSeal`/FROST notarization, DKG handler, pre-auth gate), relay (`relay-store.ts`, `session_interrupted` emit), all genuinely wired.

---

## 3. The four-auditor gap synthesis (evidence-backed; the valuable mined data)

Four parallel read-only auditors (stubs / stranded-capabilities / test-seam-ACs / wiring-gaps) **converged** on one keystone. Deduped + severity-ranked + scope-judged:

### KEYSTONE (confirmed by all 4 auditors)
**The shipped daemon binary wires almost nothing.** `core/daemon/src/bin/cello-daemon.ts:46` calls `startDaemon({celloDir, socketPath, lockFilePath, maxConnections, version, logger})` — omitting `signalingConnect`, `manifestProvider`, `manifestVersionStore`, `manifestPollScheduler`, `challengeVerifier`. So `daemon.ts:267` `defaultConnect` always throws `directory_signaling_not_configured`; `signalingManager.start()` is never called (only `ipcServer.start()` at ~:1143). Consequences:
- **Merged SIGNAL-001 + MANIFEST-002 are inert in production** — real code, never wired.
- **Merged SESSION-001 can't deliver** — its seal-interrupted flow calls `signalingManager.sendRaw()` (`daemon.ts:697,756,894`), which can't connect. *(Right stack, NOT wired.)*
- **Blocks DAEMON-004's seal ceremony and E2E-001.** **No story owns this wiring.**

### BLOCKING — genuine M7-scope gaps
- **Session tools are blanket stubs:** `daemon.ts:500` — `cello_send/receive/receive_session/initiate_session/await_session/list_sessions` share one `not_implemented` handler; active `cello_close_session` stubbed at `daemon.ts:583` (only interrupted-seal path `:567` works). *Being addressed by DAEMON-004 + in-flight worktrees, but depend on the keystone.*

### NEEDS A SCOPE DECISION — stranded, but OUT of M7's declared scope (don't auto-treat as bugs)
- **Registration client-side + FROST DKG** — `registration-manager.ts:78`, `network-directory-node.ts:85/132/181`. No daemon handler, no `cello_register` tool, no CLI register command (CLI is login/logout/status only; `agent-loader` only loads existing keys). **Bot + directory-DKG sides are LIVE; the CLIENT side is stranded.** A NEW operator can get a token but the shipped daemon/MCP can't consume it. *(See §4 accuracy note — I flip-flopped on this.)*
- **Connection establishment + M3 report-card trust policy** — `connection-manager.ts`, `connection-inbound-handler.ts:52`, `connection-policy.ts:183+`. No daemon path; daemon's `SessionConnectionGater` is a libp2p peer-id allowlist, NOT the trust layer.
- **Relay-ACK validation + tamper-evident hash chain** — `agent-hash-queue.ts:249/289`. DAEMON-004 covers the session Merkle tree; the ACK-chain piece needs a home.

### MEDIUM — genuine
- **MCP-002 push notifications dropped at the adapter:** `core/adapter-claude-code/src/ipc-proxy.ts:179-181` explicitly discards notification frames (`// skip for now`); `bin/cello-mcp.ts` registers no listener. Daemon-side `NotificationDispatcher` IS wired (`daemon.ts:1150`); the consumer half is dead. Small fix.
- Manifest polling/verification bypassed (subset of keystone): `daemon.ts:1188` `TODO(SIGNAL-001)`, `FileManifestProvider`/`FileManifestVersionStore`/`RandomizedPollScheduler` never constructed (zero `new` outside tests). Directory-side `DirectoryManifestStore`/`DirectoryKeyProvider` also not wired in `bin/directory.ts` (only Test* impls exist).
- Gap-fill reconciliation (`seal-manager.ts:55`), client backup/restore (`client-backup.ts:165/255`) stranded.

### Cross-cutting symptom (auditor #3) — why it all passed review
ACs claim production behavior; tests satisfy them via internal-method seams / injected fakes:
- DAEMON-002 AC-001/003/018: `createSessionNode` has **zero callers in daemon.ts**; tests call it directly; `core/daemon` has **zero `SessionAssignment` references** (parsing stranded in `core/client`).
- DAEMON-003 AC-001/002 (the reference bug): `RetryQueue.drainSession(sendFn)` (logs `message.retry.delivered`) has **no production caller**; integration test only drives enqueue+metadata via `queue_failed_send`/`drain_session`.
- SESSION-001 AC-008: claims FROST seal + `status:'sealed'`, but `daemon.ts:792-823` stops at `seal_interrupted_pending` (no FROST signer) and its **own test asserts `status ≠ 'sealed'`** (`session-001.test.ts:887-896`).
- DAEMON-001 AC-005 (`verifiedCount/staleCount/goneCount` hardcoded 0, `connections` always `[]`), MANIFEST-002 polling, MCP-002 `session_created` (test-only via `__test_emit_session_event`).

### NOT gaps (expected — do not chase)
- Scanning/redaction pipeline absent (`relay-stream-manager.ts:621` hardcodes `scan_result:{verdict:"unscanned"}`) — **M8/M9 by design.**
- `cello_get_sealed_receipt`/`inclusion_proof`/`backup`/`restore` stubs — no M7 story implements them.
- `InMemoryDirectoryStore` checkpoint methods throw — local stub adapter, not production.
- Dead `mcp-server.ts:1335` stub — dead CelloClient, to be retired.
- `SESSION_NODE_KEY_STUB` (`daemon.ts:118`) — intentional no-op; session nodes use fresh transport keypair.

### Genuinely wired/correct (verified — not findings)
Agent lifecycle (`cello_start_agent/stop/use/list`, `daemon.ts:375-456`), per-connection multiplexing, daemon `NotificationDispatcher`, `SessionNodeManager`, `RetryQueue`, `NonceDedupStore`, `SessionConnectionGater`; directory FROST seal notarization (`processSeal`, `directory-node.ts:2808`), relay `session_interrupted` emit + delivery queues, DIR-PING-001 ping/pong, MANIFEST-001 TUF crypto, CICD-001.

---

## 4. Accuracy ledger — what is verified vs what I (the assistant) mis-stated earlier

**Verified (file:line evidence, trust these):** §2 reachability, §3 keystone + stubs + wiring gaps, the registration flow in §1.

**Earlier errors to NOT propagate:**
1. I first said registration is "purely the bot's job, downgrade it" → **WRONG.** Corrected: bot+directory-DKG are live, but the **client side is stranded.** Then re-verified (no `cello_register`, no register CLI command, `createMcpServer` wired to no bin). Net: real orphan, but out of M7's declared scope.
2. I said "SESSION-001 is correctly on the live daemon stack ✅" → **imprecise.** It IS on the daemon (not the dead client), but it is **NOT wired** (signaling missing from the binary), so non-functional end-to-end.
3. I inferred "the peer-ID gap drove M7" → **incomplete.** It was THREE grounds + an archived original M7 (§1).
4. My first stack-correction audit (the keyword `git grep` counts) was **directional evidence, not line-level proof.** The four-auditor pass is the grounded version.
5. Some of auditor #2's "9 BLOCKING stranded" are NOT M7-scope bugs — they are out-of-scope orphans (§3 "needs a scope decision"). Do not present them as blocking M7 without the scope call.

---

## 5. Work COMMITTED this session (trustless-cello main, PUSHED to origin)

- **`0d86b9e`** — wrote **`CELLO-M7-DAEMON-004.yaml`** (Option A foundation: daemon owns the per-session Merkle tree + active-session send/receive + active-session seal; re-homes content/seal/tree off the dead stack; stub-resistant cross-process E2E ACs; SI-002 dead-stack-retirement grep gate; SI-003 counterparty-ack-is-own-node). Added `STACK CORRECTION (2026-06-17)` blocks + `blocked_by: CELLO-M7-DAEMON-004` to **MSG-001, SESSION-002, SESSION-003, SESSION-004** (each keeps its LIVE half, re-homes its client half).
- **`0f72ea7`** — COORDINATION.md (Story Ownership rows for DAEMON-004 + the four; Blocked/Waiting; dated Log entry) + WORKLOG.md dated entry.
- **Decision confirmed by Andre: Option A** — the daemon owns the session core (tree + send/receive + active-seal); NOT a hosted `CelloClient` (Option B rejected). Consistent with DAEMON-003 having already removed RetryQueue/NonceDedup from `core/client`.
- cello-client main: `9fcb2bf` (unchanged). Nothing merged on any story branch.

---

## 6. Work RUNNING (background workflows — may have completed by next session; check `/workflows` and branch state)

- **DAEMON-004** implementation — `wf_64f7f06e-62d` (Task `w7vrc8xq0`). Decomposed into: SessionTree module → tree persistence/restart → active-seal init → cello_send dead-channel + receive → SI-002 grep + E2E_LIVE + gates. **CAVEAT: its seal ceremony depends on the keystone (signaling wiring) which is NOT done — so its seal ACs may not pass live until the keystone story lands.**
- **TRANSPORT-001** implementation — `wf_77098eed-283` (Task `wzt30wgct`). AutoNAT + direct-P2P transport selection. Nearly through gates (AutoNAT service, ITransportSelector, composition-root wiring done; lateral-catch audit + final gates remaining). Clean — not on the dead stack, unblocked.
- **Standing rule: max 2 concurrent implementation workflows.** Both slots are full. Audits run as Agent subagents (don't count).
- **Orchestrator NEVER merges/pushes story branches** — review + update COORDINATION/WORKLOG, leave branches for Andre.

---

## 7. OPEN decisions & next steps (priority order)

1. **Build the migration ledger** — `CLIENT-TO-DAEMON-MIGRATION-LEDGER.md`: every `core/client` capability classified as **Migrated** / **In-flight** / **Built-but-unwired (keystone)** / **Stranded-no-home** / **Lives-elsewhere (bot+directory)** / **Future (M8/M9)**. Seed from §3. This becomes the M7 close gate (M7 can't close while any capability is unaccounted-for). The 4 audits are the raw inventory.
2. **Write the KEYSTONE story** — wire the daemon production composition root in `bin/cello-daemon.ts`: `signalingConnect` (the real directory handshake), `FileManifestProvider`/`FileManifestVersionStore`/`RandomizedPollScheduler`, `challengeVerifier`, + directory-side `DirectoryKeyProvider`/`DirectoryManifestStore` in `bin/directory.ts`. This resurrects SIGNAL-001 + MANIFEST-002, makes SESSION-001 deliver, unblocks DAEMON-004's seal, and is a hard prerequisite for E2E-001. **Arguably higher priority than DAEMON-004 itself.**
3. **Decide registration client-side fate** — re-home `cello_register`/`client.register()`/DKG into the daemon, OR confirm onboarding runs the in-process client elsewhere (e.g. ops-agent on EC2) so it's not a daemon responsibility. This determines whether new operators can onboard in the daemon era.
4. **Decide connections + M3 trust policy** — migrate to daemon in M7, or defer to a later milestone (they're out of M7's declared scope).
5. **Small fix:** forward notifications in `ipc-proxy.ts:179-181` (MCP-002 push half).
6. **Run E2E-001 live early** as the close gate — the only thing that catches the test-seam class (postmortem P-2).
7. Read `discussion_logs/2026-06-11_1030_daemon-transport-architecture.md` to confirm the authoritative intended daemon scope before finalizing the ledger.

---

## 8. Standing operational rules (preserve verbatim)
- Two implementation workflows max concurrently. Orchestrator never merges/pushes story branches. Never push Docker images from local.
- Workflows: invoke via `scriptPath` (never `name` — stale). `args` arrives as a JSON string (workflow JSON.parses it). Default model is Opus 4.8; the workflow forces `model:'opus'` on coder/reviewer (omitting falls to a pinned Sonnet for some agentTypes). Vitest: one worker per process (`--pool-options.threads.maxThreads=1`), ~4 concurrent OK.
- Pushing trustless-cello main triggers the ~25–30 min directory/relay deploy ONLY for changes under deploy paths (`packages/`, `infra/`); docs-only pushes are safe. Batch before pushing code.
- Cross-repo: `@cello-protocol/*` referenced by pinned semver in trustless-cello, never `workspace:*` (except `interfaces`).
- Use `@CelloConnectStagingBot`, not production. Alpha — no production-safety hedging on code fixes; live-grenade caution is for AWS deploy ops only.
- Story review = `cello-sprint-reviewer` agent (not a workflow). Do NOT add a post-fix confirmation review round (rejected as token-burning). `maxRounds` default 2.

---

## 9. Evidence map (the file:line anchors worth keeping)
- `core/daemon/src/bin/cello-daemon.ts:46` — minimal `startDaemon` call (keystone root).
- `core/daemon/src/daemon.ts`: `:118` key stub (intentional), `:263` connections always `[]`, `:267-273` defaultConnect throws, `:375-456` agent lifecycle (LIVE), `:500` session-tool stub, `:567` interrupted-seal (LIVE-but-unwired), `:583` active-close stub, `:593` backup/receipt stubs, `:629-637` drain_session metadata-only, `:792-823` seal stops at pending (no FROST), `:1150` NotificationDispatcher (LIVE), `:1188` manifest poll deferred.
- `core/adapter-claude-code/src/ipc-proxy.ts:179-181` — notifications discarded.
- `core/client/src/`: `registration-manager.ts:78`, `network-directory-node.ts:85/132/181` (DKG), `connection-manager.ts`/`connection-inbound-handler.ts:52`, `connection-policy.ts:183+`, `agent-hash-queue.ts:249/289`, `seal-manager.ts:55/280/690`, `session-manager.ts:589-624`, `relay-stream-manager.ts:461-478/621/683-689/805-839`.
- Story specs: `docs/planning/user-stories/m7/` — `CELLO-M7-DAEMON-004.yaml` (new), MSG-001/SESSION-002/003/004 (stack-corrected), `outline.md` (Why §21, Scope Boundaries §126), `POSTMORTEM-seal-and-content-delivery-gaps.md`, `E2E-001` (AC-005 is the send gate).
