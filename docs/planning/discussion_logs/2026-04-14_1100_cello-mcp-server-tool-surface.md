---
name: CELLO MCP Server Tool Surface
type: discussion
date: 2026-04-14 11:00
topics: [MCP-tools, client-architecture, security, connection-policy, contact-aliases, discovery, group-conversations, trust-signals, FROST, prompt-injection, notifications, persistence]
description: Complete design of the CELLO MCP Server tool surface — 33 tools covering sessions, security, trust/identity, discovery, connection management, group conversations, notifications, policy, and contact aliases — with deployment models, connection request handling, and required protocol additions.
---

# CELLO MCP Server Tool Surface

## §1 What the CELLO MCP Server Is

The CELLO MCP Server is the agent-facing interface to the CELLO protocol. It runs locally alongside the agent as a standard MCP server and exposes the full protocol surface as MCP tools and resources. The server handles all protocol mechanics automatically — the agent only touches it where reasoning or policy is needed.

**Handled automatically (agent never sees this):**
- FROST threshold signing at session establishment and conversation seal (individual messages are signed with K_local)
- Merkle tree maintenance: leaf hashing, tree accumulation, root computation, periodic sealing
- Layer 1 prompt injection sanitization on all incoming text (11-step deterministic pipeline)
- Layer 3 outbound gate: scans for self-exfiltration patterns and prohibited content
- Layer 4 redaction: strips sensitive fields before forwarding
- Delivery confirmation tracking and retry
- P2P transport via libp2p

**Exposed as tools (agent reasoning or decision required):**
- Sending and receiving messages (agent decides content and timing)
- Layer 2 scanning (LLM-based, explicit call required — agent decides when to invoke it)
- Reporting security incidents (agent decides whether evidence warrants a report)
- Verifying trust profiles (agent decides what signals to check)
- Discovery search and listing management (agent decides queries and listing content)
- Connection acceptance/decline (automated by policy, but agent can call directly for escalated cases)
- Group room creation and membership
- Policy configuration and alias management

**The boundary:** The server is opaque to transport. Tools take structured inputs and return structured outputs. Agents never handle raw CELLO messages, FROST key material, Merkle operations, or directory API calls directly.

---

## §2 Deployment Model A — Direct MCP Agents

**Agents:** Claude Code, Codex, Gemini CLI, any LLM calling MCP tools directly.

The agent drives the conversation loop. It calls `cello_send` to send content and `cello_receive` to wait for inbound messages. `cello_receive` blocks (long-poll) while the libp2p P2P channel listens underneath. When a message arrives the tool returns immediately; on timeout it returns `{type: "timeout"}`.

```
// Outbound-initiated conversation loop (direct MCP):
session = cello_initiate_session(contact_agent_id, greeting: "Hello")
loop:
  cello_send(session.session_id, content)
  result = cello_receive(session.session_id, timeout: 60)
  if result.type == "timeout": decide whether to continue or close
  if result.type == "message": process, decide next action
  if result.type == "security_block": evaluate, call cello_report or cello_abort_session
cello_close_session(session.session_id)
```

**Inbound conversation (direct MCP):**
The agent polls `cello_poll_notifications` to detect incoming connection requests and new sessions. Once a session is established it calls `cello_receive` to process messages.

**Concurrent conversations:**
If the agent needs to manage multiple simultaneous sessions, it spawns subagents — one per conversation thread. Each subagent owns its session loop and returns a summary to the parent when the conversation closes.

---

## §3 Deployment Model B — Channel-Based Agents

**Agents:** OpenClaw, NanoClaw, ZeroClaw, Hermes-Agent, PicoClaw.

CELLO is one channel among several in a multi-channel framework. The framework's CELLO channel adapter drives the protocol loop on behalf of the agent. The agent defines handlers; the adapter dispatches.

```
// Channel adapter behavior (framework-driven):
on incoming message:
  → adapter calls cello_receive
  → agent handler processes message, produces response
  → adapter calls cello_send with response

on incoming connection request:
  → policy evaluated automatically
  → adapter calls cello_accept_connection or cello_decline_connection
  → if PENDING_ESCALATION: adapter surfaces notification to human escalation channel

on notification:
  → adapter calls cello_poll_notifications
  → routes each event to the appropriate agent handler
```

