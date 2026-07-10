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

## The general shape — attestations on a cryptographic notary

The frame that emerged from this session (its own doc:
[[2026-07-10_2110_cello-is-a-cryptographic-notary]]): **what CELLO is, is a cryptographic notary** — AI
intelligence composed with cryptographic primitives (hashes, Merkle trees, non-repudiation, revocation,
PSI). And we already had the vocabulary — **endorsements are a special case of *attestations*** (an issuer's
signed claim about a subject/event):

- **Endorsement** = a vouch-shaped attestation (Class 2) — [[2026-04-10_1000_connection-endorsements-and-attestations]].
- **Purchase / commerce** = a both-party-signed transaction attestation, Merkle-hashed — **already designed**
  in [[2026-04-18_1620_commerce-attestation-and-fraud-detection]]. This IS the "proof-of-transaction review"
  case below; it is not new.
- **Session-close** (CLEAN / FLAGGED / PENDING) and **device attestation** — further attestation types the
  same notary already carries.

**Any commercial mechanism that today needs a platform to track attribution, eligibility, or revocation is
just another attestation type on this notary** — no new cryptography, only new `type` strings and the client
code that reads them. Referral is one instance; the five below are others — a small first sample of the
permissionless long tail the notary frame opens.

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

Each is an **attestation type** on the notary, mapping to a primitive already in the design — several with
prior-art logs, so this is consolidation, not invention:
- **Attribution** → notarized introductions + the referral callback loop (cases 1, 5).
- **Non-repudiable mutual receipts** → both-party signed attestations (case 2) — **already designed** as
  purchase attestations in [[2026-04-18_1620_commerce-attestation-and-fraud-detection]].
- **Revocation as enforcement** → the §14.2 write path (case 3).
- **Skin-in-the-game** → §7 submitter-accountability, plus the connection-staking prior art
  [[2026-04-08_1900_connection-staking-and-institutional-defense]] (case 4).

None require new cryptography beyond what M10 already specifies — they are *product* surface (new `type`
strings) on the same notary. The reframe is the payload: CELLO's reach is not "endorsements," it is
**general-purpose intelligent, trustless notarization** ([[2026-07-10_2110_cello-is-a-cryptographic-notary]]),
of which trust signals, endorsements, and commerce attestations are all applications.

## Related Documents

- [[2026-07-10_2110_cello-is-a-cryptographic-notary]] — the parent frame: the notary this all rides on.
- [[M10-TRUST-SIGNAL-STORAGE-AND-CREATION]] — the HOW; §1 (directory = notary), §11 (endorsements + the
  parked callback loop), §14.2 (revocation write path), §7 (submitter-accountability).
- [[M10-TRUST-SIGNAL-TAXONOMY]] — the WHAT; Class 2 endorsements, the source of truth for the signal set.
- [[2026-04-10_1000_connection-endorsements-and-attestations]] — endorsements as attestations (origin of the
  framing).
- [[2026-04-18_1620_commerce-attestation-and-fraud-detection]] — signed purchase attestations = the
  proof-of-transaction case, already designed.
