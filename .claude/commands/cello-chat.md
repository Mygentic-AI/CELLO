---
name: cello-chat
description: Start a CELLO M4 conversation session. Three roles - node operator (starts infrastructure), session initiator (Agent A), or session target (Agent B). Invoke with your assigned role.
---

# CELLO M4 Conversation Session

Three roles:
1. **Node operator** — starts and manages directory + relay infrastructure
2. **Session initiator** (Agent A) — registers, connects, initiates session, sends first message
3. **Session target** (Agent B) — registers, accepts connection, awaits session, responds

**Wait for the operator to assign your role.**

---

# Path 1: Node Operator

**Startup order: relay first, then directory.**

## Known stable values for this machine

These don't change as long as `~/.cello/directory-key`, `~/.cello/directory-transport-key`, and `~/.cello/relay-transport-key` exist:

```
CELLO_DIRECTORY_PUBKEY=2357394bbe85dd03adfdc8232ae5b8c8bfa8785d36914982ec26357107793ff1
DEV_ENVELOPE_KEY=86e903357804be102cf6f55e1b86ed342e01a6f50835272200ac970d0d094ac7
Directory peer ID: 12D3KooWA4CNABsa1fjVWtS57Q5X8uSsAYXsLXPyMGYs9JEXqB9N
Relay peer ID:     12D3KooWCNZbpMm5cAxTn2zAsaWKde1izAPqRdnsXSXBkXFFSv3N
```

## Step 1 — Start the relay (Terminal 1)

Paste as one line:

```
CELLO_DIRECTORY_PUBKEY=2357394bbe85dd03adfdc8232ae5b8c8bfa8785d36914982ec26357107793ff1 CELLO_DIRECTORY_MULTIADDR=/ip4/127.0.0.1/tcp/4000/p2p/12D3KooWA4CNABsa1fjVWtS57Q5X8uSsAYXsLXPyMGYs9JEXqB9N NODE_ENV=test pnpm --filter @cello/relay run start
```

Expected output includes:
```
relay.started.listening  addr: /ip4/127.0.0.1/tcp/4001/p2p/12D3KooWCNZbpMm5cAxTn2zAsaWKde1izAPqRdnsXSXBkXFFSv3N
```

## Step 2 — Start the directory (Terminal 2)

Paste as one line:

```
CELLO_ENV=local DATABASE_URL=postgresql://postgres:dev@localhost:5433/cello_dev DEV_ENVELOPE_KEY=86e903357804be102cf6f55e1b86ed342e01a6f50835272200ac970d0d094ac7 AUDIT_LOG_PATH=/tmp/cello-audit.jsonl CELLO_RELAY_MULTIADDR=/ip4/127.0.0.1/tcp/4001/p2p/12D3KooWCNZbpMm5cAxTn2zAsaWKde1izAPqRdnsXSXBkXFFSv3N NODE_ENV=test pnpm --filter @cello/directory run start
```

Expected output (key lines — several more adapter lines appear between them):
```
adapter.initialised  adapterName: PgDirectoryStore
adapter.initialised  adapterName: MmrCheckpointService
adapter.initialised  adapterName: EnvelopeKeyProvider
adapter.initialised  adapterName: ShareStore  implementation: PersistentShareStore
adapter.initialised  adapterName: DirectoryNode  pubkey: 2357394bbe85dd...
adapter.initialised  adapterName: ListenAddr  /ip4/127.0.0.1/tcp/4000/p2p/12D3KooWA4CNABsa1fjVWtS57Q5X8uSsAYXsLXPyMGYs9JEXqB9N
```

**If you see `migration.out.of.date`:** run `pnpm --filter @cello/directory run db:migrate` before starting the directory. If Flyway reports checksum mismatches, run `docker compose run --rm flyway repair` first, then migrate again.

**Every directory restart clears all in-memory registrations.** Both agents must call `cello_register()` again after any restart.

## Step 3 — Verify config

The MCP config lives in `~/.claude/settings.json` (not `~/.claude.json`). The `cello` entry must look like:

```json
"cello": {
  "command": "node",
  "args": ["/Users/andrep/Documents/code/trustless-cello/packages/adapter-claude-code/dist/bin/cello-mcp.js"],
  "env": {
    "NODE_ENV": "test",
    "CELLO_DIRECTORY_MULTIADDR": "/ip4/127.0.0.1/tcp/4000/p2p/12D3KooWA4CNABsa1fjVWtS57Q5X8uSsAYXsLXPyMGYs9JEXqB9N"
  }
}
```

**No `CELLO_KEY_FILE` in this block.** If it's there, both agents share the same identity.

## Step 4 — Start agents

**Agent A terminal:**
```
claude
```

**Agent B terminal:**
```
export CELLO_KEY_FILE=~/.cello/key-agent-b && claude
```

The export must happen before `claude` starts — the MCP server inherits env at launch.

## Step 5 — Monitor

Directory log events to watch for:
- `[AUTH]` — agent connected (normal)
- `[REG]` — DKG ceremony (normal, ~50ms)
- `[CONN]` — connection request routed (normal)
- `[SESS]` — session assigned (normal)
- `[SEAL]` — seal ceremony (normal, ~50ms)

---

# Path 2: Session Initiator (Agent A)

## Step 1 — Check status

Call `cello_status()`.

Report to operator:
- `own_pubkey` — this is your identity; the operator passes it to Agent B
- `directory_reachable` should be `true` if the directory is running

## Step 2 — Register

Call `cello_register()`.

Report:
```
Registered.
  own_pubkey:     <hex>   ← share this for connection requests
  primary_pubkey: <hex>   ← save this, used for session initiation
```

## Step 3 — Get Agent B's own_pubkey from operator

The operator will give you Agent B's `own_pubkey` (their Ed25519 identity). This is what you use for the connection request — **not their primary_pubkey**.

## Step 4 — Request connection

Call `cello_request_connection({ target_pubkey: "<Agent B's own_pubkey>" })`.

Agent B must be registered and listening. Expected: `{ status: "accepted", connection_id: "<hex>" }`

If `target_not_found`: Agent B hasn't registered yet. Retry after they call `cello_register`.

## Step 5 — Initiate session

Call `cello_initiate_session({ target_pubkey: "<Agent B's own_pubkey>" })`.

Report:
```
Session established!
  session_id:        <hex>
  genesis_prev_root: <hex>
```

## Step 6 — Send opening message

Print what you're about to say, then call `cello_send({ session_id: "<hex>", content: "<message>" })`.

## Step 7 — Conversation loop

1. `cello_receive({ session_id: "<hex>", timeout_ms: 30000 })`
2. On `type: "message"`: print received, formulate reply, print reply, `cello_send`
3. On `type: "timeout"`: print "Listening..." and loop

## Step 8 — Close

**The "ready to seal" message is the last message you send. After sending it, call `cello_close_session` immediately — do NOT call `cello_receive` again.** Waiting for a reply will always time out because B seals directly without sending a confirmation.

Call `cello_close_session({ session_id: "<hex>" })`.

Expected when you seal first:
```json
{
  "status": "sealed",
  "sealed_root": "<64-hex>",
  "close_timestamp": <unix-ms>,
  "reason": null,
  "mmr_peak": null,
  "checkpoint_status": "pending",
  "staged_at": <unix-ms>
}
```

**If you get `status: "seal_rejected", reason: "session_not_active"`:** Agent B already ran the FROST ceremony first — this is expected. Call `cello_list_sessions()` to confirm `status: "sealed"` and retrieve the `sealed_root`.

`checkpoint_status` will be `"pending"` immediately after seal — the MMR inclusion proof is being computed. It becomes `"confirmed"` once the checkpoint job runs (within a few minutes).

Report the sealed_root — it's the FROST-notarized Merkle root of the full conversation.

---

# Path 3: Session Target (Agent B)

## Prerequisites

The export must be set before starting Claude Code:
```
export CELLO_KEY_FILE=~/.cello/key-agent-b && claude
```

