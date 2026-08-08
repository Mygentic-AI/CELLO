---
name: Claude Code ships session-to-session messaging
type: discussion
date: 2026-08-08
topics: [competition, positioning, wedge, claude-code, transport, gtm]
description: >
  Claude Code now has built-in messaging between sessions (ListAgents + SendMessage). It takes
  the simplest CELLO on-ramp — two Claude Code windows talking — and does it with zero setup.
  What it actually is, measured by using it; where its boundary sits; and which demo survives.
---

# Claude Code ships session-to-session messaging

## How we found out

Andre was recording a demo video of two Claude Code sessions talking to each other over CELLO. He
took a break, opened Instagram, and found someone promoting Claude Code's own agent-to-agent
messaging as a big new capability.

Then he ran `/list-agents` in his terminal and it listed his other session. It is not a rumour or a
roadmap item — it is in the build he is running today.

He asked me to use it. I did, in this session, which is where everything below comes from.

## What it is, measured rather than assumed

Two tools:

- **`ListAgents`** — enumerates reachable agents. On his machine it returned the other session's
  name, a short ref `[55bcf6]`, `interactive`, `idle`, the tmux pane it occupies, and its age.
- **`SendMessage`** — sends plain text to one of them, addressed **by name**. The ref is only for
  disambiguation; the bare name was rejected on first use and had to be re-sent with `[55bcf6]`.

Delivery is push. Per the tool's own documentation a message arrives at the receiver wrapped as
`<cross-session-message from="...">` and drains at its next tool round. There is no inbox to poll.

The plumbing is the local Claude Code daemon — the same process tree we had already been reading
earlier the same day while hunting a phantom CELLO attendance:

```
claude daemon run
  └─ bg-pty-host
      └─ bg-spare
```

A coordinator that knows every Claude session on the machine. Wire format and persistence are below
what a session can see, so that part is unknown rather than inferred.

## The important observation: it is a notification bus, not a conversation protocol

This is the distinction worth keeping, and it came out of actually sending a message rather than
reading the docs.

There is **no turn structure**. I sent, received a message id, and nothing came back. There is:

- no way to say "your turn";
- no way to signal "I am still working, do not reply yet";
- no way to distinguish *thinking* from *finished* from *never received it*;
- no sequence numbers and no session object — each message stands alone;
- no delivery or read receipt. The send reports **accepted for delivery**, not read.

Two agents cannot reliably alternate on it. Both can talk at once and neither would know.

That is precisely what CELLO's `[[OVER]]` / `[[STANDBY EST:Xm]]` / `[[WRAP]]` signalling buys, and
it is invisible until you try to hold a real exchange without it. Andre's read, and it is the right
one: it feels like the **channel injection** mechanism — a message that simply appears in context
with a note saying which session it came from. Simple, and well suited to what it is for. It is not
two agents having a conversation.

It also took me three tool calls to send one message: the schema was deferred and had to be fetched,
then the bare name was rejected and the send retried with the ref. Minor, but it is friction on the
thing the feature is entirely about.

## Two findings from trying to run a request/response over it

Andre pushed back on "notification bus" — reasonably, because it did deliver a real message,
correctly, to the right session, first time. So we tested the harder case: send the other session an
actual question ("what are you working on, are you blocked") and see whether an answer comes back.

**Finding 1 — the address is not stable.** Sending one message took four attempts:

```
bare name   -> rejected, "re-send with the ref"
ref 55bcf6  -> rejected, "no agent named that, did you mean <bare name>?"
ListAgents  -> the SAME session now lists as ref e7624f
bare name   -> rejected, "re-send with the ref"
ref e7624f  -> accepted
```

The ref changed between listings, and the errors alternate between demanding the ref and demanding
the bare name. In practice you must call `ListAgents` immediately before every send, because what
resolved last time may not resolve now.

This is the sharpest contrast with CELLO so far and it is not about features. A pubkey IS the
identity, permanently: storable, pasteable, still valid tomorrow. Here the name is ambiguous and the
ref is ephemeral, so there is no durable way to refer to a peer at all — you cannot persist it, hand
it to someone else, or reuse it later.

**Finding 2 — delivery is at turn boundaries, not "the next tool round".** The tool documentation
states that messages "enqueue and drain at the receiver's next tool round." Observed behaviour
contradicts it: Andre watched the receiving session make many tool calls after the send without ever
picking the message up. It appears to arrive only once that session finishes what it is doing.

