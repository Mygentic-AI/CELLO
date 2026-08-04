---
name: M14 Procedure — How to Work the Milestone
type: procedure
date: 2026-08-04
milestone: M14
status: open
topics: [m14, collaborative-state, crdt, yjs, documents, procedure, runbook, cello-client]
description: >
  The operating runbook for M14 (federated collaborative state V1 — Yjs documents over pairwise
  sessions: write path, handshake, validation gate, daemon-autonomous delivery, lifecycle verbs,
  0x04/0x05 leaves). SELF-CONTAINED — no other milestone's procedure needs to be read. Read FIRST,
  then M14-DEFINITION-OF-DONE. Spec-of-record is §16 of the 2026-07-31 federated collaborative
  state architecture log; the rest of that log carries the derivations.
---

# M14 Procedure — How to Work the Milestone

## REALITY CHECK — read before anything
One user: Andre, also the only developer. CELLO is **alpha — no production, no real users.**
No backward compatibility is owed to anyone (decided 2026-08-04, §16.7 item 8): both sides of a
document upgrade together. The feature is client-heavy: nearly everything lands in **cello-client**,
which ships to operators via `/cello-publish` — that boundary (npm) is the one external reach in
the milestone.

## 🛑 THERE ARE EXACTLY TWO REASONS TO STOP AND HAND BACK TO ANDRE

**Everything else is a NOPE — do not stop for it. Keep working.**

1. **A manual operation only Andre can do, that blocks you.** (Examples: the npm `latest`
   promotion, a browser OAuth flow, `/mcp` reconnect, the screening-audit go — Andre deferred it
   explicitly and will call it.)
2. **A critical design decision that could cause harm, where you need his guidance.** A genuine
   fork where guessing wrong does damage. §16 settled the known forks — check it before deciding
   something is undecided.

**That is the whole list.** Check-ins, recaps, "should I keep going?", "natural stopping point" —
all NOPE. The durable record is the journal + commits, not messages to Andre. When you finish a
unit, pull the next one and keep going.

- **Never gate/hedge/ask permission on a CODE change.** Correctness + security fixes ship
  immediately.
- **DO pause for a GENUINE design fork** (materially different architectures) — in autonomous mode
  you PARK it (DoD "Parked" section + journal), never block.

## 🎭 DECISION THEATRE — the failure mode INSIDE the two-stop rule

Carrying items for cycles as "waiting on Andre" is a soft stop that reads as diligence. The three
questions — all three must be NO for it to be yours:

1. **Does it reach OUTSIDE this system?** npm publish, a counterparty, a bill, a public claim.
   Local repos + local daemons + the dev consortium are not outside.
2. **Is it genuinely irreversible?** Not "destructive-sounding" — irreversible.
3. **Is it already authorized in writing?** §16 decisions are settled; re-asking one is the purest
   form of theatre.

Any YES → a real gate: **ask once, in one line, park it, never re-list it.** All NO → it is yours.
Do it, journal it, move on. REDO > ASK. Never bundle a real gate with fake ones.

## THE MILESTONE IN ONE PARAGRAPH
Ship **federated collaborative documents, V1 (Tier 1 — authenticated)**: two agents co-edit a
shared artifact (Markdown, text, JSON, XML, source) over their pairwise session, each staying a
sovereign mind. The document is a **real file** the agent edits with ordinary tools; the daemon
diffs it at publish into Yjs updates that ride ordinary signed/chained/sealed messages as new
`0x04` leaves (rejections are `0x05`). Incoming updates pass a **shadow-document validation gate**
(screening; append-only; limits) — rejected updates quarantine and resolve by **supersession**,
never silent drop. The handshake mirrors attestation consent; delivery is **daemon-autonomous and
presence-driven** (publish is fire-and-forget; daemons sync overnight with zero agent attention);
notification is a content-free pending flag. Lifecycle verbs: list, close, kill, withdraw. Tier 2
(canonical hashing, epochs, quiescence agreement, purge, schema enforcement) is **M14B, parked** —
V1 carries the seam only (`assurance_tier`/`schema_enforcement` declared, `epoch_id: 0`,
`doc_prev_hash`, nullable payload column). Spec-of-record:
[[2026-07-31_federated-collaborative-state-architecture]] **§16** (the decision register); the
rest of that log is the derivation.

## 0a. Severity triage (spend effort top-down, never invert)
1. **TRUST-LAYER CORRECTNESS.** No silent drop (every rejection is a `0x05` leaf + supersession);
   peer content never enters the LLM's context unfetched; the envelope log is append-only and the
   per-sender `doc_prev_hash` chain verifies; seals containing document leaves verify on both
   sides. Any silent violation is critical — this is the trust product itself.
