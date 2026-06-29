---
name: M8B Build Journal
type: journal
date: 2026-06-29
milestone: M8B
status: open
description: >
  Append-only build journal for M8B (federation) + the live status board (best-of-both: M7's
  one-entry-per-unit archaeology plus a running status board so a fresh context resumes fast).
  NEVER edit a prior entry; add new entries at the BOTTOM. Pairs with M8B-DEFINITION-OF-DONE.md
  (target), M8B-PROCEDURE.md (runbook), M8B-DECISIONS.md (forks), M8B-SPEC.md (architecture).
---

# M8B Build Journal (append-only) + Status Board

## Status board (update as units land)

| Unit | DoD line | Repo(s) | Status | Notes |
|------|----------|---------|--------|-------|
| FED-SPINE-001 (enforcer, build FIRST) | DOD-SPINE-1 | e2e | ⬜ not started | spine spawns 3 directory nodes |
| FED-MANIFEST-001 | DOD-MANIFEST-1 | client+dir | ⬜ not started | signed N-node manifest + N-endpoint resolver |
| FED-DKG-001 | DOD-DKG-1 | client+dir | ⬜ not started | multi-node DKG (2-of-3) |
| FED-SIGN-001 | DOD-SIGN-1 | client+dir | ⬜ not started | T-of-N session sign + seal; kill single-key fallback |
| FED-SUSPEND-001 | DOD-SUSPEND-1 | dir | ⬜ not started | quorum-aware refusal |
| FED-REFRESH-001 | DOD-REFRESH-1 | client+dir+crypto | ⬜ not started | share refresh / epoch rollover |
| FED-RELAYSIG-001 | DOD-RELAYSIG-1 | relay+client | ⬜ not started | relay-signed ordering + PERSIST-012 live |
| FED-OPTIONB-SETUP-001 | DOD-OPTIONB-SETUP-1 | dir+relay+client | ⬜ not started | client-presented assignment; kill relay dial |
| FED-OPTIONB-SEAL-001 | DOD-OPTIONB-SEAL-1 | dir+client | ⬜ not started | client-carried receipts; offline seal |
| FED-PRESENCE-001 | DOD-PRESENCE-1 | dir+infra | ⬜ not started | presence + directory_nodes → cello_pub |
| FED-PICKUP-001 | DOD-PICKUP-1 | dir+infra | ⬜ not started | pickup_queue → UUID + cello_pub |
| FED-DEPLOY-001 | DOD-DEPLOY-1 | infra | ⬜ not started | bump+publish, deploy dev, live proof, fix directory-ap1 DNS |

Legend: ⬜ not started · 🔨 in progress · 🟡 unit-green · ✅ spine-proven · 🚀 live-proven

---

## Entries (newest at bottom)

### 2026-06-29 ~20:15 — M8B kickoff (docs complete; no code yet)
**Origin.** A full day of code-grounded investigation (relay_unavailable → the directory→relay same-region
pin; the M7 dead-stack ghost; the 2-of-2 stopgap) converged on one milestone: federation. Andre, awake,
scoped it "wide, wide, wide" with full authorization (dev deploys + npm publish; alpha, solo, recoverable)
and resolved every fork (see M8B-DECISIONS.md): client-as-coordinator T-of-N; Option B for directory↔relay;
replicate presence+pickup; proof on local 3-dir spine → then dev.

**Key code truth (verified, two investigations each side):** the FROST crypto + DKG + signing ceremony are
genuinely T-of-N and LIVE; the 2-of-2 is pure wiring (3 call sites + a single-endpoint resolver + a
placeholder manifest). The client is already the coordinator → T-of-N = client fans out to N directory nodes
(relaying VSS-verifiable round-2 shares), no directory↔directory needed. Share-refresh is the one truly
NOT-BUILT piece. Relay ordering is unsigned (PERSIST-012 stranded in dead core/client). Full §2 in M8B-SPEC.md.

**Produced this session (docs only):** M8B-SPEC.md, M8B-DEFINITION-OF-DONE.md, M8B-PROCEDURE.md, this journal,
M8B-DECISIONS.md. Process corrected mid-setup: an initial branch-per-unit + dispatched-coder plan was scrapped
after re-reading M7-PROCEDURE — M8B follows the proven model (ONE coder thread, ONE assembly branch per repo,
read-only reviewers, cron drift-check). See M8B-DECISIONS.md.

**Next red (first unit of real work).** DOD-SPINE-1 — extend the spine harness to spawn **3 real directory
nodes** locally (today: one). It's the enforcer; until it exists, T-of-N can't be proven. Then DOD-MANIFEST-1.

**Branch / where.** Code goes on `m8b-assembly` in each repo. These planning docs commit to `main`
(trustless-cello, docs only). Nothing merged to main-code; assembly branch may be pushed for visibility.

**Reviewer / blockers.** N/A (docs only). No code, no tests run.
