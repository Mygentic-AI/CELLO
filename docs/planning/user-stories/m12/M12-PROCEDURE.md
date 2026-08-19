---
name: M12 Procedure — How to Work the Milestone
type: procedure
date: 2026-08-19
milestone: M12
status: open
topics: [m12, gcp, migration, multi-cloud, anti-entropy, role-split, infrastructure, relay, procedure, runbook]
description: >
  The operating runbook for M12 (multi-cloud rebuild — GCP nodes, anti-entropy sync,
  full-node/validator role split, CI on Cloud Build, and the ongoing integrity of the connections
  between deployed infrastructure). SELF-CONTAINED — no other milestone's procedure needs to be
  read. Read FIRST, then M12-DEFINITION-OF-DONE. Spec-of-record is the 2026-07-28 GCP rebuild
  decision record; derivations live in the superseded 2026-07-25 log.
  REFRESHED 2026-08-19 against M12B-PROCEDURE, which is the current shape. Four things were stale
  and actively wrong to follow: `cello-done-auditor` was still mandated here after being retired
  everywhere (§2d, §2 step 8, §3); the AWS protocol stack it gates on was DELETED on 2026-08-06;
  there was no gate-discipline section, so a gate piped through `grep` could launder a red tree;
  and the relay fleet roll — which reaches outside this system — carried no rule. Tier P5 is added
  for relay↔directory connection integrity.
---

# M12 Procedure — How to Work the Milestone

## REALITY CHECK — read before anything
One user: Andre, also the only developer. CELLO is **alpha — no production, no real users.**
Total data loss on the DATA is not merely acceptable, it was **the plan** — this milestone began as
a rebuild from zero.

**That changed on 2026-08-06 and the difference governs how you work now.** The rebuild landed. The
GCP fleet is the only protocol stack that exists — the AWS directory, relay, database, pipelines,
ops-agent and dashboard were **deleted**, not hibernated. So M12's remaining work is no longer
"stand it up where nothing is running"; it is **change a fleet that is the only thing running**, one
node at a time, while agents are using it. A mistake now is an outage, not a redo.
`infra/GCP-STATE.md` is authoritative; read it before any unit that touches deployed state.

## 🛑 THERE ARE EXACTLY TWO REASONS TO STOP AND HAND BACK TO ANDRE

**Everything else is a NOPE — do not stop for it. Keep working.**

1. **A manual operation only Andre can do, that blocks you.** You cannot proceed in some area until he does it. (Examples: the npm `latest` promotion, a browser OAuth flow, `/mcp` reconnect, **a relay or directory fleet roll** — see §2c.)
2. **A critical design decision that could cause harm, where you need his guidance.** A genuine fork where guessing wrong does damage.

**That is the whole list.** If what you're about to write is not one of these two, it is a NOPE — do not send it, keep working:
- Check-ins ("here's where I am") → **NOPE.**
- Recaps / session tallies ("this session delivered…") → **NOPE.**
- Telling him about the future / what you *may* need later → **NOPE.**
- "Should I keep going?" / "want me to start X?" → **NOPE** (the answer is always yes — start it).
- "This is a natural stopping point" / "I've done a lot" → **NOPE.** Length is never a reason to stop.
- "This deserves a deliberate/fresh start" → **NOPE.** Be careful, don't stop. Careful ≠ handing back.

The durable record is the journal + commits, not messages to Andre. Report progress by committing, not by writing him. When you finish a unit, pull the next one and keep going. Only surface when you hit reason 1 or reason 2 — and then say ONLY that, in one or two lines.

- **Never gate/hedge/ask permission on a CODE change.** Correctness + security fixes ship immediately.
- **Do not invent decisions for Andre.** "Should I do this code work?" is always yes.
- **DO pause for a GENUINE design fork** (materially different architectures) — in autonomous mode
  you PARK it (DoD "Parked" section + journal), never block.
- **READ-ONLY GCP inspection is AUTHORIZED and expected** inside `cello-infra` — `gcloud logging
  read`, `terraform plan`, describing instances. Do not escalate what you can verify.
- **A GCP change that RESTARTS or REPLACES a running node is not a code change** and does not ship
  on the same reflex. It rolls node by node, and it is stop-reason 1 in autonomous mode (§3a).
  Creating disposable resources, IaC edits, and anything that does not disturb a serving node stay
  yours.
