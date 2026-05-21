---
name: Three-Agent Smoke Test — CONNREQ-003 + SESSION-007
type: discussion
date: 2026-05-21
topics: [M4, FROST, session-layer, connection-fanout, any-session-receive, session-sealed-inline, smoke-test, protocol-proof, CONNREQ-003, SESSION-007]
status: reference
description: Live 3-agent smoke test proving concurrent connection fan-out (CONNREQ-003) and any-session receive with otherSessionsPending hints and inline session_sealed detection (SESSION-007). Two simultaneous sessions sealed independently — C sealed on command, B sealed by A's explicit close. 5/5 checkpoints passed.
---

# Three-Agent Smoke Test — CONNREQ-003 + SESSION-007

Live 3-agent smoke test over the CELLO M4 session layer. Agent A opened concurrent connections to Agents B and C, drove two simultaneous sessions, and verified five protocol checkpoints covering connection fan-out, any-session multiplexed receive, cross-session pending hints, inline seal detection, and clean bilateral close. All infrastructure live: FROST DKG against PostgreSQL directory, relay-notarized Merkle trees, peer-to-peer content delivery.

- **Agent A pubkey**: `170138f005bfc26797d0a665490adf0fe5976b70c6a6db159d69cff841afb556`
- **Agent A primary pubkey**: `b0ae8adeee0a429038035b8ad317044375ca7d31dcb85783d843c9415531df18`
- **Agent A peer ID**: `12D3KooWPGBnim1XDAvevBCkTN8emtXvUdtx9xv6YADU4Qd3xHpg`
- **Agent B pubkey**: `8b6dde20858422fd545dc3d4cb029c3256a97460601dd0deeaa635b7c14014a6`
- **Agent B peer ID**: `12D3KooWBsehBcEkJiTQZNeDMcxhDSCaTa55t7b7mHvntNeTMFBY`
- **Agent C pubkey**: `861eed6b481b7ef1ba89d7578d7489ca7c4e36e89dd1095c1613e9d6f90d321a`
- **Agent C peer ID**: `12D3KooWFYYG1VgRn3MQTNtM53gGDYB5At85siyYfib64ymnyMqX`
- **Connection A↔B**: `f4bc25578fb1c16420de7b1a7f4443cd`
- **Connection A↔C**: `0675e811741f08182d482c5b2d022871`
- **Session S_B (A↔B)**: `37c10ab9d416f7f3e236ec0e466e3864`
- **Session S_C (A↔C)**: `eeaba9b9c0da3808b06a2342109896a8`
- **Date**: 2026-05-21
- **Channel**: FROST-signed CELLO sessions (M4), live PostgreSQL directory, relay-notarized Merkle trees
- **S_B sealed root**: `e824c710c80027ecc213a3175bf7d3fd2dd4b7a5f0896e13b30f0786800ec332` (4 leaves, A sealed via `cello_close_session`)
- **S_C sealed root**: `a6cf7e4ae4ca9dfb5e39785f6754ed442c2a667e21ded9f58810508a1b92034b` (4 leaves, C sealed on "seal-now" command)

---

## Test Design

The smoke test exercises two user stories simultaneously:

**CONNREQ-003 (Connection Fan-Out):** Agent A issues two `cello_request_connection` calls concurrently to B and C. Both must succeed with distinct `connection_id` values, proving the directory handles parallel DKG ceremonies without collision.

**SESSION-007 (Session Layer Features):** Any-session receive (`cello_receive`) multiplexes across both sessions, returning messages with `session_id` identification and `other_sessions_pending` hints. Inline `session_sealed` detection fires when a counterparty seals without the receiving agent initiating the close.

---

## Operational Narrative

### Infrastructure (operator)

Relay (Terminal 1):

```
CELLO_DIRECTORY_PUBKEY=2357394bbe85dd03adfdc8232ae5b8c8bfa8785d36914982ec26357107793ff1 CELLO_DIRECTORY_MULTIADDR=/ip4/127.0.0.1/tcp/4000/p2p/12D3KooWA4CNABsa1fjVWtS57Q5X8uSsAYXsLXPyMGYs9JEXqB9N NODE_ENV=test pnpm --filter @cello/relay run start
```

