---
name: M14B Procedure — How to Work the Milestone
type: procedure
date: 2026-08-11
milestone: M14B
status: open
topics: [m14b, multiplayer, collaborative-state, mesh, amendments, procedure, runbook, cello-client]
description: >
  The operating runbook for M14B (multiplayer documents — the amendment chain, admin governance,
  third-party join, fan-out delivery, mesh topology). SELF-CONTAINED — no other milestone's
  procedure needs to be read. Read FIRST, then M14B-DEFINITION-OF-DONE. Spec-of-record is the
  2026-08-10 multiplayer discussion log (§6, §9, §13, §14); §11/§16 of the 2026-07-31
  architecture log carry the topology derivations and the still-binding V1 decisions.
---

# M14B Procedure — How to Work the Milestone

## REALITY CHECK — read before anything
One user: Andre, also the only developer. CELLO is **alpha — no production, no real users.**
No backward compatibility is owed to anyone: all holders of a document upgrade together
(`feature_version` gives the older build a sentence, not a compatibility mode). Essentially no
documents exist — the migration window this milestone exploits is open exactly because of that,
and it closes the day a real workflow depends on a document. The feature is client-heavy: nearly
everything lands in **cello-client**, shipping via `/cello-publish` — that npm boundary is the one
external reach in the milestone.

## 🛑 THERE ARE EXACTLY TWO REASONS TO STOP AND HAND BACK TO ANDRE

**Everything else is a NOPE — do not stop for it. Keep working.**

1. **A manual operation only Andre can do, that blocks you.** (The npm `latest` promotion, a
   browser OAuth flow, `/mcp` reconnect.)
2. **A critical design decision that could cause harm, where you need his guidance.** A genuine
   fork where guessing wrong does damage. §13 of the multiplayer log settled the known forks —
   check it before deciding something is undecided.

**That is the whole list.** Check-ins, recaps, "should I keep going?", "natural stopping point" —
all NOPE. The durable record is the journal + commits, not messages to Andre. When you finish a
unit, pull the next one and keep going.

- **Never gate/hedge/ask permission on a CODE change.** Correctness + security fixes ship
  immediately.
- **DO pause for a GENUINE design fork** (materially different architectures) — in autonomous mode
  you PARK it (DoD "Explicitly beyond" or a journal-logged park), never block.

## 🎭 DECISION THEATRE — the failure mode INSIDE the two-stop rule

Carrying items for cycles as "waiting on Andre" is a soft stop that reads as diligence. The three
questions — all three must be NO for it to be yours:

1. **Does it reach OUTSIDE this system?** npm publish, a counterparty, a bill, a public claim.
   Local repos + local daemons + the dev consortium are not outside.
2. **Is it genuinely irreversible?** Not "destructive-sounding" — irreversible.
3. **Is it already authorized in writing?** §13 rulings are settled; re-asking one is the purest
   form of theatre. (So is re-raising unanimity vs admins, or whether removal can reach a local
   copy.)

Any YES → a real gate: **ask once, in one line, park it, never re-list it.** All NO → it is yours.
Do it, journal it, move on. REDO > ASK. Never bundle a real gate with fake ones.

## THE MILESTONE IN ONE PARAGRAPH
Ship **multiplayer documents**: a document's arrangement — who holds it, who administers it, what
its properties are — stops being frozen at creation and becomes amendable by signed consent. The
genesis proposal still hashes to `document_id`; after it, an **amendment chain** (each amendment a
signed epoch event, validated by per-kind signature requirements, replayed independently by every
holder) derives the current participant set. **Admins** (a meta-parameter set at creation) invite,
promote, and remove; removing an admin takes all the others; removal is **forward-only** — nobody
pretends to reach a local copy. A third party **joins** via an admin's amendment plus their own
consent handshake and receives the full document by log replay. **Delivery fans out**: every
holder authors and delivers its own edits to every other holder, acks tracked per holder, one
absent holder never blocking the rest, capped at 20. `topology: mesh` becomes real and default;
hub-and-spoke retires as a concept. Everything attestation-shaped (canonicalization, agreement,
purge, schema) stays parked in [[COLLAB-TIER2-DEFINITION-OF-DONE]] — **M14B builds the sockets
Tier 2 plugs into** (final-shape epoch record with a defined-absent hash slot, a generic
N-signature primitive, a pubkey-keyed participant spine) and must close able to say: Tier 2 will
rewrite nothing this milestone shipped. Spec-of-record:
[[2026-08-10_2116_multiplayer-artifacts-joining-an-existing-document]] (§6 mechanism, §9 phases,
§13 rulings, §14 constraints).

