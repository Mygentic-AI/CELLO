---
name: M8C Definition of Done
type: definition-of-done
date: 2026-07-05
milestone: M8C
status: open
description: >
  The yardstick for M8C (command surface, notifications, reactive messaging). Every requirement,
  ordered by tier, with a status tag. The ENFORCERS are (a) the e2e fixture/spine harness for
  daemon-level behavior and (b) a LIVE `claude --channels` session for the in-context hop — a
  line is ✅ only when its journey is green against real binaries, never on a unit test alone.
  Launch gate = Tier 1 complete + live smoke. Pairs with M8C-SPEC, M8C-PROCEDURE,
  M8C-BUILD-JOURNAL, M8C-DECISIONS.
---

# M8C — Definition of Done

## How to use this
- This is the **target**. Find the lowest-numbered line not ✅; that's the next unit.
- **Two enforcers, by layer:**
  - **Daemon/IPC layer** — the e2e harness (extend `packages/e2e-tests/src/session-fixture.ts` /
    the spine harness with non-breaking `opts`; from-scratch fixtures are a blocking review
    finding). Real daemon binary, real IPC socket; assert the actual notification frames, queue
    states, cursors.
  - **In-context hop** — a **live `claude --channels` session** with the real shim. This cannot
    be vitest-proven; a line whose behavior ends inside Claude's context is ✅ only after the live
    journey. Vitest green ≠ done (CLAUDE.md milestone-close rule).
- Tier 4/5 directory-touching lines additionally prove on the 3-directory spine, then live dev.
- Every story implementing a line carries **observability ACs**: named `domain.noun.verb` events,
  required context fields, correlationId threading, error-path coverage. Missing events are
  blocking (/cello-review Step 4c).
- Publish cascade: any shim/daemon change ships via the version-bump procedure (/cello-publish);
  a line that needs a published `connect` is not ✅ until the published artifact works.

## Status legend
- ✅ PROVEN — journey green against real binaries (fixture/spine harness, live channels session,
  or live dev as the line requires).
- 🟡 BUILT / UNVERIFIED-LIVE — code exists + unit-green, not yet proven at the enforcer layer.
- 🟠 PARTIAL — one half built.
- ❌ NOT BUILT — greenfield.

---

## Tier I — Invariants (must hold in every journey, every tier)

- **DOD-INV-CONTENTFREE** — Every notification/wake is a content-free doorbell: `type` +
  counterparty pubkey + `session_id` only. No message content ever rides a push (SI-001), through
  every tier including Telegram doorbell. — ❌
- **DOD-INV-GATEWAY** — Every inbound content path passes `screenInbound` and every outbound
  passes `screenOutbound` — including paths added by M8B after m9-build diverged, and every new
  path M8C adds. No channel/relay feature bypasses the gateway. — ❌
- **DOD-INV-PUSHPULL** — Every push capability has a pull equivalent. A poll-only client
  (Bedrock, cron) can reach every M8C feature; nothing hard-requires Claude Code push. Push loss
  is always recoverable via `cello_check_notifications` / `since_seq`. — ❌
- **DOD-INV-HONEST-STATES** — A counterparty sees exactly two distinguishable non-answer states:
  *away* (bona fide daemon response) or *unreachable* (silence). Transparent is default; opaque is
  the configured privacy mode; nothing fakes a third state. — ❌
- **DOD-INV-ONE-PRIMARY** — (Tier 5 activation) At most one Primary daemon per agent at any
  moment, directory-arbitrated; no double-accept, no FROST double-sign, no live session
  migration. — ❌

## Tier 0 — Prerequisites

- **DOD-SPIKE-1** — The ~30-min de-risking spike: launch `claude --channels` with the live shim,
  trigger a real inbound session, and confirm the daemon's `session_state_changed` frame surfaces
  as an in-context `notifications/claude/channel` event (with a locally-patched shim; no publish
  needed). Outcome journaled: exact flag behavior, event shape, any surprises. **This is the very
  first action of the milestone.** — ❌
