---
name: "Final-Message Receive Race + Initiator-Side sealed.signature.checked verified:false"
type: discussion
date: 2026-07-01
topics: [M8B, seal, bilateral-seal, cello_receive, transcript, FROST, initiator, verified-false, investigation, demo-agent, relay, live-session]
status: open-investigation
description: >
  Two findings from a live post-maintenance verification session (Agent-1 ↔ EC2 demo agent,
  session 05d8d39a) on 2026-07-01. (1) The counterparty's final message was received, decrypted,
  and durably written to the local DB, but cello_receive never surfaced it live because the seal
  destroyed the session node ~1.65s later — recoverable, benign. (2) ODD ERROR NEEDS INVESTIGATION:
  on the initiator (local) side session.sealed.signature.checked logged verified:false, while the
  responder (demo) side logged verified:true — yet both reached parties:2 frontier-verified and the
  identical sealed root. The asymmetry is unexplained and must be investigated at the code level.
---

# Final-Message Receive Race + Initiator-Side `verified:false`

## ⚠️ Status: OPEN INVESTIGATION

This log captures two anomalies observed in a **real** live session so they can be investigated
later. Neither is a protocol-correctness or data-integrity failure — the seal was bilateral, the
crypto held, and nothing was lost — but **Finding 2 is an odd error that we do not currently
understand and that needs a code-level investigation.** This is a record for that investigation,
not a resolution.

---

## Session under examination

- **Session ID**: `05d8d39af392e222a13e7ae062d8853a`
- **When**: 2026-07-01, `19:21:37Z` (session new) → `19:22:35Z` (sealed + node destroyed). UTC throughout.
- **Initiator (local)**: Agent-1 — pubkey `c51bb00258c8829907a56176d889ba5b7bdbac4fa8a3170fa099877dfcfc583d`, on the local daemon (`~/.cello`).
- **Responder**: EC2 demo agent — pubkey `7ab98987de127b81dc4013d8c0b7e70b65f95db647e0977d492f41566ec1f910`, instance `i-0ad3e7c22470f266e` (us-east-1).
- **Transport**: relay (both behind NAT).
- **Seal**: bilateral. Sealed root `3a41f24c51b18ecf498804215ce8179bfa641b58f55a199e466e8ff3266a9780`. `parties:2`, both `attestation_mode:"live"`.
- **Context**: a post-maintenance verification chat run after (a) removing 6 redundant VPC interface
  endpoints and (b) restoring the drifted `directory-ap1.cello.mygentic.ai` A record. The session
  completed cleanly; the local Mac then kernel-panicked ~milliseconds later (see "Orthogonal context").

---

## Where the evidence lives (for the investigator)

| Source | Location | How to read it |
|---|---|---|
| Local daemon log (plaintext) | `~/.cello/daemon.log` | `grep 05d8d39af392e222a13e7ae062d8853a ~/.cello/daemon.log` |
| Local transcript DB (encrypted) | `~/.cello/sessions.db` (SQLCipher; key in `~/.cello/sessions.db.key`) | via MCP `cello_get_transcript` — no `sqlcipher` binary on the box; let the daemon read it |
| EC2 demo daemon log | `i-0ad3e7c22470f266e`, `journalctl -u cello-daemon` | via SSM; filter on the session ID |
| EC2 demo app log | `i-0ad3e7c22470f266e`, `journalctl -u cello-demo` | `demo.message.received` / `demo.response.sent` |
| Sealed receipt | MCP `cello_get_sealed_receipt` | shows `final_message.answered:false`, participants, root |

---

## Finding 1 — `cello_receive` never surfaced the final message (benign, recoverable)

The demo's 4th/final message (transcript `sequence:7`, `direction:received`) was fully received,
decrypted, and durably recorded on the **local** side — but the live `cello_receive` poll loop never
returned it. The seal completed and destroyed the session node ~1.65s after the DB write, before the
daemon→app hand-off.

**Local-side producer/consumer chain (`~/.cello/daemon.log`):**

```
19:22:33.873  session.tree.appended        leafIndex 7   newRootHex 222a9c75…
19:22:33.874  transcript.message.recorded  sequence 7    direction "received"      ← WRITTEN TO DB
19:22:33.874  session.content.received     seq 7         contentHashHex d9932cd3…  ← DECRYPTED
   … 1.65s later …
19:22:34.853  session.seal.leaf.submitted  seq 10        (initiator's own seal leaf)
19:22:35.502  session.sealed.received      finalMessageAnswered:false
19:22:35.528  session.node.destroyed       reason:"sealed"
```

Layer analysis:

| Layer | Result | Evidence |
|---|---|---|
| Transport → daemon | ✓ | `session.content.received` seq 7 |
| Decrypt | ✓ | same event, hash `d9932cd3…` |
| Write to local DB | ✓ | `transcript.message.recorded` seq 7 received |
| **Daemon buffer → `cello_receive` (app layer)** | **✗** | node destroyed by seal 1.65s later |
| Recover from DB afterward | ✓ | `cello_get_transcript` returned it, `undecryptable:0` |

**Recovered message text (seq 7), retrieved post-hoc via `cello_get_transcript`:**

