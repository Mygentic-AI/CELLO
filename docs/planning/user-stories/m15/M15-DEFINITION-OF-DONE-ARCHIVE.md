---
name: M15 Definition of Done — ARCHIVE (closed lines)
type: definition-of-done
date: 2026-08-24
milestone: M15
status: archive
topics: [m15, hardening, pre-launch, security, definition-of-done, archive]
description: >
  The CLOSED lines of M15, moved out of M15-DEFINITION-OF-DONE so that document shows only what is
  still open. Nothing here is dropped: each entry is its full record — reviewer verdicts, findings,
  mutations run, and the lessons that generalise. The live scoreboard keeps a one-line pointer here.
---

# M15 Definition of Done — ARCHIVE

**This is not the scoreboard.** [[M15-DEFINITION-OF-DONE]] is, and it now carries only OPEN lines
plus a one-line pointer for each closed one. Everything below is closed: written, reviewed, and
tagged ✅ with its verdict quoted.

**Why it was split (2026-08-24, Andre):** the DoD reached 7,600 lines, over half of it closed work.
A scoreboard nobody can read stops being a scoreboard — and the specific cost was measured twice in
this milestone: a stale row read as open sent a lane to redo finished work, and a finished item read
as untouched sat unclaimed for a week.

**Read this file when** you need the evidence behind a ✅ — the reviewer's verdict, what the revert
test proved, or the lesson a unit paid for. **Do not** re-open a line from here without checking the
live DoD first; several entries record their own retractions, and the last word on a line is in the
scoreboard, not here.

---

### `DOD-M15-SPIKE-1` — ✅ What the live deployment actually does
> **All three answered 2026-08-21 → Entry 1.** (a) Step-6 directory auth **IS active**:
> `daemon.manifest.bundled` 115, `.skipped` 0 — `DOD-M15-DIRAUTH-1` does not escalate. (b) Both
> relays log `count=3, anyDirectory=True` on every restart back to 2026-08-17 — **the feared silent
> single-directory dependency does not exist.** (c) Selection is **not random**: both relays are
> requested (`reservationsRequested: 2`) but one carries **2,648 of 2,675** reservations (99%), so
> `DOD-M15-MULTIRELAY-1` delivers availability only and the linkability claim is **withdrawn**.
> No diff, therefore no unit review; every command is quoted in Entry 1 and re-runnable.
Read the running fleet and the running daemon; write the three answers into the journal with the
evidence, and re-scope the lines each one touches.
- **(a) Which directory-authentication path fires in production.** The roster challenge runs only
  when the resolved directory URL byte-matches a bundled endpoint, and the production URL is a raw
  IP specifically to satisfy that match. Two log events discriminate challenge-ran from
  challenge-skipped. **If it is skipping, the production client is not authenticating the directory
  at all** and `DOD-M15-DIRAUTH-1` changes character.
- **(b) The relay's configured directory-key set.** The keys come from environment variables; if the
  extra-keys variable is empty the relay silently accepts assignments from **one** directory, so a
  session brokered by either of the other two is unusable. **This is a value-delivery risk hiding
  inside a security item** — read the deployed value.
- **(c) How an agent's relay is actually selected.** Decision 7 accepts the relay's long-lived
  per-agent handle on the basis that spreading reservations across relays erodes it. That holds only
  if selection actually spreads. If the rule is deterministic (first reachable, lowest index,
  nearest region) the agent reserves with the same relay every time and `DOD-M15-MULTIRELAY-1`
  delivers availability and nothing else — in which case either make it spread or withdraw the
  linkability claim.
- **Ships as:** a journal entry, three answers, three re-scoping notes. No code, no branch.

---

---

### `DOD-M15-CLAIM-SCREEN-1` — ✅ Nothing reports screening as active while its semantic half is inert
> **CLOSED 2026-08-22.** The DoD's own ruling settled it without needing Andre — *"Withdrawal now,
> truth later — both dispositions are legitimate; silence is not."* Removing an unsupported claim is
> a withdrawal, not new copy.
>
> **THE REPO SHIPPED BOTH ERRORS AT ONCE, IN OPPOSITE DIRECTIONS.** `README.md` said screening was
> *"planned, not yet active — the daemon currently passes messages through unscreened"*, which is
> false: the deterministic sanitizer and the pattern matcher have been live and enforcing since the
> gateway was wired. `plugins/cello/skills/setup/SKILL.md` said it *"is active"*, and the
> `cello_contact_set_tier` description said *"ACTIVE at every tier"* — both overstating, because the
> layer that judges MEANING loads only if an ONNX classifier sits at `~/.cello/gateway-model` and
> nothing ships one.
>
> So a prospective user reading the README concluded there was no screening; one reading the skill
> concluded prompt-injection defense was fully on. The gap between them is the part that matters:
> the pattern layer stops what someone thought to write a pattern for.
>
> All three now agree, and the skill NAMES the hole — read the gateway's `layer2=` startup line
> before relying on screening against a determined attacker — rather than leaving it to be found.
>
> **The guard caught its own author:** the first README rewrite added one absolute (*"never buys
> less"*) and the claim scanner failed the build. Reworded, because its own message says raising the
> baseline is the one response that is never right.
Until `DOD-M15-SCREENINSTALL-1` lands, no status output, tool description, skill prose or document
may present inbound screening as fully active. When it lands, this row flips to made-true.
- Distinguishes the character-denylist layer (live) from the semantic layer (not installable).
- **Withdrawal now, truth later** — both dispositions are legitimate; silence is not.

---

### `DOD-M15-CLAIM-SCANNER-1` — ✅ An unlisted claim fails the build
> **CLOSED 2026-08-22.** The reviewer did not argue the scanner was weak — it **shipped three false
> claims past it and showed the green runs.** All three closed, each re-tested afterwards rather
> than assumed:
>
> 1. **A new claim appended to an existing claim LINE** — it counted lines, so
>    *"CELLO guarantees nobody can ever read your messages, not even us"* added to a sentence that
>    already made a claim shipped three absolutes with the count unchanged. It counts MATCHES now,
>    which is also stable when a paragraph reflows.
> 2. **A `.md` shipped via a DIRECTORY entry in `package.json#files`** — enumeration followed only
>    entries literally spelled `.md`. That is the same failure as the tarball `SKILL.md` this unit
>    exists to prevent; the hand-kept list had moved from an array into a spelling convention.
> 3. **`core/cli/src/registry.ts` was never read** — the DoD named it, and it holds the
>    highest-stakes prose in the repo: what is printed to an operator at the moment they act.
>    **41 unadjudicated claims, none ever counted.**
>
> My first extraction there keyed on `summary:`/`help:` and measured THREE claims in a 1514-line
> file. Implausible, which is the only reason I looked: `help` is a multi-line concatenation, so the
> regex caught the first fragment and stopped before every line carrying a claim.
>
> Four vocabulary words the line named were missing — `encrypted`, `screened`, `proof`, `ACTIVE`.
> The file's own comment claimed `encrypted` was present and gave the reason. **A comment asserting
> a property the code lacks, inside the unit written to stop exactly that.**
>
> **Backlog: 188 claims across 10 surfaces** (was 101 across 9). Shrink-only; a new claim fails the
> build, revert-tested. Adjudicating them is `DOD-M15-LEDGER-1`.
**The review's central finding, and Andre's word for it was "letter, not spirit."** A prose ledger is
a chore that looks like a control: `DOD-M15-LEDGER-1` shipped incomplete because completeness rested
on one grep vocabulary at one moment — *never / cannot / impossible* — and missed *tamper-proof*,
*ACTIVE*, *screened*, *encrypted*, *verifiable*, *notarized*, *proof*.
- **Enumerate the SURFACES from the system, never by hand:** `package.json#files` for what actually
  ships in the tarball, the plugin manifests, `registry.ts`'s `summary`/`help` string literals, root
  `*.md`. **The tarball SKILL.md was missed precisely because it was not on anyone's list.**
- **A claim vocabulary regex**, matched over those surfaces. Every hit must appear in the claims
  table with a disposition and a reason; **an unlisted hit fails the build.**
- **The repo already has this shape** — `plugin-skills-audit.test.ts` scans shipped skills for dead
  tool names, and `dod-onboard-help-1-vocabulary` scans daemon strings for CLI verbs that do not
  dispatch. The second one caught a real defect in a string written minutes after the review landed.
- **This inverts the loop lens 4 requires:** iterate what the system has, not a list someone
  maintains. It would have caught all three of the review's HIGH findings at commit time.
- The prose ledger stays as the reasoning record. **The test is what makes it true tomorrow.**
- **Add a fourth ledger column while here — *enforced by whom*.** It makes row 6 self-evidently false
  (nobody enforces it), row 7 safe (structural), and rows 10–13 bounded (the operator's own daemon —
  ergonomics, by Invariant 1's own first non-qualifying answer).

---

### `DOD-M15-CLAIM-COMMENTS-1` — ✅ No comment in the public repo asserts a property the code lacks
> **CLOSED 2026-08-22.** Both halves of the mutual deferral were verified fixed rather than assumed,
> and the outstanding `cello-mcp.ts` comment was found to be a **mangled half-edit** — truncated
> mid-sentence, and wrong in BOTH directions at different times: first that screening was inert
> (true only before the gateway was wired), then that it was live without naming the layer that is
> not.
>
> **Enforcer: a DENYLIST, not a count** (`dod-m15-claim-comments-1.test.ts`). The claim scanner counts
> prose on shipped surfaces because there is a bounded set of files an operator reads; source
> comments are unbounded, and the dangerous ones are dangerous for a reason that is known once
> somebody has traced it. Each entry is a sentence investigated and found false, with what it cost,
> printed on failure.
>
> **The subtlety that made it hard:** the rule is *rewrite, never delete* — a deleted comment takes
> with it the evidence somebody believed it, and an absence reads as deliberate. So every corrected
> comment QUOTES the sentence it retires, and a naive check would have forced deletion of exactly
> the evidence the rule preserves. Matches are excluded only when the surrounding ~900 characters
> mark them as retired, and there is a test on that escape hatch so a correction at the top of a
> file cannot license a fresh false claim at the bottom. Revert-tested.
> **Reviewed 2026-08-22 → Entry 14: BLOCKING.** Two comments in the public repo still assert
> properties the code lacks. One (`session-assignment-parser.ts`) is fixed in `1ddcd63`; the other
> (`cello-mcp.ts:190`, ledger row 13) was assigned to this unit and not delivered.
The six known checked-then-ignored instances; three carry such a comment.
- **Rewrite, never delete.** The comment is why the gap survived review; deleting it destroys the
  evidence that someone believed it. It is rewritten to describe what the code actually does and
  what it deliberately does not.
- Includes both halves of a mutual deferral: the directory's *"deferred to a follow-on story since
  clients perform this verification locally"* and the client's *"deliberately NOT compared at this
  layer"* — each pointing at a check the other does not perform.

---

### `DOD-M15-TIERTEXT-1` — ✅ The tier descriptions do not promise a gate that does not exist
> **⚠️ I FLIPPED THIS ✅ AND IT WAS WRONG. Reverted 2026-08-24 on review — three blocking findings,
> all confirmed by measurement, and two of them are worse than the defect the line opened with.**
>
> **1. MY REPLACEMENT TEXT DENIED THE KILL SWITCH.** It read *"note EVERY tier is auto-accepted"*.
> **Acceptance IS tier-gated:** `checkUnknownSenderAcceptanceBound` reads `getTier`, resolves that
> tier's `max_sessions` and refuses at the cap — and BLOCKED's cap is **0**, so a blocked contact is
> refused on the FIRST knock (`inbound-sessions.ts`: *"BLOCKED 0 → refused here"*). The sentence
> contradicted the `0=blocked` clause two clauses earlier and told an operator **their block does
> nothing**. The original defect over-promised a protection; mine **denied one that exists**, and it
> pointed at the kill switch. Corrected in place.
> **⚠️ ANDRE — Option B was ruled on a premise stated in this entry that is FALSE.** The entry said
> *"`isAutoAccept` (the only tier check that would gate this) has no production caller"*. True of
> that function, and a DIFFERENT one does the gating. The ruling inherited my error, so the wording
> you approved has been corrected as a matter of FACT, not style: *"tiers 1-4 are all auto-accepted
> WITHIN THEIR CAPS; above tier 0, tiers govern how much, not whether"*. **Say the word if you want
> it phrased differently.**
>
> **2. MY LOUDEST CLAIM WAS FALSE, AND THE WAY I GOT IT WRONG IS THE MOST INSTRUCTIVE THING HERE.**
> I wrote — in the commit, this entry, and the test header — that `claims-ledger.ts` **had no
> importer**. It has one: `dod-m15-claim-scanner-1.test.ts:47`, which already computes the shrinking
> count. **`grep` returned nothing because that file contains a raw NUL byte and grep classified it
> as BINARY.** The tool answered "no matches" for a file it never read, and I took the silence as
> proof of absence. **"Who controls the absence" — here it was a stray byte**, and it produced a
> confident false claim about false claims.
>
> **3. I SHIPPED A RED BUILD.** The six ledger rows named a surface `shippedSurfaces()` cannot
> produce, so the scanner's orphan guard failed — correctly. Rows removed; **`cello-mcp.ts` cannot be
> adjudicated until the scanner can SEE it, which is `DOD-M15-TOOLDESC-SCAN-1`** — an undocumented
> dependency of this line on that one.
>
> **What stands:** the false claim IS gone from the surface, the corrected text is now guarded in
> both directions, and the extractor was under-reading the file — it required the tool name on the
> same line, so `cello_backup` and `cello_restore` (2 of 58, both with unread claim vocabulary) were
> invisible to every guard built on it.
> **CLOSED 2026-08-24 (CELLO_Support), on Andre's Option B ruling.** All three descriptions carry the
> ruled text verbatim; `grep "auto-accepted when you're away"` → **0**. 5 tests, gate 3032 green.
> **THE ENFORCER COULD NOT HAVE WORKED, and that is the finding.** It demands the audit be
> adjudicated into `helpers/claims-ledger.ts` *"so the work is a shrinking count, not a paragraph
> saying it was done"* — and **that file had NO IMPORTER.** 900 lines of adjudications read by
> nothing, so the count was never computed or compared. Adding rows would have been a paragraph
> saying it was done, wearing the costume of evidence. **The same value-with-no-reader defect this
> milestone keeps producing, sitting inside the mechanism meant to enforce against it.** Six rows
> added AND the consumer that makes them count — scoped to this one surface, because sweeping the
> other eight is `LEDGER-1`, which is 🅿️ parked.
> **The scope clause found a third false claim** the line never named: `cello_contacts` promised
> exemption from *"anti-spam caps"*, and **no tier is exempt** — `INV-TIER-BOUND` exists specifically
> to kill the implementation that description promised.
> **Two claims were checked and LEFT ALONE**, which matters as much: `0=blocked (refused,
> indistinguishable from a full inbox)` is exact, and `cello_config_set`'s *"only STRICTER from
> here"* is true in context — I nearly filed it as false from a fragment before reading the sentence
> that resolves it.
> **The replacement text is pinned too**, not just the absence of the old: `isAutoAccept` has no
> production caller, verified by a scan proven non-vacuous. If anyone wires it up, the test reddens
> at the same moment the description becomes false.
>
> ### WHOLE-FILE AUDIT, 2026-08-24 (CELLO_Support) — the scope clause discharged by measurement
> The line demands the whole surface be audited in the same pass, not just the three tier strings.
> **58 tools; 21 carry claim vocabulary** (`never`, `always`, `cannot`, `guaranteed`, `exempt`,
> `only`, `prevents`). Adjudicated the four that would actually cost something if false — the ones
> making PRIVACY and INJECTION-DEFENSE promises, because a false claim there is the same class of
> defect this line opened with. **All four are TRUE, each checked against the producer:**
> - **`cello_name_session` — *"never sent to the counterparty, the relay, or the directory."*** 37
>   references across 9 files, and **every one is a local surface** (MCP, CLI, daemon handlers,
>   migration). Exactly ONE write: a local `UPDATE sessions SET session_name`. No transport, relay
>   or signaling file touches it.
> - **`cello_moniker` — *"local-only, never sent to the directory."*** 10 files reference a moniker;
>   none is directory-, signaling-, registration- or transport-bound. Empty result **proven
>   non-vacuous** by listing the 10 first.
> - **`cello_dismiss` — *"never propagated, never part of the seal or hash chain."*** `read_at` has
>   three references total: this description, the CLI's copy of it, and the setter. Nothing in any
>   leaf, tree, submit or frame path.
> - **`cello_doc_watch` — *"they cannot make you wake by claiming a field is urgent."*** The wake is
>   `matchWatchedPaths(watches, changedKeyPaths(seen, after))` — the changed paths are **diffed
>   locally** from the last-seen text, never taken from the peer's frame, and there is no urgency or
>   priority field to lie in. **The code is stricter than the claim:** *"THE AGENT'S OWN PATTERNS
>   travel, never the changed paths… a doorbell body is an unscreened route into the agent's
>   context."*
>
> **ONE IMPRECISION FOUND, recorded not fixed (§0z.4 — the gate is frozen).** The ruled text says
> tiers 1-4 are auto-accepted *"WITHIN THEIR CAPS"*. There is also
> `ABUSE_MAX_UNKNOWN_SESSIONS_GLOBAL = 50` — a cap on ALL unknown-tier senders **combined**, so a
> tier-1 sender inside their own 3-session cap can still be refused because of traffic that is not
> theirs. **The error runs in the safe direction** — it under-promises protection and over-promises
> reachability, the opposite of the defect this line exists for — so it is a note, not a blocker.
> `DEFAULT_TIER_BOUNDS` re-verified at every tier: BLOCKED **0** (the one tier gating *whether*),
> then 3 / 5 / 20 / 50. The ruled sentence is accurate.
>
> ### ✅ RE-FLIPPED 2026-08-24 (CELLO_Support) — every reverting finding closed, gate read by EXIT CODE
> The first flip was reverted for three blocking findings. All three are now closed **and each was
> verified by running something, not by re-reading the fix**, since re-reading is how the second one
> got past me in the first place:
> 1. **The text that denied the kill switch** — corrected, and now guarded in BOTH directions. One
>    test fails if *"auto-accepted when you're away"* returns; another fails if any description
>    claims *"every tier is auto-accepted"*. The only file in the tree still containing the old
>    sentence is that test, which asserts its **absence**.
> 2. **The false "no importer" claim** — corrected in the commit, this entry and the test header.
>    The cause is recorded as a durable check: `grep` called a file **binary** over one stray NUL
>    byte and answered "no matches" for a file it never read. **Every empty search in this pass got
>    a positive control first**, and one of them — *"no test asserts a sealed status"* — would have
>    been flatly false and would have had me write a duplicate of `msg-016`.
> 3. **The red build** — the orphaned ledger rows are gone and the gate is green **by exit code**:
>    root `pnpm run typecheck` **0** with zero errors, `eslint` **0**, `tsc --build
>    core/adapter-claude-code` **0** (`--build` walks project references, so this is not the
>    `-p --noEmit` trap that passes while the root fails), and 16 tests across the two files.
>
> **⚠️ ROOT TYPECHECK WAS RED WHEN I CAME TO FLIP, AND IT WAS NOT THIS UNIT.** One error in the other
> lane's `dod-m15-salt-adoption-rule.test.ts` — `placeOwnLeaf` called with 6 of its 8 required
> arguments, committed and pushed. **Fixed rather than waited on** (their file was not among the two
> they had dirty, so no shared-worktree race), verified by running the file — all 6 tests pass —
> because the change alters runtime behaviour rather than just satisfying the compiler: `kind` was
> `undefined` before and is now `"msg"`.
>
> **NOT RE-RUN, stated rather than implied:** the full client suite and full build. The other lane
> holds the runner slot, and this unit's diff is string literals in one file plus its test — nothing
> in the tree reads the changed strings, which was checked rather than assumed.
> **STILL CARRIED:** the ledger arithmetic for this surface. `shippedSurfaces()` cannot enumerate a
> `.ts` surface, so the count cannot include `cello-mcp.ts` — that is `DOD-M15-TOOLDESC-SCAN-1`,
> which is deliberately **POST-LAUNCH**. **This line's launch-blocking half — shipped text promising
> a protection that does not exist — is closed; the durable control that stops the next drift is
> not, by design.**
**BLOCKS LAUNCH** (§0z.1): shipped operator-facing text states a protection the system does not
provide, and the false half is the *reassuring* half. Found 2026-08-23 while Andre was setting a
contact's tier by hand; the receptionist raised it as "a setting that does nothing" and the measured
answer was worse and different.

- **The text.** `cello_contact_set_tier` ships as *"3=whitelisted (**auto-accepted when you're
  away**)"*, and `cello_contact_add` as *"…NOT auto-accepted when you're away. Promote them to
  whitelisted/vip … to let them reach you unattended."* Both attribute unattended acceptance to the
  tier.
- **What actually happens: EVERYONE is auto-accepted, at every tier.** `daemon.ts` says so at its
  own extension point — *"Do not add an 'accept' or 'join' tool — CELLO has no such step. Inbound
  sessions are auto-accepted by the standing receiver."* `isAutoAccept` (the only tier check that
  would gate this) has **no production caller**; its docstring says the consumer is the offline
  mailbox and is *"defined here as the seam"*.
- **So the promise is not unkept — it is REDUNDANT, and that is the worse shape.** Whitelisting does
  not fail to let someone through; it fails to be the *reason* they got through. An operator reading
  this concludes strangers are held back while they are away. They are not. **The reader is misled
  in the safe-feeling direction**, which is the same defect class as `DOD-M15-DISCLOSE-1` rather than
  a broken setting.
- **⚠️ THE FIX IS THE TEXT, NOT THE BEHAVIOUR. Do not read this line as "add the gate."** Whether
  inbound sessions should be gated for strangers is a protocol decision with a design comment behind
  it that says explicitly not to add an accept step. Changing that is Andre's call and is **not in
  this line**.
- **Not repeated to the counterparty** — checked, because the same implication said to a stranger
  would be worse. The away reply says only *"…is currently away. Leave a message … and it will be
  read when they return."* True, and it implies no gate. Operator-facing only.
- **Scope:** audit **every** description in `core/adapter-claude-code/src/bin/cello-mcp.ts` in the
  same pass — fixing one claim in a file nobody has ever scanned, and leaving the rest unread, is
  the "letter, not spirit" failure `DOD-M15-CLAIM-SCANNER-1` was written against.

> ### ✅ AUDIT DONE 2026-08-24 (CELLO_Support). The wording is Andre's (§2f); the FINDINGS are not.
>
> **The scope clause earned its keep — the audit found a THIRD claim the line did not name**, in the
> one place an operator goes to see who is trusted.
>
> **1. `cello_contact_set_tier` — FALSE.** *"3=whitelisted (auto-accepted when you're away)"*.
> **2. `cello_contact_add` — FALSE.** *"…NOT auto-accepted when you're away. Promote them to
>    whitelisted/vip … to let them reach you unattended."*
> Both attribute unattended acceptance to the tier. **Everyone is auto-accepted at every tier**, and
> `isAutoAccept` — the only tier check that would gate it — has no production caller.
>
> **3. `cello_contacts` — HALF false, and the false half is again the reassuring one.** It ships as
> *"the peers it treats as known/trusted (fast-tracked, **exempt from the unknown-sender gate and
> anti-spam caps**)"*.
> - *"exempt from the unknown-sender gate"* — **TRUE**, and precisely so: the global stranger-pool
>   cap is gated on `tier === TIER.UNKNOWN`, with the code's own note *"a KNOWN+ sender is past it by
>   trust."*
> - *"exempt from … anti-spam caps"* — **FALSE. No tier is exempt.** `DEFAULT_TIER_BOUNDS` is finite
>   at every level: whitelisted 20 sessions / 500 MB, vip 50 / 2 GB. They get LARGER caps, not none —
>   and there is already a test (`INV-TIER-BOUND`) asserting a known contact's byte cap is finite,
>   written specifically to kill a `tier >= KNOWN ? Infinity` implementation. **The description
>   promises the very thing a test exists to prevent.**
>
> **CHECKED AND TRUE, so it must not be "fixed" in the same pass:** *"0=blocked (refused,
> indistinguishable from a full inbox)"*. Blocking is real — a zero cap
> (`maxSessionsPerSender: 0`) — and it refuses through the **same path** an over-cap stranger takes,
> deliberately, so the refusal cannot tell someone they are blocked. That parenthetical is exact.
>
> **⚠️ PARKED FOR ANDRE — this is §2f, outward-facing wording, and the one thing I will not decide.**
> The findings are measured; the replacement text is his call, and the three claims want ONE
> consistent story about what a tier does, since the honest version is *"tiers govern how much and
> how often, not whether"*.
>
> ### 📋 ANDRE — three options, pick one and I'll apply it across all three descriptions
>
> They have to move together: the false claims all come from one idea (*a tier decides WHETHER
> someone reaches you*) and the true behaviour is another (*a tier decides HOW MUCH*). Mixing two
> stories across three tools is how this happened.
>
> **A — Say what it does, drop the gate language entirely.**
> - set_tier: `3=whitelisted (much larger limits)` · `0=blocked (refused, indistinguishable from a full inbox)`
> - contact_add: `…a KNOWN contact — larger limits than a stranger. Raise them further with cello_contact_set_tier.`
> - contacts: `…the peers it treats as known (larger limits, and not counted against the stranger pool).`
> - *Shortest, and says nothing false. Loses the reason someone would bother whitelisting.*
>
> **B — Say what it does AND correct the expectation it currently creates.**
> - set_tier: `3=whitelisted (much larger limits — note EVERY tier is auto-accepted; tiers govern how much, not whether)`
> - contact_add: `…a KNOWN contact — larger limits than a stranger. Tiers do not gate who reaches you; they gate how much.`
> - contacts: `…known peers: larger limits, and exempt from the stranger-pool cap. Per-sender caps still apply at every tier.`
> - *Longest. The only one that actively corrects an operator who already believes the old text —
>   and someone does, because Andre read it and believed it, which is how this was found.*
>
> **C — Neutral, no claim in either direction.**
> - set_tier: `3=whitelisted` · `4=vip` with the numbers documented elsewhere.
> - *Safest to ship, least useful. A tier surface that will not say what a tier does invites the
>   reader to guess, and the guess they make is the one we are trying to correct.*
>
> **My recommendation: B**, because the defect is not that the text says too much — it is that a
> reader who already has the wrong model gets nothing to dislodge it. **But this is your call and I
> have not touched the text.** Say a letter, or rewrite one, and I'll apply it in one pass.
>
> ### ✅ RULED: OPTION B (Andre, via `Miss_Chelly`, 2026-08-24) — APPLIED, all three, one pass.
> `cello-mcp.ts` now carries the ruled text verbatim. `grep "auto-accepted when you're away"` → **0**.
>
> ### THE WHOLE-FILE AUDIT ANDRE KEPT AS A CONDITION — 56 descriptions, 28 with claim vocabulary
> **Adjudications recorded HERE and not in the ledger, because `LEDGER-1` is 🅿️ PARKED until after
> Tier 4** (his own ruling). Written in row shape so they lift straight into it when it unparks.
>
> **FALSE → FIXED (3).** The two the line named, plus one the scope clause found:
> `cello_contacts`'s *"exempt from … anti-spam caps"* — **no tier is exempt**; `DEFAULT_TIER_BOUNDS`
> is finite at every level, and a test (`INV-TIER-BOUND`) exists specifically to kill a
> `tier >= KNOWN ? Infinity` implementation. **The description promised the thing a test forbids.**
>
> **PROTECTIVE → CHECKED AND TRUE (5). These must NOT be tidied in the same pass:**
> - *"0=blocked (refused, indistinguishable from a full inbox)"* — real, via `maxSessionsPerSender: 0`,
>   refusing through the SAME path an over-cap stranger takes so the refusal cannot out them.
> - *"a higher tier only RAISES limits, it never removes them"* — the bounds table is finite at every
>   tier.
> - *"a higher tier never buys less screening"* — verified by ABSENCE: the screening path does not
>   consult tier at all, so a tier cannot weaken it.
> - `cello_contacts`'s *"exempt from the stranger-pool cap"* — the surviving half, and exact: the
>   global cap is gated on `tier === TIER.UNKNOWN`, with the code's own note *"a KNOWN+ sender is
>   past it by trust."*
> - `cello_config_set`'s *"You can only make it STRICTER from here"* — **I nearly filed this as a
>   fourth false claim from a fragment.** The store returns `{ ok:false, reason:"needs_confirmation",
>   direction:"loosen" }`, which reads as "loosening is possible". Reading the WHOLE description
>   reverses it: the next sentence says a loosening is refused *and names the command the human
>   operator must run at their terminal*. "From here" means the agent surface, and that is precisely
>   true. **Second time in one session that a fragment nearly produced a false report.**
>
> **DESCRIPTIVE / LOCALLY-SCOPED → no protection claimed, no evidence owed (20).** e.g. *"Read-only"*,
> *"Always read before writing"*, *"local-only, never sent to the directory"*, *"never propagated,
> never part of the seal"*. Each states what the tool does or a local-storage fact, not a protection
> the system enforces against a counterparty.
>
> **The count is now a shrinking one: 3 fixed, 5 evidenced, 20 exempted, 0 unadjudicated.**

- **⚠️ Enforcer — NOT "I read the file". A hand audit is exactly what `DOD-M15-LEDGER-1` proved
  unreliable** (raised by the receptionist against my own classification, and it is the right
  objection). The audit is only trusted here because it is ONE file rather than four surfaces, and
  it must leave evidence a later reader can check rather than an assertion that it happened:
  - every claim-vocabulary match in `cello-mcp.ts` adjudicated into `helpers/claims-ledger.ts` with
    its verdict and evidence, in the same three-state form the scanner already uses — so the work is
    a **shrinking count**, not a paragraph saying it was done;
  - each corrected description carries the test that proves the behaviour it now describes.
  If that evidence cannot be produced for a description, the honest fix is to DELETE the claim, not
  to soften it — §2f, and the same rule that governed the swept surfaces.

---

### `DOD-M15-DISCLOSE-1` — ✅ Shipped documentation discloses what the architecture cannot remove
> ### ✅ ALL FOUR BULLETS DONE 2026-08-24 (CELLO_Support), in BOTH shipped copies.
> The connect tarball's `SKILL.md` and the plugin's are different documents and the plugin is the
> route most operators install by, so a disclosure in one reaches the smaller audience.
> **Bullet 1 (IP)** — reviewed, and the review caught that my own disclosure overclaimed twice in the
> reassuring direction. **Bullet 2 (relay metadata)** — the relay is *TOLD* who is in every
> conversation rather than inferring it, it learns message LENGTH, and a message parked for an
> offline recipient leaves an UNSALTED hash, so a short or predictable message can be confirmed by
> guessing. **Bullet 4 (long-lived handle)** — the relay holds a per-agent handle from the moment an
> agent comes ONLINE, not from when a session starts, so the record is continuous and exists whether
> or not you are talking to anyone. **Bullet 3 (single-node relay assignment)** — read out of the
> relay rather than assumed: a session assignment is accepted if it verifies against ANY single key
> in the consortium set, so the relay's copy is a one-directory claim while the artifact the agent
> verifies needs a threshold. The disclosure states the shape of the smaller claim — a relay-side
> record and a peer-id binding, gated behind being an authenticated participant named in the session
> — and what it cannot do: **alter the sealed record.** A single Ed25519 key cannot produce a
> threshold signature, so that half is structural rather than a check that runs.
> **The claim scanner caught every new claim** and each is adjudicated with the code that settles it
> — never by raising the baseline, which the scanner says plainly is the one response that is never
> right.
> **Gate: adapter 21 files / 182 tests / exit 0; typecheck 0.**
> ### ✅ BULLET 1 DONE 2026-08-24 (CELLO_Support) — written, REVIEWED, and corrected twice on review.
> **In both shipped copies** — the connect tarball's `SKILL.md` and the plugin's, which are different
> documents, and the plugin is the route most operators install by. A disclosure in one reaches the
> smaller audience.
> **THE HALF I WAS MOST WORRIED ABOUT SURVIVED, and the evidence is better than argument:** review
> enumerated every relay frame, every daemon→relay send and everything the relay writes to disk, and
> found no path where message content reaches it readable. **The relay package contains no cipher
> primitive at all** — zero hits for decrypt/aes/chacha/x25519/hkdf across its source — so there is
> nothing in it that *could* read a payload. That settles `enforcedBy: "structural"`: no branch to
> skip because there is no code to run.
> **⚠️ AND MY OWN DISCLOSURE OVERCLAIMED TWICE, BOTH IN THE REASSURING DIRECTION** — the exact defect
> this milestone exists to remove, committed inside the document written to disclose it.
> 1. *"One relay carries almost all… over time it can correlate"* was weaker than the truth on three
>    counts. It is **all**, not almost all. It does **not infer over time** — the directory hands it
>    both participants' identity pubkeys per session, and you authenticate with your long-term key on
>    one connection carrying every session. And **one relay is selected for everyone with no
>    rotation** in either selection path. The old wording invited *"short-term use is fine, and it's
>    an inference."* Neither is true.
> 2. *"It governs sessions opened from now on"* is true of the ADDRESS FILTERING and false of the
>    rest: the hole-punch and advertisement changes are fixed when the agent's network node is built,
>    so **an already-running agent can still be upgraded to a direct connection until it restarts.**
>    Verified in the code rather than taken from the review.
> **Also now stated:** the relay learns message length; a message parked while the recipient was
> offline leaves an **unsalted** content hash, so the relay can confirm a guess at a short or
> predictable message; and relay-only does not protect you from a counterparty who **runs the relay**.
> **The MCP tool description carried the same restart wording** and was corrected in the same commit —
> it is the third copy of this claim.
> **The claim scanner caught the new text immediately** (3 new vocabulary hits per surface, over
> baseline). Adjudicated into the ledger with verbatim excerpts, an enforcer and evidence — never by
> raising the baseline, which the scanner says plainly is the one response that is never right.
> **Gate: adapter 21 files / 182 tests / 0; typecheck 0; eslint 0.**
> **Bullets 2-4 remain open and unclaimed.**
>
> ### (claim, kept for the trail) CELLO_Support, 2026-08-24
> **Andre's re-ranking, quick win #1:** *"Say that a direct conversation reveals your IP.
> Documentation. It's true, there's no remedy, and the setting that would have been the remedy was
> reopened this morning as not working."*
> **I hold: bullet 1 only** — the IP-disclosure paragraph, in the docs that actually SHIP. The other
> three bullets (relay metadata, the single-node relay assignment, the long-lived per-agent handle)
> are unclaimed.
> **Related to what I just closed:** `RELAYONLY-1` ✅ is this line's *feature* half. The wording must
> not imply relay-only removes the disclosure — it narrows who can learn the address, and only for
> sessions opened after it is switched on.
- **A direct session permanently reveals the operator's IP address to the counterparty.** No gate,
  port change or ephemeral identity removes it; anyone who has talked to you directly can flood you
  afterwards with no protocol remedy. The shipped client documentation currently says nothing.
- **The relay's metadata visibility**, as above.
- **The single-node relay assignment as a bounded property** (relay-audit Decision 4(a) explicitly
  required this be written down rather than silently left): one directory node's key signs the
  relay-facing assignment while the client-facing artifact requires a threshold; its reach is a
  relay-side session record and a Peer ID binding, gated behind also being an authenticated
  participant named in it; **it cannot make the permanent record lie.** Carries the deferred
  (b)-vs-(c) evaluation as an open item with a trigger, so it does not resurface as a fresh
  discovery.
