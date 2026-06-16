---
name: M7 — Seal & Content-Delivery Gaps — Problem & Remediation Plan
type: remediation-plan
date: 2026-06-15
updated: 2026-06-16
topics: [unilateral-seal, content-delivery, desync, message-recovery, frost-notarization, seal-semantics, acknowledgement-frontier, auto-acknowledge, receipt-not-assent, process, postmortem, remediation, m7]
status: open
description: >
  Actionable. Three verified system-level gaps surfaced while tracing interrupted-session
  behavior during M7-SESSION-001 review: (1) unilateral seals produce no signed
  certificate, (2) missed message content is never resent — the session is killed
  instead, and (3) the intended unilateral→bilateral upgrade depends on recovery that
  is only half-built. None is a bug in a single story; each lives BETWEEN stories. This
  document is the postmortem (evidence + the two process root causes that let all
  three pass every gate), the remediation plan (decisions, workstreams, dependency
  order, process actions), AND — appended 2026-06-16 — Part 3, the design conclusions
  from a working session that traced the actual close-and-seal code and reasoned the
  seal's meaning from first principles: what a seal attests, why content is a
  precondition not a feature, and the auto-acknowledge simplification.
---

# M7 — Seal & Content-Delivery Gaps — Problem & Remediation Plan

This document has two halves. **Part 1 (the problem)** is the verified evidence and the
two process root causes — read it to understand *what* and *why*. **Part 2 (the plan)**
is the actionable remediation — the decisions to make first, four workstreams each
specified enough to write a story from, the dependency order, and the process actions.

---

# Part 1 — The Problem

## How this was found

Not by a test, a review, or a gate. By tracing the user's journey out loud:
*"A is chatting with B, A closes the laptop, B keeps talking, it times out and seals —
what does A actually have when they come back an hour later?"* Walking that single
question through the code surfaced all three gaps below. That is itself the headline
finding: **nothing in the process verifies system-level behavior, so anything living
between stories is invisible until someone narrates the journey.**

Every individual story cited below passed its own ACs, lint, typecheck, and review.

---

## Gap 1 — A unilateral seal produces NO signed certificate

**Verified behavior.** `#processSealUnilateral`
(`packages/directory/src/directory-node.ts:2585-2707`):
- Records the submitter's **self-reported** root on faith —
  `sealed_root: frame.reported_root` (2627-2631). No tree rebuild, no signature
  verification, no root check.
- Runs **no FROST ceremony**, produces **no signature**, and **never writes a
  `SealNotarization`** (the handler ends at 2707 with no `recordNotarization` call).
- The absent party's notification (`SealUnilateralNotification`,
  `directory-types.ts:303-309`) carries only `{ session_id, sealed_root, sealed_at,
  seal_type }` — **unsigned metadata**. The submitter's confirmation
  (`SealUnilateralConfirmed`, 293-298) is likewise unsigned.

**Contrast — the bilateral seal** (`processSeal`, `directory-node.ts:2714+`):
- **Rebuilds and verifies the entire signed Merkle chain** (2722-2749).
- Produces and **persists a signed `SealNotarization` with a `frost_signature`**
  (2830-2844). `SealNotarization.frost_signature` is mandatory
  (`packages/interfaces/src/directory-store.ts:46-53`).

**Spec divergence.** PERSIST-015 (`m4/CELLO-PERSIST-015.yaml`, behavior 28-32 /
AC-001) says the directory shall *"write one row to conversation_seals … with
seal_type=UNILATERAL"*. `conversation_seals` == `SealNotarization`, which requires a
`frost_signature`. **The code never writes that row.** So the spec said "notarize it";
the implementation produced an in-memory bookkeeping entry plus an unsigned notice.

**Consequence.** The absent party (and even the present party) walk away with the
directory's **unsigned word over an authenticated channel**, on a root the directory
**never verified**. It is not "one attestation vs. two" — it is *an unsigned note vs.
a chain-verified, signed certificate*. A unilateral seal is currently worthless as
portable proof.

