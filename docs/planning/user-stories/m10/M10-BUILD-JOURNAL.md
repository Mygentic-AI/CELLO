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

### 2026-07-14 — Entry 8: Tier 0 publish, DOD-CBOR-1 ✅ CROSS-PARTY, V46 written — and a BLOCKER

**Published (Tier 0 cascade, `/cello-publish` loaded for this publish).** Tag `v0.0.109`; CI Build →
Publish → **smoke-tag all green** (smoke-tag is the real signal). Versions on **beta**:

| package | version |
|---|---|
| crypto | 0.0.22 |
| protocol-types | **0.0.23** |
| transport | 0.0.23 |
| daemon | **0.0.60** |
| cli | 0.0.58 |
| connect | 0.0.74 |
| gateway | 0.0.4 |

**Verified against the BINARY, not CI status** (skill §5): `npm pack`'d protocol-types@0.0.23 —
`dist/trust-signal.js` contains `hashTrustSignalEnvelope` / `TRUST_SIGNAL_DOMAIN` / `CELLO-TSIG-v1`;
`test/vectors/trust-signal-envelope-canonical.json` is in the tarball; the `exports` map opens
`./test/vectors/*`. Every cross-pin is a real version, no `workspace:*` (cli→daemon 0.0.60,
daemon→protocol-types 0.0.23, connect→crypto 0.0.22 / transport 0.0.23).
**`latest` promotion NOT run — that is Andre's, always.**

**DOD-CBOR-1 → ✅. The cross-party clause is now literally satisfied**, not asserted. All three
consumers independently re-derive the 7 frozen vectors from the SHIPPED package and agree
byte-for-byte: cello-client (164/164), the **directory** (13/13,
`m10-cbor-1-cross-party-vectors.test.ts`), and the **portal** (test written; see the blocker). The
vectors are read out of `node_modules`, never a vendored copy, so a repo pinning an older
protocol-types fails LOUD instead of silently forking the hash.

**A test that cried wolf — and the lesson.** The moment the DIRECTORY ran the vectors, the
"no float64 in the preimage" check failed on a **correct** vector. The check was
`hex.match(/fb[0-9a-f]{16}/)`. But in `… 1a 696ac4fb 5820 1111…`, that `fb` is the **last byte of a
uint32's value**, not a header — the regex matched straight across the item boundary. There is no
float there. **A hex substring search does not know where CBOR items begin.** It passed in
cello-client only because none of its vectors happened to contain the byte pattern; the directory's
copy hit it immediately. **A check that can fire on correct data is worse than no check** — the next
person to see it red would have "fixed" the encoder. Replaced in all three repos with
`cbor-item-walker.ts`, which parses the framing and reads actual major types, and the assertion got
STRONGER as well as correct: the timestamp slots are now pinned as major-type-0 uints with an 8-byte
argument (`1b`), the positive form of the property.

