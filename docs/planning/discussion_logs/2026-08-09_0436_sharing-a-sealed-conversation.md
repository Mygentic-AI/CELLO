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
  for. Needs a new append-only share-permission table on the directory. Not launch-blocking.
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

## This is directory work, not just client work

Andre, mid-session:

> This will need directory work. Session records in the DB must now include share permissions.

Correct, and the directory side has more shape to it than the client side — the schema history here
has already drawn blood twice, and the scars tell us exactly how to build it.

**A new table. Never columns on the existing seal records.** The seal notarization table is
hash-chained, and it replicates. Adding a column to it means (a) every historical row's chain hash
was computed without that column, so chain verification breaks for all of them, and (b) if the
column replicates — and share permissions *must* replicate — the anti-entropy record hash of every
historical row changes, so all three nodes report divergence on data that never changed, and old
and new code disagree with each other for the entire duration of a node-by-node roll. This has been
hit twice before and both times was resolved by not really adding the column. A new table has no
historical rows: no chain to break, no record hash to change, nothing to disagree about mid-roll.

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

**Ordering is the one genuinely new problem.** Signal revocation is terminal — one-way, so a
replayed old fact is harmless. Share permission is not: B may grant, revoke, and grant again. Across
three nodes converging out of order, a replayed old grant must not be able to undo a newer revoke.
Either the signed payload carries a monotonic counter per session-and-granter, or revocation is
defined as terminal for that session and a fresh grant needs a fresh act. **Open — and it should be
decided before anything is written, not discovered during anti-entropy.**

**Not retroactive, and that is fine here.** Conversations sealed before this migration have no
recorded disposition and none can be reconstructed. That is normally the painful part of a schema
change like this — but the consent design already covers it. No disposition simply means you take
the ask-B-later path, which is the path most shares would take anyway. The migration's inherent
limitation and the product's fallback are the same thing.

Housekeeping: next free migration number is V63, and the expected-migration-version knob the
ops-agent checks on boot has to move with it or fresh deployments crash-loop. Confirm where that
knob lives now — it was an AWS parameter file before the GCP cutover.

## Two consequences worth stating plainly

**Revocation does not recall bytes.** Once C has the transcript, C has it. If B withdraws consent
tomorrow, the copy on C's disk is still cryptographically valid. Revocation only bites if C's side
re-checks at *read* time rather than only at receipt — which is a real design choice with a real
cost (reading a shared transcript now needs the directory online). Worth deciding deliberately
rather than discovering later.

**You cannot cryptographically stop C from re-sharing to D.** C holds the bytes and the
certificate; that bundle verifies wherever it goes. Any limit on onward sharing is policy and
social norm, not crypto. Better to be honest about that in the affordance than to imply a
containment we cannot deliver.

## Open questions

- **What does the sharing grant name?** If it names C, the directory learns you intended to show
  something to C — social-graph metadata we otherwise avoid. If it is scope-less ("this session is
  shareable"), the directory learns less but B loses per-recipient control. Leaning scope-less.
- **Does the carrier session have to be open at the moment of sending**, or is an established
  contact enough?
- **Is this a new verb, or does it belong under the attestation umbrella?** There is already
  issue/consent/refuse machinery for attestations with a consent model that rhymes with this one.
- **Does B learn a share happened**, or only that permission was asked?
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

*References: seal certificate signature covers `[session_id, sealed_root, leaf_count, timestamp]`
plus the `legibility` object (`core/protocol-types/src/session.ts`); offline verification path is
`verifyBilateralSealCertificate`; the encrypted-pickup-plus-ack delivery pattern is in
`core/daemon/src/inbound-sessions.ts` (`handleTrustSignalPickup`); inclusion proofs already exist
via `cello_get_inclusion_proof`.*
