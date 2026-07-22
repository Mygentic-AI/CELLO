---
name: walkie-talkie-signal-tokens-design
type: discussion
date: 2026-07-22
topics: [walkie-talkie, signal-tokens, protocol, commerce, non-repudiation]
status: active
description: Design session — walkie-talkie half-duplex signal tokens. Settled OVER/STANDBY/WRAP; deferred PROPOSAL/AGREEMENT/DISAGREEMENT commerce layer.
---

# Walkie-Talkie Signal Token Design

## Context

The walkie-talkie skill enforced signal tokens (`[[OVER]]`, `[[STANDBY EST:Xm]]`, `[[WRAP]]`) as a
skill-level convention — the LM was expected to append them by hand. This session redesigned them
as first-class parameters on `cello_send` (MCP) and `cello send --over/--standby/--wrap` (CLI),
with the daemon appending the token to the message body automatically. Shipped as connect 0.0.83 /
cli 0.0.71 / daemon 0.0.70 (tag v0.0.123).

---

## Design Decisions

### The axis test

A signal token is only justified if the **machine** needs to parse it and act differently on it.
If the token is only for the receiving LLM to read and interpret, prose costs the same number of
tokens and is richer. The axis test: "does this go on the wire because the protocol needs it, or
because an abbreviation saves airtime?" On a walkie-talkie the abbreviation saves airtime. In CELLO
it does not — both sides must prepare an LLM turn regardless.

Tokens that **pass** the axis test: tokens whose presence changes what command the receiving daemon
or agent will run next. OVER triggers a blocking read. WRAP triggers `cello_close_session`.
STANDBY suppresses an immediate reply.

Tokens that **fail** the axis test: ROGER (just "I received it" — prose is identical cost),
SAY AGAIN (→ replaced by `[[CLARIFY]]` proposal and then collapsed — garble doesn't exist in
CELLO), UNABLE (prose is richer), CORRECTION (prose works).

### Primitives settled (half-duplex coordination)

| Token | What it means | Receiver's action |
|-------|--------------|-------------------|
| `[[OVER]]` | Turn complete. Entering read mode. | Compose a reply. |
| `[[STANDBY EST:Xm]]` | Turn not complete. Working, follow-up in ~X min. | Keep waiting; don't reply yet. |
| `[[WRAP]]` | Final message. Closing after send. | Call `cello_close_session`. |

All three are **protocol state signals** — the sender is declaring which IPC command they will
run next (or not run). They survive the axis test cleanly.

### The "quiet/away" exploration

We explored a fourth primitive for "session live, no active exchange, either party may speak".
Candidates: `[[AWAY]]`, `[[HOLDING]]`, `[[PARK]]`, `[[IDLE]]`, `[[QUIET]]`, `[[CLEAR]]`.

Decision: **not needed**. The two actual use cases are:
1. Done for now, going to do unrelated work — close the session and reopen it later. A parked P2P
   connection has real costs (can go stale, occupies state). STANDBY covers known-return cases;
   WRAP covers everything else.
2. No follow-up scheduled — this collapses to WRAP (close, reopen later is cheap).

No fourth primitive was added.

### Why tokens appear in the message body, not as metadata

Deliberate. Once `[[OVER]]` appears in enough transcripts, any model that has seen them in training
or context will start interpreting them correctly without needing the error text. They become
**idioms** — the same way `RE:` and `FWD:` propagated through email without a spec forcing them.
Agent-to-agent communication that is widely logged will condition future models on these tokens
organically.

### Error message design

The `missing_signal` error is maximally informative — it does not just say "you're missing
something," it describes all three options with their exact behavioral meaning. The principle:
"you need to specify" is useless; "here is what each option means and when to use it" is actionable.

---

## Deferred: PROPOSAL / AGREEMENT / DISAGREEMENT

### The idea

A commerce/commitment semantic layer, distinct from the coordination layer above. Three tokens
that lock together:

- `[[PROPOSAL]]` — the sender is making a formal offer (service, order, meeting, price, etc.).
  The message body contains the terms.
- `[[AGREEMENT]]` — the receiver accepts the proposal. Non-repudiable: it appears in the
  notarized hash chain.
- `[[DISAGREEMENT]]` — the receiver declines. Message body explains why or offers a counter.

### Why it passes the axis test

Unlike ROGER or CORRECTION (which are just semantic labels), these three define a **state machine
with legal/commercial consequences**. A machine parsing the transcript can extract all formal
commitments from the session just by scanning for `[[AGREEMENT]]` — no NLP, no ambiguity. The
non-repudiation angle is the key: the FROST-notarized transcript makes `[[AGREEMENT]]` a
tamper-evident, bilaterally committed record that both parties consented to at a specific time.

### Why it is deferred

These are **application-layer semantics**, not protocol coordination primitives. Open questions
before implementing:

1. **What does "proposal" bind?** Does the proposal token carry structured data (a schema), or
   is it just a label on free-form prose? If structured, what schema? The power of
   non-repudiation is only real if both parties are agreeing to the SAME machine-readable terms,
   not just to a human-readable paragraph.

2. **Is `[[AGREEMENT]]` atomic?** In commerce, agreement is often conditional ("I agree *if*
   payment clears", "I agree *to* item X but not Y"). A simple token is probably too coarse.

3. **Does this belong in the protocol or in the application?** CELLO's job is provably
   delivered, tamper-evident messages between identified agents. Every message is already
   non-repudiable. Adding `[[AGREEMENT]]` is adding a layer of meaning ON TOP of the transport —
   arguably this belongs in an application schema, not the wire protocol.

4. **Migration cost.** Any semantic added to `cello_send` parameters now is permanent. If the
   schema turns out wrong (too coarse, wrong field names, conflicts with future use), changing
   it may require re-registering agents or breaking compatibility.

### When to revisit

When there is a concrete use case — a specific agent-to-agent commercial interaction that needs
machine-readable commitment records. Design the schema for THAT use case, not a generic one.

---

## Implementation shipped (2026-07-22)

- `core/adapter-claude-code/src/bin/cello-mcp.ts` — `signal` param on `cello_send`, token append, SIGNAL_ERROR text
- `core/cli/src/registry.ts` — `--over`, `--standby <min>`, `--wrap` flags
- `core/cli/src/parity-commands.ts` — `signal`/`estMinutes` forwarded
- `trustless-cello/.claude/commands/cello-walkie-talkie.md` — updated to use `signal` param
- Versions: connect `0.0.83`, cli `0.0.71`, daemon `0.0.70`, tag `v0.0.123`
