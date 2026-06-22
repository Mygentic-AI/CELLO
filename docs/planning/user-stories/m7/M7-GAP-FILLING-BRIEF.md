---
name: M7 Gap-Filling Brief — Stories & Design Decisions to Author
type: brief
date: 2026-06-20
milestone: M7
status: open
topics: [m7, stories, design-decisions, tier-4, tier-5, persistence, upgrade, gap-filling, handoff]
description: >
  A self-contained handoff for a SEPARATE session whose ONLY job is to fill the
  SPECIFICATION gaps in M7 — write the missing stories and record the missing
  design decisions — so the implementation thread (the live J-SPINE loop) has
  something to drive against for Tier 4, Tier 5, and the newly discovered
  persistence work. This session does NOT write implementation code. Read this
  document top to bottom; it contains everything a fresh session needs.
---

# M7 Gap-Filling Brief — Stories & Design Decisions to Author

## 0. What this session is and is NOT

**IS:** author the missing **stories** (YAML) and record the missing **design
decisions** (discussion logs) for the parts of M7 that have no spec yet — Tier 4
(J-UPGRADE), Tier 5 (recovery substrate), and the newly discovered persistence /
data-custody journey. Plus two design decisions surfaced in discussion.

**IS NOT:** implementation. A separate thread is driving the live binary test
(J-SPINE) and writing the daemon/relay/directory code. **Do not write production
code, do not touch the implementation, do not run the live test.** Your output is
specification only: story YAMLs, DoD additions, and decision records.

**Why this split exists:** the methodology that's working is *one implementation
thread, sequential, foreground*. Specification (the thinking — ACs, SIs, threat
models) is what the stories are *for*, and it can be done in parallel with
implementation because it touches different files (docs only). So you fill the
spec gaps while the other thread builds.

---

## 1. Context a fresh session needs (read this first)

### 1.1 The three governing documents (all in this folder, `docs/planning/user-stories/m7/`)
- **`M7-PROCEDURE.md`** — the runbook (how the implementation loop works). Read §5
  (hard rules) and §6 (greenfield/design-significant units get a design note first;
  Tier-4 items must be STORIED before building).
- **`M7-DEFINITION-OF-DONE.md`** — the yardstick. Every requirement is a numbered
  `DOD-*` line with a status tag (✅/🟡/🟠/❌/⬜), grouped into 8 journeys. **This is
  where your new scope lands** — you'll add lines and you'll change ⬜ NOT STORIED
  tags as you write stories.
- **`M7-BUILD-JOURNAL.md`** — the append-only audit trail. Read the **last ~6
  entries** to see current state. Append a short entry when you finish (what stories
  you wrote, what decisions you recorded).

### 1.2 Canonical glossary — READ BEFORE WRITING
- **`CONTEXT.md`** (repo root). Defines Account → Agent → Session, K_local, FROST
  `primary_pubkey`/`K_server_X`, ephemeral session node, etc. Using terms not
  defined there is a bug. Key facts you'll rely on:
  - **Account** = the human (one per person, parent of all their agents).
  - **Agent** = an identity: a unique `K_local` (Ed25519) + a unique FROST DKG
    `primary_pubkey` + an `agent_profiles` row. Multiple agents per account.
  - **Session** = one conversation between exactly two Agents; its own `session_id`,
    Merkle tree, sequence numbering, ephemeral transport keys. Multiple sessions can
    run concurrently on one Agent. Not durable — each conversation is a fresh session.

### 1.3 Current state (as of 2026-06-20)
- The happy spine (J-SPINE, `DOD-SPINE-1..7`) is **6 of 7 lines green**; SPINE-7
  (bilateral seal) is in active implementation on the other thread.
- The 8 journeys (DoD harness section): **J-SPINE** (happy), then **J-AUTH, J-SIG,
  J-INT, J-CONTENT, J-UNILATERAL, J-LEGIBILITY, J-UPGRADE**.
- **Stories that EXIST** (19 YAMLs, do NOT rewrite): CICD-001, DAEMON-001/002/003/004,
  DIR-PING-001, E2E-001, MANIFEST-001/002, MCP-001/002, MSG-001, SESSION-001/002/003/004,
  SIGNAL-001, TRANSPORT-001, WIRE-001. These cover J-AUTH (MANIFEST), J-SIG (SIGNAL),
  J-INT (SESSION-001 + DAEMON-003), J-CONTENT (MSG-001), J-UNILATERAL (SESSION-002/003),
  J-LEGIBILITY (SESSION-004). They just need *reading* when their journey is built.
