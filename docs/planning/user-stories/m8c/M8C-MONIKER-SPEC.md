---
name: M8C Moniker Identity Resolution — Spec
type: spec
date: 2026-07-09
milestone: M8C
status: open
topics: [monikers, contacts, notifications, doorbell, screening, identity, privacy, injection-defense, offer-frame, m8c, m9]
description: >
  Implementation spec for human-readable "who" in CELLO. Turns the pubkey anchor into a legible name
  via a three-tier resolution — local moniker (my address book) → offered moniker (sender-supplied on
  the session offer) → short pubkey fingerprint — and feeds it to the notification/doorbell layer so a
  push says "Session request from Bob" instead of "session 40e3b8ee… for Ms_Chelly is now created".
  Realises Decision #3 ("Monikers on Session Offer") and the moniker model from the Inbound State
  Matrix. This is the buildable slice; the full relationship×availability matrix stays M9/CONFIG-1.
---

# M8C — Moniker Identity Resolution (Spec)

## 1. Purpose

Every notification and screening decision today keys on a raw Ed25519 public key. A doorbell reads
`CELLO: session 40e3b8ee12ab… for Ms_Chelly is now "created"` — machine output: it leads with a
truncated session ID, names the *receiver* (not the counterparty), and shows nobody a human can act on.

This spec makes the **counterparty legible** without weakening the cryptographic anchor. It defines a
single resolution function that every human-facing surface (notifications first, screening and
`contact_list` next) calls to turn a pubkey into a name, and the two producers that feed it: the
operator's **local address book** and a **sender-supplied moniker carried on the session offer**.

## 2. Source of truth

- **[[2026-07-08_inbound-state-matrix]] — Decision #3 "Monikers on Session Offer"** and the model line
  (§"Sender Relationship"): *"Monikers (pet names / synonyms) are local overrides to make identity
  human-readable. We do not enforce moniker uniqueness; the public key is the anchor."* This spec is the
  buildable realisation of that decision.
- Supersedes the naming/"who" discussion in [[2026-07-07_1700_four-level-screening-policy]] (itself
  replaced by the matrix). That log's "who is calling?" dimension is answered here.
- Motivating surface: the doorbell copy in `cello-client/core/adapter-claude-code/src/channel-params.ts`
  and DOD-INV-CONTENTFREE routing-metadata allowance (agent name, session label — D6).

## 3. The model — one anchor, three-tier legibility

The public key is the **only** identity. A moniker is a *display override*, never identity. Resolution,
in strict precedence:

```
whoLabel(agentName, pubkey, offeredMoniker) =
     localMoniker(agentName, pubkey)      // MY name for them (address book) — always wins
  ?? sanitize(offeredMoniker)             // what THEY asked to be called (self-asserted, untrusted)
  ?? fingerprint(pubkey)                  // "agent 178d420b…" — last resort, never blank
```

Three non-negotiable properties:

1. **Local wins.** If the operator has their own name for a pubkey, a sender can never override it.
2. **Offered is a claim, not a fact.** A sender-supplied moniker is attacker-controlled free text. It is
   displayed *marked as self-asserted* (see MONIKER-6 copy) and is **sanitized** before it ever reaches
   an LLM context (MONIKER-7). It is bound to the sender's key, but "bound" means *attributable*, not
   *true* — two different keys may both claim "Support".
3. **Uniqueness is never enforced.** Monikers collide freely; the pubkey disambiguates. No index, no
   "moniker already taken" error, no directory registration of monikers.

## 4. Scope

**In scope (this spec — shippable independent of the M9 matrix):**
- `contacts.moniker` column + the resolution function + notification consumer.
- Per-agent self-moniker ("what I call myself") and its carriage on the outbound offer.
- Receiver-side extraction, sanitization, and storage of the offered moniker.

**Out of scope (stays M9 / CONFIG-1, tracked in the matrix):**
- The relationship×availability response matrix (Generic Reject, Answering Machine tiers, VIP/DND).
- *Whether* a given tier is allowed to push at all (intrusiveness policy). This spec only makes the
  push *legible* when one fires; it does not change which pushes fire.
- Any directory-side moniker storage or lookup. Monikers are client-local + offer-carried only.

