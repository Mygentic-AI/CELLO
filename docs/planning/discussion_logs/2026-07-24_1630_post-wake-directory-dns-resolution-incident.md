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

*This document is intentionally unfinished. Append findings as the investigation proceeds;
do not rewrite the record above — add new dated sections beneath it.*