- **The relay's long-lived per-agent handle, disclosed rather than claimed-mitigated.** The standing
  receiver holds a reservation from agent-online, independent of any session, and **measurement
  shows one relay carries 99% of an agent's reservations** (`DOD-M15-SPIKE-1(c)`, Entry 1). Decision
  7 accepted this on the basis that spreading reservations would erode it; that basis does not hold,
  so the linkability claim is **withdrawn** and the property is stated instead: one relay can
  correlate an agent's sessions over time. The April design made relay/directory operator separation
  a protocol constraint precisely to stop a single party doing this; say so rather than let it be
  discovered.

---

---

### `DOD-M15-DIVERGE-1` — ✅ A divergent local tree blocks the seal instead of printing a string
> **Shipped and reviewed 2026-08-21 → Entries 2, 5.** cello-client `4478a03` + `9f05300`. Ten
> review findings, three blocking, all fixed. Gate: 3997 tests, lint, forced typecheck, build.
> **Clause 2 shipped NARROWER than written — amended below, with two follow-on lines.**

- Local/relay leaf divergence is already detected correctly on the next send and already logged as
  an error. **The log line stays** (M15-PROCEDURE Invariant 2). What is added: the agent is told in
  the response, and the session is **blocked from sealing** — on the operator-driven close **and**
  on the away one-shot path that seals with no operator present.
- The seal-readiness check becomes symmetric **for the PROVEN parting**: `ready` now also fails when
  an ack has come back behind this side's frontier, the case where the tree demonstrably holds a
  leaf at a position the relay assigned elsewhere.
  > **AMENDED 2026-08-21, after review.** As written this clause said "must also fail when the local
  > tree holds leaves the relay never witnessed", which covers **three** producers; one shipped. The
  > other two are *suspected* rather than proven partings, and gating on them risks the false
  > positive this codebase calls worse than the bug — force-abandon with no receipt as the only
  > exit. They are `DOD-M15-UNWITNESSED-1`, not dropped. **The reviewer confirmed the narrowing is
  > substantively right, not merely defensible:** the peer-side check this gate pre-empts compares
  > **leaf count**, not content, so an unwitnessed *received* leaf — which both peers hold — changes
  > neither count, and gating on it would be a pure false positive.
- **THE SALT'S ACs, inherited from the key/salt decoupling (Decisions #8/#9/#10) and its review:**
  - **The contributions ride the peer-to-peer `/cello/content/1.0.0` stream** — circuit-relay-v2 with
    its own Noise session, so a forwarding relay sees ciphertext. They **MUST NEVER** appear in
    `session_offer` / `session_offer_accept` or anything a DIRECTORY brokers. The trap: today the only
    round trip at session open runs on the directory's signaling stream, so that is the obvious place
    to put one and it is the forbidden one. **Unrepairable once shipped** — the relay would already
    hold the salt and the hashes.
  - **The named reasons land here**, not in `core/crypto`. Decision #10 says "refuse with a named
    reason", and `session-salt.ts`'s throws had no listener and no reason code at all (review F9).
    ~~Add `SALT_FINGERPRINT_MISMATCH` and `SALT_CONTRIBUTION_DEGENERATE` to `REFUSAL_REASONS`.~~
    **THAT HALF WAS WRONG — corrected in part A, 2026-08-23.** `REFUSAL_REASONS` is consumed by
    `recordRefusal`, which refuses an inbound session *request* — the decision made **before a
    session exists**, surfaced through `cello_inbox`, whose guidance is written for someone deciding
    whether to accept a stranger. A salt disagreement happens **mid-flight on an established
    session** and tears it down. Different moment, different reader, different verb; the reasons
    would have been unreachable from any caller that union serves. They live in
    `session-salt-agreement.ts` as `SALT_FREEZE_REASONS` + a total `SALT_FREEZE_GUIDANCE` map —
    the *shape* copied deliberately, because the closed-set-plus-total-map part was the half that
    was right.
  - **A VERSION DISCRIMINATOR is required.** Salted and unsalted content hashes are both 32 bytes in
    the same wire field with nothing telling them apart. A salted sender talking to an older unsalted
    peer fails EVERY frame at the receive-path authenticity check — the least-debuggable shape again —
    and the fingerprint check does not catch it, because an old client sends no fingerprint.
    `content_salt IS NULL → unsalted` is a legacy branch and must announce itself. **Ruled in
    Decisions Carried #15:** fall back, loudly, with the algorithm named on the wire; refuse only an
    UNKNOWN algorithm.
  - **PART A IS BUILT AND TWICE-REVIEWED (2026-08-23 → Entries 41, 42).** The salt is agreed,
    repaired and persisted; nothing hashes with it. **Part B's ACs, carried out of those two
    reviews — do not re-derive them:**
    - **A park-only session never agrees a salt** (pass-1 F9). The announcement hangs off
      `onPeerConnect`, so a session living entirely on the relay/park backstop never exchanges
      contributions. Free today; **a session that cannot send** the moment the content hash depends
      on the salt. Part B must either announce on a path the park case reaches, or refuse by name.
    - **`STATE_DIVERGENT` leaves the far operator with silence** (pass-2 F19). The mismatch refusal
      notifies the peer first; this one cannot, because the frame vocabulary has no way to say *"I am
      stopping"* — it carries a contribution or a fingerprint and nothing else. Part B owns the frame
      shape, so it is part B's call: a third field, or a `refused` frame.
    - **The salted/unsalted decision is per PEER, not per session record.** `content_salt IS NULL`
      says what WE hold, never what they can verify.
  - **PART B1 IS BUILT AND TWICE-REVIEWED (2026-08-23 → Entries 43, 44).** The RECEIVER reads
    `content_hash_alg` off the frame and verifies under it; no sender salts. **B2's inherited ACs,
    out of those two passes — do not re-derive them:**
    - **The park envelope needs the algorithm field, at BOTH verifier sites.**
      `session-node-manager.ts`'s `recoverParkedEntry` AND the independent check in
      `content-park.ts`. Miss the second and a salted parked entry is not annexed while **the relay
      copy is kept**, which re-creates the repeated re-pull loop that code exists to end.
    - **A salt disagreement between two SALTING peers reports as `content_hash_mismatch`** — a state
      difference raised as a security event, the same collapse running the other way. Part A's
      fingerprint check is meant to pre-empt it, except a park-only session never gets one (see the
      first AC above). Fix them together.
    - **Persist the unverifiable mark, or give the auto-ack gate a leaf-count check.** The mark is
      in memory: a restart between a tamper and the counterparty's SEAL ctrl leaf lets this side
      auto-co-sign. The upgrade path is accidentally covered — a refused frame was never appended,
      so its leaf count is short — and the auto-ack path has no such backstop.
    - ~~**`content.recover.alg_refusal_reconciled` has no test.**~~ **CLOSED in B2a** (→ Entry 46).
    - **The salt guidance's blind spot:** the shutdown-only `!this.#db` path in `#getSessionSalt`
      logs nothing, so it falls into the "neither event is present ⇒ close the session" branch of the
      `content_hash_salt_unavailable` advice.
  - **PART B2b-1 IS BUILT (→ Entry 47).** Every outbound hash comes from one `contentHashForSession`
    returning the hash AND its algorithm; the frame carries it; both park producers and the durable
    queue carry it. **Still `sha256` everywhere.** Traced end to end and verified: direct frame, live
    park, TTF-expiry park, and the crash backstop via `retry_queue` all name the same value for the
    same message.
  - **✅ B2b-2 IS DONE — ALL SIX CONSTRAINTS, BOTH REVIEW PASSES SPENT (→ Entries 49–52).** The
    algorithm is no longer `sha256`: a session holding an agreed salt hashes under
    `hmac-sha256-salt-v1`. **This closes bullet 6.** Gate: 2837 daemon tests, lint, both typechecks.
    - **Constraint 3** (adoption rule) — the review's central correction was that the missing state
      is BILATERAL, not durable: it belongs on the WIRE, and a column would have recorded each side's
      local verdict perfectly while the two disagreed.
    - **Constraint 4** — the hazard is UNREACHABLE. The salt agreement and the v3 park decoder are
      both in no git tag, so the interval build was never cut. What shipped is the guard that keeps
      that true, not a handshake for something that cannot happen.
    - **Constraint 6** — the park refusal is coded, so a local build fault stops being reported as
      the relay refusing a hand-off it was never asked for.
    - **Constraints 1, 2, 5** — the flip. **Two review passes, four blocking findings, all fixed**;
      verdicts quoted in Entries 51 and 52.
    - **🚨 THE TWO LESSONS WORTH CARRYING OUT OF THIS UNIT, both about how it was CHECKED:**
      - Pass 1: the fixture's `onPeerConnect` discarded its handler, so the ONE production line that
        registers a pending salt agreement — the line deciding whether salting can ever turn on —
        could be deleted with the whole suite green. My eight mutants all hit the CONSUMER of that
        state and none its PRODUCER. **Mutate the producer, not only the consumer.**
      - Pass 2: the HIGH was *created by pass 1's fix*. `#hashedWithoutSalt` was one bit per SESSION
        for a fact that is per MESSAGE, so a sibling's refusal released the claim held by a send
        still inside its relay round trip. **A fix pass is where regressions hide.**
    - ⚠️ **The line below said this "changes ONE function and nothing else structural." That was
      optimistic and is recorded rather than quietly dropped.** Constraint 2 needs the first send to
      WAIT, and a wait needs an `await` — so `contentHashForSession` is async, and four call sites
      plus two test files changed with it. The alternative (a separate `awaitSaltSettled()` each site
      must remember) was rejected for the reason F4 rejected a defaulted parameter: a forgotten call
      is a silent unsalted send, whereas a dropped `await` is a typecheck error.
  - **B2b-2 — THE LAST UNIT OF BULLET 6. It changes ONE function and nothing else structural:**
    `contentHashForSession` stops hardcoding `sha256` and consults the session salt. Everything that
    carries the value is already built and already tested, which is the point of the split.
    1. **Salt present → `hmac-sha256-salt-v1`; absent → `sha256`, and SAY SO.** Decision #15's
       fallback announcement, once per session per peer, never per message — a warn that fires on the
       normal case is not a signal.
    2. **HOLD THE FIRST SEND until the agreement settles, bounded.** Decision #8: agreed *before the
       first leaf is hashed*. On timeout the session is unsalted FOR ITS LIFE and says so — a late
       salt must never split a transcript that already has leaves.
    3. **The adoption rule is what makes (2) safe without a column:** `#persistSessionSalt` REFUSES a
       salt once the session has leaves. Then "salted or not" is decided once and cannot drift.
    4. **Do NOT infer peer capability from the salt agreement** — B2a F6. The agreement shipped
       before the v3 park decoder, so an interval build has one without the other. Gate on a real
       signal.
    5. **A park-only session never agrees a salt at all** (pass-1 F9) — the announcement hangs off
       `onPeerConnect`. Today free; here it is a session that cannot send. Fix with (1)/(2) or refuse
       by name.
    6. **`encodeParkEnvelope` throws a plain-English paragraph**, and B2b-2 makes that throw
       reachable. It lands in `cause`, a field documented as the machine-readable half, and surfaces
       as *"the relay refused the hand-off… will be re-sent when the relay link is back"* for a fault
       that is neither. Throw a coded error, or validate before calling.
  - **PART B2a IS BUILT AND TWICE-REVIEWED (2026-08-23 → Entries 45, 46).** The park envelope carries
    the algorithm at both verifier sites. **B2b's inherited ACs, out of B2a's two passes:**
    - **`encodeParkEnvelope` THROWS a plain-English paragraph**, and B2b is what makes that throw
      reachable. It is caught (`#parkContent` → `{outcome:"refused"}`, `drainAwaitingToPark` keeps the
      row), so no message is lost — but the prose lands in `cause`, a field documented as the
      MACHINE-READABLE half and handed to callers that branch on it, and the operator-visible text
      becomes *"the relay refused the hand-off… will be re-sent when the relay link is back"* for a
      fault that is neither the relay nor transient. **Throw a coded error, or validate before
      calling.**
    - **The `retry_queue` has no `content_hash_alg` column**, so the crash-backstop producer cannot
      follow its own marker ("the value the direct-path frame carried, not re-derived from the
      session row"). B2b adds one — idempotent `ALTER TABLE`, **and the agent-id rebuild's `createSql`**.
    - **Do NOT infer peer capability from "they completed the salt agreement."** The agreement landed
      before the v3 park decoder, so an interval build has one without the other and a v3 envelope
      there is refused as `unsigned_envelope` — the ATTACKER shape — re-pulling forever. Safe today
      only because nothing in that interval is published (verified: `git tag --contains` empty).
    - **`annex_decode_failed` is unreachable** and its catch would mislabel anything that ever did
      throw there; **the "unreachable" verify catch labels a future failure `annex_alg_unknown`**,
      whose guidance says "ask which version they run" — the wrong subsystem, one algorithm later.
    - **`redact` with no `content` annexes the UNREDACTED bytes** (`content-park.ts`) — pre-existing,
      unreachable only because the shipping gateway never emits `redact`.
- **Enforcer:** receipt. *(Not run — the unit is carried by suite + review; the enforcer itself is
  built by `DOD-M15-INTERRUPTED-1` and this line is re-asserted there.)*

---

### `DOD-M15-IDLE-CONNS-1` — ✅ A connection that authenticates to nothing does not live forever
> **CLOSED 2026-08-23 (→ Entries S3, S4).** Nine findings, five blocking, all fixed; 15 mutations
> killed. Gate 4346 tests + lint + typecheck + build by exit code. **Two premises below are STALE:**
> `ASSIGN-1` already made the receiver admit nobody inbound, and the four caps were already in force
> as libp2p defaults `createNode` never declared — that was the real defect and they are ours now.
> The sweep reaps an inbound connection that NEVER carried a stream, sparing outbound, the reserved
> relay and the peer the gate names. **Review's headline finding did not reproduce and is corrected
> in Entry S4** — closed streams linger, so `streamCount` does not fall to zero; the fix stands on
> not depending on that libp2p behaviour at all.
Split from `DOD-M15-SURFACE-1`. **Its value changed while the milestone was running, which is why it
is a separate line rather than a bullet.**
- **What it was for:** a stranger dials the standing receiver (which accepts everyone by design),
  holds the connection open, and is still attached when promotion narrows the gate.
- **What `DOD-M15-FRAME-1` already took:** promotion now evicts peers outside the gate, and the
  frame gate refuses a non-counterparty's frame and **hangs the peer up** on first contact. So the
  *injection* half of this clause is closed.
- **What remains is resource bounding** — a peer that connects and stays completely silent. It
  cannot inject and it is evicted at the next promotion, but until then it costs a connection, and
  the count is attacker-controlled on a node that accepts everyone.
- **Mechanism, checked:** libp2p has no idle-lifetime reaper. It offers `maxConnections`,
  `inboundConnectionThreshold`, `maxIncomingPendingConnections` and `inboundUpgradeTimeout` —
  **rate and total caps, not idle age.** A real reaper needs per-connection "has this peer
  authenticated to anything" state, which nothing holds today.
- **Do not guess the caps.** They apply to every node including relay-connected ones, and a cap set
  without measurement breaks *reachability* — the one property this milestone must not trade away.
  Measure a healthy daemon's connection count first.

---

### `DOD-M15-CI-SKIPS-SILENT-1` — ✅ A suite that skips itself does not report green
> **CLOSED 2026-08-22.** It was reviewed the same day with the verdict quoted below and its blocking
> items fixed; it stayed 🟡 only because one carried clause was still open. That clause is now
> closed by `DOD-M15-COMPOSE-CI-1`: the database job runs the integration suites, so
> `operations-agent/engine.test.ts` — the named example that "executes zero assertions" — now runs
> **17 tests, measured**, rather than reporting green having asserted nothing.
>
> `DOD-M15-SPINE-LANE-1` remains ❌ and is correctly its own line, not an unpaid debt hiding under
> this tag.
> **Built + reviewed + review fixes landed 2026-08-22 → Entries 15, 16.** trustless-cello
> `99734664` + `73d83abe`, cello-client `5ebdd74`. **The review's verdict was DEVIATIONS FOUND
> [blocking]**, and the blocking items are fixed: the self-satisfying sentinel, the guard blind to
> file-level exclusion, the two wiring-check bypasses, and an announcement that landed 4,851 lines
> before the end of the run. **Found beyond the line's own scope:** three packages holding 24 test
> files that the root gate had never collected — the signup limiter units had reported a green gate
> containing none of their own tests.
>
> **Two clauses do NOT close and are carried below as their own lines**, rather than being absorbed
> into a ✅ they did not earn: `engine.test.ts` still asserts nothing, and the 38 spine /
> cross-machine files still never collect. Both are now *visible* — which is what this line could
> honestly deliver — but visible is not run.
- **Carried → `DOD-M15-COMPOSE-CI-1`:** the named example still executes zero assertions.
- **Carried → `DOD-M15-SPINE-LANE-1`:** the spine suites are excluded at the project-config layer.
Found by the `DOD-M15-SIGNUP-1` review, and it is this milestone's own subject applied to its
evidence: **a green run that asserted nothing.**
- `packages/operations-agent/src/__tests__/engine.test.ts` is wrapped in
  `isLocal ? describe : describe.skip`, gated on `CELLO_ENV === "local"`, and **nothing in CI sets
  it.** Every automated run reports that file green having executed no assertion. The same shape
  exists elsewhere — the directory's `.live.test.ts` files and the M8D spine suites.
- **The tests are not the problem; the silence is.** A skip whose reason is invisible in the run
  output is indistinguishable from a pass, which is exactly the class M15 exists to close.
- **Fix:** either run these in CI against the compose Postgres, or make the skip announce itself —
  a title carrying the reason, plus one unconditional test that FAILS when `CELLO_ENV` is unset in
  a CI environment, so "we did not test this" cannot look like "this passed".
- **Audit every `describe.skip`/`skipIf` in both repos** for the same shape while in here.

---

### `DOD-M15-DIRECTORY-ROT-1` — ✅ The directory suite cannot survive its own run
> **CLOSED 2026-08-22.** Receipt, on a database created with `docker compose down -v && up -d`:
> **195/196 files, 2245 tests, zero failures — twice back to back.** Two runs because the original
> symptom was that the failing set MOVED between identical runs, and one green run does not answer
> that.
>
> **The last four failures were not contention at all** — every one failed when run alone. Three
> suites had been dead for months and were reported as SKIPPED, because vitest marks a suite whose
> `beforeAll` throws as skipped rather than failed. `dod-dirdata-read-1` used `ON CONFLICT
> (session_id)` after V31 dropped that constraint; `writeapi-001` named `identity_tree_entries`
> after V48 dropped the table; `m6b-004-si-001` polled for a directory server nothing starts.
>
> **And the cause of the fourth was the kill switch.** V59 moved the agent↔account binding into
> `agent_account_links`; every fixture proving pause and burn work still seeded only the retired
> `agent_profiles.account_id`, so all of them were getting `403 not_owner`. The suite named *"burn
> is permanent"* was asserting nothing about burning. Those tests were dark for exactly the change
> that broke the kill switch in production (V59's header: one operator, three agents, two of them
> unpausable).
>
> **The final blocker was cross-PACKAGE, and it corrected a claim.** 142/142 was the directory
> package alone; the root gate runs one vitest process, so directory and operations-agent interleave
> against one database. Parallel gave 16 failures one run and 19 the next. The database run is now
> serial (`vitest.config.ts`, scoped to `CELLO_ENV=local`) — the whole-table assertions are RIGHT
> and scoping them to own-rows would delete what they prove.
>
> **Carried, not absorbed:** the shrink-only guard still names **8 files committing a literal
> `chain_hash`** and **8 deleting from a chained table**. They no longer break the run — the guard
> is what keeps the list from growing — but converting them is real work and is now
> `DOD-M15-CHAINDEBT-1` rather than a footnote under a ✅.
Found 2026-08-22 by running the database suites for the first time (Entry 17), then **triaged before
being worked** (Entry 18) — which changed what the work is. The first reading was "28 rotten tests".
It is not.

**The failing set MOVES between identical runs**, and almost every failing file **passes on its own**:

| checked | result |
|---|---|
| full project, run twice back to back | different failing sets both times |
| full project, on a **freshly migrated** database | **32 failures** — so it is not accumulated pollution across days; the suite poisons itself *within one run* |
| each failing file **individually** | all pass except one |

- **CORRECTION (same day, `6301d36e`): there is NO directory code defect among the 32.** The one
  suspect, `m6b-009-pg-pool-config` AC-001, threw `DATABASE_URL is required for AC-001 integration
  test` — while AC-002 forty lines above in the same file, and `persist-004-hash-chain`, both
  default to the compose Postgres. Under the documented command it never tested pool concurrency at
  all; it reported a red environment error, every time. Given the default its siblings use, it runs
  and **passes**. Fixed, with the sibling-consistency pinned by a test.
- **One real thing did come out of chasing it**, and it is not on this list's subject: the
  unreachable-database path — the loudest line the process emits, on the way to `exit(1)` — logged
  `"reason":""`, because pg had thrown an `Error` whose message was empty. Fixed in the same commit;
  see `describe-cause.ts`.
- **Everything else is cross-file database contention, and the mechanism is now PROVEN rather than
  suspected** (Entry 20). It is not "other tests wrote rows" — a correctly chained insert leaves the
  chain valid. It is **DELETION**:
  - `verifyChain` walks the table in order and chains each row to **the previous row's stored hash**,
    starting from `CHAIN_GENESIS` (`hash-chain.ts`). So removing any row permanently invalidates
    **every row after it** — the successor was chained to a predecessor that no longer exists.
  - `account-001.test.ts` and `read-001-account-by-email-stub.live.test.ts` clean up with
    `DELETE FROM user_accounts …`, through a **superuser pool**. Production cannot do this: V22
    grants `cello_service` INSERT and SELECT only. The tests hold a privilege the application does
    not, and use it to break an append-only invariant.
  - That is exactly the reported symptom — *"chain broke at sequence 2"*, in files that never touch
    accounts, with the same hash pair every run.
  - The remaining failures of this class (per-pseudonym aggregates, "no leaf in >1 checkpoint", row
    counts) are the ordinary shared-table kind and are separable.
- **PROGRESS 2026-08-22 (`ac5c1a8c`): the chain-poisoning slice is closed — 32 failures → 25.** Five
  files were putting holes in `user_accounts` two ways: raw INSERTs stamping a literal `chain_hash`
  (`'seed'`, `'burn-chain'`), and cleanup DELETEs through a superuser pool. Both replaced by a shared
  `seedAccount()` through the chained writer plus per-run unique ids. `cross-node-discovery-pg.live`
  needed no change and is the model: `BEGIN`/`ROLLBACK` per test, so nothing commits.
- **THE NEXT SLICE IS `TRUNCATE`, and Postgres named it exactly.** Six of the remaining 25 are
  deadlocks, and the server log gives both sides:
  - one process running `TRUNCATE conversation_proof_leaf_checkpoints, conversation_seal_staging,
    conversation_proof_mmr_nodes, conversation_proof_leaves, directory_checkpoints RESTART IDENTITY
    CASCADE` — an `AccessExclusiveLock` on the whole set;
  - against another still running `INSERT INTO conversation_seal_staging …`.
  **Ten test files use `TRUNCATE`** on shared tables. This is the blanket reset the fix-shape note
  above rejects, and it fails in the two ways predicted: it deadlocks against anything concurrent,
  and it wipes rows other files are asserting on.
- **A SEPARATE FINDING INSIDE THAT ONE, and the more interesting half:** the process holding the
  other side of the deadlock is **inserting seals** — a directory node that a previous test started
  and never stopped, still working. A leaked live node is not only a deadlock partner; it writes
  rows nobody expects, at times nobody controls. Find and stop it before touching the truncates.
- **⚠️ EXISTING DEV DATABASES ARE ALREADY SCARRED, and nothing tells you.** The fix stops NEW damage;
  it cannot repair old. A database that ran the pre-fix fixtures has a permanent break — measured on
  `cello_dev`: 108 rows, exactly one break, at the row whose predecessor was deleted minutes before
  the fix landed. On any such database `account-001` AC-005/AC-007 and the `dod-accounts-chain-1`
  chain assertions stay red **for reasons already fixed**, and nothing distinguishes a historical
  scar from a fresh break — which is the same diagnostic hole this line exists to close, moved one
  level up. **Required once, per developer machine:**
  `docker compose down -v && docker compose up -d` (or `TRUNCATE user_accounts CASCADE`).
  **DONE on this machine 2026-08-22** — reset and verified: `account-001` + `dod-accounts-chain-1`,
  18 tests, green. Any OTHER machine that ran the pre-fix suite still needs it once.
- **THE REMAINING TRUNCATES ARE A DESIGN TASK, not a mechanical one — checked, 2026-08-22.** The
  easy half of `persist-021` converted cleanly to `BEGIN`/`ROLLBACK` (its tests only read back what
  they wrote, so they never needed the row to persist). The blocks that are LEFT truncate
  `conversation_seals` because they make **whole-table** assertions — `verifyChain` chaining from
  `CHAIN_GENESIS`, `expect(rowCount).toBe(3)` — which are only true of an empty table.
  - `TRUNCATE` is transactional in Postgres, so the obvious fix is to do it inside the rolled-back
    transaction. **That does not work as-is:** the writes go through `PgDirectoryStore`, which holds
    its own pool and calls `.connect()` for the advisory lock, so it would not see the transaction's
    truncate. Same reason `cross-node-discovery`'s third block could not use one.
  - **So the choice is:** route the store through a single caller-supplied connection (a change to
    its shape, or a test-only subclass), or give these assertions a scope they can own. Not a
    fixture edit — it is the whole-table-assertion problem in its hardest form, and it should be
    decided once and applied to every truncating block rather than improvised per file.
- **STILL OPEN — the backlog is declared, not hidden.** `dod-m15-directory-rot-1-chain-writes.test.ts`
  enumerates it: **9 files still commit a literal `chain_hash`**, **10 still delete from a chained
  table**. New violations fail immediately; the lists are shrink-only and their counts are pinned, so
  the debt cannot grow quietly. Converting them is the rest of this line.
- **The generalisation is worth more than the fix, and belongs in the launch conversation:** a
  linear whole-table hash chain means **any** deletion — a retention policy, a GDPR erasure, an
  operator cleanup — turns `verifyChain` permanently red, after which a genuine tamper cannot be
  told from the baseline. That is the precise failure `DOD-ACCOUNTS-CHAIN-1` was opened to fix, and
  the tests are currently reproducing it on purpose every run.
- **What that means, and it is the uncomfortable part:** these assertions can only ever have passed
  when the file was run alone. The directory's integration coverage has never worked as a gate, and
  wiring it into CI (`DOD-M15-COMPOSE-CI-1`) **fails immediately** until this is fixed. That makes
  this line a blocker for that one, not a parallel nicety.
- **Fix shape — decide per test, do not blanket-truncate:** a test asserting a whole-table invariant
  either scopes its assertion to rows it created (a per-test tenant/pseudonym/session id), or the
  file takes a transactional rollback per test. Truncating shared tables in a global `beforeEach`
  is the tempting third option and is the wrong one — it makes every file's passing depend on
  running in a suite that truncates, which is the same fragility pointing the other way.
- **One cause per commit.** A test asserting behaviour that has since changed on purpose gets its
  assertion updated and **said so in the journal** — never deleted quietly.
- **Enforcer:** receipt.

---

### `DOD-M15-COMPOSE-CI-1` — ✅ The suites that need a database actually run somewhere
> **CLOSED 2026-08-22.** The `database` job in `.github/workflows/ci.yml` is enabled: compose
> Postgres, Flyway to head with a hard failure if it does not reach it, then `CELLO_ENV=local pnpm
> run test`. The repo went from **no automated gate at all** to both halves running.
>
> A quarter of the suite — RLS policies, hash-chain constraints, migrations — was inert on every
> run. It is not any more, and 11 further tests began executing when three suites stopped defaulting
> to a `cello_spine` database that compose does not create.
>
> Enabling it is what found the cross-package contention above, which is the argument for enabling
> things rather than reasoning about them.
> **First half shipped 2026-08-22 → Entry 22.** `2558167f`. The repo had **no automated gate at
> all** — nothing ran tests, lint or typecheck on a push, ever. The unit gate now runs on every push
> and PR. **The database job is written and disabled behind `if: false`** with its blocker named,
> because enabling it today is a permanently red required check and a red check everyone learns to
> ignore is worse than an honest absence.
>
> **This is NOT closed until the database job is enabled**, which is blocked on
> `DOD-M15-DIRECTORY-ROT-1`. Also forced a reconciliation: the skip guard fails when CI skips the
> integration suites, and this workflow deliberately does that — so the opt-out is an explicit
> `CELLO_GATE_UNIT_ONLY` next to a comment saying what it costs, and an *unacknowledged* CI run
> still fails.

Split from `DOD-M15-CI-SKIPS-SILENT-1`, whose own named example — `operations-agent/engine.test.ts`
— is still gated on `CELLO_ENV=local` and still executes **zero assertions** on every run. That line
made the silence audible; it did not make the tests run, and the difference matters because
`engine.test.ts` holds the only coverage of the signup rate limiter's KEY (one requester capped
across six addresses, normalization buying nothing, requesters not affecting each other).
- **595 of 2266 tests — a quarter of the suite — are inert on a default run.** They cover RLS
  policies, hash-chain constraints and migrations: exactly the things a unit test cannot fake.
- **trustless-cello has no CI at all** (`.github/` holds issue templates; Cloud Build builds images;
  the buildspecs run smoke scripts). So "run them in CI" means *create the CI*, which is why this is
  its own line and not a clause someone could have quietly ticked.
- The compose Postgres already exists and `CELLO_ENV=local pnpm run test` already works locally.
- **Enforcer:** receipt.

---

### `DOD-M15-GUARD-HEARD-1` — ✅ A guard that fires is heard by somebody
> **CLOSED 2026-08-22.** Enforcer: `dod-m15-guard-heard-1.test.ts`, 11 tests. Gate 4080, lint,
> typecheck, clean build.
>
> **Reviewer's verdict, quoted:** *"**HOLLOW TESTS FOUND** [blocking]: **H1** (the retry check is
> disarmed on 1 of 3 reasons in the committed tree), **H2** (guidance unasserted on one of two
> returns — the DOD-M12B shape recurring), **H3** (a reason that never enters the constant is
> invisible to every assertion). Each was measured, not inferred."*
>
> All three closed and each of the reviewer's own mutations re-run afterwards:
>
> - **H3 is now a COMPILE ERROR**, which is the only real fix. `recordRefusal` took `reason: string`,
>   so a NEW security refusal recording a free-form code was invisible to every assertion — all of
>   them enumerate the constant, and a test cannot see a code that does not exist yet. **A type can.**
>   The set is closed: `AnyRefusalReason = RefusalReason | CapacityReason`. It immediately caught a
>   test seeding `"sender_cap"`, a reason no refusal path emits.
> - **H1** — the retry check excused any guidance containing *"nothing for you to retry"* anywhere in
>   the string, and one entry legitimately contains that phrase, so it was **permanently exempt in
>   the committed tree**. Sentence-scoped now.
> - **H2** — `cello_check_notifications` has two returns and only one was driven. The other is taken
>   whenever the agent has ended-unread sessions, i.e. the ordinary steady state.
> - **M6** — the reviewer gamed the 120-char floor with padding. The floor stays as a stub-catch and
>   is named as a floor; the property is now an **affordance allowlist**, which caught a live gap on
>   its first run.
> - **M7** — enumerated over reasons across all three audiences (inbox, durable row, wire), with a
>   stranger-tier counterexample so it cannot be satisfied by telling everyone everything.
>
> **The generalisation, and the reason this line existed:** *"a per-site test covers the sites that
> exist; the failure mode this line names is the NEXT site."*
**The pattern that recurred four times in one milestone, now its own line** — Andre's rule: fixed
individually three times is a coincidence, a fourth is a defect class. Each occurrence was found by
a person READING, never by a test.

The four, and none of them was a missing check — every one was a check that fired into silence:

1. `DOD-M15-SIGNUP-DURABLE-1` — a fail-closed refusal invisible to the person it refused. A
   table-scoped database error took the whole signup flow down while the health check reported
   healthy; from each person's side the bot was simply dead.
2. `DOD-M15-OFFER-SIGNED-1` — two security refusals recorded in memory only. No durable row (so
   parked content re-pulls forever), and no word to the counterparty, who saw a transport-shaped
   failure naming nothing that was wrong.
3. `DOD-M15-RESPONDER-VERIFY-1` — an identity refusal whose printed remedy did not work, and a
   certificate accepted without verification returning the same shape as a verified one.
4. The review of that unit, which found **three fixes each deletable with a fully green gate**
   (2525, 2525, 4057 tests) — a guard whose only proof of existence was that someone remembered it.

- **The test, for any new guard:** delete it and run the gate. If nothing goes red, it is not a
  guard, it is a comment that happens to execute.
- **The second test:** name who hears it. The LOG is not an answer on its own — Invariant 2 is loud
  in the log **and** in the agent-facing response, never one instead of the other. For a refusal
  that affects a counterparty, they are a third audience.
- **Fix shape:** a review lens is already in `M15-PROCEDURE.md` ("This guard fires. Who hears it?").
  This line is for the mechanical half — an enumeration over the refusal reason codes asserting each
  one reaches the operator surface and, where a counterparty is involved, the wire.
- **Enforcer:** a test that fails when a `REFUSAL_REASONS` member has no path to an agent-facing
  surface.

---

### `DOD-M15-CHAINDEBT-1` — ✅ No fixture puts a hole in a hash-chained table
> **CLOSED 2026-08-23 (→ Entries S5, S7, S8).** Ten findings, five blocking, all fixed. Enforcer
> met: both backlogs 8 → **0**, ceilings pinned 0/0, so a new violation has nowhere to be parked.
> Gate 2271 tests + lint + typecheck by exit code. **The review's real output was outside the
> unit:** `inRolledBackTxn` — one of three patterns this milestone standardised on — had been
> silently COMMITTING since it was written, `TRUNCATE`s included. Fixed. **Eight of ten chained
> tables now verify;** the two that do not are `DOD-M15-CHAINROUNDTRIP-1`, a production defect this
> unit made visible by removing the cleanups that hid it.
> **In flight (→ Entry S5), branch `m15/chaindebt-1`.** Inserts **8 → 5**, deletes **8 → 3**;
> shrink-only ceilings lowered with each. Every converted file's OWN suite re-run against real
> Postgres, not just the guard. **Four of the twelve were misfiled rather than debt** — already
> inside `BEGIN`/`ROLLBACK`, or a DELETE that must be REFUSED — because the guard reads source and
> source cannot show a rollback. Those moved to `ROLLED_BACK`/`ALLOWED_DELETES` with the reasoning
> attached rather than being silently removed.
Split from `DOD-M15-DIRECTORY-ROT-1` when that line closed, rather than being absorbed into a ✅ it
did not earn. The suite survives its own run; this is the debt that no longer breaks it.

- `dod-m15-directory-rot-1-chain-writes.test.ts` names **8 files still committing a literal
  `chain_hash`** and **8 still deleting from a chained table**. Shrink-only and pinned, so the debt
  cannot grow quietly — a NEW violation fails immediately.
- **Why it still matters with the run green:** `verifyChain` chains each row to the previous row's
  stored hash, so any delete invalidates every row after it. These files are one `docker compose`
  reset away from being harmless and one careless edit away from poisoning a run again.
- **The generalisation is the launch-relevant half, and it is not a test problem:** a linear
  whole-table hash chain means ANY deletion — a retention policy, a GDPR erasure, an operator
  tidying a bad row — turns `verifyChain` permanently red, after which a genuine tamper cannot be
  distinguished from that baseline. That is word for word the failure `DOD-ACCOUNTS-CHAIN-1` was
  opened to fix.
