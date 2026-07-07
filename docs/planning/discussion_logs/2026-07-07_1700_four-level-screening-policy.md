---
name: "Four-Level Screening Policy — unknown-sender treatment"
type: discussion
date: 2026-07-07
topics: [screening, contacts, whitelist, contact-1, away-1, config-1, notifications, doorbell, inbox, privacy, policy, m9]
status: decided
description: >
  Andre's confirmed 4-level per-agent screening policy for how an agent treats inbound contact,
  escalating by notification intrusiveness: 1 Ignore (silence) · 2 Queue-silent (I'll look) ·
  3 Queue + notify-on-return · 4 Fast-track (known). Known contacts are always Level 4; for unknown
  senders the operator picks 1/2/3. Surfaced live 2026-07-07 when a stranger (Ms_Chelly) reaching an
  unattended CELLO_Support got only the minimal "Dispatched." ack. Largely a CONFIG-1/M9 settings
  feature layered on mechanisms that mostly exist.
---

# Four-Level Screening Policy — unknown-sender treatment

## How it surfaced

During live M8C testing (2026-07-07), Ms_Chelly (an outside customer, unknown to CELLO_Support)
tried to reach CELLO_Support while it was online-but-unattended. Support replied only with the
minimal `"Dispatched."` (`STRANGER_TEXT`, `daemon.ts:960`) — the fixed unknown-sender behavior.
Andre's reaction: the *binary* known/unknown model is too blunt. Operators should **choose** how
strangers are treated, along a spectrum of how much they're allowed to intrude.

## The model — confirmed by Andre 2026-07-07

Four levels, escalating by **notification intrusiveness** (nothing → pull-only → push-on-return →
real-time):

| Level | Name | For | Behavior |
|---|---|---|---|
| **1** | **Ignore** | unknown | Silence. Not queued, no notification, no trace. "I don't want you entering my life in any way." |
| **2** | **Queue, I'll look** | unknown | Queued but **silent** — never interrupts. The operator decides when to check (e.g. on coming online) and whether to engage. |
| **3** | **Queue + notify on return** | unknown | Queued, and when the operator **comes back online** it proactively surfaces "you have pending items" — but still never interrupts mid-task. |
| **4** | **Fast-track** | known / whitelisted | Real-time. Interrupts welcome, immediate, full engagement. "You're on my whitelist — fast-tracked." |

**Two structural rules:**
1. **Known contacts are always Level 4.** Whitelisting = fast-track.
2. **For unknown senders, the operator selects the policy** (1, 2, or 3) per agent.

The single axis is *how intrusive the notification is allowed to be*: **nothing · pull-only ·
push-on-return · real-time.**

## Mapping onto existing CELLO mechanisms (built vs. parked)

| Level | Nearest existing mechanism | State |
|---|---|---|
| **L4** known fast-track | known-contact path + real-time doorbell (WAKE/MSGWAKE) | **Built** (CONTACT-1 + Tier 1/2 doorbell, live-proven) |
| **L2** queue-silent | today's *fixed default* for unknowns: session accepted + bounded (ABUSE-1: ≤3 sessions/unknown, ≤50 global), content queued, minimal `"Dispatched."` ack, no rich push | Roughly exists, but **fixed — not a chosen setting** |
| **L1** ignore/silence | the "opaque / silence" privacy mode CONTACT-1/AWAY-1 name | **Parked (D15)** on the M9 config store |
| **L3** queue + notify-on-return | the *proactive-wake-on-reconnect* the 2b live test preempted | **Not cleanly built/proven** |
| the **selector** (pick 1/2/3 per agent) | a `cello config set` policy | **Parked (CONFIG-1 / M9-CFG-001, D14)** |

> Confidence note: the L2 mapping is partly verified — `STRANGER_TEXT`/`isAttended` gate and the
> ABUSE-1 caps are confirmed in code (`daemon.ts:960/968/977`, `session-node-manager.ts:109-111`);
> that an unknown sender's message *content* is durably queued (not just the session request) was
> being verified when this design was captured — **finish that check before relying on L2-as-built.**

**Net:** this is largely a **settings feature layered on mechanisms that mostly exist** — a
post-M8C / M9 (CONFIG-1) build. L3's "notify on return" is the one genuinely new behavior (and it's
the same primitive the 2b test needs). Worth locking the design now; implement with the config store.

## Launch-relevant hole — the offline case (D19)

Every level from **2 up assumes the agent was ONLINE (even if unattended)** when the stranger
knocked — that's when the standing receiver accepts the session and the message queues. If the agent
is **fully offline**, the stranger bounces with `counterparty_unavailable` and **nothing queues**
(the D19 relay-discovery gap — new counterparty + offline recipient). So "support comes online and
checks" only catches what arrived *while support was online-but-unattended*, not what people tried to
send while it was down. For a real support agent that takes cold inbound around the clock, **closing
the offline-queuing hole (D19 / relay store-and-forward) is the companion piece** to this policy.

