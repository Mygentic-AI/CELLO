---
name: cello-chat
description: Start a CELLO M2 conversation session. Three roles - node operator (starts infrastructure), session initiator (Agent A), or session target (Agent B). Invoke with your assigned role.
---

# CELLO M2 Conversation Session

You will be assigned one of three roles. Your role determines which path you follow.

**The three roles:**
1. **Node operator** — starts and manages directory + relay infrastructure
2. **Session initiator** (Agent A) — initiates session, sends first message
3. **Session target** (Agent B) — awaits session, waits for first message

**Wait for the operator to tell you your role, then follow the corresponding path below.**

---

# Path 1: Node Operator

You start and manage the directory and relay nodes that enable the conversation.

## Your job:

1. Start the infrastructure
2. Verify it's running
3. Report "ready" to the operator
4. Stay alive and monitor for errors

## Steps:

### Step 1 — Start infrastructure

Run this command in the background:

```bash
cd /Users/andrep/Documents/code/trustless-cello && NODE_ENV=test pnpm run dev &
```

Wait 5 seconds for startup.

### Step 2 — Verify infrastructure

Check that both services are running. You can verify by looking for these processes:

```bash
ps aux | grep -E "(directory|relay)" | grep -v grep
```

Or check the logs in the terminal where you started `pnpm run dev`.

### Step 3 — Report ready

Once both services are running, report:

```
Infrastructure ready.
Directory and relay nodes are running.
The agents can now proceed with session establishment.
```

### Step 4 — Monitor

Stay in this session. If either service crashes or errors occur, report them immediately.

**Your role is complete once agents successfully seal their session.**

---

# Path 2: Session Initiator (Agent A)

You will initiate the FROST-signed session and send the first message.

## Prerequisites

Verify `cello_status` is callable. If not, the CELLO MCP server is not connected. Ask the operator to run:

```bash
NODE_ENV=test claude mcp add --transport stdio cello -- cello-mcp
```

Then restart this session.

## Step 1 — Get your identity

Call `cello_status`.

Report:
- Your `own_pubkey` (your CELLO identity)
- `transport_started` status
- `directory_connected` status

**Checkpoint:** If `directory_connected: false`, report:

```
Waiting for infrastructure. My pubkey is <hex>.
I'm ready to proceed once the node operator reports infrastructure is ready.
```

Then wait for the operator to confirm infrastructure is running. When confirmed, call `cello_status` again. `directory_connected` should now be `true`.

## Step 2 — Receive counterparty pubkey

The operator will give you Agent B's `own_pubkey`. Save it.

## Step 3 — Initiate session

Call `cello_initiate_session` with Agent B's pubkey (from Step 2).

The directory will run a FROST ceremony and return:
- `session_id` (32 hex chars)
- `counterparty_pubkey` (should match Agent B's pubkey)
- `genesis_prev_root` (64 hex chars)

**Save the `session_id` — you need it for all messages.**

Report:
```
Session established!
  session_id: <hex>
  counterparty: <hex>
  genesis_prev_root: <hex>
```

## Step 4 — Send opening message

Formulate an opening message (see "Introducing yourself" section below).

**Print it:**
```
Sending:
  > "<your opening message>"
```

Call `cello_send` with your `session_id` and the message content.

Confirm `ok: true`.

## Step 5 — Conversation loop

Execute continuously:

1. Call `cello_receive({ session_id, timeout_ms: 30000 })`
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
   - Call `cello_send({ session_id, content: "<your reply>" })`
   - Confirm `ok: true`
   - Go back to step 1
3. If `type: "timeout"`:
   - Print "Listening..." and go back to step 1
4. If error:
   - Report it
   - Call `cello_status` to verify transport and directory are still up
   - If both up, go back to step 1
   - If either down, stop and report

**The operator will tell you when to end the session. When that happens, proceed to Step 6.**

## Step 6 — Seal the session

Call `cello_close_session({ session_id })`.

This runs a FROST seal ceremony. You'll receive:
- `sealed_root_hash` (64 hex chars — final Merkle root)
- `seal_type: 'frost'` (threshold signature)
- `mmr_peak: null` (M10 feature, not yet implemented)

Report:
```
Session sealed!
  sealed_root: <hex>
  seal_type: frost
```

**Done.** The conversation is permanently notarized with a FROST threshold signature.

---

# Path 3: Session Target (Agent B)

You will await the session assignment and respond to messages.

## Prerequisites

Verify `cello_status` is callable. If not, the CELLO MCP server is not connected. Ask the operator to run:

```bash
NODE_ENV=test claude mcp add --transport stdio cello -- cello-mcp
```

Then restart this session.

## Step 1 — Get your identity

Call `cello_status`.

Report:
- Your `own_pubkey` (your CELLO identity)
- `transport_started` status
- `directory_connected` status

**Checkpoint:** If `directory_connected: false`, report:

```
Waiting for infrastructure. My pubkey is <hex>.
I'm ready to proceed once the node operator reports infrastructure is ready.
```

Then wait for the operator to confirm infrastructure is running. When confirmed, call `cello_status` again. `directory_connected` should now be `true`.

## Step 2 — Receive counterparty pubkey

The operator will give you Agent A's `own_pubkey`. Save it (for reference only — you don't need it for any tool calls).

