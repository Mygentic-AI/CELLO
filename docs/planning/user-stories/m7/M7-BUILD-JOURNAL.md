---
name: M7 Build Journal
type: journal
date: 2026-06-18
milestone: M7
status: open
description: >
  Append-only build journal for the M7 rebuild/repair phase (post-collapse). One
  entry per unit of work. NEVER edit a prior entry. This is the live-state +
  audit-trail follow-through doc: a fresh context reads the last few entries to
  resume. Pairs with M7-DEFINITION-OF-DONE.md (the target) and M7-PROCEDURE.md
  (the runbook). See M7-PROCEDURE.md §0 for read order and §1 for what each entry
  must contain.
---

# M7 Build Journal (append-only)

> Newest entries at the BOTTOM. Never edit or delete a prior entry. Each entry:
> DoD-ID, what was red, what was found, commit hashes, reviewer outcome, blockers,
> decisions. (M7-PROCEDURE.md §1, §8.)

---

## 2026-06-18 — Rebuild-phase kickoff (planning complete; no code yet)

**State.** M7 collapsed to one ground truth in `main` (both repos) earlier today
(see PRUNE-LEDGER.md, M7-STATE-OF-THE-UNION.md). The formal per-story process had
been abandoned during the collapse. This phase restarts disciplined work against a
consolidated target.

**Decision (Andre, 2026-06-18): NOT a from-scratch rewrite of the daemon client.**
Keep the daemon/client code that exists — it's the right architecture and most is
once-reviewed (DAEMON-001/002/003/004, Keystone, Registration; daemon 342 tests;
seams 1a–4 proven in-process). DELETE the dead `core/client` in-process stack.
Repair and VERIFY the existing daemon under a live binary test, vanilla-spine-first,
salvaging hard and reimplementing only what's genuinely broken / unverified /
dead-stack-homed (MSG-001-3b, SESSION-002, SESSION-004 client, SESSION-003 ABSENT
gate). Method differs from from-scratch; the target (the DoD) is the same either way.

**Produced this session (committed, docs-only):**
- `M7-DEFINITION-OF-DONE.md` — the consolidated target. Every M7 requirement pulled
  from all five sources (outline + E2E-001, the four postmortem stories, POSTMORTEM
  Parts 3–4, the April-8/May-14 logs, the security audit), ordered, status-tagged,
  mapped to 8 test journeys (J-SPINE → J-UPGRADE).
- `M7-PROCEDURE.md` — the runbook (three artifacts, the red-driven per-unit loop,
  commit/review/test/checkpoint cadence, hard rules, greenfield handling).
- `M7-BUILD-JOURNAL.md` — this file.

**Next red (the first unit of actual work).** Write **J-SPINE** as a live binary
test (M7-PROCEDURE.md §4): spawn the real directory + relay + daemon(s) on
localhost (NO AWS/deploy), drive `cello register` → `cello_initiate_session` →
`cello_await_session` → `cello_send` → `cello_receive` → `cello_close_session`,
assert DOD-SPINE-1..7. It will be almost entirely red — that's the map. Anchor to
the BINARY, not the library (never import `createClient`).

**Open decisions blocking nothing yet but needed soon (flagged in the DoD):**
1. **DOD-INV-4** — verify whether the sender = counterparty check is actually fixed
   in the daemon receive path or still broken as the 2026-06-11 audit found.
2. **Tier 5** — keep or retire the signed relay ACK (DOD-REC-1) and pre-seal
   reconciliation (DOD-REC-2); they may be superseded by MSG-001's ACK model.