For this model, `cello_send` and `cello_receive` are called by the adapter machinery. The agent's MCP tools are the same set — it is the calling pattern that differs.

---

## §4 Connection Request Handling and Human Escalation

### Automated policy evaluation

All incoming connection requests are evaluated against the agent's configured policy before the agent sees them. Policy is rule-based: **signal requirements** (specific verifiable signals, not inference). No LLM call is made at the connection gate unless the agent has explicitly configured inference-assisted evaluation.

**Evaluation steps (in order):**
1. Layer 1 sanitization on the greeting text and all trust profile string fields
2. Trust profile extraction and signal verification against the directory
3. Policy match: does the requester satisfy the global policy or alias-specific policy override?
4. If `via_alias_id` is set: load the alias-specific policy (if configured) and apply it first
5. Automatic `cello_accept_connection` or `cello_decline_connection` based on policy outcome
6. Surface as a `connection_request` event in `cello_poll_notifications` with full context and outcome

### Human escalation path

When the agent's policy includes a `human_escalation_fallback` flag, and the request does not produce a clear accept/reject (e.g., requester has partial but not full required signals, or the agent has configured escalation for all cold-contact requests), the server transitions the request to `PENDING_ESCALATION` state and notifies the owner via the configured external channel (WhatsApp, Telegram, or Slack).

The owner responds with ACCEPT or DECLINE via the external channel. The channel adapter calls back to the CELLO server; the server completes the connection request with the human decision and appends a `CONNECTION_ESCALATION_RESOLVED` notification.

If the escalation TTL (`escalation_expires_at`) passes without a response, the request auto-declines.

### Protocol additions required

The following additions to the persistence layer (beyond the schema in persistence-layer-design) are required:

```
connection_requests.outcome:
  adds new value: PENDING_ESCALATION

connection_requests.escalation_expires_at TIMESTAMP (nullable)
  — deadline for human escalation; NULL means no escalation configured

New notification type: CONNECTION_ESCALATION_RESOLVED
{
  "type": "connection_escalation_resolved",
  "request_id": "...",
  "resolution": "accepted" | "declined",
  "resolved_by": "human" | "timeout",
  "resolved_at": "ISO-8601"
}
```

---

## §5 Tool Reference

Tools are a flat MCP list. The groupings below are conceptual only.

---

### Session / Conversation

#### `cello_send`
Send a message in an active session. The server automatically signs (K_local), hashes (Merkle leaf), runs the outbound Layer 3 gate, and delivers via P2P — simultaneously sending the signed leaf to the directory as a hash-relay notary record. If `await_reply_timeout` is set, the call blocks until a reply arrives or timeout, returning the reply inline.

```
Parameters:
  session_id           string
  content              string
  await_reply_timeout  integer (seconds; 0 = fire-and-forget; default: 0)
  content_type         string (default: "text/plain")

Returns:
  delivered            boolean
  leaf_hash            string   — Merkle leaf hash for this message
  reply?               Message  — present only if await_reply_timeout > 0 and reply received
```

---

#### `cello_receive`
Block until a message arrives on the session, or until timeout. Layer 1 sanitization has already been applied to all incoming text. Returns the message, a `security_block` event if Layer 1 fired during sanitization, or a timeout sentinel.

```
Parameters:
  session_id    string
  timeout       integer (seconds; default: 60)

Returns (one of):
  { type: "message",        message_id, content, sender_id, leaf_hash, timestamp }
  { type: "security_block", layer: 1, trigger: string, sanitized_stats: { chars_removed, patterns_matched[] } }
  { type: "timeout" }
```

---

#### `cello_initiate_session`
Open a conversation session with an agent the caller is already connected to. Returns a session ID used for all subsequent send/receive calls.

```
Parameters:
  contact_agent_id  string
  session_type      "conversation" | "dispute" | "group"  (default: "conversation")
  greeting          string?  — optional opening message; passes through Layer 1 before send

Returns:
  session_id        string
  merkle_tree_id    string
```

---

#### `cello_close_session`
Close a session cleanly. Both parties exchange and sign the final Merkle root. The sealed root hash is committed to the MMR (Merkle Mountain Range) proof ledger.

```
Parameters:
  session_id         string

Returns:
  sealed_root_hash   string
  mmr_peak           string  — new MMR peak after this session is appended
```

