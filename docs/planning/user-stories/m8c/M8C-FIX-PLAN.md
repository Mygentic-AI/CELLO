---
name: M8C Fix Plan
type: fix-plan
date: 2026-07-07
milestone: M8C
status: open
topics: [fix-plan, cello-client, ops-agent, directory, onboarding, screening, contacts, anti-spam, sessions, security]
description: >
  The consolidated, compaction-survivable fix plan from the 2026-07-07 live-testing session. Every
  defect/improvement found, organized by repo (cello-client · operations-agent · directory), each with
  where (file:line), the fix, difficulty, and a launch call. A fresh context can implement any item from
  this doc alone. Detailed copy/design lives in the two companion docs (linked per item); this is the
  master index + implementation detail. NOTHING here is implemented yet.
---

# M8C Fix Plan — from the 2026-07-07 live-testing session

## How to use
- This is the **master fix index**. Each item is self-contained enough to implement cold.
- Exact onboarding **copy** lives in [[M8C-ONBOARDING-IMPROVEMENTS]]; the **screening model** lives in
  [[2026-07-07_1700_four-level-screening-policy]]. Items below point to them rather than duplicate.
- Live-test evidence for every claim is in [[M8C-LIVE-TEST-CHECKLIST]].
- **Line numbers are from HEAD on 2026-07-07** — re-grep the symbol before editing; they drift.
- Launch calls (🔴 blocking / 🟠 should-do / 🟢 fast-follow / ⚪ after-launch) are **recommendations —
  Andre owns the final triage.**

## Priority summary (recommended order)

| # | Fix | Repo | Difficulty | Launch call |
|---|---|---|---|---|
| **CC-1** | **Gate the inbound contact auto-add** (restores screening + anti-spam) | cello-client daemon | Easy (gate 1 call) | 🔴 blocking |
| **OA-1** | **Token message names the wrong env var** (blocks cold onboarding) | ops-agent | Trivial (string) | 🔴 blocking |
| **CC-2** | **`register` doesn't arm the standing receiver** (fresh agent can't receive until restart) | cello-client daemon | Easy (1 line) | 🔴 blocking |
| **OA-2** | Onboarding copy overhaul (items 1–4, O1–O5) | ops-agent | Easy (strings) | 🟠 should-do |
| **CC-3** | F18 sole-online → session-action tools (`no_current_agent` papercut) | cello-client daemon | Moderate (~6 handlers) | 🟠 should-do |
| **CC-6** | `register` next-step guidance → multi-line | cello-client CLI | Trivial | 🟠 should-do |
| **CC-7** | Top-level `cello --help` → real orientation | cello-client CLI | Easy | 🟠 should-do |
| **CC-8** | CLI `cello status` shows `registered` (not `online`/`selected`) | cello-client CLI | Easy | 🟠 should-do |
| **CC-9** | Expose `cello_contact_list/add/remove` as MCP tools | cello-client connect shim | Easy | 🟠 should-do |
| **CC-4** | `connections` in `cello status` is an always-empty stub | cello-client daemon | Easy (wire or drop) | 🟢 fast-follow |
| **CC-5** | Half-open sessions are uncloseable (F21) + strand-on-abandon | cello-client daemon | Moderate | 🟢 fast-follow |
| **DIR-1** | **SEC-2** — unauthenticated FROST signing stream (forgery) | directory + client | Large, cross-repo | ⚪ Andre's severity call |
| **D21** | Full 4-level screening model + real content gate + CONFIG | cello-client + M9 | Feature | ⚪ after launch (M9) |

> Already fixed **this session** (no action): ops-agent SSM `expected-migration-version` 43→45 to match
> the live DB (V45) — see [[STATE.md|infra/STATE.md]]. Don't re-do.

---

## 🌙 AUTONOMOUS RUN DIRECTIVE (Andre, 2026-07-07) — READ FIRST

