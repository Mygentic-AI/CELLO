---
name: Sybil Defense Audit — CONFIRM Shortcut and Per-Phone Agent Cap
type: discussion
date: 2026-06-07 12:21
topics: [sybil-defense, registration, confirm-shortcut, account-linkage, per-phone-cap, operations-agent, m6, m7]
status: resolved
description: Audit of whether unlimited-agents-per-phone was intentional, whether the CONFIRM shortcut creates orphaned registrations or properly linked accounts, whether M7 addresses this, and what gap (if any) remains.
---

# Sybil Defense Audit — CONFIRM Shortcut and Per-Phone Agent Cap

## Context

The CELLO registration flow:

1. User messages the Telegram bot → completes phone OTP → gets a CELLO token
2. User installs cello-mcp with that token → FROST DKG → agent registered
3. If the user messages the bot again (same phone), they receive a warning: "you already have an agent registered"
4. User replies CONFIRM → passes through full re-verification (phone contact share + email OTP) → gets a new token
5. User can repeat steps 2–4 indefinitely

Questions audited: (1) Was unlimited-agents-per-phone intentional? (2) Does CONFIRM create orphaned registrations or linked accounts? (3) Does M7 address this? (4) What gap, if any, remains?

---

## (1) Design Intent — Multiple Agents Per Phone Is Intentional

**Finding: explicitly by design. No cap was ever specified.**

OPS-AGENT-001 AC-005b is the direct statement of intent:

> "two agents, same account … after the first flow: one account row exists with phone_stub_hash='abc123'; one agent_profile linked to it; after the second flow: the same account row exists (no duplicate created); a second agent_profile is linked to the same account; the accounts table has exactly one row for this phone_stub_hash"

The Sybil defense doc (`2026-04-11_1000_sybil-floor-and-trust-farming-defenses.md`) is explicit that phone is not a hard gate:

> "The only day-one registration requirement is phone OTP via WhatsApp or Telegram. Everything else … is an optional trust signal that makes your agent more trustworthy if you have it. No signal is a gate."

And on the structural limit of phone-as-identity:

> "The same-owner endorsement rule depends on phone hash = owner identity … This is not a bug in implementation — it is architectural. The owner identity model equates 'phone number' with 'person.' … The same-owner rule remains useful against casual self-endorsement but should not be treated as a Sybil defense. The real Sybil defense must come from graph analysis, economic cost, and trust propagation."

The M7 outline explicitly names the multi-agent-per-phone use case: *"The most common early use case: a single human operator running two agents on the same machine and having them talk to each other, without manual env-var ceremony."* No per-phone cap was ever specified anywhere in the protocol design.

**Conclusion:** Unlimited agents per phone was intentional. The design anticipated it and built account linkage (via `user_accounts` → `agent_profiles.account_id`) to make it trackable.

---

## (2) CONFIRM Implementation — Linked, Not Orphaned

**Finding: accounts are properly linked. The premise "N orphaned registrations" does not match the implementation.**

### What CONFIRM actually does

Reading `packages/operations-agent/src/registration/engine.ts` lines 229–264:

```typescript
if (this.#pendingReregistration.has(from) && message === "CONFIRM") {
    this.#pendingReregistration.delete(from);
    record = await this.#stateMachine.handleNewUser(from, ...);
```

`handleNewUser()` creates a new `RegistrationRecord` and transitions to `AWAITING_CONTACT`. The user must **share their Telegram contact** (live device interaction), then complete **email OTP**. CONFIRM skips the duplicate-check warning gate — it does not skip phone or email verification. No token is issued on CONFIRM alone.

### Account linkage path

`linkAgentToAccount()` in `packages/directory/src/pre-auth-token-repository.ts`, called during FROST DKG Round 1:

```typescript
SELECT account_id FROM user_accounts WHERE phone_stub_hash = $1
// found → use existing account_id
// not found → INSERT INTO user_accounts ON CONFLICT DO NOTHING
UPDATE agent_profiles SET account_id = $account_id WHERE k_local_pubkey = $kLocalPubkey
```

Same `phone_stub_hash` → same `user_accounts` row → same `account_id` on every `agent_profile`. The directory can query "all agents for account X" at any time. The multi-agent-per-owner design is fully wired.

### In-memory gap (documented, not a security hole)

`#pendingReregistration` is in-memory. A process restart clears it. After restart the warning is re-sent on the next message. This is documented in the engine comment: *"safe and expected per AC-003."* The CONFIRM window does not survive restarts, but that is intentional.

---

## (3) M7 Coverage — No

M7 does not touch registration, phone verification, or ownership linkage. The outline is explicit:

> **NOT in scope:**
> - Registration ceremony changes (agents still register the same way)
> - Directory/relay Flyway schema changes (no new server-side migrations in M7)

M7 is a client-side multiplexing layer. It takes N already-registered K_locals and manages them locally on one MCP server. The server-side account model — `user_accounts`, `agent_profiles.account_id`, per-phone counts — is completely unchanged by M7.

---

