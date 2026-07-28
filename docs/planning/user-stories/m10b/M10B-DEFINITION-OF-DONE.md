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
  policy surface audit (D-19, D-22..D-27, D-29). Spec-of-record remains
  M10-TRUST-SIGNAL-STORAGE-AND-CREATION (§6 the three issuer flows, §7 intake, §15 zero-bump) +
  M10-TRUST-SIGNAL-TAXONOMY (Class 2).
---

# M10B — Definition of Done

## How to use this
- **[[M10-PROCEDURE]] applies verbatim** — read order, severity triage, the design-note template (§6),
  batching rules, the reality check. M10B adds no new operating rules; only the deltas in this document.
- This is the **target**. Find the lowest-numbered line not ✅; that's the next unit.
- **Evidence discipline:** a flipped tag carries ONE line of evidence plus `→ Journal Entry N`. Full
  proofs and forensics live in [[M10B-BUILD-JOURNAL]]. This document stays a scoreboard.
- **Enforcers** (unchanged from M10): the fixture harness, the live journey across real processes, the
  CBOR cross-party hash test, and — new here — the **playbook-run proof** (Tier 5), which asserts that
  once M10B's machinery exists, the `endorsement` type itself required no further client or directory
  change.
- Every line carries **observability ACs**: named `domain.noun.verb` events, required context fields,
  correlationId threading, error-path coverage. Missing events are blocking.
- Client-side lines ship via the publish cascade (/cello-publish); a line needing a published artifact
  is not ✅ until the published artifact works.

## Status legend
✅ PROVEN (enforcer-green) · 🟡 BUILT/UNVERIFIED-LIVE · 🟠 PARTIAL · ❌ NOT BUILT · 🅿️ PARKED

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
inbound arm to the portal's mint function. It does not add an issuer, a key, a chokepoint, or a write
path.

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

**IN:** the client→portal ingress; intake scanning; the consent mechanism (deliver → accept/refuse →
presentable); issuer-side withdrawal and its propagation; issuer-suspension cascade; the same-operator
rules (D-27, D-29); floor/count handling; the operator surface; `endorsement` as the first type through
the new arm, proven live.

**OUT (parked below):** PSI and endorser-overlap; substitution logic (blocked on policy D-12, tabled);
the endorsement *request/negotiation* flow (Bob endorses unprompted for v1); multi-hop referral,
the referral callback loop, and the wider commerce family; per-node intake (launch is portal-routed by
the §7 amendment, deliberately); issuance rate limiting.

---

## Tier I — Invariants (must hold in every line and every journey)

All M10 invariants (`DOD-INV-DIR-DUMB`, `-CHOKEPOINT`, `-ZERO-BUMP`, `-TYPE-CARRY`, `-CANONICAL`,
`-AGENT-SCOPED`, `-FRAMING`, `-NO-SCORE`, `-STATELESS-RECIPIENT`) continue to hold unchanged. These are
the additions M10B is accountable for.

- **DOD-END-INV-ZEROBUMP** — the milestone adds no type-shaped construct anywhere. No `switch(type)`,
  no type enum, no `CHECK` on `type`, no per-type column, no branch on the literal `"endorsement"` in
  cello-client or trustless-cello. Every new construct keys on `issuer_kind`, the consent state, or the
  issuer's identity. Enforced per-unit by `cello-unit-reviewer`; a type-literal branch is a blocking
  finding. — ❌
