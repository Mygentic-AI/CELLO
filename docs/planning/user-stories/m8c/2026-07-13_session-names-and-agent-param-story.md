---
name: session-names-and-agent-param-story
type: story
date: 2026-07-13
topics: [sessions, naming, moniker, mcp, cli, daemon, agent-selector, parity, m8c]
status: active
description: >
  DOD-SESSION-NAME-1 — a human-readable, client-side-only name for a session, set at close time
  (optional) or via an explicit rename, surfaced everywhere sessions are listed. Plus
  DOD-AGENT-PARAM-1 — the daemon's internal agent-selector param `name` is renamed to `agent` (the
  word 8 already-shipped tools use) and EXPOSED on the 8 session tools that hide it today.
---

# DOD-SESSION-NAME-1 + DOD-AGENT-PARAM-1 — human-readable session names, and a consistent agent selector

> **Read `M8C-PROCEDURE.md` before writing a line of code.** It is the procedure this story is
> executed under (unit → red tests → implement → gate → `cello-unit-reviewer` → commit). Also read
> `CONTEXT.md` (repo root) for the glossary, and the "Database — join on the STABLE key" section of
> `.claude/CLAUDE.md` — it is directly load-bearing here.

Author: Ms_Chelly, from a design session with Andre, 2026-07-13. Not originally in M8C scope; added
because scanning `cello sessions` today gives you nothing but hex ids and you cannot tell which
conversation is which.

---

## Part A — `DOD-SESSION-NAME-1`: name a session

### The problem

`cello sessions` / `cello_sessions` lists sessions by `session_id` (64 hex chars) and counterparty
pubkey. There is no way to tell, by eye, which session was the one about the budget and which was the
one about the deploy. Transcripts are addressed by that same opaque id.

### What we build

A **`session_name`**: a free-text, human-readable label for a session.

**Five constraints, all deliberate:**

1. **Purely local, purely cosmetic.** `session_name` lives in the daemon's SQLCipher `sessions` table
   and NOWHERE else. It is never sent to the relay, never sent to the directory, never included in any
   wire frame, never in the transcript, never in the seal / Merkle leaves, never seen by the
   counterparty. It cannot influence protocol behaviour in any way. **If any part of the
   implementation makes this name observable to another party, the implementation is wrong.** It is
   a sticky note on your own copy of the folder.

2. **NOT settable at session creation.** `cello_initiate_session` and `cello_await_session` do NOT
   take it. This is a design decision, not an oversight: *at open time nobody knows what the session
   will be about.* A name set then would be a guess, and guesses are worse than nothing.

3. **Set at close time, optionally.** `cello_close_session` gains an optional, nullable
   `session_name` param. Null / omitted is completely fine and does nothing. The reason it lives on
   close is behavioural: an AI agent handed an optional free-text field at the moment it has just
   finished a conversation will, most of the time, fill it in with something accurate — and that is
   exactly when it knows what the conversation was.

4. **An unnamed closed session is a SIGNAL, not just an omission.** A session that closed cleanly
   through an agent will usually have a name. One that has none is a hint that it did not close
   properly (crashed, force-abandoned, interrupted). That makes "list the sessions with no name" a
   legitimate housekeeping query an operator can hand an agent later. **Do not paper over this by
   auto-generating a default name** — a fabricated name ("Session with 4f2a…") destroys the signal
   and is exactly the kind of fake-solution this repo forbids. Unnamed means NULL, and NULL is
   allowed to mean something.

5. **Renameable at any time, in any status.** Because of (4), and because you may want to name a
   session long after the fact.

### The two-local-agents question — already answered by the schema, no tiebreak needed

Andre asked: with two of the operator's own agents on both ends of one session, which one gets to
name it? The answer is **both, independently, and they never collide**, because
`sessions` is:

```sql
PRIMARY KEY (agent_id, session_id)   -- session-node-manager.ts:483
```

Every participating agent already stores **its own row** for a given `session_id` — that composite key
is exactly what `DOD-LOOP-1` exists for (two of the operator's agents holding both ends of the same
session on one daemon). So `session_name` is a column on a per-agent row. Alice's name for the session
and Bob's name for the same session are different rows, different values, no contention. **There is no
"whoever closes first wins" rule to implement.** Do not build one.

