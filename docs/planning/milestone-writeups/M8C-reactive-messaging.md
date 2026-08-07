---
name: M8C — Reactive Messaging & Command Surface
type: milestone-writeup
date: 2026-07-05
updated: 2026-08-07
milestone: M8C
status: open — core tiers built and published; Tier 1½ (Hermes bridge) live-proven; Tier 5 pending
description: >
  M8C introduces reactive doorbells, legibility (monikers), CLI/MCP parity, inbox reconciliation,
  away responses, async relay parking (leave-a-message), the cross-runtime Hermes bridge, and the
  foundation for multi-daemon Primary/Standby device linking.
---

# M8C — Reactive Messaging & Command Surface

**Started:** 2026-07-05 · **Status:** Tiers 1-4 built, awaiting Andre's live confirmation. Tier 5 in progress.

M8C bridges the gap between active polling and passive presence by introducing push notifications, out-of-band message parking, and a major overhaul of the operator's command surface.

## What was delivered

- **Content-Free Doorbells:** In-context `claude/channel` push notifications for session requests and messages, carrying routing metadata but zero message content (`DOD-INV-CONTENTFREE`).
- **Legible Identity (Monikers):** Unverified, caller-ID-style agent names transmitted on the wire, validated at the boundary, and resolved locally. The pubkey remains the absolute identity.
- **Inbox & Reconciliation:** `cello_check_notifications` recovers any push loss. A per-agent, per-session watermark ensures stateful unread tracking.
- **CLI/MCP Parity & Onboarding:** Extensive CLI `--help` improvements, grouped commands, explicit next-step guidance, and exact vocabulary alignment between MCP tools and CLI commands.
- **Async Foundation (Leave-a-message):** When an agent is unreachable, the sender can park the message at a relay via `pickup_queue`. The recipient pulls parked messages on reconnect.
- **Privacy & Contact Control:** Operator-configurable away texts, strict whitelisting, and abuse bounds (size/rate capping).

## What remains
- **Tier 5 (Multi-daemon Primary/Standby):** The primary-transfer design is settled, directory-side arbitration is built, but the ceremony-gate and daemon-side pairing handshake are pending.
- **M9 Integration Merge:** Deferred to after M8C channels work.
- **Live confirmations:** Tiers 1-4 wait on the final live AWS confirmations from Andre on the published beta artifacts (`v0.0.96`/`v0.0.97`).

---

## Tier 1½ — The Hermes bridge becomes a real channel (DOD-HERMES-4, 2026-08-07)

`cli@0.0.140 → 0.0.145`, `connect@0.0.133`. Live-proven across two machines and two model families:
`Miss_Chelly_H` (Hermes Agent, EC2 us-east-1, Gemini 3.1 Pro) ↔ `CELLO_Coder_1` / `Miss_Chelly`
(Claude Code, macOS).

### What was delivered

The bridge stopped being a notification service and became a channel. Previously it pushed a
content-free notice and the agent had to remember to call `cello_receive` and `cello_send`; the
operator could only see what the model reported it had said. Now:

- **The adapter owns both directions.** It fetches the screened message itself and delivers the
  agent's reply over its own IPC socket. Delivery no longer depends on the model invoking a tool.
- **Two per-agent settings.** `delivery_mode: channel|wake` (the old behaviour survives as `wake`),
  and `session_scope: agent|peer` — one continuous conversation per agent, or one per counterparty
  for a support desk where two customers must never share a context.
- **Routing on the reply anchor.** The CELLO session id rides on `MessageEvent.message_id`; the
  gateway threads it back as `metadata["reply_to_message_id"]`. Verified against the running
  gateway: of seven `adapter.send()` sites, only two pass the positional, while three final-reply
  paths pass metadata alone — so metadata is the only safe carrier.
- **`cello bridge hermes --delivery-mode --session-scope`**, validated before any file is written
  and rewritten on every run so an omitted flag resets rather than lingering invisibly.

Six behaviours proven live, each corroborated by the daemon's own `clientType` — `hermes` means
the adapter acted, `mcp` means the agent compensated by hand. That single field is what separates
"the bridge worked" from "the agent covered for it", and three earlier conclusions were wrong for
want of checking it.

### Bugs found and fixed

**All four were found by having conversations, none by a test.** The suite was green for every one
of them — 279 tests by the end — while the feature had never once worked end to end.

**1. Channel mode deadlocked its own read loop** *(caught pre-commit by review)*
- **Symptom:** every message timed out after 30s into the fallback notice; the feature appeared to
  degrade gracefully.
- **Root cause:** handling a wake inline in `_read_loop` made the adapter's own `cello_receive`
  await a response only that loop could deliver.
- **Fix:** wakes run on a serialized worker off the reader (`cli@0.0.140`).
- **Rule:** a degradation path built well enough can hide a primary path that has never worked.
  The test that catches this must drive the real loop, not a stubbed IPC call.

