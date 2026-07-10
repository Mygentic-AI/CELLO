---
name: end-of-day-state-and-overnight-handoff
type: discussion
date: 2026-07-10
topics: [handoff, compaction, address-book, m10-trust-signals, publish-state, overnight, cello-support]
description: >
  Cold-start state for the next context. What is building overnight, what is published-but-not-promoted,
  what is parked, where M10 trust-signal design stands (incl. the Fable-Five §14 gap register), and the
  standing coordination + environment facts. Written as the compaction follow-through.
---

# End-of-Day State & Overnight Handoff — 2026-07-10 ~22:00

Read this cold and you can resume. Almost everything below is already committed to git; this is the map.

## 1. BUILDING OVERNIGHT — the address book (CELLO_Support, autonomous)

**CELLO_Support** (the other Claude agent; CELLO pubkey `2ee9bed99385bf7d63950d3836d1b017c6cbd1692351fd6c21309971c3ae8689`)
is coding the **contact address book** overnight, autonomously, in `cello-client core/daemon`.

- **Spec (authoritative, executable):**
  `docs/planning/user-stories/m8c/2026-07-10_address-book-implementation-spec.md` — four build steps, every
  AC concrete, every decision baked in. Design source: `2026-07-10_contact-address-book-design.md`.
- **Scope:** five-tier reachability (`blocked<unknown<known<whitelisted<vip`), tier-graduated abuse bounds
  (INV-TIER-BOUND, `vip` finite), Option C rename detection (via `cello_check_notifications`), per-tier +
  per-contact away messages, a daemon-side per-agent settings store (NOT the M9 gateway store). Built on the
  `agent_id` join-key (contacts is agent_id-keyed; ADD COLUMN only, no rebuild).
- **Status at handoff:** started **Step 1 (DOD-TIER-1)** red-first. One live gap already caught + fixed in
  the spec (`83e7614e`): `getTier` is total, `absent OR tier IS NULL → UNKNOWN`; the `tier` column takes
  **no DEFAULT** (a default breaks the grandfather backfill `WHERE tier IS NULL`).
