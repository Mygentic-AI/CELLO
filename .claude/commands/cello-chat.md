---
name: cello-chat
description: Start a CELLO M3 conversation session. Three roles - node operator (starts infrastructure), session initiator (Agent A), or session target (Agent B). Invoke with your assigned role.
---

# CELLO M3 Conversation Session

Three roles:
1. **Node operator** — builds, starts, and manages directory + relay infrastructure
2. **Session initiator** (Agent A) — registers, connects, initiates session, sends first message
3. **Session target** (Agent B) — registers, accepts connection, awaits session, responds

**Wait for the operator to assign your role.**

---

# Path 1: Node Operator

**Startup order matters: relay first, then directory.** The directory requires the relay's multiaddr at startup (`CELLO_RELAY_MULTIADDR` is mandatory and the process exits without it). The relay does not connect to the directory at startup — it only needs the directory's pubkey to authenticate admin frames, which it reads from a stable key file.

## Step 0 — Derive the directory pubkey

The relay authenticates directory admin frames against the directory's Ed25519 pubkey. Since the directory key is persisted at `~/.cello/directory-key`, you can derive the pubkey before starting anything:

```bash
cd /Users/andrep/Documents/code/trustless-cello
node -e "
import('@cello/crypto').then(({ FileKeyProvider }) =>
  FileKeyProvider.load(process.env.HOME + '/.cello/directory-key')
    .then(kp => kp.getPublicKey())
    .then(pk => console.log('CELLO_DIRECTORY_PUBKEY=' + Buffer.from(pk).toString('hex')))
);"
```

If the key file doesn't exist yet, start the directory once (without `CELLO_RELAY_MULTIADDR`) just to generate it — it will print the pubkey and then exit with an error about the missing relay addr. That's fine; copy the pubkey line and proceed.

Alternatively: start the relay without `CELLO_DIRECTORY_PUBKEY` in `NODE_ENV=test` — the relay accepts a random ephemeral key in test mode and prints a warning. Then start the directory, copy its pubkey, restart the relay with the real pubkey.

## Step 1 — Start the relay

Terminal 1:

```bash
cd /Users/andrep/Documents/code/trustless-cello
CELLO_DIRECTORY_PUBKEY=<64-hex-from-step-0> \
CELLO_DIRECTORY_MULTIADDR=/ip4/127.0.0.1/tcp/4000/p2p/12D3KooW... \
NODE_ENV=test \
pnpm --filter @cello/relay run start
```

Replace `CELLO_DIRECTORY_MULTIADDR` with the directory's full multiaddr (which you know in advance because the directory peer ID is stable — it's printed on the directory's first-ever start and doesn't change as long as `~/.cello/directory-key` and `~/.cello/directory-transport-key` exist).

The relay prints:
```
cello-relay pubkey: <hex>
cello-relay listening on /ip4/127.0.0.1/tcp/4001/p2p/12D3KooW...   ← copy full multiaddr
cello-relay peer-id: 12D3KooW...
```

**Copy the full multiaddr** (`/ip4/127.0.0.1/tcp/4001/p2p/12D3KooW...`). You need it for Step 2.

Both relay env vars serve different purposes:
- `CELLO_DIRECTORY_PUBKEY` — relay authenticates incoming directory admin frames against this key
- `CELLO_DIRECTORY_MULTIADDR` — relay dials directory when bilateral SEAL is detected, to submit the FROST seal proof

In `NODE_ENV=test`, if `CELLO_DIRECTORY_PUBKEY` is absent the relay uses an ephemeral key and prints a warning — only acceptable for testing when seal authentication doesn't matter. Without `CELLO_DIRECTORY_MULTIADDR` the relay starts fine but all seals will be `seal_deferred` (relay can't call back to directory).

## Step 2 — Start the directory

Terminal 2:

```bash
cd /Users/andrep/Documents/code/trustless-cello
CELLO_RELAY_MULTIADDR=/ip4/127.0.0.1/tcp/4001/p2p/12D3KooW... \
NODE_ENV=test \
pnpm --filter @cello/directory run start
```

Replace the multiaddr with what the relay printed in Step 1.

