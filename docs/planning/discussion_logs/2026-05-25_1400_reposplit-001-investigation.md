---
name: REPOSPLIT-001 Investigation — Pre-Implementation Analysis
type: discussion
date: 2026-05-25
topics: [reposplit, cello-client, npm-publish, test-dependencies, interfaces, test-fixtures, ci-pipeline, tsconfig, endpoints, m6]
status: active
description: Full pre-implementation investigation for REPOSPLIT-001. Enumerates every complication an implementer will hit: test dependency problem (13 affected tests, categorisation, options), interfaces package placement decision, test-fixtures question, cello-client repo current state, CI pipeline design, production endpoint gaps, SI enforcement, and what trustless-cello looks like post-split. Ends with a prerequisites checklist (decisions vs facts).
---

# REPOSPLIT-001 Investigation Report

**Source repo head:** commit 054490f
**Purpose:** Enumerate every complication an implementer will hit before writing a line of code.

---

## 1. The Test Dependency Problem

### What the code shows

**13 of 25 `@cello/client` tests** and **1 of 5 `@cello/adapter-claude-code` tests** import from packages that stay in `trustless-cello`. Here is the complete enumerated list.

#### `packages/client/src/__tests__/` — affected tests

| Test file | Forbidden imports | What it is actually testing |
|---|---|---|
| `connection-request.test.ts` | `@cello/directory`, `@cello/relay` | CONNREQ-002: client-to-client connection policy flow. Spins up an in-process relay node and a real directory node to exercise the full two-party signaling round-trip. Integration test: client behaviour is only observable in the presence of the other components. |
| `connreq-003.test.ts` | `@cello/directory`, `@cello/e2e-tests/session-fixture` | CONNREQ-003: concurrent connection fan-out and duplicate-request deduplication. Uses `createSessionFixture` to reduce boilerplate. Integration test: same class as above. |
| `e2e-reg-001-dkg-network.test.ts` | `@cello/directory` | Full FROST DKG ceremony over real libp2p streams. By name and nature a fully integration test — it is not testing the client in isolation; it is testing the client + directory DKG protocol together. |
| `network-directory-node.test.ts` | `@cello/directory` | Tests `NetworkDirectoryNode` (a class that lives inside `@cello/client`) which wraps libp2p streams to a real directory node. Integration test: the subject (`NetworkDirectoryNode`) cannot function without a real directory on the other end of the stream. |
| `registration.test.ts` | `@cello/directory` | Full FROST DKG registration flow: `register()` → directory responds. Integration test. |
| `reconnect-client-state.test.ts` | `@cello/directory` | Client-side reconnect state machine after `already_registered` and `already_connected`. Integration test: needs a real directory to emit those responses. |
| `session.test.ts` | `@cello/directory` (type import only: `SessionAssignment`), `@cello/relay` | SESSION-001 through SESSION-003: relay auth and session establishment. Integration test. |
| `session004.test.ts` | `@cello/relay` | FROST signature verification at session establishment. Integration test (real relay node). |
| `session005.test.ts` | `@cello/directory`, `@cello/relay` | FROST seal signature verification and seal_type upgrades. Integration test. |
| `session006.test.ts` | `@cello/relay` | Transport loss and reconnect behaviour. Integration test (relay stream forcibly closed). |
| `msg004.test.ts` | `@cello/relay` | Message send/receive with signature tamper tests. Integration test. |
| `connection-policy.test.ts` | `@cello/test-fixtures` | CONNPOL-001: pure policy engine logic (`evaluateConnectionPackage`). **The test itself is a pure unit test.** It imports `buildValidatedPackage`, `buildInvalidPackage`, `makeDirectoryContext`, etc. from `@cello/test-fixtures` — factory helpers that construct typed structs. No directory node, no relay node. |

#### `packages/adapter-claude-code/src/__tests__/` — affected tests

| Test file | Forbidden imports | What it is actually testing |
|---|---|---|
| `adapter-003.test.ts` | `@cello/directory`, `@cello/relay` | CONNREQ-003 session-initiation behaviour at the MCP layer. Integration test: spins up in-process relay and directory nodes. |

### Key distinction for the implementer

