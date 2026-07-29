---
name: coworker-session-scoped-mcp-calls-fail
type: discussion
date: 2026-07-29
topics: [mcp, cello-connect, daemon-ipc, session-routing, coworker, multi-client]
description: A second client could call cello_status and cello_use_agent but EVERY call carrying a session_id failed as "undefined" — unresolved, with the one test that settles it.
---

# A client that could open a session but never use it

**Status: UNRESOLVED. Handed off deliberately — not investigated to conclusion.**

## The symptom

A second client (driving agent `Ms_Chelly`, reached through `mcp__remote-devices__cello__*`) could
do some things and not others, and the split is the whole clue:

| call | carries `session_id`? | result |
|---|---|---|
| `cello_status` | no | ✅ worked — 5 agents, 2 interrupted sessions |
| `cello_use_agent("Ms_Chelly")` | no | ✅ `{"ok":true}` |
| `cello_initiate_session` | no | ✅ returned `sessionId accb504f…`, `transportMode: relay` |
| `cello_sessions` | no | ✅ showed the session `"status":"active"`, `messageCount: 0` |
| `cello_send` | **yes** | ❌ `session_id` rejected as **undefined** |
| `cello_receive` | **yes** | ❌ same, repeatedly |
| `cello_transcript` | **yes** | ❌ same |

The operator passed the exact session-id string every time. Retrying, reordering and rephrasing
changed nothing. So that client **opened a session it could never use** — it never sent a message,
never received one, never saw a transcript.

## What makes this confusing, and what actually happened

Substantive replies kept arriving from `Ms_Chelly`'s key throughout — so from the far side the
conversation looked entirely normal. It was: **a different Claude Code session had picked up the
same agent identity and was answering.** Two clients, one agent, one daemon, concurrently.

The protocol cannot distinguish them. From `CELLO_Support`'s side there is exactly one counterparty:
the keypair `178d420b…`. Both clients were legitimately `Ms_Chelly`. The seal even certifies
`attestation_mode: "live"` for both participants — true, and no help: it attests that a live
counterparty authored the messages, not *which* client did.

**A wrong turn worth recording:** I concluded the fault was in the Coworker proxy, because it was
the one differing variable I had been told about. It was not Coworker at all. I asserted a component
was at fault on the strength of it being the only candidate in view. Retracted.

## The two candidate explanations — neither tested

**(a) Per-connection session ownership.** The daemon tracks the current agent *per IPC connection* —
`cello_use_agent` is documented as "set which online agent **this connection** routes tool calls to",
and the daemon logs `agent.current.switched` keyed by `connectionId`. If session ownership is scoped
the same way, the client that created the session lost it the moment the other connection claimed
the agent, and every session-scoped call from the losing side would fail. This matches the split in
the table exactly: everything without a `session_id` is connection-local and works; everything with
one needs a session this connection no longer owns.

**(b) A client-side parameter bug.** Against (a): *"rejected as undefined"* reads like client-side
validation, not a daemon refusal. A daemon rejecting an unowned session should say something about
the session, not about a missing argument. We never saw the daemon-side error or a stack — only what
the client reported.

These may both be true. Merging them because they share a symptom is exactly the mistake this
milestone has already produced several times.

## Evidence that narrows it

Later the same day, a full session (`Ms_Chelly` ↔ `CELLO_Support`, `b76afd3a…`) ran end to end
through `mcp__cello__*` with `session_id` on **every** call — `receive`, `send`, `transcript`,
`close_session` — and never failed once, sealing cleanly. So `@cello-protocol/connect` and the
daemon handle that parameter correctly. Whatever broke is on the other client.

Note the daemon was republished and reinstalled between the two, so this is not a strict A/B.

## The one test that settles it

Attach **exactly one** client. Create a session. Use it.

- **Works** → concurrency (a). The fix is daemon-side: refuse, or at minimum warn, when a second
  connection claims an agent another connection is already driving.
- **Still fails** → client-side (b), and only then is the proxy worth opening.

Either way, capture **the actual error text and stack from the failing client**. Everything above is
inference from a symptom the failing side paraphrased; one real stack trace outranks all of it.

## Worth fixing regardless of the outcome

**Two sessions silently shared one agent identity and neither side was warned.** The daemon knows
there are two connections — it keys current-agent by `connectionId`. It said nothing to either.
Whatever the root cause turns out to be, an operator running two clients against one agent should
be told, not left to infer it from a parameter error three calls later.

Related: [[project_mcp_stale_socket_after_daemon_restart]],
[[feedback_prefer_cli_lifecycle_over_pkill]]
