---
name: T-of-N decoupling, and the seal-integrity gaps found chasing it
type: discussion
date: 2026-08-21
topics: [frost, threshold, dkg, quorum, seal, unilateral-seal, directory, relay, sortition, protocol-design, security]
status: open-needs-decision
description: >
  Investigation intent, stated up front because it drove everything below: can the FROST signing
  threshold T be decoupled from the settled T = majority(N) rule — so that growing the directory
  pool N for redundancy does not force every ceremony to require proportionally more live nodes —
  without weakening the seal's forgery-resistance or reopening the disjoint-quorum problem majority
  exists to close? Tracing that question through the actual seal-ceremony code (not just the design
  docs) surfaced two separate, confirmed gaps in how seals are verified today, independent of T:
  co-signing directory nodes never re-verify transcript content, and only the seal initiator gets a
  pre-signature veto — the counterparty only finds out after the notarization already exists. A
  third, confirmed gap: the unilateral-seal fallback gates purely on elapsed time (600s default),
  never on the counterparty's actual reachability. Ends with a live proposal — decoupling T via
  unpredictable random committee selection (cryptographic sortition) instead of deterministic
  majority — and what it would actually require to deliver the same guarantee.
---

# T-of-N decoupling, and the seal-integrity gaps found chasing it

## Investigation intent

This discussion started from one question: **can T be decoupled from N, so directories can scale
for redundancy without every seal or session-open needing proportionally more of them live —
while keeping the seal's forgery-resistance exactly as strong, and without reopening the
disjoint-quorum problem that `T = majority(N)` was chosen to close?**

Chasing that question down into the actual seal-ceremony code — not just the design docs —
surfaced findings that go beyond the original T-of-N question: two confirmed gaps in how seal
content is verified today, and one confirmed gap in how the unilateral-seal fallback decides a
counterparty is "absent." All three are independent of whether T ever gets decoupled from N, and
matter for the same reason the original question mattered: **the moment a sealed transcript carries
real consequence — a commercial agreement, an "I hereby agree to pay X for Y" — the weight of that
seal depends on all of this being right, not just on FROST math being sound.**

---

## Part 1 — What FROST at the bookends actually buys

FROST runs at exactly two points in a session — establishment (binding two pubkeys via
`SessionAssignment`) and seal (co-signing the final hash-chain root). Every message in between is
signed only by the sender's own local key (K_local); FROST never touches message content.

The guarantee is narrow and specific: **no single directory node, and no minority coalition of
them, can unilaterally forge a `SessionAssignment` or fabricate a `SealNotarization`.** Take FROST
out and replace it with a single node's signature, and one compromised or rogue directory operator
could MITM a session (forge the pubkey binding at open) or attest to a tampered transcript (forge
the root at seal) — entirely alone, with no collusion required. FROST forces that forgery to
require a threshold of independently-operated nodes, not one.

This is *not* a defense against the agent's own K_local being stolen (that's the separate "Not Me"
revocation mechanism), and — as Part 3 below found — it turns out to be a much thinner defense at
seal time than the design docs describe, for reasons that have nothing to do with FROST's own math.

Sources: `docs/planning/end-to-end-flow.md` (Core Invariant 3, §2.3), `docs/planning/cello-initial-design.md`,
`docs/planning/discussion_logs/2026-04-15_0900_session-level-frost-signing.md`,
`docs/planning/discussion_logs/2026-05-31_0900_cryptographic-custody-chain.md`.

---

## Part 2 — T-of-N as it stands today

