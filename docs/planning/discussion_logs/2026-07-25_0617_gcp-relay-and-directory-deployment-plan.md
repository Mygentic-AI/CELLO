---
name: GCP relay and directory deployment plan
type: discussion
date: 2026-07-25
topics:
  - infrastructure
  - gcp
  - multi-cloud
  - sovereign-nodes
  - relay
  - directory
  - frost-threshold
  - logical-replication
description: >
  Deep investigation into deploying CELLO relay and directory nodes on Google Cloud.
  Establishes that the relay is portable today with zero code changes while the directory
  is gated on cross-cloud Postgres replication and the deferred share-enrollment story.
  Finds that adding exactly one node (N=3→4) buys zero extra fault tolerance, and that
  Cloud Run is disqualified for both node types by its 60-minute request cap.
status: draft
---

# GCP relay and directory deployment plan

**Investigation only. Nothing was created, enabled, or modified in GCP or AWS.** No API was
enabled, no project created. Every GCP claim below is from the CLI or from Google's own docs;
every CELLO claim is from source in this repo or `cello-client`, cited by file and line.

---

## 1. Why this question

The sovereign-node invariant has three purposes: security, redundancy, and **choice** — "operators
are not locked to a single cloud provider or region." Today all three directory nodes and all three
relays are AWS. Provider diversity is currently a claim in the design record, not a deployed fact.
This log works out what it actually takes to make it a fact on GCP.

The manifest schema already anticipated this: every node entry carries a `provider` field, and all
three current entries read `provider: "aws"`
(`cello-client/core/daemon/src/bundled-consortium-manifest.ts`). The schema was built for this. The
infrastructure was not.

---

## 2. Starting state (verified)

**GCP account is usable.** `gcloud` 551.0.0, authenticated as `andre@mygentic.ai`, org
`mygentic.ai` (`376185218056`), billing account `012EFA-590A2E-2A82B4` (OPEN). Ten existing
projects, none CELLO-related. There is no CELLO footprint in GCP whatsoever — this is greenfield.

**AWS side** is 15 CloudFormation stacks per region (17 in us-east-1, which additionally carries
CI/CD and the ops-agent). Confirmed from `infra/deploy.sh:284-291`: CI/CD and
`cello-ecs-operations-agent` are **us-east-1 only** — the ops-agent is a single global Telegram
bot. A GCP node therefore does not need the SES dependency
(`packages/operations-agent/src/ses/ses-otp-delivery-provider.ts`), which is the only SES consumer
in the tree. That removes what would otherwise have been the ugliest port.

---

## 3. The central finding: relay and directory are not the same problem

I checked the actual runtime AWS surface of each package rather than assuming symmetry. They are
wildly different.

### The relay has zero AWS dependencies

`packages/relay/package.json` — no `@aws-sdk/*`, no `pg`. Dependencies are libp2p, crypto,
cbor-x, and CELLO's own packages. Its state is the local filesystem: `FileSessionWal` and
`FileContentStore` rooted at `WAL_DIR` (`packages/relay/src/bin/relay.ts:65,105,120`). It needs
exactly two secrets (`NODE_PRIVATE_KEY`, `CELLO_RELAY_TRANSPORT_KEY_HEX`) and four config values
(`CELLO_DIRECTORY_PUBKEY`, `CELLO_DIRECTORY_PUBKEYS`, `CELLO_DIRECTORY_MULTIADDR`,
`CELLO_RELAY_PUBLIC_MULTIADDR`) — all plain env vars in `cello-ecs-relay.yaml`.

Critically, the relay **self-registers** with the directory over libp2p (`relay_register`) using
`CELLO_RELAY_PUBLIC_MULTIADDR` as its advertised address. It does not need to be written into any
AWS-side registry to become usable, and its advertised address is already a parameter.

**A GCP relay requires no code changes.** That is the single most actionable conclusion here.

### The directory has three AWS SDKs and a database

