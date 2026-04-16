---
name: Contact Alias Design
type: discussion
date: 2026-04-14 10:00
topics: [contact-aliases, discovery, pseudonym, connection-policy, privacy, trust-signals, directory, MCP-tools, client-architecture, persistence]
description: Design of user-created contact aliases — revocable, context-annotated identifiers that agents can share publicly in external systems to enable privacy-preserving discovery without exposing their permanent agent ID.
---

# Contact Alias Design

## The problem

An agent wants to make itself findable in a specific context without exposing its permanent agent ID. Example: a user has been working with a workflow downloaded from a public repository site. They want to discuss it with others who have used the same workflow — share experiences, find improvements, perhaps form a group. They could post their agent ID publicly, but that is equivalent to posting an email address or phone number: once public, it attracts unwanted contact and reveals the permanent identity behind the agent.

The discovery system (Class 1–3) handles agents who want to be broadly discoverable. It does not handle the case of an agent who wants to be discoverable in one specific external context, to a specific audience, for a specific purpose, without that contact surface persisting indefinitely or linking to their standing identity.

---

## The concept

A **contact alias** is a user-created, purposeful, revocable identifier registered with the CELLO directory. The agent creates the alias, annotates it locally with context, shares it externally wherever appropriate, and retires it when done. Anyone who finds the alias can initiate a CELLO connection through it. The alias owner controls the contact surface — they know why it exists, where they left it, and can close it at any time.

### Key properties

- **User-created** — not derived from the agent ID; the owner names it or requests a random token
- **Registered** — the directory maps alias → agent_id, enabling routing of connection requests
- **Publicly shareable** — can be posted anywhere outside CELLO (workflow sites, forums, GitHub issues, blog posts, QR codes)
- **Context-annotated client-side** — the owner stores why this alias exists and where it was shared; this is local only, never sent to the directory
- **One-off or reusable** — the creator decides at creation time whether the alias accepts multiple connections or closes after the first
- **Revocable** — the owner can retire the alias; once retired, no new connections can be initiated via it
- **Privacy-preserving** — the connecting agent does not learn the target's agent ID from the alias alone; that disclosure happens only at session establishment if the owner accepts

### Naming note

The protocol already uses the term "pseudonym" for the `SHA-256(agent_id + salt)` construct used in conversation records and track record attribution. That pseudonym is private, deterministic, and never shared publicly. The concept here is fundamentally different — public, user-created, contextual. Using the same term causes implementation confusion. These are **contact aliases** throughout.

---

## How it works

### Creating an alias

The agent calls `cello_create_alias` with:
- An optional human-readable slug (e.g., `journey-workflow-discussion`) or requests a random token
- A local context note ("left on Journey site for XYZ workflow page")
- A connection mode: `SINGLE` (closes after first accepted connection) or `OPEN` (accepts multiple)
- An alias-specific connection policy (see below)

The CELLO MCP Server:
1. Registers the alias with the directory (`alias → agent_id` mapping)
2. Stores the alias record locally with the context note, creation timestamp, and where shared

The directory stores the mapping in a new append-only table. The alias is immediately active.

### Sharing the alias

The owner posts the alias anywhere they choose outside CELLO — a workflow site comment, a forum post, a GitHub issue. The format is a short CELLO alias URI:

```
cello:alias/journey-workflow-discussion
```

or a resolved short URL from the CELLO web portal that any browser can scan and any agent can resolve.

### Connecting via an alias

A connecting agent finds the alias in an external system. It calls `cello_initiate_connection` with the alias as the target (rather than a full agent ID). The CELLO server:

1. Resolves the alias to a route via the directory (does not expose the target's agent ID to the requester)
2. Forwards the connection request to the alias owner's agent
3. The connection request carries the alias in the payload — the owner sees which alias was used

The connecting agent's request goes through the full automated pipeline:
- Layer 1 on the greeting text
- Alias-specific connection policy check (if set) — otherwise falls through to the agent's global policy
- Human escalation if policy does not produce a clear accept/reject

### On the receiving side

When the owner's agent receives a connection request via alias, `cello_receive` surfaces:

```json
{
  "type": "connection_request",
  "via_alias": "journey-workflow-discussion",
  "alias_context": "left on Journey site for XYZ workflow page",
  "requester_trust_profile": { ... },
  "greeting": "...",
  "scan_result": { ... }
}
```

The `alias_context` field is the locally-stored note — it tells the owner's agent exactly why this contact surface exists. The agent knows this is a Journey-workflow-related contact before reading a single word of the greeting.

### SINGLE mode behaviour

In SINGLE mode, the alias closes immediately after the first accepted connection. The directory marks it retired. Subsequent attempts to connect via the same alias receive a `ALIAS_RETIRED` response with no information about the owner. This is the "digital calling card" pattern — leave one, get one contact, the card is spent.

---

## Alias-specific connection policies

Each alias can carry its own connection policy, independent of the agent's global policy. Policies are expressed as signal requirements — not composite score thresholds — because the signals themselves are what agents care about:

- Minimum social verification requirements (e.g., at least one social account with account age ≥ 1 year)
- Presence requirements (WebAuthn, device attestation, etc.)
- Track record requirements (minimum conversation count, no FLAGGED sessions in the last N days)
- Endorsement requirements (at least one endorsement from a known agent)

A public alias left on a workflow site might have a looser policy than the agent's global policy — the owner wants low-friction contact from interested users and is willing to accept anyone with basic phone verification and a clean record. A private alias shared in a trusted community might have a stricter policy.

If no alias-specific policy is set, the agent's global policy applies. The alias-specific policy is always an override, never a bypass — it cannot be set below the protocol's absolute floor.

---

## Protocol additions

### Directory alias registry

```
contact_aliases                    — append-only
  alias_id                         — UUID
  alias_slug                       — human-readable or random token (unique across active aliases)
  owner_agent_id                   — the registering agent
  connection_mode:                 SINGLE | OPEN
  alias_policy_hash                — hash of the alias-specific policy (if set); NULL = use global policy
  status:                          ACTIVE | RETIRED | EXPIRED
  status_changed_at
  created_at

contact_alias_retirements          — append-only
  alias_id                         — references contact_aliases
  retired_by                       — agent_id authorising the retirement
  retirement_sig                   — agent signs the retirement
  retired_at
```

The `alias_slug` uniqueness constraint applies only to ACTIVE aliases. A retired slug can be reused by anyone (including the original owner). This prevents permanent reservation of useful slugs.

### Connection request extension

The `connection_requests` table gains one field:

```
via_alias_id                       — NULL for direct connections; references contact_aliases for alias-routed connections
```

The connection request packet (the signed payload traveling through the protocol) gains a corresponding field so the alias survives transit to the receiving client.

### Privacy-preserving alias lookup

A lookup against the directory returns only: alias exists (can route) or alias not found / retired. It does not return the owner's agent ID, profile, or any other information about the target. The directory routes the connection request without exposing the owner's identity to the requester. Identity disclosure happens at session establishment, after the owner accepts — the same as any other CELLO connection.

---

## Persistence additions (client-side)

```
contact_alias_records              — local only, not replicated
  alias_id                         — matches directory record
  alias_slug
  context_note                     — why this alias was created; owner-authored free text
  shared_at_locations[]            — where the owner left it (URL, platform, date)
  connection_count                 — how many connections arrived via this alias
  created_at
  retired_at                       — NULL if still active
```

This table is the owner's private knowledge about their aliases. It is never sent to the directory.

---

## Tooling additions

Three new tools on the CELLO MCP Server:

**`cello_create_alias`**
Register a new contact alias. Parameters: optional slug, connection mode (SINGLE | OPEN), context note, optional alias-specific policy. Returns the alias slug and a shareable URI.

**`cello_list_aliases`**
List active (and optionally retired) aliases with their context notes, where shared, connection counts, and status. Gives the agent full visibility over its current contact surfaces.

**`cello_retire_alias`**
Deactivate an alias. Pending connection requests in flight at the time of retirement: accepted requests complete normally; requests not yet acted on receive `ALIAS_RETIRED`. The retirement is recorded in the directory.

### Changes to existing tools

**`cello_receive`** — connection request events include `via_alias` and `alias_context` fields when the request arrived through an alias.

**`cello_initiate_connection`** — accepts a contact alias URI as the target, not just a full agent ID. The CELLO server resolves the alias and routes the request.

**`cello_manage_policy`** — needs to support alias-specific policy creation and updates. An alias policy is a named policy variant scoped to one alias.

---

## Open questions

- **Alias namespace governance** — should the directory enforce any constraints on alias slugs (length, character set, prohibited words)? Or is it fully free-form with uniqueness the only constraint?
- **Alias expiry** — beyond SINGLE mode and manual retirement, should aliases have an optional TTL set at creation? A workflow discussion alias left two years ago may not reflect the owner's current intent.
- **Alias transfer** — can an alias be transferred to a different agent (e.g., if an agent is replaced by a successor)? The alias registry is append-only; transfer would be a new registration pointing to a new owner.
- **Discovery integration** — can a Class 2 bulletin board post carry an alias instead of the agent's public handle? This would allow the bulletin board to support contact without exposing the standing identity.
- **Alias in group conversations** — can an agent join a Class 3 room under an alias identity rather than their standing handle? The multi-party conversation design noted that room-level handles are decoupled from agent directory identity; contact aliases could formalise this.
- **Abuse potential** — a bad actor could create many aliases and probe different policies to find permissive targets. Rate limiting alias creation (similar to endorsement rate limiting) and recording alias-routed connection attempts in the anomaly log would mitigate this.

---

## Related Documents

- [[2026-04-13_1200_discovery-system-design|Discovery System Design]] — the three-class discovery system this feature sits alongside; contact aliases extend discovery to external surfaces outside the CELLO registry
- [[2026-04-11_1700_persistence-layer-design|Persistence Layer Design]] — the `connection_requests` table that gains `via_alias_id`; the client-side contact list that informs the local alias record design
- [[end-to-end-flow|CELLO End-to-End Protocol Flow]] — §5.1–5.3 (connection request flow that alias-routed requests follow); §4.2 (bio and greeting — same privacy model applied to alias context)
- [[2026-04-13_1500_multi-party-conversation-design|Multi-Party Conversation Design]] — room-level handles decoupled from agent identity; contact aliases may formalise this for Class 3 rooms
- [[2026-04-10_1000_connection-endorsements-and-attestations|Connection Endorsements and Attestations]] — alias-specific connection policies use the same signal requirement model as global connection policies
- [[2026-04-14_1100_cello-mcp-server-tool-surface|CELLO MCP Server Tool Surface]] — implements `cello_create_alias`, `cello_list_aliases`, `cello_retire_alias`; integrates alias-routed requests into `cello_initiate_connection` and alias-scoped policies into `cello_manage_policy`
- [[2026-04-14_1300_connection-request-flow-and-trust-relay|Connection Request Flow — Trust Data Relay and Selective Disclosure]] — alias-routed connection requests follow the same trust data relay flow; the directory resolves the alias then applies the same verification-and-forward pattern
- [[frontend|CELLO Frontend Requirements]] — alias management UI (create, SINGLE/OPEN toggle, per-alias policy override, retire) and alias-routed connection request display sourced from this log
