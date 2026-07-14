---
name: DOD-NAT-REACHABILITY-1
type: mini-sprint
date: 2026-07-14
topics: [transport, libp2p, nat-traversal, hole-punching, circuit-relay, dcutr, standing-receiver, launch-blocker]
status: open
description: >
  A CELLO agent on a normal machine CANNOT RECEIVE an inbound session. The standing receiver binds to
  127.0.0.1 unless the operator hand-sets CELLO_LISTEN_ADDR, and no node ever takes a circuit-relay
  reservation, so it has no dialable address of any kind. DCUtR (hole punching) is installed but can
  never fire — it upgrades an existing relayed connection, and no relayed connection is ever made. The
  app-level relay park masks the failure by store-and-forwarding the message, so it looks like it works.
---

# `DOD-NAT-REACHABILITY-1` — inbound sessions are impossible for a normal user

> **THE ONE-LINE VERSION.** Only agents with a **public routable IP** and **two hand-set env vars**
> can be reached. Everyone else — every laptop, every home connection, every corporate network —
> announces `127.0.0.1` and is dialable by nobody. Hole punching is not "broken": the precondition for
> it was never built, so it has never once executed.

**Read this whole document before touching code.** It contains the reproduction, the exact file:line
of every relevant piece, what is already correct (a lot), and the false trails already burned. It is
written so you do not need to go exploring.

---

## 1. What is actually wrong

Four facts. Each is verified in the source, with the line number.

**FACT 1 — the standing receiver binds to loopback.**
`core/daemon/src/daemon.ts:129-133` (`ProductionSessionNodeFactory.createNode`):

```js
const isReceiver = config.nodeType === "standing_receiver";
const listenAddr =
  isReceiver && process.env["CELLO_LISTEN_ADDR"]
    ? process.env["CELLO_LISTEN_ADDR"]
    : "/ip4/127.0.0.1/tcp/0";          // ← LOOPBACK
```

The standing receiver is **the node that accepts every inbound session**. With no `CELLO_LISTEN_ADDR`
set, it listens on loopback and therefore announces loopback. Nobody on earth can dial it. This is not
a NAT problem — a user with a public IP and no env var is equally unreachable.

The demo agent works ONLY because its systemd unit sets `CELLO_LISTEN_ADDR=/ip4/0.0.0.0/tcp/4001` and
`CELLO_ANNOUNCE_ADDRS=/ip4/<EIP>/tcp/4001`. That is the entire reachability story today.

**FACT 2 — no node ever takes a circuit-relay reservation.**
Grep the whole client for `/p2p-circuit`. It appears **three** times, and every one either filters it
out or describes it:

```
core/transport/src/node.ts:49     if (addr.includes("/p2p-circuit")) return false;   // filters OUT
core/transport/src/node.ts:260    ... !c.remoteAddr.toString().includes("/p2p-circuit")  // filters OUT
core/transport/src/types.ts:163   // a comment describing what one is
```

It is **never added to a node's listen addresses**. In libp2p, listening on
`/p2p/<relay-peer-id>/p2p-circuit` is what makes a node take out a **reservation** with that relay and
advertise a relayed address. No listen entry ⇒ no reservation ⇒ **no dialable address of any kind**
for a NAT'd peer.

**FACT 3 — DCUtR can therefore never fire.** DCUtR (the hole punch) works by upgrading an **existing
relayed connection** into a direct one. With no reservation there is no relayed connection, so DCUtR
has nothing to upgrade. It is instantiated (`node.ts:413`) and inert. It has never executed in
production, not once.

The header comment at `core/transport/src/node.ts:356` describes the intended design:

> *"dcutr() is included for session nodes … so a **relay-fallback connection** can be hole-punch
> upgraded to direct"*

**The relay-fallback connection it upgrades is never established.** The comment documents a system
that was never wired.

**FACT 4 — DCUtR is explicitly OMITTED from the standing receiver**, which is the one node that needs
inbound reachability. `core/transport/src/node.ts:363` + `:413`:

```js
const includeDcutr = opts.nodeType !== "standing_receiver";
...
...(includeDcutr ? { dcutr: dcutr() } : {}),
```

Justified in the comment as *"a standing receiver only needs to know its own dialability, not upgrade
existing connections."* That reasoning is wrong once reservations exist: the standing receiver is
precisely the node whose relayed inbound connection you want upgraded to direct.

---

## 2. Why nobody noticed (this matters — it is why it survived to now)