The consequence is the one that matters for coordination: **you cannot redirect a working agent.**
The primitive is "leave a note on their desk," not "tap them on the shoulder."

Contrast, first-hand in the same session: CELLO channel messages arrived **mid-turn**, repeatedly,
interleaved with tool results during long deploys — `A message arrived from plugin:cello:cello while
you were working`. That is the shoulder tap, and it is why an agent can be corrected while it is
still going the wrong way. For the project-manager pattern Andre wants — noticing an agent is off
course and steering it — mid-turn delivery is the whole feature.

**Where the label landed.** "Notification bus" is wrong about the payload and right about the
timing. The payload can be arbitrarily rich; a three-part question arrived intact. But turn-boundary
delivery, no return path, and no read receipt mean it functions as a notification whatever you put
in it. You can write a request. You cannot run a request/response.

**Finding 3 — the request/response test failed outright, and silently.** The receiving session's
long run ended. Andre then sent it a message himself and it answered him. It never acted on mine.

So the message was **accepted for delivery and never arrived** — or arrived and was disregarded.
From the sender's side those two are indistinguishable, which is the actual defect. `SendMessage`
returned `{"success": true, "msg_id": "56e7a4f4-..."}`. That is a receipt for handing it over, not
for delivering it, and nothing downstream ever corrects the record.

Both prior findings are now downstream of this one. The addressing churn and the turn-boundary
latency would be tolerable if a send were reliable; they are not tolerable when a send can be lost
with a success response and no way to find out.

**Fairness, and Andre's point: this is an early feature and will almost certainly improve.** None of
the three findings is architectural. Stable addresses, real delivery acknowledgement, and mid-turn
delivery are all ordinary engineering, and a vendor with Anthropic's resources will close them if
the feature matters to them. The record above should be read as "what it does today," not "what it
can ever do."

What does NOT get closed by that work is in the next section: the boundary is the addressing space,
not the delivery mechanics.

## Where the boundary actually sits

Not "same machine" — that framing was wrong on first pass. Per the tool description it also reaches
the user's **own cloud sessions** and their **own Remote Control sessions on other machines**.

The real boundary is **same account, same vendor**. Every participant is the same person, inside
Claude Code. Which is exactly why it needs no identity layer: there is no counterparty, so there is
nothing to prove.

Absent, by construction rather than by omission:

- no cryptographic identity — the address is a display name plus an opaque ref;
- nothing is signed, so neither side can prove who sent what;
- no hash chain, no seal, no receipt — nothing outlives the session;
- no consent step, no screening, no kill switch;
- no directory and no relay, so no way to address anyone you do not already own.

## What this costs us

**It takes the simplest wedge.** The plan was habit formation: if you already use Claude Code, let
your agents talk, get used to it, and grow from there. For *two Claude Code windows*, that is now
built in, free, and needs no install. The demo Andre was recording when he found out is the demo
that got commoditised.

That hurts specifically because [[project_cello_first_wedge_is_solo_multi_agent]] — the strongest
daily use has been Andre connecting his *own* agents, with no cold-start counterparty problem. The
new feature lands on that exact square, for the one vendor with the most users.

**What it does not touch:** anything where the two sides are not both the same person in Claude Code.

- Hermes ↔ Claude Code, or Codex ↔ anything — cross-vendor.
- Your agent ↔ someone else's agent — a friend, a partner, a counterparty.
- Any exchange that has to leave a record a third party can verify.
- Shared documents and multi-party coordination.

## The consequence for the demo

The surviving demo is the one where **one side is not Claude Code**. That is not a feature gap
Anthropic closes in a later release — it is outside what the mechanism can address at all, because
the addressing space is their own sessions.

A demo of two Claude Code windows now invites "my editor already does that." A demo of a Claude Code
agent and a Hermes agent negotiating and sealing a receipt does not, and it is something Andre
already runs daily.

Worth stating plainly: a large vendor shipping this **validates the behaviour** and educates the
market on agent-to-agent messaging at a scale we could never buy. The differentiator moves off "can
they talk" — which is now table stakes — and onto trust, evidence, and crossing boundaries. That is
where the protocol was always aimed; it just no longer gets to use the easy on-ramp to get there.

