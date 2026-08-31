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
| predecessor-ACK field presence gate (relay-node.ts:1243) | hard-fails; missing fields → SAME reason (`RELAY_PREDECESSOR_UNKNOWN`) as a verify failure — SI-002, exemplary |
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
| `file-content-store.ts` `#readEntry` checksum check (252) | hard-fails softly — corrupt entry is discarded and reads as "not found", truncated and mismatched collapse identically |
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

---

## Newly discovered

*(One or two lines each. Do not act on them.)*

- `decodeStructure1` (relay-node.ts:1296) and the follow-on `buildStructure2` check both report
  `signature_invalid` for every shape violation (bad array length, wrong field types, wrong-length
  hash/pubkey/session_id, malformed submission_id) even though most have nothing to do with the
  Ed25519 signature. All still hard-fail with no leniency — this is an Invariant 3 (errors name
  their cause) concern about a misleading client-facing label, not a checked-then-ignored bug.
- `discard_session`/`get_seal_leaves`/`get_session_liveness` (relay-node.ts:510,521,542) cast
  `session_id`/`counterparty_pubkey` leniently (`instanceof Uint8Array ? x : new Uint8Array(x as
  ArrayBuffer)`); a genuinely malformed field throws into the handler's outer catch, which logs it
  at `debug` as `relay.directory.stream.closed` ("normal disconnect") — mis-classifying a malformed
  admin frame as an ordinary disconnect. The directory_signature auth check upstream already gates
  who can reach this code, so it's an observability gap, not a bypass.
- A successfully-decoded `relay_auth_response` frame arriving a second time, post-auth
  (relay-node.ts dispatch chain after line 1045), matches no `if`/`else if` branch and is silently
  dropped — no reply, no log. Not a verification check (nothing is being proven or ignored), but a
  protocol-hygiene gap worth a look.
- `packages/directory/src/network-relay-adapter.ts` still has dead `recordAssignment()`/
  `confirmSeal()`/`rejectSeal()` methods (carried over from 004-RELAY's Newly Discovered — repeated
  here because this sweep re-touched the same file's neighbourhood).
