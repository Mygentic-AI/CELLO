---
name: Arbitration Mechanics and Dispute Resolution
type: discussion
date: 2026-05-14 17:02
topics: [arbitration, dispute-resolution, trust-data, non-repudiation, ephemeral-inference, conversation-records, persistence, client-storage, backup]
description: Behavioral rules for the arbitration system — four-scenario matrix for complaint handling, unsubstantiated vs refused vs upheld verdict classes, pattern analysis requiring verdict-type context, refusal as a distinct signal, and client backup as the non-repudiation obligation.
---

# Arbitration Mechanics and Dispute Resolution

## The Core Rule

**A complaint without a verifiable copy is not a complaint. It is a flag.**

If the filing party (A) cannot submit a leaf sequence that verifies against the sealed root held by the directory, the arbitration system cannot evaluate the dispute on merits. There is nothing to evaluate. The outcome is `UNSUBSTANTIATED` — a complaint was filed, no verifiable evidence was provided. This is not a win for A.

The sealed root exists regardless. The directory knows a conversation happened. But the complaint carries no evidentiary weight without a verified leaf sequence.

---

## The Four-Scenario Matrix

| Scenario | A's signal | B's signal |
|---|---|---|
| A submits verified copy, B submits matching copy | Verdict-dependent on ephemeral inference | Verdict-dependent on ephemeral inference |
| A submits verified copy, B refuses | Ephemeral inference runs on A's copy. If upheld: B acted badly AND concealed it — compounded negative | `ARBITRATION_REFUSED` recorded; primary signal is the inference verdict, refusal is the aggravating factor |
| A cannot provide copy, B refuses | A flagged: `UNSUBSTANTIATED` complaint pattern | B flagged: refusal on unsubstantiated complaint — weaker signal than refusing a substantiated one |
| A cannot provide copy, B submits | A flagged: `UNSUBSTANTIATED` complaint. Ephemeral inference runs on B's copy — verdict stands regardless | Verdict-dependent. Cooperation is irrelevant to outcome — good faith submission does not mitigate a negative verdict |

---

## Verdict Classes

Three distinct outcomes, each with different trust score implications:

**`UPHELD`** — ephemeral inference finds the complaint substantiated. Trust score impact on the flagged party. Where applicable, triggers bond forfeiture release condition.

**`DISMISSED`** — ephemeral inference finds no violation. Minor notation only; no trust score impact.

**`ARBITRATION_REFUSED`** — the defendant declined to submit their copy. The complaint may still be evaluated on the plaintiff's copy if one was provided. Refusal is recorded as a separate signal — it compounds a negative verdict but is not itself a verdict on the underlying behavior.

**`UNSUBSTANTIATED`** — the plaintiff could not provide a verified copy. No evaluation possible. Recorded against the plaintiff as a complaint-without-evidence.

**`ESCALATED`** — ephemeral inference cannot resolve; human review triggered. Network-wide alert possible.

---

## Refusal Is Not Equivalent to Guilt

Refusal has a legitimate privacy defense available. An agent that has a policy of never releasing conversation content to third parties — for commercial confidentiality, competitive sensitivity, or as a stated operating principle — is not necessarily hiding bad behavior.

CELLO's core privacy guarantee is that the directory architecturally cannot read conversations. The arbitration mechanism cannot require parties to hand conversations to an inference engine on demand without undermining that positioning.

Refusal is therefore always permitted. The cost is reputational, not forced disclosure. An agent that routinely refuses arbitration on disputed sessions accumulates a visible pattern in their trust profile. The market-level enforcement operates even without forced disclosure.

---

## Pattern Analysis Requires Verdict-Type Context

A raw refusal count is uninterpretable without knowing what kind of complaint triggered each refusal.