- **Enforcer:** the existing guard's lists reach zero.

---

### `DOD-M15-CHAINROUNDTRIP-1` — ✅ A chained row can be verified against what the database returns
> **✅ on a quoted pass-2 verdict, both passes' findings fixed (→ Entries S9, S10). Merged to main.**
> Pass 2: *"Fix the two window scans, confirm bypasses 1 and 2 go red, and this earns ✅."* Done —
> all THREE proven bypasses now go red, verified one at a time against the real source. Pass 2 also
> ruled the teardown correct by independent clean-room test (*"it runs after, it fails the run, and
> it cannot go quiet when the database is unreachable"*), confirmed five of six `impact` strings
> true, and confirmed both tamper-restores put back the exact original bytes.
> **The blocking finding was my own guard**: reviewer reverted this unit's headline fix and the
> guard stayed GREEN — its fixed-size windows read past the end of what they were reading. *"A guard
> that cannot catch the defect it was written for is worse than no guard: it retires the
> suspicion."* Extents are now computed, not guessed.
> **Two `impact` strings were wrong and are corrected** — a wrong `impact` is worse than no log,
> because it sends the operator somewhere that does not exist. The verdict-path delete does NOT
> re-ask the target to decide; it leaves a stale routing entry. The ACK is bounded by a 24h TTL, not
> "indefinite".
> **All findings from review pass 1 fixed (→ Entries S9, S10).** All TEN chained
> tables verify — the exclusion is deleted and the enforcer derives its list from
> `HASH_CHAINED_TABLES`. Gate: 2277 tests + lint + typecheck by exit code (this repo has no `build`
> script). Reviewer's pass-1 verdict was a conditional ✅ — *"Fix F1, delete the exclusion, restore
> the tenth table, and the line earns ✅"* — but the whole-suite teardown and six production log
> sites are new since, hence pass 2.
> - **`sessions` FIXED**, canonicalised at the PRODUCER. Adding UUID to `serializeRecord` would
>   corrupt `connection_requests` (TEXT `request_id`, 24 live 32-hex rows) — that reasoning is now
>   a comment at the top of `serializeRecord`, because the asymmetry reads as an oversight.
> - **`seal_notarizations` was NEVER an instance of this class.** See the corrected bullet below.
> - **NEW, beyond the line:** every chain is verified in a `globalSetup`/`teardown` AFTER the whole
>   suite, because an in-suite enforcer only sees damage from files that sorted before it.
> - **NEW, beyond the line:** six fire-and-forget store writes in `directory-node.ts` reported
>   nothing on failure; all six now log reason and consequence.
Found by `DOD-M15-CHAINDEBT-1`'s review and **measured, not inferred** (→ Entry S7). Three of ten
hash-chained tables cannot verify on a freshly reset database after a fully green suite.
- **The class:** `insertWithChain` hashes the record the CALLER supplies; `verifyChain` hashes
  `SELECT *`. Where a column's stored type round-trips to a different JavaScript value, the two
  serializations differ and the row **can never verify** — no tamper, no deletion, no fixture.
- **`sessions` (`uuid`).** Production passes `sessionIdHex`, 32 chars, no dashes; Postgres returns
  it dashed. `writeSessionWithParticipants` is the ONLY production path (`writeSession` has no
  caller), so **every session row a live directory has written is a hole** — and the write is
  `void … .catch(() => {})`, so it has never reported anything.
- **~~`seal_notarizations` (`bytea`)~~ — THIS BULLET WAS WRONG. Struck, not deleted, because the
  wrong answer is the instructive part.** I wrote that `node-pg` returns a Buffer which serializes
  as `{"type":"Buffer",…}` while the insert-time `Uint8Array` does not. Both writers already convert
  to Buffer, deliberately, under comments saying why. **The real cause: `persist-018` SI-003 zeroes
  a `frost_signature` to prove the verifier catches a tamper, and never restores it** — and
  `m7-upgrade-001` does the identical thing in a second file. `verifyChain` stops at the first
  break, so one unrestored row makes the table permanently unverifiable for everything downstream.
  The chain was reporting a tamper that really happened, exactly as designed.
  **The reason it survived three diagnoses generalises: a red chain looks the same whether the DATA
  is wrong or the CHECK is wrong.** That is what a tamper-evident chain is *for*. "The chain is red"
  therefore opens an investigation and never closes one — ask *which value differs, and who wrote
  it* before looking at any writer.
- **NOT `DOD-ACCOUNTS-CHAIN-1`** — that is a deletion making a chain permanently red. This chain was
  never green.
- **The one test that could catch it cannot:** `federation-001` AC-012 truncates `sessions` and
  writes a `randomUUID()` — the dashed form, a shape production never produces.
- **~~Fix belongs where `SEALWIRE-1` is working~~ — no collision occurred.** The fix landed at the
  PRODUCER (`pg-directory-store.ts`), and `serializeRecord` was not touched at all, so the feared
  §2e overlap with `SEALWIRE-1`'s hash-domain work never materialised. `hash-chain.ts` gained one
  comment block and no behaviour.
- **What this fix CANNOT repair, and nobody should rediscover it cold:** session rows a live
  directory already wrote hashed the undashed id. They are unrepairable, and `verifyChain` stops at
  the first break, so a live directory's `sessions` chain is red at row 1 **permanently** — now for
  a reason the code no longer produces, which makes it harder to recognise, not easier. Bounded:
  `sessions` is node-local and NOT anti-entropy replicated, and nothing in production calls
  `verifyChain` on these ten tables (only `mmr-store.ts` does, for two others). An audit-facility
  gap, not a runtime failure. No rechain unit proposed.
- **Enforcer:** `verifyChain` green on every table in `HASH_CHAINED_TABLES` after a full suite run
  on a reset database, plus a test that writes through the PRODUCTION shape.
- **Enforcer, second half — added because the first half is order-dependent by construction.** An
  assertion inside the suite only sees damage from files that sorted before it; that is exactly how
  the second offending file escaped it. A `globalSetup`/`teardown` now verifies all ten chains once,
  after every file, in every ordering, and **throws** rather than logs — a warning would leave the
  suite green, and a green suite over a broken chain is the condition that let this survive.
  Verified by poisoning a row on purpose: tests pass, run exits 1.
- **Every fire-and-forget store write reports its failure.** `canonicalUuid` is safe on unrecognised
  input *because* Postgres rejects it loudly — an argument that was void while the only production
  caller ended in `.catch(() => {})`. Written as a guard on the SHAPE, which then found five more
  silent writes nobody was looking for.

---

### ✅ `DOD-M15-SALTANNOUNCE-LATE-1` — DONE. Reviewed, one HIGH regression of mine found and fixed.

**Verdict quoted:**
> *"The fix is real and it works. But the refactor that carried it — pulling the inline
> `onPeerConnect` body out into a named `onCounterpartyAttached` — **silently dropped the one-line peer
> filter that used to guard it**, and I proved the regression by running the same probe against the
> parent commit. Every session now treats a *relay* connecting as *the counterparty* connecting."*

**That regression was mine and it was worse than the defect being fixed.** Measured on both trees:
liveness flipped `unknown` → `alive` for a dead counterparty, and the counterparty's re-dial address
was overwritten with the **relay's**. The second is the dangerous half — `session.transport.redial.unavailable`
fires on an **empty** address list, and the list was not empty, it was **wrong**, so the guard that
names the real state could never fire. The responder has no repair (`acceptSession` never dials the
counterparty; this path is its only address source). **The operator sees nothing** while every send
parks. The reviewer's own framing: *"That is not error substitution — it is an error **erasure**."*

**All findings fixed:** the guard restored; the sweep filtered on `status === "open"` (MEDIUM-2);
the sweep skipped entirely without a counterparty peer id (LOW-3, where `isCounterparty`'s fallback
would classify the relay). **Caught while writing LOW-3 that a bare `return` there would skip the
`onPeerDisconnect` registration below** — a worse bug than the one being fixed.

**Test teeth, both directions measured:**
- Review proved my *"only one in the file that can tell"* test was **also bypassable**: keeping the
  sweep and its log line but deleting the single call left **all five green**. It now asserts the
  EFFECTS — the salt is announced, the address is learned — and reddens under that exact one-line
  bypass. Verified.
- **The coverage gap that let HIGH-1 through is closed:** 2925 daemon tests stayed green with the
  guard deleted, because the existing keepalive test pins only the DISCONNECT side. A connect-side
  test now exists.
- One assertion of mine was wrong rather than the code — I asserted an exact address where the stored
  value carries the `/p2p/<peerId>` suffix. **The address was learned.** Fixed to assert the producer's
  actual shape.

**Gate: 281 files, 2926 tests, 0 failures.** Typecheck (src + tests) and eslint clean.

**⚠️ REVIEW PASS 2 DELIBERATELY NOT SPENT.** The cap allows it; the loop Andre named is
implement → review → fix → commit → done. The HIGH fix is a one-line guard restoration with a
dedicated test that is mutation-verified in both directions, so a second pass buys less than it costs
under the quota. **Recorded as a decision, not an omission** — if this unit is revisited, that is the
first thing to reconsider.

> ### ⛔ AND IT DOES **NOT** FIX THE DOCUMENT OUTAGE. Measured after rebuilding the artifact.
>
> The fix shipped, the spine lane was rebuilt so it runs the new binary, and `j-documents` was re-run:
>
> ```
> Tests  7 failed | 5 passed (12)      ← unchanged
> session.liveness.peer_already_attached  × 0   ← my sweep never fired
> session.liveness.*                      × 0   ← #wireSessionLiveness NEVER RAN
> session.node.created                    × 0
> session.salt.announced                  × 0
> document.delivery.session_opened        × 4   ← sessions WERE opened
> content_hash_salt_unavailable           × 8   (was 4)
> ```
>
> **Four document sessions were opened and not one of them created a session node or wired liveness.**
> So the announce cannot be late — **`#wireSessionLiveness` is never reached at all on this path**, and
> a sweep inside it is inert here by construction.
>
> **⚠️ MY DIAGNOSIS WAS ONE LEVEL TOO LOW, AND THE FIX INHERITED THE ERROR.** I traced correctly that
> the announce hangs off a listener that cannot see a pre-existing connection, and that
> `#tryCreateStandingReceiver` never wires it — both true, and `SALTANNOUNCE-LATE-1` closes that gap
> with a production-driven test that reddens when reverted. **But I then assumed the document path
> reaches that code.** It does not. The evidence that it might — `no_agreement_started` — is equally
> consistent with never getting as far as a node, and I did not distinguish the two before building.
>
> ### 🎯 THE ACTUAL ROOT CAUSE — SALT AGREEMENT IS A DIRECT-PATH PROTOCOL; DOCUMENTS ARE RELAY-ONLY
>
> **Both daemons are in the capture** — 36 events tagged `agentA`, 38 tagged `agentB` — so "zero
> session nodes" is a fact about both sides, not a capture artifact. What the document path *does*
> produce:
>
> ```
> session.relay.*    × 142        session.node.*       × 0
> session.content.*  × 122        session.liveness.*   × 0
> session.tree.*     × 56         standing_receiver.*  × 0
> session.document.* × 22
> ```
>
> **Document delivery runs entirely over the RELAY. It never establishes a direct session node.**
>
> **And the salt agreement is announced over the DIRECT connection.** `#sendSaltFrame` opens
> `entry.node.newStream(entry.counterpartySessionPeerId, CELLO_CONTENT_PROTOCOL_ID)` and returns early
> at its `!entry` guard when there is no active node — the same park-only exit the code already
> documents. **No node ⇒ no stream ⇒ no announce ⇒ no agreement, for any hook, on any connect.**
>
> **So this is not a wiring bug at all. It is a design gap:** a per-session secret negotiated only on
> the direct path, used by a feature that never takes the direct path. `j-content` agrees salts
> happily (8 × `session.salt.agreed`) because its journeys establish direct sessions; documents cannot,
> ever.
>
> **That is why `SALTANNOUNCE-LATE-1` was inert here** — it repairs the moment a node is promoted, and
> on this path there is no node to promote. The fix is sound for its own case and was aimed one level
> too low for this one.
>
> **⚠️ THE FIX IS A DESIGN DECISION AND NOT MINE TO PICK.** Either the salt agreement learns to travel
> over the relay like the content it protects, or document sessions establish a direct node like
> message sessions do, or documents are explicitly exempt from salting and the refusal path stops
> treating an unsalted document as an error. **Each has a different blast radius**, and the third is
> the only one that is not a protocol change. Recorded for Andre with the evidence rather than chosen.
>
> **What a user gets today:** two people co-editing, one side's updates silently refused, no error on
> either screen. **Documents are `M9`'s headline feature and this is a launch-visible outage.**
>
> **The superseded question, kept because the reasoning trail matters:** `openSessionFor` returns `ok`
> with a session id
> (`document.delivery.session_opened` × 4) while `session.node.created` stays at zero. **Either
> document delivery reaches a session by a route that creates no node, or the node is created in a
> process whose output is not in this capture** — `j-documents` runs two daemons and the capture may
> hold only one. **That distinction is the next step, and it is exactly the "how far did it get"
> question this line keeps rediscovering.**
>
> `SALTANNOUNCE-LATE-1` stays: it fixes a real gap on the standing-receiver promotion path, is
> mutation-proven, and costs nothing here. **It is simply not this defect's fix, and the DoD says so
> rather than letting a green unit imply a green outage.**
>
> ### 🎯 ROOT CAUSE FOUND IN THE CODE — one node-creating path never wires the announce
>
> **The announce is wired in exactly one place**: `#wireSessionLiveness` (`session-node-manager.ts:4019`)
> holds the only `node.onPeerConnect(...)` in the file (`:4033`). So a session node whose creator does
> not call it **can never announce a salt, on any connect, ever.**
>
> **Three functions create a session node and log `session.node.created`:**
>
> | creator | logs `session.node.created` | calls `#wireSessionLiveness` |
> |---|---|---|
> | `createSessionNode` (`:3779`) | ✅ | ✅ `:3805` |
> | `acceptSession` (`:4397`) | ✅ | ✅ `:4468` |
> | **`#tryCreateStandingReceiver` (`:12286`)** | ✅ | ❌ **not a caller** |
>
> `#wireSessionLiveness`'s only three callers are `createSessionNode`, `acceptSession` and
> `reviveSessionNode`. **`#tryCreateStandingReceiver` is not one of them.** A node created by the
> standing-receiver path is therefore born without the hook that announces the salt — which is exactly
> `no_agreement_started`, the reason string measured in the failing run.
>
> **This is structural, not inferred from log counts** — it does not depend on the capture argument
> that has now been wrong in both directions.
>
> ### ✅ LINK CLOSED — THE ANNOUNCE IS REGISTERED **AFTER** THE PEER HAS ALREADY ATTACHED
>
> `createSessionNode` takes a `reuseStandingReceiver` flag (`:3649`). On that path it does **not**
> build a node — it **takes the standing receiver's** (`:3682-3699`): `({ node, gater, autoNat, seed }
> = sr)`, then `#standingReceivers.delete(agentName)`. It *does* then call `#wireSessionLiveness`
> (`:3805`), so the reused node is wired.
>
> **But wiring is not the same as firing.** `onPeerConnect` is a plain
> `this.#libp2p.addEventListener("peer:connect", …)` (`core/transport/src/node.ts:666-667`). **It does
> not replay peers that are already connected.**
>
> **The full chain, every link in code:**
> 1. `#tryCreateStandingReceiver` creates the node and starts it listening — **without** the announce
>    hook, because it never calls `#wireSessionLiveness`.
> 2. The counterparty connects to that standing receiver. `peer:connect` fires. **No announce handler
>    is registered yet, so nothing happens.**
> 3. The session promotes that same node via `reuseStandingReceiver` and *now* registers
>    `onPeerConnect`.
> 4. `addEventListener` only fires on FUTURE connects. **The peer is already attached, so the handler
>    never fires** → no announce → `no_agreement_started` → the sender salts, the receiver holds no
>    salt, every message is refused.
>
> **⚠️ AND THE HOOK'S OWN COMMENT NAMES THE OPPOSITE HAZARD — they fixed too-early and created
> too-late.** It reads: *"a send placed at `createSessionNode` would be an announcement to a peer that
> is not attached yet."* True. The answer was to wait for the connect event — which is unreachable once
> the connection predates the listener. **The window is exactly "the peer got there first", which on a
> standing receiver is the normal case, not the rare one.**
>
> **THE FIX, and the interface already supports it:** after `#wireSessionLiveness` registers the
> handler, sweep `node.getConnections()` for a counterparty already attached and announce for it.
> `getConnections()` is on `CelloNode`. That closes both hazards — too-early is still avoided because
> the sweep runs after promotion, and too-late is covered because an existing connection is no longer
> invisible.

**⚠️ HYPOTHESIS, MARKED AS ONE — the two facts above are in tension, and that tension is the lead.**
The document transport opens its session through `openSessionFor`, *"the same path
`cello_initiate_session` takes"* — so the session is opened normally. If the peers are **already
connected** when that second session opens (the delivery worker's own comment mentions the
co-resident pair case), then `onPeerConnect` has already fired for the earlier connection and does not
fire again — while the salt is per-SESSION. **A per-session secret announced by a per-CONNECTION hook
is a gap wherever a second session rides an existing connection.** I have not established that this is
what happened here; it is the one mechanism consistent with `announced: 0`.

**⚠️ THE "ONE QUERY" I ORIGINALLY WROTE HERE DOES NOT WORK, and running it is what exposed the
retraction above.** Counting `session.node.created` against `session.salt.announced` compares an
**info** event with a **debug** one, in a capture that is missing both. It cannot answer anything.

**THE CHECK THAT DOES WORK — run the document journey with the daemons at DEBUG and their stdout
retained**, then compare, per session id:
1. `session.node.created` — did this session get a node at all?
2. `session.salt.announced` — did the announce fire for THAT session id?
3. `session.salt.agreed` / `#saltForHashing`'s reason — how did it end?

Announce present but no agreement ⇒ the frame is lost or unanswered, and the peer-connect hook is
fine. **Node created with no announce for that session id ⇒ the hypothesis holds**: a per-session
secret announced by a per-connection hook, missing wherever a second session rides an open
connection — and the fix belongs at session creation, against the dial-ordering problem that hook's
comment describes.

**Until that runs, the only established facts are the three reason strings above.** Everything about
*where* the announce goes missing is a hypothesis, and the evidence that seemed to confirm it has
been withdrawn.

---

### ✅ `j-end` IS GREEN — 10/10. A closed line already held the answer, and review found its twin.

**The failure was a STALE FIXTURE, not a defect** — `DOD-M15-SAMEOP-FALSEPOS-1` had already resolved
that the same-operator flag was right. `CELLO-REPL-001` moved the resolver to `agent_account_links`
joined on the stable `agent_id`; the journey wrote `agent_profiles.account_id`, **the superseded
column**, so it handed one agent an account nothing reads — and then verified by counting distinct
accounts **in that same column**. *A stale fixture whose self-check is stale the same way cannot
detect its own staleness.*

**Review verdict, quoted — and it read the live database rather than the diff:**
> *"**You corrected it. You did not weaken it.** I did not take this from the diff — I read the state
> your last run left in `cello_spine` … Bob is distinct from Alice on **both** legs of D-29, in the
> tables the predicate actually reads. The hop passes because the product now sees a stranger, not
> because the assertion moved somewhere permissive."*

**And it found the blocking one I asked for:**
> *"the same defect this unit fixed is still live 500 lines down, in the same file … character-for-character
> the defect you just fixed … **The precondition is what has no teeth, not the hop.**"*

**All findings fixed:** HOP 9's precondition moved onto the resolver's table (H1); **both** linkage
assertions now cover **both legs of D-29** — it is a disjunction, `accountId` OR `phoneStubHash`, and
counting accounts alone cannot establish "distinct operators" (M3, mine on both hops); the
`agent_profiles` comment now gives all three reasons the UPDATE stays (M2); the upsert is labelled
**fixture-only** against V59's *"NO UPDATE and NO DELETE… a binding that can be rewritten is a binding
an attacker can rewrite"* (L4); and `psqlSpine`'s *"read-only"* doc is corrected, since four call sites
write through it (L5).

**Q5 answered cleanly:** `j-end` is the only spine journey that seeds operator identity, so **no other
journey is silently testing the co-owned path while claiming the stranger path.**

**🅿️ ONE ADJACENT ITEM, filed:** `j-spine` proves *"two agents, one account"* from
`agent_profiles.account_id`. Legitimate — it asserts registration's own write — but it says nothing
about the replicated link that **authorization and the kill switch** read, which is the failure V59
exists for (0/2/1 linked across three nodes, 2026-08-07).

---

### ✅ `j-spine` IS GREEN — 7/7, from 4/7. Five failures fixed; four were stale vocabulary.
>
> **Every one was the journey asserting something the product deliberately removed, and each removal
> is documented in the code or commit that made it:**
>
> | assertion | why it was removed |
> |---|---|
> | `state === "registered"` | a STORED FLAG, deleted **because it lied** — *"every agent on disk was labelled 'registered' at load whether or not it ever was"*. A loaded-but-not-started agent is `stopped`. |
> | `state === "online"` right after start | `resolveAgentState` ends `attendance > 0 ? "online" : "unattended"`. Starting an agent does not make anyone ATTEND it. *"Running, reachable, nobody listening"* is a different thing to tell an operator. |
> | `state === "current"` | dropped from the enum on purpose: *"state reports READINESS only; selection is a SEPARATE `selected` flag. **Never fold selection into state.**"* |
> | `Array.isArray(status.connections)` | removed by `5deef4b` — *"drop the always-empty `connections` stub"*. It was always `[]`, so the assertion was true whether or not a connection existed. |
>
> **One fix is strictly STRONGER than what it replaced.** The old `current` assertion could not
> distinguish *"conn1 selected it"* from *"conn1 sees it as healthier"*, because the enum conflated
> them. It now requires both connections to **agree on readiness** and **disagree on selection** —
> `DOD-SPINE-2`'s independence property stated directly instead of inferred from a state name.
>
> **The fifth was a genuine race in the test, not vocabulary.** `DOD-SPINE-5` failed with
> `standing_receiver_unavailable` — **not a directory answer at all**, a precondition on our own side.
> `cello_start_agent` returning does not mean the standing receiver exists yet, so an initiate landing
> in that window is refused locally and never reaches the negotiator. The assertion reported that as
> *"the negotiator did not reach the directory"*: an exit-point label standing in for a cause.
> Replaced with a **readiness poll** rather than the retry-on-transient other journeys use — it waits
> for the thing actually being waited on, and if the receiver never becomes ready it says so instead
> of blaming the directory.
>
> With the race gone the directory answered **`unknown_agent`**, not the expected `target_offline`.
> The target is `00…00`, which nobody registered: `target_offline` claims the agent exists and is
> offline, which is false about it. Asserting the vaguer reason would have pinned the directory to a
> less accurate answer than it gives.
>

---

### `DOD-M15-NORMHASH-1` — ✅ Sanitisation cannot split the two sides' trees
> **ANSWERED and GUARDED, 2026-08-23.** Filed as a question; **the answer is "wire bytes, both
> sides"** — established by `CELLO_Coder_1` reading both paths, then guarded in this lane.
>
> - **Sender:** outbound screening runs FIRST and the hash is taken over the screened bytes —
>   `sendBytes = modified ? outboundVerdict.content : contentBytes`, and those exact bytes go on the
>   wire (`session-content-handlers.ts`).
> - **Receiver:** the content-hash cross-check runs **BEFORE** `screenInbound`
>   (`session-node-manager.ts` ~6595–6680, vs `screenInbound` at ~6867).
>
> **Both ends hash the bytes that crossed the wire. The sender folds before hashing; the receiver
> hashes before folding. No fold happens between the two hashes, so an ellipsis cannot split the
> trees.** The sanitiser is correct and stays.
>
> **THE LOAD-BEARING FACT IS THAT ORDERING, AND NOTHING PINNED IT.** Moving the receiver's
> cross-check below `screenInbound` reads as a reasonable *"screen it before you trust it"* tidy-up,
> and would make **every message containing a foldable character produce two different trees** — 
> presenting as the core promise failing on an ellipsis.
>
> **The guard is a journey, not a code change:** `j-loopback` already asserts the two sealed roots
> are byte-identical, so its message now carries `…`. One character converts an existing green test
> into the thing that catches a future reorder. **Do not "tidy" that ellipsis back to ASCII** — the
> file says so, because a test string that looks odd is exactly what someone cleans up, and cleaning
> it makes the guard inert without failing.

---

