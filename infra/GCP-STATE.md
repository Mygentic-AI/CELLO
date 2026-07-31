# GCP Infrastructure State — Authoritative Record

> **⚠️ READ FIRST: [`docs/planning/aws-to-gcp-migration.md`](../docs/planning/aws-to-gcp-migration.md)**
> — what is running where across BOTH clouds, and what breaks if you stop what. This file
> describes one cloud in isolation; it cannot tell you which one is authoritative.

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

## Consortium-wide secrets and the relay — 2026-07-29

| Secret | Purpose | Granted to |
|---|---|---|
| `cello-consortium-officer-key-0` | Signs the consortium manifest. Root of trust for the roster and the threshold. | **NO workload.** Everything verifies with the PUBLIC key; a node that could read the seed could mint a roster naming itself the whole consortium. |
| `cello-consortium-preauth-issuer-key` | Signs "may register" capabilities. ONE identity — a client presents its capability to whichever directory it reaches. | All three directories |

Officer pubkey `e8300a2b9de7be6f6d629f778dc319715ad0010c0639f3a1564181d56d3eb104` (threshold 1).
Pre-auth issuer pubkey `4468292bbe38ab929e504a1d962abeebe4f02db0a380b4d7880eb4f4dbd56c07`.

**`CELLO_PREAUTH_ISSUER_PUBKEY` is what ENABLES capability checking.** Unset, a directory does not
perform a weaker check — it performs none and accepts registration from anyone who can reach it.
All three nodes ran that way until 2026-07-29 04:55 UTC; they now log
`directory.auth.capability.enabled`.

**Relay `gcp-relay-use1`** — 34.139.119.165, MIG(1) + COS, WAL on its own persistent disk
(`prevent_destroy`, format guarded by `blkid` so a replacement cannot mkfs away journalled frames),
two per-relay secrets, listening `/tcp/4001/ws` (public) and `/tcp/4002` (bound, not exposed —
`CELLO_RELAY_LISTEN_ADDR` defaults to 4001 and collides with WS otherwise). Registered with
`gcp-use1`: `relay.registered` + `relay.adapter.multiaddr.updated`.

**Orphaned, unused, safe to delete by hand:** `cello-gcp-use1-preauth-issuer-key`,
`cello-gcp-usc1-preauth-issuer-key`, `cello-gcp-euw1-preauth-issuer-key`. Superseded by the
consortium-wide issuer above and dropped from Terraform management rather than destroyed —
`prevent_destroy` blocked the delete, correctly.

## Live image tags (2026-07-30)

Both services on **`reviewfix-de1ed949`** (Cloud Build `a918df99` relay / `a904a60d` directory),
pinned in `infra/terraform/terraform.tfvars`. Carries the DOD-SEAL-BROKER-1 review fixes: the relay
now routes around an unreachable brokering directory instead of rejecting the seal (F1), and the
seal-receipt fetch is removed from both sides (an unverifiable root cannot be proof — Entry 60).

Deployed node-by-node, each polled to a real `GET /bootstrap` 200 before the next was touched —
`update_policy = PROACTIVE` means one un-targeted apply would replace all three at once, and T−1=1
tolerates exactly one node down.

| Node | Address | Verified ready |
|---|---|---|
| `gcp-usc1` | 34.136.176.190 | 2026-07-30 |
| `gcp-euw1` | 34.34.166.245 | 2026-07-30 |
| `gcp-use1` | 34.75.172.108 | 2026-07-30 |
| `gcp-relay-use1` | 34.139.119.165 (internal 10.10.0.28) | 2026-07-30 |

## Portal (DOD-MOVE-PORTAL-1) — LIVE 2026-07-31

