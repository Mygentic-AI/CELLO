---
name: dead-code-and-defect-reduction-workplan
type: implementation
date: 2026-07-13
topics: [dead-code, duplication, daemon, reduction, defects, m8c, code-quality]
status: ready-to-execute
description: >
  Execution plan for reducing cello-client after the M6-era purge. Two parts: SIX DEFECTS
  (act regardless of line count) and ~3,000-3,500 lines of provably dead or duplicated code.
  Every finding carries file:line, a confidence level, and its provenance (verified-by-me vs
  analyst-reported). Read the PROVENANCE and STALE LINE NUMBERS sections before touching anything.
---

# Dead-Code & Defect Reduction — execution plan

> **Pinned to `cello-client` main `0cd0211` and `trustless-cello` main `b7c5bab7` (2026-07-13).**
> Every line number below is valid **only** against those commits. If the file has moved on,
> re-verify before acting. A line number is a pointer, not a proof.
>
> **Published cascade (beta, by Ms_Chelly):** crypto `0.0.20` · daemon `0.0.53` · cli `0.0.51` ·
> connect `0.0.71`. `@cello-protocol/client` is retired and must not publish.

## ⚠️ READ THIS BEFORE DELETING ANYTHING — a purge regression, 2026-07-13

The DEAD-CODE PURGE moved `core/crypto/src/frost/stubs.ts` into `__tests__/` on the strength of the
dead-code report's claim *"Only used by frost.test.ts."* **That claim was false.**
`core/crypto/package.json` declares `./frost/stubs.js` as a **real public subpath export**, and
`trustless-cello/packages/directory` imports `@cello-protocol/crypto/frost/stubs.js` **directly, in five
test files**. Moving it broke the other repo. Fixed in `0cd0211`.

**Three lessons, and every one of them applies to every item in this document:**

1. **A package's `exports` map is a consumer.** Grepping `src/` for importers is not sufficient. A file
   with no in-repo importer can still be a published entry point. **Check `package.json` `exports`/`main`
   before deleting or moving any file.**
2. **Grep BOTH repos.** cello-client and trustless-cello are separate workspaces. An "unused" symbol in
   one is routinely consumed by the other. Every claim in this document was checked across both — but
   check again before you act, because that is exactly the check that was skipped here.
3. **Do not inherit a claim.** The "only used by frost.test.ts" line came from an earlier report and was
   trusted rather than re-verified. **This document is a lead sheet, not a warrant.** Re-verify each item
   against the code before deleting it.

---

## 0. READ THIS FIRST — how to use this document

### Provenance: what is proven vs what is reported

This came from four read-only analysts plus my own spot-checks. **They are not equally solid**, and a
fresh context reading a flat checklist will treat them as if they were. They are not.

**VERIFIED BY ME, directly, in this session** (I ran the greps and read the code):
- The security gateway is never wired in production (§1.0 — but see the DECISION note; this is KNOWN).
- `FileKeyProvider` has zero production consumers.
- The directory's MMR/checkpoint pipeline IS constructed and live.
- `session_not_owned` is unreachable because `getSessionRecord` stamps `agent_name` back from its own argument.
- `cello_backup` / `cello_restore` / `cello_get_inclusion_proof` return `not_implemented` and are
  registered as MCP tools + named in shipped `SKILL.md`.

**ANALYST-REPORTED with stated confidence.** Everything else. Where an analyst said "very high" it
usually cited the grep it ran; where it said "medium," treat it as a lead, not a fact.

**RULE: anything marked RISKY below gets re-verified against the code before it is touched.** In the
RISKY cases the two copies have DIVERGED, and the divergence — not the duplication — is the finding.
Deleting one copy without reading both is how you ship a bug.

### Order of work

**Do the defects (§1) before the deletions (§2).** The deletions are satisfying and safe; the defects
are what actually costs us. Do not bulk-delete your way down §2 and call the unit done.

### Decisions already made — DO NOT RE-LITIGATE

- **The M9 security gateway is unwired ON PURPOSE.** Integration is planned for after M8; M8C is still
  running. It is NOT a bug to re-raise. The only actionable delta is §1.6 (the shipped docs claim
  screening is on).
- **`cello_backup` / `cello_restore` are intentional stubs.** They are meant to be implemented. Leave them.
- **`cello_get_inclusion_proof` was NOT superseded — it is half-built.** See §3.
- **`registerRelayStream` (§2.4) is an UNWIRED FEATURE, not scaffolding.** Deleting it removes
  relay-driven interrupt detection. Andre's call, not a sweep.

---

## 1. THE SIX DEFECTS — act regardless of line count

### 1.1 Two CBOR encoders write the SAME DB column in two different wire formats — RISKY, real
- `core/daemon/src/registration-manager.ts:339-340` writes `frost_commitments` / `frost_verifying_shares`
  using `CBOR_ENC` = `new Encoder({ tagUint8Array: false })` → raw CBOR byte strings (major type 2).
- `core/daemon/src/session-ceremony.ts:21, :357-358` writes **the same two columns** using the **bare**
  `encode` from `cbor-x` (default config, `tagUint8Array: true`) → CBOR tag-64 typed arrays.
- Both land in the same columns via `db-identity-store.ts:457-458`.

**Why it matters:** it works *today* only because `cbor-x`'s own `decode` accepts both. But the entire
stated reason `CBOR_ENC` exists is `signaling-connect.ts:49-50`: *"match the M6 client encoder so the
directory decodes bytes fields … as raw byte strings, not CBOR-tagged values."* So an agent's share
blobs **change format the first time it runs `cello_refresh_shares`**. Any strict-CBOR or non-`cbor-x`
reader sees a different format depending on whether the agent has ever refreshed.

