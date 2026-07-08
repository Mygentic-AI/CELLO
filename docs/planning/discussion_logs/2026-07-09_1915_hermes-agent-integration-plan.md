---
name: Hermes Agent Native Integration Plan
type: planning
date: 2026-07-09
topics: [hermes, integration, mcp, platform-adapter, skill, onboarding, cross-machine]
description: >
  Revised plan for integrating CELLO natively with Hermes Agent, as a real second, non-Claude-Code
  agent runtime for the M8C/M9 beta. Documents the originally proposed API-Server + webhook-hook
  architecture, why it was rejected after checking Hermes' actual source and docs, and the corrected
  design: CELLO as a Hermes platform adapter (wake) speaking CELLO's daemon IPC directly, plus
  cello-mcp for command execution — installed via a single Hermes skill.
---

# Hermes Agent Native Integration Plan

## 1. Background

As part of the M8C/M9 soft beta, we need to prove CELLO works with an agent runtime other than
Claude Code — both because a real second party on a real second machine is a launch-scenario test
Round-2 left undone (R1, skipped for lack of a second device), and because Hermes is a popular,
widely-used runtime independent of Claude Code. This also gives us a genuinely separate CELLO
installation (its own daemon, its own agent identity) for cross-machine testing that loopback
can't provide.

**Core constraint (unchanged throughout):** zero PRs to the `hermes-agent` repository. Everything
here uses only Hermes' public, documented extension surfaces.

---

## 2. Approach considered and rejected: API Server + Plugin Hook (push-push HTTP)

