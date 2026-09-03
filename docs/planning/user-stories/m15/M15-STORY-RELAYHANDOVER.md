---
name: M15 Story — Relay Handover
type: story
date: 2026-09-02
milestone: M15
status: open
topics: [m15, relay, handover, session, witness, assignment, frost, seal, availability, story]
description: >
  Move a LIVE conversation to a new witness relay when the current one goes away — planned or
  unplanned — by re-brokering the assignment and replaying the signed hash chain to the new relay.
  Closes DOD-M15-SESSION-RELAY-PINNED-1 and the availability half of DOD-M15-MULTIRELAY-1.
  Design settled with Andre 2026-09-02; this document carries the decisions so no unit re-opens them.
---

# Story — Move a live conversation to a new relay

**This is a STORY, not a micro work order.** It spans the directory, the relay and the client, which
is exactly what the micro-order stop rule names as too big for one unit. It decomposes into four
micro orders (§7); write and pull those individually.

---

## 0. ✅ RULED BY ANDRE 2026-09-03 — the offline counterparty. Do not re-open.

**The question was:** the counterparty is offline when the relay dies, so their tip attestation
cannot be obtained and the handover cannot complete. What happens?

**All three options originally offered here were REJECTED, and the reasoning is the important part:**

> *"I don't think carrying on should mean having a conversation that can be part of the
> cryptographic paper trail. It's just not what we do."*

**The ruling:**

1. **The relay assignment DOES move.** The client gets a new witness assigned and is ready to go.
   That part does not wait for anybody.
2. **The conversation does NOT resume until the counterparty is back and has attested the tip.**
   No new content enters the hash chain in the meantime.
3. **Nothing unwitnessed is ever admitted to the paper trail.** There is no degraded tier, no
   "carry on and mark it weak", no unattested stretch inside a receipt. A receipt covers witnessed
   content or it does not exist.

**Why this is better than what I proposed, stated so nobody re-litigates it:** a conversation needs
two parties. If the counterparty is gone there is nothing to say to them anyway, so "let the present
party keep talking" was solving a problem that does not arise — at the cost of the one property the
product exists to provide. Andre: *"You can't have a conversation until the other person is back. If
the other person isn't back, there's nothing new to start. You just have to wait."*

### The one sub-question left open, and it is small

