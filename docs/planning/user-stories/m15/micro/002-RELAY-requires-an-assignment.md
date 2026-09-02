---
name: 002-RELAY — No relay service without a directory-issued assignment
type: micro-work-order
date: 2026-08-24
status: complete
description: >
  The relay serves anyone holding any Ed25519 keypair. Make it refuse unless the caller presents a
  directory-signed session assignment naming them as a participant, and install the connection gater
  so a circuit address is not dialable by whoever learns it. Source line: DOD-M15-RELAYAUTH-1.
---

# **<ins>MICRO</ins>** WORK ORDER 002-RELAY — The relay requires an assignment

> ## THE RULES OF A MICRO WORK ORDER
>
> 1. **This file is the whole world.** Do not read or write `M15-DEFINITION-OF-DONE.md`,
>    `M15-BUILD-JOURNAL.md`, or any other milestone document. Everything you need is here.
> 2. **MICRO means small.** One mission. Follow it to its end. **Never grow the mission.**
> 3. **Found something else?** Write it under *Newly discovered* at the foot of this file and
>    **keep going**. Do not fix it. Do not open a line for it. Do not investigate it.
> 4. **500 lines, hard cap.** If this file is growing, you are writing detail nobody needs.
>    Minimal without omitting anything. No scratchpad. No narration of what you tried.
> 5. **Standard procedure still applies:** implement → review (`cello-unit-reviewer`) → fix every
>    finding → commit. Commit per fix, push after every commit. **Closing a unit means flipping
>    this file's `status:` frontmatter to `complete` in the SAME commit as the verdict** — the
>    two are one fact, and eight orders in a row have shipped with them disagreeing.
> 6. **Done is done.** When the Definition of Done below is met, stop. Do not look for more.

---

## The problem, plainly

Anyone can authenticate to the relay with a throwaway keypair. The relay never asks whether that key
belongs to a real agent, and never asks whether the caller has any business in the session they are
talking about. Its port is open to `0.0.0.0/0`.

**What that costs an operator:** a stranger can hold a circuit address and dial straight through to
an agent, because the libp2p hook that restricts who may dial a reservation holder was never
installed. The direct route was closed earlier in this milestone. This is the same door, other side.

## The settled design — do not re-derive it

**The relay verifies a credential the caller presents. It does NOT query the directory.**

That is a ruled decision, and the reason is that a relay must stay a cheap, stateless signature
verifier that a private enterprise can run standalone. Making it a directory client would break that.
The caller already holds the assignment, so it simply presents it.

---

## The work

### 1. Relay service requires an assignment
Refuse relay service unless the caller presents a directory-signed session assignment naming them as
a participant.

- **Including collecting parked content.** The credential is the assignment from the session those
  messages belong to — the caller already holds it. This is not an exemption, it is a credential
  they already have.

### 2. Verify the authenticating key is a registered agent — ⛔ NOT DONE HERE, MOVED TO `008-RELAY`
Today any Ed25519 keypair authenticates. It must be a key the presented assignment names.

**This was never implemented in this order, and the Opus re-review caught it.** It is now Part 1 of
`008-RELAY-reservation-slot-flooding.md`, which solves it with a directory-issued token bound to the
agent's public key rather than with a session assignment — because an assignment only exists after a
session, so a brand-new agent has none at the moment it first needs one.

**How it went missing is the part worth keeping.** The Definition of Done below has no clause for
this item. Its six clauses cover parked content, assignments that do not name the caller, the dial
gate, tests, gates and review — every one of them ✅ — so the order read as fully done while a third
of its stated work was untouched. **A work item with no DoD clause is invisible to the gate that is
supposed to catch exactly this.**

### 3. Install the connection gater on the relay, including the reservation-dial hook
- Reservations are granted to any peer, up to 4096.
- The libp2p hook restricting who may dial **through** to a reservation holder is never installed.
- Gate reservation grants on the same directory-signed credential, and restrict circuit dials to the
  counterparty the assignment names.

### 4. Check before you build — one of these may already be done
The liveness query (`is agent X online?`) was reported as already scoped to a named participant by
earlier work in this milestone. **Read the handler before touching it.** If it is already scoped,
say so and move on. Do not redo it, and do not assume the report is right either — read the code.

---

## Definition of Done

