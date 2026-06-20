---
name: Tier-5 Recovery Substrate Disposition — REC-1/2/3 decided
type: discussion
date: 2026-06-20
topics: [recovery, relay-wal, signed-relay-ack, pre-seal-reconciliation, delivery-failure-tree, persist-012, msg-001, session-004, tier-5, m7, deferral-register]
status: open
description: >
  Closes the three Tier-5 ❓ items in the M7 Definition of Done so the milestone
  carries no silent deferral (postmortem RC-1). DOD-REC-1 (signed relay ACK) is
  SATISFIED by the already-built CELLO-PERSIST-012. DOD-REC-2 (pre-seal
  reconciliation) is SUBSUMED by the M7 directory-authoritative seal model plus
  MSG-001 recovery plus the D-3 unverifiability rule — no new story. DOD-REC-3
  (delivery-failure tree) is ABSORBED by MSG-001 + SESSION-004; each branch is
  mapped to a defined outcome. Each verdict updates the DoD tag from ❓ to a
  decided status.
---

# Tier-5 Recovery Substrate Disposition

The M7 DoD Tier-5 section flagged three recovery-substrate items as ❓ "verify
carried or drop." They appear in the April-8 delivery-failure-tree log and the
May-14 relay-recovery log and underpin Tier-3, but it was unclear whether the
four postmortem stories carried them or lost them. Per `M7-PROCEDURE.md` §5 and
postmortem RC-1, a milestone may not close carrying a silent deferral — so each
is decided IN (with a home) or OUT (with a rationale) here.

## DOD-REC-1 — Signed relay ACK as a cryptographic receipt → SATISFIED (PERSIST-012)

**Source design** (`2026-05-14_1702_relay-session-mechanics-and-recovery.md`,
§"Signed Relay ACKs — Cryptographic Commitments"): the relay's ACK must be a
signed receipt — `relay_signature` over `(H || sequence_number || timestamp)` —
that the sender stores as dispute evidence; a relay cannot later deny sequencing a
hash it signed an ACK for.

