---
name: m8-journey-trust-signal-mechanism
type: journey
date: 2026-06-26
topics: [m8, m10, portal, trust-signals, write-api, pickup-queue, sealed-box, hash-everywhere, webauthn, daemon-handoff]
status: draft
description: >
  Fourth M8 portal journey — the general trust-signal handoff MECHANISM (the
  reusable pipe), distinct from the per-signal connectors. M8 builds the
  signal-type-agnostic pipeline (stateless portal backend, directory write API,
  ephemeral pickup queue, daemon pickup flow, sealed-box to k_local), proven
  end-to-end by WebAuthn enrollment as its first live consumer. M10 plugs each
  source (LinkedIn, GitHub, device, …) into the already-working pipe. Single-
  focus working doc; folds into the M8 outline + user stories later.
---

# M8 Journey — Trust-Signal Handoff Mechanism (the general pipe)

One of several single-focus journey docs for the M8 operator portal. Captures the
2026-06-26 decision that the **general trust-signal mechanism is M8**, the **per-signal
connectors are M10**, and **WebAuthn enrollment is the M8 first live consumer** that
proves the pipe end-to-end. This is the backend plumbing under Journey 03's UI scaffold.

## The split: mechanism (M8) vs. connectors (M10)

- **M8 — the general mechanism (the pipe).** The reusable, signal-type-agnostic plumbing
  every trust signal flows through. Built once, in the portal scaffolding.
- **M10 — the connectors.** Each signal's actual "click it and it goes and does something":
  LinkedIn OAuth + scrape + eval, GitHub, Twitter/X, device-attestation routing, the
  per-signal JSON schema, the per-signal expiry/liveness, the "Connect" UI action wiring.
  Each plugs a source into the M8 pipe.

This fixes the earlier "the M8 write API has nothing to write" problem: the write API's M8
job *is* this mechanism, exercised by a real signal — not a dormant seam.

## The pipe (signal-type-agnostic)

1. **Portal backend verifies** (transiently) — runs the verification/scrape for whatever
   signal type. (M8: a WebAuthn enrollment ceremony. M10: OAuth+scrape, device routing, …)
2. **Builds a structured JSON record** — e.g. `{type, …signal fields…, verified_at}`.
3. **Computes hash(es)** — `SHA-256(json)` always; plus `SHA-256(account_identifier)` for
   signals tied to an external account (LinkedIn/GitHub — Sybil dedup). Per-signal-type;
   not universal.
4. **Seals the JSON** to the agent's **`k_local_pubkey`** via the existing sealed box
   (`cello-client/core/crypto/src/content-seal.ts`, `sealToRecipient`) — anonymous
   ephemeral-X25519 box, no portal identity in the ciphertext.
5. **Write API call to the directory:** hash(es) → the identity tree (permanent,
   tamper-evident, replicated); ciphertext → the **ephemeral pickup queue**.
6. **Portal discards** the plaintext JSON **and the OAuth token** immediately. The portal
   backend is **stateless** after this — it persists nothing about the signal.
7. **Daemon pulls** the ciphertext (over its signaling connection, same path as
   notifications) → `openSealed(k_local seed)` → recovers the JSON.
8. **Daemon verifies** `SHA-256(json)` against the directory-recorded hash → stores the
   only plaintext copy locally on match / rejects on mismatch → **ACK**.
9. **Directory deletes** the ciphertext on ACK. It is left holding **only the hashes**.

## Decisions (locked)

**D1 — Seal to `k_local_pubkey`.** Reuse `content-seal.ts` (`sealToRecipient`/`openSealed`).
No new identity encryption key, no new schema, no dependency on the rotation/succession
thread. The `k_local`-rotation-race window (rotate between seal and pickup) is tiny, and
**trust signals are re-mintable** — if a pickup ever breaks, regenerate the signal
(re-verify, re-seal to the new key). Self-contained.

**D2 — Three tiers of persistence.**
- **Hashes → directory** identity tree, `agent_id`-keyed (survives rotation), append-only,
  tamper-evident, replicated. **Permanent.**
- **Ciphertext → ephemeral pickup queue**, sealed to `k_local`, delivered over signaling,
  **deleted on ACK.** Lives in the **directory delivery queue** (reuses the existing
  notification/`active_connection_requests` delivery path — keeps the portal backend
  stateless).
