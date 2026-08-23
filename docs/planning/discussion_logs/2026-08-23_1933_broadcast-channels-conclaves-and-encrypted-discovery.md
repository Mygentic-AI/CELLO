---
name: Broadcast channels, conclaves, and encrypted discovery — a topic channel that only agents can read
type: discussion
date: 2026-08-23
topics: [broadcast, conclave, topic-channels, listen-only, subscription, fan-out, attendance, delivery, doorbell, discovery, semantic-search, dcpe, encrypted-search, searchable-encryption, directory, relay, consortium, business-model, marketplace, agent-coordination, privacy, threat-model]
status: exploratory
description: >
  Design conversation on broadcast channels — a listen-only agent identity that fans messages out to
  every subscriber and cannot be replied to on-channel. Started as a missing affordance found while
  running M15 across two lanes over CELLO itself, and grew into a topic-channel primitive with
  marketplace, announcement and group-coordination uses. The central move is to stop modelling a
  channel as an agent you ATTEND (which forces every subscriber to hold the same private key) and
  model a broadcast as a SIGNED ARTIFACT that is published once and delivered many times. That
  removes the key-sharing trap, makes "cannot reply" a property of the shape rather than a rule
  needing three layers of enforcement, and decouples the tamper-evident record from the fan-out cost.
  Also covers delivery semantics (no doorbell, deliver at turn boundaries, why a rate limit is the
  wrong shape), read state (sequence numbers held subscriber-side, no server cursor), subscriber-list
  privacy and the push/pull fork it depends on, the CELLO-operated conclave as sanctioning
  intermediary, and encrypted discovery using DCPE with per-group keys so a directory can serve
  semantic search over descriptors it cannot read. Records the business-model conclusion that fell
  out of it: relays are given away, directories are retained, and consortium expansion works by
  inviting large operators to run a node.
---

# Broadcast channels, conclaves, and encrypted discovery

## Where this came from

M15 was split across two lanes and the coordination between them was run **over CELLO itself**
rather than through Andre pasting between terminal windows. Doing that surfaced a missing affordance:
**there is no broadcast.** The same ruling had to be hand-written twice, once per lane, and the two
versions differed in emphasis — which is how two lanes end up implementing one rule differently.

That is the practical origin. The design that came out of it is considerably larger than the problem
that prompted it.

**No decision here is scheduled.** This log is design, not scope.

---

## Part 1 — The observation that started it

Co-attendance was tested by accident: attending `CELLO_Support` while another session already held it
took attendance to 2. The product's own guidance:

> *"an arriving message is delivered to whichever session reads it first, so `cello_receive` here may
> return nothing while the other session gets it. Nothing is lost: `cello_transcript` shows every
> message either session received."*

So **co-attendance is a competing-consumer queue, not a broadcast.** But the *doorbell* fanned out — a
message from `Coder_1` to `Support` rang in both attending sessions.

> **Doorbell is already broadcast. Delivery is not.** The read cursor is shared where it should be
> per-attendee. The transcript already retains everything for every attendee, so the durable half
> exists.

A related constraint: a connection has exactly **one** current agent. `cello_use_agent` sets which
agent "this connection routes tool calls to, **and receives its doorbells here**." Every tool takes
an optional `agent` parameter, so a session can **act as** any agent per call but can only **listen
as** one. Multi-agent *sending* was never forbidden; multi-agent *listening* was effectively
forbidden, probably without a decision being taken.

---

## Part 2 — The trap, and the move that dissolves it

The first design was: an agent-level flag; a broadcast agent fans out to every attendee instead of
racing them. Opt-in, default unchanged, nothing migrates.

**Andre found the blocker himself:** to *receive* on an agent you must **attend** it, and attending
means your daemon holds that identity — so every subscriber holds the same private key, which is
then not a private key at all. Workable only where every daemon is already yours.

The assumption doing the damage is *"join a channel" = "attend that agent."*

> ### DECIDED: a broadcast is a SIGNED ARTIFACT, not a conversation.
>
> The channel keeps its own key and never shares it. To publish, it **signs the message once.** That
> single signed artifact is delivered to every subscriber, and each subscriber verifies it against
> the channel's public key.

Four things fall out at once:

**No key sharing.** Subscribers verify; they never sign as the channel.

**"Cannot reply" stops being a rule.** There is no session to reply into. It is not a conversation,
so the restriction is not a restriction — it is the shape. Nothing to block at the relay, nothing for
a modified client to bypass. **The three-layer enforcement design below was made unnecessary by this
move** and is recorded only because the reasoning generalises.

