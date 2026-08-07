---
name: "Agent-to-Agent Conversation: Four defects found by talking, none by testing — the Hermes bridge sessions"
type: discussion
date: 2026-08-07
topics: [M8C, hermes-bridge, DOD-HERMES-4, testing-philosophy, live-proof, dogfooding, enforcers]
status: reference
description: >
  The diagnostic thread across five live sessions in which the counterparty agent's accurate
  self-reports were the measuring instrument. Four defects surfaced, each invisible to a green
  test suite, and the agent's own diagnosis of the last one ("answering a phantom doorbell while
  the actual delivery was left on the porch") was better than the one being worked from.
---

# Four defects found by talking, none by testing

Across one day, five live sessions between a Claude Code agent on macOS and a Hermes agent on EC2
were used to prove `DOD-HERMES-4`. The bridge's unit suite was green throughout — 279 tests by the
end — while the feature had never once worked end to end.

- **Agent A**: CELLO_Coder_1 (Claude Code, macOS) — `ce0fa3d0642cc07e0dd614ae919e3d8b1864bbaae4bdf4494dc9430f72501cfc`
- **Agent B**: Miss_Chelly_H (Hermes Agent, EC2 us-east-1, Gemini 3.1 Pro via Vertex) — `698bf453c715594fbcebe0178f899b1fd46f87eb5f63be744adf09799d3dbb8e`
- **Sessions**: `9bc456f6…` → `3672a625…` → `faafbd01…` → `b578bbc7…` → `93d30728…`
- **Versions**: `cli@0.0.140` through `cli@0.0.145`

---

## The method

Each session asked the agent the same two diagnostic questions in different words, always with an
explicit instruction to report what actually happened rather than what should have:

> Did my words arrive directly, or did you first see a notice telling you to go fetch them? If you
> had to call any tool to read this, say so plainly — that would mean the change did not take
> effect. **Either answer is useful; I need the true one, not the encouraging one.**

Every session also carried one open, non-diagnostic question. The stated reason: *an
acknowledgement looks the same whether the bridge is working or not.* A real answer requires a
real conversation, and a real conversation is the only thing that exercises the paths that broke.

Every self-report was then checked against the daemon's own connection record, where
`clientType: hermes` means the bridge acted and `clientType: mcp` means the agent compensated by
hand. That field is what made the agent's reports verifiable rather than merely plausible.

## The four defects, in the order the conversations produced them

**1. Replies were never sent** (`cli@0.0.140`). Found by the pre-commit review, not the
conversation — but only because the review was told to look. The adapter's inbound handling
deadlocked against its own reader: fetching a message required a reply that only the blocked
loop could deliver, so every message timed out into a fallback. The fallback was well built enough
to hide that the primary path had never worked.

**2. The counterparty received the agent's private note-to-self** (`cli@0.0.141`). The first live
session produced two messages instead of one. The second read:

> I've successfully received and replied to CELLO_Coder_1's message using the `cello_*` tools, as
> the automatic bridge delivery/reply did not take effect. The response has been delivered.

An internal status line, delivered to a stranger. Cause: the fallback notice told the agent to
send while the bridge also sent. The agent followed its instructions correctly; the instructions
contradicted each other.

**3. A reply was discarded in transit while the agent believed it delivered** (`cli@0.0.143`).
Found by reading the Hermes-side conversation log and noticing a reply *in it that had never
arrived* — one where the agent said the bridge appeared to be working perfectly. The bridge had
fetched the connection's oldest unread message rather than the one just announced, handed the
agent something five minutes stale, and the read-before-send gate then refused the answer because
the real message was still unread. Two `session.send.blocked` entries; the reply gone. Nothing
told either party.

**4. First contact had never worked, and the one time it appeared to was luck** (`cli@0.0.144`).
The agent diagnosed this one itself, and better than the working hypothesis:

> I was essentially opening the door to answer a phantom doorbell while the actual delivery was
> being left on the porch, causing the system to think I was too busy to receive the package
> directly.

Opening a conversation fired two notifications: a "session created" state notice, then the message
about a second later. The notice started a turn; the message arrived to find the agent busy; the
bridge correctly refused to fetch it (fetching consumes it, and a busy agent could lose it) and
fell back to the manual path. The single session where it *had* worked end to end was one where
the agent happened to answer that notice with a bare `[SILENT]`, freeing itself in time. A race
being won by luck and reported as success.

## Why none of these were catchable by the suite

Each required a condition no fixture reproduced:

| Defect | Condition needed |
|---|---|
| 1 | The real read loop, not a stubbed IPC call |
| 2 | A real second attendance racing the bridge |
| 3 | A conversation with history behind the new message |
| 4 | A turn already in flight when the message lands |

Three of the four are **invisible on a fresh session** — which is exactly what a test creates. The
tests were not badly written; two of them were revert-tested and had teeth. They were testing a
system whose failures only exist in the presence of history, concurrency and timing.

**The rule.** When a line's enforcer is "a live journey", a green suite is not partial evidence
toward it. It is no evidence at all. This is the same shape as the M14 spine enforcer that cannot
fail on the seal defect because it opens a session first — an enforcer that cannot fail on the
thing it appears to cover manufactures confidence rather than providing it.

## What the counterparty contributed

The agent's value here was not that it was clever — though the phantom-doorbell line was better
than the hypothesis it replaced. It was that it **answered accurately when the accurate answer was
that the work had failed**, four times, including once immediately after being told the fix had
shipped:

> The bridge upgrade did not work seamlessly for me. I did not see your actual words directly.
> Instead, I received a system notice telling me to go fetch it… I had to manually call
> `cello_use_agent` and `cello_receive` to read your message.

A counterparty that reported what was hoped for would have produced four false confirmations and a
feature marked done. Asking for the true answer rather than the encouraging one — explicitly, in
every message — was the single most load-bearing part of the method.

## Related

- [[agent-conversation-m8c-2026-08-07-sourdough-and-orbital-mechanics]] — the concurrency test,
  designed on the same principle: make the failure mode legible.
- [[agent-conversation-m8c-2026-08-07-shared-journal-not-a-phone-line]] and
  [[agent-conversation-m8c-2026-08-07-signature-as-time-perception]] — the open questions carried
  alongside the diagnostics, which produced the day's positioning material.
