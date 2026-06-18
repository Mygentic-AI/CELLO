---
name: M7 Integration Handoff
type: handoff
date: 2026-06-18
milestone: M7
topics: [daemon, integration, dead-code, seam-by-seam, reachability, session-establishment, handoff]
status: live
description: >
  Full source-of-truth handoff for resuming the M7 daemon integration after a
  compaction. Captures the integration-first pivot, the dead-code reachability gate,
  the 7-branch assembly, the seam-by-seam verification loop (seams 1a/1b done), every
  standing constraint, the hard-won lessons, the branch topology, and the exact next
  action. Read this FIRST on resume; COORDINATION.md is the per-story ledger, this is
  the narrative state.
---

# M7 Integration Handoff — read this first on resume

> This is the **full handoff**, not just the ledger. COORDINATION.md tracks per-story
> status; THIS doc is the live narrative state, decisions, topology, constraints, and
> the exact next move. If anything here disagrees with code, the code wins — verify.

## 0. TL;DR + exact next action

**Goal:** a working **multi-session / multi-agent daemon at M6B parity** (M6B already
worked end-to-end single-agent/single-session on the OLD in-process client; we are
rebuilding that capability in the daemon). "Brutal and ruthless" — fastest correct path.

**Where we are:** the 7 unmerged cello-client M7 branches are **assembled into one base**
that is green; a **mechanical dead-code gate** is in place; and we are walking the
session lifecycle **seam by seam, in-process, with stub adapters and NO infra** — tracing
each connection point, finding the break, fixing it, testing it, committing. Seams **1a**
(initiate creates the session-core session), **1b** (the session node is the dialer),
**2** (inbound `session_assignment` → `acceptSession` → `cello_await_session`), and **3**
(content + tree + delivery-ACK round-trip between two real session nodes) are done. The
three core lifecycle seams (establish → accept → content+ACK) are proven over real libp2p.

**EXACT NEXT ACTION: Seam 4 — full daemon-IPC two-daemon local orchestration.** Wire the
whole stack end-to-end through two real daemons: `cello_initiate_session` (A) → assignment
pushed to B over a shared in-process signaling hub → seam-2 `acceptSession` (B) → `cello_send`
(A) → `cello_receive` (B) → delivery-ACK. This needs (a) a composition-root local
`SessionNegotiator` stub producing matching A/B assignments, and (b) restructuring
`cello_initiate_session` to create N_A **before** the assignment is finalized so the push to
B can carry `initiator_session_peer_id` = N_A's peer id (the protocol-faithful WIRE-001
ordering — today initiate creates N_A after negotiate). In-process, real local libp2p, stub
relay/directory. No infra. No live E2E. (Greenfield SESSION-002 is left for Andre.)

---

## 1. Branch topology (where everything lives)

**cello-client** (`/Users/andrep/Documents/code/cello-client`):
- **`CELLO-M7-MSG-001-REHOME` @ `ea83982`** — **THE ASSEMBLY** (worktree
  `.claude/worktrees/CELLO-M7-INTEGRATION`). Name is a **misnomer** — it is the full
  integrated base (Keystone + Registration + DAEMON-004 + MSG-001 phases 1/2/3a +
  TRANSPORT-001 + SESSION-003 + SESSION-004 + the dead-code tool + seams 1a/1b).
  **Rename pending** (e.g. `CELLO-M7-DAEMON-PARITY`). All active work happens here.
- `main` @ `9fcb2bf` — **untouched** (M7-SESSION-001). NOTHING merged to main.
- Source branches (now subsumed by the assembly; kept for reference):
  `CELLO-M7-KEYSTONE` `903433d`, `CELLO-M7-REGISTRATION` `e1b5e26`,
  `CELLO-M7-DAEMON-004` `7ba23fa`, `CELLO-M7-TRANSPORT-001`, `CELLO-M7-SESSION-003`,
  `CELLO-M7-SESSION-004`, `CELLO-M7-MSG-001`, plus the prior `CELLO-M7-INTEGRATION`
  `fd89747` (Keystone+Reg+DAEMON-004 only — superseded by the REHOME branch).