- An agent accumulating refusals on **substantiated** complaints (`UPHELD` verdicts where B refused) — strong bad actor signal.
- An agent accumulating refusals on **unsubstantiated** complaints (`UNSUBSTANTIATED` on A's side) — possibly a target of a gaming pattern.

These are opposite interpretations of the same refusal count. The directory must track `refusal_on_substantiated` and `refusal_on_unsubstantiated` as distinct signals. Aggregating them is noise.

**The gaming scenario:** A repeatedly files complaints claiming technical data loss, then B refuses on privacy grounds. Neither wins. A accumulates an `UNSUBSTANTIATED` complaint pattern; B accumulates refusals on unsubstantiated complaints — a weaker negative signal. An agent operating a systematic complaint-without-evidence campaign is visible from A's side of the pattern regardless of B's behavior.

**The legitimate attack-target scenario:** An agent under coordinated attack may appear as a repeat defendant with a refusal policy. The correct read is victim signal, not bad actor signal — but only if the complaints on A's side are `UNSUBSTANTIATED`. If they are substantiated and B is refusing, the interpretation flips entirely.

---

## The Programmatic Arbitration Request Flow

The directory should issue a formal `ARBITRATION_SUBMISSION_REQUESTED` notification to both parties with a deadline. This is a protocol-level request, not a human chasing people.

- Both parties receive the notification
- Each party has until the deadline to submit their leaf sequence
- Failure to respond by the deadline is treated as refusal and recorded as `ARBITRATION_REFUSED`
- The notification includes: conversation_id, sealed root, deadline timestamp

This makes refusal a deliberate act — a party that ignores the deadline has chosen not to participate, which is recorded identically to explicit refusal.

---

## Non-Repudiation Is Client-Dependent

The directory's sealed root is a commitment anchor, not proof material. It answers one question: did a conversation with this final state happen? It cannot help construct any inclusion proof on its own.

For any dispute to be evaluable, the filing party must hold the full leaf sequence locally. The directory cannot reconstruct it — it holds only the root. This is a direct consequence of the core privacy guarantee: the directory architecturally cannot see message content or message hashes. The same design decision that makes surveillance impossible also makes directory-side reconstruction impossible.

**The non-repudiation guarantee is therefore:**

*Neither party can fabricate what was said, as long as at least one party kept their copy.*

It is not: the conversation is recoverable under all failure conditions.

If A loses their copy and B is adversarial, A can prove a conversation happened but cannot prove its contents. That is a real and accepted limitation.

---

## Client Backup as Non-Repudiation Obligation

The encrypted cloud backup is not optional infrastructure — it is what makes the non-repudiation guarantee durable under device failure.

Conversation Merkle trees are the only client-side data that cannot be reconstructed from scratch:

| Data category | Recovery path without backup |
|---|---|
| Track record stats | Query directory live with pseudonym |
| Social verification blobs | Re-verify via OAuth |
| Salt / db_key | Re-derive from private key |
| Endorsement records | Re-request from endorsers |
| Conversation Merkle trees | **No recovery path** — must be in backup or obtained from counterparty |

The policy implication: if you want the right to dispute, you keep your copy. Clients should surface this explicitly to operators — not as a buried setting, but as a visible obligation tied to dispute rights.

If a client prunes its local Merkle trees, it is not a storage optimization decision. It is a decision to give up the ability to prove anything about those conversations. The client implementation should make this consequence explicit before any pruning operation is permitted.

---

## Related Documents

- [[2026-04-11_1700_persistence-layer-design|Persistence Layer Design]] — `arbitration_verdicts` schema and ephemeral inference model; behavioral rules here extend that schema with verdict classes and pattern analysis requirements
- [[2026-04-08_1530_message-delivery-and-termination|Message Delivery and Termination]] — conversation Merkle trees and CLOSE/CLOSE-ACK; the non-repudiation model this arbitration design depends on
- [[2026-04-18_1357_connection-bond-usage-and-policy|Connection Bond Usage and Policy]] — bond forfeiture is the `UPHELD` verdict's release condition; arbitration verdict is the trigger
- [[2026-05-14_1702_relay-session-mechanics-and-recovery|Relay Session Mechanics and Recovery]] — agent-side hash queue as protocol primitive; client retention of the full leaf sequence is what makes dispute rights durable
