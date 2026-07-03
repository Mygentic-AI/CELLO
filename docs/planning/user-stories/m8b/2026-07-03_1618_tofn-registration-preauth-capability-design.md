---
name: T-of-N registration — pre-auth capability design
type: discussion
date: 2026-07-03
topics: [m8b, t-of-n, registration, dkg, pre-auth-token, sovereignty, security, design]
status: active
description: >
  Design doc for the blocker that stops fresh T-of-N agent registration on the live consortium:
  the single-use pre-auth token is a bearer secret that lives at only ONE sovereign node, but the
  multi-node FROST DKG requires ALL N directories to authorize the registration. Confirms the
  token-store model, states the invariants that constrain any fix, and proposes converting the
  opaque bearer token into an ops-agent-signed capability verified independently by every node,
  with anti-replay via a replicated, non-secret nonce→registration binding. Scales to N=20, T=10.
---

# T-of-N registration — pre-auth capability design

## 1. Problem statement

On the live consortium (us-east-1, eu-central-1, ap-northeast-1), a **fresh** agent cannot complete a
T-of-N registration. Every attempt fails with `dkg_failed`. This blocks the redundancy story: agents
registered before the roster existed hold single-node shares, and no new agent can obtain genuine
2-of-3 (in general, T-of-N) shares.

This was surfaced during the FINDING-4 live T-of-N verification (2026-07-03). Two prior walls were
cleared first and are **not** the subject of this doc:

- **Client roster (FINDING-4, shipped):** the client bundles the signed consortium manifest, so it
  resolves the 3-node roster.
- **Directory topology (shipped 2026-07-03, commit `d5a324f0`):** each directory now loads the
  consortium manifest (`CELLO_DIRECTORY_CONSORTIUM_MANIFEST`) and declares `participants: 3` instead of
  `1`, so the client no longer refuses with `dkg_below_threshold`.

With both cleared, the DKG now fans across all three directories and fails at a **third** wall,
described below.

## 2. Evidence trail (how the real cause was found)

The failure surfaced as `dkg_failed` — a generic reason produced by a `catch {}` in
`registration-manager.ts` that **swallowed the underlying error** (tracked separately as a finding to
fix; see §11). A token-free libp2p probe proved all three directories accept `/cello/frost/1.0.0`
streams (sequentially and concurrently) from a fresh node, ruling out the directories, the network, the
ALB, and connection-state theories. A temporary diagnostic patch to surface the swallowed error yielded
the truth:

```
DKG_THROW: Error: dkgRound1 rejected: PRE_AUTH_TOKEN_CONSUMED
    at dkgRound1WithNode (network-directory-node.js:230)
    at async Promise.all (index 0)
    at async runNetworkDkg (network-directory-node.js:515)
```

## 3. Confirmed token-store model

- **Schema** (`packages/directory/db/migrations/V25__pre_authorization_tokens.sql`): a
  `pre_authorization_tokens` table keyed by `token TEXT UNIQUE`, with a `consumed_at TIMESTAMPTZ`.
  Single-use is enforced by an **atomic conditional update**:
  `UPDATE … SET consumed_at = now() WHERE token = $1 AND consumed_at IS NULL RETURNING id`. The DDL
  comment states the design intent explicitly: *"Only one UPDATE can return rowCount=1 when two agents
  present the same token concurrently."* — i.e. it was designed for **one presenter**, not N.
- **Issuance:** the token is `INSERT`ed by the node that handles `POST /internal/pre-authorize`
  (`pre-auth-token-repository.ts`) — the node the ops-agent / portal talks to (us1 in practice).
- **Replication:** the cross-node write-seam (`V34__write_seam_targets.sql`) replicates **only**
  `agent_suspensions`, `identity_tree_entries`, `pickup_queue` (plus revocations/presence in their own
  migrations) — "ONLY hashes, flags, and sealed ciphertext — **never plaintext, PII, or tokens**
  (DOD-INV-2)." **`pre_authorization_tokens` is deliberately excluded.** A pre-auth token is a bearer
  credential; replicating it to every sovereign node would widen the attack surface (any node's DB
  compromise would leak every token).