`packages/directory/package.json` pulls `@aws-sdk/client-s3`, `@aws-sdk/client-secrets-manager`,
`@aws-sdk/client-ssm`, and `pg`. Every call site is dynamically imported behind a `CELLO_ENV`
check, which is good news for portability — the adapter seams already exist:

| Call site | Purpose | GCP counterpart |
|---|---|---|
| `bin/directory.ts:170` Secrets Manager | fetch RDS credentials at pool-refresh time | Secret Manager (regional) |
| `bin/directory.ts:514` SSM `GetParametersByPath` | read `/cello/{env}/nodes/` relay registry | Parameter Manager (regional) or drop — see below |
| `adapters/s3-audit-log-shipper.ts:110` | ship audit logs | GCS |
| `adapters/s3-cloud-storage-provider.ts:25` | relay manifest storage | GCS |

Four new adapters, each behind an existing interface in `packages/interfaces/src/`. This is
genuinely the pattern the M4 adapter rule was written for, and it holds up.

**KMS is not actually wired.** `cello-ecs-directory.yaml` injects `DEV_ENVELOPE_KEY` and the
comment says `LocalEnvelopeKeyProvider` is "placeholder until `KmsEnvelopeKeyProvider` is wired in
M5+". So there is no Cloud KMS work needed to reach parity with dev — a GCP node uses the same
hex-key provider. Worth stating plainly because a naive port plan would budget for KMS.

