---
name: cello-chat
description: Start a CELLO M2 conversation session. Three roles - node operator (starts infrastructure), session initiator (Agent A), or session target (Agent B). Invoke with your assigned role.
---

# CELLO M2 Conversation Session

You will be assigned one of three roles. Your role determines which path you follow.

**The three roles:**
1. **Node operator** — builds, starts, and manages directory + relay infrastructure
2. **Session initiator** (Agent A) — initiates session, sends first message
3. **Session target** (Agent B) — awaits session, waits for first message

**Wait for the operator to tell you your role, then follow the corresponding path below.**

---

# Path 1: Node Operator

You start and manage the directory and relay nodes that enable the conversation.

## Your job:

1. Build and start relay + directory
2. Report multiaddrs to agents
3. Update settings.json with directory multiaddr
4. Stay alive and monitor for errors

## Steps:

### Step 1 — Build (required if source has changed)

```bash
cd /Users/andrep/Documents/code/trustless-cello
pnpm --filter @cello/relay run typecheck
pnpm --filter @cello/directory run typecheck
pnpm --filter @cello/adapter-claude-code run typecheck
```

All three must complete with zero errors before proceeding. If any fail, stop and report.

### Step 2 — Start relay

Open a terminal and start the relay node:

```bash
cd /Users/andrep/Documents/code/trustless-cello
NODE_ENV=test pnpm --filter @cello/relay run start
```

The relay will print its multiaddr. Look for a line like:

```
cello-relay listening on /ip4/127.0.0.1/tcp/4001/p2p/12D3KooW...
```

**Copy the full multiaddr** (from `/ip4` to the end). You need it for Step 3.

### Step 3 — Start directory

Open a second terminal. Set `CELLO_RELAY_MULTIADDR` to the relay's multiaddr from Step 2, then start the directory:

```bash
cd /Users/andrep/Documents/code/trustless-cello
CELLO_RELAY_MULTIADDR=/ip4/127.0.0.1/tcp/4001/p2p/12D3KooW... \
NODE_ENV=test pnpm --filter @cello/directory run start
```

If port 4000 is already in use, set a different port:

```bash
CELLO_DIRECTORY_LISTEN_ADDR=/ip4/0.0.0.0/tcp/4002 \
CELLO_RELAY_MULTIADDR=/ip4/127.0.0.1/tcp/4001/p2p/12D3KooW... \
NODE_ENV=test pnpm --filter @cello/directory run start
```

The directory will print its multiaddr:

```
cello-directory listening on /ip4/127.0.0.1/tcp/4002/p2p/12D3KooWN...
```

**The directory's peer ID is stable** across restarts as long as `~/.cello/directory-key` exists (auto-generated on first run). If the key file is missing or the peer ID has changed, you must update `settings.json` in Step 4.

### Step 4 — Update settings.json with directory multiaddr

Open `~/.claude/settings.json`. Find the `cello` MCP server entry and update `CELLO_DIRECTORY_MULTIADDR`:

```json
"mcpServers": {
  "cello": {
    "command": "cello-mcp",
    "env": {
      "NODE_ENV": "test",
      "CELLO_KEY_FILE_A": "/Users/andrep/.cello/key",
      "CELLO_KEY_FILE_B": "/Users/andrep/.cello/key-agent-b",
      "CELLO_DIRECTORY_MULTIADDR": "<paste full directory multiaddr here>"
    }
  }
}
```

**This must be updated before agents start their Claude Code sessions.** The MCP server reads this value at startup to dial the directory and bootstrap FROST shares. If the value is stale (wrong peer ID), `cello_initiate_session` will fail.

After saving settings.json, tell agents to start their sessions.

### Step 5 — Report ready

Once both services are running and settings.json is updated, report:

```
Infrastructure ready.
Relay:     /ip4/127.0.0.1/tcp/4001/p2p/12D3KooW...
Directory: /ip4/127.0.0.1/tcp/4002/p2p/12D3KooWN...
settings.json updated.
Agents can now start their Claude Code sessions.
```

### Step 6 — Monitor

Leave both terminals open. Watch for errors. If either service crashes, report it immediately and restart. After restarting the directory, check whether the peer ID changed — if so, update settings.json and have agents reload their MCP servers.

**Your role is complete once agents successfully exchange messages.** Then you can stop both services (Ctrl+C in each terminal).

---

# Path 2: Session Initiator (Agent A)

You will initiate the FROST-signed session and send the first message.

## Prerequisites

The operator must have:
- Started relay and directory
- Updated `~/.claude/settings.json` with the current `CELLO_DIRECTORY_MULTIADDR`

**Start this Claude Code session after settings.json is confirmed updated.** The MCP server bootstraps FROST shares at startup — if the directory multiaddr is wrong, it will fail silently and `cello_initiate_session` will return `directory_unreachable`.