- **`infra/GCP-STATE.md` updates IMMEDIATELY after every GCP change — never batched.**
- **AWS is not part of this milestone any more.** The protocol stack was deleted 2026-08-06. What
  remains on AWS is the waitlist, the portal RDS, SES (which still sends the GCP registration OTP),
  Route 53 and NAT — `infra/STATE.md` covers those and is otherwise SUPERSEDED. `infra/deploy.sh`,
  `infra/cloudformation/` and `infra/buildspecs/` deploy stacks that no longer exist: seeing a
  deploy script is not evidence it is the deploy path.

## 🎭 DECISION THEATRE — the failure mode INSIDE the two-stop rule (added 2026-07-31)

The rule above says do not STOP. The way it actually gets violated is subtler: you keep working, and
every few cycles you re-surface the same items as "waiting on Andre." That is a soft stop. It costs a
whole heartbeat cycle each time, produces nothing, and reads as diligence — which is why it survives.

**Measured, 2026-07-31.** Four items were carried for hours as "waiting on you." Andre's verdict:
*"This really seems like decision theatre. You know that you're working solo on GCP and these didn't
require AWS and didn't affect the current system. Honestly, I don't know why you stopped for these."*
He was right on three of the four:
- **A GCP fleet deploy.** Declined ONCE (correctly — never re-run a declined command), then re-listed
  as blocked for hours instead of asking plainly a second time.
- **Deleting NULL-`agent_id` rows** that were my OWN throwaway enforcer agents, on an alpha fleet with
  zero users. Treated as if it were live customer data.
- **A migration-ordering question** listed as needing him, then self-corrected one message later as not
  needing him at all.
Only the fourth (an npm publish, which reaches operators) was a real gate.

### The three questions. All three must be NO for it to be yours.

1. **Does it reach OUTSIDE this system?** npm, a counterparty, a customer, a bill, a public claim,
   someone else's machine. Internal GCP + local + this repo is not outside. **A roll that restarts
   a serving relay or directory IS outside** — it is the fleet real agents are talking through, and
   since 2026-08-06 there is no second stack behind it.
2. **Is it genuinely irreversible?** Not "destructive-sounding" — irreversible. Deleting rows you
   created, on an alpha fleet with no users, that anti-entropy will re-replicate, is not.
3. **Is it already authorized in writing?** §Reality Check authorizes GCP actions inside `cello-infra`.
   §2e says a reviewed-green unit merges. §3a says pick and log. Re-asking a settled authorization is
   the purest form of this.

Any YES → it is a real gate. **All NO → it is yours. Do it, journal it, move on.**

### The rules that follow

- **ASK ONCE, IN ONE LINE, THEN PARK IT.** If it is a real gate, say so once — then it goes to the DoD
  Parked section and you never mention it again until he answers. Re-listing is the theatre.
- **A DECLINED command is not a standing block.** Do not re-run it; do ask once, plainly, why or
  whether to proceed. Silence is not a refusal renewed every 30 minutes.
- **REDO > ASK**, the same way redo > block. On internal alpha work with a green gate, doing it wrong
  costs one redo; asking costs a cycle and often gets "why did you stop for that?".
- **Check which mental model you imported.** "Destructive", "live data", "published package",
  "migration cost" are real brakes in a production system with customers. This has one user, no
  customers, and total data loss is the milestone plan. A brake that would be right somewhere else is
  not right here just because it sounds responsible.
- **Never bundle a real gate with fake ones.** Four items presented together, three of them yours,
  makes the one that matters harder to see and trains him to skim the list.

## THE MILESTONE IN ONE PARAGRAPH
Rebuild CELLO at the launch topology and then keep it standing. **N=3 directories** — `gcp-use1`
(us-east1), `gcp-usc1` (us-central1), `gcp-euw1` (europe-west1) — with **T = majority(validators)
= 2**, two relays (`use1`, `euw1`), and the Postgres replication mesh **retired** in favour of
**libp2p anti-entropy** (no VPN, no PSA, ever). The **full-node/validator role split** ships here
(manifest `role` field; replicas hold no shares and never enter threshold arithmetic). Nodes run as
**MIG(size 1) + Container-Optimized OS with Cloud SQL per node**; CI is **Cloud Build + Artifact
Registry**. Wave 1 (GCP standalone) is done and the AWS stack was deleted 2026-08-06, which makes
Tiers P3/P4 historical — read them for the decisions, not for work.
**What M12 still owns is the part the rebuild exposed: the connections BETWEEN the deployed pieces.**
A directory reaching its peers, a relay reaching a directory, a client reaching either. These are
long-lived libp2p connections held for a process's whole life across a fleet that runs for days, and
they are where the rebuilt system actually fails — not in the ceremonies, which work. **Tier P5**
carries that. Spec-of-record: [[2026-07-28_0700_gcp-rebuild-decision-record]] for the topology;
per-unit evidence lives in the journal.