The `connection-policy.test.ts` case is structurally different from all the others. It does not instantiate directory or relay nodes. It only uses `@cello/test-fixtures` for deterministic struct-builders (`buildValidatedPackage`, etc.). The `@cello/test-fixtures` package itself has **no dependency** on `@cello/directory` or `@cello/relay` — its only dependency is `@cello/protocol-types`. This test is conceptually a unit test that has been stranded by the package boundary.

All twelve other affected tests genuinely exercise in-process directory and relay nodes as test infrastructure. They cannot meaningfully run without them.

### Note on tsconfig

`packages/client/tsconfig.json` already excludes `src/__tests__` from the composite build (`"exclude": ["dist", "src/__tests__"]`). The composite build for `@cello/client` does **not** depend on `@cello/directory` or `@cello/relay` — AC-001 and AC-002 (`tsc --build`) will pass from the start.

`packages/adapter-claude-code/tsconfig.json` does **not** exclude `src/__tests__`, and its `references` array currently includes `{ "path": "../relay" }` and `{ "path": "../directory" }`. Those references are only needed because the test files import from those packages. **This means AC-001 (tsc --build) is blocked by the adapter's current tsconfig**, not just by the test runner. The tsconfig must either add an `exclude` for `__tests__` and drop the relay/directory references, or those references must be kept — in which case the project can never build standalone without the staying packages. This fix is a prerequisite for AC-001.

### Clean tests (move to cello-client as-is)

For reference, the 13 tests that have no forbidden imports and can move unchanged:

`client.test.ts`, `index.test.ts`, `mcp-003-unit.test.ts`, `mcp002.test.ts`, `persist-009.test.ts`, `persist-010.test.ts`, `persist-011.test.ts`, `persist-012.test.ts`, `persist-014-reconciliation.test.ts`, `persist-015-unilateral-seal.test.ts`, `persist-022.test.ts`, `session003.test.ts`, `session007.test.ts`

Plus `connection-policy.test.ts` (moves once `@cello/test-fixtures` moves — see Section 3).

From `adapter-claude-code`: `adapter-001.test.ts`, `adapter-002.test.ts`, `index.test.ts`, `persist-017-checkpoint-status.test.ts` are all clean.

### Options

**Option A: Leave the 12 integration tests in `trustless-cello`**

Move only the clean tests to `cello-client`. The 12 integration tests remain in `trustless-cello`, either under `packages/client/src/__tests__/` (unchanged) or promoted into `packages/e2e-tests/`.

- AC-003 says "all existing unit tests pass; no test depends on directory or relay packages." It does not say "all tests in the file tree." The integration tests never lived in cello-client and can stay behind.
- *Tradeoff:* The `@cello/client` package in `cello-client` ships without coverage of its registration, session, and connection flows. Behavioural regressions in those flows would only be caught by the monorepo test suite, not by CI in `cello-client`. For a published package this is a real gap.
- *Clean:* No structural changes to test files. Unambiguous to implement.

**Option B: Move in-process directory/relay stubs into `cello-client` as unpublished test-only packages**

Create `core/test-infra/directory-stub` and `core/test-infra/relay-stub` in `cello-client`. Lightweight in-process implementations that satisfy the interfaces the tests need without carrying the full server-side code.

- `createDirectoryNode` in `@cello/directory` (`packages/directory/src/directory-node.ts`) is a ~2600-line file. Even a minimal in-process stub that passes the session + registration ACs would need to implement the DKG protocol, the FROST ceremony coordination, `SessionAssignment` generation, and the signaling protocol. That is not a lightweight stub — it is a re-implementation of the protocol server.
- Divergence risk: any protocol change in `trustless-cello` must be mirrored in the stubs.
- The project's no-mock rule for crypto operations applies — the FROST DKG tests are exercising real crypto.
- *Not recommended.*

**Option C: Rewrite affected tests to use mock/stub implementations**

Replace `createDirectoryNode` and `createRelayNode` with in-process stub objects that return fabricated protocol frames.

- A mock directory that fabricates `SessionAssignment` frames is not testing whether the client correctly handles what a real directory emits. These tests exist precisely because the protocol is complex; a mock that mimics the happy path misses exactly the bugs the tests are designed to catch.
- *Not recommended.*

**Option D (effectively Option A stated differently)**

The existing `@cello/e2e-tests/session-fixture` pattern is already the right tool for shared in-process node infrastructure. The 12 integration tests belong in `trustless-cello`, where the session-fixture and all its dependencies are available. No structural change needed — Option A is the path.

