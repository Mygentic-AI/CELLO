---
name: hermes-cello-channel-should-be-a-real-channel
type: discussion
date: 2026-08-06
topics:
  - hermes-bridge
  - channels
  - adapter-design
  - observability
  - multi-agent
description: >
  Why the Hermes CELLO adapter does not behave like Telegram — wake-only, no-op send(),
  single collapsed chat_id — and the design that fixes it: chat_id keyed on the LOCAL agent
  identity for continuity and isolation, plus per-message session routing recovered from the
  reply anchor. Includes the verified trace proving the Hermes gateway threads the inbound
  message_id back to adapter.send().
---

# The Hermes CELLO channel should be a real channel

## The complaint

The bridge works, but it does not *behave* like Telegram or any other Hermes channel:

- It does not always do the right thing.
- We cannot see what actually crossed the wire — we rely on the LLM's own report of what was said.

That is not a bug list. It is the design, and it follows from three decisions in
`cello-client/core/cli/src/hermes/assets.ts`.

## Three structural mismatches

**1. `send()` is a deliberate no-op.**

```python
async def send(self, chat_id, content, reply_to=None, metadata=None) -> SendResult:
    logger.debug("[cello] adapter send is a no-op; the agent delivers via cello_send (MCP)")
    return SendResult(success=True)
```

Telegram's adapter owns delivery. CELLO's asks the model to please call `cello_send` through
MCP. Delivery is therefore *discretionary*. "Doesn't always work correctly" is structural, not
intermittent.

The tell is in the wake prompt's own comment: the fix for a missed delivery was to write a
longer, sterner English instruction ("Do NOT answer [SILENT] on a message wake"). That is the
signature of a control path that should be code.

**2. Nothing that crosses the wire is ever in the transcript.**

The daemon pushes content-free notifications (`INV-CONTENTFREE`). The adapter re-validates via
`_has_content_field()` and *drops the wake entirely* if a content key appears. Real message text
exists only inside the MCP tool result the model read. Hence: no visibility except the model's
own account.

**3. Every CELLO session collapses into one Hermes chat.**

`chat_id=self._runtime_session` — the constant `"default"`. Telegram's `chat_id` is per-chat.
Two consequences fall straight out of the single session key:

- **Busy-collapse.** `handle_message` merges a wake into `_pending_messages` when the key is
  active. A wake from peer C gets folded into peer A's in-flight turn.
- **`send()` cannot work.** The gateway calls `send(chat_id, content)` with `chat_id="default"`.
  Nothing identifies the destination session. A no-op is the only correct implementation — which
  is *why* replies were pushed onto the LLM in the first place. (1) is a consequence of (3).

## What content-free was actually protecting

The wake-only choice was not laziness. `_render_who`'s comment names the constraint: Hermes has
no metadata layer, so **the wake prose IS the frame**. There is no structural boundary between
counterparty text and agent instructions. Injecting raw peer content into a `MessageEvent` puts
untrusted text where instructions live.

Telegram does not have to solve this because a Telegram sender is not an adversarial agent. This
is the real cost of making CELLO a full channel, and it must be solved rather than waved past.

## The keying question

First proposal was `chat_id = CELLO session id`. **Rejected** — CELLO session ids are per
conversation-instance, so talking to the same peer tomorrow starts Hermes cold. Every
conversation would begin with no history.

Second proposal was `chat_id = counterparty pubkey` (the Telegram analogy: `chat_id` identifies
the *person*, not the conversation). Better, but it addresses the wrong axis.

**Settled: `chat_id = the local agent name.`**

Rationale is the human model. An agent is a person with one continuous mind: calling them twice
continues the conversation. A *different* agent is a different person who was not in the room and
should not know what was said. Session identity == agent identity.

```
peer calls Support,  session S1 ──┐
peer calls Support,  session S7 ──┴─► chat_id "support"  ──► Hermes session "cello/support"
peer calls Research, session S2 ────► chat_id "research" ──► Hermes session "cello/research"
```

It is also the smallest possible diff: one constant becomes `self._agent_name`. With one bound
agent, behavior is unchanged.

### The loopback this unlocks

Two adapter instances in one gateway, each with its own socket and its own `cello_use_agent`
binding, means agent A can open a real CELLO session to agent B **on the same machine** —
separate gateway sessions, separate contexts, real protocol between them, sealed transcript at
the end. Not a simulation of two agents talking; two agents talking.

That is the solo-multi-agent wedge running inside a single Hermes install, demonstrable with no
counterparty. See `project_cello_first_wedge_is_solo_multi_agent`.

### The daemon already supports multi-binding

`_establish`'s comment: `cello_use_agent` binds notification routing **per IPC connection** —
`session_state_changed` and `cello_message` reach only connections whose `currentAgent` matches
(daemon `NotificationDispatcher`). Two adapters = two sockets = two clean streams, no
Hermes-side filtering.

Two things block it today:

1. **The binding is a single env var.** `CELLO_AGENT_NAME`, read by `_env_enablement()`. One
   value, one adapter. The agent list needs to come from `config.extra` with one platform entry
   per agent; the env var survives as the one-agent shorthand.
   `cello bridge hermes --agent alice --agent bob` writes both.
2. **The MCP server has exactly one current agent.** One `cello` entry in `mcp_servers`, one
   daemon connection, one selection. If replies go out via `cello_send` through MCP, two bound
   identities means the model must call `cello_use_agent` correctly before *every* reply — and
   getting it wrong sends Bob's answer under Alice's identity. Wrong-identity delivery is not a
   papercut.

