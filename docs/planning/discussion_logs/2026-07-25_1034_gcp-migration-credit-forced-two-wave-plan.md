---
name: GCP migration — credit-forced two-wave plan
type: discussion
date: 2026-07-25
topics:
  - infrastructure
  - gcp
  - migration
  - multi-cloud
  - sovereign-nodes
  - frost-threshold
  - logical-replication
  - cost
description: >
  Supersedes the 06:17 GCP deployment log. AWS credits are running out, so migrating
  all but one directory/relay pair to GCP is forced rather than optional. Total data
  loss is acceptable and wanted — there is one user and a clean slate is a chance to
  test every flow end to end — which turns this from a migration into a rebuild and
  removes the cross-cloud VPN from the critical path entirely. Recommends an AWS relay
  plus all-GCP directories. Answers the nodeId convention and GCP project questions.
status: draft
---

# GCP migration — credit-forced two-wave plan

**Supersedes `2026-07-25_0617_gcp-relay-and-directory-deployment-plan.md`.** That log asked
"should we add a GCP node for provider diversity?" and concluded *relay now, directory
post-launch*. The premise changed: AWS credits are running out, GCP credits are plentiful, and
the directory migration is now **forced**. The recommendation to defer the directory is
withdrawn. Everything in the earlier log about Cloud Run, Cloud SQL, and the adapter surface
still holds and is not repeated here.

**Investigation only. Nothing was created or modified in AWS or GCP.** The live-database queries
below were read-only `SELECT`s via ECS Exec.

---

## 1. The forcing function and the target

Migrate all but one directory/relay pair off AWS. GCP has room for 5–6 pairs. The demo agent and
ops agent are candidates too.

**Keep us-east-1 as the surviving AWS node.** It is not an arbitrary choice — us-east-1 uniquely
carries CI/CD, the ops-agent, the portal and its RDS, the waitlist stack, and the demo agent
(`deploy.sh:284-291`: every other region gets 15 stacks, us-east-1 gets 17). Migrating it would
mean migrating five workloads at once. Migrate eu-central-1 and ap-northeast-1.

Keeping one AWS node also converts the sovereign-node **choice** purpose from a design claim into
a deployed fact, which it has never been — all three nodes are AWS today.

---

## 2. This is a rebuild, not a migration

I queried the live us-east-1 directory database rather than reasoning about it:

```
agent_key_shares  →  5
agent_profiles    →  5
distinct epochs   →  5
```

Five agents — all Andre's own testing, one user, zero external. And per Andre: losing all of it
is not merely acceptable but **preferable**, because a clean slate is a chance to exercise every
flow end to end.

**That reframes the whole project.** Nothing below is a migration of state. There is no data to
move, no share to preserve, no cutover window to hold, no rollback plan to write. Every hard
problem in the previous log came from *preserving* something. Delete that requirement and most of
them disappear:

- No share export, envelope-key transfer, or identifier verification.
- No atomic per-node manifest cutover (§3's same-identifier hazard cannot arise — there are no
  inherited identifiers).
- No `nodeId` rename-in-place, so the cloud-prefix convention applies to every node from birth
  (§7).
- **No cross-cloud VPN, if the directories go all-GCP** (§5) — this is the big one.

**Treat "rebuild the consortium from zero at the launch topology" as the actual deliverable.**

### The rebuild is itself the test we have never run

This deserves stating as a benefit, not just a consequence. **The system has only ever run at
N=3/T=2.** The launch topology is N=7/T=4 and it has never been exercised — not the DKG at seven
participants, not a four-of-seven signing quorum, not a seven-node replication mesh, not the
client's failover behaviour across seven endpoints.

A rebuild forces all of that through a real bring-up: fresh registration, fresh DKG, fresh
replication, fresh manifest adoption, fresh client flows. That is genuine launch de-risking, and
there is no cheaper moment to do it than while the only user is the person planning it.

The flip side, stated plainly: **N=7/T=4 is an untested path.** Expect the bring-up to surface
real defects — that is the point of doing it now rather than after launch. Budget for finding
things, not for a clean run.

