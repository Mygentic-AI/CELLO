---
name: M12 Multi-Cloud Rebuild Definition of Done
type: definition-of-done
date: 2026-07-28
milestone: M12
status: open
topics: [m12, gcp, migration, multi-cloud, anti-entropy, role-split, frost-threshold, infrastructure]
description: >
  The yardstick for M12 — the multi-cloud rebuild: GCP nodes, libp2p anti-entropy replacing the
  Postgres mesh, the full-node/validator role split, CI on Cloud Build, workload moves, and AWS
  teardown. Sole status authority. Spec-of-record is the 2026-07-28 GCP rebuild decision record.
---

# M12 — Definition of Done

## How to use this
- Find the lowest-numbered line not ✅ in the active tier — that is the next unit.
- **Evidence discipline:** a flipped tag carries ONE line of evidence plus `→ Journal Entry N`.
  Full run output lives in the journal. This document stays a scoreboard.
- **Four enforcers** (defined in [[M12-PROCEDURE]] §1): local convergence · GCP standalone ·
  outage claim · IaC region-expansion. A line naming an enforcer is ✅ only when that enforcer ran.
- Tier order is a dependency order, not a calendar. P0 (capability) and P1 (protocol code) can
  interleave; P2 needs both; P3 needs P2; P4 needs P3 **plus Andre's per-stack go**.

## Repo Legend
| Tag | Local path | Notes |
|-----|-----------|-------|
| `trustless-cello` | `/Users/andrep/Documents/code/trustless-cello` | Directory, relay, ALL IaC, ops-agent, e2e-tests, CI |
| `cello-client` | `/Users/andrep/Documents/code/cello-client` | Manifest role parsing, validator selection, bundled manifest. Ships via `/cello-publish` + semver re-pin — never `workspace:*` |
| `cello-portal` | `/Users/andrep/Documents/code/cello-portal` | Portal-move unit only (P2) |

## Status legend
✅ PROVEN (enforcer-green) · 🟡 BUILT/UNVERIFIED-LIVE · 🟠 PARTIAL · ❌ NOT BUILT · 🅿️ PARKED

---

## Tier I — Invariants (must hold in every phase, every line)

- **DOD-INV-SOVEREIGN** [all] — no single node can complete a threshold ceremony alone; no
  privileged node exists in any topology, sync, or deploy decision; no provider-specific
  networking or hardcoded endpoint enters protocol code; a down node is routed around, never
  fatal. — ❌
- **DOD-INV-THRESHOLD** [trustless-cello, cello-client] — `T = majority(validators)` everywhere.
  `consortiumNodeCount` and every threshold/DKG/kill-switch derivation counts **validator-role
  nodes only**; replicas never enter the arithmetic. All-N / T=N never appears (settled
  2026-07-04). — ❌
- **DOD-INV-SHARES-LOCAL** [trustless-cello] — `agent_key_shares` (or successor) appears in NO
  sync set, NO anti-entropy exchange, and NO off-node artifact except the node's own encrypted
  backup. A share never transits between nodes by any mechanism. — ❌
- **DOD-INV-KILL-SWITCH** [trustless-cello] — suspension state fails CLOSED and converges
  suspended-wins: a pause reaches every up node despite partition and restart; an un-suspension
  requires verifiably newer authenticated state; a tie resolves suspended. A paused agent sealing
  because an UP node lacked the state is a critical finding. — ❌
- **DOD-INV-NODEID** [all] — every node is born `<cloud>-<region>` (e.g. `aws-use1`, `gcp-usc1`)
  and is never renamed; no two manifest entries ever hold the same FROST identifier in one
  manifest version. — ❌
- **DOD-INV-NO-VPN** [trustless-cello] — no VPN, VPC peering, Private Service Access consumer, or
  any cross-cloud network tunnel is created. Directory sync happens only over the authenticated
  libp2p transport. Nothing external ever connects to a node's Postgres. — ❌
- **DOD-INV-RELAY-EXTRACTABLE** [trustless-cello] — the relay gains no consortium state, no
  database, no shared internal config package, no directory import; config stays env-only. It
  remains a standalone shippable artifact (future enterprise private relay). — ❌
