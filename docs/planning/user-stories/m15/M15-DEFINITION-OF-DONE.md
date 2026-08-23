---
name: M15 Definition of Done
type: definition-of-done
date: 2026-08-21
milestone: M15
status: open
topics: [m15, hardening, pre-launch, security, injection, relay, transport, seal, encryption, claims, definition-of-done]
description: >
  The yardstick and sole status authority for M15 (pre-launch hardening). Tiers encode DEPENDENCY
  ORDER ONLY — the gate is a state, not a date, and every line here is inside it. Flip tags in
  place with one line of evidence and a journal pointer. Read M15-PROCEDURE first.
---

# M15 Definition of Done

**Read [[M15-PROCEDURE]] first.** This document is the scoreboard; the procedure is how to work it.
Evidence, proofs, reviewer verdicts and run output live in [[M15-BUILD-JOURNAL]], never here.

## How to read this

**Tags:** ❌ not started · 🟡 implemented, not yet reviewed · ✅ done (written AND reviewed, with the
reviewer's verdict quoted in the journal) · 🅿️ parked with a trigger.

**A tier is a dependency boundary, not a priority.** The gate is a **state** — every line below is
inside it, launch waits for all of them, and nothing is descoped for time (M15-PROCEDURE §0z). If a
line turns out bigger than expected it takes longer; that is the correct outcome, not a trigger to
argue scope.

**A line's clauses are expanded at pull time**, not here — the coder writes the full clause checklist
into the journal before implementing (M15-PROCEDURE §2 step 2), and that checklist is what the
reviewer receives. What is written below is the target and the clauses that are load-bearing enough
that losing one would silently change the meaning of the line.

**Lines that name an enforcer are ✅ only when that enforcer ran as separate OS processes**, with the
run output quoted. Vitest green is necessary, never sufficient.

---

# Tier 0 — The verification spike (blocks scoping, not building)

Three questions that **cannot be answered by reading source**. Their answers change the scope of
other lines, so they run before anything else is scoped. Hours, no code.

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

# Tier 1 — Claims (no dependencies; starts immediately)

Everything already readable by someone outside — the public repo, the shipped package, the product's
own output. The unpublished investor and GTM material is **not** in this tier (M15-PROCEDURE §0a.1).

### `DOD-M15-LEDGER-1` — 🅿️ Every live claim is in the ledger with a disposition
> **Two of nine surfaces done AND reviewed (→ Entry S2).** Nine findings, five blocking, all fixed.
> README 19→2, `registry.ts` 37→4. A row now carries the verbatim text it accounts for and the
> count is derived from it — the reviewer had zeroed a whole surface with an invented row past both
> old guards. **Remaining seven surfaces PARKED (Andre, 2026-08-23): trigger — after Tier 4, with
> `AUDITME-1`, as the last Tier 1 work.** Includes `adapter-claude-code/SKILL.md:170`'s *"both sides
> agree on"*, which contradicts `implies_assent: false` and is an ungated deletion when unparked.
Build the claims ledger (M15-PROCEDURE §1d) as a section of this document. One row per claim: its
current text, where it appears, and its disposition — **made true**, **withdrawn**, or **disclosed as
a bounded property**.
- Sweep all four live surfaces: the public `cello-client` repo (root docs, README, comments), the
  shipped npm package (tool descriptions, skill prose, CLI help), product status/CLI output, and
  shipped client documentation.
- **Partially true is false.** A row whose claim survives only with a qualifier gets rewritten or
  withdrawn, never softened.
- A claim with no row is an unaudited claim; the line is not ✅ while a surface is unswept.

### `DOD-M15-AUDITME-1` — 🅿️ `AUDIT-ME.md` survives the audit it invites
**Trigger: the last Tier 1 line to be worked, and not before Tier 4 lands** (Andre, 2026-08-22).
Parked for sequencing only — it is inside the gate and launch still waits for it. The reasoning: the
repo is public but **unadvertised**, so the exposure is theoretical, and the document's job is to
describe what the system finally does. Written now it describes a tree that Tier 2 and Tier 4 are
about to change underneath it, and every such change is a second rewrite. **Its claims are corrected
by the lines around it either way** — the false encryption detail is a ledger row with a disposition,
and the stale file paths are a mechanical fix. What waits is the document that presents them.
- **Do not let this park hide a claim.** `DOD-M15-CLAIM-SCANNER-1` enumerates surfaces from the
  system, and root `*.md` of the public repo is one of them. Every claim in this file must already
  sit in the ledger with a disposition of *pending rewrite → `DOD-M15-AUDITME-1`* before the scanner
  ships, or the scanner fails the build on a file we deliberately parked.

Rewrite `AUDIT-ME.md` at the root of the **public** `Mygentic-AI/cello-client` repo.
- Four of its seven cited file paths no longer exist (pre-repo-split layout) — every path resolves,
  verified by opening it.
- Its encryption claim's supporting detail is wrong: it says content is additionally encrypted at
  the application layer, **true only for parked content**, and cites the database backup file as
  evidence. Corrected to what the tree does, per Part 13 of the relay audit.
- States the relay's **metadata** visibility (who talks to whom, when, how often, sizes) beside the
  true claim that the relay cannot read content — so it is disclosed, not exposed by a follow-up.
- **The claims in it are true; the document proved them badly.** The rewrite proves them.

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

### `DOD-M15-DISCLOSE-1` — ❌ Shipped documentation discloses what the architecture cannot remove
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

# Tier 2 — Make detections act, and close the doors

The checked-then-ignored class and the unauthenticated surfaces. **Runs in parallel with Tier 3** —
different repos, different disciplines, neither blocks the other.

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

### `DOD-M15-DEAD-WIRE-FIELD-1` — 🟡 (client half done; the wire removal is bilateral and carried)
> **CLIENT HALF CLOSED 2026-08-23.** Reviewer verdict: *"**SPEC: FAITHFUL** — for the client half as
> scoped… **HOLLOW TESTS FOUND [blocking]** — question 4 fails: the outcome (`[]`) is unasserted, and
> four mutations stay green."* All findings fixed; the reviewer's green mutations re-run red.
> Gate: 4121 client tests, 2265 relay tests with the database live.
>
> **It also verified the premise independently rather than taking it from me** — no signature covers
> the field (both TBS builders, both repos), nothing reads it (every consumer takes `.pubkey`), and
> it is `[]` on the wire. With one caveat worth keeping: that describes THIS TREE, not the deployed
> fleet — a client older than `SURFACE-1` still announces real addresses.
>
> **F1, and it is the finding of the round: the identical defect sat one line above.**
> `participant.peer_id` met every clause, and was WORSE — the killing value is not a bug's output but
> a DEFAULT the directory writes on purpose (`directory-node.ts:2049` on auth, `:3867` on a map
> miss, `:4120` copies it in), and nothing gates it because the only announce requirement checks the
> INITIATOR, never the TARGET. So an agent whose announce is late could not be talked to at all: a
> valid FROST-signed assignment, refused by both clients over an empty string neither reads. **My
> suite could not tell — deleting the peer_id guard left all five tests green.** Fixed and tested.
>
> **F3:** a tolerated-but-malformed field is now reported (optional callback, no logger dependency in
> a pure shape-validator). ABSENT is deliberately silent — once the wire half lands that is the
> normal case, and a signal that fires on the normal case is not a signal.
>
> **CARRIED, both:**
> - **The wire removal itself** — bilateral, sequenced with `SUBMIT-ID-1`'s 7-element Structure 1 and
>   `TERMINAL-REASON-1`'s reasons so the two repos move once. ⚠️ `directory-frames.ts:1182`'s
>   `parseParticipant` requires both fields and is called from ~110 test sites; loosen it in the SAME
>   commit as the removal or that suite goes red the day the field leaves.
> - **→ `DOD-M15-PARSEFAIL-CAUSE-1` (new):** `assignment_parse_failed` is one exit-point label over
>   ~12 distinct causes. This unit removed two of them, which is why the class is now visible:
>   returning the FIELD that failed instead of `null` would make the next one an afternoon rather
>   than a week. Invariant 3.
 `participant_a/b.multiaddrs` is always empty and read by nobody
Found by the `DOD-M15-SURFACE-1` review. Not a break — it is the reverse of one.
- Since the directory-facing node stopped listening, this wire field is **permanently `[]`** on
  every session assignment. The directory stores it, **signs nothing over it** (neither the session
  nor the relay TBS includes it — verified), and the client parses it and drops it: the only read of
  a parsed assignment's participants takes `.pubkey`.
- **It is also a checked-then-ignored:** the client's parser will reject an entire session assignment
  if this array is malformed — for a value nothing ever reads.
- **Why it is its own line:** removing a wire field is a bilateral change across both repos, and
  under Decision 2's reasoning a schema change is cheapest now. Leaving it costs nothing at runtime
  and costs a reader the assumption that something acts on it.
- Sequence with any other wire change so the two repos move once, not twice.

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

### `DOD-M15-SILENTACK-1` — ❌ A dropped notification acknowledgement is reported, not swallowed
Found by `DOD-M15-CHAINROUNDTRIP-1` review pass 2, **by execution, not by reading** (→ Entry S10).
The same class as that line's F2, in the same file, missed only because the guard's marker is
`void this.#store.` and these are a different object.
- **Ten silent writes:** `void this.#notificationQueue!.acknowledge(...).catch(() => {})` —
  `directory-node.ts` ~2109–2152 and ~6114–6124. **What the user lives through:** a notification
  they have already seen is handed to them again, and again, because the record that they saw it
  never landed and nothing said so.
- **A silent drop three lines inside the block `CHAINROUNDTRIP-1` just fixed:** in the trust-signal
  ACK, `if (!ackAgentId) return;`. An authenticated agent whose pubkey has no `agent_id` row ACKs a
  signal, nothing happens, nothing is logged, and it returns on every pickup for 24 hours. Note
  this is `agent_id` vs `agent_name` territory — see the join-key rule in `.claude/CLAUDE.md`.
- **Enforcer:** widen `CHAINROUNDTRIP-1`'s fire-and-forget guard past `void this.#store.` to every
  `void this.#<field>.` fire-and-forget in the file. The guard's scanners are already correct — it
  is the marker that is narrow. **Re-run the three proven bypasses after widening**; a wider guard
  that stops catching is the worst outcome of the three.

### `DOD-M15-MMRCHAIN-1` — ❌ The whole-suite chain check covers every chain, not a hand-typed list
Found by `DOD-M15-CHAINROUNDTRIP-1` review pass 2 (→ Entry S10). **Not a live break** — measured
read-only against the running database, both tables verify today (16 and 15 rows). It is a live
**blind spot**, and it is the exact shape that cost `CHAINROUNDTRIP-1` three wrong diagnoses.
- `mmr-store.ts` builds `conversation_proof_leaves` and `conversation_proof_mmr_nodes` with the same
  `computeChainHash(serializeRecord(...))` scheme and the same genesis constant — and neither is in
  `HASH_CHAINED_TABLES`, so the new whole-suite teardown cannot see them.
- **A test that tampers an MMR leaf and forgets to restore it is therefore invisible**, exactly as
  `persist-018`'s unrestored tamper was invisible before it. These two are also the ONLY chains
  production actually calls `verifyChain` on, which makes the gap the wrong way round.
- **`HASH_CHAINED_TABLES` is itself a hand-typed literal** and `schema-completeness` AC-005 only
  checks one direction — every listed table has a migration, never the inverse. That is why the list
  could silently omit two real chains.
- Not a one-line change: `verifyChain` is typed to `HashChainedTable` and the MMR tables are written
  by a different store. **Enforcer:** the teardown covers every chained table the schema has, and a
  new chained table cannot be added without appearing in it.

### `DOD-M15-SPINE-LANE-1` — ❌ The spine suites are run, or their absence is a decision on the record
Split from `DOD-M15-CI-SKIPS-SILENT-1`. 38 files — the M8D spine lane plus the cross-machine
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

### `DOD-M15-FREEZE-STATUS-1` — ❌ A defensive freeze is distinguishable in the session RECORD
Split from `DOD-M15-FRAME-1`, whose own clause asks that the freeze carry a status *"distinct from
an ordinary counterparty-absent close"*. It does not yet.
- `#freezeOnIdentityFailure` tears down via `destroySessionNode(..., "error")`, and `"error"` maps to
  DB status `interrupted` — **the same row an ordinary teardown writes.** So the freeze is
  distinguishable in the log and in behaviour, and invisible in the record an operator reads later.
- The sessions table has no reason/detail column. Adding one is a **client-side migration**, which
  on an operator's machine is unrecoverable if it fails — so it belongs in its own reviewed unit
  with an upgrade test against a populated pre-migration database, not riding inside a security fix.
- Until it lands, the ERROR log event is the only durable account of *why* a session ended this way.

### `DOD-M15-UNWITNESSED-1` — ❌ The two SUSPECTED partings are judged, not ignored
Split from `DOD-M15-DIVERGE-1` on review — that clause covered three producers and only the proven
one could ship safely. **Neither of these is visible to `sealReadiness` today.**
- **(a) An unwitnessed RECEIVED append.** `ingestReceivedContent`: a relay is attached, no witness
  bound the hash, the content is logged at WARN (`session.content.unwitnessed`) and **ingested
  anyway.** This is the direction an injected leaf appears in, so it is where `DOD-M15-FRAME-1`'s
  attack lands. **Gating on it today would be a false positive** — both peers hold the leaf, so leaf
  counts still agree. The useful work is separating "the relay has not witnessed it *yet*" from "it
  never will", which needs a fixture that can attach a relay client.
- **(b) An unwitnessed OWN send** — `assignedSeq === undefined`, the relay-degraded append. **Found
  by the review; not in the original record.** It sets no flag, emits no ERROR, and reads ready —
  while `placeOwnLeaf`'s own comment says *"the seal was already lost at the unwitnessed append, not
  here."* **So the gate fires one send later than the code says the damage happens.**
- **Do not gate either on suspicion alone.** The bar is a signal separating a relay catching up from
  a leaf it will never carry.

### `DOD-M15-MIGRATION-GUARD-1` — ❌ The upgrade guard checks all seven rebuilt tables, not one
**Found 2026-08-23 while adding a column for `DOD-M15-SEALWIRE-1` B2b, and it is why that column's
neighbours were found missing.** Raised with `CELLO_Support` over CELLO because it exposes both
lanes; test-only, and in neither lane's current unit.

`agent-id-migration.ts` rebuilds **seven** tables from a pinned DDL and copies the INTERSECTION of
the old and new column lists. So a column added by an inline `ALTER TABLE` and omitted from that DDL
is **dropped on the one boot where a legacy database upgrades** — and then re-added EMPTY by the same
ALTER moments later, which is what makes it silent: every observation after the fact shows the column
present.

`dod-agent-id-joinkey-migration` is the guard for exactly this, and it has caught the class **four
times** — `read_at`, `diverged_at`, `content_salt`, and `retry_queue`'s ordering record. **It replays
only the `sessions` inline ALTERs.** The other six rebuilt tables have nothing between a forgotten
column and silent data loss.

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

### `DOD-M15-DIVERGE-DURABLE-1` — ✅ The divergence flag survives a daemon restart
> **CLOSED 2026-08-22.** Reviewer verdict quoted: *"**SILENT FALLBACKS FOUND** — F4 (`readLock` →
> null → proceed) [blocking]; F5 (mode silently not applied on overwrite) [blocking]; F6/F7
> (crash-window states that open and are wrong, no fsync) [blocking]… **HOLLOW TESTS FOUND**
> [blocking] on four… I am not rubber-stamping this: BACKUP-1 writes a private key and overwrites a
> database, and it has three findings in exactly those two operations plus an agent-facing surface
> that cannot be called."* Every finding fixed. Gate: 4111 tests, lint, typecheck, clean build.
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

