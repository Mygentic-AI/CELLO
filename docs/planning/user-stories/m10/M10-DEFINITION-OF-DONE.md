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
  content evaluation, no signature logic at presentation, no schema knowledge. — ❌
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
- **DOD-INV-STATELESS-RECIPIENT** — the default recipient flow works with zero cached signal
  data; any cache is freshness-re-checked, never source of truth. — ❌

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
    interface; how the portal signs (submission key + registry key custody — where a private key
    can safely live in this deployment shape); the submission client; the registry publisher;
    the Class-3 background job's home (in-portal vs separate worker process); how envelopes are
    delivered to the holder daemon; what the trust-signals UI scaffold needs to become real.
    Recorded as an **architecture section appended to this DoD's spec-of-record set** (a design
    doc under `user-stories/m10/`, wikilinked here), reviewed by `cello-unit-reviewer` like any
    unit, and its decisions logged in the Decisions section below. Downstream DoD lines that the
    architecture reshapes are edited THEN, not discovered mid-build. — ❌
- **DOD-CBOR-1** — a shared canonical-envelope component (serialize, hash, verify) usable from
  portal, directory, and client. Clauses: deterministic map ordering + defined number encoding
  per spec §5; the hash preimage is exactly spec §4's mandatory-disclosure set (subject,
  issuer_kind, issuer_pubkey, type, schema_version, payload, issued_at, expires_at,
  supersedes_hash — status/class/verified_at OUT); the **cross-party hash test** (all three
  consumers agree byte-for-byte on fixed vectors + property-based random envelopes) runs in CI.
  Where the component lives (published package vs per-repo vendored spec-with-vectors) is
  decided by DOD-PORTAL-ARCH-1's architecture. Design note: journal Entry 1 (the worked
  example). — ❌
- **DOD-STORE-CLIENT-1** — holder-side `trust_signals` table per spec §3 (envelope columns,
  opaque payload BLOB, status mutable outside the hash) + recipient-side optional cache FK'd to
  the per-agent contact row. SQLCipher, keyed on `agent_id`. Migration idempotent; fresh schema
  == migrated schema. — ❌
- **DOD-STORE-DIR-1** — directory `signal_records` table (`signal_hash` PK, subject,
  issuer_pubkey, issuer_kind, type-as-opaque-string, status, superseded_by, revoked_at,
  accepting_node, scanner_version) + replication of records AND status changes over the existing
  replication path (spec §14.1). Flyway migration + `OpsAgentExpectedMigrationVersion` bump. — ❌

## Tier 1 — The write path + internal signals (phone, email)

- **DOD-DIR-WRITE-1** — the directory's ONE write API: signed submission of (envelope-CBOR,
  hash) from an authorized issuer key. Clauses: re-hash and reject mismatch; verify submitter
  signature against the authorized-issuer set (portal keys — but the set is DATA, not a
  hardcoded "portal only": `issuer_kind: agent` intake must be addable post-v1 without an API
  change); reject unauthorized loud (`signal.submission.rejected` + reason); insert at one node,
  federate by replication; idempotent on duplicate hash. Design note first (PROCEDURE §6:
  submission signature + key custody). — ❌
- **DOD-REVOKE-1** — revocation = re-auth through the same chokepoint (spec §14.2): issuer
  revokes own signals (`connecting_pubkey == issuer_pubkey`), portal revokes portal-issued;
  status change replicates; the subject cannot revoke (selective disclosure is their lever);
  expiry is automatic via `expires_at`, not a write. — ❌
- **DOD-REGISTRY-1** — the type registry as served signed data (spec §15.2.5, amended §14.8):
  a portal-signed document (type → class, lifecycle, default TTL, display label) the directory
  serves as opaque bytes; client fetches + caches with TTL; absent type =
  valid-but-unclassified (INV-TYPE-CARRY); registry update requires NO release anywhere.
  Design note first (format + signing key). — ❌
- **DOD-MINT-INTERNAL-1** — the portal mints **phone** and **email** as real envelopes (the
  §14.10 backfill): self-describing payload (plain-language claim + structured fields; email
  carries domain, not address — no PII beyond what the signal IS), hashed via DOD-CBOR-1,
  submitted via DOD-DIR-WRITE-1, delivered to the holder (generic delivery: verify
  hash ∈ directory → insert envelope row; the client half is type-agnostic). Registry entries
  for both types. Existing registered agents get them on next portal touch; new registrations
  mint at verify time. — ❌
- **DOD-T1-JOURNEY-1** — **live journey, first half:** for a real agent, portal mints phone +
  email → directory notarizes (visible in `signal_records`, replicated to all 3 nodes) → holder
  daemon holds both envelopes and re-verifies their hashes locally. Real portal process, real
  dev directory, real daemon. — ❌

## Tier 2 — Presentation + consumption (the generic client pipeline) — closes with the canary

- **DOD-PRESENT-1** — the holder presents selected signals as `{hash, blob}` pairs during the
  brokered introduction (selective disclosure: all, some, none — an explicit per-contact/
  per-tier choice surface, default sensible); the directory runs its two dumb checks in the
  moment and forwards or strips with a named event; nothing persists directory-side. — ❌
- **DOD-VERIFY-1** — the recipient re-hashes each presented blob, checks directory membership +
  status (fresh, not revoked/superseded), records `verified_at`. Freshness policy per spec
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
  portal computes, the directory only serves data it already holds). Design note first: exactly
  which aggregates (session/seal counts, clean-close attestations) are exposed, authenticated
  how; no content, no PII, aggregate-only. — ❌
- **DOD-TRACK-1** — a portal background job computes one or two track-record signals
  (**session count** and **clean-close rate** — per taxonomy Class 3) and mints them through
  the SAME write path as Tier 1 (nothing directory-issued; INV-CHOKEPOINT unchanged).
  Self-describing payloads; registry entries. Decide-at-build (Decisions entry): persist
  client-side like other signals vs mint-on-request (spec §0.2 open item). — ❌
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

## Parked
*(Genuine undecidable forks: journal + here. Never silently dropped.)*

- *(none yet)*

## Post-v1 — explicitly deferred, tracked so nothing falls between milestones
- **Endorsement intake (Endorsement Mother)** — the `issuer_kind: agent` creation path: intake
  role, deterministic scanner (versioned, byte-identical), submitter-accountability flags,
  delivery to subject. Portal-routed at launch per spec §7 amendment; per-node is the
  decentralization target. The write API ships seam-ready for it (DOD-DIR-WRITE-1 clause).
- **PSI** — construction unchosen (spec §11); both applications (mutual-contact,
  endorser-overlap) post-v1.
- **Connection bonds / staking / fees (Class 4)** — needs the commerce layer.
- **LinkedIn, X, Facebook, Instagram** — playbook runs; LinkedIn first.
- **SIM-age enrichment; device attestation (native app)** — per taxonomy.
- **Recipient re-scan of endorsements** (spec §0.1) — decide when endorsements land.
- **Review-prompt on revocation of a tier-earning signal** (spec §9) — needs the address-book
  review-prompt surface; design with the rename-notice pattern.
- **Registry governance decentralization; T-of-N scan attestation** (spec §14.1) —
  strengthenings, not migrations.

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
