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

---

## Implementation log

### 2026-07-04 — Sprint A started (cron `f67c5cd6` driving, 30-min cadence)

**Problem 1 — spec ready, entry points located. Next: write the red test.**

The fix is bookkeeping, not crypto: on every DKG participant the round-3 handler must do what only the coordinator does today — register the in-memory signer and write the agent's identity row — using values it already holds at round 3.

- **Where the coordinator does it (to mirror onto every participant):** `#processRegisterRequest` calls `registerThresholdSigner` (directory-node.ts:2517) and `setProfile` (directory-node.ts:2595). Only the node that fields `register_request` runs this.
- **Where every participant already has the data:** the round-3 handler (directory-node.ts:~1471-1503) already parks the group key via `#pendingDkgCommitments.set(agentPubkey, shareCommitment)` (directory-node.ts:1489), and the share is stored in `frost-handler.ts` round3. So `k_local_pubkey = agentPubkey`, `primary_pubkey = shareCommitment` (the locally-derived group key), share already persisted — everything `setProfile`/`registerThresholdSigner` need.
- **The change:** in the round-3 handler, after the share is stored, also write the profile + register the in-memory signer (idempotent; the coordinator path can then no-op or stay as-is).
- **Reconcile sub-item:** a node that received the identity only via replication after boot — small "load missing active profiles" path. If non-trivial, land it as a separate follow-up within Sprint A (note here), don't expand scope.

**Red test to write first:** extend `src/__tests__/e2e-003-frost-handler-network.test.ts` (or `directory-node.test.ts`) — drive DKG rounds on a participant node that does NOT receive `register_request`; assert the agent appears in `#thresholdSigners` (`getThresholdSignerForTest`) and has a profile (`getProfile`) afterward. It should fail on current code. Extend the existing harness / `session-fixture.ts`; no from-scratch fixture.

**Refinement after reading the code (Problem 1 is even smaller than written):** a participant node
should register the **in-memory signer only** — NOT write a profile row.
- Reason: the coordinator's profile row needs fields a participant never receives (`ml_dsa_pubkey`,
  `phone_stub_hash`, `account_id`, and a coordinator-minted `agent_id`) — these arrive only in
  `register_request`. A participant can't build an equivalent row.
- It doesn't need to. `#processSessionRequest` checks `#thresholdSigners` FIRST; registering the
  in-memory `ClientDelegatedSigner` makes that hit → no `frost_signer_not_configured`. The participant
  has everything for the signer: `k_local = dkgReq.agentPubkey`, `primary_pubkey = result.shareCommitment`
  (its own locally-derived group key).
- Durability across the participant's OWN restart is covered by replication + boot: the coordinator's
  `agent_profiles` row replicates into the participant's DB, and boot `loadProfiles` + signer-restore
  rebuilds the signer. So no participant-written profile is required.
- **The fix:** in the round-3 `if (result.ok)` branch, after `#pendingDkgCommitments.set(...)`, mirror the
  coordinator's signer registration (construct `ClientDelegatedSigner(dkgReq.agentPubkey,
  result.shareCommitment)`, `setStreams`, `registerThresholdSigner`, `registerPrimaryPubkey`).
  Idempotent with the coordinator path. ~5 lines.
- **Red test:** at the `directory-node.test.ts` level, drive DKG round1/2/3 frost frames on a node that
  does NOT receive `register_request`; assert `getThresholdSignerForTest(agentPubkey)` is populated
  afterward (fails on current code).
- **"load-what-I'm-missing" reconcile:** now clearly belongs to the *absent-node* case (down during the
  ceremony, gets identity via replication while up), NOT the participant case. Keep it small, land after
  the core signer fix.

**Test harness located.** No node-level frost-frame harness in the directory tests (DKG tests in
`e2e-003-frost-handler-network.test.ts` are handler-level). The **real multi-node DKG** is
`packages/e2e-tests/src/spine/j-tofn-dkg.spine.test.ts` — extend THAT. (`session-fixture.ts` uses
`bootstrapKeyShares`/`injectShareForTest`, i.e. test-injected shares — it does NOT run the round-3
handler, so it can't cover Problem 1.)

**Exact next step (next tick):**
1. Read `j-tofn-dkg.spine.test.ts` to learn how it stands up the 3 nodes + drives the real DKG and which
   node is the coordinator.
2. Add a RED assertion: after the DKG, a **non-coordinator** node has the agent in `#thresholdSigners`
   (`getThresholdSignerForTest(agentPubkey)` non-null) — fails on current code.
3. Implement the ~5-line fix in the round-3 `if (result.ok)` branch (mirror directory-node.ts:2513-2518
   with `dkgReq.agentPubkey` + `result.shareCommitment`). Confirm green.