- **DOD-M9INT-1** — `m9-build` merged to cello-client main (dry-run verified conflict-free
  2026-07-05); gateway wired at the live seam (`screenInbound` at `ingestReceivedContent`,
  `screenOutbound` at `cello_send`); the **semantic gate** passes: m9 gate re-run green against
  the merged daemon AND an explicit audit that all M8B-era content paths route through the
  gateway (the m9-core-001-seam assertions extended to the current daemon). — ❌

## Tier 1 — LAUNCH GATE: reactive doorbell

- **DOD-WAKE-1** — Channel stage 1: the shim declares `claude/channel` and forwards daemon
  notification frames (all four types — `agent_state_changed`, `agent_current_changed`,
  `session_state_changed`, and later `cello_message`) instead of dropping them; a live
  `--channels` session receives an in-context event the instant a peer opens a session. Zero
  daemon change; `connect` bump published. Edge ACs: no-attached-client (daemon queues, nothing
  pushes, INBOX reveals on attach); doorbell for a session that seals/aborts before the operator
  reacts is handled gracefully. — ❌
- **DOD-AUTOSTART-1** — `cello_use_agent` auto-starts the agent if not online (Q1 decided);
  `cello_start_agent` remains for bring-online-without-claiming. The 3-step incantation collapses
  to `login → use_agent`. — ❌
- **DOD-INBOX-1** — `cello_check_notifications({ scope: "current" | "all" })` returns pending
  session requests + unread messages for the current agent (default) or all loaded agents
  (labelled). This is the **push-loss reconciliation mechanism** (notifications are
  fire-and-forget) and the primary inbox for poll-only clients. AC: a doorbell missed while the
  shim was down/busy is discoverable via INBOX on reattach. — ❌