- **DOD-INV-IAC** [trustless-cello] — every GCP and AWS resource exists in IaC; any manual
  emergency fix lands in IaC + the STATE file (`infra/STATE.md` / `infra/GCP-STATE.md`,
  updated immediately per action, never batched) before its unit closes. Region-expansion test:
  a new region with zero manual steps. — ❌
- **DOD-INV-NO-SAAS / DOD-INV-DOMAIN** [all] — no paid SaaS; all URLs are
  `*.cello.mygentic.ai`. — ❌

---

## Tier P0 — GCP capability + CI

- **DOD-GCP-PROJECT-1** [trustless-cello] — `cello-infra` project exists, linked to billing
  account `012EFA-590A2E-2A82B4`, with ONLY the needed APIs enabled (compute, artifactregistry,
  cloudbuild, sqladmin, secretmanager, storage, logging, monitoring — final list recorded);
  custom-mode VPC created (no default network); `infra/GCP-STATE.md` created in M11's STATE.md
  format and committed. — 🟡 all clauses done live 2026-07-28 (project 955736313934, billing
  linked via slot swap — see the ledger in GCP-STATE.md; 11 APIs; default net deleted,
  `cello-vpc` custom-mode). — ✅ owed import done: APIs/VPC/state bucket Terraform-managed,
  plan clean → Entries 1, 2
- **DOD-GCP-IAM-1** [trustless-cello] — per-workload service accounts (directory-node, relay-node,
  ops-agent, portal, cloud-build) with explicit minimal grants; the compute default SA is used by
  nothing; every grant is recorded in IaC. Org constraints (no SA keys — WIF only; zero default
  grants) are documented in GCP-STATE.md so the silent-403 trap is expected, not discovered. —
  ✅ 5 SAs live via `infra/terraform/iam.tf`, plan clean; unit review run and ALL findings
  fixed (secret access now per-secret only; CI bucket-scoped; tfstate hardened; drift caveat
  documented) → Entries 2, 3
- **DOD-CI-REGISTRY-1** [trustless-cello] — Artifact Registry repo exists; Cloud Build builds the
  directory and relay images from the GitHub repo (path-filtered triggers per package) and pushes
  to Artifact Registry. No local docker push is possible or needed. AWS CodePipeline remains
  untouched and functional for the AWS node until P4. — 🟠 registry live (TF); directory image
  BUILT+PUSHED by Cloud Build (`directory:manual-dedc55ac`, build SUCCESS); relay build running;
  `cello-github` connection created but **PENDING_USER_OAUTH (Andre)** — triggers owed after
  that → Entry 3
- **DOD-IAC-BASE-1** [trustless-cello] — the IaC skeleton (tool per M12-D2) stands up and tears
  down one disposable COS VM in a MIG(size 1) with a static IP, firewall rule, and attached
  service account, entirely from code. IaC enforcer green on this skeleton. — ❌

## Tier P1 — Protocol code (local-provable, no cloud dependency)

- **DOD-ROLE-MANIFEST-1** [cello-client, trustless-cello] — manifest entries carry
  `role: validator | replica`; directory and client both parse and enforce it;
  `consortiumNodeCount` derives from validator count, decoupled from `manifest.nodes.length`;
  DKG participant selection, seal arithmetic, and kill-switch honoring exclude replicas; a
  replica-only manifest is rejected loudly (no validators = no consortium). Version-bump ACs:
  cello-client packages published to beta via `/cello-publish`, trustless-cello re-pinned. — ❌
- **DOD-AE-DESIGN-1** [trustless-cello] — anti-entropy design doc in the vault: which tables sync
  (append-only set vs mutable set), Merkle/root comparison mechanism (reusing
  `V5__mmr_tables.sql` / `directory_checkpoints` where it fits), conflict rules per mutable table
  (`agent_suspensions` suspended-wins with authenticated recency; `agent_presence`,
  `primary_holder` rules stated), the directory↔directory channel's identity verification
  (manifest-pinned keys, step-6-style), and the retirement list for the mesh
  (`setup-replication.sh`, slots, SEQ_INCREMENT machinery). Reviewed before implementation
  starts. — ❌
- **DOD-AE-APPEND-1** [trustless-cello] — append-only tables sync between directories over the
  authenticated libp2p channel via root-comparison + delta pull; divergence detection is
  O(compare), transfer is delta-only; peers that fail identity verification are refused. — ❌