### The hazard, recorded for later

Not applicable now; it will be. `agent_key_shares` is keyed `(agent_id, epoch_id)` with **no
`node_id` column** (`V4__agent_key_shares.sql`) and is **absent from `PUBLICATION_TABLES`**
(`setup-replication.sh:169`). Shares are per-node, secret, and never replicated — by design.

So decommissioning a directory **destroys its shares.** Post-launch, tearing down two of three
nodes would drop existing agents from three share-holders to one — permanently below threshold,
permanently unserviceable, with no restore and no resharing shortcut.

> **Tripwire.** The moment there is a user who is not Andre, this stops being background and
> becomes the blocking constraint, and §3's lift-and-shift becomes mandatory rather than
> optional. Re-check the share count and the user count immediately before decommissioning
> anything, every time.

Related, client-side: wiping the local daemon database also sidesteps
`DOD-MIGRATION-AMBIGUITY-RESOLVE-1`, whose only documented recovery is "resolve by hand or start
from a fresh database." A rebuild gets that for free.

---

## 3. Lift-and-shift works, and is the answer post-launch

Worth recording now, because the migration will need it eventually:

`FrostSecret = { identifier, signingShare }` (`core/crypto/src/frost/frost-resharing.ts:215`) —
the FROST evaluation point lives **inside the share**. Combined with the absent `node_id` column,
a share is bound to nothing about the node holding it. CLAUDE.md already states the property
plainly: *"a stolen decrypted share works on any node (possession = authority)."*

So a faithful successor node is: the `agent_key_shares` rows + the envelope key + the node
private key + the transport key. Move those four and the GCP node *is* the old node,
cryptographically. No resharing ceremony, no enrollment story.

Two consequences worth flagging:

- **The deferred hardening and this migration are in tension.** The M8B "optional hardening" item
  — FROST slot→identity binding — would break lift-and-shift by design. Shipping it *before* the
  migration makes the migration harder. Ordering matters; this is not obvious from either
  document alone.
- **Never let two manifest entries hold the same FROST identifier simultaneously.** Two nodes at
  the same evaluation point are not two independent participants; if a client counted both toward
  T, the threshold would be nominally met by one secret. Any per-node cutover must remove the old
  entry in the *same* manifest version that adds the new one.

### Correction to the earlier log

I previously wrote that a GCP directory is "blocked on the deferred enrollment story." That
overstated it. `packages/directory/src/frost-handler.ts:892,915` already wires
`generateRefreshContribution` and `applyRefresh` — **the directory side of resharing exists.**
What is missing is the client-side orchestration and the may-enroll credential. Enrollment is
orchestration work, not crypto work.

---

## 4. N and T for the new topology

`directory-node.ts:2818` — `T = majority(N)`:

| Topology | N | T | Failures tolerated |
|---|---|---|---|
| Today | 3 | 2 | 1 |
| 1 AWS + 5 GCP | 6 | 4 | 2 |
| **1 AWS + 6 GCP** | **7** | **4** | **3** |

**Go to seven.** N=6 and N=7 both require four co-signers, so the sixth GCP node is free
redundancy — it raises tolerance from two failures to three at no ceremony cost. Odd N is
strictly better under a majority rule, and the difference between 5 and 6 GCP nodes is one VM.

### Provider concentration, stated honestly

Six of seven nodes on GCP means a GCP-wide outage leaves one node — below T=4, consortium down.
That sounds alarming until you compare it to today, where an AWS-wide outage leaves *zero* of
three. The migration is a strict improvement in provider risk, not a regression. But it should be
recorded as a known shape rather than discovered later, and it is the argument for keeping at
least one node off GCP permanently.

---

## 5. The replication problem — and how to delete it entirely

The earlier log's hardest problem was cross-cloud Postgres replication: one GCP node needed HA
VPN tunnels to three AWS regions. At this scale it shrinks to **one** tunnel — six GCP nodes
replicate to each other **natively inside GCP** (VPC peering or a shared VPC, no VPN, no
cross-cloud egress), leaving only the surviving us-east-1 directory to join the mesh.

