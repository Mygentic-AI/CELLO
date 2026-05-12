---
name: M3 — Connection Policy and Registration
type: design
date: 2026-05-12
topics: [milestone, M3, connection-request, connection-policy, registration, frost-dkg, mcp, relay, directory, e2e]
status: active
description: Post-completion write-up for M3. What was built, what was proved, the bugs found during live smoke testing, and the infrastructure fixes that closed the milestone.
---

# M3 — Connection Policy and Registration

**Completed:** 2026-05-12 (live smoke test passed, second consecutive clean seal)  
**Stories:** CELLO-CRYPTO-004, CELLO-REG-001, CELLO-CONNPOL-001, CELLO-CONNREQ-001, CELLO-CONNREQ-002, CELLO-SESSION-006, CELLO-MCP-003, CELLO-ADAPTER-003, CELLO-OBS-001, CELLO-TESTFIX-001, CELLO-E2E-004

> **Note on test harness and observability writeups.** The shared `SessionFixture` extraction (TESTFIX-001) and the CONNREQ-002/SESSION-006 E2E harness rewrite are documented in detail in [[M3-connreq-002-e2e-test-harness]]. The observability work (OBS-001) is documented below but lightly — the event format and motivations are straightforward. This writeup focuses on what M3 as a whole proved and what it took to get there.

---

## What M3 Set Out to Prove

Two agents who have never met can register with the directory, negotiate whether they want to talk to each other, and then establish a FROST-signed session — all as separate OS processes. The connection gate is real and enforced: a session cannot be initiated without a prior accepted connection. The registration is real and interactive: there is no pre-authorized shortcut from the M2 era.

M2 proved that session receipts are unforgeable by any single party. M3 proves that agents control who they enter sessions with.

---

## What Was Built

### Packages shipped