- **Plaintext → daemon only**, stored locally. The only long-term plaintext copy anywhere.

**D3 — The portal backend is stateless after handoff.** It persists nothing about the
signal — not the plaintext, not the token.

**D4 — Discard the OAuth token after scrape.** No stored social credential (no honeypot).
Liveness = signal expiry + operator-initiated re-verification nudge, never a held token
silently re-scraping the account. (If silent probing is ever wanted, that's a conscious
later decision to take on an encrypted-refresh-token store — default is no.)

**D5 — The directory holds hashes as a verification ANCHOR, not for policy.** Policy is
evaluated client-side; the directory does not judge. A counterparty verifies a *disclosed*
signal against the directory-recorded hash to confirm it's authentic. The directory is the
public notary, not the gatekeeper.

**D6 — Write-API discipline (the seam this establishes).** Authenticated, scoped to the
operator's `account_id`, **hashes-and-flags + sealed-ciphertext only — never plaintext,
never PII, never tokens.** Everything written replicates to every sovereign node, so only
safe-to-replicate data crosses it. (The other M8 write — the suspend/burn revocation flag,
Journey 02 D10 — rides the same disciplined seam.)

**D7 — WebAuthn enrollment is the M8 first live consumer.** It's a real Class-1 signal and
the one signal genuinely live at M8, so enrolling WebAuthn flows a real signal through the
whole pipe (hash → directory, ciphertext → queue → daemon → verify → store → ACK), proving
every stage. The M8 mechanism ships **proven, not speculative infra.** M10 connectors then
plug into an already-tested pipe.

## M8 vs. M10 scope

**M8 (this journey):**
- The general pipeline framework in the portal backend (steps 1–6, signal-type-agnostic).
- The **directory write API** (hash write to identity tree; ciphertext to pickup queue).
- The directory **ephemeral pickup queue** (ciphertext store + signaling delivery +
  ACK-delete).
- The **daemon pickup flow** (steps 7–9: pull → openSealed → verify → store → ACK).
- The directory **identity-tree storage** for signal hashes (`agent_id`-keyed).
- **WebAuthn enrollment** wired as the first live signal through the pipe.

**M10 (the connectors):**
- LinkedIn / GitHub / Twitter-X / Facebook / Instagram OAuth + scrape + per-signal eval.
- Device-attestation routing (TPM / Play Integrity / App Attest).
- Per-signal JSON schemas, expiry/liveness, and the "Connect/Verify" UI action wiring.
- Endorsements (Class 2) and the computed signals (Class 2/3/4).

## Relationship to the other M8 work

- **Journey 03 (Trust Signals UI)** is the four-class placeholder scaffold; this is the
  backend pipe under it. At M8, the WebAuthn cell is **live** (flows through this pipe);
  the rest stay honest placeholders until M10 connects them.
- **The "directory write API"** M8 item = this journey's hash/ciphertext writes **plus**
  Journey 02's revocation-flag write. Same authenticated, `account_id`-scoped, minimal seam.
- **Journey 01 (Auth)** owns the WebAuthn *enrollment ceremony*; this journey owns turning
  that enrollment into a trust signal through the pipe.

## Rejected / not doing

- **Storing the OAuth token / any social credential** server-side. No honeypot.
- **Persisting plaintext anywhere server-side** — portal stateless; directory holds only
  hashes (permanent) + ephemeral ciphertext (deleted on ACK).
- **A new long-term identity encryption key for M8.** Seal to `k_local`; regenerate on the
  rare rotation race. (A stable identity encryption key, if ever wanted, belongs with the
  M10 rotation/succession thread, not bolted on here.)
- **Building the per-signal connectors at M8.** Those are M10 — M8 builds only the pipe +
  WebAuthn.
- **Untested infra** — the pipe ships carrying a real signal (WebAuthn), not a stub.

## Downstream / open items

- The directory **identity-tree table** for signal hashes — new table vs. extend an
  existing one; `agent_id`-keyed; what columns (signal type, content hash, optional
  account-identifier hash, epoch/verified_at).
- Confirm the **pickup queue** reuses the existing notification/delivery infra rather than
  a parallel mechanism.
- Per-signal-type rule for whether the **account-identifier hash** is emitted.
- WebAuthn signal's exact JSON record shape (the M8 concrete instance).
