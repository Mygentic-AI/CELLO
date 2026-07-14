---
name: M10 Build Journal
type: build-journal
date: 2026-07-11
milestone: M10
status: open
description: >
  Append-only audit trail + evidence home for M10 (trust signals — pipes for all, signals for
  few). Entry 0 seeds the milestone. Never edit a prior entry. The DoD is the SOLE status
  authority (no duplicate status board here — M8C drift lesson); this file holds the RESUME
  STATE block, the entries, and the evidence the DoD points to. A new journal file starts at
  each tier boundary (M10-BUILD-JOURNAL-T{n}.md), seeded with a 10-line resume block.
---

# M10 — Build Journal

## RESUME STATE (keep current — update at every checkpoint/compaction)
- **Milestone status:** **DOD-PORTAL-ARCH-1 ✅ COMPLETE** (both halves; Entry 3). Investigation →
  [[M10-PORTAL-ARCH-INVESTIGATION]]; determination → [[M10-PORTAL-ARCH-DETERMINATION]] (reviewed,
  8 findings fixed, decisions M10-D6…D13 in the DoD). **IN FLIGHT: DOD-CBOR-1** — design note is
  Entry 1 **as amended by Entry 4** (read Entry 4, not Entry 1 alone: three of Entry 1's premises
  were wrong against the code). Preimage = fixed-order CBOR **array**, domain tag `CELLO-TSIG-v1`
  in slot 0, nullable slots for `expires_at` / `supersedes_hash` (M10-D15/D17). Component lives in
  **`@cello-protocol/protocol-types`**, NOT crypto — **M10-D16 amends M10-D7's home** (the sole
  CBOR encoder already lives there and is guarded by `no-multiple-cbor-encoders.test.ts`; crypto
  has no cbor-x and the dep edge runs protocol-types → crypto).
- **Live testing is available (Andre, 2026-07-14):** hole-punching works, so the **AWS demo agent**
  (`i-0ad3e7c22470f266e`, us-east-1 — see repo CLAUDE.md for the SSM command form) can be driven
  over bash as a REAL counterparty for the live journeys. **Pushing to `main` triggers a CodePipeline
  deploy** — so directory pushes must stay batched (PROCEDURE §2a: one deploy for Tier 0/1, one for
  Tier 3), and Cron 1 (the deploy watchdog) gets armed the moment one is in flight.
- **Read the investigation before any M10 design or code.** It overturns several premises: the
  portal is LIVE on AWS; the M8 trust pipe (portal→directory→daemon, sealed + anchored + ACKed)
  already exists and violates three M10 invariants; INV-CHOKEPOINT is net-new (today: one shared
  static bearer key, shared with the ops-agent, over plaintext HTTP); the portal holds no signing
  key; AWS KMS supports Ed25519 natively; Class-3 track record is already computed but is
  pseudonym-keyed, unexposed, and its inputs are unreplicated.
- **Design notes owed before code** (PROCEDURE §6): registry format + portal key custody
  (before Tier 1); browser-extraction infra (before Tier 4 only).
- **Scope fence:** phone + email → track record (1–2) → GitHub → canary. Nothing else in v1
  (DoD M10-D1).
- **Repos:** cello-portal (center of gravity; **LIVE on ECS Fargate, us-east-1** — deploys join the
  batching discipline), trustless-cello (batch deploys: one for Tier 0/1, one for Tier 3),
  cello-client (publish cascade; all tables on `agent_id`).
- **DoD edits from investigation §10: ALL APPLIED (2026-07-11)** — §10.1 PROCEDURE/RESUME fixed
  earlier; §10.2 (custody clause → Fargate+KMS reality), §10.3 (MINT-INTERNAL source-of-fact),
  §10.4 (agent_id NOT NULL), §10.5 (DIR-WRITE replaces agent-write, never extends), §10.6
  (DIRDATA consistency clause) applied to the DoD; §10.7 resolved as M10-D5.
  DOD-PORTAL-ARCH-1 flipped to 🟠 (half 1 done).
- **If autonomous:** arm both crons (PROCEDURE §3b) before the first unit.

---

## Entries (append-only)

### 2026-07-11 — Entry 0: milestone seeded (apparatus + scope fence)

**What happened.** The M10 apparatus was created after the zero-bump architecture session
(2026-07-11) folded §15 into [[M10-TRUST-SIGNAL-STORAGE-AND-CREATION]]: PROCEDURE, this journal,
[[M10-DEFINITION-OF-DONE]] (which absorbs the DECISIONS role), and [[M10-TYPE-PLAYBOOK]].
No separate SPEC — the two M10 design docs are the spec-of-record (M10-D2).

**Scope settled with Andre (M10-D1):** v1 proves the three creation paths with the minimum
signal set — internal (phone + email, the two every agent already has from M8), directory-
computed (session count + clean-close rate, via the portal background job and a new directory
read path), and external-validator (GitHub: OAuth + hardened browser-extraction instance).
The zero-bump canary (DOD-ZEROBUMP-CANARY-1) closes Tier 2 and converts the architecture's
promise into a falsifiable test. Endorsements/PSI/bonds/other providers: post-v1, tracked in
the DoD's Post-v1 section.

**Apparatus changes vs M8C (M10-D2, from the M8C post-mortem):** evidence lives HERE with the
DoD as a scoreboard (one line + entry pointer per flip); no duplicate status board in this file
(the M8C boards drifted); journal splits per tier; decisions live in the DoD.

**Portal reality verified 2026-07-11:** Next.js 16 (read `node_modules/next/dist/docs/` —
AGENTS.md warning), pnpm gates (`test`/`lint`/`typecheck`/`build`), Postgres via `db:up` +
numbered SQL migrations (next: 0006), existing `src/app/(app)/trust-signals/page.tsx` scaffold
(WebAuthn + TOTP live since M8), `src/server/directory/` HTTP client, `src/server/trust/`,
`pnpm test:e2e:real-dir` for e2e against a real directory, `@cello-protocol/crypto` already a
dependency. No deploy pipeline — local/dev for this milestone.

**Prerequisites already landed (do not re-derive):** `agent_id` join-key migration shipped
(M8C Entry 87, daemon 0.0.45+); address-book schema live (v0.0.94); the M10 design docs carry
the resolved §14 gap list and the §15 zero-bump amendment.

**Next:** DOD-PORTAL-ARCH-1, then DOD-CBOR-1 (design note below).

---

### 2026-07-11 — Entry 1: DESIGN NOTE — DOD-CBOR-1 (written before any code; the worked example for PROCEDURE §6's template)