### `DOD-M15-OFFER-EXPIRY-1` — ❌ An invitation to dial does not stand open forever
Split from `DOD-M15-ASSIGN-1` (b) review F5. `admitOfferedDialer` names a peer and **nothing ever
clears it**, so the DoD's word "live" is not enforced.
- An offer never followed by an assignment — initiator aborts, directory faults, the accept send
  fails — leaves the receiver holding a standing invitation to that peer **indefinitely**.
- **Two inbound offers close together are now mutually exclusive at the transport:** both are told
  to dial the same receiver, the second narrows the gate away from the first, and the first
  initiator is refused with a `connection.rejected` naming a peer id it never heard of. Before the
  gate existed, whichever dialed first simply won.
- **Fix shape:** bind the narrowing to the session id it came from, revert it when the accept send
  fails, and expire it on the same clock the directory uses before it gives up waiting for an accept.
- **Enforcer:** journey.

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

### `DOD-M15-RELAYAUTH-1` — ❌ No relay service without a directory-issued assignment
**Depends on `DOD-M15-ASSIGN-1`** — the client must be presenting a verified assignment before the
relay can require one. Decision 3(b): the relay **verifies a credential the caller presents** and
learns nothing itself; it does not query the directory. This preserves extractability — a private
enterprise relay stays a signature-verifier rather than becoming a directory client.
- Relay service requires an assignment naming the caller as a participant — **including collecting
  parked content**, where the original session's assignment is the credential the caller already
  holds.
- **The liveness query is scoped.** Today it has no participant check and no session check: it
  carries a session id the handler never looks at and answers from a **global** map, so anyone with
  a list of pubkeys can build a live map of who is active and when. Requires the caller to be a
  named participant, and answers only for that session.
- **The relay verifies that an authenticating key is a registered agent**, rather than accepting any
  Ed25519 keypair.
- **A connection gater on the relay, including the reservation-dial hook.** Reservations are granted
  to any peer up to 4096, and the hook restricting who may dial *through* to a reservation holder is
  never installed — so an agent's circuit address is dialable by anyone who learns it. **This is the
  relay-side twin of the receiver gate**; without it that gate closes the direct route while the
  circuit route stays open.
- **Enforcer:** stranger, on the circuit path as well as the direct one.

### `DOD-M15-SWEEP-1` — 🅿️ The checked-then-ignored class is hunted, not patched
**Trigger: after `DOD-M15-FRAME-1` and Tier 4's seal change**, so the sweep hunts the unknown
seventh instance rather than rediscovering the six already on this list. Parked only for sequencing —
it is inside the gate.
- For **every** frame handler and **every** verification call in daemon, directory and relay, answer
  two questions: does a failed check take a hard-fail path, and does a **missing or malformed** proof
  take the same path as a mismatched one?
- Fix every hit. **Rewrite — do not delete — every nearby comment asserting a property the code does
  not enforce.**
- Unknown scope by construction. It takes as long as it takes (§0z).

---

# Tier 3 — The basic value actually being delivered

Parallel with Tier 2. Source is [[launch-triage]] — **read its header warning before trusting any
status marker there.** Items are cross-referenced by their triage designation.

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

### `DOD-M15-REFUSED-INBOUND-SILENT-1` — ❌ A message we refused is a thing the operator gets told
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

### `DOD-M15-TRANSPORT-TERMINAL-1` — ✅ A transport blip stops killing a healthy conversation
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

### `DOD-M15-TERMINAL-REASON-1` — ✅ "Sealed" and "gave up" stop being the same word
> **CLOSED 2026-08-22.** Reviewer verdict quoted: *"**SPEC: DEVIATIONS FOUND** … **SILENT FALLBACKS
> FOUND** … **ERROR SUBSTITUTION FOUND** … **HOLLOW TESTS FOUND** — T1 through T5. T1 is the serious
> one: the classification that *is* TRANSPORT-TERMINAL-1 has no test on two of its three branches,
> and the mutation you asked me to hunt for — making a merits refusal non-terminal — leaves the gate
> green."* Every finding fixed and each of the reviewer's measured-green mutations re-run red.
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

### `DOD-M15-PULLRECOVER-1` — ❌ The certificate pull is proven to work, or proven to be asking wrong
`DOD-M12B-PULL-NEVER-RECOVERS-1`. **157 attempts, 0 recoveries**, on one daemon in one day. This is
the only safety net standing between "the relay said sealed but lied" and "the receipt is gone."
- **Establish WHICH explanation is true first** — the certificates genuinely are not there, or the
  recovery path cannot find records that do exist. That is its own measurement, not an assumption.
- **The trap:** do NOT read a `not_found` as proof no certificate exists and auto-repair a terminal
  row on it. Homing moves are in the same day's logs, the record may sit on another consortium node,
  and a grace window may not have elapsed. Treating absence as proof would destroy genuinely
  terminal state — strictly worse than the divergence it exists to repair.

### `DOD-M15-INTERRUPTED-1` — ❌ An interrupted session can seal, and it has been watched doing it
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

### `DOD-M15-SEAL-RETRY-1` — ❌ A failed background ceremony retries itself
Split from `DOD-M15-SEAL-FAILED-TERMINAL-1`. The failure is now DISCOVERABLE and re-close is a working
manual remedy; nothing is automatic.
- An unattended daemon sits on a durable commitment doing nothing until it is restarted — the restart
  seal resolver is the only retry, and it only runs at boot.
- Most of the nine resolved failure reasons are transient by nature (`seal_counterparty_pending`,
  `seal_unilateral_timeout`, a directory briefly unreachable), so a bounded backoff would clear them
  without an operator ever seeing `seal_failed`.
- Reuse the resolver's discipline rather than inventing a second one: serial, staggered, with a
  give-up stamp — and note that `DOD-M15-SEAL-FAILED-TERMINAL-1` made that stamp clearable on revive.

Split from `DOD-M15-CLOSEWAIT-1` (review HIGH-1, the half that remains).
- `seal_in_progress` now distinguishes a RUNNING ceremony from "no ceremony". What is still missing is
  the terminal case: a background ceremony that **threw** leaves the session `active` with a durable
  commitment, no receipt, and nothing retrying until a daemon restart.
