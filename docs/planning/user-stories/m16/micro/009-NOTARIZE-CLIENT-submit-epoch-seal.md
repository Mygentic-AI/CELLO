---
name: 009-NOTARIZE-CLIENT — Submitting an epoch seal for directory notarization
type: micro-work-order
date: 2026-09-02
status: open
source: DOD-M16-NOTARIZE-1
depends_on: [008-EPOCH; and 010 deployed before the live enforcer can pass]
description: >
  The client half of notarization: after sealing, the publisher's daemon submits the
  channel-epoch-seal to the directory over the existing signaling stream and drives the same
  FROST threshold ceremony the unilateral session seal already uses — over the epoch-seal TBS
  instead of a session TBS — then fills the seal's notarization slot and marks it notarized.
  Copies seal-escalation.ts end to end. Also defines the two new frame types in protocol-types.
---

# **<ins>MICRO</ins>** WORK ORDER 009-NOTARIZE-CLIENT — Submit an epoch seal for notarization

> ## THE RULES OF A MICRO WORK ORDER
>
> 1. **Read [[M16-PROCEDURE]] IN FULL before you start.** It binds you: the gate, the watchdog
>    cron (§4a — arm it now), the review dispatch, one session = one order. **Do not read
>    `M16-DEFINITION-OF-DONE.md`, `M16-BUILD-JOURNAL.md`, or any design log.**
> 2. **MICRO means small.** One mission. Never grow it.
> 3. **Found something else?** *Newly discovered* at the foot, five lines, keep going.
> 4. **500 lines, hard cap** on this file.
> 5. **Standard procedure applies in full:** tests first → implement → review
>    (`cello-unit-reviewer`) → fix every finding → commit per fix, push per commit. Flip
>    `status:` to `complete` in the SAME commit as the verdict.
> 6. **Done is done.**

---

## The problem, plainly

A publisher-signed epoch seal proves the publisher committed to a root. It does not yet prove
the commitment EXISTED at a time nobody can back-date — that is what the directory
consortium's threshold signature adds, once per epoch, no per-message work. The directory
already does exactly this kind of signing for the unilateral session seal: the client sends a
`seal_unilateral` frame and then drives the FROST rounds across the directory nodes.
**This order copies that flow with a different frame type and a different TBS.**

**Repo: `/Users/andrep/Documents/code/cello-client`** — `core/protocol-types` (frames) and
`core/daemon` (the submit flow). The directory-side handler is order 010; **the live
enforcer needs 010 deployed**, and until then your unit tests drive a fake seam (the same
way the existing seal-escalation tests do).

**Read first, in this order:** `core/daemon/src/seal-escalation.ts` (`escalateToUnilateralSeal`
— the ONE unilateral escalation; your copy-anchor), `core/daemon/src/session-ceremony.ts`
(`sendSealFrostSignature`, `verifyUnilateralCertificate` — how the client participates in the
FROST rounds and checks the resulting certificate), and its tests in `core/daemon/src/__tests__/`
(grep `seal-escalation`).

---

## The work

### 1. Frames — `core/protocol-types/src/channel-epoch-seal.ts` (extend 003's file)

```ts
export interface ChannelEpochSealSubmit {
  type: "channel_epoch_seal_submit";
  seal: Uint8Array;            // encodeChannelEpochSeal(seal) with notarization null
  ceremony_id: string;         // client-minted, hex, as seal_unilateral does
}
export interface ChannelEpochSealNotarized {
  type: "channel_epoch_seal_notarized";
  channel_pubkey: Uint8Array; epoch_index: number; epoch_root: Uint8Array;
  notarization: Uint8Array;    // FROST group signature over buildChannelEpochSealTbs(seal)
}
export type ChannelEpochSealRejectReason =
  | "not_a_channel" | "seal_invalid" | "publisher_signature_invalid" | "epoch_not_next"
  | "prev_root_mismatch" | "ceremony_failed" | "rate_limited";
export interface ChannelEpochSealRejected {
  type: "channel_epoch_seal_rejected"; epoch_index: number; reason: ChannelEpochSealRejectReason; detail?: string;
}
```
Export from the index barrel. (These are plain frame shapes; the signaling layer CBOR-encodes
frames itself, as it does for `seal_unilateral` — follow how `SealInterruptedRequest` in
`seal-interrupted.ts` is declared and exported.)

