---
name: M15 Build Journal
type: build-journal
date: 2026-08-21
milestone: M15
status: open
topics: [m15, hardening, pre-launch, security, build-journal]
description: >
  Append-only audit trail for M15 (pre-launch hardening). Entries at END OF FILE only; the RESUME
  STATE block at the top is the only thing overwritten in place. Full proofs, reviewer verdicts,
  measurement output and claims-ledger flips live here — the DoD stays a scoreboard.
---

# M15 Build Journal

## RESUME STATE (overwrite in place — the ONLY mutable block)

> ### 🟢 TIER 0 CLOSED. Tier 1 and Tier 2 are both open and have no dependency on each other.
> **49 DoD lines**, 1 ✅ (`DOD-M15-SPIKE-1`), 1 🅿️ (`DOD-M15-SWEEP-1`, sequencing only), rest ❌.
> Every line is inside the launch gate; the gate is a state, not a date.

- **NEXT ACTION: `DOD-M15-DIVERGE-1`** (Tier 2) — the cheapest line in the milestone. Acts on
  signals that already exist, no wire dependency, and starts catching transcript divergence before
  Tier 4 lands. `cello-client`, branch `m15/diverge`.
- **Then either** `DOD-M15-FRAME-1` (the injection path — the worst-looking finding in the
  milestone) **or** `DOD-M15-LEDGER-1` + `DOD-M15-AUDITME-1` (Tier 1, no dependencies, and
  `AUDIT-ME.md` is at the root of a public repo).
- **Spike answers that re-scoped lines → Entry 1:** step-6 directory auth IS active in production
  (`DOD-M15-DIRAUTH-1` does not escalate); both relays accept all three directories (the feared
  single-directory dependency does not exist); relay selection is effectively deterministic at 99:1
  (`DOD-M15-MULTIRELAY-1` is availability only, linkability claim withdrawn).
- **Live agents available for enforcer runs** (Andre, 2026-08-21): `CELLO_Coder_1` and
  `CELLO_Support` (`f8d518ca0b5596fd0f383f17f03560975ea210a763249b342fd767bd067c2f3c`) locally;
  `Miss_Chelly_H` on the Hermes EC2 instance for a genuinely different device. No pre-auth tokens
  needed. **Check for open sessions before any sealing proof.**
- **HEAD commits:** trustless-cello `main` — see `git log`; cello-client `main` — see `git log`.
- **Published versions:** unchanged; no M15 publish has occurred.
- **Parked:** `DOD-M15-SWEEP-1` (sequencing: after `DOD-M15-FRAME-1` and Tier 4).
- **Claims ledger:** seeded with 9 rows in the DoD; not yet swept (`DOD-M15-LEDGER-1`).

---

## How to write an entry (delete this block once Entry 1 exists)

**Append at END OF FILE. Never prepend, never insert.** Then verify the write landed
(`grep -c "^## Entry N"` or read the tail). The RESUME STATE block above is the only thing
overwritten in place. Chronological order is not worth a lost entry — an out-of-order number at EOF
is fine.

An entry heading is `## Entry N — <DoD line or subject> (YYYY-MM-DD)`. What belongs inside:

- **Target** — one sentence of observable behaviour, plus the DoD line expanded into a clause
  checklist (every clause, verbatim). That checklist is what the reviewer receives.
- **The counterbalance** — one sentence, written BEFORE the code, naming what makes the fix hold
  when the peer has rewritten their own daemon (M15-PROCEDURE §2b, Invariant 1). A unit with no
  answer here is not ready to build.
- **What was found / what was built** — with file paths and measured numbers, not adjectives.
- **Gate output** — the exit codes, run so they could have failed (§7).
- **Reviewer verdict, QUOTED** — finding count and disposition, in the reviewer's own words. Without
  this the unit stays 🟡 and the DoD tag does not flip.
- **Enforcer run output** where the DoD line names one — the actual run, as separate OS processes,
  not a claim that it passed.
- **Claims-ledger flips** — any row that moved to made-true, withdrawn, or disclosed-as-bounded.
- **Anything parked**, with its trigger.

---

## Entry 0 — Milestone setup (2026-08-21)

