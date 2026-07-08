---
name: SEC-2 — FROST signing-path authentication (fix design + follow-through)
type: discussion
date: 2026-07-08
topics: [security, frost, sec-2, k-local-auth, directory, cello-client, cross-repo, migration, rfc-8032, rfc-9591]
description: >
  Design + follow-through for fixing SEC-2, the pre-existing CRITICAL forgery hole in the FROST
  signing path: the /cello/frost/1.0.0 commit/sign requests are unauthenticated, so any party
  knowing an agent's PUBLIC k_local key can drive T directories to sign arbitrary bytes. Fix:
  require each frost request to carry a K_local Ed25519 signature bound to (agentPubkey, epochId,
  framedMsg), verified by the directory before it touches its share. Stateless, no extra round-trip.
  Client ships first, directory enforces second (migration order is load-bearing).
---

# SEC-2 — FROST signing-path authentication

## The hole (confirmed from current code, not memory)

`/cello/frost/1.0.0` is a stateless one-request-per-stream protocol. The directory's
`#handleFrostStream` processes both signing frames with the ONLY gate being an `#isAgentPaused`
honor-check:

- `frost_commit_request` → `directory-node.ts:1238`; gate at `:1249`; then `generateCommitment`.
- `frost_sign_request` → `directory-node.ts:1271`; gate at `:1289`; then `signRawMessage` over the
  **client-supplied `framedMsg` bytes verbatim** (`:1297-1304`).

`agentPubkey` in every frame is the agent's **public** k_local key (agent_id == k_local pubkey).
Nothing proves the caller holds the corresponding **private** key. Because the FROST group is
`(T, N+1)` with `T = majority(N) ≤ N` and the directory enforces quorum `|Q| ≥ T`, **T directory
partials alone reach threshold without the client's share**. So a party knowing only an agent's
public k_local key + epoch opens `/cello/frost/1.0.0` to T directories, runs commit then sign over
an ARBITRARY `framedMsg`, and aggregates a valid signature against the agent's `primary_pubkey` —
forging seals, session establishment, any group signature. The directory ALB is internet-facing, so
the oracle is reachable by anyone. Pre-existing since the M2/M6B FROST path; not introduced by M8C.

## The pattern we already have and will mirror

The **signaling** stream already proves K_local possession (`directory-node.ts:1640-1689`):
directory sends a nonce → client returns `Ed25519(SHA-256("CELLO-DIR-AUTH-v1" || nonce || pubkey))`
signed with K_local priv → directory `verify(pubkey, msgHash, sig)`. The client already holds and
uses the K_local `SigningKeyProvider` (`signaling-connect.ts:200` — `identity.keyProvider.sign`).
So both sides already have exactly what a frost-stream auth needs; we are not inventing a primitive.

## The fix — a self-authenticating request (stateless, no extra round-trip)

Add a K_local signature to each frost request, bound to the request's content. Domain
`"CELLO-FROST-AUTH-v1"` (Ed25519, RFC 8032; FROST ceremony per RFC 9591 unchanged).

- **`frost_sign_request`** gains `authSig` =
  `Ed25519_sign(K_local_priv, SHA-256("CELLO-FROST-AUTH-v1" || agentPubkey_bytes || utf8(epochId) || framedMsg))`.
- **`frost_commit_request`** gains `authSig` =
  `Ed25519_sign(K_local_priv, SHA-256("CELLO-FROST-AUTH-v1" || agentPubkey_bytes || utf8(epochId) || utf8("commit")))`.

The directory, BEFORE `generateCommitment` / `signRawMessage` (and before/with the existing
`#isAgentPaused` gate), recomputes the hash from the `agentPubkey` + `epochId` (+ `framedMsg` for
sign) it already has, and verifies `authSig` against `agentPubkey` as the Ed25519 public key. Missing
or invalid → reject with a new reason (`AUTH_REQUIRED` / `AUTH_INVALID`), no share touched.

### Why self-signed, not a nonce challenge (decided — logging, not asking)

- **Stateless + zero extra round-trip.** The frost handler is one-shot per stream and a ceremony
  fans out to T directories; a nonce challenge would add a round-trip to every leg on the hottest
  path. Self-signed keeps the exact current frame count.
- **Binding to `framedMsg` is what actually kills the forgery.** The attack is "sign an ARBITRARY
  `framedMsg`." A K_local signature over that exact `framedMsg` cannot be produced without K_local
  priv, so the forgery is closed regardless of replay.