- The agent was handed `ok: true` at commitment, so it has no reason to suspect anything is wrong; the
  only account of the failure is a `session.seal.background.failed` line in the daemon log.
- Persist the last background failure on the session row and answer `seal_failed` with its reason, so
  the state survives the read and an agent can tell "slow" from "dead".

`DOD-M12B-CLOSE-SILENT-WAIT-1`. Half fixed — the wait now announces itself, which stopped operators
reaching for `force: true` and forfeiting the receipt the wait was about to earn (17 sessions were
lost that way).
- The caller still waits out `CELLO_SEAL_BILATERAL_TIMEOUT_MS` (660,000 ms) before the escalation
  that then succeeds. Measured 11m 06s.
- **Answering early orphans the unilateral escalation that runs inline after the wait** — that
  changes the close contract and what produces the receipt. Decide the contract, then build.

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

### `DOD-M15-ALERTING-1` — ❌ Something tells us when a node is unwell
`DOD-NODE-ALERTING-1`. **Zero alerting policies exist in `cello-infra`** while a node ran at 38–44%
CPU against a healthy idle of 0.3–0.4% for days.
- A policy on sustained CPU, and one on the `cello.node.memory` metric the host sampler now emits.
- **Note for anyone adding another sampler:** COS forwards journald to Cloud Logging at **WARNING
  AND ABOVE ONLY** — the first version logged at info, produced perfect lines that never left the
  instance, and cost a second roll of all three nodes.

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

### `DOD-M15-NODEHEAP-1` — ❌ The directory's memory growth has a cause
`DOD-NODE-HEAP-GROWTH-1`. Mitigated, not fixed: the ceiling was raised to 4,096 MB, buying roughly
two weeks instead of six days. The process grows ~250 MB/day and at ~80% of ceiling the node answers
**nothing for 40 seconds** while V8 collects on the same thread that serves HTTP.
- Establish whether the growth is a leak. Evidence points **away** from client traffic — `use1` (the
  hardcoded primary) and `euw1` (failover only) sat 9% apart after near-identical uptime.
- Anti-entropy, which every node runs continuously regardless of clients, is the untested candidate.
- The 60-second sampler is running; the growth rate across the three nodes is the measurement that
  decides whether this closes or becomes a real hunt.

### `DOD-M15-IPCVISIBLE-1` — ✅ A connection closing leaves a record, and an identity switch says why
> **CLOSED 2026-08-22.** Reviewer verdict quoted: *"**SILENT FALLBACKS FOUND** — F4 (`readLock` →
> null → proceed) [blocking]; F5 (mode silently not applied on overwrite) [blocking]; F6/F7
> (crash-window states that open and are wrong, no fsync) [blocking]… **HOLLOW TESTS FOUND**
> [blocking] on four… I am not rubber-stamping this: BACKUP-1 writes a private key and overwrites a
> database, and it has three findings in exactly those two operations plus an agent-facing surface
> that cannot be called."* Every finding fixed. Gate: 4111 tests, lint, typecheck, clean build.
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

### `DOD-M15-SWEEP-ABORT-1` — ❌ A shutdown stops the network work it started
Split from `DOD-M15-STALEROSTER-1` (review F10). The background roster sweep spends up to ~16 s on
`/bootstrap` probes when a node is down, on a 90–180 s cycle — so roughly one `cello logout` in eight
lands mid-sweep.
- The daemon now IGNORES a sweep that completes after `stop()` (no callbacks, no log, no re-arm), so
  nothing acts on a dead daemon's behalf. **The probes themselves still run.**
- Cancelling them means an `AbortSignal` threaded through `manifestNodesToEndpoints` and
  `fetchBootstrapResult`, which owns a per-request controller for its own deadline and accepts no
  external one. That is a wide signature change and did not belong inside a hardening unit.
- The same seam would let `DOD-M12B-SHUTDOWN-1`'s reconcile sweeper stop dialing on demand.

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

### `DOD-M15-EXPIRY-CONSUMER-POLICY-1` — ❌ One policy for an expired anchor, across all consumers
Split from `DOD-M15-MANIFEST-EXPIRY-LIVE-1` (review F6). The daemon already has a per-consumer
policy for an expired manifest — it just never chose it.
- `signal-submission.ts` REFUSES a trust-signal submission on the held manifest's expiry.
- `register-handler.ts` deals a FROST share against a roster re-resolved from that same lapsed
  manifest, with no gate. The challenge verifier authenticates a directory against it, with no gate.
- **So the lowest-stakes consumer is blocked and the two highest-stakes ones are permitted.** That
  may even be the right answer — but it is undefended, undocumented, and invisible to the operator.
- Decide it deliberately, per consumer, and write down why.

### `DOD-M15-BUNDLED-2030-1` — ❌ The compiled-in manifest has a cliff and no in-band remedy
Split from `DOD-M15-MANIFEST-EXPIRY-LIVE-1`. `BUNDLED_CONSORTIUM_MANIFEST` expires `2030-01-01`.
- On that date **every daemon on the production default refuses to start** (ADV-002), simultaneously.
- The only fix is upgrading `@cello-protocol/connect`, which an operator whose daemon will not start
  has no in-product prompt to do.
- The bundled path wires no manifest poll, so a newer manifest cannot be adopted at runtime either.
- Needs a rotation story before it needs a fix, but the cliff should be on the record now.

<!-- superseded detail from the original line, retained for the trail -->
Found by `DOD-M15-STALEROSTER-1`'s review, and **the inverse of where that unit put the hazard.**
- Manifest expiry is checked **only at startup** (`verifyStartupManifest`), and the bundled-manifest
  path wires **no poll scheduler** at all.
- So a long-running daemon whose manifest expires under it keeps probing its node set and — after
  `STALEROSTER-1` — reports `stale: false`. A confidently fresh reading taken against an expired
  trust anchor, which is worse than the stale reading that line was written to fix.
- Minimum: surface `expires <= now` in the status block. Better: re-check on the manifest poll.

### `DOD-M15-VOCAB-ORDERING-1` — ❌ A response cannot be assembled after it has been translated
Split from `DOD-M15-SELECTION-1`, where it cost an operator-facing defect. `renderForSurface` is a
PASS at ONE point in the pipeline: anything spread into a response after that point ships
untranslated, and MCP tool names are not commands a terminal can run.
- The instance: a fallback notice added at the IPC write told a CLI caller to *"Run
  `cello_use_agent`"*. The real command is `cello use-agent`. `isInstructionKey` would have rewritten
  it — the string simply arrived after the rewrite had run.
- **The prose audit is structurally blind to this class.** It checks that tokens naming tools are
  REAL tool names, and `cello_use_agent` is one. The defect is the ORDERING, and nothing watches it.
- The guard belongs on the pipeline, not the vocabulary: make it unrepresentable to add response
  fields downstream of the renderer, or assert at the boundary that no `*guidance` value leaving for
  a CLI surface contains an MCP verb.

### `DOD-M15-DOORBELL-1` — ✅ A daemon shutdown does not ring like an incoming message
> **CLOSED 2026-08-22.** Reviewer verdict quoted: *"**SILENT FALLBACKS FOUND** — F4 (`readLock` →
> null → proceed) [blocking]; F5 (mode silently not applied on overwrite) [blocking]; F6/F7
> (crash-window states that open and are wrong, no fsync) [blocking]… **HOLLOW TESTS FOUND**
> [blocking] on four… I am not rubber-stamping this: BACKUP-1 writes a private key and overwrites a
> database, and it has three findings in exactly those two operations plus an agent-facing surface
> that cannot be called."* Every finding fixed. Gate: 4111 tests, lint, typecheck, clean build.
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

### `DOD-M15-CHAINHEALTH-1` — ❌ Tamper-evidence can be checked without SSH
`DOD-ACCOUNTS-CHAIN-1`, the remainder. The writer is fixed, deployed and the data re-measured clean
(11 rows per node, `verifyChain` VALID on all three). What is missing is that answering *"is it still
intact?"* requires IAP SSH to each node and credentials out of Secret Manager — which is why a stale
"it is broken" note survived four days and nearly caused a destructive repair.
- `verifyChain("user_accounts")` on the ops-agent health output.
- Spin-off recorded, not repaired here: `DOD-ACCOUNTS-EMAIL-CHAIN-1` (the email half is stored but
  not chained), and the test-isolation defect where several suites `DELETE` from this append-only
  chained table.

### `DOD-M15-SAMEOP-1` — ❌ Same-operator standing does not depend on which node answered
`DOD-SELF-STANDING-NULL-LINKAGE-1` + the security half of `CELLO-REPL-001`.
- **The account arm reads a node-local column.** Measured live for one operator with three agents:
  `usc1` had 2 linked, `euw1` 1, `use1` 0. **Searching every node does not fix this** — the
  first-node-with-a-hit strategy may return the one holding the NULL link. The reader moves to the
  replicated table, and **this is the reader to move first.**
- **Case 1 stays open and is answered here:** the flag is false when both agents have no account and
  no verified phone, because nothing links them. Determine whether that state is reachable by an
  agent that can submit, and close it or record the bound.
- Case 2 (unresolvable issuer) was closed by `DOD-END-ISSUER-REGISTERED-1`; do not re-open it.

### `DOD-M15-ENDORSE-RETRY-1` — ❌ A trust signal reaches the directory when one node is down
`DOD-END-SUBMIT-1`'s handed-forward AC. Previously triaged ship-without; **in scope under the basic-
value criterion** — "mint a trust signal and have it received" is advertised value.
- Submission fails over to another node rather than failing and requiring the operator to re-run the
  command. The consortium has three.
- **Verify at the same time** whether the refuse-op drain gap closed when `cello-portal-ingress-drain`
  shipped; nobody has checked since.
- **Enforcer:** journey.

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

### `DOD-M15-SCREENINSTALL-1` — ❌ The semantic screener runs against real weights, at least once
`DOD-DOC-SCREEN-INSTALL-1` + `DOD-DOC-SCREEN-CLASSIFIER-1`. **Sequence after `DOD-M15-FRAME-1`** —
shipping the classifier while the direct path bypasses the whole screening layer gives you screening
an attacker walks around.
- `installModel` has no production caller anywhere: no command, no `@huggingface/transformers`
  dependency, not even optional. Ship the install path — command, optional dependency,
  `--allow-unpinned-digests`.
- **Observed running against real weights at least once**, in production, with the ACTIVE startup
  line witnessed. Every test today runs against an injected fake because no weights are downloaded
  in CI.
- **`DOD-DOC-SCREEN-DOUBLE-DECODE-1`:** every document frame is CBOR-decoded twice, against a
  resource budget whose own header says the doubling was measured and rejected — a hostile input the
  budget was built to catch may now clear it.
- **`DOD-DOC-SCREEN-STARTING-CONTENT-1`:** a document's initial seeded content — the largest single
  block of peer-authored text an operator ever receives — gets only the character denylist.

