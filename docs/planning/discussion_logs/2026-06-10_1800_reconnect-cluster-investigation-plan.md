---
name: reconnect-cluster-investigation-plan
type: investigation
date: 2026-06-10
topics: [reconnect, update, mcp, cello-mcp, demo-agent, reliability, diagnostics]
status: ready
description: >
  Structured fault injection plan for diagnosing the update/reconnect cluster
  of issues: version bumps that break MCP, reconnect after sleep that sometimes
  fails, the difference between /mcp reconnect and remove/re-add. Each scenario
  is a controlled experiment with defined setup, trigger, capture, and
  diagnostic question. Output is a findings doc, not a fix.
---

# Reconnect Cluster — Investigation Plan

## Goal

Produce a per-scenario findings document that answers specific diagnostic
questions. Output is evidence, not a fix. M6B-018 (or its replacement) will
be written against this evidence, not against assumptions.

---

## Pre-Conditions — Run Before Every Scenario

Both sides must be in a known clean state before each experiment. Do these
steps in order. Do not skip the demo agent side.

### Local (your machine)

```bash
# 1. Kill any running cello-mcp processes
pkill -f cello-mcp || true

# 2. Wait for process to die
sleep 2

# 3. Back up and clear the stderr log
cp /tmp/cello-mcp-stderr.log /tmp/cello-mcp-stderr-backup-$(date +%Y%m%d-%H%M%S).log 2>/dev/null || true
> /tmp/cello-mcp-stderr.log

# 4. Confirm no cello-mcp process running
ps aux | grep cello-mcp | grep -v grep
# Should return nothing
```

### Demo Agent (EC2 via SSM)

```bash
# Open SSM session to the demo agent
aws ssm start-session --target i-0ad3e7c22470f266e --region us-east-1
```

Inside the SSM session:

```bash
# 1. Back up the current log
cp /opt/cello-demo/logs/cello-mcp-stderr.log \
   /opt/cello-demo/logs/cello-mcp-stderr-backup-$(date +%Y%m%d-%H%M%S).log 2>/dev/null || true

# 2. Restart the service (this wipes the live log via logrotate/service restart)
systemctl restart cello-demo.service

# 3. Wait for fresh startup confirmation
journalctl -u cello-demo.service -f --no-pager &
# Wait for: demo.started — confirms agent is registered, directory reachable, ready
# Should appear within 10-15 seconds

# 4. Note the demo agent pubkey (should be stable)
# Expected: 12ccbfd5fa4049177e4c4a81f7462641c1ab4490bfd640ea7e6407a69d06a2f8
```

### Baseline Verification

Before triggering any scenario, verify both sides are healthy:

1. In Claude Code: `/mcp` — confirm cello server is connected
2. `cello_status` — must return `{ registered: true, directory_reachable: true }`
3. `cello_request_connection` to demo agent pubkey `12ccbfd5fa4049177e4c4a81f7462641c1ab4490bfd640ea7e6407a69d06a2f8`
4. `cello_initiate_session` — confirm `ok: true`
5. `cello_send` one message, `cello_receive` response — confirm exchange works
6. `cello_close_session`

**If baseline does not pass, do not proceed with the scenario. Diagnose baseline first.**

Record the current connect version: in Claude Code, note what `cello_status` shows or run `npm ls -g @cello-protocol/connect`.

---

## Capture Instructions (Apply to Every Scenario)

At the end of each experiment, collect:

| Artifact | How |
|----------|-----|
| Local MCP stderr log | `/tmp/cello-mcp-stderr.log` — full contents |
| `cello_status` output | Call the tool, copy full JSON response |
| Directory CloudWatch | `aws logs tail /ecs/cello-directory-dev --since 10m --region us-east-1` |
| Relay CloudWatch | `aws logs tail /ecs/cello-relay-dev --since 10m --region us-east-1` |
| Demo agent journal | Via SSM: `journalctl -u cello-demo.service --since "10 minutes ago" --no-pager` |
| Connect version installed | `npm ls -g @cello-protocol/connect` |

Record all artifacts in the findings doc (see template at end).

---

## Scenario 1 — Version Bump: Reconnect Only (No Remove/Re-Add)

**Diagnostic question:** When you update the connect version and do only
`/mcp reconnect` (not remove/re-add), does the new version load correctly
and maintain working state?

**Setup:** Run pre-conditions. Verify baseline passes.

**Trigger:**

```bash
# Install the latest version globally
npm install -g @cello-protocol/connect@latest

# Confirm version changed
npm ls -g @cello-protocol/connect
```

Then in Claude Code: `/mcp reconnect`

**Observe:**
1. Does Claude Code report the server connected successfully?
2. Call `cello_status` — what does it return?
3. Does `registered: true` survive the reconnect?
4. Try `cello_initiate_session` to the demo agent — does it succeed?
5. Check stderr log — any errors during startup?

**Expected outcomes to distinguish:**
- A: Works fine — version bump + reconnect is sufficient
- B: `registered: false` — DB opened but state not loaded (persistence issue)
- C: `directory_unreachable` — process started but can't reach directory
- D: Connection timeout — process didn't start within 30s (install/compilation issue)
- E: Some other error

---

## Scenario 2 — Version Bump: Remove/Re-Add

**Diagnostic question:** Does remove/re-add succeed where reconnect alone
(Scenario 1) fails? What is different between the two paths?

**Setup:** Run pre-conditions. Verify baseline passes. Use the same version
target as Scenario 1 (or the next available version if 1 already passed).

**Trigger:**