- **Validator reasons** (`adapters/pg-token-validator.ts`): `PRE_AUTH_TOKEN_NOT_FOUND` when the token
  is absent from the local DB; `PRE_AUTH_TOKEN_CONSUMED` when `consumed_at` is set.

## 4. Root cause — two walls, one invariant

The T-of-N DKG (`runNetworkDkg`, `network-directory-node.ts`) sends **round-1 with the same token to
all N directories in parallel** (`Promise.all(directoryNodes.map(dkgRound1WithNode))`), and **each
directory independently validates and consumes it** (directory-node.ts round-1 handler,
`preauth.token.consumed`). Given the store model above:

1. **Distribution wall:** the token exists only in the issuer's DB. The other **N-1 directories return
   `PRE_AUTH_TOKEN_NOT_FOUND`** — they have no way to see it, and (by DOD-INV-2) must not.
2. **Single-use wall:** even if every node had the token, the per-node atomic consume means only the
   first to run succeeds; the rest return `PRE_AUTH_TOKEN_CONSUMED`.

`Promise.all` rejects on the first of these → `dkg_failed`. This fails for **every N > 1** and gets
strictly worse as N grows. (In the captured trace, index 0 = the issuer returned `CONSUMED` because it
was a retry of an already-spent token; on a first use the issuer consumes and the peers return
`NOT_FOUND` — same outcome.)

The invariant that makes this non-trivial: **a bearer token must not be replicated across sovereign
nodes**, yet **every sovereign node must independently authorize the registration** (no node may vouch
for another — a compromised node cannot be allowed to manufacture registrations). The current token is a
DB-lookup secret, which cannot satisfy both at once.

## 5. Requirements any solution must satisfy

- **R1 — Sovereignty:** every participating directory independently verifies the registration is
  authorized. No coordinator, no node vouching for another. A compromised node cannot forge a
  registration.
- **R2 — No replicated bearer secrets:** preserve DOD-INV-2. The authorization artifact carried to N
  nodes must be safe to expose to all of them.
- **R3 — Single-use:** one authorization ⇒ exactly one agent registered. No replay into a second agent.
- **R4 — Scale:** correct and efficient at N = 20, T = 10. T (the signing threshold) is **orthogonal**
  to registration authorization — it is set inside the DKG and must not enter the auth path.
- **R5 — Availability:** aligns with the redundancy invariant. Registration should not require a
  specific single node to be up (see the open decision in §9).

## 6. Why the obvious fixes fail

- **Replicate the token to all nodes** → violates **R2** (replicating a bearer secret). Rejected.
- **One "coordinator" directory consumes and vouches to the rest** → violates **R1** (the peers trust
  the coordinator; a compromised coordinator forges registrations). Rejected.
- **Present the token to only the issuer; peers skip auth** → the peers would participate in a DKG they
  never authorized; a rogue client could DKG with the N-1 peers alone. Violates **R1**. Rejected.
- **Make per-node consume idempotent by binding token→epoch** (my first instinct) → solves the
  single-use wall but **not** the distribution wall: the peers still don't have the token to bind.
  Insufficient on its own.

## 7. Proposed design — signed pre-auth capability + replicated nonce binding

Separate the two concerns the current token conflates: **authorization** (verifiable by all) and
**anti-replay** (single-use state).

### 7a. Authorization — an ops-agent-signed capability

Replace the opaque bearer string with a **signed capability** issued by the ops-agent:

```
PreAuthCapability = {
  nonce:            <random 128-bit>,        // replay identity, not a secret
  phone_stub_hash:  <hash>,                  // same binding data the token row carries today
  email_domain:     <string>,
  issued_at, expires_at,
  sig:              Ed25519_sign(issuerKey, TBS(above fields))
}
```