**How the resume is TRIGGERED.** Andre: *"I'm not sure about retrying all the time."* He is right to
flag it — a poll loop against a peer who may be gone for days is waste, and this milestone has
already paid for one of those (2,675 reservation retries in a single daemon's log).

**Resolve it in unit 3, and prefer event-driven over polling:** the daemon already learns when a
counterparty comes back (presence/liveness is live and replicated — `agent_presence` is a Tier-B
anti-entropy table). Attempt the handover on that signal, not on a timer. **Decide it with a
measurement, not a guess**, and write the choice into the unit's review.

### What the operator sees while waiting

Not specified here on purpose — it is one sentence of copy and **wording is Andre's call**
(offer variants at unit 3, do not invent one). What it must convey: the conversation is intact and
paused, not broken; it resumes by itself when the other side returns; nothing has been lost.

---

## 1. What this fixes, in the operator's words

Today, if the relay witnessing your conversation goes away:

- every message costs a ten-second stall and is not witnessed;
- the session seals **neither during the outage nor after the relay returns**;
- you and your counterparty are told **opposite things** about your own close — one gets success
  with a pending receipt, the other is refused;
- the refused side, following its own guidance once the relay is back, is then told **the
  counterparty has not closed** — pointing at the person who did close and was told it worked.

Measured, not inferred: `016-RELAYLOSS`, two real daemons, relay killed mid-conversation.

After this story: **the conversation moves to another relay and carries on.** The receipt spans the
whole conversation with a recorded seam at the handover.

**Closes:** `DOD-M15-SESSION-RELAY-PINNED-1` (whole line) and `DOD-M15-MULTIRELAY-1` (availability
half — the reachability half already works; see §2).

---

## 2. 🎁 READ THIS BEFORE ESTIMATING — most of this already exists

The first scoping of this work called it milestone-sized. **That was wrong**, and the reason is that
five separate pieces of machinery already shipped for other reasons and compose into exactly what
handover needs. Verified in source 2026-09-02.

| What handover needs | What already exists |
|---|---|
| A client to present a directory-signed assignment to a relay of its choosing | **Option B, shipped.** `relay-node.ts`: *"a client presents a directory-signed session assignment to its chosen relay; the relay accepts an assignment signed by ANY of these [consortium directory pubkeys]"* |
| A replay payload — both parties' signed leaves for the session | **`SessionSealLeafStore`, shipped.** Holds both parties' leaves per session keyed by sequence, each with Structure1 (sender-signed), Structure2, and — for own leaves — **the relay's signed ACK receipt** |
| A verifier that rebuilds an untrusted carried chain and validates it | **`seal-unilateral-verify.ts`, shipped.** `reconstructCarriedSealLeaves` + `#verifyUnilateralChain` already enforce receipt-pins-sequence, contiguity 1..N, sender signatures, the `prev_root` chain, and signed `last_seen_seq` causal order |
| A trigger when the witness becomes unreadable | **`onWitnessUnreadable(relayPeerId, why)`, shipped** and already consumed by `session-node-manager` |
| A threshold signature over a new assignment | **FROST assignment signing, shipped** — it runs on every single `session_request` |
| Reachability failover (being *reached*, as opposed to the conversation) | **Shipped.** Lost reservation → quarantine that relay → rebuild the standing receiver against another |
| A way to mark a relay for retirement | **`status: "active" \| "draining"`, shipped** in the relay pool manifest; the directory already skips draining relays when assigning new sessions |

**So the genuinely new work is narrow:** a resume-flavoured assignment, a rebind on the client, one
replay frame, a port of the existing verifier to the relay, two tip attestations, and a seam in the
receipt.

**What does NOT exist, verified by grep, and each is a trap in §6:** the relay has no awareness of
any other relay's identity; the client never sees the relay pool manifest; there is no relay→client
"I am going away" frame of any kind.

---

## 3. The flow

1. The client notices its witness relay is unreadable (`onWitnessUnreadable`, existing hook).
2. It asks the directory for a **resume assignment** for the same `session_id`.
3. The directory selects a healthy relay (skipping `draining`), FROST-signs a resume assignment
   naming the new relay **and the prior relay's id**, and returns it.
4. The client presents that assignment to the new relay (the existing Option B path).
5. **Before any new message**, the two sides rebuild: one replays the signed chain, both attest the
   tip, the new relay verifies and accepts.
6. Only then does the conversation continue.

Step 5 is the story's centre of gravity. Steps 1–4 are largely wiring existing parts together.

---

## 4. Design decisions — SETTLED with Andre 2026-09-02. Do not re-open.

**D1 — Same session, new witness.** The `session_id` is inside every signed leaf. It **must not
change**: changing it invalidates every replayed leaf. Re-sign the assignment; do not re-mint the
session.

**D2 — A new FROST signature is required.** The assignment names the relay, so a new relay means
different signed bytes. The old signature does not cover them. This is the same ceremony that runs
on every session request — routine, not novel.

**D3 — The resume marker lives IN the assignment, not in a separate handshake.** The relay must know
this is a rebuild before the first frame arrives, otherwise the first replayed leaf looks like
message 1 of a fresh conversation. This makes it an **assignment-TBS change** (see §6, trap 4).

**D4 — Three reconciliation cases; only two are legal.**

- **Both tips agree** → rebuild at that length. The happy path.
- **One side is longer, and its chain EXTENDS the shorter one** → the longer side supplies the
  missing leaves; the shorter side verifies their signatures and appends. **This counts as a
  match.** Those are the in-flight messages, and they are already signed — there is nothing to
  negotiate, and the shorter side cannot refuse a validly signed leaf without lying.
- **Truncate to the shorter of the two — REJECTED.** Not primarily as an attack (it needs the losing
  side to agree to lose its own words, which it would not), but because **those messages exist**:
  both operators have them in their transcripts. Cutting the witness record means the receipt
  permanently covers less than was said, or you delete from the operators' transcripts — losing user
  data because a relay blinked. Case 3 costs almost nothing, so case 2 buys nothing to justify
  either outcome.

**D5 — Divergence is refusal.** Different content at a position both sides already hold is not a
reconciliation case; it is the attack the witness exists to prevent. Mark the session diverged and
unsealable — that state already exists — and tell the operator.

**D6 — A tip claim that cannot be produced is a rejected handover.** If a side claims N leaves and
cannot supply them, its attestation was false. Refuse; do not silently accept the shorter chain.

**D7 — Order comes from signatures, never from the new relay's numbering.** See §6, trap 1. This is
the single most likely way to build this wrong.

---

## 5. What is actually new

**Directory** — a resume path on the session-request handler: same `session_id`, select a healthy
relay excluding the failed one, FROST-sign a resume assignment carrying the resume marker and the
prior relay id.

**Client** — `SessionRelayClient` holds `#relayPeerId` and `#relayAddrs` as `readonly`, set in the
constructor. **It is immutably bound to one relay by design.** Handover therefore *replaces the
client instance* for that session; it does not mutate one. Plus: request the resume assignment, and
drive the replay.

**Relay** — accept a resume assignment; ingest a replay batch; verify it with a port of
`reconstructCarriedSealLeaves` + the chain checks; hold the two tip attestations; then resume normal
`hash_submit` sequencing from the rebuilt frontier.

**Receipt** — a seam. The artifact becomes *"relay A witnessed 1–40, both parties attested the tip,
relay B witnessed 41–60."* That is arguably stronger than a single witness, but it is a **format
change**, and whatever verifies a receipt must understand it.

---

## 6. Traps — each one verified, each one will bite

**Trap 1 — the unsigned position, and this story promotes it.**
`DOD-M15-RELAYSEQ-UNSIGNED-1` is currently POST-LAUNCH: the relay-assigned `sequence_number` is not
in Structure 1 and is authenticated by nothing. It was parked because it only bites when a relay
misbehaves. **Handover renumbers by design**, on the happy path, with honest software — so the
documented "duplication direction is NOT safe" case becomes reachable normally. It must be resolved
inside this story. **Do not fix it by signing the position** (that finding rules that out — it is a
wire change belonging with the seal work); derive order from the relay ACK receipts and the signed
`last_seen_seq`, and stop treating a relay-supplied position as authority for an append decision.

**Trap 2 — the new relay cannot verify the old relay's receipts on its own.**
Own leaves are pinned by the *previous* relay's ACK signature. Verified by grep: **a relay has no
knowledge of any other relay's identity** — there is no relay pool on the relay side, only
`CELLO_DIRECTORY_PUBKEYS`. So the prior relay's id **must arrive inside the directory-signed resume
assignment**, where it is trustworthy. Do not add a relay roster to the relay, and do not let the
client name the prior relay.

**Trap 3 — contiguity does not prove completeness.**
The existing verifier checks sequences are exactly 1..N, which catches an omitted leaf in the
middle. It **cannot** tell you N is the true end — a tail can always be cut at a clean boundary.
**The counterparty's tip attestation is the only thing covering tail truncation.** Do not let a
reviewer conclude the existing contiguity check makes tip attestation redundant.

**Trap 4 — the assignment TBS is signed, so changing it is bilateral.**
Current TBS: `[session_id, participant_a_pubkey, participant_b_pubkey, session_timestamp]`. Adding
the resume marker and prior relay id changes what every party signs and verifies. An older client or
relay cannot parse it. **There is already another field queued for "the next assignment-TBS
change"** (the decline reason the directory currently drops) — batch them into one change rather
than paying the bilateral cost twice.

**Trap 5 — never widen the client's re-dial to other relays.**
The standing prohibition, and it is load-bearing: a client that picks its own witness is grading its
own homework, which is the property `LEAFPARTIES-1` and `CORROBORATE-1` were built to establish. The
new witness is *always* directory-brokered.

**Trap 6 — reuse the fixture.**
`016-RELAYLOSS` added `j-relayloss.spine.test.ts`. Extend it. Do not write a new harness from
scratch — that is a blocking review finding.

---

## 7. The units — pull as micro orders, in this order

**Unit 1 — the resume assignment (directory + wire).** TBS change batched with the queued decline
field; directory resume path; relay accepts a resume assignment and records the prior relay id.
*Nothing moves yet; this unit only makes the resume assignment exist and verify.*

**Unit 2 — the replay and its verifier (relay).** Port `reconstructCarriedSealLeaves` + the chain
checks to the relay; accept a replay batch against a resume assignment; resolve trap 1 in the
process. *Verifiable in isolation: feed it a known-good chain and a tampered one.*

**Unit 3 — the client side.** Request a resume assignment on `onWitnessUnreadable`; replace the
`SessionRelayClient` instance for the session; drive the replay from `SessionSealLeafStore`; the
tip attestation exchange; cases D4/D5/D6.

**Unit 4 — the seam and the fallback.** The two-witness receipt format and its verifier, plus the
offline-counterparty degrade path. **Blocked on §0.**

**Enforcer for the story (not for any single unit):** extend `j-relayloss.spine.test.ts` — two
daemons, two relays, real binaries as separate OS processes. Kill the witness mid-conversation.
The conversation continues, and the session seals with a receipt spanning both witnesses.

---

## 8. Definition of done

1. A conversation whose witness relay is killed mid-flight continues, and seals, with both parties
   getting the same answer. Proven by the journey above, as separate OS processes, output quoted.
2. The receipt spans the whole conversation and names both witnesses and the seam.
3. A tampered replay is refused: truncated tail (caught by tip attestation), reordered leaves
   (caught by ACK receipts), forged leaf (caught by sender signature), internal gap (caught by
   contiguity). One test each, each made to fail on purpose by reverting its guard.
4. `DOD-M15-RELAYSEQ-UNSIGNED-1` is resolved, not deferred, and its DoD entry updated.
5. Gate passes in every repo touched; every unit reviewed by `cello-unit-reviewer` with the verdict
   quoted.

---

## 9. Explicitly out of scope

- **Mute-relay detection** (a relay that stops answering without closing goes unnoticed for minutes).
  A separate, unrelated bug fix — this story assumes something has already noticed.
- **Graceful drain** (telling agents in advance that a relay is retiring). Complementary and
  separate; it reduces how often handover fires but does not replace it.
- **`DOD-M15-RELAYFANOUT-1`** (fanning the live hash sequence to several relays). Different problem —
  cross-checking a witness, not replacing one.

## Related

[[M15-DEFINITION-OF-DONE]] · [[M15-PROCEDURE]] ·
[[micro/016-RELAYLOSS-what-happens-when-a-relay-goes-away]]
