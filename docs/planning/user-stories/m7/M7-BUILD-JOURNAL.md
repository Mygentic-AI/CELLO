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