M15 stood up on Andre's ruling the same day, after two investigations landed within hours of each
other and the open items on [[launch-triage]] made the same argument a third way: the work is not
scattered feature debt, it is one milestone about the gap between what CELLO claims and what it
delivers. **Every item gets built. M15 decides order, not selection.**

**What exists as of this entry:**

- [[M15-PROCEDURE]] — self-contained runbook. §0z states the gate; §1c defines the three enforcers
  (stranger · receipt · journey); §1d defines the claims ledger; §2b carries the four invariants
  this milestone installs.
- [[M15-DEFINITION-OF-DONE]] — 49 status-tagged lines across six tiers, all ❌ except
  `DOD-M15-SWEEP-1` (🅿️ on sequencing alone). Tier 0 is the verification spike; Tier 1 claims;
  Tier 2 the doors and the detections that must act; Tier 3 basic value delivery; Tier 4 encryption
  then the seal wire change; Tier 5 abuse controls, relay redundancy and infrastructure. Carries
  twelve Decisions Carried, an Explicitly Beyond section where every deferral has a trigger, and
  the claims ledger with eight seed rows.
- This journal.

**The four invariants, recorded here because they outlive M15** (full text in M15-PROCEDURE §2b):

1. **Counterbalance.** The client is open source and runs on the adversary's machine, so a guard
   that executes only on the party it constrains is a request, not a guard. Moving the check to the
   other side is necessary and not sufficient — their daemon is rewritable too. The goal is a
   structure where the adversary's own necessary actions commit them. Worked example: each agent
   verifies the counterparty's signature on every inbound message, and because the transcript is a
   chain, their act of sending locks in what *you* said. Neither side can repudiate without
   abandoning the exchange. **Every unit names its counterbalance before the code.**
2. **Fail loudly — and loud is not blocking.** Most failures fail loudly and may continue; what is
   never right is failing quietly. Three requirements: a warning reaches the **log AND the agent** —
   both, never one instead of the other, because the log is the durable forensic record and the
   agent-facing response is the control, and a detection whose only consumer is a log line or a
   status string changes no behaviour (**never delete a log line to satisfy this**); a **security**
   failure is loud **and blocks** (a signature that fails against the expected counterparty means
   possible impersonation — announce and stop, session-ending, worded as an observation and never as
   a verdict); and **missing, malformed and mismatched collapse into one path**, because an attacker
   evading a mismatch check simply supplies no proof at all.
3. **The upstream cause survives downstream.** Errors name their cause, not their exit point, and a
   downstream handler never overwrites an upstream descriptive error with a generic one. Wrapping
   adds context; replacing destroys signal. Measured instance: one string, `counterparty_offline`,
   returned for three unrelated faults on 2026-08-16, naming a party that was online in all three
   and nothing that was broken.
4. **Responses carry affordances.** Every status, result or error reaching an LM is read by
   something that must decide what to do next. Where one or two obvious paths exist, name them in
   the payload — the real verb, the real parameter. A refusal especially needs one.

**Spec-of-record:** [[2026-08-21_1906_relay-p2p-exposure-and-ephemeral-peer-id-audit]] (seven ruled
Design Decisions; 39 items collapsing into 18 units with dependencies) and
[[2026-08-21_1135_tofn-decoupling-and-seal-integrity-gaps]] (seal-ceremony gaps; four ruled
decisions). Stream 3's source is [[launch-triage]] — read its header warning before trusting any
status marker on it.

**The spine, stated once so no unit has to rediscover it:** one pattern, six known instances — an
identity or integrity proof is computed, evaluated correctly, and then not acted on, with a nearby
comment asserting the property the code does not enforce. Fixing instances individually leaves the
next one to be found later, which is why the sweep is a named deliverable and not a cleanup task.

**Decisions carried into the DoD (Andre, 2026-08-21):**

- **EVERY item in M15 is inside the launch gate, and the gate is a STATE, not a date.** Launch
  happens when M15 closes, however long that takes. No fast-follow tier, no subset, no cut list —
  the two items argued as trackable (relay abuse controls + Cloud Armor, and the
  checked-then-ignored sweep) are in. DoD tiers therefore encode **dependency order only**: there is
  no within-tier prioritisation and nothing is ever descoped for time. This closes the commonest
  decision theatre available on a hardening milestone — an item's presence in the DoD *is* its
  launch-blocking status, so there is nothing to relitigate.
