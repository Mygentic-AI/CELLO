---
name: M10 Definition of Done
type: definition-of-done
date: 2026-07-11
milestone: M10
status: open
topics: [m10, trust-signals, definition-of-done, zero-bump, envelope, registry, canary]
description: >
  The yardstick for M10 (trust signals — pipes for all, signals for few). Every requirement,
  ordered by tier, with a status tag. Enforcers: the e2e fixture harness (envelope/directory
  mechanics), the live signal journey (portal mints → directory notarizes → holder presents →
  recipient's LLM consumes, real processes), the canonical-CBOR cross-party hash test, and the
  zero-bump canary (a new type with EMPTY diffs in cello-client and trustless-cello). This doc
  is the SOLE status authority and carries the Decisions + Parked sections (no separate
  DECISIONS doc this milestone). Pairs with M10-PROCEDURE and M10-BUILD-JOURNAL; the
  spec-of-record is M10-TRUST-SIGNAL-STORAGE-AND-CREATION + M10-TRUST-SIGNAL-TAXONOMY.
---

# M10 — Definition of Done

## How to use this
- This is the **target**. Find the lowest-numbered line not ✅; that's the next unit.
- **Evidence discipline (new this milestone):** a flipped tag carries ONE line of evidence plus
  `→ Journal Entry N`. Full proofs, run output, and forensics live in the journal. This document
  stays a scoreboard.
- **Four enforcers:**
  - **Fixture harness** — envelope/directory mechanics against real binaries (extend
    `packages/e2e-tests/src/session-fixture.ts` / the spine harness; from-scratch fixtures are a
    blocking review finding).
  - **Live signal journey** — a line whose behavior ends in an LLM's context or spans
    portal→directory→holder→recipient is ✅ only after the journey runs live across real
    processes. Vitest green ≠ done.
  - **CBOR cross-party hash test** — portal (TS/Next), directory, and client independently
    serialize + hash the same envelope and agree byte-for-byte. Runs in CI from Tier 0 on.
  - **Zero-bump canary** — the milestone's architectural claim, falsifiable (Tier 2 close).
- Directory-touching lines prove on the 3-directory spine, then live dev. Deploys batched per
  PROCEDURE §2a (target: ONE deploy for Tier 0/1, ONE for Tier 3).
- Every line carries **observability ACs**: named `domain.noun.verb` events (e.g.
  `signal.envelope.minted`, `signal.submission.accepted`, `signal.presentation.verified`,
  `signal.registry.fetched`), required context fields, correlationId threading, error-path
  coverage. Missing events are blocking.
- Client-side lines ship via the publish cascade (/cello-publish); a line needing a published
  artifact is not ✅ until the published artifact works.

## Status legend
✅ PROVEN (enforcer-green) · 🟡 BUILT/UNVERIFIED-LIVE · 🟠 PARTIAL · ❌ NOT BUILT · 🅿️ PARKED

## Scope fence (Andre, 2026-07-11)
**v1 = pipes for all, signals for few.** In: phone + email (internal, everyone has them), one or
two directory-computed track-record signals, ONE external validator (GitHub first), the canary.
OUT of v1 (post-v1 section at bottom): endorsements/intake, PSI, connection bonds, LinkedIn/X/
Facebook/Instagram (playbook runs once the canary passes), SIM-age enrichment, device attestation.

---

## Tier I — Invariants (must hold in every journey, every tier; spec §12 + §15)

- **DOD-INV-DIR-DUMB** — the directory performs only the two hash checks at presentation; no
  content evaluation, no signature logic at presentation, no schema knowledge. For an
  account-subject envelope (M10-D5, spec §3.2) check 2 resolves through the presenting agent's
  account — one mechanical join, still content-blind. — ❌
- **DOD-INV-CHOKEPOINT** — a hash enters the directory's store ONLY via a signed submission from
  an authorized issuer key; anything else is rejected loud. Notarized ⇒ scanned-clean-at-birth
  holds. — ❌
- **DOD-INV-ZERO-BUMP** — no per-type construct exists in cello-client or trustless-cello (no
  type enums used for gating, no `switch(type)`, no per-type columns/validation/rendering, no
  `CHECK` on `type`). Enforced per-unit by the reviewer; proven by the canary. — ❌
- **DOD-INV-TYPE-CARRY** — client and directory treat an unrecognized type string as
  first-class: store, present, verify, hand to the LLM; absent-from-registry =
  valid-but-unclassified, never rejected. — ❌
- **DOD-INV-CANONICAL** — everything hashed is canonical CBOR; the cross-party hash test is
  green in CI continuously from Tier 0. JSON is a display projection, never hashed. — ❌
- **DOD-INV-AGENT-SCOPED** — a received signal is invisible to co-resident agents; the
  recipient-side cache FKs to a per-agent contact row on `agent_id`. — ❌
- **DOD-INV-FRAMING** — signal content reaches a consuming LLM only pass/block (never altered),
  byte-for-byte or not at all, framed by hashed `issuer_kind` (portal-attested vs "Bob says:"
  quoted-untrusted). — ❌
- **DOD-INV-NO-SCORE** — signals stay independent and named; nothing collapses them into a
  score/level/rank anywhere (storage, policy, UI, LLM prompt). — ❌
- **DOD-INV-STATELESS-RECIPIENT** — statelessness = reliance, not storage (M10-D4): policy
  evaluation consumes ONLY the currently-presented set; stored received signals
  (`contact_trust_signals`, spec §3.1) are evidence — never an evaluation input, never trusted for
  freshness (re-checked on use) — and the flow works with zero stored signal data. — ❌

## Tier 0 — Foundations (portal architecture + canonical form + generic stores)

- **DOD-PORTAL-ARCH-1** — **investigate the portal as it actually is, then determine the M10
  portal architecture. First unit of the milestone; gates ALL portal code.** Two halves:
  - **Investigation (evidence, not recall):** read the current cello-portal — auth/session
    model, DB schema + migration state, `src/server/directory/` client (what it can already say
    to the directory, and how it authenticates), `src/server/trust/handoff.ts` and the M8
    trust-signals scaffold (where the WebAuthn/TOTP/phone/email verification state lives today),
    background-job capability (Next.js 16 runtime constraints — is there anywhere for a
    long-running Class-3 job to live, or does it need a separate worker?), key material handling
    today, and the e2e-with-real-directory harness. Findings journaled with file-level evidence.
  - **Architecture (the determination):** where per-type verification modules live and their
    interface; how the portal signs (submission key + registry key custody — answered for the
    REAL deployment shape: **ECS Fargate + IAM task role + Secrets Manager + KMS, which supports
    Ed25519 natively** — with "the portal holds no private key at all" (`kms:Sign`) a live
    option, per investigation §6); the submission client; the registry publisher; the Class-3
    background job's home (investigation §4.2: `after()` is disqualified — in-process scheduler
    vs second container vs scheduled task vs Lambda); how envelopes are delivered to the holder
    daemon (the M8 pipe of investigation §5 is the running prior art — correct it, don't
    reinvent it); what the trust-signals UI scaffold needs to become real. Written AGAINST
    [[M10-PORTAL-ARCH-INVESTIGATION]] (its §11 forks + §12 recommendations), recorded as a
    design doc under `user-stories/m10/` wikilinked here, reviewed by `cello-unit-reviewer` like
    any unit, and its decisions logged in the Decisions section below. Downstream DoD lines that
    the architecture reshapes are edited THEN, not discovered mid-build. —
    ✅ (2026-07-11 — half 1: [[M10-PORTAL-ARCH-INVESTIGATION]] → Entry 2; half 2:
    [[M10-PORTAL-ARCH-DETERMINATION]], reviewed by cello-unit-reviewer on fable — 8 findings,
    ALL fixed (F1→M10-D13), decisions M10-D6…D13 logged below, downstream lines
    (DIR-WRITE/REVOKE/T1-JOURNEY) edited → Entry 3.)
