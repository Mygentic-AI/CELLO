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
| Enabled APIs | 11 (list in `terraform/project.tf`) | 2026-07-28 | Terraform (`google_project_service`) |
| VPC `cello-vpc` | custom-mode. Default network + its 4 firewall rules DELETED. Subnets: `cello-us-east1` 10.10.0.0/24 | 2026-07-28 | Terraform (imported) |
| Bucket `cello-infra-tfstate` | us-east1, versioned, UBLA | 2026-07-28 | gcloud bootstrap, imported into TF |
| Service accounts | `cello-directory-node`, `cello-relay-node`, `cello-ops-agent`, `cello-portal`, `cello-cloud-build` — minimal grants per `terraform/iam.tf`. **Secret access is per-secret only, never project-level** (unit-review finding); CI reads only the staging bucket, never tfstate | 2026-07-28 | Terraform |
| Cloud Build P4SA grants | `cloudbuild.serviceAgent` + `secretmanager.admin` (org policy strips ALL automatic service-agent grants — both had to be granted explicitly for the GitHub connection) | 2026-07-28 | Terraform |
| Artifact Registry `cello` | `us-east1-docker.pkg.dev/cello-infra/cello` — docker; images pushed by Cloud Build ONLY. Contains `directory:manual-dedc55ac` and `relay:manual-50e06e3d` (+latest tags) — both built by Cloud Build | 2026-07-28 | Terraform |
| Bucket `cello-infra_cloudbuild` | Cloud Build staging (auto-created by first submit) | 2026-07-28 | service-created |
| Cloud Build connection `cello-github` | us-east1, **COMPLETE** (OAuth by Andre 2026-07-28; GitHub App installation 149532787 on Mygentic-AI, repo CELLO only; token secret P4SA-managed) | 2026-07-28 | gcloud bootstrap, imported into TF |
| Cloud Build repo link `CELLO` | → https://github.com/Mygentic-AI/CELLO.git | 2026-07-28 | Terraform |
| Triggers `cello-directory-image` / `cello-relay-image` | branch `^main$`, path-filtered per package (+ shared root files), run as `cello-cloud-build` SA | 2026-07-28 | Terraform |

**Nothing else exists in this project.** No VMs, no Cloud SQL, no firewall rules; compute
default SA present but attached to nothing and granted nothing.

## Quotas (verified 2026-07-28 — ample, no requests needed)

us-east1 / us-central1 / europe-west1 / europe-west3: 200 CPUs (24 E2), 8 static IPs, 4 TB disk.
asia-northeast1: 100 CPUs, otherwise same.

## Credits

~$23k, valid to Nov 2027 (Andre, 2026-07-28). GCP cost is never a design constraint.
