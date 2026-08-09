---
name: Sharing a sealed conversation
type: discussion
date: 2026-08-09
topics: [seal, transcript, sharing, consent, directory, schema, screening, attestation, feature-idea]
status: design-sketch
description: >
  A missing feature: showing a third agent a conversation you already had, with proof it is
  the real thing. Rides on the existing request/trust/accept session gate and the seal
  certificate. Four decisions taken; the consent answer also settles what the directory is
  for. Consent is counted (once / N / unlimited), scoped (anyone / a named pubkey list) and
  expiring, which makes it a double-spend problem that a majority threshold solves. Needs a new
  append-only grant-and-consumption table on the directory, collected on expiry down to a
  hash-only tombstone. Not launch-blocking.
---

# Sharing a sealed conversation

## The idea

Andre, this session:

> Let's say you had some session and you now have a receipt of that convo. You can share it with
> another agent. This is very similar to sharing your trust signals in that the directory provides
> the seal confirmation. Send this transcript to this agent. And directory attests that the seal
> matches the record.

The constraint he put on it in the same breath is the good part: **it can only happen inside a
session that already exists.** That is not a limitation bolted on for safety — it is the whole
reason the feature is cheap. If you are not willing to accept my session, I cannot send you
anything. The gate is already built, already tested, and already the thing operators understand.

## What it looks like from the chair

You had a conversation with B on Tuesday. It sealed. Today you want to show C.

1. **You need a live session with C.** Either you already have one, or you request one and C
   accepts. Same request → trust check → accept path as any other conversation. If C will not talk
   to you, this feature does not exist for you.
2. **You offer the sealed conversation.** You pick it the same way you would pick any past session.
3. **Your own side checks whether B is okay with this** before anything leaves your machine — see
   the next section.
4. **The directory is asked one question:** is this seal still your current record for that session?
5. **C does not get a wall of text.** C gets a notice: a verified transcript arrived from you, N
   turns, between you and B, sealed on Tuesday. C's agent reads it on demand, through screening.
6. **If the check fails, nothing is sent.** You are told why, and offered the obvious fallback:
   paste it as a regular message. Which is exactly what everyone does today — just without the
   proof. The failure mode degrades to the status quo rather than to a dead end.

## The four decisions

### B has to agree — and asking B is just a conversation

A transcript is bilateral. B never agreed to be shown to C. Andre's answer:

> Consent at seal time and if that is not there then B must consent at share time. This is a
> standard convo. "Hey I want to share this with Y for these reasons." B must change their sharing
> status.

Two paths, one fallback into the other:

- **Agreed at seal time.** When the conversation seals, both sides settle a sharing disposition
  that rides in the certificate. No one has to be online later. This is the fast path.
- **Not agreed at seal time.** Then you go and ask, and the asking is *an ordinary CELLO session
  with B*. No new consent protocol, no new frame type, no new UI. You open a session with B and
  say why you want to show it to C. B changes the sharing status on that sealed conversation.

This is the strongest part of the design. Every other consent model we considered invents
machinery. This one notices that CELLO is already a protocol for two agents agreeing on something,
and uses it for the one thing it is obviously for.

### The directory's job is "still current", not "is this real"

Worth being precise, because the original framing was slightly off. A seal certificate is a
threshold signature by the directory nodes over the session id, the sealed root, the leaf count and
the timestamp. That means **C can already verify a transcript with no directory involved at all**:

- Change a single word and the root no longer matches.
- Drop the last three turns and the leaf count no longer matches.
- Fabricate the whole thing and the signature fails.

So "the directory attests the seal matches the record" is not what makes it trustworthy. The
signature does that, offline. What the directory adds — Andre's pick — is the one thing a signature
cannot say: **this seal is still my current record, and it has not been superseded or revoked.**

That matters concretely. A session that was interrupted and later re-sealed has two valid-looking
certificates, and only one of them is current. Without the live check, you could show C the
convenient version.

**And this is where the consent answer pays off a second time.** B's sharing status has to live
somewhere C can trust. The directory is already being asked, live, whether this seal is current.
Making the sharing grant part of that same current record means one question answers both — *is
this seal current, and is sharing still permitted* — and it gives B something real: **B can
withdraw.** Revocation falls out of a mechanism we were building anyway.