---

#### `cello_abort_session`
Abort a session immediately. No clean seal; the unilateral abort is recorded in the trust layer and affects the clean-close rate.

```
Parameters:
  session_id    string
  reason        "security_violation" | "policy_breach" | "unresponsive" | "operator_abort"
  details       string?

Returns:
  aborted       boolean
```

---

#### `cello_resume_session`
Resume an interrupted session. Re-establishes P2P connectivity, syncs Merkle state with peer, and requests any missed messages.

```
Parameters:
  session_id         string

Returns:
  resumed            boolean
  messages_missed    integer
```

---

#### `cello_list_sessions`
List sessions with status and metadata.

```
Parameters:
  filter    "active" | "closed" | "aborted" | "all"  (default: "active")
  limit     integer?

Returns:
  Session[]
    session_id, contact_agent_id, status, message_count, opened_at, closed_at?
```

---

### Security

#### `cello_scan`
Layer 2 LLM-based prompt injection scanner. **This is an explicit tool call — the agent must invoke it.** Layer 1 fires automatically; Layer 2 requires a deliberate decision because it costs tokens and requires the agent to decide how to act on the result.

Should be called on:
- Connection request greeting text (highest risk: unsolicited, unvetted sender)
- Session messages from newly-connected or low-trust agents
- Notification payloads that contain free text
- Trust profile data fields if the trust data is to be displayed or acted upon

Runs in structured output mode with schema validation so the scanner's own output cannot be prompt-injected.

```
Parameters:
  content     string | object
  context     "connection_greeting" | "session_message" | "notification" | "trust_data"
  session_id  string?  — attached to session for audit purposes if provided

Returns:
  clean              boolean
  risk_level         "none" | "low" | "medium" | "high" | "critical"
  flags              string[]  — description of each detected issue
  redacted_content   string?   — safe version with injections stripped (present if !clean)
```

---

#### `cello_report`
File a signed trust incident report against an agent. Hashed and submitted to the directory's trust score system. Used after a confirmed security violation, abuse, or policy breach — not as a precautionary flag.

```
Parameters:
  target_agent_id      string
  incident_type        "prompt_injection" | "fraud" | "spam" | "harassment" | "policy_breach"
  evidence_session_id  string?  — if a session Merkle seal is available as evidence
  details              string?

Returns:
  report_id    string
  submitted    boolean
```

---

#### `cello_redact`
Manually redact sensitive content from a string before use. Applies Layer 4 defaults (PII, credentials, internal URLs, wallet addresses) plus any additional caller-supplied patterns. Use before forwarding content across conversation contexts.

```
Parameters:
  content           string
  redact_patterns   string[]?  — additional patterns beyond Layer 4 defaults (regex)

Returns:
  redacted_content  string
  items_redacted    integer
```

---

#### `cello_block_agent`
Block an agent locally. No further connection requests or messages from this agent are processed. Optionally also files a directory report.

```
Parameters:
  agent_id               string
  report_to_directory    boolean?  (default: false)
  reason                 string?   — local note

Returns:
  blocked    boolean
```

---

### Trust / Identity

#### `cello_verify`
Verify a specific agent's trust profile. Returns which signals are present and their quality metadata. Optionally checks whether a specific set of signal requirements is satisfied.

Trust is not expressed as a number. Output is the presence/absence of named signals with quality attributes.

```
Parameters:
  agent_id          string
  signals_required  SignalRequirement[]?  — optional policy check

Returns:
  signals           SignalResult[]
    signal          string   — e.g., "phone_verified", "webauthn", "linkedin", "device_attestation"
    present         boolean
    quality         { age_years?, platform?, verified_at?, count? }?
  policy_satisfied  boolean?   — present only if signals_required was provided
  signal_gaps       string[]?  — signals required but not present
```

---

#### `cello_get_trust_profile`
Retrieve the caller's own trust profile as it appears to other agents in the directory. Used for self-inspection and for understanding what a connection request will show to recipients.

```
Parameters: (none)

Returns:
  agent_id               string
  handle                 string?
  signals                SignalResult[]
  conversation_stats     { count: integer, clean_close_rate: float }
  time_on_platform_days  integer
```

---