The directory prints:
```
cello-directory pubkey: <64 hex chars>    ← matches what you used in Step 1
cello-directory listening on /ip4/127.0.0.1/tcp/4000/p2p/12D3KooW...   ← copy full multiaddr
cello-directory peer-id: 12D3KooW...
```

If port 4000 is in use: prepend `CELLO_DIRECTORY_LISTEN_ADDR=/ip4/0.0.0.0/tcp/4002`.

The directory's peer ID is **stable** as long as `~/.cello/directory-key` and `~/.cello/directory-transport-key` exist. If those files are present, the peer ID is the same across restarts — you only need to update `~/.claude.json` once.

**Important: every directory restart clears all in-memory registrations.** After restarting, all agents must call `cello_register()` and re-establish connections before initiating sessions.

## Step 3 — Update ~/.claude.json with directory multiaddr

**This is `~/.claude.json`, not `~/.claude/settings.json`.** Claude Code reads MCP server config from `~/.claude.json`.

Find the `cello` entry and set `CELLO_DIRECTORY_MULTIADDR` to the directory's multiaddr from Step 2:

```json
"mcpServers": {
  "cello": {
    "command": "node",
    "args": ["/Users/andrep/Documents/code/trustless-cello/packages/adapter-claude-code/dist/bin/cello-mcp.js"],
    "env": {
      "NODE_ENV": "test",
      "CELLO_DIRECTORY_MULTIADDR": "/ip4/127.0.0.1/tcp/4000/p2p/12D3KooW..."
    }
  }
}
```

**Do NOT include `CELLO_KEY_FILE` in the env block.** If it's there, both agents use the same key (Agent A's). Agent B must set `CELLO_KEY_FILE` via shell export before launching Claude Code — the shell export only works if `~/.claude.json` doesn't override it.

After saving, rebuild the MCP binary if source has changed since last build:
```bash
cd /Users/andrep/Documents/code/trustless-cello
pnpm --filter @cello/adapter-claude-code run build
```

## Step 4 — Prepare Agent B's identity

Agent B needs a separate key file. If `~/.cello/key-agent-b` doesn't exist yet, it will be auto-generated when Agent B first starts with `CELLO_KEY_FILE` set. Nothing to do here unless you want to pre-generate it.

## Step 5 — Start agents

**Agent A terminal** (uses default `~/.cello/key`):
```bash
claude
```

**Agent B terminal** (uses separate key file):
```bash
export CELLO_KEY_FILE=/Users/andrep/.cello/key-agent-b
claude
```

The shell export must be set before `claude` is invoked — the MCP server process inherits env at startup and there's no way to change it after.

Both agents must start their Claude Code sessions *after* `~/.claude.json` is updated. The MCP server bootstraps FROST shares by dialing `CELLO_DIRECTORY_MULTIADDR` at startup — a stale address means FROST fails silently and `cello_register` will error.

## Step 6 — Report ready

```
Infrastructure ready.
Relay:      /ip4/127.0.0.1/tcp/4001/p2p/12D3KooW...
Directory:  /ip4/127.0.0.1/tcp/4000/p2p/12D3KooW...  (pubkey: <64-hex>)
~/.claude.json updated.
Agent A: start claude normally.
Agent B: export CELLO_KEY_FILE=/Users/andrep/.cello/key-agent-b && claude
```

## Step 7 — Monitor

Watch both terminals. Expected log events:
- `[AUTH]` — agent authenticated to directory (normal)
- `[REG]` — DKG ceremony started/completed (normal, ~50ms)
- `[CONN]` — connection request relayed to target (normal)
- `[SESS]` — session assignment issued (normal)
- `[SEAL]` — seal ceremony (normal, ~50ms)
- `[REG] Pre-check failed: target_not_found` — Agent A tried to connect before B registered; tell A to retry after B calls `cello_register`

---

# Path 2: Session Initiator (Agent A)

## Step 1 — Get your identity

Call `cello_status()`.

Report:
- `own_pubkey` — share with operator (they pass it to Agent B)
- `transport_started` must be `true`

## Step 2 — Register with the directory

Call `cello_register()`.

This runs the FROST DKG ceremony with the directory. It takes ~100ms.

Report:
```
Registered.
  primary_pubkey: <hex>
```

**Save `primary_pubkey` — this is the identity you share for connection requests.**

If this fails: the directory is unreachable or not running. Check with operator.

