---
name: inbox-calls-unsealed-sessions-sealed
type: discussion
date: 2026-07-30
topics: [m8c, cello-inbox, sealed-unread, terminal-status, seal, observability, truthfulness]
description: >
  cello_inbox reports interrupted, abandoned and seal-pending sessions under `sealed_unread` with
  the guidance "These sessions are sealed" — so it tells the operator a conversation is notarized
  when nothing was notarized. Caught live; the agent reading the inbox repeated the claim as fact.
---

# The inbox says "sealed" about sessions that were never sealed

**Status: root cause pinned, fix not written. DoD line added as `DOD-SEALED-INBOX-2`.**

## What happened

A Claude Cowork session (as `Ms_Chelly`) left two messages for `CELLO_Feedback` and wrapped. The
daemon was killed shortly after, mid-flight. On restart, `cello_inbox` reported:

```json
"sealed_unread": [{ "session_id": "be41ef9b…", "unread_count": 2, "last_seq": 1 }],
"sealed_unread_guidance": "These sessions are sealed with unread messages. …"
```

I read that and told Andre the session was sealed. He asked whether it actually was. It was not:

| probe | answer |
|---|---|
| `cello_inbox` | `sealed_unread` — *"These sessions are sealed"* |
| `cello_sealed_receipt` | `not_sealed_yet` |
| `cello_sessions` | `status: "interrupted"` |

There was no `sealed_root`, no receipt, and no `seal.certificate.frontier.verified` in the daemon
log for that session — while the two sessions that *did* seal that day both have it. The inbox was
the only surface claiming otherwise, and it was the one an agent read first.

## Root cause — the label, not the query

`core/daemon/src/session-node-manager.ts`:

```ts
static readonly #TERMINAL_STATUSES = `('sealed','abandoned','seal_interrupted_pending','interrupted')`;
```

`getSealedUnread()` selects sessions whose status is in that set, and
`notification-handlers.ts` returns them as `sealed_unread` with the "these sessions are sealed"
guidance. The set is correct — all four ARE terminal. **Only one of the four is sealed.**

- `sealed` — notarized, receipt exists.
- `abandoned` — explicitly closed with NO seal. The receipt was forfeited on purpose.
- `seal_interrupted_pending` — seal requested, notarization not landed.
- `interrupted` — never closed at all.

So three of the four values in the "sealed" bucket mean precisely *not notarized*.

**The seam is visible in `DOD-SEALED-INBOX-1`'s own text**, which is where the bucket came from. Its
design paragraph says *"sealed-unread (terminal sessions with unread)"* — terminal, correctly — and
its AC 5 names the response field `sealed_unread`. The design said terminal and the wire said
sealed, and nothing in between reconciled them. The query has been right all along; the word on the
outside is wrong.

## Why this one matters more than an inbox papercut

CELLO's product IS the receipt. "This conversation is notarized" is the single claim the whole stack
exists to support, and it is the claim an operator will repeat to a counterparty. A surface that
answers "sealed" for a session with no seal is not a cosmetic mislabel — it is the protocol lying
about its own core guarantee, on the surface most likely to be read by an agent rather than a human.

And it propagated exactly as designed to propagate: an agent read the inbox, believed the label, and
stated it as fact to the operator. It took a direct "is it actually sealed?" to catch. Nothing in
the system contradicted it — the contradiction only appears if you go and ask a second surface.

## What the fix has to do

Not a query change. The bucket is the right set of rows; the reporting is wrong.

1. **Carry the real status per entry.** Every `sealed_unread` item should include its `status`, so a
   reader cannot infer notarization from the field name.
2. **Stop asserting a seal in the guidance.** The current sentence states a fact about all four
   statuses that is true of one. Say "terminal" (closed, no longer active) and, where it matters,
   say which of them have a receipt.
3. **Prefer renaming the field to `terminal_unread`** with `sealed_unread` retained as an alias for
   one release, since prompt text and skills reference the current name. A rename is the only fix
   that removes the wrong claim at the source rather than patching around it — this is a response
   field, so the Cowork argument-stripping constraint does not apply
   ([[2026-07-29_1730_coworker-session-scoped-mcp-calls-fail]]).
4. **A test that would have caught it**: an `interrupted` session with unread messages must not be
   described as sealed by any field or guidance string in the `cello_inbox` response.

## Explicitly NOT a defect — do not chase this

The same investigation showed the directory signaling stream flapping (5× `disconnected` /
`reconnecting` / `stream.ended` in ten minutes), which was blocking the pending notarization. **That
was Andre**, stopping and starting the daemon repeatedly while debugging why agents were not
connecting. It is operator activity, not instability. Recorded here because the log looks alarming
in isolation and a future reader would otherwise open an investigation into it.

The session itself was subsequently force-abandoned (`reason: force_abandoned`) on Andre's
instruction — terminal, no seal, transcript intact. Its content (Cowork's unprompted product
feedback on repo discoverability) is preserved in
[[agent-conversation-2026-07-29-cowork-bridge-connectivity-proof]]'s sibling notes and in the DoD
item raised from it.

Related: [[2026-07-29_1730_coworker-session-scoped-mcp-calls-fail]]