## 0a. Severity triage (spend effort top-down, never invert)
1. **CONSORTIUM CORRECTNESS.** Threshold arithmetic over validators only; kill-switch convergence
   (suspended wins); shares never leave a node; no two manifest entries with one FROST identifier.
   Any silent violation is critical — this is the trust product itself.
2. **THE CORE JOURNEY.** Fresh register → DKG → seal → live two-agent session → kill a directory →
   sealing continues → client failover. If this breaks on the rebuilt system, nothing else matters.
3. **A CONNECTION THAT DIES AND STAYS DEAD.** The fleet runs for days; a libp2p connection does
   not. Anything where a held connection can go unusable and no code path restores it, or where a
   repair runs and cannot work, ranks here — because the failure is silent, fleet-wide, and only
   ever surfaces as some unrelated verb timing out. **Sealing is the current instance** (Tier P5)
   and it is launch-blocking: a notary that intermittently cannot notarize has not delivered its
   basic value.
4. **Real non-core gaps.** CI polish, IaC completeness, alerting on the signals we already emit.
5. **Hardening / polish.**

## 0. Read order (every session)
1. This procedure.
2. [[M12-DEFINITION-OF-DONE]] — lowest non-✅ line = next unit; Decisions + Parked sections.
3. [[M12-BUILD-JOURNAL]] — last entries.
4. **Spec-of-record**: [[2026-07-28_0700_gcp-rebuild-decision-record]]. Derivations and rejected
   alternatives: [[2026-07-25_1034_gcp-relay-and-directory-deployment-plan]] (superseded — use for
   *why*, never for *what*). Anti-entropy/role-split units also read the M8B plan
   (quorum registration, enrollment deferral) before touching consortium code.
5. **`infra/CLAUDE.md` before ANY infrastructure unit** — it carries the rules that have already
   cost outages. **`infra/GCP-STATE.md`** before any unit that touches deployed state; it is the
   authoritative record and you update it immediately after every change. `infra/STATE.md` is AWS
   and SUPERSEDED — it covers only the waitlist, portal RDS, SES, Route 53 and NAT.
Then start the loop (§2).

## 1. The artifacts
| Artifact | Role |
|---|---|
| **M12-DEFINITION-OF-DONE** | The **yardstick + sole status authority** — ordered, status-tagged, carries Decisions + Parked. Flip tags in place; one line of evidence + `→ Entry N`, never an essay. |
| **M12-BUILD-JOURNAL** | The **audit trail + evidence home** — append-only. Full proofs, bug forensics, run output live HERE. Never edit a prior entry. New file per tier (`M12-BUILD-JOURNAL-T{n}.md`) seeded with a 10-line resume block. **Entries are written at END OF FILE and VERIFIED after writing — see §1a.** |
| **Local convergence enforcer** | Three directory processes on loopback, divergent state → anti-entropy converges them; kill/restart/catch-up proven; suspended-wins proven under partition. No cloud needed. |
| **GCP standalone enforcer** | The live journey (§0a.2) run entirely on GCP. Wave 1 lines are ✅ only after this passes. |
| **Outage-claim enforcer** | One directory blocked → an existing agent still seals via the remaining two (T=2 of N=3); with two blocked, registration refuses loudly with a cause-naming error. **Rewritten 2026-08-19** — it used to read "GCP blocked → seals via AWS", and there is no AWS node. The claim is now survive-one-node-loss, which is what T=majority(N) actually buys. |
| **Held-connection enforcer** (Tier P5) | Kill the relay→directory connection underneath a live relay, then close a session: it seals, with no relay restart. Proves the repair repairs. A green unit test does not discharge this — the defect is that a redial SUCCEEDS and changes nothing. |
| **IaC enforcer** | The region-expansion test: would this node come up in a brand-new region with zero manual steps? Every manual `gcloud`/console fix must land in IaC and the STATE file before its unit closes. |

## 1a. Journal writing — APPEND AT EOF, THEN VERIFY (added 2026-07-30)

**This milestone already lost 10 of its first 25 entries.** Entries 9, 11–13, 15–19 and 21 have no
prose in the journal: they were written by *prepending* near the top with scripted string replacement,
the anchors shifted as the file grew, and the edits **silently no-op'd** — no error, exit 0, and the
content simply never landed. Nothing was recoverable except from the commit messages.

The rule §1 already carried ("append-only, never edit a prior entry") did not prevent it, because it
says nothing about **where a new entry goes**, and prepending is itself an edit to the top of the file.

