---
name: M10 Portal Architecture — Investigation (evidence half of DOD-PORTAL-ARCH-1)
type: design
date: 2026-07-11
milestone: M10
status: active
topics: [m10, portal, trust-signals, architecture, investigation, key-custody, zero-bump, delivery, background-jobs]
description: >
  The evidence half of DOD-PORTAL-ARCH-1: what the portal, directory, and client ACTUALLY are today,
  read from code, with file-level citations. No design, no recommendations — facts, plus the forks the
  architecture half must decide and the DoD lines this evidence reshapes. The architecture
  determination is a separate document written against this one.
---

# M10 — Portal Architecture Investigation (evidence)

**Scope.** DOD-PORTAL-ARCH-1 has two halves. This is the FIRST: *investigate the portal as it actually
is*. It records only what is true today, with citations. The architecture determination (interfaces,
key custody, job home, delivery) is written against this document, not from recall.

**Method.** Six parallel read-only investigations across the three repos (cello-portal, trustless-cello,
cello-client) at HEADs: portal `776752d`, and the current mains of the other two. Every claim below is
cited to `path:line`.

---

## 0. The headline findings (what a designer must know before deciding anything)

1. **The portal is LIVE in AWS.** The M10-PROCEDURE and BUILD-JOURNAL both state "no deploy pipeline
   exists — the portal runs locally/dev for this milestone." **That is false** and it invalidates the
   premise of two DoD lines. See §4.
2. **The M8 trust pipe already exists end-to-end** — portal → directory → daemon, with a sealed
   ciphertext, an anchor hash, a pickup queue, and an ACK. M10 does not invent delivery; it replaces a
   scaffold. See §5.
3. **That scaffold violates three M10 invariants as built** (per-type enum in the directory, mutate-in-
   place, JSON-not-CBOR hashing). It is prior art to *correct*, not to extend. See §5.3.
4. **INV-CHOKEPOINT does not exist today.** Portal→directory auth is one shared static bearer header
   over plaintext HTTP on a public ALB, and it is the same secret the ops-agent holds. See §3.
5. **The portal holds no signing key of any kind.** There is no issuer identity to authorize. See §6.
6. **AWS KMS supports Ed25519 natively** (`ECC_NIST_EDWARDS25519`) — the issuer key can live in KMS and
   the portal can hold nothing. See §6.3.
7. **Class-3 track record is already computed** — in the wrong key, unreplicated, and unexposed. See §7.
8. **The portal has zero background-job machinery** and Next 16's `after()` cannot host a long-running
   job. The Class-3 job home is a genuinely new process. See §4.2.

---

## 1. The portal as it is

**Runtime.** Next.js **16.2.9** (exact pin), React 19.2.4, App Router only, `output: "standalone"`,
single Node process (`CMD ["node", "server.js"]`, `Dockerfile:40`), port 3000, Node 24. No
`export const runtime` anywhere in `src/` — everything is the default `nodejs` runtime. Next 16's
`middleware` is renamed `proxy` and the portal uses it (`src/proxy.ts:13`), checking cookie *presence*
only; real auth is server-side (`src/app/(app)/layout.tsx:22-34`).

> AGENTS.md is a five-line banner: "this is NOT the Next.js you know — read `node_modules/next/dist/docs/`."
> That warning is load-bearing and was honored for every Next claim here.

**Auth/session model** (`src/server/session.ts`, `session-cookie.ts`, `migrations/0001_init.sql:18-31`):
- Cookie `cello_portal_session` — an **opaque 32-byte random bearer token**, not a JWT, not signed, not
  encrypted. The DB stores only `sha256(token)` (`session.ts:21-23,46`). httpOnly, sameSite=lax,
  secure outside `local`.
- 30-day TTL (`session.ts:19`). **No rotation on privilege change** — `auth_level` is mutated in place
  (`session.ts:70-75`).
- **There is no sign-out route.** `revokeSessionByToken` and `clearSessionCookie` have zero call sites;
  only "log out everywhere" exists (`/api/account/sessions/revoke-others`).
- Two distinct gates, and the distinction is load-bearing:
  - **Strong-auth wall** (the 7-day cliff) — satisfied by **confirmed TOTP only**; a passkey does *not*
    lift it (`auth/strong-factor.ts:29-31`, `strong-auth-wall.ts:17-38`).
  - **Step-up** (5-min freshness) — satisfied by passkey **or** TOTP (`strong-factor.ts:13-16`).
    Gates the six mutation routes including `POST /api/agents/suspend`.

**Identity.** The portal user is an `account` row whose PK `account_id` **is the directory's account
id** — the portal mints no identity of its own. It is obtained by
`resolveAccountByEmailStub(sha256(email))` against the directory; no directory match ⇒ no account, no
session (`src/server/account.ts:17-19`, `magic-link.ts:84-92`). Email is stored **only** as envelope
ciphertext (`account.email_ciphertext`).

---

## 2. The portal's database

