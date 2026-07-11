---
name: M10 Type Playbook — Adding a Trust Signal Type
type: procedure
date: 2026-07-11
milestone: M10
status: open
topics: [m10, trust-signals, playbook, zero-bump, new-type, portal-only]
description: >
  The per-type runbook. Once M10 v1 lands, adding a trust signal type is a PORTAL-ONLY change —
  this checklist, run end-to-end, is the whole job. A playbook run is recorded as one
  BUILD-JOURNAL entry, not a story. First exercised (and corrected against reality) by
  DOD-EXT-SIGNAL-1; kept current forever after — if a run reveals a missing step, fix the
  playbook in the same commit.
---

# M10 Type Playbook — Adding a Trust Signal Type

> **The zero-bump contract:** if any step below requires touching cello-client or
> trustless-cello, STOP — that is not a playbook run, it is a bug in the generic machinery
> (INV-ZERO-BUMP violation). File it in the current milestone's journal and fix the machinery,
> not the type.

## 0. Decide the type
- [ ] Type string (lowercase, stable forever — it is in the hash preimage), class (per
      [[M10-TRUST-SIGNAL-TAXONOMY]]), `schema_version: 1`.
- [ ] What is the underlying FACT, and how does the portal verify it end-to-end? (OAuth flow,
      directory-data aggregate, document check, …) This is the real per-type work.
- [ ] Validity window: `expires_at` policy (who re-verifies at expiry, and how).
- [ ] Launch-triage check: does this type serve the current intent, or is it scope creep?

## 1. Portal: verification code
- [ ] Implement the fact-verification (the only genuinely type-specific code in the system).
- [ ] External providers: proof-of-ownership (OAuth) is synchronous; extraction/audit is async
      two-step; extraction runs on the hardened browser-extraction instance, never in the
      portal process ([[M10-DEFINITION-OF-DONE]] DOD-EXTRACT-DESIGN-1 rules).
- [ ] Tests red-first; portal gates green (`pnpm test` → `lint` → `typecheck` → `build`).

## 2. Portal: compose the payload (self-describing — spec §15.2.4)
- [ ] Structured fields (what policy/LLMs may someday reason over) + a plain-language `claim`
      composed BY THE PORTAL stating what was verified, how, and when.
- [ ] No PII beyond what the signal is (email → domain only; the directory stores only the
      hash regardless, but the payload travels to recipients).
- [ ] Scan (deterministic suite) BEFORE hashing. On fail: reject, never "clean and continue."

## 3. Mint + notarize (all generic — you are only CALLING things here)
- [ ] Envelope via the canonical-CBOR component (subject, issuer_kind, issuer_pubkey, type,
      schema_version, payload, issued_at, expires_at, supersedes_hash if renewing).
- [ ] Signed submission to the directory write API; confirm `signal.submission.accepted` and
      replication to all nodes.
- [ ] Deliver the plaintext envelope to the holder (generic delivery path).

## 4. Registry entry (data, not code)
- [ ] Add the type to the portal-signed registry document: class, lifecycle `active`, default
      TTL, display label. Publish the new registry version. NO release anywhere.

## 5. Prove it live (the enforcer — same bar as the milestone's journeys)
- [ ] Live journey: mint for a real agent → holder holds → present at a real introduction →
      recipient verifies (fresh, hash ∈ directory) → LLM consumes with correct `issuer_kind`
      framing.
- [ ] Negative case: a tampered blob fails the recipient's re-hash; a floor policy naming the
      new type gates an agent that lacks it.
- [ ] Confirm zero-bump held: `git status --porcelain` clean in cello-client AND
      trustless-cello for the entire run.

## 6. Record
- [ ] One BUILD-JOURNAL entry: type, class, verification method, payload v1 fields, registry
      version, live-journey evidence, anything the playbook got wrong (fix it in this commit).
- [ ] Supersession/revocation notes if the type has special renewal semantics (most don't —
      the mechanism is generic).

---

## Related Documents

- [[M10-PROCEDURE]] — the milestone runbook this playbook outlives
- [[M10-DEFINITION-OF-DONE]] — DOD-EXT-SIGNAL-1 is the playbook's first full exercise
- [[M10-TRUST-SIGNAL-STORAGE-AND-CREATION]] — spec-of-record: envelope §3-5, creation §6, zero-bump §15
- [[M10-TRUST-SIGNAL-TAXONOMY]] — the type catalog and class definitions