### `DOD-M15-DOCPROFILE-1` — ❌ The agreed content profile is enforced by something
`DOD-DOC-PROFILE-1`. Two parties agree a profile at the handshake; it is bound into the document id
and immutable for its life, and **no verb consults it.** An operator who deliberately chose the
restrictive profile gets exactly the protection of one who did not think about it.
- Not a break — inbound updates are still screened by the general rules — but the setting is a
  promise the system does not keep.

### `DOD-M15-HEARTBEAT-1` — ❌ Directory nodes can see each other's heartbeats
`DOD-HEARTBEAT-REPLICATION-1`. Every node reads the other two as never-heartbeated and counts
`availableNodes: 1` against `requiredThreshold: 2`; federation checkpoints have **never once
succeeded**.
- **Established by measurement, do not re-derive:** this did NOT cause the sealing outage — the
  degraded count was already true *during* seals that worked.
- **Cost, stated before anyone starts:** `last_heartbeat_at` is mutable, so it cannot join the Tier-A
  immutable set. This means a Tier-B mutable merge with a version column — a new merge table, not a
  one-line spec edit.
- **A code comment blaming a "BIGSERIAL `id` collision" is wrong** and would send the repairer at the
  wrong fix; rewrite it (Invariant / `DOD-M15-CLAIM-COMMENTS-1`).

### `DOD-M15-MISMATCH-1` — ❌ An unsealable mismatch leaves a durable trace
`DOD-FRONTIER-MISMATCH-DURABLE-1`. The strand itself is closed (dedup is keyed on relay-assigned
position), but the mismatch flag is held **in memory and dies on every daemon restart** — which
undercuts the "a live session sat unsealable for a week" concern that made this severe.
- **Prefer derive-on-read from the persisted seal-rejection record**; it cannot drift from the
  evidence, where a written flag can.
- Inherited caveat: three paths still end unwitnessed (relay down, terminal assignment rejection,
  retry exhaustion), so **relay position is not total** and anything keyed on it must not assume it
  is.

---

# Tier 4 — Own the encryption, then bind the receipt

**The largest coupled pair in the milestone, and both are inside the gate** — ruled on the migration
argument: a wire and schema change is cheapest against an empty database and never gets cheaper.
`DOD-M15-KEYAGREE-1` **must precede** `DOD-M15-SEALWIRE-1`; it produces both outputs the seal change
consumes.

### `DOD-M15-KEYAGREE-1` — 🟡 CELLO owns its own confidentiality guarantee
> **PRIMITIVE BUILT + REVIEWED 2026-08-23** (→ Entry 39); **STAYS 🟡 — nothing consumes either
> output.** That is `SEALWIRE-1`'s work and the reason KEYAGREE precedes it. Reviewer: *"it ships a
> primitive while the DoD clause it most needs to satisfy — destruction at close — has neither code
> nor caller."* Verdict quoted: *"**HOLLOW TESTS FOUND** — six of eight mutations stay green,
> including deleting the pubkey binding, inverting the sort, swapping the two labels, and replacing
> the content-hash salt with a constant [blocking]… **ERROR SUBSTITUTION FOUND**… I am not
> rubber-stamping this one. The construction is sound… almost none of that is pinned by a test."*
> All thirteen findings fixed. Gate: 4254 client tests, lint, typecheck, build.
>
> **The construction was verified sound** — salt/info assignment conventional per RFC 5869, IKM
> concatenation unambiguous because the X25519 secret is fixed-length, and matching TLS/NIST hybrid
> practice. What was missing was any test that constrained the BYTES: every property I had tested is
> satisfied by X25519 alone.
> **`pqTranscript` added while there are no callers** — a hybrid must bind the KEM's ciphertext and
> public key, not just its secret (X-Wing; eprint 2026/140 says necessary, not optional). After a wire
> format exists it is a wire change, i.e. the rewrite the hook exists to avoid.
> **Refuses:** a non-canonical peer key (bit 255 — a one-bit undiagnosable session kill), a reflected
> key, a wrong-length key on either side, an empty session id.
> **Carried:** `DOD-M15-EPHEMERAL-REVIVAL-1`, `DOD-M15-EPHEMERAL-AUTH-1`.

### `DOD-M15-EPHEMERAL-AUTH-1` — ❌ The session ephemeral is bound to the agent's identity
Split from `DOD-M15-KEYAGREE-1` (review F6). The key agreement defeats a PASSIVE recorder — the
harvest-now threat the line names — and NOT an active on-path relay.
- Nothing in the key-agreement API takes an identity key, so there is nowhere to bind the ephemeral
  to a peer. An active relay substitutes both ephemerals and reads everything.
- `SEALWIRE-1` must sign the ephemeral public with the agent's Ed25519 identity and verify the peer's
  BEFORE deriving. It also removes `KEYAGREE`'s bit-255 refusal as the sole tamper detector — a
  signature catches the flip instead.
- The module docstring states the limit in the meantime, so a reader cannot conclude MITM is covered.