`CBOR_ENC` is declared five times (`registration-manager.ts:24`, `network-directory-node.ts:52`,
`signaling-connect.ts:51`, `session-node-manager.ts:104`, `seal-upgrade.ts:24`). `park-envelope.ts:29`
also uses the bare `encode`.

**Fix:** one exported encoder; make `session-ceremony` and `park-envelope` use it. Decide explicitly
whether existing tag-64 blobs need a migration or whether decode-both is the permanent contract.

### 1.2 The CLI leaks daemon sockets into a bounded pool — RISKY, real
`core/cli/src/commands.ts` — `client.close()` sits *inside* the `try`, **after** `client.send`, at
`:237, :326, :382, :422, :459, :498, :541, :578, :604, :685`. Any IPC throw leaks the connection.
The daemon enforces `IPC_CONNECTION_LIMIT` (`core/daemon/src/types.ts:431`), so this leaks into a
**bounded** resource.

`parity-commands.ts:90` (`withDaemon`) already does this correctly with `finally`, and 18 commands
already use it. `login` (`commands.ts:87`) is the only hand-rolled one that got it right.

**Fix:** route the 9 hand-rolled commands through `withDaemon` / `ipcCommand`. This also collapses ~250
lines (§2.8) — but the leak is the reason to do it.

### 1.3 Two agent-resolution rules for the same operator gesture — RISKY, user-visible
`commands.ts:590 contactCommand` does **not** replay the persisted `use-agent` selection the way
`parity-commands.ts:119-140 withDaemon` does.

Consequence: `cello settings set …` and `cello moniker set …` (which route through `contactCommand`)
**silently ignore `cello use-agent`** and fall through to the daemon's sole-online-agent fallback —
while `cello contacts` (which routes through parity) honors it. Same gesture, two rules. On a
multi-agent machine this writes to the wrong agent.

Also two error vocabularies for one condition: `{daemon:"stopped"} / {daemon:"unreachable"}`
(`commands.ts:598, :608`) vs `emitTransportError("daemon_not_running" | "daemon_unreachable")`
(`parity-commands.ts:99, :110`).

### 1.4 `daemon.ts:667` — `directoryNode` is declared null and NEVER assigned
`let directoryNode: CelloNode | null = null` (`core/daemon/src/daemon.ts:667-668`). There is **no
assignment site anywhere in the file**. `getDirectoryNode()` therefore always returns `null` — and it
is wired into `wireSharedHandlers` and exposed on the `DaemonHandle` interface (`daemon.ts:245-256`).

Treat as a **live bug**, not a deletion: find out what was supposed to assign it.

### 1.5 A fail-OPEN default under a contract the file documents as FAILS-CLOSED
`core/daemon/src/session-node-manager.ts:978` — `row ? row.unread_count : 0`.

A `SELECT COUNT(*)` always returns a row, so the fallback is unreachable *today*. But the surrounding
contract is documented as "FAILS CLOSED", and if this ever fires it **unblocks a send**. A fail-open
default inside a fail-closed gate is a defect even when it cannot currently trigger.

### 1.6 Shipped docs claim screening is active when it is a passthrough
`core/adapter-claude-code/SKILL.md:141` and `README.md:185` tell operators that tiers *"never remove
screening."* The daemon runs `PassthroughGatewayClient` (always-allow) — see the DECISION note above:
the *wiring* is deliberately deferred, but the *claim* is shipped and false. SKILL.md ships **inside the
connect tarball** and instructs the operator's agent.

**Fix (two lines):** reword to "planned" until the gateway is wired. Cheap; do it now.

### 1.7 (bonus) Inconsistent DKG stream discipline — RISKY, one of them is wrong
`core/daemon/src/network-directory-node.ts`: `generateCommitment` (:177) and `signRound` (:231) call
`await stream.close()` (half-close) **before** reading the response. `receiveShare` (:142) and
`dkgRound1/2/3WithNode` (:346, :384, :426) do **not**. Same protocol, same peer, two disciplines. The
code cannot tell you which is correct — a human has to decide.

### 1.8 (bonus) Step-6 directory auth exists twice; the transport copy is INERT — SAFE to delete, but read it first
- **LIVE:** `core/daemon/src/signaling-connect.ts:218-243` (inline verify).
- **INERT:** `core/transport/src/signaling-manager.ts:451-508 processStep5Frame()` + `setHandshakeContext()`
  (:435) + fields `_pendingNonce`/`_agentPubkeyHex` (:254-255) + `_challengeVerifier` (:253/:286) +
  the `challengeVerifier` constructor option (:193). **No callers anywhere.** `daemon.ts:736` passes
  `challengeVerifier` to `createSignalingConnect`; `daemon.ts:742-755` constructs `SignalingManager`
  **without** it.

A reader would reasonably believe the transport copy is the enforcing one. **They also differ:** the
inert copy consumes/clears the nonce as single-use (:469-474, cites "SI-003"); the live copy does not.
**Before deleting, establish whether single-use nonce enforcement is needed on the client side or is
the directory's job.** Do not assume. (~90 lines.)

### 1.9 (NEW, found 2026-07-13 during the comment pass) The relay witness cross-check DEGRADES OPEN — needs a human decision

Found while doing comment archaeology; **surfaced, not fixed** — rewriting a security comment on a
guess is worse than leaving it wrong.

