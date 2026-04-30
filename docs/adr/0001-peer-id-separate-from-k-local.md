# ADR-0001: Peer ID is separate from K_local

**Status:** Accepted  
**Date:** 2026-04-30

## Decision

libp2p Peer IDs are derived from libp2p-managed keypairs, not from K_local. K_local (via `KeyProvider`) is used exclusively for CELLO envelope signing. The two keys serve different trust claims and are never conflated.

## Context

libp2p's Noise security protocol requires private key bytes to perform the Diffie-Hellman handshake. The `KeyProvider` abstraction exposes only `getPublicKey()` and `sign(data)` — the private key never leaves the provider. Wiring K_local into libp2p's Noise handshake would require either exposing raw private key bytes (breaking the `KeyProvider` contract) or implementing a custom libp2p key backend against a non-standard interface.

Additionally, M1+ already requires ephemeral Peer IDs per session — fresh Ed25519 keypairs minted at session establishment. Tying Peer ID to K_local would mean K_local rotations disrupt in-flight sessions, and ephemeral sessions would require ephemeral K_locals (wrong).

## Alternatives considered

**A: `KeyProvider` exposes `getPrivateKeyBytes()`** — breaks the abstraction for hardware-backed providers (TPM, secure element). Those providers are M2+ but the contract would need to accommodate them from day one, creating a two-tier `KeyProvider` that partially defeats the abstraction.

**C: Wire `KeyProvider` into libp2p's key interface** — `js-libp2p` accepts a `privateKey` config object, but its internal interface expects DH operations (X25519), not signing operations (Ed25519). Adapting a signing-only provider to a DH interface is cryptographically unsound.

## Consequences

- The Peer ID authenticates the transport connection (Noise handshake). K_local authenticates message content (envelope signature). These are different trust claims and should be different keys.
- In M0, libp2p manages its own Ed25519 keypair internally. The Peer ID is not a commitment to K_local identity.
- In M1+, Peer IDs are ephemeral — fresh per session, derived from ephemeral keypairs the client generates at session establishment. K_local remains stable across sessions.
- Receivers verify message authenticity via the envelope signature (K_local), not via the Peer ID. The Peer ID is a transport routing identifier only.
- TRANSPORT-001 SI-002 must be rewritten: "the Peer ID is derived from a libp2p-managed keypair; K_local is used for envelope signing only."
