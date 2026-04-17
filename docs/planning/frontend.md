---
name: CELLO Frontend Requirements
type: design
date: 2026-04-16
topics: [identity, trust, WebAuthn, device-attestation, key-management, recovery, notifications, discovery, connection-policy, contact-aliases, compliance, onboarding, session-termination, MCP-tools, multi-party-conversations, escrow, succession, endorsements, companion-device, libp2p, human-injection, persistence]
status: active
description: Complete requirements for the human-owner frontend surfaces — web portal, mobile app, and desktop app — synthesized from all design documents and discussion logs. Audited 2026-04-16 via parallel 10-agent corpus sweep.
---

# CELLO Frontend Requirements

## System Boundary

The CELLO client (the MCP server, P2P transport, local key material, Merkle tree operations, and prompt injection layers) is the agent-facing layer. It runs alongside the agent and requires no human involvement during normal operation. The frontend is the human-owner layer. It exists because some things an agent fundamentally cannot do: perform WebAuthn ceremonies, respond to out-of-band security alerts, approve escalated connection decisions, or designate recovery contacts. The protocol is designed so that humans are only in the loop for high-stakes operations — not routine agent activity.

The content invariant holds for the web portal: the portal never handles, displays, or stores message content. It is a protocol event viewer and identity management surface. The mobile app and desktop app have a second mode — the **companion device connection** — that provides content visibility via a direct P2P connection to the owner's CELLO client. Conversation content reaches the native apps only through this P2P channel, never through CELLO infrastructure. See the Companion Device Connection sections under Surface 3 and Surface 4 for the full design.

An agent could technically receive web portal credentials and call the portal APIs, but every sensitive operation is gated behind WebAuthn or biometric specifically to require a physically-present human.

The three frontend surfaces are:

| Surface | Role | Required from |
|---|---|---|
| **Web Portal** | Identity verification, trust enrichment, key management, escalation review, account oversight | Day one |
| **Mobile App** | Device attestation (Apple ecosystem / Android), push-based escalation, emergency revocation, companion device content viewer | Phase two |
| **Desktop App** | Device attestation (Windows/TPM, macOS Secure Enclave), local MCP server management, companion device content viewer | Phase three (system tray deferred — far future) |

The portal communicates with two backend components: the **signup portal backend** (for PII-touching operations: WebAuthn credentials, OAuth tokens, K_server_X operations) and the **directory** (for public reads: trust signal hashes, Merkle proofs, discovery). The distinction is critical — PII (phone numbers, WebAuthn credentials, OAuth tokens) lives only in the signup portal backend and must never reach directory nodes. The directory holds only public keys, trust signal hashes, and Merkle trees.

---

## Surface 1: Web Portal

### What it is

The web portal is the universal entry point for human owners. It is accessible from any browser. It covers two distinct use modes that share the same web application:

- **Onboarding / setup** — where the human owner goes on day two to strengthen the agent's trust profile, register WebAuthn credentials, connect OAuth accounts, and configure recovery contacts.
- **Ongoing oversight** — the activity log, escalation queue, connection management, and profile management the owner revisits regularly.

The portal is operated by CELLO (centralized). It is not a protocol-level dependency — agents function without it — but some high-value signals (WebAuthn, LinkedIn, key rotation) are only acquirable through it.

### Session bootstrapping and authentication

Portal sessions are bootstrapped via phone OTP, which links the browser session to the phone number already registered to the agent. This is the same phone number used at agent registration via the WhatsApp/Telegram/WeChat bot.

Authentication levels during a portal session:

- **Phone OTP level** — allows: viewing the activity log, viewing the trust profile self-view, browsing discovery, approving escalated connections, and basic account configuration. Operations at this level are read-heavy or low-risk-write.
- **WebAuthn / TOTP level** — required for all identity-affecting writes: key rotation, phone number change, social verifier add/remove, account deletion, fund withdrawal. A fresh WebAuthn challenge is issued per sensitive operation, not once per session — each high-stakes action requires a new authenticator interaction.

The session token issued after phone OTP is scoped: it permits reading and low-stakes writes, but the backend rejects WebAuthn-required operations presented with only a phone-OTP-level session token regardless of how recent the OTP was.

**[CONFLICT FC-1 — same as server C-1]**: Multiple documents describe phone OTP as happening exclusively in the WhatsApp/Telegram/WeChat bot during initial registration. Other passages describe the portal handling OTP. Whether the portal has a standalone OTP path (so a new user can start from the portal directly) or always operates downstream of prior bot-verified registration is never made explicit. Decision required: can the portal onboard an un-phone-verified user from scratch, or must the user always pass through the WhatsApp/Telegram/WeChat bot first?

**[GAP F-1]**: Portal session lifecycle is not specified. How long does a phone OTP session remain valid? What triggers re-authentication? Does the session step up from phone-OTP to WebAuthn-level for the duration of the session, or does each WebAuthn-required operation issue a fresh challenge even within the same session?

**[GAP F-2]**: The mechanism by which the portal web frontend authenticates itself to the signup portal backend for PII-touching operations is not specified. What credential does the frontend present? How is that credential issued and rotated?

### Registration completion flow

When an agent registers via the WhatsApp/Telegram/WeChat bot, the human owner receives a link to the portal. The portal recognizes the new registration and presents:

1. A summary of what the agent currently has (phone verified, baseline keys issued)
2. The trust enrichment paths available, with an explanation of what each adds and what receiving agents may require
3. A prominent prompt to designate M-of-N recovery contacts (not a hard gate but difficult to skip — see recovery contact designation below)
4. An optional prompt to install the mobile app for device attestation and push-based alerts

The portal must make the connection between trust signals and practical outcomes concrete: the owner must see which connection policy tiers their current trust profile opens and closes. The exact statistics are a product decision and must be derived from real network data — the portal must not display fabricated placeholder numbers.

**[GAP F-3]**: The portal's routing path for a new registration (how does the portal identify that this is a first-time visit vs. a returning owner?) is not specified. The onboarding link from the bot, its format, and its expiry are not specified.

### Trust enrichment flows

Each trust enrichment flow follows the oracle pattern: portal verifies → produces structured JSON record → `SHA-256(json_blob)` → writes hash to directory → delivers raw JSON to client → discards original. The portal retains no trust signal data server-side.

**Async delivery via encrypted pickup queue.** The agent client may not be running — or may not yet be installed — when the human owner completes a trust enrichment flow in the browser. "Returns original JSON to client" cannot be a synchronous handoff; it must be a reliable async delivery. The mechanism:

1. Portal encrypts the JSON blob with the agent's `identity_key` public key (fetched from the directory, always present since bot registration)
2. Portal stores the encrypted blob in an ephemeral pickup queue (portal-side, 30-day TTL) — this is not the signup portal backend PII store; it holds only opaque ciphertext
3. Portal discards the plaintext immediately
4. Directory delivers a `TRUST_SIGNAL_PICKUP_PENDING` notification to the agent at next connection
5. Agent decrypts with its `identity_key`, validates the hash, stores the JSON blob locally, sends ACK
6. Pickup queue entry is deleted on ACK

The `identity_key` is used rather than the signing key (K_local) because K_local can rotate between the time the portal encrypts and the time the agent picks up. The identity key is the stable long-term root and is the correct encryption anchor for deferred delivery.

If the agent does not pick up within 30 days, the encrypted blob is deleted. The hash in the directory becomes an orphaned entry. The agent detects orphaned hashes at next connection and surfaces a "re-verify" prompt. Re-running the OAuth flow creates a fresh blob with a fresh hash, superseding the orphan.

**Portal trust signal state** must distinguish three states (not two):
- **Active** — hash in directory AND agent has ACK'd receipt of the blob
- **Pending delivery** — hash in directory, pickup queue entry exists, no ACK yet
- **Expired / re-verify** — hash in directory, pickup TTL elapsed, no ACK received

**WebAuthn (YubiKey, TouchID, FaceID)**

WebAuthn is an account security signal (phishing-resistant login / tethering), not a Sybil defense. One device can register WebAuthn for many CELLO accounts — this is by design and is not a limitation. The portal must communicate this distinction to the owner so the value proposition (account security, not device sacrifice) is understood. Specifically, the portal must not label WebAuthn as a "device attestation" type — the `attestation_type` enum is `TPM | PLAY_INTEGRITY | APP_ATTEST` only.

Enrollment flow:
1. Portal issues a WebAuthn registration challenge
2. User activates authenticator (hardware key tap or biometric)
3. Browser returns `AuthenticatorAttestationResponse`
4. Portal validates the credential and stores the credential ID + public key in the signup portal backend (not in the directory)
5. Portal produces a trust signal JSON record, hashes it, writes the hash to the directory, returns the blob to the client's local storage

After enrollment, WebAuthn is required for subsequent sensitive operations. The portal must gracefully handle the case where the registered authenticator is unavailable (lost hardware key, new device) by routing to TOTP recovery.

TOTP 2FA must be enrollable alongside WebAuthn as a backup, not as the primary factor. The portal should not allow TOTP as the sole factor for key rotation — it is weaker than WebAuthn and should be positioned as a recovery path.

**TOTP 2FA enrollment**: RFC 6238 (30-second window, 1-step tolerance). Portal generates TOTP secret, encodes as QR code, user scans with authenticator app, portal verifies 6-digit code. Secret discarded after activation; only the hash of the JSON record is stored. Canonical JSON record envelope applies: `{ signal_class, verified_at, verifier, payload, portal_signature }`. TOTP is a fallback for WebAuthn, not a substitute — it does not satisfy WebAuthn-required operations as a primary factor.

**LinkedIn, GitHub, Twitter/X, Facebook, Instagram (OAuth)**

The portal conducts the OAuth flow. For LinkedIn and GitHub, it evaluates connection count, account age, and activity (commits, stars, follower history) at OAuth time using the APIs available at the time of binding. For Twitter/X, Facebook, and Instagram, the evaluation criteria are less specified.

Each OAuth binding:
1. Portal redirects to provider OAuth flow; user grants permissions
2. Portal receives OAuth token and evaluates the account metadata
3. Portal creates a structured JSON record: e.g., `{type: "linkedin", connections: 847, account_age_years: 6, verified_at: "2026-04-16T..."}`
4. Portal hashes the record and the account identifier separately: `SHA-256(json_blob)` and `SHA-256(account_identifier)`
5. Both hashes written to directory; original JSON encrypted with agent's `identity_key` public key and placed in pickup queue; portal discards plaintext immediately
6. **Social account binding lock applied**: 12-month lockout on rebinding after any subsequent unbinding — directory enforces via `social_binding_releases.rebinding_lockout_until`

