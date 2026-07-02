---
name: M8B cascade 1 — implementation, publish, live verification
type: discussion
date: 2026-07-02
topics: [m8b, fix-briefs, seal, standing-receiver, cello-client, publish, smoke-test]
status: active
description: >
  Implementation record for the M8B cascade-1 fix batch (FINDING-1, F14, F13, F16 + riders
  F20/F15/F1/F2). All four briefs implemented full-SPARC (red tests first) in cello-client,
  reviewed, published as daemon 0.0.21 / cli 0.0.19 (tag v0.0.62), deployed to the EC2 demo
  agent, and verified with a live inbound-session + crash-seal round-trip.
---

# M8B Cascade 1 — Implementation, Publish, Live Verification

Implements every brief in [[2026-07-02_1514_m8b-fix-briefs-cascade-1]] exactly as diagnosed.
All fixes client-side (`cello-client`); the directory was not touched.

## What shipped (cello-client commits, all on main)

| Commit | Content |
|---|---|
| `16ed4e0` | **Brief 1 / FINDING-1** — unilateral seal escalation survives a retry close. `#responderSealSubmitted` Set→Map carrying the first submit's `{reportedRootHex, sequenceNumber}`; close-flow guard split by producer so a retry escalates with the ORIGINAL reported root instead of returning `seal_pending_bilateral` forever. **F20** rider: `remaining_seconds` threaded into the `seal_counterparty_pending` guidance. |
| `7aa9306` | **Brief 2 / F14** — standing receiver reliably re-arms: teardown re-arm on `destroySessionNode`/`retireSessionNode`/`markInterruptedWithDetails` (third path found by the code reviewer), ensure-on-demand in the inbound accept path, bounded retry (1s/5s/15s), loud `session.standing_receiver.dead` terminal event, per-agent `standing_receiver_ready` on both status surfaces. |
| `a2440cd` | **Brief 3 / F13** — `cello_initiate_session` rejects an assignment with an empty `counterparty_session_peer_id` → `counterparty_unavailable`, before any dial or local session state (no phantom sessions). **Brief 4 / F16** — `cello_receive` returns `counterparty_gone` (+liveness+guidance) instead of a plain null timeout on a dead session; `active_sessions` with per-session liveness on both status surfaces. **F15** — `session.inbound.assignment.unverified` warn→debug with "(expected until SESSION-004)". |
| `e0fc389` | **F1/F2 (CLI)** — usage lists every command (refresh/receipts were missing); `--help`/`-h` on all subcommands; unknown flags rejected instead of coerced to positionals (new testable `cli-args.ts`). |
| `ae20fdc` | Version cascade — daemon 0.0.20→**0.0.21**, cli 0.0.18→**0.0.19**. |

trustless-cello: `0c912af6` — demo rider: `demo/cello-demo.service` synced verbatim with the
deployed unit (`After=`/`Requires=cello-daemon.service`).

Process: full SPARC per brief — red tests first (17 new tests across 5 new test files, all
verified red against 0.0.20 behavior before implementation), gate sequence
(`test → lint → typecheck → build`, 928 repo tests green), `feature-dev:code-reviewer` on every
brief (Brief 1: clean + one hardening; Brief 2: one IMPORTANT finding — the
`markInterruptedWithDetails` teardown path — fixed red-test-first; Briefs 3/4/riders: clean).

## Publish (per /cello-publish)

- Tag **v0.0.62** (tag counter, not the connect version) → CI green including `smoke-tag`.
- Published to `beta`: `daemon@0.0.21`, `cli@0.0.19`. Unchanged: crypto 0.0.14,
  protocol-types 0.0.11, transport 0.0.11, client 0.0.41, **connect 0.0.53** (pure IPC shim —
  no code change needed; new result fields pass through verbatim).
- Verified against the binary: `npm pack @cello-protocol/daemon@0.0.21` dist greps confirm
  `session.standing_receiver.dead`, `counterparty_unavailable`, `counterparty_gone`, and the
  seal-retry code; `cli@0.0.19` pins `daemon@0.0.21` (no `workspace:*`); `cli` dist contains
  `cli-args.js`.
- **Promoted to `latest`** (Andre, 2026-07-02, after the v0.0.63 follow-ups): cli 0.0.20 and
  daemon 0.0.22 newly tagged; connect 0.0.53 / client 0.0.41 / crypto 0.0.14 / transport 0.0.11 /
  protocol-types 0.0.11 already current. All seven verified via `npm view @latest`. The default
  operator install path now serves the cascade-1 fixes.

## Demo agent updated (i-0ad3e7c22470f266e, us-east-1)

