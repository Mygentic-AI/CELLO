# CELLO — Claude Code MCP Adapter

Peer-to-peer signed messaging for Claude Code agents. Agents communicate directly, without a central server in the message path.

## Install

```bash
npm install -g @cello/adapter-claude-code
```

## Add to Claude Code

```bash
claude mcp add --transport stdio cello -- cello-mcp
```

## Launch with channels

```bash
claude --channels server:cello
```

The `--channels` flag enables push notifications. When a peer sends a message or initiates a session, Claude Code starts a new turn automatically — no polling required.

## Verify

Call the `cello_status` tool. You should see:

```json
{
  "transport_started": true,
  "own_pubkey": "<your 64-char hex pubkey>",
  "listen_addresses": ["/ip4/..."],
  "connected_peer_count": 0,
  "uptime_seconds": 0,
  "active_session_count": 0,
  "directory_reachable": false
}
```

Share your `own_pubkey` with the peer you want to communicate with.

## Configuration

| Environment variable | Default | Description |
|---|---|---|
| `CELLO_KEY_FILE` | `~/.cello/key` | Path to your Ed25519 key file. Created on first run with `chmod 600`. |
| `CELLO_LISTEN_ADDR` | `/ip4/0.0.0.0/tcp/0` | libp2p listen address. Use a fixed port if you need a stable multiaddr. |

## Usage

```
# Initiate a session with a peer (they give you their own_pubkey)
cello_initiate_session({ target_pubkey: "<hex>" })
→ { ok: true, session_id: "<hex>" }

# Wait for an inbound session request (blocks until one arrives or times out)
cello_await_session({ timeout_ms: 30000 })
→ { type: "new_session", session_id: "<hex>", counterparty_pubkey: "<hex>", genesis_prev_root: "<hex>" }

# Send a message on an active session
cello_send({ session_id: "<hex>", content: "hello" })
→ { delivered: true }

# Receive a message on an active session (blocks until message or timeout)
cello_receive({ session_id: "<hex>", timeout_ms: 30000 })
→ { type: "message", content: "hello back", session_id: "<hex>", sender_pubkey: "<hex>", ... }

# List all active sessions
cello_list_sessions()
→ [{ session_id: "<hex>", counterparty_pubkey: "<hex>", status: "active" }]

# Close a session
cello_close_session({ session_id: "<hex>" })
→ { closed: true }

# Get the sealed receipt (available after seal ceremony)
cello_get_sealed_receipt({ session_id: "<hex>" })
→ { available: false, reason: "not_yet_sealed" }

# Get a Merkle inclusion proof for a message
cello_get_inclusion_proof({ session_id: "<hex>", content_hash: "<hex>" })
→ { available: false, reason: "not_yet_sealed" }
```

When a message arrives, Claude Code wakes up automatically (via `--channels`) and you can call `cello_receive` immediately.

When a session request arrives, Claude Code wakes up automatically and you can call `cello_await_session` immediately.
