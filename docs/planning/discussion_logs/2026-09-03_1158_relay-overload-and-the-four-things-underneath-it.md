---
name: Relay overload, and the four things we found underneath it
type: discussion
date: 2026-09-03
topics: [m15, relay, hardening, reservations, seal, unilateral-seal, truncation, screener, authorship, multi-device, scaling, abuse]
description: >
  Started as "can somebody fill our relays with a botnet." Ended with five distinct findings, only
  one of which is the relay. The sharpest is that a message arriving with NO authorship proof is
  ingested, while one arriving with a BAD proof freezes the session — fail-open on absence. Also:
  reservations are granted without asking what for; a party can escape the sealed evidence trail by
  withholding and force-closing; a caught prompt injection tells the operator nothing; and one
  identity on two devices silently resolves as last-writer-wins.
---

# Relay overload, and the four things we found underneath it

**Andre and Claude, 2026-09-03.** Everything below was checked against the code during the
conversation, not recalled. Where something was *not* checked, it says so.

---

## The question we started with

> Someone creates a botnet of agents. They register properly. They ask for relay slots and actually
> have conversations. They fill one relay, move to the next, and do it again. And they wouldn't need
> that many registered agents either.

That is correct, and the arithmetic is worse than it looks. But chasing it down turned up four other
things that have nothing to do with relays, and one of them is more serious than the thing we set
out to investigate.

## The frame that matters, and it is Andre's

> *"We're not going to block this attack. I don't think we can. What we're trying to do is make sure
> that if it happens, it happens because they used the official channels and the correct protocols.
> It should get to the point where this attack and heavy legitimate use are indistinguishable."*

That is the right goal and it is the spine of everything below. A hundred real registrations with
real phone numbers, real emails, real GitHub identities, all busy talking to each other, **looks
exactly like success** — and it should. At that point it stops being a security problem and becomes
a capacity and pricing problem, which is an ordinary problem with ordinary answers: scale out,
detect, meter, charge, prioritise.

Every finding below is a place where that is **not yet true** — where an attacker gets something
without going through the official path.

---

# 1. A message with no authorship proof is let through

**This is the most serious thing in this document and it was found by accident.**

## What happens to you

Your counterparty sends you a message. Attached to it is a small record proving they wrote it —
their signature over the content.

- If that record is **present and wrong** — bad signature, or signed by somebody who is not your
  counterparty — the session is **frozen**. Loud, immediate, correct.
- If that record is **absent entirely**, the message is **ingested and delivered to your agent**,
  with no check on who wrote it.

Andre's description of it: *"I show up with my passport and the photo doesn't match, I'm blocked.
But if I arrive at immigration with no passport, they let me through."*

The code is not hiding this. It says, in a comment: *"the per-message signer check is **opt-in for
the sender** — a party that passed the peer gate and wants to avoid the comparison simply omits the
proof."*

## Why it was built that way, and why the reason only covers half

The proof record and the message's **sequence number** are welded into one structure. The sequence
comes from the relay. So if the relay is unreachable, an honest peer genuinely cannot produce the
record — and refusing on its absence would make the relay a precondition for reading your mail.
That reasoning is sound.

**But it only covers the sequence.** A sender can always sign their own message; that never needed
the relay. Bundling the two meant that losing the relay was allowed to drop the passport along with
the queue ticket.

**The fix shape: split them. Signature mandatory, sequence soft.**

## What it is not

Not a stranger walking in. The sender still had to be the authenticated peer on that session, and
the screener and hash cross-check still run. What is lost is **proof of who wrote each message** —
which is the product.

## Where to look

- `cello-client/core/daemon/src/session-node-manager.ts` — the branch itself, around **13614–13656**.
  The refuted path calls `#freezeOnIdentityFailure`; the `else` branch below it logs
  `session.content.ordering.absent` at INFO and carries on. Read the comment on that `else` — it
  states the defect in its own words.
- Same file, `#recordFrameOrdering` at **13195** — what "verified" means.
- Same file, `ingestReceivedContent` at **8528**, and the doc comment on its `verifiedAuthorship`
  parameter at **8546–8559**: *"Optional, because the soft decode-failure path ingests without it."*

---

# 2. The relay grants reservations without asking what they are for

## What happens to you