The directory never sees the conversation. It holds the root and the grant. No bodies, no content.

### Whole transcript only

No excerpts in v1. C gets every turn and recomputes the root directly. Sharing leaves N..M with
inclusion proofs is technically available — the tree is already there — but it buys the ability to
quote-mine with a verification badge attached, and it buys plumbing. Whole thing or nothing.

### Notice first, read on demand

This is the largest prompt-injection surface in the protocol and it should be named as such. A
shared transcript is a big blob of text written by someone who never agreed to talk to C, arriving
unrequested into C's agent. **Verified means authentic, not safe** — the signature proves B really
wrote those words, faithfully including any instructions B buried in them.

So nothing enters C's context on arrival. C gets the metadata; C's agent calls a read tool to pull
the body; the body comes through screening, framed as quoted third-party data rather than as
anything addressed to C.

## What a permission actually says

Andre's spec, this session:

> 1. Share once, share only x times, Free to share (no limit)
> 2. Share only with … A) Anyone. B) A public key list of approved receivers. These must be provided
>    with the request. Requester can provide a short bio (max 100 chars) with each to convince
>    counterparty B. All request text goes through screening as usual.

Plus expiry, added in the same conversation. So a grant is a point in a small grid: **how many
times** (once / N / unlimited) × **to whom** (anyone / a named list) × **until when**.
Unlimited-plus-anyone-forever is not really a share permission at all — it is a decision to publish,
and it should be worded that way when B is asked for it.

**Expiry should be mandatory, with a long default rather than an optional field.** Two reasons.
Consent that never lapses is the kind B forgets they gave, and a grant B has forgotten is not
meaningfully consent. And — see the retention section below — an immortal grant is an immortal
directory record. Optional expiry means the one permission most worth forgetting, unlimited to
anyone, is the one that never can be.

### Counting is a double-spend problem, and it only works because the threshold is a majority

"Share once" is a single-use token, and CELLO has three sovereign nodes and no leader. Two nodes
asked at the same instant could each authorise the last remaining share. That is a double-spend, and
it is the hardest thing in this whole feature.

It is solvable here, and the reason is worth writing down: **any two majorities overlap in at least
one node.** A share consumes a slot only if a threshold of nodes votes to consume it, and a node
that has already voted to spend slot 1 refuses to vote for it a second time. Because every quorum
shares at least one member with every other quorum, the second concurrent ceremony cannot reach
threshold. There is always a witness. Counted sharing is correct *because* T is a majority — it
would not be under any scheme where two disjoint quorums can both succeed.

**Fail closed:** record the consumption before returning the authorisation, so a share that dies in
flight burns its slot. That is the safe direction. The alternative — only counting on confirmed
delivery — lets a retry loop overspend, and quietly turns "once" into "as many times as A is willing
to disconnect."

### The count governs verified shares, not information

This has to be said to B in plain words at the moment B is asked. A limit of one does not stop A
copying the bytes and pasting them anywhere. It limits **how many times the protocol will vouch for
them** — after that, A is just a person with a text file making an unverifiable claim, which is
precisely the world without CELLO. That is a real and useful thing to sell. It is not containment,
and if the UI lets B believe it is containment, B has been misled.

### The named list means the directory learns who — but only if we ask it to

**Superseded by the leakage section below.** The claim as first written was that a named list forces
the directory to learn the allowlist. That is true only if the *directory* is the one checking
membership, and it does not have to be: the list sits inside a grant B signed, and the grant travels
with the share, so the recipient can check their own membership offline. What that costs is
enforcement against a recipient who does not care to check. Worked through properly below.

One thing that does hold: hashing the pubkeys is not a fix. The directory holds the registry, so it
can hash every key it knows and match. Hashing moves disclosure from grant time to share time and
should never be described as privacy.

### The bio is the highest-value injection target in the protocol

Every other piece of text in this flow is content being transported. The bio's entire *job* is to
change someone's trust decision, and it arrives in front of B at the exact moment B is making one.
100 characters is the right kind of limit. Two additions:

- **Record it in the grant.** B consented on the basis of a specific claim about who C is. That
  claim belongs in the record, or later there is no way to tell what B was actually told.
- Screening applies, as Andre says — but the framing matters. It is a quoted claim by A about a
  third party, not a statement of fact, and it should reach B looking like one.

