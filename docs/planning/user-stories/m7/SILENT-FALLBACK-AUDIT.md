---
name: m7-silent-fallback-audit
type: audit
date: 2026-06-25
topics: [m7, cleanup, silent-fallbacks, persistence, crypto, registration, identity, code-quality]
status: active
description: >
  Exhaustive audit of every silent fallback in the cello-client production source
  (core/*/src, tests and dist excluded). A silent fallback is any path that, when
  something it needs is missing/absent/fails, quietly substitutes something else or
  keeps going instead of failing loud. They make a broken/half-built/misconfigured
  system look healthy. Findings are ranked HIGH→LOW with the real masked failure for
  each, plus a register of designed-resilience paths checked. Source of truth for the
  M7 code-cleanup purge.
---

# Silent-Fallback Audit — cello-client production source (`core/*/src`)

**Repo:** `/Users/andrep/Documents/code/cello-client`
**Scope:** 90 production files across 8 packages (`adapter-claude-code`, `cli`, `client`, `crypto`, `daemon`, `protocol-types`, `transport`). Tests (`*.test.ts`, `*.spec.ts`, `__tests__`) and `dist` excluded.
**Date:** 2026-06-25

## What counts as a silent fallback

Any code path that, when something it needs is **missing / absent / fails**, **quietly substitutes something else or keeps going** instead of failing loud (throwing, or returning an explicit error object with a reason). The danger is uniform: they make a broken, half-built, or misconfigured system **look healthy**.

The four target patterns:

1. **Compatibility / legacy / migration shim** — "if the new location/format/field is absent, use the old one."
2. **Defaults-when-required-thing-missing** — a required value/config/dependency is absent and the code supplies a default that runs in a degraded or possibly-wrong mode instead of erroring.
3. **Catch-and-continue / error swallowing** — `try { … } catch { return [] / null / {} / undefined }`, `catch { /* ignore */ }`, `.catch(() => …)`, log-and-continue that hides the real failure — especially returning empty collections/null where the caller can't tell "genuinely empty" from "failed."
4. **Silent substitution / fire-and-forget** — `??`/`||`/optional-chaining papering over a value that should always be present if upstream did its job, or un-awaited persistence (`void persist*(...)`) that can silently not happen.

## Danger ranking

- **HIGH** — hides identity / key / FROST-share / crypto / registration loss, or silent data loss.
- **MEDIUM** — hides config / wiring errors, or partial degradation.
- **LOW** — cosmetic, bounded, or merely loses diagnostic specificity.

## Headline

The single most dangerous pattern in the repo is **un-awaited fire-and-forget persistence (`void persistence.persist*(...)`)** applied to exactly the records CELLO claims are non-reconstructable: identity keys, FROST shares, hash-chain leaves, seal proofs, and connection decisions. That is **H1** below. Both seed anchors are confirmed by direct reading: the agent-key legacy path (`agent-loader.ts:55-66`) and the un-awaited FROST share persist (`registration-manager.ts:229` daemon / `:201` client) — and the second is far broader than a single line.

---

## HIGH — hides identity / key / share / crypto / registration loss, or silent data loss

### H1 — Un-awaited persistence of every durability-critical record (pattern 4)

A write that rejects (disk full, perms, SQLCipher lock, crash-before-flush) is swallowed by `void`; the function returns success. The system reports the operation done while the durable record was never written. Sites:

- **Registration / identity / FROST share** — `core/daemon/src/registration-manager.ts:176,180,229,287,291,317,323` and `core/client/src/registration-manager.ts:154,158,201,257,261,287,293` — `persistMlDsaKeypair` (post-quantum identity key), `persistRegistrationState`, `persistFrostKeyShare`. `register()` returns a successful `RegistrationState` while these writes are unawaited and their rejections unhandled. **Masks:** the agent reports *registered* but on restart has no FROST share / registration state → silent, unrecoverable loss of the irreplaceable DKG signing share. *(This is the anchor — `:229` daemon / `:201` client plus the siblings.)*
- **Hash-chain Merkle leaf** — `core/client/src/relay-stream-manager.ts:764` — `persistSessionTreeLeaf` fire-and-forget while the in-memory tree advances. **Masks:** a failed leaf write leaves disk behind the chain; on restart the leaf is gone, surfaced only as a `leaves.mismatch` warning *after* the data is already lost.
- **Session sequence state** — `core/client/src/relay-stream-manager.ts:779,785,791,810` — `persistSession` on every leaf-accept / counterparty-closing transition / `#desync`. **Masks:** silent loss of `last_seen_seq` / `last_sent_seq` / `desynchronized` advances; a crash mid-conversation reloads a session whose durable sequence state disagrees with the relay.
- **Seal proof** — `core/client/src/seal-manager.ts:235,272,529,556,633,645,703,804,1025` — every "CRIT-1: persist sealed state" write is `void persistSession(...)`. **Masks:** the FROST/unilateral seal signature and `sealed_root` (the cryptographic proof of session close) can fail to persist while the session is reported sealed — the proof is silently lost.
- **Connection decision** — `core/client/src/connection-manager.ts:175,231,276` — `decidePendingConnectionRequest` is itself fire-and-forget, despite its own CRIT-2 comment (`client-state-persistence.ts:618`) warning that a crash here "enables double-decision on relay replay." **Masks:** the accept/reject decision may never durably move pending→decided; a relay replay after restart can re-trigger a decision on an already-answered request.
- **Lower-value but same bug** — `core/client/src/client.ts:279,426,532` (peer cache, connection policy, known relay) and `core/client/src/connection-inbound-handler.ts:189,337` (pending inbound request). The policy one is security-relevant: a configured connection policy may silently not survive restart.

**Fix:** await each `persist*`, or batch-await before returning success, with a `.catch` that converts a write failure into an explicit error on the registration/seal/decision result.

### H2 — `MockThresholdSigner` is on the production export surface and forges signatures (pattern 4)

`core/crypto/src/frost/frost-threshold-signer.ts:629-644` (line 643 `return { ok: true, signature: sig }`), re-exported at `core/crypto/src/frost/index.ts:38` and `core/crypto/src/index.ts:29`. It fabricates a deterministic 64-byte non-cryptographic signature and reports `ok:true`, with **no `NODE_ENV` guard** — unlike `bootstrapKeyShares`/`clearTestShares` (guarded + unexported) and `InProcessDirectoryNodeStub` (unexported), which are all correctly fenced. **Masks:** one wiring mistake at the composition root (default/typo/test-bleed) and every session establishment and every seal "succeeds" with a forged threshold signature while the FROST ceremony never runs. This is the one gap in an otherwise carefully-fenced set of test artifacts.

### H3 — Legacy 5-field TBS signature-coverage downgrade (pattern 1) — *confirmed by reading*

`core/protocol-types/src/session.ts:188-217` (`buildSessionEstablishmentTbs`). If any one of the five M7 transport fields (`initiatorSessionPeerId`, `initiatorSessionAddrs`, `counterpartySessionPeerId`, `counterpartySessionAddrs`, `transportMode`) is `undefined`, the function silently encodes the old 5-field TBS that does **not** cover session transport routing. Signer and verifier both call this function, so a directory-side omission produces a "valid" FROST signature leaving `transport_mode` (direct vs relay) and session peer IDs **unauthenticated** — exactly the routing/downgrade-MITM binding the M7 fields exist to provide. **Masks:** a silent signature-coverage downgrade governed by optional-field presence; the file's own comment (lines 150-151) warns "any drift would silently break verification."

### H4 — Missing key file → silently mint a new identity (pattern 2/4) — *confirmed by reading*

`core/crypto/src/ed25519.ts:58-111` (`FileKeyProvider.load`, ENOENT swallow `64-70`, generation `88-110`) and `core/crypto/src/ml-dsa.ts:168-218` (`FileMlDsaKeyProvider.load`, ENOENT swallow `172-181`, generation `187-217`). A **corrupt** file throws `key_file_corrupt` (good), but a **missing** file (ENOENT) is treated as first-run and a brand-new identity is generated. **Masks:** a wrong path, deleted file, or unmounted volume is indistinguishable from first-run, so the agent silently becomes a different peer — prior registration, primary_pubkey, endorsements and trust silently lost. The legitimate provisioning path and the catastrophic key-loss path are the same branch with no signal distinguishing them.

### H5 — `mlDsaVerify` returns `false` when the WASM verifier never loaded (pattern 3)

`core/crypto/src/ml-dsa.ts:333-335` (`if (_wasmInstance === null) { return false; }`). `mlDsaSign` correctly throws "WASM not loaded" (`317-319`), but the verifier silently returns `false`. **Masks:** if liboqs WASM fails to init, **every** ML-DSA verification fails as `signature_invalid` / `pseudonym_binding_invalid` (`validateConnectionPackage`) — a broken crypto subsystem is presented to the trust engine as "this peer's signatures are all bad," nullifying the entire ML-DSA trust layer while looking like a hostile peer. Fail-closed against forgery, but it hides "verifier unavailable."

### H6 — Manifest version store swallows corruption → rollback attack (pattern 3)

`core/daemon/src/manifest-version-store-file.ts:31-34` (`getLastSeenVersion`). `catch { return null }` swallows every read/parse error, and a missing/wrong-typed `lastSeenVersion` also returns `null`. **Masks:** a corrupt/tampered/truncated version file reads as "never seen a version," silently bypassing manifest version monotonicity → **enables a consortium-manifest rollback attack.** The file's own header calls this persistence "load-bearing for anti-rollback security."

### H7 — Directory identity verification is optional and off by default (pattern 2/1)

`core/daemon/src/signaling-connect.ts:208-211` and `core/transport/src/signaling-manager.ts:433-435,439-448`. The consortium step-6 Ed25519 identity proof runs **only when `challengeVerifier` is supplied**; absent, `directoryNodeId` defaults to `endpoint.peerId` and the daemon trusts whatever answered ("M6 ran without one"). A `signaling_auth_ok` frame missing `nodeId`/`signature`/`timestamp` produces only a WARN (`directory.auth.challenge.skipped`, reason `no_identity_proof`), not an abort. **Masks:** a strip/downgrade MITM that removes the identity fields is tolerated as "unverified-but-continue"; if the composition root omits the verifier, an impostor directory drives registration and FROST DKG. Composition-root-dependent, but the default is the unsafe one.

### H8 — Permissive directory-peer gater admits any peer (pattern 4)

`core/daemon/src/session-connection-gater.ts:38-42` (`PermissiveDirectoryPeerIdProvider.isDirectoryPeer` → `true`). **Masks:** if this DAEMON-002 stub is still wired for the directory-facing node, the gate admits **any** peer as "the directory," nullifying it. Wiring-dependent; the default is the unsafe one.

### H9 — Agent shown "registered" from K_local key file alone (pattern 4)

`core/daemon/src/daemon.ts:400-412`. `loadAgents` reads only the K_local `key` file; an agent is marked `state:"registered"` with **no startup reconciliation** against `registration-state.json` / `frost-share.json` (grep-confirmed: `FileRegistrationPersistence` is used only in the register handler, never at boot). **Masks:** an agent that lost its registration/share material shows `registered` in `cello_list_agents`; failure surfaces much later as `no_signer` at ceremony time. Directly couples with H1.

### H10 — Unknown `CELLO_ENV` silently resolves to local in-process stubs (pattern 2)

`core/daemon/src/transport-composition.ts:34-35` (`resolveCelloEnv`). A misspelled/unknown env (`prod`, `Production`) resolves to `'local'`, wiring in-process transport stubs with no network. **Masks:** a misconfigured production daemon comes up "healthy" but never talks to a real directory or relay. (`createTransportSelector` throws loud for a known production variant missing a dialer — the gap is the env-string resolution itself.)

### H11 — Store-and-forward mailbox drain failure looks like "empty mailbox" (pattern 3)

`core/daemon/src/content-park-client.ts:133-134,137,146,153,158` (`pull`). Returns `[]` on auth-challenge failure, missing nonce, missing pull-count, or malformed responses (warn-logged, but the caller only sees an empty array). **Masks:** an offline-then-online recipient that fails to authenticate/drain its relay mailbox is indistinguishable from a genuinely empty mailbox → parked store-and-forward messages silently never recovered = **silent message loss.**

### H12 — Directory FROST refusal returns `null`, dropping the reason (pattern 3)

`core/daemon/src/network-directory-node.ts:216,220` (`signRound`). Returns `null` (discarding `resp.reason`, debug-logged only) when a directory node refuses/omits its partial signature. **Masks:** a directory that **lost or corrupted the agent's K_server_X share** looks identical to a transient no-show; the ceremony fails downstream as a generic "threshold not met" → permanent share loss masked as recoverable.

### H13 — Confirmed seal with missing root substitutes 32 zero bytes (pattern 4)

`core/client/src/seal-manager.ts:330-334`. On `seal_unilateral_confirmed`, a missing/malformed `sealed_root` is replaced with `new Uint8Array(32)` and returned as `{ ok:true, sealed_root:<zeros> }`. **Masks:** a directory that confirms a seal without a valid root is treated as a successful seal carrying an all-zero proof root, indistinguishable from a real seal to the caller.

### H14 — Corrupt FROST blob loads as a structurally-valid empty signer / aborts all state (pattern 4 + 3)

`core/client/src/client-startup.ts:92-94,101-103` — a decoded commitment/verifying-share that isn't a `Uint8Array`/`Buffer` becomes `new Uint8Array(0)`, so a partially-corrupt FROST blob loads as a valid-looking signer with empty key material → later signature verification silently uses empty commitments. And `:105-111,123-129` — if FROST CBOR decode or `storeDkgResult` throws, the handler logs `client.frost.share.load.failed` and `return`s, aborting the **entire** `loadClientStartupState`; sessions, connections, peers, policy, and pending requests are never loaded. **Masks:** a single corrupt FROST row produces a client that comes up looking merely "empty" rather than "load failed."

---

## MEDIUM — hides config / wiring errors, or partial degradation

### M1 — Legacy single-file key loaded as agent "default" (pattern 1) — *the named anchor, confirmed*

`core/daemon/src/agent-loader.ts:55-66`. When `~/.cello/agents/` is absent, `~/.cello/key` loads as agent `"default"`. Honestly MEDIUM, not HIGH: it *loads* the key (no key loss), but **masks migration state** — a half-migrated layout (empty `agents/` + legacy `key`) silently drops the legacy identity. Related: `agent-loader.ts:75-77` silently `continue`s past subdirectories without a `key` file, hiding a half-provisioned agent (dir created, key not yet written).

### M2 — Directory-omitted ML-DSA pubkey substituted with local one (pattern 1)

`core/daemon/src/registration-manager.ts:169` and `core/client/src/registration-manager.ts:147,201,250` — `ml_dsa_pubkey: frame[...] ?? mlDsaPubkeyHex` on the `already_registered` paths. **Masks:** if the directory's record omits the ML-DSA pubkey, the client substitutes its own locally-generated one, masking a possible client/directory ML-DSA key divergence.

### M3 — Corrupt own FROST commitments downgrade a seal to "accepted, unverified" (pattern 3)

`core/daemon/src/session-ceremony.ts:411-413` (`verifyBilateralSealCertificate`). A CBOR-decode failure of the agent's **own** FROST-share commitments returns `{ ok:true, verified:false }`. **Masks:** a corrupt local share silently downgrades a verifiable seal to "accepted but not verified."

### M4 — Throwaway ML-DSA identity minted when persistence misconfigured (pattern 2)

`core/daemon/src/registration-manager.ts:107-115` (and the client mirror). When persistence is null and no `mlDsaKeyFile`, the ML-DSA key is generated via `mlDsaKeygen()` with no secret-bytes capture → can never be persisted. **Masks:** a persistence-misconfigured daemon mints a throwaway post-quantum identity each run instead of erroring.

### M5 — Deaf session node reported as created (pattern 3)

`core/daemon/src/session-node-manager.ts:2508-2518` (`#registerContentHandler`). Handler-register failure is logged, but `createSessionNode` continues and returns `{ ok:true }`. **Masks:** a session node that can receive **no** content is reported successfully created.

### M6 — Failed session-row INSERT ignored (pattern 3)

`core/daemon/src/session-node-manager.ts:818-820,1116`. A failed session-row INSERT (error-logged) leaves the session running in-memory with no durable row. **Masks:** on restart the session is unknown and SIGKILL-interrupted recovery never sees it.

### M7 — Verified message attributed to `"unknown"` (pattern 4)

`core/daemon/src/session-node-manager.ts:2184-2187`. Received content is recorded with `senderPubkey ?? "unknown"` when neither the active entry nor the session record yields the counterparty pubkey. **Masks:** a verified message gets transcripted attributed to literal `"unknown"`.

### M8 — Transcript-write failure, message still delivered (pattern 3)

`core/daemon/src/session-node-manager.ts:555-580` (`recordTranscriptMessage`). Write failure caught/logged, message still delivered. **Masks:** the durable readable transcript silently gaps on restart. (The hash-chain leaf is written separately and logs loudly on failure, so chain integrity holds; the readable record diverges.)

### M9 — Counterparty-primary UPDATE with no rows-changed check (pattern 4)

`core/daemon/src/session-node-manager.ts:1406-1411` (`recordCounterpartyPrimary`). Bare UPDATE; if the row doesn't exist yet (race) the counterparty primary is silently not recorded. **Masks:** the responder later falls back to accepting the bilateral seal **without** local verification.

### M10 — Corrupt lock file → spawn a second daemon (pattern 3)

`core/daemon/src/lock-file.ts:44-49` (`readLock`) returns `null` for both shape-invalid and unparseable (corrupt) lock JSON; `connectOrStart` reads that as "no daemon running" and spawns a fresh daemon. **Masks:** two daemons contend for the SQLite write lock (the ceremony-state corruption CLAUDE.md explicitly warns about). Mirror: `core/adapter-claude-code/src/lock-file.ts:114-120` — on `EPERM` checking the prior PID, treats the lock as stale and proceeds, violating the single-instance invariant (M6B-001).

### M11 — Tampered at-rest blob indistinguishable from legacy plaintext (pattern 1)

`core/daemon/src/retry-queue.ts:237` (`#openBlob`: `decrypt(b) ?? b`). A GCM-auth-failed (tampered) at-rest content blob is indistinguishable from a legacy plaintext row and passed through as valid. **Masks:** at-rest tamper of queued content. (Bounded: the recipient cross-checks `content_hash` on receipt.)

### M12 — Missing `leaf_kind` defaults to msg (pattern 2)

`core/client/src/relay-stream-manager.ts:657` — `leafKind = typeof frame["leaf_kind"] === "number" ? … : 0x00`. **Masks:** a seal `ctrl` (0x02) leaf with a dropped kind field is processed as a normal message and does not trigger the `active→sealing` transition.

### M13 — Absent connection policy auto-accepts every peer (pattern 2)

`core/client/src/connection-inbound-handler.ts:79-80` (`else if (!deps.connectionPolicy) { verdict = "accept"; }`) and `core/client/src/connection-manager.ts:125` (`getPolicy() ?? {mode:"open",...}`). **Masks:** absence of a connection policy auto-accepts every inbound connection request; if the policy were ever absent for a non-design reason it would silently admit all peers. (Policy load itself fails loud, so this is degraded-default, not swallowed-error — hence MEDIUM.)

### M14 — Corrupt stored multiaddrs → empty array (pattern 3)

`core/client/src/client-startup.ts:264-266,317`. `JSON.parse(row.*_multiaddrs) … catch { /* ignore */ }` leaves multiaddrs `[]`. **Masks:** corrupt stored endpoint JSON loads a session/peer with no addresses — it appears restored but is silently unroutable (cannot reconnect to relay/directory/counterparty).

### M15 — Undecodable signaling frame silently dropped (pattern 3)

`core/daemon/src/signaling-connect.ts:303-306` and `core/client/src/signaling-manager.ts:511` — `try { frame = decode(...) } catch { continue; }` in the persistent signaling reader. **Masks:** an undecodable directory frame (could be a `dkg_ready` / `seal_verified` / `connection_established`) is silently dropped; the corresponding waiter only fails later as a generic timeout, not "frame corrupt." (Handshake steps 1-6 throw loud — good.)

### M16 — Manifest-poll response dropped if deps unwired (pattern 2/3)

`core/transport/src/signaling-manager.ts:497` (`handleManifestPollResponse`): `if (!this._manifestProvider || !this._manifestVersionStore) return;` with no log. **Masks:** if manifest-poll deps aren't wired, every `manifest_poll_response` is silently dropped — directory key rotations/revocations are never adopted, so the node keeps trusting stale keys until auth eventually breaks, with no signal that polling was never functional.

### M17 — Outbound content path swallow + un-awaited pending-hash persist (pattern 3/4)

`core/client/src/session-manager.ts:604-624` (`sendContentFrame`, "content path failure is silent; 30s grace timer fires") plus un-awaited `void persistPendingHash` at `:444,551,570,578,586`. The content-path swallow is partly by design (grace-timer backstop), but combined with fire-and-forget pending-hash persistence a write failure means the crash-recovery pending-hash record may never exist. **Masks:** outbound message durability/recovery state can silently not persist.

### M18 — Daemon→MCP push notifications discarded (pattern 3)

`core/adapter-claude-code/src/ipc-proxy.ts:183-186` — `if ("notification" in frame) { … continue; }` ("skip for now"). **Masks:** the entire daemon→MCP notification channel (e.g. `cello_session_request` wake-ups) is a no-op through the proxy; inbound-session signaling silently never reaches the agent via push. It only works because the agent polls — if polling regressed, this would hide that notifications are dead.

### M19 — Inbound handler registered only if method happens to exist (pattern 4)

`core/adapter-claude-code/src/server.ts:135` — `if (client != null && typeof client.onSessionAssignment === "function")`. **Masks:** a client missing/renaming `onSessionAssignment` means inbound session events are silently never enqueued; `cello_await_session` just times out forever with no error explaining why.

### M20 — Bootstrap fetch collapses all failures into null (pattern 3)

`core/adapter-claude-code/src/config.ts:52` (`fetchBootstrapMultiaddr`): `catch { return null; }` collapses network error, non-200, and invalid JSON into one `null`. **Masks:** the caller cannot distinguish "directory unreachable" from "directory returned garbage / wrong shape" — a permanent misconfiguration looks identical to a transient outage.

### M21 — Hardcoded production directory URL when env unset (pattern 2)

`core/adapter-claude-code/src/config.ts:18-20` (`resolveDirectoryUrl`) returns the hardcoded `PRODUCTION_DIRECTORY_URL` (`http://directory-us1.cello.mygentic.ai`, line 10) whenever `CELLO_DIRECTORY_URL` is unset. **Masks:** a node intended for dev/staging (or a misconfigured deploy) silently talks to the production us1 directory — the trust-anchor/manifest source — and looks healthy while pointed at the wrong consortium. Documented intent (AC-003) but still papers over missing wiring.

### M22 — Nonce INSERT failure still delivers (pattern 3)

`core/daemon/src/nonce-dedup.ts:171-177`. A nonce INSERT failure is logged but the method returns `false` (delivers), nonce in memory only. **Masks:** after a restart that nonce is forgotten and the replay window reopens.

### M23 — Background manifest-poll error swallowed (pattern 3)

`core/daemon/src/manifest-poll-scheduler.ts:54-56` — `callbackFn().catch(() => {})`. **Masks:** a failed background manifest refresh leaves the daemon on a stale node set for the next window, silently.

### M24 — Pure-receiver reconnect exhaustion produces no signal (pattern 3/4)

`core/daemon/src/session-relay-client.ts:469-474` (`#reconnectFromAnySession`). After the reader loop ends, reconnect is attempted per session node; if all fail, no error is surfaced and no retry timer is set. **Masks:** a pure-receiver session can permanently stop receiving `leaf_deliver` witness/ordering with zero signal (degrades to arrival-order, not data loss).

### M25 — Test root keys and manifest minter on the production barrel (pattern 4)

`core/crypto/src/index.ts:50-57` exports `CONSORTIUM_ROOT_KEYS`, `TEST_CONSORTIUM_ROOT_KEYS`, `makeTestManifest`, `TEST_DIRECTORY_NODE_KEYPAIR`; fixture at `core/crypto/src/manifest-test-fixture.ts:57-80`. `makeTestManifest` mints a fully-valid manifest signed by deterministic officers 0/1/2 and `TEST_CONSORTIUM_ROOT_KEYS` verify it. **Masks:** one wiring mistake (selecting `TEST_*` keys in the client composition root) away from accepting forged consortium manifests. `TEST_OFFICER_SEEDS` are correctly kept unexported; the verifying keys + minter are not.

### M26 — Production consortium root keys are all-zeros placeholders (pattern 2)

`core/crypto/src/consortium-keys.ts:27-33`. Zero keys are not valid Ed25519 points, so `verifyManifest` (`manifest.ts:168-178`) returns false and the manifest falls below threshold — **fail-closed by design.** The hazard is the pressure it creates: production manifest verification always fails, and the "fix" sitting right next to it in the same barrel is `TEST_CONSORTIUM_ROOT_KEYS` (M25). Flag the combination, not the zeros alone.

### M27 — `preAuthToken` typed optional for a required credential (pattern 2)

`core/protocol-types/src/frost-dkg.ts:81` (`preAuthToken?: string`) for a token "required for all new registrations after M6." **Masks:** omitting the pre-authorization token compiles cleanly; enforcement is entirely runtime/server-side, with no compile-time guard. (Type-only file; the directory remains the real gate.)

### M28 — Trust config accepts zero threshold at construction (pattern 2)

`core/transport/src/signaling-manager.ts:284-285` — constructor `this._threshold = opts.threshold ?? 0`, `this._rootKeys = opts.rootKeys ?? []`. **Masks:** a manager constructed without threshold/rootKeys won't fail at construction; it defers to the per-poll `threshold < 1` guard (`:508`, logs error + returns). Fails closed and is guarded upstream by the daemon composition root — but construction accepting a 0-threshold trust config is a silent accept.

---

## LOW — cosmetic, bounded, or loses diagnostic specificity

- **`core/daemon/src/session-node-manager.ts:2669` (pattern 3)** — malformed `content_frame` dropped with a bare `return` and **no log**; the receiver has zero visibility into wire corruption.
- **`core/daemon/src/session-node-manager.ts:1426-1432,1663-1670` (pattern 3)** — `getSealCertificate` / `getPersistedRelayEndpoint` `JSON.parse` catch → `null`; corrupt stored legibility/relay-addrs read as "not sealed / no endpoint."
- **`core/daemon/src/retry-queue.ts:187,191` (pattern 1)** — `agent_name ?? ""` and `content_hash_hex ?? nonce_hex` re-key legacy awaiting rows; dedup/confirm-delete may mismatch.
- **`core/daemon/src/session-assignment-parser.ts:136` / `core/daemon/src/session-relay-client.ts:292` (pattern 4)** — unknown directory/relay error reasons collapse to `"directory_unreachable"` / `"relay_rejected"`, losing the specific cause (the `no_restart_recommendation` diagnosis trap).
- **`core/daemon/src/session-assignment-parser.ts:75` (pattern 2/4) / `core/client/src/session-assignment-parser.ts:61`** — missing/non-string `signature_type` defaults to the weaker pre-DKG `"single"` path; **fails closed** (downstream rejects via `unsupported_signature_type` / hard-reject), bounded.
- **`core/daemon/src/network-directory-node.ts:702,714` (pattern 3)** — `catch { /* ignore */ }` swallows DKG-secret zeroization failure (hygiene gap, not data loss).
- **`core/daemon/src/network-directory-node.ts:401` (pattern 4)** — `?? "PRE_AUTH_TOKEN_MISSING"` fabricated reason, but still propagates as a thrown rejection.
- **`core/client/src/client.ts:330,336` (pattern 3)** — `openPersistentSignalingStream().catch(() => {})` in `registerHandler`/`announceToDirectory`; subsequent operations re-open and surface `directory_unreachable`, so eventual failure is loud. Cosmetic masking of the first attempt.
- **`core/client/src/client-send-helpers.ts:65` (pattern 3)** — `for await (...) {} catch { /* read side error — ignore */ }` after send+close; drain-side error ignored, delivery still judged by `stream.status`.
- **`core/adapter-claude-code/src/notifications.ts:14-16,35-37` (pattern 3)** — both `pushChannelNotification` and `pushSessionRequestNotification` wrap the send in `try { … } catch { /* silently swallow */ }`; wake-up optimization, agent polls, but zero diagnostics on a fully-broken channel.
- **`core/adapter-claude-code/src/ipc-proxy.ts:167-178` (pattern 3)** — malformed IPC JSON resolves the *oldest* pending request with `IPC_DESERIALIZATION_ERROR` (positional heuristic); on a framing desync can mis-attribute an error to the wrong in-flight call. Surfaced as an error, not silent.
- **`core/crypto/src/frost/frost-threshold-signer.ts:329-563` (not one of the 4 patterns)** — extensive `[CLIENT-DEBUG]` `process.stderr.write` of ceremony/key-package internals; violates the injected-logger rule and leaks internals. The `continue`-on-throw paths (`426,549,567`) are bounded by the retry loop and ultimately surface explicit `CEREMONY_EXHAUSTED` / `CEREMONY_TIMEOUT` — not silent successes.

---

## Designed-resilience paths checked

These are NOT silent fallbacks — they are intended redundancy. For each, whether it fails loud when exhausted or could silently mask a permanent failure.

### Could mask a PERMANENT failure (worth hardening)

- **`core/daemon/src/directory-bootstrap.ts:112-115` — last-known-good endpoint.** WARNs and returns the stale endpoint. **The one designed path that could mask a permanent failure:** a directory that permanently rotated its peer-id leaves the daemon dialing a dead endpoint forever, only WARN-logged. Recommend a permanent-failure escalation after N stale re-uses.
- **`core/client/src/seal-manager.ts:871-879,245-274` (FROST→bilateral "seal_deferred").** Ceremony failure/timeout silently downgrades to `seal_deferred`/bilateral with no error to the caller. By design, but the weakest "designed" path: a *permanently* broken threshold signer looks identical to a transient timeout; the only signal is log lines, not a return value. Recommend a loud distinction between "deferred (transient)" and "ceremony permanently failed."
- **`core/transport/src/manifest-stubs.ts:56-59` (`TestManifestProvider.loadAndVerify`).** Returns the manifest with **no** signature verification, and is exported from `core/transport/src/index.ts:48-56`. Production must supply the real `FileManifestProvider` (lives in the daemon). A wiring bug substituting the test provider silently skips manifest verification. Recommend a composition-root guard.

### Fails loud / fail-closed — verified correct

- **Directory reconnect** (`seal-manager.ts:147-161,210-230`; `signaling-manager.ts #doOpen:535-544`) — re-open on dead stream, then fail loud with `directory_unreachable` / return `false`. Does not mask a permanent outage.
- **Relay/transport dial tiering** (direct→relay→dcutr, `transport-selector` / `cello-node-transport-dialer`) and **send tiering** (`session-node-manager.ts:1895-1944`, direct→relay→park) — named terminal reasons when exhausted; dcutr failure correctly non-fatal/DEBUG; park returns a named failure.
- **`signaling-manager` reconnect/backoff** (`signaling-manager.ts:636-678`) — after `maxReconnectAttempts`: ERROR log `directory.signaling.reconnect.failed`, `_status="lost"`, `flushQueue("signaling_lost")` with guidance. `submitMcpOperation`/`submitInternalOperation` (`341-382`) return explicit `{ok:false, reason, guidance}`.
- **Relay reconnect backoff** (`relay-stream-manager.ts:~356-402`) — capped backoff; `#sendMessageLocked` returns `transport_unavailable` while down. Surfaces to caller.
- **DKG node-commitment agreement** (`network-directory-node.ts:698-707`) — **throws** on any node disagreement; the sovereign "no single node forges" invariant is intact.
- **`verifyManifest`** (`manifest.ts:123-205`) — fail-closed and explicit; out-of-bounds/malformed/duplicate entries recorded in `skippedEntries`, never counted toward threshold; below-threshold returns explicit `ok:false`. `hexToBytes` (`214-228`) strict length+regex.
- **Merkle** (`merkle.ts:219-287`) — fail-closed: wrong length, out-of-range index, 31-byte siblings, extra proof elements all return false; constant-time root compare; `inclusionProof` throws on bad index.
- **`verifySignature` / `verifyFrostSignature`** (`frost-threshold-signer.ts:308-314,609-615`) — fail-closed; malformed key/sig rejected (false = invalid), never accepted.
- **`validateEnvelope*`** (`envelope.ts:196-323,551-702`) — hard version gate (no v0↔v1 negotiation), presence+length checks, content-hash recompute before signature, fail-closed. All CBOR deserializers (`deserializeEnvelope*`, `decodeSealPayload`, `decodeSessionLiveness*`, `decodeConnectionPackage`) return explicit error/null/throw, never coerce bad input to a benign value.
- **`ManifestDirectoryChallengeVerifier.verifyChallenge`** (`manifest-stubs.ts:141-143`) — fails closed: catch returns `{valid:false, reason:"signature_invalid"}`, never `valid:true`.
- **`content-cap.readCappedContentFrame`** (`content-cap.ts:56-65`) — oversize/decoder errors → explicit `content_too_large` / `decode_error`, never silent empty/desync.
- **`NodeAutoNatService.getDialability` / `#emitResult`** (`autonat-service.ts:93-96,129-152`) — empty prober set → conservative `DEFAULT_DIALABILITY` **plus** `transport.autonat.unavailable` WARN; drives relay fallback, not a false "dialable" (SI-002).
- **`node.ts:342-386` (`mapDialError`/`mapStreamError`)** — default-to-`connection_lost` returns a structured error, never swallows; throw propagates.
- **`transcript-cipher.ts:65-78`** — decrypt→null surfaced by `readTranscript`'s `undecryptable` count, not silent; `loadOrCreate` throws on wrong key length.
- **`seal-upgrade` completeness gate + `evaluateSealUpgrade` KERNEL** — fail closed.
- **`session-node-manager.ts:2581-2641` (`#recordFrameOrdering`)** — fail closed on bad signature / wrong signer / unknown counterparty. **`:2169-2182` content-hash mismatch gate** — fails loud, records `#contentDesynced`, blocks auto-ack. **`markInterruptedWithDetails` active-only guard** — fails closed against forged/late relay frames.
- **`connect-or-start.ts` `spawnDaemon`** — surfaces a clear error with log tail on child-exit/deadline.
- **`connection-manager.ts:849-854` stream-close unblock** — resolves in-flight requests with explicit `directory_unreachable`.
- **Client-side key/DB providers** (`encrypted-file-signing-key-provider.ts`, `sqlcipher-client-store.ts`, `backup-key-derivation.ts`, `db-key-derivation.ts`) — throw on corruption / wrong key / WAL failure; the signing provider explicitly propagates (SI-003) and never falls back to weaker signing; `sqlcipher` never creates a fresh DB over a corrupt file.
- **`frost/stubs.ts` (`InProcessDirectoryNodeStub`), `bootstrapKeyShares`, `clearTestShares`** — not on the production barrel and/or throw outside `NODE_ENV==='test'`. Correctly fenced. (The one gap is `MockThresholdSigner`, H2.)
- **Sentinels** — `structure2.ts:49-53 SCAN_RESULT_SENTINEL` (`verdict:"unscanned"`, not a fake "clean") and `session-liveness.ts:18-23 'unknown'` (relay never fabricates `'gone'`) — explicit anti-fabrication design, not fallbacks.

---

## Recommended fix order

1. **H1 + H9 together** — await + `.catch` on every `persist*` (or batch-await before returning success), and add boot-time reconciliation. Closes the largest hole: silent identity/share loss reported as success.
2. **H2, H7, H8, and the `manifest-stubs` export** — one-line composition-root guards with outsized payoff (forged signatures, impostor directory, permissive gater, skipped manifest verification).
3. **H3, H4, H5, H6, H12, H13** — each converts a silent crypto/identity degradation into an explicit error.
4. **MEDIUM tier** — convert each swallow/default into an explicit error or a loud, distinguishable log event; thread reasons instead of collapsing them.

## Method note

Findings were produced by four parallel package-cluster audits (daemon; client; crypto + protocol-types; transport + adapter + cli), each reading the code (not just grepping) and judging intent. The two seed anchors and the two highest-impact crypto findings (`ed25519.ts` missing-key generation, `session.ts` legacy TBS) were additionally verified by hand against ground truth before ranking.
