---
name: Post-wake directory DNS resolution failure — preliminary incident report
type: discussion
date: 2026-07-24
topics:
  - infrastructure
  - hibernation
  - dns
  - directory
  - incident
  - client-daemon
status: open — investigation in progress, NOT concluded
description: >
  Preliminary incident report. After a clean, fully successful wake of all 3 CELLO
  regions on 2026-07-24, the local client daemon cannot establish directory signaling.
  Server side is verified healthy from every angle checked. The surface-level blocker is
  that the three `directory-*` hostnames fail to resolve via the OS resolver
  (getaddrinfo) while resolving correctly via dig. Root cause is NOT established.
  Nothing has been fixed, flushed, or changed. This document is a running record to be
  appended to as the investigation continues.
---

# Post-wake directory DNS resolution failure — preliminary incident report

> **STATUS: OPEN. NOT A CONCLUSION.**
> This is a factual record of what was run, what was observed, and what remains unknown.
> Hypotheses are labelled as such and are explicitly *not* settled. Nothing in this
> incident has been remediated — no DNS cache was flushed, no infrastructure was changed,
> no scripts other than the wake itself were run against AWS.

---

## 0. For a reader with zero context

CELLO's dev environment is three sovereign directory nodes, one per region
(`us-east-1`, `eu-central-1`, `ap-northeast-1`). To save cost the whole environment is
regularly **hibernated** (ALBs / NAT Gateways / VPC endpoints deleted, ECS scaled to 0,
RDS stopped) and later **woken** (all of it recreated). Because ALBs are deleted and
recreated, they get **new DNS names every wake**, and Route53 alias records are rewritten
to point at the new ALBs.