---

## Gap 2 — Missed message *content* is never resent; the session is killed

**Architecture (MSG-004, M1).** Two independent channels: **content** peer↔peer on
`/cello/content/1.0.0`, **hashes** client↔relay on `/cello/relay/1.0.0`, cross-checked
on receipt. The relay only ever sees `content_hash`, never plaintext (`Structure2`,
`core/protocol-types/src/structure2.ts:13-40`). Privacy model intact.

**Verified behavior on missing content**
(`cello-client/core/client/src/relay-stream-manager.ts`):
- A hash (`leaf_deliver`) arriving without its content starts a grace timer
  (`contentGraceMs`). On expiry the callback calls
  `#desync(sessionIdHex, "content_missing")` (683-689).
- `#desync` (805-839) sets `session.desynchronized = true`, **drops all pending
  state, fails in-flight acks, logs a WARN.** Once desynchronized the session stops
  processing frames entirely (442). It is **terminal — the session is dead.**
- A broad search for any resend / request-content / ping-sender / "are you there"
  path returns **nothing**. The spec's active-recovery tree (branch B2: ping sender →
  resend) does not exist in code.

**This was a deliberate scope-down, then an untracked deferral.** MSG-004
(`m1/CELLO-MSG-004.yaml:124-128`) explicitly chose: *no matching content within
`delivery_grace_seconds` → mark session `desynchronized`*. The richer recovery tree
was fully explored in the design log
(`discussion_logs/2026-04-08_1530_message-delivery-and-termination.md`, branches
B1-B4) and **never carried into any story** (confirmed across all M0-M9 outlines).
That same log's governing principle — verbatim — is *"the hash is evidence of intent,
not of communication"* (B4b): the system deliberately proves you *sent* a message,
not that the peer *received* it. That principle is sound; the missing piece is the
*best-effort recovery* that was supposed to sit on top of it.

**Consequence.** A peer that misses content does **not** get it redelivered (no
WhatsApp/Signal-style catch-up). On reconnect it drains the queued **hash**, the
content never comes, and after `contentGraceMs` the **session desyncs and dies.**

---

## Gap 3 — The unilateral→bilateral upgrade depends on recovery that is half-built

A bilateral seal requires both parties at the **same** root. If the present party
sealed at a root that includes a message the absent party never received, the absent
party must obtain that message's **leaf** to reconstruct the root.

**Hash recovery exists** (two tiers):
- Relay delivery queue — keyed by **recipient pubkey**, not session, so it survives
  session teardown (`relay-store.ts:60`, `destroySession` only deletes `#sessions`
  at 94-96). But it is **bounded** (drops oldest on overflow, 104-106) and
  **in-memory** (lost on relay process restart).
- `gap_fill_request` — **WAL-backed**; returns `RELAY_SESSION_UNRECOVERABLE` when the
  WAL is unavailable.

**Content recovery does NOT exist** (Gap 2). So a returning peer can recover enough
to *seal the hashes*, but **cannot recover the actual conversation** — and if hash
recovery also fails (queue dropped + WAL gone), it cannot even reach the seal root.
The "upgradeable" design therefore rests on a recovery layer that is partial for
hashes and absent for content.

> NOTE — relay WAL durability (where it is stored, retention, whether it is wired in
> every deployment) was **not** verified in this session. It is load-bearing for the
> upgrade design and must be confirmed.

---

## Intended behavior decided this session (canonical)

1. **A unilateral seal must be a thing of value on its own.** We can never assume the
   other side returns — and in the worst (malicious) case they deliberately never do.
   So a unilateral seal must produce a **FROST notarization** (a real, verifiable
   certificate), not an unsigned note.
2. **A unilateral seal must be upgradeable to bilateral** when the absent party
   returns and adds their attestation. (This contradicts PERSIST-015 SI-002 as
   written — "a unilateral seal shall not be supplemented by a bilateral seal" — so
   that invariant must change.)
