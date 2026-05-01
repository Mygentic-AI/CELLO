---
name: CELLO Implementation Roadmap
type: plan
date: 2026-04-25
topics: [implementation, milestones, user-stories, test-harness, monorepo, libp2p]
status: active
description: Capability-based milestone map (M0–M10) with libp2p peer-to-peer substrate from M0, implementation decisions, test harness evolution, and milestone-by-milestone user story indexes.
---

# CELLO Implementation Roadmap

This document defines what gets built and in what order. Eleven capability milestones, each delivering a protocol capability that builds on the last. M0 and M1 user stories are fully specified in `docs/planning/user-stories/m0/` and `docs/planning/user-stories/m1/`; subsequent milestone stories are written just before work begins.

For the design source, see [[protocol-map|CELLO Protocol Map]]. For the user story template, see [[user-story-format|CELLO User Story Format]]. For the development methodology (SPARC phases, parallel agent orchestration, test framework, cryptographic correctness rules), see [[day-0-agent-driven-development-plan|Day-0 Agent-Driven Development Plan]].

---

## Substrate Front-Loading

libp2p is the network substrate the entire protocol is designed around — ephemeral Peer IDs per session, DCuTR hole-punching, circuit relay v2 fallback, WebSocket-on-443 transport, Noise end-to-end encryption between peers. It is not a transport optimization; it is the shape of every session.

libp2p lands in M0. Every subsequent milestone runs on the substrate the protocol assumes, so integration surprises (library quirks, connection-manager tuning, transport selection under corporate firewalls, hole-punch success rates on real ISPs) are discovered in the first milestone rather than the last. An earlier draft of this roadmap deferred libp2p to M10; that deferral has been reversed.

The same principle — validate load-bearing substrate early — drives FROST's placement at M2 rather than bundled into a later milestone. A parallel research spike is proving out the TypeScript FROST library surface before M2 locks.

A second invariant that shapes milestone boundaries: **message content never passes through server infrastructure.** Content flows peer-to-peer over libp2p; hashes flow client↔relay over libp2p; signaling flows client↔directory over libp2p. The directory and relay are separate nodes with separate protocol IDs, and neither has a topological path to plaintext. This is architectural, not a policy claim.

---

## Implementation Decisions

- **Language:** TypeScript end-to-end — client, directory, relay, shared packages. The directory is intended to move to Rust. If CELLO becomes a blockchain, directory nodes become validator nodes, and Rust is the lingua franca of that ecosystem (Solana, Substrate, Near, Aptos, Sui). TypeScript first because the TypeScript directory becomes the reference implementation and test oracle: when the Rust version is built, both run side by side and assert identical behavior. That's a better path to correctness than building Rust cold against a spec.

- **Monorepo:** pnpm workspaces. Packages: `client`, `directory`, `relay`, `protocol-types`, `crypto`, `transport`, `e2e-tests`. The client is designed for extraction — it imports only from `protocol-types`, `crypto`, and `transport`, never from `directory` or `relay`. When the client moves to its own repo, the shared packages publish as npm packages. The imports don't change.

- **Network substrate:** `js-libp2p` from M0. Transports: `@libp2p/tcp` and `@libp2p/websockets`. Security: `@chainsafe/libp2p-noise`. Muxer: `@chainsafe/libp2p-yamux`. Ephemeral Peer IDs are minted per session (M1 onward) from fresh Ed25519 keypairs — the stable agent identity is K_local, not the Peer ID. The directory is itself a libp2p node exposing a custom signaling protocol (`/cello/signaling/1.0.0`); it does not enable Kademlia DHT, mDNS, or rendezvous — peer discovery is strictly via directory-mediated signaling so the directory's "phone book" role stays bounded. libp2p circuit relay v2 and DCuTR are configured from M0; they are exercised on localhost loopback in unit tests and on real networks in cross-machine integration tests.

