---
name: m8-journey-onboarding-and-authentication
type: journey
date: 2026-06-25
topics: [m8, portal, onboarding, authentication, magic-link, 2fa, totp, webauthn, recovery, telegram-ceremony]
status: draft
description: >
  First M8 portal journey — how an operator gets into the portal and stays in.
  Covers the ceremony gate, magic-link bootstrap, mandatory 2FA, backup codes,
  WebAuthn as a convenience layer, and the recovery floor. Single-focus working
  doc; will be folded into the M8 outline + user stories later.
---

# M8 Journey — Onboarding & Authentication

This is one of several single-focus journey docs for the M8 operator portal. It
captures the decisions made in the 2026-06-25 working session on how an operator
reaches the portal and authenticates over time. It is a working spec, not a final
user story — it will be combined with the other journey docs into an M8 outline and
story set once all journeys are documented.

## The settled model (one sentence)

Email magic link bootstraps a session → TOTP 2FA is the required, recoverable factor
→ WebAuthn/Face ID is a convenience layer on top → backup codes recover from device
loss → the recovery-contact threshold is the catastrophic floor. Telegram is involved
only in the ceremony and the first link — never in the ongoing auth loop.

## Decisions (locked)

**D1 — The portal is ceremony-gated.**
The only way in is a magic link that originates from the Telegram key ceremony. There
is no portal-side signup and no cold entry. Identity is minted in the ceremony; the
portal only ever reflects an identity that already exists. A "create an account on the
portal" flow does not exist.

**D2 — A stranger's landing state is a signpost, not a dead end.**
A visitor who reaches the portal URL with no magic link sees a page that routes them to
the two things that actually start the journey:
- the **Telegram ceremony** (sign up / register your first agent), and
- the **GitHub repo** (install instructions for the local daemon/CLI).
No form, no account creation — just the two routes out to where onboarding really
happens.

**D3 — Magic link = passwordless session bootstrap (Slack-style).**
- The portal sign-in screen asks for one thing: the operator's **email**.
- It sends a **one-time, time-limited link plus a matching 6-digit code**. Either gets
  you in — click the link or type the code (the code covers the cross-device case).
- Entering via link or code **establishes a durable session** on that device.
- **Returning visits ride the existing session** — no new link per visit. A fresh
  link/code is only needed when the session expires, you sign out, or you're on a new
  device.

**D4 — Telegram is not in the ongoing auth loop.**
Telegram keeps exactly its original narrow purpose: the **initial key ceremony** and
**phone-number verification**. It issues the **first** magic link (the first-timer
handoff into the portal) and nothing more. All **returning** magic links are delivered
to **email**, originated by the portal sign-in screen. A Telegram compromise *after*
onboarding never locks an operator out, because ongoing auth rides email + 2FA.
- Rationale: Telegram was adopted only to avoid unstable, costly global SMS (Twilio)
  for phone verification, and to host the ceremony bot. Promoting it to the ongoing
  auth/recovery channel would make a messaging app a single point of failure — the
  exact thing CELLO exists to abolish. Telegram is a bootstrap/convenience channel,
  never a root of trust.

**D5 — Strong auth is required, enforced by a 7-day grace + human-mediated waiver.**
- A new operator may use the portal **without** 2FA for up to **7 days** (nudged to set
  it up throughout).
- After 7 days, **no 2FA = gated** (a hard wall, not the perpetual daily-magic-link
  treadmill).
- The **only** bypass without 2FA is to **contact support, request a waiver in writing,
  and give a reason**. Each written excuse teaches us the real edge cases so we can
  design around them.
- **Admin override (real capability):** support can flip a **per-account waiver flag**
  that lifts the 7-day cliff for that specific operator. Scoped to the individual,
  operated by support (not self-service). This is the first piece of admin/support
  tooling behind the portal — noted for the IA, not designed here.

**D6 — The required 2FA is the recoverable factor: TOTP. WebAuthn/Face ID is a layer on
top, not a substitute.**
- **TOTP is the floor** because it is portable and recoverable (seed restore + backup
  codes). It survives device loss.
- **WebAuthn / Face ID is the convenient daily unlock**, layered on top — strong and
  phishing-resistant, but **device-bound**, so it cannot be the only factor. Accepting a
  device-bound factor as a full substitute is what created every device-loss lockout in
  the design discussion.
- During first onboarding we still proactively prompt to capture a WebAuthn credential
  while the operator is engaged — but as the convenience layer, after the TOTP floor.
- Caveat: synced passkeys (iCloud Keychain / Google Password Manager) give WebAuthn some
  same-ecosystem portability, which softens — but does not replace — the TOTP+codes
  floor.