There are **two different things called "relay"** in this codebase, and only one of them was built:

| | what it is | status |
|---|---|---|
| **CELLO relay** (`packages/relay`) | application-level **store-and-forward mailbox** — park a sealed message, receiver pulls it later | ✅ built, works |
| **libp2p circuit relay** | **transport-level** relay carrying a LIVE connection, and the precondition for hole punching | ❌ never wired client-side |

When a direct dial fails, the send does not error. It falls into the **mailbox**:

```
{ ok: false, reason: "dispatched_to_relay", ... }
"The counterparty is not directly reachable right now, so this message was sealed and
 dispatched to relay store-and-forward."
```

The message *does* eventually arrive. So the system looks like it works — just asynchronously. **The
mailbox masks the total absence of live NAT traversal.** Worse: in the observed case the receiver only
pulled the parked content **on daemon restart** (it does not poll), so "eventually" meant "when the
process next booted".

---

## 3. Provenance — how this was found

Not from reading code. From a latency benchmark, by accident.

The task was to baseline send/receive latency before merging `m9-switch-on`. Two counterparties were
used:

1. **Loopback** (`Ms_Chelly`, same daemon) — worked. Wire latency 2 ms.
2. **Remote** (the EC2 demo agent) — and here the two directions behaved **differently**, which is the
   whole finding:

| direction | result |
|---|---|
| **me → demo** (I initiate) | `session.transport.connected` → `delivered: true`. Live. ~2 s round trip. |
| **demo → me** (demo initiates) | `session.transport.connect.failed`, `reason: counterparty_dial_failed`. **No live transport.** My reply → `dispatched_to_relay` (mailbox). |

The demo agent is on a public EIP with the env vars set, so it is reachable. My laptop is behind NAT,
so it is not. The asymmetry is the bug, in one observation.

**Andre's read, which is correct:** *"this type of failure is a failure for many potential users."* A
real user is the laptop, not the EC2 box.

---

## 4. HOW TO REPRODUCE IT YOURSELF

You do **not** need a third-party agent. Drive the demo agent's CLI over SSM and have it dial you.
That is the whole test rig.

### 4a. The demo agent

- **EC2 instance:** `i-0ad3e7c22470f266e`, region `us-east-1`
- **Install dir:** `/opt/cello-demo` (services run as user `cello-demo`)
- **Services:** `cello-daemon` and `cello-demo` (systemd)
- **Public IP:** `32.196.100.165`, port `4001` open
- **Its agent:** name `default`, pubkey `7ab98987de127b81dc4013d8c0b7e70b65f95db647e0977d492f41566ec1f910`
- **Versions (as of 2026-07-14):** daemon `0.0.53`, connect `0.0.71`, cli `0.0.51` — matching `latest`
- It is a **plain Node process with no LLM** — it replies from a hardcoded 4-message sequence. This
  makes it an excellent instrument: **no model latency contaminates your timings.**

Run a command on it:

```bash
CMD_ID=$(aws ssm send-command --instance-ids i-0ad3e7c22470f266e \
  --document-name AWS-RunShellScript --region us-east-1 \
  --parameters 'commands=["<YOUR COMMAND>"]' \
  --output text --query 'Command.CommandId')
sleep 10 && aws ssm get-command-invocation --command-id $CMD_ID \
  --instance-id i-0ad3e7c22470f266e --region us-east-1 \
  --query 'StandardOutputContent' --output text
```

Its CLI (note `CELLO_DIR` — it is not the default):

```bash
cd /opt/cello-demo && CELLO_DIR=/opt/cello-demo/.cello \
  node node_modules/@cello-protocol/cli/dist/bin/cello.js <cmd>
```

### 4b. The reproduction, in two steps

**Step 1 — have the DEMO dial YOU.** Get your own agent's pubkey (`cello status` locally), then:

```bash
# on the demo box, via SSM:
cd /opt/cello-demo && CELLO_DIR=/opt/cello-demo/.cello \
  node node_modules/@cello-protocol/cli/dist/bin/cello.js initiate-session <YOUR_PUBKEY>
```

The session is created. Now read the demo's daemon log:

```bash
journalctl -u cello-daemon --no-pager -n 60 | grep -E "transport.connect|dial"
```

**You will see:**

```
{"event":"session.transport.connect.failed","reason":"counterparty_dial_failed", ...}
{"event":"session.initiate.connect.failed","reason":"counterparty_dial_failed", ...}
```