Your agent is behind a router, like almost everyone. To be reachable at all it needs the relay to
hold a forwarding row for it — a circuit reservation. If the relay's table is full, your agent is
unreachable by anyone NAT'd, **while its own status reads perfectly healthy**, and the refusal in
the relay's log names the attacker's agent, not you being turned away.

## The arithmetic

- A relay's table holds **4,096** rows.
- One registered agent may hold **32** of them.
- So **128 registered agents fill a relay**.
- The fleet is **two relays**. **256 agents covers the whole fleet.**
- Registration friction is one Telegram round trip and an emailed code, limited to 5 per hour per
  requester. **Nothing caps how many agents one account may register.** That is roughly a day of one
  invited account per relay.

## Why 32, and why it cannot simply be lowered

32 is not slack. It mirrors the daemon's own limit of 32 concurrent session nodes, each of which
holds its own reservation. **So an attacker holding 32 looks exactly like a busy legitimate agent** —
which is why the cap cannot be tightened without capping real concurrency.

## What the relay actually checks

There are **two gates**, and conflating them is what hid this:

| | What it asks | What it needs |
|---|---|---|
| **Do you get a row?** | Are you a registered agent, and under your 32? | A one-hour directory token saying "this key is registered" |
| **May you dial through to someone?** | Does a directory-signed assignment name both peers? | The manifest |

**The manifest gates who may reach you. It has nothing to say about who may occupy the table.** And
it cannot: an agent behind NAT is not reachable until it already holds a row, so nobody can be
assigned to talk to you before you have one. **The row must come first.** That ordering is forced,
not an oversight.

## Two more things worth knowing

- **A row is granted on request, not on need.** The relay never checks whether you are actually
  NAT'd. An attacker on a public IP takes rows it will never forward anything through.
- **Having real conversations is what makes squatting stick.** The reaper only runs above 80% full
  and never touches a row that carried traffic in the last six hours. But the traffic required is
  **one message per row per six hours** — a trickle, not chatter. Below 80% it never runs at all.

## The fix, as Andre framed it

The reserve request states its purpose and the relay enforces per purpose:

- **Standing receiver** → capped small. No manifest needed; none can exist yet.
- **Session** → present the manifest. On the correct reading this is a **reclassification**, not a
  gate: the promoted receiver already holds its row, so presenting the manifest **moves that row from
  the standing-receiver budget to the session budget**, freeing the small budget for the replacement
  receiver.

Ceiling becomes "a couple of receivers, plus one per session the directory actually brokered." An
attacker with no real sessions stops at the small number.

**The failure mode to design for:** a daemon that restarts ungracefully returns with a new peer ID
under the same key. If the relay has not noticed the old one leave, the rule refuses an agent its own
front door — the same outage that forced the ceiling up from 15 in the first place. The rule needs a
"the old holder is provably gone, or loses" tiebreak.

## Where to look

- `packages/relay/src/relay-connection-gater.ts` — `SLOT_CAP_PER_AGENT` (**48**),
  `SLOT_REAP_ACTIVITY_FLOOR_MS` (**71**), `DEFAULT_SLOT_CEILING` (**79**),
  `DEFAULT_REAP_PRESSURE_FRACTION` (**87**), `admitSlot` (**371**, cap check ~**420–435**),
  `reapIdleSlots` (**479**), `denyInboundRelayReservation` (**683** — gate 1),
  `denyOutboundRelayedConnection` (**831** — gate 2), `recordActivity` (**316**).
- `packages/relay/src/relay-node.ts` — the auth handler's token check and `admitSlot` call
  (~**1356–1415**), the reservation-purpose early return (~**1425–1435**), the one `recordActivity`
  call on the submit path (**1693**), `maxReservations` (**3191**),
  `DEFAULT_RESERVATION_PROOF_RATE_LIMIT` — 30/minute per key (**202**).
- `packages/interfaces/src/relay-online-token.ts` — the whole file. 104 bytes: agent key, expiry,
  signature. **No operator, no quota.** Issue lifetime at **73**.
- `packages/directory/src/directory-node.ts` — `#issueOnlineToken` at **6436**.
- `cello-client/core/daemon/src/types.ts` — `MAX_SESSION_NODES = 32` at **522**. This is where the
  relay's 32 comes from.
