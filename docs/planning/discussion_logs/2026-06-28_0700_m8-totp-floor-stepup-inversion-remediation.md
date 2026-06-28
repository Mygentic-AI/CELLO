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

> STATUS (2026-06-28, gate LIFTED by Andre's kickoff): **STEP 1 DONE** (stories corrected — commits
> 5a44469d, 4ce5f041). **STEP 2 in progress** (factor-aware step-up + cliff predicate split). The audit
> EXPANDED the scope: a second inversion (Violation B — the cliff requires the TOTP floor, a passkey must
> NOT lift it) on top of the step-up inversion (Violation A). See §6c + §8. This doc is the durable pick-up.

## 1. The mistake (root cause = the STORY, not the procedure/review)

The root cause is the **story** `CELLO-M8-AUTH-002.yaml` — the contract implementation derives from. The
journeys are Andre's hand-reviewed golden source; the procedure is correct; the plan was: write the stories
FAITHFULLY from the journeys, then implement from the stories (stories = golden truth, no need to re-check
journeys downstream). **The story-writer broke that translation.** AUTH-002 even CITES the floor (line 31:
*"WebAuthn is the convenience layer on top of the recoverable TOTP floor (Journey 01 D6)"*) — then its ACs
spec the opposite: line 9 *"sensitive operations require a fresh **WebAuthn** step-up"*, AC line 50 *"a fresh
**WebAuthn** step-up challenge is required"*, AC line 81 *"refused until a FRESH **WebAuthn** step-up"*, and
AC-SI line 96 *"step-up against the existing **passkey**"*. So the story acknowledged TOTP-as-floor in a
comment and then wrote WebAuthn-only acceptance criteria. Everything downstream — the DoD wording, the
tests, and the implementation — faithfully implemented the WRONG STORY. (Likely also wrong: LEVER-001's
step-up wording and possibly the outline; **auditing the rest of the M8 stories + outline vs the journeys is
step 1 of the fix** — see §8.)

The journey is unambiguous. journey-01 **D6**: *"The required 2FA is the recoverable factor: TOTP. WebAuthn/
Face ID is a layer on [top]… TOTP is the floor."* Rejected-alternatives: *"Face ID / WebAuthn as a substitute
for 2FA — Rejected."* Step-up is *"against an existing strong factor."* Principle: *"no mechanism is ever the
only door."* `hasStrongFactor` correctly = passkey OR confirmed TOTP. The story made the convenience layer
mandatory anyway. The code then matched the story:
- the only step-up route is `webauthn/stepup`; `webauthn-client.ts:stepUp()` runs only the WebAuthn ceremony;
- the route/UI guidance hard-codes "verify a passkey".

**Impact:** a TOTP-only operator (no passkey) cannot, through the product:
- suspend / resume / burn an agent (suspend route → 403 step_up_required, no TOTP path);
- enroll a second factor; remove a factor;
- **complete the F1 onboarding happy-path** (enroll TOTP → try to add WebAuthn → step-up required →
  `startStepUp` finds zero WebAuthn creds → throws `no_credential` → blocked);
- re-enroll/recover TOTP (enroll gates on the WebAuthn-only `isStepUpFresh`).
NOT a hard lockout in theory (`/totp/verify` on an existing session calls `markStrongAuth` → stamps
`last_step_up_at`, so the GATE is factor-agnostic) — but **no UI offers a TOTP step-up**, so in practice the
operator is dead-ended.

## 2. Where it failed (story authoring) and where it did NOT (procedure/reviews)

It failed at exactly ONE place: **journey → story translation** (the cello-story step). AUTH-002's ACs
contradicted the D6 it cited. Everything after that worked AS DESIGNED — the DoD, the live tests, and the
implementation correctly traced the STORY (the contract). The procedure is correct and the downstream
reviews did their job (verify code against the story/DoD); they are NOT supposed to re-derive from the
journeys — the story is meant to BE the journey-faithful contract. So the fix is NOT to make reviewers read
journeys; it is to (a) correct the wrong stories against the journeys, and (b) guard the story-authoring
step so a story can never cite a journey decision and then write ACs that contradict it. LESSON (memory
`feedback_anchor_reviews_to_journey_spec`, to be re-framed): the guard belongs at story WRITING — every AC
must carry the cited journey decision; a story that names D6 but writes WebAuthn-only ACs is the failure.

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
  (D7); magic-link routes to email not Telegram in the ongoing loop (D4).

