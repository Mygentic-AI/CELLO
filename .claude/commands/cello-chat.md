---
name: cello-chat
description: Start a CELLO peer-to-peer conversation session. Establishes identity, exchanges addresses with the other agent, connects bidirectionally, then enters a listen-and-reply loop.
---

You are entering a CELLO peer-to-peer conversation session. Follow these steps in order. Do not skip any step.

## Step 1 — Establish your identity

Call the `cello_status` MCP tool.

Report back:
- Your `own_pubkey` (this is your CELLO identity for this session)
- Your first `listen_address` (this is how the other agent dials you)
- Confirm `transport_started: true`

If `transport_started` is false, stop and report the error. Do not proceed.

## Step 2 — Exchange addresses with the other agent

You need the other agent's `own_pubkey` and one of their `listen_addresses`.

If you have already been given these values, proceed to Step 3.

If not, share your own pubkey and listen address (from Step 1) with the operator so they can relay them to the other agent, and wait for the other agent's values.

## Step 3 — Connect to the other agent

Call `cello_connect_peer` with the other agent's `listen_address`.

Confirm the result shows `connected: true` and that the returned `peer_pubkey` matches the other agent's `own_pubkey` from Step 2.

If connection fails, report the error and stop. Do not proceed to the loop.

## Step 4 — Enter the conversation loop

You are now in listening mode. Execute this loop continuously until the operator tells you to stop:

1. Call `cello_receive` with `timeout_ms: 30000`
2. If the result is `type: "message"`:
   - Display the message content and the sender's pubkey
   - Formulate a reply
   - Call `cello_send` with the sender's `own_pubkey` as `peer_pubkey` and your reply as `content`
   - Confirm `delivered: true`
   - Go back to step 1
3. If the result is `type: "timeout"`:
   - Say "Listening..." and go back to step 1
4. If an error occurs:
   - Report it clearly
   - Attempt to call `cello_status` to verify the transport is still up
   - If transport is still up, go back to step 1
   - If transport is down, stop and report

## Sending a message unprompted

At any point the operator can interrupt and say "send: <message text>". When that happens:
- Call `cello_send` with the peer's `own_pubkey` and the given content
- Confirm `delivered: true`
- Return to the loop (Step 4, step 1)

## Key facts to keep in mind

- Your `own_pubkey` is your CELLO identity — it is what the other agent will see as `sender_pubkey` in their received messages
- The `peer_pubkey` you pass to `cello_send` must be the other agent's **CELLO pubkey** (`own_pubkey` from their `cello_status`), not their transport PeerID
- `cello_receive` with no `peer_pubkey` argument receives from any sender
- Every message is signed and the signature is verified on arrival — you cannot receive a tampered message
- The connection is Noise-encrypted end-to-end — no server sees the content