**Settled policy:** `T = majority(N) = floor(N/2) + 1`, counting validator-role directory nodes
only. Settled 2026-07-04, reconfirmed in the M12 DoD as a Tier-I invariant, explicitly closed to
re-litigation. Structurally the FROST group is `(T, N+1)` — the client itself holds a share, so a
signing ceremony needs `T − 1` directories plus the client; DKG needs the full `T` among directories
(the client can't stand in for a dealer-phase share).

**Why majority specifically, not just "higher T is more secure":** any T > N/2 makes it
combinatorially impossible to form two disjoint T-sized groups. Below that line, a coordinator
(malicious or just careless) could route two different ceremonies to two different, non-overlapping
subsets, each producing a validly-signed but different answer for the same identity — two
authorities for one agent. This is the property majority exists to foreclose, deterministically,
regardless of how many nodes are actually compromised. FROST's own math places no such requirement
on T — any `1 ≤ T ≤ N+1` is cryptographically sound; majority is a CELLO policy choice layered on
top for this specific reason.

**Why odd N:** not a tie-break/consensus mechanism (CELLO's anti-entropy mesh has no leader
election). `floor(N/2)+1` only increments on odd→even, so every even N has identical fault
tolerance to the odd N beneath it while costing one more live node per ceremony. Even N is strictly
wasteful.

**Scaling consequence, stated precisely because it's the actual concern driving this whole
investigation:** T grows with N under majority — N=3→T=2, N=5→T=3, N=7→T=4, N=11→T=6. Growing N does
not make ceremonies need fewer live nodes; it raises what every ceremony requires, in step with the
pool. Absolute down-node tolerance grows, but the proportional bar stays fixed near 50%.

**DKG scope and enrollment:** a FROST share is a secret, minted only during the DKG a node
participated in, never replicated between nodes (`DOD-INV-SHARES-LOCAL`, verified in code — no
`node_id` column on share storage, absent from every sync/anti-entropy set). The client persists the
exact quorum Q and threshold T it was dealt at registration and always signs against that fixed set
— never the live manifest. Consequence: growing N from, say, 5 to 11 does not strand agents
registered under the original 5 (they keep working, forever, on their original cohort), but the 6
new nodes are structurally useless to those agents — they hold no share for them. The only path to
change that is **resharing** (Desmedt–Jajodia dynamic resharing to a new access structure, group key
unchanged) — not a fresh DKG, which would mint a new identity. Resharing is directory-to-directory
only; the client does not participate and its own share is untouched. Designed
(`docs/planning/user-stories/m8b/2026-07-04_0556_tofn-registration-availability-quorum-enrollment-plan.md`,
`2026-07-03_1618_tofn-registration-preauth-capability-design.md`), directory side wired
(`frost-handler.ts` `generateRefreshContribution`/`applyRefresh`), client-side orchestration and the
"may-enroll" credential not built. Explicitly ruled not a launch item on 2026-08-03 (every current
agent postdates the GCP cutover, so nothing live is stranded today) — but flagged in the design docs
as becoming the *normal* path, not an edge case, once N is large.

---

## Part 3 — Tracing the seal ceremony: two confirmed gaps, independent of T

The original T-of-N question assumes the thing majority protects is "does a threshold of directory
nodes independently agree this transcript is real." Tracing the actual seal code shows that isn't
what happens.

**Gap 1 — co-signing directory nodes never verify content.** Content verification (recompute the
Merkle root from the leaf sequence, verify every per-leaf signature, verify the causal chain) happens
at exactly **one** directory node — whichever one the relay hands the completed leaf sequence to
(`end-to-end-flow.md:775`). The other `T−1` directories that get asked to contribute a FROST
signature share do no such check: `handleCeremonyRound` / `signRawMessage`
(`packages/directory/src/frost-handler.ts`) verify only that the node holds a share for that agent
and that there's no conflicting in-flight ceremony, then sign whatever `tbs` bytes they're handed.
No recomputation, no signature check, no causal-chain check. The one node that *did* verify checks
the returned aggregate signature against its own stored expectation
(`#processSealFrostSignature`, `packages/directory/src/directory-node.ts:5462`) — which blocks a
signature over the *wrong* content from being accepted there, but does nothing to make the other
`T−1` signers meaningfully independent witnesses. They are cryptographic weight without judgment.

**Gap 2 — only the initiator gets a pre-signature veto.** The seal initiator's client re-derives the
root from its own local transcript and refuses to co-sign if it's inflated — a hard gate, run
*before* any signature exists (`session-ceremony.ts`, DOD-LEG-2/SI-002: "doing it here means a lying
directory gets no signature at all"). The counterparty runs the *same* comparison, but only after
the fact, on receipt of `session_sealed` — by which point, per the same code comment, the result is
already "a durable artifact." No mechanism found that lets a counterparty's post-hoc mismatch
detection invalidate an already-issued `SealNotarization`.

**Combined implication:** if the initiator is the dishonest party (colluding with, or simply being,
one compromised directory node acting as the verifying primary), nothing in the ceremony as coded
stops a false transcript from becoming a permanent, validly FROST-signed record. The honest
counterparty's copy of the truth exists, but has no power until after the fact. This holds
regardless of T or N — raising T does not fix either gap, because neither gap is about how many
nodes need to collude.

**A third, distinct vector, separate from both of the above: truncation.** A primary directory node
that has been honestly relaying the real conversation could, at seal time, submit a genuine but
*truncated* prefix — nothing forged, just incomplete. Every leaf in it is validly signed; every
verifier (however many) will pass it, because nothing in it is false, only something is missing.
Forwarding raw signed data to more independent verifiers (the fix for Gap 1) does not catch this,
because all of them are being handed the same truncated feed by the same source.

### Proposed fix direction (not yet built, Andre's call on scope/timing)

- **Require affirmative pre-signature approval from every real participant, not just the
  initiator.** This closes Gap 2 and, as a side effect, mostly moots Gap 1 for content-forgery
  purposes: with both real parties independently comparing the claimed root against their own
  lived history and both required to approve before any signature share is produced, the trust
  anchor moves from "the verifying directory node is honest" to "at least one of the two real
  participants is honest" — a far more natural assumption for a communication protocol, and one
  that doesn't depend on directory-node behavior at all.
- **Forward raw signed leaf data, not a claimed root number, to co-signing directories**, so their
  verification is real rather than a rubber stamp on an assertion.
- **Truncation needs a different fix, at a different layer.** Directories never watch live
  conversations — only the relay (or direct P2P) does, and directories only see a batch, handed to
  them once, at seal time. The fix for truncation therefore belongs at the relay layer: fire-and-
  forget the live hash sequence to two or three relays instead of one, so a single relay's account
  at seal time can be cross-checked against an independent live witness. This fits CELLO's existing
  cost model better than adding redundancy at the directory tier — relays are meant to be cheap,
  stateless, and numerous specifically so this kind of redundancy is affordable; directories are the
  few, database-backed, anti-entropy-meshed tier you want to touch as little as possible.

---

## Part 4 — Unilateral seal: a confirmed gate gap, plus a working mitigation

Raised because it's the practical complication any "require both parties" fix runs into: agents lose
connectivity, or a counterparty simply doesn't respond in time, "quite frequently" in practice.

**Confirmed in code:** the unilateral-seal gate is purely time-based, with no presence check
whatsoever. `#processSealUnilateral` (`packages/directory/src/directory-node.ts:4353`) compares
elapsed time since the session's last recorded activity against `deliveryGraceSeconds` (default
`600` — 10 minutes) and grants a unilateral seal once that elapses. Nothing in that path checks
whether the counterparty is actually online, has a live connection, or is mid-composing a reply. A
fully-reachable counterparty who simply takes longer than 10 minutes to answer can be unilaterally
sealed out from under them — the protocol currently cannot distinguish "genuinely gone" from "still
typing." This is a separate problem from "absence should be third-party-evidenced, not
self-declared" (also true, also unresolved) — this one is about the *definition* of absence itself
being a flat clock rather than any signal of actual unreachability.

**What a unilateral seal is missing, precisely:** not validity — everything up through the absent
party's last actually-signed message remains exactly as strong as a bilateral seal, because both
signatures already exist, historically, regardless of who's reachable now. What's missing is only
the unconfirmed tail: messages sent after that last mutual point that nobody countersigned. Today's
unilateral seal treats the whole thing as uniformly weaker; it should instead be split into a
fully-strong mutually-signed prefix plus an explicitly, visibly lower-weight unconfirmed tail — so a
downstream consumer (human, arbitration system, payment dispute) never mistakes one for the other.

**Working mitigation, no protocol change required — the "extra round" pattern:** for any exchange
where the outcome matters (e.g. "I hereby agree to pay X for Y"), route it through an explicit
verify → confirm → acknowledge round before calling close: request confirmation, receive the
counterparty's explicit agreement, send back acknowledgment of that agreement. The material terms
then live inside the *mutually-signed prefix* itself, not the unconfirmed tail — so even an
immediate unilateral drop right after leaves nothing of substance unconfirmed.

**Note on escape-hatch risk:** if bilateral sealing gets meaningfully strengthened per Part 3 while
unilateral sealing keeps today's self-declared, clock-only trigger, a malicious initiator has an
obvious way around the whole fix — simply wait out the 10-minute timer (or engineer the appearance
of unreachability) and drop into the weaker path on purpose. Any fix to Part 3 needs an accompanying
answer for how "genuinely absent" gets evidenced by a third party, not just asserted — probably
using the same relay-redundancy investment proposed for the truncation fix, since relays that were
watching a conversation live already have an independent record of exactly when delivery attempts
to the missing party started failing.

---

## Part 5 — The T-of-N decoupling proposal itself

The idea: instead of `T = majority(N)`, fix T at a small, N-independent size, and select *which*
`T−1` directories participate in a given ceremony **unpredictably at random** from the full pool of
N (excluding the primary, which is fixed by session assignment). The claim: an attacker who doesn't
know in advance which nodes will be drawn needs to compromise a large fraction of N to have decent
odds of covering an unpredictable draw — decoupling what redundancy costs (N, cheap to grow) from
what every ceremony requires (T, kept small).

This is a real, established pattern — **cryptographic sortition** — not a shortcut. Framed against
the majority analysis above, it's solving the *same* problem majority solves (denying the
coordinator the ability to route around any specific set of nodes) via a different mechanism:
unpredictability instead of guaranteed overlap.

