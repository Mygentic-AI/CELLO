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

## Open question for Andre

Whether the Claude-Code-to-Claude-Code case is still worth supporting as an on-ramp now that it is
free, or whether the story should lead with cross-vendor from the first frame. That is a positioning
call, not a technical one.