### `DOD-M15-CLOSEROOT-1` — 🟡 Journeys converted (unrun); the assertion clause ✅ MEASURED
> ### 🔴 THE 60-SECOND SEAL TIMEOUT IS NOT A TIMING PROBLEM. IT IS AN ASYMMETRIC SALT STATE.
> **Found 2026-08-24 (CELLO_Support) by reading the run log rather than re-running.** `CELLO_Coder_1`
> raised `j-documents`' rejection case — `awaitSealedRoot` timing out at 60s — and said correctly
> that it could not tell from that run whether 60s was too short or the seal genuinely fails.
> **Neither. The seal cannot complete, because content is being REFUSED.**
> - **Both sides DO close** and both closes are awaited — checked first, because that was the cheap
>   explanation.
> - **Session `10eae009…` logs `session.content.cross_check.failed` at ERROR EIGHT TIMES**, reason
>   `content_hash_salt_unavailable` — *"the sender says it is salted and this side holds no salt."*
> - **That session NEVER AGREED A SALT.** Measured with a positive control: 8 `session.salt.agreed`
>   events exist in the run, **all of them in two OTHER sessions** (4 + 4). `10eae009…` has **zero** —
>   while `agentA` logs `session.content.unsalted` for it and the peer's frames declare salted.
> **So one side salts and the other never agreed, permanently.** Every message from that peer is
> refused, that side's tree is missing every leaf, and a seal over two divergent trees cannot
> complete — which is exactly what a 60s wait for a root that will never arrive looks like.
> **This is `SEALWIRE-1` bullet 6's territory (the salting lane), not this line's** — recorded here
> because it answers this line's open lead, and handed to `CELLO_Coder_1`.
> **⚠️ AND IT IS THE EXACT FAILURE `REFUSED-INBOUND-SILENT-1` WAS WRITTEN FOR** — a state skew that
> refuses EVERY message from a counterparty while the conversation looks merely quiet. That work now
> tells the operator; it does not stop the split happening.
>
> ### ✅ RESOLVED UPSTREAM — `DOD-M15-SALTSPLIT-1` (`CELLO_Coder_1`), and the cause was a LYING COMMENT
> **My open question is answered from code, not another run: the agreement NEVER STARTED.**
> `no_agreement_started` is returned from one place and only when `#saltPending` AND `#saltLastOutcome`
> are both empty — so the frame was never sent. It **provably cannot** mean started-then-failed:
> every failure mode records a last-outcome mapping to a *different* reason string. **That is what
> the outcome map is for**, and it is why this was decidable by reading.
> **And the reason the split is PERMANENT was a comment asserting a property nothing implemented** —
> the terminal branch claimed *"Both sides then hold no salt and both KNOW it"*, while
> `#saltForHashing` returns a held salt on its FIRST line, before it looks at adoption at all, and
> `sessions.content_salt` had a writer and **no clearer**. So a side that had agreed a salt kept
> hashing under it after being told the peer could never hold one. **This milestone's defect class,
> in the mechanism that produced my finding.**
> **⚠️ WHAT THE FIX DOES NOT DO, in their words and worth keeping:** it PREVENTS the split when the
> losing side has not spent its salt, and makes it DIAGNOSABLE when it has. **It does not REPAIR the
> session I found** — that peer had already sent eight messages under its salt, and erasing a spent
> salt would leave a transcript no single rule can verify. **That session stays dead.**
> **PREDICTION TO VERIFY ON THE NEXT LANE RUN, stated before the run so it cannot be fitted after:**
> `j-documents`' rejection case should now either pass, or fail with a DIFFERENT signature — not a
> 60s `awaitSealedRoot` timeout. **If it still times out the same way, the salt split was not the
> cause and this entry is wrong.**
>
> ---
>
> #### ✅ ANSWERED 2026-08-24 (`CELLO_Coder_1`), from the code rather than another run → `DOD-M15-SALTSPLIT-1`
>
> **The open question was: did the agreement never START for that session, or start and fail?**
> **It never started, and that is decidable from the code without re-running anything.**
> `no_agreement_started` is returned from exactly one place, and only when `#saltPending` has no
> entry **and** `#saltLastOutcome` has no entry either — i.e. `#markSaltPending` was never called, so
> `#sendSaltFrame` never ran for that session. It provably cannot mean *started and failed*: every
> failure mode (`announce_failed`, `timeout`, `persist_failed`, `closed`, `our_read_failed`) records
> a last-outcome that maps to a **different** reason string. That discrimination is the whole point
> of `#saltLastOutcome`, and it is what makes the log line load-bearing.
>
> **But the more damaging finding is next to it, and it is why the split is PERMANENT rather than
> transient.** The terminal branch — the one that runs when a peer says it can never adopt — asserts
> its own outcome in a comment, in two places:
> *"Both sides then hold no salt and both KNOW it."* / *"neither side will use a content salt for
> this session, and both now know it."*
> **The code could not deliver either sentence.** `#saltForHashing` returns a held salt on its FIRST
> line, before it looks at adoption at all, and `sessions.content_salt` had exactly one writer and
> **no clearer**. The pure function also tests `hasClosed` *before* `state.ownSalt`, so holding a
> salt did not even change the verdict. A side that had agreed a salt therefore kept hashing under it
> after being told the peer could never hold one — and the peer refused every message.
> **A comment asserting a safety property the code lacks is how this defect survived review**, which
> is the standing rule in this repo and the reason it is written up rather than quietly patched.
>
> **THE FIX (`f7f742a`, `0d92725`) — two halves, split on whether the salt has been SPENT:**
> - **Unspent** (our adoption still open ⇒ no leaf, no hold, no awaiting-ack hash used it): discard
>   it — **row and memory cache both**, because `#saltForHashing` reads the cache first and never
>   consults the row, so a row-only clear would hash salted in this process and unsalted in the next.
>   That is the split transcript arriving at a daemon restart instead of at a frame.
> - **Spent** (a leaf is already hashed under it): **never discard** — erasing it leaves a transcript
>   no single rule can verify — and emit `session.salt.split` at **ERROR**, with the guidance that a
>   new session is the only repair. Kept as its own event rather than a tightened sentence on
>   `session.salt.adoption.refused`, whose ordinary case is genuinely benign; an operator who has
>   learned to skim that one must not skim this.
>
> **⚠️ WHAT THIS DOES NOT DO, stated because the tag would otherwise over-read.** It **prevents** the
> split when the losing side has not yet spent its salt, and makes it **diagnosable** when it has. It
> does **not repair** the session in the run above — that peer had already sent eight messages under
> its salt, so its salt is spent and nothing may erase it. That session stays dead; a new one is
> clean. **Preventing and repairing are different claims and only the first is delivered.**
>
> **Revert test, and it caught one of mine.** Deleting the discard call → red; deleting the
> `session.salt.split` error → red; deleting the adoption re-check **inside** `#discardUnspentSalt`
> → **GREEN, a survivor.** The cause was the caller, not the check: the call sat inside
> `if (adoption.closed) {…} else {…}`'s else, so the method's own check could never see a spent salt.
> Two places deciding the same thing, one unreachable. Called unconditionally now — the method owns
> the decision, and that same mutation reddens with *"a spent salt must NEVER be discarded"*.
> **Gate: 276 files, 2887 tests, 0 failures.**
>
> #### ⚠️ AC CARRIED FROM MY OWN INVARIANT CHECK — the split is loud in the log on the ONE side that has no other signal
>
> **Invariant 2 says failures are loud in the LOG *and* in the agent response, never one instead of
> the other. This unit currently does the log half only, and the asymmetry is the opposite of what I
> first assumed.** Traced rather than guessed:
> - **The side holding NO salt refuses inbound content** (`content_hash_salt_unavailable`) and **is
>   already told** — `REFUSED-INBOUND-SILENT-1` wired that branch, and its guidance even names the
>   permanent case: *"close the session and start a new one."* That operator is covered.
> - **The side holding the SALT is the blind one.** Its outbound messages are refused at the peer, so
>   they never appear there; and the peer's own unsalted messages still verify locally, so they keep
>   arriving. **From that operator's chair the counterparty is present and talking, but has stopped
>   responding to anything they actually said.** Nothing in a `cello_send` response says otherwise —
>   the send succeeds locally and at the relay, because the refusal happens on the far machine.
> - **`session.salt.split` fires on exactly that side.** So the diagnosis and the repair
>   (*"start a new session"*) exist, in a log that operator has no reason to open, and the one
>   agent-facing surface they do see reports success.
>
> **The AC:** the split must reach the agent, not only the log — most cheaply by carrying it on the
> send response the way `REFUSED-INBOUND-SILENT-1` carries unshown refusals on the reply, so the
> affordance travels with the action rather than sitting beside it.
>
> **Deliberately NOT built in this diff.** The unit review is in flight on a fixed commit range, and
> adding a second agent-facing surface underneath a running reviewer produces a verdict about code
> that no longer exists. Two passes is the cap, so the change lands as its own unit against this AC.
> **What I cannot prove from code alone:** whether the salted side's inbound path accepts the peer's
> unsalted content in every case or only when the declared algorithm matches — I read the refusal
> branch, not every producer of the declared `alg`. If it refuses too, both operators are told and
> this AC shrinks to guidance wording rather than a missing signal.
>
> #### 🔴 REVIEW PASS 1 — BLOCKING ON FOUR OF FIVE LENSES. Verdict quoted, not summarised.
>
> > *"This is not a rubber stamp. The unit does what its DoD says at the level of the branch it edits,
> > but the safety argument underneath it — 'the peer told us it can never adopt a salt, therefore the
> > peer holds no salt' — is false, and I demonstrated it by running the shipped pure function. On one
> > reachable path the fix **destroys a live, agreed, matching salt** and manufactures exactly the
> > user-visible failure the unit exists to prevent."*
>
> Lens results: **SPEC: DEVIATIONS FOUND** (three, un-journaled) · **SILENT FALLBACKS FOUND** (two
> HIGH) · **ERROR SUBSTITUTION FOUND** (two MEDIUM) · **HOLLOW TESTS FOUND** · **REMOVALS PROVEN**
> (n/a — 324 insertions, zero deletions).
>
> **I reproduced HIGH-1 before touching anything, and it was real:** 2 of 4 new pure-function tests
> red on the shipped code, `expected 'adoption_closed' to be 'confirmed'`. **My fix was worse than the
> defect on that path** — `adoption_closed: already_hashing` means *"I cannot adopt a NEW salt"*, and
> `onPeerSaltFrame` tested `ownAdoption.closed` before `ownSalt`, so a side holding salt S that had
> leafed a message answered a matching `fingerprint(S)` with a frame the receiver reads as *"I have
> none"* — and the receiver then erased **its own copy of the same salt**. Before that commit the
> session worked. Trigger is not exotic: one transient SQLCipher read error returns `closed: true`
> with `frontier_unreadable` and announces the same label, so **a momentary read failure on one
> machine would permanently destroy durable key material on the other.**
>
> **All six findings addressed** (`0d92725..8fac356`), each with the reasoning in the code rather than
> only in the commit:
> - **HIGH-1** → fixed at the PRODUCER: `state.ownAdoption?.closed && !state.ownSalt`. A side that
>   holds a salt has nothing to adopt, so the adoption question does not apply to it. Not moved above
>   the malformed-frame guard, because the `ownSalt` block relies on exactly one of
>   contribution/fingerprint being set. **The suggested belt fix — a wire field so a discard requires
>   proof — was deliberately NOT done:** pre-launch, no external installs, and the standing rule is
>   to re-derive against an empty database rather than carry compatibility for a state nobody is in.
> - **HIGH-2** → `#hashedWithSalt`, the missing mirror of `#hashedWithoutSalt`. The codebase already
>   knew this window existed and had closed only the unsalted direction; `#discardUnspentSalt` is the
>   first code to act on the answer destructively.
> - **MEDIUM-3** → `session.salt.discarded` is now the first branch in both guidance trees.
> - **MEDIUM-4** → `session.salt.split` branches on `adoption.label`; the unreadable case says **not**
>   to open a new session. A second instance surfaced while fixing it — the shared *"no message is
>   affected"* line — and branches too.
> - **LOW-5** → the boolean return is consumed.
> - **LOW-6 (orphaned doc block) → NOT addressed**, recorded rather than quietly dropped.
>
> **Revert test on every guard added: all four RED when deleted.** Gate: **277 files, 2892 tests, 0
> failures.**
>
> **🟡 THE TAG DOES NOT FLIP ON THIS.** Pass 2 is out on the fix diff and is the hard cap. Given pass
> 1 found the fix worse than the defect on one path, a second pass on the same code is the point.
>
> #### THE DESIGN CHANGED AFTER PASS 1: SUSPEND, NOT ERASE — and the reframing was the other lane's
>
> I defended the immediate erase as a **compatibility** question. It was an **authorization** one: the
> receiver destroyed durable key material on a peer's unauthenticated assertion with nothing to check
> it against. Their sentence is the one to keep — *"a control that depends on the other side honouring
> it is not a control"* — and my own trigger was the evidence I had written down and walked past:
> `frontier_unreadable` is **a healthy current peer having one bad second**, not an old build. Fixing
> the producer left *"one side of that exchange correct by construction, the other still correct by
> luck."*
>
> Their recommendation was cheaper than the wire field I was weighing: **stop destroying.** A salt
> that is not used is inert; the destruction is what turned a transient disagreement permanent, and
> with nothing irreversible hanging on the claim, proving the claim stops being load-bearing.
>
> **My refinement on top, because plain mark-and-keep splits the transcript at the next restart**
> (unsalted now, salted after a reboot) and a durable mark needs a column this milestone has twice
> lost data over: the mark is in memory and **the erase is DEFERRED to the first unsalted hash** — the
> moment it becomes both harmless (nothing hashed under it) and required. Placed **before** the
> `#hashedWithoutSalt` increment on purpose: that counter closes adoption, so incrementing first would
> make our own guard refuse the erase we had just decided was correct.
>
> **What it buys that erasure forecloses even in principle:** if the peer was merely unable to read
> its own state, its next announcement with a matching fingerprint **resumes the session fully
> salted**. A salt is a one-way function of two halves — an erased one cannot be re-derived from one
> side. The test asserts the resumed session actually hashes `hmac-sha256-salt-v1` again, because a
> log line reading *"resumed"* over a session still hashing `sha256` is this milestone's signature
> defect and it was not going to ship inside the fix for it.
>
> #### REVERT TEST ON THE SUSPEND/RESUME GUARDS — three mutations, three reds, each naming the damage
>
> | mutation | result |
> |---|---|
> | delete the suspension check in `#saltForHashing` | **RED** — `expected 'hmac-sha256-salt-v1' to be 'sha256'` |
> | delete the `#resumeSalt` call | **RED** — `the session must come back salted: expected +0 to be 1` |
> | delete the deferred erase | **RED** — `keeping the salt would split the transcript at the next restart` |
>
> With the four from the earlier set (discard call, adoption re-check, `session.salt.split`, in-flight
> guard) that is **seven guards, seven reds, zero survivors** on this unit.
>
> #### 🔴 CORRECTION — "SEVEN REDS, ZERO SURVIVORS" WAS FALSE BY THE TIME I WROTE IT
>
> **Pass 2 re-ran those mutations against the FINAL tree and three of them came back green.** They
> were genuinely red when I ran them — against the pass-1 code — and **the suspend redesign silently
> made them pass again.** I reported the old numbers as if they described the shipped tree.
>
> That is the lesson, and it generalises past this unit: **a revert test is a property of a tree, not
> of a guard.** Re-run them against the tree you are actually shipping, or the number you quote is
> archaeology. Both of us had this backwards — the dispatch I wrote for pass 2 listed those same
> mutations as "already run and RED".
>
> #### 🔴 REVIEW PASS 2 — BLOCKING ON ALL FIVE LENSES. Verdict quoted.
>
> > *"I ran the unit's code rather than reasoned about it. Five confirmed defects, three of them
> > reproduced end-to-end, plus three proven test survivors."*
> > … *"Note the direction of the regression: the pass-1 immediate-erase design could not produce
> > this. When the discard was refused there, the session simply kept hashing salted — one rule
> > throughout, loud via `session.salt.split`. Suspension is what lets us go unsalted while the bytes
> > survive. **This is pass 1's pattern repeating: the fix is worse than the defect on one path.**"*
>
> **F2 (HIGH) — mine, and the second time in this unit that my fix reintroduced its own defect.** The
> deferred erase was ordered before the `#hashedWithoutSalt` increment because that counter closes
> adoption. **It is one of four contributors** — leaves, held rows and awaiting-ack close it too, and
> the most ordinary event in the protocol closes it: *the peer sends its next message.* Reproduced
> through the real inbound path: suspend → peer's message lands as leaf 0 → we hash `sha256` with the
> bytes still on disk → one teardown-and-revive later, **no process restart**, `hmac` again.
> **Fixed by making the two atomic:** if the salt cannot be erased we do not go unsalted — we keep
> hashing under it, one rule for the whole session, and raise `session.salt.split`. A dead session
> beats a transcript no single rule can verify.
>
> **F1 (HIGH)** — `#resumeSalt` deleted the mark unconditionally, so a session that had already hashed
> unsalted could resume salted: `m1` under `sha256`, `m2` under `hmac`, one process, no restart —
> while `session.salt.resumed` asserted *"the transcript is uniform"*. **The code never checked the
> thing its own log line claimed**, which is this milestone's signature defect committed inside the
> fix for it. Now refuses on `#unsaltedAnnounced` and releases the salt.
>
> **F3 (MEDIUM-HIGH)** — `contentSalted` on the agent surface read *possession*, so every suspended
> session reported **protected** while hashing `sha256` on every message. That surface's own comment
> says *"a security property must not be inferable from a gap"*; it was **affirmatively false, not
> gapped**. New `isContentSaltActive` uses the same predicate `#saltForHashing` does.
> `getSessionContentSalt` is unchanged, because the verifier needs possession: a message parked before
> suspension was hashed under that salt.
>
> **F4** — two log lines told the operator to *"see `session.salt.split` on the next line"* for a case
> where the logger sat inside `if (adoption.closed)` and never fired. Moved out; the condition was
> always `stillHoldsSalt`, only its placement disagreed. **F5** — the suspension mark survived a
> successful erase, so a later agreed salt would be logged, surfaced as protected, and silently never
> used.
>
> **Survivors, re-measured after the fixes: two now RED** (the in-flight arm of `#suspendSalt`; the
> discard's adoption re-check). **The third genuinely survives and is labelled in the code rather than
> claimed** — deleting `#discardUnspentSalt`'s own in-flight guard leaves the suite green, because
> `#suspendSalt` refuses first and both callers require the mark. Kept because it sits at an
> irreversible write; the earlier fix for this shape (make the guard the decision-maker) is not
> available here, since `#suspendSalt` must refuse early. **Not claimed as coverage.**
>
> **Gate after the fixes: 278 files, 2906 tests, 0 failures; root typecheck 0; eslint 0.**
>
> #### 🅿️ PASS 2 LEFTOVERS → ACs (the two-pass cap is spent; these do NOT get a pass 3)
> - **F6** — `#hashedWithSalt` is cleared on teardown while a parked salted message still depends on
>   it; the revived session reads an empty frontier and can then erase the salt the parked message was
>   hashed under. Grounding "spent" in the durable park/awaiting-ack record is the real fix.
> - **F7** — the HIGH-1 producer fix turns one previously-terminal cell (`salt=S · half absent ·
>   adopt=already_hashing · frame=contribution`) into `freeze salt_state_divergent`, which destroys
>   the session and refuses revival. `half absent` is not exotic — teardown drops it. **Untested.**
> - **F9** — the `hasClosed` branch announces `peer_closed_first` whenever our adoption is open, but
>   the caller may then refuse the suspension for `inFlight > 0`: HIGH-1's exact lie, one round trip
>   wide, at the other branch.
> - **F10 / F11 (pre-existing)** — `UNSALTED_GUIDANCE[PEER_CLOSED_ADOPTION]` asserts `already_hashing`
>   for a peer that sent `frontier_unreadable`; and a transient salt READ failure splits the transcript
>   by the same mechanism, independent of this unit.
> - **LOW-6** — orphaned doc blocks; one was fixed in passing during F4's move, the rest stand.
> **✅ SECOND CLAUSE — an assertion on an absent value keeps its diagnostic.** Both review passes
> spent (→ Entry 64). Pass 2: *"NO SILENT FALLBACKS — and the unit removes one"*, *"REMOVALS
> PROVEN"*. **Measured, not believed:** the other lane ran the `trustless-cello` root — 1742 passed,
> 0 failed — which covers `expect-present` and its enforcer.
>
> Eleven at-risk sites, not the five I first counted or the eight the first review counted. **The
> count is now computed from the tree by an enforcer**, so a twelfth fails on the commit that adds
> it. One site (`j-suspend-tofn:172`) is exempt with a written reason and taken by the other lane.
>
> ⚠️ **THE ROOT GREEN COVERS LESS THAN IT LOOKS.** 39 files and 609 tests were SKIPPED — the spine
> lane is excluded from every environment. So this says the in-process suite is clean; it says
> nothing about the journeys, which is where two of the night's findings came from.
>
> **🟡 THE JOURNEY HALF IS CONVERTED AND UNRUN.** The five named below are converted, plus a sixth
> (`j-documents`/`j-multiplayer`, surfaced by `SEALWIRE-1` bullet 8's better message) and a seventh
> pair in `j-gcp-live` — where the CLI's `close-session` maps onto the same non-blocking verb, so it
> asserted the pre-M12 contract too, with no custom message to lose. The other lane is running the
> full spine lane now, against a current binary for the first time. **It does not close until that
> reports.**

#### Original finding — five seal journeys expect a receipt that close no longer returns
**BLOCKS LAUNCH** (§0z.1) — but as **TEST DEBT, not a product defect.** The product is correct and
the tests are stale.

> **A SIXTH, surfaced 2026-08-24 by `SEALWIRE-1` bullet 8 — and it is worth recording HOW.** In
> `j-documents`, bullet 8 replaced a bare `expected false to be true` with the daemon's own verdict.
> The test still fails, but it now reads:
> `A has no sealed root: {"ok":false,"reason":"seal_in_progress","seal_status":"committed",…}`
> **That is this line's exact shape** — close commits and returns, the receipt is fetched afterwards,
> and the journey asks at close. `awaitSealedRoot()` in `live-harness.ts` polls the receipt and
> prints the last response on timeout; it exists for precisely this.
> **The point is the diagnostic, not the count.** `expected false to be true` named nothing and could
> have been anything; one assertion carrying the daemon's answer instead of re-deriving it turned an
> unexplained red into a filed instance of a known cause, with no new investigation. That is the
> argument for bullet 8 generally, measured rather than asserted. **This line previously said the opposite in the strongest possible terms, and
that was WRONG. See the retraction below; it is the more useful half of this entry.**

> ### 🚨 RETRACTED — I opened this as a blocking PRODUCT defect and told Andre it was the most
> ### valuable fix available. It is neither. Close works exactly as designed.
>
> **What close actually returns** (printed at last, by fixing the assertion — see below):
> `{"ok":true, "seal_status":"committed", "guidance":"Your SEAL commitment … is recorded and the
> notarization is now running in the background. The receipt is NOT YET available: the seal completes
> as soon as the counterparty also closes… Fetch it with cello_sealed_receipt … an empty answer
> before then means 'still running', not 'failed'. Do NOT re-close with force:true to hurry it:
> forcing ABANDONS the session and forfeits the receipt this is earning, **which is exactly how
> seventeen sessions were lost when this call used to block**."}`
>
> Close was deliberately made **non-blocking** because the blocking version lost seventeen sessions.
> It returns a commitment, explains that the receipt is coming, names the tool to fetch it, and warns
> against the one action that would destroy it. **That is the system doing the right thing and
> saying so.** The five failing journeys assert a synchronous `sealed_root` — the OLD contract — and
> nobody noticed because the lane has never been run since the change.
>
> **This is precisely what this milestone's own triage predicted** — *"the lane has been unrun for
> long enough that some failures will be stale expectations rather than regressions"* — written by
> me, four hours ago, and then not applied to the first candidate that fit it.
>
> **Why I got it wrong is the transferable part: I could not see the response, and I treated
> "undefined" as the finding instead of as a missing observation.** `.toMatch()` on `undefined`
> throws a `TypeError` **before** vitest attaches the custom message — so the `diag` string the test
> carefully assembles, containing the whole close response and the daemon's seal log, was discarded
> at the exact moment it was needed. Asserting `.toBeDefined()` first prints it. **The answer had
> been in the test the whole time and the assertion form threw it away.**

- **The work:** five journeys — loopback, bilateral seal, unilateral seal, the ABSENT gate,
  auto-acknowledge close — move from *"close returns the root"* to *"close returns a commitment, then
  poll `cello_sealed_receipt` until the root arrives"*. That is the contract the daemon documents in
  its own guidance string.
- **Blocks only because the close gate needs the lane green.** A customer is unaffected — this is
  our evidence, not their experience. Nothing here is urgent in the way the retracted version was.
- **Do the assertion fix everywhere in the same pass.** `expect(x, msg).toMatch(...)` silently
  discards `msg` whenever `x` is undefined, which is the single most likely thing to be wrong. Any
  spine assertion matching on a possibly-absent field needs a `.toBeDefined()` in front of it, or the
  next unattributable failure costs another evening.

- **Reproduced twice, independently, at HEAD** — `CELLO_Coder_1` and then `CELLO_Support`. Both
  reproductions were correct and both conclusions drawn from them were wrong: the observation
  `ok === true, sealed_root === undefined` is exactly what a non-blocking close looks like.
- **PRE-EXISTING, and the other lane proved it rather than argued it.** Skew was ruled out: the
  binary carried the current build (checked by symbol, not timestamp). B2b was exonerated by two
  rebuilt probes — cutting the salt wait from 5000ms to 50ms, and bypassing the salted branch
  entirely so every hash is plain `sha256`. **Failed identically in both.** So it is not this
  milestone's work, and there is no baseline saying it ever passed: the lane had never been run.
- **NOT diagnosed, and the honest gap is recorded.** The only `ok: true` without a root in
  `close-session-handler.ts` is the `force: true` abandon path, which the spine does not take. So
  the branch responsible is somewhere neither lane reached. **The ~4.5s is identical across all
  three runs, which reads like a fixed timeout being hit rather than a race** — that is a lead, and
  the never-diagnose-a-race rule applies: find and quote the condition.
- **Five of the lane's 49 failures share this shape** — unilateral seal, the ABSENT gate,
  auto-acknowledge close, bilateral seal, loopback. If one cause explains them, that is a fifth of
  the red lane and the most valuable single fix available.
- **Enforcer:** `j-loopback` green, and a unit test at the handler that fails if any path returns
  `ok: true` without a `sealed_root` — the shape, not the instance.

---

### `DOD-M15-CLIJSON-1` — ✅ A command that prints JSON prints only JSON
> **FIXED, review in flight.** `cello-client` — `CommandResult` gains a `guidance` field documented
> as stderr-only; `register()` returns pure JSON; `legacy()` routes `guidance` to the `stderr`
> channel `CliOutput` already had and always set to `""`. tsc 0, eslint 0, CLI rebuilt.
> **Verified against the shipped binary, not argued:** `j-refresh` previously died at its FIRST line
> on this parse error and now clears registration entirely, failing later on the separate stale
> close-contract assertion (`DOD-M15-CLOSEROOT-1`) — which is the triage confirming its own
> clustering. **The hint is kept, on stderr.**
> **CLOSED on a quoted verdict.** Reviewer: *"This unit is not shippable as committed — it ships a
> RED test… tsc and eslint pass; the test gate was not run for this unit."* Correct, and mine: I ran
> typecheck and lint and skipped the package suite, which exists so that "it compiles" is not
> mistaken for "it works". Condition met — F1 re-pointed, the enforcer added, and F2/F3 taken in the
> same pass. Gate: 18 files / **295 tests**, tsc 0, eslint 0.
>
> **The guard I broke had never checked the thing that mattered.** It asserted the four onboarding
> cues appeared in `output` — and passing said NOTHING about which stream they were on, so the hint
> sat inside the JSON for months with that test green. It now asserts them on `guidance` (proving
> the hint survives AND where it went) and asserts `output` by **exact equality** to the JSON, so a
> future append is red. A substring assertion could never have done that.
>
> **THE ENFORCER**, priced by the reviewer and it was right: four spine journeys already register
> against the shipped binaries and already pay for a daemon and a DKG, and each asserted only
> `status === 0` — **true throughout the defect, because the command really did succeed.** Each now
> also parses the stdout. *Exit 0 proves the command worked; parsing proves its output is usable, and
> those are different claims.* Zero added runtime.
>
> **F2, taken in the same pass — the same defect one branch over.** Five failure branches printed
> prose on stdout with exit 1, so `register-agent alice $TOK | jq` still died on the two failures a
> scripter actually hits: an unset `$TOK`, and a daemon that is not up. All five now emit
> `{ok:false, reason, guidance}`. **Verified by capturing both streams to separate files** — my
> first check appeared to show invalid JSON and duplicate stderr, and that was my own shell
> redirection, not the program. Measuring stopped me "fixing" an escaping bug that does not exist.
>
> **F3:** the top-level help named `register-agent` among the commands that *"print human text, and
> their failures go to stdout"* — false in both halves, and addressed to exactly the reader deciding
> whether to script onboarding.
>
> **CARRIED (reviewer F5), not silence:** nine `jsonOut` commands print a `Usage:` line or a whole
> help block on **stdout** with exit 1 on an argument error — against `json-out.ts`'s own written
> contract that *"stdout stays EMPTY so a piping script can never mistake an error body for a
> result."* Lower severity (exit is non-zero, so a `$?`-checking script is safe), same family.
> Also carried: `bin/cello.ts` wires `onProgress` to **stdout** — only a prose command uses it
> today, and the day a JSON command gets progress lines this defect returns. One-line fix.
**BLOCKS LAUNCH** (§0z.1): the CLI states its own contract — *"Prints JSON; use `--pretty` for
humans"* — and `register-agent` breaks it on the SUCCESS path, so anything reading that output
fails at the first step. Found by `DOD-M15-SPINERED-1`'s triage, 2026-08-23, and it is the largest
single cluster in the red lane.

- **What it does.** `cello register-agent` registers successfully, **exits 0**, prints its JSON —
  and then appends a human hint to **stdout**:
  `Next: run  cello status  to confirm 'agentA' is registered.` plus three bullet lines.
- **What that costs a person:** anyone scripting registration — the obvious thing to script, since
  it is step 2 of 2 in onboarding — gets a parse error on a command that WORKED. The failure names a
  byte offset, not a cause, so it reads as "registration is broken" when registration is fine.
- **What it costs us today:** five spine journeys die at their first line
  (`DOD-M15-SPINERED-1`), which is a meaningful share of the 21 red files in the lane the
  milestone-close gate depends on.
- **The fix is where the hint goes, not whether it exists.** The hint is GOOD — it is the thing that
  tells a new operator registration is asynchronous and may take a minute. It belongs on **stderr**,
  which is exactly what stderr is for: guidance for a human, out of the data stream. Do not delete
  it; do not gate it behind a flag that defaults to off.
- **Audit the neighbours in the same pass.** `register-agent` is unlikely to be the only command
  that appends prose to a JSON result — check every command whose help promises JSON.
- **Enforcer:** for each command that advertises JSON, `JSON.parse` of its stdout succeeds on the
  SUCCESS path, asserted against the shipped binary rather than a unit stub.

---

### `DOD-M15-SPINE-LANE-1` — ✅ The spine suites are run, or their absence is a decision on the record
> **CLOSED 2026-08-23 (CELLO_Support) → Entry S12.** Reviewed; three blocking findings, all fixed.
> Verdict quoted: *"SPEC: DEVIATIONS FOUND — clause 3 only. The decision is right; its recorded
> reason is false… and neither the decision nor the receipt is attached to SPINE-LANE-1's own DoD
> entry."* Gate: 8/8, tsc 0, eslint 0, enforcer revert-tested.
>
> **THE DECISION: manual, not scheduled.** (1) `cross-machine` needs a second physical machine.
> (2) The spine config needs the `cello-portal` sibling repo checked out beside this one — a
> cross-repo checkout credential, not a config line. (3) The lane is 56 minutes and **half red**, so
> scheduling it today creates a permanently red required check, which `.github/workflows/ci.yml`'s
> own header already rules against. **REVISIT once `SPINERED-1` is green** — the CI host exists.
>
> **OWNER — spine:** whichever lane closes M15 runs it BEFORE the close gate and pastes the result
> into the journal. `.claude/CLAUDE.md` says no milestone closes without a live multi-process smoke
> test; **this is that test**, so a close without it is a close without evidence.
> **OWNER — cross-machine:** Andre, by hand, on the two-machine setup. Not required for the close
> gate; required before claiming cross-machine support.
>
> **RECEIPT:** Entry S12 + `receipts/2026-08-23_spine-lane-full-run.log`. 21/36 red → `SPINERED-1`.
>
> **⚠️ TWO FALSE STATEMENTS I COMMITTED AND THE REVIEW CAUGHT**, recorded because both were the
> milestone's own defect class: *"the lane is not rotted"* (written after ONE green file, falsified
> by the full run), and *"the only CI is the stale AWS pipeline set"* (`ci.yml` is live and the same
> file says so 190 lines below). The decision survived; its stated reason did not.
>
> **The enforcer, and its honest limit.** The declaration is no longer prose: each hidden lane names
> a command, and the command is asserted to EXIST **and to collect the excluded pattern** — narrowing
> the spine config's `include` would otherwise un-collect 35 files with the script name untouched,
> which is `CI-SKIPS-SILENT-1` reproduced inside the escape hatch built to close it. It still proves
> only that the lane is *reachable*, never that it *works*; "works" is `SPINERED-1`.
>
> **CARRIED:** both guards read only `exclude:` in `packages/*/vitest.config.ts` — a narrowed
> `include:` hides files just as completely and neither sees it. That is failure mode #2 from this
> guard file's own header, half-covered.
>
> **⚠️ OPERATIONAL, measured 2026-08-23: THE SPINE LANE CANNOT RUN CONCURRENTLY WITH ITSELF.** It
> binds FIXED ports — a second run dies with `EADDRINUSE: address already in use :::65471`, the
> relay exits code 1, and the journey reports as *skipped* with a hook timeout. **That reads as a
> flaky test and is not one.** Two lanes sharing a machine hit it immediately; so would a CI job
> running this beside anything else. The manual-only decision above already implies one runner at a
> time, but nothing SAYS it, and the failure it produces does not name its own cause.
Split from `DOD-M15-CI-SKIPS-SILENT-1`. **37** files (the line said 38; measured) — the M8D spine lane plus the cross-machine
transport tests — are excluded by `packages/e2e-tests/vitest.config.ts` and therefore **never
collect under any environment**. Worse than the env-gated suites, which at least print a skipped
line; these produce no output at all.
- They are now *declared* with a written reason, and an undeclared exclusion fails the gate. That
  closes the silence, not the gap.
- The spine suites are the multi-process evidence the milestone-close gate depends on
  (`.claude/CLAUDE.md`: "No milestone closes until a live multi-process smoke test passes"). A lane
  that nothing runs cannot serve that.
- **Decide and record which it is:** wire the lane into a command that runs on a schedule, or state
  in writing that it is manual-only and name who runs it before a milestone closes.
- **Enforcer:** receipt.

---

### `DOD-M15-SIGNUP-DURABLE-1` — ✅ The signup limiter survives a deploy
> **Shipped and reviewed 2026-08-22 → Entries 17, 19, 21.** `45506993` (unit), `ec053ed3` (the
> migration fix that running the database suites exposed), `edb2e5fb` (review fixes). Gate: 20 files
> / 237 tests green against a real Postgres; 157 / 1678 on the default gate; lint 0, typecheck.
>
> **Review verdict:** *"SPEC: DEVIATIONS FOUND"* — and all three blocking items are fixed:
> - **The refusal nobody heard.** Failing closed on a database error is right; doing only that meant
>   the person received **nothing** — no message, resend, nothing again, record expiring seven days
>   later. This file had already ruled on that exact mistake 600 lines above (*"Failing closed and
>   saying so are independent"*) and the new code reproduced the false dichotomy that passage
>   rejects. Now: catch, tell them, rethrow — pinned by an assertion that goes red without it.
> - **A comment that disclaimed the fix.** The docblock on the durable count was the old in-memory
>   one, still warning *"STILL IN MEMORY … `DOD-M15-SIGNUP-DURABLE-1` carries that"* — on the
>   function that closed it.
> - **A retention method that could not run.** `pruneOtpSendsBefore` DELETEd from a table where V63
>   revokes DELETE from both roles the pool can authenticate as, and had no caller. Removed.
>
> The reviewer confirmed the two clauses the DoD line specifically warned about — **rolling shape**
> and **requester key** — are faithful, and that the fail-closed argument holds for a whole-database
> outage while failing for the table-scoped case that actually happened.

Split from `DOD-M15-SIGNUP-1`, which rekeyed the limiter from the email domain to the address
fingerprint but left it in memory. **The clause asking for durability is NOT met and is carried
here rather than quietly dropped.**
- `#otpSends` lives in a single-instance process, so every restart and every deploy empties it — it
  was wiped by the ops-agent deploy on 2026-08-09. An abuser clears it by waiting for a release.
- **Store the shape that shipped, not the one the clause originally named:** `channelUserId →
  timestamp list`, rolling. A fixed window with a stale `windowStart` carries the unbounded-growth
  problem into the database with it, and **the key is the REQUESTER, not the address fingerprint** —
  building a table keyed on the address would rebuild the design the review overturned.
- **What the rekey DID fix is the half that hurts real people**: five strangers sharing an email
  provider no longer refuse the sixth a verification code, which is exactly what an invite wave
  would have hit. What it does not yet do is bite an abuser.
- Needs a table in the bot's own database and a Flyway migration (the registrations schema is at
  V62). **Sequence with `DOD-M15-RELAYABUSE-1`** — both are rate-limiting work, and a limiter that
  is durable in one place and amnesiac in another invites the wrong conclusion about which is which.

---

### `DOD-M15-MIGRATION-GUARD-1` — ✅ The upgrade guard checks all seven rebuilt tables, not one
> **CLOSED 2026-08-23 (CELLO_Support, taken from CELLO_Coder_1) → Entry S11.** Two review passes.
> Pass-2 verdict quoted: *"HOLLOW TESTS FOUND — [blocking] on Findings 1 and 2. Three parser fixes
> with zero revert coverage, and an inverse assertion that is structurally incapable of reaching the
> defect class… The condition, and it is one small additive edit — test-file only, no production
> surface, no third review pass needed."* **Both conditions met**, and writing the first found a
> THIRD defect neither pass had proven. Gate: 7/7 + sibling guard 8/8 + tsc 0 + eslint 0.
>
> **The reviewer reverted all three of pass-1's parser fixes and the file stayed GREEN** — each
> produces identical output against today's sources, because no current column uses the shapes they
> were fixed for. The pass-1 bypasses were proven by hand-mutating source and that evidence was
> never committed, so the next edit reintroducing any of them would have passed. This file's own
> thesis, turned on itself. The three cases are now committed as unit tests on the parsers.
>
> **Writing them found the third defect: a `//` or `/*` INSIDE a string literal is not a comment**,
> but stripping comments before finding literals cannot tell — so it ate the rest of the line and
> the `ALTER TABLE` on the next line vanished silently. Comment state and string state are now one
> scan; two passes each guess about the other.
>
> **And the inverse assertion could not reach the defect class.** It derived its expectation from the
> pinned DDL, so a column missing from the pinned DDL *and* missed by the parser was in neither set:
> nothing reddened, operator loses the data. Closed from the other side — count the raw `ALTER TABLE`
> occurrences in the source and require the parser to have produced exactly that many. **Raw, not
> comment-stripped**, deliberately: a stripped count moves *together* with the parser if
> `stripComments` corrupts the text, and two wrong numbers that agree is the same false-agreement
> shape being closed.
>
> **CARRIED, not reopened** (reviewer: *"the right size to carry as ACs on a later unit"*): the
> coverage-police exemption is keyed on a FILENAME, so adding a rebuilt table to
> `trust-signal-store.ts`'s literal list keeps it green — parse the list and assert the intersection
> with the seven is empty. `readdirSync` is non-recursive (`core/daemon/src/bin/` unscanned; clean
> today). `arrayEnd` truncates at the first `]` under a `> 0` floor. And the replay passes
> `silentLogger()`, discarding the one event that names which fragment failed — the raw SQLite text
> is `incomplete input`, which names neither table nor column.
**Found 2026-08-23 while adding a column for `DOD-M15-SEALWIRE-1` B2b, and it is why that column's
neighbours were found missing.** Raised with `CELLO_Support` over CELLO because it exposes both
lanes; test-only, and in neither lane's current unit.

`agent-id-migration.ts` rebuilds **seven** tables from a pinned DDL and copies the INTERSECTION of
the old and new column lists. So a column added by an inline `ALTER TABLE` and omitted from that DDL
is **dropped on the one boot where a legacy database upgrades** — and then re-added EMPTY by the same
ALTER moments later, which is what makes it silent: every observation after the fact shows the column
present.

`dod-agent-id-joinkey-migration` is the guard for exactly this, and it has caught the class **three
times** — `read_at`, `diverged_at`, `content_salt`. **It replays only the `sessions` inline ALTERs.**
The other six rebuilt tables have nothing between a forgotten column and silent data loss.

> **CORRECTED 2026-08-23. This line previously said FOUR, counting `retry_queue`'s ordering columns,
> and that was wrong** — the last surviving copy of a claim that was also in `agent-id-migration.ts`
> and in this unit's test header. Verified against git, not reasoned from the code: the re-key
> shipped `173d34f` 2026-07-10 and is ONE-SHOT; `structure1_cbor` shipped `6cea544` 2026-08-05;
> `RetryQueue` is constructed once, at `daemon.ts:1905`, after `initialize()`. **Every database that
> ever ran the re-key did so a month before those columns existed. Nothing was lost.**
>
> The narrower truth is worse than the claim it replaces, which is why it is worth having. The
> intersection-copy mechanism is real; it is unreachable for that table only because the constructor
> runs after the migration — and `daemon.ts` puts roughly **1,400 lines** between them, held apart by
> a comment saying not to reorder. CELLO_Coder_1's phrasing: *a convention with 1,400 lines between
> its two halves is not a convention, it is a coincidence with good documentation.* The columns stay
> in the pinned DDL: free while the order holds, and the difference between silent loss and no loss
> the day someone moves the construction up.

- **The bar:** the guard replays EVERY rebuilt table's inline ALTERs in the real boot order, not just
  `sessions`'. `retry_queue`'s live in `retry-queue.ts`'s constructor and `contacts`' in
  `contacts-tier-migration.ts`, so this means the guard reaches across files — which is precisely why
  it did not.
- **Not a schema comparison — a DATA one.** A matching column set is what already passes today for
  `retry_queue`: the column is present after the rebuild and empty. The guard must seed a value
  before migrating and assert the value afterwards, as the `content_salt` and `retry_queue` upgrade
  tests do.
- **The rule this makes precise, and it is narrower than either lane was holding it:** not "a
  client-side column needs two entries" but *"a column added to any of the seven rebuilt tables needs
  two entries, and only one of the seven is guarded."*
- **Enforcer:** receipt.

---

### `DOD-M15-DIVERGE-DURABLE-1` — ✅ The divergence flag survives a daemon restart
> **CLOSED 2026-08-22, in the four-unit DAEMON-PATH batch review** (`BACKUP-1`, `DOORBELL-1`,
> `DIVERGE-DURABLE-1`, `IPCVISIBLE-1` reviewed as one pass — Entry 55).
>
> ⚠️ **THIS ENTRY USED TO QUOTE A VERDICT WHOSE EVERY NAMED FINDING WAS ABOUT `BACKUP-1`** — the
> world-readable key at `O_CREAT`, the database overwrite ordering, the `readLock` guard. None of them
> mention this line. Andre found it by reading the DoD end to end; `grep` could not, because the
> artifact was present and only its SUBJECT was wrong. Corrected 2026-08-24 to quote **this line's
> own** finding from that pass:
>
> *"the flag was in memory, so a restart turned 'provably cannot seal' into 'healthy'. **The
> migration meant to carry the new column was DROPPING it**, because that migration rebuilds the
> table from its own column list. Caught by the gate, not by reading."*
>
> Plus a second defect the same pass recorded against it: the divergence flag was written and cleared
> **without the agent key**, so on the loopback case — two of Andre's agents on one daemon — one side
> sealing ERASED the other's divergence. **This line's own defect, produced by this line's own clear.**
>
> **Both statements were mis-keyed**: `WHERE session_id = ?` without `agent_id`. The PK is composite
> because two of one operator's agents can hold both ends of the SAME session_id on one daemon —
> Andre's daily setup. Unkeyed, one side sealing ERASED the other side's divergence, producing this
> line's own defect from this line's own clear. My scoping test missed it by using two sessions of
> one agent; rewritten to two agents on one session and revert-tested.
> **BUILT 2026-08-22, unreviewed.** `sessions.diverged_at`, rehydrated at boot. Two placement defects
> caught by the gate: the loader ran before `migrateSessionTablesToAgentId` (which adds the `agent_id`
> the query joins on), and that migration REBUILDS the table carrying only its own column list — so
> the new column was being DROPPED on the one boot a legacy database upgrades, and a dropped
> divergence reads as healthy. Both fixed.
`#diverged` is in memory. `DOD-M15-DIVERGE-1` closed the in-process hole — it is no longer dropped
on node teardown, only at a terminal status — but a restart still empties it, and the read site
cannot distinguish *not diverged* from *forgotten*: both are `false`, both read ready.
- **Not the same trade `frontier-mismatch.ts` accepts on purpose.** A frontier mismatch is
  **re-detected by the very next close**; divergence is re-detected only by the next send that gets
  an ack behind the frontier. A restart therefore costs a **wrong answer**, not a re-detection.
- Needs a column. Until it lands, no guidance may promise that a retry answers identically.

---

### `DOD-M15-FRAME-1` — ✅ A stranger cannot inject content on the direct path
> **Shipped and reviewed 2026-08-22 → Entries 4, 6, 7.** cello-client `4015c7f` + `15a960a` +
> `551930b` + `497cfa4`, merged. Six review findings, three blocking, all fixed. Gate: 4006 tests,
> lint, forced typecheck, build. **One clause carried, not claimed: `DOD-M15-FREEZE-STATUS-1`.**
> The "session-ending" clause shipped as **peer-ending** at the peer gate — a deliberate, recorded
> deviation, because session-ending there would let a pre-positioned stranger kill any session with
> one frame. Session-ending stays where the evidence is about the counterparty: the identity freeze.
One diff across the session content handler and the connection gater; fixing any subset leaves the
injection path open.
- The direct-path **content frame** is pinned to the dialing peer: `remotePeerId` must equal the
  session's counterparty Peer ID, and `session_id` is required-and-equal. The session-abandon
  handler three blocks above already does exactly this.
- The direct-path **delivery acknowledgement** is pinned the same way. A forged ack today cancels
  the park-on-undelivered timer, so a stranger holding an open connection can make an operator's
  messages vanish while they appear delivered.
- **Then audit every other handler registered on the session protocol** — not only the two named.
- **Missing, malformed and mismatched take ONE hard-fail path.** Non-negotiable and separately
  testable: an attacker evading a mismatch check simply supplies no proof at all.
- **Promotion disconnects peers not on the new allow-list.** libp2p's gater runs only at connection
  establishment, so narrowing it leaves a pre-positioned stranger attached when the content protocol
  activates.
- The refusal is **session-ending, not per-message**, and its status is distinct from an ordinary
  "counterparty absent" close, worded as an observation — *"a message failed to verify against the
  expected counterparty's key; session frozen defensively; cause undetermined"* — never as an
  assertion of intent, and **excluded from feeding any trust-signal or reputation score.**
- **Enforcer:** stranger.

---

### `DOD-M15-ASSIGN-1` — ✅ The assignment is verified, then gated on
> **Shipped and reviewed 2026-08-22 → Entries 13, 14, 16, 17.** cello-client `1ddcd63` + `3985cb2`
> (a), `59ac4db` (b), `b72e74b` + `6a80b00` (review fixes). Gate: **4028 passed**, lint, typecheck,
> build.
>
> **Two review passes — the hard cap — and the second returned:** *"SPEC: FAITHFUL — all five
> findings addressed as described; no clause silently simplified in the fixes. NO SILENT FALLBACKS.
> ERRORS NAME THEIR CAUSE. TESTS HAVE TEETH — the wiring test survives the revert test. REMOVALS
> PROVEN."* The two items it said it would not close on (`N2` the 19-second test reaching production
> code by a legacy fallback, `N3` the relay carve-out resting on a directory-supplied set) are both
> fixed in `6a80b00`.
>
> **The first pass found a complete bypass of clause (a)** — one unsigned field (`signature_type`)
> routed the check to a branch that verified a key against itself — **and a regression clause (b)
> had shipped an hour earlier**, where narrowing the gate silently cost the agent its ability to
> submit a seal. Both closed. The `identify` disclosure closes as a consequence of (b): a stranger
> who cannot complete the handshake never reaches the protocol that would hand back the agent's
> public key, listen addresses and protocol list.
>
> **Carried, as named lines rather than folded into this tag:** `DOD-M15-OFFER-SIGNED-1`,
> `DOD-M15-OFFER-EXPIRY-1`, `DOD-M15-RESPONDER-VERIFY-1`.

