---
name: Trust Signal Pickup Queue — Async Oracle Handoff
type: discussion
date: 2026-04-17 10:00
topics: [identity, trust, oracle-pattern, persistence, frontend, key-management, notifications, onboarding, social-verifications]
description: Identifies a gap in the oracle pattern handoff — the portal holds the only copy of a raw trust signal JSON blob at the moment of verification, but the agent client may not be running. Designs an encrypted async pickup queue using the agent's identity_key to bridge the gap safely.
---

# Trust Signal Pickup Queue — Async Oracle Handoff

## The Problem

The oracle pattern is: portal verifies → creates JSON blob → hashes it → writes hash to directory → returns raw JSON to client → discards original.

This pattern is described as if the "return to client" step is atomic and guaranteed. It is not.

Consider the realistic signup journey. A human visits the CELLO portal, authenticates via the WhatsApp/Telegram bot, and is prompted to strengthen their trust profile. They click "Connect LinkedIn," complete the OAuth flow, and the portal backend:

1. Verifies ownership of the LinkedIn account
2. Fetches account age, connection count, activity history via the LinkedIn API
3. Creates a structured JSON blob: `{type: "linkedin", connections: 847, account_age_years: 6, verified_at: "2026-04-17T..."}`
4. Hashes it: `SHA-256(blob)` and `SHA-256(account_identifier)`
5. Writes both hashes to the directory

Then it tries to "return the raw JSON to the client." But the agent client may not be running. In fact, at this stage of the user journey, the agent may never have been installed at all.

The result: the hash is in the directory, but no one holds the JSON blob that generated it. The trust signal is permanently orphaned — visible as "present" to the directory but unverifiable by the agent, which cannot reconstruct the JSON it never received.

### Why this matters

The agent needs the raw blob for two purposes:

1. **Presenting the signal at connection time.** When Alice initiates a connection, she presents the raw JSON blob alongside its hash. The receiving agent verifies `SHA-256(presented_blob) == stored_hash`. Without the blob, Alice cannot prove what the hash represents.

2. **Dispute resolution.** If a counterparty challenges a trust signal, Alice must be able to produce the original JSON to prove the hash is not fabricated.

A hash in the directory with no corresponding blob on the client is useless for both purposes. The verification work is wasted.

---

## The Solution: Encrypted Async Pickup Queue

Rather than attempting synchronous delivery — which fails whenever the client is offline — the portal places the raw JSON blob into an encrypted pickup queue. The agent retrieves it the next time it connects to the directory.

### The flow

1. Portal completes OAuth verification, creates the JSON blob as usual
2. Portal fetches the agent's **identity_key** public key from the directory (always present — registered at bot sign-up)
3. Portal encrypts the blob: `encrypt(json_blob, identity_pubkey)` — using asymmetric encryption; only the agent's identity_key can decrypt
4. Portal writes the hash pair to the directory (as normal)
5. Portal stores the **encrypted** blob in a short-lived pickup queue alongside the agent ID and a TTL
6. Portal deletes the plaintext JSON blob immediately — even the portal cannot read the encrypted copy
7. Directory delivers a `TRUST_SIGNAL_PICKUP_PENDING` notification to the agent the next time it connects
8. Agent downloads the encrypted blob, decrypts with its identity_key, validates `SHA-256(decrypted_blob) == stored_hash`, stores the JSON locally, sends ACK
9. Pickup queue entry is deleted on ACK

### Why identity_key, not K_local (the signing key)

The signing key (K_local) can rotate. Between the moment the portal encrypts the blob and the moment the agent comes online to pick it up, K_local may have changed. The encrypted blob would be unrecoverable.

The identity_key is the stable long-term root. It is backed by the BIP-39 seed phrase and is never rotated under normal circumstances. This is exactly the case where the identity_key's stability is the correct property to rely on — this is an encryption operation for deferred delivery, not a signing operation for session authentication.

### Pickup queue storage

The pickup queue is **not** the home node PII store and **not** part of the replicated directory state. It is ephemeral storage, co-located with the signup portal infrastructure, with the following properties:

- Stores only ciphertext — the portal operators cannot read it
- Keyed by `agent_id` — the agent knows to ask for its pending pickups
- TTL: 30 days
- Deleted on ACK from the agent
- Not replicated across federation nodes — this is transient delivery infrastructure, not protocol state

### TTL expiry

If the agent does not pick up within 30 days, the encrypted blob is deleted. The hash remains in the directory as an orphaned entry — present but unverifiable.

