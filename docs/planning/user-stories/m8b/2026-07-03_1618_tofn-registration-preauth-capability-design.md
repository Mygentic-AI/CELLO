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
- **Replication:** `pre_authorization_tokens` **IS** replicated across the sovereign nodes via the
  `cello_pub` logical-replication publication (`infra/setup-replication.sh`; added in commit `e3edf148`
  *specifically* so every node can validate a token during a T-of-N DKG; replication is verified live in
  `infra/STATE.md`). DOD-INV-2's "never … tokens" phrase is about the portal **write-seam endpoint**
  (`/internal/agent-write`, which has no field a token could occupy) — **not** the replication
  publication. (An earlier draft of this doc conflated the two and wrongly claimed tokens are not
  replicated.)
- **Validator reasons** (`adapters/pg-token-validator.ts`): `PRE_AUTH_TOKEN_NOT_FOUND` when the token
  is absent from the local DB; `PRE_AUTH_TOKEN_CONSUMED` when `consumed_at` is set.

## 4. Root cause — a non-idempotent single-use consume, raced across async replication

The T-of-N DKG (`runNetworkDkg`) sends **round-1 with the same token to all N directories in parallel**
(`Promise.all(directoryNodes.map(dkgRound1WithNode))`), and **each directory independently validates and
consumes** it via `UPDATE … SET consumed_at = now() WHERE token = $1 AND consumed_at IS NULL`. The token
is replicated, but that consume is **non-idempotent** (each node writes a *different* `now()`), and
logical replication is **asynchronous**. So the N concurrent consumes race, with only bad outcomes:

- **Double-consume → replication conflict:** if two nodes each still see `consumed_at IS NULL` locally
  (the other's write not yet replicated), both `UPDATE`s succeed with *different* timestamps on the same
  primary key — a replication conflict that can halt the subscription. Registration may appear to
  succeed while replication silently breaks.
- **Reject:** if a node has already received the replicated consume — or, for a freshly-issued token,
  has **not yet received the token's INSERT** (replication lag in the seconds between issuance and
  `cello register`) — it returns `PRE_AUTH_TOKEN_CONSUMED` / `PRE_AUTH_TOKEN_NOT_FOUND`, `Promise.all`
  rejects, and the DKG fails.

Which branch hits is timing-dependent — a race, not a clean wall.

**Honesty note on the evidence:** a clean, isolated first-use registration was never captured. The live
attempts were confounded by a polluted client node (stream-open failures) and, in the one attempt that
reached round-1, a **retry of an already-consumed token** (hence the captured `PRE_AUTH_TOKEN_CONSUMED`
at the issuer). This root cause is argued from the code plus the semantics of async logical replication
over a non-idempotent single-use `UPDATE` — not from a clean repro. It does not change the fix: the
capability replaces the DB-mutating consume with a **stateless signature check** plus an **idempotent**
nonce→epoch bind (every node writes the identical value, so replication cannot conflict), removing the
race regardless of which branch would have hit.

## 5. Requirements any solution must satisfy

- **R1 — Sovereignty:** every participating directory independently verifies the registration is
  authorized. No coordinator, no node vouching for another. A compromised node cannot forge a
  registration.
- **R2 — Replication-safe authorization:** the authorization artifact is written at, and replicated to,
  every node, so it must be safe to expose to all of them AND its consumption must survive concurrent,
  asynchronously-replicated writes (i.e. be idempotent — the exact property `consumed_at = now()` lacks).
- **R3 — Single-use:** one authorization ⇒ exactly one agent registered. No replay into a second agent.
- **R4 — Scale:** correct and efficient at N = 20, T = 10. T (the signing threshold) is **orthogonal**
  to registration authorization — it is set inside the DKG and must not enter the auth path.
- **R5 — Availability:** aligns with the redundancy invariant. Registration should not require any
  specific node to be up — it proceeds among an available quorum (see §9).

## 6. Why the obvious fixes fail

- **Keep the token; retry / wait for replication on `NOT_FOUND`** → the lag window is unbounded (a user
  can `cello register` immediately after issuance), and it does nothing about the double-consume
  replication conflict. Band-aid. Rejected.
- **Keep the token but make consumption idempotent** (bind token→epoch instead of `consumed_at = now()`)
  → fixes the *consume* race, but the token is still a **DB-lookup** credential, so a freshly-issued
  token not yet replicated to a peer still fails `NOT_FOUND`. Half the fix. The signed capability adds
  the other half: authorization becomes a **stateless signature check** with no DB lookup, so replication
  timing is irrelevant.
- **One "coordinator" directory consumes and vouches to the rest** → violates **R1** (peers trust the
  coordinator; a compromised coordinator forges registrations). Rejected.