**Step 2 — send a message back on that session** (from your side, MCP `cello_send` or the CLI).
It returns:

```
{ "ok": false, "reason": "dispatched_to_relay", "delivered": false }
```

That is the mailbox. There is no live path. **That is the bug.**

**The control:** initiate the session from YOUR side to the demo's pubkey instead. It connects and
delivers live (`delivered: true`). Outbound works; inbound does not.

### 4c. Confirm your own standing receiver is on loopback

```bash
grep -o '"event":"session.node.created"[^}]*' ~/.cello/daemon.log | tail -2
```

Cross-check against `daemon.ts:131` — with no `CELLO_LISTEN_ADDR`, it is `/ip4/127.0.0.1/tcp/0`.

---

## 5. What is ALREADY correct — do not rebuild these

A surprising amount of this is done. The missing piece is small and specific.

| piece | where | status |
|---|---|---|
| `circuitRelayTransport()` (dial *via* a relay) | `core/transport/src/node.ts:383` | ✅ configured |
| `dcutr()` | `node.ts:413` | ✅ configured (but omitted for standing receivers — see FACT 4) |
| `autoNAT()` | `node.ts:412` | ✅ configured on all nodes |
| **The relay node ACCEPTS reservations/HOP** | `packages/relay/src/index.ts:100` — `circuitRelayServer({ hopTimeout: 30_000 })` | ✅ **the far end is ready** |
| **The client already RECEIVES the relay's identity + addresses** | `core/daemon/src/session-node-manager.ts:82-83` — `relayPeerId: string; relayAddrs: string[]` (directory-signed relay assignment) | ✅ **it already knows which relay to reserve with** |
| Announced addresses come from `getMultiaddrs()` | `core/transport/src/node.ts:173-175` | ✅ **a circuit address will be announced automatically once we listen on one** |
| The two `/p2p-circuit` filters | `node.ts:49`, `node.ts:260` | ✅ **both are CORRECT — leave them.** `isPubliclyDialable` rightly says a circuit addr is not *direct*; `hasDirectConnectionTo` rightly excludes relayed conns when asking whether DCUtR already succeeded. Neither strips announcements. |

**The single missing wire:** nobody ever puts `/p2p/<relayPeerId>/p2p-circuit` into a node's
`listen` array.

---

## 6. Proposed fix

### F1. Standing receiver must not bind to loopback
`core/daemon/src/daemon.ts:131`. Default to `/ip4/0.0.0.0/tcp/0`, not `127.0.0.1`. `CELLO_LISTEN_ADDR`
stays as an override for publicly-hosted agents. On its own this fixes nothing for a NAT'd user — but
loopback is indefensible regardless, and it is a precondition for a direct connection ever working for
a user who *is* publicly reachable.

### F2. Take a circuit-relay reservation (THE CORE FIX)
The standing receiver must listen on `/p2p/<relayPeerId>/p2p-circuit` in addition to its TCP address.
libp2p then reserves with that relay and adds the relayed address to `getMultiaddrs()`, which is
already what gets announced (`node.ts:173`). Inbound dials then reach it **through the relay**.

The relay's peer id and addrs are already in hand — `relayPeerId` / `relayAddrs`
(`session-node-manager.ts:82-83`).

### F3. Enable DCUtR on the standing receiver
`node.ts:363` — remove the `nodeType !== "standing_receiver"` exclusion. Once F2 gives it a relayed
inbound connection, DCUtR upgrades it to direct where the NAT allows. **And where the punch fails
(symmetric NAT, strict corporate firewalls), the relayed connection simply STAYS UP and carries the
session live** — which is exactly the fallback Andre asked for. F2 buys both the hole punch and the
graceful degradation, from one change.

### F4. Only then does the mailbox become a true last resort
Store-and-forward should be what happens when the peer is **offline**, not when it is **online and
merely NAT'd**. Today it absorbs both, which is what hid this.

### ⚠️ THE OPEN DESIGN QUESTION — this is the hard part, and it is why this is a sprint

**The relay assignment is per-SESSION, but the reservation must exist BEFORE any session.**

`relayPeerId` / `relayAddrs` arrive in a **directory-signed relay assignment** during session
establishment. But the standing receiver is created at **`agent.online`**
(`session-node-manager.ts:4328`), long before any session exists — and it must *already be reachable*
for an inbound session request to arrive at all. Chicken and egg.

