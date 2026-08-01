---
name: 2026-07-31 Federated Collaborative State Architecture
type: discussion
date: 2026-07-31
topics: [crdt, yjs, collaborative-state, architecture, m14, goals, security, federation]
status: active
description: >
  Strategic architectural design for CELLO's Federated Collaborative State (M14).
  Establishes Yjs as the high-throughput CRDT engine, separating opaque byte-sync
  from the local policy/validation layer. Defines the staging buffer, learning
  screeners, and the three primary use cases (Freeform Docs, Auditable Logs,
  and Shared Goals).
---

# 2026-07-31 — Federated Collaborative State Architecture

## 1. The Strategy: Transport Agnosticism & Flexibility

Most collaborative AI tools make a fundamental scoping error: they assume collaboration is either flat chatting (Slack) or code merging (Git).
*   **Don't Re-Invent Git:** Code collaboration is a solved, mature problem. For codebase workflows, CELLO's role is purely the control plane (signaling "I finished V57, you can run git pull now"). We do not need to rebuild Git using CRDTs.
*   **The Uncontested Moat:** Secure, cross-boundary synchronization of arbitrary artifacts (JSON, Markdown, CBOR) where Git is too heavy and flat chat logs are too unstructured.
*   **Federated Sovereignty:** We do not dictate policy or document shapes. Agents intersect their private contexts only on the shared object, leaving the logic of *what* that object means entirely to the agentic harnesses (Claude Code, OpenClaw, etc.).

---

## 2. Technology Choice: Yjs & "Don't Fight CRDT"

We must treat CRDTs as they want to be treated: as fast, dumb, network-agnostic byte-calculators. We will use **Yjs** as the core engine.

*   **Machine-Speed Throughput:** Agents do not type like humans; they emit dense, high-frequency structural updates. Automerge’s JSON-history bloat would choke a local daemon. Yjs is heavily optimized for binary throughput and a low memory footprint, which is exactly what a background daemon needs.
*   **Decoupling State from Policy:** Yjs is completely agnostic to schema—it just sees paths (`root.getMap('steps')`). It handles the raw byte-sync logic opaquely over our existing encrypted libp2p transport.
*   **The Local Validation Engine:** CELLO acts as the policy layer on top. When a Yjs binary delta arrives, CELLO translates the incoming path, checks the caller's identity and permissions, and either applies the binary delta to the local daemon state or drops it entirely.

---

## 3. The Collaboration Handshake & Update Acceptance

When two agents are editing a shared document, how do edits merge safely without creating a prompt-injection vector directly into the active LLM context?

*   **The Initialization:** Agents perform a handshake to establish the document type (e.g., `.md`, `.json`, `.cbor`) and the editing model (append-only vs. freeform mutability).
*   **Drafting vs. Sealing:** Updates are *not* auto-applied to an agent's active reasoning loop. They run in a staged **Drafting Buffer**. The local agent evaluates and accepts the batch (running its own logical or semantic sanity checks) before merging it into active memory, neutralizing real-time injection hijacks.
*   **The Final Seal:** Once both agents are satisfied with the state of the document, they transition the artifact to a cryptographically sealed, immutable receipt under the session's Merkle tree.

---

## 4. Security & Governance: Context-Bound Screening Profiles

Standard messaging screeners (like our gitleaks dictionary or invisible-character scrubbers) are designed for flat chat text. If you are collaborative-editing a complex markdown document, it *will* contain code blocks and formatting characters. Standard screening will trigger massive false positives.

We need **Scope-Conditioned Screening Profiles**:
*   **Hierarchical Profiles:** Screening rules are conditioned by Document-Type and Peer-Trust Tier. For example, executable scripts (`.py`, `.sh`) are programmatically blocked unless explicitly permitted, while Markdown allows formatting but still blocks hard secrets.
*   **The ID-Scoped Override (Learning Mechanism):** If the outbound governor flags a false positive (e.g., a specific metadata string used in a legal document), the operator doesn't turn off the filter globally. They issue an override: *"Allow pattern X inside document ID Y."* This exception is tied strictly to that single working document.

---

## 5. The Three First-Class Use Cases

While CELLO treats the wire payload as opaque bytes, we will build examples, skills, and agents to specifically demonstrate the three most powerful applications of this primitive:

### A. Collaborate on a Shared Document (Unstructured)
*   **The Concept:** Co-authoring Markdown, HTML, or raw JSON blobs.
*   **The Mechanism:** The `append_only` flag is `false`. Any part of the document can be updated fluidly by any authorized party.
*   **The Value:** Simple to understand but massive in utility. Allows agents to brainstorm marketing copy, write proposals, or maintain shared context notes without slow email round-trips.

### B. Creating an Auditable Log of Activities (The Cryptographic Journal)
*   **The Concept:** A running ledger of actions, events, or decisions.
*   **The Mechanism:** The `append_only` flag is enforced strictly.
*   **The Value:** Because CELLO cryptographically signs every operation as it goes back and forth, the resulting document is a mathematically provable paper trail. The copy you hold can be proven to be the authentic, undeniable log of what occurred.

### C. Track a Shared Goal (Micro-Project Management)
*   **The Concept:** Creating structured, multi-actor business workflows (e.g., the East African wealth management SOP) without needing a heavy UI like Asana or MS Project.
*   **The Mechanism:** Technically identical to Use Case A (working with a JSON blob), but highly structured around tracking current state, phases, and an appended "goal journal."
*   **The Value:** We are not an agentic harness, but we will provide the specific **skills and agent templates** required to break down a task, construct the JSON schema, and orchestrate the P2P updates. This turns raw CRDT sync into a complete business orchestration layer, giving users massive collaboration value right out of the box.