## 0a. Severity triage (spend effort top-down, never invert)
1. **TRUST-LAYER CORRECTNESS.** An amendment missing a required signature admitted ANYWHERE; two
   holders deriving different participant sets from the same chain; a removed holder's edits
   silently dropped instead of refused-on-the-record; a governance act that isn't attributable.
   Any of these silently wrong is critical — the amendment chain IS the trust product here.
2. **THE CORE JOURNEY.** Create with admins → invite → consent → join → everyone edits → fan-out
   → all N converge → seal. If this breaks, nothing else matters.
3. **THE AVAILABILITY CLAIM.** One holder offline; everyone else unaffected; the returner
   converges with zero agent attention. This is sovereign-node doctrine applied to documents —
   fallback is first-class, not operational polish.
4. **Real non-core gaps.** Removal ergonomics, amendment-lag handling, cap enforcement, topology
   refusal wording.
5. **Hardening / polish.**

## 0. Read order (every session)
1. This procedure.
2. [[M14B-DEFINITION-OF-DONE]] — lowest non-✅ line = next unit; Decisions Carried + Explicitly
   Beyond.
3. [[M14B-BUILD-JOURNAL]] — RESUME STATE block + last entries.
4. **Spec-of-record:** [[2026-08-10_2116_multiplayer-artifacts-joining-an-existing-document]] —
   §13 rulings first, then §6 (mechanism), §14 (Tier-2-readiness), §9 (phases), §11 (guards).
   Then [[2026-07-31_federated-collaborative-state-architecture]] for whatever V1 machinery the
   unit touches (§16 is still the V1 decision register and still binds).
5. [[COLLAB-TIER2-DEFINITION-OF-DONE]] before touching anything epoch- or signature-shaped — so
   Tier 2's eventual consumption of the socket is in mind while the socket is built.
Then start the loop (§2).

## 1. The artifacts
| Artifact | Role |
|---|---|
| **M14B-DEFINITION-OF-DONE** | The **yardstick + sole status authority** — ordered, status-tagged, carries Decisions Carried + Explicitly Beyond. Flip tags in place; one line of evidence + `→ Entry N`, never an essay. |
| **M14B-BUILD-JOURNAL** | The **audit trail + evidence home** — append-only, entries at END OF FILE, verified after writing (§1a). Full proofs, bug forensics, run output live HERE. |
| **COLLAB-TIER2-DEFINITION-OF-DONE** | Tier 2's parked yardstick (formerly M14B). If M14B work surfaces a Tier-2-shaped decision, it lands THERE, not in a journal aside. |
| **Four enforcers** (§1c) | governance · join · fan-out · removal. A behavioural DoD line naming an enforcer is ✅ only when that enforcer RAN as three separate OS processes. |

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
  daemon, the real store, the real three processes.
- **A design-doc unit gets ONE review pass; TWO is the hard cap.** At pass two, remaining
  findings become ACs on the units that build them.

## 1c. The four enforcers — defined here, named by DoD lines

All four are **multi-process spine tests** in
`trustless-cello/packages/e2e-tests/src/spine/`, extending `live-harness.ts` — which already
spawns the real published-shape cello-client binaries against a real N-node directory consortium
and relay. **Never a from-scratch fixture** — extend `session-fixture.ts`/the spine harness with
non-breaking `opts`. **All four run THREE daemons (A, B, C) as separate OS processes.** The reason
is on the record: every serious M14 defect was two processes disagreeing about what the third
would do, and no single-process test can have that disagreement.