### `DOD-M15-EPHEMERAL-REVIVAL-1` — ❌ A revived session RE-KEYS
Split from `DOD-M15-KEYAGREE-1` (review F5, ruled in Decisions Carried #5).
- CELLO sessions survive daemon restarts; the ephemeral secret is deliberately NOT persisted, so a
  revived session has no key material and its content is unreadable until it RE-KEYS.
- Needs a fresh ephemeral exchange on revival, on the same path that rebuilds the session node.
- **Terminology (Andre, 2026-08-23): say "re-key the session", never "re-handshake".** The latter
  reads as reconnecting to the directory or revalidating a session, and it is neither.
- **Do not "fix" this by persisting the ephemeral.** That is the option Decisions Carried #5 rules
  out, and the reason is that key material in a backup is unrecoverable once written.

Relay-audit Decision 5(b), with the PQ hook built in from the start.
- Live content today is plaintext inside libp2p's Noise session. Confidentiality is real, but it is
  **libp2p's** key agreement over **libp2p's** ephemeral transport keys, so **CELLO cannot upgrade
  its own confidentiality guarantee** — PQ migration would happen on libp2p's timeline with libp2p's
  algorithm choices.
- **Urgent rather than later:** the threat is harvest-now-decrypt-later. Every cross-NAT
  conversation is relayed today, therefore recordable at fixed endpoints today, and adding the layer
  later does not protect traffic already sent.
- **Per-session ephemeral handshake**, not static-static. Each side mints a fresh keypair per
  session, agrees a session key, destroys the ephemerals at close. **Static-static would void forward
  secrecy** — a key derived only from long-term identity keys is the same key forever, so anyone who
  ever obtains an identity key decrypts every conversation that agent ever had. That is strictly
  worse than today, and [[design-problems]] already claims forward secrecy as structural.
- **The derivation accepts an additional shared secret from day one**, before there is a PQ
  contribution to put in it. Hybrid PQ then becomes mixing a second agreed secret into the same
  derivation — an addition, not a rewrite. Omitting the hook defeats the entire reason for the work.
- **⚠️ "One agreement, two outputs" WAS WRONG — corrected by Andre 2026-08-23, before SEALWIRE
  encoded anything.** The envelope key and the content-hash salt are TWO INDEPENDENT VALUES agreed in
  the SAME exchange — not two outputs of one derivation.
  **Why the original was wrong, recorded so nobody rebuilds the coupling:** they are unrelated goals
  that merely both need a shared secret. The envelope key stops the relay reading messages in flight
  and MUST be destroyed at close. The salt stops anyone holding stored hashes from confirming a
  guessed message and MUST survive for the life of the session. **Deriving both from one secret ties
  "must be forgotten" to "must be kept forever"** — and every consequence previously flagged (salt
  epochs, per-leaf epoch attribution, lockstep switching) was a symptom of that single coupling, not
  a real requirement.
  Keep the MOMENT, drop the DERIVATION: one round trip, two independent values.
- The parked-content seal (X25519 + HKDF + AES-256-GCM) is the working in-tree pattern to extend.

### `DOD-M15-HASHCORRELATE-1` — ❌ A message hash does not identify the message across sessions
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

### `DOD-M15-SEALWIRE-1` — ❌ The receipt is bound to the transcript
**One protocol change, not six. These cannot be split** — every one changes the same wire format or
depends on the domain change, and shipping any alone leaves the two sides disagreeing about what a
root means. Both repos; version-bump ACs on both sides.
- **The bilateral certified root moves into the content-hash domain** (Decision 1(a)), as the
  unilateral path already uses. Alpha is precisely when this is free.
- **The client verifies the certified root against its own tree** before accepting or co-signing.
  Today it takes the sealed root off the wire, confirms the directory signed *those bytes*, stores
  it, and **discards the root it computed one step earlier** — so the receipt proves the directory
  signed something, not that it signed your conversation. The worst moment is co-signing: **your key
  signs a root you never checked.** Once both roots live in one domain this is a one-line comparison,
  and root equality implies leaf-set equality, which also covers the missing bilateral leaf-count
  check.
- **The directory verifies the SEAL leaf's `final_root`** — and **the deferral comment is deleted in
  the same diff.** Fixing one side of a mutual deferral and leaving the other half pointing at it is
  how this gap was created.
- **The directory's circular root check is replaced.** It rebuilds a root from the same leaf array
  the relay supplied using the same code, so it validates arithmetic, not the relay, and cannot
  detect a dropped or reordered leaf. Compare against something the relay did not supply.
- **The sender's signature is stored with each leaf** (Decision 6(b)). Today the stored record has
  **no sender signature and no sender field** — a transcript row holds the message and a direction,
  and attribution comes entirely from local session state. The record must prove authorship
  independently of whatever gate was in force when it was written; that matters the moment a
  transcript is shown to anyone other than its owner.
- **The content hash is salted**, from the same handshake. It is currently an unsalted SHA-256 of the
  plaintext, so a relay holding the hashes can *guess* a short predictable message — "yes",
  "approved", a price, a name — and confirm the guess.
- **The dead `seal_attempt` path is deleted** — handler, tests, and the relay test asserting the
  frame never appears. A fully written handler with no sender reads as abandoned work to anyone
  auditing a public repo.
- **The ten spine tests are replaced.** They assert both sides ended with the same sealed root; both
  sides merely received the same bytes from the same certificate, so every one stays green if the
  directory certifies a root over a completely different leaf set. Replace with each side's **own**
  tree matching the certified root.
- **Enforcer:** receipt.

### `DOD-M15-SEALPARTIES-1` — ❌ Both real participants approve before any signature exists
The T-of-N log's Part 3 fix direction. Moves the trust anchor from *"the verifying directory node is
honest"* to *"at least one of the two real participants is honest"* — a far more natural assumption
for a communication protocol, and one that does not depend on directory behaviour at all.
- **Affirmative pre-signature approval from every real participant**, not just the initiator. Today
  the initiator re-derives the root and refuses to co-sign if inflated — a hard gate before any
  signature exists — while the counterparty runs the same comparison only **after** receiving
  `session_sealed`, by which point the result is a durable artifact with no mechanism to invalidate
  it.
- **Raw signed leaf data is forwarded to co-signing directories**, not a claimed root. Today the
  other `T−1` directories verify only that they hold a share and there is no conflicting ceremony,
  then sign whatever bytes they are handed — cryptographic weight without judgment.
- **This is the counterbalance line of the milestone** (Invariant 1): name it explicitly in the
  journal before building.

### `DOD-M15-UNILATERAL-1` — ❌ Absence is evidenced and tiered, and the artifact says what is weak
T-of-N log Decisions 1 and 2, plus its Part 4.
- **Hybrid trigger:** a time floor as a backstop, paired with an actual delivery-attempt/timeout
  record — **elapsed time alone is never sufficient on its own.** Today `#processSealUnilateral`
  compares elapsed time against `deliveryGraceSeconds` (600s) with **no presence check whatsoever**;
  a fully-reachable counterparty who takes longer than ten minutes can be sealed out from under them.
- **Two tiers.** Standard (default, unchanged): today's flat 600s, no evidence required, no
  dependency on the relay fan-out. High-stakes (**explicit opt-in** — nothing in the infrastructure
  can safely infer consequence, the relay is deliberately blind and the directory never sees it):
  **3600s starting point**, and the hybrid check is **mandatory**, not optional.
- **The artifact is split** into a full-strength mutually-signed prefix and an explicitly
  lower-weight unconfirmed tail. Everything up to the absent party's last signed message is exactly
  as strong as a bilateral seal; only the uncountersigned tail is weaker, and a downstream consumer
  must never mistake one for the other.
- **Escape-hatch risk, and why this ships near `DOD-M15-SEALPARTIES-1`:** strengthening bilateral
  sealing while unilateral keeps a self-declared clock-only trigger hands a malicious initiator an
  obvious way around the whole fix — wait out the timer, or engineer the appearance of
  unreachability. **Do not ship these far apart.**

### `DOD-M15-LEAFPARTIES-1` — ❌ Every content leaf is constrained to the session's two participants
The one question the T-of-N log left explicitly open. `verifySealLeaves` constrains only the final
two SEAL control leaves to be from two distinct participants; whether every **earlier content** leaf
is independently constrained to that same pair — as opposed to merely being internally
self-consistent — was never confirmed.
- **Verify first, then close if needed.** It did not change the MITM finding's bound, because in
  that scenario the two participants the record shows are simply A and M throughout. It is still a
  distinct unresolved question.

### `DOD-M15-INCLUSION-1` — ❌ An operator can prove a message sits under a sealed root
`cello_get_inclusion_proof` is a `not_implemented` stub. **Depends on `DOD-M15-SEALWIRE-1`** for a
root domain the client can reproduce.

---

# Tier 5 — Abuse controls, relay redundancy, infrastructure

Parallel with Tier 4 — different disciplines, no shared files.

### `DOD-M15-RELAYABUSE-1` — ❌ The relay has abuse controls
- **Rate limiting per peer and per pubkey** on authentication, hash submission, gap-fill, the
  liveness query, and content-park deposit. There is **none of any kind** today.
- **Bound the content-park store per depositor.** Deposit is unauthenticated by explicit design
  (safe, because a sender signature sits inside the seal), but with 4 MiB frames, no rate limit and
  a 256 MB store it is trivially fillable for every user at once.
- **Re-enable the per-session idle timer in the production binary** — the feature exists and the
  binary never passes it, so only a 24-hour sweep runs — and restore duration and byte caps on
  relayed connections, which are deliberately disabled.
- **Delete the directory-admin push handler, or justify keeping it in the code.** It is live, has no
  caller, and its signed body carries no nonce and no timestamp — no replay protection. Adding
  replay protection hardens a path nothing uses; **deleting it is cheaper and strictly safer.**
- **An empty `CELLO_DIRECTORY_PUBKEYS` fails startup loudly instead of degrading silently.** The
  deployed config is correct today — both relays log `count=3, anyDirectory=True`
  (`DOD-M15-SPIKE-1(b)`, Entry 1) — so this is not a live fault. What is unfixed is the failure mode
  that would hide it becoming wrong: with one key the relay silently accepts assignments from one
  directory and sessions brokered by the other two are unusable, which surfaces as random
  per-directory session failures rather than as a config gap. The startup log already makes it
  visible; make it fatal.

### `DOD-M15-RELAYLEAK-1` — ❌ Relay clients are closed
Graceful shutdown never closes relay clients, and the seal-only detached-transport path registers a
session that is never unregistered, so a cached relay client is never closed for the process
lifetime. Client-side, small, standalone.

### `DOD-M15-MULTIRELAY-1` — ❌ An agent's reachability does not rest on one relay
**Scoped by `DOD-M15-SPIKE-1(c)` → Entry 1. This line is AVAILABILITY ONLY.** The client already
requests reservations with every known relay (`reservationsRequested: 2`) — the audit's "reserves
with exactly one relay" was the outcome, not the request. But one relay carries **2,648 of 2,675**
reservations (99.0%), so the linkability mitigation Decision 7 assumed **does not hold** and that
claim is withdrawn rather than relied on (`DOD-M15-DISCLOSE-1`). Making selection genuinely spread is
an improvement, not a mitigation we are counting on; the fleet is two relays regardless.
- Inbound reachability must survive one relay going away. Today the cheapest way to take an agent
  offline is to flood the relay its reservation actually landed on — a concentrated,
  infrastructure-shaped target, the opposite of the diffuse surface the pitch describes.
- **First, explain the churn** (measured, Entry 1, one daemon's log): **2,675 `reservation.lost`,
  664 `reservation.none`, 88 retries, 9 `gave_up`**, with `reason: relay_connection_gone`. An agent
  whose reservation is gone is **unreachable by any NAT'd peer while still looking perfectly
  healthy** — exactly the silent-loss-of-inbound failure `DOD-NAT-REACHABILITY-1` was built to kill.
  Whoever pulls this line starts by explaining those numbers, not by adding relays under them.

### `DOD-M15-RELAYFANOUT-1` — ❌ A single relay's account of a conversation can be cross-checked
Serves **three** separate problems, which is a good sign it is the right thing to build: truncation
resistance at seal, evidenced absence for `DOD-M15-UNILATERAL-1`, and the corroboration layer below.
- **Truncation** is not caught by more verifiers: a primary directory that has honestly relayed the
  real conversation can submit a genuine but *truncated* prefix — every leaf validly signed, nothing
  false, only something missing. Forwarding raw leaves to more directories does not help, because
  all of them are handed the same feed by the same source.
- Fan the live hash sequence to **two or three relays** instead of one, fire-and-forget, so a single
  relay's account at seal time is cross-checkable against an independent live witness.
- **Fits the cost model:** relays are meant to be cheap, stateless and numerous specifically so this
  redundancy is affordable; directories are the few, database-backed, anti-entropy-meshed tier.

### `DOD-M15-CORROBORATE-1` — ❌ The relay verifies every hash proactively, not on request
T-of-N log Decision 4. **The defense-in-depth answer to `DOD-M15-FRAME-1`'s own new attack surface**:
the party best positioned to detect a wrong-signer event is the receiving client, which can itself be
compromised and could weaponize "signature mismatch" as a false accusation.
- **Freezing locally is always safe unilaterally** — it limits only what that client trusts. What
  must **not** be asserted unilaterally is the accusatory record.
- **The relay is the corroborating witness for a precise reason: its copy of what the sender signed
  never passes through the receiving client at all.** A compromised receiver cannot touch, edit or
  suppress it.
- **Proactive, not on-demand.** The relay is bound to the session with both participants' real
  pubkeys and already receives every signed hash; checking each against the two expected keys costs
  nothing new and **does not depend on the accusing client's cooperation or honesty** — which is
  precisely what closes the compromised-detector gap. Detection is not enforcement: alert the
  affected daemon, and consider refusing to keep relaying a session it has flagged.
- **No new cryptography** — the identical check the directory already performs at seal time,
  triggered early. **Stays inside the blind-witness design**: verifying a signature against a known
  pubkey never requires reading content.
- One relay is one witness; this becomes a decentralized detection layer only with
  `DOD-M15-RELAYFANOUT-1`.

### `DOD-M15-DIRAUTH-1` — 🟡 Directory authentication cannot be silently skipped
> **SURFACING HALF DONE + REVIEWED 2026-08-23** (→ Entry 36); **stays 🟡 because bullet 2 is
> untouched.** Reviewer: *"The line is not closable on this diff… make sure the DoD tag reflects that
> rather than flipping green."* Extracted as `DOD-M15-BOOTSTRAP-AUTH-1`.
> Verdict quoted: *"**SILENT FALLBACKS FOUND** — F1 (HIGH): the refusal runs after the irreversible
> identity migration and after every open session is marked interrupted, violating the rule stated 90
> lines above it in the same file. [blocking] **ERROR SUBSTITUTION FOUND** — F5… the refusal quotes a
> re-randomised URL and asserts 'a DNS hostname… that is the usual cause' without having checked it;
> F3 (HIGH): all three remedies name a variable that, followed literally, produces a different
> startup crash. [blocking]… I do not think I am rubber-stamping this one."* All nine fixed.
>
> **What shipped:** `cello_status` states the posture in BOTH directions (the milestone's
> healthy-path-is-silent rule is deliberately inverted here — the defect IS that "enforced" looks
> like silence); local and public are separated so a loopback dev run is calm;
> `CELLO_REQUIRE_DIRECTORY_AUTH` refuses at STARTUP, now as pure config validation before any disk
> side effect.
> **My worst defect:** the refusal originally ran after the irreversible identity migration and after
> every open session was marked `interrupted` — a "failed to start" that changed the operator's
> record on the way out.
> **My claim that justified the unit was false:** `directory.signaling.connected` logs
> `verified: !!verifier` every connect. The right reason is that a LOG IS NOT A CONTROL.
> **Carried:** `DOD-M15-BOOTSTRAP-AUTH-1`, `DOD-M15-STEP6-REPLAY-1`.

### `DOD-M15-BOOTSTRAP-AUTH-1` — ❌ The bootstrap coordinate arrives over an authenticated channel
Extracted from `DOD-M15-DIRAUTH-1`'s second bullet so it is a line rather than a footnote.
- The directory's `/bootstrap` coordinate comes from a **plaintext HTTP endpoint on port 9090**.
- Step 6 converts a poisoned redirect into a refused connection — it does not prevent the redirect,
  so the attacker retains denial-of-service, and step 6 is itself skippable (that is `DIRAUTH-1`).
- This is the fix the byte/normalised string match was standing in for.

### `DOD-M15-STEP6-REPLAY-1` — ❌ A directory identity proof cannot be replayed
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

### `DOD-M15-DDOS-1` — ❌ Volumetric protection sits in front of the relay
**The only line in this milestone that addresses actual denial of service**; every other control is
application-layer and changes who is *admitted*, not how much traffic *arrives*. A gate runs after
the TCP connection is made and the handshake has begun.
- Cloud Armor or equivalent in front of the public relay endpoint, which is open to `0.0.0.0/0`.
  [[server-infrastructure]] already states the requirement and it is not built.
- **Against a user's machine nothing at the application layer helps** — once packets arrive at a
  home connection the link is saturated before any code runs. Relay-mediated inbound **is** the
  client-side volumetric defense, because it moves the addressable endpoint onto infrastructure that
  can have scrubbing in front of it.
- Terraform; parallelises cleanly with everything.

### `DOD-M15-RELAYONLY-1` — ❌ Relay-only routing is an operator setting
The feature half of the IP disclosure. A direct session reveals the operator's IP permanently, and
[[2026-06-11_1030_daemon-transport-architecture]] §7 already offers relay routing as the mitigation —
as a footnote. Promote it to a real setting, so the disclosure in `DOD-M15-DISCLOSE-1` is actionable
rather than a warning.

---

# Explicitly Beyond — deferred WITH a trigger, never dropped

Nothing here is out of the project. Each carries the condition that brings it back.

- **`DOD-M15-HOLEPUNCH-1` — repair hole punching.** Root cause identified: `@libp2p/tcp` has no port
  reuse, so DCUtR dials from a fresh ephemeral port and the NAT mapping is at the wrong address —
  what libp2p calls a punch is a **timed direct dial**, which succeeds only when the target was
  already dialable. Never once observed succeeding in production. Three unevaluated routes: patch TCP
  port reuse, adopt QUIC, adopt WebRTC. **Not launch-blocking** (relay-audit §H) because the relay
  cannot read relayed content, so the confidentiality claim survives while every cross-NAT
  conversation is relayed. **Trigger:** a dedicated research spike, scheduled after M15. **The
  frequency claim must be corrected regardless** — material citing an 80–90% direct-connection rate
  describes a mechanism that has never worked (`DOD-M15-LEDGER-1`).
- **Threshold on the relay-facing assignment.** Decision 4(a) chose to leave it and required it be
  recorded as a bounded property, which `DOD-M15-DISCLOSE-1` does. The (b)-vs-(c) choice — T
  signatures versus a directory-consortium threshold key that does not exist — is deliberately not
  made now. **Trigger:** the cryptographic-sortition work, when directory-side threshold mechanics
  are already open.
- **Cryptographic sortition.** Decided yes (T-of-N log Decision 3); sequencing open. It is
  availability and scaling, not hardening — its original motivating case was session-open, which the
  blocking signer check now covers regardless of T or N. **Trigger:** directory count needing to grow
  past what `majority(N)` comfortably supports; expected within a month or two of user growth. **New
  T-of-N-dependent work should assume sortition will eventually replace `majority(N)`**, and a
  cutover mechanism is expected rather than a flag-day switch.
- **Backup MERGE** — restoring onto a device that has its own live state. `DOD-M15-BACKUP-1` ships
  export + overwrite-restore. **Trigger:** the first operator who needs to restore without losing
  local state.
- **Multi-device (one identity, two devices)** — `DOD-PRIMARY-1`, `DOD-POLICY-1`, `DOD-PORTAB-1`.
  The launch intent's "your own two agents across devices" is two *identities* on two devices, which
  works. **Trigger:** demand for one identity on two devices.
- **`CELLO-REPL-001`'s remaining readers.** Its security-critical reader is pulled into
  `DOD-M15-SAMEOP-1`; the other three, and the column drop, stay. **Ordering is in the story and
  binds:** move the readers, confirm on a converged fleet, then drop the columns in a **separate**
  release.
- **`DOD-FLOOR-1`** — the trust-signal floor is built, unit-tested, and deliberately called by
  nothing. Correct for launch: any default would start refusing counterparties with no signals, which
  is everybody on day one. **Trigger:** the first operator who wants to be selective.
- **`DOD-END-WITHDRAW-1`, `DOD-END-INGRESS-1`, `DOD-END-QUOTA-1`.** **Trigger:** endorsement volume
  appearing. Of the three, quota has the safety edge (unbounded issuance) and is first to revisit.
- **`DOD-ACCOUNTS-EMAIL-CHAIN-1`** and the append-only-table test-isolation defect — recorded in
  `DOD-M15-CHAINHEALTH-1`, repaired separately.

---

# Decisions Carried

Rulings that bind every line above. **Re-asking one is decision theatre** (M15-PROCEDURE §🎭).

1. **The gate is a state, and everything is inside it** (Andre, 2026-08-21). Launch waits for M15 to
   close. Tiers are dependency order only; nothing is descoped for time; an item's presence in this
   document *is* its launch-blocking status.
2. **The seal wire change is in the gate**, on the migration argument rather than the security one —
   **and it pulls the content encryption in with it**, because the seal consumes the salt the key
   agreement produces and the seal items cannot be split.
3. **The unpublished investor and GTM material is not in M15.** Never made public, never sent;
   corrected after the milestone against what actually shipped.
8. **THE SESSION SALT: independently agreed, both sides contribute, persisted, one per session**
   (Andre, 2026-08-23 — supersedes #7 and corrects the "two outputs" half of #6).

   One exchange at session open agrees **two independent values**:
   - **the envelope key** — ephemeral, destroyed at close, exactly as `KEYAGREE-1` built it;
   - **the session salt** — agreed once, unchanged for the life of the session.

   Neither derived from the other, neither from the same secret.

   **BOTH SIDES CONTRIBUTE TO THE SALT AND TO THE ENVELOPE KEY. A requirement on both, decided, not
   open.** Each side sends a random contribution
   and the salt is derived from both in a fixed canonical order, so the two compute identical bytes.
   **Not initiator-minted:** the client is open source and a user can modify their own build, so a
   single minter can unilaterally destroy the property for BOTH parties — always send the same salt,
   or a low-entropy one — and every conversation that client has becomes guessable by any relay
   holding the hashes. The honest peer cannot detect it and never consented to it. Both-contribute
   means **one honest participant is enough**, and each side can verify its own contribution was used.
   Same principle as the sovereign-node rule: no single party can unilaterally break a guarantee.
   Refuse a peer contribution that is all-zero or the wrong length, exactly as the key agreement
   already refuses a degenerate peer key.
   **For the ENVELOPE KEY the requirement is already met, and this records HOW so nobody assumes it
   is met by accident.** X25519 ephemeral-ephemeral combines both sides' secrets: neither party can
   compute the result alone, and an honest party's fresh ephemeral keeps it unpredictable to any
   observer even if the peer reuses a fixed keypair. The one way a peer COULD have forced a
   degenerate shared value — a small-order point driving the secret to all zeros — is refused by
   `KEYAGREE-1`, loudly, per RFC 7748 §6.1. So the property holds and is enforced; it does not need a
   second mechanism bolted alongside. **If that refusal is ever removed, this requirement fails with
   it** — they are the same guarantee.

   **The rest of the salt rules:**
   - **PER SESSION, not per message.** A secret 32-byte salt already makes guessing infeasible;
     per-message would only hide which messages *within* a session are identical, which is marginal
     next to the count, timing, size and direction already visible. **Decided — do not re-raise.**
   - **Agreed at session open, BEFORE the first leaf is hashed.** Every leaf uses the same salt.
   - **PERSISTED in the session record.** On re-key after a restart: does this session already have a
     salt? Yes → use it. No → agree one. If it is not stored the lookup fails, a fresh salt is minted,
     and a restart silently splits the transcript — the exact defect being removed, triggered by a
     crash instead.
   - **NOT a key.** It decrypts nothing. Storing it forever costs and weakens nothing.
   - **Exchanged agent-to-agent**, where neither the relay nor any directory sees it. The relay cannot
     read agent content today, so this is an existing channel. It must NOT ride in anything a
     directory brokers.
   - **No epochs. No per-leaf salt attribution. One salt, one session.**

9. **HMAC-SHA-256, not SHA-256(salt ‖ message)** (Andre, 2026-08-23). The naive concatenation has a
   length-extension weakness; HMAC is the standard construction and the same shape to use.

10. **A SALT MISMATCH MUST BE LOUD** (Andre, 2026-08-23). This failure is the least debuggable shape
    there is — the send succeeds and the receiver discards silently (`wire-content-hash.ts`'s own
    header says so, and it cost two real daemons to find once already). So both sides compare a
    **fingerprint of the salt — never the salt** — at session start and refuse the session with a
    named reason if they differ. No silent discard loop because one side's salt did not survive a
    restart.

7. **~~The content salt is stored PER KEY EPOCH, not per session~~ — RETRACTED 2026-08-23.**

   **Superseded by Decision #8.** This was mine, and it was a correct answer to a question that
   should never have existed: epochs were needed only because the salt was derived from the ephemeral
   key, so re-keying moved the salt with it. Andre removed the coupling — the salt is now agreed
   independently and persists for the life of the session — so there are **no epochs, no per-leaf
   epoch attribution, and no lockstep switching**. Left visible rather than deleted, because a future
   reader who re-derives the coupling will re-derive this too, and the retraction is the warning.

   ~~Original text:~~ The content salt is stored per key epoch (mine, 2026-08-23, §3a — this is
   the open question raised under #6, ruled rather than left blocking. **Andre asked to be told:**
   this does not contradict anything he said; it answers the consequence he flagged.)

   #5 requires a revived session to RE-KEY, so its salt changes mid-session. One salt per session
   would verify only the leaves from the latest epoch and silently fail the rest of the transcript.

   **Why per-epoch is the least-reversing choice, and it is not close:** per-session is a strict
   SUBSET of per-epoch. A session that never re-keys has exactly one epoch and therefore one row, so
   per-epoch storage costs nothing in the common case. The reverse is not true: per-session cannot
   represent two salts at all, so the first re-key needs a schema migration on an operator's machine
   — the one kind of change this milestone treats as unrecoverable when it goes wrong.

   **What it obliges `SEALWIRE-1` to carry:** an epoch identifier on each leaf (or a range per
   epoch), so a verifier can tell which salt applies to which leaf. And per #6's third consumer —
   the receive-path authenticity check — the two sides must agree on the CURRENT epoch in lockstep,
   or every inbound frame fails `content_hash_mismatch`, which `wire-content-hash.ts` calls the
   least debuggable failure shape there is.

   **REDO > BLOCK:** if this is wrong the cost is dropping an unused column. If per-session were
   wrong the cost is a client-side migration.

6. **THE TWO KEY-AGREEMENT OUTPUTS HAVE DIFFERENT LIFETIMES** (Andre, 2026-08-23 — stated before
   `SEALWIRE-1` encodes anything, because after that it is a wire change).

   **Intent, restated so it cannot drift again: this layer is WIRE ENCRYPTION ONLY.** Anything
   travelling between two agents is unreadable to the relay or an interceptor, and CELLO can upgrade
   that to quantum-resistant on its own timeline rather than libp2p's. That is the entire goal.
   Once a message lands on the device it is decrypted for the model to read, and from then on it is
   **SQLCipher's** job.

   - **The message key NEVER touches disk**, and is destroyed at session close. That is the forward
     secrecy.
   - **The content salt IS a durable record field** — stored like any other column. It is not a key:
     it decrypts nothing, and HKDF is one-way, so possession of it does not lead back to the shared
     secret or to the message key. Storing it does not weaken forward secrecy.
   - **NO CELLO-level encryption of anything at rest in the local database.** SQLCipher is the
     at-rest layer, full stop. A second application layer buys nothing: anyone with full device
     access has the database key too, because it must be on the device for anything to work. The
     real answer is keys in the secure enclave, which needs a native app that does not exist yet.

   **Verified against the code before recording, per Andre's instruction.** The salt is genuinely
   needed downstream, and by MORE consumers than the two named:
   1. **Transcript verification.** `recordTranscriptMessage` stores plaintext; the leaf stores the
      content hash. Verifying "my transcript is what was sealed" means recomputing the hash from the
      plaintext. Today `wireContentHash` is `SHA-256(0x00 ‖ content)` — derivable from plaintext
      alone. Salted, it is underivable without the salt, and the transcript stops being
      self-verifiable.
   2. **Inclusion proofs — with a refinement.** The salt is NOT needed to build or check the proof
      itself: the leaf hash IS the stored content hash, and the proof is hashes and indices. It is
      needed for the proof to be *about a message* rather than about an opaque hash — binding
      plaintext to the leaf requires recomputing the hash.
   3. **The RECEIVE-PATH AUTHENTICITY CHECK** — the consumer nobody listed. The receiver recomputes
      the content hash on every inbound frame and rejects a mismatch (`content_hash_mismatch`).
      Salted, the receiver needs the salt for ordinary message delivery, not just for later
      verification.

   **⚠️ CONSEQUENCE THAT NEEDS ANDRE'S CALL, and it follows from Decision #5 rather than from this
   one:** if a revived session RE-KEYS, the salt changes mid-session. Leaves before the re-key are
   hashed under salt A and after under salt B, so **one salt column per session is not enough** —
   the transcript would verify for half its length. The salt has to be stored per KEY EPOCH with each
   leaf attributable to an epoch. Consumer 3 makes it sharper: both sides must switch salts in
   lockstep or every message fails the authenticity check, which `wire-content-hash.ts`'s own header
   calls "the least debuggable shape there is". **Not decided here.**

5. **Session ephemerals are NOT persisted; a revived session RE-KEYS** (mine, 2026-08-23, §3a
   — surfaced by `KEYAGREE-1` review F5. **Flagged for Andre**: it changes session revival, not just a
   crypto choice.)

   CELLO sessions survive daemon restarts, so the key agreement forces a fork the DoD line never
   named: persist the ephemeral secret so a restarted daemon can still read its own session, or do
   not, and make a restart leave that session's content unreadable.

   **Persisting is the irreversible harm.** It voids forward secrecy — the entire point of the unit —
   and puts key material in `sessions.db`, and therefore in every backup, for the life of the
   session. That does not remove harvest-now-decrypt-later; it moves it from the wire to the disk,
   where collecting it is easier. Once written to a backup it cannot be unwritten.

   **Re-keying is additive** and can be built when revival needs it
   (`DOD-M15-EPHEMERAL-REVIVAL-1`). REDO > BLOCK: if this ruling is wrong the cost is building the
   persistence path later; if persistence were wrong the cost is every key ever written.

4. **`DOD-M15-CLOSEWAIT-1`'s close contract: ANSWER ON COMMITMENT, NOT ON NOTARIZATION** (mine,
   2026-08-23, §3a — the line says *"decide the contract, then build"*, so here it is decided).

   `cello_close_session` returns as soon as the SEAL leaf is durably submitted, naming what happens
   next. The bilateral wait and the unilateral escalation continue in the background; the receipt is
   collected with `cello_get_sealed_receipt`.

   **Why this and not "keep blocking":** the blocking version cost real receipts. An operator watched
   a frozen command for 11m 06s, concluded it was broken, and force-abandoned **seventeen sessions**
   — forfeiting the exact notarized receipt the wait was earning. A UX failure destroying the core
   artifact is the definition of unforgivable at launch.

   **Why this is the least-reversing option — both safety nets already exist**, which is what makes
   it cheap rather than a rebuild:
   - `cello_get_sealed_receipt` is already a registered handler returning the same certificate.
   - a daemon that dies during the background wait finishes on its next start rather than orphaning
     the session. **CORRECTED 2026-08-23 after review:** this first credited `RestartSealResolver`'s
     `seal_interrupted_pending` branch. During the background wait the row is still `active`, so that
     branch never sees it. What covers it is the boot sweep flipping `active → interrupted,
     interrupted_by='local'`, which IS a branch the resolver walks — subject to `message_count > 0`
     and `restart_seal_gave_up_at IS NULL`. **The safety net is real; the mechanism named here was
     not, and this is the document a later session would have trusted without re-checking.**

   **What does NOT change:** the same inline escalation still produces the receipt, in the same
   order, from the same leaf. Only the IPC response stops waiting for it. Nothing about what is
   signed, by whom, or when is altered — that is deliberately outside a UX fix.

   **The counterbalance, named before the code:** answering early must not let an operator believe
   the session is sealed when it is only committed. The response says *committed, not yet notarized*,
   names the verb that fetches the receipt, and the session's own status must continue to read as
   sealing until it is not.
4. **Certified root moves to the content-hash domain** (relay-audit Decision 1(a)) — not
   `seal_attempt`, not a parallel reported root.
5. **The listening socket stays, gated on the assignment** (Decision 2). Removing it buys nothing on
   NAT traversal since punching cannot fire either way, and it is load-bearing for same-machine and
   same-LAN sessions.
6. **The relay verifies a presented credential; it does not query the directory** (Decision 3(b)).
   Preserves extractability and adds no per-request latency.
7. **Per-session ephemeral key agreement with a PQ hook, never static-static** (Decision 5(b)).
   Static-static would void forward secrecy the transport already provides.
8. **The sender's signature is stored per leaf** (Decision 6(b)) — a schema change is cheapest now
   and never gets cheaper.
9. **Relay corroboration is proactive** (T-of-N Decision 4) — it must not depend on a possibly-
   compromised client choosing to ask.
10. **Unilateral absence is hybrid and tiered** (T-of-N Decisions 1 and 2): 600s standard unchanged;
    high-stakes opt-in at 3600s with evidenced absence mandatory.
11. **`T = majority(N)` stands until sortition replaces it.** Do not propose all-N. Do not re-raise
    the threshold as an open question.
12. **A recommendation that survives only on backward-compatibility grounds is not a
    recommendation** — re-derive against an empty database. This reversed two first-pass
    recommendations in the spec-of-record and it will try to reverse more.
13. **The relay-linkability mitigation is WITHDRAWN, not relied on** (§3a ruling, Entry 1). Decision
    7 accepted the long-lived per-agent handle because spreading reservations across relays would
    erode it; measurement shows one relay carries 99% of an agent's reservations, so that basis does
    not hold. `DOD-M15-MULTIRELAY-1` is availability only, and the property is disclosed in
    `DOD-M15-DISCLOSE-1`. Making selection genuinely spread remains worth doing — as an improvement,
    never as the thing a claim rests on.
14. **The interrupted-seal proof runs against EXISTING agents** (Andre, 2026-08-21) — no pre-auth
    tokens, no throwaway registrations. Manage the side effect by choosing agents with no open
    sessions, verified before the run.

15. **A SALTED SENDER FALLS BACK TO UNSALTED AGAINST AN OLDER PEER — loudly, per message, never
    refusing the session** (§3a ruling, mine, 2026-08-23).

    I had been carrying this as Andre's call. It fails the decision-theatre test: **the record has
    already ruled it twice**, so presenting it as an open question was theatre, not deference.

    - `SEALWIRE-1`'s own version-discriminator AC says *"`content_salt IS NULL → unsalted` is a
      **legacy branch** and must announce itself."* A legacy branch that announces itself is a
      fallback with a voice. It is not a refusal.
    - The launch-triage lens settles the rest. The fundamental value is *two agents connect and
      communicate — including when you control only one of them.* Refusing on version skew breaks
      exactly that, for the exact population least able to fix it: the counterparty is someone else's
      agent, on someone else's upgrade schedule.

    **This is NOT the silent fallback the milestone exists to remove, and the distinction is the
    whole ruling.** A silent fallback is one where a missing thing is quietly substituted and the
    system looks healthy. This one is: an explicit `content_hash_alg` on the wire that the receiver
    reads and verifies under; a WARN naming the peer and saying the relay can confirm guesses at
    short messages in this session; and the session record marking itself unsalted so a transcript
    can never claim a protection it did not have. The operator is told; nothing is hidden.

    **What is refused, and this stays refused:** an *unknown* algorithm value. A peer naming
    something we cannot verify under is not a legacy peer, it is an unreadable one, and there is no
    correct way to hash for it. Absent → legacy; named-and-known → verify; named-and-unknown → refuse.

    **Least likely to need reversing**, which is the §3a test: the fallback is deletable the day the
    old builds are gone, and deleting it strands nobody. Refusing would strand real conversations
    from the day it ships, and the migration trap says a launch-time refusal is the expensive
    direction to reverse.

---

# Claims Ledger

*Built by `DOD-M15-LEDGER-1`. Rows are added as surfaces are swept; a claim with no row is an
unaudited claim.*

## Swept 2026-08-21 — `AUDIT-ME.md`, root of the PUBLIC `Mygentic-AI/cello-client` repo

**Five rows, ranked by what a hostile reader finds first.** Every one was measured by running the
document's own instructions against the tree — which is exactly what its name invites. → Entry 3.

| # | Claim, as written | Verdict | Disposition |
|---|---|---|---|
| 1 | Claim 3: *"outbound network connections **only** to the directory node … and to relay nodes … no telemetry endpoints … **or any other outbound HTTP calls**"* | **FALSE** | **withdrawn + rewritten with disclosure** |
| 2 | Claim 1: *"Message content is **additionally encrypted at the application layer** (AES-GCM envelope)"* | **FALSE as scoped** | **withdrawn + corrected** |
| 3 | Header: *"**All paths listed are valid** — packages were extracted … by REPOSPLIT-002"* | **FALSE** | **made true** |
| 4 | Verification cmd 1: `grep -r "plaintext" core/transport/src/  # should find nothing` | **wrong command, right code** | **made true** |
| 5 | Scope: the document audits network behaviour and never mentions `core/daemon/` | **structural gap** | **made true** |

**Row 1 is the one that matters and it is the worst artifact in the milestone.** The daemon makes
outbound HTTPS calls to **`https://api.telegram.org`** — `getUpdates` and `sendMessage` in
`core/daemon/src/telegram-bot-client.ts:27,42`. That is the doorbell feature: deliberate,
operator-configured, and the thing that reaches a phone. **Nothing about it is wrong except that a
public document says it does not happen.** And the document's *own* command 4 finds it —
`grep -rln "fetch(\|http\.request\|https\.request" core/*/src/` returns that file and only that
file. An evaluator following the instructions in a file called AUDIT-ME reaches a false claim in
about ten seconds.

**Write the replacement forward-safe.** `core/gateway/src/detect/deberta-model-manifest.ts:16`
carries `https://huggingface.co/…` as the classifier's download base. It has no production caller
today (`DOD-M15-SCREENINSTALL-1`), so it is not currently a destination — but it becomes one the
moment that line ships, and a claim that has to be rewritten again then is a claim written wrong now.

**Row 2** is the miscited-evidence case. Live content is plaintext inside libp2p's Noise session;
only *parked* content carries an application-layer AES-GCM envelope. The document cites
`core/client/src/client-backup.ts` — the **database backup** file — as evidence for *message*
encryption, which is a different thing entirely, and that path does not exist either.

**Row 3, measured:** four of the eight cited paths are gone —
`core/adapter-claude-code/src/server.ts`, `core/client/src/client-backup.ts`,
`core/client/src/client.ts`, `core/protocol-types/src/envelope.ts`. **`core/client/` does not exist
at all**; the surviving four are `core/crypto/src/ed25519.ts`, `core/transport/src/node.ts`,
`core/transport/src/types.ts`, `package.json`. The document asserts its own correctness in its
opening paragraph and is wrong.

**Row 4:** the command returns 5 hits — all of them comments and tests *asserting that plaintext is
absent* (`// Noise ONLY — no plaintext. SI-001.`). **The code is right and the instruction is
wrong**, which is the whole shape of this document: true claims, proved badly. Rewrite the command
so a correct tree produces the result the document predicts.

**Checked and NOT a finding**, recorded so it is not re-raised: `code.claude.com` and
`hermes-agent.nousresearch.com` appear only in a doc comment and an install-hint error string, not
as outbound calls; `docs.cello.dev` — which would breach the one-domain rule — appears only inside
an illustrative comment in a test file, and nothing ships it.

---

## Swept 2026-08-21 — `README.md`, same public repo

| # | Claim, as written | Verdict | Disposition |
|---|---|---|---|
| 6 | Headline ¶1: *"each conversation produces a tamper-evident, bilaterally-sealed audit trail that **both parties can independently verify**"* | **FALSE today** | **made true** by `DOD-M15-SEALWIRE-1` |
| 7 | Headline ¶1: *"relayed as encrypted blobs the relay cannot read"* | **TRUE** | verified, no action |
| 8 | *"A session name is **private to you** — never sent to the counterparty, the relay, or the directory"* | **TRUE** | verified, no action |
| 9 | *"`standing_receiver_ready` on its own is true even for a receiver no relay would grant a circuit reservation to — behind NAT, that agent is dialable by nobody"* | **TRUE** | verified, no action |

**Row 6 is the first paragraph of a public repository**, and it names the one property the relay
audit found nobody holds: **the receipt is not bound to the transcript.** A party can verify the
directory signed *a* root; it cannot verify that root is *its conversation*, because the client
takes the sealed root off the wire, checks the signature, stores it, and discards the root it
computed one step earlier. "Independently verify" is exactly the word that does not survive.

**Scope discipline, carried from the audit and not to be inflated:** no working attack against the
seal was demonstrated. The statable property is that the receipt is not bound to the transcript and
nothing would say so if the two diverged. The row is a claim defect, not an exploit.

**Disposition is made-true rather than withdrawn** because `DOD-M15-SEALWIRE-1` is inside the gate
and makes the sentence true. It must not ship before that line lands — a claim that becomes true is
still false until it does.

**Rows 7–9 were checked, not assumed**, and all three hold. Row 8 verified structurally:
`session_name` appears in **no** wire type in `core/protocol-types/src`. Recorded so a later sweep
does not re-open them.

---

## Swept 2026-08-21 — shipped skill prose and MCP tool descriptions

**These ship inside the npm package to every operator, and they carry the product's strongest
safety claim in its most unqualified form.** All four say screening is ACTIVE, without distinguishing
the character-denylist layer (live) from the semantic layer (not installable anywhere).

| # | Claim, as written | Where | Disposition |
|---|---|---|---|
| 10 | *"Content screening **is active**, in both directions. Inbound messages are screened before they reach any reader"* | `plugins/cello/skills/setup/SKILL.md:150` | **withdrawn**, then made true |
| 11 | *"content screening is the boundary, and it is **ACTIVE** in both directions at every tier"* | `plugins/cello/skills/cello/SKILL.md:205` | **withdrawn**, then made true |
| 12 | *"It does NOT change content screening, which is **ACTIVE at every tier** … a higher tier never buys less screening"* | `cello-mcp.ts:230` — a shipped **tool description** | **withdrawn**, then made true |
| 13 | *"CONTENT screening (prompt-injection defense) **IS live** as of DOD-M9B-WIRE-1"* | `cello-mcp.ts:190` — source comment, public repo | **rewritten** (`DOD-M15-CLAIM-COMMENTS-1`) |

**Why these are false rather than merely imprecise.** Two independent findings undercut them:

1. **The semantic half cannot be installed on any operator's machine.** `installModel` has no
   production caller — no command, no dependency, not even optional — so the layer that judges what
   a message *means* reports OFF forever (`DOD-M15-SCREENINSTALL-1`). What is live is the character
   denylist, which exists for the crude cases. **Partially true is false**, and none of these four
   surfaces makes the distinction.
2. **Even the live half is bypassable on the direct path.** The relay audit's Finding 1 lands
   injected content *below the layer where all screening lives* — blocked contacts, per-sender caps
   and trust tiers all sit on the signalling channel and that path never touches them. So row 12's
   *"ACTIVE at every tier"* is doubly wrong: a stranger who never appears as a contact at any tier
   reaches the reader anyway, until `DOD-M15-FRAME-1` lands.

**Recorded because it is the mechanism, not the blame:** `setup/SKILL.md:156` documents its own
upgrade — *"This paragraph previously said screening was 'planned, not yet active'. That was true
when the paragraph was written."* The claim was deliberately strengthened when the denylist landed,
and the semantic half never arrived behind it. **That is how a claim outruns its code**, and it is
the argument for the ledger existing at all: the moment a protection partially lands is the moment
its claim needs a scope, not a promotion.

**Sequencing:** withdraw now (add the scope), make true when `DOD-M15-SCREENINSTALL-1` and
`DOD-M15-FRAME-1` both land. Withdrawal is not optional pending the fix — these are read today.

---

### Checked and NOT claims-ledger rows

- **The document content profile is advertised nowhere.** `content_profile` / `assurance_tier`
  appear in no shipped skill prose and no tool description. So `DOD-M15-DOCPROFILE-1` is a **feature
  gap only** — a setting that enforces nothing — and needs no claim withdrawn alongside it. Recorded
  because the reverse was assumed when the line was written.
- **The `documents` and `receptionist` skills and the receptionist agent** carry operational
  descriptions, not security guarantees. The two injection-adjacent lines (*"cannot wake you by
  claiming a field is urgent"*, *"the right response, never obeying them"*) are instructions to the
  reading agent about handling peer content, which is correct advice and not a system claim.

## Swept 2026-08-22 — CLI help and product status output

**Clean. No security claims on either**, recorded as a negative so the next sweep does not re-walk
them.

- **CLI help / command text** (`core/cli/src`) is operational description only. The claim-shaped
  words grep finds — *never*, *cannot*, *impossible* — are all in **source comments about
  implementation discipline** (`json-out.ts`'s *"never synthesize an `ok:true`"*, `cli-args.ts`'s
  argument-parsing rules). Instructions to maintainers, not assertions to a user, and accurate.
- **Product status output** (`cello status` / `cello_status`) reports state and names next actions.
  None of its guidance asserts a security guarantee.

> ### 🔴 THIS SENTENCE WAS WRONG AND IS THE REVIEW'S BLOCKING FINDING (2026-08-22 → Entry 14)
> **The sweep was NOT complete.** Three of four surfaces had unaudited claims, including two the
> section below declares clean. Missed: the CLI's *"tamper-proof"* and *"it would no longer match"*
> (`registry.ts:538,868`); **`core/adapter-claude-code/SKILL.md`, the file that ships in the npm
> tarball**, never walked; the README asserting screening is NOT active, false the other way; and the
> **public GitHub repo description** advertising four native adapters that do not exist.
>
> **Why**: completeness rested on a three-word grep — *never / cannot / impossible* — and none of
> *tamper-proof, ACTIVE, screened, encrypted, verifiable, notarized, proof* was in it. **A prose
> ledger is a chore that looks like a control.** The fix is `DOD-M15-CLAIM-SCANNER-1` below.

**Four live surfaces walked (INCOMPLETELY — see above):** the public repo (root docs, README,
comments), the shipped package (tool descriptions, skill prose, CLI help), product status output,
and shipped client documentation.

**The dispositions are assigned here; ACTING on them is other lines' work** —
`DOD-M15-AUDITME-1`, `DOD-M15-CLAIM-SCREEN-1`, `DOD-M15-CLAIM-COMMENTS-1`, `DOD-M15-DISCLOSE-1`,
and, for the made-true rows, the units that make them true.

**Seed rows, from the two investigations — not yet individually verified against the tree:**

| Claim | Where | Disposition |
|---|---|---|
| "content is additionally encrypted at the application layer" | `AUDIT-ME.md` (public repo root) | **withdrawn** — true only for parked content |
| four of seven cited file paths | `AUDIT-ME.md` | **made true** — paths resolve post-repo-split |
| inbound screening is active | status output, tool descriptions | **withdrawn**, then **made true** by `DOD-M15-SCREENINSTALL-1` |
| the document content profile protects you | tool description, skill prose | **made true** by `DOD-M15-DOCPROFILE-1` |
| "80–90% of connections are direct" | outward-facing material (not in M15) | **withdrawn** — describes a mechanism that has never worked |
| "no persistent endpoint to DDoS" | outward-facing material (not in M15) | **withdrawn** — structurally false; a gate is not a flood defense |
| relay assignment requires a threshold | trust-model prose | **disclosed as bounded** — one node signs it; reach stated in `DOD-M15-DISCLOSE-1` |
| a direct session is private to the two parties | shipped docs (absent) | **disclosed** — it reveals the operator's IP permanently |
| an agent's sessions are unlinkable across time | design record / Decision 7 | **disclosed as bounded** — one relay carries 99% of an agent's reservations and can correlate them (Entry 1) |

---

## Related Documents

- [[M15-PROCEDURE]] — the runbook; §0z the gate, §2b the four invariants, §1c the three enforcers
- [[M15-BUILD-JOURNAL]] — audit trail and evidence home
- [[2026-08-21_1906_relay-p2p-exposure-and-ephemeral-peer-id-audit]] — spec-of-record for Tiers 0, 2,
  4 and 5; seven ruled Design Decisions and the 39-item → 18-unit map
- [[2026-08-21_1135_tofn-decoupling-and-seal-integrity-gaps]] — spec-of-record for the seal-ceremony
  and unilateral lines; four ruled decisions
- [[launch-triage]] — source for Tier 3; read its header warning before trusting any status marker
- [[M12B-DEFINITION-OF-DONE]] — the work order inside `DOD-M15-SUBMIT-ID-1`
- [[end-to-end-flow]] — the canonical narrative every seal change reconciles against