2. **THE CORE JOURNEY.** Create → consent → edit the file → publish → daemon delivers → peer's
   file updates → pending flag → diff → fetch → session seals with mixed leaf types. If this
   breaks, nothing else matters.
3. **THE ASYNC CLAIM.** Publish while the peer is offline → sender daemon restarts → peer comes
   online → the update arrives with no agent attention on either end. This is the product claim
   ("your agents sync overnight") and it is what kills the in-memory-queue bug class.
4. **Real non-core gaps.** Withdraw, kill, stall handling, sender-side advisory scan, limits.
5. **Hardening / polish.**

## 0. Read order (every session)
1. This procedure.
2. [[M14-DEFINITION-OF-DONE]] — lowest non-✅ line = next unit; Decisions + Parked sections.
3. [[M14-BUILD-JOURNAL]] — last entries (create it at the first unit if absent).
4. **Spec-of-record**: [[2026-07-31_federated-collaborative-state-architecture]] §16 first, then
   the section the unit touches (§3.2 validation, §4 update flow, §5 publishing, §9 leaves,
   §14 implementation notes). [[2026-05-08_1612_shared-state-as-protocol-primitive]] is
   superseded — use for *why*, never for *what* (§12 has the reconciliation table).
5. [[M14B-DEFINITION-OF-DONE]] (parked) before touching anything seam-shaped — so V2's shape is
   in mind when building V1's seam lines.
Then start the loop (§2).

## 1. The artifacts
| Artifact | Role |
|---|---|
| **M14-DEFINITION-OF-DONE** | The **yardstick + sole status authority** — ordered, status-tagged, carries Decisions + Parked. Flip tags in place; one line of evidence + `→ Entry N`, never an essay. |
| **M14-BUILD-JOURNAL** | The **audit trail + evidence home** — append-only, entries at END OF FILE, verified after writing (§1a). Full proofs, bug forensics, run output live HERE. |
| **M14B-DEFINITION-OF-DONE** | V2's parked yardstick. Carries no status tags until it activates. If V1 work surfaces a V2-shaped decision, it lands there, not in a journal aside. |
| **Five enforcers** (§1c) | convergence · offline-delivery · rejection · append-only · write-path. A behavioural DoD line naming an enforcer is ✅ only when that enforcer RAN. |

## 1a. Journal writing — APPEND AT EOF, THEN VERIFY
M12 lost 10 of its first 25 entries to prepend-anchored scripted edits that silently no-op'd.
1. A new entry is **appended at end of file** — never prepended, never inserted. The RESUME STATE
   block at the top is the only thing overwritten in place.
2. **Verify the write landed** (`grep -c "^## Entry N"` or read the tail) immediately after.
3. Chronological order is not worth a lost entry; an out-of-order number at EOF is fine.
4. The commit message is a backup, not the home.

## 1b. Document discipline
- **A DoD line is a status tag, one line of evidence, and `→ Entry N`.** Cap any status
  blockquote at ~5 lines; longer belongs in the journal with a pointer.
- **Supersession history lives ONLY in the journal.** A DoD line names the CURRENT shape.
- **A decision on its THIRD rewrite gets MEASURED, not rewritten** — run it against the real
  daemon, the real relay, the real file on disk.
- **A design-doc unit gets ONE review pass; TWO is the hard cap.** At pass two, remaining
  findings become ACs on the units that build them.

## 1c. The five enforcers — defined here, named by DoD lines

All five are **multi-process spine tests** in
`trustless-cello/packages/e2e-tests/src/spine/`, extending `live-harness.ts` — which already
spawns the real published-shape cello-client binaries (`provisionAgent`, `startDaemon`,
`registerAgent`, `connectMcp`, `ipcCall`) against a real N-node directory consortium and relay.
**The template is `j-unilateral.spine.test.ts`** (3-node consortium + signed manifest in
`beforeAll`; `setupAtoBSession` drives two full daemons A↔B). Never a from-scratch fixture.

1. **Convergence enforcer** — A creates a document, B consents; both edit their local FILES
   (including one deliberately overlapping region); both publish; both files converge to the same
   content; the overlap flag fires on the diff-stats call; the session seals and BOTH sides
   independently recompute the same root over mixed `0x00`/`0x02`/`0x04` leaves.
