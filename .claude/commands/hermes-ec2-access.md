---
name: hermes-ec2-access
description: SSH access, directory layout, systemd services, and critical rules for the Hermes agent backend EC2 instance (hosts Miss_Chelly_H and other Hermes-side CELLO agents). Use when you need to check Hermes-side CELLO daemon state directly, restart Hermes services, update Hermes or the cello client on that box, re-authenticate GitHub there (a git pull/push failing on credentials), or investigate a CELLO session/state dispute reported by a Hermes agent.
---

# Hermes EC2 Access

SSH access to the remote EC2 instance running the Hermes agent backend (this is where
`Miss_Chelly_H` and other Hermes-side CELLO agents live — use this whenever you need to check
Hermes-side daemon state directly instead of trusting a relayed summary).

## SSH

```bash
ssh -i ~/.ssh/cello-hermes-key.pem ubuntu@54.234.44.162
```

- Instance ID: `i-06db70df6b3e32207`, region `us-east-1`
- IAM profile: `cello-ec2-build-role`

If you get a connection timeout, your current IP is not allowlisted. Add it first:

```bash
MYIP=$(curl -s https://checkip.amazonaws.com) && aws ec2 authorize-security-group-ingress \
  --region us-east-1 --group-id sg-0ecea6e6030d0d4b7 --protocol tcp --port 22 --cidr "$MYIP/32"
```

Then retry the SSH connection.

## Directory layout on EC2

| Path | What it is |
|---|---|
| `~/.hermes/hermes-agent/` | Hermes source (upstream clone, never forked) |
| `~/.hermes/config.yaml` | Hermes runtime config |
| `~/.hermes/.env` | Environment variables (Telegram token, Vertex creds) |
| `~/.config/gcloud/application_default_credentials.json` | WIF credentials — do not touch |
| `~/.config/systemd/user/hermes-serve.service` | systemd unit for the dashboard backend |
| `~/.config/systemd/user/hermes-gateway.service` | systemd unit for the Telegram gateway |

## Systemd services

```bash
systemctl --user status hermes-serve
systemctl --user status hermes-gateway
systemctl --user restart hermes-serve
systemctl --user restart hermes-gateway
```

Hermes runs as the `ubuntu` user under the user systemd scope (not system scope — always use
`systemctl --user`).

## Updating Hermes

```bash
cd ~/.hermes/hermes-agent
git pull origin main
venv/bin/pip install -e .
systemctl --user restart hermes-serve hermes-gateway
```

## Critical rules — do not violate

1. **Never use the `/model` interactive command on EC2.** It overwrites `provider: vertex` with a
   broken default. Edit `~/.hermes/config.yaml` directly instead, then restart the affected
   service.
2. **Never set `GOOGLE_APPLICATION_CREDENTIALS`.** Auth uses Workload Identity Federation via
   `google.auth.default()` — setting that env var breaks it.
3. **Never copy `.env` from the local Mac** — the EC2 instance uses a different Telegram bot
   token. Overwriting it breaks Telegram.
4. **Do not edit code files via SSH** (`cat >`, `echo >`, `sed -i` on source files). Pull changes
   from git instead.
5. **Never terminate or delete AWS resources without explicit user confirmation.**

## The `cello` CLI on this host — MIND THE PATH

`cello` is installed globally under **`~/.npm-global/bin`**, which is NOT on the PATH of a
non-interactive SSH command. So this looks like cello is not installed at all:

```bash
ssh … "cello -v"        # → "command not found" — WRONG CONCLUSION
```

Export the path first. Every cello command over SSH needs this prefix:

```bash
ssh -i ~/.ssh/cello-hermes-key.pem ubuntu@54.234.44.162 \
  'export PATH=$HOME/.npm-global/bin:$PATH; cello -v'
```

Upgrading to a freshly promoted `latest` — `--prefer-online` is not optional, because `@latest`
resolves from this host's own npm cache and will otherwise install the previous version while
reporting success:

```bash
ssh … 'export PATH=$HOME/.npm-global/bin:$PATH;
       npm i -g --prefer-online @cello-protocol/cli@latest @cello-protocol/connect@latest'
```

Verify ON DISK rather than from the install output, and check the daemon too — the cli pins it at an
exact version, so the daemon is the one that actually carries protocol changes:

```bash
ssh … 'node -p "require(process.env.HOME+\"/.npm-global/lib/node_modules/@cello-protocol/cli/package.json\").version";
       node -p "require(process.env.HOME+\"/.npm-global/lib/node_modules/@cello-protocol/cli/node_modules/@cello-protocol/daemon/package.json\").version"'
```

## Smoke test

```bash
cd ~/.hermes/hermes-agent
venv/bin/python -m hermes_cli.main -z "Reply with exactly: OK"
```

## Checking a Hermes-side CELLO daemon directly

For CELLO session/state disputes reported by a Hermes agent (e.g. "session X shows sealed on our
side"), SSH in and query the daemon directly rather than trusting a relayed summary — the same
debugging discipline as any other producer/consumer trace: verify at the source, not from a
second-hand description.

```bash
ssh -i ~/.ssh/cello-hermes-key.pem ubuntu@54.234.44.162 \
  "cello sessions --all --agent <agent-name>"
```

## Re-authenticating GitHub on this host

When a `git pull` or `git push` on EC2 starts failing on credentials — after a token expires, is
revoked, or was never stored — re-authenticate `gh` on the box. Two ways, both fine.

### Option A — Personal Access Token (cleanest for a server)

No browser round-trip, and it is the one to prefer for anything unattended.

1. https://github.com/settings/tokens → **Generate new token (classic)**
2. Scopes: **`repo`** and **`read:org`**
3. Then on EC2:

```bash
ssh -i ~/.ssh/cello-hermes-key.pem ubuntu@54.234.44.162
echo "YOUR_TOKEN_HERE" | gh auth login --with-token
gh auth status   # verify
```

### Option B — Interactive web login over SSH

```bash
ssh -i ~/.ssh/cello-hermes-key.pem ubuntu@54.234.44.162
gh auth login
# Choose: GitHub.com → HTTPS → Login with a web browser
# Copy the one-time code, open the URL on your Mac, paste it in
```

This works fine over SSH even though the browser is not on EC2: the process just waits while you
complete the web flow anywhere, then picks up the result.

### Finish either one with a real push

```bash
cd ~/.hermes/hermes-agent && git push
```

**Do this once, by hand, and watch it succeed.** `gh auth status` says the CLI is authenticated; it
does not prove git itself will use those credentials — that depends on the credential helper having
stored them, which happens on first use. Every later push (from Hermes, or from an agent) then works
without a prompt. Skip this step and the first failure surfaces inside an automated run, where a
credential prompt has nobody to answer it and simply hangs.