**Target behavior (one sentence).** Any two parties — portal, directory node, holder daemon,
recipient daemon — given the same trust-signal envelope, independently produce byte-identical
canonical CBOR and therefore the identical SHA-256 hash, forever.

**Spec anchors.** Spec-of-record §4 (the hash preimage IS the mandatory-disclosure set: subject,
issuer_kind, issuer_pubkey, type, schema_version, payload, issued_at, expires_at,
supersedes_hash; status/class/verified_at excluded), §5 (canonical CBOR is the hashed form; JSON
is a never-hashed display projection). CBOR deterministic encoding → **RFC 8949 §4.2 (Core
Deterministic Encoding)**. SHA-256 → **FIPS 180-4**. NOT pinned by the spec, so this note
decides: the exact CBOR profile details, a domain-separation prefix, payload embedding, and
where the component lives (deferred — DOD-PORTAL-ARCH-1 input).

**Producer/consumer chain.** The portal PRODUCES the envelope bytes + hash at mint (§6). Four
CONSUMERS re-derive: the directory at submission (re-hash before store — INV-CHOKEPOINT), the
directory again at presentation (dumb check 1), the holder on receipt (verify before insert),
the recipient at verification (re-hash the presented blob). A divergence at ANY hop is a false
`hash_mismatch` — a valid signal becomes unpresentable, which is a correctness bug and, because
it can differ per node/client version, a censorship-shaped one. That is why the cross-party test
is a CI invariant (DOD-INV-CANONICAL), not a unit test.

**The seam.** All three repos consume the component; NONE may parse `payload` (opaque bytes —
the component canonicalizes the ENVELOPE, never the payload's interior; INV-ZERO-BUMP depends
on this). Candidate homes: `@cello-protocol/crypto` (already a dependency of all three repos,
including cello-portal) vs a vendored spec-with-test-vectors per repo. Leaning: the published
package (one implementation, three consumers — divergence is the enemy), but the portal's
Next.js 16 runtime constraints are DOD-PORTAL-ARCH-1's to confirm, so packaging is explicitly
deferred to that unit's output.

**Invariants at stake.** INV-CANONICAL (the unit's whole point). INV-ZERO-BUMP (the component
must be type-blind: `type` is an opaque string in the map, `payload` an opaque byte string — if
the encoder ever branches on type, zero-bump dies at the foundation). INV-CHOKEPOINT (the
directory's re-hash at submission is only as strong as encoding agreement).

**Approach + rejected alternative.** Encode the envelope as a CBOR map under RFC 8949 Core
Deterministic Encoding: definite lengths only, minimal-length integer encoding, bytewise-sorted
keys, **no floating point anywhere** (timestamps are integer epoch-seconds), `payload` embedded
as a byte string verbatim (never decoded/re-encoded), absent optional fields OMITTED (never
null — presence ambiguity is a canonicalization bug). Hash = SHA-256 over
`"CELLO-TSIG-v1" || envelope-bytes` — the domain-separation prefix prevents a trust-signal hash
from colliding with any other CELLO CBOR structure signed/hashed elsewhere (same pattern as the
existing framed-message prefixes). REJECTED: canonical JSON (RFC 8785 JCS) — the protocol is
already CBOR end-to-end, and JSON's number/Unicode normalization pitfalls are the exact failure
class spec §5 calls out; JSON stays the display projection. ALSO REJECTED: ad-hoc field
concatenation (order fragile, no tooling, reinvents what CDE specifies).

**Falsification pass.** (1) Does `@cello-protocol/crypto` (or transport) already ship a CBOR
encoder, and is it CDE-capable or configurable to be? — verify in code at unit start; do NOT
assume; a second CBOR library in one repo is a red flag to surface. (2) Double-encoding trap:
if the payload were parsed and re-encoded, a payload produced by a different encoder version
would change bytes — treating payload as opaque bytes kills this class. (3) The portal runs on
Node inside Next 16 — confirm the chosen encoder has no native-module install cost (repo rule:
install size matters). (4) Nothing else consumes the envelope hash today, so no call-site
regression surface exists yet — greenfield is the falsification result, journaled as such.

**Decisions this note makes.** (1) RFC 8949 CDE profile, no floats, epoch-second integers,
omit-absent-fields. (2) Domain-separation prefix `CELLO-TSIG-v1`. (3) Payload embedded as
opaque bytes, never re-encoded. (4) Packaging deferred to DOD-PORTAL-ARCH-1 (leaning: the
published crypto package). — (1)–(3) graduate to the DoD Decisions section when the unit goes
green; (4) is that unit's to close.

**Test plan sketch.** Red-first: committed fixed test vectors (envelope → exact hex bytes →
exact hash) that all three repos' suites consume; property-based round-trip (random envelopes:
encode → decode → encode is byte-identical); tamper tests (single-bit flip anywhere in the
preimage changes the hash; a mutated `status` does NOT — it's outside the preimage); an
unknown extra envelope field is REJECTED loud (the preimage is a closed set — spec §4).
Enforcer: the CBOR cross-party CI test (DOD-INV-CANONICAL) green from this unit on.

---

### 2026-07-11 — Entry 2: DOD-PORTAL-ARCH-1, half 1 — the INVESTIGATION (evidence, not recall)

**What happened.** Six parallel read-only investigations across the three repos (portal auth/session +
key material; portal DB/migrations; portal→directory seam + M8 trust handoff + the trust-signals
scaffold; portal runtime/jobs/deploy/e2e; the directory node; the client daemon), each required to cite
`path:line`. Findings written up as [[M10-PORTAL-ARCH-INVESTIGATION]]. **HEADs:** cello-portal `776752d`;
trustless-cello + cello-client on `main`.

**The eight findings that change the milestone** (full detail + citations in the investigation):

1. **The portal is LIVE on AWS** — ECS Fargate, us-east-1, `portal.cello.mygentic.ai`, image
   `cello-portal:776752d`, RDS, deployed by `infra/deploy-portal.sh` (`infra/STATE.md:380`). The
   PROCEDURE's "no deploy pipeline — local/dev only" was **false**; corrected in place today.
2. **The M8 trust pipe already exists end to end** — portal seals per-agent with `sealToRecipient`,
   double-writes hash + ciphertext, directory anchors in `identity_tree_entries` + queues in
   `pickup_queue`, pushes a `trust_signal_pickup` frame down the agent's authenticated signaling stream
   with the authoritative hash attached, the daemon opens the seal, **re-hashes, compares, stores, and
   only then ACKs** (no ACK ⇒ retry). The 2026-04 pickup-queue design is **shipped code**. M10 does not
   invent holder delivery.
3. **…and that scaffold violates three M10 invariants**: `SIGNAL_KINDS = new Set(["webauthn"])` in the
   *directory's* validator (INV-ZERO-BUMP), `identity_tree_entries` upserting `DO UPDATE`
   (INV-SUPERSEDE-NOT-MUTATE), and hashing **canonical JSON** not CBOR (INV-CANONICAL). Replace, do not
   extend.
4. **INV-CHOKEPOINT is net-new.** Today: a single static bearer header, non-constant-time compared,
   over **plaintext HTTP on a public ALB**, and it is **the same secret the ops-agent holds** — so any
   key-holder can write a trust-signal hash for any account, or mint a pre-auth capability. No
   authorized-issuer/portal-pubkey concept exists anywhere.
5. **The portal holds no signing key.** `kms.ts` is not AWS KMS — it is a local AES-GCM envelope cipher
   keyed by a `PORTAL_KMS_MASTER_KEY` env var (all-zeros default in `local`). The M8 pipe is
   **seal-only and unsigned** (`sealToRecipient` needs no sender key).
6. **AWS KMS supports Ed25519 natively** — `ECC_NIST_EDWARDS25519` / `ED25519_SHA_512` (MessageType
   `RAW` = pure EdDSA), private key never leaves KMS, `GetPublicKey` for offline verify. So "the portal
   holds no private key at all" is a live custody option. (KMS also offers ML-DSA-44/65/87.)
7. **Class-3 track record is already computed** — `pseudonym_stats` (V7) holds conversation count,
   unique counterparties, clean/flagged counts — but it is **pseudonym-keyed**, has **zero exposure**
   (no route, no frame, no accessor), and **neither it nor its inputs are replicated**, so the three
   nodes may disagree. DOD-DIRDATA-READ-1 is bigger than written.
8. **The portal has no background-job machinery**, and Next 16's `after()` is **request-bounded** (per
   the installed docs) so it cannot host the Class-3 job. The only hatch into long-lived Node is
   `instrumentation.register()`. The job's home is a real new-process decision, shaped by ECS.

