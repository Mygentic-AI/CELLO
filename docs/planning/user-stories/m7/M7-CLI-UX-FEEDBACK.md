---
name: M7 CLI/MCP UX Feedback — new-user clean-room walkthrough
type: feedback
date: 2026-06-25
milestone: M7
status: open
topics: [cli, ux, onboarding, feedback, cello-status, cello-login, create-agent, human-and-llm-readable]
description: >
  Live feedback Andre gave while walking through the published cello-client as a brand-new user
  (clean directory, fresh install). The CLI/MCP output is the ONLY feedback surface (no web UI), so
  every command must orient + guide both a human AND the LLM driving it. This is the ACTIVE next
  task: implement these output improvements. Captured at the compaction boundary 2026-06-25.
---

# M7 CLI/MCP UX Feedback — the active next task

## Why this exists (the design north star — Andre, verbatim intent)

There is **no web page** giving users a nice status/onboarding experience. The **CLI and MCP tool
output is the ONLY feedback surface.** So every command must be **self-explanatory and point the way
forward**, readable by **both a human glancing at it AND the LLM driving it**. State-aware messages,
not raw enum/JSON dumps. Provide pointers and guidance (Telegram bot, next command, rules) at every
step where a user could be stranded.

## The feedback items (to implement)

**#1 — `cello login` gives no sense of state; "login" over-promises.**
Output today is just `Daemon started.` Problems: "login" implies authentication that never happens;
it says nothing about *where you are*. On a FIRST run (fresh dir, no agents) it should deliver the
WHOLE on-ramp at the moment the user is stranded:
- daemon started; this is a fresh install / no agents yet / you are not registered;
- next step: `cello create-agent <name>` (state the name rules: 1–64 chars, letters/digits/`-`/`_`,
  case-sensitive);
- then: get a one-time pre-auth token from **@CelloConnectStagingBot** (Telegram), then
  `cello register <name> <token>`;
- the directory-connection state in plain words.

**#2 — `cello status` is a raw JSON dump with no interpretation.**
Short enough to read, but the fields read as broken/jargon to a human:
- `directory_signaling: "reconnecting"` LOOKS broken on first glance. It must be **state-aware**:
  "waiting for an agent before connecting to the directory" (fresh, no agent) vs "reconnecting to the
  directory…" (real outage). Same field, different meaning depending on what's actually happening.
- When `agents: []`, **point to Telegram**: "No agents registered. Get a token from
  @CelloConnectStagingBot, then `cello register …`."
- `standing_receiver_ready`, `retryQueueDepth`, `interrupted_sessions` are jargon. Either annotate
  each field inline with a short "what this means," or surface a pointer (`cello help status` /
  `cello status --explain`), and keep the raw object behind `--json` for machines.