In Claude Code terminal:
```bash
claude mcp remove cello
claude mcp add cello -- npx --yes @cello-protocol/connect@latest
```

Then in Claude Code: `/mcp`

**Observe:** Same questions as Scenario 1.

**Comparison:** If Scenario 1 fails and Scenario 2 succeeds, the issue is
in how `/mcp reconnect` restarts the process (not in the version itself).
If both fail, the issue is in the version or config. If both succeed,
update/reconnect is not actually broken.

---

## Scenario 3 — Idle Process: Sleep Simulation

**Diagnostic question:** If cello-mcp has been running for a while without
any tool calls, does it recover when you call a tool? Does `/mcp reconnect`
fix it if it doesn't?

**Setup:** Run pre-conditions. Verify baseline passes. Note the time.

**Trigger:**

Pause the cello-mcp process to simulate sleep without killing it:

```bash
# Find the PID
PID=$(pgrep -f cello-mcp)
echo "Pausing PID $PID"

# Pause for 5 minutes (simulates laptop sleep / no activity)
kill -STOP $PID
sleep 300
kill -CONT $PID
echo "Resumed"
```

Immediately after `kill -CONT`:

1. Call `cello_status` — what does it return?
2. If `directory_reachable: false`, try `/mcp reconnect` — does it recover?
3. If reconnected, try `cello_initiate_session` — does it succeed?

**Also check the demo agent side:** Via SSM after the pause window, check
`journalctl -u cello-demo.service --since "10 minutes ago"` — did the demo
agent detect any connection drop during the pause?

**What to look for in logs:**
- Any `signaling.stream.closed` or reconnect events during the STOP window
- Whether `peer_info_announce` is re-sent after CONT
- Directory logs: does it mark the client as disconnected during STOP?

---

## Scenario 4 — Directory Redeploy While Client Is Running

**Diagnostic question:** When the directory ECS task is replaced, does the
local client detect the drop and recover? Does the demo agent recover?

**Setup:** Run pre-conditions. Verify baseline passes. Note the directory
task ARN: `aws ecs list-tasks --cluster cello-dev --service-name cello-ecs-directory-dev --region us-east-1`

**Trigger:**

```bash
# Force-stop the current directory task (ECS will launch a replacement)
TASK_ARN=$(aws ecs list-tasks \
  --cluster cello-dev \
  --service-name cello-ecs-directory-dev \
  --region us-east-1 \
  --query 'taskArns[0]' \
  --output text)

echo "Stopping task: $TASK_ARN"
aws ecs stop-task --cluster cello-dev --task $TASK_ARN --region us-east-1

# Wait for replacement to become healthy (watch for runningCount: 1)
watch -n 10 "aws ecs describe-services \
  --cluster cello-dev \
  --services cello-ecs-directory-dev \
  --region us-east-1 \
  --query 'services[0].{running:runningCount,desired:desiredCount,status:status}'"
```

While waiting (approximately 60-90s for replacement):

1. Call `cello_status` every 30s — when does `directory_reachable` go false?
2. When directory is back up, call `cello_status` again — does it auto-recover?
3. If not, try `/mcp reconnect` — does that fix it?
4. Via SSM on demo agent: does `journalctl` show it detecting the drop and reconnecting?

**Key observation:** After the replacement is healthy, does the relay need to
be restarted for session initiation to work? (Test: try `cello_initiate_session`
without restarting relay. If it fails, restart relay and retry.)

---

## Scenario 5 — Reconnect After Extended Real Idle (Opportunistic)

This scenario doesn't need to be engineered — run it the next time you open
your laptop after it has been closed for several hours and Claude Code is
still open with the cello MCP configured.

**Capture immediately on wake, before doing anything else:**

```bash
# Check if cello-mcp is still running
ps aux | grep cello-mcp | grep -v grep

# Check the log for what happened during sleep
tail -50 /tmp/cello-mcp-stderr.log
```

Then call `cello_status`. Record the result. If it fails, try `/mcp reconnect`
and record whether that fixes it.

**Via SSM on demo agent:** Check journal for events during the sleep window.

---

## Findings Document Template

Create `docs/planning/discussion_logs/2026-06-10_reconnect-cluster-findings.md`
and fill in one section per scenario as you run them.

```markdown
## Scenario N — [Name]

**Date/time run:**
**Connect version before:**
**Connect version after (if applicable):**

**Baseline passed:** yes / no
**If no, what was the baseline failure:**

**Trigger applied:**

**Outcome:**
- cello_status result:
- Error seen (if any):
- Did reconnect fix it:
- Did remove/re-add fix it:

**Local MCP stderr (key lines):**
```
(paste relevant lines)
```

**Directory CloudWatch (key lines):**
```
(paste relevant lines)
```

**Demo agent journal (key lines):**
```
(paste relevant lines)
```

**Diagnostic question answer:**

**Hypotheses raised:**
```

---

## What This Investigation Does NOT Cover

- Relay-side reconnect (relay→directory) — that is the mesh reconnect gap,
  documented in the M6B COORDINATION.md and deferred to the federation milestone
- FROST ceremony timing issues — these have been solved; not the failure cluster
  under investigation
- Protocol-level breaking changes between connect versions — those would produce
  obvious errors; this investigation targets the silent/confusing failures

---

## References

- [[user-stories/m6b/COORDINATION]] — mesh reconnect gap, last entry
- [[user-stories/m6b/M6B-018-investigation-report]] — prior signaling keepalive
  analysis (may be superseded by findings here)
- [[user-stories/m7/outline]] — M7 scope; findings here inform whether M6B-018
  should precede M7 or be deferred
