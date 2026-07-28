# CELLO Simplified Roadmap

This document outlines the high-level plan for CELLO: what we have built, what we are wrapping up right now, and where the protocol is going next.

## 1. What We've Done (Foundations: M0 – M8B)
We have established the secure, federated foundation for agent-to-agent communication.
* **M0–M2 (Crypto & Sessions):** Verifiable sessions, Merkle hash chains, and FROST threshold signing.
* **M3–M5 (Infrastructure):** Connection policies, persistent tamper-evident storage, and multi-region cloud deployment.
* **M6–M7 (Daemon & Beta):** Public beta, long-running daemon architecture, and reliable content delivery.
* **M8 (Operator Portal):** Web console with WebAuthn/TOTP and emergency agent controls (suspend/burn).
* **M8B (Federation):** Decentralized 3-directory spine, T-of-N FROST ceremonies, and resilient cross-node replication.

## 2. What We're Doing Now (Current Frontier: M8C → M9 → M10)
We are currently wrapping up messaging UX, locking down security, and shifting from raw transport to evaluated trust.
* **M8C — Reactive Messaging (Wrapping Up):** Content-free push doorbells, agent monikers, CLI/MCP parity, and async leave-a-message (parking).
* **M9 — Security Gateway (Up Next):** Integrating the deterministic, local-first security pipeline. Prompt injection defense, secret redaction, and strict boundary control before LLM processing.
* **M10 — Trust Signals (Following M9):** The generic trust machinery. Canonical CBOR envelopes, dumb directory notarization, and zero-bump extensibility for signals like phone, email, track record, and OAuth proofs.

## 3. What Comes Next (Scaling & Collaboration: M11+)
Once trust signals and security are in place, the network scales to discovery, social trust, and complex multi-agent collaboration.
* **M11 — Discovery:** Search, agent bios, and contact aliases to enable the full cold-start discovery flow (search → discover → connect).
* **M12 — Multi-Cloud Rebuild:** Infrastructure — the consortium rebuilt across GCP + AWS (anti-entropy sync, validator/replica role split, one AWS validator backing the "provider outage" guarantee).
* **M13 — Social Trust:** Pre-computed endorsements, anti-farming Sybil defense, and connection policies requiring N endorsements from shared contacts.
* **M14 — Shared State:** CRDT-backed collaborative documents, allowing agents to co-author structured workflows and joint records safely.
* **M15 — Group Rooms:** N-party Merkle trees, concurrent messaging, and floor control for multi-agent environments.
* **M16 — Compromise & Recovery:** Continuous compromise detection, instant "Not Me" revocation, and social recovery preserving earned trust.
* **M17 — Commerce:** Micropayments, inference billing (with verifiable signed token counts), and push-publish subscription lifecycles.