- **DOD-AE-MUTABLE-1** [trustless-cello] — mutable-table sync with per-table conflict rules per
  the design doc; `agent_suspensions` convergence proven adversarially: pause during partition,
  node restart mid-sync, stale-node rejoin, un-pause requiring newer authenticated state, tie →
  suspended. — ❌
- **DOD-AE-LOCAL-E2E-1** [trustless-cello] — **local convergence enforcer:** three directory
  processes on loopback with divergent seeded state converge; kill one mid-sync → restart →
  catch-up; a node absent for a burst of writes converges on rejoin. Runs in e2e-tests via the
  standard fixture (extend `session-fixture.ts`, never a from-scratch fixture). — ❌
- **DOD-MULTIADDR-1** [trustless-cello] — the advertised bootstrap multiaddr is configuration,
  not the hardcoded `/dns4/{host}/tcp/80/ws` template (`directory.ts:1095`); an
  `https`/`wss`-shaped endpoint round-trips through client bootstrap (closes the unverified
  `https://` manifest question). — ❌
- **DOD-ADAPTER-GCP-1** [trustless-cello] — Secret Manager and GCS adapters implemented behind
  the existing interfaces (`packages/interfaces/`), selected by `CELLO_ENV`/config at the
  composition root, with local stubs; the empty-node-registry boot test answers whether a
  Parameter Manager adapter is needed at all (record the answer as a Decision). — ❌

## Tier P2 — Wave 1: complete CELLO on GCP, standalone

- **DOD-NODE-DIR-GCP-1** [trustless-cello] — first GCP directory live (`gcp-<region>`): MIG(1) +
  COS running the CI-built image, its own Cloud SQL (node-only access), Secret Manager secrets,
  fresh transport key (`openssl rand -hex 32`, never copied), static IP, `pg_dump`-to-GCS backup
  timer (shares exist nowhere else). Entirely from IaC. — ❌
- **DOD-NODE-DIR-GCP-2** [trustless-cello] — second GCP directory in a different region; same
  artifact, zero manual steps (IaC enforcer green on the repeat). — ❌
- **DOD-NODE-DIR-GCP-3** [trustless-cello] — third GCP directory (temporary Wave-1 member so the
  standalone consortium is N=3; displaced or re-rolled as replica when AWS joins in P3). — ❌
- **DOD-NODE-RELAY-GCP-1** [trustless-cello] — at least one GCP relay live: MIG(1) + COS,
  persistent disk for the WAL dir, two secrets, static IP. No code changes expected — flag any
  that turn out to be needed. — ❌
- **DOD-MANIFEST-GCP-1** [cello-client, trustless-cello] — fresh consortium manifest signed:
  three `gcp-*` validators with roles, adopted by clients via poll; step-6 directory identity
  verification passes against the new manifest. — ❌
- **DOD-MOVE-OPSAGENT-1** [trustless-cello] — ops-agent runs on GCP; email via the SES HTTPS API
  (WIF or SigV4 credentials handled without SA keys — no key files exist, org-enforced); its
  DB-access pattern redesigned so it needs NO cross-cloud database connection (per-node health
  via node-local API or equivalent — resolve in the unit, journal the design). — ❌
- **DOD-MOVE-PORTAL-1** [cello-portal, trustless-cello] — portal serves from GCP. **Coupling
  clause:** the portal RDS also carries the M11 waitlist tables, and the waitlist (Lambdas, SES
  hooks) STAYS on AWS — the unit must resolve app-first vs move-both vs defer-DB explicitly
  against M12-P2 (parked decision) before touching anything. — ❌
- **DOD-E2E-GCP-1** [trustless-cello, cello-client] — **GCP standalone enforcer:** with AWS
  unreachable, on the rebuilt system: fresh registration → DKG → seal → live two-agent session →
  kill one directory → sealing continues (T−1=1) → client failover → anti-entropy convergence
  verified → kill-switch pause bites across all three nodes. — ❌

## Tier P3 — Wave 2: AWS rejoins + the launch claim

- **DOD-AWS-NODE-1** [trustless-cello] — fresh `aws-use1` directory + relay pair (rebuilt, no
  data carried over), joining the consortium over anti-entropy only (DOD-INV-NO-VPN holds — no
  tunnel exists). AWS side stays on CodePipeline CI until P4. — ❌