**#3 — Agent-name rules are invisible until violated; case-sensitivity surprises.**
The `invalid_agent_name` error states the rules only AFTER a wrong guess. And the name is the local
`agents` table PK → **case-sensitive**: `Alice` ≠ `alice` (create `Alice`, later type `alice` → "not
found" or a silent second agent). Surface the rules up front (in `create-agent` help / prompt) and
decide deliberately whether names should be case-insensitive. Validation is
`/^[a-zA-Z0-9_-]{1,64}$/` at `core/daemon/src/daemon.ts:1124` (capitals ARE allowed).

**#4 — `cello create-agent` success gives no next-step and dumps a misleading pubkey.**
Today returns `{ ok, name, pubkey }`. "I thought I was creating an agent but nothing seems to have
happened." Fixes:
- Say what happened + what's next: "Created agent 'X'. It's local-only and not yet registered. Next:
  get a one-time token from @CelloConnectStagingBot, then `cello register X <token>`."
- The shown `pubkey` is the **K_local** key — NOT the key others use to reach you (that's the FROST
  `primary_pubkey` you get AFTER registering). Showing it unlabeled actively misleads. Either omit it
  from the headline or label it ("your local identity key — not yet reachable; register to get your
  contact key").
- On FAILURE, the error should state the name limitations (ties to #3).

**Scope note:** these live in `core/cli/src/commands.ts` (login/logout/status/register/create-agent
CLI output) and the daemon handlers' `guidance` strings (`core/daemon/src/daemon.ts`) which the MCP
surfaces. The status object is built in the daemon (`cello_status` handler) + returned by `cello
status` (CLI). Keep machine-readable JSON behind `--json`; default to human-readable + guidance.
Per the actionable-error-messages rule (memory): every failure response already needs a `guidance`
field — this extends the same discipline to SUCCESS + status output.

## Where we are (so post-compaction can resume exactly)

- **CELLO-M7-PERSIST-002** (all client state in ONE SQLCipher-encrypted store; no flat-file state) —
  **DONE + SHIPPED + on `latest`.** DoD: DOD-STORE-1 ✅ core live (encrypted store, no flat-file,
  identity reload) + 🟡 four sub-claims unit-green (functional signing-after-restart, AC-005
  immediate-kill race, the one-time migration, fail-closed) per the done-auditor split.
- **CELLO-M7-ONBOARD-001** (keystone elects the first runtime-created agent → directory connects with
  NO restart) — **DONE + SHIPPED + on `latest`.** DoD: DOD-ONBOARD-1, proven live (J-ONBOARD).
- **Published `latest`:** `cli@0.0.8` → `daemon@0.0.10` (the keystone fix + SQLCipher), `connect@0.0.48`.
  Last tag `v0.0.52` (next monotonic tag = `v0.0.53`). smoke-tag green, binaries verified.
- **System fully reset for a clean-room new-user test:**
  - Directory (cello-dev, all 3 regions us-east-1 / eu-central-1 / ap-northeast-1) **WIPED**: 0
    agents / users / pre_auth_tokens / sessions / conversation hashes. KEPT `relay_registrations`
    (3), `flyway_schema_history`, `directory_nodes` (was already empty). Active logical replication
    (`cello_pub`, `pubtruncate=true`; subs from eu+ap) — wiped each region independently anyway.
  - Local `~/.cello` deleted; old global install removed; stale `cello` MCP entry removed.
  - Andre then **reinstalled** `@cello-protocol/cli@latest` + `@cello-protocol/connect@latest`
    globally (~45s, no compile — prebuilt natives), ran `cello login` (Daemon started) → `cello
    status` (reconnecting, 0 agents — expected) → `cello create-agent Ms_Chelly` → ok, pubkey
    `be66b5b16fc1737ca9bfe7dd933485d8caf08cde0a895a1b605ba6795495f2b0`. Next in HIS flow: get a token
    from the bot and `cello register Ms_Chelly <token>`.

## Open items (besides implementing #1–#4)

- **Ops-agent (staging bot) state may be stale vs the wiped directory.** The directory `user_accounts`
  is 0, but the bot (CELLO Operations Agent on ECS) may keep its own record of Andre's Telegram user.
  Verify a fresh token request treats him as NEW before the next end-to-end register test. (Not yet
  checked — Andre's call whether to check the ops-agent's store first.)
- **`cello help` system** — Andre wasn't sure how help works; confirm `cello help <cmd>` / `--explain`
  exists or add it (needed for #2's "pointer to explanation").
- The four DOD-STORE-1 🟡 sub-claims could be lifted to ✅ with a follow-on live journey (seed a
  pre-story layout → migrate → seal a fresh post-restart session). Not started; documented in the DoD.

## Key facts / how-to (so I don't re-derive)

- **Query the directory DB** (the `cello-db-query` skill): creds from
  `aws secretsmanager get-secret-value --secret-id cello/dev/directory/rds-credentials --region <r>`;
  task from `aws ecs list-tasks --cluster cello-dev --service-name cello-directory-dev`; run via
  `aws ecs execute-command ... --container directory --command "node -e \"...require('/app/node_modules/.pnpm/pg@8.18.0/node_modules/pg')...\""`.
  No shell pipes/redirects in `--command`; single-quote JS strings, avoid `$` (bash expands it).
- **Publish** (`/cello-publish` skill): daemon change → bump daemon + cli only (connect has NO daemon
  dep); `workspace:*` needs no edit; version-bump is the LAST commit; `git tag v<next-counter>` +
  push → CI publishes beta + `smoke-tag` (the real signal); verify the BINARY (`npm pack` + grep
  dist), never the version number; `npm view` has read-after-write LAG → use `npm dist-tag ls`;
  `latest` promotion is Andre-run.
- **Andre pushes both repos; do not push trustless-cello for INFRA paths** (docs + e2e-tests are
  safe — no deploy trigger). cello-client `main` + tags ARE pushed for publishing (Andre authorized
  via /cello-publish; he runs the latest-promotion).
- **Communication:** plain, direct, no literary prose; Andre is a 20-yr senior engineer who built
  this system. Verify before alarming; never narrate a hypothesis as fact.
- **Build/test:** vitest ONE worker foreground with timeout (`--pool-options.threads.maxThreads=1`),
  never background it. Spine live tests: `npx vitest run --config vitest.spine.config.ts <file>` from
  `trustless-cello/packages/e2e-tests`; they spawn the LOCAL cello-client build
  (`CELLO_CLIENT_ROOT/core/*/dist`), so rebuild cello-client (`npx tsc --build`) before running.
</content>