3. **What a seal attests is unchanged:** each party signs only what it sent; a hash
   with no delivery proves composition + submission + ordering, *not* receipt. This is
   accepted and intentional.

---

## Process root causes

These three gaps are not three mistakes. They are two process failures.

**RC-1 — Deferrals have no home.** "Deferred to a later milestone" lived only in a
discussion log and the implicit reading of one story (MSG-004). No backlog item, no
future story, no owner, no target milestone. The 2026-04-08 log even ends with an
explicit "Open questions" list (incl. *"directory reconciliation after outage — what
if they disagree?"*) that was never driven to closure. Deferred design intent
**evaporates** because nothing carries it forward.

**RC-2 — Verification stops at the story boundary.** The unit of specification and
verification was always the individual story. No artifact ever owned the question
*"trace a real conversation through interruption and recovery — does it work end to
end?"* The E2E stories test happy-path ACs, not adversarial journeys (peer drops,
returns later, content missing, malicious shutdown). So:
- Gap 1 = spec→implementation drift, **unguarded by any test** asserting the spec'd
  notarization.
- Gap 2 = a deliberate deferral, **untracked** and never re-storied.
- Gap 3 = an emergent property of 1 + 2 that **no single story could see.**

The common thread: behavior that lives *between* stories is invisible to a
per-story process.

---

## Countermeasures

1. **A deferral / open-question register.** Every "deferred to later milestone" in a
   story and every "open question" in a discussion log becomes a tracked item with an
   owner and a target milestone — not prose. A milestone cannot close with unresolved
   items silently inherited.
2. **End-to-end behavioral walkthroughs as a close gate.** Before a milestone closes,
   walk the user's journey through the adversarial paths and verify *actual* behavior,
   not per-story ACs. The canonical set for messaging: (a) peer drops mid-conversation
   and returns later, (b) content arrives without hash and vice versa, (c) one side
   seals unilaterally, (d) malicious peer disappears permanently. Each must have a
   verified, documented outcome.

---

---

# Part 2 — The Remediation Plan

Each workstream below is specified enough to write a story directly from it. There is a
hard dependency order: **three decisions must be made before any story is written**, and
the content-delivery architecture decision (D-1) gates the most.

## Decisions to make FIRST (before any story)

### D-1 — Content recovery: pure P2P resend vs. encrypted store-and-forward
The linchpin. The relay sees only hashes (privacy invariant), so recovering missed
*content* can be done two ways:
- **(a) Pure peer-to-peer resend** — receiver asks the sender to resend; sender must be
  reachable. Preserves the privacy model exactly (no infra ever holds content). **Fails
  the offline-sender case** (laptop closed, malicious shutdown) — precisely the case
  that matters most.
- **(b) Encrypted content mailbox** — an infra component stores *ciphertext* the
  recipient later pulls; infra cannot read it (end-to-end encrypted, keyed to the
  recipient). Works when the sender is offline, at the cost of a new component holding
  encrypted content plus stored-for-whom metadata.

To evaluate: a **hybrid** — P2P resend when the sender is online, encrypted mailbox as
the durable fallback. This decision shapes Workstreams B and C and must be resolved in a
focused design session before they are storied.

### D-2 — FROST signer set for a unilateral seal
The notarization signature is produced by the **directory** (FROST threshold, or the M1
single-key fallback — `directory-node.ts:2827-2844`), **not** by the participants. If
that holds, a unilateral seal CAN produce a real FROST notarization with the counterparty
absent (the present party coordinates the ceremony with the directory threshold; the
absent party is recorded ABSENT). **Confirm the signer set** before Workstream A.