1. **Governance enforcer** — creation with a limited admin set; a non-admin's invite refused by
   every holder independently; a proper invite + consent admitting; promotion; `remove_admin`
   invalid without ALL other admins and valid with them; all three daemons deriving identical
   {participants, admins, properties} at every step.
2. **Join enforcer** — a bilateral document with real history; C joins mid-life; C converges by
   replay to the full document; C's first edit reaches A AND B; `epoch_id` increments; sealing
   verifies on all three sides with document leaves.
3. **Fan-out enforcer** — B publishes while C is DOWN; B's daemon killed and restarted (pending
   derived from the log, not memory); A receives immediately, never blocked by C's absence; C
   returns and converges with zero agent attention anywhere.
4. **Removal enforcer** — C removed; C's copy intact and the removal surfaced to C's operator;
   C's next publish refused on-the-record by A and B with the removal-named reason; A and B keep
   converging.

Enforcers overlap deliberately: the join enforcer is the flagship; the others isolate the claims
that would otherwise hide inside it. A DoD line is ✅ only when its named enforcer ran green **as
separate OS processes** — vitest-green unit suites are necessary, never sufficient.

## 2. The core loop (one unit = one DoD line)
1. **Find the red** — lowest non-✅ DoD line in the active tier. Don't skip ahead.
2. **State the target** — one sentence of observable behavior, PLUS expand the full DoD line
   (every clause) into a clause checklist in the journal. That checklist is what the reviewer
   receives.
3. **Falsify first** (CLAUDE.md Debugging Discipline) — interface exposes the method?
   Responsibility lives here? What breaks elsewhere? Only then code.
4. **Red-first** — write the test, confirm it fails for the right reason, then implement. SPARC
   applies to every code unit (pseudocode citing the RFC for anything cryptographic — signing
   cites RFC 8032; tree work cites RFC 6962).
5. **Implement** — minimum change to green; nothing speculative.
6. **Floor holds** — `pnpm run test` → `lint` → `typecheck` → `build` in every touched repo,
   run so it can FAIL (§7).
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
- **cello-client** (`/Users/andrep/Documents/code/cello-client`) — **PRIMARY.** The amendment
  chain + store, the multi-signature primitive (`core/crypto`), the epoch record + wire types
  (`core/protocol-types`), governance validation, the join handshake, fan-out delivery and
  N-sender inbound (daemon), the `cello_doc_*` verb additions, plugin skills. **Ships via
  `/cello-publish` — LOAD THE SKILL, every publish, no exceptions**; never run the `latest`
  promotion (Andre runs it).
- **trustless-cello** (this repo) — the four spine enforcers in `packages/e2e-tests`, any
  relay/directory touch a traced seam demands, these docs. Re-pins published cello-client
  semvers — `workspace:*` for cello-client packages is a bug.
- **cello-portal / corp-cello-site — NOT in M14B** unless a DoD line says otherwise.

A unit that touches two repos states so in its journal checklist up front, and worktrees are
created in both. **Any unit that changes wire behaviour or crypto types lists the publish
cascade + trustless-cello re-pin as blocking ACs.**

## 2b. Reviewer dispatch — what the unit reviewer is TOLD
Supply: the DoD line VERBATIM (all clauses), the coder's clause checklist, the diff, the repo(s).

> ### 🚨 THE INVARIANTS LIVE HERE AS LENSES — they carry no DoD status tags
> Every lens fires on EVERY unit's diff, whether or not that unit's DoD line mentions it.

Standing M14B-specific lenses:
- **Adversary-owns-their-daemon lens (BLOCKING — Andre, 2026-08-12):** clients can rewrite their
  own daemons, so a guard that runs only on the party it constrains is not a guard. Every
  security-relevant check must be enforced by the OTHER parties' daemons (each verifying
  independently), or by the directory/relay. Sender-side checks are ergonomics; flag any
  security claim whose only enforcement point is code the adversary controls.
