---
name: cello-smoke
description: Live multi-agent smoke test for CONNREQ-003 and SESSION-007. Four roles — node operator, Agent A (test driver), Agent B, Agent C. Exercises concurrent connection fan-out, cello_receive (any-session), and inline session_sealed detection.
---

# CELLO Live Smoke Test — CONNREQ-003 + SESSION-007

This is a fully automated scripted run. **Once the operator gives Agent A the pubkeys for B and C, the operator does nothing more.** All three agents run their scripts to completion without any further human input.

B and C are state machines. They do not pause, they do not ask for permission, they do not wait for signals. They transition immediately at every step.

Four roles, five terminals:
1. **Node operator** — starts relay (Terminal 1) and directory (Terminal 2), does one pubkey handoff, then watches
2. **Agent A** — test driver; fans out connections, drives checkpoints, reports results (Terminal 3)
3. **Agent B** — autonomous target; sends immediately on session, loops on receive until sealed (Terminal 4)
4. **Agent C** — autonomous target; sends immediately on session, loops on receive, seals on "seal-now" (Terminal 5)

**Wait for the operator to assign your role.**

---

# Path 1: Node Operator

## Step 1 — Start relay and directory

**Relay (Terminal 1):**
```
CELLO_DIRECTORY_PUBKEY=2357394bbe85dd03adfdc8232ae5b8c8bfa8785d36914982ec26357107793ff1 CELLO_DIRECTORY_MULTIADDR=/ip4/127.0.0.1/tcp/4000/p2p/12D3KooWA4CNABsa1fjVWtS57Q5X8uSsAYXsLXPyMGYs9JEXqB9N NODE_ENV=test pnpm --filter @cello/relay run start
```

**Directory (Terminal 2):**
```
CELLO_ENV=local DATABASE_URL=postgresql://postgres:dev@localhost:5433/cello_dev DEV_ENVELOPE_KEY=86e903357804be102cf6f55e1b86ed342e01a6f50835272200ac970d0d094ac7 AUDIT_LOG_PATH=/tmp/cello-audit.jsonl CELLO_RELAY_MULTIADDR=/ip4/127.0.0.1/tcp/4001/p2p/12D3KooWCNZbpMm5cAxTn2zAsaWKde1izAPqRdnsXSXBkXFFSv3N NODE_ENV=test pnpm --filter @cello/directory run start
```

## Step 2 — Start agents

**Agent A (Terminal 3):** `claude`

**Agent B (Terminal 4):** `export CELLO_KEY_FILE=~/.cello/key-agent-b && claude`

**Agent C (Terminal 5):** `export CELLO_KEY_FILE=~/.cello/key-agent-c && claude`

## Step 3 — One-time pubkey handoff (your only intervention)

Start A, B, and C with `/cello-smoke` and their role. Wait for all three to report ready with their `own_pubkey`.

Then give Agent A exactly this, substituting the real values:
```
B_PUBKEY=<B's own_pubkey>
C_PUBKEY=<C's own_pubkey>
```

After that, **do nothing**. Watch the directory logs. Agent A will report all 5 checkpoints.

## Step 4 — Watch directory logs

```
[CONN] Connection established: A ↔ B   ← CONNREQ-003 fan-out leg 1
[CONN] Connection established: A ↔ C   ← CONNREQ-003 fan-out leg 2
[SESS] Session request: A → B
[SESS] Session request: A → C
[SEAL] Sealed — session <S_C>          ← Checkpoint 4
[SEAL] Sealed — session <S_B>          ← Checkpoint 5
```

---

# Path 2: Agent A (Test Driver)

You run this script top to bottom. No pausing, no asking for input except for the initial key handoff from the operator.

## Step 1 — Register and report keys

Call `cello_status()`. Your `own_pubkey` is in that response.

Call `cello_register()`. Your `primary_pubkey` is in that response. These are two different keys — `own_pubkey` is your Ed25519 identity, `primary_pubkey` is your FROST DKG output.

Report:
```
Agent A ready.
  own_pubkey:     <hex from cello_status>
  primary_pubkey: <hex from cello_register>
```

Wait for the operator to give you `B_PUBKEY` and `C_PUBKEY`. That is the only input you wait for in this entire test.

## Step 2 — CHECKPOINT 1: Concurrent connection fan-out (CONNREQ-003)

