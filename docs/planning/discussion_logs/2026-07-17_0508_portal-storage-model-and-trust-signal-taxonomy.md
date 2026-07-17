---
name: portal-storage-model-and-trust-signal-taxonomy
type: discussion
date: 2026-07-17
topics: [portal, trust-signals, storage-model, privacy, renewal, endorsements]
status: settled
description: >
  Canonical definition of what the portal stores vs the directory vs the daemon.
  Establishes the four categories of trust signal, the portal-as-zero-honeypot
  design goal, the daemon-cache enrichment options, and the renewal policy decision.
---

# Portal Storage Model and Trust Signal Taxonomy

## Context

After shipping M10 Tier 4 (GitHub OAuth) and the `github_connections` table, it became clear
the portal's storage boundaries needed an explicit canonical statement. This log records that
discussion and the decisions made.

---

## The Four Categories of Information

### 1. Foundational account information
- **Phone number** — hashed at registration, stored as `phone_stub_hash` in the directory's
  `user_accounts` table. Never stored in plaintext anywhere. The trust signal (`phone_anon`)
  attests "this account registered with a verified phone number." It cannot be revoked — that
  fact doesn't un-become true even if the user later changes their number.
- **Email** — the single exception to the no-plaintext rule. Stored as KMS ciphertext in the
  portal's `account` table because the portal must send magic links. Also hashed as
  `email_stub_hash` in the directory. The trust signal (`email_anon`) follows the same
  non-revocable logic as phone.

### 2. Portal security (authentication credentials)
- **WebAuthn (passkey)** and **TOTP (authenticator app)** are special cases. The portal is the
  system that manages these credentials — it is the only place that can verify them. Their status
  in the portal DB (`webauthn_credentials`, `totp_secrets`) is authoritative, not cached.
- They are still minted as notarized directory signals so counterparties can see them, but the
  portal's own tables are the ground truth for whether they exist.

### 3. External trust signals
- Everything beyond phone/email/security: GitHub, LinkedIn, future social validators.
- **The portal creates them and then forgets them.** The portal backend runs the OAuth flow,
  composes the envelope, signs it with the KMS submission key, submits to the directory, and
  delivers to the daemon. After that the signal belongs to the directory and the daemon.
- The portal displays status by querying the directory (DOD-PORTAL-SIGNAL-READ-1). It does not
  retain the plaintext credential (username, profile ID, etc.) long-term.
- `github_connections` (migration 0006) is a temporary workaround that predates
  DOD-PORTAL-SIGNAL-READ-1. Once that ships, the table is dropped.

### 4. Directory-computed signals
- Track record signals (session count, clean-close rate, etc.) are computed by the directory from
  its own ledger data, not from anything the portal submits.
- Display follows the same pattern as external signals: portal queries the directory for status.

---

## Endorsements

Endorsements follow the same flow as external signals (directory-notarized, held in the daemon
wallet) but are not portal-created. How and whether to display endorsements in the portal is an
open question — no decision made. When it comes up, the read path will be the same: query the
directory.

---

## The Portal as Near-Zero Honeypot

**Design goal:** there should be nothing in the portal worth stealing except the email address.

The portal DB is a **lightweight status cache** — "have you set this up, does it still exist
in the directory." No enriched data, no OAuth tokens, no social profile details, no signal
payloads. A full portal DB dump reveals: email (ciphertext), session tokens (hashed), WebAuthn
credential bytes, TOTP secret (ciphertext). Nothing else.

This is a deliberate tradeoff: the portal loses the ability to proactively enrich or refresh
signals, in exchange for being an unattractive target.

---

## Daemon Enrichment — Deferred Options

Two approaches were discussed for giving the portal access to richer local information
(e.g. readable signal labels, daemon wallet contents) without storing it server-side:

**Option A — JSON blob export/import (user-driven):**
The daemon exports a plain-text JSON blob to the user's local filesystem. The user uploads it
to the portal. The portal ingests it into a local browser cache (not the server DB). The cache
is informational only and expires. This keeps the portal server free of enriched data, at the
cost of manual friction for the user.

**Option B — Direct encrypted channel (daemon ↔ portal):**
A WebSocket or similar encrypted tunnel between the running daemon and the portal web app.
Richer UX, but introduces a network ingress point. Security risk assessment: manageable for
technical users, potentially dangerous for non-technical ones. Not comfortable opening this
without more design work.

**Current decision:** both deferred. The portal's status-cache model is sufficient for v1.
Revisit when user feedback indicates the friction of manual enrichment is worth solving.

---

## Signal Renewal

**The problem:** a trust signal captures a point-in-time fact. A GitHub account that was
1 month old when the signal was minted is 7 months old six months later — but the signal still
says "1 month old." The signal has aged but not been refreshed.

**Two approaches:**

**Proactive (portal-driven):** Portal retains the plaintext credential (e.g. GitHub username,
OAuth refresh token) and periodically re-runs validation in the background, minting a fresh
superseding signal automatically.
- Upside: seamless UX, always-fresh signals.
- Downside: portal must retain PII it would otherwise not store, creating exactly the honeypot
  the design goal is trying to avoid.

**Reactive (user-driven):** Portal shows the age of each signal ("your GitHub signal is 6 months
old") and surfaces a "Renew" prompt. The user initiates a fresh OAuth flow, which mints a new
superseding signal.
- Upside: zero additional PII retained, consistent with the minimum-retention principle.
- Downside: requires user action; signals can go stale if the user ignores prompts.

**Current decision: user-driven, v1.** This is the only option consistent with the minimum-
retention principle and the near-zero honeypot goal. The portal will surface aging signals and
suggest renewal; it will not store anything needed to renew automatically. Proactive renewal
is a future option that trades privacy for convenience — that trade has not been made.

---

## Summary Table

| Store | What lives there | Why |
|---|---|---|
| Portal DB | Email ciphertext, WebAuthn credentials, TOTP secret, sessions | Auth flows require plaintext/credential access |
| Portal DB (status cache) | Signal existence flags (queried from directory) | Display only — no PII |
| Directory `user_accounts` | `phone_stub_hash`, `email_stub_hash` | Tamper-evident account identity |
| Directory `signal_records` | Signal hashes, type, subject, status | Notary ledger — no payload, no PII |
| Daemon wallet | Full signal envelopes (encrypted at rest) | The user's own plaintext copy of their signals |

## Related

- [[M10-DEFINITION-OF-DONE]] — DOD-PORTAL-SIGNAL-READ-1 (portal reads signal status from directory)
- [[M10-BUILD-JOURNAL]]
