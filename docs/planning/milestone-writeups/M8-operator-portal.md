---
name: M8 — Operator Portal
type: milestone-writeup
date: 2026-06-28
updated: 2026-06-28
milestone: M8
status: open — local served close gate GREEN (42/3); AWS 3-region close gate + publish pending (Andre)
description: >
  M8 delivered the CELLO operator portal: a ceremony-gated, magic-link + mandatory-2FA web console
  where an operator's agents APPEAR with directory-derived presence, the four-class trust scaffold
  renders, and the emergency suspend/burn lever stops an agent signing federation-side. This write-up
  is a living document (M5 rule: incremental). It covers what was delivered, the TOTP-floor spec
  inversion and its story-first remediation, the local served close gate, the bugs found and fixed,
  and what remains gated on the live AWS cluster / npm publish.
---

# M8 — Operator Portal

**Started:** 2026-06-27 · **Local close gate green:** 2026-06-28 · **AWS close gate + publish:** pending (Andre)

This is a living write-up, updated as the milestone progresses (M5 rule). The numbers reflect the M8
Definition of Done (`docs/planning/user-stories/m8/M8-DEFINITION-OF-DONE.md`): **~32 / 41 DoD lines
proven-live**; the remainder is gated on the live AWS ≥2-node cluster, the (unbuilt) T-of-N protocol, or
Andre's publish/M10 go.

## What M8 is

A new repo, `cello-portal` (Next.js, dark-console design system), plus directory-side endpoints in
`trustless-cello` (the read/write internal API) and a daemon trust-signal pickup flow in `cello-client`.
The model (`[[project_portal_model]]`): agents **appear** — there is no register/create/start/stop in the
portal; the only agent-control action is the emergency suspend/burn lever. Entry is ceremony-gated
(`[[01-onboarding-and-authentication]]`): magic-link bootstrap → mandatory 2FA where **TOTP is the
recoverable floor and WebAuthn a convenience layer** (D6).

The 15-story set (E2E-001 + SCAFFOLD / AUTH / PRESENCE / READ / AGENTS / WRITEAPI / LEVER / TRUST) was
worked the M8 way: the **DoD is the yardstick**, the **live test is the enforcer** (Playwright driving the
served portal through a browser), the **build journal is the audit trail**.

## What was delivered (proven live)

- **Auth (J-AUTH / J-TOTP / J-grace / J-account):** magic-link sign-in → durable httpOnly server-side
  session (no JWT, server-revocable); WebAuthn enroll/usernameless-login/multi-credential (real CDP
  authenticator); TOTP + single-use backup codes (KMS-encrypted secret, verify-after-load); the 7-day
  strong-auth cliff; the Account & Security screen with log-out-everywhere.
- **Agents home (J-AGENTS):** the M8 landing page — agents appear with directory-derived presence, the
  alerts strip + posture header, the per-row suspend lever, no lifecycle controls (INV-9), empty state →
  ceremony signpost; no agent/identity data in browser storage (INV-2).
- **Suspend/burn lever (J-LEVER / J-SUSPEND):** Pause freezes signing federation-side (the directory
  honor-check refuses the FROST share — proven cross-process), Burn is permanent (share zeroed
  federation-wide, binding/accountability preserved), the write goes through the account-scoped
  `/internal/agent-write` seam (cross-account → `not_owner`).
- **Trust pipe + four-class UI (J-TRUST):** WebAuthn enrollment flows hash → directory identity tree +
  sealed ciphertext → daemon `openSealed`/verify/store/ACK (single-node, cross-process); the four named
  classes render with no composite score (INV-7).
- **Cross-cutting invariants:** no plaintext/PII/token server-side (INV-2), server-side account-scoping
  (INV-3), ceremony-gated entry with no enumeration oracle (INV-1), observability taxonomy (INV-8).

## The incident — the TOTP-floor spec inversion (2026-06-28)

