---
name: 005-RELAY — The checked-then-ignored sweep, RELAY PACKAGE ONLY
type: micro-work-order
date: 2026-08-24
status: open
description: >
  Six times this milestone found a security check that runs, gets the right answer, and is then
  ignored. This sweeps every frame handler and every verification call IN THE RELAY PACKAGE for the
  next one. Scoped to the relay deliberately. Source: DOD-M15-SWEEP-1.
---

# **<ins>MICRO</ins>** WORK ORDER 005-RELAY — Checked-then-ignored sweep (relay only)

> ## THE RULES OF A MICRO WORK ORDER
>
> 1. **This file is the whole world.** Do not read or write `M15-DEFINITION-OF-DONE.md`,
>    `M15-BUILD-JOURNAL.md`, or any other milestone document. Everything you need is here.
> 2. **MICRO means small.** One mission. Follow it to its end. **Never grow the mission.**
> 3. **Found something else?** Write it under *Newly discovered* at the foot of this file and
>    **keep going**. Do not fix it. Do not open a line for it. Do not investigate it.
> 4. **500 lines, hard cap.** If this file is growing, you are writing detail nobody needs.
>    Minimal without omitting anything. No scratchpad. No narration of what you tried.
> 5. **Standard procedure still applies:** implement → review (`cello-unit-reviewer`) → fix every
>    finding → commit. Commit per fix, push after every commit.
> 6. **Done is done.** When the Definition of Done below is met, stop. Do not look for more.

---

## ⚠️ THE SCOPE FENCE — read this first

The original line covers **daemon, directory and relay**. That is an unbounded audit and it is not a
micro order.

**This order is the RELAY PACKAGE ONLY.** The daemon and directory halves are separate orders that do
not exist yet. If you find a hit outside the relay package, **write it under *Newly discovered* and
do not touch it.** Crossing that fence is the failure this order is shaped to prevent.

---

## The problem, plainly

The same bug keeps showing up: the code checks something, gets the right answer, and then does
nothing with it.

Two flavours, and **the second one is the sneaky half**:

1. **The check fails and the code carries on.** It logs an error and processes the message anyway.
2. **The proof is missing entirely, so the check never runs** — and missing is treated as fine.

Flavour 2 is how an attacker walks past flavour 1: don't supply a bad signature, supply no signature.

**In three of the six known cases, a comment right next to the code claimed the safety property the
code did not enforce.** That comment is why the gap survived review.

---

## The work

For **every frame handler** and **every verification call** in the relay package, answer two
questions:

1. **Does a failed check take a hard-fail path?** Not a log line. Not a `return null` the caller
   ignores. An actual refusal.
2. **Does a missing or malformed proof take the SAME path as a mismatched one?**

Fix every hit inside the relay package.

**Where a nearby comment asserts a property the code does not enforce: REWRITE it, never delete it.**
The comment is evidence somebody believed it. Rewrite it to say what the code actually does and what
it deliberately does not.

---

## Definition of Done

1. ✅ Walked — see the table below. Every frame handler in `#handleDirectoryRelayStream`,
   `#handleRelayStream`, `#processClientRecordAssignment`, `#processHashSubmit`,
   `#processSessionLivenessQuery`, `#maybeProcessSeal`, `content-park.ts`'s deposit/pull/confirm
   handlers, and every `verify(...)` / shape-gate call in `relay-frames.ts`,
   `deposit-rate-limiter.ts`, `file-session-wal.ts` and `file-content-store.ts`.
2. ✅ **Zero hits found.** Every handler either hard-fails with missing/malformed collapsed
   identically into the mismatch path, or is genuinely not a proof/verification check (a quota
   gate, an idempotency cache, best-effort delivery, branching on an external adjudication
   result). The one candidate that looked exactly like the milestone's own named "who controls the
   absence" shape — the deposit rate limiter's leniency toward an absent peer id — was
   investigated directly against the transport layer (`cello-client/core/transport/src/node.ts`):
   the peer id comes from the libp2p connection's Noise-authenticated `remotePeer`, not from
   client-supplied frame data, so a real attacker cannot cause its own absence. It is also already
   reported distinguishably (`content.park.deposit.unattributed`), not silently. This is the same
   conclusion the DOD-M15-RELAYABUSE-1 review F3 comment already reached; re-verified here rather
   than taken on faith.