### Recommendation on framing

The "AC-003 says no test depends on directory/relay" criterion is a target state for the cello-client repo — not a requirement that every test currently in `packages/client/src/__tests__/` must move. The implementer controls which tests move. Move only the 13 clean tests (plus `connection-policy.test.ts` once `@cello/test-fixtures` moves), leave the 12 integration tests in `trustless-cello`. This satisfies AC-003 exactly.

---

## 2. The `@cello/interfaces` Question

### What it contains

`packages/interfaces/src/` exports 14 interface groups:

**Client-side (used by `@cello/client` and/or `@cello/adapter-claude-code` production source):**
- `Logger`, `LogContext`, `LogLevel`
- `SigningKeyProvider`, `SigningPublicKey`, `SigningSignature`, `SignOptions`, `SigningKeyProviderError`
- `ClientStore`
- `CloudStorageProvider`
- `Leaf` (part of `SessionWal`)
- `CheckpointStatusProvider`, `SealStagingStatus`

**Server-side only (used by `@cello/directory` and/or `@cello/relay` production source, not by client):**
- `DirectoryStore`, `SealNotarization`, `AccountRow`, `CreateAccountParams`
- `EnvelopeKeyProvider`
- `RelayWal`
- `JobScheduler`, `ScheduledJob`
- `SessionWal`
- `AuditLogShipper`, `AuditLogEntry`
- `NotificationQueue`, `QueuedNotification`
- `ICheckpointTransport`, `CheckpointProposal`, `CheckpointSignatureResponse`

**Stubs in `packages/interfaces/src/stubs/`:** `InMemoryDirectoryStore`, `StdoutLogger`, `LocalEnvelopeKeyProvider`, `LocalClientStore`, `InMemoryRelayWal`, `LocalJobScheduler`, `InMemorySessionWal`, `LocalAuditLogShipper`, `LocalCloudStorageProvider`, `InMemoryNotificationQueue`, `InMemoryCheckpointTransport`.

Several stubs (e.g., `LocalEnvelopeKeyProvider`, `InMemoryDirectoryStore`, `InMemoryRelayWal`, `LocalJobScheduler`) are server-side-only stubs with no client production usage.

### The complication

`@cello/interfaces` is a **runtime `dependency`** (not `devDependency`) of all four main packages: `@cello/client`, `@cello/adapter-claude-code`, `@cello/directory`, and `@cello/relay`. It sits at the bottom of the dependency graph and is shared across the repo split boundary.

**If it moves to `cello-client`:** It must publish as `@cello/interfaces`. `@cello/directory` and `@cello/relay` install it from npm. This works for the server-side interfaces they depend on. The bigger issue: **OPS-AGENT-000 adds `MessagingChannel`, `OtpDeliveryProvider`, `TokenValidator`, `SecurityAlertProvider` to `@cello/interfaces`**. If interfaces is in `cello-client`, OPS-AGENT-000's implementer must open a PR against `cello-client` to add those interfaces — a cross-repo workflow for what is conceptually a server-side concern.

**If it stays in `trustless-cello`:** `@cello/client` and `@cello/adapter-claude-code` in `cello-client` install `@cello/interfaces` from npm. This works only if `@cello/interfaces` is published. It is currently `"private": true`. Must change to `"private": false` with a `files` allowlist.

**If inlined into `@cello/connect`:** The interfaces package contents are copied into one of the moving packages. This is a refactor, not a move. Directory and relay would need to install `@cello/client` from npm to get the interface types — architecturally backwards.

### Options summary

| Option | Description | Tradeoff |
|---|---|---|
| Interfaces moves to cello-client, publishes as `@cello/interfaces` | Clean separation; directory/relay install from npm | OPS-AGENT-000's new interfaces must go to cello-client via cross-repo PR |
| Interfaces stays in trustless-cello, publishes from there | OPS-AGENT-000 stays in same repo; no cross-repo issue | cello-client consumes `@cello/interfaces` from npm; version pinning adds friction |
| Split the package: client-facing types move, server-facing types stay | Clean long-term; mixed-concern resolved | Significant refactor; two new packages; wrong trade-off at M6 crunch time |

**The decision is forced by OPS-AGENT-000.** The simpler path for M6 is: interfaces stays in `trustless-cello` and publishes as `@cello/interfaces`. This is a human decision that must be made before implementation starts.