### 6c. STORY→JOURNEY audit (2026-06-28, Explore subagent) — found a BROADER second inversion (Violation B)
The dedicated journey→story fidelity audit found the inversion is WIDER than step-up. Root: the stories
AND the code treat **WebAuthn as an equivalent SUBSTITUTE for TOTP**, which journey-01 D6 explicitly
rejects ("Face ID / WebAuthn as a substitute for 2FA — Rejected"). Two DISTINCT journey concepts were
collapsed onto ONE predicate `hasStrongFactor` (= passkey OR confirmed TOTP), used for BOTH purposes:

- **Violation A — step-up** (the original finding). Step-up must be satisfiable by ANY strong factor
  (passkey OR TOTP). `hasStrongFactor` for the step-up GATE is CORRECT; only the step-up ROUTE/UI was
  WebAuthn-only. FIX = factor-aware step-up (STEP 2). Stories AUTH-002/AUTH-006 corrected.
- **Violation B — the 7-day cliff / strong-auth REQUIREMENT** (NEW). `strong-auth-wall.ts:16` lifts the
  cliff on `hasStrongFactor`, so a **passkey-only account clears the cliff** — the exact device-loss
  lockout D6 exists to prevent. Per D6 the cliff is the RECOVERABLE FLOOR requirement → satisfiable ONLY
  by TOTP (or the admin waiver). VERIFIED IN CODE (`src/server/auth/strong-auth-wall.ts`,
  `src/server/auth/strong-factor.ts`), not just the story. Stories AUTH-002 (description + AC-001) and
  AUTH-004 (description/context/behavior/AC-001 + new AC-003) corrected.

CRITICAL DISTINCTION (the audit conflated this; corrected here): **session authLevel** ("strong" after a
passkey LOGIN, `webauthn/authenticate/verify:28`) is LEGITIMATE — a passkey login IS a strong-assurance
session. It is wrong ONLY when used to satisfy the ACCOUNT-level requirement (the cliff). So AC-001's
"authLevel strong" is KEPT (clarified as session assurance); the cliff predicate is what changes.

AUDIT FALSE-POSITIVE worth recording: the audit flagged a missing AUTH-002↔AUTH-003 hard dependency to
force "TOTP before WebAuthn". DECISION (reversible): do NOT add a hard prerequisite block — the corrected
cliff (TOTP-required) + the TOTP-first prompt ordering (§6a) enforce the floor without a hard block that
could create new lockout edge cases. D6's "after the TOTP floor" is prompt ORDERING, not an enrollment
prerequisite.

VERIFIED SPEC-FAITHFUL by this audit (NOT broken): AUTH-001 magic-link (D3/D4), LEVER-001 T-of-N (J02 D10,
generic step-up), TRUST-001/003 (J03/J04), AGENTS-001 (D11), all scaffold/presence/read/write-API stories.

## 7. DoD corrections already made (committed to main)
- DOD-SPINE-3 ✅→🟡 (served agents-appear journey is `test.skip`-gated on DIRECTORY_API_URL — separate
  done-auditor finding; standing proof is the close gate). READ-1/2 notes corrected. AGENT-1 caveat added.
- DOD-AUTH-2 ✅→🟡 and DOD-LEVER-4 ✅→🟡 (Violation A — step-up inversion; step-up half only — owner-only +
  burn-never-erases remain proven).
- DOD-LEVER-2 stays 🟡 by decision (signed-event → M10).
- **DOD-AUTH-4 ✅→🟡 (PENDING — Violation B, must be flipped in STEP 3):** the proven line says "enrolling a
  passkey lifts the cliff" — that codifies the inversion. After the predicate split it must read "the cliff
  is lifted by the TOTP floor (or admin waiver); a passkey does NOT lift it" and be re-proven (AUTH-004
  AC-003). Until then DOD-AUTH-4's ✅ is NOT trustworthy.
- Honest proven-live count after corrections: ~28/41 (DOD-AUTH-4 now also suspect).

## 8. Remediation plan — FIX THE STORY FIRST, then implement from it