### 2. Submit flow — new file `core/daemon/src/channel-epoch-notarize.ts`

```ts
export async function notarizeEpochSeal(
  deps: {   // mirror SealEscalationDeps field-for-field where they apply
    logger; sendOver; sealStore: ChannelEpochSealStore; getKeyProvider; pendingNotarizeWaiters; timeoutMs;
    runFrostRounds: /* the same function object seal-escalation passes to drive FROST */;
  },
  channelPubkeyHex: string, epochIndex: number, correlationId: string,
): Promise<{ ok: true; notarization: Uint8Array } | { ok: false; reason: string; retry_after_seconds?: number }>;
```

Steps: (1) load the seal from `sealStore.get`; if already `notarized` → return ok with its
notarization (idempotent). (2) send `channel_epoch_seal_submit` over the channel identity's
signaling stream (`sendOver(agentName, frame)` — the channel is a registered identity with
its own stream, exactly like any agent). (3) await `channel_epoch_seal_notarized` or
`_rejected` with the same waiter-map + timeout shape `pendingUnilateralWaiters` uses;
meanwhile the FROST rounds are driven by the SAME code path `sendSealFrostSignature` uses —
you pass the epoch-seal TBS bytes as the message. (4) on `_notarized`: verify the FROST group
signature against the consortium key the way `verifyUnilateralCertificate` verifies a
certificate (reuse that verification function or its inner primitive — do not write a new
verifier); require `epoch_root` and `epoch_index` to match the local seal; then set
`seal.notarization = frame.notarization`, `sealStore.markNotarized(ch, epochIndex,
encodeChannelEpochSeal(seal))`, emit `channel.epoch.notarized` (fields `correlationId`,
`channel_pubkey`, `epoch_index`). (5) on `_rejected`: emit `channel.epoch.notarize_rejected`
(fields + `reason`), return the reason; `rate_limited` carries `retry_after_seconds`. (6)
on timeout: `channel.epoch.notarize_timeout`, return `{ ok: false, reason: "timeout" }` —
the seal stays un-notarized and the next scheduler pass retries.

### 3. Trigger and retry

`ChannelEpochSealer.sealNow` (008) calls `notarizeEpochSeal` after a successful seal (fire
and await; failure does not undo the seal). The 008 scheduler tick additionally retries
notarization for every seal with `notarized = 0` (add `sealStore.listUnnotarized(ch)`),
with a per-seal backoff of 60s × attempt, capped at 1 hour — track attempts in memory, not
in the table.

### Observability

`channel.epoch.notarized`, `channel.epoch.notarize_rejected`, `channel.epoch.notarize_timeout`,
`channel.epoch.notarize_retry` (fields `attempt`, `next_in_ms`). No `console.log`.

---

## ⚠️ WHAT MUST NOT CHANGE

- **Verify the notarization before storing it.** A frame from the directory is not proof;
  the FROST group signature over YOUR TBS bytes is. Storing an unverified blob in the
  notarization slot is the silent-fallback shape.
- **The publisher's seal is immutable; only the notarization slot changes.** `markNotarized`
  replaces the cbor with the same seal plus the slot filled — if any other field differs,
  that is a bug; test 3 pins it.
- **No new FROST code.** The rounds are driven by the existing ceremony code with a
  different message. If the existing function cannot take an arbitrary message, that is a
  §5 stop, not an invitation to fork it.
- **Timeout does not fail the seal.** The seal exists locally and is valid; only its
  notarization is pending. Do not delete, re-sign, or re-open the epoch.
