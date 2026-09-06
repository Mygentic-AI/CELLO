---
name: The god-file split — follow-through
type: discussion
date: 2026-09-06
topics: [m15, godfile, refactor, session-node-manager, 036, 037, 040-044, compaction]
description: >
  Cold-start state for the session-node-manager.ts split. 20,368 → 3,392 across twenty-two modules
  (036, 037, and the content, seal, relay and lifecycle extractions). What is left, why it is hard, the exact commands, and the
  traps that were paid for. Kept current as each extraction lands.
---

# The god-file split — where it stands

## One paragraph

`core/daemon/src/session-node-manager.ts` was **20,368 lines, one class, 25% of the daemon**. It is
**3,392** now, across twenty-two files. Orders **036-GODFILE** (pure movement) and **037-SESSIONCORE**
(redesign) are merged at `2b1cc50`; the **content extraction** — the largest single piece — landed at
`ddf545b`, the **seal extraction** at `a24c221`, the
**relay extraction** at `29b8439`, and the **lifecycle extraction** at `a18676e`. Every unit was reviewed by `cello-unit-reviewer` and every finding fixed. The target —
under 4,000 — is **MET**, at 3,392.

## Live state, exact

| | |
|---|---|
| cello-client `main` | `2b1cc50` — 036 and 037 fully merged |
| worktree | `/Users/andrep/cello-client-wt/037-sessioncore`, branch `m15/037-sessioncore`, at **`a18676e`**, pushed |
| `session-node-manager.ts` | **3,392 lines** |
| ESLint ratchet | `max-lines` 3,000 general; `session-node-manager.ts` grandfathered **3,392**; `daemon.ts` 6,080 |
| trustless-cello | `a8d2a69a`, clean |
| suite | 436 files / **4,971** tests green; lint and typecheck clean; `J-SPINE` 7/7 including the live send/receive and the bilateral seal |

**Nineteen modules exist beside the manager:** `session-node-types`, `authorship-verification`,
`inbound-refusals`, `session-records`, `park-recovery` (036); `session-salts`, `session-schema`,
`session-queries`, `refusal-notices`, `session-ephemerals`, `session-liveness`, `witness-alerts`,
`held-content`, `session-leaf-records`, `standing-receivers` (037); `session-content-context`,
`session-content-send`, `session-content-ingest` (the content extraction); `session-seal` (the seal extraction); `session-relay` (the relay extraction); `session-lifecycle` (the lifecycle extraction).

**The content extraction, `ddf545b`, in one paragraph.** 25 methods / 3,518 lines left the class.
It was split in TWO rather than one, and the seam is real: outbound reaches nothing inbound at all,
and inbound reaches exactly ONE thing outbound — settling the acknowledgement for a message we sent,
which arrives on the very stream the receiver is already reading. So the sender is constructed first
and handed to the receiver. That is also what keeps both halves under the ordinary 3,000-line
ceiling; a single content file would have been 3,772 and needed a grandfather entry of its own,
which is the thing the ratchet exists to stop. The context is **56 members** — wide, explicit, and
the deliberate trade. Anything the manager can REPLACE after construction is reached through a
GETTER, never captured; `#securityGateway` moved to the top of the constructor because a
constructor cannot hand out a field it has not set yet. The seven public methods keep one-line
delegators on the manager (451 external call sites) whose signatures are DERIVED via
`Parameters<>`/`ReturnType<>` rather than copied, so they cannot drift.

## What is left, and the plan Andre chose

**Measured, not estimated** (TypeScript parser, `ts.createSourceFile`):

| group | methods | lines | context size |
|---|---|---|---|
| ~~content~~ | ~~25~~ | ~~3,518~~ | **DONE — `ddf545b`** |
| ~~seal~~ | ~~13~~ | ~~932~~ | **DONE — `a24c221`** |
| ~~relay + reservations~~ | ~~24~~ | ~~1,440~~ | **DONE — `29b8439`** |
| ~~lifecycle~~ | ~~20~~ | ~~1,689~~ | **DONE — `a18676e`** |
| **result** | | **3,392** | the 4,000 target is MET |

Relay went first deliberately and it paid off: lifecycle's five reaches into the relay path became
reaches into a collaborator, and its context came out at 31 rather than the 48 measured before.

### Why 3,392 and not under 3,000 — a decision, not a shortfall

