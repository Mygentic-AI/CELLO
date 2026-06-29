---
name: M8 Blocked Items — Cross-Node / Federation Handoff
type: handoff
date: 2026-06-29
milestone: M8
status: open
topics: [m8, cross-node, federation, presence, replication, t-of-n, pickup-queue, e2e, handoff]
description: >
  M8 (the operator portal) is built, deployed, and operator-verified single-region. Four DoD lines
  remain open, and ALL FOUR are the same class of problem: they are FEDERATION / multi-node-cluster
  properties, not portal or directory-seam work. M8 cannot close them on its own — they belong to the
  cross-node / cluster / T-of-N effort running in the other session. This document explains each one:
  what it is, the nature of the problem, why it's blocked, and what would unblock it. Written to be
  shared with that session.
---

# M8 Blocked Items — Cross-Node / Federation Handoff

## TL;DR

The M8 operator portal is **done and live**: deployed to AWS (`https://portal.cello.mygentic.ai`),
operator-verified end-to-end (magic-link login, agents appearing from the live directory, passkey,
the four-class trust scaffold, and a real federation-wide burn). The directory's M8 seam
(read/write/presence/lever/trust) is merged and deployed in all three regions.

**Four DoD lines remain open. None of them is portal work, and none is solo-buildable inside M8.**
They are all the *same underlying gap*: the system works **single-region**, but the **federated,
multi-node** behaviour is either (a) not replicated across the sovereign nodes, or (b) running on a
2-of-2 stopgap instead of the real threshold protocol. Those are exactly the things the other session
owns. This is the handoff.

| # | DoD line(s) | The one-line problem | Blocked on |
|---|---|---|---|
| 1 | PRES-2/3, READ-2 (served) | Mutable presence isn't replicated → agents owned by another region read **offline** | A design decision (replicate vs node-local) **+** a live ≥2-node test |
| 2 | TRUST-1 (H2) | The WebAuthn trust-signal **ciphertext** is node-pinned → undelivered when the daemon is on a different node | A cluster-coupled migration (pickup_queue → UUID + `cello_pub`) **+** sweep-gating |
| 3 | INV-6, LEVER-3 | "Suspend/burn blocks signing" is enforced by a **2-of-2 stopgap**, not a real T-of-N threshold | The **unbuilt T-of-N protocol** (its own milestone, cross-repo) |
| 4 | E2E-1 | The automated full-gate has only run **locally / single-region** | Items 1–3 **+** a ceremony-registered account + harness pointed at the live cluster |

The common root: **#1 and #2 are "replicate per-node state across sovereign nodes" problems; #3 is the
"make the federation actually T-of-N" problem; #4 is "prove all of it against the live 3-region
cluster."** All federation-layer.

---

## 1. Cross-node presence — agents owned by another region read OFFLINE

**DoD:** DOD-PRES-2 (node-liveness guard, from-any-node), DOD-PRES-3 (sovereign write-ownership,
≥2-node), and the *served* aspect of DOD-READ-2 (presence read rule from any node).

**What it is.** Each agent has a presence row (`agent_presence`, migration V33) written by its
**owning** directory node on connect/disconnect. The portal renders an online/offline dot from it.

**Nature of the problem (verified in code).**
- `agent_presence` is **mutable** (one row per agent, flipped on connect/disconnect) and was
  **deliberately excluded** from the logical-replication publication `cello_pub`
  (`infra/setup-replication.sh` `PUBLICATION_TABLES`). `directory_nodes` (which holds
  `last_heartbeat_at`, used by the "owning node fresh" check) is **also not** replicated.
- The read (`listAccountAgentsWithPresence`) does
  `… LEFT JOIN agent_presence ap … LEFT JOIN directory_nodes dn ON dn.node_id = ap.owning_node_id …`
  and computes `online = COALESCE(ap.online AND dn.last_heartbeat_at > fresh, false)`. On a node that
  does **not** own the agent, `ap.*` and `dn.*` are absent → the COALESCE yields **offline**.
- The portal is pinned to **one** node (`DIRECTORY_API_URL = directory-us1.cello.mygentic.ai`). So
  presence is correct only for **us-east-1-owned** agents; agents owned by eu-central-1 / ap-northeast-1
  read offline even when they're online.