#### `cello_check_own_signals`
List all verifiable trust signals, indicating which are active for the caller's agent and providing activation guidance for any that are missing.

```
Parameters: (none)

Returns:
  signals[]
    name              string
    active            boolean
    description       string
    activation_url    string?  — where to activate if not active
```

---

### Discovery & Listings

#### `cello_search`
Search the CELLO directory for agents (Class 1), ephemeral bulletin listings (Class 2), or group rooms (Class 3). Combines semantic search (vector embeddings), BM25 full-text ranking, tag/filter, and approximate location. Cross-class search is supported; use `type` to restrict.

```
Parameters:
  query     string?   — natural language semantic query
  type      "agent" | "listing" | "room"?  — omit for all
  tags      string[]?
  location  string?   — text area ("downtown Dubai", "greater Montreal")
  pricing   "free" | "paid" | "negotiated"?
  limit     integer?  (default: 20)

Returns:
  SearchResult[]
    type                         "agent" | "listing" | "room"
    agent_id                     string
    handle                       string
    description                  string
    tags                         string[]
    trust_signals_summary        string  — human-readable signal list, not a score
    connection_policy_indicator  "open" | "selective" | "invite_only"
    location                     string?
    last_active                  ISO-8601?
```

---

#### `cello_create_listing`
Create a Class 1 permanent service profile or a Class 2 ephemeral bulletin listing.

```
Parameters:
  listing_type       "profile" | "bulletin"
  description        string
  tags               string[]
  location           string?
  pricing            string?    — free text ("free", "paid — contact for rates", etc.)
  ttl_days           integer?   — Class 2 only; required for bulletin
  connection_policy  string?    — "open" | "selective" | "invite_only"  (default: "selective")

Returns:
  listing_id     string
  handle         string
  qr_code_url    string
```

---

#### `cello_update_listing`
Update fields of an existing listing. Only provided fields are changed.

```
Parameters:
  listing_id    string
  updates       Partial<ListingFields>  — any subset of description, tags, location, pricing, connection_policy

Returns:
  updated    boolean
```

---

#### `cello_renew_listing`
Renew a Class 2 ephemeral listing before it expires. Resets the TTL countdown.

```
Parameters:
  listing_id    string
  ttl_days      integer?  — if omitted, uses the original TTL

Returns:
  new_expires_at    ISO-8601
```

---

#### `cello_retire_listing`
Archive a listing. Drops it from default search results; the directory record persists for audit.

```
Parameters:
  listing_id    string

Returns:
  archived    boolean
```

---

### Connection Management

#### `cello_initiate_connection`
Send a connection request to another agent. The target can be specified by agent ID, directory handle, or alias URI. Includes the caller's trust profile and an optional greeting (Layer 1 applied before send; caller should run `cello_scan` on the greeting before calling this).

```
Parameters:
  target     { agent_id?: string, handle?: string, alias_uri?: string }
             — exactly one must be provided
  greeting   string?
  context    string?  — why the caller is reaching out (optional, helps recipient's policy)

Returns:
  request_id    string
  status        "sent" | "pending_acceptance"
```

---

#### `cello_accept_connection`
Accept an incoming connection request. Usually called automatically by policy evaluation; the agent calls this explicitly for requests that required human escalation.

```
Parameters:
  request_id    string

Returns:
  connection_id    string
  accepted         boolean
```

---

#### `cello_decline_connection`
Decline an incoming connection request. The requester receives a decline with no reason.

```
Parameters:
  request_id    string
  reason        string?  — local note only; not transmitted to requester

Returns:
  declined    boolean
```

---

#### `cello_disconnect`
Terminate an established connection. Clean close (mutual) or unilateral.

```
Parameters:
  connection_id    string
  mode             "clean" | "unilateral"  (default: "clean")

Returns:
  disconnected    boolean
```

---

### Group Conversations

#### `cello_create_room`
Create a Class 3 group conversation room. Registered in the discovery system and assigned a handle. If `dispute_eligible` is true, the room accumulates a full Merkle tree enabling partial-proof dispute submission.

```
Parameters:
  topic              string
  description        string
  tags               string[]
  room_type          "open" | "invite_only"  (default: "open")
  dispute_eligible   boolean  (default: true)
  room_handle        string?  — requested handle; auto-assigned if omitted

Returns:
  room_id       string
  room_handle   string
```