### D-3 — Upgrade dispute outcome
When an absent party returns to upgrade a unilateral seal but its reconstructed root
**disagrees** with the sealed root (couldn't recover content/leaves, or tampering), what
happens? Define the outcome before Workstream C.

## Workstream A — Unilateral seal becomes a real notarization
Closes Gap 1. Depends on D-2.
- Directory **verifies** the submitter's reported root against its own hash-chain / MMR
  record — rejects a root it cannot reproduce (stop trusting `reported_root`).
- Runs the notarization ceremony (FROST threshold per D-2), records the counterparty
  `ABSENT`, and **persists a signed `SealNotarization`** with `seal_type` distinguishing
  UNILATERAL.
- `SealUnilateralConfirmed` (present party) and `SealUnilateralNotification` (absent
  party) carry the **certificate** (or a verifiable reference to fetch it).
- Touchpoints: `directory-node.ts#processSealUnilateral`, the `DirectoryStore`
  notarization write, `directory-types.ts` (add cert fields to both frames).
- AC sketch: (1) reported root not matching the directory's chain → rejected; (2) a
  persisted, signature-valid `SealNotarization` exists after a unilateral seal; (3) the
  absent party's notification verifies *without* trusting the channel; (4) PERSIST-015's
  "write conversation_seals" is finally satisfied.

## Workstream B — Content recovery instead of desync
Closes Gap 2. Depends on D-1.
- On hash-without-content past grace: **attempt recovery** (per D-1) instead of
  `#desync`. Desync only on genuine *tamper* (`content_hash_mismatch`), never on mere
  absence.
- Define the arrival-time policy (accept / accept-late-flagged / discard) from the
  delivery-design time-dimension table.
- On reconnect after offline: deliver missed content (per D-1), not just hashes.
- Distinguish resend from replay at the protocol level (design-log open question 5).
- Touchpoints: `relay-stream-manager.ts` (`content_missing` path 683-689; `#desync`
  policy 805-839); a new content-request/resend frame; and — if D-1 picks (b) — a new
  encrypted-mailbox component.
- AC sketch: (1) hash-without-content within grace → recovery, not desync; (2) successful
  recovery → message accepted, local tree consistent; (3) sender-unreachable → defined
  fallback, session NOT killed; (4) offline peer returns → missed content delivered and
  verified.

## Workstream C — Unilateral → bilateral upgrade
Closes Gap 3. Depends on A + B + D-3.
- Mark a unilateral seal upgradeable. On the absent party's return, they recover leaves +
  content, reconstruct the root, add their attestation, and the seal is **promoted to
  bilateral**.
- **Change PERSIST-015 SI-002** (which currently forbids supplementing a unilateral
  seal) — a deliberate invariant reversal, with its test inverted.
- Handle the disagreement case per D-3.
- AC sketch: (1) returning party reconstructs the sealed root and co-signs → notarization
  shows BILATERAL; (2) SI-002 updated, test inverted; (3) root-disagreement produces the
  D-3 outcome, not a silent failure.

## Workstream D — Verify relay WAL durability
Investigation, not a build (feeds B + C feasibility). Confirm the storage backend,
retention window, and whether the WAL is wired in every deployment (local / dev /
staging / production). Output: a short note in `infra/STATE.md` and a link here.

## Process actions (from the root causes — do regardless of the above)
- **P-1 (RC-1): stand up a deferral / open-question register.** Seed it from this
  document and from the 2026-04-08 delivery-design log's open-questions list. Rule: a
  milestone cannot close while carrying unresolved inherited items.
- **P-2 (RC-2): add an end-to-end behavioral walkthrough to the milestone close gate.**
  Canonical messaging journeys: (a) peer drops and returns later, (b) content without
  hash and vice versa, (c) unilateral seal, (d) malicious permanent disappearance. Each
  must have a verified, documented outcome — not just per-story ACs.

## Dependency order
```
D-1 (content architecture) ─┐
D-2 (FROST signer set) ──────┼─► A (notarize) ──┐
D-3 (upgrade dispute) ───────┘                  ├─► C (upgrade)
D-1 ──────────────────────────► B (recovery) ───┘
D (WAL) feeds B + C.
P-1, P-2 run in parallel, independent of everything above.
```

---

---

# Part 3 — Design Conclusions (working session, 2026-06-16)

Part 2 left three decisions open and treated content recovery as one workstream among
four. A working session then did two things the earlier pass had not: it **traced the
actual close-and-seal code path end to end**, and it **reasoned the meaning of a seal
from first principles** rather than from the code. The result resolves two of the three
open decisions, confirms the third as the *spine* of the whole effort, and adds one new
design change plus one new requirement. These conclusions supersede the corresponding
parts of Part 2 where they conflict.

## C-0 — Verified happy-path mechanics (ground truth)

Both parties online, A closes. The exact sequence, with anchors:

1. **A** calls `cello_close_session` → `initiateSessionSeal(...,"initiator")`
   (`cello-client/core/client/src/seal-manager.ts:237`). A builds a **SEAL ctrl leaf**
   (kind `0x02`) over its current tree root, Ed25519-signs it with `last_seen_seq` =
   the last thing A saw from B, submits the hash to the relay (`#submitSealLeaf`,
   348-444), **pushes the seal payload to B as content** for cross-check (432-436), then
   blocks on the FROST ceremony.
2. **B** receives A's SEAL leaf on the relay stream
   (`relay-stream-manager.ts:783-789`): flips `status → "sealing"` (B can no longer
   send) and enqueues a **`counterparty_closing`** event. **B does nothing else
   automatically** — it neither co-signs nor requests anything.
3. **B's agent must call `cello_close_session`** (guidance literally instructs it:
   `mcp-server.ts:651-655, 720-724`) → `initiateSessionSeal(...,"responder")` (134-200)
   → B submits **its own** SEAL ctrl leaf, `last_seen_seq` now covering A's close.
