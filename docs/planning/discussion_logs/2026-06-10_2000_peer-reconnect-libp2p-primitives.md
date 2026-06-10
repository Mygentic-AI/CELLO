---
name: peer-reconnect-libp2p-primitives
type: discussion
date: 2026-06-10
topics: [reconnect, relay, directory, client, libp2p, peer-discovery, onPeerDisconnect, autonat, gossipsub, dht, signaling, m6b-018]
status: complete
description: >
  Investigation of how relays, directories, and clients tell each other they
  exist and where to find them. Establishes that the core reconnect problem
  is simple — one unused hook — not the complex keepalive architecture proposed
  in the M6B-018 investigation report. Also evaluates Perplexity's recommendation
  to use AutoNAT, DHT, and gossipsub, and where those primitives do and do not apply.
---

# Peer Reconnect: What We Have, What We're Missing, How to Fix It

## Background

This discussion emerged from three parallel threads:

1. The reconnect cluster fault injection investigation (Scenario 4 — directory
   redeploy while client is running), which surfaced the question of how the
   relay re-registered with the new directory without restarting.
2. A Perplexity conversation about libp2p primitives for peer address updates
   (AutoNAT, DHT peer records, gossipsub address broadcast).
3. Re-reading the M6B-018 investigation report, which proposed a ping/pong
   keepalive mechanism, in light of what we now know.

The investigation of the Scenario 4 relay logs showed that the relay did NOT
re-register — the finding was a misreading. The relay log showed
`relay.already.registered` at its own startup (10:16 UTC), not during Scenario 4
(16:10 UTC). The directory was receiving continuous `relay.health.check.passed`
events throughout the Scenario 4 window, confirming the relay never dropped.
The rule in `infra/CLAUDE.md` — restart relay after every directory redeploy —
remains correct. There is no reconnect logic in the relay.

---

## The Three Relationships

CELLO has three pairs of nodes that need to maintain live connections:

| Pair | Who initiates | Current state |
|------|--------------|---------------|
| Relay → Directory | Relay dials directory at startup, registers, never re-dials | Broken after directory restart |
| Client → Directory | Client opens signaling stream at startup | Partially broken — lazy reconnect on some tool calls, none for idle clients |
| Client ↔ Relay | Per-session only — client dials relay after session assignment | Works correctly (stateless per session) |

---

## What libp2p Already Provides in `createNode`

Reading `cello-client/core/transport/src/node.ts` directly:

```
services: {
  identify: identify(),
  relay: circuitRelayServer(),
  dcutr: dcutr(),
}
transports: [tcp(), webSockets(), circuitRelayTransport()]
```

And `CelloNodeImpl` exposes:
```typescript
onPeerConnect(handler: (peerId: string) => void): void
onPeerDisconnect(handler: (peerId: string) => void): void
```

Both hooks are wired to libp2p's `peer:connect` and `peer:disconnect` events.
They fire. They just aren't acted upon.

**What is NOT present:** `autonat`, `kad-dht`, `gossipsub`.

---

## Where the Hooks Are Currently Used

In `relay-node.ts` (lines 264–271):
```typescript
this.#node.onPeerConnect((connectedPeerId) => {
  protocolLog("RELAY", `Peer connected: ${short}`);
});
this.#node.onPeerDisconnect((disconnectedPeerId) => {
  protocolLog("RELAY", `Peer disconnected: ${short}`);
});
```

Logging only. Nothing acts on the disconnect.

In the client (`client.ts`): `onPeerConnect` and `onPeerDisconnect` are not
called at all. The client detects stream closure through the `iter.next()`
returning done on the signaling stream reader loop — which is a stream-level
event, not a transport-level event. The only reconnect that fires is a 200ms
one-shot triggered only when there are pending seal sessions.

---

## The Actual Fix: It Is Simple

The `onPeerDisconnect` hook exists, fires, and is wired to nothing useful.
The fix for all three relationships is the same pattern:

**Relay → Directory:**
In `relay-node.ts`, replace the log-only `onPeerDisconnect` handler with:
```
if disconnectedPeerId === directoryPeerId:
  call registerWithDirectory() with exponential backoff
```
`registerWithDirectory` already exists in `NetworkDirectoryAdapter`. It already
handles the `already_registered` response gracefully. This is approximately
15 lines of code. No new interfaces, no new protocols.