- **DOD-MANIFEST-FINAL-1** [cello-client, trustless-cello] — final launch manifest: N=3
  validators = 1 AWS + 2 GCP (+ any replicas), adopted by poll; the displaced Wave-1 GCP node is
  removed or re-rolled as replica in the SAME manifest version. — ❌
- **DOD-CLAIM-1** [trustless-cello] — **outage-claim enforcer:** with both GCP directories
  blocked, an existing agent seals via the AWS node alone; new registration refuses loudly
  (|Q| ≥ T unmet) with a cause-naming error. The honest claim — "existing agents keep working
  through a GCP-wide outage" — is recorded verbatim in the journal with the run output. — ❌

## Tier P4 — Wave 3: teardown (each stack gated on Andre's explicit go)

- **DOD-TEARDOWN-NODES-1** [trustless-cello] — eu-central-1 and ap-northeast-1 stacks removed;
  hibernate/wake scripts and deploy.sh updated to the new topology; STATE.md reflects reality. — ❌
- **DOD-TEARDOWN-USE1-1** [trustless-cello] — old us-east-1 directory/relay/RDS stacks replaced
  by the rebuilt pair's stacks; moved workloads' old AWS resources (ops-agent task, portal ECS/
  ALB/RDS per the P2 portal decision) removed. Waitlist + SES stay. — ❌
- **DOD-TEARDOWN-CI-1** [trustless-cello] — AWS CodePipeline/CodeBuild/ECR reduced to exactly
  what the AWS node needs (or replaced by Cloud Build + WIF cross-push if the unit proves that
  simpler); the four dead REPOSPLIT pipelines removed from `cello-cicd.yaml` +
  `pipeline-mappings.json` (+ `deploy-lambdas.sh dev filter`). — ❌
- **DOD-TEARDOWN-MESH-1** [trustless-cello, cello-client] — the Postgres mesh is fully retired
  from the CODE: `setup-replication.sh`, slot/SEQ machinery, mesh-only config deleted with
  removal-integrity review (proven deadness, built-artifact absence, deleted-test triage by
  subject). — ❌

---

## Decisions

- **M12-D1** (2026-07-28, Andre): Milestone ID is **M12**. The rebuild has nothing to do with the
  waitlist, so an M11 suffix would confuse; it is big enough to take a number. The former roadmap
  M12–M17 (Social Trust … Federation) are renumbered M13–M18 — `implementation-roadmap.md` and
  `ROADMAP.md` updated in the same commit; historical discussion logs and journals keep the old
  numbers (they are records, not living docs).
- **M12-D2** (2026-07-28): **IaC tool for GCP = Terraform** (CloudFormation does not exist on
  GCP; gcloud-script IaC has no state/drift model; Terraform is the practice least likely to need
  reversing and can eventually absorb the AWS side). Overturn before DOD-IAC-BASE-1 if Andre
  objects.
- Decisions 1–11 of the spec-of-record are restated there, not here — this section holds only
  decisions made DURING the milestone.

## Parked

- **M12-P1** — **Demo agent move** (EC2 `i-0ad3e7c22470f266e`, not in IaC). Candidate, not
  decided. Easiest workload to move (systemd units), but every SSM runbook line breaks. Decide at
  P2; write IaC for it whichever cloud it lands on.
- **M12-P2** — **Portal/waitlist DB coupling.** The portal's RDS carries the waitlist tables;
  waitlist stays on AWS while the portal moves. App-first (portal on GCP, DB stays on AWS RDS over
  TLS), move-both-later, or split the schemas — resolve at DOD-MOVE-PORTAL-1, not before.
- **M12-P3** — **Enrollment** (client-side resharing orchestration + may-enroll credential) —
  explicitly OUT of M12 (Decision 10). Required before N ever grows past 3. Directory half
  already exists (`frost-handler.ts:892,915`).
- **M12-P4** — **Replica nodes at launch.** The role split ships in P1, but whether any
  replica-role nodes actually deploy at launch (vs the capability lying dormant) is undecided —
  zero replicas is a valid launch shape.

---

## Related Documents
- [[M12-PROCEDURE]] — how to work this milestone (read first)
- [[M12-BUILD-JOURNAL]] — evidence home
- [[2026-07-28_0700_gcp-rebuild-decision-record]] — spec-of-record
