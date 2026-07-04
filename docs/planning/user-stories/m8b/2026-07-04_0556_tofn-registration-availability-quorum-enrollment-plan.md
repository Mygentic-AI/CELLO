---
name: tofn-registration-availability-quorum-enrollment-plan
type: discussion
date: 2026-07-04
topics: [t-of-n, dkg, registration, availability, enrollment, frost, sovereign-nodes]
status: active
description: The registration availability gap (all-N, all-nodes-must-be-up) vs the intended quorum model, and a two-sprint fix plan (memory + quorum now; enrollment deferred). Includes the FROST identity finding and the seal signer-selection finding that gate the plan.
---

# T-of-N registration availability — quorum + enrollment fix plan

## The intent (rock-solid, restated by Andre)

- **N** nodes, threshold **T**, always **T < N**.
- Registration must work among a **subset** of N — it must **not** require any specific node, nor all N, to be up.
- A node that was down, or was up but didn't take part, must **eventually get what it needs** and be able to serve.
- Signing a seal always needs **≥ T distinct** share-holders cooperating (that's what T means). One share alone can't sign.

This is captured correctly in `2026-07-03_1618_tofn-registration-preauth-capability-design.md` (R5 availability, §9 quorum + enrollment).

## What actually shipped (the gap)

The §9 quorum/enrollment model was **specced then deferred**. Today's code:

1. Runs the DKG on **all N nodes at once**.
2. **Refuses** to register if any node is down (`dkg_below_threshold`).
3. Every node ends up holding a share directly (no propagation step).

That is the opposite of the intent. It was mislabeled "✅ SHIPPED + LIVE-VERIFIED" (§13) with the deferral reduced to one buried clause — the live test had all nodes up, so the node-down case was never exercised. **`2026-07-03_1618`... §13 must be corrected** from a green banner to "core availability property (quorum + enrollment) NOT built."

Signing/sealing redundancy (survive a node down *after* registration) does work. Only **registration** is all-must-be-up.

---

## The three problems

### Problem 1 — a participant can't serve the agent (memory gap). SMALL.
- **Coordinator node:** finishes ceremony → writes agent to DB → records it in memory → ✅ serves.
- **Participant node:** finishes ceremony → has share + identity in hand → records **nothing** in memory → ❌ can't serve until reboot.
- **Fix:** the round-3 handler, on every participant, records the agent in memory + writes its own identity row — it already holds `k_local_pubkey`, the group key (derived locally), and its share. No coordinator, no replication, no lazy DB read.
- **Sub-item:** a node that stayed up and received the agent's *identity* purely via DB replication needs a small "load what I'm missing" reconcile (identity is public and replicated; the share is not — see Problem 3).

### Problem 2 — registration demands ALL N. MEDIUM.
- **Today:** client resolves the full roster → any node down → refuses.
- **Fix:** client uses the nodes **available now**, requires **≥ T** of them, runs the DKG among those.
- **Folded-in requirement (from the seal-routing finding below):** record the **quorum that participated** as the agent's **share-holder set**, and make the seal coordinator select signers from **that set**, not the full roster. Without this, quorum registration makes sealing flaky.

### Problem 3 — an absent node never gets a share. BIGGER, new build (enrollment). DEFERRED.
- A share is a **secret**, unique to a slot, **never replicated** — a node only gets one by taking part in a ceremony. So an absent node has **no share** and can't be one of the T signers (it can still act as front door).
- **Fix (enrollment):** returning node presents a **signed "may-enroll" credential** → each existing holder **verifies it independently** → **≥ T holders run a resharing ceremony** → mint a fresh, correct share for that node's slot (group key unchanged) → node stores share + records agent in memory.

---

## Two findings that gate the plan

### Finding A — FROST binds a slot to a public label, not to node identity.
- The participant identifier is derived from a **public string** (`NODE_ID`/region/peer-id), never from the node's Ed25519 identity key. No contribution is signed against identity; the FROST stream has **no identity handshake** (the signaling stream does).
- **Consequence:** possession of a decrypted share **is** the authority. A stolen share works on any node — FROST has no identity check to fail.
- **What secures it today:** (1) shares staying secret — the real lock is **at-rest encryption** (a stolen DB row is ciphertext, useless without that node's key); (2) the **threshold** — forging needs **T distinct** shares = T separate compromises.
- **Implication for enrollment (Problem 3):** since the crypto won't check whether a node deserves a slot, the **enrollment authorization gate is the entire security boundary**. Reuse the pre-auth capability pattern: ops-agent signs "node X may hold a share for agent A," every holder verifies against the pinned issuer key.
- **Optional hardening (own item):** add the signaling stream's challenge/response to the **FROST stream**, and record **slot → node-identity** at DKG time, so a contribution for slot i is only accepted from the node proving slot-i's identity. Defense-in-depth; does not save you from a fully compromised node.

### Finding B — the seal coordinator does NOT route to share-holders.
- Seal signing is coordinated by the **client** (present party), which fans to a **fixed roster** (set at registration = full consortium) and picks the **first `T-1` reachable** — **no share query**.
- A node asked to sign for an agent it lacks returns `AGENT_NOT_BOOTSTRAPPED`; the coordinator **excludes it and retries with survivors** (no crash).
- **Net:** in a subset world, a seal *can* complete via exclusion-and-retry, but can also **exhaust its retry budget** on non-holders and fail. Today this never bites only because all-N ⇒ roster == holders.
- **This is why Problem 2 must record + target the share-holder set** (folded into Problem 2 above).

---

## The two sprints

### Sprint A (do now) — restore the availability property
1. **Problem 1** — record the agent in memory on every participant at round 3 (+ small reconcile for the replicated-identity sliver).
2. **Problem 2** — register among the available quorum (≥ T); **record the quorum as the share-holder set**; seal selects signers from that set.
3. **Definition of done = the node-down test.** Kill a node, then register; kill a (non-holder) node, then seal. The test that would have caught the original gap is the test that proves the fix.

Outcome: register with nodes down, and any node that took part can serve — the core intent, node-down-tolerant.

### Sprint B (deferred) — enrollment + optional identity hardening
1. **Problem 3** — enrollment: signed may-enroll credential (independently verified) → ≥ T holders reshare → new node gets its slot's share → grows coverage toward full N.
2. **Optional** — FROST-stream identity auth + slot→identity binding (Finding A hardening).

**Open decisions for Sprint B (decide before building):**
- What the enroll credential attests, and who signs it (default: ops-agent, mirroring registration).
- Trigger/discovery: how a returning node learns which agents it's missing shares for.

---

## Defer decision

**Safe to defer Problem 3 / Sprint B, provided Sprint A includes Finding B's fix** (seal targets the recorded share-holder set). Rationale: with that in, a quorum-registered agent is fully serviceable as long as ≥ T of its holders are reachable; enrollment only *grows* redundancy over time. Without it, quorum registration makes sealing unreliable, and deferral is not safe.

## Process rule (why this kept happening)

A redundancy feature is **not done until the node-down case is the test that proves it**. No green checkmarks on the happy path alone. The original milestone was marked done on an all-nodes-up run; the deferral was a footnote under a "shipped" banner.
