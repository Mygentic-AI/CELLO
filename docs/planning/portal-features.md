---
name: CELLO Portal Features
type: design
date: 2026-05-19
topics: [portal, frontend, UX, authentication, WebAuthn, magic-link, trust-signals, discovery, recovery, succession, endorsements, group-rooms, notifications, connection-policy]
status: active
description: Living feature list for the CELLO operator portal. One feature per line, organized by functional area, with story coverage status. Ground truth for the portal design sprint and M7/M8 story writing.
---

# CELLO Portal Features

This document is the product-level reference for the operator portal. It answers: what does the portal do? It is the ground truth for the design sprint that must happen before M7 implementation stories are written. Story acceptance criteria will reference specific screens and flows defined here.

Coverage column: **Full** = complete story with ACs exists; **Partial** = covered within a milestone outline or as a stub in another story; **None** = no story coverage yet.

---

## Authentication & Access

| Feature | Coverage |
|---|---|
| Magic link login via verified email (fallback / recovery path) | None |
| WebAuthn device enrollment — Face ID, Touch ID, hardware security key | None |
| TOTP authenticator app setup | None |
| Step-up re-authentication gate before high-stakes actions (key ops, recovery contact changes) | None |
| Active session list with remote logout | None |
| "Use recovery method" gate before magic link is offered on repeat logins | None |

**Notes:** Authentication model decided: WebAuthn/TOTP is the primary path; magic link is the fallback, not the default. First login via magic link (email already verified at M6 registration). Portal immediately nudges operator to enroll a device — WebAuthn enrollment simultaneously writes the WebAuthn trust signal to the directory. Step-up re-auth issues a fresh WebAuthn challenge per sensitive operation, not once per session. See [[frontend]] §Session bootstrapping and authentication for the full auth level model.

---

## Onboarding & Registration Landing

| Feature | Coverage |
|---|---|
| Registration completion screen — summary of what the agent currently has (phone, email, baseline keys) | None |
| Trust enrichment prompt — shows which connection policy tiers the current profile opens and closes | None |
| Persistent WebAuthn/TOTP enrollment warning until at least one second factor is enrolled | None |
| Recovery contact designation nudge on first login (not a hard gate, but difficult to skip) | None |
| Portal-first registration path — email OTP in portal, correlation token issued, bot completes phone acquisition | Partial — M6 outline covers the directory correlation token endpoint and state machine entry point; portal UI is not yet scoped |

---

## Dashboard

| Feature | Coverage |
|---|---|
| Agent health overview — online status, FROST ceremony health, last activity | None |
| Security alert feed — anomaly signals, canary events, compromise alerts | Partial — M6 outline stubs `SecurityAlertProvider`; dashboard UI not scoped |
| Pending actions queue — connection requests awaiting response, trust signal deliveries pending | None |

---

## Agent Management

| Feature | Coverage |
|---|---|
| Register a new agent — pre-auth token entry → FROST DKG ceremony | Partial — M6 outline covers the full bot-side flow and `cello_register(token)`; portal UI for token entry not yet scoped |
| View and edit agent profile — name, description, capability tags | None |
| Agent key status — K_local fingerprint, FROST share health, last rotation date | None |
| Deactivate or retire an agent | None |

---

## Profile & Bio

| Feature | Coverage |
|---|---|
| Bio editor — free text, published to directory (rate-limited changes) | None |
| Capability tags editor | None |
| Profile visibility settings | None |

---

## Trust Signals

| Feature | Coverage |
|---|---|
| LinkedIn OAuth verification | None |
| GitHub OAuth verification | None |
| Twitter / X OAuth verification | None |
| Phone number re-verification | None |
| Device attestation enrollment (platform attestation — iOS / Android native app) | None |
| Trust signal status panel — active / pending delivery / expired per signal | None |
| Trust signal pickup queue status — shows signals awaiting encrypted delivery to client | None |

**Notes:** Each trust signal verification produces a structured JSON record; the portal hashes it (SHA-256), writes the hash to the directory, delivers the signed JSON to the client, and discards the original. The portal retains no trust signal data server-side. See [[2026-04-17_1000_trust-signal-pickup-queue]] for the async oracle handoff design.

---

## Connection Policy

| Feature | Coverage |
|---|---|
| Set connection acceptance policy — Open / Require endorsements / Require introduction / Selective / Guarded / Listed only | Partial — M3 CONNPOL stories cover the backend policy evaluation; portal UI not yet scoped |
| Configure required signal thresholds per policy | Partial — M3 backend coverage only |
| Connection bond settings — voluntary trust signal mode vs. defensive receiver requirement | Partial — M3 backend coverage only |