**DOD-STORE-DIR-1 — written, NOT run.** `V46__signal_records.sql`: the notary ledger. `type` is TEXT
with **no CHECK, no enum, no type-predicated index** (the zero-bump invariant at the schema level —
a `CHECK (type IN (…))` would reject the portal's next invented type and surface three hops away as a
mint error). The KIND fields (`subject_kind`/`issuer_kind`/`status`) ARE constrained — they are
protocol-level, and adding a signal type touches none of them; that distinction is what makes
zero-bump a rule rather than an excuse for an unconstrained schema. No payload column, no PII
(INV-DIR-DUMB) — asserted by a test that greps `information_schema`. Append-and-amend: `cello_service`
gets INSERT/SELECT/UPDATE but **not DELETE** (otherwise "never notarized here" and "notarized then
quietly removed" are indistinguishable, and the record stops being evidence). Added to
`PUBLICATION_TABLES`; `OpsAgentExpectedMigrationVersion` 45→46.

> ### ✅ BLOCKER RESOLVED — it was a stopped ENGINE, not a GUI wall.
> I first recorded this as blocked: Docker Desktop's backend process was alive but the daemon never
> became ready, and `open -a Docker` did nothing. **The diagnosis was wrong.** `docker desktop status`
> reported the app *running* with the engine **`stopped`** — a state `open -a` cannot fix because the
> app is already open. **`docker desktop restart` cleared it in one command.** (The container's
> snapshot was then corrupt from the unclean stop; `docker compose down` + recreate fixed that.)
>
> **The lesson is the repo's own debugging rule, and I broke it:** *an error is not a root cause.*
> "The daemon is not ready" is where the failure surfaced. I inferred a GUI dialog from it — a
> hypothesis I never tested — and wrote it into the journal as fact, and was one step from handing
> Andre a blocker he did not have. `docker desktop status` was one command away and gave the actual
> state. **Ask the system what it thinks is true before telling a human what is wrong.**
>
> Both tests then ran, first try: **V46 → 9/9 green** against real Postgres (all prior migrations
> applied, zero checksum failures V1–V46), and the **portal's cross-party leg → 12/12**.

---

### 2026-07-14 — Entry 9: DESIGN NOTE — DOD-DIR-WRITE-1 (written before any code)

**Target behavior (one sentence).** A hash enters the directory's store ONLY via a signed submission
from a key in `authorized_issuers`; everything else is refused loudly — and that is INV-CHOKEPOINT.

**Spec anchors.** Spec §14.1 (the one write path), §14.5 (the capability format is the open piece),
§15.2.2 (the issuer set is DATA, not code). Determination §3 **fixes the shape** — this note does not
re-derive it: canonical-CBOR request body `{v:1, op, payload…, issued_at}`, Ed25519 signature over
`"CELLO-TSIG-REQ-v1" || sha256(body)`, pubkey hint, `authorized_issuers` lookup by role + status,
`issued_at` bounds-checked ±10 min as hygiene. **No nonce store** — replay is harmless *by
construction*, which is a claim the two normative rules below must actually earn.

**THE GAP THIS NOTE CLOSES.** Determination §3.2 places `authorized_issuers` **"with DOD-STORE-DIR-1's
migration"** — and V46 does not have it. That is my miss, not a spec ambiguity. It is caught before
deploy, so it costs nothing: V46 has been applied to a local Docker Postgres and **nowhere else**, so
the table is folded into V46 rather than bolted on as a V47 (a two-migration Tier 0 for one logical
change would be archaeology for the next reader, and `infra/CLAUDE.md`'s "get the schema right the
first time" rule exists precisely because a mid-milestone reactive migration forces renumbering
cascades downstream). The local DB is `flyway clean`'d and re-migrated. **The rule "never modify an
APPLIED migration" is about SHARED environments** — dev/staging/prod have never seen V46, and Flyway
would checksum-fail if they had.

**Producer/consumer chain.**
- **PRODUCER:** the portal signs a submission with its KMS-held Ed25519 key (M10-D6 — the portal
  holds no private key; `kms:Sign`).
- **CONSUMER 1 — the directory at submit:** looks the pubkey up in `authorized_issuers` (role
  `submitter`, status `active`) → verifies the signature → **RE-HASHES the envelope bytes with the
  canonical component (M10-D7/D16) and rejects a mismatch loud.** That re-hash IS the chokepoint: a
  submitter cannot hand us a hash of one thing and the bytes of another.
- **CONSUMER 2 — replication:** the row federates to the other two sovereign nodes.
- **What breaks at each hop:** an unverified signature ⇒ anyone writes any hash for anyone (today's
  bearer-key reality — investigation §4, and the key is *shared with the ops-agent*). A skipped
  re-hash ⇒ the directory notarizes a hash that does not correspond to its envelope, so "notarized
  ⇒ scanned-clean-at-birth" collapses silently.

**The seam.** `packages/directory/src/` — a new `/internal/signal/*` route group over the TLS
listener this unit adds. The directory NEVER parses `payload` and never learns a type's meaning:
`type` crosses this boundary as an opaque string and lands in a `TEXT` column with no `CHECK` (V46).

**Invariants at stake.** **INV-CHOKEPOINT** (this unit *is* the invariant — it is NET-NEW, not a
hardening: no authorized-issuer or portal-pubkey concept exists anywhere today). **INV-ZERO-BUMP** —
the handler must not branch on `type` even once, or the canary dies at the write path.
**INV-DIR-DUMB** — the directory verifies a signature and a hash; it evaluates no content.

**Replay integrity — the two normative rules that EARN "no nonce store" (determination §3.1, review
F3).** These are clauses, not suggestions, and each gets a NEGATIVE test:
1. **A duplicate-hash submit is a strict no-op that never touches the existing row — `status`
   included.** An `ON CONFLICT DO UPDATE` here would let a replayed submit resurrect a revoked
   signal. (Exactly the F2 defect the client-side store shipped and had to have removed — the same
   mistake, one tier up. Once is a bug; twice is a pattern, so it gets a test on both sides.)
2. **Supersede-marking is the transition `active → superseded` ONLY.** A replayed submit whose
   `supersedes_hash` points at a since-REVOKED row must NOT launder `revoked` into `superseded`.
- **Negative AC (owed):** capture a submit, revoke its signal, replay the capture → status stays
  `revoked`. If that test passes trivially, the replay-harmlessness claim is unearned and the nonce
  store comes back.

**The issuer set is DATA (spec §15.2.2), and the API must not assume "portal is the only issuer."**
`authorized_issuers(pubkey PK, role, status, added_at)`, replicated, seeded by migration.
`issuer_kind: agent` intake (endorsements, post-v1) must land as NEW ROWS + a role, with **no API
change** — so the handler authorizes on `(role, status)`, never on a hardcoded "is this the portal".
Building the endorsement intake now is out of scope; letting its absence rot the seam is not.

**Approach + rejected alternative.** Signed requests against a replicated key set. **REJECTED: extend
the existing `agent-write` seam** (investigation §5.3) — it carries a per-type `SIGNAL_KINDS` enum
(`agent-write-validation.ts:20`, INV-ZERO-BUMP violation at birth) and is authenticated by ONE static
bearer key, non-constant-time compared, **over plaintext HTTP on a public ALB, and shared with the
ops-agent**. Extending it would make INV-CHOKEPOINT a lie told in a nicer voice. It is REPLACED
(M10-D10), and its signal arms retire after the backfill. **REJECTED: a nonce/replay store** — real
cost (a table, a GC, a cross-node consistency question) for a property the two rules above give free,
*provided* they are tested. That proviso is the whole reason the negative AC is mandatory.

**Falsification pass.** (1) Does the call site have the method on the INTERFACE? — the directory
consumes `@cello-protocol/protocol-types@0.0.23`, whose `hashTrustSignalEnvelope` is exported from
the package root and **already proven byte-identical to the portal's** (13/13 cross-party, Entry 8).
Checked. (2) Responsibility — the re-hash belongs at the directory, not the portal: a check the
submitter performs on its own behalf is not a check. (3) Redundancy — the portal also hashes, but
that is the POINT; agreement between two independent derivations is the property. (4) What else
breaks — the TLS listener fronts the legacy `/internal/*` routes too (determination §3, review F6);
their bearer-key auth is accepted at launch but must not regress. (5) **Does `signal_records` have
everything the write path needs?** `accepting_node` and `scanner_version` are `NOT NULL` with no
default — the handler MUST supply both, or the first submit fails on a constraint. Flagged to the
reviewer.

**Decisions this note makes.** (1) `authorized_issuers` folds into **V46**, not a new V47 (never
deployed; one logical change, one migration). (2) Authorization is on `(role, status)` — never on a
hardcoded portal identity. (3) No nonce store, conditional on the two replay rules each carrying a
negative test.

**Test plan sketch.** Red-first: unsigned submit → refused; signature by an unknown key → refused;
by a `registry`-role key → refused (wrong role); by a `revoked`-status key → refused; hash≠bytes →
refused loud with the cause named, never "invalid request"; valid submit → row + `signal.submission.
accepted`; duplicate → strict no-op; **revoke-then-replay → status stays `revoked`** (the negative
AC); an UNKNOWN type submits and stores exactly like a known one (INV-TYPE-CARRY at the write path).

---

### 2026-07-14 — Entry 10: DOD-STORE-DIR-1 reviewed — the reviewer disproved ME, and found worse

**The review overturned my own diagnosis, and that is the entry's point.** I had convinced myself a
self-referencing FK on `superseded_by` would halt logical replication on out-of-order arrival, and I
**wrote it into V46's comments as established fact**. It is false. Measured:

```
SET session_replication_role = replica;     -- what the apply worker actually runs as
INSERT … (dangling FK target)  ->  INSERT 0 1        ACCEPTED
RESET session_replication_role;
INSERT … (dangling FK target)  ->  ERROR: violates foreign key constraint
```

The apply worker runs as `replica`, in which the internal RI triggers do not fire — **Postgres does
not enforce FKs on the subscriber.** My landmine was a hypothesis I never tested, dressed in a comment
block as a fact. That is precisely the failure this repo's debugging discipline names ("narrating a
hypothesis as fact is the default failure mode") — and I committed it *while fixing a different
instance of it*. Two hours after writing "an error is not a root cause" in the journal.

**But PK/UNIQUE *IS* enforced on the subscriber — and that is a real, catastrophic bug (F1).**

```
SET session_replication_role = replica;
INSERT … (duplicate hash)  ->  ERROR: duplicate key value violates unique constraint
```

`signal_records` was content-addressed with `signal_hash` as a **lone PRIMARY KEY**. Two nodes that
independently insert the same hash each replicate an INSERT the other cannot apply → the apply worker
errors, retries forever → **THE ENTIRE SUBSCRIPTION STOPS. All 20 published tables.** Seals, profiles,
presence, registrations stop federating too.

And it rides the **designed** path: the portal reaches the directory through an ordered failover list
(M10-D11). Submit H to us-east-1 → the row lands → **the response is lost** → the portal dutifully
fails over and re-submits to eu-central-1, which hasn't received H yet and inserts its own row. Both
replicate. **Federation is down because a request timed out.**

**M10-D20 — PK is `(signal_hash, accepting_node)`.** Two nodes may each notarize a signal; their rows
cannot collide, so no INSERT is ever unapplicable. Safe *because* the record is content-addressed:
every hashed field derives from the envelope, so rows sharing a hash necessarily agree on all of them
— they differ only in provenance. Reads dedupe through `signal_records_effective`.

**Corollary — a replicated UPDATE can be SILENTLY LOST (F3).** Reaching a node before the row it
targets, the apply worker skips it: no error, no retry. That node serves a dead signal as live
forever, which breaks the DoD's own "status changes replicate" clause. The publication fixes the
*transport* of a status change; it cannot conjure the row to change. So both transitions are now
also expressible as INSERTs — supersession rides the new record's own hashed `supersedes_hash`; a
revoke at a node lacking the row writes a **tombstone**. `revoked` from any copy wins, so it
converges. Precedence: revoked > superseded > active.

**Other findings fixed:** `authorized_issuers` was **missing entirely** from V46 (F2 — determination
§3.2 places it here); it now ships, SELECT-only for `cello_service` (the write path is checked
*against* this set and must never be able to add to it) and **seeded EMPTY** (a placeholder key would
look configured while authorizing nobody — an empty set refuses everything, which is the correct
failure). The DIR-DUMB test was a **denylist** of nine column names and was hollow — `envelope_bytes`,
`body`, `plaintext`, `raw` all passed it; it is now an exact **allowlist** of the column set (F6).
`issuer_kind` admitted 2 of the 3 values spec §3 names (F8) — narrowing a protocol enumeration to
what launch happens to use is the same class of mistake zero-bump exists to prevent. `updated_at` had
no producer and would have lied about when a row last changed (F9) — deleted. The header claimed the
table could answer "not expired" when it holds no `expires_at` and must not (F10).

**Two findings became DIR-WRITE-1 clauses** (not notes — they would evaporate): the 0-row status write
must fail loud with its cause named, and `scanner_version` must travel *inside* the signed body or it
is forgeable (the directory cannot see the payload, so it can never re-run the scan — the value is the
submitter's assertion, and a forged one is a lie stored as evidence).

**16/16 green** (was 9). The new tests cover what had **no coverage at all**: two nodes notarizing the
same hash without colliding, the read deduping them to one signal, the convergent revocation tombstone,
derived supersession with no UPDATE, revoked-beats-superseded, and a revoked replacement superseding
nothing.

**Still owed before ✅ (deploy-time, F4):** the replication clause is **inert** until
`./infra/setup-replication.sh` is re-run per environment. Editing `PUBLICATION_TABLES` changes nothing
in a live database — and nothing detects the omission: no error, no alarm, and all 16 tests still pass,
because they run against ONE local Postgres with no replication at all. The DoD's second clause is
therefore *untested by construction*. Verify per node with `pg_publication_tables`.

---

### 2026-07-14 — Entry 11: DOD-REVOKE-1 reviewed — a tombstone SQUATTED the real notarization's PK

**Built:** `revokeSignal` sharing the chokepoint's `verifySignedRequest` (role-based `submitter`
auth), `POST /internal/signal/revoke`, and the `is_tombstone` refinement to V46 (Entry 11's V46 amend
is local-only — dev/staging/prod never saw it). 8 tests green first pass.

**The review found a HIGH one I walked past, and two sharing its root.**

**F1 (HIGH) — the tombstone squatted the real notarization's PK and dropped it.** The tombstone was
INSERTed at `(signal_hash, thisNode)` — the exact PK a real record uses. So a real submit arriving
AFTER a revoke at the same node hit submit's `ON CONFLICT (signal_hash, accepting_node) DO NOTHING`
and was **silently dropped, logged as a "benign duplicate."** A notarization lost at the chokepoint
whose whole promise is "notarized ⇒ we hold the record." Verified against Postgres: after a tombstone
at `(H, us-east-1)`, the real submit for H left only the placeholder — `subject='alice-REAL'` gone.
Reachable by a legitimate revoke-before-submit ordering, and by an attacker pre-revoking H at every
node so the real signal is born dead with its provenance erased.

**F3 (TOCTOU) + F4 (replicated-UPDATE skip)** shared the root: the design had TWO revocation
mechanisms — UPDATE the real row, or insert a tombstone — that collided (F1), raced (F3), and didn't
replicate robustly (F4, since a replicated UPDATE reaching a lagging node before its row is skipped).

**The fix is one decision: revocation is ALWAYS a tombstone INSERT, never an UPDATE, at a distinct PK
`(signal_hash, 'revoke:' || node)`.** It cannot collide with a real record, it is a single race-free
INSERT, and an INSERT replicates robustly where an UPDATE is skipped. The real row's `status` stays
`active`; correctness lives in `signal_records_effective` (`BOOL_OR(status='revoked')`), which nothing
bypasses. F5 (the old `WHERE status='active'` missing a superseded signal) dissolved — the tombstone
filters on nothing. Two coverage gaps filled: the F1 revoke-then-submit (real notarization survives),
and revoke-of-superseded.

**The pattern across tonight's reviews, again:** I reasoned about the tombstone's PK and did not notice
it was the SAME namespace as a real record. The reviewer's F1 is the third time a reviewer caught
something I had convinced myself was fine (float64, the FK-replication claim, now this). Each was a
place I asserted a property without testing it against the actual store. The fix is cheap; the habit —
verify the claim against Postgres, not against my model of Postgres — is the point.

**F6 (LOW → Post-v1):** the blind tombstone hardcodes `issuer_kind='portal'` and authorizes on role
`submitter` regardless of the target's real `issuer_kind`. Harmless today (filtered from reads,
agent-issued is post-v1) but a `submitter` key must not be able to tombstone an agent-issued signal
once those exist — logged in Post-v1.

