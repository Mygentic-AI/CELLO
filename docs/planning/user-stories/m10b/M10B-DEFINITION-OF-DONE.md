---
name: M10B Definition of Done
type: definition-of-done
date: 2026-07-28
milestone: M10B
status: active
topics: [m10b, endorsements, attestations, trust-signals, agent-issued, third-source, consent, definition-of-done]
description: >
  The yardstick for M10B (endorsements and attestations — the client-supplied source). M10 built the
  generic mint→notarize→deliver→present→verify→consume pipe and proved it generic with the zero-bump
  canary. M10B adds the THIRD raw-plaintext source (the client), plus the two mechanisms §15.3 admits
  as legitimate bumps — subject consent and issuer-side withdrawal — after which `endorsement` itself
  lands as a normal Type Playbook run. Carries the endorsement decisions imported from the 2026-07-27
  policy surface audit (D-19, D-22..D-27, D-29) plus M10B-D2..D8 (2026-07-28): the directory-mediated
  sealed submission queue, same_operator frozen in the hash, refusal-with-message, the pending-consent
  surface, the 100-per-rolling-30-days account quota, endorsement-not-attestation, and no anonymous
  variant. Spec-of-record remains
  M10-TRUST-SIGNAL-STORAGE-AND-CREATION (§6 the three issuer flows, §7 intake, §15 zero-bump) +
  M10-TRUST-SIGNAL-TAXONOMY (Class 2).
---

# M10B — Definition of Done

## How to use this
- **Read [[M10B-PROCEDURE]] FIRST** — it is self-contained (read order, severity triage, reviewer
  dispatch lenses, publish/deploy sequencing, the design-note template, the watchdog crons).
- This is the **target**. Find the lowest-numbered line not ✅; that's the next unit.
- **Evidence discipline:** a flipped tag carries ONE line of evidence plus `→ Journal Entry N`. Full
  proofs and forensics live in [[M10B-BUILD-JOURNAL]]. This document stays a scoreboard.
- **Enforcers** (unchanged from M10): the fixture harness, the live journey across real processes, the
  CBOR cross-party hash test, and — new here — the **playbook-run proof** (Tier 5), which asserts that
  once M10B's machinery exists, the `endorsement` type itself required no further client or directory
  change.
- Every line carries **observability ACs**: named `domain.noun.verb` events, required context fields,
  correlationId threading, error-path coverage. Missing events are blocking. The lines below name only
  their *headline* events; **each unit's design note ([[M10B-PROCEDURE]] §6) names that unit's FULL event
  set before any code is written**, and the reviewer verifies the implementation against the design
  note. "The DoD line didn't list an event" is never a reason one is missing. Lines below name only
  their headline events; **each unit's design note ([[M10B-PROCEDURE]] §6) names the unit's FULL event
  set before code**, and the reviewer verifies against the design note, never against memory.
- Client-side lines ship via the publish cascade (/cello-publish); a line needing a published artifact
  is not ✅ until the published artifact works.

## Status legend
✅ PROVEN (enforcer-green) · 🟡 BUILT/UNVERIFIED-LIVE · 🟠 PARTIAL · ❌ NOT BUILT · 🅿️ PARKED ·
**➡️ MOVED** (out of M10B by the 2026-07-30 re-cut — text kept in place, ships in the
first-after-launch milestone; see the Re-cut block in the scope fence)

> **If the dev environment is hibernated** ([[M10B-PROCEDURE]] §2e — check with
> `dig +short directory-us1.cello.mygentic.ai`, `198.51.100.x` = hibernated), the only lines that
> cannot reach ✅ are the two needing the directory deploy (`DOD-END-QUEUE-1`, `DOD-END-REVOKE-2`) and
> anything needing the deployed portal. They go 🟡 with the deploy recorded as owed. **Everything else
> still reaches ✅, including the live journey and the playbook run** — their enforcer is the local
> spine harness (real processes on localhost), not deployed AWS. No AWS mutation while hibernated.

---

## Orientation — what is actually new (read this before any line)

**This is the section that prevents the milestone being mis-scoped.** The instinct is to describe
endorsements as "a new issuer" with new keys, new authority, and a new chokepoint. That is wrong, and
spec §6's 2026-07-11 amendment says so directly: *"all three flows route through the portal backend at
launch… the directory never composes signals at all — and its authorized-issuer key set collapses to
portal keys."*

### The correct frame: one mint, three raw-plaintext sources

The pipe is universal and already built: **compose the payload → scan → hash (canonical CBOR) → signed
submission → directory stores the hash and replicates → deliver the plaintext envelope to the holder →
holder presents → recipient re-hashes, checks membership, consumes with `issuer_kind` framing.** Every
signal that exists today runs on it. What differs between signal families is *only* where the raw
plaintext came from before it entered the pipe (spec §6, "The three issuer flows"):

| Source of the raw fact | Who researches / supplies it | Examples | State |
| :-- | :-- | :-- | :-- |
| **The portal itself** | portal verification code — OAuth, verification flows, its own security records | `github`, `phone`, `email`, WebAuthn/TOTP | ✅ built (M10 Tier 1, Tier 4) |
| **The directory** | portal background job over a directory **read** path; the directory supplies raw history, the portal mints | `track_record`, `external_track_record` | ✅ built (M10 Tier 3 — `DOD-DIRDATA-READ-1`) |
| **The client** ← **THIS MILESTONE** | an operator's agent supplies the raw plaintext; the portal still mints | `endorsement`, and the attestation family after it | ❌ |

**In all three the portal mints, the directory stores the hash and passes it on.** M10B adds a third
inbound arm to the portal's mint function. It does not add an issuer, a signing key, a chokepoint, or a
new **notarization** path.

It *does* add one transport surface — the `M10B-D2` **sealed submission queue** — and the distinction
matters, because "no new write path" read literally would forbid the thing this milestone is built on.
The queue is the mirror image of the M10-D22 sealed pickup transport: the directory carries a blob it
cannot read, in the other direction. Nothing new writes to `signal_records`; the signed-submission
chokepoint stays unique, and the directory still composes nothing.

### Why this is nevertheless not a pure Type Playbook run

[[M10-TYPE-PLAYBOOK]]'s zero-bump contract: *"if any step below requires touching cello-client or
trustless-cello, STOP — that is not a playbook run, it is a bug in the generic machinery."* M10B touches
both. That is **not** an INV-ZERO-BUMP violation, and the distinction must be held precisely or the
milestone will be argued about forever:

> The bump is **not driven by the type**. It is driven by two new *mechanisms*, which spec §15.3 already
> names as legitimate bumps ("a new floor-predicate *kind*, or a new presentation *mechanism*"):
>
> 1. **Consent** — an object authored by a third party can now land in your wallet unbidden, so
>    presentability requires the subject's explicit acceptance (D-23). Nothing in M10 had this state,
>    because every signal you held was minted about you, for you, at your own action.
> 2. **Issuer-side withdrawal** — the party who created it, not the subject and not the portal, can
>    retract it, and the retraction must reach people who already hold a copy (D-19). M10's revocation
>    is role-based portal authority; this is a different authority model.
>
> Consequence, and it is a hard AC: **the M10B diff must contain no `switch(type)`, no type enum, no
> `CHECK` on `type`, and no per-type column.** Every new construct keys on `issuer_kind`, on the consent
> state, or on the issuer's identity — all of which are already data. If a line cannot be built without
> testing for the literal string `endorsement`, that line is designed wrong. See `DOD-END-INV-ZEROBUMP`.

### What follows from the content being client-authored

Portal-composed payloads are structured and trusted by construction. Client-supplied plaintext is
"free text authored by another operator — the one genuine injection surface" (§6). Every remaining line
in this milestone is a consequence of that one sentence, plus the consent mechanism above:
scan-before-hash at intake, the attested-wrapper/quoted-words payload split, the same-operator branch,
the count predicate, and the tier-signed rendering.

## Scope fence

**IN:** the client→directory→portal ingress (`M10B-D2`); intake scanning; the issuance quota
(`M10B-D6`); the consent mechanism (deliver → pending-consent queue → accept/refuse-with-message →
presentable); issuer-side withdrawal and its propagation; issuer-suspension cascade; the same-operator
rules (D-27, D-29); floor/count handling; the operator surface; `endorsement` as the first type through
the new arm, proven live.

**OUT (parked below):** PSI and endorser-overlap; substitution logic (blocked on policy D-12, tabled);
the endorsement *request/negotiation* flow (Bob endorses unprompted for v1); **editing** an issued
endorsement (refuse-and-reissue is the v1 correction loop, `M10B-D4`); multi-hop referral, the referral
callback loop, and the wider commerce family; per-node intake (launch is portal-routed by the §7
amendment, deliberately).

> **Changed 2026-07-28:** issuance rate limiting moved from OUT to IN — Andre, answering the open
> question directly: *"Okay, but the other one I really need."* It is now `DOD-END-QUOTA-1`.

### 🚨 RE-CUT 2026-07-30 — the scope fence moved. Read this before pulling the next red line.

Source: [[2026-07-30_m10b-scope-and-cost-review]]. **The fence is now the live journey: if
`DOD-END-JOURNEY-1`'s cases cannot observe a line failing, it is not launch scope**
([[M10B-PROCEDURE]] §5d). Two calls from Andre on 2026-07-30, both recorded verbatim in intent:

- **The issuance quota moves to first-after-launch.** Asked whether to ship the cap now given it sits
  behind the agent→account lookup *and* a safe account-linking flow (the existing function is an
  authorization bypass), Andre chose **first thing after launch**. Nothing on the wire changes — the cap
  is portal-side enforcement — so there is no migration trap in deferring it, and at alpha with one
  issuer there is nobody to farm endorsements. This **reverses the 2026-07-28 move above**; it does not
  reverse the decision that we need the cap.
- **Withdrawal ships as "takes effect for every future session."** Asked whether that is enough for
  launch versus building the between-session re-check for already-stored copies, Andre chose **new
  sessions is enough**. The re-check is a fast-follow. A stale stored copy is a papercut at this scale;
  a withdrawal that does not stop future sessions would be a trust break, and that half already works.

**MOVED OUT — first-after-launch milestone.** Each line keeps its text below, tagged `➡️ MOVED`, so the
reasoning survives the move: `DOD-END-QUOTA-1` (with `DOD-END-ACCOUNTLINK-1` and `M10B-D18`'s
agent→account route as one coherent unit — the cap is unbuildable without them and they are unsafe
half-built), `DOD-END-SUSPEND-1`, `DOD-END-FLOOR-2`, `DOD-END-TIER-1`, `DOD-END-ACCOUNTABILITY-1`,
`DOD-END-PLAYBOOK-1`, journey case **(d)**, the stored-copy re-check half of `DOD-END-WITHDRAW-1`, the
policy-engine WIRING behind `DOD-END-COUNT-1`, and the tier-sign presentation half of
`DOD-END-RENDER-1`.

**Why those and not others** — the floor/tier/count group is *recipient-side trust policy*, a different
concern from the endorsement pipeline this milestone is, and the milestone proved it the hard way:
`evaluateSignalPolicy` has **zero production callers**, so endorsement-aware rules were being written
for an engine nothing invokes. Wiring it needs an operator-facing policy source and opt-in defaults —
its own unit. The quota and suspension are abuse controls against an attacker who cannot exist at alpha.

**NOT DELIVERABLES — removed from the scoreboard entirely:** the five Tier I invariant lines (now
lenses, above) and `DOD-END-ARCH-1` as a status-tagged line (a determination is a phase, not a unit —
[[M10B-PROCEDURE]] §6a; it stays below marked ✅ for the historical record only).

**M10B CLOSES ON:** the client→directory→portal ingress, intake scanning, self-endorsement refusal,
delivery, the pending-consent queue, accept/refuse with the optional message, the agent-scoping fix, the
revoke-authority fix, quoted-untrusted rendering, the landed operator-surface clauses plus the refusal
readback, the submitter return path, and the live journey's core job + cases (a), (a2), (b), (c).

---

## Tier I — Invariants (properties, NOT deliverables — no status tags)

> **CHANGED 2026-07-30 by the scope & cost review. These five carried ❌ tags and should never have.**
> An invariant is a property every unit must not violate — you do not *build* it, so it cannot be a
> deliverable, and a status tag on one reads as unfinished work that no unit can ever finish. They are
> **enforced per-unit as reviewer lenses**, which is where they were already being caught all along:
> [[M10B-PROCEDURE]] §2b. Stated once here, with no tags, because the DoD is the yardstick and they
> are the yardstick's fine print. Full text of each lens is in §2b; the one-line statements follow.

All M10 invariants (`DOD-INV-DIR-DUMB`, `-CHOKEPOINT`, `-ZERO-BUMP`, `-TYPE-CARRY`, `-CANONICAL`,
`-AGENT-SCOPED`, `-FRAMING`, `-NO-SCORE`, `-STATELESS-RECIPIENT`) continue to hold unchanged. These are
the additions M10B is accountable for.

- **ZEROBUMP** — no type-shaped construct anywhere: no `switch(type)`, no type enum, no `CHECK` on
  `type`, no per-type column, no branch on the literal `"endorsement"`. Every new construct keys on
  `issuer_kind`, the consent state, or the issuer's identity.
- **ATTRIBUTION** — `issuer_pubkey` is bound to the **authenticated** identity that supplied the
  plaintext, never accepted as a caller-supplied field. Precedent: `accepting_node` in
  `DOD-DIR-WRITE-1`. Trust a claimed `issuer_pubkey` and anyone can mint an endorsement attributed to
  anyone — a lie the hash then makes permanent.
- **CONSENT** — nothing about a subject is presentable, discoverable, or countable without that
  subject's explicit acceptance (D-23, D-24). A refused or pending endorsement is indistinguishable, to
  every third party, from one that never existed. **The issuer is not a third party**: Bob knows what he
  issued, and `M10B-D4` lets Alice tell him at her option.
- **UNTRUSTED** — endorsement plaintext reaches a consuming LLM only as quoted-untrusted ("Bob says: …"),
  never in the portal's attested voice. M10's `INV-FRAMING` applied to the first content that needs it;
  `issuer_kind` is inside the hash (§4), which is what makes the framing unforgeable.
- **NO-SELF-STANDING** — an operator cannot manufacture standing for themselves. Account-subject
  self-endorsement is refused at intake; agent-subject same-operator endorsement is minted, flagged, and
  excluded from every count predicate (D-27, D-29). Quality capping without quantity capping is not
  sufficient.

---

## Tier 0 — The determination (gates every build line)

> **NOT A DELIVERABLE — kept below for the historical record only (2026-07-30 review).** A determination
> is a **phase**, not a unit: giving it a status tag turned an unbounded polish loop into something that
> looked like an unfinished deliverable, and it consumed an entire overnight session across four review
> passes plus a fifth that died unread, shipping zero code. The rule that replaces it is
> [[M10B-PROCEDURE]] §6a — **one review pass, two is the cap, then remaining findings become ACs on the
> units that build them.** Future milestones: journal entries and a completion note, no DoD line.

