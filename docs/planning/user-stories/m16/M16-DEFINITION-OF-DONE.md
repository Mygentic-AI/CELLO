---
name: M16 Definition of Done
type: definition-of-done
date: 2026-09-02
milestone: M16
status: open
topics: [m16, broadcast, channels, topic-channels, certificate-transparency, epochs, group-keys, subscription, relay, directory, daemon, definition-of-done]
description: >
  The yardstick and sole status authority for M16 (broadcast channels). A broadcast is a signed
  artifact published once and delivered many times — one publisher-side log sealed in chained
  epochs, group-key encrypted bodies, push to known subscribers, subscriber-initiated repair.
  Design source: the 2026-08-23 broadcast-channels discussion log, whose every open question was
  ruled in the 2026-09-02 addendum (decisions 1–35 there are settled — do not re-raise them here).
  Tiers encode dependency order only. Flip tags in place with one line of evidence and a journal
  pointer.
---

# M16 Definition of Done — Broadcast Channels

**Read [[M16-PROCEDURE]] first.** This document is the scoreboard; the procedure is how to work it.
Evidence, proofs, reviewer verdicts and run output live in [[M16-BUILD-JOURNAL]], never here.

**The design source is [[2026-08-23_1933_broadcast-channels-conclaves-and-encrypted-discovery]],
decisions 1–35.** Every one of them is SETTLED — a line below that seems to leave a choice open is
answered there first. **The design log is planner-only reading** (M16-PROCEDURE §1): it records
retired designs alongside live ones, and the coding agents on this milestone are weaker models that
must never be asked to tell them apart.

## Position relative to launch

**M16 is OUTSIDE the M15 launch gate. Nothing here blocks launch.** By the standing classification
test (a prospective customer cannot get the core value, or loses trust): the launch intent is two
agents connecting and communicating safely, and broadcast is new capability, not core value. If
Andre rules otherwise for a specific line, that ruling is recorded here at the top.

## How to read this

