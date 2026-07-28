---
name: M12 research — libp2p and identity surface map
type: research
date: 2026-07-28
milestone: M12
status: complete
topics: [m12, anti-entropy, libp2p, identity, manifest, research]
description: >
  Explorer-produced map (2026-07-28) of the transport stack, the two-key identity model,
  step-6 verification, existing protocol IDs and signing utilities, and the gaps a
  directory↔directory channel designer must fill. Input to DOD-AE-DESIGN-1.
---

# libp2p + identity surface map (design input for DOD-AE-DESIGN-1)

## The facts the design builds on

- **Two Ed25519 keys per directory.** The *node key* (`NODE_PRIVATE_KEY` = `CELLO_DIRECTORY_NODE_KEY_HEX`, secret `cello/{env}/directory/node-private-key`) is what the manifest pins as `pubkey` and what signs checkpoints/step-5. The *transport key* (`CELLO_DIRECTORY_TRANSPORT_KEY_HEX`) derives the libp2p PeerId. **The manifest pins the node key, NOT the PeerId** — PeerIds live only in unsigned SSM (`/cello/{env}/nodes/directory/*`, deploy.sh:775-786).
- **Manifest entry shape** (`protocol-types/src/manifest.ts:13-20`): `{nodeId, pubkey(64-hex), region, provider, endpoint(http base, NOT multiaddr)}` + manifest `{version, not_before, expires, nodes[], signatures[{officerIndex, signature}]}`. Canonicalization: sorted keys, no whitespace (`crypto/src/manifest.ts:73-93`); `verifyManifest` counts distinct officer indices, never throws.
- **Step-6 verification** (the guarantee to make mutual): step-1 directory nonce (32B, single-use, 30s TTL) → step-5 directory signs TBS `"cello-directory-auth-challenge-v1\n" + nodeId + "\n" + agentPubkeyHex + "\n" + nonceHex + "\n" + isoTimestamp` → client verifies against the manifest pubkey for nodeId. Proves possession of the manifest-pinned key, bound to this exchange by the nonce. Caveats: opt-in on the client; directory falls back to bare auth_ok on signing failure (fail-open); TBS binds neither PeerId nor the Noise channel.
- **Transport stack** (one for all node types, `core/transport/src/node.ts:466-545`): tcp + ws + circuit-relay, Noise XX only, yamux; directory listens 4000/tcp + 8080/ws; 8081 internal API; 9090 health+/bootstrap+/manifest. `newStream()` NEVER dials (`node.ts:312-318` throws connection_lost) — a channel must `node.dial()` first.
- **Handler convention:** `node.handle("/cello/<subsystem>/<semver>", handler, {maxInboundStreams})` in `start()`; one request/response per stream; it-length-prefixed varint framing; CBOR with `new Encoder({ tagUint8Array: false })` (byte-equality is load-bearing).
- **Existing protocol IDs:** signaling, frost, directory-relay, checkpoint (JSON, not CBOR), relay, content-park, content, m0. Domain strings inventory in the full report — new channel MUST mint a new domain, reusing none.
- **The best signed-payload pattern to copy** is directory→relay admin frames (`network-relay-adapter.ts` header): body CBOR-encoded, sig over body bytes, frame = body + sig field, receiver re-encodes body minus sig and verifies against a PINNED pubkey. **Its flaw to fix: no domain separator, no nonce, no expiry — replayable forever.**
- **The shared-TBS-in-crypto pattern** (`relay-registration.ts:13-15`, `checkpoint.ts`): canonical TBS builders live in `@cello-protocol/crypto` so signer and verifier cannot diverge. Follow it.

## The gaps the design must fill (verbatim from the map)

1. **No directory→directory dial exists anywhere.** The one designed channel (`/cello/checkpoint/1.0.0`, `libp2p-checkpoint-transport.ts`) never dials, and `CHECKPOINT_PEER_ADDRS` is set nowhere in IaC — peers are empty in every deployed environment; the CheckpointCoordinator (threshold 2) can never reach quorum. CLAUDE.md's "no cross-node RPC" is true in effect.
2. **The checkpoint channel is unauthenticated in BOTH directions**, and the coordinator verifies responses against the responder-supplied `publicKeyHex` (`checkpoint-coordinator.ts:459-462`), never the manifest pubkey. Anti-pattern; also a one-line fix worth making regardless.
3. **The directory does not verify its manifest's signatures** (`file-directory-manifest-store.ts:11-16` — "only a transport"). That premise dies the moment the directory acts on peer identities from it. Add `verifyManifest` at load, root keys + threshold pinned by env/IaC.
4. **No peer dial coordinates in the trust anchor**: manifest has no peerId/multiaddr. Options: (a) resolve peers' `GET /bootstrap` (plaintext HTTP — what step-6 compensates for), (b) unsigned SSM registry (`node-registry.ts` already parses `registryResult.directories` and bin/directory.ts throws it away), (c) **add `peerId` to the manifest so the officer signature covers the dial identity — cleanest**.
5. **Port 4001** ("inter-node checkpoint signing" per CONTEXT.md:217) does not exist in any PortMapping or listen addr — docs-only. Choose: add a real port, or run over the existing 8080/ws (which traverses the ALB today).
6. **Fail-open is the house style** (step-6 opt-in, bare-auth_ok fallback, unknown frames ignored). A greenfield directory↔directory channel has no legacy peers: fail CLOSED from day one.
7. **Nothing binds PeerId/Noise channel into any TBS** — include both PeerIds in the handshake TBS for channel binding.
8. **Multi-node test scaffolding exists**: `e2e-tests/src/spine/live-harness.ts:480-560` (`startSpineCluster`, per-node keys, refuses shared identity for N>1) + `spine/auth-manifest.ts` fixtures.