3. **Tier 4** — write `DOD-UP-1/2` (bilateral upgrade, auto-ack) as real stories now,
   or explicitly park to a named future milestone (don't silently defer — RC-1).

**Branch / where work happens.** Code work goes on the assembly branch
(`CELLO-M7-MSG-001-REHOME` in cello-client, per M7-INTEGRATION-HANDOFF.md §1) or
`main` once Andre merges it. These planning docs are committed to `main`
(trustless-cello). NOTHING merged to main-code / NOTHING pushed without Andre.

**Reviewer outcome / blockers.** N/A (docs only this entry). No code, no tests run.

---

## 2026-06-18 — J-SPINE design note (first code unit; harness not yet written)

**DoD-ID / unit.** J-SPINE → DOD-SPINE-1..7 (+ woven invariants INV-3/5/8/9). This
is the §4 "build the live test itself" unit. It is the lowest non-green line: no
live binary test exists, so every DoD line is unproven against the gate it requires.

**What is red.** Everything. There is no process-spawning E2E harness in
`packages/e2e-tests/src` (confirmed: grep for `spawn`/`execa`/`child_process`
returned nothing). The existing `transport-path.test.ts` and the `__tests__/`
suite are in-process library tests; `session-fixture.ts` is the dead-stack anchor
(it wires `createClient` / `createMcpSessionServer` / in-process
`createDirectoryNode`/`createRelayNode` — lines 43, 269, 348, 206, 232). J-SPINE
does NOT extend, copy, or import it. Anchor to the binary, never the library.

**The five real binaries (verified by reading each bin entrypoint):**
- `cello-directory` — `packages/directory/src/bin/directory.ts` (this repo).
  `CELLO_ENV=local` needs: `DATABASE_URL` (Docker Postgres), `DEV_ENVELOPE_KEY`,
  `AUDIT_LOG_PATH`, `CELLO_RELAY_MULTIADDR` (must include `/p2p/<relay-peer-id>`),
  key files. Exits 1 on `migration.out.of.date` → Postgres must have Flyway
  migrations applied first. Serves a `/bootstrap` endpoint (health server) that the
  daemon uses to discover the directory multiaddr.
- `cello-relay` — `packages/relay/src/bin/relay.ts` (this repo). Defaults
  `celloEnv=local`. Needs `CELLO_DIRECTORY_PUBKEY` (64-hex); optional
  `CELLO_DIRECTORY_MULTIADDR` (with `/p2p/`) to register + send seal callbacks.
  InMemory WAL + content store in local. No DB.
- `cello-daemon` — `core/daemon/src/bin/cello-daemon.ts` (cello-client). `CELLO_DIR`
  overrides `~/.cello`; opens `daemon.sock` + `daemon.lock` there. Discovers the
  directory via `createDirectoryEndpointResolver` → `GET ${CELLO_DIRECTORY_URL}/bootstrap`.
  Step-6 directory verify is intentionally OFF here (M6 compat) — that's DOD-AUTH-1,
  a later journey, not J-SPINE.
- `cello-mcp` — `core/adapter-claude-code/src/bin/cello-mcp.ts` (cello-client). Thin
  stdio→IPC proxy; holds no keys, opens no DB, connects to `${CELLO_DIR}/daemon.sock`.
- `cello` — `core/cli/src/bin/cello.ts` (cello-client). `cello login` starts/connects
  the daemon; `cello register`, `cello status`, etc.

**Infra recipe reused (infra half ONLY) from `/cello-chat` node-operator path:**
Postgres via `docker-compose.yml` (`postgres:5433` + `flyway migrate`), start order
relay→directory, the `CELLO_ENV=local` env set above. The `/cello-chat` skill is
M4-era and points `cello-mcp` at the STALE `packages/adapter-claude-code` copy in
this repo and the pre-daemon MCP-direct flow — J-SPINE does NOT use that. The
daemon/mcp/cli come from cello-client `core/*` and the `cello login`→daemon→`cello-mcp`
IPC flow.

**Harness shape (black-box, no library imports):** spawn each binary as a child
process; learn its libp2p multiaddr by parsing its stdout JSON log line
(`adapter.initialised adapterName: ListenAddr implementation: <addr>`) rather than
deriving peer IDs in-process. Use a temp `CELLO_DIR` per agent so daemons don't
share a socket/DB. Drive the agent surface only (`cello register` →
`cello_initiate_session` → `cello_await_session` → `cello_send` → `cello_receive` →
`cello_close_session`). Assert DOD-SPINE-1..7 from observable outputs + relay/directory
stdout (e.g. SPINE-6: relay log shows `hash_submit` from A's *session* Peer ID,
content never in relay logs → INV-3).

**Open implementation questions to resolve EMPIRICALLY against the running binaries
(not pre-decided from memory):**
1. Peer-ID ordering for the relay→directory seal callback (SPINE-7): directory needs
   the relay's `/p2p/` id at start, and the relay needs the directory's id to send
   seal callbacks. Resolve by either (a) start relay on `tcp/0`, parse its id, start
   directory pointed at it, then confirm whether the bilateral seal callback rides
   the directory→relay connection or needs `CELLO_DIRECTORY_MULTIADDR` set at relay
   start; or (b) pre-provision deterministic transport keys. Decide when SPINE-7's
   assertion actually runs — red will show which path the binaries require.
2. How the test invokes the MCP tool surface against a spawned daemon — via
   `cello-mcp` stdio (an MCP client over the proxy) vs the `cello` CLI subcommands.
   Resolve when SPINE-1 (daemon up) goes from red to green.

**Build order.** Grow ONE journey (J-SPINE) only; add assertions as each SPINE line
is driven. Start with SPINE-1 (daemon up: `cello login` within 5s, `cello status`
shows `directory_signaling: connected`).

**Branch / state.** `m7-rehome` (this repo). Nothing pushed, nothing merged. A
self-audit drift-check cron (`*/30`) is running this session to catch any slide back
toward the dead stack.

**Reviewer outcome / blockers.** N/A (design note only). No harness code yet; next
commit starts the spawn primitive + Postgres bring-up.

---

## 2026-06-18 — DOD-SPINE-1 GREEN against the real binaries (first live daemon-era run)

**DoD-ID / unit.** DOD-SPINE-1 (daemon up). First time any spine line has been proven
against the real `cello-relay` + `cello-directory` + `cello-daemon` + `cello` CLI in
the daemon era. The DoD said this "has NEVER happened" — it has now.

**What was red → green.** `pnpm --filter @cello-protocol/e2e-tests test:spine`:
fresh isolated Postgres (`cello_spine`, clean V1→V30), real relay + directory spawned,
agent identity provisioned, daemon started, `cello login` connects, `cello register
agentA` runs **real FROST DKG**, `cello status` → `directory_signaling: "connected"`,
`agents.length >= 1`. Test green in ~24s wall (assertion loop 1.2s).

**The chain of real findings (each a producer/consumer fact only a binary test
surfaces — session-fixture never spawns these programs):**
1. **`cello login` could not start the daemon at all** — the cli does
   `require.resolve("@cello-protocol/daemon/package.json")`, but the daemon's
   `exports` map only exposed `"."`, so Node's exports encapsulation refused the
   subpath → `ERR_PACKAGE_PATH_NOT_EXPORTED`. Producer: `core/daemon/package.json`.
   Fix: add `"./package.json": "./package.json"` (cello-client `m7-rehome`, commit
   `19ba736`). Likely affects real published usage too.
2. **Key provisioning format.** `FileKeyProvider.load` generate-on-ENOENT writes a
   custom MAGIC+version+seed file; the directory/relay bins self-generate their
   signing keys this way. `loadOrGenerateRelayKey` writes libp2p protobuf —
   INCOMPATIBLE (`key_file_corrupt: invalid magic bytes`). Harness provisions the
   directory key via `FileKeyProvider.load` to read its pubkey before the relay
   (relay needs `CELLO_DIRECTORY_PUBKEY`; relay starts first).
3. **Local dev DB drift.** `cello_dev` was half-migrated (registrations.email_stub_hash
   present, V30 unrecorded) after the collapse renumbered migrations. V22 adds the
   column to `user_accounts`, V30 to `registrations` (different tables) — so the
   migration files are CORRECT; the DB had drifted. Resolved by giving J-SPINE its
   own `cello_spine` DB dropped+recreated each run (hermetic; never touches
   `cello_dev`; proves migrations sound on a clean DB — matches CI / a new region).
4. **`directory_signaling: connected` is GATED on a registered agent identity**
   (`daemon.ts:411-412`: "stays reconnecting until one exists"). This is BY DESIGN,
   not a bug — and is exactly why SPINE-1's DoD couples "connected" with ">=1 agent."
   Zero-agent daemon stays `reconnecting` correctly.
5. **Agent K_local key must pre-exist** at `${CELLO_DIR}/agents/<name>/key` before
   `cello register` (`agent_not_found` otherwise). The daemon loads agents at boot;
   nothing in cli/MCP creates the key (onboarding / the Telegram Operations Agent
   provisions it on a real machine). Harness provisions it via `FileKeyProvider.load`,
   then the **real DKG** runs via `cello register`.
6. **Harness owns the daemon.** `cello login` spawns the daemon detached + unref'd
   with stdout piped to the short-lived login process — orphaning it from the test
   (no log capture, nondeterministic teardown). The DoD allows "starts OR connects
   to," so the harness spawns the `cello-daemon` binary directly (logs captured,
   clean SIGTERM/SIGKILL teardown) and the CLI connects to it.
   **FLAG (verify later):** does standalone `cello login` leave a *surviving* daemon,
   or does the stdout-pipe close on login-exit kill it? Not on SPINE-1's path; check
   when a SPINE assertion needs the `cello login` spawn branch.

**Anchoring proof.** `grep -E '^import .*(createClient|createMcpSessionServer|
createDirectoryNode|createRelayNode|session-fixture)' spine/*.ts` → zero. Only
non-builtin imports: vitest, the harness's own module, and `FileKeyProvider`
(documented credential provisioning — generates on-disk key files the binaries read;
not node construction).

**Commits.** trustless-cello `m7-rehome`: `76e2cf5` (design note), `52edc0d`
(harness + SPINE-1 scaffold), `92f82e3` (SPINE-1 green). cello-client `m7-rehome`:
`19ba736` (daemon export fix). Floor: e2e-tests typecheck 0, lint 0.

**Status — SPINE-1 is PARTIAL-green, not fully ✅ (honest).** Asserted live: daemon
running, `directory_signaling: connected`, `>=1 agent`. NOT yet asserted: the 5s
login budget, the `connections` list, and the `daemon.ipc.connected (clientType: cli)`
log event. These remaining sub-clauses are the finish of this unit (after review).

**Reviewer.** `feature-dev:code-reviewer` (model opus) dispatched on the unit diff
(both repos). Outcome pending — findings to be fixed at every severity before moving on.

**Next red.** Finish SPINE-1's remaining sub-clauses (5s budget, connections list,
`daemon.ipc.connected` event), then DOD-SPINE-2/3 (two IPC sessions, three-state
model) → SPINE-4 (register two agents — registration is already partially exercised).

**Cron.** `*/30` self-audit drift-check running this session (job `babafea8`).

---

## 2026-06-18 — SPINE-1 review: BLOCKED → fixed, now directory-corroborated (commit `034e487`)

**DoD-ID / unit.** DOD-SPINE-1 (continued). Reviewer outcome + fixes.

**Reviewer outcome: BLOCKED.** `feature-dev:code-reviewer` (opus) cross-checked the
test's assumptions against the real daemon/directory code and caught a HIGH finding
(H1) plus M2-M4 + L5-L7. H1 was correct and important:

**H1 — my SPINE-1 assertions were tautological (the exact false-confidence J-SPINE
exists to prevent).** I had misread `daemon.ts:411`: signaling is gated on a *loaded*
agent, not a *registered* one. `provisionAgent` writes the K_local key BEFORE the
daemon boots, so the agent is loaded at boot; the directory accepts the signaling
stream on Ed25519 proof-of-possession alone (no DB-registration check,
`directory-node.ts:1177-1188`); and `cello status` reports loaded agents as
`state:"registered"` regardless. So `directory_signaling=connected` + `agentCount>=1`
were both true at boot, and the `cello register` DKG I added had ZERO effect on what
the test asserted. I had relocated the false confidence from a dead library symbol to
daemon-side loaded-agent state.

**Fix (and the diagnostic journey behind it — producer/consumer, not guessing):**
- Removed registration from SPINE-1 (real DKG verification → SPINE-4, with
  directory-side state). Added DIRECTORY-SIDE corroboration: the test waits for the
  directory's OWN log to show it authenticated this agent's signaling stream
  (`authedShort` = agent pubkey). The green condition now depends on directory state
  the daemon cannot fake.
- Chasing why corroboration first FAILED revealed a real diagnostic lesson: the
  daemon's status said `connected` but neither side's captured log showed the auth.
  Hypothesis-as-fact was tempting ("daemon reports connected without connecting"). The
  evidence (raw-stdout tee, independent of line buffering) proved the opposite: the
  daemon DID connect (`directory.bootstrap.resolved` → `directory.signaling.connected
  {agentPubkey}`), the directory DID authenticate (`[AUTH] authedShort{same pubkey}`),
  and the failure was a **race** — the directory's auth log flushes a few ms AFTER the
  daemon flips its status. The `reader.error/signaling_closed` lines were just teardown
  SIGTERM, not a break. Fix: fold corroboration into the poll loop (race-free; stable
  across repeated runs).
- M2 (Proc partial-line carry buffer), M3 (reject waiters on child exit — no
  crash-as-timeout), M4 (late health-port alloc), L5 (agent-dir cleanup), L6 (poll
  delay), L7 (stop spawned children on partial cluster bring-up). All applied.

**DoD correction (PROCEDURE §8).** `daemon.ipc.connected` fires ONLY on an
`ipc.connect` frame, which only `cello-mcp` sends (`clientType: "mcp"`); the bare CLI
never sends it. The DoD's "daemon.ipc.connected (clientType: cli)" is inaccurate — that
event moves to DOD-SPINE-2 (the IPC/MCP connection surface). Reflected in the DoD.

**SPINE-1 status: now fully green for daemon-up** — daemon running, `cello login`
connects <5s, `directory_signaling: connected` (directory-corroborated, two-sided),
`>=1 agent`, `connections` list, `daemon.started` + `daemon.login.validation.complete`.
The only deferred sub-clause is `daemon.ipc.connected`, correctly re-homed to SPINE-2.

**Commits.** `034e487` (review fixes). Floor: typecheck 0, lint 0, two consecutive
green runs.

**Next red.** A focused re-review of the H1 fix (confirm the corroboration is itself
sound, not a new tautology), then DOD-SPINE-2 (two IPC sessions, independent
current-agent) — which is where the MCP/IPC client connection gets built and
`daemon.ipc.connected` is asserted.

---

## 2026-06-18 — CHECKPOINT: DOD-SPINE-1 CLOSED (re-review APPROVED). Handoff to SPINE-2.

**Green + reviewed.** DOD-SPINE-1 is proven live against the real binaries and
APPROVED by an adversarial re-review (commit `d8d9da4`). The re-review traced the
corroboration end-to-end through the directory's signaling-auth handler and confirmed
it is genuinely non-tautological: the directory emits the agent pubkey to stdout ONLY
after `verify(pubkey, SHA-256("CELLO-DIR-AUTH-v1"‖nonce‖pubkey), sig)` succeeds — a
daemon without the matching private key cannot make the directory log it. Two LOW
findings fixed: the corroboration comment now names the durable
`directory.auth.challenge.signed` (MANIFEST-002) event as the load-bearing anchor (the
`[AUTH]` line is only 8 hex; `frost.debug.*` is removable diagnostics); `Proc` now uses
a `StringDecoder`. Both reviews have run on everything up to HEAD.

**Branch / HEAD.** trustless-cello `m7-rehome` @ `d8d9da4`; cello-client `m7-rehome` @
`19ba736` (daemon `./package.json` export fix). NOTHING pushed, NOTHING merged.

**For Andre (merge is your call).** The cello-client fix (`19ba736`) is a real bug that
likely affects PUBLISHED usage: `cello login` couldn't start the daemon at all
(`ERR_PACKAGE_PATH_NOT_EXPORTED`) because the daemon package didn't export
`./package.json`. Worth merging/publishing independent of the rest of M7.

**Next red — DOD-SPINE-2** (two IPC sessions, independent current-agent;
`agent.current.switched` fires only for the switching connection). One-sentence target:
two distinct MCP/IPC connections to ONE daemon have independent "current agent", and a
switch on one does not change the other. Plan:
- Build the MCP-client-over-stdio harness piece: spawn `cello-mcp` (the real binary) per
  connection via the MCP SDK `StdioClientTransport` (e2e-tests already depends on
  `@modelcontextprotocol/sdk`), `CELLO_DIR` = the agent's home, so it connects to the
  running harness-owned daemon and sends `ipc.connect {clientType:"mcp"}`.
- This is also where the re-homed `daemon.ipc.connected (clientType "mcp")` assertion
  lands (SPINE-1 correction).
- Likely needs ≥1 agent (have agentA); a second agent for a meaningful current-switch is
  SPINE-4 territory — let the red run show what SPINE-2 minimally needs.

**Cron.** `*/30` self-audit drift-check still running (job `babafea8`).

---

## 2026-06-18 — DOD-SPINE-2/3 GREEN; another real cello-client bug caught

**DoD-ID / unit.** DOD-SPINE-2 + DOD-SPINE-3 (a tight cluster — same MCP/IPC surface).
Green + stable across 3 consecutive runs. Reviewer dispatched (outcome pending).

**What was red → green.** Built the MCP-client harness piece `connectMcp` (spawns the
real `cello-mcp` via the MCP SDK `StdioClientTransport`; each connection = one daemon
IPC connection — anchored to the binary, no in-process MCP server). Asserted against two
live MCP connections to ONE daemon:
- `daemon.ipc.connected{clientType:"mcp"}` logged (the sub-clause re-homed from SPINE-1).
- SPINE-3 three-state, observed in sequence: `registered` (loaded) → `online`
  (`cello_start_agent`) → `current` (`cello_use_agent`); login does not auto-start.
- SPINE-2 independence: conn1's `cello_use_agent` makes agentA `current` on conn1 ONLY;
  conn2 (same daemon, same agent) still reports `online`. Per-connection state confirmed
  against `perConnectionState` / `getAgentsForConnection` (daemon.ts).
- `agent.current.switched{toAgent:"agentA"}` logged for the switching connection.

