# GCP Infrastructure State — Authoritative Record

> **⚠️ READ FIRST: [`docs/planning/aws-to-gcp-migration.md`](../docs/planning/aws-to-gcp-migration.md)**
> — what is running where across BOTH clouds, and what breaks if you stop what. This file
> describes one cloud in isolation; it cannot tell you which one is authoritative.

> **Rule (same as STATE.md):** update IMMEDIATELY after every GCP change, never batched.
> A session that changes GCP without updating this file is incomplete.

> ### ⚠️ STANDING DEVIATIONS — things that are deliberately NOT in their intended state
> - **`gcp-usc1` is TEMPORARILY DOWNSIZED to `e2-medium`** (2 shared/burstable vCPU + 4 GB, vs
>   `e2-standard-2`'s 8 GB), zone `us-central1-a`. Taken 2026-08-06 to restore the third node after a
>   region-wide `ZONE_RESOURCE_POOL_EXHAUSTED` outage left the consortium at exactly threshold.
>   **REVERT to `e2-standard-2` when us-central1 has capacity** — re-probe with the recipe in the
>   capacity playbook below. The revert marker is in `terraform.tfvars` beside the value.
> - **`max_surge_fixed = 1` was CONSIDERED AND REJECTED for the directory MIG** (2026-08-06). It
>   would not work: the instance template pins BOTH single-holder addresses — `network_ip`
>   (static internal) and `nat_ip` (static external) — so two instances from it can never coexist
>   and a surge fails on IP conflict. It would plan cleanly and break the NEXT roll, which is worse
>   than leaving it. The create-before-destroy intent needs either a **regional MIG** (GCP picks any
>   zone with capacity; works at surge 0 because only one instance exists at a time, and both pinned
>   addresses are regional) or a **capacity reservation** (zero exist today). Neither is applied.

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
| Cloud Build P4SA grants | `cloudbuild.serviceAgent` + `secretmanager.admin` (org policy strips ALL automatic service-agent grants — both had to be granted explicitly for the GitHub connection). ~~Legacy SA's auto-granted `cloudbuild.builds.builder` REMOVED 2026-07-28 (unrecorded, unused — done-audit catch)~~ **IT WAS NOT UNUSED.** That grant is what lets a trigger running as a user-specified SA create a build; removing it broke CI the same day (last trigger-attributed build 2026-07-28T07:32Z) and every push since produced no image and NO build record. Restored 2026-08-05 and now DECLARED in `terraform/iam.tf` on `cello-cloud-build@` so an apply cannot strip it again. Read this as the cost of removing an out-of-band grant without first establishing what depends on it | 2026-07-28 | Terraform |
| Artifact Registry `cello` | `us-east1-docker.pkg.dev/cello-infra/cello` — docker; images pushed by Cloud Build ONLY. Tags: `directory:{manual-dedc55ac, e8842f33…}`, `relay:{manual-dedc55ac, 4333c70e…, e8842f33…}` — all Cloud Build. **No `:latest` exists** (stale ones deleted per done-audit; consumers pin commit-SHA tags) | 2026-07-28 | Terraform |
| Bucket `cello-infra_cloudbuild` | Cloud Build staging (auto-created by first submit) | 2026-07-28 | service-created |
| Cloud Build connection `cello-github` | us-east1, **COMPLETE** (OAuth by Andre 2026-07-28; GitHub App installation 149532787 on Mygentic-AI, repo CELLO only; token secret P4SA-managed). **Re-authorized by Andre 2026-08-05** to test M12-P11 — connection still reports COMPLETE, repo still linked, and `terraform plan` shows **ZERO drift** (installation id unchanged at 149532787, so the App was NOT reinstalled). **It did NOT fix event delivery** — see the M12-P11 note below | 2026-08-05 | gcloud bootstrap, imported into TF |
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

## Relay on `a84659eb…` — us-east1 rolled 2026-08-05, europe-west1 pending

**Relay: `a84659eb46eaa1b9f51f7afeff90c71df36671ee`** (Cloud Build `8eaddd07`, source fetched by
Cloud Build from the GitHub repository resource at that revision — not a local tree). Verified
before deploy: `@cello-protocol/transport@0.0.44` inside the image
(`/app/node_modules/.pnpm/@cello-protocol+transport@0.0.44/…`), which the new relay requires and
below which it refuses to start.

Carries DOD-RELAY-KEEPALIVE-1 (relay stops severing healthy client links —
`abortConnectionOnPingFailure: false`, legacy `startRelay` factory deleted) and
DOD-GCP-RELAY-DRIFT-1 (`RELAY_SESSION_MAX_IDLE_MS` 1800000 → 86400000).

**us-east1 — rolled 2026-08-05T05:00Z.** Instance `cello-gcp-relay-use1-5sv2` replaced `-c27q`;
pinned IP `34.139.119.165` unchanged. MIG `isStable`/`versionTarget.isReached` both true. Boot log
confirms the drift is closed from the relay's own mouth, not from the template:

```
relay.config.idle_sweep   maxIdleMs=86400000
relay.service.started · relay.registered · relay.health.check.passed
```

**europe-west1 — rolled 2026-08-05T05:04Z**, after us-east1 was verified stable, never
simultaneously (§2c). Instance `cello-gcp-relay-euw1-ls9t` replaced `-psqp`; pinned IP
`34.77.112.231` unchanged; MIG stable. Same `relay.config.idle_sweep maxIdleMs=86400000`.

Both relays now report the 24-hour sweep from their own boot log:

```
05:00:53Z  instance 5317009583785344416 (us-east1)      maxIdleMs=86400000
05:04:55Z  instance 5475719577539148496 (europe-west1)  maxIdleMs=86400000
```

**Applied with `-target` on the two relay resources deliberately.** A full `terraform apply` also
wants to update `ops_agent`, `ops_dashboard`, `portal`, `waitlist` (Cloud Run) and the portal Cloud
SQL instance in place — unrelated drift that belongs to whoever owns those, not to a relay roll.

Post-roll `terraform plan` is **`0 to add, 5 to change, 0 to destroy`**, and all five are that same
unrelated set — **no relay resource appears**. Since `terraform plan` is this project's GCP inventory
(procedure §5), that is the authoritative confirmation the relay deploy is fully applied, not a claim
from this document.

## 🟡 Directory on `dir-22b9a522` — 2/3 ROLLED, us-central1 BLOCKED ON GCP CAPACITY (2026-08-06)

**Image:** `dir-22b9a522`, Cloud Build `b9ae40fc`, built from the GitHub connection at revision
`22b9a5220cb97936ecc8e599f92d5b4d8312611b` — NOT `builds submit .`, so the tag names a commit whose
contents were actually built. Push-triggered builds still do not fire (unchanged, Google-side), so
this was an explicit regional `builds submit` per the recorded working path.

**Carries two fixes:** `DOD-ACCOUNTS-CHAIN-1` (registration wrote `user_accounts` outside the hash
chain — every real account, so `verifyChain` was permanently red and tamper-evidence nonfunctional)
and `DOD-SIGNALING-LIVENESS-1` (an agent's own second signaling stream deregistered it on close,
leaving it `online` on every surface and unreachable — the 2026-07-31 incident's root cause).

**Applied with `-target` on the 3 instance templates + 3 instance group managers, deliberately** —
a full apply also wants the same unrelated `ops_agent` / `ops_dashboard` / `portal` / `waitlist`
Cloud Run + portal Cloud SQL drift documented above (and would DESTROY a hand-added
`105.234.180.85/32` authorized network on the portal SQL instance — left untouched).

**Post-roll `terraform plan` = `0 to add, 5 to change, 0 to destroy`, no directory resource
present** — the authoritative confirmation the directory roll is fully applied.

| Node | State |
|---|---|
| `gcp-use1` 34.75.172.108 | ✅ rolled, `/health` + `/manifest` → 200 |
| `gcp-euw1` 34.34.166.245 | ✅ rolled, `/health` + `/manifest` → 200 |
| `gcp-usc1` 34.136.176.190 | ✅ RECOVERED on `e2-medium` — see the capacity playbook below |

**Why usc1 went down, and it was not the image.** `ZONE_RESOURCE_POOL_EXHAUSTED` — Google had no
capacity. The MIG (`PROACTIVE` / `REPLACE` / `max_unavailable_fixed = 1`, `max_surge_fixed = 0`)
**deletes before it creates**, so the healthy old instance was destroyed and could not be replaced.
All three nodes were back and serving 200 within the hour; the consortium ran at exactly threshold
(T = majority(3) = 2) in between — functional, zero spare.

---

## 📕 PLAYBOOK — `ZONE_RESOURCE_POOL_EXHAUSTED` on a node roll (written 2026-08-06 from a live one)

**Read this before chasing zones. The intuitive fix is the wrong one.**

**First: is it us or Google?** These are different errors and only one is ours.
- `QUOTA_EXCEEDED` → **our** limit. Usage will be AT the limit. Ask for a quota bump.
- `ZONE_RESOURCE_POOL_EXHAUSTED` → **Google** physically has no free machines of that type in that
  zone. Nothing to do with our quota.

Check with:
```
gcloud compute regions describe us-central1 --project cello-infra --format=json \
  | python3 -c "import json,sys; [print(q['metric'], q['usage'], q['limit']) for q in json.load(sys.stdin)['quotas'] if q['metric'] in ('CPUS','E2_CPUS','N2_CPUS','INSTANCES')]"
```
On 2026-08-06 this read **usage 0.0 against limit 200.0** — zero, because the MIG had already
deleted our instance. Definitively Google's capacity, not ours.

**Second: the ZONE is usually NOT the variable — the MACHINE TYPE is.** This cost two failed rolls.
`us-central1-a`, `-b` and `-c` were ALL exhausted for `e2-standard-2`, and `n2-standard-2` and
`t2d-standard-2` were exhausted too — the whole region was short of 2-vCPU **standard** capacity.
`e2-medium` had capacity in `-a` all along. Moving zone while holding the type constant just
rediscovers the shortage in a new place.

**Probe capacity directly — do not guess, and do not trial-and-error through terraform** (each
attempt costs a full apply cycle). Create one throwaway instance and delete it. Note `--subnet`:
the default network is deleted in this project, so a probe without it fails on the NETWORK, which
looks nothing like a capacity error and will send you down the wrong path:
```
gcloud compute instances create cap-probe --zone=us-central1-a \
  --machine-type=e2-medium --image-family=debian-12 --image-project=debian-cloud \
  --subnet=cello-us-central1 --no-address --project cello-infra
gcloud compute instances delete cap-probe --zone=us-central1-a --project cello-infra --quiet
```
**Probe the (zone, machine type) PAIR.** They are chosen together. Verifying `e2-medium` in `-a` and
then applying it in `-b` — which is exactly what happened here — fails again for a third time.

**Zone changes are safe for the manifest; region changes are NOT.** The node's external IP is a
**regional** `google_compute_address`, so moving between zones inside a region keeps the same IP and
the published consortium manifest stays valid. Moving to a different REGION changes the IP, and the
roster is **bundled into the published client** — that is a client release, not an infra tweak.
Never reach for a region change to solve a capacity problem.

**The structural fix, not yet applied — `max_surge_fixed = 0` is what turns a shortage into an
outage.** With surge 0 the MIG destroys the running instance first, so a capacity failure leaves
NOTHING. With `max_surge_fixed = 1` it would create the replacement first, fail harmlessly, and
leave the healthy node serving. The cost is briefly running two instances per region during a roll.
**Strongly recommended before the next roll** — it converts this class from an outage into a no-op.

**Current state of usc1 after the incident:** `zone = us-central1-a`, `machine_type = "e2-medium"`
— a **TEMPORARY DOWNSIZE** (2 shared/burstable vCPU + 4 GB, vs 8 GB on standard) taken to restore
the third node rather than sit at threshold. Fine at pre-launch load. **Revert to `e2-standard-2`
once us-central1 has capacity**; re-probe with the command above to check. The revert marker is in
`terraform.tfvars` beside the value.

**✅ ACCEPTANCE CHECK RUN 2026-08-06 (IAP SSH + Secret Manager + psql) — and it FAILED on one node.**
There is no health/API surface exposing `verifyChain` (that gap is a recorded follow-on), so this was
done by hand: IAP SSH to each node → access token from the metadata server → DB credentials from
Secret Manager → `docker run postgres:18 psql` over the PSC address → recompute the chain in Python.

| Node | `user_accounts` | `verifyChain` |
|---|---|---|
| `gcp-use1` | 1 row, `CHAINED_OK` | ✅ **VALID** |
| `gcp-usc1` | 1 row, **`UNCHAINED_LEGACY`** (stored hash == `SHA-256(account_id ‖ phone_stub_hash)`) | ❌ **INVALID** |

**"Greenfield, nothing to migrate" was WRONG** — there is one pre-fix account row, and it behaves
exactly as the unit review predicted: `pg-ae-store` applies replicated `user_accounts` rows through
`insertWithChain`, which RECOMPUTES `chain_hash` locally, so the row landed **chained on the
receiver** and stayed **unchained on the node that originally wrote it**. Receivers converge clean;
the origin does not. `gcp-usc1` was the origin.

**⚠️ OPEN — one row on `gcp-usc1` needs repair, and it is deliberately NOT done unilaterally.**
Until it is, `verifyChain("user_accounts")` stays red on that node, and a red verification cannot be
told from a tamper — which is the precise defect `DOD-ACCOUNTS-CHAIN-1` exists to remove. The row's
DATA is fine; only its `chain_hash` was computed with the wrong algorithm. Options:
1. **Recompute the one hash** — `UPDATE ... SET chain_hash = SHA-256(serialize(record) ‖ GENESIS)`
   for the single row at position 1. Surgical; account_id and phone_stub_hash untouched.
2. **Delete it and let anti-entropy re-replicate it chained** — note it may be an FK target of
   `agent_profiles.account_id`, so this is `SET NULL` + re-link, never a bare `DELETE`.

**Why this needs an explicit decision rather than an agent's judgement:** rewriting a `chain_hash` in
an append-only tamper-evidence table, using admin credentials to bypass the RLS that deliberately
denies the app user `UPDATE`, is *the exact operation the chain exists to detect*. It is a legitimate
repair of a known-bad write, but it must be a recorded decision, not a side effect. Andre's call.
The verification recipe above is repeatable — re-run it after any repair.

## Live image tags — directory on `dir-d35d0a1d` (2026-08-03, ROLL COMPLETE)

**Directory: `dir-d35d0a1d`** (Cloud Build `d8060aaf`, from `origin/main` @ `d35d0a1d`, clean tree).
Second roll of the day. Carries the chained-registry fix: `conversation_seals` and
`relay_registrations` are in `HASH_CHAINED_TABLES` but were registered for anti-entropy on
2026-07-31 without the `chained` flag, so `applyTierA` took the generic INSERT and supplied no
`chain_hash`. Verified in the built artifact before deploy — 4 `chained` flags, up from 2.

### The seals converged, and the divergence was worse than the baseline showed

Pre-deploy: `use1=0, usc1=2, euw1=2`. The obvious reading — two nodes hold the same two seals, one
holds none — was **wrong**. Post-deploy every node holds **4**: `usc1` and `euw1` each held two
seals *the other lacked*, so all three nodes were diverged from each other and the true set was
double what the baseline suggested. `use1` converged on the first round after it alone was rolled
(the fix is on the APPLY side, so serving from not-yet-rolled peers was unaffected).

| Node | Address | `conversation_seals` before → after | Empty `chain_hash` |
|---|---|---|---|
| `gcp-use1` | 34.75.172.108 | 0 → **4** | 0 |
| `gcp-usc1` | 34.136.176.190 | 2 → **4** | 0 |
| `gcp-euw1` | 34.34.166.245 | 2 → **4** | 0 |

Post-roll, verified against the live databases and logs, not inferred: all three MIGs
`isStable=True`, all three `bootstrap` 200, `antientropy.round.completed` firing continuously (six
in fifteen seconds), and **zero** `apply.failed`, **zero** `fork_suspected`, **zero**
`table.skipped`. The `apply.failed`/`fork_suspected` entries at 19:44–19:48 are the roll window
itself, when nodes were on mixed images; nothing after 19:49.

`relay_registrations` remains 0 rows on all three — the silent variant never fired, and is now
closed before it could.

### Superseded — directory on `dir-8fc23d86` (2026-08-03, earlier the same day)

**Directory: `dir-8fc23d86`** (Cloud Build `7b03bf48`, built from `origin/main` @ `8fc23d86`, clean
tree). Carries the M12-P9 anti-entropy fix — per-table isolation on BOTH the responder's
advertisement and the dialer's local read, so one unreadable table costs that table's replication
for the round instead of every table's, on every node. See DoD M12-P9 and journal Entry 77.

Verified in the BUILT ARTIFACT, not the source, before any node was touched: `ae-channel.js`
carries `onTableError`, `ae-round.js` carries `unreadableA` (the guard that stops an unreadable
table being read as empty and pulled whole), `anti-entropy-engine.js` carries the dialer isolation,
and `ae-sync-service.js` logs `antientropy.table.skipped` at `error`.

| Node | Address | On `dir-8fc23d86` | Verified ready |
|---|---|---|---|
| `gcp-use1` | 34.75.172.108 | ✅ | 2026-08-03 — `bootstrap` 200, MIG stable, image confirmed from instance metadata |
| `gcp-usc1` | 34.136.176.190 | ✅ | 2026-08-03 — same three checks |
| `gcp-euw1` | 34.34.166.245 | ✅ | 2026-08-03 — same three checks |

Post-roll: all three MIGs `isStable=True`, all three `bootstrap` 200, all three confirmed on
`dir-8fc23d86` from their own instance metadata, and `antientropy.round.completed` firing across the
fleet. **No `antientropy.table.skipped`** — the new containment is present and NOT firing, which is
the correct healthy state: the spec bug that caused the 2026-08-01 outage is already fixed, and this
deploy bounds the blast radius of the next one.

### ⚠️ Found during this roll — `conversation_seals` has never replicated

Every anti-entropy round fails to apply that table:

```
antientropy.apply.failed  conversation_seals
  null value in column "chain_hash" of relation "conversation_seals" violates not-null constraint
antientropy.round.fork_suspected
```

**PRE-EXISTING, not caused by this deploy** — the same errors appear at 12:59 on 2026-08-03, on
nodes still running `dir-69825467`. Two reasons it matters more than a log line:

1. `fork_suspected` is firing. The engine header states that `pulled > 0 && applied === 0` round
   after round is the fork signature that must be treated as an alarm and **never as health** — and
   it is currently firing into a log nobody tails. That is the same shape as the outage this deploy
   exists to prevent.
2. Apply-phase containment is doing its job (the round completes, other tables converge), so this is
   loud-but-ignored rather than silent. It will not fix itself.

Not investigated — outside the scope of this deploy. Needs its own unit.

**Health endpoint is port 9090, not 8080.** `GET :9090/bootstrap` → 200 is the readiness signal.
8080 is the protocol listener and answers 400 to an HTTP bootstrap probe — a live node looks broken
if probed there. `cello-directory-allow-http` opens 9090; `cello-directory-allow-protocol` opens
8080/4000.

**Two triggers do NOT fire, and images arrive by hand.** `cello-directory-image` has not auto-built
since 2026-07-28 despite a healthy GitHub connection and matching `includedFiles`; every `dir-*` tag
since then, including this one, came from `gcloud builds submit`. This is part of why
`DOD-NODE-DIR-GCP-1` is 🟡 rather than ✅. Partly resolved 2026-08-05 — see below.

**~~`gcloud builds triggers run` is denied for a human account; `builds submit` is not.~~ The trigger
lives in `us-east1` and manual regional builds have never been used here, so no principal has
`cloudbuild.builds.create` there. `builds submit` goes to the global endpoint and works.**
**FALSIFIED 2026-08-05.** A regional `builds submit` in `us-east1` by `andre@` succeeds (build
`f29c4162`), and the audit log for the denied `RunBuildTrigger` shows `andre@`'s
`cloudbuild.builds.create` check on `projects/cello-infra` returning `granted: true`. The account
was never the problem.

**2026-08-05 — the silent half of M12-P11, found and fixed.** `cello-cloud-build@` held only
`artifactregistry.writer` + `logging.logWriter`. A trigger that names a user-specified service
account creates its builds AS that account, so every push-triggered build died at creation and left
**no build record at all** — invisible from `gcloud builds list`, which is why "merged to main"
silently stopped meaning "image built" for six days. `roles/cloudbuild.builds.builder` is now
declared in `infra/terraform/iam.tf` (applied; verified by build `87d84a1f`, a regional build that
runs as that SA and previously could not be created).

**Still open:** a push to `main` touching `infra/cloudbuild/relay.yaml` at 04:48Z produced no build
and no denied-attempt audit entry, so the event never reached Cloud Build. Both triggers were
recreated via Terraform (`-replace`) with no change; `RunBuildTrigger` still returns
`PERMISSION_DENIED` on `projects/000000de8652d04e` (the zero-padded hex of project number
955736313934) even though the same identity can create the same build directly, and `actAs` on the
SA tests granted. Google-side; not an IAM gap we can see.

**The CI build path that works, and does not hand-roll a local tree:**
```
gcloud builds submit \
  "projects/cello-infra/locations/us-east1/connections/cello-github/repositories/CELLO" \
  --revision=<SHA> --region=us-east1 --config=infra/cloudbuild/relay.yaml \
  --service-account=projects/cello-infra/serviceAccounts/cello-cloud-build@cello-infra.iam.gserviceaccount.com \
  --substitutions=_TAG=<SHA>
```
Cloud Build fetches the source from GitHub at that revision through the connection, so the tag names
a commit whose contents were actually built — unlike `builds submit .`, which uploads whatever is on
the local disk and has already cost this milestone a demoted claim.

### Superseded — both services on `reviewfix-de1ed949` (2026-07-30)

Note this section was already stale before the 2026-08-03 roll: it claimed the directory ran
`reviewfix-de1ed949` while `terraform.tfvars` pinned `dir-69825467`. tfvars was correct.

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

## Ops dashboard (DOD-GCP-OPS-1) — LIVE 2026-07-31 (hostname not yet pointed)

The operator surface. It owns `DOD-INV-WAVE-GATE`, `DOD-WAVE-ASSEMBLY-1` and six `DOD-OPS-*` lines,
and it is the **only** caller of the waitlist's internal surface — without it the waitlist runs and
nobody can be admitted from it.

| Resource | Value |
|---|---|
| Cloud Run service | `cello-ops-dashboard`, us-east1, image `ops-e6d0f32`, **min=0, MAX=1** |
| Run URL | https://cello-ops-dashboard-jk4mcnqbeq-ue.a.run.app — debugging only (`DOD-INV-DOMAIN`) |
| Hostname | `operations.cello.mygentic.ai` — **NOT yet served.** No load balancer or certificate for it exists; that is the remaining piece of this line |
| Repo | `Andre-Mygentic/cello-ops-dashboard`, built by `cloudbuild.yaml` in that repo |
| Database | the shared `cello_portal` Cloud SQL. Applies its own four `ops_*` migrations at container start; **ledger now 41 rows = 11 portal + 26 waitlist + 4 ops**, three prefixes, no collisions |
| Service account | `cello-ops-dashboard` — its own, not the portal's or the waitlist's |
| Secrets | `cello-ops-allowed-emails` (**read at RUNTIME, not injected** — the 60s cache is what makes removing an operator take a minute rather than a deploy), plus `cello-portal-database-url`, `cello-waitlist-internal-token`, `cello-ops-agent-ses-credentials` |
| Verified live | `/sign-in` 200 · `/` without a session 307s to `/sign-in` rather than leaking · **no-enumeration holds**: an allowed and an unknown address both return byte-identical `202 {"status":"sent_if_allowed"}` |

**MAX 1 instance is a correctness constraint, not a cost one.** The sign-in send is fire-and-forget
(which is what makes the no-enumeration timing hold) and migrations run at container start, so a
second instance starting under load would race the first through `scripts/migrate.mjs`.

**`PGSSLMODE=disable` is required here and not on the waitlist**, which is worth knowing before
debugging it again. `db.ts` and `migrate.mjs` default to `ssl: { rejectUnauthorized: true }` because
on AWS they dialled an RDS endpoint. Cloud Run reaches Cloud SQL over a unix socket and the connector
holds the encrypted hop, so there is no network leg to weaken. libpq silently ignores `sslmode` on a
unix socket — which is why the Python waitlist needed nothing — but node-postgres attempts an SSL
negotiation the socket cannot answer. The container exited 1 with
`[migrate] FAILED: The server does not support SSL connections` while Cloud Run reported only
"failed to start and listen on PORT"; the useful half was in the container log, not the deploy error.

---

## Waitlist (DOD-GCP-RUNTIME-1 / M12 cutover item C) — LIVE 2026-07-31

The M11 waitlist off AWS. **One Cloud Run service replaces 13 Lambda functions, an API Gateway,
4 EventBridge rules, an SNS subscription and a NAT gateway.** The 13 handlers are UNMODIFIED; the
entry layer (`infra/lambda/_router.py`, `_app.py`) is what API Gateway used to be.

| Resource | Value |
|---|---|
| Cloud Run service | `cello-waitlist`, us-east1, image `waitlist-963fb277`, min=1 |
| Run URL | https://cello-waitlist-jk4mcnqbeq-ue.a.run.app — **debugging only.** `DOD-INV-DOMAIN` forbids a `run.app` hostname in code, copy or configuration, and `verify-m11-invariants.sh` now denies it |
| Load balancer | global external ALB, IP **`35.227.231.107`**, serverless NEG `cello-waitlist-neg`, managed cert `cello-waitlist-cert`; :80 redirects to :443 |
| Hostname | **api.cello.mygentic.ai → 35.227.231.107, POINTED 2026-07-31, INSYNC** (was an alias to `d-jgbfq5nmal.execute-api.us-east-1.amazonaws.com`; plain A, TTL 60 for fast rollback). Flipped because the AWS surface was ALREADY dead — hibernated database, `GET /gallery/receipts` → 503 — so this repaired a broken hostname rather than moving live traffic. Rollback batch in M12-CUTOVER-CHECKLIST §D. Managed cert validates only after DNS resolves here, so HTTPS is down until it leaves PROVISIONING |
| Database | the PORTAL Cloud SQL `cello-portal` / `cello_portal`, over the `/cloudsql` unix socket. `DOD-INV-SINGLE-DB`: one database, additive schema, no new instance. Ledger 37 rows (11 portal + 26 waitlist), 19 waitlist tables + the `waitlist_queue` view |
| Service accounts | `cello-waitlist` (cloudsql.client) and `cello-waitlist-scheduler` (logging only). NOT the portal's — `secretAccessor` is per-secret, so a shared identity would hand each one the other's key material |
| Secrets | `cello-waitlist-internal-token` (generated); reuses `cello-portal-database-url` and `cello-ops-agent-ses-credentials` |
| Schedules | 4 Cloud Scheduler jobs, all ENABLED, `Etc/UTC` pinned: `email-drain` `* * * * *`, `feedback-sweep` `17 6 * * *`, `re-engage-sweep` `23 6 * * *`, `outreach-sweep` `47 6 * * *` |
| SES | stays on AWS — Google has no email-sending service. Same static credentials the ops-agent already uses |
| Verified live | `/health` 200 · `/gallery/receipts` 200 `{"receipts": [], "total": 0}` against the real database · `/internal/*` 401 without a token · the drain answers `{"sent": 0, "skipped": 0, "failed": 0, "retired": 0}` and the sweep `{"re_engage_enqueued": 0}` · all 4 schedulers reporting OK |
| Data | **ZERO rows in every table** outside the migration ledger, re-checked after deploy and after live drains. No migration contains an INSERT, so re-applying cannot seed. |

**The internal surface is a security boundary.** Eight handlers are reachable only via
`/internal/<name>` behind a shared token: five had NO trigger on AWS (IAM-gated invoke only —
`waves` opens a wave and mints admission tokens, `gate` burns one, `firstwin` mints three premium
invite codes) and three were EventBridge-driven. Cloud Scheduler presents BOTH OIDC and the token.
An unset token answers 503 rather than admitting.

**Two things that cost a retry each, worth knowing before the next apply:**
- **IAM propagation lags the apply.** The first apply failed `Permission denied on secret ... for
  Revision service account cello-waitlist@`, with all three bindings already created. Re-running
  succeeds. Same note as the portal's.
- **A newly-enabled API is not usable in the same apply.** `cloudscheduler.googleapis.com` was added
  to `project.tf` and the four jobs in that same run still failed 403 "API has not been used in
  project ... before or it is disabled". Enabled + re-apply works.

**Cloud Build: use the DEFAULT machine type.** `infra/cloudbuild/waitlist.yaml` originally copied
`E2_HIGHCPU_8` from `ops-agent.yaml`; a submission sat QUEUED over fifteen minutes with nothing else
running. On the default pool the same build takes 38 seconds.

---

## 🟢 SCHEMA V58→V62 DEPLOYED — all three directories rolled (2026-08-08)

**Image `dir-51eda2fb`** (was `dir-d35d0a1d`). Rolled node-by-node, `europe-west1` →
`us-central1` → `us-east1`, each targeted at its own template + MIG, each verified on
`GET :9090/health` before the next was touched. No capacity trouble — `gcp-usc1` is still on the
`e2-medium` from the 2026-08-06 incident, which is the type that had capacity. Return to schema 62:
euw1 105s, usc1 60s, use1 90s.

**`/health` reports `schemaVersion`**, which is what makes this roll verifiable rather than timed —
Flyway runs at container start, so a migration failure shows up as a node that never returns.

| Migration | What it fixes |
|---|---|
| V58 | `seal_certificate_fields` — a client can FETCH a certificate it was never pushed (other branch) |
| V59 | `agent_account_links` — the kill switch stops refusing an operator's own agents |
| V60 | `account_email_stubs` — sign-in no longer depends on which node answers first |
| V61 | natural keys on the seal's children — track record stops differing per node |
| V62 | `signal_revocations` — revocation propagates instead of landing as a fake ACTIVE record |

**Verified after the roll, and the contrast is the point.** One query, both forms side by side:

| | use1 | usc1 |
|---|---|---|
| `agent_account_links` (replicated) | 13 | 13 |
| `account_email_stubs` (replicated) | 2 | 2 |
| `conversation_participation` (now replicated) | 110 | 110 |
| `agent_profiles.account_id` (NOT replicated) | 0 | 7 |

The replicated forms converged; the mutable column is still split, exactly as it has been all along.
Andre's three agents are linked on all three nodes — they were 0 / 2 / 1 before.

**The old columns are deliberately NOT dropped.** Code this work did not touch still reads them, and
dropping a column in the same step that introduces its replacement leaves no way back. Retiring them
is its own migration, later.

---

## Portal (DOD-MOVE-PORTAL-1) — LIVE 2026-07-31

| Resource | Value |
|---|---|
| Cloud Run service | `cello-portal`, us-east1, image **`portal-9aeaf30`** (rev `cello-portal-00010-brg`; was `portal-317ffba` → `bcb959c` → `89fb371` → `abf1cb4` → `6807d4e` → `c713746`) |
| Hostname | **https://portal.cello.mygentic.ai** — the same name it had on AWS |
| Load balancer | global external ALB, IP `34.111.250.93`, serverless NEG `cello-portal-neg`, managed cert `cello-portal-cert`; :80 redirects to :443 |
| DNS | Route 53 zone `Z02692523DOH7NW521CL8`, A record → `34.111.250.93` (was `198.51.100.1`, the hibernate placeholder) |
| Run URL | https://cello-portal-jk4mcnqbeq-ue.a.run.app (still serves; the LB fronts it) |
| Cloud SQL | `cello-portal`, us-east1, POSTGRES_17, `db-g1-small`, deletion_protection ON |
| Signing key | Cloud KMS `cello-portal/portal-submission` v1, `EC_SIGN_ED25519`, us-east1. Pubkey `6f0203b8…80e5`, enrolled `submitter` in all 3 node DBs |
| Directory path | `DIRECTORY_API_URLS` → the three PINNED internal IPs on **8081**, over Direct VPC egress; one key per node in `cello-portal-directory-api-keys`, positionally paired |
| Secrets | `cello-portal-database-url`, `cello-portal-kms-master-key` (both `prevent_destroy`), `cello-portal-directory-api-keys`, **`cello-ops-agent-ses-credentials` (added 2026-08-07 — see below)**, and copied from AWS: `-github-client-id`, `-github-client-secret`, `-intake-key-0`, `-ingress-trigger-secret`, `-submission-seed` |
| Verified | 307 → `/sign-in` over https on the real hostname; **portal→directory proven through the app** — POST `/api/internal/ingress/drain` returns `ok:true` with `nodeErrors: []` (refuses 401 without the trigger secret); issuer enrolled on usc1/euw1/use1 |

### 2026-08-07 — sign-in was impossible since the cutover, in three independent ways

Reported as "the magic link email never arrives". All three had to be fixed to sign in once, and
each was invisible on its own because the sign-in response is byte-identical for a known and an
unknown email (DOD-INV-1, no enumeration). 3 requests, 0 tokens, 0 mail, no error anywhere.

1. **The account lookup stopped at the first node.** `email_stub_hash` is excluded from
   anti-entropy, so it exists only on the node that ran the registration — here `gcp-usc1`, while
   `DIRECTORY_API_URLS` asks `gcp-euw1` first. A 404 does not throw, so the failover client treated
   it as a successful "no such account" and never asked the other two. Fixed in cello-portal
   `89fb371`: the lookup now advances past a null and only a null from every REACHABLE node is a
   negative. Zero answers still throws.
2. **The agent list had the same shape.** The `account_id` link on `agent_profiles` does not
   replicate either — usc1 had 2 of the operator's 3 agents linked, euw1 1, use1 0 — so one node's
   list is a fragment that looks whole. Now collected from every node and unioned on
   `kLocalPubkey`. Same commit.
3. **The portal had no AWS credentials for SES.** `email.ts` built its SES client with none by
   design: on ECS the task role supplied them at call time. Cloud Run has no ambient AWS identity,
   so every send died in the SDK credential chain and was logged `delivery_failed` — never
   surfacing, because the send is fire-and-forget so as not to widen the enumeration timing
   channel. Fixed in `abf1cb4` + the Terraform below: `SES_CREDENTIALS` from
   `cello-ops-agent-ses-credentials`, the same blob the ops-agent, waitlist and ops-dashboard take.
   Absent still falls back to the ambient chain; malformed now throws rather than failing silently
   at send time.

**Verified live, not inferred:** `accountResolved: True`, a row in `magic_link_tokens` where there
had never been one, and `portal.auth.magic_link.email_sent` carrying a real SES message id.

**Terraform:** `google_secret_manager_secret_iam_member.portal_ses` (new) + the `SES_CREDENTIALS`
env block in `portal.tf`. Applied with `-target` on the Cloud Run service and that member.

**The hand-added `105.234.180.85/32` authorized network on `cello-portal` Cloud SQL is GONE.** A
`-target` on the portal Cloud Run service pulls the SQL instance in as a dependency, so the apply
removed it — there is no way to exclude it from a targeted plan, and the note elsewhere in this file
that a `-target` avoids that drift is wrong. Removed deliberately, with Andre's decision: the entry
was stale (it allowed `…85`; the operator's address was `…55`), so it granted nothing and would have
handed a path to the portal database to whoever the ISP gave `…85` to next. Direct psql from a
laptop now goes through the Cloud SQL Auth Proxy, which needs no allowlist entry —
`infra/scripts/gcp-portal-db-query.sh`.

### 2026-08-07 (cont.) — trust signals produced NOTHING, for two more reasons

Reported as "no trust signal works — passkey, authenticator, history refresh, GitHub, none of
them". Correctly diagnosed by Andre as something shared rather than per-signal. `minted_signals`
held ZERO rows.

4. **`authorized_issuers` was EMPTY on all three nodes** — an OPS fault, no code involved. The
   portal's KMS submission key (`6f0203b8…80e5`, verified against KMS itself, not against this
   file) was trusted nowhere, so every submission came back `422 unknown_issuer`. The table is
   created empty by V46 and seeded by an operator; `cello_service` holds SELECT only, deliberately,
   so a directory process cannot authorize itself. This file previously claimed the key was
   "enrolled `submitter` in all 3 node DBs" — it was not, and no migration has run since
   2026-07-31, so nothing wiped it. Enrolled on all three with `--admin`, role `submitter`.
5. **Track-record refresh used the single-key gate the client outgrew in M12.** It read the
   SINGULAR `DIRECTORY_API_KEY`, which is never set on a per-node deployment, so it bailed on every
   run with `no_directory_config` and returned an empty result — a refresh button that does
   nothing. Its tests inject `baseUrl`/`apiKey`, so the configured path was the one path never
   exercised. Fixed in `6807d4e` (`directoryApiPairs()`), which also tries each node, because seal
   history is not replicated either.
6. **Account facts were read from one node**, so `email` was skipped while `phone` minted — the
   email hash lives only on `gcp-usc1`. Fixed in `c713746`: facts are read from every node and
   merged, a fact being verified if ANY node has it with its stub.

**Verified live:** a remint returns `webauthn: {credentials: 1, handedOffTo: 3}`, and
`minted_signals` now holds all four types — email, phone, webauthn, and one track_record per agent
— against 5 rows in `signal_records` on the directory side.

7. **GitHub signals were notarized and delivered but never RECORDED** (`9aeaf30`). The OAuth
   callback submitted both, delivered them to every agent, and skipped `recordMintedSignal` — the
   only mint path that does. The page reads `minted_signals`, so signals sitting on all three of
   the operator's agents did not appear in the portal; and the supersedes map reads the same table,
   so every re-connect minted a NEW pair rather than superseding, accumulating duplicates in the
   ledger. Caught by counting: 17 notarized at the directory against 15 recorded. The loop was
   inline in the route handler, which is why nothing tested it — now extracted to
   `submitAndDeliverGitHubSignals`, teeth-checked by deleting the record call and confirming two
   tests fail.

**The through-line for all six.** Five of the six are ONE defect wearing different clothes: the
portal asked a single directory and treated its answer as the consortium's. That is safe with one
node and wrong with three, and it is invisible every time, because the thing a node returns for
"I don't have it" is indistinguishable from "it does not exist". Anything else that reads
non-replicated per-node state through a single URL is the next instance — `activeAmong` still
routes through `#tryEach` and is the known remaining one.

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


---

## M12-P11 — push events do not reach Cloud Build (OPEN, narrowed 2026-08-05)

Everything on the GOOGLE side now checks out, and a controlled probe still produced nothing:

| Check | Result |
|---|---|
| Connection `cello-github` | `installationState: COMPLETE`, repo `CELLO` linked |
| Triggers `cello-relay-image` / `cello-directory-image` | both exist (us-east1), enabled, correct `includedFiles` + config path |
| Build SA `cello-cloud-build@` | has `roles/cloudbuild.builds.builder` (restored 2026-08-05, declared in `terraform/iam.tf`) |
| `terraform plan` (connection + both triggers) | **No changes** — zero drift; App installation id still 149532787 |
| Probe push `8f814456` (touches `infra/cloudbuild/relay.yaml`, IN the relay trigger's `includedFiles`) | landed on `origin/main` |
| Resulting build | **NONE.** No build record, no denied-attempt audit entry |

Manual `gcloud builds submit <repo-resource> --revision=<SHA>` works and is the current path.
Distinguishing test for any future claim that this is fixed: a trigger-fired build has
`substitutions.TRIGGER_NAME` set; a manual submit leaves it EMPTY. Every build in the project as of
2026-08-05 has it empty, which is why "a build succeeded" was never evidence the trigger fired.

**Remaining suspect is GitHub-side and needs a browser** (the CLI token gets 403 on
`/user/installations` by design): github.com/organizations/Mygentic-AI/settings/installations →
Google Cloud Build → confirm `CELLO` is in its repository access list. A connection can report
COMPLETE while the App no longer watches that repo — the connection is authorized, but no event is
ever generated to deliver, which fits the total absence of denied-attempt entries.


### M12-P11 — PROBE 2 (2026-08-06): a SECOND OAuth did not fix it either

| Probe | Push | Result |
|---|---|---|
| 1 (2026-08-05) | `8f814456` — touches `infra/cloudbuild/relay.yaml`, in the relay trigger's `includedFiles` | no build, no denied-attempt audit entry |
| 2 (2026-08-06) | `32d4dad8` — same file, after the operator re-completed the OAuth again | **no build**, same silence |

Latest build in the project remains `8eaddd07` (2026-08-05 04:51), a MANUAL `builds submit`. Every
build in this project has `substitutions.TRIGGER_NAME` **empty**, which is the distinguishing test:
a trigger-fired build sets it. No trigger has fired here since 2026-07-28.

**Conclusion — stop re-doing the gcloud OAuth. It cannot fix this.** The Google-side OAuth
re-authorizes the CONNECTION (hence the persistent `installationState: COMPLETE`); it does not change
which repositories the **Google Cloud Build GitHub App** is permitted to see. If `CELLO` is not in
that App's repository-access list, GitHub never generates the push event, Cloud Build never receives
one, and there is nothing to deny — which is exactly the observed shape, including the absence of
denied-attempt audit entries.

**The one remaining check, browser-only** (the CLI gets 403 on `/user/installations` by design):
`github.com/organizations/Mygentic-AI/settings/installations` → Google Cloud Build → Configure →
Repository access. If it is "Only select repositories" and `CELLO` is absent, adding it IS the fix.
If `CELLO` is present, the App is healthy and the next lever is deleting and recreating the
`cello-github` connection (which changes `app_installation_id` in `terraform/cloudbuild.tf` — plan
will show loud drift, which is intended).

Workaround while open, unchanged and working:
```
gcloud builds submit "projects/cello-infra/locations/us-east1/connections/cello-github/repositories/CELLO" \
  --revision=<SHA> --region=us-east1 --config=infra/cloudbuild/relay.yaml \
  --service-account=projects/cello-infra/serviceAccounts/cello-cloud-build@cello-infra.iam.gserviceaccount.com \
  --substitutions=_TAG=<SHA>
```


### M12-P11 — PROBE 3 (2026-08-06): repository link RECREATED, still no events

**Infra change made:** `terraform apply -replace=google_cloudbuildv2_repository.cello` (targeted).
The link was destroyed and recreated (1 added, 1 destroyed); both triggers updated IN PLACE, not
recreated. `app_installation_id` untouched at 149532787. Rationale: the resource carried no
`webhookId` and had not been touched since `createTime` 2026-07-28.

**Result: no build.** Probe `c42b9583` touched `infra/cloudbuild/relay.yaml` (in the relay trigger's
`includedFiles`) on `main`. Nothing. Latest build in the project is still the manual `8eaddd07`
from 2026-08-05.

**What is now RULED OUT** — do not re-test these:
| Suspect | Status |
|---|---|
| Build SA missing `cloudbuild.builds.builder` | fixed 2026-08-05, declared in `terraform/iam.tf` |
| Connection not authorized | `installationState: COMPLETE`; OAuth re-completed TWICE (08-05, 08-06) |
| GitHub App lacks repo access | **operator confirmed "All repositories"** |
| Terraform drift | `plan` clean, zero drift |
| Trigger misconfigured | points at the right repo resource, `^main$`, correct `includedFiles`/`filename` |
| Repo renamed / archived / wrong default branch | `gh api`: name=CELLO, default_branch=main, archived=false |
| Stale repository link | **recreated 2026-08-06 — did not help** |

**The one remaining lever:** delete and recreate the `cello-github` CONNECTION itself (needs browser
OAuth). That changes `app_installation_id` and the `oauth_token_secret_version` — both are pinned in
`terraform/cloudbuild.tf` and `plan` will show loud drift, which is intended; update them there
afterwards. If that also fails, the fault is inside Google's event-delivery pipeline and the case is
a support ticket, not a config change.

**This is a CI papercut, not a launch blocker.** The manual `builds submit --revision=<SHA>` path
works and relay images are rare. Recommend leaving it unless a relay change is imminent.

---

## Relay roll 2026-08-08 — `relay:0cf04b0c` on both relays (DOD-RELAY-DIRECTORY-RECONNECT-1)

Both relays now carry the fix for the four-hour fleet-wide sealing outage earlier the same day
([[relay-stops-notarizing-fleet-wide]], launch-triage item 14). Before this roll the fix existed only
in source and the running relays still had the old behaviour, so the outage could have recurred at
any time with a manual restart as the only cure.

| | |
|---|---|
| Image | `us-east1-docker.pkg.dev/cello-infra/cello/relay:0cf04b0c8a2334d37ff81eb5c663487241e1b464` |
| Built | `gcloud builds submit <repo-resource> --revision=0cf04b0c…` — build `94969471`, 3m04s, SUCCESS |
| `gcp-relay-use1` | rolled first, instance `cello-gcp-relay-use1-h73m`, up 19:37 UTC |
| `gcp-relay-euw1` | rolled second, instance `cello-gcp-relay-euw1-z5d9`, up 19:41 UTC |
| tfvars | `relay_image_tag` `8b195c90…` → `0cf04b0c…` |

**What shipped in it, all three parts:**
1. **Reconnect** — a stale libp2p handle to the directory is redialled instead of failing the seal
   outright, and the dial errors are logged instead of being discarded by an empty `catch {}`.
2. **A 30s directory probe** — the relay finds out its link is dead before a user does. It runs the
   SAME transport a seal runs, so it repairs the connection on the way.
3. **A health check that reports directory reachability** — `status: "degraded"` plus a `directory`
   block in the body, and `relay.directory.connection.lost` at ERROR.

**`/health` STILL ALWAYS RETURNS 200, and must continue to.** It is what the directories poll for
relay POOL MEMBERSHIP (`defaultPingFn` counts any non-2xx as a failed check), not an alerting
channel. A 503 on "cannot reach a directory" would withdraw relays for a fault that does not stop
them carrying sessions, and since the cause is shared every relay fails at once — turning "cannot
seal" into "cannot start a session", fleet-wide. An earlier version of this fix did return 503 and
was reworked before deploy.

**Verified, not assumed:** both relays registered with all three directories
(`relay.already.registered` at 19:37 and 19:41 UTC), and a real cross-machine session sealed on each
— roots `3b416b7b…` after the first roll and `cd3ae082…` with both on the new build. Port 4000 is
unreachable from outside by design; the health URL the directories use is the internal address.

**Method note:** rolled one relay at a time with `-target`, per §2. An untargeted apply replaces
everything at once.

## Relay roll 2026-08-08 — the seal outage fix (both regions)

**Image `relay:0d9568a52c1be8a2a33eb6fdf3974b1eedbe389f`**, built manually via
`gcloud builds submit --revision=<SHA>` (build `e8d90053`, us-east1, 2M50S) because the trigger
delivery fault above is still open. `relay_image_tag` in `terraform/terraform.tfvars` moved off
`a84659eb…`; applied with `-target` on the relay template + MIG only, per §2c.

Instances replaced: `cello-gcp-relay-use1-hk39` (was `-5sv2`) and `cello-gcp-relay-euw1-qfgs`
(was `-ls9t`). Pinned IPs `34.139.119.165` / `34.77.112.231` unchanged. Both report
`relay.service.started` + `relay.already.registered` + `relay.health.check.passed` from their own
boot logs.

### What this shipped, and why a restart alone was not enough

Sealing stopped fleet-wide for ~2.5 hours. The relay refused every seal with `directory_unavailable`
while all three directories were healthy on schema 62, ports open, peer IDs and IPs matching the
relay's configured `CELLO_DIRECTORY_ENDPOINTS` exactly.

**The relay had been up 3 days and its libp2p handle to the directories had died mid-life.**
`connect()` assigns that handle once at boot and it was trusted for the process's whole life — no
liveness check, no redial. `newStream` then found no open connection and the seal was refused
outright.

Diagnosis came from TIMING, not error text, and that is the durable lesson: the failing path
returned in **under 1ms** (an in-memory `getConnections()` lookup) where the last working seal took
**79ms** — a real round trip. Any future "unreachable" that fails too fast to be a network call is
this shape.

Three defects, each hiding the next — see commit `0d9568a5`:
1. no reconnect on a stale handle (the outage);
2. `CelloNode` throws structured plain objects, not `Error`s, so `err instanceof Error` discarded
   the real `connection_lost` reason and substituted `directory_unavailable`; the dial loop's empty
   `catch {}` erased the remaining evidence;
3. `processSeal` decoded with the `mapsAsObjects:false` encoder instance, yielding a JS `Map` where
   `resp["type"]` is always undefined.

**Restarting a relay masks (1) and tells you nothing.** If seals fail again, check the reason string
first — it now names the cause instead of `directory_unavailable`.

### Known-open, found while investigating (NOT fixed here)

| Defect | Effect |
|---|---|
| `directory_nodes.last_heartbeat_at` does not replicate | every node sees peers as NULL → `availableNodes:1` vs `requiredThreshold:2`; federation checkpoints have never succeeded. Tier A carries identity, not liveness. |
| `signal_records` anti-entropy has never applied | `null value in column "scanner_version"` — NOT NULL and absent from the replicated set; ~1 failure per 30ms, continuously, on every node. Pre-dates this work. |
| ~~Directory SA cannot WRITE its relay manifest~~ | **FIXED 2026-08-08** — `relay_manifest_writer` (`roles/storage.objectAdmin`) added in `terraform/storage.tf` and applied. The 403s stopped immediately. objectAdmin not objectCreator: the manifest is one object rewritten in place, and a GCS overwrite needs `objects.delete` too — objectCreator would have worked once at bootstrap and then failed silently forever. |

### Verified 2026-08-08T13:58Z — sealing works, on relay `615fa156`

A live bilateral seal, both participants `attestation_mode: live`, sealed root
`922eb04f8bf3d17cd1744dce29373ef632661da7640da57278146c9b769e3733`. The fleet trace is clean and
first-attempt:

```
relay.seal.broker.resolved
seal.certificate.legibility.built
seal.certificate.delivered
notarization.recorded
conversation.seal.recorded
```

No `broker.unreachable`, no `directory_unavailable`, no `relay.seal.rejected`. Compare the outage
signature, which was those three lines and nothing else.

Both relays run `relay:615fa156269ecf922f2170dfa40b12da4cee7ed8` (the reconnect + real-reason +
decode fixes, plus `DOD-RELAY-DIRECTORY-RECONNECT-1`, the periodic reachability probe).

### ⚠️ The directories have the SAME stale-state bug the relay had — OPEN

Replacing the relays left every directory refusing sessions with `relay_unavailable` while all three
were healthy and both relays were listening on :4001. The directory's relay pool is in-memory, and:

- it is filled from the **manifest**, and refreshed **only by a manifest whose version strictly
  increases** (`applyManifest` rejects `version <= currentVersion` → `relay.manifest.version.stale`);
- a relay that fails health checks is dropped from the pool;
- so once the pool empties, **nothing refills it** — the manifest object is still dated 2026-07-29
  and the publisher writes only on change. `relay.health.check.passed` simply stops appearing for
  that node, which is a silence, not an error.

**Restarting the directory container is the only known recovery** (it reloads the manifest at boot).
That was needed on all three today, and use1 needed it twice. This will recur on every relay roll.

The real fix is a pool that recovers from registration as well as from a monotonic manifest — the
`relay_registrations` rows are already correct in the database while the in-memory pool is empty.
Same shape as the relay defect fixed in `0d9568a5`: long-lived in-memory state derived from an
external thing that changed underneath it, with no path back.

**Roll order that avoids this:** roll relays, then restart each directory one at a time (quorum is
2 of 3), then confirm `relay.health.check.passed` appears for all three node ids before declaring
the roll done.

### Relay-pool fix deployed and verified — 2026-08-08T15:33Z

Directory `8e6b0f79`, relay `8b195c90`. All five instances replaced; directories rolled one at a
time (quorum 2 of 3 held throughout).

**Before** — the pool could only shrink, and two of three nodes read a file nobody had written since
the GCP cutover:

```
gcp-use1   v6  2026-08-08T12:16Z   1 relay
gcp-usc1   v5  2026-07-29T13:51Z   1 relay     <- frozen 10 days
gcp-euw1   v5  2026-07-29T13:51Z   1 relay     <- frozen 10 days
```

**After** — every node current, BOTH relays present, correct regions:

```
gcp-use1   v11  relays=[8492fffe:us-east1, e3cd54a4:europe-west1]
gcp-usc1   v10  relays=[8492fffe:us-east1, e3cd54a4:europe-west1]
gcp-euw1   v10  relays=[8492fffe:us-east1, e3cd54a4:europe-west1]
```

`gcp-relay-euw1` is in the pool for the first time — it had never carried a session.

Live trace of the whole path, one relay restart: `relay.registration.peer.ok` from the relay →
`relay.already.registered` on all three directories → `relay.manifest.updated region=europe-west1`
on all three → `relay.manifest.refreshed` as each picks its own new version up.

**Region was wrong on every relay** until this roll: the value came from `AWS_REGION`, which does
not exist on GCP, so both relays registered as `us-east-1` and region-aware selection had nothing
real to select on. Now `CELLO_RELAY_REGION`, passed from the Terraform template. `AWS_REGION` stays
only as a fallback for an AWS-hosted relay and must never be set as a custom variable.

**The roll order still matters and is now the documented one:** roll relays → roll directories one
at a time → **restart the relays again** so they re-announce to directories running the new code →
confirm both relays appear in all three manifests. A relay only announces at boot, so a directory
rolled *after* a relay registered will not have heard it.

### Relay health-check URL is INTERNAL — applied 2026-08-08

`CELLO_RELAY_HEALTH_CHECK_URL` was built from the relay's **public** address. Port 4000 is
firewalled to the VPC and Google's probers, so no directory could ever reach it: every health check
failed, the pool emptied, and sessions were refused with `relay_unavailable` while both relays were
healthy and listening on :4001. Verified from a directory VM — internal 200, public unreachable.

Now built from `internal_addr`, a new template variable fed by
`google_compute_address.relay_internal`. **Live on both templates:**

```
cello-gcp-relay-use1-20260808193630…   http://10.10.0.28:4000/health
cello-gcp-relay-euw1-20260808194022…   http://10.10.2.25:4000/health
```

**The public address is not wrong, it is for a different job.** It stays on
`CELLO_RELAY_PUBLIC_MULTIADDR`, which is what *agents* dial. Health is an internal concern between
directory and relay; client reachability is not the same property and must not share a value.