- **No backward-compat branches; strict frame shapes.**

---

## Tests — write ALL of these first, confirm ALL red, then implement

New file `core/daemon/src/__tests__/channel-epoch-notarize.test.ts` (add to
`core/daemon/tsconfig.test.json`), built on the fake-seam pattern the seal-escalation tests
use (find them; reuse their frame-capture and waiter-resolution helpers).

1. `submit frame carries the encoded seal and a ceremony id` — captured frame `type` is
   `channel_epoch_seal_submit`, `seal` decodes to the local seal, `ceremony_id` is 32 hex.
2. `a valid notarized reply verifies, fills the slot, and marks notarized` — resolve the
   waiter with a frame whose `notarization` is a REAL FROST group signature produced with the
   test consortium keys the existing ceremony tests use; afterwards `sealStore.get` shows
   `notarized = 1` and the decoded seal's `notarization` equals the frame's; `channel.epoch.
   notarized` logged.
3. `everything but the notarization slot is unchanged` — byte-compare the notarized seal's
   TBS to the pre-notarization TBS.
4. `a reply with a bad signature is refused` — flip one byte; result `ok: false`, store
   still `notarized = 0`, nothing written.
5. `a reply for the wrong epoch_root is refused` — same shape, root altered.
6. `rejected reply surfaces its reason` — `_rejected` with `not_a_channel` → result reason
   equals it; store untouched.
7. `timeout leaves the seal intact and un-notarized` — no reply; result `timeout`; seal row
   present; `channel.epoch.notarize_timeout` logged.
8. `already-notarized is idempotent` — second call returns ok without sending a frame.
9. `retry backoff sequence` — drive the retry path three times with a failing seam; assert
   `channel.epoch.notarize_retry` events carry `attempt` 1,2,3 and `next_in_ms` 60000,
   120000, 180000.

---

## Definition of Done

1. Frames, submit flow, trigger, and retry exist as specified.
2. All nine tests exist, went red first (journal), now green; file in `tsconfig.test.json`.
3. **Revert test:** skip the signature verification in step (4) and confirm test 4 goes red;
   restore. Make `markNotarized` re-sign the seal and confirm test 3 goes red; restore.
4. Gate passes: `pnpm run test` → `pnpm run lint` → `pnpm run typecheck`.
5. **Enforcer (separate OS processes; needs order 010 deployed to the dev consortium or run
   locally via the spine harness):** a spine test in trustless-cello (`packages/e2e-tests/
   src/spine/m16-epoch-notarize.spine.test.ts`, written in THIS order but runnable only once
   010 exists) registers a channel, publishes 3 artifacts, seals, and asserts the daemon logs
   `channel.epoch.notarized` and the directory logs the 010 acceptance event. If 010 is not
   yet available when you finish, journal that the enforcer is WRITTEN and BLOCKED on 010,
   leave this line 🟡, and the planner runs it when 010 lands.
6. Reviewed by `cello-unit-reviewer`, every finding fixed, verdict quoted below and in the
   journal.
7. `status:` flipped to `complete` in the same commit as the verdict.

**Not in scope:** the directory handler and storage (010); the high-water-mark lookup client
(Tier 4 gap detection); subscriber-requested seals (011); npm publishing — **note: this
order changes protocol-types, so 010 is blocked on the planner shipping it.**

---

## Traps recorded before you start

- **The FROST message is the TBS bytes, not the encoded seal and not the root alone.** The
  directory signs what the publisher signed; test 2's real signature is over the TBS.
- **Copy `seal-escalation.ts`'s waiter/timeout shape exactly** — its comments explain why
  each refusal reason exists; the same discipline applies.
- **`sendOver` takes the CHANNEL identity's agent name** (it has its own stream), not the
  admin's.
- **`core/daemon/tsconfig.test.json`; `@claude-flow/testing`.**

---

## Newly discovered

*(add findings here — symptom, file, one-line consequence, five lines max each; keep going)*