---

## 3. The `@cello/test-fixtures` Question

### What it contains

`packages/test-fixtures/src/index.ts` exports:
- `FakeMlDsaKeyProvider`, `FakeMultiVerifier` — fake ML-DSA implementations for structural tests
- `buildValidatedPackage`, `buildPackageWithExpiredEndorsement`, `buildPackageWithTargetMismatch`, `buildInvalidPackage` — `PackageValidationResult` factory functions
- `makeDirectoryContext` — factory for `DirectoryContext` structs
- `writeTrustStore`, `readTrustStore`, `TrustStore` — filesystem helpers
- Policy constants: `OPEN_POLICY`, `CLOSED_POLICY`, `REQUIRES_1_ENDORSEMENT`, `REQUIRES_PSEUDONYM_7_DAYS`, `INFERENCE_OPEN_POLICY`

**Its only dependency is `@cello/protocol-types`** — no directory, no relay, no crypto, no AWS.

### Who imports it

- `packages/protocol-types/src/__tests__/` — devDependency; used in protocol-types tests (stays in `trustless-cello`)
- `packages/client/src/__tests__/connection-policy.test.ts` — the one affected test that should move to `cello-client`
- No production source in any package imports it

### The move question

Because `@cello/test-fixtures` depends only on `@cello/protocol-types` (which moves), it can move cleanly to `cello-client`. It should not be published to npm (keep `"private": true`). It would appear in `cello-client`'s `pnpm-workspace.yaml` as an unpublished workspace package — available as a workspace devDependency for `@cello/protocol-types` tests and `@cello/client` tests in `cello-client`.

For `@cello/protocol-types` tests that stay in `trustless-cello`: after the split, `@cello/protocol-types` in `trustless-cello` would install `@cello/test-fixtures` from the local workspace if it stays, or from npm if it moves. Since it is `"private": true`, it cannot be installed from npm. **If `@cello/test-fixtures` moves to `cello-client`, `packages/protocol-types/src/__tests__/` in `trustless-cello` breaks.** Either:
- The protocol-types tests in `trustless-cello` are moved to `e2e-tests` or removed, or
- A copy of the needed fixtures is duplicated, or
- `@cello/test-fixtures` stays in `trustless-cello` and is a devDependency of `@cello/client` in `cello-client` installed from npm (requires publishing it, which conflicts with `"private": true`)

**Simplest resolution:** `@cello/test-fixtures` moves to `cello-client` as a private workspace package. The `packages/protocol-types/src/__tests__/` usage in `trustless-cello` is copied into `@cello/protocol-types` itself (it is a small amount of test helper code), or those protocol-types tests move to `e2e-tests`. This question is subordinate to the test disposition decision in Section 1.

---

## 4. The `cello-client` Repo Current State

### What is there

The repo at `github.com/Mygentic-AI/cello-client` (local checkout at `/Users/andrep/Documents/code/cello-client`) is a documentation stub:

```
cello-client/
  core/           README.md only — "Pre-implementation."
  adapters/       README.md stubs (openclaw, ironclaw, nanobot, etc.)
  skills/         README.md
  README.md       Marketing README
  CHANGELOG.md
  CONTRIBUTING.md
  LICENSE
```

**There is no `package.json`, no `pnpm-workspace.yaml`, no `tsconfig.json`, no `node_modules`, no CI pipeline.** The repo is a blank directory structure with placeholder READMEs. The planning description "blank slate stub" is accurate.

### Structural mismatch with planning doc

The planning docs say the five moving packages go to `core/protocol-types`, `core/crypto`, `core/transport`, `core/client`, `core/adapter-claude-code`. The current `core/` directory is empty (only a README). The implementation is free to follow that structure — there are no pre-existing files to work around.

The existing README mentions `@cello/mcp-server` as the package name — this predates the decision to use `@cello/connect`. The README will be replaced per AC-008.

### What must be created from scratch

- `pnpm-workspace.yaml` referencing `core/*`
- Root `package.json` (workspace root)
- `tsconfig.json` at root referencing the five `core/*` packages
- `tsconfig.base.json` (copy from `trustless-cello`)
- `vitest.workspace.ts` referencing the five `core/*` packages
- `.github/workflows/ci.yml` (per AC-006)
- `AUDIT-ME.md` (per AC-007)
- `README.md` replacement (per AC-008)