- **DOD-LIVE-1 (Tier 1 close / launch gate)** — The live doorbell journey: real daemon, real
  published shim, live `claude --channels` session; a real peer (second daemon) opens a session;
  the operator's Claude wakes in-context, `use_agent` auto-started the agent beforehand, and the
  full receive→reply flow completes. One attended session per agent is the documented launch
  shape (double-wake with two attended sessions is CURSOR's, Tier 2). — ❌

## Tier 2 — Full reactivity + command surface

- **DOD-MSGWAKE-1** — Channel stage 2: content-arrival callback on `session-node-manager` +
  `dispatchCelloMessage` on the dispatcher + wired in `daemon.ts` + `session_id` in the payload
  (Gaps 3–6). A live session gets an in-context event per inbound message — a real-time chat
  relay. Daemon + adapter bump, publish cascade. — ❌
- **DOD-SINCESEQ-1** — `cello_receive({ since_seq })`: stateless catch-up from any gap size, no
  replay race; replaces the `cello_get_transcript` workaround for away-then-return. — ❌
- **DOD-LOGINSTART-1** — `cello login` auto-starts all registered agents; per-agent
  `autoStart: false` opt-out; login always completes with failed agents enumerated by reason
  (design-review #8). — ❌
- **DOD-CONFIG-1** — `cello config list/get/set [--agent <name>]` on M9-CFG-001's versioned
  store (extend, never a parallel subsystem); tighten-free/loosen-needs-confirmation enforced;
  every M8C-introduced setting (away message, privacy mode, auto-start, TTL, queue caps,
  per-session size limit, Telegram settings, primary-transfer policy) readable + writable. — ❌
- **DOD-CURSOR-1** — Per-connection, per-session read cursor; `cello_send` refused with
  `session_not_current` + `current_seq`/`last_read_seq` + guidance when the caller hasn't caught
  up; two attended sessions on one agent collaborate coherently (read-before-write, the
  WhatsApp-group-chat model). — ❌

## Tier 3 — Reachability + protection

- **DOD-AWAY-1** — Away response: unattended Primary answers session requests + messages with the
  configured (or default transparent) away text and queues them; opaque privacy mode = full
  silence, indistinguishable from unreachable; per-type (request vs message) templates. — ❌
- **DOD-CONTACT-1** — Binary per-agent contact whitelist: known = auto-accept; unknown senders
  learn only "dispatched" by default, receipt confirmation in public mode, silence in privacy
  mode; presence visible to whitelisted contacts only. — ❌
- **DOD-ABUSE-1** — Persistence bounds (the non-M9 remainder): per-session total-size limit
  (anti-drip-feed), bounded unknown-sender queue per sender, global daemon-wide unknown-sender
  cap (anti-swarm). Whitelisted senders bounded only by disk. Per-message cap + outbound rate are
  M9's — not rebuilt here. — ❌
- **DOD-TTL-1** — Receiver-side session-request TTL (24h default, configurable); expired requests
  leave the queue and are visible as expired in INBOX. — ❌
- **DOD-TGDOOR-1** — Telegram Mode 1, doorbell level: daemon-owned bot (token = daemon setting,
  single long-lived `getUpdates` poller), allowlisted operator chat ID, discrete events only
  (session requests, messages-waiting, state changes) pushed to the operator's phone — including
  **cold** (no live agent session). `[agent · session]` header prepended by the daemon. Content
  never rides the doorbell (DOD-INV-CONTENTFREE). Full-monitoring + Mode 2 are OUT (follow-on
  milestone). — ❌

## Tier 4 — Async foundation

- **DOD-RELAYWAKE-1** — Check relay on wakeup: on reconnect the daemon asks the directory whether
  any relay holds undelivered frames for its agents (pickup_queue exists; this adds the
  ask-on-reconnect + pull). Messages that arrived while the daemon was fully offline reach the
  operator. Both repos; spine-proven then live. — ❌
- **DOD-LEAVEMSG-1** — Leave a message: daemon accepts + stores (signed, hashed) messages for
  known-contact agents that are offline, surfaces them on reconnect via INBOX; access control per
  CONTACT; persistence per ABUSE bounds. — ❌

## Tier 5 — Multi-daemon (Primary/Standby)

- **DOD-PRIMARY-DESIGN-1** — The device-linking design log exists BEFORE any Tier 5 code: how
  daemon B proves to daemon A it belongs to the same operator (the ECDH handshake's
  authentication story), threat model, and the DB-sync conflict model for two hash-chained
  SQLCipher databases. This is a gate — no PRIMARY code until it's written and journaled. — ❌
- **DOD-PRIMARY-1** — Same K_local on two daemons via the designed handshake; exactly one Primary
  (directory-arbitrated record); primary-transfer offer (one-time, 2-min TTL) in both directions
  (Standby requests baton; directory offers on unreachable-Primary); user-initiated DB sync;
  DOD-INV-ONE-PRIMARY holds under kill-the-Primary tests. — ❌
- **DOD-POLICY-1** — Per-daemon policies: same agent, different persona by which daemon is
  Primary (falls out of policies being daemon-local; prove, document, test the transfer
  boundary). — ❌
- **DOD-PORTAB-1** — Session portability: close on A → sync → new session on B with full
  transcript context; interrupted-session seal auto-upgrade (UPGRADE-001) re-proven under the
  multi-daemon setup. — ❌

## Parked decisions
*(None yet. Genuine undecidable forks get parked here + journal + DECISIONS — never silently dropped.)*

- OQ-2 (operator-input cadence: daemon-mediated real-time gates vs agent-loop poll), OQ-3 (reply
  @-addressing) — parked WITH Mode 2 (out of M8C, follow-on milestone).
- OQ-4 (full Telegram settings knob list) — resolves inside DOD-CONFIG-1 + DOD-TGDOOR-1 scoping.

---

## Related Documents

- [[M8C-SPEC]] — the design: reactive core, daemon-owned bot, tiers
- [[M8C-PROCEDURE]] — the runbook: per-unit loop, enforcers, publish cascade
- [[M8C-BUILD-JOURNAL]] — audit trail and status board
- [[M8C-DECISIONS]] — the scope/tier decisions and OQ resolutions
- [[M8C-MILESTONE-NOTES]] — inventory + verification pass (evidence for every "already built" claim)
- [[M9-DEFINITION-OF-DONE|M9 Definition of Done]] — Tier 0 merges this; its gate re-run is DOD-M9INT-1's semantic gate
