---
name: m8-screen-specs
type: design-brief
date: 2026-06-26
topics: [m8, portal, screen-specs, design-brief, design-system, sign-in, account-security, agents-home, trust-signals]
status: draft
description: >
  Designer brief for the M8 portal screens. Per-screen purpose, elements, states, and
  layout intent + the design-system reference — the artifact to hand an AI designer
  (Claude Design / Stitch) to produce visual mockups. NOT implementer specs (those are
  the story YAMLs). Four screens after the Dashboard fold: Sign-in/signpost, Account &
  Security, Agents home, Trust Signals.
---

# M8 Portal — Screen Specs (Designer Brief)

This is for the **visual designer**, not the implementer. It says, per screen, *what it
does, what's on it, what states it has, and how it should feel.* It is deliberately
design-focused — acceptance criteria and wiring live in the story YAMLs and are not here.

After the Dashboard fold there are **four screens**: Sign-in / signpost, Account & Security,
**Agents home** (the landing page), and Trust Signals. There is **no separate Dashboard**.

## How to read this

- Each screen lists: **Purpose · Elements · States · Layout · Do-not / TBD.**
- "Live" = shows real data at M8. "Placeholder" = honest "coming soon," never fake data.
- Design **dark mode** as primary (the operator console). The system supports light too,
  but the portal's home is the dark agent-console aesthetic (matches the existing screens).

---

## Design system (reference)

One system, two modes; the portal uses the **dark console** mode. Full tokens live in the
source repos — `cello-agent/frontend/src/app/globals.css` (dark) and `corp-cello-site`
(light). Key tokens:

- **Surface (dark):** warm charcoal, layered — base `hsl(60 2.7% 14.5%)`, cards slightly
  lighter; soft separation, not hard borders.
- **Text (dark):** warm cream `hsl(48 33% 97%)`; muted secondary.
- **Brand accent (both modes):** pink — `#db2777` (dark) / `#D91E8A` (light). Used
  sparingly for primary action + the "current/active" marker.
- **Secondary accents (dark):** teal `#2bb8a8`, navy `#00247D`.
- **Status colors:** green `#459315` (online / connected / healthy), amber `#EAB308`
  (last-seen / pending), red `#FE8181` (offline / failed / alert). Rendered as a small
  **`●` StatusDot**, with a subtle pulse for live states.
- **Type (dark):** `JetBrains Mono` for fingerprints / IDs / technical chips, `Lora` for
  display, system-ui for body. Fingerprints are **always mono chips**, often with a copy
  affordance.
- **Feel:** calm, precise, trustworthy — a command surface, not a marketing page. Generous
  spacing, quiet controls, no loud CTAs. Soft shadows, layered surfaces.

---

## Screen 1 — Sign-in / Stranger signpost

**Purpose.** The single entry. Two cases on one route: a returning operator signs in, or a
stranger with no link is pointed to where identity is actually created.

**Elements.**
- **Sign-in (Slack-style):** one **email field** + "Email me a sign-in link." After submit,
  a **6-digit code** entry (link *or* code both work). Quiet, centered, single brand mark.
- **Signpost (when there's no session and the visitor clearly hasn't started):** two clear
  outbound routes — **"Register with the Telegram agent"** and **"Install from GitHub."**
  A short line: identity is created in the ceremony, then you come back here.

**States.** Email entry · code entry (post-submit) · signpost (no-link visitor) · error
(bad/expired code, with a quiet retry).

**Layout.** Centered card on the dark surface. Minimal. The signpost is the same screen's
secondary content, not a separate page.

**Do-not / TBD.** **No "Create account" form** — identity is minted only at the ceremony.

---

## Screen 2 — Account & Security

**Purpose.** Manage how you get in and what's connected to your account.