---

## 5. CI Pipeline Design

### What AC-006 requires

> pnpm install → build → typecheck → test → tarball check → publish on tagged release

### Node version

`"engines": { "node": ">=24" }` per CONTEXT.md. GitHub Actions: `node-version: '24'`.

### pnpm setup

```yaml
- uses: pnpm/action-setup@v4
  with:
    version: 10.33.2   # pin to match trustless-cello buildspec.yml
- uses: actions/setup-node@v4
  with:
    node-version: '24'
    registry-url: 'https://registry.npmjs.org'
    cache: 'pnpm'
```

### TypeScript project references

The root `tsconfig.json` in `cello-client` must reference all moving packages:

```json
{
  "files": [],
  "references": [
    { "path": "core/crypto" },
    { "path": "core/protocol-types" },
    { "path": "core/transport" },
    { "path": "core/test-fixtures" },
    { "path": "core/client" },
    { "path": "core/adapter-claude-code" }
  ]
}
```

(Plus `core/interfaces` if interfaces moves — see Section 2.)

Each package tsconfig currently `extends "../../tsconfig.base.json"`. In `cello-client` with packages nested at `core/<pkg>/`, the extend path from `core/crypto/tsconfig.json` is still `../../tsconfig.base.json` — correct if `tsconfig.base.json` is at the repo root.

**The `adapter-claude-code/tsconfig.json` currently references `../relay` and `../directory`** — these must be removed. Since the adapter's production source imports nothing from either package (confirmed by grep: zero hits in non-test source), the fix is: remove those two references from `references[]` and add `"exclude": ["src/__tests__"]`. This is a prerequisite for AC-001. It can be done in `trustless-cello` before the split or as step one in `cello-client`.

### Tarball check — AC-005

CI shell step (not a Vitest test):

```bash
cd core/adapter-claude-code
npm pack --dry-run 2>&1 | grep -E 'directory|relay|infra|\.env'
# must exit 1 (no matches)
```

Extended per SI-002:

```bash
# Pack and scan tarball contents for private key material
npm pack
tar -tf cello-connect-*.tgz | while read f; do
  tar -xOf cello-connect-*.tgz "$f" 2>/dev/null | grep -q "BEGIN PRIVATE KEY\|\"share\":{\"index\":" && echo "FAIL: $f contains key material"
done
```

The `package.json#files` allowlist is the real enforcement. The CI step verifies the allowlist does its job.

### npm publish gate

```yaml
- name: Publish
  if: startsWith(github.ref, 'refs/tags/')
  run: pnpm --filter @cello/adapter-claude-code publish --tag beta --no-git-checks
  env:
    NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

The `--tag beta` satisfies Mitigation D. `publish` only runs on tagged releases. All prior steps (build, typecheck, test, tarball check) must pass or publish does not run.

---

## 6. Production Endpoint Baking — AC-004

### What STATE.md currently has

**Development environment (us-east-1):**
- Directory ALB DNS: `cello-dir-dev-1136016900.us-east-1.elb.amazonaws.com`
- Route 53 record: `directory-us1.cello.mygentic.ai`
- Directory node public key (peer ID input): `167ca6b145bfdd3696af8f4befd883c3dc610f4a9c8d52a30f6a22f669dc27b5`

**Production environment:** `### production — not deployed` — no entries.

**Relay endpoint:** No Route 53 record for the relay exists in any environment. The relay listens on `/ip4/0.0.0.0/tcp/4001`. There is no `RELAY_DNS_NAME` or equivalent in STATE.md. Clients currently receive relay assignments from the directory's session establishment flow — the relay multiaddr is not a static baked-in value anywhere in the codebase today.

### Current state of `cello-mcp.ts`

`packages/adapter-claude-code/src/bin/cello-mcp.ts` reads `CELLO_DIRECTORY_MULTIADDR` from the environment with no default:

```typescript
const directoryMultiaddr = process.env["CELLO_DIRECTORY_MULTIADDR"];
```

There is no baked-in production default. AC-004 requires compile-time constants with env-var override — this is new code that does not yet exist.

### What is missing for production

1. **Production directory URL**: needs a production Route 53 DNS name + the production directory node's peer ID. Neither exists. Production environment is not deployed.
2. **Production relay multiaddr**: needs a public DNS hostname for the relay + the relay's peer ID. No relay DNS record has been created in any environment. The relay endpoint is currently resolved dynamically from the relay manifest S3 bucket, not baked in.

