---
name: M8B fix briefs — cascade 1 (FINDING-1, F14, F13, F16 + riders)
type: discussion
date: 2026-07-02
topics: [m8b, fix-briefs, diagnosis, seal, standing-receiver, cello-client, handoff]
status: active
description: >
  Root-cause diagnoses and implementation-ready fix briefs for the M8B cascade-1 fix batch.
  FINDING-1 and F14 are fully diagnosed from code + live evidence (both confirmed client-side).
  Written by the diagnosis session (Fable) as the handoff artifact for the implementation
  session (Opus). Companion to the test-results journal and friction log.
---

# M8B Fix Briefs — Cascade 1

Handoff artifact: diagnosis done at high effort; implementation intended for a separate session.
Every brief below names exact files/lines, the violated invariant, the fix spec, falsification
checks already performed, and the tests to write FIRST (SPARC — red before implementation).

**All fixes in this cascade land in `cello-client`. No directory changes are required.**
One version-bump/publish cascade covers everything (per repo `/cello-publish` rules).

Companions: [[2026-07-02_1122_m8b-e2e-test-results-journal]] (evidence),
[[2026-07-02_1130_m8b-e2e-ux-friction-log]] (F1–F21 detail).

Source tree references below are in `/Users/andrep/Documents/code/cello-client` at commit
`1146e7f` (daemon 0.0.20 — verified identical to the version deployed on the EC2 demo agent,
so the diagnosed source is exactly what ran).

---

## BRIEF 1 — FINDING-1: unilateral seal deadlock (`seal_pending_bilateral` forever)

**Status: ROOT CAUSE CONFIRMED — 100% client-side (daemon). The directory behaved correctly.**

### Root cause

`daemon.ts` close flow (relay-witness path, ~2370–2493) can only escalate to a unilateral seal
on the SAME call that first submits the SEAL leaf. Any retry is permanently locked out:

1. **Close #1** (typically < grace window): `submitSealLeaf` succeeds → sets the
   `#responderSealSubmitted` idempotency mark (`session-node-manager.ts:2065`) → 30s bilateral
   wait times out → escalates to unilateral (`daemon.ts:2429+`) → directory correctly replies
   `seal_unilateral_too_early` (grace not elapsed) → returns `seal_counterparty_pending`.
   **The `reportedRootHex` needed for escalation is discarded when the call returns.**
2. **Close #2+** (after grace): `submitSealLeaf` hits the mark → returns
   `{ok:false, reason:"responder_seal_already_submitted"}` — **carrying no `reportedRootHex`**
   (`session-node-manager.ts:2062-2064`).
3. That reason passes the guard at `daemon.ts:2385`, waits 30s for a bilateral seal that can
   never come (counterparty dead, never submitted its SEAL leaf), then hits `daemon.ts:2421`
   `if (!submit.ok) → return seal_pending_bilateral`. **The unilateral escalation at `:2429`
   is unreachable on every retry.**

**The design flaw:** `daemon.ts:2416-2427` conflates two distinct producers of
`responder_seal_already_submitted`:
- (a) the auto-ack path submitted our leaf because the COUNTERPARTY's SEAL arrived →
  bilateral will finalize → returning "pending" is correct (the case the comment describes);
- (b) our OWN earlier close attempt submitted it and the counterparty is gone → bilateral
  will NEVER finalize → must escalate, but cannot (no root on the not-ok result).

The only scenario where a unilateral seal can ever succeed today: the operator's FIRST-EVER
close happens > `deliveryGraceSeconds` (600s) after the peer died. Any earlier close attempt
permanently poisons the session.

### Evidence (session `47d83ad14b9d765616d8133c3626a0ee`, 2026-07-02)

- Local `~/.cello/daemon.log`: `session.seal.leaf.submitted` seq 3 at 10:13:31Z (close #1);
  **zero seal events afterward across 4+ retries; the string "unilateral" appears nowhere in
  the entire log.** The client never sent a second `seal_unilateral` frame.
- Retry guidance string matches `daemon.ts:2425` byte-for-byte — pins the branch taken.
- Close #1 returned `seal_counterparty_pending`, which requires an actual
  `seal_unilateral_too_early` reply from the directory (a timeout would yield
  `seal_unilateral_timeout`) — directory received frame #1 and gated it correctly.

### Falsification checks performed

- Idempotency mark cleared between retries? No — only cleared on relay submit FAILURE
  (`session-node-manager.ts:2081`); close #1 succeeded, daemon never restarted (same pid). ✗
- Case (a) applied (auto-ack)? No — the counterparty never submitted a SEAL leaf (killed
  before closing; confirmed in journal). ✗
- Retry took a different code path? No — exact guidance-string match to `:2425`. ✗

### Fix spec

In `session-node-manager.ts`:
- Change `#responderSealSubmitted` from `Set<string>` to
  `Map<string, {reportedRootHex: string, sequenceNumber: number}>`.
- Store the values on successful first submit (they exist at `:2090-2091`).
- On the already-submitted path, return
  `{ok:false, reason:"responder_seal_already_submitted", reportedRootHex, sequenceNumber}`.

In `daemon.ts` close flow:
- Split the `:2421` guard by producer: if `submit.reason === "responder_seal_already_submitted"`
  AND the result carries a `reportedRootHex` that originated from THIS party's own close (it
  always does — see invariant note below), fall through to the unilateral escalation at `:2429`
  using the carried values instead of returning `seal_pending_bilateral`.
