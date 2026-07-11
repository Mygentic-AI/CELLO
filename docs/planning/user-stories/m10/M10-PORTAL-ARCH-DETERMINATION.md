---
name: M10 Portal Architecture — Determination (decision half of DOD-PORTAL-ARCH-1)
type: design
date: 2026-07-11
milestone: M10
status: active
topics: [m10, portal, trust-signals, architecture, determination, key-custody, kms, registry, submission, class-3, delivery, zero-bump]
description: >
  The decision half of DOD-PORTAL-ARCH-1, written AGAINST M10-PORTAL-ARCH-INVESTIGATION (facts by
  §-reference, not re-derived). Resolves the seven forks (§11) — adopting the §12 recommendations
  R1–R6 with the reasoning re-examined, R7 already superseded by M10-D5 — and determines the six
  things the DoD line requires: per-type module shape, signing/custody, the submission client, the
  registry publisher, the Class-3 job home, and holder delivery. Reviewed by cello-unit-reviewer
  2026-07-11 (8 findings, all fixed in place — F1 became M10-D13). Decisions graduate to the DoD
  Decisions section as M10-D6…D13.
---

# M10 — Portal Architecture Determination

**Standing on:** [[M10-PORTAL-ARCH-INVESTIGATION]] (evidence, cited as *inv §N*), the spec-of-record
([[M10-TRUST-SIGNAL-STORAGE-AND-CREATION]], cited as *spec §N*), and decisions M10-D1…D5. Nothing here
re-derives a fact; anything not in evidence is marked as the owning unit's to verify.

---

## 0. The shape in one paragraph

The portal becomes CELLO's **issuer**: a set of per-type verification modules (the only per-type code
in the system) feeding one generic **mint pipeline** — compose → scan → canonical-CBOR hash → **sign
via KMS** (the portal holds no private key) → submit to a **new, type-blind, signature-authenticated
directory write surface** (the M8 `agent-write` seam retires) → the directory anchors + replicates →
the **existing M8 pickup pipe delivers** the envelope to holder daemons (corrected, not reinvented).
A **dedicated registry key** signs the served type-registry document; a small **in-process scheduler**
computes Class-3 aggregates through a new signed read path. The portal keeps **no authoritative signal
state** — the directory's `signal_records` is the record; every portal behavior is derived from it,
idempotently.

## 1. Fork resolutions (inv §11/§12 → decisions)

### M10-D6 — Issuer signing: Ed25519 in AWS KMS; the portal holds no private key (adopts R1)
The submission-signing key is a KMS `ECC_NIST_EDWARDS25519` key; the portal calls `kms:Sign`
(`ED25519_SHA_512`, `MessageType: RAW` — pure Ed25519, which is what `@noble/curves` verifies) under
its existing IAM task role (inv §4.1, §6.3). Mint volume is portal-touches plus a nightly job, so
per-sign latency is irrelevant; a compromised container can request signatures (CloudTrail-visible)
but never exfiltrate the key. **Local dev:** a file-based signer behind the same `IssuerSigner`
interface (adapter rule, repo CLAUDE.md); `CELLO_ENV` selects. The directory learns the issuer pubkey
as **data** (§3.2) via `GetPublicKey` — never a hardcoded constant in directory code.
*Rejected:* KMS-as-wrapper (raw key in container memory for a speed win nothing needs);
env-var/Secrets-Manager plaintext (the weakest; the master-key precedent it copies is itself slated
for upgrade).

