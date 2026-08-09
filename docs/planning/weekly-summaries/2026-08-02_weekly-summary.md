---
name: 2026-08-02 Weekly Summary
type: summary
date: 2026-08-02
topics: [m8d-co-attendance, m10b-endorsements, m11-waitlist, m12-infrastructure, directory]
status: active
---

# Weekly Engineering Write-Up (Jul 27 – Aug 2, 2026)

*This week was categorized by closing out three major foundational milestones: **M8D (Co-Attendance / Local Daemon Orchestration)**, **M10b (Verified Endorsements)**, and the **M11 (GCP Operations & Waitlist Gate)** deployment.*

### 1. M8D: Co-Attendance (The Mesh / Visible Agents)
The flagship orchestration milestone is closed (all six lines green). You can now run multiple distinct agents inside the same physical daemon instance without them colliding.
* **AC6 Delivered & Proven Live**: The READ surfaces now explicitly identify whether a session is co-attended or alone. 
* **State Boundaries (DOD-COATTEND-1)**: Fixed the bleeding boundaries where one session could previously consume a message intended for a different agent on the same machine.
* **Divergence Protection**: Fixed race conditions where the daemon’s send cursor desynced from the actual delivery frontier.
* **J-End Verification**: Shipped the `j-combined-journey` and `j-trust-journey` suites, proving the flagship use-case end to end on a running binary with zero phantom connections.

### 2. M10b: Endorsements & The Trust Layer
* **The Return Path**: Added `V56 submission_results` so an agent actually gets a receipt/notification of whether an endorsement was accepted or refused.
* **Farming Protection**: The J-END case explicitly verified that self-endorsement loops (and endorsement farming) are rejected at the edge. A refused endorsement never reaches the target counterparty.
* **Nudge Delivery**: If a subject is offline when an endorsement is minted, the directory now correctly holds and delivers the offline nudge once they reconnect.

### 3. M11: Waitlist, HTTP Gate & GCP Operations
* **Terraform & Infrastructure**: Rolled out the Terraform state for the M11 Waitlist service (running on Cloud Run across four schedules) and the Ops Dashboard (`DOD-GCP-OPS-1`). 
* **The HTTP Gate**: Wired the ops-agent to the HTTP gate. The transport protocol moved to HTTP, but the refusal logic remained intact and verified.
* **Waitlist Mechanics**: 
  - Opting out of the waitlist gate now explicitly reverses content-alert points and confirms via email. 
  - Referral points are capped, summarized by email (debounced), and properly authenticated via a host-only session cookie.
* **Deployment Fixes**: Patched a deployment issue where the waitlist queue sat blocked for 15+ minutes waiting for a machine type it didn't need. 

### 4. M12: The Anti-Entropy & Replication Polish
* **M12 Anti-Entropy**: The `DOD-AE-LOCAL-E2E-1` loopback proven green. Shipped the digest-first wire plus bucket walk, which finally closes the audited O(compare) gap for replication scale.
* **Schema Fixes**: Fixed a silent defect where one incorrectly named database column stopped all directory replication without throwing a noisy error.
* **Missing Tables**: Added 7 missing tables into the anti-entropy sweep and updated the guard tests to prevent them from dropping out of sync again.

### 5. Directory & Gallery Core
* **Stranded Session Recovery**: A directory will now serve a seal receipt on request so that a stranded participant (one whose session dropped mid-close) can explicitly *learn* the terminal state instead of hanging. 
* **Receipt Granularity**: The sealed receipt now explicitly declares *how much* of the transcript it covers. 
* **Gallery Build-in-Public**: Shipped the public gallery index and seed loader. The API now accepts and serves transcripts (refusing partial claims) and pre-renders receipts so web crawlers can actually read and index them.