**Why it's blocked.** This is a genuine **architectural decision that touches the sovereign-node
invariant** — not something to resolve unilaterally. The options:
1. **Replicate `agent_presence` (+ `directory_nodes`) into `cello_pub`.** Matches the DoD/journey
   intent ("a new replicated agent_presence table"). Sovereign write-ownership is *preserved* — only
   the owning node writes; other nodes read the replicated copy. Precedent: `agent_suspensions` is
   already mutable + replicated + sovereign-write. And `agent_presence`'s PK is a **natural key**
   (`k_local_pubkey`), so unlike `pickup_queue` there's **no BIGSERIAL-stagger problem** — it
   replicates cleanly. **(Recommended.)**
2. Keep presence node-local; the read forwards to the owning node when queried elsewhere (adds latency
   + availability coupling — fights "read from any node").
3. Node-pin agents (no failover) — an architectural pivot away from "any node serves any agent."

**What unblocks it.** Andre's pick of option (likely 1), then add the tables to `cello_pub`, confirm
REPLICA IDENTITY (the PK) for UPDATE replication, run `setup-replication.sh`, and the live ≥2-node
test (agent online on node A reads online from node B) closes PRES-2/3 + the served half of READ-2.

**Full analysis + recommendation:** `discussion_logs/2026-06-28_2030_m8-cross-node-presence-replication-fork.md`.

---

## 2. TRUST-1 H2 — the trust-signal ciphertext is node-pinned

**DoD:** DOD-TRUST-1 (the WebAuthn-signal pipe, "hash + ciphertext readable from a different node").

**What it is.** Enrolling WebAuthn writes two things to the directory: a **hash** to
`identity_tree_entries` and a **sealed ciphertext** to `pickup_queue`. The agent's daemon drains the
pickup queue on reconnect, `openSealed`s with `k_local`, verifies the hash, stores, and ACKs.