4. Gate → feature-dev:code-reviewer → fix findings → commit.

### 2026-07-04 (later) — Problem 1 fix IMPLEMENTED (pending review + live proof)

- **Code:** `directory-node.ts` round-3 `if(result.ok)` branch now registers the in-memory
  `ClientDelegatedSigner` on every participant (`k_local = dkgReq.agentPubkey`,
  `primary_pubkey = result.shareCommitment`) + emits `directory.dkg.participant.signer.registered`.
  ~15 lines incl. the explanatory comment. Idempotent with the coordinator path.
- **Test:** `j-tofn-dkg.spine.test.ts` now asserts the two NON-coordinator nodes log the participant
  signer registration (red on current binary, green after rebuild). Note: the round-3 path is
  live-binary only — in-process tests use `injectShareForTest`, which bypasses it — so this is the
  faithful assertion level (matches the file's own note about spine-vs-in-process).
- **Gate:** typecheck ✅; directory unit tests 673 passed / 0 fail ✅ (no regression). One guess caught
  by typecheck: used `this.#nodeId` (doesn't exist) → corrected to `this.#frostHandler.nodeId`.
- **Review: PASSED, no findings.** Reviewer confirmed `shareCommitment` == the coordinator's verified
  `primary_pubkey` (deterministic group key), no type mismatch, double-registration harmless (empty
  ceremony map), round3 success is sufficient (VSS already verified), and the delegated signer does NOT
  interfere with the co-signing path (co-signing uses the persisted share via frost-handler, not this
  map). Test assertion meaningful, no false-positive risk.
- **Gate: typecheck ✅, directory unit tests 673 ✅, eslint ✅, tsc build ✅.** COMMITTED to main.
- **Remaining for Problem 1:** the small absent-node reconcile (down-during-ceremony, identity via
  replication while up) + the live node-down proof (needs a directory build/deploy — batch with Problem 2's
  directory changes to avoid a second 25-30 min deploy).

### 2026-07-04 — Problem 2 spec: it's a coordinated client+directory protocol, NOT a one-line client change ⚠️ DESIGN DECISION NEEDED

Checked the code before writing anything. The refuse gate (`roster.length !== participants` → `dkg_below_threshold`, registration-manager.ts) is a symptom, not the lever:

- `participants` (N) and `threshold` (T) arrive in the **directory's `dkg_ready` frame** (registration-manager.ts:245-246) — the directory derives them from its OWN verified manifest.
- `runNetworkDkg` is set up as **T-of-participants**. If the client just stops refusing and proceeds with a smaller roster, the DKG is still configured for N participants but only Q show up → the FROST polynomial is built for N identifiers, the ceremony breaks.

**So a real quorum registration requires:**
1. **Coordinator directory** determines the reachable quorum Q at ceremony time and sends `participants = Q` (Q ≥ T), not N-from-manifest.
2. **Client** uses that Q — fans the DKG to exactly those Q nodes and records them as the share-holder set.
3. **Every participant + the client must agree on the EXACT SAME Q set** (same nodes AND their FROST participant identifiers — the shares are points at specific identifiers; disagreement = broken DKG).

This is cross-repo (directory decides Q + client honors it) and touches the `dkg_ready` semantics. Bigger than "MEDIUM."

### ✅ Q-DETERMINATION DESIGN — PINNED 2026-07-04 (Andre)

**Decided:** the client is the DKG driver (it exchanges every round directly with each directory), so the
client's reachability is what matters. Mechanism — client proposes reachable set, directory disposes:

1. Client computes **R** = the directories it can actually reach right now.
2. Client sends R to its home directory (with register_request).
3. Home directory picks **Q ⊆ R**, enforcing: **Q > T** (strict — redundancy from day one) AND every node
   in the signed manifest; assigns each node its FROST slot.
4. Directory broadcasts the agreed Q (node list + slots + threshold) to the client + participating
   directories (extend `dkg_ready`).
5. Client runs the DKG to exactly Q on the assigned slots.
6. Q recorded as the agent's share-holder set; seal signer-selection targets Q (Finding B).

**Floor:** Q > T. If the reachable set can't yield Q > T → refuse (needs ≥ T+1 reachable).
**Implementation note:** pin the threshold arithmetic — the client itself is one signer, so confirm whether
"T" for the floor is the full FROST threshold or the directory-share count (dev manifest is
participants:3/threshold:3 = client + any 2 of 3 dirs). Nail during SPARC before coding.
**Scope:** cross-repo + a wire change (register_request carries R; dkg_ready carries the Q node list/slots,
not just counts) → both repos + version bump + publish + directory deploy.

<details><summary>Original open questions (now answered)</summary>

**⚠️ OPEN DESIGN DECISION (needs Andre — do NOT invent a protocol unilaterally):** how is Q determined and agreed?
- Who computes Q — the coordinator directory (from who it can reach), or the client (from its resolved+reachable roster)?
- How do both sides converge on the identical set + identifiers (e.g. coordinator probes the consortium, picks Q, echoes the exact node list + identifiers in `dkg_ready`; client validates against its own manifest and uses that list)?
- Quorum floor: register if available ≥ ? In dev N=3/T=3 (client + any 2 of 3 dirs), directory-signers needed = 2, so floor = 2 dirs; but Q>T for redundancy means all 3 in dev — quorum only really helps at N>3. Confirm the floor + whether dev exercises it at all.

</details>

**Status: Problem 2 UNBLOCKED 2026-07-04 — design PINNED above (directory picks Q ⊆ the client's reachable R; floor Q > T). Ready for SPARC + TDD; cross-repo + a `register_request`/`dkg_ready` wire change.**

### 2026-07-04 — Problem 1 auto-deploying; live-proof plan

- The Problem 1 commit (`97bc68c9`, touches `packages/directory/`) **auto-triggered `cello-directory-pipeline`** (InProgress, started ~07:09 UTC). All 3 regions, ~25-30 min.
- **Live proof of Problem 1 (next tick, after deploy COMPLETED + 6 ECS 1/1):** the deploy restarts the directories (they boot-restore signers for existing agents), so test with a FRESH agent: register a new agent (all-N; its coordinator = the node its daemon connects to), then point a daemon at a DIFFERENT (non-coordinator) directory and `cello_initiate_session` for that agent → expect success, NOT `frost_signer_not_configured`. That non-coordinator holds the signer ONLY because of the round-3 fix (it hasn't restarted since the agent registered). Confirm `directory.dkg.participant.signer.registered` in the non-coordinator's logs.
- **After the deploy:** relay cascade (restart all 3 relays to re-register) per infra/CLAUDE.md; verify 6 ECS 1/1 + 6 DNS; update infra/STATE.md.

**Loop note:** next cron tick = check pipeline done → run the live proof → relay cascade → STATE.md. Problem 2 stays parked until Andre pins the Q-determination design.

### 2026-07-04 — Relay cascade verified; Problem 1 done pending live proof; LOOP BLOCKED on Andre

- **Relay cascade COMPLETE + healthy.** 6 ECS 1/1, 6 DNS resolve. Relays relaunched ~08:00 UTC (new IPs
  us1 10.0.29.23 / eu1 10.1.86.70 / ap1 10.2.126.254). S3 relay manifest is CURRENT (v54, re-signed
  07:59:56 UTC); endpoints are stable `wss://` DNS URLs, so **no manual manifest re-sign needed**.
- **Problem 1 status:** shipped `97bc68c9` → deployed all 3 regions → code-review passed → gate green
  (typecheck/lint/build/673 unit) → spine assertion added. High confidence. The remaining item is a
  **live end-to-end confirmation** (fresh agent registers → non-coordinator eu1/ap1 log
  `directory.dkg.participant.signer.registered`, and/or a session-initiate via a non-coordinator succeeds).
  That needs a fresh registration against the LIVE federated cluster (signed consortium manifest +
  capability + daemon) — involved. Prereqs: recreate `scratchpad/mint-capability.mjs` (content is in the
  git history of the earlier session / the m8b design doc), issuer seed reachable, crypto dist built.
- **⛔ LOOP BLOCKED:** the substantive remaining work — Problem 2 (quorum registration) — is blocked on
  Andre's design decision (how Q is determined + agreed). Problem 1's live proof is non-blocking and
  finicky. **Nothing further advances autonomously until Andre pins the Problem 2 design.** Not burning
  cron ticks on a fragile live registration that gates nothing.

### 2026-07-04 — Problem 1 spine test GREEN (TDD cycle complete)

- Rebuilt directory+relay binaries with the fix, ran `j-tofn-dkg.spine.test.ts` (real 3-node FROST DKG,
  real shipped binaries): **1 passed**. The added assertion — non-coordinator nodes (1,2) log
  `directory.dkg.participant.signer.registered` — is GREEN. The string didn't exist pre-fix (reviewer
  confirmed), so it's red-without-fix by construction. Problem 1 is now unit-gated + code-reviewed +
  **spine-verified** + deployed to all 3 regions.
- **Problem 1 = DONE for Sprint A** (mechanism proven with real binaries; live in all 3 regions). Only
  untaken step: a live-AWS end-to-end (fresh registration → non-coordinator serves) — confirmatory,
  non-blocking, finicky; left for a focused moment.
- **Sprint A fully blocked on Andre** for Problem 2's Q-determination design. No autonomous work remains
  that isn't blocked (Problem 2) or non-gating-and-finicky (Problem 1 live-AWS e2e).
