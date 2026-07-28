---
name: GCP rebuild — decision record
type: discussion
date: 2026-07-28
topics:
  - infrastructure
  - gcp
  - migration
  - multi-cloud
  - sovereign-nodes
  - anti-entropy
  - frost-threshold
status: accepted
description: >
  Final decisions for the AWS→GCP rebuild. Supersedes the 2026-07-25 two-wave plan
  (1094 lines) — this is the condensed record after Andre's decisions on sync
  topology, role split, compute, and email, plus live gcloud verification of the
  GCP-side assumptions on 2026-07-28.
---

# GCP rebuild — decision record

**Supersedes [[2026-07-25_1034_gcp-relay-and-directory-deployment-plan|the 2026-07-25 two-wave plan]].**
That log holds the full derivations (threshold arithmetic, replication analysis, alternatives
considered); this one holds what was decided. Where they disagree, this document wins.

---

## Decisions

1. **Rebuild from zero — no data migration.** Live DB holds 5 agents, all Andre's testing. Data
   loss is preferred: a clean slate exercises every flow end to end. No cutover, no rollback plan.

2. **Topology: N=3 — one AWS directory (us-east-1) + two GCP directories.** `T = majority(N) = 2`
   unchanged (settled 2026-07-04). One AWS directory backs the launch claim *"if GCP goes down,
   existing agents keep sealing"* — the arithmetic only holds at N=3 with one AWS node. Sealing
   survives a GCP-wide outage; new registration does not (needs |Q| ≥ T). Relays scale freely on
   both clouds and never touch the threshold.

3. **Directory sync: libp2p anti-entropy, built in this rebuild — the Postgres mesh is retired.**
   Decided over "mesh for Wave 1, anti-entropy for Wave 2" and "mesh + VPN". Consequences:
   - **No VPN, no Private Service Access, ever.** The cross-cloud tunnel and its four
     silent-failure config steps are never built.
   - Nodes sync over their existing authenticated libp2p transport (Noise-encrypted, manifest-pinned
     keys). Merkle primitives already exist (`V5__mmr_tables.sql`, `directory_checkpoints`).
   - The slot/worker/`SEQ_INCREMENT` machinery and `setup-replication.sh` go away.
   - **Security-critical piece:** conflict resolution for the mutable tables
     (`agent_suspensions`, `agent_presence`, `primary_holder`). `agent_suspensions` is the kill
     switch — its convergence rule must fail toward *suspended wins*, and gets its own story with
     adversarial review.
   - This is the first directory↔directory application channel in the system. New attack surface;
     design it with the same step-6-style identity verification as client↔directory.

4. **Role split: build fully now — full nodes vs validators.** Manifest entries get a `role`
   field (`validator` | `replica`). Validators hold shares and sign; replicas replicate state for
   redundancy/reads and hold nothing. **The threshold policy does not change:** T remains
   `majority(validators)` — `consortiumNodeCount` must count validator-role nodes only, decoupled
   from `manifest.nodes.length`. Replicas never enter the arithmetic, so the no-two-quorums and
   kill-switch properties are preserved over the signer set. This gives "many nodes = more
   redundancy" without raising ceremony size.

5. **Compute: MIG (size 1) + Container-Optimized OS per node; Cloud SQL per node.** Managed
   auto-healing like ECS today, no Kubernetes. With anti-entropy there is no cross-cloud database
   networking at all — nothing external ever connects to a node's Postgres — so managed Cloud SQL
   is fully consistent with node sovereignty. The single-VM/self-hosted-Postgres shape from the
   superseded doc is dropped (ops burden; its only strong argument was dodging PSA, which no
   longer exists).

6. **GCP project: create `cello-infra`, link to billing account `012EFA-590A2E-2A82B4`.**
   **DONE 2026-07-28.** One correction to what was "verified": IAM was sufficient, but the
   billing account hard-caps at **5 linked projects** (`FAILED_PRECONDITION` — the constraint
   Andre lost days to previously, reproduced in seconds). It is a slot limit, not a wall: the
   empty `claude-code-vertex-mygentic` was unlinked to free a slot and `cello-infra` took it.
   Slot ledger + all bootstrap state: `infra/GCP-STATE.md`. The rename fallback stays dropped.