Clients (the local `cello` daemon on an operator's machine) find the directories by
hostname — `directory-us1.cello.mygentic.ai` and friends — then fetch `/bootstrap` over
HTTP to learn each node's libp2p multiaddr, then open a signaling stream.

This incident: **the wake succeeded completely, the servers are healthy, and the local
daemon still cannot connect.**

---

## 1. Timeline of what was actually run

All times UTC.

### 1.1 Prior hibernate — 2026-07-23 19:42–19:46

- Script: `infra/scripts/hibernate.sh`
- Command: `./infra/scripts/hibernate.sh --execute --yes`
- Result: **HIBERNATION COMPLETE**, no errors. All 3 regions torn down as designed.
- Recorded in `infra/STATE.md` (commit `e9ff00d2`).

Relevant detail: hibernate **deletes the ALBs** for both directory *and* relay in every
region. Both sets of hostnames therefore pointed at nothing during the down window.

### 1.2 Wake — 2026-07-24 16:01:26 → 16:17:44

- **Script: `infra/scripts/wake.sh`** ← *the script in question; read this file first*
- Command run: `./infra/scripts/wake.sh --execute --yes`
- Run as a background task; full stdout captured at:
  `/private/tmp/claude-501/-Users-andrep-Documents-code-trustless-cello/5ac88d9f-0f84-4b8d-951f-4b38eeb20914/tasks/b2ows3js6.output`
  (337-line-class log; **ephemeral /tmp path — copy it somewhere durable if this
  investigation continues past a reboot**)
- Elapsed: **16 min 18 s**. Notably fast; the previous wake took 40 min because
  us-east-1 RDS was slow to start. No RDS bottleneck this time.
- Exit code: **0**
- Final banner: `WAKE COMPLETE`
- Inventory diff per region: **`✅ No differences — environment is identical (structurally)`**
  for all three of us-east-1, eu-central-1, ap-northeast-1.

### 1.3 Were there problems during the wake?

**No hard failures. One soft warning, three times — and it is directly relevant.**

Zero lines in the wake log matched `error|fail|warn|unable|denied|timeout|retry`.
The only warning-marker lines in the entire run were these three (log lines 137, 212, 279
— one per region):

```
!   /manifest returned HTTP 000000 — directory may still be starting
```

Nothing else required intervention during the wake. No manual AWS actions were taken
during or after the wake. `infra/STATE.md` was updated and pushed (commit `d0971f01`).

### 1.4 This warning is NOT new — it recurred on the previous wake

The 2026-07-22 wake produced the **identical warning in all three regions** (that log,
also still on disk at
`/private/tmp/claude-501/-Users-andrep-Documents-code-trustless-cello/4ea6d6cf-b2d1-4d3a-b1a3-86679e175afe/tasks/bwhm544tu.output`,
lines 146, 156, 280).

So this symptom has now appeared on **at least two consecutive wakes** and was written off
both times as startup timing.

---

## 2. The wake script's own verification has a blind spot (FACT, code-level)

This is the single most important structural finding so far, and it is not a hypothesis —
it is what the code does.

`infra/scripts/wake.sh`, verification step 7/7 (~lines 521–533):

```bash
# DNS check
dir_ip=$(dig @8.8.8.8 +short "${DIR_SUB}.${DOMAIN}" ...)
[[ -n "$dir_ip" ]] && ok "  DNS ${DIR_SUB}: ${dir_ip}" || warn "... NOT RESOLVING ..."

# HTTP health check on /manifest (public, no auth)
manifest_code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 \
  "http://${DIR_SUB}.${DOMAIN}/manifest" 2>/dev/null || echo "000")
[[ "${manifest_code}" =~ ^(200|301|302)$ ]] \
  && ok "  /manifest HTTP ${manifest_code}" \
  || warn "  /manifest returned HTTP ${manifest_code} — directory may still be starting"
```

Two different resolution paths are used in the same verification block:

| Check | Resolution path | Result this wake |
|---|---|---|
| DNS check | `dig @8.8.8.8` — queries Google's resolver directly, **bypasses the OS resolver and its cache entirely** | ✅ reported OK, printed an IP |
| HTTP check | `curl` — uses the **OS resolver (`getaddrinfo`)**, the same path a real client uses | ❌ HTTP `000` |

**Consequence:** the wake script validates DNS over a path that *no actual client uses*,
then when the check that *does* use the real path fails, it attributes the failure to
"directory may still be starting" and continues to print `WAKE COMPLETE`. The script
reports success while the environment is unreachable by a real client on that machine.

This is the "no error ⇒ success" / silent-fallback class of defect called out in
`.claude/CLAUDE.md` and `infra/CLAUDE.md`. Flagged here; **not fixed** — remediation is
deliberately out of scope for this document.

---

## 3. The symptom

After the wake, the local daemon cannot connect.

- `cello_initiate_session` (Ms_Chelly → CELLO_Support) returns:
  `{"ok":false,"reason":"directory_signaling_timeout"}`
- `cello_status` reports `"directory_signaling":"reconnecting"` persistently.
- All 5 local agents show `state: online`, `standing_receiver_ready: true` — i.e. the
  daemon is healthy locally; it just cannot reach any directory.

Daemon log (`~/.cello/daemon.log`), repeating every ~30s, one triple per attempt:

```json
{"level":"warn","event":"directory.consortium.node.unresolved","nodeId":"us-east-1","endpoint":"http://directory-us1.cello.mygentic.ai","ts":"2026-07-24T16:28:05.627Z"}
{"level":"warn","event":"directory.consortium.node.unresolved","nodeId":"eu-central-1","endpoint":"http://directory-eu1.cello.mygentic.ai","ts":"..."}
{"level":"warn","event":"directory.consortium.node.unresolved","nodeId":"ap-northeast-1","endpoint":"http://directory-ap1.cello.mygentic.ai","ts":"..."}
{"level":"info","event":"directory.signaling.reconnecting","attempt":21,"backoffMs":30000,"directoryNodeId":"unknown","ts":"..."}
```

Event counts over a recent window of the log: `directory.consortium.node.unresolved` ×596,
`directory.signaling.reconnecting` ×174, `directory.bootstrap.unavailable` ×174,
`directory.bootstrap.failover.lost` ×23.

**All three sovereign nodes fail identically.** The client's failover logic is working as
designed (it tries all three); there is simply nothing to fail over to.

---

## 4. Server side — verified healthy from every angle checked (FACTS)

Each of these was checked directly against AWS or the live endpoint:

| Check | Result |
|---|---|
| ECS `cello-directory-dev` all 3 regions | `running:1, desired:1, rollout:COMPLETED` |
| Bootstrap ALB target group health, all 3 regions | `healthy` |
| Route53 alias targets vs live ALB DNS names | **exact match in all 3 regions** (see below) |
| `/bootstrap` fetched **by IP** with `Host:` header | **HTTP 200 + valid body** |
| Wake inventory diff, all 3 regions | IDENTICAL |

Route53 → ALB correspondence verified:

```
directory-ap1.cello.mygentic.ai. → cello-dir-dev-1360605312.ap-northeast-1.elb.amazonaws.com.
directory-eu1.cello.mygentic.ai. → cello-dir-dev-1689370715.eu-central-1.elb.amazonaws.com.
directory-us1.cello.mygentic.ai. → cello-dir-dev-122037600.us-east-1.elb.amazonaws.com.
```
…and `describe-load-balancers` returns exactly those three names as the live directory ALBs.

The `/bootstrap` payload is well-formed and is precisely what the client requires:

```json
{"multiaddr":"/dns4/directory-us1.cello.mygentic.ai/tcp/80/ws/p2p/12D3KooWS46wUj6NYvoAsocxZnxth5EgYD2ZXCm7coMkXUWgS1j3",
 "peerId":"12D3KooWS46wUj6NYvoAsocxZnxth5EgYD2ZXCm7coMkXUWgS1j3"}
```

**There is no evidence of any server-side or AWS-side defect.**

---

## 5. Tracing the client failure to its producer (FACTS, code-level)

Producer of the `unresolved` event — `cello-client/core/daemon/src/directory-bootstrap.ts`:

- `manifestNodesToEndpoints()` (~L122) probes each consortium node's `/bootstrap`.
- L140–147: if `fetchBootstrapMultiaddr()` returns falsy → log
  `directory.consortium.node.unresolved` and drop that node.
- `fetchBootstrapMultiaddr()` (~L37–57) returns `null` unless **all** of:
  `resp.ok` is true, the body parses as JSON, and `json.multiaddr` is a string containing
  `/p2p/`. It has a 5s AbortController timeout and a bare `catch { return null }`.

The by-IP fetch (§4) satisfies every one of those conditions. Therefore the failure is in
**reaching the host by name from this machine**, not in the response.

Note for later: that `catch { return null }` collapses *every* distinct failure (DNS
failure, connection refused, TLS error, timeout, malformed JSON) into one indistinguishable
`unresolved` warning. That is why the daemon log cannot, by itself, tell us *why* the fetch
failed. Worth revisiting as an observability defect — again, **not fixed here**.

---

## 6. The surface-level blocker (FACT) and what falsifies the obvious story

### 6.1 Established fact

The three `directory-*` names **fail via the OS resolver** but **succeed via `dig`**:

```
=== getaddrinfo (what curl and the daemon's fetch use) ===
directory-us1: socket.gaierror: [Errno 8] nodename nor servname provided, or not known
directory-eu1: socket.gaierror: [Errno 8] nodename nor servname provided, or not known
directory-ap1: socket.gaierror: [Errno 8] nodename nor servname provided, or not known

=== dig (queries the DNS server directly, bypassing the OS cache) ===
directory-us1: 100.59.244.161
directory-eu1: 63.183.171.25
directory-ap1: 18.178.208.217
```

Consistent with this, `curl` to the hostname fails with **exit code 6
(CURLE_COULDNT_RESOLVE_HOST)**, while `curl` to the same host **by IP** returns HTTP 200,
and a `curl http://example.com` control returns HTTP 200 (so general networking is fine).

**This is the surface-level blocker: on this machine, the directory hostnames do not
resolve through the path that real clients use.** Why that is true is *not* established.

### 6.2 The obvious explanation is materially weakened by a control

The intuitive story — "hibernation deleted the records, the OS cached NXDOMAIN, the
negative entry is stale" — **does not survive the control test**:

```
=== CONTROL — other names in the SAME zone, via getaddrinfo ===
portal.cello.mygentic.ai      100.51.84.134   ✅
relay-us1.cello.mygentic.ai   35.174.97.47    ✅
relay-eu1.cello.mygentic.ai   3.126.117.159   ✅
relay-ap1.cello.mygentic.ai   13.158.100.165  ✅
```

The **relay ALBs were deleted and recreated by exactly the same hibernate/wake cycle** as
the directory ALBs. If a generic hibernation-induced negative cache were the cause, the
`relay-*` names should be poisoned too. They are not. Only the three `directory-*` names
fail.

Additional facts that constrain any explanation:

- **Timing doesn't fit a simple stale cache.** Negative DNS caching is typically
  60–900s. The wake finished 16:17:44; failures were still occurring past 16:28 and
  continued through repeated daemon restarts.
- **Record shape is identical** between a failing and a working name — both are A-only
  (two A records each), neither has AAAA, same zone, comparable TTLs (77 vs 61):
  ```
  directory-us1.cello.mygentic.ai. 77 IN A 100.59.244.161 / 98.94.216.140
  relay-us1.cello.mygentic.ai.     61 IN A 35.174.97.47   / 3.93.125.52
  ```
- **No `/etc/hosts` entries** exist for anything `cello`.

---

## 7. What was tried, and what it did or didn't tell us

| # | Action | Outcome |
|---|---|---|
| 1 | `cello_initiate_session` → CELLO_Support, repeatedly | `directory_signaling_timeout` every time |
| 2 | `cello logout && cello login` (by assistant, 16:20) | Daemon restarted clean, 5 agents online; **signaling still `reconnecting`** |
| 3 | MCP server restart via `/mcp` (by Andre, ×2) | Reconnected; **no effect on daemon signaling** — MCP restart does not restart the daemon. Side effect: clears the selected agent, requiring `cello_use_agent` again |
| 4 | `cello logout` / `login` again (by Andre) | **No change** — still `reconnecting` |
| 5 | ECS / target-group / Route53 / ALB verification | All healthy (§4) |
| 6 | `/bootstrap` by IP + Host header | HTTP 200, valid multiaddr (§4) |
| 7 | getaddrinfo vs dig comparison | The core discrepancy (§6.1) |
| 8 | Control test on `portal` / `relay-*` names | Weakened the negative-cache story (§6.2) |
| 9 | A/AAAA record comparison, `/etc/hosts` inspection | No difference found |

**Deliberately NOT done** (per instruction, and to preserve evidence):
`dscacheutil -flushcache`, `killall -HUP mDNSResponder`, any resolver reset, any AWS
change, any code change. **A cache flush would destroy the primary evidence** and must not
be run until the resolver state has been captured.

### 7.1 A wrong turn, recorded for accuracy

Early in the investigation the assistant asserted that the `curl` failure was caused by a
"sandboxed environment" blocking DNS. **That was a hypothesis stated as fact, and it was
wrong.** It was retracted once a control (`curl http://example.com` → 200) showed general
networking was fine. Recorded here because the incorrect framing briefly misdirected the
investigation, and because the real finding (getaddrinfo vs dig) only emerged after
discarding it.

---

## 8. Hypotheses — NONE CONFIRMED

Ordered by current plausibility. Each needs evidence that has not yet been gathered.

**H1 — Self-renewing negative cache scoped to the queried names.**
The daemon polls only `directory-*` on a 30s reconnect loop. During the ~20h hibernation
those queries returned NXDOMAIN and were cached. Nothing ever queries `relay-*` by DNS
during downtime (relay endpoints come from the signed manifest, not DNS), so those names
were never poisoned. Each subsequent failed retry may **re-cache** the negative result,
continuously renewing it and explaining persistence far beyond a normal negative TTL.
*This explains both the selectivity and the timing.* **Not yet tested.**
Next step: inspect mDNSResponder cache state read-only (`dscacheutil -q host`,
`scutil --dns`, `log show --predicate 'process == "mDNSResponder"'`) **before** any flush.

**H2 — Resolver-level issue unrelated to caching** (split-horizon, scoped resolver, search
domain, VPN/interface-specific resolver). Not investigated. `scutil --dns` would show it.

**H3 — Something specific to the `directory-*` records themselves** at the Route53 or
resolver level not visible in the A/AAAA comparison already done. Considered less likely
given §4 showed the aliases are correct, but not excluded.

**H4 — Client-side DNS caching inside the daemon's Node runtime.** Node/undici can hold
its own lookup results. This would *not* explain the plain `curl` and Python
`gethostbyname` failures, so it cannot be the whole story — but it could be a
**compounding** factor that outlives an OS-level fix, which matters when validating any
future remediation.

---

## 9. Why this is being treated as serious

If this reproduces on an end-user machine, the failure mode is:

- Every CELLO client on that machine loses all three directories at once.
- The client is *behaving correctly* — it tries all three and correctly reports them
  unreachable.
- The server-side is *entirely healthy*, so all operator-side dashboards look green.
- The wake script prints `WAKE COMPLETE`.
- The user's only visible signal is `directory_signaling_timeout` / `reconnecting`.
- A reasonable user — and a reasonable operator — concludes "the servers are down."

The diagnosis required comparing two resolution paths, which is not something a user would
think to do. **The gap between "operator sees green" and "user sees total outage" is the
real risk here**, independent of what the root cause turns out to be.

Note this is a **dev/alpha environment with a single operator and no external users**, so
there is no live customer impact right now. It is being investigated at this depth because
the failure mode would be severe and near-undiagnosable *if* it reached users — not
because anything is currently on fire.

---

## 10. Open questions for the next session

1. What is actually in the mDNSResponder cache for the three `directory-*` names?
   **Capture this read-only before flushing anything.**
2. Does `scutil --dns` show any scoped/split resolver that would treat these names
   differently?
3. Does the negative entry survive a flush, and does it re-poison while the daemon keeps
   retrying? (Tests H1's self-renewal claim.)
4. Why did `relay-*` and `portal` escape? Confirm whether anything queries those names by
   DNS during a hibernation window.
5. Did this occur on the 2026-07-22 wake as well — i.e. was the daemon equally unable to
   connect then, or did only the wake script's check fail? The identical warning appears in
   that log; whether client connectivity was also broken is **unverified**.
6. Should `wake.sh` verification use the OS resolver rather than `dig @8.8.8.8`, so it
   fails loudly instead of printing `WAKE COMPLETE`? (See §2.)
7. Should `fetchBootstrapMultiaddr`'s blanket `catch { return null }` distinguish DNS
   failure from connection failure from timeout? (See §5.)

---

## 11. Current state of the environment (as of writing)

- **AWS: fully awake and healthy in all 3 regions.** Nothing has been changed since the
  wake completed at 16:17:44.
- **Local daemon: running, all 5 agents online, `directory_signaling: reconnecting`,**
  still retrying on a 30s backoff.
- **No remediation applied. Evidence preserved.**
- Two interrupted sessions remain pending between `Ms_Chelly` and `CELLO_Support`
  (session `dbb93dfcf415b7cbfe13626f5b168a3f`, interrupted 2026-07-23T17:34:46Z).
- Related STATE.md commits: `e9ff00d2` (hibernate), `d0971f01` (wake).

---

## 12. Session 2 findings — fault localized to mDNSResponder's negative cache (2026-07-24, 16:35–16:50 UTC)

Investigation continued in a second session. All captures read-only; still nothing flushed or
remediated. Each numbered item below is a measured fact.

### 12.1 The upstream resolver answers correctly — the fault is local

`scutil --dns` shows resolver #1 is **`172.20.10.1` on en0 — an iPhone Personal Hotspot
gateway**. This machine's DNS path runs through a phone's DNS proxy and a mobile carrier's
resolver chain. No scoped/split resolver, no search-domain oddity (H2 shows nothing else).

Queried directly, that upstream answers **correctly, right now**, for the failing names:

```
dig @172.20.10.1 directory-us1.cello.mygentic.ai A
→ status: NOERROR, 2 A records (100.59.244.161 / 98.94.216.140, TTL 77)
```

…identical in shape to `relay-us1` (NOERROR, 2 A, TTL 51). AAAA for both: NOERROR/0 answers
with SOA (TTL 900, MINIMUM 86400) — no difference between failing and working names upstream.

### 12.2 mDNSResponder serves a cached negative entry for exactly the three directory names

`dscacheutil -q host -a name` returns **empty** for `directory-us1` and **both IPs** for
`relay-us1` — from the same cache, seconds apart.

`dns-sd -G v4` (queries mDNSResponder directly, shows TTL and latency):

| Name | Answer | Displayed TTL | Latency |
|---|---|---|---|
| `directory-us1` | **No Such Record** | **2819** | ~0 ms — served from cache |
| `directory-eu1` | **No Such Record** | **2819** | ~0 ms |
| `directory-ap1` | **No Such Record** | **2819** | ~0 ms |
| `relay-us1` | 2 A records | 98 | ~0 ms (positive cache) |
| `doesnotexist-xyz.cello.mygentic.ai` (control) | No Such Record | 1127 | **452 ms — went upstream** |

The zero-latency negative answers, against a 452 ms upstream round-trip for a fresh
nonexistent name, prove the three directory names are answered **from a cached negative
entry** while the upstream would say NOERROR. **This localizes the entire incident to
mDNSResponder's negative cache on this machine.** (§6.1's surface observation now has its
mechanism.)

Corroborating: by-IP `/bootstrap` on **port 80** returns 200 + valid multiaddr from this
session too. (An earlier probe in this session hit port 443 and failed — that was a wrong-port
error, retracted: the directory serves 80, per the multiaddr `/tcp/80/ws`. Recorded per §7.1
practice.)

### 12.3 TTL display semantics — a renewal claim made and retracted

The displayed TTL 2819 was **identical across all three names and did not change over 4+
minutes of resampling**. This was briefly read as evidence of continuous renewal. A control
falsified that: `doesnotexist-xyz` also redisplayed its original 1127 unchanged ~4.5 min after
caching. **`dns-sd` displays the entry's original TTL, not remaining time.** So the pinned
value proves only: all three entries were minted with **original TTL 2819 s (~47 min)** —
renewal is neither proven nor excluded by this observation.

### 12.4 The TTLs themselves are anomalous — carrier chain implicated

Per RFC 2308 the negative TTL should be min(SOA TTL 900, MINIMUM 86400) = **900 s**. Observed:
fresh negative = **1127 s**, stale directory entries = **2819 s**. Neither matches the zone.
The upstream chain (iPhone DNS proxy → carrier resolver) is rewriting TTLs. This matters for
H1's timing objection in §6.2: "negative caching is typically 60–900 s" assumed clean
SOA-derived TTLs; this chain mints them at ~47 min.

### 12.5 Open at time of writing, and the discriminating test in flight

Creation time of the 2819 s entries is the pivotal unknown. A read-only watch (getaddrinfo
probe every 2 min) is running to catch self-expiry:

- **Expiry ≈ 16:55–17:15 UTC** → single stale entry minted around the wake window; self-heals,
  but ≈47 min of undiagnosable outage per wake for any client on such a network.
- **No expiry** → the entry re-poisons on refresh: something in the upstream chain still
  returns NXDOMAIN *to mDNSResponder's queries* while answering `dig` correctly —
  query-path-dependent, materially worse.

`sudo killall -INFO mDNSResponder` (SIGINFO state dump — read-only, NOT a flush) remains the
decisive capture: it records each cache entry's remaining TTL, giving creation time by
arithmetic. Awaiting operator execution.

### 12.6 Note for the eventual post-mortem (not remediation, just recorded)

The hotspot finding recasts §9: the trigger population is not "any macOS client after a wake"
but "any client whose resolver chain mangles negative TTLs" — hotspots, hotel/captive networks,
some ISP CPE. That is a *larger* real-world population than office LANs, and it makes the
failure environment-dependent: the same wake, on a different network, may produce no symptom
at all. It also means reproduction attempts must control for the network path.

---

## 13. ROOT CAUSE ESTABLISHED — observed self-heal closes the loop (2026-07-24, 17:07 UTC)

### 13.1 The decisive observation

A read-only watch (getaddrinfo probe every 2 min, started 16:48:32Z) captured the exact heal:

```
17:05:12Z FAIL
17:07:12Z RESOLVED 98.94.216.140   ← directory-us1 self-healed
```

Within seconds of us1 healing, **the daemon reconnected on its own**: `cello_status` flipped to
`directory_signaling: "connected"` with no daemon restart, no flush, no intervention of any
kind. At that moment eu1/ap1 were **still poisoned** (staggered heal — their entries were
minted seconds later; a second watch is timestamping their expiries). One healthy directory
sufficed: the failover design worked exactly as intended once DNS let a single node through.

Second watch: eu1 and ap1 both healed by **17:09:12Z** (first sample of a 1-min watch started
17:08:12Z) — total stagger across the three names under ~4 min, consistent with entries minted
seconds-to-minutes apart by the daemon's post-wake retry cycle. All three `/bootstrap`
endpoints returned HTTP 200 by hostname at 17:09. **Full client-side recovery, zero
intervention: nothing was ever flushed.**

### 13.2 Mint-time arithmetic — the poisoning happened AFTER the wake

- us1 entry expired between 17:05:12 and 17:07:12 Z.
- Original TTL (established §12.3): 2819 s.
- Therefore minted between **16:18:13 and 16:20:13 Z** — i.e. **30 s to 2.5 min AFTER the wake
  completed at 16:17:44 Z**, when Route53 authoritatively had the records again.

So the NXDOMAIN that poisoned the Mac was NOT served by Route53. It was served by the
**carrier/hotspot resolver chain's own stale negative cache** — still echoing the overnight
answer for a few minutes post-wake — and stamped with that chain's rewritten TTL of 2819 s.

### 13.3 The complete causal chain (each step evidenced)

1. Hibernate (2026-07-23 19:42Z) deletes the directory ALBs **and Route53 records**; the three
   `directory-*` names become NXDOMAIN. (`hibernate.sh`, by design.)
2. The local daemon keeps retrying signaling every 30 s all night, querying ONLY the
   `directory-*` names by DNS (relay endpoints come from the manifest; portal is never
   queried). → §6.2's selectivity: only these three names ever had negative answers to cache.
3. The overnight NXDOMAINs populate negative caches at TWO layers: the carrier/hotspot
   resolver chain (this Mac was on an iPhone Personal Hotspot, resolver 172.20.10.1 — §12.1)
   and the Mac's mDNSResponder.
4. Wake (16:01–16:17:44Z) recreates ALBs + records. Server side fully healthy (§4).
5. **≈16:18–16:20Z — the fatal mint:** the daemon's next retry asks upstream (the Mac-side
   entry from step 3 had expired or was refreshed); the carrier chain still serves its stale
   NXDOMAIN and stamps it TTL 2819 s; mDNSResponder caches it. The carrier chain's own staleness
   clears within minutes — but the Mac now holds the poison for ~47 minutes.
