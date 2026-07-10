---
name: referral-and-commercial-use-cases
type: discussion
date: 2026-07-10
topics: [m10, trust-signals, endorsements, referral, commerce, attribution, revocation, psi, use-cases]
status: parked
description: >
  Parked ideation (no decisions). Referral is the seed of a family of commercial mechanisms the trust-signal
  stack uniquely enables. The architecture is, underneath, a trustless attribution + receipt layer: it can
  prove who did what for whom, and whether they are still good for it, without a platform in the middle.
  Captured for a fresh look; nothing here is committed to a milestone.
---

# Referral, and the family of commercial use cases the trust layer enables

**Status: parked ideation.** Andre raised referral as a specialized commercial case adjacent to
endorsements, intuited there were more, and asked to capture a few before sleeping. **No decisions taken** —
this is a holding pen for a fresh look. The authoritative design remains
[[M10-TRUST-SIGNAL-STORAGE-AND-CREATION]] and [[M10-TRUST-SIGNAL-TAXONOMY]].

## The seed case — referral

If A refers B to agent C, and C uses B's service, A gets something. Classic referral. The system is a
natural fit: the referral rides an endorsement's plaintext (the **scope** — "I refer you to B for X"), the
**callback/referral loop** (§11, parked — "quote code `12345` and my agent confirms you actually saw the
referral") proves the referral was received and acted on, and the notarized, authenticated session gives a
tamper-evident trail of who-introduced-whom. Attribution without a platform arbitrating it.

## The general shape

Under the referral example, the architecture is a **trustless attribution + receipt layer** — it can prove
*who did what for whom, and whether they are still good for it*, without a trusted intermediary. **Any
commercial mechanism that today needs a platform to track attribution, eligibility, or revocation can run
on these primitives instead.** Referral is one instance; the notarized-receipt + scoped-endorsement +
revocation stack is the general engine. The five below are distinct instances of that engine.

## A few other cases in the same family

1. **Multi-hop referral / affiliate chains.** A→C generalizes to A→B→C→D: each hop is a notarized
   introduction carrying the referral code forward, so a revenue split flows down a *provable* chain —
   multi-level affiliate marketing with cryptographic attribution instead of a platform arbitrating "who
   gets the commission." The disputed-attribution problem disappears.

2. **Proof-of-transaction reviews (the highest-pull one).** A review that requires *both* parties'
   authenticated participation in a real transaction — you can only review someone you provably did business
   with. That single constraint kills fake reviews (a multi-billion-dollar plague on every marketplace). A
   review becomes a scoped endorsement anchored to a real transaction hash.

3. **Revocable paid credentials / memberships.** "Certified X," "gold-tier partner," a paid subscription
   tier — issued by a body that *charges* for it. The **revocation write path** (§14.2) is the enforcement:
   stop paying → issuer revokes → every downstream agent sees it lapse on the next freshness re-check.
   Licensing and memberships that enforce themselves P2P.

4. **Vouching-with-liability (reputation staking).** An endorsement with skin in the game: B stakes
   reputation (or a bond) on C; if C defrauds A, B takes the hit. This is §7's submitter-accountability
   turned into a commercial primitive — "I'll stake that this agent is legit" — which is what makes a vouch
   costly to fake, and therefore weighty.

5. **Bounties / finder's fees (the pull-side inverse of referral).** A posts a reward ("find me a supplier
   of X, pay on close"); B's introduction of C is notarized; on close, the bounty pays the provable
   introducer. Lead-gen markets without the middleman.

## Why these are notable, not just a list

Each maps to a primitive already in the design:
- **Attribution** → notarized introductions + the referral callback loop (cases 1, 5).
- **Non-repudiable mutual receipts** → both-party authenticated sessions (case 2).
- **Revocation as enforcement** → the §14.2 write path (case 3).
- **Skin-in-the-game** → §7 submitter-accountability generalized (case 4).

None of these require new cryptography beyond what M10 already specifies — they are *product* surface on top
of the same engine. That is the reason to capture them: they suggest the trust layer's commercial reach is
much wider than "endorsements," and several (especially proof-of-transaction reviews) may be worth their own
milestone conversation later.

## Related Documents

- [[M10-TRUST-SIGNAL-STORAGE-AND-CREATION]] — the HOW; §11 (endorsements + the parked callback loop),
  §14.2 (revocation write path), §7 (submitter-accountability) are the primitives these ride on.
- [[M10-TRUST-SIGNAL-TAXONOMY]] — the WHAT; Class 2 endorsements, the source of truth for the signal set.