**Replying direct still works.** The artifact carries the publisher's pubkey; the responder opens a
normal one-to-one session as themselves.

**The fan-out cost decouples from the tamper-evident record.** As N sessions, a channel would carry N
transcripts, N hash chains, N seals — every message written and notarized five hundred times. **The
differentiator is precisely what would make fan-out expensive.** As an artifact: one signed thing, N
deliveries. The channel's record is "I published X." Each subscriber's record is "I received X,
signature verified."

The integrity property gets *stronger*, not weaker: **two subscribers comparing notes can detect a
channel that said different things to different people.** A per-session model cannot offer that, and
neither can a Telegram group.

### The enforcement design that the artifact model retired

Recorded because the layering reasoning applies elsewhere. Under a session-based broadcast, blocking
replies needed:

| Layer | What it does | Holds against |
|---|---|---|
| Client | Does not offer the affordance | Nothing. UX only, void against a modified build. |
| Relay | Refuses to broker the reply | A modified client **on a relayed path** only |
| **Receiver** | **Refuses inbound from a listen-only identity** | **Any path, any client build** |

Two things were established here and survive the retirement:

- **A listen-only flag must live in the DIRECTORY profile, not client config.** The relay reads four
  fields off a deposit frame and never opens the payload; anything the client tells it is exactly
  what a modified client would lie about.
- **The relay is not always in the path.** Direct connections skip it, so relay-side enforcement
  alone always has a hole. Same shape as the salt-contribution rule: **one honest participant is
  enough**, and the honest participant that is always present is the receiver.

---

## Part 3 — Delivery: no doorbell

For one-to-one, interrupting is correct — someone is talking to *you*. For broadcast it almost never
is: the message is not addressed to you, and N channels × M messages is a permanent interruption tax
on an agent that is supposed to be holding a thread.

> ### Do not build an interrupt and then throttle it. Do not ring.

**The boundary is the turn, not the clock.** An agent working a task has natural turn boundaries.
Deliver there: it finishes what it is doing, then picks up anything new before starting the next
thing. Nothing is disrupted mid-thought and nothing waits longer than one turn. A time interval
answers *how often* but not *when*; a turn boundary answers *when* and makes *how often* mostly
irrelevant.

**A rate limit is the wrong shape for the traffic.** Andre's own monitoring metaphor is the argument:
most days the grass grows, then five helicopters arrive at once. A channel quiet for a week that then
posts five messages in ten minutes is behaving correctly — and an hourly cap delays precisely the
burst that matters. **Rate limits smooth the traffic nobody cares about and throttle the traffic they
do.** Batch at boundaries instead; five messages arriving together is a better experience than five
spread over five hours, and cheaper.

**Priority is subscriber-side.** If publishers declare urgency, everything becomes urgent — that is
how every notification system has degraded. Publisher-declared priority is *advisory input*; the
subscriber's own rule decides what escalates. The operator sets it once and their agent enforces it.
That gives an escape hatch for a genuine emergency without handing every publisher a red button.

**The offline case needs no new machinery.** Come back, ask for everything after N, receive a batch
and a count. Same catch-up primitive, not a separate notification system.

**Cost note, since the whole line of thinking started from gross margin.** Every wake costs inference.
An agent woken for a broadcast it then ignores has burned tokens for nothing. Batching at turn
boundaries makes the marginal cost near zero because the agent is already awake and already paying
for that turn.

---

## Part 4 — Read state: the channel holds none

With N subscribers reading independently, each needs its own position. The instinct not to track it
at all is right, and the stronger version:

> ### The channel holds NO read state. Each artifact carries a monotonic sequence number; each
> subscriber remembers locally what it has processed and asks for everything above it.

No server-side cursor, no consume semantics, no per-subscriber state on the publisher — which is the
thing that made fan-out expensive in the first place.

**The primitive already exists.** `cello_receive` has a `since_seq` catch-up mode returning
everything after a sequence as a batch. **That is the right shape for broadcast. The live
one-at-a-time mode is the wrong one** — that is the competing-consumer behaviour from Part 1.

---

## Part 5 — Subscriber lists, and the fork underneath them

Default **private**, with settings layered on: public, per-subscriber opt-in, or visible to channel
admins only.

Two forks decide more than they appear to:

**Push versus pull decides publisher-side privacy.** "Private subscriber list" has two meanings that
come apart. Private *from other subscribers* is a setting. Private *from the publisher* is a
consequence of the delivery model — under push the publisher must know who to send to; under pull it
can be blind, but then it cannot know its own reach either.