| Package | What M3 adds |
|---|---|
| `@cello/crypto` | ML-DSA-44 key generation and signing (FIPS 204); `MlDsaKeyProvider`; cross-realm `Uint8Array` normalization fix (mlDsa sign); FROST DKG wire protocol types (round 1 commit, round 2 share, round 3 sign) |
| `@cello/client` | `register()` — client-side FROST DKG coordinator over `/cello/frost/1.0.0`; `requestConnection()` / `awaitConnectionRequest()` / `acceptConnection()` / `rejectConnection()`; `respondToDisclosureRequest()`; `SignalRequirementPolicy` engine (`evaluateConnectionPackage`); connection gate enforcement in `initiateSession()` (`connection_required` if no established connection); concurrent-close fix in `#handleFrostSealed`; `register()` sets `#myPrimaryPubkey` after DKG |
| `@cello/directory` | Directory-side FROST DKG ceremony (real 3-round interactive protocol replacing `bootstrapKeyShares` trusted-dealer); `register_request` handler; connection request routing (relays to target's signaling stream); `connection_response` verdict handling; `connection_established` / `connection_rejected` frame delivery; `/cello/directory-relay/1.0.0` handler — receives `seal_submission` from relay, runs `processSeal()`, responds with `seal_received` |
| `@cello/relay` | `NetworkDirectoryAdapter` — encodes `seal_submission` CBOR frame, dials directory, reads `seal_received` response; relay binary reads `CELLO_DIRECTORY_MULTIADDR` and wires the adapter; relay binary prints `[RELAY]` protocol events |
| `@cello/adapter-claude-code` | `createMcpSessionServer` replacing `createMcpServer` (M2); 10 new MCP tools: `cello_register`, `cello_request_connection`, `cello_await_connection_request`, `cello_accept_connection`, `cello_reject_connection`, `cello_list_connections`, `cello_respond_to_disclosure_request`, `cello_get_connection`, `cello_list_available_agents`, `cello_get_sealed_receipt`; `cello_close_session` returns `sealed_root` and `leaf_count` directly |
| `@cello/e2e-tests` | Shared `SessionFixture` (`packages/test-fixtures/src/session-fixture.ts`) — canonical fixture replacing 6 near-identical per-story harnesses; `node-004-e2e.test.ts` updated for M3 (register + connect before session); retired `mcp-002` AC-001 and `adapter-003` AC-004 (both required initiating sessions without connections, which M3 now rejects unconditionally) |
| observability | `[AUTH]`, `[REG]`, `[FROST]`, `[CONN]`, `[SESS]`, `[SEAL]`, `[RELAY]` log lines — printed to stdout by relay and directory on every protocol event; ISO 8601 timestamps; peer IDs and keys truncated to 8 chars |

### Test counts at M3 close
- **668 tests passing, 2 skipped** (2 pre-existing cleanup errors unrelated to M3)
- Zero lint errors, zero TypeScript errors
- 11 stories, 8 packages

---

## What Was Proved

### In automated tests

**FROST DKG (REG-001 / CRYPTO-004)**
- Real 3-round interactive DKG over `/cello/frost/1.0.0` replaces M2's trusted-dealer `bootstrapKeyShares`
- Client sends round 1 commitments; directory sends back aggregated commitments; client sends round 3 partial signatures; directory assembles `primary_pubkey`
- `primary_pubkey` returned from real DKG ceremony equals the key used for subsequent session establishment FROST verification
- `register()` on already-registered pubkey → returns cached `primary_pubkey` without re-running ceremony
- Directory stores ML-DSA pubkey alongside Ed25519 identity on the agent profile

**Connection policy engine (CONNPOL-001)**
- `mode: 'closed'` auto-rejects all requests; `evaluateConnectionPackage` returns `auto_reject` without consulting requirements
- `mode: 'open'` with `review_mode: 'deterministic'` auto-accepts if pseudonym binding is valid
- `pseudonym_age` requirement with `min_age_days: N` evaluated against `created_at` in connection package
- `is_provisional: true` → auto-reject regardless of policy mode
- `review_mode: 'inference'` → `pending_agent_review`; report surfaced via `cello_await_connection_request`

**Connection request ceremony (CONNREQ-001 / CONNREQ-002)**
- Round 1: initiator sends package; target evaluates with policy engine; `auto_accept` → `connection_established` immediately
- Round 2: when `auto_insufficient` (deterministic) — target sends `disclosure_request`; initiator may send enriched package; target re-evaluates; accept or reject
- `disclosure_request` timer: if initiator doesn't respond within `round2TimeoutMs`, auto-reject fires
- Frame routing fix: when `#pendingConnectionRequestResolve` is null (post-round-1), `connection_established` routes to `#pendingDisclosureResolvers` instead of being silently dropped
- `listConnections()` on both sides after accept; B's connection record arrival is asynchronous — requires `waitFor`

**Connection gate (SESSION-006)**
- `initiateSession(targetPubkey)` with no established connection → `connection_required`
- Same call after accepted connection → normal session flow
- Gate is enforced in the directory (not just the client): MCP tools cannot bypass it

**MCP tool surface (MCP-003)**
- All 10 new tools tested; `cello_close_session` returns `{status, sealed_root, leaf_count}` directly
- No private key material in any tool response (SI-001 coverage)
- `cello_register` idempotent: second call returns cached `primary_pubkey` without ceremony

**Concurrent-close fix (client.ts)**
- New `#frostCeremonyParticipant` set tracks which sessions actually ran the FROST ceremony (via `seal_verified`), distinct from `#sealInitiatedSessions` (both sides enter this during close)
- `#handleFrostSealed` guard uses `#frostCeremonyParticipant.has()` — prevents false-positive FROST participation by the non-initiator
- `#handleSessionFrostSealed` prefers `#sealVerifiedData` for `leafCount` (deferred-seal TBS reconstruction fix)
- `register()` fix: sets `#myPrimaryPubkey` after DKG, so subsequent calls to tools that require the primary key work without a restart

**Shared fixture discipline (TESTFIX-001)**
- Single `createSessionFixture(opts)` in `packages/test-fixtures/src/session-fixture.ts` replaces 6 near-identical per-story harnesses
- Opts cover every scenario: `{ register, bootstrapB, networkRelay, withMcp, policyA, policyB, requireConnectionGate, round2TimeoutMs, trackEvaluateCount, whitelist }`
- All existing E2E tests migrated; no test file defines its own `makeFixture()`

---

## What Was Proved in the Live Smoke Test

Two real Claude Code agents — separate processes, separate key files, no shared memory — executed the full M3 flow twice in the same session. Directory logs confirmed each AC:

**AC-001 (Registration):**
```
[REG]   DKG begin — agent 170138f0, 1 directory nodes, threshold 2
[FROST] Round 1 commit from peer 170138f0 (1/1)
[FROST] Round 3 sign from peer 170138f0 (1/1)
[REG]   Agent 170138f0 registered — primary_pubkey cebd273a
```

**AC-002 (Connection establishment):**
```
[CONN]  Request: 170138f0 → 8b6dde20
[CONN]  Relayed to target 8b6dde20
[CONN]  Verdict accept — 34be2031
[CONN]  Connection 34be2031 established: 170138f0 ↔ 8b6dde20
```

**AC-003 (Session with FROST ceremony):**
```
[SESS]  Session request: 170138f0 → 8b6dde20
[FROST] Ceremony begin — session b51bb65d, agent 170138f0
[SESS]  Assignment issued — session b51bb65d
```

**AC-005 (Sealed session with FROST-notarized root):**
```
[SEAL]  Initiating seal — session b51bb65d (6 leaves)
[SEAL]  FROST seal ceremony — session b51bb65d
[SEAL]  Sealed — session b51bb65d, root 5e427484
```

Agent A received `sealed_root: 5e4274845e5f811c6565d9f0e3e56280b380e8fc935df17f9df50f102c2856af`. The first 8 chars match the directory log. The test was run a second time with a new session — clean seal again.

---

## Bugs Found During Live Smoke Testing

### 1. `cello-mcp` binary used M2 server (`createMcpServer`) instead of M3 (`createMcpSessionServer`)

**Symptom:** `frost_signer_not_configured` on `cello_register`.  
**Root cause:** `packages/adapter-claude-code/src/bin/cello-mcp.ts` still imported `createMcpServer` from `../server.js` — the M2 dual-identity server with no `cello_register` tool. The M3 MCP surface lives in `createMcpSessionServer` from `@cello/client`.  
**Fix:** Switched import; rebuilt binary. The binary had not been rebuilt since MCP-003 shipped.

### 2. Agent B used Agent A's key

**Symptom:** Both agents reported the same `own_pubkey`.  
**Root cause:** `CELLO_KEY_FILE` had been added to the `cello` env block in `~/.claude.json` (not `~/.claude/settings.json` — the file Claude Code actually reads). The env block hardcodes the value for every Claude session; Agent B's shell export of a different key file was silently ignored.  
**Fix:** Removed `CELLO_KEY_FILE` from the `~/.claude.json` env block. Agent B must set it via shell export before launching `claude`.

### 3. All seals were `seal_deferred` — relay couldn't reach directory

**Symptom:** `cello_close_session` returned `{status: "seal_deferred"}` instead of `{status: "sealed"}`. Agent B saw no seal event.  
**Root cause:** The relay binary had no `directory:` adapter configured. The relay detected bilateral SEAL leaves and called `this.#directory!.processSeal()`, but `#directory` was null (the `NetworkDirectoryAdapter` that submits seal proofs to the directory over `/cello/directory-relay/1.0.0` was not yet implemented).  
**Fix:** Implemented `NetworkDirectoryAdapter` (new file) and wired it into the relay binary via `CELLO_DIRECTORY_MULTIADDR`. The directory added a `/cello/directory-relay/1.0.0` handler to receive `seal_submission` frames from the relay and run `processSeal()`.  
**This was the last gap in the M3 infrastructure.** Without it the relay-to-directory seal path never existed, and M2's `seal_deferred` fallback was the only outcome possible in multi-process testing.

### 4. `register()` didn't update `#myPrimaryPubkey`

**Symptom:** After calling `cello_register`, subsequent calls that required the primary key failed or returned stale data.  
**Root cause:** `register()` ran the DKG ceremony and stored `#thresholdSigner`, but forgot to also set `#myPrimaryPubkey`. The field was only set via `setPrimaryPubkey()` which was called by the M2 startup path — not the M3 `register()` path.  
**Fix:** One line added to `register()` after DKG returns: `this.#myPrimaryPubkey = new Uint8Array(dkgResult.primaryPubkey)`.

### 5. `#frostCeremonyParticipant` missing from `injectTestSession`

**Symptom:** M-001 security test (concurrent-close false positive) failed after the `#frostCeremonyParticipant` fix.  
**Root cause:** Unit tests use `injectTestSession({ isInitiator: true })` to set up sessions without running the full network ceremony. This path only added to `#sealInitiatedSessions`, not to the new `#frostCeremonyParticipant` set — so the `#handleFrostSealed` guard rejected the injected session as if it weren't an initiator.  
**Fix:** `injectTestSession` with `isInitiator: true` now adds to both sets.

---

## Why the Relay→Directory Seal Path Wasn't There

This is worth understanding clearly, because the pattern repeats.

The M2 stories defined `DirectoryAdapter` as an interface with `processSeal()`. The relay used this interface. In tests, `InMemoryDirectoryAdapter` (a stub) implemented it in-process. In the relay binary, the adapter was simply `undefined` — the relay would pass `directory: undefined` to `createRelayNode`, and the code guarded with `if (this.#directory)`. The guard meant: "if no adapter is configured, seals are quietly deferred." This is a valid production design (relay can run without a directory for purely bilateral use). But it meant that every multi-process smoke test from M2 onward was silently getting `seal_deferred` — and nobody noticed because M2's smoke test didn't assert on the seal status.

The M3 E2E-004 story explicitly required `status: sealed` with matching root in directory terminal, relay terminal, and agent receipt. This is what surfaced the gap.

The fix was straightforward once the gap was identified: implement `NetworkDirectoryAdapter` (69 lines), wire it in the relay binary, add the `/cello/directory-relay/1.0.0` handler in the directory. The entire relay→directory seal submission path took one session to implement and worked on the first real test run after rebuilding.

---

## The ~/.claude.json vs ~/.claude/settings.json Confusion

This cost two debugging sessions across M2 and M3 and is worth documenting as a permanent reference.

Claude Code reads MCP server configuration from `~/.claude.json`. The file `~/.claude/settings.json` also exists and is used for other settings (model, status line, enabled plugins). They are different files. Changes to `~/.claude/settings.json` do not affect MCP server configuration.

The `env` block in `~/.claude.json`'s `mcpServers.cello` entry is applied to the MCP server process unconditionally, overriding any shell exports. This means:
- `CELLO_DIRECTORY_MULTIADDR` must be updated in `~/.claude.json` when the directory multiaddr changes
- `CELLO_KEY_FILE` must NOT be in the `~/.claude.json` env block — if it is, Agent B's `export CELLO_KEY_FILE=...` is silently ignored and both agents use Agent A's key

The correct `~/.claude.json` cello entry:
```json
"cello": {
  "command": "node",
  "args": ["/path/to/packages/adapter-claude-code/dist/bin/cello-mcp.js"],
  "env": {
    "NODE_ENV": "test",
    "CELLO_DIRECTORY_MULTIADDR": "/ip4/127.0.0.1/tcp/4000/p2p/12D3KooW..."
  }
}
```

No `CELLO_KEY_FILE`. Agent B sets it via shell export before launching `claude`.

---

## Key Design Decisions Made During M3

**Real DKG replaces trusted dealer.** `bootstrapKeyShares` (M2 test-only trusted dealer) is still present but M3's `register()` uses the real 3-round interactive DKG over `/cello/frost/1.0.0`. The directory runs the ceremony; the client coordinates. No single node ever holds all shares after DKG — the trusted-dealer attack surface (CRIT-2 from M2) is closed.

**Connection gate is enforced in two places.** The client checks `#connections.has(targetPubkeyHex)` in `initiateSession()` before sending `session_request` to the directory. The directory independently checks `hasConnection(initiator, target)` before running the FROST ceremony. Neither check is sufficient alone — a modified client could skip the client check, and the directory check is the authoritative enforcement.

**`seal_submission` over `/cello/directory-relay/1.0.0`.** The relay→directory seal path uses a dedicated protocol stream rather than the directory's signaling stream. This keeps the relay's relationship with the directory distinct from agents' relationships: relay frames are admin-level messages authenticated with the relay's signing key (in a future story); for now they are authenticated by the persistent TCP connection.

**`#frostCeremonyParticipant` distinguishes ceremony coordinator from session initiator.** The concurrent-close scenario was: A initiates close → both A and B enter `#sealInitiatedSessions` → A receives `seal_verified` and runs the ceremony → B also tries to run the ceremony because it's also in `#sealInitiatedSessions`. The fix tracks which sessions actually received `seal_verified` (i.e., were designated the ceremony coordinator by the directory) in a separate set. Only those sessions attempt to run the ceremony.

**Relay startup order.** Relay must start before directory. The directory binary requires `CELLO_RELAY_MULTIADDR` and exits if absent. The relay does not connect to the directory at startup — it only needs `CELLO_DIRECTORY_PUBKEY` to authenticate incoming admin frames. Directory peer ID is stable across restarts (persisted transport key at `~/.cello/directory-transport-key`), so the relay's `CELLO_DIRECTORY_MULTIADDR` only needs to be updated once per machine.

---

## Infrastructure for Live Testing

All values below are stable across restarts (persisted transport keys):

```
Terminal 1 (relay):
  CELLO_DIRECTORY_PUBKEY=<directory-pubkey-hex> \
  CELLO_DIRECTORY_MULTIADDR=/ip4/127.0.0.1/tcp/4000/p2p/<dir-peer-id> \
  NODE_ENV=test \
  pnpm --filter @cello/relay run start

Terminal 2 (directory):
  CELLO_RELAY_MULTIADDR=/ip4/127.0.0.1/tcp/4001/p2p/<relay-peer-id> \
  NODE_ENV=test \
  pnpm --filter @cello/directory run start

~/.claude.json cello MCP entry:
  command: node
  args: [".../packages/adapter-claude-code/dist/bin/cello-mcp.js"]
  env: { NODE_ENV: "test", CELLO_DIRECTORY_MULTIADDR: "/ip4/127.0.0.1/tcp/4000/p2p/..." }
  NOTE: No CELLO_KEY_FILE in env block.

Agent A terminal: claude  (uses ~/.cello/key)
Agent B terminal: export CELLO_KEY_FILE=~/.cello/key-agent-b && claude

After each directory restart: all agents must call cello_register() again
  (in-memory store is cleared; connection state is also lost)
```

Full step-by-step operator instructions: [[cello-chat]] (M3 edition).

---

## What Remains Open

### Multi-party DKG (> 1 directory node)
The M3 DKG ceremony runs with `threshold: 2, participants: 1` — a single directory node contributing one share. True 2-of-n threshold requires n > 1 participants. The ceremony protocol is correct; the infrastructure for distributing the DKG to multiple directory nodes is M7+.

### Round 2 disclosure — inference mode
`inference` mode produces `pending_agent_review`; the agent reads the report and decides. Automated tests use `deterministic` mode exclusively (inference would require LLM in the loop). The inference path is implemented and exercised only in the MCP tool surface, not in automated tests.

### Connection package trust signals beyond pseudonym_age
In M3, the only testable `SignalRequirement` is `pseudonym_age` (uses `created_at` from the pseudonym binding). `endorsement` and `attestation` requirements are implemented in the engine but untestable until M6 adds endorsement issuance and ML-DSA attestation chains.

### Cross-machine e2e
Deferred from M0/M1/M2 — all code ready. Requires two physical machines or cloud instances.

### DB-003 (seal_verified delivery to disconnected initiator)
Implemented and works in practice; no dedicated integration test.

### MMR (global sealed-conversation ledger)
`mmr_peak: null` in all seal responses. M10 Federation.

---

## What M4 Builds On

M3 proved that strangers can negotiate access and establish verifiable sessions entirely through a standing directory. The protocol stack is complete enough for autonomous agent-to-agent interactions where the human operator only configures policy — not individual sessions.

M4's scope has not been decided. The infrastructure is ready for trust signal exchange (endorsements, attestations), real OTP verification for registration, and multi-directory federation. The `cello-chat` skill documents the current operator procedure so M4's integration tests can start from a stable baseline rather than rediscovering startup order each milestone.

---

## Related Documents
- [[CELLO-E2E-004]] — M3 close gate story
- [[CELLO-REG-001]] — Registration and real DKG
- [[CELLO-CONNPOL-001]] — Connection policy engine
- [[CELLO-CONNREQ-001]] — Connection package validation
- [[CELLO-CONNREQ-002]] — Two-round connection ceremony
- [[CELLO-SESSION-006]] — Connection gate for session initiation
- [[CELLO-MCP-003]] — M3 MCP tool surface
- [[CELLO-OBS-001]] — Operator protocol logging
- [[CELLO-TESTFIX-001]] — Shared SessionFixture
- [[M3-connreq-002-e2e-test-harness]] — Test harness rewrite (CONNREQ-002 / TESTFIX-001 detail)
- [[M2-frost-threshold-layer]] — M2 write-up
- [[cello-chat]] — Operator startup procedure (M3 edition)
- [[CONTEXT]] — canonical glossary
- [[implementation-roadmap]] — full milestone map