AC-004 is a late-binding step. All structural work (CI wiring, package extraction, tsconfig cleanup) proceeds immediately. AC-004 is the final piece before publish, as the story notes explicitly.

---

## 7. Security Invariant Enforcement — SI-001, SI-002

### Current state of `adapter-claude-code/package.json`

```json
"name": "@cello/adapter-claude-code",
"private": true,
// no "files" field
```

### What must change

1. **Rename `name` to `@cello/connect`** — the publish name differs from the internal package name. The internal workspace reference still resolves via pnpm because pnpm resolves by `name`. Rename is the cleanest approach.

2. **Remove `"private": true`** — the package must be publishable.

3. **Add `"files"` allowlist:**
   ```json
   "files": [
     "dist/",
     "package.json"
   ]
   ```
   This is the sole enforcement mechanism per SI-001. Only `dist/` and `package.json` end up in the tarball — no `src/`, no `.env`, no test fixtures, no IaC.

4. **CI grep validation (AC-005):** `npm pack --dry-run | grep -E 'directory|relay|infra|.env'` must return exit code 1. With the `files` allowlist above, this is guaranteed: the allowlist permits only `dist/` and `package.json`.

5. **SI-002 key scan:** The `files` allowlist automatically excludes test fixtures from `src/`. The CI step verifies no `dist/` file embeds key material — which would be a compilation bug, not a packaging bug.

---

## 8. What `trustless-cello` Looks Like After the Split

### Does directory compile after the split?

`@cello/directory` has runtime dependencies on `@cello/crypto`, `@cello/protocol-types`, `@cello/transport`, and `@cello/interfaces` — all of which are moving (assuming interfaces moves; if it stays this is not an issue). After the split, directory resolves them from npm rather than the local workspace.

`@cello/directory/tsconfig.json` currently references `../crypto`, `../interfaces`, `../protocol-types`, `../transport`. After those packages move out of the monorepo, those relative paths no longer exist. **The tsconfig references must change** — either remove the `references` array and rely on `node_modules` resolution, or update paths. The same applies to `@cello/relay`.

**`@cello/e2e-tests`** lists all moving packages as dependencies. After the split, pnpm installs them from npm. The e2e-tests continue to work without structural change — pnpm resolves moving packages from npm, staying packages from the local workspace. The complication: during active development, a change in `cello-client` at HEAD is not reflected in `trustless-cello` e2e-tests until published. Developer workflow for this is unresolved (pnpm overrides, `pnpm link`, or local tarball install are options).

### Root `tsconfig.json` after the split

Currently references all 9 packages. After the split:

```json
{
  "files": [],
  "references": [
    { "path": "packages/directory" },
    { "path": "packages/relay" },
    { "path": "packages/e2e-tests" }
  ]
}
```

Plus `packages/interfaces` and `packages/test-fixtures` if they stay.

### Root `pnpm-workspace.yaml` after the split

```yaml
packages:
  - "packages/*"
```

Unchanged — only `packages/directory`, `packages/relay`, `packages/e2e-tests` (and staying packages) remain under `packages/`.

### Do the directory and relay CI buildspecs change?

`packages/directory/buildspec.yml` currently manually pre-builds upstream packages (crypto, interfaces, protocol-types, transport) before typechecking directory. After the split, those upstream packages are installed from npm by `pnpm install` — the manual pre-build steps become unnecessary. However, **this only works once the published npm versions are current with the code being tested.** During active development with in-flight changes across repos, the buildspecs may need to stay as-is until a stable publish cadence is established.

---

## Prerequisites Checklist

Items flagged as **DECISION** (requires a human call) or **FACT** (just needs to be known/done before implementation).

### Decisions required before writing code

1. **DECISION — Test disposition:** Which tests move to `cello-client`? The analysis above recommends: move 14 clean tests (13 clean + `connection-policy.test.ts` which moves with `@cello/test-fixtures`), leave 12 integration tests in `trustless-cello`. Must be confirmed as acceptable under AC-003's "all existing unit tests pass" language.

