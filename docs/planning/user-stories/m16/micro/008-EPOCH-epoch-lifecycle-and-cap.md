---
name: 008-EPOCH — Epoch lifecycle and the cap that bounds equivocation
type: micro-work-order
date: 2026-09-02
status: open
source: DOD-M16-EPOCH-1
depends_on: [003-SEALTYPE, 007-PUBLOG]
description: >
  The daemon seals a channel's open epoch: on the publisher's explicit trigger, or FORCED at
  24 hours after the epoch's first leaf or at 1,000 leaves, whichever first; empty epochs
  never seal; a channel may declare a shorter cap. Sealing signs a channel-epoch-seal over the
  open root (003), records it locally, and closes the epoch in the log (007). Directory
  notarization is order 009 — this order produces the publisher-signed seal with the
  notarization slot still null.
---

# **<ins>MICRO</ins>** WORK ORDER 008-EPOCH — Epoch lifecycle and the cap

> ## THE RULES OF A MICRO WORK ORDER
>
> 1. **Read [[M16-PROCEDURE]] IN FULL before you start.** It binds you: the gate, the watchdog
>    cron (§4a — arm it now), the review dispatch, one session = one order. **Do not read
>    `M16-DEFINITION-OF-DONE.md`, `M16-BUILD-JOURNAL.md`, or any design log.**
> 2. **MICRO means small.** One mission. Never grow it.
> 3. **Found something else?** *Newly discovered* at the foot, five lines, keep going.
> 4. **500 lines, hard cap** on this file.
> 5. **Standard procedure applies in full:** tests first (all red) → implement (all green) →
>    review (`cello-unit-reviewer`) → fix every finding → commit per fix, push per commit.
>    Flip `status:` to `complete` in the SAME commit as the verdict.
> 6. **Done is done.**

---

## The problem, plainly

Until an epoch is sealed and notarized, a publisher could hand two subscribers two different
message #47s, both validly signed. **The unsealed window IS the window in which a channel can
lie, so how long an epoch may stay open is a security parameter, not housekeeping.** The
rule, decided and not yours to amend: an epoch is force-sealed **24 hours after its first
leaf, or at 1,000 leaves, whichever comes first**; the publisher may seal earlier at will; an
epoch with zero leaves never seals; a channel may declare a SHORTER cap, never a longer one.

**Repo: `/Users/andrep/Documents/code/cello-client`, all in `core/daemon`.** You consume
`ChannelLogStore` (007) and `signChannelEpochSeal` (003).

---

## The work

### New file: `core/daemon/src/channel-epoch-sealer.ts`

```ts
export const EPOCH_MAX_AGE_MS = 24 * 60 * 60 * 1000;   // protocol maximum
export const EPOCH_MAX_LEAVES = 1000;                    // protocol maximum

export interface ChannelEpochPolicy { maxAgeMs: number; maxLeaves: number }  // per channel

export interface SealOutcome {
  sealed: true; epoch_index: number; epoch_root: Uint8Array; leaf_count: number; seal_cbor: Uint8Array;
}
export type SealRefusal = { sealed: false; reason: "epoch_empty" | "channel_unknown" | "key_unavailable" };

export class ChannelEpochSealer {
  constructor(deps: {
    log: ChannelLogStore;
    sealStore: ChannelEpochSealStore;               // below
    getKeyProvider: (channelPubkeyHex: string) => KeyProvider | null;  // thread the same way seal-escalation.ts gets its key
    logger: Logger;
    now: () => number;                                // injectable clock — tests use it
  });
  /** Clamp a declared policy to the protocol maxima; anything larger is an error, not a clamp. */
  static validatePolicy(p: Partial<ChannelEpochPolicy>): ChannelEpochPolicy;   // throws RangeError above maxima
  /** Seal now if the open epoch has >= 1 leaf. */
  sealNow(channelPubkeyHex: string, correlationId: string): Promise<SealOutcome | SealRefusal>;
  /** Evaluate the cap: seals iff leaves >= maxLeaves OR (leaves >= 1 AND now - opened_at >= maxAgeMs). */
  sealIfDue(channelPubkeyHex: string, policy: ChannelEpochPolicy, correlationId: string): Promise<SealOutcome | SealRefusal | { sealed: false; reason: "not_due" }>;
}
```