Postgres (RDS in prod, docker-compose port 55432 locally). **Five migrations, `0001`–`0005`; the next
number is `0006`.** Hand-rolled runner (`src/server/migrate.ts`): lexical order, SHA-256 checksum per
file, **one transaction per file**, `schema_migrations` tracking table, and it **throws on a checksum
mismatch** ("never edit an applied migration"). It runs from three places — `pnpm migrate`, **server
boot** (`src/instrumentation.ts:19`, which `process.exit(1)`s on failure so ECS never serves an
unmigrated DB), and vitest (which drops and recreates `public` first). No advisory lock; no down/rollback.

Tables: `account`, `sessions`, `webauthn_credentials`, `totp_secrets`, `backup_codes`,
`magic_link_tokens`, `magic_link_requests`, `webauthn_challenges`, `auth_verify_attempts`.

**Three facts that matter for M10:**

- **There is no `agents` table, no `phone` table, no `trust_signals` table.** The portal persists
  *nothing* about agents — `getAccountAgents()` calls the directory live and, on failure, returns an
  honest empty list with `unreachable: true` rather than a cached or fabricated one
  (`src/server/agents.ts:15-28`). `account_id` is the **only** stable local anchor an M10 table could
  FK to.
- **Phone does not exist in the portal at all** — not a column, not a route, not a code path. The only
  "Phone" is a UI placeholder (`trust-signals/page.tsx:102`). `phone_stub_hash` lives in the
  *directory's* `user_accounts`. DOD-MINT-INTERNAL-1 mints phone from a fact the portal does not hold.
- **Two tables are keyed on a mutable attribute** — `magic_link_tokens` and `magic_link_requests` key
  on `email_stub_hash` with no (or a nullable) account FK. Per the repo's join-on-the-stable-key rule
  this is a pre-existing smell; M10 must not copy it.

---

## 3. The portal → directory seam, and why INV-CHOKEPOINT is net-new

**The client** (`src/server/directory/client.ts:44-67`) has exactly three methods, all POST:

| Method | Path |
|---|---|
| `resolveAccountByEmailStub` | `/internal/account-by-email-stub` |
| `listAgents` | `/internal/agents-by-account` |
| `writeAgent` | `/internal/agent-write` |

`AgentWrite` is a three-arm union (`client.ts:22-25`): `revocation_flag` · `trust_signal_hash` ·
`trust_signal_ciphertext`.

**Authentication — a single shared static bearer header. Nothing else.**

Portal side (`http-client.ts:54-61`) sends `"x-cello-internal-api-key": this.apiKey`. Directory side
verifies it with a **non-constant-time `!==`**, copy-pasted into all four handlers
(`internal-api-server.ts:77, 199, 270, 345`):

```ts
const providedKey = req.headers["x-cello-internal-api-key"];
if (!providedKey || providedKey !== internalApiKey) { /* 401 */ }
```

Facts that follow, each cited:
- **No request signing, no mTLS, no nonce, no timestamp, no replay protection.**
- **The same secret is shared with the ops-agent** (`infra/cloudformation/cello-ecs-directory.yaml:189-192`),
  so the portal and the ops-agent are **indistinguishable** to the directory. Any key-holder can call
  any `/internal/*` route — including `/internal/pre-authorize` (mint a registration capability) and
  `/internal/agent-write` for **any** `accountId`.
- **It crosses the public internet in cleartext.** The directory's ALB listener is HTTP:80
  (`cello-ecs-directory.yaml:317-322`) and `/internal/*` is forwarded to it
  (`:390`). The CFN comment states source-IP restriction was deliberately removed and "the API key
  header is the sole access control" (`:377-386`) — which **contradicts** the code comment at
  `internal-api-server.ts:16-18` claiming the ALB rejects `/internal/*`.
- **`accountId` arrives in the request body** (`internal-api-server.ts:371`). The directory's
  `isAgentOwnedByAccount()` check (`agent-write-repository.ts:21-31`) proves the *agent* belongs to the
  *claimed* account — it cannot prove the caller was entitled to claim it.
- **There is no authorized-issuer / portal-pubkey concept anywhere.** Grep for
  `portal_pubkey|authorized_issuer|issuer_pubkey` across `packages/` and `infra/` returns nothing for
  the portal. The only pinned-pubkey precedent is `CELLO_PREAUTH_ISSUER_KEY_HEX` — the *directory*
  signing pre-auth capabilities that other directories verify (M8B-PREAUTH-CAP,
  `directory.ts:788-815`). It is the shape to copy, but it is not about the portal.

**Directory endpoint config:** the portal is pinned to **ONE node** — a single `DIRECTORY_API_URL`
(`config.ts:88`), defaulting to `directory-us1` in prod (`cello-portal-app.yaml:23-26`). No node list,
no failover. Writes reach the other two sovereign nodes by the directory's own replication, not by the
portal. A us1 outage degrades the portal honestly (503 / `unreachable: true`) but it does not route around.

> **Consequence for M10.** "A hash enters the directory ONLY via a signed submission from an authorized
> issuer key" (INV-CHOKEPOINT) is **not a hardening of today's path — it is a new property.** Today a
> hash enters on possession of a shared secret that a second service also holds, sent in the clear.

---

## 4. Deploy shape and background-job capability

