# Infrastructure Code — Agent Instructions

These instructions are mandatory for any agent working on files under `infra/`.

---

# ⚠️ READ THIS FIRST — CELLO RUNS ON GCP

**The protocol — directory nodes, relay, ops-agent, portal, waitlist — runs on Google Cloud.**
M12 cut over on 2026-07-31, and on 2026-08-06 the AWS protocol stack was **deleted**, not
hibernated.

**AWS is no longer the main cloud.** A handful of services remain there (§7) and `infra/STATE.md`
is retained to describe them — but it opens with its own SUPERSEDED banner and must not be read as
current for anything protocol-related.

**Authoritative documents, in this order:**

| Read | For |
|---|---|
| [`infra/GCP-STATE.md`](GCP-STATE.md) | **The authoritative record.** What exists, what is deployed, standing deviations, playbooks. |
| [`docs/planning/aws-to-gcp-migration.md`](../docs/planning/aws-to-gcp-migration.md) | What runs where across BOTH clouds, and what breaks if you stop what. |
| `infra/STATE.md` | AWS only, and only for the survivors in §7. Superseded for everything else. |

**Update `GCP-STATE.md` IMMEDIATELY after every GCP change — never batched.** A session that
changes GCP without updating it is incomplete. Same rule that `STATE.md` used to carry.

---

# 🚨 STALE ARTIFACTS — present in the tree, NOT current

These files still exist and look authoritative. They target infrastructure that **no longer
exists**. Do not run them, and do not infer the deployment model from them:

| Path | Status |
|---|---|
| `infra/deploy.sh` | **STALE for the protocol.** CloudFormation-based. The stacks it deploys (`cello-ecs-directory-dev`, `cello-ecs-relay-dev`, `cello-rds-dev`, `cello-cicd-dev`, …) were deleted 2026-08-06. |
| `infra/cloudformation/` | **STALE for the protocol.** Same reason. Some templates still describe surviving AWS services (§7) — check `STATE.md` before assuming either way. |
| `infra/buildspecs/` | **DEAD.** CodeBuild specs; all five CodePipelines were deleted with `cello-cicd-dev`. |
| `infra/deploy-lambdas.sh`, `infra/26-*.sh`, `infra/27-*.sh`, `infra/register-github-webhook.sh` | **DEAD for the protocol** — CodePipeline/webhook plumbing that no longer has a pipeline. |
| `infra/audit-state.sh` | AWS-oriented; its ECS/SSM sections check nothing that still exists. |

**If you find yourself reading a CloudFormation template or an `aws ecs` command to answer a
question about the directory or the relay, stop — you are in the wrong cloud.** That mistake has
been made repeatedly, including by agents who had read this file when it still described AWS as
current.

---

# 1. The GCP deployment model

**IaC is Terraform**, in `infra/terraform/`, state in `gs://cello-infra-tfstate` (versioned, UBLA,
public-access-prevented; the CI service account is deliberately scoped away from it).

**Project `cello-infra`** (number `955736313934`). There is a **hard 5-project billing cap** — see
the ledger at the top of `GCP-STATE.md` before creating anything that needs a new project.

**Terraform auth expires hourly.** Application Default Credentials hit `invalid_rapt`. Every run
needs a fresh token:
```bash
export GOOGLE_OAUTH_ACCESS_TOKEN=$(gcloud auth print-access-token)
```
Re-export before each command, not once per session.

**`terraform plan` clean does NOT mean IAM is clean.** IAM uses additive
`google_project_iam_member`, so out-of-band grants are invisible to plan. Audit with
`gcloud projects get-iam-policy cello-infra` at tier boundaries.

## Directory and relay nodes

Each node is a **size-1 Managed Instance Group** on Container-Optimized OS, booted by
**cloud-init** (`terraform/templates/directory-cloud-init.yaml`) — deliberately **not konlet**,
because konlet takes env from instance metadata and metadata is readable by anything with
`compute.instances.get`. Metadata carries secret **resource names** only; the node resolves the
values itself with its attached workload identity.

| Node | Address |
|---|---|
| `gcp-use1` | 34.75.172.108 |
| `gcp-usc1` | 34.136.176.190 |
| `gcp-euw1` | 34.34.166.245 |
| `gcp-relay-use1` | 34.139.119.165 (internal 10.10.0.28) |

**One node = one region = one independent deployment.** The sovereign-node invariant in the repo
CLAUDE.md is infrastructure policy here, not an abstraction.

# 2. Rolling a node — the rules that have already cost outages