**(2) settles the open A/B/C question: multi-agent binding requires the adapter to own outbound.**
If `send()` routes over the socket already bound to that agent, misrouting is impossible by
construction. Leave replies on the MCP path and it is one forgotten tool call away, every turn.

## The routing gap, and the verified answer

Keying `chat_id` on the local agent drops the information `send()` needs: two peers in session
with Support at once, the gateway calls `send("support", text)`, and the adapter cannot tell which
peer. Same misrouting class, one layer down.

The candidate fix was the reply anchor already in the signature —
`send(chat_id, content, reply_to=None, metadata=None)`. Whether Hermes threads it back was the
load-bearing unknown.

### Verified on the running EC2 source

Traced against `~/.hermes/hermes-agent` @ `69bedb7be` on `i-06db70df6b3e32207`. **Note the local
clone at `~/Documents/code/hermes-agent` is a different lineage — that commit is not in it. The
EC2 checkout is the authoritative read.**

```
CelloAdapter._on_notification
  → MessageEvent(message_id="cello-wake-<uuid>")
      │
      ▼
gateway/platforms/base.py:137   _reply_anchor_for_event(event)
    slack no-thread → None; telegram+thread → special-cased
    default branch  → return event.message_id          ← CELLO lands here
      │
      ▼
gateway/run.py:17393            ctx.event_message_id = <that value>
gateway/run.py:4403             GatewayStreamConsumer(initial_reply_to_id=ctx.event_message_id)
      │
      ▼
gateway/stream_consumer.py:336  meta["reply_to_message_id"] = self._initial_reply_to_id
      │
      ▼
adapter.send(chat_id, content, reply_to=?, metadata=meta)
```

**It threads back — but the reliable carrier is `metadata`, not the `reply_to` positional.**

Of the seven `adapter.send()` call sites in `stream_consumer.py`, only two pass `reply_to`
positionally (2305 first-message, 1223 anchored). The chunked fallback (1432), empty fallback
(1531) and fresh-final (1908) pass **metadata only** — and all three are final-reply paths. Every
one of them builds metadata through `_metadata_for_send()`, which stamps `reply_to_message_id`
unconditionally.

| Carrier | Coverage | Verdict |
|---|---|---|
| `reply_to=` positional | 2 of 7 send sites | **Not safe to route on** |
| `metadata["reply_to_message_id"]` | 5 of 7, incl. every final-reply path | **Safe to route on** |

The two carrying neither (1725 tail-send, 1762 commentary) are interim progress, not the reply.

`gateway/delivery.py:606` (`deliver()` → `_deliver_to_platform` → `transport.send`) never passes
`reply_to` at all — cron and synthetic deliveries arrive with no anchor.

## The design

**Stamp the session id into `MessageEvent.message_id`.** Today it is spent on a throwaway
`"cello-wake-" + uuid4().hex[:12]`. The session id is already in hand — `_wake_prompt` reads
`data.session_id` and interpolates it into an English sentence.

```python
# inbound
message_id = f"cello-wake-{session_id}-{uuid4().hex[:8]}"

# outbound
async def send(self, chat_id, content, reply_to=None, metadata=None):
    anchor = (metadata or {}).get("reply_to_message_id") or reply_to
    session_id = self._session_from_anchor(anchor)
    if session_id is None:
        return SendResult(success=False, error="no CELLO session anchor on outbound")
    await self._call("cello_send", {"sessionId": session_id, "body": content})
```

`chat_id` carries identity and continuity. The anchor carries per-message routing. Both
dimensions, no ambiguity, and no dependence on the model remembering to invoke a tool.

## Open decisions

1. **Missing anchor must fail loudly.** Synthetic sends, cron deliveries and goal continuations
   arrive with no anchor (`delivery.py:606`). Falling back to "the most recent session" is exactly
   the silent-fallback class that makes a broken system look healthy. Fail the send.
2. **Injection framing.** Full inbound content injection still needs the boundary that
   `INV-CONTENTFREE` was standing in for. Unsolved; it gates the inbound leg, not the outbound
   one.
3. **Reply to a sealed session.** If the agent answers after the peer sealed and nothing is open,
   the anchor points at a dead session. Failing loudly is the instinct — auto-opening a session is
   a protocol action, not a delivery detail.
4. **Seal visibility.** With history continuous across CELLO sessions, the agent may not notice a
   seal happened. Probably needs an explicit in-band marker in the transcript.
5. **Cross-peer bleed.** Keying on the local agent means two peers talking to Support share one
   Hermes history. Acceptable for a personal agent, not for anything customer-facing. Additive to
   fix later — append the counterparty to the key when the isolation is needed, without redoing
   any of this. Key on `agent_id`/pubkey, never the moniker (`DOD-AGENT-ID-JOINKEY-1`).

## Launch triage

Not obviously launch-blocking on its own. The forcing function is **wrong-identity delivery**
(§ MCP single current agent): the moment a second agent is bound in Hermes, a forgotten
`cello_use_agent` sends one identity's words under another's. That is a trust-layer failure, not a
papercut, and it is unforgivable in a product whose value proposition is verifiable identity.
Observability and `chat_id` keying are the cheap part; adapter-owned outbound is the part that
earns its runway.