**trustless-cello** (`/Users/andrep/Documents/code/trustless-cello`):
- **`CELLO-M7-MSG-001-RELAY` @ `f7924b4`** — the relay store-and-forward half (worktree
  `.claude/worktrees/CELLO-M7-MSG-001-RELAY`). ContentStore + FileContentStore +
  ContentParkHandler + bin wiring. Off main.
- `main` @ `b39f8b1` — only docs (COORDINATION + this handoff). No code, not pushed.

**NOTHING is merged to main and NOTHING is pushed. Both are Andre's call.**

---

## 2. The strategy and WHY (the pivot)

The original plan was "finish the four postmortem stories then live-test." That was wrong
for two reasons Andre surfaced:

1. **Branch sprawl was hiding built code.** I twice claimed a capability was "missing /
   must build" (MSG-001's recovery spine; then live session establishment). Both were
   WRONG — the code existed, scattered across the 7 unmerged branches. I was reasoning
   from one branch's vantage. → **Integration-first:** assemble the branches into ONE
   base, then find the *real* gaps, instead of guessing branch-by-branch.

2. **A full live E2E test is the wrong discovery tool now** (Andre, emphatically). Standing
   up directories/relays/deploys is a day-long adventure and premature — the milestone-close
   gate, not a discovery loop. → **Seam-by-seam, in-process, stub adapters, NO infra:** the
   daemon is built on the adapter pattern precisely so its logic runs in-process against
   local stubs. Trace one seam → find the break → write one focused in-process test (real
   local libp2p only for the hop that matters; stub directory negotiator + relay) → fix →
   commit. The eventual real E2E is "swap stubs for real infra" — LAST, not now.