### 4.1 The portal is deployed (the docs say otherwise — they are wrong)

`infra/STATE.md:380`: **"M8 operator portal — LIVE + OPERATOR-VERIFIED (deployed 2026-06-28; exercised
2026-06-29, us-east-1)."** Live at **https://portal.cello.mygentic.ai**, current image
**`cello-portal:776752d`** (= repo HEAD).

- **ECS Fargate**, `DesiredCount: 1`, one container, port 3000, behind a public HTTPS ALB with ACM +
  Route53 (`cello-portal-app.yaml:148-270`).
- **RDS Postgres** `cello-portal-dev...us-east-1.rds.amazonaws.com` (db.t4g.micro).
- Deployed by `infra/deploy-portal.sh`; image built **in AWS by CodeBuild** from the committed HEAD
  (`infra/build-portal.sh`) — never docker-pushed from a laptop.
- Secrets already provisioned: `cello/{env}/portal/kms-master-key` (**create-once**) and `database-url`
  (`infra/create-portal-secrets.sh`).
- **Single-region us-east-1** — deliberately not the 3-region shape (`STATE.md:481`). The portal is
  *not* a sovereign node and does not need to be.
- The container **already has an IAM task role** — SES is called with no static credentials
  (`src/server/email.ts:14-26`).

**Therefore:** the DoD's "where a private key can safely live in this deployment shape" must be answered
for **Fargate + Secrets Manager + IAM task role + KMS**, not for a laptop. And portal deploys now belong
in the batching discipline (§2c) alongside the directory's.

### 4.2 There is no background-job machinery, and `after()` cannot be one

Grep across `src/`: **zero** hits for `after(`, `waitUntil`, `setInterval`, `node-cron`, `BullMQ`,
`Queue`, `Worker(`, `maxDuration`. The only past-the-response work is two bare floating promises
(`magic-link.ts:121` SES send; `session.ts:63` `last_seen_at` touch) — unmanaged, lost if the process dies.

From the **installed** Next's own docs:
- `after()` **is** available (`next/server`), usable in Route Handlers, and **fully supported when
  self-hosting** (`self-hosting.md:297`).
- But: *"`after` will run for the platform's default or configured max duration of your **route**"*
  (`after.md:50`). It is bounded by the request lifetime — **it is not a worker.**
- `maxDuration` is a *build-output hint* for platforms; under a self-hosted `node server.js` on ECS
  nothing enforces or extends it (`maxDuration.md:6`).

The **only** existing escape hatch into arbitrary long-lived Node code is `src/instrumentation.ts`'s
`register()` hook (which today runs migrations and hard-exits on failure). There is **no** second
process, no worker, no scheduled task, no queue, no Lambda anywhere in the portal's deploy
(`cello-portal-app.yaml` has no `ScheduledTask`/`Rule`/`Schedule`).

**Therefore:** DOD-TRACK-1's Class-3 job has no home today. The decision is a real one (in-process
scheduler in `instrumentation` vs. a second ECS container vs. an EventBridge-scheduled ECS task vs. a
Lambda) and it is shaped by ECS, not by Next.

---

## 5. The M8 trust pipe — already built, end to end

This is the single most important discovery: **delivery to the holder is a solved, running problem.**

### 5.1 The path, in order

1. **Portal composes + seals.** `src/server/trust/handoff.ts:67-111` — `canonicalJson(record)` → `hash()`
   → hex `signalHash`; then, **per agent**, `sealToRecipient(agent.kLocalPubkey, jsonBytes)`
   (`@cello-protocol/crypto`).
2. **Portal writes twice** through `agent-write`: `trust_signal_hash`, then `trust_signal_ciphertext`
   (`handoff.ts:86-99`), each with bounded retry on transient errors only.
3. **Directory stores.** Hash → `identity_tree_entries` (PK `(agent_id, signal_kind)`); ciphertext →
   `pickup_queue` (`agent-write-repository.ts:83-124`), with a partial unique index enforcing one
   pending blob per (agent, kind).
4. **Directory pushes.** On the agent's authenticated signaling stream, a `trust_signal_pickup` frame
   carrying `{id, signal_kind, signal_hash, ciphertext}`. `drainPickupForAgent` LEFT JOINs
   `identity_tree_entries` so **the authoritative hash rides with the blob**
   (`pickup-repository.ts:27`).
5. **Daemon verifies and stores.** `daemon.ts:4872-4943` — `openContentSeal(ciphertext)` (only the
   daemon can open it), recompute `sha256(plaintext)`, **compare against the directory's anchor**, and
   only on match store into the local SQLCipher `trust_signals` table.
6. **Daemon ACKs.** `trust_signal_ack` → directory `DELETE`s the ciphertext. **No ACK on any failure**,
   so the directory retries. Fail-closed.

The crypto: `sealToRecipient` / `openSealed` (`core/crypto/src/content-seal.ts`) — X25519 ECDH derived
from the recipient's Ed25519 identity → HKDF-SHA256 → AES-256-GCM. **It requires no sender private
key** — which is exactly why the current pipe is *unsigned* (§6).