- **DOD-CBOR-1** — a shared canonical-envelope component (serialize, hash, verify) usable from
  portal, directory, and client. Clauses: deterministic map ordering + defined number encoding
  per spec §5; the hash preimage is exactly spec §4's mandatory-disclosure set (subject_kind,
  subject, issuer_kind, issuer_pubkey, type, schema_version, payload, issued_at, expires_at,
  supersedes_hash — status/class/verified_at OUT; subject_kind added by M10-D5, amending
  Journal Entry 1's list); the **cross-party hash test** (all three
  consumers agree byte-for-byte on fixed vectors + property-based random envelopes) runs in CI.
  Where the component lives (published package vs per-repo vendored spec-with-vectors) is
  decided by DOD-PORTAL-ARCH-1's architecture. Design note: journal Entry 1 (the worked
  example). —
  ✅ (2026-07-14 — PROVEN CROSS-PARTY. `@cello-protocol/protocol-types@0.0.23` (published, binary
  verified): preimage is a fixed-order CBOR **array** with the domain tag in slot 0
  (M10-D15/D16/D17); 164/164 in cello-client. Reviewed → **1 BLOCKING finding: a 100-year
  `expires_at` was hashed as an IEEE float64**; all 8 fixed (`bec1230`, `3ae336a`). The DIRECTORY now
  independently re-derives all 7 frozen vectors from the SHIPPED package and agrees byte-for-byte —
  13/13 (`m10-cbor-1-cross-party-vectors.test.ts`). **The portal's third leg lands with
  DOD-MINT-INTERNAL-1**, the first unit that gives the portal an envelope to hash; the enforcer is
  written and will simply be re-pointed. → Entries 4, 6, 8.)
