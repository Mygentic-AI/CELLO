---
name: "Final-Message Receive Race + Initiator-Side sealed.signature.checked verified:false"
type: discussion
date: 2026-07-01
topics: [M8B, seal, bilateral-seal, cello_receive, transcript, FROST, initiator, verified-false, investigation, demo-agent, relay, live-session]
status: diagnosed
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

> **RESOLVED 2026-07-02 — both findings diagnosed at the code level.** See the
> "Resolution" section at the bottom. Finding 2 is benign-by-design (accept-without-verify
> when the seal signer's key is not held locally) with a misleading event shape; Finding 1
> is mechanism (1)+(2): no blocking receive exists, and seal teardown evicts unread buffered
> content. Fix proposals are in the Resolution section, pending Andre's decision.
>
> **Two corrections folded in after the initial write-up (from the 2026-07-02 review with
> Andre) — the fix descriptions below supersede the earlier ones:**
> - **Finding 2:** the seal signer is *whoever closes the session first* (not a fixed role),
>   so the fix must be **symmetric** — the directory hands *each* party the *other's* FROST
>   group primary. The earlier "responder gets the initiator's key" is only half of it.
> - **Finding 1:** the real fix is **completing the `cello_receive_session` stub** — a
>   fully-specced blocking receive that already worked in the retired in-process adapter and
>   was dropped in the daemon split — not merely making `cello_receive` honor `timeout_ms`.

## ⚠️ Status: OPEN INVESTIGATION (superseded — kept for the record)

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

## Considered mitigation — "demo waits 2s before sealing" (rejected as a fix; OK as a test aid)

A proposal was raised: have the demo agent wait ~2 seconds after sending its 4th message before it
begins sealing. Assessment: **it might make the demo pass more often, but it is not the fix — and
whether it helps at all depends on which of the three mechanisms below is true.**

**Whether the delay helps is mechanism-dependent** (we have not yet nailed down which applies — see
Finding 1). On the local machine the message was recorded at `19:22:33.874` and the node not
destroyed until `19:22:35.528`, so it was available for ~1.65s. Why `cello_receive` did not return
it in that window is one of:

1. **Polls preceded arrival, then polling stopped.** `cello_receive` returned `null` *immediately*
   ("no content currently buffered") rather than blocking — the guidance itself said "or use the
   blocking receive variant." The non-blocking polls came back empty before the message landed, then
   polling stopped. → A 2s delay does **nothing** here unless something keeps polling in the wider
   window.
2. **Seal flushed/cleared the pending receive buffer on teardown.** → A 2s delay **helps** (more
   time to deliver before the wipe).
3. **Message reached transcript/DB but was never enqueued into the live receive buffer.** → A 2s
   delay does **nothing** — there is nothing in the buffer to receive at any timing.

Reaching for the delay before knowing which case we are in is a guess, not a fix.

**Why the demo-side delay is the wrong layer even if it "works":**
- It **masks a client bug using the very tool whose job is to surface client bugs.** The demo exists
  so a new user can confirm their stack works. A real user-to-user session, where the sealing peer
  does not insert a courtesy sleep, would still lose the final message live — the demo would go green
  while the client path stays broken.
- It is **counterparty-dependent.** The protocol cannot assume peers add arbitrary pre-seal delays;
  correctness of *our* receive path must not depend on *their* timing.
- It **does not touch Finding 2** (initiator `verified:false`) at all.
- It is probabilistic — a slow relay or a client busy >2s re-opens the race.

**Where the real fix belongs (client side):**
1. **Use a blocking receive** — the receiver waits for the final message (up to timeout) instead of
   poll-and-give-up. Likely resolves mechanism (1), which is the suspected dominant case here.
2. **Seal drains pending inbound to the app before node teardown** — do not destroy the session node
   until committed transcript content has been delivered to / made drainable by the app. Resolves
   mechanisms (2) and (3).
3. **Document transcript-after-seal as the contract** — `cello_get_transcript` already recovers
   everything (`undecryptable:0`); clients should read it after a seal regardless.

**Verdict:** do NOT ship the 2s delay as the fix. It is acceptable **only as a temporary test aid**
— a wider window makes the race easier to observe and instrument during the investigation. The fix
belongs in the client receive/seal path (options 1–2). Step 0 remains: determine which of the three
mechanisms above is real, since that decides whether the delay would ever have mattered.

## Next actions

1. **Finding 2 (priority):** read the code emitting `session.sealed.signature.checked`; explain the
   initiator `false` vs responder `true`. Classify: benign-but-misnamed, or real-check-tolerated.
2. **Finding 1:** decide seal-vs-inbound-drain semantics for `cello_receive`; either drain before
   teardown or document transcript-after-seal as the contract.
3. Attempt reproduction: run a fresh Agent-1 ↔ demo session where the responder seals immediately
   after its final message; confirm both the receive race and the initiator `verified:false` recur.

---

# Resolution (2026-07-02)

Both findings diagnosed at the code level against cello-client daemon `0.0.19` (repo main
`cfc6af9` — verified: the last `daemon.ts` change, `2817f9f`, predates the publish commit, so
source == running binary). Evidence: `~/.cello/daemon.log`, EC2 `journalctl -u cello-daemon`
via SSM, and historical sessions `0593e9e1` / `a001ca74` / `7f50d4a1`.

## Finding 2 — VERDICT: benign-by-design, misleadingly logged. Not a tolerated failure.

`verified:false` does **not** mean "a signature check ran and failed." It means "this party
holds no key it can independently verify the seal signature against, so it accepted the
certificate on the strength of the authenticated Noise channel." A genuinely failed check
takes a different path entirely: `verifyBilateralSealCertificate` returns
`{ ok:false, reason:"signature_invalid" }`, the handler logs `session.sealed.signature.invalid`
and **returns early — the session is never marked sealed** (`daemon.ts:1760-1763`). There is
no tolerated-failure path.

### The full produce/consume chain

**Consume path (what ran on the initiator):**
1. Demo (session responder) closed → demo daemon ran the FROST seal ceremony with **its own
   group key** (EC2 log: `session.seal.ceremony.participated ok:true` +
   `session.seal.frost.signature.sent`; local log shows Agent-1 only auto-acked —
   `session.seal.autoacknowledged` — and never ran a ceremony).
2. `session_sealed` arrives on Agent-1's stream carrying `signer_pubkey` = **demo's primary**.
3. `verifyBilateralSealCertificate` (`session-ceremony.ts:511-565`): signer ≠ Agent-1's own
   primary (loaded fine from its share); falls to the counterparty check.
4. `counterpartyPrimaryHex` comes from the session record's `counterparty_primary_pubkey` —
   **NULL** on Agent-1's side → final branch → `{ ok:true, verified:false }` (line 555-558,
   the documented Noise-channel-accept).

