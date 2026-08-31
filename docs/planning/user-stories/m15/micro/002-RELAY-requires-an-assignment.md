---
name: 002-RELAY — No relay service without a directory-issued assignment
type: micro-work-order
date: 2026-08-24
status: open
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
>    finding → commit. Commit per fix, push after every commit.
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

### 2. Verify the authenticating key is a registered agent
Today any Ed25519 keypair authenticates. It must be a key the presented assignment names.

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

---

## Newly discovered

*(One or two lines each. Do not act on them.)*

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