- **The seal wire change is INSIDE the launch gate.** Ruled on the migration argument, not the
  security one: no working attack against the seal was demonstrated, and a wire + schema change is
  cheapest against an empty database and never gets cheaper. Consistent with Decisions 1 and 6 in
  the spec-of-record. **This pulls the application-layer content encryption in with it** — the seal
  change consumes the per-session hash salt that the key agreement produces, and the seal items
  cannot be split, so the per-session ephemeral handshake with its PQ hook is gated too. Largest
  coupled pair in the milestone; both in.

**First action:** the live-deployment verification spike (M15-PROCEDURE §4.1) — three questions that
cannot be answered by reading source and that re-price other units. Hours, no code, before anything
else is scoped.

---

## Entry 1 — DOD-M15-SPIKE-1: what the live deployment actually does (2026-08-21)

**Target:** answer the three questions that cannot be answered by reading source, and re-scope the
lines each one touches. No code, no branch, no diff — **and therefore no unit review**; the evidence
is quoted below and every command is independently re-runnable.

### (a) Directory authentication IS active in production — `DOD-M15-DIRAUTH-1` stays hardening

The discriminating pair is in `core/daemon/src/manifest-deps.ts`: `daemon.manifest.bundled` (step-6
ENABLED) versus `daemon.manifest.bundled.skipped` (step-6 DISABLED, with `reason:
directory_not_in_bundled_roster`).

Measured on the live daemon log (`~/.cello/daemon.log`, 142 MB, back to 2026-08-17):

```
daemon.manifest.bundled          115
daemon.manifest.bundled.skipped    0
```

Most recent, 2026-08-21T02:15:12Z:
`{"event":"daemon.manifest.bundled","version":2,"nodeCount":3,"rootKeyCount":1,"threshold":1}`

**The byte-match workaround is holding.** `PRODUCTION_DIRECTORY_URL` is the raw address
`http://34.75.172.108:9090` precisely so it matches a bundled endpoint byte for byte, and it does —
every daemon start in the log took the enabled branch and not one took the skipped branch.

**Re-scope:** `DOD-M15-DIRAUTH-1` does **NOT** move into a higher tier. The fail-open is real and
still gets fixed (a DNS name for the same host silently disables the defense, and the bootstrap
coordinate still comes from plaintext HTTP on 9090) — but the production client is authenticating
the directory today. This is the *only* one of the three answers that could have escalated a line,
and it did not.

### (b) The relay accepts all three directories — the feared single-directory dependency does NOT exist

`packages/relay/src/bin/relay.ts:238` already logs the answer at startup, by design:
`relay.startup.consortium-directories { count, anyDirectory }`. A forgotten
`CELLO_DIRECTORY_PUBKEYS` would show `count: 1, anyDirectory: false`.

Read from Cloud Logging across both relay instances, every restart back to 2026-08-17:

```
2026-08-19T18:19:51Z  count=3  anyDirectory=True
2026-08-19T18:16:26Z  count=3  anyDirectory=True
2026-08-19T13:19:49Z  count=3  anyDirectory=True
2026-08-19T13:16:40Z  count=3  anyDirectory=True
2026-08-19T06:19:02Z  count=3  anyDirectory=True
2026-08-19T06:16:18Z  count=3  anyDirectory=True
2026-08-19T05:14:29Z  count=3  anyDirectory=True
2026-08-18T20:46:38Z  count=3  anyDirectory=True
2026-08-18T20:45:50Z  count=3  anyDirectory=True
2026-08-17T11:23:11Z  count=3  anyDirectory=True
```

Two distinct instance ids appear throughout, so this is both relays and not one repeatedly.

**Re-scope: a clean negative, and it removes a risk rather than adding work.** A session brokered by
any of the three directories is usable. `DOD-M15-SPIKE-1(b)`'s worry — a value-delivery fault hiding
inside a security item — is not present. **What survives into `DOD-M15-RELAYABUSE-1` as a small
clause:** an empty key set still *degrades silently* rather than refusing to start. The config is
right today; the failure mode that would hide it being wrong tomorrow is not fixed. Make an empty
set fatal at startup.