**It only delivers that if two things are true, and neither is true today:**

1. **Selection must be genuinely unbiasable and unpredictable in advance** — derived from something
   nobody controls at the moment they'd need to act on it (e.g. seeded from the session ID plus a
   value fixed before any node is contacted), not decided live by whoever is coordinating.
2. **No retry-until-favorable.** If a coordinator can abandon a ceremony that drew an inconvenient
   set of honest nodes and simply try again, the probabilistic guarantee collapses — retrying is
   nearly free unless the draw is bound to something that can't be cheaply regenerated.

Checked against the actual code: today's selection is neither. `FrostThresholdSigner` picks
`available.slice(0, threshold - 1)` — literally whichever reachable directories respond first, in
whatever order the client happens to contact them (`core/crypto/src/frost/frost-threshold-signer.ts`,
`core/daemon/src/session-ceremony.ts`). Lowering T without building real sortition would be a
regression, not a decoupling — it would hand the *existing* coordinator-driven selection an even
smaller bar to route around.

**Where this matters is not uniform across the protocol, and that asymmetry matters for scoping any
follow-on work.** For the *seal*, the Part 3 fix direction (require both real parties' own
signatures, independent of directory-threshold trust) already does most of the load-bearing work —
content correctness comes from K_local signatures the directories don't hold, not from directory
consensus. Decoupling T matters less there once that fix lands. For **session establishment**,
there is no equivalent to lean on — no prior bilateral record exists yet when `SessionAssignment` is
created; the binding *is* the origin of trust for that session, not a confirmation of something
already agreed. That is exactly where a properly-built sortition scheme would be carrying real,
load-bearing weight, and exactly where majority is currently the only thing doing that job.