- **MIGs NEVER surge.** The instance template pins BOTH single-holder addresses (`network_ip` and
  `nat_ip`), so two instances from one template can never coexist. `max_surge_fixed = 1` was
  considered and **rejected** 2026-08-06: it plans cleanly and breaks the *next* roll.
- **Roll node-by-node, and confirm the node is SERVING before touching the next.**
  `update_policy = PROACTIVE` means one un-targeted `terraform apply` replaces **all three at
  once**. The threshold tolerates exactly one node down.

  > **CORRECTED 2026-08-19 — `GET /bootstrap` 200 is not obtainable and never was.** Port 8080 is
  > the libp2p **WebSocket** listener, so a plain HTTP GET returns
  > **`400 "Only WebSocket connections are supported"`** — from a perfectly healthy node. Treating
  > 200 as the gate means the roll never proceeds; treating 400 as failure means it never proceeds
  > either. The relay is worse: its `/health` on :4000 answers **000 from outside the VPC** by
  > design (see the pool-emptying outage that rule came from), so it cannot be polled from a laptop
  > at all.
  >
  > **Use the signal the fleet already produces, which proves the node is doing its JOB rather than
  > merely listening:**
  > - **Directory** — anti-entropy rounds resume from its zone:
  >   `jsonPayload.event=~"antientropy.round.(started|completed)"`, filtered by
  >   `resource.labels.zone`. Healthy baseline is a handful per zone per 3 minutes.
  > - **Relay** — the DIRECTORIES' own probe of it resumes:
  >   `jsonPayload.event="relay.health.check.passed"` filtered to that relay's `relayId`. Healthy
  >   baseline is ~10 per relay per 3 minutes (every 30s, from each directory). This is a real
  >   cross-node network check and it is already running; nothing new has to be built for it.
- **Use `-target` for a single node or the relay.** A full apply is what turns a one-node roll into
  a consortium outage.
- **A node that will not come up is often capacity, not config.** `ZONE_RESOURCE_POOL_EXHAUSTED`
  took `us-central1` out on 2026-08-06. There is a written playbook in `GCP-STATE.md` — use it
  rather than re-deriving.

# 3. Images and CI — the trigger does not fire

Images are built by **Cloud Build** into Artifact Registry
(`us-east1-docker.pkg.dev/cello-infra/cello`), tagged by **commit SHA**. **No `:latest` exists** and
none should be created — consumers pin SHAs.

> **⚠️ OPEN (M12-P11): pushes to `main` do NOT trigger Cloud Build.** Everything on the Google side
> verifies — connection COMPLETE, triggers enabled, build SA correct, `terraform plan` zero drift —
> and a controlled probe push still produced **no build and no denied-attempt record**. The current
> path is a manual submit:
> ```bash
> gcloud builds submit <repo-resource> --revision=<SHA>
> ```
> **Distinguishing test:** a trigger-fired build has `substitutions.TRIGGER_NAME` set; a manual
> submit leaves it EMPTY. Every build in the project is empty, which is why "a build succeeded" was
> never evidence the trigger fired. Remaining suspect is GitHub-side and needs a browser.

# 4. Database and migrations

**Flyway runs at container start** — the container pulls, resolves secrets, runs Flyway, then boots.
There is no separate migration job and no CloudFormation/SSM version parameter in this model.

**Two roles per database, deliberately.** `postgres` owns the schema and runs Flyway; the node role
is restricted and gets `SELECT` on `flyway_schema_history` so the startup version guard can read the
table it checks.

Adding a migration is: add `V{N}__*.sql` under `packages/directory/db/migrations/`, build an image,
roll the nodes per §2 — **and bump `ops_agent_expected_migration_version` in
`infra/terraform/ops-agent.tf` to `{N}` in the same change.**

