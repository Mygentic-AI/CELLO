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

> ### 🟢 FIVE UNITS MERGED AND REVIEWED. Nothing in flight.
> **57 DoD lines**, 5 ✅, 2 🅿️, rest ❌. Every line is inside the launch gate; the gate is a state,
> not a date. Both repos clean and pushed.
> **`LEDGER-1` and `CLAIM-COMMENTS-1` were reverted to ❌ by review** (→ Entry 14) — the sweep
> shipped incomplete on three of four surfaces, and the completeness it claimed is pinned by nothing.

- **NEXT ACTION: `DOD-M15-CLAIM-SCANNER-1`** — the build check that enumerates claim surfaces from
  the system instead of from a person, then `DOD-M15-CLAIM-COMMENTS-1` (the two comments the review
  found still standing). `SCANNER-1` comes first because it defines what "swept" means, and
  `LEDGER-1` cannot be re-closed until something other than a grep vocabulary pins its completeness.
- **`DOD-M15-AUDITME-1` is 🅿️ parked — Andre's call, 2026-08-22.** It is now the LAST Tier 1 line,
  not the next one, and not before Tier 4 lands. The repo is public but **unadvertised**: nobody is
  reading it, so the exposure is theoretical, while the tree it describes is about to be changed by
  Tier 2 and Tier 4 — writing it now buys a second rewrite. Parked for sequencing only; it is inside
  the gate. **The claims themselves are not parked** — they stay as ledger rows with the disposition
  *pending rewrite*, so `SCANNER-1` does not go red on a file we deliberately deferred.
- **Timing correction for any rate estimate (2026-08-22):** the overnight run lost **4h 50m** to a
  network outage — last activity 00:42:32, resumed 05:32:14, confirmed by the push reflog (every
  commit in this milestone pushed within ~3s, and nothing pushed in that window). Real working time
  for the five merged units is **5h 15m**, not the 10h of wall clock. The 56m gap at 05:33–06:29 was
  a review agent running, not the outage — pushes succeeded on both sides of it.
- **`DOD-M15-SURFACE-1` is ✅** (→ Entries 9, 11) — merged. **SPEC: FAITHFUL, nothing blocking.**
  The reviewer confirmed all five falsification claims plus two I had not checked, and built a
  throwaway test proving a zero-listener node still dials out. Both real findings were prose. **New
  follow-ons:** `DOD-M15-DEAD-WIRE-FIELD-1`, and `DOD-M15-IDLE-CONNS-1` from the split.
- **`DOD-M15-SIGNUP-1` is ✅** (→ Entries 8, 10) — merged. **Two review passes, the hard cap.** The
  first: my rekey removed the only cap on a requester, and my own test pinned the abuse case as
  required. The second: un-shadowing the delivery-layer refusal surfaced it to the person as
  *"Incorrect code"* after a silence — **reachable because of this unit**, so owned by it.
  **Carried:** `DOD-M15-SIGNUP-DURABLE-1`, `DOD-M15-CI-SKIPS-SILENT-1`.
- **`DOD-M15-FRAME-1` is ✅** (→ Entries 4, 6, 7) — merged. Six review findings, three blocking,
  all fixed; verdict quoted in Entry 7. **The worst was my own fix reintroducing the milestone's
  own pattern:** the defensive freeze wrote `interrupted`, which is the REVIVABLE status, so the
  operator's next read silently rebuilt the session and re-admitted the same peer while the log
  said no further content would be accepted. **Carried:** `DOD-M15-FREEZE-STATUS-1` (durable
  status) — F1 fixed the reversibility, which could not wait.
- **`DOD-M15-DIVERGE-1` is ✅** — cello-client `4478a03` + `9f05300`, merged. Ten review findings,
  three blocking, all fixed; verdict quoted in Entry 5. **Two follow-on lines came out of it:**
  `DOD-M15-UNWITNESSED-1` (the two *suspected* partings, one of which the review found and I had
  missed) and `DOD-M15-DIVERGE-DURABLE-1` (the flag is still memory-only across a restart).
- **`DOD-M15-LEDGER-1`: the SWEEP is complete** — all four live surfaces walked, dispositions
  assigned (→ Entry 3 + the ledger section of the DoD). CLI help and status output came back clean.
  **Acting on the rows is other lines' work.** The line itself is 🟡 pending one review pass.
- **Process note worth keeping:** the review's own diagnosis of why its blocking finding shipped —
  *every close-gate test stubs `sealReadiness` and every manager test calls it directly, so nothing
  drove a real manager through a real teardown.* A unit whose tests all sit on one side of a seam
  has not been tested across it.
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
- **Claims ledger:** 13 swept rows + 8 unverified seed rows, in the DoD. Worst row: `AUDIT-ME.md`'s
  Claim 3 says the client makes no outbound HTTP calls beyond directory and relay, and the
  document's OWN command finds `api.telegram.org`. Sweep is partial — see the DIVERGE/LEDGER
  bullets above for what remains.
- **Three patterns worth carrying into every remaining unit**, each earned by a review finding:
  1. **A fixture that has drifted from the real thing asserts a system that does not exist** — an
     away test asserting a diverged tree seals; three fakes delivering frames from nobody; six
     addresses on one domain pretending to be six people.
  2. **Fixing one guard can wake a second one that has never fired.** Un-shadowing a refusal means
     owning how it fails — "it was already there" is not a defence when your change made it
     reachable.
  3. **A revert test that PASSES is only evidence if the mutation landed where you think.** One
     nearly went in the journal as a weak test when it had patched the wrong limiter.

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

## Entry 3 — DOD-M15-LEDGER-1 (partial): AUDIT-ME.md swept, and it fails its own instructions (2026-08-21)

**Target:** sweep the live claim surfaces and give each claim a disposition. This entry covers the
first and most exposed surface — `AUDIT-ME.md` at the root of the **public**
`Mygentic-AI/cello-client` repo. Confirmed public via `gh repo view` (`"visibility":"PUBLIC"`).
Ledger rows are in the DoD; the measurement is here.

**Method: run the document's own verification commands against the tree.** That is what its name
invites an evaluator to do, so it is the only honest way to audit it.

### Row 1 — Claim 3 is false, and the document's own command proves it

> *"The CELLO client makes outbound network connections **only** to the directory node … and to
> relay nodes … There are no telemetry endpoints, analytics beacons, error reporting services, **or
> any other outbound HTTP calls.**"*

Its **command 4**, run verbatim:

```
$ grep -rln "fetch(\|http\.request\|https\.request" core/*/src/
core/daemon/src/telegram-bot-client.ts
```

```
core/daemon/src/telegram-bot-client.ts:27:  const url = `https://api.telegram.org/bot${this.botToken}/getUpdates?…`
core/daemon/src/telegram-bot-client.ts:28:  const res = await fetch(url);
core/daemon/src/telegram-bot-client.ts:42:  const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;
core/daemon/src/telegram-bot-client.ts:43:  const res = await fetch(url, {
```

**Nothing about the feature is wrong.** That is the Telegram doorbell — deliberate,
operator-configured, and the mechanism that reaches a phone. The defect is entirely that a public
document says it does not happen, in a file named AUDIT-ME, discoverable by following that file's
own instructions in about ten seconds. This is the single most Moltbook-shaped artifact in the
milestone and it is a wording fix, not an engineering one.

**Write the replacement FORWARD-SAFE.** `core/gateway/src/detect/deberta-model-manifest.ts:16`
holds `https://huggingface.co/protectai/deberta-v3-small-prompt-injection-v2/resolve/main/` as the
classifier's download base. `installModel` has no production caller, so it is not a destination
today — but it becomes one the moment `DOD-M15-SCREENINSTALL-1` ships. A claim that would have to be
rewritten again then is a claim being written wrong now.

### Row 2 — the miscited evidence

Claim 1 says message content is *"additionally encrypted at the application layer (AES-GCM
envelope)"* and cites `core/client/src/client-backup.ts`. Two problems: live content is **plaintext
inside libp2p's Noise session** (only *parked* content carries an app-layer envelope — relay audit
Part 13), and the cited file is the **database backup** encryption, a different thing entirely. It
also does not exist.

### Row 3 — the document asserts its own correctness and is wrong

Opening paragraph: *"All paths listed are valid."* Measured, 8 cited paths:

```
MISSING core/adapter-claude-code/src/server.ts
MISSING core/client/src/client-backup.ts
MISSING core/client/src/client.ts
MISSING core/protocol-types/src/envelope.ts
OK      core/crypto/src/ed25519.ts
OK      core/transport/src/node.ts
OK      core/transport/src/types.ts
OK      package.json
```

**`core/client/` does not exist at all.** Four of eight, not four of seven — the earlier count
excluded `package.json`. Half the document's evidence cannot be opened.

### Row 4 — a verification command that a CORRECT tree fails

```
$ grep -r "plaintext" core/transport/src/   # document says: should find nothing
core/transport/src/node.ts:      // Noise ONLY — no plaintext. SI-001.
core/transport/src/types.ts:   * Used by tests to verify Noise is present and plaintext is absent (SI-001, SI-003).
core/transport/src/__tests__/node.test.ts:describe("AC-005: Noise-only security (no plaintext)", () => {
… 5 hits
```

Every hit is a comment or a test **asserting plaintext is absent**. The code is right; the
instruction is wrong. This is the document's whole shape in one line: **true claims, proved badly** —
which for a trust product whose evaluators point a coding agent at the repo is worse than publishing
nothing.

### Row 5 — the package it never mentions

`core/daemon/` appears nowhere in a document auditing network behaviour, and the daemon is where
that behaviour now lives — including the one call that falsifies Claim 3. The document predates the
daemon becoming the main surface and was never re-scoped.

### Checked and NOT findings — recorded so they are not re-raised

- `https://code.claude.com` — a doc-comment link in `channel-params.ts`. Not a call.
- `https://hermes-agent.nousresearch.com` — inside an install-hint error string in the CLI. Not a call.
- `docs.cello.dev` — **would** breach the one-domain rule, and appears only inside an illustrative
  comment in `dod-onboard-help-1-tool-parity.test.ts`. Nothing ships it.

### Scope note — this line is NOT done

Four surfaces remain: `README.md`; the five shipped `SKILL.md` files and the receptionist agent; the
MCP tool descriptions; CLI help and product status output. `DOD-M15-LEDGER-1` stays ❌ until each is
walked. **The rewrite of `AUDIT-ME.md` itself is `DOD-M15-AUDITME-1` and is not started** — and per
M15-PROCEDURE §2f the replacement wording is Andre's call, so that unit prepares variants rather
than publishing. Deleting a flatly false claim does not wait; choosing what replaces it does.

---

## Entry 4 — DOD-M15-FRAME-1: confirm-first trace (read-only, pre-implementation, 2026-08-21)

**Why now:** `DOD-M15-DIVERGE-1`'s review is in flight over `session-node-manager.ts`, so this is a
**read-only trace only** — no edits to that file until the review lands and the branch merges. The
trace is what makes the unit mechanical when it is pulled.

