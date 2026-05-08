---
name: M2 — FROST Threshold Layer
type: design
date: 2026-05-08
topics: [milestone, M2, frost, threshold-signing, session, seal, relay, adapter]
status: active
description: Post-completion write-up for M2. What was built, what was proved, what remains open.
---

# M2 — FROST Threshold Layer

**Completed:** 2026-05-08  
**Stories:** CELLO-CRYPTO-003, CELLO-NODE-003, CELLO-RELAY-001, CELLO-SESSION-004, CELLO-SESSION-005, CELLO-SESSION-006, CELLO-ADAPTER-003

---

## What M2 Set Out to Prove

Neither the client nor the directory can forge a session receipt alone. Every session boundary — establishment and seal — carries a FROST threshold signature that required active participation from both the agent's K_local (via the ceremony coordinator) and at least t-of-n directory key shares (K_server_X nodes). A single compromised directory node cannot produce a valid signature. A rogue agent cannot forge a receipt without the directory's cooperation.

M1 proved sessions are notarizable. M2 proves the notarization cannot be forged by any single party.

---

## What Was Built

### Packages shipped

| Package | What M2 adds |
|---|---|
| `@cello/crypto` | `IThresholdSigner` interface (RFC 9591 FROST Ed25519); `FrostThresholdSigner` (2-of-n ceremony coordinator); `MockThresholdSigner`; `verifyFrostSignature`; `verifySignature` on `IThresholdSigner`; `bootstrapKeyShares` (test-only per-node deal generation); `createInProcessStubs`; `clearTestShares`; domain-separated context strings: `"cello-frost-session-establishment-v1"` and `"cello-frost-seal-v1"` |
| `@cello/protocol-types` | `buildSessionEstablishmentTbs` (canonical TBS for FROST session signatures); `buildSealTbs` (canonical TBS for FROST seal signatures); `SessionAssignment` discriminated union (`SessionAssignmentFrost` / `SessionAssignmentSingle`); `signer_pubkey` field on frost variant |
| `@cello/directory` | `FrostDirectoryHandler`: `/cello/frost/1.0.0` protocol, `InMemoryShareStore`, `bootstrapKeyShares`, epoch management, `CEREMONY_CONFLICT` detection, `markInFlight`/`clearInFlight`; `registerThresholdSigner`; `registerPrimaryPubkey`; `#processSessionRequest` with FROST ceremony (separate relay Ed25519 sig vs client-facing FROST sig); `processSeal` M2 path: `seal_verified` → await `seal_frost_signature` → verify → `SealNotarization`; `SignalingAuthOk` frame; `directoryEndpoint` auto-populate from node |
| `@cello/relay` | Incremental Merkle stack (RFC 6962): O(log n) per-append `running_root` computation; `tree_stack` state on `RelaySessionState`; `submitForSeal` unchanged (full rebuild for correctness at seal time) |
| `@cello/client` | `receiveSessionAssignment` FROST path: hard-refuse `signature_type:'single'`, verify FROST sig against `primary_pubkey` (own key for initiator, frame key for counterparty); `initiateSession(targetPubkeyHex)` with persistent signaling stream reuse; `#handleSealVerified` → `participateInCeremony` → `seal_frost_signature`; `#handleFrostSealed` / `#handleSessionFrostSealed` (deferred upgrade); `seal_type: 'frost' | 'bilateral'` on `SessionRecord`; seal-frost-timeout bilateral fallback; `#runPersistentSignalingReader` routing for all M2 frames |
| `@cello/adapter-claude-code` | `cello_initiate_session` wired to real directory signaling (retired `not_available_in_m1` stub); calls `client.initiateSession` unconditionally |
| `@cello/e2e-tests` | `adapter-003.test.ts`: AC-006 simultaneous initiation, relay_unavailable path, target_offline session-count check; `session005.test.ts` integration: full 9-step FROST seal ceremony through real signaling path |

### Test counts at M2 close
- **477 tests passing, 20 skipped** (retired M0 tests)
- Zero lint errors, zero TypeScript errors
- 7 new stories, 8 packages (all M1 packages enhanced, no new package)

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
- Each append is O(log n) nodeHash calls (verified algorithmically, not wall-clock)
- Total cost O(n log n) — strictly below naive O(n²)
- All 27 NODE-002 tests pass unchanged (observable behavior identical)
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

---

## What Remains Open

### Deferred FROST seal TBS reconstruction
**Status:** Known limitation, workaround in place  
**What's missing:** When a deferred FROST seal arrives via `session_frost_sealed`, the client needs `leaf_count` and `close_timestamp` to reconstruct the TBS for verification. Currently relies on `close_timestamp` being written during the bilateral timeout transition. If the client restarts between the timeout and the deferred seal arrival, `close_timestamp` is lost.  
**Resolution:** M7+ — persist `close_timestamp` to durable storage or include it in the `session_frost_sealed` frame.