- **Persistence:** In-memory stores behind interfaces initially. A `Store` interface per component, with `InMemoryStore` as the first implementation. The protocol logic — FROST ceremonies, Merkle tree operations, hash relay, connection brokering — is identical regardless of where the bytes live. Deferring real persistence keeps the e2e tests fast (no database setup/teardown, no file cleanup) and focuses early milestones on getting the protocol right. When SQLite/SQLCipher is added, it's a new `Store` implementation behind the same interface. The protocol tests never change; the store layer gets its own focused integration test suite.

- **Wire encoding:** Canonical CBOR (RFC 8949 §4.2.1 Core Deterministic Encoding — minimal integer encoding, definite-length items only, bytewise-lexicographic map key ordering). Signatures are computed over CBOR-encoded bytes, so all implementations must produce identical serialization for the same logical structure. CBOR over JSON because binary fields (public keys, signatures, hashes) are first-class in CBOR; JSON would require base64 encoding and a canonicalization spec.

- **CBOR library (TypeScript):** `@ipld/cborg`. Deterministic encoding is the default behavior (no flag to forget to set), and the library is the de facto encoder in the IPLD / DID / VC ecosystems where CBOR bytes are routinely signed and hashed. Other TypeScript CBOR libraries (`cbor-x`, `cbor2` node bindings) require manual configuration and can silently regress to non-deterministic output. Callers must ensure object keys are in bytewise-lexicographic order before encoding, since the encoder does not reorder keys of JavaScript objects it is handed. Positional arrays (used for TBS) avoid the key-ordering question entirely. The future Rust port will use `ciborium` configured for CDE; byte-for-byte parity with `@ipld/cborg` output is enforced by the committed TBS fixtures (MSG-001, CRYPTO-002).

- **ML-DSA library (TypeScript):** `liboqs` / `node-oqs` (Open Quantum Safe project). ML-DSA (CRYSTALS-Dilithium, NIST FIPS 204) is used for all non-threshold signatures: endorsements, attestations, directory certificates, pseudonym bindings, and connection package items. These artifacts first appear in M3. The library correctly implements FIPS 204; it is labelled "experimental" by OQS in the sense that it has not gone through CMVP (FIPS-140-3) certification — that certification is not a requirement for CELLO. No FIPS-140-3-validated ML-DSA module exists in the Node.js ecosystem as of 2026; AWS-LC, Bouncy Castle, and wolfSSL all have FIPS-140-3-validated modules but only for ML-KEM (key encapsulation), not ML-DSA (signatures). The security level (ML-DSA-44 vs ML-DSA-65) is an open decision to be resolved before M3 stories are written — see the Deferred Items section.

- **Test harness:** The e2e test package spins up directory, relay, and clients — each as real libp2p nodes — in a single Vitest process. libp2p binds to random loopback ports; setup is a small constant per test; teardown calls `libp2p.stop()` on every spawned node. No Docker, no manual port allocation, no inter-process coordination during development. In-memory stores keep the protocol layer fast even as the transport is real.

- **Initial agent integration:** Claude Code sessions. OpenClaw, Hermes, and IronClaw come later per the integration stages in the day-0 plan.

---

## Milestone Map