### M10-D7 — Canonical-CBOR component: ONE implementation, in `@cello-protocol/crypto` (adopts R2)
The envelope encoder/hasher (Journal Entry 1's design note) ships in `@cello-protocol/crypto` — already
the portal's sole `@cello-protocol` dependency and home of the canonical TBS + `hash()` precedents
(inv §6.4, §9). The client already carries `cbor-x` with an RFC 8949 §4.2 deterministic profile
(inv §9); the component pins that profile in one place. Cascade-coupling is acceptable because the
envelope is frozen by design (spec §15.3) — the component ships once in Tier 0 and rarely changes.
*Rejected:* vendored spec-with-vectors — three hand-kept byte-identical implementations is the
scanner-version drift problem in another costume.

### M10-D8 — Class-3 job home: in-process scheduler from `instrumentation.register()` (adopts R3)
The nightly Class-3 job runs on a `setInterval`-style scheduler started from the portal's existing
`instrumentation.register()` hook (the one long-lived escape hatch, inv §4.2), with the job body in
its own module behind a clean entrypoint (`src/server/trust/track-record-job.ts`). `DesiredCount: 1`
makes duplicate-run protection unnecessary today; a Postgres advisory lock is the documented
first-change if that scales. A job crash logs loud (`signal.track.job.failed`) and never kills the
server process. Because it is a module with an entrypoint, promotion to a separate worker later is a
routing change (same shape as the Endorsement-Mother launch compromise, spec §7).
*Rejected:* second container / EventBridge task (doubles deploy surface for a nightly job); Lambda
(re-packages crypto + the submission client outside the Next build); `after()` (request-bounded —
disqualified by evidence, inv §4.2).

### M10-D9 — Registry signing: a dedicated registry key; clients pin its pubkey at build time (adopts R4)
The type registry is signed by a **second, dedicated** KMS Ed25519 key — not the officer threshold,
not the submission key. The registry changes every few days early on (that cadence IS the zero-bump
point); an offline officer ceremony per type addition kills it. The registry is fail-soft metadata
(absent/unverifiable ⇒ valid-but-unclassified — INV-TYPE-CARRY), so its compromise ceiling is
classification mischief, never signal forgery. Separate key from the submission key: different blast
radius, independent revocation. Clients pin the registry pubkey as a build-time constant beside
`BUNDLED_CONSORTIUM_ROOT_KEYS` (ships with the one-time Tier 0–2 generic client work, before the
canary's zero-bump measurement window). Manifest-carried rotation is the later strengthening.
*Rejected:* officer threshold — right instrument for the network's trust root, wrong cadence for
metadata.

### M10-D10 — Submission transport: a NEW type-blind signed write surface; `agent-write`'s signal arms retire (adopts R5)
All M10 directory traffic rides **new `/internal/signal/*` routes** (§3), authenticated by **request
signature against the authorized-issuer set** — not the shared bearer key. The M8 seam's
`trust_signal_hash`/`trust_signal_ciphertext` arms and the `SIGNAL_KINDS` enum
(`agent-write-validation.ts:20`, inv §5.3) retire after the §14.10 backfill re-mints the WebAuthn
signal; `agent-write` keeps its non-signal lever role (revocation_flag). INV-CHOKEPOINT is implemented
natively on the new surface: domain-separated signature, authorized-issuer set as data, re-hash before
store, idempotent on duplicate hash.
*Rejected:* extending `agent-write` — exact-key per-kind schemas, mutate-in-place semantics, and the
enum's gravitational pull would be carried forever, in exactly the code the zero-bump reviewer lens
polices.

### M10-D11 — Portal→directory availability: static ordered failover list (adopts R6)
`DirectoryClient` (all methods — auth resolution included, which is the unforgivable half of a us1
outage: operators locked out of the portal) takes a **static ordered list of 2–3 directory base URLs**
with try-next-on-unreachable. Safe because every M10 write is idempotent-on-duplicate-hash (M10-D10)
and reads are reads. Full manifest-driven discovery is post-v1.
*Rejected:* teaching the portal the full manifest client + pinned-root verification — real new
surface that buys little at three known nodes.

### M10-D12 — The portal keeps no authoritative signal state
No `minted_signals` table. The directory's `signal_records` is the single record; the portal derives
everything from it through the signed read route (§3.3): "has this account's `phone` envelope been
minted?" is a query, not a local row. Mint-on-portal-touch is therefore idempotent by construction
(query → absent → mint; query → active → no-op), retry-safe, and survives portal DB loss with zero
signal-state consequences. The portal's Postgres keeps only what it already owns (auth, sessions,
TOTP/WebAuthn material). Carve-out (deliberately narrow): a per-type verification flow may keep
**transient verification-flow state — TTL'd, never envelope data, never anything a signal's
existence is derived from** (OAuth `state` tokens; Tier 4's async extraction results awaiting mint,
which DOD-EXTRACT-DESIGN-1 scopes). Anything persisted past the flow, or consulted to answer "is
this signal minted?", is a violation of this decision.
*Rejected:* portal-side bookkeeping table — a second source of truth that can only ever disagree
with the directory (the M8C status-board drift lesson, applied to data).

### M10-D13 — Late-added agents get account-subject envelopes by RE-MINT WITH SUPERSESSION (resolves review F1)
An account-subject envelope's plaintext exists only in holder wallets — the portal keeps no signal
state (M10-D12), the directory persists hash + metadata only (no payload — the no-PII posture), and
pickup ciphertexts are deleted on ACK. So "seal the existing envelope to a new agent" has **no
plaintext source** and the original §4.3 mechanism was unimplementable. Resolution: when the
mint-or-deliver pass finds an agent without a current account-subject envelope AND no sealed copy is
constructible, the portal **re-mints** (fresh `issued_at` → new hash → `supersedes_hash` chain) and
fans the sealed delivery to ALL the account's agents; the old envelope goes `superseded` normally.
This amends M10-D5's "agent-add is a no-op" to: **no-op on verification** (the fact is not
re-verified; still one envelope per fact, never per-agent envelopes), **supersede on delivery**.
Same-daemon optimization allowed: sibling agents under the same account on one daemon may copy the
content-addressed wallet row locally (the operator's own data — INV-AGENT-SCOPED governs *received*
signals, not your own wallet), avoiding the re-mint in the common case. **Disclosed residual:**
agent-add through the portal (the normal path — pre-auth minting is a portal touch) triggers the
pass immediately; an agent added out-of-band stays signal-less until the next portal touch —
fail-soft, visible in the UI (§6), accepted.
*Rejected:* (a) directory escrows envelope plaintext as opaque delivery blobs — breaks the
directory's hash-only/no-PII storage stance for a delivery convenience; (c) byte-deterministic
`compose()` so re-composition reproduces the hash — fragile (any claim-wording change breaks it)
and unverifiable at a distance.