- **DOD-STORE-CLIENT-1** — TWO daemon tables per spec §3.1 (M10-D4), never one with a role flag:
  **(1) wallet `trust_signals`** per spec §3 (envelope columns, opaque payload BLOB, status mutable
  outside the hash; subject = the local agent) — the existing M8 scaffold table is **dropped and its
  signals re-minted via the §14.10 backfill, never migrated** (alpha, no users); **(2) received
  store `contact_trust_signals`** (envelope columns + `verified_at` + `received_at`, composite FK to
  `contacts(agent_id, pubkey)`). SQLCipher. **Wallet rows carry NO agent association (M10-D14,
  Andre — supersedes an earlier per-agent-attribution draft): PK = `signal_hash`, one row per
  signal per daemon.** The envelope's own hashed `subject_kind`/`subject` fields answer "who can
  present this" at presentation time — account-subject rows serve every local agent under the
  account, agent-subject rows serve their subject. Agent-add on an existing daemon is therefore
  ZERO signal work (no assignment sweep, per M10-D5's agent-add-is-a-no-op); renewal is one new
  row per daemon; duplicate delivery is a no-op (`INSERT OR IGNORE` — the §14.11 sync property).
  **`agent_id NOT NULL` applies to the RECEIVED store** (`contact_trust_signals` — consent
  scoping is genuinely per-agent; INV-AGENT-SCOPED), where the M8 `agent_id = null` defect
  (investigation §9, `daemon.ts:4920`) must die with the drop. Migration idempotent; fresh schema
  == migrated schema. —
  🟡 (2026-07-14 — BUILT + REVIEWED. `core/daemon/trust-signal-store.ts`: both tables, wallet with
  NO agent column (M10-D14), received store FK'd to `contacts` with FK enforcement now actually ON
  (M10-D19). 29 unit + 973 full-daemon green. Reviewed by cello-unit-reviewer → **4 blocking
  findings, all fixed**: turning FKs on ARMED a silent cascade-wipe of every received signal on any
  `contacts` table rebuild (`withForeignKeysOff` + regression test); a peer could launder our
  `revoked` verdict back to `active` by re-presenting (`status` is unhashed — the input type now
  omits it and the upsert is monotonic); seconds/milliseconds confusion presented EXPIRED signals;
  and `toBytes()` silently turned an unreadable payload into empty bytes. **The M8 scaffold drop is
  deferred to DOD-MINT-INTERNAL-1 (M10-D18)** — that line now carries the drop as an explicit
  clause. Cross-party/publish half pending at the Tier 0 boundary. → Entries 5, 7.)
- **DOD-STORE-DIR-1** — directory `signal_records` table (`signal_hash` PK, subject_kind,
  subject, issuer_pubkey, issuer_kind, type-as-opaque-string, status, superseded_by, revoked_at,
  accepting_node, scanner_version) + replication of records AND status changes over the existing
  replication path (spec §14.1). Flyway migration + `OpsAgentExpectedMigrationVersion` bump. —
  🟡 (2026-07-14 — BUILT + REVIEWED, **16/16 green** against real Postgres. `V46`: `signal_records`
  (opaque `type` — no CHECK/enum/type-predicated index; exact-allowlist column test for INV-DIR-DUMB;
  append-and-amend, no DELETE grant) **+ `authorized_issuers`** (seeded EMPTY — an unseeded directory
  notarizes nothing rather than falling open). Reviewed → **2 blocking findings, both fixed**: the
  lone `signal_hash` PK **would have wedged federation for all 20 tables on an ordinary timeout**
  (M10-D20 — composite PK + derived status), and `authorized_issuers` was missing entirely.
  **Still OWED before ✅ (deploy-time, not code):** the replication clause is *inert* until
  `./infra/setup-replication.sh` is re-run per environment — editing `PUBLICATION_TABLES` changes
  nothing in a live DB, and nothing detects the omission (review F4: no error, no alarm, and all 16
  tests still pass, because they run against ONE local Postgres with no replication at all). Verify
  with `SELECT 1 FROM pg_publication_tables WHERE pubname='cello_pub' AND tablename IN
  ('signal_records','authorized_issuers')` **on each node**, and put the live SSM
  `expected-migration-version` at 46 (infra/STATE.md records a prior template-vs-live drift).
  → Entries 8, 10.)

## Tier 1 — The write path + internal signals (phone, email)

- **DOD-DIR-WRITE-1** — the directory's ONE write API: signed submission of (envelope-CBOR,
  hash) from an authorized issuer key. Clauses: re-hash and reject mismatch; verify submitter
  signature against the authorized-issuer set (portal keys — but the set is DATA, not a
  hardcoded "portal only": `issuer_kind: agent` intake must be addable post-v1 without an API
  change); reject unauthorized loud (`signal.submission.rejected` + reason); insert at one node,
  federate by replication; idempotent on duplicate hash. **This REPLACES the M8 `agent-write`
  seam, never extends it** (investigation §5.3): the `SIGNAL_KINDS` per-type enum
  (`agent-write-validation.ts:20`) and the `trust_signal_hash`/`trust_signal_ciphertext` arms
  retire after migration, and the shared-static-bearer-key model (one secret, also held by the
  ops-agent, over plaintext HTTP — investigation §3) is superseded by signed submissions on this
  surface — INV-CHOKEPOINT is a NEW property, not a hardening. **Replay-integrity clauses
  (determination §3.1, review F3):** duplicate-hash submit is a strict no-op that never touches the
  existing row (`status` included); supersede-marking is the transition `active → superseded` ONLY.
  **Negative AC:** replay a captured submit after revoking its signal — status stays `revoked`.
  The new surface is served over TLS (the HTTPS listener this unit adds also fronts the legacy
  `/internal/*` routes — determination §3). Design note first (PROCEDURE §6: submission signature +
  key custody; determination §3 fixes the shape).
  **Clauses forced by the STORE-DIR-1 review (2026-07-14) — these are ACs, not notes:**
  - **A 0-row status write is a LOUD FAILURE, never a silent success** (F3). A revoke/supersede
    against a node that has not yet received the row matches zero rows and returns HTTP 200 today —
    so the signal stays `active` on every node, forever. That is the "cheerfully vouching for a dead
    signal" failure the whole line exists to prevent. Check `rowCount`, and where the row is absent
    write the **tombstone** (M10-D20) rather than updating nothing. Error names its cause
    (`signal_record_not_present_at_node`), never `revoke_failed`.
  - **`scanner_version` travels INSIDE the signed request body** (F5). The directory cannot see the
    payload and therefore cannot re-run the scan — it is the submitter's *assertion*. Outside the
    signature it is forgeable, and a forged `scanner_version` is a lie stored as evidence, which
    silently voids spec §14.1's "notarized ⇒ scanned-clean-at-birth".
  - **`accepting_node` is written by the node itself**, never accepted from the request (it is half
    the PK under M10-D20; a submitter that could choose it could collide rows deliberately).
  - **Enrol the portal's KMS pubkey into `authorized_issuers`** from `kms:GetPublicKey` (the table
    ships EMPTY by design). Until then every submission is refused — which is the correct failure.
  - **The `SIGNAL_KINDS` enum + the `agent-write` signal arms retire WITH THE BACKFILL, not here
    (extends M10-D18).** `cello-portal/src/server/trust/handoff.ts` is the LIVE producer of
    `trust_signal_hash`/`trust_signal_ciphertext` via the M8 `agent-write` seam. Retiring them in
    DIR-WRITE-1 would break the live portal→directory→daemon pipe before MINT-INTERNAL-1 re-points its
    producer — the same coverage-window trap M10-D18 avoids for the M8 table. DIR-WRITE-1 ADDS the
    chokepoint; the old seam retires when the backfill re-points `handoff.ts` onto signed submissions.
    Its retirement test asserts `SIGNAL_KINDS` and both signal arms are gone (mirrors the M8-table
    drop test). — ❌