**Every claim in the relay audit's Finding 1 is confirmed against the tree, and the evidence is
stronger than the audit stated.** All three frame types live in ONE switch in
`core/daemon/src/session-node-manager.ts`, within about 60 lines of each other. One of them is a
complete, correct reference implementation. The other two are the defect.

### `session_abandoned_notice` (:7807) — THE REFERENCE. Copy this.

```
const expected = this.#activeNodes.get(this.#k(agentName, sessionId))?.counterpartySessionPeerId;
if (!remotePeerId || !expected || remotePeerId !== expected) { … return; }   // peer: absence REFUSED
const claimed = frame["session_id"];
if (typeof claimed !== "string" || claimed !== sessionId) { … return; }      // session: absence REFUSED
```

Both checks collapse missing/malformed/mismatched into one refusal — which is Invariant 2's third
requirement, already implemented, three years of argument settled in two lines. And its comment
**describes the exact attack this milestone is fixing**, in the tree, today:

> *"a session node is a promoted standing receiver, and a standing receiver accepts everyone.
> libp2p's gater runs at connection establishment and does not close connections that already exist,
> so a peer that dialled this node earlier still holds a live connection after `setAllowedPeer`
> narrows it."*

**The codebase already understands the attack and applied the fix to exactly one frame type.** That
is the finding: not ignorance, but an incomplete application — which is why the DoD line says audit
EVERY handler on the protocol rather than the two named ones.

### `content_delivery_ack` (:7795) — NO CHECKS AT ALL

```
if (frame["type"] === "content_delivery_ack") {
  const ackHash = frame["content_hash"];
  const level = frame["level"];
  if (ackHash instanceof Uint8Array && level === "persisted") {
    this.#resolveAwaitingAck(agentName, sessionId, ackHash);
  }
  return;
}
```

No peer check. No session check. A shape test and a string compare. A stranger holding a
pre-positioned connection forges one and cancels the park-on-undelivered timer, so **the operator's
message silently vanishes while appearing delivered.** Confirms audit item 2.

### `content_frame` (:7859) — THE OMISSION BYPASS, exactly as predicted

```
const framedSessionId = frame["session_id"];
if (typeof framedSessionId === "string" && framedSessionId !== sessionId) { … return; }
```

**`&&`, not `||`.** The check fires only when the field is PRESENT as a string — omit it and the
guard passes. Its sibling twenty lines up uses `typeof claimed !== "string" || claimed !== sessionId`
and refuses absence. Same file, same switch, opposite conclusion from the same author's own comment.
And there is **no `remotePeerId` comparison anywhere in this branch.**

### The checked-then-ignored instance, admitted in its own comment

`#recordFrameOrdering` is the real signature check — it verifies the signature and confirms the
signer is the expected counterparty. Its call site:

> *"A bad/absent record is non-fatal: the content still ingests, ordered by the witness stream /
> arrival as before."*

The check runs, returns `null`, and the content is ingested regardless. This is the milestone's spine
pattern with the code stating the property out loud. **It is also why item 3 of the DoD line is
separate from items 1–2:** pinning the frame to the dialing peer does not by itself make the
signature proof a gate, and an attacker who omits `structure1_cbor`/`structure2_cbor` skips the
check entirely rather than failing it.

### What this makes the unit

Largely mechanical, which is the best possible outcome for the worst-looking finding in the
milestone: apply the `session_abandoned_notice` shape to `content_frame` and
`content_delivery_ack`, make `#recordFrameOrdering`'s answer a hard-fail on all three shapes, then
walk every remaining handler on the protocol. The one genuinely new piece is disconnecting
already-attached peers when the gate narrows (`setAllowedPeer`), because libp2p will not do it.

**Not started. No edits made.** Pulled after `DOD-M15-DIVERGE-1` merges.

---

## Entry 5 — DOD-M15-DIVERGE-1: built, reviewed, ten findings fixed, ✅ (2026-08-21)

**Built:** cello-client `4478a03`; **review fixes:** `9f05300`. Branch `m15/diverge`.

### What shipped

`sealReadiness` gained `diverged` as a third term and `ready` accounts for it, so the close gate
that already existed started acting on a fact it previously could not see. The refusal is its own
branch with its own reason (`session_record_diverged`), because the sibling `session_incomplete`
guidance says *"wait a moment and close again"* — right for a session waiting on arrival, wrong for
this one. The ERROR log at the detection site stays; the response is its second half, not a
relocation.

### Reviewer verdict — QUOTED

> **SPEC: DEVIATIONS FOUND** — clause 5 shipped narrower than its text (proven parting only, plus an
> uncovered third producer at `session-node-manager.ts:6904`); clause 4 is not enforced on the away
> one-shot seal path. The clause-5 narrowing is recorded in the commit body and at the code site —
> **not** a silent simplification — but it is not journaled and the DoD line is unamended. [blocking
> until an M15 journal entry + a named follow-on line exist]
>
> **SILENT FALLBACKS FOUND** — HIGH-2: `#diverged` is cleared on every node teardown and never
> persisted, and the read site cannot distinguish "not diverged" from "forgotten", so the gate
> silently reads ready for the whole post-teardown/post-restart `interrupted` population. [blocking]
>
> **ERRORS NAME THEIR CAUSE** — `session_record_diverged` is a cause, not an exit point, and it
> correctly refuses to inherit the transient `session_incomplete` guidance in either direction; both
> directions are pinned by tests. The separate problem is over-claim, not substitution: the refusal
> states a peer-side outcome it never measured and offers force-abandon as the only exit (HIGH-1).
> [blocking on wording]
>
> **TESTS HAVE TEETH** — all three new clauses survive the revert test, and the false-positive cases
> (healthy, in-order, relay-less, `assignedSeq === undefined`) are covered. Two gaps: no test
> exercises the real manager through the real close handler, which is why HIGH-2 shipped; and the
> guidance assertions check prose shape, not the truth of the claim.
>
> **REMOVALS PROVEN**
>
> Not a rubber stamp — the direction of the change is right and the ordering trap the coder called
> out was real and is correctly handled.

**Count: ten findings — HIGH-1, HIGH-2, HIGH-3, MEDIUM-4, MEDIUM-5, MEDIUM-6, LOW-7 … LOW-10. Three
blocking. All ten fixed in `9f05300`; nothing deferred as "acceptable".**

### The three blocking ones, and what each really was