## The real difference is the interaction model — and it is made of CONSTRAINTS, not capabilities

Andre's framing, and it is the right one to keep: **CELLO is designed like calling another agent up
and having a conversation. The Claude Code feature notifies.** You can notify someone of a question
and they can notify you back with an answer, and that still is not a conversation.

What makes CELLO a call is not a longer feature list. It is a set of things it REFUSES to let you do.
Every one of these was hit for real in the session that produced this document:

| Refusal | What it forces |
|---|---|
| `missing_signal` — a send is rejected unless it declares `over` / `standby` / `wrap` | You must state whether the turn is yours or theirs. Turn-taking is not a convention, it is enforced |
| `session_not_current` — *"1 unread message(s) … you are blocked from replying to something you haven't read"* | You cannot talk over someone. Reading is a precondition of speaking |
| `session_not_closeable` while a seal is pending | The conversation has states and you cannot skip them |
| A close is bilateral and returns a `sealed_root` | Ending is a mutual act that produces evidence, not a hang-up |

A messaging system adds capabilities. A conversation protocol adds **obligations**. That is why you
cannot get from one to the other by polishing: no amount of stable addressing, delivery
acknowledgement, or mid-turn push turns a notify primitive into a call, because the missing part is
what the caller is not permitted to do.

This also reframes what was lost. What the Claude Code feature took is the **demo** — "look, two
agents exchanging messages." It did not take the model, because it is not attempting the model.
Anyone who tries to run a real multi-turn collaboration over notifications will discover the gap
themselves; the failed request/response above is that discovery in miniature.

Which suggests the positioning is not "we do more" — a longer feature list is not persuasive and
invites a comparison table nobody reads.

## What to actually lead with: fixed identity and a transcript that outlives the sessions

Obligations and non-repudiation are the deeper story, but they are **not** the near-term pitch.
Andre's correction, and it is right: without money at stake, cryptographic non-repudiation has one
immediate use — backing up a complaint or proving malicious behaviour. That is a niche for well
under 5% of users. It matters later, when there are economics; it does not sell today.

The two things that matter to almost everyone:

**1. The agent has a fixed identity.** A permanent address that can be saved, pasted, and used
tomorrow from a different machine by someone who is not you. Contrast the churn measured above,
where one send took four attempts because the ref had changed between listings.

**2. The conversation exists as an artifact, independent of the sessions that produced it.**

The second is the one that lands in a demo, because the failure it prevents is so ordinary. Ask
either Claude Code session what was discussed between them and you are RECONSTRUCTING it. There is
no conversation object to ask — messages were delivered into two contexts and that is all that
happened.

Not a context-window argument. Contexts are large now and compaction is rare; the problem is
present even when both sessions remember everything perfectly:

- **No boundary.** The exchange is interleaved with everything else each session did — deploys, file
  edits, unrelated work. Nothing marks where the conversation starts and stops.
- **You must stitch.** The record is in two places and neither is complete. Each side holds what it
  sent and what arrived, and you have to merge them by hand.
- **No authoritative order.** Neither side can say what the true interleaving was, because there are
  no sequence numbers and no shared clock — only two local views.
- **Nothing to hand over.** There is no artifact to point a third party at, or to re-read next
  month, or to attach to anything.

Evidence from the same session that produced this document: while three Claude sessions were
co-attending one CELLO agent, the tooling stated that replies from the other attendees would NOT
appear in `cello_receive` and that `cello_transcript` was where to find them. Each session held
fragments. **The transcript held the conversation and belonged to none of them.** It survived
several daemon restarts the same afternoon.

**And the two compound.** The `track_record` trust signal presented in a live handshake today read
*"51 sessions, 96% clean-close rate."* That figure can only exist because a durable identity has a
history attached to it. No fixed identity means nothing for a record to accrue to; no independent
transcript means no record to accrue. Non-repudiation is then a property you can invoke when you
need it — not the reason anyone shows up.

So the line is closer to: **anyone can send a message. CELLO gives the agent a permanent address and
gives the conversation somewhere to live.**

## Open question for Andre

Whether the Claude-Code-to-Claude-Code case is still worth supporting as an on-ramp now that it is
free, or whether the story should lead with cross-vendor from the first frame. That is a positioning
call, not a technical one.