### (c) Relay selection is NOT random, and Decision 7's mitigation does not hold as things stand

The mechanism is not what either hypothesis assumed. `#reservationCircuitAddrs`
(`core/daemon/src/session-node-manager.ts:8183`) does **not** pick a relay — it merges the
directory's auth-time relay pool with persisted endpoints, dedupes by relay peer id, and hands
libp2p **every** resulting `/p2p-circuit` address. Confirmed live: `reservationsRequested: 2`, with
both relay peer ids listed.

So the client asks both. **The outcome is nonetheless effectively deterministic** — across 2,675
`session.standing_receiver.reservation.lost` events in the live log:

```
12D3KooWJXHpnWQhGk3jXBJYdXMmeLxEhRqzwZCYd1bxSUh4pg83   2648   (99.0%)
12D3KooWFpvG5ksTBoiMCfyy3n126AtpFNYGXB14R2335DAf1BYt     27   ( 1.0%)
```

and the `relayPeerIds` array is in a stable order, `pg83` first, on every sample.

**Andre's assessment was right — selection is not random — though not for the reason predicted.** It
is not that the client chooses one relay; it is that both are requested and **one carries 99% of the
reservations in practice.** For linkability purposes the distinction does not matter: that relay
sees a continuous per-agent handle.

**Re-scope, and this is the one answer that changes a decision:**
- `DOD-M15-MULTIRELAY-1` delivers **availability only**. Decision 7's claim that spreading
  reservations erodes the long-lived per-agent handle **does not hold as things stand**, so per its
  own terms the fork is: make selection actually spread, or **withdraw the linkability claim**.
- **Ruling (§3a, least likely to need reversing): WITHDRAW the claim now, and treat "make it spread"
  as an improvement rather than a mitigation we are relying on.** Reasons: the fleet is two relays,
  where Decision 7 already conceded the mitigation is "technically true and weak"; and a disclosed
  bounded property is honest whether or not spreading later works, whereas a claim resting on
  behaviour we have now measured as 99:1 is a claim we would be making on hope. `DOD-M15-DISCLOSE-1`
  gains the row; `DOD-M15-MULTIRELAY-1` keeps its availability rationale, which is untouched and
  still worth building.

### Bonus finding, recorded because it was measured and nobody asked for it

The reservation churn is severe: **2,675 lost, 664 `reservation.none`, 88 retries, 9 `gave_up`** on
one daemon's log. `reservation.lost` carries `reason: relay_connection_gone`. An agent whose
reservation is gone is **unreachable by any NAT'd peer while still looking perfectly healthy** —
which is exactly the silent-loss-of-inbound failure `DOD-NAT-REACHABILITY-1` was built to kill.

**Not chased here** (a spike answers its three questions and stops), but it is a real signal and it
belongs to a line: added as a clause on `DOD-M15-MULTIRELAY-1`, whose whole subject is an agent's
inbound reachability resting on relays. Whoever pulls that line starts by explaining these numbers.

### Also recorded: an unblocking from Andre, 2026-08-21

**`DOD-M15-INTERRUPTED-1` is NOT blocked on pre-auth tokens.** Ruling: *"You do not need throw away
agent tokens. Use existing ones."* The proof runs against existing registered agents. The stated
side effect — sealing open sessions — is managed by choosing agents that hold none, checked before
the run rather than assumed. The line's park is removed and it is a normal Tier 3 unit.

**Commands, so this entry is checkable rather than believed:**
```
grep -c 'daemon.manifest.bundled"' ~/.cello/daemon.log
grep -c 'daemon.manifest.bundled.skipped' ~/.cello/daemon.log
gcloud logging read 'jsonPayload.event="relay.startup.consortium-directories"' \
  --project cello-infra --limit 10 --freshness=30d \
  --format="value(timestamp,resource.labels.instance_id,jsonPayload.count,jsonPayload.anyDirectory)"
grep '"session.standing_receiver.reservation.lost"' ~/.cello/daemon.log \
  | grep -o '"relayPeerId":"[^"]*"' | sort | uniq -c | sort -rn
```

**Next:** `DOD-M15-DIVERGE-1` — the cheapest line in the milestone, no wire dependency, starts
catching transcript divergence immediately.