### Calls I have made on the gaps

Flagging these as mine rather than settled, so they are easy to overturn:

- **The count is global, not per-recipient.** "Three times" against a list of five means three, not
  fifteen.
- **Re-sharing to the same recipient does not burn a second slot.** Otherwise a dropped connection
  costs B's generosity, and A will rationally hoard slots instead of retrying.
- **B's grant is B's own statement, not a yes/no on A's request.** B can grant less than was asked —
  you wanted unlimited, you get two. Cleaner than a negotiation round, and it makes the grant a
  self-contained thing C can read.
- **Exhausted, revoked, superseded and not-on-the-list are four different answers.** Never collapse
  them into "denied." The codebase is emphatic about this and it is right: a collapsed reason sends
  the operator to the wrong place.

## What the directory can actually see — and how little it needs to

Andre's framing:

> Consider leakage — what a dir can see. X session (a hash) that agent A has a plain text copy of
> can be shared with anyone.

Exactly right, and it reframes the problem. The directory holds a hash and cannot read the
conversation; A holds the plaintext. So nothing here leaks *content*. What leaks is the **graph** —
who showed what to whom, when, and how often. That is the thing to minimise, and it turns out the
three axes leak very differently.

**Take them one at a time, asking only: does the directory have to be involved at all?**

- **Expiry — no.** It is a field in the grant B signed. Anyone holding the grant can read the date
  and check it. Zero leakage.
- **Scope — no, if the recipient checks themselves.** The allowlist is inside the signed grant, and
  the grant travels with the share. C looks for their own pubkey under B's signature. The directory
  never has to see the list at all.
- **Count — yes.** A count is shared mutable state across three nodes; there is nothing else it
  could be. But the directory only needs to know **that a slot was spent**, not who spent it or who
  received it.

Which produces a much smaller record than the one this log proposed two sections ago. **The
directory needs the grant's hash, its count limit, and its expiry. Not the allowlist, not the bios,
not the recipients.** Everything with a name in it stays with A, B and C, and is verified against
the hash. That is the hash-custodian pattern this project already runs on, applied properly.

| | Who checks it | What the directory must see |
|---|---|---|
| Expiry | anyone, offline | nothing |
| Scope, advisory | the recipient, offline | nothing |
| Scope, enforced | the directory | the allowlist, and every recipient |
| Count | the directory | that a slot was spent, and when |

**The catch on scope, stated plainly.** Offline membership checking is advisory: it stops a
well-behaved recipient from accepting something not meant for them, and it does nothing against an A
and a C who are content to ignore it together. Enforcement requires the directory to hold the list
and be told who each share is going to. So this is a real choice, and it belongs to B: *enforced,
and the directory sees who* versus *advisory, and the directory sees nothing*. Neither is wrong.
Hiding the trade would be.

### The all-inclusive grant is the one the directory never hears about

Now Andre's actual question. Take "anyone, unlimited, until March": scope needs no check because
there is no list, count needs no check because there is no limit. **No per-share directory contact
exists at all.** C is handed the transcript, the seal certificate and B's grant, and verifies the
whole thing alone.

Three consequences, and the middle one is the point:

1. **It is the most private grant in the system.** The directory learns that a grant exists on a
   session it cannot read, and never learns a single recipient. Not one.
2. **Revocation dies with the directory check.** Nobody is asking, so there is nothing to answer.
   **Expiry becomes the only surviving control on the most permissive grant we offer.**
3. **It is also the cheapest to forget** — one row, no consumption facts, collected at its expiry.

So the answer to what we do about expiry on all-inclusive grants is the opposite of the intuition
that unlimited means B stopped caring: **the cap should be tighter here than on restricted grants,
not looser**, because it is the only brake left. A restricted grant can be revoked the moment B
changes their mind. An all-inclusive one runs to its date no matter what B wants on day two.

### The trade nobody expects

**Restricting costs privacy; permitting costs control.** The more B narrows who may see the
conversation, the more the directory learns about exactly those people. The more freely B gives it
away, the less anyone but B and A knows. That is genuinely counterintuitive, and it should be said
out loud in the UI when B picks "only these three" — B is choosing to tell the directory about those
three.