- **Stories that are MISSING** = your job (§2).

### 1.4 How to write a story (format + tooling)
- **Prefer the slash command** `/cello-story` (it enforces E2E-first ordering and
  observability ACs). If unavailable, hand-author the YAML to match the existing
  format.
- **Filename:** `docs/planning/user-stories/m7/CELLO-M7-<DOMAIN>-<NNN>.yaml`.
- **Structure** (copy the shape of `CELLO-M7-SESSION-002.yaml`, the closest seal/
  protocol template):
  - Frontmatter: `name, type: user-story, date, topics, status: draft, description`.
  - `id, domain, milestone: M7, actor, priority, components`.
  - `story:` (As / I want / so that).
  - Context comments (source pointers, any STACK-CORRECTION notes — see below).
  - `behavior:` → `acceptance_criteria:` (AC-001…) → `security_invariants:` (SI-001…)
    → `degraded_behavior:` → `observability:` → `implementation_notes:` →
    `dependencies:` (blocked_by) → `references:`.
- **The SI block is load-bearing.** The DoD only *summarizes* requirements; the precise
  adversarial acceptance criteria live in the story's `security_invariants`. Write them
  carefully — they become live-test assertions.
- **Observability ACs are mandatory (M4+ rule):** every story specifies named log events
  (`domain.noun.verb`), required context fields, correlationId threading, error-path
  coverage, alarm thresholds for new failure modes.
- **MANDATORY STACK-CORRECTION awareness:** the in-process `core/client` stack
  (`createClient`, `seal-manager.ts`, `session-manager.ts`) is **DEAD** — no shipped
  binary runs it (post REPOSPLIT + the daemon migration). The live client is the
  **daemon** (`core/daemon/`). Any client-side AC must target the **daemon seal/session
  path**, NOT `core/client`. See `CELLO-M7-DAEMON-004.yaml` and the POSTMORTEM. State this
  explicitly in each new story (the existing SESSION-002 has a STACK-CORRECTION comment
  block — copy that pattern).

---

## 2. The gaps — what to write

Each gap below gives: **what's missing**, **why it matters**, **source material**
(exact files to read), and **what to produce**.

### GAP A — J-UPGRADE (Tier 4): write 2 stories. HIGHEST PRIORITY.

**What's missing:** `DOD-UP-1` and `DOD-UP-2` are tagged ⬜ **NOT STORIED**. There is
no `UPGRADE` YAML. The journey cannot be implemented because there is nothing to drive
the loop against.

**Why it matters:** these are protocol-significant (they change the seal record from
unilateral to bilateral). `M7-PROCEDURE.md` §6 says explicitly: *"Tier-4 items are NOT
STORIED. Before building either, write the story (real story machinery applies)."*

**Source material (read these):**
- `POSTMORTEM-seal-and-content-delivery-gaps.md` — **Workstream C** (unilateral →
  bilateral upgrade) and **Workstream E** (auto-acknowledge close), plus Part 4 row C.
- `CELLO-M7-SESSION-002.yaml` (unilateral seal — the thing being upgraded FROM) and the
  directory's `processSeal` / `SealNotarization` / PERSIST-015 (the append-only
  superseding-row mechanism the upgrade reuses).
- `M7-DEFINITION-OF-DONE.md` lines for `DOD-UP-1` / `DOD-UP-2` (the one-line summaries).