**Also settled (self-caught before the report):** F2 — `submitSignal` had kept its OWN inlined auth
after I extracted `verifySignedRequest`; both write paths now run the one helper, so the "cannot drift"
guarantee is real, not aspirational (`342b2c7e`).

62/62 across all five M10 directory test files.

### 2026-07-14 — Entry 12: DESIGN NOTE — DOD-REGISTRY-1 (written before any code)

**Target behavior (one sentence).** A client, offline from the portal, learns a type's class /
lifecycle / default-TTL / display-label by fetching ONE portal-signed document the directory serves as
opaque bytes — and a type ABSENT from it is valid-but-unclassified, never rejected.

**Spec anchors.** Spec §15.2.5 (the registry becomes served data, amends §14.8's shipped-code
registry), §14.8. Determination §3.4 fixes the transport: `op: registry-publish` (signed, role
`registry`) stores the doc; public `GET /registry` serves it as opaque bytes exactly like
`GET /manifest`. Decisions: **M10-D9** (a DEDICATED registry KMS key — not officers, not the submission
key; clients pin its pubkey at build time), **review F7** (INV-CANONICAL is scoped to the ENVELOPE; the
registry is NOT content-addressed and deliberately follows the MANIFEST's canonical-JSON convention so
the client reuses the one shipped, proven verifier rather than growing a second signed-JSON-vs-CBOR
path).

