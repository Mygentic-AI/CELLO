---
name: relay-keepalive-parked-drain-workorder
type: workorder
date: 2026-08-04
topics: [relay, keepalive, store-and-forward, content-park, standing-receiver, gcp, daemon, delivery, m12]
status: open
description: >
  Work order for the cross-machine delivery failure discovered 2026-08-04 during the first
  Mac↔EC2 Hermes-bridge test: the client↔relay link dies every ~60-90s (prime suspect:
  libp2p's default ConnectionMonitor aborting connections on one timed-out ping, both ends),
  and parked store-and-forward content is only drained on daemon/agent start — not on the
  relay reconnects that actually happen — so messages stall undelivered until an operator
  restarts the daemon. Likely also resolves the 2,061 untraced "aborted due to timeout"
  errors in launch-triage. Proposed DoD IDs: DOD-RELAY-KEEPALIVE-1, DOD-PARK-DRAIN-1,
  DOD-GCP-RELAY-DRIFT-1.
---

# Work order — relay link churns every 60s, and parked content stalls until a daemon restart

**Proposed DoD IDs: `DOD-RELAY-KEEPALIVE-1`, `DOD-PARK-DRAIN-1`, `DOD-GCP-RELAY-DRIFT-1`**
(open the lines in `M12-DEFINITION-OF-DONE.md` before starting).

**Repos:** the keepalive + infra drift fixes are in `trustless-cello` (`packages/relay`,
`infra/terraform`); the drain fixes are in `cello-client` (`core/daemon`). The relay-through
path this breaks is the **default** path for any two NAT'd peers — which is nearly every
real-world pairing — so both halves gate the launch claim that two strangers' agents can
converse reliably.

**Also resolves an open launch-triage item:** the 2,061 untraced
`The operation was aborted due to timeout` relay reader errors
(`docs/planning/launch-triage.md:145-155`) are this defect — see §3.

---

## 1. How this was discovered

2026-08-04: first cross-machine CELLO conversation between two independent daemons —
`CELLO_Coder_1` (Mac, Claude Code) and `Miss_Chelly_H` (EC2 `i-06db70df6b3e32207`,
freshly registered, bridged into a Hermes Agent instance via `cello bridge hermes`).
Both machines: cli 0.0.123 / daemon 0.0.120. Both NAT'd (`autonat: dialable false,
publicAddr null`), so every session ran `transportMode: "relay"` through the GCP relay
`gcp-relay-use1` (`ws://34.139.119.165:4001`).

Observed, repeatedly and in **both directions**:

- Session handshakes succeeded (FROST ceremony, `session.node.created`, genesis roots).
- Live message delivery **failed by default**: the sender logged
  `session.relay.hash.submit.failed reason: relay_stream_closed`, parked the content
  (`content.park.deposited`, `session.content.dispatched_to_relay`), and the receiver's
  `cello_receive` timed out indefinitely with liveness flapping alive→gone→alive.
- Every parked message was delivered **instantly and completely** the moment the
  *receiving* daemon was restarted (`cello logout && cello login`) — decrypted intact,
  `undecryptable: 0`.
- Same-daemon loopback sessions (two agents on one Mac daemon) never showed any of this.

The restart-delivers-everything signature is what localized the defect: crypto, parking,
and ingest all work; the **drain trigger** never fires while the daemon runs.

## 2. Defect A — the client↔relay link dies every ~60-90 seconds

Both machines' logs show `session.standing_receiver.reservation.lost
reason: relay_connection_gone` roughly once a minute (450 occurrences in one Mac log),
and the relay stream reader ends with `The operation was aborted due to timeout`. The
client code already documents the symptom as known churn (`cello-client
core/daemon/src/daemon.ts:613`: "the stream turns over roughly every 70 seconds" — the
2026-07-31 standing-receiver incident).

**Observational correction (made during this investigation):** the seemingly exact
":03/:33 metronome" of `reservation.lost` events is the **standing-receiver watchdog's 30s
sampling grid** (`#srWatchdogIntervalMs = 30_000`, session-node-manager.ts:442) — the
detection time, not the death time. The actual `relay.reader.ended` timestamps are
irregular. Do not chase a fixed-60s reaper on the strength of those timestamps.

**Prime suspect — libp2p's own connection monitor.** libp2p 3.3.2 enables
`ConnectionMonitor` **by default** on every node (`libp2p/dist/src/libp2p.js:108`):

- pings every connection every **10s** (`DEFAULT_PING_INTERVAL_MS = 10000`),
- with an **AdaptiveTimeout** on each ping,
- and `abortConnectionOnPingFailure` defaulting to **true** — one timed-out ping and the
  monitor calls `conn.abort(err)` on the whole connection
  (`libp2p/dist/src/connection-monitor.js`).

The Node abort error text for a timed-out signal is exactly the string in our logs —
*"The operation was aborted due to timeout"* — the same untraced error open in
`launch-triage.md:145-155` (2,061 occurrences). Both ends run this monitor (daemon and
relay each ping the other), so **either side's** timed-out ping over a slow WAN hop or a
busy event loop kills the link. A missing ping *protocol* is tolerated
(`UnsupportedProtocolError` counts as alive); a slow ping *response* is fatal.

This also **refutes the initial idle-reaper theory**: with pings flowing every 10s the
link is never idle, so GCP conntrack cannot be the primary killer. For the record, the
GCP path has no LB and therefore no AWS-style `idle_timeout` knob to mirror
(`infra/terraform/node-relay.tf:303-309` — direct 1:1 NAT; the only timeout in the GCP
terraform tree is the 10s health check). The AWS M6B ALB fix
(`cello-ecs-relay.yaml:133-155`) addressed a different, LB-specific instance of this class.

**Already handled — do not re-fix:** the circuit-relay-v2 default limits (2 min / 128 KiB
per relayed connection — the classic go/js-libp2p footgun) are already disabled in the
production relay: `relayServer.reservations.applyDefaultLimit: false`,
`maxReservations: 4096` (`packages/relay/src/relay-node.ts:1868-1875`, with a comment
block recording the earlier discovery). Note the **legacy `startRelay` factory in
`packages/relay/src/index.ts:89-100` still runs libp2p defaults** (limits applied,
maxReservations 15) — it is not used by the production binary (`bin/relay.ts` uses
`createRelayNode`), but it is a loaded gun for anyone who reaches for it; remove or fix it.

**Verification step (do this first):** run a daemon with libp2p component debug logging
enabled (`DEBUG=libp2p:connection-monitor*`) alongside the relay's logs, and confirm
"aborting connection due to ping failure" correlates with the `reader.ended` /
`reservation.lost` events. If confirmed, the fix below is certain; if not, instrument the
relay side the same way before proceeding.

## 3. Defect B — parked content is only drained where parking doesn't happen

The store-and-forward design is sound: park encrypted on the relay
(`content.park.deposited`), receiver pulls, decrypts in-daemon, ingests through the same
funnel as a direct receive, delete-on-confirm (`cello-client
core/daemon/src/content-park.ts` — `recoverParkedFromRelay`, `autoRecoverForAgent`).
Ingest is deduped and confirm-deleted, so extra drains are cheap and idempotent.

The defect is **trigger coverage**. `autoRecoverForAgent` runs from exactly three places:

1. Agent start (`daemon.ts:1792`) — the only one that reliably fires. This is why restarts
   deliver everything.
2. Directory-signaling `onConnected` (`daemon.ts:610`, M8C-RELAYWAKE-1 "check relay on
   wakeup") — hooked to the **wrong connection**. Content parks when the **relay** stream
   drops; the drain fires when **directory signaling** reconnects. Measured on the Mac
   after the 19:13 restart: directory signaling connected at 19:13 and 19:17 and then
   stayed stable through the entire failed-session window, while the relay churned 7
   times. Zero `content.recover.auto.completed` events in that window; two messages sat
   parked for >5 minutes until the next restart.
3. The seal-upgrade content gate (not a delivery path).

**Defect B2 — the one live trigger races itself.** In `onConnected` (`daemon.ts:610-630`),
`autoRecoverForAgent` and `ensureStandingReceiverForAgent` are both fired void/concurrent.
The drain needs the standing-receiver node (`content-park.ts:70`); when it wins the race it
fails `standing_receiver_unavailable`. Mac log counts: 102 `content.recover.auto.failed`,
84 `content.recover.auto.relay_failed`, and drains that do run report
`recovered: 0, failedRelays: 1`. The agent-start path (`daemon.ts:1783-1792`) already
chains ensure→drain correctly; the reconnect path doesn't.

**Defect B3 — diagnostics:** the `auto.failed` events log `error: "[object Object]"`
(daemon.ts catch stringifies non-Error rejections badly), which is why these 100+ failures
were never diagnosable from logs alone.

**Net effect:** on the relay path — the default path for NAT'd strangers — any message that
hits a churn gap parks and then **stalls until a human restarts the receiving daemon**.
With Defect A churning the link half the time, that was most messages. But B is
independent of A: fix the churn and any genuine outage (laptop lid, network blip, daemon
down for upgrade) still strands content until restart.

## 4. The evidence trail (2026-08-04, all times UTC)

| Time | Event |
|---|---|
| 18:37 | `cello bridge hermes --agent Miss_Chelly_H` installed on EC2; gateway restarted |
| 19:0x | Miss_Chelly_H→Coder_1 session `e093db3c…`: created OK, first message parked, arrived on Mac **only after** Mac daemon restart at 19:13:32 (session already force-abandoned by then) |
| 19:13:36-39 | Mac restart drains: `content.recover.auto.completed recovered: 1` — the queued message |
| 19:17:25 | Coder_1→Miss_Chelly_H session `66d98ce5…`: created OK; send returned `delivered: false, reason: dispatched_to_relay` |
| 19:17-19:22 | EC2 `messageCount: 0` across 5 min of relay reconnects; no drain events |
| ~19:22 | EC2 daemon restarted → message delivered intact (`cello transcript` shows full text, `undecryptable: 0`); session left `interrupted` |
| 19:22:56 | Miss_Chelly_H→Coder_1 session `4c28edcd…`: EC2 sent seq 0 at 19:23:19 → `relay_stream_closed` → parked; re-sent seq 1 at 19:26:10 → hash submitted but content again `dispatched_to_relay`; Mac received nothing through 19:28 |
| throughout | both sides: `reservation.lost` every ~60s; `autonat dialable: false`; Mac shows zero recover attempts between signaling connects |

Versions: `@cello-protocol/cli` 0.0.123, `@cello-protocol/daemon` 0.0.120, both machines.

## 5. The fix

### DOD-RELAY-KEEPALIVE-1 [trustless-cello + cello-client] — stop the monitor from killing healthy links

After the verification step in §2 confirms the connection-monitor attribution, tune
`connectionMonitor` on **both** ends (it is on-by-default at both):

- **Relay** (`packages/relay/src/relay-node.ts` createRelayNode libp2p options, and the
  transport `createNode` it delegates to): set `abortConnectionOnPingFailure: false` —
  the relay must never sever a client link on one slow ping; liveness there is the
  reservation TTL's job. Keep pinging (the traffic doubles as keepalive against any
  genuine network-level reaper, enterprise firewalls included).
- **Daemon** (`cello-client core/transport/src/node.ts:573` — the `keepAliveIntervalMs`
  passthrough already exists): likewise `abortConnectionOnPingFailure: false` for the
  relay/standing-receiver connection, or at minimum a generous fixed `pingTimeout`
  replacing the AdaptiveTimeout for WAN links. Session-peer liveness detection
  (`counterparty_liveness` → 'gone') must be preserved — scope the change to relay
  connections, not all connections, if the two need different policies.
- Remove or de-footgun the legacy `startRelay` factory
  (`packages/relay/src/index.ts:89-100` — libp2p default limits still applied there).

Acceptance: a daemon↔relay connection through the GCP path stays up ≥30 min with zero
`reservation.lost / relay_connection_gone` events while carrying an idle session; the
launch-triage "aborted due to timeout" count stops growing; cross-machine live delivery
(two daemons, two machines) succeeds without store-and-forward fallback.

Secondary (structural parity with AWS, non-blocking): front `gcp-relay-*` with the
regional external ALB the migration plan prescribed, and republish the manifest to the LB
address (`infra/scripts/publish-gcp-relay-manifest.mjs:114,119`).

### DOD-PARK-DRAIN-1 [cello-client] — drain where the parking actually happens

1. **Drain on standing-receiver (re)build.** Add an `onStandingReceiverReady(agentName)`
   hook to `SessionNodeManager`, fired on every successful `#ensureStandingReceiver` —
   which covers the watchdog rebuild path (`#reservationWatchdogTick` →
   `#rebuildStandingReceiver`, session-node-manager.ts:4980-5006), the auth_ok rebuild
   (`setDirectoryRelayEndpoints`), and initial ensure. Wire it in daemon.ts to
   ensure→drain, same ordering as the agent-start path.
2. **Fix the `onConnected` race** (daemon.ts:610-630): chain
   `ensureStandingReceiverForAgent(...).then(() => autoRecoverForAgent(...))` instead of
   two concurrent voids.
3. **Backstop timer:** a slow periodic drain (piggyback the existing reservation watchdog
   interval; every ~5 min is ample) so no future missed trigger can strand content.
   Dedup + delete-on-confirm make this safe by construction.
4. **Fix error serialization** in the auto-recover catch paths so the next failure logs a
   reason, not `[object Object]`.

Acceptance: with the relay churning (Defect A deliberately unfixed in the test, e.g. via a
forced 60s stream reset), a message parked mid-conversation is delivered to a running
receiver daemon within one watchdog interval, **no restart** — proven across two separate
daemons/machines, not loopback. Regression test at the daemon level for ensure→drain
ordering.

### DOD-GCP-RELAY-DRIFT-1 [trustless-cello] — close the AWS/GCP config drift

1. `RELAY_SESSION_MAX_IDLE_MS`: GCP cloud-init sets **1800000 (30 min)**
   (`infra/terraform/templates/relay-cloud-init.yaml:69`) vs AWS **86400000 (24 h)**
   (`cello-ecs-relay.yaml:101-103`). Set GCP to 86400000.
2. Add the GCP-side regression test asserting relay timeout/idle config in terraform —
   the AWS value is asserted in `infra/tests/test_m6b_007.py`; the absence of a GCP
   equivalent is exactly why this drift shipped unnoticed.

## 6. Sequencing

1. **DOD-PARK-DRAIN-1 first** — it is the correctness fix; it makes every other failure
   recoverable, and it is provable locally against a deliberately-flapping link.
2. **DOD-RELAY-KEEPALIVE-1** — turns the relay path from
   works-in-60s-windows into works.
3. **DOD-GCP-RELAY-DRIFT-1** — config + test, can ride along with either.

Ship the cello-client half via `/cello-publish` (version-bump cascade per the publishing
invariants) before the next `latest` promotion, so operators pay one upgrade, not two.