1. ✅ **Parked-content collection now requires a real assignment.** `content_park_pull` and
   `content_park_confirm` already proved key OWNERSHIP (I1's challenge-response); they now also
   require the pubkey be **vouched** — named by at least one directory-signed assignment this relay
   has recorded. A bare keypair that owns itself perfectly is refused `not_a_participant`, and the
   parked entry is neither served nor deleted. Deposit stays open by design (documented: E2E
   encryption is the mitigation, not identity) — the order calls out *collection*, and that is what
   is now gated. `hash_submit` and `session_liveness_query` were already gated transitively (both
   demand session participation, which only `recordAssignment` can confer), so no redundant check
   was added there — see *Newly discovered* for the one residual.
2. ✅ **An assignment that does not name the caller is refused.** The check already existed in
   `#processClientRecordAssignment` and had **no test** — the only `assignment_invalid` coverage was
   the forged-signature case. Added one: a genuinely consortium-signed assignment naming two other
   agents, presented by an authenticated stranger, is refused `not_a_participant`.
3. ✅ **A circuit dial from a peer the assignment does not name is refused.** This is the order's
   headline defect — "the libp2p hook restricting who may dial **through** to a reservation holder
   is never installed." The relay had **no connection gater at all**. Now installs one
   (`relay-connection-gater.ts`) whose `denyOutboundRelayedConnection` refuses unless a recorded
   session assignment names BOTH transport peer ids. The data was already being collected and
   never read: `#sessionPeerIdBindings` was written at `recordAssignment()` and used for nothing.
4. ✅ Tests cover all three refusals plus the happy path, each revert-tested. See *Revert tests*
   below.
5. ✅ Both repos: `pnpm run lint`, `pnpm run typecheck`, `pnpm run test`. One pre-existing unrelated
   failure per repo, each confirmed on the unmodified tree by `git stash` + re-run
   (`expect-present-enforcer.test.ts` in trustless-cello; `mcp-001-agent-lifecycle.test.ts` AC-002
   in cello-client, which expects `cello_start_agent` to return exactly `{ok:true}` and now also
   gets a `standing_receiver: "starting"` field).
6. ✅ Reviewed by `cello-unit-reviewer`, verdict quoted below.

### Reservation grants — scope changed mid-unit, deliberately, with Andre's ruling

The order says to *"gate reservation grants on the same directory-signed credential."* **Traced end
to end before writing code, that would strand every brand-new agent.** An agent requests its
NAT-traversal reservation at `cello_start_agent` time — **before it has ever spoken CELLO's own
relay protocol to anyone**, often against a relay chosen independently of which relay any later
session uses. Denying at grant time would deterministically refuse every first-ever reservation and
degrade every new agent to an undialable plain-TCP receiver: the exact outage class
`DOD-NAT-REACHABILITY-1` already fixed once.

Raised as a genuine fork rather than guessed. **Andre widened the scope** — *"change the scope of
the order to allow client-side changes… we want to make sure the reservation gating grant works
correctly… we have zero users."* So:

- **Relay:** grants immediately (never denied at grant time), then **revokes** if the holder has not
  proven Ed25519 key possession within a grace window (`RESERVATION_GRACE_MS`, default 15s).
  > ⚠️ **SUPERSEDED by 008-RELAY, and this bullet is why it had to be.** Granting first and revoking
  > afterwards is the defect that order was reopened twice to remove: an attacker who never opens an
  > auth stream never meets the check, so the slot was already handed over and every refusal the
  > relay logged was correct while one machine held the table. There is no grace window and no
  > `RESERVATION_GRACE_MS` any more. The client authenticates BEFORE it asks, and an unproven peer
  > is refused at the reservation itself. Left in place rather than edited out because the reasoning
  > above is the record of a decision that was made and then reversed — see
  > `008-RELAY-reservation-slot-flooding.md`.
- **Client (cello-client, same branch name):** the standing receiver now authenticates to its
  reservation relay **as soon as it has a reservation**, instead of waiting for a session to exist.
  Same `relay_auth` handshake, moved earlier; no new wire frames.
- **This timer is not the security boundary.** An attacker holding an unproven reservation inside
  the grace window still cannot be dialed through to — that is gated independently and
  unconditionally on a real session assignment. The timer only stops a relay serving reservation
  slots to keypairs that never prove anything.

### Revert tests (each reverted, confirmed red for the expected reason, restored)

| Fix | Reverted to | Reddened with |
|---|---|---|
| dial-through gate | `denyOutboundRelayedConnection` → always allow | the stranger's dial SUCCEEDED where the test expects it to throw |
| reservation revoke | `denyInboundRelayReservation` → early-return | `expected false to be true` — the unproven holder was never disconnected |
| content-park vouching | both `isVouched` checks → `if (false)` | `content_park_pull_count` where `content_park_pull_refused` was expected |
| client proactive auth | the `#authenticateStandingReceiver` call site → disabled | the relay never observed a `relay_auth_response` for the agent's pubkey |

⚠️ **The content-park revert test is the one that earned its keep.** Run before the negative test
existed, disabling BOTH vouching checks left the whole relay suite green — the happy-path tests only
proved behaviour *after* vouching. The `not_a_participant` test was written because of that result,
not before it.

**Not in scope:** rate limiting (003-RELAY), the admin frame types (004-RELAY), any change to the
directory. **Client-side scope was widened by Andre mid-unit** (see above) — the order's original
"no client change" fence would have made the reservation half unimplementable.

**✅ CLOSED 2026-09-01.** Work items 1 and 3 are done, merged, and re-reviewed; every finding from
both review passes is fixed and revert-tested. **Work item 2 is NOT done and is not counted as
done** — it moved to `008-RELAY`, which carries it as Part 1. Closing this order does not close that
work; 008 does.

---

## Traps recorded before you start

- **A refusal must be loud and must name its cause.** A relay that silently drops is indistinguishable
  from a relay that is down.
- **Bilateral order.** If the client must send anything new, the relay must accept the new shape
  before any client depends on it, or a mid-roll fleet refuses live sessions.
- **Do not weaken an existing assertion to make a new test pass.**

---

## Review

*(Reviewer verdict. One quote. Not a transcript.)*

### Pass 1 (Opus) — three HIGH, all fixed and revert-tested before pass 2

HIGH-1 the replacement standing receiver stole the live session's delivery stream (fixed via an
additive `purpose: "reservation"` on `relay_auth_response` — relay half `7a9c9d7d`, client half
`61f239b`); HIGH-2 the assignment was presented only to the directory-picked witness relay, not to
the relay that actually gates the dial (`44b2792`); HIGH-3 a content-park pull refusal was flattened
at the client. **Note pass 2 found the identical HIGH-3 defect still standing on the CONFIRM path in
the same file — see M3.**

