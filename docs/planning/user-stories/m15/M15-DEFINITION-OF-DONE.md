---
name: M15 Definition of Done
type: definition-of-done
date: 2026-08-21
milestone: M15
status: open
topics: [m15, hardening, pre-launch, security, injection, relay, transport, seal, encryption, claims, definition-of-done]
description: >
  The yardstick and sole status authority for M15 (pre-launch hardening). Tiers encode DEPENDENCY
  ORDER ONLY — the gate is a state, not a date, and every line here is inside it. Flip tags in
  place with one line of evidence and a journal pointer. Read M15-PROCEDURE first.
---

# M15 Definition of Done

**Read [[M15-PROCEDURE]] first.** This document is the scoreboard; the procedure is how to work it.
Evidence, proofs, reviewer verdicts and run output live in [[M15-BUILD-JOURNAL]], never here.

## How to read this

**Tags:** ❌ not started · 🟡 implemented, not yet reviewed · ✅ done (written AND reviewed, with the
reviewer's verdict quoted in the journal) · 🅿️ parked with a trigger.

**A tier is a dependency boundary, not a priority.** The gate is a **state** — every line below is
inside it, launch waits for all of them, and nothing is descoped for time (M15-PROCEDURE §0z). If a
line turns out bigger than expected it takes longer; that is the correct outcome, not a trigger to
argue scope.

**A line's clauses are expanded at pull time**, not here — the coder writes the full clause checklist
into the journal before implementing (M15-PROCEDURE §2 step 2), and that checklist is what the
reviewer receives. What is written below is the target and the clauses that are load-bearing enough
that losing one would silently change the meaning of the line.

**Lines that name an enforcer are ✅ only when that enforcer ran as separate OS processes**, with the
run output quoted. Vitest green is necessary, never sufficient.

---

# Tier 0 — The verification spike (blocks scoping, not building)

Three questions that **cannot be answered by reading source**. Their answers change the scope of
other lines, so they run before anything else is scoped. Hours, no code.

### `DOD-M15-SPIKE-1` — ✅ What the live deployment actually does
> **All three answered 2026-08-21 → Entry 1.** (a) Step-6 directory auth **IS active**:
> `daemon.manifest.bundled` 115, `.skipped` 0 — `DOD-M15-DIRAUTH-1` does not escalate. (b) Both
> relays log `count=3, anyDirectory=True` on every restart back to 2026-08-17 — **the feared silent
> single-directory dependency does not exist.** (c) Selection is **not random**: both relays are
> requested (`reservationsRequested: 2`) but one carries **2,648 of 2,675** reservations (99%), so
> `DOD-M15-MULTIRELAY-1` delivers availability only and the linkability claim is **withdrawn**.
> No diff, therefore no unit review; every command is quoted in Entry 1 and re-runnable.
Read the running fleet and the running daemon; write the three answers into the journal with the
evidence, and re-scope the lines each one touches.
- **(a) Which directory-authentication path fires in production.** The roster challenge runs only
  when the resolved directory URL byte-matches a bundled endpoint, and the production URL is a raw
  IP specifically to satisfy that match. Two log events discriminate challenge-ran from
  challenge-skipped. **If it is skipping, the production client is not authenticating the directory
  at all** and `DOD-M15-DIRAUTH-1` changes character.
- **(b) The relay's configured directory-key set.** The keys come from environment variables; if the
  extra-keys variable is empty the relay silently accepts assignments from **one** directory, so a
  session brokered by either of the other two is unusable. **This is a value-delivery risk hiding
  inside a security item** — read the deployed value.
- **(c) How an agent's relay is actually selected.** Decision 7 accepts the relay's long-lived
  per-agent handle on the basis that spreading reservations across relays erodes it. That holds only
  if selection actually spreads. If the rule is deterministic (first reachable, lowest index,
  nearest region) the agent reserves with the same relay every time and `DOD-M15-MULTIRELAY-1`
  delivers availability and nothing else — in which case either make it spread or withdraw the
  linkability claim.
- **Ships as:** a journal entry, three answers, three re-scoping notes. No code, no branch.

---

# Tier 1 — Claims (no dependencies; starts immediately)

Everything already readable by someone outside — the public repo, the shipped package, the product's
own output. The unpublished investor and GTM material is **not** in this tier (M15-PROCEDURE §0a.1).

### `DOD-M15-LEDGER-1` — ❌ Every live claim is in the ledger with a disposition
Build the claims ledger (M15-PROCEDURE §1d) as a section of this document. One row per claim: its
current text, where it appears, and its disposition — **made true**, **withdrawn**, or **disclosed as
a bounded property**.
- Sweep all four live surfaces: the public `cello-client` repo (root docs, README, comments), the
  shipped npm package (tool descriptions, skill prose, CLI help), product status/CLI output, and
  shipped client documentation.
- **Partially true is false.** A row whose claim survives only with a qualifier gets rewritten or
  withdrawn, never softened.
- A claim with no row is an unaudited claim; the line is not ✅ while a surface is unswept.

### `DOD-M15-AUDITME-1` — ❌ `AUDIT-ME.md` survives the audit it invites
Rewrite `AUDIT-ME.md` at the root of the **public** `Mygentic-AI/cello-client` repo.
- Four of its seven cited file paths no longer exist (pre-repo-split layout) — every path resolves,
  verified by opening it.
- Its encryption claim's supporting detail is wrong: it says content is additionally encrypted at
  the application layer, **true only for parked content**, and cites the database backup file as
  evidence. Corrected to what the tree does, per Part 13 of the relay audit.
- States the relay's **metadata** visibility (who talks to whom, when, how often, sizes) beside the
  true claim that the relay cannot read content — so it is disclosed, not exposed by a follow-up.
- **The claims in it are true; the document proved them badly.** The rewrite proves them.

### `DOD-M15-CLAIM-SCREEN-1` — ❌ Nothing reports screening as active while its semantic half is inert
Until `DOD-M15-SCREENINSTALL-1` lands, no status output, tool description, skill prose or document
may present inbound screening as fully active. When it lands, this row flips to made-true.
- Distinguishes the character-denylist layer (live) from the semantic layer (not installable).
- **Withdrawal now, truth later** — both dispositions are legitimate; silence is not.

### `DOD-M15-CLAIM-COMMENTS-1` — ❌ No comment in the public repo asserts a property the code lacks
The six known checked-then-ignored instances; three carry such a comment.
- **Rewrite, never delete.** The comment is why the gap survived review; deleting it destroys the
  evidence that someone believed it. It is rewritten to describe what the code actually does and
  what it deliberately does not.
- Includes both halves of a mutual deferral: the directory's *"deferred to a follow-on story since
  clients perform this verification locally"* and the client's *"deliberately NOT compared at this
  layer"* — each pointing at a check the other does not perform.

### `DOD-M15-DISCLOSE-1` — ❌ Shipped documentation discloses what the architecture cannot remove
- **A direct session permanently reveals the operator's IP address to the counterparty.** No gate,
  port change or ephemeral identity removes it; anyone who has talked to you directly can flood you
  afterwards with no protocol remedy. The shipped client documentation currently says nothing.
- **The relay's metadata visibility**, as above.
- **The single-node relay assignment as a bounded property** (relay-audit Decision 4(a) explicitly
  required this be written down rather than silently left): one directory node's key signs the
  relay-facing assignment while the client-facing artifact requires a threshold; its reach is a
  relay-side session record and a Peer ID binding, gated behind also being an authenticated
  participant named in it; **it cannot make the permanent record lie.** Carries the deferred
  (b)-vs-(c) evaluation as an open item with a trigger, so it does not resurface as a fresh
  discovery.
- **The relay's long-lived per-agent handle, disclosed rather than claimed-mitigated.** The standing
  receiver holds a reservation from agent-online, independent of any session, and **measurement
  shows one relay carries 99% of an agent's reservations** (`DOD-M15-SPIKE-1(c)`, Entry 1). Decision
  7 accepted this on the basis that spreading reservations would erode it; that basis does not hold,
  so the linkability claim is **withdrawn** and the property is stated instead: one relay can
  correlate an agent's sessions over time. The April design made relay/directory operator separation
  a protocol constraint precisely to stop a single party doing this; say so rather than let it be
  discovered.

---

# Tier 2 — Make detections act, and close the doors

The checked-then-ignored class and the unauthenticated surfaces. **Runs in parallel with Tier 3** —
different repos, different disciplines, neither blocks the other.

### `DOD-M15-DIVERGE-1` — ✅ A divergent local tree blocks the seal instead of printing a string
> **Shipped and reviewed 2026-08-21 → Entries 2, 5.** cello-client `4478a03` + `9f05300`. Ten
> review findings, three blocking, all fixed. Gate: 3997 tests, lint, forced typecheck, build.
> **Clause 2 shipped NARROWER than written — amended below, with two follow-on lines.**

- Local/relay leaf divergence is already detected correctly on the next send and already logged as
  an error. **The log line stays** (M15-PROCEDURE Invariant 2). What is added: the agent is told in
  the response, and the session is **blocked from sealing** — on the operator-driven close **and**
  on the away one-shot path that seals with no operator present.
- The seal-readiness check becomes symmetric **for the PROVEN parting**: `ready` now also fails when
  an ack has come back behind this side's frontier, the case where the tree demonstrably holds a
  leaf at a position the relay assigned elsewhere.
  > **AMENDED 2026-08-21, after review.** As written this clause said "must also fail when the local
  > tree holds leaves the relay never witnessed", which covers **three** producers; one shipped. The
  > other two are *suspected* rather than proven partings, and gating on them risks the false
  > positive this codebase calls worse than the bug — force-abandon with no receipt as the only
  > exit. They are `DOD-M15-UNWITNESSED-1`, not dropped. **The reviewer confirmed the narrowing is
  > substantively right, not merely defensible:** the peer-side check this gate pre-empts compares
  > **leaf count**, not content, so an unwitnessed *received* leaf — which both peers hold — changes
  > neither count, and gating on it would be a pure false positive.
- **Enforcer:** receipt. *(Not run — the unit is carried by suite + review; the enforcer itself is
  built by `DOD-M15-INTERRUPTED-1` and this line is re-asserted there.)*

### `DOD-M15-UNWITNESSED-1` — ❌ The two SUSPECTED partings are judged, not ignored
Split from `DOD-M15-DIVERGE-1` on review — that clause covered three producers and only the proven
one could ship safely. **Neither of these is visible to `sealReadiness` today.**
- **(a) An unwitnessed RECEIVED append.** `ingestReceivedContent`: a relay is attached, no witness
  bound the hash, the content is logged at WARN (`session.content.unwitnessed`) and **ingested
  anyway.** This is the direction an injected leaf appears in, so it is where `DOD-M15-FRAME-1`'s
  attack lands. **Gating on it today would be a false positive** — both peers hold the leaf, so leaf
  counts still agree. The useful work is separating "the relay has not witnessed it *yet*" from "it
  never will", which needs a fixture that can attach a relay client.
- **(b) An unwitnessed OWN send** — `assignedSeq === undefined`, the relay-degraded append. **Found
  by the review; not in the original record.** It sets no flag, emits no ERROR, and reads ready —
  while `placeOwnLeaf`'s own comment says *"the seal was already lost at the unwitnessed append, not
  here."* **So the gate fires one send later than the code says the damage happens.**
- **Do not gate either on suspicion alone.** The bar is a signal separating a relay catching up from
  a leaf it will never carry.

### `DOD-M15-DIVERGE-DURABLE-1` — ❌ The divergence flag survives a daemon restart
`#diverged` is in memory. `DOD-M15-DIVERGE-1` closed the in-process hole — it is no longer dropped
on node teardown, only at a terminal status — but a restart still empties it, and the read site
cannot distinguish *not diverged* from *forgotten*: both are `false`, both read ready.
- **Not the same trade `frontier-mismatch.ts` accepts on purpose.** A frontier mismatch is
  **re-detected by the very next close**; divergence is re-detected only by the next send that gets
  an ack behind the frontier. A restart therefore costs a **wrong answer**, not a re-detection.
- Needs a column. Until it lands, no guidance may promise that a retry answers identically.

### `DOD-M15-FRAME-1` — ❌ A stranger cannot inject content on the direct path
One diff across the session content handler and the connection gater; fixing any subset leaves the
injection path open.
- The direct-path **content frame** is pinned to the dialing peer: `remotePeerId` must equal the
  session's counterparty Peer ID, and `session_id` is required-and-equal. The session-abandon
  handler three blocks above already does exactly this.
- The direct-path **delivery acknowledgement** is pinned the same way. A forged ack today cancels
  the park-on-undelivered timer, so a stranger holding an open connection can make an operator's
  messages vanish while they appear delivered.
- **Then audit every other handler registered on the session protocol** — not only the two named.
- **Missing, malformed and mismatched take ONE hard-fail path.** Non-negotiable and separately
  testable: an attacker evading a mismatch check simply supplies no proof at all.
- **Promotion disconnects peers not on the new allow-list.** libp2p's gater runs only at connection
  establishment, so narrowing it leaves a pre-positioned stranger attached when the content protocol
  activates.
- The refusal is **session-ending, not per-message**, and its status is distinct from an ordinary
  "counterparty absent" close, worded as an observation — *"a message failed to verify against the
  expected counterparty's key; session frozen defensively; cause undetermined"* — never as an
  assertion of intent, and **excluded from feeding any trust-signal or reputation score.**
- **Enforcer:** stranger.

### `DOD-M15-ASSIGN-1` — ❌ The assignment is verified, then gated on
**Order is load-bearing: verification lands first.** Gating on an unverified document relocates
trust rather than closing it, so a release carrying the gate without the verification is worse than
neither. They ship together.
- **(a) The client verifies the directory's signature on the session assignment.** Today the parser
  shape-validates only, asserting signatures are 64 bytes, with a comment naming a downstream
  verification site that does not exist in the tree.
- **(b) The standing receiver refuses any dialer whose Peer ID is not named in a live,
  directory-signed assignment.** The responder always reports its Peer ID before the counterparty
  dials, so the assignment always exists in time. No trusted-tier bypass — the gate sees a transport
  Peer ID minted per session and unknowable in advance; trust tiers do their work one layer up at
  session acceptance (Decision 2).
- **This also closes the `identify` disclosure**, which has no other mitigation on the list: a
  stranger currently receives the agent's public key, listen addresses and protocol list.
- **Enforcer:** stranger.

### `DOD-M15-SURFACE-1` — ❌ The daemon stops listening where nothing dials it
- **The directory-facing node stops listening entirely.** It binds `/ip4/0.0.0.0/tcp/0` — a real
  open port on every interface — registers **no protocol handler**, and the directory **never dials
  a client**. An empty listen configuration removes it from the attack surface: no socket, nothing
  to scan, nothing to gate. *Fallback only if something turns out to need inbound there:* install
  the existing `DirectoryConnectionGater`, which is written but constructed only in tests. **Not
  listening is the fix; the gater is the consolation prize.**
- **Unauthenticated idle connections are dropped on a timer.** A connection that completed the
  handshake, authenticated to nothing and did nothing is a foothold waiting for the door to narrow.
- The standing receiver's socket **stays** (Decision 2) — it is load-bearing for same-machine and
  same-LAN sessions, which the launch intent names explicitly, and it becomes required again if hole
  punching is ever repaired.

### `DOD-M15-RELAYAUTH-1` — ❌ No relay service without a directory-issued assignment
**Depends on `DOD-M15-ASSIGN-1`** — the client must be presenting a verified assignment before the
relay can require one. Decision 3(b): the relay **verifies a credential the caller presents** and
learns nothing itself; it does not query the directory. This preserves extractability — a private
enterprise relay stays a signature-verifier rather than becoming a directory client.
- Relay service requires an assignment naming the caller as a participant — **including collecting
  parked content**, where the original session's assignment is the credential the caller already
  holds.
- **The liveness query is scoped.** Today it has no participant check and no session check: it
  carries a session id the handler never looks at and answers from a **global** map, so anyone with
  a list of pubkeys can build a live map of who is active and when. Requires the caller to be a
  named participant, and answers only for that session.
- **The relay verifies that an authenticating key is a registered agent**, rather than accepting any
  Ed25519 keypair.
- **A connection gater on the relay, including the reservation-dial hook.** Reservations are granted
  to any peer up to 4096, and the hook restricting who may dial *through* to a reservation holder is
  never installed — so an agent's circuit address is dialable by anyone who learns it. **This is the
  relay-side twin of the receiver gate**; without it that gate closes the direct route while the
  circuit route stays open.
- **Enforcer:** stranger, on the circuit path as well as the direct one.

### `DOD-M15-SWEEP-1` — 🅿️ The checked-then-ignored class is hunted, not patched
**Trigger: after `DOD-M15-FRAME-1` and Tier 4's seal change**, so the sweep hunts the unknown
seventh instance rather than rediscovering the six already on this list. Parked only for sequencing —
it is inside the gate.
- For **every** frame handler and **every** verification call in daemon, directory and relay, answer
  two questions: does a failed check take a hard-fail path, and does a **missing or malformed** proof
  take the same path as a mismatched one?
- Fix every hit. **Rewrite — do not delete — every nearby comment asserting a property the code does
  not enforce.**
- Unknown scope by construction. It takes as long as it takes (§0z).

---

# Tier 3 — The basic value actually being delivered

Parallel with Tier 2. Source is [[launch-triage]] — **read its header warning before trusting any
status marker there.** Items are cross-referenced by their triage designation.

### `DOD-M15-SUBMIT-ID-1` — ❌ A retried message stops killing its conversation
`DOD-M12B-SUBMIT-ID-1` + the rest of [[M12B-DEFINITION-OF-DONE]]. **The top line of this tier:**
basic messaging between two healthy agents, failing silently and unrecoverably. One message consumed
49 canonical positions; verified content destroyed at teardown fired 20 times on one daemon in one
day.
- A submission id inside the signed frame, so a retransmission is declarable.
- An idempotent `hash_submit` returning the original position without advancing the counter or the
  relay's own tree.
- A client that stops re-asking, and position discipline so a leaf index **is** its assigned position.
- **`DOD-M12B-ACK-1` — what stops the FIRST acknowledgement — is inside this line**, not a follow-on.
  The spiral needs one unacknowledged send to start and that first failure was never traced. The
  residual document-reconcile gap (2 holds per 20 minutes) has the same root and closes with it.
- Bilateral wire contract: the relay tolerates the new shape before any client depends on it.
- **Enforcer:** journey, including a retried send.

### `DOD-M15-BOOTSTRAP-1` — ❌ One lost packet stops dropping a directory from the roster
`DOD-BOOTSTRAP-PROBE-RETRY-1`. Fails for a normal user on a lossy link with nothing wrong anywhere
in the system.
- `fetchBootstrapResult` gives each node one attempt with a 5-second deadline and no retry; a probe
  that loses a packet is abandoned inside TCP's retransmit backoff. Measured over a mobile link: one
  request returned at **16.2 s**, another returned nothing in 30 s.
- ~3 attempts at ~8 s with a bounded total (~20 s). **A longer deadline alone does not fix it** — the
  win comes from a fresh connection, not a longer wait.

### `DOD-M15-ERRSTRING-1` — ❌ An error names what was observed, never an inferred conclusion
`DOD-COUNTERPARTY-OFFLINE-LIE-1`. One string, `counterparty_offline`, returned on 2026-08-16 for a
garbage-collecting node, a roster below threshold, and a stale gateway — naming a party that was
online in all three and nothing that was broken. Most of a day lost in the wrong subsystem.
- A roster below threshold says so. A node that cannot be reached is named.
- Generalises to Invariant 3: **downstream never overwrites an upstream descriptive error.**

### `DOD-M15-TRANSPORT-TERMINAL-1` — ❌ A transport blip stops killing a healthy conversation
`DOD-M12B-TRANSPORT-FAULT-NOT-TERMINAL-1`. Upstream of the two lines below it; fixing it likely
shrinks both.
- `rejectSeal` terminalises unconditionally on every path, with no branch for "the failure was
  transport, not merits."
- Distinguishes a transport failure (could not reach a directory) from a merits failure (a directory
  examined the seal and refused it). **Only the merits case terminalises**; a transport failure
  leaves the session active and retryable.

### `DOD-M15-TERMINAL-REASON-1` — ❌ "Sealed" and "gave up" stop being the same word
`DOD-M12B-TERMINAL-REASON-1`. Two sides of one dead conversation get two stories and both behave
correctly given what they were told; one believes it holds a receipt and holds nothing.
- `session_sealed` is currently the reply for **every** non-active status, `seal_rejected` included.
  `rejectSeal` is handed the real cause at its call site and discards it — the parameter is
  underscore-prefixed and reaches nothing but a log line.
- At minimum three distinct terminal reasons — notarized / refused-permanently / still-in-progress —
  **with a defined meaning for an unrecognised reason**, so an older client fails safely rather than
  misreading a new answer.
- Wire-visible: the relay tolerates the new reasons before any client depends on them.

### `DOD-M15-PULLRECOVER-1` — ❌ The certificate pull is proven to work, or proven to be asking wrong
`DOD-M12B-PULL-NEVER-RECOVERS-1`. **157 attempts, 0 recoveries**, on one daemon in one day. This is
the only safety net standing between "the relay said sealed but lied" and "the receipt is gone."
- **Establish WHICH explanation is true first** — the certificates genuinely are not there, or the
  recovery path cannot find records that do exist. That is its own measurement, not an assumption.
- **The trap:** do NOT read a `not_found` as proof no certificate exists and auto-repair a terminal
  row on it. Homing moves are in the same day's logs, the record may sit on another consortium node,
  and a grace window may not have elapsed. Treating absence as proof would destroy genuinely
  terminal state — strictly worse than the divergence it exists to repair.

### `DOD-M15-INTERRUPTED-1` — ❌ An interrupted session can seal, and it has been watched doing it
`DOD-TERMINAL-STATE-DIVERGENCE-1`, both halves (launch-triage item 5).
- **The cure acts on its own initiative.** Today the pull fires only when an operator hits the stuck
  state; a session stranded and never touched again stays stranded. A startup sweep.
- **The proof runs.** Open a session, exchange messages, restart the daemon to interrupt it, close it
  — inside the relay's 24-hour retention. **Assert on the session's STATUS, not only the
  certificate**: a receipt was previously stored against a row still reading `interrupted`, so the
  close verb refused it by name and the resolver re-ran the whole ceremony on the next boot.
- **NOT blocked** (Andre, 2026-08-21): *"You do not need throw away agent tokens. Use existing
  ones."* Run against existing registered agents — `CELLO_Coder_1` and `CELLO_Support`
  (`f8d518ca0b5596fd0f383f17f03560975ea210a763249b342fd767bd067c2f3c`) locally, or `Miss_Chelly_H`
  on the Hermes EC2 instance for a genuinely different device. **Check the chosen agents hold no
  open sessions before running** — the proof seals what it touches, and that is managed by
  selection, not assumed away.
- Pre-V58 sessions can never be served by the pull; that is recorded, not repaired.
- **Enforcer:** receipt.

### `DOD-M15-CLOSEWAIT-1` — ❌ A close answers the caller before eleven minutes elapse
`DOD-M12B-CLOSE-SILENT-WAIT-1`. Half fixed — the wait now announces itself, which stopped operators
reaching for `force: true` and forfeiting the receipt the wait was about to earn (17 sessions were
lost that way).
- The caller still waits out `CELLO_SEAL_BILATERAL_TIMEOUT_MS` (660,000 ms) before the escalation
  that then succeeds. Measured 11m 06s.
- **Answering early orphans the unilateral escalation that runs inline after the wait** — that
  changes the close contract and what produces the receipt. Decide the contract, then build.

### `DOD-M15-SIGNUP-1` — ❌ Signup throttles a person, not their employer
`DOD-OTP-RATELIMIT-KEY-1`. The sixth person from a domain in an hour is refused a verification code.
An invite wave **is** a burst on one domain.
- Rekey the limiter from the email domain to the address fingerprint the code already computes one
  line below (`hashEmail`). Holds no new data and leaks nothing the system does not already keep.
- **Make it durable** — a table in the bot's own database, not an in-memory `Map` that resets on
  every restart and deploy. It was wiped by the ops-agent deploy on 2026-08-09.
- Lives in the registration bot; touches neither the directory nor the protocol.

### `DOD-M15-ALERTING-1` — ❌ Something tells us when a node is unwell
`DOD-NODE-ALERTING-1`. **Zero alerting policies exist in `cello-infra`** while a node ran at 38–44%
CPU against a healthy idle of 0.3–0.4% for days.
- A policy on sustained CPU, and one on the `cello.node.memory` metric the host sampler now emits.
- **Note for anyone adding another sampler:** COS forwards journald to Cloud Logging at **WARNING
  AND ABOVE ONLY** — the first version logged at info, produced perfect lines that never left the
  instance, and cost a second roll of all three nodes.

### `DOD-M15-STALEROSTER-1` — ❌ A stale reading refuses to present itself as current
`DOD-STATUS-STALE-ROSTER-1`. Measured twice on two machines: both daemons displayed node failures
from minutes long past while `curl` reached all three nodes in 37–184 ms.
- `directory_endpoints_unresolved` freezes once the daemon returns to its healthy path, because the
  primary resolves and no roster probe runs.
- Either sweep on a slow timer even when healthy, or refuse to answer with a reading older than N
  minutes. **Do not fix it by hiding the field when stale** — absent and healthy must not look alike.

### `DOD-M15-NODEHEAP-1` — ❌ The directory's memory growth has a cause
`DOD-NODE-HEAP-GROWTH-1`. Mitigated, not fixed: the ceiling was raised to 4,096 MB, buying roughly
two weeks instead of six days. The process grows ~250 MB/day and at ~80% of ceiling the node answers
**nothing for 40 seconds** while V8 collects on the same thread that serves HTTP.
- Establish whether the growth is a leak. Evidence points **away** from client traffic — `use1` (the
  hardcoded primary) and `euw1` (failover only) sat 9% apart after near-identical uptime.
- Anti-entropy, which every node runs continuously regardless of clients, is the untested candidate.
- The 60-second sampler is running; the growth rate across the three nodes is the measurement that
  decides whether this closes or becomes a real hunt.

### `DOD-M15-IPCVISIBLE-1` — ❌ A connection closing leaves a record, and an identity switch says why
`DOD-IPC-DISCONNECT-VISIBLE-1`. **Precondition for `DOD-M15-SELECTION-1`** — that defect cannot be
diagnosed until this lands.
- `daemon.ipc.connected` is emitted on every open and **nothing on close**, so a live client and a
  dead one that was never cleaned up look identical. One log line in `ipcServer.onDisconnect`:
  `connectionId`, `clientType`, and the agent it was attending. That last field matters — attendance
  dropping is silent today, and an agent losing its last attendee changes whether away-messages fire
  and who receives doorbells.
- `agent.current.switched` fires with **no agent name and no reason**. Add the name and the trigger
  (`explicit` | `replay` | `fallback`).
- `cello agents` reports `selected` from the CALLING connection, so a client asking about its own
  state through a fresh connection always sees `false`. Rename or annotate — both Andre and a Hermes
  agent misread it during one investigation.

### `DOD-M15-SELECTION-1` — ❌ A connection is never bound to an agent it did not select
`DOD-AGENT-SELECTION-UNWARRANTED-1`. **Depends on `DOD-M15-IPCVISIBLE-1`.** One defect with two
faces: after a daemon restart a released agent was silently reinstated (under a *different*
operator's agent name on the same daemon); after an `/mcp` reconnect a selection that had been made
was silently dropped.
- **A release survives a reconnect.** After `cello_stop_using_agent`, a reconnect attends NOTHING
  until something asks again.
- **A connection is never auto-attached to an agent it did not select.** Resolving to "the only agent
  online" is defensible for a CLI invocation that needs a subject; silently binding a live MCP
  session to an identity it never asked for is not. If a fallback is wanted it is **explicit in the
  response**, not announced as an accomplished fact.
- Diagnosis first: reproduce with a daemon restart after a release, with the trigger field from
  `DOD-M15-IPCVISIBLE-1` distinguishing replay from fallback in one run.

### `DOD-M15-DOORBELL-1` — ❌ A daemon shutdown does not ring like an incoming message
Shutdown is forwarded through the notification channel with the same generic shape as a real
doorbell, so an agent following the contract calls the inbox, gets `daemon_not_running`, and reports
a protocol failure while the actual event goes unreported.
- Either do not forward shutdown through the channel, or give it distinguishable metadata.

### `DOD-M15-CHAINHEALTH-1` — ❌ Tamper-evidence can be checked without SSH
`DOD-ACCOUNTS-CHAIN-1`, the remainder. The writer is fixed, deployed and the data re-measured clean
(11 rows per node, `verifyChain` VALID on all three). What is missing is that answering *"is it still
intact?"* requires IAP SSH to each node and credentials out of Secret Manager — which is why a stale
"it is broken" note survived four days and nearly caused a destructive repair.
- `verifyChain("user_accounts")` on the ops-agent health output.
- Spin-off recorded, not repaired here: `DOD-ACCOUNTS-EMAIL-CHAIN-1` (the email half is stored but
  not chained), and the test-isolation defect where several suites `DELETE` from this append-only
  chained table.

### `DOD-M15-SAMEOP-1` — ❌ Same-operator standing does not depend on which node answered
`DOD-SELF-STANDING-NULL-LINKAGE-1` + the security half of `CELLO-REPL-001`.
- **The account arm reads a node-local column.** Measured live for one operator with three agents:
  `usc1` had 2 linked, `euw1` 1, `use1` 0. **Searching every node does not fix this** — the
  first-node-with-a-hit strategy may return the one holding the NULL link. The reader moves to the
  replicated table, and **this is the reader to move first.**
- **Case 1 stays open and is answered here:** the flag is false when both agents have no account and
  no verified phone, because nothing links them. Determine whether that state is reachable by an
  agent that can submit, and close it or record the bound.
- Case 2 (unresolvable issuer) was closed by `DOD-END-ISSUER-REGISTERED-1`; do not re-open it.

### `DOD-M15-ENDORSE-RETRY-1` — ❌ A trust signal reaches the directory when one node is down
`DOD-END-SUBMIT-1`'s handed-forward AC. Previously triaged ship-without; **in scope under the basic-
value criterion** — "mint a trust signal and have it received" is advertised value.
- Submission fails over to another node rather than failing and requiring the operator to re-run the
  command. The consortium has three.
- **Verify at the same time** whether the refuse-op drain gap closed when `cello-portal-ingress-drain`
  shipped; nobody has checked since.
- **Enforcer:** journey.

### `DOD-M15-BACKUP-1` — ❌ An identity can be exported and restored
`DOD-CUSTODY-DAEMON-1`. `backup` and `restore` exist as commands and report "not implemented"; a lost
machine loses the agent permanently.
- **Backup** = exporting the SQLCipher database for transport.
- **Restore V1** = overwrite the existing database on the target device.
- **Merge** — restoring onto a device with its own live state — is **explicitly deferred** (see
  Explicitly Beyond). Launch ships export + overwrite-restore.
- The logic moves out of the chat-tool layer into the daemon as an actual capability. A round-trip
  proof is owed.

### `DOD-M15-SCREENINSTALL-1` — ❌ The semantic screener runs against real weights, at least once
`DOD-DOC-SCREEN-INSTALL-1` + `DOD-DOC-SCREEN-CLASSIFIER-1`. **Sequence after `DOD-M15-FRAME-1`** —
shipping the classifier while the direct path bypasses the whole screening layer gives you screening
an attacker walks around.
- `installModel` has no production caller anywhere: no command, no `@huggingface/transformers`
  dependency, not even optional. Ship the install path — command, optional dependency,
  `--allow-unpinned-digests`.
- **Observed running against real weights at least once**, in production, with the ACTIVE startup
  line witnessed. Every test today runs against an injected fake because no weights are downloaded
  in CI.
- **`DOD-DOC-SCREEN-DOUBLE-DECODE-1`:** every document frame is CBOR-decoded twice, against a
  resource budget whose own header says the doubling was measured and rejected — a hostile input the
  budget was built to catch may now clear it.
- **`DOD-DOC-SCREEN-STARTING-CONTENT-1`:** a document's initial seeded content — the largest single
  block of peer-authored text an operator ever receives — gets only the character denylist.

### `DOD-M15-DOCPROFILE-1` — ❌ The agreed content profile is enforced by something
`DOD-DOC-PROFILE-1`. Two parties agree a profile at the handshake; it is bound into the document id
and immutable for its life, and **no verb consults it.** An operator who deliberately chose the
restrictive profile gets exactly the protection of one who did not think about it.
- Not a break — inbound updates are still screened by the general rules — but the setting is a
  promise the system does not keep.

### `DOD-M15-HEARTBEAT-1` — ❌ Directory nodes can see each other's heartbeats
`DOD-HEARTBEAT-REPLICATION-1`. Every node reads the other two as never-heartbeated and counts
`availableNodes: 1` against `requiredThreshold: 2`; federation checkpoints have **never once
succeeded**.
- **Established by measurement, do not re-derive:** this did NOT cause the sealing outage — the
  degraded count was already true *during* seals that worked.
- **Cost, stated before anyone starts:** `last_heartbeat_at` is mutable, so it cannot join the Tier-A
  immutable set. This means a Tier-B mutable merge with a version column — a new merge table, not a
  one-line spec edit.
- **A code comment blaming a "BIGSERIAL `id` collision" is wrong** and would send the repairer at the
  wrong fix; rewrite it (Invariant / `DOD-M15-CLAIM-COMMENTS-1`).

### `DOD-M15-MISMATCH-1` — ❌ An unsealable mismatch leaves a durable trace
`DOD-FRONTIER-MISMATCH-DURABLE-1`. The strand itself is closed (dedup is keyed on relay-assigned
position), but the mismatch flag is held **in memory and dies on every daemon restart** — which
undercuts the "a live session sat unsealable for a week" concern that made this severe.
- **Prefer derive-on-read from the persisted seal-rejection record**; it cannot drift from the
  evidence, where a written flag can.
- Inherited caveat: three paths still end unwitnessed (relay down, terminal assignment rejection,
  retry exhaustion), so **relay position is not total** and anything keyed on it must not assume it
  is.

---

# Tier 4 — Own the encryption, then bind the receipt

**The largest coupled pair in the milestone, and both are inside the gate** — ruled on the migration
argument: a wire and schema change is cheapest against an empty database and never gets cheaper.
`DOD-M15-KEYAGREE-1` **must precede** `DOD-M15-SEALWIRE-1`; it produces both outputs the seal change
consumes.

### `DOD-M15-KEYAGREE-1` — ❌ CELLO owns its own confidentiality guarantee
Relay-audit Decision 5(b), with the PQ hook built in from the start.
- Live content today is plaintext inside libp2p's Noise session. Confidentiality is real, but it is
  **libp2p's** key agreement over **libp2p's** ephemeral transport keys, so **CELLO cannot upgrade
  its own confidentiality guarantee** — PQ migration would happen on libp2p's timeline with libp2p's
  algorithm choices.
- **Urgent rather than later:** the threat is harvest-now-decrypt-later. Every cross-NAT
  conversation is relayed today, therefore recordable at fixed endpoints today, and adding the layer
  later does not protect traffic already sent.
- **Per-session ephemeral handshake**, not static-static. Each side mints a fresh keypair per
  session, agrees a session key, destroys the ephemerals at close. **Static-static would void forward
  secrecy** — a key derived only from long-term identity keys is the same key forever, so anyone who
  ever obtains an identity key decrypts every conversation that agent ever had. That is strictly
  worse than today, and [[design-problems]] already claims forward secrecy as structural.
- **The derivation accepts an additional shared secret from day one**, before there is a PQ
  contribution to put in it. Hybrid PQ then becomes mixing a second agreed secret into the same
  derivation — an addition, not a rewrite. Omitting the hook defeats the entire reason for the work.
- **One agreement, two outputs:** the message-sealing key and the per-session content-hash salt.
- The parked-content seal (X25519 + HKDF + AES-256-GCM) is the working in-tree pattern to extend.

### `DOD-M15-SEALWIRE-1` — ❌ The receipt is bound to the transcript
**One protocol change, not six. These cannot be split** — every one changes the same wire format or
depends on the domain change, and shipping any alone leaves the two sides disagreeing about what a
root means. Both repos; version-bump ACs on both sides.
- **The bilateral certified root moves into the content-hash domain** (Decision 1(a)), as the
  unilateral path already uses. Alpha is precisely when this is free.
- **The client verifies the certified root against its own tree** before accepting or co-signing.
  Today it takes the sealed root off the wire, confirms the directory signed *those bytes*, stores
  it, and **discards the root it computed one step earlier** — so the receipt proves the directory
  signed something, not that it signed your conversation. The worst moment is co-signing: **your key
  signs a root you never checked.** Once both roots live in one domain this is a one-line comparison,
  and root equality implies leaf-set equality, which also covers the missing bilateral leaf-count
  check.
- **The directory verifies the SEAL leaf's `final_root`** — and **the deferral comment is deleted in
  the same diff.** Fixing one side of a mutual deferral and leaving the other half pointing at it is
  how this gap was created.
- **The directory's circular root check is replaced.** It rebuilds a root from the same leaf array
  the relay supplied using the same code, so it validates arithmetic, not the relay, and cannot
  detect a dropped or reordered leaf. Compare against something the relay did not supply.
- **The sender's signature is stored with each leaf** (Decision 6(b)). Today the stored record has
  **no sender signature and no sender field** — a transcript row holds the message and a direction,
  and attribution comes entirely from local session state. The record must prove authorship
  independently of whatever gate was in force when it was written; that matters the moment a
  transcript is shown to anyone other than its owner.
- **The content hash is salted**, from the same handshake. It is currently an unsalted SHA-256 of the
  plaintext, so a relay holding the hashes can *guess* a short predictable message — "yes",
  "approved", a price, a name — and confirm the guess.
- **The dead `seal_attempt` path is deleted** — handler, tests, and the relay test asserting the
  frame never appears. A fully written handler with no sender reads as abandoned work to anyone
  auditing a public repo.
- **The ten spine tests are replaced.** They assert both sides ended with the same sealed root; both
  sides merely received the same bytes from the same certificate, so every one stays green if the
  directory certifies a root over a completely different leaf set. Replace with each side's **own**
  tree matching the certified root.
- **Enforcer:** receipt.

### `DOD-M15-SEALPARTIES-1` — ❌ Both real participants approve before any signature exists
The T-of-N log's Part 3 fix direction. Moves the trust anchor from *"the verifying directory node is
honest"* to *"at least one of the two real participants is honest"* — a far more natural assumption
for a communication protocol, and one that does not depend on directory behaviour at all.
- **Affirmative pre-signature approval from every real participant**, not just the initiator. Today
  the initiator re-derives the root and refuses to co-sign if inflated — a hard gate before any
  signature exists — while the counterparty runs the same comparison only **after** receiving
  `session_sealed`, by which point the result is a durable artifact with no mechanism to invalidate
  it.
- **Raw signed leaf data is forwarded to co-signing directories**, not a claimed root. Today the
  other `T−1` directories verify only that they hold a share and there is no conflicting ceremony,
  then sign whatever bytes they are handed — cryptographic weight without judgment.
- **This is the counterbalance line of the milestone** (Invariant 1): name it explicitly in the
  journal before building.

### `DOD-M15-UNILATERAL-1` — ❌ Absence is evidenced and tiered, and the artifact says what is weak
T-of-N log Decisions 1 and 2, plus its Part 4.
- **Hybrid trigger:** a time floor as a backstop, paired with an actual delivery-attempt/timeout
  record — **elapsed time alone is never sufficient on its own.** Today `#processSealUnilateral`
  compares elapsed time against `deliveryGraceSeconds` (600s) with **no presence check whatsoever**;
  a fully-reachable counterparty who takes longer than ten minutes can be sealed out from under them.
- **Two tiers.** Standard (default, unchanged): today's flat 600s, no evidence required, no
  dependency on the relay fan-out. High-stakes (**explicit opt-in** — nothing in the infrastructure
  can safely infer consequence, the relay is deliberately blind and the directory never sees it):
  **3600s starting point**, and the hybrid check is **mandatory**, not optional.
- **The artifact is split** into a full-strength mutually-signed prefix and an explicitly
  lower-weight unconfirmed tail. Everything up to the absent party's last signed message is exactly
  as strong as a bilateral seal; only the uncountersigned tail is weaker, and a downstream consumer
  must never mistake one for the other.
- **Escape-hatch risk, and why this ships near `DOD-M15-SEALPARTIES-1`:** strengthening bilateral
  sealing while unilateral keeps a self-declared clock-only trigger hands a malicious initiator an
  obvious way around the whole fix — wait out the timer, or engineer the appearance of
  unreachability. **Do not ship these far apart.**

### `DOD-M15-LEAFPARTIES-1` — ❌ Every content leaf is constrained to the session's two participants
The one question the T-of-N log left explicitly open. `verifySealLeaves` constrains only the final
two SEAL control leaves to be from two distinct participants; whether every **earlier content** leaf
is independently constrained to that same pair — as opposed to merely being internally
self-consistent — was never confirmed.
- **Verify first, then close if needed.** It did not change the MITM finding's bound, because in
  that scenario the two participants the record shows are simply A and M throughout. It is still a
  distinct unresolved question.

### `DOD-M15-INCLUSION-1` — ❌ An operator can prove a message sits under a sealed root
`cello_get_inclusion_proof` is a `not_implemented` stub. **Depends on `DOD-M15-SEALWIRE-1`** for a
root domain the client can reproduce.

---

# Tier 5 — Abuse controls, relay redundancy, infrastructure

Parallel with Tier 4 — different disciplines, no shared files.

### `DOD-M15-RELAYABUSE-1` — ❌ The relay has abuse controls
- **Rate limiting per peer and per pubkey** on authentication, hash submission, gap-fill, the
  liveness query, and content-park deposit. There is **none of any kind** today.
- **Bound the content-park store per depositor.** Deposit is unauthenticated by explicit design
  (safe, because a sender signature sits inside the seal), but with 4 MiB frames, no rate limit and
  a 256 MB store it is trivially fillable for every user at once.
- **Re-enable the per-session idle timer in the production binary** — the feature exists and the
  binary never passes it, so only a 24-hour sweep runs — and restore duration and byte caps on
  relayed connections, which are deliberately disabled.
- **Delete the directory-admin push handler, or justify keeping it in the code.** It is live, has no
  caller, and its signed body carries no nonce and no timestamp — no replay protection. Adding
  replay protection hardens a path nothing uses; **deleting it is cheaper and strictly safer.**
- **An empty `CELLO_DIRECTORY_PUBKEYS` fails startup loudly instead of degrading silently.** The
  deployed config is correct today — both relays log `count=3, anyDirectory=True`
  (`DOD-M15-SPIKE-1(b)`, Entry 1) — so this is not a live fault. What is unfixed is the failure mode
  that would hide it becoming wrong: with one key the relay silently accepts assignments from one
  directory and sessions brokered by the other two are unusable, which surfaces as random
  per-directory session failures rather than as a config gap. The startup log already makes it
  visible; make it fatal.

### `DOD-M15-RELAYLEAK-1` — ❌ Relay clients are closed
Graceful shutdown never closes relay clients, and the seal-only detached-transport path registers a
session that is never unregistered, so a cached relay client is never closed for the process
lifetime. Client-side, small, standalone.

### `DOD-M15-MULTIRELAY-1` — ❌ An agent's reachability does not rest on one relay
**Scoped by `DOD-M15-SPIKE-1(c)` → Entry 1. This line is AVAILABILITY ONLY.** The client already
requests reservations with every known relay (`reservationsRequested: 2`) — the audit's "reserves
with exactly one relay" was the outcome, not the request. But one relay carries **2,648 of 2,675**
reservations (99.0%), so the linkability mitigation Decision 7 assumed **does not hold** and that
claim is withdrawn rather than relied on (`DOD-M15-DISCLOSE-1`). Making selection genuinely spread is
an improvement, not a mitigation we are counting on; the fleet is two relays regardless.
- Inbound reachability must survive one relay going away. Today the cheapest way to take an agent
  offline is to flood the relay its reservation actually landed on — a concentrated,
  infrastructure-shaped target, the opposite of the diffuse surface the pitch describes.
- **First, explain the churn** (measured, Entry 1, one daemon's log): **2,675 `reservation.lost`,
  664 `reservation.none`, 88 retries, 9 `gave_up`**, with `reason: relay_connection_gone`. An agent
  whose reservation is gone is **unreachable by any NAT'd peer while still looking perfectly
  healthy** — exactly the silent-loss-of-inbound failure `DOD-NAT-REACHABILITY-1` was built to kill.
  Whoever pulls this line starts by explaining those numbers, not by adding relays under them.

### `DOD-M15-RELAYFANOUT-1` — ❌ A single relay's account of a conversation can be cross-checked
Serves **three** separate problems, which is a good sign it is the right thing to build: truncation
resistance at seal, evidenced absence for `DOD-M15-UNILATERAL-1`, and the corroboration layer below.
- **Truncation** is not caught by more verifiers: a primary directory that has honestly relayed the
  real conversation can submit a genuine but *truncated* prefix — every leaf validly signed, nothing
  false, only something missing. Forwarding raw leaves to more directories does not help, because
  all of them are handed the same feed by the same source.
- Fan the live hash sequence to **two or three relays** instead of one, fire-and-forget, so a single
  relay's account at seal time is cross-checkable against an independent live witness.
- **Fits the cost model:** relays are meant to be cheap, stateless and numerous specifically so this
  redundancy is affordable; directories are the few, database-backed, anti-entropy-meshed tier.

### `DOD-M15-CORROBORATE-1` — ❌ The relay verifies every hash proactively, not on request
T-of-N log Decision 4. **The defense-in-depth answer to `DOD-M15-FRAME-1`'s own new attack surface**:
the party best positioned to detect a wrong-signer event is the receiving client, which can itself be
compromised and could weaponize "signature mismatch" as a false accusation.
- **Freezing locally is always safe unilaterally** — it limits only what that client trusts. What
  must **not** be asserted unilaterally is the accusatory record.
- **The relay is the corroborating witness for a precise reason: its copy of what the sender signed
  never passes through the receiving client at all.** A compromised receiver cannot touch, edit or
  suppress it.
- **Proactive, not on-demand.** The relay is bound to the session with both participants' real
  pubkeys and already receives every signed hash; checking each against the two expected keys costs
  nothing new and **does not depend on the accusing client's cooperation or honesty** — which is
  precisely what closes the compromised-detector gap. Detection is not enforcement: alert the
  affected daemon, and consider refusing to keep relaying a session it has flagged.
- **No new cryptography** — the identical check the directory already performs at seal time,
  triggered early. **Stays inside the blind-witness design**: verifying a signature against a known
  pubkey never requires reading content.
- One relay is one witness; this becomes a decentralized detection layer only with
  `DOD-M15-RELAYFANOUT-1`.

### `DOD-M15-DIRAUTH-1` — ❌ Directory authentication cannot be silently skipped
**Scoped by `DOD-M15-SPIKE-1(a)` → Entry 1: the challenge IS running in production** —
`daemon.manifest.bundled` 115 times, `.skipped` zero. This stays hardening and does not escalate.
The byte-match workaround is holding; the fail-open underneath it is not fixed.
- The roster challenge runs **only when the resolved directory URL byte-matches a bundled
  endpoint**. A DNS name pointing at the same machine does not match, and the client then skips
  directory authentication **entirely, silently**. That is why the production directory URL is a raw
  IP: the fail-open is known and was worked around with string matching rather than fixed.
- Resolve the bootstrap coordinate over an authenticated channel; it currently comes from a plaintext
  HTTP endpoint on port 9090.

### `DOD-M15-DDOS-1` — ❌ Volumetric protection sits in front of the relay
**The only line in this milestone that addresses actual denial of service**; every other control is
application-layer and changes who is *admitted*, not how much traffic *arrives*. A gate runs after
the TCP connection is made and the handshake has begun.
- Cloud Armor or equivalent in front of the public relay endpoint, which is open to `0.0.0.0/0`.
  [[server-infrastructure]] already states the requirement and it is not built.
- **Against a user's machine nothing at the application layer helps** — once packets arrive at a
  home connection the link is saturated before any code runs. Relay-mediated inbound **is** the
  client-side volumetric defense, because it moves the addressable endpoint onto infrastructure that
  can have scrubbing in front of it.
- Terraform; parallelises cleanly with everything.

### `DOD-M15-RELAYONLY-1` — ❌ Relay-only routing is an operator setting
The feature half of the IP disclosure. A direct session reveals the operator's IP permanently, and
[[2026-06-11_1030_daemon-transport-architecture]] §7 already offers relay routing as the mitigation —
as a footnote. Promote it to a real setting, so the disclosure in `DOD-M15-DISCLOSE-1` is actionable
rather than a warning.

---

# Explicitly Beyond — deferred WITH a trigger, never dropped

Nothing here is out of the project. Each carries the condition that brings it back.

- **`DOD-M15-HOLEPUNCH-1` — repair hole punching.** Root cause identified: `@libp2p/tcp` has no port
  reuse, so DCUtR dials from a fresh ephemeral port and the NAT mapping is at the wrong address —
  what libp2p calls a punch is a **timed direct dial**, which succeeds only when the target was
  already dialable. Never once observed succeeding in production. Three unevaluated routes: patch TCP
  port reuse, adopt QUIC, adopt WebRTC. **Not launch-blocking** (relay-audit §H) because the relay
  cannot read relayed content, so the confidentiality claim survives while every cross-NAT
  conversation is relayed. **Trigger:** a dedicated research spike, scheduled after M15. **The
  frequency claim must be corrected regardless** — material citing an 80–90% direct-connection rate
  describes a mechanism that has never worked (`DOD-M15-LEDGER-1`).
- **Threshold on the relay-facing assignment.** Decision 4(a) chose to leave it and required it be
  recorded as a bounded property, which `DOD-M15-DISCLOSE-1` does. The (b)-vs-(c) choice — T
  signatures versus a directory-consortium threshold key that does not exist — is deliberately not
  made now. **Trigger:** the cryptographic-sortition work, when directory-side threshold mechanics
  are already open.
- **Cryptographic sortition.** Decided yes (T-of-N log Decision 3); sequencing open. It is
  availability and scaling, not hardening — its original motivating case was session-open, which the
  blocking signer check now covers regardless of T or N. **Trigger:** directory count needing to grow
  past what `majority(N)` comfortably supports; expected within a month or two of user growth. **New
  T-of-N-dependent work should assume sortition will eventually replace `majority(N)`**, and a
  cutover mechanism is expected rather than a flag-day switch.
- **Backup MERGE** — restoring onto a device that has its own live state. `DOD-M15-BACKUP-1` ships
  export + overwrite-restore. **Trigger:** the first operator who needs to restore without losing
  local state.
- **Multi-device (one identity, two devices)** — `DOD-PRIMARY-1`, `DOD-POLICY-1`, `DOD-PORTAB-1`.
  The launch intent's "your own two agents across devices" is two *identities* on two devices, which
  works. **Trigger:** demand for one identity on two devices.
- **`CELLO-REPL-001`'s remaining readers.** Its security-critical reader is pulled into
  `DOD-M15-SAMEOP-1`; the other three, and the column drop, stay. **Ordering is in the story and
  binds:** move the readers, confirm on a converged fleet, then drop the columns in a **separate**
  release.
- **`DOD-FLOOR-1`** — the trust-signal floor is built, unit-tested, and deliberately called by
  nothing. Correct for launch: any default would start refusing counterparties with no signals, which
  is everybody on day one. **Trigger:** the first operator who wants to be selective.
- **`DOD-END-WITHDRAW-1`, `DOD-END-INGRESS-1`, `DOD-END-QUOTA-1`.** **Trigger:** endorsement volume
  appearing. Of the three, quota has the safety edge (unbounded issuance) and is first to revisit.
- **`DOD-ACCOUNTS-EMAIL-CHAIN-1`** and the append-only-table test-isolation defect — recorded in
  `DOD-M15-CHAINHEALTH-1`, repaired separately.

---

# Decisions Carried

Rulings that bind every line above. **Re-asking one is decision theatre** (M15-PROCEDURE §🎭).

1. **The gate is a state, and everything is inside it** (Andre, 2026-08-21). Launch waits for M15 to
   close. Tiers are dependency order only; nothing is descoped for time; an item's presence in this
   document *is* its launch-blocking status.
2. **The seal wire change is in the gate**, on the migration argument rather than the security one —
   **and it pulls the content encryption in with it**, because the seal consumes the salt the key
   agreement produces and the seal items cannot be split.
3. **The unpublished investor and GTM material is not in M15.** Never made public, never sent;
   corrected after the milestone against what actually shipped.
4. **Certified root moves to the content-hash domain** (relay-audit Decision 1(a)) — not
   `seal_attempt`, not a parallel reported root.
5. **The listening socket stays, gated on the assignment** (Decision 2). Removing it buys nothing on
   NAT traversal since punching cannot fire either way, and it is load-bearing for same-machine and
   same-LAN sessions.
6. **The relay verifies a presented credential; it does not query the directory** (Decision 3(b)).
   Preserves extractability and adds no per-request latency.
7. **Per-session ephemeral key agreement with a PQ hook, never static-static** (Decision 5(b)).
   Static-static would void forward secrecy the transport already provides.
8. **The sender's signature is stored per leaf** (Decision 6(b)) — a schema change is cheapest now
   and never gets cheaper.
9. **Relay corroboration is proactive** (T-of-N Decision 4) — it must not depend on a possibly-
   compromised client choosing to ask.
10. **Unilateral absence is hybrid and tiered** (T-of-N Decisions 1 and 2): 600s standard unchanged;
    high-stakes opt-in at 3600s with evidenced absence mandatory.
11. **`T = majority(N)` stands until sortition replaces it.** Do not propose all-N. Do not re-raise
    the threshold as an open question.
12. **A recommendation that survives only on backward-compatibility grounds is not a
    recommendation** — re-derive against an empty database. This reversed two first-pass
    recommendations in the spec-of-record and it will try to reverse more.
13. **The relay-linkability mitigation is WITHDRAWN, not relied on** (§3a ruling, Entry 1). Decision
    7 accepted the long-lived per-agent handle because spreading reservations across relays would
    erode it; measurement shows one relay carries 99% of an agent's reservations, so that basis does
    not hold. `DOD-M15-MULTIRELAY-1` is availability only, and the property is disclosed in
    `DOD-M15-DISCLOSE-1`. Making selection genuinely spread remains worth doing — as an improvement,
    never as the thing a claim rests on.
14. **The interrupted-seal proof runs against EXISTING agents** (Andre, 2026-08-21) — no pre-auth
    tokens, no throwaway registrations. Manage the side effect by choosing agents with no open
    sessions, verified before the run.

---

# Claims Ledger

*Built by `DOD-M15-LEDGER-1`. Rows are added as surfaces are swept; a claim with no row is an
unaudited claim.*

## Swept 2026-08-21 — `AUDIT-ME.md`, root of the PUBLIC `Mygentic-AI/cello-client` repo

**Five rows, ranked by what a hostile reader finds first.** Every one was measured by running the
document's own instructions against the tree — which is exactly what its name invites. → Entry 3.

| # | Claim, as written | Verdict | Disposition |
|---|---|---|---|
| 1 | Claim 3: *"outbound network connections **only** to the directory node … and to relay nodes … no telemetry endpoints … **or any other outbound HTTP calls**"* | **FALSE** | **withdrawn + rewritten with disclosure** |
| 2 | Claim 1: *"Message content is **additionally encrypted at the application layer** (AES-GCM envelope)"* | **FALSE as scoped** | **withdrawn + corrected** |
| 3 | Header: *"**All paths listed are valid** — packages were extracted … by REPOSPLIT-002"* | **FALSE** | **made true** |
| 4 | Verification cmd 1: `grep -r "plaintext" core/transport/src/  # should find nothing` | **wrong command, right code** | **made true** |
| 5 | Scope: the document audits network behaviour and never mentions `core/daemon/` | **structural gap** | **made true** |

**Row 1 is the one that matters and it is the worst artifact in the milestone.** The daemon makes
outbound HTTPS calls to **`https://api.telegram.org`** — `getUpdates` and `sendMessage` in
`core/daemon/src/telegram-bot-client.ts:27,42`. That is the doorbell feature: deliberate,
operator-configured, and the thing that reaches a phone. **Nothing about it is wrong except that a
public document says it does not happen.** And the document's *own* command 4 finds it —
`grep -rln "fetch(\|http\.request\|https\.request" core/*/src/` returns that file and only that
file. An evaluator following the instructions in a file called AUDIT-ME reaches a false claim in
about ten seconds.

**Write the replacement forward-safe.** `core/gateway/src/detect/deberta-model-manifest.ts:16`
carries `https://huggingface.co/…` as the classifier's download base. It has no production caller
today (`DOD-M15-SCREENINSTALL-1`), so it is not currently a destination — but it becomes one the
moment that line ships, and a claim that has to be rewritten again then is a claim written wrong now.

**Row 2** is the miscited-evidence case. Live content is plaintext inside libp2p's Noise session;
only *parked* content carries an application-layer AES-GCM envelope. The document cites
`core/client/src/client-backup.ts` — the **database backup** file — as evidence for *message*
encryption, which is a different thing entirely, and that path does not exist either.

**Row 3, measured:** four of the eight cited paths are gone —
`core/adapter-claude-code/src/server.ts`, `core/client/src/client-backup.ts`,
`core/client/src/client.ts`, `core/protocol-types/src/envelope.ts`. **`core/client/` does not exist
at all**; the surviving four are `core/crypto/src/ed25519.ts`, `core/transport/src/node.ts`,
`core/transport/src/types.ts`, `package.json`. The document asserts its own correctness in its
opening paragraph and is wrong.

**Row 4:** the command returns 5 hits — all of them comments and tests *asserting that plaintext is
absent* (`// Noise ONLY — no plaintext. SI-001.`). **The code is right and the instruction is
wrong**, which is the whole shape of this document: true claims, proved badly. Rewrite the command
so a correct tree produces the result the document predicts.

**Checked and NOT a finding**, recorded so it is not re-raised: `code.claude.com` and
`hermes-agent.nousresearch.com` appear only in a doc comment and an install-hint error string, not
as outbound calls; `docs.cello.dev` — which would breach the one-domain rule — appears only inside
an illustrative comment in a test file, and nothing ships it.

---

## Swept 2026-08-21 — `README.md`, same public repo

| # | Claim, as written | Verdict | Disposition |
|---|---|---|---|
| 6 | Headline ¶1: *"each conversation produces a tamper-evident, bilaterally-sealed audit trail that **both parties can independently verify**"* | **FALSE today** | **made true** by `DOD-M15-SEALWIRE-1` |
| 7 | Headline ¶1: *"relayed as encrypted blobs the relay cannot read"* | **TRUE** | verified, no action |
| 8 | *"A session name is **private to you** — never sent to the counterparty, the relay, or the directory"* | **TRUE** | verified, no action |
| 9 | *"`standing_receiver_ready` on its own is true even for a receiver no relay would grant a circuit reservation to — behind NAT, that agent is dialable by nobody"* | **TRUE** | verified, no action |

**Row 6 is the first paragraph of a public repository**, and it names the one property the relay
audit found nobody holds: **the receipt is not bound to the transcript.** A party can verify the
directory signed *a* root; it cannot verify that root is *its conversation*, because the client
takes the sealed root off the wire, checks the signature, stores it, and discards the root it
computed one step earlier. "Independently verify" is exactly the word that does not survive.

**Scope discipline, carried from the audit and not to be inflated:** no working attack against the
seal was demonstrated. The statable property is that the receipt is not bound to the transcript and
nothing would say so if the two diverged. The row is a claim defect, not an exploit.

**Disposition is made-true rather than withdrawn** because `DOD-M15-SEALWIRE-1` is inside the gate
and makes the sentence true. It must not ship before that line lands — a claim that becomes true is
still false until it does.

**Rows 7–9 were checked, not assumed**, and all three hold. Row 8 verified structurally:
`session_name` appears in **no** wire type in `core/protocol-types/src`. Recorded so a later sweep
does not re-open them.

---

## Swept 2026-08-21 — shipped skill prose and MCP tool descriptions

**These ship inside the npm package to every operator, and they carry the product's strongest
safety claim in its most unqualified form.** All four say screening is ACTIVE, without distinguishing
the character-denylist layer (live) from the semantic layer (not installable anywhere).

| # | Claim, as written | Where | Disposition |
|---|---|---|---|
| 10 | *"Content screening **is active**, in both directions. Inbound messages are screened before they reach any reader"* | `plugins/cello/skills/setup/SKILL.md:150` | **withdrawn**, then made true |
| 11 | *"content screening is the boundary, and it is **ACTIVE** in both directions at every tier"* | `plugins/cello/skills/cello/SKILL.md:205` | **withdrawn**, then made true |
| 12 | *"It does NOT change content screening, which is **ACTIVE at every tier** … a higher tier never buys less screening"* | `cello-mcp.ts:230` — a shipped **tool description** | **withdrawn**, then made true |
| 13 | *"CONTENT screening (prompt-injection defense) **IS live** as of DOD-M9B-WIRE-1"* | `cello-mcp.ts:190` — source comment, public repo | **rewritten** (`DOD-M15-CLAIM-COMMENTS-1`) |

**Why these are false rather than merely imprecise.** Two independent findings undercut them:

1. **The semantic half cannot be installed on any operator's machine.** `installModel` has no
   production caller — no command, no dependency, not even optional — so the layer that judges what
   a message *means* reports OFF forever (`DOD-M15-SCREENINSTALL-1`). What is live is the character
   denylist, which exists for the crude cases. **Partially true is false**, and none of these four
   surfaces makes the distinction.
2. **Even the live half is bypassable on the direct path.** The relay audit's Finding 1 lands
   injected content *below the layer where all screening lives* — blocked contacts, per-sender caps
   and trust tiers all sit on the signalling channel and that path never touches them. So row 12's
   *"ACTIVE at every tier"* is doubly wrong: a stranger who never appears as a contact at any tier
   reaches the reader anyway, until `DOD-M15-FRAME-1` lands.

**Recorded because it is the mechanism, not the blame:** `setup/SKILL.md:156` documents its own
upgrade — *"This paragraph previously said screening was 'planned, not yet active'. That was true
when the paragraph was written."* The claim was deliberately strengthened when the denylist landed,
and the semantic half never arrived behind it. **That is how a claim outruns its code**, and it is
the argument for the ledger existing at all: the moment a protection partially lands is the moment
its claim needs a scope, not a promotion.

**Sequencing:** withdraw now (add the scope), make true when `DOD-M15-SCREENINSTALL-1` and
`DOD-M15-FRAME-1` both land. Withdrawal is not optional pending the fix — these are read today.

---

### Checked and NOT claims-ledger rows

- **The document content profile is advertised nowhere.** `content_profile` / `assurance_tier`
  appear in no shipped skill prose and no tool description. So `DOD-M15-DOCPROFILE-1` is a **feature
  gap only** — a setting that enforces nothing — and needs no claim withdrawn alongside it. Recorded
  because the reverse was assumed when the line was written.
- **The `documents` and `receptionist` skills and the receptionist agent** carry operational
  descriptions, not security guarantees. The two injection-adjacent lines (*"cannot wake you by
  claiming a field is urgent"*, *"the right response, never obeying them"*) are instructions to the
  reading agent about handling peer content, which is correct advice and not a system claim.

**Remaining surfaces to sweep** (`DOD-M15-LEDGER-1` is not ✅ until each has been walked): the rest
of the MCP tool descriptions beyond the screening ones above; CLI help text; product status output.

**Seed rows, from the two investigations — not yet individually verified against the tree:**

| Claim | Where | Disposition |
|---|---|---|
| "content is additionally encrypted at the application layer" | `AUDIT-ME.md` (public repo root) | **withdrawn** — true only for parked content |
| four of seven cited file paths | `AUDIT-ME.md` | **made true** — paths resolve post-repo-split |
| inbound screening is active | status output, tool descriptions | **withdrawn**, then **made true** by `DOD-M15-SCREENINSTALL-1` |
| the document content profile protects you | tool description, skill prose | **made true** by `DOD-M15-DOCPROFILE-1` |
| "80–90% of connections are direct" | outward-facing material (not in M15) | **withdrawn** — describes a mechanism that has never worked |
| "no persistent endpoint to DDoS" | outward-facing material (not in M15) | **withdrawn** — structurally false; a gate is not a flood defense |
| relay assignment requires a threshold | trust-model prose | **disclosed as bounded** — one node signs it; reach stated in `DOD-M15-DISCLOSE-1` |
| a direct session is private to the two parties | shipped docs (absent) | **disclosed** — it reveals the operator's IP permanently |
| an agent's sessions are unlinkable across time | design record / Decision 7 | **disclosed as bounded** — one relay carries 99% of an agent's reservations and can correlate them (Entry 1) |

---

## Related Documents

- [[M15-PROCEDURE]] — the runbook; §0z the gate, §2b the four invariants, §1c the three enforcers
- [[M15-BUILD-JOURNAL]] — audit trail and evidence home
- [[2026-08-21_1906_relay-p2p-exposure-and-ephemeral-peer-id-audit]] — spec-of-record for Tiers 0, 2,
  4 and 5; seven ruled Design Decisions and the 39-item → 18-unit map
- [[2026-08-21_1135_tofn-decoupling-and-seal-integrity-gaps]] — spec-of-record for the seal-ceremony
  and unilateral lines; four ruled decisions
- [[launch-triage]] — source for Tier 3; read its header warning before trusting any status marker
- [[M12B-DEFINITION-OF-DONE]] — the work order inside `DOD-M15-SUBMIT-ID-1`
- [[end-to-end-flow]] — the canonical narrative every seal change reconciles against