But that last tunnel is still, by a wide margin, the hardest remaining piece of work: HA VPN on
the GCP side, Site-to-Site on the AWS side, CIDR allocation around the existing `10.0`–`10.2/16`
ranges, and a failure mode that silently stops replication rather than erroring loudly. It exists
for exactly one reason: to keep one **directory** on AWS.

### The recommendation: keep an AWS *relay*, make the directories all-GCP

This is the structural insight the free-data-loss constraint unlocks, and it is worth more than
anything else in this log.

**Relays need no replication.** Verified earlier: the relay has no database, no AWS SDK, no FROST
participation, and no share. It is not a consortium member. An AWS relay peers with GCP
directories over plain libp2p and self-registers — **zero cross-cloud database plumbing.**

So split the invariant by cost:

| | Provider diversity | Cost of achieving it |
|---|---|---|
| **Relay** (session data path) | Keep 1+ on AWS | ~zero — no DB, no VPN |
| **Directory** (consortium) | All GCP for now | one HA VPN + mesh generalisation |

This buys provider diversity **on the path that actually carries user traffic**, and removes the
VPN from the critical path entirely.

**Is all-GCP directories a violation of the sovereign-node "choice" purpose?** No — and this is
the part worth being precise about rather than hand-waving. Today all three directories are AWS.
All-GCP is a *lateral* move on provider concentration, not a regression, while being a large
improvement on region count (3 → 6) and fault tolerance (1 → 2 failures). The invariant that must
never be violated is that the architecture *permits* cross-provider deployment — no hardcoded
endpoints, no provider-specific networking. A rebuild on GCP with the adapter seams intact keeps
that property fully alive; §3's lift-and-shift then makes adding an AWS directory later a
contained piece of work rather than a re-architecture.

Add the seventh AWS directory as a deliberate, separately-scoped provider-diversity story once
the VPN is worth building. Note the N/T consequence: all-GCP means **N=6, T=4, two failures
tolerated** rather than N=7's three. If you want the odd-N benefit without the VPN, the answer is
**seven GCP directories** (N=7, T=4) — one extra VM, no tunnel.

### Replication is healthy today

Verified rather than assumed:

```
cello_dev_us_east_1_eu_central_1     active=true   lag=1112 bytes
cello_dev_us_east_1_ap_northeast_1   active=true   lag=1112 bytes
cello_sub_from_eu_central_1          connected, latest_end 10:30:04Z
cello_sub_from_ap_northeast_1        connected, latest_end 10:30:05Z
```

Both slots active, negligible lag, both subscriptions current. The mechanism works — which was
not a given, since STATE.md records a prior wedge that produced thousands of apply-errors on
ap-northeast-1. A fresh mesh starts from a known-good pattern.

`setup-replication.sh` is hardwired to exactly three regions and will need generalising to N —
unavoidable either way.

**Replication is healthy today** — I verified rather than assumed:

```
cello_dev_us_east_1_eu_central_1     active=true   lag=1112 bytes
cello_dev_us_east_1_ap_northeast_1   active=true   lag=1112 bytes
cello_sub_from_eu_central_1          connected, latest_end 10:30:04Z
cello_sub_from_ap_northeast_1        connected, latest_end 10:30:05Z
```

Both slots active, negligible lag, both subscriptions current. Extending this mesh is building on
something that works, which was not a given — STATE.md records a prior wedge that produced
thousands of apply-errors on ap-northeast-1.

`setup-replication.sh` is hardwired to exactly three regions and will need generalising to N.

**One anomaly to look at:** `directory_nodes` in us-east-1 contains only the `us-east-1` row,
despite the table being in the publication and replication being healthy. Either the other two
nodes never write their own row, or that table's replication is not landing. Small, pre-existing,
and worth understanding before the mesh gets six times larger.

---

## 6. The cost lever nobody would find in a generic migration guide