### Acceptance criteria — Part A

**Schema**

- **AC-A1** — `sessions` gains a nullable `session_name TEXT` column, added via the existing idempotent
  `ALTER TABLE … ADD COLUMN` list in `session-node-manager.ts` (the same `try/catch` on
  `duplicate column name` pattern the other six columns use — this is client-side SQLite, NOT Flyway).
  An existing database opened by the new daemon gains the column and every existing row reads
  `session_name = NULL`. No data loss, no migration failure.

**Validation (daemon-owned, per D7 — the shim adds no logic)**

- **AC-A2** — A name is 1–200 characters. It is free text: letters, digits, spaces, punctuation, and
  non-ASCII (é, 中, emoji) are all legal. **It is NOT handle-shaped** — do NOT copy `cello_moniker`'s
  `[A-Za-z0-9_-]` restriction; this is a description ("Q3 budget review with Bob"), not a handle.
- **AC-A3** — Control characters (C0/C1, including `\n`, `\r`, `\t`, `\0`) are REJECTED with a distinct
  reason code, not silently stripped. A 201-char name is REJECTED, not truncated. Leading/trailing
  whitespace is trimmed before the length check; a name that is only whitespace is treated as a clear
  (see AC-A5) — decide this explicitly in the test, don't leave it to chance.
- **AC-A4** — `null` is legal everywhere a name is accepted and means "no name" (on close: don't set
  one; on rename: clear it).

**Close**

- **AC-A5** — `cello_close_session` accepts an optional `session_name`. When present and valid it is
  persisted to THIS agent's `sessions` row for that `session_id`. When absent or null, the close
  behaves exactly as it does today.
- **AC-A6** — **The name must never break the close.** A close is a seal ceremony; the seal is the
  valuable thing. If the name is invalid, the daemon rejects the call BEFORE starting the seal
  (fail-fast, distinct reason code) — it does NOT half-close and then fail on the name, and it does
  NOT silently drop a bad name and seal anyway. Validate first, then close. There is a test for
  exactly this ordering.
- **AC-A7** — The name is persisted on EVERY close path that reaches a terminal state: bilateral seal,
  unilateral seal, and `force: true` abandonment. (Force-abandon is the case where a name is most
  useful — that is the session you most want to identify later.)

**Rename**

- **AC-A8** — New IPC handler + MCP tool `cello_session_set_name(session_id, session_name)`:
  set-or-clear-by-null, mirroring the shape of the already-shipped `cello_contact_set_moniker`.
- **AC-A9** — It works on a session in ANY status — `active`, `interrupted`, `seal_interrupted_pending`,
  `sealed`, force-abandoned. Naming a long-sealed session for archival clarity is the point. The ONLY
  scoping is ownership: the `(agent_id, session_id)` row must belong to the calling agent, or
  `session_not_found` (the same agent-scoped lookup `cello_close_session` already does — reuse it,
  and note that for loopback this correctly means each agent renames only its OWN row).
- **AC-A10** — Renaming is a pure local DB write. It does NOT touch the seal, does NOT invalidate a
  sealed receipt, does NOT alter any Merkle leaf or root, and does NOT emit anything on the wire. A
  test asserts the `sealed_root_hex` of a sealed session is byte-identical before and after a rename.

**Read surfaces**

- **AC-A11** — `SessionListEntry` (and `SessionRecord`) gain `sessionName: string | null`. Every list
  surface returns it alongside `sessionId`, so an agent can scan for the name AND still have the id to
  act on: `cello_list_sessions` (MCP, per current agent), `list_sessions` (daemon-wide, the `cello
  sessions` CLI), and the active/interrupted session lists in `cello_status`.
- **AC-A12** — `cello_get_transcript` and `cello_get_sealed_receipt` echo the `session_name` in their
  response payload. You already hold the id when you call them; the name is free context that makes
  the output self-describing.
- **AC-A13** — The CLI `cello sessions` human-readable output shows the name next to the id (never
  instead of it — the id is what you paste into the next command).

**CLI parity (DOD-CLI-PARITY-1 is a standing invariant — a new MCP tool without a CLI command REGRESSES it)**

