---
name: M7 — Daemon Architecture & Ephemeral Session Transport
type: milestone-writeup
date: 2026-06-12
updated: 2026-06-27
milestone: M7
status: closed — E2E proven live; Stage-1 (relay transport) operational; per-agent connections live (CONN-001)
description: >
  M7 delivered the daemon architecture for CELLO's client: a long-running process that
  holds all agent identities, all active sessions, and the directory-facing connections.
  The milestone went through three distinct phases: a healthy story-by-story start,
  a collapse caused by dead-stack orphaning and branch sprawl, and a disciplined
  live-binary rebuild that delivered more than the original scope. This writeup covers
  all three phases, the bugs found, and the process lessons.
---

# M7 — Daemon Architecture & Ephemeral Session Transport

**Started:** 2026-06-11
**Collapsed to ground truth:** 2026-06-18
**Rebuild phase closed:** 2026-06-23 (substantive) / 2026-06-27 (CONN-001 deployed live)
**Published (npm, latest):** daemon 0.0.13, cli 0.0.11, connect 0.0.49

---

## What M7 Was Supposed To Be

The original outline specified thirteen stories across four tracks:

- **Daemon + transport:** DAEMON-001 (IPC socket, CLI), DAEMON-002 (ephemeral session nodes), DAEMON-003 (retry queue + nonce dedup), MCP-001 (adapter rewrite), MCP-002 (agent-aware notifications), WIRE-001 (SessionAssignment wire format), SESSION-001 (interrupted session handling), TRANSPORT-001 (AutoNAT + direct P2P), SIGNAL-001 (signaling resilience), DIR-PING-001 (directory-side ping handler)
- **Security:** MANIFEST-001 (manifest schema + key ceremony), MANIFEST-002 (client verification + handshake step 6)
- **CI/CD:** CICD-001

Close gate: two Claude Code sessions simultaneously via IPC, two agents exchanging messages over ephemeral session nodes, direct P2P default, signaling resilience verified, directory bidirectional auth (steps 5–6), manifest polling.

---

## Phase 1 — Healthy story-by-story progress (June 11–14)

The first phase went well. About twelve stories were written, implemented, reviewed, and merged in order: DAEMON-001/002/003, MANIFEST-001/002, MCP-001/002, SIGNAL-001, WIRE-001, SESSION-001, DIR-PING-001, CICD-001. The per-story process (SPARC → sprint-coder → code-reviewer → sprint-reviewer) was being followed. 342 daemon unit tests green, typechecks clean.

**What "healthy" obscured.** Every individual story passed its own ACs, lint, typecheck, and review. None of this verified that the stories composed into a working system. The live multi-process run — which the close gate required — had never happened.

---

## Phase 2 — The postmortem discovery (June 14–15)

Everything changed when someone walked one user journey out loud: *"A is chatting with B. A closes the laptop. B keeps talking. The session times out and seals. What does A actually have when they come back an hour later?"*

That single question surfaced three system-level gaps, each verified against live code:

**Gap 1 — Unilateral seal produces no signed certificate.** `#processSealUnilateral` accepted the submitter's self-reported root on faith (`sealed_root: frame.reported_root` — no tree rebuild, no signature verification). It ran no FROST ceremony, produced no signature, and never wrote a `SealNotarization`. The absent party's notification was unsigned metadata. Contrast with the bilateral seal, which rebuilt the tree, verified the root, and ran a full FROST ceremony.

**Gap 2 — Missed message content is never resent.** Content traveled fire-and-forget with a silent catch. The sender received no delivery signal. When direct P2P failed and the counterparty was offline, content was simply lost — the session was killed instead of the content being queued and redelivered. The circuit-relay fallback was bounded by libp2p's unconfigured 128 KB / 2-minute defaults.

**Gap 3 — Unilateral→bilateral upgrade was half-built.** The intended upgrade flow (absent party returns, ratifies the existing seal, producing a superseding bilateral notarization) depended on recovery that didn't exist: the absent party had no way to receive missed content, and the directory had no machinery to issue a `seal_upgrade_request`.

Two process root causes were named: **RC-1** — deferrals had no named home and evaporated into discussion logs; **RC-2** — verification stopped at the story boundary and nothing owned the end-to-end journey. Every individual story was correct; the gaps lived between stories.

Four remediation stories were spawned: MSG-001 (content delivery: ACK + queue), SESSION-002 (unilateral seal → notarization), SESSION-003 (peer liveness), SESSION-004 (seal certificate legibility).