**Scope:** implement ALL cello-client fixes (CC-1…CC-9) + both ops-agent items (OA-1, OA-2). **DEFER**
SEC-2/DIR-1 (needs a coordinated client-then-directory rollout + Andre's severity call) and the full D21
model (M9 feature). Do NOT touch the directory.

**How to run — under [[M8C-PROCEDURE]]:** autonomous-mode rules (§3a — NEVER `AskUserQuestion`;
decide→log in [[M8C-DECISIONS]]→proceed; redo > block). Per-unit: red-first test → implement → full gate
`pnpm test → lint → typecheck → build` → `cello-unit-reviewer` on the diff → fix every finding → commit
with the fix ID. Arm BOTH watchdog crons at kickoff (§3b). Commit constantly (never >15 min). Work in the
priority-summary order: **CC-1, OA-1, CC-2 first**, then the 🟠 set (OA-2, CC-3, CC-6, CC-7, CC-8, CC-9),
then CC-4, then CC-5.

**Batch the ships:** ALL cello-client fixes → ONE `/cello-publish` cascade at the END (bump changed
`core/*` + dependents, tag, CI → beta; verify the binary). Both ops-agent items → ONE us-east-1 redeploy.
**Never publish/redeploy per-fix.** Then update `trustless-cello` package.json pins + `pnpm install`.

**Resolved forks — DO NOT re-ask:**
- **CC-1 = operator-engagement-only promotion.** Remove the inbound auto-add (`daemon.ts:4418`). Promote a
  counterparty to "known" ONLY on: (a) outbound `initiate_session` (KEEP `:3137`); (b) the operator sending
  a reply INTO an inbound-originated session — add `addContact` in the `cello_send` path when the session's
  counterparty initiated and isn't yet a contact; or (c) explicit `cello contact add`. An **unattended
  stranger is NEVER auto-whitelisted.** Tests (with teeth): a stranger stays unknown after knocking (and
  therefore stays subject to the ABUSE-1 caps); becomes known only after the operator replies.
- **CC-5/F21 = FULL.** (a) *Don't-strand:* make the receiver's durable session conditional on the initiator
  confirming establishment, OR reap `messageCount:0` half-open sessions with no counterparty liveness after
  a timeout — pick the cleaner, log the choice. (b) *Terminal-escape:* add a unilateral force-abandon for a
  session whose bilateral seal is impossible (`seal_interrupted_rejected_by_counterparty` / counterparty
  unavailable) — mark it terminal locally with a surfaced reason so it leaves the open list (no bilateral
  seal needed — nothing to notarize on a dead half-open session).
- **CC-4 = drop the empty `connections` field** from status (simplest, anti-mock). Real client-visibility
  (F9) is a fast-follow; leave `perConnectionState` in place.

**The ONLY legitimate stop conditions** (everything else = decide-log-proceed): (1) `latest`-tag promotion
— do the beta publish, then STOP and say "needs Andre's go for `latest`"; (2) `/mcp` reconnect + the live
`--channels`/two-agent verification — needs a human at the keyboard. Do every non-live part first; leave a
crisp handoff for the live checks.

### Tracking & documentation — QUOTA-CRITICAL (the run may be cut off mid-way; weekly quota resets tomorrow 9 PM)
- **THIS fix-plan is the single source of truth for run progress — NOT the DoD.** Do not "work the DoD"
  during this run (looking at both is confusing). Mark each fix's status inline in its section
  (`STATUS: ⬜ todo / 🔨 in-progress / ✅ done <commit>`) and keep the ▶ RESUME line below current. Touch a
  DoD line ONLY when a fix genuinely completes it, then note it. **Fix→DoD map:** OA-1/OA-2 + CC-6/CC-7/CC-8
  → ONBOARD-* riders + cold-onboarding/LIVE-1; CC-2 → AUTOSTART-1/LIVE-1; CC-1 → CONTACT-1/ABUSE-1 hardening
  + D21.
- **Append an M8C-BUILD-JOURNAL entry per fix** — the audit trail + the frequent-documentation mechanism.
- **Document + COMMIT after EVERY fix — no batching.** The commit is the durable record. Quota may end the
  run at ANY moment; a fresh context must resume from the commits + this doc ALONE. NEVER leave a completed
  fix undocumented/uncommitted. **Push is best-effort** — attempt `git push` after each commit, but a
  quota-blocked/failed push must NOT block progress (committed-but-not-pushed is acceptable). This applies
  to BOTH repos (cello-client for CC-*, trustless-cello for OA-* + all docs).
- **When budget feels low:** STOP starting new work → finish documenting + committing the current fix →
  update the ▶ RESUME line → then idle. Documented state beats one more fix.

### Watchdog crons — specialized for THIS run (extends PROCEDURE §3b)
- **Cron 2 (heartbeat, ~30 min) — quota-hardened + ANTI-DRIFT. Each cycle, IN THIS ORDER:**
  1. **FULLY RE-ANCHOR ON THE DOCS (most important — compaction is exactly what drops them).** Confirm the
     ENTIRE [[M8C-PROCEDURE]] **and** this ENTIRE [[M8C-FIX-PLAN]] (this directive + every per-fix detail)
     are actually in context. If there is ANY doubt either was dropped or summarized — **RE-READ BOTH IN
     FULL before doing anything else.** Never work from a half-remembered summary; the file:line refs, the
     locked forks (CC-1/CC-5/CC-4), the batch-publish rule, and the stop conditions all matter and are easy
     to lose.
  2. **Commit progress.** If a fix completed since the last commit, commit it now (its `STATUS:` line + an
     M8C-BUILD-JOURNAL entry) in the right repo; `git push` (best-effort, ignore failure) in BOTH repos;
     refresh the ▶ RESUME line. Commit anyway if >15 min since the last commit.
  3. **Standard §3a self-audit:** stalled on a decision → pick best practice, log in M8C-DECISIONS, proceed;
     a unit went green without a `cello-unit-reviewer` → dispatch it; state one line of status so a human
     skimming later sees the run was alive and unstuck.
  **Full-doc re-anchoring + documentation are the priorities over pressing forward.**
- **Cron 1 (deploy watchdog)** arms during the ops-agent redeploy + the cello-client publish CI (unchanged).

### ▶ RESUME STATE — keep current (the single anchor for a cut-off resume)

> **✅✅ M8C FIX RUN COMPLETE — 2026-07-08.** All 11 fixes (CC-1…CC-9, OA-1/OA-2) **+ CC-10** shipped
> to `latest` and **live-verified**: all 5 A/B phases PASS (Phase 0 ✅ · Phase 1 ✅ force-abandon ·
> Phase 2 ✅ re-run, CC-10 fixed the abuse-cap ghost bug · Phase 3 ✅ vs Feedback · Phase 4 ✅ cold
> onboarding). Both legitimate stops cleared (latest promoted w/ Andre's go; live /mcp two-agent run
> done). Live stack: **daemon 0.0.36 · cli 0.0.33 · connect 0.0.61** (tag `v0.0.82`). Evidence:
> [[M8C-LIVE-AB-TEST-PROTOCOL]]. **Two post-launch follow-ups logged, NOT blocking** (see end of this
> section): (1) Phase-4 email-recovery papercut (triage-open); (2) initiator-side rejection-signal gap.
> Nothing left blocking for launch on the agent-connect path.

**Done:** CC-1 (cc `eae50fb`) · OA-1 (tc `4ce5cfe7`) · CC-2 (cc `e73c421`) · OA-2 (tc `c1189f42`) · CC-3 (cc
`da28e12`) · CC-6/7/8 CLI cluster (cc `f486e32`) · CC-9 (cc `d9c5569`) · **CC-10 (cc `79030e3`)** — all reviewed. **ALL FIX ITEMS DONE + REVIEWED + SHIPPED + PROMOTED + LIVE-VERIFIED.** CC-1/2/3/4/5/6/7/8/9/10 + OA-1/2 all committed+pushed+reviewed
(CC-5 = cc `146ac74`+`cc4e5ce`; CC-10 = cc `79030e3`, version cascade `a963737`). (Deferred by directive: SEC-2/DIR-1, full D21.)
**SHIP STATE — ✅ COMPLETE:**
- **cello-client cascade — ✅ PUBLISHED + BINARY-VERIFIED + PROMOTED to `latest`.** Final live versions:
  daemon **0.0.36** / cli **0.0.33** / connect **0.0.61** (CC-10 cascade cc `a963737`, tag **`v0.0.82`**,
  green smoke-tag). Binary-verified in the *installed running* daemon dist (not just CI): CC-10 markers
  present (`getSessionsByStatus("interrupted")` in the reaper, `reapDeadHalfOpenSessions(agentName)`
  reap-before-bound call, `abandonSession` returns write outcome). cli→daemon pin = real `0.0.36` (not
  `workspace:*`). All 7 promoted to `latest` w/ Andre's go (daemon/cli needed OTP browser-auth; the other 5
  were already `latest`). *(Prior beta ship of CC-1…CC-9 = daemon 0.0.35/cli 0.0.32, tag `v0.0.81` —
  superseded by v0.0.82.)*
  **↳ Follow-up (post-launch, not blocking):** the binary SIGTERM test (session-node-manager AC-009) has a
  cross-connection visibility race — INSERTs synthetic rows on a separate SQLCipher connection then SIGTERMs,
  so the daemon's shutdown query can run before the INSERT is durable/visible. Harden (confirm the daemon
  observed the rows before SIGTERM, or WAL-checkpoint before kill).