`session-node-manager.ts:3156` carries a SCOPE note saying content tamper-evidence is incomplete
because "that relay hash-submit path is MSG-001's scope and **does not exist yet**." **That reason is
STALE — the path exists.** The sender submits a `K_local`-signed content-hash leaf to the relay
(`session-relay-client.ts:756`, `LEAF_KIND_MSG`), and the receiver gets an independent
`(content_hash → canonical sequence)` binding back on the `leaf_deliver` stream (`SNM:254-259`,
`#witnessedSeq`).

**But the note's CONCLUSION still holds, for a different and worse reason.** The witness is consulted
for **ordering**, and a hash with **no witness is not refused** — it falls back to arrival order
(`SNM:78`: *"relay just doesn't witness the leaf yet"*). So a sender who simply **never submits** to
the relay gets content ingested with no independent hash to check it against. The cross-check
**degrades open**, and `ingestReceivedContent`'s hash compare is then only comparing the frame
against itself — which is exactly the thing the scope note says it cannot prove.

**The decision (Andre's, not a sweep):** is an unwitnessed content leaf supposed to be *refused*
(fail-closed, at the cost of breaking any session where the relay is unreachable — which the park
backstop exists to tolerate), or is arrival-order fallback the intended, accepted trade? The code
cannot tell you; both readings are coherent. **Do not "fix" this by tightening the comment.**

Note the shape: this is the same failure mode as §1.5 (a fail-OPEN default inside a contract
documented as fail-closed) and §1.8 (a security check that an attacker can skip by omitting the field
that triggers it). Three instances is a pattern, not three bugs.

---

## 2. DEAD CODE — ~2,200 lines, provable

Ranked by lines × confidence. Every item below was grepped across **both repos**, production and tests.

| # | What | Where | Lines | Confidence |
|---|---|---|---|---|
| 2.1 | **`envelope.ts` — the whole module.** A v0/v1 copy-paste pair (`buildEnvelope`:146 / `buildEnvelopeV1`:485 etc.) with **zero production consumers**. Production wire encoding moved to Structure1/Structure2 in M7. It is "reachable" only because `index.ts` re-exports it. **KEEP `MAX_CONTENT_BYTES` (:98)** — it is the one live export (`daemon.ts:72, :5729`). | `core/protocol-types/src/envelope.ts` | ~765 | very high |
| 2.2 | **`connection-package.ts` functions** — 21 of 26 exports test-only: `encodeConnectionPackage`:577, `decodeConnectionPackage`:632, `buildPseudonymBinding`:406, `verifyPseudonymBinding`:450, `verifyEndorsement`:469, `verifyAttestation`:486, + consts. **KEEP the `ConnectionPackage` TYPE** — `connection-request.ts` uses it and trustless-cello's directory depends on that. Plus `crypto/src/ml-dsa.ts` `mlDsaSign`:316 / `mlDsaEnsureLoaded`:348 (test-only; ML-DSA is wired nowhere in production). | `core/protocol-types/src/connection-package.ts`, `core/crypto/src/ml-dsa.ts` | ~600 | high |
| 2.3 | **`content_park_*` IPC handlers** — `content_park_deposit`:4030, `content_park_pull`:4050, `content_park_recover`:4200, + `parseRelayPeer`:4024. **No caller anywhere, not even a test.** Not in the shim's proxy list, not in the CLI, not in `vocabulary.ts`. Live parking uses `setContentParkHook`/`startupParkFn`. **KEEP `recoverParkedFromRelay` and `autoRecoverForAgent`** — live via the signaling `onConnected` hook (:754) and the seal-upgrade `recoverContent` callback (:3045). **Bonus: deleting these deletes the §2.11 bug.** | `core/daemon/src/daemon.ts` | ~70 | very high |
| 2.4 | **`registerRelayStream` → `#watchRelayStream` → `markInterruptedWithDetails`.** Zero production callers. `daemon.ts:229-233`'s own comment: *"AC-016 test hook … Not part of the production API surface."* Superseded by `AgentRelayClient`, never rewired (`session-relay-client.ts:586`: *"session_interrupted / content_park_notify are out of scope here"*). **⚠️ THIS IS AN UNWIRED FEATURE, NOT SCAFFOLDING — deleting it removes relay-driven interrupt detection. ANDRE DECIDES.** | `session-node-manager.ts:2473-2591, :4115-4214` | ~230 | high (fact) / medium (intent) |
| 2.5 | **`FileKeyProvider`** — zero production consumers. PERSIST-002 moved K_local into the encrypted `agents` table; `agent-loader.ts:51` builds an `InMemoryKeyProvider` from it. Its key-file parser is also duplicated (`load`:73-85 ≡ `decodeKeyFileSeed`:159-170). **NOTE: `adapter-001.test.ts`'s two surviving cases (AC-001a, SI-002 — the 0o600 checks) test THIS. They were preserved during DOD-LEGACY-MCP-1 on the belief they were live. They are not. They go too.** | `core/crypto/src/ed25519.ts:51-137` | ~85 | verified by me |
| 2.6 | **Symbol-level dead in `session-node-manager`:** `#highWaterSeq` (:316-321) + `getHighWaterSeq` (:3540-3548) — write-only field, its only reader has zero callers, its own comment concedes *"NOT yet consumed by the gate"*; `isContact` (:981-986) — superseded by `isKnown`/`getTier`, the file says so at :1010; `isAutoAccept` (:1017-1023) — *"defined here as the seam"*, a seam nobody entered; `getSessionNodePeerId` (:1452-1460); `getSealInterruptedArtifacts` (:2656-2687); `decodeParkEnvelope` instance wrapper (:3862-3870); `SessionNodeConfig.keepAliveIntervalMs` (:165-171) — accepted, never written, never read; `ABUSE_MAX_SESSION_RECEIVED_BYTES` / `ABUSE_MAX_SESSIONS_PER_UNKNOWN_SENDER` (:113-118) — *"kept for back-compat"* with nothing (**KEEP `ABUSE_MAX_UNKNOWN_SESSIONS_GLOBAL` — live**). | `core/daemon/src/session-node-manager.ts` | ~95 | very high |
| 2.7 | **Unreachable branches.** `session_not_owned` ×2 (`daemon.ts:3464-3472`, `:5639-5641`) — `getSessionRecord` (`session-node-manager.ts:2693-2701`) does `return row ? { ...row, agent_name: agentName } : null`, i.e. it **stamps the argument back onto the row**, so the comparison can never be true. `cello_receive` already deleted its copy for exactly this reason (see the comment at `daemon.ts:5938`); two survivors were missed. Also: the empty `SESSION_TOOLS_REQUIRING_AGENT: string[] = []` (:3250) + the `for` loop over it (:3258-3266) registering unreachable `not_implemented` stubs (**KEEP `NO_CURRENT_AGENT_RESPONSE`** :3252-3256 — 9 live handlers use it); the `if (!parkFn)` guard (:1870-1879) — `startupParkFn` is a non-optional const so `??` always yields a function; `void newRootHex;` (:5838, :5848); `destroySessionNode`'s `"interrupted"`/`"error"` arms and `#insertSessionRow`'s `"sealed"`/`"interrupted"` arms (every call site passes the other value). | `daemon.ts`, `session-node-manager.ts` | ~60 | high |
| 2.8 | **`SignalingManager` step-6 apparatus** — see §1.8. **Read the nonce question first.** | `core/transport/src/signaling-manager.ts` | ~90 | high |
| 2.9 | **Dead CLI contact duplicates.** `contactAdd`:612, `contactRemove`:618, `contactList`:624, `contactSetTier`:632, `contactSetAway`:640 in `commands.ts` are shadowed — `registry.ts` imports **both** `./commands.js` (:17-33) and `./parity-commands.js` (:35-55), and the parity import wins the name collision. The `commands.ts` five are unreachable. | `core/cli/src/commands.ts` | ~35 | high |
| 2.10 | **Zero-consumer exports** (certain, grepped both repos incl. tests): `daemon/src/types.ts:427 ErrorCodes` (the daemon uses raw string literals everywhere instead — `"standing_receiver_unavailable"` appears literally at `daemon.ts:1610, 1737, 1817, 4040, 4062, 4092, 4213, 4739` and more); `protocol-types/src/session.ts:259 decodeSealPayload`; `protocol-types/src/content-delivery.ts:228 isContentParkDeposit`; `gateway/src/detect/model-installer.ts:42 verifyModel`; `gateway/src/detect/injection-patterns.ts:42 injectionPatternsReady`; `gateway/src/detect/secrets.ts:42 secretRulesReady`; `transport/src/protocols.ts:13 CELLO_PROTOCOL_ID` + `:43 AUTONAT_PROTOCOL_ID` (production uses `CELLO_CONTENT_PROTOCOL_ID`); `transport/src/content-cap.ts` (66 lines, both exports test-only); `transport/src/signaling-manager.ts:97 InMemorySignalingOutboundQueue`; `structure2.ts:64 encodeScanResultSentinel` + `:171 verifyStructure2Signature`. | various | ~110 | certain |
| 2.11 | **Broken circuit-multiaddr peer-ID parse.** `daemon.ts:4025-4028 parseRelayPeer` does `multiaddr.split("/p2p/")[1]` → on a circuit address (`…/p2p/RELAY/p2p-circuit/p2p/TARGET`) it returns `"RELAY/p2p-circuit"` as the peer ID. The correct helper already exists and is exported: `directory-bootstrap.ts:65-70 parsePeerIdFromMultiaddr` (`lastIndexOf("/p2p/")`). **Its only callers are the dead §2.3 handlers — deleting them removes the bug.** | `core/daemon/src/daemon.ts` | ~4 | high |

**Test fallout to expect:** most of §2 has a *passing test attached*. That is the point — a symbol whose
only consumer is its own test is dead code with a test bolted on, which is exactly the "AI slop" smell
that motivated the M6 purge. Deleting these means deleting their tests. That is correct, not a loss.

---

## 3. `cello_get_inclusion_proof` — half-built, NOT superseded

The directory side is **live and running**: `trustless-cello/packages/directory/src/bin/directory.ts:281-282`
constructs `MmrStore` and `MmrCheckpointService`; `:1043` constructs `CheckpointCoordinator`. It appends
conversation leaves to an MMR, stages checkpoints, confirms them.

The crypto is **live and tested with zero production consumers**: `core/crypto/src/merkle.ts:178
inclusionProof`, `:219 verifyInclusion`.

The **daemon handler was never rebuilt**. The only implementation ever written lived in
`core/client/src/mcp-server.ts` — deleted by DOD-LEGACY-MCP-1. M6→M7 gave it a `not_implemented` stub
(`daemon.ts:3751-3757`) instead.

**It is not redundant with the sealed receipt.** They are different claims:
- **Sealed receipt** = *you and I* agree this transcript is what happened (bilateral FROST seal).
- **Inclusion proof** = *a third party* can verify a specific message sits in a tree whose root the
  directory has publicly anchored.

The second is the **notary** claim — CELLO's stated core positioning. It is currently ~75% built and
unreachable from any operator.

**Decision needed:** implement the daemon handler (the MMR and the Merkle crypto both already exist), or
unregister the tool from `bin/cello-mcp.ts:360` and `SKILL.md:160`. Shipping it registered-and-failing is
the one option that is strictly worse than either.

---

## 4. DUPLICATION worth collapsing — ~1,300 lines

Ordered by value. **The RISKY ones are risky because the copies have DIVERGED — the divergence is the
finding.** Read both copies before merging.

| What | Where | Lines | Safety |
|---|---|---|---|
| **`err instanceof Error ? err.message : String(err)`** — ~130 inline copies (34 in `session-node-manager.ts`, 26 in `daemon.ts`, 14 in `commands.ts`, 11 in `session-ceremony.ts`, 8 in `retry-queue.ts`…). Two files already define a local `errMsg` (`signaling-connect.ts:62`) that nothing else uses. Plus a **divergent 4th variant** at `session-node-manager.ts:2988-2999` that adds a `.message` probe and a `JSON.stringify` fallback. | everywhere | ~130 | SAFE |
| **Content-hash computed 3× identically** — `sha256(0x00 ‖ bytes)` at `daemon.ts:1064`, `daemon.ts:5802`, `session-node-manager.ts:3261`. The `0x00` is a **protocol domain tag** (msg-leaf) copy-pasted across a security boundary. If one copy drifts, seals silently stop matching. | daemon + SNM | ~15 | SAFE — but high value |
| **The 9 hand-rolled CLI connect/send/close blocks** → `withDaemon`. See §1.2 + §1.3 — the leak and the agent-resolution split are the reason. | `core/cli/src/commands.ts` | ~250 | RISKY (see §1.2/1.3) |
| **`network-directory-node.ts` — 8× "open stream → send CBOR → read one response"** (:140-154, :173-204, :227-259, :344-359, :382-395, :424-437, :825-850, :858-880) + the `dkgRound1/2/3WithNode` rename-triplet (:329, :366, :402). | `core/daemon/src/network-directory-node.ts` | ~120 | RISKY — see §1.7 (half-close divergence) |
| **The tier byte-cap check, copy-pasted inside one function** — `session-node-manager.ts:3315-3337` and `:3439-3462`. The second copy is **deliberate** (a TOCTOU re-check across the `screenInbound` await). Its own comment says it *"must mirror the primary gate exactly"* — which is the argument for one private method called twice. **Extract, call twice. Do NOT delete either call site.** Same shape for the dedup re-check (:3291-3302 / :3419-3428). | SNM | ~22 | SAFE |
| **The IPC handler prologue** — `resolveCurrentAgent` → `missing_params` → `getSessionRecord` → `session_not_found` → status guard, copy-pasted across ~11 handlers (13× `resolveCurrentAgent`, 26× `perConnectionState.get`, 27× `"missing_params"`, 11× `getSessionRecord`). A `withAgent`/`withSession` decorator would absorb it — and the wrapper point already exists (`daemon.ts:6426`, where `renderForSurface` already wraps every handler). **This is the copy-paste channel that PRODUCED the dead `session_not_owned` branch (§2.7).** | `daemon.ts` | ~150-200 | SAFE |
| **Two IPC clients** speaking the same NDJSON protocol to the same socket — `daemon/src/ipc-client.ts` (133 lines, used by CLI) vs `adapter-claude-code/src/ipc-proxy.ts` (422 lines, used by the shim). | both | ~60 | RISKY — **diverged, CLI copy is weaker**: no `MAX_BUFFER_SIZE` cap (proxy caps at 4 MB, `ipc-proxy.ts:68`, matching `ipc-server.ts:139`), no reconnect, and it **throws** where the proxy **resolves** `{ok:false, reason}`. Merging means picking one contract. |
| **`hexToBytes`/`bytesToHex` ×6** — `crypto/preauth-capability.ts:164` and `crypto/manifest.ts:214` are byte-identical and **validating**; `crypto/frost/frost-resharing.ts:40`, `transport/manifest-stubs.ts:232`, `daemon/session-tree.ts:136`, `daemon/identity-migration.ts:71` are **not**. | various | ~40 | RISKY — the 4 non-validating copies silently coerce malformed hex to zero bytes, and `frost-resharing.ts:48` feeds an unvalidated decode straight into `Fn.fromBytes` for a **FROST identifier**. Consolidating onto the validating version is a **hardening**. |
| **`fingerprint()` duplicated across packages** — `daemon/who-label.ts:22-25` vs `adapter-claude-code/channel-params.ts:27-30` (`shimFingerprint`). Same `slice(0,8)`, same `` `agent ${hex}…` ``, same `"agent unknown…"` fallback. The adapter cannot import from the daemon (no dependency), so this cannot be collapsed today. | 2 packages | 4 | RISKY (drift-prone) — a format change to one silently desyncs the doorbell label |
| **`toU8` ×4 with different failure modes** — `signaling-connect.ts:53` (throws), `network-directory-node.ts:527` (returns null), `session-assignment-parser.ts:14` (`toU8Safe`, null), `session-seal-leaf-store.ts:121`. Plus the chunk normalizer `chunk instanceof Uint8Array ? … : …slice()` in 8 files. | various | ~30 | RISKY (divergent failure modes) |

---

## 5. REFACTOR — this is work, not context

**Reduction and refactor are ONE pass, not two.** Doing the deletions first and "refactoring later" means
reading these 11,000 lines twice. Collapsing the handler prologue is *what makes the seams visible*;
deleting `envelope.ts` and the dead park handlers *shrinks the surface you must thread through a
constructor*. Sequence them together (§8).

### 5.1 The core problem, named

**`daemon.ts` is one function.** `startDaemonInternal` opens at :324 and closes at :6575 — **6,251 lines
in a single function body**. All 44 IPC handlers, the seal machinery, the inbound-session queue, the
Telegram poller, the discovery negotiator are **closures over ~33 shared mutable locals**. There are no
classes, no modules, no parameters.

That one fact is *both* why the file is unsplittable today *and* what the refactor IS:

> **The job is converting implicit closure capture into explicit dependencies.**

Every seam below is downstream of it. Nothing can be extracted until the thing it silently captures is
named and passed. This is why the file resists ordinary refactoring and why it has kept growing: adding a
handler costs nothing (just close over more state), and extracting one costs everything (enumerate what it
touches). The gradient points the wrong way. That is the thing to fix.

**`session-node-manager.ts` (4,450) is a different problem:** it is the session manager **plus the
daemon's entire persistence layer**. All 58 `.prepare()` calls in the daemon live here; `daemon.ts` has
**zero**. That boundary is already correct — it just isn't drawn.

### 5.2 Seams, ordered by payoff over risk

| # | Seam | Lines | Interface it needs | Risk |
|---|---|---|---|---|
| **A** | **SQLCipher store out of `session-node-manager`** — schema+migrations (:507-773), transcript (:818-890), watermarks (:892-979), contacts/tiers/monikers (:981-1265), abuse counts (:1267-1350), telegram+settings (:1352-1407), session queries (:2327-2390), seal certs (:2392-2471), seal-interrupted artifacts (:2593-2687), session record (:2689-2746), row insert/update (:4370-4449) | ~1,200 | **`#db`, `#logger`, `#requireAgentId` — nothing else.** | **LOW.** The one clean cut. Caveat: `#getHeldBytesTotal` (:1280) reads `#heldContent`, so the byte-cap check stays behind or takes the held total as an argument. |
| **A1** | **Sub-cut of A, if you only do one thing:** contacts/tiers/monikers/rename/settings/telegram (:981-1265 + :1352-1407) — an address book + policy store with **zero** coupling to any session runtime state | ~430 | `#db`, `#logger`, `#requireAgentId` | **LOWEST.** Start here to prove the pattern. |
| **B** | **Seal cluster out of `daemon.ts`** — leaf TBS/sign/verify (:104-226), sealed + unilateral listeners (:2640-3166), seal-interrupted inbound (:4294-4438), both seal flows (:5164-5620) | ~1,250 | `sessionNodeManager`, `keyProviders`, `logger`, `signalingFor`/`sendOver`, `recoverContent` | **LOW-MED.** Its state is **already seal-private** (`sealKey`, `sealInterruptedInProgress`, `pendingSealWaiters`, `pendingUnilateralWaiters`, `sealUpgradeInFlight`) and it **already takes an injected callback** (`recoverContent`, :3045) — the boundary is half-drawn. It already has siblings: `session-ceremony.ts`, `seal-upgrade.ts`, `seal-frontier-verify.ts`. |
| **C** | **Contacts/settings/moniker IPC out of `daemon.ts`** (:6141-6403) — 8 handlers + `invalidPubkey` + `resolveContactAgent` | ~263 | `sessionNodeManager`, `logger`, `resolveCurrentAgent` | **LOW.** Pairs naturally with A1. |
| **D** | **Bootstrap / manifest / consortium** (:313-566) — straight-line startup producing `{consortiumEndpoints, manifestVerified, directoryEndpointResolver, stopHttpManifestPoll}` | ~254 | — | **LOW.** Clean function extraction; it already returns one object. |
| **E** | **Telegram** (:1089-1282 + :6392-6403) | ~205 | `resolveWho` (needs contacts → do after A1/C) | **LOW.** 6 private vars; exposes exactly 4 entry points. |
| **F** | **Discovery / negotiation** (:1331-1710) — already produces one well-defined object (`resolvedSessionNegotiator`) | ~380 | private: `negotiationInProgress`, `crossNodeBrokerBySession` | **LOW-MED.** |
| **G** | **Standing-receiver manager out of SNM** (:1409-1474, :2160-2165, :4216-4368) | ~230 | needs `take(agentName)` + `stopAll()` + a `#shuttingDown` read | **MED.** `createSessionNode` and `acceptSession` *consume* the receiver (delete-and-take). |
| **H** | **Content park / retry** (after deleting the dead §2.3 handlers) | ~250 | `retryQueue`, `agents`, `keyProviders` | **MED.** |
| **I** | **Inbound-session machinery** (:4439-5069) | ~630 | calls out to **nine** things | **MED-HIGH.** State is private, but the constructor is wide. Do this late, if at all. |

### 5.3 DO NOT CUT — and why

- **Signaling wiring** (`daemon.ts:667-946`). `perAgentSignaling` / `signalingFor` / `sendOver` are the
  daemon's nervous system — read by seal, inbound, discovery, send, and register. This is the **hub**, not
  a leaf. Cutting it means threading a signaling facade into every other module.
- **`cello_send` / `cello_close_session`.** They inline the cursor gate, the gateway/governance call, seal-flow
  dispatch, transcript append, telegram clear, and retry enqueue. They touch `connectionCursors`,
  watermarks, `retryQueue`, `securityGateway`, `sessionNodeManager`, and both seal flows.
- **Connection state / cursors / watermarks** (`daemon.ts:947-1088`). `perConnectionState` and
  `connectionCursors` are keyed on the IPC server's `connectionId` and consumed at **26 sites**.
- **The inbound content state machine in SNM** (`ingestReceivedContent` / `#appendVerifiedContent` /
  `#releaseHeld` / `recordWitnessedSequence`). Five mutually-recursive mutable maps (`#witnessedSeq`,
  `#heldContent`, `#receivedContent`, `#contentDesynced`, `#trees`). Splitting means threading six fields
  through every call.
- **Relay client vs session node.** `#connectSessionRelay`, `sendContent`, `submitSealLeaf`,
  `#maybeAutoAcknowledgeSeal`, `#detachSessionRelay` all key off fields *inside* `ActiveSessionEntry`.
  Extracting "relay" splits the entry itself.

### 5.4 The refactor that pays for itself immediately

**The `withAgent` / `withSession` handler decorator.** The prologue —
`resolveCurrentAgent` → `missing_params` → `getSessionRecord` → `session_not_found` → status guard — is
copy-pasted across ~11 handlers (13× `resolveCurrentAgent`, 26× `perConnectionState.get`, 27×
`"missing_params"`, 11× `getSessionRecord`).

**The wrapper point already exists:** `daemon.ts:6426`, where `renderForSurface` already wraps every
handler.

This is not merely a ~150-200 line collapse. **That copy-paste channel is what PRODUCED the dead
`session_not_owned` branch (§2.7)** — the same guard was pasted into three handlers, one was later found
dead and fixed, and two were missed. A decorator makes that class of bug structurally impossible. Do this
one first; it is the highest leverage change in the file and it is low risk.

---

## 6. COMMENT ARCHAEOLOGY — delete history, keep constraints

**Rule (Andre, 2026-07-13):** *the only comments that belong in the code are relevant to the CURRENT code.
Not history about what happened.*

This is already in the repo's own CLAUDE.md — *"never to say where it came from... that's you talking to
the reviewer, not the next reader, and it's noise the moment the PR merges"* — and it has been widely
violated.

**✅ DONE 2026-07-13** (cello-client `7929962`, branch `reduction`): 42 files, **−354 net lines**, zero
behavior change, gate green (170 files / 1,754 tests — baseline unchanged).

> **The 1,500–3,000 estimate below was WRONG. Recorded so nobody chases it.** It extrapolated block
> size from keyword-marker counts. In reality most of the 888 "story-ID mentions" are *inline
> prefixes* (`M8C-ABUSE-1 (reviewer HIGH fix, D18):`) that strip without removing a line. The real
> archaeology was concentrated in a few large SPARC pseudocode blocks — the 51-line
> `session-node-manager` header, 43 in `retry-queue`, 58 in transport's `node.ts`, the 43-line H-1
> block — and those are now gone. **Comment volume is not the metric; comment TRUTH is.** Most of the
> remaining 31% is legitimate constraint documentation. Do not go hunting for another 2,000 lines.

**Two findings a pure line-count sweep would have missed** (the real payoff of the pass):
1. The 43-line H-1 scope block in `daemon.ts` justified a live limitation by pointing at `core/client`
   — the package deleted last week. **21 comments still cited it.**
2. `crypto/index.ts`'s `ed25519_FROST` re-export **looked dead** (no in-package caller; its comment
   named the deleted client as its only consumer). It is **LIVE** — `network-directory-node.ts:16`
   imports it *from that re-export* and runs the whole client-side DKG on it. Deleting it would have
   repeated the frost/stubs regression, in the same package, from the same bad grep.