`gracefulShutdown` (196 lines) and `#evictSessionCaches` (194) stayed on the manager on purpose,
and they are 390 of what remains. The first is PROCESS teardown — it closes the database, sets the
shutting-down flag and stops the reservation watchdog. The second clears the shared maps every
collaborator writes. Moving either would mean a collaborator reaching back through its context to
mutate its owner's core lifecycle state, which is a worse shape than a slightly larger manager.
**Hitting 3,000 was available by forcing that seam and was not taken.** If the general ceiling is
wanted here, that is a design decision to make deliberately, not a mechanical one.

What is left is a composition root: the shared session state, the construction of the twenty-two
collaborators, and the delegators that keep the public surface where ~1,400 call sites expect it.

Re-measured on the post-extraction file. All three contexts are NARROWER than the content one was,
so none of them needs the trade that one made.

**ANDRE'S DIRECTION, 2026-09-06, and it supersedes the five-order plan:** get it done, quickly,
correctly — he does not care how. So: **four big extractions, not five careful phases**, accepting
WIDER context interfaces (33–74 members) than 036/037 held to. Explicit and typed, no private state
widened, but wide. That is the deliberate trade.

Orders **040–044 were written before that direction and have been DELETED** (2026-09-06). They were
my own fine-grained alternative — decompose `ingestReceivedContent` into a state object plus four
guard phases — and the four big extractions superseded them the moment Andre chose that route. They
were left sitting as `open` units of `DOD-M15-GODFILE-1` for a day after that line closed, attached
to nothing, reading like unfinished work. Andre's question — *"they never served any purpose, what's
the point in having them sit around as extra noise"* — is the right one, and they are in git history
if the decomposition is ever wanted.

**`ingestReceivedContent` is still 998 lines and 40 top-level statements**, unchanged by the split:
it moved into `session-content-ingest.ts` whole. That is a known and accepted state, not an
oversight. What guards it is the ratchet — `session-content-ingest.ts` is pinned at 2,286 lines in
`eslint.config.mjs`, so neither the file nor the method inside it can grow back. That is the
protection the `daemon.ts` regrowth proved was the part that actually matters.

### ⚠️ THE ONE THING WORTH SAVING FROM THOSE ORDERS — the refusal ORDER is a security property

Carried out of 041 verbatim before deleting it, because it is a fact about the shipped code rather
than a plan: **a check that can answer before the sender is known lets a peer choose which refusal
they get.** `session_orphaned` and `content_hash_mismatch` say different things to an operator and
retain different evidence. Reordering the guards inside `ingestReceivedContent` for tidiness is a
BEHAVIOUR change, not a refactor — the sequence is the contract. It is the same rule 036 protected
one layer out in `authorship-verification.ts`.

## The method that made this hard, for whoever needs it

`ingestReceivedContent`: **998 lines, 40 top-level statements, 35 locals threaded through all of
them, 10 distinct refusal reasons** — `session_orphaned`, `session_committed`,
`content_hash_alg_unknown`, `content_hash_salt_unavailable`, `content_hash_mismatch`,
`sender_unresolved`, `leaf_index_is_not_relay_position_fell_back_to_content_hash`,
`no_ordering_record_deduped_on_content_hash`, `session_size_limit_exceeded`,
`transcript_write_failed`. Every guard reads locals the guards above it declared, which is why no
phase can be lifted out without either a state object or a very wide signature.

## Commands

```bash
# gate (ALWAYS build:clean — vitest runs from SOURCE, the binary tests run dist/)
cd /Users/andrep/cello-client-wt/037-sessioncore
rm -rf core/*/dist core/*/*.tsbuildinfo && pnpm run build:clean
pnpm run lint && pnpm run typecheck && pnpm run test

# LIVE gate — needs nothing from Andre; spawns its own relay + directory on Docker
ln -sfn /Users/andrep/cello-client-wt/037-sessioncore /Users/andrep/cello-client-wt/spine/cello-client
cd /Users/andrep/cello-client-wt/spine/trustless-cello/packages/e2e-tests
npx vitest run --config vitest.spine.config.ts src/spine/j-spine.spine.test.ts
```

The spine environment is a detached trustless-cello worktree at
`/Users/andrep/cello-client-wt/spine/trustless-cello` with a symlink beside it standing in for the
sibling `cello-client` the harness resolves. Already built.

## Traps — every one of these was paid for