---

## Phase 3 — Dead-stack orphaning and branch sprawl (June 15–18)

**The problem the four stories caused.** The four were specified and implemented against `core/client` — the in-process `CelloClient` stack (`session-manager.ts`, `seal-manager.ts`, `relay-stream-manager.ts`). But M7 had already turned `cello-mcp` into a thin IPC proxy and moved the live code path into the daemon. No shipped binary constructed `CelloClient`. Implementing the four stories against it meant building correct code on a path nothing ran.

**The architecture decision.** The correct fix: the daemon owns the session core (Merkle tree, send/receive, active seal) — not a hosted `CelloClient`. This decision ("Option A," confirmed with Andre) required new foundation work that wasn't in the original slate: Keystone (wire the daemon to the directory at startup — the shipped binary was booting without dialing it), Registration (re-home `cello_register` + FROST DKG into the daemon), and DAEMON-004 (the daemon session core itself).

**Branch sprawl.** This produced ~14 worktrees and ~15 branches across the two repos. Branches couldn't see each other. Work was redone. The same questions were asked across sessions that had already been answered. The sprawl itself became the bug — entropy increasing with every session.

---

## The Collapse (June 18)

Both repos were collapsed to one ground truth in main and all branches were deleted. The `PRUNE-LEDGER.md` records every deleted branch and its tip hash for resurrection. The choice was deliberate: stop drowning, get to one working base, then pick through.

**What "ground truth" actually meant.** cello-client main at the collapse: 342 daemon tests green, workspace typecheck + lint clean, dead-code gate clean. trustless-cello main: typecheck clean. That was unit/in-process green only. **The live multi-process run — two agents, real directory, real DKG, real conversation — had never happened.** Several DoD lines marked as "BUILT" were built against in-process seams or the dead `CelloClient` stack.

Three artifacts were created to govern the rebuild phase:
- `M7-DEFINITION-OF-DONE.md` — every M7 requirement pulled from all five sources into one ordered list, mapped to 8 test journeys
- `M7-PROCEDURE.md` — the runbook (per-unit loop, severity triage, commit discipline, overnight rules)
- `M7-BUILD-JOURNAL.md` — append-only archaeology; one entry per unit of work (6,133 lines at close)

**The decision: not a from-scratch rewrite.** The daemon/client architecture was right and most of it was once-reviewed. Delete the dead `core/client` in-process stack. Repair and verify the existing daemon under a live binary test, growing the lowest non-green DoD line.

---

## Phase 4 — The live-binary rebuild (June 18–23)

### The harness

`packages/e2e-tests/src/spine/` — a process-spawning E2E harness that spawns the real `cello-directory`, `cello-relay`, `cello-daemon`, `cello-mcp`, and `cello` CLI as child processes on localhost over real TCP/Noise/crypto/IPC. Never constructs nodes in-process. Drives the agent surface only. Asserts DoD lines from observable outputs + relay/directory stdout. Directory-side assertions go via `psqlSpine` against the directory's own Postgres (the daemon cannot fabricate these).

**Anchoring proof (enforced per unit):** `grep -E '^import .*(createClient|createMcpSessionServer|createDirectoryNode|createRelayNode|session-fixture)'` against every spine test file returns zero.

### The ten journeys

| Journey | DoD lines | What it proves live |
|---------|-----------|---------------------|
| **J-SPINE** | SPINE-1..7 | register (real DKG) → connect → converse → bilateral FROST seal, byte-identical root |
| **J-AUTH** | AUTH-1/2 | directory step-6 bidirectional identity auth; consortium manifest; 6–12h manifest poll |
| **J-SIG** | SIG-1 | kill signaling → reconnect to a different directory node → queued ops drain |
| **J-INT** | INT-1/2, RETRY-1 | both parties SIGKILLed mid-session → interrupted → seal-interrupted bilateral agreement; retry queue + nonce-dedup survive restart |
| **J-CONTENT** | MSG-1..8 | content delivery; offline → relay parks ciphertext → recover/decrypt; oversize rejected; replay deduped; tamper desyncs; irreducible-loss kept alive |
| **J-UNILATERAL** | SEAL-1/2/3, LIVE-1/2/3 | A seals while B is GONE → directory rebuilds+verifies the root, FROST-notarizes B ABSENT; relay-observed liveness → ABSENT vs DELIVERED; verifiable cert |
| **J-LEGIBILITY** | LEG-1..4 | receipt-not-assent seal cert; malicious tail reads delivered-but-unanswered; per-party signed frontier re-derive guard (co-sign abort on inflated frontier) |
| **J-PERSIST** | LOG-1 | durable AES-256-GCM-at-rest transcript survives daemon restart; relay/directory never see plaintext (INV-3) |
| **J-LOOPBACK** | LOOP-1 | two of the operator's own K_locals converse on ONE daemon → bilateral seal, byte-identical root, no 2nd process |
| **J-UPGRADE** | UP-1/2 | B online+verified auto-co-signs (UP-2); B KILLED → A unilateral → B returns, recovers+verifies, RATIFIES → superseding bilateral notarization (UP-1) |

