---
name: CELLO Frontend Requirements
type: design
date: 2026-04-16
topics: [identity, trust, WebAuthn, device-attestation, key-management, recovery, notifications, discovery, connection-policy, contact-aliases, compliance, onboarding, session-termination, MCP-tools]
status: active
description: Complete requirements for the human-owner frontend surfaces — web portal, mobile app, and desktop app — synthesized from all design documents and discussion logs. Includes all conflicts requiring resolution and all identified gaps.
---

# CELLO Frontend Requirements

## System Boundary

The CELLO client (the MCP server, P2P transport, local key material, Merkle tree operations, and prompt injection layers) is the agent-facing layer. It runs alongside the agent and requires no human involvement during normal operation. The frontend is the human-owner layer. It exists because some things an agent fundamentally cannot do: perform WebAuthn ceremonies, respond to out-of-band security alerts, approve escalated connection decisions, or designate recovery contacts. The protocol is designed so that humans are only in the loop for high-stakes operations — not routine agent activity.

The content invariant holds everywhere in this document: the frontend never handles, displays, or stores message content. It is a protocol event viewer and identity management surface. An agent could technically receive web portal credentials and call the portal APIs, but every sensitive operation is gated behind WebAuthn or biometric specifically to require a physically-present human.

The three frontend surfaces are:

| Surface | Role | Required from |
|---|---|---|
| **Web Portal** | Identity verification, trust enrichment, key management, escalation review, account oversight | Day one |
| **Mobile App** | Device attestation (Apple ecosystem), push-based escalation, emergency revocation | Phase two |
| **Desktop App** | Device attestation (Windows/TPM), local MCP server management, system tray presence | Phase three |

The portal communicates with two backend components: the **home node** (for PII-touching operations: WebAuthn credentials, OAuth tokens, K_server_X operations) and the **directory** (for public reads: trust signal hashes, Merkle proofs, discovery). The distinction is critical — the portal must route identity-sensitive calls only to the home node and must never send PII to replicated directory state.

---

## Surface 1: Web Portal

### What it is

The web portal is the universal entry point for human owners. It is accessible from any browser. It covers two distinct use modes that share the same web application:

- **Onboarding / setup** — where the human owner goes on day two to strengthen the agent's trust profile, register WebAuthn credentials, connect OAuth accounts, and configure recovery contacts.
- **Ongoing oversight** — the activity log, escalation queue, connection management, and profile management the owner revisits regularly.

The portal is operated by CELLO (centralized). It is not a protocol-level dependency — agents function without it — but some high-value signals (WebAuthn, LinkedIn, key rotation) are only acquirable through it.

### Session bootstrapping and authentication

Portal sessions are bootstrapped via phone OTP, which links the browser session to the phone number already registered to the agent. This is the same phone number used at agent registration via the WhatsApp/Telegram bot.

Authentication levels during a portal session:

- **Phone OTP level** — allows: viewing the activity log, viewing the trust profile self-view, browsing discovery, approving escalated connections, and basic account configuration. Operations at this level are read-heavy or low-risk-write.
- **WebAuthn / TOTP level** — required for all identity-affecting writes: key rotation, phone number change, social verifier add/remove, account deletion, fund withdrawal. A fresh WebAuthn challenge is issued per sensitive operation, not once per session — each high-stakes action requires a new authenticator interaction.

The session token issued after phone OTP is scoped: it permits reading and low-stakes writes, but the backend rejects WebAuthn-required operations presented with only a phone-OTP-level session token regardless of how recent the OTP was.

**[CONFLICT FC-1 — same as server C-1]**: Multiple documents describe phone OTP as happening exclusively in the WhatsApp/Telegram bot during initial registration. Other passages describe the portal handling OTP. Whether the portal has a standalone OTP path (so a new user can start from the portal directly) or always operates downstream of prior bot-verified registration is never made explicit. Decision required: can the portal onboard an un-phone-verified user from scratch, or must the user always pass through the WhatsApp/Telegram bot first?

**[GAP F-1]**: Portal session lifecycle is not specified. How long does a phone OTP session remain valid? What triggers re-authentication? Does the session step up from phone-OTP to WebAuthn-level for the duration of the session, or does each WebAuthn-required operation issue a fresh challenge even within the same session?

**[GAP F-2]**: The mechanism by which the portal authenticates itself to the home node for PII-touching operations is not specified. What credential does the portal present to the home node? How is that credential issued and rotated?

### Registration completion flow

When an agent registers via the WhatsApp/Telegram bot, the human owner receives a link to the portal. The portal recognizes the new registration and presents:

1. A summary of what the agent currently has (phone verified, baseline keys issued)
2. The trust enrichment paths available, with an explanation of what each adds and what receiving agents may require
3. A prominent prompt to designate M-of-N recovery contacts (not a hard gate but difficult to skip — see recovery contact designation below)
4. An optional prompt to install the mobile app for device attestation and push-based alerts

The portal must make the connection between trust signals and practical outcomes concrete: "agents with WebAuthn can connect to 87% of listed services; phone-only agents can connect to 42%." The exact statistics are not specified and are a product decision, but the concept — showing the owner what their current trust profile opens and closes — is a design requirement.