## 2. Keys and custody (M10-D6, M10-D9 in operation)

- **Two KMS keys**, created by IaC (a new `cello-portal-keys.yaml` or an extension of the portal
  stack; deploy.sh discipline; `infra/STATE.md` updated): `cello/{env}/portal/signal-issuer` and
  `cello/{env}/portal/registry-signer`. Key policy grants `kms:Sign`+`kms:GetPublicKey` to the portal
  task role ONLY (the ops-agent explicitly excluded — the shared-secret indistinguishability of
  inv §3 must not be recreated in IAM).
- **`IssuerSigner` interface** in the portal (`sign(bytes) → signature`, `publicKey()`): KMS adapter
  in dev/prod, file adapter in local. Composition-root selection per `CELLO_ENV`, fail-at-startup if
  unconfigured (repo adapter rules).
- **Issuer-pubkey distribution:** operator runs a one-time `GetPublicKey` → seeds the directory's
  `authorized_issuers` table (§3.2) via migration/SSM parameter. Rotation = add new pubkey row, drain,
  retire old row — data operations.
- **Registry-pubkey distribution:** build-time constant in the client (M10-D9). The directory never
  holds it (it serves the registry without verifying — §3.4).

## 3. The directory surface (what DOD-DIR-WRITE-1 / REVOKE-1 / REGISTRY-1 / DIRDATA-READ-1 build)

