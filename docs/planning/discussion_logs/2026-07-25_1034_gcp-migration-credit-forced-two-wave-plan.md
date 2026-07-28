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
status: superseded
---

# GCP migration — credit-forced two-wave plan

> **Superseded by [[2026-07-28_0700_gcp-rebuild-decision-record|the 2026-07-28 decision record]].**
> Decisions made after this log was written reverse several of its recommendations: the Postgres
> mesh is retired in favour of libp2p anti-entropy built in the rebuild (no VPN/PSA at all), the
> single-VM/self-hosted-Postgres shape is dropped for MIG + Cloud SQL, the full-node/validator
> role split is in scope, and the quota warning was disproven by live gcloud checks. This log
> remains the record of the derivations and alternatives considered.

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

### T−1 is also the kill switch's strength — the factor that decides the policy

Asked for a final recommendation on T, I went looking for what actually constrains it, and it is
not availability. It is the **kill switch**, which CLAUDE.md names as launch value ("*a kill switch
is in place*").

`directory-node.ts:1176` — the pause/revocation mechanism is: *"each honest node consults the
REPLICATED suspension state and refuses its FROST share for a PAUSED agent, so no threshold
forms."* It fails **closed**. But the code also names the gap outright: *"single-node honoring
means a genuinely-paused agent can still reach threshold by **routing around** the one honoring
node."*

So revocation is arithmetic, and it is the **same** arithmetic as sealing, read from the other
side. An agent keeps signing while `willing directories ≥ T−1`. Therefore a pause only bites when
`honoring ≥ N − T + 2`:

| N | T | Dirs to seal (T−1) | Dirs that must honor a pause for it to work |
|---|---|---|---|
| **3** | 2 | 1 | **3 of 3 — unanimity** |
| 4 | 3 | 2 | 3 of 4 |
| **5** | 3 | 2 | **4 of 5** |
| 7 | 4 | 3 | 5 of 7 |
| 10 | 6 | 5 | 6 of 10 |
| *10 (if T were 3)* | *3* | *2* | *3 of 10* ← |

**`T−1` is one knob serving two opposed masters.** It is simultaneously *how few directories must
cooperate to seal* (availability — smaller is better) and *how many must be subverted or stale to
defeat a revocation* (safety — larger is better). Every threshold argument is really about where to
sit on that one axis.

Two honest qualifications, so this is not overstated:

- **A node that is *down* does not defeat a pause** — it cannot sign either. The kill switch is
  defeated only by a node that is up, reachable, holding the share, and carrying stale or missing
  suspension state. `agent_profiles` and `agent_suspensions` are both replicated
  (`setup-replication.sh:169`) and current lag is ~1 KB (§5), so all-nodes-honoring is the normal
  case, not a lucky one.
- **N=3's unanimity requirement is therefore a thin margin rather than a live defect.** But it is a
  margin of exactly zero: one up-but-stale directory and a paused agent still signs.

### Final recommendation on T

**Keep `T = majority(N)`. Do not decouple T from N.** Three reasons, in order of weight:

1. **It is the only rule where kill-switch strength grows with the consortium.** Under majority,
   `T−1` rises as N rises, so more nodes must be subverted to route around a revocation. Under a
   fixed small T, adding directories actively *weakens* the kill switch — more nodes, each less
   necessary.
2. **It is the minimum threshold with no two disjoint signing quorums** (§4).
3. It is implemented, settled in writing (2026-07-04), and exercised in production. Changing it is
   a security change with migration consequences, not a config edit.

**On N=10 with T=3–5 specifically: recommend against.** The bottom row above is the reason — at
N=10/T=3, just **3 of 10** nodes with stale state keep a paused agent signing, and 3 colluding
operators could forge. For a trust product that is the wrong direction on the one axis that
matters. Note also that it *reduces* the honoring requirement below what N=3 gives today.

**The strategy that satisfies the goal behind that idea:** *directories stay few and odd; relays
scale freely.* Relays have no FROST, no DKG, and no shares — they are where "quite a few nodes"
belongs, and adding them costs nothing on the threshold axis. Wanting many nodes is right; wanting
many *directories* is what carries the cost.

### Is redundancy double-edged? Not on the security axis — and that is the point of majority

Andre's question: doesn't wanting many directories come from wanting redundancy *and* security, and
isn't that a double-edged sword for FROST ceremonies?

**Under `T = majority(N)`, no — and this is exactly why the rule is right.** Every security property
improves together as N grows:

| N | T | Seal needs (T−1) | Dirs that can be down | Stale nodes a pause tolerates (T−2) | Operators needed to forge (T) |
|---|---|---|---|---|---|
| 3 | 2 | 1 | 2 | **0** | 2 |
| 5 | 3 | 2 | 3 | **1** | 3 |
| 7 | 4 | 3 | 4 | **2** | 4 |
| 9 | 5 | 4 | 5 | **3** | 5 |

Availability rises, kill-switch margin rises, collusion resistance rises. Majority is the rule that
makes redundancy *not* a trade — because T scales with N, adding a node buys more failure tolerance
**and** more forgery resistance at the same time.

**The double-edge only exists if you decouple T from N** — precisely what N=10/T=3 would do. Then
you are buying availability by selling security. So the tension is real, but it is one the operator
*creates* by fixing T; it is not inherent to redundancy.

### What actually bounds directory count — and it is not the threshold

The real cost of more directories is not security. It is two things, and the first is a hard wall I
verified on the running database rather than inferred:

**1. Replication is O(N²) and hits a live ceiling at N=5.** The mesh is full — every node subscribes
to every other — so each node runs **N−1 apply workers** and each publisher holds **N−1 slots**.
Actual settings on the live us-east-1 instance:

```
max_logical_replication_workers = 4     ← the binding constraint
max_replication_slots           = 10
max_wal_senders                 = 25
max_worker_processes            = 8
max_connections                 = 191
```

- **N=5 sits exactly at the cap** (4 subscriptions → 4 apply workers).
- **N=6 exceeds it** — a subscription that cannot get an apply worker simply does not replicate.
- `max_replication_slots = 10` independently caps the consortium at **N ≤ 11**.
- Total slots across the consortium = N(N−1): **6** at N=3, **20** at N=5, **42** at N=7, **90** at
  N=10.

All three are *static* parameters requiring a reboot, and raising
`max_logical_replication_workers` also means raising `max_worker_processes` (currently 8, shared
with autovacuum and parallel query). **The failure mode is silent** — no error at the threshold
layer, just a node that quietly stops converging. STATE.md records a prior wedge on
ap-northeast-1 that produced thousands of apply-errors, so this class of failure has bitten once
already.

**At current settings this bounds directory count well below what the threshold math implies** —
reasoning only from `majority(N)` you would conclude N=9 is fine, while the running database stops
at N=5. But these are tunables, not architecture: see the correction and the topology alternatives
immediately below.

**2. The enrollment debt.** Adding a directory gives *existing* agents exactly zero extra
redundancy until enrollment ships (§4) — shares are never replicated, so a new node holds nothing
for them. "More directories = more redundancy" is currently true **only for newly-registered
agents**. And the M8B design doc notes that at large N enrollment becomes *"the normal path, not an
edge case"* — so growing N makes unbuilt machinery load-bearing.

### Correction: N=5 is a parameter default, not an architectural wall

Andre pushed back: are these self-imposed limits, just because we chose a mesh? **Largely yes, and
I overstated the ceiling.**

`max_logical_replication_workers = 4` is a *tunable*, not a property of logical replication. Raising
it (together with `max_worker_processes`, currently 8, since the workers come from that pool) moves
the ceiling to roughly N=30 on the worker axis; `max_replication_slots` and `max_wal_senders` raise
the same way. All are static parameters — a parameter-group change plus a reboot per node.

So calling N=5 a "wall" was too strong. The honest statement: **N=5 is where the *current
configuration* stops working, and the mesh's O(N²) subscription growth is a cost curve, not a
cliff.** For any realistic directory count, raising the parameters is the answer.

One thing that *looks* like an N-coupling and is not, checked so nobody re-investigates: the
replicated `BIGSERIAL` sequences are staggered with `SEQ_INCREMENT=1000`
(`setup-replication.sh:177`), giving headroom for 1000 nodes. The `V34` header comment saying
"INCREMENT BY 3" is stale — the script disagrees with it, and the script is what runs. Adding a node
needs only a new `NODE_SEQ_OFFSET` entry.

### Are there better replication topologies? Yes — evaluated against sovereignty

The mesh is a choice. The alternatives are worth naming explicitly, because two of them are
tempting and wrong for *this* system specifically:

| Approach | Subscriptions | Verdict |
|---|---|---|
| **Full mesh** (today) | N(N−1) | Works, no privileged node. Quadratic. |
| **Raise the parameters** | unchanged | ✅ **Near-term answer** — hours of work |
| Hub-and-spoke | O(N) | ❌ Creates a **privileged node**; hub loss partitions replication |
| Ring / chain | O(N) | ❌ O(N) propagation latency; any single break partitions |
| Managed distributed SQL | 0 | ❌ **Sovereignty violation** — see below |
| **App-level anti-entropy over libp2p** | O(N) gossip | ⭐ Right long-term; dissolves the VPN too |

**Managed distributed SQL deserves an explicit rejection**, because it is the answer any general
cloud-architecture instinct reaches for. Spanner, CockroachDB, YugabyteDB, AlloyDB multi-region,
Aurora Global — they solve multi-region replication properly and would delete this entire problem.
They are wrong here: **one logical database means one operator and one control plane.** Sovereign
nodes must be independently operable, and "no single node can complete a ceremony alone" becomes
meaningless if every node reads and writes the same managed cluster. Spanner additionally pins us
to Google, which defeats the multi-cloud point we are keeping an AWS directory for. Reject — but
consciously, not by omission.

**Hub-and-spoke fails for the same class of reason:** it re-introduces a special node, which is the
thing the architecture exists to avoid.

### The interesting option: anti-entropy over libp2p

This is the one worth keeping on the roadmap, and several pieces already exist:

- **Most replicated tables are append-only and hash-chained** — exactly the shape anti-entropy
  suits. Nodes exchange Merkle roots, find divergence, pull deltas.
- **The Merkle primitive is already built** — `V5__mmr_tables.sql`, `directory_checkpoints`,
  `checkpoint_node_signatures` exist for tamper-evidence, and a checkpoint root is precisely what
  cheap divergence detection needs.
- **Nodes already have authenticated libp2p identities**, and the manifest already pins every
  node's public key.
- **It eliminates the cross-cloud VPN outright** — nodes would sync over the public internet with
  their existing authenticated transport, which is the single biggest structural win for a
  multi-cloud consortium. No PSA route-export trap, no BGP, no CIDR planning.
- It scales O(N) per node with gossip fanout, and drops the slot/worker/sequence machinery entirely.

Honest costs: it is a real build, not a config change. The **mutable** tables
(`agent_suspensions`, `agent_presence`, `primary_holder`) are not append-only and need explicit
conflict resolution — and `agent_suspensions` is the kill switch, so its convergence semantics are
security-critical, not best-effort. It would also introduce the **first directory↔directory
channel** in the system (CLAUDE.md: *"CELLO has no cross-node RPC/consensus anywhere"*), which is a
genuine architectural addition with its own attack surface.

**Recommendation: raise the parameters for launch, keep the mesh, and put libp2p anti-entropy on
the post-launch roadmap** — promoted to the top of it if the cross-cloud VPN proves as painful in
practice as it looks on paper, since it makes the VPN unnecessary rather than easier.

### So what is the actual GCP↔AWS replication solution?

The link has to be **bidirectional** — the AWS node both publishes to and subscribes from the GCP
nodes. Three ways to get there.

**Why the obvious one is fiddlier than it looks.** VPN + Cloud SQL private IP *is* supported, but
Cloud SQL private IP lives in a Google-managed producer network attached by **Private Services
Access**, which is a VPC peering — and **VPC peering is not transitive**. Google's docs are explicit:
*"By default, on-premises hosts can't reach the service producer's network by using private services
access."* Making it work needs four separate things, each of which fails **silently**:

1. Export custom routes on the `servicenetworking` peering, so Cloud SQL learns the route back to AWS.
2. Terminate the VPN in the **same** VPC as the private connection (no transitive hop).
3. Configure Cloud Router custom advertisement of the PSA allocated range, so AWS learns the route
   *to* Cloud SQL.
4. Explicitly export any non-RFC 1918 ranges — Cloud SQL does not learn them by default.

Four config steps, no error when one is missing, just a subscription that never replicates. On a
consortium of three that is a bad ratio of ceremony to benefit.

**The recommendation: drop Cloud SQL and run Postgres on the node VM.**

This dissolves the problem rather than configuring around it, and it composes with the single-VM
node shape already recommended in §6:

- **PSA disappears entirely.** A VM's private IP is an ordinary VPC route — directly reachable over
  the VPN with no peering, no transitivity, no custom route export. Four silent failure points
  become zero.
- **The Cloud SQL HA-subscriber restriction disappears** too (§5: HA instances cannot be logical
  replication subscribers, which would have constrained production).
- **It is markedly cheaper** — no managed instance per node, on top of the LB/NAT savings in §6.
- **It makes a node a portable artifact.** This is the part that matters beyond cost: if a node
  requires Cloud SQL, then "run a CELLO directory" means "have a GCP account." One VM with Postgres
  runs identically on AWS, GCP, Azure, or bare metal. For a protocol that wants third-party
  operators, requiring a specific managed database is exactly the lock-in the sovereignty invariant
  exists to prevent. Nothing in the code wants Cloud SQL — the directory takes a `pg` connection
  string.

The cost is managed backups and patching. Backups are a `pg_dump` to object storage on a timer —
and worth actually doing, because a node's **shares are not replicated** (§2), so its database is
the only copy of them. At N=3/T=2 losing one node's shares is survivable, but it is not free.

**For symmetry, do the same on AWS** — Postgres on the EC2 node rather than RDS. On a rebuild the
symmetry is free, and it makes every node the same artifact.

**Then the tunnel is the only question left, and it gets simpler.** With Postgres on VMs, any
IP-level link works. Two options:

- **Cloud VPN ↔ AWS Site-to-Site** — managed, ~2 tunnels for the SLA, fine for one AWS node. But it
  does not generalise: pairwise cloud VPN gateways do not scale to nodes on three providers plus
  bare metal.
- **A WireGuard overlay between the node VMs** — provider-agnostic, cheap, and the same
  configuration everywhere. It is the option that still works when the fourth node is on Azure and
  the fifth is in somebody's rack.

For N=3 with a single AWS node, either is defensible; **Cloud VPN is the lower-effort launch
choice, WireGuard is the one that matches where the architecture is going.** Both become
unnecessary if libp2p anti-entropy ever lands, which is the argument for not over-investing in
whichever is picked.

**Stopgap for early testing only:** Cloud SQL (or VM Postgres) with a public IP, TLS required, and
an authorized-networks allowlist of the AWS egress IPs. Acceptable to unblock Wave 1 testing;
**not** acceptable at launch, and never by making RDS publicly accessible — that puts the share
store on the internet, which is not a trade a trust product should make.

### What "one VM" actually means — the node artifact, concretely

To be unambiguous, since "single-VM node" is easy to read as "one container for everything":
**one VM per node, running several containers.** Not one container.

**A directory node = one VM:**

| Container | What it is | Notes |
|---|---|---|
| `cello-directory` | **The existing image, unchanged** | Only its env differs — `DATABASE_URL` points at the sibling Postgres instead of RDS |
| `postgres:18` | The node's own database | Data on an attached persistent disk, **not** the boot disk |
| `caddy` *(optional)* | TLS termination → ports 8080 / 9090 / 8081 | Replaces the ALB's only real job. See the TLS note below |

Managed with Docker Compose or three systemd units. Ports stay exactly as they are today — 8080
libp2p WS, 8081 internal API, 9090 health — so nothing about the application changes.

**Emphatically not one container.** Putting Postgres and the directory in a single container couples
their lifecycles: you cannot restart the app without bouncing the database, the data volume gets
tangled with the image, and a crash-loop in one takes out the other. Two containers on one host is
the right granularity; one container running two processes is not.

**Do we still need TLS?** Less than it appears. The libp2p stream is **Noise-encrypted end to end**
(`noise()` at `core/transport/src/node.ts:503`), so plain `ws://` is *not* plaintext on the wire —
which is why the current ALB has been serving plain HTTP:80 without that being a confidentiality
bug. Caddy is therefore optional and worth adding for three non-security reasons: it removes the
"why is your endpoint `http://`?" question from anyone evaluating a trust product, it gets through
corporate proxies that block non-443 traffic, and it lets the advertised multiaddr be
`/tcp/443/wss` (which needs the `directory.ts:1095` fix either way).

**Sizing.** Today the directory runs in 0.25 vCPU / 512 MB of Fargate and the database is a
`db.t3.small`. One `e2-medium` (2 vCPU / 4 GB) holds both comfortably at any plausible launch load —
recall the entire production system currently has **five agents**.

**Relays get their own VMs.** They are meant to be numerous and directories few, so keeping them
separate preserves independent failure and lets relay count grow without touching directories. At
launch scale co-locating one relay with one directory would work, but it saves little and couples
two things the architecture wants uncoupled.

**Operational consequences to accept deliberately:**

- **A VM loss takes the node *and* its shares.** This is the strongest argument for the `pg_dump`
  timer — shares are not replicated, so that disk is their only copy.
- **No in-node rolling deploy.** A deploy restarts the node. That is fine at N=3/T=2 where one
  directory suffices to seal (§4) — but it makes **sequential, never simultaneous** deploys a hard
  rule. Today's three-region parallel deploy would have to become one-at-a-time.
- **Resource contention** between Postgres and the directory on one host. Irrelevant at five
  agents; the trigger to split them back out is a node whose database outgrows the VM, or wanting
  managed point-in-time recovery.

None of this changes the container image, the ports, or the application code. It changes where the
container runs and what it points at.

### Narrowing what replicates is a separate, cheaper lever

Worth noting because it is often confused with the topology question: the publication covers **21
tables** (`setup-replication.sh:169`). Only a couple are genuinely needed cross-node —
`agent_profiles` (so any node can serve a lookup) and `agent_suspensions` (so any node can honour a
pause). Trimming the set reduces WAL volume and apply load, but **does not change the topology** —
it is still N−1 subscriptions per node. It treats the constant, not the exponent.

### Why this strengthens "few directories, many relays"

The conclusion is unchanged but the reasoning is much better than threshold aesthetics:

- **Directories are bounded by replication topology** (quadratic, wall at N=5 today), not by the
  threshold rule.
- **Relays have no database, therefore no mesh** — the O(N²) term does not exist for them. They
  scale linearly and cleanly.

So the instinct "we want more nodes for redundancy" is right; it just belongs on the relay tier,
where redundancy is cheap, rather than the directory tier, where each addition costs N−1
subscriptions on every existing node.

### Recommended N by stage

| Stage | N | T | Dirs to seal | Dirs that can be down | Must honor a pause | AWS dirs for the outage claim |
|---|---|---|---|---|---|---|
| **Launch** | **3** | 2 | 1 | 2 | 3 of 3 | **1** |
| Post-enrollment | **5** | 3 | 2 | 3 | 4 of 5 | 2 |
| Scale | **7** | 4 | 3 | 4 | 5 of 7 | 3 |
| Large | 9 | 5 | 4 | 5 | 6 of 9 | 4 |

**Never even N** — it costs a node and a signature for no gain in tolerance (§4).

**And note the replication ceiling cuts across this table.** N=5 is the largest consortium the
current Postgres parameters support; N=7 and N=9 require raising
`max_logical_replication_workers` and `max_worker_processes` with a reboot on every node, and the
subscription count grows quadratically (42 slots at N=7, 72 at N=9). Treat the N=7 and N=9 rows as
"possible after a parameter change", not as drop-in options.

**N=3 at launch**, because it is the only shape where one AWS directory backs the GCP-outage claim
(§5), it is what runs in production today, and the credit pressure is the binding constraint. Its
one real weakness is the zero-margin kill switch — worth accepting for launch given healthy
replication, and worth fixing by moving to **N=5 as the first post-launch step**, once enrollment
(§4) makes growing N benefit existing agents. N=5 buys a kill switch that survives one stale node
and sealing that survives three outages, for one more AWS directory.

(You were right that seven was over-shot — it came from threshold aesthetics rather than need.)

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
   empty-registry test in §12 fails); **Postgres 18 on the node VM** rather than Cloud SQL (§5 —
   this removes Private Service Access, the four silent route-export failure points, and the
   HA-subscriber restriction); the configurable-multiaddr fix at `directory.ts:1095`. Add a
   `pg_dump`-to-object-storage timer, since a node's shares exist nowhere else.
7. Replication: generalise `setup-replication.sh` off its three hardwired regions, and raise
   `max_logical_replication_workers` / `max_worker_processes` off their defaults now rather than
   discovering the ceiling later (§4). Intra-GCP only at this stage — native VPC, no tunnel.
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
12. **One tunnel**, us-east-1 ↔ the global GCP VPC with `--bgp-routing-mode=global` — Cloud VPN
    for least effort, WireGuard if we want the setup that generalises past two providers (§5).
    With Postgres on VMs there is no PSA to route around, but still verify reachability
    end-to-end before creating subscriptions.
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
