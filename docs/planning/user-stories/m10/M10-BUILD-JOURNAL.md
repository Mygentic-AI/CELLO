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
- **Milestone status:** started. **DOD-PORTAL-ARCH-1 half 1 (investigation) is DONE** →
  [[M10-PORTAL-ARCH-INVESTIGATION]] (Entry 2). **Next: half 2 — the architecture determination**
  (a separate design doc under `user-stories/m10/`, written AGAINST the investigation, then
  reviewed). Then DOD-CBOR-1, whose design note is already written (Entry 1, the worked example).
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

## Related Documents

- [[M10-PORTAL-ARCH-INVESTIGATION]] — DOD-PORTAL-ARCH-1 half 1: what the portal/directory/client
  actually are today (evidence, `path:line`). Read before any M10 design or code.
- [[M10-PROCEDURE]] — the runbook
- [[M10-DEFINITION-OF-DONE]] — the yardstick + sole status authority
- [[M10-TYPE-PLAYBOOK]] — the per-type runbook
- [[M10-TRUST-SIGNAL-STORAGE-AND-CREATION]] — spec-of-record (HOW)
- [[M10-TRUST-SIGNAL-TAXONOMY]] — spec-of-record (WHAT)
