# GCP Infrastructure State — Authoritative Record

> **Rule (same as STATE.md):** update IMMEDIATELY after every GCP change, never batched.
> A session that changes GCP without updating this file is incomplete.

**Project:** `cello-infra` (number 955736313934) · **Org:** mygentic.ai (376185218056)
**Billing:** `012EFA-590A2E-2A82B4` — linked, enabled. **Milestone:** M12.

---

## Billing slot ledger (the 5-project cap is REAL)

The billing account allows **max 5 linked projects** (`FAILED_PRECONDITION: Cloud billing quota
exceeded`, reproduced 2026-07-28). Linking a 6th requires demoting one first. Current 5:

| Project | Why it holds a slot |
|---|---|
| `cello-infra` | **This project.** Took the slot freed below (2026-07-28). |
| `sso-authentication-and-sign-on` | Pre-existing |
| `mygentic-sdk-agent` | Pre-existing |
| `mygentic-voice-agent` | Pre-existing |
| `gen-lang-client-0809834273` | Pre-existing (gemini-imagegen) |

**Demoted 2026-07-28:** `claude-code-vertex-mygentic` — unlinked (was empty: zero resources,
created 2026-04-21 for a Vertex quota that never came). Project still exists, unbilled;
relink any time by demoting something else.

## Org policies that shape everything here (org-level, verified 2026-07-28)

- **SA key creation AND upload disabled (enforced).** No JSON keys exist or can be made.
  Cross-cloud auth = Workload Identity Federation, or nothing.
- **Automatic IAM grants for default service accounts disabled.** Every permission is an explicit
  grant; a missing one fails as a silent 403 at runtime — check grants FIRST when debugging.
- No external-IP ban (static IPs on VMs are allowed). Uniform bucket-level access enforced.

## Deployed resources

**IaC:** `infra/terraform/` — Terraform, state in `gs://cello-infra-tfstate` (versioned).
Everything below except the project object itself is Terraform-managed; `terraform plan` clean
as of 2026-07-28. **Caveat:** IAM uses additive `google_project_iam_member`, so plan-clean does
NOT detect out-of-band grants — audit with `gcloud projects get-iam-policy cello-infra` at each
tier boundary.

| Resource | Value | Created | How |
|---|---|---|---|
| Project `cello-infra` | number 955736313934 | 2026-07-28 | gcloud (bootstrap layer — managed as data source in TF) |
| Enabled APIs | **20 live** = 11 TF-managed (`terraform/project.tf`) + 9 platform dependencies that cannot be disabled (containerregistry, iamcredentials, oslogin, pubsub ← cloudbuild; servicemanagement, sql-component, storage-api, storage-component, telemetry). Project-creation defaults (BigQuery suite, Datastore, Trace, dataform/dataplex/analyticshub, `cloudapis` bundle) DISABLED 2026-07-28 per done-audit | 2026-07-28 | Terraform + audit cleanup |
| VPC `cello-vpc` | custom-mode. Default network + its 4 firewall rules DELETED. Subnets: `cello-us-east1` 10.10.0.0/24 | 2026-07-28 | Terraform (imported) |
| Bucket `cello-infra-tfstate` | us-east1, versioned, UBLA | 2026-07-28 | gcloud bootstrap, imported into TF |
| Service accounts | `cello-directory-node`, `cello-relay-node`, `cello-ops-agent`, `cello-portal`, `cello-cloud-build` — minimal grants per `terraform/iam.tf`. **Secret access is per-secret only, never project-level** (unit-review finding); CI reads only the staging bucket, never tfstate | 2026-07-28 | Terraform |
| Cloud Build P4SA grants | `cloudbuild.serviceAgent` + `secretmanager.admin` (org policy strips ALL automatic service-agent grants — both had to be granted explicitly for the GitHub connection). Legacy SA's auto-granted `cloudbuild.builds.builder` REMOVED 2026-07-28 (unrecorded, unused — done-audit catch) | 2026-07-28 | Terraform |
| Artifact Registry `cello` | `us-east1-docker.pkg.dev/cello-infra/cello` — docker; images pushed by Cloud Build ONLY. Tags: `directory:{manual-dedc55ac, e8842f33…}`, `relay:{manual-dedc55ac, 4333c70e…, e8842f33…}` — all Cloud Build. **No `:latest` exists** (stale ones deleted per done-audit; consumers pin commit-SHA tags) | 2026-07-28 | Terraform |
| Bucket `cello-infra_cloudbuild` | Cloud Build staging (auto-created by first submit) | 2026-07-28 | service-created |
| Cloud Build connection `cello-github` | us-east1, **COMPLETE** (OAuth by Andre 2026-07-28; GitHub App installation 149532787 on Mygentic-AI, repo CELLO only; token secret P4SA-managed) | 2026-07-28 | gcloud bootstrap, imported into TF |
| Cloud Build repo link `CELLO` | → https://github.com/Mygentic-AI/CELLO.git | 2026-07-28 | Terraform |
| Triggers `cello-directory-image` / `cello-relay-image` | branch `^main$`, path-filtered per package (+ shared root files), run as `cello-cloud-build` SA | 2026-07-28 | Terraform |