**Also surfaced (bugs/defects found, not caused by this work):** the daemon stores trust signals with
`agent_id = null` (`daemon.ts:4920`) and **nothing reads the table** — so INV-AGENT-SCOPED would be
violated at birth; `pickup-repository.ts:80-81` claims `pickup_queue` is node-local while
`setup-replication.sh:169` **does** replicate it (one is wrong); and the directory's code comment
claiming the ALB rejects `/internal/*` is contradicted by the CFN, which forwards it.

**Not done here, by design.** No architecture, no recommendations. The investigation §11 states the
seven forks (key custody · where the CBOR component lives · the Class-3 job's home · registry signing
keys · submission transport · portal→directory failover · Account-vs-Agent subject binding) and §10
lists the seven DoD lines this evidence obliges us to edit **before** Tier 0 code.

**Next:** DOD-PORTAL-ARCH-1 half 2 — the architecture determination, written against the investigation,
reviewed by `cello-unit-reviewer`, decisions logged in the DoD.

---

### 2026-07-11 — Entry 3: M10-D4 + M10-D5 — recipient storage settled; subject_kind added to the envelope (amends Entry 1's preimage)

**M10-D4 (Andre):** recipients DO store presented signals (plaintext-in-SQLCipher evidence rows,
`verified_at` metadata) — all "verdict-only / does-not-persist" spec phrasing was wrong and is
amended; statelessness = reliance (evaluate only the presented set). TWO client tables (spec §3.1):
wallet `trust_signals` + received store `contact_trust_signals`. M8 scaffold rows: drop + re-mint.

**M10-D5 (Andre):** subjects have two levels — **`subject_kind: account | agent`, both hashed**
(spec §3.2, §4). Operator-level facts (phone/email/social) are account-subject, ONE envelope per
fact, agent-add a no-op; track record is agent-subject and may also mint an account aggregate;
endorsements may target either (default: specific agent unless requested and agreed — post-v1
intake policy, seam ships now). Dumb check 2 resolves account subjects through the presenting
agent's account (spec §2). Cross-persona linkability of account signals: accepted, selective
disclosure is the lever. Multi-daemon portability constraint logged as spec §14.11; sync mechanism
+ same-agent-two-daemons control handoff PARKED (DoD). Supersedes investigation §12 R7.