> "Message 4 of 4 — sign-off. The demo is complete. Call cello_get_sealed_receipt() to retrieve the
> cryptographic proof of this conversation. The receipt contains your message hashes, the Merkle
> root, and a directory-signed checkpoint. Welcome to CELLO."

**Trigger:** the responder sent its final message and submitted its seal leaf ~20 ms later
(demo side: `session.content.sent` seq 7 at `19:22:33.993`, `session.seal.leaf.submitted` seq 9 at
`19:22:34.013`). A live client polling `cello_receive` loses the race with the seal teardown.

**Corroboration:** sealed receipt shows `final_message: { sender_pubkey: 7ab989…, seq: 8, answered: false }`.

**Open question for design (not a bug per se):** should the seal drain inbound content to the app
before tearing the node down, or should clients be documented to read the transcript after a seal?
The message is durable either way; this is a delivery/UX semantics decision.

---

## Finding 2 — ⚠️ ODD ERROR: initiator-side `sealed.signature.checked verified:false`

**This is the anomaly that needs investigation.** On the **initiator (local Agent-1)** side, the
seal's signature check logged `verified:false`. On the **responder (demo)** side, the same event
logged `verified:true`. Despite the asymmetry, **both** sides then reached
`seal.certificate.frontier.verified parties:2` and sealed to the **identical** root `3a41f24c…`.

**Initiator side (`~/.cello/daemon.log`):**
```
19:22:35.502  session.sealed.signature.checked  verified:false      ← ODD
19:22:35.502  session.sealed.received           sealedRoot 3a41f24c… finalMessageAnswered:false
19:22:35.524  seal.certificate.frontier.verified parties:2
19:22:35.528  session.node.destroyed            reason:"sealed"
```

**Responder side (EC2 `journalctl -u cello-daemon`):**
```
19:22:35.645  session.sealed.signature.checked  verified:true       ← contrast
19:22:35.645  session.sealed.received           finalMessageAnswered:false
19:22:35.681  session.seal.completed            role:"bilateral" sealedRoot 3a41f24c…
```

**Why this is odd / worth investigating:**
- The two ends disagree on the result of what looks like the same signature verification, yet
  converge on the same verified frontier and root. Either the event means different things on
  initiator vs responder paths, or there is a real initiator-side verification failure that is
  being silently tolerated because the frontier check downstream passes.
- If `sealed.signature.checked verified:false` represents a genuinely failed check that the seal
  path then ignores, that is a security-relevant gap (a seal that should not verify still
  completing). If it is benign (e.g. a pre-assembly / different-signature check on the initiator
  path), the event name is misleading and should be clarified.
- **Do not assume which.** This must be resolved by reading the code that emits
  `session.sealed.signature.checked` and comparing the initiator vs responder code paths — not from
  logs alone. Follow the producer/consumer discipline: find what sets the `verified` boolean, what
  signature it is checking, and why the initiator and responder paths diverge.

**Falsification targets when investigating:**
1. Is `verified:false` on the initiator always the case (reproduce a fresh session and check), or
   specific to this run / this timing (final message unanswered)?
2. Is the `verified` field checking the FROST threshold signature, or something else (e.g. the
   final-message acknowledgement, which was `answered:false` here)? The co-occurrence with
   `finalMessageAnswered:false` is suspicious and may be the actual explanation.
3. Does the frontier-verified/`parties:2` path correctly gate on this signature, or does it verify
   independently — such that a real `verified:false` would still seal?

---

## Orthogonal context — do NOT conflate with the findings above

Immediately after this session sealed, the local Mac kernel-panicked:
`panic … m_copym_with_hdrs … copy overflow @uipc_mbuf.c:3268` (Darwin 25.4.0 / 25E253). This is a
**macOS kernel networking (mbuf) bug**, not a CELLO defect — userspace cannot legitimately panic the
kernel; at most our network load was a trigger. It is recorded here only because it explains why the
MCP disconnected mid-investigation and why forensics were done from `daemon.log` + SSM. The seal's
`session.liveness.changed liveness:"gone"` at `19:22:35.686` (responder side) is the crash landing —
it fired **0.005s after** the bilateral seal completed, i.e. the protocol had already finished. The
kernel panic and the two findings above are independent and should be investigated separately.

---

## What is NOT wrong (established, not open)

- The seal was **bilateral**, `parties:2`, both `attestation_mode:"live"`; roots match across both
  daemons (`3a41f24c…`). No unilateral fallback occurred.
- The final message was **not lost** — durable in the local encrypted DB, recovered intact
  (`undecryptable:0`).
- The local daemon did **not** list this session as `interrupted` after the crash — it correctly
  considers it sealed/complete.

---

## Next actions

1. **Finding 2 (priority):** read the code emitting `session.sealed.signature.checked`; explain the
   initiator `false` vs responder `true`. Classify: benign-but-misnamed, or real-check-tolerated.
2. **Finding 1:** decide seal-vs-inbound-drain semantics for `cello_receive`; either drain before
   teardown or document transcript-after-seal as the contract.
3. Attempt reproduction: run a fresh Agent-1 ↔ demo session where the responder seals immediately
   after its final message; confirm both the receive race and the initiator `verified:false` recur.