The issuer key is an ops-agent / officer key whose **public** half every directory pins locally (the
same class of key already used to threshold-sign the consortium manifest — the signing infrastructure
exists). Each directory, in DKG round-1, **verifies `sig` against the pinned issuer pubkey**. This is
stateless, requires no DB lookup, and satisfies **R1** (independent verification) and **R2** (the
capability is a signature, not a secret to guard — safe to hand to all N).

RFC reference for the signature: RFC 8032 (Ed25519), matching the manifest verification path.

### 7b. Anti-replay — replicated, idempotent nonce→registration binding

The capability's `nonce` is not secret, so its **consumption marker is safe to replicate** via the
existing write-seam (the DOD-INV-2-compliant channel — it carries hashes/flags, never secrets). Add a
replicated marker table, e.g. `pre_auth_nonce_bindings(nonce, bound_epoch, bound_at, chain_hash)`, and
make consumption a **bind-to-registration** operation keyed by the DKG epoch (`epochId` =
`agentPubkey:epoch:1` — one epoch ⇒ one agent):

```
bind(nonce, epochId):
  atomically:
    if nonce unbound          → write nonce→epochId, return OK        (first node)
    else if bound to epochId  → return OK                             (the other N-1, same registration)
    else (bound to epochId')  → reject NONCE_ALREADY_BOUND            (replay into a different agent)
```

Because every node binds the **same** `nonce` to the **same** `epochId`, concurrent first-use binds do
not conflict (they write identical values) and **replication lag cannot cause a false reject** — the
idempotency is on the (nonce, epoch) pair, not on "who got there first." A later, different registration
(different epoch) is rejected everywhere once the binding has replicated. This satisfies **R3**.

The issuer still records local issuance/expiry for audit; the *single-use enforcement* moves from the
per-node `consumed_at` race to the replicated, idempotent nonce binding.

## 8. Why this scales (R4) and stays sovereign (R1)

- **N = 20:** each node does one signature verify + one atomic idempotent write. No coordinator, no
  fan-in bottleneck; 20 independent authorizations that provably agree because they bind identical
  `(nonce, epoch)`.
- **T = 10:** untouched. T is the FROST **signing** threshold configured inside the DKG (`signers.min`);
  it never enters the authorization path. Registration authorization is a per-registration fact,
  independent of how many signers later sign.
- **Sovereignty:** authorization is a cryptographic check against a pinned public key — no node trusts
  another's word. A compromised node still cannot forge the ops-agent signature.

## 9. DKG ceremony availability — quorum ceremony + background enrollment (the design)

First, dispel a conflation: **T-of-N is the *signing* threshold** — T of the N directories sign each
seal; the other N−T may be down. That is the recurring operation and is never in question here.

The **DKG** is different: it is the one-time ceremony that *creates* the N shares. A share is a
**secret** — no node ever sees another's, and no channel (including the write-seam federation) ever
carries a plaintext share; that is the security model. Therefore a share can only be **born on the node
that will hold it** — it cannot be replicated to a node the way a suspension flag can. Whichever nodes
are to hold a share must obtain it through a ceremony (the initial DKG, or a later enrollment).

### Why "require all N present" is rejected

Requiring every directory present for the DKG **collapses as N grows** and violates the redundancy
invariant. At N=3 a single node down already blocks every new registration; at the target N=20 it
requires all 20 up at the same instant for every registration, which — given deploys, maintenance, and
transient blips — is almost never true. Availability of an all-N ceremony is the *product* of per-node
availability, so it degrades exponentially in N. It is not a viable design; at most it is a throwaway
crutch at N=3 that bakes in a hard scaling wall. **Rejected.**

### The design: quorum ceremony now, enroll the rest in the background

- **DKG runs among the available quorum**, chosen *larger than T* so the agent has signing redundancy
  immediately (e.g. at N=20/T=10, DKG among the 15 that are up → 10-of-15 at once). The agent is usable
  the instant this completes — it does not wait for all N.
- **Absent nodes enroll asynchronously**, off the registration critical path, until coverage reaches the
  full T-of-N. Registration therefore tolerates any (N − quorum) nodes being down. At large N,
  enrollment is not an edge case — it is the *normal* path, since you rarely have everyone up.