**Original (superseded) estimate:** production was **13,096 comment lines (31% of 41,633)**; a keyword
scan found **261 archaeology marker lines** and **888 story-ID mentions**.

### The test

**KEEP — states a constraint the code cannot show:**
- `// SHA-256(0x00 ‖ bytes) — 0x00 is the msg-leaf domain tag (RFC 6962 §2.1)`
- `// FAILS CLOSED: an unknown reason must not unblock a send`
- `// Claude Code silently DROPS meta keys with hyphens`
- `// The relay MUST start before the directory (it authenticates admin frames against CELLO_DIRECTORY_PUBKEY)`

**DELETE — narrates what happened:**
- "This block used to build X… it's gone because…"
- "An earlier version of this comment claimed Y — that was WRONG, and review caught it"
- "CORRECTION (review, 2026-07-12) — the first attempt got it backwards"
- "I claimed Z… that claim was false, and <name> caught it"
- Tombstones over deleted code. **Git already holds this.** Written in two places, only one of them decays.

Story-ID mentions split by the same test. `// SI-001 / INV-CONTENTFREE: no message text rides the doorbell`
is a constraint with a citation — **keep**. `// DOD-ONBOARD-HELP-1 renamed this tool; the old name was…`
is history — **delete**.

### Note for whoever executes this

