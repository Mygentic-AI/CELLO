---
name: m8-totp-floor-stepup-inversion-remediation
type: discussion
date: 2026-06-28
topics: [m8, authentication, totp, webauthn, step-up, spec-inversion, remediation, revocation, threat-model]
status: open-pending-alignment
description: >
  AUTHORITATIVE pick-up record (compaction-safe) for the M8 step-up spec inversion discovered 2026-06-28.
  M8 step-up was built WebAuthn-only, contradicting journey-01 D6 (TOTP is the required recoverable FLOOR;
  WebAuthn is a convenience LAYER). This blocks TOTP-only operators from EVERY sensitive action and blocks
  the F1 onboarding happy-path. Captures: the mistake + how found, the revocation-forgery threat model, the
  CORRECTED signed-revocation design (TOTP can't sign → two-layer portal+passkey), both audits' findings,
  the DoD corrections made, the remediation plan (NOT yet started), and the open decisions for Andre.
  NOTHING here is implemented yet — alignment first.
---

# M8 — TOTP-floor step-up inversion: remediation record

> STATUS: exploration complete, **implementation NOT started** (2 premature string edits were reverted).
> Aligning on approach with Andre before any code changes. This doc is the durable pick-up point.

## 1. The mistake (root cause)

M8's **step-up** (the fresh re-auth required for a sensitive action) was built **WebAuthn-only**:
- the only step-up route is `webauthn/stepup`; `webauthn-client.ts:stepUp()` runs only the WebAuthn ceremony;
- the route/UI guidance hard-codes "verify a passkey".

This **contradicts the spec.** journey-01 **D6**: *"The required 2FA is the recoverable factor: TOTP.
WebAuthn/Face ID is a layer on [top]… TOTP is the floor."* Rejected-alternatives: *"Face ID / WebAuthn as a
substitute for 2FA — Rejected — a convenience layer… not an equal alternative."* Step-up is *"against an
existing strong factor."* journey-01 principle: **"no mechanism is ever the only door."** `hasStrongFactor`
correctly = passkey OR confirmed TOTP. So TOTP is first-class (and likely the majority factor); the build
made the convenience layer mandatory.

**Impact:** a TOTP-only operator (no passkey) cannot, through the product:
- suspend / resume / burn an agent (suspend route → 403 step_up_required, no TOTP path);
- enroll a second factor; remove a factor;
- **complete the F1 onboarding happy-path** (enroll TOTP → try to add WebAuthn → step-up required →
  `startStepUp` finds zero WebAuthn creds → throws `no_credential` → blocked);
- re-enroll/recover TOTP (enroll gates on the WebAuthn-only `isStepUpFresh`).
NOT a hard lockout in theory (`/totp/verify` on an existing session calls `markStrongAuth` → stamps
`last_step_up_at`, so the GATE is factor-agnostic) — but **no UI offers a TOTP step-up**, so in practice the
operator is dead-ended.

## 2. How it slipped through (the process failure + the lesson)

AUTH-002 (WebAuthn) built step-up first → the **DoD copied the implementation's wording** ("a fresh WebAuthn
step-up" in DOD-AUTH-2, DOD-LEVER-4) → tests exercised only the WebAuthn path (or the no-factor grace) →
every review, **including the cello-done-auditor run earlier today**, anchored to tests + DoD, which agreed
with each other. **Internal consistency (test ↔ DoD) cannot catch a SHARED wrong assumption.** Nobody read
journey-01 D6 against the step-up code. LESSON (saved to memory `feedback_anchor_reviews_to_journey_spec`):
anchor ≥1 review to the SOURCE journey/spec; a DoD line's wording must come from the spec, not the code.

## 3. How we found it (don't lose this thread)

We were designing **signed revocation** (so a compromised directory node can't forge a burn). The proposed
fix was "sign the burn with the operator's WebAuthn passkey assertion." Andre caught the flaw: *we don't
mandate WebAuthn, we mandate 2FA and suggest WebAuthn — see the M8 records.* That triggered the audit that
found the step-up inversion. The signed-revocation thread and the step-up inversion are linked: both come
from treating WebAuthn as universal.

## 4. Revocation-forgery threat model (the signed-revocation thread)

- A burn/suspend is a row in `agent_suspensions` (directory state, in `cello_pub`, replicated). Each node's
  FROST honor-check refuses the agent's key-share if the row says paused/burned. **The relay is NOT in this
  path.**
- FRONT DOOR (legit path) is guarded: portal → `/internal/agent-write` seam = API-key auth + account-scoping
  (re-proves `agent_profiles.account_id` → cross-account 403 `not_owner`) + step-up.
- BACK DOOR (a compromised DIRECTORY node) is OPEN: a node has direct DB access → can `INSERT` an
  `agent_suspensions` row directly, skipping the seam → it replicates → every node's honor-check trusts it
  with **no cryptographic check that the owner authorized it.** So one rogue node can forge a burn — and if
  one, then all → targeted or mass **DoS** (kill switch). Blast radius is DoS only (can't forge the agent's
  signatures, read its data, or make it act). Requires compromising a directory node.

## 5. CORRECTED signed-revocation design (supersedes the passkey-only version in [[signed-revocation-passkey-assertion]])

The original proposal (passkey assertion, verified node-side) only protects WebAuthn users. **TOTP cannot
sign**: it's a symmetric shared secret the portal holds + a 6-digit presence code (not a payload-bound
signature); a verifier needs the secret, and whoever has the secret can forge → it can't defend against a
compromised verifier. So a passkey-only design leaves the spec's FLOOR factor (TOTP) unprotected.

**Two-layer design that covers everyone:**
- **Layer 1 — the PORTAL signs every burn (covers ALL users, passkey + TOTP).** After the portal does the
  2FA (whatever method), the portal signs the burn order; directory nodes verify the portal's signature
  before honoring. A rogue DIRECTORY node can't forge the portal's signature → no forged burns for anyone.
  **TRADE-OFF / OPEN QUESTION:** this trusts the portal over a single directory node. Sound IFF the portal is
  operator-controlled/self-hosted; if the portal is a CENTRALIZED hosted service it reintroduces a central
  trust anchor (tension with the anti-centralized-compromise value). → **Need Andre's read on the portal
  deployment model (centralized hosted / per-operator self-hosted / both).**
- **Layer 2 — WebAuthn users ALSO attach a passkey assertion** → additionally defeats a rogue PORTAL. TOTP
  users can't reach this (inherent). So: TOTP users protected vs a rogue directory; passkey users protected
  vs a rogue directory AND a rogue portal.
- Rejected: a new per-account Ed25519 key (invents key lifecycle/recovery; if server-held it's forgeable);
  node-only threshold attestation as the PRIMARY (proves "applied," not "owner-authorized" — useful only as
  complementary non-repudiation).
- Scope: burns are must-sign (permanent); suspends are reversible (nice-to-sign).
- **M8 DECISION (reversible, recorded):** ACCEPT authorized-but-unsigned revocation; DOD-LEVER-2 stays 🟡 by
  decision; build the two-layer signed revocation as **M10**. The security property that matters (a burned
  agent can never sign) already holds + is proven; signing adds tamper-proof attribution.

## 6. Audit findings

### 6a. WebAuthn-assumption sweep (the bug class) — 9 fixes, 2 blocking + 7 cosmetic
- BLOCKING 1: `src/lib/webauthn-client.ts:27` `stepUp()` is WebAuthn-only → no TOTP step-up in the UI.
- BLOCKING 2: `src/components/TotpPanel.tsx:15` `onStart()` swallows 403 `step_up_required` as a generic
  error → a passkey user can't add the TOTP floor.
- COSMETIC (misleading "passkey" guidance — should be "passkey or authenticator app"):
  `app/api/agents/suspend/route.ts:56`; `app/api/auth/webauthn/register/options/route.ts:35`;
  `.../register/verify/route.ts:39`; `.../credentials/remove/route.ts:31`; `.../stepup/options/route.ts:25`;
  `components/SuspendLever.tsx:57`.
- ORDERING: `app/(app)/account/page.tsx:49-50` renders WebAuthnPanel before TotpPanel; D6 → TOTP first.

### 6b. Spec-conformance re-audit (find OTHER inversions) — essentially the SAME root, more blast sites
- The step-up inversion ALSO blocks F1 onboarding (the catch-22 above) and TOTP re-enroll/recovery
  (`totp/enroll/start` + `enroll/verify` gate on the WebAuthn-only `isStepUpFresh`).
- VERIFIED SPEC-FAITHFUL (trustworthy — NOT broken): magic-link bootstrap (D3); presence tracking edge-
  triggered + node-liveness (J02 D4-D5); revocation-flag write + honor-check (J02 D10); TOTP + backup codes
  (D7); strong-auth 7-day grace + admin waiver (D5); magic-link routes to email not Telegram in the ongoing
  loop (D4). So the inversion is ONE root cause with several blast sites; the rest of M8 audited faithful.

## 7. DoD corrections already made (committed to main)
- DOD-SPINE-3 ✅→🟡 (served agents-appear journey is `test.skip`-gated on DIRECTORY_API_URL — separate
  done-auditor finding; standing proof is the close gate). READ-1/2 notes corrected. AGENT-1 caveat added.
- DOD-AUTH-2 ✅→🟡 and DOD-LEVER-4 ✅→🟡 (step-up inversion; step-up half only — owner-only + burn-never-
  erases remain proven).
- DOD-LEVER-2 stays 🟡 by decision (signed-event → M10).
- Honest proven-live count after corrections: ~29/41 (~71%).

## 8. Remediation plan (NOT started — pending alignment)
ONE coherent unit, red-first, §8-reviewed (do NOT dribble piecemeal):
1. ROOT FIX — first-class **factor-aware step-up**: the gate is already factor-agnostic and `/totp/verify`
   already stamps `last_step_up_at`. Add a step-up UI that offers the operator's ACTUAL factor(s) (passkey
   ceremony → `/webauthn/stepup`, OR TOTP code → `/totp/verify`), and a TOTP step-up the `startStepUp`
   path can use when there are no WebAuthn creds. Wire into SuspendLever, WebAuthnPanel, TotpPanel, and the
   F1 onboarding enroll flow. (Server components already know the factors — pass {hasPasskey, hasTotp}.)
2. The 7 cosmetic strings + Account TOTP-first ordering.
3. RED-FIRST proof with a **TOTP-only account**: complete onboarding F1, suspend/burn, and factor-removal —
   all via TOTP step-up. Then restore DOD-AUTH-2 / DOD-LEVER-4 ✅ and add the missing TOTP-only AC coverage.
4. §8 review (code-reviewer + test-attacker) anchored to journey-01 D6, not just the tests.

## 9. OPEN DECISIONS for Andre (gate the work)
- (a) Approach sign-off on the factor-aware step-up fix (§8 plan above).
- (b) Portal deployment model (centralized hosted vs per-operator self-hosted) — gates the M10
  signed-revocation Layer 1 design; not needed to start the step-up fix.
- (c) Still-pending from before: #1 stand up the live cluster, #2 npm publish — both await "go".
- (d) Today was meant to be launch; it is now remediation. Launch can't proceed on a board whose ✅ just
  proved fallible — the step-up fix + the spec re-audit (done) are the trust-restoring work.

## 10. Lesson (saved to memory)
[[feedback_anchor_reviews_to_journey_spec]] — review against the source spec, not only tests+DoD.
