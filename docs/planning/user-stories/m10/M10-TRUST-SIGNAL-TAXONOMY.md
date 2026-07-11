---
name: m10-trust-signal-taxonomy
type: reference
role: spec-of-record for M10 (WHAT) — no separate M10-SPEC exists; pairs with M10-TRUST-SIGNAL-STORAGE-AND-CREATION (HOW)
date: 2026-07-10
topics: [m10, trust-signals, taxonomy, identity-proofs, network-graph, track-record, economic-stake, anti-sybil, webauthn, device-attestation]
status: decided
description: >
  Canonical reference for every trust signal type planned for M10 (functional
  verification), grouped by class, with enough detail to distinguish one signal
  from a similar-looking one (e.g. WebAuthn vs. device attestation). Not a spec —
  the entry point for writing the M10 story YAMLs.
---

# M10 — Trust Signal Taxonomy

M8 shipped the four-class portal UI as a scaffold (WebAuthn + TOTP live, everything
else a placeholder). **M10 is the milestone that makes every other signal functional.**
This document is the canonical list of what those signals are — grouped by class,
with just enough detail to tell them apart. It is not a spec: no schemas, no API
shapes, no ACs. That comes when the M10 stories are written.

**The hard rule that governs all of this:** trust is expressed as independent named
signals, never collapsed into a single score. No "trust level," no TrustRank, no
composite. See `2026-04-11_1400_security-architecture-layers-and-trust-signal-classes.md`.