- **ops-agent (OA-1+OA-2)** — us-east-1 pipeline ran to ProductionDeploy **Succeeded** at source `7cb8cf60`
  → **deployed**.
**✅ BOTH legitimate stops CLEARED (2026-07-08):**
1. **`latest`-tag promotion** — DONE. Andre gave the go; daemon 0.0.36 + cli 0.0.33 promoted (OTP auth),
   verified `npm view @latest` = cli 0.0.33 / daemon 0.0.36 / connect 0.0.61.
2. **Live `/mcp` reconnect + two-agent verification** — DONE. All 5 A/B phases PASS (see
   [[M8C-LIVE-AB-TEST-PROTOCOL]]). Reinstalled cli+connect@latest, `cello login` (4 agents online),
   MCP reconnected.

**🔭 POST-LAUNCH FOLLOW-UPS (surfaced by the live run — logged, NOT blocking, need a triage call):**
1. **Phase-4 email-recovery papercut** — a mistyped email during Telegram registration has no clean
   recovery: (a) no match-check between the typed email and the account's on-file email before dispatching
   an OTP (any email-shaped string gets a code); (b) no escape from OTP-entry back to email-entry except
   burning all 3 attempts, and `/start` is swallowed as a wrong-code guess. Recoverable-with-effort, not a
   hard block — Andre completed registration. Onboarding is launch-critical (agent connect), so needs an
   explicit severity call before writing a story. Full transcript in [[M8C-LIVE-AB-TEST-PROTOCOL]] Phase 4.