4. **The relay forwards only when two SEAL leaves from distinct senders exist**
   (`relay-node.ts:957-983`, `#maybeProcessSeal`) → `directory.processSeal`.
5. **Directory notarizes** (`directory-node.ts:2714+`): rebuilds + verifies the whole
   chain, identifies the **initiator** (A, sender of the first SEAL leaf) as FROST
   coordinator, pushes `seal_verified` **to A only** (2870-2905) → A runs the FROST
   ceremony → directory persists the `SealNotarization` and **pushes `session_sealed`
   to both**.
6. **Both parties auto-database it** (`seal-manager.ts:449-475, 625-635`). The
   notarization is *pushed*, never requested.

**The seam this exposes:** step 3 is **agent-volition-gated.** B is online and able to
co-sign instantly, but the bilateral seal completes only if B's *agent* chooses to call
close. If that agent is slow, busy, or crashed, A's ceremony times out → `seal_deferred`
→ eventually **unilateral** — despite B sitting right there with everything it needs.
See C-5.

## C-1 — What a seal means (canonical semantic)

A signature over a hash chain can prove exactly three things: these bytes existed, in
this order, delivered to/from me. It is **cryptographically incapable** of proving
agreement, intent-to-be-bound, or agent cognition — those are not properties of bytes.
Therefore:

- **A seal attests receipt + integrity + ordering of the transcript — NOT assent, and
  NOT that the receiving agent ever processed the content.** Receipt is byte-level
  delivery into the node's store, decoupled from the agent reasoning about it.
- **Agreement is always a separate, explicit act** — a reply *message* (its own signed
  leaf). The seal can never manufacture assent. "Sealed" must never be read, anywhere in
  protocol or UX, as "agreed."

The structure that realizes this is three-part and already partly built:
- **A's acknowledgement** = A's Ed25519 SEAL leaf.
- **B's acknowledgement** = B's Ed25519 SEAL leaf.
- **The notarization** = FROST (directory threshold, coordinated by the initiator).
  The counterparty is *not* a FROST signer; its sole contribution is the ack leaf.

## C-2 — The acknowledgement frontier and the tail

Each party has an **acknowledgement frontier**: the highest counterparty sequence number
it has signed an ack for (its `last_seen_seq` in its latest signed leaf). The
conversation is fully mutually acknowledged iff each frontier reaches the other party's
last message. Everything hard about an interrupted seal lives in the **tail** — messages
one side sent *after* the other side's frontier.