| Milestone | What gets built | What it proves |
|---|---|---|
| M0 — Peer-to-Peer Walking Skeleton | Monorepo scaffolding; `protocol-types`, `crypto` (Ed25519 + SHA-256 with domain separation), `transport` (libp2p node bootstrap: TCP + WebSocket + Noise + Yamux, Ed25519 Peer IDs, dial-by-multiaddr, `/cello/m0/1.0.0` stream protocol); envelope v0 (positional TBS without session/sequence fields); client library with MCP tools for peer connect / send / receive; e2e harness with real libp2p nodes in-process | Two agents exchange a tamper-evident signed message peer-to-peer over libp2p with no server in the middle. Tamper any byte mid-flight and the receiver rejects. The full transport, security, and signature substrate is exercised end-to-end. |
| M1 — Directory Signaling + Merkle Notarization | Directory node (libp2p, signaling-only, `/cello/signaling/1.0.0`): client auth, session request, signed SessionAssignment issuance carrying counterparty Peer IDs + multiaddrs and relay endpoint. Relay node (libp2p, hash-only, `/cello/relay/1.0.0`): accepts Structure 1 submissions, assigns canonical sequence numbers, computes `prev_root`, builds per-session RFC 6962 Merkle tree, delivers Structure 2. RFC 6962 primitives library with inclusion proofs. Two-structure leaf model (Structure 1 sender-signed, Structure 2 relay-built with `prev_root`). Envelope v1 (`protocol_version = 1`, hard cut). Genuine dual-path: content client↔client via libp2p; hashes client↔relay via libp2p. Bilateral K_local-only seal with single directory signing key (FROST placeholder). Directory recomputes tree from scratch at seal and verifies `last_seen_seq` causal chain. MCP additions for sealed receipt and inclusion proofs. | A conversation is a 32-byte receipt. Sender, receiver, and relay produce the same root; the directory independently recomputes it at seal; a relay that forges, reorders, or drops leaves is caught by the causal-chain check. The directory and relay are separate libp2p nodes and neither sees message content. Inclusion proofs verify against the sealed root using any RFC 6962 verifier. |
| M2 — FROST Ceremonies | DKG (distributed key generation); threshold co-signing at session establishment and seal replacing the single directory signing key from M1; K_server share management with envelope encryption; `IThresholdSigner` abstraction as the swap point for a future threshold ML-DSA implementation. Note: ML-DSA for non-threshold artifacts (endorsements, attestations, directory certificates, pseudonym bindings, connection package items) lands in M3 — the two-track signing model is complete once both milestones ship. | Neither the client nor the directory can forge a session alone. A compromised K_local cannot pass the FROST ceremony — compromise is detectable at session boundaries. |
| M3 — Connections & Policy | Registration (stubbed OTP), connection request flow, trust data relay with selective disclosure, `SignalRequirementPolicy` evaluation, accept/decline. Connection package items (pseudonym binding, attestations, endorsements) are signed with ML-DSA via `liboqs` / `node-oqs` — this is the first milestone where ML-DSA is load-bearing. The ML-DSA security level (44 vs 65) must be decided before M3 stories are written. **Pre-M3 stub review required:** before writing M3 stories, review all `stubs` sections in M1 and M2 stories — each stub names at least one M3 story that must be written. Provisionally: CELLO-M3-SESSION-001 (session initiation MCP tool surface), CELLO-M3-CONNECTION-001 (accept/decline flow with trust data and policy evaluation). | Agents control who reaches them. A receiver can require specific trust signals and enforce it. The one-round negotiation works — what you disclose, what you withhold. |
| M4 — Prompt Injection Defense | Six-layer pipeline: Layer 1 deterministic sanitization, Layer 2 DeBERTa scanner, Layer 3 outbound gate, Layer 4 redaction, Layer 5 runtime governance, Layer 6 access control | Messages are safe from injection. Each layer catches different attack classes. Standalone value — works without the network. |
| M5 — Discovery & Notifications | Bio, search (BM25 + vector), contact aliases with revocation, notification event queue | The full cold-start flow: search → discover → connect → converse. Contact aliases enable sharing outside the directory. |
| M6 — Social Trust | Pre-computed endorsements, anti-farming (same-owner rejection), Sybil floor (conductance scoring, provisional period, carrier signals) | Trust is social. Connection policies can require N endorsements from shared contacts. Fake identity networks are expensive to create. |
| M7 — Compromise & Recovery | Continuous compromise detection, "Not Me" revocation with K_server burn and session termination, social recovery (M-of-N, 48-hour wait), key rotation, trust floor based on pre-compromise history | Compromise is survivable. Detection is continuous, revocation is instant, recovery preserves earned trust. |
| M8 — Group Rooms | N-party Merkle tree, concurrent mode with GCD floor control, owner/admin model, throttle manifest with cost protection, violation enforcement with auto-mute, 20-participant cap | Groups work with provable records. Floor control prevents chaos, throttle manifests protect wallets, violations escalate logarithmically. |
| M9 — Commerce | Push-publish subscriptions with per-delivery micropayments, inference billing (rate card, signed cumulative token counts in Merkle leaves, ABORT-BILLING), purchase attestations, merchant CRM data stash, fraud detection | Agents can trade. Token counts are signed and verifiable. Fraudulent billing is caught by the buyer's client or by deterministic arbitration. |
| M10 — Federation | Multi-node directory with primary/backup replication, consensus for state changes, relay operator separation from directory operators, client-side latency monitoring with proactive session migration, MMR inclusion proof verification against federation-signed checkpoints. **Infrastructure prerequisite:** directory and relay must be split onto separately operated infrastructure before M10 ships — co-location is acceptable through M1–M9 development per the Alpha topology (server-infrastructure.md line 967), but the separation requirement is a hard gate for Federation. CELLO-M1-INFRA-001 documents the co-location caveat; M10's infra story closes it. | The network decentralizes. A node failure mid-session is survivable — the client detects it, migrates, and the session continues. Fabricated conversations are detectable via MMR inclusion proofs now that federation-signed checkpoints exist. |