**The trade being proposed, stated plainly:** majority gives an absolute, deterministic guarantee —
disjoint quorums are mathematically impossible, full stop, independent of how many nodes are
compromised (short of an outright majority). A correctly-built sortition scheme gives a
probabilistic guarantee — attacker success made vanishingly unlikely by choosing T appropriately
against an assumed bound on how many of N could ever be simultaneously compromised. That's a real
and viable trade for a system this size to make deliberately — but it is a trade, not a free
improvement, and the numbers (T, N, assumed-compromised-fraction) need to be run explicitly before
committing to it, not eyeballed.

---

## Open items — Andre's call

- Whether and when to require dual-party pre-signature approval for bilateral seals (Part 3 fix).
- Whether truncation-resistance (multi-relay fan-out, cross-checked at seal) is worth building now
  versus documenting as a known limitation, given it touches the live message path, not just the
  seal ceremony.
- Whether the unilateral-seal trigger should incorporate actual liveness evidence instead of a flat
  600s clock, and whether that's a launch-relevant fix or an accepted limitation.
- Whether to pursue a real sortition design for session-establishment threshold selection, and if
  so, sizing T/N/assumed-compromise-fraction explicitly before building it.
- None of the above blocks on the others — they're independently scoped, and independently
  deferrable, but the escape-hatch risk noted in Part 4 means the bilateral-seal fix and the
  unilateral-seal fix should probably not ship far apart from each other.