**Nature of the problem (code-review finding H2).**
- `identity_tree_entries` **is** in `cello_pub` (the hash anchor replicates — "readable from a
  different node" holds for the hash). But `pickup_queue` is **not** replicated.
- The daemon drains only from the node its per-agent stream is currently on. In the live 3-region
  federation the daemon connects to / fails over to **any** node — so the ciphertext (written to one
  node by the portal) may sit on a **different** node than the daemon → **never delivered**. AC-001's
  "readable from a different node" therefore fails for the **ciphertext**.
- `pickup_queue` was excluded because its `BIGSERIAL` id would **collide** across nodes under
  replication. A documented per-node `ALTER SEQUENCE … INCREMENT BY 3 RESTART WITH {offset}` stagger
  was proposed but **never implemented** (no code applies an offset; Flyway runs identical SQL on
  every node).

**Why it's blocked.** It needs a cluster-coupled schema + replication change that only matters /
is verifiable on the live ≥2-node cluster — exactly the federation work.

**What unblocks it (recommended direction).**
- Change `pickup_queue.id` to a **UUID** (replicates with zero per-node coordination, matching the
  natural keys of `agent_suspensions` / `identity_tree_entries`), then add `pickup_queue` to `cello_pub`.
  The ack-DELETE then replicates and cleans every node.
- **Also required (fallback-finder):** the orphan-pickup backstop sweep (`sweepUndeliverablePickups`)
  is safe **only** while `pickup_queue` is node-local — it deletes anchor-less rows per-node against
  the replicated identity tree. Once `pickup_queue` joins `cello_pub`, a node with an **unconverged**
  identity-tree replica could delete a deliverable ciphertext and replicate the delete. The sweep MUST
  be gated to the **owning node** (or add a convergence check) before publishing `pickup_queue`. The
  in-code comment on `sweepUndeliverablePickups` carries this as a blocking note.
- Note (already verified): the pickup **id is already an opaque string** in JS (`SELECT id::text`,
  `ackPickupDelete(id: string)`), so bigint→UUID is **transparent** to the daemon/client — no
  cello-client change. This is directory-only + a migration.

A local intra-instance logical-replication harness was tried and **rejected as too flaky** (slot
creation blocks on concurrent open txns) — see the M8 build journal. So this is verifiable only on the
live cluster.

---

## 3. Strict T-of-N — suspend/burn is enforced by a 2-of-2 stopgap, not a threshold

**DoD:** DOD-INV-6 (suspend is T-of-N server-side, not 2-of-2), DOD-LEVER-3 (T-of-N mechanism + a
single node continuing doesn't let it sign).

**What it is.** The security invariant: a suspended/burned agent cannot sign **even with a valid
client share**, because the **honest-node threshold refuses** — *not* because one mandatory node
withholds. The federation must survive node outages (no single node is required to sign) yet refuse
when a threshold of nodes honor a revocation.

**Nature of the problem.** The **current daemon path is a documented 2-of-2 stopgap** (client + one
node). The honor-check mechanism *is* T-of-N-correct in shape — each node independently consults its
own replicated `agent_suspensions` and refuses its FROST share — and J-SUSPEND proves a real
cross-process refusal. But the explicit distinction **"a single node continuing to offer its share
does NOT let it sign"** (the anti-2-of-2 proof) **cannot be demonstrated** without ≥3 real nodes and
the real threshold-signing protocol. With a 2-of-2 path you can't tell threshold-refusal from
single-node-refusal.

**Why it's blocked.** FROST (RFC 9591) is T-of-N capable, but the **implementation is 2-of-2**.
Building real T-of-N — DKG across N sovereign nodes, threshold signing, share distribution/refresh —
is a **substantial protocol effort spanning crypto + client + directory**, i.e. **its own milestone**,
not an M8 fix. This is the heaviest of the four and is squarely the other session's domain (the
federation/threshold work).

**What unblocks it.** The T-of-N protocol shipped + a ≥3-node cluster; then INV-6 / LEVER-3 can prove
"continue with one node → still can't sign."

Background: `[[project_threshold_t_of_n_not_2_of_2]]` (the 2-of-2 is a known transient stopgap, not the
design), `[[project_sovereign_nodes]]`.

---

## 4. Automated CELLO-M8-E2E-001 gate against the live cluster

**DoD:** DOD-E2E-1 (the full milestone gate, green end-to-end against the served portal + the **live
directory cluster**).

**What it is.** The automated E2E gate driving: ceremony-gated magic-link login, WebAuthn flowing a
signal **through the pipe to a daemon**, agents with presence, suspend **blocking signing**, the
four-class scaffold, and the no-plaintext audit — green against the **live 3-region cluster**.

**Nature of the problem / what's already proven.**
- The **local** close gate is green: `test:e2e:real-dir` → **42/3** against a real (local) directory.
- The portal is **deployed** and **operator-verified live** (login, agents, passkey, burn).
- What is **not** done: the **automated** gate run against the **live cluster**, and specifically the
  three dimensions that are themselves items 1–3 above — presence from any node (#1), the signal
  reaching a daemon cross-node (#2), and suspend blocking a *real* signing ceremony under T-of-N (#3).

**Why it's blocked.** It transitively depends on items 1–3, plus it needs a **ceremony-registered
account** (the directory is ceremony-gated; there's no account-creation path) and the harness pointed
at the live cluster. Today's live proof was manual/operator-driven, not the harness.

**What unblocks it.** Items 1–3 resolved + a ceremony account + wiring the E2E harness at the live
cluster.

---

## What M8 can / cannot do here

- **M8 already did** everything portal-side and directory-seam-side: the portal (deployed + verified),
  the directory read/write/presence/lever/trust seam (merged + deployed 3-region), the single-region
  served close gate (42/3), and the cross-node *data-layer* proof (writes to `agent_suspensions` /
  `identity_tree_entries` on one region read back on another — replication is live for the append-only
  tables).
- **M8 cannot** close items 1–4 because they are federation-layer: replicating mutable per-node state
  (#1, #2), building the threshold protocol (#3), and proving the whole thing on the live cluster (#4).

## Suggested order for the other session

1. **Decide presence (#1)** — it's the smallest and has a clear recommendation; replicating
   `agent_presence` + `directory_nodes` is the same `cello_pub` machinery you're already running.
2. **Pair TRUST-1 H2 (#2) with it** — one deliberate cluster-coupled replication change (pickup_queue →
   UUID + `cello_pub` + owning-node sweep gate), since it's the same topology edit.
3. **T-of-N (#3)** — the big protocol milestone; everything else can land before it.
4. **Automated E2E-001 (#4)** — once 1–3 are live, point the harness at the cluster with a ceremony
   account.

Related: the cross-node presence fork
(`discussion_logs/2026-06-28_2030_m8-cross-node-presence-replication-fork.md`), `M8-DEFINITION-OF-DONE.md`
(the DoD lines above, with their current 🟡 notes), and the M8 build-journal cross-node entries.