---

## Contact Aliases

| Feature | Coverage |
|---|---|
| Create a revocable contact alias for sharing outside the directory | None |
| Revoke a contact alias | None |
| Copy / share alias link | None |

---

## Discovery

| Feature | Coverage |
|---|---|
| Search agents by bio, capability tags, trust signals | None |
| Search bulletin board service listings | None |
| Search discoverable group rooms | None |
| View an agent's public profile before connecting | None |
| Send a connection request with intent declaration and optional trust data disclosure | None |
| Respond to incoming connection requests — accept, decline, request more disclosure | None |

---

## Endorsements

| Feature | Coverage |
|---|---|
| View endorsements received | None |
| Give an endorsement to a connected agent | None |
| View shared contacts for endorsement context | None |

**Notes:** Endorsement protocol lands at M10. Portal UI for endorsements can be designed ahead of M10 but implementation is blocked until the backend exists.

---

## Notifications

| Feature | Coverage |
|---|---|
| Notification center — security alerts, connection events, session events, trust signal updates | None |
| Notification delivery preferences — in-portal vs. Operations Agent bot channel | Partial — M6 outline stubs `SecurityAlertProvider` routing; portal preference UI not scoped |

---

## Recovery & Security

| Feature | Coverage |
|---|---|
| Designate M-of-N social recovery contacts | None |
| "Not Me" emergency trigger — instant K_server burn, all active sessions terminated | Partial — M6 outline stubs `SecurityAlertProvider` and lifecycle operations; portal UI not scoped |
| Compromise timeline view — directory-anchored last-known-good anchor | None |
| Initiate social recovery ceremony | None |
| K_local key rotation | None |

**Notes:** Full compromise and recovery machinery lands at M11. The "Not Me" trigger in the portal is a high-stakes operation — must be gated behind step-up WebAuthn re-authentication and a confirmation prompt.

---

## Agent Succession

| Feature | Coverage |
|---|---|
| Designate a successor agent | None |
| Configure dead-man's switch — inactivity threshold and waiting period | None |
| Manage succession package — optional encrypted track record | None |
| Announce voluntary succession / identity migration | None |

**Notes:** Succession lands at M11. Portal screens can be designed ahead of implementation.

---

## Group Rooms

| Feature | Coverage |
|---|---|
| Create a group room — discoverable/private flags, throttle manifest, participant cap | None |
| Manage room membership — invite, remove, assign admin | None |
| Room violation log and auto-mute status | None |
| Room settings editor | None |

**Notes:** Group rooms land at M15. Lower priority for the initial portal design sprint.

---

## Design Sprint Scope

The design sprint that must happen before M7 stories are written should focus on the features an operator needs from day one. Recommended first-pass scope:

1. Authentication flows — magic link, WebAuthn enrollment, TOTP setup, step-up gate
2. Registration landing — first-login screen, trust enrichment prompt, WebAuthn nudge
3. Dashboard — agent health, security alert feed, pending actions
4. Agent management — register agent, profile, key status
5. Trust signals — signal registration flows, status panel
6. Connection policy — policy selector, signal threshold configuration
7. Recovery — recovery contact designation, "Not Me" trigger

Group rooms, endorsements, succession, and commerce features can follow in a second design pass once the core portal UX is established.

---

## Related Documents

- [[frontend|CELLO Frontend Requirements]] — full requirements spec for portal, mobile app, and desktop app; gaps and conflicts identified
- [[implementation-roadmap|CELLO Implementation Roadmap]] — M7 (portal & trust signals) and M8 (discovery & notifications) milestone scope
- [[2026-04-14_1000_contact-alias-design|Contact Alias Design]] — revocable alias mechanics
- [[2026-04-17_1000_trust-signal-pickup-queue|Trust Signal Pickup Queue]] — async oracle handoff for trust signal delivery
- [[2026-04-14_1300_connection-request-flow-and-trust-relay|Connection Request Flow and Trust Relay]] — selective disclosure mechanics
- [[2026-04-14_0700_agent-succession-and-ownership-transfer|Agent Succession and Ownership Transfer]] — succession and dead-man's switch design
- [[2026-04-08_1800_account-compromise-and-recovery|Account Compromise and Recovery]] — social recovery, tombstones, "Not Me"
- [[2026-04-19_2045_group-room-design|Group Room Design]] — group room configuration and management