| Resource | Value |
|---|---|
| Cloud Run service | `cello-portal`, us-east1, image `portal-317ffba` |
| Hostname | **https://portal.cello.mygentic.ai** — the same name it had on AWS |
| Load balancer | global external ALB, IP `34.111.250.93`, serverless NEG `cello-portal-neg`, managed cert `cello-portal-cert`; :80 redirects to :443 |
| DNS | Route 53 zone `Z02692523DOH7NW521CL8`, A record → `34.111.250.93` (was `198.51.100.1`, the hibernate placeholder) |
| Run URL | https://cello-portal-jk4mcnqbeq-ue.a.run.app (still serves; the LB fronts it) |
| Cloud SQL | `cello-portal`, us-east1, POSTGRES_17, `db-g1-small`, deletion_protection ON |
| Signing key | Cloud KMS `cello-portal/portal-submission` v1, `EC_SIGN_ED25519`, us-east1. Pubkey `6f0203b8…80e5`, enrolled `submitter` in all 3 node DBs |
| Directory path | `DIRECTORY_API_URLS` → the three PINNED internal IPs on **8081**, over Direct VPC egress; one key per node in `cello-portal-directory-api-keys`, positionally paired |
| Secrets | `cello-portal-database-url`, `cello-portal-kms-master-key` (both `prevent_destroy`), `cello-portal-directory-api-keys`, and copied from AWS: `-github-client-id`, `-github-client-secret`, `-intake-key-0`, `-ingress-trigger-secret`, `-submission-seed` |
| Verified | 307 → `/sign-in` over https on the real hostname; **portal→directory proven through the app** — POST `/api/internal/ingress/drain` returns `ok:true` with `nodeErrors: []` (refuses 401 without the trigger secret); issuer enrolled on usc1/euw1/use1 |

**Why the hostname was kept.** The GitHub OAuth callback is registered against
`portal.cello.mygentic.ai`, and `WEBAUTHN_RP_ID` is part of what every passkey is bound to. Serving
from the run.app URL would invalidate every enrolled passkey permanently — a passkey cannot be moved
between origins. A Cloud Run domain mapping was the first choice and needs the domain user-verified in
the project (a manual console step); the load balancer proves control through DNS instead.

**8081 is dropped by the HOST, not the VPC.** COS ships `INPUT` with policy DROP. The cloud-init unit
opened 4000/8080/9090 and not 8081, so the internal API was unreachable while every cloud-level rule
read as correct — a connection TIMEOUT, which points at the network rather than the box. `8081` is now
opened by cloud-init, scoped to `10.10.0.0/16` as a second gate behind the GCP rule. Confirmed on all
three replacement instances.

**The master key is not rotatable by accident.** `cello-portal-kms-master-key` decrypts the recoverable
values the portal holds (the email the directory never sees). `prevent_destroy` on the random_id, the
secret, and the version. It is a NEW key: the GCP database started empty, so nothing here is encrypted
under the AWS one — if that data is ever migrated it must come with ITS key or be re-encrypted.

**Two grants this org's policy does not create automatically** (same behaviour that bit Cloud Build):
- Cloud Run service agent → `roles/artifactregistry.reader` on the `cello` repo. Without it, creating
  the service fails as `Error code 7 … internal error`, which reads like a transient GCP fault and is
  actually PERMISSION_DENIED on the image pull.
- The portal SA → `secretmanager.secretAccessor` on each secret. IAM propagation lags the apply, so a
  first attempt in the same run can still fail; retrying after ~1 minute succeeds.

## Quotas (verified 2026-07-28 — ample, no requests needed)

us-east1 / us-central1 / europe-west1 / europe-west3: 200 CPUs (24 E2), 8 static IPs, 4 TB disk.
asia-northeast1: 100 CPUs, otherwise same.

## Credits

~$23k, valid to Nov 2027 (Andre, 2026-07-28). GCP cost is never a design constraint.

## Client — the bundled roster now points at GCP (2026-07-31)

Until this, **no client could connect to anything**. The published client bundles the roster of
sovereign directories and bootstraps from it; that roster named the three AWS nodes, whose hostnames
resolve to `198.51.100.1` — the placeholder hibernation left behind.

| | |
|---|---|
| Published (beta) | **`daemon@0.0.103`, `cli@0.0.106`** — tag `v0.0.160`, smoke-tag green (supersedes 0.0.101/0.0.104 and 0.0.102/0.0.105) |
| Verified on the tarball | `dist/bundled-consortium-manifest.js` contains gcp-use1/usc1/euw1 and no AWS ids; `PRODUCTION_DIRECTORY_URL = http://34.75.172.108:9090`; the step-6 downgrade warning (`step6`) is present in `dist/manifest-deps.js`; `cli` pins `daemon@0.0.102` exactly |
| Manifest | v2, officer root key `e8300a2b…b104`, intake key `intake-dev-1` / `87da56bf…b3d1` (the AWS key, carried over — clients already trust manifests naming it) |
| **`latest` promotion** | **NOT DONE — Andre runs it.** Commands are in the session hand-off |

**`PRODUCTION_DIRECTORY_URL` must be one of the bundled `endpoint` values, byte for byte.**
`buildManifestDeps` loads the bundled roster only when the resolved directory URL matches a node in
it, and otherwise falls through to the pre-roster path with step-6 directory authentication OFF. A
DNS name that resolves to the very same node does NOT match, so cold boot silently loses the defence
against a MITM redirecting `/bootstrap` — no error, no log. A test now asserts that relationship.
`directory-use1|usc1|euw1.cello.mygentic.ai` resolve to the nodes for humans and curl.