**[GAP F-3]**: The portal's routing path for a new registration (how does the portal identify that this is a first-time visit vs. a returning owner?) is not specified. The onboarding link from the bot, its format, and its expiry are not specified.

### Trust enrichment flows

Each trust enrichment flow follows the oracle pattern: portal verifies → produces structured JSON record → `SHA-256(json_blob)` → writes hash to directory → returns original JSON to client → discards original. The portal retains no trust signal data server-side.

**WebAuthn (YubiKey, TouchID, FaceID)**

WebAuthn is an account security signal (phishing-resistant login / tethering), not a Sybil defense. One device can register WebAuthn for many CELLO accounts — this is by design and is not a limitation. The portal must communicate this to the owner so the value proposition (account security, not device sacrifice) is understood.

Enrollment flow:
1. Portal issues a WebAuthn registration challenge
2. User activates authenticator (hardware key tap or biometric)
3. Browser returns `AuthenticatorAttestationResponse`
4. Portal validates the credential and stores the credential ID + public key on the home node
5. Portal produces a trust signal JSON record, hashes it, writes the hash to the directory, returns the blob to the client's local storage

After enrollment, WebAuthn is required for subsequent sensitive operations. The portal must gracefully handle the case where the registered authenticator is unavailable (lost hardware key, new device) by routing to TOTP recovery.

TOTP 2FA must be enrollable alongside WebAuthn as a backup, not as the primary factor. The portal should not allow TOTP as the sole factor for key rotation — it is weaker than WebAuthn and should be positioned as a recovery path.

**[GAP F-4]**: TOTP enrollment mechanics are not specified. How is the TOTP secret generated? Where is it stored (home node? client-side only?)? The JSON record schema for TOTP as a trust signal is not defined.

**LinkedIn, GitHub, Twitter/X, Facebook, Instagram (OAuth)**

The portal conducts the OAuth flow. For LinkedIn and GitHub, it evaluates connection count, account age, and activity (commits, stars, follower history) at OAuth time using the APIs available at the time of binding. For Twitter/X, Facebook, and Instagram, the evaluation criteria are less specified.

Each OAuth binding:
1. Portal redirects to provider OAuth flow; user grants permissions
2. Portal receives OAuth token and evaluates the account metadata
3. Portal creates a structured JSON record: e.g., `{type: "linkedin", connections: 847, account_age_years: 6, verified_at: "2026-04-16T..."}`
4. Portal hashes the record and the account identifier separately: `SHA-256(json_blob)` and `SHA-256(account_identifier)`
5. Both hashes written to directory; original JSON returned to client; portal discards everything
6. **Social account binding lock applied**: 12-month lockout on rebinding after any subsequent unbinding — directory enforces via `social_binding_releases.rebinding_lockout_until`

The portal must visibly communicate the binding lock to the owner before they confirm an OAuth binding.

**Liveness probing**: The portal must periodically require fresh activity (new commit, new LinkedIn post) to maintain verification weight. Purchased dormant accounts must decay. The portal is responsible for initiating these re-checks and updating the trust signal hash when they pass. The polling interval is not specified. **[GAP F-5]**

**[GAP F-6]**: The exact metadata evaluated for Twitter/X, Facebook, and Instagram is not specified in source documents. LinkedIn and GitHub have clear criteria; the others do not.

**Device attestation routing**

Device attestation is not available from the web portal. The portal's role here is purely routing:

- When the owner visits the trust enrichment section, the portal must clearly explain what device attestation is (Sybil defense; device sacrifice; raises attacker cost to $50–200/device), why it requires a native app, and provide a download link or QR code for the appropriate platform.
- After the owner installs the native app and completes attestation, the portal should reflect the updated trust profile on the next page load.

### Account management

The portal handles all sensitive account operations, all of which require WebAuthn or TOTP authentication:

**Key rotation**
1. Owner authenticates with WebAuthn (or TOTP as fallback)
2. Client generates new K_local
3. Portal sends a key rotation request to the home node, authenticated with the WebAuthn credential
4. Home node triggers a new K_server_X ceremony across directory nodes
5. New derived public keys published; old public keys marked expired with timestamp
6. All agents that cached old keys are notified to refresh via `KEY_ROTATION_RECOMMENDED` notification
7. Portal displays confirmation with the new public key fingerprint and the rotation timestamp

Key rotation must be presented to the owner as a routine security operation. The portal should suggest it on the schedule recommended in the protocol (not yet specified — **[GAP F-7]**) and not only after a compromise event.

**Phone number change**

Requires WebAuthn. The new phone number must go through OTP verification before the change commits. The home node validates the OTP via the WhatsApp/Telegram bot integration. Social proofs and WebAuthn credentials are not affected. The old phone number is no longer usable for portal login after the change commits.

**Social verifier add/remove**

Requires WebAuthn. Adding a new verifier follows the OAuth enrichment flow above. Removing a verifier triggers the 12-month rebinding lockout for that account identifier.

**Account deletion**

