---
name: M8B — Federation
type: milestone-writeup
date: 2026-06-30
updated: 2026-07-12
milestone: M8B
status: completed
description: >
  M8B delivered the federation architecture: 3-directory spine, T-of-N FROST ceremonies, 
  Option B relay architecture (no directory-to-relay connections), proactive share refresh, 
  and cross-node replication for presence and pickup queues.
---

# M8B — Federation

**Started:** 2026-06-29 · **Completed:** 2026-06-30

M8B transformed CELLO from a single-node directory into a fully federated T-of-N architecture, eliminating the single point of failure and removing the directory's topological path to the relay. Every DoD line is ✅ PROVEN.

## What was delivered

- **T-of-N Spine:** The client resolves the directory consortium from a threshold-signed manifest. Distributed Key Generation (DKG) and FROST signing now execute across the federated nodes. A degraded roster fails gracefully.
- **Resilience and Refusal:** A session establishes and seals even if a directory node is down (T-of-N). Quorum-aware suspension ensures that if ≥ N-T+1 nodes honor a suspension, no signature forms, but survivor nodes route around genuinely offline directories.
- **Proactive Share Refresh:** Zero-constant-term PSS (Herzberg 1995) over the joint FROST key allows share rotation to a new epoch without changing the public group key, ensuring compromised nodes in epoch $e$ hold nothing usable in $e+1$.
- **Option B Architecture:** The directory makes **zero** network calls to the relay. The directory signs a `relay_directory_signature` over the relay TBS and ships it inside the session assignment. The client presents it directly to the relay. Offline rebuilding and verification of the tree happens at seal time.
- **Cross-Node State:** `agent_presence` and `pickup_queue` now leverage native Postgres logical replication (`cello_pub`), preserving sovereign write-ownership while ensuring global visibility.

## Deployment
Deployed to the AWS 3-region dev cluster on 2026-06-30.