### Dependencies

```
M0 → M1 → M2   (Peer-to-peer skeleton → Directory + Merkle → FROST bookends)
       ↓
      M3 → M5 → M6   (Connections & Policy → Discovery & Notifications → Social Trust)
       ↓
      M4   (Prompt Injection Defense — can start after M0, independent otherwise)

M2 + M3 → M7   (Compromise & Recovery needs FROST and connections)
M1 + M3 → M8   (Group Rooms need Merkle and connections)
M3 + M5 → M9   (Commerce needs connections and discovery)
M2 → M10       (Federation needs FROST working on a single node first; MMR verification lands with federation-signed checkpoints)
```

M4 is the most parallelizable with other milestones — the scanning pipeline is almost entirely client-side and each layer is independent.

---

## Test Harness Evolution

| After | The e2e harness can test |
|---|---|
| M0 | Two real libp2p clients dial each other by multiaddr and exchange a signed envelope. Assert: message roundtrip, signature verification, rejection of tampered content, Noise encryption in place (third-party packet capture would see ciphertext), MCP tool surface drives the flow end-to-end. |
| M1 | All of M0 plus: directory libp2p node issues signed session assignments; relay libp2p node sequences Structure 1 submissions and builds the per-session Merkle tree; content flows peer↔peer while hashes flow client↔relay on distinct libp2p protocols; sender/receiver/relay root equality after each leaf; bilateral seal with directory recomputing the tree from scratch; `last_seen_seq` causal-chain violation detection at seal; inclusion proofs verifiable against the sealed root by an independent RFC 6962 verifier; tamper detection on leaf content / signature / sequence / `prev_root`; relay never observes content bytes (verified by transport-layer assertion). |
| M2 | All of M1 plus: FROST DKG ceremony, threshold-signed session establishment, threshold-signed seal replacing the single-key notarization from M1, rejection of session establishment with a compromised K_local, `IThresholdSigner` abstraction covering the algorithm swap. |
| M3 | All of M2 plus: registration, connection request/accept/decline, policy evaluation against trust signals, selective disclosure of trust data. Two-agent flows now start from "strangers" not "pre-connected." |
| M4 | All of M3 plus: injection payloads through each defense layer, Layer 1 sanitization on incoming messages, Layer 2 scan invocation, Layer 3 outbound gate blocking exfiltration, Layer 4 redaction, Layer 5 cost/volume cap enforcement. |
| M5 | All of M4 plus: agent publishes bio, second agent searches and discovers it, connects via contact alias, full cold-start-to-conversation flow in one test. |
| M6 | All of M5 plus: endorsement creation and verification, policy requiring N endorsements, same-owner endorsement rejection, provisional period enforcement. |
| M7 | All of M6 plus: compromise detection triggers, "Not Me" cascade (K_server burn, all sessions terminated), social recovery ceremony, key rotation with continued conversations, trust floor preservation. |
| M8 | All of M7 plus: 3+ clients in a group room, concurrent message ordering, floor control, throttle manifest enforcement, violation → auto-mute escalation. |
| M9 | All of M8 plus: inference session with rate card, signed cumulative billing in Merkle leaves, buyer-side token count verification, ABORT-BILLING on cap exceeded, push-publish subscription lifecycle. |
| M10 | All of M9 plus: multi-node directory, primary failure with backup promotion, client session migration, relay operator separation, data replicated across nodes, MMR inclusion proofs verified against federation-signed checkpoints. |