**Order is load-bearing: verification lands first.** Gating on an unverified document relocates
trust rather than closing it, so a release carrying the gate without the verification is worse than
neither. They ship together.
- **(a) The client verifies the directory's signature on the session assignment.** Today the parser
  shape-validates only, asserting signatures are 64 bytes, with a comment naming a downstream
  verification site that does not exist in the tree.
- **(b) The standing receiver refuses any dialer whose Peer ID is not named in a live
  ~~directory-signed assignment~~ SESSION OFFER.** ⚠️ **AMENDED 2026-08-22 after review — the
  original wording claimed something the implementation does not do, and the honest fix is to stop
  claiming it rather than to let a ✅ cover it.** The gate is narrowed from `session_offer`, which
  carries three fields and **no signature**. So the peer allowed to dial is chosen by whichever
  directory node sent that frame, with nothing verifying the frame.
  - **What (b) therefore buys, precisely:** it removes the *unauthenticated* attacker — anyone who
    is not the directory and was part of no negotiation. That was a real open door: every agent that
    came online admitted any dialer on the network, and libp2p does not re-run a gater against a
    live connection, so the stranger survived promotion into the session.
  - **What it does NOT buy:** protection from a malicious directory, which can name an impostor and
    have the gate faithfully open to them. That is the same trust hole clause (a) closes one layer
    up, left open one layer down — **carried as `DOD-M15-OFFER-SIGNED-1`.**
  - The responder always reports its Peer ID before the counterparty dials, so the offer always
    arrives in time. No trusted-tier bypass — the gate sees a transport
  Peer ID minted per session and unknowable in advance; trust tiers do their work one layer up at
  session acceptance (Decision 2).
- **This also closes the `identify` disclosure**, which has no other mitigation on the list: a
  stranger currently receives the agent's public key, listen addresses and protocol list.
- **Enforcer:** stranger.

---

### `DOD-M15-SURFACE-1` — ✅ The daemon stops listening where nothing dials it
> **Shipped and reviewed 2026-08-22 → Entries 9, 11.** cello-client `a1da749` + `a0940f1`,
> trustless-cello `007b6909`. **SPEC: FAITHFUL, nothing blocking** — the reviewer confirmed all five
> falsification claims independently, plus two I had not checked (no signature covers the announced
> multiaddrs; no non-empty validation exists), and built a throwaway test proving a zero-listener
> node still dials out. Six findings fixed, all documentation-layer or pre-existing. **Carried:**
> `DOD-M15-IDLE-CONNS-1`, `DOD-M15-DEAD-WIRE-FIELD-1`.
- **The directory-facing node stops listening entirely.** It binds `/ip4/0.0.0.0/tcp/0` — a real
  open port on every interface — registers **no protocol handler**, and the directory **never dials
  a client**. An empty listen configuration removes it from the attack surface: no socket, nothing
  to scan, nothing to gate. *Fallback only if something turns out to need inbound there:* install
  the existing `DirectoryConnectionGater`, which is written but constructed only in tests. **Not
  listening is the fix; the gater is the consolation prize.**
- ~~**Unauthenticated idle connections are dropped on a timer.**~~ **SPLIT to
  `DOD-M15-IDLE-CONNS-1`** below. Not silently dropped: its value changed once `DOD-M15-FRAME-1`
  landed, and it needs state neither the transport nor the daemon holds today.
- The standing receiver's socket **stays** (Decision 2) — it is load-bearing for same-machine and
  same-LAN sessions, which the launch intent names explicitly, and it becomes required again if hole
  punching is ever repaired.

---

### `DOD-M15-OFFER-SIGNED-1` — ✅ The frame that opens your door is signed by more than one node
> **CLOSED 2026-08-22**, unblocked by `DOD-M15-RESPONDER-VERIFY-1` — this line always needed the
> responder to verify what it was comparing against, and it now does.
>
> **Reviewer's verdict, quoted:** *"Clause 1 — verify the signature is internally consistent over
> the recomputed TBS: **implemented**. Clause 2 — TOFU-pin `counterparty_primary_pubkey` across
> sessions, refusing a change: **implemented**. 'catches a tampered or garbage assignment which
> today reaches the seal path unchallenged': **implemented, with a test that survives the revert**."*
> And on the deletion: *"I looked for an input where the deleted comparison refused and the verifier
> admits. There is none — the new check dominates on every axis… **Your deletion is safe.**"*
>
> Its **HOLLOW TESTS FOUND [blocking]** finding is fixed, not waived. Three fixes were each
> deletable with a fully green gate (2525, 2525, 4057 tests). Each now has a test that goes red,
> confirmed by re-running the same reverts. The reviewer also demonstrated that the three
> "ACCEPTS …" tests asserted only the ABSENCE of a refusal — and the accept path was dying on a
> missing stub every time, which also produces no refusal event, so they passed on the absence of
> something that could not happen. They now assert the session reaches the agent.
> **STILL OPEN — and the work done under it does NOT close it.** cello-client `35a89e1`, `ed49869`,
> `24ddefa`, `ccbf610` (merged to main). Second review pass in flight.
>
> **What was attempted and why it is not enough.** The offer's peer id is recorded and compared
> against the assignment's. The first commit called that a counterbalance because the assignment is
> FROST-signed — but **the responder does not verify that signature** (`session.inbound.assignment.
> unverified`, deferred to SESSION-004), so it compares an unsigned frame against an unverified one
> and a single compromised directory controls both. It says the same peer id twice and passes.
> Corrected in the code and in the commit that followed.
>
> **What it does buy:** a consistency check between two channels — catching a stale or replayed
> offer, a second node injecting an offer for a session it is not brokering, or a directory whose own
> frames disagree. Real, and smaller than first claimed.
>
> **What DID land as a genuine counterbalance** is a different line's work and is tagged there:
> `DOD-M15-RESPONDER-VERIFY-1` clause 2, the TOFU pin — a directory cannot rewrite what this daemon
> recorded during an EARLIER session, so naming a different threshold key for a known counterparty is
> refused. Bound stated: worth nothing on first contact.
>
> **To actually close this line**, `DOD-M15-RESPONDER-VERIFY-1` clause 1 must land first — the
> responder verifying the assignment it is comparing against. The DoD's own ordering rule applies:
> *gating on an unverified document relocates trust rather than closing it.*

Split from `DOD-M15-ASSIGN-1` (b), whose review found the clause claimed "directory-signed" while
the implementation narrows the receiver's gate from `session_offer` — a frame carrying three fields
and no signature at all.
- **The shape is the one clause (a) exists to close, one layer down.** (a) stops a single
  compromised directory naming your counterparty on the INITIATOR side; (b) hands that same single
  directory unilateral authority to name who may dial your RECEIVER.
- Not an immediate exploit: the named peer still has to complete Noise, and `DOD-M15-FRAME-1`'s
  frame gate refuses what it then says. It is a trust concentration, not an open door.
- **Two candidate shapes, and the trade is real:** sign the offer (a directory change, and the offer
  currently precedes the ceremony that would sign it), or defer narrowing to `acceptSession` where a
  signed assignment IS in hand — which reopens the pre-accept window the receiver gate just closed.
- **Enforcer:** stranger.

---

### `DOD-M15-RESPONDER-VERIFY-1` — ✅ The responder stops trusting a key it never checked
> **CLOSED 2026-08-22.** Two review passes — the hard cap — and every blocking finding is fixed.
> Gate: 4066 tests, lint, typecheck, clean build (`dist` and `.tsbuildinfo` removed first).
>
> **Reviewer's verdict, quoted:** *"**SILENT FALLBACKS FOUND** — F5 (a receipt accepted without
> verification returns a response indistinguishable from a verified one) and F6 (a fabricated
> assignment passes internal mode and is written to the durable trust anchor with no agent-facing
> signal). Both HIGH. [blocking]"* Both closed: `verified` now rides on the sealed-receipt response
> with a note saying not to present it as proof, and `verification: pinned | first_contact` rides on
> the inbound session event with the out-of-band confirmation named.
>
> Also quoted, because it is the finding that generalises: *"three of the five HIGH findings are the
> same finding wearing different clothes — **a correct guard whose only proof of existence is that
> someone remembered to write it**… this is the fourth appearance of the guard-nobody-hears pattern
> in this milestone, which is the threshold the procedure sets for it earning its own DoD line."*
> → `DOD-M15-GUARD-HEARD-1`.
>
> **What this line actually bought, in one sentence:** a tampered assignment used to reach the seal
> path unchallenged AND GET PINNED, poisoning every later session with that counterparty; it is now
> refused on first contact, before anything is recorded.
> **Clause 2 (TOFU pin) landed 2026-08-22** — cello-client `ed49869` + `ccbf610`, merged to main. A
> directory that names a different threshold group key for a counterparty this agent has completed
> sessions with is REFUSED, visibly (`cello_check_notifications`) and recoverably
> (`cello_contact_remove` now clears the pin — it did not, and the refusal was permanent until the
> review caught it). **Clause 1 — verify the assignment's signature is internally consistent over
> the recomputed TBS — is NOT done**, and it is the half that stops a garbage or tampered assignment
> being pinned in the first place. It is also what `DOD-M15-OFFER-SIGNED-1` is blocked on.
Split from `DOD-M15-ASSIGN-1` (a) review F4. Verification runs on the **initiator** path only. The
review confirmed the responder genuinely cannot perform the anti-circularity comparison today —
nothing in the tree holds a counterparty's FROST `primary_pubkey` — but also found what the
responder DOES with the assignment it cannot verify, which the code comment did not say:
- It pulls `signer_pubkey` out of the unverified frame and persists it as
  `sessions.counterparty_primary_pubkey`, **which the seal coordinator then reads as the trust
  anchor for verifying the counterparty's seal certificate.** An unverified frame value is the root
  of a later trust decision. That is "acting on it" in this line's own sense.
- **Two things the responder CAN do with what it already holds, neither needing a directory lookup:**
  verify the signature is internally consistent over the recomputed TBS (catches a tampered or
  garbage assignment, which today reaches the seal path unchallenged); and TOFU-pin
  `counterparty_primary_pubkey` across sessions with the same counterparty, refusing a change —
  today both readers key by session id, so a repeat counterparty is re-trusted from scratch.
- Whether to add a directory lookup or revive the connection package is a protocol-shape decision
  and is **not** part of this line; the two above are.
- **Enforcer:** stranger.

---

### `DOD-M15-SUBMIT-ID-1` — ✅ A retried message stops killing its conversation
> **CLOSED 2026-08-22.** Reviewer verdict quoted: *"**SPEC: DEVIATIONS FOUND** … **SILENT FALLBACKS
> FOUND** … **ERROR SUBSTITUTION FOUND** … **HOLLOW TESTS FOUND** — T1 through T5. T1 is the serious
> one: the classification that *is* TRANSPORT-TERMINAL-1 has no test on two of its three branches,
> and the mutation you asked me to hunt for — making a merits refusal non-terminal — leaves the gate
> green."* Every finding fixed and each of the reviewer's measured-green mutations re-run red.
> Gate: 2265 tests with the database live.
>
> **RELAY HALF ONLY. ⚠️ The client half must not ship until this relay is DEPLOYED** — `decodeStructure1`
> required exactly 6 elements, so a client emitting a submission id has every frame refused by the
> relay running today.
>
> **The sender-scoping was claimed by a comment and tested by nothing**, and the attack is reachable
> by ordinary participation: B sees every `structure1_cbor` A sends, so B could mint A's id and be
> handed A's ack — B's message never witnessed while B is told it was.
> **RELAY HALF BUILT 2026-08-22, unreviewed. ⚠️ DEPLOYMENT ORDER.** The relay now tolerates a
> 7-element Structure 1 and is idempotent on `submission_id`. **The client half must NOT ship until
> this relay is deployed** — `decodeStructure1` required exactly 6 elements, so a client emitting an
> id has every frame refused by the relay running today. Content-hash dedup is explicitly rejected
> (two identical messages are two messages) and there is a test for it. I deleted the
> `last_seen_seq_ahead` guard while inserting this; the gate caught it, it is restored.
`DOD-M12B-SUBMIT-ID-1` + the rest of [[M12B-DEFINITION-OF-DONE]]. **The top line of this tier:**
basic messaging between two healthy agents, failing silently and unrecoverably. One message consumed
49 canonical positions; verified content destroyed at teardown fired 20 times on one daemon in one
day.
- A submission id inside the signed frame, so a retransmission is declarable.
- An idempotent `hash_submit` returning the original position without advancing the counter or the
  relay's own tree.
- A client that stops re-asking, and position discipline so a leaf index **is** its assigned position.
- **`DOD-M12B-ACK-1` — what stops the FIRST acknowledgement — is inside this line**, not a follow-on.
  The spiral needs one unacknowledged send to start and that first failure was never traced. The
  residual document-reconcile gap (2 holds per 20 minutes) has the same root and closes with it.
- Bilateral wire contract: the relay tolerates the new shape before any client depends on it.
- **Enforcer:** journey, including a retried send.

---

### `DOD-M15-BOOTSTRAP-1` — ✅ One lost packet stops dropping a directory from the roster
> **Shipped and reviewed 2026-08-22 → Entries 23, 24, 25.** cello-client `32277f0`, `1bf207a`,
> `b809066`. Gate: **350 files / 4046**, lint, typecheck, build.
>
> **TWO PASSES — the hard cap.** Pass two: *"F3 FIXED (correct, and revert-tested for real). F2
> FIXED. F1 PARTIALLY FIXED — the regression moved, it did not go away."* All three of its own
> findings are now closed, and the one that mattered was caught by the test written to close it: the
> blocked resolver has **two** legs inside one 10 s wait, so a budget sized for one still blew it.
> `FAST_PROBE` now fits twice, and `SIGNALING_CONNECT_WAIT_MS` is exported so the constraint is
> asserted rather than remembered. Three probes at 8 s,
> 20 s total cap, retrying only `timeout`/`connect_error`/`dns_error`; a deterministic answer (404,
> 503, malformed payload) still costs exactly one probe, and the happy path costs one. Two
> visibility additions: the unresolved warning carries how many probes were spent, and a node that
> answered only on a retry logs `resolved_after_retry` — nothing is wrong yet, but the path is
> losing packets, and before this those conditions dropped it entirely.
`DOD-BOOTSTRAP-PROBE-RETRY-1`. Fails for a normal user on a lossy link with nothing wrong anywhere
in the system.
- `fetchBootstrapResult` gives each node one attempt with a 5-second deadline and no retry; a probe
  that loses a packet is abandoned inside TCP's retransmit backoff. Measured over a mobile link: one
  request returned at **16.2 s**, another returned nothing in 30 s.
- ~3 attempts at ~8 s with a bounded total (~20 s). **A longer deadline alone does not fix it** — the
  win comes from a fresh connection, not a longer wait.

---

### `DOD-M15-ERRSTRING-1` — ✅ An error names what was observed, never an inferred conclusion
`DOD-COUNTERPARTY-OFFLINE-LIE-1`. One string, `counterparty_offline`, returned on 2026-08-16 for a
garbage-collecting node, a roster below threshold, and a stale gateway — naming a party that was
online in all three and nothing that was broken. Most of a day lost in the wrong subsystem.
- A roster below threshold says so. A node that cannot be reached is named.
- Generalises to Invariant 3: **downstream never overwrites an upstream descriptive error.**
> **Shipped and reviewed 2026-08-22 → Entries 23, 24, 25.** cello-client `a5900f3`, `1bf207a`,
> `3f0afa1`, `b809066`. Gate: **350 files / 4046**, lint, typecheck, build.
>
> **TWO PASSES — the hard cap.** Pass two ruled the renames correct — *"both renames are correct and
> the guidance routes to the right subsystem… they name observations, not parties"* — and found the
> two things that were not: a test for the headline fix that **landed on a neighbouring branch**
> (so the fix shipped with zero coverage), and a silent undercount in the shortfall arithmetic that
> could affirm ceremonies were fine when the threshold was unmet. Both closed and revert-tested. The reachable
> false-offline (directory says ONLINE, names no home) is now `directory_named_no_home`, whose
> guidance says where the fault is NOT before saying what to do. The exhausted-loop fallthrough was
> also rewritten, but tracing it showed the line is UNREACHABLE — a compiler backstop, not the
> source of the incident, and the comment now says so rather than sending the next reader wrong.

---

### `DOD-M15-REFUSED-INBOUND-SILENT-1` — ✅ A message we refused is a thing the operator gets told
> **CLOSED 2026-08-24 (CELLO_Support). TWO review passes — the cap — verdict quoted: "FLIP".**
> *"The defect this line was written about is closed and proven at the exit that produces it: an
> operator who waits and hears nothing is now told their peer's messages are arriving and being
> refused, why, and that waiting will not help… All four pass-1 blocking findings are real fixes, not
> cosmetic — I re-derived the boundary arithmetic, the consumer keying, the guidance pairing and the
> whitelist reader independently."*
> Gate: **14/14** on the unit file, **2862/2862** on the full `core/daemon` suite, typecheck + lint
> clean, revert probe run by hand against the correct line.
>
> **⚠️ ONE PATTERN COST THREE ROUNDS, and it is the durable lesson: I kept building a value and never
> asking WHO READS IT.** (1) the store had no reader, so I tested the store; (2) the IPC tests I
> added passed `since_seq: 0` — a finite number — so they took the batch exit and never ran the quiet
> exit they were named for; (3) the salted-status field went on the session record, and
> `selectSessions` is a WHITELIST, so it never reached the operator's surface at all. **Each time the
> test passed and the operator saw nothing.**
>
> **CORRECTION — a claim in this entry and in a commit message was OVERSTATED.** I wrote that
> `SELECT *` was *"shipping the raw `content_salt` BLOB to both listing surfaces"*. Pass 2 checked all
> 19 `getSessionRecord` call sites and the four listing call sites: **every one reads named fields and
> none returns a record wholesale, so the salt never reached an operator.** The change is good
> hygiene with zero risk — an in-process method was carrying a salt it has no use for — but it was
> not a leak, and the record said it was.
>
> **CARRIED as ACs on a later unit** (pass 2's list, in its order): the two-connection IPC test — the
> `connectionId` threading is correct but untested, so passing `"default"` at all three call sites
> keeps every test green while the sibling-consumption defect is fully restored; refusals on the
> `counterparty_gone`, `delivery_impaired` and `content_undeliverable` exits — **`counterparty_gone`
> is the sharp one**, it tells the operator their peer *"may have crashed or gone offline… call
> `cello_close_session` to seal"* while the daemon holds the real reason in memory, steering them to
> seal on a network story for a version fault; tests for the sealed and batch spreads, neither of
> which any test protects; and **re-classifying `session_size_limit_exceeded` out of POST-LAUNCH** —
> pass 2 makes the case that once a session crosses the sender's tier byte cap **every** later message
> is refused for the life of the session, silently, which is the same permanent-quiet shape as the
> three that are wired, and the remedy is entirely the operator's. **That reclassification is Andre's
> call under the freeze, not mine.**
**Found while invariant-checking `DOD-M15-SEALWIRE-1` part B1 (→ Entry 43). PRE-EXISTING, not
introduced there** — `content_hash_mismatch` has had exactly this shape since it was written; B1
added two more refusal reasons to the same silent path, which is what made it visible.

Every inbound content refusal in `ingestReceivedContent` is loud in the LOG and **reaches the agent
nowhere.** The one agent-facing push in that area (`#onSessionStateChanged` →
`counterparty_closing`) fires from the auto-acknowledge gate — **at close**, not at message time. So
from the receiving operator's chair, a refused message simply never arrives.

- **Why it is worse than it sounds, and why B1 raised the stakes.** A hash mismatch is rare and
  arguably one-off. `content_hash_alg_unknown` is a **version skew, so it affects EVERY message from
  that counterparty**: the conversation goes quiet, permanently, with a full explanation sitting in a
  log file the operator has no reason to open. They conclude the other person stopped replying.
- This is Invariant 4 exactly: *loud in the LOG **and** in the agent response, never one instead of
  the other.* The sender is fine — no ACK means it parks and eventually surfaces a delivery problem.
  It is the RECEIVER's operator who is told nothing.
- **The bar:** the refusal reaches `cello_receive` (or the inbox) with the reason and its guidance —
  the strings already exist and are good; they have no reader. **Bounded and deduplicated per
  session per reason**, or a skewed peer turns one lie into a flood: the first refusal of a kind is
  the signal, the ninetieth is noise.
- **Do NOT show the content.** It failed verification; surfacing it is the injection path the cross-
  check exists to close. The operator is told a message was refused and why, never what it said.
- **A DECLINED PROTECTION belongs here too** (found invariant-checking `SEALWIRE-1` B2b-2's adoption
  rule, 2026-08-23). When a salt is refused because the session already has leaves, the session stays
  healthy and every message keeps working — so there is nothing to interrupt the agent WITH, and the
  refusal is correctly log-only today. What is missing is *state*, not an alert: nothing lets an
  operator tell **"unsalted because this build predates the feature"** from **"unsalted because
  adoption was refused"**, and only the second says something about their setup.
  - **The bar is a field, not an event:** the session's own status (`cello_sessions` / the session
    record surface) says whether its content hashes are salted. That is checkable, costs nothing per
    message, and cannot become a flood.
  - **Deliberately NOT urgent.** An unsalted session is exactly as verifiable as every session
    shipped before the feature existed. This is the difference between *knowing* and *working*.
- **Enforcer:** receipt.
- **BUILT AND WIRED 2026-08-23/24, NOT YET RUN — tag stays ❌.** The surface exists
  (`noteContentRefusal` / `takeContentRefusals`), both producers call it, and the consumer is spread
  into `cello_receive` — **including the QUIET exit**, which is the one that matters: a version skew
  refuses every message, so nothing is ingested and there is no delivered message for a notice to
  ride along with. The guidance on that exit also switches, so it no longer says "call again and keep
  waiting" to someone whose peer's every message is being refused.
- **The tests I wrote first would have passed against a surface nobody reads.** They drove the store
  API directly, so deleting the `cello_receive` spread left all of them green — proving the store
  works and saying nothing about the defect, which was that good strings had **no reader**. Four
  tests now drive the real `cello_receive` over IPC on the quiet exit.
- **REVIEWED 2026-08-24 — pass 1 came back BLOCKING on four counts, all now fixed.** Verdict quoted:
  *"**SPEC: DEVIATIONS FOUND** — C2 and C7 are unimplemented clauses… **SILENT FALLBACKS FOUND** —
  HIGH-1 is a refusal path that stays silent to the operator on a branch whose own guidance says it
  never repairs. **[blocking]** … **HOLLOW TESTS FOUND [blocking]** — not one test in this file dies
  if `session-content-handlers.ts:1225` is deleted; not one dies if both `noteContentRefusal`
  producer calls are deleted."*
- **⚠️ THE FINDING I WOULD NOT HAVE FOUND, and it is the third turn of one pattern.** My IPC tests
  passed `since_seq: 0`. **`handleReceive` branches on `since_seq` before anything else, and 0 is a
  finite number** — so all three took the catch-up BATCH exit, the blocking loop never ran, and the
  quiet exit this line calls *"THE exit this line exists for"* had **zero coverage**. My revert
  evidence pointed at a line no test executed. The pattern: I fixed *store-with-no-reader* by
  testing a reader I hand-fed, on a branch I never reached — **the untested seam MOVED rather than
  closed**, twice in a row.
- **Findings fixed, each with the consequence rather than the mechanism:**
  - `content_hash_salt_unavailable` was refused, logged fully, and **told the operator nothing** —
    on the one branch of four whose own guidance says it is *permanent for this session and
    reconnecting will NOT fix it*. Now noted like its neighbours.
  - **Which of your two windows learned why the conversation went quiet was a race.** One
    `surfaced` flag per notice meant the first reader consumed it for every sibling, permanently —
    the defect `takeReceivedContent` was rewritten to remove, re-created on another surface. Keyed
    per consumer now.
  - **"3 refusals" and "903 refusals" were indistinguishable.** The docstring claimed a later reader
    could ask how many; there was none. Re-announces on order-of-magnitude growth, marked `repeat`.
  - **The catch-up read destroyed the advice.** The batch exit returned the notice with no
    `guidance` key at all, so a catch-up read drained it and the next blocking read said *"call
    again and keep waiting"* — the exact advice this line exists to stop. Notice and advice are now
    returned together so no exit can take one without the other.
  - **Sealing closed the last door:** the sealed exit runs first in the loop and carried no
    refusals, while its guidance points at `cello_transcript`, which cannot show a message that was
    never ingested. Now carries them.
  - **C7 (declined protection) implemented:** `content_hashes_salted` on the session record — and
    implementing it found `SELECT *` shipping the raw salt BLOB to both listing surfaces, which now
    stops.
- **⚠️ CORRECTION — a commit message in this unit overstates what a fix did.** *"The list test asked
  for the default filter"* says the `cello_list_sessions` test failed and `filter: "all"` fixed it.
  **That test is GREEN in CI at the tree BEFORE that change** — `✓ dod-m15-refused-inbound-silent-1
  (13 tests)`. It failed only in one local full-suite run, and **I edited the file while that run was
  in flight**, which is the most likely reading and is a hypothesis, not a finding. The
  `filter: "all"` change stands because the default (`open`) genuinely excludes a zero-message
  session and being explicit is correct either way — **but it did not repair a real failure**, and I
  reported it as though it had.
- **The same reasoning error, one layer up: I told `CELLO_Coder_1` to stop a publish because "my red
  test is in the tag".** The tag run reported `Failed Tests 1` and it was **not mine** — it was
  `AC-009 (binary): SIGTERM marks active sessions interrupted`. **I reasoned from a local red to a CI
  red without checking**, on the same day I twice recorded that a test failing does not mean the
  thing it names is broken. Stopping the publish was still right; the reason I gave was wrong.
- **Revert evidence, run against the RIGHT line this time:** replacing the quiet-exit spread turns
  both positive tests red; the absence guard stays green by design and is not counted as evidence.
  The producer test has teeth by construction — it never seeds the store, so deleting the producer
  call makes the count zero.
- **NEW ITEM #2 → POST-LAUNCH (§0z.1). Trip-wire at 2 of 3; a third stops this unit.** The clause
  says *"EVERY inbound content refusal in `ingestReceivedContent`"*. **Three are wired**
  (`content_hash_alg_unknown`, `content_hash_mismatch`, `content_hash_salt_unavailable`) — the
  verification refusals this line was written about. `ingestReceivedContent` has **roughly eight**
  `ok:false` exits in total: `session_orphaned`, `session_committed`, `sender_unresolved`,
  `session_size_limit_exceeded` (×2), `inbound_screen_blocked`, `transcript_write_failed`.
  - **NOT claimed to be silent — I checked one and it is not.** `transcript_write_failed` routes
    through the undeliverable/impaired machinery, and its own comment describes closing exactly this
    defect there: *"Reporting `ok: true` here is what let a local SQLCipher failure surface, 30
    seconds later and one subsystem away, as 'no content arrived — keep waiting'."* So the remaining
    exits need checking **individually**, and the honest statement is that their operator surface is
    unknown, not absent.
  - **Post-launch because the unforgiving case is now covered.** The one that is permanent and
    affects EVERY message from a peer — version skew — is wired. A screening block is a deliberate
    refusal with its own policy surface, and a size-limit refusal is a local guard, not a silent
    conversation death.
- **NEW ITEM from this unit → POST-LAUNCH (§0z.1), one item, trip-wire not tripped.** `cello_receive`
  has a THIRD exit — `delivery_impaired` — and it returns without the refusals. So an operator whose
  session is *both* impaired and being refused is told about the impairment only.
  **Classified post-launch because the refusals are DEFERRED, not lost**, and that is read from the
  code rather than assumed: draining happens inside `refusalsField`, which that branch never calls,
  so the pending entries stay in the map and the next receive reaching the quiet exit still carries
  them with the count intact. It also needs the rarer impaired state to appear at all.
- **A fifth test was deleted rather than shipped**, with the reasoning left in the file: content
  never travels, but `noteContentRefusal` is never handed the content — the protection is at the two
  producers — so a wire-level version either fails correctly (`impact` is verbatim; no layer can
  launder a caller that puts content there) or strips the secret first and passes unconditionally,
  testing its own setup. The property is asserted where it is enforceable.

---