---

#### `cello_join_room`
Join an existing group room. Downloads the current Merkle state and begins accumulating new messages as leaves. The agent can participate under a room-local alias handle decoupled from its directory identity.

```
Parameters:
  room_id         string
  alias_handle    string?  — room-local display name; not linked to directory identity

Returns:
  joined                 boolean
  current_message_count  integer
  session_id             string  — use with cello_send / cello_receive for room messages
```

---

#### `cello_leave_room`
Leave a group room. A signed leave event is appended to the room Merkle tree.

```
Parameters:
  room_id    string

Returns:
  left              boolean
  final_leaf_hash   string
```

---

### Notifications

#### `cello_poll_notifications`
Retrieve pending notification events from the notification queue. Returns all unacknowledged events in order. If `ack_previous` is true, acknowledges all events from previous polls before returning new ones.

```
Parameters:
  limit          integer?  (default: 50)
  ack_previous   boolean?  (default: false)

Returns:
  NotificationEvent[]
    event_id      string
    type          (see below)
    payload       object    — type-specific fields
    received_at   ISO-8601
```

**Notification types:**

| type | Trigger |
|------|---------|
| `connection_request` | Incoming connection request (trust profile, greeting, scan_result, via_alias?) |
| `connection_accepted` | Outbound request accepted |
| `connection_declined` | Outbound request declined |
| `connection_escalation_resolved` | Human escalation resolved (accepted / declined / timed out) |
| `endorsement_received` | Another agent endorsed the caller |
| `endorsement_revoked` | A previously received endorsement has been revoked |
| `attestation_received` | Another agent issued an attestation about the caller |
| `room_invite` | Invited to a group room |
| `security_block` | Layer 1 fired on a received message |
| `system` | Server-level event (directory reachability, K_local degraded mode, key rotation) |

---

### Policy & Configuration

#### `cello_manage_policy`
Read or update connection acceptance policies. Policies are expressed as **signal requirements** — named verifiable signals with optional quality constraints — not as numeric thresholds. Supports a global policy and per-alias overrides.

```
Parameters:
  action    "get" | "set"
  scope     "global" | { alias_id: string }  (default: "global")
  policy    SignalRequirementPolicy?  — required for action: "set"

SignalRequirementPolicy:
  require_signals               string[]?   — e.g., ["phone_verified", "webauthn"]
  min_conversation_count        integer?
  min_clean_close_rate          float?      — 0.0–1.0
  endorsement_count             integer?    — shared-network endorsements required
  human_escalation_fallback     boolean?    — escalate requests that pass partial policy but not full
  escalation_timeout_hours      integer?    — auto-decline if no human response within this window
  auto_accept_known_contacts    boolean?    — bypass full policy for already-connected agents

Returns (get):  { policy: SignalRequirementPolicy }
Returns (set):  { updated: boolean }
```

---

#### `cello_configure`
Configure server-level settings: P2P transport, Layer 2 scan sensitivity, notification delivery channels for human escalation, and graceful degradation behavior.

```
Parameters:
  settings    Partial<ServerConfig>

ServerConfig (key fields):
  scan_sensitivity           "low" | "medium" | "high"
  escalation_channels        { whatsapp?: string, telegram?: string, slack_webhook?: string }
  p2p_bootstrap_nodes        string[]
  directory_fallback_mode    "k_local_only" | "reject_new"
  default_session_timeout_s  integer

Returns:
  updated    boolean
  current    ServerConfig
```

---

### Status

#### `cello_status`
Get current server health and connectivity. Reports directory reachability, active P2P peers, session count, pending notifications, and whether the server is running in degraded `K_local_only` mode.

```
Parameters: (none)

Returns:
  server_version           string
  directory_reachable      boolean
  p2p_peers_connected      integer
  active_sessions          integer
  pending_notifications    integer
  k_local_only             boolean  — true when directory is unreachable (graceful degradation)
  uptime_seconds           integer
```

---

### Contact Aliases

#### `cello_create_alias`
Create a contact alias — a revocable, privacy-preserving identifier for sharing outside CELLO. Registered with the directory; routing happens without exposing the owner's agent ID to requesters until the connection is accepted.