- **Replay is harmless.** A replayed sign_request reproduces an identical partial over the same
  `framedMsg` (nothing new; the aggregate for that message is already on the wire). A replayed
  commit_request just makes the directory generate a fresh nonce commitment — and an attacker
  without K_local priv can't produce a valid commit `authSig` at all, so they can't even initiate.
- Identity is bound: `authSig` covers `agentPubkey`, so an agent can only authorize signing for its
  OWN identity (it holds only its own K_local priv). No cross-agent impersonation.

## Directory verification (exact steps, both frames)

1. Read `authSig` from the frame; if absent → `{ ok:false, reason:"AUTH_REQUIRED" }`, close.
2. `pubkeyBytes = fromHex(agentPubkey)`; `h = SHA-256(domain || pubkeyBytes || utf8(epochId) || tail)`
   where `tail = framedMsg` (sign) or `utf8("commit")` (commit).
3. `if (!verify(pubkeyBytes, h, authSig))` → `{ ok:false, reason:"AUTH_INVALID" }`, close.
4. Only then the existing `#isAgentPaused` check and `generateCommitment` / `signRawMessage`.

## Rollout order — LOAD-BEARING (the migration point)

The directory-enforcing change **rejects any client that omits `authSig`**. So:

1. **Client first.** Ship the client that ADDS `authSig` (an old directory ignores the extra CBOR
   field → fully backward-compatible). Publish cascade → promote `latest` → reinstall all agents
   (Andre's local set + the EC2 demo). No breakage: new client ↔ old directory still works.
2. **Directory second.** Deploy the directory that REQUIRES + verifies `authSig`. Now old clients
   (none left) would break; new clients pass. 25-30 min, all 3 regions.
3. **Live smoke.** A real cross-agent session + bilateral seal still completes (legit K_local path);
   and a forged request (valid `agentPubkey`, no/other K_local) is rejected `AUTH_INVALID`.

Pre-launch the installed base is ~4 agents Andre controls, so the client→directory window costs
nothing. Post-launch this same change would strand every un-upgraded agent — which is exactly why
it's done now.

## Test plan (TDD, red first)

**Client (cello-client):**
- commit/sign frames now carry `authSig`; the bytes verify against the agent's k_local pubkey over
  the specified hash (assert the exact binding, not just "a field exists").
- tamper: flipping one `framedMsg` byte makes the client-produced `authSig` fail verification (teeth).

**Directory (trustless-cello):**
- valid `authSig` → commit/sign proceeds (happy path unchanged).
- **missing `authSig`** → `AUTH_REQUIRED`, share NOT touched (the pre-fix behavior is now refused).
- **wrong-key `authSig`** (signed by a different key = the forgery) → `AUTH_INVALID`, share NOT
  touched. This is the SEC-2 exploit as a test: knowing only the public key is not enough.
- **tampered `framedMsg`** (auth signed over msg A, request carries msg B) → `AUTH_INVALID`.
- paused-agent + valid auth still → `AGENT_SUSPENDED` (ordering preserved).

## Files (expected)

- **cello-client** `core/daemon/src/network-directory-node.ts` — thread the K_local
  `SigningKeyProvider` into `NetworkDirectoryNode`; sign + attach `authSig` on commit/sign. Possibly
  `core/client/src/network-directory-node.ts` (the client-package twin) + the DKG coordinator wiring
  that constructs these. Frame types in `core/protocol-types` if typed there.
- **trustless-cello** `packages/directory/src/directory-node.ts` — verify `authSig` in both frame
  branches of `#handleFrostStream`; new reasons `AUTH_REQUIRED` / `AUTH_INVALID`.
- Publish cascade (daemon+cli at least; client if the client-package twin changes) + directory deploy.

## Checklist
- [ ] Design note committed (this doc)
- [ ] Client: TDD red → sign+attach authSig → green; gates; reviewer
- [ ] Directory: TDD red (missing/wrong-key/tampered) → verify → green; gates; reviewer
- [ ] Client publish cascade + promote `latest` + reinstall all agents
- [ ] Directory deploy (3 regions) + STATE.md update
- [ ] Live smoke: real seal works + forged request rejected
- [ ] SEC-2 marked resolved in [[M8C-DEFINITION-OF-DONE]] + [[M8C-TEST-COVERAGE-LEDGER]] (unblocks C1 ceremony-gate)

## Related
- [[M8C-DEFINITION-OF-DONE]] — SEC-2 (the CRITICAL entry this resolves) + D20 (ceremony-gate gated on it)
- [[M8C-TEST-COVERAGE-LEDGER]] — Category C2 (this fix) + C1 (PRIMARY ceremony-gate it unblocks)