**What to produce:**
1. **`CELLO-M7-UPGRADE-001.yaml`** (DOD-UP-1 — unilateral → bilateral upgrade):
   - Intent: a returning ABSENT party recovers + verifies the content, signs an ack leaf
     over the *sealed root*, and the seal is promoted to **bilateral** via an append-only
     superseding `SealNotarization` row (reverses PERSIST-015 SI-002).
   - Key ACs: content possession is the **precondition** (you can't upgrade a seal you
     can't verify); refuse only on unverifiability (postmortem D-3); the superseding row
     is append-only (the unilateral row is never mutated).
   - Key SI: the returning party's ack is **its own node's signature** — never forged by
     the present party or the directory (INV-2).
2. **`CELLO-M7-UPGRADE-002.yaml`** (DOD-UP-2 — auto-acknowledge close):
   - Intent: B's node **auto-co-signs** the responder SEAL leaf on ingesting A's SEAL
     ctrl leaf + verified content, with **no agent prompt**; `counterparty_closing`
     becomes informational; verifiability-gated.
   - Key SI: B's signature is **always B's own node's** (INV-2); auto-ack fires ONLY when
     B has verified the content (never a blind co-sign).
3. **Flip the DoD:** change `DOD-UP-1/2` tags from ⬜ NOT STORIED to ❌ NOT BUILT (storied,
   awaiting implementation), and note the story IDs.

### GAP B — Persistence / data-custody (NEW journey): DoD addition + 1 story + design decisions.

**What's missing:** the client stores **only the cryptographic hash chain** locally
(`session_tree_leaves` = SHA-256 hashes). The **readable conversation transcript is NOT
persisted** — plaintext lives in an in-memory buffer, is drained by `cello_receive`, and
is evicted on teardown (`session-node-manager.ts` `#receivedContent` / `#evictSessionCaches`;
comment: *"plaintext must not survive shutdown in memory"*). There is no content store, no
`messages` table.

**Why it matters:** the product promise is **"data stays local — we are a hash custodian,
not a data custodian."** The server (directory/relay) correctly holds only Merkle trees /
MMR (INV-3, built). But the **client is supposed to be the data custodian of its own logs**
— for **dispute resolution, reporting malicious behavior, and simply knowing what happened**.
`CLAUDE.md` and `CONTEXT.md` both state the local DB holds *"conversation history"* — the
intent exists; the implementation does not. This is a genuine gap, not an intentional
omission. (The *server*-side non-storage is intentional; the *client*-side storage is owed.)

**Design decisions to record FIRST (in a discussion log) before the story:**
- **D-B1 — scope: one DoD line or a whole journey?** Recommendation: a **journey**
  (`J-PERSIST` / `J-CUSTODY`), because "store the text," "produce a verifiable dispute
  bundle," and "file an abuse report" are distinct capabilities sharing one persisted
  substrate. Decide and record.
- **D-B2 — what is stored, exactly?** At minimum the readable transcript (sent + received
  plaintext, per session, ordered). Decide whether trust/endorsement records and the
  pseudonym/conversation-participation layer (`CONTEXT.md`) are in scope here or separate.
- **D-B3 — encryption at rest.** `CLAUDE.md` envisions SQLCipher. Confirm the at-rest
  encryption story (the current daemon uses `node:sqlite` `DatabaseSync` — is it encrypted?
  if not, that's part of this work or a precondition). Decide.
- **D-B4 — reconcile with the eviction rule.** The current "plaintext must not survive
  shutdown *in memory*" rule is about RAM hygiene, NOT a ban on encrypted disk. State this
  explicitly so the story doesn't read as reversing a privacy invariant — it's adding a
  deliberate encrypted-at-rest store.

**Source material:** this brief, `CONTEXT.md` (the "conversation history" / "accumulates its
own conversation history and endorsements" lines), `CLAUDE.md` (the SQLCipher line), and the
daemon's current durable schema (`core/daemon/src/session-node-manager.ts` CREATE TABLEs,
`retry-queue.ts`, `nonce-dedup.ts`).

**What to produce:**
1. A short **discussion log** recording D-B1..D-B4 (`discussion_logs/YYYY-MM-DD_HHMM_client-data-custody.md`).
2. **DoD additions:** new lines (e.g. `DOD-LOG-1` durable readable transcript survives
   restart; `DOD-LOG-2` dispute-export bundle; `DOD-LOG-3` abuse-report bundle) + a new
   `J-PERSIST` row in the harness section, status ❌.
3. **`CELLO-M7-PERSIST-LOG-001.yaml`** (or per your scope decision): the client durable
   conversation-log store. Key ACs: write on `cello_send`/`cello_receive`; survive a daemon
   restart (readable after `cello login`); encrypted at rest; **the relay/directory logs
   still show only hashes** (INV-3 preserved — assert it). Key SI: the stored transcript is
   the operator's local data and never leaves the device unbidden.

### GAP C — Tier 5 recovery substrate (`DOD-REC-1/2/3`): DECIDE first, then maybe story.

**What's missing:** three items flagged ❓ in the DoD as *"verify carried or drop"* — they
appear in old design logs but may have been lost between those logs and the four postmortem
stories:
- `DOD-REC-1` — **signed relay ACK as a cryptographic receipt** (the relay's signature over
  `(H || seq || timestamp)` as evidence a hash entered the record).
- `DOD-REC-2` — **pre-seal reconciliation / gap-fill** (both parties exchange last-confirmed
  seq before CLOSE; on divergence the relay serves missing leaves from WAL — relay-
  authoritative, not counterparty).
- `DOD-REC-3` — **delivery-failure tree coverage** (the A/B/C/D branches × time dimension).

**Why it matters:** `M7-PROCEDURE.md` §5 (deferral rule) and the M5 retrospective RC-1: *a
milestone may not close carrying a silent deferral.* These must be explicitly **in** (with a
home) or **out** (with a recorded decision), not left ❓.

**Source material:** the **April-8 delivery-failure-tree log** and the **May-14
relay-recovery log** (in `discussion_logs/` — search for "Signed Relay ACK", "Pre-Seal
Reconciliation", "delivery-failure"). Cross-check against `CELLO-M7-MSG-001.yaml` (recovery)
and `CELLO-M7-SESSION-004.yaml` (post-session straggler) to see what's already covered.

**What to produce (per item):**
- **A decision record** (in the persistence/Tier-5 discussion log or a dedicated one):
  REC-1 — note PERSIST-012 already gives the relay a **signed** `hash_submit_ack`
  (`relay_signature` over the ack TBS); decide whether that satisfies REC-1 or whether a
  distinct client-facing "receipt" is needed. REC-2 — decide whether the bilateral pre-seal
  reconciliation handshake is needed beyond MSG-001's recovery; if yes, story it. REC-3 —
  confirm each delivery-failure branch has a defined outcome across MSG-001 + SESSION-004;
  if a branch is uncovered, story or note it.
- For each item kept IN that isn't already covered by an existing story: a short story or an
  explicit AC added to the relevant existing story (note which).
- **Update the DoD** REC-1/2/3 tags from ❓ to a decided status (✅ if already covered with
  the covering story named; ❌+story-id if newly storied; or a "DROPPED — rationale" note).

### GAP D — Local loopback / one-daemon-two-parties: a DESIGN DECISION (then maybe a story).

**What's missing / the finding:** one daemon **cannot host both ends of one session** today.
The `sessions` table is keyed `session_id TEXT PRIMARY KEY` with a single `agent_name` owner
column, and the in-memory `#activeNodes` + per-session Merkle trees are keyed by `session_id`
alone. So if agent A (one MCP connection) and agent B (another MCP connection) on the **same
daemon** try to be the two parties of one session, the second party's row collides on the
primary key and the ownership check (`record.agent_name !== currentAgent`) returns
`session_not_owned`. (Evidence: `core/daemon/src/session-node-manager.ts:282` schema and
`:1931` plain INSERT; `core/daemon/src/daemon.ts:2526/2616` ownership check.)

**What WORKS today (for contrast — do not confuse):** one daemon hosting **multiple
identities** (registration of N agents — proven by `DOD-SPINE-4`), and one agent in
**multiple concurrent sessions with EXTERNAL counterparties** (different `session_id`s — the
SPINE-6 relay multiplex). The thing that does NOT work is **both ends of the SAME session on
one daemon** (the local loopback).

**Why it matters:** the user's stated UX vision is *one background daemon, two Claude
sessions each with the cello MCP client, two of their own agents conversing.* The two-daemon
setup used in the SPINE-6 *test* was a workaround for this keying limitation, **not** a design
requirement to run two daemons. So there is a real spec question: **is the local loopback a
deliverable?**

**The design decision to record (D-D1):**
- **Is the local two-agent loopback in scope for M7 (or a later milestone, or out)?**
- If IN: the fix is to **re-key the session-core by `(agent, session_id)`** instead of
  `session_id` alone — the `sessions` PRIMARY KEY (a Flyway/SQLite schema change), the
  `#activeNodes` map, the `#trees` map, and the ownership check. The daemon **already** has
  the agent context it needs (`connState.currentAgent`), so this is coherent. This is a
  **DB-migration + session-core story** (real story machinery — schema change).
- Note the trust nuance to record: when both parties are the same operator, CELLO's
  no-single-forge guarantees are degenerate (you trust yourself), but the **coordination**
  value (two of your agents talking over a structured, sealed channel) still holds. So it's a
  legitimate feature; weigh it accordingly.

**What to produce:** a discussion log recording D-D1 (in/out/later) with the re-key analysis;
if IN, a `CELLO-M7-SESSION-CORE-REKEY-001.yaml` story (schema migration + session-core keying
+ ownership check) and a DoD line. If OUT/LATER, a recorded decision so it doesn't resurface
ambiguously.

### GAP E — Agent-designation default: small UX gap (decide story vs fix).

**What's missing:** on a new MCP connection, `currentAgent` is `null` — even with exactly one
agent, the operator must explicitly `cello_start_agent` then `cello_use_agent` before any
outbound call. There is no default-agent auto-selection (`core/daemon/src/daemon.ts:919`).

**Why it matters:** the intended UX is *"if you only have one agent, that's the agent,"* plus a
switch tool (which exists: `cello_use_agent`). Only the **default** is missing.

**What to produce:** a short decision — is this a tiny direct fix (auto-select when exactly one
agent is online, or a configurable default-on-connect) or a small story? Either record it as a
note for the implementation thread (if trivial — direct fix) or a one-AC story (if it deserves
observability/edge ACs, e.g. what happens when the single agent isn't online yet). Likely a
**note for the implementation thread**, not a full story — your call, recorded.

---

## 3. Consolidated design decisions to record (so nothing is left implicit)

| ID | Decision | Default recommendation |
|----|----------|------------------------|
| D-B1 | Persistence: one DoD line or a journey? | Journey (`J-PERSIST`) |
| D-B2 | What's stored (transcript only vs + trust/endorsement records)? | Transcript first; trust records separate |
| D-B3 | Encryption at rest (SQLCipher) — in scope or precondition? | In scope of the persistence story |
| D-B4 | Reconcile with the in-memory eviction rule | Encrypted disk store ≠ reversing RAM-hygiene rule |
| D-C1..3 | Tier-5 REC-1/2/3: in (story) or out (recorded)? | REC-1 likely satisfied by PERSIST-012; decide 2/3 |
| D-D1 | Local two-agent loopback: in / later / out? | Record explicitly; if in, session-core re-key story |
| D-E1 | Agent-designation default: fix or story? | Note for implementation thread (likely a direct fix) |

Record each in a discussion log (`discussion_logs/YYYY-MM-DD_HHMM_<slug>.md`) with the
rationale. A decision with no record is a future ambiguity (M5 RC-1).

---

## 4. Hard rules for this session (do NOT violate)

- **No implementation code.** Docs only: story YAMLs, DoD edits, discussion logs, a journal
  entry. The other thread owns the code.
- **Do not run the live binary test** (`test:spine`) or any vitest — that's the
  implementation thread's loop, and the live cluster spawns heavy processes.
- **Do not merge to main. Do not push.** Both repos are on branch `m7-rehome`. Commit your
  doc changes locally on that branch. (If you spin a worktree, coordinate — but doc-only work
  on `m7-rehome` is fine; just don't touch files the implementation thread is editing in
  `core/daemon/` or `packages/`.)
- **Stay in `trustless-cello`** (this repo). All these artifacts live in
  `docs/planning/user-stories/m7/` and `docs/planning/discussion_logs/`.
- **Run `/cello-link` after adding docs** (wires new files into the Obsidian vault graph).
- **Respect the dead-stack rule:** any client-side AC targets the **daemon**, never
  `core/client`.

---

## 5. Deliverables checklist (what "done" looks like for this session)

- [ ] `CELLO-M7-UPGRADE-001.yaml` + `CELLO-M7-UPGRADE-002.yaml` written; `DOD-UP-1/2` flipped
      ⬜→❌ with story IDs noted.
- [ ] Persistence: discussion log (D-B1..4) + DoD additions (`DOD-LOG-*` / `J-PERSIST`) +
      `CELLO-M7-PERSIST-LOG-001.yaml` (per scope decision).
- [ ] Tier-5: `DOD-REC-1/2/3` decided (story IDs or recorded drops); DoD tags updated from ❓.
- [ ] Local-loopback decision recorded (D-D1); if IN, `CELLO-M7-SESSION-CORE-REKEY-001.yaml`
      + DoD line; if OUT/LATER, recorded.
- [ ] Agent-default decision recorded (D-E1) — note for the implementation thread or a tiny
      story.
- [ ] A `M7-BUILD-JOURNAL.md` entry summarizing what was authored/decided.
- [ ] `/cello-link` run; everything committed on `m7-rehome` (not pushed, not merged).

When these are done, the implementation thread can pick up Tier 4, Tier 5, and the
persistence journey with real specs to drive the live test against — and M7 has no silent
deferrals.