**Verdict: already built.** `CELLO-PERSIST-012` (M4, P0, client+relay) implements
exactly this:
- "the relay shall return a signed ACK: `relay_signature(SHA-256(hash_H ||
  sequence_number || timestamp))` … the client shall store the ACK in the
  ClientStore alongside the hash" (PERSIST-012 behavior).
- Relay-reassignment re-submission validates queued hashes against the previous
  relay's signed ACK (`RELAY_PREDECESSOR_UNKNOWN` when the predecessor key is
  unknown).
- The relay package carries it live: `packages/relay/dist/relay-node.js` emits
  `relay_signature`; `__tests__/persist-012-relay-signed-ack.test.js` passes.

**One verification caveat for the implementation thread (not a new story):** the
hash-submission path moved into the daemon in SPINE-6
(`core/daemon/src/session-relay-client.ts`). Confirm the daemon-side client
**stores** the relay's signed ACK durably (the M4 storage was in the now-dead
`ClientStore`). If the daemon witnesses but does not persist the signed ACK, that
is a wiring fix on the J-CONTENT path, not a re-design. **DoD: ❓ → ✅ (covered by
PERSIST-012)**, with this caveat noted.

## DOD-REC-2 — Pre-seal reconciliation / gap-fill → SUBSUMED (no new story)

**Source design** (May-14 log, §"Pre-Seal Reconciliation Protocol"): before CLOSE,
both parties exchange last-confirmed sequence numbers; on divergence a gap-fill
runs where the **relay serves missing leaves from WAL** (relay-authoritative, not
counterparty, so the ahead party cannot substitute content). The log itself calls
this "the missing piece" of the older relay-as-Merkle-engine model.

**Verdict: subsumed by the M7 seal model.** The M7 architecture reaches the same
goal — consistent trees before a seal, with the relay (not the counterparty) as
the authority — through mechanisms that already exist or are storied:
1. **Directory-authoritative root rebuild.** The directory does not trust either
   party's reported root: it **rebuilds and verifies the whole signed-leaf chain
   from the relay's per-session record** and notarizes that
   (`SESSION-002` AC-001; bilateral `processSeal`). The canonical root is derived
   from the relay's witnessed leaves — the relay-authoritative property REC-2
   wanted, achieved at notarization time rather than via a separate pre-CLOSE
   handshake.
2. **Leaf/content recovery is the gap-fill.** A party behind the frontier recovers
   missing leaves and content via `MSG-001` (request resend → pull from the relay
   store-and-forward queue → cross-check against the committed `content_hash`).
   That is the gap-fill step, keyed to the same relay-WAL source REC-2 specified.
3. **Divergence resolution is D-3.** When a returning/diverging party cannot
   reconcile, the rule is **refuse only on unverifiability** (POSTMORTEM D-3): a
   tail it cannot verify stays counterparty-ABSENT/unconfirmed; a `content_hash`
   mismatch is genuine tamper → dispute. The May-14 log's open question ("resolution
   path when they disagree") is answered by D-3.

So the *bilateral pre-CLOSE seq-exchange handshake* as a distinct wire step is
**not needed** in the M7 model — its purpose (relay-authoritative tree
consistency before seal, with a defined disagreement outcome) is delivered by the
directory rebuild + MSG-001 recovery + D-3. **DoD: ❓ → ✅ (subsumed; covered by
SESSION-002 + MSG-001 + POSTMORTEM D-3).** No new story.

*Note:* this is a genuine design judgement, not a code-verified fact — it rests on
the M7 directory-authoritative seal being the authority. If a future live journey
shows a divergence case the directory rebuild + MSG-001 cannot resolve, REC-2
reopens as an explicit bilateral handshake story. Recorded so it does not
evaporate.

## DOD-REC-3 — Delivery-failure tree coverage → ABSORBED (each branch mapped)

**Source design** (`2026-04-08_1530_message-delivery-and-termination.md`,
§"Delivery Failure Tree"): branches A–D × a time dimension
(within-grace / after-grace-active / after-dead / never).

**Verdict: absorbed by MSG-001 + SESSION-004.** Branch-by-branch home:

| Branch | Meaning | Home |
|---|---|---|
| **A** | both hash + content arrive | happy path — DOD-SPINE-6 (proven live) |
| **B1** | hash arrives, content within grace | MSG-001 cross-check at assigned seq |
| **B2a** | after grace, sender resends | MSG-001 DOD-MSG-4 (request resend from sender) |
| **B2b** | sender denies sending | tamper path — MSG-001 DOD-MSG-7 (`content_hash_mismatch` → desync); a forged/denied hash surfaces as a verification failure, not silent |
| **B2c/B3** | sender unreachable / extended wait | MSG-001 DOD-MSG-4 (pull from relay store-and-forward queue) |
| **B4a** | content arrives after session death | SESSION-004 frontier + MSG-001 DOD-MSG-8 (straggler post-seal rejected, never re-enters a sealed session) |
| **B4b** | content never arrives | MSG-001 DOD-MSG-8 (hash committed → receiver seals "sent, not received"; content frontier excludes it) |
| **C** | content arrives, hash doesn't | PERSIST-012 local hash queue + relay re-submission (hash reaches the record on relay recovery/reassignment) |
| **D1** | neither arrives, sender gets failure | DAEMON-003 retry queue (sender retries) |
| **Time dimension** | within-grace / after-grace / after-dead / never | spread across MSG-001 (grace + recovery), SESSION-004 (post-session straggler + frontier), MSG-001 DOD-MSG-8 (never → honest "sent, not received") |

Every branch has a defined, non-silent outcome. **DoD: ❓ → ✅ (absorbed by
MSG-001 + SESSION-004 + PERSIST-012 + DAEMON-003).** The live J-CONTENT and
J-UNILATERAL/J-LEGIBILITY journeys are where these assertions actually run; this
disposition records that each branch has a spec home, not that each is proven live
yet.

## Net effect on the DoD

All three Tier-5 items move from ❓ to a decided status. M7 no longer carries a
silent Tier-5 deferral. None of the three requires a new story.

## Related

- [[POSTMORTEM-seal-and-content-delivery-gaps]] — D-3 (refuse only on
  unverifiability); RC-1 (deferrals need a home).
- [[CELLO-M7-MSG-001]], [[CELLO-M7-SESSION-004]] — the absorbing stories.
- `m4/CELLO-PERSIST-012.yaml` — the signed-relay-ACK implementation (REC-1).
- `2026-05-14_1702_relay-session-mechanics-and-recovery.md`,
  `2026-04-08_1530_message-delivery-and-termination.md` — the source logs.