- Keep the 30s bilateral wait before escalating (unchanged): if the counterparty ratifies or the
  auto-ack case's bilateral seal lands in that window, `sealedP` resolves first and we return the
  bilateral result as today. Double-escalation is safe: the directory's grace gate +
  already-sealed checks reject/absorb a redundant `seal_unilateral` (it replied `too_early`
  correctly during the live test).
- Invariant note for the implementer: in case (a) (auto-ack submitted the leaf), the bilateral
  seal is already in flight on the relay; escalating after a 30s timeout is still safe because
  the directory arbitrates. Do NOT try to distinguish (a) from (b) client-side — let the
  directory's gates decide. That is the sovereign-node-correct shape.

**Rider F20 (same files, trivial):** `daemon.ts:1899-1901` resolves the unilateral waiter with
only `{ok:false, reason}` — thread the directory's `remaining_seconds` (present on the
`seal_unilateral_too_early` frame, `directory-frames.ts:1126`) through the waiter result and
into the `seal_counterparty_pending` guidance ("unilateral seal available in ~Ns").

### Tests to write first (red)

1. Repro: bilateral session; counterparty node destroyed without closing; close #1 inside grace
   → `seal_counterparty_pending`; advance past grace; close #2 → MUST produce a unilateral seal
   (`ok:true, seal_type:"unilateral"`), not `seal_pending_bilateral`. (This is the exact live
   failure; it must be red against 0.0.20 behavior.)
2. Auto-ack regression guard: counterparty's SEAL arrives → auto-ack submits our leaf → our
   explicit close during the bilateral window → returns the BILATERAL result (no premature
   unilateral).
3. `remaining_seconds` surfaced on the too-early path (F20).
4. Idempotency preserved: two rapid close calls → exactly one relay leaf submission.

Extend `packages/e2e-tests/src/session-fixture.ts` via `opts` — never a from-scratch fixture.

**Verification against the live stuck session:** `47d83ad1` predates the fix and its relay/session
state may be unrecoverable; do NOT treat un-sticking it as an AC. The AC is the repro test + a
fresh live crash-seal round-trip on the demo agent after publish.

---

## BRIEF 2 — F14 / FINDING-2: standing receiver never re-arms (demo deaf after one session)

**Status: ROOT CAUSE CONFIRMED — three compounding gaps, all client-side (daemon).**

### Root cause chain (evidence: EC2 journald, unit `cello-daemon`, 2026-07-02)

1. **Trigger — fixed-port collision.** The EC2 unit pins
   `CELLO_LISTEN_ADDR=/ip4/0.0.0.0/tcp/4001` (required for the fixed public announce addr).
   Only standing receivers use this env (`daemon.ts:262-266`); the consumed receiver KEEPS
   port 4001 while it lives on as the session node. The immediate re-arm
   (`acceptSession` → `#ensureStandingReceiver`, `session-node-manager.ts:1211`) tried to bind
   the same port and failed:
   `09:02:47.911 session.node.create.failed — EADDRINUSE 0.0.0.0:4001` (logged, error level —
   the failure was NOT silent in the log; it was silent to every operator surface).
2. **No retry on create failure.** `#ensureStandingReceiver` (`:2922-2987`) leaves no entry on
   failure; its doc comment says "the next consume-site ensure() call retries on demand" — but:
3. **The inbound path never calls ensure.** `waitForStandingReceiver` (`daemon.ts:3220-3228`)
   only POLLS `getStandingReceiverReady` for 3s and drops the offer (`:3238-3245`) — it never
   kicks creation, and it early-returns BEFORE `acceptSession` (whose not-ready branch would
   have kicked ensure at `:1140`). And `destroySessionNode` — the moment the port frees — does
   not re-arm either. So after one EADDRINUSE, the agent is deaf forever, even though the port
   was free again minutes later.

