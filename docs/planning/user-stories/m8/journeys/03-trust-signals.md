---
name: m8-journey-trust-signals
type: journey
date: 2026-06-26
topics: [m8, portal, trust-signals, four-class-taxonomy, placeholder-scaffold, m10, no-composite-score]
status: draft
description: >
  Third M8 portal journey — the Trust Signals section. M8 ships the real
  four-class taxonomy UI as a navigable scaffold with honest placeholders;
  functional signal verification (OAuth, device attestation, endorsements,
  stake) lands in M10. Grounded in the canonical trust-signal taxonomy. Single-
  focus working doc; folds into the M8 outline + user stories later.
---

# M8 Journey — Trust Signals (four-class placeholder scaffold)

One of several single-focus journey docs for the M8 operator portal. Captures the
2026-06-26 decision to build the Trust Signals **section** at M8 as the real four-class
IA populated with honest placeholders, deferring the functional verification flows to
M10. Working spec, not a final user story.

## Decision in one line

**M8 ships the real four-class Trust Signals UI as a navigable scaffold** — the live
signals (WebAuthn, TOTP, phone, email) reflect real state; every other signal shows an
**honest placeholder** ("coming in M10"). The functional verification flows (OAuth socials,
device attestation, endorsements, stake) are **M10**. The scaffold is the *actual* IA M10
fills in — additive, not a rewrite.

## Why a scaffold now (and why it's not a mock)

- **The four-class IA is a hard requirement** (`frontend.md` 151–160): the portal must show
  trust signals as **four distinct named classes, never collapsed into a single score.**
  Getting that IA right at M8 means M10 only fills cells — no restructure.
- **It is a scaffold, not a mock.** A *mock* shows fake data or fake-functional controls
  that pretend (a "✓ Verified · 500 connections" row that never happened, a "Connect" button
  that simulates success). This scaffold does neither: unbuilt signals show their **true
  state** — at M8 an operator genuinely *has* no LinkedIn signal because they can't connect
  one yet, so "not available yet" is honest, not fake. No fake data, no fake-functional
  controls. (See [[feedback_cello_not_a_moderation_tool]] is unrelated; the governing rule
  here is "real data or honest empty state.")

## The hard constraints

- **Four distinct named classes, never a composite.** No "overall trust level," no score,
  no level, no aggregate.
- **No TrustRank / Trust Seeders / seed-distance, in any form** (`protocol-map.md` 160 —
  hard prohibition; both were deprecated and never built). [[feedback_no_trustrank_or_single_score]]
- **Honest placeholders only** — no fake data, no fake-functional buttons; a placeholder
  must visibly admit it's a placeholder.
- Source of truth for the taxonomy: `frontend.md` 151–160 and
  `discussion_logs/2026-04-11_1400_security-architecture-layers-and-trust-signal-classes.md`.

## The grounded taxonomy (what renders, and what's live vs placeholder at M8)

**Class 1 — Identity proofs** (sub-groups must be visually distinct):
- *Account security:* **WebAuthn**, **TOTP** — **LIVE at M8** (set up in Journey 01 auth).
  Reflect real enrolled/not state.
- *Verified contacts:* **Phone**, **Email (domain)** — **LIVE at M8** (verified at
  registration). Show verified state.
- *Social accounts (OAuth):* **LinkedIn, GitHub, Twitter/X, Facebook, Instagram** —
  **placeholder** ("Connect — coming in M10").