UPDATE 2026-06-28: the gate was LIFTED (Andre's post-compaction kickoff: "begin coding… do not wait for
Andre to approve… unless you have a critical design decision, you should not be stopping"). The journey is
unambiguous, so both violations are journey-faithful corrections, NOT design forks → proceeding.

**STEP 1 — correct the stories (the golden contract) against the journeys. ✅ DONE.**
   - **Violation A (step-up):** AUTH-002 (description, context, behavior, AC-003, +new AC-004 TOTP-only,
     SI-001, observability) + AUTH-006 (AC-002) rewritten — step-up is "against an existing STRONG FACTOR
     (passkey OR confirmed TOTP)"; AC-004 proves a TOTP-only operator completes every sensitive action.
   - **Violation B (cliff/requirement):** AUTH-002 (description + AC-001 — session authLevel vs account
     floor) + AUTH-004 (description/context/behavior/AC-001 + new AC-003) rewritten — the 7-day cliff
     requires the recoverable TOTP floor; a passkey does NOT lift it.
   - VERIFIED FAITHFUL (no change): LEVER-001 (generic step-up), outline.md. AUTH-002↔AUTH-003 hard-dep
     NOT added (decision in §6c).
   - Commits: `5a44469d` (A: AUTH-002/006), `4ce5f041` (B: AUTH-002/004).

**STEP 2 — implement from the corrected stories.** TWO threads:
   - **B (cliff) — split the predicate.** Keep `hasStrongFactor` (passkey OR TOTP) for the STEP-UP gate
     (it is correct there). Add a recoverable-floor predicate (`hasTotpFloor` = `isTotpConfirmed`) and use
     it in `strong-auth-wall.ts:isStrongAuthWalled` (cliff) and `PostureHeader` (compliance display). A
     passkey-only account past grace stays walled until TOTP. Nudge copy → "set up TOTP".
   - **A (step-up) — factor-aware UI.** The gate is already factor-agnostic; `/totp/verify` already stamps
     `last_step_up_at`. Add a step-up UI that offers the operator's ACTUAL factor(s): passkey ceremony →
     `/webauthn/stepup`, OR TOTP code → `/totp/verify`; `webauthn-client.ts:stepUp()` must stop being
     WebAuthn-only; `TotpPanel.onStart` must handle 403 step_up_required. Wire into SuspendLever,
     WebAuthnPanel, TotpPanel, F1 onboarding enroll. Plus the 7 cosmetic "passkey" → "passkey or
     authenticator app" strings (§6a) + Account TOTP-first ordering.

**STEP 3 — RED-FIRST proof.** (a) A TOTP-only account: onboarding F1 enroll + suspend/burn + factor
   add/remove, all via TOTP step-up (Violation A). (b) A passkey-only account past grace STAYS gated until
   TOTP (Violation B, AUTH-004 AC-003). Update the DoD wording FROM THE CORRECTED STORIES, then restore
   DOD-AUTH-2 / DOD-LEVER-4 and re-verify DOD-AUTH-4 (now correctly TOTP-floor). Per-unit review
   (code-reviewer + test-attacker; fallback-finder on the auth gate).

NOTE: known code touch-points are in §6a (step-up) + §6c (cliff: strong-auth-wall.ts, strong-factor.ts).

## 9. OPEN DECISIONS for Andre
- (a) ~~Approach sign-off~~ — RESOLVED: Andre's kickoff lifted the gate ("begin coding… do not wait"). The
  fix is underway (STEP 1 done; STEP 2 in progress). The journey is unambiguous so both violations are
  faithfulness corrections, not forks. FLAGGED FOR AWARENESS (not blocking): the audit expanded the scope —
  Violation B (cliff requires TOTP, passkey no longer lifts it) overturns the previously-✅ DOD-AUTH-4 and
  changes onboarding UX (TOTP becomes de-facto mandatory for everyone, per D6). If Andre disagrees with the
  passkey-doesn't-lift-the-cliff reading, this is the one place to say so — but D6 ("WebAuthn as a substitute
  for 2FA — Rejected") is explicit.
- (b) Portal deployment model (centralized hosted vs per-operator self-hosted) — gates the M10
  signed-revocation Layer 1 design; not needed for this fix.
- (c) Still-pending from before: #1 stand up the live cluster, #2 npm publish — both await "go".
- (d) Today was meant to be launch; it is now remediation. Launch can't proceed on a board whose ✅ just
  proved fallible — the step-up fix + the cliff fix + the spec re-audit are the trust-restoring work.

## 10. Lesson (saved to memory)
[[feedback_anchor_reviews_to_journey_spec]] — review against the source spec, not only tests+DoD.