**The reuse that defines this unit.** `core/crypto/src/manifest.ts` already has `canonicalManifestBody`
(recursive key-sort, no whitespace, all fields except `signatures`) + Ed25519 verification + monotonic
`version` + `not_before`/`expires`. The registry document is the SAME shape with a different body, and
the client poller is the SAME shape as `http-manifest-poll.ts` (verify against the pinned pubkey,
anti-rollback, every failure leaves the cache UNTOUCHED). Building REGISTRY-1 is largely *parameterizing
the manifest machinery for a second document*, not inventing a distribution path.

**Producer/consumer chain.**
- PRODUCER: the portal composes `{ version, not_before?, expires?, types: { <type> → {class, status:
  active|deprecated|retired, default_ttl_days, label} } }`, canonicalizes it, signs with the dedicated
  registry KMS key, and submits via `op: registry-publish`.
- CONSUMER 1 — the directory at publish: `verifySignedRequest(..., "registry")` (the SAME chokepoint
  helper, role `registry`), then stores the doc as OPAQUE BYTES. **The directory does NOT verify the
  INNER registry signature** — clients do. It refuses `version <` stored (anti-rollback as hygiene).
- CONSUMER 2 — the directory at `GET /registry`: serves the stored bytes verbatim, no interpretation
  (INV-DIR-DUMB — same as `GET /manifest`).
- CONSUMER 3 — the client: fetches, verifies the inner signature against the BUILD-TIME-PINNED registry
  pubkey, checks anti-rollback + `expires`, caches with TTL. An absent type ⇒ valid-but-unclassified
  (INV-TYPE-CARRY). Every verification failure leaves the last-good cache in place — a bad registry
  never blanks classification.

**The seam.** trustless-cello: a `registry_documents` store (or a single-row table — the doc is a
singleton, latest-version-wins) + the `registry-publish` op in `signal-write.ts` (it already
role-parameterizes auth) + the public `GET /registry` route. cello-client: a registry poller mirroring
`http-manifest-poll.ts`, exposing "class/label/ttl for a type string, or unclassified." **The directory
never parses the registry body; the client never treats an absent type as invalid.**

**Invariants at stake.** INV-DIR-DUMB — the directory serves bytes, verifies only the OUTER
role-`registry` submission signature, never the inner document. INV-TYPE-CARRY — absent type is
first-class, not an error; this is the whole reason the registry is DATA not code. INV-ZERO-BUMP — a
registry update requires NO release anywhere: the portal publishes a new version and clients pick it up
on their next poll. **INV-CANONICAL is deliberately NOT extended here** (F7) — the registry is
canonical-JSON, not CBOR; state that in the unit so its reviewer does not trip on it.

**Approach + rejected alternative.** Reuse the manifest's canonical-JSON + Ed25519 + monotonic-version
machinery for a second signed document. REJECTED: making the registry a content-addressed CBOR envelope
like a trust signal — it is not a hashed, four-party-agreed object; it is a singleton the portal owns
and rotates, and forcing it through the envelope's cross-party hash discipline would grow a second
canonical path (F7's exact concern) for no benefit. REJECTED: the directory verifying the inner
signature — that would make the directory interpret the document (INV-DIR-DUMB) and duplicate a check
the client must do anyway against its own pinned key.

**Falsification pass.** (1) Does the manifest verifier take a caller-supplied signing key, or is it
hardcoded to officer keys? — VERIFY at unit start (`canonicalManifestBody` is generic, but the verify
wrapper may assume officer thresholds; the registry is a SINGLE dedicated key, not a T-of-N officer
set, so the signature-check shape differs and must be checked, not assumed). (2) Does `registry-publish`
fit `verifySignedRequest` as-is? — it needs role `registry` (already a parameter) and NO envelope
re-hash (it is not an envelope), so it is a DIFFERENT body path than submit — confirm the helper's auth
half is cleanly separable from submit's envelope half (it is — the helper stops at signature; the
envelope work is submit-only). (3) Anti-rollback: is `version` compared as a number or a string? — a
string compare makes `10 < 9` — pin it as an integer. (4) What breaks if the registry is EMPTY / never
published? — every type is unclassified, which is exactly INV-TYPE-CARRY's benign default; the client
must not hard-fail on a missing registry.

**Decisions this note makes.** (1) Registry doc = manifest-shaped canonical JSON, dedicated registry
KMS key, build-time pinned client pubkey (graduates M10-D9's mechanics). (2) The directory stores +
serves opaque bytes and verifies only the OUTER submission signature, never the inner doc. (3)
`registry-publish` reuses `verifySignedRequest(role=registry)` with no envelope re-hash. (4) Registry is
canonical-JSON, INV-CANONICAL (CBOR/envelope) explicitly does NOT apply.

**Test plan sketch.** Directory: publish with a registry-role key stores the bytes; a submitter-role
key is refused (wrong role); `version <` stored is refused (anti-rollback); `GET /registry` returns the
exact stored bytes; an unsigned/forged publish is refused. Client: a valid doc verifies against the
pinned pubkey and classifies a known type; an absent type returns unclassified (not an error); a
rollback / bad-signature / expired doc leaves the last-good cache untouched; an EMPTY/never-published
registry yields all-unclassified without error. Enforcer: the live journey later carries a registry
entry for phone/email through to the LLM's framing.

### 2026-07-14 — Entry 13: DOD-REGISTRY-1 directory half — built + reviewed, no blocking findings

**Built.** `publishRegistry` + `getRegistryDocument` in `signal-write.ts`, `registry_documents`
singleton folded into V46, `POST /internal/signal/registry-publish` (signed, role `registry`) + public
`GET /registry` (opaque bytes). The directory verifies only the OUTER role-`registry` submission
signature and serves the document as bytes it never parses (INV-DIR-DUMB); the CLIENT verifies the
inner signature against its pinned key and is the authoritative anti-rollback gate.

**Reused, not reinvented.** Falsification at unit start confirmed `verifyManifest` is a T-of-N
officer-threshold verifier — wrong shape for the registry's single dedicated key — so REGISTRY reuses
`canonicalManifestBody` (the canonical-JSON convention) + a plain single-key verify, and the transport
reuses the chokepoint's `verifySignedRequest(role=registry)`. Per STORE-DIR F7, INV-CANONICAL (the
four-party envelope hash) deliberately does NOT apply — the registry is canonical-JSON, not
content-addressed CBOR.

**Review: clean, no blocking.** Role separation airtight (a submitter key cannot publish; DB CHECK on
the role enum), public GET safe (no DoS surface, 404-when-absent leaks nothing), bytea round-trip
clean, no per-type construct. Three non-blocking fixes:
- **F1 — the code contradicted its own comments on the anti-rollback line.** `WHERE ... >=` stored an
  equal version, but two comments said equal-version was a no-op. `>=` permits a same-version republish
  with DIFFERENT bytes — the version stops uniquely identifying content, and a cached-v5 client
  disagrees with a fresh-v5 client. Resolved to strictly-greater `>` (a content change MUST bump the
  version; identical re-publish is an idempotent no-op), comments made to match. The test now
  exercises the equal-version case — previously a `>=`↔`>` flip passed all tests silently.
