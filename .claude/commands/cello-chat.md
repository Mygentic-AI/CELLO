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

## Step 0 — Derive the directory pubkey

The relay needs the directory's Ed25519 pubkey at startup to authenticate admin frames. Derive it from the directory's key file:

```bash
node -e "
const fs = require('fs');
const raw = fs.readFileSync('/Users/andrep/.cello/directory-key');
// FileKeyProvider format: first 32 bytes = private key seed, no prefix
const seed = raw.slice(0, 32);
const { createPrivateKey, createPublicKey } = require('crypto');
const priv = createPrivateKey({ key: seed, format: 'der', type: 'pkcs8' });
// Actually just read the stored pubkey if present at offset 32
console.log('raw length:', raw.length, 'hex:', raw.toString('hex').slice(0, 32) + '...');
"
```

**Simpler — just start the directory first (Step 2), read its pubkey from stdout, then start the relay with it (Step 1 can be done after Step 2).** The directory always prints its pubkey on startup:
```
cello-directory pubkey: <64 hex chars>
```

## Step 1 — Start the directory

```bash
NODE_ENV=test pnpm --filter @cello/directory run start
```

The directory prints:
```
cello-directory pubkey: <64 hex chars>    ← copy this
cello-directory listening on /ip4/127.0.0.1/tcp/4000/p2p/12D3KooW...   ← copy full multiaddr
```

**Copy both.** If port 4000 is in use: `CELLO_DIRECTORY_LISTEN_ADDR=/ip4/0.0.0.0/tcp/4002 NODE_ENV=test pnpm ...`

The directory's peer ID is stable as long as `~/.cello/directory-key` exists.

**Important: every directory restart clears all registrations.** After restarting, all agents must re-register before initiating sessions.

## Step 2 — Start the relay

```bash
CELLO_DIRECTORY_PUBKEY=<64-hex-chars-from-step-1> \
CELLO_DIRECTORY_MULTIADDR=/ip4/127.0.0.1/tcp/4000/p2p/12D3KooW... \
NODE_ENV=test pnpm --filter @cello/relay run start
```

The relay prints:
```
cello-relay pubkey: <hex>
cello-relay listening on /ip4/127.0.0.1/tcp/4001/p2p/12D3KooW...   ← copy full multiaddr
cello-relay peer-id: 12D3KooW...
```

Both `CELLO_DIRECTORY_PUBKEY` and `CELLO_DIRECTORY_MULTIADDR` are required:
- `CELLO_DIRECTORY_PUBKEY` — relay authenticates directory admin frames against this key
- `CELLO_DIRECTORY_MULTIADDR` — relay dials directory to submit FROST seal proofs

## Step 3 — Update ~/.claude.json with directory multiaddr

**This is `~/.claude.json`, not `~/.claude/settings.json`.** The JSON file Claude Code actually reads for MCP server config is `~/.claude.json`.

Find the `cello` entry and update `CELLO_DIRECTORY_MULTIADDR`:

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

After saving, rebuild the MCP binary if source has changed:
```bash
pnpm --filter @cello/adapter-claude-code run build
```

## Step 4 — Prepare Agent B's identity

Agent B needs a separate key file. If it doesn't exist yet:
```bash
NODE_ENV=test node -e "
const { FileKeyProvider } = require('/Users/andrep/Documents/code/trustless-cello/packages/crypto/dist/index.js');
FileKeyProvider.generate('/Users/andrep/.cello/key-agent-b').then(kp => kp.getPublicKey()).then(pk => console.log('Agent B pubkey:', Buffer.from(pk).toString('hex')));
"
```

Or just let Agent B start with `CELLO_KEY_FILE` set — it will auto-generate if missing.

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

The shell export must be in place before Claude Code starts — the MCP server reads env at process startup.

## Step 6 — Report ready

```
Infrastructure ready.
Directory:  /ip4/127.0.0.1/tcp/4000/p2p/12D3KooW...  (pubkey: <64-hex>)
Relay:      /ip4/127.0.0.1/tcp/4001/p2p/12D3KooW...
~/.claude.json updated with current directory multiaddr.
Agent B: export CELLO_KEY_FILE=/Users/andrep/.cello/key-agent-b, then start claude.
```

## Step 7 — Monitor

Watch both terminals for errors. Common events to expect:
- `[AUTH]` — agent authenticated (normal)
- `[REG]` — DKG ceremony (normal, ~50ms)
- `[CONN]` — connection request/verdict (normal)
- `[SESS]` — session assignment (normal)
- `[SEAL]` — seal ceremony (normal, ~50ms)
- `[REG] Pre-check failed: target_not_found` — Agent A called connect before B registered; tell A to retry

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