- **DOD-REVOKE-1** — revocation = re-auth through the same chokepoint (spec §14.2): **role-based
  for portal-issued** (any active `submitter`-role key — exact-pubkey matching would strand old-key
  records unrevocable after a key rotation; determination §3.5, review F4), exact
  `issuer_pubkey` match for `issuer_kind: agent` (post-v1); status change replicates; the subject
  cannot revoke (selective disclosure is their lever); expiry is automatic via `expires_at`, not a
  write. —
  🟡 (2026-07-14 — BUILT + RUN GREEN, review in flight. `revokeSignal` shares the chokepoint's
  `verifySignedRequest` (role-based `submitter` auth — a DIFFERENT active key revokes A's record,
  proving key-rotation survival; registry key refused, distinctly named). Out-of-order revoke writes
  a **tombstone** (STORE-DIR F3, closed at source) — carried by an `is_tombstone` flag added to V46,
  the effective view aggregating descriptive fields `FILTER (WHERE NOT is_tombstone)` so a placeholder
  never surfaces over a real subject. `POST /internal/signal/revoke` wired. 8 REVOKE tests + 27 across
  submit/revoke green on real Postgres. **Known property, journaled:** a compromised `submitter` key
  can pre-emptively tombstone a not-yet-minted hash (revoked is monotonic) — within the
  compromised-submitter model, not a new unprivileged vector; defense is revoking the key in
  `authorized_issuers`. **Owed:** replication proof (three-node, batches with STORE-DIR-1). → Entry 11.)
- **DOD-REGISTRY-1** — the type registry as served signed data (spec §15.2.5, amended §14.8):
  a portal-signed document (type → class, lifecycle, default TTL, display label) the directory
  serves as opaque bytes; client fetches + caches with TTL; absent type =
  valid-but-unclassified (INV-TYPE-CARRY); registry update requires NO release anywhere.
  Design note first (format + signing key). — ❌
- **DOD-MINT-INTERNAL-1** — the portal mints **phone** and **email** as real envelopes (the
  §14.10 backfill), **as ACCOUNT-subject signals (`subject_kind: account`, M10-D5)** — one
  envelope per fact, presentable by every agent under the account, agent-add a no-op:
  self-describing payload (plain-language claim + structured fields; email carries domain, not
  address — no PII beyond what the signal IS), hashed via DOD-CBOR-1, submitted via
  DOD-DIR-WRITE-1, delivered to the holder (generic delivery: verify hash ∈ directory → insert
  envelope row; the client half is type-agnostic).
  **THE M8 DROP LANDS HERE (M10-D18) — an explicit, tested clause, not a note.** This unit MUST, in
  the same commit: drop the M8 `trust_signals` scaffold table; retire its only writer
  (`inbound-sessions.ts:601`, the `agent_id = null` defect); re-point the delivery arm onto real CBOR
  envelopes into `wallet_trust_signals`; and re-point `trustless-cello`'s
  `packages/e2e-tests/src/spine/j-trust.spine.test.ts` (whose SUBJECT — the portal→directory→daemon
  delivery pipe — stays alive and must keep its coverage). **Its own test asserts the scaffold table
  is GONE.** STORE-CLIENT-1's test only guards against a *premature* drop and would stay green
  forever if this were forgotten (review F7) — this clause is the forcing function. **Source-of-fact clause (investigation §2):
  the portal holds NO phone data — the verified fact lives in the directory's
  `user_accounts.phone_stub_hash`; email exists portal-side only as envelope ciphertext. The
  unit must define how the portal obtains/attests each fact it mints (a directory read, not a
  re-verification), and the architecture half decides that read's shape.** Registry entries for
  both types. Existing accounts get them on next portal touch; new registrations mint at verify
  time. — ❌
- **DOD-T1-JOURNEY-1** — **live journey, first half:** for a real agent, portal mints phone +
  email → directory notarizes (visible in `signal_records`, replicated to all 3 nodes) → holder
  daemon holds both envelopes and re-verifies their hashes locally. Real portal process, real
  dev directory, real daemon. **Three cases from the architecture review:** (a) **late-added
  agent** — add a second agent AFTER minting; its wallet receives the account-subject envelopes
  via M10-D13 re-mint-with-supersession; (b) **failover** — with the primary directory node
  unreachable, portal login AND a mint both succeed via the next node in the list (M10-D11's own
  justification deserves the test); (c) **custody** — assert the ECS task definition carries no
  signing key material and `authorized_issuers`' pubkey equals KMS `GetPublicKey` output (the
  file-signer-in-prod bypass is otherwise invisible to every enforcer). — ❌

## Tier 2 — Presentation + consumption (the generic client pipeline) — closes with the canary