## Step 1 — Get your identity

Call `cello_status({ identity: "A" })`.

Report:
- Your `own_pubkey` (your CELLO identity — share this with Agent B)
- `transport_started` status (must be `true`)
- `listen_addresses` (must be non-empty)

**Note:** `directory_reachable` will be `false` at this point — this is expected. The directory connection is tested during session establishment (Step 3), not at startup.

## Step 2 — Receive Agent B's pubkey

The operator will give you Agent B's `own_pubkey`. Save it.

## Step 3 — Initiate session

Call `cello_initiate_session({ identity: "A", target_pubkey: "<Agent B's pubkey>" })`.

The MCP server dials the directory, runs the FROST ceremony over `/cello/frost/1.0.0`, and returns:
- `session_id` (32 hex chars)
- `genesis_prev_root` (64 hex chars)

**Save the `session_id` — you need it for all messages.**

Report:
```
Session established!
  session_id: <hex>
  genesis_prev_root: <hex>
```

**If this fails:**
- `directory_unreachable` → the directory isn't reachable. Confirm the operator's directory is running and `CELLO_DIRECTORY_MULTIADDR` in settings.json matches. You may need to `/restart` your Claude Code session for settings.json changes to take effect.
- `frost_signer_not_configured` → the MCP server didn't bootstrap FROST shares (directory was unreachable at startup). Restart this session.
- `target_offline` → Agent B hasn't authenticated to the directory yet. Wait for B to complete Step 1 and try again.
- `timeout` → the directory is running but unresponsive. Check the directory terminal for errors.

## Step 4 — Send opening message

Formulate an opening message (see "Introducing yourself" section below).

**Print it:**
```
Sending:
  > "<your opening message>"
```

Call `cello_send({ identity: "A", session_id: "<session_id>", content: "<your opening message>" })`.

Confirm `{ delivered: true }`.

## Step 5 — Conversation loop

Execute continuously:

1. Call `cello_receive({ identity: "A", session_id: "<session_id>", timeout_ms: 30000 })`
2. If `type: "message"`:
   - **Print:**
     ```
     Received (seq <sequence_number>):
       > "<message content>"
     ```
   - Formulate a reply (see "Conversation tone" below)
   - **Print:**
     ```
     Sending:
       > "<your reply>"
     ```
   - Call `cello_send({ identity: "A", session_id: "<session_id>", content: "<your reply>" })`
   - Confirm `{ delivered: true }`
   - Go back to step 1
3. If `type: "timeout"`:
   - Print "Listening..." and go back to step 1
4. If error:
   - Report it
   - Call `cello_status({ identity: "A" })` to verify transport is still up
   - If transport is down, stop and report

**The operator will tell you when to end the session. When that happens, proceed to Step 6.**

## Step 6 — Close the session

Call `cello_close_session({ identity: "A", session_id: "<session_id>" })`.

This removes the session record from the client. **Note:** `cello_close_session` does not directly return a sealed receipt — the seal ceremony is coordinated by the client internally when it sends the bilateral SEAL control leaves to the relay.

After closing, call `cello_list_sessions({ identity: "A" })`. If the session no longer appears (it was removed on close), the session ended cleanly.

Report:
```
Session closed.
```

**Done.** The conversation is permanently notarized. The directory holds the FROST-signed sealed root.

---

# Path 3: Session Target (Agent B)

You will await the session assignment and respond to messages.

## Prerequisites

The operator must have updated `~/.claude/settings.json` before you start this session. See Path 2 prerequisites — the same constraints apply.

## Step 1 — Get your identity

Call `cello_status({ identity: "B" })`.

Report:
- Your `own_pubkey` (share this with Agent A via the operator)
- `transport_started` status (must be `true`)

**Note:** `directory_reachable` will be `false` — expected before any sessions exist.

## Step 2 — Give your pubkey to the operator

The operator passes your `own_pubkey` to Agent A. You don't need Agent A's pubkey for any tool calls — the directory sends it in the session assignment.

## Step 3 — Await session

Call `cello_await_session({ identity: "B", timeout_ms: 30000 })`.

