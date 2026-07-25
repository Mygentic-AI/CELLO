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
  test every flow end to end — which turns this from a migration into a rebuild.
  Recommends N=3 with one AWS directory retained, because only a directory can seal and
  so only a directory backs the "if GCP goes down, CELLO works" launch claim. Corrects
  an arithmetic error in the fault-tolerance table, explains why growing N is safe but
  non-beneficial for existing agents, and answers the nodeId and GCP project questions.
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

The starting brief: migrate all but one directory/relay pair off AWS, with room for 5–6 pairs on
GCP, and the demo agent and ops agent as candidates too.

**Two findings changed that brief, and the sections below argue for them:**

- Because total data loss is free and wanted, this is a **rebuild at the launch topology**, not a
  migration of state (§2). Almost every hard problem in the previous log came from preserving
  something.
- **One AWS *directory* stays** (§5). Andre overruled my all-GCP proposal and was right: only a
  directory can seal, so only a directory backs the launch claim *"if GCP goes down, CELLO still
  works."* Recommended target: **N=3 — one AWS directory + two GCP** — plus relays on both, scaling
  freely on GCP. The threshold arithmetic in §5 is what pins N to 3 rather than 5 or 7.

**Whatever else moves, us-east-1 stays.** It uniquely carries CI/CD, the ops-agent, the portal and
its RDS, the waitlist stack, and the demo agent (`deploy.sh:284-291`: every other region gets 15
stacks, us-east-1 gets 17). It is not a node to be decommissioned; it is where the non-node
workloads live (§9).

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
- No cutover choreography for the one cross-cloud VPN — it can be built, broken, and rebuilt
  freely until it works, because nothing depends on it staying up (§5).

**Treat "rebuild the consortium from zero at the launch topology" as the actual deliverable.**

### The rebuild is itself a test worth running

A rebuild forces every flow through a real bring-up: fresh registration, fresh DKG, fresh
replication, fresh manifest adoption, fresh client failover. There is no cheaper moment to do that
than while the only user is the person planning it.

Being precise about what is and is not new, since settling on N=3 (§5) changes this: **the
threshold topology itself is not new** — N=3/T=2 is exactly what runs today, which is a point in
its favour. What has never been exercised is everything *around* it:

- a directory running outside AWS at all,
- replication across two providers rather than three AWS regions,
- the one cross-cloud VPN and the Private Service Access route-export trap (§5),
- a manifest whose nodes span providers, adopted by poll,
- the ops-agent, portal, and waitlist running on GCP.

So expect defects in the **plumbing**, not the cryptography. That is a materially lower-risk shape
than the N=7 rebuild I proposed earlier, and it is another argument for N=3: it changes one
variable (provider) instead of two (provider and threshold).

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
private key + the transport key + **`NODE_ID` itself**. Move those five and the GCP node *is* the
old node, cryptographically. No resharing ceremony, no enrollment story.

**`NODE_ID` is in that list and I originally omitted it** — see §4. The FROST participant identifier
is `Identifier.derive(NODE_ID)`, so a successor that changes its `NODE_ID` derives a different
identifier and cannot use the inherited shares at all. It is the single most important item to
preserve, not an afterthought.

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

## 4. How T-of-N actually works — and why my earlier N=7 was wrong

Andre pushed back on N=7/T=4 and on whether adding directories strands existing agents. He was
right to. Reading the code closely, **his original mental model is the correct one**, my table had
an arithmetic error, and the design doc agrees with him. Taking the questions in order.

### Where the numbers come from

I gave a table without the derivation. The whole relationship is **one line of code** plus one
structural fact.

**The line** — `directory-node.ts:2818`:

```js
const dkgThreshold = consortiumNodeCount === 1 ? 2 : Math.floor(consortiumNodeCount / 2) + 1;
```

`T = floor(N/2) + 1` — the smallest integer strictly greater than half of N, i.e. a simple
majority. Nothing cryptographic forces this; FROST works for any `1 ≤ T ≤ n`. **It is a policy
choice**, settled 2026-07-04. Mechanically:

| N | floor(N/2) | **T** |
|---|---|---|
| 3 | 1 | **2** |
| 4 | 2 | **3** |
| 5 | 2 | **3** |
| 6 | 3 | **4** |
| 7 | 3 | **4** |
| 10 | 5 | **6** |

**Why majority specifically:** two majorities always overlap. If `T > N/2` you cannot form two
disjoint groups of size T, so there can never be two independent, non-communicating sets of
directories each producing a valid signature for the same identity. At `T ≤ N/2` you could split
the consortium into two quorums that never talk and each could sign — two authorities for one
agent. For a trust product that is the one outcome that must be impossible. Majority is the
*minimum* threshold that forecloses it.

**Why odd N is better** — this is why the table pairs up. `floor(N/2)+1` only increments when N
goes **odd → even**:

- 3 → 4: T rises 2 → 3. You added a node *and* raised the bar.
- 4 → 5: T stays 3. You added a node and the bar did not move — free redundancy.

So every even N has the same fault tolerance as the odd N beneath it while demanding one more
signature. Even N is always strictly wasteful. That is the entire reason to prefer 3, 5, 7 over
4, 6, 8.

### Why T−1 directories, not T

The structural fact, from `directory-node.ts:228`:

> *"the FROST group is **(T, N+1)** with T = majority(N) ≤ N"*

The group has **N+1** participants — the N directories **plus the client itself**, which holds a
share of its own. The threshold is T out of those N+1.

The client is always present when sealing its own data — it is the party initiating. So it supplies
one of the T signatures, and the other **T−1** must come from directories.

At today's N=3, T=2: the group is **2-of-4**. Client + any **one** directory reaches threshold. Two
of the three directories can be down.

**The security corollary worth knowing**, because it explains why T<N is safe: since T is a
majority of **N** (not of N+1), **T directories alone also reach threshold — without the client.**
That is a real hazard, and it is what `SEC-2` addresses: every commit/sign request must carry an
Ed25519 signature made with the agent's `K_local` private key over the exact message
(`FROST_AUTH_DOMAIN`, `directory-node.ts:231`), verified *before* the share is touched. So colluding
directories cannot forge arbitrary bytes — they can only contribute to a message the client
provably authorised.

### Two operations, two different requirements

Worth separating, because they explain the apparent inconsistency in the numbers:

- **Sealing/signing** needs **T−1 directories** (the client makes up the difference).
- **Registration/DKG** needs **|Q| ≥ T directories** (`directory-node.ts:2821`) — the ceremony has
  to *deal* shares to at least T holders, and the client cannot substitute for a holder here.

So at N=3: sealing tolerates **two** directories down; registering a new agent tolerates only
**one**. Registration is always the stricter operation, which is why §5's outage claim covers
sealing but not new registration.

### The correction: I under-counted fault tolerance

`directory-node.ts:2818` computes `T = majority(N)`, but the comment two lines up is the part I
failed to carry into the table: *"T counts the client (`runNetworkDkg` adds it as +1), so directory
signatures needed = T−1."*

The client is one of the T signers. So the number of **directories** needed to seal is **T−1**, and
tolerance is **N−(T−1)**, not N−T. Corrected:

| N | T | Directories needed to seal | Directories that can be down |
|---|---|---|---|
| **3 (today)** | 2 | **1** | **2** |
| 4 | 3 | 2 | 2 |
| **5** | 3 | **2** | **3** |
| 6 | 4 | 3 | 3 |
| 7 | 4 | 3 | 4 |
| 10 | 6 | 5 | 5 |

Today's N=3 tolerates **two** directories being down, not one. I stated one. Registration is the
stricter operation — it needs `|Q| ≥ T`, so two directories up — but sealing needs only one.

**This also answers "do I need all five to sign?"** No. You need T−1 directories. At today's N=3
that is literally **one** — which is exactly the intuition you had.

### Avoid N=4 specifically

N=4 needs two directories to seal and tolerates two down — **identical tolerance to N=3, but one
more node and one more partial per ceremony.** It is the one strictly-dominated choice. If you go
past three, go to five.