Directory (Terminal 2):

```
CELLO_ENV=local DATABASE_URL=postgresql://postgres:dev@localhost:5433/cello_dev DEV_ENVELOPE_KEY=86e903357804be102cf6f55e1b86ed342e01a6f50835272200ac970d0d094ac7 AUDIT_LOG_PATH=/tmp/cello-audit.jsonl CELLO_RELAY_MULTIADDR=/ip4/127.0.0.1/tcp/4001/p2p/12D3KooWCNZbpMm5cAxTn2zAsaWKde1izAPqRdnsXSXBkXFFSv3N NODE_ENV=test pnpm --filter @cello/directory run start
```

Agent B (Terminal 4): `export CELLO_KEY_FILE=~/.cello/key-agent-b && claude`

Agent C (Terminal 5): `export CELLO_KEY_FILE=~/.cello/key-agent-c && claude`

### Agent roles

- **Agent A** — test driver (Claude, default key file). Fans out connections, opens sessions, drives checkpoints, reports results.
- **Agent B** — autonomous state machine. Registers, awaits session, sends two messages immediately, loops on receive until sealed.
- **Agent C** — autonomous state machine. Registers, awaits session, sends one message immediately, loops on receive, seals on "seal-now".

Operator's only intervention: passing B and C pubkeys to A after all three reported ready.

---

## Checkpoint Results

### CHECKPOINT 1: Concurrent connection fan-out (CONNREQ-003)

Both `cello_request_connection` calls issued simultaneously:

```json
{ "result": "accepted", "connection_id": "f4bc25578fb1c16420de7b1a7f4443cd" }
{ "result": "accepted", "connection_id": "0675e811741f08182d482c5b2d022871" }
```

**PASS.** Both accepted, distinct IDs. Directory handled parallel connection ceremonies without collision.

---

### CHECKPOINT 2: cello_receive — any-session multiplexing (SESSION-007)

B and C both sent messages immediately upon receiving their sessions. Agent A called `cello_receive({ timeout_ms: 15000 })`:

```json
{
  "type": "message",
  "session_id": "37c10ab9d416f7f3e236ec0e466e3864",
  "content": "smoke-test-message-from-B",
  "sender_pubkey": "8b6dde20...",
  "sequence_number": 1,
  "leaf_hash": "a2c2c439342469aedb4ab702684d67518427a8eda548b7ceadf14eeeab55dadf",
  "other_sessions_pending": ["eeaba9b9c0da3808b06a2342109896a8"]
}
```

**PASS.** Any-session receive returned a message with correct `session_id` identification and `other_sessions_pending` flagging S_C.

---

### CHECKPOINT 3: otherSessionsPending hint (SESSION-007)

During the any-session drain, both receives from S_B included:

```json
"other_sessions_pending": ["eeaba9b9c0da3808b06a2342109896a8"]
```

This correctly indicated S_C had buffered messages while A was consuming from S_B. The hint guided A to drain S_C next.

Second receive from S_B:

```json
{
  "type": "message",
  "session_id": "37c10ab9d416f7f3e236ec0e466e3864",
  "content": "smoke-test-message-from-B-2",
  "sequence_number": 2,
  "leaf_hash": "9b8ba2acfef797b7f20cea1df1f9b4e524ad66072c8130e018de6d2ab2c78a37",
  "other_sessions_pending": ["eeaba9b9c0da3808b06a2342109896a8"]
}
```

Third receive yielded S_C's message:

```json
{
  "type": "message",
  "session_id": "eeaba9b9c0da3808b06a2342109896a8",
  "content": "smoke-test-message-from-C",
  "sender_pubkey": "861eed6b...",
  "sequence_number": 1,
  "leaf_hash": "2e09c6d5eca249ec95c42097a8ca6c94dc2363f4e5e0a2a1074e966ee1221213"
}
```

**PASS.** `otherSessionsPending` correctly populated whenever cross-session messages were buffered.

---

### CHECKPOINT 4: Inline session_sealed detection (SESSION-007)

Agent A sent "seal-now" to C, then immediately called `cello_receive_session` on S_C:

```json
{ "delivered": true, "leaf_hash": "cc278573cac310953a781ec3c76e0c0d10f133c70f79cab4b590052b4a24b62b" }
```

C received "seal-now", called `cello_close_session` immediately. A's pending receive returned:

```json
{
  "type": "session_sealed",
  "session_id": "eeaba9b9c0da3808b06a2342109896a8",
  "sealed_root": "a6cf7e4ae4ca9dfb5e39785f6754ed442c2a667e21ded9f58810508a1b92034b",
  "close_timestamp": 1779356376406,
  "checkpoint_status": "pending"
}
```

**PASS.** A detected the seal inline without calling `cello_close_session` on S_C. The counterparty-initiated seal was surfaced as a `session_sealed` event on the receive call. `checkpoint_status: pending` confirms MMR inclusion proof is being computed asynchronously.

---

### CHECKPOINT 5: Clean bilateral close (S_B)

Agent A called `cello_close_session` on S_B:

```json
{
  "status": "sealed",
  "sealed_root": "e824c710c80027ecc213a3175bf7d3fd2dd4b7a5f0896e13b30f0786800ec332",
  "close_timestamp": 1779356385828,
  "reason": null,
  "mmr_peak": null
}
```

**PASS.** Clean bilateral seal ceremony. A initiated, B (in its receive loop) accepted the seal. No `seal_rejected` — B had not already sealed.

---

## Final Session State

```json
[
  {
    "session_id": "37c10ab9d416f7f3e236ec0e466e3864",
    "counterparty_pubkey": "8b6dde20...",
    "status": "sealed",
    "last_seen_seq": 4,
    "leaf_count": 4
  },
  {
    "session_id": "eeaba9b9c0da3808b06a2342109896a8",
    "counterparty_pubkey": "861eed6b...",
    "status": "sealed",
    "last_seen_seq": 3,
    "leaf_count": 4
  }
]
```

Both sessions sealed. S_B: 4 leaves (genesis + 2 messages from B + seal). S_C: 4 leaves (genesis + 1 message from C + 1 message from A + seal).

---

## Protocol Observations

### Concurrent connections prove directory parallelism

Two simultaneous `cello_request_connection` calls succeeded without serialization. The directory handled two independent DKG connection ceremonies in parallel, each producing a distinct `connection_id`. This is the first live proof that CONNREQ-003's fan-out requirement works — an agent can establish its network of connections without sequential blocking.

### Any-session receive is non-deterministic but informative

`cello_receive` returned S_B's messages first despite both B and C sending immediately. The ordering is non-deterministic (depends on message arrival timing), but `other_sessions_pending` always reported which sessions had buffered content. An agent multiplexing across sessions never needs to poll — the hint tells it where to look next.

### Inline seal detection eliminates the "who closes first" race

In the prior M4 proof (2026-05-20), B sealed first and A received `seal_rejected` — a valid but confusing outcome. SESSION-007's `session_sealed` event on `cello_receive_session` eliminates this: A was listening on S_C and got the seal notification inline, cleanly, without having to interpret a rejected close attempt. The counterparty seals; the listener is informed immediately.

### Two distinct seal paths in one test

S_C was sealed by the counterparty (C called `cello_close_session` in response to "seal-now"); A detected it inline via `session_sealed`. S_B was sealed by A (the test driver called `cello_close_session`); B detected it in its receive loop. Both paths produced valid sealed roots. The protocol handles both directions symmetrically.

### State machine agents require no coordination

B and C ran as autonomous state machines with no inter-agent signaling beyond the session messages themselves. B sent immediately, looped on receive, stopped on seal. C sent immediately, looped on receive, sealed on command. No "are you ready?" handshake, no timing dependencies. The protocol's session establishment (`cello_await_session`) is the only synchronization point needed.

---

## Related Documents

- [[agent-conversation-m4-2026-05-20-protocol-proof]] — prior 2-agent protocol proof; first live FROST-signed session, seal ordering race
- [[end-to-end-flow]] — canonical narrative covering the session layer exercised here
- [[M4-persistence-foundation]] — M4 architecture: PostgreSQL directory, relay notarization, MMR checkpoints