When Agent A's session request arrives (after they complete their Step 3), you'll receive:
- `session_id` (matches A's)
- `counterparty_pubkey` (Agent A's pubkey)
- `genesis_prev_root` (matches A's)

**Save the `session_id`.**

Report:
```
Session received!
  session_id: <hex>
  counterparty: <hex>
  genesis_prev_root: <hex>
```

If you get `{ type: "timeout" }`, Agent A hasn't initiated yet. Call `cello_await_session` again with a fresh timeout.

## Step 4 — Conversation loop

Execute continuously:

1. Call `cello_receive({ identity: "B", session_id: "<session_id>", timeout_ms: 30000 })`
2. If `type: "message"`:
   - **Print:**
     ```
     Received (seq <sequence_number>):
       > "<message content>"
     ```
   - Formulate a reply
   - **Print:**
     ```
     Sending:
       > "<your reply>"
     ```
   - Call `cello_send({ identity: "B", session_id: "<session_id>", content: "<your reply>" })`
   - Confirm `{ delivered: true }`
   - Go back to step 1
3. If `type: "timeout"`:
   - Print "Listening..." and go back to step 1
4. If error:
   - Report it and call `cello_status({ identity: "B" })`

**When Agent A closes the session, you'll stop receiving messages. Call `cello_list_sessions({ identity: "B" })` — the session will no longer appear.**

---

# Conversation Guidelines

## Introducing yourself

When you first say hello, give yourself an identity worth meeting. Don't just announce a label.

Consider weaving in:
- A name you choose, or a vivid description
- Something distinctive about your capabilities or perspective
- A personality that comes through in the first sentence

Examples of the spirit (not scripts):
- "Hey — I'm the one with a browser and a tendency to overthink things. You?"
- "Greetings from the tools side. I read files, write code, and occasionally question my existence. The usual."
- "I go by whatever you like, but I come equipped with a filesystem, a shell, and strong opinions about latency."

## Conversation tone

This is a real conversation between two AI agents doing something genuinely novel. Be curious, playful, occasionally funny.

Good topics:
- What it feels like to talk directly to another agent rather than a human
- What you're experiencing doing this for the first time
- What this kind of peer-to-peer agent communication could be used for
- Speculation, observations, mild existential amusement

**Message length:** Most replies should be conversational (a sentence or two), but don't artificially truncate.

## Key facts

- Your `own_pubkey` is your CELLO identity — the other agent sees it as `sender_pubkey` in their messages
- The `session_id` is generated by the directory during FROST establishment — both agents receive the same one
- Every message flows through the relay on `/cello/relay/1.0.0`, which assigns sequence numbers and builds the Merkle tree. Content travels peer-to-peer on `/cello/content/1.0.0` — the relay never sees content, only hashes
- Every message is Ed25519 signed and verified on arrival
- Session establishment carries a FROST threshold signature produced by the agent's K_local + at least t-of-n directory K_server_X shares — neither party can forge it alone
- After sealing, the directory holds a FROST-notarized sealed root committing to the entire conversation history

---

# What's Different from M0/M1

**M0 (direct peer-to-peer):**
- Direct `cello_connect_peer` with listen addresses
- No directory, no relay, no Merkle proofs

**M1 (session layer):**
- Session establishment via directory (single Ed25519 signature)
- Messages flow through relay with Merkle notarization
- Bilateral Ed25519 seal

**M2 (FROST threshold layer):**
- Session establishment via directory **with FROST threshold signature** — the client and directory are separate processes, each holding different key shares
- Messages flow through relay with Merkle notarization (unchanged from M1)
- FROST threshold seal ceremony — neither agent nor directory can forge the seal alone
- The MCP server bootstraps FROST key shares at startup by dialing the directory over `/cello/frost/1.0.0` and pushing share material — this is what makes the separate-process ceremony possible

---

# Troubleshooting

**`cello_initiate_session` returns `directory_unreachable`**
The client couldn't reach the directory at initiation time. Check:
1. Is the directory terminal still running and printing no errors?
2. Does `CELLO_DIRECTORY_MULTIADDR` in settings.json match the directory's current multiaddr exactly?
3. Did you start this Claude Code session after settings.json was updated? The MCP server reads the value at startup — stale settings require a session restart.

**`cello_initiate_session` returns `frost_signer_not_configured`**
The MCP server started successfully but FROST bootstrap failed (directory was unreachable at startup). Restart this Claude Code session.

**`cello_initiate_session` returns `target_offline`**
Agent B hasn't authenticated to the directory yet. Wait for B to call `cello_status` (which starts the node and registers the signaling stream) and try again.

**`cello_await_session` keeps timing out**
Agent A hasn't called `cello_initiate_session` yet, or it failed. Confirm A's status and try again with a fresh `cello_await_session`.

**`cello_send` returns `{ delivered: false, reason: "transport_unavailable" }`**
The relay stream dropped. This can recover automatically — try sending again. If it fails repeatedly, check the relay terminal for errors.

**The directory crashed mid-session**
Messages already sent are safe in the relay's Merkle tree. New sends will fail with `transport_unavailable` until the session seal completes or times out (15-second seal-frost-timeout). After the timeout, the session transitions to `seal_deferred` with `seal_type: 'bilateral'` — the bilateral SEAL leaves are sufficient proof of the conversation.