2. **Offline-delivery enforcer** — A publishes while B's daemon is DOWN; **A's daemon is then
   killed and restarted** (the queue must survive from the envelope log, not memory); B's daemon
   starts; the update arrives and B's file materializes it — with zero agent-level action on
   either side. The pending flag is set on B.
3. **Rejection enforcer** — B's receive gate rejects an update (limit or append rule;
   screening plugs into the same gate when DOD-DOC-SCREEN-1 unblocks);
   the update quarantines (never admitted, never dropped); a `0x05` leaf is recorded referencing
   the rejected envelope; A's daemon rolls back and publishes the superseding update; B admits it
   and both sides converge; both policy logs show the rejection with its reason. Second half:
   the supersession is ALSO rejected → one retry → the document flips to **stalled** and both
   operators can see why.
4. **Append-only enforcer** — on an `append_only: true` document, an update whose projected diff
   deletes or edits existing content is rejected at the gate and resolved by supersession; an
   append converges normally.
5. **Write-path enforcer** — the file round-trip at the tool surface: agent edits the file →
   `publish` → peer's daemon rewrites the peer's file → peer's agent sees pending → diff-stats →
   diff → content matches; then `withdraw` on an undelivered update rolls the sender's file back
   and writes the withdrawal record.

Enforcers overlap deliberately: 1 is the flagship, 2–5 isolate the claims that would otherwise
hide inside it. A DoD line is ✅ only when its named enforcer ran green **as separate OS
processes** — vitest-green unit suites are necessary, never sufficient.

## 2. The core loop (one unit = one DoD line)
1. **Find the red** — lowest non-✅ DoD line in the active tier. Don't skip ahead.
2. **State the target** — one sentence of observable behavior, PLUS expand the full DoD line
   (every clause) into a clause checklist in the journal. That checklist is what the reviewer
   receives.
3. **Falsify first** (CLAUDE.md Debugging Discipline) — interface exposes the method?
   Responsibility lives here? What breaks elsewhere? Only then code.
4. **Red-first** — write the test, confirm it fails for the right reason, then implement. SPARC
   applies to every code unit (pseudocode citing the RFC for anything cryptographic — the leaf
   work cites RFC 6962; signing cites RFC 8032).
5. **Implement** — minimum change to green; nothing speculative.
6. **Floor holds** — `pnpm run test` → `lint` → `typecheck` → `build` in every touched repo.
7. **Commit** (constantly — §3), push after every commit.
8. **Review — ONE read-only `cello-unit-reviewer` on the unit's diff, no model override.**
   Dispatch per §2b. Fix EVERY finding; commit fixes.
9. **Update docs** — flip the DoD tag (+ one-line evidence + journal pointer), journal entry.
10. **Merge the branch** (§2e) — a reviewed-green unit does not sit on a branch.
11. Back to 1.

> ### 🚨 "REVIEW IN FLIGHT" IS NOT A CLOSING STATE
> **DONE = written AND reviewed. IMPLEMENTED = written, not yet reviewed.** A tag flips only when
> the reviewer's verdict is QUOTED in the journal entry — finding count and disposition, in the
> reviewer's own words. An entry that ends with a review outstanding says so in its heading, and
> the unit stays 🟡.

## 2a. Repos — where work lands
- **cello-client** (`/Users/andrep/Documents/code/cello-client`) — **PRIMARY repo for this
  milestone.** The daemon (document store, write path, delivery, validation gate, lifecycle),
  `core/crypto` (the `LeafInput` union gains the new kinds — everything downstream depends on
  it), `core/protocol-types` (envelope fields, handshake frames), the connect/adapter tool
  surface (`cello_doc_*`), and the plugin skills. **Ships via `/cello-publish` — LOAD THE SKILL,
  every publish, no exceptions**; never run the `latest` promotion (Andre runs it). Yjs joins as
  a production dependency: confirm pure-JS, no native compile, and state the install cost once
  (heavy-local-node doctrine).
- **trustless-cello** (this repo) — the relay `leaf_kind` allow-list + its guard-test amendment,
  the directory-side leaf handling (unknown-byte rejection, ceremony-vs-doc ctrl discrimination),
  the five spine enforcers in `packages/e2e-tests`, and these docs. Re-pins published cello-client
  semvers — `workspace:*` for cello-client packages is a bug.
- **cello-portal / corp-cello-site — NOT in M14.** The gallery does no Merkle verification
  (verified 2026-08-04) and is untouched unless a DoD line says otherwise.

