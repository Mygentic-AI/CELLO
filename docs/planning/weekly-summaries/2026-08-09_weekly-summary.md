---
name: 2026-08-09 Weekly Summary
type: summary
date: 2026-08-09
topics: [m14-documents, m12-polish, relay-stability, marketing]
status: active
---

# Weekly Engineering Write-Up (Aug 3 – Aug 9, 2026)

*A massive week primarily defined by the launch of **M14 (Federated Collaborative State / Documents)** on the client daemon, rolling out the **M12-P17/18** production patches, and stabilizing the **GCP / Relay / Directory** infrastructure.*

### 1. M14: Federated Collaborative State (The Document Layer)
This week saw the core document layer successfully merged, composed, and verified end-to-end inside the daemon.
* **Document Engine & Store**: Built the Y.Doc lifecycle, document store (immutable log + disposable snapshots), and wired the interceptor on the inbound session path.
* **Format & Type Support**: Added JSON document support (merged securely per key and rendered deterministically) and HTML support. File extensions now natively follow the declared document type.
* **Interaction Verbs**: Shipped the core toolset for interacting with shared state: `close`, `kill`, `withdraw`, and `cello_doc_diff`. The proposer is now explicitly notified of consent decisions instead of having to infer them.
* **Stale-Write Guards & Notifications**: Delivered `DOD-DOC-STALE-WRITE-1` (an edit no longer overwrites something the author never saw) and `DOD-DOC-WATCH-1` (selective nudges that wake an agent only when the specific field they are waiting on moves).
* **Screening & Validation**: Shipped `DOD-DOC-SCREEN-1` (sender adopts the receiver's rules before attempting a send) and `DOD-DOC-FUZZ-1` (measured hostile-input rejection).

### 2. M12 Polish & Terminal State Resiliency
* **Terminal State Divergence (DOD-TERMINAL-STATE-DIVERGENCE-1)**: Shipped a major resiliency upgrade to prevent desync on session sealing. Phase 3 delivered the "pull twin," allowing a missed seal to be explicitly requested. The daemon now queries whether the seal already happened before prematurely marking a session as unsealed.
* **Refusal Insights (M12-P18)**: When a trusted sender is refused, the session now tells them *why*, and the operator sees the rejection fire in the logs.
* **Annex Screening (M12-P17)**: Annexed content is now strictly screened at write time to ensure safety for every reader.
* **Idle & Keepalive Bugs**: Fixed `DOD-RELAY-KEEPALIVE-1`, preventing the relay from severing healthy client links due to slow pings. The relay idle sweep drift was also patched and asserted.

### 3. Bridge & Channel Capabilities
* **Hermes Bridge Upgrade (DOD-HERMES-4)**: The Hermes bridge was promoted to a full, real channel. Fixed duplicate message defects, corrected the read queue (it now reads *the* specific message, not just *a* message), and eliminated the phantom doorbell.

### 4. Infrastructure & Relay Outages Fixed
* **Directory Replication**: Fixed critical cross-node replication failures in the directory layer (`CELLO-REPL-001`). V61 (seal children) and V60 (email stubs) were not replicating. Replicated the tables properly and rolled schema V62.
* **Relay Healing**: Fixed a fleet-wide notarization stall where a 3-day-old connection wasn't being redialed. Europe was successfully enrolled in the relay pool, and health checks were re-routed to the internal address.
* **GCP Migration Complete**: Formally decommissioned AWS directory/relay infrastructure—GCP is now fully authoritative for the CELLO network. Added a 30-day default TTL for parked content.

### 5. Corporate Site / Launch Prep
* **Social Proof & Reframing**: Updated the corporate landing page messaging away from generic developer tools towards **"Your agents aren't multiplayer."** Generated and staged 9:16 quote cards from Aaron Epstein, Reid Hoffman, and Greg Isenberg.
* **On-Page Demo Setup**: Designed the top-of-fold animated `<VerifiedConnection />` sequence to illustrate a live session, swapping out the previous empty placeholder.
