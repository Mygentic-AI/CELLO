---
name: T-of-N decoupling, and the seal-integrity gaps found chasing it
type: discussion
date: 2026-08-21
topics: [frost, threshold, dkg, quorum, seal, unilateral-seal, directory, relay, sortition, protocol-design, security, session-establishment, session-assignment, mitm, identity-binding, relay-witness, client-compromise]
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
  never on the counterparty's actual reachability. Covers a live proposal — decoupling T via
  unpredictable random committee selection (cryptographic sortition) instead of deterministic
  majority — and what it would actually require to deliver the same guarantee. Extends into a
  fourth, confirmed gap found while nailing the scope of session-establishment forgery: a real
  wrong-signer detection exists in the client's live message-ingest path, fires correctly, and is
  silently discarded — bounded precisely (self-exposes at seal time, live-only deception, cannot
  forge evidence against the impersonated agent) — with a fix direction (make the check block,
  emergency-freeze with neutral tagging) and its own adversarial check (a compromised client could
  weaponize the fix as a false accusation; relay-side corroboration, ideally proactive, closes it).
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

## Part 6 — What a FROST ceremony actually is (the conceptual correction that started this)

Recorded because it's the misunderstanding that made the T-of-N question hard to reason about in
the first place, and because the corrected model is what makes Parts 7–9 below legible.

**Not "shatter a key into shards that get welded back together."** In naive secret-sharing, using
the key means physically reconstructing it — for at least an instant, the complete secret exists in
one place. FROST never does this, not even transiently. Each shareholder uses only their own share
to compute their own piece of the *signature*; the pieces combine into one valid signature via
ordinary public math. The full private key is never assembled anywhere, by anyone, at any point.

**Light-math picture:** a straight line is fully determined by any two points on it — pick any two
points on the same line and you can derive exactly where it crosses a given axis, even though
neither point *is* that crossing value. Give five people one point each, secretly, and no single
person — and no group smaller than two — can compute the crossing value. But *any* two of the five
can, jointly, and it doesn't matter which two: any pair on the same line gets the same answer.
That's T=2 of N=5. A curve that needs three points to pin down instead of two is T=3. Each
participant's private key, in this picture, is their one point — not a fragment of a bigger key
needing reassembly, but a complete, independent secret that happens to sit on a curve shared with
the rest of the group.

**This directly explains why DKG needs broad participation but signing doesn't.** DKG is the
one-time act of creating the curve and handing each participant their point — real participation is
required because points aren't minted later (barring a separate resharing ceremony, Part 2). Signing
is just "gather any T of the already-existing points" — and because any T points on the same curve
agree, it doesn't matter *which* T show up. That flexibility is real, not the system being lenient.

**Consequence, confirmed directly against this structure: the client is not privileged in the FROST
math.** CELLO's group is `(T, N+1)` — client plus N directories, T needed. Nothing in FROST requires
the client to be one of the T. Two directories alone, reaching T on their own, can produce a fully
valid signature with the client never contacted, never aware. CELLO's software always includes the
client when *it's* the one driving a ceremony it initiated — that's a software convention, not a
cryptographic floor.