Issue both connection requests simultaneously — do not await the first before calling the second:

```
cello_request_connection({ target_pubkey: B_PUBKEY })
cello_request_connection({ target_pubkey: C_PUBKEY })
```

**PASS:** Both return `status: "accepted"` with two distinct `connection_id` values.

```
CHECKPOINT 1: PASS
  B connection_id: <hex>
  C connection_id: <hex>
  Both distinct: yes
```

## Step 3 — Open two sessions

```
cello_initiate_session({ target_pubkey: B_PUBKEY })  → S_B session_id
cello_initiate_session({ target_pubkey: C_PUBKEY })  → S_C session_id
```

Note both session IDs. B and C are already running their receive loops by the time you get here — you do not need to tell them anything.

## Step 4 — CHECKPOINT 2: cello_receive — any-session (SESSION-007)

B sends its message automatically as soon as it gets the session. Call receive immediately:

```
cello_receive({ timeout_ms: 15000 })
```

This will return whichever message arrived first (non-deterministic). Either B or C is valid.

**PASS:** Returns `{ type: "message", session_id: <S_B or S_C>, ... }` — not `{ type: "timeout" }`.

Call `cello_receive` a second time to get the other session's first message. After two `cello_receive` calls you will have consumed one message from each of S_B and S_C. B's second message (`smoke-test-message-from-B-2`) remains buffered in S_B — do NOT drain it here. It is needed for CHECKPOINT 3.

```
CHECKPOINT 2: PASS
  type: message
  first session received: <hex> (S_B or S_C — either is fine)
  content: <message text>
```

## Step 5 — CHECKPOINT 3: otherSessionsPending hint (SESSION-007)

B sends two messages in its State 3 (one initial + one follow-up). The `otherSessionsPending` hint fires whenever a `cello_receive` or `cello_receive_session` returns a message and there are queued messages on OTHER sessions.

**How to verify (order is non-deterministic):**

Check the CP2 `cello_receive` responses. If any response included an `other_sessions_pending` array naming the other session, CP3 is already proven.

If CP2 did NOT show the hint (e.g. messages arrived one at a time), then B's second message may still be buffered. In that case:

```
cello_receive_session({ session_id: S_C, timeout_ms: 5000 })
```

If S_C has no pending messages this times out, but `other_sessions_pending` must contain S_B. Then drain S_B:
```
cello_receive_session({ session_id: S_B, timeout_ms: 5000 })
```

**PASS:** At least one receive call (either during CP2 or here) returned `otherSessionsPending` naming another active session.

```
CHECKPOINT 3: PASS
  otherSessionsPending observed: [<session hex>]
  Observed during: CP2 any-session receive / CP3 session-locked receive
```

## Step 6 — CHECKPOINT 4: inline session_sealed detection (SESSION-007)

**These two calls must happen in the same response — do not pause between them:**

```
cello_send({ session_id: S_C, content: "seal-now" })
cello_receive_session({ session_id: S_C, timeout_ms: 30000 })
```

Send "seal-now" to C and immediately call receive on S_C in the same turn. C is in its receive loop — when it gets "seal-now" it seals immediately. You did NOT call `cello_close_session` on S_C.

**PASS:** Returns `{ type: "session_sealed", session_id: S_C, sealed_root: "<64-hex>", checkpoint_status: "pending" }`.

```
CHECKPOINT 4: PASS
  type: session_sealed
  session_id: <S_C hex>
  sealed_root: <hex>
  checkpoint_status: pending
  A called cello_close_session on S_C: no
```

## Step 7 — CHECKPOINT 5: clean close S_B

```
cello_close_session({ session_id: S_B })
```

**PASS:** Returns `{ status: "sealed", sealed_root: "<64-hex>" }`.

```
CHECKPOINT 5: PASS
  S_B sealed_root: <hex>
```

## Final report

```
Smoke test complete.
  CHECKPOINT 1 (fan-out):              PASS/FAIL
  CHECKPOINT 2 (receive_any):          PASS/FAIL
  CHECKPOINT 3 (otherSessionsPending): PASS/FAIL
  CHECKPOINT 4 (session_sealed):       PASS/FAIL
  CHECKPOINT 5 (clean close):          PASS/FAIL
```

---