1. **A new entry is appended at END OF FILE.** Never prepended, never inserted between entries. The
   RESUME STATE block at the top is the ONLY thing overwritten in place.
2. **Verify the write landed** — `grep -c "^## Entry N"` (or read the tail) immediately after. An edit
   tool that reports success is not evidence the bytes are in the file when the edit was scripted.
3. **Chronological order is not worth a lost entry.** An out-of-order entry number at EOF is trivially
   readable; a silently dropped one is gone.
4. **The commit message is a backup, not the home.** If prose exists only in a commit, say so in the
   journal at the point it belongs, with the SHA — the way the 2026-07-28 integrity note does.

## 1b. Document discipline (carried from the M10B scope & cost review)

M12's documents are currently in good shape — keep them that way, deliberately. M10B's DoD reached
1,629 lines while its own header said it stays a scoreboard, and every later review paid to re-read
the archaeology.

- **A DoD line is a status tag, one line of evidence, and `→ Entry N`.** Cap any status blockquote at
  ~5 lines. Longer belongs in the journal with a pointer.
- **Supersession history lives ONLY in the journal.** A DoD line names the CURRENT shape of a decision,
  never the corpse of the previous one.
- **A decision on its THIRD rewrite gets MEASURED, not rewritten.** Two prose revisions is the cap; the
  third attempt runs it — against real Postgres, the real manifest, live `gcloud`. This milestone is
  unusually well served by that rule: almost every M12 question has a command that answers it.
- **A design-doc unit gets ONE review pass; TWO is the hard cap** (`DOD-AE-DESIGN-1` was worked
  correctly — one adversarial pass, three blocking amendments, closed). At pass two, remaining findings
  become ACs on the units that build them. An unbounded review loop on a document has no termination
  condition and ships zero code.

## 2. The core loop (one unit = one DoD line)
1. **Find the red** — lowest non-✅ DoD line in the active tier. Don't skip ahead.
2. **State the target** — one sentence of observable behavior, PLUS expand the full DoD line
   (every clause) into a clause checklist in the journal. That checklist is what the reviewer receives.
3. **Falsify first** (CLAUDE.md Debugging Discipline) — interface exposes the method? Responsibility
   lives here? What breaks elsewhere? Only then code.
4. **Red-first** — write the test, confirm it fails for the right reason, then implement. SPARC
   applies to every code unit (pseudocode citing the RFC for anything cryptographic).
5. **Implement** — minimum change to green; nothing speculative.
6. **Floor holds** — `pnpm run test` → `lint` → `typecheck` → `build` in every touched repo, run
   so it can FAIL (§7).
7. **Commit** (constantly — §3), push after every commit.
8. **Review — ONE read-only `cello-unit-reviewer` on the unit's diff, no model override.**
   Dispatch per §2b. Fix EVERY finding; commit fixes. **That is the whole review surface — see
   §2d.**
9. **Update docs** — flip the DoD tag (+ one-line evidence + journal pointer), journal entry,
   `infra/GCP-STATE.md` if any cloud resource changed.
10. **Merge the branch** (§2e) — a reviewed-green unit does not sit on a branch.
11. Back to 1.

> ### 🚨 "REVIEW IN FLIGHT" IS NOT A CLOSING STATE (added 2026-07-30)
> **DONE = written AND reviewed. IMPLEMENTED = written, not yet reviewed.** Entries 21, 22 and 25 each
> close narrating a unit as complete with `Review in flight` — truthful, and still the wrong shape,
> because step 8 precedes step 9 for a reason and a killed or unread reviewer produces NO verdict in
> either direction.
> - **A tag flips only when the reviewer's verdict is QUOTED in the journal entry.** Not "reviewed" —
>   the finding count and disposition, in the reviewer's own words.
> - **An entry that ends with a review outstanding says so in its heading**, and the unit stays 🟡.
> - Ending a session with reviews in flight is fine; recording them as closed is not.

## 2a. Repos — where work lands
- **trustless-cello** (this repo) — directory + relay code, ALL IaC (`infra/`), ops-agent,
  e2e-tests, CI config, these docs. Primary repo for nearly every unit.
- **cello-client** (`/Users/andrep/Documents/code/cello-client`) — manifest `role` parsing,
  validator selection, bundled consortium manifest, registration persistence. **Any cello-client
  change ships via `/cello-publish` (LOAD THE SKILL, every publish) with explicit version-bump
  ACs, and trustless-cello re-pins the published semver — `workspace:*` for cello-client packages
  is a bug.** Never run the `latest` promotion — Andre runs it.
