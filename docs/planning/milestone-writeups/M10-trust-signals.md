---
name: M10 — Trust Signals
type: milestone-writeup
date: 2026-07-10
updated: 2026-07-12
milestone: M10
status: active
description: >
  M10 delivers the generic trust-signal machinery: canonical CBOR envelopes, dumb directory 
  notarization, self-describing payloads, and zero-bump extensibility.
---

# M10 — Trust Signals

**Started:** 2026-07-10 · **Status:** Active, architecture determined.

M10 shifts CELLO from raw connection mechanics to evaluated trust. Instead of hardcoding signal types, M10 builds a generic pipeline where new signals can be introduced purely via portal changes (zero-bump extensibility). 

## Core Architecture
- **The Dumb Directory:** The directory evaluates no content, schema, or signatures at presentation. It performs only two mechanical checks: does the hash match the blob, and is the hash in the directory's record for this subject?
- **Generic Envelope:** A content-addressed envelope holding opaque payloads. The signal *type* is data, not schema.
- **Canonical CBOR:** All payloads are deterministically serialized and hashed as CBOR (RFC 8949) before submission, ensuring byte-for-byte agreement across the portal, directory, holder, and recipient. JSON is used only for display projection.
- **Scan-before-hash:** A chokepoint ensures that all signals are scanned deterministically before entering the directory.
- **Zero-bump Extensibility:** Adding a new signal type requires *only* portal work (verification logic + type string + self-describing payload claim). Client and directory binaries do not require releases.
- **Supersede, Never Mutate:** Renewals or updates create a new content-addressed envelope that supersedes the prior hash.

## Current Progress
- `DOD-PORTAL-ARCH-1` is ✅ COMPLETE. The portal will hold no private keys; it will use AWS KMS for Ed25519 signing. The Class-3 track record job will run as an in-process scheduler.
- The `DOD-CBOR-1` component design is finalized and will live in `@cello-protocol/crypto`.
- The v1 scope fence restricts initial signals to phone, email, track record (session count/clean-close rate), and GitHub (OAuth/browser extraction), concluding with the falsifiable zero-bump canary.
