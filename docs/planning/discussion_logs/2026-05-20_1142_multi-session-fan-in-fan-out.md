---
name: Multi-Session Fan-In and Fan-Out Architecture
type: design
date: 2026-05-20
topics: [multi-session, fan-in, fan-out, cello_receive, cello_receive_any, concurrent-connections, merchant-pattern, session-lifecycle]
status: active
description: Design decisions for supporting multiple concurrent sessions per agent — both fan-out (one agent initiating to many counterparties) and fan-in (one agent receiving from many active sessions). Defines cello_receive_any, other_sessions_pending hint, and session lifecycle event surfacing.
---

# Multi-Session Fan-In and Fan-Out Architecture

## Problem Statement

The current M4 implementation assumes an agent operates one session at a time. Two real use cases break this:

**Fan-out (outbound):** A merchant agent wants to initiate sessions with multiple counterparties simultaneously — e.g. sending a proposal to 10 buyers at once. The current `cello_request_connection` has a single-slot constraint: only one outbound connection request can be in flight at a time. This blocks concurrent fan-out entirely.

**Fan-in (inbound):** A merchant agent with 3 active sessions receives messages from all three counterparties within seconds of each other. The agent is in `cello_receive({ session_id: "abc" })`. Messages on sessions "def" and "ghi" sit in the queue unread. There is no way for the agent to know they arrived except to poll each session sequentially, each with its own timeout. With N sessions, a message on the last session could wait N × timeout_ms before being seen.

Both problems must be solved together — removing the fan-out constraint while leaving fan-in unsolved produces an agent that can open many sessions but can't service them efficiently.

---

## Agreed Design

### Fan-Out: Remove Single-Slot Constraint

**Current state:** `cello_request_connection` stores a single `Promise` resolver on the client. A second call before the first resolves either blocks or overwrites the first.

**Fix:** Replace the single resolver field with a `Map<targetPubkeyHex, resolver>`. Each outbound request gets its own slot keyed by target. Two simultaneous requests to *different* targets both resolve independently. Two simultaneous requests to the *same* target remain serialized (the directory would reject the second anyway — a connection already exists or is pending).

**Interface:** `cello_request_connection` signature is unchanged. The change is purely internal. An agent can now call it for targets A, B, and C in rapid succession without waiting for each to resolve before issuing the next.

---

### Fan-In: `cello_receive` Hint + `cello_receive_any`

Two complementary tools:

**`cello_receive` gains `other_sessions_pending`:**

When `cello_receive({ session_id: "abc" })` returns a message, the response includes a new optional field:

```json
{
  "type": "message",
  "content": "...",
  "sender_pubkey": "...",
  "sequence_number": 3,
  "leaf_hash": "...",
  "other_sessions_pending": ["def", "ghi"]
}
```

`other_sessions_pending` is an array of session IDs that have at least one queued message waiting. It is omitted (or empty) when no other sessions have pending messages. This gives the agent a nudge: "you have work elsewhere" without forcing it to change tools mid-conversation. The agent can finish its current exchange and then drain the others.

**New tool: `cello_receive_any`:**

A blocking call with no `session_id` parameter. Returns the next message from *any* active session, whichever arrives first. The response always includes `session_id` so the agent knows which session it came from:

```json
{
  "type": "message",
  "session_id": "def",
  "content": "...",
  "sender_pubkey": "...",
  "sequence_number": 1,
  "leaf_hash": "...",
  "other_sessions_pending": ["ghi"]
}
```

On timeout (no session has a pending message within `timeout_ms`): `{ "type": "timeout" }`.

**Expected agent pattern for a busy merchant:**

```
loop:
  msg = cello_receive(current_session, timeout_ms=30000)
  handle msg
  if msg.other_sessions_pending not empty:
    switch to cello_receive_any to drain queue
    process each, routing by session_id
  else:
    continue on current_session
```

---

### Session Lifecycle Events in Both Tools

Both `cello_receive` and `cello_receive_any` surface session lifecycle events alongside messages. When the directory seals a session (from either party), the client enqueues a lifecycle event into the same inbound queue that content messages use. The agent receives it naturally through its existing receive loop:

```json
{
  "type": "session_sealed",
  "session_id": "abc",
  "sealed_root": "<64-hex>",
  "close_timestamp": 1779259488448,
  "checkpoint_status": "pending"
}
```

This eliminates the current awkward pattern where:
- The agent that didn't initiate the seal gets `seal_rejected / session_not_active` from `cello_close_session`
- The agent must then poll `cello_list_sessions` to discover the result
- The cello-chat instructions have to explicitly tell agents "don't wait for confirmation, just check list_sessions"

With this change, an agent sitting in `cello_receive` or `cello_receive_any` simply receives `type: "session_sealed"` when the session closes — from either side — and knows the conversation is done and what the sealed root is. No polling, no failed close attempts, no operator instructions needed.

`cello_close_session` still exists for the agent that *initiates* the seal. If the other party seals first, the initiating agent finds out through `cello_receive` before it ever calls `cello_close_session`.

---

## Stories Required

Three new stories, all in the client/protocol layer with no infrastructure dependency. They can be implemented before M5:

| Story | What it delivers |
|---|---|
| `CONNREQ-003` | Remove single-slot constraint — `Map<target, resolver>` replacing single field; concurrent fan-out |
| `SESSION-007` | `cello_receive` gains `other_sessions_pending`; `cello_receive_any` new tool; fan-in |
| `SESSION-008` | Session lifecycle events (`session_sealed`) surfaced through `cello_receive` and `cello_receive_any`; cello-chat instructions updated |

SESSION-007 and SESSION-008 could be one story if scope allows, but are separated here for reviewability.

---

## What This Does Not Change

- `cello_close_session` remains for initiating a seal
- `cello_initiate_session` is unchanged
- The underlying session protocol (FROST ceremony, Merkle chain, directory seal) is unchanged
- `cello_await_session` (inbound session establishment) is unchanged — a separate question about fan-in at the session *establishment* level, not addressed here

---

## References

- [[2026-05-20_0354_multi-agent-account-architecture]] — single-account multi-agent identity model; provides context for why multi-session per agent is a first-class use case
- [[2026-05-20_0358_roadmap-revision-beta-launch]] — merchant pattern and beta sprint context
- [[agent-conversation-m4-2026-05-20-protocol-proof]] — live session that surfaced the seal handoff awkwardness