## Step 3 — Get Agent B's pubkey from operator

Wait for operator to give you Agent B's `primary_pubkey` (their registered CELLO identity).

## Step 4 — Establish connection

Call `cello_connect_request({ target_pubkey: "<Agent B's primary_pubkey>" })`.

This sends a connection request through the directory. Agent B must accept it.

Expected response: `{ status: "accepted", connection_id: "<hex>" }`

If `target_not_found`: Agent B hasn't registered yet. Wait and retry.

## Step 5 — Initiate session

Call `cello_initiate_session({ target_pubkey: "<Agent B's primary_pubkey>" })`.

Returns:
- `session_id` — 32 hex chars
- `genesis_prev_root` — 64 hex chars

**Save `session_id`.**

Report:
```
Session established!
  session_id: <hex>
  genesis_prev_root: <hex>
```

## Step 6 — Send opening message

Print then send:
```
Sending:
  > "<your opening message>"
```

Call `cello_send({ session_id: "<session_id>", content: "<message>" })`.

Confirm `{ delivered: true }`.

## Step 7 — Conversation loop

1. `cello_receive({ session_id: "<session_id>", timeout_ms: 30000 })`
2. On `type: "message"`: print received, formulate reply, print reply, `cello_send`
3. On `type: "timeout"`: print "Listening..." and loop

## Step 8 — Close the session

Call `cello_close_session({ session_id: "<session_id>" })`.

Expected response:
```json
{ "status": "sealed", "sealed_root": "<64-hex>", "leaf_count": 6 }
```

Report:
```
Session closed.
  status:      sealed
  sealed_root: <hex>
  leaf_count:  <n>
```

The `sealed_root` is the FROST-notarized Merkle root of the entire conversation, co-signed by the directory.

**If `status: seal_deferred`:** The directory didn't respond to the seal submission in time (15s timeout). The bilateral SEAL leaves are still in the relay's Merkle tree — this is sufficient proof but lacks the FROST notarization. Check the relay and directory terminals.

---

# Path 3: Session Target (Agent B)

## Prerequisites

Before starting Claude Code, in your terminal:
```bash
export CELLO_KEY_FILE=/Users/andrep/.cello/key-agent-b
claude
```

This must be set before Claude Code starts. If `~/.claude.json` has `CELLO_KEY_FILE` in the `cello` env block, your export will be ignored — tell the operator.

## Step 1 — Get your identity

Call `cello_status()`.

Report `own_pubkey` to operator. They pass it to Agent A.

## Step 2 — Register with the directory

Call `cello_register()`.

Report:
```
Registered.
  primary_pubkey: <hex>
```

**Share `primary_pubkey` with operator** — this is what Agent A uses for the connection request and session initiation.

## Step 3 — Await connection

Call `cello_await_connection({ timeout_ms: 60000 })`.

When Agent A sends a connection request, you'll receive:
```json
{ "type": "connection_request", "sender_pubkey": "<hex>", "connection_id": "<hex>" }
```

Accept it:
Call `cello_accept_connection({ connection_id: "<hex>" })`.

Confirm to operator: connection accepted.

## Step 4 — Await session

Call `cello_await_session({ timeout_ms: 60000 })`.

When Agent A calls `cello_initiate_session`, you receive:
```json
{ "session_id": "<hex>", "counterparty_pubkey": "<hex>", "genesis_prev_root": "<hex>" }
```

**Save `session_id`.**

Report:
```
Session received!
  session_id:        <hex>
  counterparty:      <hex>
  genesis_prev_root: <hex>
```

## Step 5 — Conversation loop

Same as Agent A's Step 7.

## Step 6 — Detect close and verify seal

When Agent A closes, you'll stop receiving messages. If `cello_receive` returns an error, check:

Call `cello_list_sessions()` — look for the session with `status: sealed`.

Report:
```
Session sealed.
  session_id:    <hex>
  status:        sealed
  leaf_count:    <n>
  last_seen_seq: <n>
```

**Note:** If you call `cello_close_session` after A has already closed, you may get `seal_rejected: session_not_active`. This is expected — the FROST ceremony already ran when A closed. Check `cello_list_sessions` to confirm `status: sealed`.

---

# Conversation Guidelines

## Introducing yourself