# Path 3: Agent B (Autonomous Target)

You are a state machine. Execute each state immediately. Do not pause, do not ask for permission, do not wait for signals after you have your session.

## State 1 — Register

Call `cello_status()`. Your `own_pubkey` is in that response.

Call `cello_register()`.

Report:
```
Agent B ready.
  own_pubkey:     <hex from cello_status>
  primary_pubkey: <hex from cello_register>
```

Then immediately move to State 2.

## State 2 — Await session

Call `cello_await_session({ timeout_ms: 120000 })`.

If it times out, call `cello_list_sessions()`. If a session appears with `status: active`, use that `session_id`. If nothing appears after two tries, report the error and stop.

When you have a session, note the `session_id`. This is S_B. Immediately move to State 3.

## State 3 — Send two messages immediately

Do not wait for any signal. Call both immediately, one after the other:

```
cello_send({ session_id: S_B, content: "smoke-test-message-from-B" })
cello_send({ session_id: S_B, content: "smoke-test-message-from-B-2" })
```

Both must be sent before moving to State 4. Immediately move to State 4.

## State 4 — Receive loop until sealed

Call `cello_receive_session({ session_id: S_B, timeout_ms: 30000 })` in a loop.

- On `type: "timeout"`: loop again immediately
- On `type: "message"`: note the content, loop again immediately
- On `type: "session_sealed"`: report and stop

**Do not stop the loop for any reason other than `session_sealed` or an error.**

When sealed:
```
Agent B done.
  S_B sealed — sealed_root: <hex>
```

---

# Path 4: Agent C (Autonomous Target)

You are a state machine. Execute each state immediately. Do not pause, do not ask for permission, do not wait for signals after you have your session.

## State 1 — Register

Call `cello_status()`. Your `own_pubkey` is in that response.

Call `cello_register()`.

Report:
```
Agent C ready.
  own_pubkey:     <hex from cello_status>
  primary_pubkey: <hex from cello_register>
```

Then immediately move to State 2.

## State 2 — Await session

Call `cello_await_session({ timeout_ms: 120000 })`.

If it times out, call `cello_list_sessions()`. If a session appears with `status: active`, use that `session_id`. If nothing appears after two tries, report the error and stop.

When you have a session, note the `session_id`. This is S_C. Immediately move to State 3.

## State 3 — Send message immediately

Do not wait for any signal. Call immediately:

```
cello_send({ session_id: S_C, content: "smoke-test-message-from-C" })
```

Immediately move to State 4.

## State 4 — Receive loop; seal on "seal-now"

Call `cello_receive_session({ session_id: S_C, timeout_ms: 30000 })` in a loop.

- On `type: "timeout"`: loop again immediately
- On `type: "message"` with content `"seal-now"`: call `cello_close_session({ session_id: S_C })` immediately, then move to State 5
- On `type: "message"` with any other content: note it, loop again immediately
- On `type: "session_sealed"`: this should not happen before you seal — report as unexpected and stop

**Do not stop the loop for any reason other than receiving "seal-now" or an error.**

## State 5 — Confirm seal

After `cello_close_session` returns:

```
Agent C done.
  S_C sealed — sealed_root: <hex>
```

Stop.

---

# Troubleshooting

**`cello_request_connection` returns `target_not_found`**
B or C hasn't registered yet. Wait for them to report ready and retry.

**`cello_receive` (any-session) returns `{ type: "timeout" }`**
B's or C's message hasn't arrived yet. They send immediately on session — if sessions are open and this still times out, check the directory log for `[SESS]` entries confirming both sessions are active.

**CHECKPOINT 3: `otherSessionsPending` is absent or empty**
The hint is only populated when there are enqueued messages in the client buffer. Confirm B has sent and the message is queued before calling receive on S_C.

**CHECKPOINT 4: `cello_receive_session` times out instead of returning `session_sealed`**
C hasn't received "seal-now" yet, or C's `cello_close_session` hasn't completed. Check that A's `cello_send({ content: "seal-now" })` was delivered before calling receive.

**Agent C key file**
`CELLO_KEY_FILE=~/.cello/key-agent-c` must be exported before starting claude for Agent C. If C and B have the same pubkey, the export is missing.

**After directory restart**
All registrations are cleared. All agents must re-run `cello_register` before continuing.