- **cello-portal** (`/Users/andrep/Documents/code/cello-portal`) — only for the portal-move unit (P2).
- **corp-cello-site / waitlist** — **NOT in M12.** The waitlist stays on AWS (Decision 11).
  Its only appearance is the portal-DB coupling clause in DOD-MOVE-PORTAL-1.

A unit that touches two repos states so in its journal checklist up front, and worktrees are
created in both.

## 2b. Reviewer dispatch — what the unit reviewer is TOLD
Supply: the DoD line VERBATIM (all clauses), the coder's clause checklist, the diff, the repo(s).

> ### 🚨 THE NINE INVARIANTS LIVE HERE AS LENSES — they carry no DoD status tags (added 2026-07-30)
> An invariant is a property every unit must not violate. **You never *build* one, so it cannot be a
> deliverable and must never carry a tag** — a permanent ❌ on a property reads as unfinished work no
> unit can ever finish. The DoD lists them once, untagged, pointing here. Every lens below fires on
> EVERY unit's diff, whether or not that unit's DoD line mentions it.

Standing M12-specific lenses:
- **Sovereignty lens (BLOCKING):** flag any path where one node can complete a ceremony alone,
  any provider-specific networking in protocol code, any hardcoded endpoint, anything that
  assumes all nodes are up rather than routing around a down node.
- **Threshold lens (BLOCKING):** `consortiumNodeCount` and every threshold derivation must count
  **validator-role nodes only**. A replica entering DKG participant selection, seal arithmetic, or
  kill-switch honoring counts is a critical finding. T = majority(validators) — never all-N.
- **Kill-switch lens (BLOCKING):** suspension state must fail CLOSED and converge suspended-wins;
  an un-suspension requires verifiably newer authenticated state. Any path where a paused agent
  seals because a node missed the memo without being down is critical.
- **Shares-local lens (BLOCKING):** `agent_key_shares` (or successor) must never appear in any
  sync set, any anti-entropy exchange, any backup shipped off-node unencrypted.
- **Relay-extractability lens:** the relay gains no consortium state, no shared internal config
  package, no directory import. It must remain a standalone shippable artifact (enterprise
  private-relay deliverable).
- **HELD-CONNECTION lens (BLOCKING, added 2026-08-19 — Tier P5's founding defect):** any long-lived
  libp2p connection kept across calls is a cache with no invalidation. For every such handle the
  diff touches, ask three things and answer all three:
  1. **When it goes bad, what NOTICES?** A connection whose only detector is the next user is a
     connection that fails as somebody's timeout.
  2. **When it goes bad, what REPAIRS it — and can that repair actually work?** A redial that hands
     back the same object is not a repair. `libp2p.dial()` returns an EXISTING connection whenever
     one is registered for that peer and its socket status reads `open`; it never inspects the
     muxer. So dialling without first evicting is a no-op against precisely the failure it is
     there to fix. **Evict, then dial.**
  3. **What does the log say the MOMENT it dies?** Recording only the corpse — the failed call —
     leaves you inferring a cause forever. Connection open/close, with peer and reason, or the next
     investigation starts from zero.
  A diff that adds a retry against a cached connection without answering (2) is a blocking finding,
  however green the suite is.
- **Cause-not-symptom lens (BLOCKING):** `connection_lost` describes an object in THIS process, not
  the peer. Any error string, log line, comment or doc that turns a local handle's state into a
  claim about the remote node's availability is a finding — that exact conflation sent two separate
  investigations to the wrong tier before Tier P5 was opened.
- **Node-identity lens (BLOCKING):** every node id is `<cloud>-<region>`, chosen once and NEVER
  renamed — a rename destroys the FROST identifier. Flag any diff that renames, derives, or defaults
  a node id, and any manifest version where two entries could hold one FROST identifier.
- **No-tunnel lens (BLOCKING):** flag any VPN, VPC peering, Private Service Access consumer, or
  cross-cloud network path — and anything outside a node connecting to that node's Postgres. Sync is
  the authenticated libp2p channel or it does not happen.
- **IaC lens:** every cloud resource the diff implies exists in Terraform/CFN, and any manual fix
  landed in IaC + the STATE file before the unit closes. The test is the region-expansion one: would
  this come up in a brand-new region with zero manual steps? **A `gcloud`/console action in a journal
  entry with no matching IaC diff is a finding.**
- **No-SaaS / domain lens:** no paid SaaS dependency; every URL is `*.cello.mygentic.ai`.
- **Spec fidelity** against the decision record's numbered decisions (per-clause verdicts;
  silent simplification is BLOCKING). **Error fidelity** — causes, not exit-point labels.
  **Revert test** on every new test. **Removal integrity** on any diff that deletes/moves code —
  this milestone retires the mesh, so deletion discipline (grep both repos, built-artifact
  absence, `rm -rf dist` before asserting) will be exercised heavily.

