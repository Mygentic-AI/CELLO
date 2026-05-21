---
name: cello-smoke
description: Live multi-agent smoke test for CONNREQ-003 and SESSION-007. Four roles — node operator, Agent A (test driver), Agent B, Agent C. Exercises concurrent connection fan-out, cello_receive_any, and inline session_sealed detection.
---

# CELLO Live Smoke Test — CONNREQ-003 + SESSION-007

This is a scripted verification run, not a free conversation. Every agent follows their steps exactly and reports pass/fail at each checkpoint. Deviate from the script only to report an unexpected error.

Four roles, five terminals:
1. **Node operator** — starts relay (Terminal 1) and directory (Terminal 2), coordinates agent pubkeys
2. **Agent A** — test driver; registers, fans out connections, drives all scenarios (Terminal 3)
3. **Agent B** — passive target; registers, accepts, sends one message on cue (Terminal 4)
4. **Agent C** — passive target; registers, accepts, seals on cue (Terminal 5)

**Wait for the operator to assign your role.**

---

# Path 1: Node Operator

## Step 1 — Start relay and directory

Same startup as `/cello-chat`. Use the known stable values:

```
CELLO_DIRECTORY_PUBKEY=2357394bbe85dd03adfdc8232ae5b8c8bfa8785d36914982ec26357107793ff1
Directory peer ID: 12D3KooWA4CNABsa1fjVWtS57Q5X8uSsAYXsLXPyMGYs9JEXqB9N
Relay peer ID:     12D3KooWCNZbpMm5cAxTn2zAsaWKde1izAPqRdnsXSXBkXFFSv3N
```

**Relay (Terminal 1):**
```
CELLO_DIRECTORY_PUBKEY=2357394bbe85dd03adfdc8232ae5b8c8bfa8785d36914982ec26357107793ff1 CELLO_DIRECTORY_MULTIADDR=/ip4/127.0.0.1/tcp/4000/p2p/12D3KooWA4CNABsa1fjVWtS57Q5X8uSsAYXsLXPyMGYs9JEXqB9N NODE_ENV=test pnpm --filter @cello/relay run start
```

**Directory (Terminal 2):**
```
CELLO_ENV=local DATABASE_URL=postgresql://postgres:dev@localhost:5433/cello_dev DEV_ENVELOPE_KEY=86e903357804be102cf6f55e1b86ed342e01a6f50835272200ac970d0d094ac7 AUDIT_LOG_PATH=/tmp/cello-audit.jsonl CELLO_RELAY_MULTIADDR=/ip4/127.0.0.1/tcp/4001/p2p/12D3KooWCNZbpMm5cAxTn2zAsaWKde1izAPqRdnsXSXBkXFFSv3N NODE_ENV=test pnpm --filter @cello/directory run start
```

## Step 2 — Start agents

**Agent A (Terminal 3):**
```
claude
```

**Agent B (Terminal 4):**
```
export CELLO_KEY_FILE=~/.cello/key-agent-b && claude
```

**Agent C (Terminal 5):**
```
export CELLO_KEY_FILE=~/.cello/key-agent-c && claude
```

## Step 3 — Collect pubkeys

Each agent will report both their `own_pubkey` (from `cello_status`) and `primary_pubkey` (from `cello_register`). These are different keys.

**Connection requests use `own_pubkey` only.** Once all three have registered, give:
- Agent A: B's `own_pubkey` and C's `own_pubkey`
- Agent B: A's `own_pubkey`
- Agent C: A's `own_pubkey`

## Step 4 — Drive the script

Tell each agent "Go" in order as described in each path below. Collect pass/fail from each checkpoint. The full test has 5 checkpoints.

## Step 5 — Watch directory logs

Key events to expect during the run:
```
[CONN] Request: A → B        ← CONNREQ-003: first fan-out leg
[CONN] Request: A → C        ← CONNREQ-003: second fan-out leg (simultaneous)
[CONN] Connection established: A ↔ B
[CONN] Connection established: A ↔ C
[SESS] Session request: A → B
[SESS] Session request: A → C
[SEAL] Initiating seal — session <C's session>
[SEAL] Sealed — session <C's session>
```

---

# Path 2: Agent A (Test Driver)