- **Amendment-validity lens (BLOCKING):** the arrangement derives ONLY from genesis + the chain;
  any path where an under-signed amendment is admitted, or where participant/admin state is read
  from anywhere but the replay, is critical. A missing signature is checkable — flag anything
  that makes it merely detectable.
- **Tier-2-readiness lens (BLOCKING), all four:** epoch record in final shape (hash slot
  defined-absent, never dropped); the signature primitive stays generic (amendment-specific
  tentacles are blocking); pubkey/`agent_id` keys everywhere structural (a display name in a key,
  join, or match is blocking); no new frame assumes one counterparty, and the join handshake
  carries `assurance_tier` + `feature_version`.
- **Forward-only-removal lens (BLOCKING):** any surface — code, tool description, error text,
  skill prose — claiming removal reaches a holder's copy is a blocking finding. Equally: a
  removed holder's envelope silently dropped rather than refused on the record.
- **Fan-out-availability lens (BLOCKING):** one unreachable holder must never block, delay, or
  fail delivery to the others; per-holder state derives from the log and survives restart. Flag
  any all-N assumption — it violates the sovereign-node invariant applied to documents.
- **Inherited M14 lenses, unweakened (BLOCKING where marked there):** no-silent-drop,
  injection-boundary (N peers' content is N injection surfaces), log-integrity,
  mechanical-admission, content-free-notification, seam. See [[M14-PROCEDURE]] §2b for their
  full text — they apply verbatim.
- Plus the standing project lenses: **spec fidelity** against §13/§14 (per-clause verdicts;
  silent simplification is BLOCKING), **error fidelity** (causes, not exit-point labels),
  **revert test** on every new test, **removal integrity** on any deletion, **stable-key joins**,
  **no `node:sqlite`** (SQLCipher only), **no mocks for crypto**, **injected logger +
  `document.*` event taxonomy + correlationId threading**.

## 2c. Publish sequencing
- cello-client changes reach operators only via `/cello-publish` — load the skill for EVERY
  publish; verify against the built tarball, not source (`rm -rf core/*/dist` before asserting
  absence — stale-dist orphans re-ship deleted files).
- **Wire-behaviour batching:** if TRACE-1 finds any relay/directory seam that must move, land and
  publish it BEFORE or WITH the first client that exercises it — one bilateral contract, one
  batch. Directory/relay rolls are per-node GCP; batch all pending changes into one push per
  fleet roll.
- All holders upgrade together; `feature_version` refusals are the compatibility story. Never
  build a dual-speak mode.

## 2d. Auditors — NOT USED in M14B
The unit reviewer's single pass + the four enforcers are the whole review surface.
`cello-done-auditor` is retired; do not dispatch it.

## 2e. Parallel work — branches, worktrees, and merge
- **One branch per unit, named `m14b/<unit>`**, pushed on creation.
- **🚨 COMMIT BY EXPLICIT PATH. NEVER `git add -A`.** Non-negotiable with a shared checkout.
- **A reviewed-green unit MERGES — it does not sit.** Rebase onto `main` at every session start
  for any branch older than a session.
- **Two branches must never touch the same file.** If they must, they are one unit.
- **Subagents stay READ-ONLY** (unit-reviewer, explorers) — never a parallel implementation agent
  inside one session.
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
to need reversing — §13 has probably already picked it; check there first — log it in the DoD
Decisions Carried section, proceed (redo > block, always). Genuine undecidable fork → PARK and
pull the next unit. **Exceptions that DO block (park the unit, work another):** the npm `latest`
promotion, `/mcp` reconnect.

## 3b. Watchdog cron — 30-min heartbeat (session-only; re-arm after every compaction/restart)
The defibrillator, not a metronome — if working, keep working. **The three checks that matter
most (Andre, 2026-08-11): the not-stopping rules (§🛑/§3a), committing often, and the unit
reviewer on every unit.** Fired prompt: (1) context check — THIS PROCEDURE mainly, the DoD's
status lines to a lesser extent, and only the journal's RESUME STATE block (never the full
journal); re-read + re-arm if dropped; (2) stalled on a decision? apply §3a; (3) blocked on a
human-only step? work a different line; (4) >15 min since commit? commit; (5) last unit
unreviewed? dispatch `cello-unit-reviewer` now, before the next line; (6) decision-theatre
check; (7) one status line. Self-terminate when all DoD tiers are ✅.