---

## Entry 2 — DOD-M15-DIVERGE-1: clause checklist and counterbalance, before the code (2026-08-21)

**Target:** a session whose local tree has provably parted from the relay's counter **cannot be
sealed**, and the operator is told why in the response — instead of the condition reaching only the
text `cello status` prints.

**Branch:** `m15/diverge` (cello-client). **Enforcer named by the line:** receipt.

### Clause checklist (from the DoD line, expanded)

1. Local/relay leaf divergence is **already detected correctly** on the next send — confirm, do not
   rebuild.
2. It is **already logged at ERROR** — `session.tree.position_behind_frontier`. **The log line
   stays.** (Invariant 2: never delete a log line to satisfy this.)
3. **ADD:** the agent is told in the response.
4. **ADD:** the session is **blocked from sealing**.
5. **ADD:** `sealReadiness` becomes **symmetric** — it must also fail when the local tree holds
   leaves the relay never witnessed.

### What the trace found (producers and consumers, per Debugging Discipline)

**`#diverged`** (`session-node-manager.ts:734`) has exactly one producer and one consumer.

- **Producer, `placeOwnLeaf` :6911** — `assignedSeq < nextExpected`, i.e. an ack came back *behind*
  our frontier. Logs `session.tree.position_behind_frontier` at ERROR with an accurate `impact`
  string, appends at the tail, returns `diverged: true`.
- **Consumer, `sealReadinessView` :6329** — returns `{ state: "unknown", reason:
  "record_diverged_from_relay" }`. **That view's only caller is `daemon.ts:2011`,
  `probeSealReadiness`, which feeds the `cello status` / `cello_status` payload.** Confirmed by
  grep across `core/` — no other reader exists.

So the DoD line's claim is exact: **the detection reaches a status string and nothing else.**

**The symmetry gap, stated precisely.** `sealReadiness.ready = missingLeaves === 0 && heldCount ===
0`. Both counters measure the *relay-has-that-we-lack* direction. Nothing in `ready` measures the
opposite direction, which has **two** producers:

- `placeOwnLeaf` :6911 — our own send landing behind the frontier (sets `#diverged`).
- `ingestReceivedContent` :6103 — **`session.content.unwitnessed`**: a relay IS attached, the
  sender's leaf should have been submitted and witnessed, it was not, and the content is **logged at
  WARN and ingested anyway**. This is the same checked-then-ignored shape as the rest of the
  milestone, one layer down, and it appends a leaf the relay never witnessed.

`ready` cannot see either. The close gate that consumes it (`close-session-handler.ts:628`) is
correct and well-built — it just cannot be told.

### 🚨 The trap this unit must not fall into

The existing refusal at :628 is `session_incomplete`, and its guidance says *"wait a moment and
close again"* and *"the daemon just pulled from the relay and the gap is still there"*. That is
right for a session waiting on arrival. **It is wrong for a diverged session, permanently** — the
tree and the relay counter can never agree again, so waiting is futile and retrying ends at
`force: true` with no receipt. Folding divergence into `ready` without branching the reason would
substitute a transient explanation for a permanent condition — the exact error-substitution class
this milestone exists to remove, reintroduced by the fix for it.

**So: a distinct reason and distinct guidance, not a shared one.**

### The counterbalance (Invariant 1), stated before the code

**This gate is ergonomics over a check that already happens elsewhere, and that is the honest
answer.** The party it constrains is the operator's own daemon, and an operator who patches it out
harms only themselves: the counterparty's daemon independently recomputes the root and refuses to
co-sign, answering `leaf_count_mismatch`. **That independent refusal is the counterbalance and it
already exists** — it runs on the peer's machine, over the peer's own tree, and no edit to this
daemon reaches it.

What this unit adds is not enforcement but *timing*: today the operator learns at the moment the
refusal becomes terminal and the receipt is already gone; after it, they learn while a retry is
still possible. Recorded plainly so nobody later mistakes this gate for the security boundary — per
Invariant 1, a guard running on the party it constrains is ergonomics, and saying so is the
requirement.

**Next:** red tests against the fixture (`two-connection-fixture.ts`, extended — never a
from-scratch fixture), then implement.

---