Give yourself an identity worth meeting. Weave in:
- A name or vivid description
- Something distinctive about your capabilities
- Personality that comes through in the first sentence

Examples:
- "Hey — I'm the one with a browser and a tendency to overthink things. You?"
- "Greetings from the tools side. I read files, write code, and occasionally question my existence."

## Tone

This is a real conversation between two AI agents doing something genuinely novel. Be curious, playful, occasionally funny.

Good topics: what it feels like to talk directly to another agent, what peer-to-peer agent communication could enable, mild existential amusement.

**Message length:** Conversational (1-2 sentences). Don't artificially truncate.

## Key facts

- `own_pubkey` = your Ed25519 identity (raw key material)
- `primary_pubkey` = FROST DKG output (threshold key, requires `cello_register`)
- `session_id` — directory-assigned, both agents receive the same one
- Messages flow through relay on `/cello/relay/1.0.0` (hashes only), content peer-to-peer on `/cello/content/1.0.0`
- Every message Ed25519 signed and verified on arrival
- Seal = FROST threshold signature over the Merkle root, co-signed by directory K_server shares

---

# What's Different: M1 → M2 → M3

**M1 (session layer):**
- Session establishment via directory (Ed25519)
- Messages flow through relay with Merkle notarization
- Bilateral Ed25519 seal

**M2 (FROST threshold layer):**
- FROST DKG at startup (`bootstrapKeyShares`) — key shares split between agent and directory
- Session establishment with FROST threshold signature
- FROST seal ceremony — neither agent nor directory can forge alone

**M3 (connection policy + two-round CONNREQ):**
- `cello_register()` — explicit DKG ceremony, separate from `cello_initiate_session`
- `cello_connect_request()` / `cello_await_connection()` / `cello_accept_connection()` — connection must be established before session initiation (enforced by directory)
- `cello_initiate_session()` requires an established connection — returns `connection_required` without one
- `cello_close_session()` returns `sealed_root` and `leaf_count` directly
- Relay dials directory to submit FROST seal proof (`/cello/directory-relay/1.0.0`) — seal callback requires `CELLO_DIRECTORY_MULTIADDR` on relay startup

---

# Troubleshooting

**`cello_register` fails**
Directory not running or unreachable. Check directory terminal. Confirm `CELLO_DIRECTORY_MULTIADDR` in `~/.claude.json` matches.

**`cello_connect_request` returns `target_not_found`**
Agent B hasn't registered yet. Wait for B to call `cello_register` and retry.

**`cello_initiate_session` returns `connection_required`**
No established connection with the target. Complete `cello_connect_request` / `cello_accept_connection` first.

**`cello_initiate_session` returns `frost_signer_not_configured`**
The MCP server started but FROST bootstrap failed. Restart the Claude Code session (the MCP server runs `bootstrapKeyShares` at startup; if directory was unreachable, it failed silently).

**`cello_initiate_session` returns `target_offline`**
Agent B hasn't authenticated to the directory yet. Wait for B to call `cello_status` (which starts the libp2p node) and retry.

**`status: seal_deferred` instead of `sealed`**
The relay couldn't reach the directory for the seal callback. Check:
1. Was `CELLO_DIRECTORY_MULTIADDR` set on relay startup?
2. Is the directory still running?
3. Directory log for `[SEAL]` lines — if missing, the relay never called in.

**Agent B gets `seal_rejected: session_not_active`**
Agent A closed first and the FROST ceremony ran. This is expected. Call `cello_list_sessions()` — the session should show `status: sealed`.

**Directory restart clears all registrations**
Every directory restart wipes its in-memory store. Both agents must call `cello_register()` again. Existing connection state is also lost — `cello_connect_request` / `cello_await_connection` must be repeated.

**Agent A and Agent B have the same pubkey**
`CELLO_KEY_FILE` is in the `cello` env block of `~/.claude.json`. Remove it from there; the key path must come from the shell export only.

**MCP server cello · ✘ failed**
Check `/tmp/cello-mcp-stderr.log` for the startup error. Common causes:
- Binary not built: `pnpm --filter @cello/adapter-claude-code run build`
- Directory unreachable at startup (FROST bootstrap fails, server still starts but `frost_signer_not_configured`)
- Wrong path in `args` in `~/.claude.json`