- **F2 — version precision.** BIGINT column, `Number.isInteger` validation, `Number()` readback — a
  value past 2^53 could land/serve as N±1, corrupting the anti-rollback ordering. Bounded at
  MAX_SAFE_INTEGER, consistent with the envelope's integer discipline. Not reachable with a realistic
  counter, but one line.
- **Test quality:** the "adding a type requires no release" test was decorative (proved only what the
  round-trip test already did); rewritten to pin the observable half with an honest comment that no
  round-trip test can prove the ABSENCE of a type branch. The "missing document" branch got a real test.

Verified `ON CONFLICT DO UPDATE ... WHERE <false>` returns rowCount 0 without erroring against real
Postgres, so the `stored` signal is sound. 11/11 green.

**This closes the DIRECTORY-SIDE Tier 0/1 write/read surface** — CBOR-1, both stores, DIR-WRITE-1,
REVOKE-1, REGISTRY-1 dir half, all built and reviewed. What remains is a different character: portal
(MINT-INTERNAL-1), client (registry poller + envelope delivery), and the batched Tier 1 DEPLOY (V46 +
routes + TLS listener + KMS keys + issuer enrollment) that the live journeys need.

### 2026-07-14 — Entry 14: DESIGN NOTE — DOD-MINT-INTERNAL-1 (written before any code; the tier's keystone)

**Target behavior (one sentence).** For a real account, the portal composes phone and email as
account-subject trust-signal envelopes, hashes them (CBOR-1), submits them through the chokepoint
(DIR-WRITE-1), and they are delivered to the holder daemon — with the M8 scaffold retired in the same
commit.