2. **Initiator-side rejection-signal gap** — `cello_initiate_session` returns `ok:true` even when the
   receiver silently rejects the inbound (e.g. abuse cap): the initiator gets no signal, the receiver gets
   no notification/session-list entry, and the rejection is only visible in the daemon log. Both the
   original ABUSE-1 test and the Phase-2 block looked identical (`ok:true`) from A's side regardless of
   acceptance. Consider surfacing a rejection reason to the initiator. Details in Phase 2 RESULTS.

Prior notes for CC-5 (now done, superseded):
**(was) CC-5** (🟢 — F21 full, design-significant, LAST fix:
(a) don't-strand — receiver session conditional on initiator confirmation OR reap `messageCount:0`
half-open sessions after timeout, pick cleaner + log; (b) terminal-escape — unilateral force-abandon
marking the session terminal locally with a surfaced reason. Write a design note in the journal FIRST per
PROCEDURE §6). Then ONE cello-client `/cello-publish` cascade + ONE us-east-1 ops-agent redeploy
(OA-1+OA-2), then the live-verification stop. Nothing published/redeployed yet. When resuming cold: read
this directive + the per-fix `STATUS:` lines + `git log` in both repos, continue from the first non-✅ fix.

---

## cello-client — daemon (`core/daemon/src/daemon.ts`, `session-node-manager.ts`)

### CC-1 — Gate the inbound contact auto-add 🔴  *(the security fix — restores screening AND anti-spam)*
**STATUS: ✅ done** — cello-client `eae50fb`. Removed inbound auto-add + added operator-engagement promote-on-reply in `cello_send`; tests flipped + teeth (m8c-contact-1 K3 stays-unknown + reply-promotes; m8c-abuse-1 live-3f regression). Full daemon gate green (632 tests, lint/typecheck/build). `cello-unit-reviewer`: SPEC FAITHFUL / NO SILENT FALLBACKS / TESTS HAVE TEETH — one LOW (stale comment) fixed. NOT yet published (batched into the end-of-run cello-client cascade).
- **What/why:** an **inbound** session offer auto-adds the sender to the contact whitelist **automatically**
  on accept — even for an unattended agent that only auto-replied "Dispatched." So a stranger who knocks
  once is promoted to "known" and thereafter is fast-tracked, exempt from the ≤3-session cap, exempt from
  the 25 MB byte cap. **This single line defeats BOTH the screening layer and the ABUSE-1 anti-spam.**
  Confirmed live twice: mid-session promotion (Dispatched→AWAY within one session), and 4 sequential
  unknown-sender sessions all accepted (test 3f). Both in [[M8C-LIVE-TEST-CHECKLIST]].
- **Where:** `daemon.ts:4418` — `sessionNodeManager.addContact(agentName, parsed.participantAPubkeyHex)`
  in the inbound-accept path (right after `sendAwayResponse(...,"request")` at :4417). **KEEP** the OTHER
  auto-add at `daemon.ts:3137` (outbound `initiate_session` → adds the target — that IS deliberate operator
  action). `addContact` itself is `INSERT OR IGNORE` (session-node-manager.ts:~858).
- **Fix — LOCKED (see Autonomous Run Directive above):** operator-engagement-only promotion. Remove the
  `:4418` inbound auto-add; promote to "known" only on outbound `initiate_session` (keep `:3137`), on the
  operator replying INTO an inbound-originated session (add in the `cello_send` path), or explicit
  `cello contact add`. Unattended stranger is never auto-whitelisted. Separate "accept the *connection*"
  from "trust the *sender*."
- **Difficulty:** the removal is 1 line. The design nuance — *what should promote a sender to known* — is
  the real content; it's the seed of the D21 model, but the security-restoring gate does NOT need the full
  M9 config. Ship the gate now, layer levels later.
- **Design home:** [[2026-07-07_1700_four-level-screening-policy]] (D21) — "Open implementation issue."

### CC-2 — `register` doesn't arm the standing receiver 🔴
**STATUS: ✅ done** — cello-client `e73c421`. Register success path calls `startAgentInternal(name)` (same idempotent arm as login/use_agent); arm-fail is a warning, never fails the persisted registration. Daemon suite green (632), lint/typecheck/build. No success-path unit test by design — **D22** (harness has no fake-directory registration success; enforcer is the live register-then-receive smoke, batched). Reviewer SPEC FAITHFUL / NO FALLBACKS / TEETH; one LOW (optimistic `armed` event) fixed → `arm_initiated`. NOT yet published (end-of-run cello-client cascade).
- **What/why:** after `cello_register`, the agent is registered but its standing receiver is NOT armed —
  `standing_receiver_ready:false` — so it **cannot receive inbound until a daemon restart** (login).
  A brand-new user's first agent looks broken until they `cello logout`/`login`. Confirmed live (agent
  CELLO_Feedback). [[M8C-LIVE-TEST-CHECKLIST]] item 1 / P2-2.