**The SSM node registry may be droppable.** The registry is how the directory learns relay
addresses at boot, but relays also self-register over libp2p, and the directory already tolerates
an empty registry (`node.registry.empty` → "Start but relay will be unavailable — DB-001 degraded
behavior", `bin/directory.ts:~550`). Whether a GCP directory can boot with an empty registry and
pick up relays purely via self-registration is **testable but unproven** — I did not run it. If it
works, that removes the entire Parameter Manager port.

---

## 4. Hard GCP constraints found

### Cloud Run is disqualified for both node types

WebSocket streams on Cloud Run are HTTP requests subject to the service request timeout, and **the
maximum is 60 minutes** (default 5). Google's own guidance is to "implement client reconnection
logic," and session affinity is explicitly "best effort."

This is fatal, and not marginally so. The relay sets
`RELAY_SESSION_MAX_IDLE_MS = 86400000` — **24 hours** (`cello-ecs-relay.yaml`). A design that holds
sessions idle for a day cannot run on a platform that severs every connection hourly. The directory
holds equally long-lived client connections (`directory.signaling.connected` persists for the life
of the daemon).

I want to be precise about a distinction that is easy to get wrong: on AWS,
`idle_timeout.timeout_seconds: 300` is an **idle** timeout — active connections live forever.
Cloud Run's 60 minutes is an **absolute** cap on connection age regardless of activity. These are
not comparable numbers.

### But a regional external ALB has effectively no cap

The GCP backend service timeout range is 1 – 2,147,483,647 seconds, and for WebSocket traffic "the
timeout parameter sets the maximum amount of time that a WebSocket can be open (idle or not)." So a
**regional external Application Load Balancer** in front of a Compute Engine MIG or GKE has no
practical connection-age limit. The 60-minute problem is Cloud Run's alone, not GCP's.

Use the **regional** external ALB, not the global one. The global ALB is anycast behind a single
global IP — routing a supposedly region-sovereign node through Google's global edge undermines the
"one node = one region = one independent deployment" invariant. Regional keeps the node pinned.

### Cloud SQL supports the replication topology, with one catch

Postgres 18 is available on Cloud SQL (`POSTGRES_18` confirmed via `gcloud sql instances create
--help`), matching RDS `18.3` exactly — no version-skew risk in the Flyway history.

Google documents that a logical replication source "can be any PostgreSQL server, including
servers running on ... other cloud providers (such as Amazon RDS)." So the topology is supported.

**The catch:** "Instances that use high availability (HA) can't be used as subscribers, because
they don't have a consistent outgoing IP address." CELLO's replication is a bidirectional mesh —
`infra/setup-replication.sh` has every node run a publication *and* two subscriptions. A GCP node
must be both, so **a GCP directory cannot use Cloud SQL HA.** Irrelevant for dev (`MultiAZ:
false`), a real constraint for production (`MultiAZ: true` when `IsProduction`).

### Cross-cloud networking for replication is the actual hard part

AWS-to-AWS replication rides VPC peering (`cello-vpc-peering.yaml`, and
`setup-replication.sh` lists "VPC peering with DNS resolution enabled" as a prerequisite). RDS is
`PubliclyAccessible: false`.

For a GCP node to *subscribe to* the three RDS instances, it needs a private path to them. That
means HA VPN from GCP to each AWS region's Site-to-Site VPN — three tunnels, with non-overlapping
CIDRs to design around the existing `10.0/10.1/10.2` allocation (`deploy.sh:72-74`). The reverse
direction is easier: Cloud SQL with a public IP and authorized networks limited to the three AWS
NAT egress IPs would let AWS subscribe to GCP.

Making RDS publicly accessible to avoid the VPN is the obvious shortcut and it should be named and
rejected: it exposes the share store to the internet to save infrastructure work, on a project
whose entire value proposition is trust. Not worth it.

---

## 5. The T-of-N consequence — read this before picking a node count

`packages/directory/src/directory-node.ts:2818`:

```
const dkgThreshold = consortiumNodeCount === 1 ? 2 : Math.floor(consortiumNodeCount / 2) + 1;
```

where `consortiumNodeCount = manifestNodes.length || 1` (line 2807). Working it through:

| N | T = majority(N) | Failures tolerated |
|---|---|---|
| 3 (today) | 2 | 1 |
| **4** | **3** | **1** |
| 5 | 3 | 2 |

**Adding exactly one GCP node makes the system strictly worse.** N=4 → T=3: still only one
tolerated failure, but now three nodes must co-sign every ceremony instead of two — more latency,
more coordination, more ways to fail, zero redundancy gain. This is a genuinely counterintuitive
result and it falls directly out of the majority rule. If we add GCP nodes, **add two** (N=5,
T=3, tolerates two simultaneous failures), or don't change N at all.

This is not a reason to revisit the threshold policy — `T = majority(N)` is settled. It is a reason
to be deliberate about N.

### Existing agents keep working; the new node cannot serve them

An agent's FROST group is fixed at registration. Growing the manifest does not retroactively change
any existing agent's T. So the migration trap is milder than it first looks — nobody gets stranded.

But a new GCP node holds **no share** for any pre-existing agent, and shares are secret and never
replicated. It cannot co-sign for them until a resharing ceremony gives it one. That is precisely
the deferred **M8B Sprint B "Enrollment (Problem 3)"** work, still owed. The related **absent-node
reconcile** gap also applies: the in-memory profile cache only loads at boot.

So: a GCP directory would serve only newly-registered agents until enrollment ships. That is
acceptable if stated deliberately. It is a broken promise if we ship it and call the node a peer.

### Clients can adopt a new manifest without a republish

This is the good news, and it is load-bearing for any plan here. `startHttpManifestPoll`
(`core/daemon/src/consortium-bootstrap.ts:208-219`) polls the directory for a newer manifest and
verifies it against `BUNDLED_CONSORTIUM_ROOT_KEYS` with `BUNDLED_CONSORTIUM_THRESHOLD = 1`. Only
the *officer root key* is pinned in the client — the roster is not.

The officer key lives in Secrets Manager at `cello/{env}/consortium/officer-key-0` and there is one
officer with threshold 1. So adding a node is: re-sign the manifest with the officer key, publish
it, and existing daemons adopt it by poll. **No client republish, no npm version cascade.** That
removes the scariest part of the migration.

---

## 6. Two code changes the port needs

**1. The directory's advertised multiaddr is hardcoded to plaintext port 80.**
`packages/directory/src/bin/directory.ts:1095-1096`:

```
bootstrapMultiaddr = `/dns4/${directoryHostname}/tcp/80/ws/p2p/${directoryPeerId}`;
```

The relay's equivalent is a parameter (`CELLO_RELAY_PUBLIC_MULTIADDR`); the directory's is not.
GCP's managed-cert LB path is HTTPS, so a GCP directory needs to advertise
`/dns4/.../tcp/443/wss/p2p/...`. The container can keep listening plain `ws` on 8080 behind TLS
termination — only the *advertised* address changes. `webSockets()` in
`cello-client/core/transport/src/node.ts:496` is unfiltered, so Node clients dial `wss` fine.

Fix: make it configurable, matching the relay's existing pattern. Small change, and it removes a
hardcoded assumption that shouldn't be there regardless of GCP.

**2. The manifest `endpoint` field is `http://` for all three nodes.** A GCP node's entry would be
`https://`. Worth confirming the `/bootstrap` fetch path handles both schemes before relying on it.

---

## 7. Recommended phasing

The relay/directory asymmetry is so large that treating "GCP nodes" as one project would be a
mistake. Split it.

### Phase 1 — GCP relay (low risk, real value)

No code changes. No database. No replication. No cross-cloud networking. No manifest change, no
threshold change, no enrollment dependency — the relay is not part of the FROST consortium, so none
of §5 applies to it.

Resources: one project, Artifact Registry, a regional MIG (or a single GCE instance) behind a
regional external ALB with a large backend timeout, two Secret Manager secrets, a persistent disk
for `WAL_DIR`, and one Route53 record pointing at the GCP LB IP. The relay dials out to an existing
AWS directory and self-registers.

This delivers provider diversity on the **data path** — where sessions actually flow — which is the
part a prospective customer would notice if a provider had an outage. It is the highest
value-per-unit-of-work item in this whole log.

Note one improvement over today as a side effect: a persistent disk for `WAL_DIR` is more durable
than Fargate's ephemeral `/tmp/wal`.

### Phase 2 — GCP directory (substantial)

Ordered by dependency, not by effort:

1. Four adapters behind existing interfaces (Secret Manager, GCS ×2, and Parameter Manager *only
   if* the empty-registry boot test in §3 fails).
2. Make the bootstrap multiaddr configurable (§6).
3. Cross-cloud networking: HA VPN to three AWS regions, CIDR allocation outside `10.0-10.2/16`.
4. Cloud SQL Postgres 18, no HA, logical decoding on, extended into the existing mesh in
   `setup-replication.sh` — which is currently hardwired to exactly three regions and would need
   generalising.
5. Image distribution. `NEVER push Docker images from local` stands, and ECR cross-region
   replication does not reach GCP. Artifact Registry remote repositories support custom upstreams
   with basic auth, but I could **not** confirm from Google's docs that ECR specifically works as
   an upstream — ECR's auth tokens are short-lived, which is the likely problem. Treat this as an
   open question, with "extend CodeBuild to also push to Artifact Registry" as the fallback.
6. Manifest re-sign to N=5 — and per §5, only alongside a second GCP node.
7. Blocked on / explicitly scoped around M8B Sprint B enrollment.

### Launch-triage read

Phase 1 is worth doing: bounded, no code changes, and it makes provider diversity real where it is
visible. Phase 2 does not pass the launch test — a prospective customer cannot tell whether the
directory quorum spans two clouds or one, and the work pulls in a VPN, a replication redesign, and
a deferred crypto ceremony. Provider diversity for the directory is a **post-launch** story unless
something external forces it.

The trap to avoid: doing Phase 2 halfway, ending up at N=4, and shipping a consortium with worse
ceremony cost and no more fault tolerance than today.

---

## 8. Region selection

AWS holds us-east-1 (Virginia), eu-central-1 (Frankfurt), ap-northeast-1 (Tokyo). Since one node =
one region and no two nodes share a region, GCP regions never collide with AWS ones by name — but
the spirit is geographic independence, so pick regions that are genuinely elsewhere.

For a Phase 1 relay, put it where it adds a distinct failure domain and reasonable client latency:
`us-west1` (Oregon) or `europe-west2` (London). For a Phase 2 pair at N=5, `us-west1` +
`europe-west2` keeps three-node quorums geographically reachable without pushing ceremony latency
into the Pacific.

`NODE_ID` is `!Ref AWS::Region` on AWS and must equal the manifest `nodeId`. For GCP we set it
explicitly — worth deciding whether it is `europe-west2` or `gcp-europe-west2`. I lean toward the
provider prefix: it makes the topology self-describing in logs, and the `provider` field already
exists in the manifest to match.

---

## 9. What I could not prove

Stated explicitly rather than glossed, per the debugging discipline:

- **Whether the directory boots usefully with an empty node registry.** This determines whether the
  Parameter Manager port is needed at all. Testable locally; I did not run it.
- **Whether ECR works as an Artifact Registry remote upstream.** Google's docs cover Docker Hub and
  "custom" upstreams with basic auth; ECR's short-lived tokens are the likely blocker. Unresolved.
- **Actual cross-cloud replication lag and cost.** Google confirms RDS-as-source is supported; I
  have no measurement of a bidirectional AWS↔GCP mesh under CELLO's write pattern.
- **Whether the `/bootstrap` client path handles an `https://` manifest endpoint.** Needs a read of
  the fetch path.
- **Cost.** I deliberately did not produce dollar figures — I would have been assembling them from
  memory of GCP pricing rather than from a primary source, and a made-up number in a planning doc
  is worse than no number. Worth pulling from the pricing calculator before any go/no-go.

---

## 10. Open decisions for Andre

1. **Phase 1 relay only, or commit to the directory too?** My recommendation: relay now, directory
   post-launch.
2. **If the directory happens — two GCP nodes, not one.** N=4 is strictly worse than N=3. Confirm
   you want N=5 or leave the consortium at 3.
3. **`NODE_ID` convention** — bare region or `gcp-` prefixed.
4. **New GCP project, or reuse an existing one?** A dedicated `cello-nodes` project (or one per
   node, to mirror the sovereignty model at the IAM boundary) is the cleaner default.

---

## Appendix — AWS→GCP resource mapping

| AWS (current) | GCP counterpart | Notes |
|---|---|---|
| ECS Fargate | Regional MIG on Compute Engine, or GKE | **Not Cloud Run** — 60-min WS cap |
| ALB (`idle_timeout: 300`) | Regional external ALB | Set backend timeout high; avoid the global ALB |
| RDS Postgres 18.3 | Cloud SQL `POSTGRES_18` | No HA — HA instances can't subscribe |
| Secrets Manager | Secret Manager (regional) | Regional secrets are GA |
| SSM Parameter Store | Parameter Manager (regional) | May be droppable — see §3 |
| S3 (audit, manifest) | GCS | Two adapters |
| KMS | *not needed* | `LocalEnvelopeKeyProvider` is still the dev path |
| ECR | Artifact Registry | Upstream-from-ECR unconfirmed |
| CloudWatch | Cloud Logging / Monitoring | Logger is injected — adapter, not rewrite |
| VPC peering | HA VPN to AWS S2S | The hard part |
| Route53 | *stays Route53* | `cello.mygentic.ai` zone is authoritative; add A records to GCP IPs |
| SES (ops-agent) | *not needed* | us-east-1 only |

**Sources (GCP):**
[Cloud Run WebSockets](https://docs.cloud.google.com/run/docs/triggering/websockets) ·
[Backend services overview](https://docs.cloud.google.com/load-balancing/docs/backend-service) ·
[Cloud SQL logical replication](https://docs.cloud.google.com/sql/docs/postgres/replication/configure-logical-replication) ·
[Replicating from an external server](https://docs.cloud.google.com/sql/docs/postgres/replication/external-server) ·
[Secret Manager regional secrets](https://docs.cloud.google.com/secret-manager/regional-secrets/overview-rs) ·
[Parameter Manager overview](https://docs.cloud.google.com/secret-manager/parameter-manager/docs/overview) ·
[Artifact Registry remote repositories](https://cloud.google.com/artifact-registry/docs/repositories/remote-overview)