### 5.2 What is real vs. hollow

| Piece | Status |
|---|---|
| Portal seal + double-write | **Real**, one caller: WebAuthn enrollment (`register/verify/route.ts:74-77`), best-effort (failure only logs) |
| Directory anchor + pickup + ACK + retry | **Real**, replicated, restart-safe |
| Daemon open → re-hash → verify → store | **Real**, fail-closed |
| `trust_signals` row attribution | **BROKEN — `agentId` is written as `null`** (`daemon.ts:4920`) |
| Any consumer of `trust_signals` | **NONE.** No MCP tool, no IPC method, no LLM projection. Nothing reads it outside its own tests. |
| The trust-signals UI | **Placeholder.** 3 live cells (passkey/TOTP/email) read the *portal's own* Postgres, never the directory; 8 cells are "coming soon" (`trust-signals/page.tsx`) |

### 5.3 Where the scaffold violates M10's invariants

Three, all in code, all blocking if extended rather than replaced:

1. **INV-ZERO-BUMP** — `agent-write-validation.ts:20`: `const SIGNAL_KINDS = new Set(["webauthn"]);`
   with the comment *"extend as new M-stories land consumers."* That is a **per-type enum in the
   directory** — precisely the construct the invariant forbids, and its comment invites the violation.
   `hasExactKeys()` (`:37`) additionally means no payload key can change without editing the validator.
2. **INV-SUPERSEDE-NOT-MUTATE** — `identity_tree_entries` upserts
   `ON CONFLICT (agent_id, signal_kind) DO UPDATE`. One current hash per (agent, kind), **overwritten
   in place**. M10 requires a new content-addressed row carrying `supersedes_hash`, with the old row
   marked `superseded`.
3. **INV-CANONICAL** — the handoff hashes **canonical JSON** (`handoff.ts:43-51`), not canonical CBOR.
   Spec §5 requires CBOR as the hashed form and JSON as a never-hashed display projection.

---

## 6. Key material — what exists, and what M10 needs

### 6.1 The portal holds no signing key

Exhaustive grep (`ed25519|private.?key|signingKey|nacl|noble`) across `src/ scripts/ test/ e2e/`:
**no Ed25519 keypair, no FROST share, no signing key of any kind.** WebAuthn stores only *public* keys.
Session tokens are random bearers. Magic-link and backup-code hashes are **unkeyed** SHA-256 — no pepper.

**The M8 trust pipe is therefore seal-only and unsigned:** `sealToRecipient()` needs only the
*recipient's* public key plus an ephemeral sender key, so the portal encrypts *to* the agent while
authenticating *nothing*. There is no sender-authentication material in the portal today.

### 6.2 What `kms.ts` actually is (it is not KMS)

`src/server/kms.ts` is a **local, in-process AES-256-GCM envelope cipher**. No AWS KMS client is
imported anywhere. Master key = `PORTAL_KMS_MASTER_KEY`, a 32-byte hex value read **from an env var**
(`config.ts:73-82`), defaulting under `CELLO_ENV=local` to a **source-published all-zeros key**. Its two
consumers are `account.email_ciphertext` and `totp_secrets.secret_ciphertext`. The file itself states
the AWS adapter is future work (`kms.ts:16-18`) — so **production is currently running the local
adapter**, with the master key injected from Secrets Manager.

The interface (`EnvelopeCipher`, `kms.ts:20-23`) is an explicit, adapter-independent swap point.

### 6.3 AWS KMS supports Ed25519 natively — verified against the current docs

AWS KMS asymmetric key specs now include **`ECC_NIST_EDWARDS25519` (ed25519), signing and verification
only**, with signing algorithms `ED25519_SHA_512` (requires `MessageType: RAW` — pure EdDSA, FIPS 186-5
§7.6) and `ED25519_PH_SHA_512`. The private key **never leaves KMS**; `GetPublicKey` downloads the
public key for offline verification (e.g. by `@noble/curves` in the directory and client).
KMS also now offers `ML_DSA_44/65/87`, which is relevant to the protocol's existing ML-DSA swap path.

*(Source: AWS KMS Developer Guide, "Key spec reference", fetched 2026-07-11.)*

This makes a **portal that holds no private key at all** a real option, not an aspiration.

### 6.4 The precedent that already exists in this codebase

The **consortium manifest** is the template for "signed data served as opaque bytes" (which
DOD-REGISTRY-1 needs):
- Signed **offline by officers** with Ed25519, seed pulled from Secrets Manager
  (`infra/scripts/sign-consortium-manifest.mjs:68`). Dev = 1 officer, threshold 1.
- Canonical body = all fields except `signatures`, keys sorted **recursively**, no whitespace, UTF-8.
- The directory **serves it without verifying it** — *"the directory is only a transport for the
  manifest"* (`file-directory-manifest-store.ts:11-14`). Rotation = drop a new signed file beside it.
- The client fetches it over **unauthenticated HTTP** (`GET /manifest`), verifies a **threshold
  signature against locally-pinned root keys**, and enforces **anti-rollback** (`version <` last-seen is
  refused), `not_before`, and `expires` (`core/daemon/src/http-manifest-poll.ts`). Every failure leaves
  the cached manifest untouched. Polled every 6–12h, randomized.