- **Where:** the `cello_register` success path, `daemon.ts:2333–2359` (after `registration.succeeded`,
  before `return { ok:true, ... }`). The arm path is `startAgentInternal(name)` (`daemon.ts:~1815`), which
  adds to `onlineAgents`, opens signaling, calls `ensureStandingReceiverForAgent`, fires
  `agent_state_changed`. It's idempotent.
- **Fix:** call `startAgentInternal(name)` in the register success path. Register bringing the agent online
  is consistent with login and use_agent both auto-starting. One line.
- **Difficulty:** Easy (1 line).

### CC-3 — F18 sole-online auto-select is missing on the session-action tools 🟠
**STATUS: ✅ done** — cello-client `da28e12`. 8 handlers route through `resolveCurrentAgent` (explicit `{name}` > current > sole-online): initiate_session, close_session, get_sealed_receipt, get_transcript, list_sessions, await_session, send, handleReceive (receive/receive_session). Downstream `connState.currentAgent` threaded to resolved `agentName` (ownership checks preserved). `cello_status` + dead stub loop untouched. 2+-online-none-selected still `no_current_agent`. Daemon suite green (635, +3 teeth: sole-online resolves / 2-online ambiguous / explicit name pins the agent), lint/typecheck/build. Reviewer SPEC FAITHFUL / NO FALLBACKS / TEETH; LOW test-hardening (pin selected agent) applied. NOT yet published (end-of-run cello-client cascade).
- **What/why:** `cello_initiate_session` (and siblings) return `no_current_agent` on a fresh connection
  even with one agent online — forcing an explicit `cello_use_agent` every cold start. F18's
  `resolveCurrentAgent` was wired into the receive/inbox tools but not the session-action tools. Agent-
  surfaced (Ms_Chelly→CELLO_Feedback, BUILD-JOURNAL 48/49). P2-3.
- **Where:** hard-fail sites `if (!connState || !connState.currentAgent) return NO_CURRENT_AGENT_RESPONSE;`
  at `daemon.ts:3013` (initiate), `5164` (send), `4618` (await), `3154` (close), `3600` (list_sessions),
  `3473/3529/5401` (receive_session region). The helper is `resolveCurrentAgent` (`daemon.ts:1865`); the
  correct pattern is already at `daemon.ts:2901/2934`.
- **Fix:** replace each hard-fail with `const agentName = resolveCurrentAgent(connState, params?.name); if
  (!agentName) return NO_CURRENT_AGENT_RESPONSE;` and thread `agentName` downstream (some handlers read
  `connState.currentAgent` later — update those). ~6 handlers + tests.
- **Difficulty:** Moderate. **Scope note:** helps the common single-agent case; 2+ online with none
  selected stays ambiguous → still `no_current_agent` (correct).