Because the protocol tolerates node loss at T-of-N, **within-region high availability is not
required.** Redundancy comes from N, not from redundancy inside any one region. That is unusual
and it is worth money.

A CELLO node can legitimately be **one VM with a static public IP** — no load balancer, no NAT
gateway. On AWS today each region carries an ALB and a NAT gateway; both exist to provide
availability that the consortium already provides at a different layer. Dropping them per node,
across six nodes, is the single largest cost lever available.

Trade-offs to accept knowingly:
- TLS terminates in-process or via Caddy rather than a managed certificate.
- Public IPs on instances instead of NAT egress means firewall rules become the only perimeter.
- Keep **Cloud SQL** for the database regardless — managed backups and logical replication
  configuration are worth far more than the saving from running Postgres on the VM.

This also removes the earlier log's "regional vs global load balancer" concern entirely: with no
load balancer, there is nothing to accidentally route through Google's global anycast edge.

Cloud Run remains disqualified for both node types — its 60-minute cap is on absolute connection
age, and the relay holds sessions idle for 24 hours. Unchanged from the earlier log.

---

## 7. `NODE_ID` convention — answering the question

**Recommendation: adopt a cloud prefix on every node, including the AWS survivor.** Your
instinct is right, and there is a concrete trap it defuses.

**The collision is real.** AWS has `us-east-1`; GCP has `us-east1`. They differ by a single
hyphen. `setup-replication.sh` normalises hyphens to underscores for slot names, yielding
`us_east_1` and `us_east1` — technically distinct, one typo apart, and indistinguishable at a
glance in a log line. Bare region names are an accident waiting to happen the moment both clouds
are in play.

`NODE_ID` is not cosmetic. It is the manifest lookup key for step-6 directory identity
verification, and it is written into five replicated columns: `directory_nodes.node_id`,
`sessions.owning_node_id`, `agent_presence.owning_node_id`,
`checkpoint_node_signatures.node_id`, `directory_checkpoints.coordinator_node_id`.

**Pros of `<cloud>-<region>`** (e.g. `aws-use1`, `gcp-euw2`):
- Eliminates the one-hyphen collision permanently.
- Topology becomes self-describing in logs and in every replicated row — provider concentration
  is auditable at a glance rather than requiring a lookup table.
- Extends to Azure without another convention change.

**Cons:**
- Renaming the AWS survivor rewrites a trust-anchor key. Cheap in practice: clients adopt a
  re-signed manifest via `startHttpManifestPoll`, so **no client republish and no npm cascade.**
- Historical replicated rows keep the old names. This is archival only — verified that no share
  table references `node_id` at all, so nothing that matters joins on it.
- Anything parsing `NODE_ID` as a bare region needs checking (it is currently
  `!Ref AWS::Region`).

**Do the AWS rename in the same manifest version that adds the first GCP nodes** — one
coordinated change rather than two, and it avoids a window where conventions are mixed. Do it in
a quiet period, since `sessions.owning_node_id` would orphan in-flight sessions.

---

## 8. GCP project and billing — answering the question

**Your billing constraint is looser than you think.** Five projects already bill successfully on
`012EFA-590A2E-2A82B4` (`sso-authentication-and-sign-on`, `mygentic-sdk-agent`,
`claude-code-vertex-mygentic`, `mygentic-voice-agent`, `gen-lang-client-0809834273`). Linking a
sixth is very likely fine. The limit you remember struggling with is almost certainly on creating
additional *billing accounts*, not on attaching projects to an existing one — those are different
quotas. You also hold `roles/resourcemanager.organizationAdmin`, so you can grant yourself
`projectCreator` if it is missing.

**You do not need one project per node.** My earlier suggestion of a project per node to mirror
the sovereignty boundary was over-engineering. GCP regions are a resource attribute, not a project
boundary — **one project, six regions** is correct and sidesteps the billing concern entirely.