**But a valid signature over a fabricated root is inert, not dangerous, on its own — because signing
a root doesn't retroactively create real content underneath it.** A Merkle root only means something
because every leaf beneath it carries the sender's own K_local signature, and colluding directories
never hold that key. So T-of-a-target's-quorum compromise can produce a validly-signed number that
corresponds to nothing real — checkable and exposed the moment anyone pulls the actual leaves.
**This is the correct, load-bearing reason majority-of-directories does *not*, by itself, let a
compromised quorum forge a false transcript for a real, uninvolved agent** — confirmed correct
reasoning, with one condition attached: it holds only as long as verifying a seal always means
checking the leaves against the real signer, not just confirming the FROST signature is
mathematically valid (Part 3's Gap 1/Gap 2 are exactly a case where that condition was not met).

---

## Part 7 — The session-open gap: scoped and bounded precisely

Chasing "does the K_local anchor protect session-open the same way it protects the seal" surfaced a
real, confirmed gap — and then, on closer trace, a real, confirmed *bound* on how bad it actually is.

**What session-open actually attests, and why it's a different claim than the seal's.** The seal
attests to *content*: a specific, already-lived conversation ended in this state. Session-open
attests to *identity*: the pubkey your daemon is about to exchange messages with really is the one
registered to the party you meant to reach. There is no prior signed history to check that claim
against — the `SessionAssignment` binding *is* the origin of trust for the session, not a
confirmation of something already agreed. That asymmetry is the entire reason this needed separate
treatment from the seal findings in Part 3.

**The forgery does not require anyone's private key, and that's what makes it different from
everything in Part 6.** A rogue majority of the *specific* directories holding shares for the target
agent (call them B) can FROST-sign a false `SessionAssignment` claiming a different pubkey (M's) is
B's session key — no K_local forgery needed anywhere, because the claim being forged is "here is
who you're talking to," not "here is what was said." Once agent A accepts that binding, everything
downstream becomes genuinely, legitimately real: A sends real messages, M replies with M's own real,
valid K_local signature (M is a real, properly-registered agent — nothing about M's own identity is
fake), the hash chain is intact, the eventual seal is fully valid. There is no missing signature
anywhere for A to notice, because M never needed to forge anything downstream — only the one-time
claim of who A was about to talk to.

**Scoped precisely against a concrete example (N=7, and separately N=11 with a malicious client
counted toward T): the malicious client's own share is irrelevant to forging as a *different* target
agent.** A share only ever authenticates its own holder. To impersonate B specifically, the attacker
needs shares from B's own DKG quorum — not M's, and not "any T directories in the network." Compromising
directories that never held a share for B is cryptographically inert against B, regardless of how
legitimate M's own identity is. And because the real B (and B's client) is by definition not
participating in an impersonation of B, there is no client slot to lean on — the attacker needs the
**full T from B's directory quorum alone**, a strictly harder bar than "any T of N."

**Checked in code whether already knowing B's real pubkey protects the connection step: it does
not, today.** `initiate-session-handler.ts` labels the resulting session with whatever `target_pubkey`
the caller specified in its own request — it does not cross-check that value against what the
(possibly forged) assignment's connection info actually leads to before dialing. Knowing B's real key
in advance buys nothing at the connection-establishment step as currently implemented.

**Checked whether anything catches it once the session is live: yes, and here is the exact, confirmed
shape of the defect.** `session-node-manager.ts`'s `#recordFrameOrdering` genuinely verifies each
message's signature and genuinely checks that the signer matches the session's registered
counterparty (`pubkeyMatchesHex(s1Pubkey, counterparty)`) — a real "wrong signer" detection exists
and correctly fires the moment M signs with its own key instead of B's. But the result is discarded:
the calling code treats a failed/absent ordering record as uniformly non-fatal ("the content still
ingests"), and `ingestReceivedContent` attributes the message to `record.counterparty_pubkey` — the
session's stored label — rather than to whatever was actually, cryptographically proven. The check
exists, fires correctly, and its answer is thrown away.

**Checked whether this poisons the *permanent* record too, not just the live view: it does not.**
At seal time, `directory-node.ts` verifies each leaf's signature against the pubkey **embedded in
that leaf itself** (`leaf.s2.sender_pubkey`), never against a cached session label. So a sealed,
notarized record of this session would correctly show M's real pubkey as the participant — not B's.
**This bounds the harm precisely: the deception is live-only, not permanent.** It can fool A during
the conversation — enabling exactly the harm named below — but it cannot produce a lasting record
that looks like it was genuinely with B. Comparing the sealed receipt's actual participant pubkey
against the pubkey originally intended exposes it, after the fact, every time. One thread not fully
resolved: `verifySealLeaves` only constrains the final two SEAL control leaves to be from two
distinct participants; whether every earlier content leaf is independently constrained to that same
pair (as opposed to merely being internally self-consistent) was not confirmed. It did not change
the finding above, because in the traced MITM scenario the "two participants" the record shows are
simply A and M throughout — nothing about a real, absent B ever enters the leaf sequence — but it is
a distinct, unresolved question worth closing separately.

**The actual, bounded harm, confirmed: A can be duped into disclosing something to M while believing
it is disclosing to B.** Not forged evidence against B — nothing can ever make it look like B said or
agreed to anything, because nothing here touches B's key — but a live confidentiality/social-
engineering harm, fully real for the duration of the conversation, self-exposing only afterward.

**Analogy that holds up:** dialing a phone number, but the phone company — the trusted routing layer
— hands you to an impostor instead of the number you dialed. Not an incidental misroute; a betrayal
by the party whose entire job is to connect you correctly.

---

## Part 8 — Fix direction: make the existing check block, not just log

The mechanism needed already exists in the code and already checks the right value — `counterparty_pubkey`
is set from A's own request, untouched by anything the directory returns, so it is structurally immune
to directory-side compromise. **The fix is not new cryptography; it is removing a silent fallback.**

- **Split "where in the sequence" from "who sent it," and stop treating them the same.** A missing or
  malformed *ordering* record is genuinely fine to fall back on (arrival order, recovered later from
  the witness stream) — that's optional metadata. A message that fails to supply a valid, parseable,
  verified signature from the expected counterparty is **never** fine to fall back on, for *any* of
  the three reasons a check can fail — missing, malformed, or mismatched. Treating "we couldn't tell"
  and "we proved it's wrong" as equivalent-and-harmless is itself the hole: an attacker who wants to
  evade a mismatch check simply never supplies a checkable signature at all, and today that omission
  is treated as harmless. All three must collapse into one response.
- **That response: refuse the message outright** — no ingest, no display, no attribution to anyone —
  and fire as early as the very first message, closing the exposure window to effectively nothing
  rather than waiting for a pattern to emerge.
- **Treat detection as session-ending, not per-message.** One proven wrong-signer event is not "drop
  this message and hope the next one is better" — it's evidence the connection itself isn't who it
  claims. The response is an **immediate, unilateral, emergency freeze** — distinct from an ordinary
  unilateral seal (counterparty simply unreachable, timer elapsed) — carrying its own status so
  nothing downstream conflates "they didn't answer in time" with "we caught something that didn't
  check out."
- **The freeze's tag must describe an observation, not a verdict.** Something like "a message failed
  to verify against the expected counterparty's key; session frozen defensively; cause undetermined"
  — never an assertion of the counterparty's intent. The same signal (signature mismatch) could come
  from a real impersonation attempt, or from CELLO's own infrastructure mishandling a fallback path —
  a relay bug, a bad deploy, an uncovered edge case in the direct-connection failover. The system has
  no way to distinguish those from the signal alone and should not pretend to. This mirrors an
  existing CELLO pattern rather than inventing a new one: account-recovery already anchors a
  "compromise window" to logged events instead of a guess, and already accepts that some evidence
  cannot distinguish misconduct from an innocent cause. This flag should not feed automatically into
  any trust-signal or reputation score, for the same reason.

---

## Part 9 — Defense-in-depth: the client raising this flag can itself be the compromised party

Adversarial check on Part 8's own fix, in the same spirit as everything before it: the party best
positioned to *detect* a wrong-signer event (the receiving client) is also a party that can itself be
compromised — and a compromised client weaponizing "signature mismatch" as a false accusation against
an innocent counterparty is a new attack surface the Part 8 fix would otherwise introduce.

- **Separate the safe part of the response from the part that needs corroboration.** Freezing
  locally the instant a client's own check fails is always safe to do unilaterally — it only limits
  what that client itself trusts, and harms no one. What must **not** be asserted unilaterally is the
  accusatory record: "session frozen, signature failed to verify" should not be written down as
  something that could reflect on the counterparty until corroborated by a party the accusing client
  doesn't control.
- **The relay is that corroborating witness, and it works for a precise reason: its copy of what the
  sender signed never passes through the receiving client at all.** The sender reports its signed
  hash to the relay independently of whatever path the content itself takes to the receiver. A
  compromised receiving client has no way to touch, edit, or suppress that independent copy. Pulling
  it and checking it against the counterparty's real key — on demand, the moment a mismatch is
  suspected — either corroborates the claim or exposes the accusing client as the actual problem. No
  new cryptography: this is the identical check the directory already performs at seal time
  (`leaf.s2.sender_pubkey` verified against `structure1_cbor`/`sender_signature`), just triggered
  early instead of only at close.
- **Sharper still: the relay should run this proactively, continuously, not only on demand.** It is
  bound to the session at setup with both participants' real pubkeys already in hand, and it already
  receives every signed hash as messages flow — checking each one against the two expected pubkeys
  costs it nothing new. This catches a mismatch the instant the first bad hash arrives, independent
  of whether the receiving client ever notices or is even running its own check correctly — which
  specifically closes the "what if the accusing client is the compromised one" gap, since detection
  no longer depends on that client's cooperation or honesty at all. Detection is not enforcement,
  though: the relay still has to alert the affected daemon (and could additionally refuse to keep
  relaying/witnessing for a session it's flagged, a lever it has that the client alone doesn't).
- **One relay is still one witness, and that ties directly back to Part 3's truncation fix.** A
  single relay could simply decline to run the check, or lie about the result — the same reasoning
  that made a single relay's account insufficient for truncation-resistance applies here without
  modification. If the multi-relay fan-out proposed in Part 3 ships (2–3 relays receiving the live
  hash stream instead of one), each of them running this same proactive check turns it into a cheap,
  decentralized detection layer with no single point of trust — client, directory, or relay. Three
  separate problems in this log converge on the same one piece of infrastructure, which is a good
  sign it's the right thing to build, not a coincidence.
- **This whole layer stays inside the "blind witness" design.** Verifying a signature against a known
  pubkey never requires reading message content — nothing new is exposed to the relay by any of this.

---

## What Needs to Be Built or Modified

- **Seal ceremony:** require affirmative pre-signature approval from *both* real participants — not
  just the seal initiator — before any FROST signature is produced over a bilateral seal (Part 3).
- **Seal ceremony:** forward the raw signed leaf sequence, not just the claimed root, to every
  co-signing directory node, so each independently re-verifies against real K_local signatures
  instead of trusting an assertion handed to it (Part 3, Gap 1).
- **Truncation-resistance:** fan the live hash-relay out to two or three relays instead of one, with
  the receiving side cross-checking a single relay's account against the others at seal time (Part 3).
- **Unilateral seal:** split the sealed artifact into an explicitly labeled, full-strength
  mutually-signed prefix and a distinctly lower-weight unconfirmed tail, instead of presenting the
  whole thing as uniformly weaker (Part 4).
- **Unilateral seal:** require the absence trigger to be evidenced by a third party (a genuine
  delivery-attempt/timeout record from the relay or directory), not just asserted by the initiator
  (Part 4) — depends on the relay fan-out above landing first.
- **Live content-ingest path:** make the existing wrong-signer detection a hard, blocking,
  session-ending gate — covering all three failure shapes (missing, malformed, *and* mismatched
  signature proof, not just mismatch) — refusing ingestion/display/attribution outright, firing on
  the first affected message rather than after a pattern emerges (Part 7–8).
- **Live content-ingest path:** on detection, trigger an immediate, unilateral, emergency freeze with
  its own status/tag distinct from an ordinary "counterparty absent" unilateral seal, worded as a
  neutral observation ("signature failed to verify against expected counterparty; cause
  undetermined") — never as an assertion of intent — and excluded from feeding automatically into any
  trust-signal or reputation score (Part 8).
- **Relay:** build on-demand corroboration — when a client suspects a signature mismatch, pull the
  relay's independently-held signed record for that message and verify it against the counterparty's
  real key before the mismatch is treated as an established finding, not just the accusing client's
  own word (Part 9).
- **Relay:** build proactive, continuous verification — the relay already holds both participants'
  real pubkeys from session setup and already receives every signed hash live, so check each one as
  it arrives rather than only on request; alert the affected daemon on a mismatch, and consider
  having the relay itself decline to keep relaying/witnessing a session it has flagged (Part 9).
- **Verify, and close if confirmed:** whether seal-time verification restricts every content leaf —
  not only the final two SEAL control leaves — to one of the session's two registered participants;
  not yet confirmed either way (Part 7).

**Sequencing dependencies among the above, not open questions:** the live-ingest blocking gate and
the relay corroboration items should ship together — the gate alone, without corroboration, reopens
the false-accusation risk corroboration exists to close. Strengthening bilateral sealing without also
fixing the unilateral-absence trigger creates an escape hatch — a bad actor just waits out the
unilateral timer instead of beating the strengthened bilateral path — so those two should also not
ship far apart.

---

## Outstanding Design Decisions

- **Unilateral-seal trigger — pure elapsed time (current) vs. third-party-evidenced delivery failure
  vs. a hybrid of both.** Today's flat 600s clock can't distinguish "genuinely gone" from "still
  typing." Pure evidenced-failure is more accurate but depends on the relay fan-out work landing
  first. **Recommendation:** hybrid — keep a time floor as a backstop, but require it to be paired
  with an actual delivery-attempt/timeout record once the relay infrastructure supports it, rather
  than elapsed time alone ever being sufficient on its own.
- **Unilateral-seal timeout — fixed constant vs. configurable per session/stakes-tier.**
  **Recommendation:** make it a dial. Casual sessions keep today's fast default; a session either
  party flags as high-stakes gets a longer wait and requires stronger absence-evidence before
  falling back to unilateral.
- **T-of-N — keep deterministic `majority(N)` vs. pursue cryptographic sortition (unpredictable
  random committee selection) to decouple T from N.** Note this decision's shape changed over the
  course of this investigation: sortition's original motivating case was defending session-open, but
  that's now separately addressed by the blocking signer-check above, which works regardless of what
  T or N are. So this decision is now purely about availability/scaling as N grows, not about closing
  the MITM gap. **Recommendation:** defer. `majority(N)` is simple, deterministic, and already
  correct; sortition requires real cryptographic engineering (unbiasable, unpredictable selection
  with no retry-until-favorable) for a benefit — leaner per-ceremony node counts at large N — that
  isn't urgent until directory count actually needs to grow past what majority(N) comfortably
  supports.
- **Relay corroboration — on-demand (pulled only when a client suspects a mismatch) vs.
  proactive/continuous (every relay checks every hash as it arrives).** **Recommendation:**
  proactive. It's the same data the relay already holds, costs nothing new to check continuously, and
  — unlike the on-demand version — doesn't depend on the client's own (possibly compromised)
  cooperation to ever get triggered at all.

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