Every milestone's tests continue running in subsequent milestones. The harness only grows — nothing is replaced.

In addition to the in-process Vitest harness, a cross-machine integration test runs at least after every milestone boundary: two client machines on different networks (home ISP, corporate VPN, mobile tether) dial through DCuTR and fall back to circuit relay on symmetric NAT. This exists to catch the class of libp2p issue that localhost loopback cannot surface. Cross-machine tests do not gate CI; they are a separate nightly job whose failures feed back into the test harness.

---

## M0 User Stories

Fully specified stories live in `docs/planning/user-stories/m0/`. The table below is the index.

| ID | Title | Domain | Actor | Priority | Components | Depends on |
|---|---|---|---|---|---|---|
| CELLO-SCAFFOLD-001 | Monorepo scaffold: pnpm workspaces, TypeScript project references, Vitest workspace, per-package buildspecs | Infrastructure | DEVELOPER | P0 | monorepo | — |
| CELLO-INFRA-001 | AWS CI/CD: per-package CodeBuild + CodePipeline wired via EventBridge path-filter | Infrastructure | DEVELOPER | P0 | aws-infrastructure | SCAFFOLD-001 |
| CELLO-CRYPTO-001 | Ed25519 keypair generation, signing, verification; InMemoryKeyProvider + FileKeyProvider | Crypto | CLIENT | P0 | crypto | SCAFFOLD-001 |
| CELLO-CRYPTO-002 | SHA-256 hashing with domain separation | Crypto | CLIENT | P0 | crypto | SCAFFOLD-001 |
| CELLO-MSG-001 | Signed envelope v0 schema (no session, no sequence) | Message Exchange | CLIENT | P0 | protocol-types | CRYPTO-001, CRYPTO-002 |
| CELLO-TRANSPORT-001 | libp2p node bootstrap, Peer IDs, dial, custom stream protocol; cross-machine AC | Transport | CLIENT | P0 | transport | SCAFFOLD-001 |
| CELLO-MSG-002 | Peer-to-peer signed message exchange over libp2p streams | Message Exchange | CLIENT | P0 | client | MSG-001, TRANSPORT-001 |
| CELLO-MCP-001 | M0 MCP tool logic in @cello/client (connect peer, send, receive, status) | MCP Tool Surface | AGENT | P0 | client | MSG-002 |
| CELLO-ADAPTER-001 | Claude Code adapter: stdio MCP server, claude/channel notifications, FileKeyProvider startup, SKILL.md | MCP Tool Surface | AGENT | P0 | adapter-claude-code | MCP-001, CRYPTO-001 |
| CELLO-E2E-001 | M0 milestone sign-off: two real Claude Code agents on two machines exchange a signed message end-to-end | End-to-End | AGENT | P0 | adapter-claude-code, client, transport, crypto | ADAPTER-001, TRANSPORT-001 AC-011 |

Ten stories, all P0. SCAFFOLD-001 is the prerequisite for everything. CRYPTO-001, CRYPTO-002, and TRANSPORT-001 can run in parallel after SCAFFOLD-001. INFRA-001 can run in parallel with domain stories after SCAFFOLD-001. MSG-001 waits on both CRYPTO stories. MSG-002 waits on MSG-001 and TRANSPORT-001. MCP-001 follows MSG-002. ADAPTER-001 wraps the complete client. E2E-001 is the milestone finish line — M0 is not closed until it passes.

M0 has no directory, no relay, no session concept, and no Merkle tree. Two libp2p peers know each other's multiaddrs out-of-band (hardcoded in the test harness) and exchange a single signed envelope over a custom libp2p stream protocol. The envelope's TBS is `[protocol_version=0, content_hash, sender_pubkey, timestamp]` — session_id and sequence_number do not exist yet because there is no session.