**Client → Directory:**
In `SignalingManager.onSignalingStreamClosed()` (or equivalently in the
`client.ts` reader loop cleanup), replace the conditional 200ms one-shot
reconnect (which only fires for pending seal sessions) with an unconditional
`#runReconnectLoop()` call. The reconnect loop design is already in the M6B-018
investigation report — exponential backoff from 2s to 5min ceiling. The only
change from what was already designed is: trigger unconditionally on stream
close, not conditionally on seal state.

The client also receives `onPeerDisconnect` events from libp2p when the
underlying transport connection drops (not just the stream). Wiring this as a
second trigger for the reconnect loop would catch cases where the stream closes
without the reader loop detecting it.

**Directory → Relay (for `recordAssignment`):**
The directory's `NetworkRelayAdapter` dials the relay before every
`recordAssignment` call (lines 107–108 in `network-directory-adapter.ts`):
```typescript
for (const addr of this.#directoryMultiaddrs) {
  try { await this.#node.dial(addr); break; } catch { /* try next */ }
}
```
This is a lazy reconnect — it re-dials on every operation. It works because
the relay's DNS address is stable (M6B-019). This direction is already handled
correctly. No change needed.

---

## What Was Actually Wrong During M6/M6B

The reconnect failures during M6 and M6B were almost entirely infrastructure
problems, not protocol problems:

- Relay couldn't reach directory: no NAT gateway (fixed M6B-014)
- Directory used stale private relay IP: address staleness (fixed M6B-019)
- Relay had no stable peer ID: transport key not persisted (fixed M6B-006)
- Multiple orphan cello-mcp processes: PID lock file (fixed M6B-001)
- Bootstrap returned null at wake: bootstrap retry loop missing

The signaling stream dropping mid-session was real but rare in practice. The
instances where "reconnect didn't work" were almost always one of the above
infrastructure failures, not a missing keepalive.

This matters because it changes the priority and scope of M6B-018.

---

## Evaluating Perplexity's Recommendations

Perplexity recommended: AutoNAT, Kademlia DHT, gossipsub, circuit relay
hop/stop. These are the right tools for a large open P2P network where you
don't know your peers. CELLO is not that network — yet. Assessment:

**AutoNAT — load-bearing for dcutr; not low priority.**
Directories and relays have stable ALB DNS hostnames. They always know their
public address. AutoNAT is designed for nodes that don't know if they're
dialable and need to ask peers to check. Clients — which run on developer
laptops with no stable DNS — need AutoNAT to determine whether their address
is dialable, and to decide whether to advertise a direct multiaddr or a
circuit-relay multiaddr.

The original analysis called this "low priority." That was wrong. `dcutr()` —
libp2p's hole-punching protocol — is already present in `createNode`. DCU
upgrades two clients communicating through a relay to a direct connection when
NAT permits. For dcutr to function correctly, a client must know whether it is
dialable from the outside. Without AutoNAT, the client attempts hole-punching
blind — it does not know if the other side can reach it. AutoNAT is the
precondition for dcutr working at all.

At scale — thousands of clients all relaying through 20–40 directory/relay nodes
with stable DNS — the relay connection count becomes a real capacity concern.
DHT and gossipsub remain unnecessary for node address propagation (the signed
manifest handles that at any scale). But AutoNAT + dcutr is how CELLO moves
some of that connection load off the relay once clients can reach each other
directly. This matters at 1,000 clients, not just at 100,000.

Priority reassessment: AutoNAT is an M7 concern, not a future-network concern.
It should be on the M7 outline alongside multi-agent client-to-client sessions.

**DHT — premature.**
The DHT is designed for a network where you don't know the addresses of peers
you want to find. CELLO has 3 directories and 3 relays, all with addresses in
SSM. There are no unknown peers. DHT would be the right mechanism when the
network has hundreds of nodes operated by strangers. For now, SSM is a simpler
and more operationally transparent address registry.