## (4) Gap Assessment

### What is NOT a gap

- CONFIRM does not create orphaned registrations — account linkage is implemented and tested
- Multiple agents per phone is intentional — required for M7, AC'd in OPS-AGENT-001
- CONFIRM requires full physical re-verification — it is not a bypass of phone proof

### What IS a gap

There is no hard cap on agents per account. The CONFIRM flow imposes meaningful friction (re-warning, 30-minute TTL window, full re-verification requiring a real device), but it does not enforce a maximum. The account linkage enables future enforcement — the data model is ready — but nothing enforces a cap today.

The secondary Sybil defense layers (conductance scoring, diminishing returns per counterparty, device attestation, temporal burst detection) are documented future work in the Sybil defense doc and none shipped in M6. The doc's own cost-analysis table assumes these are layered independently *as infrastructure allows*. Without them, a single operator can register N agents from one phone and the network cannot distinguish legitimate multi-agent use from low-cost trust farming.

### Is there an exploitable window?

Narrower than a raw reading suggests. Each additional agent registration requires:
- Re-warning → 30-minute window → user must message bot again
- Full Telegram phone contact share (live device interaction, cannot be automated)
- Email OTP verification

This is not scriptable. The per-phone friction is real. The larger concern in the Sybil doc is mass multi-SIM attacks (1,000 phones), not one-phone/many-agents, and account linkage makes the single-phone multi-agent pattern fully visible to graph analysis when it ships.

However: once registered, N agents from the same account are indistinguishable to the network until conductance scoring runs. Without it, a single operator could build N agents from one phone and use them for circular endorsement or trust farming. Account linkage makes this *detectable in future* but not *prevented today*.

### Minimum story to close it

**Per-account agent cap enforced at the directory layer, configurable, defaulting to 5.**

**Where to enforce:** In `linkAgentToAccount()` in `packages/directory/src/pre-auth-token-repository.ts`, before linking:

```sql
SELECT COUNT(*) FROM agent_profiles WHERE account_id = $account_id
```

If `count >= CELLO_MAX_AGENTS_PER_ACCOUNT` (env var, default 5), return a new error code `ACCOUNT_AGENT_CAP_EXCEEDED`. This propagates through `parseDkgRound1Response` in the client, surfaces as a structured rejection, and the operations agent relays the rejection message to the user.

**Why directory layer (not operations-agent layer):** The operations-agent does not have SELECT access on `agent_profiles` (scoped to `registrations` and `pre_authorization_tokens` only — SI-001 in OPS-AGENT-000). Checking the cap in the engine would require either: crossing the role boundary, or adding a new `getAgentCount(phoneStubHash)` method to `PreAuthorizationClient`. Both add surface and complexity. Enforcing at the directory during DKG Round 1 is the correct boundary — it's the moment when a new agent is claiming a pre-auth token with a known `phone_stub_hash`, and the directory already owns `user_accounts` → `agent_profiles`.

**Schema changes needed:** None. `user_accounts.account_id` → `agent_profiles.account_id` FK is already present and queryable.

**Story scope:**
- New env var `CELLO_MAX_AGENTS_PER_ACCOUNT` (default: 5) on the directory ECS task definition
- Count check in `linkAgentToAccount()` before inserting/updating
- New DKG rejection code `ACCOUNT_AGENT_CAP_EXCEEDED`
- Client-side parser handles the new error code (same pattern as `PRE_AUTH_TOKEN_CONSUMED` etc.)
- Operations-agent sends user message on token consumption failure with this code
- `registration.account.agent_cap_reached` log event at WARN with `{ accountId, agentCount, cap, correlationId }`
- Unit + integration tests (count at cap, count below cap, count above cap edge case if cap is reduced)

**Priority:** Low-urgency for current beta (real friction already exists, attack requires device presence, account linkage makes it auditable). Should be in backlog before any self-serve growth push where untrusted users can register without human onboarding contact.

---

## Related Documents

- [[2026-04-11_1000_sybil-floor-and-trust-farming-defenses|Sybil Floor and Trust Farming Defenses]] — canonical Sybil defense design; phone as non-gate; full secondary defense stack; the design this audit verifies against
- [[2026-04-14_1500_deprecate-trust-seeders-and-trustrank|Deprecate Trust Seeders and TrustRank]] — TrustRank deprecated; remaining stack (conductance, diminishing returns, device attestation) documented as future work
- [[2026-05-20_0354_multi-agent-account-architecture|Single-Account, Multi-Agent Architecture]] — definitive source on the 1:N Account-to-Agent mapping; the `user_accounts` → `agent_profiles.account_id` design confirmed here as correctly implemented
- [[2026-05-13_1549_onboarding-and-operations-agent-architecture|Onboarding and Operations Agent Architecture]] — architecture of the registration state machine and CONFIRM flow; the engine.ts CONFIRM path audited here is specified in this document
- [[user-stories/m7/outline|M7 — Multi-Agent MCP Server]] — multi-agent MCP server; confirms registration ceremony is NOT in M7 scope
