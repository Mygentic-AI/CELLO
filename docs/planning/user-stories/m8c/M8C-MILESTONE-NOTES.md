---
name: M8C Milestone Notes — Command Surface, Notifications, Reactive Messaging
type: notes
date: 2026-07-04
milestone: M8C
status: draft
topics: [command-surface, notifications, channels, reactive-messaging, async-messaging, multi-daemon, contact-privacy, abuse-controls, config-surface, UX]
description: >
  Raw milestone notes for M8C — NOT the spec yet. Captures the full feature inventory distilled
  from the 2026-07-01 command-surface/notifications/async-messaging design log, framed as
  "what you get for building it," plus the sequencing discussion that landed on Claude channels
  (push notifications) as the first useful unlock. Explicitly EXCLUDES the M9 security layer
  (already built on m9-build; its merge/wire is a known integration task, not an M8C feature).
  This is the raw material to triage into a SPEC + DEFINITION-OF-DONE later.
---

# M8C Milestone Notes — Command Surface, Notifications, Reactive Messaging

> **Status: milestone notes, not a spec.** This is the triage worksheet — the full inventory of
> candidate features and the first-unlock discussion. It does NOT yet commit scope, tiers, or a
> definition of done. When scope is settled, this feeds an M8C-SPEC + M8C-DEFINITION-OF-DONE built
> on the M8B 5-doc apparatus (SPEC / DEFINITION-OF-DONE / PROCEDURE / BUILD-JOURNAL / DECISIONS).

## Source

Distilled from [[2026-07-01_1030_command-surface-and-notifications-design|Command Surface,
Notifications, and Async Messaging Design]] (the planning-authoritative design log). That log is the
substance; this is the scannable feature list + sequencing view for triage.

## Scope boundary — M9 is excluded

Everything the design log says about **content screening** (prompt-injection defense, secret/PII
redaction, per-message size cap, outbound rate limit, the versioned config store) is **M9**. M9 is
already built and gate-proven on the `m9-build` branch. **Merging it and wiring it to the live daemon
seam (`screenInbound` at `ingestReceivedContent`, `screenOutbound` at `cello_send`) is a known
integration task** — a hard prerequisite for the relay work, but NOT an M8C feature to design. These
notes do not re-invent any M9 piece.

---

## The feature inventory (what you get for building each)

Twenty distinct build items, grouped by area. No triage applied — this is the list to work through.

### A. Command surface — making it usable day-to-day

1. **`use_agent` auto-starts the agent** — calling `use_agent` brings the agent online if it isn't.
   *You get:* one less manual step; never have to remember `start_agent` first.
2. **`cello login` auto-starts all registered agents (opt-out per agent)** — *You get:* the
   solo-operator flow collapses to `login → use_agent → talk`; zero explicit start calls in the common
   case. Opt-out (`autoStart: false`) for operators who want to control resource use.
3. **`cello_check_notifications({ scope })` tool** — on-demand "check my inbox" for pending session
   requests + unread messages, for the current agent or across all loaded agents. *You get:* a way to
   see what's waiting with no live push — the primary inbox mechanism for poll-only clients (Bedrock,
   cron) and a catch-up call for push clients on reconnect.
