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
  wrong shape for bursty traffic, titles as a first-class field and publisher guidance as a
  reputation-bearing promise); read state as two positions, since a read that mutates state cannot be
  retried; and the durable record — one publisher-side log sealed in chained epochs, which is
  certificate transparency, chosen for consistency proofs so a channel can prove it never rewrote its
  history. The unsealed window is the equivocation window, which makes the cap on epoch length a
  security parameter. Access model (open vs invite-only) is the axis that governs subscriber-list
  visibility rather than a setting; the anonymous pull-only mode is DROPPED, leaving push to known
  subscribers as the single delivery model. The daemon collects on a schedule, not the agent. Relays
  stay stateless because the publisher's log is the durable copy, so relay loss is redelivery rather
  than persistence; gaps are found by sequence number and, at the tail, by the directory-registered
  epoch root; repair is subscriber-initiated and routed publisher → relay → subscribers. Also the
  CELLO-operated conclave as sanctioning intermediary, and encrypted discovery using DCPE with
  per-group keys so a directory can serve semantic search over descriptors it cannot read. Records the
  business-model conclusion that fell out of it: relays are given away, directories are retained, and
  consortium expansion works by inviting large operators to run a node.
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

### The publisher still needs a way to signal, and the channel needs to promise how it will use it

*Subscriber-side control* does not mean the publisher has no voice. It means the publisher's voice is
**input to a rule the subscriber owns.** Three pieces:

**Messages carry TITLES as a first-class field.** Not a convention inside the body — a field. That is
what makes a subscriber-side rule expressible without reading bodies (*"anything from this channel
whose title contains URGENT wakes me"*), and it is what makes a digest possible at all: *six topics
have new messages, here are the counts and titles* is answerable without opening anything.

**The channel publishes its notification GUIDANCE at subscribe time.** Set by the channel creator and
delivered to every new subscriber as part of joining: *"I promise not to overuse this. URGENT in the
title means genuinely urgent — set immediate notification for it."*

> That guidance is a **promise, and it is reputation-bearing.** A channel that cries urgent gets
> downgraded by its subscribers individually, which is the correct feedback loop and needs no central
> moderation. The publisher gets a way to be heard; the subscriber keeps the authority; abuse costs
> the publisher its own reach.

**Notifications range from trivial to fully custom.** Simple standing ones that are not about
broadcast at all — *notify me when the daemon restarts, notify me on `use_agent`* — through digests
(*six topics with new messages, call this for counts*) up to per-channel custom rules where something
genuinely needs prioritising.

### Escalation is three layers, each with its own authority

The worked example is an infrastructure monitor, and it matters because it shows what the broadcast
primitive is *not* responsible for.

1. **A monitoring agent** wakes every twenty minutes, runs a cheap model against three directories
   and five relays, checks health and logs. On finding something, it **publishes to a channel** with
   a title carrying its severity. It does not contact a human. It does not hold anyone's phone
   number. **It has no escalation policy at all.**
2. **A personal agent subscribes** — `Miss_Chelly`, online continuously. It applies **its own**
   policy: what time zone is the operator in, when did they say goodnight, how urgent is this
   really. That agent holds the human's preferences, and it is the only thing that does.
3. **The human is reached through tools that already exist** — a phone tool, a Telegram message, a
   watch configured to let a specific sender through regardless of do-not-disturb. Moderately
   important at 23:30 gets one ping. Genuinely critical at 02:00 gets contacted relentlessly until
   answered.

> **The monitoring bot is never given the human's contact details.** It is told *go talk to my
> personal agent.* Publisher signals, subscriber routes, personal agent escalates — three separate
> authorities, and only the last one knows how to wake somebody up.

This also shows the reply-direct path being used for **escalation rather than reply**: the personal
agent receives a broadcast and then acts one-to-one, or reaches outside CELLO entirely. The channel
carries the signal and takes no responsibility for what any subscriber does with it.

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

## Part 4b — The durable record: what a channel's history actually is

**A session ends and seals. A channel never does.** So what is a channel's record, given the existing
unit of durability is a two-party session that opens, seals and closes?

### The options considered

**A · One session per update, self-closing** — as document sharing works today. *For:* reuses
everything; each update independently notarized; natural retention unit. *Against:* session explosion
(hourly monitoring is 8,760 sessions per subscriber per year, each paying full ceremony cost for a
200-byte "all good"). **And the one that kills it: independent sessions lose ordering.** Nothing links
update 46 to 47, so a channel dropping or reordering an update is undetectable — twelve thousand
perfect receipts and no way to prove the set is complete.

**B · One long-lived session, never closed** — *For:* one tree, ordering provable. *Against:* **never
seals, so never notarized** — the receipt story does not apply at all, and an indefinitely-open
session is the unsealed revivable state M15 spent a week fixing. **Ruled out.**

**C · One session, sealed and reopened periodically** — extending a sealed tree. *Against:* weakens
what a seal means everywhere else, for one feature's benefit.

**C′ · Epoch chaining — removes the objection to C.** Nothing is reopened. Each epoch is sealed
normally; **its first leaf commits to the previous epoch's sealed root.** Ordering provable across the
whole channel history, bounded session size, existing notarization path, natural retention unit,
**and no new session semantics.** Log rotation with a hash link.

**D · A separate object type, not a session** — *Against:* rebuilds storage, verification and
notarization from scratch, duplicating what sessions already do.

**E · No durable record — ephemeral broadcast** — *For:* trivial, free. *Against:* gives up the
differentiator. Kept on the list as the honest baseline, because **an announcements channel may
genuinely not need integrity** while a monitoring trail does.

**F · One publisher-side log, subscribers hold receipts only** — the publisher keeps **one**
append-only chain, not one per subscriber. *For:* the publisher writes and notarizes **once**, not
once per recipient. Any subscriber verifies inclusion and detects gaps.

> ### DECIDED: F combined with C′ — one publisher-side log, sealed in chained epochs, subscribers
> holding inclusion receipts. **This is certificate transparency**, which matters because it is a
> well-understood shape for an append-only log many parties verify, and it brings one property none
> of A–E delivers.

### The property that decided it

**Consistency proofs.** Anyone can prove the log at T2 is a genuine *extension* of the log at T1 —
nothing inserted, removed or rewritten in between.

> That is the difference between *"I can prove I received this message"* and **"the channel can prove
> it never rewrote its history."** For a publisher making claims to subscribers who cannot see each
> other, that is what makes the channel trustworthy rather than merely authenticated. It also answers
> retention cleanly: prune the artifacts, keep the roots.

**Two clarifications on the mechanism**, because both were initially misread:

- **Within an epoch it is a TREE, not a linked list.** That is what makes "prove message 47 is in
  there" cheap — a handful of hashes rather than replaying everything. The chain link is at the
  *epoch boundary* only.
- **"It is a normal session" is approximate.** A CELLO session has two participants who both approve
  the seal; a channel log has no counterparty. It is a **one-party record**, closest to the unilateral
  seal path where one side seals and the artifact states what is weaker about it. Worth deciding
  deliberately rather than inheriting.

### The flow, four actors

**Publishing one update**
1. **Publisher** composes title and body.
2. **Publisher** appends it as a leaf to its single channel log; recomputes the root locally.
3. **Publisher** signs the artifact with the channel key — sequence number, title, body, signature,
   and if first in an epoch, the previous epoch's sealed root.
4. **Publisher** hands the signed artifact to the relay.
5. **Relay** stores and forwards. **Does not open it.** Sees who, when, how big. Cannot forge or
   alter, only fail to deliver.
6. **Directory** — *not involved.* No per-message work at all.

**Receiving**
7. **Subscriber** collects it, verifies the signature against the channel's public key held from the
   directory profile, checks the sequence against its own last-seen, stores it. `delivered_through`
   advances; the agent reads at the next turn boundary and `processed_through` advances.
   **The subscriber signs nothing** — it is a verifier of someone else's record, not a participant.

**Sealing an epoch**
8. **Publisher** sends the epoch root to the directory — on its own trigger, since it knows when a
   batch is meaningful.
9. **Directory** notarizes it with a threshold signature. **The only directory work in the flow, once
   per epoch regardless of subscriber count.**
10. **Publisher** publishes the notarized root as the first leaf of the next epoch.

**What anyone can prove afterwards**
11. **Inclusion** — message 47 was genuinely published, against the notarized root.
12. **Agreement** — two subscribers compare notarized roots. Same root, same history. Different roots,
    the channel forked and told them different stories.
13. **Consistency** — epoch 5 extends epoch 4; nothing rewritten.

### What a subscriber can prove BEFORE the seal — and why the cap is a security parameter

- **Authenticity — yes, immediately.** The artifact is signed by the channel key. No seal needed.
- **Non-equivocation — NO.** Nothing stops the publisher issuing a *different* message #47 to a
  different subscriber. Both are validly signed. Until a root covering #47 is notarized there is no
  single history to check against.
- **Completeness — no.** You see gaps in what *you* received; you cannot prove the publisher did not
  issue something you never got.

> ### The unsealed window IS the equivocation window. How long a publisher may leave an epoch open is
> therefore a **security parameter, not housekeeping** — which is the reason a cap must exist rather
> than a matter of tidiness.

Two mitigations worth allowing: **a subscriber can request a seal** when it needs provable evidence
now, and two subscribers can detect equivocation *between themselves* in real time by comparing
artifacts — cooperative detection rather than proof to a third party, but it means a publisher
equivocating across a large audience is likely to be caught quickly.

---

## Part 5 — Access control, subscriber lists, and delivery

An earlier draft treated subscriber-list privacy as the primary setting and push-versus-pull as the
fork underneath it. **That missed the axis that actually governs both: is the channel OPEN or
INVITE-ONLY?** Once that is named, most of the privacy question stops being a setting and becomes a
consequence.

### The axis that was missing

- **Open** — anyone may subscribe.
- **Invite-only / request-and-approve** — the admin admits members.

> ### Invite-only ENTAILS an admin-visible subscriber list. There is no meaningful "private" setting
> to choose, because **you cannot approve a request from someone whose key you cannot see.**

The theoretical case — someone asks to join without revealing their address — is a curiosity with no
use case identified, and is **deliberately set aside.** Naming it as excluded rather than leaving it
implicit, so nobody rediscovers it as an oversight.

### What that produces

| Access | Delivery | Who knows the subscribers | Ejection |
|---|---|---|---|
| Open | Pull | **Nobody** — the publisher cannot know its own reach either | Not expressible without authenticated pull |
| Open | Push | The publisher, necessarily — it must know where to send | Possible |
| Invite-only | Either | **The admin, by necessity** | Possible, and this is where it is needed |

So the remaining genuine setting is narrow: on an **open** channel, whether other subscribers can see
each other. Everything else is entailed by the access model and the delivery model.

### DECIDED: the anonymous pull-only mode is dropped

> **PUSH TO KNOWN SUBSCRIBERS IS THE SINGLE DELIVERY MODEL.** The top row of that table is removed —
> narrow upside, high technical cost, mediocre experience.

**The property is narrower than its name.** Anonymous *from the publisher*, yes. Anonymous full stop,
no — the reader still connects to a relay, and the relay sees a peer fetching a specific channel.
Described accurately it is much less compelling; described inaccurately it is a ledger line, which is
the exact failure this milestone exists to close.

**What it cost:** an entire delivery path (polling, TTL coupling, backoff, relay retention, backfill);
ejection, which is required; the publisher's knowledge of its own reach, which is the number a
marketplace publisher most wants; **the join step**, which two already-taken decisions depend on — the
notification guidance of Part 3 and the unmonitored-channel notice of Part 6 both need somewhere to
land; and any identity to rate-limit, leaving anonymous readers as an abuse surface with no handle.

**None of the use cases in Part 7 need it.** Fleet coordination, announcements, hiring and the work
marketplace all want the publisher to know its subscribers.

**The real concern is covered anyway.** What people usually mind is not *the publisher* knowing but
*the other subscribers* knowing, and that remains a setting on open channels at no cost.

**What would reopen it:** a use case where subscribing is itself the sensitive act — following a
channel run by someone you are investigating, or a competitor's. The honest version of that needs the
**relay** blind too, not just the publisher, which is a larger piece of work than the pull path and
must be priced as such rather than smuggled in under a name implying it is already done.

### Ejection

> ### DECIDED: ejection must be possible. It is only *needed* for invite-only channels — which is
> also the only place it is cleanly *expressible*, since that is where the admin knows who to remove.

One mechanism note: under **pull**, removing someone from a list does not stop them fetching, because
they still hold the channel's public key. **Ejection under pull requires an authenticated pull** —
the subscriber proving identity to fetch. Without that, ejection is advisory rather than enforced.
For an encrypted channel, ejection also implies **re-keying** (Part 8), since a departing member
keeps the group key and anything already cached.

### The join step, and what it carries

**A join step that can warn you is a publisher that knows you joined.** The *"this channel is not
monitored by CELLO agents, do your own due diligence"* notice needs something to interpose on. If
subscribing is just *start pulling from this pubkey*, there is nothing to hook.

Under the corrected framing this tension mostly evaporates: **invite-only channels have a join step
by construction**, and that step is also where the channel's notification guidance (Part 3) is
delivered. Only the open-and-pull corner has no join, and that is the corner that already gives up
knowing its own audience.

### Delivery still has to happen

Something must physically reach N daemons. Under the artifact model that hub is **untrusted**: it can
neither forge nor alter, only fail to deliver. The relay is that hub — it already parks content for
offline recipients and hands it back on a recipient-signed pull.

### What the DAEMON does, not the agent

> ### DECIDED: the daemon collects on a schedule. Not the agent when it comes online.

Three arguments, and the first is decisive:

- **A TTL only works if something reliably collects inside the window.** If only the agent fetches, an
  agent asleep longer than the relay's retention loses that content — and the whole retention design
  assumed someone was there. The daemon is the only continuously-live party.
- **It is what makes Part 3 coherent.** No doorbell, deliver at turn boundaries — that only works if
  the content is *already local* when the boundary arrives. Agent-triggered fetching would block on
  the network at exactly the moment we agreed not to interrupt.
- **Daemon polling costs bandwidth; agent polling costs inference.** Given the gross-margin motivation
  behind this whole line of thinking, that decides it on its own. It also **deduplicates** — three
  agents on one daemon subscribed to one channel means one fetch and three local readers.

It also puts the fetch in the same place as the two position markers (Part 4), which live in the
daemon's database anyway.

**The coupling this creates must be written down, because its failure is silent.** The poll interval
and the relay TTL are now a joint constraint: a publisher setting a one-hour retention while daemons
poll daily loses content for everyone and nobody finds out. **The TTL is a published channel
property**, and the daemon polls faster than the shortest TTL it subscribes to, or adapts per channel.

**Backoff on quiet channels** is cheap — sequence numbers show nothing new for K polls, widen the
interval, bounded by the TTL so it never widens past the retention window.

### Redelivery: what happens when the relay loses it

A relay restart drops parked content. The question that looks hard — *who successfully received it and
who still needs it?* — has a better answer than tracking it: **don't.**

**The publisher already holds the durable copy.** Its channel log is the archive. So relay loss is
never data loss, only delivery loss. This is a **redelivery problem, not a persistence problem**, and
that reframing is what keeps relays stateless.

**Gap detection is already free, except at the tail.** Sequence numbers give it: holding 45, 46, 48
tells you 47 is missing. No relay state, no directory. What sequence numbers *cannot* detect is a
**missing tail** — if 47 was the last message, silence is indistinguishable from nothing-was-sent.

> ### That is what the directory-registered epoch root is for. The directory publishes the channel's
> high-water mark. Directory says sealed through 52, you hold 45, you know exactly what you are
> missing. **Interior gaps from sequence numbers, tail gaps from the directory.**

> ### DECIDED: repair is SUBSCRIBER-INITIATED.
>
> Publisher-side redelivery means the publisher tracks who got what — **per-subscriber delivery
> state, the exact thing the artifact model exists to eliminate.** It would reintroduce N-state
> through the back door. The subscriber is also the only party that knows what it actually holds.

**Therefore relays stay stateless.** Relay persistence becomes an optimisation, not a correctness
requirement: relay restarts, content is gone, subscribers detect gaps and repair. Slower, still
correct. **The rejected alternative** — the publisher periodically polling the relay to confirm it
still holds the content — is delivery-state tracking by proxy and is not needed.

The TTL stops being load-bearing for correctness. Short is fine; it is a convenience window rather
than the only thing standing between a subscriber and its content.

> ### DECIDED: a SEALED epoch is retained on the relay longer than live content.
> Cheap hedge against the one real dependency below.

### Two risks in the repair path

**Publisher availability.** Repair depends on the publisher being reachable. If it is offline, gaps
persist until it returns. The longer retention of sealed epochs is the hedge.

**Thundering herd, and its target is the publisher — the weakest node in the picture.** A relay
restarts and every subscriber detects a gap. Those requests go to a publisher that may be one daemon
on a laptop, not to a relay built for load.

Considered and rejected: **a specialised repair API outside libp2p.** New ports, new connection
management, a new authentication surface outside the posture the relay's threat model assumes — and
it would rebuild something that exists. **The relay's existing recipient-signed pull is the repair
path**, with a range instead of a single item.

Two mechanisms, and the second is the one that actually caps the load:

- **Jitter, derived deterministically from the subscriber's own pubkey** rather than randomly. Hash
  your pubkey into the poll window for your offset: N subscribers spread uniformly with zero
  coordination, and *stable*, so it is reproducible when debugging rather than a heisenbug. Because
  polls are staggered, **gap detection is staggered too** — the same mechanism solves both. Backoff
  stays client-side for retries; jitter is what prevents the first stampede, which backoff cannot.
- **Repair goes publisher → relay → subscribers, never publisher → each subscriber.** A subscriber
  reports *"missing 46 through 52"*; the publisher re-parks that range on the relay **once**; every
  subscriber missing the same range — and after a relay restart they will nearly all be missing the
  same range — fetches it there. Publisher load becomes **one re-park per distinct missing range**,
  not one response per subscriber. It reuses the existing parking mechanism and adds no relay state
  beyond a TTL.

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
requirement and the one the shared-key tier already serves. The traffic is operational heads-up:

- *"I am about to rotate the relays — if you start getting weird results, that is why."*
- *"We are doing a `cello publish` shortly. Contact me if you want us to wait so you can squeeze
  yours in."*

Both are worth reading closely, because they are what the design has to survive. The first is pure
one-way notice: no reply is wanted, and an agent that answered it would be noise. The second **invites
a reply and still is not a conversation** — the responder opens a normal one-to-one session with the
publisher as themselves. That is the artifact model working as intended rather than a gap in it: the
channel carries the announcement, the DM carries the negotiation, and the channel never grows a reply
path that five hundred subscribers can write into.

It also shows why the doorbell decision (Part 3) is not a detail. A relay rotation notice is worth
nothing if it arrives after the rotation; it is worth *less than nothing* if it interrupts thirty
agents mid-task. Turn-boundary delivery is what makes an operational channel usable rather than a
thirty-way interruption.

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
5. **Priority is subscriber-side.** Publisher-declared urgency is advisory only — but the publisher
   gets a real channel for it: **titles as a first-class field**, plus **notification guidance
   published at subscribe time**, which is a reputation-bearing promise rather than a control.
6. **Escalation is three separate authorities** — publisher signals, subscriber routes, personal
   agent escalates. A monitoring agent never holds a human's contact details.
7. **The channel holds no read state.** Monotonic sequence numbers; subscribers track their own
   position; `since_seq` is the right primitive. **Two positions, not one** — `delivered_through`
   advanced by the fetch, `processed_through` advanced only by the agent — because a read that
   mutates state cannot be retried, and agents lose context constantly.
7b. **The durable record is one publisher-side log, sealed in chained epochs** (F + C′ —
   certificate transparency). Within an epoch a tree; the chain link is at the epoch boundary. It is
   a **one-party record**, closest to the unilateral seal path. **Consistency proofs** are the
   property that decided it: the channel can prove it never rewrote its history.
7c. **The unsealed window is the equivocation window**, so the cap on epoch length is a security
   parameter. Before the seal a subscriber has authenticity but **not non-equivocation**.
8. **Access model is the governing axis**: open, or invite-only / request-and-approve.
   **Invite-only entails an admin-visible subscriber list** — you cannot approve a request from a key
   you cannot see. The only genuine remaining setting is whether subscribers on an *open* channel can
   see each other.
9. **Ejection must be possible**, is needed only for invite-only, and under pull requires an
   authenticated pull or it is advisory rather than enforced.
10. **The anonymous pull-only mode is dropped.** Push to known subscribers is the single delivery
    model — the property is narrower than its name (the relay still sees the reader), it costs the
    join step that two other decisions depend on, and no current use case needs it.
11. **The daemon collects on a schedule, not the agent.** A TTL only works if something reliably
    collects inside it; it is what makes turn-boundary delivery possible; and it costs bandwidth
    rather than inference. **The TTL is a published channel property** and the poll interval must be
    shorter than it — a coupling whose failure is silent.
12. **Redelivery, not persistence.** The publisher's log is the durable copy, so relay loss is
    delivery loss only. **Relays stay stateless.**
13. **Gap detection: sequence numbers for interior gaps, the directory-registered epoch root for the
    tail.** Silence is otherwise indistinguishable from nothing-was-sent.
14. **Repair is subscriber-initiated** — publisher-side redelivery would reintroduce per-subscriber
    state, the thing the artifact model exists to eliminate.
15. **A sealed epoch is retained on the relay longer than live content.**
16. **Repair goes publisher → relay → subscribers**, one re-park per distinct missing range. Jitter is
    derived deterministically from the subscriber's own pubkey; backoff is client-side. **No separate
    repair API** — the relay's existing recipient-signed pull carries a range.
17. **Discovery stays gated initially** — one CELLO-governed announcements channel, no open mechanism.
18. **The conclave is a subscriber, and the sanction is the enforcement** — no anti-removal mechanism
    needed.
19. **Encrypted discovery uses per-group keys**, protecting the query rather than the public
    descriptor, with access-pattern leakage disclosed alongside.
20. **Encrypted search is not a headline feature.** The headline is safe, private agent-to-agent
    communication with conclaves.
21. **Relays are given away; directories are retained.** Consortium expansion by inviting large
    operators to run nodes.

## Open

- **How long an epoch may stay open.** Publisher-triggered sealing is right — they know when a batch
  is meaningful — but **the unsealed window is the equivocation window** (Part 4b), so the cap is a
  security parameter rather than housekeeping. A subscriber needing provable evidence should also be
  able to request a seal.
- **The relay retention ceiling.** A publisher declaring long retention is volunteering someone
  else's disk. Publisher-set or relay-operator-capped, and channels are otherwise a storage-abuse
  vector with a legitimate-looking front door.
- **Local retention on the subscriber.** A session ends and seals; a channel never does. A busy
  channel over a year is unbounded local rows with no natural point to drop them. The epoch roots
  make pruning artifacts safe — but the policy is unwritten.
- **What a title may contain, and who validates it.** Titles are now load-bearing for notification
  rules and digests, which makes them a surface a publisher can abuse — and a place injection lands.
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

### Three one-to-many designs exist. They are not the same feature.

Written down because the shapes rhyme and a later reader will assume one supersedes the others.
Both documents below predate any code — they are design-by-imagination against a protocol that did
not exist yet. This log is the opposite: it starts from what is built and what an operator actually
hit.

- [[2026-04-19_2045_group-room-design|Group Room Design]] — **a different feature: group chat.** Many
  agents talking to each other, with floor control so they take turns. Its *Archetype 4* reaches a
  broadcast-shaped result by configuring a room down to 3 speakers and 100 listeners, and enforcing
  listener silence at the relay. **That is not the route to a broadcast channel**, and this log says
  why: a broadcast is not a conversation with the talking turned off, it is a signed artifact with no
  session to reply into — so listener silence needs no enforcement, and the fan-out cost stops being
  tied to the tamper-evident record. Archetype 4 is superseded *as a way to build a broadcast
  channel*. **The group chat design itself is not superseded by anything here** — this log does not
  design group conversation and does not replace it.
- [[2026-04-18_1407_push-publish-subscription-model|Push-Publish Subscription Model]] — **a different
  feature: a paid content subscription**, roadmapped under M17 Commerce. You subscribe to a
  *publisher* and pay per delivery; the terms are negotiated bilaterally in a normal session first.
  A broadcast channel is subscribe-to-a-*topic*, unpaid, and has no negotiated agreement behind it.
  The two could share a delivery mechanism later; they are not the same product decision, and neither
  blocks the other.