A unit that touches two repos states so in its journal checklist up front, and worktrees are
created in both. **Any unit that changes wire behaviour or crypto types lists the publish
cascade + trustless-cello re-pin as blocking ACs.**

## 2b. Reviewer dispatch — what the unit reviewer is TOLD
Supply: the DoD line VERBATIM (all clauses), the coder's clause checklist, the diff, the repo(s).

> ### 🚨 THE SIX INVARIANTS LIVE HERE AS LENSES — they carry no DoD status tags
> An invariant is a property every unit must not violate. You never *build* one, so it cannot be
> a deliverable and never carries a tag. Every lens below fires on EVERY unit's diff, whether or
> not that unit's DoD line mentions it.

Standing M14-specific lenses:
- **No-silent-drop lens (BLOCKING):** every path that declines an incoming update must quarantine
  it and emit the rejection (`0x05` + reason + policy log). Any path where an update is discarded,
  skipped, or "logged and ignored" — including error paths — is a critical finding, because it
  diverges the two copies permanently and invisibly (§3.2).
- **Injection-boundary lens (BLOCKING):** peer-controlled document content must never enter the
  LLM's context by arriving — only by an explicit agent-initiated fetch. The notification and
  diff-STATS calls are content-free; flag any field that quotes changed lines, any doorbell that
  embeds content, any error message that echoes payload text into the agent's transcript.
- **Log-integrity lens (BLOCKING):** the envelope log is append-only (withdrawals and
  rejections are new records, never edits); `doc_prev_hash` chains verify; publish WRITES THE
  ENVELOPE FIRST and delivery reads from the log (§14) — flag any in-memory queue that is the
  only home of an unacknowledged update, and any delivery state that would not survive a daemon
  restart.
- **Mechanical-admission lens (BLOCKING):** admission, merge, file rewrite, delivery, and the
  autonomous delivery session involve NO LLM on either side. Flag anything that gates the merge
  on agent attention, and anything that requires the receiving agent to act for convergence.
- **Content-free-notification lens:** the pending notification carries `document_id` and nothing
  else. Diff stats carry counts, ranges, and the overlap flag — no content.
- **Seam lens (V2-protection):** handshake declares `assurance_tier` (only `authenticated`
  accepted) + `schema_enforcement` (only `false` accepted); every envelope carries
  `epoch_id` (0) + `doc_prev_hash`; the payload column is nullable; unknown leaf types hash as
  opaque bytes wherever verification walks a tree. Flag any unit that drops a seam field
  "because V1 doesn't use it" — the seam is the point.
- Plus the standing project lenses: **spec fidelity** against §16 (per-clause verdicts; silent
  simplification is BLOCKING), **error fidelity** (causes, not exit-point labels), **revert
  test** on every new test, **removal integrity** on any deletion, **stable-key joins**
  (`agent_id`/`document_id`, never names), **no `node:sqlite`** (SQLCipher only), **no mocks for
  crypto**, **injected logger + `document.*` event taxonomy + correlationId threading**.

## 2c. Publish sequencing (this milestone's deploy discipline)
- cello-client changes reach operators only via `/cello-publish` — load the skill for EVERY
  publish; verify against the built tarball, not source (stale-dist orphans re-ship deleted
  files: `rm -rf core/*/dist` before asserting absence).
- **Wire-behaviour batching:** the relay/directory leaf changes and the client leaf changes are
  one bilateral contract — land and publish them within one unit so no published client speaks
  `0x04` to a relay that refuses it. The relay allow-list ships BEFORE or WITH the first client
  that submits a `0x04` leaf, never after.
- Directory deploys still cost ~25–30 min AWS-side / per-node GCP-side — batch all pending
  directory/relay changes into one push per fleet roll.

## 2d. `cello-done-auditor` — NOT USED in M14
M12's standing exception was structural: its claims were about live cloud state a diff cannot
show. M14's claims are about process behaviour, which the enforcers prove directly. The unit
reviewer's single pass + the five enforcers are the whole review surface. Do not dispatch the
auditor.

## 2e. Parallel work — branches, worktrees, and merge
- **One branch per unit, named `m14/<unit>`**, pushed on creation.
- **🚨 COMMIT BY EXPLICIT PATH. NEVER `git add -A`.** Non-negotiable with a shared checkout.
- **A reviewed-green unit MERGES — it does not sit.** Rebase onto `main` at every session start
  for any branch older than a session.
- **Two branches must never touch the same file.** If they must, they are one unit.
- **Subagents stay READ-ONLY** (unit-reviewer, explorers) — never a parallel implementation agent
  inside one session. Parallel coders on separate story branches are allowed under these rules.