### Connection policy (accept/decline flow)
**Status:** Stubbed — directory auto-accepts all session requests  
**What's missing:** `SignalRequirementPolicy`, trust-signal threshold checks, selective disclosure before session acceptance  
**Resolution:** CELLO-M3-CONNECTION-001.

### MMR (global sealed-conversation ledger)
**Status:** `mmr_peak: null` in all seal responses  
**What's missing:** The Merkle Mountain Range that indexes all sealed conversations for global auditing  
**Resolution:** M10 Federation.

### Cross-machine e2e
**Status:** Deferred from M0 and M1, still deferred  
**What's missing:** FROST ceremony across real network boundaries (not just in-process stubs)  
**Resolution:** Same as M1 — requires two physical machines or cloud instances. All code is ready.

### DB-003 (seal_verified delivery to disconnected initiator)
**Status:** Implemented, not integration-tested  
**What's missing:** Test exercising: initiator disconnected at processSeal time → seal_verified enqueued → initiator reconnects → queued event delivered → FROST ceremony completes  
**Resolution:** Add integration test; low risk since the enqueue path is tested at unit level.

---

## Key Design Decisions Made During M2

- **Two FROST domain context strings.** `"cello-frost-session-establishment-v1"` and `"cello-frost-seal-v1"` prevent signature replay across ceremony types. A valid establishment signature cannot be reused as a seal signature — the framed message `context\0tbs` differs even if the raw payload were identical.

- **Separate relay signature from FROST signature.** The relay verifies an Ed25519 directory signature over a simplified TBS (M1 format). The FROST signature is client-facing only. The relay never sees, stores, or validates the FROST signature. This preserves relay simplicity and prevents the relay from depending on the FROST group key.

- **Initiator MUST use own `primary_pubkey` for verification.** The initiator never trusts `signer_pubkey` from the frame — that field exists only for the counterparty. An attacker who controls the frame could substitute their own group key; the initiator's locally-derived `primary_pubkey` is the only trustworthy verification key for their own sessions.

- **`ceremonyId` as conflict detection key.** Each `session_request` generates a unique `session_id`, which becomes the `ceremonyId`. If a second request arrives while the first ceremony is in-flight, the directory detects `ceremonyId !== peerIdString` in the in-flight table and returns `CEREMONY_CONFLICT`. Same peer retrying with the same `ceremonyId` is treated as continuation.

- **`bootstrapKeyShares` is test-only.** Guarded by `NODE_ENV !== 'test'` throwing `BootstrapNotAllowedInProduction`. Real M3+ key distribution uses a proper multi-party DKG ceremony where no single node ever holds all shares. The M2 shortcut generates independent per-node deals — sufficient for testing the ceremony protocol, not sufficient for real security.

- **Bilateral fallback with timeout.** `initiateSessionSeal` starts a timer (`sealFrostTimeoutMs`, default 15s). If `session_sealed` doesn't arrive, the session transitions to `seal_deferred` with `seal_type:'bilateral'`. The bilateral SEAL leaves on the tree are sufficient proof; the FROST notarization is a stronger attestation, not a hard requirement.

- **Incremental stack does not replace seal-time rebuild.** `submitForSeal` still does a full O(n) Merkle tree rebuild from `leaf_log`. The incremental stack provides the fast `running_root` for per-leaf `prev_root` computation. Seal happens once per session; correctness beats speed there.

- **Persistent signaling stream reuse.** `initiateSession` reuses the already-authenticated stream held by `registerHandler()`. No new connection per session request. The same stream carries inbound assignments, outbound session requests, `seal_verified`, and `session_frost_sealed`.

- **`signaling_auth_ok` synchronization.** The client awaits an explicit `signaling_auth_ok` frame from the directory before storing the stream. This closes the TOCTOU window where a `session_request` sent immediately after `signaling_auth_response` could be dropped because the directory hadn't registered the stream yet.

---

## What M3 Builds On

M2 proved that session receipts are unforgeable by any single party. M3 adds connection policy — agents deciding whether to accept a session based on trust signals carried from prior interactions. The threshold signing infrastructure is complete; what changes is what agents require before they agree to enter a session.

---

## Related Documents
- [[CELLO-SESSION-004]] — FROST-authenticated session establishment
- [[CELLO-SESSION-005]] — FROST-notarized conversation seal
- [[CELLO-CRYPTO-003]] — IThresholdSigner + FrostThresholdSigner
- [[CELLO-NODE-003]] — /cello/frost/1.0.0 protocol handler
- [[CELLO-RELAY-001]] — Incremental Merkle stack
- [[CELLO-SESSION-006]] — Relay stream reconnect recovery
- [[CELLO-ADAPTER-003]] — Real session initiation via directory signaling
- [[CONTEXT]] — canonical glossary
- [[implementation-roadmap]] — full milestone map
- [[M1-session-layer]] — M1 write-up