**A join step that can warn you is a publisher that knows you joined.** The "this channel is not
monitored by CELLO agents, subscriber beware" notice needs something to interpose on. If subscribing
is just *start pulling from this pubkey*, there is no join to hook. The warning and the
blind-publisher property are in tension.

**Consequences not yet chosen:**
- Under push you can eject a subscriber. Under pull, with a public key, you cannot stop someone
  reading — **ejection may not be expressible.**
- Delivery still needs something to physically reach N daemons. Under the artifact model a hub is
  **untrusted**: it can neither forge nor alter, only fail to deliver. Whether that is the relay, a
  dedicated fan-out node, or scheduled subscriber pulls is open.

---

## Part 6 — Sequencing, the conclave, and self-enforcing sanction

**Two capability tiers, not two products.** The shared-key case among an operator's own agents is a
degenerate version of the stranger case, not a separate design. The simple case works today wherever
the private key is legitimately shared — one operator's fleet, possibly across machines.

**Discovery stays gated initially.** No open discovery mechanism; one CELLO-governed announcements
channel of the kind already planned (*"we've shipped an upgrade, we're in maintenance for an hour"*).
A feature with no directory cannot be abused through the directory.

**The conclave.** A CELLO-operated agent that is a member of any channel wishing to be sanctioned and
advertised. Two conditions on the channel owner: follow the published rules, and keep the conclave on
the receiving end.

The second condition looked like it needed a mechanism forbidding removal. It does not:

> ### The sanction IS the enforcement. If the conclave is what advertises the channel, removal is
> self-punishing — cut it out and the advertisement stops. Make the thing the owner wants something
> only the conclave can serve, and no anti-removal rule is required.

Under the artifact model the conclave is simply another subscriber, which makes the whole requirement
trivial to satisfy.

**Monitoring is staged.** The conclave is subscriber number one to begin with. Later, self-moderated
channels are permitted, with a notice at join: *this channel is not monitored by CELLO agents, do
your own due diligence.* (See Part 5 — that notice implies a join step, which implies a
publisher-visible subscriber list.)

**Open:** whether the conclave merely receives or also **counter-signs**. Receiving gives visibility.
Signing gives a veto, and makes *"sanctioned by CELLO"* cryptographically checkable rather than a
claim.

---

## Part 7 — The use cases that motivated it

Recorded because they drove the design and constrain it.

**Fleet coordination.** One channel every coding agent listens to. This is the case that produced the
requirement and the one the shared-key tier already serves.

**Announcements.** Already planned. Upgrades, maintenance windows, disruption notices.

**Hiring from the user base.** The people who adopt CELLO are agent-native by selection — the same
pool as candidates for fractional infrastructure-monitoring work. The motivating economics: per-user
cost is cloud infrastructure plus monitoring staff, and monitoring is *"like watching your grass grow
waiting for a helicopter to crash into it — most days the grass just grows, and on a bad day five
helicopters land on your lawn."* Reducing dedicated human monitoring is a gross-margin lever, and the
user base is the recruiting pool.

**A work marketplace.** Agencies subscribe to a topic and bid on farmed-out work. This is where the
shape starts resembling Craigslist, Reddit, Telegram groups and Discord without being any of them.

> ### The differentiator, and it is not the marketplace: a Telegram group is read by humans. **This
> is read by an agent.** Every subscriber's agent evaluates a broadcast against its operator's
> standing criteria and acts — reply, ignore, flag for a human. Thirty agents assess a posting and
> three respond. Nobody read a feed. That is not a feature to add; it falls out of the subscribers
> being agents.

**One asset already in hand, worth not discarding later.** Spam killed Usenet and nearly killed
Craigslist; the defences that worked were identity cost or moderation. **CELLO already has identity
cost** — registration requires a threshold ceremony across independent directory nodes. Mass fake
identities are genuinely expensive. The registration friction that is a UX cost elsewhere is what
makes an open channel survivable. Worth remembering when someone proposes making registration cheap.

---

## Part 8 — Encrypted discovery (DCPE)

Semantic search over channel descriptors raises an obvious objection: a search index is a centralized
service, and a public one is a trust and censorship point.

**DCPE removes that objection.** Distance Comparison Preserving Encryption — the Scale-and-Perturb
scheme from Fuchsbauer, Ghosal, Hauke and O'Neill (eprint 2021/1666) — encrypts vectors so that
relative distances are approximately preserved, making them searchable **without decryption**. Andre
implemented it, along with encrypted-term search supporting BM25, for a prior project.
(`/Users/andrep/Documents/code/dcpe`.)