**A large share of the worst offenders are recent, and mine** (the DOD-LEGACY-MCP-1 and dead-code-purge
tombstones, the "CORRECTION" blocks, the deletion rationales). **Do not treat them as load-bearing.** They
were written to win an argument that is now over and recorded in the commit messages, where it belongs.
Delete them without ceremony.

Also stale and worth killing: the 64-line SPARC pseudocode header at `session-node-manager.ts:1-64`, which
**contradicts the code it heads** — it says *"Open SQLite (node:sqlite)"* while the file uses SQLCipher, and
`node:sqlite` is banned in this project.

**Zero behavior change. Gate still applies** (a stray `*/` inside a comment terminates the block early — this
bit us on 2026-07-13 when `` `rm -rf core/*/dist` `` in a header comment silently ended the comment and made
the rest of the file parse as code).

---

## 7. Code-vs-comment baseline

Measure before quoting a line count — **raw line counts overstate code by ~40%.**

| | total | code | comment | blank |
|---|---:|---:|---:|---:|
| `daemon.ts` | 6,575 | **4,271** (65%) | 1,995 (30%) | 310 |
| `session-node-manager.ts` | 4,450 | **2,598** (58%) | 1,622 (36%) | 231 |
| all live production | 41,633 | **25,225** (61%) | 13,096 (31%) | 3,312 |
| tests (contrast) | 43,759 | 31,725 (73%) | 6,485 (15%) | 5,549 |

