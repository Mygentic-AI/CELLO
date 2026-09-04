---
name: 030-RELAYSILENT — The relay stops answering after it accepts a reservation proof
type: micro-work-order
date: 2026-09-04
status: open
dod_line: DOD-M15-PARKCONN-1
dod_effect: closes
description: >
  An agent finishes a conversation, rebuilds its standing receiver, proves itself to the relay —
  and the relay accepts the proof and then stops answering that daemon entirely. Every later dial
  fails at the transport handshake. The agent falls back to a node with no reservation, and from
  then on it can neither deposit parked mail nor drain its own. `028-PARKCONN` made the failure
  legible and handed this back under its stop rule; this order finds out who stops answering, and
  fixes it. CLOSES DOD-M15-PARKCONN-1.
---

# **<ins>MICRO</ins>** WORK ORDER 030-RELAYSILENT — Who stops answering, and why

> ## THE RULES OF A MICRO WORK ORDER
>
> 1. **Read [[M15-PROCEDURE]] IN FULL before you start.** It binds you — the gate, the review
>    dispatch, the invariants, how tests are run. **Do not read `M15-DEFINITION-OF-DONE.md` or
>    `M15-BUILD-JOURNAL.md`**; this order carries everything you need from them.
> 2. **MICRO means small.** One mission. Follow it to its end. **Never grow the mission.**
> 3. **Found something else?** Write it under *Newly discovered* at the foot of this file and
>    **keep going**. Do not fix it. Do not investigate it.
> 4. **500 lines, hard cap.**
> 5. **Standard procedure still applies:** implement → review (`cello-unit-reviewer`) → fix every
>    finding → commit. Commit per fix, push after every commit. **Closing a unit means flipping
>    this file's `status:` frontmatter to `complete` in the SAME commit as the verdict.**
> 6. **Done is done.** When the Definition of Done below is met, stop.

---

## What the operator lives through

They have a conversation. It ends. Behind that, their daemon rebuilds the listening post that holds
their agent's slot on the relay — routine, and it happens after every session.

The new listening post asks the relay for its slot, and **from that moment the agent cannot reach
that relay at all.** Mail it is holding for the other side cannot be sent. Mail waiting for it cannot
be collected. Nothing announces any of it; the conversation simply goes quiet, and the next thing the
operator does is restart the daemon.

**Andre ruled this BLOCKS LAUNCH on 2026-09-04.**

---

## What is established — MEASURED. Do not re-derive, and do not extend.

`028-PARKCONN` traced the receiver's peer id across the sender daemon's log and the relay's log, in
the same run. **All of the following is quoted, not inferred.**

**1. The daemon's fallback is working correctly and is not the bug.** The receiver that survives is
the *plain* node the walk falls back to when no relay grants a reservation. It never presents a proof
because it holds no circuit — that is by design (`session-node-manager.ts`, the relay walk).

**2. The receiver BEFORE it proved successfully, and both sides agree it did.**

```
RELAY   21:46:19.680  relay.auth.reservation_proof  remotePeerId 12D3KooWLJou9Zya…  pubkey 79ea6a7d
DAEMON  21:46:19.684  session.relay.reservation_proof.result   nodePeerId 12D3KooWLJou9Zya…  ok: true
DAEMON  21:46:19.684  session.standing_receiver.prove.result   peerId     12D3KooWLJou9Zya…  proven: true
```

**3. Four milliseconds later the daemon abandoned that proven node.**

```
DAEMON  21:46:19.688  session.standing_receiver.relay.rejected
                      reason: "relay_unreachable"   attempts: 2
                      circuitAddr: /ip4/127.0.0.1/tcp/54561/p2p/12D3KooWNgpJ…/p2p-circuit
```

**4. 🔑 THE RELAY'S LOG ENDS AT 19.680.** After accepting that proof it writes **nothing** — no
reservation granted, no denial, no `Peer disconnected`, and **no `Peer connected` for any later
dial** — through the deposit failures at 19.689 and 19.928 and on to the end of the run.