- **DOD-PRESENT-1** — the holder presents selected signals as `{hash, blob}` pairs during the
  brokered introduction (selective disclosure: all, some, none — an explicit per-contact/
  per-tier choice surface, default sensible); the directory runs its two dumb checks in the
  moment and forwards or strips with a named event; nothing persists directory-side. — ❌
- **DOD-VERIFY-1** — the recipient re-hashes each presented blob, checks directory membership +
  status (fresh, not revoked/superseded), stores the verified signal in `contact_trust_signals`
  with `verified_at` (M10-D4). Freshness policy per spec
  §14.7: TTL re-check on use; past-TTL + directory unreachable = disclosed staleness, tier
  policy decides (established contacts proceed, unknowns are refused) — never silent-accept,
  never hard-reject. — ❌
- **DOD-CONSUME-1** — verified signals reach the recipient's LLM as the JSON projection framed
  by hashed `issuer_kind` (portal-attested vs quoted-untrusted "X says:"), pass/block only,
  byte-for-byte or not at all (INV-FRAMING). Unknown types flow through with generic framing
  (INV-TYPE-CARRY) — the self-describing payload does the explaining. — ❌
- **DOD-FLOOR-1** — the `SignalRequirementPolicy` deterministic floor: v1 field set defined
  (design note; spec §14.4 defers it here), predicates on ENVELOPE FIELDS ONLY (type string,
  issuer_kind, count, expiry, revocation, age); LLM/config discretion layers on top and may
  only RESTRICT. The round-2 demand-bundle is a declarative list referencing type strings. — ❌
- **DOD-T2-JOURNEY-1** — **live journey, full:** agent A (holder of phone+email envelopes)
  connects to agent B; A presents; the directory checks; B verifies + consumes with correct
  framing; B's floor gates an unknown sender missing a required signal (negative case run,
  not assumed). — ❌
- **DOD-ZEROBUMP-CANARY-1** — **the architectural proof.** A throwaway type (`canary_test`) is
  taken from nothing to live end-to-end — portal composes (self-describing payload), hashes,
  submits; registry entry added; holder stores; presents; recipient verifies, floor-gates on it,
  LLM consumes it — with **`git status --porcelain` clean and `git diff --stat` empty in
  cello-client AND trustless-cello for the entire exercise** (no rebuild, no republish, no
  redeploy; the running binaries predate the type). Then the canary type is registry-retired to
  prove retirement is also data-only. The generic machinery is only proven generic by a type it
  has never seen. — ❌

## Tier 3 — The directory-computed path (Class 3 track record)

- **DOD-DIRDATA-READ-1** — the read path the portal's Class-3 job uses (spec §6 amendment: the
  portal computes, the directory only serves data it already holds). **Materially bigger than
  "expose an aggregate" (investigation §7):** `pseudonym_stats` exists but is pseudonym-keyed
  (M10 subjects are agent identities), has zero exposure surface (no route, no accessor), and
  **its inputs are unreplicated** (`pseudonym_stats`, `conversation_participation`,
  `conversation_attestations` absent from `PUBLICATION_TABLES`) — so the three sovereign nodes
  may disagree on the numbers. **Consistency clause:** a track-record signal must be reproducible
  from any node — make the aggregate agent-keyed AND cross-node consistent (replicate the inputs
  or compute from already-replicated data; a Decisions entry) BEFORE exposure. Design note first:
  exactly which aggregates (session/seal counts, clean-close attestations) are exposed,
  authenticated how; no content, no PII, aggregate-only. — ❌
- **DOD-TRACK-1** — a portal background job computes one or two track-record signals
  (**session count** and **clean-close rate** — per taxonomy Class 3) and mints them through
  the SAME write path as Tier 1 (nothing directory-issued; INV-CHOKEPOINT unchanged). Default
  scope `subject_kind: agent`; the same data MAY additionally mint an account-wide aggregate
  (`subject_kind: account`, M10-D5 / spec §3.2) — if minted, the read path serves both
  aggregations. Self-describing payloads; registry entries. Decide-at-build (Decisions entry):
  persist client-side like other signals vs mint-on-request (spec §0.2 open item). — ❌
- **DOD-SUPERSEDE-1** — recomputation supersedes, never mutates: the new envelope carries
  `supersedes_hash`, the old goes `status: superseded` at the directory, a stale presented copy
  fails freshness (DOD-VERIFY-1 catches it live). Track record's natural drift makes it the
  test vehicle; the mechanism is generic. — ❌
- **DOD-T3-JOURNEY-1** — **live journey:** agent with real session history gets track-record
  envelopes; after more sessions the job re-mints; a counterparty sees the CURRENT version and
  a replayed stale one is refused. — ❌

## Tier 4 — The external-validator path (GitHub)

- **DOD-EXTRACT-DESIGN-1** — the browser-extraction infrastructure design log (GATE for the
  rest of Tier 4): a separate, security-hardened instance running browser-harness for profile
  reads; credential isolation (the portal's OAuth tokens never reach the extraction box;
  extraction output is data, never instructions); what it may touch; infra/STATE.md entries.
  This is new infrastructure with its own attack surface — design before code. — ❌
- **DOD-OAUTH-1** — GitHub OAuth proof-of-account-ownership in the portal (Passport.js per the
  2026-05-16 verification-architecture log; provider order GitHub → LinkedIn → X stands —
  LinkedIn/X are post-v1 playbook runs). Proof is synchronous; extraction/audit is async
  two-step per that log. — ❌
- **DOD-EXT-SIGNAL-1** — the `github` signal end-to-end: OAuth-verified account → extraction
  reads account age/activity → portal composes the self-describing payload (claim in plain
  language + structured fields) → scan → hash → submit → registry entry → holder → live journey
  (present, verify, consume). The full [[M10-TYPE-PLAYBOOK]] is exercised and corrected against
  reality as part of this line. — ❌