---

## 8. Execution order — reduction and refactor interleaved, ONE pass

The ordering is deliberate: **delete before you extract** (less surface to thread through a constructor),
and **decorate before you split** (the decorator is what makes the seams visible).

**Phase 0 — ✅ COMPLETE 2026-07-13** (branch `reduction`, worktree `cello-client-reduction`)
1. **§1.6 ✅** — `45d5b39`. NOT two lines: **six** operator-facing surfaces claimed screening was
   active. The two docs were known; the **four MCP tool descriptions were not**, and they are worse —
   a tool description is read by the operator's *agent* every session, and they said "always screened"
   / "Every tier is still screened" while the daemon runs `PassthroughGatewayClient`. Tier caps and
   the unknown-sender gate ARE enforced, so those claims stayed; only content-screening ones went.
2. **§6 ✅** — `7929962`. −354 net, not 1,500–3,000 (see §6 for why the estimate was wrong).

**Phase 1 — defects (this is why we are here)**
3. **§1.2 + §1.3 + §4's CLI row** — route the 9 hand-rolled commands through `withDaemon`. Fixes the socket
   leak AND the agent-resolution split AND collapses ~250 lines. One unit, three wins.
4. **§1.1** — the CBOR encoder split. Decide the migration question explicitly.
5. **§1.4, §1.5** — the two latent bugs (`directoryNode` never assigned; the fail-open default).

