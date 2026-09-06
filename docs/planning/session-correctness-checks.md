---
name: session-correctness-checks
type: reference
date: 2026-09-06
topics: [sessions, correctness, refusals, notifications, seal, relay, directory]
status: draft
description: The master list of every correctness check a CELLO session passes through, stage by stage, with the file and approximate lines, the code it fails with, and the premise each check depends on. Built so each check can be audited for a notification path.
---

# Session correctness checks — the master list

## What this is for

One row per check. The columns are the anchors you need to ask, for each one: **is it logged? does
it reach the inbox? what does the operator actually read?** This document does not answer those
questions — it is the list you run that audit against.

## Why the list is ordered forward, not backward

You asked whether to start from the end. I built it **backwards and wrote it forwards**, and the two
are different jobs:

- **Deriving it backwards** is what finds missing checks. Stand at the sealed receipt and ask what it
  asserts — "these two parties", "this content", "in this order", "in this conversation" — then walk
  back asking which check earned each assertion. Anything the receipt claims that no check
  established is a hole. That sweep is what produced the `⊘` rows at the bottom.
- **Writing it forwards** is what makes it usable. An operator meets these in lifecycle order, and
  the notification audit is about what a person sees at a moment in time. A backwards document would
  be right and unreadable.

So: forward list, backward-derived.

## The tracking scheme

Each check gets a **stage letter + number**: `A4`, `I7`. Sub-checks that establish another check's
input get a **dot suffix**: `A4.1` is what makes `A4`'s input trustworthy.

The **Premise** column is the nesting mechanism, and it is the answer to "we got a directory session
assignment — how do we know it's legitimate?". It holds one of:

| Value | Meaning |
|---|---|
| an ID | the check that earns this input |
| `—` | the input is produced locally, by us, and is not on the wire |
| `⊘` | **nothing earns it** — trusted as given |

Every `⊘` is a row on the open list at the end. That is the recursion terminator: you keep asking
"and how do we know *that*" until you reach a local value (`—`) or a stated `⊘`.

**Outcome** is the failure class, and it matters for notification design because the operator's move
differs per class:

| Class | Meaning |
|---|---|
| REFUSE | received, not accepted, not recorded, sender not told |
| BLOCK | verified, recorded in the chain, acknowledged, deliberately not shown |
| DEFER | nothing recorded, nothing acked — sender's daemon redelivers on its own |
| FREEZE | the session is stopped permanently; only a new session recovers |
| LOST | committed to the chain, then lost to a local write failure |
| OUTBOUND | our own send failed — nothing arrived at them |
| CONTINUE | recorded, session proceeds (evidence, not a gate) |

Line numbers are **approximate** — they were read on 2026-09-06 and these files move.

---

## Stage R — Root of trust (holds before any session exists)

Everything below depends on this stage. If R is wrong, every later check verifies against the wrong
authority and passes.

| ID | Check | Where | Code on failure | Outcome | Premise |
|---|---|---|---|---|---|
| R1 | The directory manifest's signature verifies | `cello-client` `http-manifest-poll.ts` ~44, ~133 | `manifest_signature_invalid` | REFUSE the manifest | R4 |
| R2 | The manifest has not expired | `http-manifest-poll.ts`; `manifest-validity.ts` ~96 | `manifest_expired` | REFUSE / warn window | R4 |
| R3 | The manifest version has not rolled back | `http-manifest-poll.ts` | `manifest_version_rollback` | REFUSE the manifest | R4 |
| R4 | The signing root the manifest is checked against | `bundled-consortium-manifest.ts` | — | — | `⊘` (ships in the binary) |
| R5 | The node roster is fresh enough to reason about availability | `roster-freshness.ts` ~67, ~83 | stale after 5 min | CONTINUE + surface | R1 |
| R6 | This agent holds its own persisted registration | `assignment-verify.ts` ~76-90 | `assignment_unverifiable_no_registration` | REFUSE the session | — |
| R7 | The directory authenticates the client (Ed25519 challenge) | `directory-node.ts` ~2009-2060 | `nonce_unknown` / `nonce_expired` / `signature_invalid` | abort stream | — |
| R8 | The relay authenticates the client | `relay-node.ts` ~1515-1645 | `nonce_unknown` / `nonce_expired` / `nonce_reused` / `signature_invalid` / `rate_limited` | refuse auth | — |
| R9 | A registering relay proves it holds its own key | `directory-node.ts` ~1131-1160 | self-signature invalid | reject registration | — |

---

## Stage D — Discovery (who and where is the counterparty)