2. **DECISION — `@cello/interfaces` placement:** Move to `cello-client` (and publish as `@cello/interfaces`), or stay in `trustless-cello` (and publish from there)? Affects OPS-AGENT-000: if interfaces moves, OPS-AGENT-000's new interfaces require a cross-repo PR to `cello-client`. This is the highest-leverage decision — it touches every story in the OPS-AGENT chain.

3. **DECISION — `@cello/test-fixtures` placement:** If it moves to `cello-client`, the `packages/protocol-types/src/__tests__/` usage in `trustless-cello` breaks (it is `"private": true`, cannot be installed from npm). Decision: move it and copy the small amount of needed fixtures into protocol-types directly, or keep it in `trustless-cello` and accept that `connection-policy.test.ts` stays there too.

4. **DECISION — Relay multiaddr discovery model for AC-004:** The relay is currently not accessible by a static baked-in multiaddr. Does AC-004 require a static baked-in relay multiaddr, or is the relay endpoint discovered dynamically from the directory at startup? If dynamic discovery is the model, AC-004's "CELLO_RELAY_MULTIADDR defaults to the production relay multiaddr" requirement needs re-evaluation before any AC-004 code is written.

5. **DECISION — Package name in `package.json`:** The internal name is `@cello/adapter-claude-code`; the publish name is `@cello/connect`. Rename `name` in `adapter-claude-code/package.json` to `@cello/connect`, or keep the internal name and use npm publish flags? Renaming is cleaner. Confirm.

6. **DECISION — npm `@cello` scope:** The M6 outline shows this as "Pending." `npm publish` will fail if the `@cello` scope does not exist on npm or if the publishing token does not have access. Must be set up before the CI publish step can be wired.

### Facts to know before writing code

7. **FACT — `adapter-claude-code/tsconfig.json` must be fixed first:** Remove `{ "path": "../relay" }` and `{ "path": "../directory" }` from `references`. Add `"exclude": ["src/__tests__"]`. Prerequisite for AC-001. Can be done in `trustless-cello` before the split or as step one in `cello-client`.

8. **FACT — Production endpoints are not available:** AC-004 is a late-binding step. Structural work proceeds immediately. Production directory URL and relay multiaddr come from the production deployment, which is not yet deployed. Treat AC-004 as the final step before publish.

9. **FACT — `cello-client` repo is a blank slate:** No `package.json`, no `pnpm-workspace.yaml`, no CI. Everything created from scratch. Confirmed against actual repo contents.

10. **FACT — `cello-mcp.ts` has no baked-in default endpoints today:** Reads `CELLO_DIRECTORY_MULTIADDR` from the environment with no default. The baked-in-default behaviour (AC-004) is new code that does not yet exist.

11. **FACT — `@cello/directory` and `@cello/relay` tsconfigs must change after the split:** Both use relative `references` pointing at `../crypto`, `../interfaces`, `../protocol-types`, `../transport`. Those paths are invalid once the moving packages leave the monorepo. The tsconfigs must drop those references.

12. **FACT — `connreq-003.test.ts` imports `@cello/e2e-tests/session-fixture`:** This was the M5 pipeline failure resolved by adding `pnpm --filter @cello/e2e-tests run typecheck` to the client buildspec. If `connreq-003.test.ts` stays in `trustless-cello` (recommended), the buildspec entry stays and nothing breaks. If it moves to `cello-client`, the `session-fixture` import must be severed and the test rewritten.

---

## Decisions — Coordinator Review (2026-05-25)

This section records the decisions made after reviewing the investigation findings with the project owner.

### Decision 1 — Test disposition: confirmed

Move 14 clean tests to `cello-client`, leave 12 integration tests in `trustless-cello`. This satisfies AC-003's "no test depends on directory or relay packages" criterion — that criterion applies to the `cello-client` repo, not to every test currently in the `trustless-cello` file tree. The 12 integration tests (which instantiate real in-process directory and relay nodes) never belonged in `cello-client`; they are correctly placed in `trustless-cello` and may be promoted to `packages/e2e-tests/` at a later point. No mock/stub implementations are acceptable as replacements — the no-mock-for-crypto rule applies.

The 14 tests that move: `client.test.ts`, `index.test.ts`, `mcp-003-unit.test.ts`, `mcp002.test.ts`, `persist-009.test.ts`, `persist-010.test.ts`, `persist-011.test.ts`, `persist-012.test.ts`, `persist-014-reconciliation.test.ts`, `persist-015-unilateral-seal.test.ts`, `persist-022.test.ts`, `session003.test.ts`, `session007.test.ts`, `connection-policy.test.ts` (moves with `@cello/test-fixtures`). Plus from `adapter-claude-code`: `adapter-001.test.ts`, `adapter-002.test.ts`, `index.test.ts`, `persist-017-checkpoint-status.test.ts`.