### Growing N does *not* strand existing agents — verified

This was the real worry, and the answer is reassuring. The agent's `threshold` **and** the quorum
`nodeIds` (Q) it was dealt among are persisted **with the share, client-side**
(`registration-persistence.ts:45,50` — *"the directory nodeIds (Q) the DKG ran among; a restored
signer targets these"*).

Signing uses those **stored** values, never the current manifest. So an agent registered at N=4
keeps T=3 and its original four-node cohort permanently. **Growing the manifest to 10 changes
nothing about it — it does not break, it simply does not benefit.** That is a much softer
statement than CLAUDE.md's "migration trap" phrasing implies: growth is *safe*.

### What new nodes can and cannot do — the actual gap

A node that was not in an agent's DKG holds **no share** for it, and shares are secret — never
replicated (§2), never transmitted. So six freshly-added directories are useless to the
four-node-era agents until they are given a share, which requires **enrollment**: dynamic
resharing onto an expanded access structure.

Your recollection of the original intent is correct, and it is written down. M8B §9 says it
outright:

> *"T-of-N is the **signing** threshold — T of the N directories sign each seal, and the other N−T
> may be down… Registration DKGs among the available quorum… **Absent nodes enroll
> asynchronously**, off the registration critical path, until coverage reaches full T-of-N."*

So "any T of the N can serve you" **is** the design. The current state — where non-participants
hold nothing forever — is an **unfinished implementation**, not a design change. M8B Sprint A
shipped quorum registration (register among who is up) and deferred the enrollment half that
restores full coverage. That deferral is the whole gap.

### What "locks a node in" is its FROST identifier — and it comes from `NODE_ID`

`frost-handler.ts:728` — `ed25519_FROST.Identifier.derive(this.#nodeId)`. The client derives the
same mapping (`session-ceremony.ts:238`: *"`id` feeds `Identifier.derive()` in the signer"*).

So **`NODE_ID` is cryptographically load-bearing, not a label.** Two corrections follow:

- **§7 was wrong.** I listed the costs of renaming a nodeId as archival rows and a manifest bump.
  In fact renaming changes the node's FROST identifier, so it can no longer participate for any
  agent whose share was dealt to the old identifier. On a rebuild that is free. On a live system it
  is a **share-destroying operation**. Materially worse than I described.
- **§3 was incomplete.** Lift-and-shift must preserve `NODE_ID` along with the share rows,
  envelope key, node key, and transport key. I omitted the one item that the crypto actually
  depends on.

### Your eventual topology (N=10, T=3–5) is not reachable as written

`T = majority(N)` is hardcoded and was **settled in writing on 2026-07-04** ("DO NOT RE-RAISE").
So N=10 gives **T=6** — five directories per seal — not 3–5. Many directories with small ceremonies
would require decoupling T from N, which lowers the collusion bar to any T operators. That is the
exact trade the majority rule was chosen to make, so it is a reopened decision, not a config
change. (The design doc's "10-of-15" predates that decision and does not satisfy
majority(15)=8 — treat it as illustrative and superseded.)

**But the goal behind it is already satisfied by the architecture.** "Many nodes, small ceremonies"
maps cleanly onto: **scale relays freely, keep directories few and odd.** Relays have no FROST, no
DKG, and no shares (§5) — they scale horizontally without touching the threshold at all. That is
where "quite a few nodes" belongs.

### So at launch: three or five directories

You are right that seven was over-shot; it came from threshold aesthetics ("odd is better") rather
than from need. **Recommendation: five directories** — two per seal, tolerates three down, a real
improvement on today at modest cost. **Three is entirely defensible** if you want minimum change,
and it is what is proven today. Avoid four.

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

### Recommendation, revised: keep one AWS **directory**, not just a relay

I previously argued for all-GCP directories with an AWS relay, on the grounds that the VPN was
the hardest remaining piece. **Andre overruled that, and he is right.** Two reasons, and the
second one is decisive:

1. **Google Cloud has had provider-wide outages.** Concentrating every directory *and* every
   database in one provider is the concentration risk, and "it's no worse than today's all-AWS" is
   a weak defence when we are choosing the topology from scratch.
2. **At launch we want to say, with evidence, "if GCP goes down, CELLO still works."** For a trust
   product that is a *product* claim, not an architecture detail. An AWS relay cannot support it —
   relays hold no shares and cannot seal. Only a directory can. A relay-only AWS presence would
   make the claim technically false.

That second point is the one my earlier reasoning missed: I was optimising the infrastructure and
gave away the thing the infrastructure exists to demonstrate.

### And the VPN is cheaper than I implied — one tunnel, not one per region

Andre's instinct that a single VPN might serve all the nodes is **correct**, and GCP's design is
what makes it work: **a VPC network is a global resource** with regional subnets. With the VPC's
dynamic routing mode set to **global** (`--bgp-routing-mode=global`; regional is the default), routes
learned over one HA VPN are advertised into *every* region of that VPC.

So: **one HA VPN between us-east-1 and a single global GCP VPC reaches Cloud SQL in all GCP
regions.** Not one tunnel per region. That collapses the piece I called the hardest remaining work
into a single, well-documented setup.

> **The wrinkle that will bite, flagged deliberately.** Cloud SQL private IP is reached through
> **Private Service Access**, which is itself a VPC peering. Routes learned over the VPN are **not**
> re-exported into that peering by default — it needs `--export-custom-routes` on the
> `servicenetworking` peering. This is a classic silent failure: everything looks configured, and
> the AWS node simply cannot reach Cloud SQL. Verify reachability explicitly before wiring
> subscriptions.

### Co-locating relay and directory — sound, with one correction

Putting the relay and directory in the same region (sharing an ALB via host-based routing, and one
NAT) is a real cost saving and is how the AWS side is already shaped. One clarification: **the
relay does not need the VPN at all.** It has no database and no replication, so the tunnel serves
the directory alone. Nothing is "split" to the relay — it just never uses it.

Note this interacts with §6: if a node is a single VM with a static IP and no load balancer, there
is no ALB to share. Pick one model — the sharing argument applies to the ALB shape, the cost
argument favours no ALB at all.

### The claim has an arithmetic requirement — and it constrains N

This is the part that decides the topology, and I nearly got it wrong. "If GCP goes down, CELLO
still works" means: **the surviving AWS directories alone must meet T−1.** From §4's corrected
table:

| N | T | Directories needed to seal (T−1) | AWS directories required for the claim |
|---|---|---|---|
| **3** | 2 | 1 | **1** ✓ |
| 5 | 3 | 2 | **2** |
| 7 | 4 | 3 | **3** |

So **one AWS directory only backs the claim at N=3.** At N=5, a single AWS node leaves you with one
directory against a requirement of two — a total GCP outage would take sealing down, and the claim
would be false. N=5 needs **two** AWS directories.

Be precise about what survives even when the arithmetic holds: **sealing continues, new
registration does not.** Registration requires `|Q| ≥ T` (§4), which a lone AWS node cannot satisfy.
The defensible claim is *"existing agents keep working through a GCP-wide outage"* — worth stating
that way rather than the broader version.

### Target shape — two honest options

- **N=3, one AWS + two GCP.** The claim holds with a single AWS directory. Cheapest, and it is the
  configuration proven in production today. Tolerates two directories down.
- **N=5, two AWS + three GCP.** The claim holds, tolerance rises to three down, and it costs a
  second AWS directory — which partly works against the credit pressure that started this.

**Recommendation: N=3 (1 AWS + 2 GCP) at launch.** It satisfies the product claim with the smallest
AWS footprint, which is exactly the constraint we are optimising, and N=3/T=2 is the only topology
with live evidence behind it. Grow to N=5 (2 AWS + 3 GCP) once enrollment ships and node growth
stops being one-way.

Relays are separate and scale freely — put several on GCP and keep at least one on AWS.

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

**One anomaly worth understanding before the mesh gets twice as large:** `directory_nodes` in
us-east-1 contains only the `us-east-1` row, despite the table being in the publication and
replication being healthy. Either the other two nodes never write their own row, or that table's
replication is not landing.

A rebuild wipes the symptom, so it is tempting to skip — but if the cause is that nodes don't
self-register into `directory_nodes`, it will reappear identically at seven nodes. Diagnose the
cause, not the row count.

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

**Cons — and a rebuild removes nearly all of them.** The costs I listed against renaming were
about *migrating* existing nodes: rewriting a trust-anchor key, orphaning historical
`owning_node_id` rows, needing a coordinated manifest version. **On a rebuild none of that
applies** — every node is born with the right name, no rename happens, and there are no
historical rows to orphan.

What remains:
- Anything parsing `NODE_ID` as a bare region needs checking (it is currently
  `!Ref AWS::Region`, so the value has always *been* a region string). Worth a grep before the
  first GCP node boots.

**So adopt `<cloud>-<region>` from the first node of the rebuild.** This is the cheapest it will
ever be — the convention question only became expensive in the migration framing that no longer
applies.

> **Correction (see §4).** I described renaming a live node's `NODE_ID` as costing only archival
> rows and a manifest bump. That was wrong. `NODE_ID` feeds `Identifier.derive()`, so renaming
> changes the node's FROST identifier and **destroys its ability to sign for every existing agent.**
> On this rebuild it is free because every node is born with its final name. Post-launch it is not a
> rename — it is a decommission plus an enrollment. Pick the names now and never change them.

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
boundary — **one project, many regions** is correct and sidesteps the billing concern entirely.

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

## 11. The plan — GCP standalone first, then bring AWS back in

**Andre's sequencing is better than my earlier two-wave order, and replaces it.** Build the entire
system on GCP with *no* AWS component so it can be tested as a self-contained whole; then add the
AWS directory/relay pair; then tear down what remains on AWS. The advantage is that every
cross-cloud problem is deferred until after there is a known-good, fully testable system — instead
of debugging a VPN and a fresh consortium at the same time.

### Wave 0 — capability

Nothing ships if this is missing.

1. Decide and create the project (§8). Enable only the APIs needed.
2. **Check per-region quotas early.** Young GCP projects default to low per-region CPU and
   static-IP quotas, and each region is a separate grant with lead time. Most likely schedule
   surprise in the plan.
3. Cloud Build + Artifact Registry pipeline for the directory and relay images. This is urgent
   independently of the nodes — see §9, CI/CD is the real critical path.
4. Pick regions. Note the design constraint: **one node = one region**, and with T−1 = 1 directory
   needed to seal at N=3, latency between them is not on the critical path for a single seal.

### Wave 1 — a complete CELLO on GCP, standalone

The goal is a system that works end to end with AWS switched off entirely, so it can be tested in
isolation. Temporarily this means **all three directories on GCP** (N=3, no AWS member yet).

5. Relays: per region one VM, static IP, persistent disk for `WAL_DIR`, two secrets, firewall rule.
   No code changes — the relay has no AWS SDK and no database.
6. Directories: the four adapters (Secret Manager, GCS ×2, Parameter Manager only if the
   empty-registry test in §12 fails); Cloud SQL Postgres 18 per node, **no HA** (HA instances
   cannot be logical-replication subscribers); the configurable-multiaddr fix at
   `directory.ts:1095`.
7. Replication: generalise `setup-replication.sh` off its three hardwired regions. Intra-GCP only
   at this stage — native VPC, no VPN.
8. Move the non-node workloads to GCP: **ops-agent, portal, waitlist**. The blocker is email —
   GCP has no first-party sending service and blocks outbound port 25, so plan on calling the
   **SES API over HTTPS** from GCP (pennies, and AWS is not going away anyway since we keep a node
   there). Do not plan self-hosted SMTP from GCE.
9. Sign a fresh manifest with `<cloud>-<region>` nodeIds (§7 — and per §4 these names are
   permanent, so choose them deliberately).
10. **Full end-to-end test with AWS off.** Register from scratch, seal, run a live two-agent
    session, verify replication convergence, kill a directory and confirm sealing continues
    (T−1 = 1 at N=3, so two can be down), confirm client failover.

### Wave 2 — bring AWS back as a consortium member

11. Stand up the us-east-1 directory + relay pair fresh (no data to migrate).
12. **One HA VPN**, us-east-1 ↔ the global GCP VPC with `--bgp-routing-mode=global` (§5). Verify
    Cloud SQL private-IP reachability explicitly — the Private Service Access custom-route-export
    trap in §5 is the likely failure and it fails silently.
13. Re-sign the manifest so the AWS node replaces one GCP node, landing on **N=3: 1 AWS + 2 GCP**.
    Clients adopt by poll — no republish.
14. **Prove the launch claim.** With GCP directories unreachable, confirm an existing agent can
    still seal via the AWS node. Per §5 this works at N=3 and only at N=3 with one AWS node — and
    confirm the honest boundary too: sealing survives, new registration does not.
15. Decommission eu-central-1, ap-northeast-1, and any GCP node displaced in step 13.

### Later

16. Grow to N=5 (2 AWS + 3 GCP) once **enrollment** ships (§4), since until then node growth only
    benefits newly-registered agents.

## 12. What I could not verify

- **Whether the directory boots usefully with an empty node registry.** Decides whether the
  Parameter Manager adapter is needed at all. Cheap to test locally; not tested.
- **Per-region GCP quota headroom** across the chosen regions — directories *and* relays, so more
  regions than the directory count alone. Flagged in §11 as the likeliest schedule surprise.
- **Cross-cloud replication lag under real write load.** Today's intra-AWS lag is 1112 bytes,
  which tells us nothing about a GCP↔AWS tunnel.
- **Whether the client's `/bootstrap` path handles an `https://` manifest endpoint** — all three
  current entries are `http://`.
- **Actual spend and remaining credits** (§10).
- **Why `directory_nodes` holds only one row** (§5).

---

## 13. Open decisions

1. **N=3 (1 AWS + 2 GCP)** — confirm. §5's arithmetic is the reason: one AWS directory backs the
   "GCP down, CELLO up" claim *only* at N=3. N=5 would need two AWS directories, which works
   against the credit pressure. Avoid N=4 entirely (§4).
2. **Enrollment** — is it in scope before launch? It is what makes node growth benefit existing
   agents (§4). Not needed for N=3 at launch; needed before N grows. The directory half already
   exists; the client half does not.
3. **Project ID** — attempt `cello-infra`, or accept the immutable `claude-code-vertex-mygentic`?
4. **Node shape** — single VM with static IP (cheap, sound at T-of-N), or shared ALB per region as
   Andre suggested? These are mutually exclusive (§5); my recommendation is the single VM, but the
   shared-ALB model is the closer analogue of what runs today.
5. **Email** — SES API over HTTPS from GCP is the only workable option I found for the ops-agent
   and waitlist (§9). Confirm that is acceptable, since it means AWS is permanently in the path for
   email.
6. **Waitlist** — leave on AWS for now? It shipped today and is still moving; moving it in Wave 1
   step 8 may be premature.

## 14. One documentation correction found along the way

`.claude/CLAUDE.md`'s **Database** section states that the six M7 session tables "join on
`agent_name`" and calls this "a known defect (`DOD-AGENT-ID-JOINKEY-1`)". That is **out of date** —
the DoD records it as `✅ BUILT + REVIEWED + SHIPPED` (cello-client `173d34f`, `daemon@0.0.45`),
live-proven 2026-07-11 on Andre's real database, re-keying 11 agents / 133 sessions, with a
seventh table (`retry_queue`) found and fixed in the same pass.

The *rule* that section teaches — join on the stable primary key, never a mutable attribute — is
still exactly right and worth keeping. Only the factual claim about current state is stale, and
since CLAUDE.md loads every session it is actively telling agents a fixed defect is live. Worth a
small edit; not part of this plan.