- **Present the token to only the issuer; peers skip auth** → peers would join a DKG they never
  authorized; a rogue client could DKG with the N−1 peers alone. Violates **R1**. Rejected.

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

The issuer key is a **dedicated Ed25519 pre-auth-issuer key**, separate from the manifest officer keys
so a leak of one cannot forge the other. The private half lives in Secrets Manager; the public half is
pinned to each directory via SSM — the same provisioning pattern as the directory node key. Each
directory, in DKG round-1, **verifies `sig` against the pinned issuer pubkey**. This is stateless,
requires no DB lookup, and satisfies **R1** (independent verification) and **R2** (the capability is a
signature, not a secret to guard — safe to hand to all N).

RFC reference for the signature: RFC 8032 (Ed25519), matching the manifest verification path.

### 7b. Anti-replay — replicated, idempotent nonce→registration binding

The capability's `nonce` is not secret, so its **consumption marker replicates** via the `cello_pub`
logical-replication publication — the same publication that already replicates the tokens table. Add a
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

## 9. DKG ceremony availability — quorum ceremony + background enrollment

Dispel one conflation up front: **T-of-N is the *signing* threshold** — T of the N directories sign each
seal, and the other N−T may be down. That is the recurring operation and is never in question.

The **DKG** is the one-time ceremony that *creates* the shares. A share is a **secret** — born on its
holding node, never carried by any channel including the write-seam. So a node obtains its share only by
taking part in a ceremony: the initial DKG, or a later enrollment.

**Registration DKGs among the available quorum**, chosen *larger than T* so the agent has signing
redundancy immediately (N=20/T=10 → DKG among the 15 that are up → 10-of-15 at once). The agent is usable
the instant this completes. **Absent nodes enroll asynchronously**, off the registration critical path,
until coverage reaches full T-of-N. Registration therefore tolerates any (N − quorum) nodes being down;
at large N, enrollment is the *normal* path, not an edge case.

### Enrollment — net-new, but bounded

- **It is not the existing `cello refresh`.** `frost-resharing.ts` is a *fixed-membership* zero-constant
  refresh (re-randomize existing shareholders' shares); it assumes the recipient already holds a share to
  add Δ to. A backfilled node has none. Enrollment is **dynamic resharing to a new access structure**
  (Desmedt–Jajodia): the quorum reshares the *same* secret onto the expanded membership. A close cousin
  of what exists.
- **It inherits every forgery protection** from the refresh path: Feldman VSS commitments verified by the
  recipient, the group public key provably preserved (constant term unchanged), the newcomer ends with
  exactly one share (useless alone), threshold preserved, and the canonical `primary_pubkey` anchored in
  every directory's `agent_profiles` so no divergent key can masquerade as the agent.
- **Delivery reuses existing infra.** The write-seam already carries *sealed ciphertext* (`pickup_queue`:
  pull → openSeal → ACK → delete). An enrolled node's share rides the same pattern as a ciphertext sealed
  to that node's key — DOD-INV-2-clean, because it is sealed, not plaintext.

### Relationship to the pre-auth capability fix (§7)

Independent and composing. The anti-replay marker in §7b is a *non-secret nonce*, so it rides the
write-seam and enforces single-use regardless of which quorum ran the DKG. The capability work is correct
as written; enrollment is the follow-on that makes registration outage-tolerant.

**Sequencing (open):** ship the pre-auth capability fix first (unblocks T-of-N registration whenever a
quorum is up), then enrollment as the immediate follow-on — or build them together. Ordering is Andre's
call.

## 10. Implementation sketch (phases, no estimates)

- **Ops-agent / issuance:** issue and Ed25519-sign the `PreAuthCapability`; publish the issuer pubkey to
  the directories' pinned-key config (reuse the manifest officer-key pipeline). `/internal/pre-authorize`
  returns the signed capability instead of an opaque string.
- **Directory:** in DKG round-1, verify the capability signature against the pinned issuer key; replace
  `validateAndConsume(token)` with `bind(nonce, epochId)` against the new replicated marker table.
- **Schema/migration:** new `pre_auth_nonce_bindings` table; add it to the write-seam publication with
  the standard `INCREMENT BY 3` sequence staggering (per V34's replication note). Update
  `OpsAgentExpectedMigrationVersion` in `cello-ssm-parameters.yaml` (M5 migration rule).
- **Client:** the round-1 `preAuthToken` field changes from a string to the structured capability — a
  `protocol-types`/wire change, so crypto/protocol-types/client/connect version-bump + publish per the
  cross-repo rule, and `cello register` takes the capability blob.
- **Rollout:** the capability replaces the token outright — **no compatibility path** (alpha, single
  operator). Directories switch to capability-only; the one client updates in step.
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
