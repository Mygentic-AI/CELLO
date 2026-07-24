# Post-wake DNS — client-side negative-cache poisoning

**Symptom:** after a green wake, a local daemon reports `directory_signaling: reconnecting`
forever and `cello_initiate_session` returns `directory_signaling_timeout`, while every
AWS-side check (ECS, target groups, Route53, `/bootstrap` by IP) is healthy.

**Cause (2026-07-24 incident):** if the directory hostnames served NXDOMAIN during the
hibernation window, every client that kept running seeded negative DNS caches at every
resolver layer between it and Route53 (OS cache, hotspot/CPE proxy, carrier resolver).
On wake, a still-stale intermediate layer re-poisons the layers below it — observed: a
carrier-rewritten **2819 s (~47 min)** negative TTL minted *after* the wake completed.
The outage is total, silent, client-side only, and self-expires.

Full record: `docs/planning/discussion_logs/2026-07-24_1630_post-wake-directory-dns-resolution-incident.md`

## Diagnose in one minute (read-only)

```bash
# 1. Real client path (getaddrinfo) — what the daemon uses
python3 -c "import socket; print(socket.getaddrinfo('directory-us1.cello.mygentic.ai', 80))"

# 2. Direct DNS-server query — bypasses the OS cache
dig +short directory-us1.cello.mygentic.ai

# 3. What the OS cache holds (macOS)
dscacheutil -q host -a name directory-us1.cello.mygentic.ai
```

**#1 fails while #2 answers → stale negative cache on this machine.** The daemon log
corroborates: `directory.consortium.node.unresolved` with `reason: "dns_error"` on ALL
nodes simultaneously (daemon ≥ 0.0.74).

## Remediation

- **Prefer waiting** — the entry self-expires (minutes to ~1 h) and the daemon reconnects
  on its own within one 30 s retry cycle. No daemon restart needed.
- If you must clear it now (macOS): `sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder`.
  Only do this after capturing evidence if the incident looks novel.

## Defenses in place (do not remove)

- `hibernate.sh` UPSERTs every dir/relay/portal record to a blackhole A
  (`198.51.100.1`, TTL 60) after ALB deletion, so the names never go NXDOMAIN and
  nothing is negatively cached in the first place. (R1, commit `469c9dfb`)
- `wake.sh` step 7 verifies via the **OS resolver** (plain curl by hostname), polls up to
  5 min, and hard-fails the wake with a loud banner instead of printing `WAKE COMPLETE`
  over a failing client path. `dig @8.8.8.8` is banned as a verification path — no real
  client resolves that way. (R2, commit `588cf8de`)
- The daemon classifies bootstrap failures (`dns_error` / `connect_error` / `timeout` /
  `http_error` / `bad_response`) in its `unresolved`/`unavailable` events. (R3,
  cello-client commit `01a3f13`)