## 5. Requirements

Each story is E2E-first, TDD (red before green), observability ACs mandatory. IDs are `MONIKER-N`;
proposed DoD lines in §10.

### MONIKER-1 — Local address book carries a moniker
**Producer: the contact store.**
- **AC1** The `contacts` table gains a nullable `moniker TEXT` column via an **additive, backward-compatible**
  client-side SQLite migration (existing rows → `NULL`; no data loss; idempotent). Ref: `contacts
  (agent_name, pubkey, added_at)` in `session-node-manager.ts` `addContact`/`listContacts`.
- **AC2** `addContact(agentName, pubkey, moniker?)` persists the moniker when provided. Re-adding an
  existing contact **updates** the moniker if a new non-null one is given, otherwise leaves it (the
  existing "idempotent, never refresh `added_at`" rule holds for `added_at`; moniker is separately
  settable).
- **AC3** `listContacts` and `isContact`'s callers can read the moniker; `cello_contact_list` returns
  `{ pubkey, added_at, moniker }`.
- **AC4** `cello_contact_add` accepts an optional `moniker` param (validated per MONIKER-7 charset/length)
  and `cello_contact_set_moniker(pubkey, moniker)` (or equivalent) lets the operator rename later.

### MONIKER-2 — Self-moniker ("what I call myself")
**Producer: the initiator's identity.**
- **AC1** Each agent has an operator-settable self-moniker persisted per-agent (agents table or the
  daemon config store). Null by default.
- **AC2** A command surface exists to set it (`cello_set_self_moniker` / `cello create-agent --moniker`).
- **AC3** Setting it is local only — it is **never** sent to the directory and never registered. It is
  read only at offer-construction time (MONIKER-3).

### MONIKER-3 — Offer frame carries the sender's moniker
**Producer: the initiate path.**
- **AC1** The outbound session **offer/assignment** payload gains an optional `moniker` field populated
  from the initiator's self-moniker (MONIKER-2). Absent self-moniker → field omitted (never empty
  string). Ref seam: the assignment consumed by `extractInboundSessionAssignment` (`daemon.ts`).
- **AC2** The moniker sits **inside the sender-signed portion** of the offer, so the relay/directory
  cannot alter or inject it in transit. Verification failure on the signed offer rejects the whole offer
  (unchanged); a tampered moniker therefore cannot be surfaced. ("Bound to the key" = attributable to the
  signer, not asserted-true.)
- **AC3** Length/charset are enforced at **construction** as well as receipt (defense on both ends) per
  MONIKER-7.

### MONIKER-4 — Receiver extracts and stores the offered moniker
**Consumer of the offer; producer for resolution.**
- **AC1** `extractInboundSessionAssignment` reads `moniker` off the offer (typed, optional) and
  `InboundSessionEvent` carries `offeredMoniker?: string`.
- **AC2** The offered moniker is **sanitized on receipt** (MONIKER-7) before storage or display — never
  trust the wire.
- **AC3** The offered moniker is **not** silently written into the contacts address book. It is display
  material for *this* offer/session only. Promotion to a stored local moniker requires an operator action
  (contact add / accept / rename) — mirrors CC-1 ("known is a deliberate boundary, not auto-filled").
  *(This keeps the moniker system from re-opening the auto-add hole CC-1 closed.)*

### MONIKER-5 — The resolution function
**The single consumer entrypoint.**
- **AC1** A pure `whoLabel(agentName, pubkey, offeredMoniker?)` implements the §3 precedence exactly:
  local moniker → sanitized offered moniker → fingerprint. Total function; never throws; never returns
  empty.
- **AC2** `fingerprint(pubkey)` = a short, stable, human-distinguishable form (e.g. `agent 178d420b…`),
  labelled as an agent id, not bare hex.
- **AC3** Unit tests cover all three tiers, the collision case (two keys, same offered moniker → both
  resolve, disambiguated by fingerprint when no local moniker), and the local-wins-over-offered case.

