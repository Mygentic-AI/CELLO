---
name: M7 Prune Ledger
type: ledger
date: 2026-06-18
milestone: M7
status: open
description: >
  The 2026-06-18 great collapse. All M7 worktrees and branches in BOTH repos were
  merged-as-best-we-could into main and then deleted, to kill the branch/worktree
  sprawl that had become unmanageable. This ledger records every deleted branch + its
  tip hash so ANY of them is resurrectable with `git branch <name> <hash>` (git keeps
  the objects; nothing here is truly lost). Use this as the pick-through list.
---

# M7 Prune Ledger — the 2026-06-18 collapse to main

**Why:** the M7 work had sprawled to ~14 worktrees + ~15 branches across two repos.
Re-doing/re-asking work that already existed in another tree had become the norm. Per
Andre's call: merge the consolidated work to main, prune everything else, get to a
manageable state, then pick through. Nothing is deleted irrecoverably — `git branch
<name> <hash>` brings any of these back.

## Final state
- **cello-client** `main` = **`c7210c4`** — the full M7 daemon assembly (Keystone +
  Registration + DAEMON-004 + MSG-001 phases 1/2/3a + TRANSPORT-001 + SESSION-003 live
  half + SESSION-004 live half + the seam glue 1a–4). daemon 342 tests green, typecheck
  + lint clean, dead-code gate clean. **Not pushed.**
- **trustless-cello** `main` = **`9933a66`** — prior main (SESSION-001/WIRE-001/MANIFEST-002
  already merged) + the relay store-and-forward half (RELAY merged clean). **Not pushed.**

## cello-client — pruned branches

All SUBSUMED into `main` (`c7210c4`) unless noted. (Hashes for resurrection.)

| Branch | Tip | In main? |
|---|---|---|
| CELLO-M7-MSG-001-REHOME | `c7210c4` | **IS main now** (the assembly) |
| CELLO-M7-INTEGRATION | `fd89747` | yes — assembly base |
| CELLO-M7-KEYSTONE | `903433d` | yes — in assembly |
| CELLO-M7-REGISTRATION | `e1b5e26` | yes — in assembly |
| CELLO-M7-DAEMON-004 | `7ba23fa` | yes — in assembly |
| CELLO-M7-TRANSPORT-001 | `4ef75ca` | yes — in assembly |
| CELLO-M7-SESSION-003 | `c2460db` | yes — live half in assembly |
| CELLO-M7-SESSION-004 | `d82ab6a` | yes — live half in assembly |
| CELLO-M7-MSG-001 | `3b21271` | **SUPERSEDED** — old dead-`CelloClient`-stack MSG-001; its live work was re-homed into the assembly, its dead-stack half intentionally excluded. 16 commits not in assembly = the superseded version. |

Old pre-M7 husks also deleted (long-stale; resurrect only if archaeology needs them):
`CELLO-M6B-001 01351c2`, `-002 a29a963`, `-003/-004/-006/-007/-012 3622201`,
`-005 8692536`, `-010/-011 75666df`, `-013 b48acaa`,
`fix/seal-reconnect-retry b0556df`, `fresh-start e32ac75`,
`m6b-017/client-extraction de2fea2`, `persist-024 8345b05`.

## trustless-cello — pruned branches

| Branch | Tip | In main? |
|---|---|---|
| CELLO-M7-MSG-001-RELAY | `f7924b4` | **MERGED into main `9933a66`** ✅ |
| CELLO-M7-DAEMON-004 | `4c7fe98` | n/a — docs/YAML only, no package code |
| CELLO-M7-TRANSPORT-001 | `f55ad0e` | n/a — docs only, no package code vs main |
| CELLO-M7-MSG-001 | `8f34eeb` | **SUPERSEDED** by RELAY (old relay half; 17 files, the store-and-forward work is in RELAY) |
| **CELLO-M7-SESSION-003** | **`e081efe`** | **NOT in main — UNMERGED server code.** Directory/relay session-path liveness (relay-frames, relay-node, relay-store, relay-types + test). 5 package files. **Pick-through candidate.** Its cello-client *live* half (daemon `#sessionLiveness` + protocol-types codec + transport keepalive) IS in main; this is the missing *relay/directory* half. |
| **CELLO-M7-SESSION-004** | **`f466946`** | **NOT in main — UNMERGED server code.** Directory seal-certificate legibility ("receipt, not assent" + frontiers + final-message indicator): directory-frames, directory-node, directory-types, seal-legibility + tests + e2e. 7 package files. **Pick-through candidate.** Its cello-client *live* half (protocol-types `SealLegibility` schema) IS in main; this is the missing *directory* half. |

## The ONLY genuinely-unmerged code (the pick-through shortlist)

Everything else is either in main (the assembly) or superseded. The two pieces that were
built but are NOT in either main, deliberately left for the audit:

1. **trustless-cello SESSION-003 server half** — `e081efe` — directory/relay session-path liveness.
2. **trustless-cello SESSION-004 server half** — `f466946` — directory seal-certificate legibility.

They were never consolidated or tested with the rest; force-merging them now (off an older
main base, with COORDINATION + directory-node.ts collisions) would re-create the sprawl mess.
Resurrect with `git branch <name> <hash>` when picking through.