**`sealNow` steps, exactly:** (1) `log.openEpochRoot(ch)`; if `leaf_count === 0` →
`epoch_empty` (refusal, not an error, logged at info as `channel.epoch.seal_skipped_empty`).
(2) key provider for the channel; null → `key_unavailable` (error-level
`channel.epoch.seal_failed`, field `reason`). (3) `signChannelEpochSeal(kp, { epoch_index,
epoch_root, first_seq, leaf_count, prev_epoch_root: <state row's prev_epoch_root>, sealed_at:
now() })`. (4) `sealStore.record(ch, seal)` and `log.closeEpoch(ch, epoch_root)` **in one
transaction** — a seal recorded without the epoch closing (or vice versa) is the corruption
this order must make impossible. (5) Emit `channel.epoch.sealed` (fields: `correlationId`,
`channel_pubkey`, `epoch_index`, `leaf_count`, `first_seq`, `trigger: "explicit" | "cap_age" |
"cap_leaves"`). Return the outcome with `encodeChannelEpochSeal(seal)`.

### New file: `core/daemon/src/channel-epoch-seal-store.ts`

Same pattern as 007's store. Table `channel_epoch_seals (channel_pubkey TEXT NOT NULL,
epoch_index INTEGER NOT NULL, epoch_root BLOB NOT NULL, seal_cbor BLOB NOT NULL, notarized
INTEGER NOT NULL DEFAULT 0, sealed_at INTEGER NOT NULL, PRIMARY KEY (channel_pubkey,
epoch_index))`. `INSERT OR IGNORE`; `record` throws `seal_position_taken` if nothing was
written. `get(ch, epoch_index)`, `latest(ch)`, and `markNotarized(ch, epoch_index,
notarizedSealCbor)` (the ONLY update the table permits: replaces `seal_cbor` with the version
whose `notarization` slot is filled and sets `notarized = 1`; order 009 calls it).

### The scheduler

In the daemon's existing periodic-work location (find where the daemon already runs timers
— e.g. the restart-seal resolver's scheduling in `restart-seal-resolver.ts` or the daemon's
heartbeat loop; copy that pattern), add a **60-second tick** that, for every channel identity
this daemon holds (`isChannelAgent` from 004 → its pubkey), calls `sealIfDue(ch, policy)`.
The policy comes from a per-channel setting stored beside the channel's state row (add
`max_age_ms INTEGER NOT NULL DEFAULT 86400000, max_leaves INTEGER NOT NULL DEFAULT 1000` to
`channel_epoch_state` via the same idempotent-DDL pattern; 007's DDL is extended, not
replaced). No IPC to set the policy yet (Tier 5) — the defaults are the protocol maxima.

### Observability

Events: `channel.epoch.sealed`, `channel.epoch.seal_skipped_empty`, `channel.epoch.seal_failed`,
and `channel.epoch.cap_tick` (debug; fields `channels_checked`, `sealed_count`). No
`console.log`.

---

## ⚠️ WHAT MUST NOT CHANGE

- **The cap is ENFORCED by the daemon, not advisory.** No config flag disables the 24h/1000
  ceiling; `validatePolicy` throws above the maxima rather than clamping silently — a
  publisher that asks for a 48h epoch has asked for a longer lie window, and the answer is an
  error they see.
- **Empty epochs never seal.** No "seal anyway so the timer is satisfied."
- **Seal record + epoch close are atomic.** Do not sequence them as two independent writes
  with a log line in between.
- **`sealed_at` comes from the injected clock**, never `Date.now()` inline — the age tests
  depend on it, and a hidden `Date.now()` is exactly how the age cap silently stops being
  tested.
- **No notarization here.** The seal leaves this order with `notarization: null`; 009 fills
  it. Do not stub a fake notarization "for now."

---

## Tests — write ALL of these first, confirm ALL red, then implement

New file `core/daemon/src/__tests__/channel-epoch-sealer.test.ts` — **add to
`core/daemon/tsconfig.test.json`.** Real encrypted test DB (helpers/encrypted-db.ts), real
keys, a controllable `now`. Reuse 007's publish helper shape.

1. `sealNow on an empty epoch refuses with epoch_empty` — no seal row, epoch not closed,
   `channel.epoch.seal_skipped_empty` logged.
2. `sealNow with 3 leaves produces a verifying seal and closes the epoch` — decoded seal
   passes `verifyChannelEpochSealSignature`; `epoch_root` equals `log.openEpochRoot` taken
   BEFORE sealing; `leaf_count` 3, `first_seq` 1; after sealing `log.nextPosition` reports
   epoch 1 with `prev_epoch_root` = that root; `notarization` is null.
3. `two consecutive seals chain` — publish 3, seal, publish 2, seal; `checkEpochChainLink(
   seal0, seal1)` is ok; seal1.first_seq is 4.
4. `age cap: 24h minus one minute is not due; 24h is due` — with `now` at opened_at +
   86_340_000 → `not_due`; at opened_at + 86_400_000 → sealed with trigger `cap_age`.
5. `leaf cap: 999 leaves not due, 1000 due` — trigger `cap_leaves`. (Publishing 1000
   artifacts in a test is fine — keep bodies tiny.)
6. `a shorter declared policy is honored; a longer one is refused` —
   `validatePolicy({maxAgeMs: 3_600_000})` returns it; `validatePolicy({maxAgeMs:
   172_800_000})` throws RangeError; `maxLeaves: 5000` throws.
7. `empty open epoch is never force-sealed by age` — `now` far past any cap with zero leaves
   → `sealIfDue` returns `not_due`/`epoch_empty` and no seal row exists.
8. `seal record and epoch close are atomic` — make `sealStore.record` throw (spy/stub the
   store method for this test only) and assert the epoch is NOT closed and `nextPosition` is
   unchanged.
9. `markNotarized is the only mutation` — record a seal, call `markNotarized` with a new
   cbor, `get` returns the new cbor with `notarized = 1`; a second `record` for the same
   epoch throws `seal_position_taken`.

---

## Definition of Done

1. Sealer, seal store, DDL extension, and scheduler tick exist as specified.
2. All nine tests exist, went red first (journal), now green; file in `tsconfig.test.json`.
3. **Revert test:** change `>= maxAgeMs` to `> maxAgeMs` and confirm test 4's boundary case
   goes red; restore. Remove the empty-epoch guard and confirm tests 1 and 7 go red; restore.
   Quote both.
4. Gate passes: `pnpm run test` → `pnpm run lint` → `pnpm run typecheck`.
5. **Enforcer (separate OS processes):** spawn the real daemon (`helpers/spawn-real-daemon.ts`)
   with a seeded channel identity and a pre-populated channel log whose open epoch's
   `opened_at` is 25 hours in the past; wait for the scheduler tick (expose the tick interval
   through an env override the same way other daemon timers are tuned in tests — if none
   exists, the 60s wait is acceptable); assert `channel.epoch.sealed` with `trigger:
   "cap_age"` appears in the daemon's output. Quote it.
6. Reviewed by `cello-unit-reviewer`, every finding fixed, verdict quoted below and in the
   journal.
7. `status:` flipped to `complete` in the same commit as the verdict.

**Not in scope:** directory notarization (009/010); subscriber-requested seals (011);
setting the policy from the CLI/MCP (Tier 5); delivery of seals to subscribers (Tier 3).

---

## Traps recorded before you start

- **`trigger` must reflect WHY the seal happened** — a test that only checks "sealed: true"
  cannot tell the age cap from the leaf cap; tests 4 and 5 assert the trigger string.
- **Boundary is `>=`** for both caps; test 4/5 pin the exact boundary.
- **Do not let the scheduler run inside unit tests** — construct the sealer directly and call
  `sealIfDue`; the scheduler is proven by the enforcer.
- **`core/daemon/tsconfig.test.json` explicit files list; `@claude-flow/testing`.**

---

## Newly discovered

*(add findings here — symptom, file, one-line consequence, five lines max each; keep going)*