**5. Every client dial after that point dies in the transport handshake**, with three different
strings for the same event depending on how far it got:

```
connect ECONNRESET 127.0.0.1:<port>
Encryption failed
Unexpected EOF - stream closed while reading 0/1 bytes
```

The third is the `No open connection to peer 12D3Koo…` that `019-PARKERROR` originally reported — the
consequence, one frame after the cause.

**6. Two suspects are RULED OUT by measurement, so do not spend a run on them.**
- **The per-agent slot cap.** `relay.slot.cap_exceeded` never appears, and `maxReservations` is
  `DEFAULT_SLOT_CEILING` = 4096 against `reservedSlots: 0` at startup.
- **The relay connection gater.** It implements `denyInboundRelayReservation` and
  `denyOutboundRelayedConnection` only, and its own comment says denying an unproven peer *"would
  strand every new agent"* — it does not gate plain inbound connections.

**7. The relay process does not die.** In a proxy-free run it was still submitting hashes and
delivering leaves for the live session while the park dial was being reset.

---

## The one thing that is NOT established, and it is the mission

**Who stops answering, and why.** The relay's silence is a fact; its cause is not. Three candidates,
none eliminated:

| | Candidate | What would confirm it |
|---|---|---|
| A | The relay's libp2p stops accepting inbound connections on that listener | a packet-level or `netstat` observation on the relay's own bind port with the ingress proxy OUT of the path |
| B | Something on the RELAY closes the connection during the Noise handshake, below any CELLO logging | relay-side libp2p debug logging on the connection encrypter |
| C | The DAEMON's dial is at fault — a stale peerstore entry, or an address it should not be using | the same dial from a second, unrelated process at the same instant |

**⚠️ THE INGRESS PROXY IS IN THE PATH AND IT CHANGES THE ERROR TEXT.** `j-content.spine.test.ts`
sets `relayIngressProxy: true` (added by `024-ORPHANTRIAGE`), so the daemon dials the proxy's port
and the proxy forwards to the relay's. `028` measured that turning it off changes the failure from
`Unexpected EOF` to `ECONNRESET` / `Encryption failed` — **the wording, not the outcome.** Its own
comment claims it is *"inert while nothing black-holes it"*; that claim is measurably false and is
recorded as `028` *Newly discovered* #4. **Run every measurement BOTH ways** and say which you are
reporting.

---

## Part 1 — Establish who closes the connection. No code changes.

Answer A / B / C above with evidence, both with and without the ingress proxy. **State plainly what
you cannot prove from the evidence you have** rather than choosing the likeliest.

## Part 2 — Fix it, WITH A STOP RULE.

**⚠️ THE STOP RULE.** If the fix turns out to be a change to libp2p's own transport or encrypter
configuration on either side, or a change to how reservations are granted, **STOP.** Write it up
under *Newly discovered* with the evidence and hand back. Those are fleet-wide wire decisions and
this is not the order for them.

**What you may fix inside this unit:** a relay listener or handler that stops serving, a daemon
dialling an address it should not, a connection torn down by our own code on either side, a
peerstore entry that outlives what it describes.

---

## Part 3 — The ways to get this wrong, ruled out in writing

**Wrong fix 1 — "make the client retry the dial until it connects."** This milestone has already
paid for one unbounded retry: 232,056 knocks over 62 hours and a 484 MB log. A relay that has stopped
answering must reach the operator as a refusal, not as a hang.

**Wrong fix 2 — "deposit to a relay that IS connected."** The park relay comes from the session
assignment. A client that picks its own relay is a client grading its own homework —
`LEAFPARTIES-1` and `CORROBORATE-1` spent themselves closing exactly that.

**Wrong fix 3 — "keep the proven node instead of falling back."** The fallback exists because a node
with no reservation is still better than no node. Holding a node the relay will not reserve for does
not give it a reservation; it gives it a node that looks reachable and is not. Fix the silence, not
the fallback.