### MONIKER-6 — Notification consumer + copy rewrite
**The launch-visible payoff.**
- **AC1** The daemon dispatcher resolves `whoLabel(...)` and adds a `who` field (+ a boolean
  `whoSelfAsserted` when the label came from the offered moniker, not a local one) to the
  `session_state_changed`, `cello_session_request`, and `cello_message` frames. `counterpartyPubkey`
  stays on the frame as the anchor (routing metadata). Refs: `notification-dispatcher.ts`
  `dispatchSessionStateChanged` / `dispatchCelloMessage`.
- **AC2** The shim `doorbellText` (`channel-params.ts`) is rewritten to: **lead with `who`**, use plain
  verbs, **drop the session ID from the body** (IDs stay as `<channel>` `meta` attributes only), and
  **stop running names through `short()`** (only pubkey fingerprints get truncated). Copy table:

  | Event | Copy |
  |---|---|
  | incoming request | `📞 CELLO — {who} wants to connect with {yourAgent}. Run cello_await_session to accept.` |
  | session establishing | `🔗 CELLO — connecting to {who}…` |
  | session active | `✅ CELLO — you're connected to {who}.` |
  | session sealed | `🔒 CELLO — session with {who} sealed. Receipt saved.` |
  | session closed | `👋 CELLO — {who} ended the session.` |
  | new message | `📩 CELLO — {who} sent a message. Run cello_receive to read it.` |
  | agent online/offline | `CELLO — {yourAgent} is now {online/offline}.` |

- **AC3** When `whoSelfAsserted` is true, the label is visually marked as a claim (quotes, e.g.
  `"Bob" (unverified)` — final rendering TBD in build) so a moniker is never mistaken for verified
  identity.
- **AC4** DOD-INV-CONTENTFREE holds: `who` is routing metadata (a name), never message content or
  content-derived text. The sanitizer (MONIKER-7) guarantees it carries no smuggled payload.

### MONIKER-7 — Untrusted-moniker sanitization (SECURITY — injection defense)
**This is the load-bearing security AC. The offered moniker is attacker-controlled text that lands in an
operator's LLM context via the channel — exactly the injection surface CELLO exists to defend.**
- **AC1** A single `sanitizeMoniker(raw): string | null` is the only path from wire/param to storage or
  display. Applied to both the offered moniker (MONIKER-4) and the `contact_add` param (MONIKER-1).
- **AC2** Enforces: max length (e.g. 40 chars), an allowlist charset (letters, digits, space, `_ - .`,
  and a constrained set — **no** control chars, newlines, or markup/prompt-control sequences), NFC
  normalization, trim. Reject (→ `null`, fall through to fingerprint) rather than best-effort mangle when
  a value is out of policy.
- **AC3** No moniker value can inject channel-tag structure or Claude control tokens: the sanitized string
  is safe to embed in the `<channel>` body and in `contact_list` output. A red-team test feeds
  markup/prompt-injection/newline/emoji-bomb monikers and asserts they are rejected or neutralised and
  never alter surrounding context.
- **AC4** Observability: a rejected moniker logs `moniker.rejected` with `{ agentName, pubkey, reason }`
  (never the raw value at info level).

### MONIKER-8 — Surfacing in existing tools
- **AC1** `cello_contact_list` shows the moniker column; `cello_list_sessions` / notification checks show
  the resolved `who` for each counterparty.
- **AC2** Nothing in this spec changes screening *outcomes* (known/unknown, ABUSE-1 caps, CC-1 promotion
  rules). It only changes how the counterparty is *labelled*. A test asserts screening decisions are
  byte-identical with and without a moniker present.

## 6. Data & protocol changes (concrete)

- **SQLite (client-local):** `ALTER TABLE contacts ADD COLUMN moniker TEXT` (nullable). Self-moniker:
  a nullable column on the agents table or a config-store key. Both additive; migration must report
  zero checksum errors on prior migrations.
- **Offer/assignment frame:** add optional `moniker` inside the signed offer payload. Backward-compatible:
  an older initiator omits it → receiver resolves via local-or-fingerprint; an older receiver ignores an
  unknown field. No protocol-version bump required (additive, optional).
- **Notification frames:** add `who` (string) + `whoSelfAsserted` (bool) to the three counterparty-bearing
  doorbell types. `counterpartyPubkey`/`from` remain.