- Invariant: **nothing agent-specific ever goes in the manifest** — which is exactly why serving it
  unauthenticated is safe.

---

## 7. Class-3 track record — already computed, in the wrong shape

**The aggregate exists.** `pseudonym_stats` (`V7__analytics_tables.sql:51`) holds `conversation_count`,
`unique_counterparty_count`, `clean_count`, `flagged_count`, `last_activity` — computed by
`analytics-job.ts:403-432` from `conversation_participation` ⋈ `conversation_seals` ⋈
`conversation_attestations` (CLEAN/FLAGGED). That is DOD-TRACK-1's *session count* and *clean-close
rate*, already being calculated.

**Three problems, each of which shapes Tier 3:**

1. **Wrong key.** It is keyed on **`pseudonym`**, not `agent_id`. M10 envelopes are subject-bound to an
   agent identity.
2. **Zero exposure.** Grep-verified: `pseudonym_stats` appears only in `analytics-job.ts` and V7/V8.
   **No HTTP route, no WS frame, no repository accessor.** DOD-DIRDATA-READ-1 is building a read path
   that does not exist in any form.
3. **Not replicated — and neither are its inputs.** `pseudonym_stats`,
   `conversation_participation`, and `conversation_attestations` are **absent from `PUBLICATION_TABLES`**
   (`infra/setup-replication.sh:169`). Each node computes from only the data it happens to hold, so the
   three sovereign nodes **may not agree on the numbers**. A signal minted from node A's view is not
   reproducible from node B's.

> DOD-DIRDATA-READ-1 is therefore not "expose an existing aggregate." It is: make the aggregate
> agent-keyed, make it consistent across sovereign nodes, *then* expose it. That is materially more
> work than the DoD line currently implies.

---

## 8. Replication rules for a new `signal_records` table (DOD-STORE-DIR-1)

Mechanism: **native Postgres logical replication**, full mesh of the 3 regional RDS instances.
Publication `cello_pub` on each node; each subscribes to the other two (6 slots); `origin = none`
breaks loops.

A new table must do **four** things, each learned the hard way in a prior migration:

1. **Be added to `PUBLICATION_TABLES`** — the single comma-separated source of truth at
   `infra/setup-replication.sh:169` — and the script re-run. Existing subscribers **only** pick up a new
   table after `ALTER SUBSCRIPTION … REFRESH PUBLICATION` (`:537`), which the script does.
2. **Use a globally-unique PK.** `BIGSERIAL` **collides across nodes and halts the subscription** (V34
   header). Older tables stagger sequences (`INCREMENT BY 3`); the **current, preferred pattern is a
   UUID PK** (`gen_random_uuid()`) — V39 converted `pickup_queue` to exactly this. `signal_records`'
   natural PK is the content hash, which is globally unique by construction.
3. **Set `REPLICA IDENTITY`** (V38/V39) and grant the DML the app actually performs — both V38 and V39
   had to retrofit missing `GRANT UPDATE`.
4. **Gate any delete/GC path on `owning_node_id`.** V39 added this to `pickup_queue` after identifying
   the hazard verbatim (`pickup-repository.ts:79-85`): a node whose replica has not yet converged could
   see an anchor as absent, delete a still-deliverable row, **and replicate that delete federation-wide.**

Flyway is at **V45**; `OpsAgentExpectedMigrationVersion` is `"45"`
(`infra/cloudformation/cello-ssm-parameters.yaml:36`) and **must** be bumped with any new migration or
the ops-agent crash-loops.

**Stale comment to fix:** `pickup-repository.ts:80-81` asserts *"pickup_queue is NODE-LOCAL today (NOT in
cello_pub)"*, but `setup-replication.sh:169` **does** list `pickup_queue`. One of the two is wrong;
verify against the live publication.

---

## 9. The client — what M10 builds on and what it must fix

**Packages** (cello-client): `crypto` 0.0.18, `protocol-types` 0.0.19, `transport` 0.0.17, `gateway`
0.0.1, **`daemon` 0.0.47**, `client` 0.0.48, **`adapter-claude-code` (= `@cello-protocol/connect`)
0.0.65**, `cli` 0.0.45.

**The DB.** `~/.cello/sessions.db`, `@signalapp/sqlcipher`, key = a random 32-byte **0600 key file**
beside the DB; fail-closed, no plaintext fallback (`sqlcipher-db.ts`). **There is no migration
framework** — the schema is applied imperatively at daemon init via `CREATE TABLE IF NOT EXISTS` +
PRAGMA-guarded `ALTER TABLE` (`session-node-manager.ts:495-708`). One-time rebuild migrations exist
(`agent-id-migration.ts` re-keyed 7 child tables in one transaction).

**`trust_signals` already exists** (`db-identity-store.ts:182-190`): `signal_hash` PK, **nullable
`agent_id`**. Two defects M10 inherits:
- **`agentId` is written as `null`** (`daemon.ts:4920`). INV-AGENT-SCOPED requires a per-agent FK to the
  contact row on `agent_id`; today the row is not attributed to any agent at all.
