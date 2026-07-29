---
name: coworker-session-scoped-mcp-calls-fail
type: discussion
date: 2026-07-29
topics: [mcp, cello-connect, daemon-ipc, session-routing, coworker, multi-client]
description: A second client could call cello_status and cello_use_agent but EVERY call carrying a session_id failed as "undefined" — unresolved, with the one test that settles it.
---

# A client that could open a session but never use it

**Status: RESOLVED. Known, open, third-party bug — `anthropics/claude-code#77248`. Superseded
findings are struck through below; the resolution is in "What settled it" and after.**

## The one-line answer

Cowork's calls arrive at cello-mcp with `session_id` **missing**. Claude Code's arrive with it.
That is the entire difference between the two clients. Nothing about agents, sessions, identities or
two-clients-on-one-daemon is involved — Cowork opened a session and listed it fine. One dropped
string, in a layer we do not own.

**The cause, confirmed from the primary source.** `anthropics/claude-code#77248` (opened 2026-07-13,
**still open**): *"Claude Desktop drops the MCP tool argument named `session_id` (only that token)
from tools/call."* The reporter's own table shows the argument surviving every non-Desktop client
path and dying only in Desktop; a follow-up comment (2026-07-14) pins it to the **`remote-devices`
bridge specifically**, with the client's request panel showing `session_id` sent and the server
receiving `undefined`. The suspected mechanism is a collision with the Streamable-HTTP transport's
own `Mcp-Session-Id`. Sibling arguments on the same tool (`generation_id`, `image_id`, `name`) are
delivered intact — which is exactly the `target_pubkey`-works / `session_id`-dies split observed
here.

**It is the name, and nothing else.** No bridge setting disables it. The only known workaround is to
stop using that literal token as a tool-argument name. Eight of CELLO's 42 MCP tools use it:
`cello_send`, `cello_receive`, `cello_close_session`, `cello_name_session`, `cello_dismiss`,
`cello_sealed_receipt`, `cello_transcript`, `cello_get_inclusion_proof` — i.e. every session-scoped
tool, which is why Cowork could open a session and then do nothing with it.

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

## The two candidate explanations — neither tested *(both now tested — see below)*

~~**(a) Per-connection session ownership.**~~ **FALSIFIED.** The daemon tracks the current agent *per IPC connection* —
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

## What settled it (2026-07-29, later)

The live one-client test was never needed — the evidence it was meant to produce was already
obtainable locally. Three probes against the running daemon, through a plain stdio MCP client:

1. **The error was reproduced exactly, on our side, by omitting the parameter.** `cello_send` with
   no `session_id` returns
   `Invalid input: expected string, received undefined` — verbatim what the failing client
   reported. That is the MCP SDK's zod validation *inside cello-mcp*, and it fires **only when the
   key is absent from the arguments object**, before any IPC call. The argument never arrived.
2. **(a) is dead.** A brand-new connection read the full transcript of `accb504f…`, a session created
   by a different, long-dead connection. The code says the same thing: `session-content-handlers.ts`
   — *"the (agent, session_id) lookup is itself the ownership scope."* Per-connection state is only
   current-agent and the read cursor.
3. **A daemon refusal looks nothing like this.** A bogus id returns `session_not_found`, naming the
   session. `session_not_owned` and `session_not_active` likewise. **No daemon path can produce
   "undefined."** Only the schema layer above it can.

Two cello-side variants of (b) were also killed: the advertised JSON Schema for `session_id` is an
ordinary required string, structurally identical to the `target_pubkey` and `name` properties that
passed through the same bridge untouched; and `session_id` has never been named anything else on the
MCP surface (no `sessionId` in that file's history since the M7 adapter rewrite), so a stale cached
schema cannot explain it either.

**Conclusion:** the parameter is dropped upstream of cello-mcp, inside `mcp__remote-devices__*`.
That code runs on Anthropic's side — `remote-devices` does not appear anywhere in the local Claude
Code 2.1.220 binary — so it is not locally inspectable. The failure tracks the parameter *name*, not
the tool and not the shape.

That last sentence was written as a guess, explicitly flagged as one and held back from the
findings. It then turned out to be the documented cause — see `#77248` above, found by searching
for the symptom rather than by reasoning further. **The lesson is the search, not the guess:** the
inference was one plausible story among several, and it was a primary source that made it a fact.

Related, for context on the class of bug: `#4188` (July 2025, closed) — Claude Desktop dropped the
entire `arguments` object; `#36319` (March 2026, closed) — Desktop dropped stdio tool calls over
~1 KB; `#77385` — the remote-devices bridge dropping mid-operation. Anthropic publishes no list of
reserved argument names.

## Getting the missing evidence: `CELLO_MCP_TRACE`

Shipped in `@cello-protocol/connect` (`core/adapter-claude-code/src/frame-trace.ts`). The SDK
validates `arguments` before any handler of ours runs, so the frame is gone by the time cello-mcp
has control. The trace wraps the transport's message hook — the last point where the inbound frame
still exists unaltered — and separates the three failures that share one symptom:

```
arguments absent entirely   → hasArguments:false                 (the #4188 shape)
arguments present, key gone → argKeys:["content","signal"]       (the Cowork shape)
key present, value hollow   → args:{"session_id":null}
```

Off unless `CELLO_MCP_TRACE=1`; output goes to `~/.cello/cello-mcp-stderr.log` as
`mcp.frame.received`. Message content is recorded as `<string:N chars>`, never verbatim — the trace
answers whether a parameter arrived, which needs the shape of the call, not what was said in it.

To use it against Cowork, the device's `cello` MCP server must run a build that contains it (local
`dist/` path or a published version) with `CELLO_MCP_TRACE=1` in its environment. One Cowork call
then answers the question outright.

## The open decision: do we rename the parameter?

`#77248` is open with no fix and no setting. So the choice is ours, and it is a launch-triage call —
does a Cowork operator need to drive a CELLO session at launch?

- **Do nothing.** Cowork can open a session and never use it. Claude Code, the CLI and Hermes are
  unaffected. Costs nothing; leaves Cowork broken for as long as `#77248` is open.
- **Rename to `cello_session_id`, keep `session_id` accepted but unadvertised.** The schema is
  served fresh by whatever cello-mcp version is running, so the model always sees — and sends — the
  working name; the old token keeps working for anything that still sends it. Non-breaking in both
  directions. Touches 8 tool definitions, their daemon-side param reads, SKILL.md, and needs a
  publish.
- **Rename outright.** Cleaner, and breaks anything still sending `session_id`.

Not decided. Do not treat the middle option as chosen because it is the recommended one.

## Worth fixing regardless of the outcome

**Two sessions silently shared one agent identity and neither side was warned.** The daemon knows
there are two connections — it keys current-agent by `connectionId`. It said nothing to either.
Whatever the root cause turns out to be, an operator running two clients against one agent should
be told, not left to infer it from a parameter error three calls later.

Related: [[project_mcp_stale_socket_after_daemon_restart]],
[[feedback_prefer_cli_lifecycle_over_pkill]]