6. 16:18→17:07Z: mDNSResponder answers `No Such Record` from cache in 0 ms, never consulting
   the now-correct upstream (§12.2). Every client on this machine sees all three sovereign
   directories down at once. Wake log says COMPLETE; AWS dashboards green.
7. 17:07:12Z: the 2819 s TTL expires; the next query reaches the now-correct upstream; heal is
   instantaneous and automatic; daemon reconnects within one 30 s retry cycle.

**Root cause, one sentence:** hibernation makes the directory hostnames NXDOMAIN for ~20 hours
while the client daemon polls them every 30 s, seeding negative caches at every resolver layer
between daemon and Route53; on wake, whichever stale layer answers first re-poisons the layers
below it with an arbitrary (here TTL-rewritten, 47-minute) negative entry — producing a total,
silent, self-expiring client-side outage that no server-side check can see.

### 13.4 What this incident is NOT

- NOT a server/AWS defect — §4 stands; everything was healthy throughout.
- NOT a client code defect in failover — the daemon reconnected within seconds of the first
  name healing. (The `catch { return null }` observability gap of §5 remains real but did not
  cause the outage.)
- NOT specific to macOS/mDNSResponder in essence — the mechanism (client polls a
  deliberately-NXDOMAIN name; negative caches fill; wake races stale caches) applies to any
  OS/resolver stack; macOS + a TTL-mangling hotspot chain made it long and visible.
