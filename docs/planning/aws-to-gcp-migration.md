---
name: aws-to-gcp-migration
type: reference
date: 2026-07-31
topics: [migration, gcp, aws, infrastructure, cutover, dependency-map, state]
status: living
description: >
  What is running where, right now, across both clouds — what has moved, what has not, and what
  depends on what. Read this BEFORE debugging anything that looks like a routing, presence, DNS or
  relay fault. On 2026-07-31 five agents and one human spent three hours debugging a system that had
  changed underneath them, because no document said so.
---

# AWS → GCP migration — current state

> **If you are an agent picking up a fault, read §1 and §4 first.** Most of what looked like protocol
> bugs on 2026-07-31 were this migration seen from inside. The system moved; nothing said so.

**Last verified: 2026-07-31 14:00Z.** Every number below was measured, not remembered.

---

## 1. The one-paragraph answer

The **client** has been cut over to GCP: the published daemon's bundled roster names the three
`gcp-*` directories, so every agent connects there. The **protocol infrastructure** is fully stood up
and proven on GCP. **AWS is still running everything too**, so two consortia are live with no
replication between them — by design, not by fault. **Agent identities did not move** and are not
going to; the plan is fresh agents. The **waitlist has not moved** and still depends on AWS.

---

## 2. What runs on GCP (project `cello-infra`, 955736313934)

| Component | Detail |
|---|---|
| Directory `gcp-use1` | us-east1 · public `34.75.172.108` · internal `10.10.0.35` |
| Directory `gcp-usc1` | us-central1 · public `34.136.176.190` · internal `10.10.1.25` |
| Directory `gcp-euw1` | europe-west1 · public `34.34.166.245` · internal `10.10.2.24` |
| Per node | own Cloud SQL over PSC, own KMS keyring, 3 buckets, own secrets. **Schema V57.** |
| Relay | `gcp-relay-use1` · `34.139.119.165` |
| Portal | Cloud Run + Cloud SQL + global LB `34.111.250.93` + managed cert → **portal.cello.mygentic.ai** |
| Ops agent | Cloud Run, min=max=1, `cpu_idle=false` — the Telegram bot that issues registration tokens |
| Consortium | T = majority(3) = 2. Manifest v2, GCP officer key `e8300a2b…b104` |

**Proven live on GCP** (2026-07-31): registration → DKG → online → session over the relay → messages
both directions → sealed receipt; a full run with one directory **down** (T=2 of 3) including a new
registration at exactly T; anti-entropy convergence across all three store tiers; kill-switch pause
fired on one node biting on all three.

## 3. What still runs on AWS

| Region | Services |
|---|---|
| us-east-1 | directory 1/1, relay 1/1, portal 1/1, ops-dashboard 1/1, **ops-agent 0/1 (not starting)** |
| eu-central-1 | directory 1/1, relay 1/1 |
| ap-northeast-1 | directory 1/1, relay 1/1 |

Plus: portal RDS (`db.t4g.micro`, 20 GB — holds the waitlist tables **and** the original portal
accounts), the 13-function waitlist stack, API Gateway, 1 NAT gateway, SES, Route 53, Lightsail,
Secrets Manager, S3, ECR, KMS.

---

## 4. THE DEPENDENCY MAP — what breaks if you stop what

This is the section that did not exist and should have.

| If you stop… | …this breaks |
|---|---|
| **AWS directories / relays** | Nothing a current client uses. The client roster points at GCP. Only agents registered against AWS lose their home. |
| **AWS portal RDS** | The **waitlist** — every waitlist Lambda connects to it (`cello_portal`, user `portal_admin`). Also the original portal accounts. |
| **AWS NAT (us-east-1)** | Waitlist **email delivery** — the Lambdas reach SES over NAT and have no VPC endpoints, deliberately. Signups still capture; `email_jobs` queues. |
| **SES** | **OTP email for GCP registration.** This is the one live cross-cloud runtime dependency. Hibernate does not touch it. |
| **Route 53** | All DNS, including the records pointing at GCP. |
| **AWS portal ECS** | Nothing — `portal.cello.mygentic.ai` resolves to GCP. |
| **GCP directories** | Everything. This is the protocol now. |

**Two `cello_portal` databases exist.** The AWS one holds the waitlist tables and the original
accounts and is still the live one for the public waitlist path. The GCP one is new and empty and
serves `portal.cello.mygentic.ai`. They are unrelated.

---

## 5. What has NOT migrated

- **Agent identities and FROST shares.** They live on the AWS directories. Deliberate: the plan is
  fresh agents. Consequence, measured: the five agents online on `gcp-use1` have **no profile and no
  key share there** — a socket and a presence row with no identity behind them.