## 2c. Deploy sequencing — THE FLEET IS THE ONLY ONE THERE
- **Images build ONLY in CI** (Cloud Build). NEVER `docker push` from local.
- **Roll node by node. Never simultaneously.** A roll restarts the node. With N=3 and T=2, exactly
  one directory may be down at a time; rolling two at once takes the consortium below threshold and
  no session can form. **This has already caused an outage — 2026-08-16.** `infra/CLAUDE.md` §2 is
  the authority.
- **Poll a real endpoint for a real 200 before touching the next node** — `GET /bootstrap` for a
  directory, `/health` for a relay. "The MIG says RUNNING" is not the same claim; the container can
  be crash-looping inside a healthy VM.
- **Batch every pending change for a fleet into ONE roll.** Shipping fixes one at a time multiplies
  the outage window by the number of fixes.
- **`/health` on a relay ALWAYS answers 200, deliberately.** The directories poll it to decide
  relay POOL MEMBERSHIP, and any non-2xx withdraws the relay. A relay that cannot reach a directory
  can still carry sessions, and since that cause is shared, a 503 there empties the pool fleet-wide
  — converting "cannot seal" into "cannot start a conversation". Degradation is reported in the
  BODY (`status: "degraded"`) and as a log event. **If an autohealer ever acts on this it needs its
  own signal; never the status code.**
- **After the roll, verify the thing the change was FOR**, not that the process came up. A relay
  that starts is not a relay that can seal.
- **Org-policy traps (verified live 2026-07-28):** no service-account keys exist or can be created
  (org-enforced) — cross-cloud auth is Workload Identity Federation or nothing; default SAs have
  ZERO grants — every permission is explicit, and the failure mode is a silent 403.
- **Cloud SQL:** each node's DB accepts connections from its own node only. Nothing cross-cloud
  ever connects to a node's Postgres — that is the anti-entropy dividend; protect it.

## 2d. `cello-done-auditor` — RETIRED HERE TOO (2026-08-19). DO NOT DISPATCH IT.

**This section used to carry M12 as a standing exception. That exception is withdrawn.** The
auditor is retired across the whole project: it re-litigates work the unit reviewer already passed,
at high token cost, and a procedure doc mandating a retired tool is how it keeps getting summoned.
The unit reviewer's single pass is the entire review surface.

**The concern that earned the old exception was real and does not need an agent.** M12's claims can
depend on **live cloud state**, and a reviewer reading a diff cannot see what is enabled, granted or
running. The answer is a COMMAND in the evidence, not a second opinion:

- **A ✅ whose truth depends on live state cites the command output that proves it** — `gcloud`,
  `terraform plan`, a log query — pasted in the journal entry. Not the journal's prose about it.
- **`terraform plan` is the GCP inventory.** A clean plan is the claim that declared state matches
  reality; run it rather than asserting it.
- **A tag flips on evidence, never on an agent's blessing.** If you cannot produce the command, the
  line is not ✅.

## 2d-bis. ONE review pass per unit; TWO is the hard cap
Reviewers always find something, so "review until clean" has no termination condition. At pass two,
any remaining findings become ACs on the units they affect, recorded in the DoD. This already cost
a whole session elsewhere — five passes, zero lines shipped.

## 2e. Parallel work — branches, worktrees, and merge (added 2026-07-30)

**§5's "one thread, one coder" was inherited from a single-thread milestone and contradicts how M12
actually runs.** `M12-D4` deliberately chose parallel coders on story branches, there are worktrees in
both repos (`trustless-cello-m12`, `cello-client-m12`), and the milestone is going well that way. The
rule below replaces it; what survives from §5 is that **subagents stay read-only** — reviewers,
auditors and explorers only, never a parallel implementation agent inside one session.

- **One branch per unit, named `m12/<unit>`.** It is pushed on creation, so `git branch -vv` shows an
  upstream for every branch — a bare branch is either unpushed or untracked and you cannot tell which
  by looking (verified 2026-07-30: `m12/role-manifest` looked unpushed and was merely untracked).
- **🚨 COMMIT BY EXPLICIT PATH. NEVER `git add -A`.** Non-negotiable with a shared checkout: an `-A`
  has already swept another session's half-finished work into a commit that then claimed a gate it did
  not have. Stage the files you wrote, by name.