### Live end-to-end proof on GCP (2026-07-31, two isolated daemons)

Registration exercised the real path — a minted pre-auth capability, not a build with the check off.

1. `create-agent` → `register-agent` — DKG across all three GCP directories, T = majority(3) = 2.
2. Both agents `online`, `directory_signaling: connected`, standing receiver ready.
3. Session established between them over the relay.
4. Messages delivered BOTH directions (`delivered: true`).
5. `close-session` returned a sealed Merkle root with a live attestation from both participants.

Two test agents (`M12_Smoke`, `M12_Peer`) remain registered in the GCP directories; their daemons are
stopped. Harmless, and removable with `cello remove-agent`.

**"Configured" means a key for EVERY directory.** The portal reached the nodes fine and then refused
to build a client: *"No directory client configured. Set DIRECTORY_API_URL + DIRECTORY_API_KEY"* — on a
deployment where the URLs and a key per node were both set. The gate asked only whether the SINGLE
key was present, and its message named the two variables a GCP operator does not want. It now requires
a key per URL, which also closes the dangerous middle ground: one key across three directories
authenticates to at most one, so the system looks healthy until failover routes to a node that
rejects it. Found by calling the live route, not by reading.

## Operations agent on GCP (2026-07-31)

**Why it is launch-critical, not monitoring:** registering an agent requires a pre-authorization
capability, and this Telegram bot is the ONLY thing that issues one to a human — the portal does not.

