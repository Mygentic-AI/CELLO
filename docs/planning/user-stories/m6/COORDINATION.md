# M6 Agent Coordination Log

This file is the coordination point for all agents working on M6 stories. Because Claude Code has no fan-in mechanism, agents cannot see each other's work directly. Each agent appends an entry here when they have a dependency on another agent, a blocker, or completed work that others need to know about.

**Format for each entry:**
- Date/time at the top (YYYY-MM-DD HH:MM UTC)
- Agent/story identity
- What is blocked or waiting, and why
- What has already been done that is relevant to the blocker
- What the other agent needs to do (if known)

Read this file at the start of every session. Append, never overwrite.

---

## Migration Version Registry

M6 migrations start at **V24**. All version numbers are reserved by OPS-AGENT-000 before parallel implementation begins. No story may claim a migration version not listed here.

| Version | Story | Table/Purpose |
|---|---|---|
| V24+ | OPS-AGENT-000 | Reserved — schema design produced by OPS-AGENT-000 |

This table is populated when OPS-AGENT-000 closes.

---

## Constraints

**CONSTRAINT: registrations table single-writer assumption.** The Operations Agent writes only from us-east-1. The partial unique index `UNIQUE (phone_stub_hash) WHERE state NOT IN (terminal)` is enforced locally per-node in logical replication — it does NOT prevent cross-region duplicates. Multi-region Ops Agent deployment requires schema redesign. See OPS-AGENT-000 `replication_safety` note.

**CONSTRAINT: npm @cello scope.** Must be claimed on Day 0 before any publish work begins. If contested, fallback to `@cello-protocol/interfaces` and `@cello-protocol/connect`. REPOSPLIT-002 AC-000 is blocked until this is resolved.

**CONSTRAINT: External client → directory/relay transport path.** The directory's libp2p port (4000) is NOT exposed through the ALB. The relay is on a private IP with no external path. All M0-M4 tests ran in-process. Before REPOSPLIT-002 AC-003 or DEMO-001 AC-004b can pass, the transport layer must support external clients connecting via WebSocket through the ALB. See REPOSPLIT-002 `transport_path_prerequisite` implementation note for resolution options.

---