---

## Bugs Found During Live Testing

The following bugs were found by the live binary tests. None would have been caught by in-process unit tests or the session-fixture approach.

| Symptom | Root cause | Fix |
|---------|-----------|-----|
| `cello login` crashed: `ERR_PACKAGE_PATH_NOT_EXPORTED` | Daemon's `package.json` `exports` map only exposed `"."`, not `"./package.json"`. The CLI did `require.resolve("@cello-protocol/daemon/package.json")` to find the binary — Node's encapsulation refused it. | Add `"./package.json": "./package.json"` to daemon exports |
| `cello-mcp` failed to connect to daemon | `cello-mcp` hardcoded `~/.cello/daemon.sock`, ignoring `CELLO_DIR`. The daemon and CLI both honor `CELLO_DIR`. This also broke any operator who sets `CELLO_DIR` in production. | `cello-mcp` resolves `CELLO_DIR` identically to daemon/CLI |
| SPINE-1 assertions were tautological | `directory_signaling: connected` gated on a LOADED agent, not a REGISTERED one. `cello status` showed `connected` whether or not a real DKG had run. Test was asserting preconditions, not behavior. | Add directory-corroborated assertion: the test waits for the directory's own auth log to show it authenticated this agent's stream |
| Second agent's registration timed out (30s) | Daemon held ONE signaling stream authed as the primary (keystone). Second agent's `dkg_complete` frame arrived on the primary's stream → directory routed by authed pubkey → no match → pending resolver never fired | Per-agent directory signaling streams: each agent opens and authenticates its own stream |
| Account-link race: `account_id` permanently NULL | Registration INSERTed `agent_profiles` without `account_id`, then UPDATEd via a separate fire-and-forget `linkAgentToAccount`. The UPDATE could run on a different pool connection before INSERT committed → matched 0 rows | Extract `resolveAccountId()` (lookup-or-create the account first); INSERT profile WITH `account_id` atomically |
| Session initiation 30s ceremony_timeout | FROST ceremony participation handler not wired to per-agent signaling streams. The directory sends a `ceremony_request` to the initiator's stream and awaits a `ceremony_result`. The daemon had no handler on the per-agent stream → directory timed out. | New `session-ceremony.ts`: reconstruct threshold signer from persisted `frost-share.json`; attach per-agent handler |
| `cello_send` returned "Invalid peer ID" | `wants_session_offer` field silently dropped by the typed allowlist decoder in `decodeInboundSignalingFrame` — it rebuilt `SessionRequest` from known fields only and dropped unknown ones | Carry `wants_session_offer` through the decoder + add it to `SessionRequest` type |
| Relay dial failed: `[object Object]` | Session node's `SessionConnectionGater` denied the relay (a third peer) — it allowed only the counterparty. Error object was also serialized as `[object Object]` via string interpolation | `setAllowedOutboundPeer(relayPeerId)` OUTBOUND-only; inbound still counterparty-only. Fix all `[object Object]` error logging |
| Multi-session relay bug (blocking, found by review) | H1 fix to per-agent relay client used a single agent-global `#lastSeen` counter instead of per-session. Once any session advanced, a newer session's first submit would report an ahead `last_seen_seq` → rejected by relay | `#lastSeen` is a `Map<session_id_hex, seq>` |
| Relay FIFO ack desync on timeout | A timed-out submit left the stream open; a late ack would settle the NEXT submit's resolver, shifting every subsequent ack | Reset (close) the stream on `relay_submit_timeout` so the desynced queue can't persist |
| Published daemon and cli were empty | `packages/daemon` and `packages/cli` were not in the root `tsconfig.json` build graph AND not in the CI publish list. They published empty packages — the build step produced nothing | Add both packages to root `tsconfig.json` and CI publish list |
| Daemon crashed importing `sealToRecipient` | `packages/crypto` had gained `content-seal` functionality without a version bump — npm still served the stale version without `sealToRecipient` | Bump `@cello-protocol/crypto` version; update all dependents |
| Daemon crashed when CLI exited (EPIPE) | `cello login` spawned the daemon with stdout piped to the short-lived login process. When login exited, the pipe closed, the daemon got EPIPE on its next log write and crashed | Daemon spawned with `stdio: ['ignore', 'ignore', 'pipe']`; stdout unpiped from the CLI |

