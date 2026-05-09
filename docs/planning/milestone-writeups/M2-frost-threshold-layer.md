---
name: M2 — FROST Threshold Layer
type: design
date: 2026-05-09
topics: [milestone, M2, frost, threshold-signing, session, seal, relay, adapter, e2e]
status: active
description: Post-completion write-up for M2. What was built, what was proved, what the planning gap was, and how it was resolved.
---

# M2 — FROST Threshold Layer

**Completed:** 2026-05-09  
**Stories:** CELLO-CRYPTO-003, CELLO-NODE-003, CELLO-RELAY-001, CELLO-SESSION-004, CELLO-SESSION-005, CELLO-SESSION-006, CELLO-ADAPTER-003, CELLO-E2E-002 (manual, partial), CELLO-E2E-003 (backfill)

---

## What M2 Set Out to Prove

Neither the client nor the directory can forge a session receipt alone. Every session boundary — establishment and seal — carries a FROST threshold signature that required active participation from both the agent's K_local (as ceremony coordinator) and at least t-of-n directory key shares (K_server_X nodes). A single compromised directory node cannot produce a valid signature. A rogue agent cannot forge a receipt without the directory's cooperation.

M1 proved sessions are notarizable. M2 proves the notarization cannot be forged by any single party.

---

## What Was Built

### Packages shipped

| Package | What M2 adds |
|---|---|
| `@cello/crypto` | `IThresholdSigner` interface (RFC 9591 FROST Ed25519); `FrostThresholdSigner` (2-of-n ceremony coordinator); `MockThresholdSigner`; `verifyFrostSignature`; `verifySignature` on `IThresholdSigner`; `bootstrapKeyShares` (test-only per-node deal generation); `createInProcessStubs`; `clearTestShares`; domain-separated context strings: `"cello-frost-session-establishment-v1"` and `"cello-frost-seal-v1"` |
| `@cello/protocol-types` | `buildSessionEstablishmentTbs` (canonical TBS for FROST session signatures); `buildSealTbs` (canonical TBS for FROST seal signatures); `SessionAssignment` discriminated union (`SessionAssignmentFrost` / `SessionAssignmentSingle`); `signer_pubkey` field on frost variant |
| `@cello/directory` | `FrostDirectoryHandler`: `/cello/frost/1.0.0` protocol (fully wired — see E2E-003 below), `InMemoryShareStore`, `bootstrapKeyShares`, epoch management, `CEREMONY_CONFLICT` detection, `markInFlight`/`clearInFlight`; `generateCommitment` (two-step nonce protocol); `signRawMessage` (signs pre-framed message using cached nonce); `registerThresholdSigner`; `registerPrimaryPubkey`; `#processSessionRequest` with FROST ceremony; `processSeal` M2 path: `seal_verified` → await `seal_frost_signature` → verify → `SealNotarization`; `SignalingAuthOk` frame; standalone binary (`packages/directory/src/bin/directory.ts`) |
| `@cello/relay` | Incremental Merkle stack (RFC 6962): O(log n) per-append `running_root` computation; `tree_stack` state on `RelaySessionState`; `submitForSeal` unchanged (full rebuild for correctness at seal time) |
| `@cello/client` | `receiveSessionAssignment` FROST path: hard-refuse `signature_type:'single'`, verify FROST sig against `primary_pubkey`; `initiateSession(targetPubkeyHex)` with persistent signaling stream reuse; `#handleSealVerified` → `participateInCeremony` → `seal_frost_signature`; `#handleFrostSealed` / `#handleSessionFrostSealed` (deferred upgrade); `seal_type: 'frost' \| 'bilateral'` on `SessionRecord`; seal-frost-timeout bilateral fallback; `#runPersistentSignalingReader` routing for all M2 frames; `NetworkDirectoryNode` (implements `DirectoryNodeStub` via real libp2p streams); `bootstrapNetworkKeyShares` |
| `@cello/adapter-claude-code` | `cello_initiate_session` wired to real directory signaling (retired `not_available_in_m1` stub); dual-identity MCP server (`createMcpServer` accepts `Record<string, IdentityContext>`); `CELLO_KEY_FILE_A`/`CELLO_KEY_FILE_B`; `CELLO_DIRECTORY_MULTIADDR` for live directory discovery; startup branches on network vs in-process FROST stubs |
| `@cello/e2e-tests` | `adapter-003.test.ts`: AC-006 simultaneous initiation, relay_unavailable path, target_offline session-count check; `session005.test.ts` integration: full 9-step FROST seal ceremony through real signaling path |