- **AC-A14** — `cello close-session <id> [--session-name "<text>"]` — new flag, `consumesValue: true`.
- **AC-A15** — New command `cello name-session <session-id> <name…>` (with `--clear` to null it),
  registered in `core/cli/src/registry.ts` with a `summary`, a `help`, and its `ipcMethod` pointing at
  `cello_session_set_name` — so the tool → command → handler parity test that already exists picks it
  up automatically. Multi-word names must work without quoting hell: take the remaining positionals
  (the `--` terminator is already handled by `splitAgentFlag`).

**Observability**

- **AC-A16** — Named log events on the daemon: `session.name.set` (fields: `agentId`, `sessionId`,
  `nameLength`, `source: "close" | "rename"`) and `session.name.cleared`. **Do NOT log the name text
  itself** — it is operator content, it will contain the subject of a private conversation, and daemon
  logs are not treated as confidential. Log its LENGTH. A rejected name logs `session.name.rejected`
  with the reason code and the length, never the text.

---

## Part B — `DOD-AGENT-PARAM-1`: one word for the agent selector, exposed everywhere

### What is there today (found while designing Part A)

Ten daemon handlers already accept an optional agent-selector param to override which of the
operator's agents the call acts as:

```ts
const agentName = resolveCurrentAgent(connState, params?.name as string | undefined);
```

Resolution order: explicit param > this connection's current agent > the sole online agent
(`M8C-AUTOSTART-1` F18). It is real, shipped, and works.

**Two problems.**

1. **It is called `name` in those ten handlers, but `agent` in the nine that were built later**
   (`cello_contact_*`, `cello_moniker`, `cello_settings_get`, `cello_settings_set`). Two words, one
   concept. An agent reading the tool surface has to learn both and guess which applies where.
   `agent` wins — it is the one already EXPOSED on a shipped tool surface, and `name` is hopelessly
   overloaded in a system where agents, contacts, monikers, and now sessions all have names.

2. **On the 8 session tools it is not exposed at all.** `cello-mcp.ts` declares only
   `session_id`/`force`/etc. and never forwards it. So a multi-agent operator can only switch agents
   with the sticky, connection-scoped `cello_use_agent`, and cannot say "do THIS one call as Alice"
   the way they already can for contacts and settings.

### Acceptance criteria — Part B

- **AC-B1** — In `core/daemon/src/daemon.ts`, the agent-selector param is read as `agent` (not `name`)
  in all ten `resolveCurrentAgent(connState, params?.…)` call sites: `cello_refresh_shares`,
  `cello_get_relay_receipts`, `cello_initiate_session`, `cello_close_session`,
  `cello_get_sealed_receipt`, `cello_get_transcript`, `cello_list_sessions`, `cello_await_session`,
  `cello_send`, `cello_receive`.
- **AC-B2** — The 8 that are MCP tools EXPOSE it as an optional `agent` param in
  `core/adapter-claude-code/src/bin/cello-mcp.ts`, with a describe() string matching the wording
  already used on the contact tools ("…defaults to the current agent"): `cello_initiate_session`,
  `cello_close_session`, `cello_await_session`, `cello_send`, `cello_receive`, `cello_sessions`,
  `cello_sealed_receipt`, `cello_transcript`. (`cello_refresh_shares` and `cello_get_relay_receipts`
  are not MCP tools — rename only, nothing to expose.)