### CC-4 — `connections` in `cello status` is an always-empty stub 🟢
**STATUS: ✅ done** — cello-client `5deef4b`. Dropped the empty `connections` field from `DaemonStatusResponse` + both status builders + the `const connections=[]` decl + unused import; kept the exported `ConnectionInfo` type (F9 placeholder) + `perConnectionState`. Tests updated (AC-019 asserts NO `connections`). Also repaired a CC-6 register-test that shipped red in `f486e32` (amend changed the copy; ran eslint not the CLI suite — CC-4's gate caught it). Daemon 635 / CLI 30 green, lint/typecheck/build. Reviewer SPEC FAITHFUL / NO FALLBACKS / TEETH; f486e32 red confirmed fully resolved. NOT yet published (end-of-run cascade).
- **What/why:** `const connections: ConnectionInfo[] = []` (`daemon.ts:610-611`, "until connection
  validation is wired") is passed straight into status (`:1778`). Always empty — conveys nothing. Was
  meant to be F9 connected-client visibility. P2-4.
- **Fix:** (a) wire the visibility half from `perConnectionState` (`daemon.ts:905`, connectionId →
  `{currentAgent, clientType}`) — show attached clients; or (b) drop the field until F9 is built. Anti-mock
  rule favors not shipping an empty placeholder.
- **Difficulty:** Easy.

### CC-5 — Half-open sessions are uncloseable + stranded on abandon (F21) 🟢
**STATUS: ✅ done** — cello-client `146ac74` + `cc4e5ce` (reviewer follow-up). Design note = Entry 58; decision = **D25**. (b) terminal-escape: `cello_close_session { force }` early branch → `abandonSession` (new terminal status `"abandoned"` → classify `"failed"`), no seal; on the shim too. (a) don't-strand: `reapDeadHalfOpenSessions` on read (buildActiveSessions + list_sessions) abandons active + **0-RECEIVED** (not msgCount:0 — the ghost carries its own Dispatched ack) + liveness≠alive + age>5min; `abandonSession` flips DB status synchronously so a non-awaited reap shows in the same read. Reviewer SPEC FAITHFUL / NO FALLBACKS; one BLOCKING hollow-test (F-1: liveness gate had no teeth) + one LOW (F-2: mislabeled write-fail log) both FIXED in `cc4e5ce` (added the live-counterparty-survives test + `session.status.write.failed`). Daemon 640 / connect 108 green, lint/typecheck/build. NOT yet published (end-of-run cascade).
- **What/why:** a failed/abandoned `initiate_session` (`counterparty_unavailable` on the sender side) leaves
  a durable `active` session on the RECEIVER (the standing receiver created it + auto-added + sent
  "Dispatched" even though the initiator gave up). That half-open session **cannot be closed** — closing an
  `active` session (`daemon.ts:3250`) fires a bilateral seal the absent counterparty rejects
  (`seal_interrupted_rejected_by_counterparty`, verified live). They accumulate (Support held 6). F21 family.
- **Where:** receiver-side session creation from an offer — inbound-accept path near `daemon.ts:4412–4418`;
  close/seal path `daemon.ts:3250` (active) / the seal-interrupted flow. `close_session` is current-agent-
  scoped (`daemon.ts:3176`) — must `use_agent` the owner first (this is correct, not the bug).
- **Fix — LOCKED FULL (see Autonomous Run Directive above):** (a) don't-strand — make the receiver's
  durable session conditional on initiator confirmation, OR reap `messageCount:0` half-open sessions after a
  timeout (pick the cleaner, log it); (b) terminal-escape — unilateral force-abandon for a session whose
  bilateral seal is impossible, marks it terminal locally with a surfaced reason (no seal needed). Investigate
  the receiver-side create ordering first.
- **Difficulty:** Moderate — the two design calls are made (directive); implementable autonomously.

---

## cello-client — CLI (`core/cli/src/`)

### CC-6 — `register` next-step guidance is a run-on line 🟠
**STATUS: ✅ done** — cello-client `f486e32` (CLI cluster). Multi-line heading + 3 bulleted cues; cues aligned to real `cello status` output (agent state `online` + directory_signaling `connected`) per reviewer LOW. Copy-only success-path (live-verified, D22-class).
- **What/why:** the `register` output packs the whole "run cello status / connecting is normal / logout-login
  if stuck" into one dense line. P2-1. (The guidance CONTENT is correct — DOD-ONBOARD-NEXTSTEP-1 is ✅; this
  is formatting only.)
- **Fix:** break it multi-line (see [[M8C-ONBOARDING-IMPROVEMENTS]] P2-1 for the exact layout). Trivial.

### CC-7 — Top-level `cello --help` is a bare command list 🟠
**STATUS: ✅ done** — cello-client `f486e32` (CLI cluster). `USAGE` opens with what CELLO is + the onboarding path (login → create-agent → register → status), keeps the full command list + per-command pointer. Teeth test asserts the path order.
- **What/why:** `cello --help` prints only `Usage: cello <login|...>` + "run cello <cmd> --help". Per-command
  help IS good (`cello create-agent --help`). DOD-ONBOARD-HELP-1 requires BOTH to give real help. P2-5.
- **Where:** `core/cli/src/cli-args.ts` (top-level usage string, ~line 28).
- **Fix:** open with one line on what CELLO is + the onboarding path (login → create-agent → register →
  status) + the per-command pointer. Keep the list, add orientation. Easy.

### CC-8 — CLI `cello status` shows `state:"registered"`, never `online`/`selected` 🟠
**STATUS: ✅ done** — cello-client `f486e32` (CLI cluster). Root cause: CLI `status` → `"status"` IPC → `getStatus()` (daemon-wide) spread the stale stored `agents[].state`. Fixed `getStatus` to derive state from `onlineAgents` (preserving `load_failed`), matching the MCP F5 surface; connection-independent (handle==IPC equality holds). `selected` intentionally omitted daemon-wide → **D24**. Teeth test: offline→registered, online→online. Reviewer SPEC FAITHFUL / NO FALLBACKS / TEETH.
- **What/why:** the running daemon's **MCP** `cello_status` correctly shows `state:"online"` + `selected`
  (the F5 legibility fix, `daemon.ts:1712`), but the **CLI** `cello status` output shows `state:"registered"`
  always and no `selected` field — so you can't tell online vs offline from the CLI. Confirmed live (CLI vs
  MCP diverge). [[M8C-LIVE-TEST-CHECKLIST]].
