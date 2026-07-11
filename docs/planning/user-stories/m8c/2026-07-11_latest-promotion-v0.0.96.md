---
name: latest-promotion-v0.0.96
type: runbook
date: 2026-07-11
topics: [publish, npm, dist-tag, latest, promotion, cli-help, onboard-help-1, vocabulary, operator-run]
status: awaiting-operator
description: >
  The `latest` promotion command set for the v0.0.96 cascade (daemon 0.0.48, cli 0.0.46, connect 0.0.66)
  — DOD-ONBOARD-HELP-1. PREPARED, NOT RUN. Promotion is Andre's to execute (/cello-publish step 6).
---

# `latest` promotion — v0.0.96 (daemon 0.0.48, cli 0.0.46, connect 0.0.66)

> ## ⛔ SUPERSEDED — DO NOT PROMOTE v0.0.96. Promote **v0.0.97**.
>
> Andre ruled (2026-07-11) that `receive-session` is DELETED, and asked for the delete to ride the
> NEXT cut so it lands in the promoted build rather than forcing a promote-then-re-promote. He also
> promotes **v0.0.97, not v0.0.96**.
>
> **v0.0.96 additionally ships a defect:** `SKILL.md` — which is inside the connect tarball and is the
> doc that hands an agent its tool list — still named `cello_list_sessions`, `cello_get_sealed_receipt`
> and `cello_receive_session` (all renamed or deleted), plus eleven M1-era tools that have not existed
> for milestones. Promoting it would hand every agent a tool list that is largely fiction. Fixed in
> v0.0.97.
>
> **→ Use [[2026-07-11_latest-promotion-v0.0.97]].** This file is kept only as the record of what
> v0.0.96 contained.

## What changed

**DOD-ONBOARD-HELP-1** — Andre reviewed the live `cello --help` and reopened the line: the table rendered,
but the CONTENT was not "REAL help." `register` sat above `create-agent` (step 2 above step 1), `install`
read as "install CELLO itself", `receipts` and `sealed-receipt` differed by a single plural, and several
descriptions were internal jargon.

- **Grouped, logically-ordered help** — Setup · Agents · Messaging · Sessions & receipts · Contacts · Other.
- **Clean renames, no aliases** — `install`→`bridge`, `register`→`register-agent`, `close`→`close-session`,
  `initiate`→`initiate-session`, `receipts`→**`relay-receipts`**; `contact` split into `contacts` (the book)
  and `contact <pubkey> <op>` (one contact). **The old names are DELETED**, not aliased.
- **ONE vocabulary** — an MCP tool's name is now `cello_` + the CLI command name. You learn a capability
  once: `cello send` ↔ `cello_send`. The daemon RENDERS its ~50 error-guidance strings for the surface that
  asked, so a CLI caller is told `cello use-agent` and an MCP caller `cello_use_agent`.
- **A phantom, killed** — the daemon had been telling operators to run `cello_list_connections`, a command
  with zero handlers and zero registrations that has never existed on the shipped surface.

## ⚠️ This is a BREAKING MCP change

Seven MCP tools were renamed. Any skill, doc, or prompt naming an old one must be updated:

| old | new |
|---|---|
| `cello_list_agents` | `cello_agents` |
| `cello_list_sessions` | `cello_sessions` |
| `cello_check_notifications` | `cello_inbox` |
| `cello_get_transcript` | `cello_transcript` |
| `cello_get_sealed_receipt` | `cello_sealed_receipt` |
| `cello_set_moniker` | `cello_moniker` |
| `cello_contact_list` | `cello_contacts` |

Already updated in-repo: the `cello-walkie-talkie` and `cello-audit-session` skills, the four active design
specs, and the scaffolded Hermes plugin/skill. The daemon's IPC **wire** names deliberately did NOT move — a
new daemon must keep serving an OLD connect shim.

## 1. Verify the beta artifacts (already done — recorded here so you can re-check)

```bash
for p in crypto protocol-types transport client daemon cli connect; do
  echo "$p beta: $(npm view @cello-protocol/$p@beta version)"
done
# → daemon 0.0.48 · cli 0.0.46 · connect 0.0.66 · (crypto 0.0.18, protocol-types 0.0.19,
#   transport 0.0.17, client 0.0.48 unchanged)
```

Verified against the **tarballs**, not the commit:
- `daemon@0.0.48` dist contains `vocabulary.js`, `renderForSurface`, `toCliGuidance`, `deadCliVerbPattern`,
  `CALL_FORMS`, `invalid_pubkey`.
- `cli@0.0.46` dist has `bridge`/`register-agent`/`close-session`/`initiate-session`/`relay-receipts`/
  `contacts`; **zero** old command names remain dispatchable; the scaffolded Hermes assets name zero deleted
  tools.
- `connect@0.0.66` dist registers all seven renamed tools, **zero** old registrations, and still calls the
  unchanged IPC wire methods.
- Cross-pins are real versions, never `workspace:*`: `cli@0.0.46 → daemon@0.0.48`.

## 2. The promotion command set (Andre runs this)

Promote all seven so the `latest` graph stays consistent — the four unchanged ones just print a harmless
*"latest is already set"* warning.

```bash
npm dist-tag add @cello-protocol/cli@0.0.46 latest
npm dist-tag add @cello-protocol/daemon@0.0.48 latest
npm dist-tag add @cello-protocol/connect@0.0.66 latest
npm dist-tag add @cello-protocol/client@0.0.48 latest
npm dist-tag add @cello-protocol/crypto@0.0.18 latest
npm dist-tag add @cello-protocol/transport@0.0.17 latest
npm dist-tag add @cello-protocol/protocol-types@0.0.19 latest
```

Each prints `+latest: @cello-protocol/<pkg>@<ver>` — **that line is the authoritative confirmation**, not the
verify loop (npm's CDN can lag 1–2 minutes).

```bash
for p in connect cli daemon client crypto transport protocol-types; do
  echo "$p latest: $(npm view @cello-protocol/$p@latest version)"
done
```

## 3. Then install and look at the help — that is the acceptance test

```bash
npm i -g @cello-protocol/cli@latest @cello-protocol/connect@latest
cello logout && cello login     # restart the daemon onto the new binary (CLI lifecycle, not pkill)
# reconnect the MCP: /mcp   (or restart Claude Code) — the tool names changed, so this is required
cello --help
```

**HELP-1 closes on your live confirmation of that output**, not on a green test run.

## 4. Still open

- **`receive-session` — awaiting your ruling.** It is a literal ALIAS of `receive` (the daemon registers the
  SAME handler for both). It does not accept or join anything — inbound sessions are auto-accepted by the
  standing receiver — and its help claimed an "Accept / join an inbound session request" step that CELLO does
  not have. Under the no-aliases doctrine it should be DELETED (CLI command + `cello_receive_session` tool).
  It is currently kept, but described truthfully. Deletion is a one-liner.
- **`moniker`'s group** — the §1 group list omitted it. Placed in **Other**, next to `settings`.
- [[M8C-DEFINITION-OF-DONE]] → **DOD-LEGACY-MCP-1** (new): the legacy in-process MCP servers still name the
  pre-rename tools and ARE exported from their package roots — a second vocabulary on the public surface.
  Not a launch blocker; nothing drives them at runtime.

## Related

- [[2026-07-11_cli-help-revision-workorder]] — the spec this executes.
- [[M8C-DEFINITION-OF-DONE]] · [[M8C-BUILD-JOURNAL]] · [[2026-07-11_latest-promotion-v0.0.95]]