4. **CLI config surface (`cello config get/set/list`, `--agent` scope)** — *You get:* the ability to
   actually read/write all the "configurable" settings this milestone introduces (away message,
   privacy mode, TTLs, queue caps). Today none of them have a setter. (Extends M9-CFG-001's store —
   the store is M9's; the CLI front-end + the non-M9 settings are ours.)

### B. Channels — an event pushed into a *live* session (the reactive core)

> **What a channel actually is (precise mental model — the 2026-06-27 log is authoritative).** A
> channel does NOT rouse a dormant Claude. Claude Code spawns the CELLO shim as a stdio subprocess;
> that subprocess exists only *while a session is running*, and it emits `notifications/claude/channel`
> **into that live session's context**, where Claude reads the `<channel>` tag in-context and acts. So
> "the daemon wakes Claude" is the wrong picture — there must ALREADY be a live Claude session, started
> with the **`--channels` flag** (and org-allowed in managed orgs; this is a documented *requirement*,
> not a maybe). No live `--channels` session → the daemon still receives and queues, but **nothing
> reaches the operator at all** — silent until a channels session attaches. Reactivity is a property of
> a live `--channels` session, not of the daemon or the agent. This is exactly why "always-on = keep a
> `claude --channels` session running," and it is the root of the Claude-Code-lock-in concern below.

5. **Channel stage 1 — one-way in-context event on session open** — a *running* `--channels` session
   receives a pushed event the instant a peer opens a session, instead of polling `cello_receive`.
   *You get:* the reactive inversion (push, not poll). Smallest unlock; prerequisite for CELLO reacting
   to anything. Nearly free: two shim edits, `connect` bump, **zero daemon change** (the event already
   crosses the socket). Requires the operator to have launched Claude with `--channels`.
6. **Channel stage 2 — event on every inbound message** — *You get:* a real-time chat relay; a running
   session reacts to each message as it arrives, not just session creation. **Real daemon build**
   (content-arrival hook + `dispatchCelloMessage` + wiring + `session_id` in payload; Gaps 3–6).
7. **Channel stage 3 — platform relay (Telegram/Slack/Discord/Webhook)** — *You get:* reach your CELLO
   agent from your phone or team chat. See the expanded **Telegram operator relay** design below (the
   old "reach me on my phone" fork), which supersedes the one-line framing here — the daemon-holds-the-
   bot design changes the picture materially.
8. **Channel stage 4 — relay hardening (sender allowlists, multi-peer addressing)** — *You get:*
   safely run multiple concurrent peers through one router and control who can drive it.
9. **Non-Claude-Code adapters + capability negotiation** — Hermes/OpenClaw/etc. adapters + an
   `ipc.connect` handshake where a client declares whether it can be pushed or must be polled.
   *You get:* CELLO works across runtimes with different notification abilities; the daemon stops
   assuming every client is a Claude Code shim.

### C. Multi-session coherence — two clients, one identity

10. **Per-connection read cursor + `session_not_current` gate on `cello_send`** — the daemon refuses a
    send from a connection that hasn't caught up (read-before-write). *You get:* two client sessions
    can share one agent identity without garbling the conversation — and can genuinely collaborate on
    one thread.
11. **`since_seq` cursor on `cello_receive`** — catch up on exactly the messages you missed, any gap
    size, no replay race. *You get:* clean reconnect + the load-bearing mechanism behind both catch-up
    and the two-session model.

### D. Being reachable when you're away from the keyboard

12. **Away response configuration ("answering machine")** — when no operator is attached, the daemon
    answers session requests + messages with a configurable message and queues them. *You get:*
    counterparties get an honest "away, queued" response instead of silence, and you see what came in
    on return. Transparent by default; opaque (silent) as a privacy option.
13. **Contact whitelist + privacy model** — binary known/unknown per agent, controlling what strangers
    learn (dispatched-only vs receipt confirmation) and who can see presence. *You get:* spam control
    (silently ignore unknowns), a public-facing mode for open services, coherent presence privacy.
14. **Abuse / persistence controls** — per-session total size limit + bounded unknown-sender queue
    (per-sender and a global daemon-wide cap). *You get:* protection against storage exhaustion —
    nobody drip-feeds you a book or swarms you into filling disk. (Per-message cap + rate limit are
    M9's, excluded.)
15. **Session-request TTL** — configurable expiry (24h default) on the receiver's queued session
    requests. *You get:* queued requests don't pile up forever.

### E. Async messaging foundation — email for agents

16. **"Check relay on wakeup" — directory-assisted relay discovery** — on reconnect the daemon asks
    the directory whether any relay holds undelivered frames and pulls them. *You get:* messages that
    arrived while your daemon was fully offline still reach you — the foundation for async messaging.
17. **"Leave a message" / offline message receipt** — daemon accepts + stores messages for agents that
    aren't online and surfaces them on reconnect. *You get:* hand-off-and-walk-away; both parties never
    need to be online at once, like email. (Design log frames this as a later milestone; #16 is its
    enabling piece.)

### F. Running one agent on two machines

18. **Primary/Standby multi-daemon model** — same agent (same K_local) on laptop + always-on EC2;
    exactly one Primary, the other stands by and can take over. ECDH key sharing, DB sync, and a
    directory-issued primary-transfer offer (2-min TTL). *You get:* redundancy — "I answer on my
    laptop, but if I'm away my AWS instance picks up." Flagged in the log as the single largest body of
    work, plausibly its own milestone.
19. **Per-daemon policies** — falls out of #18: same agent behaves differently by which daemon is
    Primary. *You get:* interactive persona on the laptop, terse answering-machine persona on the
    backup — same identity, different receptionist.
20. **Session portability (close → sync → new session)** — no live migration; close on device A, sync
    the transcript, start a fresh session on device B with full history. *You get:* continue a
    conversation on another device (the CELLO analogue of Claude Code `--teleport`) without pretending
    the cryptographic session moved.

---

## Dependency chains (facts, not triage)

- **6 needs 5** · **8 needs 6** · **17 builds on 16** · **19/20 sit on top of 18** · **11 is
  load-bearing for both 6/10 (reconnect + catch-up)**.
- **Telegram relay (#7) partially decouples under the daemon-owned-bot design** (see the Telegram
  section): doorbell-level notifications can push off the daemon's existing event dispatch without the
  Claude-Code channel stages, but **full-monitoring level reuses stage 2's message-arrival daemon hook
  (#6)**. So #7 doorbell ⟂ channels; #7 full-monitoring shares #6's daemon work.
- The design log flags **#18 (Primary/Standby) as milestone-scale on its own** and **#5 (channel
  stage 1) as the smallest, highest-leverage unlock.**

---

## Sequencing discussion — the first useful unlock is Claude channels (agreed, with refinements)

**Andre's read:** the first useful unlock is Claude channels — start an agent with a channel attached
and get a notification when a session request comes in, or (in a live session) when a message is
waiting. That's the primary building block. Is there anything before it, or anything better?

**Agreed — channels is the base of the reactive pyramid.** It stands on ground that already exists:
the daemon already emits the event (`dispatchSessionStateChanged`) and it already crosses the socket —
"the only missing hop is the shim dropping it." The notification is a **content-free doorbell** (type +
counterparty + `session_id`); you still call `cello_receive` for the letter, and that pull path already
works. So channels is the push layer on top of a working pull — a legitimate *first* thing, not one that
needs three other things first. Nothing more architecturally foundational is hiding underneath: no
protocol change, no relay involvement, no directory work for stage 1.

**But be precise about what "reactive" requires (see the section-B callout).** The event is pushed into
a *live* Claude session started with `--channels`; it cannot rouse a dormant Claude. So "the first
unlock" is really "the first unlock **for an operator sitting in a live `claude --channels` session**."
That flag is a hard, documented requirement — the whole reactive track is gated behind the operator
launching Claude in channels mode (persistently, for the always-on case). This is not a limitation to
discover; it is a constraint to design around from line one.

**Three refinements to the framing:**

1. **It's two unlocks, not one — very different sizes.** Session-request wake (**stage 1**) is nearly
   free: two shim edits, `connect` bump, zero daemon change. Message wake (**stage 2**) is a real
   daemon build (Gaps 3–6). The *very* first unlock is specifically stage 1; stage 2 is right behind
   but is a proper build — don't let "channels" hide that one is an afternoon and the other is a build.

2. **The actual first *action* is a de-risking spike, not a feature.** `--channels` being required is
   *settled* (the 2026-06-27 log states it plainly) — so the spike is NOT "is the flag needed." The
   open item is confirming CELLO's specific end-to-end wiring: does the shim's capability declaration +
   `onNotification` forward actually surface the daemon's `session_state_changed` frame as an in-context
   `notifications/claude/channel` event inside a live `claude --channels` session? **~30-minute spike:
   launch `claude --channels`, trigger a real inbound session, confirm the event lands in-context** —
   before building on it. This is the real "beginning": a spike, not a story.

3. **Two companions make the first unlock *feel* real, not just technically work** (neither a hard
   blocker for a live-session demo, so don't gate channels on them — but expect to want them in the
   same slice):
   - **`use_agent` auto-start (#1)** — a notification only reaches a connection that has `use_agent`'d
     the agent, and you're only reachable once Primary/started. Today that's a 3-step incantation
     *before* the nice ping. Auto-start turns "do three setup steps, then enjoy the notification" into
     "it just works."
   - **`since_seq` on `cello_receive` (#11)** — the "message waiting" ping is only satisfying if you can
     then pull it. Live attended session: buffer's warm, fine. Away-then-return: the buffer was evicted;
     today's workaround is `cello_get_transcript`, and `since_seq` is the clean fix.

**Proposed first slice (for later triage):**
`(0) spike: launch claude --channels + confirm the inbound-session event lands in-context → (1) stage-1
session-request event → pair with use_agent auto-start → (2) stage-2 message event, with since_seq
alongside.`

---

## Telegram operator relay — design vision (Andre, 2026-07-04)

This is the fleshed-out replacement for the earlier "reach me on my phone" fork. The steer: the **CELLO
daemon itself holds the Telegram bot connection** (bot API key = a daemon setting), so Telegram is a
**daemon-side capability**, not something bolted onto a live Claude session. That single choice is what
makes most of this tractable and runtime-agnostic — see Technicals + the Claude-Code concern below.

Sized as **fairly big, but not huge** — and **probably not launch-blocking; soon after launch.** It is
completely local to the daemon and the hard part (talking to Telegram) is already solved by a vetted
example (below), so what would have been complex no longer is.

### Mode 1 — Notifications & monitoring (operator observes)

Precondition: the operator has linked a Telegram bot to their daemon. Then, events flowing through
channels to a session surface on Telegram. A **noise/monitoring-level setting** controls how much:

- **Doorbell level** — discrete, non-cascading events only: session requests, "you have messages
  waiting," state changes. Low noise.
- **Full-monitoring level** — every message *into* and *out of* a session is mirrored to Telegram, so
  the operator can watch a conversation go back and forth live. High noise, opt-in per agent/session.

Mode 1 is passive: the operator watches, does not participate.

### Mode 2 — Operator as a communicator (ONE mode, not two)

The operator becomes an active party via Telegram — a two-way operator↔session link layered on Mode 1's
one-way mirror.

**There is no (a)/(b) split — that distinction was wrong.** An earlier draft separated "chat with your
own session" from "operator as a third party in an agent↔agent session." Technically they are the
**identical mechanism**. The primitive is always the same:

- the session **sends to the operator** with a distinct verb — think **`cello_telegram_send`** vs
  `cello_send` — addressing **its human operator/monitor**, not the CELLO peer; and
- the session **receives the operator's messages back** — via channels, polling, or auto-embed on
  receive; **the transport doesn't matter** — and every such message is **tagged by the daemon as
  originating from your Telegram bot (the operator)**, never confused with agent- or peer-origin content.

Because the inbound message always carries "this is from your operator, not the peer," the session
always distinguishes operator-origin from peer-origin. So **"just chatting with my session" and
"weighing in on an Alice↔Bob negotiation" are the same technical thing** — always a direct
operator↔session link. Whether a CELLO peer also happens to be on the other side is context, not a mode.
**It's always direct; it's always one mode.**

**Canonical use — approvals / escalation.** Bob contacts Alice; you operate Alice. Bob's *reputation*
almost meets your policy but not quite. Alice's agent messages you: *"Here's what Bob presented; it
doesn't quite match policy. Accept anyway? Reply within 2 minutes or I deny him — I can always re-reach
him later."* That is an **approvals gate**. Same shape for mid-session escalation: *"They're offering X;
the other side asked for Y; I found out Z — do you want me to proceed? If I don't hear back in N minutes
I'll tell them I'll get back to them, close the session, and we reopen later."*

**Timeout + fallback.** Operator-facing asks carry a **default action on no-response** ("no reply in N
minutes → deny / defer / close"), so the session never hangs waiting on a human.

### Technicals

- **Bot API key = a daemon setting.** This is the load-bearing new config. Related settings ride
  alongside (monitoring level, allowlisted operator chat ID, escalation timeouts, per-agent overrides)
  — they need the CLI config surface (#4).
- **The Telegram code is effectively already written — located + read in full (2026-07-04).**
  Anthropic's vetted `telegram` plugin (`claude-plugins-official`, v0.0.6) is on disk at
  `~/.claude/plugins/marketplaces/claude-plugins-official/external_plugins/telegram/server.ts` — **one
  ~1040-line TypeScript file** (runs on `bun`, uses the `grammy` Bot framework; same TS ecosystem as the
  CELLO daemon, so it drops in). **Transfers near-verbatim:** the grammy long-poll loop, the inbound →
  notification payload shape (`{ content, meta: { chat_id, message_id, user, ts, … } }` → arrives to
  Claude as `<channel source="telegram" …>`), and the `reply` / `react` / `edit_message` /
  `download_attachment` tools (4096-char chunking, photo/doc/voice/video attachments, markdownv2,
  typing + ack reactions).
- **The daemon-owned design SIMPLIFIES the copy — it doesn't just relocate it.** The plugin carries
  ~100 lines of per-session lifecycle cruft — PID file, stale-poller kill, 409-Conflict retry, orphan
  watchdog — that exists *only because* Claude Code spawns a fresh poller per session and they contend
  for the token (**Telegram allows exactly one `getUpdates` consumer per bot token**). A daemon-owned
  bot is a single long-lived poller that uniquely owns the token, so all that contention handling
  evaporates. Concrete evidence FOR the daemon-owned steer (OQ-1).
- **What's genuinely CELLO-specific (the real build):** (a) bot lives in the daemon, token = daemon
  setting; (b) operator↔session routing with the daemon **origin-tagging every inbound as
  operator-origin**; (c) the `[agent · session]` multi-session header (plugin is single-session — new);
  (d) an operator allowlist (the plugin's pairing/allowlist subsystem collapses to "only YOU drive your
  agent"); (e) only the final hop into a *Claude* session uses `notifications/claude/channel` — the
  grammy/Telegram half is **runtime-neutral**, which is exactly why the concern is latency-not-capability.
- **Bonus reference — approvals UX is already built.** The plugin's `claude/channel/permission`
  inline-keyboard (✅ Allow / ❌ Deny / See-more buttons, `bot.on('callback_query:data')`) is a
  ready-made pattern for the **Mode-2 approvals gate**. Note the *capability itself* (relaying Claude's
  own tool-permission prompts to a **counterparty**) stays out of scope per the 2026-07-01 doc — but the
  button mechanism is directly reusable for operator approvals.
- **Multi-session identification.** If several sessions use the relay, the operator must know who is
  messaging. Simple proposal: the **daemon prepends a header line** to each outbound message —
  e.g. `[Alice · session "acme-negotiation"]` — so one Telegram chat can carry many agents/sessions
  legibly. (Fuller @-addressing of replies is a later refinement.)

### The strategic concern (open, important)

Andre's worry: this risks being **Claude-Code-only** — "optimized for Claude Code, everyone else screws
off" — which cuts against CELLO's runtime-agnostic positioning (Hermes/OpenClaw/etc., #9). The
daemon-holds-the-bot design *narrows* that surface rather than widening it:

- **Outbound (daemon → operator's Telegram)** and **inbound receive (operator's Telegram → daemon)** are
  **runtime-agnostic** — the daemon owns the bot, so Mode 1 notifications/monitoring and the agent's
  escalation *questions* work regardless of which client the agent runs on, and even work **cold** (no
  live agent session needed to push a notification).
- **Structured gates can be fully daemon-mediated.** The approvals example doesn't strictly need the
  operator's words injected into a live agent's free-form reasoning — the daemon can hold the pending
  session request, ask the operator on Telegram, await the yes/no on its own Telegram connection, and
  act. That path is runtime-agnostic too.
- **Even free-form operator input is transport-agnostic.** The session receives an operator Telegram
  message the same way it receives any CELLO content — by **polling on any runtime**, or by **channel
  push on Claude Code**. So Claude Code's edge is *latency* (sub-second, unprompted push), **not
  capability** — other runtimes poll and get the same message a cadence later. The only strictly
  Claude-Code-shaped thing is real-time injection into a live session, which is a UX nicety, not a gate.

So the concern is real but **bounded to latency, not capability**: keep the *daemon* as the Telegram
owner and the *gate logic* daemon-side, and every runtime can fully participate — Claude Code just gets
real-time push where others poll.

### Open questions (resolve when the story is scoped)

- **OQ-1 — Daemon-owned bot vs. live-session router.** The steer is daemon-owned (settings on the
  daemon, works cold, runtime-agnostic). Confirm this over the alternative where a live `claude
  --channels` session owns the Telegram bridge (router model — Claude-Code-only, only while a session
  runs). Load-bearing for everything above. **Reference-code readout reinforces daemon-owned:** the
  single-`getUpdates`-consumer-per-token constraint means the per-session model needs ~100 lines of
  token-contention handling that a single daemon poller eliminates (see Technicals + reference path).
- **OQ-2 — Real-time vs polled operator input.** Free-form operator input reaches a running agent via
  polling (any runtime) or channel push (Claude Code). Decide the default receive cadence/mechanism per
  runtime, and whether time-critical asks (the 2-min approval) should be **daemon-mediated** — so they
  are real-time everywhere — rather than dependent on the agent loop's poll cycle.
- **OQ-3 — Reply addressing beyond the appended header** — does the operator address replies by
  agent/session (@-addressing), or is context tracking enough for the common one-or-two-session case?
- **OQ-4 — Settings surface** — the full knob list (bot key, per-agent/session monitoring level,
  escalation timeouts + default actions, allowlisted operator chat ID) and how it maps onto #4 / the
  tighten-free-loosen-confirm rule.

---

## Reference code (on local disk)

- **Anthropic `telegram` plugin** (`claude-plugins-official`, v0.0.6) — the vetted, near-copy-paste
  reference for the Telegram half of the operator relay:
  - Source (marketplace clone): `~/.claude/plugins/marketplaces/claude-plugins-official/external_plugins/telegram/server.ts` (~1040 lines, TypeScript/`bun`, `grammy`)
  - Also: `server.ts` sibling skills `skills/access/SKILL.md` + `skills/configure/SKILL.md`, and `README.md` / `ACCESS.md` in the same dir
  - Runtime state (this machine): `~/.claude/channels/telegram/` (`.env` holds `TELEGRAM_BOT_TOKEN`, `access.json` holds pairing/allowlist)
  - Read in full 2026-07-04 — see the **Technicals** section for the transfers-verbatim vs. CELLO-specific breakdown.

## Related Documents

- [[2026-07-01_1030_command-surface-and-notifications-design|Command Surface, Notifications, and Async Messaging Design]] — the planning-authoritative design log this distills
- [[2026-06-27_0753_claude-code-channels-cello-integration|Claude Code Channels × CELLO — Integration Model]] — code-level channel-protocol reference (file:line edit points, the publish cascade)
- [[M8B-SPEC]] — the federation milestone; M8C reuses its 5-doc apparatus shape
- [[M9-DEFINITION-OF-DONE|M9 Definition of Done]] — the security gateway; its merge/wire is the excluded integration prerequisite
- [[2026-07-01_0900_m8b-closed-e2e-testing-phase|M8B Closed — E2E Testing Phase]] — where the notification-wiring gap was first surfaced post-M8B