**D7 — Backup codes are issued at 2FA setup.**
One-time-use codes, stored **off-device**. They are the device-loss / lost-phone escape
hatch that needs neither email nor Telegram.

**D8 — The catastrophic recovery floor is the recovery-contact threshold.**
When device + email + backup codes are all gone, recovery is via the **recovery-contact
threshold** (designed in the recovery journey, not here). This is CELLO's sovereign
replacement for Slack's "an admin disables your 2FA" — distributed, no central backdoor.
Recovery of the **cryptographic identity** never depends on any single channel (not
email, not Telegram, not a single admin).

## Principles that hold across the journey

- **No mechanism is ever the only door.** Every factor has a recovery path beneath it.
- **A bootstrap channel grants a session but never escalates privilege.** Once an account
  has 2FA, email alone can log you in but **cannot add a new root credential or recover
  the account** — adding a credential requires step-up against an existing strong factor;
  catastrophic recovery requires the threshold. This is what bounds the email-compromise
  attack (attacker gets a session at most, never a durable backdoor).
- **Telegram is bootstrap-only.** Convenience, never the root of trust.
- **The cryptographic identity root (FROST + recovery contacts) is separate from portal
  access auth.** Portal auth can lean on convenient channels; identity recovery cannot.

## The auth stack (top to bottom)

1. **Email magic link** — bootstrap (first link from ceremony; returning links from the
   portal to email).
2. **TOTP 2FA** — required, recoverable; the real takeover control.
3. **WebAuthn / Face ID** — optional convenience layer for daily unlock.
4. **Backup codes** — device-loss recovery, off-device.
5. **Recovery-contact threshold** — catastrophic recovery; sovereign, no central backdoor.

## Flows

**F1 — First-time onboarding (the happy path).**
Ceremony completes → operator handed the **first magic link** (via Telegram) → lands in
the portal with a durable session → prompted to set up **TOTP (required floor)** and
issued **backup codes** → prompted to add **WebAuthn/Face ID** as the daily-unlock
convenience → done. Strong-auth nudges continue until set; 7-day cliff if ignored.

**F2 — Returning sign-in (new session, same device).**
Portal sign-in screen → type **email** → portal sends **link + 6-digit code to email** →
enter either → durable session restored. Telegram not involved.

**F3 — New device.**
Device doesn't know the operator → fall back to **email magic link/code** to establish a
session on that device → portal sees no WebAuthn credential on this device → prompt to
**enroll one here too** (accounts hold multiple credentials, one per device). TOTP works
immediately on any device. **New-device magic-link use does not count against the
strong-auth cliff** — the account already has 2FA.

**F4 — Stolen laptop.**
From any other device the operator already holds (phone passkey / TOTP) → **revoke the
stolen device's credential and kill its session** (the device/credential management view
and the "Not Me" emergency brake). No email needed; a held second factor is enough.

**F5 — Lost phone / device with the authenticator.**
Use **backup codes** to get back in and re-enroll TOTP/WebAuthn on a new device. No email
or Telegram dependency.

**F6 — Total loss (device + email + backup codes all gone).**
Recover via the **recovery-contact threshold**. Not a channel — people / threshold.

## Explicitly out of scope / rejected

- **SSO (Google / Microsoft) for portal login.** Evaluated and set aside in favor of
  magic links + our own 2FA — to avoid tethering portal access to Big-Tech IdPs (a
  surveillance signal and a risk of excluding the privacy-conscious core audience).
  SSO's draw was its built-in recovery; we get equivalent robustness from TOTP + backup
  codes + threshold recovery without the tether. (Reconsider only as an *optional*
  alternative later, never as the only door.)
- **Telegram in the ongoing auth/OTP loop.** Rejected — see D4.
- **Face ID / WebAuthn as a substitute for 2FA.** Rejected — it is a convenience layer
  on top of the recoverable TOTP floor, not an equal alternative. See D6.
- **A centralized admin who can disable 2FA / recover identity.** Rejected — replaced by
  the recovery-contact threshold. See D8.

## Downstream / open items (flagged, not decided here)

- Exact UX of the stranger signpost page (D2) — copy and the two outbound routes.
- The support/admin surface implied by the D5 waiver override — its own small spec.
- Where the "device / credential management" view lives in the IA (used by F3/F4).
- Relationship between the "Not Me" emergency brake (F4) and the dedicated security
  journey — avoid duplicating; cross-reference once that journey is documented.
- Detail of the recovery-contact threshold lives in the recovery journey (D8 references
  it; does not define it).