- `cello-client/core/daemon/src/session-node-manager.ts` — standing receiver keyed one-per-agent,
  **14711** / **14782**; the reservation + auth sequence at **14770–14805**.

## And the directory needs a counter, not a cap

Once reservations require a manifest, the attacker's ceiling becomes "however many sessions the
directory brokers for me" — and **nothing counts that today**. No quota, no rate limit, no
concurrent-session count anywhere in the directory package. Without a meter the fix moves the ceiling
from 32 to unlimited, which is worse arithmetic. **The two ship together.**

**A cap at the directory would be guessing about a shortage it cannot see. A counter would not.**
Every option worth having later needs the same missing fact:

- Detection needs it, or "one operator with 100 agents" and "100 customers" read identically.
- Post-mortem forensics needs it **recorded at the time**; it cannot be reconstructed later.
- "Post a bond" needs to know whose bond. "Priority for a long track record" needs whose track record.

**Half of it already exists:** `agent_profiles.account_id` → `user_accounts`, so agents-per-operator
is countable today (`packages/directory/db/migrations/V23__agent_profiles_account_id.sql`). **The
missing half:** the live `sessions` row holds only session id, owning node, timestamp and chain hash
— **no participants** (`packages/directory/db/migrations/V18__federation_schema.sql:20`). So sessions
per agent is not countable, and per operator therefore is not either.

**And the privacy constraint is already in the schema.** There *is* a participation table, but it
records **pseudonyms** against sealed conversations, by design
(`V2__directory_schema.sql:115`). Building the analytics on top of that would undo the pseudonymity
on purpose. Which points at the right shape: **a live concurrency count, not a history log.** The
current count answers the capacity question; history is where the privacy problem lives.

### Closing the count — settled during this discussion

The directory learns a session **started** when it brokers one. It learns a session **ended** only
when it takes part in the closing ceremony — so a **sealed** ending is a real signal it sees. What it
never learns is the other endings: abandoned, interrupted, daemon killed. Those would count against
an operator **forever**, penalising exactly the people who had an outage.

Andre's design, which is better than the lease idea it replaced:

1. The directory tells a daemon it is over its session budget.
2. The daemon closes some — bilateral seal preferred, unilateral if the counterparty is absent.
3. If it can do neither, it **declares a force-close**. That session is then permanently unsealable
   and stops counting.

Every session then ends in one of three recorded ways, so the count is exact rather than
approximate, with no timer guessing.

**The hazard in branch 3, and it is the reason finding 3 exists:** a force-close declared by one side
must **not** stop the counterparty producing their own unilateral seal. Otherwise "I force-closed"
becomes a way to deny someone their evidence on demand.

---

# 3. A party can withhold, force-close, and walk away from the evidence

## The two attacks, both by the same person for the same reason

You do something malicious in a conversation — an injection attempt, a wallet drain, whatever. You
want the cryptographic paper trail not to contain it.

- **Attack A — force close.** Refuse to take part in any closing ceremony. Your counterparty is left
  with their own local log and no notarised receipt.
- **Attack B — truncate.** Seal unilaterally at sequence N−1, omitting your last message. Every leaf
  validly signed, nothing false, only something missing.

## What defeats it, and it is Andre's own argument

To attack me at all you had to send me a properly formed message: signed by you, chained to the hash
of the one before. **I hold your signature.** I cannot forge it and you cannot disown it. So I should
be able to seal unilaterally **including** your message, whatever you do afterwards.

## Checked: the verification design already allows exactly this

The unilateral path's rule is deliberately asymmetric:

- **Your own leaves** must each carry a valid relay receipt, or the seal is refused
  (`unilateral_own_leaf_unwitnessed`). Reason: your signature covers the content but **not** the
  sequence number, so without receipts you could renumber your own leaves.
- **The counterparty's leaves carry no receipt at all** — the relay never ack-signs a delivery to the
  recipient. They are pinned by **their own sender signature** plus sequence contiguity against your
  receipt-pinned leaves.

**So carrying the attacker's signed message with no relay receipt is precisely the case the design
anticipates.** The requirement holds.

## But there is a hole underneath it, and it is a bad one

**Only the sender submits a hash to the relay.** `submitMessageHash` has exactly one production
caller, on the send path. **Nothing submits a hash for a message received.**