| ID | Check | Where | Code on failure | Outcome | Premise |
|---|---|---|---|---|---|
| D1 | The target pubkey is well-formed | `outbound-sessions.ts` ~699 | `invalid_target_pubkey` | REFUSE locally | — |
| D2 | The directory signaling stream is connected | `outbound-sessions.ts` ~784, ~808 | `directory_signaling_timeout` / `directory_unreachable` | REFUSE, retryable | R1 |
| D3 | The directory's discovery reply parses | `outbound-sessions.ts` ~201-210 | `malformed_reply` | retry | R7 |
| D4 | The counterparty is registered at all | `outbound-sessions.ts` ~831 | `unknown_agent` | REFUSE | `⊘` (the directory's word) |
| D5 | The counterparty is online | `outbound-sessions.ts` ~835 | `counterparty_offline` | REFUSE | `⊘` (the directory's word) |
| D6 | The directory named a home node for them | `outbound-sessions.ts` ~853 | `directory_named_no_home` | REFUSE | `⊘` |
| D7 | That home node is in our reachable roster | `outbound-sessions.ts` ~629-638 | `home_node_not_in_reachable_roster` | REFUSE | R5 |
| D8 | A visiting connection to their home node opens | `outbound-sessions.ts` ~657-668 | `visiting_connection_unreachable` | REFUSE, retryable | D7 |
| D9 | Our own standing receiver exists before we ask | `outbound-sessions.ts` ~756 | `standing_receiver_unavailable` | REFUSE locally | — |

---

## Stage A — Assignment, initiator side

This is the "permission slip" stage. Without A3–A6 a single compromised directory can name any peer
id it likes and the daemon dials it.

| ID | Check | Where | Code on failure | Outcome | Premise |
|---|---|---|---|---|---|
| A1 | The counterparty did not refuse us outright | `outbound-sessions.ts` ~457-463 | their `session_refused` reason, verbatim | REFUSE, their guidance shown | N-stage |
| A2 | The assignment is the right **shape** | `session-assignment-parser.ts` ~122-225 | `assignment_parse_failed` | REFUSE | — |
| A2.1 | session_id is 16 bytes; directory pubkey 32; signature 64 | `session-assignment-parser.ts` ~134-147 | (folded into A2) | REFUSE | — |
| A2.2 | both participants, relay endpoint and directory endpoint present | `session-assignment-parser.ts` ~151-160 | (folded into A2) | REFUSE | — |
| A3 | **Load our own registration BEFORE branching on `signature_type`** | `assignment-verify.ts` ~76-90 | `assignment_unverifiable_no_registration` | REFUSE | R6 |
| A4 | The assignment is not a **downgrade** to single-key | `assignment-verify.ts` ~92-108 | `assignment_signature_type_downgraded` | REFUSE | A3 |
| A5 | **Anti-circularity**: the named signer is our own threshold group key | `assignment-verify.ts` ~111-127 | `assignment_signer_not_this_agent` | REFUSE | R6 |
| A6 | The FROST signature verifies over the recomputed TBS | `assignment-verify.ts` ~128-138 | `assignment_signature_invalid` | REFUSE | A5 |
| A6.1 | `genesis_prev_root` is **recomputed**, never taken from the frame | `assignment-verify.ts` ~40-46 | — | — | — |
| A7 | Was a quorum of *our own* directories honest? | — | — | — | `⊘` **designed-for bound** — caught downstream at I2 |

### Directory-side gates on the same request

| ID | Check | Where | Code on failure | Outcome | Premise |
|---|---|---|---|---|---|
| A8 | The requester is registered | `directory-node.ts` ~2571 | `not_registered` | refuse request | R7 |
| A9 | The requester announced peer info | `directory-node.ts` ~2577 | `peer_not_registered` | refuse request | R7 |
| A10 | The agent is not revoked | `directory-node.ts` ~2585 | `agent_revoked` | refuse request | — |
| A11 | The agent is not suspended | `directory-node.ts` ~2597 | `agent_suspended` | refuse request | — |
| A12 | The request carries an initiator session peer id | `directory-node.ts` ~2601-2603 | `session_request_missing_peer_id` | refuse request | — |
| A13 | A connection exists between the two parties | `directory-node.ts` ~4089-4095 | `connection_id_required` / `no_connection` | refuse request | — |
| A14 | The target is online | `directory-node.ts` ~4107 | `target_offline` | refuse request | — |
| A15 | A FROST signer is configured | `directory-node.ts` ~4143 | `frost_signer_not_configured` | refuse request | — |
| A16 | The target accepted the offer | `directory-node.ts` ~4275 | `counterparty_did_not_accept` | refuse request | N-stage |
| A17 | No competing ceremony for this pair | `directory-node.ts` ~4326 | `ceremony_conflict` | refuse request | — |
| A18 | Enough nodes to reach threshold | `directory-node.ts` ~4356 | `directory_below_threshold` | refuse request | R5 |
| A19 | A relay could be assigned | `directory-node.ts` ~4402 | `relay_unavailable` | refuse request | — |

---

## Stage N — Admission, responder side

The stage your newest check lives in. Ordered as the code runs it — capacity before crypto, because
capacity must be indistinguishable for blocked and unknown senders.

| ID | Check | Where | Code on failure | Outcome | Premise |
|---|---|---|---|---|---|
| N1 | This agent is online at all | `inbound-sessions.ts` ~758-766 | `agent_offline` | REFUSE, silent | — |
| N2 | Per-sender session cap not exceeded | `inbound-sessions.ts` ~770-880 | `abuse_bound_sessions_per_sender` | REFUSE, sender told if KNOWN+ | contacts |
| N3 | Global unknown-sender cap not exceeded | `inbound-sessions.ts` ~770-880 | `abuse_bound_unknown_sessions_global` | REFUSE, byte-identical to N2 | — |
| N4 | A standing receiver can be produced | `inbound-sessions.ts` ~890-925 | `standing_receiver_unavailable` | REFUSE | — |
| N5 | Offered moniker is a string, 1–64 chars, valid charset | `session-assignment-parser.ts` ~302-315; `inbound-sessions.ts` ~957-965 | `not_string` / `length` / `charset` | CONTINUE — logged, never a refusal | — |
| N6 | Presented trust signals hash to what they claim | `inbound-sessions.ts` ~1006-1070 | `signal.verify.hash_mismatch` | drop the signal, session continues | — |
| N7 | An assignment and its ids are present at all | `inbound-sessions.ts` ~1120-1128 | `missing_assignment_or_ids` | REFUSE | — |
| N8 | The assignment is not single-key (**algorithm downgrade guard**) | `inbound-sessions.ts` ~1130-1140 | `unsupported_signature_type` | REFUSE | — |
| N9 | An initiator session peer id is present | `inbound-sessions.ts` ~1145-1150 | `missing_initiator_peer_id` | REFUSE | — |
| N10 | **The offer and the assignment name the same dialer** | `inbound-sessions.ts` ~1195-1225 | `offer_assignment_dialer_mismatch` | REFUSE, sender told | N7 |
| N11 | The assignment is complete, not empty-defaulted | `inbound-sessions.ts` ~1231-1240 | `assignment_incomplete` | REFUSE | N7 |
| N12 | Dead/unknown fields are well-formed | `inbound-sessions.ts` ~1290-1300 | `dead_field_malformed` | REFUSE | — |
| N13 | Shape validation of the inbound assignment | `inbound-sessions.ts` ~1310-1315 | `inbound_assignment_unparseable` | REFUSE | — |
| N14 | It is FROST-signed | `assignment-verify.ts` ~184-190 | `inbound_assignment_not_frost` | REFUSE | — |
| N15 | `signer_pubkey` is present and 32 bytes | `assignment-verify.ts` ~195-196 | `inbound_assignment_no_signer` | REFUSE | — |
| N16 | **TOFU pin**: the signer matches what we recorded for this counterparty | `assignment-verify.ts` ~200-208 | `inbound_assignment_signer_not_pinned` → surfaced as `counterparty_primary_key_changed` | REFUSE, sender told, "confirm out of band" | N16.1 |
| N16.1 | Where the pin comes from | `session-node-manager.ts` ~7602 `getPinnedCounterpartyPrimary` — newest completed session's `counterparty_primary_pubkey` | — | — | Z-stage (the pin is written at seal) |
| N17 | The signature verifies — **pinned** mode | `assignment-verify.ts` ~229-239 | `inbound_assignment_signature_invalid` | REFUSE | N16 |
| N18 | The signature verifies — **internal** mode (first contact) | `assignment-verify.ts` ~229-239 | same code, different guidance | REFUSE | `⊘` **stated bound** — this does not authenticate the directory, only catches a tampered frame |

---

## Stage T — Transport admission (peer level, below the session)

| ID | Check | Where | Code on failure | Outcome | Premise |
|---|---|---|---|---|---|
| T1 | Inbound peer is the one allowed peer for this session node | `session-connection-gater.ts` ~228-231, ~251+ | `session.node.connection.rejected` | deny after Noise, before muxer | A6 / N17 |
| T2 | Outbound dial target is the counterparty or an allowed relay | `session-connection-gater.ts` ~237-249 | same | deny | A6 |
| T3 | The standing receiver starts **closed**, not open | `session-connection-gater.ts` ~56, ~123-126 | — | — | — |
| T4 | Relay: the caller is a named participant of the session it names | `relay-node.ts` ~1051, ~2098-2145 | `not_a_participant` | refuse, undistinguished from "no such session" | W1 |
| T5 | Relay: the key asked about is the **other** participant | `relay-node.ts` ~2120-2140 | `not_a_participant` | refuse — closes the presence oracle | T4 |

---

## Stage K — Content salt / key agreement

All five of these FREEZE. A frozen session is not retryable, which is the notification-design
constraint: no guidance here may say "try again".

| ID | Check | Where | Code on failure | Outcome | Premise |
|---|---|---|---|---|---|
| K1 | Both sides derived the same salt | `session-salt-agreement.ts` ~161-181, ~550 | `salt_fingerprint_mismatch` | FREEZE | — |
| K2 | Our own half survived a restart | `session-salt-agreement.ts` ~523 | `salt_state_divergent` | FREEZE | — |
| K3 | Their contribution is not all-zero / wrong length / our own echoed back | `session-salt-agreement.ts` ~622 | `salt_contribution_degenerate` | FREEZE | — |
| K4 | **Our own** contribution is not degenerate (local RNG fault) | `session-salt-agreement.ts` ~568-574 | `salt_own_contribution_degenerate` | FREEZE — deliberately not blamed on the peer | — |
| K5 | The salt frame carries exactly one of its two fields | `session-salt-agreement.ts` ~508 | `salt_frame_malformed` | FREEZE | — |
| K6 | A peer adoption label is rendered as untrusted text | `session-salt-agreement.ts` ~283-306 | — | CONTINUE | — |

---

## Stage O — Outbound message (our own send)

| ID | Check | Where | Code on failure | Outcome | Premise |
|---|---|---|---|---|---|
| O1 | Params present | `session-content-handlers.ts` ~314 | `missing_params` | refuse call | — |
| O2 | The session exists | `session-content-handlers.ts` ~320 | `session_not_found` | refuse call | — |
| O3 | The session belongs to the selected agent | `session-content-handlers.ts` ~323 | `session_not_owned` | refuse call | — |
| O4 | An interrupted session can be revived | `session-content-handlers.ts` ~327-350 | `session_terminal` and siblings | refuse call | — |
| O5 | This connection is the current one for the session | `session-content-handlers.ts` ~356-420 | `session_not_current` | refuse call, names *which* authority refused | — |
| O6 | Content is within the size cap | `session-content-handlers.ts` ~446-455 | `content_too_large` | refuse call | — |
| O7 | Outbound screener: rate limit | `gateway/screen/outbound.ts` ~79-90 | `rate_limited` | BLOCK before wire | — |
| O8 | Outbound screener: credential redaction | `gateway/screen/outbound.ts` ~95-103 | `secret:<ruleId>` | REDACT | — |
| O9 | Outbound screener: exfiltration artifact | `gateway/screen/outbound.ts` ~105-120 | `blocked_by_governance` | BLOCK | — |
| O10 | Outbound screener: PII needs a decision | `gateway/screen/outbound.ts` ~123-150 | `governance_warn` | WARN — send held for a decision | — |
| O11 | The gateway answered at all | `session-content-handlers.ts` ~474-478 | `security.gateway.timeout` / `.unavailable` | BLOCK fail-closed | — |
| O12 | A `redact` verdict actually carried content | `session-content-handlers.ts` ~505-508 | `redact_without_content` | BLOCK | — |
| O13 | The session did not move under us mid-send | `session-content-handlers.ts` ~563-592 | `session_moved_under_send` | refuse before the wire call | — |
| O14 | The send reached the wire or was durably queued | `session-content-handlers.ts` ~637-733 | `dispatched_to_relay` / queue failures | OUTBOUND | — |
| O15 | What we sent matches what we recorded sending | `session-content-handlers.ts` ~789 | `session.content.sent.diverged` | logged | — |

---

## Stage W — Relay witness (server side, per message)

The relay is what turns "I say I sent this" into a countersigned position. Every row here is a check
the *relay* performs on a client submission.

| ID | Check | Where | Code on failure | Outcome | Premise |
|---|---|---|---|---|---|
| W1 | The client's assignment carries a valid directory signature | `relay-node.ts` ~1158 | `directory_signature_invalid` | refuse to record the session | R1 |
| W1.1 | `prior_relay_id` is well-formed | `relay-node.ts` ~1145 | `prior_relay_id_malformed` | refuse | — |
| W2 | Per-pair session cap | `relay-node.ts` ~1191 | `session_tuple_cap_exceeded` | refuse | — |
| W3 | The session is not already recorded | `relay-node.ts` ~1201 | `session_already_exists` | refuse | — |
| W4 | Submit rate limit, per peer **and** per authenticated pubkey | `relay-node.ts` ~2617 | `rate_limited` | refuse | R8 |
| W5 | The session is known to this relay | `relay-node.ts` ~2587 | `session_not_found` | refuse | W1 |
| W6 | The session is not diverged / sealed / seal-rejected | `relay-node.ts` ~2605-2626 | `session_diverged` + upstream detail | refuse | — |
| W7 | The session is not awaiting a replay | `relay-node.ts` ~2694 | `session_awaiting_replay` | refuse | — |
| W8 | Structure 1 decodes | `relay-node.ts` ~2656 | `submit_malformed` | refuse | — |
| W9 | The leaf's session id matches the frame's | `relay-node.ts` ~2674 | `leaf_session_mismatch` | refuse | — |
| W10 | The leaf is signed by one of the two participants | `relay-node.ts` ~2688 | `leaf_signed_by_neither_participant` | refuse | W1 |
| W11 | The submitter is a participant | `relay-node.ts` ~2693 | `not_a_participant` | refuse | R8 |
| W12 | A named predecessor relay is known and its receipt verifies | `relay-node.ts` ~2708-2755 | `RELAY_PREDECESSOR_UNKNOWN` | refuse | R1 |
| W13 | The leaf kind is one this relay may assert | `relay-node.ts` ~2773 | `leaf_kind_invalid` | refuse | — |
| W14 | The Structure 1 pubkey matches the authenticated signer | `relay-node.ts` ~2797 | `sender_mismatch` | refuse | R8 |
| W15 | Not a duplicate counter-submit | `relay-node.ts` ~2864 | `counter_submit_duplicate` | refuse | — |
| W16 | `last_seen_seq` does not run **ahead** of the relay's counter | `relay-node.ts` ~2908 | `last_seen_seq_ahead` | refuse | — |
| W17 | `last_seen_hash` names something the relay can check | `relay-node.ts` ~2963 | `ack_hash_unverifiable` | refuse | — |
| W18 | `last_seen_hash` matches the message at that position | `relay-node.ts` ~2986 | `ack_hash_mismatch` | refuse | W17 |
| W19 | The Structure 2 signature builds | `relay-node.ts` ~3044 | `signature_invalid` | refuse | — |
| W20 | Park deposit is within rate / store / recipient bounds | `relay-park-refusals.ts` ~23-30 | `rate_limited` / `content_store_full` / `content_store_recipient_full` | refuse deposit | R8 |
| W21 | A replayed leaf carries no `content_bytes` | `relay-node.ts` ~1995 | replay refusal | refuse | — |
| W22 | Replay rate limit (before the verification walk) | `relay-node.ts` ~2038-2056 | `rate_limited` | refuse | R8 |
| W23 | A witness alert is signed by this relay | `relay-node.ts` ~2200-2232 | `relay.witness.sign.failed` | alert sent unsigned or not at all | — |

---

## Stage I — Inbound message ingest (the receiving daemon)

The order in `#verifyAuthorshipClaim` is itself a security property: **decode → signature → signer →
what the proof is about**. Everything after the signer answers `unusable` (REFUSE, session lives);
signature and signer answer `refuted` (FREEZE). Running the soft checks first would hand an attacker
a switch for choosing the softer outcome.

| ID | Check | Where | Code on failure | Outcome | Premise |
|---|---|---|---|---|---|
| I0 | **A proof of authorship is present at all** | `session-node-manager.ts` ~16991-17000 | `authorship_proof_absent` | REFUSE (not freeze — likeliest cause is an old build) | — |
| I1 | Structure 1 decodes into a layout this build knows | `session-node-manager.ts` ~16026-16029 | `unusable` + decode reason | REFUSE | — |
| I2 | **The sender's Ed25519 signature verifies over their own signed bytes** | `session-node-manager.ts` ~16035-16037 | `bad_signature` | **FREEZE** | I0 |
| I3 | **The signer is this session's counterparty** (session-open MITM detection) | `session-node-manager.ts` ~16041-16071 | `signer_not_counterparty` | **FREEZE** | I3.1 |
| I3.1 | Where `counterparty_pubkey` comes from | the operator's own request, never anything the directory returned | — | — | — |
| I3.2 | No counterparty on record → `verified_unmatched`, soft | `session-node-manager.ts` ~16069 | — | CONTINUE, feeds I12 | `⊘` deliberate |
| I4 | The claim binds to **this content** | `session-node-manager.ts` ~16095-16097 | `authorship_hash_mismatch` | REFUSE | I3 |
| I5 | The claim binds to **this conversation** | `session-node-manager.ts` ~16120-16124 | `authorship_wrong_conversation` | REFUSE | I3 |
| I6 | The acknowledgement carries a hash when it claims a position | `session-node-manager.ts` ~16190-16200 | `ack_hash_absent` | REFUSE | I5 |
| I7 | A zero-position ack matches the derived genesis root | `session-node-manager.ts` ~16210-16250 | `ack_hash_mismatch` | REFUSE (soft when we hold no genesis) | I5 |
| I8 | A positional ack names content we actually placed there | `session-node-manager.ts` ~16255+ | `ack_hash_mismatch` | REFUSE | I5 |
| I9 | The relay ordering record, when present, is not refuted | `session-node-manager.ts` ~16506-16640, ~17055-17060 | ordering `fatal` | **FREEZE** | W19 |
| I10 | Ordering record absent → position falls back to the witness stream | `session-node-manager.ts` ~17065-17075 | `session.content.ordering.absent` | CONTINUE (relay-degraded) | `⊘` stated |
| I11 | A session row exists for this message | `session-node-manager.ts` ~10495-10556 | `session_orphaned` | REFUSE + quarantine + triage | — |
| I12 | Orphan triage: signature verified? known contact? ongoing conversation? | `orphan-triage.ts`; `session-node-manager.ts` ~10530-10545 | selects the operator's action | REFUSE | I3.2 |
| I13 | The session is not already committed (sealed / seal-interrupted / abandoned) | `session-node-manager.ts` ~10560-10605 | `session_committed` | REFUSE + quarantine | — |
| I14 | The named content-hash algorithm is one we can reproduce | `session-node-manager.ts` ~10610-10661 | `content_hash_alg_unknown` | REFUSE + quarantine | — |
| I15 | The salt needed to reproduce the hash is available | `session-node-manager.ts` ~10665-10726 | `content_hash_salt_unavailable` | REFUSE + quarantine — self-repairs on reconnect | K1 |
| I16 | **The content hashes to what the sender committed** | `session-node-manager.ts` ~10730-10766 | `content_hash_mismatch` | REFUSE + quarantine (tamper verdict) | I14, I15 |
| I17 | The sender resolves to a known party | `session-node-manager.ts` ~10770-10820 | `sender_unresolved` | REFUSE + quarantine | I3 |
| I18 | Session size limit | `session-node-manager.ts` ~10952, ~11211 | `session_size_limit_exceeded` | REFUSE | — |
| I19 | Inbound screener: sanitization changed the text | `gateway/screen/inbound.ts` ~92-104 | `redact` events | REDACT, deliver | — |
| I20 | Inbound screener: language allowlist | `gateway/screen/inbound.ts` ~107-133 | `inbound_language_blocked` | **BLOCK** (recorded, acked, not shown) | — |
| I21 | Inbound screener: semantic injection score over threshold | `gateway/screen/inbound.ts` ~137-155 | `inbound_injection_blocked` | **BLOCK** | — |
| I22 | Inbound screener: sub-threshold injection | `gateway/screen/inbound.ts` ~158-168 | observe event | CONTINUE — surfaced as evidence | — |
| I23 | Inbound screener: size cap | `gateway/screen/inbound.ts` ~79-90 | `inbound_size_blocked` | **BLOCK** terminal | — |
| I24 | The transcript row was actually written | `session-node-manager.ts` ~11340-11382 | `transcript_write_failed` | **LOST** — committed to the chain, gone from disk | — |
| I25 | An ack is emitted only after a durable, non-held ingest | `session-node-manager.ts` ~17085-17100 | — | — | I24 |

---

## Stage P — Park / offline recovery (mail that waited)

| ID | Check | Where | Code on failure | Outcome | Premise |
|---|---|---|---|---|---|
| P1 | The park envelope decodes to a known version | `park-envelope.ts` ~389-450 | `ParkEnvelopeError` | REFUSE | — |
| P2 | The envelope is signed | `park-envelope.ts` ~466 | `unsigned_envelope` | REFUSE | — |
| P3 | We know who the counterparty is | `park-envelope.ts` ~471 | `counterparty_unknown` | REFUSE | — |
| P4 | The envelope signature verifies | `park-envelope.ts` ~478 | `bad_signature` | REFUSE | P2 |
| P5 | The signer is this session's counterparty | `park-envelope.ts` ~486 | `signer_not_counterparty` | REFUSE | P4 |
| P6 | `session_id` is bound inside the park TBS | `session-node-manager.ts` ~16600 | (inside P4) | REFUSE | P4 |
| P7 | Recovered content still passes the whole of stage I | `session-node-manager.ts` ~13283-13555 | stage I codes | as stage I | P5 |
| P8 | We can name the algorithm before we seal an entry | `park-envelope.ts` ~204-210 | `park_envelope_alg_unreadable` | refuse to **produce** | — |

---

## Stage C — Close gate (before any ceremony runs)

| ID | Check | Where | Code on failure | Outcome | Premise |
|---|---|---|---|---|---|
| C1 | A supplied session name is acceptable | `close-session-handler.ts` ~449-455 | name-check reason | refuse call | — |
| C2 | The session exists | `close-session-handler.ts` ~465 | `session_not_found` | refuse call | — |
| C3 | It belongs to this agent | `close-session-handler.ts` ~475 | `session_not_owned` | refuse call | — |
| C4 | It is not already sealed | `close-session-handler.ts` ~506 | `session_already_sealed` | refuse call | — |
| C5 | It was not force-abandoned | `close-session-handler.ts` ~527-542 | `session_abandoned` / `already_abandoned` | refuse call | — |
| C6 | Pending inbound content is drained first | `close-session-handler.ts` ~668 | `readiness.drain.failed` | logged, close continues | — |
| C7 | **Our record is not diverged from the relay's** | `close-session-handler.ts` ~695-707 | `session_record_diverged` | REFUSE the close | W19 |
| C8 | **The transcript is complete** — no known gap | `close-session-handler.ts` ~732-748 | `session_incomplete` | REFUSE the close | I9 |
| C9 | No seal already in flight | `close-session-handler.ts` ~779 | `seal_in_progress` | refuse call | — |
| C10 | Signaling is connected, not reconnecting | `close-session-handler.ts` ~796 | `signaling_reconnecting` | refuse call, retryable | R1 |
| C11 | A force-abandon tells the counterparty, or says it could not | `close-session-handler.ts` ~567-616 | `notice_timeout` / `notice.threw` | abandon proceeds, reason recorded | — |

---

## Stage Z — Seal ceremony

Three independent parties check here: the **coordinating client**, the **verifying directory node**,
and **each co-signing node**. Z10–Z16 are the reason a single node cannot forge a receipt.

### Z-a — Directory verifies the record it was handed

| ID | Check | Where | Code on failure | Outcome | Premise |
|---|---|---|---|---|---|
| Z1 | Structure 2 leaves rebuild the claimed Merkle root | `directory-node.ts` ~5598 | `merkle_root_mismatch` | reject the seal | W19 |
| Z2 | Every leaf signature verifies | `directory-node.ts` ~5627-5634 | `leaf_signature_invalid` | reject | — |
| Z3 | Each leaf's content hash matches | `directory-node.ts` ~5639 | `content_hash_mismatch` | reject | — |
| Z4 | The `prev_root` chain is unbroken | `directory-node.ts` ~5646 | `prev_root_chain_broken` | reject | Z1 |
| Z5 | No leaf acknowledges something not yet said | `directory-node.ts` ~5666 | `causal_chain_violated` | reject | Z4 |
| Z6 | The final two leaves are SEAL ctrl leaves from both parties | `directory-node.ts` ~5679 | `seal_leaves_invalid` | reject | Z2 |
| Z7 | The initiator's FROST signature verifies | `directory-node.ts` ~6190-6205 | `seal_signature_invalid` | `session_seal_rejected` to both | — |
| Z8 | A `seal_submission` from a relay is shape-valid | `seal-unilateral-verify.ts` ~40-95 | `seal_submission_leaves_malformed` / `_leaf_kind_unknown` / `_content_bytes_malformed` / `_content_bytes_not_permitted` | reject | `⊘` — accepted from any dialer, no receipt binds it |
| Z9 | The unilateral seal is not a replay | `directory-node.ts` ~4643-4644 | already-sealed | reject | — |
| Z9.1 | The unilateral submitter is a participant | `directory-node.ts` ~4672-4690 | `unilateral_participants_unknown` | reject | — |

### Z-b — Each co-signing node checks independently, before contributing a share

This is the sovereign-node invariant expressed as code: a node that cannot check the record does not
sign it.

| ID | Check | Where | Code on failure | Outcome | Premise |
|---|---|---|---|---|---|
| Z10 | The bytes are a seal TBS under the right context | `seal-cosign-evidence.ts` ~222 | `SEAL_TBS_UNREADABLE` | refuse the share | — |
| Z11 | Evidence (leaves + close timestamp) was attached | `seal-cosign-evidence.ts` ~230-243 | `SEAL_EVIDENCE_MISSING` | refuse the share | — |
| Z12 | The leaves are decodable | `seal-cosign-evidence.ts` ~247 | `SEAL_EVIDENCE_MALFORMED` | refuse the share | — |
| Z13 | Each leaf verifies under the key it names | `seal-cosign-evidence.ts` ~259 | `SEAL_LEAF_SIGNATURE_INVALID` | refuse the share | — |
| Z14 | All leaves belong to one conversation | `seal-cosign-evidence.ts` ~275 | `SEAL_LEAF_SESSION_MISMATCH` | refuse the share | — |
| Z15 | No third signer in a two-party conversation | `seal-cosign-evidence.ts` ~215+ | `SEAL_THIRD_SIGNER` | refuse the share | — |
| Z16 | The leaves reproduce the root **and count** we are asked to sign | `seal-cosign-evidence.ts` ~215+ | `SEAL_ROOT_UNSUPPORTED` | refuse the share | — |
| Z17 | Both participants carried a signed transcript root | `seal-cosign-evidence.ts` ~215+ | `SEAL_APPROVAL_UNSUPPORTED` | refuse the share | — |
| Z18 | The agent is not paused (honor-check) | `directory-node.ts` ~1612 | LEVER-001 refusal | refuse the share | — |

### Z-c — The client checks the certificate it gets back

| ID | Check | Where | Code on failure | Outcome | Premise |
|---|---|---|---|---|---|
| Z19 | The certificate has its required fields | `seal-coordinator.ts` ~348 | `missing_certificate_fields` | refuse the certificate | — |
| Z20 | The certificate's threshold signature verifies | `seal-coordinator.ts` ~370 | verdict reason | refuse | R1 |
| Z21 | **The certified root describes our own conversation** | `seal-coordinator.ts` ~405-440 | `seal_root_mismatch` | refuse, `source: "local"` | — |
| Z22 | Frontier leaves were carried at all | `seal-coordinator.ts` ~491 | `frontier_leaves_missing` | refuse | — |
| Z23 | Frontier leaves re-derive | `seal-frontier-verify.ts` ~52-90 | `leaf_signature_invalid` / `leaf_malformed` / `leaf_session_mismatch` | refuse | — |
| Z24 | **The published frontier is not inflated beyond what the leaves support** | `seal-frontier-verify.ts` ~94-130; `seal-coordinator.ts` ~523-530 | `frontier.overridden` | refuse | Z23 |
| Z25 | The unilateral certificate is well-formed and valid | `seal-coordinator.ts` ~648-661 | `malformed_certificate` / `certificate_invalid:<reason>` | refuse | — |
| Z26 | The certified leaf set reproduces the sealed root before we store it | `session-node-manager.ts` `recordCertifiedLeafSet` | refuses silently to store | later proofs unavailable **by name** | Z21 |
| Z27 | The certificate persisted locally | `seal-coordinator.ts` ~546, ~771, ~885 | `seal.certificate.persist.failed` | logged | — |

### Z-d — Unilateral seal gate (the counterparty never co-closed)

| ID | Check | Where | Code on failure | Outcome | Premise |
|---|---|---|---|---|---|
| Z28 | The delivery grace window has elapsed | `seal-coordinator.ts` ~623-629; `directory-node.ts` ~729 | `seal_unilateral_too_early` | refuse, with remaining seconds | — |
| Z29 | The counterparty is genuinely absent, not present | `seal-escalation.ts` ~241 | `seal_counterparty_present` | refuse | relay liveness |
| Z30 | A high-stakes session has the required evidence | `seal-escalation.ts` ~249 | `seal_high_stakes_evidence_required` | refuse | — |
| Z31 | We hold our own signing key | `seal-escalation.ts` ~91 | `seal_agent_key_unavailable` | refuse | — |
| Z32 | The carried chain is non-empty and contiguous | `seal-escalation.ts` ~123-134 | `seal_carry_empty` / `seal_carry_noncontiguous` | refuse | — |
| Z33 | No duplicate own ctrl leaf in the carry | `seal-escalation.ts` ~155 | `seal_carry_duplicate_own_ctrl_leaf` | refuse | — |
| Z34 | A bilateral seal is not already running | `seal-escalation.ts` ~182 | `seal_carry_bilateral_in_progress` | refuse | — |
| Z35 | Replayed receipts come from the relay the assignment names | `relay-node.ts` ~646-671 | `unilateral_receipt_wrong_relay` / `unilateral_leaf_seq_mismatch` / `unilateral_own_leaf_unwitnessed` / prev_root chain break | refuse the replay | W1 |

---

## Stage V — After the seal (what a third party can check)

| ID | Check | Where | Code on failure | Outcome | Premise |
|---|---|---|---|---|---|
| V1 | The proof is a well-formed CELLO inclusion proof | `inclusion-proof.ts` ~201, ~232 | `proof_malformed` | refuse to verify | — |
| V2 | The supplied `certified_root` is real hex | `inclusion-proof.ts` ~232+ | `certified_root_malformed` | refuse — **nothing established either way** | — |
| V3 | The proof lands on the certificate's root | `inclusion-proof.ts` ~232+ | `root_not_from_certificate` | refuse | Z21 |
| V4 | The hash algorithm is known | `inclusion-proof.ts` ~232+ | `unknown_content_hash_alg` | refuse | — |
| V5 | An unsalted proof is refused rather than "verified" | `inclusion-proof.ts` ~232+ | `unsalted_proof_refused` | refuse | — |
| V6 | The salt is present when needed | `inclusion-proof.ts` ~232+ | `salt_missing` | refuse | — |
| V7 | The message hashes to the named leaf | `inclusion-proof.ts` ~232+ | `message_does_not_match_leaf` | refuse | — |
| V8 | The audit path reconstructs the root | `inclusion-proof.ts` ~232+ | `proof_path_invalid` | refuse | V3 |
| V9 | Leaves are available to build a proof from at all | `seal-coordinator.ts` ~152-153 | `certified_leaves_unavailable` / `certified_leaves_not_carried` | refuse by name, says which side can still prove | Z26 |

---

## Worked example of the nesting — one field, all the way down

You asked how to track "we got a directory session assignment, how do we know it's legitimate". Take
the single most dangerous field on it: **the peer id we are told to dial**.

1. `N9` — is there one at all?
2. `N10` — does the *offer* the counterparty received name the same dialer? Something naming two
   different peers is refused before the receiver is handed over.
3. `N13`/`N14`/`N15` — is the document the right shape, FROST-signed, with a 32-byte signer?
4. `N16` — is the signer the key **we ourselves recorded** for this counterparty last time?
5. `N16.1` — where did that record come from? Stage **Z**: it was written when a previous session
   sealed. So the pin's trustworthiness reduces to the seal ceremony's, not to the directory's.
6. `N17` — does the signature verify under **that pinned key**? A compromised directory can produce
   a signature; it cannot produce one that verifies under a key it does not hold.
7. `T1` — and even then, the transport only admits that one peer id.
8. `I3` — and even then, whoever actually speaks must sign as the counterparty **we** named in our
   own request, which nothing the directory returned can influence.

The chain terminates twice: at a **local value** (our own request, our own database) or at a stated
`⊘`. That is the property to preserve when adding a check — a new check whose premise chain
terminates only in `⊘` has relocated trust rather than established it.

---

## The `⊘` list — inputs nothing currently earns

These are not necessarily bugs. Several are stated, deliberate bounds. They are collected here
because they are where the recursion stops, and each one deserves a decision about whether it needs
a *notification* even though it is not a *refusal*.

| Ref | What is trusted as given | Consequence if wrong |
|---|---|---|
| R4 | The consortium manifest signing root bundled in the binary | Everything below R verifies against the wrong authority |
| D4, D5, D6 | The directory's word on whether a counterparty exists, is online, and lives where | A wrong answer is a failed or misrouted session, not a forged one |
| A7 | That a **threshold** of our own directories is not colluding | A wrong counterparty could be named — designed-for bound, caught at `I3` |
| N18 | On **first contact**, the assignment is only checked for internal consistency | A tampered first assignment is caught; an authentic-looking one from a hostile directory is not, and it then becomes the pin |
| I3.2 | A verified signature with no counterparty on record stays soft | Cannot prove the signer either way; the only signal the orphan triage has |
| I10 | An **absent** relay ordering record | Position falls back to the witness stream; the relay stays optional for reading mail |
| Z8 | `seal_submission` frames from any dialer, with no relay receipt binding them | Bound one layer later by `seal-final-root`, not at the wire |
| W16 note | A peer may decline to bind by never acknowledging anything | Costs them their ratification of our history; does not falsify it |
| N5 | An offered moniker is never grounds to refuse | Display-only; logged, never trusted |

---

## Known boundary of this list

- **The document layer is not enumerated here.** `cello_doc_*` rides inside a session and has its own
  gate, screener and rejection vocabulary (`document-gate.ts`, `document-screen.ts`,
  `document-rejection.ts`, `document-handshake.ts` — the proposal signature check is at
  `document-handshake.ts` ~161). It is the largest omission and should be a second pass.
- **Registration and DKG** are treated as stage R premises, not enumerated. A session cannot start
  without them, but they are their own lifecycle.
- **Attestations and trust signals** appear only where they touch session admission (`N6`).
- Line numbers were read on 2026-09-06 and are approximate.
