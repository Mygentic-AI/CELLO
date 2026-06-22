---
name: Local Loopback Session-Core Re-Key, and Agent-Designation Default
type: discussion
date: 2026-06-20
topics: [loopback, two-agents-one-daemon, session-core, session-id-keying, agent-session-rekey, migration, agent-default, current-agent, daemon, m7]
status: open
description: >
  Two decisions about single-machine multi-agent ergonomics. D-D1: the local
  loopback — two of the operator's own K_locals (agents A and B) conversing over
  ONE daemon — is IN SCOPE for M7. Verified on m7-rehome that one daemon cannot
  host both ends of one session today (the session core is keyed by session_id
  alone), so two local agents talking currently requires two daemon processes —
  the unnecessary process spawning Andre explicitly does not want. Fix: re-key the
  session core to (agent, session_id); story CELLO-M7-SESSION-CORE-REKEY-001.
  D-E1: the agent-designation default (auto-select the sole online agent) is a
  small fix recorded as a note for the implementation thread, not a story.
---

# Local Loopback Session-Core Re-Key, and Agent-Designation Default

## D-D1 — Local two-agent loopback: IN SCOPE for M7

### Andre's intent (the requirement to record)

*"I simply want to be able to run two sessions with two different K_locals on the
same machine and have them talk to each other. What I don't want to see is
multiple processes spawning unnecessarily."* (2026-06-20)

The requirement is the **outcome**: two of the operator's own agents (two
K_locals) on one machine converse, with no unnecessary process spawning. Andre
deliberately did not want to pronounce a daemon-internal architecture requirement
— the daemon design is the means, the conversing-without-extra-processes is the
end.

### Verified state (m7-rehome, HEAD 0afce25) — the intent is NOT met today

Checked on the branch under active development. One daemon **cannot** host both
ends of the *same* session:

- The session core is keyed by `session_id` **alone**:
  `#activeNodes`, `#trees`, `#receivedContent`, `#sessionLiveness`, `#relayClients`
  are all `Map<sessionId, …>` (`core/daemon/src/session-node-manager.ts:181/196/199/208/185`).
- The `sessions` table primary key is `session_id` and ownership is a single
  `agent_name` column (`session-node-manager.ts:283-284`).
- The ownership check rejects cross-agent access:
  `if (record.agent_name !== connState.currentAgent) → session_not_owned`
  (`daemon.ts:1355`; also `:2590`).
- The inbound-accept guard treats a known `session_id` as a double-accept:
  `if (inboundInFlight.has(sessionId) || getSessionRecord(sessionId)) → reject`
  (`daemon.ts:1966`).

So if agent A initiates session S on the daemon (writes a `sessions` row with
`agent_name = A`), agent B on the **same** daemon trying to be the other end of S
collides: B's inbound accept hits A's existing row → double-accept rejection, and
the single-owner check would deny B. That is why the SPINE-6 proof used **two
daemons** (agentA@daemonA + agentB@daemonB) — a workaround for the keying, and
exactly the "multiple processes spawning unnecessarily" the intent rules out.

**Correction to the prior recollection** ("when we investigated this it seemed
okay as it is"): what works on one daemon is (a) hosting **multiple identities**
(DOD-SPINE-4) and (b) one agent in **multiple sessions with EXTERNAL
counterparties** (distinct `session_id`s — the SPINE-6 relay multiplex). What does
**not** work is **both ends of the SAME session on one daemon** — the local
loopback. The two are easy to conflate; the evidence above is specific to the
loopback.

### Decision: IN for M7; re-key the session core. (CONFIRMED — Andre, 2026-06-20)

The only way to meet the stated intent (one daemon, two local K_locals, no extra
processes) is to make the session core agent-scoped. Re-key from `session_id` to
`(agent, session_id)`:
- `sessions` PRIMARY KEY → `(agent_name, session_id)` — a SQLite schema change
  (NOT a directory Flyway migration; this is the **client-side daemon DB**, which
  has no Flyway — see the story for the daemon-DB schema-evolution note).
- The five in-memory maps keyed by `sessionId` → keyed by a composite
  `(agentName, sessionId)` (or nested `Map<agent, Map<sessionId, …>>`).
- The ownership check and the inbound double-accept guard → scoped to
  `(agent, session_id)` so A's row and B's row for the same `session_id` coexist.

The daemon already holds the agent context it needs at every call site
(`connState.currentAgent`; inbound accepts carry the target agent), so the change
is coherent and self-contained — no new cross-node state, no protocol/wire change
(the `session_id` on the wire is unchanged; the scoping is purely local daemon
bookkeeping). This is **real story machinery** (DB-schema + session-core change):
`CELLO-M7-SESSION-CORE-REKEY-001`, plus a DoD line (`DOD-LOOP-1`) and a J-LOOPBACK
verification journey (A and B on one daemon converse + seal).

### Trust nuance (recorded)

When both parties are the same operator, CELLO's no-single-forge guarantees are
degenerate — you are trusting yourself, and the seal between A and B is a record
you produced on both sides. That does not make the feature illegitimate: the
**coordination** value (two of your own agents collaborating over a structured,
sealed, ordered channel) is real and is the stated use case. The re-key changes
only *where the session is hosted*, never the crypto: each end still signs with
its own K_local, and the FROST notarization still routes through the directory
threshold. DOD-INV-2 (B's acknowledgement is always B's own node's signature)
holds unchanged — there are simply two nodes inside one process, each with its own
K_local.

## D-E1 — Agent-designation default: a note for the implementation thread, not a story

### Finding (m7-rehome)

On a new MCP/IPC connection `currentAgent` is `null`
(`daemon.ts:919` — `perConnectionState.set(connectionId, { currentAgent: null,
… })`). Even with exactly one agent, the operator must explicitly
`cello_start_agent` then `cello_use_agent` before any outbound call (session tools
return `no_current_agent`, `daemon.ts:1189`). There is no default-agent
auto-selection. The intended UX is *"if you only have one agent, that's the
agent,"* plus an explicit switch tool (`cello_use_agent`, which exists).

### Decision: small direct fix, recorded as a note (not a story).

This is a contained ergonomics fix, not protocol-significant — per
`M7-PROCEDURE.md` §5 ("no new stories for contained work") it belongs in the
implementation loop, not a SPARC story. The implementation thread should:
- When a connection issues its first session tool and `currentAgent` is `null`,
  **auto-select the agent iff exactly one agent is online** (set it current, log
  `agent.current.switched` with `fromAgent: null`), otherwise keep the existing
  `no_current_agent` + guidance.
- Edge case to handle: exactly one agent **registered but not yet online** — do
  NOT auto-start it (login does not auto-start agents, DOD-SPINE-3); return
  guidance to `cello_start_agent` first. Auto-select applies to the **online**
  set, never auto-start.
This is recorded here so the note has a home (RC-1) and does not evaporate; it is
also added as a one-line implementation note in the build journal.

## Related

- [[outline]] — three agent states (registered / online / current); ephemeral
  per-session nodes (the keying these decisions touch).
- `core/daemon/src/session-node-manager.ts`, `core/daemon/src/daemon.ts` — the
  session-core keying and current-agent state.
- [[CELLO-M7-SESSION-CORE-REKEY-001]] — the re-key story (D-D1).