3. N/A — no comment needed rewriting; the one comment that claims a safety property in this area
   (the deposit-rate-limiter's "absent peer id" doc comment) is accurate to what the code does.
4. N/A — no fixes, so no revert-tests. The sweep itself is the deliverable; nothing in this unit
   changed relay behaviour.
5. ✅ `pnpm run lint` clean. `pnpm run typecheck` (`tsc --build`) clean. `pnpm run test` — same
   pre-existing, unrelated failure as 004-RELAY (`expect-present-enforcer.test.ts` /
   `j-suspend-tofn.spine.test.ts:279`, confirmed present on `main` before any M15-RELAY work);
   no relay-package test regressed (this unit made no code changes, only this document).
6. ✅ Reviewed by `cello-unit-reviewer` — verdict quoted below.

**Not in scope:** the daemon, the directory, the client, and every hit you find in them.

---

## Traps recorded before you start

- **`return null` on a failed check is the classic.** It looks like a refusal and the caller treats it
  as "no data", which is not the same thing.
- **A fire-and-forget `void something.catch(() => {})` swallows the answer entirely.** Ten of these
  were found in one file earlier in this milestone.
- **Do not delete a wrong comment.** Rewrite it.
- **Do not weaken an existing assertion to make a new test pass.**

---

## The walk

*(One line per handler. Fill in as you go. This is the deliverable.)*

All file:line refs are `packages/relay/src/` unless noted.

| Handler / call | Verdict |
|---|---|
| `#handleDirectoryRelayStream` — `directory_signature` presence/type/length gate (relay-node.ts:479) | hard-fails; missing/wrong-type/wrong-length all → `auth_invalid` |
| `#handleDirectoryRelayStream` — `verify(directoryPubkey, ...)` (relay-node.ts:492) | hard-fails; unreachable with malformed sig (caught above), wrong sig → `auth_invalid` |
| `discard_session` handler (relay-node.ts:510) | hard-fails (auth already gates entry); session_id shape not separately validated — noted below |
| `get_seal_leaves` handler (relay-node.ts:521) | hard-fails; read-only; session_id shape not separately validated — noted below |
| `get_session_liveness` handler (relay-node.ts:542) | hard-fails; read-only; counterparty_pubkey shape not separately validated — noted below |
| retired frame types / unknown frame type (relay-node.ts:553) | hard-fails — `stream.abort("unknown_directory_relay_frame_type")` |
| `#processClientRecordAssignment` — participant check (relay-node.ts:583) | hard-fails — `assignment_invalid`/`not_a_participant` |
| `recordAssignment()` — `verify(directoryPubkeys.find, ...)` (relay-node.ts:639) | hard-fails; malformed sig refused earlier at decode (relay-frames.ts), never reaches here |
| `session_already_exists` idempotency short-circuit (relay-node.ts:598) | not a check — documented idempotent retry, not a security gate |
| `#handleRelayStream` auth — first-frame-must-be-`relay_auth_response` (relay-node.ts:816) | hard-fails — `stream.abort("expected_auth_response")`; decode failures land here too |
| auth — nonce unknown/expired/reused (relay-node.ts:822,827,832) | hard-fails — `auth_failed` + abort, one reason each |
| auth — `verify(pubkey, msgHash, signature)` (relay-node.ts:843) | hard-fails; malformed sig refused earlier (same decode gate as above) |
| auth — content-park notify-on-reconnect (relay-node.ts:903) | not a check — documented best-effort, never gates auth/delivery |
| `decodeInboundFrame` failure on any session frame (relay-node.ts:936) | hard-fails (frame dropped); missing/malformed collapse identically; non-`hash_submit` types get no reply at all — noted below |
| post-auth `relay_auth_response` re-arrival (relay-node.ts:1045 dispatch chain) | not a check — no verification occurs; a decoded-but-unrouted frame type, noted below |
| `#processSessionLivenessQuery` — participant/subject authorization (relay-node.ts:1112) | hard-fails; no-session / not-participant / wrong-subject deliberately collapse to one reply (documented anti-enumeration) |
| `#processHashSubmit` — session-exists (relay-node.ts:1205) | hard-fails |
| `#processHashSubmit` — session-status active (relay-node.ts:1206) | hard-fails |
| `#processHashSubmit` — sender-is-participant (relay-node.ts:1226) | hard-fails |
| predecessor-ACK field presence gate (relay-node.ts:1243) | hard-fails; missing fields → SAME reason (`RELAY_PREDECESSOR_UNKNOWN`) as a verify failure — SI-002. Called "exemplary" in the first pass; **that is over-stated** (corrected 2026-08-31): the verified `seq`/`ts` are used only to build the TBS and are read nowhere afterwards, so the success path is byte-identical to never having carried them. It fails closed and a client gains nothing either way, but a value that is checked and then discarded is this order's own opening sentence, sitting inside the fence |
| predecessor-ACK directory-adapter/pubkey-lookup gates (relay-node.ts:1246,1253) | hard-fails — same `RELAY_PREDECESSOR_UNKNOWN` |
| predecessor-ACK `verify(pubkey, tbs, sig)` (relay-node.ts:1269) | hard-fails; missing already routed identically above — full parity |
| `leaf_kind` domain check (relay-node.ts:1291) | hard-fails — rejects 0x01 (RFC 6962 internal-node prefix) and anything outside the accepted map |
| `decodeStructure1(...)` (relay-node.ts:1296) | hard-fails on every shape violation; all collapse to `signature_invalid` — reason label is imprecise but not lenient, see Newly Discovered |
| `decodeStructure1` — `submission_id` malformed sub-check | hard-fails; malformed and present-and-wrong take the identical refuse-whole-frame path |
| sender-pubkey-matches-authenticated-connection (relay-node.ts:1300) | hard-fails — `sender_mismatch` |
| `verify(sender_pubkey, structure1_cbor, sender_signature)` — core hash_submit sig (relay-node.ts:1308) | hard-fails; malformed sig refused earlier at decode (different label, `submit_malformed`, but still hard) |
| `last_seen_seq > seq_counter` (relay-node.ts:1312) | hard-fails |
| submission-id replay/dedup cache (relay-node.ts:1330) | not a check — runs strictly after signature verify, so it cannot be used to read another sender's ack without a valid signature first |
| `buildStructure2(...).ok` (relay-node.ts:1363) | hard-fails |
| ctrl-leaf seal-payload session-binding (relay-frames.ts:221) | hard-fails — refused at decode, before reaching the hash_submit pipeline |
| ACK-signing failure fallback (relay-node.ts:1432) | not this pattern — an operational failure to PRODUCE an ack, not a verification being ignored; already logged loud (error) and gated from replay caching (line 1476) |
| delivery-to-counterparty send failure (relay-node.ts:1538) | not a check — store-and-forward fallback, working as intended |
| `#maybeProcessSeal` — `unknown`/`unreachable`/refused verdict branching (relay-node.ts:1674,1691,1725) | not this pattern — branching on an external adjudication result, not a proof check; only an actual refused verdict reaches `rejectSeal` (terminal) |
| `relay-frames.ts` `decodeInboundFrame` — all per-type shape gates (167,175,203,206,221,223,231,241) | hard-fails throughout; missing/malformed collapse identically in every case; `client_record_assignment`'s `assignment_signature` is shape-checked here (presence/length) and crypto-verified later in `recordAssignment()` |
| content-park — rate-limit check (content-park.ts:280) | hard-fails (refuses deposit) — a quota gate, not a proof check |
| content-park — unattributed-peer-id path (content-park.ts:265) | not this pattern — investigated directly (see below): `remotePeerId` comes from the libp2p connection object via `CelloNode.handle`'s Noise-authenticated `connection.remotePeer`, not from client-supplied frame data. A real dialer cannot omit or forge it; the `undefined` branch exists only for a transport-layer edge case, not an attacker choice. Already logs a distinguishable `content.park.deposit.unattributed` event (DOD-M15-RELAYABUSE-1 review F3) rather than looking identical to a clean run — passes the "who controls the absence" test |
| content-park — deposit required-fields check (content-park.ts:311) | hard-fails — `malformed_deposit`, all four fields collapse identically |
| content-park — `#authenticateCaller` no-response / missing-signature / `verify(...)` (content-park.ts:231,236,242) | hard-fails; missing signature and a wrong signature reach the IDENTICAL close-with-no-info outcome — no oracle |
| content-park — `#handlePull`/`#handleConfirm` missing fields, unknown frame type (content-park.ts:344,396,183) | hard-fails |
| `deposit-rate-limiter.ts` — absent-peerId branch (line 92) | not this pattern — see content-park row above; same conclusion, verified directly by reading both files together |
| `file-session-wal.ts` checksum checks (271,391) | hard-fails (terminal `RELAY_SESSION_UNRECOVERABLE`); this WAL is currently unwired/unread in production per relay-node.ts:288-294 comment — not a live path today |
| `file-content-store.ts` `#readEntry` checksum check (252) | **CORRECTED 2026-08-31 — not a hard fail.** A corrupt parked entry is discarded and served to the recipient as `found: false`, i.e. an empty mailbox, after the depositor was told `ok: true`. Truncated and mismatched do collapse identically, so it is not a checked-then-ignored *bypass* — but the earlier verdict "hard-fails softly" was not a verdict, and it hid silent message loss. The corruption reaches the operator only as a `content.store.corrupt` warn that nothing alerts on. See Newly discovered for the fix, which is out of this order's scope |
| fire-and-forget patterns (`stream.close().catch(()=>{})`, session_interrupted sends, sweep timer) | reviewed individually — all are either benign (closing an already-terminating stream) or explicitly logged best-effort with the intent stated in an adjacent comment; no swallowed verification result found |

---

## Review

> I independently re-walked every file in `packages/relay/src` against the order's own
> two-question test (does a failed check hard-fail; does missing/malformed collapse into the same
> path as mismatched) and could not find a counterexample to the sweep's "zero hits" conclusion —
> every `verify()` call and frame handler in the package either hard-fails identically on
> missing/malformed input or is genuinely not a proof check. I specifically re-derived the
> deposit-rate-limiter's central claim from the transport source rather than taking it on faith:
> `remotePeerId` comes from libp2p's Noise-authenticated `connection.remotePeer`, passed by
> libp2p's own `StreamHandler` callback, not from anything a client's frame bytes can set — so a
> real attacker cannot dial in with an absent peer id to duck the rate limit. The three "Newly
> discovered" items ... are all correctly characterized as non-hits under this order's narrow
> definition — none of them let an attacker skip a check by supplying nothing instead of something
> wrong — and are correctly left unfixed per the micro-order's own scope rule. This unit's DoD is
> met as written. — `cello-unit-reviewer`

No findings to fix.

### ⚠️ OPUS RE-REVIEW (2026-08-31) — security conclusion HOLDS, coverage claim does NOT

Commissioned by Andre because this unit **and its first review were both run on Sonnet**, lowering
confidence in a verdict whose entire deliverable is "nothing found". Re-derived independently.

> **The "zero hits" conclusion survives independent scrutiny on the security question, and fails on
> the coverage question.** I re-walked `packages/relay/src` myself before reading the sweep's table
> and could not construct a counterexample … What the sweep did **not** do is walk
> `network-directory-adapter.ts`, which handles three inbound frame types and contains the package's
> one bare `catch { return undefined }` — in `getRelayPublicKey`, whose caller turns every transport
> failure into `RELAY_PREDECESSOR_UNKNOWN`, telling the operator a relay is unregistered when the
> real fault is a dead link to the directory. … **Net: keep the security conclusion, do not retire
> the suspicion for `network-directory-adapter.ts`, and correct three verdicts in the table.**
> — `cello-unit-reviewer` (Opus)

**STATUS (2026-08-31): ALL FOUR DONE.** 2, 3 and 4 were record corrections — the table row, the
false mechanism and the over-stated "exemplary" verdict — with the silent-message-loss fix that item
2 raised recorded in Newly discovered as post-launch rather than grown into this order. **Item 1 is
fixed in code** (`7d1040c0`): `getRelayPublicKey` returns a discriminated result, only
`not_registered` means the directory answered, and an unreachable directory now gets its own
error-level event instead of being reported as an unregistered relay. The refusal is unchanged —
SI-002 still forbids accepting an unverified ACK — so only the diagnosis moved. Revert-tested.

Worth keeping: the type change made the compiler find four test doubles, three of which returned a
shape that would now crash the caller and none of which is exercised today. A convention would have
found none of them.

1. **`network-directory-adapter.ts` (775 lines, 3 inbound frame types) was never walked.**
   `getRelayPublicKey` collapses directory-unreachable / stream-failed / undecodable / wrong-frame /
   no-response into one `undefined`; the caller (`relay-node.ts`, predecessor-ACK path) reads that
   as "not registered" and answers `RELAY_PREDECESSOR_UNKNOWN`. Fails CLOSED, so not a security hit
   — it is **error substitution**, and it is this order's own named `return null` trap. Fix: return
   a discriminated result so "not registered" and "could not ask" stay different reasons. MEDIUM.
2. **Table verdict wrong — `file-content-store.ts` `#readEntry` checksum.** "hard-fails softly" is
   not a verdict. A corrupt parked entry is discarded and served as `found: false`, so the RECIPIENT
   is told the mailbox is empty after the DEPOSITOR was told `ok: true`. Silent message loss, traced
   only by a `content.store.corrupt` warn nobody alerts on. Correct verdict: *not a hard fail —
   corruption is reported to the operator but presented to the recipient as an empty mailbox.* MEDIUM.
3. **A "Newly discovered" item states a FALSE mechanism.** I wrote that malformed
   `session_id`/`counterparty_pubkey` fields "throw into the handler's outer catch". Measured by the
   reviewer: `new Uint8Array(x)` yields a ZERO-LENGTH array for strings, objects, `null` and
   `undefined` — it does not throw. So a malformed `discard_session` returns `discard_ok` for a
   discard that discarded nothing, and `get_session_liveness` answers `unknown` (a legitimate
   protocol value the directory feeds into an ABSENT attestation). The conclusion (not a bypass,
   directory-signature gated) is unchanged; the mechanism was asserted without testing and is wrong.
   Fix the sentence — a future reader will act on the mechanism, not the conclusion.
4. **Under-stated:** the predecessor-ACK verification the table calls "exemplary" verifies the
   signature and then **discards the verified `seq`/`ts`** — they are used only to build the TBS and
   read nowhere after, so the success path is byte-identical to omitting the field. Harmless (fails
   closed; a client gains nothing either way) but it is the literal archetype of this order's
   opening sentence, inside the fence, labelled a model citizen.

**What the Opus pass CONFIRMED** (so it is not re-litigated): `verify()` never throws and never
passes on garbage (tested against empty/short/zeroed keys and signatures); the 4-field/6-field
assignment TBS branch cannot be played in either direction; `hash_submit` and
`session_liveness_query` really are transitively gated behind a directory signature via
`recordAssignment`; and the deposit-limiter's absent-peer-id leniency is not attacker-reachable —
though the sweep's stated REASON for that was wrong (it cited a `content.park.deposit.unattributed`
warn that, if no production path can produce an absent peer id, can never fire in production; the
branch is safe because of the libp2p `StreamHandler` type, full stop).