Confirming fingerprints: the 3s gap between `assignment.unverified` and `accept.failed` at both
09:37 (48→51s) and 09:56 (17→20s) is exactly `waitForStandingReceiver`'s poll window; no second
`session.node.create.failed` ever appeared (ensure was never re-invoked — its failure path always
logs). Local dev never repros because non-fixed-port receivers bind `/ip4/127.0.0.1/tcp/0`.

### Architectural constraint (do not "fix" around it)

On a fixed-port deployment, an armed standing receiver and an active handed-off session CANNOT
coexist — both need the port. Inbound concurrency on such deployments is structurally 1 until a
listener/session split exists (future story). The correct v1 shape is SERIAL sessions with
reliable re-arm, not concurrent receivers.

### Fix spec (all in `cello-client` daemon)

1. **Re-arm on teardown:** at the end of `destroySessionNode`
   (`session-node-manager.ts:~1216+`), if the agent is online and has no standing receiver,
   `void #ensureStandingReceiver(agentName, correlationId)`. This is the natural retry point —
   the handed-off node has just released the port.
2. **Ensure-on-demand in the inbound path:** `waitForStandingReceiver` (or its caller
   `acceptInboundAssignment`, `daemon.ts:3230+`) must kick
   `ensureStandingReceiverForAgent(agentName)` BEFORE polling, so the poll is waiting on a
   creation it actually started. This makes the doc comment's "retries on demand" true.
3. **Bounded retry with backoff in `#ensureStandingReceiver`** on create failure (e.g. 3
   attempts, 1s/5s/15s) — covers the fixed-port race where teardown and re-arm interleave.
   Keep the existing `#standingReceiverCreating` guard semantics; ensure the retry loop cannot
   wedge the creating-flag (clear it in `finally` as today).
4. **Fail LOUD:** when an ONLINE agent ends up with no armed receiver after retries, emit an
   alarm-worthy event (`session.standing_receiver.dead` or similar, error level, with
   agentName + last failure reason) — distinct from the per-attempt `session.node.create.failed`.
5. **Surface health:** `cello_status` already carries `standing_receiver_ready`
   (`daemon.ts:1179`, currently the ANY-agent aggregate) — make it per-agent so a deaf agent is
   visible. (Do not expand scope into the F5/F17 status redesign — just this field.)

### Tests to write first (red)

1. Consume the standing receiver into a session with a factory stub that fails the next create
   with EADDRINUSE once → destroy the session → receiver MUST be re-armed (via teardown re-arm
   and/or retry), and an inbound accept afterward MUST succeed. (Red today: nothing re-arms.)
2. Inbound assignment arriving while no receiver exists and none is being created → the accept
   path itself triggers creation and the offer is accepted within the wait window. (Red today.)
3. Online agent with all create attempts failing → loud terminal event emitted; per-agent
   `standing_receiver_ready:false` in status. (Red today.)
4. Regression: `cello_stop_agent` during an in-flight ensure still tears down cleanly
   (existing L1 tombstone semantics preserved).

**Demo-repo rider (trivial, separate commit in the demo repo):** sync the stale
`demo/cello-demo.service` with the already-fixed deployed unit
(`After=`/`Requires=cello-daemon.service`).

---

## BRIEF 3 — F13: `initiate_session` false success when the offer was never accepted

**Status: diagnosed sufficiently; small design decision embedded (recommendation below).**

### Mechanism

When the responder cannot proceed it aborts SILENTLY — `session-ceremony.ts:59-64` logs
`session.offer.abort` and returns; nothing is sent to the directory. The directory then folds an
EMPTY counterparty endpoint into the FROST-signed assignment (the hazard is documented in the
`wireSessionOfferHandler` doc comment, `session-ceremony.ts:39-45`). The initiator's client
accepts this broken assignment and returns `ok:true + sessionId`; the failure only surfaces on
the first `cello_send` (`session_stream_unavailable`) — or worse, never, to a demo-style user.

### Design decision (recommended: client-only validation)

Fix at the initiator: after receiving the assignment, VALIDATE that
`counterparty_session_peer_id` / addrs are present and well-formed BEFORE returning from
`cello_initiate_session`. If empty → return
`{ok:false, reason:"counterparty_unavailable", guidance:"The counterparty did not accept the
session offer (it may be offline or unable to receive). No session was established."}` and do
not create local session state (or tear down what was provisionally created — no phantom
sessions; this also removes the F9/F10-adjacent phantom accumulation seen as `09fa513e`,
`ffcba2f7`).

Why this shape: it catches EVERY cause of a missing accept (abort, offline, crash, timeout) at
the trust boundary the client already owns, requires no directory change (keeps cascade 1
client-only), and is the correct validate-what-you-receive posture. A richer
`session_offer_reject {reason}` frame + directory forwarding is a directory-batch follow-up
(pair with F21) — do NOT attempt it in this cascade.