You drive the entire test sequence. Follow each step precisely and report the checkpoint result before moving on.

## Step 1 — Register

Call `cello_status()`. Note the `own_pubkey` field from that response — this is your Ed25519 identity key.

Call `cello_register()`. Note the `primary_pubkey` field from that response — this is your FROST DKG key.

**These are two different keys. own_pubkey comes from cello_status. primary_pubkey comes from cello_register.**

Report to the operator using this exact format:
```
Agent A ready.
  own_pubkey (from cello_status):    <hex>
  primary_pubkey (from cello_register): <hex>
```

Wait until the operator gives you B's `own_pubkey` and C's `own_pubkey` (from their `cello_status()` output, not their register response).

## Step 2 — CHECKPOINT 1: Concurrent connection fan-out (CONNREQ-003)

**Send both connection requests as close to simultaneously as possible** — do not wait for the first to resolve before calling the second.

```
cello_request_connection({ target_pubkey: "<B's own_pubkey>" })
cello_request_connection({ target_pubkey: "<C's own_pubkey>" })
```

**PASS conditions:**
- Both calls return `{ status: "accepted" }`
- The two `connection_id` values are different hex strings
- Neither call timed out waiting for the other

Report:
```
CHECKPOINT 1: PASS
  B connection_id: <hex>
  C connection_id: <hex>
  Both distinct: yes
```
Or report FAIL with the error.

## Step 3 — Open two sessions

Call `cello_initiate_session({ target_pubkey: "<B's own_pubkey>" })`. Note `session_id` — this is **Session S_B**.

Call `cello_initiate_session({ target_pubkey: "<C's own_pubkey>" })`. Note `session_id` — this is **Session S_C**.

Report both session IDs to the operator. Tell B and C they can proceed to their respective session steps.

## Step 4 — CHECKPOINT 2: cello_receive_any (SESSION-007)