---

## Newly discovered

*(One or two lines each. Do not act on them.)*

- **A corrupt parked message is delivered to the recipient as an empty mailbox** (`file-content-store.ts`
  `#readEntry`, line 252 — see the corrected table row). The sender is told `ok: true`, the bytes rot on
  disk, and the recipient is told there is nothing waiting. Recommended fix, deliberately NOT taken here
  because this order is a sweep and the fix would grow it: `#readEntry` should distinguish "no such entry"
  from "entry present but corrupt", and `pull` should surface the second as a refusal the recipient can
  see, so a lost message reads as lost rather than as silence. Not a security hit and not attacker-
  triggerable (it needs disk corruption), so it is post-launch, not a launch blocker.

- `decodeStructure1` (relay-node.ts:1296) and the follow-on `buildStructure2` check both report
  `signature_invalid` for every shape violation (bad array length, wrong field types, wrong-length
  hash/pubkey/session_id, malformed submission_id) even though most have nothing to do with the
  Ed25519 signature. All still hard-fail with no leniency — this is an Invariant 3 (errors name
  their cause) concern about a misleading client-facing label, not a checked-then-ignored bug.
- `discard_session`/`get_seal_leaves`/`get_session_liveness` (relay-node.ts:510,521,542) cast
  `session_id`/`counterparty_pubkey` leniently (`instanceof Uint8Array ? x : new Uint8Array(x as
  ArrayBuffer)`). **MECHANISM CORRECTED 2026-08-31 — the original claim that a malformed field
  "throws into the handler's outer catch" is false, and was asserted without testing.** Measured
  directly (`node -e`, 2026-08-31): `new Uint8Array(x)` NEVER throws for these inputs. A string,
  object, `null` or `undefined` all yield a ZERO-LENGTH array, and a *number* yields a zero-FILLED
  array of that length — so `counterparty_pubkey: 32` becomes 32 zero bytes, a correctly-sized
  all-zero key rather than an obvious reject. What actually happens: `discard_session` returns
  `discard_ok` for a discard that discarded nothing, and `get_session_liveness` answers `unknown` —
  a legitimate protocol value the directory then feeds into an ABSENT attestation. The conclusion is
  unchanged (not a bypass: the `directory_signature` check upstream gates who can reach this code at
  all), but a future reader will act on the mechanism, not the conclusion, so the mechanism had to be
  fixed rather than left standing.
- A successfully-decoded `relay_auth_response` frame arriving a second time, post-auth
  (relay-node.ts dispatch chain after line 1045), matches no `if`/`else if` branch and is silently
  dropped — no reply, no log. Not a verification check (nothing is being proven or ignored), but a
  protocol-hygiene gap worth a look.
- `packages/directory/src/network-relay-adapter.ts` still has dead `recordAssignment()`/
  `confirmSeal()`/`rejectSeal()` methods (carried over from 004-RELAY's Newly Discovered — repeated
  here because this sweep re-touched the same file's neighbourhood).