| | |
|---|---|
| Cloud Run | `cello-ops-agent`, us-east1, `INGRESS_TRAFFIC_INTERNAL_ONLY`, image `ops-c04bb0fa` |
| Scaling | **min = max = 1, `cpu_idle = false`** — the Telegram adapter long-polls, so it needs a process between requests; two instances would race for the same update; a throttled poll loop goes deaf while looking healthy |
| Directory | `http://10.10.0.35:8081` (gcp-use1 internal) + that node's own internal API key |
| Database | `cello-ops-agent-database-url` → gcp-use1 Cloud SQL over PSC as **`cello_ops_agent`** (V26's least-privilege role — never the `postgres` owner, never `cello_service`). **No cross-cloud DB connection** |
| Migration version | **57** — V57 grants `cello_ops_agent` SELECT on `flyway_schema_history`, mirroring V50 for `cello_service` |
| Per-node health | `DIRECTORY_HEALTH_URLS` → all three nodes' `/health` on 9090, **every 5 minutes**, after the port opens. Verified live: `3/3 nodes at schema 57`, and it caught both a real transient (`unreachable: 10.10.1.25 (timeout after 5000ms)` during a node roll) and its recovery |
| Verified | `ops_agent.started`, `ops_agent.telegram.connected`, `telegram.polling.started`, `ops_agent.health_server.started` |

**Per-node health — CLOSED 2026-07-31.** The agent asserted a schema version against ONE database, so
in a three-node consortium drift on the other two was invisible: each sovereign node runs its own
Cloud SQL and its own Flyway, and a node a migration behind keeps accepting writes and diverges
quietly. It now reads every node's `/health` (which already reports `nodeId` and `schemaVersion`)
rather than opening three DB connections — a monitor holding admin credentials for every sovereign
node's database would be a standing cross-node privilege in a system built to have none.

**REPORTED, NEVER A STARTUP GATE.** `healthy` decides whether the process exits at boot, and this
agent is the only thing issuing registration capabilities to a human. Refusing to start because one
of three nodes is unreachable would turn a survivable outage into a total one — the redundancy
invariant defeated through the monitor instead of the protocol. A test pins that a degraded
consortium still leaves it runnable.

**The remaining gap: OTP delivery still uses SES with static AWS credentials**, not SigV4/WIF. No GCP
service-account key is involved, so the org policy holds, but this IS a live AWS dependency in a
system otherwise off AWS and must be replaced before that account closes.

**A rollout used to take the bot down, and it was not the change being deployed.** Telegram allows
one `getUpdates` poller per bot and answers 409 to a second; the adapter called `process.exit(1)` on
it. Cloud Run revisions OVERLAP by design, so every deploy made the new instance conflict, exit, be
restarted, and conflict again — with the registration path down throughout. A conflict is now fatal
only if it does NOT clear (default 90s), which separates "a deploy is in progress" from "somebody
started a second ops agent"; a successful poll resets the window. Verified live: the serving revision
logged `telegram.poller.conflict.transient` and came up.

**The Dockerfile never copied `patches/`.** The lockfile references them, so the build failed outright
here — and the failure mode when it does not fail is worse: pnpm installs the UNPATCHED package and
produces an image that boots fine and is subtly wrong. `packages/directory/Dockerfile` has carried
this copy and a warning for some time; the ops-agent one had drifted.

### Review findings on the roster change, closed (2026-07-31)

The two HIGH findings were the same defect in PROSE that the code change had just fixed — hardening a
constant while leaving the document that overrides it achieves nothing.

- `README.md` gave `CELLO_DIRECTORY_URL` a default of `directory-us1.cello.mygentic.ai` — a dead AWS
  host. An operator "fixing" it to the live `directory-use1` NAME gets a working client with step-6
  **off**, because the roster is matched byte-for-byte, not by "reaches the same machine".
- The comment inside the gate claimed the production default "IS in the bundle" — false in both
  halves, and it read as authorisation for exactly the substitution the change exists to prevent.
- **The downgrade is now announced.** It logged at `info` with a reason indistinguishable from the
  benign local-dev case. Loopback/private stay `info`; anything else `warn`s with `step6: "disabled"`.
- Two tests had less grip than they looked: the threshold test asserted `Math.floor(n/2)+1 === 2`,
  arithmetic on a literal no production code runs (a client demanding all 3 nodes kept it green) —
  it counts through `validatorNodes()` now; and `intake_key` had no named assertion.

Still open from that review, not blocking: `multiaddr` is in the signed manifest but has no consumer —
the client dials whatever the plaintext `/bootstrap` returns. The worthwhile fix is to cross-check the
probe's `peerId` against the manifest's declared one in `manifestNodesToEndpoints` and reject a
mismatch. Step-6 already defends the identity, so this is defence-in-depth at the dial layer.

### The declared peer id is now checked (2026-07-31)

The last open review finding. Every manifest node carries `peerId` and `multiaddr` inside the SIGNED
body, and nothing read either — the client dialled whatever the plaintext `/bootstrap` probe returned,
so the signature covered a field no code consulted. That reads as a dial-layer defence while being
none. A probe answering with an undeclared peer id now refuses the dial
(`directory.consortium.node.peer_id_mismatch`) instead of connecting and being rejected a round later
at step-6. A node declaring no `peerId` is tolerated — pre-field manifests carry none, and treating
"not declared" as "mismatch" turns hardening into an outage — and one bad entry drops only that node.

**Verified against the LIVE fleet using the PUBLISHED tarball**, because this change could have
stranded every client if the declared ids disagreed with production: clean-install of
`cli@0.0.106` → `daemon@0.0.103`, `declaredNodes: 3, resolvedNodes: 3`, no mismatch; then a full
operator path on those exact bits — create → register (DKG) → `directory_signaling: connected`,
state `online`, standing receiver ready.

### The role the ops agent connects as — three attempts, and why the first two were wrong

1. **`postgres` (the owner)** — bypasses every RLS policy and the REVOKE never applied to it, so a
   process that writes registration rows could mutate `conversation_seals`, `attestations` and
   `agent_key_shares`. Caught by review.
2. **`cello_service`** — can write `registrations` but has **no rights at all** on
   `channel_identities`. Registration would have failed at the step that records the operator's
   channel identity, and only when a real person first tried. Caught by probing BOTH tables; the
   first probe passed and I wrote "verified" on the strength of it.
3. **`cello_ops_agent`** ✅ — the role V26 created for exactly this workload, scoped to the
   registration tables and explicitly barred from `agent_profiles` and the key shares. Privileges
   confirmed with `has_table_privilege` against the live database, not read off the migrations.

`V57` grants that role SELECT on `flyway_schema_history` — the identical gap V50 fixed for
`cello_service`. Without it the startup guard reports a permissions fault as a schema fault, which
is exactly what it did: `database: "failed (42501: permission denied for table
flyway_schema_history)"`. That message naming its SQLSTATE is itself one of the review fixes; the
previous version would have said only `failed`.

**Cloud Run will not retry a revision it has given up on.** Revision 00005 crash-looped against the
pre-V57 schema, and once the grant landed, `terraform apply` was a no-op — same spec, same revision,
still dead. The template now carries an `expected-schema` label tied to the migration version, so a
schema bump always mints a FRESH revision instead of reusing a failed one.