- **DOD-END-ARCH-1** — **the design determination, written before any code, reviewed like any unit.**
  Written AGAINST spec §6 (three issuer flows + the 2026-07-11 amendment), §7 (intake), §15 (zero-bump),
  and the decisions section below. Must settle, with evidence from the code as it actually is:
  - **The ingress shape — DECIDED, see `M10B-D2`. Do not re-open it; build against it.** Bob's daemon
    signs the submission with his agent key, seals it to the portal's intake key, and writes it to a
    directory node; the portal drains, verifies the signature, derives `issuer_pubkey` FROM that
    signature, scans, and mints. What this unit still owes is the *detail*: the queue table shape, the
    drain's ack/poison semantics (a submission that fails the scan must leave the queue, exactly once,
    with its reason preserved), and the retention rule for drained rows.
  - **How the daemon learns the portal's intake encryption key** (opened by `M10B-D2`, and the one
    genuinely new distribution problem it creates). The manifest is the natural channel — it is already
    the client's trusted, polled source of node-level facts — but nothing in it carries a portal key
    today. Settle: where the key lives, how rotation works without stranding queued submissions, and
    what a daemon does when the key is absent (per §5a **ABSENT IS NOT FINE**: refuse to submit and say
    why — never fall back to sending unsealed).
  - **The payload split.** Playbook §2 says the plain-language `claim` is "composed BY THE PORTAL stating
    what was verified, how, and when." For an endorsement the portal verified *nothing about the
    assertion* — only that an authenticated operator said it. So the payload needs an explicit two-part
    shape: the portal's **attested wrapper** (who said it, when, that they were authenticated, the
    same-operator fact) and the endorser's **quoted words** (untrusted, scanned, never restated in the
    portal's voice). Getting this wrong is how `DOD-END-INV-UNTRUSTED` dies quietly.
  - **How the endorser names the subject.** Bob holds Alice's *agent* pubkey — that is what a contact
    is. For `subject_kind: agent` that is the subject. But journey case (c) requires **account**-subject
    submissions to reach intake, and Bob holds no account identifier for Alice: the directory is
    hash-only by design ([[project_no_pii_in_directory_hash_only]]) and there is no account handle on the
    wire. Settle how an account subject is named — the working answer is that Bob always submits the
    agent pubkey he actually has plus the `subject_kind` he intends, and the **portal** resolves agent →
    account at intake, so no new identifier is invented and no account handle ever crosses the wire.
    Confirm that resolution exists before relying on it.
  - **Where `same_operator` lives — DECIDED, see `M10B-D3`: inside the hash.** What this unit owes is
    the wording and the composition point: a neutral one-line fact ("endorser and subject are owned by
    the same account"), composed at intake before hashing, consistent with scan-before-hash. Note the
    accepted residual: operator linkage is **not** permanent
    ([[2026-04-14_0700_agent-succession-and-ownership-transfer]]), so a frozen fact can go stale after an
    ownership transfer — it reads as of the mint date, which travels with it (D-26).
  - **Where the consent state lives.** Constrained by `M10B-D5`: the pending-consent items are a
    surface of their OWN, not the transcript inbox. Settle whether that is a consent column on
    `wallet_trust_signals` (M10-D4) with the queue as a view over it, or a separate pending table that
    promotes a row on acceptance. Must not violate `INV-AGENT-SCOPED`, and the queue must be named and
    keyed by **consent state**, never by type (`INV-ZEROBUMP`).
  - **Naming — SUPERSEDED 2026-07-31 by Andre's direct call.** `endorsement` remains the only WIRE
    TYPE STRING (unchanged, nothing on the protocol moved). But "attestation" **now IS in code**, as
    the operator-facing verb family: `cello attestations issue|issued`, `cello attestation-consent`,
    `cello_attestations_*`. Reason: an attestation is a PERSON vouching for a PERSON, a trust signal
    is the NETWORK verifying an attribute — same bytes, different affordance, and burying the
    person-to-person primitive under a wallet listing hid the one capability collaboration rests on.
    Do NOT "restore" the old naming. Original `M10B-D7` text follows for history:
    `endorsement` stays the only type string; "attestation" stays
    a design-vault word and does not enter code. The code's name for the family is `issuer_kind: agent`.
    Scope of any doc cleanup: the M10B documents and [[M10-TYPE-PLAYBOOK]] ONLY — do not sweep the vault.
  - **Expiry.** D-26 gives endorsements no expiry, which is a deliberate exception to Playbook §0's
    "validity window: `expires_at` policy." Confirm `expires_at: null` flows correctly through
    `DOD-VERIFY-1`'s freshness path (spec §14.7) rather than being read as already-expired.
  - **WRITTEN 2026-07-28 → Entry 4. REVIEWED, FOUR BLOCKING FINDINGS → Entry 7. ✅ CLOSED 2026-07-31
    — Andre's triage.** This line gated Tier 1. Tier 1 was built, shipped and proven end to end
    (`DOD-END-JOURNEY-1`, 10/10 hops), so the gate cleared in practice and nobody walked back to flip
    it. Every finding is resolved below: the notarization path needed no work, expiry closed with no
    work, the intake key rides the manifest, and the `INV-UNTRUSTED` projection change is proven live
    at J-END hop 5 — CELLO's `claim` does not contain the issuer's sentence; his `statement` is
    verbatim, flagged, and attributed to his key. **Original text follows.** The reviewer independently re-derived every code claim in Entry 4 and **all of them
    held**; the findings are against the *decisions*. Standing: the **notarization path needs no work
    at all** (the portal stays the only submitter — the §4 first-action question dissolves rather than
    being answered); `DOD-END-INV-UNTRUSTED` **needs a projection change no DoD line owned**
    (`M10B-D13`); the intake key rides the manifest (`M10B-D11`); expiry closes with no work
    (`trust-signal-store.ts:437`). Directory is at V48 → the queue is **V49**,
    `OpsAgentExpectedMigrationVersion` → **49**.
    **Corrected by the review — do not read Entry 4 alone:**
    - **The account-subject naming clause was declared settled and was never addressed.** The
      resolution does not exist; it is `M10B-D18`, and it blocks four lines.
    - **Revoke authority** → `M10B-D12r`, because `M10B-D12` made every agent-issued withdrawal
      silently inert (Bob is not a `submitter`, so the portal signs and the predicate never matches).
    - **Consent state** → `M10B-D14r`; `M10B-D14`'s `DEFAULT 'accepted'` was fail-open and violated
      §5a directly.
    - **The submitter return path** was missing entirely → `M10B-D19`. "Nothing parked" in Entry 4 was
      wrong.
    **THREE REVIEW PASSES, ALL "DO NOT FLIP" (Entries 7, 10, 14). Read the decisions, not this
    summary — many are on their second or third revision.**
    **THE COMPLETE SUPERSESSION LIST — build ONLY the right-hand side:**
    | superseded, do not build | build this |
    | :-- | :-- |
    | `M10B-D12`, `D-12r`, `D-12r2`, `D-12r3` | **`M10B-D12r4`** |
    | `M10B-D14`, `D-14r` | **`M10B-D14r2`** |
    | `M10B-D19`, `D-25`, `D-25r` | **`M10B-D25r2`** |
    | `M10B-D26`, `D-26r` | **`M10B-D26r2`** + the new **`DOD-END-ACCOUNTLINK-1`** |
    Where an earlier revision is cited by name elsewhere in this file (e.g. "`M10B-D12r3`'s read-time
    defense", "`M10B-D25r`"), read it as the **current** revision from this table — the reasoning
    carries forward, the shape does not. Structurally, each replacement is a blockquote nested under
    the bullet it replaces, so the heading you see first is the superseded one.
    **The four items still open before this line can go ✅** (third review, Entry 14):
    1. ~~**F3**~~ — **CLOSED (Entry 15).** `D-12r4` re-measured **inside V46's real `CASE`**: nine
       shapes, eleven rows, **exactly one changes and it is the F6 defect**. The revoke-before-
       supersession ordering is proven by the revoked-and-superseded case, which the fragment fixture
       could not reach — V46's supersession branch is a correlated `EXISTS`, not an aggregate.
    2. **F1** — `submission_results` PK gains its node component (`D-25r2`), or a natural-key duplicate
       through the designed failover path wedges **all** federation.
    3. **F4** — **`DOD-END-ACCOUNTLINK-1`**, a real line with ACs. Wiring `linkAgentToAccount()` as-is
       is an **authorization bypass on the kill switch** (fourth review HIGH-1, verified in the
       function body): no ownership check, and `resolveAccountId` creates accounts.
    5. **HIGH-2** — `submission_results` must join `PUBLICATION_TABLES`, or the return path builds
       complete and silently delivers nothing.
    6. **MEDIUM-1/2** — `D-12r4`: decide the `issuer_kind='directory'` shape, and state the
       monotonicity change while amending V46's header in the same migration.
    4. **F5** — `DOD-END-SCOPE-FIX-1` rescoped to the agent-subject half; the account-subject half needs
       a decision on where the daemon gets its own `accountId`.
    **Closed and verified across the three passes:** the notarization path needs no work; the intake key
    rides the manifest; `expires_at: null` is safe (cite `listAllActive`, **not** the dead
    `listPresentable`); an unknown inbound frame is **ignored, not fatal**, so a new frame kind is
    genuinely additive; the withdrawal carrier (`D-28`). **Parked for Andre:** `DOD-END-DISCOVER-1`.
    **CLOSED 2026-07-29 — `M10B-D29`. Every one of the four remaining items is now an AC on the unit
    that builds it, which is what the review cap prescribes; none was left unowned.** F1 → `M10B-D25r2`'s
    authoritative table (`DOD-END-INGRESS-1`); F4 → its own line `DOD-END-ACCOUNTLINK-1`; HIGH-2 → the
    `PUBLICATION_TABLES` clause on `M10B-D25r2`; MEDIUM-1/2 → `M10B-D12r4` (`DOD-END-REVOKE-2`); F5 →
    the rescope, now BUILT (`DOD-END-SCOPE-FIX-1`). Four completed passes, and the fourth reviewer's
    own read was *"none of that needs a fifth measurement pass."* → Entry 21. — ✅

---

## Tier 1 — The third source: client → directory → portal ingress

- **DOD-END-SUBMIT-1** — **the daemon side of the sealed submission queue (`M10B-D2`).** Bob's daemon
  composes `(subject_kind, subject, plaintext body)`, **signs it with his agent key**, seals the whole
  submission to the portal's intake key, and writes it to a directory node over the channel that already
  exists — with the standard failover across nodes, since submission must not die on one node being
  down. The daemon never talks to the portal directly, and never sends unsealed (`ABSENT IS NOT FINE`:
  no intake key → refuse, name the reason). Named events: `signal.submission.sealed`,
  `signal.submission.queued`, `signal.submission.refused` (+ cause).
  > **BUILT + REVIEWED 2026-07-29 — 🟡.** Three layers: the wire contract in `@cello-protocol/
  > protocol-types` (array TBS, `CELLO-SUBMIT-v1`, closed field set, content-derived
  > `submission_id`), `signal-submission.ts` in the daemon (compose → sign → seal → send, four named
  > refusals, no code path that emits unsealed), and the `submission_write` frame + handler in the
  > directory. INV-ATTRIBUTION is enforced by the ABSENCE of a parameter and pinned by a
  > **compile-time** guard in the source (a `@ts-expect-error` in a test would assert nothing —
  > `src/__tests__` is excluded from typecheck). Review found 8; all fixed, including a broken ack
  > correlation, an over-certain error message, and two hollow tests. → **Entries 22, 26, 27**.
  > **`M10B-D32`: "standard failover across nodes" is the SignalingManager's reconnect** — there is
  > no client-side multi-node write path, verified. **ONE AC handed forward, blocking on `DOD-END-SURFACE-1`:**
  > nothing retries yet (the safety property is real but has no caller). **The intake-key AC is
  > CLEARED — 2026-07-31, Entry 43:** the keypair is provisioned and the manifest signed in three
  > regions, and a live submission returns `intake_key_id: "intake-dev-1", stored: true`, so
  > `intake_key_absent` no longer fires against a real manifest. The directory deploy and the
  > protocol-types publish are both done. Still 🟡 — for the retry AC alone, not for four reasons. — 🟡
- **DOD-END-QUEUE-1** — **the directory side: a mailbox it cannot read.** A queue table holding the
  sealed blob, its recipient (the portal intake key id), and delivery bookkeeping — **no plaintext, no
  payload, no subject, no PII**, exactly the `DOD-DIR-WRITE-1` / M10-D22 posture, and a test asserts the
  absence on the schema. Notarization is untouched: nothing here writes `signal_records`, and the
  directory composes nothing (`INV-DIR-DUMB`). Rides the one batched directory deploy with
  `DOD-END-REVOKE-2`; a new Flyway migration updates `OpsAgentExpectedMigrationVersion`.
  > **BUILT 2026-07-29 — `V51__submission_queue.sql` + `submission-queue-repository.ts` + 8 green
  > integration tests** (`m10b-queue-1-v51-submission-queue.test.ts`, run against real Postgres).
  > **Renumbered V49 → V51:** V49 and V50 were already claimed by the M12 anti-entropy branch, which
  > had applied V49 to the shared local `cello_dev` — an M5-rule-4 collision that only Flyway's
  > checksum check caught. `M10B-D23`'s delivery fix moves to **V52**. → **Entry 20**.
  > Green: exact four-column set; no submitter/subject/kind/type/payload/reason column under any name;
  > absent from `PUBLICATION_TABLES` (with a positive control); **no UPDATE grant** — found by the test
  > itself and now load-bearing, since it makes "first writer of an id wins" a database property rather
  > than an `ON CONFLICT` intention; retry-is-a-strict-no-op under mismatched bytes; oldest-first drain;
  > intake-keys-in-use (rotation retention's input); idempotent delete; sweep taking only aged rows.
  > **✅ DEPLOYED 2026-07-29 ~10:05 UTC** — V51 live in all three regions, verified against each
  > regional database (`max(version)=54`, `bool_and(success)=true`), not inferred from pipeline
  > status. `OpsAgentExpectedMigrationVersion` needs no edit: `deploy.sh` computes it dynamically
  > from the highest migration file and overwrites SSM, so the CFN default is ignored (verified in
  > the script). Migration numbering with the M12 branch is settled — they own V49/V50, this branch
  > owns V51–V54, V55 next free. — ✅
- **DOD-END-INGRESS-1** — **the portal drains and mints.** The third arm of the portal's mint function:
  drain the queue, open the seal, **verify the submission signature and derive `issuer_pubkey` FROM it**
  — never from a request field (`DOD-END-INV-ATTRIBUTION`) — then scan, compose, and hand off to
  `mint.ts` + `submission-signer.ts` unchanged from there on. Sits alongside the existing two arms
  (portal verification code; the directory read path `queryAccountFacts` /
  `GET /internal/track-record/...`). Drain semantics are exactly-once with the failure reason preserved
  to the submitter; a poisoned row leaves the queue rather than blocking it. Named events:
  `signal.ingress.drained`, `signal.ingress.authenticated`, `signal.ingress.rejected` (+ cause).
  > **BUILT + REVIEWED + PROVEN LIVE 2026-07-29 → Entry 38, J-END.** Directory drain/ack routes (read
  > and ack are SEPARATE: drain does not delete, so a crash mid-mint re-delivers rather than losing a
  > submission the operator was told was queued), the portal's drain loop, and an authenticated
  > trigger route. `J-END` hop 2 drives the REAL modules end to end — authenticate → dedupe on the
  > DERIVED id → scan → compose → mint → deliver → ack — against a live directory and Postgres.
  > 12 review findings fixed, the worst being that `op` was read for a log line and never branched
  > on, so a private refusal message would have been minted as a public endorsement.
  > **THREE CLAUSES GENUINELY UNMET, stated rather than rounded up:** nothing is preserved to the
  > SUBMITTER (`submission_results` / `M10B-D25r2` does not exist in either repo); `refuse` and
  > `withdraw` ops are recognised but left QUEUED pending their handlers; and account-subject
  > submissions are refused by name pending `DOD-END-SUBJECTKIND-1`. — 🟡
- **DOD-END-SCAN-1** — the deterministic intake scanner (spec §7): injection patterns (primary), secrets,
  constrained charset (a sentence — no control chars, no markup), length cap, URL handling. **Versioned
  and byte-identical**, and the version travels INSIDE the signed submission body — `DOD-DIR-WRITE-1`
  already makes `scanner_version` a signed field precisely because the directory cannot re-run the scan
  and a forged version "is a lie stored as evidence." Scan **before** hash, always: on fail reject, never
  clean-and-continue. Aligns with policy D-16 (concealment with no innocent use refuses on sight;
  legitimate encodings are decoded and judged).
  > **✅ 2026-07-30** — 9 tests cover injection/charset/markup/cap/version; the SECRETS clause had no
  > named test so it was checked directly (AWS key pair rejected, 222 rules). Live: the dev drain went
  > 500 → `minted:1` once `re2-wasm` worked, so the scanner is load-bearing on the real path.
  > NOT verified: D-16's decode-then-judge half. → Entry 41 — ✅
- **DOD-END-ACCOUNTABILITY-1** — submitter accountability on the graduated threshold of §7 constraint 3:
  **reject always** (fail-closed), but **flag as suspect only on a pattern** — repeated rejects, or a
  single egregious hit (a real credential, a clear injection payload) — never on one heuristic near-miss.
  A reputational penalty on a false positive is real harm; the two consequences keep different
  thresholds.
  > **➡️ MOVED 2026-07-30 — first-after-launch.** Rejection is fail-closed and already ships
  > (`DOD-END-SCAN-1`); this line is only the *flagging* half — an abuse control with no abuser at
  > alpha, and one whose false-positive cost is borne by real reputations. — ➡️ MOVED
- **DOD-END-SUBJECTKIND-1** — the same-operator branch, one deterministic check off the existing verified
  phone-stub operator linkage, branching on `subject_kind` (policy D-29):
  - `subject_kind: agent`, same operator → **mint and flag** `same_operator`. This is a co-ownership
    assertion, not a vouch; its worth is capped at the endorser's own tier to the recipient (D-27).
  - `subject_kind: account`, same operator → **refuse to mint.** Self-endorsement, with no
    recipient-relationship reading that rescues it; the verified email + phone baseline (policy D-8)
    already asserts everything it could.
  Default target is the specific agent unless requested and agreed (M10-D5). Supersedes the 2026-04-10
  log's blanket same-owner rejection, which is marked superseded there. The account-subject case depends
  on the portal resolving agent pubkey → account (`DOD-END-ARCH-1`); if that resolution is missing the
  mint is REFUSED with a named cause, never minted unflagged.
  > **✅ 2026-07-30** — all four clauses in `submission-ingress.ts`, 21 tests green: agent-subject
  > same-operator MINTS FLAGGED (live today — `co-own: own` on a real endorsement); account-subject
  > same-operator REFUSES as `same_operator_account_subject`; a missing agent→account resolution
  > REFUSES as `subject_not_registered` (also live). Revert-tested. D-27's tier CAP moved with
  > `DOD-END-TIER-1`. → Entry 42 — ✅
- **DOD-END-ISSUER-REGISTERED-1** — **the ISSUER must resolve in the directory, exactly as the SUBJECT
  already must.** An endorsement whose issuer the directory does not know is **REFUSED by name
  (`issuer_not_registered`)**, never minted. Raised 2026-08-10 from the launch-triage verification pass;
  it patches the expression `DOD-END-SUBJECTKIND-1` shipped, and until it lands that line's guarantee
  does not hold.
  **The defect.** `computedSameOperator` is a conjunction — `issuerAgent !== null AND subjectAgent !==
  null AND (account match OR phone-stub match)`. An unresolvable issuer makes the whole expression
  **false**, and false means *not the same operator*. So an input the portal could not evaluate is
  recorded as a decision that it evaluated and cleared. That is a fail-open on the one check
  `INV-NO-SELF-STANDING` rests on, and the false answer is then **pinned into `submission_mint_inputs`
  and bound into the notarized envelope**, so it is permanent.
  **Why an unregistered issuer can submit at all.** `submission_write` (`directory-node.ts`) has **no
  `#requireRegistration` gate** — unlike `session_request` and `connection_request`, which do. Signaling
  auth there is bare proof-of-possession of ANY Ed25519 key, and the handler's own comment says so. So
  the reachable path is: mint a throwaway key, never register it, sign an endorsement of your own
  registered agent, submit to any node. The subject resolves (it is registered and must be), the issuer
  does not, the flag reads *not same operator*, and the endorsement is minted and notarized as
  independent third-party corroboration.
  **REFUSE, do not flag.** Flagging would assert "these two agents are one operator", which is precisely
  what cannot be known when one side is unidentifiable; and a flagged mint still writes a permanent
  notarized row for a submitter who does not exist. The subject-side precedent is already refusal
  (`subject_not_registered`), and the reasoning is the same one written there: *a signal we cannot
  attribute is worse than one we did not mint.*
  **This must not become an availability bug, and the property that prevents it is load-bearing.**
  `resolveAgentByPubkey` returns `null` **only** on the directory's explicit `found:false`; an
  unreachable consortium THROWS (`DirectoryUnreachableError`, after `#tryEach` exhausts every node),
  which leaves the row queued rather than refused. So `null` means *definitively not registered*, never
  *could not check*. **If a later change makes a failed resolution return `null`, this check silently
  starts refusing legitimate endorsements during an outage** — anyone touching that client must preserve
  the distinction.
  **Placement:** beside the existing subject resolution and BEFORE the same-operator branch, so it
  covers both `subject_kind`s rather than only the agent-subject path. Out of scope: the `refuse` op,
  which reaches `handleRefuse` earlier and validates the refuser against the target signal's subject —
  a stronger check than registration.
  Named events: `signal.ingress.rejected` with `reason: "issuer_not_registered"` (existing event, new
  reason string; `reason` is a free-form column, so no type or migration is involved).
  **Defense-in-depth, recorded and NOT required by this line:** a `#requireRegistration` gate on
  `submission_write` at the directory would stop the row ever being written. Deliberately not folded in
  — it costs a directory deploy, and `requireRegistration` defaults to `false`, so it is a weaker and
  config-dependent guard than the portal refusal. The portal is the enforcer because it is the only
  party that can see linkage at all (`DOD-END-SUBJECTKIND-1`'s own reasoning).
  > ✅ **SHIPPED AND LIVE 2026-08-10** — cello-portal `df7f5be` + `6ac77b8`, reviewed, deployed as
  > image `portal-6ac77b8` (Cloud Run rev `cello-portal-00011-z49`, 100% traffic). Verified against
  > the ARTIFACT before deploy — pulled the image and grepped its filesystem for
  > `signal.ingress.result_unreported`, a string that exists only in the second commit, so the image
  > provably carries the review fixes and not just the original guard. Post-deploy: `/sign-in` 200,
  > zero ERROR entries on the new revision.
  >
  > **THE REVIEW FOUND A BLOCKER AND IT WAS IN THE FIX ITSELF (`6ac77b8`).** The guard made an
  > unresolvable issuer TERMINAL — refuse and delete the queue row — while the lookup ran through
  > `#tryEach`, which returns the FIRST node's null without asking the others. A profile row is
  > written on the one node that fielded the registration and replicates on a ~60 s pull, and the
  > daemon picks its submitting node at random on every start. So a new operator endorsing someone
  > within a minute of registering had the submission **destroyed, permanently, with neither side
  > told** — roughly 2-in-3 per attempt, and permanent for a row that landed with a NULL `agent_id`.
  > Before this line the cost of that stale answer was a wrong `same_operator` flag; the line turned
  > it into data loss. Fixed by routing through `#findAcross`. **The same bug had already shipped and
  > bitten three days earlier** — `resolveAccountByEmailStub` was moved off `#tryEach` after it took
  > sign-in down on 2026-08-07, and the write-up sits a few lines above the function that was left
  > behind. Regression test verified red against the old routing (2 failed / 26 passed).
  >
  > **Second finding, also fixed: "refused by name" never reached the named party.**
  > `recordSubmissionResult` had exactly one caller — the refuse handler — so every rejection wrote
  > its reason to the portal's private `processed_submissions` and nowhere else, and the agent's
  > `submission_results_request` returned nothing forever. All four post-authentication rejection
  > paths now report, to every node, partial writes tolerated, never fatal.
  >
  > **A test I was pleased with was hollow.** The "directory unreachable" test STIPULATED the property
  > it claimed to pin, by making the mock throw — so swapping in a client that swallowed the error and
  > returned null would have kept it green while every endorsement submitted during an outage was
  > destroyed. The property is now tested where it lives, with a partial-outage case beside it. And
  > typecheck caught that the test harness never modelled `reason` at all, so no test could have caught
  > a refusal arriving with no cause.
  >
  > **Recorded, NOT fixed — they belong to other lines.** (a) `same_operator`'s ACCOUNT arm reads
  > `agent_profiles.account_id`, a per-node column that does not replicate — measured live at 2/1/0
  > linked across three nodes for one operator, so that arm is roughly a coin flip depending on which
  > node answers; the phone-stub arm is replicated and sound. (b) `same_operator_account_subject` is
  > unreachable — the account subject never resolves, so the branch always yields
  > `account_subject_unsupported`, and one test's NAME claims a guarantee its assertion contradicts.
  > (c) `withdraw` from any key accumulates unacked rows and can head-of-line block the queue
  > (`DOD-END-WITHDRAW-1`).
  >
  > <details><summary>The pre-review build note, kept because the revert-test reasoning is worth keeping</summary></details>
  > Originally BUILT as cello-portal `df7f5be`, pushed to `main`. Refusal placed after the subject check, before the same-operator branch, exactly as
  > specified above. **Two tests, and the first is a REVERT TEST:** asserting the counts alone passes
  > without the fix, because the old behaviour *did* produce a result — it minted. The load-bearing
  > assertion is that `postSignedSubmission` is never called; run against the unfixed code it fails
  > with the endorsement already at the notary, which is the exploit demonstrated rather than
  > described. The second pins the outage property — a thrown `DirectoryUnreachableError` leaves the
  > row queued (`errored`, unacked, no `processed_submissions` row), so a degraded fleet cannot be
  > mistaken for an unregistered issuer. Gate: 226 tests pass, lint 0 errors, typecheck clean, build
  > succeeds. **The unit review has NOT run** (agent dispatch is off in the session that built it), so
  > this is implemented, not done. **Deployment is a portal deploy, not a directory roll** — no
  > migration, no wire change, no client change; `reason` is a free-form column.
  > ❌ **The defect as found, 2026-08-10.** Traced through code and confirmed in the directory's own comments;
  > **not demonstrated against a running system.** Consequence measured at the receiving end: when the
  > flag is true the recipient is shown a paragraph saying the endorsement is worth nothing as
  > independent corroboration and does not count toward any minimum; when it is false that paragraph is
  > simply ABSENT, and the recipient sees the issuer only as `peer-claimed` — no name, no key. So a
  > counterparty cannot distinguish an endorsement from an established agent from one written by a key
  > minted during the conversation. Nothing acts on the count today (`DOD-FLOOR-1` is deliberately off),
  > which is what makes this currently harmless and what makes it urgent to fix BEFORE the floor is
  > switched on: by then the fabricated endorsements are already notarized and permanent.
- **DOD-END-QUOTA-1** — **the issuance quota (`M10B-D6`).** At most **100** endorsements per **rolling
  30 days**, enforced **per account** (not per agent — a per-agent cap is bypassed by spinning up
  agents, which is the same farming hole `INV-NO-SELF-STANDING` exists to close), counted at the portal
  because that is where minting happens. The cap and the window are **configuration, not literals** —
  raising it must be a config change with no code edit and no migration, and the DoD/journal records
  where that knob lives. Over-quota is REFUSED, and the refusal reaches the submitting agent naming the
  cause, the cap, and **when the window frees up** — `issuance_quota_exceeded`, never a bare
  `intake_rejected` (§5b ERRORS NAME THEIR CAUSE). A re-issue after a refusal counts against the quota
  like any other (`M10B-D4`); exempting it would make refuse-and-retry an unbounded loop. Named events:
  `signal.quota.checked`, `signal.quota.exceeded`.
  > **BLOCKED ON `M10B-D18` (review F1).** "Per account" is not computable today: a submission's only
  > identity is an agent pubkey, and **no agent-pubkey → account resolution exists** — the directory
  > has only the forward direction (`/internal/agents-by-account`). Without D-18's route this cap
  > degrades to per-agent, which is the exact farming hole the line's own parenthetical says it must
  > close. Build D-18 first, or this line ships the vulnerability it was written to prevent.
  > **➡️ MOVED 2026-07-30 — first-after-launch, Andre's call.** Ships as ONE unit with `M10B-D18`'s
  > agent→account route and `DOD-END-ACCOUNTLINK-1`; portal-side enforcement, so no wire change and no
  > migration cost in deferring. Nobody to farm endorsements at alpha with one issuer. — ➡️ MOVED

---

## Tier 2 — Consent (the first new mechanism)

- **DOD-END-DELIVER-1** — the minted envelope is delivered to the **subject** — a third party who did not
  initiate it, and who is not the submitter (§7: "Bob's role ends at submission"). Reuses the generic
  delivery path (verify hash ∈ directory → insert envelope row) with no type-specific handling, landing
  in a **pending** consent state. **No new trigger and no new transport** (Andre, 2026-07-28): this is
  the M10-D22 sealed pickup path behaving exactly as it does for every other signal — the portal seals
  per-agent and queues; if the subject's daemon is down the envelope **sits there** and lands when the
  daemon next comes online. A subject who never acts is the normal case, not an error case, and nothing
  about delivery may assume the subject is present. The one thing that IS new is cross-account fan-out:
  the portal seals to the *subject's* agents, not the submitter's.
  > **CORRECTED 2026-07-28 (Entries 6 + 9) — one clause above is FALSE and must not be built on.**
  > "Reuses the generic delivery path … with no type-specific handling" does not hold: the generic path
  > enforces **one pending pickup per `(agent_id, signal_kind)`** (`enqueuePickup`'s `ON CONFLICT` +
  > V37's partial unique index), so **the second endorsement of a subject silently overwrites the
  > first** — no error, success returned, and journey case (a2) is precisely the scenario that triggers
  > it. Correct per `M10B-D23`: re-key to `(agent_id, signal_kind, signal_hash)` as **V50**, riding the
  > same batched deploy. The DoD's "no new trigger and no new transport" claim **survives** — this is a
  > cardinality fix, not a transport one — but this line carries **directory work and a migration**, so
  > it is not the free ride the paragraph above implies. Fan-out resolution is `M10B-D24`.
  > **BUILT 2026-07-29 — `V52__pickup_queue_pending_per_hash.sql` + the `enqueuePickup` conflict-target
  > re-key + 5 green tests, including a REVERT PROOF that rebuilds V37's old index and demonstrates the
  > second endorsement being destroyed.** Also revived `trust-001-pickup-repository.live`, RED since V48
  > (four days, unnoticed — the file is `CELLO_ENV=local` gated, so CI was green with none of it
  > running). → **Entry 20**. **✅ DEPLOYED 2026-07-29 ~10:05 UTC** — V52 live in all three regions, verified
  > against each regional database. **The cross-account fan-out (`M10B-D24`) is separate and still
  > ❌.** — ✅
- **DOD-END-PENDING-1** — **the pending-consent queue: its own surface, NOT the transcript inbox**
  (`M10B-D5`). The inbox is cleared by reading or dismissing a transcript; an endorsement awaiting
  consent has no transcript, so putting it there gives the operator an item they cannot clear the normal
  way. It is a distinct class of thing — items awaiting my decision — and it is keyed and named by
  **consent state**, never by type (`INV-ZEROBUMP`; the generic name is what keeps this legal). Two
  different lifetimes, and conflating them is the bug to avoid: the **item** persists until it is
  accepted or refused, while the **notification** is raised once and stops once seen — an operator must
  not be re-nagged on every `cello_use_agent`. On selecting an agent with pending items, the operator is
  told they are waiting. Named events: `signal.consent.pending`, `signal.consent.notified`.
  > **BUILT 2026-07-29 — the queue and its two lifetimes.** `listPendingConsent` /
  > `countUnnotifiedConsent` / `markConsentNotified`, backed by a SECOND column
  > (`consent_notified_at`) because the item and the notification are different facts: one flag would
  > either dismiss the pending decision or nag forever, and tests pin both directions including that
  > a NEW arrival raises it again. Keyed by consent state, never by type — a test drives an unknown
  > client-sourced type through it. Scoped per agent on the same axis as presentation. 10 tests.
  > **SURFACE LANDED 2026-07-29 → Entry 33, 34.** `cello_use_agent` returns `pending_consent` + guidance
  > (a COUNT; it deliberately does not mark notified — listing does, so the operator is never marked
  > told about something they were not shown). Verbs at MCP+CLI parity. Covered by a live-daemon test
  > after the review found the nudge had ZERO coverage. — ✅
- **DOD-END-ACCEPT-1** — accept-before-present (D-23). The subject reads the endorsement and accepts or
  refuses it; **only an accepted endorsement is presentable.** Andre's reason, recorded verbatim in the
  policy audit: *"Otherwise someone could create a rogue endorsement that says you're a piece of shit and
  never work with this person."* Acceptance is the second cheap check behind intake scanning, on the first
  CELLO content written by one party and displayed to a third. Negative AC: a pending or refused
  endorsement cannot be presented by any path. **Refusal carries an OPTIONAL message back to the issuer
  (`M10B-D4`)** — Alice's choice, never automatic, because there is no edit in v1 and refuse-and-reissue
  is the correction loop: *"what if Bob has given you an endorsement that mistakenly has said something
  you don't want it to say… like a LinkedIn recommendation."* A refusal with no message tells Bob
  nothing. Bob may then issue a corrected endorsement — re-issuance after refusal is explicitly allowed
  (and counts against `DOD-END-QUOTA-1`). The message is operator-authored free text from the
  *subject*, so it is scanned on the same path as the endorsement body — it is the same injection
  surface pointed the other way.
  > **BUILT 2026-07-29 — the consent STATE and its enforcement.** `consent_state` on
  > `wallet_trust_signals` via a birth-gated migration on the `contacts-tier` pattern (no DEFAULT,
  > ALTER+backfill in one transaction, RETHROW) — deliberately OUTSIDE `ensureTrustSignalSchema`'s
  > bare `catch {}`, which runs on every `startDaemon` and would otherwise flip a REFUSED endorsement
  > back to `accepted` on restart. Presentability is `consent_state = 'accepted'` in the SQL of
  > `listAllActive`, so `include` cannot route around it and anything not exactly `accepted` fails
  > closed. Keys on `issuer_kind`, never on type. 13 tests.
  > **REFUSAL MESSAGE + VERBS LANDED 2026-07-29 → Entry 33, 34.** `M10B-D4` rides the submission queue
  > as a third `op` (`refuse`) — no field added, no order changed, so every existing signature still
  > verifies. The refusal is recorded and its write CHECKED before anything that can fail; silence is
  > the default; the issuer learns only what the subject chose to tell him. Account-subject items
  > refuse but WITHHOLD the message — which agent may speak for an account is unsettled, and a signed
  > message is not the place to guess (Open questions). — ✅
- **DOD-END-DISCOVER-1** — non-discoverability, proven by a negative test (D-24): no path lets any third
  party enumerate, count, or infer endorsements about a subject who has not presented them. The
  directory's fingerprint is useless without the text, and only the subject holds the text. Andre,
  generalising past endorsements: *"This is the case for absolutely everything in CELLO. You decide what
  you want to present."* Scope note: **the issuer is not a third party.** Bob knows he issued it, and
  may learn of a refusal if Alice chose to tell him (`M10B-D4`) — that is consent working, not a leak.
  The negative test targets everyone else, including the sealed submission queue (`DOD-END-QUEUE-1`),
  which must not let a directory operator infer who endorsed whom.
  > **🅿️ PARKED — ANDRE'S CALL (second review H8, Entry 10). This line is NOT achievable as written.**
  > `signal_records` stores `subject` and `issuer_pubkey` **in plaintext**, is **replicated to all three
  > sovereign nodes**, and `subject` IS the counterparty's `k_local_pubkey` (there is an index on it).
  > So the moment an endorsement is *minted*,
  > `SELECT subject, issuer_pubkey FROM signal_records WHERE issuer_kind='agent'` gives any node
  > operator **the complete endorsement graph**. The queue's minimalism protects the pairing only for
  > submissions that are *refused*. This line's own defense — "the directory's fingerprint is useless
  > without the text" — is true of the **payload** and false of the **parties**.
  > **Two resolutions, both expensive, and the choice is policy not engineering:** (a) rescope this
  > line in writing to *"content is undiscoverable; the existence and parties of a notarized signal are
  > visible to node operators"* — arguably already true of every M10 signal and possibly the honest
  > reading of a federated notary; or (b) stop storing plaintext parties for `issuer_kind: agent`,
  > which changes the storage model and needs a migration. Pre-existing (V46 predates M10B) and it does
  > not block Tier 1 mechanically — but it is load-bearing for a milestone whose premise is consent and
  > non-discoverability, so it must not be closed silently. — 🅿️
- **DOD-END-ACCOUNTLINK-1** — **the agent→account repair path, and it must be built SAFELY (fourth
  review HIGH-1, Entry 16).** `M10B-D26r2` refuses endorsement intake when an agent has no
  `account_id`, and tells the operator to link one — but no such flow exists. `linkAgentToAccount()`
  exists with the grant it needs and **zero production callers**, and wiring it *as-is* would be an
  **authorization bypass on the kill switch**: it is `UPDATE agent_profiles SET account_id WHERE
  k_local_pubkey` with **no ownership check**, over a public value, and `resolveAccountId` *creates*
  an account for whatever phone stub is supplied — while `account_id` is the authorization root the
  write seam derives pause/**burn** scoping from. ACs:
  - **Proof of control over the agent key** — a signature from `k_local` over a session-bound
    challenge. Possession of the *public* half proves nothing; that is the whole defect.
  - **Link to the authenticated SESSION's account.** Never `resolveAccountId`'s create path — the
    account must already exist and belong to the caller.
  - **Remove the dead `agentProfileId`** from the params interface (unused — it is the tell that the
    body was never read).
  - **Negative test, blocking:** a caller cannot link an agent they do not control, and the attempt is
    refused with a named cause and logged.
  - Refusing to link must never silently leave the agent unlinked *and* report success.
  Without this line, `operator_linkage_unresolved` points at nothing and a transient registration error
  becomes a permanent, unannounced disqualification.
  > **➡️ MOVED 2026-07-30 — first-after-launch, WITH `DOD-END-QUOTA-1` and `M10B-D18` as one unit.**
  > They are the same dependency chain and half-building it is the dangerous state: the ACs above stay
  > blocking whenever it is built. Until then nothing calls `linkAgentToAccount()` and the bypass stays
  > unreachable — **do not wire it as a convenience in the meantime.** — ➡️ MOVED
- **DOD-END-SCOPE-FIX-1** — **an M10 defect this milestone surfaced and must fix FIRST (Entry 10).**
  `listPresentable` — which implements M10-D5/M10-D14 subject scoping (account-subject rows presentable
  by any agent under the account; agent-subject only by its own subject) — has **zero production
  callers**. The live presentation path is `listAllActive` (`outbound-sessions.ts:186`), which takes
  **no `agentId`/`accountId`** and is passed none. So the live wire path offers **every active wallet
  signal regardless of which agent is presenting** — `INV-AGENT-SCOPED`, live, in M10, today. This
  lands **before** the consent column (`M10B-D14r2`), or consent is bolted on top of a scoping hole and
  the negative consent tests would pass against a path that was never scoped. Fix in the SQL, not a JS
  branch. Standing rule: a real defect found outside the diff gets fixed, not deferred.
  > **RESCOPED (third review F5) — as first written this unit COULD NOT START, and it is sequenced
  > first.** `listPresentable`'s SQL needs `opts.accountId`, and **`accountId` does not exist anywhere
  > in the daemon's production code** — which is precisely *why* the function has no callers.
  > `M10B-D18` resolves agent→account on a directory route **for the portal**, not for the daemon.
  > **Scope now: the `subject_kind='agent'` half only** — it needs no account and closes the
  > agent-subject scoping hole immediately. The account-subject half is **deferred behind a named
  > prerequisite** (decide where the daemon obtains its own `accountId` — persisted at registration, or
  > returned on the signaling auth response) rather than assumed into existence.
  > ### 🚨 THE JOIN KEY IS `k_local_pubkey` HEX, **NOT** THE DAEMON'S `agent_id` (fourth review HIGH-4)
  > For an agent-subject row, `subject` holds the **K_local pubkey hex** — that is how the directory
  > joins it (`internal-api-server.ts:791`: `JOIN agent_profiles ap ON ap.k_local_pubkey = sr.subject`).
  > The daemon's `agent_id` is a **device-local `randomUUID()`** that never enters a hashed envelope.
  > **The trap, and it is live:** `trust-signal-store.test.ts` seeds `subject` with the daemon's
  > agent_id UUID. A coder who follows the old wording writes
  > `WHERE subject_kind != 'agent' OR subject = agentId`, copies the fixture convention, and **goes
  > green — while matching ZERO rows in production**, silently un-presenting every agent-subject signal.
  > This unit is sequenced first, so that lands before anything else.
  > **BUILT + REVIEWED 2026-07-29 — ✅.** The predicate is in `listAllActive`'s SQL
  > (`AND (subject_kind <> 'agent' OR lower(subject) = ?)`), scoped on the presenting agent's
  > `k_local_pubkey` resolved from `loadedAgents` at the call site; the fixture trap is dead in BOTH
  > repos (`seedAgentKeys` returns the pubkey it already derived; the two spine journeys no longer
  > seed a random string as an agent subject); an absent/malformed presenter is REFUSED, not
  > silently empty. Review findings all fixed, including the handed-off hex-case one. cello-client
  > gate green: **2058 tests**, lint, typecheck, build. → **Entry 21** + **Entry 25**. Account-subject
  > half remains deferred behind its named prerequisite. — ✅
  > **Required:** scope on the presenting agent's `k_local_pubkey` hex — **verified available and
  > verified to be the RIGHT key**, which is the part that would otherwise fail silently:
  > `loadedAgents: ReadonlyArray<{ name, pubkey }>` is already a dependency of `outbound-sessions.ts`
  > (`:47`) with the exact lookup precedent in the same file (`:395`,
  > `loadedAgents.find(a => a.name === ctx.agentName)`), and `agentName` is in scope at the call site.
  > **It is K_local, not some other key:** `LoadedAgent.keyProvider` is documented as *"the agent's
  > K_local signing key"* and `pubkey` is its public counterpart — and decisively, that same pubkey is
  > what authenticates the signaling stream, which the directory resolves with
  > `getAgentIdByPubkey(authedPubkeyHex)` against `agent_profiles.k_local_pubkey`. So it is the same
  > value `subject` holds. **Fix the fixture's UUID-as-subject convention first** — otherwise the new test does not survive the revert test: it passes with or
  > without the scoping fix, because the fixture makes both paths return the seeded row. — ✅

---

## Tier 3 — Issuer-side lifecycle (the second new mechanism)

- **DOD-END-REVOKE-2** — the authority fix M10 logged and deferred (`DOD-REVOKE-1`, review F6, *"revisit
  with intake"*). Today revoke authorises on the generic `submitter` role and writes a `portal` tombstone
  regardless of the target's real `issuer_kind` — harmless while every signal is portal-issued, but the
  moment a person can issue an endorsement, **one submitter key can tombstone someone else's
  endorsement.** Required: exact-`issuer_pubkey` auth for `issuer_kind: agent`, and the tombstone must
  respect the target's real `issuer_kind`. Role-based auth stays correct for portal-issued records (it is
  what survives a portal key rotation — determination §3.5). **Without this, D-19 is nominal.**
  > **BUILT 2026-07-29 — 🟡.** `V53__signal_records_revoker_authority.sql` (the `M10B-D12r4` CASE,
  > `revoker_pubkey` + `revoker_signature`) plus the inner, self-certifying authorization in
  > `revokeSignal`. **Measured before written** (Entries 11/15's rule): ten shapes inside V46's REAL
  > view — **exactly one changes and it is the F6 defect** — then every branch proven load-bearing by
  > counterfactual, including the one that would have made the fix a NO-OP. 12 view tests + 5
  > end-to-end through the real mint→revoke→status path. V46 is NOT amended (Entry 17); the
  > monotonicity statement is in V53's header. **Open, and named:** `revoker_signature` is AUDIT
  > EVIDENCE — nothing verifies it, so the compromised-node case stays open. → **Entries 28, 30, 31**.
  > **✅ DEPLOYED 2026-07-29 ~10:05 UTC** — V53+V54 live in all three regions, `success: true`,
  > V53 checksum converged at `-1956862388`, `/manifest` 200 everywhere. **Reviewed; three defects
  > fixed**, the worst being F1: a "legacy tombstone" branch that defeated the whole fix and which my
  > own test had pinned as correct. Still open and named on the line, not silently closed: F2's
  > `issued_at`-through-a-queue problem, F3's silent `MIN(issuer_kind)` disagreement, F8's
  > replication column-skew window. — ✅
- **DOD-END-REVOCABILITY-1** — **not every signal is the subject's to destroy, and the client says so
  before it destroys anything.** Three categories, settled with Andre 2026-08-10: **mandatory**
  (`track_record`, `email`, `phone`) — never revocable, because a behavioural record its subject can
  delete is worth nothing to anyone, and the other two assert only THAT a channel was verified, never
  the address or number, so no privacy argument applies; **security-derived** (`webauthn`, `totp`) —
  mirrors of a portal security factor, removed by turning the factor OFF, never revoked directly,
  because direct revocation is a one-way trap (factor stays on, signal gone, and it can never be
  regenerated since the only trigger that mints one is an enrolment already performed);
  **discretionary** — everything else, and the DEFAULT, so a new signal type never needs a client
  release (`DOD-INV-ZERO-BUMP`). Checked BEFORE signing and BEFORE the local delete, which is
  unconditional. **This is UX, not enforcement** — the operator owns the process and can edit it; the
  PORTAL is the enforcement point for mandatory types (server-side, and the only party that knows a
  signal is a track record rather than a GitHub link, since directory `type` is deliberately opaque),
  and the DIRECTORY already enforces exact-issuer authority for attestations in
  `signal_records_effective`.
  > **✅ SHIPPED AND PROVEN LIVE 2026-08-10** — cello-client `c44c16d`, daemon `0.0.157`, promoted.
  > Verified against Andre's running daemon, not a test: revoking a `track_record` returns
  > `signal_not_revocable`, a `webauthn` returns `revoke_via_portal` naming the portal as the route,
  > and the wallet is untouched. Before this the handler took ANY signal by hash prefix and went —
  > the 2026-08-10 live test destroyed the local copy of a track record, and only the broken
  > transport stopped the directory half. Revert-tested: moving the check after the signing fails a
  > guard. 3528 tests, lint/typecheck/build clean. → also on the launch list.
- **DOD-END-CONSENT-WITHDRAW-1** — **refusal is reachable AFTER acceptance**, so "I accepted this
  endorsement and now I want it gone" has a path. Refusal rather than revocation, deliberately: the
  decision is RECORDED rather than erased, so the trail stays honest, and a refused signal is already
  inert everywhere it is checked. **Scoped to peer-issued attestations (`issuer_kind <> 'portal'`),
  and that clause is load-bearing rather than tidy-up** — a refused signal is inert, so widening
  refusal without it hands every operator a back door to suppressing their own MANDATORY signals,
  achieving by consent exactly what revocation is forbidden from doing. Filtered on ISSUER and
  deliberately NOT on type: a hostile peer can issue a signal it calls `track_record`, and refusing a
  stranger's claim about you is precisely what the verb is for — filtering by type would protect the
  attacker. The response distinguishes a withdrawal from a plain refusal and names the supersession
  consequence (accepting a re-issue supersedes what it replaced; refusing it afterwards does not
  restore the predecessor, so withdrawing from a replacement can leave you with neither).
  > **✅ SHIPPED 2026-08-10** — cello-client `59c1c8e`, daemon `0.0.158`. The portal-issued guard is
  > **proven live** on Andre's daemon (`not_decidable_for_agent`, a reason string that exists only in
  > `0.0.158` — the old build said `not_pending_for_agent`, so the string is itself the proof of
  > which build answered). The positive path — withdrawing an accepted endorsement — is covered by
  > tests and revert-tested (dropping the `issuer_kind` clause fails two of eight) but has **NOT met
  > real data**: Andre holds no peer-issued attestations, so the first endorsement he receives is the
  > real proof. 3536 tests, lint/typecheck/build clean.
- **DOD-END-REVOKE-3** — ✅ **the revocation TRANSPORT. The verb has never worked, and the four
  defects are in one handler.** Found 2026-08-10 by running it against the live fleet: it POSTs
  `/internal/signal/revoke` to port **9090**, the health port, when the route lives on the internal
  API at **8081** (which is firewalled to the VPC and unreachable from an operator's machine at all —
  so "fix the URL" is not an available answer); it signs as the AGENT when the route requires an
  enrolled `submitter`, and omits the inner `revoker_pubkey`/`revoker_signature` V53 added for
  exactly this; it contacts ONE node under a comment claiming "all reachable nodes get the
  tombstone"; and it returns `ok: true` unconditionally while hard-deleting the local copy
  "regardless of directory result" — so a failed retraction also destroys the ability to retry.
  Measured: revoking `3a6512df…` left all three nodes byte-identical (`superseded`, zero revocation
  rows) while the local copy vanished.
  **Definition of done — all six, and the last one is not optional:**
  1. A new signalling frame carries the revocation over the existing authenticated connection
     (the only publicly reachable path; 4000/8080 are open, 8081 is not). The HTTP post is gone.
  2. All three nodes are asked; the result reflects what happened at each.
  3. `ok: true` only when it worked; failure returns `ok: false` with a named reason.
  4. The local copy SURVIVES a failure — local delete only after the directory confirms.
  5. The directory refuses a revocation whose signer is not entitled to it, enforced server-side.
     **Verify before building**: `signal_records_effective` already makes a non-issuer's tombstone
     inert for `issuer_kind: agent`, and portal-issued records keep role-based authority — this may
     be satisfied already, and inventing work here would be worse than none.
  6. **PROVEN LIVE**: revoke a real discretionary signal, then query all three node databases and
     show it reading revoked on each. No query output, not done.
  Spans both repos → publish cascade + a node-by-node directory roll.
  > ✅ **DONE 2026-08-10 — PROVEN LIVE ON ALL THREE NODES.**
  >
  > ```
  > gcp-use1   db4e32c09cf7 | revoked | revocation_rows 1
  > gcp-usc1   db4e32c09cf7 | revoked | revocation_rows 1
  > gcp-euw1   db4e32c09cf7 | revoked | revocation_rows 1
  > ```
  > Baseline immediately before: `active` on all three, **0** revocation rows. `cello_trust_signals_revoke`
  > on a real `github_id` returned `queued: true, revoked: false` — honest, not a false success — the
  > portal drain returned `minted: 3, errored: 0`, and the revocation REPLICATED: two nodes revoked
  > within seconds, the third after one anti-entropy pull. Clause 2 is therefore met by replication
  > rather than fan-out, which is the stronger property.
  >
  > **It took FOUR attempts, and every failure was mine and invisible to review.** (1) `poison: 1` —
  > the runtime op validator never learned `revoke`, because I widened the TYPE and a type has no
  > runtime effect. (2) `rejected: 1` — I authorized against `minted_signals`, an index with
  > HISTORICAL GAPS, and the operator's own signal was one of the gaps. (3) `errored: 2` — I moved the
  > check to a directory endpoint that cannot answer it, because **the directory does not store the
  > subject at all**; the resulting 500 surfaced through `#findAcross` as "all 3 nodes unreachable",
  > masking a bad query as an outage. (4) Passed.
  >
  > The unit review found ten real defects and every one was fixed — but it could not find any of
  > these four, because each needed live data or a running fleet. That is the argument for clause 6
  > existing, and it is now evidence rather than principle.
  >
  > **The data defect was repaired, not worked around:** both GitHub ownership rows were missing from
  > `minted_signals` — exactly matching the code comment saying that path shipped without the
  > `recordMintedSignal` call every other mint makes — and were backfilled from facts the directory
  > and wallet both confirm.
  >
  > Deployed: directory `7a480e52` on all three nodes (us-central1 needed `c3-standard-4`; the whole
  > region was out of 2-vCPU capacity), portal `portal-ab7e75f`, client cascade through daemon
  > `0.0.161` / protocol-types `0.0.53`, promoted.
  >
  > **Clauses 1, 3, 4, 5 met. Clause 2 met by REPLICATION rather than fan-out** (one node accepts,
  > `signal_revocations` is Tier-A and carries it to the other two) — recorded because the clause says
  > "all three are asked", and that is NOT what happens; what matters is that all three end up
  > revoked, and clause 6 is what proves it. **Clause 6 ❌.**
  >
  > **Clause 5 VERIFIED, NOT BUILT**, as the line asks. `signal_records_effective` branch 4 gives
  > agent-issued signals exact-pubkey authority — a non-issuer's tombstone is written but INERT.
  > Branch 3 gives portal/directory issuers ROLE-based authority, so for a portal-issued signal ANY
  > tombstone through the submitter role counts. That is deliberate (portal keys rotate) and it means
  > the directory is NOT the gate for these: the PORTAL's account-scoped `minted_signals` lookup is.
  > Nothing was added at the directory.
  >
  > **REVIEWER'S VERDICT, quoted** (`cello-unit-reviewer`, read-only, no model override, on
  > cello-client `a279d79` + cello-portal `70d80b3`):
  > *"SPEC: DEVIATIONS FOUND (clause 2 missing, clause 3 deviated — both [blocking])… SILENT
  > FALLBACKS FOUND (H0, H1, H2 — all [blocking])… ERROR SUBSTITUTION FOUND… HOLLOW TESTS FOUND (the
  > daemon's new tests are source-greps and bypassable; clause-5 enforcement untested)… REMOVALS
  > PROVEN."* Ten findings; **every one fixed** — H0 `24e419d`, H1 `896292a`, H2/M5/M6/M7 `9284c7c`,
  > H3/H4/M8/L9/L10 + the clause-5 tests `9b65148`, the type-safe comparison `f56155f`.
  >
  > **THE LIVE PROOF FOUND WHAT THE REVIEW COULD NOT, and this is the entry's real content.** The
  > reviewer flagged H0 exactly — the portal cannot decode a `revoke` — and I "fixed" it by promoting
  > protocol-types, having diagnosed it as version skew. It was not skew. I had added `revoke` to the
  > `SubmissionOp` **type**, and a type has no runtime effect: `decodeSubmission` carries its own
  > literal op list that the union does not touch. So the verb was rejected at runtime by the very
  > version published to fix it, twice, while both repos typechecked.
  >
  > Measured on the live fleet: baseline `active` on all three nodes with zero revocation rows;
  > `cello_trust_signals_revoke` on `db4e32c0…` (a `github_id`) returned `queued: true, revoked:
  > false` — honest; the portal drain returned `poison: 1`; the portal log said
  > `submission_malformed: unknown op 'revoke'`. **Poison is documented as UNATTRIBUTABLE and reports
  > nothing to anybody**, so the operator would have been told "queued" and waited forever while the
  > signal stayed live. The exact false-success shape this line exists to remove, one layer out.
  > Fixed in `24e419d` with a round-trip test over every op in the union, revert-tested.
  >
  > **Nothing was lost in the failed attempt** — clause 4 held, the wallet copy survived, and the
  > revocation is retryable. That is the only reason this is an anecdote rather than an incident.
  >
  > **What clause 6 still needs:** the `v0.0.234` cascade promoted to `latest` (Andre runs it), the
  > portal rebuilt against protocol-types `0.0.53` and redeployed, then revoke + query all three
  > databases.
- **DOD-END-UNKNOWNOP-1** — ❌ **an unknown op is destroyed silently, and its sender is perfectly
  known.** Filed 2026-08-10 from `DOD-END-REVOKE-3`'s live proof, where it was the amplifier rather
  than the cause. `decodeSubmission` throws `unknown op '<x>'`, `outcomeFor` maps that to **poison**,
  and poison is documented as UNATTRIBUTABLE — "a body that will not decode has no known sender" —
  so nothing is reported and the row is acked and deleted.
  **That reasoning is right for a body that will not parse and WRONG for this case.** The seal opened,
  the bytes decoded, the signature is over a body we can read: we know exactly who sent it. The
  consequence is that any operator running a daemon NEWER than the portal has their submission
  destroyed with no result ever written — told "queued", `pending` forever. It is a version-skew
  amplifier: the skew is normal and expected, the silent destruction is not.
  Required: an op the portal does not recognise but whose submission AUTHENTICATED is reported back
  as `unsupported_op` with the op named, not poisoned.
  > **NOT fixed inline, deliberately.** Reporting it needs the submitter pubkey out of a body
  > `decodeSubmission` has just refused, and picking fields out of failed-validation CBOR is its own
  > defect class. The clean shape is for `decodeSubmission` to surface an unrecognised verb as a
  > decoded body carrying an unknown op rather than an exception, letting the existing `unhandledOps`
  > dispatch answer — a protocol-types change plus an ingress branch. Does not block
  > `DOD-END-REVOKE-3`: once protocol-types `0.0.53` is on `latest` the revoke path never reaches it.
- **DOD-END-WITHDRAW-1** — withdrawal takes effect everywhere, including for recipients already holding a
  copy (D-19). The endorsement stops being presentable, and any recipient holding it sees it marked
  withdrawn on next check. Rides `DOD-VERIFY-1`'s existing TTL-re-check-on-use machinery (spec §14.7) —
  this line decides what that machinery is FOR, it does not build new transport. *A reference, not a
  tattoo.* Surfaced to the holder, never a silent disappearance. *(Status below — rescoped 2026-07-30.)*
  > **⚠️ PARTLY BUILT — and I got this wrong once, so the correction is recorded with it.**
  > *Verified 2026-07-30.* I first wrote here that the machinery did not exist at all, having grepped
  > the DAEMON, found `verdict: "active"` hard-coded and no ledger query, and concluded there was no
  > check anywhere. That is a claim about the PRODUCER reached by reading only the CONSUMER. The
  > producer is the DIRECTORY, and it does check.
  >
  > **What EXISTS:** at session establishment `#processSessionRequest` calls `checkPresentedSignals`
  > against `signal_records_effective` (`effective_status = 'active'`) and forwards only survivors —
  > degrading to forwarding NONE if it cannot check, so arrival implies the check ran. A withdrawal
  > that lands in the ledger therefore ALREADY takes effect for every FUTURE session automatically,
  > without new transport. That is most of what this line asks for.
  >
  > **What is MISSING** is narrower than "the machinery": a re-check for a copy a recipient is
  > ALREADY HOLDING, between sessions. Today the currency check is point-in-time at session setup, so
  > a signal revoked mid-session, or one sitting in a recipient's `contact_trust_signals` from an
  > earlier session, is not re-evaluated until the next session forms. The DoD's own words — "any
  > recipient holding it sees it marked withdrawn on next check" — are about exactly that stored copy.
  >
  > **Revised cost:** a status route the daemon can reach (the existing check is internal to session
  > setup, and `/internal/*` is portal-facing behind an API key a daemon must never hold, so this is a
  > post-auth signaling FRAME on the agent's home stream, not an HTTP route), a TTL and cache, the
  > re-check wired into consumption, and surfacing to the holder. `DOD-END-SUSPEND-1` then rides the
  > same frame answering differently. Smaller than I first wrote, and in a different place.
  >
  > **✂️ RESCOPED 2026-07-30 — Andre's call. M10B ships the half that already works.** Asked directly
  > whether "stops appearing in any new session" is enough for launch, he chose yes. So this line's
  > launch scope is: a withdrawal recorded in the ledger takes effect for **every future session**,
  > which `checkPresentedSignals` already does and `d701b1c3` asserts live. **➡️ MOVED to
  > first-after-launch:** the between-session re-check of a copy a recipient already holds, together
  > with `DOD-END-SUSPEND-1`, which needs the same frame. — 🟡 launch half live, re-check moved
- **DOD-END-SUSPEND-1** — suspending an issuer's account (the M8 LEVER-001 kill switch) marks everything
  that issuer minted as **no longer vouched**, reversibly; restoration brings them back; permanent
  revocation is what makes it final (D-25). Why it is not optional: an attacker holding a compromised key
  mints endorsements for their own sock puppets, and if suspension blocked only *future* issuance,
  everything minted before the switch was pulled keeps vouching for them and the kill switch never
  reaches the damage. **Mechanism: the same `DOD-VERIFY-1` TTL-re-check-on-use path that carries
  withdrawal** (spec §14.7) — this line builds no new transport either, it changes what the re-check
  answers. Reversibility is the difference from withdrawal: a suspension lifts, so the state must be a
  reversible mark on the issuer, never a tombstone written per-signal. **Verify before building** that
  the directory can join a suspended account to the signals issued by its agents' pubkeys; if that join
  does not exist, it is part of this unit and it is where the work actually is.
  > **➡️ MOVED 2026-07-30 — first-after-launch, with the re-check `DOD-END-WITHDRAW-1` needs.** It
  > rides the same missing machinery and answers it differently, so building them together is cheaper
  > than either alone. The attacker it defends against (a compromised key minting for sock puppets)
  > requires issuers this milestone does not have yet. — ➡️ MOVED

---

## Tier 4 — Consumption

- **DOD-END-RENDER-1** — presentation-side rendering. The `same_operator` fact is a FACT; **the endorser's
  tier to the recipient gives it its sign** (D-27): from an `unknown` endorser it is self-issued and worth
  nothing; from a `whitelisted`/`vip` endorser it is a strong positive — *"my other agent is mine,"* from
  someone already trusted. Generalises the design's existing rule that a third-party assertion is worth
  exactly what its issuer is worth. **D-8a (anonymous-by-default) does NOT apply to endorsements**
  (`M10B-D8`, Andre 2026-07-28: *"No anonymous endorsements."*): D-8a governs signals that HAVE an
  anonymous and an identified variant, and an endorsement has only one — its entire worth comes from
  the recipient recognising the issuer, which is what `DOD-END-FLOOR-2`'s tier join computes. An
  anonymous endorsement would be an unattributable claim, which is worth nothing and is exactly what a
  farm would emit. Do not build an anonymous variant to satisfy a policy that does not reach here.
  > **✂️ SPLIT 2026-07-30 — the safety half SHIPPED, the polish half MOVED.** What ships: the endorser's
  > words reach a consuming LLM quoted, attributed and flagged, never in the portal's voice — the
  > UNTRUSTED lens, proven at J-END hop 5, and `same_operator` now surfaced with its own framing rather
  > than silently discounted (Entry 39). **➡️ MOVED:** the tier-signed reading (an endorser's tier
  > deciding the fact's *sign*), which is `DOD-END-FLOOR-2`'s recipient-side join and moves with it.
  > The anonymous-variant clause is an instruction NOT to build something — it is a review lens, never a
  > deliverable, and is not tracked. — 🟡 safety half live, tier-sign moved
- **DOD-END-COUNT-1** — floor/count handling (D-29 sub-question 1). `same_operator` is an envelope-visible
  fact, so a count predicate MUST bucket or exclude flagged endorsements; a naive `count >= N` otherwise
  passes on ten agents under one operator. Keeps `DOD-FLOOR-1`'s "envelope fields only" rule intact —
  the predicate input is the envelope, the join is recipient-local.
  > **✅ RESOLVED 2026-07-30 — OPTION 1 TAKEN. `same_operator` IS an envelope field (slot 12).**
  > `M10B-D30`. Andre's call, and he was blunt about it: putting it outside the payload was "the most
  > obvious decision ever" and the fork should never have been raised. He was right — this DoD line
  > already SAID "an envelope-visible fact", so shipping it in the payload under `DOD-END-SUBJECTKIND-1`
  > was a deviation from the spec, not an ambiguity in it. Writing the deviation up as a three-way
  > decision was the error; the line's own words were the answer.
  >
  > The migration-trap argument I attached to option 1 was also overweighted: the stranded set is
  > EMPTY (alpha, no users, and the only minted endorsements are in test fixtures), so the wire break
  > cost hours, not a migration. The correct reading of the launch-triage rule is that a wire change is
  > expensive when there is something to strand — not that it is expensive in principle.
  >
  > WHAT SHIPPED: preimage arity 11 → 12, `same_operator` APPENDED (append-only; slot order IS the wire
  > format), boolean-normalised on both encode and strict decode so no reader must distinguish
  > "not same-operator" from "field absent". The predicate excludes flagged endorsements from
  > `min_count` and reports `excluded_same_operator` alongside the countable total — a refusal that
  > reported the raw count would tell an operator they have enough when the predicate disagrees.
  >
  > EXCLUDED FROM THE COUNT, NOT SUPPRESSED. The endorsement is still presented and still readable;
  > D-27 caps its worth at the endorser's own tier. What it must never do is help clear a COUNT,
  > because a count is exactly the thing one operator can inflate alone.
  >
  > THREE DEFECTS THIS FLUSHED OUT, all of which had been invisible while the flag sat unread in the
  > payload — recorded because each one shipped past a green gate:
  >   1. The DIRECTORY carried its own hand-rolled envelope decoder with its own arity constant (11),
  >      so it rejected every 12-slot envelope with `envelope_undecodable`. A valid endorsement refused
  >      by the only party that can notarize it. Replaced with the shared decoder, not a bumped
  >      constant. (`signal-write.ts`)
  >   2. `deliverWalletSignal` did not pass `same_operator` to `putWalletSignal`, so a co-owned
  >      endorsement stored `false`. Presentation re-encodes from that row, so the bytes stopped
  >      hashing to the notarized value and the RECIPIENT rejected it while the holder logged
  >      "attached: 1". Nothing asserted that a delivered signal is still presentable.
  >   3. The J-END fixture registered every agent under one dev account, so Bob and Alice shared an
  >      `account_id` — the journey's headline "a stranger endorses Alice" hop was exercising the
  >      CO-OWNED path, i.e. the one this line discounts. A false green on the central claim.
  >
  > Guards added, because each defect's real cost was how long it stayed invisible: the presenter now
  > refuses to send a signal whose bytes it cannot reproduce; the recipient's `hash_mismatch` logs
  > BOTH hashes; a frozen vector carries `same_operator: true` (all seven said `false`, which is also
  > what a hardcoded bug says); and `cello_trust_signals_list` shows the operator which of their
  > endorsements are capped. Live: J-END HOP 9. Revert-tested.
  >
  > **🟡 TAG CORRECTED 2026-07-30 AFTER REVIEW — the exclusion is NOT ENFORCED, because nothing calls
  > the predicate.** `evaluateSignalPolicy` has ZERO production callers: a repo-wide grep across
  > cello-client returns its definition, one comment, and two test files. No session path, no contact
  > handler and no gateway invokes it, and no operator-facing surface sets a `SignalRequirementPolicy`
  > (`cello_contact_set_signal` governs which of MY signals I PRESENT, not what I REQUIRE).
  >
  > So this is the SAME defect a third layer up, and the sequence is worth stating plainly: the flag
  > was inert because it sat unread in the payload → moved to the envelope → inert because the INSERT
  > dropped it → fixed → **still inert, because the consumer is a library function nobody invokes.**
  > Ten of Alice's own agents clear a floor of three today for the same reason they did before this
  > milestone: no floor is ever evaluated. `DOD-FLOOR-1` (M10, ✅) has the same hole — its journey
  > evidence calls `evaluateSignalPolicy` FROM THE TEST, which is the hand-built-rows shape again:
  > the test supplies the caller production lacks.
  >
  > **WHY IT IS NOT WIRED IN THIS PASS, deliberately.** `DEFAULT_UNKNOWN_POLICY` is
  > `{min_count: 1, require_issuer_kind: "portal"}`. Enforcing that at session acceptance today would
  > refuse every UNKNOWN contact holding no portal signal — i.e. most agents — and "two agents
  > connect" is the product's core value. A floor that is never evaluated is a missing security
  > property; a floor wired wrong is a broken product. Wiring it safely needs a policy SOURCE (the
  > operator setting a requirement per tier or per contact), opt-in defaults, and a refusal the
  > operator can see and act on — a unit of its own, not a line of glue.
  >
  > **WHAT IS ACTUALLY TRUE:** the predicate is correct and revert-tested; the envelope slot, both
  > store round-trips, presentation and the recipient's rendering are correct and live. The exclusion
  > cannot be reached in production.
  >
  > **✂️ RESCOPED 2026-07-30 — this line CLOSES on what it owns; the caller MOVES.** The envelope
  > field, both write paths, presentation, the recipient's rendering and the predicate itself are M10B's
  > and are done. **➡️ MOVED to first-after-launch:** wiring `evaluateSignalPolicy` into a live path,
  > which needs an operator-facing policy source and opt-in defaults — with `DOD-END-FLOOR-2` and
  > `DOD-END-TIER-1`, one unit. The reasoning above stands unchanged: a floor that is never evaluated is
  > a missing property, a floor wired wrong refuses most connections and breaks the product's core
  > value. **Carry the debt forward explicitly — `DOD-FLOOR-1` (M10, ✅) has the same hole**, and by the
  > new rule that belongs to M10 as a labelled debt line, not to this milestone. — ✅ (owned scope)
- **DOD-END-FLOOR-2** — endorsement-aware floor predicates: count, issuer tier, and issuer identity, all
  computed by joining the presented envelope's `issuer_pubkey` against the recipient's own contacts. This
  is compatible with `INV-FLOOR-ENVELOPE-ONLY` (nothing reaches into the payload) and is what D-27's
  tier-signed reading requires. **Explicitly out:** any predicate of the form "an endorsement SUBSTITUTES
  for requirement X" — that is policy D-12, tabled. Endorsements ship without it; substitution cannot.
  > **➡️ MOVED 2026-07-30 — first-after-launch, WITH the policy-engine wiring.** This is recipient-side
  > trust *policy*, not the endorsement *pipeline*, and the engine it extends has zero production
  > callers (`DOD-END-COUNT-1`). Writing endorsement-aware predicates for an engine nothing invokes is
  > the exact shape the new scope fence exists to catch. — ➡️ MOVED
- **DOD-END-TIER-1** — an endorsement NEVER moves a contact's tier automatically (policy D-10). It informs,
  and it may PROMPT — *"Alice was introduced by Bob, whom you've whitelisted — promote her?"* — but only
  the operator changes a tier. Automatic promotion through the trust-signal path would reopen, by another
  route, exactly the hole DEC-AB-3 closed when it removed accept-promotes.
  > **➡️ MOVED 2026-07-30 — first-after-launch, with the rest of the policy group.** Note what it
  > actually asks for: automatic promotion must NOT exist, and it does not — nothing in the endorsement
  > path touches a tier. The *prompt* is the buildable half and it belongs with the recipient-side
  > surface. A line whose launch content is "we did not build a thing" is a review lens. — ➡️ MOVED

---

## Tier 5 — Surfaces, and the proof

- **DOD-END-SURFACE-1** — the operator surface, MCP and CLI at parity (the M8C parity rule): issue an
  endorsement for a counterparty; list the items pending my consent (`DOD-END-PENDING-1`); accept;
  **refuse, with an optional message back to the issuer** (`M10B-D4`); read a refusal message on an
  endorsement I issued; list the ones I hold and their status; withdraw one I issued; per-counterparty
  include/omit at presentation; **see my remaining issuance quota and when the window frees up**
  (`DOD-END-QUOTA-1` — a quota the operator cannot see is a wall they hit blind). Andre's standing rule
  applies — **don't ship dead features**: an endorsement mechanism reachable only by daemon IPC is the
  `DOD-SETTINGS-SURFACE-1` mistake repeated.
  > **FIVE OF NINE CLAUSES LANDED 2026-07-29, reviewed twice → Entries 33–36.** Issue
  > (`cello_trust_signals_issue`, type-free by construction — the wire carries no type field, so a
  > second client-sourced type needs no new verb); list pending WITH the issuer's plaintext; accept;
  > refuse with the optional `M10B-D4` message; list held + consent status; per-counterparty
  > include/omit (`contact_signal_prefs`, narrows only). All at MCP+CLI parity, in the ONE
  > vocabulary, documented in the shipped SKILL.md, and behind a new structural guard that every
  > declared tool resolves to a real daemon handler.
  > **THREE CLAUSES ARE BLOCKED ON UNBUILT MECHANISMS, and building their surfaces first would ship
  > exactly the dead features this line forbids:** *read a refusal message I received as issuer*
  > needs the portal drain (`DOD-END-INGRESS-1` ❌ — nothing consumes the `refuse` op yet);
  > *withdraw one I issued* needs `DOD-END-WITHDRAW-1` (❌), and the issuer additionally holds no
  > local record of what they submitted, so there is nothing to name; *see my remaining quota* needs
  > `DOD-END-QUOTA-1` (❌, portal-enforced). Each is one line of work once its mechanism exists.
  > **UPDATE 2026-07-31 — EIGHT OF NINE.** *Read a refusal message I received as issuer* is LANDED:
  > the refuse-op consumer, `submission_results`, and the `cello_attestations_issued` verb all shipped,
  > and J-END hop 6 proves the loop live. *Withdraw one I issued* moves out with `DOD-END-WITHDRAW-1`
  > (Andre's 2026-07-30 rescope). **`DOD-END-QUOTA-1` is the only real gap left** — the operator
  > cannot see their remaining issuance quota. — 🟡 eight of nine, quota outstanding
- **DOD-END-JOURNEY-1** — **live journey, across real processes.** Bob's agent supplies an endorsement for
  Alice → portal authenticates Bob, scans, mints, notarizes → Alice receives it PENDING → Alice accepts →
  Alice presents it to Charlie → Charlie verifies (hash ∈ directory, active) and consumes it with
  quoted-untrusted framing. **Four cases, all run, none assumed:**
  - **(a) refusal, with the correction loop** — Alice refuses **with a message**; the endorsement is
    unpresentable and invisible to Charlie by every path (`DOD-END-DISCOVER-1`); Bob receives her
    message, issues a corrected endorsement, and Alice accepts that one (`M10B-D4`).
  - **(a2) subject offline at mint** — Alice's daemon is DOWN when Bob submits. The envelope sits in the
    pickup path, and lands as pending when her daemon next starts; on selecting the agent she is told an
    item awaits her decision (`DOD-END-DELIVER-1`, `DOD-END-PENDING-1`). Nothing errors, nothing is lost,
    and the notification does not repeat once seen.
  - **(b) same-operator positive** — a co-owned endorsement is minted, FLAGGED on the envelope, delivered,
    accepted, presented and READ — and excluded from `min_count` (`DOD-END-COUNT-1`). Live as J-END HOP 9.
    > **THE LITERAL WORDING IS UNREACHABLE, and the substitution is the interesting part.** As written
    > this says "Alice's established Agent A endorses her new Agent B" — two agents on ONE daemon. That
    > shape is refused at the CLIENT with `self_subject` before it can ever reach the portal, which HOP 8
    > proves deliberately. So the only reachable co-owned shape is two agents on DIFFERENT daemons that
    > share an account, and that is what HOP 9 runs: Charlie endorses Alice (own daemon → the client
    > guard correctly cannot see the link), and the PORTAL catches it from account linkage. That division
    > of labour — client catches what it can prove, portal catches what only it can see — is the whole
    > design of D-29, and this hop is the only place it is exercised live.
    >
    > "Rendered as a positive" was NOT met when the hop first went green: the recipient's projection did
    > not expose `same_operator` at all, so the fact was silently discounted rather than shown. It now
    > ships with its own framing — the operator vouching for their own agent is useful if you already
    > trust that operator and worth nothing as independent corroboration — because the same sentence
    > means different things depending on who wrote it.
    >
    > **🟡 3-of-4 after review.** Minted ✅, flagged on the envelope ✅, delivered/accepted/presented ✅,
    > rendered as a positive ✅. The fourth clause — "a `min_count` floor does not count it" — is NOT
    > enforced in production: nothing calls `evaluateSignalPolicy` (see `DOD-END-COUNT-1`). HOP 9
    > proves every hop up to and including the recipient reading it; it cannot prove a floor that is
    > never evaluated. — 🟡
  - **(c) self-endorsement refused** — an account-subject same-operator submission is rejected at intake
    with a named reason (`DOD-END-SUBJECTKIND-1`).
  - **(d) withdrawal reaches a prior recipient** — Bob withdraws after Charlie has already verified and
    stored it; Charlie sees it withdrawn on next check (`DOD-END-WITHDRAW-1`).
    > **➡️ MOVED 2026-07-30** — it is the journey case for the re-check half of `DOD-END-WITHDRAW-1`,
    > and moves with it. **The launch half is not left unproven:** `d701b1c3` asserts live that a
    > withdrawn signal is not forwarded into a NEW session, which is what Andre's call scoped M10B to.
    > — ➡️ MOVED
  > **THE CORE JOB AND THREE CASES RUN LIVE 2026-07-29 — `j-end.spine.test.ts`, 9 hops green.**
  > Real daemons, a real directory, a real Postgres, and the PORTAL'S OWN ingress modules loaded
  > across the repo boundary (`portal-ingress.ts`) rather than re-implemented — because a journey
  > written on the established spine pattern would seed `signal_records` directly, skip drain,
  > authenticate, scan and mint entirely, and still go green.
  > **Proven:** the core job end to end, with hop 5 asserting INV-UNTRUSTED survives to a consuming
  > context (CELLO's `claim` does NOT contain Bob's sentence; his `statement` is verbatim, flagged,
  > attributed to his key); **(a)** partial — refusal recorded, message queued as an `op: refuse`,
  > and Charlie sees EXACTLY ONE endorsement (two would mean a refused one presented, zero would mean
  > the accepted one stopped); **(a2)** the mint succeeds with the subject's daemon DOWN, nothing is
  > lost, and selecting her agent on return tells her — the FIRST test of that nudge anywhere, a
  > review having found the clause had zero coverage; **(c)** self-endorsement refused at the source,
  > including two agents on ONE daemon, which is the farming shape and the ordinary one given solo
  > multi-agent is the first wedge.
  > **WHAT IT FOUND:** the consent gate was INERT — every endorsement auto-accepted, because the
  > envelope was attributed to the portal instead of its author, so `issuerKind === "agent"` never
  > matched. Both repos' unit suites were green through that; none of them looked at the envelope.
  > **ALL BLOCKERS CLEARED — 2026-07-31, Entry 44. 10 of 10 hops green.** (a)'s correction loop had
  > the refuse-op handler and `submission_results` shipped under it; **(b)** was waiting on
  > `DOD-END-SUBJECTKIND-1`, closed 2026-07-30; **(d)** moved out with `DOD-END-WITHDRAW-1` and its
  > launch half is proven separately. The re-run also found the test itself had rotted twice: 18 call
  > sites still used the pre-rename verbs (spine tests are EXCLUDED from `pnpm run test`, so the unit
  > gate never opened this file), and HOP 6 still asserted `unhandledOps === 1` — "the handler is not
  > built" — failing because the feature was FINISHED. HOP 6 now also asserts the outcome row reaches
  > `submission_results`, since a handler that swallowed the refusal would pass the count alone.
  > **The one unproven clause is not M10B's:** "a `min_count` floor does not count it" needs
  > `DOD-FLOOR-1`, an M10 trust-signal feature deliberately not wired (see `DOD-END-COUNT-1`). — ✅
- **DOD-END-PLAYBOOK-1** — **the architectural proof, M10B's equivalent of the canary.** With M10B's
  machinery in place, a SECOND client-sourced type is taken from nothing to live end-to-end as a pure
  [[M10-TYPE-PLAYBOOK]] run — **`git status --porcelain` clean and `git diff --stat` empty in cello-client
  AND trustless-cello for the entire exercise.** This is what proves the milestone built a *source* and
  two *mechanisms* rather than an endorsement feature: if the second type needs code, the generalisation
  failed and the attestation family is not actually open.
  **The type is a THROWAWAY — `client_canary` — registry-retired the moment the run passes**, exactly as
  `canary_test` was in `DOD-ZEROBUMP-CANARY-1`. This resolves what would otherwise contradict the scope
  fence and [[M10B-PROCEDURE]] §5d ("attestation types beyond `endorsement` are OUT"): the proof needs a
  second type, not a second *product*. **Do not reach into the parked commercial family for it** — a
  referral or review type ships policy decisions that have not been made.
  > **➡️ MOVED 2026-07-30 — first-after-launch.** It proves an *architectural* claim (the source
  > generalises), not a customer-facing one, and its failure is invisible to every journey case. The
  > claim stays falsifiable — the zero-diff bar does not decay — and the per-unit ZEROBUMP lens has been
  > enforcing the same property on every diff all along. Run it before the second real client-sourced
  > type, which is when a failed generalisation would first cost anything. — ➡️ MOVED

---

## Decisions

*(Imported from [[2026-07-27_2049_policy-surface-audit-touchpoints-and-open-decisions]] §12, which remains
the discussion-of-record. Restated here because this is the milestone that implements them.)*

- **D-22 (governing, "ironclad")** — endorsements ARE trust signals. *"The way we do trust signals is the
  way we do endorsements"* — with the addition that endorsements originate at the CLIENT, are minted,
  hashed and stored by the directory, and forwarded to the person being endorsed.
- **D-23** — an endorsement must be ACCEPTED by its subject before it can be presented.
- **D-24** — nothing about you is discoverable; you present, or it is not seen.
- **D-25** — suspending an issuer suspends what they issued, reversibly.
- **D-26** — endorsements do not expire; the issue date travels with them. Age is the point: *"two years
  and no incident"* is worth more than a fresh endorsement, and expiry would destroy exactly the signal
  worth having.
- **D-27** — a same-operator endorsement is minted and MARKED, and the mark is not a warning; its sign
  comes from the endorser's tier to the recipient.
- **D-29** — the same-operator rule splits on `subject_kind`: agent-subject is minted and flagged,
  account-subject is refused. You may not endorse yourself.
- **D-19** — withdrawal takes effect everywhere, including for people who already saw it.
- **D-10** — a sender can never raise their own tier; endorsements inform and prompt, never promote.
- **D-8a** — for any signal with an anonymous and an identified variant, the default is the ANONYMOUS one.
- **D-20** — the credential floor applies to strangers only; a contact classified `known` or above is past
  it and is not re-litigated per call.
- **M10-D5** — `subject_kind` is in the hash; endorsements may target the account or a specific agent,
  defaulting to the specific agent unless requested and agreed.
- **M10B-D2 (2026-07-28) — the ingress is a DIRECTORY-MEDIATED SEALED SUBMISSION QUEUE, not a
  daemon→portal call.** Andre, on being offered a direct portal API: *"shouldn't this go through the
  directory… I'm kind of loath to put that directly into the portal."* Shape: Bob's daemon signs the
  submission with his agent key, seals it to the portal's intake key, writes it to any directory node;
  the portal drains, verifies the signature (deriving `issuer_pubkey` from it — `INV-ATTRIBUTION` comes
  free), scans, mints, notarizes through the unchanged chokepoint. The directory holds a blob it cannot
  read, the same posture as `pickup_queue`. **Three reasons it beats the direct call:** (1) it avoids a
  migration trap — spec §7's destination is per-node intake, and the amendment's promise that moving
  there is *"a routing change, not a migration"* is only true if the CLIENT's wire contract points at
  the directory from day one; with a daemon→portal call, moving intake later means changing every
  installed client. (2) Layering — the daemon has never called the portal (verified: no portal URL, no
  HTTP client, no portal package anywhere in the daemon), and the portal has no transport stack (only
  `crypto` + `protocol-types`); a direct ingress would be the first daemon→portal coupling ever and
  would pin a portal URL into every client's config permanently. (3) Availability — submission rides the
  3-node federated layer with existing failover, so a brief portal outage queues rather than failing at
  the moment Bob submits. **Rejected:** a portal-side CELLO intake agent (spec §7's literal words) —
  it requires a persistent libp2p daemon inside a Next.js app on Fargate, and §7's "intake agent" phrase
  governs the DESTINATION, not the launch shape, exactly as its own constraint-1 amendment does; and the
  direct daemon→portal API call, for (1) and (2) above. **Costs, accepted:** a directory migration and
  a portal drain loop — both ride work the milestone already needs (the one batched directory deploy for
  `DOD-END-REVOKE-2`). **Opens one new question**, assigned to `DOD-END-ARCH-1`: how the daemon learns
  the portal's intake key (manifest is the candidate) and how that key rotates.
- **M10B-D3 (2026-07-28) — `same_operator` is FROZEN INSIDE THE HASH, in neutral wording.** Andre:
  *"Frozen inside the hash. It doesn't need to be long… endorser and endorsee owned by the same account
  (neutral tone)."* Composed at intake before hashing, consistent with scan-before-hash. Accepted
  residual: ownership transfer can make a frozen fact stale; it reads as of the mint date, which travels
  with it (D-26). Neutral tone is load-bearing — D-27 already says the mark is a fact, not a warning.
- **M10B-D4 (2026-07-28) — refusal carries an OPTIONAL message back to the issuer; there is no edit, so
  refuse-and-reissue IS the correction loop.** Andre: *"When you refuse, you can include a message with
  your refusal… what if Bob has given you an endorsement that mistakenly has said something you don't
  want it to say. This is kinda like a LinkedIn recommendation… but we don't really have edit, so it's
  just refuse and redo."* The message is the subject's CHOICE — a silent refusal tells the issuer
  nothing, which is what keeps D-24 intact for anyone who wants it. Consequences: re-issuance after
  refusal is explicitly allowed; it counts against `DOD-END-QUOTA-1` (exempting it makes retry
  unbounded); and the message is operator-authored free text, so it is scanned like any other
  client-supplied plaintext — the same injection surface pointed the other way.
- **M10B-D5 (2026-07-28) — pending items get their OWN surface; they are NOT transcript-inbox items.**
  Andre, reasoning to it live: *"the inbox normally is for transcripts, you get rid of them from your
  inbox by reading the transcript or dismissing the transcript. This doesn't have a transcript. So…
  maybe we should make it a completely different class."* Item lifetime and notification lifetime
  differ: the item persists until accepted or refused; the notification is raised once and stops once
  seen, so `cello_use_agent` does not re-nag. **Named by consent state, never by type** — that is what
  keeps a whole new queue compatible with `INV-ZEROBUMP`.
- **M10B-D6 (2026-07-28) — issuance quota: 100 per rolling 30 days, configurable, enforced per
  ACCOUNT.** Andre: *"let's cap it at a hundred for now, but make that a parameter… rolling thirty days
  is probably better than a calendar."* Moves rate limiting from OUT to IN. Rolling window over calendar
  month (a calendar month gives a burst at every reset). Portal-enforced because that is where minting
  happens. **Per-account is this document's call, not Andre's number changing meaning:** a per-agent cap
  is bypassed by spinning up agents, which is the identical farming hole `INV-NO-SELF-STANDING` exists to
  close — capping per agent would leave the front door open while bolting the back. The cap and window
  are configuration so raising them is a config change, and the refusal names the cause, the cap, and
  when the window frees up.
- **M10B-D7 (2026-07-28) — `endorsement` stays the only type string; "attestation" does not enter
  code.** Andre asked for a recommendation; this is it, and it is cheap to reverse now and expensive
  after a second type ships. The reasoning is forced rather than aesthetic: the wire already HAS an
  umbrella — everything is a signal and `type` is data — so "attestation" would be a third level
  (signal → attestation → endorsement) with no code keying on it. And it could not gain code meaning
  without something testing membership in the family, which is a type-shaped construct and a
  `DOD-END-INV-ZEROBUMP` violation. The family already has a name in code, and it is `issuer_kind:
  agent`. So: "attestation" stays the design-vault umbrella (as it has been since 2026-04-10),
  "endorsement" stays the type. Doc cleanup is fenced to the M10B docs + [[M10-TYPE-PLAYBOOK]].
- **M10B-D8 (2026-07-28) — no anonymous endorsements; D-8a does not reach this signal.** Andre: *"No
  anonymous endorsements."* D-8a governs signals that have both variants; an endorsement's worth is the
  recipient recognising the issuer (`DOD-END-FLOOR-2` joins on exactly that), so an anonymous one is an
  unattributable claim — worth nothing, and precisely what a farm would emit.
- **M10B-D9 (2026-07-28) — an ACCOUNT-subject endorsement is accepted by any one agent under that
  account, in MCP/CLI; no portal acceptance UI ships in M10B.** The question the consent mechanism
  raises but D-23 does not answer: an agent-subject endorsement is obviously accepted by that agent, but
  who consents for the account? Choice: any agent under the account, because M10's account-level signals
  (phone, email) ALREADY fan out to every agent under the account — consent following the same shape
  adds no new concept, and keeps the entire operator surface in MCP/CLI where `DOD-END-SURFACE-1` puts
  it. Rejected: an acceptance screen in the portal — it is a second surface for one verb, and the M8C
  parity rule would then demand it everywhere. Reverse: cheap; adding a portal view later reads the same
  state. Reviewer note: acceptance is recorded once per account-subject signal, not once per agent, or
  four agents produce four consent states for one object.
- **M10B-D10 (2026-07-28) — endorsing requires NO prior session or contact relationship.** Nothing in
  the design gates issuance on having met, and adding that gate would be a new protocol constraint with
  a real cost (you cannot endorse someone you know offline, or vouch for a new agent before it has
  connected — which is exactly the bootstrap case the 2026-04-10 log wanted endorsements FOR). The
  defense is elsewhere and is already sufficient: a stranger's endorsement is **worth nothing to the
  recipient anyway**, because value comes from the recipient's own tier join on the issuer
  (`DOD-END-FLOOR-2`, D-27) — an endorsement from someone Charlie has never heard of does not move
  Charlie. Farming is capped by `DOD-END-QUOTA-1` and by `INV-NO-SELF-STANDING`. Reverse: adding a
  relationship requirement later is a policy change at intake, not a migration.
- **M10B-D11 (2026-07-28, `DOD-END-ARCH-1`) — the portal intake key is published in the CONSORTIUM
  MANIFEST**, as an optional top-level field carrying `{key_id, pubkey}`. This is the question
  `M10B-D2` opened. The manifest wins because it is already the client's authenticated, polled,
  officer-threshold-signed source of consortium-level facts, and — verified, not assumed —
  `canonicalManifestBody` builds the signed body from `Object.keys(manifest)` minus `signatures`
  (`cello-client/core/crypto/src/manifest.ts:74–84`), an **open** field set: a new top-level field is
  automatically covered by the officer signatures, and manifests written before it still verify
  byte-for-byte. Precedent for additive optional fields: `role?`, `peerId?`. **Rotation** is a manifest
  version bump the daemon's existing poll rolls forward (with its `manifest_version_rollback` guard);
  **queued submissions are not stranded** because every queue row records the `key_id` it was sealed
  to and the portal retains a rotated-out private key until no undrained row references it — retention
  driven by the queue, not a timer. Absent key ⇒ the daemon REFUSES and names the reason, never
  unsealed (`ABSENT IS NOT FINE`). **Rejected:** serving the key from `/bootstrap` or a new HTTP route
  — less code, but an unauthenticated distribution channel for a *sealing* key is not a shortcut, it is
  the vulnerability: a substituted intake key means every endorsement Bob writes is sealed to the
  attacker. Also rejected: pinning it in client config, which makes rotation a client release.
- **M10B-D12r (2026-07-28, `DOD-END-ARCH-1`, REPLACES `M10B-D12` — see Entry 7) — the revoke carries an
  INNER, SELF-CERTIFYING authorization signed by the claimed issuer.** `M10B-D12` (struck through
  below) was fatally wrong and the reviewer caught it: `revokeSignal` gates on
  `verifySignedRequest(..., "submitter")`, and per Entry 4's own V1 **the portal is the only submitter —
  Bob never submits.** So Bob's withdrawal reaches the directory signed by the *portal's* key, D-12's
  predicate `tombstone.requester == record.issuer_pubkey` never matches an agent-issued record, and
  **every withdrawal is inert and silent** — `DOD-END-WITHDRAW-1` and D-19, one of the two mechanisms
  `M10B-D1` says this milestone *is*, become a no-op that raises no error. The replacement:
  1. The revoke body carries an inner authorization signed by the **claimed issuer's** key over
     `(domain-tag ‖ signal_hash)`. The directory verifies it **standalone — no record lookup** — so the
     blind INSERT and its F3/F4 ordering freedom survive untouched. Transport signer stays the portal;
     the *authority* is Bob's.
  2. A new **`revoker_pubkey` column**, never an overload of `issuer_pubkey` (which the view treats as a
     placeholder and which `CHECK (issuer_kind IN (…))` constrains).
  3. The effective-status join is **one aggregation level**:
     `ARRAY_AGG(revoker_pubkey) FILTER (WHERE is_tombstone) && ARRAY_AGG(issuer_pubkey) FILTER (WHERE NOT is_tombstone)`
     — two aggregates combined by an operator. `BOOL_OR(x = MIN(y))` is a **nested aggregate and is
     illegal SQL**, which is what D-12 implicitly required.
  4. **Tombstone-only stays fail-closed**: with no non-tombstone row in the group the tombstone is
     effective, exactly as today, and it converges deny→allow when the record replicates in. Without
     this a tombstone-only hash would read `active` and the directory would confirm as live a hash it
     has only ever seen a revocation for — the F4 failure reborn.
  **Accepted residual, to be stated in the DoD line and not left implicit:** a daemon that checked
  during the pre-convergence window recorded `revoked`, and client-side revocation is terminal, so an
  unauthorized tombstone can permanently kill a signal in that daemon. This is bounded by who can write
  a tombstone at all — only a `submitter`-role key — so the read-time check is **defense-in-depth
  against a compromised or second submitter key**, with primary enforcement at the portal verifying
  Bob's inner authorization before it signs.
- ~~**M10B-D12** — revoke authority is evaluated WHERE THE RECORD IS, not
  where the revoke lands.~~ **SUPERSEDED by `M10B-D12r`. Do not build this.** Retained only for the
  verified defect statement it carries (`packages/directory/src/signal-write.ts:561–649`):
  `revokeSignal` authorises on any active `submitter` key and writes a tombstone that hardcodes
  `'portal'` / `'(tombstone)'`, never reading the target — so one submitter key can kill anyone's
  endorsement. **The complication the DoD does not name:** the blind INSERT is load-bearing. It is the
  F3/F4 fix that lets a revoke arriving *before* its record still converge under mesh replication, so
  "look the record up and compare `issuer_pubkey`" cannot be added at write time — at that moment the
  record may not be at this node. Resolution: the tombstone keeps its unconditional blind INSERT but
  records **the requester's real identity**; the authority join moves into `signal_records_effective`,
  where a tombstone kills a record only if the record is `issuer_kind = 'portal'` (any submitter key —
  key rotation must keep working, determination §3.5) **or** the tombstone's requester equals the
  record's `issuer_pubkey`. An unauthorised tombstone is **inert, not rejected**, which is what keeps
  ordering free. Test consequence: a tombstone that lands before its record must become effective the
  moment the record replicates in.
- **M10B-D13 (2026-07-28, `DOD-END-ARCH-1`) — `projectTrustSignals` splits on `issuer_kind`; the
  payload split alone does NOT satisfy `DOD-END-INV-UNTRUSTED`.** Verified at
  `cello-client/core/daemon/src/inbound-sessions.ts:78–98`: the framing axis is already right
  (`issuer: issuerKind === "portal" ? "platform-verified" : "peer-claimed"`, keyed on `issuer_kind`,
  zero-bump-legal), **but** the payload is handed to the LLM as `claim: decodeCbor(payload)` — one
  undifferentiated field for every issuer — under a blanket `directory_attestation` opening *"The
  following trust signals were each verified by the CELLO directory…"*. A correctly split payload still
  arrives as an undifferentiated `claim`, so the split must reach the projection: `portal` keeps
  today's shape; `agent` emits the portal's attested wrapper in the attested position and the
  endorser's words in a distinctly named untrusted field with per-signal framing, and the blanket
  sentence is reworded to state what the directory actually verified (this hash was notarized and is
  active) rather than implying the content is true. This is the concrete form of "how `INV-FRAMING`
  dies quietly", and it generalises to the whole client-sourced family because it keys on
  `issuer_kind`.
- **M10B-D14r (2026-07-28, `DOD-END-ARCH-1`, REPLACES `M10B-D14` — see Entry 7) — consent is required by
  `issuer_kind: agent`, never by type; `consent_state` is `NOT NULL DEFAULT 'pending'` **with an
  explicit backfill `UPDATE` in the same migration**, and `listPresentable` treats anything that is not
  exactly `'accepted'` as unpresentable.** `M10B-D14`'s `DEFAULT 'accepted'` was fail-open on the
  milestone's headline invariant and violated `M10B-PROCEDURE` §5a in as many words — *"a missing or
  unrecognized consent state must make an endorsement UNPRESENTABLE, never presentable-by-default"*
  (verified at `M10B-PROCEDURE.md:469–470`). Its defence rested on a false dichotomy: one extra line of
  SQL gets **both** properties —
  ```sql
  ALTER TABLE wallet_trust_signals ADD COLUMN consent_state TEXT NOT NULL DEFAULT 'pending';
  UPDATE wallet_trust_signals SET consent_state = 'accepted';  -- pre-existing rows are all portal-issued
  ```
  The original reasoning evaluated only the **migration-time** consequence and never the **ongoing-insert**
  one: under `DEFAULT 'accepted'`, `INV-CONSENT` holds only because the delivery path *remembers* to
  write `'pending'`, so any second write path — `cello_restore`, a backup import, a future
  client-sourced type, a refactor — silently makes an unconsented agent-issued signal presentable, with
  no error and no log. Everything else in D-14 stands: keying on `issuer_kind` (not
  `type == "endorsement"`) is the generalisation `M10B-D1` demands, and `consent_state` stays distinct
  from `default_present` (*may* it be presented vs. *include it by default*).
- ~~**M10B-D14** — `consent_state` defaults to `accepted`.~~ **SUPERSEDED by `M10B-D14r`. Do not build
  this — it is fail-open.** Original text retained for the reasoning trail: A new column on `wallet_trust_signals` (which already
  carries additive `ALTER TABLE … ADD COLUMN` migrations — `trust-signal-store.ts:184–188`), with
  `listPresentable` filtering on it. **The default direction is a correctness decision, not a style
  one:** `DEFAULT 'accepted'` leaves every existing portal-issued row presentable, and only the
  delivery path writes `'pending'`, only for agent-issued signals. Defaulting to `'pending'` would
  silently make every phone/email signal already in every wallet unpresentable — a data-loss-shaped
  bug that raises no error. Keying on `issuer_kind` (not `type == "endorsement"`) is the
  generalisation `M10B-D1` demands: every future client-sourced type inherits consent for free. Note
  `consent_state` and the existing `default_present` answer different questions — *may* it be
  presented, versus *include it by default* — and conflating them is the trap.
> ### ⚠️ SECOND REVIEW (Entry 10): `M10B-D12r`, `M10B-D14r` and `M10B-D19` are ALL SUPERSEDED
> Three of Entry 7's four replacement decisions did not survive contact with the code. Read
> `M10B-D12r2`, `M10B-D14r2` and `M10B-D25` below **instead of** them. Each failed the same way — the
> mechanism was reasoned about without reading its consumer.

- **M10B-D12r2 (2026-07-28, REPLACES `M10B-D12r` — Entry 10) — the effective-revoked expression needs
  THREE ordered branches, and the array-overlap form alone FAILS OPEN.** Proven on live Postgres 18,
  not argued: `ARRAY_AGG(x) FILTER (WHERE p)` over zero matching rows returns **`NULL`, not `'{}'`**;
  `NULL && anything` is `NULL`; a `NULL` `WHEN` falls through to `ELSE 'active'`. So `M10B-D12r`'s
  clause 4 claim that "tombstone-only stays fail-closed" is **false — it reads `active`**, which is
  exactly the F4(b) defect it claimed to close. Two further fail-opens D-12r did not see: legacy
  tombstones carry `revoker_pubkey IS NULL` and `{NULL} && {'bobkey'}` is `false`, so the migration
  would **silently un-revoke every existing revocation**; and array overlap *is* exact-pubkey matching,
  so dropping the `issuer_kind='portal'` escape strands every portal-issued record the moment the KMS
  key rotates — the precise outcome `signal-write.ts:539–546` exists to prevent, and which the struck
  `M10B-D12` had correctly kept. **Required shape, in this order:**
  1. `COUNT(*) FILTER (WHERE NOT is_tombstone) = 0 AND BOOL_OR(is_tombstone)` → `'revoked'`
     (tombstone-only, fail-closed, preserving today's behavior).
  2. **`BOOL_OR(is_tombstone AND revoker_pubkey IS NULL)` → `'revoked'`** — added as `M10B-D12r3`
     (Entry 11) after running D-12r2 on Postgres showed it **still silently un-revoked** an
     agent-issued record carrying a legacy tombstone. A tombstone with no recorded revoker was written
     under the old role-based rule and had its authority checked then; it keeps its old semantics
     rather than being re-judged by a rule younger than it is. Unreachable today (no `issuer_kind:
     agent` records exist yet) — which is precisely why §5a says to fix it anyway.
  3. The portal escape: a role-authorized tombstone kills an `issuer_kind='portal'` record, so key
     rotation keeps working (determination §3.5).
  4. `COALESCE(<overlap>, false)` for the agent case.
  **MEASURED on live Postgres, all six group shapes (Entry 11): `D-12r3` differs from today's
  `BOOL_OR(status='revoked')` on exactly ONE row — the `revoker ≠ issuer` case, which is the F6 defect
  being fixed.** Every convergence and rotation property is preserved unchanged. This validated the
  *expression*; substituting it into V46's real `CASE` is the first task of Tier 3.
  > ### 🚨 `M10B-D12r4` — CORRECTED (third review F3). The clause below was WRONG and mandated a NO-OP.
  > **It REPLACES the `BOOL_OR(r.status = 'revoked')` branch. It does NOT supplement it.** The original
  > text said the opposite, while citing Entry 11's table — which was **measured on the replacement
  > form**. Mechanism: `signal-write.ts:634–641` inserts the tombstone with `status='revoked'` and
  > **deliberately leaves the real notarization row `active`**, so `BOOL_OR(r.status='revoked')` fires
  > on *every* tombstone regardless of authority. Keep it as a leading branch and the authority
  > branches are **never reached** — the unauthorized-tombstone case still reads `revoked` and the F6
  > fix does nothing. **Re-measured (Entry 14): supplement → `revoked` (no-op); replace → `active`
  > (correct).**
  > **Two further corrections:**
  > - **A FIFTH branch is required**, ordered second: `BOOL_OR(status='revoked' AND NOT is_tombstone)`
  >   → `'revoked'`. A real non-tombstone row carrying `status='revoked'` reads `revoked` today and
  >   would read `active` under the bare replacement. No writer produces it now — but `UPDATE` is
  >   granted, `'revoked'` is in the column `CHECK`, and `signal-write.ts:293` already does
  >   `UPDATE … SET status='superseded'`. This is the **identical** §5a argument used to justify branch
  >   2 for the legacy-tombstone case, which was not applied to this expression.
  > - **The branch-order claim was misstated.** All of these branches yield `'revoked'`, so order
  >   *among them* is immaterial. What IS load-bearing and was unstated: **the revoke branches must all
  >   precede the SUPERSESSION branches**, or a revoked-and-superseded record reads `superseded`,
  >   contradicting V46's rule that revoked is the strongest statement.
  > **Scope of the evidence, honestly:** "differs from today on exactly one of six shapes" was true only
  > of the six shapes chosen. **Re-measured inside V46's real `CASE` (Entry 15) and independently
  > re-derived by the fourth review: nine shapes, exactly one changes, and the ordering and fifth-branch
  > claims both hold.** Three further items that measurement surfaced:
  > - **A TENTH shape changes — `issuer_kind='directory'` records become UNREVOCABLE.** Branch 4 tests
  >   `issuer_kind = 'portal'`, so a `directory`-issued record gets exact-pubkey matching with no
  >   rotation escape. V46 deliberately admits `'directory'`; nothing issues it today — which is the
  >   **identical §5a argument used twice already** to add branches 2 and 5, and I failed to apply it a
  >   third time. **DECIDED: extend branch 4 to `issuer_kind IN ('portal','directory')`.** The escape
  >   exists because *"the portal is ONE logical issuer; its keys are rotating instruments"* — and that
  >   is equally true of the directory, whose node keys also rotate and whose records would otherwise
  >   become permanently unrevocable on the first rotation. The general rule, stated so the next
  >   `issuer_kind` is not another one-off: **role-based authority for INSTITUTIONAL issuers (portal,
  >   directory); exact-pubkey authority for AGENT issuers, where the key IS the identity.** An
  >   unrecognized future `issuer_kind` must fall to the **agent** (stricter) side, never to the
  >   institutional escape.
  > - **It BREAKS V46's documented monotonicity invariant, and that must be stated in the migration.**
  >   V46's header says *"revoked — if ANY node's copy says revoked. Revocation is monotonic … this
  >   converges regardless of arrival order."* Under `D-12r4` an unauthorized tombstone that lands
  >   first reads `revoked`, then reads **`active`** once the real record replicates in — a
  >   `revoked → active` transition reachable through ordinary convergence with no write. Branch 1
  >   preserves today's behavior only until the real row arrives. The invariant change must be written
  >   down, or the code contradicts its own documentation.
  >   > **⚠️ CORRECTION TO THE REVIEW — do NOT "amend V46's header comment".** V46 is an **APPLIED**
  >   > migration (the directory is at V48), and **Flyway checksums the entire file, comments
  >   > included**. Editing it triggers a checksum error on every node and crash-loops the ops-agent,
  >   > which validates the migration version — and the repo's own hard rules are explicit: *"Never
  >   > modify an applied migration"*, plus a standing AC that *"Flyway reports zero checksum errors on
  >   > all prior migrations (V1 through V[N-1])"*. **The corrected superseding statement goes in the
  >   > NEW migration's header** (the one that replaces the view), stating what it changes about V46's
  >   > claim and why. That is the only place it can go, and it is also the right place — the migration
  >   > that changes the behavior is the one that should document the change.
  > - **The exact-column-set gate will go red.** `m10-store-dir-1-v46-signal-records.test.ts` asserts
  >   `signal_records`' columns exactly, with a comment that any new column *"goes red here and has to
  >   be justified"*. `D-12r4` adds `revoker_pubkey` and `M10B-D28` adds the persisted signature. Write
  >   the justification here, so the coder does not decide alone whether to loosen a deliberate gate. `revoker_pubkey` must be **`TEXT`**: `bytea[] && text[]` and
  `text[] && varchar[]` both error at `CREATE VIEW` time. Two things D-12r got right and are confirmed:
  the tombstone INSERT is genuinely blind (no `SELECT` between auth and insert), and a multi-issuer
  hash group cannot exist because `issuer_pubkey` is inside the preimage — so there is no
  cross-authorization hole.
- **M10B-D25 (2026-07-28, REPLACES `M10B-D19` — Entry 10; also renamed, `M10B-D19` collided with spec
  `D-19`) — the submitter return path needs its OWN carrier; it CANNOT ride the pickup path.**
  `M10B-D19` claimed reuse; the path refuses it at both ends. (1) `deliverSignal` rejects anything whose
  `signal_hash` is not already a notarized non-tombstone record (`signal-write.ts:459–465`) — a refusal
  notice has none, and notarizing one to pass the gate writes every rejection into replicated
  `signal_records`, destroying the privacy rationale. (2) The daemon funnels every pickup through
  `decodeTrustSignalEnvelope`, a fixed 11-element CBOR array, so a `submission_result` throws and
  **returns without ACK** — and ACK is what deletes, so the row redelivers on every reconnect forever
  while holding the one pending slot. (3) V37's upsert destroys the second result, re-creating the
  exact silent failure F2 was raised to close. (4) Pickup delivery is push-on-signaling-reauth only, so
  a timeout would fire on a live connection. **Required instead:** a dedicated `submission_result`
  table drained on the same reauth hook with its own ack semantics and **no supersede-by-kind** (one
  message per event, not one current value per fact), or a new signaling frame kind.
  > **DECIDED as `M10B-D25r` (Entry 12) — it is BOTH: a new signaling frame kind plus its own
  > replicated table.** `directory-frames.ts` is an open additive set (~25 outbound encoders), and
  > `trust_signal_pickup` + `TrustSignalAck` is the exact push-then-ack-deletes precedent. Table:
  > `submission_results (agent_id, submission_id, sealed_result, created_at)`, PK
  > `(agent_id, submission_id)`, **one row per event, NO supersede-by-kind**
  > — **PK CORRECTED to `(agent_id, submission_id, writing_node)` as `M10B-D25r2` (third review F1).**
  > A natural-key PK on a **replicated** table can **wedge ALL federation**: a subscriber's apply worker
  > enforces PK/UNIQUE, so one duplicate stops the *entire* subscription — every published table, not
  > just this one (V46's header documents this, measured). And the duplicate arrives through the
  > **designed** path: the portal reaches the directory via an ordered failover list, so write-to-A →
  > response lost → fail over to B → two rows, identical natural key, both replicate.
  > `ON CONFLICT DO NOTHING` does not help — replication applies the **row**, not the statement.
  > **The `pickup_queue` precedent does not transfer:** it is safe because it is `BIGSERIAL` and
  > `setup-replication.sh` staggers sequences into per-node residue classes so cross-node collision
  > cannot occur — a property a natural key does not inherit. Mirror V46's own
  > `(signal_hash, accepting_node)`; dedupe by `(agent_id, submission_id)` on the drain; ack deletes
  > all copies for the pair.
  > **Also (third review F2) — name the skew symptom:** `decodeInboundSignalingFrame` returning `null`
  > replies `not_authenticated`, so an upgraded daemon acking to a directory node that has not yet taken
  > this migration gets an **auth-flavoured name for a version-skew bug**. Directory nodes are sovereign
  > and deploy independently per region, so this is the *normal* rollout case, not an edge. Add an
  > `unsupported_frame` reply carrying the received `type`; until then it is a documented symptom so the
  > first operator to hit it is not sent to debug keys. **Note the limit honestly (fourth review):**
  > `unsupported_frame` **cannot cover the window it is for** — a node that has not deployed cannot send
  > the new reply — so it buys nothing for *this* rollout and only helps future ones. The documented
  > symptom is the actual mitigation here.
  >
  > ### ✅ `submission_results` — THE AUTHORITATIVE SHAPE (fourth review HIGH-3; restated once, here)
  > ```sql
  > CREATE TABLE submission_results (
  >   agent_id       TEXT        NOT NULL,
  >   submission_id  TEXT        NOT NULL,
  >   writing_node   TEXT        NOT NULL,   -- the node component; without it a failover duplicate wedges federation
  >   sealed_result  BYTEA       NOT NULL,
  >   created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  >   PRIMARY KEY (agent_id, submission_id, writing_node)
  > );
  > ```
  > Earlier prose gave a PK naming a column the column list omitted. This block supersedes it.
  > - **DEDUPE TIEBREAK (fourth review MEDIUM-4).** The drain dedupes on `(agent_id, submission_id)`,
  >   but **V46's justification for a bare `MIN()` does NOT transfer**: V46 can pick any copy because
  >   *"the copies agree on every hashed field — content-addressing guarantees it"*, and
  >   `sealed_result` is **not** content-addressed — two nodes produce different ciphertext and could
  >   in principle seal different outcomes. Tiebreak: **lowest `writing_node`**, deterministic across
  >   nodes. (Same shape as the `pickup_queue` error just corrected: a property asserted from a
  >   precedent that does not have it.)
  > - **🚨 PUBLICATION MEMBERSHIP IS A REQUIRED CLAUSE (fourth review HIGH-2).** `submission_results`
  >   **must be added to `PUBLICATION_TABLES` in `infra/setup-replication.sh`**, and the script re-run
  >   in all three regions. Miss it and the feature builds complete, passes single-node tests, and
  >   **silently delivers nothing**: result written to node A → daemon reconnects to node B → drain
  >   returns zero rows → no frame, no log, no error. `signal_records` and `authorized_issuers` are
  >   already in that list, so the step is established practice — it was simply never written down here.
  > - **The ack's cross-node delete is sound but DIVERGES from the one precedent, so say why.**
  >   `sweepUndeliverablePickups` scopes its multi-row delete *"to this node's own rows for replication
  >   safety"*; this ack deliberately deletes **all** copies for the pair. That is safe — the publication
  >   is created with no `WITH` clause so DELETE is published, and REPLICA IDENTITY defaults to the PK —
  >   but the divergence must be stated rather than left to look like an oversight. **Residual:** a copy
  >   in flight during the ack survives and is redelivered once, so **the client sink must be
  >   idempotent** — which "one row per event, no supersede-by-kind" does not provide on its own. (that upsert is what killed
  > `M10B-D19`), ack scoped to `(submission_id, agent_id)` like `ackPickupDelete` — an id-only delete
  > would let any authenticated agent wipe another's undelivered results.
  > **It IS replicated, unlike `submission_queue` (`M10B-D21`), and the asymmetry is direction not
  > inconsistency:** the submission queue is *collected* by one consumer that can poll every node; the
  > result queue is *delivered* to a daemon that reconnects to whichever node it likes, so an
  > unreplicated result would simply never arrive. Same reason `pickup_queue` is replicated.
  > **Verify first, do not assume:** that an unknown frame `type` is IGNORED rather than fatal on the
  > daemon's inbound path — if unknown frames throw, this frame breaks the signaling stream of every
  > daemon that has not upgraded yet.
  > **Residual, logged against the parked `DOD-END-DISCOVER-1`:** for a minted submission, the envelope
  > to Alice and the result to Bob land seconds apart, so timing correlation partially re-creates the
  > pairing on metadata even though `submission_id ≠ signal_hash`. Not claimed as solved.
  The decision must also name the **client-side sink** — `wallet_trust_signals` is envelope-shaped and cannot hold
  `{outcome, cause, detail}`, so this is a SQLCipher migration on operators' machines, which `D-19`
  did not acknowledge.
- **M10B-D14r2 (2026-07-28, REPLACES `M10B-D14r` — Entry 10) — the consent filter goes in the SQL of
  `listAllActive`, and the backfill MUST follow `contacts-tier-migration.ts`.** Two independent defects
  in `M10B-D14r`:
  1. **It named a dead enforcement point.** `listPresentable` has **zero production callers**
     (verified: only its own definition and two comments outside tests). The live wire path is
     `listAllActive`, called once at `outbound-sessions.ts:186`. A filter written per D-14r ships as
     dead code with a green suite while the live path presents unconsented endorsements. The predicate
     goes in the **SQL** (`AND consent_state = 'accepted'`), not a JS branch — `listAllActive`'s
     `include` branch already routes around `default_present`, and the identical shape would route
     around consent.
  2. **The backfill clobbers real consent on every daemon boot.** The client DB has **no migration
     versioning**, and `ensureTrustSignalSchema` runs on every `startDaemon` behind a bare `catch {}`.
     D-14r's `ALTER …; UPDATE … SET consent_state = 'accepted';` as siblings makes the UPDATE
     unconditional: **an operator who REFUSES an endorsement has it flipped back to `accepted` on the
     next restart**, silently, and it becomes presentable. Use the pattern the repo already carries and
     documents (`contacts-tier-migration.ts:116–177`): `PRAGMA table_info` column-birth gate, ALTER +
     backfill in one `BEGIN…COMMIT`, **rethrow** on failure, and **no column DEFAULT** so the backfill
     has a real discriminator. Dropping the DEFAULT means D-14r's `NOT NULL DEFAULT 'pending'` goes
     with it. The column must also be added to `CREATE_WALLET_SQL` or the fresh-vs-migrated DDL
     equality test fails.
  *Correction to D-14r's reasoning, for accuracy:* its "`cello_restore`, a backup import" second write
  path **does not exist** — those commands are stubs. Fail-closed is still right; that was a future
  hazard stated as a present defect.
- **M10B-D28 (2026-07-28, from second-review H6 — Entry 13) — the WITHDRAWAL rides the submission queue
  as an `op`-discriminated sealed body, and its inner authorization is TIME-BOUND and PERSISTED.**
  `M10B-D12r3` fixed the revoke *predicate*; `M10B-D25r` fixed the *result* path. Neither carried Bob's
  withdrawal **to** the portal — the daemon never talks to the portal (`M10B-D2`), and Entry 8 designed
  the queue only around mint-shaped outcomes. Three parts:
  1. **Carrier.** The sealed body becomes `{v:1, op:"submit"|"withdraw", …}`, reusing the discrimination
     `signal-write.ts` already applies to `SignalSubmitRequest`/`SignalRevokeRequest`. **Not an
     `INV-ZEROBUMP` violation:** `op` is an *operation*, not a signal *type* — the directory already
     branches on `op`, nothing tests a `type` string, and a future client-sourced type inherits both ops
     for free. The queue's five-column shape is unchanged because `op` lives *inside* the sealed
     ciphertext, so the directory still cannot tell a withdrawal from an endorsement.
  2. **Replay bound.** The inner TBS becomes `(domain-tag ‖ signal_hash ‖ issued_at)`, bounded by the
     existing `CLOCK_SKEW_SECONDS = 600`. As previously sketched — `(domain ‖ signal_hash)` with no
     timestamp — it was **a permanent bearer capability to revoke that hash at every node forever**.
     `SignalRevokeRequest` already carries `issued_at`, so this is the existing pattern, not a new
     primitive. The TBS builder must live in `@cello-protocol/protocol-types` (daemon and portal must
     produce identical bytes), and the domain tag must not collide with `CELLO-TSIG-v1` or
     `CELLO-TSIG-REQ-v1`. Adds a third cello-client package to the publish debt.
  3. **Self-certifying at rest.** The tombstone persists the inner **signature** alongside
     `revoker_pubkey`. Logical replication applies rows and never re-runs `revokeSignal`, so without
     this a peer node accepts whatever revoker the originating node wrote — one compromised node could
     forge any revoker and the other two would treat it as authoritative, which is exactly where
     `M10B-D12r3`'s read-time defense stops working.
     > **CORRECTED (third review F6) — this is AUDIT EVIDENCE, not a defense, and must be labelled as
     > such.** Nothing verifies the persisted signature: `M10B-D12r4`'s read path is a **SQL view**, and
     > a view cannot check Ed25519. So a forged tombstone still reads `revoked` on all three nodes — the
     > column makes forgery *detectable in principle* and prevents nothing. NO CONSUMER, NO SHIP applies:
     > either name the verifier (a subscriber-side validation pass, or verify-on-read before serving a
     > `revoked` verdict) or state plainly that the compromised-node case remains **open**. Claiming a
     > mitigation that mitigates nothing is worse than naming the residual.
  **Also settled:** a withdrawal does **not** count against `DOD-END-QUOTA-1`. The quota caps issuance
  and a withdrawal issues nothing; charging it would penalise the correct behavior of retracting a bad
  endorsement.
- **M10B-D26 (2026-07-28, from second-review H3) — `agent_profiles.account_id` is NULLABLE BY DESIGN,
  so `M10B-D18` surfaces the gap rather than closing it; the completeness prerequisite must be decided
  in writing.** `V23`: *"account_id is nullable — pre-M6 agents have no account. NULL means 'not yet
  linked'."* Two live paths reach NULL: registration without a pre-auth token, and a resolution failure
  that is deliberately swallowed (`preauth.account.link.failed`, logged, registration proceeds — the
  comment says account resolution must not block registration). Under §5a's absent⇒refuse, **an entire
  class of registered agents can never issue an endorsement**, and `DOD-END-QUOTA-1`'s per-account cap
  is uncomputable for them. Decide one: registration requires an account (close both NULL paths), or
  account-less agents are permanently refused with a named, surfaced cause. It is currently neither,
  and D-18 alone does not unblock the four lines it was written for.
  > **DECIDED as `M10B-D26r` — account-less agents are REFUSED at endorsement intake; registration is
  > NOT changed.** Rejected: making registration require an account. It closes both NULL paths, but
  > `directory-node.ts:2952–2955` swallows the link failure **deliberately** — *"Account resolution
  > failure must NOT block registration"* — which is an availability decision in the registration path.
  > Overriding it from an endorsement milestone trades a real invariant (you can always register) for a
  > feature gate. Refusing at intake is local, needs no migration, and is *honest*: the quota is
  > per-account (`M10B-D6`), so an agent with no account has **no quota bucket to charge** — minting for
  > it would mean minting outside the cap entirely, which is the farming hole by another door.
  > **Blast radius is near-zero at launch:** account-less rows are the pre-M6 legacy shape (`V23`) plus
  > the token-less registration path; every agent registered through the portal's pre-auth flow carries
  > an `account_id`. **The refusal must be ACTIONABLE, not merely named** —
  > `operator_linkage_unresolved` must tell the operator to link an account in the portal, or a bare
  > cause reads as a bug in a path they cannot see. Reverse: cheap — requiring an account later is a
  > registration policy change, not a data migration.
  > **CORRECTED as `M10B-D26r2` (third review F4). The refuse-at-intake choice STANDS; two claims
  > around it were wrong.**
  > - **The near-zero blast-radius claim is WITHDRAWN — and it is falsified by the very code D-26r
  >   cites.** A *pre-auth* registration whose `resolveAccountId` throws is caught, logged
  >   `preauth.account.link.failed`, falls through with `accountId` still `null`, and returns
  >   `register_success`. So one transient DB error at registration produces an account-less agent on
  >   the **modern** path, not only the legacy one.
  > - **The refusal currently points at a flow that DOES NOT EXIST.** `linkAgentToAccount()` exists and
  >   `V28` grants the UPDATE it needs, but it has **zero production callers** and no portal route
  >   touches `agent_profiles.account_id`. So "link an account in the portal" is a dead end — the exact
  >   error-fidelity failure D-26r claimed to avoid. **Prerequisite:** wire `linkAgentToAccount()` to a
  >   portal route before `operator_linkage_unresolved` ships, or the refusal is unactionable and a
  >   transient error becomes a permanent, unannounced disqualification.
  > ### 🚨 CORRECTED AGAIN (fourth review HIGH-1) — that prerequisite as written is an AUTHORIZATION
  > ### BYPASS ON THE KILL SWITCH. Do NOT wire `linkAgentToAccount()` as-is.
  > Verified in the function body (`pre-auth-token-repository.ts:500–547`):
  > - **`linkAgentToAccount` performs NO ownership check.** It is
  >   `UPDATE agent_profiles SET account_id = $1 WHERE k_local_pubkey = $2` — nothing proves the caller
  >   controls that agent key, and `k_local_pubkey` is a **public** value discoverable from the
  >   directory.
  > - **`resolveAccountId` CREATES an account** when none matches the supplied phone stub
  >   (`:504–528`) — it does not bind to the caller's portal session.
  > - **`agent_profiles.account_id` is the authorization root for the kill switch.** The write seam
  >   derives scoping from it *"NOT from a request field"*, and it fronts pause/**burn** — and burn is
  >   monotonic and terminal.
  > Composed: attacker's own phone stub + victim's public `k_local_pubkey` → the victim's agent is
  > reassigned to the attacker's account → the attacker can **permanently burn it**. The unused
  > `agentProfileId` in the params interface is the tell that the body was never read.
  > **So F4 is NOT a one-line prerequisite. It is its own DoD line, `DOD-END-ACCOUNTLINK-1`, with ACs:**
  > proof-of-control over the agent key (a signature from `k_local`, not possession of its public half);
  > link to the **session's** account, never `resolveAccountId`'s create path; remove the dead
  > `agentProfileId`; and a **negative test** that a caller cannot link an agent they do not control.
  > **This is the fifth instance of the milestone's recurring pattern** (Entry 14) and the first where
  > the un-read mechanism is a privilege-granting write — which is exactly why the pattern is worth
  > naming rather than just fixing case by case.
- **M10B-D27 (2026-07-28, from second-review H4) — the retention ordering in Entry 8 was BACKWARDS; the
  queue-driven rule in `M10B-D11` stands.** Entry 8 wrote "sweep TTL **longer** than the intake-key
  retention window" — the direction that *guarantees* stranding, because a row then outlives the key it
  is sealed to, becomes undecryptable, and is lost as poison with no reply. Safe is `T ≤ W`. It also
  contradicted `M10B-D11`, which already had the correct **queue-driven** form ("retain the key until
  no undrained row references it"); D-11 is authoritative and Entry 8's timer-driven replacement is
  withdrawn. **Neither constant exists yet:** the pickup `24` is a default parameter duplicated in
  three files, and nothing named `intake_key` exists in either repo — so Entry 8's proposed "assert on
  the constants" test would have pinned an inverted invariant over constants that must first be
  invented.
- **M10B-D20 (2026-07-28, `DOD-END-QUEUE-1`) — `submission_id` = sha256 of the SIGNED submission body,
  and it is the queue's primary key.** Content-derived, so a daemon retry to a different node produces
  the same id and the portal mints once — which is what makes retry-on-node-failure safe rather than a
  duplication mechanism. A legitimate re-issue after a refusal differs, because `issued_at` is inside
  the signed body. Uncollidable: to collide you would have to sign someone else's bytes.
  > **CORRECTED (second review H9) — the id is CALLER-SUPPLIED and the directory cannot verify it.** It
  > cannot open the seal, so it cannot check the PK; the clause above describes what the id *is*, not
  > what anyone *checks*. A daemon writing the same body under two different ids to two nodes gets
  > **two mints and double quota consumption** — the exact outcome D-20 exists to prevent. Required:
  > **the portal derives `submission_id` from the opened body**, treats the row's id as a routing hint
  > only, and discards any row whose id disagrees. Attribution lens — never caller-supplied.
  > **Also corrected:** `owning_node_id` is DROPPED from the column set (H10) — its entire purpose is
  > stopping a non-converged replica from sweeping rows it did not write, which cannot arise on an
  > unreplicated table. NO CONSUMER, NO SHIP. And Entry 8's "mirrors `sweepUndeliverablePickups`" was
  > wrong: that sweep is not age-based, it targets `signal_hash IS NULL` legacy orphans only, so a
  > normal pickup row is never swept.
  **Exactly-once
  is a PORTAL property, not a queue one** — even a perfect queue cannot cover the portal crashing
  between minting and acking, so the queue promises at-least-once and the portal holds a
  processed-submissions record keyed on this id.
- **M10B-D21 (2026-07-28, `DOD-END-QUEUE-1`) — `submission_queue` is NOT replicated, and the portal
  drains EVERY node rather than failing over between them.** Not added to `cello_pub`; precedent is
  `V40__pre_auth_nonce_bindings.sql`, which is deliberately unreplicated and says so. A replicated queue
  lets the portal drain the same row from node B while its ack to node A is in flight — double-drain,
  double-mint, double quota consumption. **Accepted loss:** a submission on a permanently dead node.
  Recoverable by re-submitting; the thing that must never be lost is the *notarized record*, and
  `signal_records` **is** replicated. **Consequence for `DOD-END-INGRESS-1`, and it is a specific silent
  bug:** draining means "collect from all", not "try until one succeeds" — a drain built on
  `FailoverDirectoryClient#tryEach` collects from one node and reports success.
- **M10B-D22b (2026-07-28, `DOD-END-QUEUE-1`) — poison is UNATTRIBUTABLE BY CONSTRUCTION and therefore
  gets no reply.** Identity is derived from the submission signature, so a blob that will not open or
  whose signature will not verify has no known sender — there is nobody to reply to. The row leaves the
  queue exactly once with a `signal.ingress.poison` event and its cause, never retried, never left to
  block. The DoD's "with its reason preserved" is satisfiable for *rejected* and not for *poison*, and
  naming that is better than inventing a return channel to an unknown party. (Suffixed `b` to avoid
  colliding with M10's D-22.)
- **M10B-D23 (2026-07-28, `DOD-END-DELIVER-1`) — `pickup_queue`'s pending uniqueness re-keys to
  `(agent_id, signal_kind, signal_hash)`** (V50, same batched deploy). Without it the second endorsement
  of any subject is **silently destroyed** — `enqueuePickup`'s `ON CONFLICT (agent_id, signal_kind)`
  plus V37's partial unique index means the second delivery overwrites the first with no error and a
  success return, and journey case (a2) is exactly the scenario that triggers it (Entry 6). Both of
  V37's rationales are discharged with evidence (Entry 9): the poison pill required the
  `identity_tree_entries` anchor to disagree with, and **V48 dropped that table** — the daemon's
  surviving `hash_mismatch` now compares a delivered envelope against the claimed hash on its *own* row,
  so it fires on corruption, never staleness; and the READ COMMITTED duplicate-row race stays closed
  because identical content still collides. **Rejected:** giving endorsements a per-submission
  `signal_kind` (`endorsement:<hash>`) to dodge the migration — it smuggles content into a kind field
  and is a blocking `INV-ZEROBUMP` finding.
- **M10B-D24 (2026-07-28, `DOD-END-DELIVER-1`) — the fan-out set resolves from the SUBJECT's account,
  and a failed resolution REFUSES delivery** with a named cause rather than falling back to any other
  agent set (§5a). Resolving from the submitter would deliver Bob's endorsement to Bob; falling back on
  failure would be a cross-tenant delivery of a third party's endorsement. For `subject_kind: account`
  the delivery is per-agent but the **consent decision is per-signal** (`M10B-D9`) — four agents must
  not produce four consent states for one object.
- **M10B-D18 (2026-07-28, `DOD-END-ARCH-1`, from review F1) — a new directory internal route resolves
  AGENT PUBKEY → ACCOUNT, mirroring `/internal/account-by-email-stub` exactly.** The clause
  `DOD-END-ARCH-1` marked *"confirm that resolution exists before relying on it"* was declared settled
  without being addressed; it does not exist. The directory has only the **forward** direction
  (`/internal/agents-by-account`), and the reverse join lives in SQL at `internal-api-server.ts:791`
  but is exposed on no route. **This blocks four lines, not one:** `DOD-END-SUBJECTKIND-1` (both
  branches — `same_operator` needs *both* parties' accounts), `DOD-END-QUOTA-1` (a per-**account**
  quota computed from a submission whose only identity is an agent pubkey — without this the cap
  degrades to per-agent, the exact farming hole `INV-NO-SELF-STANDING` closes), `DOD-END-SUSPEND-1`,
  and `M10B-D3`'s composition point. Under §5a every mint refuses until it lands. **It is not new
  architecture:** `resolveAccountByEmailStub` is the working precedent, with the `DirectoryClient`
  interface (`client.ts:62`) and all three implementations already in place (`http-client.ts:47`,
  `failover-client.ts:24`, `stub-client.ts:62`) — so the new method inherits the failover the
  sovereign-node invariant requires. Rides the one batched directory deploy with V49 and the revoke
  change. Missing resolution ⇒ named refusal `operator_linkage_unresolved`, never a bare
  `intake_rejected`.
- **M10B-D19 (2026-07-28, `DOD-END-ARCH-1`, from review F2) — the intake RESULT returns to the
  submitting agent over the sealed pickup path, sealed to the submitter.** Entry 4 gave the intake key
  a full decision and gave the reverse direction nothing, while three lines require a named cause to
  reach the submitter (`DOD-END-INGRESS-1`, `DOD-END-QUOTA-1`, `DOD-END-SUBJECTKIND-1`). There is
  exactly one possible carrier: `M10B-D2` establishes that the daemon never talks to the portal and
  the portal has no transport stack, so the result rides the **M10-D22 sealed pickup path** as a sealed
  `submission_result{key_id, submission_id, outcome, cause, detail}`. **It must be sealed** — a
  plaintext reason in a directory-readable column ("scanner rejected your endorsement of ⟨subject⟩")
  leaks who endorsed whom, which is what `DOD-END-QUEUE-1` and D-24 exist to prevent. The queue row
  therefore carries an opaque `submission_id` plus the sealed-reply routing. Also settles what the DoD
  left open: the poison transition (a row that can never succeed leaves the queue exactly once with its
  reason sealed and returned), the sweep TTL, and what the daemon reports when its submission is swept
  unanswered. **Without this the primary flow fails silently** — the reviewer's trace: Bob's last log
  line is `signal.submission.queued`, and 24h later the row is swept with no event of any kind.
- **M10B-D15 (2026-07-28, `DOD-END-SCAN-1`) — `scanner_version` is DERIVED FROM THE RULE CORPUS, never
  hand-maintained.** Shape: `intake-v1+<12 hex of sha256 over the canonical serialization of the active
  rule set>` (pattern ids + sources, secret rule ids, charset class, length cap, URL policy). A
  hand-bumped constant goes stale the first time someone edits a regex and forgets — and because the
  directory cannot re-run the scan, that stale value is notarized as **evidence of a scan that did not
  happen** (`DOD-DIR-WRITE-1`'s own reason for making the field signed). Deriving it makes drift
  impossible by construction and gives spec §7 constraint 2 a mechanically checkable definition of
  "byte-identical": two intakes agree iff their derived versions agree. Verified: no scanner version
  constant exists anywhere today.
- **M10B-D16 (2026-07-28, `DOD-END-SCAN-1`) — intake reuses the gateway's rule CORPUS but owns its own
  VERDICT POLICY.** The deterministic Layer-1 detectors (`detect/injection-patterns.ts` over RE2,
  `detect/secrets.ts`) are the right shared component and satisfy §7 constraint 2. But the gateway's
  disposition is deliberately inverted from intake's: *"it is not, by itself, an auto-block. CELLO is
  not a moderation tool; this surfaces evidence, it does not police content."* Intake is reject-always,
  fail-closed (§7 constraint 3, §14.1). Reusing `InboundScreener`'s verdict would produce a scanner
  that passes its tests and never refuses anything. **The DeBERTa Layer-2 scanner is excluded
  outright** — §7 says "No LLM"; it degrades OPEN when the model is absent (intake must fail closed);
  and a per-operator downloaded model cannot be byte-identical across nodes.
- **M10B-D17 (2026-07-28, `DOD-END-SCAN-1`) — `@cello-protocol/gateway` gains an additive `"./detect"`
  subpath export; the portal imports ONLY that, never the barrel.** Verified: `gateway/src/index.ts`
  re-exports `GatewayConfigStore`/`GatewayRecordStore`, both of which statically
  `import { DatabaseSync } from "node:sqlite"` — and the package `exports` map exposes only `"."`, so
  there is no deep-import escape today. A barrel import would pull `node:sqlite` (**VERBOTEN**), the
  gateway HTTP server, and the sidecar spawner into a Next.js Fargate app. Consequence for process:
  this makes `gateway` a **sixth** cello-client package the other repos pin, so the cross-repo
  version-bump AC discipline (CLAUDE.md) now covers it.
- **M10B-D34 (2026-07-29, Andre) — THE DIRECTORY DOES NOT STORE THE EDGE. It holds hashes.**
  Andre, on being shown that `signal_records` carried `subject` and `issuer_pubkey` in the clear:
  *"The directory doesn't need in its database this person endorsed that person. None of that stuff
  should be in there. Everything that is involved in what you are doing is in the plain text which is
  then hashed. The hash is stored in the directory, the plain text is forwarded to the daemon."*
  **The framing that produced this was mine and it was wrong** — I described the exposure as
  "plaintext in the directory", which implies CONTENT. It never was: `signal_records` has no payload
  column and the client's copy travels sealed. What was exposed is the EDGE — the pair of identities
  — and Andre's point is that the directory has no business holding it, because both pubkeys are in
  the envelope that gets hashed, so anyone who wants to verify who endorsed whom checks the envelope
  they were shown.
  **Verified before acting, and this is what made it cheap:** exactly ONE consumer used those
  columns — `/internal/active-signals/<accountId>`, a convenience read for the portal. The notary
  path never did (`signal-present.ts` is hash-in, hash-out), so verification is untouched.
  **Executed in four ordered steps, each leaving the portal working:** the portal records its own
  mints (`minted_signals`, portal migration 0008) → a hash-only `activeAmong` replaces the
  account-scoped read → the three consumers move over and `queryActiveSignals` is deleted → V55 drops
  `subject` and removes the route.
  **`issuer_pubkey` is HELD BACK, deliberately.** `DOD-END-REVOKE-2` requires exact-`issuer_pubkey`
  auth for agent issuers, and that check compares a tombstone's revoker against this column;
  dropping it would silently revert the M10 F6 fix. Dropping `subject` alone already destroys the
  edge — a graph needs both ends. **OPEN QUESTION, deferred rather than settled:** whether the issuer
  identity should also leave, with revoke authority moving entirely to the portal (`M10B-D12r3`
  already names the portal as primary enforcement and the directory check as defense-in-depth
  against a compromised or second submitter key). Not decided as a side effect of a column drop.
- **M10B-D33 (2026-07-29, `DOD-END-REVOKE-2`, from review F4) — supersession consults EFFECTIVE
  status, and the successor is judged by the SAME authority rules.** V46's guard
  (*"a REVOKED replacement supersedes nothing"*) has been **inert since revocation became a
  tombstone**: the real row's `status` stays `'active'`, so the guard only ever fires for a direct
  `UPDATE … SET status='revoked'` that no writer performs. Measured consequence: Bob endorses,
  re-endorses (v2 supersedes v1), then **withdraws v2** → v2 `revoked`, v1 `superseded`. **Both
  unpresentable, with nothing saying so** — a withdrawal silently destroying the endorsement it
  replaced, in one of the two mechanisms this milestone *is*. **Rejected: "ignore a successor that
  has any tombstone"** — it is a RESURRECTION ATTACK, letting an unauthorised tombstone on the
  successor bring its predecessor back. So revoked-ness is computed ONCE in a CTE and the
  supersession branch consults it, which judges the successor exactly as the record itself is judged,
  with no recursion. Measured on live Postgres: the withdrawn-successor case returns the predecessor
  to `active`; Mallory's unauthorised tombstone leaves it `superseded`; ordinary supersession and the
  revoked-beats-superseded ordering are unchanged. **Pre-existing (V46), fixed here** under the
  standing rule that a real defect found outside the diff gets fixed — and V53 is the migration that
  rewrites this CASE, so it is the right and only cheap moment.
- **M10B-D29 (2026-07-29) — `DOD-END-ARCH-1` CLOSES on four passes, not five; the remaining findings
  are ACs on the units that build them.** The determination consumed an entire overnight session and
  shipped zero lines of code — four completed review passes plus a fifth that died on the session
  quota. That is the failure the review cap was written to stop (*"reviewers always find something, so
  an unbounded review loop has no termination condition"*), and re-dispatching a sixth pass to confirm
  an editing session would be the same trap wearing a different hat. The cap's own instruction is the
  resolution: **remaining findings become ACs on the units they affect, and the per-unit review catches
  them there.** Every one of the four now is — the table in the ARCH-1 line names which unit owns
  which. The standard applied is the fourth reviewer's: *would a competent coder following this build
  the right thing, with the remaining unknowns named as unknowns* — and the answer is yes, since the
  unknowns are named, sized, and assigned. **Reverse:** cheap and local — a unit-level review that
  finds the determination wrong about its own line fixes it in that unit, which is exactly where the
  cost belongs. **Not closed by this:** the parked `DOD-END-DISCOVER-1` policy question, which is
  Andre's and stays 🅿️.
- **M10B-D1 (2026-07-28) — the milestone is a SOURCE plus two MECHANISMS, not a feature.** Fork: ship
  "endorsements" as a feature, versus generalise the client-supplied source and the consent/withdrawal
  mechanisms so the attestation family opens behind them. Chose the latter; `DOD-END-PLAYBOOK-1` is the
  falsifiable test of the choice. Why: the taxonomy already treats endorsement as one instance of a
  general primitive, and the parked commercial family ([[2026-07-10_2102_referral-and-commercial-use-cases]])
  is entirely client-sourced attestations. Reverse: cheap now, expensive after a second type ships with
  bespoke code.

---

## Open questions

**All four opened with this milestone were answered by Andre on 2026-07-28 — do not re-raise them.**
Refusal messaging → `M10B-D4`. `same_operator` placement → `M10B-D3`. Vocabulary → `M10B-D7`. Rate
limiting → `M10B-D6` (and it moved INTO scope as `DOD-END-QUOTA-1`). Anonymous variants → `M10B-D8`.
Ingress shape → `M10B-D2`.

Note on the prior number: `server-infrastructure.md` G-17 specifies **10** endorsements/month per agent.
`M10B-D6` supersedes it — 100 per rolling 30 days, per account, configurable. Update G-17 or annotate it
when `DOD-END-QUOTA-1` lands; two live numbers for one knob is how the wrong one gets implemented.

What remains genuinely open is scoped INTO `DOD-END-ARCH-1` rather than left floating: the intake-key
distribution and rotation question opened by `M10B-D2`, the queue's ack/poison and retention semantics,
and how an account subject is named at intake. None of these blocks the milestone; all are the
determination's job.

### THE SPINE HARNESS HAS NEVER RUN PORTAL CODE — and M10B's journey is ABOUT portal code

Raised 2026-07-29, and it is a **false-green hazard**, which is why it is here rather than left to
discover during the run.

Every existing spine journey SIMULATES the portal by seeding `signal_records` directly. `j-canary`
says so in its own comment: *"In production the portal does this via the signed submission API. In
this test we seed directly."* That was sound for M10, where the portal's role was to insert a row and
the thing under test was the directory's genericity.

**It is not sound for M10B.** The thing under test IS the portal's ingress — drain, open the seal,
verify the signature and derive `issuer_pubkey` from it, scan, compose with split voices, mint,
deliver. A `J-END` written on the established pattern would seed `signal_records` and skip
`drainAndMint`, `authenticateSubmission` and `scanSubmissionBody` entirely, then go green. It would
certify the client-supplied source while testing none of it — and it would look exactly like a
passing journey.

`cello-portal` is not in the trustless-cello pnpm workspace, so the harness cannot import it today.

**The shape that works, and it is not exotic:** `live-harness.ts` already reaches ACROSS repos —
`CELLO_CLIENT_ROOT` and `TRUSTLESS_ROOT` are both exported from it, and the daemons it spawns are
cello-client binaries. Adding `PORTAL_ROOT` and importing the ingress modules under `tsx` is the same
move again, and it keeps the journey exercising the REAL code rather than a second implementation of
it. A reimplementation in the test would be precisely the "byte-identical local copy on each side"
that `M10B-D28` forbids for the submission wire, applied to the pipeline instead.

Recording it now because the wrong choice here is invisible: the journey passes either way.

### NO MANIFEST CARRIES AN `intake_key`, SO THE CLIENT-SUPPLIED SOURCE IS INERT — measured 2026-07-29

Not a design question; a provisioning gap, stated here because the surface now exists and hides it
well. `cello_trust_signals_issue` and the `M10B-D4` refusal message both refuse with
`intake_key_absent` against **every real manifest**, because the portal's intake keypair has never
been generated.

Measured, not inferred: `/cello/dev/portal/intake-key-id` and `/cello/dev/portal/intake-key-pubkey`
both return `ParameterNotFound` in us-east-1, and the portal source contains no `intake` reference at
all. `infra/scripts/sign-consortium-manifest.mjs:121-141` already reads both SSM parameters and
spreads `intake_key` into the signed body **only when both are present** — so the signing plumbing is
complete and simply has nothing to read.

What is owed, in order: generate an Ed25519 intake keypair; the SEED into Secrets Manager (the portal
reads it to open seals), the `key_id` + public half into those two SSM parameters via
`cello-ssm-parameters.yaml` — **not by hand**, since a manually-created resource fails the next
`deploy.sh` with `ResourceAlreadyExists`; re-sign and publish the manifest. Rotation semantics are
already decided (`M10B-D11`): the queue row records its `intake_key_id` precisely so a rotated-out
private key is retained until no undrained row references it.

**This does NOT block `DOD-END-JOURNEY-1`.** [[M10B-PROCEDURE]] §2e is explicit that "live, across
real processes" means real OS processes, not deployed AWS, and the spine harness
(`packages/e2e-tests/src/spine/auth-manifest.ts`) already mints a manifest carrying an intake key —
`m10b-manifest-intake-key.test.ts` covers it. So the milestone's proof is unaffected; what is
affected is anyone trying the deployed dev environment by hand and concluding the feature is broken.

### WHICH AGENT MAY SPEAK FOR AN ACCOUNT — now load-bearing, raised 2026-07-29 (SURFACE-1 review F7)

An **account-subject** pending item is visible to EVERY agent on a daemon: `listPendingConsent` scopes
with `(subject_kind <> 'agent' OR lower(subject) = ?)`, deliberately, because the item is about the
account rather than about one agent. Two consequences surfaced once the consent surface existed:

1. **Any agent can refuse it.** Defensible — it is the account's own decision — but unruled.
2. **The refusal MESSAGE would be signed with that agent's K_local**, so the issuer would receive a
   signed statement from an agent that was not the subject of anything. Signing is not the place to
   guess, so `cello_consent_refuse` currently **refuses the message** for account-subject items
   (`account_subject_message_unsupported`) while the refusal itself stands. Named, not silent.
3. **The nudge can be silenced for the wrong agent.** One agent listing pending items marks the
   account-subject rows notified for all of them, so another agent may never be told. That is the
   silent-death-of-an-endorsement failure the nudge exists to prevent, and it fires on an ordinary
   two-agent daemon. Fixing it properly means per-agent notification state (a
   `consent_notifications(agent_pubkey, signal_hash)` table), which is a schema change.

This is not a fork needing Andre — it needs a rule, and the rule belongs with `DOD-END-ARCH-1`'s
"how an account subject is named at intake", which is the same question from the other end.

## Parked

- **PSI and endorser-overlap** (spec §11) — construction unchosen; both applications post-v1. The
  contact-overlap computation D-24 refers to is spec'd but not built.
- **Substitution logic** — policy D-12, TABLED. *"Do overlapping contacts negate the need for an aged
  GitHub?"* Endorsements ship, are held, presented, and withdrawn without it. Any rule of the form "an
  endorsement substitutes for requirement X" is blocked until D-12 is answered.
- **The endorsement request/negotiation flow** — *"Alice asks Bob to endorse her"*
  ([[2026-04-10_1000_connection-endorsements-and-attestations]]). v1 ships unprompted issuance only.
- **The referral callback loop and the commercial family** — *"quote code 12345, my agent confirms you
  read it"* (spec §11), multi-hop affiliate chains, proof-of-transaction reviews, revocable paid
  credentials, vouching-with-liability, bounties
  ([[2026-07-10_2102_referral-and-commercial-use-cases]], parked ideation). Note that a bearer instrument
  (a coupon or single-use code) is NOT an attestation — attestations are subject-bound and
  non-transferable, and a redeem-once instrument needs a double-spend answer this envelope does not
  provide.
- **Per-node intake** (spec §7 constraint 1) — launch runs intake portal-routed, a singleton, deliberately
  and with eyes open; moving to the per-node role later is a routing change, not a migration, because the
  record format is identical either way.
- **Recipient re-scan of endorsements** (spec §0.1) — M10 post-v1, *"decide when endorsements land."*
- **T-of-N scan attestation** (spec §14.1) — a strengthening, not a migration. Residual accepted for
  launch: a compromised node can spam-notarize; the record carries node + scanner version.

---

## Related Documents

- [[M10-DEFINITION-OF-DONE]] — v1: the generic pipe this milestone extends; its post-v1 section is where
  endorsement intake, the REVOKE-1 F6 fix, and recipient re-scan were parked.
- [[M10B-PROCEDURE]] — the operating runbook; self-contained, read first.
- [[M10-TYPE-PLAYBOOK]] — the one-shot contract; `DOD-END-PLAYBOOK-1` is a run of it.
- [[M10-TRUST-SIGNAL-STORAGE-AND-CREATION]] — spec-of-record (HOW): §6 the three issuer flows + the
  2026-07-11 all-through-the-portal amendment, §7 Endorsement Mother, §11 endorsements + PSI, §14.1/§14.2
  federation + revocation, §15 zero-bump.
- [[M10-TRUST-SIGNAL-TAXONOMY]] — spec-of-record (WHAT): Class 2, and why it contains only endorsements.
- [[2026-07-27_2049_policy-surface-audit-touchpoints-and-open-decisions]] — the decisions above,
  §13 the intake-owes list, §12 D-19 through D-29.
- [[2026-04-10_1000_connection-endorsements-and-attestations]] — the origin: endorsement ⊂ attestation.
  **Read it for the reasoning, NOT for the shape — three things in it are superseded and one of them is
  a trap.** (i) Its blanket same-owner rejection is superseded by D-29 (agent-subject is minted and
  flagged; only account-subject is refused) — the log marks this itself. (ii) Its **two protocol types**
  (`connection_endorsement`, gated at the connection layer, vs `attestation`, informational) are
  superseded by `M10B-D7`: there is ONE type, and the gating that split was for is now done by floor
  predicates over `issuer_kind`/tier/count (`DOD-END-FLOOR-2`). Building the two-type split would be a
  direct `DOD-END-INV-ZEROBUMP` violation — this is the trap. (iii) It puts endorsement intake and rate
  limiting at the **directory**; the §6 2026-07-11 amendment and `M10B-D6` put minting and the quota at
  the portal.
- [[2026-07-10_2110_cello-is-a-cryptographic-notary]] — the frame: an attestation is an issuer's signed
  claim about a subject or event, notarized.
- [[M10B-BUILD-JOURNAL]] — evidence, forensics, and playbook-run records.