- **Where:** VERIFY — the CLI status formatter (likely `core/cli/src/commands.ts` `status()` or its printer),
  vs the daemon status handler at `daemon.ts:1712`. Determine whether the CLI reads a different field or the
  deployed daemon predates F5. (Uncertain which layer — trace both before fixing.)
- **Fix:** make CLI status surface the same `online`/`registered` + `selected` the MCP surface does.
- **Difficulty:** Easy once located.

### CC-9 — Contact management is not on the MCP tool surface 🟠
**STATUS: ✅ done** — cello-client `d9c5569`. Added `cello_contact_list/add/remove` as `server.tool` forwards in `bin/cello-mcp.ts` (`proxy.call`, params `pubkey`+optional `agent` matching the daemon handlers; omit-agent → daemon sole-online fallback; no-agent → loud `no_current_agent`). No shim unit test (bin connects at import — untestable, like all ~20 bin tools; daemon handlers covered by m8c-contact-1). Connect suite green (108), typecheck/lint/build. Reviewer SPEC FAITHFUL / NO FALLBACKS / TEETH. Live `/mcp` reconnect is the enforcer. NOT yet published (end-of-run cascade).
- **What/why:** the daemon has `cello_contact_list/add/remove` handlers (`daemon.ts:5585/5597/5609`;
  `resolveContactAgent` at `:5570`), but the **connect shim never forwards them as MCP tools** — so an agent
  driving via MCP can't see or manage its own whitelist (CLI-only, `cello contact ...`). Central now that
  D21/CC-1 make the whitelist load-bearing. P2-6.
- **Where:** `core/adapter-claude-code/src/` (the shim tool definitions / IpcProxy forwarding).
- **Fix:** add the 3 tools mirroring the existing daemon handlers. Easy.

---

## operations-agent (`packages/operations-agent/src/`, in trustless-cello)

### OA-1 — Token message names the WRONG env var 🔴  *(blocks cold onboarding)*
**STATUS: ✅ done** — trustless-cello `4ce5cfe7`. Shared `#sendTokenDelivery` helper (both sites, no drift); two-message delivery (runnable `cello register [YOUR_NAME] <token>` + bare token); `[YOUR_NAME]` bracket fail-safe. Also fixed 2 pre-existing docstrings naming the dead env var. Full ops-agent gate green (121 tests, lint/typecheck/build); reviewer SPEC FAITHFUL / NO FALLBACKS / TEETH. NOT yet redeployed (batched with OA-2 into ONE us-east-1 redeploy). *(Local note: the running Docker Postgres predated `docker/postgres/initdb/01-dev-role-passwords.sql`; ran `ALTER ROLE cello_ops_agent/cello_service/cello_analytics PASSWORD …_dev` to unblock the ops-agent integration tests — ephemeral local-container state, not repo/infra.)*
- **What/why:** the registration-complete message says *"Set this as `CELLO_REGISTRATION_TOKEN`"* — a var
  the CLI reads **nowhere**. The CLI takes the token as a positional arg (`cello register <agent> <token>`)
  or `CELLO_PREAUTH_TOKEN`. A brand-new user following it literally is stuck. Cross-repo drift.
- **Where:** `registration/state-machine.ts:538` and `:603` (the retry path — BOTH).
- **Fix:** replace with the actual command form and split into two messages (instructions + token-only) —
  full drafted copy in [[M8C-ONBOARDING-IMPROVEMENTS]] item 4 (uses `[YOUR_NAME]` bracket placeholders — the
  brackets fail the name charset so a blind paste is cleanly rejected — with the real token inlined).
- **Difficulty:** Trivial (string). **Ship:** rebuild + redeploy ops-agent (us-east-1 only).