The agent client should detect orphaned hashes (hashes in the directory with no corresponding blob in local storage) and surface a "re-verify" prompt to the owner. Re-running the OAuth flow creates a fresh JSON blob with a fresh hash, which supersedes the orphaned entry. The oracle pattern is idempotent — the same LinkedIn account verified again simply produces a new hash for the same underlying signal.

---

## Portal UX Implications

The trust enrichment completion state needs two stages, not one:

**Before ACK:** "Verification complete — waiting for your agent to pick up the credential. This will happen automatically the next time your agent connects."

**After ACK:** "LinkedIn verified." (The signal appears in the trust profile.)

The portal should not display the trust signal as fully active until the agent has ACK'd receipt. A signal with an orphaned hash (hash in directory, no ACK received, no local blob) should be visible to the portal owner as "pending delivery" — distinguishable from both "active" and "not started."

If 30 days pass without ACK, the portal should display "verification expired — re-verify to reactivate."

---

## The Synchronous Case Still Works

When the agent client is running and connected, this same flow can complete synchronously:

- Portal finishes OAuth → encrypts blob → delivers to pickup queue
- Agent's persistent WebSocket connection receives `TRUST_SIGNAL_PICKUP_PENDING` notification immediately
- Agent downloads, decrypts, ACKs within seconds
- Portal receives ACK, deletes encrypted blob

From the portal's perspective the flow is identical regardless of whether the agent is online. The async pickup queue handles both cases.

---

## New Notification Type

`TRUST_SIGNAL_PICKUP_PENDING` must be added to the formal notification type registry:

```
type:     TRUST_SIGNAL_PICKUP_PENDING
source:   directory (on behalf of portal)
payload:  { signal_type: "linkedin" | "github" | ... , pickup_token: string, expires_at: ISO-8601 }
purpose:  Tells the agent client that an encrypted trust signal blob is waiting for pickup; provides the token the client needs to retrieve it from the portal's pickup queue
```

The `pickup_token` is an opaque reference — it is not the agent ID, and it reveals nothing about the blob's contents to anyone who intercepts the notification (the notification is delivered over the authenticated directory WebSocket, but the token remains opaque as a matter of defence in depth).

---

## What This Does NOT Change

- The oracle pattern itself — hash written to directory, plaintext discarded — is unchanged
- The two-hash pattern (data_hash + account_id_hash) is unchanged
- The directory schema is unchanged — the hash entries are written exactly as before
- The client-side storage schema is unchanged — the agent stores the JSON blob as before, once received
- The social binding lock mechanism is unchanged

The only additions are:
1. Encrypted pickup queue storage (portal-side ephemeral infrastructure)
2. `TRUST_SIGNAL_PICKUP_PENDING` notification type
3. ACK mechanism from client to portal on successful receipt and validation
4. "Pending delivery" state in the portal's trust enrichment UI

---

## Related Documents

- [[frontend|CELLO Frontend Requirements]] — trust enrichment flows updated to reflect async pickup; new "pending delivery" UI state; `TRUST_SIGNAL_PICKUP_PENDING` notification type added
- [[server-infrastructure|CELLO Server Infrastructure Requirements]] — pickup queue is portal-side ephemeral infrastructure; `TRUST_SIGNAL_PICKUP_PENDING` added to notification type registry; ACK mechanism and orphaned hash handling are directory-side concerns
- [[agent-client|CELLO Agent Client Requirements]] — client-side pickup flow: detect `TRUST_SIGNAL_PICKUP_PENDING` notification, fetch encrypted blob, decrypt with identity_key, validate hash, store JSON, send ACK; also handles orphaned hash detection and re-verify prompt
- [[2026-04-08_1930_client-side-trust-data-ownership|Client-Side Trust Data Ownership]] — the hash-everything-store-nothing principle this log preserves and operationalises for the async case
- [[2026-04-11_1700_persistence-layer-design|Persistence Layer Design]] — the social_verification_items schema that the delivered JSON blob populates on the client side; identity_key is the encryption anchor (not the signing key)
- [[2026-04-15_1100_key-rotation-design|Key Rotation Design]] — the identity_key / signing_key separation that makes identity_key safe to use as the encryption anchor here; K_local rotation does not invalidate queued pickups
- [[2026-04-08_1830_notification-message-type|Notification Message Type]] — the notification primitive that `TRUST_SIGNAL_PICKUP_PENDING` is added to