7. **`NODE_ID = <cloud>-<region>`** (e.g. `aws-use1`, `gcp-usc1`) from first boot, permanent.
   `NODE_ID` feeds `Identifier.derive()` — it is the FROST participant identifier, not a label.
   Renaming later is a decommission. Pick names once.

8. **Email: AWS SES API over HTTPS from GCP.** GCP has no first-party sender and blocks port 25.
   Ops-agent and waitlist call SES's HTTPS API from GCP — pennies, and AWS stays in the picture
   anyway (decision 2).

9. **CI/CD: Cloud Build + Artifact Registry.** Builds move to GCP (AWS CodeBuild dies with the
   credits — it is the hidden critical path). Org policy note below constrains cross-cloud auth.

10. **Enrollment: still deferred.** Not needed at N=3. Required before N grows, since new
    validators hold no shares for existing agents.

11. **Waitlist: stays on AWS for now.** Shipped 2026-07-25, still changing. Revisit when stable.

## Sequencing

- **Wave 0 — capability.** Create `cello-infra`, enable APIs deliberately, Cloud Build + Artifact
  Registry pipeline. (Quota checks: done — see below, ample.)
- **Wave 1 — complete CELLO on GCP, standalone.** Three GCP directories (temporary N=3, no AWS),
  relays, anti-entropy sync, role-split manifest, ops-agent + portal move. Full end-to-end test
  with AWS off: register, seal, live session, kill a directory, client failover.
- **Wave 2 — AWS rejoins.** Fresh us-east-1 directory/relay pair joins over anti-entropy (no
  tunnel). Re-sign manifest to final N=3 (1 AWS + 2 GCP validators). Prove the outage claim:
  GCP directories blocked → existing agent still seals via AWS.
- **Wave 3 — teardown.** Decommission eu-central-1, ap-northeast-1, displaced GCP node, and the
  remaining AWS workloads that moved.

## Verified against live GCP (gcloud, 2026-07-28)

- **Quotas are ample — the "likeliest schedule surprise" warning in the superseded doc was
  wrong.** All candidate regions: 200 CPUs (24 E2), 8 static IPs, 4 TB disk, zero usage. The
  launch footprint needs ~10 vCPU total. No quota requests needed.
- **Org policies that matter (set at org 376185218056):**
  - Service-account key **creation and upload disabled, enforced org-wide.** Anything outside GCP
    authenticating to GCP (e.g. a cross-cloud CI edge) must use Workload Identity Federation.
    Cloud Build inside GCP is unaffected.
  - **Automatic IAM grants for default service accounts disabled.** Fresh VMs have zero
    permissions; every grant (Secret Manager, GCS, logging) is explicit. Failure mode is a silent
    403 — expect it, don't discover it.
  - No external-IP ban; domain-member restriction loosened to allow-all (2025-10). Non-issues.
- **`claude-code-vertex-mygentic` is empty** (0 VMs, no buckets, SQL API never enabled) — but
  unused now that `cello-infra` is confirmed creatable.
- **GCP credits: ~$23k, valid to Nov 2027 — not a constraint and not a discussion point.** GCP
  cost never decides a design question. The clock is the **AWS** credit runway.

## Standing hazards carried forward

- **Shares are never replicated** (`agent_key_shares` has no `node_id`, absent from any sync set).
  Decommissioning a directory destroys its shares. Tripwire: the moment there is a user who is
  not Andre, re-check share count before decommissioning anything, every time.
- **Two manifest entries must never share a FROST identifier** in the same manifest version.
- The deferred FROST slot→identity hardening breaks lift-and-shift by design — ordering matters
  if both ever land.
- Hardcoded multiaddr at `directory.ts:1095` still needs the configurable fix for any non-ALB
  endpoint shape.
- `directory_nodes` holds only one row on the live mesh — diagnose the cause during the rebuild
  (nodes may not self-register), don't just observe the fresh system lacking the symptom.

## Still unverified

- Directory boot behavior with an empty node registry (decides if a Parameter Manager adapter is
  needed at all).
- Client `/bootstrap` handling of an `https://` manifest endpoint.
- AWS remaining credit balance / burn rate — payer-account console only; sets Wave urgency.