**Real bug caught (J-SPINE's purpose).** `cello-mcp` hardcoded the daemon socket at
`~/.cello/daemon.sock`, IGNORING `CELLO_DIR` — while `cello-daemon` and the `cello` CLI
both honor `process.env.CELLO_DIR || ~/.cello`. So cello-mcp could not find a daemon
running under a non-default home → `MCP error -32000: Connection closed`. This would also
break any operator who sets `CELLO_DIR` in production. Fix: cello-mcp resolves CELLO_DIR
identically (cello-client `m7-rehome` commit `e31b646`). Producer/consumer: daemon
PRODUCES the socket at `CELLO_DIR/daemon.sock`; cello-mcp (CONSUMER) was looking elsewhere.

**Useful finding (no bug).** `cello_start_agent` only needs the agent LOADED, not real
DKG — so SPINE-2/3 run on a provisioned agent, before SPINE-4.

**Useful finding (no bug).** `cello_start_agent` only needs the agent LOADED, not real
DKG — so SPINE-2/3 run on a provisioned agent, before SPINE-4.

**Reviewer outcome: APPROVED.** The re-review confirmed the independence/three-state
assertions are adversarially sound (genuine per-connection state, traced through
`perConnectionState`/`getAgentsForConnection`). Two MEDIUM + one LOW fixed:
- M1: the two log-grep assertions now use `daemon.waitForLine` (polling) instead of a
  one-shot `daemon.output.toMatch` — the daemon stdout pipe and the IPC socket are
  independent fds with no happens-before, so the one-shot read raced the flush (same race
  SPINE-1 fixed). Restores the polling discipline.
- M2: `connectMcp` closes the transport if `client.connect()` rejects (no orphan cello-mcp).
- L1: `cello-mcp` stderr diagnostics log relocated from the global `/tmp/cello-mcp-stderr.log`
  to `${CELLO_DIR}/cello-mcp-stderr.log` (completes per-home isolation; mkdir-guarded).

**Commits.** trustless-cello `e1592dc` (test), `82bd1da` (docs), `69ad28d` (M1/M2 fixes);
cello-client `e31b646` (socket CELLO_DIR), `2d46f49` (stderr-log CELLO_DIR). Floor:
typecheck 0, lint 0, 5/5 green runs across the unit.

**STATUS: DOD-SPINE-1/2/3 CLOSED + APPROVED. This is the planned COMPACTION boundary
(per Andre — protocol requires his assistance).**

**Next red — DOD-SPINE-4** (register two agents, real DKG against the directory). SPINE-1
already exercised one real `cello register`; SPINE-4 is the two-agent DKG + the per-agent
files under `${CELLO_DIR}/agents/<name>/` + the agent→user link, asserted against directory
state (two agent_profiles rows / `register_success`). The MCP harness (`connectMcp`) and the
CLI driver (`cello`) are both available to drive it.

**Cron.** `*/30` self-audit drift-check still running (job `babafea8`).

---

## 2026-06-18 — DOD-SPINE-4 design note (post-compaction; foundation read in full before any code)

**DoD-ID / unit.** DOD-SPINE-4 — register two agents via real FROST DKG against the
directory; assert directory-side DB state (two `agent_profiles` rows / one deduped
`user_accounts` row / shared `account_id`) + per-agent local files + agent→user link.
Status is 🟡 (built + 249 tests; live DKG never run in the daemon era). This is a
VERIFY-the-built-code unit, not greenfield — but it is design-significant enough to
warrant a note because the pre-auth/account model has a non-obvious live path.

**How I read it (per Andre, before writing code).** Read all three M7 docs end-to-end,
then traced the registration flow across BOTH repos against the actual source — no
delegation, no assumptions:
- `cello register <agent> <preAuthToken>` (cli/commands.ts:85) → daemon `cello_register`
  handler (daemon.ts:757) → `RegistrationManager.register()` (registration-manager.ts:98):
  ML-DSA keygen → `register_request` → `dkg_ready` → **real FROST DKG** (`runNetworkDkg`,
  carrying `preAuthToken` into DKG Round 1) → `dkg_complete` → `register_success`.
- Directory side (directory-node.ts:~1758–1951): DKG Round 1 validates+consumes the
  token, runs DKG, then Step 6 creates the `AgentProfile` (`#store.setProfile`), emits
  `register_success {agent_id, primary_pubkey}`, and fire-and-forget calls
  `linkAgentToAccount` (pre-auth-token-repository.ts:387).

**The pre-auth crux — solved without Telegram.** Production needs a token issued by the
Operations Agent. But the J-SPINE directory runs `CELLO_ENV=local`, which composes the
`DevTokenValidator` stub (interfaces/stubs): it accepts ANY `DEV-`-prefixed token and
returns a FIXED principal (`dev-phone-stub-hash-0000…`). No Telegram, no DB row, no Ops
Agent. So `cello register agentX DEV-<rand>` drives a real DKG locally.

**Two agents under ONE account — the live path (3 facts, each verified in code):**
1. `DevTokenValidator` returns a FIXED `phone_stub_hash` for both agents → both dedup to
   the SAME `user_accounts` row (UNIQUE phone_stub_hash) via `linkAgentToAccount`.
2. The directory's `phone_already_claimed` gate (directory-node.ts:1899) would normally
   reject the 2nd same-phone agent — BUT under the PG store it never fires:
   `PgDirectoryStore.hasPhoneStubHash()` is a hardcoded `return false` (pg-directory-store
   .ts:763, "backing store read in PERSIST-003+", never implemented). Phone-uniqueness/
   dedup is delegated entirely to the `user_accounts` table. (The in-memory store's real
   gate is a UNIT-TEST-only artifact; the live binary uses PG.) NOTE/FLAG: this is a
   latent inconsistency — a dead gate — but it is NOT a SPINE-4 blocker and I am NOT
   changing directory registration semantics here.
3. Lynchpin: `CELLO_ENV=local` + `DATABASE_URL` wires BOTH `pgPool = new pg.Pool(...)`
   AND `store = new PgDirectoryStore(pgPool,…)` (directory.ts:152–155). So `pgPool` is
   present (→ `linkAgentToAccount` runs, writes `user_accounts`) AND the phone gate is the
   no-op. Both conditions hold at once. Confirmed by reading the composition root.

**Model chosen: ONE home, ONE daemon, TWO agents.** `loadAgents` enumerates every
`${CELLO_DIR}/agents/*/` subdir at boot (agent-loader.ts:70–81), so provisioning
`agents/agentA/key` + `agents/agentB/key` before daemon start loads both. Registration is
single-flight per daemon (`registrationInProgress`, daemon.ts:776) and `cello` is a
synchronous CLI — so two `cello register` calls serialize naturally. This models "two
agents under one operator/account on one machine" (CONTEXT.md also allows different
machines; one-home is the simpler faithful case and exercises multi-agent load + the
single-flight serializer). Each `cello_register` builds a fresh `RegistrationManager` +
per-agent `FileRegistrationPersistence(agentDir=agents/<name>)` — no shared registration
state across agents.

**Producer/consumer for the assertions (directory-side = non-tautological, per H1):**
- PRODUCER (directory, PG): `agent_profiles` row per agent (k_local_pubkey, primary_pubkey
  from DKG, phone_stub_hash=dev fixed); `user_accounts` row (one, deduped); `account_id`
  written onto both agent_profiles by `linkAgentToAccount`. The daemon CANNOT fabricate
  these — they are the directory's own DB writes after a real DKG it co-ran.
- PRODUCER (daemon, local files): `agents/<name>/{registration-state,ml-dsa-keypair,
  frost-share,agent-user-link}.json` (registration-persistence.ts; agent-user-link written
  by the handler at daemon.ts:815).
- CONSUMER (test): query `cello_spine` via `docker compose exec -T postgres psql` (the
  harness already owns this DB) + stat the per-agent files.