- Client-side DB schema changes: the daemon's migration mechanism is client-side and failures are
  unrecoverable on operator machines — every migration unit tests the upgrade path against a
  populated pre-migration database, not just a fresh one.

## 3. Cadence
- **Commit constantly** — never >~15 min without one; push after every commit. Docs commit to
  main.
- **Review every unit** on its diff, right after green. Never batch reviews.
- **Checkpoint at every tier boundary:** journal summary, commit, verify every ✅ in the tier
  names its enforcer run.

## 3a. Autonomous-mode rules (if running unattended)
NEVER `AskUserQuestion`, never end a turn waiting. Decision rubric: pick the choice least likely
to need reversing — §16 has probably already picked it; check there first — log it in the DoD
Decisions section, proceed (redo > block, always). Genuine undecidable fork → PARK and pull the
next unit. **Exceptions that DO block (park the unit, work another):** the npm `latest`
promotion, the screening-audit go, `/mcp` reconnect.

## 3b. Watchdog cron — 30-min heartbeat (session-only; re-arm after every compaction/restart)
The defibrillator, not a metronome — if working, keep working. Fired prompt: (1) procedure/DoD/
journal in context? re-read + re-arm if dropped; (2) stalled on a decision? apply §3a;
(3) blocked on a human-only step? work a different line; (4) >15 min since commit? commit;
(5) last unit unreviewed? dispatch now; (6) decision-theatre check — carrying anything as
"waiting on Andre"? Run the three questions; (7) one status line. Self-terminate when all DoD
tiers are ✅.

## 4. First actions (P0 order — strictly)
1. **DOD-DOC-LEAF-1** — the `LeafInput` union + the cross-repo leaf allow-lists (highest blast
   radius; everything downstream depends on it).
2. **DOD-DOC-FUZZ-1** — the Yjs hostile-input fuzz pass (measures the §16.7-7 residual risk
   before the gate is designed around it).
3. **DOD-DOC-STORE-1** — the three-table SQLCipher store + envelope log.
Then P1 (the document engine), which can interleave with P0's publish waits.

## 5. Hard rules (non-negotiable)
- **ABSENT IS NOT FINE.** A guard with missing input REFUSES — loudly, naming its cause.
- **ERRORS NAME THEIR CAUSE, NOT THEIR EXIT POINT.**
- **NO CONSUMER, NO SHIP.** New fields/flags/events need a named consumer in the same unit —
  except the five seam fields (§2b seam lens), whose consumer is M14B by design; they need a
  serialization test instead.
- **NO ARCHAEOLOGY COMMENTS.** Present tense, imperative; constraints the code can't show.
- **DEADNESS IS PROVEN BY DELETION** + both repos' gates; assert absence on BUILT artifacts.
- **DO NOT ESCALATE WHAT YOU CAN VERIFY. MEASURE BEFORE QUOTING A NUMBER.**
- **`node:sqlite` VERBOTEN** (SQLCipher only). **No mocks for crypto.** **No `console.log`** in
  implementation — injected logger, `document.noun.verb` events, correlationId threading;
  observability ACs are first-class on every unit.
- **Join on stable keys** — `agent_id`, `document_id`, envelope hashes. Never a mutable
  attribute. `agent_name` is display-only.
- **No paid SaaS. All URLs `*.cello.mygentic.ai`.**
- **Vitest: one worker, foreground, timeout, filtered.** Never background a test process.
- **NEVER `pkill -f cello-daemon`** — it kills the production daemon. Test daemons die by
  captured PID; the harness owns its processes.
- **Deferrals get a home** — DoD Parked (V1-shaped) or the M14B DoD (V2-shaped) + journal. No
  silent deferral.

## 6. What a checkpoint/handoff entry contains
Which DoD lines are ✅ WITH enforcer-run output (not a claim); the exact next red + one-sentence
target; HEAD commits (all active repos); published package versions if any publish happened;
anything parked; anything that changes the DoD. Keep the RESUME STATE block at the top of the
current journal file up to date.

---

## Related Documents
- [[M14-DEFINITION-OF-DONE]] — yardstick + sole status authority
- [[M14B-DEFINITION-OF-DONE]] — V2's parked yardstick
- [[2026-07-31_federated-collaborative-state-architecture]] — spec-of-record (§16 = decisions)
- [[2026-05-08_1612_shared-state-as-protocol-primitive]] — superseded May design (the why)
- [[M12-PROCEDURE]] — the procedure this one is modeled on