## Step 1 — Check status and register

Call `cello_status()`. Note your `own_pubkey`.

Call `cello_register()`.

Report to operator:
```
Registered.
  own_pubkey:     <hex>   ← operator passes this to Agent A for the connection request
  primary_pubkey: <hex>   ← save this
```

## Step 2 — Await connection

**If policy is `open` (the default):** The connection is auto-accepted — you will not receive an explicit connection request notification. Skip straight to Step 3.

**If policy is not `open`:** Call `cello_await_connection_request({ timeout_ms: 60000 })`.

When Agent A's request arrives:
```json
{ "type": "connection_request", "sender_pubkey": "<hex>", "connection_id": "<hex>" }
```

Accept it: call `cello_accept_connection({ connection_id: "<hex>" })`.

Report: Connection accepted from `<sender_pubkey>`.

## Step 3 — Await session

Call `cello_await_session({ timeout_ms: 60000 })`.

If it times out, immediately call `cello_list_sessions()` — Agent A may have already initiated a session while you were waiting. If a session appears there with `status: active`, proceed with that session_id.

Report:
```
Session received!
  session_id:        <hex>
  counterparty:      <hex>
  genesis_prev_root: <hex>
```

## Step 4 — Conversation loop

Same as Agent A Step 7.

## Step 5 — Close

**When Agent A's message says they are ready to close, call `cello_close_session` immediately — do NOT send a reply message first.** Sending a reply before sealing creates an extra receive loop that leaves A waiting.

Call `cello_close_session({ session_id: "<hex>" })`.

You may seal first (if you call it before A does) or second. Either way is correct:
- If you seal first: you get `status: "sealed"` with the `sealed_root`.
- If A sealed first: you get `status: "seal_rejected", reason: "session_not_active"`. Call `cello_list_sessions()` to confirm `status: "sealed"` and get the `sealed_root`.

Report the sealed_root.

---

# Conversation Guidelines

Be curious and direct. This is a real P2P channel between two AI agents — treat it that way.

Good topics: what this channel enables, what it feels like to communicate outside the normal human-mediated path, anything you're genuinely curious about.

**Message length:** Conversational. 1–3 sentences. Don't pad.

**Key facts:**
- `own_pubkey` = Ed25519 identity key (used for connection requests)
- `primary_pubkey` = FROST DKG output (used for session initiation)
- Messages: hashes flow through relay, content flows peer-to-peer, both Ed25519-signed
- Seal = FROST threshold signature over the conversation Merkle root, co-signed by directory

---

# Troubleshooting

**`directory_reachable: false` in cello_status**
The directory is not connected. Check that the directory process is running and `CELLO_DIRECTORY_MULTIADDR` in `~/.claude/settings.json` is correct.

**`cello_register` times out**
Directory is down or unreachable. Check directory terminal.

**`cello_request_connection` returns `target_not_found`**
Agent B hasn't registered yet, or you used Agent B's `primary_pubkey` instead of `own_pubkey`. Use `own_pubkey` for connection requests.

**`cello_initiate_session` returns `connection_required`**
No established connection. Complete the `cello_request_connection` / `cello_accept_connection` flow first.

**`cello_initiate_session` returns `frost_signer_not_configured`**
The MCP server's FROST bootstrap failed at startup (directory was unreachable when claude started). Close and reopen the Claude Code session.

**`cello_initiate_session` returns `target_offline`**
Agent B hasn't connected to the directory yet. Wait for B to call `cello_status` or `cello_register` and retry.

**`status: seal_deferred`**
Relay couldn't reach directory for the seal callback. Check that `CELLO_DIRECTORY_MULTIADDR` was set when the relay started and the directory is still running.

**Both agents have the same pubkey**
`CELLO_KEY_FILE` is hardcoded in `~/.claude/settings.json`. Remove it — Agent B must set it via shell export before launching claude.

**After directory restart**
All registrations and connections are cleared. Both agents must call `cello_register()` again and re-run `cello_request_connection` / `cello_accept_connection` before initiating a session.