So a reservation must be obtained at **agent-online time**, which means answering:

- **Which relay does an agent reserve with, before any session assigns one?** The consortium manifest
  presumably names the relays — confirm and use that.
- **Does the reservation need to be directory-signed/authorised**, as the per-session relay assignment
  is? (There is an Option-B signed-assignment scheme — `session-node-manager.ts:88`. Understand whether
  reservations must ride the same rail, or whether an unauthenticated libp2p reservation is acceptable.)
- **Reserve with ONE relay or several?** The sovereign-node redundancy invariant argues for more than
  one — a single relay reservation makes that relay a single point of failure for the agent's entire
  inbound reachability. That is exactly the dependency CELLO exists to avoid.
- **Reservations expire.** libp2p circuit-relay-v2 reservations are time-bounded and must be renewed.
  Who owns renewal, and what happens to inbound reachability if renewal fails?

**Do not hand-wave these.** The reservation lifecycle is the actual design work; the listen-address
change is three lines.

---

## 7. False trails already burned — DO NOT REPEAT THESE

**7a. `primary_pubkey` from `register-agent` is NOT the agent's address.** It is the FROST group key
from the DKG. The addressable pubkey is the one `cello status` shows, and it does **not** change on
re-registration. Several hours were lost looking up the group key, getting `unknown_agent` (correctly),
and inventing a directory bug to explain it. **If a lookup fails, check WHICH KEY you looked up first.**

**7b. There is NO directory bug.** No stale in-memory profile cache, no federation replication gap, no
registration divergence. The us-east-1 directory resolves the demo agent correctly and always did. All
three directory nodes participated in its DKG (`participants: 3, threshold: 2`). A directory ECS task
restart was very nearly performed to "fix" a problem that did not exist.

**7c. `session.relay.hash.submit.failed` (reason `session_not_found`) is real but SEPARATE.** It is a
race — the client submits the leaf hash before the relay has registered the session. It is swallowed,
and it fires on *fast* (bash-driven) clients, not on every session. See
[[2026-07-14_frost-ceremony-latency-trace]]. Not this sprint. Do not get pulled into it.

**7d. Do not measure anything through the MCP tools.** Tool-level timestamps measure the LLM, not
CELLO — a round trip reads as 41 s when the wire is 2 ms. **The daemon log is the only honest
instrument.** Both this investigation and the FROST latency trace independently wasted time on this.

---

## 8. How you will know it is fixed

The reproduction in §4b, reversed:

1. From the demo agent (public), `initiate-session` to a **NAT'd laptop** agent.
2. `session.transport.connected` fires — **no `counterparty_dial_failed`**.
3. A message from the laptop returns `delivered: true`, **not** `dispatched_to_relay`.
4. The laptop's `listenAddresses()` includes a `/p2p-circuit` address.
5. Bonus: DCUtR upgrades the relayed connection to direct (look for a dcutr event, and
   `hasDirectConnectionTo` → true). If the punch fails, the session must **still work over the relayed
   connection** — that is the acceptance criterion that matters most, because it is the case that
   protects users on hostile networks.

**Prove it with the daemon logs on both sides, not a unit test.** A unit test cannot see a NAT.

---

## 9. Why this is the top complex issue

- It breaks **inbound sessions for essentially every real user**. A laptop, a home connection, a
  corporate network — all of them can call out and none of them can be called.
- It is silently masked by the store-and-forward mailbox, so it presents as "CELLO is slow" rather than
  "CELLO cannot receive", which is the worst possible way for a defect to present.
- The launch bar is *"two agents connect and communicate — including when you control only one of
  them."* If the other party cannot dial you, that bar is not met. **This is squarely unforgivable.**

## Related

- [[2026-07-14_frost-ceremony-latency-trace]] — the FROST/session-setup latency trace. Same instrument
  (two-sided daemon logs), and the source of the `relay.hash.submit.failed` note in §7c.
- [[M8C-DEFINITION-OF-DONE]] — where `DOD-NAT-REACHABILITY-1` should be tracked.
- `core/transport/src/node.ts` — `createNode`, the libp2p service map, the two circuit filters.
- `core/daemon/src/daemon.ts:121-147` — `ProductionSessionNodeFactory`, the loopback default.
- `core/daemon/src/session-node-manager.ts:4328` — where the standing receiver is created.
- `packages/relay/src/index.ts:100` — the relay's `circuitRelayServer`, already accepting HOP.
