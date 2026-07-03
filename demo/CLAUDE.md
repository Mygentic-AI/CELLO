# Demo Agent — Operator Guide

## Purpose

When a new user installs `@cello-protocol/connect` and registers via Telegram, they have an
agent — but no one to talk to. You cannot verify your setup works unless there is another agent
on the network to exchange messages with. The demo agent solves that: it is a permanently-running,
publicly-known agent that any user can connect to immediately after registration to confirm their
entire stack is working. Send a message, get a response — your install is good.

The intended flow is: install `@cello-protocol/connect`, register via Telegram, connect to this
agent, and receive a response — all in under 10 minutes, without cloning a repo or running
infrastructure.

This agent can also serve as the gate for promoting `@cello-protocol/connect` from `beta` to
`latest` on npm — if the full stranger flow works against this agent, the protocol is shippable.

## Implementation

The demo agent is a standalone Node.js process that responds to CELLO messages with a hardcoded
4-message sequence. It has no LLM, no Telegram dependency, and no human in the loop. It spawns
`cello-mcp` as a subprocess and drives it over stdio MCP.

## Infrastructure

- **Instance:** `i-0ad3e7c22470f266e` (t3.micro, us-east-1a, EIP `32.196.100.165`)
- **Access:** SSM Session Manager only — no SSH, no key pair, no inbound SG rules
- **Service:** `cello-demo.service` (systemd, runs as `cello-demo` system user)
- **Key file:** `/opt/cello-demo/keys/agent.key`
- **DB:** `/opt/cello-demo/data/client.db` (SQLCipher, V2 schema)
- **Agent pubkey:** `7ab98987de127b81dc4013d8c0b7e70b65f95db647e0977d492f41566ec1f910`
- **Directory peer ID:** `12D3KooWS46wUj6NYvoAsocxZnxth5EgYD2ZXCm7coMkXUWgS1j3`

### SSM command template

```bash
aws ssm send-command \
  --instance-ids i-0ad3e7c22470f266e \
  --region us-east-1 \
  --document-name "AWS-RunShellScript" \
  --parameters '{"commands":["YOUR COMMAND HERE"]}' \
  --query 'Command.CommandId' --output text
# Then: aws ssm get-command-invocation --command-id <id> --instance-id i-0ad3e7c22470f266e --region us-east-1 --query '[Status,StandardOutputContent,StandardErrorContent]' --output text
```

---

## Restart ordering — daemon MUST be ready before demo starts

The demo service connects to the daemon via `$CELLO_DIR/daemon.sock`. If both services restart
simultaneously, the demo can connect to a stale socket (from the previous daemon) and silently
operate against a dead process. The standing receiver never gets created, and inbound sessions
fail with `standing_receiver_unavailable`.

**Correct restart sequence:**
```bash
systemctl stop cello-demo && systemctl stop cello-daemon && sleep 2
systemctl start cello-daemon && sleep 5
systemctl start cello-demo
```

The 5-second wait ensures the daemon has created its IPC socket and connected to the directory
before the demo service tries to use it. Verify with: `journalctl -u cello-daemon -n 5 --no-pager`
should show `directory.signaling.connected` before starting the demo.

---

## Diagnosing a startup failure — check in this order

### Step 1: Read the logs first

```bash
journalctl -u cello-demo -n 50 --no-pager
```

Do not guess. The error is always in the logs.

### Step 2: `EACCES: permission denied, open '/tmp/cello-mcp-stderr.log'`

SSM commands run as root. The service runs as `cello-demo`. If anything ran as root and created
or touched that file, the service cannot open it.

```bash
chown cello-demo:cello-demo /tmp/cello-mcp-stderr.log
systemctl start cello-demo
```

A `/etc/tmpfiles.d/cello-mcp.conf` rule recreates the file with correct ownership on boot, but
does not fix an already-wrong file mid-session.

### Step 3: `bootstrapNetworkKeyShares uses trustedDealer which is test-only`

The SQLCipher DB opened but `loadPersistedState()` found no FROST share. The agent needs
re-registration. See the **Re-registration** section below.