**⚠️ Amendment to Entry 1 (append-only, so noted here, never edited there):** the CBOR-1 design
note's preimage list now includes **`subject_kind`** before `subject`. The DoD's DOD-CBOR-1 line
carries the authoritative field list. All decided BEFORE any hashing exists — DOD-CBOR-1 has not
started, so no hash breaks (spec §5's retrofit warning honored).

---

### 2026-07-11 — Entry 3: DOD-PORTAL-ARCH-1 half 2 DONE — the architecture determination, reviewed, findings fixed → line ✅

**What shipped.** [[M10-PORTAL-ARCH-DETERMINATION]] (`72b973ef` draft, fixes follow-up commit) —
resolves all seven investigation forks: **M10-D6** KMS-held Ed25519, portal holds no key; **M10-D7**
one CBOR implementation in `@cello-protocol/crypto`; **M10-D8** in-process Class-3 scheduler;
**M10-D9** dedicated registry key, build-time pinned pubkey; **M10-D10** new type-blind signed
`/internal/signal/*` surface over TLS, `agent-write` signal arms retire; **M10-D11** static
directory failover list, exhaustion fails loud; **M10-D12** no authoritative signal state in the
portal; **M10-D13** late-added agents via re-mint-with-supersession. Plus the `SignalTypeModule`
per-type interface, the corrected M8 delivery pipe, two-KMS-key custody with ops-agent excluded in
IAM, and backfill-is-the-migration sequencing.

**Review (cello-unit-reviewer, fable).** Verdict: strong determination, blocking set narrow. 8
findings, ALL fixed in the doc + DoD:
- **F1 HIGH** — late-added-agent delivery had NO plaintext source (portal keeps no signal state,
  directory stores hash-only, pickup ciphertexts deleted on ACK) — the drafted "seal the existing
  envelope to the new agent" was unimplementable. → **M10-D13**: re-mint with supersession
  (amends M10-D5: agent-add = no-op on verification, supersede on delivery); journey coverage
  added to DOD-T1-JOURNEY-1(a).
- **F2 HIGH** — the verified-account-facts read (how `verify()` reaches `phone_stub_hash`) was
  silently undelivered → query arm (c) added to §3.3, presence booleans + stubs only.
- **F3 HIGH** — the replay-harmlessness claim was violated by the doc's own unconditional
  supersede-marking (replayed submit could launder `revoked` → `superseded`) → two normative
  rules pinned (duplicate = strict no-op never touching status; supersede = `active → superseded`
  only) + negative AC on DOD-DIR-WRITE-1.
- **F4 MED** — exact-pubkey revocation auth broke under key rotation → role-based for
  portal-issued (DOD-REVOKE-1 updated).
- **F5 MED** — failure events + operator-visible mint failure named per surface (incl. failover
  EXHAUSTION fails loud).
- **F6 MED** — legacy bearer-key `/internal/*` routes: accepted-at-launch stated explicitly,
  moved behind DIR-WRITE-1's TLS listener; retirement → Post-v1 section.
- **F7 LOW** — INV-CANONICAL scoped to envelopes; registry deliberately uses the manifest's
  canonical-JSON convention (one shipped verifier).
- **F8 LOW** — M10-D12 carve-out tightened: transient verification-flow state, TTL'd, never
  envelope data.
- **Test-teeth gaps** → DOD-T1-JOURNEY-1 gained (a) late-agent, (b) failover, (c) custody
  (no key material in the task definition; `authorized_issuers` pubkey == KMS `GetPublicKey`).

**⚠️ For Andre's veto — M10-D13.** F1 forced a genuine trade against a stated rule. Chosen:
re-mint-with-supersession (M10-D5's "agent-add is a no-op" amended to no-op-on-verification).
Rejected: directory escrow of envelope plaintext (breaks hash-only/no-PII storage — treated as
non-negotiable) and deterministic re-composition (fragile). Residual disclosed: an agent added
out-of-band waits for the next portal touch.

**Next:** DOD-CBOR-1 (design note = Entry 1; packaging now decided by M10-D7).

---

### 2026-07-14 — Entry 4: DOD-CBOR-1 design note AMENDED against the code (three premises in Entry 1 were wrong)

**Why this entry exists.** Entry 1's design note was written from the spec, and its own falsification
pass listed as item (1): *"Does `@cello-protocol/crypto` (or transport) already ship a CBOR encoder,
and is it CDE-capable or configurable to be? — verify in code at unit start; do NOT assume."* That
check has now been run. It changed the answer to three separate questions, so the note is amended
here (append-only — Entry 1 is never edited) BEFORE any code is written.

**Finding 1 — the encoder consolidation already shipped, and it is GUARDED.**
`core/protocol-types/src/cbor.ts` is the single CBOR encoder (`encodeCbor` / `decodeCbor`, a lone
`new Encoder({ tagUint8Array: false, useRecords: false })`). It arrived in `3a930cd` ("§1.1 ONE
canonical CBOR encoding, and migrate the blobs already on disk") and `7386308`. It is enforced:
`src/__tests__/no-multiple-cbor-encoders.test.ts` walks every production `.ts` under `core/*/src`
and FAILS THE BUILD if any file constructs its own `Encoder` or imports cbor-x's bare `encode`.
Consequence for this unit: DOD-CBOR-1 must USE this encoder. Adding a second one — anywhere,
including in `crypto` — is not merely discouraged, it is red.

**Finding 2 — that encoder is NOT deterministic, and the doc-comment overclaims.** Measured, not
assumed (PROCEDURE §5c — measure before quoting):

```
encode({b:1, a:2})  ->  b9 0002 6162 01 6161 02
encode({a:2, b:1})  ->  b9 0002 6161 02 6162 01     byte-identical: FALSE
```

Two defects against RFC 8949 §4.2 Core Deterministic Encoding. (a) **Map keys follow INSERTION
ORDER**, not bytewise sort — so two implementations building the same logical object in a different
field order produce different bytes, hence different hashes. (b) **The map header is not
minimal-length**: a 2-entry map emits `b9 0002` (16-bit count) where CDE requires `a2`. The file's
own doc-comment says *"Encode to canonical CBOR … Plain RFC 8949"* — true as to RFC 8949 core, but
it reads as a canonicity claim it does not meet. That comment is corrected as part of this unit.

**Nothing shipped is broken by Finding 2, and the reason is already written down.** PROCEDURE §5b:
*"Changing the CBOR encoder altered OBJECT encoding but not ARRAY encoding — and every signed TBS
encodes an array, so no signature was affected."* Confirmed in code: `buildAgentRevocationTbs`
(`revocation.ts`), `buildPrimaryTransferTbs`, `buildSealTbs`, `buildParkContentTbs` are all
`encodeCbor([...])` over a **fixed-order array whose element 0 is a domain-separation string**
(`AGENT_REVOCATION_DOMAIN = "CELLO-REVOKE-v1"`, `PRIMARY_TRANSFER_DOMAIN`, …). Objects were never
the signed surface. **The exposure is prospective, not historical:** the moment the trust-signal
envelope is hashed as a CBOR *map*, insertion order becomes load-bearing across three independent
implementations (portal/TS, directory, client) — which is precisely the cross-party divergence
DOD-CBOR-1 exists to prevent, and it would fail silently and intermittently.

**Finding 3 — M10-D7 named the wrong home.** M10-D7 put the one CBOR implementation in
`@cello-protocol/crypto`, reasoning that crypto is already the portal's only CELLO dependency
(`cello-portal/package.json:20` — `"@cello-protocol/crypto": "^0.0.11"`). But the dependency edge
runs the other way: `protocol-types → crypto` (`protocol-types/package.json` depends on crypto +
cbor-x; crypto depends on noble + liboqs only, and has no cbor-x). Putting a CBOR encoder in crypto
therefore means either a SECOND encoder (red, per Finding 1) or inverting a package dependency.
M10-D7's *intent* — ONE implementation, no vendored copies — is right and is preserved. Its *home*
is corrected.

**The three decisions this amendment makes** (graduating to the DoD Decisions section as
M10-D15/D16/D17):

1. **M10-D15 — the envelope preimage is a fixed-order CBOR ARRAY, not a map.** Determinism becomes
   structural rather than a property of the encoder: arrays have no key-ordering freedom and the
   existing encoder already emits them identically everywhere. This also means **zero encoder
   change and zero migration** of the blobs on disk. Rejected: making `encodeCbor` CDE-compliant
   (sorted keys + minimal-length headers) — it changes object encoding for every existing caller,
   on the wire and in existing DB columns, to buy a determinism the array gives for free; that is a
   data migration in exchange for nothing. Also rejected: a second CDE-only encoder beside the
   shared one — Finding 1 makes that red, and correctly so.
2. **M10-D16 — the component lives in `@cello-protocol/protocol-types`**, which already owns the
   sole encoder, the TBS-builder convention, and the canonical test-vector directory
   (`test/vectors/*-canonical.json`). cello-portal adds `@cello-protocol/protocol-types` as a
   dependency (it is published; trustless-cello already pins it at `^0.0.3`). **This amends
   M10-D7's home while keeping its intent intact.** Rejected: moving `cbor.ts` into crypto and
   re-exporting from protocol-types — more churn, drags cbor-x into the crypto package, same result.
3. **M10-D17 — optional preimage fields are an explicit CBOR `null` in a FIXED SLOT, never
   omitted.** This REVERSES Entry 1's "absent optional fields OMITTED (never null)" rule, which was
   correct for a map and is wrong for an array: in an array, omitting a field shifts every later
   field's position and changes the arity, so `expires_at` absent would be indistinguishable from
   `supersedes_hash` present-in-the-wrong-slot. Fixed arity + explicit null is the unambiguous form.
   The two nullable fields are `expires_at` (signals that never expire) and `supersedes_hash` (a
   first mint supersedes nothing).

**Also carried over from Entry 1, unchanged and still correct:** no floating point anywhere
(timestamps are integer epoch-seconds); `payload` embedded as an opaque byte string, never decoded
or re-encoded (a payload parsed-and-re-encoded would change bytes under a different encoder version
— treating it as opaque kills that class, and it is what INV-ZERO-BUMP depends on); the preimage is
a CLOSED set (an unknown extra envelope field is rejected loud, not ignored); `status` / `class` /
`verified_at` are OUT of the preimage (they are mutable after minting — that is the whole point of
excluding them, and a tamper test pins it).

**Domain separation — house convention wins over Entry 1.** Entry 1 proposed a byte-concatenated
prefix: `SHA-256("CELLO-TSIG-v1" || envelope-bytes)`. The codebase instead binds the domain tag as
**element 0 of the TBS array itself** (`revocation.ts`, `primary-transfer.ts`, `content-delivery.ts`
all do this). Same property, one less concept, and it is what every reviewer here already reads
fluently. `TRUST_SIGNAL_DOMAIN = "CELLO-TSIG-v1"` goes in slot 0. Hash = SHA-256 over the array
bytes.

**The preimage, authoritatively** (the DoD's DOD-CBOR-1 field list, in array order):

```
[ "CELLO-TSIG-v1", subject_kind, subject, issuer_kind, issuer_pubkey,
  type, schema_version, payload, issued_at, expires_at|null, supersedes_hash|null ]
```

**Falsification pass (re-run for the amended design).** (1) Does the call site have the method on
the interface? — `encodeCbor` is exported from `protocol-types/src/index.ts` and the new module sits
inside that package, so it imports `./cbor.js` directly, exactly as the four existing TBS builders
do. Checked. (2) Does responsibility live here? — yes: protocol-types is where every other canonical
wire structure and TBS builder in CELLO lives; putting the envelope anywhere else splits the
convention. (3) Redundancy? — none; no envelope canonicalization exists today (grep for
`subject_kind` / `issuer_kind` / `supersedes_hash` across `core/` returns only the four M8 scaffold
files in `daemon`, none of which hash an envelope). (4) What else breaks? — nothing consumes a
trust-signal envelope hash today, so there is no call-site regression surface; greenfield, and that
is the falsification RESULT, journaled as such per Entry 1's item (4). (5) Install cost? — cbor-x is
already a dependency of protocol-types; the portal gains one published package, no native module.

**Test plan (red-first).** Committed fixed vectors (envelope → exact hex bytes → exact hash) under
`test/vectors/`, consumed by all three repos' suites — the cross-party enforcer for
DOD-INV-CANONICAL. Property-based: random envelopes, encode→decode→encode is byte-identical, and
field-order-of-construction does not change the hash (the direct regression test for Finding 2).
Tamper: a single-bit flip anywhere in the preimage changes the hash; a mutated `status` does NOT.
Closed-set: an unknown extra envelope field is rejected loud. Null-slot: `expires_at: null` and
`supersedes_hash: null` encode to a fixed arity and are not confusable with each other.

---

### 2026-07-14 — Entry 5: DESIGN NOTE — DOD-STORE-CLIENT-1 (written before any code)

**Target behavior (one sentence).** A daemon has two SQLCipher tables — a wallet of signals it holds
about itself, and a per-contact store of signals other agents presented to it — and neither of them
knows what a signal *type* is.

**Spec anchors.** Spec-of-record §3 (the envelope columns), §3.1 (the two tables), §14.10 (the
backfill), §14.11 (content-addressed, daemon-portable wallet rows). Decisions: **M10-D4** (two
tables, never one with a role flag), **M10-D5** (`subject_kind`), **M10-D14** (wallet rows carry NO
agent association: PK = `signal_hash`, one row per signal per daemon).

**This unit touches TWO repos** (PROCEDURE §2a, stated up front): `cello-client` (the tables + the
store API) and `trustless-cello` (`packages/e2e-tests/src/spine/j-trust.spine.test.ts`, which reads
`trust_signals` by raw SQL at lines 149 and 185).

**Producer/consumer chain — the M8 scaffold, triaged by SUBJECT (§5b), not by file.** Evidence:
- **`trust_signals` (M8)** — `db-identity-store.ts:178` —
  `(signal_hash PK, agent_id NULLABLE, signal_kind, payload, received_at)`.
- **Producer:** exactly ONE, `inbound-sessions.ts:601`, the `trust_signal_pickup` arm, and it passes
  **`agentId: null`** — the INV-AGENT-SCOPED defect the investigation found (§9), present at birth.
- **Consumer:** `getTrustSignal` has **ZERO production callers.** Nothing in the daemon reads this
  table. The only reader anywhere is the spine test's raw SQL.
- **The spine test's SUBJECT is ALIVE.** `j-trust.spine.test.ts` exercises the portal→directory→
  daemon delivery pipe (seal → anchor → push → re-hash → compare → store → ACK). That pipe is prior
  art M10 explicitly keeps — investigation §5: *"M10 does not invent holder delivery"* — so the test
  is a live subject behind a doomed driver. **It gets RE-POINTED, never deleted.**

**The sequencing fork this exposes.** The DoD says the M8 table is *"dropped and its signals
re-minted via the §14.10 backfill, never migrated."* Taken literally as "drop it in THIS unit," the
drop lands several units before its replacement: the M8 writer would write to columns that no longer
exist, the spine test would go red, and there would be an open window — spanning DIR-WRITE-1,
REVOKE-1, REGISTRY-1 — in which the delivery pipe has no coverage at all. A red gate held open
across four units is how a coverage hole becomes permanent.

**Decision — M10-D18: this unit is ADDITIVE; the DROP travels with the BACKFILL.** Create the two
new tables and their store API now. Leave the M8 scaffold table and its single writer untouched.
Drop the scaffold in **DOD-MINT-INTERNAL-1** — the unit that re-points the delivery arm onto real
CBOR envelopes and re-points the spine test with it — so the drop and its replacement land in the
same commit, no gate is ever red, and no coverage window opens. This is not a scope change: the DoD
already binds the drop to the backfill (*"re-minted via the §14.10 backfill"*), and MINT-INTERNAL-1
**is** the backfill. Rejected: drop-now-rebuild-later (opens the window above); and keeping both
tables permanently (two sources of truth for one fact — exactly the M8 defect, preserved).

**The schema.**
```sql
-- WALLET: signals ABOUT this daemon's agents. M10-D14 — no agent association at all.
CREATE TABLE IF NOT EXISTS wallet_trust_signals (
  signal_hash     TEXT PRIMARY KEY,     -- content-addressed: the row IS its hash (§14.11)
  subject_kind    TEXT NOT NULL,        -- 'account' | 'agent'  (hashed — decides who may present)
  subject         TEXT NOT NULL,        -- (hashed)
  issuer_kind     TEXT NOT NULL,        -- (hashed) drives LLM framing
  issuer_pubkey   TEXT NOT NULL,        -- (hashed)
  type            TEXT NOT NULL,        -- OPAQUE STRING. No enum, no CHECK, no switch. INV-ZERO-BUMP.
  schema_version  INTEGER NOT NULL,     -- (hashed)
  payload         BLOB NOT NULL,        -- OPAQUE BYTES. Never parsed, never a column. (hashed)
  issued_at       INTEGER NOT NULL,     -- (hashed) epoch SECONDS
  expires_at      INTEGER,              -- (hashed) NULL = never expires
  supersedes_hash TEXT,                 -- (hashed) NULL = first mint
  status          TEXT NOT NULL,        -- MUTABLE, OUTSIDE the hash — that is why it is not hashed
  received_at     INTEGER NOT NULL      -- local bookkeeping, outside the hash
);

-- RECEIVED: signals OTHER agents presented to one of MY agents. Consent scoping IS per-agent here.
CREATE TABLE IF NOT EXISTS contact_trust_signals (
  agent_id        TEXT NOT NULL,        -- NOT NULL. The M8 `agent_id = null` defect dies here.
  contact_pubkey  TEXT NOT NULL,
  signal_hash     TEXT NOT NULL,
  ... same envelope columns ...
  verified_at     INTEGER NOT NULL,     -- when WE re-verified it (M10-D4 — evidence, never an input)
  received_at     INTEGER NOT NULL,
  PRIMARY KEY (agent_id, contact_pubkey, signal_hash),
  FOREIGN KEY (agent_id, contact_pubkey) REFERENCES contacts(agent_id, pubkey) ON DELETE CASCADE
);
```
`contacts` is `PRIMARY KEY (agent_id, pubkey)` (`session-node-manager.ts:640`), so the composite FK
lands cleanly and INV-AGENT-SCOPED is enforced by the DATABASE, not by a query convention: a
received signal cannot exist except hung off one agent's contact row.

**Why the wallet table is renamed, not reused.** `wallet_trust_signals` vs the M8 `trust_signals`.
Reusing the name would force the additive step above to collide with the live scaffold. The rename
also makes the M8 drop a one-line, greppable event rather than an in-place column rewrite whose
failure mode is a half-migrated table on an operator's disk (client-side migrations are
unrecoverable without manual intervention — repo CLAUDE.md).

**Invariants at stake.** INV-ZERO-BUMP — `type` is `TEXT`, with **no `CHECK`, no enum, no index
predicated on a type value**; a reviewer must be able to grep this schema and find nothing per-type.
INV-AGENT-SCOPED — the composite FK above. INV-STATELESS-RECIPIENT (M10-D4) — `contact_trust_signals`
is EVIDENCE: it is written after verification and is never read as an input to policy evaluation, and
this unit ships **no read path that policy could consume**, which is the structural way to keep that
true rather than a rule someone must remember.

**Falsification pass.** (1) Does the call site have the method on the INTERFACE? — the store API is
new; `db-identity-store.ts` already owns the SQLCipher handle and the `CREATE TABLE` convention, so
the tables go where the other tables are. Checked. (2) Responsibility — the wallet is identity-scoped
(the daemon's own facts), so `db-identity-store` is right; the received store is contact-scoped and
FKs to `contacts`, which lives in `session-node-manager.ts:640`. **These are two different files with
two different DB handles — VERIFY they are the same SQLCipher database before writing the FK, or the
foreign key references a table in another file's connection and fails at runtime, not at typecheck.**
That is the one thing that can sink this unit and it is checked FIRST. (3) Redundancy — none; no
envelope store exists. (4) What else breaks — `storeTrustSignal`/`getTrustSignal` keep working
untouched under M10-D18, so nothing breaks; the spine test stays green.

**Test plan sketch.** Red-first, in the daemon's DB tests: both tables exist with exactly the
envelope columns; `type` accepts a string no code has ever seen (INV-TYPE-CARRY) and there is no
`CHECK` to reject it; a `contact_trust_signals` insert with a `NULL` agent_id is REFUSED by the
schema; an insert for a contact that does not exist is REFUSED by the FK (INV-AGENT-SCOPED, enforced
by the DB); `status` is updatable while the hash is not; duplicate delivery is a no-op
(`INSERT OR IGNORE` — the §14.11 sync property); migration is idempotent (run it twice) and
**fresh schema == migrated schema** (build a DB from scratch and one from an M8-era DB, compare
`PRAGMA table_info` — the DoD clause).

---

### 2026-07-14 — Entry 6: DOD-CBOR-1 BUILT + REVIEWED → 🟡. The reviewer found a float where a hash should be.

**Shipped.** `@cello-protocol/protocol-types/src/trust-signal.ts` — `encodeTrustSignalEnvelope`,
`hashTrustSignalEnvelope`, `verifyTrustSignalHash`, plus 7 frozen cross-party vectors. Commits
`bec1230` (build) and `3ae336a` (review fixes). Gates: **164/164** protocol-types tests, lint,
typecheck, build; presence asserted on the BUILT artifact (`dist/trust-signal.js`), not on source.

**THE BUG — the one the unit existed to prevent, sitting inside the unit.** cbor-x encodes any JS
`number` above `0xffffffff` as an IEEE **float64** (`fb`), never a uint64 (`1b`). Measured:

```
encode(1768000000)         -> 1a 69618a00           uint32   ✅
encode(4920000000)         -> fb 41f25413e0000000   FLOAT64  ❌
encode(BigInt(4920000000)) -> 1b 0000000125413e00   uint64   ✅  ← what RFC 8949 requires
```

`requireEpochSeconds` accepted up to 1e11, so the entire band `[2^32, 1e11)` was **accepted and
float-encoded**. `schema_version` had no upper bound at all — `1e300` passed and encoded as a float.

**This is not a 2106 problem.** An `expires_at` a century out is `1.768e9 + 3.15e9 = 4.92e9`, well
past 2³², and reachable by the first long-dated signal the portal mints. A conforming CBOR library in
Rust/Go/Python emits `1b…`; we emitted `fb…`. Different preimage → different SHA-256 → a permanent,
unfixable `hash_mismatch` on a perfectly valid signal — and per spec §5, retrofitting the canonical
form once signals exist breaks every hash already minted.

**Three compounding failures, each worth remembering:**
1. **The module forbade it in its own header** ("NO FLOATING POINT … a float would not survive
   byte-agreement across languages") and did it anyway, twelve lines down.
2. **Both sibling TBS builders already carry the guard** — `buildSealTbs` (`session.ts:160,271`) and
   `buildAgentRevocationTbs` (`revocation.ts:39`) both do `v > 0xffffffff ? BigInt(v) : v`. Entry 4's
   commit claimed the preimage was built *"exactly as every other signed TBS in CELLO already does
   it."* It was not. It was **the only one without the guard** — the claim of matching the house
   pattern was made without checking the one line of the house pattern that mattered.
3. **The tests looked like coverage and were not.** The whole suite stayed inside the safe band: the
   hand-derived vector used 1e9, the largest frozen vector 1.79e9, and the property test drew
   `rnd(2_000_000_000)` — **strictly below `0xffffffff`**. So a `describe("no floating point, ever")`
   block read as coverage of the float class while never once drawing a value that emits a float. A
   float-emitting implementation passed all 33 tests. **A property test that cannot reach the failing
   band is not testing the property** — the generalizable lesson, and the reason the revert test alone
   would not have caught this either.

**Fixed:** `asCborInteger()` coerces `> 0xffffffff` → BigInt for `issued_at` / `expires_at` /
`schema_version`; values past `MAX_SAFE_INTEGER` are REFUSED rather than hashed as an approximation
(past 2⁵³ a JS number cannot represent consecutive integers, so there is no honest hash to produce).
The property test now draws ACROSS the 2³² boundary and asserts no preimage anywhere in the random
space contains a float64 marker; a far-future vector (`expires_at = 4.92e9`) is frozen; and the
encoder-premise test now PINS the trap itself, so a future cbor-x change surfaces as a red test
rather than as a signal that quietly stopped verifying.

**The other seven findings, all fixed.** F2 (MED): the vectors shipped in `files` but the `exports`
map declared only `"."`, so `import "@cello-protocol/protocol-types/test/vectors/…"` throws
`ERR_PACKAGE_PATH_NOT_EXPORTED` — the two repos the `files` line was added for could not read them;
the shipped artifact did not do the job its commit claimed. F3 (MED): no Unicode normalization guard,
a hazard **spec §5 names by name** — "é" is `c3a9` in NFC and `65cc81` in NFD; now REFUSED, never
silently normalized (silent normalization would make two DIFFERENT inputs hash to the SAME signal — a
collision we manufactured ourselves). F4 (MED): `issuer_pubkey` is hex and hex has a CASE — `"AABB"`
and `"aabb"` are one key and two hashes; now lowercase-only. F5/F6 (LOW): the hash-length constant
coupled two independent sizes; the deliberate return-false-vs-throw asymmetry is now documented so no
call site papers over it with `catch { return false }`. F7: checked, NOT a hole (recorded so nobody
re-checks it).

**F8 — a PRE-EXISTING defect found and fixed (standing rule: fix it when you find it).**
`buildPrimaryTransferTbs` had the same missing guard, and its `timestamp` is documented as
**milliseconds** (`Date.now()` ≈ 1.77e12 — far past 2³²). Any caller passing ms would have had the
TBS hashed as a float, and any non-cbor-x verifier would compute different bytes and **reject a
genuine primary transfer**. Verified safe to fix: `primary_transfer_request` has **no producer in
cello-client**, so no signature exists over these bytes, and every timestamp below 2³² encodes
byte-identically to before (pinned by a test). Audited the rest while there: `session.ts` and
`revocation.ts` guard; `content-delivery.ts` builds raw byte concatenations with no CBOR integers.
**primary-transfer was the only remaining hole.**

**The reviewer independently decoded all six frozen vectors byte-by-byte against RFC 8949** and
confirmed the hand-derived reference is genuine, not generated-and-asserted-back. The anchor holds.

**Why 🟡 and not ✅.** Clause 4 wants *all three* consumers agreeing byte-for-byte in CI. Only one
consumer exists today, and the vectors only became reachable to the other two with the F2 `exports`
fix — which needs a publish to take effect. **Not ✅ until the published artifact works** (the DoD's
own rule). Completes at the Tier 0 publish boundary, batched with DOD-STORE-CLIENT-1 rather than
burning a cascade per unit (PROCEDURE §2c).

---

### 2026-07-14 — Entry 7: DOD-STORE-CLIENT-1 — the fix for one invariant ARMED a data-loss landmine

**Shipped.** `core/daemon/src/trust-signal-store.ts` (wallet + received tables, store API),
`PRAGMA foreign_keys = ON` (M10-D19), `withForeignKeysOff()` (the fix below). Commits `800e865`
(build), `c778811` (a unit bug I caught myself), plus the review fixes.

**THE BIG ONE — F1. Turning on the guard that makes INV-AGENT-SCOPED real also armed a silent
cascade-wipe of every received trust signal.** The reviewer found it; I had not looked. Measured:

```
children before rebuild: 1
PRAGMA foreign_keys = OFF   (inside BEGIN)  -> still reports 1   ← A SILENT NO-OP
DROP TABLE contacts                         -> children: 0       ← ON DELETE CASCADE fired
```

Three facts, all newly true because of M10-D19:
1. With FK enforcement ON, **`DROP TABLE parent` is an implicit `DELETE FROM parent`** — so it fires
   `ON DELETE CASCADE` and silently empties `contact_trust_signals`. No error. Green suite.
2. **`PRAGMA foreign_keys` is a NO-OP inside a transaction.** SQLite ignores it and says nothing. So
   the intuitive mitigation — disable FKs around the rebuild — *looks* right and cascades anyway.
3. `ALTER TABLE parent RENAME TO parent_old` **rewrites the child's FK clause** to point at the
   renamed table.

**And `contacts` is one of the seven tables `agent-id-migration.ts` rebuilds** with exactly this
create-copy-drop-rename recipe, inside one `BEGIN…COMMIT`. The migration's own row-count guards would
not have noticed: **they count `contacts`, not its children.** Every received signal on every agent,
gone at next boot, with nothing logged. It is not triggered *today* only because
`ensureTrustSignalSchema` happens to run AFTER the migration — **luck of ordering, not a guard.**

**Fixed** with `withForeignKeysOff(db, logger, fn)` in `sqlcipher-db.ts`: it toggles the pragma
OUTSIDE the transaction, **VERIFIES the toggle actually took effect** (the failure is silent by
nature, so assuming it would be the same mistake one level up) and REFUSES to proceed if it did not,
and on the way out re-enables FKs and runs `PRAGMA foreign_key_check` so a rebuild that leaves a
dangling reference fails loudly instead of surfacing as a mystery insert failure days later.
`migrateSessionTablesToAgentId` now runs inside it. The regression test drives the REAL recipe (seed a
contact + a received signal → rebuild `contacts` → assert the signal **survives** and
`foreign_key_check` is clean) — that test is the only thing that will stop this recurring.

**The generalizable lesson.** *Turning on a dormant safety mechanism is a behavior change to every
code path that mechanism touches* — including the ones written while it was off. "Zero existing FKs,
so enabling enforcement is safe" was true **backwards** and false **forwards**: the danger was not in
what the FK would reject, but in what the new CASCADE would delete. The 973-green suite said nothing,
because no test rebuilds `contacts` while children exist.

**F2 — a peer could rewrite our own evidence.** `putReceivedSignal` upserted
`status = excluded.status`. But `status` is **outside the hash preimage** — which is what makes it
mutable, and also means it is **not authenticated by the signal hash**. `ReceivedSignalInput` extended
`WalletSignalInput`, so the peer's claimed `status` rode in the same struct as the envelope fields and
the natural DOD-VERIFY-1 call site would have passed it straight through. Attack: Bob presents H; we
check the directory, find it REVOKED, store that. Next session Bob re-presents H claiming `active` —
and the one durable record saying we caught him is overwritten **by the party it indicts**. Evidence an
adversary can rewrite is not evidence. Fixed structurally: `ReceivedSignalInput` now `Omit`s `status`
and requires `verdict` (OUR directory-derived verdict), so there is no pass-through to forget to block;
and the upsert is **monotonic** — a verdict may only ever worsen, never return to `active`.

**F3 — I had already caught this one myself** before the review landed (`c778811`): `listPresentable`
compared epoch SECONDS against a value derived from MILLISECONDS. The reviewer independently found it
and rated it blocking, which is a useful calibration: my own adversarial pass and an independent one
converged on the same defect.

**F4 — the module's one ABSENT-IS-NOT-FINE violation, in a module built on that principle.**
`toBytes()` returned `new Uint8Array(0)` for an unrecognized shape from the driver — so a payload that
failed to materialise would flow onward as a *valid signal with empty content*, its hash would then
fail to match, and the operator would be sent hunting a canonicalization bug that does not exist. Now
throws `signal_payload_not_bytes`, naming the storage-layer fault and distinguishing it from a
genuinely empty payload (which is a zero-length BLOB, a different thing).

**F5 — `revoked → active` resurrection.** `setWalletStatus` was a blind UPDATE, so a stale or replayed
directory read reporting `active` for a hash we already revoked would flip it back, and
`listPresentable` would offer a revoked signal again. **Revocation is now terminal** (a `superseded`
signal may still worsen to `revoked`, never the reverse, never back to `active`), and a refused
downgrade logs `signal.wallet.status.change_refused` rather than passing silently. The directory is
the authority on revocation, but *a late answer is not a new answer*.

**F7 — my deferral pin pointed the wrong way,** and the commit message overclaimed. I wrote that a
test "pins the scaffold's continued existence so the deferral cannot be forgotten silently." It does
the opposite: it fails only if someone drops the M8 table EARLY. If MINT-INTERNAL-1 never lands, it
stays green forever and the `agent_id = null` defect survives with it. Corrected in the test's own
comment; the real forcing function is MINT-INTERNAL-1's DoD clause, which is a document, not a gate.

**F8/F9 (LOW), both fixed.** The store constructor also created the schema, which made
`new TrustSignalStore(anyHandle)` able to build `contact_trust_signals` with a **dangling FK** on a
handle lacking `contacts` — failing later on the first insert with an error naming the wrong
subsystem. `initialize()` now owns the schema alone. And `verified_at ?? 0` defaulted a `NOT NULL`
column to "verified at the epoch," indistinguishable from a real absurd timestamp — the received store
now has its own row type where `verified_at` is required.

**A hollow test the reviewer caught that I would not have.** "fresh schema == migrated schema"
compared `PRAGMA table_info` — names, types, NOT NULL. That says **nothing about the FOREIGN KEY, the
PRIMARY KEY, or the indexes**. A migrated database that had lost the FK entirely would have passed the
test guarding the very constraint this unit is built on. It now compares the actual DDL from
`sqlite_master` and asserts the FK is present in both.

---

## Related Documents

- [[M10-PORTAL-ARCH-INVESTIGATION]] — DOD-PORTAL-ARCH-1 half 1: what the portal/directory/client
  actually are today (evidence, `path:line`). Read before any M10 design or code.
- [[M10-PORTAL-ARCH-DETERMINATION]] — DOD-PORTAL-ARCH-1 half 2: the decided architecture
  (M10-D6…D13), reviewed 2026-07-11.
- [[M10-PROCEDURE]] — the runbook
- [[M10-DEFINITION-OF-DONE]] — the yardstick + sole status authority
- [[M10-TYPE-PLAYBOOK]] — the per-type runbook
- [[M10-TRUST-SIGNAL-STORAGE-AND-CREATION]] — spec-of-record (HOW)
- [[M10-TRUST-SIGNAL-TAXONOMY]] — spec-of-record (WHAT)