- **Nothing reads it.** No consumer surface of any kind.

**The per-agent contact row** is `contacts (agent_id, pubkey)` (`session-node-manager.ts:633-647`) —
the FK target for the recipient-side cache. Note it declares **no FK** to `agents(agent_id)`; the daemon
tables use bare composite PKs.

**Where presented signals would ride.** Outbound: the `session_request` frame built at
`daemon.ts:1374-1381` — today `moniker` is the only identity-ish field on it. Inbound: `session_assignment`,
parsed and validated at the wire boundary (`session-assignment-parser.ts:193-215`) — invalid values are
**rejected, never stripped**.

**CBOR is already here.** `cbor-x` is a direct dependency of `daemon`, `client`, and `protocol-types`,
with an established deterministic-encoding convention: `new Encoder({ tagUint8Array: false })`, citing
RFC 8949 §4.2.1 (`connection-package.ts:55-59`). DOD-CBOR-1 does not need a new library in the client —
it needs the *same* profile reproduced in the portal.

**Framing prior art (INV-FRAMING).** Message content is currently handed to the LLM **raw and unwrapped**
(`daemon.ts:5901-5907`) — no delimiter, no untrusted-content wrapper. The defenses that exist are the
**gateway** (screen-at-ingest, `session-node-manager.ts:3334`; fail-closed; passthrough unless
configured) and the **rename notice**, which is the one place the daemon quotes untrusted text to the
LLM as an explicit *claim*: *"now calls themselves "X" (self-declared — unverified). Adopt it: … or
ignore."* (`daemon.ts:5993-6004`). **That is the pattern `issuer_kind: agent` framing should follow.**

**Unwired-but-designed.** `core/protocol-types/src/connection-package.ts` defines `ConnectionPackage
{pseudonym_binding, endorsements[], attestations[]}` with canonical-CBOR TBS and ML-DSA signatures, and
`core/client/src/connection-policy.ts:176` evaluates it. **The daemon references none of it.** The
legacy `core/client` V2 SQL schema also has `endorsements`/`attestations` tables keyed on
`agent_pubkey`. Treat all of it as prior art, not as a foundation — it is unwired and mis-keyed.

---

## 10. What this evidence CHANGES in the DoD (edits owed before Tier 0 code)

Per PROCEDURE §4, downstream lines the architecture reshapes are edited **now**, not discovered mid-build.

1. **PROCEDURE §2a + BUILD-JOURNAL RESUME STATE — factually wrong.** "No deploy pipeline exists — the
   portal runs locally/dev for this milestone." The portal is **live on ECS Fargate in us-east-1**.
   Fix the text; add portal deploys to the batching discipline.
2. **DOD-PORTAL-ARCH-1's key-custody clause** — "where a private key can safely live in this deployment
   shape" must be answered for Fargate + IAM task role + Secrets Manager + **KMS (which supports
   Ed25519)**, and the live option "the portal holds no private key at all" must be on the table.
3. **DOD-MINT-INTERNAL-1** — assumes the portal can mint phone. **The portal has no phone data.** The
   fact lives in the directory's `user_accounts.phone_stub_hash`. The line needs a source for the claim.
4. **DOD-STORE-CLIENT-1** — is partly a **fix, not a build**: `trust_signals` exists but writes
   `agent_id = null`. Add an explicit clause to attribute it, or INV-AGENT-SCOPED is violated at birth.
5. **DOD-DIR-WRITE-1** — must **replace** the `agent-write` seam's `SIGNAL_KINDS` enum, not extend it,
   and must state that the shared-bearer-key model is superseded by signed submissions.
6. **DOD-DIRDATA-READ-1 / DOD-TRACK-1** — materially bigger than written: the aggregate is
   pseudonym-keyed, unexposed, and **its inputs are not replicated**, so nodes may disagree. Needs a
   consistency clause.
7. ~~**A new invariant is owed: INV-SUBJECT-BINDING.**~~ **RESOLVED — M10-D5 (2026-07-11, Andre;
   spec §3.2).** The envelope gained `subject_kind: account | agent` (both hashed): phone/email/social
   are account-subject (one envelope, every agent presents it), track record is agent-subject (both
   scopes possible by aggregation), endorsements may target either. M8's per-agent fan-out
   (`handoff.ts:77-81`) is overturned for account-level facts — note the M8 pipe fans out the sealed
   *delivery* per agent's k_local, which remains fine for delivery even under an account-subject
   envelope. `CONTEXT.md`'s account-level attachment model is substantially ratified rather than
   contradicted.

---

## 11. The forks the architecture half must decide

Stated as forks, with the evidence each turns on. Recommendations (explicitly NOT decisions) are in
§12; they graduate to the DoD Decisions section only via the architecture determination + review.

1. **Issuer key custody.** (a) Ed25519 **in KMS**, portal calls `kms:Sign`, holds nothing — strongest
   containment, one API call per mint (cost/latency on the Class-3 batch), per-region key material, IAM
   is the real boundary. (b) **KMS-as-wrapper** — KMS decrypts an Ed25519 private key at boot, signing
   in-process (the `EnvelopeKeyProvider` pattern the directory already uses for K_server shares) — fast
   and offline-capable, but the raw key sits in container memory. (c) Env var / Secrets Manager plaintext
   — what the master key does today; weakest.