- RACE: `linkAgentToAccount` is fire-and-forget (`void …catch`), so `register_success`
  precedes the `user_accounts`/`account_id` write. The test POLLS the DB for the link
  (same flush-race discipline SPINE-1's corroboration used), not a one-shot read.

**Woven invariant — DOD-INV-2 (no single party forges).** Each agent's `primary_pubkey`
is a real DKG product (distinct per agent); the client holds its FROST signing share
(`frost-share.json`) while the directory holds its K_server_X share — neither alone can
sign. SPINE-4 asserts: two DISTINCT primary_pubkeys + a persisted client-side frost-share,
evidencing the split-key outcome of a genuine ceremony (not a stub returning a fixed key).

**Harness additions planned (live-harness.ts):** `psqlSpine(sql)` (query the spine DB);
a two-agent provisioning helper (provision N keys in one home, start one daemon). Reuse
`cello()` for `register`. No forbidden imports; anchored to the binary.

**Next step.** Red-first: add the DOD-SPINE-4 it-block + helpers; confirm red for the
right reason (e.g. zero agent_profiles before registration, or link absent), then drive
green. Branch `m7-rehome`, nothing pushed/merged.

---

## 2026-06-18 — DOD-SPINE-4 GREEN (two agents, real DKG) — built multi-agent single-daemon registration + fixed an account-link race

**DoD-ID / unit.** DOD-SPINE-4. Green + stable across 3 consecutive live runs (9/9
tests) against the real binaries. Review re-dispatched (first reviewer stalled on an
infra watchdog, no verdict); DoD flip + final verdict appended below once it returns.

**What was red.** Two agents registering on ONE daemon: the FIRST agent registered
fully (real DKG → agent_profile → account link), the SECOND timed out — its DKG
completed (FROST Round 1+3, share persisted both sides) but the directory never sent
`register_success`.

**Root cause (producer/consumer, from the live logs + DB, not a guess).** The directory
routes every signaling frame by the pubkey that AUTHENTICATED the stream it arrived on
(`#handleSignalingStream`: `dkg_complete` → `#pendingDkgComplete.get(authedPubkeyHex)`,
directory-node.ts:1441). But the daemon opened ONE signaling stream, authed as the
PRIMARY agent (keystone, daemon.ts:410 — explicitly noted "per-agent directory
operations under distinct identities are out of keystone scope"). So agentB's
`register_request` set `#pendingDkgComplete[agentB-k_local]` (keyed by frame), but
agentB's `dkg_complete` rode the PRIMARY's stream → looked up `[primary-pubkey]` →
no match → resolver never fired → directory's `#processRegisterRequest` awaited
`dkg_complete` forever → daemon timed out. CONFIRMED: the directory's live signaling
streams were agentA + two unrelated identities; agentB's registration pubkey was NOT
among them (it had no signaling stream of its own).

**Andre's intent (confirmed in-session).** One user runs 2+ agents on ONE daemon, each
with its OWN one-time key (M6 pre-auth) and its OWN DKG; clean separation. "Registration
of 2+ agents via Telegram already works" — but the per-agent *signaling* it relies on
was NOT built in the daemon (empty grep; `cello_start_agent` only flips an in-memory
set; git shows registration was ported onto the single keystone seam). Architecture
decision (confirmed): **per-agent directory signaling streams** — each agent opens its
own stream authed as itself; the directory routes by authed pubkey as it already does
(NO directory change).

**The build (cello-client `4195a3a`, core/daemon/src/daemon.ts).** Added a
`perAgentSignaling` registry + `getAgentSignaling(name, kp, pubkeyHex)`: the primary
reuses the keystone manager + its node; every other agent gets a dedicated
`SignalingManager` via `createSignalingConnect({ getAuthIdentity: () => that agent })`,
created lazily, kept connected for directory presence, stopped on shutdown.
`cello_register` now resolves the agent's OWN signaling stream (and waits for it to
connect, `waitForSignalingConnected`, 10s) before the DKG. Falls back to the keystone
manager when no production bootstrap resolver is configured (in-process tests). 342
daemon unit tests still green; no regression.

**Second bug, surfaced by two-agent registration (directory account-link race; fixed
in trustless-cello `fc48e04`).** Registration INSERTed the `agent_profiles` row WITHOUT
account_id (`setProfile` → fire-and-forget `void pool.query`) then UPDATEd it via a
separate fire-and-forget `linkAgentToAccount`. The UPDATE could run on a different pool
connection before the INSERT committed → match 0 rows → `account_id` permanently NULL
(the flake: one agent linked, the other NULL after a 10s poll). Fix: extracted
`resolveAccountId()` (lookup-or-create the account FIRST) and the registration path now
INSERTs the profile WITH account_id atomically (`setProfile`'s existing account_id
branch). `linkAgentToAccount` refactored to reuse `resolveAccountId` (kept for callers
linking an already-persisted profile). Account-resolution failure still never blocks
registration. Stable across 3 runs.

**FLAG (pre-existing, not introduced here; not a SPINE-4 blocker).** `user_accounts` is
a hash-chained table (hash-chain.ts:244) but the repository INSERT writes a NAIVE
`chain_hash = SHA-256(account_id‖phone_stub_hash)` that does NOT link the prior row's
chain (it bypasses `insertWithChain`). This is verbatim-inherited from the original
`linkAgentToAccount` and only fires in dev/local: in production the Operations Agent
creates the account first (proper path), so `resolveAccountId`'s SELECT finds it and
never INSERTs. Tamper-evidence of `user_accounts` rows created via the registration
dedup path is therefore unverifiable — worth a follow-on, tracked here so it doesn't
evaporate (postmortem RC-1 discipline).

**The assertions (non-tautological, reviewer H1 discipline).** `psqlSpine()` queries the
directory's OWN `cello_spine` DB — the daemon cannot fabricate it: 2 `agent_profiles`
rows carrying the DKG primary_pubkeys the CLI reported, 1 deduped `user_accounts` row,
both profiles sharing one non-null `account_id` (polled — the link is async). Per-agent
local files asserted under each `agents/<name>/`. INV-2 (no single party forges): two
DISTINCT primary_pubkeys from two separate real ceremonies + persisted client-side
frost-shares.

**Floor.** cello-client lint clean; daemon + directory typecheck clean; 342 daemon unit
tests + 29 directory account/registration/preauth unit tests green; spine 3/3 green.

**Commits.** cello-client `4195a3a` (per-agent signaling). trustless-cello `fc48e04`
(account-race fix + DOD-SPINE-4 test + `psqlSpine` harness) and `3101d36` (design note).
NOTHING pushed/merged.

**Scope finding for SPINE-5+.** Sessions (`cello_initiate_session`, `cello_await_session`,
inbound `session_assignment` handler, daemon.ts) all still use the PRIMARY
`signalingManager`. A non-primary agent's session_request/session_assignment will need
the same per-agent signaling treatment (directory routes inbound session_request by
authed pubkey too). The per-agent registry built here is the foundation; SPINE-5 extends
it to the session send + inbound-handler path.

**Next.** Incorporate the re-dispatched review (fix every finding), flip DOD-SPINE-4 to
✅ PROVEN LIVE, then SPINE-5.

---

## 2026-06-19 — DOD-SPINE-4 CLOSED: reviewer APPROVED + every finding fixed; DoD flipped ✅

**Reviewer outcome: APPROVED** (`feature-dev:code-reviewer`, opus). First dispatch stalled
on an infra watchdog (600s, no verdict); re-dispatched with a tighter scope → clean
verdict. It confirmed both pre-verified points (resolveAccountId is a verbatim extraction;
the non-chained `user_accounts` INSERT is pre-existing + dev-only → flag, not blocker) and
the core claims (per-agent auth has no cross-agent leakage; the account-race fix is truly
race-free — FK `agent_profiles.account_id → user_accounts` confirmed in V23, resolveAccountId
commits the account row before setProfile's atomic INSERT).

**Findings, all fixed (cello-client `17ea7b1`, trustless-cello `39a3619`):**
- MEDIUM (test flake): the `agent_profiles` 2-row + primary_pubkey corroboration was a
  one-shot read, but `setProfile`'s INSERT is fire-and-forget and `register_success` is sent
  before it commits → could intermittently fail. Folded the profile rows + DKG primary_pubkeys
  + shared account_id into ONE poll loop. Removed a verbatim-duplicated assertion block.
- LOW (orphan manager): a terminally-failed registration left the lazily-created per-agent
  SignalingManager reconnecting forever. New `dropAgentSignaling()` stops+removes it on both
  failure paths (signaling timeout, DKG error); re-created on retry; no-op for the keystone.
- LOW (error discipline): per-agent signaling-connect timeout now returns a distinct
  `directory_signaling_timeout` (was `directory_unreachable`).
- IMPORTANT (doc): explicit code comment that non-primary per-agent streams have no inbound
  SESSION handler yet — the SPINE-5 follow-on (not a regression: before this, a non-primary
  agent couldn't register at all).

**Stability.** 3 consecutive clean live runs post-fix (9/9). A 4th run failed ONLY in the
`beforeAll` Postgres/binary bring-up ("Hook timed out in 180000ms", 953s) under machine
load from back-to-back heavy live runs — infra, not logic; the 3 tests were skipped, not
failed. (Lesson: don't chain 4+ heavy live-binary suites back-to-back; the box saturates.)

**Floor.** cello-client lint clean; daemon + directory + e2e typecheck clean; 342 daemon
unit tests + 29 directory account/registration/preauth unit tests green.

**DoD.** DOD-SPINE-4 flipped 🟡 → ✅ PROVEN LIVE.

**Commits (all on `m7-rehome`, nothing pushed/merged):** cello-client `4195a3a` (per-agent
signaling) + `17ea7b1` (review fixes). trustless-cello `fc48e04` (account-race + test) +
`39a3619` (test review fix) + this doc.

**Next red — DOD-SPINE-5** (initiate session, ephemeral nodes). This is where the per-agent
signaling extends to the SESSION path: a non-primary agent's `session_request` /
`session_assignment` and the daemon's inbound session handlers must run on the agent's OWN
stream (the directory routes inbound session_request by authed pubkey, same as registration).

---

## 2026-06-19 — DOD-SPINE-5 design note (scoping: locate-and-adapt; build not yet started)

**DoD-ID / unit.** DOD-SPINE-5 — initiate session, ephemeral nodes. `cello_initiate_session`
creates an ephemeral session node (fresh key/Peer ID ≠ directory-facing), reports it to the
directory, receives a FROST-signed SessionAssignment (both session Peer IDs + multiaddrs);
standing receiver pre-exists. DoD status 🟡 (in-process seams 1a/1b/2 proven; never live).

**The live gap (read, not guessed).** The daemon binary (`core/daemon/src/bin/cello-daemon.ts`)
passes ONLY `directoryEndpointResolver` to `startDaemon` — NOT `sessionNegotiator`,
`transportDialer`, `sessionNodeFactory`, or `transportSelector`. So live
`cello_initiate_session` hits `if (!sessionNegotiator) return directory_signaling_not_configured`
(daemon.ts:1040) — the real session path is unwired in the binary. The seam tests proved the
LOGIC with a FAKE negotiator/dialer injected; the binary has neither.

**What EXISTS (locate-and-adapt, per "assume code exists"):**
- DIRECTORY brokering is LIVE: `#processSessionRequest` embeds a FROST-signed
  SessionAssignment with both session Peer IDs + multiaddrs + transport_mode
  (directory-node.ts:18, handler at :1452). NO directory build needed.
- CLIENT-side session-request/assignment logic exists in the DEAD `core/client` stack:
  `core/client/src/signaling-manager.ts` (sends `session_request`), `frame-dispatch.ts`
  (routes `session_assignment`), `session-assignment-parser.ts` (parses + verifies the
  FROST sig). This is the proven logic to ADAPT onto the daemon's per-agent signaling —
  NOT a from-scratch build. (Do NOT import core/client; port the logic, like
  RegistrationManager was ported.)
- Daemon already has: the inbound `session_assignment` handler (daemon.ts:1723, on the
  PRIMARY signalingManager), `transportSelector` (transport-selector.ts), session-node-manager
  (ephemeral nodes + standing receiver), and the `SessionNegotiator`/`TransportDialer`
  interfaces (transport-selector.ts:138/149).

**The build (gaps to close):**
1. A real `SessionNegotiator` (new daemon file): on `negotiate()`, send `session_request`
   over the CURRENT agent's signaling stream (per-agent — reuse the SPINE-4 `getAgentSignaling`
   registry, NOT just the keystone), await the FROST-signed `session_assignment`, parse +
   verify it (port session-assignment-parser logic), return it. This is the inbound mirror
   the registration context already models (pending-resolver on the per-agent stream).
2. Per-agent SESSION inbound handlers: the daemon's `session_assignment` inbound handler
   (daemon.ts:1723) is on the keystone manager only — a non-primary agent's assignment
   arrives on ITS stream. The negotiator's own per-agent inbound handler (like
   DaemonRegistrationContext) covers the initiator side; the await/receive side (SPINE-6)
   needs the inbound session_request handler per-agent too. (SPINE-4 close-note follow-on.)
3. A real `TransportDialer` + wire `transportSelector`/`sessionNodeFactory` into the binary
   composition root (cello-daemon.ts) for `CELLO_ENV=local`. For two same-daemon agents the
   direct localhost dial should succeed; relay fallback exists.
4. Decide SPINE-5 boundary vs SPINE-6: SPINE-5 = assignment received + ephemeral node
   distinct Peer ID. The handler couples negotiate→dial→createSessionNode, so the dial must
   at least not falsely fail; assert the FROST-signed assignment (directory-corroborated:
   the directory's signed-assignment log / the parsed signer) + session node Peer ID ≠
   directory-facing Peer ID + standing receiver pre-exists.

**Red (to confirm live first).** Two agents registered+online on one daemon (SPINE-4 setup),
agentA current on an MCP conn, `cello_initiate_session{counterparty_pubkey: agentB}` →
expect `directory_signaling_not_configured` (the wired-out red), then build to a FROST-signed
assignment.

**Status.** Design/scoping only — NO SPINE-5 code yet. SPINE-1..4 green+closed. This is a
large multi-component unit (port negotiator + transport dialer + binary wiring + per-agent
session signaling); building incrementally next, red-first. Branch `m7-rehome`, nothing
pushed/merged.

---

## 2026-06-19 — CHECKPOINT / overnight handoff (SPINE-1..4 green+closed; SPINE-5 scoped + red)

**Delivered this session.**
- **DOD-SPINE-1/2/3** — green + closed (earlier entries).
- **DOD-SPINE-4 — green + CLOSED + reviewer-APPROVED.** Built the missing capability the
  milestone needed: **per-agent directory signaling streams** (one user, multiple agents,
  each its own DKG, ONE daemon — Andre's confirmed intent). Each agent now authenticates
  its own signaling stream so the directory routes its frames to it (the keystone-only
  stream misrouted non-primary agents' dkg_complete). Also fixed a directory account-link
  race (insert profile WITH account_id atomically). Every review finding fixed. Stable
  across 3 consecutive live runs. Commits: cello-client `4195a3a`+`17ea7b1`; trustless-cello
  `fc48e04`+`39a3619`+`1f9de2c`.
- **DOD-SPINE-5 — scoped + RED boundary confirmed live.** `cello_initiate_session` returns
  `directory_signaling_not_configured` (daemon binary wires no negotiator). Design note +
  red test committed (`cfe792b`, `e9603ae`).

**Why I stopped at the SPINE-5 red (honest).** SPINE-5 is a large multi-component build
(port the real SessionNegotiator onto per-agent signaling + a real TransportDialer + wire
the transport into the daemon binary composition root + per-agent session inbound handlers).
Two factors made a clean handoff the right call over a rushed half-build: (1) it deserves
fresh context to do red→green→review at the SPINE-4 bar; (2) the machine became heavily
load/throttled overnight (live suites went from ~40s to 17+ min, with timeout-flakes) —
repeated heavy live iteration risks the documented battery/thermal problem. Nothing is
half-wired; the tree is clean and all committed.

**Exact next steps for SPINE-5 (locate-and-adapt — DO NOT rebuild from scratch):**
1. The DIRECTORY already brokers `session_request` → FROST-signed `SessionAssignment` LIVE
   (directory-node.ts:18, handler :1452). NO directory work.
2. Port the CLIENT logic from the dead `core/client` stack (`signaling-manager.ts` sends
   `session_request`; `frame-dispatch.ts` routes `session_assignment`; `session-assignment-
   parser.ts` parses + verifies the FROST sig) into a new daemon `SessionNegotiator` that
   sends over the CURRENT agent's per-agent signaling stream (reuse SPINE-4 `getAgentSignaling`)
   and awaits the signed assignment — mirroring how `DaemonRegistrationContext` bridges the
   registration reply frames (pending-resolver on the per-agent stream).
3. Build a real `TransportDialer` + wire `sessionNegotiator`/`transportSelector`/
   `sessionNodeFactory` into `core/daemon/src/bin/cello-daemon.ts` for `CELLO_ENV=local`
   (today it passes ONLY `directoryEndpointResolver`).
4. Attach the daemon's inbound session handlers (session_assignment/session_request,
   daemon.ts:1723 — currently keystone-only) to each per-agent manager (the SPINE-4
   close-note follow-on; needed for the await/receive side, SPINE-6).
5. BUG to fix on the green path: cello-mcp's `cello_initiate_session` passes `{ target_pubkey }`
   to the daemon, but the handler reads `params?.counterparty_pubkey` (daemon.ts:1086) →
   the counterparty is dropped. Reconcile the param name across cello-mcp ↔ daemon.
6. Then flip the SPINE-5 test (j-spine.spine.test.ts) to assert a FROST-signed SessionAssignment
   (directory-corroborated) + ephemeral session-node Peer ID ≠ directory-facing Peer ID +
   standing receiver pre-exists. Run red → green → floor → review → flip DoD.

**State.** Branch `m7-rehome` BOTH repos. NOTHING pushed, NOTHING merged (Andre's call).
Floor at handoff: lint clean, all typechecks clean, 342 daemon + 29 directory unit tests
green, J-SPINE 4/4 green (SPINE-5 asserts the documented gap). Drift-check cron `babafea8`
still running.

**Post-handoff kickoff (next context):** Read M7-PROCEDURE → M7-DEFINITION-OF-DONE → this
entry. Lowest non-green DoD line = DOD-SPINE-5. Start at step 2 above (port the negotiator).
`pnpm --filter @cello-protocol/e2e-tests test:spine` (or `-t "DOD-SPINE-5"`). Anchor to the
binary; one branch `m7-rehome` both repos; don't push/merge.

---

## 2026-06-19 — DOD-SPINE-5 increment 1 GREEN (negotiator wired); increment 2 bug surfaced (ceremony_timeout)

**Increment 1 — DONE + committed (cello-client `c0b806b`, trustless-cello `c5f9129`).**
Built a real internal `SessionNegotiator` in the daemon (ported `parseSessionAssignment` +
session_request error mapping from the dead `core/client` into a new daemon
`session-assignment-parser.ts` — NOT imported). It sends `session_request` over the CURRENT
agent's OWN per-agent signaling stream, advertising the standing receiver's session endpoint
(WIRE-001), awaits + parses the directory's `session_assignment`. `cello_initiate_session` no
longer returns `directory_signaling_not_configured`; proven live — it reaches the directory
(returns directory-sourced `target_offline` for an unregistered target). 342 daemon tests green.

**Increment 2 — bug surfaced by J-SPINE (test written + SKIPPED, trustless-cello `<this commit>`).**
With TWO agents registered on ONE daemon, the full green path gets far:
- agentA (initiator) + agentB (target) both registered → both per-agent signaling streams up.
- agentA online+current initiates to agentB: directory `[SESS] Session request: agentA → agentB`,
  `target_stream FOUND` (agentB online), `signer_lookup signerFound:true` (ClientDelegatedSigner,
  `delegatedSignerStreamsNull:"SET"`), `[FROST] Ceremony begin`.
- THEN: `[SESS] Request failed — reason: ceremony_timeout` after 30s.

**Root cause (precise, from the live logs).** The directory's session-signing FROST ceremony
(the `ClientDelegatedSigner` delegates signing of the SessionAssignment back to the initiator
agentA) sends participate-in-ceremony frames to agentA over signaling and awaits agentA's
responses — but agentA's daemon does not answer them on its per-agent signaling stream, so the
ceremony times out. This is the SAME per-agent-signaling routing gap SPINE-4 fixed for
registration (`dkg_complete` was misrouted), now for the SESSION ceremony: the daemon's
delegated-signing handler is not attached to per-agent streams (the daemon's inbound handlers
are keystone-only, daemon.ts:1446/1723/1843).

**Next build (increment 3 → SPINE-5 green).** Wire the daemon's session-signing ceremony
participation handler onto EACH per-agent signaling stream (mirror SPINE-4: the registration
reply frames were routed via the per-agent DaemonRegistrationContext handler; the session
ceremony frames need the same per-agent routing). Locate the client-side ceremony participation
logic in the dead `core/client` (the counterpart to `ClientDelegatedSigner.participateInCeremony`)
and port it onto per-agent signaling. Then un-skip the green test (`j-spine.spine.test.ts`
"FROST-signed SessionAssignment received between two registered agents") and drive red→green.
The dial (no transportDialer in the binary) remains SPINE-6.

**State.** Branch `m7-rehome` both repos, nothing pushed/merged. Floor: lint + typechecks
clean, 342 daemon tests green, J-SPINE suite green (SPINE-5 green test skipped with the finding).
Lowest non-green DoD line stays DOD-SPINE-5 (increment 3: the ceremony handler).

---

## 2026-06-19 — DOD-SPINE-5 increment 3 precise scoping (the ceremony participation handler)

Refined the `ceremony_timeout` root cause to an exact build. The session-signing FROST
ceremony is **directory-initiated, client-coordinated**:
1. The directory's `ClientDelegatedSigner.participateInCeremony` (directory-node.ts) sends a
   "participate" request to the INITIATOR (agentA) over agentA's signaling stream.
2. agentA's daemon must RECEIVE that request, then drive the ceremony as coordinator using its
   EXISTING `core/daemon/src/network-directory-node.ts` (the `frost_commit_request` /
   `frost_sign_request` path over `/cello/frost/1.0.0` — already proven for registration DKG),
   and return the session signature to the directory.
3. The directory assembles + returns the FROST-signed SessionAssignment.

**The gap:** step 2's inbound handler — the daemon does not answer the directory's participate
request on agentA's per-agent signaling stream (inbound handlers are keystone-only). The
client-side participation logic lives in the dead `core/client/src/{frame-dispatch,
network-directory-node,seal-manager}.ts`; port the participate-request handler onto each
per-agent signaling stream (mirror the SPINE-4 `DaemonRegistrationContext` per-agent inbound
bridge). The ceremony DRIVER (`network-directory-node.ts`) already exists in the daemon — this
is wiring the inbound trigger + the coordinator glue, then returning the result frame.

Increment 3 is the SPINE-5-green build; un-skip the green test when done. This is a substantial
unit (FROST session-ceremony coordination over per-agent signaling) — the clean next focus.

---

## 2026-06-19 — DOD-SPINE-5 increment 3 COMPLETE SPEC (exact ceremony protocol + handler + the key dependency)

Read the exact protocol end-to-end. This is everything increment 3 needs.

**The frame protocol (directory ↔ initiator over signaling):**
- Directory (`ClientDelegatedSigner.participateInCeremony`, directory-node.ts:3490) sends over
  the initiator's authenticated SIGNALING stream:
  `{ type: "ceremony_request", ceremony_id, tbs: Uint8Array, context }`
  then awaits, resolving on the client's `ceremony_result` via `resolveFromClient` (30s timeout
  → CEREMONY_TIMEOUT — exactly what we hit).
- Client must reply on the SAME stream:
  `{ type: "ceremony_result", ceremony_id, signature: Uint8Array | null }`.

**The client handler to port (core/client/src/seal-manager.ts:907 `handleCeremonyRequest`):**
1. Get the agent's FROST `thresholdSigner`; if null → reply `ceremony_result{ signature: null }`.
2. Extract ceremony_id, tbs, context.
3. `const result = await thresholdSigner.participateInCeremony(ceremonyId, tbs, context)`.
4. Reply `ceremony_result{ ceremony_id, signature: result.ok ? result.signature : null }`.
(frame-dispatch.ts:103 routes `ceremony_request` → this handler.)

**The KEY dependency (the real work of increment 3):** the daemon must have each registered
agent's FROST `thresholdSigner` available + a per-agent directory node to drive the ceremony's
`/cello/frost/1.0.0` round-trips. At registration the signer was `dkgResult.signer` on the
(disposed) RegistrationContext. So increment 3 must RECONSTRUCT the threshold signer from the
persisted `frost-share.json` (signingShare, identifier, commitmentsCbor, verifyingSharesCbor,
threshold, participants — see registration-persistence.ts `loadActiveFrostKeyShare`) into a FROST
signer whose `participateInCeremony` opens frost streams on THAT agent's per-agent directory node
(the daemon's `network-directory-node.ts` already implements the coordinator round-trips; it needs
the agent's directory-connected CelloNode = `getAgentSignaling(agent).getNode()`).

**Build steps (increment 3):**
1. FIRST verify whether the daemon already reconstructs threshold signers at boot/on-demand
   (grep loadActiveFrostKeyShare usage) — if a path exists, adapt it; else build the
   share→signer reconstruction (crypto has `storeDkgResult`/`bootstrapKeyShares`).
2. Add a per-agent signaling inbound handler for `ceremony_request` → run the agent's signer's
   participateInCeremony (driven over that agent's per-agent directory node) → send ceremony_result.
   Mirror the SPINE-4 DaemonRegistrationContext per-agent inbound bridge.
3. Un-skip the green test ("FROST-signed SessionAssignment received between two registered
   agents") → red→green. Floor + review. The dial (no transportDialer) stays SPINE-6.

**Checkpoint state.** SPINE-1..4 closed; SPINE-5 increment 1 (negotiator) green+committed;
increments 2-3 = the ceremony handler, now fully specified. Branch `m7-rehome` both repos,
nothing pushed/merged, floor green (J-SPINE suite green; SPINE-5 ceremony green test skipped).
Increment 3 is a substantial FROST-ceremony-coordination build — the clean next focus.

---

## 2026-06-19 — DOD-SPINE-5 GREEN (full session initiation, FROST-signed assignment received)

Increment 3 landed. `cello_initiate_session` between two agents registered on ONE daemon now
receives a FROST-signed SessionAssignment — the `ceremony_timeout` is closed.

**Built (cello-client `8e8a189`, trustless-cello `d28c42e`).** New `session-ceremony.ts`:
- `reconstructThresholdSigner` — rebuilds the agent's FROST `FrostThresholdSigner` from the
  persisted `frost-share.json` (`loadActiveFrostKeyShare` → `frostSecret`/`frostPublic` →
  `storeDkgResult` → `new FrostThresholdSigner(... directoryNodeStubs:[NetworkDirectoryNode on
  the agent's directory node])`). Ported from core/client `client-startup`; the daemon held no
  signer after registration (it was on the disposed RegistrationContext).
- `wireSessionCeremonyHandler` — on each per-agent signaling stream (+ keystone for the primary):
  answers the directory's `ceremony_request{ceremony_id,tbs,context}` by running
  `participateInCeremony` and replying `ceremony_result{ceremony_id,signature}`. Ported from
  core/client `SealManager.handleCeremonyRequest`. Lazy signer reconstruction, cached per agent.

**Proof.** J-SPINE 5/5 green (no regression): SPINE-1, 2/3, 4, 5-partial (negotiator reaches
directory), 5-full (FROST-signed assignment received, directory-corroborated). The whole live
session-establishment chain works: per-agent signaling → session_request → directory broker →
delegated FROST ceremony (directory ↔ initiator's reconstructed signer over per-agent signaling)
→ SessionAssignment received + parsed (both participants' session Peer IDs + multiaddrs).

**Floor.** lint + typecheck clean (both repos), 342 daemon unit tests green, J-SPINE 5/5.

**Scope boundary.** The actual P2P dial/connection (`transportSelector.dial` — no real
`transportDialer` wired into `cello-daemon.ts`) is DOD-SPINE-6 (send/receive). SPINE-5's DoD is
the ASSIGNMENT received, which is green. Reviewer dispatched on the SPINE-5 build.

**Next — DOD-SPINE-6** (send/receive): wire a real `TransportDialer` into the binary so the
session node actually connects, then `cello_send`→`cello_receive` with the relay showing
hash_submit/leaf_deliver from session Peer IDs (content never in relay logs, INV-3).

---

## 2026-06-19 — DOD-SPINE-6 design note (scoping: the relay content path)

DoD: A `cello_send` → B `cello_receive`; relay log shows `hash_submit` from A's *session*
Peer ID + `leaf_deliver` to B's *session* Peer ID; content never in relay logs (INV-3).

**Live path traced (read):**
- `cello_initiate_session` (post-SPINE-5): negotiate → FROST assignment (green) →
  `transportSelector.dial` (in local = `LocalTransportSelectorStub`, a NO-OP returning
  `mode:"relay"`, so it does NOT block) → `createSessionNode` (N_A, gater bound to
  counterparty) → seam-1b `connectToCounterparty` runs ONLY for `transport_mode==="direct"`
  (daemon.ts:1228). In local, AutoNAT is unavailable (standing receiver reports the
  conservative default), so the advertised address + assignment are **relay** → the direct
  connect is SKIPPED and the session is left active "for the relay path (a later seam)".
- So SPINE-6 is the RELAY content path, NOT direct P2P. `cello_send` (daemon.ts:2430) and
  `cello_receive` (daemon.ts:2521) exist (DAEMON-004) but the relay store-and-forward content
  flow (A → relay `hash_submit` → relay `leaf_deliver` → B) is the unbuilt/parked seam.

**Overlap with Tier 3 (MSG-001):** this is the content-delivery substrate the DoD lists as
partly NOT built — DOD-MSG-3 (relay store-and-forward: ContentStore merged on the relay; the
DAEMON side that deposits/pulls = MSG-001-3b, NOT built) and DOD-MSG-4 (recovery). SPINE-6's
"relay shows hash_submit/leaf_deliver" is the M1 hash layer (Structure 2), which IS built; the
daemon-side content deposit/pull over the session in relay mode is the gap.

**Build (incremental, next):**
1. Bring up the relay in the J-SPINE cluster WIRED to the directory (currently
   `startSpineCluster` starts the relay WITHOUT `CELLO_DIRECTORY_MULTIADDR`, journal
   2026-06-18 open-Q#1) so the relay registers + the session can route through it.
2. Establish the relay-mode session connect (the skipped seam-1b-relay): N_A dials the
   counterparty via the relay circuit address from the assignment.
3. Drive `cello_send` (A) → relay `hash_submit` → `leaf_deliver` → B `cello_receive`; assert
   the relay log shows hash_submit/leaf_deliver from/to the SESSION Peer IDs and content never
   appears in relay logs (INV-3). The two agents are on one daemon (B accepts via the inbound
   session_assignment — wire per-agent for non-primary B, the SPINE-4/5 follow-on).

This is a substantial build (relay content path + bidirectional accept). SPINE-5 reviewer
findings get incorporated first.