**On reusing `claude-code-vertex-mygentic`:** I verified it is genuinely empty — zero Compute
instances, no buckets, no Cloud SQL, only the default compute service account. Created
2026-04-21 for Claude Code via Vertex, never used because the quota approval never came. So reuse
is *safe*.

But there is a permanent catch: **GCP project IDs are immutable.** You can change the display
name to "Cello Infrastructure"; you cannot change the ID. Every resource path, every `gcloud`
invocation, every IAM binding, every log entry and every runbook line would read
`claude-code-vertex-mygentic` forever. For infrastructure whose repo technical evaluators read
directly, that is a small permanent wart.

**Recommendation:** try creating `cello-infra` and linking it to the existing billing account
first — the ID is permanent, so it is worth one attempt to get right. Fall back to renaming the
Vertex project only if the link is actually refused. Either way, enable the APIs deliberately;
that project has a wide default Vertex API surface enabled that CELLO does not need.

---

## 9. The other workloads

Migrating the nodes is not the whole AWS bill, and two of these are more urgent than the nodes.

**CI/CD is the hidden critical path.** CodePipeline, CodeBuild, and ECR are all AWS, all
us-east-1. If credits run out, **builds stop — and nothing ships anywhere, including to GCP.**
This has to be planned in the same breath as the nodes, not after them. Moving to Cloud Build +
Artifact Registry also dissolves the earlier log's unresolved "can ECR be an Artifact Registry
upstream?" question: build on GCP, push to Artifact Registry, never pull cross-cloud. The
standing rule (never push images from local; CI only) is unaffected.

**Demo agent** — EC2 `i-0ad3e7c22470f266e`, and **not in IaC** (STATE.md:1089, predates
CloudFormation, IAM role shared with openclaw-agent). It is `/opt/cello-demo` plus systemd units
plus npm packages, which makes it the *easiest* thing here to move: a GCE VM runs the same
systemd units unchanged. The real cost is operational — every runbook built on
`aws ssm send-command` breaks, including the quick-commands block in CLAUDE.md, which needs
rewriting to `gcloud compute ssh`. Worth finally writing IaC for it during the move.

**Ops agent** — us-east-1 only, single global Telegram bot; dependencies are just
`@aws-sdk/client-ses` and `pg`. **GCP has no first-party email-sending service and blocks
outbound port 25**, so there is no clean GCP-native replacement, and per the no-paid-SaaS
constraint a vendor is out. Two workable options: leave it on the surviving AWS node (simplest —
it is one small task), or run it on GCP still calling the SES **API** over HTTPS, which works
fine and costs pennies. Do not plan on self-hosted SMTP from GCE.

**Portal** — its own RDS (`cello-portal-dev`, `db.t4g.micro`), ECS service, and ALB. A fourth
workload you did not mention but which burns credits. Also currently in CFN drift
(`UPDATE_ROLLBACK_COMPLETE`, STATE.md:138), so it needs stack repair before any clean move.

**Waitlist** — 13 Lambdas plus SES and SNS, deployed **today** (2026-07-25). This is under active
construction and is the worst possible migration candidate right now. Leave it on AWS; revisit
once it stops changing.

---

## 10. Cost: I could not verify it, and did not estimate

Cost Explorer returns `0.00` / `-0.0` for every month from April to July for this IAM user
(account `257394457473`) — billing is consolidated into a payer account this identity cannot see.
The real numbers and remaining credit balance are in the payer account's billing console.

Two things I can say from the live inventory: the RDS instances are `db.t3.small` and
`db.t4g.micro`, **not** the `db.t3.medium` the CloudFormation template defaults to — so any
estimate built from the templates would have overstated spend. And hibernation is already cutting
roughly half the day (STATE.md shows a nightly down/up cycle), so steady-state burn is well below
a 24/7 read.

I am deliberately not putting dollar figures in this document. Please pull the actuals and the
credit balance from the payer account — the migration *order* below is driven by dependency, not
by cost, so the plan does not change with the numbers, but the *urgency* does.

---

## 11. The plan — two waves, plus a wave zero