**Nothing else exists in this project.** No VMs, no Cloud SQL, no firewall rules; compute
default SA present but attached to nothing and granted nothing.

## Directory node `gcp-use1` (us-east1) — DOD-NODE-DIR-GCP-1, applied 2026-07-28

All Terraform (`infra/terraform/`), all `for_each`'d over `var.directory_nodes` keyed by REGION —
one node = one region is enforced by the map key, and adding a region is adding one entry.

| Resource | Value | Notes |
|---|---|---|
| Cloud SQL `cello-gcp-use1` | POSTGRES_17, `db-custom-1-3840`, ZONAL, 20 GB SSD | **No public IP** (`ipv4_enabled=false`). Reached ONLY over Private Service Connect from this node's subnet — no VPC peering, no PSA, per DOD-INV-NO-VPN. `deletion_protection` + `prevent_destroy`. pgaudit on, `max_connections=200`, PITR 7 days. |
| PSC consumer endpoint | `google_compute_address.sql_psc` + forwarding rule in `cello-us-east1` | The address is what lands in the node's `DATABASE_URL`; reserved, not ephemeral, so an apply cannot silently move it. |
| Buckets | `cello-audit-gcp-use1`, `cello-relay-manifest-gcp-use1`, `cello-backups-gcp-use1` | Three, not one with prefixes — three different trust properties. Node holds **objectCreator** (write, never delete) on audit + backups, **objectViewer** on the relay manifest. Backups age out at 30 days. |
| KMS | keyring `cello-gcp-use1` (us-east1), key `envelope`, 90-day rotation | Per node, never shared: a shared key means one compromised node unwraps every other node's shares. Node holds `cryptoKeyEncrypterDecrypter` only — it cannot destroy versions and orphan its own shares. **Keyrings cannot be deleted in Cloud KMS; this one is permanent.** |
| Secrets | `cello-gcp-use1-{node-key, transport-key, internal-api-key, preauth-issuer-key, db-credentials}` | Replication pinned to us-east1 (automatic replication would place key material in regions the node does not run in). Accessor grants are **per secret**, never project-level. |
| Static IP | `cello-gcp-use1` | Published in the consortium manifest, so it must survive an instance replacement. |
| Firewall | `cello-directory-allow-iap-ssh` (35.235.240.0/20 → 22), `cello-directory-allow-protocol` (0.0.0.0/0 → 4000, 8080), `cello-directory-allow-health-probes` (Google prober ranges → 9090) | Protocol ports are public **on purpose**: libp2p is Noise-encrypted and manifest-pinned, so the transport authenticates its own peers — that is what lets directories reconcile across clouds with no tunnel. The health port is unauthenticated and is NOT public. |
| MIG | `cello-gcp-use1`, zone us-east1-b, size 1, COS, `e2-standard-2` | Never surges (a surged instance fights the pinned IP, and two instances of one node is a split identity). Auto-heal on `/health`:9090 after a 300 s initial delay — the container pulls, resolves secrets, runs Flyway, then boots. |
| Boot | cloud-init (`templates/directory-cloud-init.yaml`), NOT konlet | konlet runs one container and takes env from instance metadata, which is readable by anything with `compute.instances.get`. Metadata carries secret RESOURCE NAMES only; the node resolves values itself with its attached workload identity. Second unit: `cello-backup.timer`, daily `pg_dump` → GCS. |

**Secrets are generated by Terraform, so their values are in the state object** in
`gs://cello-infra-tfstate`. That bucket is versioned, uniform-access, public-access-prevented, and
the CI service account is deliberately scoped away from it. The trade is deliberate and is what
makes DOD-INV-IAC's region-expansion test real: hand-populated secrets are a manual step, and a
copied transport key would give two nodes the same libp2p peer id.