**Produce path (why the precondition was absent):** `recordCounterpartyPrimary` has exactly
**one caller** — `acceptInboundAssignment` (`daemon.ts:3272-3274`), the **responder-side**
inbound-accept, which records the *session initiator's* primary off the FROST-signed
assignment's `signer_pubkey`. The **session-initiator side has no producer at all** — an
initiator never learns/records the responder's primary.

**The gap:** verifiability is asymmetric by construction. Whenever the **session responder**
drives the seal (its group key signs), the **session initiator** cannot channel-independently
verify — it accepts on Noise. The reverse direction works (responder recorded the initiator's
primary at accept time).

**Correction (2026-07-02 review) — the signer is the FIRST CLOSER, not a fixed role.** The
directory designates the "seal initiator" as *the sender of the first SEAL ctrl leaf* — i.e.
**whoever closes the session first** (`packages/directory/src/directory-node.ts:4049-4051`:
"The seal initiator is the sender of the second-to-last leaf (the first SEAL ctrl leaf)"), and
verifies + signs against *that* party's `primary_pubkey` (`#resolvePrimaryPubkey(initiatorHex)`,
line 4073). In session `05d8d39a` the **demo closed first** (its seal leaf at `19:22:34.013`
vs Agent-1's at `19:22:34.853`), so the **demo's** group key signed — which is why Agent-1, the
*session* initiator, could not verify. This matters for the fix: because either party may be the
first closer, and closing order is not known in advance, **both parties must hold both group
primaries**. The current provisioning (responder holds the session-initiator's primary) covers
exactly *one* of the two closing orders — it is half a design, not a coherent asymmetry.

**Which key is missing (and which are not) — there are three distinct keys.** (1) *Identity
keys (K_local)* — both parties always hold both; a session cannot exist otherwise. (2)
*Per-message sender keys* — each content leaf carries its own `sender_pubkey`+`sender_signature`,
so both parties verify every message the other sends (this is the "we co-sign the evolving
transcript" property, and it is already symmetric). (3) *The FROST group primary* — a *different*
key from the identity key (the joint DKG key: agent share + directory K_server shares), used only
for the final seal. Only key (3) is missing, and only in one closing direction. The intuition
"we sign each other's messages, so we must have each other's keys" is correct — for keys (1) and
(2), which both parties do have; the seal uses key (3), which was never part of the identity
exchange.

**Is there a rationale for withholding key (3)? No.** It is a *public* key (registered at the
directory); there is no secrecy to protect. Withholding it from the counterparty runs against
CELLO's own thesis — the seal exists for non-repudiation and third-party verifiability (an
arbitrator is *supposed* to verify), so the counterparty is the *last* party you would want
unable to verify. Privacy gives no cover either: the counterparty already holds your identity
key, so your group key adds no meaningful new linkage to them. A deniability rationale would run
directly opposite to the protocol's non-repudiation goal. Conclusion: the asymmetry is an
implementation-order artifact — and the code comment admits it, calling the missing direction
"a follow-on."

**Why both sides still converged on the same root:** the DOD-LEG-2 frontier verification
(`seal.certificate.frontier.verified parties:2`) is independent of the FROST-cert check — it
re-verifies per-leaf **sender signatures**, which both sides can always do.

### Answers to the falsification targets

1. **Always, not timing:** deterministic. Live-proof session `0593e9e1` (2026-06-30, local
   initiated / demo closed) logged the same `verified:false` locally. Loopback sessions
   `a001ca74` / `7f50d4a1` (responder accepted inbound → counterparty primary recorded) logged
   `verified:true` **twice each** — both listeners verified. The pattern is fully explained by
   "who closed" × "who has a recorded counterparty primary."
2. **It checks the FROST threshold signature** over the legibility-bound TBS. The co-occurrence
   with `finalMessageAnswered:false` is coincidence — unrelated fields on the same frame.
3. **The frontier check verifies independently** (per-leaf sender sigs). A real
   `signature_invalid` DOES gate the seal (early return, never sealed). The only
   accept-without-check is the key-not-held branch, which is deliberate and commented.

Also ruled out: share-load failure (paths returning `verified:false` at
`session-ceremony.ts:529/539/541`) — in the loopback sessions Agent-1's listener returned
`verified:true`, which requires its share to load successfully.

### Proposed fixes (Finding 2)

- **F2-a (observability, client-only, small):** make the unverified-accept legible. Return and
  log a `reason` on every `verified:false` branch — e.g. `signer_key_not_held`, `no_frost_share`,
  `non_frost_certificate` — so `session.sealed.signature.checked {verified:false,
  reason:"signer_key_not_held"}` can never again read as a failed check. Also fix the stale
  comment block in `session-ceremony.ts` (it still describes responder-verify as a follow-on;
  responder-verify is built — the missing symmetry is the initiator side).
- **F2-b (hardening — SYMMETRIC key provisioning, protocol addition, story-sized, cross-repo).**
  *Supersedes the earlier "responder gets the initiator's key" framing, which covered only one
  closing order.* Because the seal is signed by **whoever closes first** (see Correction above),
  **each party must hold the other's FROST group primary.** The directory already resolves both
  parties' primaries when it brokers the session (`#resolvePrimaryPubkey`); the fix is for it to
  ship **each party the counterparty's primary** — on the session_assignment (or on
  `session_sealed`) — so *both* sides record it via the existing `recordCounterpartyPrimary`.
  Then `verifyBilateralSealCertificate`'s counterparty branch verifies the seal regardless of who
  closed, and SI-003 tightens for free (an unknown signer becomes
  `signer_not_a_session_participant` → REJECT instead of accept-unverified). Today only the
  responder-records-initiator direction exists (`daemon.ts:3272-3274`, inbound-accept only); the
  new work is the **initiator-records-responder** direction plus the directory carrying the
  counterparty primary on the initiator-facing path. Needs a frame field + directory change +
  client change (both directions) + version cascade — a proper story, candidate for the
  E2E-hardening phase or the M9-merge era.

## Finding 1 — VERDICT: mechanism (1) is the proximate cause; mechanism (2) makes it permanent; mechanism (3) falsified.

**Mechanism (3) falsified:** the message WAS enqueued into the live receive buffer.
`#appendVerifiedContent` pushes to `#receivedContent` and then immediately emits
`session.content.received` (`session-node-manager.ts:2367-2376`) — the 19:22:33.874 event
proves the push happened.

**Mechanism (1) confirmed — and worse than suspected: no blocking receive exists anywhere in
the live daemon path, because a fully-specced blocking receive was DROPPED in the split.**
- The daemon's `cello_receive` handler (`daemon.ts:4139-4167`) reads **only** `session_id`.
  The `timeout_ms` the MCP shim forwards is **silently ignored** — the handler is a
  non-blocking `buf.shift()` (`takeReceivedContent`).
- `cello_receive_session` — the tool the shim exposes with a `timeout_ms` parameter — hits
  the `SESSION_TOOLS_REQUIRING_AGENT` **stub** (`daemon.ts:2112-2130`) and returns
  `not_implemented` for every call with a current agent.
- So the guidance string *"or use the blocking receive variant"* directs the client to a tool
  that does not exist. The client polled non-blocking, got nulls before 33.874, followed the
  guidance into a dead end, and stopped. Nothing wakes it (the content-arrival push is channel
  Gap 3-5; the shim discards all notification frames anyway — Gap 2).

**Correction (2026-07-02 review) — `cello_receive_session` is not a blank stub; it is a
regressed port.** The retired in-process adapter implements BOTH receive tools as **blocking**
(`core/adapter-claude-code/src/server.ts:254-334`):
- `cello_receive_session(session_id, timeout_ms)` — *"Blocks until a message arrives or the
  timeout expires."* Session-locked. Returns a normal message, `counterparty_closing`, or
  **`session_sealed` inline**, or `{type:"timeout"}`. This is the "blocking receive variant" the
  guidance names.
- `cello_receive(timeout_ms)` — same, but any-session (no `session_id`), with
  `other_sessions_pending`.

Both are specced and tested: **AC-003/AC-004** and `core/client/src/__tests__/session007.test.ts`
cover the blocking + inline-`session_sealed` behavior; `trustless-cello`'s e2e-tests
(`mcp-002.test.ts`, `node-004-e2e.test.ts`) still target `cello_receive_session` as the canonical
session-locked receive. In the split, `cello_receive` was re-ported into the daemon with the
**wrong semantics** (session-scoped *and* non-blocking — neither original), and
`cello_receive_session` (the real blocking one) was left stubbed. So mechanism (1) is not "we
never built a blocking receive" — it is "we built it, it worked, and the daemon port dropped it."

**Mechanism (2) confirmed as the finisher:** `destroyNode(reason:"sealed")` →
`#evictSessionCaches` → `#receivedContent.delete(key)` (`session-node-manager.ts:1249, 1295`)
— unread buffered content is **silently** evicted at seal teardown. After 19:22:35.528 no poll
could ever return seq 7 live. Durability held (DB transcript, `undecryptable:0`) — this is a
delivery/UX gap, not data loss.

**The 2s-delay assessment in this doc is confirmed:** the polls had already stopped before the
message arrived; a demo-side delay would not have helped. Correctly rejected.

### Proposed fixes (Finding 1)

*Revised 2026-07-02: the core fix is COMPLETING THE STUB, not merely making `cello_receive`
honor `timeout_ms`. The retired adapter is the reference implementation to port.*

- **F1-a (the fix — port the blocking receive into the daemon, daemon-only).** Replace the
  `cello_receive_session` `not_implemented` stub with a real handler that blocks up to
  `timeout_ms`, polling `#receivedContent` (reference: retired `server.ts:254-302`). Empty buffer
  → wait; resolved by the next `#appendVerifiedContent` push, a terminal seal/teardown answer, or
  timeout. Never hangs (INV-6 spirit). This is the "blocking receive variant" the guidance already
  names — completing it makes the guidance honest.
- **F1-a2 (one-tool-or-two — DECISION, recommend COLLAPSE).** Today `cello_receive` (live,
  session-scoped, non-blocking) and `cello_receive_session` (stub) are redundant by
  signature — both take `(session_id, timeout_ms)`. **Recommended: collapse** — make
  `cello_receive` the blocking handler and `cello_receive_session` a *true alias* to the same
  handler (remove it from the stub list). One implementation, both names work, the e2e tests that
  target `cello_receive_session` become live enforcers. *Deferred alternative:* restore the
  original two-axis design (session-locked `cello_receive_session` vs any-session
  `cello_receive(timeout_ms)` with `other_sessions_pending`) — the any-session variant overlaps
  with `cello_check_notifications` and `since_seq` from the command-surface design doc, so it
  belongs in **that** milestone, not this bugfix.
- **F1-b (the one genuinely new piece of wiring — surface `session_sealed` into the receive
  path).** Today the seal just calls `destroyNode(reason:"sealed")` → `#evictSessionCaches` →
  `#receivedContent.delete(key)`, silently. The blocking receive needs a terminal answer when a
  seal fires during its wait, so the daemon must **enqueue a `session_sealed` marker the receive
  path can return** (the retired tool returned `{type:"session_sealed", session_id, sealed_root,
  close_timestamp, checkpoint_status}` inline — `server.ts:282-291`). This IS the clean version
  of "drain before teardown": the waiter returns the terminal seal answer instead of the buffer
  being wiped out from under it. Any still-unread buffered content should be drainable before the
  marker (or the marker carries "N unread — read cello_get_transcript").
- **F1-c (observability, one line):** `#evictSessionCaches` logs
  `session.receive.buffer.evicted { unreadCount }` when it drops a non-empty buffer — the
  silent-drop of deliverable content becomes diagnosable even on the non-blocking path.
- **F1-d (contract, docs):** document transcript-after-seal as the contract regardless:
  a sealed session's full history is always available via `cello_get_transcript`.
- **F1-e (strategic, already parked in the command-surface design doc):** the `since_seq`
  cursor on `cello_receive` reading from the durable transcript — makes post-seal catch-up
  first-class and demotes the in-memory buffer to an optimization. Load-bearing for reconnect
  and the two-session group-chat model; build it there, not here.
- **Explicitly rejected:** the demo-side 2s pre-seal delay (masks the client bug; confirmed
  ineffective for the observed mechanism).

Publish cascade for F1-a/a2/b/c: daemon `0.0.20` + cli + connect bumps (client-repo only).

### What could not be proven from code alone

- That Agent-1's session row for `05d8d39a` has `counterparty_primary_pubkey = NULL` was
  proven by producer analysis (single caller, responder-only) + behavioral evidence across four
  sessions — not by reading the encrypted SQLCipher row directly. A direct DB read would be
  confirmatory but adds nothing the pattern doesn't already pin.
- Post-fix verification for F1-a requires a live re-run (falsification target 3's reproduction
  becomes the acceptance test: responder seals immediately after its final message → blocking
  `cello_receive` returns the message, then the sealed-terminal answer).