2. **Where the canonical-CBOR component lives** (DOD-CBOR-1's deferred clause). `@cello-protocol/crypto`
   is already a portal dependency and `cbor-x` is already in the client with a deterministic profile —
   but publishing to the portal couples it to the client's release cascade. Vendored-spec-with-vectors
   is the alternative. **Divergence is the enemy** (a hash that differs per party is a censorship-shaped
   correctness bug), which argues one implementation.
3. **The Class-3 job's home.** In-process scheduler under `instrumentation.register()` (the only existing
   hatch) · a **second ECS container** in the same task · an **EventBridge-scheduled ECS task** · Lambda.
   Next's `after()` is disqualified by evidence (request-bounded).
4. **Registry serving.** The manifest is the precedent and it fits almost exactly: offline-signed,
   canonical body, served as opaque bytes by an endpoint that does not verify it, client-side threshold
   verify against pinned keys, anti-rollback, TTL poll. Open: does the registry reuse the **officer**
   keys and threshold, or the **portal** issuer key (one signer)? Reusing officers gets threshold
   security but puts the portal's release cadence behind an offline ceremony.
5. **Submission transport.** Extend the existing `/internal/agent-write` seam (now signed) vs. a new
   dedicated `/internal/signal-submit` route. The existing seam carries an `AgentWrite` union whose arms
   are per-type-ish; a new route can be born type-blind.
6. **Portal→directory availability.** The portal is pinned to **one** node with no failover, while
   availability is a first-class protocol concern (repo CLAUDE.md). Does the submission client learn the
   manifest and route around a down node, or is single-node acceptable for the write path (since
   replication fans it out)?