---

## The Two Largest Deliverables

### DOD-UP-1 — Unilateral → bilateral seal upgrade (CELLO-M7-UPGRADE-001)

A returning absent party (B) RATIFIES the existing unilateral sealed root R1 rather than re-sealing a new root (Model 2, not Model 1). V31 migration relaxes `seal_notarizations` `UNIQUE(session_id)` → `UNIQUE(session_id, seal_type)` so a bilateral row can SUPERSEDE the unilateral one (append-only, `supersedes_notarization_id` FK, the unilateral row never mutated). New `seal_upgrade_request` frame; directory `#processSealUpgradeRequest`; daemon `seal-upgrade.ts` (extracted for testability) — `attemptSealUpgrade` (the kernel) + `verifyUpgradeConfirmedCert` (AC-008). 7 increments, two reviewers + done-auditor.

**The kernel:** B signs its ratification ONLY after recovering + integrity-verifying the content (content-possession precondition); refuses `content_tamper` / `content_unrecoverable` / `content_incomplete` — never co-signs content it could not verify.

Bugs found here: (1) B's daemon called `verifyUnilateralCertificate` to verify A's seal sig, but that verifies against the LOCAL agent's own key — B doesn't hold the initiator's group key. (2) Absent-party upgrade listener wasn't registered at the keystone; the directory PUSHES the queued notification during the keystone's auth/reconnect drain BEFORE `cello_start_agent` registers the per-agent handler — so B reconnected but never triggered the upgrade. (3) HIGH security bug: `verifyAndApplyUpgradeConfirmed` verified the returning sig against `returning_pubkey` taken FROM THE FRAME — a malicious directory could forge B's ratification with a throwaway key. Fix: bind the cert's pubkeys to the LOCAL session record's real participants.

### DOD-SEAL-2 — Relationship-graph producer (Sybil / reputation-farming defense)

The directory now populates `conversation_seals` + `conversation_participation` + `conversation_attestations` on every seal (`recordConversationSeal`, atomic + hash-chained), wired into the unilateral + both bilateral paths. These feed `analytics-job`'s `conversation_graph_edges` + `pseudonym_stats` — the graph that detects clusters of mutually-sealing agents farming reputation. Relationship metadata + the sealed root HASH only, never content (INV-3). Bug found here: `seal_date` is a DATE column that round-trips non-deterministically (node-pg returns local-midnight Date, `toISOString()` shifts it) — excluded from chain serialization.

---

## CELLO-M7-CONN-001 — The Keystone Deleted (June 25–27)

The live operator path surfaced the **Demo1 bug**: removing an agent and registering a fresh one immediately after caused a timeout. Root cause: the daemon held ONE shared "keystone" directory connection borrowing the lexicographically-first (primary) agent's identity. Removing that agent cleared the primary but never tore down + re-established the connection — it lingered authenticated as the removed agent, and the next registration's DKG had no working directory door.

A verification pass enumerated all 19 frame types on the authenticated signaling stream: 18 are agent-scoped; only the manifest poll is daemon-level — and the manifest is public, self-authenticating data (threshold-signed; root keys pinned locally), so it can move to unauthenticated HTTP. Decision: **delete the keystone entirely, go fully per-agent**, and rehome the manifest poll to `GET /manifest`.

Built in three red-first phases: (1) manifest poll moved to unauthenticated HTTP (`http-manifest-poll.ts`), running daemon-level even with zero agents — the property the keystone could never provide; (2) inbound `session_assignment` / `seal_interrupted` responders wired per-agent; (3) keystone deleted (`primaryAgent` / `getAuthIdentity` / `wireKeystonePrimary` removed); every site re-homed to the owning agent via `signalingFor` / `sendOver`.