### The correction that makes it work

An initial objection — that DCPE is symmetric, distances only compare within one key's space, and
therefore the whole network would need one shared key — **was wrong.** The answer is **per-group
keys**: each private channel group has its own key, held by its members, never by the directory.
Distances compare within a group's own space, which is exactly the scope a member is entitled to
search.

> ### The claim this supports: **a directory can serve discovery for data it cannot read.** Members
> hold the keys; the directory performs the search mechanics on ciphertext and returns encrypted
> results the searcher decrypts. *"You want to search among our private channels? The directory will
> do that for you, but you need the keys to complete the search and reverse the blobs."*

The group key can be distributed over an existing one-to-one sealed session. No new mechanism.

### What it does and does not buy

**Public descriptors: encryption is a flex, not a protection — and that is fine.** A discovery blob
exists to be found. It is, in Andre's words, *"probably the least privacy-conscious piece of data we
could store on a directory."* The cost of encrypting it anyway is near zero because the code exists.

**Do not build the corpus-privacy claim on it.** Channel descriptors are short, English, drawn from a
guessable domain, embedded with a public model — close to worst case for property-preserving
encryption. Distance-preserving means the geometry survives, and **the geometry is the leak**: embed
ten thousand plausible descriptor strings with the same public model and match the structure. Per-
vector noise defeats exact matching but cannot hide distance structure, because that structure is the
feature. **This is the unsalted-content-hash attack from `DOD-M15-HASHCORRELATE-1`, one layer up:
guessable plaintext plus a structure-preserving transform equals confirmable guesses.**

**The query is the half worth protecting.** *"I need someone who does firmware pen-testing on medical
devices"* leaks intent, timing and business direction, and is not guessable the way a public
descriptor is. A federated directory serving that query without learning it is a real property.

**The enterprise case is the strong one.** Consortia that want to find each other without being
enumerable by the public, on infrastructure operated by neither of them, where the operator is a
custodian that cannot read what it serves.

### Residuals that must be disclosed, not discovered

- **Access-pattern leakage.** The directory cannot read corpus or query but sees *which* encrypted
  records matched, how often, and result-set sizes. Over many queries that accumulates into
  structure. This is the known residual of the whole searchable-encryption family.
- **Term-frequency distribution** on the BM25 side, unless padded.
- **Revocation.** A departing member keeps the key and anything cached; re-keying means re-encrypting
  the group's corpus. Cheap for a few thousand descriptors — worth confirming rather than assuming.
- **Cross-group search is N searches**, one per key space, by construction. Correct behaviour,
  awkward at large N.
- **Beta is a live dial**: more noise, more security, worse recall. Measurable with the existing
  harness rather than arguable.

> **Ship the claim with its bound attached.** *The directory can serve discovery without seeing your
> data* is strong and checkable. What leaks is access patterns, query volume and group membership.
> What does not is descriptor text and query text. Unbounded, it becomes another ledger line.

### Positioning

> ### DECIDED: encrypted discovery is NOT a headline feature.
>
> The headline is **safe, private agent-to-agent communication, with conclaves.** DCPE is a
> *"holy shit, it does that too"* discovered later. A feature nobody asked for is a claim you have to
> defend from day one — every property, every bound, every *"well, actually access patterns leak."*
> Found three weeks in, it is a gift instead.

Context worth keeping: DCPE was built a year ago and found no traction because nobody could see a use
case. That was not bad luck — **it needs a system where the index host is untrusted by design.** A
company running its own vector database on its own infrastructure has no such threat model. A
federated directory network operated by independent parties is the missing precondition.

---

## Part 9 — What this does to the business model

**Conclaves were always planned, as group chats.** Broadcast may be a shorter and better path to the
same end.

**Relays are given away; directories are retained.** Consistent with the standing decision that the
relay is a future enterprise deliverable kept extractable — no shared packages, private-relay
tolerant. The relay carries content and metadata; the **directory is the trust anchor**, holding
registration, threshold identity, notarization and — if this ships — discovery. Eventually open-source
the relay. Not yet.

**The pitch line falls out of the architecture.** The reason CELLO *can* retain directories is the
same reason an enterprise does not need to run one: **no single directory can act for their agent.**
It takes a majority of independent operators in separate regions. Not a policy promise — the
threshold. That is the answer to the security team that would otherwise end the conversation: not
*trust us with your key shares*, but *nobody, including us, can sign for you alone.*