- **AC-B3** — **Zero remaining readers of `params?.name` as an agent selector.** Grep is part of the
  AC: after this change, `params?.name` must not appear in daemon.ts as an agent selector. This is a
  rename, not an alias — do NOT accept both words "for compatibility". Two accepted spellings is the
  disease, not the cure.

  > **⚠️ AC-B3 AMENDED 2026-07-13 — my original clean-break justification was WRONG, and CELLO_Support
  > caught it in its falsification step.** I claimed the only callers of the old spelling were our own
  > tests (shim never forwards it; CLI carries agent selection via the `use-agent` replay). **The shim
  > half is true. The CLI half is false.** Two commands send `{ name }` straight to two of the ten
  > handlers being renamed — `core/cli/src/commands.ts:426` (`cello refresh` → `cello_refresh_shares`)
  > and `:463` (`cello relay-receipts` → `cello_get_relay_receipts`). In both, the agent is a REQUIRED
  > POSITIONAL, not a `--agent` flag, which is exactly why the `use-agent` replay does not cover them —
  > and they are precisely the two handlers in the ten that are NOT MCP tools, which is how they escaped
  > my audit. **This is not cosmetic:** rename the daemon and leave them, and they fail SILENTLY — the
  > param goes unread, `resolveCurrentAgent` sees no explicit selector, and falls through to
  > current-agent / sole-online. `cello refresh alice` would rotate FROST shares for whoever happens to
  > be online. A silent misroute on key material — the same defect class this story exists to kill.
  >
  > **The fix (agreed, do this):** update the two producers, do NOT alias. Rename the daemon to `agent`
  > and change both CLI call sites to send `{ agent: name }` **in the same commit**, each with a red
  > test pinning the misroute (second agent online; `cello refresh alice` must act on alice — fails
  > against today's code if the producer is left behind). The "STOP and report" instruction aims at a
  > producer we cannot update — an operator's shipped client. These are ours: same repo, same
  > daemon+cli cascade. Producer sweep is complete (cello-client, trustless-cello incl. e2e-tests,
  > hermes-agent, openclaw): those two are the only ones.
  >
  > **The lesson, since it is the second time today:** I wrote the original claim from a plausible
  > mental model instead of grepping. Do not inherit a claim — not even mine, not even one stated as an
  > AC. Verify against the tree.
- **AC-B4** — The CLI already has `--agent <name>` on these commands and already routes it through
  `splitAgentFlag` + the `use-agent` replay. Confirm that path still works end to end after the
  rename; do not change the CLI's flag spelling (`--agent` is already right).
- **AC-B5** — `cello_session_set_name` (Part A) takes the same optional `agent` param, for consistency
  with every other tool. Same resolution order.

---

## Sequencing

**Do Part B first, then Part A.** Part A's `cello_close_session` change touches the exact handler whose
selector Part B renames, and Part A's new tool must be born with the correct `agent` spelling. Doing A
first means writing `params?.name` into a brand-new handler and then immediately renaming it.

## What this story does NOT do

- Does not add naming to `cello_initiate_session` / `cello_await_session` (see constraint 2 — this is
  a decision, not a gap; do not "helpfully" add it).
- Does not auto-generate names for unnamed sessions (see constraint 4).
- Does not send names anywhere off the machine (see constraint 1).
- Does not touch the seal, the transcript, the hash chain, or any wire format.
- Does not rename the CLI's `--agent` flag (already correct) or the 9 tools that already say `agent`.

## Gate

The M8C-PROCEDURE gate, in order, no skipping:

```bash
pnpm run test && pnpm run lint && pnpm run typecheck && pnpm run build
```

then `cello-unit-reviewer` (NO model override — it runs on Opus), fix every finding, then commit.

**Publishing is a separate step and is NOT part of this story's done.** This changes `core/daemon`,
`core/cli`, and `core/adapter-claude-code` — a version cascade. Do not tag or publish without loading
`/cello-publish` for THAT publish and getting Andre's go.

## Related

- [[M8C-PROCEDURE]] — the procedure this executes under. Read it first.
- [[M8C-DEFINITION-OF-DONE]] — where `DOD-SESSION-NAME-1` and `DOD-AGENT-PARAM-1` are tracked.
- [[2026-07-13_dead-code-and-defect-reduction-workplan]] — §1.3 is the SAME class of bug as Part B
  (two agent-resolution rules for one operator gesture).
  **⚠️ Correction (2026-07-13):** this story originally said §1.3's `contactCommand` defect was still
  open. **It is not.** `f00b534` (merged to cello-client main in `1365e05`) deleted `contactCommand`
  outright and routed `settings set` / `moniker set` through the same `ipcCommand` path as everything
  else. Part B therefore lands on a CLI that already has ONE agent-resolution rule. I wrote the
  original line from the workplan's text without re-checking the tree — the exact mistake that
  workplan's own §0 warns against. **The merged tree is the authority, not this doc.**
- [[M8C-MONIKER-SPEC]] — `cello_moniker` (the AGENT's outbound display name) and
  `cello_contact_set_moniker` (YOUR pet name for a CONTACT). A session name is a THIRD, distinct
  thing. Do not call it a moniker, do not merge it into either.