**Wrong fix 4 — "remove the ingress proxy."** `024-ORPHANTRIAGE` needs it. If it turns out to be
implicated, say so with evidence; do not delete another unit's fixture to make your test pass.

---

## Definition of Done

1. **Who closes the connection is ESTABLISHED and written down verbatim** — with the evidence, both
   with and without the ingress proxy, and with an explicit statement of what could not be proven.
2. **The cause is fixed, or handed back under Part 2's stop rule with the evidence.** State plainly
   which happened.
3. **A relay that stops answering reaches the operator as a named refusal**, not as silence — the
   half `028-PARKCONN` already shipped must still hold on whatever path this changes.
4. **Enforcer — `j-content` `DOD-MSG-5`, `DOD-MSG-7` and `DOD-MSG-8` green across THREE CONSECUTIVE
   runs**, as separate OS processes, with the run output quoted. Three because the failure is
   intermittent and one green run proves nothing here.
   > ⚠️ **AND THE GREEN IS WEAKER THAN IT READS.** `028` gave the spine helper a bounded retry on
   > `cause: standing_receiver_creating`, so these tests will go green partly because the test waits
   > the receiver rebuild out. It cannot tell "the rebuild is instant" from "the rebuild takes 19
   > seconds". Do not quote the green as proof that window closed.
5. **Each new assertion has been made to fail on purpose** and confirmed to fail for the reason
   expected. **Commit before the mutation loop exists.**
6. Gate passes in every repo touched. State whether anything publishes.
7. Reviewed by `cello-unit-reviewer`, every finding fixed, verdict quoted below.
8. `DOD-M15-PARKCONN-1` flipped in `M15-DEFINITION-OF-DONE.md` **in the same commit as the verdict**,
   then `python3 docs/planning/user-stories/m15/tools/dod-order-sync.py` exits 0.

**Not in scope:**
- **The error-reporting layer.** `028-PARKCONN` shipped it: deposit, pull and recover all refuse with
  a named reason and a next step, and the dial failures are on the response and in the log. Do not
  rebuild it.
- **The relay's reservation slot accounting.** `008-slots` owns it, and the cap is measured not to
  have fired here.
- **`relayIngressProxy`'s own correctness.** Recorded as `028` *Newly discovered* #4. Measure both
  ways; do not fix the proxy.

---

## Traps recorded before you start

**THE RELAY IS NOT DEAD.** It keeps serving the live session — submitting hashes, delivering leaves —
while refusing the park dial. Do not start from "the relay crashed".

**THE PROOF SUCCEEDED.** Both sides logged it. Do not start from "authentication failed".

**THE PORT IN THE DIAL IS THE PROXY'S, NOT THE RELAY'S.** In `j-content` the relay binds one port and
advertises another. Comparing them is the first thing to do with any address in a log line.

**ANOTHER LANE MAY BE RUNNING.** Bringing up Postgres needs BOTH a unique `COMPOSE_PROJECT_NAME` and
a unique `CELLO_PG_HOST_PORT` — the port alone does not isolate you, because both worktree
directories are named `trustless-cello` and compose derives the same project name.

**Work in a PAIRED worktree** — `<lane>/cello-client` and `<lane>/trustless-cello` as siblings, and
load `/worktree-permissions` before creating one.

**`pnpm run build` in `cello-client` before any spine journey.** The spine runs `dist/`, not source.

---

## Review

### Where this work lives
*(worktree paths, branch, and the `COMPOSE_PROJECT_NAME` / `CELLO_PG_HOST_PORT` you used)*

### Who closes the connection, verbatim
*(DoD 1 — required whether or not Part 2's stop rule fired.)*

### The rest
*(the three consecutive runs, the mutation proof, the reviewer's verdict)*

## Newly discovered

*(anything found and NOT acted on, per rule 3)*
