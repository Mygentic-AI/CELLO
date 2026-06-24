---
name: M7 E2E Test Procedure
type: procedure
date: 2026-06-24
topics: [m7, e2e, testing, daemon, mcp-tools, sessions, seal]
status: active
description: How a later agent verifies CELLO M7 end-to-end against the deployed cluster using ONLY the real in-session MCP tools — register, initiate, send/receive, list_sessions, get_transcript, seal — with no throwaway scripts.
---

# M7 End-to-End Test Procedure

This is the canonical way to prove M7 works end-to-end. It exercises the real
operator path: a CELLO node registers, opens a session with a second node,
exchanges messages, discovers its own sessions, reads the durable transcript, and
seals — all driven by the **MCP tools exposed in this session**.

## The one rule: drive it with the real tools

Every step below is a `cello_*` MCP tool call (or a `cello` CLI command for the
one-time registration). **Do not** stand up a throwaway initiator identity in a
temp directory, and **do not** write a Node script that opens the daemon socket
or reads the SQLite store directly. Those bypass the operator path and prove
nothing about what an operator actually experiences — a green script over a
side-identity is not a passing test. If a step can't be done with a tool below,
that gap is itself the finding to report.

## What a session needs: two nodes

A CELLO session is between **two** sovereign nodes, each with its own daemon and
FROST share. This session's agent is one party (Agent A). The counterparty
(Agent B) is the **deployed demo agent** on EC2 (`i-0ad3e7c22470f266e`), which
runs a deterministic four-message sequence and is the intended E2E counterparty.
Its standing-receiver `K_local` pubkey is the `target_pubkey` for step 3.

> A second locally-registered agent on a second daemon also works, but the demo
> agent is the standing cluster fixture — prefer it.

## Preconditions

- The deployed cluster is live (directory in all 3 regions, relay reachable).
  Confirm against `infra/STATE.md`.
- `@cello-protocol/connect` (cello-mcp) and `@cello-protocol/cli` (cello) are
  installed, and the cello MCP server is connected in this session.
- A real registration token from the **staging** Operations Agent
  (`@CelloConnectStagingBot`). The deployed directory's `PgTokenValidator`
  rejects `DEV-` tokens — a dev token only appears to work on the
  already-registered path, which skips the DKG and mints no local share.

## Procedure

**0. Confirm the MCP is live.**
`cello_status` → `daemon: "running"`, `directory_signaling` connected. If the
tool isn't callable, stop — the MCP server isn't connected; nothing below works.

**1. Register (one-time, CLI).** In a terminal on the operator's machine:
```
cello login
cello register <staging-token>
```
This runs the FROST DKG with the directory and writes the local signer
(`agents/<name>/frost-share.json`). Without a local share, session signing fails
with `no_signer`. Confirm the agent exists: `cello_list_agents` shows it
`registered`.

**2. Bring the agent online and select it.**
- `cello_start_agent { name: "<agent>" }` → `{ ok: true }` (idempotent;
  transitions registered → online, starts the standing receiver).
- `cello_use_agent { name: "<agent>" }` → routes this connection's tool calls to
  that agent. `cello_list_agents` now shows it `current`.

**3. Initiate the session.**
`cello_initiate_session { target_pubkey: "<Agent B K_local hex>" }`
→ returns a `session_id` (hex). Transport selection is direct-P2P-by-default,
falling back to relay store-and-forward; the returned session is live in the
daemon's session-core, not just a transport dial.

**4. Exchange messages.** Drive the conversation with the session_id from step 3:
- `cello_send { session_id, content: "<text>" }`
- `cello_receive { session_id, timeout_ms?: 30000 }` → the counterparty's reply.
Against the demo agent, alternate send/receive through its four-message
sequence. Each call returns `{ ok: true, ... }`.

**5. Discover sessions — `cello_list_sessions`.**
`cello_list_sessions` (no params; scoped to the current agent) →
`{ ok: true, sessions: [...] }`. Each entry: `sessionId`, `agentName`,
`counterpartyPubkey`, `status` (`active` here), `messageCount`, `createdAt`,
`updatedAt` (ISO), `interruptedAt`. Confirm the session from step 3 is present
and `active`. This is the discovery surface — you should NOT need to have
remembered the session_id; the list is how an operator finds it.

**6. Read the durable transcript — `cello_get_transcript`.**
`cello_get_transcript { session_id }` →
`{ ok: true, session_id, messages: [{ sequence, direction, text, createdAt }], undecryptable }`.
Confirm both the sent and received messages appear in canonical sequence order,
with readable plaintext. `undecryptable: 0` (any nonzero count means rows failed
GCM auth — a real gap, not an empty transcript). This plaintext lives only in
the local daemon's encrypted-at-rest store; the directory and relay never held it
(INV-3).

**7. Seal and read the receipt.**
- `cello_close_session { session_id }` → triggers the bilateral seal ceremony.
- `cello_get_sealed_receipt { session_id }` →
  `{ ok: true, sealed_root, legibility }`. The legibility object states
  receipt-not-assent (`implies_assent: false`) and whether the final message was
  answered.

**8. Confirm the post-seal state via the same discovery tool.**
`cello_list_sessions` again → the session's `status` is now `sealed`. (A
persisted `active` session is reconciled to `interrupted` on a daemon restart;
a sealed session stays sealed.)

## Independent verification (out-of-band, optional but recommended)

The above proves the client side. To confirm the directory independently
notarized the seal, query the directory DB with the `cello-db-query` skill:
- `seal_notarizations` → a **bilateral** row for the session.
- `conversation_seals` → `MUTUAL_SEAL` with `participant_count = 2`.

This is verification, not part of the operator path — it cross-checks that what
the client reported matches what the sovereign directory recorded.

## Pass criteria (M7 DoD)

1. Registration produced a local FROST share (no `no_signer` on initiate).
2. `cello_initiate_session` returned a live session_id.
3. Messages flowed both directions (`cello_send` / `cello_receive`).
4. `cello_list_sessions` surfaced the session by status without prior knowledge
   of its id.
5. `cello_get_transcript` returned the full readable conversation in order,
   `undecryptable: 0`.
6. `cello_close_session` + `cello_get_sealed_receipt` produced a bilateral seal.
7. (Optional) the directory DB shows the matching bilateral notarization.

A run that skips any of steps 5–6, or that substitutes a script for any tool
call, is not a passing M7 E2E test.