7. **Subject binding** — per-agent fan-out (M8's de facto answer) vs. an Account-subject envelope.
   See §10.7.

---

## 12. RECOMMENDATIONS on the forks — not decisions

> **Status: RECOMMENDATIONS ONLY (2026-07-11, Andre: "all seem sensible").** Nothing here is settled.
> Each becomes a decision only when the architecture determination (half 2) adopts it, survives
> `cello-unit-reviewer`, and is logged in the DoD Decisions section. Numbering matches §11.

**R1 — Issuer key custody: Ed25519 in KMS (`ECC_NIST_EDWARDS25519`); the portal calls `kms:Sign` and
holds no private key.** Mint volume is tiny (portal touches + a nightly job), so per-sign latency and
cost are irrelevant — which removes the only real argument for the KMS-as-wrapper option. A compromised
portal container can *request* signatures (every one visible in CloudTrail) but can never exfiltrate
the key: an incident is time-bounded and auditable, and recovery is an IAM policy change, not a key
rotation. For a cryptographic notary this is the custody a competent engineer would pick at negligible
cost. Local dev: a file-based signer behind the same interface (the adapter-pattern rule); the
directory pins the pubkey obtained via `GetPublicKey` as data in its authorized-issuer set.
*Rejected:* (b) KMS-as-wrapper — puts the raw key in container memory for a speed win nothing needs;
(c) env-var/Secrets-Manager plaintext — the weakest, and the master-key precedent it copies is itself
slated for upgrade.

**R2 — Canonical-CBOR component: ONE implementation, published in `@cello-protocol/crypto`.** Crypto
already holds the precedent (the canonical TBS builders and `hash()` live there) and is already the
portal's sole `@cello-protocol` dependency — no new coupling, just a version bump. The
cascade-coupling worry is small because the envelope is frozen by design (spec §15.3): the component
ships once in Tier 0 and rarely changes. *Rejected:* vendored-spec-with-vectors — three hand-kept
byte-identical implementations is the §7 scanner-version drift problem in another costume; vectors
catch the divergences you thought of, not the Unicode/bignum edge case you didn't.

**R3 — Class-3 job home: in-process scheduler started from `instrumentation.register()`, job code in
its own module behind a clean entrypoint.** The classic objection to in-process cron — duplicate runs
under scale-out — does not apply at `DesiredCount: 1` (add a Postgres advisory lock the day it does).
The job is minutes of light work against an always-on process. Because it is a module with an
entrypoint, promoting it to a separate worker later is a routing change, not a redesign — the same
shape as the Endorsement Mother launch compromise. A job crash must never kill the server process;
fail loud in logs. *Rejected:* second container / EventBridge-scheduled ECS task — doubles the deploy
surface for a nightly job; Lambda — re-packages crypto + the submission client outside the Next build.

**R4 — Registry signing: a dedicated portal registry key (own KMS key, single signer), NOT the officer
threshold; clients pin its pubkey as a build-time constant beside `BUNDLED_CONSORTIUM_ROOT_KEYS`.**
The registry changes every few days early on — that cadence is the entire zero-bump point, and an
offline officer ceremony per type addition kills it. The officer threshold protects the network's
trust ROOT; the registry is fail-soft metadata (absent/unverifiable ⇒ valid-but-unclassified, never
rejected — INV-TYPE-CARRY), so a compromised registry key can cause classification mischief but cannot
forge a signal. Separate key from the submission key: different blast radius, independent revocation.
Pinning the pubkey in the client is legal — it ships with Tier 0–2's one-time generic client work,
before the canary's zero-bump measurement starts. Manifest-carried rotation is the later
strengthening. *Rejected:* officer threshold — right instrument, wrong cadence.

**R5 — Submission transport: a NEW dedicated directory write route, born type-blind; `agent-write`
keeps its lever role and its `trust_signal_*` arms retire after migration.** The existing seam's
contract is the wrong shape in every dimension that matters — exact-key per-kind schemas, the
`SIGNAL_KINDS` enum, mutate-in-place semantics, body-asserted `accountId` — and retrofitting
signed-envelope semantics into that union drags the enum's gravitational pull into exactly the code
the zero-bump reviewer lens polices. A fresh route implements INV-CHOKEPOINT natively: signature over
domain-separated submission bytes, authorized-issuer set as DATA, re-hash before store, idempotent on
duplicate hash. Revocation re-auth (DOD-REVOKE-1) rides the same surface. *Rejected:* extending
`agent-write` — legacy arms + validator style would be carried forever.

**R6 — Portal→directory availability: a static ordered list of 2–3 directory base URLs with
try-next-on-unreachable, for all `DirectoryClient` methods; full manifest-driven discovery is
post-v1.** The launch-triage split: a single-node *write* path is forgivable (replication fans out
after accept; an outage delays minting) — but sign-in resolving through the same single node means a
us1 outage locks every operator out of the portal, and that is the unforgivable half. A static list is
an afternoon and covers the actual failure mode at three known nodes. Interlock: the write is
idempotent-on-duplicate-hash by design (R5), so retrying a submission against the second node is safe.
*Rejected:* teaching the portal the full manifest client + pinned-root verification — real new surface
that buys little at this node count.

**R7 — ~~Subject binding: per-agent fan-out~~ SUPERSEDED by M10-D5 (2026-07-11, Andre — see the DoD
Decisions section and spec §3.2).** The ruling: `subject_kind: account | agent`, both hashed —
operator-level facts are account-subject (ONE envelope, no per-agent duplication, agent-add a no-op);
endorsements may target either. R7's unlinkability argument was weaker than stated: for identity
proofs the *payload content* links personas regardless of hash, so per-agent hash splitting was fake
protection — selective disclosure is the real lever. Account-level endorsements also make per-agent
fan-out impossible (an endorser signs once). Original text kept below for the record:

*Original R7 —* Subject binding: ratify per-agent fan-out (M8's de facto answer): `subject` = agent identity;
Account-level facts (phone, email) mint one envelope per agent, re-minted at agent creation. The
decisive argument is unlinkability, not plumbing: an Account-subject envelope has ONE hash, so two
pseudonymous personas presenting it are *provably the same operator* — the privacy break the whole
co-resident-agent model exists to prevent (spec §10). Per-agent envelopes get distinct hashes for free
(different subject ⇒ different preimage), keep the transplant defense intact, and keep verification
inside the dumb-check model (no agent→account resolution at presentation). Cost: N envelopes per human
fact, automatable at portal-touch/agent-add. Obliges a `CONTEXT.md` amendment — its "aggregate
Account-level trust view" paragraph describes something M10 deliberately does not build. *Rejected:*
Account-subject envelope — linkability across personas, plus a lookup the dumb directory doesn't have.

**Weighting.** R1 and R4 are load-bearing (custody, trust chain); R7 was load-bearing and is now
DECIDED as M10-D5 (subject_kind — see above). R2, R3, R5, R6 are reversible engineering picks chosen
to be cheapest to *promote later*, not cheapest today.

---

## Related Documents

- [[M10-PROCEDURE]] — the runbook (§4 first-actions points here)
- [[M10-DEFINITION-OF-DONE]] — the yardstick; §10 above lists the edits this evidence owes it
- [[M10-BUILD-JOURNAL]] — the audit trail; this investigation is DOD-PORTAL-ARCH-1's first half
- [[M10-TRUST-SIGNAL-STORAGE-AND-CREATION]] — spec-of-record (HOW)
- [[M10-TRUST-SIGNAL-TAXONOMY]] — spec-of-record (WHAT)
- [[2026-04-17_1000_trust-signal-pickup-queue|Trust Signal Pickup Queue]] — the 2026-04 design that M8
  actually SHIPPED (§5); read it knowing the pickup queue is real code now
- [[2026-05-16_0800_trust-signal-verification-architecture|Trust Signal Verification Architecture]] —
  Tier 4's basis (Passport.js OAuth, browser-harness extraction, GitHub first)
- [[2026-06-26_1030_per-agent-directory-connections-and-manifest-over-http|Manifest over HTTP]] — the
  serving precedent DOD-REGISTRY-1 copies (§6.4)
- `CONTEXT.md` — the Account/Agent identity hierarchy that §10.7's fork turns on