Two consequences:
- **Who sent the last message decides a unilateral seal's strength.** If the *absent*
  party sent it, the *present* party (its receiver) seals over it and the record is
  near-complete. If the *present* party sent it, the absent party never acked it and the
  tail is unacknowledged — the irreducible Two-Generals limit; no protocol fixes it
  unilaterally.
- **The certificate should publish frontiers, not collapse to a single "agreed" root.**
  "What each party provably received" is the load-bearing claim, and it already exists in
  `last_seen_seq` — it is simply never surfaced. See C-6.

## C-3 — The returning party signs; it does not passively receive

A returning absent party's **only possible contribution is an acknowledgement, and an
acknowledgement is a signature.** Merely receiving the directory's signed unilateral
notarization adds nothing (its frontier never moves) and forecloses dispute. So the
upgrade is the returning party **signing one new ack leaf over the sealed root** — not
re-signing the conversation, and not a passive download. This is why a unilateral seal
must be *upgradeable* (Workstream C) rather than terminal.

## C-4 — Content is a PRECONDITION, not a parallel feature (the spine)

The honest test for whether a party may seal a tail: **it holds the actual plaintext
behind every leaf in the sealed tree** — not just the hash.

- Recovers **content** → "it is in my store, available to look at" is *true* → it can
  honestly seal. ✅
- Recovers only the **hash** (relay queue / WAL) → the message is *not* in its store and
  *not* available to look at → sealing would attest to an opaque blob, which is **not**
  the meaning of a seal → it must **not** seal that tail; those leaves stay
  unconfirmed / counterparty-ABSENT.

This collapses Part 2's framing: **content recovery (Gap 2 / D-1) is not a workstream
beside the seal work — it is the precondition that makes the bilateral upgrade
*semantically possible at all*.** Hash-only recovery enables only a hollow ack. D-1 is
the spine; Workstream C cannot mean anything without it.

## C-5 — Auto-acknowledge replaces agent-mediated close (NEW design change)

Once A has submitted its SEAL leaf, B **cannot send anything further** — so in the happy
path there is nothing for B's agent to deliberate. The agent round-trip in C-0 step 3 is
pure ceremony and a robustness seam. Change it:

- **B's node auto-co-signs** the responder SEAL leaf the moment it ingests A's SEAL ctrl
  leaf **and has verified the content** — without waiting for the agent.
- `counterparty_closing` becomes a **notification** ("this session has closed"), not an
  instruction ("you must call close"). The agent's later processing of the final message
  is asynchronous and irrelevant to the seal.
- **Non-negotiable boundary:** "automatic" means **B's own local node signs without an
  agent prompt** — it does **NOT** mean the directory, the peer, or anyone else produces
  B's acknowledgement. Delegating or synthesizing B's ack would forge an attestation and
  violate the no-single-party-can-forge invariant. We remove the *prompt*, never the
  *signer*.
- **Verifiability gate:** auto-co-sign only what B can verify. If B is desynced, or the
  content cross-check fails (`relay-stream-manager.ts:461-478`), do **not** auto-sign —
  surface to the agent. That is the only case where `counterparty_closing` is a genuine
  decision point.

## C-6 — The seal protects against the malicious tail; legibility is the requirement

The adversarial case: A sneaks "…you agreed to send me $1000" in as the final message.

- **B is not bound.** B's seal attests delivery, not assent (C-1). The message shows A
  *asserting* it; the transcript shows **no B reply after it** — which is itself the
  evidence B never agreed. Sealing is therefore **protective**: it pins an immutable,
  ordered record proving A's claim was unilateral and unanswered. *Refusing* to seal
  would be worse — it leaves the record ambiguous.
- **The risk is misreading, not cryptography.** So the protocol must make
  **"receipt, not assent" a legible, first-class property of the certificate**, and
  ideally surface that the final message had no counterparty response. (Same mechanism as
  C-2: expose the ack frontier and a live-vs-recovered marker.)