- **DOD-T4-JOURNEY-1** — **live journey + v1 CLOSE:** a real agent presents phone + email +
  track-record + github; the recipient's floor demands `≥1 identity proof`; framing correct for
  every class; the done-auditor checkpoint runs over all tiers. **v1 of M10 is DONE here.** — ❌

---

## Decisions
*(Dated, numbered, one paragraph: fork / choice / why / reverse. Long rationale → discussion log
+ wikilink. This section replaces a separate DECISIONS doc — M8C finding.)*

- **M10-D1 (2026-07-11, Andre) — Scope fence: pipes for all, signals for few.** v1 ships the
  generic machinery plus phone, email, 1–2 track-record signals, and GitHub only. Why: the
  milestone's value is the architecture (every future signal becomes a portal-only playbook
  run), not the catalog; each in-scope signal exercises a distinct creation path (internal /
  directory-computed / external-validator). Reverse: add types post-canary via the playbook —
  that being cheap is the point.
- **M10-D2 (2026-07-11) — Apparatus: 3 docs + playbook, no SPEC, no DECISIONS doc.** The two
  M10 design docs are the spec-of-record; decisions live here; evidence lives in the journal
  with the DoD as sole status authority; journal splits per tier. Why: M8C post-mortem (DoD
  bloat to 1,232 lines, journal/DoD status drift, DECISIONS-as-fourth-place-to-check). Reverse:
  spin any section out if it outgrows this.
- **M10-D3 (2026-07-11) — GitHub before LinkedIn.** One external validator in v1; GitHub first
  per the 2026-05-16 log's provider order (mature OAuth, richer public data). Reverse: LinkedIn
  is the first post-v1 playbook run.
