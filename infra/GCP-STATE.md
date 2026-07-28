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

| Resource | Value | Created | How |
|---|---|---|---|
| Project `cello-infra` | number 955736313934 | 2026-07-28 | gcloud (bootstrap — import into Terraform at DOD-IAC-BASE-1) |
| Enabled APIs | compute, artifactregistry, cloudbuild, sqladmin, secretmanager, storage, logging, monitoring, cloudresourcemanager, iam, serviceusage | 2026-07-28 | gcloud |
| VPC `cello-vpc` | custom-mode, **no subnets yet** (per-region with node IaC). Default network + its 4 firewall rules DELETED. | 2026-07-28 | gcloud (bootstrap) |

**Nothing else exists in this project.** No VMs, no Cloud SQL, no buckets, no service accounts
beyond the compute default (unused by policy), no firewall rules.

## Quotas (verified 2026-07-28 — ample, no requests needed)

us-east1 / us-central1 / europe-west1 / europe-west3: 200 CPUs (24 E2), 8 static IPs, 4 TB disk.
asia-northeast1: 100 CPUs, otherwise same.

## Credits

~$23k, valid to Nov 2027 (Andre, 2026-07-28). GCP cost is never a design constraint.