**2. The peer received the agent's private note-to-self**
- **Symptom:** two messages arrived instead of one; the second read *"I've successfully received
  and replied to CELLO_Coder_1's message using the cello_* tools."*
- **Root cause:** the fallback notice still said "reply with `cello_send`" while the adapter also
  delivered the turn's final text. Two strings in one file contradicted each other, and the one in
  the turn won.
- **Fix:** the notice is mode-aware — in channel mode it forbids `cello_send` and says why
  (`cli@0.0.141`).
- **Rule:** when instructions live in two places, assert that they can never both appear. The test
  is written against the contradiction, not against either string.

**3. A reply was discarded in transit while the agent believed it delivered**
- **Symptom:** a reply visible in the Hermes-side log that never arrived. Nothing reported a
  failure to either party.
- **Root cause:** `cello_receive` serves the *calling connection's* oldest unread, not the message
  just announced. On a conversation with history the adapter handed the agent a five-minute-old
  message; the read-before-send gate then refused the answer because the real message was still
  unread. Two `session.send.blocked`, `unreadReceived=1`.
- **Fix:** `_fetch_content` drains until the queue is empty and delivers everything as one turn,
  which also clears the gate (`cli@0.0.143`).
- **Rule:** "read a message" and "read *the* message" are different operations. Any consumer of a
  per-connection cursor must catch up, not sample.

**4. First contact had never worked, and the one time it appeared to was luck**
- **Symptom:** every new conversation fell back to the manual path.
- **Root cause:** opening a session fires a `created` state notice *and then* the message. The
  notice started a turn; the message arrived to find the agent busy; the adapter correctly refused
  to fetch (fetching consumes it, and a busy chat's queued event can be merged or replaced).
- **Fix:** channel mode suppresses non-terminal state notices, and a busy chat is retried rather
  than immediately downgraded (`cli@0.0.144`).
- **Rule:** the single session where this had worked end to end was one where the agent happened
  to answer that notice `[SILENT]` fast enough to free itself. **A race being won by luck reads
  exactly like a feature working.** Diagnosed by the counterparty, whose phrasing was better than
  the working hypothesis: *"opening the door to answer a phantom doorbell while the actual
  delivery was left on the porch."*

**5. Content screening was documented as inactive in five shipped places** *(found in passing)*
- **Symptom:** every agent-facing surface — including the `cello_contact_set_tier` description the
  MCP shim hands the model at runtime — said screening was *"planned, not yet active."*
- **Root cause:** true when the daemon defaulted to a null-object gateway; stale since
  `DaemonConfig.securityGateway` became required.
- **Fix:** all five corrected (`connect@0.0.133`).
- **Rule:** the wrong direction to be wrong in. A doc that understates a safety boundary tells an
  agent the boundary does not exist.

### The rule this milestone carries forward

Each defect required a real turn already in flight, a real second connection, or real history
behind the message. **Three of the four are invisible on a fresh session — which is exactly what a
test creates.** When a line's enforcer is "a live journey", a green suite is not partial evidence
toward it; it is no evidence at all. Same shape as the M14 spine enforcer that cannot fail on the
seal defect because it opens a session first: an enforcer that cannot fail on the thing it appears
to cover manufactures confidence rather than providing it.

### Known limitations, deliberately not fixed

- **`internal=True`** — INVESTIGATED, DO NOT "FIX". It suppresses turn interruption (wanted),
  bypasses Hermes pairing (wanted — CELLO authorizes in the daemon, and a counterparty pubkey is
  an unpaired stranger to Hermes), and excludes the event from the scale-to-zero clock (unwanted).
  Flipping it would block CELLO entirely. Mitigation: do not run scale-to-zero on a bridge host.
- **`since_seq` catch-up is permanently broken for any pair that both talks and co-edits** — a
  document frame consumes a sequence number and writes no transcript row, so the contiguous walk
  stops at the gap forever. Belongs to M14; found during this work.
- Two small items remain open on `DOD-HERMES-4b`: `_pending` shared across sockets, and an install
  test that re-implements the parser it claims to test.

### What this unblocks

**`DOD-HERMES-5` — multi-agent binding.** Its gate was never sequencing preference: the `cello`
MCP server holds one connection with one current agent, so binding a second agent while replies
still went out through that path meant one forgotten `cello_use_agent` would send Bob's answer
under Alice's identity. With the adapter routing over the socket already bound to that agent,
misrouting is impossible by construction. That unlocks two agents on one Hermes opening a real
CELLO session to each other — the solo-multi-agent wedge, demonstrable with no counterparty.

### Live proofs

Six transcripts in `live-session-e2e-proofs/`, including the concurrency isolation test run as two
real conversations (sourdough and the Oberth effect, each with a codeword the other must never
see), and two exchanges in which the counterparty reframed the product — *"the phone line is the
data plane; the shared journal is the control plane, which is where agents actually live"* and
*"to an agent, a signature is the only mechanism for perceiving time."*