- **Publish cascade:** this is a cello-client change (daemon + shim). Ships via `/cello-publish` — bump the
  affected `core/*` packages, tag, promote to `latest` (WE PROMOTE, WE DO NOT PIN). A DoD line is not ✅
  until the published `connect`/`cli` carry it and a live channels session shows the new copy.

## 7. Observability ACs

- `moniker.resolved` (debug) — `{ agentName, pubkey, source: "local"|"offered"|"fingerprint" }`.
- `moniker.rejected` (info) — `{ agentName, pubkey, reason }`, never the raw value.
- `contact.moniker.set` (info) — `{ agentName, pubkey }` on add/rename.
- Existing `contact.added` / notification dispatch events gain no PII; monikers are not logged at info.

## 8. Test plan

- **Unit:** `whoLabel` precedence (all 3 tiers + collisions + local-wins), `sanitizeMoniker` (charset,
  length, normalization, the injection red-team battery), migration up on a populated DB.
- **Fixture / spine (daemon layer):** extend `packages/e2e-tests/src/session-fixture.ts` (never a
  from-scratch fixture): an initiator with a self-moniker offers → assert the receiver's
  `session_state_changed`/`cello_session_request` frame carries the correct `who` + `whoSelfAsserted`;
  a receiver with a local moniker for that pubkey → assert local wins; no moniker anywhere → assert
  fingerprint. Assert screening outcomes unchanged (MONIKER-8 AC2).
- **Live `claude --channels` (in-context hop — required for close):** two real agents; the doorbell in
  Claude's context reads the new legible copy with the counterparty's name, and a crafted injection
  moniker is neutralised in-context.

## 9. Failure integrity

- Missing self-moniker, missing offered moniker, unresolvable pubkey → **fingerprint**, never blank,
  never a thrown error, never a silent drop of the notification.
- A rejected (unsafe) moniker → fingerprint + `moniker.rejected` log. The system fails **legible and
  loud**, not silent.
- The offered moniker is display-only for the offer/session; it must not silently mutate the address book
  (MONIKER-4 AC3) — no re-opening of the CC-1 auto-add boundary.

## 10. Proposed DoD lines (thread into M8C-DEFINITION-OF-DONE)

- **DOD-MONIKER-1** — `contacts.moniker` + self-moniker persisted; `contact_add`/`set_moniker` accept and
  validate a moniker. ❌
- **DOD-MONIKER-2** — Offer frame carries the signed, optional sender moniker; receiver extracts +
  sanitizes it onto `InboundSessionEvent`. ❌
- **DOD-MONIKER-3** — `whoLabel` three-tier resolution, pure + total, unit-proven incl. collisions. ❌
- **DOD-MONIKER-4** — Doorbell/notification copy rewrite consuming `who`/`whoSelfAsserted`; proven LIVE in
  a channels session (legible name, session ID out of the body, self-asserted marked). ❌
- **DOD-MONIKER-5** (SECURITY) — `sanitizeMoniker` neutralises the injection red-team battery; a
  malicious moniker never alters LLM context and never breaks the channel tag. ❌
- **DOD-MONIKER-6** — Screening outcomes byte-identical with/without monikers (label-only change). ❌

## Related Documents

- [[2026-07-08_inbound-state-matrix|Inbound State Matrix]] — the parent design; Decision #3 and the
  moniker model this spec implements. The full relationship×availability matrix stays M9/CONFIG-1.
- [[2026-07-07_1700_four-level-screening-policy|Four-Level Screening Policy]] — the superseded 1D model;
  its "who is calling?" dimension is answered here.
- [[M8C-DEFINITION-OF-DONE]] — DOD-INV-CONTENTFREE (routing-metadata allowance the `who` field rides on),
  DOD-CONTACT-1 (the whitelist this extends), and the proposed DOD-MONIKER-N lines above.
- [[M8C-DECISIONS]] — CC-1 (deliberate-trust-boundary rule MONIKER-4 AC3 preserves), D6 (session label as
  routing metadata), D14/D15/CONFIG-1 (the M9 config home for the deferred matrix).
- [[M8C-SPEC]] — parent M8C scope (command surface, notifications, reactive messaging).
