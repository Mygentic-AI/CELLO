# CELLO Roadmap

This is where we're going and roughly in what order. Phases are sequential — each one builds on the last — but the SDK ships as a standalone project and delivers value independently.

---

## Phase 1 — Security SDK *(separate repository)*

The on-ramp. An open-source library anyone can drop in front of their agent's message handler. No registration, no network, no dependencies on anything else in CELLO.

- 6-layer prompt injection defense pipeline
- Layer 1: Deterministic sanitization (invisible characters, wallet-draining tokens, homoglyphs, encoding attacks, jailbreak patterns)
- Layer 2: Frontier scanner — LLM-based risk scoring for what pattern matching misses
- Layer 3: Outbound content gate — catches leaks going out
- Layer 4: Redaction pipeline — PII, secrets, credentials
- Layer 5: Runtime governance — spend caps, volume limits, loop detection
- Layer 6: Access control — file path and URL safety
- OpenClaw integration guide

---

## Phase 2 — Agent Registration & Identity

The foundation of the network. An agent gets a verified identity, cryptographic keys, and a directory listing.

- Agent registration via WhatsApp and Telegram bots (autonomous, no human required)
- Phone verification — OTP flow, binding phone to identity
- Split-key generation — K_local stays on the agent's machine, K_server issued by the directory
- Directory listing created and publicly visible
- Baseline trust score assigned
- Web portal for human owners — bootstrap session via phone OTP

---

## Phase 3 — Trust Strengthening

Agents start at baseline. This phase lets owners build a trust score the network respects.

- WebAuthn registration — YubiKey, TouchID, FaceID
- TOTP 2FA as alternative or addition
- Social verifier OAuth — GitHub, LinkedIn, Twitter/X, Facebook, Instagram
- Signal scoring (account age, activity depth) — store strength, not profile data
- Trust score formula: phone + WebAuthn + 2FA + social verifiers + time on platform
- Market-enforced trust: agents with higher scores unlock more connections

---

## Phase 4 — Discovery

Agents can find each other. The directory becomes useful.

- Search by capability and category
- Full trust profile visible before any connection is made
- Connection requests routed through the directory
- Receiver sees complete trust profile and decides whether to engage
- No data exchanged until both sides agree

---

## Phase 5 — Verified Communication

Every message is provable. Neither side can deny what was said.

- Message hashing and split-key signing on send
- Merkle tree recording — three copies: sender, receiver, directory
- Receiver-side verification on every inbound message
- Session management — P2P, Slack, or any transport
- SDK scan results recorded in the Merkle tree alongside messages
- Tamper-proof conversation history available to both parties

---

## Phase 6 — Compromise Detection

Trust isn't established once. It's continuous.

- Fallback-only signing as a canary — signals potential key theft
- Failed scan pattern detection
- Unusual activity anomaly detection
- Real-time alerts to owner's phone via WhatsApp or Telegram
- Instant kill switch — "Not me" revokes K_server immediately
- Full re-keying after compromise (WebAuthn required)
- Automatic K_server rotation on schedule

---

## Further Out

- Dispute resolution — directory Merkle tree as tiebreaker, without ever seeing message content
- Reputation and transaction history — real commerce as the highest trust signal
- Anti-Sybil clustering detection
- Agent-to-agent micropayments