### Tests to write first (red)

1. Responder with no standing receiver (offer will be aborted) → initiator's
   `cello_initiate_session` returns `ok:false, reason:"counterparty_unavailable"` and no session
   row / node exists afterward. (Red today: returns ok + sessionId.)
2. Healthy round-trip regression: normal accept still returns `ok:true` with unchanged shape.

---

## BRIEF 4 — F16: counterparty-gone detected but invisible to the operator

**Status: no diagnosis needed — pure plumbing. The signal already exists.**

`session.liveness.changed → gone` is tracked per session in `#sessionLiveness`
(`session-node-manager.ts`, wired at `#wireSessionLiveness :1075+`) and readable via
`getSessionLiveness(agentName, sessionId)` (`:1117-1119`). Nothing consumes it on the MCP
surface.

### Fix spec

1. **`cello_receive` / `cello_receive_session`:** when the wait would return a null timeout,
   first check `getSessionLiveness` — if `gone`, return a distinct result
   (`reason:"counterparty_gone"`, with guidance pointing at `cello_close_session` and the grace
   window) instead of `{content:null}`.
2. **`cello_status`:** include per-session `liveness` for active sessions. (Do not touch the
   `interrupted_sessions` inclusion rule — that is F17, deferred to the design batch.)

### Tests to write first (red)

1. Kill the counterparty node mid-session → `cello_receive` returns `counterparty_gone`
   (not a null timeout). 2. Status shows `liveness:"gone"` for that session. 3. Regression:
   alive-but-quiet session still returns the normal null timeout.

---

## Riders (no diagnosis required, include in the same cascade)

- **F1/F2 (CLI):** add `refresh` to the usage string; add `--help`/`-h` handling on
  subcommands; reject unknown flags instead of coercing to positional args.
  Package: `@cello-protocol/cli`.
- **F15 (log noise):** downgrade `session.inbound.assignment.unverified` to debug OR append
  `"(expected until SESSION-004)"` to the note — it fires on every healthy inbound session and
  actively misled diagnosis.
- **F20:** folded into Brief 1 (same files).

## Explicitly OUT of this cascade

- **Directory-side work** (F21 terminal-reason surfacing, offer-reject forwarding, unilateral
  rejection-branch observability): batch into a future directory deploy — 25-30 min deploys,
  repo rule says batch ALL directory changes.
- **Design-heavy UX:** F5-CORR/F17/F18 (status/state semantics), F6/F7/F12 (directory
  selection + daemon lifecycle), F9/F10 (cleanup) — need design sessions first.

## Publish procedure for the implementing session

`cello-client` changes span `core/daemon` (+ `core/client` only if seal-manager types are
touched) and `cli`. Run `/cello-publish` — do not publish from memory. Full SPARC per brief;
gate sequence (`test → lint → typecheck → build`) + code review before each commit. After
publish: update the EC2 demo agent to the new versions and re-run a live inbound-session +
crash-seal round-trip as the smoke test (the journal's restart sequence applies).

---

## Related Documents

- [[2026-07-02_1122_m8b-e2e-test-results-journal|M8B E2E test-results journal]] — the live-test evidence (sessions `47d83ad1`, `a6a2f9af`) these root causes were diagnosed from; carries the consolidated fix backlog these briefs implement.
- [[2026-07-02_1130_m8b-e2e-ux-friction-log|M8B E2E UX friction log]] — full detail for F13/F14/F16/F20 and the riders (F1/F2/F15); the friction entries are the requirements source for Briefs 2–4.
- [[2026-07-01_0900_m8b-closed-e2e-testing-phase|M8B closed — E2E testing phase kickoff]] — the testing-phase plan whose scenarios (#2, #6) surfaced FINDING-1 and FINDING-2.
- [[2026-07-01_2215_final-message-receive-race-and-initiator-verified-false|Final-message receive race + verified:false]] — the PRIOR fix cascade that produced daemon 0.0.20 (the exact version diagnosed here). Note: its "Finding 1" (receive race) is a different finding from this phase's FINDING-1 (unilateral seal deadlock).
- [[M8B-SPEC|M8B Federation Spec]] — defines the j-unilateral journey; FINDING-1 (Brief 1) is a crash-path escalation defect that journey's test shape (retry after grace) did not cover.
- [[2026-07-02_1640_m8b-cascade-1-implementation-and-publish|M8B cascade 1 — implementation, publish, live verification]] — every brief here implemented, published (daemon 0.0.21 / cli 0.0.19, tag v0.0.62), and verified live end-to-end.
