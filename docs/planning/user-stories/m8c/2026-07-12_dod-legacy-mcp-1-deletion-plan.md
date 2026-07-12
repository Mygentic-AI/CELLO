---
name: dod-legacy-mcp-1-deletion-plan
type: design
date: 2026-07-12
topics: [dead-code, legacy-mcp, published-surface, test-coverage, launch-triage, m8c]
status: plan-complete-recommend-defer
description: >
  Design pass for DOD-LEGACY-MCP-1 (delete the legacy in-process MCP servers). Verifies the dead-code
  report's reachability claim (TRUE) but finds its SCOPE badly understated: this is not "delete 3 files
  + exports" — it detonates 11 test files / ~130 test cases, and at least one of them (m6b-002) tests
  LIVE code through the dead server as a mere harness. Recommends DEFER on launch-triage grounds, with
  the per-file surgical plan recorded so it can be executed cheaply whenever it is scheduled.
---

# DOD-LEGACY-MCP-1 — deletion plan (and why I recommend deferring)

> **No code deleted. No files touched.** Plan only, per the work-order pattern.

## 0. Provenance correction (matters, because it changes who verified what)

The work order credits **me** with `docs/dead-code-report.md`. **I did not write it** — it came from
another session (`claude/dead-code-mcp-migration-xpfwxc` → PR #2, corrected by
`claude/validate-dead-code-report-rxv8e7` → PR #3). So I have **verified its claims from scratch**
rather than inheriting them. That verification is the whole value of this pass: the headline claim is
right, and the scope is wrong.

## 1. What the report gets RIGHT (verified independently)

The published MCP entrypoint `core/adapter-claude-code/src/bin/cello-mcp.ts` imports **neither**
legacy server. Confirmed by grep: it imports only the MCP SDK. Nothing at runtime reaches
`createMcpServer` (adapter `server.ts`) or `createMcpSessionServer` (client `mcp-server.ts`). They are
genuinely dead **on the runtime path**, and they *are* on the published export surface
(`adapter-claude-code/src/index.ts:1`, `client/src/index.ts:22`), so the tarball really does carry a
second, stale tool vocabulary. The defect is real.

## 2. What the report gets WRONG — the scope

The report's "Step 1" reads as: *delete 3 files + their exports.* That understates the work by an
order of magnitude. **Those three files are the test harness for 11 suites / ~130 test cases:**

| Doomed suite | Tests | Driven by |
|---|---:|---|
| `adapter-001/002/003.test.ts` | 8 + 12 + 3 | `createMcpServer` |
| `close-session-seal.test.ts` | 3 | `createMcpServer` |
| `persist-017-checkpoint-status.test.ts` | 9 | `createMcpServer` |
| `dod-onboard-help-1-tool-parity.test.ts` | 10 | `createMcpServer` (its *premise* is server.ts) |
| `mcp002.test.ts` / `mcp-003-unit.test.ts` | 20 + 20 | `createMcpSessionServer` |
| `dx-001-unit.test.ts` | 23 | `createMcpSessionServer` |
| `session007.test.ts` | 13 | `createMcpSessionServer` |
| `m6b-002-client-error-propagation.test.ts` | 9 | `createMcpSessionServer` |

**Two corrections to the deletion list itself:**

- **`notifications.ts` cannot be deleted wholesale.** It exports **two** functions.
  `pushSessionRequestNotification` is indeed only called by the dead `server.ts` — but
  `pushChannelNotification` is a **separate published export** (`index.ts:2`). Deleting the file
  silently removes a public export the report never mentions. (Its *runtime* use is also nil —
  `bin/cello-mcp.ts` has its own inline forwarding — but that is a different claim and must be made
  explicitly, not by accident.)
- **`dod-onboard-help-1-tool-parity.test.ts` doesn't just "need updating" — its premise dissolves.**
  That test exists (I bounded it during the v0.0.97 help pass) to assert *"`server.ts` is the ONE file
  permitted to name a renamed-away tool."* If `server.ts` is gone, the correct end state is
  **stronger**: *no file anywhere may name a renamed-away tool.* That is a tightening, and it should be
  written as one — not deleted.

## 3. The finding that actually decides this — LIVE code is tested through the DEAD harness

`m6b-002-client-error-propagation.test.ts` is **mixed**, and it proves the class:

- **AC-005 / AC-006 / AC-007 + "preserves all pre-existing reasons"** test `mapSessionRequestErrorFrame`
  and the `InitiateSessionResult` type — **live `core/client/src/client.ts` / `types.ts`**. They do not
  need the legacy server at all.
- **AC-009 / AC-010** test the dead `mcp-server.ts` tool handler.

So a wholesale file deletion **silently destroys coverage of live client code**. This is exactly the
failure mode a "delete the dead files" instruction invites, and it is not hypothetical — it is in the
first file I opened. Every one of the 11 suites must be triaged **per test case**, not per file.

**Mitigating fact (checked, not assumed):** the live paths *do* have their own coverage —
`core/daemon/src/__tests__/` covers `cello_close_session` + seal (`daemon-004-ipc`,
`seal-unilateral-retry`, `f16-counterparty-gone`, `session-001`), and the live shim has
`mcp-001-proxy.test.ts`. So most of the ~130 cases are duplicate coverage of live behavior *through a
dead driver*, and can go. But "most" is not "all", and the difference is invisible without the
per-case pass.

## 4. Launch-triage call — I recommend DEFER

Applying CLAUDE.md's test (*would this ruin a customer, or can they forgive it?*):

- **Nothing reaches this code at runtime.** No operator can hit it. The DoD line itself says
  **"Not a launch blocker."**
- The harm is **hygiene**: a stale second vocabulary sits inside the connect tarball, unreachable.
  Already **bounded by a test** so it cannot silently grow.
- The cost is **~130 test cases of surgery across two published packages**, with a proven risk of
  deleting live-code coverage if done by file rather than by case — plus a full publish cascade to
  verify.

That is a poor runway trade: real risk and real hours, zero customer-visible value. **This is the
rabbit hole the launch-triage rule is written to catch.** My recommendation is to **defer** and spend
the runway on the launch path.

**If Andre wants it done anyway**, it is bounded work and the plan below is ready to execute cold.

## 5. Execution plan (if scheduled) — surgical, not by file

1. **Spec "gone"**: (a) no export from either `index.ts`; (b) **no `dist/` artifact** — note that merely
   dropping the export does **not** remove `server.js` from the tarball (tsc still compiles it), so the
   files must actually be deleted to fix the stated defect; (c) the renamed-away-tool audit tightens
   from *"only server.ts may"* to *"nobody may."*
2. **Triage every one of the ~130 cases into KEEP / DELETE**, by subject-under-test, not by file.
   `m6b-002` is the worked example: keep AC-005/006/007 + the preservation test (re-pointed at
   `mapSessionRequestErrorFrame` directly, no server), delete AC-009/010.
3. **Red-first**: a test asserting the exports are absent and the `dist/` artifacts do not exist.
4. Delete `adapter/server.ts`, `client/mcp-server.ts`; from `notifications.ts` delete **only**
   `pushSessionRequestNotification` (decide `pushChannelNotification` **explicitly** — it is a separate
   published export).
5. **Tighten** `dod-onboard-help-1-tool-parity.test.ts` to the stronger invariant.
6. Gate → `cello-unit-reviewer` (Opus) → publish cascade (both packages are published; removing a public
   export is a breaking change to the API surface) → **verify against the tarballs** (`server.js` /
   `mcp-server.js` must be ABSENT from `dist/`, which is the whole point).
7. **Out of scope, explicitly** (report's steps 2–7): the `@cello-protocol/client` dependency removal,
   the CI publish list, `lock-file.ts` / `config.ts`, the transport-dialer question, the frost stubs.

## Related

- [[M8C-DEFINITION-OF-DONE]] — `DOD-LEGACY-MCP-1` (known-open, explicitly "not a launch blocker")
- `cello-client docs/dead-code-report.md` — the source report (another session; claims verified here)
