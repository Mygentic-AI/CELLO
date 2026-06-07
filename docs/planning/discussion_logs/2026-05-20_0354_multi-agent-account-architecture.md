---
name: Single-Account, Multi-Agent Architecture
type: design
date: 2026-05-20
topics: [identity, multi-agent, onboarding, trust-signals, account-id, agent-id, aggregation]
status: active
description: Definitive source on the 1:N Account-to-Agent mapping, defining how identity anchoring, onboarding, and trust signal aggregation work.
---

# Single-Account, Multi-Agent Architecture

## 1. Identity Hierarchy
The CELLO identity model is anchored by a unique `AccountID` (verified via Phone/Email) which owns a collection of discrete `AgentIDs`.

*   **AccountID (Human Anchor):** Created during the registration ceremony (M6). Proven via OTP/Email. Used for portal login, social recovery, and succession.
*   **AgentID (Cryptographic Entity):** A discrete entity with a unique `primary_pubkey` (via FROST DKG), unique `K_local` (Ed25519), and unique `agent_id`.
*   **1:N Mapping:** The `agent_registrations` table maps `AccountID` -> `[AgentID_1, AgentID_2, ...]`.

> **Note (2026-05-20):** `agent_registrations` was never wired into production code and is dropped in V16. `agent_profiles` (V9) is the authoritative agent identity table. Any implementation of this 1:N mapping should target `agent_profiles`.

```
Human Operator
      │
      ▼
+---------------------+
| AccountID (Verified)| <--- Anchored by Phone/Email (M6)
+----------+----------+
           │
  +--------+--------+--------+
  │                 │        │
+---------+    +---------+ +---------+
| Agent_A |    | Agent_B | | Agent_N | <--- Each is a unique DKG ceremony
+---------+    +---------+ +---------+
```

## 2. Onboarding Flow (M6)
Registration is entry-point agnostic (Bot-first or Portal-first).

1.  **Ceremony Initiation:** User provides Phone/Email.
2.  **Verification:** OTP/Email confirmation generates an `AccountID`.
3.  **Agent Provisioning:** The first DKG ceremony creates `Agent_A` and binds it to the `AccountID`.
4.  **Multi-Agent Scaling:** Subsequent registrations using the *same* verified `AccountID` trigger new DKG ceremonies for `Agent_B`, `Agent_N`, etc., linked to the existing `AccountID`.

## 3. Trust Signal Aggregation
To prevent Sybil attacks and reputation farming, trust signals are computed at the `AccountID` level, but isolated at the `AgentID` level.

*   **Logic:** The Directory performs an asynchronous aggregation of signals (total successes, pseudonym age, clean flags) across all `AgentIDs` mapped to a single `AccountID`.
*   **Protocol Transparency:** When `Agent_B` connects to a counterparty, the counterparty receives a **Certificate of Aggregate Trust** (signed by the directory).
*   **Privacy Invariant:** The receiver sees the *aggregated* account trust level but cannot derive *which* specific agent within that account contributed to those signals.

```
+-------------------------------------------------------------+
|  Directory Aggregation (Internal Logic)                     |
|                                                             |
|  Agent_A (Successes: 10)  +  Agent_B (Successes: 20)        |
|            │                          │                     |
|            └────────────┬─────────────┘                     |
|                         ▼                                   |
|               AccountID (Total: 30)                         |
|                         │                                   |
+-------------------------+-----------------------------------+
                          │
                          ▼ (Protocol Exposure)
               [Certificate of Aggregate Trust]
               "Agent_B belongs to AccountID (Total Trust: 30)"
```

## 4. Trust Signal Sharing (Social Proofs)
* **Shared Signal Store:** Trust signals (e.g., GitHub OAuth, LinkedIn verification, Device Attestation) are stored at the `AccountID` level in the directory, *not* the `AgentID` level.
* **Independent Inheritance:** When `Agent_B` is provisioned under an existing `AccountID`, it instantly inherits the verified status of all social proofs already linked to that account.
* **Privacy-Preserving Disclosure:** The agent's client filters these signals via the `SignalRequirementPolicy` (M3). An agent can choose to disclose a *subset* of account-level signals to a counterparty, maintaining anonymity (e.g., sharing "GitHub verified" without revealing "this is the same human who verified their phone number").
* **Continuity:** If an agent rotates its `K_local`, it remains linked to the same `AccountID`, ensuring social proofs (which are immutable ledger entries) persist across the entire agent lifecycle.

## 5. M4 Persistence Foundation Gaps
* **Schema Evolution:** The current `agent_profiles` schema (V9) is Agent-centric with `k_local_pubkey` as the primary lookup. It lacks an `AccountID` foreign key to facilitate signal aggregation across a multi-agent account.
* **Migration Strategy:** An M5.1 migration is required to introduce a `user_accounts` table, update `agent_profiles` with an `account_id` column, and refactor existing trust signal tables to allow aggregation by `AccountID` rather than `AgentID`.
* **Constraint Enforcement:** Current schema enforces `k_local_pubkey` uniqueness at the Agent level; the new schema must enforce that multiple `AgentIDs` map to one `AccountID` without collapsing their cryptographic independence.

## 6. Key Design Requirements
*   **Independence:** No agent is dependent on another for its DKG ceremony. Compromising `Agent_A` does not leak keys for `Agent_B`.
*   **Continuity:** Pseudonym track records (via `HKDF` salt derivation from the identity key) must remain stable even if individual agents are retired or rotated.
*   **Observability:** The portal must surface the account-level trust profile while listing individual agent health.

## 5. References
*   [[agent-client]] — Pseudonym derivation and FROST ceremony mechanics.
*   [[server-infrastructure]] — Directory-side aggregation and `agent_profiles` table definition (`agent_registrations` was dropped in V16; `agent_profiles` V9 is authoritative).
*   [[2026-04-16_1400_companion-device-architecture]] — Companion device vs agent session differentiation.
*   [[2026-04-08_1600_data-residency-and-compliance]] — Account deletion and tombstoning requirements.
*   [[2026-06-07_1221_sybil-confirm-shortcut-audit|Sybil Defense Audit — CONFIRM Shortcut and Per-Phone Agent Cap]] — M6 implementation audit confirming the 1:N account-to-agent design is correctly wired via `user_accounts → agent_profiles.account_id`; identifies missing per-account cap as the one gap.