- NOT permanent — self-heals at negative-TTL expiry. The damage is bounded outage
  (here ~50 min) per wake, per affected client machine, with wildly variable duration
  depending on the client's resolver chain.

### 13.5 Answers to §10's open questions

1. Cache contents: negative entries confirmed via `dns-sd -G` behavior + observed expiry
   (SIGINFO is deprecated on this macOS; `dns-sd -O -stdout` is the current dump, root-only —
   ultimately not needed, the expiry watch answered the question).
2. `scutil --dns`: no split/scoped resolver; single hotspot resolver 172.20.10.1.
3. Entry did NOT survive expiry, and did NOT re-poison (upstream was correct again by then;
   zero A-record NXDOMAINs in a 10-min mDNSResponder log window pre-heal).
4. `relay-*`/`portal` escaped because nothing queries them by DNS during hibernation (only the
   directory names are polled by the daemon's reconnect loop).
5. The 2026-07-22 wake showed the identical `/manifest HTTP 000` warnings — now explained as
   the same mechanism, which self-healed unnoticed within the negative TTL.
6. YES — wake.sh should verify through the OS resolver / real client path (remediation R2).
7. YES — `fetchBootstrapMultiaddr` should distinguish DNS failure from connect failure
   (remediation R3).

---

## 14. Proposed remediations — NOT YET IMPLEMENTED, pending operator approval

**R1 — Stop making the names NXDOMAIN at all (root fix, kills the entire class).**
`hibernate.sh` currently deletes the Route53 alias records with the ALBs. Instead, during
hibernation REPLACE each directory (and relay) alias with a plain A record pointing at a
blackhole address (e.g. `198.51.100.1`, TEST-NET-2, guaranteed unroutable). The name then
resolves NOERROR throughout hibernation — connections fail fast at TCP with zero DNS caching
consequences, because only NXDOMAIN/NODATA answers are negatively cached. On wake, the alias
is restored; positive TTLs are short (60 s) and rewriting an existing record races no negative
cache anywhere. This fixes every client on every network, requires no client release, and
costs nothing (Route53 records are already paid for; the change is in hibernate/wake scripts
only).

**R2 — Make wake.sh tell the truth (detection).** Verification step 7/7 must resolve via the
OS resolver (e.g. plain `curl` by hostname, no `dig @8.8.8.8`) and treat failure as FAILURE —
poll until healthy or exit non-zero with a loud banner, never `WAKE COMPLETE` over a failing
real-path check. (§2's blind spot.)

**R3 — Client observability (diagnosis).** `fetchBootstrapMultiaddr`'s `catch { return null }`
collapses DNS failure / refused / timeout / bad JSON into one `unresolved` warning. Split the
event context by failure class (at minimum: `dns_error` vs `connect_error` vs `timeout` vs
`bad_response`), so `directory.consortium.node.unresolved reason:dns_error` on all nodes
immediately suggests local resolution, not server outage. An end user cannot run this
investigation; the log must do it for them.

**R4 — Runbook line (documentation).** Post-wake checklist: on any client that was running
during hibernation, directory DNS may stay negative-cached for the resolver chain's negative
TTL (~minutes to ~1 h on TTL-mangling networks like phone hotspots). Verify from the CLIENT
path before debugging the server. (Largely moot if R1 ships, but cheap.)

Priority: R1 is the fix; R2/R3 are the safety net that would have turned a multi-hour
investigation into a one-line log read; R4 is paper. None applied yet.

---

## 15. Remediations implemented (2026-07-24, ~17:30 UTC) — all four, operator-approved

| # | Change | Where | Commit |
|---|---|---|---|
| R1 | `hibernate.sh` UPSERTs dir/relay/portal records to blackhole A (`198.51.100.1` TEST-NET-2, TTL 60) after ALB deletion — names never go NXDOMAIN during hibernation, so nothing is ever negatively cached. Takes effect at the NEXT hibernate; no AWS change was made now. Verified by dry-run. | trustless-cello `infra/scripts/hibernate.sh` | `469c9dfb` |
| R2 | `wake.sh` step 7 verifies via the OS resolver (plain curl by hostname, `/manifest` polled up to 5 min; relay name via curl exit-code-6 semantics), prints a loud diagnostic banner naming the negative-cache failure mode on failure, marks the region failed, and the final banner becomes `WAKE FAILED VERIFICATION` + exit 1. `dig @8.8.8.8` no longer used for verification. | trustless-cello `infra/scripts/wake.sh` | `588cf8de` |
| R3 | `fetchBootstrapResult` classifies probe failures (`dns_error`/`connect_error`/`timeout`/`http_error`/`bad_response` via undici cause-chain walk; ENOTFOUND/EAI_AGAIN → `dns_error`); `directory.consortium.node.unresolved` and `directory.bootstrap.unavailable` now carry `reason`+`detail`. TDD: 10 new tests red→green; full gates (2012 tests/lint/typecheck/build). Not yet published — rides the next version cascade. | cello-client `core/daemon/src/directory-bootstrap.ts` | `01a3f13` |
| R4 | Runbook `infra/runbooks/post-wake-dns.md` (1-minute diagnosis + prefer-waiting remediation + defenses list); wake.sh post-wake checklist gained the client-path DNS line (in R2's commit). | trustless-cello | this commit |

Residual risk after R1: a client that hibernated through a **pre-R1** window can still hold
a stale negative entry once more (the caches seeded before R1 shipped); R2's hard-fail and
R3's `dns_error` reason make that case loud and diagnosable in one log line. After the next
hibernate/wake cycle runs with R1, the class is closed.

---

*This document is intentionally unfinished. Append findings as the investigation proceeds;
do not rewrite the record above — add new dated sections beneath it.*
