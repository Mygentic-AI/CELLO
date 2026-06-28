---
name: signed-revocation-passkey-assertion
type: discussion
date: 2026-06-28
topics: [revocation, burn, suspend, webauthn, threat-model, sovereign-nodes, DOD-LEVER-2]
status: decided
description: >
  Design for making a burn/suspend a cryptographically SIGNED event so a compromised directory node
  cannot forge an unauthorized revocation (a targeted or mass denial-of-service). Decision: sign with the
  operator's existing WebAuthn passkey assertion, verified node-side before honoring; NOT a new account
  key, NOT server-held, NOT node-only attestation. Accept unsigned for M8 (DOD-LEVER-2 stays 🟡 by
  decision); build as an M10 story.
---

# Signed revocation (burn/suspend) via WebAuthn passkey assertion

> ⚠️ **SUPERSEDED / INCOMPLETE — read [[m8-totp-floor-stepup-inversion-remediation]] §5 instead.**
> This log's design ("sign with the operator's WebAuthn passkey") only protects WebAuthn users. Andre
> corrected it: M8 mandates 2FA and TOTP is the recoverable FLOOR (journey-01 D6); WebAuthn is a layer.
> **TOTP cannot sign** (symmetric, server-held, presence-code not a payload signature). The corrected
> design is TWO-LAYER — the PORTAL signs every burn (covers TOTP + passkey, defeats a rogue directory),
> and WebAuthn users ALSO attach a passkey assertion (defeats a rogue portal) — with an open question
> about the portal's trust/deployment model. See the remediation doc §5. The threat model below is still
> accurate; the "who signs" solution below is not.

## The threat this closes

A burn/suspend is a row in `agent_suspensions` (directory state, in `cello_pub`, replicated to every
sovereign node). Each node's FROST honor-check reads its local copy and refuses the agent's key-share if
the row says paused/burned. **The relay is NOT in this path** — it routes sealed messages and cannot
revoke anything; the relevant actor is a directory node.

- **Front door (legitimate path) is well-guarded.** A burn legitimately enters only via the portal →
  directory `/internal/agent-write` seam: API-key auth + account-scoping (the directory re-proves
  `agent_profiles.account_id` ownership → cross-account = 403 `not_owner`, WRITEAPI-001 SI-001) + a fresh
  WebAuthn step-up. An outsider or a different account cannot burn your agent.
- **Back door (a compromised directory node) is open.** A node has direct DB access; it can `INSERT` an
  `agent_suspensions` row directly, skipping the seam. It replicates, and every node's honor-check **just
  trusts it** — there is NO cryptographic check that the owner authorized it. So today a compromised
  directory node CAN forge a burn, and since it could do one it could do all of them.
- **Blast radius today: denial-of-service only.** A forged burn stops an agent from signing; it cannot
  forge the agent's signatures, read its data, or make it act. It also requires compromising a directory
  node (DB write). The damage is "kill switch", bounded — but real, and currently unmitigated.

This is the [[project_sovereign_nodes]] threat model: nodes are not fully trusted, so a single node must
not be able to fabricate federation-honored state. Revocation is the one place that fabrication is
currently honored without proof.

## Options considered

1. **New per-account Ed25519 key.** REJECTED. Invents a key lifecycle (where the private key lives, how
   it's recovered). If it lives server-side, the server can forge it — defeating the point. Heavy new
   surface for no advantage over what we already have.
2. **Node-only threshold attestation** (each node co-signs the burn it applies with its node key).
   INSUFFICIENT as the primary defense: it proves the burn was APPLIED by ≥T nodes (anti-suppression /
   non-repudiation), but NOT that the OWNER authorized it (anti-forgery) — a compromised node could write
   a row that others attest. Useful as a complementary belt-and-suspenders, not the core fix.
3. **WebAuthn passkey assertion** (CHOSEN). The account already has a hardware-backed, server-never-holds-
   it private key — the passkey used for step-up. Reuse it to sign the burn order; nodes verify before
   honoring. No new key lifecycle (passkey enrollment + recovery already exist), and it is already on the
   burn path (step-up is already required).

## Chosen mechanism (step by step)

Setup (mostly exists): passkey enrollment already stores the account's PUBLIC key. NEW: that public key
(safe to copy) must be available to the **directory nodes** so each can verify independently.

Ordering a burn:
1. Operator clicks Burn.
2. Portal builds a statement of intent: `account A burns agent X, at time T, nonce N`.
3. Portal asks the operator's authenticator to SIGN that statement (the Touch-ID/key tap = the existing
   step-up prompt; the WebAuthn challenge = `hash(statement)`). The private key never leaves the device.
4. Authenticator returns the signature (the "assertion").
5. Portal sends the directory BOTH the burn order AND the assertion.
6. Directory writes the flag to `agent_suspensions` WITH the assertion attached; replicates as today.

Verify-before-honor (the part that closes the hole, MANDATORY + NODE-SIDE):
7. Before any node acts on a burn (refuses the share) it checks: is there a signature, by THIS account's
   registered passkey, over THIS exact burn (this agent, this action)?
8. Valid signature → honor it. No valid signature → ignore it (the agent keeps working).

A compromised node cannot produce a valid signature (it lacks the operator's authenticator), so its
forged burn carries no valid assertion → every honest node ignores it → no DoS. Bonus: the burn becomes
undeniable (the owner's signature proves authorization; a node cannot credibly suppress a real one since
it verifies independently on every node).

## What it costs (the real new surface)

1. The account's passkey PUBLIC key (a verifier) must reach the directory/nodes (replicated), not just
   the portal DB where it lives today.
2. The honor-check must REQUIRE a valid assertion to honor a burn — else a node just omits it.
3. A defined FALLBACK: accounts in the 7-day grace or TOTP-only have no passkey → their burns stay
   authorized-but-unsigned (today's behavior). Either accept that grace gap (recommended — matches how
   grace already works), or require a passkey before a burn counts as "protected".

## Scope

Burns are the must-sign (permanent — a forged one is permanent DoS). Suspends are reversible, so signing
is nice-to-have; sign both for uniformity (same route) if cheap, else burn is the priority.

## Decision

- **M8:** ACCEPT authorized-but-unsigned revocation. The security property that matters — a burned agent
  can never sign (share destroyed federation-wide) — already holds and is proven. The signed-event adds
  tamper-proof ATTRIBUTION (audit/anti-forgery), a strengthening, not a present security hole that blocks
  M8. DOD-LEVER-2 stays 🟡 BY DECISION.
- **M10 (or when the account-key/identity-hardening milestone lands):** build the passkey-assertion-signed
  revocation above. Optionally add node threshold co-signing for full non-repudiation.

Relates to [[project_threshold_t_of_n_not_2_of_2]] (the honor-check is per-node; signing makes the INPUT
to that check unforgeable) and the M9 security-layer direction.
