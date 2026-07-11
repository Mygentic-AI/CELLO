---
name: latest-promotion-v0.0.97
type: runbook
date: 2026-07-11
topics: [publish, npm, dist-tag, latest, promotion, cli-help, onboard-help-1, vocabulary, operator-run]
status: awaiting-operator
description: >
  The `latest` promotion command set for the v0.0.97 cascade (daemon 0.0.49, cli 0.0.47, connect 0.0.67)
  — DOD-ONBOARD-HELP-1 + the receive-session deletion. PREPARED, NOT RUN. Andre executes it.
  SUPERSEDES the v0.0.96 runbook — promote THIS one.
---

# `latest` promotion — v0.0.97 (daemon 0.0.49, cli 0.0.47, connect 0.0.67)

> **NOT RUN.** Promotion to `latest` is **operator-run** (`/cello-publish` step 6) and needs Andre's go.
> This file is the prepared command set, nothing more.
>
> **Promote v0.0.97, NOT v0.0.96.** v0.0.96 is superseded: it predates the `receive-session` deletion,
> and it ships a `SKILL.md` that hands agents a tool list which is largely fiction (below).

## What v0.0.97 contains

Everything in v0.0.96 (grouped help, clean renames, the one vocabulary), **plus**:

- **`receive-session` DELETED** (Andre's ruling). It was a literal alias of `receive` — the daemon
  registered the *same handler object* for both. It accepted or joined nothing (inbound sessions are
  auto-accepted by the standing receiver), so it was a second name for a step CELLO does not have, and its
  help claimed otherwise. Gone from the CLI, the MCP tool list, the vocabulary, **and the daemon handler**
  — no alias, no deprecated shim, no dead handler.
- **`SKILL.md` rewritten.** It ships inside the connect tarball and is the doc that hands an agent its tool
  list. It had drifted into fiction: it named **eleven tools that do not exist** (an entire M1-era
  "connect to peers" flow — `cello_request_connection`, `cello_accept_connection`, `cello_get_policy`,
  `cello_setup_guidance`, `cello_list_connections`…), told agents to register via MCP when registration has
  been a CLI step for milestones, and **never mentioned 15 tools that do exist**. Now written against the
  26 tools the shim actually registers, with the real setup flow and an explicit *not yet implemented* note
  on backup/restore/inclusion-proof rather than advertising stubs as working.

## ⚠️ BREAKING MCP change — a `/mcp` reconnect is required

Seven tools renamed, one deleted. Any skill, doc or prompt naming an old one must be updated.

| old | new |
|---|---|
| `cello_list_agents` | `cello_agents` |
| `cello_list_sessions` | `cello_sessions` |
| `cello_check_notifications` | `cello_inbox` |
| `cello_get_transcript` | `cello_transcript` |
| `cello_get_sealed_receipt` | `cello_sealed_receipt` |
| `cello_set_moniker` | `cello_moniker` |
| `cello_contact_list` | `cello_contacts` |
| `cello_receive_session` | **DELETED** — use `cello_receive` |

Already updated in-repo: `cello-walkie-talkie`, `cello-audit-session`, `cello-chat`, the four active design
specs, the scaffolded Hermes plugin/skill, and the shipped `SKILL.md`.

An old shim calling the deleted method against the new daemon gets a loud, terminal
`Unknown IPC method 'cello_receive_session'` naming version skew as the cause — it does not hang or retry.

The daemon's IPC **wire** names for the *renamed* tools deliberately did NOT move (a new daemon must keep
serving an old shim); only the deleted capability's handler was removed.

## 1. Verify the beta artifacts

```bash
for p in crypto protocol-types transport client daemon cli connect; do
  echo "$p beta: $(npm view @cello-protocol/$p@beta version)"
done
# → daemon 0.0.49 · cli 0.0.47 · connect 0.0.67
#   (crypto 0.0.18, protocol-types 0.0.19, transport 0.0.17, client 0.0.48 — unchanged)
```

## 2. The promotion command set (Andre runs this)

Promote all seven so the `latest` graph stays consistent — the four unchanged ones just print a harmless
*"latest is already set"* warning.

```bash
npm dist-tag add @cello-protocol/cli@0.0.47 latest
npm dist-tag add @cello-protocol/daemon@0.0.49 latest
npm dist-tag add @cello-protocol/connect@0.0.67 latest
npm dist-tag add @cello-protocol/client@0.0.48 latest
npm dist-tag add @cello-protocol/crypto@0.0.18 latest
npm dist-tag add @cello-protocol/transport@0.0.17 latest
npm dist-tag add @cello-protocol/protocol-types@0.0.19 latest
```

Each prints `+latest: @cello-protocol/<pkg>@<ver>` — **that line is the authoritative confirmation**, not
the verify loop below (npm's CDN can lag 1–2 minutes on a just-set dist-tag).

```bash
for p in connect cli daemon client crypto transport protocol-types; do
  echo "$p latest: $(npm view @cello-protocol/$p@latest version)"
done
```

## 3. Then install and read the help — that IS the acceptance test

```bash
npm i -g @cello-protocol/cli@latest @cello-protocol/connect@latest
cello logout && cello login     # restart the daemon onto the new binary (CLI lifecycle, not pkill)
# reconnect the MCP: /mcp   (or restart Claude Code) — REQUIRED, the tool names changed
cello --help
```

**DOD-ONBOARD-HELP-1 closes on your live confirmation of that output**, not on a green test run.

## 4. Still open (logged, not built)

- **DOD-LEGACY-MCP-1** — the legacy in-process MCP servers (`adapter/server.ts`, `client/mcp-server.ts`)
  still register the pre-rename tools *and are exported from their package roots*, so "dead code" is only
  half true: it is a second vocabulary on the public export surface. Nothing drives them at runtime, so not
  a launch blocker. Fix: delete the `createMcpServer` / `createMcpSessionServer` exports.
- **DOD-CUSTODY-DAEMON-1** — `cello_backup` / `cello_restore` / `cello_get_inclusion_proof` are
  `not_implemented` daemon stubs. Data custody works through **no** surface today. SKILL.md now says so
  rather than advertising them as working.
- **`moniker`'s group** — the §1 group list omitted it; placed in **Other**, next to `settings`. Confirmed.

## Related

- [[2026-07-11_cli-help-revision-workorder]] — the spec this executes.
- [[2026-07-11_latest-promotion-v0.0.96]] — SUPERSEDED, kept as the record of what v0.0.96 contained.
- [[M8C-DEFINITION-OF-DONE]] · [[M8C-BUILD-JOURNAL]]