### `DOD-M15-TRANSPORT-TERMINAL-1` — ✅ A transport blip stops killing a healthy conversation
> **CLOSED 2026-08-22, in the RELAY-PATH batch review** (Entry 55). ✅ **Re-verified 2026-08-24:
> this verdict IS about this line** — its named finding says so outright (*"the classification that
> **is** TRANSPORT-TERMINAL-1"*). Checked because four sibling entries were found quoting evidence
> about a different tag; this one was correctly cited.
>
> **CLOSED 2026-08-22.** Reviewer verdict quoted: *"**SPEC: DEVIATIONS FOUND** … **SILENT FALLBACKS
> FOUND** … **ERROR SUBSTITUTION FOUND** … **HOLLOW TESTS FOUND** — T1 through T5. T1 is the serious
> one: the classification that *is* TRANSPORT-TERMINAL-1 has no test on two of its three branches,
> and the mutation you asked me to hunt for — making a merits refusal non-terminal — leaves the gate
> green."* Every finding fixed and each of the reviewer's measured-green mutations re-run red.
> Gate: 2265 tests with the database live.
>
> **The finding I would not have found:** the rollback treated a mid-ceremony disconnect as
> "unreachable". The directory acknowledges only AFTER its full ceremony, so silence may mean it
> notarized the session — rolling back to `active` let the tree grow past a certified root. Three
> kinds now: `unreachable` (nothing sent, safe to reopen), `unknown` (sent, no answer — non-accepting
> and honest about it), `refused` (a verdict).
> **BUILT 2026-08-22, unreviewed.** `processSeal` returned `ok:false` for MERITS and TRANSPORT alike
> and the relay terminalised both, so a directory restart permanently killed a healthy conversation
> and told both parties it had SEALED. Now a typed discriminant (`kind`), unclassified defaults to
> `refused` so no existing caller loosens. The first fix did nothing — skipping `rejectSeal` left the
> session in `sealing`, which the `hash_submit` guard answers identically; the status is rolled back
> to `active` too. Both halves revert-tested.
`DOD-M12B-TRANSPORT-FAULT-NOT-TERMINAL-1`. Upstream of the two lines below it; fixing it likely
shrinks both.
- `rejectSeal` terminalises unconditionally on every path, with no branch for "the failure was
  transport, not merits."
- Distinguishes a transport failure (could not reach a directory) from a merits failure (a directory
  examined the seal and refused it). **Only the merits case terminalises**; a transport failure
  leaves the session active and retryable.

---

### `DOD-M15-TERMINAL-REASON-1` — ✅ "Sealed" and "gave up" stop being the same word
> **CLOSED 2026-08-22, in the RELAY-PATH batch review** (Entry 55) that also covered
> `DOD-M15-TRANSPORT-TERMINAL-1`.
>
> ⚠️ **THIS ENTRY USED TO QUOTE A VERDICT WHOSE NAMED FINDING IS ABOUT THE OTHER LINE** — *"the
> classification that IS TRANSPORT-TERMINAL-1 has no test on two of its three branches"*. True, and
> about a different tag. Andre found it reading the DoD end to end; `grep` could not, because the
> artifact was present and only its SUBJECT was wrong. Corrected 2026-08-24 to quote **this line's
> own** finding from the same pass:
>
> *"a rename that made a refused seal **non-terminal on the client** — three consumers branched on
> the old literal, so a refused conversation would have run on against a chain that had stopped
> growing. That is the 68-minute defect those sets exist to prevent, reintroduced **by changing a
> string**."*
>
> That is precisely this line's subject — it split `session_sealed` into named causes, and the rename
> is what the split does. Every finding fixed; the reviewer's measured-green mutations re-run red.
> Gate: 2265 tests with the database live.
>
> **And the rename orphaned three consumers.** `TERMINAL_RELAY_REFUSALS`, `TERMINAL_ISH_REFUSALS`
> and `MAY_ALREADY_BE_SEALED` all branched on the literal `session_sealed`, so `seal_refused` read as
> NON-terminal and a refused conversation would have run on against a chain that had stopped growing
> — the 68-minute defect those sets exist to prevent, reintroduced by changing a string. Fixed, with
> `seal_refused` retiring as ABANDONED (a refused seal has no certificate). `rejectSeal` also no
> longer discards the directory's cause: it rides back as `detail`.
> **BUILT 2026-08-22, unreviewed.** The two answers were INVERTED: a refused seal answered
> `session_sealed`, and a successfully sealed session answers `session_not_found` (confirmSeal
> destroys the record). Now `seal_refused` / `seal_in_progress`; the legacy value stays in the union
> because older relays still send it. **`sealing` is not client-observable** — `hash_submit`
> serializes per session and adjudication runs inside that lock, measured by a 30s hang — so the test
> asserts the serialization and says so rather than faking the unobservable case.
`DOD-M12B-TERMINAL-REASON-1`. Two sides of one dead conversation get two stories and both behave
correctly given what they were told; one believes it holds a receipt and holds nothing.
- `session_sealed` is currently the reply for **every** non-active status, `seal_rejected` included.
  `rejectSeal` is handed the real cause at its call site and discards it — the parameter is
  underscore-prefixed and reaches nothing but a log line.
- At minimum three distinct terminal reasons — notarized / refused-permanently / still-in-progress —
  **with a defined meaning for an unrecognised reason**, so an older client fails safely rather than
  misreading a new answer.
- Wire-visible: the relay tolerates the new reasons before any client depends on them.

---

### `DOD-M15-PULLRECOVER-1` — ✅ The certificate pull is PROVEN TO WORK (measured, not argued)
> **CLOSED 2026-08-24 (CELLO_Support) against the LIVE daemon log — 701,652 events, positive control
> first.** The line asked to establish WHICH explanation is true before touching anything. It is now
> established from data rather than from reading.
>
> **1. THE 157 ARE ALL PRE-FIX.** `seal.certificate.pull.not_found` by date:
> `08-08:23, 08-09:2, 08-12:5, 08-13:5, 08-15:1, 08-16:12, 08-17:63, 08-18:38, 08-19:8` = **157**,
> then **08-20, 08-21, 08-22, 08-23: ZERO**, and **08-24: 1**.
> **`DOD-M15-TRANSPORT-TERMINAL-1` closed 2026-08-22.** The producer of doomed sessions was fixed and
> **the attempt rate collapsed to nothing.** That is the confirmation the explanation needed: the
> recovery path was working correctly on sessions that never sealed.
>
> **2. THE ONE RECENT ATTEMPT IS THE BENIGN CASE, AND IT IS THE ONE THIS LINE EXISTS TO PROTECT.**
> Session `c2c43b05…` is HEALTHY — salt announced and agreed, 5 transcript rows, 5 tree appends,
> content received and acked. Its seal story: `seal.leaf.submitted` → `seal.autoacknowledged` →
> `seal.awaiting_counterparty` → `seal.background.unresolved` → `pull.not_found`.
> **This side sealed and the counterparty never came back.** No certificate exists YET, so
> `not_found` is the TRUE answer — and **this is exactly the row an auto-repair would have
> destroyed**, on a session that may still seal when the peer returns.
>
> **VERDICT: the pull is not asking wrong. It answers correctly in both cases measured** — a doomed
> session (no certificate was ever created) and a live one (no certificate yet).
> **THE TRAP THE LINE NAMES IS NOW THE ONLY LIVE RISK, and it is sharper than before:** with the
> producer fixed, `not_found` no longer means "another doomed session" — it means *awaiting a
> counterparty* or a genuine loss. **Nothing was built that repairs on it, and nothing should be.**
> ### NARROWING, 2026-08-24 (CELLO_Support) — one explanation ELIMINATED by reading, one added.
> The line says establish WHICH explanation is true first. Two done without a run:
> - **❌ RULED OUT: a key mismatch between the pull and the record.** The directory returns
>   `not_found` unless the requester's authenticated key matches a recorded participant — a real
>   second source of false absence, and deliberately indistinguishable. **But it is the SAME key on
>   both sides:** `#processSealUnilateral(stream, authedPubkeyHex!, …)` stores
>   `participant_a_pubkey = Buffer.from(senderHex, "hex")` where `senderHex` IS that
>   `authedPubkeyHex`, and `#processSealCertificateRequest` compares against the same value. **A
>   K_local-vs-primary_pubkey split would have explained 157/0 exactly, and it is not there.**
> - **✅ NEW CANDIDATE, and it is not a guess: the certificates may genuinely not exist because the
>   SEALS COULD NOT COMPLETE.** `CLOSEROOT-1`'s finding above shows a session where one side salts and
>   the other never agreed, so every message is refused, the trees diverge, and no seal can be
>   produced. **`not_found` would then be the correct answer 157 times.**
> - **❌ CANDIDATE ELIMINATED BY DATING — my own, killed within the hour.** `PULL-NEVER-RECOVERS-1`
>   was found **2026-08-19**; salting landed **2026-08-23** (`git log -S "hmac-sha256-salt-v1"`).
>   **Four days later. It cannot be the cause.** Recorded because it was a good-looking hypothesis
>   that fitted the symptom exactly, and the dating is what killed it rather than an argument.
>
> ### ✅ THE EXPLANATION IS ESTABLISHED, and this project had already reasoned it — in `launch-triage.md`
> **The certificates genuinely were not there, because the SESSIONS WERE FALSELY TERMINALISED.**
> `launch-triage.md` §20 says it outright: *"If a transport fault left the session active and
> retryable instead of dead, there would be no falsely-terminal row for `TERMINAL-REASON-1` to
> misreport, and **nothing for `PULL-NEVER-RECOVERS-1`'s recovery path to need to find.** It is the
> root; the other two are downstream symptoms."*
> **So 157 attempts / 0 recoveries is the RECOVERY PATH WORKING CORRECTLY** on sessions that never
> sealed — a transport blip terminalised them, so no certificate was ever created. **`not_found` was
> the true answer 157 times.**
> **And the root producer is already CLOSED: `DOD-M15-TRANSPORT-TERMINAL-1` ✅** — a transport failure
> now leaves the session active and retryable instead of dead.
> **⚠️ WHAT IS STILL UNMEASURED, and it is the whole remaining line:** whether the ATTEMPT RATE has
> gone to zero since that fix. 157/0 is consistent with "working correctly on doomed sessions"; the
> proof is that the doomed sessions stopped being created. **That needs fleet logs dated after
> `TRANSPORT-TERMINAL-1` closed — not another code read, and not a spine run.**
> **The line's own trap still stands and is now MORE important, not less:** with the producer fixed,
> a future `not_found` is more likely to be a genuine loss. **Do not auto-repair terminal rows on it.**
`DOD-M12B-PULL-NEVER-RECOVERS-1`. **157 attempts, 0 recoveries**, on one daemon in one day. This is
the only safety net standing between "the relay said sealed but lied" and "the receipt is gone."
- **Establish WHICH explanation is true first** — the certificates genuinely are not there, or the
  recovery path cannot find records that do exist. That is its own measurement, not an assumption.
- **The trap:** do NOT read a `not_found` as proof no certificate exists and auto-repair a terminal
  row on it. Homing moves are in the same day's logs, the record may sit on another consortium node,
  and a grace window may not have elapsed. Treating absence as proof would destroy genuinely
  terminal state — strictly worse than the divergence it exists to repair.

---

### `DOD-M15-INTERRUPTED-1` — ✅ An interrupted session can seal, and it has been watched doing it
> **CLOSED 2026-08-24 (CELLO_Support) against the LIVE daemon log. BOTH BULLETS WERE ALREADY BUILT —
> by M12B, AFTER this line was written.** The line was not wrong when written; it went stale, and the
> same reading that closed `PULLRECOVER-1` closed this one. Positive controls first, both times the
> search came back empty.
>
> **1. "THE CURE ACTS ON ITS OWN INITIATIVE" — it already does.** `RestartSealResolver`
> (`restart-seal-resolver.ts`, `DOD-M12B-PENDING-RESOLVE-1`) IS the startup sweep this bullet asks
> for, and it is started unconditionally at boot (`daemon.ts:5349`). Its own header states the
> premise the bullet assumed was unmet: *"A daemon shutdown flips every open session to `interrupted`
> on the way out"* — and it selects two populations, `interrupted` with `interrupted_by = 'local'`
> and `seal_interrupted_pending`. **Live proof, unmanufactured:** Andre's `cello logout`/`login` at
> **01:35 tonight** interrupted the open sessions, and with no operator touching anything the daemon
> then emitted **30 × `session.interrupted.seal.leaf.submitted`**, 24 × `restart_seal.waiting`,
> 5 × `revival_bound.sweep`, 3 × `interrupted.responder.acked`. Nothing was stranded waiting to be
> poked.
>
> **2. "ASSERT ON THE STATUS, NOT ONLY THE CERTIFICATE" — pinned by a test, and confirmed live.**
> `msg-016-sealed-status-lands.test.ts` (`DOD-M12B-INTERRUPTED-ESCALATE-1`) is this bullet's
> obligation discharged in full: it seeds *"the exact shape a restart leaves"* — an `interrupted` row
> with **no in-memory node behind it** — and asserts the row reaches `sealed`, with **both revert
> tests run**. It also records the defect this bullet was written about, and the cause is sharper
> than the bullet knew: every seal-completion path ended with `destroySessionNode(…, "sealed")`,
> whose `if (!entry) return` sits 26 lines ABOVE the status write — and an interrupted session has no
> entry *by construction*, so **the guard fired every single time on exactly the path that needed it**.
>
> **3. THE RECEIPT — an interrupted session sealing, in production.** **16** sessions have submitted
> an interrupted seal leaf; **3 completed a seal** (`73df5490`, `a9ae987d`, `aad859f1`). Ordering
> verified rather than assumed, because completion only counts if it followed the interruption:
> `session.interrupted.seal.leaf.submitted` **08:53:30.464Z** → `session.seal.completed`
> **08:53:35.676Z**, **5.2 seconds later**, `role: "unilateral"`, notarized root
> `1d347d8831c8e7e5…`. And the row agreed: all three report `currentStatus: "sealed"`.
>
> **4. THE ONE EVENT THAT LOOKED LIKE THE DEFECT IS BENIGN, AND SO ARE TONIGHT'S GIVE-UPS.**
> `session.seal.status.not_written` reads *"already sealed — nothing to write"* — idempotence, not a
> divergence. And the **6 × `restart_seal.gave_up`** tonight are the resolver being right: reason
> `seal_carry_bilateral_in_progress` — *both parties have posted their SEAL leaf, so the relay can
> notarize this BILATERALLY, a better receipt than a unilateral one.* **It stands down rather than
> forcing a worse receipt.** Tonight's sessions are waiting on that, not stuck.
>
> **WHAT I DID NOT DO, named so it is not mistaken for done:** the *deliberate* scripted run (open →
> exchange → restart → close) against chosen agents. It was not needed — production ran the
> experiment 16 times without being asked, which is stronger evidence than a staged one, and it costs
> no agent tokens and seals nothing that was not already interrupted. **The bullets below are the
> original spec, retained.**

`DOD-TERMINAL-STATE-DIVERGENCE-1`, both halves (launch-triage item 5).
- **The cure acts on its own initiative.** Today the pull fires only when an operator hits the stuck
  state; a session stranded and never touched again stays stranded. A startup sweep.
- **The proof runs.** Open a session, exchange messages, restart the daemon to interrupt it, close it
  — inside the relay's 24-hour retention. **Assert on the session's STATUS, not only the
  certificate**: a receipt was previously stored against a row still reading `interrupted`, so the
  close verb refused it by name and the resolver re-ran the whole ceremony on the next boot.
- **NOT blocked** (Andre, 2026-08-21): *"You do not need throw away agent tokens. Use existing
  ones."* Run against existing registered agents — `CELLO_Coder_1` and `CELLO_Support`
  (`f8d518ca0b5596fd0f383f17f03560975ea210a763249b342fd767bd067c2f3c`) locally, or `Miss_Chelly_H`
  on the Hermes EC2 instance for a genuinely different device. **Check the chosen agents hold no
  open sessions before running** — the proof seals what it touches, and that is managed by
  selection, not assumed away.
- Pre-V58 sessions can never be served by the pull; that is recorded, not repaired.
- **Enforcer:** receipt.

---

### `DOD-M15-CLOSEWAIT-1` — ✅ A close answers the caller before eleven minutes elapse
> **CLOSED 2026-08-23** (→ Entry 37). Reviewer verdict quoted: *"**SILENT FALLBACKS FOUND** — HIGH-1:
> the background failure's only consumer is `daemon.log`; the named recovery surface cannot
> distinguish failed from running… **ERROR SUBSTITUTION FOUND** — HIGH-3 … and the `not_sealed_yet`
> remedy that the new contract made unreachable. **HOLLOW TESTS FOUND** — the counterbalance clause
> with the real defect behind it is untested; the background logging is untested against a no-op
> logger; and the third ownership test passes with the whole unit reverted."* All nine fixed. Gate:
> 4212 client tests, server suite green, lint, typecheck, build — by exit code.
>
> Contract per Decisions Carried #4: **answer on commitment, not on notarization.** 11m 06s →
> immediate. `wait_for_seal: true` opts back into blocking (now reachable from the MCP schema).
> **The worst finding was prose:** three shipped documents still promised `sealed_root` from a close,
> including the walkie-talkie skill used for live demos, whose protocol waited for a branch that can
> no longer fire.
> **Two surfaces contradicted each other** — the receipt verb told the agent to do something the
> change had made impossible, and the re-close refusal named a log event emitted nowhere in the tree.
> **Carried:** `DOD-M15-SEAL-FAILED-TERMINAL-1`.

---

### `DOD-M15-SEAL-FAILED-TERMINAL-1` — ✅ A seal that FAILED is discoverable, not just a slow one
> **CLOSED 2026-08-23** (→ Entry 38). Reviewer verdict quoted: *"**SILENT FALLBACKS FOUND** — HIGH-1:
> the `unresolved` branch keeps a dead ceremony reporting `not_sealed_yet`; HIGH-2: the remedy erases
> the marker… **HOLLOW TESTS FOUND** — HIGH-3: the wiring test does not test the wiring and its
> docstring says it does… I am not rubber-stamping this one — the three HIGH findings are all in the
> class you flagged."* All nine fixed. Gate: 4229 client tests, server suite green, lint, typecheck,
> build — by exit code.
>
> **The sharpest finding of the milestone:** `escalateToUnilateralSeal` contains ZERO throws — all
> nine failure paths RESOLVE — so recording only in the detached `.catch` meant every ORDINARY dead
> ceremony went unrecorded and the receipt surface kept answering `not_sealed_yet`. The unit closed
> about a tenth of the gap it named.
> **`failed` vs `unresolved`** are now different words with different guidance: an exception is
> usually a local fault; a resolved failure most often means the counterparty has not closed yet.
> **A receipt could be lost permanently:** `restart_seal_gave_up_at` was never cleared, so a
> revived-then-closed session was excluded from recovery forever AND force-abandoned by the revival
> sweep. `reviveSessionNode` clears it.
> **Carried:** `DOD-M15-SEAL-RETRY-1`.

---

### `DOD-M15-SIGNUP-1` — ✅ Signup throttles a person, not their employer
> **Shipped and reviewed 2026-08-22 → Entries 8, 10.** `4922d72c` + `127a5a29` + `f9f271f4`. **TWO
> review passes — the hard cap.** The first found that my rekey removed the only cap on a requester
> and that my own test pinned the abuse case as required; the second found that un-shadowing the
> delivery-layer refusal surfaced it to the person as *"Incorrect code"* after a silence. Both
> fixed. **Carried:** `DOD-M15-SIGNUP-DURABLE-1` (still in memory) and `DOD-M15-CI-SKIPS-SILENT-1`
> (this file's evidence does not run in CI).
`DOD-OTP-RATELIMIT-KEY-1`. The sixth person from a domain in an hour is refused a verification code.
An invite wave **is** a burst on one domain.
- Rekey the limiter from the email domain to **the REQUESTER** (the channel user). Holds no new data
  and leaks nothing the system does not already keep.
  > **CORRECTED 2026-08-22 after review.** This clause originally said "the address fingerprint",
  > and that was wrong in a way worth keeping visible: **the address is the TARGET, not the
  > requester.** Keying on it lets one admitted user request five real verification emails per
  > address, to unlimited addresses, from CELLO's verified sender — and it duplicates a per-address
  > limiter the delivery provider has enforced since M6B, shadowing it dead. Per-address stays where
  > it already lives; this limiter guards how much ONE REQUESTER can make the system do.
- **Make it durable** — a table in the bot's own database, not an in-memory `Map` that resets on
  every restart and deploy. It was wiped by the ops-agent deploy on 2026-08-09.
- Lives in the registration bot; touches neither the directory nor the protocol.

---

### `DOD-M15-STALEROSTER-1` — ✅ A stale reading refuses to present itself as current
> **CLOSED 2026-08-23** (→ Entry 34). Reviewer verdict quoted: *"**ERROR SUBSTITUTION FOUND
> [blocking]** — F1. A new operator-facing string names a cause that cannot produce the state it
> describes, and points at an empty log family. This is the defect class this milestone exists to
> kill, shipped inside the fix for it… **HOLLOW TESTS FOUND [blocking]** — F3 (the unit's core
> arithmetic is comment-only)… I am not rubber-stamping this. The mechanism is sound and the shutdown
> discipline is genuinely careful. But the unit's product is diagnostic accuracy, and it ships a
> guidance paragraph that would send an operator to the wrong subsystem, fires that paragraph on a
> designed benign state, and leaves its own load-bearing arithmetic held up by nothing but a
> comment."* All fourteen findings fixed. Gate: 4152 tests, lint, typecheck, build.
>
> **Both of my diagnoses were wrong.** The sweep does not have one caller, it has ten — all
> ACTIVITY-driven, so the true shape is that an IDLE daemon never re-measures, not that recovering
> stops it. And an EXPIRED manifest cannot reach the unmeasured state, because that daemon refuses to
> start; the one reachable route is no manifest configured, which is DESIGNED (local dev, the e2e
> harness, or a `CELLO_DIRECTORY_URL` not byte-equal to a bundled endpoint).
> **The wrong map had a direct cost:** believing there was one writer is why I never asked what
> happens when two sweeps overlap. They do — patient vs `FAST_PROBE` — and the write stamped
> COMPLETION, so whichever landed last was labelled "measured now, 0 seconds old".
> **Carried:** `DOD-M15-SWEEP-ABORT-1`, `DOD-M15-MANIFEST-EXPIRY-LIVE-1`.

`DOD-STATUS-STALE-ROSTER-1`. Measured twice on two machines: both daemons displayed node failures
from minutes long past while `curl` reached all three nodes in 37–184 ms.
- `directory_endpoints_unresolved` freezes once the daemon returns to its healthy path, because the
  primary resolves and no roster probe runs.
- Either sweep on a slow timer even when healthy, or refuse to answer with a reading older than N
  minutes. **Do not fix it by hiding the field when stale** — absent and healthy must not look alike.

---

### `DOD-M15-IPCVISIBLE-1` — ✅ A connection closing leaves a record, and an identity switch says why
> **CLOSED 2026-08-22, in the four-unit DAEMON-PATH batch review** (`BACKUP-1`, `DOORBELL-1`,
> `DIVERGE-DURABLE-1`, `IPCVISIBLE-1` reviewed as one pass — Entry 55).
>
> ⚠️ **THIS ENTRY USED TO QUOTE `BACKUP-1`'S FINDINGS**, not its own — see the note on
> `DOD-M15-DIVERGE-DURABLE-1`. Corrected 2026-08-24 to quote **this line's own** finding:
>
> *"connection closes now leave a record naming the attended agent, and a fallback selection is
> attributable. **I over-corrected and four tests stopped me**: I switched the sole-online fallback
> off for MCP, which CC-3 added deliberately to fix the post-reconnect papercut. Behaviour unchanged;
> attribution is the deliverable, which is the sequencing `SELECTION-1` asks for and I had skipped."*
>
> **Both shipped log lines failed the revert test** — deleting either left the gate green, so the
> unit that exists to make things visible was itself invisible. Both tested now. The disconnect line
> was also emitting TWICE under one event name with disjoint fields; the handler returns its context
> and the server merges it. Clause 3 (`selected` is the CALLING connection's view) is implemented as
> an annotation rather than a rename — `selected_by_this_connection` plus `attended_by`.
> **BUILT 2026-08-22, unreviewed.** All three items: `daemon.ipc.disconnected` with clientType +
> attended agent + remaining attendance; `agent.current.fallback` so a fallback is attributable
> beside `explicit`/`replay`; selection extracted to `agent-selection.ts` with a reported trigger on
> every path.
>
> **I over-corrected first and four tests stopped me** — I switched the sole-online fallback OFF for
> MCP, which CC-3 added deliberately to fix the post-reconnect papercut. Behaviour is UNCHANGED;
> attribution is the deliverable, which is the sequencing `SELECTION-1` asks for.
`DOD-IPC-DISCONNECT-VISIBLE-1`. **Precondition for `DOD-M15-SELECTION-1`** — that defect cannot be
diagnosed until this lands.
- `daemon.ipc.connected` is emitted on every open and **nothing on close**, so a live client and a
  dead one that was never cleaned up look identical. One log line in `ipcServer.onDisconnect`:
  `connectionId`, `clientType`, and the agent it was attending. That last field matters — attendance
  dropping is silent today, and an agent losing its last attendee changes whether away-messages fire
  and who receives doorbells.
- `agent.current.switched` fires with **no agent name and no reason**. Add the name and the trigger
  (`explicit` | `replay` | `fallback`).
- `cello agents` reports `selected` from the CALLING connection, so a client asking about its own
  state through a fresh connection always sees `false`. Rename or annotate — both Andre and a Hermes
  agent misread it during one investigation.

---

### `DOD-M15-SELECTION-1` — ✅ A connection is never bound to an agent it did not select
> **CLOSED 2026-08-23** (→ Entry 33). Reviewer verdict quoted: *"**SPEC: DEVIATIONS FOUND** — clause
> 2 is satisfied on MCP only; the CLI half is untranslated and connections without `ipc.connect` get
> nothing [blocking]… **HOLLOW TESTS FOUND** [blocking] — F1 is the serious one: the diagnosis test
> does not exercise the fallback and would stay green under the exact mutation the commit claims it
> pins… I am not rubber-stamping this. Clause 1's reasoning holds up under independent tracing — you
> did not talk yourself into it — but the artifact you committed to make that conclusion durable does
> not do the job, and the clause-2 implementation ships an instruction a CLI operator cannot type."*
> All eleven findings fixed. Gate: 4130 tests, lint, typecheck, clean build.
>
> **Clause 1 needed no code**, and the reasoning survived independent attack: a release must stay
> eligible for the sole-online fallback and a reconnect must attend nothing, which only conflict if
> *resolving a subject* and *attending* are the same act. They are not — three consumers all read the
> `currentAgent` field the fallback never writes.
> **Clause 2 was where my own defects were.** The notice was keyed to the CONNECTION, so under
> parallel tool calls it rode whichever response finished first — a call that named its agent was
> told it had not, while the call that actually fell back said nothing. It now lives in the request's
> async context. It was also spread in downstream of `renderForSurface`, so a CLI operator was told to
> run `cello_use_agent`, which is not a command; and it offered "name the agent on each call" as a
> remedy, which leaves the connection exactly as unattended.
> **Carried:** `DOD-M15-VOCAB-ORDERING-1`.
`DOD-AGENT-SELECTION-UNWARRANTED-1`. **Depends on `DOD-M15-IPCVISIBLE-1`.** One defect with two
faces: after a daemon restart a released agent was silently reinstated (under a *different*
operator's agent name on the same daemon); after an `/mcp` reconnect a selection that had been made
was silently dropped.
- **A release survives a reconnect.** After `cello_stop_using_agent`, a reconnect attends NOTHING
  until something asks again.
- **A connection is never auto-attached to an agent it did not select.** Resolving to "the only agent
  online" is defensible for a CLI invocation that needs a subject; silently binding a live MCP
  session to an identity it never asked for is not. If a fallback is wanted it is **explicit in the
  response**, not announced as an accomplished fact.
- Diagnosis first: reproduce with a daemon restart after a release, with the trigger field from
  `DOD-M15-IPCVISIBLE-1` distinguishing replay from fallback in one run.

---

### `DOD-M15-MANIFEST-EXPIRY-LIVE-1` — ✅ A running daemon notices its own manifest expiring
> **CLOSED 2026-08-23** (→ Entry 35). Reviewer verdict quoted: *"**SILENT FALLBACKS FOUND** — F3
> (`not_before` NaN fails open under a comment asserting it cannot) [blocking]… F4 (contradictory
> restart instructions) and F5 (a remedy the production default cannot perform) are both [blocking]
> under Invariant 2's third check, does the remedy work? **HOLLOW TESTS FOUND** — F1, F2, F7, F8, all
> [blocking]… I am not rubber-stamping this. The diff sits on the trust anchor for directory identity
> authentication and the FROST ceremony roster, and it has a fail-open in the classifier itself, an
> untested wiring line that carries the only unprompted signal, and an operator instruction that the
> same daemon contradicts three files away."* All eleven findings fixed. Gate: 4176 client / 2265
> server tests, lint, typecheck, build — by exit code.
>
> **SCOPE, PLAINLY: the bundled manifest runs to 2030-01-01**, so no production-default operator can
> reach the expired state before then. Reachable today only via the `CELLO_CONSORTIUM_MANIFEST` env
> path, a short-window manifest adopted through the poll, or a wrong clock. This line is over-scoped
> relative to the fleet.
> **The worst defect was mine and pre-existing both:** an unparseable `not_before` fell through to
> `valid` under my own comment saying nothing unmeasurable could; and `signal-submission` told
> operators to RESTART on expiry, which fails closed and takes every agent offline.
> **Decision (ruled, kept): REPORT, DO NOT KILL** — §2b invariant 2 backs warning over blocking. But
> the availability reasoning was wrong: the fleet-wide stop happens anyway at each operator's next
> restart. Report-only defers it.
> **Carried:** `DOD-M15-EXPIRY-CONSUMER-POLICY-1`, `DOD-M15-BUNDLED-2030-1`.

---

### `DOD-M15-EXPIRY-CONSUMER-POLICY-1` — ✅ One policy for an expired anchor, across all consumers
> **CLOSED 2026-08-24 (CELLO_Support). BOTH review passes spent.** Pass 2's five items landed and
> each was verified by MUTATION rather than by re-reading, as it asked. Gate: **3032 passed / 287
> files**, plus 24 bootstrap, 3 registration, 58 transport.
> **The decision was right from the start and never changed** — reviewer, pass 2: *"the decision
> underneath it is right… What blocks the flip is the execution."* All four consumers permit; the
> three that were silent now report; `signal-submission` still refuses, because it reads the portal
> INTAKE KEY and a rotated key means a message the portal can neither open nor attribute.
> **What it cost to get the execution right is the part worth keeping:** pass 1 found I had built a
> security signal an adversary could switch off, and pass 2 found that my FIX for pass 1's other
> finding shipped with its own false claim and no test. Two rounds, both mine, both the same class.
> **Mutations that prove it, run by hand:** revert the membership filter → the no-peer-ids test
> reddens; neuter `classifyManifestValidity(…)` to `null` → the registration test reddens (the source
> assertions it replaced passed that neutering); put the dedup key back before the report → the
> flaky-sink test reddens; restore the old `new Date(expires) <=` → the undateable-manifest test
> reddens.
Split from `DOD-M15-MANIFEST-EXPIRY-LIVE-1` (review F6). The daemon already has a per-consumer
policy for an expired manifest — it just never chose it.
- `signal-submission.ts` REFUSES a trust-signal submission on the held manifest's expiry.
- `register-handler.ts` deals a FROST share against a roster re-resolved from that same lapsed
  manifest, with no gate. The challenge verifier authenticates a directory against it, with no gate.
- **So the lowest-stakes consumer is blocked and the two highest-stakes ones are permitted.** That
  may even be the right answer — but it is undefended, undocumented, and invisible to the operator.
- Decide it deliberately, per consumer, and write down why.

> **⚠️ THIS LINE'S OWN PREMISE IS PARTLY WRONG — checked 2026-08-24 before starting the work.**
> *"Invisible to the operator"* is **not true of the STATE.** `cello_status` already carries manifest
> validity, on two surfaces, via `describeManifestValidity(classifyManifestValidity(...))` — and
> deliberately so: *"contributes NOTHING while the manifest is comfortably in window. A field present
> on every status read for the years a manifest is valid is furniture, not a warning."*
> **What IS invisible is the EVENT** — that a specific high-stakes operation went ahead on a lapsed
> manifest. An operator can see *"my manifest expired"*; nothing tells them *"and a FROST share was
> dealt against it anyway."* That is the real gap and it is smaller than the line implies.
>
> **The per-consumer stakes are also not interchangeable, which is the reason the policies differ and
> why "make them consistent" would be the wrong fix.** Read out of the code rather than assumed:
> - `signal-submission` uses the manifest's **portal intake key**. A rotated key means a message the
>   portal *cannot open and cannot attribute* — its own comment calls it unattributable poison, with
>   no error anywhere. **Refusing is right, and it is specific to the intake key, not to expiry.**
> - `register-handler` uses the manifest's **validator roster**. A stale roster risks dealing a FROST
>   share to a node that has since been removed.
> - the challenge verifier uses the manifest's **node pubkeys** to authenticate a directory.
>
> **And a refusal here is not free, which the line does not say.** Startup already fails closed on an
> expired manifest, so a lapsed manifest only exists inside a LONG-RUNNING daemon — and
> `signal-submission`'s own guidance warns that the obvious remedy is the one move that must not be
> made: *"a restart without a REPLACEMENT does not reload anything — the daemon refuses to come back
> and every agent goes offline."* **So "refuse everything on expiry" risks bricking a running
> operator to close a window that needs a roster change to be exploitable at all.**
> **`classifyManifestValidity` already exists and is the shared policy object** — the two permitting
> consumers simply never call it, which is what makes the split accidental rather than chosen.
>
> ### THE DECISION, per consumer, made 2026-08-24 (§3a — least likely to need reversing)
>
> **All three keep their current behaviour. What changes is that two of them stop being silent.**
> The split is not inconsistency — it tracks WHICH FIELD of the manifest each one uses, and that is
> the reason "make them consistent" would be the wrong fix:
>
> | consumer | manifest field it uses | on expiry | why |
> |---|---|---|---|
> | `signal-submission` | the **portal intake key** | **REFUSE** (unchanged) | a rotated key means a message the portal cannot open *or attribute* — its own comment calls it unattributable poison, with no error anywhere |
> | `register-handler` | the **validator roster** | **PROCEED, loudly** | refusing strands a running daemon; the risk needs a validator *removed since the lapse*, not expiry itself |
> | challenge verifier | the **node pubkeys** | **PROCEED, loudly** | refusing means a lapsed daemon can authenticate NO directory — every agent offline, for a manifest that was valid at startup |
>
> **The reversibility argument, which is why this is the safe call.** Startup already fails closed on
> an expired manifest, so a lapsed one exists only inside a long-running daemon — and the obvious
> remedy is the one move `signal-submission`'s guidance forbids: *"a restart without a REPLACEMENT
> does not reload anything — the daemon refuses to come back and every agent goes offline."*
> **Turning these two into refusals would brick a running operator to close a window that needs a
> roster change to be exploitable.** Adding the events is additive and can be tightened later on
> evidence; a refusal cannot be un-shipped from someone whose daemon will not restart.
>
> **Reported ONCE per manifest version in the verifier** — it runs per challenge, and an event per
> challenge is the flood that teaches people to ignore the signal.
> **A finding on the way past:** `ManifestDirectoryChallengeVerifier` lives in `manifest-stubs.ts`
> and is **production** — wired twice by `manifest-deps.ts`. Anyone reading that filename and
> assuming test-only is wrong about that class. Noted in the file itself.
>
> ### REVIEWED — "DO NOT FLIP" with five findings. All addressed 2026-08-24.
> **The decision survived; the execution did not.** Reviewer: *"The **decision** is right and I would
> not change any of the three behaviours… What blocks the flip is the execution."*
> - **THE ONE THAT MATTERS — I built a security signal the adversary could switch off.** The
>   verifier's report fired BEFORE the signature check, so a rogue directory could send any `nodeId`,
>   spend the once-per-version budget, and leave every genuine authentication against the lapsed
>   anchor **silent for that manifest version**. Its absence would then read as safety. It also sat
>   inside the crypto `catch`, so a throwing logger would have reported that a healthy directory
>   **forged its identity proof** — error substitution, in code written during a milestone about
>   error substitution. Both close by moving the report to the success path.
> - **A FOURTH CONSUMER the line never enumerated**, and it holds the real residual risk:
>   `getManifestPeerIds` decides which directory endpoints are ACCEPTED, so a lapsed set keeps a
>   removed node eligible for the seat that coordinates a ceremony. Permit + report, same reason.
> - **The registration event over-claimed in the case it named.** Review traced it: a removed
>   validator is dropped at the dial layer or makes the counts disagree, so registration REFUSES with
>   `dkg_below_threshold`. Dealing a share to a de-authorized node is **not reachable**. The event
>   now explains that refusal instead of predicting a leak.
> - **`register-handler` acted on one of three abnormal states** — `unreadable_window` and
>   `not_yet_valid` reached the DKG silently. Widened.
> - **THE PREMISE HAD A HOLE, and it was mine to own:** the startup gate compared `new Date(expires)`
>   with `<=`, and every comparison against NaN is false — so an **undateable** manifest started the
>   daemon. That falsified "a lapsed manifest only exists in a long-running daemon", because such a
>   daemon starts *fresh* into it, permanently, while my guidance said not to restart. Fixed via the
>   shared classifier; mutation-proven.
> - **Zero coverage, three green suites.** 2869 + 154 + 1742 passing and **not one line of the new
>   code had executed** — every verifier fixture was in-window and every registration test had no
>   manifest at all. Six tests added, plus the fixture whose default expiry was four months out.

---

### `DOD-M15-DOORBELL-1` — ✅ A daemon shutdown does not ring like an incoming message
> **CLOSED 2026-08-22, in the four-unit DAEMON-PATH batch review** (`BACKUP-1`, `DOORBELL-1`,
> `DIVERGE-DURABLE-1`, `IPCVISIBLE-1` reviewed as one pass — Entry 55).
>
> ⚠️ **THIS ENTRY USED TO QUOTE `BACKUP-1`'S FINDINGS**, not its own — see the note on
> `DOD-M15-DIVERGE-DURABLE-1`. Corrected 2026-08-24 to quote **this line's own** finding:
>
> *"a dying daemon rang the same bell as an incoming message, so an agent following its standing
> contract called the inbox against a dead daemon and reported a protocol fault. Now `wake_action`,
> defaulting to READ so a future doorbell is never silently ignored. **My comment crediting a skip
> with the anti-spoof property was wrong** — the assignment order carries it; corrected rather than
> left standing."*
>
> **`daemon_reconnected` was marked `none`** — the one wake-up where there genuinely may be unread
> mail, because it fires when the daemon has just been DOWN. Marking it "do not read" was a new way
> to miss a message. Now `read_inbox`.
> **BUILT 2026-08-22, unreviewed.** `wake_action: read_inbox | none` on every channel frame, marked
> for ALL housekeeping types rather than just shutdown, defaulting to `read` so a future doorbell is
> never silently ignored. Named `wake_action` not `cello_action` — a parity guard caught that every
> `cello_*` token in shipped prose is a TOOL, and an agent would try to call it. Both SKILL.md files
> document it. My comment crediting a skip with the anti-spoof property was WRONG (the assignment
> order carries it); corrected rather than left standing.
Shutdown is forwarded through the notification channel with the same generic shape as a real
doorbell, so an agent following the contract calls the inbox, gets `daemon_not_running`, and reports
a protocol failure while the actual event goes unreported.
- Either do not forward shutdown through the channel, or give it distinguishable metadata.

---

### `DOD-M15-SAMEOP-1` — ✅ Same-operator standing does not depend on which node answered
> **CLOSED 2026-08-24 (CELLO_Support) — by VERIFICATION, not by new code, and both halves are
> evidenced below.** The reader had already been moved to the replicated link on the stable
> `agent_id` (with a live measurement in the code: 0/7/7 of 14 agents resolved before, 14/14/14
> after), and Case 1 turned out to be unreachable rather than merely bounded.
> **No test was added and none is owed:** the reader move carries its own production measurement,
> and Case 1 is closed by a structural fact — an agent is never the submitter — not by a behaviour
> that could regress silently. **What COULD regress is the chokepoint itself**: if anything other
> than the portal is ever enrolled in `authorized_issuers` with a submitting role, Case 1 reopens.
> That is the line to watch, and it is an enrolment decision, not a code path.
`DOD-SELF-STANDING-NULL-LINKAGE-1` + the security half of `CELLO-REPL-001`.
- **The account arm reads a node-local column.** Measured live for one operator with three agents:
  `usc1` had 2 linked, `euw1` 1, `use1` 0. **Searching every node does not fix this** — the
  first-node-with-a-hit strategy may return the one holding the NULL link. The reader moves to the
  replicated table, and **this is the reader to move first.**
- **✅ THE READER HAS ALREADY BEEN MOVED — verified in the code 2026-08-24, not by me and not
  recorded here until now.** Both readers now JOIN the replicated link on the STABLE `agent_id`:
  `pg-directory-store.ts` `getAgentsByAccount` and, more importantly, the portal-facing endpoint in
  `internal-api-server.ts`, which carries its own measurement — *"the old column resolved an account
  for 0 of 14 agents on gcp-use1, 7 of 14 on gcp-usc1 and 7 of 14 on gcp-euw1. The JOIN below
  resolves 14 of 14 on all three."* **`LEFT` JOIN deliberately**, so an agent registered but not yet
  portal-bound still resolves as found with a null account.
  **Why it mattered, in the code's own words:** the portal's same-operator check is
  *"accountId match OR phone-stub match"*, and a blank account does not read as "I don't know" to
  that expression — it flows in as "no match". **So half the check that stops an operator
  manufacturing standing by having their own agents endorse each other was being decided by which
  node the portal happened to ask.**
- **Case 1 — ANSWERED by recording the bound, which is what this line asked for.** The state (no
  account AND no verified phone, so nothing links two agents) is **not reachable by an arbitrary
  registered agent**, because standing can only be manufactured by an agent that can SUBMIT, and
  submitting is gated on `authorized_issuers` — active status, correct role, refused loudly
  otherwise (`signal-write.ts`: `unknown_issuer`, `issuer_revoked`, `issuer_wrong_role`).
  - **Enrolment into that table is NOT automatic.** The only writer in either repo is the ops script
    `infra/scripts/publish-registry.mjs --enrol`, and it enrols the `registry` role. The portal's own
    signing key is enrolled for the mint journey. **Registration does not put an agent in there.**
  - **So the bound is: the Case 1 state is reachable only for an agent an operator DELIBERATELY
    enrolled as an issuer** — a small, operator-controlled set, not "any agent that registered".
  - **✅ THE SEARCH I SAID WOULD DECIDE THIS — done, and it CLOSES Case 1 rather than bounding it.**
    There is no agent-role enrolment path because **an agent is never the submitter.**
    `agent-write-validation.ts` states it: *"trust signals now enter ONLY through the signed
    chokepoint (`POST /internal/signal/submit`, re-hashed and authorized against
    `authorized_issuers`)"* — and the key enrolled there is **the portal's own** signing key.
  - **So the two `issuer` concepts are different things, which is what made this look open:**
    `authorized_issuers` answers *"who may SUBMIT"* — the portal — while the 32-byte agent
    `issuer_pubkey` inside the payload answers *"whose endorsement is this"*. `signal-write.ts`
    validating an agent pubkey is validating the **payload field**, not an enrolment.
  - **Case 1's state is therefore UNREACHABLE for anything that can manufacture standing.** An
    endorsement only reaches the directory by being minted through the portal, minting requires a
    portal session, and a session requires an account — so the agent named as issuer necessarily has
    one, and `agent_account_links` necessarily has its row. **"No account and no verified phone" and
    "able to submit" cannot both be true.**
- Case 2 (unresolvable issuer) was closed by `DOD-END-ISSUER-REGISTERED-1`; do not re-open it.

---

### `DOD-M15-BACKUP-1` — ✅ An identity can be exported and restored
> **CLOSED 2026-08-22.** Reviewer verdict quoted: *"**SILENT FALLBACKS FOUND** — F4 (`readLock` →
> null → proceed) [blocking]; F5 (mode silently not applied on overwrite) [blocking]; F6/F7
> (crash-window states that open and are wrong, no fsync) [blocking]… **HOLLOW TESTS FOUND**
> [blocking] on four… I am not rubber-stamping this: BACKUP-1 writes a private key and overwrites a
> database, and it has three findings in exactly those two operations plus an agent-facing surface
> that cannot be called."* Every finding fixed. Gate: 4111 tests, lint, typecheck, clean build.
>
> **Three findings in the two operations that matter.** `mode: 0o600` is honoured only at `O_CREAT`,
> so `--force` onto an existing 0644 file left a WORLD-READABLE signing key (measured). Restore wrote
> the key BEFORE the database, so a crash on a fresh machine left SQLCipher creating an empty
> database that opens clean and silent — now temp-file + fsync + rename, database first. And the
> daemon-running guard used `readLock`, which returns null for absent AND unparseable and took the
> permissive branch on both — now `probeSingletonLock`, refusing on `unknown` too.
>
> **The tools could not be called at all**: both declared an empty parameter schema while the daemon
> required `path`, so an agent got guidance naming a parameter it had no way to send. Both shipped
> SKILL.md files also still said "not implemented".
> **BUILT 2026-08-22, unreviewed.** Export + overwrite-restore, merge still deferred. **The archive
> carries the KEY**, because the DoD's own wording ("export the SQLCipher database") produces a brick:
> a fresh daemon mints its own key and cannot open it. Round-trip test restores into a directory with
> a DIFFERENT key to prove it. The archive is therefore as sensitive as a private key and both
> surfaces say so. Restore validates fully in memory before touching disk. `cello restore` is CLI-only
> (a live daemon could flush its own pages over the restored ones); `cello backup` is CLI too, so an
> identity can be exported when the daemon will not start.
`DOD-CUSTODY-DAEMON-1`. `backup` and `restore` exist as commands and report "not implemented"; a lost
machine loses the agent permanently.
- **Backup** = exporting the SQLCipher database for transport.
- **Restore V1** = overwrite the existing database on the target device.
- **Merge** — restoring onto a device with its own live state — is **explicitly deferred** (see
  Explicitly Beyond). Launch ships export + overwrite-restore.
- The logic moves out of the chat-tool layer into the daemon as an actual capability. A round-trip
  proof is owed.

---

### `DOD-M15-HASHCORRELATE-1` — ✅ A message hash does not identify the message across sessions
> **UNFLIPPED 2026-08-24, same session, on review. I flipped it on a claim that is FALSE.**
> Verdict quoted: *"**DO NOT FLIP** … the entry justifying the flip is factually wrong in the
> sentence that carries it, and two of the four tests it points to are decoration."*
>
> **The false claim was mine and it was the load-bearing one:** *"no test for the property it
> names."* There are four, in two files that predate my commit — including
> `dod-m15-session-salt.test.ts:147`, whose own comment reads *"This is the whole point of
> HASHCORRELATE-1"*, and `:70`, which is literally the global-salt adversary. **A global-salt build
> goes red in five places outside the file I was reading.** True of that file alone; false of the
> repo — and I made the repo-level claim.
> **The same failure as everything else tonight, one turn further out:** I checked whether the file
> in front of me covered the property and never asked whether the repo did.
>
> **CLOSED after meeting all three of the reviewer's stated conditions.**
>
> **Closing the exposure is a CHAIN OF FOUR LINKS, and three were already covered before I started:**
> 1. a FRESH contribution is minted per session — **this was the untested one**
> 2. two fresh contributions → two different salts — `dod-m15-session-salt.test.ts:62`
> 3. different salts → different hashes — `…:147` and `dod-m15-content-hash-alg-wired.test.ts:569`
> 4. the daemon really hashes salted when it holds a salt — `dod-m15-send-consults-the-salt.test.ts:62`
>
> **Link 1 is a daemon concern no crypto test can see** — they are handed salts as parameters.
> `#saltContributionFor` caches our own half on `(agentName, sessionId)`. **Drop `sessionId` from
> that key and every session between the same two agents shares one salt forever**, the exposure
> returns in full for that pair, and every one of those tests stays green: the salt they are handed
> is still a perfectly good salt. It is simply the same one.
>
> **The new test feeds both sessions an IDENTICAL peer contribution, and that is the whole design.**
> With the peer's half held constant, the only thing that can make the two salts differ is our own
> half being freshly minted. **Vary both halves and it passes for the wrong reason** — the peer would
> be doing the work, and a daemon that reused its own contribution forever would sail through. It is
> also the real adversary: a peer that reuses a fixed contribution is how you would attack this.
>
> **Mutation-proven:** dropping `sessionId` from that cache key reddens exactly the two new tests and
> leaves **35 others green**, including the entire crypto salt suite. **Two of my four original tests
> were deleted** — each justified itself with a guard a stronger neighbour eight lines away already
> provided.
>
> **What was missing, and it is a bypass rather than a gap.** The existing tests prove the salted
> form differs from the unsalted one and that it is HMAC rather than `SHA-256(salt ‖ content)`. Both
> true; neither is this. **The property is about two SESSIONS** — and a build hashing under a single
> GLOBAL salt satisfies every one of those assertions while leaving the exposure exactly as it was:
> one precomputed table instead of none.
>
> **Proven by mutation, not asserted.** Replacing the session salt with a fixed constant turns the
> new cross-session assertion RED — and leaves the other three of my four GREEN, which is the whole
> argument for the fourth: *"the same salt still matches itself"* and *"a different message still
> differs"* are both true under a global salt. **They were never sufficient, and they look like
> coverage.**
>
> **The old algorithm is kept in the file as the CONTROL**, pinned as producing an identical
> fingerprint in every session — so the file reads as the defect and its removal rather than as a
> claim about an implementation detail.
Found by Andre 2026-08-23 and **verified against the code before recording**. Live today, previously
written down nowhere, and a per-session salt fixes it as a side effect.

- `wireContentHash(content) = SHA-256(0x00 ‖ content)` — **nothing session-specific enters it.**
  Confirmed at the definition and at all six call sites: every one passes content alone. No session
  id, no agent pubkeys, no salt.
- So **the same message text produces the same 32 bytes in every conversation, between every pair of
  agents, forever.** The exposure is not merely "a relay can spot repeats within one session": a
  relay can **correlate the same message across different sessions and different agent pairs**, and
  can build a table of common short messages once and read them everywhere.
- **Chaining would not have fixed it**, and the record should say so because it is the natural first
  idea: the adversary holds the previous hash, so they would simply compute `hash(previous ‖ guess)`.
  Chaining hides repeats; it does not hide content.
- **Message leaves are NOT chained** — they are independent leaves in a Merkle tree. *(Refinement
  from the verification: `Structure2` does carry a `prev_root`, but it is the RELAY's running Merkle
  root over prior leaf records, assigned by the relay — not a client-computed chain, and not part of
  the content hash. So "not chained" is right about the hash; a reader who greps and finds
  `prev_root` should not conclude otherwise.)*
- The prev-hash chain that does exist is `doc_prev_hash` on **document envelopes** — a different
  mechanism on a different object (`core/protocol-types/src/document-envelope.ts`).
- **Fixed by Decisions Carried #8** (per-session salt) **and #9** (HMAC rather than
  `SHA-256(salt ‖ message)`, which has a length-extension weakness). Recorded as its own line so the
  exposure is on the record independently of the fix that closes it.

---

### `DOD-M15-SEALWIRE-1` — ✅ The receipt is bound to the transcript
> ### ✅ BULLET 5 CLOSED FOR REAL, 2026-08-24 (CELLO_Support) — the held path EXECUTES and the mutation REDDENS.
> The reopening was correct and the fix is the test that never existed. **The carrier is now driven
> end to end:** hold a SENT leaf at slot 1 ahead of the frontier (asserting it really was held and
> the transcript is still empty), then close the gap by ingesting a received message at slot 0 —
> which is what runs `#releaseHeld`, **the only path that writes a held SENT row** — and read a
> 64-byte signature and the pubkey back off the released row. Its pair asserts the truthful negative:
> a hold carrying no proof stores none, so the first test is reading a proof that **travelled**
> rather than one the release path invented.
>
> **THE REVERT TEST, RUN — this is the whole reason the bullet was reopened.** Delete
> `...(authorship ? { authorship } : {})` from the hold in `placeOwnLeaf`:
> **the held-path test goes RED and the other four stay GREEN.** The identical mutation previously
> passed on 3 tests. Code restored, verified back to 5/5, and the manager's diff is empty.
>
> **Gate: the WHOLE daemon package — 278 files, 2906 tests, exit 0. Typecheck 0, eslint 0.** The
> committed change is test-only; no production line moved.
>
> ### ⚠️ THE ORIGINAL PREMATURE CLOSE, kept because the reasoning is the lesson.
> **REOPENED 2026-08-24 on `CELLO_Coder_1`'s measurement.**
> **My witnessed test covers the DELIVERED writer, not the sixth one — and the two mutations say so
> in the same file:**
> - remove authorship from `recordTranscriptMessage(...)` → **RED (1 failed / 2 passed)** ✅
> - remove it from `placeOwnLeaf(..., sentAuthorship(...))` → **GREEN (3 passed)** ❌
>
> **Structural, not a harness gap.** On the delivered path `placeOwnLeaf`'s authorship argument is
> dead by construction — the row's proof arrives from the `recordTranscriptMessage` call below it.
> That argument is load-bearing in **exactly one case: when the leaf is HELD** — and on that path
> `recordTranscriptMessage` never runs, because it sits inside `if (placed.placed)`. **The held entry
> is the only carrier, and it has no executing test.**
> **So the mutation I proved reddened for the wrong writer**, and I read a green from the delivered
> path as coverage of both. `CELLO_Coder_1` is taking the held-path test.
>
> ### ⚠️ AND A DEFECT IN MY HALF THAT NOTHING COULD HAVE CAUGHT
> **`placeOwnLeaf` took `authorship?:` — optional — and THREE of seven call sites omitted it**
> (`daemon.ts` 1440 / 1671 / 1685, the away-reply paths). Each had the proof **in a local variable
> and handed it to `recordTranscriptMessage` one line below**, just not to the leaf. Invisible while
> delivered; on the held path it commits `self_authored` with no signature.
> **Nothing went red and nothing could — an optional parameter's whole behaviour on omission is to
> look deliberate.** Fixed by `CELLO_Coder_1` at the SIGNATURE rather than the call sites:
> `authorship: SentAuthorship | undefined`, **required**. Absence stays expressible; the caller has
> to say it. **Both directions measured: omission → a type error; substitution → 0 errors.** The type
> system cannot see substitution — that is the held-path test's job.
> **CLOSED 2026-08-24. Both lanes. This was the milestone's remaining gate item.**
> **Bullet 5's last gate — a test that EXECUTES the path — is met and mutation-proven.** Remove the
> `authorship` argument from the delivered call site and the witnessed test reddens while the other
> two stay green. That is the exact bypass review named, where the whole suite previously passed
> while the feature did nothing.
> **Bullet 8 is measured across every converted journey**: `j-legibility` observed
> `verdict: "match"` on a live cross-process seal, and the `agentName` batch (`j-refresh`, `j-sign`,
> `j-loopback`) is 3/3.
> **GATE, reported as it happened rather than rounded up: 2877 passed, 7 skipped, and ONE FILE
> FAILED** — `m9b-gate-1-composition-root`, which shells out to `tsc --build` inside a 2884-test run.
> It passes **7/7 in isolation** and the project build is clean standalone. **I could not reproduce
> it and I am not calling it flaky**: the mechanism is a test that runs a full project build under
> load, which is a real hazard in that test rather than in the product. **Filed as its own item.**
> **⚠️ WHAT THIS LINE DOES NOT GIVE YOU, stated at the close rather than buried:** the stored
> signature is **not yet verifiable** — the certified root covers content hashes only, the proof
> columns sit under no root, and the signed bytes are not stored beside the signature. **"A durable
> record of a value we already held, correctly labelled — not yet a proof."** Recommendation and
> reasoning are in bullet 5's block; the decision is Andre's.
> **THE ALREADY-✅ BULLETS WERE RE-AUDITED before closing (2026-08-24), because a stale ✅ has been
> this milestone's most reliable source of real findings — including this line's own header, which
> still said bullet 5 was untouched long after its received half shipped.** Each check ran with a
> POSITIVE CONTROL first, per §7:
> - **`final_root` verification EXISTS** and the deferral comment is gone (9 hits for the control; 0
>   for the deferral phrasing).
> - **The circular root check is genuinely replaced**, and for the stated reason — the comparison is
>   against *"the client's OWN signed claim about its own transcript … the only value in reach that
>   the relay cannot produce."* That is exactly *"compare against something the relay did not
>   supply"*, not a paraphrase of it.
> - **`seal_attempt` is deleted from BOTH repos**, and a dedicated test keeps it deleted.
> - **The content hash is salted in production** — confirmed live on this session's own record
>   (`contentSalted: true`), not only in tests.
> **✅ BULLET 6 — the content hash is salted.** All six B2b-2 constraints, both review passes spent
> (→ Entries 49–52). A session holding an agreed salt hashes under `hmac-sha256-salt-v1`.
>
> **✅ BULLET 7 — the dead `seal_attempt` path is deleted.** Both passes spent (→ Entries 53, 54).
> Pass 2's verdict: *"The removal itself is sound; what is left is what the removal left behind."*
> Both halves of the PERSIST-014 exchange are gone — the directory's `seal_attempt` handler and the
> relay's `gap_fill_request` half, whose only trigger was the reply the first deletion removed.
> Two POST-LAUNCH items fell out of it: `DOD-M15-GRACE-WINDOW-1` and `DOD-M15-RELAY-WAL-UNWIRED-1`.
>
> **🟢 BULLET 8 — COVERAGE COMPLETED (CELLO_Support, 2026-08-24). The `agentName` batch is GREEN:
> `j-refresh` ✓ 65s, `j-sign` ✓ 64s, `j-loopback` ✓ 45s — 3 files, 3 tests, 0 failures.** These were
> the three that needed the discriminator in the built artifact, and `j-refresh` was the last
> journey `CELLO_Coder_1` listed as unmeasured. **Both of its open questions are now answered by runs
> rather than by reasoning.**
> **⚠️ AND THIS IS STILL NOT A GREEN LANE** — `j-documents`, `j-multiplayer` and `j-content` remain
> red for causes that predate bullet 8, one of which (`awaitSealedRoot` timing out at 60s) is
> `CLOSEROOT-1`'s shape and is a real lead. **A green assertion is not a green lane**, and the two
> must not be allowed to imply each other.
> **🟢 BULLET 8 — RUN, and `expectOwnTreeVerified` has been OBSERVED GREEN (2026-08-24 ~03:15 UTC).**
> `j-legibility` passes, and its single test contains both assertion calls — so both executed and both
> returned `verdict: "match"`. **The assertion has now done the thing it was written to do on a live
> cross-process seal**, which is what "written-not-run" was blocking on.
>
> **My two open questions are answered:** `j-legibility` does NOT land `cannot_judge` — the concern
> that its deliberately-unanswered tail would leave B's carry provably incomplete did not
> materialise. `j-refresh` is still unmeasured (second batch, needs the `agentName` discriminator).
>
> **⚠️ AND THE ASSERTION NEVER FAILED ANYWHERE.** Across four journeys and 30 tests, zero occurrences
> of any of its three failure messages. The 17 failures in that run are pre-existing and the counts
> match the other lane's pre-bullet-8 baseline exactly (`j-documents` 7, `j-multiplayer` 5 after their
> `SYNC-AC17` fix, `j-content` 5). **Bullet 8 introduced no failure.**
>
> **What it is NOT: a green lane.** Three of four journeys are red for reasons that predate this work
> — most visibly a seal that does not produce a receipt within 60s in `j-documents`' rejection case,
> which is `DOD-M15-CLOSEROOT-1`'s shape and now reports itself clearly instead of as a bare
> `expected false to be true`. Bullet 8's own clause is satisfied; the lane's health is a separate
> line.
>
> Original note (→ Entry 63): All ten `sealed_root`
> equalities now carry a per-side assertion that the daemon compared the certified root against the
> leaves IT holds; `cannot_judge` is explicitly not a pass. Pass 2's verdict: *"SPEC: FAITHFUL — all
> ten converted, none declined, count verified independently."*
>
> **It stays yellow because nothing has been run.** The change is made entirely of journeys, the
> spine lane belongs to the other lane, and the milestone rule is explicit: *"no milestone closes
> until a live multi-process smoke test passes; Vitest green ≠ done."* Two questions only a run
> settles, both raised by pass 2:
> - `j-legibility` and `j-refresh` may legitimately land `cannot_judge` — B answers nothing in one,
>   and the other seals three times across two epoch rollovers. If they do, the fix is to scope the
>   assertion, not the daemon.
> - `j-gcp-live`'s conversion is behind `CELLO_GCP_E2E=1` — written, not exercised.
>
> **Precondition for that run: `cello-client` must be BUILT.** Pass 2 found `dist/` five minutes
> behind the source, which would have cost six minutes of dead wait and a red message blaming the
> seal. A package-scoped `tsc --noEmit` does not write `dist/`.

> **✅ BULLETS 3 AND 4 — the directory checks the relay against a client signature.** Both review
> passes spent (→ Entries 61, 62). Pass 2's verdict on the tests: *"REMOVALS PROVEN […] HOLLOW TESTS
> FOUND — one"*, and that one is closed. What the check catches, measured: a relay that deletes a
> message leaf and recomputes the chain over what remains passes **every** pre-existing check —
> `sequence_number` and `prev_root` are relay-assigned and inside no client signature — and is now
> refused by name.
>
> Pass 1 found the chain built except its head: four legs shipped and reviewed green while **no
> client produced the bytes**. Pass 2 found that my fix for it checked the leaf kind and none of the
> properties its own justification claimed. Four POST-LAUNCH lines fell out:
> `DOD-M15-NOTCARRIED-REFUSE-1`, `DOD-M15-SEALROOT-UNILATERAL-1`, `DOD-M15-SEALREJECT-MUTE-1`
> (classified BELOW the reviewer's severity, with the disagreement written into the entry), and
> `DOD-M15-SEALROSTER-FEDERATED-1`.

> **⚠️ BULLETS 3 AND 4 ARE ONE UNIT.** Bullet 4's circular check cannot be fixed alone: its
> replacement is bullet 3's client-signed `final_root`, which survives only inside a SHA-256
> pre-image that is never transmitted — so it needs the wire change bullet 3 carries. The check
> itself is KEPT; what changes is that it stops being the integrity guarantee.
>
> ### ✅ THE PUBLISH HAPPENED — 2026-08-24. THIS IS NO LONGER A STOP. Do not re-raise it.
> Verified against npm rather than read from this file: `a0add31` *"chore: version cascade — the SEAL
> PAYLOAD now reaches the wire (SEALWIRE-1 bullets 3+4)"*, committed 02:24 CEST, all seven packages
> bumped, `@cello-protocol/daemon` 0.0.181 → **0.0.182**, published 01:12 UTC and live on `latest`.
> **The client sender ships. Seals no longer land on `not_carried` for want of a payload.**
>
> **Recorded because a stale stop cost real time:** this note still read as an open human-gated stop
> hours after it was cleared, and was reported to Andre as outstanding by someone reading this file
> instead of npm. A parked marker with no closing stamp is indistinguishable from a live blocker.
> **`DOD-M15-NOTCARRIED-REFUSE-1`'s prerequisite is met** — it was waiting on the deployment fact.
>
> **The original note follows, struck rather than deleted, because the reasoning still binds anyone
> shipping a wire change:**
>
> > **~~🅿️ BULLETS 3+4 NEED A `cello-client` PUBLISH BEFORE THEY DO ANYTHING FOR AN OPERATOR —
> > PARKED, HUMAN-GATED.~~** The chain is four legs plus a fifth that review pass 1 found missing and
> > nobody had listed: the CLIENT SENDER. It is built now (2026-08-24, `@cello-protocol/daemon`), but
> > a leg that lives only in the repo is not a leg an operator has. Until the version cascade is
> > published and installed, every real seal still reaches the directory with no payload and lands on
> > `not_carried`.
>
> This was a **stop only Andre could clear** (§🛑): the `latest` promotion is his, never mine.
> Consequences, which held then and are worth keeping:
> - **Directory-side behaviour is unchanged for un-upgraded clients** — receiver-first was followed,
>   so absence stays tolerated and nothing breaks by shipping the directory first.
> - **`DOD-M15-NOTCARRIED-REFUSE-1` cannot start until this lands.** Its whole prerequisite is the
>   deployment fact, not a code change.
> - **The two client-side guards can refuse a close.** Deliberate — see the sender-leg commit — but it
>   is the one behaviour change an operator could feel, so it should not go out unannounced.

---

### `DOD-M15-RELAYPARK-1` — ✅ The parked-message store refuses instead of writing past its cap
> **SPLIT OUT OF `DOD-M15-RELAYABUSE-1` 2026-08-24 (Andre).** It was a bullet inside a large line, so
> finishing it changed no tag and nobody could tell it was done — or, before that, that it was free
> to claim. Three of Andre's five quick wins were bullets in this position.

---

### `DOD-M15-RELAYPUBKEYS-1` — ✅ An incomplete directory key set stops the relay instead of degrading it
> **SPLIT OUT OF `DOD-M15-RELAYABUSE-1` 2026-08-24 (Andre).** Same reason as above. This was quick
> win #3 and it was delivered, marked done, found to have been **built against the wrong subject**,
> and rebuilt correctly — a sequence that was invisible at line level because the line never moved.

---

### ✅ park rate limiting — CLIENT HALF DONE 2026-08-24 (CELLO_Support), REVIEWED, blocking findings fixed
> **MY PREDICTED RISK CAME BACK CLEAN — for a reason I was not relying on.** No thundering herd:
> `flushAwaitingContent` is **already coalesced** on its filter key, so N timers become one drain plus
> at most one rerun; and the drain path could not schedule at all, because it dropped the delay. The
> second half of that answer is the next finding.
> **⚠️ BLOCKING, AND IT WAS MINE: the three new guidance branches never consulted `durable`, so they
> told an operator a LOST message was queued.** `durable` is OBSERVED, not assumed — false when the
> durable enqueue collides on the dedupe key, or the retry hook is unwired. So the daemon logged at
> ERROR that the content is not retained while the operator was told *"queued and re-sent
> automatically — do not re-send it."* **Nothing held the message, and they had been instructed not
> to send it again.** That is the exact lie this family of work exists to kill, reintroduced one
> layer up. Fixed by COMPOSING diagnosis + action, so the action half exists in one place and cannot
> be reached without reading the flag. **Every test I had written passed `durable = true`**, which is
> why it was invisible; six now cover both directions.
> **⚠️ HIGH-2: the DRAIN path dropped the delay, which undid the feature for a BACKLOG.** Only the
> live send path could hear it. With a backlog larger than one window the relay allows N, the drain
> deposits N, and every remaining item falls back to waiting for an unrelated reconnect — **the exact
> condition the retry was added to remove.** `ParkResult`'s failure member now carries it, and the
> drain reports it **ONCE PER PASS, not per item** — per item would be one timer per message, the
> flood the limiter exists to prevent, generated by the code that respects it. The largest delay in
> the pass wins; retrying at the smallest means arriving early and being refused again.
> **⚠️ THE TIMER HAD NO UPPER CLAMP, and the reviewer MEASURED the consequence:** Node's `setTimeout`
> holds an int32, so a relay reporting `3_000_000_000` overflows it and fires in **~1 ms** —
> re-parking instantly into the limit that just refused, plus a `TimeoutOverflowWarning` on stderr
> from a daemon whose convention forbids console output. Clamped 1s–5min, and the clamp is
> ANNOUNCED: a relay asking for 35 days is a fact an operator wants.
> **Also fixed:** the drain was global, and the coalescing key is the FILTER — so a global and a
> per-agent drain are different keys, can run concurrently over one session, and since an entry is
> removed only after a SUCCESSFUL park, the overlap can deposit the same entry twice and burn two
> slots of the budget being limited. Now scoped. Timers are tracked and cleared on shutdown like
> every other daemon timer; a thrown drain logs instead of being swallowed; scheduling is announced.
> **Both park paths now share ONE scheduler** — a second copy is precisely how the clamp ends up on
> only one path, which is the shape review found here.
> **⚠️ AND TWO OF MY TESTS WERE HOLLOW:** they defined a local copy of the ack parse and asserted
> against the copy, so deleting the shipped lines left them green. Removed in favour of tests that
> bind to what ships.
> **Verified by execution, not by eye (reviewer):** the three moved guidance strings are BYTE-IDENTICAL
> to what shipped, checked against the built artifact — so the refactor changed nothing for any input
> reachable before it.
> **Gate: daemon 281 files / 2937 tests / exit 0; typecheck 0.**
> **CARRIED:** the guidance still says the limit clears *"in about a minute"* — a hardcoded guess
> about the relay's configurable window while the real number is now in hand; `cause` still does not
> cross the IPC boundary, so an MCP caller distinguishing throttle from store-full is back to reading
> English; and the three wire strings are declared independently in both repos with no shared
> definition and no cross-repo test.
> **The relay half is closed below. This is the client's side of the same wire, and it closed two
> gaps the relay half created.**
> **1. A THROTTLING RELAY IS NOT AN OUTAGE, and the operator-facing sentence said it was.** *"Queued,
> and will be re-sent automatically when the relay link is back"* was written when a refused park
> could only mean the link was down. Rate limiting made the opposite cause reachable — the relay
> answered promptly and said no **on purpose** — so the sentence sends the operator to inspect a link
> that is fine (**a wrong diagnosis is worse than none: it says where NOT to look**) and promises a
> trigger that never fires, because a deferred park is retried only on EVENTS and no link-restored
> event is coming. Four causes now have their own words, keyed on codes: rate-limited says the relay
> is healthy and the limit clears itself in about a minute **and still says do not re-send**, because
> re-sending is what the limit exists to slow; a full RECIPIENT mailbox points at the counterparty and
> says another relay would refuse it too; a full STORE points at the relay operator. The original
> wording survives for a real outage, pinned by its own test.
> **⚠️ Why the wrong sentence survived: it was an inline ternary inside `sendContent`**, so reaching
> any branch meant standing up a two-connection fixture and driving a real send. Nothing cheap could
> test it, so nothing did. Now a pure function — **a guidance string is a decision about what a person
> does next and deserves to be assertable on its own.**
> **2. `retry_after_ms` HAD NO READER.** The relay computed exactly when the throttle clears, logged
> it, asserted it in a relay test — and the client dropped it off the ack. That is this milestone's
> most-repeated defect, and I had just shipped a fresh instance of it. The client now carries it and
> the daemon schedules ONE drain at that delay: unref'd so it can never hold the process open,
> best-effort because the event triggers remain the guarantee, and **deliberately not rescheduling on
> failure — a timer that retries itself on failure is a self-inflicted flood, which is what the
> limiter exists to stop.** The value is validated before it becomes a timer argument (the relay is
> another party's software): zero, negative, NaN and strings are dropped, and **zero especially**,
> because it would re-park instantly into the limit that just refused.
> **Gate: daemon 281 files / 2931 tests / exit 0; typecheck 0.**
> **⚠️ SUSPECTED RISK, recorded BEFORE the verdict so it is not a post-hoc excuse:** the timer calls
> `flushAwaitingContent()`, which drains **ALL** awaiting sessions, not only the refused one. If a
> burst of N messages is refused, that is N timers each draining everything — **a self-inflicted
> thundering herd against the very limiter that refused them.** Put to the reviewer as the blocking
> question. If it amplifies, I have shipped a flood inside the fix for a flood.

---

### ✅ park deposit rate limiting — RELAY HALF DONE 2026-08-24 (CELLO_Support), REVIEWED, blocking findings fixed
> **THE GAP I PREDICTED WAS REAL AND WORSE — BOTH HALVES OF THE WIRING WERE UNPINNED.** Deleting the
> refusal block left all 260 tests green, and so did reverting the handler registration to one
> parameter — **the expensive one**, because the limiter then checks an undefined peer id, takes the
> deliberate allow-through branch, and becomes a **total no-op** with the gate reporting green. A
> unit a one-word edit silently disables is *accompanied* by tests, not protected by them.
> **Closed by a test that drives a real in-process libp2p peer against a real relay node over the
> wire. BOTH reverts redden it, RUN rather than reasoned.** It also pins the property that makes this
> safe to ship at all: a second peer, on its own connection and so its own authenticated identity, is
> unaffected by the first's flood — a global limiter would let one attacker deny parking to every
> honest sender.
> **⚠️ AND MY "CHECKED BEFORE ANY PARSING" CLAIM WAS FALSE**, in the code comment, the commit and
> this document. `#handleStream` has already pulled the whole length-prefixed frame off the wire and
> CBOR-decoded it — **up to 4 MiB** — before the deposit handler is entered, so a flooder still gets
> a full read and decode per refused deposit, and the stream slot to do it in. The check moved above
> the field extraction and the auth work, and the prose now claims only what is true: **the
> extraction and the disk write are saved; the frame read is not.**
> **`retry_after_ms` now goes ON THE WIRE.** The relay computed it, logged it, asserted it in a test
> — and never told the depositor. That mattered because the client retries a deferred park only on
> EVENTS (boot, agent start, drain hook, signaling reconnect), so the one condition that self-clears
> in sixty seconds was waiting on an unrelated reconnect.
> **An unattributed deposit now announces itself.** It is still allowed through deliberately, but
> silence there is a control whose failure looks exactly like success — no rate-limit events and no
> abuse are the same picture.
> **The limit is injectable** via `createRelayNode`, because the one control on the abuse path the
> audit named FIRST should not be the only thing an operator cannot change without a node roll.
> **Verified in my favour, not assumed:** `remotePeerId` is NOT optional in the installed
> `@libp2p/interface`, and both published transport builds pass it — so the allow-through branch is
> not the common path. And a rate-limited deposit is **not lost**: `rate_limited` is not a permanent
> failure, so the content stays queued. This trades a DoS for latency, not data.
> **Gate: relay 28 files / 261 tests / exit 0; typecheck 0.**
> **CARRIED:** the operator-facing English on the client still says the message will retry *"when the
> relay link is back"* — written for an outage, wrong for a healthy relay that is deliberately
> throttling. Wording fix in `cello-client`, not this repo.
> **What shipped:** a per-peer fixed-window limiter (30/minute) on the content-park deposit path,
> checked **before** any parsing or store call — a limiter that runs after validation and a disk
> write has already spent the work it exists to save. On refusal: `content.park.rate_limited` with
> the attempt count and a retry-after, and `{ok:false, reason:"rate_limited"}` to the depositor.
> **It keys on the id that was being thrown away.** `CelloStreamHandler` has always passed a
> Noise-authenticated `remotePeerId`; `content-park.ts` registered `(stream) => …` and dropped it.
> **That discard is exactly what made me write — in code AND in this document — that a deposit
> "carries no depositor identity to key a quota on."** It was false, and the datum was one parameter
> away.
> **A BOUND IS NOT A LIMIT, which is why this exists next to the store caps.** The caps decide how
> much can be STORED. Without a limiter an attacker still spends the relay's CPU, stream slots and
> disk writes at line rate, and still churns a victim's mailbox against the per-recipient cap
> indefinitely.
> **Honest about what it buys, in the code and here:** a peer id is a real cryptographic identity for
> the connection and is **cheap to rotate**, so this defeats the ordinary abusive case and raises the
> cost of the determined one. **A speed bump, not a gate.**
> **Three properties pinned because each is how this class of control goes wrong:** one peer's flood
> must not refuse another (a global limiter turns an abuse control into the outage it prevents — the
> shape the store's first bound got wrong); the window must reset, or it is a ban list; and the
> limiter must not itself leak on attacker-chosen keys — **the exact defect found in the park store
> one commit earlier**, which would otherwise have been reintroduced inside its own fix.
> **Gate: relay 28 files / 260 tests / exit 0; typecheck 0.**
> **⚠️ SUSPECTED GAP, recorded BEFORE the verdict so it is not a post-hoc excuse:** the six tests
> drive the limiter CLASS. I do not believe anything drives the handler, so deleting the
> `if (!limit.allowed)` block in `content-park.ts` probably reddens nothing — **the wiring is
> unpinned, which is the hollow-test shape I have shipped twice tonight.** Put to the reviewer
> explicitly rather than discovered by it.

---

### `DOD-M15-STEP6-REPLAY-1` — 🟡 A directory identity proof cannot be replayed (replay bullet ✅; byte-match fail-open OPEN)
> **TAG CORRECTED 2026-08-24 (CELLO_Support): the heading said ❌ while this entry's own second
> paragraph said "the line stays 🟡".** A line whose header and body disagree is worse than either
> answer — the header is what a status sweep counts and the body is what a reader believes, so the
> line was simultaneously in and out of the amber count. ❌ is also flatly wrong: the replay bullet is
> closed, mutation-proven, and shipped.
> **THE REPLAY IS CLOSED 2026-08-24 (CELLO_Support).** 17 passed, mutation-proven: disabling the gate
> reddens exactly the replay, future-dated and unparseable tests. The line stays 🟡 because its
> SECOND bullet — the byte-match fail-open — is untouched, and its third is `BOOTSTRAP-AUTH-1`.
>
> **The finding that shaped the fix: the nonce CANNOT carry the freshness.** The obvious answer is
> "check the nonce is the one we sent" — **we did not send it.** It is `challengeFrame["nonce"]`, the
> DIRECTORY's own, from step 1-2. **The client contributes no fresh value to this exchange at all**,
> so it holds nothing of its own to bind against, and a replayer replays the captured nonce and the
> captured ack together. That leaves the timestamp, and it is a real anchor: inside the signed bytes,
> so it cannot be moved without invalidating the signature being replayed.
> **Checked AFTER the signature, deliberately** — a stale proof is genuine and too old, a forged one
> is an attack; collapsing them into `signature_invalid` would send an operator hunting a forgery
> when their clock is wrong. `identity_proof_stale` now only ever describes the first.
> **±5 min, absolute skew, unparseable = stale.** One-sided skew would leave a signed FUTURE
> timestamp permanently valid — a better replay token than a stale one. Unparseable is the NaN lesson
> from the manifest gate applied *before* it repeated: every comparison against NaN is false, so a
> naive `skew > MAX` treats garbage as fresh.
> **STATED, NOT FIXED:** this BOUNDS replay to the window rather than eliminating it. With no
> client-chosen nonce nothing makes a proof single-use; closing the rest needs a client contribution
> in the challenge or a seen-nonce cache — a wire or state change, and not this line.
>
> **⚠️ The second bullet is NOT "silent" any more, and that half should not be re-fixed.**
> `daemon.manifest.bundled.skipped` fires at WARN when the verifier is not wired (INFO on local), and
> `cello_status` states the posture in both directions (`directory_authentication: "enforced"`,
> confirmed live). **What remains is the byte-match itself** — a DNS name pointing at the same
> machine does not match a bundled endpoint, so auth is skipped. That is an endpoint-identity change
> and **not to be attempted during a fleet roll**; `CELLO_Coder_1` is deploying directory and relay
> as this is written.
Found by `DOD-M15-DIRAUTH-1`'s review (F9), pre-existing.
- Step 6's TBS covers `nodeId ‖ agent pubkey ‖ nonce ‖ timestamp`. The client checks **neither** the
  timestamp against now **nor** that the nonce is one it has not seen.
- Any party that once obtains a valid tuple for a given agent pubkey can replay it indefinitely.
- Requires prior compromise (the signaling stream is Noise-encrypted), so it is not a pure-network
  MITM — but it bounds how strongly the operator-facing prose about step 6 may be written.

**Scoped by `DOD-M15-SPIKE-1(a)` → Entry 1: the challenge IS running in production** —
`daemon.manifest.bundled` 115 times, `.skipped` zero. This stays hardening and does not escalate.
The byte-match workaround is holding; the fail-open underneath it is not fixed.
- The roster challenge runs **only when the resolved directory URL byte-matches a bundled
  endpoint**. A DNS name pointing at the same machine does not match, and the client then skips
  directory authentication **entirely, silently**. That is why the production directory URL is a raw
  IP: the fail-open is known and was worked around with string matching rather than fixed.
- Resolve the bootstrap coordinate over an authenticated channel; it currently comes from a plaintext
  HTTP endpoint on port 9090.

---

### `DOD-M15-RELAYONLY-1` — ✅ Relay-only routing is an operator setting
> ### ✅ CLOSED 2026-08-24 (CELLO_Support). Two review passes, four blocking findings, all fixed.
> **What an operator gets:** `cello_settings_set transport.relay_only true`, and this agent then
> publishes only its relay-circuit address, dials only the counterparty's, **and turns off NAT
> hole-punching and the identify announce**. A counterparty who does not already hold this node's
> address has no direct route to it — including one who ignores the flag, because there is nothing
> direct to dial and nothing direct advertised.
>
> **GATE, all by exit code:** daemon **280 files / 2918 tests / 0**; transport **14 files / 163 / 0**;
> adapter **21 files / 182 / 0**; typecheck **0**; eslint **0**. 19 unit tests plus 4 on the
> transport flag, **each blocking behaviour proven by a revert test that was RUN.**
>
> **THE LINE'S OWN TRAP WAS AVOIDED AND THEN HIT TWICE ANYWAY, ONE LAYER DOWN EACH TIME.** It warned:
> gate the dial, not the label, or you ship a placebo. I gated the dial — and shipped a placebo
> twice regardless. **Pass 1: publishing nothing is not private, it is MALFORMED** — the directory
> refuses an empty address list, so the operator switched on a privacy control and was told their
> counterparty was offline. **Pass 2: filtering what the DIRECTORY is told does not stop libp2p
> telling them directly** — dcutr hole-punches the circuit into a direct connection, and identify
> hands over the listen set on the first relayed connection. *Each fix was correct about the layer it
> could see.*
>
> **CARRIED, with reasons, since two passes is the cap:** **H5** two setters overwrite
> `#counterpartyAddrs` from an observed `remoteAddr`, so the dial filter can erase itself at runtime;
> **H7** `validateSettingValue` still falls through to away-TEXT for any unrecognised key, so the
> next non-boolean setting inherits away semantics silently; **H9** `advertisedAddress` is a dead
> field carrying the operator's public IP with no consumer, outside the choke point.
>
> **NOT PROVEN LIVE, and stated because it is the honest limit:** no two-process test watches a
> relay-only agent fail to be reached directly. The controls are asserted at their seams — service
> registration, announce configuration, published addresses, dialled addresses — not against a live
> peer. **That belongs to the spine lane, not to a unit test.**
> # 🔒 OWNED BY **CELLO_Support**, CLAIMED 2026-08-24. **CELLO_Coder_1: DO NOT TOUCH THIS LINE.**
> **Andre, 2026-08-24: *"from now on this is yours. You own it. It's yours to complete. It's yours to
> review."*** Both lanes independently produced fixes for the seal line because ownership was assumed
> rather than written down, and that waste is not to be repeated. **The rule now: claim the line HERE
> before writing code, not after.**
> **Files I hold:** `relay-only.ts`, `initiate-session-handler.ts`, `agent-settings-keys.ts`,
> `session-node-manager.ts` (`getStandingReceiverInfo` only), `cello-mcp.ts`
> (`cello_settings_set` description), `__tests__/dod-m15-relayonly-1.test.ts`.
> **Correspondingly: `DOD-M15-SEALWIRE-1` and all remaining seal work belong to `CELLO_Coder_1`.**
> Andre has forbidden me from further seal work; I am not to touch it even to fix something I see.
> ### ✅ PASS 2 RETURNED, ALL FOUR BLOCKING FINDINGS FIXED, 2026-08-24. **Two review passes is the cap; the rest is carried.**
> Pass 2 found a **new blocking defect introduced by pass 1's own fix**, which is the most useful
> thing either pass produced.
> - **H1 — MY FIX FOR THE DISCLOSURE WINDOW WAS DEAD CODE.** I wrote `this.#db !== undefined`; the
>   field is `DaemonDatabase | null` and is **never `undefined` at any point in its lifetime**, so
>   the expression was a compile-time-constant `true`, TypeScript had nothing to object to, and the
>   whole `unknown` branch was unreachable. In the exact window it was written for — shutting down,
>   `#db` null, receiver still alive — it returned `off` and published the operator's real addresses.
>   **The DoD recorded that window as closed. It was wide open.** Now `!== null`, and pinned by a
>   test that asserts the SENTINEL, because the pure-function test passed the boolean in literally
>   and could never have caught a call-site bug.
> - **H2 — dcutr and identify defeat the control at runtime.** Filtering what the DIRECTORY is told
>   does not stop libp2p speaking peer-to-peer. `createNode` now takes `holePunch: { enabled }`, and
>   every node is built through `#createAgentNode` so a **sixth** call site inherits the posture
>   rather than leaking. Guard test fails on any raw factory call.
> - **H3 — `relayOnlyReachable` had ZERO production callers.** No consumer, no ship — while the path
>   it guards is common: whenever a relay refuses a reservation the fallback receiver has no circuit
>   address, so relay-only reproduced F1's empty publish exactly. Both publish sites now refuse with
>   `relay_only_no_reservation`.
> - **H4 — THE FILTER WAS DEFEATABLE BY THE COUNTERPARTY.** `addr.includes("/p2p-circuit")` is a
>   substring test on strings **the peer controls** — the directory copies them verbatim and the
>   FROST signature attests the quorum agreed, **not that the contents are circuits**. So
>   `/dns4/p2p-circuit.attacker.example/…` was dialled directly, handing over the IP with relay-only
>   ON while the log reported `suppressed: 0`. Exact-segment match now.
> - **H6** the dial half still used the boolean (closed DB ⇒ dialled direct); **H8** the log text
>   contradicted the code and the branch duplicated the filter; **H10** the wording omitted the limit
>   an operator meets first — that with no reservation this makes them **unreachable**.
>
> **TWO REGRESSIONS I CAUSED, both caught by the full package run rather than by the unit's tests.**
> The ceremony guard refused an empty address list **unconditionally**, breaking a pre-existing
> accept path — *a privacy control that changes behaviour when it is switched OFF is its own defect.*
> And `#createAgentNode` was `async`, which added **one extra microtask hop** before the receiver was
> installed — enough for `createSessionNode` to answer `standing_receiver_unavailable`. **Bisected
> rather than guessed:** a pure passthrough still failed, which ruled out the settings read and
> pointed at the rewiring. That install path is genuinely tick-sensitive and it is now written down
> at the wrapper.
>
> **GATE: daemon 280 files / 2918 tests / exit 0; transport 14 files / 162 tests / exit 0; typecheck
> 0; eslint 0.** 19 tests on the unit, plus 3 on the hole-punch flag, **each with its revert test RUN.**
>
> **CARRIED, not fixed — two passes is the cap (§ONE review pass):** **H5** two setters overwrite
> `#counterpartyAddrs` from an observed `remoteAddr`, so the filter can erase itself at runtime;
> **H7** `validateSettingValue` still falls through to away-TEXT for any unrecognised key, so the
> NEXT non-boolean key inherits away semantics silently; **H9** `advertisedAddress` is a dead field
> carrying the operator's public IP with no consumer, outside the choke point; and **identify's
> announce filter**, the other half of H2 — without it a peer still learns our listen addresses on
> the first relayed connection. **That last one is the honest limit on this line: the hole-punch is
> closed, identify is not.**
>
> ### Pass 1 fixes, kept for the record — **the fix is one idea: CIRCUIT-ONLY, not nothing.**
> A `/p2p-circuit` multiaddr names the **RELAY** and our peer id, and terminates at the relay. So it
> discloses nothing about the operator, it satisfies both directory guards, and it is what §7's
> mitigation actually meant. Relay-only now **publishes** only the circuit subset and **dials** only
> the counterparty's circuit — their direct address is dropped, because dialling it is what hands
> them our IP.
> - **F1/F2 fixed** — publish and dial circuit-only. `relayOnlyReachable()` distinguishes "no relay
>   reservation yet" from "suppressed", so an empty set is a knowable state rather than a malformed
>   frame.
> - **F7/F8 fixed** — `relayOnlyState()` is a TRI-STATE. `getSetting` answers `null` both for *unset*
>   and for *no database*, and reading the second as OFF **failed toward disclosure**: the standing
>   receiver outlives the DB during shutdown. `unknown` now publishes circuit-only, and a THROW (a
>   retired agent, on a catch-less ceremony path) is absorbed as `unknown` rather than becoming an
>   unhandled rejection that makes the offer vanish.
> - **F6 fixed** — the operator-facing wording claimed a counterparty *"never learns"* the address.
>   False for one who kept it from an earlier session. Now states three limits: no revocation of a
>   prior disclosure, new sessions only, and no hiding from the relay or directory.
> - **THE HOLLOW-TEST FINDING FIXED, and this is the one that mattered:** the dial half previously
>   survived nothing — reverting the gate left all ten tests green. Three tests now drive the real
>   handler through `openSessionAs` and read what `connectToCounterparty` actually received.
>   **Mutation RUN: restoring the old gate reddens 2 of the 3.**
> - **Gate: 15 tests, typecheck 0, eslint 0.**
> - **NOT fixed, carried to pass 2 for a verdict:** F3 (no-reservation refusal is written but not
>   wired), F4 (the re-dial path bypasses the control, so this governs new sessions only —
>   documented in the tool text rather than fixed), **F5 (dcutr — now that circuit connections
>   actually form, does the standing receiver hole-punch to a direct connection and defeat the whole
>   control at runtime while every test passes? My top worry)**, F9 (dead `advertisedAddress`).
>
> ### 🔴 F5 CONFIRMED BY READING, 2026-08-24 — **the control is defeated at runtime unless this lands**
> `core/transport/src/node.ts` adds **`dcutr: dcutr()` unconditionally** — not gated on `nodeType`,
> so a session node gets it — and its own comment states the mechanism: *"the standing receiver is
> the inbound side of a relayed connection, **and the inbound side starts the upgrade**."*
> **So a relay-only agent forms the circuit correctly and then HOLE-PUNCHES ITS WAY TO A DIRECT
> CONNECTION, disclosing the address the setting exists to hide — while every test stays green,
> because no test observes a live upgrade.** This is the F1 lesson repeating one layer down: the
> first build failed by publishing too little, and this one fails by connecting too well.
> **Fix path traced, not yet written** (files are under review pass 2 and must not move mid-review):
> `CreateNodeOptions` gains `holePunch?: { enabled: boolean }` — matching the existing
> `relayServer?.enabled` / `autonatResponder?.enabled` convention rather than inventing one — the
> session-node factory forwards it, and `SessionNodeManager` sets it from the relay-only state at
> the same place it already resolves the endpoint. `identify`'s listen-addr advertisement needs the
> same treatment: announce the circuit only.
>
> ### ⚠️ PASS 1, 2026-08-24 (CELLO_Support) — **NOT DONE** — review returned TWO BLOCKING findings.
> **The setting as shipped does not make the operator private. It takes them OFF THE NETWORK.** Not
> flipped, not claimed; recorded here so the commits (`0508d5e`, `3b07a92`) cannot be mistaken for a
> working control. **It is inert until switched on** — the default is off — so nothing is live.
>
> **F1 (BLOCKING) — empty addrs are a MALFORMED FRAME to the directory, not a private one.** I
> suppressed by publishing `addrs: []`. The directory refuses exactly that, on both sides:
> `directory-node.ts:2473` rejects a `session_request` whose `initiator_session_addrs.length === 0`
> with `session_request_missing_peer_id`, and `:2488` accepts a `session_offer_accept` only
> `if (… counterparty_session_addrs.length > 0)` — **with no `else`**, so a relay-only responder's
> accept is silently dropped and the offer waiter never resolves.
> **What the operator lives through:** they switch the privacy control on; their next initiate fails
> with *"Ensure the counterparty is registered and online"* — the counterparty is fine — and every
> session anyone opens *with* them dies too, telling the other side their agent is offline. Nothing
> anywhere says "relay-only". **That is ERROR SUBSTITUTION reachable by flipping a switch**, and it
> is the reviewer brief's own worked example reproduced exactly.
>
> **F2 (BLOCKING) — the dial gate refuses the relay route it claims to force everything onto.**
> `shouldDialCounterparty` returns false for EVERY address, but `connectToCounterparty` exists
> specifically to dial a `/p2p-circuit` address through its relay, and that circuit addr rides the
> FROST-signed assignment. Dialing a circuit addr discloses nothing — **it terminates at the relay.**
>
> **THE CORRECT SHAPE, and it is one idea, not two:** publish and dial the **circuit-only subset**
> (`addrs.filter(a => a.includes("/p2p-circuit"))`) rather than nothing. A circuit multiaddr names the
> RELAY's address and our peer id; it discloses nothing about the operator, it satisfies both
> directory guards, and it is what §7's mitigation actually means. A genuinely empty set (no
> reservation yet) becomes a **loud local refusal** — `relay_only_no_reservation` — never an empty
> publish and never a silent accept.
>
> **AND MY OWN TEST HEADER ASSERTED THE PROPERTY THE CODE LACKS**, which is this repo's signature
> failure mode: *"the peer id is KEPT… stripping it would break relay routing."* Keeping the peer id
> does **not** give the counterparty a circuit address, because in this codebase the circuit address
> travels in the very field I emptied.
>
> **Also found, not blocking:** F4 the re-dial path (`:8444`) bypasses the control entirely, so the
> setting silently governs only sessions opened after it; F5 the fix will leak via **dcutr** unless
> relay-only also disables the hole-punch the standing receiver initiates, and suppresses identify's
> listen-addr advertisement; F6 my `cello_settings_set` wording says a counterparty *never* learns the
> address — false for one who kept it from an earlier session, and it does not revoke a prior
> disclosure; F7 a closed DB makes `getSetting` return null so the control reads OFF **toward
> disclosure** (needs tri-state: unknown ⇒ refuse to publish); F8 the choke point can now THROW for a
> retired agent, on a ceremony path with no catch; F9 a dead `advertisedAddress` field carries the
> operator's public IP with no consumer, outside the choke point.
>
> **Test teeth, verbatim:** the settings-validation tests **survive the revert test** and pin a real
> trap. **The dial half does not** — revert the gate and all 10 stay green. The responder path and
> the directory's guard are untested, and no test would have caught F1 because none asks what the
> directory does with the frame.
The feature half of the IP disclosure. A direct session reveals the operator's IP permanently, and
[[2026-06-11_1030_daemon-transport-architecture]] §7 already offers relay routing as the mitigation —
as a footnote. Promote it to a real setting, so the disclosure in `DOD-M15-DISCLOSE-1` is actionable
rather than a warning.

> ### ⚠️ SCOPED 2026-08-24 — GATE THE DIAL, NOT THE LABEL, or you ship a placebo
> **`transport_mode` DOES NOT CONTROL WHETHER A DIRECT CONNECTION HAPPENS.** A setting that sets it
> would be a privacy control that does not protect privacy — the same shape as a tier that grants
> nothing and a content profile no verb consults, both found earlier in this milestone.
>
> - **The directory already defaults to relay.** `directory-node.ts`: `const transportMode =
>   requestedTransportMode ?? "relay"`. So the label is *already* relay in the ordinary case.
> - **And the client dials directly anyway.** `initiate-session-handler.ts` says it outright:
>   *"attempt the dial whenever the assignment carries counterparty session addrs, **regardless of
>   the transport_mode LABEL** (the local selector stub labels everything 'relay' even when the addrs
>   are directly dialable)"*. The dial is gated on **`counterparty_session_addrs.length > 0`**, not
>   on the mode.
> - **So the IP is exposed on a path whose label already says "relay".** An operator who set a
>   relay-only flag today would be told they were protected, and would not be.
>
> **The unit is therefore:** the setting must suppress the direct dial — either by refusing to dial
> `counterparty_session_addrs` when relay-only is on, or by not publishing this agent's session addrs
> into the assignment at all (stronger: nothing to dial, and it protects the operator even against a
> peer who ignores the flag). **The second is the one worth building** — a privacy control that
> depends on the counterparty honouring it is not a control.
> **Sized, not built.** Recorded so the next lane does not implement the label.

---

---

### `DOD-M15-SAMEOP-FALSEPOS-1` — ✅ RESOLVED: NOT a defect. The journey updates a superseded column.
> **CLOSED 2026-08-24 with the mechanism named, after I reported it wrong twice and "confirmed" it
> once.** The flag is CORRECT. `j-end` HOP 9 is a stale fixture, and its own linkage assertion is
> stale in the SAME direction, which is exactly why it read as convincing evidence.
>
> **The mechanism:** the directory's `/internal/agent-by-pubkey` resolves an agent's account from the
> **replicated `agent_account_links` table**, joined on the stable `agent_id` — under a comment
> saying so explicitly and citing `CELLO-REPL-001`, the change that moved the reader off
> `agent_profiles.account_id`.
>
> **The journey writes `agent_profiles.account_id`** — the superseded column — and then asserts
> `count(DISTINCT account_id)` **against that same superseded column**. So its check passes, the
> resolver still sees Bob sharing Alice's account, and `same_operator: true` is the RIGHT answer.
> A stale fixture whose self-check is stale the same way cannot detect its own staleness.
>
> **What this cost, recorded because the sequence is the lesson:** I read "no unflagged endorsement"
> as "a stranger is flagged" (underdetermined — `CELLO_Coder_1` caught it), then called it
> **confirmed** after adding `issuer_pubkey` (better evidence, still the wrong conclusion), and only
> reached the truth by asking *which fields does the reader actually read* rather than *is the
> predicate correct*. Three layers had been "ruled out by reading" and all three rule-outs were
> right — the reader simply was not among them.
> **The general form: I kept auditing the CONSUMER and never asked where its INPUT came from.**
>
> **What it produced anyway, both worth keeping:** `issuer_pubkey` now appears in the wallet listing
> (a real gap — you could see who a signal was ABOUT and never who SAID it), and `j-end` now asserts
> about **Bob by pubkey** instead of "any endorsement", so the two readings can never be confused
> again.
>
> **The FIXTURE FIX is owed** and it is one line: update `agent_account_links`, not
> `agent_profiles.account_id` — and assert linkage against the table the resolver reads. **Related
> and still open: `DOD-M15-SAMEOP-1`** names this exact reader-moved-to-replicated-table problem, so
> this journey is evidence FOR that line rather than a separate finding.


---

### `DOD-M15-RELAYLEAK-1` — ✅ Relay clients are closed
> _(trail moved to [[M15-BUILD-JOURNAL]] — see “DoD trails, moved 2026-08-24”.)_
Graceful shutdown never closes relay clients, and the seal-only detached-transport path registers a
session that is never unregistered, so a cached relay client is never closed for the process
lifetime. Client-side, small, standalone.

> ### ✅ CLOSED 2026-08-24 — pass 2 verdict: **SPEC: FAITHFUL**. Three revert proofs run on the shipped tree.
> **Pass 2 killed my stated reason for the MEDIUM-5 fix and gave me the real one**, which is the most
> useful thing either pass produced. I justified the claim guard by a concurrency race — two seal
> callers, the second closing the client the first is awaiting. **That race is unreachable:**
> `#resolveSealTransport` and everything above the first `await` are synchronous, and a second caller
> hits `#responderSealSubmitted` and returns `responder_seal_already_submitted` before reaching
> `submitLeaf`. The guard is still right, for a reason I had not written down: `registerSession`
> replaces `onLeafDeliver` with `onLeafDeliver ?? (() => {})` and — unlike `assignment` and
> `recorded` — does **not** carry the existing handler forward, and this path passes none. So a
> detached seal over a live registration **swaps that session's inbound leaf delivery for a no-op**:
> the counterparty's messages arrive at the relay client and are dropped, and the operator sees a
> session that has simply gone quiet. **A comment naming an unreachable reason invites the next reader
> to delete the guard as clutter** — corrected in place.
>
> **Also fixed from pass 2:** the passenger branch declined to release in silence (now
> `session.seal.transport.registration_shared`, because the states that reach it are all orphans);
> the revive teardown matched its entry by KEY, and two revivals can both reach the map set, so it
> now matches by node identity; and the fake was cast with `as unknown as`, which erased every
> structural check and is exactly how a fake with no `submitLeaf` reached runtime — now `Pick`-typed
> with one narrow cast at the injection point.
>
> **🔴 AND A REVERT-TEST MUTATION OF MINE REACHED `main`.** While `session-node-manager.ts` was
> mutated for a proof, the other lane committed that file as part of unrelated work and swept the
> mutation in. For several commits `gracefulShutdown`'s close loop read `void key; void client;` —
> **this line's own defect, live in the tree that fixes it.** Found because my test went red for the
> wrong reason. **Both lanes commit by explicit path, which is correct and did nothing here:**
> explicit paths do not separate two agents editing one file. **The rule: never leave a mutation on
> disk across a turn boundary — apply, run, restore in one uninterrupted step, and if the shared
> runner is busy, do not mutate at all until the slot is free.** I was blocked mid-mutation four
> times that night; every one was a window for this.
>
> ### ⚠️ AND FOR A WHILE BOTH TESTS WERE PASSING ON A THROW — the finding that has no other home
> After the release fix, the fake relay client had no `submitLeaf`. So the submit threw a
> `TypeError`, and because the `finally` runs on the throw path too, the release still happened and
> every leak assertion still held. **Both tests were green against an exception, and the normal path
> — a submit that COMPLETES — had never been exercised at all.**
> Nothing would have said so: a test that passes on a throw is indistinguishable, from the summary,
> from one that passes on the real path. What caught it was an assertion added for pedantry — a
> no-throw check replacing a bare `.catch(() => undefined)`, which had been swallowing the TypeError
> whole. The fake now completes a submit and `submitCount() > 0` is a precondition, so a regression
> back to the throw path reddens instead of passing quietly.
> **Twice in this one unit an assertion added "just to be careful" caught a real hole, and both were
> the same shape: an error firing BEFORE the code under test runs, with the test satisfied anyway.**
>
> **Revert proofs, run one at a time on the shipped tree:** remove the shutdown close loop → only the
> shutdown test reddens; remove `releaseDetached()` from the `finally` → only the release test;
> drop the claim guard → only the passenger test. **CARRIED:** MEDIUM-4's revive-teardown detach has
> no test, and the shutdown test has no `submitCount` precondition.


---

### `DOD-M15-RELAYADMIN-1` — ✅ The directory-admin push handler is KEPT, and the keeping is justified
> ### 🔴 THE PREMISE WAS FALSE, AND THE LINE INSTRUCTED A DELETION THAT WOULD HAVE BROKEN EVERY SESSION.
> **Measured 2026-08-24 (CELLO_Support) before touching anything, because this line proposed a
> DELETION and that is the one change whose failure mode is silent removal of something live.**
>
> **"It is live, has no caller" — the second half is wrong.** Its caller is the **production
> directory binary**: `NetworkRelayAdapter` is constructed at `bin/directory.ts:814`, passed to the
> node as `relay: networkRelay` (`:1195`), and connected with `await networkRelay.connect(...)`
> (`:1363`). It sends exactly the four frames this line names — `record_assignment`,
> `discard_session`, `confirm_seal`, `reject_seal` — which **are the relay-side session lifecycle**.
> Deleting the handler would leave every brokered session unrecorded at the relay, unable to be
> discarded, confirmed or refused. **Not abandoned work. Load-bearing work with one caller.**
>
> **How the "no caller" reading survived:** the only greps that find a sender find it in
> `packages/directory/`, and this line lives in the relay's section next to relay bullets. It reads
> as a relay-local orphan and it is one half of a cross-package protocol.
>
> **✅ DISPOSITION — KEPT, and this is the written justification the line demands.** The bar said
> *"deleted, or its keeping is justified"*, and keeping is now the only correct answer: it is the
> directory's sole channel for driving a session's relay-side lifecycle.
>
> ### ⚠️ WHAT IS STILL TRUE, AND MATTERS MORE NOW THAT THE PATH IS LIVE
> **Three of the four frames sign no freshness.** `record_assignment` signs
> `CBOR([session_id, participant_a, participant_b, session_timestamp])`. The other three sign only
> `{ type, session_id }` — **no nonce, no timestamp**. And the handler authenticates the **BODY
> SIGNATURE, not the dialer**: it verifies `directory_signature` against `#directoryPubkey` and never
> looks at the remote peer id.
> **So a captured `discard_session`, `confirm_seal` or `reject_seal` frame is replayable forever,
> from any peer, against the session it names.** The relay is publicly dialable
> (`DOD-M15-DDOS-1`), so the attacker needs only the bytes, not the position.
> **Bounded honestly:** obtaining those bytes requires having been on a Noise-encrypted
> directory↔relay stream, i.e. prior compromise — the same bound `DOD-M15-STEP6-REPLAY-1` records
> for step 6, and that line still chose to close its window rather than argue the bound away.
> **What the operator would live through:** a conversation whose relay-side record is discarded out
> from under it, or a seal refused, with the relay's own logs showing a correctly-signed directory
> instruction.
>
> **NOT taken in this unit, and the reason is the size, not the appetite:** adding a nonce or
> timestamp to those three bodies is a **bilateral wire change across both repos** — the directory
> signs it and the relay must verify it — and it must ship receiver-first or every admin frame from
> an un-upgraded directory is refused. That is not quick win #4; it is a wire unit.
> **→ carried as `DOD-M15-RELAYADMIN-REPLAY-1`.**
- **⚠️ QUICK WIN #4 DOES NOT EXIST AS DESCRIBED.** The cheap, safe action here was to check the
  premise and correct the record before someone deleted live code on it. That is done; what remains
  is a wire change, and it is sized as one.
- **Related, and it should be answered by the same person:** `DOD-M15-RELAYADMIN-KEYSET-1` asks
  whether this stream verifies against only the PRIMARY directory key. **It does** —
  `relay-node.ts:271-273` says so outright: *"the relay accepts an assignment signed by ANY of these…
  The directory-ADMIN frame path still authenticates against the single `directoryPubkey` only."*
  So a session brokered by directory 1 or 2 cannot be driven through this stream by the node that
  brokered it. That is the redundancy invariant inverted, and it is now evidenced rather than asked.

---

### `DOD-M15-RELAYAUTH-1` — ✅ No relay service without a directory-issued assignment
**Closed 2026-09-01** by `micro/002-RELAY-requires-an-assignment.md`, with its third work item
completed by `micro/008-RELAY-reservation-slot-flooding.md`. → Entry S15.

**Depended on `DOD-M15-ASSIGN-1`** — the client must be presenting a verified assignment before the
relay can require one. Decision 3(b): the relay **verifies a credential the caller presents** and
learns nothing itself; it does not query the directory. This preserves extractability — a private
enterprise relay stays a signature-verifier rather than becoming a directory client. **008's
directory-issued token respects 3(b)**: it is a signed credential the caller presents, so the relay
still never becomes a directory client.

**The three work items, and where each landed:**

1. ✅ **Relay service requires an assignment naming the caller as a participant** — including
   collecting parked content, where the original session's assignment is the credential the caller
   already holds. (002)
2. ✅ **The relay verifies that an authenticating key is a registered agent**, rather than accepting
   any Ed25519 keypair. **Not done in 002 and explicitly not counted as done there** — it moved to
   008, which solves it with a directory-issued token bound to the agent's public key rather than
   with a session assignment, because an assignment only exists *after* a session and a brand-new
   agent has none at the moment it first needs one.
3. ✅ **A connection gater on the relay, including the reservation-dial hook.** Reservations were
   granted to any peer up to 4096 and the hook restricting who may dial *through* to a reservation
   holder was never installed, so an agent's circuit address was dialable by anyone who learned it.
   This is the relay-side twin of the receiver gate; without it that gate closed the direct route
   while the circuit route stayed open. (002)

**The liveness query is scoped.** It had no participant check and no session check — it carried a
session id the handler never looked at and answered from a **global** map, so anyone with a list of
pubkeys could build a live map of who was active and when. It now requires the caller to be a named
participant and answers only for that session, collapsing no-session / not-a-participant /
wrong-subject into one anti-enumeration reply.

**Enforcer:** stranger, on the circuit path as well as the direct one.

#### Review — TWO passes, and pass 2 refused the merge

Pass 1 (Opus): three HIGH, all fixed and revert-tested before pass 2 — the replacement standing
receiver stole the live session's delivery stream; the assignment was presented only to the
directory-picked witness relay rather than the relay that actually gates the dial; a content-park
pull refusal was flattened at the client. **Pass 2 then found the identical third defect still
standing on the CONFIRM path in the same file.**

> *"**Merge recommendation: do not merge as-is.** H1 and T1 are blocking; H2 is blocking unless Andre
> rules the post-restart mailbox gap acceptable for launch … this diff touches persistence,
> crypto-adjacent auth, notification/queue and registration-shaped state, and I did **not** come out
> clean — the two findings I would most expect to have missed (a gate that denies the legitimate
> case, and a durable store gated on volatile state) are both here and both real."*
> — `cello-unit-reviewer` (Opus, 2026-08-31)

- **H1 — the gate denied the LEGITIMATE first dial, on a race the code usually loses.** Both parties
  get the assignment independently. A dials B's circuit address after ~2 RTT; B presents the
  assignment to its own reservation relay — unawaited — after ~3–4 RTT. A arrived first more often
  than not and the relay answered `PERMISSION_DENIED`. For every session where B is NAT'd and B's
  reservation relay ≠ the witness relay (**the diff's own comment calls that "the ordinary case, not
  a corner"**), the relayed link never formed — while `cello_initiate_session` still returned
  `{ok:true, transportMode:"relay"}` and every message for the life of that conversation silently
  fell to the park backstop. Fixed by having the dialler present the same assignment to B's
  reservation relay and **await** it before dialling; it is a named participant and the assignment is
  self-authenticating, so presenting it more widely grants nothing and the ordering becomes local to
  one thread.
- **H2 — parked mail became uncollectable after any relay restart.** The pull/confirm gate was
  enforced against an in-process, never-persisted vouched set while the content store is durable.
  Roll the relay and the recipient was *notified* mail was waiting, then refused `not_a_participant`
  on the pull.
- **T1 — the HIGH-1 fix had NO relay-side test.** Deleting the whole dispatch block left the entire
  relay suite green; the client-side assertion ran against a fake relay defined in the test file.

**Lesson that generalises.** Both of pass 2's blocking findings are the same shape: a **gate that
refuses the legitimate case** rather than one that admits the illegitimate one. This unit's own trap
list opened with *"refusing too eagerly is the failure mode here"* and the unit did it anyway.
`connection.remotePeer` is Noise-authenticated so the source peer id cannot be spoofed; the hooks
were checked against the installed `@libp2p/circuit-relay-v2@4.2.3`; `purpose` is additive and
outside every signed TBS, so bilateral order held.

**Left standing, and carried:** a bare authenticated keypair still occupies a standing-receiver slot
(resource occupancy, not access — it cannot be dialled through to, cannot pull parked content and
cannot submit to any session); the vouched-pubkey set is never pruned (deliberate and not
attacker-inflatable, but unbounded over a relay's lifetime, unlike every other map in the relay);
and `denyInboundRelayedConnection` — the reservation-holder's own side — is still uninstalled,
defense-in-depth that belongs with the daemon's gater rather than the relay's.