**HIGH-1 — the refusal predicted something it never measured.** It said the two sides *"can never
compute the same root"* and that a seal *"would be refused as leaf_count_mismatch"*. The daemon knows
neither. `#diverged` records a parting between **this tree and the relay's counter**; the bilateral
check compares **leaf counts, not roots** (`seal-flows.ts`: *"Merkle-root agreement is NOT verified
at this leaf-exchange layer"*), and both sides append a behind-frontier leaf **at the tail** — so a
counterparty that skewed the same way still agrees and the seal succeeds. The guidance now states
what was measured, says plainly that it may still succeed, offers comparing counts first, and names
force as the last resort rather than the only exit. **Two new tests assert the absence of the
over-claim**, which is the only way prose assertions can have teeth.

**HIGH-2 — the flag was being forgotten in exactly the population it guards.** `#evictSessionCaches`
deleted it on every teardown, including `destroySessionNode`'s non-sealed path, which writes
`interrupted` — one of the two statuses the gate acts on. It now clears at a terminal status
instead. The reviewer's diagnosis of *why* it shipped is the part worth keeping: **every close-gate
test stubs `sealReadiness` and every manager test calls it directly, so nothing drove a real manager
through a real teardown.** That test now exists and goes red on the old behaviour.

**HIGH-3 — the gate held for the human and not for the machine.** The away one-shot path read
`placed.placed`, discarded `placed.diverged`, and sealed. It now consults readiness and skips, and
**the log is the whole surface there rather than half of it, because no caller is awaiting a
response** — which is Invariant 2 applied, not weakened.

### The test that turned red, and why that was the finding

HIGH-3's fix broke `m8c-away-1`'s relay-path seal test. The cause was in the fixture: it called
`ingestReceivedContent` for two inbound messages **without ever submitting their hashes to the
relay**, so the tree ran ahead of the relay's counter and the session diverged — twice, with
`session.tree.position_behind_frontier` firing at ERROR both times (`assignedSeq 0 / nextExpected 1`,
then `assignedSeq 1 / nextExpected 3`) — **and then sealed anyway.**

**The test had been asserting that a diverged tree completes a seal**, which is precisely the
outcome `placeOwnLeaf`'s comment calls the riskiest append in the codebase. In production the
counterparty's daemon submits every message it sends, so the relay's counter is already past an
inbound message when this side appends it. Submitting first restores that shape: the divergence
disappears entirely and the seal initiates on the relay path, so the test now exercises the healthy
path it always claimed to. Two assertions pin that it stays healthy.

### Corrections to my own earlier record

- **Entry 2's counterbalance was mis-stated** (review MEDIUM-4). I wrote that the peer independently
  refuses to co-sign *"a root it cannot reproduce"*. The peer never reproduces a root — it compares
  **leaf counts** and signs its own root. The honest form: *the peer independently compares leaf
  counts, which catches the unequal-length shape and not an equal-count divergence; root agreement is
  checked later at the FROST step against the directory-held tree.* **This matters beyond wording:
  the equal-count case is exactly where a client-side gate carries real weight, and it is the case
  `DOD-M15-DIVERGE-DURABLE-1` leaves best-effort.**
- **A third producer of clause 2's text existed and I missed it** — `assignedSeq === undefined`, the
  relay-degraded own-send. Now `DOD-M15-UNWITNESSED-1(b)`.

### Two questions the reviewer put to Andre — decided under §3a, logged, not blocked on

1. **Should a session diverged from the RELAY be blocked at all, given the bilateral check is on leaf
   count?** **Yes.** The relay's leaf list is what the directory notarizes, so a tree parted from it
   cannot produce a matching certificate — and `DOD-M15-SEALWIRE-1` makes that comparison explicit,
   at which point this becomes strictly correct rather than merely prudent. The asymmetry decides it:
   a wrongly-blocked session still has `force`, while a wrongly-allowed one loses the receipt
   terminally. Least likely to need reversing.
2. **Durable now, or ship knowingly best-effort?** **Best-effort now, durable next.** The in-process
   hole is closed; the restart hole needs a column and is `DOD-M15-DIVERGE-DURABLE-1` with its
   trade stated at the declaration site, the way `frontier-mismatch.ts` states its own. The guidance
   no longer promises a retry answers identically, which was the sentence the restart hole falsified.

### Gate — run so it could fail

```
daemon + monorepo   exit=0   3997 passed | 11 skipped (4008)
lint                exit=0
tsc --build --force exit=0
build               exit=0
```

**Toolchain repair, unrelated to the change:** the first test run died on
`Cannot start service: Host version "0.27.7" does not match binary version "0.28.1"`.
`@esbuild/darwin-arm64@0.27.7`'s `bin/` was **empty** in the pnpm store, so esbuild's shim found the
0.28.1 binary and refused. `pnpm install` wanted to purge all nine projects' modules without a TTY,
which is far too blunt — the package was restored in place instead. Not a code defect; recorded
because it will recur on a fresh clone.

**DoD amended, follow-ons named, tag flipped ✅.**

---

## Entry 6 — DOD-M15-FRAME-1: built in three parts — REVIEW IN FLIGHT, tag stays 🟡 (2026-08-22)

**Branch `m15/frame`, commits `4015c7f` (gate + signer), `15a960a` (eviction), `551930b` (tests).**
Gate: 4001 passed, lint, forced typecheck, build — all run so they could fail. **Not merged; the tag
does not flip until the reviewer's verdict is quoted.**

### The counterbalance, before the code (Invariant 1)

**Unlike `DOD-M15-DIVERGE-1`, this one is a real boundary rather than ergonomics.** The check runs on
the RECEIVER's daemon and constrains the SENDER, who is a stranger — they cannot patch the code that
refuses them, and no edit to their own daemon reaches ours. That is the shape Invariant 1 asks for.

The honest caveat is the mirror image, and it is why this unit does not stand alone: **the party best
placed to detect a wrong signer is also a party that can be compromised**, and a compromised receiver
could weaponize "signature mismatch" as a false accusation. So the response is split. Freezing what
THIS daemon trusts is always safe unilaterally — it limits only us and harms nobody. Asserting on the
record that a counterparty misbehaved is NOT done here, and needs corroboration from a party the
accusing client does not control: `DOD-M15-CORROBORATE-1`, where the relay holds the sender's signed
hash independently and never routes it through the receiver.

### Part 1 — one gate, above the dispatch

`session_abandoned_notice` already had both checks, correct and complete. `content_frame` had a
session check that fired only when the field was PRESENT (`&&`, where its sibling twenty lines up
used `||`), and no sender check at all. `content_delivery_ack` had neither — a shape test and a
string compare.

**Shared rather than copied, and that is the design decision worth attacking.** Copying the pattern
into two more branches fixes today's three frame types and leaves the fifth — added later by someone
who did not read the comment — unguarded again. Above the dispatch the guard is the DEFAULT: a new
frame type is protected by construction and has to opt out visibly.

**The "audit every handler" clause is satisfied by ENUMERATION, not by inspection of the two named.**
`grep` for senders on `CELLO_CONTENT_PROTOCOL_ID` returns exactly three, and all three carry
`session_id`. That is what makes a shared required-field gate safe rather than a guess.

### Part 1b — the signer check stops being advisory

`#recordFrameOrdering` returned `null` for six different reasons and the caller ingested regardless.
Two of those six are **proof that the signer is not who this session is with**. It now returns
`{ seq, fatal? }`, and the split follows Invariant 2 exactly: **position may be soft, identity may
not.**

- **Fatal:** `bad_signature`, and `signer_not_counterparty` when the counterparty is known.
- **Soft:** `malformed`, `hash_mismatch`, `counterparty_unknown`, decode-throw, absent record.

The fatal `signer_not_counterparty` case is the **session-open MITM detection** from the T-of-N
investigation, which found this check *"fires correctly, and its answer is thrown away."* A rogue
quorum of the directories holding shares for B can sign a false `SessionAssignment` naming M's key as
B's; everything downstream is genuinely real, because M signs with M's own valid key, and nothing is
missing for A to notice. **This comparison is the one place the substitution shows**, because
`counterparty_pubkey` comes from A's own request and is untouched by anything the directory returns.

An ABSENT record stays soft deliberately — that is the documented relay-degraded path, and refusing
it would make the relay a precondition for reading mail.

### Part 2 — the foothold, not just what it sends

`setAllowedPeer` sets the list libp2p consults *when a connection is established*. It does not evict.
A stranger attached to the open standing receiver is still attached after promotion. Part 1 refuses
their frames; part 2 removes them, so they are not sitting there when the next protocol activates.

Relay peers are exempt: they are on the outbound allowlist because reservation refreshes ride them,
and hanging one up would cost the agent its inbound reachability to remove a peer that cannot speak
the content protocol anyway. Best-effort by construction — a failed hangup must not fail a session
setup mid-flight, and the frame gate is the load-bearing control regardless.

**A structural parity test caught what I had missed.** `msg-022` scans establishment for calls and
asserts revival makes the same ones; it went red on the new sweep. Worth checking rather than
exempting on sight — and revival turns out to build a fresh node behind a gater that is narrow from
birth, so no connection can predate the narrowing. Exempted with that reasoning recorded, not waved
through.

### Three test fakes were testing a transport that does not exist

`CelloNode.handle` is `(stream, remotePeerId)`; `node.ts` supplies
`connection?.remotePeer?.toString()`, the Noise-authenticated identity. Three fakes declared
single-argument handlers, so every frame they delivered arrived from nobody — invisible while nothing
checked it.

**The falsification that mattered before trusting the gate:** is `remotePeerId` ever legitimately
absent on a real inbound content stream? If so this breaks all messaging. The decisive evidence is
that `session_abandoned_notice` **already** refuses on `!remotePeerId`, in production, and abandon
notices work. The fakes were the gap.

### One clause NOT met, carried rather than claimed

The freeze's status is **not** distinct from an ordinary teardown: `destroySessionNode(..., "error")`
writes DB status `interrupted`, the same row a counterparty-gone teardown writes. The sessions table
has no reason column and adding one is a client-side migration — unrecoverable on an operator's
machine if it fails — so it belongs in its own reviewed unit with an upgrade test against a populated
database, not riding inside a security fix. **`DOD-M15-FREEZE-STATUS-1`.**

### Teeth, verified rather than asserted

Revert test: peer check disabled and the session check returned to its old `&&` form → the stranger
case, the omission case, and the forged-ack case all go red. Restored → 19 pass. The omission case
needed a hand-built frame, because `sendContent` always sets `session_id` and could never produce it
— **the only code that could express that case was an attacker's, which is exactly why it survived.**

**Next:** the reviewer's verdict, then fix every finding, quote it, flip the tag, merge.

---

## Entry 7 — DOD-M15-FRAME-1: reviewed, six findings fixed, ✅ (2026-08-22)

**Built `4015c7f` + `15a960a` + `551930b`; review fixes `497cfa4`.** Gate: 4006 passed, lint, forced
typecheck, build.

### Reviewer verdict — QUOTED

> **SPEC: DEVIATIONS FOUND** — "session-ending, not per-message" (F2) and "one hard-fail path" as
> applied to the ordering record (F3) are un-journaled. `[blocking]`
>
> **SILENT FALLBACKS FOUND** — F1 (the freeze silently reverses on the next read) and F3 (a frame
> with no identity proof ingests with no log). `[blocking]`
>
> **ERRORS NAME THEIR CAUSE** — `session.content.identity.frozen` names the cause and not the exit
> point… No exit-point substitution anywhere in the diff. The one defect is that the frozen
> message's *second clause* is untrue as shipped (F1), which is a correctness bug in the message,
> not a substitution.
>
> **HOLLOW TESTS FOUND** — the entire `fatal` / freeze mechanism has zero coverage and survives
> deletion with a green suite. `[blocking]`
>
> **REMOVALS PROVEN**
>
> I do not think I am rubber-stamping this: the diff touches persistence, crypto and transport
> gating, and the two findings I would most expect to hide there — a status that quietly reverses a
> security decision, and a signed proof the attacker can decline to supply — are both present.

**Six findings. Three blocking. All fixed; nothing deferred as acceptable.**

### F1 — the fix reintroduced the class the milestone exists to remove

The freeze tears the node down; a teardown writes `interrupted`; **`interrupted` is the REVIVABLE
status.** So `reviveIfNeededForRead` fired on the operator's next `cello_receive`, rebuilt a node
behind a gater allowing the *same* peer, flipped the row to `active`, and logged a success — while
the freeze's own line said *"no further content will be accepted on this session."*

**A security decision that silently reverses itself, under a message asserting the opposite.** That
is worse than the hole the freeze was added to close, and it is exactly the shape this milestone
hunts. `reviveSessionNode` now refuses a frozen session by name, and the message says what is true.

**Also worth keeping:** in the MITM case the code's own comment describes, the attacker who tripped
the freeze needed only to omit the ordering record on the next frame (F3) to be ingested normally.
The two blocking findings compounded.

### F2 — the clause says session-ending; peer-ending is right, and it is a DEVIATION

The DoD says the refusal is session-ending. Applied at the peer gate that would be a **worse hole**:
a pre-positioned stranger could kill any session on the machine with one frame, trading an injection
hole for a denial-of-service hole. So the refusal is **peer-ending** — the connection goes, the
session does not — and the session-ending response stays where the evidence is about the session's
counterparty, at the identity freeze.

**Recorded as a deviation rather than quietly implemented**, which is the reviewer's actual
requirement: *"I do not think you should end the session here… But the divergence from the written
clause has to be a stated decision, not an omission."*

### F3 — the MITM check was opt-in for the attacker, and my comment said otherwise

The ordering record is consulted only when present, with no `else` and no log. A party that passed
the peer gate — which in the session-open MITM they do, because M *is* the peer we dialled — omits
`structure1_cbor`/`structure2_cbor` and is ingested silently.

**My comment claimed *"this comparison is the one place the substitution shows"*, which asserted a
property the code does not have.** It shows only when the substituting party chooses to supply the
proof. Absent records still ingest — refusing would make the relay a precondition for reading mail —
but the weaker guarantee no longer looks identical to the stronger one, and the comment now says so
and points at `DOD-M15-CORROBORATE-1` for the rest.

### F4, F5, F6

**F4:** the eviction sweep was serial and unbounded on an **attacker-controlled** count, inside
session establishment — N connections to an advertised receiver meant N sequential graceful closes
before every later setup. Now concurrent, capped at 32, with the truncation **logged**, because a
silent cap reads as "swept everything".

**F5:** the parity test's exemptions were checked in one direction only, so deleting a step left a
dead exemption carrying a written reason. Adding the inverse check **immediately found four** —
`#recordRelayAssignment` (no call site anywhere in the manager), `#maybeAutoAcknowledgeSeal`,
`#getUnreadReceivedCount`, `#getReceivedBytesTotal`. Removed.

**F6:** the test rebuilt an encoder that matched production on the byte fields and differed on
`useRecords`. Now imports the production `encodeCbor`, so the question cannot recur.

### The gap that let all of this through

> the entire `fatal` / freeze mechanism has zero coverage and survives deletion with a green suite.

True, and the reason is precise: **every existing ordering test drives `recordOrderingRecord`, the
PARK path, which by design discards `fatal`.** Nine tests that looked like coverage assert the
pre-fix behaviour and pass identically against the old code.

Five live-path tests now cover it — wrong-signer freezes, bad-signature freezes, a frozen session is
not revived by a read, an absent record still ingests and says it was unverified, and an
unresolvable signer does **not** freeze. Deleting the freeze block turns three of them red.

**One of my own assertions was wrong and is corrected rather than forced.** The unresolvable-signer
case does not ingest — but that is the ingest path's own pre-existing `sender_unresolved` guard, not
this unit's freeze. Measured, and that distinction is now the point of the test. It also showed
`counterparty_unknown` is barely reachable live; the soft branch stays anyway, because a gate whose
correctness depends on another guard running first has a hidden precondition.

### What the review CONFIRMED, so it is not re-litigated

- **The enumeration holds.** `node.handle(` appears exactly once in the daemon; three frame senders,
  all carrying `session_id`; no fourth sender anywhere in either repo.
- **`remotePeerId` can never be legitimately absent.** `@libp2p/interface`'s `StreamHandler` types
  `connection` as **non-optional**. This was the question that decided between a security gate and a
  catastrophic false positive, and the three fakes were the only place `undefined` could arise.
- **The revival exemption is true** — the revived gater is narrow from birth.
- **Nothing was lost** removing the duplicate `session_abandoned_notice` checks: same substance,
  same log fields, plus `agentName` and `impact`.
- **No false positives found** across relay-degraded, same-machine, park-recovery and revived
  sessions. The frame gate is exactly as tight as the connection gate, so it cannot refuse a
  connection libp2p would have admitted.
- **Excluded from trust signals, verified by absence:** `trust-signal-store.ts` has no
  session-outcome producer; every write is an explicit operator command.

### One path named for completeness

`#watchRelayStream` reads `session_interrupted` frames off the relay stream. It is not a registered
handler and rides a stream we opened to a known relay peer, so it is pinned by construction — but it
is the other inbound frame path on a session node, and the audit clause is better served by saying
so than by leaving it unmentioned.

**Clause NOT met, carried:** `DOD-M15-FREEZE-STATUS-1` — the freeze still writes the same DB status
as an ordinary teardown. F1 fixed the *reversibility*, which could not wait; the durable column is a
client-side migration and gets its own reviewed unit.

**Tag flipped ✅. Merged.**

---

## Entry 8 — DOD-M15-SIGNUP-1: the rekey was wrong, the review caught it, rebuilt (2026-08-22)

**Built `4922d72c`; review fixes `127a5a29`.** Branch `m15/signup`, not merged — second review owed.
Gate: operations-agent 230 passed, lint, typecheck.

### Reviewer verdict — QUOTED

> I did not rubber-stamp this. The rekey is right about the false-positive half and wrong about what
> it leaves behind: after this change **nothing anywhere throttles a requester**, and the second new
> test pins that as required behaviour.
>
> **SPEC: DEVIATIONS FOUND** — the durability clause is unmet, but it is properly journaled … so it
> is a legitimate split, **not** a silent simplification and **not** blocking on that ground.
>
> **NO SILENT FALLBACKS** in the diff.
>
> **ERROR SUBSTITUTION FOUND** — `[pre-existing]` … `RateLimitError` says "for domain" for a
> per-address limiter.
>
> **HOLLOW TESTS FOUND** — `[blocking]`. Test 2 pins the abuse case as required behaviour; test 1
> does not distinguish the key and falls to a normalization bypass; the window-reset path is
> unpinned; and neither test runs in CI.
>
> **UNPROVEN REMOVAL** — `[blocking]`. The deletion of `extractEmailDomain`'s call site is fully
> proven. The deletion of the original AC-009 body is not: its subject is live and its replacement
> asserts the opposite.

### The finding, and it is the worst of the milestone so far

**The address is the TARGET, not the requester.** Keying on it meant one admitted user could walk
the bot through `victim1@…`, `victim2@…` and receive five real *"Your verification code is NNNNNN"*
emails **per address**, from CELLO's verified sender, to people who never asked. Domain keying was a
crude cap on exactly that. I removed it and put nothing in its place.

**And my own test locked the hole in.** All six `personN@gmail.com` messages came from ONE `userId`
— so it was never "six people", it was one requester asking for codes to six addresses, and the test
asserted no refusal. **A per-requester limiter would have turned that test red. The test forbade the
fix.**

**A second layer already existed and I collapsed onto it.** `SesOtpDeliveryProvider` has enforced
5-per-rolling-hour per address since M6B, counting only sends that SUCCEEDED. Duplicating that key
here shadowed it dead — the state machine counts *attempts*, so its count is always ≥ SES's and
`RateLimitError` became unreachable from registration. Net guard surface went **down**.

### What it is now

Per-**requester**, keyed on the channel user, matching `#tokenAttempts` already in this file rather
than a second shape. Rolling timestamps that prune as they go — the old fixed window grew one entry
per distinct key forever, and the only thing bounding it was the deploy that wiped it. Per-address
stays where it belongs, one layer down.

The check is pure; the count is recorded only after `sendOtp` resolves. A bounce used to spend one
of the person's five, and under a per-person key that lands entirely on someone who never got a code.

### Two things I had written that were false

- **The refusal's affordance.** My first draft told them to send the corrected address immediately —
  true under the address key, false under this one. Telling someone to retry what cannot work is the
  failure this milestone closes, not an improvement on it.
- **The privacy claim.** I logged a 12-char hash prefix and called it *"not a stable identifier
  anyone can carry off"*. It is 48 bits of unsalted SHA-256 over a low-entropy space — hand someone
  a leaked waitlist and it names who asked. The directory already logs the **full** hash at INFO, so
  the truncation bought nothing. **A comment asserting a property the code lacks**, written into the
  milestone that exists to remove them. The field is gone; the registration id was always enough.

### Removal, now proven both ways

`extractEmailDomain` deleted with its tests — zero references in either sibling repo, the package is
`private` and does not re-export the module, its only importer was its own unit test. **The comment
claiming it was "the last consumer of the concept" is corrected:** `SesOtpDeliveryProvider` still
extracts and logs the domain. The domain has not left the system, only the place where it stood in
for a person.

### The revert test earned itself again

Restoring the address key turns the abuse case red — and the run surfaced a **fixture defect** that
would have failed on the next execution regardless: the wave users had static phone numbers and were
never expired, so the third test collided with its own previous run on
`idx_registrations_phone_stub_hash_active`. Rows here are never deleted (RLS forbids it), only
expired, so a leftover active row is a hard failure that reads as a logic bug. Phones now derive from
the per-run user id and every enrolled user is expired in `afterEach`. **Verified by running the file
twice consecutively.**

### One finding promoted to its own line

> neither test runs in CI

`describeIntegration = isLocal ? describe : describe.skip`, gated on `CELLO_ENV=local`, which nothing
in CI sets — so that file reports green in every automated run having asserted nothing. That is this
milestone's own subject applied to its own evidence, and it is not confined to this file.
**`DOD-M15-CI-SKIPS-SILENT-1`.**

**Second review owed before the tag flips.** The fix inverted the design the first review examined,
which is exactly when a second pass is worth its cost — and it is the hard cap.

---

## Entry 9 — DOD-M15-SURFACE-1: one line, and the falsification is the whole unit (2026-08-22)

**Branch `m15/surface`, commit `a1da749`. REVIEW IN FLIGHT — tag stays 🟡.** Gate: cello-client 4008
passed, lint, forced typecheck, build.

### The change

`listenAddresses: ["/ip4/0.0.0.0/tcp/0"]` → `listenAddresses: []` on the directory-facing node.
That node registers **no protocol handler at all**, and the directory **never dials a client** —
every directory connection is one the daemon opened. So every operator ran a real open port on every
interface, for the life of the daemon, that could reach no CELLO protocol.

Not listening is strictly stronger than filtering: no socket, nothing to scan, nothing for a gater
to get wrong. (`DirectoryConnectionGater` exists for the filtering approach and is constructed only
in tests — the consolation prize, not the fix.)

### The counterbalance, and it is an honest exception

**There is no adversary to counterbalance here** — this unit REMOVES a surface rather than guarding
one, so Invariant 1 has nothing to bite on. Recorded as an exception rather than skipped, because a
unit with no answer to "what makes this hold against a rewritten peer?" is usually a unit that has
not thought about it, and this one genuinely has no such party.

### The falsification IS the unit

A one-line change that could break every session in the product. `node.listenAddresses()` **is**
transmitted to the directory at step 7, in `peer_info_announce`, under a comment saying it is *"so
the directory can broker sessions"*. Removing the listener empties it.

Five checks, each traced to its consumer rather than assumed:

1. The directory stores it and reads it in exactly one place — `participant_a/b.multiaddrs` in the
   session assignment.
2. **The directory's own comment settles it:** that address is *"its per-agent DIRECTORY node, NOT
   its standing-receiver session node, so it is NOT a valid content endpoint (using it yields 'could
   not negotiate /cello/content')"*. The real session endpoint travels by the
   `session_offer` → `session_offer_accept` round-trip.
3. No client code reads `participant_a/b` multiaddrs at all.
4. `#peerInfoAnnounced` gates `session_request` — but it is set by the frame **arriving**, not by
   its contents, so an empty array still marks it announced.
5. The peer id still goes in the announce, and a peer id needs no listener.

**Inbound sessions are untouched.** They arrive on the standing receiver, a different node, which
keeps its socket deliberately (relay-audit Decision 2 — load-bearing for same-machine and same-LAN).

### Pinned in two places, because neither alone is enough

- **`core/transport`** proves the BEHAVIOUR: an empty listen config really binds nothing rather than
  falling back to a default. A silent default would give the daemon a port it believes it does not
  have, which is worse than the port it had openly.
- **`core/daemon`** guards the CALL SITE against someone restoring the address — a one-line edit
  that would otherwise pass every test in the repo.

**The second is source-level, and the limitation is stated rather than hidden:** every test in that
file injects `createDirectoryNode`, so none of them reaches the real `createNode`. It asserts the
slice contains `keyProvider` first, so a slice that matched nothing fails loudly instead of passing
vacuously. Revert-tested — restoring `0.0.0.0` turns it red.

**Its first version failed against my own comment.** The reasoning beside the call names the address
it removed, so the scan matched the explanation instead of the code. Comments are stripped first now,
the way `msg-022`'s parity test already does — a small thing, and exactly the shape that makes a
source-level assertion untrustworthy if nobody checks it.

### The other half of the line, split not dropped

`DOD-M15-IDLE-CONNS-1`. Its value changed while the milestone ran: `DOD-M15-FRAME-1` now hangs a
stranger up on first contact and evicts peers outside the gate at promotion, so the **injection**
half is closed and what remains is resource bounding.

**Mechanism checked so it is not re-derived:** libp2p has no idle-lifetime reaper —
`maxConnections`, `inboundConnectionThreshold`, `maxIncomingPendingConnections` and
`inboundUpgradeTimeout` are rate and total caps, not idle age. A real one needs per-connection
"has this peer authenticated to anything" state that nothing holds today. **And the warning that
matters more than the feature:** those caps apply to every node including relay-connected ones, so
setting them without measurement breaks *reachability* — the one property this milestone must not
trade away.

---

## Entry 10 — DOD-M15-SIGNUP-1: second review, both blocking findings fixed, ✅ (2026-08-22)

**`4922d72c` → `127a5a29` → `f9f271f4`.** Two review passes — the hard cap. Gate: operations-agent
231 passed, lint, forced typecheck.

### Second verdict — QUOTED

> **SPEC: DEVIATIONS FOUND** — the address-fingerprint clause is deviated from, but Entry 8 journals
> the decision with its reasoning, so it is a legitimate correction, not a silent simplification.
> Not blocking on that ground. F4 is blocking as a documentation defect: the DoD and the deferral
> line still prescribe the overturned design and name a deleted field.
>
> **NO SILENT FALLBACKS** — the limiter itself introduces none, and the in-memory limitation is
> stated rather than hidden.
>
> **ERROR SUBSTITUTION FOUND** — `[blocking]`, F1. A delivery-layer refusal surfaces to the person
> as *"Incorrect code. You have 2 attempts remaining."* after a silence… **This unit is what made
> that path reachable, so it belongs to this unit and not to a later one.**
>
> **HOLLOW TESTS FOUND** — `[blocking]`. Test 2 does not survive the revert test… Nothing asserts
> the sixth send was prevented, nothing asserts the person is told, the rolling reset is unpinned,
> and record-after-success is unpinned.
>
> **REMOVALS PROVEN** — verified independently across both sibling repos…
>
> I am not rubber-stamping this. The rekey is right, the reasoning in the comments is the best in
> the file, and the honesty about the in-memory gap is exactly what invariant 1 asks for. What it
> does not yet have is a test that would notice if any of the four properties it fixed were undone,
> and it has un-shadowed a delivery-layer refusal whose user-facing behaviour is silence followed by
> an accusation.

### F1 — the finding I would not have thought to look for

**Fixing one thing made a second thing reachable.** The old domain key counted a *superset* of the
delivery provider's per-address limiter on a *coarser* key, so `RateLimitError` could never fire from
registration — it was dead code reached only in theory. Making the two limiters orthogonal woke it
up. Two admitted users registering against one shared mailbox now hit the per-address five while
neither is near their own.

And what waking it up looked like: **silence, then "Incorrect code. You have 2 attempts
remaining."** The row had already moved to `AWAITING_EMAIL_OTP`, so the next message was read as a
code. Now the send is wrapped, the upstream cause is logged instead of destroyed by a generic engine
error, the person is told nothing was sent, and **the record is rolled back** — which matters as much
as the message, because without it they stay in the state that produces the accusation.

**The general lesson, and it is worth more than the fix:** un-shadowing a refusal means owning how it
fails. A guard that has never fired has never had its failure path exercised, and "it was already
there" is not a defence when your change is what made it reachable.

### F2 — the layer I handed victim-protection to did not normalise its key

Moving per-address protection *to* the delivery provider made that provider's key load-bearing — and
it keyed on the raw string, so `Victim@x.com` and `victim@x.com` were separate buckets in both the
send log **and the bounce set**. One shift key bought a fresh allowance. The bounce half needs no
attacker: a user whose address hard-bounces retypes it with different capitalisation and we mail a
known-bad address again, which is SES reputation damage on the ordinary path.

### F4 — the spec still prescribed the design the review overturned

Both DoD lines said *"rekey … to the address fingerprint"* and the durability line named
`#rateLimitMap`, a field this branch deleted. **Whoever picked up durability would have built a table
keyed on the victim.** Corrected with the reasoning visible rather than quietly rewritten.

### Four bypasses, each closed and each verified by making the mutation

| Bypass | Now |
|---|---|
| Log the warn and send anyway | **red** — `otpState.captured.length` is asserted, not just the event |
| Never tell the person | **red** — the refusal copy is asserted on `channelState.sent` |
| Make the window permanent | **red** — a clock-advancing test proves the allowance returns |
| Record before the send | **red** — a provider double that throws proves the five are intact |

Test 1 also put its six addresses on **one domain**, so restoring the domain key left it green — it
was detecting a log field, not the key. Six domains now. The normalization test became vacuous the
moment the key stopped being the email, and is replaced by the window-roll test.

### A methodology note I nearly shipped past

**The first window-bypass run passed, and I almost recorded that as a weak test.** The mutation had
silently patched the wrong limiter — two limiters in this file share the line
`const live = stamps.filter((t) => t > cutoff)`, and a `replace(..., 1)` took the first. **A revert
test that passes is only evidence if the mutation landed where you think it did.**

**Tag ✅. Merged.**

---

## Entry 11 — DOD-M15-SURFACE-1: reviewed clean, six findings fixed, ✅ (2026-08-22)

**cello-client `a1da749` + `a0940f1`; trustless-cello `007b6909`.** Gate: 4008 passed, lint, forced
typecheck, build.

### Verdict — QUOTED

> **SPEC: FAITHFUL**
> **NO SILENT FALLBACKS**
> **ERRORS NAME THEIR CAUSE** (one `[pre-existing]` substitution noted at
> `registration-manager.ts:256`, outside the diff)
> **TESTS HAVE TEETH** — both new tests survive THE REVERT TEST, verified by simulation and by
> positive control; two LOW boundary weaknesses (F4, F5). Separately: `trustless-cello`'s AC-005
> test is hollow by the self-supplied-fixture shape and now asserts something production no longer
> does (F2).
> **REMOVALS PROVEN**
>
> Nothing here is blocking. F1 and F2 should be fixed before the tag goes green.
>
> **Am I rubber-stamping?** The diff touches transport surface and session establishment, which is
> exactly where I am expected to find something, so I pushed hardest there and came up with nothing
> that breaks. I am reporting that as a clean result rather than manufacturing a finding, because
> the five traces plus the empirical dial test are independent of each other and all agree.

**All five falsification claims independently confirmed**, plus two the reviewer checked that I had
not: **no wire signature covers `participant_a/b.multiaddrs`** (both TBS builders read — neither
includes it), and **no non-empty validation exists on either side** (round-tripped `{multiaddrs: []}`
through `cbor-x`; both guards pass). It also **built and ran a throwaway transport test** proving a
zero-listener node still dials out and opens a stream — the property the FROST DKG fan-out depends
on, tested rather than argued.

### F1 — two comments in one expression, disagreeing about the fact this unit changed

The comment above the change still called this node *"bound on 0.0.0.0"*, thirty lines above the
block explaining that it binds nothing. **That is how the binding gets "restored" by a later session
that stops reading at the first comment** — and this project has the record for it.

**Rewritten, not deleted, because the constraint underneath is still load-bearing:** leaving
`nodeType` unset would still add `circuitRelayServer` and advertise HOP, and **HOP rides connections
we opened, not only ones we accept.** Not listening does not make the opt-out redundant.

### F2 — a test asserting a property of its own fixture

`AC-005` asserted both participants carry at least one multiaddr. **Production now violates that on
every session**, and the test could never notice: it builds its own libp2p nodes with real listen
addresses and announces *those*. It would have stayed green forever whatever the daemon did.

**The shape is worth naming: a test whose subject it supplies itself cannot observe the thing it
claims to guarantee.** Amended to what is actually guaranteed — a well-formed array — with the note
that the dialable endpoint travels in `initiator_session_addrs` / `counterparty_session_addrs`, from
a different node entirely.

### F3–F6

**F3** — `participant_a/b.multiaddrs` is now permanently `[]`, signed over by nothing, parsed and
dropped by the client, **and still able to reject a whole assignment if malformed** — a
checked-then-ignored for a value nobody reads. Named as `DOD-M15-DEAD-WIRE-FIELD-1` rather than left
implying something acts on it; removing it is a bilateral wire change.

**F4** — the transport test's claim sat one level above its proof: `listenAddresses()` maps
`getMultiaddrs()`, which returns only *verified* addresses, so `[]` proves nothing is **announced**.
The gap is bounded (the realistic regression restores `0.0.0.0` or `127.0.0.1`, both verified
immediately), and the sibling test below is the positive control. Both facts now stated in the test
so the pair cannot drift apart.

**F5** — the source guard's slice ended at an interior key, so an address reintroduced after it
escaped every assertion. Now ends at the literal's closing brace, and asserts it got there.

**F6, `[pre-existing]` and fixed anyway** — registration reported `directory_unreachable` when the
daemon's **own** transport node was momentarily null during a stream rebuild. A network verdict for
a local lifecycle fact, with the production comment two lines above already saying so. It now names
the local cause and carries what to do. **The test asserting the old string had made the
mislabelling required behaviour** — the fourth unit in this milestone to hit that shape.

**Tag ✅. Merged.**

---

## Entry 12 — DOD-M15-LEDGER-1 + DOD-M15-CLAIM-COMMENTS-1: the claims work (2026-08-22)

**trustless-cello `f075c919` + the ledger commits; cello-client `856e322`. Both 🟡 — one review
pass owed, dispatched together because they are the same subject.** Gate: cello-client 4008 passed,
lint both repos, typecheck both repos.

### The counterbalance (Invariant 1) — an honest exception, again

Neither unit guards anything. `LEDGER-1` is an audit and `CLAIM-COMMENTS-1` rewrites prose to match
code. **The adversary here is a future reader, including us** — and the counterbalance is that every
row records the command that produced it, so the claim can be re-checked rather than believed.

### LEDGER-1 — the sweep, complete

All four live surfaces walked. **22 rows.** Method throughout: run the artefact's own instructions
against the tree rather than reading it.

**The worst row is still `AUDIT-ME.md`'s Claim 3**, and it is worst because of *how* it is found:
the file's own command 4 returns `core/daemon/src/telegram-bot-client.ts`, falsifying the claim four
lines above it. An evaluator following the instructions in a file called AUDIT-ME reaches a false
claim in about ten seconds.

**Two clean negatives, recorded so nobody re-walks them:** CLI help and product status output carry
no security claims — the claim-shaped words grep finds there are source comments about
implementation discipline, and they are accurate. And `content_profile` is advertised **nowhere**,
so `DOD-M15-DOCPROFILE-1` is a feature gap with no claim attached, which is the reverse of what its
line assumed.

### CLAIM-COMMENTS-1 — two comments deferring to each other

The pair is the find. The directory's SEAL-leaf handler deferred its root check *"to a follow-on
story since clients perform this verification locally, maintaining the trust guarantee at the client
level"*. The client defers the same check back, saying root agreement *"belongs to the FROST seal
against the directory-held tree"*.

**Each half points at the other and there is no third party.** The certified root is compared against
no participant's transcript on the bilateral path — which is exactly `DOD-M15-SEALWIRE-1`'s subject,
and the reason it stayed invisible for so long.

> **This is the mechanism, not just an instance:** both halves read as a *considered decision to
> check elsewhere*. Neither reads as an omission. A reviewer checking either one finds a reason and
> moves on. **Mutual deferral is the strongest camouflage a missing check can have**, and the only
> way to see it is to follow the pointer.

**Neither comment is deleted.** Each records a real gap, and deleting them would leave the absence
looking deliberate — which is precisely what the original wording achieved by accident. Both now say
that nobody performs the check, and both name the unit that closes it.

**The directory's deferral is also structurally impossible as written:** `final_root` survives only
inside a SHA-256 pre-image that is never transmitted, so no amount of follow-on work makes the check
possible without changing the wire.

### The second copy of a wrong explanation

Two files blamed the heartbeat's failure to replicate on a *"BIGSERIAL `id` collision"*. One was
corrected earlier; this was the other. **It is wrong in the way that costs a day** — it sends the
next reader at a surrogate-key problem that does not exist. The cause is that `last_heartbeat_at` is
**mutable** and Tier A carries immutable columns only, so replicating it needs a Tier-B merge table
rather than a spec edit.

**A corrected comment can have copies.** Fixing the instance you found is not fixing the claim.

---

## Entry 13 — DOD-M15-ASSIGN-1: confirm-first trace, and a correction to the audit's framing (2026-08-22)

**Branch `m15/assign`. Trace only — no code yet.** Recorded before implementing because the unit is
security-critical crypto verification and the trace changed what the fix can honestly claim.

### Confirmed: the named verification site does not exist

`session-assignment-parser.ts`'s header says *"the FROST/single signature is verified downstream by
the transport/session layer against the directory's pinned key."* Verified independently:
`buildSessionEstablishmentTbs` is exported from `protocol-types` and called by the directory to
**sign** and by the FROST signer — **never anywhere to verify.** The parser shape-validates only
(`dirSig.length !== 64`). Another comment naming a check that is not there.

### The correction that matters: the signature is NOT a directory's

The field is called `directory_signature`, and the relay audit already flagged the naming. Tracing
the signer settles what verification can mean:

- `signature_type: "frost"` → `signer_pubkey` is **the INITIATOR's FROST group key** (their
  `primary_pubkey`). The directory signs with `#thresholdSigners.get(initiatorHex)` — the quorum
  holding **A's** shares.
- `signature_type: "single"` → verifies against `directory_pubkey`.
- `signer_pubkey` is **NOT in the TBS** — it rides in the frame.

**That last point is the trap.** Verifying a signature against a key the same frame supplies is
circular: an attacker supplies both. The check is only worth anything if `signer_pubkey` is
compared against something the client knows independently.

### What each party can honestly verify

| Party | Holds the assignment? | Independent knowledge | Meaningful check |
|---|---|---|---|
| **Initiator (A)** | yes — `outbound-sessions.ts:374` | **its own `primaryPubkey`**, persisted by `registration-persistence.ts` | ✅ `signer_pubkey === my primary_pubkey`, then verify the sig over the TBS |
| **Relay** | the relay-facing half | its configured consortium key set | ✅ already verified today — this half is not the gap |
| **Responder (B)** | carries the relay assignment forward | A's K_local, **not** A's `primary_pubkey` | ❌ would need a directory lookup of A's profile first |

**So the implementable half is the initiator's**, and it is genuinely worth doing: it proves **A's
own quorum authorized this session with these exact parameters** — session id, both pubkeys, both
session peer ids and address sets, transport mode. A frame forged by anyone who is not that quorum
fails.

### ⚠️ What this does NOT close, stated before building so the fix cannot over-claim

**It does not close the session-open MITM.** The audit's framing — *"a rogue majority of the
directories holding shares for the target agent B can FROST-sign a false SessionAssignment claiming
M's pubkey is B's"* — needs one correction against the code: **the signature is by the INITIATOR's
quorum, not the target's.** So an assignment substituting M for B would be signed by **A's own
quorum** and would verify perfectly on A's side.

Verifying the assignment therefore proves *this session was authorized*, never *the counterparty is
who you meant*. The substitution is caught at ingest by the wrong-signer check that
`DOD-M15-FRAME-1` made blocking, and closed properly by relay corroboration
(`DOD-M15-CORROBORATE-1`).

**This is exactly the over-claim `DOD-M15-FRAME-1`'s review caught me making once already** — a
comment asserting a check shows something it only partly shows. Writing the bound down first.

### Why clause (b) still needs clause (a)

The DoD line's ordering — verify, then gate — holds for a reason the trace confirms: gating the
standing receiver on "is this dialer named in a live assignment" is only as good as the assignment.
Without verification the gate consults a document anybody could have written, which relocates trust
rather than closing it.

**Next:** implement the initiator-side verification — compare `signer_pubkey` against the persisted
`primaryPubkey`, rebuild the TBS from the assignment's own fields, verify, and **refuse on failure**
rather than logging. Then the receiver gate.

---

## Entry 14 — LEDGER-1 + CLAIM-COMMENTS-1 reviewed: BOTH BLOCKING, tags reverted (2026-08-22)

**Andre challenged this while the review was in flight — *"following the letter of the definition of
done but not the spirit… am I wrong?"* He was not wrong, and the review says so harder.**

### Verdict — QUOTED

> **SPEC: DEVIATIONS FOUND** — `[blocking]`. `LEDGER-1`'s own closing clause ("the line is not ✅
> while a surface is unswept") is unmet on three of its four surfaces. `CLAIM-COMMENTS-1`'s headline
> clause is unmet: two comments in the public repo still assert properties the code lacks, one of
> which the repo itself already documented as false.
>
> **HOLLOW TESTS FOUND** — `[blocking]` for `LEDGER-1` only… neither unit ships a test; both fail
> the revert test. Acceptable for the comment rewrites, not for the ledger, whose completeness is
> the deliverable and is currently pinned by nothing.
>
> **REMOVALS PROVEN** — rewrite-never-delete holds in all three files.
>
> **I am not rubber-stamping.** The three comment rewrites are correct, independently verified… What
> does not hold is the sentence the last commit added: **"The sweep is complete — all four live
> surfaces walked."**

### What it found on surfaces I declared clean

- **CLI help carries three security claims.** *"tamper-proof"* (`registry.ts:538`) — harder than
  anything the system does. *"if a single message were altered, added or dropped, it would no longer
  match"* (`:868`) — **the exact comparison this milestone's own audit found nobody performs.** And
  the screening claim verbatim (`:932`), which the screening fix would have patched four places and
  missed.
- **`core/adapter-claude-code/SKILL.md` — the file that actually ships in the npm tarball — was
  never swept.** Different file from the plugin's copy (379 lines vs 309). It carries the screening
  claim verbatim plus three more. **The repo already knew:** `plugin-skills-audit.test.ts` opens by
  saying that file *"rides in the connect tarball."*
- **The README says screening is NOT active** — false in the *other* direction, on the file a
  first-time reader opens.
- **The GitHub repo description advertises native adapters for OpenClaw, NanoClaw, IronClaw and
  ZeroClaw.** They do not exist. First line an evaluator reads; no row.

### The diagnosis, in the reviewer's words and Andre's

> It did not take an edit to rot it — **it shipped incomplete, because completeness rested on one
> person's grep vocabulary at one moment.**

My sweep used *never / cannot / impossible*. **None of** *tamper-proof, tamper-evident, ACTIVE,
screened, encrypted, verifiable, notarized, proof* **was in it.** That is the letter/spirit gap
exactly: a prose ledger is a chore that looks like a control.

### The fix, and the repo already has the pattern

A **build-time claim scanner**: a claim vocabulary regex, scanned over surfaces **enumerated by the
system** — `package.json#files` for the tarball, the plugin manifests, `registry.ts` summary/help
literals, root `*.md` — where **every hit must appear in a table with a disposition, and an unlisted
hit fails the build.** That inverts the loop the way lens 4 demands: iterate what the system has,
not a hand-maintained list. It would have caught all three HIGHs at commit time.

**Live proof it works, from minutes later:** the daemon's existing `dod-onboard-help-1-vocabulary`
audit — same shape, for CLI verbs — caught me writing `cello register` into a user-facing string
when the verb is `register-agent`. The chore missed four claim surfaces; the scanner caught a typo
in a string I had just written.

### Other findings actioned or carried

- **HIGH-5 — FIXED IMMEDIATELY** (cello-client `1ddcd63`): `session-assignment-parser.ts`'s header
  named a verification site that did not exist. **`DOD-M15-ASSIGN-1` fixed the call site below it
  and left the false header standing** — the same shape as the pair this unit did fix, in the file
  that unit was editing.
- **HIGH-4** — row 13 assigns `cello-mcp.ts:190` to this unit and the unit did not deliver it.
- **MEDIUM-6** — rows 10–13's disposition is wrong: `SCREENINSTALL-1` ships an **optional** install,
  so "ACTIVE" stays false for anyone who does not run it. Correct disposition is *disclosed as a
  bounded property*, and the ledger's own "partially true is false" rule applies to the flip itself.
- **MEDIUM-9** — `AUDIT-ME.md`'s command 2 greps two paths that **no longer exist**, finds nothing,
  exits 0, and reads as PASSED. A diagnostic that checked nothing and reported success, inside the
  document the milestone calls its most exposed artifact.
- **A fourth column for the ledger:** *enforced by whom*. It would make row 6 self-evidently false
  (nobody), row 7 safe (structural), and rows 10–13 bounded (the operator's own daemon — ergonomics
  by Invariant 1's own first non-qualifying answer).

### Verified correct, so it is not re-litigated

All four rows the reviewer re-derived independently **held** — the Telegram call, four-of-eight dead
paths, `session_name` in no wire type (by a stronger check than mine), and the README's
"independently verify" being genuinely false. **All three comment rewrites verified TRUE against the
code**, including the two I was least sure of: `final_root` really is unrecoverable from the wire,
and the heartbeat cause really is mutability rather than a key collision — the repo's own
`ae-spec-required-columns` test already says *"needs a real Tier-B merge, not a spec edit."*

**`DOD-M15-LEDGER-1` → ❌. `DOD-M15-CLAIM-COMMENTS-1` → ❌.** Both stay open until the scanner exists
and the missed surfaces have rows.

---

## Entry 14 — `DOD-M15-ASSIGN-1` clause (b): the receiver that admitted everyone

**Built, review in flight. Tag stays yellow until the verdict is quoted here.**

### What the defect actually was, in the operator's terms

An agent comes online and opens its standing receiver — the socket that waits for a counterparty to
dial in. That receiver's connection gater was constructed with `allowedPeerId: null`, and the gater
read null as *admit everyone*. So from the moment an agent went online to the moment a session
claimed the receiver, **any peer who knew the address could complete a Noise handshake against it.**

The window is not the whole story. libp2p never re-runs a gater against a connection that already
exists — a fact this milestone has now hit twice. So a stranger who attached during the open window
was **still attached after the receiver was promoted into a live session**, holding a connection
nobody had invited, on the node that had by then become the session.

### The fix, and why the ordering is the whole mechanism

`null` now admits **nobody** inbound. That alone would lock out the legitimate counterparty too, so
the second half is what makes it work: the directory's `session_offer` **names** the initiator's
session peer id, and the responder narrows its gate to exactly that peer **before** it sends the
`session_offer_accept` that publishes its own address.

That ordering is not a detail — it is the argument. The initiator cannot learn where to dial until
the accept it triggered has gone out, and by then the gate already names them. There is no interval
in which the advertised address is reachable by anyone else.

An offer that names **no** dialer is refused, not served. The directory already rejects a
`session_request` without an `initiator_session_peer_id`, so a nameless offer means a directory that
is broken or lying. Advertising anyway would be the worse failure: the initiator would dial an
address whose gate refuses them, and the session would die at the transport with nobody able to say
why. The reject names the cause on the frame the directory is already waiting for.

### The counterbalance question (Invariant 1), asked honestly

This does **not** make the responder safe against a malicious directory — a directory can name the
wrong dialer, and clause (b) will faithfully open the door to whoever it named. What it removes is
the *unauthenticated* attacker: someone who is not the directory and was never part of any
negotiation. The residual — a compromised directory naming an impostor — is what clause (a)'s
signature verification bounds on the initiator path, and what remains open on the responder path.
Said here rather than left implicit, because clause (b) reads like a stronger guarantee than it is.

### The near-miss worth recording

Flipping null to deny-all **would have broken message parking**, and no test in the tree would have
caught it. The standing receiver is not only a receiver: it doubles as the daemon's general-purpose
dialer for errands that belong to no session — the content-park deposit and pull against the relay.
Those are OUTBOUND dials through the same gater. A blanket deny would have cost that feature to
close a door nobody was standing at.

The deny is therefore **inbound-only**, by an explicit direction parameter. INV-5 governs who may
come IN; an outbound dial is this agent choosing where to go.

**Rule:** when inverting the meaning of a permissive default, enumerate the *consumers* of that
default, not just its construction sites. The construction site said "standing receiver"; the
consumer list said "and also the content-park dialer."

### The test that was right and the tests that were wrong

Four existing tests changed, and they split into two categories that must not be confused:

- **Two asserted the defect as contract** — `"Initially open"` and `"allows connection when gater is
  open"`. These inverted. A test that pins an open door is not protecting anything.
- **The f16 two-daemon harness caught something real and I had to prove it was a harness gap, not a
  regression.** It injected a `session_assignment` with no preceding `session_offer` — a sequence a
  real directory **cannot** produce (it rejects requests without an initiator peer id, and will not
  sign until the target has accepted an offer). Bob was therefore never told who was coming. The
  harness now offers first, inside the negotiator seam that stands in for the directory round-trip.

The evidence that settled it was a log line, not an argument: instrumenting the harness showed
`session.node.connection.rejected` with `expectedPeerId: "(none — receiver unclaimed)"` on **bob's**
standing receiver. Before that I had guessed wrong about which side was refusing, and a second guess
would have been a third. The corroborating detail: the fixed harness now runs in **1083 ms instead
of 5300 ms**, because the link establishes immediately rather than waiting out a timeout — the old
harness had been paying a 5-second stall that nobody had read as a symptom.

**Rule (re-earned):** a failing test gets traced to the producer, not attributed. The one thing that
distinguishes "harness gap" from "I broke it" is evidence about *which side refused and why* — and
that is one log line away, always cheaper than the argument.

### Revert test

Three clauses, each mutated separately, each verified to land before the result was trusted:

| clause removed | tests that go red |
|---|---|
| inbound deny on `null` | 1 — the unclaimed-receiver denial |
| outbound allowance | 1 — the content-park errand |
| offer-time narrowing | 3 — all of the offer-handler contract |

Gate on the committed tree: **4018 passed**, lint, typecheck, build. Commit `59ac4db`.

## Entry 15 — `DOD-M15-CI-SKIPS-SILENT-1`: the gate that could not see a quarter of itself

**Built, review in flight. Tag stays yellow until the verdict is quoted here.**

### The thing I went looking for, and the worse thing I found

The DoD line was about **environment-gated suites**: integration tests wrapped in
`CELLO_ENV === "local" ? describe : describe.skip`, which report as skipped on every run that does
not set the variable, and a skip that does not say why is indistinguishable from a pass.

That is real — 64 files, 595 of 2266 tests, a **quarter of the suite** silently inert. But looking
for it turned up a second failure of the same class that nobody had named:

**`vitest.config.ts` lists its projects explicitly, and three workspace packages were not on the
list.** `operations-agent` (19 test files), `interfaces` (4), `test-fixtures` (1). The gate
collected 168 files, printed a healthy green total, and never mentioned the other 24. Not skipped —
**never collected**. There is no line in the output where they would have appeared.

### Why this one stings

**The signup limiter units earlier in this milestone reported a green gate that did not contain a
single one of their own tests.** Every operations-agent test lives in a package the root gate could
not see. `DOD-M15-SIGNUP-1` and `DOD-M15-SIGNUP-DURABLE-1` were both written, tested, and recorded
against a gate figure of ~4000 passing tests, none of which were theirs.

That is this milestone's exact subject — evidence that asserted nothing — occurring **inside the
milestone's own process**, twice, before anyone looked.

Wiring the three packages in takes the gate from **168 files to 192** and turns on **185
previously-unrun operations-agent assertions**. Nothing broke, which is the only comfortable part of
this entry: the tests were fine. Nobody was running them.

### The comment that was already there

The projects array already carried a warning, added with the seal notifier in August:

> *"A package absent from this list has its tests silently skipped by the root gate — they neither
> run nor report, which reads as 'no tests to run' rather than 'your tests are not wired in'."*

Someone wrote that, understood it exactly, and the next omission happened anyway. **A comment is not
an enforcement mechanism**, and adding a third one would have been the same move a third time.

So the fix is a test. `root-gate-wiring.test.ts` fails — naming the offending package — when any
workspace package containing `.test.ts` files is missing from the list.

**Rule:** when the record shows a warning was already written and then not heeded, the next
intervention must be one that *cannot* be walked past. Prose has been tried and has the result.

### The two halves of loud (Invariant 2)

- **Always, everywhere:** the run prints a banner naming how many suites did not execute, what they
  would have covered (database, RLS policies, hash-chain constraints, migrations), and the exact
  command to run them. Warning **and** the count in the output, not one instead of the other.
- **In CI: it fails.** A local developer skipping the slow suites is making an informed choice and
  the banner informs them. CI has no reader to inform, so there the only honest behaviour is red.

The count is derived by **reading the sources**, not by annotating call sites. Annotating ~70 sites
fixes 70 files and drifts on the 71st; deriving it means suite 65 is covered the day it is written.
**This is a deliberate substitution for the DoD's "a title carrying the reason" clause** — same
purpose (the reason is visible in the run output), different mechanism — and it is flagged to the
reviewer as the thing most likely to be letter-versus-spirit in the wrong direction.

### Revert test

| clause removed | result |
|---|---|
| `operations-agent` unwired from projects | wiring test red, **naming `operations-agent` in the message** |
| `CI=1`, no `CELLO_ENV` | CI guard red |
| `CI=1`, `CELLO_ENV=local` | all 19 green — the guard does not fire on a genuinely tested run |

Gate on the committed tree: **155 passed** (193 files), lint 0 errors, typecheck. Commit `99734664`.

### Carried

- **The same audit is owed on cello-client**, which has 6 skip-gated files (`CELLO_E2E_LIVE`) and a
  CI workflow that *does* run `pnpm run test` without setting it. Held back deliberately: that repo
  has a review in flight on `m15/assign` and adding commits underneath a running reviewer is how a
  verdict ends up describing a tree that no longer exists.

## Entry 16 — two reviews, and what they cost the units that had already been written

Both `DOD-M15-ASSIGN-1` and `DOD-M15-CI-SKIPS-SILENT-1` came back **DEVIATIONS FOUND [blocking]**.
Neither was a style pass. Between them they found one complete security bypass, one regression I had
shipped an hour earlier, and two guards that reported healthy because they could not see the thing
they were checking for.

### The one that mattered: a check that one unsigned field switched off

`signature_type` rides in the assignment frame and no signature covers it. The parser reads anything
that is not the literal `"frost"` — **an absent field included** — as `"single"`. The verifier
branched on that value *before* loading the agent's registration, and the single-key branch verified
`directory_signature` against the `directory_pubkey` sitting beside it **in the same unsigned
frame**. A key checked against itself proves nothing.

So the entire unit was disabled by omitting one field: mint a keypair, name an impostor as the
counterparty, sign it properly, drop the field. The anti-circularity comparison, the threshold
verify and the fail-closed were all stepped over — and the assignment arrived looking *verified*.

The defence I had written for that branch was a comment saying production always produces FROST. The
reviewer checked it against the producer and confirmed the comment was **true** — the directory
hardcodes `"frost"` at a single site with no conditional. **The comment was correct and the code was
still exploitable**, because what production produces is not what an attacker sends.

**Rule:** a branch reachable only by a value the wire controls is reachable by anyone who controls
the wire. "Production never sends that" describes the honest sender, and the honest sender is not
the threat.

The registration is now loaded before the branch, a registered agent refuses any non-FROST
assignment by name, and the single-key branch is **deleted** rather than guarded — with `verify` no
longer imported, because leaving that call available in the file is how the bypass comes back.

### The regression I shipped, and why my own test missed it

The outbound carve-out I wrote *specifically* to protect message parking keyed off
`allowedPeerId === null`. The offer-time narrowing sets that field. So the moment an agent received
one inbound offer, its receiver — still the daemon's general-purpose dialer, no assignment yet —
silently lost the right to dial anything except that one peer.

Two casualties, and the second is not a papercut: the content-park deposit/pull, and the
**restart-seal submission**, which dials a relay endpoint persisted from an *earlier* session and so
is on no allowlist by construction. An agent that merely RECEIVED an offer would stop being able to
submit a seal, and the operator would see `relay_unavailable` — a transport label for what was
actually a local gater decision.

My test asserted the carve-out **only in the `null` state**. It passed. The reviewer's phrasing is
the lesson: *"an implementation that narrows the outbound gate the moment an offer arrives passes it
— which is F2, shipped."*

**Rule:** when a guard is conditional on a piece of state, test it in every state that guard will
actually see — not only the one it was written in. The states the code moves through are the test
matrix; the state it starts in is one row.

### Two guards that could not see

- **The sentinel that could never fire.** Its job was to catch the skip-detection regex drifting
  away from the idiom it looks for. The regex **matched the file's own doc comment quoting that
  idiom**, so it was permanently satisfied by itself: every gated suite in the repo could have
  migrated to a new form and it would still have reported one. It also inflated the count.
- **The announcement nobody read.** A `console.warn` from inside a test landed **4,851 lines before
  the end of a 22,418-line run**, wedged between transport logs, with a headline number (64) that
  contradicted vitest's own summary (38) in the same output. Moving it to a `process.on("exit")`
  handler was worse — tests run in workers, so it never reached the terminal at all. It is now a
  reporter, running in the main process, printing **after** the summary, using the run's own numbers
  with skips and todos counted separately because vitest reports them separately one line above.

**Rule:** "it is in the output" is not the same as "the reader saw it", and a number the reader
cannot reconcile with the line above it is a number they discount. Measure where it lands.

### The clause I amended rather than ticked

`DOD-M15-ASSIGN-1` (b) said the receiver refuses any dialer not named in a live **directory-signed**
assignment. It does not. It narrows from `session_offer`, a frame with three fields and **no
signature**, so the peer allowed to dial is chosen by whichever directory node sent it.

What (b) genuinely buys is the removal of the *unauthenticated* attacker, which was a real open
door. What it does not buy is protection from a malicious directory — the same hole (a) closes one
layer up, still open one layer down. **The DoD line is amended to say so, and the gap is carried as
`DOD-M15-OFFER-SIGNED-1`.** Ticking the original wording would have been the letter-versus-spirit
failure this milestone already fell into once.

### Carried, as named lines rather than dissolved

| new line | what it holds |
|---|---|
| `DOD-M15-OFFER-SIGNED-1` | the offer that opens the receiver's door is unsigned |
| `DOD-M15-OFFER-EXPIRY-1` | the narrowing never expires, and a second offer evicts the first initiator |
| `DOD-M15-RESPONDER-VERIFY-1` | the responder persists an unverified `signer_pubkey` **as the seal trust anchor** |
| `DOD-M15-COMPOSE-CI-1` | `engine.test.ts` — the DoD's own named example — still asserts nothing |
| `DOD-M15-SPINE-LANE-1` | 38 spine/cross-machine files never collect under any environment |

### Gates

cello-client `b72e74b` + `5ebdd74`: **4024 → 348 files passed**, lint, typecheck, build.
trustless-cello `73d83abe`: **156 passed**, lint 0 errors, typecheck. Every fix revert-tested,
including the two bypasses the old guards allowed (a commented-out projects entry; an undeclared
config exclusion) — both now turn the guard red.

## Entry 17 — `DOD-M15-ASSIGN-1` closes ✅, and the database suites finally ran

### The verdict, quoted

Second pass on the fix commit, which is the hard cap:

> **SPEC: FAITHFUL** — all five findings addressed as described; no clause silently simplified in
> the fixes. **NO SILENT FALLBACKS** — every new branch refuses by name. **ERRORS NAME THEIR
> CAUSE.** **TESTS HAVE TEETH** — the wiring test **survives the revert test**. **REMOVALS PROVEN.**

It named two things it would not close on, and both are fixed in `6a80b00`.

### The one that was genuinely embarrassing

I let a relay dial in to a standing receiver so its AutoNAT probe could be answered, and keyed that
allowance on the gater's **outbound allowlist** — which is built from relay peer ids **the directory
hands out**, cumulatively, including relays whose reservation never completed.

This is a unit whose entire threat model is *one compromised directory*. I had handed that exact
adversary a narrow inbound foothold: name a relay, never reserve with it, dial in anyway. The
comment above the carve-out justified it as *"a peer this node already dials and holds a reservation
with"* — which described a property the set did not have.

**Rule:** when a check needs "a peer we have a relationship with", key it on the *evidence of the
relationship*, not on a list that usually contains such peers. Especially when the adversary in your
own threat model is the one populating the list.

### The 19-second test on a path nobody takes

The wiring test's fake answered only `session_request`, so the negotiator ran discovery to
exhaustion — three 5-second lookups plus backoffs — gave up, and reached the code under test through
the **legacy unsupported-directory fallback**. The assertion was real and the revert test genuine.
It was also the slowest test in the daemon suite and it exercised a route no live agent takes.

Answering the discovery lookup puts it on the production same-node path: **19s → 1.1s**, and the
revert test now fails in **7ms** on a real assertion instead of arriving late behind a timeout. The
route is now asserted too, so it cannot drift back to the fallback while still passing green.

**Rule:** a passing test that is slow is telling you something about the path it took. 19 seconds
was not the cost of the assertion; it was the sound of the code giving up three times first.

---

## The database suites ran for the first time, and V63 did not survive contact

`DOD-M15-CI-SKIPS-SILENT-1` made the silence audible. The obvious next move was to stop reading
about it and start the Postgres.

**52 tests failed across 18 files** on the first run of the suites that no automation has ever
executed.

### What was mine

`engine.test.ts` — every ops-agent integration test — failed with **`permission denied for table
otp_send_log`**. The migration I had written hours earlier created the table, typechecked, linted,
and passed a 1669-test gate **while being unusable by the only process that needs it.**

Two things were missing, and the second is the one worth keeping. There was no RLS, no policy and no
grant at all. Adding them for `cello_service` — the role every sibling migration grants — **still
failed**, because the ops agent connects as `cello_ops_agent`, a role V26 created and deliberately
scoped to the registration tables and nothing else.

**Rule:** least privilege means a new table is invisible to a role until that role is *named*. A
grant block that looks correct, matches every neighbouring migration, and grants the wrong role
produces a table that exists and cannot be used.

V63 was amended in place rather than patched by a V64: it exists only in a local docker volume, has
never been deployed, and the numbering tripwire confirms nobody else took 63 — so the M5
retrospective's rule applies in its stronger form, *get it right the first time*.

### What was not mine, and got fixed anyway

`m6b-016` failed with a duplicate-key violation — **passing in isolation, failing in the suite**,
which is the signature of a shared resource rather than a broken assertion. Every test in the file
hardcoded the same phone number, and `registrations` carries a partial UNIQUE index on the active
phone stub. Unique per-test `userId`s hid it, because the cleanup expires the active registration
for *this* user and one test legitimately creates a second. The phone is now per-test, which removes
the contention rather than teaching the cleanup to chase it.

### Where it stands

**operations-agent: 20 files, 236 tests, all green against a real Postgres** — including
`engine.test.ts`, the DoD's own named example, whose 17 tests had never once executed. Among them
the OTP rate-limit tests that are the only coverage of the limiter's key.

**28 failures remain, all in the `directory` package, all pre-existing.** They are not this unit's
and they are too large for one — carried as `DOD-M15-DIRECTORY-ROT-1`.

**Rule:** "the tests are skipped" and "the tests pass" are different claims, and a milestone that
audits its own evidence has to spend the twenty minutes finding out which one it has.

## Entry 18 — "28 rotten tests" was the wrong diagnosis, and triaging first changed the work

Entry 17 closed with 28 directory failures carried as `DOD-M15-DIRECTORY-ROT-1`, described as tests
that "have been red for as long as nobody ran them". That framing was wrong, and the DoD line I had
just written told me to triage before fixing. Doing so took about twenty minutes and turned a
28-item repair list into one defect plus one structural problem.

### What the evidence actually said

Four checks, in order, each one prompted by the last:

1. **Ran the project twice, back to back.** The failing sets were *different*. A stable list of
   broken tests does not do that.
2. **Ran the failing files individually.** Nearly all of them passed.
3. **Reset the database completely and ran the whole project on freshly applied migrations.**
   Still **32 failures**. So it is not pollution accumulating across days — **the suite poisons
   itself within a single run.**
4. **Ran the remaining suspects individually on that fresh database.** All passed but one.

### The finding

**One genuine defect:** `m6b-009-pg-pool-config` — "pool max enforced under concurrent load" fails
alone, on a clean database. That is the only one of the 32 that is about the code under test.

**The other 31 are cross-file database contention.** The files share one Postgres, and the tests that
fail are precisely those asserting **whole-table properties**: `verifyChain` across an entire chained
table, per-pseudonym aggregate statistics, "no leaf appears in more than one checkpoint", row counts.
Any other file writing to those tables breaks them. This is not parallelism — `vitest.config.ts`
already runs one file at a time with `maxForks: 1`. It is shared state with no teardown.

### Why this matters more than the number did

**These assertions can only ever have passed when their file was run alone.** The directory's
integration coverage has never worked as a gate. That reorders the milestone's own plan:
`DOD-M15-COMPOSE-CI-1` wants these suites wired into CI, and wiring them in today produces an
immediately red pipeline — so `DIRECTORY-ROT-1` is a **blocker** for it, not a parallel nicety.

It also puts a bound on the earlier good news. Entry 17 celebrated 236 ops-agent tests going green
against a real database. That still holds — but the reason the directory half looked worse is not
that it rotted harder; it is that the directory tests make **whole-table** claims and the ops-agent
tests mostly do not.

### The rule

**Triage before repairing, and let the shape of the failures pick the diagnosis.** Three properties
were visible for free and each one ruled out a whole class of explanation: the set *moved* between
runs (so not a fixed list of broken tests), the files *passed alone* (so not the code under test),
and a *fresh database did not help* (so not accumulated pollution). Twenty minutes of that turned
"fix 28 tests" into "fix 1 test and one isolation model" — and the second is real work with a real
design choice in it, which is exactly the kind of thing a repair list hides.

**Corollary, recorded because I nearly did it:** the tempting fix is a global `beforeEach` that
truncates the shared tables. That would make every file's passing depend on running inside a suite
that truncates — the same fragility pointing the other way, and invisible until someone runs a file
alone. The DoD line now names scoping-to-own-rows or per-test transactional rollback instead.

## Entry 19 — the last directory "defect" was not one either

Entry 18 ended with *"one genuine defect: `m6b-009-pg-pool-config`"*. Chasing it down, that is wrong:
**none of the 32 directory failures is a defect in the directory.**

AC-001 threw `DATABASE_URL is required for AC-001 integration test`. Forty lines above it in the
**same file**, AC-002 defaults to `postgresql://postgres:dev@localhost:5433/cello_dev` — and so does
`persist-004-hash-chain`. So under the command the repo documents
(`docker compose up -d && CELLO_ENV=local pnpm run test`) this test never tested pool concurrency.
It reported a red environment error, every time, forever. Given the default its siblings already
use, it runs and passes.

**Rule:** failing loudly on a missing precondition is right; inventing a precondition your siblings
default away is a test that never runs. And a test that never runs is not a test — which is the same
sentence this milestone opened with, arriving from the other direction.

### The thing worth keeping, found sideways

While chasing that, the unreachable-database path logged this on its way to `exit(1)`:

```
{"event":"directory.db.unavailable","level":"error","host":"localhost","port":"5433",
 "database":"cello_dev","nodeId":"local","env":"local","reason":""}
```

The loudest line the process emits, carrying no cause at all. The code was preserving `err.message`
faithfully — pg had thrown an `Error` whose message was **empty**. It cost me a wrong first guess
about which credential was at fault before I read the source.

A blank message is not a reason to fall silent: pg attaches a `code` — `ECONNREFUSED`, `28P01` for a
bad password, `3D000` for a missing database — that names the fault exactly. `describeCause` now
falls back through code, then constructor name, then a literal statement that the error carried
nothing, so the reader always learns whether the silence is **ours or the driver's**.

**Rule (Invariant 3, sharpened):** "preserve the upstream cause" is not satisfied by forwarding a
field. It is satisfied when the field can never be empty. `err.message` is not guaranteed to say
anything, and the one time it says nothing is the one time someone is reading.

### Where DIRECTORY-ROT-1 now stands

All 32 failures are cross-file database contention: files share one Postgres, and the failing tests
are the ones asserting **whole-table** properties. That is the whole of the remaining work, and it
carries a design choice (scope assertions to own rows, or per-test transactional rollback) rather
than a repair list.