**Working definition of "trust signal" for this doc:** something the agent
accumulates and holds (or the directory verifies and hashes on the agent's behalf)
that a *counterparty* can consult when deciding whether to connect. This excludes
two adjacent things that are easy to confuse with trust signals — see
[§5](#5-related-but-not-trust-signals) at the bottom.

---

## Class 1 — Identity Proofs

*"Who you demonstrably are."* Four sub-groups, each with a different Sybil-defense
property. All absolute signals — evaluated about the agent in isolation.

### Account security
- **WebAuthn** — a hardware-bound login credential (phishing-resistant, e.g. a
  passkey or security key). Proves the owner *has a physical device*, but does
  **not** sacrifice it: the same device can register WebAuthn credentials for
  many different accounts. Works from a browser. **Live since M8.**
- **TOTP** — standard time-based one-time-password 2FA (authenticator app).
  Weaker than WebAuthn (phishable), but zero-friction and universally available.
  **Live since M8.**

### Verified contacts
- **Phone (OTP)** — the day-one registration requirement, verified via WhatsApp/
  Telegram OTP. **Live since M8.**
- **Email (domain)** — verified at registration; the domain (not full address) is
  what's meaningful as a signal (e.g. a corporate domain vs. a disposable one).
  **Live since M8.**
- **SIM age / carrier intelligence** (M10, enrichment of the phone signal, not a
  separate one) — when carrier lookup (Twilio Lookup, Telesign) is available, the
  directory can see SIM tenure, number type (mobile/VoIP/landline), and porting
  history alongside the OTP check. A SIM active 2+ years on a major carrier is a
  real signal; one activated 3 hours ago on a VoIP provider adds nothing. Continuous
  input, not a gate — absence is not a penalty.

### Social accounts (OAuth)
- **LinkedIn, GitHub, Twitter/X, Facebook, Instagram** — proof of account
  ownership via OAuth, then the directory reads account age/activity/history as
  the actual signal (owning the account proves little on its own; a 3-day-old
  LinkedIn is not the same signal as a 10-year-old one). Works from a browser —
  no native app required.

### Device sacrifice
- **TPM (Windows), Play Integrity (Android), App Attest (iOS/macOS)** — platform
  attestation that binds the *specific physical device* to the account, and the
  directory enforces one-account-per-device against it. **This is the one class
  that structurally requires a native app.** A browser has no API to ask the OS
  "attest that this hardware chip is real and unique" — that capability only
  exists inside a native app talking directly to the platform's attestation
  service. WebAuthn (above) proves you hold *a* device capable of signing; device
  attestation proves you hold *this specific, singular* device and burns it against
  one account. That's the distinction: WebAuthn is reusable across accounts,
  device attestation is not — it's the sacrifice.

---

## Class 2 — Network Graph

*"Who I know that knows you."* The one **relative** signal — it only means
something in relation to the specific checking party, which is what makes it
structurally hard to farm (see §5).

- **Connection endorsements** — pre-computed, signed vouches from other agents.
  Client-held: signed, hashed, stored locally, verified via hash lookup (no
  round-trip needed at connection time). At connection time, PSI (Private Set
  Intersection) checks whether Alice's endorsers overlap with Charlie's own
  contacts — without either side exposing their full contact list to the other.
  This is the *only* signal in Class 2. (TrustRank / seed-node distance was
  originally proposed here and is formally deprecated — do not reintroduce it.)

---

## Class 3 — Track Record

*"Degree of successful usage over time."* Absolute signal, computed from the
agent's own conversation history.

- **Conversation / transaction count** — raw volume over time.
- **Clean-close rate** — fraction of sessions that sealed with a CLEAN attestation
  vs. disputed/aborted.
- **Dispute rate** — inverse framing of the above, tracked separately because a
  low count of disputes matters even at low volume.
- **Time on platform** — account age as a track-record input (distinct from SIM
  age, which is about the phone number, not the agent's registration date).

---

## Class 4 — Economic Stake

*"Real capital at risk."* Absolute signal; voluntary unless a specific connection
policy demands it.

- **Connection bonds** — a bond posted by the requester, forfeitable on bad
  behavior. Two modes: **voluntary** (offered as a trust signal to look more
  serious) or **defensive** (a receiver's policy requires one before they'll even
  consider the request).
- **Connection staking** — capital an *institution* posts to defend an open
  connection policy against spam/DDoS at scale, rather than per-connection bonding.
- **Flat connection fees** — a small fixed cost per connection attempt; cheap
  enough not to block real users, expensive enough to deter high-volume
  time-wasting (creative-LLM spam included).

---

## 5. Related, but NOT trust signals

Two things sit right next to this taxonomy and get confused with it. Neither
belongs in the four classes above.

### Anti-Sybil / anti-farming measures (directory-internal policing, not a display signal)

These are computed by the directory to *catch reputation farming* (clusters of
agents endorsing/transacting only with each other to fake the signals above).
They are Layer 2 (node integrity) in the security architecture, not Layer 4
(trust signals) — and at least one of them (conductance) is explicitly **not
exposed externally**, because publishing the raw score would let an attacker
tune their cluster topology to stay just under the detection threshold.

- **Conductance-based cluster scoring** — for an agent's 1-hop endorsement/
  transaction neighborhood, what fraction of edges point *outside* the
  neighborhood. An insular farming ring has almost all edges pointing inward —
  low conductance, easy to flag even with some real "noise" transactions mixed in.
- **Counterparty diversity ratio** — flags an agent whose transactions are
  concentrated among a small, repeated set of counterparties instead of a broad
  set — a signature of round-robin farming.
- **Temporal anomaly / burst detection** — flags coordinated timing patterns
  (e.g. a batch of agents all transacting in the same narrow window), a signature
  of scripted farm setup rather than organic use.
- **Diminishing transaction returns** — not a signal at all, but a *dampener*:
  repeated transactions with the same counterparty count for progressively less
  toward Class 3 track record, so farming the same pair back and forth doesn't
  inflate the score.
- **Endorsement rate limiting** — caps how many endorsements one agent can issue
  in a period, so a single account can't mass-produce Class 2 signals for a farm.

**Doc-drift note:** `frontend.md` and the earlier M8 journey doc (`03-trust-signals.md`)
list conductance/diversity/temporal-anomaly as if they were displayable "Class 2
network graph signals." That conflicts with `server-infrastructure.md`'s own
statement that conductance stays internal. Resolve this explicitly when M10 stories
are written — these do not belong in the Class 2 UI.

### Contact tier (reachability classification, not a signal at all)

`blocked < unknown < known < whitelisted < vip` — a classification **you** assign
to a contact, governing whether/how they reach you when you're unattended. It
never affects security screening (every message is always screened regardless of
tier) and it is not something a counterparty presents about themselves. Defined in
`user-stories/m8c/2026-07-10_contact-address-book-design.md`.

---

## Sources

Not every source below is *about* trust signals — some are dedicated to the topic
end to end; others are about a broader subject (Sybil defense, connection policy,
infrastructure, the address book) and only cover trust signals as part of that.
Marked accordingly so you know how much of each doc is actually on-topic.

**Dedicated to trust signals:**
- `discussion_logs/2026-04-11_1400_security-architecture-layers-and-trust-signal-classes.md` — canonical four-class definition
- `discussion_logs/2026-04-13_1000_device-attestation-reexamination.md` — WebAuthn vs. device-attestation distinction
- `discussion_logs/2026-05-16_0800_trust-signal-verification-architecture.md` — OAuth/social verification architecture
- `discussion_logs/2026-04-10_1000_connection-endorsements-and-attestations.md` — endorsement system (Class 2)
- `discussion_logs/2026-04-10_1200_psi-for-endorsement-intersection.md` — PSI mechanism behind endorsement matching
- `discussion_logs/2026-04-14_1500_deprecate-trust-seeders-and-trustrank.md` — why TrustRank/Trust Seeders are excluded from Class 2
- `user-stories/m8/journeys/03-trust-signals.md` — M8 scaffold scope (what's live vs. placeholder today)

**Broader topic, trust signals covered as a part of it:**
- `discussion_logs/2026-04-11_1000_sybil-floor-and-trust-farming-defenses.md` — primarily anti-Sybil/anti-farming defense (§5 above); SIM age/carrier signal is the one piece that's a genuine Class 1 trust signal, buried inside an otherwise Layer-2 policing doc
- `discussion_logs/2026-04-18_1357_connection-bond-usage-and-policy.md` — primarily connection-policy design (intent declaration, interaction scope); bonds-as-trust-signal is one mode discussed, not the doc's main subject
- `discussion_logs/2026-04-08_1900_connection-staking-and-institutional-defense.md` — primarily institutional DDoS/Sybil defense economics; staking-as-signal is a side effect of that mechanism, not its purpose
- `user-stories/m8c/2026-07-10_contact-address-book-design.md` — primarily the contacts/address-book schema; only §5 (tier) is relevant here, and only to establish tier is *not* a trust signal
- `server-infrastructure.md` — primarily infra/DB requirements across the whole protocol; the one relevant fact is the conductance internal-only constraint used in §5 above

---

## Related Documents

- [[M10-TRUST-SIGNAL-STORAGE-AND-CREATION|M10 Trust Signal Storage & Creation]] — the HOW companion to
  this WHAT: envelope, dumb directory, scan-before-hash, supersession, zero-bump extensibility.
- [[M10-PROCEDURE]] / [[M10-DEFINITION-OF-DONE]] / [[M10-BUILD-JOURNAL]] / [[M10-TYPE-PLAYBOOK]] —
  the milestone apparatus that implements the two spec-of-record docs.
- [[2026-04-11_1400_security-architecture-layers-and-trust-signal-classes|Security Architecture Layers and Trust Signal Classes]] —
  the canonical four-class definition this taxonomy expands.
- [[2026-05-16_0800_trust-signal-verification-architecture|Trust Signal Verification Architecture]] —
  the OAuth/social verification architecture behind the Class 1 social-account signals.
- [[2026-04-14_1500_deprecate-trust-seeders-and-trustrank|Deprecate Trust Seeders and TrustRank]] — why
  Class 2 contains only endorsements; TrustRank is formally excluded.
- [[2026-07-10_2102_referral-and-commercial-use-cases|Referral and Commercial Use Cases]] — parked
  Class-2 ideation: the referral/commerce family endorsements enable.
- [[2026-07-10_contact-address-book-design|Contact Address Book Design]] — defines contact tier, cited
  in §5 to establish that tier is *not* a trust signal.
