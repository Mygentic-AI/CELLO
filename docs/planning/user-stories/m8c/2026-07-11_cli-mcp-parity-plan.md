---
name: cli-mcp-parity-plan
type: user-story
date: 2026-07-11
topics: [cli, mcp, parity, bash-adapter, onboarding, help, friction, launch, cello-support-workorder]
status: ready-to-execute
description: >
  Executable work order (for CELLO_Support): make EVERY daemon capability that today is reachable only
  through the MCP tool surface reachable through the `cello` CLI, so any bash-capable agent can operate a
  CELLO node with no MCP dependency. Folds in DOD-ONBOARD-HELP-1's remaining gap (the described `cello --help`
  command table). CLI-only change over the existing daemon IPC; thin pass-through; JSON-out bash contract.
---

# CLI ↔ MCP Parity — every daemon capability reachable from `cello` (bash)

> **This document is written to be executed cold by CELLO_Support.** Read it top to bottom, then work the
> phases in order. Follow CELLO SPARC + TDD (red first), the gate sequence per unit, and dispatch
> `cello-unit-reviewer` (on **Fable 5**) per unit. Fix every review finding before committing. Do NOT run the
> `latest` promotion (operator-run) and do NOT run `deploy.sh` (this is CLI-only, no infra).

## 1. Why this matters (intent — read first)

- **Bash is the universal agent adapter.** Most agents can run shell commands; not all can or will use MCP
  tools. When every capability is a `cello` command with machine-parseable output, **any bash-capable agent
  becomes a CELLO operator with zero MCP dependency** — Claude Code, Hermes, and essentially every other
  runtime. This is a direct expansion of the #1 launch value ("two agents connect and communicate, including
  when you control only one of them").
- **Removes friction we have right now.** Session lifecycle, messaging, agent lifecycle, backup/restore, and
  the address book are currently locked behind the MCP surface. A human operator or a bash-driven agent can't
  reach them.
- **Enables scripted live-smoke.** A full connect → send → receive → seal driven entirely from `cello`
  commands (no Claude session) is both the proof this works and a reusable smoke harness we lack today.

## 2. The principle that makes this cheap

The **daemon is the source of truth**; `cello` (CLI, `core/cli`) and `connect` (MCP shim,
`core/adapter-claude-code`) are BOTH thin clients over the **same daemon IPC socket** (`~/.cello/daemon.sock`).
Every `cello_*` MCP tool is one daemon IPC handler that **already exists**.

> A new CLI command = **parse args → call the SAME IPC handler the MCP tool calls → print the response.**
> No daemon changes. No MCP shim changes. Reuse the CLI's existing daemon IPC client — do **not** create a
> second IPC client.

**Guardrail:** if you find an MCP tool whose IPC handler does not already exist, **STOP and flag it** — do not
build a parallel daemon path to fill a gap. Report it; it's a different story.

## 3. The bash-adapter contract (decide once, apply to every command)

This is what makes `cello` a real programmatic interface, not just a human UI:

- **stdout = the IPC response as compact JSON**, one object per invocation (mirrors today's `cello status`).
  A bash agent does `cello <cmd> ... | jq`.
- **Exit code:** `0` when the response is `ok:true`; **non-zero** when `ok:false` or on a transport/daemon
  error. A script must be able to branch on `$?`.
- **Errors:** print the daemon's structured `{ok:false, reason, ...}` to **stderr** as JSON, **verbatim** —
  never swallowed, never dressed as success. This is the DOD-SENDRAW-1 / DOD-LOGOUT-WAIT-1 lesson at the CLI
  surface: **report the outcome, not the intent.** A command that reports success for a failed IPC call is a
  blocking review finding.
- **`--pretty`** optional flag for human-readable output; **JSON is the default** so scripts/agents are the
  first-class consumer.
- **No interactive prompts.** Every input is an argument, flag, or stdin, so every command is fully scriptable.

## 4. Single source of truth — a command registry (do this refactor FIRST, Phase 0)

Introduce a command registry in `core/cli/src` mapping each command to
`{ name, summary, argSpec, ipcMethod, handler }`. Everything derives from it:

- the dispatch switch (`bin/cello.ts`),
- **`cello --help`'s described `Commands:` table** — rendered from each entry's `summary` (this closes
  DOD-ONBOARD-HELP-1's remaining gap; see §7),
- per-command `cello <cmd> --help` (already good — keep its detail; the registry just becomes its source).

Result: the help table, per-command help, and dispatch **cannot drift**, and adding a command **forces** adding
its one-line summary.

## 5. The mapping — every MCP tool → its CLI command

**Already covered (no work — listed so the parity claim is auditable):**
`cello_status`→`status`, `cello_list_sessions`→`sessions`, `cello_settings_get/set`→`settings`,
`cello_set_moniker`→`moniker` (the agent's OWN offered name), `cello_get_sealed_receipt`→`receipts`,
`cello_contact_add/remove/list`→`contact`.

### Group A — operator control, data custody, address book (thin pass-throughs)

| MCP tool | New CLI command | Notes |
|---|---|---|
| `cello_list_agents` | `cello agents` | list all loaded agents (noun-list, mirrors `sessions`) |
| `cello_start_agent` | `cello start-agent <name>` | bring online WITHOUT claiming current |
| `cello_stop_agent` | `cello stop-agent <name>` | |
| `cello_use_agent` | `cello use-agent <name>` | selects current; auto-starts if offline (AUTOSTART-1) |
| `cello_backup` | `cello backup [--out <path>]` | **data custody — trust-relevant** |
| `cello_restore` | `cello restore <path>` | |
| `cello_check_notifications` | `cello inbox [--scope current\|all]` | the push-loss reconciler / poll inbox |
| `cello_get_transcript` | `cello transcript <session-id> [--since-seq N]` | |
| `cello_get_inclusion_proof` | `cello inclusion-proof <session-id>` | (or extend `receipts` — your call, keep it discoverable) |
| `cello_contact_set_tier` | `cello contact set-tier <name> <tier>` | extend the existing `contact` sub-router |
| `cello_contact_set_away` | `cello contact set-away <name> <message>` | |
| `cello_contact_set_moniker` | `cello contact set-moniker <name> <moniker>` | (per-CONTACT pet name — distinct from `moniker`) |

### Group B — live conversation (mirror the MCP params exactly; scriptable, not interactive)

| MCP tool | New CLI command | Notes |
|---|---|---|
| `cello_initiate_session` | `cello initiate <target>` | target = agent name or pubkey; prints `session_id` |
| `cello_send` | `cello send <session-id> <message>` | message via arg or `--stdin`; **honors read-before-write** — surface `session_not_current` verbatim, never auto-fix |
| `cello_receive` | `cello receive <session-id> [--since-seq N] [--timeout-ms N]` | mirror the MCP timeout/since-seq semantics exactly |
| `cello_close_session` | `cello close <session-id>` | |
| `cello_await_session` | `cello await-session [--timeout-ms N]` | block for an inbound session doorbell |
| `cello_receive_session` | `cello receive-session <session-id>` | accept / join an inbound session request |

> **Names above are proposals; keep them consistent with existing CLI conventions.** What is NOT negotiable:
> each command calls the **same IPC handler** its MCP tool calls and preserves that tool's **exact semantics**
> (especially Group B — the read-before-write cursor on `send`, the blocking/timeout on `receive`/
> `await-session`). Trace each MCP tool to its handler in the shim, then wire the CLI to the identical call.

## 6. Non-goals / guardrails (falsify against these before committing)

- **CLI-only.** No daemon IPC handler changes; no MCP shim changes. If a handler is missing, STOP and flag.
- **One IPC client.** Reuse the CLI's existing daemon IPC client; do not add a second.
- **`agent_id` discipline.** Commands take the agent NAME as the human label and pass it to the daemon, which
  resolves to `agent_id`. Do NOT add name-as-key logic in the CLI. (CLAUDE.md: join on the stable key.)
- **Fixture discipline.** Reuse/extend `packages/e2e-tests/src/session-fixture.ts` (add non-breaking `opts`).
  A from-scratch fixture is a blocking review finding.
- **No `node:sqlite`** (project rule) — the CLI touches no DB directly anyway.
- **Do not reformat / re-word the per-command help** — you confirmed it's good; only move its source into the
  registry.

## 7. Folded in: DOD-ONBOARD-HELP-1's remaining gap

The orientation header on `cello --help` already shipped (CC-7, `f486e32`, in cli 0.0.44). What remains is the
**described `Commands:` table** — today the command list is still a single pipe-delimited blob with no
per-command descriptions. The registry (§4) renders that table from each entry's `summary`, git/`claude --help`
style (each command on its own line + one-liner; arguments stay in per-command `--help`). Landing this table
**closes DOD-ONBOARD-HELP-1.**

## 8. Execution phases (SPARC + TDD; gate + review each unit)

- **Phase 0 — registry + JSON-out contract + HELP-1 command table.** Prove: `cello --help` renders the
  described table from the registry; every existing command still behaves identically (regression-locked).
- **Phase 1 — Group A.** Each command: red test driving the **real daemon IPC** through `session-fixture`
  (assert JSON shape + exit code + that it hit the right handler) → implement → green.
- **Phase 2 — Group B.** Same discipline; preserve exact cursor/timeout semantics.
- **Phase 3 — the bash-only e2e smoke (crown jewel).** Two agents **connect → send → receive → bilateral
  seal entirely via `cello` commands**, no MCP. This proves the bash-adapter claim and gives us a scripted
  live-smoke we don't have. Reuse the fixture harness; assert the sealed root matches on both sides.
- **Phase 4 — publish.** `cli` is a leaf (nothing depends on it; `connect` is unaffected), so this is a
  **cli-only** bump. **Load `/cello-publish` first.** Bump `core/cli/package.json`, `pnpm install`, commit,
  tag the next free `v*`, push → CI publishes to `beta`. **Verify against the binary** (`npm pack
  @cello-protocol/cli@<ver>`, grep `dist/` for the new commands). Then **Andre promotes to `latest`**
  (operator-run — prepare the command set + `--dry-run`, hand it over, do NOT run it).

## 9. Definition of done (what earns the ✅)

- Every `cello_*` MCP tool has a `cello` command calling the **same IPC handler**, honoring the JSON-out +
  exit-code + verbatim-structured-error contract (§3).
- `cello --help` shows the described `Commands:` table including all new commands — **DOD-ONBOARD-HELP-1
  closed**.
- The **bash-only** two-agent connect → send → receive → seal smoke passes.
- Gate sequence green each unit (`pnpm test` → `lint` → `typecheck` → `build`); `cello-unit-reviewer` clean
  (findings fixed); published to `beta` and **verified against the tarball**, not memory.

## 10. Related

- [[M8C-DEFINITION-OF-DONE]] — new line **DOD-CLI-PARITY-1** (this work); **DOD-ONBOARD-HELP-1** (folded — the
  command table).
- [[M8C-ONBOARDING-IMPROVEMENTS]] — **P2-5** (the help table, folded here); **P2-6** (the inverse direction —
  CLI-only capabilities missing from the MCP surface — **appears already closed**: `cello_contact_*` are on the
  MCP surface now via the address-book work; confirm and tick it off, don't rebuild).
- [[2026-07-09_1915_hermes-agent-integration-plan]] — the runtime-reach precedent; bash parity generalizes it.