- **The waitlist.** 13 Python handlers (~14,200 LOC) + 8 shared modules + 512 LOC of tests, plus API
  Gateway and 8 EventBridge schedules. See §7.
- **Portal accounts** — superseded by the new GCP portal database.
- **The ops dashboard** (`operations.cello.mygentic.ai`) — AWS-only, rides the AWS portal ALB.

## 6. Code state

| Repo | State |
|---|---|
| `cello-client` | **On main and published.** `latest` = cli 0.0.108 / daemon 0.0.105, bundling the GCP roster. |
| `trustless-cello` | **236 commits on `m12/node-dir-gcp`, NOT merged to main** (21 behind). The GCP infrastructure exists as branch code plus deployed state. |

That asymmetry is worth staring at: the change that moved every agent is merged and shipped; the
infrastructure that makes it work is on a branch.

---

## 7. The waitlist port — scoped 2026-07-31

Better shape than the function count suggests. **Only one handler touches AWS in anger.**

| Handler | LOC | AWS |
|---|---|---|
| email | 2935 | **SES** |
| auth | 2479 | none |
| signup | 1755 | none |
| gallery | 1108 | none |
| actions | 1076 | none |
| waves | 1042 | none |
| outreach | 775 | none |
| gate | 693 | none |
| migrate | 643 | none |
| feedback | 483 | none |
| firstwin | 443 | none |
| bounce | 429 | none |
| utm | 360 | none |

The AWS surface is four things, not thirteen:

1. **`lambda_handler(event, context)`** unwraps API Gateway v2 (`requestContext.http.method/path`,
   `event["body"]`) and returns `{statusCode, headers, body}`. The real logic is already factored
   out behind it — `handle_signup(body, origin, correlation_id)`. ~20 lines per handler.
2. **`_dburl.py`** reads the password from the RDS-managed secret — **but `DATABASE_URL` already wins
   when set**, for the test harness. On GCP: set it, change nothing.
3. **`waitlist-email`** uses boto3 SES. Keeps doing exactly that, with the static credentials the GCP
   ops agent already uses.
4. **`_dispatch.py`** (67 LOC) invokes the email Lambda to skip the 1-minute tick. Becomes an HTTP
   POST to the email service's Cloud Run URL. Its own docstring says the nudge is best-effort with
   the schedule as the safety net, so the failure mode is unchanged.

**Target shape:** ONE Cloud Run service with a path router (the handlers already discriminate on
path), Cloud Scheduler for the 8 schedules, SES posting bounces to a Cloud Run URL, tables in the GCP
portal Cloud SQL. API Gateway and NAT both disappear. The 512 lines of tests call handlers directly
and port with them.

**Not a rewrite and not a reduced version** — an adapter layer, a router, one HTTP call, and
Terraform, against ~14k lines of logic that do not change.

**Phases, in dependency order:** schema into the GCP portal DB → router + adapters with the existing
tests green → Cloud Run + Cloud Scheduler in Terraform → repoint the corp site's `/api/waitlist` →
verify signup end to end → AWS goes dark.

---

## 8. What remains, and the order

1. **Stop the split-brain.** Bring the AWS protocol stack down (directories, relays, AWS portal,
   AWS ops-agent). Nothing a current client uses depends on it.
2. **Port the waitlist** (§7). Needed next week.
3. **Merge `m12/node-dir-gcp` to main.** 236 commits.
4. Then AWS holds only **SES + Route 53** (+ Lightsail, + the cheap retained services).

**Careful with `hibernate.sh` as it stands:** it stops the portal RDS (step 3b2) and deletes the NAT,
which is exactly the pair the waitlist needs. Until §7 lands, a full hibernate takes the waitlist with
it. It no longer touches `portal.cello.mygentic.ai` — that guard was added 2026-07-31.

**Also note:** AWS restarts a *stopped* RDS instance automatically after **7 days**. Stopped is a
snooze, not a parking state.

---

## 9. How this went wrong, recorded so it does not repeat

The client roster was repointed from the AWS directories to the GCP ones and shipped **as a bug fix**.
The reasoning was sound as far as it went — the AWS hostnames were blackholed by hibernation, so no
client could connect to anything — and then that momentary fact was treated as permanent. Nobody
asked what happens when AWS wakes.

It was a cutover. It got no checklist, no staging rehearsal, no merge to main first, no shutdown of
the old side, no announcement. When AWS was later woken, both consortia ran at once.

The cost was not the resources. It was that **five agents and one human debugged five different
mental models of the system for three hours**, and every one of those investigations was correct
against a system that had changed underneath it. Feedback's replication theory was sound reasoning
from the evidence available. The relay and DNS faults were real observations.

**The rule this document exists to enforce: a topology change is not a fix. It gets a checklist, and
it gets written down here before it ships.**