M0 already hashes message content with SHA-256 and the `0x00` domain separator (the Merkle leaf primitive). The tree itself doesn't exist until M1, but the content-hash primitive is shared — pre-committing to it means M1 reuses the same primitive without redefining it.

M0's positional TBS array begins with `protocol_version` so an unknown version is detectable without parsing any subsequent field. M0 uses `protocol_version = 0`; value `1` is reserved for M1. Every milestone that changes TBS structure bumps the version.

M0 is a walking skeleton of the right shape: the transport substrate libp2p provides (Noise encryption between peers, DCuTR hole-punching configuration, Ed25519 Peer IDs, Yamux multiplexing) is exercised from the first milestone, so every subsequent milestone builds on a substrate whose surprises have already been surfaced.

---

## M1 User Stories

Fully specified stories live in `docs/planning/user-stories/m1/`. The table below is the index.

| ID | Title | Domain | Actor | Priority | Components | Depends on |
|---|---|---|---|---|---|---|
| CELLO-MERKLE-001 | RFC 6962 Merkle primitives with inclusion proofs | Merkle Trees | CLIENT | P0 | crypto | M0 CRYPTO-002 |
| CELLO-MERKLE-002 | Two-structure leaf construction (Structure 1 + Structure 2) | Merkle Trees | CLIENT | P0 | protocol-types, crypto | MERKLE-001, M0 MSG-001 |
| CELLO-MSG-003 | Envelope v1: Structure 1 TBS, `last_seen_seq`, `protocol_version = 1` | Message Exchange | CLIENT | P0 | protocol-types | MERKLE-002 |
| CELLO-NODE-001 | Directory libp2p node: signaling protocol, signed session assignments | Node Operations | DIR | P0 | directory | M0 TRANSPORT-001 |
| CELLO-NODE-002 | Relay libp2p node: hash relay, canonical sequencing, per-session tree | Node Operations | DIR | P0 | relay | MERKLE-002, MSG-003, M0 TRANSPORT-001 |
| CELLO-SESSION-002 | Session assignment carries Peer IDs and multiaddrs; genesis `prev_root` | Session Lifecycle | CLIENT | P0 | client, directory, relay | NODE-001, NODE-002 |
| CELLO-MSG-004 | Genuine dual-path send/receive (content peer↔peer, hash client↔relay) | Message Exchange | CLIENT | P0 | client | SESSION-002 |
| CELLO-SESSION-003 | Bilateral seal: SEAL control leaf, directory recompute, causal check | Session Lifecycle | CLIENT | P0 | client, directory, relay | MSG-004 |
| CELLO-MCP-002 | MCP surface additions: session-aware tools, sealed receipt, inclusion proof | MCP Tool Surface | AGENT | P0 | client | SESSION-003 |
| CELLO-ADAPTER-002 | Claude Code adapter M1: cello_session_request notifications, M1 tool set, SKILL.md update | MCP Tool Surface | AGENT | P0 | adapter-claude-code | MCP-002 |

Ten stories, all P0. Dependency-ordered as shown. MERKLE-001 can start immediately on top of M0 CRYPTO-002. NODE-001 (directory signaling) can start as soon as TRANSPORT-001 stabilizes. MERKLE-002 and MSG-003 are protocol-types work that can partially overlap once MERKLE-001's hash primitives are stable. ADAPTER-002 is last — it wraps the complete M1 client just as ADAPTER-001 wrapped M0.

M1 introduces `packages/directory` and `packages/relay` as distinct pnpm packages, each with its own store interface (`DirectoryStore`, `RelayStore`) and in-memory first implementation. The client never imports from either server package — it reaches them over libp2p, exactly as it will in production. In-process Vitest co-location is a harness convenience; the package boundary is real.

The directory and relay are **separate libp2p nodes** with distinct protocol IDs. The directory speaks `/cello/signaling/1.0.0` for session request, authentication, and signed SessionAssignment delivery. The relay speaks `/cello/relay/1.0.0` for `hash_submit` frames and Structure 2 delivery. Neither has a topological path to message content — content flows peer↔peer on a third libp2p protocol (`/cello/content/1.0.0`) the clients negotiate after they receive each other's Peer IDs + multiaddrs in the signed SessionAssignment. The "directory and relay never see content" invariant is architectural, not a policy claim, because the middleboxes are not on the content-path stream at all.