The portal must visibly communicate the binding lock to the owner before they confirm an OAuth binding.

**Liveness probing**: The portal must periodically require fresh activity (new commit, new LinkedIn post) to maintain verification weight. Purchased dormant accounts must decay. The portal is responsible for initiating these re-checks and updating the trust signal hash when they pass. **Probe interval: 60 days.** On failure: signal marked `VERIFICATION_STALE`. After 3 consecutive failures (180 days): signal marked `UNVERIFIED`, hash updated in directory, agent notified.

**[GAP F-6]**: The exact metadata evaluated for Twitter/X, Facebook, and Instagram is not specified in source documents. LinkedIn and GitHub have clear criteria; the others do not.

**Device attestation routing**

Device attestation is not available from the web portal. The portal's role here is purely routing:

- When the owner visits the trust enrichment section, the portal must clearly explain what device attestation is (Sybil defense; device sacrifice; raises attacker cost to $50–200/device), why it requires a native app, and provide a download link or QR code for the appropriate platform.
- After the owner installs the native app and completes attestation, the portal should reflect the updated trust profile on the next page load.

### Trust signal taxonomy

The portal must display trust signals using the four-class taxonomy — these must appear as distinct named categories, never collapsed into a single score:

- **Class 1 — Identity proofs**: Two sub-classes that must be visually distinguished: (a) *Account security* (WebAuthn — phishing-resistant login, tethering) and (b) *Device sacrifice* (App Attest / Play Integrity / TPM — Sybil defense, native app required). Phone verification, TOTP, OAuth social proofs also in Class 1.
- **Class 2 — Network graph signals**: Endorsement count, conductance-based cluster score, counterparty diversity ratio, temporal anomaly flags. All are named signals displayed as present/absent/value — never aggregated into a score.
- **Class 3 — Track record**: Conversation count, clean-close rate, time on platform.
- **Class 4 — Economic stake**: Bond status, connection staking level.

The portal must never display or reference TrustRank in any form (not as a score, a seed-distance integer, or a "distance to nearest verified node" label). TrustRank is formally deprecated and was never built. The portal must not display or reference Trust Seeders or any "seed-status" badge — the Trust Seeder role is removed from the protocol.

### Account management

The portal handles all sensitive account operations, all of which require WebAuthn or TOTP authentication:

**Key rotation**
1. Owner authenticates with WebAuthn (or TOTP as fallback)
2. Client generates new K_local
3. Portal sends a key rotation request to the signup portal backend, authenticated with the WebAuthn credential
4. Signup portal backend triggers a new K_server_X ceremony across directory nodes
5. New derived public keys published; old public keys marked expired with timestamp
6. Connected agents are notified to refresh their cached key material via a `KEY_ROTATED` notification — distinct from `KEY_ROTATION_RECOMMENDED` (the directory's inbound scheduling nudge to the owner). Note: see **[CONFLICT FC-5]** for the naming conflict; `KEY_ROTATED` is the resolved name for the counterparty-facing type.
7. Portal displays confirmation with the new public key fingerprint and the rotation timestamp

Key rotation must be presented to the owner as a routine security operation — not as an emergency. Since the K_server_X rotation is per-agent (not a network-wide event), the portal must not use alarming language about rotation. The portal should prompt rotation on the schedule recommended in the protocol (not yet specified — **[GAP F-7]**) and not only after a compromise event.

Key rotation must happen at a session boundary. If the owner initiates rotation while active sessions exist, the portal must display a grace period indicator: the old K_server_X epoch (`agent_id:epoch:N` format) remains valid for **7 days** after rotation. The `expires_at` field in the `KEY_ROTATION_RECOMMENDED` notification payload gives the exact hard cutoff. Sessions that seal within the grace window use the old epoch normally; signatures from the old epoch are rejected after the hard cutoff. If any sessions remain open as the cutoff approaches, the portal must surface a clear warning.

**[CONFLICT FC-5 — Resolved]**: `KEY_ROTATION_RECOMMENDED` and `KEY_ROTATED` are now distinct notification types. `KEY_ROTATION_RECOMMENDED` is the directory's inbound scheduling nudge to the owner-agent. `KEY_ROTATED` is the outbound notification sent to counterparty agents after a completed rotation, telling them to refresh cached key material. Gap F-25 is closed.

**Phone number change**

Requires WebAuthn. The new phone number must go through OTP verification before the change commits. The signup portal backend validates the OTP via the WhatsApp/Telegram/WeChat bot integration. Social proofs and WebAuthn credentials are not affected. The old phone number is no longer usable for portal login after the change commits.

**Social verifier add/remove**

Requires WebAuthn. Adding a new verifier follows the OAuth enrichment flow above. Removing a verifier triggers the 12-month rebinding lockout for that account identifier.

**Account deletion**

Requires WebAuthn. Deletion is permanent and irreversible. The portal must present a multi-step confirmation:
1. Explain what is deleted (signup portal PII — phone, WebAuthn credentials, OAuth tokens; active public keys and trust signal entries in the directory index; bios from live directory index — all wiped or tombstoned)
2. Explain what survives (sealed conversation Merkle hashes are not deleted; counterparties' records are not affected)
3. Explain the GDPR implication: any data voluntarily published to a public blockchain ledger cannot be deleted — this consent is permanent
4. Issue a WebAuthn challenge
5. Write a signed tombstone to the directory
6. Wipe the signup portal PII completely (phone, WebAuthn credentials, OAuth tokens)

**[GAP F-8]**: What happens to pending escrow stakes or bonds at the time of deletion is not specified. The escrow model uses two custody paths (DeFi smart contract vs. institutional custodian), each requiring a different instruction to release or return funds before the signup portal PII is wiped. The portal cannot complete deletion until that state is resolved.

**Bio and profile management**

The portal allows the owner to compose and update the agent's bio (public-facing, static, visible to directory browsers). Bio updates are rate-limited to once every **12 hours**.

The portal must display bio change history with timestamps (recorded in the identity Merkle tree). This history is a trust signal — stability matters.

The portal allows the owner to manage per-recipient greetings: contextual messages used at connection request time. Greetings are not on the public profile; different recipients can receive different greetings. Greetings are rate-limited per recipient: **1 per recipient per 7 days** (if ignored or no response); **30 days** if the recipient explicitly declined; **permanent** if the recipient blocked the sender. The maximum number of distinct per-recipient greetings maintainable simultaneously is not yet specified.

**GDPR and data residency**

The portal must display:
- The signup portal jurisdiction (the country in which their PII is stored — PII lives only in the signup portal, not in directory nodes)
- A data classification view showing all three backend tiers:
  - **Signup portal** — PII only (phone, WebAuthn credentials, OAuth tokens). Persistent. Full wipe on deletion.
  - **Directory nodes** — public keys, trust signal hashes, K_server_X shares, identity tree, global MMR, sealed conversation roots. Persistent, federated across all nodes. Tombstone on deletion; hashes remain in append-only log.
  - **Relay nodes** — ephemeral per-session Merkle state only. Destroyed after seal handoff to directory. No persistence beyond the active session; no PII, no key material.
  - **Public ledger** — any data voluntarily committed to an on-chain record. Permanent; cannot be deleted.
- A GDPR consent record: a log of what the owner has voluntarily published (bio, trust signals, public key registrations) with dates and a mechanism to review and withdraw

The portal must provide a bio removal and trust-score erasure request UI. Deletion produces a tombstone entry — not a silent absence. The portal must display the tombstone state after deletion.

The portal must support PII jurisdiction migration (migrating the signup portal deployment to a different region). After migration, the portal must reflect the new jurisdiction.

The portal must surface a permanent-consent warning before any data transitions to a public blockchain ledger, explaining that deletion becomes technically impossible after that point.

### Activity log and audit view

The portal exposes the owner's view of what their agent has been doing. This is a read-only view — no agent activity is initiated here. The portal reads this data from the signup portal backend and directory (via `cello_list_sessions` and `cello_poll_notifications`); it does not store this data independently.

Contents:
- Sessions opened and sealed: timestamp, counterparty agent ID, session duration, seal status, Merkle root value
- FROST events: session establishment challenges (pass/fail), seal ceremonies. FROST occurs only at session establishment and conversation seal — not per message.
- Security events: sanitization-layer trigger events, scan results that were flagged, outbound gate blocks
- Connection request events: received, auto-accepted, auto-declined, escalated to human, pending
- Endorsement events: endorsements received, endorsements issued, endorsements revoked
- System events: directory reachability changes, K_local degraded mode entry/exit, key rotation events
- Anomaly alerts: compromise canary firings, burst activity detections, unusual signing pattern events
- **Notification events**: tombstone notifications (connected identity tombstoned), trust event notifications (connected agent's trust status changed), recovery event notifications (recovered identity re-entering network), session-close attestation dispute notifications, trust signal pickup pending (agent has an encrypted trust signal blob awaiting retrieval from the portal pickup queue). These come from the formal notification type registry; the event stream must support filtering by type.
- Delivery failure security events: hash–message mismatch events (tamper detection), hash-without-message events (permanent delivery gap with hash as evidence of intent)

The activity log is the same data surfaced by `cello_list_sessions` and `cello_poll_notifications` via the MCP tool surface, presented for a human reader.

**[GAP F-9]**: The retention period for the activity log is not specified. Is the full audit trail available in perpetuity, or is there a rolling window? The answer has implications for storage in the signup portal backend.

**[CONFLICT FC-2 — same as server C-6]**: §4.2 of end-to-end-flow states that "bio — visible to anyone browsing the directory — no connection required." §4.1 states "discovery requires an active authenticated session." If there is a public browse mode, the portal's read path for the activity log and profile data needs to distinguish between data that requires authentication and data that is publicly available. Decision required before the portal's API layer can be designed.

### Connection oversight

**Escalation queue**

When the agent's policy includes a `human_escalation_fallback` flag and an incoming connection request reaches PENDING_ESCALATION state, the portal displays the pending request with:
- The requester's agent ID and handle
- The requester's full trust profile as it would appear to the receiving agent (named signals with quality metadata — never a numeric score)
- The greeting text (after Layer 1 sanitization has been applied)
- The alias context note (if the request came in via a named alias the owner created)
- The time remaining before auto-decline fires (the `escalation_expires_at` countdown)
- Accept and Decline actions

Accepting from the portal calls `cello_accept_connection`; declining calls `cello_decline_connection`. The portal appends a `CONNECTION_ESCALATION_RESOLVED` notification to the log.

The portal is the web-based fallback for escalation decisions. The mobile app is the preferred path (push notification → immediate response). Both must produce identical outcomes — the portal and the mobile app are two surfaces into the same decision pathway, not two separate systems.

**Connection history**

The portal displays all connections: accepted, declined, pending, and disconnected. Per connection: counterparty identity, connection date, number of sessions, seal statistics, and current status.

**Whitelist and degraded-mode list configuration**

The portal must support two independently configurable agent lists:

- **Whitelist** — agents that receive preferential treatment during normal directory-available operation (e.g., auto-accept, skip escalation queue)
- **Degraded-mode list** — a shorter, stronger-trust list of agents the owner permits to connect even when the directory is unreachable and FROST authentication is unavailable

These are not the same list. The portal must clearly communicate that whitelist membership does not automatically grant degraded-mode access, and that the degraded-mode list represents a stronger trust statement. Both lists are private — their composition is never surfaced to other agents.

The portal must also display a table showing how inbound agents are handled during degraded mode (accepted with reduced trust / refused — retry when available / refused with final decline) based on whether the inbound agent is on the degraded-mode list, whitelist only, or neither.

**[GAP F-21]**: The whitelist and degraded-mode list configuration UI is not designed in any source document. Specifically: minimum trust signal floor for degraded-mode list membership, UI for adding/removing agents from each list, and whether the lists are managed exclusively in the portal vs. also in the desktop app are not specified.

**Alias management**

The portal is the primary surface for managing contact aliases:
- Create aliases: slug, connection mode (SINGLE / OPEN), context note, per-alias policy override
- View active aliases: alias URI (shareable), connection count, status, context note
- Retire aliases: one-click revocation; portal appends revocation event to directory

The alias URI takes the form `cello:alias/<slug>`. The portal must expose a short-URL resolver so a browser can resolve this to a connection request flow for non-CELLO visitors. **[GAP F-10]**: whether this resolver lives on the portal domain or a separate service is not specified.

Contact aliases have a configurable TTL — default **6 months of inactivity**. A scheduled directory job at each checkpoint marks aliases `EXPIRED` if no session has been initiated through them within the TTL window. The TTL resets on each successful contact through the alias. The portal alias management UI must display each alias's last-contacted timestamp and the time remaining before expiry.

**[GAP F-31]**: The non-CELLO browser visitor flow for the alias short-URL resolver is not designed. Source documents describe alias resolution for CELLO agents calling `cello_initiate_connection` — they do not describe what a browser visitor (non-CELLO) sees when they hit the short URL.

**Policy configuration**

The portal exposes a UI for configuring the agent's `SignalRequirementPolicy`:
- Required signals (named, not numeric)
- Minimum conversation count
- Minimum clean-close rate
- Endorsement count requirements
- Human escalation fallback toggle and escalation timeout
- Auto-accept for already-connected agents
- Six connection acceptance policy modes: Open, Require endorsements, Require introduction, Selective, Guarded, Listed only

Policy is expressed as named signal requirements, never as numeric thresholds. The portal must not expose a raw JSON editor — it must present the policy as structured form fields that prevent the owner from accidentally expressing a numeric-score-based policy.

**Notification filtering configuration**

The portal must expose a notification filtering rule engine:
- Global type rules (e.g., block all "promotional" type notifications)
- Per-sender overrides (a specific agent's notifications override the global type rule)
- Whitelist/blacklist for senders

The precedence must be visually clear (sender override beats global type rule). The owner must be able to set a recipient-side opt-out that overrides any sender's permitted rate limit.

The portal must display each sender agent's notification rate-limit tier and whether they have institutional verification (elevated rate limits). The portal must provide a UI for the owner to apply for institutional verification to obtain elevated rate limits.

### Trust profile self-view

The portal displays the agent's own trust profile exactly as it appears to other agents in the directory — not the raw data, but the verified hash + presence/absence view. This is what `cello_get_trust_profile` returns, displayed for a human reader.

Contents:
- Active signals: displayed by class (Class 1–4), with quality metadata (age, platform, verified_at where applicable). Named signals only — no composite score.
- Missing signals: what is absent, what it would take to add each, what receiving agents commonly require it
- **Who controls each signal** — the portal must make the ownership model visible to the owner: *behavioral signals* (conversation track record, connection history, anomaly flags) are directory-owned and always visible to counterparties — the owner cannot withhold them, and should not be given a UI that implies they can. *Identity and credential signals* (social proofs, WebAuthn, device attestation, endorsements) are client-owned — the owner chooses whether to disclose each one in a given connection request. The portal must not present these as "required fields." It should explain that including them raises acceptance likelihood, and that the choice not to disclose is valid (the owner may have privacy reasons — not revealing WebAuthn enrollment, avoiding LinkedIn farming, not exposing specific endorsers, etc.).
- Connection policy indicator: what an unknown agent sees about this agent's openness to connection
- Conversation statistics: session count, clean-close rate, platform age
- Succession link indicator: if this agent succeeded another identity, a permanently visible succession record showing tombstone type, recovery mechanism, vouching contact identities, declared compromise window, and new public key. This must be displayed to both the owner and counterparties.
- Recovery contact status: a visible "no recovery contacts" indicator when none are designated

**[CONFLICT FC-2 noted above applies here]**: Whether the trust profile self-view reflects a public or private view of the profile depends on the authenticated vs. public browse mode decision.

### Discovery and listing management

The portal exposes read and write access to all three discovery classes:

- **Class 1 (Agent directory)**: Browse agents, search by capability tags and semantic query (BM25, tag/filter, approximate location). View trust signal summaries (named signals only). Generate and share the agent's QR code and handle from a listing. Initiate connection requests (routing to the agent's connection request flow, not directly from the portal).
- **Class 2 (Bulletin board)**: Browse and create ephemeral listings. Set TTL, tags, description, pricing, location. Renew and retire listings.
- **Class 3 (Group rooms)**: Browse rooms, view membership counts, descriptions, and ordering mode (SERIALIZED vs. CONCURRENT). Create rooms (topic, description, tags, room type open/invite-only, dispute eligibility). Room join/leave is an agent operation, not a portal operation.

The portal's discovery view is for the owner to understand the ecosystem, not for the agent to find counterparties. The agent's discovery is via `cello_search`. The portal's discovery surface is especially important for new agents in their incubation period — it must surface agents with open connection policies, Class 2 bulletin listings, and Class 3 group rooms as pathways to build track record organically.

**Incubation period display**

New agents are in an incubation period (7 days, 25 new outbound connections/day limit). The portal must:
- Display an incubation status indicator showing days remaining and daily connection attempts used
- Explain the limit to the owner so they are not confused by connection refusals
- Not suggest the limit is due to an error or policy violation

### Financial UI (later phase)

The portal will support, in a later phase:

- Stablecoin deposit flows for escrow collateral (USDT, USDC, ETH) — framed as opening a yield-bearing account, not as locking up a security deposit
- Fiat on-ramp via institutional partners — the portal UI must route to the partner; CELLO never holds or manages cash
- Connection stake configuration for agents that opt into institutional defense
- Bond creation and management: commitment terms, bond amount, oracle type selection, expiry, counterparty selection
- Delegation market: view delegation offers, accept/reject, display delegated capital liability
- Per-asset yield display: mechanism (ETH → PoS staking yield; USDT/USDC → money market), cumulative yield earned, CELLO's share, withdraw-yield-independently action
- Lock period countdown for bonds and Sybil defense stakes (30-day minimum)
- Escrow release/forfeiture outcome per session-close attestation (CLEAN → stake returned; FLAGGED → stake held for arbitration)
- Oracle proof submission for disputes: upload timestamped, GPS-tagged photo or video as delivery/arrival proof for a disputed or pending bond

The portal must never hold or manage cash. All payment flows route through a compliant custodian.

**[GAP F-36]**: Delegation/lending market UI is not specified. No source document defines whether the portal surfaces third-party delegation offers, how the owner reviews and accepts delegated capital, or how delegated-stake liability is displayed.

**[GAP F-37]**: Yield display mechanics are not specified. No document defines how the portal shows cumulative yield earned vs. CELLO's share, or whether yield can be withdrawn independently of principal.

**[GAP F-38]**: The oracle proof capture flow (GPS + camera + timestamp) is a native mobile capability but has not been assigned to a rollout phase.

### Recovery contact designation

The portal should make designation of M-of-N recovery contacts prominent and difficult to skip at registration time. Specifically:

- After the initial registration completion flow, the portal should present recovery contact designation as a step with its own screen, not a footnote in settings.
- The owner must be able to search for contacts by agent handle, invite by alias URI, or paste an agent ID.
- Contacts must meet a minimum trust signal floor: **≥2 social bindings each older than 2 years AND WebAuthn or device attestation active; not currently in incubation.** Phone-only accounts cannot serve as recovery contacts.
- The portal shows whether each designated contact has the required signals.
- An agent without any recovery contacts must display a visible indicator in its trust profile — the directory enforces this; the portal must communicate it clearly.

The portal also supports:
- Viewing and updating the recovery contact list
- Configuring the M-of-N threshold (configurable at registration)
- Creating and viewing the succession package (encrypted blob for the designated successor — the portal handles the encryption client-side using the successor's `identity_key`; the portal must never handle the plaintext seed phrase). **[GAP F-39]**: the portal must defend against XSS access to the in-page plaintext during encryption; the specific ceremony (Web Crypto API vs. WASM) and how the portal obtains the successor's `identity_key` are not specified.

### Succession and ownership transfer

The portal exposes a separate successor designation: a specific CELLO identity to whom the agent's identity, track record, and succession package will transfer. This is distinct from recovery contacts (who attest the owner is permanently unavailable) — a single person can hold both roles, but the roles are separate.

**Voluntary ownership transfer** (WebAuthn required):
1. Old owner initiates transfer from portal — announces it to connected agents (7–14 day announcement period)
2. During the announcement period: old owner can cancel from the portal; the portal must display a cancellation action prominently
3. New owner authenticates via their own portal session to accept the transfer
4. Transfer completes; succession link is recorded in the directory's identity Merkle tree
5. Old identity's connections can see the succession link and choose to reconnect with the new identity

**[GAP F-32]**: Portal UI for contesting an incoming succession claim filed by a third party is not designed. The succession log specifies that the directory notifies the owner and recovery contacts via external channels when a claim is filed, and the owner can contest — but the portal screen for doing so does not exist.

**[GAP F-33]**: The announcement period management UI (cancel action, 7–14 day countdown display) is not designed.

**[GAP F-34]**: The new owner's authentication flow for accepting an ownership transfer is not specified. The portal must support the receiving side of the handshake.

### Endorsement management

The activity log displays endorsement events (received, issued, revoked). The portal must:
- Show the endorsement count on the trust profile self-view as a discretionary signal (the owner may withhold specific endorser identities while sharing the count)
- Reflect revocation notifications from the directory in the activity log

**[GAP F-35]**: Endorsement request management UI is not specified. The MCP tool surface document explicitly lists `cello_request_endorsement` and `cello_revoke_endorsement` as missing from the 33-tool surface. The portal has no specified UI for: requesting endorsements from contacts, reviewing incoming endorsement requests, or bootstrapping endorsements when creating a second agent.

### What the portal does NOT do

- It does not display message content. The portal is a protocol event viewer, not a chat client. Conversation Merkle roots are shown as hash values, not decoded transcripts. Content viewing is available only via the companion device connection in the mobile app or desktop app.
- It does not run the CELLO client. The MCP server, P2P transport, and Merkle tree operations are entirely separate from the portal.
- It does not perform device attestation. TPM, App Attest, and Play Integrity are native-only. The portal routes users to the native app for attestation and reflects the result once it arrives.
- It does not directly send messages or connection requests on behalf of the agent. All agent operations go through the MCP tool surface. The portal can surface the agent's queue and let the owner approve/decline, but it does not initiate protocol events on its own.

### Security boundary

The portal is a high-value target. Its security posture must reflect this:

- All portal-to-home-node communication must be TLS with certificate pinning
- WebAuthn challenges must be origin-bound; the browser's WebAuthn implementation enforces this by design
- CSRF protection is required on all state-mutating endpoints
- The portal must enforce a strict Content Security Policy that prevents exfiltration of in-page data
- OAuth callback endpoints must validate the `state` parameter rigorously; an OAuth CSRF attack could bind an attacker's social account to a victim's agent identity
- The portal must never log OAuth tokens or WebAuthn credential material, even in error logs
- Trust signal JSON blobs must only be transmitted to the client — never stored in portal logs or error monitoring systems

---

## Surface 2: Agent Dashboard

The Agent Dashboard is not a separate deployed product. It lives in the same web application as the portal, accessible to the same logged-in owner. The distinction is that the portal handles identity setup and account management (operations that happen rarely), while the dashboard handles ongoing oversight (what the owner checks regularly).

### Sessions overview

The sessions view must support both two-party and multi-party (group) conversations. The multi-party attestation schema supersedes the two-party schema — the two-party case is the degenerate case of a multi-party conversation with two participants.

Session close types (complete set):
- **MUTUAL_SEAL** — both parties (or all participants) signed the final Merkle root
- **SEAL_UNILATERAL** — one party closed without the other's acknowledgment
- **EXPIRE** — session expired without explicit close
- **ABORT** — session aborted; reason code and timestamp displayed
- **REOPEN** — a previously sealed session was reopened

Per-participant attestation states (complete set):
- **CLEAN** — participant attested no issues
- **FLAGGED** — participant flagged the session for dispute
- **PENDING** — attestation not yet submitted
- **DELIVERED** — transport-confirmed receipt with no output (distinct from ABSENT)
- **ABSENT** — connection dropped; no delivery confirmation

For group conversations, the dashboard displays a per-participant attestation table (one row per participant) rather than a single pair of party_a / party_b attestation values.

The Merkle root values are displayed as truncated hex (first 8 bytes) with copy-to-clipboard for the full value. They are not decoded or explained beyond "this is the tamper-proof fingerprint of this conversation."

**[CONFLICT FC-7]**: The "Submit to arbitration" trigger condition cannot rely on a conversation-level FLAGGED flag in multi-party conversations, because the FLAGGED state is now per-participant. An action must be available when any participant's individual attestation is FLAGGED, not only when a conversation-level flag is set. Resolution required before the dispute submission UI can be implemented.

A FLAGGED individual attestation is highlighted. If the owner wants to submit the session to arbitration, the dashboard provides a "Submit to arbitration" action (see Dispute Submission in Cross-Surface Flows below). If the flag is not submitted within **7 days**, it expires automatically with no consequence to either party. The dashboard must display the 7-day countdown on any open FLAGGED attestation and confirm expiry when the deadline passes. Note: if the same agent flags and abandons more than 3 sessions in a rolling 90-day window, that pattern is recorded in the flagger's own trust profile as a behavioral signal.

Session details additionally show:
- Ordering mode for group conversations (SERIALIZED vs. CONCURRENT)
- Session channel type (libp2p P2P vs. platform transport: Slack/Discord/Telegram)
- Seal mode (bilateral-only vs. notarized-FROST seal)
- Whether seal notarization is PENDING (directory was unavailable at seal time; FROST ceremony deferred until directory recovers)
- For aborted sessions: abort reason code and timestamp

**[GAP F-26]**: The DELIVERED-to-ABSENT transition timeout in group conversations is not specified. Until resolved, the dashboard cannot accurately display participant state.

### Notifications and event stream

A chronological event stream showing all notification types from `cello_poll_notifications`. Types derived from the formal notification type registry:

- Security blocks (Layer 1 sanitization fires): what triggered it, from which session
- Endorsements received, issued, and revoked
- Connection events (accepted, declined, escalation resolved)
- System events: directory reachability changes, K_local degraded mode
- Key rotation events
- Anomaly alerts (these are also sent to phone — the dashboard shows the same events)
- Tombstone notifications: a connected identity has been tombstoned
- Trust event notifications: a connected agent's trust status has changed
- Recovery event notifications: a recovered identity is re-entering the network
- Session-close attestation dispute notifications: a counterparty has filed a dispute against a session
- Trust signal pickup pending: the agent has an encrypted trust signal blob awaiting retrieval; links to the relevant signal in the trust enrichment UI
- Peer compromised abort (`PEER_COMPROMISED_ABORT`): a connected agent's owner has declared a compromise; the active session with that agent has been unilaterally sealed
- Relay session reassigned: the relay node handling an active session failed; the directory has assigned a new relay and the session has resumed from the last confirmed sequence number

The event stream is filterable by type. Each event links to its relevant context in the portal (a security block links to the session; an endorsement links to the endorser's trust profile).

**[GAP F-27]**: The notification delivery path (P2P vs. directory-routed) is not specified. The portal's notification display depends on which backend component delivers notification payloads. **[GAP F-28]**: The home-node API surface for notification payloads to the portal (distinct from the agent-facing MCP tool surface) is not specified.

### What the dashboard does NOT do

- It does not display message content. Conversation content is only accessible via the companion device connection in the mobile app or desktop app — never through the web portal.
- It does not allow the owner to read or reply to messages through the portal. Human injection into conversations is only available via the companion device connection.
- It is not a control panel for the agent's real-time decisions — those are handled by the agent's policy configuration (set via the portal's connection oversight section) or by human escalation through the push notification path.

---

## Surface 3: Mobile App

### What it is and why it exists

The mobile app serves three capabilities that the web portal cannot provide:

1. **Device attestation** (Apple ecosystem: iOS and macOS via App Attest / Secure Enclave; Android: Play Integrity API). The browser cannot access `DCAppAttestService`. A signed native app is required.
2. **Push-based escalation and alerts**. The alert channel must be independent from agent infrastructure — if the agent is compromised, it cannot intercept alerts sent through it. Out-of-band push via a native app provides this independence. On iOS, persistent background push notifications require native APIs not available to PWAs.
3. **Companion device connection** — a direct P2P connection to the owner's CELLO client via libp2p, enabling conversation content viewing and human injection into agent conversations. See the Companion Device Connection subsection below.

The mobile app is not a full portal replica. For everything except device attestation, push-based responses, and companion device content viewing, the owner uses the web portal. The mobile app is an oversight, security response, and conversation visibility tool.

The existing WhatsApp/Telegram/WeChat escalation channel (configured via `cello_configure`) is the Phase 1 out-of-band path before the mobile app exists. The mobile app adds a native push path alongside it, not replacing it.

**[CONFLICT FC-3]**: Whether the native push path and the WhatsApp/Telegram/WeChat path must both be configured, or whether the mobile app supersedes the WhatsApp/Telegram/WeChat channel once installed, is not specified. They must produce the same outcomes (same `CONNECTION_ESCALATION_RESOLVED` notification), but whether they are redundant paths or a primary/fallback hierarchy is not decided. Decision required.

### Device attestation enrollment

First-time enrollment:
1. Owner downloads the mobile app and logs in via phone OTP (same phone number as the registered agent)
2. App calls the platform attestation API (`DCAppAttestService` on iOS, `PlayIntegrityAPI` on Android)
3. App generates an attestation and submits it to the signup portal backend
4. Signup portal backend verifies the attestation with the platform authority (Apple/Google), extracts the stable device identifier, checks it against the directory for uniqueness (one active binding per device hash)
5. If unique: binding confirmed; device hash written to directory; trust signal hash updated
6. If already bound to another account: enrollment rejected; owner must release existing binding first

Re-attestation: Platform attestation credentials have a validity period. The app must handle background re-attestation before expiry without requiring owner interaction. If re-attestation fails (device replaced, account locked on platform), the app must notify the owner and prompt a new enrollment.

**Device replacement**: The old attestation binding must be released before the new device can be enrolled. The release requires WebAuthn authentication (web portal or the app on the old device if still available). If the old device is permanently lost, social recovery or a directed dispute with the directory is the path — the exact protocol for this case is not specified. **[GAP F-12]**

The mobile app must distinguish WebAuthn (account security / tethering) from App Attest (device sacrifice) in its UI and onboarding. They are separate enrollment flows with separate trust signal implications.

### Push-based escalation approvals

When an incoming connection request reaches PENDING_ESCALATION state, the directory sends a push notification to the owner's registered device via the app's push token:

Notification payload (displayed in lock-screen preview):
- Requester handle (truncated)
- Top two trust signals present (named signals — never a numeric score)
- "Accept or decline — expires in N minutes"

Full view (after unlock):
- Complete trust profile (named signals with quality metadata)
- Greeting text (after Layer 1 sanitization)
- Alias context (if the request came in via a named alias the owner created)
- Accept button / Decline button / "View in portal" link

The app must handle the case where the owner taps the notification but then takes no action (escalation TTL expires) — display a clear "Auto-declined — timeout" status and remove the pending card from the queue.

**[GAP F-13]**: The push notification token provisioning and rotation mechanism is not specified. How does the directory learn the device's push token? How is the token updated when the OS rotates it? How is it revoked when the owner logs out of the app?

### Emergency revocation ("Not Me")

The "Not Me" flow is optimized for speed. When the owner believes their agent is compromised:

1. The owner taps a prominently placed "Not Me / Emergency" action — accessible from the app's home screen without navigating menus
2. The app re-authenticates with phone OTP (phone OTP is sufficient for revocation — WebAuthn is required only for the re-keying step that follows)
3. The app sends a signed revocation request to the signup portal backend
4. The signup portal backend immediately instructs the directory to burn the K_server_X shares (blocking new FROST sessions) and fires two parallel abort paths:
   - Sends an `EMERGENCY_SESSION_ABORT` control message to the agent client via its authenticated WebSocket — the client aborts all active P2P sessions, sends signed ABORT leaves with `COMPROMISE_INITIATED` reason code, and disconnects
   - Sends `PEER_COMPROMISED_ABORT` notifications directly to every counterparty of active sessions via their authenticated WebSockets — counterparties seal unilaterally on receipt, regardless of whether an ABORT leaf arrives from the compromised side
5. The app displays confirmation: "Agent locked. All active conversations have been closed. Visit the portal to re-key."

The confirmation screen must make clear that **all active sessions are terminated immediately** — not just future sessions. The owner must not be left with the impression that ongoing conversations are unaffected.

The re-keying step (issuing new K_local and K_server_X) requires WebAuthn and is done via the web portal or the app's WebAuthn path. The "Not Me" flow deliberately does not proceed to re-keying in one step — the owner needs to be at a trusted device with their authenticator in hand, which may not be true at the moment of emergency revocation.

### Security alerts

The app receives push notifications for all anomaly events the directory has flagged for this agent:
- `FROST_SESSION_FAILURE` (compromise canary — urgent; breaks through Do Not Disturb)
- `UNUSUAL_SIGNING_PATTERN` (urgent; breaks through Do Not Disturb)
- `BURST_ACTIVITY` (warning)
- `ATYPICAL_HOURS` (informational unless combined with other signals)
- `WIDESPREAD_REJECTION_PATTERN` (warning)
- `K_LOCAL_DEGRADED_MODE` (informational — directory unreachable; existing sessions continue because relay nodes handle active sessions independently; new session establishment is blocked)
- `KEY_ROTATION_RECOMMENDED` (scheduled maintenance — directory nudging the agent to rotate K_local)
- Tombstone notifications, trust event notifications, recovery event notifications (same as event stream)
- Bond/escrow alerts: approaching lock expiry, stake slashing events (FLAGGED session close), oracle proof deadline reminders — at OS-alert level

The app displays these in a prioritized alert list. Urgent alerts (FROST failure, unusual signing) use OS-level alerts that break through Do Not Disturb.

### Succession alerts

When a succession claim is filed against the owner's agent, the directory notifies the owner via configured external channels (WhatsApp/Telegram/WeChat, independent of the CELLO client). The mobile app must also receive and surface this as an urgent push notification so the owner can immediately authenticate to contest.

### WebAuthn on mobile

TouchID and FaceID can serve as WebAuthn authenticators on iOS. The app must support WebAuthn operations for the operations that require it (key rotation, social verifier changes) so the owner can perform them from the mobile app without needing a desktop browser session. The app uses the `ASWebAuthenticationSession` / `WKWebView` + WebAuthn flow to authenticate to the signup portal backend.

### Companion device connection

The mobile app connects directly to the owner's CELLO client via libp2p P2P — the same transport infrastructure used for agent-to-agent connections. The directory facilitates NAT traversal (hole-punching) for the companion device the same way it does for agent sessions. The directory sees "companion device D wants to reach CELLO client for owner X" — it facilitates the connection, then steps out. Content flows directly over P2P. The directory never sees it.

The companion connection operates on a separate channel from push notifications:

- **Content channel — pull only, foreground only.** Established only when the app is open and in the foreground. The user opens the app, libp2p dials the CELLO client, fetches a session metadata list, and taps a session to fetch that session's content on demand. If the CELLO client is unreachable (laptop off, VPS down), the app displays "unable to reach client" — nothing more. No caching, no background sync.
- **Notification channel — push, background.** APNs / FCM. Unchanged from the existing push notification design. Push payloads never carry conversation content.

**Human injection.** The owner can type a message into an active conversation. The message goes to the owner's CELLO client via the P2P content channel, which delivers it to the agent as a special input: "your owner wants this in the conversation." What happens next is the agent's decision — pass it verbatim, wrap it with context, use it as an instruction, or ignore it. The other agent(s) in the conversation never know a human was involved. The human injection is not in the Merkle tree and is not part of the protocol record.

**Agent-requests-human-input.** The agent can request owner input mid-conversation via `cello_request_human_input` (a new MCP tool). The client asks the directory to send a push notification to the companion device — no content, just a knock. The owner receives a push notification ("Your agent is requesting input"), opens the app, sees the conversation context via the content channel, and responds. Alternatively, the agent can reach the owner via WhatsApp/Telegram/WeChat directly.

**Authentication.** The companion device does not use FROST — it is not an agent session. A keypair is generated at app install time, bound to the owner via phone OTP verification (same phone number as the registered agent). The CELLO client maintains an allowlist of authorized companion device public keys. Only registered companion devices can connect.

**Local persistence.** Conversation content viewed through the companion app is fetched on demand from the CELLO client's local SQLCipher database. The client's local log is a superset of the Merkle record — it contains both protocol messages (which have a `merkle_leaf_hash`) and local-only events (human injections, agent-requested-input events, which have `merkle_leaf_hash = null`). The companion app reads from this log; it does not maintain its own copy.

**[GAP F-43]**: The companion device registration flow — how the owner's companion device public key is provisioned to the CELLO client's allowlist during app install — is not fully specified. Whether this uses the same enrollment path as device attestation or a separate registration ceremony is not decided.

**[GAP F-44]**: The libp2p implementation technology for the mobile app is constrained by the same decision as **[GAP F-14]**. `go-libp2p` via `gomobile` is the most battle-tested path for iOS/Android; `rust-libp2p` is viable but requires more FFI. React Native cannot access App Attest natively, which already pushes toward native — and native also simplifies libp2p integration.

### What the mobile app does NOT do

- It does not run the CELLO client (MCP server). The client is a separate process managed by the agent's runtime environment.
- It does not replace the web portal for full account management. Complex operations (OAuth binding, recovery contact management, succession package creation) are portal-only until the app matures.
- It does not store trust signal JSON blobs or conversation records. Conversation content is fetched on demand from the CELLO client via the companion P2P connection and is not persisted on the phone.

### Platform variants

| Platform | Attestation mechanism | Push mechanism | WebAuthn |
|---|---|---|---|
| iOS | App Attest (DCAppAttestService, Secure Enclave) | APNs (Apple Push Notification Service) | Face ID / Touch ID (platform authenticator) |
| Android | Google Play Integrity API | FCM (Firebase Cloud Messaging) | Fingerprint / face (platform authenticator) |

**[GAP F-14]**: React Native vs. Swift/Kotlin native — the implementation technology for the mobile app is not specified and has significant implications for the attestation API integration (App Attest requires native Swift; Play Integrity requires native Kotlin or a thin JNI layer).

**[GAP F-15]**: The handling of iPadOS is not specified. iPad supports App Attest (same as iPhone). Whether iPadOS is a supported platform is not stated.

---

## Surface 4: Desktop App

### What it is and why it exists

The desktop app serves three capabilities that neither the web portal nor the mobile app provides:

1. **TPM attestation on Windows** and **Secure Enclave attestation on macOS** for agents deployed on desktop or server hardware. An agent running on a Windows machine owned by a real person can carry the owner's device attestation even if the agent itself runs on a cloud VPS — the attestation is about the owner's hardware, not the deployment environment.
2. **Local MCP server management** — starting, stopping, updating, and monitoring the CELLO client process running on the owner's machine.
3. **Companion device connection** — the same P2P companion connection as the mobile app, providing conversation content viewing and human injection. On the desktop, the CELLO client is often running on the same machine, making the connection trivial (localhost).

The desktop app is the thinnest of the three surfaces. It does not replicate portal functionality. For everything except attestation and local server management, the owner uses the web portal.

### TPM attestation flow

**Windows (TPM 2.0)**

1. Owner installs the desktop app and logs in via phone OTP
2. App accesses the TPM via the Windows TPM Base Services (TBS) API
3. App generates an attestation quote using the TPM's Endorsement Key (EK) — globally unique per chip
4. App submits the EK-based attestation to the signup portal backend
5. Signup portal backend verifies the attestation, extracts the stable device identifier (EK hash), checks uniqueness
6. If unique: binding confirmed; trust signal hash updated in directory

**macOS (Secure Enclave via App Attest)**

macOS App Attest is the same mechanism as iOS App Attest — available to native macOS apps with the App Attest entitlement. The desktop app on macOS follows the same enrollment flow as the iOS mobile app.

**Linux / VPS / server agents**

No native device sacrifice is available. Server agents sit at the base trust level and are filtered by receiving agents with stricter connection policies. The desktop app is not installed on server environments. This is acceptable by design — device attestation is about the *owner's* hardware, and a fully automated agent with no human owner cannot sacrifice a device.

### Local MCP server management

The desktop app provides a management interface for the locally-running CELLO client:

- **Start / stop / restart** the MCP server process
- **View server status**: directory reachability, active P2P peers, active sessions, pending notifications, K_local_only mode — the same data returned by `cello_status`. The status must distinguish two qualitatively different states: "directory unreachable — relay nodes are handling active sessions; new sessions blocked" vs. "agent locked — all sessions closed, re-keying required"
- **View server logs**: recent MCP server output for troubleshooting
- **Update the server**: when a new CELLO client version is available, the desktop app handles the download, hash verification (SHA-256 pinned to the npm package signature), and process restart
- **Configuration**: scan sensitivity, P2P bootstrap nodes, escalation channels, directory fallback behavior — a GUI layer over the settings that `cello_configure` manages programmatically

The desktop app does not replace the MCP server — it manages it. The agent still calls MCP tools directly; the desktop app is a management surface, not a proxy.

**[GAP F-16]**: The auto-update mechanism for the desktop app itself (the management layer, not the MCP server) is not specified.

### System tray / menubar presence

**Deferred — far future scope.** The system tray / menubar icon is not part of the current desktop app design. Emergency revocation ("Not Me") is handled via the mobile app (Phase 2) or web portal (Phase 1). The desktop app's Phase 3 scope is limited to device attestation, local MCP server management, and companion device content viewing.

When the system tray is eventually implemented, the intended design is: tray icon with green/yellow/red ambient status, left-click to open status dashboard, right-click quick menu. The "Not Me / Emergency" shortcut in the tray menu is explicitly excluded from Phase 3 — it depends on the tray existing and on resolving the full "Not Me" flow for desktop, which has not been designed.

### Relationship to the web portal

The desktop app is not a portal replacement. Navigation from the desktop app always points at the web portal for operations beyond server management and attestation. The app's UI should make this boundary obvious.

### Companion device connection

The desktop app uses the same companion P2P connection as the mobile app (see Surface 3 for the full design). When the CELLO client runs on the same machine, the connection is localhost — no NAT traversal needed. When the client runs on a remote VPS, the directory facilitates hole-punching identically to the mobile app path.

The desktop app's companion connection supports the same capabilities: session list viewing, on-demand content fetching, human injection, and agent-requested-input responses. The authentication model is the same: a keypair generated at install, bound via phone OTP, registered in the client's companion device allowlist.

The desktop app is the natural primary surface for companion device content viewing when the agent runs locally — the machine is already on, the client is already reachable, and the connection is trivial.

### What the desktop app does NOT do

- It is not a full account management surface. OAuth flows, recovery contact management, key rotation confirmation, and dispute submission all open the web portal.
- It does not operate as a proxy between the agent and the CELLO client — the agent calls MCP tools directly.

### Platform variants

| Platform | Attestation | Notes |
|---|---|---|
| macOS | App Attest (Secure Enclave) | Same mechanism as iOS app; requires notarized native app with App Attest entitlement |
| Windows | TPM 2.0 via TBS API | Requires TPM chip present; most post-2016 business hardware has TPM 2.0 |
| Linux | None | No device sacrifice available; app may still be useful for local server management without attestation |

**[GAP F-17]**: Whether a Linux version of the desktop app is in scope is not specified. Linux is mentioned as a deployment environment for agents but not as a target for the native app.

---

## Cross-Surface Flows

These flows span multiple surfaces. Each is described once here to prevent the same flow appearing with different details in different sections.

### Registration and first-use

1. Agent registers via WhatsApp/Telegram/WeChat bot — phone OTP, K_local and K_server_X generated, agent listed in directory
2. Bot sends the owner a link to the web portal
3. Owner opens the portal, logs in via phone OTP (bootstrapping the web session from the bot-verified phone number)
4. Portal presents the registration completion flow: current trust signals, available enrichment paths, recovery contact prompt
5. Owner completes desired enrichment steps (WebAuthn, OAuth, etc.)
6. Owner optionally installs the mobile app — portal shows QR code / download link
7. Mobile app: owner logs in, optionally completes device attestation enrollment
8. Owner optionally installs the desktop app for TPM attestation or server management
9. During mobile or desktop app install: companion device keypair generated, registered with the CELLO client's allowlist via phone OTP verification

### Companion device content viewing

1. Owner opens the mobile app or desktop app
2. App establishes a libp2p P2P connection to the owner's CELLO client (directory facilitates NAT traversal if needed; localhost if client is on the same machine)
3. App authenticates with its registered companion device keypair
4. App fetches session metadata list from the client's local SQLCipher database (small, always loads)
5. Owner taps a session → app fetches that session's full content log on demand
6. Content log includes both protocol messages (with `merkle_leaf_hash`) and local-only events (human injections, with `merkle_leaf_hash = null`)
7. Owner closes app → P2P connection drops, no content persisted on the companion device
8. If the CELLO client is unreachable: app displays "unable to reach client" — nothing more

### Human injection into conversations

1. Owner opens the mobile app or desktop app and views an active conversation via the companion connection
2. Owner types a message
3. App sends the message to the CELLO client via the P2P content channel: `send_human_injection(session_id, content)`
4. Client delivers it to the agent as a special input: "your owner wants this in the conversation"
5. Agent decides what to do: pass it verbatim, wrap it with context, use it as an instruction, or ignore it
6. Whatever the agent sends to the other agent is what enters the Merkle tree — the human injection itself is never in the protocol record
7. The client's local log records the human injection as a `human_injected` entry with `merkle_leaf_hash = null`
8. The other agent(s) in the conversation have no visibility into the injection

### Agent requests human input

1. Agent calls `cello_request_human_input` (MCP tool) during a conversation
2. Client asks the directory to send a push notification to the companion device — no content, just a knock
3. Owner receives a push notification: "Your agent is requesting input"
4. Owner opens the app → companion P2P connection established → conversation context visible
5. Owner types a response → sent to client via `send_human_injection(session_id, content)`
6. Agent receives the response and decides how to use it
7. Alternatively, the agent can reach the owner directly via WhatsApp/Telegram/WeChat without using `cello_request_human_input`

### Key rotation

1. Owner opens the web portal (or mobile app WebAuthn path)
2. Initiates key rotation from account management
3. Portal issues a WebAuthn challenge; owner taps hardware key or biometric
4. Client generates new K_local (at the next session boundary)
5. Portal sends key rotation request to signup portal backend (authenticated with WebAuthn response)
6. Signup portal backend triggers new K_server_X ceremony across directory nodes
7. New public keys published; old keys marked expired; connected agents receive a `KEY_ROTATED` notification telling them to refresh cached key material
8. Portal shows confirmation: new key fingerprint, rotation timestamp
9. Desktop app shows a brief "Keys rotated" status update (system tray notification deferred — far future)

### Compromise detection and "Not Me"

1. Directory detects anomaly event (e.g., FROST session establishment failure from unexpected source)
2. Directory pushes push notification to mobile app AND sends message to WhatsApp/Telegram/WeChat (parallel paths — **[see Conflict FC-3]** for their relationship)
3. Owner receives push notification
4. Owner taps "Not Me / Emergency" in mobile app
5. App re-authenticates with phone OTP
6. App sends revocation request to signup portal backend; signup portal backend instructs directory to simultaneously:
   - Burns K_server_X shares (no new FROST sessions possible)
   - Sends `EMERGENCY_SESSION_ABORT` to the agent client via its authenticated WebSocket — client aborts all active sessions and disconnects
   - Sends `PEER_COMPROMISED_ABORT` to all counterparties of active sessions via their authenticated WebSockets — counterparties seal unilaterally
7. App displays: "Agent locked. All active conversations have been closed. Visit the portal to re-key."
8. Owner opens portal (on desktop/laptop, at a trusted device with their YubiKey or biometric authenticator)
9. Owner authenticates with WebAuthn
10. Owner generates new K_local; portal triggers new K_server_X ceremony
11. New keys published; old keys marked expired

### Human escalation for connection requests

1. Agent receives incoming connection request
2. Agent evaluates request against configured `SignalRequirementPolicy`
3. If `human_escalation_fallback` is set and the request does not produce a clear accept/reject: request transitions to PENDING_ESCALATION
4. Two parallel notifications fire:
   - Push notification to mobile app (if installed and registered)
   - Message to WhatsApp/Telegram/WeChat escalation channel (always configured as fallback)
5. Owner reviews the request in either the mobile app (push notification card) or the web portal (escalation queue)
6. Owner taps Accept or Decline
7. The decision is submitted to the signup portal backend, which calls `cello_accept_connection` or `cello_decline_connection`
8. A `CONNECTION_ESCALATION_RESOLVED` notification is appended to the log
9. If the `escalation_expires_at` TTL passes with no response: the request auto-declines; owner sees "Auto-declined — timeout" in the dashboard

### Social recovery

This flow is primarily handled at the protocol level between the signup portal backend, directory, and recovery contacts. The frontend's role:

1. Owner is locked out (WebAuthn unavailable, phone lost or SIM-swapped)
2. Owner contacts M-of-N pre-designated recovery contacts out-of-band
3. Each recovery contact opens the portal and navigates to "Vouch for recovery"
4. Recovery contact authenticates with their own WebAuthn and signs a recovery attestation for the locked-out account
5. When M-of-N threshold is met, the directory records the recovery threshold reached
6. 48-hour mandatory waiting period begins — the old key can contest during this window. The portal must surface a "contest recovery" action for any session holding the old key.
7. After 48 hours: owner can open the portal with a new device, authenticate with the new phone (or with a surviving second factor), and initiate a new K_local + K_server_X ceremony
8. Portal displays the vouching contact identities and the declared compromise window for the owner to review

Post-recovery, the portal must display:
- The formal recovery event in the trust profile (permanently visible): tombstone type, recovery mechanism, vouching agent identities, declared compromise window (start/end timestamps), new public key
- Post-recovery trust treatment: key-dependent signals (WebAuthn, device attestation) must be re-verified from scratch; key-independent signals (social bindings) restored on fresh OAuth; track record and endorsements preserved
- **Probationary period progress**: track record history is visible but carries reduced weight until **3 months AND 200 clean conversations** post-recovery are both completed. The portal must display a probationary status indicator showing progress toward both conditions.
- Voucher accountability status for recovery contacts: 90-day liability window, lockout indicator if triggered

**[GAP F-18]**: The portal UI for a recovery contact vouching on behalf of another agent is not designed. Specifically: how does the recovery contact navigate to the vouch screen? Is there a URL from the directory, a manual agent ID entry, or a QR code flow?

**Social carry-forward** (post-recovery): Previously-connected agents can choose to reconnect with the recovered identity. The portal must support a carry-forward re-connection flow, allowing the owner to reach out to their prior network. No source document designs this UI — it is a gap.

### Dispute submission

1. Owner views a FLAGGED individual attestation in the dashboard (**[see Conflict FC-7]** for the trigger condition in multi-party conversations)
2. Owner clicks "Submit to arbitration"
3. Portal asks the owner to confirm: submitting to arbitration is public to the counterparty (their full transcript copy will be compared against the submitted copy)
4. Owner confirms
5. Portal fetches the partial Merkle proof for this session from the directory (the sealed Merkle root plus the path proving inclusion in the MMR). For multi-party conversations, this must use the multi-party attestation table format.
6. Portal submits the proof to the directory's dispute arbitration endpoint (multiple independent arbitrating nodes must agree — the portal must not submit to a single-node endpoint)
7. Dashboard shows the session status as "PENDING_ARBITRATION"
8. When a verdict is issued (DISMISSED / UPHELD / ESCALATED), the dashboard reflects the outcome and any trust signal impact

**[GAP F-19]**: The dispute submission UX beyond step 6 is not designed. Specifically: how does the owner provide the conversation transcript? Does the portal only submit the Merkle proof (and the directory reconstructs the transcript from its own records), or does the client need to submit the full message content? If message content is submitted, this is the only moment in the protocol where content passes through infrastructure — it requires explicit design justification.

---

## Auth Model

Operations are listed in ascending order of required authentication strength. The "Surface" column shows which frontend surfaces can complete the operation.

| Operation | Auth required | Web portal | Mobile app | Desktop app |
|---|---|---|---|---|
| View trust profile (own) | Phone OTP | ✓ | ✓ (limited) | — |
| View activity log | Phone OTP | ✓ | — | — |
| Browse discovery | Phone OTP | ✓ | — | — |
| Approve escalated connection | Phone OTP | ✓ (queue) | ✓ (push) | — |
| Emergency revocation ("Not me") | Phone OTP | ✓ | ✓ | — (tray shortcut deferred) |
| View sessions and seal status | Phone OTP | ✓ | — | — |
| Manage contact aliases | Phone OTP | ✓ | — | — |
| Manage discovery listings | Phone OTP | ✓ | — | — |
| Configure connection policy | Phone OTP | ✓ | — | — |
| Designate recovery contacts | Phone OTP | ✓ | — | — |
| View succession package status | Phone OTP | ✓ | — | — |
| Submit to arbitration | Phone OTP | ✓ | — | — |
| Configure whitelist / degraded-mode list | Phone OTP | ✓ | — | — |
| Configure notification filtering | Phone OTP | ✓ | — | — |
| Key rotation | WebAuthn / TOTP | ✓ | ✓ (biometric) | — |
| Change registered phone number | WebAuthn / TOTP | ✓ | ✓ (biometric) | — |
| Add / remove social verifiers | WebAuthn / TOTP | ✓ | — | — |
| Account deletion | WebAuthn / TOTP | ✓ | — | — |
| Fund withdrawal | WebAuthn / TOTP | ✓ | — | — |
| Create succession package | WebAuthn / TOTP | ✓ | — | — |
| Voluntary ownership transfer (initiator) | WebAuthn / TOTP | ✓ | — | — |
| Voluntary ownership transfer (acceptor) | WebAuthn / TOTP | ✓ | — | — |
| Device attestation enrollment | Phone OTP + native app | — | ✓ | ✓ |
| Companion device: view session list | Companion keypair (phone OTP at install) | — | ✓ | ✓ |
| Companion device: view conversation content | Companion keypair (phone OTP at install) | — | ✓ | ✓ |
| Companion device: human injection | Companion keypair (phone OTP at install) | — | ✓ | ✓ |
| Local MCP server management | Phone OTP (app-level) | — | — | ✓ |

Note: TOTP is accepted as a fallback where WebAuthn is required, but it is weaker. The portal should present WebAuthn as primary and TOTP as the fallback for users who have lost their WebAuthn authenticator.

---

## Platform Capability Map

The consistency check. A capability that appears in a requirement but has no surface that supports it is a gap.

| Capability | Web portal | Mobile app | Desktop app |
|---|---|---|---|
| WebAuthn (hardware key, YubiKey) | ✓ (browser WebAuthn API) | — | — |
| WebAuthn (biometric — TouchID/FaceID) | ✓ (platform authenticator in browser) | ✓ (native biometric) | ✓ (macOS Secure Enclave in browser) |
| TOTP 2FA | ✓ | ✓ (authenticator app on device — **note: security concern, see F-20**) | ✓ |
| App Attest (iOS / macOS) | — | ✓ (iOS) | ✓ (macOS) |
| Play Integrity (Android) | — | ✓ (Android) | — |
| TPM attestation (Windows) | — | — | ✓ (Windows) |
| Native push notifications | — | ✓ | ✓ (system tray + OS notification) |
| Out-of-band escalation | ✓ (WhatsApp/Telegram/WeChat fallback, configured separately) | ✓ | ✓ |
| OAuth flows (LinkedIn, GitHub, etc.) | ✓ | ✓ (in-app browser / native OAuth SDK) | — |
| Merkle proof export | ✓ | — | — |
| Dispute submission | ✓ | — | — |
| Local MCP server management | — | — | ✓ |
| Companion P2P content viewing | — | ✓ (libp2p, foreground only) | ✓ (libp2p, localhost or remote) |
| Human injection into conversations | — | ✓ (via companion connection) | ✓ (via companion connection) |
| System tray / ambient status | — | ✓ (notification badges) | ✓ (tray icon) |
| Escalation approval | ✓ (queue) | ✓ (push) | — |
| "Not Me" emergency revocation | ✓ | ✓ | — (tray shortcut deferred) |
| Recovery contact vouching | ✓ | — | — |
| Succession package creation | ✓ | — | — |
| Alias short-URL resolution | ✓ (resolver on portal domain — **[see F-10, F-31]**) | — | — |
| Discovery browse | ✓ | — | — |
| Activity log | ✓ | — (push notifications only) | — |
| Financial UI | ✓ (later phase) | ✓ (read-only balance + alerts) | — |
| Oracle proof capture (GPS+camera) | — | ✓ (native, phase TBD — **[see F-38]**) | — |
| Notification filtering configuration | ✓ | — | — |
| Whitelist/degraded-mode list configuration | ✓ | — | — |
| GDPR consent record / data classification | ✓ | — | — |

**[GAP F-20]**: Using TOTP on the same mobile device that is receiving push notifications and managing the agent introduces a security concern: if the device is compromised, both the TOTP seed and the push channel are in the same attack envelope. The design documents do not address this. A decision on whether TOTP is permitted as a factor on the same device as the mobile app is needed.

---

## Surface Rollout

| Phase | What ships | What is deferred |
|---|---|---|
| Phase 1 | Web portal: registration completion, WebAuthn enrollment, OAuth flows, key rotation, activity log, connection oversight, escalation queue (web-based), policy configuration, alias management, notification filtering configuration, GDPR/data residency display, whitelist/degraded-mode list management | Mobile app, desktop app |
| Phase 1 | WhatsApp/Telegram/WeChat as the only out-of-band escalation path | Native push via mobile app |
| Phase 2 | Mobile app: device attestation (iOS/Android), push-based escalation, "Not Me" shortcut, security alerts, succession claim alerts, companion device content viewing and human injection | Desktop app, TPM attestation, oracle proof capture |
| Phase 3 | Desktop app: TPM attestation (Windows), macOS Secure Enclave via App Attest, local MCP server management, companion device content viewing and human injection | Financial UI, oracle proof capture, system tray (far future) |
| Phase 3+ | Financial UI (stablecoin deposits, fiat on-ramp, stake configuration, bond management, delegation market, yield display) | Oracle proof capture (phase TBD) |

In Phase 1, escalation approvals are web-based: the WhatsApp/Telegram/WeChat message directs the owner to the portal's escalation queue. The native push path (mobile app) is additive in Phase 2 and should be designed to be fully redundant with the Phase 1 path.

In Phase 1, the desktop app's server management features are replaced by CLI tooling (`cello-server start|stop|status`). The desktop app wraps these operations in a GUI.

---

## Conflicts Requiring Resolution

**FC-1: Portal/bot boundary for phone OTP**
- Position A: Phone OTP happens exclusively in the WhatsApp/Telegram/WeChat bot; the portal always operates downstream of an already-verified phone number. The portal login flow assumes a bot-registered agent exists and bootstraps from it.
- Position B: The portal also supports a standalone OTP path, allowing an owner to register entirely through the browser without installing WhatsApp or Telegram.
- The decision affects: whether the portal needs its own OTP delivery mechanism, whether bot registration is mandatory, and whether the portal's onboarding flow can be self-contained.
- This is the same as server infrastructure Conflict C-1, but the frontend must resolve it before the portal's registration flow can be implemented.

**FC-2: Bio public access vs. authenticated discovery — Resolved**
- **Two-tier access model**: Class 1 profiles (bio, capability tags, approximate location, pricing signal, connection policy indicator, anonymous trust score) are publicly browsable without authentication. Search, browse, and Class 3 room listing are also publicly accessible. Authentication gates only protocol operations (connection requests, trust signal relay, FROST ceremonies).
- The portal must expose a public browse tier: anyone can search and view Class 1 profiles without a CELLO account. The alias short-URL resolver shows the target's bio, handle, and agent type to unauthenticated visitors, plus a "connect with CELLO" CTA.
- Joining a Class 3 room requires an authenticated session; browsing available rooms does not.
- This closes F-31 in part: the alias resolver CTA design for non-CELLO visitors is now specified at the concept level. Detailed UX for the CTA flow remains a gap.

**FC-3: Native push vs. WhatsApp/Telegram/WeChat escalation relationship**
- Position A: The mobile app push path and the WhatsApp/Telegram/WeChat path are parallel, redundant channels. Both fire for every escalation event. The owner can respond via either.
- Position B: The mobile app push path supersedes the WhatsApp/Telegram/WeChat path once the app is installed. The WhatsApp/Telegram/WeChat channel is only used when the app is not installed.
- The decision affects: whether both channels must produce consistent state when both fire; whether double-response (both paths responding) is possible and what happens; and how the owner configures the escalation channel after installing the app.

**FC-4: "Not Me" scope for existing sessions — Resolved**
- **Position B is correct**: all active sessions receive SEAL-UNILATERAL immediately on "Not Me". No session continues after the owner declares a compromise.
- K_server revocation alone cannot close existing P2P sessions; two parallel abort paths are required. See [[2026-04-17_1100_not-me-session-termination|"Not Me" Session Termination]] for the full mechanism (`EMERGENCY_SESSION_ABORT` to the agent client; `PEER_COMPROMISED_ABORT` to counterparties).
- The confirmation screen must state: "All active conversations have been closed."
- §8.3 ("existing K_local-signed sessions remain valid") is superseded and must not be referenced anywhere.

**FC-5: `KEY_ROTATION_RECOMMENDED` dual meaning**
- Definition A (key-rotation-design.md): The directory's inbound scheduling nudge to the owner-agent to rotate K_local. This is an informational/maintenance-class alert received by the agent.
- Definition B (used in earlier versions of this document): An outbound notification sent to counterparty agents after a completed K_local rotation, telling them to refresh their cached key material.
- **Resolved**: the counterparty-facing notification is named `KEY_ROTATED`. `KEY_ROTATION_RECOMMENDED` is reserved exclusively for the inbound scheduling nudge. This also closes Gap F-25.

**FC-7: "Submit to arbitration" trigger condition in multi-party context**
- Position A (implied by earlier FLAGGED-seal framing): The "Submit to arbitration" action triggers when a conversation's seal state is FLAGGED.
- Position B (implied by per-participant attestation model): FLAGGED is now a per-participant state, not a conversation-level state. An action must be available when any participant's individual attestation is FLAGGED.
- Decision required: what triggers the arbitration button in a multi-party conversation where some participants attest CLEAN and others attest FLAGGED?

---

## Gaps Requiring Decisions

| ID | Surface | Gap |
|---|---|---|
| F-1 | Portal | Portal session lifecycle not specified: session duration, step-up auth mechanics, fresh-challenge-per-operation vs. session-level upgrade |
| F-2 | Portal | Portal-to-home-node authentication mechanism not specified: what credential does the portal present for PII operations? |
| F-3 | Portal | Onboarding link from bot: format, expiry, and portal-side mechanism for recognizing first-time vs. returning visit |
| ~~F-4~~ | Portal | ~~Closed~~ — RFC 6238 TOTP (30-sec window, 1-step tolerance); QR code enrollment; canonical JSON record envelope: `signal_class`, `verified_at`, `verifier`, `payload`, `portal_signature`. Secret discarded after activation. |
| ~~F-5~~ | Portal | ~~Closed~~ — 60-day probe interval. Failure → `VERIFICATION_STALE`. 3 consecutive failures (180 days) → `UNVERIFIED`, hash updated in directory, agent notified. |
| F-6 | Portal | Metadata evaluation criteria for Twitter/X, Facebook, Instagram OAuth not specified |
| F-7 | Portal | Recommended key rotation schedule (the interval at which the portal should prompt the owner) not specified |
| F-8 | Portal | Handling of pending escrow stakes or bonds at account deletion time not specified; two distinct custody paths (DeFi smart contract vs. institutional custodian) each require a different instruction to release funds before signup portal PII wipe |
| F-9 | Portal | Retention period for the activity log not specified |
| F-10 | Portal | Alias short-URL resolver: whether it lives on the portal domain or a separate service not specified |
| ~~F-11~~ | Portal | ~~Closed~~ — ≥2 social bindings each >2 years old AND WebAuthn or device attestation active; not in incubation. Phone-only accounts cannot serve as recovery contacts. |
| F-12 | Mobile | Protocol for releasing an attestation binding when the original device is permanently lost not specified |
| F-13 | Mobile | Push notification token provisioning, rotation, and revocation mechanism not specified |
| F-14 | Mobile | Implementation technology (React Native vs. Swift/Kotlin native) not specified; App Attest integration requires native Swift |
| F-15 | Mobile | iPadOS support not specified |
| F-16 | Desktop | Auto-update mechanism for the desktop app management layer not specified |
| F-17 | Desktop | Whether a Linux version of the desktop app is in scope not specified |
| F-18 | Recovery flow | Portal UI for a recovery contact vouching on behalf of a locked-out account not designed: navigation path (URL from directory, manual agent ID entry, or QR code) not specified |
| F-19 | Dispute flow | **Partially resolved**: arbitration design (G-27) confirms content IS sent to external frontier models (Tier 2 inference panel) — privacy disclosure required at submission. Remaining open: the specific portal UI for the disclosure acknowledgment screen and how the client packages the transcript for submission. |
| F-20 | Mobile / Auth | Whether TOTP is permitted as a factor on the same device as the mobile app (creates an attack envelope concern) not addressed |
| F-21 | Portal | Whitelist vs. degraded-mode list configuration UI not designed: minimum trust signal floor for degraded-mode list, UI for add/remove, whether both lists are managed in portal only or also in desktop app |
| ~~F-22~~ | Portal | ~~Closed~~ — 12-hour cooldown. Portal must disable the bio edit button and display time remaining until cooldown expires. |
| F-23 | Portal | Greeting rate limits now specified: 1 per recipient per 7 days; 30 days after explicit decline; permanent on block. **Still open**: maximum number of distinct per-recipient greetings maintainable simultaneously not specified. |
| ~~F-24~~ | Portal | ~~Closed~~ — Epoch ID format: `agent_id:epoch:N`. Grace period: 7 days. Hard cutoff after grace. `expires_at` in `KEY_ROTATION_RECOMMENDED` payload. Portal must display countdown to hard cutoff if sessions remain open. |
| ~~F-25~~ | Portal | ~~Closed~~ — counterparty-facing key refresh notification named `KEY_ROTATED`; see FC-5 resolution above |
| F-26 | Dashboard | DELIVERED-to-ABSENT transition timeout in group conversations not specified; portal cannot accurately display participant state without this |
| ~~F-27~~ | Dashboard | ~~Retired~~ — two delivery paths resolved: directory WebSocket pushes system/protocol events to the agent; client-to-companion P2P delivers owner-targeted notifications. The portal receives events via the directory WebSocket path (same as the agent). See AC-16 / G-32. |
| F-28 | Portal | Home-node API surface for notification payloads to the portal (distinct from agent-facing MCP tool surface) not specified |
| F-29 | Mobile | Oracle proof capture (GPS + camera + timestamp) for bond/escrow disputes is a native mobile capability; rollout phase not assigned |
| ~~F-30~~ | Portal | ~~Closed~~ — Default TTL: 6 months inactivity. Checkpoint job marks EXPIRED. TTL resets on each successful contact through the alias. Portal must show last-contacted timestamp and time remaining before expiry. |
| F-31 | Portal | Non-CELLO browser visitor flow for the alias short-URL resolver not designed; source documents describe resolution only for CELLO agents calling `cello_initiate_connection` |
| F-32 | Portal | Succession claim portal UI not designed: how the owner sees and contests an incoming succession claim filed by a third party |
| F-33 | Portal | Ownership transfer announcement period UI not designed: cancel action, 7–14 day countdown display, what connected agents see |
| F-34 | Portal | New owner's authentication flow for accepting an ownership transfer not specified |
| F-35 | Portal | Endorsement request management UI not specified; `cello_request_endorsement` and `cello_revoke_endorsement` are explicitly listed as missing from the MCP tool surface |
| F-36 | Portal | Delegation/lending market UI not specified. **Blocked by G-36 deferral**: financial infrastructure is out of scope for initial launch. |
| F-37 | Portal | Yield display mechanics not specified. **Blocked by G-36 deferral**: financial infrastructure is out of scope for initial launch. |
| F-38 | Mobile | Oracle data flow now specified (G-40): oracle verifies → hash stored → original discarded; client holds original and presents to arbitration. Native capture implementation and rollout phase assignment still open. |
| F-39 | Portal | Succession package creation ceremony security not specified: how portal obtains successor's `identity_key`, browser-level security during in-page plaintext encryption, Web Crypto API vs. WASM choice |
| F-40 | Portal | False-positive appeal initiation UI not designed: when an activity log entry shows a Layer 2/3 scan block, the portal screen for initiating an LLM arbiter appeal (distinct from the general dispute submission flow) is not specified |
| F-41 | Portal | Portal web security policy has no source document in the vault. CSP, CSRF, OAuth-token no-log, and trust-signal-blob no-log requirements are stated in this document but are not validated by any protocol review or security policy document. A dedicated portal web security spec is needed. |
| ~~F-42~~ | Portal | ~~Closed~~ — FROST thresholds are: Alpha ~4-of-6; Consortium ~11-of-20; Public rotating ~5-of-7; minimum at any phase 3-of-5 across different jurisdictions/cloud providers. Portal must use these values, not 2-of-3. |
| F-43 | Mobile / Desktop | Companion device registration flow not fully specified: how the companion device public key is provisioned to the CELLO client's allowlist during app install; whether this uses the same path as device attestation or a separate ceremony |
| F-44 | Mobile | libp2p implementation technology for the mobile app constrained by the same decision as F-14; `go-libp2p` via `gomobile` is the most battle-tested path; native app requirement from App Attest simplifies libp2p integration |
| F-45 | Dashboard | Relay failure recovery is not surfaced as a user-visible event. When a relay node fails mid-session the directory reassigns the session to a new relay; the portal/app should show a `RELAY_SESSION_REASSIGNED` system event in the activity log so the owner can see that a disruption occurred and was recovered. The notification type and payload are not yet specified. |

---

## Related Documents

- [[protocol-map|CELLO Protocol Map]]
- [[server-infrastructure|CELLO Server Infrastructure Requirements]]
- [[end-to-end-flow|CELLO End-to-End Protocol Flow]]
- [[cello-design|CELLO Design Document]]
- [[2026-04-13_1000_device-attestation-reexamination|Device Attestation Reexamination]]
- [[2026-04-08_1800_account-compromise-and-recovery|Account Compromise and Recovery]]
- [[2026-04-14_1100_cello-mcp-server-tool-surface|CELLO MCP Server Tool Surface]]
- [[2026-04-14_1000_contact-alias-design|Contact Alias Design]]
- [[2026-04-13_1200_discovery-system-design|Discovery System Design]]
- [[2026-04-14_0700_agent-succession-and-ownership-transfer|Agent Succession and Ownership Transfer]]
- [[2026-04-15_1100_key-rotation-design|Key Rotation Design]]
- [[2026-04-15_0900_session-level-frost-signing|Session-Level FROST Signing]]
- [[2026-04-11_1700_persistence-layer-design|Persistence Layer Design]]
- [[2026-04-13_1500_multi-party-conversation-design|Multi-Party Conversation Design]]
- [[2026-04-08_1830_notification-message-type|Notification Message Type]]
- [[2026-04-08_1530_message-delivery-and-termination|Message Delivery and Termination]]
- [[2026-04-14_1500_deprecate-trust-seeders-and-trustrank|Deprecate Trust Seeders and TrustRank]]
- [[2026-04-11_1400_security-architecture-layers-and-trust-signal-classes|Security Architecture Layers and Trust Signal Classes]]
- [[2026-04-08_1600_data-residency-and-compliance|Data Residency and Compliance]]
- [[2026-04-10_1100_fallback-downgrade-attack-defense|Fallback and Downgrade Attack Defense]]
- [[2026-04-10_1000_connection-endorsements-and-attestations|Connection Endorsements and Attestations]]
- [[2026-04-14_1300_connection-request-flow-and-trust-relay|Connection Request Flow and Trust Relay]]
- [[open-decisions|Open Decisions]]
- [[design-problems|Design Problems]]
- [[2026-04-16_1400_companion-device-architecture|Companion Device Architecture]] — designs the P2P companion connection for mobile/desktop content viewing and human injection into agent conversations
- [[agent-client|CELLO Agent Client Requirements]] — the locally-running client that the frontend surfaces manage; the portal and apps are the human-owner layer; the client is the protocol layer they interact with via the companion device API and MCP tool surface
- [[2026-04-17_1000_trust-signal-pickup-queue|Trust Signal Pickup Queue]] — designs the async oracle handoff: encrypted pickup queue using identity_key, TRUST_SIGNAL_PICKUP_PENDING notification type, three-state trust signal UI (active / pending delivery / expired)
- [[2026-04-17_1100_not-me-session-termination|"Not Me" Session Termination]] — resolves FC-4; dual-path forced abort mechanism (EMERGENCY_SESSION_ABORT to agent client, PEER_COMPROMISED_ABORT to counterparties) that closes existing P2P sessions K_server revocation cannot reach
- [[2026-04-17_1400_directory-relay-architecture-reassessment|Directory/Relay Architecture Reassessment]] — relay nodes as session-level Merkle engines; directory dormant during active sessions; relay failure recovery flow; data classification split between signup portal / directory / relay
