---
name: Device Attestation Reexamination
type: discussion
date: 2026-04-13 10:00
topics: [device-attestation, WebAuthn, sybil-defense, trust-signals, identity, native-apps, App-Attest, Play-Integrity, TPM, onboarding]
description: Re-examination of device attestation design — discovered WebAuthn is tethering not device sacrifice; native apps required for platform attestation; two-tier web/native architecture decided; WebAuthn reclassified as account security signal.
---

# Device Attestation Reexamination

## The problem with the original conception

The original design grouped WebAuthn alongside TPM, Play Integrity, and App Attest as device attestation types. All four appeared under the same `attestation_type` enum in the persistence schema and were described together as signals proving "real physical device, not a VM or emulator." This grouping is wrong. They serve fundamentally different purposes.

---

## Tethering vs. sacrifice

The distinction that clarifies everything:

**Tethering** — binding a credential to a device for authentication purposes. One device can tether to many accounts. No real-world cost is committed.

**Sacrifice** — committing a physical device exclusively to one account. Using it here prevents using it elsewhere. A real-world cost is locked up.

WebAuthn is tethering. Platform attestation (App Attest, Play Integrity, TPM) is sacrifice — but only when combined with CELLO's one-account-per-device-hash deduplication rule. The attestation proves "this is a genuine device." The directory's uniqueness constraint is what turns that into a cost.

---

## Why WebAuthn cannot sacrifice a device

WebAuthn was deliberately designed to not expose a stable device identifier. This was an explicit privacy decision to prevent cross-site tracking — different WebAuthn credentials on the same device are not linkable by design.

What WebAuthn actually proves:
- A hardware-bound key was used to sign this challenge
- The credential is backed by real hardware (platform authenticator: Secure Enclave, TPM, Android biometric)
- The AAGUID identifies the authenticator *model*, not the specific device

What WebAuthn does not prove:
- Which specific physical device was used
- That this device is not registered to other CELLO accounts

An attacker with one phone could create 50 CELLO accounts, each with its own WebAuthn credential. Each credential ID is new — the one-account-per-credential-ID rule passes every time. There is no stable device identifier to hash for deduplication.

**WebAuthn's actual value:** Phishing resistance. An attacker who steals a password cannot authenticate without the physical device. Account security is meaningfully improved. This is real and worth a trust score bump — but it is a different category from Sybil defense.

---

## What platform attestation actually provides

| Type | Stable device ID? | Requires native app? | Platform |
|---|---|---|---|
| App Attest | Yes (Secure Enclave key, device+app specific) | Yes | iOS, macOS |
| Play Integrity | Yes (Google device binding) | Yes | Android |
| TPM | Yes (Endorsement Key, globally unique per chip) | Yes | Windows, Linux |
| WebAuthn | No (credential ID per account, not per device) | No (web browser) | All |

The three platform types all expose a stable, device-unique identifier that does not change when a new credential is created. CELLO hashes that identifier and the directory enforces one active binding per hash. The combination — attestation providing the identifier, directory enforcing uniqueness — is what creates the one-device-per-account guarantee.

---

## Native app requirement

App Attest and Play Integrity are native-only APIs. They are not available from web browsers:

- **App Attest** — iOS/macOS API (`DCAppAttestService`). Not exposed in Safari or any browser. Requires a signed native app.
- **Play Integrity** — Android API. Not available in Chrome on Android or any browser. Requires a native app.
- **TPM direct attestation** — requires native/privileged system access. Not available from a browser.

This means device sacrifice across all platforms requires CELLO to ship native apps.

---

## Two-tier architecture decision

**Tier 1 — Web portal (all users):**
WebAuthn only. Phishing-resistant login, hardware-bound credential. Account security signal. Does not sacrifice a device.

**Tier 2 — Native apps (opt-in for device sacrifice):**

| Ecosystem | Desktop | Mobile | Mechanism |
|---|---|---|---|
| Apple | macOS app | iOS app | App Attest / Secure Enclave |
| Microsoft / Google | Windows app | Android app | TPM / Play Integrity |

Downloading the native app and linking the device binds that device to the account. The directory enforces one active binding per device identifier. The device is sacrificed — it cannot be used to bootstrap another account without first releasing the existing binding.

**Linux / VPS / server agents:** No native device sacrifice available. Web-only WebAuthn only. This is a known gap, not a blocker — server agents are expected to operate at lower trust scores.

---

## VPS and server-deployed agents — by design

An agent running on AWS Linux or any VPS has no TPM, no App Attest, no Play Integrity, and cannot sacrifice a device. This is acceptable by design.

Device attestation is about the *owner's* devices, not the *deployment environment*. An agent on a VPS whose owner has linked their iPhone and MacBook carries their attestations. The deployment infrastructure is irrelevant. The attestation says "a real human with real hardware controls this account" — not "this agent runs on attested hardware."

Fully automated agents with no human owner cannot link any personal devices. They sit at the base trust level and are filtered by receiving agents with higher connection policies. This is the correct outcome: spinning up 10,000 headless agents on cheap VPSes is frictionless and should produce near-zero trust scores. The low-trust tier handles machine-to-machine work that doesn't require high assurance.

---

## Trust score implications

WebAuthn and device attestation earn trust for different reasons and should be weighted accordingly:

| Signal | Trust category | What it earns | Why |
|---|---|---|---|
| WebAuthn | Account security | Small bump | Phishing-resistant auth; account harder to hijack |
| Platform attestation + dedup | Sybil defense | Meaningful bump | Real device committed; $50–200/device attacker cost |

The trust score formula previously listed WebAuthn with "High" weight in the same tier as device attestation. These serve different threat models and warrant different weights. WebAuthn is account security; device attestation is Sybil resistance.

---

## Design corrections from this session

1. **`attestation_type` enum** — `WEBAUTHN` removed. Corrected to `TPM | PLAY_INTEGRITY | APP_ATTEST`. WebAuthn is an authentication mechanism handled separately from the device attestation schema.

2. **Trust signal classification** — WebAuthn moved out of device attestation and into account security. In the four-class trust signal model (security-architecture-layers), Class 1 Technical signals are now split: account security (WebAuthn) and device sacrifice (platform attestation).

3. **Explicit native app dependency** — documented that device sacrifice requires native apps on iOS, Android, Windows, and macOS. The web portal path provides WebAuthn tethering only.

4. **Trust score formula notes** — WebAuthn and device attestation weights should reflect their distinct purposes.

---

## Related Documents

- [[2026-04-11_1700_persistence-layer-design|Persistence Layer Design]] — schema corrected: WEBAUTHN removed from attestation_type enum
- [[2026-04-11_1400_security-architecture-layers-and-trust-signal-classes|Security Architecture Layers and Trust Signal Classes]] — Class 1 Technical signals corrected: WebAuthn and device attestation separated
- [[end-to-end-flow|CELLO End-to-End Protocol Flow]] — §1.2 updated: WebAuthn role clarified, native app requirement noted
- [[cello-design|CELLO Design Document]] — trust score table updated: WebAuthn described as account security, not device sacrifice
- [[2026-04-11_1000_sybil-floor-and-trust-farming-defenses|Sybil Floor and Trust Farming Defenses]] — device attestation as Sybil defense (Problem 3); WebAuthn not a Sybil defense mechanism
- [[design-problems|Design Problems]] — Problem 3 (phone Sybil floor); device attestation is one layer of the defense stack