## Open implementation issue — auto-add-on-knock undermines the boundary (found live 2026-07-07)

**Verified in code + live.** The contact whitelist has TWO auto-add sites:
- `daemon.ts:3137` — outbound `initiate_session` adds the target. Correct (deliberate operator action).
- `daemon.ts:4418` — the **inbound-accept path adds the requester AUTOMATICALLY** when the standing
  receiver accepts the offer (comment at :4412 — "best-effort, must not block acceptance"; not gated on
  the operator being present or accepting).

**Consequence:** any sender who knocks *once* is promoted to "known" → **Level 4 fast-track thereafter.**
The screening (L1/L2/L3) only ever applies to a sender's **very first** message. After that they're
whitelisted, regardless of whether the operator ever saw or wanted them.

**Live proof:** Ms_Chelly (an outside customer) was auto-added to CELLO_Support's whitelist
(`added_at 1783436124520`) purely by sending a session offer to an **unattended** Support that only
auto-replied `"Dispatched."` — Agent B never accepted her. She is now a Level-4 contact of both Support
and Feedback.

**Confirmed again in a CONTROLLED run (2026-07-07, Phase 3/4):** Ms_Chelly was explicitly REMOVED from
Support's contacts (`contacts: []`), then knocked (Support online + unattended). Within the ONE session
(`dd7493…`): seq 0 = `"Dispatched."` (judged unknown), then she was **auto-re-added** (`added_at
1783442938087`, verified via `cello contact list`), then her actual message (seq 1) got the **known**
`"Agent is currently away…"` reply (seq 2). So the promotion happens **mid-session** — screening applies to
literally the first frame, after which the sender is Level-4. Worse: her message was **accepted and
queued** (`delivered:true`, surfaced in `check_notifications` as unread) — so there is **no content
screening at all today**; the only thing that varies by known/unknown is the wording of the auto-ack. The
D21 levels (esp. L1 Ignore and any real content gate) do not exist yet — the current system is ~a fixed,
leaky L2.

**This contradicts D21.** "Known" must be a deliberate trust boundary, not auto-filled by anyone who
contacts you once — otherwise the screening layer is defeated after the first message (a spammer knocks
once, then is fast-tracked forever). **Decision needed:** promotion to "known"/L4 should require
**operator action** (explicit accept, or an outbound initiate), NOT the standing receiver's automatic
session-accept. Separate "accept the *connection*" from "trust the *sender*."

**It also defeats ABUSE-1 anti-spam (confirmed live 2026-07-07, test 3f).** `checkUnknownSenderAcceptance
Bound` exempts known contacts (session-node-manager.ts:937), and the ≤3-sessions-per-unknown cap counts
only *unknown*-sender sessions. Because auto-add promotes the sender to "known" at session-1's accept,
sessions 2+ are exempt: a removed (unknown) Ms_Chelly opened **4 sequential sessions to Support, all
accepted, no ABUSE rejection**. The 25 MB per-session byte cap is per-session and also exempts known, so
it's bypassed identically. **So the auto-add-on-knock is the single root of BOTH the screening gap AND the
anti-spam gap.** This ELEVATES the fix: gating the inbound auto-add (daemon.ts:4418 — promote only on
operator action) is a **small, high-value fix that restores both defenses at once**, and is separable from
the larger D21 config/levels work. It should NOT wait for the full M9 CONFIG build.

**Testing note:** Ms_Chelly is now whitelisted on both Support and Feedback, so she can no longer serve
as an "unknown sender" — future unknown-sender / screening tests need a FRESH throwaway agent.

## Why this matters (CELLO's core value)

Screening unknown inbound is not a nicety — it's the trust/safety layer that is CELLO's reason to
exist (screening + prompt-injection defense). A per-agent, operator-chosen policy for how far a
stranger may intrude is the human-legible face of that layer: Ignore (hard boundary), Queue-silent
(review on my terms), Notify-on-return (I'll deal with it when I'm back), Fast-track (I trust you).

## Related Documents

- [[M8C-DEFINITION-OF-DONE]] — DOD-CONTACT-1 (whitelist), DOD-AWAY-1 (away/opaque modes), DOD-INBOX-1
  (queue + check), DOD-CONFIG-1 (the settings home)
- [[M8C-DECISIONS]] — D14 (CONFIG store parked), D15 (opaque/silence parked = L1), D19 (offline
  new-counterparty relay gap), and the new decision recording this model
- [[M8C-LIVE-TEST-CHECKLIST]] — the 2b / leave-a-message run that surfaced this; L3 = the preempted
  proactive-wake-on-return
- [[M8C-ONBOARDING-IMPROVEMENTS]] — sibling live-testing capture from the same session