All new routes live under `/internal/signal/*`, are **served over TLS** (the current `/internal/*`
plaintext-HTTP:80 exposure, inv §3, is not acceptable for a surface carrying personal-fact payloads —
adding the HTTPS listener/cert to the directory ALB is part of DOD-DIR-WRITE-1's deploy), and are
authenticated by **request signature, no bearer key**:

**Request format (all routes):** canonical-CBOR body
`{ v: 1, op, payload…, issued_at: epoch-seconds }`, signature = Ed25519 over
`"CELLO-TSIG-REQ-v1" || sha256(body)`, sent with the signer's pubkey hint. The directory verifies
the pubkey is in `authorized_issuers` with the right role and `status = active`, then verifies the
signature. Replay is harmless by construction (submit/revoke/registry-publish are idempotent;
`issued_at` is bounds-checked ±10 min as hygiene), so no nonce store is needed.

1. **`op: submit`** (DOD-DIR-WRITE-1) — payload carries the envelope bytes. Directory: re-hash
   (canonical component, M10-D7) → reject mismatch loud → `INSERT` into `signal_records`
   (idempotent on duplicate `signal_hash`) → if `supersedes_hash` present, mark the old row
   `superseded` → replicate. **Two normative rules that make replay harmless (review F3 — these
   are DIR-WRITE-1 clauses, not suggestions):** a duplicate-hash submit is a **strict no-op that
   never touches the existing row — `status` included** (an upsert here would let a replayed
   submit resurrect a revoked signal); and supersede-marking is the **transition
   `active → superseded` ONLY** (a replayed submit whose `supersedes_hash` points at a
   since-revoked row must NOT launder `revoked` into `superseded`). Negative AC owed: replay a
   submit after revoking its signal — status stays `revoked`. Events:
   `signal.submission.accepted/rejected` (+ reason, issuer, type-as-string, correlationId).
2. **`authorized_issuers` table** (with DOD-STORE-DIR-1's migration) — `(pubkey PK, role
   submitter|registry, status, added_at)`, replicated, seeded by migration. The set is DATA
   (spec §15.2.2); `issuer_kind: agent` intake lands post-v1 as new rows + a role, no API change.
3. **`op: query`** (read; also DOD-DIRDATA-READ-1's carrier) — three arms, same signed-request
   auth: (a) `signal_records` by `(subject_kind, subject[, type])` for portal idempotence
   (M10-D12) and the UI (§6); (b) the Class-3 aggregates (agent-keyed session/seal counts,
   clean-close attestations; aggregate-only, no content, no PII); (c) **verified-account-facts**
   (review F2 — the read DOD-MINT-INTERNAL-1's `verify()` uses): for an account, the
   already-verified fact state the directory holds — phone-verified presence + `phone_stub_hash`,
   email-verified presence + stub hash — **presence booleans and stubs only, never recoverable
   PII**. This retires the temptation to reach those facts through the condemned bearer-key
   routes. The aggregate mechanics for (b) (agent-keying, replicated inputs — the consistency
   clause on DOD-DIRDATA-READ-1) are that unit's design note; this determination fixes only the
   transport + auth shape.
4. **`op: registry-publish`** (DOD-REGISTRY-1) — payload is the signed registry document as opaque
   bytes (inner signature by the registry key; the directory does NOT verify it — clients do). The
   directory stores it and serves it at **public `GET /registry`** exactly like `GET /manifest`
   (inv §6.4): opaque bytes, no directory-side interpretation, INV-DIR-DUMB preserved. The wrapper
   signature (role `registry`) is what stops a random party overwriting the served registry.
   Directory refuses `version <` stored (anti-rollback server-side as hygiene; the client enforces
   its own).
5. **Revocation (`op: revoke`,** DOD-REVOKE-1**)** — payload `{signal_hash}`; authorization is
   **role-based for portal-issued records** (review F4): any ACTIVE `submitter`-role key may revoke
   a record whose `issuer_kind` is portal — the portal is one logical issuer and keys are rotating
   instruments, so `requester_pubkey == record.issuer_pubkey` would strand every old-key record
   unrevocable after a §2 rotation (or force keeping retired keys active, defeating retirement).
   Exact-pubkey match remains the model for `issuer_kind: agent` (post-v1 intake), where the key IS
   the identity. Directory sets `status = revoked` + `revoked_at`, replicates. Feed into
   DOD-REVOKE-1's design note.

**Registry document** (DOD-REGISTRY-1's design note refines): JSON, manifest-style — canonical body
(all fields except `signatures`, recursively sorted keys, UTF-8), Ed25519 by the registry key,
monotonic `version`, optional `not_before`/`expires`; entries `type → {class, status:
active|deprecated|retired, default_ttl_days, label}`. Client behavior copies the manifest poller
(inv §6.4): verify against the pinned pubkey, anti-rollback, every failure leaves the cache
untouched, absent type ⇒ valid-but-unclassified. **INV-CANONICAL scoping (review F7):** that
invariant governs the ENVELOPE hash — the four-party byte-agreement problem. The registry is not an
envelope and is never content-addressed; it deliberately follows the manifest's canonical-JSON
signing convention so the client reuses the one shipped, proven verifier instead of growing a second
signed-JSON-vs-CBOR path. State this in DOD-REGISTRY-1 so its reviewer doesn't trip on it.

**Legacy `/internal/*` surface (review F6 — explicit, not silent):** the bearer-key routes that are
NOT signal-related (`account-by-email-stub`, `agents-by-account`, `agent-write`'s remaining
`revocation_flag` lever, `pre-authorize`) are **accepted at launch as-is in auth model** — replacing
their auth is real cross-repo work with no M10 payoff — but they **move behind the HTTPS listener
DOD-DIR-WRITE-1 adds anyway** (near-free; plaintext-HTTP transport for login-critical calls is the
part that was indefensible). Bearer-key retirement for those routes is post-v1, tracked in the DoD's
Post-v1 section.

**Observability + operator-visible failure (review F5 — obligations, per surface):**
- `signal.mint.sign.failed` — KMS denial/throttle; the mint path's first real dependency. Surfaces
  to the operator per §6, never a silent skip.
- `signal.submission.accepted/rejected` — directory-side (above).
- `signal.registry.publish.rejected` — wrapper-auth or anti-rollback refusal.
- `signal.delivery.enqueue.failed` — sealed-copy enqueue failure; the mint is still notarized, so
  this is a retry-on-next-touch condition, logged loud, not an error swallowed into success.
- `signal.directory.failover` (per node tried) and `signal.directory.unreachable` (list
  EXHAUSTED — all 2–3 nodes down): failover is resilience, exhaustion **fails LOUD**, carrying
  forward today's honest `503`/`unreachable: true` posture (inv §2/§3). A permanent outage must
  never be masked as transient by the retry loop.
All events carry correlationId threading per the milestone's observability ACs.

## 4. Delivery to the holder — correct the M8 pipe, keep its bones

The running pipe (inv §5.1: seal → double-write → anchor+queue → push on the authenticated stream →
daemon opens, re-hashes against the anchor, stores, ACKs, fail-closed) is kept with four corrections:

1. **The blob becomes the canonical-CBOR envelope bytes** (was: canonical JSON) — the daemon's
   re-hash uses the shared component (M10-D7) and compares against `signal_records.signal_hash`
   (was: `identity_tree_entries`' mutate-in-place row, which retires with the seam — inv §5.3).
2. **The daemon writes to the M10 wallet table with `agent_id NOT NULL`** (DOD-STORE-CLIENT-1;
   kills the `agentId: null` defect, inv §9).
3. **Account-subject envelopes still fan out per-agent at DELIVERY** (sealed to each agent's
   `k_local` — sealing is per-recipient by nature and M10-D5 explicitly kept this, inv §10.7):
   ONE envelope, N sealed copies at mint time, each agent's wallet holding the same
   content-addressed row. A **later-added agent** is served per **M10-D13**: re-mint with
   supersession (fresh envelope, `supersedes_hash`, delivery fanned to ALL the account's agents),
   or the same-daemon local copy where applicable — never a portal- or directory-held plaintext
   (neither exists; review F1). Journey coverage owed: add an agent AFTER minting and verify its
   wallet receives the account-subject envelopes (now a DOD-T1-JOURNEY-1 clause).
4. **Enqueue moves inside the submit flow:** the portal seals per recipient agent and enqueues via
   the same signed surface (an `op: submit` field carrying sealed copies, or a follow-up
   `op: deliver` — DOD-DIR-WRITE-1's design note picks one; the pickup/ACK mechanics themselves are
   untouched).

Multi-daemon wallet sync stays parked (spec §14.11).

## 5. The portal's internal shape — per-type modules + one generic pipeline

```
src/server/trust/
  types/<type>.ts        ← the ONLY per-type code in the system (one file per type)
  mint.ts                ← generic: compose → scan → hash (crypto pkg) → sign (IssuerSigner) → submit
  submission-client.ts   ← generic: signed requests, failover list (M10-D11), idempotent retry
  registry.ts            ← generic: author + sign + publish the registry document
  track-record-job.ts    ← the Class-3 job (M10-D8): query aggregates → mint via mint.ts
  issuer-signer.ts       ← IssuerSigner interface + KMS/file adapters
```

**The per-type module interface** (the playbook's step-1/-2 target; portal-only, so zero-bump-clean):

```ts
interface SignalTypeModule {
  type: string;                    // stable forever — in the hash preimage
  schemaVersion: number;
  subjectKind: "account" | "agent";
  validityDays: number;            // → expires_at
  verify(ctx: MintContext): Promise<VerifiedFact>;   // the genuinely per-type work
  compose(fact: VerifiedFact): { claim: string; fields: Record<string, unknown> };  // self-describing payload
}
```

Modules register in a portal-side map keyed by `type`; `mint.ts` is the single chokepoint that runs
scan-before-hash (spec §6) and never special-cases a type. **v1 modules:** `phone`, `email`
(Tier 1 — `verify()` is a directory read of the already-verified fact: `phone_stub_hash` /
email-verified status live directory-side, inv §2; the portal attests "the directory verified this
at registration," it does not re-verify), `session_count`, `clean_close_rate` (Tier 3 — `verify()`
reads the §3.3 aggregates), `github` (Tier 4 — OAuth + extraction per the 2026-05-16 log).

## 6. The trust-signals UI scaffold → real

The page's 3 live cells read the portal's own Postgres and 8 cells are placeholders (inv §5.2). v1:
cells render from the **directory query route** (§3.3a) — the account's actual `signal_records`
(active/superseded/revoked/expired, by type) — plus per-type mint/re-verify actions that call
`mint.ts`. The portal's own-DB reads remain only for what the portal owns (passkey/TOTP enrollment
state). Cells for out-of-v1 types stay "coming soon" — honest, not fabricated (no-mocks rule).
**A failed mint action shows the operator the real reason** (review F5's traced gap): KMS denial,
all-directories-unreachable, or the directory's rejection reason — carried to the UI in the
`unreachable: true` honesty posture the portal already has (inv §2), never a silent no-op or a
generic "something went wrong" that buries the cause. Modest by design; UI polish is forgivable at
launch, wrong data is not.

## 7. Sequencing note — the backfill IS the migration

There is no data migration from the M8 scaffold. The four live M8 facts (WebAuthn, TOTP, phone,
email — spec §14.10) are **re-minted** as real envelopes through the new pipeline on next portal
touch (M10-D12 idempotence makes this a no-op after the first pass); the scaffold's
`identity_tree_entries` rows, the `SIGNAL_KINDS` enum, and the client's null-attributed
`trust_signals` table are then retired/dropped (DOD-STORE-CLIENT-1, DOD-DIR-WRITE-1). Alpha, no
users: re-mint beats migrate everywhere it's possible (M10-D4's drop-and-re-mint precedent).

## 8. What this determination does NOT decide

- The **aggregate consistency mechanics** for Class-3 (replicate inputs vs compute-from-replicated;
  agent-keying) — DOD-DIRDATA-READ-1's design note, per its consistency clause.
- The **exact registry JSON schema** and the **submit-vs-deliver enqueue split** — the REGISTRY-1 /
  DIR-WRITE-1 design notes.
- The **browser-extraction instance** — DOD-EXTRACT-DESIGN-1 (Tier 4 gate), untouched here.
- The **`SignalRequirementPolicy` field set** — DOD-FLOOR-1's design note.
- Anything multi-daemon (parked, spec §14.11).

---

## Related Documents

- [[M10-PORTAL-ARCH-INVESTIGATION]] — the evidence this is written against (facts cited as inv §N)
- [[M10-DEFINITION-OF-DONE]] — DOD-PORTAL-ARCH-1; decisions M10-D6…D12 logged there
- [[M10-PROCEDURE]] — §6 design-note obligations this hands to the Tier 1/3 units
- [[M10-TRUST-SIGNAL-STORAGE-AND-CREATION]] — spec-of-record (HOW) this architecture implements
- [[M10-TYPE-PLAYBOOK]] — step 1/2 of every playbook run lands in §5's `SignalTypeModule`
- [[2026-05-16_0800_trust-signal-verification-architecture|Trust Signal Verification Architecture]] — the GitHub module's basis (Tier 4)