> **⚠️ This paragraph used to say the opposite**, and it cost a day. It read: *"The old rule about
> updating `cello-ssm-parameters.yaml` and an ops-agent `EXPECTED_MIGRATION_VERSION` belongs to the
> deleted AWS stack — it does not apply here."* Only the FIRST HALF was true. The SSM parameter is
> gone; the guard it fed **survived the GCP migration** as a Terraform variable of the same meaning,
> and it is still wired to `EXPECTED_MIGRATION_VERSION` in the Cloud Run env.
>
> By 2026-08-09 it was five migrations stale (`62` live, `57` asserted) and had been drifting since
> 2026-07-31. **Nothing had broken, which is the dangerous part**: the assertion runs at STARTUP, so
> a process that predates the drift keeps running; the five-minute node poll only WARNS. The bill
> comes due on the next restart — a deploy included — when the gate finds a mismatch, logs
> `ops_agent.startup.failed` and calls `exit(1)`. At `min = max = 1` that is the registration bot not
> coming back, and it is the only thing that issues a registration capability to a human.
>
> **How to check it in one command**, since the warning is the earliest signal and nobody was reading
> it:
> ```bash
> gcloud logging read 'resource.type="cloud_run_revision"
>   AND resource.labels.service_name="cello-ops-agent"
>   AND jsonPayload.event="ops_agent.nodes.degraded"' \
>   --project cello-infra --limit 1 --freshness=1d \
>   --format="value(jsonPayload.detail)"
> ```
> It prints, e.g., `schema drift: gcp-euw1 at 62, gcp-usc1 at 62, gcp-use1 at 62 (expected 57)`.
> Empty output is the healthy answer.

# 5. Secrets

**Terraform generates the secrets, so their values live in the state object.** That is a deliberate
trade: hand-populated secrets are a manual step, and a copied transport key would give two nodes the
same libp2p peer id. The bucket is locked down accordingly.

**Secret access is granted per-secret, never project-level** (unit-review finding). Keep it that
way.

**Transport keys are unique per region.** Never copy one between nodes — generate with
`openssl rand -hex 32`.

# 6. Two things that are not obvious and present as crash loops

- **COS drops everything at the host firewall.** Container-Optimized OS ships iptables `INPUT` with
  policy `DROP`. **A VPC firewall rule is necessary and NOT sufficient** — the packet reaches the
  wire and the host drops it. Symptoms all share this one cause and none of them name it: MIG health
  probes time out, the autohealer resets on a loop, the SSH host key changes every boot, external
  connections hang. `cello-firewall.service` in cloud-init opens 4000/8080/9090 and re-runs every
  boot because COS rebuilds the rules.
- **Two grants org policy does not give implicitly:** `artifactregistry.reader` on the repository
  (without it the node cannot pull its own image) and `storage.bucketViewer` on the relay-manifest
  bucket — `objectViewer` does not include `storage.buckets.get`, which the storage provider needs to
  tell a missing bucket from a missing object, because GCS 404s both.

Both surfaced as crash loops rather than errors. When a node will not boot, check these before
anything else.

# 7. What still runs on AWS

Retained, and `infra/STATE.md` describes them:

- **Portal RDS** — holds the waitlist tables **and** the original portal accounts. Note there are
  **two** `cello_portal` databases; the GCP one is separate and serves `portal.cello.mygentic.ai`.
- **The waitlist stack** — 13 Lambdas, API Gateway, EventBridge schedules.
- **SES** — **the one live cross-cloud runtime dependency: OTP email for GCP registration.**
  Stopping it breaks sign-up on GCP.
- **Route 53** — all DNS, *including the records that point at GCP*.
- **NAT (us-east-1)** — waitlist email delivery reaches SES over it.
- Lightsail, Secrets Manager, S3, ECR, KMS.

**Deleted 2026-08-06** (do not look for them): AWS directory, relay, `cello-rds-dev`, all five
CodePipelines + CodeBuild + webhook Lambdas, the AWS ops-agent, the ops dashboard, CloudWatch, WAF,
rotation, relay Route 53 records.

# 8. Rules that outlived the cloud

Cloud-agnostic, learned on AWS, still true:

- **Health checks are liveness, never readiness.** Never make a health endpoint conditional on a
  dependency, a registration, or a connection — the orchestrator kills the task before it can finish
  the step, and it deadlocks. (AWS 2026-06-06: 29 tasks killed in a loop across three regions.)
- **Never default a required config value to empty.** An empty-string default silently disables the
  feature: the service starts, passes health checks, and is operationally broken. Required means no
  default, so the deploy fails loudly instead.
- **Know which stage a value resolves at.** Build-time, boot-time and runtime values propagate
  differently; updating the source does not fix downstream consumers unless you trigger
  re-resolution. On GCP the common trap is a value baked into an **image** or an **instance
  template** — changing the secret is not enough, the node must be rolled.
- **Verify against the running thing, not the desired state.** The task/instance is ground truth —
  not Terraform state, not a STATE doc, not this file.

---

## Related Documents

- [[GCP-STATE]] — the authoritative GCP record: resources, playbooks, standing deviations
- [[aws-to-gcp-migration]] — cross-cloud dependency map; read before debugging routing, DNS or presence
- [[STATE]] — AWS, superseded except for §7 survivors