### Enrollment is a real but bounded piece of work

- **It is not the existing `cello refresh`.** `frost-resharing.ts` is a *fixed-membership* zero-constant
  refresh (re-randomize existing shareholders' shares); it assumes the recipient already holds a share
  to add Δ to. A backfilled node has none. Enrollment is **dynamic resharing to a new access structure**
  (Desmedt–Jajodia): the quorum reshares the *same* secret onto the expanded membership. Net-new
  protocol, but a close cousin of what exists.
- **It inherits every forgery protection** from §7/the refresh path: Feldman VSS commitments verified by
  the recipient, the group public key provably preserved (constant term unchanged), the newcomer ends
  with exactly one share (useless alone), threshold preserved, and the canonical `primary_pubkey`
  anchored in every directory's `agent_profiles` so no divergent "version" can masquerade as the agent.
- **Delivery can reuse existing infra.** The write-seam already carries *sealed ciphertext*
  (`pickup_queue`: pull → openSeal → ACK → delete). An enrolled node's share rides the same pattern as
  a ciphertext sealed to that node's key — DOD-INV-2-clean, because it is sealed, not plaintext.

### Relationship to the pre-auth capability fix (§7)

The two are independent and compose. The anti-replay marker in §7b is a *non-secret nonce*, so it rides
the write-seam and enforces single-use globally regardless of which quorum ran the DKG. The capability
work is correct as written; enrollment is the follow-on that makes registration outage-tolerant.

**Sequencing (open):** ship the pre-auth capability fix first (unblocks T-of-N registration when a
quorum is up — already the common case at N=3), then land enrollment as the immediate follow-on before N
grows. Or build them together. Andre's call on ordering — but all-N is off the table either way.

## 10. Implementation sketch (phases, no estimates)

- **Ops-agent / issuance:** issue and Ed25519-sign the `PreAuthCapability`; publish the issuer pubkey to
  the directories' pinned-key config (reuse the manifest officer-key pipeline). `/internal/pre-authorize`
  returns the signed capability instead of an opaque string.
- **Directory:** in DKG round-1, verify the capability signature against the pinned issuer key; replace
  `validateAndConsume(token)` with `bind(nonce, epochId)` against the new replicated marker table.
- **Schema/migration:** new `pre_auth_nonce_bindings` table; add it to the write-seam publication with
  the standard `INCREMENT BY 3` sequence staggering (per V34's replication note). Update
  `OpsAgentExpectedMigrationVersion` in `cello-ssm-parameters.yaml` (M5 migration rule).
- **Client:** carry the capability (already carries `preAuthToken`); minimal change — it presents the
  capability to each directory as it already does. Version-bump + publish per the cross-repo rule.
- **Spine coverage:** extend `j-tofn-dkg` to assert a live-shaped path where the capability is verified
  independently by N nodes and single-use is enforced across a re-presentation.

## 11. Related finding (fix separately, per standing rule)

`registration-manager.ts`'s DKG `catch {}` returned `dkg_failed` and **discarded the real error**
(`PRE_AUTH_TOKEN_CONSUMED`). This cost hours and is exactly the "generic error that swallows the actual
error" anti-pattern. Fix: log the caught error with the domain taxonomy
(`registration.dkg.error` with the underlying reason) before mapping to the returned code. Not part of
this design change; tracked as its own cleanup.

## 12. Verification plan (once implemented)

1. Register a fresh agent live → assert the 2-of-3 (generally T-of-N) DKG completes and shares land on
   all participating directories.
2. Seal a session → confirm ≥ T directories FROST-sign.
3. Kill exactly one participating directory → re-seal → confirm the seal still completes
   (the redundancy property FINDING-4 unlocked).
4. Re-present the same capability → assert single-use rejection (`NONCE_ALREADY_BOUND`) at every node.

## 13. Status

Root cause confirmed with live evidence. Cluster is consortium-configured and healthy (all three
directories declare `participants: 3`, `/manifest` served, step-6 auth on). No code written for this
design yet — awaiting the §9 availability decision before implementation.