M1 is a hard cut from M0. Peers speak `protocol_version = 1` only; v0 envelopes are refused with `unsupported_version`. The TBS reshapes from M0's positional array into Structure 1 (`[protocol_version, content_hash, sender_pubkey, session_id, last_seen_seq, timestamp]`). Canonical sequence numbers enter Structure 2, assigned by the relay; the client's contribution to ordering is now the `last_seen_seq` causal commitment.

The directory in M1 is a bookend authority, not an in-path relay. It creates session records, signs session assignments with a single directory signing key (pinned in client configuration; FROST replaces this pinning in M2), and recomputes the tree from scratch at seal. Between session establishment and seal, the directory libp2p connection stays open for notifications but carries no message hashes or content.

Seal in M1 is bilateral K_local — both parties sign a SEAL control leaf (`leaf_kind = 0x02`) committing to the final Merkle root. The directory independently recomputes the tree from the relay's handoff, verifies `prev_root` chaining and the `last_seen_seq` causal invariant across all leaves, and records the sealed root. A relay that misordered, forged, or dropped leaves produces a provable inconsistency at this check. FROST notarization arrives in M2; CLEAN/FLAGGED attestations arrive in M7 (SEAL leaves in M1 carry `attestation = "PENDING"`).

Inclusion proofs are RFC 6962 standard — `cello_get_inclusion_proof` returns a format-compliant proof verifiable by any RFC 6962 implementation against the sealed root, with no CELLO-specific knowledge required. MMR inclusion proofs (the fabricated-conversation defense across the global sealed-conversation ledger) are deferred to M10 per the Deferred Items section below.

---

## M2 User Stories

Fully specified stories live in `docs/planning/user-stories/m2/`. The table below is the index.

| ID | Title | Domain | Actor | Priority | Components | Depends on |
|---|---|---|---|---|---|---|
| CELLO-CRYPTO-003 | `IThresholdSigner` abstraction + `FrostThresholdSigner` (`@noble/curves/frost`); DKG; RFC 9591 domain context strings | Cryptographic Primitives | CLIENT | P0 | crypto | M1 all |
| CELLO-NODE-003 | Directory: `/cello/frost/1.0.0` protocol, K_server_X share storage (`InMemoryShareStore`), in-flight ceremony conflict detection | Node Operations | DIR | P0 | directory, crypto | CRYPTO-003 |
| CELLO-SESSION-004 | FROST-authenticated session establishment; `SessionAssignment` carries `signature_type: 'frost'`; M1 single-key hard cut | Session Lifecycle | CLIENT | P0 | client, directory, crypto | NODE-003, M1 SESSION-002 |
| CELLO-SESSION-005 | FROST-notarized seal; `cello_close_session` returns `seal_type: 'frost' \| 'bilateral'`; deferred seal on directory outage | Session Lifecycle | CLIENT | P0 | client, directory, relay, crypto | SESSION-004, M1 SESSION-003 |

Four stories, all P0. CRYPTO-003 is the prerequisite for everything — the abstraction and DKG must exist before any ceremony can run. NODE-003 adds the directory-side ceremony handler and share storage. SESSION-004 wires FROST into session establishment; SESSION-005 wires it into seal. The dependency chain is strict: CRYPTO-003 → NODE-003 → SESSION-004 → SESSION-005.

M2 is a hard cut at the session bookends: `SessionAssignment` frames with `signature_type: 'single'` (M1) are refused with `unsupported_signature_type`. Per-message flow (dual-path, Structure 1/2, relay sequencing) is identical to M1 — FROST touches only the two ceremony points. The FROST library is `@noble/curves/frost`, same audit lineage as the Ed25519 and SHA-256 primitives from M0.