- *Device sacrifice:* **TPM / Play Integrity / App Attest** — **placeholder** ("Verify
  device — coming in M10; native app required").

**Class 2 — Network graph signals:** endorsements, conductance/cluster, counterparty
diversity, temporal anomaly flags — **placeholder / "no data yet"** (mostly directory-
computed, not operator-actionable).

**Class 3 — Track record:** conversation count, clean-close rate, time on platform —
**placeholder / "no data yet"** (observed, not operator-managed).

**Class 4 — Economic stake:** bond status, connection staking — **placeholder / "not yet
available."**

Honest split: Class 1 socials + device read as *future actions* ("connect/verify, coming
M10"); Class 2/3/4 read as *observed/computed* signals shown as empty-state previews. Only
WebAuthn/TOTP/phone/email are genuinely live at M8.

## Decisions (locked)

**D1 — M8 builds the Trust Signals section as a real, navigable four-class scaffold.**
A real nav entry + route, not a dimmed "SOON" item. Functional verification is M10.

**D2 — The four-class taxonomy is mandatory; no composite anywhere.** Four distinct named
classes, Class 1 sub-groups visually distinguished. No score/level/aggregate/TrustRank/
seed-distance element appears on the screen — enforced as a negative AC.

**D3 — Honest placeholders, never mocks.** Unbuilt signals show their true "not available
yet / coming in M10" state. No fake verified-data, no fake-functional controls.

**D4 — Live signals reflect real state.** WebAuthn, TOTP, phone, email read the operator's
actual enrolled/verified state (from Journey 01 auth + registration), so the scaffold isn't
a dead screen. This reads the same source as Account & Security — it re-presents that state
in the trust framing, it does not fork the logic.

**D5 — Bio, recovery contacts, succession are NOT in this section.** They are separate M10
surfaces (their own journeys), even though they're also M10.

**D6 — The scaffold is the IA M10 fills in.** M10 wires OAuth, device attestation,
endorsements, stake, and the trust-signal pickup queue into these exact cells — additive,
not a restructure.

## Launch scope vs. deferred

**M8 (this story):**
- Navigable **Trust Signals** section + route.
- The four-class IA rendered as four distinct named sections (Class 1 sub-groups distinct).
- Every planned signal placed in its correct class.
- **Live state** for WebAuthn / TOTP / phone / email; **honest placeholders** for all else.

**M10 (functional):**
- LinkedIn / GitHub / Twitter-X / Facebook / Instagram OAuth verification + evaluation.
- Device attestation routing (TPM / Play Integrity / App Attest).
- Endorsements (Class 2) and the computed network-graph signals.
- Track-record (Class 3) and economic-stake (Class 4) population.
- The encrypted async **trust-signal pickup queue** (hash-everywhere delivery to the agent).

## New work this journey implies

- A `/trust-signals` route + nav entry in the portal scaffold.
- The four-class layout component (Class 1 with its four sub-groups; Classes 2–4).
- A read of existing auth/registration state to populate the four live signals.
- Honest placeholder components (clearly non-functional) for every M10 signal.
- **Formal story:** `CELLO-M8-PORTAL-TRUST-001` — *Trust Signals: four-class placeholder
  scaffold*. To be written when M8 portal stories are assembled (depends on the portal
  app shell + nav + Journey 01 auth). Per the "don't lightly create stories" rule, this may
  fold into the broader portal-scaffold story set rather than standing alone.

### Sketched ACs (for the eventual story)
1. The route renders exactly four named class sections in order; **no aggregate / score /
   level / distance / TrustRank / Trust-Seeder element appears anywhere** (negative AC,
   explicitly tested).
2. Each planned signal appears under its correct class per the taxonomy above.
3. WebAuthn / TOTP / phone / email reflect the operator's **real** state.
4. Every other signal renders an **honest placeholder** — visible, labeled not-yet-available,
   no functional action behind it.
5. Class 1 sub-groups (account-security / verified-contacts / social / device-sacrifice) are
   visually distinct.
6. Observability (M4+): one `portal.trust_signals.viewed` event with `account_id`.

## Rejected / not doing

- **Any composite trust score, level, or aggregate.** Forbidden.
- **TrustRank / Trust Seeders / seed-distance / seed-status badge.** Hard prohibition.
- **Fake data or fake-functional controls** (a mock). Honest empty state only.
- **Real OAuth / device / endorsement / stake functionality at M8.** That's M10.
- **Bio / recovery contacts / succession in this section.** Separate M10 surfaces.
- **An all-placeholder *dead* screen.** Avoided by reflecting the four live signals (D4).

## Downstream / open items

- Exact placeholder copy per signal ("Coming in M10" vs. a dated/■neutral phrasing).
- Whether the live Class-1 signals link back to Account & Security (likely yes — same state,
  one place to manage).
- Visual treatment that makes "observed/computed" classes (2/3/4) read as *previews* rather
  than *broken* (empty-state design).
- Folds into the M10 Trust Signals journey when that milestone's functional design is written.