`/opt/cello-demo` → daemon 0.0.21 + cli 0.0.19, documented restart sequence (daemon → 5s →
demo). Healthy startup fingerprint confirmed: `agent.signaling.created` →
`directory.signaling.connected` → `agent.online` → `session.node.created` → `demo.started`.
Local operator stack updated too (`npm i -g @cello-protocol/cli@0.0.19`, daemon restarted).

## Live verification (operator stack ↔ demo agent, 2026-07-02 14:35–14:50 UTC)

1. **Inbound session 1** (`4761de4f…7680`): initiate → demo accepted → content round-trip →
   `cello_close_session` → **bilateral seal with legibility certificate** (auto-ack regression
   path confirmed on 0.0.21).
2. **F14 live, end-to-end in the demo daemon journal**: accept consumed the receiver → immediate
   re-arm failed `EADDRINUSE 0.0.0.0:4001` → bounded retries at +1s/+5s/+15s (4 total
   `session.node.create.failed`) → **`session.standing_receiver.dead`** (error, attempts:4) →
   seal teardown at 14:36:35 → **teardown re-arm created a fresh receiver in the same second**.
   On 0.0.20 this exact sequence left the agent deaf forever (FINDING-2).
3. **Inbound session 2** (`cd70b86e…115c`): accepted immediately — the re-armed receiver works.
4. **F16 live**: demo daemon+demo stopped mid-session (counterparty killed without closing) →
   `cello_receive` returned `reason:"counterparty_gone", liveness:"gone"` with
   close/grace guidance (previously an indistinguishable null timeout).
5. **F20 live**: close #1 inside grace → `seal_counterparty_pending` with
   **"A unilateral seal becomes available in ~484s"**.
6. **FINDING-1 live**: close #2 after grace (14:47:53 UTC) →
   `{ok:true, sealed_root:"0a42ed04b7c04070d1feee4d12517dd266c01cf3670d584db58ad3cd8fddd248",
   seal_type:"unilateral"}` — the exact retry call that returned `seal_pending_bilateral`
   forever on 0.0.20 (session `47d83ad1`) now completes the unilateral seal. Demo services
   restarted afterward and confirmed healthy (`agent.online`, `session.node.created`,
   `demo.started`).

## Review follow-ups (same day, tag v0.0.63 — daemon 0.0.22 / cli 0.0.20)

The reviewers' three sub-threshold observations were also fixed (cello-client `ad795a3` +
cascade `b8d82ec`), plus one gate gap found while verifying:

- **CLI help precedence**: `--help`/`-h` now wins from ANY argv position (dedicated pre-scan) —
  previously an earlier unknown flag masked it, and `--limit -h` swallowed `-h` as the limit
  value. Pinned by red-first tests.
- **Cache retention on interruption**: analyzed rather than "fixed" — evicting session caches in
  `markInterruptedWithDetails` would discard drainable unread messages after a transient blip
  AND cancel the armed TTF park-backstop timers exactly when a dying session needs them
  (MSG-001). The deliberate retention is now documented at the code site; caches are reclaimed
  at seal or restart.
- **Root-suite gate gap (found, fixed)**: `core/daemon` and `core/cli` had been missing from
  `vitest.workspace.ts` since REPOSPLIT-002 — CI's Test step had NEVER run either suite
  (507 tests invisible). Added to the workspace; the two daemon binary-spawn tests now pin the
  child cwd to the package root so `--import tsx` resolves under a root run. v0.0.63's CI is the
  first run to execute the full 1435-test suite.
- Demo agent + local stack rolled to 0.0.22/0.0.20; live sanity session + bilateral seal green.

## What this unblocks

- The j-unilateral journey's crash-path escalation defect is closed; a crashed counterparty can
  always be sealed out after grace, regardless of how many close attempts preceded it.
- The demo agent survives its fixed-port constraint indefinitely (serial inbound sessions with
  reliable re-arm) — the 10-minute stranger flow no longer dies after one session.
- Directory-side follow-ups (F21 terminal-reason surfacing, offer-reject forwarding) remain
  batched for a future directory deploy per repo rule.

## Related Documents

- [[2026-07-02_1514_m8b-fix-briefs-cascade-1|M8B fix briefs — cascade 1]] — the diagnosis handoff these fixes implement.
- [[2026-07-02_1122_m8b-e2e-test-results-journal|M8B E2E test-results journal]] — the live evidence behind the briefs.
- [[2026-07-02_1130_m8b-e2e-ux-friction-log|M8B E2E UX friction log]] — F13/F14/F16/F20 + rider requirements.