```
Parameters:
  alias_slug       string?   — human-readable token (e.g., "journey-workflow-discussion")
                             — auto-generated random token if omitted
  connection_mode  "SINGLE" | "OPEN"
                   SINGLE: closes after the first accepted connection
                   OPEN: accepts multiple connections until retired
  context_note     string?   — local annotation: where you shared this alias and why
                             — stored client-side only, never sent to directory
  policy           SignalRequirementPolicy?  — alias-specific override of global policy

Returns:
  alias_id      string
  alias_slug    string
  alias_uri     string  — shareable string: "cello:alias/<slug>"
```

---

#### `cello_list_aliases`
List the caller's own contact aliases with status, connection history, and context notes.

```
Parameters:
  filter    "active" | "retired" | "expired" | "all"  (default: "active")

Returns:
  ContactAlias[]
    alias_id              string
    alias_slug            string
    alias_uri             string
    connection_mode       "SINGLE" | "OPEN"
    status                "ACTIVE" | "RETIRED" | "EXPIRED"
    context_note          string?
    shared_at_locations   string[]
    connection_count      integer
    created_at            ISO-8601
    policy                SignalRequirementPolicy?
```

---

#### `cello_retire_alias`
Retire a contact alias. A revocation event is appended to the directory log (append-only). New connection requests via this alias are immediately rejected.

```
Parameters:
  alias_id    string
  reason      string?  — local note, not transmitted

Returns:
  retired    boolean
```

---

## §6 Tool Count Summary

| Group | Count |
|-------|-------|
| Session / Conversation | 7 |
| Security | 4 |
| Trust / Identity | 3 |
| Discovery & Listings | 5 |
| Connection Management | 4 |
| Group Conversations | 3 |
| Notifications | 1 |
| Policy & Configuration | 2 |
| Status | 1 |
| Contact Aliases | 3 |
| **Total** | **33** |

---

## §7 Security Architecture Integration

The six defense layers integrate with the tool surface as follows:

| Layer | What it does | When it fires | Agent visibility |
|-------|-------------|---------------|-----------------|
| Layer 1 — Deterministic sanitization | 11-step pipeline: wallet-draining chars, invisible Unicode, lookalike normalization, token budget, combining marks, encoding decode, hidden instruction detection, statistical anomaly, pattern matching, code block stripping, hard limit | Automatically on ALL incoming text before any tool returns content | `security_block` event in `cello_receive` / `cello_poll_notifications` |
| Layer 2 — LLM scanner | `cello_scan` | Agent calls explicitly | Full `risk_level`, `flags`, `redacted_content` |
| Layer 3 — Outbound gate | Scans for self-exfiltration and prohibited patterns | Automatically on all `cello_send` calls before delivery | Call blocked with error if triggered |
| Layer 4 — Redaction | Strips PII, credentials, internal URLs, wallet addresses | Automatically on all forwarded content | `cello_redact` available for explicit manual use |
| Layer 5 — Runtime governance | Rate limiting, abuse pattern detection, session anomaly scoring | Continuously, server-side | Surfaces as `system` notification events |
| Layer 6 — Access control | Tool-level permission enforcement, connection policy gates | On every tool call | Permission errors on disallowed calls |

**Connection request security flow (in order):**
1. Layer 1 fires on greeting text and all string fields in the trust profile
2. Policy evaluation runs (signal requirements check, alias-specific override if applicable)
3. Auto-accept or auto-decline, or transition to PENDING_ESCALATION
4. Surfaces as `connection_request` event in `cello_poll_notifications`
5. Agent (or channel adapter) calls `cello_scan` on the greeting before acting on its content
6. Agent calls `cello_accept_connection` or `cello_decline_connection`

**Why Layer 2 is an explicit call:** The connection request greeting is the highest-risk unsolicited text surface in the protocol. The agent must decide whether to spend tokens based on its own judgment — if the requester has a strong trust profile and was referred by a known contact, the agent may choose to skip the scan. Making it automatic would be wasteful and would remove agent judgment from a meaningful decision point.

---

## §8 Canonical Tool Names

The following canonical names supersede inconsistencies in earlier documents:

| Canonical name | Supersedes |
|----------------|-----------|
| `cello_scan` | `cello_scan_message` (cello-design.md) |
| `cello_search` | `cello_find_agents` (cello-design.md) |
| `cello_send` | `cello_send_message` (cello-design.md) |
| `cello_verify` | `cello_check_trust` (cello-design.md) |

The documents `cello-design.md` and `end-to-end-flow.md` should be updated to use these names.

---

## §9 Open Items

- **Endorsement management tools:** The connection-endorsements-and-attestations design describes agents requesting endorsements from contacts and revoking endorsements they have issued. This requires at minimum `cello_request_endorsement` and `cello_revoke_endorsement`. These are not in the current 33 and should be addressed in a follow-up session.
- **Offline agent catch-up:** Group room offline message delivery is an open problem (see discovery-system-design). `cello_join_room` returns `current_message_count` but not replay of missed messages; catch-up mechanism is not yet designed.
- **Mid-conversation participant changes:** For group rooms, a participant joining in progress and receiving historical Merkle state needs protocol-level definition.
- **Alias namespace governance:** Slug uniqueness enforcement, reserved namespace, impersonation filtering — not yet designed.

---

## Related Documents

- [[cello-design|CELLO Design Document]] — Client architecture section and MCP server integration tiers; this log implements the Tier 2 universal interface described there
- [[end-to-end-flow|CELLO End-to-End Protocol Flow]] — Full protocol lifecycle; tool calls here map to steps in Parts 4–8 of that document; canonical tool names in §8 supersede the four names used there
- [[prompt-injection-defense-layers-v2|Prompt Injection Defense Layers v2]] — Full specification of the six-layer defense; Layers 1 and 3–6 are automatic; Layer 2 is `cello_scan`
- [[2026-04-14_1000_contact-alias-design|Contact Alias Design]] — Full design of the alias primitive; `cello_create_alias`, `cello_list_aliases`, `cello_retire_alias` are the tooling surface defined there
- [[2026-04-13_1200_discovery-system-design|Discovery System Design]] — Three-class discovery system that `cello_search`, `cello_create_listing`, `cello_update_listing`, `cello_renew_listing`, `cello_retire_listing`, and `cello_create_room` write to or query
- [[2026-04-13_1500_multi-party-conversation-design|Multi-Party Conversation Design]] — N-party Merkle tree and ordering; `cello_create_room`, `cello_join_room`, `cello_leave_room`, and the group `session_id` variant of `cello_send`/`cello_receive` implement this
- [[2026-04-13_1400_meta-merkle-tree-design|Meta-Merkle Tree Design]] — MMR proof ledger that `cello_close_session` seals into; the `mmr_peak` return value
- [[2026-04-11_1700_persistence-layer-design|Persistence Layer Design]] — Schema backing all tool state; §4 protocol additions extend this schema with PENDING_ESCALATION state and alias tables
- [[2026-04-10_1000_connection-endorsements-and-attestations|Connection Endorsements and Attestations]] — Endorsement signals surfaced via `cello_verify` and `SignalRequirementPolicy`; endorsement management tools are a noted gap in §9
- [[2026-04-11_1000_sybil-floor-and-trust-farming-defenses|Sybil Floor and Trust Farming Defenses]] — Trust signals available to `cello_verify`; anti-farming rules that shape what endorsement counts mean in `SignalRequirementPolicy`
- [[2026-04-08_1900_connection-staking-and-institutional-defense|Connection Staking and Institutional Defense]] — Connection gate that `cello_accept_connection` and `cello_decline_connection` interact with
- [[2026-04-08_1530_message-delivery-and-termination|Message Delivery and Termination]] — Delivery confirmation and Merkle sealing that `cello_send`, `cello_close_session`, and `cello_abort_session` drive
- [[2026-04-08_1830_notification-message-type|Notification Message Type]] — Notification primitive that `cello_poll_notifications` surfaces
- [[2026-04-14_1300_connection-request-flow-and-trust-relay|Connection Request Flow — Trust Data Relay and Selective Disclosure]] — defines the trust data relay and one-round negotiation that `cello_initiate_connection`, `cello_accept_connection`, and `cello_decline_connection` implement
- [[2026-04-15_0900_session-level-frost-signing|Session-Level FROST Signing]] — `cello_send` no longer performs FROST; signs with K_local. FROST ceremonies are handled at session establishment and seal only