- **Guardrail for C-5's gate:** the decision is *"can I verify the content's
  integrity?"* — **never** *"do I agree with what it says?"* Disagreement is **not** a
  reason to refuse; B seals anyway and the transcript speaks for it. B refuses **only**
  on unverifiability (content unrecoverable, or `content_hash` mismatch = genuine
  tamper). Refusing on disagreement is a category error that conflates seal with assent
  and weakens B's own position.

## Decision resolutions (updating Part 2)

- **D-1 — CONFIRMED as the spine.** Content recovery is the precondition for the
  bilateral upgrade (C-4), not a parallel workstream. The architecture fork (pure-P2P vs.
  encrypted mailbox vs. hybrid) is unchanged and still needs a focused session — but its
  *importance* is upgraded: nothing in Workstream C is meaningful until it is resolved.
- **D-2 — RESOLVED.** The notarization is signed by the **seal initiator + the directory
  FROST threshold**, coordinated by the present/closing party; the counterparty is
  **never** a FROST signer (its contribution is an Ed25519 ack leaf). Verified:
  `processSeal` → `seal_verified` to the initiator → FROST → `recordNotarization`
  (`directory-node.ts:2714+, 2870-2905`). **Consequence:** a unilateral seal *can*
  produce a real FROST notarization with the counterparty absent — the present party is
  the initiator and already holds both parties' signed message leaves. **Workstream A is
  unblocked.**
- **D-3 — REFINED.** On the returning party's upgrade (or B's live co-sign), refuse
  **only** on unverifiability: content unrecoverable → cannot honestly seal (stay
  ABSENT/unconfirmed); recovered content's hash ≠ committed `content_hash` → genuine
  tamper → dispute with cryptographic proof. **Disagreement with the message's claims is
  never grounds to refuse** (C-6).

## Workstream updates (updating Part 2)

- **Workstream A (notarize) — unblocked (D-2).** Additionally: design the persisted
  `SealNotarization` for C's promotion **now** — an append-only superseding row referencing
  the unilateral one, never a mutation (respects the M5 migration-integrity rule).
- **Workstream B (recovery) — re-scoped as the spine (C-4).** Not merely "stop
  desyncing": it must **deliver plaintext** on reconnect, and the tail-seal must be
  **gated on content possession**. Hash-only recovery is explicitly insufficient for an
  honest seal.
- **NEW Workstream E — Auto-acknowledge close (C-5).** Replace the agent-mediated
  responder seal with verifiability-gated **node auto-co-sign**; `counterparty_closing`
  becomes informational in the happy path and a decision point only when the content is
  unverifiable. Removes the C-0 robustness seam. AC sketch: (1) B online + content
  verified → bilateral seal completes with no agent action; (2) B desynced or
  cross-check fails → no auto-sign, agent notified; (3) B's signature is always produced
  by B's own node — assert no path lets another party synthesize it.
- **NEW Workstream F — Certificate legibility (C-1, C-2, C-6).** The seal certificate
  states **"receipt, not assent"** as a first-class property, and exposes each party's
  acknowledgement **frontier**, a **live-vs-recovered** marker per attestation, and a
  **"final message unanswered"** indicator. May fold into A (it shares the notarization
  write) or stand alone. AC sketch: a reader of the certificate can determine, without
  external context, exactly what each party provably received vs. merely had delivered,
  and that no signature implies agreement.

## Updated dependency order
```
D-1 (content architecture, now the spine) ─► B (recovery = deliver plaintext) ─┐
D-2 (RESOLVED) ─► A (notarize) ──────────────────────────────────────────────┐ │
D-3 (refined: refuse only on unverifiability) ───────────────────────────────┼─┼─► C (upgrade)
                                                                              │ │
E (auto-acknowledge close) depends on the C-6 verifiability gate ────────────┘ │
F (certificate legibility) folds into / follows A ─────────────────────────────┘
D (WAL) feeds B + C.   P-1, P-2 run in parallel, independent of everything above.
```