**Elements.**
- **Authentication factors** — a list:
  - **WebAuthn / passkeys** — one row per enrolled device (e.g. "MacBook Pro · Touch ID,
    added Jun 12"), with **Remove**; an **Add** affordance.
  - **Authenticator app (TOTP)** — enrolled / not-enrolled, with **Set up**.
  - **Backup codes** — generate / regenerate (shown once).
- **Active sessions** — one row per session: device + browser, coarse location, "active
  now / 2 days ago," a **"This device"** marker; per-row **Log out**; a **"Log out
  everywhere."**
- **Account** — email (shown), phone (see TBD).

**States.** Factors enrolled / partially / none (with a gentle "set up a second factor"
nudge — the 7-day grace). Sessions: one / many. Empty states honest.

**Layout.** Three stacked sections (Factors · Sessions · Account), card per section.

**Do-not / TBD.** **Phone display is TBD** — the directory stores only a *hash* of the
phone, so a masked "•••• 4417" requires the portal to hold last-4 (it may not). Design a
row that works whether the phone is shown masked or omitted.

---

## Screen 3 — Agents home (the landing page)

**Purpose.** The page you land on. "Are my agents healthy?" at a glance — your agents,
their presence, and the one emergency control. This *is* the dashboard (folded in).

**Elements.**
- **Header band:**
  - **Alerts strip** — identity / security alerts (compromise, anomaly). Honest empty
    state: "No alerts — identity-affecting events appear here."
  - **Account posture** — a quiet summary line: strong-auth status (✓ / set-up-needed) and
    trust-signal coverage (a small count or chip row).
- **Agents list** — one row/card per agent:
  - **Fingerprint** mono chip (the identity; see TBD on names) + copy.
  - **Presence** — `●` StatusDot: green "Online," amber "Last seen 2 min ago," with honest
    last-seen text. Never a falsely-precise live clock.
  - **The suspend/burn lever** — a **quiet, de-emphasized** affordance, e.g. a small
    "⚠ Not me — suspend this agent." Opens a careful flow (Pause / Retire / Burn) with a
    step-up prompt and a clear "this blocks the agent from signing" explanation. **This is
    the only control on the row.**
- **Empty state** — no agents yet → "Register your first agent with the Telegram agent"
  (routes out, like the signpost).

**States.** Agents present (list) · empty · per-agent online / last-seen · alerts present /
empty.

**Layout.** Header band (alerts + posture) above a clean agent list. Calm, scannable.

**Do-not / TBD.**
- **No Register / Start / Stop / Set-current** buttons. Agents *appear* after the local
  ceremony; the portal never controls their process. The **only** control is the
  suspend/burn lever, and it must read as an emergency brake, not a toggle.
- **Agent name is TBD** — the friendly name (e.g. "atlas") is a *local* label the hosted
  portal doesn't have at M8; the directory has only the fingerprint. Design for a
  **fingerprint-primary** identity with an optional label slot (a future portal-side label
  or the deferred daemon channel may fill it). Do not assume a name is present.

---

## Screen 4 — Trust Signals (four-class scaffold)

**Purpose.** Show the operator's trust signals as the **four-class taxonomy**. At M8 this is
a scaffold: a few signals live, the rest honest placeholders.

**Elements.** Four distinct, named **class sections**, in order:
- **Class 1 — Identity proofs**, with visually-distinct sub-groups:
  - *Account security:* **WebAuthn**, **TOTP** — **live** (real enrolled state).
  - *Verified contacts:* **Phone**, **Email** — **live** (verified at registration).
  - *Social accounts:* LinkedIn, GitHub, Twitter/X, Facebook, Instagram — **placeholder**
    ("Connect — coming soon").
  - *Device sacrifice:* TPM / Play Integrity / App Attest — **placeholder** ("Verify device
    — coming soon").
- **Class 2 — Network graph signals** — endorsements, etc. — **placeholder / no data yet.**
- **Class 3 — Track record** — conversation count, clean-close rate, time on platform —
  **placeholder / no data yet.**
- **Class 4 — Economic stake** — bond, staking — **placeholder / not yet available.**

**States.** Live signals show real state; placeholders show an honest "coming soon / not
available" with a clearly non-functional control. Empty/preview states designed so the
observed classes (2/3/4) read as *previews*, not *broken*.

**Layout.** Four named sections, Class 1 sub-groups clearly separated. Each signal is a
small row/card: icon, name, state (live value or "coming soon").

**Do-not / TBD.** **No composite score, level, distance, "trust rank," or seed badge —
anywhere.** Trust is *named signals only*, never a single number. Placeholders must look
like placeholders (no fabricated "✓ Verified · 500 connections," no working-looking Connect
button).

---

## Mockup instructions

Generate **dark-mode** mockups (the operator console) for the four screens above, in this
order: **Sign-in/signpost → Agents home → Trust Signals → Account & Security.** For each:

1. Honor the **design system** above — warm charcoal layered surfaces, cream text, pink
   accent used sparingly, `●` StatusDot for presence, mono chips for fingerprints, calm
   spacing, quiet controls.
2. Show the screen's **key states** (e.g. Sign-in: email entry + code entry + signpost;
   Agents home: populated + empty; Trust Signals: a live signal next to placeholders).
3. Respect every **Do-not**: no account-creation form, no agent start/stop/register, no
   composite trust score, no fake placeholder data. The suspend lever reads as an emergency
   brake, not a toggle.
4. Treat the **TBD** items as flexible: design agent rows that work fingerprint-only (no
   name), and an account row that works with the phone shown-masked or omitted.

Keep it calm and trustworthy — a command surface for someone's cryptographic identity, not
a marketing site.