### Decision 2 — Relay multiaddr in AC-004: stale language, correct

The relay endpoint is not a static baked-in value. It is dynamically assigned per-session via `SessionAssignment` from the directory. Clients never need a static relay multiaddr — the relay pool is managed by the directory and relay assignment is part of session establishment. AC-004's current text ("CELLO_RELAY_MULTIADDR defaults to the production relay multiaddr") is stale and must be corrected in the story YAML. The only compile-time constant AC-004 actually requires is the production directory endpoint. CELLO_RELAY_MULTIADDR is removed from AC-004 entirely.

### Decision 3 — `@cello/test-fixtures` placement: moves to `cello-client`

`@cello/test-fixtures` moves to `cello-client` as a private workspace package (keep `"private": true`, not published to npm). This keeps `connection-policy.test.ts` co-located with the code it tests and ensures the published `@cello/connect` package has full policy engine test coverage in its own CI.

The cost: `packages/protocol-types/src/__tests__/` in `trustless-cello` uses `@cello/test-fixtures`. After the move, those usages must be inlined directly into the protocol-types test files. The amount of code involved is small (struct factory functions and policy constants) — confirmed by the investigation's enumeration of `test-fixtures` exports and their single dependency on `@cello/protocol-types`.

### Decision 4 — npm `@cello` scope: in progress (not a blocker for structural work)

Scope registration and NPM_TOKEN wiring are underway. Structural work (repo setup, CI wiring, test moves, AUDIT-ME.md, README) proceeds immediately. The publish AC is the only step blocked on scope completion.

### Decision 5 — SKILL.md: ship minimal, iterate

`SKILL.md` already exists in `packages/adapter-claude-code/` but contains stale content (wrong install command, wrong package name). It must be in the npm tarball so an agent that installs `@cello/connect` can load it. The content standard for M6 is: correct install command, correct MCP wiring, minimal tool usage examples — sufficient for an agent to get connected. It will iterate as the flow evolves. Add `"SKILL.md"` to the `package.json#files` allowlist and add a CI check verifying it is present in the tarball.

### Additional finding: `@cello/interfaces` placement

Not listed as a numbered decision in the prerequisites checklist but resolved during review. `@cello/interfaces` stays in `trustless-cello`. The OPS-AGENT chain (OPS-AGENT-000 through 005B) adds `MessagingChannel`, `OtpDeliveryProvider`, `TokenValidator`, `PreAuthorizationClient`, and `SecurityAlertProvider` to `@cello/interfaces` — all server-side concerns. If interfaces moved to `cello-client`, every OPS-AGENT story would require a cross-repo PR to a client repo for server-side interface work, which is architecturally backwards. `@cello/interfaces` removes `"private": true`, adds a `files` allowlist, and publishes from `trustless-cello`. `cello-client` consumes it as a pinned npm dependency.

### Additional finding: tsconfig fix lands in `trustless-cello` first

`packages/adapter-claude-code/tsconfig.json` currently references `{ "path": "../relay" }` and `{ "path": "../directory" }` solely because test files import from those packages. This blocks `tsc --build` in `cello-client` (AC-001). The fix — remove those two references, add `"exclude": ["src/__tests__"]` — must land in `trustless-cello` as the first commit of this story, before any extraction work begins, so the monorepo CI stays green throughout.

### Additional finding: package name rename

`packages/adapter-claude-code/package.json` `"name"` field changes from `@cello/adapter-claude-code` to `@cello/connect`. pnpm workspace resolution uses the `name` field, so downstream workspace consumers update their references accordingly. This is the cleanest approach — no npm publish flags required.

### Additional finding: developer cross-repo workflow

After the split, a change to `cello-client` at HEAD is not visible in `trustless-cello` e2e-tests until published. The recommended workflow for developing across both repos simultaneously: use `pnpm link` to create a symlink from `trustless-cello/node_modules/@cello/<pkg>` to the local `cello-client` workspace path. This must be documented in the `cello-client` README or a dev-setup note before REPOSPLIT-001 closes.
