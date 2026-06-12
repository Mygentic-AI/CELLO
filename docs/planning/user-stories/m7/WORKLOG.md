---
name: M7 Worklog
type: worklog
date: 2026-06-11
milestone: M7
description: >
  Append-only running log for M7 — debugging sessions, deployment results,
  mid-story decisions, AC interpretations, root cause analyses.
  Companion to COORDINATION.md which holds the structural claims.
---

# M7 Worklog

## How to use this file

This file is **append-only**. Never edit or delete an existing entry.

Add an entry here when:
- You tried something and it worked or didn't work
- You hit a blocker and diagnosed the cause
- You interpreted an ambiguous AC and want your interpretation on record
- You made a mid-story decision that isn't obvious from the story YAML
- You deployed something and observed a specific outcome
- You discovered a constraint that wasn't in the outline

**Format each entry as:**
```
### YYYY-MM-DD HH:MM — Short description

**Story:** [story ID, or "general" if not story-specific]
**Agent/Author:** [who you are — e.g. "sprint-coder", "orchestrator", "Andre"]

[Content — as much or as little as useful.]
```

**When an entry produces a durable rule**, promote it to `outline.md`, `CLAUDE.md`,
or the milestone writeup. Note the promotion inline so the history is traceable:
```
**Promoted to:** outline.md "M6/M6B Lessons" section, 2026-06-11
```

---

### 2026-06-11 — M7-E2E-001 written and reviewed

**Story:** M7-E2E-001
**Agent/Author:** orchestrator

CELLO-M7-E2E-001.yaml written by a sprint-coder agent, then reviewed inline.
Five issues found and fixed in the same session (commit 2d84d56):

1. **Blocking — old story IDs in dependencies.** `blocked_by` listed
   `CELLO-M7-S1` through `CELLO-M7-S12` (the pre-rename IDs). Replaced with
   correct domain IDs (CELLO-M7-DAEMON-001, etc.) throughout the file.

2. **Blocking — undeclared event name in SI-002.** `session.node.gater.rejected`
   appeared in the adversarial condition but is not in the DAEMON-002
   observability taxonomy. Replaced with "warn-level event — name to be
   defined by DAEMON-002 implementer and added to taxonomy."

3. **Medium — close gate criterion 6 had no E2E AC.** AC-009 item 6 said
   "verified via S8 story gate" — deferred entirely to DAEMON-003. Added
   AC-006b: kill daemon mid-session with pending retries in queue, restart,
   verify queue drains in order with no duplicates via SQLCipher persistence.

4. **Minor — test setup detail in then clause.** AC-006 had `tc qdisc` in
   the `then` clause. Moved to `implementation_notes`.

5. **Minor — no implementation_notes section.** Added notes covering: how to
   kill the signaling stream for AC-006 (iptables black-hole, not clean
   disconnect — forces heartbeat timeout, the harder failure mode), how to
   build the rogue directory node for AC-008 (must complete handshake steps
   1-5 then fail at 6 — a node that refuses at step 1 does not test step 6),
   and how to trigger the retry queue for AC-006b.

**Cohesion pass reminder:** this story was written before component stories.
After all component stories are written, re-read CELLO-M7-E2E-001.yaml and
align ACs with what the component stories actually specify (event names,
field names, observable IDs). Update COORDINATION.md status when done.

---

### 2026-06-11 — WORKLOG.md created

**Story:** general
**Agent/Author:** orchestrator

WORKLOG.md created as companion to COORDINATION.md. The split separates structural
coordination state (who owns what, what's blocked — COORDINATION.md, edit in place)
from running narrative (what happened, what was tried — this file, append only).

This pattern emerged from M6B's COORDINATION.md growing to 1,422 lines where durable
rules were buried in debugging transcripts. The goal: any agent can read
COORDINATION.md in under a minute, and any agent debugging a problem can search
WORKLOG.md for prior art without it blocking the quick-start read.

---

### 2026-06-11 — M7-E2E-001 approved by sprint-reviewer

**Story:** CELLO-M7-E2E-001
**Agent/Author:** orchestrator

Sprint-reviewer returned APPROVED. Final commit: 63e59b7.
Cohesion pass still required after all component stories are written.

---

### 2026-06-12 — MANIFEST-002 implemented

**Story:** CELLO-M7-MANIFEST-002
**Agent/Author:** orchestrator + cello-sprint-coder

Implemented directory trust closure: step-5 Ed25519 signing (directory side), step-6
manifest-based verification (client side), daemon startup manifest loading, and
background 6–12 hour polling.

**Key decisions:**
- `IManifestProvider.updateManifest()` added so polled manifests update the in-memory
  copy used by `IDirectoryChallengeVerifier` — without this, key rotation silently
  breaks all connections.
- `IDirectoryChallengeVerifier.verifyChallenge()` returns a discriminated union
  (`ChallengeVerifyResult`) rather than boolean, enabling AC-007 (`key_not_in_manifest`)
  and AC-008 (`signature_invalid`) to be observably distinct.
- `FileManifestVersionStore` introduced (file-backed) to bridge until DAEMON-001
  delivers SQLCipher. Required by AC-005 (cross-process restart monotonicity).
- Daemon composition root updated: `CELLO_MANIFEST_PATH`, `CELLO_TEST_CONSORTIUM_KEYS`,
  `CELLO_TEST_CONSORTIUM_THRESHOLD` env overrides allow integration tests to inject test
  manifests and keys without modifying production constants.

**Code-review findings (feature-dev:code-reviewer):** 8 findings, all fixed before Step 4.
**Sprint-reviewer findings:** 4 blocking, all fixed:
  1. `IDirectoryChallengeVerifier` boolean → discriminated union
  2. `manifest.version <= lastSeen` → `manifest.version < lastSeen` (equal version is valid)
  3. AC-005 process-restart boundary test (binary spawning, file-backed version store)
  4. AC-015 event-ordering test (manifest.verified before daemon.started in binary log)

**Final test counts:** 815 tests passing (54 files) in cello-client; 6 MANIFEST-002
directory tests passing in trustless-cello. Lint and typecheck clean.

**Commits:**
- cello-client m7/manifest-002: sprint-coder initial + two fix rounds (commits 5d433cc, 5d58cb1)
- trustless-cello m7/manifest-002: sprint-coder initial + test manifest fix (commits in branch)

**Batch gate:** trustless-cello branch NOT pushed to origin — must batch with
M7-WIRE-001 and M7-SESSION-001 before any directory pipeline push.