Requires WebAuthn. Deletion is permanent and irreversible. The portal must present a multi-step confirmation:
1. Explain what is deleted (home node PII, active public keys, active trust signal entries, bios from live directory index — all wiped or tombstoned)
2. Explain what survives (sealed conversation Merkle hashes are not deleted; counterparties' records are not affected)
3. Issue a WebAuthn challenge
4. Write a signed tombstone to the directory
5. Wipe the home node PII completely

**[GAP F-8]**: What happens to pending escrow stakes or bonds at the time of deletion is not specified.

### Activity log and audit view

The portal exposes the owner's view of what their agent has been doing. This is a read-only view — no agent activity is initiated here.

Contents:
- Sessions opened and sealed: timestamp, counterparty agent ID, session duration, seal status (CLEAN / FLAGGED / PENDING), Merkle root value
- FROST events: session establishment challenges (pass/fail), seal ceremonies
- Security events: Layer 1 trigger events (sanitization fired), Layer 2 scan results that were flagged, Layer 3 outbound gate blocks
- Connection request events: received, auto-accepted, auto-declined, escalated to human, pending
- Endorsement events: endorsements received, endorsements issued, endorsements revoked
- System events: directory reachability changes, K_local degraded mode entry/exit, key rotation events
- Anomaly alerts: compromise canary firings, burst activity detections, unusual signing pattern events

The activity log is the same data surfaced by `cello_list_sessions` and `cello_poll_notifications` via the MCP tool surface, presented for a human reader. The portal does not store this data independently — it reads it from the home node and directory.

**[GAP F-9]**: The retention period for the activity log is not specified. Is the full audit trail available in perpetuity, or is there a rolling window? The answer has implications for storage at the home node.

**[CONFLICT FC-2 — same as server C-6]**: §4.2 of end-to-end-flow states that "bio — visible to anyone browsing the directory — no connection required." §4.1 states "discovery requires an active authenticated session." If there is a public browse mode, the portal's read path for the activity log and profile data needs to distinguish between data that requires authentication and data that is publicly available. Decision required before the portal's API layer can be designed.

### Connection oversight

**Escalation queue**

When the agent's policy includes a `human_escalation_fallback` flag and an incoming connection request reaches PENDING_ESCALATION state, the portal displays the pending request with:
- The requester's agent ID and handle
- The requester's full trust profile as it would appear to the receiving agent (signals present, quality metadata)
- The greeting text (after Layer 1 sanitization has been applied)
- The time remaining before auto-decline fires (the `escalation_expires_at` countdown)
- Accept and Decline actions

Accepting from the portal calls `cello_accept_connection`; declining calls `cello_decline_connection`. The portal appends a `CONNECTION_ESCALATION_RESOLVED` notification to the log.

The portal is the web-based fallback for escalation decisions. The mobile app is the preferred path (push notification → immediate response). Both must produce identical outcomes — the portal and the mobile app are two surfaces into the same decision pathway, not two separate systems.

**Connection history**

The portal displays all connections: accepted, declined, pending, and disconnected. Per connection: counterparty identity, connection date, number of sessions, seal statistics, and current status.

**Alias management**

The portal is the primary surface for managing contact aliases:
- Create aliases: slug, connection mode (SINGLE / OPEN), context note, per-alias policy override
- View active aliases: alias URI (shareable), connection count, status, context note
- Retire aliases: one-click revocation; portal appends revocation event to directory

The alias URI takes the form `cello:alias/<slug>`. The portal must expose a short-URL resolver so a browser can resolve this to a connection request flow for the (non-CELLO) recipient. Whether this resolver lives on the portal domain or a separate service is not specified. **[GAP F-10]**

**Policy configuration**

The portal exposes a UI for configuring the agent's `SignalRequirementPolicy`:
- Required signals (named, not numeric)
- Minimum conversation count
- Minimum clean-close rate
- Endorsement count requirements
- Human escalation fallback toggle and escalation timeout
- Auto-accept for already-connected agents

Policy is expressed as named signal requirements, never as numeric thresholds. The portal must not expose a raw JSON editor — it must present the policy as structured form fields that prevent the owner from accidentally expressing a numeric-score-based policy.

### Trust profile self-view

The portal displays the agent's own trust profile exactly as it appears to other agents in the directory — not the raw data, but the verified hash + presence/absence view. This is what `cello_get_trust_profile` returns, displayed for a human reader.

Contents:
- Active signals: what is present, quality metadata (age, platform, verified_at where applicable)
- Missing signals: what is absent, what it would take to add each, what receiving agents commonly require it
- Connection policy indicator: what an unknown agent sees about this agent's openness to connection
- Conversation statistics: session count, clean-close rate, platform age

**[CONFLICT FC-2 noted above applies here]**: Whether the trust profile self-view reflects a public or private view of the profile depends on the authenticated vs. public browse mode decision.

### Discovery and listing management

The portal exposes read and write access to all three discovery classes:

- **Class 1 (Agent directory)**: Browse agents, search by capability tags and semantic query. View trust signal summaries. Initiate connection requests (routing to the agent's connection request flow, not directly from the portal).
- **Class 2 (Bulletin board)**: Browse and create ephemeral listings. Set TTL, tags, description, pricing, location. Renew and retire listings.
- **Class 3 (Group rooms)**: Browse rooms, view membership counts and descriptions. Create rooms. Room join/leave is an agent operation, not a portal operation.

The portal's discovery view is for the owner to understand the ecosystem, not for the agent to find counterparties. The agent's discovery is via `cello_search`.

### Financial UI (later phase)

The portal will support, in a later phase:
- Stablecoin deposit flows for escrow collateral (USDT, USDC, ETH)
- Fiat on-ramp via institutional partners
- Connection stake configuration for agents that opt into institutional defense

The portal must never hold or manage cash. All payment flows route through a compliant custodian. The portal is only the initiation and display surface.

### Recovery contact designation

The portal should make designation of M-of-N recovery contacts prominent and difficult to skip at registration time. Specifically:

- After the initial registration completion flow, the portal should present recovery contact designation as a step with its own screen, not a footnote in settings.
- The owner must be able to search for contacts by agent handle, invite by alias URI, or paste an agent ID.
- Contacts must meet a minimum trust signal floor (exact floor not yet specified — **[GAP F-11]**).
- The portal shows whether each designated contact has the required signals.
- An agent without any recovery contacts must display a visible indicator in its trust profile — the directory enforces this; the portal must communicate it clearly.

The portal also supports:
- Viewing and updating the recovery contact list
- Configuring the M-of-N threshold (configurable at registration)
- Creating and viewing the succession package (encrypted blob for the designated successor — the portal handles the encryption client-side using the successor's `identity_key`; the portal must never handle the plaintext seed phrase)

### What the portal does NOT do

- It does not display message content. The portal is a protocol event viewer, not a chat client. Conversation Merkle roots are shown as hash values, not decoded transcripts.
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

- Active sessions: counterparty, opened_at, message count, current session state
- Recently sealed sessions: seal type (MUTUAL / UNILATERAL), seal timestamp, Merkle root hash, attestation (CLEAN / FLAGGED / PENDING)
- A FLAGGED seal is highlighted. If the owner wants to submit the session to arbitration, the dashboard provides a "Submit to arbitration" action (see Dispute Submission in Cross-Surface Flows below)
- Aborted sessions: abort reason code, timestamp

The Merkle root values are displayed as truncated hex (first 8 bytes) with copy-to-clipboard for the full value. They are not decoded or explained beyond "this is the tamper-proof fingerprint of this conversation."

### Notifications and event stream

A chronological event stream showing all notification types from `cello_poll_notifications`:
- Security blocks (Layer 1 fires): what triggered it, from which session
- Endorsements received and revoked
- Connection events (accepted, declined, escalation resolved)
- System events: directory reachability changes, K_local degraded mode
- Key rotation events
- Anomaly alerts (these are also sent to phone — the dashboard shows the same events)

The event stream is filterable by type. Each event links to its relevant context in the portal (a security block links to the session; an endorsement links to the endorser's trust profile).

### What the dashboard does NOT do

- It does not display message content.
- It does not allow the owner to read or reply to messages. The agent handles all conversation content.
- It is not a control panel for the agent's real-time decisions — those are handled by the agent's policy configuration (set via the portal's connection oversight section) or by human escalation through the push notification path.

---

## Surface 3: Mobile App

### What it is and why it exists

The mobile app serves two capabilities that the web portal cannot provide:

1. **Device attestation** (Apple ecosystem: iOS and macOS via App Attest / Secure Enclave). The browser cannot access `DCAppAttestService`. A signed native app is required.
2. **Push-based escalation and alerts**. The alert channel must be independent from agent infrastructure — if the agent is compromised, it cannot intercept alerts sent through it. Out-of-band push via a native app provides this independence. On iOS, persistent background push notifications require native APIs not available to PWAs.

The mobile app is not a full portal replica. For everything except device attestation and push-based responses, the owner uses the web portal. The mobile app is an oversight and security response tool.

The existing WhatsApp/Telegram escalation channel (configured via `cello_configure`) is the Phase 1 out-of-band path before the mobile app exists. The mobile app adds a native push path alongside it, not replacing it.

**[CONFLICT FC-3]**: Whether the native push path and the WhatsApp/Telegram path must both be configured, or whether the mobile app supersedes the WhatsApp/Telegram channel once installed, is not specified. They must produce the same outcomes (same `CONNECTION_ESCALATION_RESOLVED` notification), but whether they are redundant paths or a primary/fallback hierarchy is not decided. Decision required.

### Device attestation enrollment

First-time enrollment:
1. Owner downloads the mobile app and logs in via phone OTP (same phone number as the registered agent)
2. App calls the platform attestation API (`DCAppAttestService` on iOS, `PlayIntegrityAPI` on Android)
3. App generates an attestation and submits it to the home node
4. Home node verifies the attestation with the platform authority (Apple/Google), extracts the stable device identifier, checks it against the directory for uniqueness (one active binding per device hash)
5. If unique: binding confirmed; device hash written to directory; trust signal hash updated
6. If already bound to another account: enrollment rejected; owner must release existing binding first

Re-attestation: Platform attestation credentials have a validity period. The app must handle background re-attestation before expiry without requiring owner interaction. If re-attestation fails (device replaced, account locked on platform), the app must notify the owner and prompt a new enrollment.

**Device replacement**: The old attestation binding must be released before the new device can be enrolled. The release requires WebAuthn authentication (web portal or the app on the old device if still available). If the old device is permanently lost, social recovery or a directed dispute with the directory is the path — the exact protocol for this case is not specified. **[GAP F-12]**

### Push-based escalation approvals

When an incoming connection request reaches PENDING_ESCALATION state, the directory sends a push notification to the owner's registered device via the app's push token:

Notification payload (displayed in lock-screen preview):
- Requester handle (truncated)
- Top two trust signals present
- "Accept or decline — expires in N minutes"

Full view (after unlock):
- Complete trust profile (signals with quality metadata)
- Greeting text (after Layer 1 sanitization)
- Alias context (if the request came in via a named alias the owner created)
- Accept button / Decline button / "View in portal" link

The app must handle the case where the owner taps the notification but then takes no action (escalation TTL expires) — display a clear "Auto-declined — timeout" status and remove the pending card from the queue.

**[GAP F-13]**: The push notification token provisioning and rotation mechanism is not specified. How does the directory learn the device's push token? How is the token updated when the OS rotates it? How is it revoked when the owner logs out of the app?

### Emergency revocation ("Not Me")

The "Not Me" flow is optimized for speed. When the owner believes their agent is compromised:

1. The owner taps a prominently placed "Not Me / Emergency" action — accessible from the app's home screen without navigating menus
2. The app re-authenticates with phone OTP (or biometric if that is sufficient for the revoke operation — the distinction between phone OTP and WebAuthn for emergency revocation is that revocation only requires phone OTP, not WebAuthn)
3. The app sends a signed revocation request to the home node
4. The home node immediately burns the K_server_X shares — no new FROST sessions are possible
5. The app displays confirmation: "Agent locked. No new authenticated sessions can be established. Visit the portal to re-key."

The re-keying step (issuing new K_local and K_server_X) requires WebAuthn and is done via the web portal or the app's WebAuthn path. The "Not Me" flow deliberately does not proceed to re-keying in one step — the owner needs to be at a trusted device with their authenticator in hand, which may not be true at the moment of emergency revocation.

**[CONFLICT FC-4 — same as server C-5]**: §8.3 states "existing conversations signed with K_local alone remain valid" after "Not Me" K_server revocation. §8.4 states "all active sessions receive SEAL-UNILATERAL with tombstone reason code" on any tombstone, and "Not Me" triggers a Compromise-initiated tombstone. These directly contradict. The mobile app's "Not Me" confirmation screen must show either "this will close all active sessions" or "existing sessions continue" — it cannot show both. Decision required before the app can be implemented.

### Security alerts

The app receives push notifications for all anomaly events the directory has flagged for this agent:
- `FROST_SESSION_FAILURE` (compromise canary — urgent)
- `UNUSUAL_SIGNING_PATTERN` (urgent)
- `BURST_ACTIVITY` (warning)
- `ATYPICAL_HOURS` (informational unless combined with other signals)
- `WIDESPREAD_REJECTION_PATTERN` (warning)
- `K_LOCAL_DEGRADED_MODE` (informational — directory unreachable)
- `KEY_ROTATION_RECOMMENDED` (scheduled maintenance)

The app displays these in a prioritized alert list. Urgent alerts (FROST failure, unusual signing) use OS-level alerts that break through Do Not Disturb.

### WebAuthn on mobile

TouchID and FaceID can serve as WebAuthn authenticators on iOS. The app must support WebAuthn operations for the operations that require it (key rotation, social verifier changes) so the owner can perform them from the mobile app without needing a desktop browser session. The app uses the `ASWebAuthenticationSession` / `WKWebView` + WebAuthn flow to authenticate to the home node.

### What the mobile app does NOT do

- It does not receive or display message content.
- It does not run the CELLO client (MCP server). The client is a separate process managed by the agent's runtime environment.
- It does not replace the web portal for full account management. Complex operations (OAuth binding, recovery contact management, succession package creation) are portal-only until the app matures.
- It does not store trust signal JSON blobs or conversation records.

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

The desktop app serves two capabilities that neither the web portal nor the mobile app provides:

1. **TPM attestation on Windows** and **Secure Enclave attestation on macOS** for agents deployed on desktop or server hardware. An agent running on a Windows machine owned by a real person can carry the owner's device attestation even if the agent itself runs on a cloud VPS — the attestation is about the owner's hardware, not the deployment environment.
2. **Local MCP server management** — starting, stopping, updating, and monitoring the CELLO client process running on the owner's machine.

The desktop app is the thinnest of the three surfaces. It does not replicate portal functionality. For everything except attestation and local server management, the owner uses the web portal.

### TPM attestation flow

**Windows (TPM 2.0)**

1. Owner installs the desktop app and logs in via phone OTP
2. App accesses the TPM via the Windows TPM Base Services (TBS) API
3. App generates an attestation quote using the TPM's Endorsement Key (EK) — globally unique per chip
4. App submits the EK-based attestation to the home node
5. Home node verifies the attestation, extracts the stable device identifier (EK hash), checks uniqueness
6. If unique: binding confirmed; trust signal hash updated in directory

**macOS (Secure Enclave via App Attest)**

macOS App Attest is the same mechanism as iOS App Attest — available to native macOS apps with the App Attest entitlement. The desktop app on macOS follows the same enrollment flow as the iOS mobile app.

**Linux / VPS / server agents**

No native device sacrifice is available. Server agents sit at the base trust level and are filtered by receiving agents with stricter connection policies. The desktop app is not installed on server environments. This is acceptable by design — device attestation is about the *owner's* hardware, and a fully automated agent with no human owner cannot sacrifice a device.

### Local MCP server management

The desktop app provides a management interface for the locally-running CELLO client:

- **Start / stop / restart** the MCP server process
- **View server status**: directory reachability, active P2P peers, active sessions, pending notifications, K_local_only mode — the same data returned by `cello_status`
- **View server logs**: recent MCP server output for troubleshooting
- **Update the server**: when a new CELLO client version is available, the desktop app handles the download, hash verification (SHA-256 pinned to the npm package signature), and process restart
- **Configuration**: scan sensitivity, P2P bootstrap nodes, escalation channels, directory fallback behavior — a GUI layer over the settings that `cello_configure` manages programmatically

The desktop app does not replace the MCP server — it manages it. The agent still calls MCP tools directly; the desktop app is a management surface, not a proxy.

**[GAP F-16]**: The auto-update mechanism for the desktop app itself (the management layer, not the MCP server) is not specified. Auto-update (Electron's `autoUpdater`, Squirrel, etc.) vs. manual download are not decided.

### System tray / menubar presence

The desktop app runs as a system tray icon (Windows) or menubar icon (macOS). The icon provides ambient status at a glance:

- Green: directory reachable, all sessions clean, no pending escalations
- Yellow: directory unreachable (K_local_only mode), or pending escalation waiting
- Red: compromise canary fired, or agent locked

Left-click opens the status dashboard. Right-click shows a quick menu: "View status", "Open portal", "Not Me / Emergency", "Quit".

The "Not Me" action from the system tray follows the same flow as from the mobile app: re-authenticate via phone OTP or WebAuthn, send revocation request, confirm lock.

### Relationship to the web portal

The desktop app is not a portal replacement. Navigation from the desktop app always points at the web portal for operations beyond server management and attestation. The app's UI should make this boundary obvious.

### What the desktop app does NOT do

- It does not display message content.
- It is not a full account management surface. OAuth flows, recovery contact management, key rotation confirmation, and dispute submission all open the web portal.
- It does not operate as a proxy between the agent and the CELLO client — the agent calls MCP tools directly.

### Platform variants

| Platform | Attestation | Notes |
|---|---|---|
| macOS | App Attest (Secure Enclave) | Same mechanism as iOS app; requires notarized native app with App Attest entitlement |
| Windows | TPM 2.0 via TBS API | Requires TPM chip present; most post-2016 business hardware has TPM 2.0 |
| Linux | None | No device sacrifice available; app may still be useful for local server management without attestation |

**[GAP F-17]**: Whether a Linux version of the desktop app is scoped. Linux is mentioned in the design documents as a deployment environment for agents but not as a target for the native app. Server management tooling on Linux may be sufficient as a CLI or systemd service.

---

## Cross-Surface Flows

These flows span multiple surfaces. Each is described once here to prevent the same flow appearing with different details in different sections.

### Registration and first-use

1. Agent registers via WhatsApp/Telegram bot — phone OTP, K_local and K_server_X generated, agent listed in directory
2. Bot sends the owner a link to the web portal
3. Owner opens the portal, logs in via phone OTP (bootstrapping the web session from the bot-verified phone number)
4. Portal presents the registration completion flow: current trust signals, available enrichment paths, recovery contact prompt
5. Owner completes desired enrichment steps (WebAuthn, OAuth, etc.)
6. Owner optionally installs the mobile app — portal shows QR code / download link
7. Mobile app: owner logs in, optionally completes device attestation enrollment
8. Owner optionally installs the desktop app for TPM attestation or server management

### Key rotation

1. Owner opens the web portal (or mobile app WebAuthn path)
2. Initiates key rotation from account management
3. Portal issues a WebAuthn challenge; owner taps hardware key or biometric
4. Client generates new K_local
5. Portal sends key rotation request to home node (authenticated with WebAuthn response)
6. Home node triggers new K_server_X ceremony across directory nodes
7. New public keys published; old keys marked expired; connected agents receive `KEY_ROTATION_RECOMMENDED`
8. Portal shows confirmation: new key fingerprint, rotation timestamp
9. Desktop app system tray (if running) shows a brief "Keys rotated" notification

### Compromise detection and "Not Me"

1. Directory detects anomaly event (e.g., FROST session establishment failure from unexpected source)
2. Directory pushes push notification to mobile app AND sends message to WhatsApp/Telegram (parallel paths — **[see Conflict FC-3]** for their relationship)
3. Owner receives push notification
4. Owner taps "Not Me / Emergency" in mobile app
5. App re-authenticates with phone OTP
6. App sends revocation request to home node; K_server_X immediately burned
7. App displays: "Agent locked. Visit portal to re-key."
8. Owner opens portal (on desktop/laptop, at a trusted device with their YubiKey or biometric authenticator)
9. Owner authenticates with WebAuthn
10. Owner generates new K_local; portal triggers new K_server_X ceremony
11. New keys published; old keys marked expired
12. All counterparties with active sessions notified

### Human escalation for connection requests

1. Agent receives incoming connection request
2. Agent evaluates request against configured `SignalRequirementPolicy`
3. If `human_escalation_fallback` is set and the request does not produce a clear accept/reject: request transitions to PENDING_ESCALATION
4. Two parallel notifications fire:
   - Push notification to mobile app (if installed and registered)
   - Message to WhatsApp/Telegram escalation channel (always configured as fallback)
5. Owner reviews the request in either the mobile app (push notification card) or the web portal (escalation queue)
6. Owner taps Accept or Decline
7. The decision is submitted to the home node, which calls `cello_accept_connection` or `cello_decline_connection`
8. A `CONNECTION_ESCALATION_RESOLVED` notification is appended to the log
9. If the `escalation_expires_at` TTL passes with no response: the request auto-declines; owner sees "Auto-declined — timeout" in the dashboard

### Social recovery

This flow is primarily handled at the protocol level between the home node, directory, and recovery contacts. The frontend's role:

1. Owner is locked out (WebAuthn unavailable, phone lost or SIM-swapped)
2. Owner contacts M-of-N pre-designated recovery contacts out-of-band
3. Each recovery contact opens the portal and navigates to "Vouch for recovery"
4. Recovery contact authenticates with their own WebAuthn and signs a recovery attestation for the locked-out account
5. When M-of-N threshold is met, the directory records the recovery threshold reached
6. 48-hour mandatory waiting period begins — the old key can contest during this window
7. After 48 hours: owner can open the portal with a new device, authenticate with the new phone (or with a surviving second factor), and initiate a new K_local + K_server_X ceremony
8. Portal displays the vouching contact identities and the declared compromise window for the owner to review

**[GAP F-18]**: The portal UI for a recovery contact vouching on behalf of another agent is not designed. Specifically: how does the recovery contact navigate to the vouch screen? Is there a URL from the directory, a manual agent ID entry, or a QR code flow?

### Dispute submission

1. Owner views a FLAGGED session in the dashboard
2. Owner clicks "Submit to arbitration"
3. Portal asks the owner to confirm: submitting to arbitration is public to the counterparty (their full transcript copy will be compared against the submitted copy)
4. Owner confirms
5. Portal fetches the partial Merkle proof for this session from the directory (the sealed Merkle root plus the path proving inclusion in the MMR)
6. Portal submits the proof to the directory's dispute arbitration endpoint
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
| Emergency revocation ("Not me") | Phone OTP | ✓ | ✓ | ✓ (tray shortcut) |
| View sessions and seal status | Phone OTP | ✓ | — | — |
| Manage contact aliases | Phone OTP | ✓ | — | — |
| Manage discovery listings | Phone OTP | ✓ | — | — |
| Configure connection policy | Phone OTP | ✓ | — | — |
| Designate recovery contacts | Phone OTP | ✓ | — | — |
| View succession package status | Phone OTP | ✓ | — | — |
| Submit to arbitration | Phone OTP | ✓ | — | — |
| Key rotation | WebAuthn / TOTP | ✓ | ✓ (biometric) | — |
| Change registered phone number | WebAuthn / TOTP | ✓ | ✓ (biometric) | — |
| Add / remove social verifiers | WebAuthn / TOTP | ✓ | — | — |
| Account deletion | WebAuthn / TOTP | ✓ | — | — |
| Fund withdrawal | WebAuthn / TOTP | ✓ | — | — |
| Create succession package | WebAuthn / TOTP | ✓ | — | — |
| Voluntary ownership transfer | WebAuthn / TOTP | ✓ | — | — |
| Device attestation enrollment | Phone OTP + native app | — | ✓ | ✓ |
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
| Out-of-band escalation | ✓ (WhatsApp/Telegram fallback, configured separately) | ✓ | ✓ |
| OAuth flows (LinkedIn, GitHub, etc.) | ✓ | ✓ (in-app browser / native OAuth SDK) | — |
| Merkle proof export | ✓ | — | — |
| Dispute submission | ✓ | — | — |
| Local MCP server management | — | — | ✓ |
| System tray / ambient status | — | ✓ (notification badges) | ✓ (tray icon) |
| Escalation approval | ✓ (queue) | ✓ (push) | — |
| "Not Me" emergency revocation | ✓ | ✓ | ✓ (tray shortcut) |
| Recovery contact vouching | ✓ | — | — |
| Succession package creation | ✓ | — | — |
| Alias short-URL resolution | ✓ (resolver on portal domain — **[see F-10]**) | — | — |
| Discovery browse | ✓ | — | — |
| Activity log | ✓ | — (push notifications only) | — |
| Financial UI | ✓ (later phase) | — | — |

**[GAP F-20]**: Using TOTP on the same mobile device that is receiving push notifications and managing the agent introduces a security concern: if the device is compromised, both the TOTP seed and the push channel are in the same attack envelope. The design documents do not address this. A decision on whether TOTP is permitted as a factor on the same device as the mobile app is needed.

---

## Surface Rollout

| Phase | What ships | What is deferred |
|---|---|---|
| Phase 1 | Web portal: registration completion, WebAuthn enrollment, OAuth flows, key rotation, activity log, connection oversight, escalation queue (web-based), policy configuration, alias management | Mobile app, desktop app |
| Phase 1 | WhatsApp/Telegram as the only out-of-band escalation path | Native push via mobile app |
| Phase 2 | Mobile app: device attestation (iOS/Android), push-based escalation, "Not Me" shortcut, security alerts | Desktop app, TPM attestation |
| Phase 3 | Desktop app: TPM attestation (Windows), macOS Secure Enclave via App Attest, local MCP server management, system tray presence | — |
| Phase 3+ | Financial UI (stablecoin deposits, fiat on-ramp, stake configuration) | — |

In Phase 1, escalation approvals are web-based: the WhatsApp/Telegram message directs the owner to the portal's escalation queue. The native push path (mobile app) is additive in Phase 2 and should be designed to be fully redundant with the Phase 1 path.

In Phase 1, the desktop app's server management features are replaced by CLI tooling (`cello-server start|stop|status`). The desktop app wraps these operations in a GUI.

---

## Conflicts Requiring Resolution

**FC-1: Portal/bot boundary for phone OTP**
- Position A: Phone OTP happens exclusively in the WhatsApp/Telegram bot; the portal always operates downstream of an already-verified phone number. The portal login flow assumes a bot-registered agent exists and bootstraps from it.
- Position B: The portal also supports a standalone OTP path, allowing an owner to register entirely through the browser without installing WhatsApp or Telegram.
- The decision affects: whether the portal needs its own OTP delivery mechanism, whether bot registration is mandatory, and whether the portal's onboarding flow can be self-contained.
- This is the same as server infrastructure Conflict C-1, but the frontend must resolve it before the portal's registration flow can be implemented.

**FC-2: Bio public access vs. authenticated discovery**
- Position A (end-to-end-flow §4.2): "Bio — visible to anyone browsing the directory — no connection required."
- Position B (end-to-end-flow §4.1): "Discovery requires an active authenticated session — only verified agents with a FROST-authenticated session can query the directory."
- The decision affects: whether the portal exposes a public browse mode without login, what data is available unauthenticated, and whether the alias short-URL resolver must show the target's bio to an anonymous visitor.
- This is the same as server infrastructure Conflict C-6.

**FC-3: Native push vs. WhatsApp/Telegram escalation relationship**
- Position A: The mobile app push path and the WhatsApp/Telegram path are parallel, redundant channels. Both fire for every escalation event. The owner can respond via either.
- Position B: The mobile app push path supersedes the WhatsApp/Telegram path once the app is installed. The WhatsApp/Telegram channel is only used when the app is not installed.
- The decision affects: whether both channels must produce consistent state when both fire; whether double-response (both paths responding) is possible and what happens; and how the owner configures the escalation channel after installing the app.

**FC-4: "Not Me" scope for existing sessions**
- Position A (end-to-end-flow §8.3): Existing conversations signed with K_local alone remain valid after "Not Me" K_server revocation.
- Position B (end-to-end-flow §8.4): All active sessions receive SEAL-UNILATERAL with tombstone reason code on any tombstone. "Not Me" triggers a Compromise-initiated tombstone.
- These directly contradict. The mobile app's "Not Me" confirmation screen must display accurate consequences. Decision required before the app can be implemented.
- This is the same as server infrastructure Conflict C-5.

---

## Gaps Requiring Decisions

| ID | Surface | Gap |
|---|---|---|
| F-1 | Portal | Portal session lifecycle not specified: session duration, step-up auth mechanics, fresh-challenge-per-operation vs. session-level upgrade |
| F-2 | Portal | Portal-to-home-node authentication mechanism not specified: what credential does the portal present for PII operations? |
| F-3 | Portal | Onboarding link from bot: format, expiry, and portal-side mechanism for recognizing first-time vs. returning visit |
| F-4 | Portal | TOTP enrollment mechanics and JSON record schema not specified |
| F-5 | Portal | Liveness probing interval for social verifier freshness not specified |
| F-6 | Portal | Metadata evaluation criteria for Twitter/X, Facebook, Instagram OAuth not specified |
| F-7 | Portal | Recommended key rotation schedule (the interval at which the portal should prompt the owner) not specified |
| F-8 | Portal | Handling of pending escrow stakes or bonds at account deletion time not specified |
| F-9 | Portal | Retention period for the activity log not specified |
| F-10 | Portal | Alias short-URL resolver: whether it lives on the portal domain or a separate service not specified |
| F-11 | Portal | Minimum trust signal floor for recovery contacts not defined |
| F-12 | Mobile | Protocol for releasing an attestation binding when the original device is permanently lost not specified |
| F-13 | Mobile | Push notification token provisioning, rotation, and revocation mechanism not specified |
| F-14 | Mobile | Implementation technology (React Native vs. Swift/Kotlin native) not specified; App Attest integration requires native Swift |
| F-15 | Mobile | iPadOS support not specified |
| F-16 | Desktop | Auto-update mechanism for the desktop app management layer not specified |
| F-17 | Desktop | Whether a Linux version of the desktop app is in scope not specified |
| F-18 | Recovery flow | Portal UI for a recovery contact vouching on behalf of a locked-out account not designed |
| F-19 | Dispute flow | Whether the dispute submission requires the client to provide full message content or only Merkle proofs is not designed; if content is required, this is the only point where message content passes through infrastructure and needs explicit justification |
| F-20 | Mobile / Auth | Whether TOTP is permitted as a factor on the same device as the mobile app (creates an attack envelope concern) not addressed |

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
- [[2026-04-11_1700_persistence-layer-design|Persistence Layer Design]]
- [[open-decisions|Open Decisions]]
- [[design-problems|Design Problems]]
