# ADR-0002: ML-DSA-44 as the post-quantum signature level

**Status:** Accepted  
**Date:** 2026-05-03

## Decision

CELLO uses ML-DSA-44 (FIPS 204, CRYSTALS-Dilithium) for all non-threshold post-quantum signatures: endorsements, attestations, directory certificates, pseudonym bindings, and connection package items. These artifacts first appear in M3.

## Context

The implementation roadmap flagged ML-DSA security level as an open decision that must resolve before M3 stories are written. Two options: ML-DSA-44 (128-bit post-quantum security, connection package ~18 KB) or ML-DSA-65 (192-bit, ~23 KB).

## Rationale

- 128-bit post-quantum is the accepted standard for new designs. ML-DSA-65 is "more conservative," not "recommended" by NIST for general purpose use.
- The 5 KB size difference (18 KB vs 23 KB) is per connection package — a one-time exchange, not per-message overhead. It is unlikely to be the deciding factor.
- Ecosystem convention is settling on ML-DSA-44. NIST's own guidance places ML-DSA-44 as the default for general purpose; -65 is for use cases with heightened sensitivity. Agent identity negotiation does not meet that bar.
- Quantum threat timeline is 10+ years to a cryptographically relevant quantum computer. Threshold ML-DSA (which replaces FROST for threshold signatures) is expected in 5-7 years. The threat will be addressed by the FROST → threshold ML-DSA transition before ML-DSA-44's 128-bit level is threatened.

## Alternatives considered

**ML-DSA-65 (192-bit):** More conservative, but no specific CELLO threat model justifies the additional 5 KB per connection package. Would add unnecessary overhead for no actionable security gain given the quantum timeline.

## Consequences

- Connection package items (pseudonym binding, attestations, endorsements) signed with ML-DSA-44 via `liboqs` / `node-oqs`.
- M3 stories specify ML-DSA-44 as the concrete parameter set.
- If a future threat model change or ecosystem shift warrants ML-DSA-65, the signature algorithm is parameterized behind the `liboqs` API — upgrading is a configuration change, not an architecture change.