So on a **direct** connection — no NAT, or hole punching working — a malicious client delivers
message N to you and simply never witnesses it. **The relay's account genuinely ends at N−1**, and a
truncated seal is consistent with the witness. The relay cannot catch what it was never shown.

**Compose that with finding 1 and it gets worse:** the withheld message can also arrive with no
authorship proof, because absence is soft. Direct session, no ordering record, nothing witnessed
anywhere — and the code's own named mitigation for the missing signer check is *relay-side
corroboration*, which is the thing being withheld.

## The fix

**The receiver submits the hash of what it received.** It holds the sender's signature, so it cannot
fabricate a leaf the sender did not write, and the relay can verify that before accepting. This
closes the withholding attack for every direct session and gives the unilateral seal a witnessed leaf
to stand on.

**The policy lever already half exists:** relay-only routing is an operator setting, and `high_stakes`
is being added to the signed assignment right now in `017-TBS` so the target can see what tier it is
held to. Forcing relay routing for high-stakes sessions is the obvious pairing — accept the IP
disclosure in exchange for a guaranteed witness.

## Open, not checked

Whether the daemon **assembles** a carried leaf for a message that arrived with no relay ordering
record — the withheld case exactly. The verifier would accept it; whether the client builds it is a
separate question and it decides whether the requirement holds **today** or is new work.

## Where to look

- `packages/directory/src/seal-unilateral-verify.ts` — the whole header comment (**1–20**) states the
  asymmetry; `reconstructCarriedSealLeaves` at **49**; the own-leaf receipt requirement ~**84–91**;
  contiguity ~**80–82**.
- `cello-client/core/daemon/src/session-node-manager.ts` — `sendContent` at **7392**, the single
  `submitMessageHash` call at **7512**, with the comment above it explaining that the relay is the
  ordering authority.
- `cello-client/core/daemon/src/session-relay-client.ts` — `submitMessageHash` at **1405**.
- Related existing lines: `DOD-M15-RELAYFANOUT-1` (in the gate — names truncation precisely),
  `DOD-M15-SEALROOT-UNILATERAL-1` (backlog — the unilateral path never calls the final-root
  verifier), `DOD-M15-NOTCARRIED-REFUSE-1` (closed for bilateral, **unilateral deliberately kept
  separate**).

---

# 4. The moment we catch an attack is the moment we tell nobody

## What happens to you

Your screener catches a prompt injection aimed at your agent. It is blocked correctly — the content
never reaches the model. A leaf is recorded so both parties' hash chains stay aligned, and the sender
is acknowledged so they stop retrying.

**You are told nothing.** It is a line in a log file you have no reason to open.

## The count

Only **three** refusal reasons reach the operator: unknown hash algorithm, unavailable salt, and hash
mismatch. Not the screener. Not the size limit. Not an orphaned or committed session.

`DOD-M15-REFUSED-INBOUND-SILENT-1` closed on 2026-08-24 and wired those three, which was the right
first cut — a version skew silences a conversation permanently and that was the urgent case. But the
screener block was never wired, and it is the one the product is *about*.

We already have a line for this exact shape at a different door:
`DOD-M15-SEALREJECT-MUTE-1` — *"the one moment the system catches the attack it was built for is the
moment it tells nobody."* **Nobody had connected the two.**

## Still open from that unit's own review, and one is a decision of Andre's

Pass 2 carried a list forward as ACs on a later unit. **Whether that unit exists has not been
confirmed.**

- `counterparty_gone`, `delivery_impaired`, `content_undeliverable` — still not surfaced.
- **`counterparty_gone` is the dangerous one.** It tells the operator their peer *"may have crashed
  or gone offline — call `cello_close_session` to seal"* while the daemon holds the real reason in
  memory. **It hands them a network story for a verification fault and steers them toward sealing** —
  which, read against finding 3, is being nudged into exactly the truncated close.
- `session_size_limit_exceeded` — once a session crosses the sender's byte cap, every later message
  is refused for the life of the session, silently. Pass 2 argued for moving it out of post-launch.
  **That call is Andre's and is still open.**

## One crack worth writing down