**Tags:** ❌ not started · 🟡 implemented, not yet reviewed · ✅ done (written AND reviewed, with the
reviewer's verdict quoted in the journal) · 🅿️ parked with a trigger.

**A tier is a dependency boundary, not a priority.** A line's clauses are expanded at pull time —
the coder writes the full clause checklist into the journal before implementing, and that checklist
is what the reviewer receives. What is written below is the target and the clauses load-bearing
enough that losing one would silently change the meaning of the line.

**Lines that name an enforcer are ✅ only when that enforcer ran as separate OS processes**, with
the run output quoted. Vitest green is necessary, never sufficient. **The milestone does not close
without the live multi-process smoke test at the bottom of this file.**

**THE LINE COUNT IS FROZEN: 22 lines, the count this milestone opened with.** M15 more than
doubled through mid-milestone findings; M16 does not. A finding enters this milestone only if an
existing line is false without it — then it is a clause on that line's work order, not a new line.
Everything else goes to the launch-gate intake (security, launch-relevant) or to the POST-M16
BACKLOG at the foot of this file, same day, one line of reasoning. **When unclear, it goes OUT** —
the deliberate opposite of M15's rule, because nothing downstream of this milestone is guarded by
holding an unclear item in. **The counterweight is the severity screen** (keys/signing, data loss,
unscreened context, a public claim made false): any finding that trips it is escalated to Andre as
a one-line ask instead of backlogged, so a hard gate never buries an important catch. Only Andre
adds a line, in writing, next to the new line itself. Full rule: M16-PROCEDURE §5a.

---

## Scope — IN / OUT

**IN:** the broadcast primitive end to end — channel identity, publisher log with chained-epoch
seals, directory notarization, group-key encryption with a join step, relay delivery frames, daemon
scheduled collection, turn-boundary delivery, gap detection and subscriber-initiated repair,
supersede, ejection with re-key, injection screening of all publisher-authored text, the MCP tool
surface, and one live CELLO-operated channel used for real.

**OUT — each with its trigger, so nobody rediscovers these as oversights:**

| Out | Why | Trigger to revisit |
|---|---|---|
| DCPE / encrypted discovery | Deliberately not a headline; found later is a gift (decision 20) | Post-adoption, deliberate |
| Any open discovery mechanism | Discovery stays gated (decision 17) | Andre's ruling |
| Conclave counter-signing | Veto couples publishing to conclave availability (decision 26); extension point reserved | "Sanctioned by CELLO" becomes a marketed claim |
| Conclave as sanctioning intermediary | V1 channels are CELLO-operated + fleet; nothing to sanction yet | First third-party channel requesting advertisement |
| Anonymous pull-only delivery | Dropped (decision 10); reopen conditions recorded in Part 5 of the log | Subscribing-is-sensitive use case, priced with a blind relay |
| Fan-out at scale | Highest attendance ever observed is 2 (decision 29) | First channel past ~50 subscribers |
| Subscriber local pruning | ~9K rows/yr is nothing; roots make later pruning safe (decision 28) | First channel store past ~100K rows |
| Retraction beyond supersede | Append-only by design (decision 24) | Never — supersede is the model |
| Shared-key fleet tier | One codepath, artifact model only (decision 27) | Never |
| Consortium governance | Not code (decision 30) | Before the second external directory operator |

---

## Cross-cutting rules — apply to every line

- **Observability is a first-class AC on every story.** Named `domain.noun.verb` events (taxonomy
  seeds: `channel.artifact.published`, `channel.epoch.sealed`, `channel.artifact.delivered`,
  `channel.gap.detected`, `channel.repair.requested`, `channel.member.joined`,
  `channel.member.ejected`, `channel.rekey.completed`, `channel.screen.blocked`), required context
  fields, correlationId threaded per async flow, error-path coverage. No `console.log`.
- **Every new table keys and joins on `agent_id`** (or channel pubkey), never `agent_name`.
  SQLCipher, never `node:sqlite`.
- **Every new relay path ships with a per-peer rate limiter on day one.** M15 spent a tier
  retrofitting limiters; no M16 path is exempt at birth.
- **Cross-repo cascade.** This milestone changes cello-client packages (crypto, protocol-types,
  transport, client, connect) AND trustless-cello (relay, directory). Every story touching
  cello-client carries the version-bump-and-publish AC; publishing goes through `/cello-publish`,
  loaded fresh per publish. Never `workspace:*` for cello-client packages in trustless-cello.
- **Crypto cites its RFC in pseudocode** (Merkle trees → RFC 6962 as reference shape; Ed25519 →
  RFC 8032). No mocks for crypto operations.
- **Compatibility is bilateral.** A pre-M16 client receiving an unknown broadcast frame must fail
  loud-and-harmless, not corrupt state. Each format story states what an old client does.

---

## Tier 0 — Format and identity foundations

Everything below depends on these, and these are the migration-trap decisions: wrong here strands
history.

### `DOD-M16-ARTIFACT-1` ❌ — the broadcast artifact wire format, specified and frozen
One signed artifact: channel pubkey, monotonic sequence number, epoch id, title, body (ciphertext),
`supersedes` (nullable, present from v1 — decision 24), previous epoch's sealed root when first in
an epoch, signature, and a reserved extension area (future conclave co-signature, decision 26).
Size limits and encoding stated. **Load-bearing clauses:** `supersedes` exists on day one even
though semantics are minimal; the extension area is reserved now; the format doc states what a
pre-M16 client does on receipt. **Enforcer:** publish from one daemon process, verify signature +
decode on a second daemon process built from the published packages.

### `DOD-M16-IDENTITY-1` ❌ — a channel is a registered CELLO identity
Full registration ceremony (identity cost preserved — decision 31), directory profile carries
`channel: true` and `admin_pubkey`, mutable only by admin signature. **A channel never converses:**
it cannot initiate sessions, and a receiver refuses inbound session traffic from a channel identity
— receiver-side refusal because that is the only path-independent enforcement (decision 3).
**Enforcer:** live registration against the dev directories; a session-initiate attempted as the
channel identity is refused at a separate receiver process.

### `DOD-M16-CT-1` ❌ — Merkle machinery in `@cello-protocol/crypto`
Per-epoch tree (tree, not linked list — the chain link is at the epoch boundary only), inclusion
proofs, and **consistency proofs across the epoch chain** — the property that decided the design.
**Enforcer:** a separate verifier process holding only roots and artifacts (no publisher DB access)
verifies inclusion of a mid-epoch message and consistency of epoch N+1 over epoch N.

### `DOD-M16-SEAL-TYPE-1` ❌ — the `channel-epoch-seal` receipt type
A new unilateral receipt (decision 34): states what it proves (publisher committed to this exact
tree; directory threshold notarized existence and timing) and what it does not (no counterparty
approved the contents). **Load-bearing clause:** the two-party session seal's semantics are not
touched anywhere in the diff. Carries the co-signature extension point.

---

## Tier 1 — Publisher log and epoch lifecycle

### `DOD-M16-PUBLOG-1` ❌ — the publisher-side channel log
One append-only log per channel in the daemon's SQLCipher store, keyed on channel identity; leaf
append and local root recompute on every publish. This log is the durable copy — the premise the
whole repair design stands on (decision 12).

### `DOD-M16-EPOCH-1` ❌ — epoch sealing, with the cap enforced as a security parameter
Publisher-triggered sealing any time; **forced seal at 24h after the first unsealed message or
1,000 messages, whichever first; empty epochs never seal** (decision 22). A channel may declare a
shorter cap as a published property; 24h is the protocol maximum. **Load-bearing clause:** the cap
is enforced by the daemon, not advisory — the unsealed window IS the equivocation window.
**Enforcer:** a live publisher left past the cap seals without operator action, journal-quoted.

### `DOD-M16-NOTARIZE-1` ❌ — directory notarization and the high-water mark
Epoch-root threshold notarization (T = majority, as everywhere — settled, never re-raised), once
per epoch regardless of subscriber count; the directory publishes the channel's high-water mark
(latest sealed root/seq) for tail-gap detection (decision 13). **Enforcer:** notarization succeeds
with one directory node down.

### `DOD-M16-SEALREQ-1` ❌ — subscriber-requested seal
Honored, at most one per channel per hour; requests inside the window are no-ops against the
just-sealed root (decision 22), so the request path cannot grind the directory.

---

## Tier 2 — Membership and keys

The join step precedes delivery in dependency order because delivery encrypts to the group key the
join step distributes.

### `DOD-M16-JOIN-1` ❌ — the join step, for every channel
Subscribe request → admit (open: automatic; invite-only: admin approval) → the joiner receives the
group key, the channel's notification guidance, the TTL, and channel metadata. Subscriber list is
held publisher-side (decision 8 — push to known subscribers is the single model). **Load-bearing
clause:** guidance and TTL land at join because two settled decisions depend on that step existing.

### `DOD-M16-GROUPKEY-1` ❌ — group-key encryption of every body
All bodies encrypted to the per-channel group key (decision 32). **Load-bearing clause: the relay
never reads content — the posture is uniform with sessions**, and the artifact's title/routing
fields remain the only plaintext the relay sees.

### `DOD-M16-EJECT-1` ❌ — ejection with re-key
Invite-only admin ejects a member: removal from the delivery list AND a re-key — new group key
encrypted per-member to the remaining subscribers (decision 32). **Load-bearing clause: eject
without re-key is advisory, and advisory is not done** (decision 9). The ejected member's old key
reads nothing published after the eject; what they already cached is out of scope by construction.
**Enforcer:** live three-daemon run — eject one subscriber, publish, ejected daemon cannot decrypt,
remaining daemon can.

### `DOD-M16-SUBSTATE-1` ❌ — subscription state, not contacts
Subscriber-side table keyed `agent_id` + channel pubkey (decision 35). Not a contact; not shown in
`cello_contacts`; tier gating does not apply (the join step is the gate). Moniker pattern reused
for a local channel nickname on the subscription row.

---

## Tier 3 — Delivery

### `DOD-M16-RELAY-1` ❌ — relay broadcast frames, rate-limited at birth
Deposit, fetch, and range-fetch frames. The relay stores and forwards, opens nothing, holds no
delivery state — TTL retention only (decision 12: relays stay stateless). **Load-bearing clause:
every one of the three paths has a per-peer limiter in the same story that creates it.**

### `DOD-M16-POLL-1` ❌ — the daemon collects on a schedule
The daemon, not the agent, fetches (decision 11). Jitter derived deterministically from the
subscriber's own pubkey (decision 16); backoff on quiet channels bounded by the TTL. **Load-bearing
clause — the silent coupling made loud:** the poll interval must be shorter than the shortest
subscribed TTL, checked at subscribe time and config change, with a WARN event when violated.
Three agents on one daemon subscribed to one channel = one fetch, three local readers.

### `DOD-M16-TURN-1` ❌ — no doorbell; turn-boundary delivery; two positions
Broadcasts never ring. Content is local when the turn boundary arrives; the agent picks up a batch
between turns. `delivered_through` advances on fetch, `processed_through` advances only when the
agent reads (decision 7) — because a read that mutates state cannot be retried and agents lose
context constantly. **Enforcer:** kill the agent process between fetch and read; on restart the
batch is re-presented, nothing lost, nothing double-processed.

### `DOD-M16-SCREEN-1` ❌ — the injection screen covers broadcast
Bodies, titles, AND join-time notification guidance pass the same inbound screen as session
messages, at the subscriber's daemon, before anything reaches agent context (decision 33). One post
lands in N agent contexts — this is the highest-leverage injection vector in the system.
**Enforcer:** a live publisher sends a screening-corpus payload as a broadcast; the subscriber's
screen blocks it and emits `channel.screen.blocked`.

### `DOD-M16-TITLE-1` ❌ — titles as a validated first-class field
Plain UTF-8, control characters rejected, 200-character cap, validated at the receiver (and at
publish for UX) — receiver-side because that is the only path-independent layer (decision 25).
Titles are load-bearing for digests and notification rules.

---

## Tier 4 — Repair and integrity

### `DOD-M16-GAP-1` ❌ — gap detection, interior and tail
Interior gaps from sequence numbers; **tail gaps from the directory-registered high-water mark**
(decision 13) — silence is otherwise indistinguishable from nothing-was-sent.

### `DOD-M16-REPAIR-1` ❌ — subscriber-initiated repair through the relay
Subscriber reports a missing range to the publisher; the publisher re-parks that range on the relay
**once**; every subscriber missing it fetches there (decision 16). No per-subscriber delivery state
anywhere (decision 14), no separate repair API — the recipient-signed pull carries a range.
**Enforcer:** the milestone smoke test below kills the relay mid-stream and proves this path.

### `DOD-M16-RETAIN-1` ❌ — relay retention, operator-capped
Publisher-declared TTL within the relay operator's cap; defaults 72h live / 7-day cap / 30 days for
sealed epochs (decision 23). **Sealed epochs outlive live content** (decision 15) — the hedge
against publisher unavailability during repair.

### `DOD-M16-SUPERSEDE-1` ❌ — supersede semantics, minimal
The daemon marks the earlier sequence superseded and delivers both; the agent sees the replacement
relation (decision 24). No revoke, no delete.

### `DOD-M16-EQUIV-1` ❌ — equivocation and consistency, demonstrated not asserted
The differentiating claims, proven live with a rigged adversary — never a lesser variant: a
modified publisher issues two different validly-signed messages under the same sequence number to
two subscriber daemons; comparing artifacts detects the fork pre-seal, and comparing notarized
roots proves it post-seal. A rewritten epoch fails the consistency proof. **Enforcer:** this rigged
run, as separate OS processes, output quoted.

---

## Tier 5 — Surface and dogfood

### `DOD-M16-TOOLS-1` ❌ — the MCP tool surface
Create, publish, subscribe, approve, eject, list, read, request-seal — names and parameters
specified before implementation (Architecture phase), self-describing like the rest of the
`cello_*` surface. The inbox shows a digest — counts and titles per channel — without opening
bodies.

### `DOD-M16-GUIDE-1` ❌ — notification guidance and subscriber-side rules
Guidance stored per subscription and surfaced to the agent; publisher-declared urgency is advisory
input to a rule the subscriber owns (decision 5). Simple standing rules expressible over titles
("URGENT from this channel wakes me").

### `DOD-M16-DOGFOOD-1` ❌ — one real channel, used for real
The CELLO-operated announcements channel exists on production infrastructure, Andre's own agents
subscribe, and at least one real coordination message reaches two subscriber daemons — the fleet
coordination case that motivated the entire design. Not a test harness; the actual channel.

---

## Milestone close gate

No close without the **live multi-process smoke test**: publisher daemon, relay, dev directories,
and two subscriber daemons as separate OS processes on at least two machines —

1. Channel registered; two subscribers join (one open-admit, one approved).
2. Publish through an epoch seal; both subscribers verify inclusion against the notarized root.
3. Kill the relay mid-stream; restart; both subscribers detect the gap (one interior, one tail) and
   repair through one re-park.
4. Eject one subscriber; re-key; prove decrypt fails for the ejected, succeeds for the remaining.
5. A screening-corpus broadcast is blocked at the subscriber.

Vitest green ≠ done. The run output lands in the build journal.

---

## POST-M16 BACKLOG

Findings captured during the milestone that do not make an existing line false and did not trip
the severity screen (M16-PROCEDURE §5a). Each entry: the five journal lines, the planner's one
line of reasoning, the triage date. Real, worth doing, not this milestone. Triaged after close.

*(empty at open — and the goal is that it grows while the tiers above do not)*

---

## Related Documents

- [[2026-08-23_1933_broadcast-channels-conclaves-and-encrypted-discovery]] — the design source;
  decisions 1–35 are settled there
- [[M15-DEFINITION-OF-DONE]] — the launch gate this milestone sits outside; the relay rate-limiting
  and injection-screening lessons M16 inherits at birth
- [[M8C-MONIKER-SPEC]] — the moniker pattern reused on subscription rows
- [[protocol-map]] — broadcast becomes a new protocol domain