1. **`dist/` vs source.** `pnpm run test` runs vitest from SOURCE; only the handful of binary-spawn
   tests run `dist/`. A change passed lint, typecheck and 4,950 tests and broke every binary test —
   a type imported without the `type` keyword becomes a runtime import that does not exist.
2. **The suite is not deterministic.** `commands.test.ts` AC2 and `binary.test.ts` fail under load:
   `connect-or-start.ts` gives a spawned daemon **10 seconds** and a loaded machine misses it.
   Re-run those files alone before concluding anything.
3. **Never fold a map into a collaborator's `evictSession` without checking what the manager did with
   it.** `#saltPending` was SETTLED, not deleted; adding it to eviction meant the settle no-op'd, a
   promise never resolved, and **`cello_send` hung forever — no error, no log, no timeout** — with
   the whole suite green.
4. **Never stub a context member as a captured value.** The key-provider resolver stubbed as `null`
   meant signing silently stopped and sessions fell back to **unencrypted content**. Nothing throws.
   Anything the manager assigns after construction must be a FUNCTION.
5. **Source-scanning guards follow the code, not the filename.** `dod-m15-relayonly-1` (IP leak),
   `dod-m15-migration-guard-1` (client-side migrations) and `msg-022`'s parity check all read source.
   When code moves they go red — that is them working. Verify the property FIRST, then repoint, then
   make them fail on purpose. One of them is a scan for a dangerous SHAPE and must scan BOTH files.
6. **Comments are the asset and they detach.** Three landed on the wrong member during this work;
   one asserted "Never returns null" above a method returning `undefined`, and one file header
   claimed an "open gater" — the exact property `DOD-M15-ASSIGN-1` removed. See category **F** in
   [[M15-PUBLIC-COMMENT-SWEEP]], added by this work, including why its detector over-fires.
7. **Use the TypeScript parser, never a brace counter.** A hand-rolled scan silently truncated any
   method whose return type contains `{}`. And keep cut+emit in ONE script — a two-script version ran
   against a stale intermediate and deleted 597 lines from arbitrary offsets.
8. **`git add -A` never.** Seven throwaway extractor scripts sat untracked at the root of a published
   package; now gitignored as `gf-*.mjs`.

## Standing machinery

A **29-minute watchdog cron** is armed in the session (037-SESSIONCORE prompt). It is session-only —
it dies with the session and must be re-armed after compaction.

## Parallel lanes — do not collide

- **038-KEYBIND** is running now. It touches `session-queries.ts` (`getPinnedCounterpartyPrimary`
  L407, `recordCounterpartyPrimary` L1060) plus `assignment-verify`, `db-identity-store`,
  `inbound-sessions`, `session-ceremony`. Its rule 5a forbids it editing `session-node-manager.ts`.
  **Do not touch `session-queries.ts` while it runs.**
- **039-ASSIGNTARGET** already landed on main.

## A second gap found but deliberately NOT closed here

The two lazily-opened stores (`relayReceiptStore`, `sealLeafStore`) are now created in ELEVEN
places, each repeating `if (!store && db) store = new Store(db, logger)` — six on the relay side,
two on the seal side, the rest scattered. Every one is a chance for a second store over the same
rows, and three files can now open them. One accessor would collapse the lot. It is a redesign, not
a move, so it was left alone; **do it after the split, before anything else touches those stores.**

## A gap found but deliberately NOT closed here

`dod-agent-id-joinkey-ac3-guard.test.ts` calls itself the scan over "the files that own the seven
re-keyed tables' SQL" and names exactly two: `session-node-manager.ts` and `retry-queue.ts`. Since
037 that is stale — `session-schema`, `session-queries`, `session-records`, `held-content` and
`session-leaf-records` all hold SQL now and none of them is scanned. It is a THEORETICAL gap today:
a scan of every daemon source file finds no session-table query scoped on `agent_name` anywhere, and
the content extraction moved no SQL at all. Widening it properly needs a better exemption than the
current one-line `RESOLVER_RE` (every legitimate hit is a query against the `agents` table, which
that regex does not recognise), and `session-queries.ts` belongs to the live 038 lane. **Do it after
the extractions, with the comment sweep.**

## What is NOT done

- `session-node-manager.ts` under 4,000 (it is 7,129).
- The three extractions above: lifecycle, relay, seal.
- `DOD-M15-GODFILE-1` stays open. 036 is `complete`/`unit-of`; 037 is still `open`.