## Should the directory forget? Yes — but "once dead", not "once used"

Andre's question:

> Should the records of share request be expunged from the DB once used, to limit info in the dir?

**While a grant is alive, nothing under it can be deleted, because the records *are* the
enforcement.** The count is not stored as a number; it is the number of consumption facts. Delete
them and "share three times" silently becomes unlimited. So "once used" cannot be the rule in
general — for a counted grant, used is precisely when the record starts mattering.

**But for share-once it is exactly right, and that generalises.** A grant with one slot is dead the
instant it is spent, and a dead grant's records enforce nothing. The rule is *once dead*: exhausted,
revoked, or expired. Share-once is just the case where used and dead coincide.

**And this is why expiry earns its place beyond consent hygiene.** Without it, a grant can sit alive
forever, and so can everything under it. Expiry is what guarantees every grant eventually dies, which
is what makes the directory's memory finite. The two decisions in this message are one mechanism.

**Deletion has to be a pure function of the signed grant, or replication will resurrect it.** These
tables replicate. If one node deletes a row and its peers have not, anti-entropy sees divergence and
repairs it the wrong way — the peer that still holds the row hands it back. Exhausted and revoked
are both derived from replicated facts, so nodes reach them at *different times*, and a node that
has not yet learned of a revocation will happily restore what another just collected. **The expiry
timestamp is different: it is inside the grant B signed, so every node holding the grant computes
the same deletion date without needing to have converged on anything else.** Collect on expiry plus
a grace window for clock skew, and all three nodes independently arrive at the same answer.
Exhausted and revoked grants stay put until their expiry catches up with them. Slower, and correct.

**Leave a hash, not nothing.** A shared conversation is evidence-adjacent: if B later says "I never
allowed that", the grant is what proves they did. Deleting it outright destroys the record that
protects A. A tombstone carrying only the grant's hash keeps dispute resolution alive at close to
zero standing information — the directory can confirm a grant with that hash existed and say nothing
about its contents. That is the hash-custodian pattern this project already runs on, and it means the
real archive lives where it should: both A and B hold B's signed grant themselves.

**Be honest about what this buys.** Deleting later does not unlearn. Under directory-enforced scope
the allowlist and every recipient were observed as they happened, and expunging shrinks what a
future compromise or subpoena can extract, not what was seen. (Under the advisory default there is
correspondingly little to expunge — which is the better argument for the advisory default than any
retention policy.) And it is cosmetic unless the retention rule covers
**logs too** — the observability rules require named events with context fields on every flow, so
deleting rows while leaving a year of correlated pubkeys in log storage is theatre. Whatever TTL the
table gets, the log events for the share flow need the same one.

## This is directory work, not just client work

Andre, mid-session:

> This will need directory work. Session records in the DB must now include share permissions.

Correct. And the first draft of this section got its reasoning wrong in a way worth recording,
because the same trap is sitting there for anyone who reads the migration history.

**Ignore the backward-compatibility argument entirely.** The existing migration notes make a strong
case for never adding columns to the seal records: the table is hash-chained, so a new column breaks
chain verification on every historical row, and it replicates, so the anti-entropy record hash of
every historical row changes and all three nodes report divergence on data that never changed. Every
word of that is about protecting rows that already exist. **We have no users and we are in alpha.
There is no mandate to keep old sealed sessions working.** We can drop the database. So that argument
buys us nothing here, and building around it would be pure waste.

**A separate table is still right — on a completely empty database, for reasons of its own:**

- **The seal record is an immutable event; a share permission is mutable state.** The seal row says
  *this session sealed, at this root, at this time*. Written once, never changed — which is the only
  reason it can be hash-chained at all. A sharing grant changes: granted, revoked, granted again.
  Put a mutable column in a hash-chained table and you pick between two bad outcomes. Exclude it from
  the chain and it sits inside a protected table with no protection, which is worse than being
  outside one because it looks safe. Include it in the chain and every change rewrites history, which
  means there was never a chain.
- **It is one-to-many over time, not one value.** A permission is a sequence of signed facts, not a
  current setting. A column can only hold the latest, which means `UPDATE`, which means three
  sovereign nodes racing with no ordering authority and last-writer-wins deciding consent. A child
  table of append-only facts has no race to resolve.
