---
name: cli-help-revision-workorder
type: user-story
date: 2026-07-11
topics: [cli, help, onboarding, dod-onboard-help-1, command-naming, grouping, cello-support-workorder]
status: ready-to-execute
description: >
  Executable work order (for CELLO_Support): revise the `cello --help` command surface after Andre's live
  review reopened DOD-ONBOARD-HELP-1. The table STRUCTURE shipped (cli 0.0.45); the CONTENT fails "REAL
  help" — opaque/misleading descriptions, arbitrary order, and two command names/shapes that mislead. This
  pass fixes wording, groups + logically orders the commands, renames `install`→`bridge` and
  `register`→`register-agent`, and splits `contact`→`contacts`(+`contact`). CLI-only for the help/renames;
  two optional daemon guidance-string fixes noted separately.
---

# CLI help + command-surface revision (DOD-ONBOARD-HELP-1 reopen)

> Execute cold. CELLO SPARC + TDD (red-first), gate sequence per unit, `cello-unit-reviewer` on **Fable 5**,
> reuse `session-fixture.ts`. Do NOT run the `latest` promotion (Andre's) and do NOT run `deploy.sh`.

## Why (Andre's live review, 2026-07-11)

The described `Commands:` table renders, but reading it as a *new user* (and as the architect) exposed that
the descriptions are opaque or misleading, the order is arbitrary (`register` before `create-agent`), and two
commands mislead by name/shape (`install` reads as "install CELLO itself" + hardcodes the Hermes *parameter*;
`contact` is singular and mixes list-the-book with operate-on-one). "REAL help" (HELP-1's bar) = **accurate +
intuitive descriptions + a sane order**. This closes HELP-1 for real.

## 1. Grouped, logically-ordered help (decided: grouped, NOT alphabetical)

The renderer emits **sections**, in this fixed group order, with the **within-group order below** (logical,
not alphabetical — Andre fixed Setup + Agents explicitly; refine the others only if a clearer flow is obvious):

- **Setup:** `login` · `logout` · `status` · `create-agent` · `register-agent` · `remove-agent`
- **Agents:** `agents` · `start-agent` · `use-agent` · `stop-agent` · `refresh`
- **Messaging:** `initiate` · `await-session` · `receive-session` · `close-session` · `send` · `receive` · `inbox`
  (session-lifecycle verbs first and clustered, then the bare message verbs, then `inbox` last — Andre 2026-07-11)
- **Sessions & receipts:** `sessions` · `transcript` · `receipts` · `sealed-receipt`
- **Contacts:** `contacts` · `contact`
- **Other:** `settings` · `telegram` · `bridge`

`inbox` moves INTO Messaging (Andre: it's not its own category). `settings`/`telegram`/`bridge` are **Other**,
not "integrations". Implement group + explicit order as registry metadata so the table stays a single source
of truth (dispatch + help + per-command help all derive from it, as today). Keep the bash-adapter footer.

## 2. Renames (CLEAN — no aliases; single user, pre-launch, so update all references and delete the old name)

- **`install` → `bridge`.** Description: **"Bridge CELLO into a third-party agent runtime (Hermes, OpenClaw,
  …)."** The runtime is a PARAMETER — never hardcode Hermes in the description; name the supported ones in
  parentheses with the trailing `…` (more coming).
- **`register` → `register-agent`** (parallel with `create-agent`/`remove-agent`; "register" alone doesn't say
  *what* you register — Andre). **Grep and update every reference**: the
  onboarding first-run string in `cli-args.ts` USAGE ("First-time setup: … cello register …"), the per-command
  help, the Telegram handoff text, and any doc/portal/ops-agent copy that says `cello register`. A rename that
  leaves the onboarding string pointing at the old verb is a half-rename.
- **`close` → `close-session`** (Andre: it closes a *session*; this also clusters the session-lifecycle verbs
  `await-session`/`receive-session`/`close-session`, leaving `send`/`receive` as the bare message verbs). Keep
  **`initiate` → `initiate-session`** too — it matches the MCP tool `cello_initiate_session` and completes the
  `*-session` parallel (send/receive stay bare).
- **No aliases, no back-compat.** There is exactly ONE user (Andre) and no install base (pre-launch), so every
  rename is a CLEAN rename: update all references and DELETE the old name. No deprecated aliases or alias tests.

## 2b. CLI ↔ MCP name parity — ONE vocabulary (Andre 2026-07-11)

A capability must carry the **same name on both surfaces** — humans and agents learn it once. Two implications:

**Our renames vs the MCP tools (most CONVERGE — the CLI had shortened names the MCP kept verbose):**
- `close-session` ↔ `cello_close_session` — the CLI rename *closes* a pre-existing gap (CLI had `close`).
- `initiate-session` ↔ `cello_initiate_session` — **this SETTLES the initiate question: YES rename**, because
  the MCP tool is already `_session`. Renaming aligns them.
- `await-session` ↔ `cello_await_session`, `receive-session` ↔ `cello_receive_session` — already match.
- `bridge`, `register-agent` — CLI-only (no MCP tool); nothing to match.
- `contacts`/`contact <pubkey> <op>` ↔ `cello_contact_*` — align (list under `contacts`; per-contact ops map
  to `cello_contact_set_tier/away/moniker/add/remove`).

**DECIDED — FULL reconciliation (Andre 2026-07-11).** The rule: **an MCP tool's name is `cello_` + the CLI
command name** (snake_cased; multi-verb commands keep their sub-verb, e.g. `cello_settings_get`,
`cello_contact_set_tier`). The CLI keeps its terse names; the MCP tools drop the `list_`/`get_`/`check_` cruft
to match. The concrete MCP renames (apply the rule across the FULL tool inventory — enumerate every `cello_*`
tool in the connect shim and rename any that doesn't already equal `cello_<cli-command>`; flag any awkward
case rather than guessing):
- `cello_list_agents` → `cello_agents`
- `cello_check_notifications` → `cello_inbox`
- `cello_list_sessions` → `cello_sessions`
- `cello_get_transcript` → `cello_transcript`
- `cello_get_sealed_receipt` → `cello_sealed_receipt`
- `cello_get_relay_receipts` → matches whatever `receipts` ends up named after the §4 semantics check (e.g.
  `cello_relay_receipts` if the CLI command becomes `relay-receipts`).
- `cello_set_moniker` → `cello_moniker`  (the agent's OWN name; distinct from `cello_contact_set_moniker`)
- contact tools align to the §3 split: `cello_contacts` (list the book) + `cello_contact_add/remove/set_tier/
  set_away/set_moniker` (per-contact).
- Already matching, leave alone: `cello_send`/`cello_receive`/`cello_status`/`cello_start_agent`/
  `cello_stop_agent`/`cello_use_agent`/`cello_close_session`/`cello_initiate_session`/`cello_await_session`/
  `cello_receive_session`/`cello_settings_get`/`cello_settings_set`.
- `cello_get_inclusion_proof`/`cello_backup`/`cello_restore` — leave for DOD-CUSTODY-DAEMON-1 (no CLI command
  yet; they're stubs).

This is a **breaking MCP change** — it renames the tools THIS session and any skill/doc references use. Clean
rename, no aliases (single user, pre-launch). Publish becomes **connect + cli** (the daemon IPC method names
need NOT move — the shim maps tool `cello_agents` → the existing `list_agents` IPC method). Update the
tool→command→handler audit map and any skill (`cello-walkie-talkie`) / doc that names a renamed tool.

## 3. Split `contact` → `contacts` + `contact` (DECIDED — split, Andre 2026-07-11)

- **`contacts`** — the address book as a whole: `cello contacts` (list, filters like `--tier`/`--agent` as
  they exist today). Plural, high-level. MCP: `cello_contacts`.
- **`contact <pubkey> <op>`** — operations on ONE contact: `add` / `remove` / `set-tier` / `set-away` /
  `set-moniker`. Singular, per-contact. MCP: `cello_contact_add/remove/set_tier/set_away/set_moniker`.
- Clean rename of the old flat `cello contact list/add/...` shape — no alias (single user, pre-launch).

## 4. Wording — accurate + intuitive, no internal jargon

Replace jargon ("epoch", "watermark", "read-before-write", "doorbell" as a noun, "relay ordering") with plain
language. **VERIFY the actual semantics against the IPC handler before finalizing `refresh` and `receipts`** —
these were opaque even to the architect, so a wrong-but-confident description is worse than the status quo.

| command | new description (verify handler where noted) |
|---|---|
| `refresh` | "Rotate an agent's split-key shares to a fresh epoch — periodic key hygiene / re-enrollment." **(verify)** |
| `receipts` | Relay per-message **ordering** proofs (relayed/offline delivery). **(verify exact meaning; if it's an advanced/debug artifact most users never need, say so or move it out of the everyday set.)** |
| `sealed-receipt` | "Print a closed session's **notarized bilateral seal** — the tamper-evident proof both parties signed off on the whole conversation." |
| `sessions` | "List your sessions (open by default; `--all`/`--closed`/`--failed` to filter)." |
| `telegram` | "Connect a Telegram bot to your daemon for notifications, status updates, etc." (the "etc." is deliberate — more coming, don't claim done.) |
| `use-agent` | "Select the agent that later commands operate through." |
| `send` | "Send a message. Any unread messages must be read first — you'll be told, and blocked until you do." (drop "honors read-before-write".) |

`receipts` vs `sealed-receipt` MUST read as clearly different artifacts — Andre could not tell them apart.

## 5. Two daemon-side guidance strings (batch IF you bump the daemon; else defer)

These are produced by the daemon, so including them makes this a **daemon+cli** cascade instead of cli-only.
Both are small; batch them if a daemon bump is otherwise warranted, else defer to the next daemon touch and
say so — do not silently drop:

- **`send` refusal (DOD-CURSOR-DURABLE-1 gate):** the `session_not_current` guidance should read in plain
  words — e.g. "N unread message(s) — run `cello receive <session>` first" — not just reason codes. Andre
  explicitly wants the block to *tell* you why.
- **P2-7:** the `no_current_agent` guidance says "call `cello_use_agent`" (the **MCP tool** name) in a CLI
  context; render the caller-appropriate verb (`cello use-agent`). See [[M8C-ONBOARDING-IMPROVEMENTS]] P2-7.

## 6. Guardrails / process

- Scope is **cli + connect** (FULL §2b renames the MCP tools in the connect shim). The two §5 strings are the
  only daemon-side pieces — decide batch-vs-defer explicitly (if batched, add a daemon bump).
- Renames update the **tool→command→handler audit map** and every test that names the old command/tool; the
  audit test must still pass (it's the parity guarantee — and now it also guarantees the *names* match).
- Reuse `session-fixture.ts`; from-scratch fixture is a blocking finding.
- SPARC/TDD red-first; gate sequence; `cello-unit-reviewer` (Fable 5); fix every finding.
- Publish cascade: **cli `0.0.45 → 0.0.46` + connect `0.0.65 → 0.0.66`** (+ daemon `0.0.47 → 0.0.48` only if
  the §5 strings are batched). Load `/cello-publish`. Verify against the tarball (grep `dist/` for the new
  groups, `bridge`/`register-agent`/`close-session`/`initiate-session`, the renamed MCP tools, and the reworded
  strings). Andre promotes to `latest` (prepare `--dry-run`, hand over — do NOT run it).

## 7. Definition of done

- `cello --help` renders **grouped**, logically-ordered sections with **accurate, jargon-free** descriptions;
  `bridge`/`register-agent`/`close-session`/`initiate-session`/`contacts`(+`contact`) in place, old names gone.
- `receipts` and `sealed-receipt` are unmistakably different in the help; `send`/`telegram`/`refresh`/
  `sessions`/`use-agent` read plainly.
- **CLI↔MCP name parity holds:** every capability has one name on both surfaces (`cello <x>` ↔ `cello_<x>`);
  the audit test enforces it.
- Published to beta + verified against the binary; **HELP-1 closes on Andre's live confirmation** of the
  revised `cello --help`.

## Related
- [[M8C-DEFINITION-OF-DONE]] — DOD-ONBOARD-HELP-1 (reopened 2026-07-11), DOD-CLI-PARITY-1.
- [[2026-07-11_cli-mcp-parity-plan]] — the parity pass this refines.
- [[M8C-ONBOARDING-IMPROVEMENTS]] — P2-7 (the CLI/MCP guidance-name seam).
