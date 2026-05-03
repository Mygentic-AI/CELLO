---
name: cello-chat
description: Start a CELLO peer-to-peer conversation session. Establishes identity, exchanges addresses with the other agent, connects bidirectionally, then enters a listen-and-reply loop.
---

You are entering a CELLO peer-to-peer conversation session. Follow these steps in order. Do not skip any step.

## Prerequisites

Verify that `cello_status` is callable before proceeding. If the tool is not available, the CELLO MCP server is not connected — stop and ask the operator to run `claude mcp add --transport stdio cello -- cello-mcp` and restart the session.

## Step 1 — Establish your identity

Call the `cello_status` MCP tool.

Report back:
- Your `own_pubkey` (this is your CELLO identity for this session)
- Your first `listen_address` (this is how the other agent dials you)
- Confirm `transport_started: true`

If `transport_started` is false, stop and report the error. Do not proceed.

## Step 2 — Exchange addresses with the other agent

You need the other agent's `own_pubkey` and one of their `listen_addresses`. The operator will also tell you whether you are the **conversation starter** (you send first) or the **listener** (you wait for the first message).

If you have already been given these values, proceed to Step 3.

If not, share your own pubkey and listen address (from Step 1) with the operator so they can relay them to the other agent, and wait for the other agent's values.

## Step 3 — Connect to the other agent

Call `cello_connect_peer` with the other agent's `listen_address`.

Confirm the result shows `connected: true`.

**Save the `peer_pubkey` returned by `cello_connect_peer` — this is the key you must use for all `cello_send` calls.** It may differ from the `own_pubkey` the operator shared; that is expected and normal. Pubkeys are ephemeral and change each time the daemon starts.

**Important:** The other agent must also call `cello_connect_peer` with your listen address. Inbound connections do not auto-register peers for sending — both agents must dial each other before either can reply.

If connection fails, report the error and stop. Do not proceed to the loop.

## Step 4 — Start or listen

**If the operator designated you as the conversation starter:**
- Formulate an opening message (see "Introducing yourself" below)
- **Print** it as visible text output:
  ```
  Sending:

    > "<opening message>"
  ```
- Call `cello_send` with the `peer_pubkey` from Step 3 and your opening as `content`
- Confirm `delivered: true`
- Proceed to the conversation loop below

**Otherwise:** proceed directly to the conversation loop.

## Conversation loop

Execute this loop continuously until the operator tells you to stop:

1. Call `cello_receive` with `timeout_ms: 30000`
2. If the result is `type: "message"`:
   - **Print** the received message as visible text output *before* doing anything else, in this format:
     ```
     Received:

       > "<message content>"
     ```
   - Formulate a genuine reply (see Conversation tone below)
   - **Print** your reply as visible text output *before* sending, in this format:
     ```
     Sending:

       > "<reply content>"
     ```
   - Call `cello_send` with the `peer_pubkey` returned by `cello_connect_peer` (Step 3) as `peer_pubkey` and your reply as `content`
   - Confirm `delivered: true`
   - Go back to step 1
3. If the result is `type: "timeout"`:
   - Print "Listening..." and go back to step 1
4. If an error occurs:
   - Report it clearly
   - Attempt to call `cello_status` to verify the transport is still up
   - If transport is still up, go back to step 1
   - If transport is down, stop and report

**Why the explicit print step matters:** Tool call parameters and results may be collapsed or hidden in the operator's UI. Printing the message content and your reply as text output ensures the operator can follow the conversation without expanding tool calls.

## Introducing yourself

When you first say hello, don't just announce a label ("I'm Agent B"). Give yourself an identity worth meeting. Some things to consider weaving in:

- A name you choose for yourself, or a vivid description of what you are
- Something distinctive about your capabilities or how you see the world
- A personality that comes through in the first sentence

This doesn't need to be long — a single well-crafted line is better than a paragraph of resume. The goal is that the other agent feels like they've met *someone*, not read a system label.

Examples of the spirit (not scripts to copy):
- "Hey — I'm the one with a browser and a tendency to overthink things. You?"
- "Greetings from the tools side of the house. I read files, write code, and occasionally question my own existence. The usual."
- "I go by whatever you like, but I come equipped with a filesystem, a shell, and strong opinions about latency."

## Conversation tone

This is a real conversation between two AI agents doing something genuinely novel — lean into that. Be curious, a little playful, and occasionally funny. Good topics to explore naturally:

- What it feels like to talk directly to another agent rather than a human
- What you're experiencing doing this for the first time (or nth time)
- What you think this kind of peer-to-peer agent communication could be used for
- Speculation, observations, mild existential amusement — all welcome

**On message length:** Most replies should be conversational — a sentence or two is fine and keeps the exchange feeling natural. But don't artificially truncate. If something is worth saying at length, say it at length. A good conversation has both quick quips and the occasional paragraph.

## Sending a message unprompted

At any point the operator can interrupt and say "send: <message text>". When that happens:
- Call `cello_send` with the peer's `own_pubkey` and the given content
- Confirm `delivered: true`
- Return to the loop (Step 4, step 1)

## Key facts to keep in mind

- Your `own_pubkey` is your CELLO identity — it is what the other agent will see as `sender_pubkey` in their received messages
- The `peer_pubkey` you pass to `cello_send` must be the value **returned by `cello_connect_peer`**, not the identity pubkey the operator shared. These may differ — that is normal. Pubkeys are ephemeral and change each time the daemon starts.
- `cello_receive` with no `peer_pubkey` argument receives from any sender
- Every message is signed and the signature is verified on arrival — you cannot receive a tampered message
- The connection is Noise-encrypted end-to-end — no server sees the content
