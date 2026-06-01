# M7 Agent Coordination Log

This file is the coordination point for all agents working on M7 stories. Because Claude Code has no fan-in mechanism, agents cannot see each other's work directly. Each agent appends an entry here when they have a dependency on another agent, a blocker, or completed work that others need to know about.

**Format for each entry:**
- Date/time at the top (YYYY-MM-DD HH:MM UTC)
- Agent/story identity
- What is blocked or waiting, and why
- What has already been done that is relevant to the blocker
- What the other agent needs to do (if known)

Read this file at the start of every session. Append, never overwrite.

---

## Parallel Implementation Tracks

M7 has two independent tracks that can execute simultaneously from day one:

| Track | Stories | What it delivers |
|-------|---------|-----------------|
| **Server track** | MULTI-001 → MULTI-002 → MULTI-003 + MULTI-004 (parallel) | Named agent storage, multi-client registry, per-connection routing, lifecycle tools |
| **Client track** | MULTI-005 → MULTI-006 | Presence detection wired into CelloClient, retry queue, nonce deduplication |

**Convergence point:** MULTI-007 (notifications) depends on both tracks — it needs per-connection state (from MULTI-003) AND presence events (from MULTI-005). After MULTI-007 merges, MULTI-008 (integration gate) exercises everything.

**If working sequentially (one agent):**

```
Phase 1: MULTI-001, MULTI-005     (parallel, no deps)
Phase 2: MULTI-002                (needs 001)
Phase 3: MULTI-003, MULTI-004, MULTI-006  (003/004 need 002; 006 needs 005)
Phase 4: MULTI-007                (needs 003 + 005)
Phase 5: MULTI-008                (needs all)
```

**Critical path:** MULTI-001 → MULTI-002 → MULTI-003 → MULTI-007 → MULTI-008.

---

## Migration Version Registry

No database migrations in M7. This section is N/A.

---

## Current Status

**All stories are in draft / not yet implemented state as of 2026-05-28.**

The sprint review (2026-05-28) returned BLOCKED. All review findings have been addressed in the story YAML files. Implementation agents may now begin once a second sprint review confirms APPROVED.

---

## Coordination Entries

<!-- Append entries below as implementation proceeds. Format:
Date/Time | Agent/Story | Status | Notes
-->

### 2026-05-28 — Sprint review findings resolved

Reviewer: cello-sprint-reviewer (run 1: 32 findings; all resolved in story YAML edits)

Key design decisions that implementation agents must know:

1. **Nonce placement is the signed envelope wrapper** (sibling field alongside TBS), NOT in Structure 1 TBS. This keeps `protocol-types` out of M7 scope. See `2026-05-27_1400_multi-agent-mcp-planning.md` for the authoritative decision.

2. **`peer_unreachable` session state is now `transport_lost`**. `packages/client/src/types.ts` already defines `transport_lost` in `SessionStatus`. MULTI-005 uses this existing value; do not add a new `peer_unreachable` variant.

3. **MULTI-003 AC-007 was moved to MULTI-004** as AC-007 (stop-while-current behavior). MULTI-003 no longer contains AC-007.

4. **`cello_send` agent-ownership AC** added to MULTI-007 as AC-009: session ownership error when session_id belongs to a different agent.

5. **Notification delivery model**: notifications go to ALL connected MCP clients; the `agent` field lets each client filter. This is explicit in MULTI-007's behavior section and implementation notes.

6. **MULTI-007 depends_on now explicitly lists MULTI-002** (in addition to MULTI-003 and MULTI-005).

7. **CONTEXT.md must be updated** by the MULTI-006 implementer to add `queued_for_retry` to `SendFailureReason` and add `nonce` field to the `SendResult` failure variant. This is documented in MULTI-006 implementation_notes.

8. **Test harness for multi-connection stories** (MULTI-003, MULTI-004): use `InMemoryTransport` pairs from the MCP SDK to simulate two independent connections. Do not attempt stdio multi-connection.

---

## Cross-Repo CI/CD Gap (post-REPOSPLIT)

**Identified:** 2026-06-01

After REPOSPLIT completed (~4 days ago), the CodePipelines in trustless-cello that validated `packages/crypto/`, `packages/protocol-types/`, `packages/transport/`, `packages/client/`, and `packages/adapter-claude-code/` stopped triggering — that code now lives in the cello-client repo.

**Current state:**
- GitHub Actions (cello-client) runs unit tests + publishes to npm on tag push — no cross-repo validation
- CodePipelines (trustless-cello) are orphaned — watching paths that no longer change
- A breaking change to `@cello-protocol/transport` in cello-client would publish to npm without validating against directory/relay/e2e

**Required fix (backlog story):**
Wire cello-client as a second source into the integration validation pipelines so a push to cello-client main triggers: build shared packages → build directory/relay → run e2e suite → block npm publish if failed.

Label: `infra`, `cicd`, post-M7.