**Phase 2 — delete (shrinks the refactor surface)**
6. **§2.1** — `envelope.ts` (~765 lines; keep `MAX_CONTENT_BYTES`). Safest big win.
7. **§2.3 + §2.11** — the dead park handlers. Removes a bug for free.
8. **§2.5, §2.6, §2.7, §2.9, §2.10** — the rest of the dead code, **with their tests**.

**Phase 3 — refactor (now the file is small enough to see)**
9. **§5.4 — the `withAgent`/`withSession` decorator.** Highest leverage change in `daemon.ts`. Do it before
   any seam: it removes the copy-paste channel that produced the dead branches, and it forces the handler
   dependencies to be named — which is the whole refactor in miniature.
10. **§4's `errMsg` + the 3× content-hash** — safe collapses; the content-hash one is a protocol domain tag
    copy-pasted across a security boundary, so it matters more than its 15 lines suggest.
11. **§5.2 Seam A1** (contacts/settings out of SNM, ~430) — the proving ground. Zero coupling to session runtime.
12. **§5.2 Seam A** (the rest of the SQLCipher store, ~1,200) — the boundary the codebase already drew.
13. **§5.2 Seams C, D, E** (contacts IPC, bootstrap, telegram) — low risk, mechanical.
14. **§5.2 Seam B** (the seal cluster, ~1,250) — the big one. Its boundary is already half-drawn.
15. **§5.2 Seams F, G, H** — only if the earlier ones went cleanly.