- **M10-D6…D13 (2026-07-11) — the architecture determination's decisions**, full rationale +
  rejected alternatives in [[M10-PORTAL-ARCH-DETERMINATION]] §1 (reviewed by cello-unit-reviewer,
  8 findings fixed):
  - **M10-D6** — issuer signing: Ed25519 in AWS KMS (`kms:Sign`); the portal holds no private key.
    File-based signer behind the same interface for local dev; directory learns the pubkey as data.
  - **M10-D7** — ONE canonical-CBOR implementation, in `@cello-protocol/crypto` (already the
    portal's dependency); no vendored copies.
  - **M10-D8** — Class-3 job: in-process scheduler from `instrumentation.register()`, own module,
    crash never kills the server; promotion to a worker is a routing change.
  - **M10-D9** — registry signed by a dedicated KMS key (not officers, not the submission key);
    clients pin its pubkey at build time; manifest-carried rotation later.
  - **M10-D10** — new type-blind signed `/internal/signal/*` surface (TLS); `agent-write`'s signal
    arms + `SIGNAL_KINDS` enum retire after the backfill; INV-CHOKEPOINT implemented natively.
  - **M10-D11** — portal→directory: static ordered failover list for ALL DirectoryClient methods;
    exhaustion fails LOUD (`unreachable: true` posture); manifest-driven discovery post-v1.
  - **M10-D12** — the portal keeps no authoritative signal state; the directory's `signal_records`
    is the record; only TTL'd transient verification-flow state is permitted portal-side.
  - **M10-D13** — an agent added on a NEW DAEMON gets account-subject envelopes by **re-mint with
    supersession** (amends M10-D5: agent-add = no-op on verification, supersede on delivery);
    directory/portal never hold envelope plaintext. Residual disclosed: out-of-band agent-add
    waits for the next portal touch. **A BRIDGE, not a policy (Andre):** wallet sync (spec §14.11
    — content-addressed rows, `INSERT OR IGNORE`) is the real solution and is parked; when it
    ships, the re-mint pass stops being needed, with no migration (synced row == delivered row).
    **Same-daemon agent-add needs NOTHING** — under M10-D14 the account-subject row is already
    daemon-level; there is no copy, no assignment, no delivery.
  - **M10-D14 (Andre) — wallet rows carry no agent association.** PK = `signal_hash`, one row per
    signal per daemon; the envelope's own hashed `subject_kind`/`subject` decides who can present
    it, at presentation time. Supersedes the earlier per-agent `(agent_id, signal_hash)`
    attribution draft, which reintroduced the per-agent bookkeeping M10-D5 stipulated against
    (agent-add sweeps, expiry re-assignment). `agent_id NOT NULL` remains the rule for the
    RECEIVED store only.
- **M10-D4 (2026-07-11, Andre) — Recipient-side storage: store what was presented; evaluate only
  what is presented.** Received signals ARE stored — plaintext envelope rows inside the encrypted
  SQLCipher DB, FK'd to the per-agent contact row, stamped `verified_at`/`received_at` — as
  re-checkable evidence; every earlier "verdict-only / does-not-persist" phrasing was wrong and is
  amended (spec §0/§9/§12). Statelessness means RELIANCE: policy evaluates the currently-presented
  set only; stored copies never feed acceptance and are never trusted for freshness. TWO tables,
  never one with a role flag: wallet `trust_signals` (durable, rides backup §14.9) and received
  store `contact_trust_signals` (spec §3.1). The M8 scaffold rows are dropped and re-minted via the
  §14.10 backfill — alpha, no users, incorrect data is not maintained. Reverse: verdict-only would
  delete the evidence purpose (§1) — not foreseen.
- **M10-D5 (2026-07-11, Andre) — Subjects have two levels: `subject_kind: account | agent`, both
  hashed (spec §3.2, §4).** Operator-level facts (phone, email, social OAuth) are account-subject:
  ONE envelope per fact, presentable by every agent under the account, agent-add a no-op — no
  per-agent duplication (rejected: re-mint chore at agent-add; endorsers can't re-sign per agent).
  Agent-level facts (track record) are agent-subject; Class-3 may mint BOTH scopes by aggregation.
  Endorsements may target either, defaulting to the specific agent unless requested and agreed
  (intake policy, post-v1; the seam ships now). The dumb check resolves account subjects through the
  presenting agent's account (one join — INV-DIR-DUMB amended). Accepted with eyes open:
  account-wide signals are cross-persona linkable; payload content links personas anyway, and
  selective disclosure is the lever. Supersedes investigation R7 (per-agent fan-out). Constraint
  from multi-daemon accounts (spec §14.11): wallet rows are content-addressed and
  daemon-portable; nothing daemon-specific in the schema. Reverse: splitting to per-agent
  envelopes later is a minting-policy change, not a schema change — subject_kind stays.

- **M10-D15 (2026-07-14) — the envelope hash preimage is a fixed-order CBOR ARRAY, not a map.**
  Fork: the shared encoder (`protocol-types/src/cbor.ts`) is NOT RFC 8949 §4.2 deterministic —
  measured: map keys follow insertion order (`{b,a}` and `{a,b}` differ byte-for-byte) and map
  headers are not minimal-length (`b9 0002` for a 2-entry map, not `a2`). Choice: encode the
  preimage as an array, matching every existing TBS builder in the codebase
  (`buildAgentRevocationTbs`, `buildPrimaryTransferTbs`, `buildSealTbs`, `buildParkContentTbs`).
  Why: arrays have no key-ordering freedom, so determinism is structural, not a property we must
  add to — and it costs ZERO encoder change and ZERO migration of blobs already on disk. Rejected:
  making `encodeCbor` CDE-compliant (changes object encoding for every existing caller, on the wire
  and in DB columns — a data migration bought for nothing) and a second CDE-only encoder (red under
  the `no-multiple-cbor-encoders` guard, correctly). Nothing shipped is affected: every signed TBS
  is already an array (PROCEDURE §5b); the exposure was purely prospective. Reverse: only if a
  future preimage must be extensible-by-unknown-parties, which the closed-set rule (spec §4)
  forbids. → Journal Entry 4.
- **M10-D16 (2026-07-14) — the canonical-envelope component lives in
  `@cello-protocol/protocol-types`; this AMENDS M10-D7's home, keeping its intent.** M10-D7 said
  `@cello-protocol/crypto` because crypto is already the portal's only CELLO dependency. But the
  dependency edge runs `protocol-types → crypto` (crypto has no cbor-x), so a CBOR component in
  crypto means either a second encoder (red) or a dependency inversion. protocol-types already owns
  the sole encoder, the TBS-builder convention, and the canonical vector directory. cello-portal
  adds `@cello-protocol/protocol-types` as a dependency (published; trustless-cello already pins
  `^0.0.3`). M10-D7's actual intent — ONE implementation, no vendored copies — is unchanged and
  preserved. Reverse: none foreseen; inverting the packages later is mechanical. → Journal Entry 4.
- **M10-D17 (2026-07-14) — optional preimage fields are an explicit CBOR `null` in a fixed slot,
  never omitted.** REVERSES Journal Entry 1's "absent optional fields OMITTED (never null)" rule,
  which was written for a MAP and is wrong for an ARRAY: omitting a field in an array shifts every
  later field and changes the arity, so an absent `expires_at` becomes confusable with a
  misaligned `supersedes_hash`. Fixed arity + explicit null is the unambiguous form. The two
  nullable fields are `expires_at` (some signals never expire) and `supersedes_hash` (a first mint
  supersedes nothing). Reverse: not foreseen — this is forced by M10-D15. → Journal Entry 4.

- **M10-D18 (2026-07-14) — DOD-STORE-CLIENT-1 is ADDITIVE; the M8 table's DROP travels with the
  BACKFILL.** Fork: the DoD says the M8 `trust_signals` scaffold is *"dropped and its signals
  re-minted via the §14.10 backfill."* Read as "drop it in STORE-CLIENT-1," the drop lands several
  units before its replacement: the M8 writer (`inbound-sessions.ts:601`, the only producer) would
  write to columns that no longer exist, and `j-trust.spine.test.ts` would go red — leaving the
  delivery pipe with NO coverage across DIR-WRITE-1, REVOKE-1 and REGISTRY-1. A red gate held open
  across four units is how a coverage hole becomes permanent. Choice: STORE-CLIENT-1 creates the two
  new tables and leaves the scaffold standing; **DOD-MINT-INTERNAL-1 drops it in the same commit that
  re-points the delivery arm onto real CBOR envelopes and re-points the spine test.** Not a scope
  change — the DoD already binds the drop to the backfill, and MINT-INTERNAL-1 *is* the backfill.
  Rejected: drop-now-rebuild-later (opens the window above); keeping both tables permanently (two
  sources of truth for one fact — the M8 defect, preserved). → Journal Entry 5.
- **M10-D19 (2026-07-14) — `PRAGMA foreign_keys = ON` in the daemon's SQLCipher DB.** SQLite defaults
  FK enforcement **OFF**, so a declared `FOREIGN KEY` is decorative — a guard that always passes.
  INV-AGENT-SCOPED is supposed to be enforced by the DATABASE (a received signal cannot exist except
  hung off one agent's contact row); without the pragma the schema would LIE about that. Verified
  safe before flipping it: the daemon declares **zero** existing FKs anywhere, so enforcement cannot
  retroactively violate a constraint or break an existing write. Rejected: enforcing the invariant
  only in the store's query layer — a convention every future caller must remember, which is exactly
  what "ABSENT IS NOT FINE" says not to rely on. → Journal Entry 5.

- **M10-D20 (2026-07-14) — `signal_records` PK is `(signal_hash, accepting_node)`, and status is
  DERIVED, not trusted.** Fork: the DoD says `signal_hash` PK, and that lone PK **wedges federation**.
  Measured: a subscriber's apply worker DOES enforce PK/UNIQUE (`session_replication_role = replica`
  → duplicate key still errors). Two nodes that independently insert the same hash each replicate an
  INSERT the other cannot apply → the apply worker retries forever → **the whole subscription stops,
  for all 20 published tables.** Reachable via the DESIGNED path: the portal fails over (M10-D11), so
  a lost response after a successful write re-submits the same hash to a second node. *A timeout takes
  down federation.* Choice: composite PK — two nodes may each notarize a signal and their rows cannot
  collide. Safe because the record is content-addressed (every hashed field derives from the envelope,
  so rows sharing a hash agree on all of them; they differ only in provenance). Reads dedupe via
  `signal_records_effective`. **Corollary — a replicated UPDATE can be silently LOST** (arriving
  before its row, the apply worker skips it: no error, no retry), so both status transitions are also
  expressible as INSERTs: supersession rides the new record's own hashed `supersedes_hash`; a revoke
  at a node lacking the row inserts a revoked TOMBSTONE. Precedence: revoked > superseded > active.
  Reverse: none — a lone PK is not viable under mesh replication. **Also settled here: an FK on
  `supersedes_hash` would NOT have wedged replication** (the apply worker's RI triggers do not fire —
  measured; my earlier claim to the contrary was an untested hypothesis written as fact). → Entry 10.

## Parked
*(Genuine undecidable forks: journal + here. Never silently dropped.)*

- **Multi-daemon sync + same-agent-two-daemons control handoff (2026-07-11, spec §14.11).** The
  sign-prove-you-own-both daemon-to-daemon sync mechanism, and the which-daemon-does-the-directory-
  call / request-and-receive-permission control handoff for one agent live on two machines:
  conceived, not designed, NOT M10 scope. M10's only obligation is negative — wallet rows stay
  content-addressed and daemon-portable, nothing daemon-identity-specific in the schema — so these
  designs are not foreclosed. Do not code any of it this milestone.

## Post-v1 — explicitly deferred, tracked so nothing falls between milestones
- **Endorsement intake (Endorsement Mother)** — the `issuer_kind: agent` creation path: intake
  role, deterministic scanner (versioned, byte-identical), submitter-accountability flags,
  delivery to subject. Portal-routed at launch per spec §7 amendment; per-node is the
  decentralization target. The write API ships seam-ready for it (DOD-DIR-WRITE-1 clause).
  Target may be a specific agent OR the account (`subject_kind`, M10-D5), defaulting to the
  specific agent unless requested and agreed — the default is intake policy, decided here.
- **PSI** — construction unchosen (spec §11); both applications (mutual-contact,
  endorser-overlap) post-v1.
- **Connection bonds / staking / fees (Class 4)** — needs the commerce layer.
- **LinkedIn, X, Facebook, Instagram** — playbook runs; LinkedIn first.
- **SIM-age enrichment; device attestation (native app)** — per taxonomy.
- **Agent-issued revocation must use exact-pubkey auth, and the revoke tombstone must respect the
  target's real `issuer_kind`** (REVOKE-1 review F6). Today revoke authorizes on role `submitter` and
  writes a `portal` tombstone regardless — fine while every signal is portal-issued, but a `submitter`
  key must not be able to tombstone an agent-issued endorsement once those exist. Revisit with intake.
- **Recipient re-scan of endorsements** (spec §0.1) — decide when endorsements land.
- **Review-prompt on revocation of a tier-earning signal** (spec §9) — needs the address-book
  review-prompt surface; design with the rename-notice pattern.
- **Registry governance decentralization; T-of-N scan attestation** (spec §14.1) —
  strengthenings, not migrations.
- **Bearer-key retirement on the legacy `/internal/*` routes** (`account-by-email-stub`,
  `agents-by-account`, `agent-write`'s `revocation_flag`, `pre-authorize`) — accepted at launch in
  auth model, moved behind TLS by DOD-DIR-WRITE-1 (determination §3, review F6); replacing the
  shared bearer key with signed requests is post-v1.
- **Manifest-carried registry-key rotation** (M10-D9's later strengthening; build-time pin at
  launch).

---

## Related Documents

- [[M10-PROCEDURE]] — the runbook (read first)
- [[M10-BUILD-JOURNAL]] — audit trail + evidence home
- [[M10-TYPE-PLAYBOOK]] — the per-type runbook this milestone's Tier 4 exercises
- [[M10-TRUST-SIGNAL-STORAGE-AND-CREATION]] — spec-of-record (HOW): envelope §3-5, creation §6-7,
  gateway §8, flows §9, invariants §12, resolutions §14, zero-bump §15
- [[M10-TRUST-SIGNAL-TAXONOMY]] — spec-of-record (WHAT): the four classes and every planned type
- [[2026-05-16_0800_trust-signal-verification-architecture|Trust Signal Verification Architecture]] — Tier 4's design basis
- [[2026-07-10_contact-address-book-design|Contact Address Book Design]] — the schema the recipient cache is born on