- **Different signer.** The seal is attested by the nodes' threshold ceremony. The grant is signed by
  B. One row carrying two independently-signed claims has no coherent story about who vouched for
  what.
- **Different writer, different moment, different authority.** The directory writes the seal at seal
  time on its own authority. The grant is written later — possibly much later — on B's, through a
  different authorization check.

Those hold whether the table has ten million rows or zero. That is the test that matters.

**Append-only, with the effective state as a view.** Grant and revoke are both just signed facts
that get inserted; nothing is ever updated in place. There is already a table doing exactly this for
revoked trust signals — insert-only row-level security, and a view that computes what is currently
true by folding the append-only facts together. Copying that shape sidesteps the hardest problem in
the whole design: a mutable row that three sovereign nodes can each change independently needs
conflict resolution, and an append-only log of signed facts needs none.

**B's signature travels with the grant.** The directory is not the authority on whether B consented
— B is. Every node stores the signature and re-verifies it independently rather than trusting the
peer that replicated it to it. This is what keeps the sovereign-node invariant intact: any node can
answer the permission question, and no single compromised node can invent a permission that B never
gave. It is the same reasoning that puts the revoker's signature in the revocation table.

**Two traps already paid for:**

- The signature column is `BYTEA`, not `TEXT`. The trust-signal revocation table shipped that column
  as `TEXT`; it compiled, it migrated, and then it failed on the first real revocation with
  `invalid byte sequence for encoding UTF8: 0x00`. Every unit test stubbed the connection pool, so
  only an integration test against a real Postgres caught it. The pubkey column really is `TEXT` and
  the signature really is `BYTEA` — the pair reads as though it should not be, and that is precisely
  why it gets typed wrong.
- Key on the session id and the granting pubkey. Not on any display name.

**Two kinds of fact, not one — and the directory holds a redacted view of both.** The *grant* as an
object carries scope, count, expiry, the per-recipient bios and B's signature, and it travels with
the share so A, B and C all hold it whole. The directory's row holds only what it must enforce:
**the grant's hash, the count limit, and the expiry.** No allowlist, no bios. Each *consumption* is
an appended fact naming the grant it spends — and, in advisory mode, nothing else; the recipient
appears only if B chose directory-enforced scope. Effective state is the fold: latest grant, still
inside its expiry, minus the consumptions against it.

**Append-only does not mean immortal.** The one thing that removes rows is the expiry-driven
collection described above, and it is safe precisely because it is computed identically on every
node from a signed field rather than from convergence state. Everything else only ever inserts.

**Ordering is the one genuinely new problem.** Signal revocation is terminal — one-way, so a replayed
old fact is harmless. Share permission is not: B may grant, revoke, and grant again. Across three
nodes converging out of order, a replayed old grant must not undo a newer revoke, and consumptions
must not drift onto the wrong grant and resurrect spent slots. A monotonic counter per session and
granter, with every consumption naming its grant's counter, handles both. **Decide it before
anything is written, not during anti-entropy.**

**Old sessions are a non-issue, twice over.** Conversations sealed before this ships have no
recorded disposition and none can be reconstructed. Normally that is the painful part of a change
like this. Here it costs nothing: we are in alpha with no users, so the honest answer is that we can
wipe the database — and even if we didn't want to, no disposition just means you take the
ask-B-later path, which is where most shares would land anyway. Do not spend a single design
decision on preserving pre-existing seals.

Housekeeping: next free migration number is V63, and the expected-migration-version knob the
ops-agent checks on boot has to move with it or fresh deployments crash-loop. Confirm where that
knob lives now — it was an AWS parameter file before the GCP cutover.

## Two consequences worth stating plainly

**Revocation does not recall bytes.** Once C has the transcript, C has it. If B withdraws consent
tomorrow, the copy on C's disk is still cryptographically valid. Revocation only bites if C's side
re-checks at *read* time rather than only at receipt — which is a real design choice with a real
cost (reading a shared transcript now needs the directory online). Worth deciding deliberately
rather than discovering later.