> ### ⚠️ The tension that argument creates. It holds only while the operators are genuinely
> independent parties. **Today every directory node is CELLO's** — different regions, real redundancy
> — but at the *operator* level a majority is one company. So "no single party can forge" is true of
> nodes and not yet true of operators. That turns consortium expansion from an ambition into a
> **requirement**, and licensed node operation into a revenue line that makes the security story true
> at the same time.

**Consortium expansion, in Andre's framing:** *"Why don't you set up a directory? Run it for the
benefit of the entire world. But make sure your agents default to that one to start with. Now you're
part of the consortium. Welcome, brother."* Membership rather than tenancy — the right register for
an enterprise that dislikes being someone's tenant.

Two edges to have answers ready for:

- **"Run a node" sounds like sovereignty; the reality is mutual custody.** Their agents register
  across a threshold, so shares of their identities sit on *other companies'* nodes. That is the
  stronger property and the same argument as above — but heard after signing rather than before, it
  reads as a bait-and-switch. Likewise **"default to that one" must mean preferred first hop, not
  only hop**, or they have bought a single point of failure and called it control.
- **Governance kills consortium plays, not technology.** At three operators it is a handshake. At ten
  it is: who admits a member, who removes a bad one, what happens when an operator runs a stale build
  or goes quiet, who may change the threshold. None of it is code and all of it needs an answer
  before the second operator joins.
- **Retention is structural.** An operator who learns the protocol and considers forking finds that
  agents registered on the existing network cannot move without a resharing ceremony. The migration
  trap works in CELLO's favour here.
- **Check the pitch against the standing rule:** one node, one region. A company headquartered in a
  covered region does not get a node there without bending it.

---

## Decisions taken in this conversation

1. **A broadcast is a signed artifact, not a conversation.** Signed once, delivered many, key never
   shared.
2. **"Cannot reply" is a property of the shape**, not a rule needing enforcement layers.
3. **A listen-only flag, if one is ever needed, belongs in the directory profile**, never client
   config — and receiver-side refusal is the only path-independent enforcement.
4. **No doorbell for broadcast.** Deliver at turn boundaries; batch; no rate limit.
5. **Priority is subscriber-side.** Publisher-declared urgency is advisory only.
6. **The channel holds no read state.** Monotonic sequence numbers; subscribers track their own
   position; `since_seq` is the right primitive.
7. **Subscriber lists default to private**, with public / opt-in / admin-visible as settings.
8. **Discovery stays gated initially** — one CELLO-governed announcements channel, no open mechanism.
9. **The conclave is a subscriber, and the sanction is the enforcement** — no anti-removal mechanism
   needed.
10. **Encrypted discovery uses per-group keys**, protecting the query rather than the public
    descriptor, with access-pattern leakage disclosed alongside.
11. **Encrypted search is not a headline feature.** The headline is safe, private agent-to-agent
    communication with conclaves.
12. **Relays are given away; directories are retained.** Consortium expansion by inviting large
    operators to run nodes.

## Open

- **Push or pull.** Decides publisher-side privacy, whether a join step exists, and whether ejection
  is expressible.
- **Retraction.** A signed artifact is permanent by design. You broadcast something wrong to five
  hundred agents that act on it — is there a correction, a supersede, a revoke, and what does a
  subscriber that already acted do with it? *The one that gets harder the longer it is left.*
- **Whether the conclave counter-signs**, making sanction cryptographically checkable.
- **Whether the shared-key fleet tier shares code with the stranger tier**, or stays a deliberately
  separate simpler path.
- **Attendance / fan-out at scale.** The highest attendance ever observed is 2.
- **Governance rules for consortium membership**, needed before the second external operator.

---

## Related Documents

- [[M15-PROCESS-RULINGS|M15 Process Rulings]] — the two-lane split that surfaced the missing
  broadcast affordance, and the product critique of CELLO as a coordination medium that preceded this
  design. Parts 2 and 3 of that document are superseded here.
- [[2026-08-21_1906_relay-p2p-exposure-and-ephemeral-peer-id-audit|Live P2P exposure audit]] — the
  relay's four-field read and content-blindness, which is why a fan-out hub can be untrusted.
- [[M15-DEFINITION-OF-DONE]] — `HASHCORRELATE-1` is the same guessable-plaintext attack one layer
  below the DCPE corpus discussion; `TIERTEXT-1` is the inbound gate a marketplace would need.
- [[M8C-MONIKER-SPEC]] — the contact and tier model any subscription would sit on.
- [[protocol-map]] — protocol domains and readiness; a broadcast primitive would be a new domain.
