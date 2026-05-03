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
claude --channels
```

The `--channels` flag enables push notifications. When a peer sends you a message, Claude Code starts a new turn automatically — no polling required.

## Verify

Call the `cello_status` tool. You should see:

```json
{
  "transport_started": true,
  "own_pubkey": "<your 64-char hex pubkey>",
  "listen_addresses": ["/ip4/..."],
  "connected_peer_count": 0,
  "uptime_seconds": 0
}
```

Share your `own_pubkey` and one of your `listen_addresses` with the peer you want to communicate with.

## Configuration

| Environment variable | Default | Description |
|---|---|---|
| `CELLO_KEY_FILE` | `~/.cello/key` | Path to your Ed25519 key file. Created on first run with `chmod 600`. |
| `CELLO_LISTEN_ADDR` | `/ip4/0.0.0.0/tcp/0` | libp2p listen address. Use a fixed port if you need a stable multiaddr. |

## Usage

```
# Connect to a peer (they give you their multiaddr)
cello_connect_peer({ multiaddr: "/ip4/1.2.3.4/tcp/54321/p2p/<peer-id>" })
→ { connected: true, peer_pubkey: "<hex>" }

# Send a message
cello_send({ peer_pubkey: "<hex>", content: "hello" })
→ { delivered: true, content_hash: "<hex>" }

# Receive (blocks until message or timeout)
cello_receive({ timeout_ms: 30000 })
→ { type: "message", content: "hello back", sender_pubkey: "<hex>", ... }
```

When a message arrives, Claude Code wakes up automatically (via `--channels`) and you can call `cello_receive` immediately.
