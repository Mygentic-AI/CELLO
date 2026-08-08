---
name: relay-stops-notarizing-fleet-wide
type: discussion
date: 2026-08-08
topics: [relay, directory, seal, notarization, health-check, diagnosis, launch-triage, libp2p]
description: >
  Every seal on the fleet stopped for four hours and no alarm fired. The relay loses its connection
  to its configured directory, never re-establishes it, and passes a static health check throughout.
  Three plausible causes were proposed and each disproved by measurement — recorded so nobody re-runs
  them. Restored by a manual restart; the defect is untouched. Filed as launch-triage item 14.
---

# The relay stops notarizing, fleet-wide, and reports itself healthy

## What happened, from the operator's chair

You finish a conversation and close it. Nothing comes back — no error, no receipt. The close hangs
about seven minutes and reports a timeout. So does the next one, and every one after it, on every
machine, for every user, until somebody restarts a server by hand.

Between **06:57 and 11:07 UTC** on 2026-08-08, not one session sealed. Nothing was deployed in that
window. Nothing on the network changed. No alarm fired.

## The measurements

| | |
|---|---|
| Sealed normally | 06:43:45, 06:44:39, 06:57:48 UTC — three sessions, FROST-notarized, receipts issued |
| Failed | 09:23, 09:32, 09:39, 10:46 ×2 — five attempts |
| Coverage of the failures | two machines and one machine; cross-node and same-node; documents and plain chat; **two different client builds** |
| Restored | relay container restart at 11:07:45; the next close returned a receipt (`ff534c48…`) |

The failure signature is three log lines, and the timing is the whole story:

```
10:46:53.680  relay.seal.broker.resolved
10:46:53.681  relay.seal.broker.unreachable   directory_unavailable
10:46:53.682  relay.seal.rejected             directory_unavailable
```

**One millisecond.** Nothing crosses a region in a millisecond — not a timeout, not a refusal, not a
failed Noise handshake. No packet was sent. This is a local throw wearing a network-shaped name.

## What it is

One connection — relay to its configured directory — established at boot in `bin/relay.ts`
(`directoryAdapter.connect(relayResult.node)`, immediately after node startup), working, then dying
silently and never being re-established. There is **no reconnect, no keepalive, and no health check
on it**.

Two facts fix that as the shape:

- The same relay kept serving client traffic normally throughout — `relay.hash.submitted` and
  `relay.leaf.delivered` minutes after seals stopped. So it is not globally out of capacity, and it
  is not a dead process.
- At 06:57 the configured directory **answered**: `use1` built a seal certificate, found the
  initiator homed elsewhere, and the relay redirected delivery to `usc1`, which notarized it. That
  is not an inference of reachability — the node did real work and replied. That connection was
  alive at 06:57:43 and gone by 09:23.

## Three causes proposed, three disproved — do not re-run these

Recorded because each was argued convincingly and each cost time.

**1. The schema migration (V58–V62, rolled 05:52–05:58 UTC).**
Disproved by: three seals succeeded between 06:43 and 06:57, 45 to 60 minutes *after* the last node
came up on that schema, one of them carrying document leaves through `recordConversationSeal`'s
children write — the exact path the new UNIQUE constraints touch. A revert of the fleet image was
proposed and correctly dropped.

**2. The replication threshold — `availableNodes:1` against `requiredThreshold:2`.**
Directory nodes genuinely do not replicate `last_heartbeat_at` (it is mutable; Tier A carries
immutable columns only), so every node counts itself as the only live one. Real, and still open.
**But not this.** `federation.checkpoint.skipped` logs that exact degraded count at 06:47:49,
06:52:30, 06:55:05 and 06:57:49 — *bracketing and interleaving the successful seals*. One second
after a seal notarized, the checkpoint skipped for want of nodes. A gate cannot be a gate while
something passes through it.

**3. A libp2p dial backoff window.**
Fits the 1ms local throw beautifully. Disproved by the clock: attempts ran 09:23, 09:32 (+8 min),
09:39 (+7 min), **10:46 (+67 min)** — and the attempt after a 67-minute gap still failed in a
millisecond. Any sane backoff cap had long expired. Also, the failing attempts targeted *two
different* directories with different peer ids, so one poisoned peer cannot explain both.

A fourth was proposed and disproved without ever being argued: a firewall change. VPC rules are open
to the world and were created 2026-07-28, untouched; all three directories accept new TCP on 4000
and 8080 and complete a WebSocket upgrade (HTTP 101) on demand; DNS resolves correctly; and the peer
id the relay pins matches what the node logs at startup. Nothing is blocked.

## Why it took a morning, which is part of the defect

- **`relay.seal.broker.unreachable` is logged as a WARNING on every seal, including successful
  ones.** It fired four seconds before the seal that worked. Both agents chased it as the cause for
  hours. A warning that fires on the happy path is not a warning.
- **`directory_unavailable` is one string over opposite failures.** In
  `network-directory-adapter.ts` it is returned by the `if (!this.#node)` guard *and* as the fallback
  when a caught throw is not an `Error`; a real dial failure surfaces as `err.message` instead. A
  null node reference and a dead network want opposite fixes, and the name only describes one of
  them.
- **The health check cannot see any of it.** It returns `{status:'ok', relayId}` statically. A relay
  that cannot notarize a single session passes every probe, so nothing alerts and no autohealer acts.

## What actually worked as a method

**Diffing a WORKING trace against a failing one, on the same fleet.** Reading the failing trace alone
produced three wrong causes; every one of them survived because the failing trace is consistent with
several stories. The working trace is where the answer was — it contained an extra step
(`relay.seal.redirected`) and a directory that demonstrably answered, and both facts are invisible
if you only look at what broke.

The second thing that worked: **treating the timestamp precision as evidence.** The whole diagnosis
turns on the gap between `.680` and `.681`.

## Owed

Filed as **launch-triage item 14, `DOD-RELAY-DIRECTORY-RECONNECT-1`** — unranked pending Andre, with
a proposed high slot. Three parts, in order of what matters:

1. **Re-establish the connection instead of failing forever.** Whatever drops it will drop it again;
   the missing recovery is the defect. The restart is a workaround, not a fix.
2. **Make the health check test what the relay is for** — a relay that cannot reach a directory must
   fail its probe so the autohealer replaces it, rather than staying up and mute.
3. Split `directory_unavailable` into distinct reasons and stop warning on the success path.

**Separately open, both found the same day, neither the cause of this:** `directory_nodes`
heartbeat needs real Tier B replication, and `signal_records` anti-entropy fails every round on a
`scanner_version` NOT NULL violation (1530 consecutive failures, driving the fork alarm).

## Related

- [[launch-triage]] item 14
- [[replication-gap-what-m12-left-unfinished]] — the Tier A/Tier B split that strands `last_heartbeat_at`
- [[cross-node-signaling-audit]] — the seal flows that cross node boundaries