**Terraform auth:** Application Default Credentials need an interactive reauth
(`invalid_rapt`). Runs use `GOOGLE_OAUTH_ACCESS_TOKEN=$(gcloud auth print-access-token)`, which
the gcloud CLI credential provides; it expires hourly, so re-export before each command.

### Two things that were NOT obvious, both found by booting the node

**Container-Optimized OS drops everything at the host firewall.** COS ships iptables `INPUT` with
policy `DROP`, allowing only established connections, loopback, ICMP and tcp/22. A VPC firewall
rule is necessary and NOT sufficient — the packet is allowed onto the wire and dropped by the host.
Symptoms are all one cause and none of them name it: MIG health probes time out, the autohealer
resets the instance on a loop, the SSH host key changes every time (COS regenerates host keys each
boot from its read-only `/etc` overlay), and external connections to 4000/8080 hang. `cello-firewall.service`
in the node's cloud-init opens 4000/8080/9090 and re-runs every boot because COS rebuilds the rules.

**Two grants that org policy does not give implicitly**, both found as a crash loop rather than a
warning: `artifactregistry.reader` on the repository (without it the node cannot pull its own
image) and `storage.bucketViewer` on the relay-manifest bucket (`objectViewer` does not include
`storage.buckets.get`, which `GcsCloudStorageProvider` needs to tell a missing bucket from a
missing object — GCS 404s both).

**Owed:** the DNS record `directory-gcp-use1.cello.mygentic.ai` is NOT created — Route53 lives in
AWS, which is hibernated. The node does not need it to boot; it is needed by
`DOD-MANIFEST-GCP-1`, when clients start dialling this node.

## Directory nodes 2 and 3 — DOD-NODE-DIR-GCP-2 / -3, applied 2026-07-29

Added as **one `directory_nodes` map entry each**. `terraform apply` created **99 resources** and
**not one new resource block was written** — that is the DOD-INV-IAC region-expansion test passing
in practice rather than in principle. Everything in the gcp-use1 table above is reproduced per
node: Cloud SQL over PSC, its own KMS key ring and envelope key, three buckets, five secrets, a
per-node service account, a static IP, a MIG and its cloud-init.

| Node | Region / zone | Address | Ed25519 pubkey | libp2p peerId |
|---|---|---|---|---|
| `gcp-use1` | us-east1 / -b | 34.75.172.108 | `7969e22a7d95293ae343cb2667c2a4d7127aa8748478582fa637674c30e0113c` | `12D3KooWMH58hm8xpuwgwaNSvnvXBuc126jfuUMVbrGNcU2MeEAX` |
| `gcp-usc1` | us-central1 / -a | 34.136.176.190 | `ef961384100bb087f36b68e3a270acb8f22fdf62c4cd5e517e423afb7f399002` | `12D3KooWExQLMbvaioVqQCPkc1ZZgJ5kdoePymtMrg46ugMBs5zi` |
| `gcp-euw1` | europe-west1 / -b | 34.34.166.245 | `9cb77b68a98f49056fef232f4d56eeb9b66b1a6646fe06b966ff570a82ca6c14` | `12D3KooWP52VSVrakyRdPyt23kAuhgp3FV6tiVRByfdyVvHAaEeJ` |

Subnets `10.10.<subnet_index>.0/24` are derived from each node's own `subnet_index`, so a region is
genuinely one entry. Regions were chosen for failure independence: us-central1 shares no power grid
or network fabric with us-east1, and node 3 is on another continent because at N=3 with
T=majority=2 the third node decides whether a US-wide event drops the consortium below threshold.

**Reproduce the identity table:** `infra/scripts/gcp-node-identities.sh` — it reads each node's key
seeds from Secret Manager and pipes them into the existing derivers on stdin (never argv). Verified
against the running node: the offline derivation is byte-identical to what `gcp-use1` logged for
itself at boot, which is the basis for trusting a manifest built from it.

**Two roles per database, deliberately.** `postgres` owns the schema and runs Flyway; the node
connects as `cello_service`, which V2 restricts to INSERT + SELECT under RLS with UPDATE and DELETE
revoked. Running the node as the owner silently disables all of it. V50 grants `cello_service`
SELECT on `flyway_schema_history` so the startup version guard can read the table it checks.

## Quotas (verified 2026-07-28 — ample, no requests needed)

us-east1 / us-central1 / europe-west1 / europe-west3: 200 CPUs (24 E2), 8 static IPs, 4 TB disk.
asia-northeast1: 100 CPUs, otherwise same.

## Credits

~$23k, valid to Nov 2027 (Andre, 2026-07-28). GCP cost is never a design constraint.