The defining event of M8. Andre's intuition ("maybe things were built assuming everyone has WebAuthn")
uncovered a spec inversion. The root cause was **the STORY**, not the procedure or reviews: the journeys
are the hand-reviewed golden source, the stories are the contract derived from them, and AUTH-002 (later
AUTH-004) **dropped/inverted journey-01 D6**. Everything downstream — the DoD wording, the tests, the
code — faithfully implemented the wrong story. Two distinct violations, both from treating WebAuthn as an
equivalent substitute for TOTP (which D6 explicitly rejects: "Face ID / WebAuthn as a substitute for 2FA —
Rejected"):

- **Violation A — step-up was WebAuthn-only.** A TOTP-only operator (the spec's PRIMARY recoverable factor)
  was dead-ended at "verify a passkey" for every sensitive action and both F1 onboarding directions.
- **Violation B — the 7-day cliff lifted on any factor.** A passkey-only account cleared the cliff — the
  exact device-loss lockout D6 exists to prevent.

**Remediation was STORY-FIRST** (the contract corrected against the journeys before any code):
1. AUTH-002/004/006 rewritten so step-up is "against an existing STRONG FACTOR (passkey OR confirmed
   TOTP)" and the cliff requires the recoverable TOTP floor; new ACs for the TOTP-only operator + the
   passkey-only-stays-gated case.
2. Implementation from the corrected stories: a factor-aware `StepUpDialog` (fetches the operator's LIVE
   factors, offers the one(s) they hold), the predicate split (`hasStrongFactor` for step-up vs
   `hasRecoverableFloor` for the cliff), factor-agnostic copy, Account TOTP-first ordering.
3. Red-first proof: J-LEVER (TOTP-only operator suspends via a code, no passkey dead end), J-AUTH (F1
   catch-22 fixed both directions, stub-resistant both factors), J-grace (passkey does NOT lift the cliff;
   TOTP does). DoD-AUTH-2 / LEVER-4 / AUTH-4 restored to ✅ — now genuinely journey-faithful.

Full record: `[[2026-06-28_0700_m8-totp-floor-stepup-inversion-remediation]]`.

## The local served close gate (2026-06-28)

After the remediation, an initial call that "everything remaining is cluster-gated" proved **wrong**.
DOD-SPINE-3 was blocked only on the LOCAL directory auto-bring-up (the M8 procedure §4 runs the served e2e
against a Docker directory; only the FINAL 3-region run is AWS). Built it:

- A standalone **internal-API harness** in the directory worktree (`createInternalApiServer` against the
  directory Postgres — the genuine code, no libp2p/KMS/transport-keys).
- A portal **`npm run test:e2e:real-dir`** wrapper (Docker Postgres + Flyway + the harness + seeding;
  process-group teardown, no port leak).

Result: the **full M8 portal e2e suite passes against a REAL local directory — 42 passed / 3 skipped**
(the 3 are the j-spine fixmes SPINE-4/SPINE-6, proven in the `cello_spine` cross-process harness). SPINE-3
→ ✅; WRITE-1/LEVER-1/LEVER-4 proven served-real; DOD-E2E-1 ❌→🟡 (local close gate green; AWS final run
pending). This is reproducible, not a one-time manual demo.

## Bugs found and fixed

- **Step-up WebAuthn-only (spec inversion).** *Symptom:* TOTP-only operator dead-ended at "verify a
  passkey". *Root cause:* AUTH-002 story inverted journey-01 D6; DoD/tests/code traced the wrong story.
  *Fix:* story-first correction + factor-aware step-up. *Rule:* guard journey-faithfulness at story
  AUTHORING; a story that cites a journey decision must not contradict it (`[[feedback_anchor_reviews_to_journey_spec]]`).
- **7-day cliff lifted by a passkey.** *Symptom:* a passkey-only account past grace cleared the wall.
  *Root cause:* `hasStrongFactor` (passkey OR TOTP) used for the cliff. *Fix:* split off
  `hasRecoverableFloor` (= confirmed TOTP) for the cliff + posture. *Rule:* the cliff is the recoverable-
  floor requirement, distinct from the step-up gate.
- **Orphaned harness / port leak.** *Symptom:* a single-PID kill left node holding :8081, silently
  poisoning the next run. *Fix:* launch under its own process group, `kill -- -PGID`; harness fails fast on
  EADDRINUSE. *Rule:* a standing gate must reap its whole process tree.
- **Hollow test (factor-aware step-up).** *Symptom:* the `hasTotp` branch was only ever asserted PRESENT —
  a dialog that always showed the TOTP field would pass. *Fix:* symmetric `stepup-totp-code` count-0
  guard for passkey-only holders. *Rule:* pin every factor branch in both directions.

## What remains (gated, verified — not assumed)

- **The live AWS ≥2-node cluster close gate (Andre's deploy):** cross-node aspects — PRES-2/3
  (from-any-node), TRUST-1 (pickup_queue replication), and the AWS run of DOD-E2E-1. Local logical
  replication was investigated and found non-viable (`[[project migration]]` / build-journal); the
  `cello_spine` fixture uses `directoryNodeStubs`.
- **The T-of-N protocol (a separate feature, larger than the portal):** INV-6 / LEVER-3 strict T-of-N —
  the current path is the documented 2-of-2 stopgap (`[[project_threshold_t_of_n_not_2_of_2]]`).
- **TRUST-1 H2 (pickup_queue → UUID + `cello_pub`):** the implementation is scoped (the pickup id is
  already an opaque string, so bigint→UUID is transparent), but it is a cluster-coupled migration story —
  `cello_pub` membership is cluster infra (`setup-replication.sh`), the sweep-gating correctness is a
  cross-node property, and the cross-node delivery proof needs the cluster. To be done deliberately as a
  migration story with the cluster, per the M5 migration-integrity rules.
- **Andre's go:** TRUST-4 (npm publish), LEVER-2 (M10 signed revocation — `[[2026-06-28_0700_m8-totp-floor-stepup-inversion-remediation]]` §5).

## Lessons

- **The story is the journey→contract translation.** Guard journey-faithfulness at story authoring; a
  story that cites a journey decision and then writes contradicting ACs is the canonical failure
  (`[[feedback_anchor_reviews_to_journey_spec]]`).
- **"Cluster-gated" must be verified, not assumed.** SPINE-3 looked cluster-gated and wasn't — it needed a
  local Docker directory the procedure already prescribes. Read the harness before writing a line off.
- **Migration-integrity holds even under "keep going."** TRUST-1 H2 is genuinely cluster-coupled
  (unverifiable purpose locally + cluster infra); building it blind would violate the M5 rules. The
  disciplined call is to scope it and pair it with the cluster.

## 2026-06-28 — Portal deployed live to AWS (dated DOD-E2E-1 confirmation)

The portal is now **deployed and serving on AWS** — the dimension DOD-E2E-1 was missing (the portal had
only ever run locally). Live at **https://portal.cello.mygentic.ai** (us-east-1, ECS Fargate + ALB/ACM/
Route53 + a dedicated RDS, in the directory's VPC; image `f6a43d8`, built by CodeBuild — never pushed from
local).

**Delivered (IaC):** `cello-portal-build.yaml` (ECR + S3 source + CodeBuild), `cello-portal-data.yaml`
(SGs + RDS + ACM cert), `cello-portal-app.yaml` (ALB/HTTPS + Route53 + ECS service + IAM + delivery-failure
alarm), plus `build-portal.sh` / `create-portal-secrets.sh`. SES magic-link email delivery was wired in the
portal (the AUTH-001 TODO), reviewed (code-reviewer + fallback-finder), and the reviewer-blocking finding —
a SES misconfig is a silent login outage — is covered by a CloudWatch alarm on
`portal.auth.magic_link.delivery_failed`, wired to the `cello-ops-warning-dev` SNS topic.

**Verified live:** HTTPS `/sign-in` → 200 (ACM valid), HTTP → 301→HTTPS, protected `/` → 307→sign-in; the
task self-migrates its RDS on boot (`migrationVersion 0005`); and a magic-link request resolves accounts
through the **LIVE directory** `/internal/account-by-email-stub` over its public ALB (200 +
`accountResolved:false` for an unknown email — proves the served-portal↔live-directory seam with a valid
API key, no enumeration oracle).

**Bug found + fixed (Symptom / Root cause / Fix / Rule):** the first app deploy rolled back (task exit 1).
Root cause — the RDS-generated master password contained `#`; built into a `postgres://user:pass@…` URL
un-encoded, `#` starts the URL fragment → truncated connection string → no DB → migrate failed. The local
smoke test used a trivial password (`smoke`), hiding it. Fix — `create-portal-secrets.sh` URL-encodes the
credential components. Rule — any DB URL assembled from a generated/managed credential MUST url-encode the
parts (RDS passwords routinely contain `#/@:%`); smoke-test with special-char passwords.

**Still 🟡 (unchanged), NOT ✅:** the cross-node aspects — 3-region/from-ANY-node presence (PRES-2/3),
pickup_queue replication (TRUST-1 H2), strict T-of-N refusal (INV-6/LEVER-3, unbuilt protocol) — and a
full browser-driven E2E against the live cluster (needs a real ceremony-registered account + the
SES-delivered code). The "served portal against the live directory" gap is now closed.

**Productionization follow-ups (named, in `infra/STATE.md`):** wire the portal stacks into `deploy.sh` as a
guarded us-east-1-only step (today deployed via targeted `aws cloudformation deploy`); optionally move
portal→directory to HTTPS or VPC-internal (today HTTP + API-key over the public ALB, the existing ops-agent
model). trustless-cello infra/docs commits are local, awaiting Andre's push.