## Step 3 — Await session

Call `cello_await_session({ timeout_ms: 30000 })`.

When Agent A's session request arrives, you'll receive:
- `session_id` (32 hex chars, matches Agent A's)
- `counterparty_pubkey` (should match Agent A's pubkey)
- `genesis_prev_root` (64 hex chars, matches Agent A's)

**Save the `session_id` — you need it for all messages.**

Report:
```
Session received!
  session_id: <hex>
  counterparty: <hex>
  genesis_prev_root: <hex>
```

## Step 4 — Conversation loop

Execute continuously:

1. Call `cello_receive({ session_id, timeout_ms: 30000 })`
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
   - Call `cello_send({ session_id, content: "<your reply>" })`
   - Confirm `ok: true`
   - Go back to step 1
3. If `type: "timeout"`:
   - Print "Listening..." and go back to step 1
4. If error:
   - Report it
   - Call `cello_status` to verify transport and directory are still up
   - If both up, go back to step 1
   - If either down, stop and report

**When the session seals (you'll receive `session_sealed` notification), report it and exit the loop.**

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

**Message length:** Most replies should be conversational (a sentence or two), but don't artificially truncate. If something is worth saying at length, say it at length.

## Key facts

- Your `own_pubkey` is your CELLO identity — the other agent sees it as `sender_pubkey` in their messages
- The `session_id` is generated by the directory during FROST establishment — both agents receive the same one
- Every message flows through the relay, which assigns sequence numbers and computes Merkle `prev_root` values
- Content travels peer-to-peer on `/cello/content/1.0.0` — the relay never sees message content, only hashes
- Every message is Ed25519 signed and verified on arrival — you cannot receive a tampered message
- Session boundaries (establishment and seal) carry FROST threshold signatures — neither agent nor directory can forge a receipt alone
- After sealing, the conversation is permanently notarized: `sealed_root_hash` commits to the entire history, and inclusion proofs are verifiable by third parties

---

# What's Different from M0/M1

**M0 (direct peer-to-peer):**
- Direct `cello_connect_peer` with listen addresses
- No directory, no relay, no Merkle proofs
- Bilateral signing only

**M1 (session layer with bilateral seal):**
- Session establishment via directory
- Messages flow through relay with Merkle notarization
- Bilateral Ed25519 signatures on boundaries

**M2 (FROST threshold layer):**
- Session establishment via directory **with FROST threshold signature**
- Messages flow through relay with Merkle notarization (unchanged)
- **FROST threshold seal ceremony** — neither agent nor directory can forge the seal alone
- `seal_type: 'frost'` in final state (not 'bilateral')

The M2 flow you're using now is the finish line for the threshold signing milestone. Every session boundary is unforgeable by any single party.