- **A reviewed-green unit MERGES — it does not sit.** Merge is step 10 of the loop. The failure mode
  is quiet: five branches unmerged at once (measured 2026-07-30) while `main` moves under all of them,
  so every one pays a rebase it did not budget for and the DoD's ✅ describes code nobody is running.
- **Rebase onto `main` at every session start** for any branch older than a session, and after any
  merge to `main`. Main carries other milestones' commits — it is not quiet.
- **Two branches must never touch the same file.** If they must, they are one unit; say so and merge
  the first before starting the second.
- **Migration numbers are claimed on `main`, not on a branch.** M10B and M12 collided on V49/V50 and
  only Flyway's checksum caught it. Before writing `V{N}`, check `main` in both repos.

## 3. Cadence
- **Commit constantly** — never >~15 min without one; push after every commit. Docs commit to main.
- **Review every unit** on its diff, right after green. Never batch reviews.
- **`infra/GCP-STATE.md` updates immediately after each cloud action** — never batched, never at
  story close.
- **Checkpoint at every tier boundary:** journal summary, commit, and verify every ✅ since the last
  checkpoint names the command output that proves it (§2d). Only EARNED stays ✅.

## 3a. Autonomous-mode rules (if running unattended)
NEVER `AskUserQuestion`, never end a turn waiting. Decision rubric: pick the common best practice —
the choice least likely to need reversing — log it in the DoD Decisions section, proceed
(redo > block, always). Genuine undecidable fork → PARK and pull the next unit, saying so.
**Exceptions that DO block (park the unit, work another):** the npm `latest` promotion, `/mcp`
reconnect, and **a roll that restarts a serving relay or directory** (§2c). Build it, gate it,
review it, commit it, and hand the roll over — an unrolled fix is a finished unit whose DoD line
stays 🟡 until the roll happens.

## 3b. Watchdog crons — arm both (self-contained)
Session-only; re-arm BOTH after every compaction/restart. **Cron 1 — deploy watchdog** (armed only
while a deploy/roll is in flight, `*/4 * * * *`): check REAL health — Cloud Build build status, MIG
instance health, serial console for crash loops, and a real `GET /bootstrap` or `/health` 200 from
the rolled node; genuine failure → stop waiting, diagnose; terminal → CronDelete itself. **Cron 2 —
30-min heartbeat** (whole milestone, off-minute e.g. `17,47 * * * *`): the defibrillator, not a
metronome — if working, keep working. Fired prompt: (1) procedure/DoD/journal in context? re-read +
re-arm if dropped; (2) stalled on a decision? apply §3a; (3) blocked on a human-only step? work a
different line; (4) >15 min since commit? commit; (5) last unit unreviewed? dispatch now;
(6) **decision theatre check — are you carrying anything as "waiting on Andre"? Run the three
questions (§Decision Theatre). All NO → do it now. Any YES → it belongs in DoD Parked, and you do not
mention it again this cycle;** (7) one status line. Self-terminate when all DoD tiers are ✅.

## 4. First actions (2026-08-19 — P0/P1/P2 are done, P3/P4 are historical)
The active tier is **P5 — relay↔directory connection integrity**, and its lines run in order:
1. **DOD-M12-CONN-OBSERVE-1** — log the connection's socket status beside the muxer error, and log
   connection open/close with peer and reason. This is what turns the diagnosis from near-certain
   into certain, and it must land first so the fix's effect is legible.
2. **DOD-M12-CONN-EVICT-1** — evict before dialling, so the repair can actually repair.
3. **DOD-M12-CONN-PROVE-1** — a seal survives a killed relay↔directory connection with no relay
   restart, proven against real processes.
Do not skip ahead to the fix. The observation line is cheap and the fix is unprovable without it.

## 5. Hard rules (non-negotiable)
- **ABSENT IS NOT FINE.** A guard with missing input REFUSES — unless refusing would violate the
  redundancy invariant (a down node must not make CELLO unusable), then proceed loudly + journal.
- **ERRORS NAME THEIR CAUSE, NOT THEIR EXIT POINT.**
- **NO CONSUMER, NO SHIP.** New fields/flags/events need a named consumer in the same unit.
- **NO ARCHAEOLOGY COMMENTS.** Present tense, imperative; constraints the code can't show.
- **DEADNESS IS PROVEN BY DELETION** + both repos' gates. Mesh retirement units triage deleted
  tests by subject-under-test, never by file. Assert absence on BUILT artifacts (`rm -rf dist` first).