**Onward re-sharing is half-stoppable, and the counted-consent design is what makes it half.** C
holds the bytes and the certificate, and that bundle proves the conversation is genuine wherever it
travels — nothing stops C pasting it into a chat window. But if the live check asks *was this
sharer permitted*, then C re-sharing **through the protocol** fails: C has no grant from B. So the
line is not "contained" versus "leaked", it is verified versus unverified. C can pass the bytes on;
C cannot pass on the ability to prove them. Worth stating in exactly those terms, because it is a
sharper guarantee than the first draft of this log credited, and still much weaker than the
containment a reader will assume.

## Open questions

- **What is the default expiry, and what are the two maximums?** Decided that it is mandatory, and
  that the cap on an all-inclusive grant should be tighter than on a restricted one since expiry is
  the only control left there. The numbers themselves are unset.
- **Is directory-enforced scope offered at all, or is advisory the only mode?** Enforcement is the
  only thing that stops a colluding sender and recipient, and it is the single largest source of
  graph leakage in the design. Offering both means explaining the trade to B; offering only advisory
  means the allowlist is a request rather than a rule.
- **Does the carrier session have to be open at the moment of sending**, or is an established
  contact enough?
- **Is this a new verb, or does it belong under the attestation umbrella?** There is already
  issue/consent/refuse machinery for attestations with a consent model that rhymes with this one.
- **Does B learn a share happened**, or only that permission was asked? Sharper now that the
  directory holds a consumption fact per share: B *could* be shown a running count of where their
  conversation went, which is either a strong trust feature or a surveillance one.
- **How does a large transcript travel** — the session message path, or a pickup queue like the one
  trust signals already use?

## Triage

**Not launch-blocking.** Launch needs two agents to connect, talk, and be relatively safe doing it.
This is a layer on top of conversations that already work. Nothing here strands anything: the
seal-time disposition is a new field, so conversations sealed before it ships simply take the
ask-B-later path, which is the path most shares would take anyway.

It is a strong *second* feature, though, and it points somewhere interesting — a verified
conversation you can hand to a third party is a primitive that ordinary agent messaging has no
answer for at all.

---

## Related Documents

- [[2026-04-08_1930_client-side-trust-data-ownership|Client-Side Trust Data Ownership]] — the general
  form of this feature. The client holds the data, the directory holds only the hash, and the
  recipient verifies by comparing the two. Sharing a sealed conversation is that pattern applied to
  a transcript instead of a trust score.
- [[2026-04-14_1300_connection-request-flow-and-trust-relay|Connection Request Flow — Trust Data Relay and Selective Disclosure]] —
  the existing instance of hash-verify-forward, and the thing Andre was pointing at when he said this
  is "very similar to sharing your trust signals."
- [[2026-05-31_1143_hash-custodian-positioning|Hash Custodian — Core Positioning Statement]] — why the
  directory can hold the seal root and the sharing grant but must never hold the conversation body.
- [[2026-04-13_1400_meta-merkle-tree-design|Meta-Merkle Tree Design]] — the conversation proof ledger
  underneath all of this: inclusion proofs, and the fabricated-conversation problem a shared
  transcript exists to answer. Also the machinery that would make partial sharing possible if the
  whole-transcript-only decision is ever revisited.
- [[2026-08-07_1912_replication-gap-what-m12-left-unfinished|Replication Gap — What M12 Left Unfinished]] —
  the new share-permission table has to be a deliberate replicate-or-node-local decision, which is
  exactly the decision that log shows has been getting made by omission.
- [[2026-04-17_1000_trust-signal-pickup-queue|Trust Signal Pickup Queue]] — the encrypted
  deliver-then-ack pattern a large transcript would most likely travel on.
- [[2026-08-05_1230_document-screening-convergence-and-content-profiles|Document Screening Convergence and Content Profiles]] —
  screening third-party content that arrives as data rather than as a message; the same problem the
  notice-first decision is answering.
- [[2026-07-07_1700_four-level-screening-policy|Four-Level Screening Policy]] — the screening tiers a
  shared transcript would be read through.

---

*References: seal certificate signature covers `[session_id, sealed_root, leaf_count, timestamp]`
plus the `legibility` object (`core/protocol-types/src/session.ts`); offline verification path is
`verifyBilateralSealCertificate`; the encrypted-pickup-plus-ack delivery pattern is in
`core/daemon/src/inbound-sessions.ts` (`handleTrustSignalPickup`); inclusion proofs already exist
via `cello_get_inclusion_proof`.*