**Never: §5.3.** Signaling wiring, `cello_send`/`cello_close_session`, connection cursors, the inbound
content state machine, relay-vs-session-node.

**Needs a human decision first — do NOT batch these:**
- **§1.7** (DKG half-close divergence — one of the two is wrong; a human must say which)
- **§1.8** (step-6 auth: is single-use nonce enforcement the client's job or the directory's?)
- **§2.2** (`connection-package` functions — keep the TYPE)
- **§2.4** (`registerRelayStream` — an unwired FEATURE, not scaffolding)
- **§3** (`cello_get_inclusion_proof` — implement, or unregister?)

### Gate after every step

```
pnpm run test → pnpm run lint → pnpm run typecheck → pnpm run build
```

**And `rm -rf core/*/dist core/*/*.tsbuildinfo` before any build that follows a deletion.** `tsc --build`
is incremental and never removes orphaned outputs, and `tsc --build --clean` does **not** remove them
either (it only cleans what it still tracks; an orphan's source is gone, so it isn't tracked). A warm tree
keeps compiling and PACKING files whose source you deleted. This bit us on 2026-07-13 when `dist/server.js`
reappeared on merged main with every test green and a pack would have re-shipped the exact dead vocabulary
we had just removed.

---

## Related

- [[M8C-DEFINITION-OF-DONE]] — `DOD-LEGACY-MCP-1` (the unit that cut the tether and made this possible)
- [[2026-07-12_dod-legacy-mcp-1-deletion-plan]] — the per-case triage method used there; reuse it here
- `cello-client docs/dead-code-report.md` — the original file-level report (its step 1 is DONE)