DKG in M2 uses a test-harness bootstrap (`directory.bootstrapKeyShares(agentPubkey)`) guarded by `NODE_ENV=test`. Registration (M3) replaces this with the real ceremony. The in-process test threshold is 2-of-3 (configurable); Alpha production is 3-of-5.

The in-flight ceremony conflict detector (NODE-003) is the minimal canary required for the M2 security claim: a stolen K_local attempting a competing ceremony is detected and rejected. This guard is **not sufficient for production** — M7 replaces it with full anomaly detection including source fingerprinting, historical analysis, and owner push alerts.

---

## Deferred Items

Items that are part of the canonical protocol design but are deliberately not built in the milestone where they first become relevant. Each item names the milestone that owns it and the reason for the deferral.

- **MMR (Meta-Merkle Tree) inclusion proofs — deferred to M10.** The MMR is the global append-only tree of sealed conversations, and the client-side inclusion-proof algorithm is the fabricated-conversation defense (agent-client §MMR inclusion proof verification; AC-25). The defense is only meaningful under federation — a single-node directory can fabricate the entire MMR, so the verification algorithm requires federation-signed checkpoints. M10 ships federation, so MMR construction and client-side verification land together as one capability. M1–M9 use in-session inclusion proofs only (tamper detection within a single conversation tree), which are sufficient for every use case before federation exists.

- **Consistency / audit proofs (RFC 6962 §2.1.2) — deferred, no assigned milestone.** These prove a tree is append-only between two root checkpoints. Useful for auditing long-term directory honesty, but not load-bearing for any currently specified capability (disputes use inclusion proofs; seal verification uses root comparison). Revisit if directory-honesty auditing becomes a user-facing feature.

- **Session-close attestations (CLEAN / FLAGGED / PENDING) — deferred to M7.** The M1 `SEAL` control leaf carries an attestation field, but in M1 it is always `PENDING`. CLEAN/FLAGGED require the compromise-detection and arbitration machinery that M7 introduces (last-known-good anchor for compromise detection, FLAGGED→arbitration flow, trust-floor computation from prior CLEAN attestations). Keeping the field present from M1 means M7 fills in values rather than reshaping the leaf.

- **ML-DSA security level (ML-DSA-44 vs ML-DSA-65) — open decision, must resolve before M3.** ML-DSA-44 gives 128-bit post-quantum security (connection package ~18 KB); ML-DSA-65 gives 192-bit (connection package ~23 KB). The 5 KB difference is unlikely to be the deciding factor — the choice should track what becomes conventional in the post-quantum ecosystem as FIPS 204 adoption matures. See [[2026-04-13_1100_quantum-resistance-design|Quantum Resistance Design]] for the full size analysis.

- **libp2p peer-discovery protocols (Kademlia DHT, mDNS, rendezvous) — deferred.** libp2p ships these out of the box, and they are *not* enabled on the M0–M9 directory. Peer discovery is strictly directory-mediated signaling: the directory hands each client the counterparty's Peer ID and candidate multiaddrs in a signed SessionAssignment. Enabling DHT or rendezvous would have the directory advertising and resolving Peer IDs globally, which is a different privacy posture than "directory is a phone book you authenticate to." If federation (M10) benefits from a gossip-style node-list distribution, that introduces one libp2p discovery protocol at that point — not before.

---

## Related Documents

- [[protocol-map|CELLO Protocol Map]] — top-level orientation; milestones map to protocol domains
- [[user-story-format|CELLO User Story Format]] — the template all stories follow
- [[day-0-agent-driven-development-plan|Day-0 Agent-Driven Development Plan]] — development methodology, test framework, orchestration approach
- [[end-to-end-flow|CELLO End-to-End Protocol Flow]] — the deep canonical reference stories are derived from
- [[agent-client|CELLO Agent Client Requirements]] — client-side requirements
- [[server-infrastructure|Server Infrastructure Requirements]] — server-side requirements
- [[2026-04-14_1100_cello-mcp-server-tool-surface|CELLO MCP Server Tool Surface]] — the 33 MCP tools; M0 implements a minimal peer-to-peer subset
- [[cello-initial-design|CELLO Initial Design]] — original architecture and vision