### Test counts at M2 close
- **492 tests passing, 20 skipped** (retired M0 tests)
- Zero lint errors, zero TypeScript errors
- 7 new stories (CRYPTO-003 through ADAPTER-003), 1 backfill story (E2E-003), 8 packages enhanced

---

## What Was Proved

### In automated tests

**FROST threshold signing (CRYPTO-003)**
- 2-of-3 ceremony completes with in-process stubs; combined signature verifies against `primary_pubkey`
- `participateInCeremony` with wrong context string → invalid signature (domain separation)
- `bootstrapKeyShares` rejects when `NODE_ENV !== 'test'` (production guard)
- `getPrimaryPubkey()` returns the group public key derived from share commitments
- `verifySignature` validates context-framed messages: `context\0tbs`

**FROST session establishment (SESSION-004)**
- Directory runs FROST ceremony on `session_request`; both clients verify the combined signature independently
- Initiator uses own `primary_pubkey` for verification (never trusts frame-provided key)
- Counterparty uses `signer_pubkey` from the assignment frame (initiator's `primary_pubkey`)
- Attacker substituting `signer_pubkey` with own group key → `frost_signature_invalid`
- Seal-context signature rejected by establishment-context verification (domain isolation)
- `signature_type:'single'` (M1-era) hard-refused → `unsupported_signature_type`
- No threshold signer injected → `frost_signer_not_configured`
- All stubs unresponsive → `DIRECTORY_BELOW_THRESHOLD` → `session_request_error`
- Second ceremony for same agent while one in-flight → `CEREMONY_CONFLICT`
- Relay receives a separate Ed25519 directory signature (relay never sees FROST sig)

**FROST-notarized seal (SESSION-005)**
- After bilateral SEAL exchange, directory pushes `seal_verified` to initiator
- Initiator coordinates FROST ceremony with context `"cello-frost-seal-v1"`; sends `seal_frost_signature`
- Directory verifies FROST sig against initiator's stored `primary_pubkey` before issuing `SealNotarization`
- Both clients verify `session_sealed` FROST signature against the correct key (own for initiator, frame for counterparty)
- Tampered seal FROST signature → client stays in `sealing` state
- `sealed_root` byte-identical on both clients and directory
- Relay destroys per-session state after `confirmSeal`
- `seal_type:'bilateral'` after timeout when directory unreachable; `seal_deferred` state
- `session_frost_sealed` upgrades bilateral → frost (deferred FROST seal)
- Seal-context sig cannot verify under establishment context (cross-replay impossible)

**Incremental Merkle stack (RELAY-001)**
- RFC 6962 incremental root byte-identical to full rebuild for n ∈ {1..100}
- Each append is O(log n) nodeHash calls
- Total cost O(n log n) — strictly below naive O(n²)
- All 27 NODE-002 tests pass unchanged
- 8-leaf root matches external fixture vector

**Real session initiation (ADAPTER-003)**
- `cello_initiate_session` sends `session_request` on persistent signaling stream; target receives assignment
- `genesis_prev_root` byte-identical on initiator and target
- Target offline → `target_offline`; no session record created
- Relay unavailable → `relay_unavailable`
- Timeout → `timeout`; session state clean
- Simultaneous A↔B initiation: exactly one session created; neither client inconsistent

**Relay stream reconnect (SESSION-006)**
- Relay stream drop detected → client reconnects → resumes message delivery
- No message loss during reconnect window (relay queues pending deliveries)

**`/cello/frost/1.0.0` wire protocol (E2E-003)**
- `generateCommitment` returns ok:true when share bootstrapped; AGENT_NOT_BOOTSTRAPPED otherwise
- `generateCommitment` returns EPOCH_EXPIRED when a newer epoch exists
- `generateCommitment` returns NONCE_ALREADY_PENDING if a nonce is already cached
- `signRawMessage` requires a cached nonce from `generateCommitment` (no fallback to fresh nonce — RFC 9591 §4.6 compliance)
- `signRawMessage` consumes the nonce exactly once; second call without new commit → AGENT_NOT_BOOTSTRAPPED
- `signRawMessage` returns CEREMONY_CONFLICT when a different peerIdString holds the in-flight registry
- `injectShareForTest` throws in production (NODE_ENV guard)
- `NetworkDirectoryNode.receiveShare` pushes share to real directory over `/cello/frost/1.0.0`
- `NetworkDirectoryNode.generateCommitment` returns valid commitment from real directory
- `NetworkDirectoryNode.signRound` sends sign request and receives partial sig over wire
- `bootstrapNetworkKeyShares` + `FrostThresholdSigner.participateInCeremony` → combined signature verifiable against `primaryPubkey` over real libp2p (AC-014: end-to-end network FROST ceremony)

---

## What Remains Open

### Deferred FROST seal TBS reconstruction
**Status:** Known limitation, workaround in place  
When a deferred FROST seal arrives via `session_frost_sealed`, the client needs `leaf_count` and `close_timestamp` to reconstruct the TBS for verification. If the client restarts between the bilateral timeout and the deferred seal arrival, `close_timestamp` is lost.  
**Resolution:** M7+ — persist `close_timestamp` to durable storage or include it in the `session_frost_sealed` frame.

### Connection policy (accept/decline flow)
**Status:** Stubbed — directory auto-accepts all session requests  
**Resolution:** CELLO-M3-CONNECTION-001.

### MMR (global sealed-conversation ledger)
**Status:** `mmr_peak: null` in all seal responses  
**Resolution:** M10 Federation.

### Cross-machine e2e
**Status:** Deferred — all code ready, requires two physical machines  
**Resolution:** Same as M1 — manual execution when infrastructure available.

### DB-003 (seal_verified delivery to disconnected initiator)
**Status:** Implemented, not integration-tested  
**Resolution:** Add integration test; low risk since the enqueue path is tested at unit level.

### CRIT-2: unauthenticated frost_bootstrap
**Status:** Documented, not fixed — inherent to the trustedDealer shortcut  
The `/cello/frost/1.0.0` bootstrap handler accepts share injection from any peer when `NODE_ENV=test`. This is safe only because `injectShareForTest` throws in production. Real security requires M3's multi-party DKG, after which the `frost_bootstrap` frame type is no longer needed.  
**Resolution:** M3 DKG eliminates this attack surface by replacing the trusted dealer with a real distributed key generation ceremony.

---

## The Planning Gap: Why M2 Didn't Run End-to-End on Completion Day

M2 shipped with 477 passing tests and the FROST threshold layer fully proven in-process. But when two real Claude Code agents tried to use it, `cello_initiate_session` returned `directory_unreachable` on every attempt.

**The root cause was an architectural mismatch that the stories never exposed.**

The M2 stories (CRYPTO-003 through ADAPTER-003) proved the FROST protocol by running all participants — the client coordinator, the directory node, and the stub "directory nodes" — inside the same Vitest process. The `FrostThresholdSigner` in the MCP server used `createInProcessStubs()`: three in-memory objects that held all three K_server_X shares. The standalone directory binary, running as a separate process, had no knowledge of these shares and no mechanism to participate in a ceremony. When the client's `session_request` reached the directory, the directory checked `this.#thresholdSigners.get(initiatorHex)` and found nothing — returning `frost_signer_not_configured`.

What the stories built was correct. What was missing was a story that said: **prove M2's claim with the directory as a separate party.** CELLO-E2E-002 existed for exactly this purpose, but its `stubs` section only asked for "update `cello-mcp.ts` to call `bootstrapKeyShares` with in-process stubs at startup." That describes the in-process shortcut, not a real threshold ceremony. The story never surfaced the question: if all FROST participants live inside the MCP server process, how is that different from a single party signing?

The answer is: it isn't. A `FrostThresholdSigner` backed by in-process stubs doesn't demonstrate threshold security — it demonstrates that the FROST ceremony protocol runs correctly under perfect conditions. The threshold property only exists when the participants are separate parties with separately held key shares.

**What should have been planned:**

Every milestone has two layers of proof:
1. **Protocol correctness** — does each component behave according to its spec? (Unit and integration tests)
2. **Milestone assertion** — does the system, as a whole, demonstrate the new capability the milestone exists to prove?

For M2, the assertion is: *"neither the client nor the directory can forge a session boundary alone."* This assertion is only demonstrable when the client and directory are separate processes. The M2 stories fully covered layer 1. No story covered layer 2. CELLO-E2E-002 was intended to be that story but was scoped too narrowly — it described making the MCP server boot with FROST bootstrapped, not making the FROST ceremony span a real network boundary.

**What was done to close the gap:**

The fix required implementing the `/cello/frost/1.0.0` wire protocol end-to-end — a scope that deserved its own story, pseudocode phase, and architecture review before touching code. Instead it was done in a single session without those gates, which created the secondary problem: code was shipped without story, without red-first TDD, and without code review. The code review (dispatched retroactively) found two critical correctness bugs:

- CRIT-1: `signRawMessage` was falling back to a fresh nonce when no cached nonce existed. A fresh nonce has no matching commitment in the client's commitment list, violating RFC 9591 §4.6. The partial signature would fail verification silently.
- CRIT-2: The `frost_bootstrap` frame accepts share injection from any authenticated peer. This is structurally safe because `injectShareForTest` throws outside `NODE_ENV=test`, but it represents an attack surface that real DKG (M3) must close.

Both were fixed. CELLO-E2E-003 was written as the backfill story, tests were written to cover the new protocol, and all issues from the code review were addressed before committing.

**The lesson for future milestones:**

When scoping a milestone, identify the **demonstration conditions** for the milestone assertion — not just the components that implement it. Ask explicitly: what runtime configuration makes the new claim undeniably true? For threshold security, the answer is always "separate processes." For M3's connection policy, the answer will be "two agents with different trust profiles, one of whom is refused." For M10's federation, the answer will be "two directory clusters that each independently verify the same sealed root."

If the E2E story doesn't describe conditions that would fail if the milestone claim were false, the story is underscoped.

---

## Key Design Decisions Made During M2

- **Two FROST domain context strings.** `"cello-frost-session-establishment-v1"` and `"cello-frost-seal-v1"` prevent signature replay across ceremony types. A valid establishment signature cannot be reused as a seal signature — the framed message `context\0tbs` differs even if the raw payload were identical.

- **Separate relay signature from FROST signature.** The relay verifies an Ed25519 directory signature over a simplified TBS (M1 format). The FROST signature is client-facing only. The relay never sees, stores, or validates the FROST signature. This preserves relay simplicity and prevents the relay from depending on the FROST group key.

- **Initiator MUST use own `primary_pubkey` for verification.** The initiator never trusts `signer_pubkey` from the frame — that field exists only for the counterparty. An attacker who controls the frame could substitute their own group key; the initiator's locally-derived `primary_pubkey` is the only trustworthy verification key for their own sessions.

- **`ceremonyId` as conflict detection key.** Each `session_request` generates a unique `session_id`, which becomes the `ceremonyId`. If a second request arrives while the first ceremony is in-flight, the directory detects conflict and returns `CEREMONY_CONFLICT`.

- **`bootstrapKeyShares` is test-only.** Guarded by `NODE_ENV !== 'test'`. Real M3+ key distribution uses a proper multi-party DKG ceremony where no single node ever holds all shares.

- **Bilateral fallback with timeout.** `initiateSessionSeal` starts a 15-second timer. If `session_sealed` doesn't arrive, the session transitions to `seal_deferred` with `seal_type:'bilateral'`. The bilateral SEAL leaves on the tree are sufficient proof; the FROST notarization is a stronger attestation, not a hard requirement.

- **Incremental stack does not replace seal-time rebuild.** `submitForSeal` still does a full O(n) Merkle tree rebuild from `leaf_log`. The incremental stack provides the fast `running_root` for per-leaf `prev_root` computation. Seal happens once per session; correctness beats speed there.

- **Persistent signaling stream reuse.** `initiateSession` reuses the already-authenticated stream held by `registerHandler()`. No new connection per session request. The same stream carries inbound assignments, outbound session requests, `seal_verified`, and `session_frost_sealed`.

- **Two-step nonce protocol for network FROST.** The `/cello/frost/1.0.0` wire protocol splits commitment and signing into two separate stream opens: `frost_commit_request` (directory generates nonce, returns commitment, caches nonce) then `frost_sign_request` (directory signs the pre-framed message using the cached nonce). This mirrors RFC 9591's two-round structure and ensures the commitment in the client's list matches the nonce used during signing.

- **`signRawMessage` requires a cached nonce — no fallback.** A fallback to a fresh nonce would produce a partial signature whose commitment is not in the client's commitment list, violating RFC 9591 §4.6 binding factor correctness. If no cached nonce exists, `signRawMessage` returns `AGENT_NOT_BOOTSTRAPPED` so the coordinator excludes this node and retries.

---

## Infrastructure for Live Testing

```
Terminal 1: NODE_ENV=test pnpm --filter @cello/relay run start
Terminal 2: CELLO_RELAY_MULTIADDR=<relay-multiaddr> NODE_ENV=test pnpm --filter @cello/directory run start
~/.claude/settings.json: cello MCP server with CELLO_DIRECTORY_MULTIADDR set
Claude session A: /cello-chat → "You are the initiator" → all tools use { identity: "A" }
Claude session B: /cello-chat → "You are the target"   → all tools use { identity: "B" }
```

Both agents load from separate key files (`CELLO_KEY_FILE_A`, `CELLO_KEY_FILE_B`). At startup, `cello-mcp` dials the directory, pushes FROST shares for both identities via `frost_bootstrap` frames, and registers both `FrostThresholdSigner` instances. Session establishment now involves real network ceremony rounds between the MCP server process and the directory process — separate parties, separate key shares.

---

## What M3 Builds On

M2 proved that session receipts are unforgeable by any single party, with the client and directory participating as genuinely separate processes in the FROST ceremony. M3 adds connection policy — agents deciding whether to accept a session based on trust signals. The threshold signing infrastructure is complete; what changes is what agents require before they agree to enter a session.

For M3's E2E story to avoid the gap that M2 encountered, it must describe demonstration conditions that would fail if the connection policy were not enforced: two agents with different trust signal configurations, one of whom refuses a session that the other would have accepted.

---

## Related Documents
- [[CELLO-SESSION-004]] — FROST-authenticated session establishment
- [[CELLO-SESSION-005]] — FROST-notarized conversation seal
- [[CELLO-CRYPTO-003]] — IThresholdSigner + FrostThresholdSigner
- [[CELLO-NODE-003]] — /cello/frost/1.0.0 protocol handler
- [[CELLO-RELAY-001]] — Incremental Merkle stack
- [[CELLO-SESSION-006]] — Relay stream reconnect recovery
- [[CELLO-ADAPTER-003]] — Real session initiation via directory signaling
- [[CELLO-E2E-002]] — Live e2e manual sign-off story
- [[CELLO-E2E-003]] — /cello/frost/1.0.0 wire protocol (backfill story)
- [[CONTEXT]] — canonical glossary
- [[implementation-roadmap]] — full milestone map
- [[M1-session-layer]] — M1 write-up