### Pass 2 (Opus, 2026-08-31) — MERGE REFUSED

> **Merge recommendation: do not merge as-is.** H1 and T1 are blocking; H2 is blocking unless Andre
> rules the post-restart mailbox gap acceptable for launch (it is cheap to close via option (a), and
> the gate it protects has near-zero marginal security value over the existing challenge-response).
> … this diff touches persistence, crypto-adjacent auth, notification/queue and registration-shaped
> state, and I did **not** come out clean — the two findings I would most expect to have missed (a
> gate that denies the legitimate case, and a durable store gated on volatile state) are both here
> and both real. — `cello-unit-reviewer` (Opus)

**BLOCKING**

- **H1 — the gate denies the LEGITIMATE first dial, on a race the code usually loses.** Both parties
  get the assignment independently. A dials B's circuit address after ~2 RTT; B presents the
  assignment to its own reservation relay — unawaited — after ~3–4 RTT. A arrives first more often
  than not and the relay answers `PERMISSION_DENIED`. For every session where B is NAT'd and B's
  reservation relay ≠ the witness relay (the diff's own comment calls that "the ordinary case, not a
  corner"), the relayed link never forms. `cello_initiate_session` still returns
  `{ok:true, transportMode:"relay"}` and every message for the life of that conversation silently
  falls to the park backstop. Fix: **A** presents the same assignment to B's reservation relay and
  **awaits** it before dialling — A is a named participant, the assignment is self-authenticating, so
  presenting it more widely grants nothing and the ordering becomes local to one thread.
- **H2 — parked mail becomes uncollectable after any relay restart.** The pull/confirm gate is
  enforced against `#vouchedPubkeys`, which is in-process and never persisted; the content store is
  durable (`FileContentStore` under `WAL_DIR`). Roll the relay and the recipient is *notified* that
  mail is waiting, then refused `not_a_participant` on the pull, because clients do not re-present an
  assignment on reconnect. Mail is stranded until some new session happens to be brokered on that
  same relay.
- **T1 — the HIGH-1 fix has NO relay-side test.** The grace test's `completeRelayAuth` never sends
  `purpose`, so the whole `purpose === "reservation"` dispatch is unexercised against the real relay.
  **Delete that block and the entire trustless-cello relay suite stays green.** The client-side
  assertion runs against a fake relay defined in the test file, so it proves the client *sends* the
  flag and nothing about what the relay does with it.

**NON-BLOCKING**

- **M1** `void #presentAssignmentToReservationRelay(...)` has no `.catch()`, and its prologue sits
  outside its own `try` — a throw becomes an unhandled rejection that can kill the daemon. The
  sibling call site does attach `.catch`.
- **M2** reservation-slot exhaustion is unmitigated: `recordAuthenticated` fires for any successful
  `relay_auth`, which proves possession of *some* keypair only, so 4096 throwaway keys fill the
  reservation table and every legitimate agent loses NAT reachability. **Belongs in 003's mission**,
  not in Newly discovered — 003 will otherwise rate-limit submits and not reservations.
- **M3** error substitution, and the exact HIGH-3 defect left standing one function away in the same
  file: the relay answers a refused confirm with a well-formed
  `content_park_confirm_ack {ok:false, reason:"not_a_participant"}` and the client discards it to
  report the wire-shape complaint `no_confirm_ack`. Reachable when the relay restarts between a
  successful pull and its confirm: pickup is never confirmed, the entry is never deleted, and the
  recipient is re-notified about it forever.
- **M4** the reservation-relay client and its session registration are leaked per session — detach
  only knows the *witness* relay's key. Relay-side, the dial-through binding it holds is then cleared
  only by the idle timer, now **24h**.
- **M5** the standing receiver's proof is a silent no-op when the builder isn't wired
  (`relay_auth.no_builder` at **debug**); the receiver never proves possession, the relay revokes its
  reservation 15s later, and the agent is NAT-unreachable with no visible trace.
- **L1** revoke timers are never cleared on `stop()` and are not `unref()`'d. **L2** the event name
  `content.park.pull.refused` is emitted by BOTH relay and client — two meanings, one name.
  **L3** the denial reason names the exit point, sending the operator after a directory bug for what
  is a timing race.

### Pass 2 outcome — ALL findings fixed (2026-08-31)

Every finding above is fixed, each with a revert test. Two are worth remembering for the shape
rather than the code:

- **H1's fix had to remove the race, not shorten it.** Presenting the assignment sooner would have
  narrowed the window and left the bug. The dialer now presents it to the relay that will gate the
  dial and *waits*, so the ordering is local to one thread. The test asserts ordering with **no
  polling** — a `waitUntil` would re-admit the bug, which is exactly why the existing HIGH-2 test
  stayed green through it.
- **H2's fix had to be as durable as the thing it guards.** Vouching is now persisted beside the
  content store and both are selected on the same condition in the composition root, because if one
  becomes durable and the other does not, the outage returns.

M2 was **not** fixed here — by the reviewer's own instruction it was written into **003's mission**
as work item 4, since fixing it here would grow this order and leaving it in Newly discovered would
let 003 close with the reservation table still open.

**No third review pass.** Two is the cap; pass 2 found what pass 1 missed, and anything further is
recorded rather than re-reviewed.

**Clause verdicts:** clause 1 partial (H2); clause 2 (*the authenticating key must be one the
assignment names*) **NOT IMPLEMENTED** — recorded under Newly discovered, must not be read as ✅, and
it is the enabling condition for M2; clause 3 implemented, with the reservation-grant sub-clause
deviated under Andre's recorded ruling; clause 4 implemented. **Confirmed sound:**
`connection.remotePeer` is Noise-authenticated so the source peer id cannot be spoofed; the hooks
were checked against the installed `@libp2p/circuit-relay-v2@4.2.3`; `purpose` is additive and
outside every signed TBS, so bilateral order holds.

---

## Newly discovered

*(One or two lines each. Do not act on them.)*

- **Clause 2 of this order — "the authenticating key must be one the assignment names" — is NOT
  implemented, and must not be read as done.** `relay_auth` still admits any Ed25519 keypair: it
  takes a delivery-stream slot, flips session-path liveness to alive, resets idle timers and receives
  park notifications. Vouching (added here) gates content-park pull/confirm on a real assignment, and
  the dial-through gate is unconditional, so the headline refusals hold — but the AUTH step itself
  still proves possession of *some* keypair only. This is the enabling condition for reservation
  exhaustion, which is now item 4 of 003-RELAY's mission.
- A rate-limited auth aborts BEFORE `recordAuthenticated`, so a peer that trips 003's auth throttle
  also loses its circuit reservation to this order's grace-window revoke — a throttle becoming an
  outage. Low likelihood at 20/min; neither order's tests cover the combination. Recorded in 003 too.

- **A bare authenticated keypair still occupies a standing-receiver slot.** `relay_auth_ok` alone
  (proving only key possession, naming no session) still enters `#streams` unconditionally and
  stays there. It cannot be dialed through to, cannot pull parked content, and cannot submit to any
  session — all now gated — so what remains is resource occupancy, not access. Closing it fully
  means deciding what a legitimately-reserved-but-not-yet-in-session agent is entitled to, which is
  the same bootstrapping tension the reservation grace window resolves for reservations.
- **`#vouchedPubkeys` is never pruned.** Deliberate (an agent that finishes one session is still the
  same registered agent for the next) and bounded by the set of pubkeys a directory has actually
  signed an assignment for, so it is not attacker-inflatable — but it is unbounded over a relay's
  lifetime, unlike every other map in the relay which is swept.
- **`denyInboundRelayedConnection` (the reservation-holder's own side) is still uninstalled.** The
  relay's `denyOutboundRelayedConnection` is the load-bearing gate and is now installed; the
  client-side hook is defense-in-depth that would let a receiver independently refuse a dial its
  relay wrongly permitted. Belongs with the daemon's `SessionConnectionGater`, not the relay's.