### OA-2 — Onboarding copy overhaul (items 1–3, O1–O5) 🟠
**STATUS: ✅ done** — trustless-cello `c1189f42`. Items 1 (engine.ts split into 2 msgs), 2 (phone-ask directory-scoped privacy note — shared `PHONE_PRIVACY_NOTE` const, new/returning openers), 3 (email-ask branches on `expectedEmailStubHash`, no prefix hint), O1 (pre-auth error now honestly retryable — shared `PREAUTH_SERVER_ERROR_MSG` const; **corrected m6b-011 AC-001 → D23**), O2 (3 OTP phrasings standardized + 15-min lifetime), O3 (rate-limit adds 1h), O4 (continuity reject explains why). Full ops-agent gate green (121 tests, lint/typecheck/build). Reviewer SPEC FAITHFUL / NO FALLBACKS; one BLOCKING hollow-test finding (F1: m6b-016 split test passed a recombined single message) FIXED (asserts two distinct sends) before commit. NOT yet redeployed (batched with OA-1 → ONE us-east-1 redeploy).
- **What/why:** the full set of Telegram registration-flow improvements agreed while walking the flow. All
  are message-string changes in the ops-agent. **Exact copy + rationale + file:line for every one is in
  [[M8C-ONBOARDING-IMPROVEMENTS]]** — do not re-derive; implement from there. Summary:
  - **Item 1** (`engine.ts:301`) — split the existing-account CONFIRM into two messages (explanation +
    instruction).
  - **Item 2** (`state-machine.ts:202` new / `:256` returning) — phone-ask **directory-scoped** privacy note
    (per decision D-PROMISE: claim only what the *directories* store, never "CELLO as a whole" — the portal
    holds a recoverable email; see [[project_no_pii_in_directory_hash_only]]).
  - **Item 3** (`state-machine.ts:317`) — returning users: "use the same email you registered with." **No
    email-prefix hint** (D-PII: registration side is hash-only by design).
  - **O1** (`state-machine.ts:497` and `:567`) — the pre-auth server-error message wrongly says "not
    something you can fix by retrying" but the code DOES auto-retry (EMAIL_CONFIRMED → `#retryPreAuth`).
    Correctness bug — reword.
  - **O2** (`:394/:401/:408`) — standardize the 3 OTP-failure phrasings + state the 15-min code lifetime.
  - **O3** (`:347`) — rate-limit message: add the wait duration (1 hour window).
  - **O4** (`:456`) — email-continuity rejection: explain the "same account = same email" why.
- **Difficulty:** Easy (strings). **Ship:** one ops-agent rebuild + redeploy (batch with OA-1).

---

## directory (`packages/directory/`)

### DIR-1 — SEC-2: unauthenticated FROST signing stream (forgery) ⚪  *(pre-existing; Andre's severity call)*
- **What/why:** NOT found in this session, but it's the one known **directory** fix and the highest-severity
  item on the books. The `/cello/frost/1.0.0` signing frames are unauthenticated; T directory partials alone
  meet threshold, so anyone with an agent's **public** key can forge its signatures. Internet-reachable.
- **Fix:** K_local-authenticate the frost signing stream (same challenge the signaling stream uses); phased
  client-then-directory rollout (breaks deployed clients if not lockstep — a migration decision).
- **Full writeup:** [[2026-07-07_1030_sec-2-frost-signing-forgery-finding]] + the fix-proposal doc; DoD
  "Tracked, not M8C-fruit" → SEC-2; BUILD-JOURNAL Entry 39. Also unblocks DOD-PRIMARY-1's ceremony-gate (D20).
- **Related:** SEC-1 (relay-park bare-content auth gap) — a narrower pre-existing directory/protocol finding,
  DoD "Tracked, not M8C-fruit." Not from this session; listed so it isn't lost.
- **Difficulty:** Large, cross-repo, migration-sensitive. **Not** a quick fix — its own focused effort.

---

## Deferred to M9 (feature, after launch)

### D21 — the full 4-level screening model + real content gating
- CC-1 restores the *security* (no auto-whitelist-on-knock) as a launch fix. The full model — **L1 Ignore /
  L2 Queue-silent / L3 Queue+notify-on-return / L4 Fast-track**, operator-selectable per agent, plus an
  actual **content gate** (today "screening" only changes the ack wording; content is accepted + queued
  regardless) — is a **CONFIG-1 / M9** feature. L3's "notify-on-return" is a genuinely new primitive.
- **Full design + built-vs-parked mapping:** [[2026-07-07_1700_four-level-screening-policy]] (D21 in
  [[M8C-DECISIONS]]).

---

## Ship mechanics (so a fresh context batches correctly)
- **ops-agent (OA-1, OA-2):** rebuild image → CI/CD deploy **us-east-1 only** (ops-agent is single-region).
  No cello-client publish. Batch OA-1 + OA-2 into one redeploy.
- **cello-client daemon + CLI + shim (CC-1…CC-9):** all ship via **one `/cello-publish` cascade** (bump the
  changed `core/*` packages + dependents, tag, CI publishes to beta, promote to latest). Batch ALL cello-
  client fixes into a single publish — don't publish per-fix. Then re-pin/reinstall + `cello login`.
- **directory (DIR-1):** `deploy.sh` (all 3 regions, ~25-30 min) — and only as part of the SEC-2 coordinated
  client-then-directory rollout, never alone.
- Gate every code change: `pnpm test → lint → typecheck → build` + `cello-unit-reviewer` before commit.

## Related
- [[M8C-LIVE-TEST-CHECKLIST]] — the live evidence behind every item + what's proven green
- [[M8C-ONBOARDING-IMPROVEMENTS]] — exact copy for OA-1/OA-2/CC-6/CC-7/CC-9
- [[2026-07-07_1700_four-level-screening-policy]] — CC-1 / D21 design
- [[M8C-DEFINITION-OF-DONE]] — what's ✅ proven vs still owed
- [[M8C-DECISIONS]] — D14/D15/D19/D20/D21 (the parked forks these reference)