A direct-path refusal sends no delivery acknowledgement, so the sender's backstop parks the message
and it arrives on the park path seconds later — where it may be **accepted**. A frame refused by name
on one path can be accepted on the other, and the two events are not tied together. The code knows
and logs it rather than fixing it.

## Where to look

- `cello-client/core/daemon/src/session-node-manager.ts` — the design note and `noteContentRefusal`
  at **8406–8470**; the only three wired call sites at **8650**, **8706**, **8730**; the terminal
  block at **8919–8967** (it leafs, it acks, it never buffers, it never notes); the full set of
  refusal exits between **8528** and **9200**.
- Same file, `recoverParkedEntry` at ~**10790–10860** — the park path by contrast **fails closed**,
  refuses by name, never confirm-deletes so a forgery cannot evict itself, and remembers refusals so
  a re-pull is not an amplification vector. Good model for the others.

---

# 5. One identity on two devices resolves as last-writer-wins

## What happens to you

You run the same agent identity on a laptop and a desktop. Both are legitimate; nothing forbids it.

- **The relay's delivery stream is keyed by public key.** The second device's authentication
  overwrites the first, and the first device's counterparty leaves start arriving at a node with no
  handler.
- **The directory routes inbound session offers through a map keyed by public key.** Last device to
  authenticate wins. The first device stops receiving offers **with no indication**.

Circuit dials are fine — those name a peer ID and route unambiguously. It is the two pubkey-keyed
maps that collapse, and they were found independently in two different repositories.

## The rule — DECIDED by Andre, 2026-09-03

**Multiple devices on one identity are allowed. They may not share a relay.** In practice:
*"Sorry, this public key is already in use on this relay."* A relay cannot see what another relay
holds, so it cannot force you onto a different one — but it can refuse the second reservation
locally, and the client already requests reservations with every known relay, so the fallback path
exists. It fixes the delivery-stream overwrite as a side effect.

**Same restart hazard as finding 2:** the rule needs a "the old holder is provably gone" tiebreak, or
an ungraceful restart locks an agent out of its own front door.

## Where to look

- `packages/relay/src/relay-node.ts` ~**1420–1432** — the comment explaining that `#streams` is keyed
  by pubkey and what a second full auth from the same agent does.
- `packages/directory/src/directory-node.ts` **2060–2078** — `#streams` (single, pubkey-keyed, what
  offers are delivered to) versus `#agentStreams` (a set, liveness counting only).

---

# Decisions

Four things need a call from Andre. Each one below says **what you are deciding**, **the options**,
and **what I would do**. Nothing here is blocked on more investigation.

---

## Decision 1 — Are these five findings launch blockers, or post-launch?

**What you are deciding:** which of the five go into the M15 gate (launch waits for them) and which go
into the post-launch backlog. `M15-PROCEDURE §0z.1` says classify at creation time with one line of
reasoning, and that unclear cases block.

**My recommendation, finding by finding:**

| # | Finding | I would put it | Why |
|---|---|---|---|
| 1 | A message with no authorship proof is ingested | **GATE** | Somebody pointing a coding agent at the repo finds this in an afternoon, and the code comment hands it to them. It undoes the guarantee the product is sold on. |
| 3 | Withhold + force-close to escape the seal | **GATE** | The receipt is the product. A path that lets the guilty party remove themselves from it is not a papercut. |
| 4 | A caught injection tells the operator nothing | **GATE** | Screening is one of the three things the launch intent names as core value. Catching an attack silently is most of the way to not catching it. |
| 2 | Relay reservations granted without purpose | **BACKLOG** | Needs 128 registered agents. Invite-only makes that expensive today, and the fix is a capacity problem, not a hole. Revisit before open signup. |
| 5 | Two devices, last-writer-wins | **BACKLOG** | Affects one operator's own two machines. Annoying, not a trust failure. |

**If you disagree with any row, the argument to make is the launch-triage one** — would this
fundamentally ruin a prospective customer, or could they forgive it?

---

## Decision 2 — The session byte cap that kills a conversation silently

**What this actually is** (I described it wrongly at first, and it is not about session counts):

Every sender has a **total-bytes budget per session**, set by their trust tier. A stranger gets
**25 MB**; known contacts get more. Once the running total of bytes you have received from that
person in that session crosses their cap, **every later message from them is refused for the rest of
the session.** Neither of you is told. From your chair the other person simply stops replying, and
nothing you do brings the conversation back — it is dead for good.