Per your direction: two waves, no waiting for post-launch.

### Wave 0 — build capability (must precede or run alongside Wave 1)

Nothing else can ship if this is not in place.

1. Decide and create the project (§8). Enable only the APIs needed.
2. **Check per-region quotas before committing to six regions.** Young GCP projects commonly
   default to low per-region CPU and static-IP quotas; six regions means six separate quota
   grants, and requests take time. This is the most likely schedule surprise in the whole plan.
3. Cloud Build + Artifact Registry pipeline producing the directory and relay images.
4. Pick the six GCP regions. Favour genuine geographic spread while keeping four-node quorums
   latency-reasonable, since T=4 of 7 must be reachable for every ceremony.

### Wave 1 — relays (no code changes)

The relay has zero AWS SDK dependencies, no database, no FROST participation, and its advertised
address is already a parameter. It is not a consortium member, so **none of the N/T or share
analysis applies to it.**

5. Per region: one VM, static IP, persistent disk for `WAL_DIR`, two Secret Manager secrets
   (`NODE_PRIVATE_KEY`, transport key), firewall rule for the WS port.
6. Point them at the surviving AWS directory; they self-register via `relay_register`.
7. Add Route53 records (the `cello.mygentic.ai` zone stays authoritative on AWS — it is cheap and
   moving DNS during a migration adds risk for no gain).
8. Retire the eu/ap AWS relays as GCP relays come online.

A persistent disk for `WAL_DIR` is incidentally *more* durable than the current Fargate
ephemeral `/tmp/wal`.

### Wave 2 — directories

9. Write the four adapters behind the existing interfaces: Secret Manager, GCS ×2, and Parameter
   Manager **only if** the empty-registry boot test (§12) fails.
10. Make the bootstrap multiaddr configurable — `directory.ts:1095` hardcodes
    `/tcp/80/ws`, while the relay's equivalent is already an env var. Fix regardless of GCP.
11. Cloud SQL Postgres 18 per node, **no HA** (HA instances cannot be logical-replication
    subscribers, and every node is both publisher and subscriber).
12. Generalise `setup-replication.sh` from three hardwired regions to N; native GCP↔GCP peering
    plus one HA VPN to us-east-1.
13. Re-sign the manifest to N=7 with the `<cloud>-<region>` convention, renaming the AWS survivor
    in that same version. Clients adopt by poll — no republish.
14. **Re-register the five agents.** Confirm the share count is still small immediately
    beforehand (§2 tripwire).
15. Decommission the eu-central-1 and ap-northeast-1 stacks — only after the GCP nodes are
    serving and the agents are re-registered.

Wave 2 has a natural pause point after step 13: the consortium can run with GCP directories
alongside AWS ones before anything is torn down.

---

## 12. What I could not verify

- **Whether the directory boots usefully with an empty node registry.** Decides whether the
  Parameter Manager adapter is needed at all. Cheap to test locally; not tested.
- **Per-region GCP quota headroom** for six regions. Flagged above as the likeliest surprise.
- **Cross-cloud replication lag under real write load.** Today's intra-AWS lag is 1112 bytes,
  which tells us nothing about a GCP↔AWS tunnel.
- **Whether the client's `/bootstrap` path handles an `https://` manifest endpoint** — all three
  current entries are `http://`.
- **Actual spend and remaining credits** (§10).
- **Why `directory_nodes` holds only one row** (§5).

---

## 13. Open decisions

1. **Six GCP nodes, not five** — confirm N=7. The sixth node is free redundancy.
2. **Project ID** — attempt `cello-infra`, or accept the immutable
   `claude-code-vertex-mygentic`?
3. **Ops agent** — leave on AWS, or run on GCP against the SES API?
4. **Node shape** — single VM with static IP (cheap, and sound given T-of-N), or load balancer
   per node (conventional, costlier)? My recommendation is the single VM.
5. **Portal and waitlist** — out of scope for these two waves? My recommendation is yes for the
   waitlist (shipped today, still moving) and a separate decision for the portal.