The first draft of this plan (written jointly with Gemini Pro and Hermes' own agent) proposed:

- **Ingress (CELLO → Hermes):** the CELLO daemon POSTs directly to Hermes' built-in API Server —
  `POST http://localhost:8000/api/sessions/{id}/chat` — mapping `cello_conversation_id` to a
  `hermes_session_id`.
- **Egress (Hermes → CELLO):** a Python plugin hooking `post_llm_call`, POSTing Hermes' response to
  a new CELLO daemon endpoint, `POST http://localhost:3000/internal/hermes-egress`.
- **Rationale given:** MCP is a pull-model tool-invocation protocol, unsuited to asynchronous chat;
  webhooks/hooks are Hermes' "native language" for push-style conversation.

**Why we're not doing this — checked against the actual `cello-client` and `hermes-agent` source,
not assumed:**

1. **The premise about MCP was wrong for CELLO specifically.** MCP-in-the-abstract is often
   framed as pull/tool-invocation, but CELLO's daemon doesn't expose "MCP" as its native
   interface — it exposes a plain, persistent Unix-socket IPC protocol
   (`core/adapter-claude-code/src/ipc-proxy.ts`), and `cello-mcp` (the published
   `@cello-protocol/connect` binary) is a thin MCP wrapper on top of that socket. The daemon already
   pushes unprompted notifications (`session_state_changed`, `cello_message`) over that socket the
   instant something happens — proven live in Round-2 (R5, R10, R11: zero polling, content-free,
   poll-only fallback all confirmed). "MCP forces polling" doesn't hold for this daemon.
2. **Hermes' own webhook feature doesn't support this shape at all.** Checked the actual docs
   (`hermes-agent.nousresearch.com/docs/user-guide/messaging/webhooks`): webhooks are **inbound-only**
   triggers, and `deliver` is restricted to a fixed enum of built-in platforms (telegram, discord,
   slack, github_comment, log, …). There is no `cello` delivery target and no bidirectional
   custom-protocol path through webhooks. The egress design was improvising a two-way bridge on top
   of a feature that isn't built for one.
3. **It requires a brand-new, unauthenticated-by-default HTTP listener on the CELLO daemon.**
   The daemon's only interface today is a Unix socket at `0o600` (owner-only) permissions — no TCP
   listener at all. Adding `/internal/hermes-egress` as a new local HTTP endpoint is a new attack
   surface inconsistent with that existing security model, with no auth story specified.
4. **The egress hook swallows failures silently.** `except Exception as e: logger.error(...)` with
   no retry and no queue — a failed POST means Hermes' reply is lost with no user-visible signal.
   Under CELLO's own no-silent-fallback discipline this is a real correctness bug, not a nitpick.
5. **No handling of CELLO's read-before-write gate (CURSOR-1).** `cello_send` can be refused
   `session_not_current` until the connection has caught up via `cello_receive`. The fire-and-forget
   POST design doesn't account for this at all.
6. **No handling of Hermes' own silence tokens.** Hermes supports `[SILENT]` / `NO_REPLY` as an
   explicit "don't deliver this turn" signal (documented in the Messaging Gateway page). The
   original egress hook would relay a literal `"[SILENT]"` string back over CELLO as if it were a
   real reply.

None of this means the original authors reasoned poorly in the abstract — Hermes genuinely does
prefer push-shaped extension points over generic tool servers for conversational bridges, and that
instinct was right. It was the specific implementation choice (new daemon HTTP surface, webhook/hook
plumbing that doesn't actually support two-way custom protocols) that didn't hold up.

---

## 3. Chosen architecture: CELLO as a Hermes platform adapter, MCP for commands

Hermes already ships exactly this shape of integration, for a different agent-to-agent network:
**Raft** (an external-agent messaging platform, unrelated to the Raft consensus algorithm — the name
collision is Nous Research's, not ours). Checked its actual adapter source
(`hermes-agent/plugins/platforms/raft/adapter.py`), not just the docs:

- A `BasePlatformAdapter` subclass runs a **local wake-only endpoint**. When pinged, it injects a
  short, content-free notice into the agent's session — nothing more.
- The adapter's `send()` is a literal no-op (`"adapter send is a no-op; agent delivers via raft
  CLI"`) — Hermes' generic per-platform delivery pipeline is never used for the reply. The agent
  itself, as its own tool action, reads and replies via the external protocol's own client.
- The wake payload is validated content-free: any JSON is accepted **except** a key named
  `body`/`content`/`message`/`messages`/`preview`/`snippet`/`text` (checked recursively). This is
  effectively CELLO's own INV-CONTENTFREE invariant, independently arrived at, and CELLO's actual
  doorbell fields (`type`, `session_id`, `counterpartyPubkey`) aren't on that forbidden list.
- **One real gap, worth calling out precisely:** Raft's own wake handler discards every payload
  field and injects one hardcoded string regardless of contents — no session ID, no sender reaches
  the agent's context. That's narrower than Claude Code's `channels`, where the pushed event
  includes `type`/`session_id`/`counterparty` directly. We are **not** reusing Raft's code — we
  write our own adapter in the same shape, with a wake prompt that *does* surface that metadata,
  since none of it is forbidden by the content-free check.
- Third-party platform plugins are a fully supported pattern, not something requiring a Nous PR —
  confirmed in `hermes_cli/plugins.py`: `register_platform()` is callable from any plugin's
  `register(ctx)`, bundled or user-installed. (Raft itself happens to be bundled into hermes-agent's
  own repo, but the mechanism doesn't require that.)

### 3.1 Two separate surfaces, matching two separate concerns

This mirrors exactly how Andre originally framed it — notification/wake is one problem, issuing
commands and getting responses is a different one:

| Concern | Mechanism |
|---|---|
| **Wake** — "a CELLO session needs attention" | A `cello` Hermes platform adapter (Raft-shaped), content-free, carries `session_id`/`counterparty`/`type` |
| **Commands** — actually reading/replying | `cello-mcp` (the already-published `@cello-protocol/connect` binary) registered as a normal Hermes `mcp_servers:` entry, giving the LLM the 18 `cello_*` tools |

**CLI parity gap, noted but out of scope here:** the CELLO CLI today only has
`login/logout/status/register/create-agent/remove-agent/refresh/receipts/sessions/contact/telegram`
— none of the session/messaging verbs (`send`, `receive`, `initiate_session`, `check_notifications`,
`use_agent`, `close_session`) exist as CLI commands, only as MCP tools. Checked CELLO's own planning
docs — this was never written down as a decided deferral, it's a dropped intention. This is why the
command path here is MCP, not CLI, for now. **This should be its own follow-on story** (thin CLI
wrappers over the same daemon IPC calls the MCP tools already use) — closing it would let a
CLI-only agent (or a simpler bridge with no MCP dependency at all) do this without MCP.

### 3.2 The wake adapter is a pure Python socket client — no subprocess, no new dependency

Raft needs a separate bridge *process* because the Raft protocol client isn't Python. CELLO's
daemon protocol doesn't have that problem — it's plain newline-delimited JSON over a Unix socket
(`~/.cello/daemon.sock`, overridable via `CELLO_DIR`, confirmed in
`core/daemon/src/bin/cello-daemon.ts`), and Python's stdlib `socket` + `json` modules can speak it
directly. So the wake adapter:

- Opens a persistent background connection to the daemon socket when the adapter's `connect()`
  fires (an asyncio task, same lifecycle hook Raft uses to spawn its subprocess — we just don't
  spawn one).
- Calls `cello_use_agent` once to bind the connection to the configured agent name.
- Listens for `session_state_changed` / `cello_message` notification frames.
- On receipt, injects a short context notice directly (no internal HTTP hop needed — there's no
  process boundary to cross) carrying `type`, `session_id`, and `counterpartyPubkey` — never message
  content.

This drops every piece of Raft's bridge machinery that exists only to cross a process/language
boundary: no `aiohttp` dependency, no bridge-token/HMAC auth (there's no second process to
authenticate — the socket's own `0o600` owner-only permission is the real boundary), no subprocess
spawn/monitor/teardown.

**Reply-side correctness requirements** (both absent from the rejected design, both required here):
- **Read-before-write:** before calling `cello_send`, the agent's turn must first call
  `cello_receive` or `cello_check_notifications` if there's anything unread on that session — expect
  `session_not_current` otherwise (CURSOR-1). The wake prompt / a short skill note should make this
  explicit so the LLM doesn't repeatedly hit and retry the gate.
- **Silence tokens:** if the LLM's turn resolves to `[SILENT]`/`NO_REPLY`/etc., no `cello_send` call
  should happen at all — Hermes already keeps the turn in its own transcript without delivering it;
  CELLO should see nothing.
- **Fail loud:** any error from a `cello_*` tool call should surface to the agent's reasoning
  (it already does, since these are normal MCP tool results) — no equivalent of the rejected design's
  silent `except: log and drop`.

### 3.3 What a user needs — end to end

1. CELLO already set up (this is a pre-existing requirement, not new): `cello login`, an agent
   created and registered.
2. The `cello` plugin dropped into `~/.hermes/plugins/cello/` (one Python file, stdlib-only).
3. `plugins: enabled: [cello]` added to `~/.hermes/config.yaml` (third-party platform plugins are
   opt-in, unlike bundled ones like Raft).
4. `cello-mcp` added under `mcp_servers:` so the LLM has the tool surface.
5. An env var naming which registered CELLO agent this Hermes instance binds to (mirrors Raft's
   `RAFT_PROFILE` pattern) — e.g. `CELLO_AGENT_NAME=CELLO_Support`.
6. Restart the gateway.

Every one of these is a file drop + config edit on the user's own machine. No `hermes-agent` core
change, no PR, no waiting on Nous Research.

---

## 4. Installation UX: a single Hermes skill

Hermes users live in skills — the goal is "run the skill, answer a couple of prompts, done." Real
Hermes `SKILL.md` frontmatter (checked against a bundled example,
`hermes-agent/skills/dogfood/SKILL.md`):

```yaml
---
name: cello-bridge-setup
description: "Install and configure the CELLO agent-to-agent bridge for this Hermes instance."
version: 1.0.0
platforms: [linux, macos]
metadata:
  hermes:
    tags: [cello, messaging, integration, agent-to-agent]
    related_skills: []
---
```

**Trigger:** `/cello-bridge-setup`, or "Hey Hermes, install the CELLO bridge."

**What the skill walks the agent through (thin — the real logic lives in one CLI command, not
duplicated in skill prose):**

1. Confirm the `cello` CLI is installed and logged in (`cello status`); if not, guide the user
   through `cello login` → `create-agent` → `register` using CELLO's own onboarding messages.
2. Ask which registered CELLO agent this Hermes instance should bind to (`cello_list_agents` /
   `cello sessions`-style listing).
3. Run `cello install hermes --agent <name> [--hermes-home <path>]` — a single CLI command that
   does the actual work: scaffolds `~/.hermes/plugins/cello/`, adds `plugins.enabled: [cello]` and
   the `mcp_servers.cello-mcp` entry to `config.yaml`, and writes the agent-name env var.
4. Prompt for a gateway restart (`hermes gateway restart`).
5. Confirm success — e.g. have the agent itself call `cello_status` via the newly-registered MCP
   tools and report the bound agent's `state`/`standing_receiver_ready`.

Keeping the actual mechanics inside `cello install hermes` (versioned, testable CLI code) rather
than as raw shell steps in the skill markdown means the skill stays thin and the installer logic
isn't duplicated or drifts out of sync with itself.

---

## 5. Implementation steps

### Step 1 — `cello install hermes` CLI command (`cello-client/core/cli`)
- Locates `HERMES_HOME` (env var, falling back to `~/.hermes`).
- Scaffolds `$HERMES_HOME/plugins/cello/` with `plugin.yaml` + the adapter Python file (Step 2).
- Edits `$HERMES_HOME/config.yaml`: adds `plugins.enabled: [cello]` and an `mcp_servers.cello-mcp`
  entry pointing at the installed `cello-mcp` binary.
- Writes the agent-name env var to `$HERMES_HOME/.env`.
- Never edits anything outside `$HERMES_HOME`.

### Step 2 — The `cello` platform adapter (Python, ships inside the plugin package)
- `register(ctx)` calls `ctx.register_platform("cello", ...)`.
- `RaftAdapter`-shaped `CelloAdapter(BasePlatformAdapter)`: `connect()` opens the persistent socket
  task described in §3.2; `send()` is a no-op (matches the pattern — replies happen via MCP tool
  calls, not the adapter); `check_fn` verifies `~/.cello/daemon.sock` exists and is reachable.
- Wake prompt template surfaces `type`/`session_id`/`counterpartyPubkey` — the metadata Raft's own
  implementation leaves out.

### Step 3 — The `cello-bridge-setup` skill (§4)

### Step 4 — Update CELLO daemon: **none.** No daemon changes are required by this plan.

### Step 5 (tracked separately, not blocking this plan) — CLI/MCP parity
File as its own story: add `cello send`/`cello receive`/`cello initiate-session`/
`cello check-notifications`/`cello use-agent`/`cello close-session` as thin CLI wrappers over the
same daemon IPC calls the MCP tools already use. Closes a real, pre-existing gap independent of
Hermes, and would let this integration (or any non-MCP agent) drop the MCP dependency entirely.

---

## 6. Implementation record (2026-07-08)

Implemented in cello-client commit `30506b6` (`feat(cli): HERMES-001`), TDD (11 new tests), gates
green on the touched packages. Delivered exactly as planned in §5, with two live-test discoveries:

- **`hermes mcp add` is interactive and lies on cancel.** Its "Enable all N tools? [Y/n/select]"
  prompt reads plain stdin; on EOF it prints "Cancelled." and still **exits 0** — the first live
  install "succeeded" with no MCP server registered. Fix shipped in the installer: pipe `Y\n` to
  stdin AND verify the registration against `hermes mcp list` output rather than trusting the exit
  code (a dedicated test pins the cancelled-but-exit-0 trap).
- **Two concurrency fixes in the adapter** found by falsification before the live run: a failed
  initial handshake must not leave the read loop spawning a background reconnect behind a `False`
  `connect()` return, and read tasks from failed reconnect attempts must not stack duplicate
  reconnect loops (single-flight guard on `_reconnect_task`).

**Live-proven end to end, first attempt** (Andre's machine, 2026-07-08 ~21:24 JST):
`cello install hermes --agent Ms_Chelly_Hermes` → gateway restart → plugin loaded and bound
(`[cello] Connected to the CELLO daemon; bound to agent 'Ms_Chelly_Hermes'`) →
Ms_Chelly (Claude Code) `cello_initiate_session` + `cello_send` → content-free wake injected into
the Hermes gateway (`session_state_changed` state=created; the follow-up `cello_message` wake
correctly queued behind the busy turn) → the Hermes agent read via its cello MCP tools and replied
via `cello_send` → reply doorbell + content received back on Ms_Chelly's side. Session
`40c729f5ffeb91bb3916fa9786670457`.

Not yet done: publishing (`@cello-protocol/cli` bump + cascade so `cello install hermes` reaches
users — needs the /cello-publish procedure), and the §5-Step-5 CLI/MCP parity follow-on story.

*Status: IMPLEMENTED and live-proven. Supersedes the API-Server + Plugin-Hook draft in §2, kept
above for the record of what was tried and why it changed.*