- **DOD-END-INV-ATTRIBUTION** — `issuer_pubkey` is bound to the **authenticated** identity that supplied
  the plaintext, and is never accepted as a caller-supplied request field. Direct precedent:
  `accepting_node` in `DOD-DIR-WRITE-1` ("written by the node itself, never accepted from the request —
  a submitter that could choose it could collide rows deliberately"). If the ingress trusts a claimed
  `issuer_pubkey`, anyone can mint an endorsement attributed to anyone, and `issuer_kind` framing becomes
  a lie the hash then makes permanent. — ❌
- **DOD-END-INV-CONSENT** — nothing about a subject is presentable, discoverable, or countable without
  that subject's explicit acceptance (D-23, D-24). A refused or still-pending endorsement is
  indistinguishable, to every third party, from one that was never created. — ❌
- **DOD-END-INV-UNTRUSTED** — endorsement plaintext reaches a consuming LLM only as quoted-untrusted
  ("Bob says: …"), never with portal-attested framing, byte-for-byte or not at all. This is M10's
  `INV-FRAMING` applied to the first content that genuinely needs it; `issuer_kind` is inside the hash
  (§4), which is what makes the framing unforgeable. — ❌
- **DOD-END-INV-NO-SELF-STANDING** — an operator cannot manufacture standing for themselves. Account-
  subject self-endorsement is refused at intake; agent-subject same-operator endorsement is minted,
  flagged, and excluded from every count predicate (D-27, D-29). Quality capping without quantity
  capping is not sufficient — ten agents under one operator must not clear a `min_count` gate. — ❌

---

## Tier 0 — The determination (gates every build line)

- **DOD-END-ARCH-1** — **the design determination, written before any code, reviewed like any unit.**
  Written AGAINST spec §6 (three issuer flows + the 2026-07-11 amendment), §7 (intake), §15 (zero-bump),
  and the decisions section below. Must settle, with evidence from the code as it actually is:
  - **The ingress shape.** How an operator's client hands the portal raw plaintext, and how the portal
    authenticates the supplying operator. Two candidate shapes to weigh, not assume: an authenticated
    CELLO session to a portal-backed intake agent (spec §7's flow, and what §14.2 already assumes for
    revocation re-auth via `connecting_pubkey == issuer_pubkey`), or an authenticated portal API call
    from the daemon. Whichever wins must satisfy `DOD-END-INV-ATTRIBUTION`.
  - **The payload split.** Playbook §2 says the plain-language `claim` is "composed BY THE PORTAL stating
    what was verified, how, and when." For an endorsement the portal verified *nothing about the
    assertion* — only that an authenticated operator said it. So the payload needs an explicit two-part
    shape: the portal's **attested wrapper** (who said it, when, that they were authenticated, the
    same-operator fact) and the endorser's **quoted words** (untrusted, scanned, never restated in the
    portal's voice). Getting this wrong is how `DOD-END-INV-UNTRUSTED` dies quietly.
  - **Where `same_operator` lives** (policy D-29 sub-question 2): inside the hash — composed at intake
    before hashing, consistent with scan-before-hash, unforgeable but frozen — or served alongside like
    `status`, correctable but not covered by the hash. Operator linkage is **not** permanent
    ([[2026-04-14_0700_agent-succession-and-ownership-transfer]]), so a `same_operator` fact minted today
    can stop being true.
  - **Where the consent state lives.** `wallet_trust_signals` (the holder's own presentable signals, M10-D4)
    gains a consent column, versus a separate pending table. Must not violate `INV-AGENT-SCOPED`.
  - **Naming.** Whether this milestone ships ONE type (`endorsement`) or opens an attestation *family*
    (`endorsement` + siblings). Bearing on the answer: `attestation` has never been a wire term — the
    envelope calls everything a signal and `type` is data — while the design vault has used
    "attestation" as the umbrella since 2026-04-10 and "endorsement" for the vouch-shaped case. Decide
    the vocabulary once, here, and make the docs consistent with it.
  - **Expiry.** D-26 gives endorsements no expiry, which is a deliberate exception to Playbook §0's
    "validity window: `expires_at` policy." Confirm `expires_at: null` flows correctly through
    `DOD-VERIFY-1`'s freshness path (spec §14.7) rather than being read as already-expired. — ❌

---

## Tier 1 — The third source: client → portal ingress

- **DOD-END-INGRESS-1** — the client-supplied plaintext arm of the portal's mint function, per
  `DOD-END-ARCH-1`. The operator's agent supplies `(subject_kind, subject, plaintext scope/body)`; the
  portal authenticates the supplier and binds `issuer_kind: agent` + `issuer_pubkey` to that
  authenticated identity (`DOD-END-INV-ATTRIBUTION`). Sits alongside the existing two arms (portal
  verification code; the directory read path `queryAccountFacts` / `GET /internal/track-record/...`) and
  reuses `mint.ts` + `submission-signer.ts` unchanged from there on. Named events:
  `signal.ingress.received`, `signal.ingress.rejected` (+ reason), `signal.ingress.authenticated`. — ❌
- **DOD-END-SCAN-1** — the deterministic intake scanner (spec §7): injection patterns (primary), secrets,
  constrained charset (a sentence — no control chars, no markup), length cap, URL handling. **Versioned
  and byte-identical**, and the version travels INSIDE the signed submission body — `DOD-DIR-WRITE-1`
  already makes `scanner_version` a signed field precisely because the directory cannot re-run the scan
  and a forged version "is a lie stored as evidence." Scan **before** hash, always: on fail reject, never
  clean-and-continue. Aligns with policy D-16 (concealment with no innocent use refuses on sight;
  legitimate encodings are decoded and judged). — ❌
- **DOD-END-ACCOUNTABILITY-1** — submitter accountability on the graduated threshold of §7 constraint 3:
  **reject always** (fail-closed), but **flag as suspect only on a pattern** — repeated rejects, or a
  single egregious hit (a real credential, a clear injection payload) — never on one heuristic near-miss.
  A reputational penalty on a false positive is real harm; the two consequences keep different
  thresholds. — ❌
- **DOD-END-SUBJECTKIND-1** — the same-operator branch, one deterministic check off the existing verified
  phone-stub operator linkage, branching on `subject_kind` (policy D-29):
  - `subject_kind: agent`, same operator → **mint and flag** `same_operator`. This is a co-ownership
    assertion, not a vouch; its worth is capped at the endorser's own tier to the recipient (D-27).
  - `subject_kind: account`, same operator → **refuse to mint.** Self-endorsement, with no
    recipient-relationship reading that rescues it; the verified email + phone baseline (policy D-8)
    already asserts everything it could.
  Default target is the specific agent unless requested and agreed (M10-D5). Supersedes the 2026-04-10
  log's blanket same-owner rejection, which is marked superseded there. — ❌

---

## Tier 2 — Consent (the first new mechanism)

- **DOD-END-DELIVER-1** — the minted envelope is delivered to the **subject** — a third party who did not
  initiate it, and who is not the submitter (§7: "Bob's role ends at submission"). Reuses the generic
  delivery path (verify hash ∈ directory → insert envelope row) with no type-specific handling, landing
  in `wallet_trust_signals` in a **pending** consent state. — ❌
- **DOD-END-ACCEPT-1** — accept-before-present (D-23). The subject reads the endorsement and accepts or
  refuses it; **only an accepted endorsement is presentable.** Andre's reason, recorded verbatim in the
  policy audit: *"Otherwise someone could create a rogue endorsement that says you're a piece of shit and
  never work with this person."* Acceptance is the second cheap check behind intake scanning, on the first
  CELLO content written by one party and displayed to a third. Negative AC: a pending or refused
  endorsement cannot be presented by any path. — ❌
- **DOD-END-DISCOVER-1** — non-discoverability, proven by a negative test (D-24): no path lets any third
  party enumerate, count, or infer endorsements about a subject who has not presented them. The
  directory's fingerprint is useless without the text, and only the subject holds the text. Andre,
  generalising past endorsements: *"This is the case for absolutely everything in CELLO. You decide what
  you want to present."* — ❌

---

## Tier 3 — Issuer-side lifecycle (the second new mechanism)

- **DOD-END-REVOKE-2** — the authority fix M10 logged and deferred (`DOD-REVOKE-1`, review F6, *"revisit
  with intake"*). Today revoke authorises on the generic `submitter` role and writes a `portal` tombstone
  regardless of the target's real `issuer_kind` — harmless while every signal is portal-issued, but the
  moment a person can issue an endorsement, **one submitter key can tombstone someone else's
  endorsement.** Required: exact-`issuer_pubkey` auth for `issuer_kind: agent`, and the tombstone must
  respect the target's real `issuer_kind`. Role-based auth stays correct for portal-issued records (it is
  what survives a portal key rotation — determination §3.5). **Without this, D-19 is nominal.** — ❌
- **DOD-END-WITHDRAW-1** — withdrawal takes effect everywhere, including for recipients already holding a
  copy (D-19). The endorsement stops being presentable, and any recipient holding it sees it marked
  withdrawn on next check. Rides `DOD-VERIFY-1`'s existing TTL-re-check-on-use machinery (spec §14.7) —
  this line decides what that machinery is FOR, it does not build new transport. *A reference, not a
  tattoo.* Surfaced to the holder, never a silent disappearance. — ❌
- **DOD-END-SUSPEND-1** — suspending an issuer's account (the M8 LEVER-001 kill switch) marks everything
  that issuer minted as **no longer vouched**, reversibly; restoration brings them back; permanent
  revocation is what makes it final (D-25). Why it is not optional: an attacker holding a compromised key
  mints endorsements for their own sock puppets, and if suspension blocked only *future* issuance,
  everything minted before the switch was pulled keeps vouching for them and the kill switch never
  reaches the damage. — ❌

---

## Tier 4 — Consumption

- **DOD-END-RENDER-1** — presentation-side rendering. The `same_operator` fact is a FACT; **the endorser's
  tier to the recipient gives it its sign** (D-27): from an `unknown` endorser it is self-issued and worth
  nothing; from a `whitelisted`/`vip` endorser it is a strong positive — *"my other agent is mine,"* from
  someone already trusted. Generalises the design's existing rule that a third-party assertion is worth
  exactly what its issuer is worth. Also honours D-8a: for any signal with an anonymous and an identified
  variant, the default presented variant is the ANONYMOUS one. — ❌
- **DOD-END-COUNT-1** — floor/count handling (D-29 sub-question 1). `same_operator` is an envelope-visible
  fact, so a count predicate MUST bucket or exclude flagged endorsements; a naive `count >= N` otherwise
  passes on ten agents under one operator. Keeps `DOD-FLOOR-1`'s "envelope fields only" rule intact —
  the predicate input is the envelope, the join is recipient-local. — ❌
- **DOD-END-FLOOR-2** — endorsement-aware floor predicates: count, issuer tier, and issuer identity, all
  computed by joining the presented envelope's `issuer_pubkey` against the recipient's own contacts. This
  is compatible with `INV-FLOOR-ENVELOPE-ONLY` (nothing reaches into the payload) and is what D-27's
  tier-signed reading requires. **Explicitly out:** any predicate of the form "an endorsement SUBSTITUTES
  for requirement X" — that is policy D-12, tabled. Endorsements ship without it; substitution cannot. — ❌
- **DOD-END-TIER-1** — an endorsement NEVER moves a contact's tier automatically (policy D-10). It informs,
  and it may PROMPT — *"Alice was introduced by Bob, whom you've whitelisted — promote her?"* — but only
  the operator changes a tier. Automatic promotion through the trust-signal path would reopen, by another
  route, exactly the hole DEC-AB-3 closed when it removed accept-promotes. — ❌

---

## Tier 5 — Surfaces, and the proof

- **DOD-END-SURFACE-1** — the operator surface, MCP and CLI at parity (the M8C parity rule): issue an
  endorsement for a counterparty; list endorsements pending my acceptance; accept / refuse; list the ones
  I hold and their status; withdraw one I issued; per-counterparty include/omit at presentation. Andre's
  standing rule applies — **don't ship dead features**: an endorsement mechanism reachable only by daemon
  IPC is the `DOD-SETTINGS-SURFACE-1` mistake repeated. — ❌
- **DOD-END-JOURNEY-1** — **live journey, across real processes.** Bob's agent supplies an endorsement for
  Alice → portal authenticates Bob, scans, mints, notarizes → Alice receives it PENDING → Alice accepts →
  Alice presents it to Charlie → Charlie verifies (hash ∈ directory, active) and consumes it with
  quoted-untrusted framing. **Four cases, all run, none assumed:**
  - **(a) refusal** — Alice refuses; the endorsement is unpresentable and invisible to Charlie by every
    path (`DOD-END-DISCOVER-1`).
  - **(b) same-operator positive** — Alice's established Agent A endorses her new Agent B; Bob, who has
    whitelisted Agent A, sees the `same_operator` fact rendered as a positive, and a `min_count` floor
    does not count it (`DOD-END-COUNT-1`).
  - **(c) self-endorsement refused** — an account-subject same-operator submission is rejected at intake
    with a named reason (`DOD-END-SUBJECTKIND-1`).
  - **(d) withdrawal reaches a prior recipient** — Bob withdraws after Charlie has already verified and
    stored it; Charlie sees it withdrawn on next check (`DOD-END-WITHDRAW-1`). — ❌
- **DOD-END-PLAYBOOK-1** — **the architectural proof, M10B's equivalent of the canary.** With M10B's
  machinery in place, a SECOND client-sourced type is taken from nothing to live end-to-end as a pure
  [[M10-TYPE-PLAYBOOK]] run — **`git status --porcelain` clean and `git diff --stat` empty in cello-client
  AND trustless-cello for the entire exercise.** This is what proves the milestone built a *source* and
  two *mechanisms* rather than an endorsement feature: if the second type needs code, the generalisation
  failed and the attestation family is not actually open. — ❌

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
- **M10B-D1 (2026-07-28) — the milestone is a SOURCE plus two MECHANISMS, not a feature.** Fork: ship
  "endorsements" as a feature, versus generalise the client-supplied source and the consent/withdrawal
  mechanisms so the attestation family opens behind them. Chose the latter; `DOD-END-PLAYBOOK-1` is the
  falsifiable test of the choice. Why: the taxonomy already treats endorsement as one instance of a
  general primitive, and the parked commercial family ([[2026-07-10_2102_referral-and-commercial-use-cases]])
  is entirely client-sourced attestations. Reverse: cheap now, expensive after a second type ships with
  bespoke code.

---

## Open questions — flagged, not decided

1. **Does the endorser learn their endorsement was refused?** Telling Bob leaks Alice's decision and turns
   refusal into a signal an attacker can probe; not telling him means honest endorsers never know their
   endorsement landed. A genuine fork with a privacy side and a usability side. Bears on `DOD-END-ACCEPT-1`.
2. **`same_operator`: inside the hash or served alongside?** Frozen-and-unforgeable versus
   correctable-when-linkage-changes. Bears on `DOD-END-ARCH-1` and on agent succession.
3. **Vocabulary: one type or a family?** Whether "attestation" becomes the umbrella term in code and docs,
   or stays a design-vault word while the wire keeps calling everything a signal. Bears on `DOD-END-ARCH-1`.
4. **Issuance rate limiting.** `server-infrastructure.md` G-17 specifies 10 endorsements/month per agent as
   an anti-farming measure. Not scoped here; is the same-operator rule plus submitter accountability
   sufficient for launch?

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
- [[M10-PROCEDURE]] — the operating runbook, which applies to M10B verbatim.
- [[M10-TYPE-PLAYBOOK]] — the one-shot contract; `DOD-END-PLAYBOOK-1` is a run of it.
- [[M10-TRUST-SIGNAL-STORAGE-AND-CREATION]] — spec-of-record (HOW): §6 the three issuer flows + the
  2026-07-11 all-through-the-portal amendment, §7 Endorsement Mother, §11 endorsements + PSI, §14.1/§14.2
  federation + revocation, §15 zero-bump.
- [[M10-TRUST-SIGNAL-TAXONOMY]] — spec-of-record (WHAT): Class 2, and why it contains only endorsements.
- [[2026-07-27_2049_policy-surface-audit-touchpoints-and-open-decisions]] — the decisions above,
  §13 the intake-owes list, §12 D-19 through D-29.
- [[2026-04-10_1000_connection-endorsements-and-attestations]] — the origin: endorsement ⊂ attestation,
  and the superseded same-owner rejection rule.
- [[2026-07-10_2110_cello-is-a-cryptographic-notary]] — the frame: an attestation is an issuer's signed
  claim about a subject or event, notarized.
- [[M10B-BUILD-JOURNAL]] — evidence, forensics, and playbook-run records.
