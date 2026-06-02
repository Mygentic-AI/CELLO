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
- **Agent ID:** `a2c55e2721f45cfa86cb3417a76e3f7b`
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

## Checking installed package versions

There are two packages that must both be current. Check both — they version independently and
`client` can be stale even when `connect` is up to date:

```bash
# On the instance:
node -e "console.log('connect:', require('/opt/cello-demo/node_modules/@cello-protocol/connect/package.json').version)"
node -e "console.log('client:', require('/opt/cello-demo/node_modules/@cello-protocol/client/package.json').version)"

# On npm:
npm view @cello-protocol/connect@beta version
npm view @cello-protocol/client@beta version
```

If the instance is behind, update with:

```bash
systemctl stop cello-demo
cd /opt/cello-demo && npm install @cello-protocol/connect@<version>
# Then fix /tmp/cello-mcp-stderr.log ownership (see Step 2 above)
systemctl start cello-demo
```

---

## Re-registration

The demo agent does **not** register through Telegram. It has no phone number. Registration uses
`register-agent-v2.mjs` directly.

**Important:** `NODE_ENV=test` is required. `bootstrapNetworkKeyShares` has a production guard
that throws unless `NODE_ENV=test`. This is intentional — the demo agent uses a 1-of-1 trusted
dealer bootstrap, not real multi-party DKG. Do not remove this flag.

**Important:** `already_registered` is a success response — it means the FROST share is in the
DB and the agent is registered. Do not re-register if you see this.

**Important:** Wait 10 seconds after `cello_register` returns before killing the process. The
DB writes (`persistFrostKeyShare`, `persistRegistrationState`) are fire-and-forget. If the
process exits before they settle, the DB will be empty on the next startup.

### Pre-auth token

You need a pre-auth token from `@CelloConnectStagingBot` on Telegram. The token format is
`CELLO-<33 base58 chars>`. Tokens are single-use — if registration fails partway through,
get a new token before retrying.

### Registration script

```bash
# On the instance, as root via SSM:
rm -f /tmp/cello-mcp-stderr.log
touch /tmp/cello-mcp-stderr.log && chown cello-demo:cello-demo /tmp/cello-mcp-stderr.log

cd /opt/cello-demo && CELLO_REGISTRATION_TOKEN=<token> node register-agent-v2.mjs 2>&1
```

`register-agent-v2.mjs` is already on the instance at `/opt/cello-demo/register-agent-v2.mjs`.
It sets `NODE_ENV=test`, waits 15s for background init, calls `cello_register`, then waits 10s
for DB writes before exiting.

### After successful registration

```bash
chown cello-demo:cello-demo /tmp/cello-mcp-stderr.log
systemctl start cello-demo
journalctl -u cello-demo -n 20 --no-pager  # should show demo.started
```

---

## After any fix

Update `infra/STATE.md` with the current service status and connect version before closing the
session. A session that changes the instance without updating STATE.md is incomplete.