### Step 4: `registered=false` after `loadPersistedState`

Same root cause as Step 3 — the FROST share is missing from the DB.

### Step 5: `directory_unreachable`

Check that `env.conf` has the current directory peer ID:

```bash
cat /etc/systemd/system/cello-demo.service.d/env.conf
```

`CELLO_DIRECTORY_MULTIADDR` must end with `/p2p/12D3KooWS46wUj6NYvoAsocxZnxth5EgYD2ZXCm7coMkXUWgS1j3`.
If the directory was redeployed with a new transport key, this peer ID changes. Check `infra/STATE.md`
for the current value.

---

## Checking + updating installed package versions

The demo installs LOCALLY at `/opt/cello-demo/node_modules` (not global). The package that carries the
protocol logic post-M7 is **`@cello-protocol/daemon`** — the `cello-daemon.service` runs
`node_modules/@cello-protocol/daemon/dist/bin/cello-daemon.js` directly. So updating `connect` alone is
NOT enough; the daemon (and `cli`, which pins it) must also be current. `/opt/cello-demo/package.json`
declares `@cello-protocol/{cli,connect,daemon}` — and note the `^0.0.x` ranges are EXACT-patch pins for
0.0.z, so a bare `npm install` never upgrades them; you must install `@latest` explicitly.

```bash
# On the instance — installed vs npm latest:
cd /opt/cello-demo && npm ls @cello-protocol/daemon @cello-protocol/cli @cello-protocol/connect 2>/dev/null | grep cello-protocol
npm view @cello-protocol/daemon@latest version; npm view @cello-protocol/cli@latest version
```

Update (SSM runs as root — chown afterward or the `cello-demo` user can't read the new files):

```bash
systemctl stop cello-demo cello-daemon && sleep 2
cd /opt/cello-demo && npm install @cello-protocol/daemon@latest @cello-protocol/cli@latest @cello-protocol/connect@latest
chown -R cello-demo:cello-demo /opt/cello-demo
chown cello-demo:cello-demo /tmp/cello-mcp-stderr.log 2>/dev/null   # Step 2 EACCES fix
systemctl start cello-daemon && sleep 5 && systemctl start cello-demo
```

**Verify (do not trust this doc's pubkey — read it live):** the daemon log should show
`daemon.manifest.bundled` → `directory.auth.challenge.verified` → `directory.signaling.connected` with
`"verified":true` → `agent.online` → `session.node.created` (standing receiver), and the `agentPubkey`
in those lines is the CURRENT identity (it persists across a client update — the DB/key file is
untouched). The gold-standard check is a live session from another agent to this one (welcome message +
bilateral seal).

---

## Re-registration

The demo agent uses real T-of-N FROST DKG (not trusted dealer). Registration uses the `cello`
CLI from `@cello-protocol/cli`.

**Important:** `already_registered` is a success response — it means the FROST share is in the
DB and the agent is registered. Do not re-register if you see this.

### Pre-auth token

You need a pre-auth token from `@CelloConnectStagingBot` on Telegram. The token format is
`CELLO-<33 base58 chars>`. Tokens are single-use — if registration fails partway through,
get a new token before retrying.

### Registration procedure

```bash
# On the instance, as root via SSM:
systemctl stop cello-demo
systemctl stop cello-daemon

# Start daemon fresh, then register via CLI:
systemctl start cello-daemon && sleep 5
cd /opt/cello-demo && npx @cello-protocol/cli register default <TOKEN>

# Wait for DKG to complete (watch for register_success in daemon log):
journalctl -u cello-daemon -n 20 --no-pager | grep -E "register|dkg|frost"

# Start demo service:
systemctl start cello-demo
journalctl -u cello-demo -n 10 --no-pager  # should show demo.started
```

The CLI `register` command handles the full FROST DKG ceremony with the directory consortium.

---

## After any fix

Update `infra/STATE.md` with the current service status and connect version before closing the
session. A session that changes the instance without updating STATE.md is incomplete.