**Gossipsub — premature.**
The gossipsub recommendation is for broadcasting "I'm alive with new IP" to
all nodes in the network. In CELLO's current topology, the set of nodes that
need to know a relay's new address is: the 3 directories (who already get it
via `relay_register` on startup) and the clients (who get it from the manifest
that the directory signs). Gossipsub would be appropriate once the network has
many nodes who can't all be enumerated in a central registry.

**Circuit relay — already present, correctly configured.**
`circuitRelayServer()` and `circuitRelayTransport()` are already in `createNode`.
The circuit relay infrastructure exists. What the Perplexity conversation
correctly identifies is that clients should use circuit-relay multiaddrs rather
than trying to advertise their direct IP — which changes on every laptop sleep.
This is a future design decision for when clients need to be reliably dialable
from other agents.

---

## What M6B-018 Should Actually Deliver

The M6B-018 investigation report was written assuming the problem was idle TCP
connections dropping silently and the client not detecting it. That assumption
was based on the symptom (`directory_reachable: false` after laptop sleep) before
the root cause was understood. The root cause (established by Scenario 5 of the
fault injection investigation) was the bootstrap endpoint returning null when
the process restarted during sleep — not a dropped TCP connection.

The ping/pong keepalive design in the investigation report is not wrong — it
would prevent the 11-second Yamux timeout delay before the directory detects
a dead client. But it is not the most important thing to fix.

**Revised M6B-018 scope in priority order:**

1. **Bootstrap retry on startup failure** — if `fetchDirectoryAddress` returns
   null/fails at startup, retry with exponential backoff rather than starting
   with `directory_reachable: false` permanently. This is the direct fix for
   the Scenario 5 failure. One retry loop, ~10 lines.

2. **Unconditional reconnect on signaling stream close** — replace the
   conditional 200ms seal-only one-shot with `#runReconnectLoop()` called
   unconditionally. The loop design is already in the investigation report.
   This fixes idle clients that don't reconnect after a directory restart.

3. **Relay `onPeerDisconnect` → re-register** — wire the existing hook to call
   `registerWithDirectory()` with backoff when the directory peer disconnects.
   This eliminates the "restart relay after directory redeploy" operational rule.

4. **Ping/pong keepalive** — still worth doing for production to detect dead
   streams faster than Yamux's 11-second timeout, but it is not the fix for
   any of the failures actually observed. Lowest priority of the four.

Items 1 and 2 are client-side (cello-client). Item 3 is relay-side
(trustless-cello). Item 4 touches both.

The investigation report's ping/pong design for items 2 and 4 is correct and
can be retained. The main revision is: add item 1 (bootstrap retry) as the
top priority, and clarify that item 3 (relay reconnect) is a separate concern
that lives in relay-node.ts / NetworkDirectoryAdapter, not in SignalingManager.

---

## Proposed Story Split

Given the scope clarification, M6B-018 could remain as one story covering
items 1, 2, and 4, with a separate small story for item 3 (relay reconnect).
Or all four could be one story with the relay reconnect added as new ACs.
The relay reconnect is simple enough (~15 lines) that bundling it makes sense.

---

## Summary

The reconnect problem is simpler than it looked. The infrastructure failures
during M6/M6B masked it and made it seem like a fundamental protocol gap.
Now that those are resolved:

- The client bootstrap retry is ~10 lines
- The signaling stream unconditional reconnect loop is already designed
- The relay re-registration on disconnect is ~15 lines using existing code
- The ping/pong keepalive is the largest piece and the lowest urgency

Total new code across all four items: probably 100–150 lines including tests.
No new libp2p services needed. No DHT, no gossipsub. The hooks already exist
and fire — they just need to be acted upon.

---

## References

- [[user-stories/m6b/M6B-018-investigation-report]] — ping/pong design, reconnect loop, cross-repo deps; still valid for items 2 and 4
- [[discussion_logs/2026-06-10_1456_reconnect-cluster-investigation-plan]] — fault injection plan
- [[discussion_logs/2026-06-10_1856_reconnect-cluster-findings]] — Scenarios 1–4 findings; Scenario 5 root cause (bootstrap null)
- [[discussion_logs/2026-06-06_2100_sovereign-node-networking-requirements]] — foundational document on why NAT gateways are required infrastructure
- [[user-stories/m6b/COORDINATION]] — "Known Gap — Mesh Reconnect" entry