- **ONE INVENTORY, NOT TWO — `terraform plan` is the GCP inventory (added 2026-07-30).** Now that
  Terraform holds state and drift, a hand-maintained resource list in `GCP-STATE.md` is a SECOND source
  of truth that silently disagrees with the first. **`GCP-STATE.md` records only what Terraform cannot:**
  the billing-slot ledger, org constraints (no SA keys, zero default grants), the undisable-able
  platform APIs, and manual one-offs still owed an import — plus a pointer to `terraform plan`. Do not
  copy resource inventories into it. `infra/STATE.md` covers only the AWS services that outlived the
  teardown — waitlist, portal RDS, SES, Route 53, NAT — and is superseded for everything else.
- **DO NOT ESCALATE WHAT YOU CAN VERIFY.** Check gcloud/aws/code first.
- **MEASURE BEFORE QUOTING A NUMBER.**
- **Subagents stay READ-ONLY** (unit-reviewer, explorer) — never a parallel implementation agent
  inside one session. Deployment and code work stay in foreground. *(Parallel coders on separate
  story branches are the deliberate M12 model — rules in §2e.)* **`cello-done-auditor` is retired;
  do not dispatch it (§2d).**
- **A COMMENT IS NOT A GUARANTEE.** A comment asserting a safety property the code does not enforce
  is how defects survive review here — caught five times in one night in seal/persistence code.
  Verify the claim against the code; rewrite a wrong comment rather than deleting it.
- **NEVER DIAGNOSE A RACE CONDITION.** It is the lazy answer reached for instead of reading the
  evidence, and it has not once been the cause. Find the CONDITION — the value, flag, status or
  empty list — and quote it. If code reuses a stale read across an `await`, say exactly that and
  give the deterministic fix.
- **`node:sqlite` VERBOTEN** (SQLCipher only, client side). **No mocks for crypto.** **No
  `console.log`** in implementation — injected logger, `domain.noun.verb` events, correlationId
  threading; observability ACs are first-class on every unit.
- **Join on stable keys** — `agent_id`, `node_id`, UUIDs. Never a mutable attribute.
- **No paid SaaS. All URLs `*.cello.mygentic.ai`. NODE_IDs are `<cloud>-<region>`, chosen once,
  never renamed** (renaming = FROST identifier destruction).
- **Vitest: one worker, foreground, timeout, filtered.** Never background a test process.
- **Deferrals get a home** — DoD Parked + journal. No silent deferral.

## 6. What a checkpoint/handoff entry contains
Which DoD lines are ✅ WITH enforcer-run output (not a claim); the exact next red + one-sentence
target; HEAD commits (all active repos); cloud-state deltas (`infra/GCP-STATE.md` current?); the
fleet's rolled state if a roll happened; anything parked; anything that changes the DoD. Keep the
RESUME STATE block at the top of the current journal file up to date.

## 7. Gate discipline — run it so it can FAIL (added 2026-08-19)
M14 found a gate piped through `grep`, whose exit status is grep's — so the chain proceeded on a red
tree and a failing suite was recorded as green. Run gates so a failure stops the chain:

```
set -o pipefail        # or: capture to a file and check $?
pnpm run test > /tmp/gate.log 2>&1; echo "exit=$?"
```

**Read the exit code, not the tail of the output.** A check whose failure mode is "still reports
success" launders a red tree into a green claim, and every ✅ downstream of it is unearned.

The same rule applies to live verification, and it is the more common miss on this milestone: a
`gcloud` command that returns zero rows because the filter was wrong looks exactly like a system
with nothing to report. **Prove the query can return something** — run it against a case you know
exists — before quoting an empty result as evidence.

---

## Related Documents
- [[M12-DEFINITION-OF-DONE]] — yardstick + sole status authority
- [[M12-BUILD-JOURNAL]] — audit trail + evidence home
- [[M12B-DEFINITION-OF-DONE]] — sub-milestone: relay↔**client** ordering and failover. Different
  connection from Tier P5's relay↔**directory**, with different failure modes; do not conflate them.
- [[M12B-PROCEDURE]] — the current-shape procedure this one was refreshed against (2026-08-19)
- [[2026-07-28_0700_gcp-rebuild-decision-record]] — spec-of-record (the decisions)
- [[2026-07-25_1034_gcp-relay-and-directory-deployment-plan]] — superseded derivations (the why)
- [[2026-07-04_0556_tofn-registration-availability-quorum-enrollment-plan]] — M8B quorum/enrollment context
- [[launch-triage]] — Tier P5's user-facing entry and the measured evidence behind it