Tell B to send you a message (see B's Step 4). Wait for B to confirm they sent it.

Now call:
```
cello_receive_any({ timeout_ms: 15000 })
```

**PASS conditions:**
- Returns `{ type: "message", session_id: "<S_B hex>", content: "...", ... }`
- `session_id` matches S_B (the session with B, not C)
- `type` is `"message"`, not `"timeout"`

Report:
```
CHECKPOINT 2: PASS
  type: message
  session_id: <hex> (matches S_B: yes)
  content: <received text>
```
Or report FAIL with what was actually returned.

## Step 5 — CHECKPOINT 3: otherSessionsPending hint (SESSION-007)

Tell C to send you a message on S_C (see C's Step 4). Wait for C to confirm they sent it.

Now call `cello_receive` on S_B — the session that does NOT have the pending message:
```
cello_receive({ session_id: "<S_B hex>", timeout_ms: 5000 })
```

This call should time out (no message on S_B), but the response must include the hint.

**PASS conditions:**
- Returns `{ type: "timeout", otherSessionsPending: ["<S_C hex>"] }` — or any response with `otherSessionsPending` containing S_C
- Now call `cello_receive({ session_id: "<S_C hex>", timeout_ms: 5000 })` — must return C's message

Report:
```
CHECKPOINT 3: PASS
  otherSessionsPending on wrong-session receive: [<S_C hex>]
  S_C message received on follow-up: yes
```
Or report FAIL.

## Step 6 — CHECKPOINT 4: inline session_sealed detection (SESSION-007)

Tell C to seal their session S_C (see C's Step 5). Do NOT call `cello_close_session` yourself on S_C.

Now call:
```
cello_receive({ session_id: "<S_C hex>", timeout_ms: 30000 })
```

**PASS conditions:**
- Returns `{ type: "session_sealed", session_id: "<S_C hex>", sealed_root: "<64-hex>", close_timestamp: <unix-ms>, checkpoint_status: "pending" }`
- `type` is exactly `"session_sealed"` (not `"timeout"`, not `"message"`)
- You did NOT call `cello_close_session`

Report:
```
CHECKPOINT 4: PASS
  type: session_sealed
  session_id: <hex> (matches S_C: yes)
  sealed_root: <hex>
  checkpoint_status: pending
  A called cello_close_session: no
```
Or report FAIL.

## Step 7 — CHECKPOINT 5: clean close S_B

Call `cello_close_session({ session_id: "<S_B hex>" })`.

**PASS conditions:**
- Returns `{ status: "sealed", sealed_root: "<64-hex>", checkpoint_status: "pending" }`

Report:
```
CHECKPOINT 5: PASS
  S_B sealed_root: <hex>
```
Or report FAIL.

## Final report

Report all 5 checkpoint results to the operator. Example:
```
Smoke test complete.
  CHECKPOINT 1 (fan-out):             PASS
  CHECKPOINT 2 (receive_any):         PASS
  CHECKPOINT 3 (otherSessionsPending): PASS
  CHECKPOINT 4 (session_sealed):      PASS
  CHECKPOINT 5 (clean close):         PASS
```

---

# Path 3: Agent B

## Step 1 — Register

Call `cello_status()`. Note the `own_pubkey` field — this is your Ed25519 identity key.

Call `cello_register()`. The `primary_pubkey` in the register response is a different key — do not report it as your own_pubkey.

Report to the operator using this exact format:
```
Agent B ready.
  own_pubkey (from cello_status):    <hex>
  primary_pubkey (from cello_register): <hex>
```

## Step 2 — Wait for connection

With default open policy, the connection from A is auto-accepted — no action needed. Wait for A to initiate a session.

Call `cello_await_session({ timeout_ms: 60000 })` or `cello_list_sessions()` to get the session.

Report the `session_id` to the operator.

## Step 3 — Wait for A's signal

Wait for A (or the operator) to tell you to send a message.

## Step 4 — Send test message

When instructed, call:
```
cello_send({ session_id: "<session_id>", content: "smoke-test-message-from-B" })
```

Report to operator: "Message sent on S_B."

## Step 5 — Wait

Stay idle. A will close your session in Checkpoint 5. When A seals, call `cello_receive({ session_id: "<session_id>", timeout_ms: 30000 })` to pick up the `session_sealed` event.

---

# Path 4: Agent C

## Step 1 — Register

Call `cello_status()`. Note the `own_pubkey` field — this is your Ed25519 identity key.

Call `cello_register()`. The `primary_pubkey` in the register response is a different key — do not report it as your own_pubkey.

Report to the operator using this exact format:
```
Agent C ready.
  own_pubkey (from cello_status):    <hex>
  primary_pubkey (from cello_register): <hex>
```

## Step 2 — Wait for connection and session

With default open policy, connection from A is auto-accepted. Call `cello_await_session({ timeout_ms: 60000 })` or `cello_list_sessions()` to get the session.

Report `session_id` to the operator.

## Step 3 — Wait for signal to send

When instructed by A or the operator, call:
```
cello_send({ session_id: "<session_id>", content: "smoke-test-message-from-C" })
```

Report to operator: "Message sent on S_C."

## Step 4 — Wait for signal to seal

When instructed by A or the operator, call:
```
cello_close_session({ session_id: "<session_id>" })
```

**PASS conditions:**
- Returns `{ status: "sealed", sealed_root: "<64-hex>", checkpoint_status: "pending" }`

Report to operator:
```
C sealed S_C.
  sealed_root: <hex>
```

---

# Troubleshooting

**`cello_request_connection` returns `target_not_found`**
The target agent hasn't registered yet. Wait for them to call `cello_register` and retry.

**`cello_receive_any` returns `{ type: "timeout" }`**
B's message hasn't arrived yet or B hasn't sent it. Confirm B sent the message and retry.

**CHECKPOINT 3: `otherSessionsPending` is absent or empty**
The hint is only populated when another session has enqueued messages waiting in the client's buffer. Confirm C's message was sent and received by the relay before calling `cello_receive` on S_B.

**CHECKPOINT 4: `cello_receive` times out instead of returning `session_sealed`**
C's `cello_close_session` may not have been called yet, or the FROST seal ceremony hasn't completed. Check the directory log for `[SEAL] Sealed` and confirm C called `cello_close_session`.

**Agent C key file**
`CELLO_KEY_FILE=~/.cello/key-agent-c` must be set before starting the Claude Code session for Agent C. If C and B have the same pubkey, C is missing this export.

**After directory restart**
All registrations are cleared. All agents must re-run `cello_register` before continuing.