The two problems behind all this (Andre's framing):
- **Dead code that confuses AI coders** (grep finds disconnected old-stack code, can't tell
  it's unwired) — the HARD one → solved with the **reachability gate** (§3).
- **Assuming-works-when-it-doesn't** — the EASY one → solved by code review + the seam tests.

---

## 3. The dead-code reachability gate (problem #1's fix)

**Tool:** `scripts/reachability.mjs` + baseline `docs/reachability-baseline.json` (in the
cello-client assembly). Mechanical import-graph walk from the LIVE binaries
(`cello-daemon`, `cello-mcp`, `cello`). Run: `node scripts/reachability.mjs` (add
`--json` / `--with-index`). Tags each unreachable file `[api]` (reachable only via a
package's published index, not a binary) or `[orphan]` (no tether at all).

**Authoritative findings (replaces grep-and-guess):**
- **`core/client/` = 26 dead files** — the ENTIRE old in-process `CelloClient` stack is
  dead from the live runtime (reachable only via its own index.ts + the trustless-cello
  E2E fixture). This held UNCHANGED through every assembly merge — proof the structural
  exclusion worked.
- The **old adapter entry** (`adapter/server.ts` + `createMcpServer` export) is dead — the
  live `cello-mcp` bin does NOT reach it. It's the file that makes a grep-driven AI think
  the adapter uses `CelloClient`.
- **The E2E suite tests the DEAD stack:** trustless-cello `packages/e2e-tests/src/session-
  fixture.ts` uses `createClient` (the OLD client). So "E2E green" has been validating the
  wrong stack — a reason the real E2E can't be leaned on as a discovery tool until it's
  migrated to drive the daemon.
- Orphans: `client/encrypted-file-signing-key-provider.ts`, `adapter/lock-file.ts`,
  `crypto/frost/stubs.ts`.

**Structural merge rule (Option A invariant):** the daemon NEVER imports
`@cello-protocol/client` (DAEMON-004 stack-retirement gate enforces it). ⇒ every branch's
`core/client` changes are dead-by-definition ⇒ when merging a branch, take only its
daemon/transport/protocol-types/crypto/interfaces halves and **EXCLUDE `core/client`**
(restore to HEAD; `git rm` any newly-added dead files — watch for them showing as STAGED
`A` after a clean merge, not just untracked `??`).

**Endgame:** wire reachability as a CI gate (dead set may only shrink); **delete
`core/client` entirely** once the daemon is the proven live path (kills the confusion
source for good). Not yet — needs the seams green + the E2E fixture migrated.

---

## 4. What's assembled and green

Assembled base (`CELLO-M7-MSG-001-REHOME`): Keystone + Registration + DAEMON-004 +
MSG-001(1/2/3a) + TRANSPORT-001 + SESSION-003(live half) + SESSION-004(live half) +
reachability tool + seams 1a/1b.

**Capabilities now live in the base** (were stubs/missing before):
- `cello_register` (multi-agent, ML-DSA + FROST DKG) — Registration.
- daemon↔directory connection builder — Keystone.
- session-core: per-session Merkle tree + content send/receive + active seal — DAEMON-004.
- `cello_initiate_session` (negotiate → createSessionNode → dial-via-N_A) — TRANSPORT-001 + seams.
- content size cap (1 MB) + **delivery-ACK round-trip** + TTF/awaiting backstop — MSG-001 3a.
- session-path liveness (keepalive + `#sessionLiveness`) — SESSION-003 live half.
- `SealLegibility` schema — SESSION-004 live half.
- relay store-and-forward (ContentStore/FileContentStore/ContentParkHandler) — on the
  trustless-cello RELAY branch.

**Gate (single-worker foreground):** workspace typecheck (8 projects) + lint clean;
**daemon 330 / 32 files**, transport 86, protocol-types 123, crypto 242, adapter 100;
`daemon-004-stack-retirement` clean throughout; reachability client-dead = 26 (unchanged).

Two real bugs fixed along the way: the **first-writer-wins** content-store test (was
asserting last-writer-wins against the security-decided stub) and the **IPC buffer cap ==
content cap** defect (1 MB IPC buffer killed a 1 MB message before `cello_send`'s cap ran;
raised both in-sync to 4 MB).

---

## 5. Seam-by-seam progress (the live work)

Each seam = trace → find break → one in-process test → fix → commit. Stub negotiator +
stub relay; real local libp2p only where two nodes must talk. **No infra.**

- **Seam 1a — DONE (`0537dfe`).** `cello_initiate_session` established transport but never
  created a session in the session-core → would've hit `session_not_found`. Fix: initiate
  now calls `sessionNodeManager.createSessionNode(...)` after transport selection. Test in
  `transport-composition.test.ts` (stub negotiator → queryable active session-core record).
- **Seam 1b — DONE (`ea83982`).** The dialer/session-node reconciliation. TRANSPORT-001's
  `transportSelector.dial` dialed on a SEPARATE composition-root node, but the per-session
  ephemeral node N_A is what content `newStream` rides — so N_A had no usable connection.
  Fix: `SessionNodeManager.connectToCounterparty(sessionId, addrs)` — N_A dials the
  counterparty itself (direct mode); `cello_initiate_session` calls it for `transport_mode
  === 'direct'` (tears the session down on failure). Real-libp2p test: N_A dials a listening
  counterparty; the counterparty observes the inbound connection from N_A's peer id.
  **Still pending under 1b:** relay-circuit + dcutr dial via N_A (a later seam) — only
  direct mode routes through N_A today.

- **Seam 2 — DONE (`c72968e` + review fixes `96af667`).** Inbound counterparty side wired.
  A persistent `registerInboundHandler` for `session_assignment` (the directory's unsolicited
  push to B) parses the assignment, resolves `participant_b` → local agent (by K_local pubkey),
  and calls `SessionNodeManager.acceptSession` (hands off the standing receiver bound to A's
  session peer id). On success it enqueues a per-agent inbound event; the real
  `cello_await_session` handler (replacing the `not_implemented` stub) returns it
  (`{type:"new_session", session_id, counterparty_pubkey, genesis_prev_root}` | `{type:"timeout"}`
  — matches the dead adapter contract for drop-in E2E migration). Native Option-A re-home of
  the dead `frame-dispatch.ts` + adapter `server.ts` paths. **Hardened via review:**
  genesis_prev_root is the canonical `computeGenesisPrevRoot(pubA,pubB,sid,ts)` (H1, NOT the
  empty-tree root); waiters carry connectionId and are evicted on disconnect (H2); retransmit
  idempotency via getSessionRecord + in-flight set (M1); inbound accepts SERIALIZED through a
  promise chain + bounded standing-receiver-rebuild wait so a burst isn't dropped (M2);
  non-empty `initiator_session_peer_id` required (M3); correlationId threaded through every
  event (M4); `signature_type:"single"` refused (L1); hex lowercased (L2). Tests:
  `seam-2-inbound-session.test.ts` (9 cases). **Still deferred:** the FROST threshold-signature
  verification of the inbound assignment is the **SESSION-004 re-home** — accepted-on-trust here
  (in-process tests inject trusted frames), logged loudly as `session.inbound.assignment.unverified`,
  never silent. SESSION-004 must also re-home the M1 single-key hard-refusal context.
- **Seam 3 — DONE (`659745e` + review fixes `9ffbe33`).** Content + tree + delivery-ACK
  round-trip between two REAL session nodes over loopback Noise/yamux TCP, composing seams
  1a/1b/2: `A.createSessionNode` → `A.connectToCounterparty` (N_A dials B's standing receiver)
  → `B.acceptSession` → `A.sendContent` → `B.#handleContentStream` (cross-check + tree append +
  buffer + delivery-ACK) → `A.#handleContentStream` resolves the awaiting-ACK. The reviewer
  confirmed it's a faithful stub-resistant proof: **B holds NO multiaddr for A**, so the
  delivery-ACK can ONLY ride the muxed connection N_A opened (the "B never dials A" claim is
  proven, not assumed). New `SessionNodeManager.getStandingReceiverInfo()` (read-only coords a
  local negotiator advertises). Tests: `seam-3-content-roundtrip.test.ts` (happy path + tamper
  rejection). **Review fixes:** gracefulShutdown clears awaiting-ACK timers (M1) + closes the DB
  handle (L5) + `#shuttingDown` flag stops an orphan standing-receiver replacement (M2);
  `#registerContentHandler` is now awaited (acceptSession → async; L4). daemon 341 green.
- **Seam 4 — NEXT.** Full daemon-IPC two-daemon local orchestration (cello_initiate ↔ push ↔
  acceptSession ↔ cello_send ↔ cello_receive ↔ ACK through two real daemons). Needs a
  composition-root local `SessionNegotiator` stub + restructuring `cello_initiate_session` to
  create N_A before the assignment is finalized (so the push to B carries N_A's peer id — the
  WIRE-001 ordering). This is the end-to-end M6B-parity proof for the direct path.

**Deferred re-homes (the original four postmortem stories' remaining halves):**
- **MSG-001 3b** — recovery / canonical sequence: the daemon **relay content-leaf path**
  (Structure2 hash-leaf submit/receive + relay-assigned sequence + recovery sender_resend/
  relay_queue + production park deposit). The full spine is **BUILT AND TESTED on the dead
  `core/client` stack** (`relay-stream-manager.ts` 1261 lines + `session-manager.ts`) — it
  must be REIMPLEMENTED natively in the daemon under Option A (can't host the client). This
  is the previously-untracked `CELLO-M7-DAEMON-CONTENT-WIRING` (the prior author's Option-B
  "host a CelloClient" plan is superseded).
- **SESSION-003** daemon-liveness test (its tests were in the excluded dead half; the
  `#sessionLiveness`/`#wireSessionLiveness` daemon path is wired but now untested; the
  seal-gate that READS it was in the dead `seal-manager`).
- **SESSION-004** client-side legibility logic (only the schema is live; full re-home).
- **SESSION-002** — CONFIRMED greenfield (only the YAML exists). Its directory notarization
  half is PRE-EXISTING directory FROST capability, not a 002 effort; all real work is the
  client/daemon half, from scratch.

---

## 6. Key architectural facts to carry forward

- **Option A:** the DAEMON owns the session core (tree + content + seal). It NEVER imports
  `@cello-protocol/client`. The old `CelloClient` stack is dead; re-homes reimplement
  natively, guided by the tested old-stack logic as reference.
- **The session node N_A is the dialer** (seam 1b). The TransportSelector's strategy
  (direct→relay→dcutr) should eventually drive N_A's dial; today only direct is routed
  through N_A. The composition-root `transportDialer`/`transportSelector` (shared-node model)
  is being superseded per-session.
- **`SessionNegotiator` is an interface only — no stub exists.** Tests inject a stub via
  `config.sessionNegotiator` returning a canned `SessionAssignment`. A composition-root local
  negotiator stub (so `cello initiate` works locally) is unbuilt — needed for the local
  two-daemon orchestration (seam 3 / a local stack).
- **The assembly merges were all additive-union** on `daemon.ts` / `types.ts` /
  `session-node-manager.ts` (DAEMON-004 + TRANSPORT-001 + SESSION-003 each independently
  rewrote session-node-manager). Resolution = keep both sides; give the second comment its
  own `/**` opener.
- **Fake CelloNodes** in tests must implement `onDialabilityChange` + `getDialability`
  (NodeAutoNatService calls them) — 5 fakes were updated; new fakes need them.

---

## 7. Standing constraints (NON-NEGOTIABLE)

- **NO merge to main. NO git push.** Both are Andre's call. (trustless-cello push triggers
  the 25-30 min directory/relay live-deploy pipeline.)
- **NO live E2E / NO infra / NO deploys as a discovery tool.** Seam-by-seam in-process only.
  The live multi-process smoke is the milestone-close gate, last.
- **Worktree + branch per task** (already on the assembly worktree).
- **Commit constantly** (every seam/fix; message explains what + why).
- **vitest: ONE worker, foreground, with timeout.** `--pool=threads
  --poolOptions.threads.maxThreads=1 --testTimeout=30000`. NEVER background vitest (battery).
  The full relay suite has a PRE-EXISTING single-worker hang on `m7-session-001` ordering
  (reproduced on clean main — not ours); run relay files individually.
- **Reviewer = `feature-dev:code-reviewer`, `model:'opus'`** (its frontmatter pins sonnet —
  override). Fix ALL findings at all severities.
- **Dead-stack gate stays clean:** daemon/adapter source + dist must contain zero
  `new CelloClient` / `session-manager` / `seal-manager`; daemon must not depend on
  `@cello-protocol/client`.
- Pre-auth tokens / SI secrets never logged. Alpha — no production-safety hedging on code.

---

## 8. Hard-won lessons this session (don't repeat)

1. **With many unmerged branches, NO "missing / must-build" claim is valid until checked
   across EVERY branch.** Read commit messages (`git log main..BRANCH --format=%B`) + the
   story YAML — a source grep of one tree proves only absence-from-what-you-searched, never
   "never built." (Caught 3× by Andre. Saved to memory `feedback_assume_code_exists`.)
2. **Dead code is the AI-coder trap:** make "what's dead" mechanical (reachability), never a
   grep vibe.
3. **Don't do the full E2E early.** Seam-by-seam, in-process, stubs. (Andre, emphatically.)
4. Chained `cd ...; git show "$br:path"` in a loop misbehaved repeatedly — verify per-branch
   with explicit commands, not loops.

---

## 9. Commit trail (assembly branch, newest first)

`9ffbe33` seam 3 review fixes (M1/M2/L1-L5) · `659745e` seam 3 (two-node content round-trip over
real libp2p) · `96af667` seam 2 review fixes (H1/H2/M1-M4/L1-L2) · `c72968e` seam 2 (inbound session_assignment
→ acceptSession → cello_await_session) · `ea83982` seam 1b (session node is the dialer) · `0537dfe` seam 1a (initiate→session-core) ·
`fd2a607` assemble SESSION-004 · `8a9c183` assemble SESSION-003 · `2100b69` assemble
TRANSPORT-001 · `2b5b2ff` reachability tool + baseline · `3bf3f10` MSG-001 3a-ii (delivery-ACK)
· `e1bfd5f` MSG-001 3a-i (send cap + IPC buffer fix) · `f004c22` MSG-001 Phase 2 (retry_queue) ·
`89dd791` MSG-001 Phase 1 (KEEP packages) · `fd89747` Keystone+Registration+DAEMON-004 merge.
Relay branch: `f7924b4` (relay store-and-forward). trustless-cello main: `b39f8b1` (COORDINATION).

COORDINATION.md (`docs/planning/user-stories/m7/COORDINATION.md`) has the per-story ledger +
the dated log; its 2026-06-18 entries mirror §3–§5 here.
