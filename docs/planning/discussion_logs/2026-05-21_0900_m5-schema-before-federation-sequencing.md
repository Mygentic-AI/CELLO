---
name: M5 Schema-Before-Federation Sequencing
type: discussion
date: 2026-05-21
topics: [m5, infrastructure, postgresql, federation, replication, schema, sequencing, ACCOUNT-001, FEDERATION-001]
status: decided
description: Decision to deploy ACCOUNT-001 schema changes on a single-node baseline before activating 3-region logical replication, and the rationale for placing both in M5 rather than M4.
---

# M5 Schema-Before-Federation Sequencing

## The Decision

M5 schema changes (CELLO-ACCOUNT-001: `user_accounts` table + `account_id` FK on `agent_profiles`) must be deployed and validated on a single-node Postgres instance before the 3-region logical replication mesh is activated (CELLO-FEDERATION-001). These are two separate stories with an explicit dependency: FEDERATION-001 depends on ACCOUNT-001.

## Why Sequential, Not Simultaneous

PostgreSQL logical replication replicates DML (data changes) but not DDL (schema changes). Applying schema migrations and establishing replication at the same time risks:

- Split-brain scenarios where nodes have divergent schemas mid-replication-setup
- FK constraint violations on receiving nodes whose replication streams are still syncing
- Broken replication slots that are difficult to recover from

The safe path: schema is deployed, tested, and stable on one node first. The other two regional RDS instances clone the validated schema. Replication then flows cleanly with no DDL conflicts.

## Two-Phase Execution

**Phase 1 — Single-Node Schema Validation (ACCOUNT-001)**
- Implement `user_accounts` table + `account_id` FK on `agent_profiles` via Flyway migrations V16/V17
- All `CELLO_ENV=local` integration tests pass on a single Docker Compose node
- Exit gate: schema deployed, hash-chain verified, RLS enforced, BIGINT_COLUMNS updated

**Phase 2 — Topology Expansion (FEDERATION-001)**
- Provision two additional regional RDS instances (eu-central-1, ap-northeast-1)
- Clone the validated Phase 1 schema to both new instances
- Establish VPC Peering and configure logical replication publications and subscriptions
- Exit gate: 3-node federation live, cross-signing checkpoints, replication verified

## Why M5 Not M4

M4's mandate was getting the single-node persistence foundation correct — schema integrity, RLS, hash chain, KMS encryption. The `user_accounts` table has no rows to populate until the M6 registration ceremony creates them. Introducing it in M4 would have been premature schema — a table with no writers.

M5 is the right milestone because it is when the infrastructure becomes a real network. Schema, replication, and ECS deployment all land together in M5 as a coherent production baseline.

## References

- [[2026-05-14_1853_milestone-sequence-revision]] — original decision placing federation in M5 not M4
- [[2026-05-20_0354_multi-agent-account-architecture]] — AccountID hierarchy and user_accounts design
- CELLO-ACCOUNT-001 — schema story; Phase 1
- CELLO-FEDERATION-001 — replication story; Phase 2; depends_on ACCOUNT-001