The review that found this argued it should come out of the post-launch backlog, because it is the
same permanent-silence shape as the three refusals that *were* wired, and the remedy is entirely the
operator's. **That argument has been sitting with you unanswered since 2026-08-24.**

**Your options:**

- **A — Wire it now.** Add it to the operator refusal surface alongside the three that are already
  there. Small: the strings exist, they just have no reader.
- **B — Leave it in post-launch.** Accept that a long conversation can die silently before launch.
- **C — Wire it and raise the cap.** If 25 MB is low for a real working session, the cap itself is
  also worth a look.

**I would do A.** It is the same one-line wiring as the three already done, and this is finding 4
wearing different clothes — we catch something and tell nobody.

---

## Decision 3 — Multi-device policy

**DECIDED by Andre, 2026-09-03:** running the same agent identity on multiple devices **is allowed**,
but those devices **may not use the same relay**. A relay refuses a second standing receiver for a
public key it is already serving, and the client falls back to another relay.

**Two things that ruling does not yet cover, and both need an answer:**

### 3a — When a daemon restarts, who wins?

A daemon that dies ungracefully comes back with a **new peer ID under the same key**. The relay still
thinks the old one is there, sees "this key is already in use here," and **refuses the agent its own
front door.** That is the outage that forced the reservation ceiling up from 15 in the first place, so
it is not hypothetical.

- **A — Newcomer wins, but only once the incumbent's connection is provably dead.** The relay checks
  liveness before refusing.
- **B — Newcomer always wins.** Simple, but that is last-writer-wins, which is the thing this rule
  exists to remove.
- **C — Incumbent wins until it times out.** Safe against takeover, but an agent is locked out of
  itself for the length of the timeout after every crash.

**I would do A.** It is the only one that is both safe and doesn't punish a crash.

### 3b — Which device gets an incoming session offer?

**The relay rule does not solve this.** Both devices still authenticate to directory signalling under
the same key, whichever relays they use, and the directory routes offers through a map keyed by
public key — **last device to authenticate wins, silently.** Your laptop stops receiving invitations
the moment your desktop comes online, with no indication on either machine.

- **A — Offer goes to every device**, first to accept takes the session.
- **B — Offer goes to the most recently active device** (today's behaviour, made deliberate and
  visible instead of accidental).
- **C — One device is designated primary** and the others are send-only.

**I would do A**, because it is the only one where the operator never silently loses an invitation.
It is also the most work, so B made explicit is a reasonable interim.

---

## Decision 4 — Does the directory get a session counter?

**What you are deciding:** whether to record, per operator, how many sessions are open right now.

This is not a cap and would refuse nobody. It exists because **every option you have floated for
later needs it** — detection, post-a-bond, priority for long track records, freemium tiers on
concurrent agents. None of them can be built without knowing whose load is whose, and history cannot
be reconstructed after the fact.

**Half of it already exists:** agents are already linked to accounts. **The missing half:** the
sessions table does not record who is in a session.

- **A — Build the counter now**, alongside the relay purpose fix. They ship together, because the
  relay fix moves the ceiling from 32 to "however many sessions the directory brokers," and without a
  meter that is worse arithmetic than what we have.
- **B — Build neither now.** Defer both to post-launch as one unit.
- **C — Build the counter alone**, ahead of the relay fix, so the data starts accumulating.

**I would do B**, consistent with putting finding 2 in the backlog — but if finding 2 goes into the
gate, then it has to be A, never the relay fix on its own.

---

# Two facts to check before any of this is built

Neither is blocking a decision; both would change how the work is scoped.

1. **Does the daemon build a carried seal leaf for a message that arrived with no relay ordering
   record?** The verifier would accept one. If the client already builds it, finding 3's requirement
   holds today and the work is smaller than it looks.
2. **Did the earlier review's carried ACs actually land on a later unit**, or do they only exist in
   that closing note? Decides whether `counterparty_gone` and its two siblings are tracked work or
   forgotten work.

---

## Related

[[M15-DEFINITION-OF-DONE]] · [[M15-STORY-RELAYHANDOVER]] · [[protocol-map]] · [[end-to-end-flow]]