Three read-only reviewers (code-reviewer, fallback-finder, test-attacker) ran; every finding was fixed — notably a HIGH (loaded agents weren't connected at startup → no inbound after a restart) and two MEDs (swallowed manifest-store throw; status field that masked a partial per-agent outage).

Proven at every layer: `j-conn` (Demo1 repro + name-reuse-after-removal), `j-spine` (non-regressive), `j-remove`. Published daemon 0.0.13 / cli 0.0.11. Operator-confirmed: remove an agent → register a fresh one → DKG completed, `directory_signaling: connected`, corroborated in directory Postgres + replicated to eu-central-1 + ap-northeast-1.

---

## Numbers

| Metric | Value |
|--------|-------|
| Stories in original outline | 13 |
| Stories written and merged before collapse | ~12 |
| Build journal length at close | 6,133 lines |
| Days from collapse to substantive build complete | 5 (June 18–23) |
| Days from collapse to CONN-001 live | 9 (June 18–27) |
| Journeys built (J-SPINE → J-UPGRADE) | 10 |
| DoD lines closed (vs. 0 live at collapse) | ~40 |
| cello-client commits during rebuild (packages/) | 106 |
| Total commits in rebuild phase (all files) | 367 |
| npm packages published at M7 close | crypto 0.0.9, protocol-types 0.0.6, transport 0.0.6, client 0.0.35, daemon 0.0.7, cli 0.0.5, connect 0.0.47, interfaces 0.0.3 |
| npm packages at CONN-001 close (`@latest`) | daemon 0.0.13, cli 0.0.11, connect 0.0.49 |
| Branches pruned at collapse | ~14 worktrees + ~15 branches across two repos |
| Binary packaging bugs found (not catchable by unit tests) | 3 (exports map, CELLO_DIR socket, CI publish list) |
| Architecture-level bugs found by live tests | 5 (per-agent signaling, keystone, gater, relay FIFO, UP-1 pubkey binding) |

---

## What M7 Actually Delivered

- **Daemon model:** single long-running process, Unix socket IPC, lock file, structured logging, graceful shutdown
- **Per-agent directory connections:** each agent authenticates its own signaling stream; removing an agent is fully self-healing
- **Ephemeral session nodes:** per-session libp2p nodes, connectionGater enforcing single-peer allowlists, 32-node cap
- **Content delivery:** direct P2P content path + relay-backed encrypted store-and-forward for offline delivery; receiver ACK; oversize cap; replay dedup; tamper detection
- **Signaling resilience:** heartbeat/keepalive, exponential backoff reconnect, queued outbound ops drain after reconnect
- **Unilateral seal with FROST notarization:** directory rebuilds the tree, verifies the root, FROST-notarizes the absent party as ABSENT
- **Unilateral → bilateral upgrade:** returning party ratifies the sealed root; superseding notarization row; content-possession precondition
- **Seal certificate legibility:** receipt-not-assent, per-party content frontier (with client re-derive guard), attestation mode (live/absent/recovered), final-message-answered
- **Durable encrypted transcript:** AES-256-GCM at rest in client SQLite; survives daemon restart; relay/directory never see plaintext
- **Bidirectional directory auth:** manifest-pinned step-6 verification; TUF-aligned signed manifest; 6–12h background poll over unauthenticated HTTP
- **Sybil-defense relationship graph:** conversation_seals + participation + attestations populated at every seal, feeding the graph analytics that detect reputation-farming clusters
- **CLI-first interface:** `cello login`, `cello status`, `cello register`, `cello create-agent`, `cello remove-agent`, `cello start-agent`

---

## Bugs Found and Rules Created

### Process rules

**Never verify only within a story boundary.**
The three system-level gaps (unilateral seal certificate, content delivery, upgrade path) each lived between stories — not inside any one story's scope. Every gap passed every per-story gate. The fix: walk a complete user journey out loud at the END of every milestone, before declaring scope complete. No individual story gate substitutes for this.

**Dead-stack orphaning is invisible until you run the binary.**
Twelve stories of implementation passed every gate against the dead `CelloClient` stack. The live binary harness revealed, in the first run, that `cello login` crashed with `ERR_PACKAGE_PATH_NOT_EXPORTED`. Unit tests that call library methods directly can never catch this. Any implementation milestone must include a live binary smoke test as a CI gate from day one.

**Branch sprawl deserves a hard limit.**
When branches cannot see each other's code, work gets redone. A reasonable working limit: never more than 3 worktrees open per repo at the same time. When that limit would be exceeded, merge or prune before opening a new worktree.

**RC-1: every deferral must have a named home.**
The original postmortem named RC-1 explicitly: deferrals that evaporate into discussion logs don't get fixed. The implementation: a `PRUNE-LEDGER.md` + explicit deferral ledger entries in the build journal. A deferral without a name and a file reference is a deletion.

### Code rules

**Composition root verification is mandatory.**
Multiple bugs (empty published packages, dead session node factory, disconnected keystone) all shared the same shape: a class or module was built, tested, and reviewed — but never wired into the binary's composition root. Every story that introduces a new capability must include an AC asserting observable behavior from the entrypoint, not just that the class exists.

**Every per-agent operation needs its own per-agent stream.**
The FROST ceremony routing, session assignment routing, registration reply routing — all keyed by authenticated stream identity. If a second agent doesn't have its own authenticated stream, its frames are misrouted to the primary and silently timeout. The keystone model was wrong in principle, not just in implementation.

**Typed decoders must carry every protocol field.**
`decodeInboundSignalingFrame` as a typed allowlist silently dropped `wants_session_offer`. The symptom was "Invalid peer ID" from a session node creation that should have been a session offer. The rule: after any wire format change, verify that the decoder's output carries the new field — not just that the encoder sends it.

**Never verify against a pubkey the untrusted sender chose.**
The UPGRADE-001 HIGH security bug: `verifyAndApplyUpgradeConfirmed` verified the ratification signature against `returning_pubkey` taken from the untrusted frame. A malicious directory could forge B's ratification. Fix: bind cert pubkeys to the LOCAL session record's real participants, never the frame's claim.

**Listeners for directory-pushed frames must be registered at daemon startup, not per-session.**
When B reconnects after absence, the directory PUSHES queued notifications (like `seal_unilateral_notification`) during the keystone auth/reconnect drain — before `cello_start_agent` registers the per-session handler. These frames are dropped silently. Any notification the directory pushes on reconnect must be registered at daemon startup time.

---

## What Remains

- **Direct-dial-to-public-endpoint (Stage 2):** `selectAdvertisedAddress` only picks the direct address when AutoNAT confirms dialability. A configured `CELLO_ANNOUNCE_ADDRS` should be treated as authoritative dialability for static-public hosts (no AutoNAT needed). Demo currently advertises relay.
- **NAT traversal dialer:** wire `CelloNodeTransportDialer` into `cello-daemon.ts` + reconcile the dialer's connection with the session node.
- **Returning-user recovery:** directory replies `already_registered` when a user reinstalls and tries to re-register — the agent can't sign without its local FROST share, which isn't reconstructable from the directory alone. Design needed before the recovery flow can be implemented.
- **Relay reconnect after directory redeploy:** the relay has no reconnect logic; every directory deploy needs a manual relay bounce per region. Permanent fix: symmetric relay↔directory reconnect-with-backoff (deferred to the federation milestone).
- **Assembly-wide discipline audits (INV-6/8):** error-message distinctness, no-console.log, and correlationId threading were enforced per-story but never audited as an aggregate across the assembly.
- **DOD-MSG-4 Finding 2** (relay-SIGNED sequence verification): explicitly deferred (RC-1) to the transport-security-audit hardening story.
- **Demo cleanup:** update published demo AgentID, rewrite `demo/runbook.md` + `demo/CLAUDE.md` for M7, update `infra/STATE.md`, remove throwaway test driver.
- **DOD-CONN-3 last step:** ALB `ManifestPathRule` via `deploy.sh` — the `GET /manifest` directory image is deployed to all 3 regions; the ALB rule is the only remaining step.

---

## Related Documents

- `docs/planning/user-stories/m7/M7-DEFINITION-OF-DONE.md` — the DoD scoreboard (authoritative status)
- `docs/planning/user-stories/m7/M7-BUILD-JOURNAL.md` — day-by-day archaeology (6,133 lines)
- `docs/planning/user-stories/m7/M7-PROCEDURE.md` — the per-unit loop + severity triage + overnight rules
- `docs/planning/user-stories/m7/M7-STATE-OF-THE-UNION.md` — the post-collapse brief that started the rebuild phase
- `docs/planning/user-stories/m7/PRUNE-LEDGER.md` — every pruned branch + tip hash (all resurrectable)
- `docs/planning/user-stories/m7/POSTMORTEM-seal-and-content-delivery-gaps.md` — the three gaps + remediation plan
- `docs/planning/user-stories/m7/COORDINATION.md` — per-story claims + coordination log
