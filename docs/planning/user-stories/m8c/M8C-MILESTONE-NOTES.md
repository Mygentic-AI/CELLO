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

### B. Channels — Claude wakes instead of polling (the reactive core)

5. **Channel stage 1 — one-way wake on session open** — Claude Code wakes the instant a peer opens a
   session, instead of polling `cello_receive`. *You get:* the reactive inversion. Smallest unlock;
   prerequisite for CELLO reacting to anything. Nearly free: two shim edits, `connect` bump, **zero
   daemon change** (the event already crosses the socket).
6. **Channel stage 2 — wake on every inbound message** — *You get:* a real-time chat relay; Claude
   reacts to each message as it arrives, not just session creation. **Real daemon build**
   (content-arrival hook + `dispatchCelloMessage` + wiring + `session_id` in payload; Gaps 3–6).
7. **Channel stage 3 — platform relay (Telegram/Slack/Discord/Webhook)** — *You get:* reach your CELLO
   agent from your phone or team chat; Claude routes between the platform and CELLO both ways.
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

- **6 needs 5** · **7/8 need 6** · **17 builds on 16** · **19/20 sit on top of 18** · **11 is
  load-bearing for both 6/10 (reconnect + catch-up)**.
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

**Three refinements to the framing:**

1. **It's two unlocks, not one — very different sizes.** Session-request wake (**stage 1**) is nearly
   free: two shim edits, `connect` bump, zero daemon change. Message wake (**stage 2**) is a real
   daemon build (Gaps 3–6). The *very* first unlock is specifically stage 1; stage 2 is right behind
   but is a proper build — don't let "channels" hide that one is an afternoon and the other is a build.

2. **The actual first *action* is a de-risking spike, not a feature.** The design log leaves one thing
   **unverified**: whether Claude Code processes `notifications/claude/channel` as an interrupt with
   just the capability declaration, or whether it needs `--channels` (and org-side enablement in
   managed orgs). If the wake doesn't fire in the target runtime, the whole reactive track stalls and
   you've built a doorbell nobody hears. **~30-minute spike to prove a live Claude session actually
   wakes** — before building on it. This is the real "beginning": a spike, not a story.

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
`(0) spike: prove the wake fires → (1) stage-1 session-request wake → pair with use_agent auto-start
→ (2) stage-2 message wake, with since_seq alongside.`

---

## Open design questions

### ODQ-1 — Relay delivery model: continuous live router vs. away-triggered escalation-to-phone

When "reach me on my phone" (channel stage 3, Telegram/Slack/etc.) is built, there is a genuine fork
in *how* a peer's message reaches the operator's phone. It affects how much of Primary/Standby (#18)
you need and what the daemon must be able to do.

**Common ground (both models):** the daemon itself does NOT talk to Telegram. All platform delivery
goes through a running Claude router session that calls the platform bridge's `reply`/send tool. If
nothing is running to bridge, nothing reaches the phone — the message queues in the daemon and the
away answering-machine (#12) responds to the peer.

- **Model A — continuous live router (what the design log currently specifies).** Claude Code sits in
  the middle as a live two-way router. While the router session is up, EVERY inbound peer message is
  forwarded to the phone as it arrives (not conditional on non-response); operator replies typed in
  Telegram are relayed back to the peer via `cello_send`. Your phone becomes the live interface to the
  agent. **Caveat — foreground router, not a background bridge:** works only while a session is live
  with both channels attached and `--channels` enabled ("always-on" = keep the session running →
  naturally wants the always-on EC2 / Primary daemon of #18). A continuous speakerphone.
- **Model B — away-triggered escalation-to-phone (Andre's instinct; NOT currently designed).** A peer
  reaches the agent, no live operator picks up (away state), and THEN a targeted "something needs you"
  ping is pushed to the phone — a doorbell, not a speakerphone. Arguably the better UX for the "I'm out
  and about" case. It is a DIFFERENT feature from Model A and needs one of: (a) the **daemon itself** to
  hold a platform-push capability so it can ping directly on entering away-state, or (b) a lightweight
  always-on router session whose sole job is to escalate on non-response. Both are new build surface not
  described in the design log.

**Why it matters / how to decide later:** Model A is closer to what's written and reuses the
router/channel machinery, but demands a persistent foreground session (pushes you toward #18 early).
Model B is a smaller, more phone-native "doorbell" but adds a daemon→platform push path that doesn't
exist yet. The two are not mutually exclusive — B could layer on A later — but the FIRST relay build
should pick one deliberately rather than drifting into A by default just because it's what's drawn.

---

## Related Documents

- [[2026-07-01_1030_command-surface-and-notifications-design|Command Surface, Notifications, and Async Messaging Design]] — the planning-authoritative design log this distills
- [[2026-06-27_0753_claude-code-channels-cello-integration|Claude Code Channels × CELLO — Integration Model]] — code-level channel-protocol reference (file:line edit points, the publish cascade)
- [[M8B-SPEC]] — the federation milestone; M8C reuses its 5-doc apparatus shape
- [[M9-DEFINITION-OF-DONE|M9 Definition of Done]] — the security gateway; its merge/wire is the excluded integration prerequisite
- [[2026-07-01_0900_m8b-closed-e2e-testing-phase|M8B Closed — E2E Testing Phase]] — where the notification-wiring gap was first surfaced post-M8B