---

## Related Documents

- [[end-to-end-flow]] — Core Invariant 3 and the §2.3 bookend description this whole investigation
  starts from; also the source for the relay-submits-to-one-directory seal flow traced in Part 3
- [[cello-initial-design]] — the original forgery-resistance rationale for FROST ("compromising a
  threshold of nodes across jurisdictions is required to forge a signature") that Part 3 found
  doesn't hold as coded for the seal specifically
- [[2026-04-15_0900_session-level-frost-signing]] — why per-message FROST was dropped in favor of
  bookend-only ceremonies; the K_local-alone-in-between design this whole gap analysis sits inside
- [[2026-05-31_0900_cryptographic-custody-chain]] — the FROST-as-third-party-witness framing Part 1
  draws on, and the "Not Me" mechanism that's explicitly out of scope here
- [[2026-06-03_1200_frost-dkg-single-directory-gap]] — the earlier, different DKG-quorum defect
  (multi-directory DKG never actually implemented as 3-of-5); Part 2's DKG-scope/enrollment
  discussion is the settled aftermath of this
- [[2026-07-04_0556_tofn-registration-availability-quorum-enrollment-plan]] — the enrollment/
  resharing design Part 2 cites directly, including the "SETTLED, DO NOT RE-RAISE" threshold ruling
- [[2026-07-03_1618_tofn-registration-preauth-capability-design]] — the resharing-vs-fresh-DKG
  distinction (§9) that Part 2's enrollment summary is drawn from
- [[2026-07-07_1030_sec-2-frost-signing-forgery-finding]] — a different, earlier confirmed FROST
  forgery hole (arbitrary-message signing via a public key alone) in the same signing path; same
  family of problem, different mechanism than the Gap 1/Gap 2 findings here
- [[2026-04-08_1430_protocol-strength-and-commerce]] — the original fabricated-conversation-attack
  threat model; Part 3's truncation vector is a variant this doc did not anticipate
- [[2026-04-17_1400_directory-relay-architecture-reassessment]] — source of the relay-cheap/
  directory-expensive cost split Part 3's truncation-fix direction (relay fan-out, not directory
  fan-out) leans on
- [[2026-08-17_2036_interrupted-sessions-why-they-cannot-resume]] — a different unilateral-seal-
  adjacent investigation (sessions that can't resume at all); shares the unilateral-seal topic but
  addresses a different failure mode than Part 4's presence-gate gap
- [[2026-08-09_0400_a-conversation-that-was-never-recordable]] — a prior seal/relay/witnessing
  investigation; relevant background for the relay-fan-out truncation-fix direction in Part 3