## 4. First actions (P0 order — strictly)
1. **DOD-MP-TRACE-1** — the confirm-first trace (the fan-out shape, the topology refusal sites,
   `epoch_id`'s producers/consumers, the property-immutability enforcement point, the consent
   handshake's join fit). Everything downstream is designed against what this finds, not what the
   log assumed.
2. **DOD-MP-SIG-1** — the multi-signature primitive (highest blast radius; two named consumers).
3. **DOD-MP-AMEND-1** — the amendment record + replay.
Then GOVERN-1, then P1.

## 5. Hard rules (non-negotiable)
- **ABSENT IS NOT FINE.** A guard with missing input REFUSES — loudly, naming its cause.
- **ERRORS NAME THEIR CAUSE, NOT THEIR EXIT POINT.**
- **NO CONSUMER, NO SHIP.** New fields/flags/events need a named consumer in the same unit —
  except the canonical-hash slot on the epoch record, whose consumer is Tier 2 BY DESIGN (§14
  constraint 1); it needs a serialization test instead. That is the only exception.
- **NO ARCHAEOLOGY COMMENTS.** Present tense, imperative; constraints the code can't show.
- **DEADNESS IS PROVEN BY DELETION** + both repos' gates; assert absence on BUILT artifacts.
- **DO NOT ESCALATE WHAT YOU CAN VERIFY. MEASURE BEFORE QUOTING A NUMBER.**
- **`node:sqlite` VERBOTEN** (SQLCipher only). **No mocks for crypto.** **No `console.log`** in
  implementation — injected logger, `document.noun.verb` events, correlationId threading;
  observability ACs are first-class on every unit.
- **Join on stable keys** — `agent_id`, `document_id`, envelope hashes, pubkeys. Never a mutable
  attribute. `agent_name` is display-only.
- **No paid SaaS. All URLs `*.cello.mygentic.ai`.**
- **Vitest: one worker, foreground, timeout, filtered.** Never background a test process.
- **NEVER `pkill -f cello-daemon`** — it kills the production daemon. Test daemons die by
  captured PID; the harness owns its processes.
- **Deferrals get a home** — DoD Explicitly Beyond (multiplayer-shaped) or
  [[COLLAB-TIER2-DEFINITION-OF-DONE]] (Tier-2-shaped) + journal. No silent deferral.

## 6. What a checkpoint/handoff entry contains
Which DoD lines are ✅ WITH enforcer-run output (not a claim); the exact next red + one-sentence
target; HEAD commits (all active repos); published package versions if any publish happened;
anything parked; anything that changes the DoD. Keep the RESUME STATE block at the top of the
journal up to date.

## 7. Gate discipline — run it so it can FAIL
M14 found a gate piped through `grep`, whose exit status is grep's — the chain proceeded on red
trees. Run gates so a failure stops the chain:

```
set -o pipefail        # or: capture to a file and check $?
pnpm run test > /tmp/gate.log 2>&1; echo "exit=$?"
```

Read the exit code, not the tail of the output. A check whose failure mode is "still reports
success" launders a red tree into a green claim.

---

## Related Documents
- [[M14B-DEFINITION-OF-DONE]] — yardstick + sole status authority
- [[M14B-BUILD-JOURNAL]] — audit trail
- [[2026-08-10_2116_multiplayer-artifacts-joining-an-existing-document]] — spec-of-record
- [[2026-07-31_federated-collaborative-state-architecture]] — V1 derivations + §16 register
- [[COLLAB-TIER2-DEFINITION-OF-DONE]] — the parked Tier 2 wave (formerly M14B)
- [[M14-PROCEDURE]] — the procedure this one is modeled on; its §2b lenses are inherited verbatim