**Spec anchors.** Spec §14.10 (the backfill), §3.2 / M10-D5 (account-subject), §14.11 (content-
addressed, daemon-portable). Determination §3.3 arm (c) (verified-account-facts read), §5 (the M8
delivery pipe is the running prior art — correct it, don't reinvent). Decisions: **M10-D5**
(account-subject, agent-add a no-op), **M10-D13** (late-added agent = re-mint with supersession),
**M10-D18** (the M8 drop + `SIGNAL_KINDS` retirement land HERE), **M10-D14** (wallet rows carry no
agent association).

**THIS UNIT SPANS THREE REPOS.** Stated up front (PROCEDURE §2a):
- **cello-portal** — the mint itself: read the verified fact, compose the self-describing envelope,
  hash, sign the submission, submit. Re-point `handoff.ts` (the M8 producer) onto real CBOR envelopes.
- **trustless-cello** — the **verified-account-facts read** the mint depends on (determination §3.3
  arm (c)): `op: query` returning phone-verified presence + `phone_stub_hash`, email-verified presence
  + stub — **presence booleans and stubs only, never recoverable PII**. AND the M8 retirement: drop the
  `trust_signals` scaffold table, retire `SIGNAL_KINDS` (`agent-write-validation.ts:20`) + the
  `trust_signal_hash`/`trust_signal_ciphertext` arms, re-point `j-trust.spine.test.ts`.
- **cello-client** — generic delivery: verify hash ∈ directory → insert into `wallet_trust_signals`
  (the type-agnostic client half). Re-point the M8 delivery arm (`inbound-sessions.ts:601`, the
  `agent_id = null` defect) onto the new store.

**Source-of-fact — the load-bearing constraint (investigation §2).** The portal holds NO phone data;
the verified fact lives in the directory's `user_accounts.phone_stub_hash`. Email exists portal-side
only as envelope ciphertext. So the mint is a **directory READ of an already-verified fact, not a
re-verification** — the portal asks the directory "is this account's phone verified, and what is its
stub?" and composes an envelope asserting exactly that. The envelope's payload carries the STUB /
DOMAIN, never the number or address (no PII beyond what the signal IS — email carries domain, not
address). This is why arm (c) must exist first: without it the mint has nothing authoritative to
attest.

**Producer/consumer chain.**
- The verified-account-facts READ (new): PRODUCER = directory (`user_accounts`), CONSUMER = portal
  mint. What breaks if wrong: the portal attests a fact the directory cannot corroborate → the
  signal is a lie the notary co-signs.
- The MINT: PRODUCER = portal, CONSUMER = DIR-WRITE-1 (re-hash chokepoint) → `signal_records` →
  replication → holder delivery.
- DELIVERY: PRODUCER = the corrected M8 pipe (directory pickup-queue push, seal, ACK), CONSUMER =
  client generic insert into `wallet_trust_signals`.

**The seam + THE RETIREMENT (M10-D18, the coverage-window rule).** The M8 scaffold stays alive until
THIS unit re-points its producer AND consumer in the SAME commit: `handoff.ts` stops double-writing
`trust_signal_hash`/`trust_signal_ciphertext` via `agent-write` and starts submitting real envelopes
via DIR-WRITE-1; `inbound-sessions.ts:601` stops writing the M8 `trust_signals` table with
`agent_id = null` and starts inserting `wallet_trust_signals`. Only THEN: drop the M8 table, retire
`SIGNAL_KINDS` + the signal arms, re-point `j-trust.spine.test.ts`. A test asserts the scaffold table
and `SIGNAL_KINDS` are GONE (the forcing function STORE-CLIENT-1's test could not be — review F7).

**Account-subject + late-added agent (M10-D5 / M10-D13).** Phone/email mint ONCE per account as
`subject_kind: account`, presentable by every agent under the account — agent-add on an existing
daemon is ZERO signal work (M10-D14: the wallet row is daemon-level, no per-agent copy). An agent
added on a NEW daemon gets the account-subject envelopes by **re-mint with supersession** (M10-D13):
the portal re-mints (new `issued_at`, `supersedes_hash` = the prior), because the directory holds
hash-only and the portal keeps no envelope plaintext to re-seal. Journey coverage: the three
DOD-T1-JOURNEY-1 cases (late-added agent, failover, custody).

**Invariants at stake.** INV-CHOKEPOINT (mint goes through DIR-WRITE-1, no side door). INV-ZERO-BUMP
(phone/email are just type strings; the mint's per-type knowledge — what a phone claim SAYS — lives
ONLY in the portal, never in client or directory). No-PII (payload carries stub/domain, never
number/address — the §3 guardrail in payload clothing). INV-AGENT-SCOPED (delivery inserts a wallet
row, which is daemon-level and correct).

**Approach + rejected alternative.** The portal signs submissions with its KMS key (M10-D6; a
file-signer stub behind the same interface for local dev). REJECTED: minting from portal-held phone
data — the portal HAS none, by design (no-PII); the fact must come from the directory read. REJECTED:
building the full `op: query` surface here — only arm (c) (verified-account-facts) is MINT-INTERNAL's
dependency; arms (a)/(b) (record lookup, Class-3 aggregates) belong to their own units. Build the
minimal arm (c).

**Falsification pass.** (1) Does arm (c) exist? — NO (determination fixed its shape, not its code);
MINT-INTERNAL builds it. (2) Does the portal have a signing interface? — NO real KMS wiring yet; the
mint needs a `Signer` abstraction (KMS in prod, file stub in dev) — build it, matching M10-D6. (3)
Does the M8 delivery pipe actually still run? — YES (`handoff.ts` + `inbound-sessions.ts:601` are
live), so re-pointing must preserve delivery, not just add a path. (4) What breaks on drop? — the
spine test + the M8 producer/consumer; all three re-pointed in one commit or the gate is red across
units.

**Decisions this note makes (graduating to DoD Decisions as needed).** (1) MINT-INTERNAL builds the
minimal verified-account-facts read (arm c), presence+stubs only. (2) A portal `Signer` abstraction
(KMS prod / file dev) is introduced here, enrolled into `authorized_issuers`. (3) The M8 retirement is
one commit re-pointing producer + consumer + spine test, then dropping table + enum + arms.

**Test plan sketch.** Directory: arm (c) returns presence+stub for a verified account, refuses/omits
for unverified, never returns recoverable PII. Portal: mint composes an envelope whose hash the
directory re-hash accepts (CBOR-1 cross-party already proven); payload carries stub/domain not
number/address; a submission is signed and accepted. Client: a delivered envelope is verified
(hash ∈ directory) and inserted into `wallet_trust_signals`. Retirement: the M8 table + `SIGNAL_KINDS`
are GONE; the spine test passes re-pointed. **Enforcer = DOD-T1-JOURNEY-1** (live, real processes):
this unit is 🟡 until that journey runs.

### 2026-07-15 — Entry 15: portal MINT + Signer built + reviewed — the PII guardrail had no teeth

**Built (cello-portal `1d804cf`, fixed `8261123`).** `mint.ts` (composePhone/composeEmail →
account-subject envelopes, buildSubmission binds the signer key then hashes then signs) +
`submission-signer.ts` (Ed25519 Signer interface; local seed-signer; staging/prod fail closed —
M10-D6). 15 tests. The submission body was cross-checked field-for-field against the directory's
`parseRequest` and the TBS domain — it is directory-acceptable, and the cross-party vectors already
prove the hash agrees byte-for-byte.

**The review clustered on the PII guardrail — exactly the danger zone — and was right.**
- **HIGH-1: the no-PII guarantee was enforced by CALLER TRUST, not code.** `composeEmail` interpolated
  `email.domain` into a field AND the claim string with zero validation. `{ domain: "alice@evil.com" }`
  → the full address CBOR-encoded, hashed, signed, and **notarized permanently** (the directory treats
  payload as opaque bytes, so nothing downstream catches it). The notary co-signs the operator's email.
- **HIGH-2: `domain` had no producer.** Arm c — the mint's own cited source — returns `{verified,
  stub}`, no domain. So `domain` was always undefined in production (every email silently composed as
  the weaker "has verified email" — a weaker guarantee indistinguishable from the stronger one), and
  two same-named `AccountFacts` types silently disagreed across the boundary.
- **The PII test was HOLLOW.** It fed CLEAN input and asserted clean output — it would have passed even
  if the code embedded a full address. "clean in → clean out" is trivially true; the guardrail is
  "dirty in → refused," which it never exercised.

**Fixed (M10-D21):** dropped `domain` entirely (email = stub only, matching arm c), and made
`composePhone`/`composeEmail` REFUSE any stub that is not a 64-hex SHA-256 — so a raw number/address
can never reach the payload, enforced by code. The hollow test is replaced with one that feeds a raw
phone number, a raw email, and malformed stubs and asserts refusal.

**MEDIUM-3 (fixed):** the signer returned the checked-in dev seed for BOTH `local` and `dev` — but
`dev` is a deployed, network-reachable env, so anyone with the source could forge submissions against
it. Now only `local` uses the checked-in default; `dev` requires an explicit `PORTAL_SUBMISSION_SEED`
and fails closed without one.

**The recurring pattern, fourth time:** a guardrail that reads as protective but tests only the benign
path. Same shape as the float64 "no floating point" block, the seconds/ms expiry test, and the registry
equal-version case — each LOOKED like coverage and had no teeth against the actual threat. The
generalizable check, now habitual: does the test feed the DANGEROUS input, or only the safe one?

**Deferred (journaled so not lost):** LOW-5 — the fact-change → revoke path (so a stale phone/email
signal does not live forever, since internal facts never expire on a timer) rides with the wider
revoke wiring; LOW-6 — `issued_at` is fixed at compose time, fine in the synchronous
compose→build→submit path, a caveat only if composition is ever cached.

**MINT-INTERNAL-1 remaining (deploy-coupled):** wire the mint into the portal DirectoryClient (needs a
running directory); client generic delivery into `wallet_trust_signals` + re-point
`inbound-sessions.ts:601`; the M8 retirement (one commit); the prod KMS signer (needs a created KMS
key); enforcer = DOD-T1-JOURNEY-1 live.

### 2026-07-15 — Entry 16: mint ORCHESTRATION built + reviewed — the portal→directory half is PROVEN

**Built (cello-portal, `14b861a` + review `966da95`).** `directory-submit.ts`: `postSignedSubmission`,
`fetchAccountFacts`, and `mintAccountSignals` (the orchestration: read arm-c facts → compose → sign →
submit through the chokepoint). A transport distinct from `HttpDirectoryClient` — the signal routes are
signature-authed with CBOR bodies, not API-key JSON. **This closes the portal→directory HALF of the T1
journey, proven end-to-end LOCALLY** against a server that runs the directory's own re-hash check, so
the submissions are genuinely chokepoint-acceptable.

**Review: no blocking findings, and the reviewer independently cross-checked the wire contract**
byte-for-byte — the query request shape, the `CELLO-TSIG-REQ-v1` TBS domain, the header names, and the
outage/unknown/unverified/rejection error trichotomy all match the directory's parsers. Three
non-blocking fixes:
- **MEDIUM — the auth path had ZERO test teeth.** The stub ignored the signature and re-hashed only the
  envelope, so the entire request-signature construction (domain, headers, `signBody`) was unasserted —
  a wrong-domain or missing-signature regression would have passed all tests, caught by NEITHER side's
  unit tests (the directory uses its own TBS builder), only by the live journey. The stub now runs the
  directory's actual Ed25519 signature check and a test proves a wrong-key submission is refused. **Same
  pattern as every other review this session: a test that looked like it covered the path but never fed
  the failing input.**
- **LOW-1 — partial mint.** Phone-succeeds-then-email-throws discarded the phone success. Now per-type
  failures are collected (`failed[]`) not thrown, so the caller retries only what failed; a whole-mint
  retry is safe (duplicate submit is a directory no-op). Only a facts-read failure (directory down
  before anything composes) throws.
- **LOW-2 — an overstated zero-bump comment** ("adding a type is a compose fn + registry entry and
  NOTHING else") — `mintAccountSignals` also carries a hardcoded type list. Corrected to name that loop
  as the third portal-side edit site (still nothing in directory or client).

**Known property (deferred, journaled):** a retry after partial failure re-composes with a fresh
`issued_at` → a new hash → a SECOND phone signal, not a supersession — because the mint does not query
existing signals. Bounded and forgivable for v1 (two "has verified phone" signals coexist; untidy, not
incorrect); the proper fix is supersede-on-re-mint, which needs the signal-lookup read, a later unit.

**WHERE THE MILESTONE STANDS — the isolated + locally-provable surface is COMPLETE.** Tonight built and
reviewed across three repos: the canonical envelope (CBOR-1 ✅ cross-party, published), both client
stores, the full directory write/read surface (submit / revoke / registry / account-facts), and the
portal mint (compose → sign → orchestrate → the directory notarizes). ~135 tests, one npm cascade, 11
review passes. **The core value — portal reads verified facts → composes → the directory notarizes —
works end to end locally.**

**THE REMAINING PHASE IS DEPLOY-COUPLED / ALL-OR-NOTHING, and is a clean handoff boundary:**
- **The M8 retirement** (holder delivery into `wallet_trust_signals` + re-point `inbound-sessions.ts:601`
  + wire `handoff.ts` onto `mintAccountSignals` + drop the M8 `trust_signals` table + retire
  `SIGNAL_KINDS` — ONE commit, M10-D18). All-or-nothing across three repos; its live proof is the
  delivery pipe. Wants a fresh, fully-testable run — starting without finishing leaves the pipe broken.
- **The directory deploy** — the image is verified deploy-ready (build green, V46 additive, existing
  routes pass), BUT it has a MANDATORY relay cascade (STATE.md) not yet understood, on shared dev the
  demo agent uses. Andre says "deploy" → it runs (then SSM bump, replication re-run, cascade, enroll
  the dev signer pubkey, STATE.md).
- **The prod KMS signer** (needs a created KMS key — infra) and the **`latest` promotion** (Andre's).
- **Held deliberately:** the Tier 0 cascade stays on beta (it ships the daemon FK-enforcement change;
  no user benefit until the feature is live); registry client poller + consume path are ahead of their
  Tier-2 consumers (NO CONSUMER NO SHIP).

### 2026-07-15 — Entry 17: Tier 0/1 directory DEPLOY triggered; client delivery built; dev-signer identity

**DEPLOY IN FLIGHT.** Pushed 28 commits (main → `2a65a615`); the `cello-directory-pipeline` is
building. This ships the whole Tier 0/1 directory surface to dev: **V46** (signal_records +
authorized_issuers + registry_documents + the effective view — the directory applies Flyway on boot,
so the migration auto-applies) and the `/internal/signal/{submit,revoke,query}` + `/internal/signal/
registry-publish` + public `GET /registry` routes. Verified deploy-ready first: build green, V46 is
pure additive DDL (safe on dev's V45 DB), existing agent-write route tests pass, lockfile pins 0.0.23.
Corrected my own over-caution — this is an authorized, locally-proven, batched dev deploy; the
"shared dev might break" hesitation was a production-mindset brake (alpha, no users, recoverable). The
relay cascade (mandatory post-directory-redeploy per STATE.md) is understood — stop-task the relays so
they re-register — and is in the deploy watchdog (cron `c561ce55`), along with the SSM bump to 46,
the replication re-run for the new PUBLICATION_TABLES, and the STATE.md update.

**Built during the window (laptop-testable, deploy-independent): `deliverWalletSignal`** — the holder's
own chokepoint. A delivered envelope's hash is RE-DERIVED with the shared protocol-types and a mismatch
is REFUSED before storing in `wallet_trust_signals`; idempotent. 32/32 daemon store tests. Its consumer
is the M8 retirement's re-point of `inbound-sessions.ts:601`.

**A real constraint surfaced:** the `/internal/signal/*` routes are INTERNAL-ONLY (the ALB rejects
`/internal/*`), so the live mint→notarize proof is NOT laptop-reachable — it runs from the DEPLOYED
PORTAL, inside the network. The directory deploy is the prerequisite; the full live journey needs the
portal deployed with the mint + the dev signer enrolled + the M8 delivery routing.

**DEV SIGNER IDENTITY (for the eventual portal live test — do not lose):** the portal's dev submission
signer uses seed `de`×32; its Ed25519 pubkey is
`8d4abe074fef9229d3b441dfea4f98f805b1a2b3a06ae645810efece77fd5044`. **Post-deploy enrollment** (once
V46's `authorized_issuers` exists in dev):
`INSERT INTO authorized_issuers (pubkey, role, status, label) VALUES
('8d4abe074fef9229d3b441dfea4f98f805b1a2b3a06ae645810efece77fd5044','submitter','active','dev-portal-mint');`
and the deployed portal sets `PORTAL_SUBMISSION_SEED=de…de` (dev requires it explicitly — no
checked-in fallback). Harmless to enroll now (an unused authorized issuer); it makes the directory
ready for the portal.

### 2026-07-15 — Entry 18: Tier 0/1 directory deploy COMPLETE + verified — and a silent-success bug in the replication script

**The deploy is fully live in dev, every post-step done by hand and verified** (I took manual ownership
and DELETED the deploy watchdog cron `c561ce55` — a watchdog you're actively driving is just a second
cook). Ground truth, all confirmed via ECS exec on the running directory tasks:
- **DB at V46**, all three M10 tables present (`signal_records`, `authorized_issuers`,
  `registry_documents`) + the `signal_records_effective` view.
- **`/internal/signal/*` routes live**; **ops-agent SSM `expected-migration-version` = 46**; **dev
  signer enrolled** (`8d4abe07…fd5044`, role `submitter`).
- **Relay cascade done** — all 3 relays restarted + re-registered with the final directory tasks,
  `recordAssignment` restored; **all 3 S3 manifests re-signed FRESH** with the new relay IPs.

**The load-bearing finding — cross-region replication was SILENTLY not happening, and the script said
it was.** STORE-DIR review F4 demanded the new tables replicate across the 3 sovereign nodes (the
redundancy invariant: a signal notarized at one node must be visible at the others). I added
`signal_records,authorized_issuers` to `PUBLICATION_TABLES` and ran `setup-replication.sh` — **it
exited 0**. But a smoke test (INSERT on us-east-1, read on eu-central-1) came back EMPTY, and
`pg_subscription_rel` on eu-central-1 had **neither table**. The publication on the source had them;
the subscriptions never picked them up.

- **Producer/consumer trace.** The producer of a subscriber's table set is `ALTER SUBSCRIPTION …
  REFRESH PUBLICATION` (Step 4b, run as `postgres` — the subscription owner; my ad-hoc `cello_service`
  and the stale `rds-admin-credentials` secret both can't, which is a side-quest, not the cause). The
  consumer is `pg_subscription_rel`. The producer never produced.
- **Root cause: "no error string ⇒ success" over a flaky transport.** Step 4b captures the ECS-exec
  output and only fails on a matched `ERROR:` line. `aws ecs execute-command` intermittently returns an
  **empty** session (the "Cannot perform start session: EOF" flakiness) — no `ERROR:`, so the script
  logs "Refreshed" and moves on **without the REFRESH ever executing**. Green script, inert replication.
- **Fix + proof.** A clean re-run actually executed all 6 REFRESHes. Now `pg_subscription_rel` carries
  both tables in state `r` (ready) for every subscription; a FRESH row INSERTed on us-east-1 lands on
  eu-central-1 in ~8s, and a DELETE on the source replicates too. Test rows cleaned up (0 `repl-smoke%`
  on both nodes). **F4 closed — signals genuinely replicate.**
- **HARDENING owed (logged in STATE.md, not blocking):** Step 4b must POSITIVELY assert the target
  tables are in `pg_subscription_rel` after each REFRESH, not infer success from the absence of an error
  string. This is the same defect class the debugging discipline warns about — an error label is not a
  root cause, and here the *absence* of a label was mistaken for success.
- **`registry_documents` deliberately left un-replicated** — singleton served-doc, no consumer path
  yet (NO-CONSUMER-NO-SHIP); add to `PUBLICATION_TABLES` when the Tier-2 registry poller lands.

**Net:** the entire Tier 0/1 directory surface is live across all 3 regions, session-init restored, and
cross-node replication proven. Next Tier-1 code unit: the **M8 retirement (M10-D18)** — re-point the
portal handoff onto `mintAccountSignals`, re-point `inbound-sessions.ts` onto `deliverWalletSignal`,
drop the M8 `trust_signals` table, retire the directory `SIGNAL_KINDS` arms — one atomic cross-repo
commit whose test asserts the old table is GONE.

### 2026-07-15 — Entry 19: DESIGN NOTE — DOD-MINT-INTERNAL-1's M8 RETIREMENT half (M10-D18), written against the code

The keystone that wires the M10 delivery into the live daemon. Largest unit in the milestone (3 repos,
2 directory tables, a redeploy, a publish cascade), so it gets a grounded design note before code — and
this time grounded in the ACTUAL pipe, not recall (the Entry-4 lesson). Reading all sides collapsed a fork
I thought I had (M10-D22) and surfaced the real shape.

**The M8 pipe, end to end (read, not remembered):**
- **Portal producer — `cello-portal/src/server/trust/handoff.ts::handTrustSignal`.** Canonical-JSON the
  record → **raw** `hash()` → `signalHash`. Then FAN OUT over `directory.listAgents(accountId)`: for each
  agent with an `agentId` + `kLocalPubkey`, `sealToRecipient(k_local, jsonBytes)` and write TWO agent-write
  arms — `trust_signal_hash` (the anchor) and `trust_signal_ciphertext` (the sealed delivery). Account-level:
  every agent the operator owns gets its own sealed copy. Best-effort; re-mintable (D1).
- **Directory validation — `agent-write-validation.ts`.** `SIGNAL_KINDS = {"webauthn"}`; the two arms
  `trust_signal_hash` / `trust_signal_ciphertext` are validated here. **Both retire** (+ the enum).
- **Directory writes — `agent-write-repository.ts`.** `trust_signal_hash` → `identity_tree_entries
  (agent_id, signal_kind, signal_hash)` (the anchor, replicated). `trust_signal_ciphertext` →
  `pickup_queue (agent_id, signal_kind, ciphertext, owning_node_id)` (node-local, NOT in `cello_pub`;
  partial-unique `idx_pickup_queue_one_pending_per_kind` = one pending per (agent, kind)).
- **Directory drain — `pickup-repository.ts::drainPickupForAgent`.** LEFT JOINs `pickup_queue` ⋈
  `identity_tree_entries` on `(agent_id, signal_kind)` to pair each ciphertext with its `signal_hash`,
  pushes `{id, signal_kind, ciphertext, signal_hash}` to the daemon, DELETEs the row on ACK.
- **Daemon consumer — `cello-client` `inbound-sessions.ts:548-624` (`handleTrustSignalPickup`).** Opens
  the seal with `k_local` → recovers plaintext → **raw** `cryptoHash(recovered)` == `signal_hash`? →
  `store.storeTrustSignal({signalHash, agentId: null, signalKind, payload})` (the M8 `trust_signals` table,
  the `agent_id = null` defect) → ACKs so the directory deletes the pickup.

**The finding that decided the delivery model (M10-D22): the pull-from-notary shortcut is IMPOSSIBLE.**
I briefly thought replication (just fixed) let the daemon PULL its account's envelopes from any node and
skip the whole sealed-pickup transport. But V46 is explicit and TESTED: `signal_records` stores **no
envelope plaintext, no payload, no PII** — only the hash + derived index fields. The directory is a dumb
hash-notary; it does not have the envelope to serve. The full envelope lives ONLY with the holder. So
delivery MUST carry the envelope out-of-band, portal → daemon. **The M8 sealed-pickup transport is
REQUIRED, not incidental.** Fork dissolved.

**The M10 target — KEEP the transport, re-point its endpoints (nothing about the notary contract changes):**
1. **Portal `handoff.ts`** → compose an M10 **CBOR envelope** (`webauthn` type, account-subject, DOD-CBOR-1),
   `hashTrustSignalEnvelope` (NOT raw hash), notarize ONCE via the **chokepoint** (`/internal/signal/submit`,
   signed → `signal_records`), then seal the **envelope** per agent and queue it for delivery via a dedicated
   signed **deliver** step. 1 notarize : N deliveries (asymmetric — hence deliver is its own step, not folded
   into submit; a received counterparty signal is notarized but never self-delivered).
2. **Directory** — retire `SIGNAL_KINDS` + both agent-write arms; the pickup row now carries the
   `signal_hash` itself (drain stops JOINing `identity_tree_entries`); a signed deliver path populates
   `pickup_queue`. Migration: **drop nothing directory-side that STORE-CLIENT-1 needs** — the M8 table being
   dropped is the DAEMON's `trust_signals` (client SQLite), not a directory table.
3. **Daemon `inbound-sessions.ts`** — pickup handler decodes the CBOR envelope and calls
   `deliverWalletSignal(envelope, claimedHash=signal_hash)` (re-derives the DOD-CBOR-1 hash, stores in
   `wallet_trust_signals`); DELETE `storeTrustSignal` + **drop the `trust_signals` table** from the daemon
   schema. The raw-`cryptoHash` check at line 594 goes (M10 hash is domain-tagged CBOR, not a raw sha256) —
   `deliverWalletSignal` owns the verification.
4. **`trustless-cello/packages/e2e-tests/src/spine/j-trust.spine.test.ts`** — re-point onto the new pipe;
   its SUBJECT (portal→directory→daemon delivery) stays alive and keeps coverage.

**Forcing-function test (the DoD's own clause):** MINT-INTERNAL-1's test asserts the daemon `trust_signals`
table is GONE — STORE-CLIENT-1's guard only catches a *premature* drop and would stay green forever if this
were forgotten (review F7).

**Atomicity + coverage-window (M10-D18):** the drop of the daemon table and the re-point of its only writer
(`inbound-sessions.ts:601`) land in ONE commit per repo, coordinated — the writer must not survive the table,
nor the table the writer. The directory arm-retirement lands with the portal re-point (the arm's only caller),
same coverage-window logic. Ordering to avoid a broken live pipe mid-migration: ship the directory deliver
path FIRST (additive, deploy), THEN the portal+daemon cutover, THEN retire the old arms.

**Cost of record:** a directory redeploy (~25-30 min, 3 regions) + a `protocol-types`/`daemon`/`connect`
publish cascade (`/cello-publish`). This is the SECONDARY "signals for few" layer, not the launch-critical
"pipes for all" core — but it is in M10 scope (it is what makes minted phone/email actually reach a holder),
so it ships. Next: the directory deliver path, red-first.

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
