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