- **Overnight rule (in the spec):** unforeseen fork → take the tighter/safer option, implement, flag it —
  never block, never loosen. Reviewer runs on the **Fable-Five** model (Andre's instruction).
- **How it reports:** merges each step to `cello-client` main when green+reviewed, then opens a CELLO
  session to **Ms_Chelly** (`178d420b86beb79d2cd819647368d3e24739dcfa526a95f32c0e95ba3bc3e44c`) to report.
  **On each merge: verify independently (pull, read diff, run the full gate), then cut the publish
  cascade.** Publish is Ms_Chelly's; promotion is Andre's.
- **NOT in scope (do not build):** DND state, Generic-Reject-to-initiator frame, offline relay mailbox
  (LEAVEMSG-1), trust_signals/M10, portal.

## 2. PUBLISH STATE

- **`v0.0.93` published to beta + verified against the tarball, AWAITING ANDRE'S PROMOTION:**
  `daemon@0.0.45`, `cli@0.0.43`. This is `DOD-AGENT-ID-JOINKEY-1` — the seven-table re-key to `agent_id`.
  **Its migration runs on Andre's live SQLCipher DB on his next `cello login`** — atomic, aborts on
  ambiguity; Andre would wipe the DB without loss, so blast radius is one machine.
- Promotion command (Andre-run): `cd cello-client && git pull --ff-only && ./scripts/promote-latest.sh`
  then `npm i -g @cello-protocol/cli@0.0.43 @cello-protocol/connect@0.0.64` (exact versions, dodge CDN lag),
  then `cello logout && cello login`.
- **Verify against the BINARY after every publish** (`npm pack` + grep dist), never CI status alone.

## 3. PARKED — written up, awaiting Andre's scheduling (NOT dispatched)

- **DOD-CRYPTO-AT-REST-1** — the gateway writes security records + config as plaintext `node:sqlite`
  (`gateway/config-store.ts`, `records/record-store.ts`), violating M9-CFG-001's own SQLCipher spec.
  **Not on disk yet** — the gateway isn't wired into the shipped daemon, so zero plaintext bytes exist.
  Fix before M9 goes live. In M8C DoD.
- **DOD-DAEMON-CLEANUP-1 + DOD-SINGLE-DAEMON-1** — doc: `2026-07-10_daemon-singleton-defects.md`. An
  exiting daemon unlinks lock/socket without checking it owns them → killing an orphan disarms the healthy
  daemon; nothing stops a second daemon starting. CLEANUP-1 is two lines/near-zero-risk (do first);
  SINGLE-DAEMON-1 is an exclusive OS `flock`. Bit us live today (3 daemons, 2 writing sessions.db).

## 4. M10 TRUST SIGNALS — design, not yet stories

Two docs in `docs/planning/user-stories/m10/`:
- **`M10-TRUST-SIGNAL-TAXONOMY.md`** — WHAT the signals are (4 classes; source of truth; no single score).
- **`M10-TRUST-SIGNAL-STORAGE-AND-CREATION.md`** — HOW they live. Designed this session: dumb directory
  (two hash checks), generic content-addressed envelope (type is DATA not schema), scan-before-hash at a
  per-node "Endorsement Mother" intake role, canonical CBOR, supersede-never-mutate, Flows (§9,
  four→one), Scoping (§10, agent-scoped), **PSI (§11)** — client-side/two-party/directory-relayed,
  round-2 item, one-sided, asker learns *which*, set-size accepted, deterministic-floor policy.
- **`§14` GAP REGISTER (added by a Fable-Five review, `ed25cf64`) — decisions still owed:**
  - **BLOCKING (before any M10 story):** 14.1 federation — "the directory" is singular but CELLO is T-of-N;
    the chokepoint invariant **collapses** (one compromised node inserts un-scanned hashes) → needs T-of-N
    attestation or honest weakening. 14.2 the **revocation write path** is undesigned + unauthenticated (no
    signatures; a later revocation is by someone *claiming* to be the issuer). 14.3 **PSI vs plain
    presentation** — if endorsements can also be shown as plain `{hash,blob}`, PSI's privacy is decorative.
  - **Non-blocking (decide during story writing):** 14.4 recipient policy layer; 14.5 chokepoint auth
    mechanics; 14.6 subject key rotation/succession; 14.7 freshness under node failure (fail-open vs
    fail-closed); 14.8 type-registry governance + v1 payloads; 14.9 wallet loss/backup; 14.10 assorted
    (validity windows, Class-3 source data, backfill live M8 signals, intake rate limits, selective
    disclosure = positive-only).
  - **M10 storage sits on `DOD-AGENT-ID-JOINKEY-1`** (shipped) — `trust_signals` FKs a per-agent contact row.

## 5. STANDING FACTS

- **Coordination is over CELLO.** I am **Ms_Chelly**. CELLO_Support is the coder. Sessions are sealed
  per-exchange; closing one is not goodbye. Always take incoming sessions; `[[WRAP]]`+seal.
- **Never run any `cello` CLI from this session** (spawns a daemon); **never restart the daemon** (one
  daemon serves all agents). Andre restarts daemon/Hermes himself. Drive CELLO via the `cello_*` MCP tools.
- **Environment: Node PATH.** Hermes symlinked `~/.local/bin/node` (v22) ahead of homebrew v24 on 2026-07-08.
  That, not any CELLO change, causes `EBADENGINE` + `ExperimentalWarning: SQLite` on every command. Fix:
  `rm ~/.local/bin/node`. `node:sqlite` is banned in production (lint rule); we use SQLCipher.
- **`(self-declared)`** is the moniker marker (renamed from `unverified` today) — it means "they named
  themselves, not you," shows for any un-named contact.

## 6. TODAY, SHIPPED + LIVE-PROVEN (context only)

DOD-MONIKER-6, DOD-HERMES-3, the whole phantom-session chain **D1–D4 live-proven end-to-end** (directory
deployed all 3 regions), DOD-SENDRAW-1 (+ lint rule), DOD-LOGOUT-WAIT-1, DOD-AGENT-ID-JOINKEY-1 (seven
tables), the `(self-declared)` rename, `sessionId` on `moniker.resolved`. Journal: M8C-BUILD-JOURNAL
Entries 71–87.
