---
name: 010-NOTARIZE-DIRECTORY — Notarize epoch seals and publish the high-water mark
type: micro-work-order
date: 2026-09-02
status: open
source: DOD-M16-NOTARIZE-1
depends_on: [005-IDENTITY-DIRECTORY deployed; 009's protocol-types shipped to the registry and promoted — planner/Andre gate]
description: >
  The directory half of notarization: accept channel_epoch_seal_submit from a registered
  CHANNEL identity, validate the seal (publisher signature, epoch continuity against the
  stored chain), run the same FROST threshold signing the unilateral session seal uses over
  the epoch-seal TBS, persist the notarized root (V65 channel_epochs), reply with the group
  signature, and expose the channel's high-water mark to anyone who asks. Once per epoch;
  no per-message work; notarization succeeds with one node down.
---

# **<ins>MICRO</ins>** WORK ORDER 010-NOTARIZE-DIRECTORY — Notarize and publish the high-water mark

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

The directory is the trust anchor for one thing in the broadcast design: **notarizing an
epoch root with a threshold signature, once per epoch, so a channel cannot back-date or fork
its history**, and **publishing the channel's high-water mark** so a subscriber can tell
"silence" from "I am missing the tail." This order builds both on the directory. Nothing
else in the broadcast flow touches the directory — no per-message work, ever.

**Repo: `/Users/andrep/Documents/code/trustless-cello`.** STEP 0: `pnpm install` and
`grep -n "channel_epoch_seal_submit" node_modules/@cello-protocol/protocol-types/dist/index.d.ts`
— if absent, the 009 types are not shipped: STOP and hand back (§5). No local redeclaration.

**Copy-anchor, read first:** `packages/directory/src/directory-node.ts` — the dispatch at
~line 2666 (`parsed.type === "seal_unilateral"` → `#processSealUnilateral`) and
`#processSealUnilateral` itself (~line 4569, note its stranger-check comment at ~4616 — the
same authenticated-stranger attack applies here and the same defence is required); the
FROST signing entry `this.#frostHandler.signRawMessage({...})` (~line 1650) and
`FrostDirectoryHandler.signRawMessage` in `packages/directory/src/frost-handler.ts:561`.

---

## The work

### 1. Migration — `packages/directory/db/migrations/V65__channel_epochs.sql`

```sql
-- M16 order 010: notarized channel epoch roots. Append-only: one row per (channel, epoch).
CREATE TABLE channel_epochs (
  channel_pubkey   TEXT    NOT NULL,     -- k_local_pubkey hex of the channel identity
  epoch_index      BIGINT  NOT NULL,
  epoch_root       TEXT    NOT NULL,     -- hex, 32 bytes
  first_seq        BIGINT  NOT NULL,
  leaf_count       BIGINT  NOT NULL,
  prev_epoch_root  TEXT,                 -- hex or NULL for epoch 0
  sealed_at        BIGINT  NOT NULL,     -- publisher's sealed_at (ms)
  notarized_at     BIGINT  NOT NULL,     -- directory time (ms)
  notarization     TEXT    NOT NULL,     -- hex FROST group signature over the seal TBS
  origin_node      TEXT    NOT NULL,
  PRIMARY KEY (channel_pubkey, epoch_index)
);
GRANT INSERT, SELECT ON channel_epochs TO cello_service;
```
Bump `migration-numbering.test.ts` (nextFree 65 → 66, with comment) and
`infra/terraform/ops-agent.tf` `ops_agent_expected_migration_version` `"64"` → `"65"` (file
edit only; apply is the planner's — journal it). Add the table to the anti-entropy specs the
way 005 did for its columns (`ae-table-encoders.ts` + `pg-ae-store.ts`), all columns immutable
(Tier A); run the AE guard tests until green.

### 2. Store — `packages/interfaces/src/directory-store.ts` + pg adapter + in-memory stub

```ts
recordChannelEpoch(row: ChannelEpochRow): Promise<"recorded" | "already_recorded">;   // INSERT ... ON CONFLICT DO NOTHING
getChannelEpoch(channelPubkeyHex: string, epochIndex: number): Promise<ChannelEpochRow | null>;
getChannelHighWaterMark(channelPubkeyHex: string): Promise<{ epoch_index: number; epoch_root: string; last_seq: number } | null>;  // last_seq = first_seq + leaf_count - 1 of the highest epoch
```
Declare in the interface, implement in `pg-directory-store.ts` and the in-memory stub — the
three-place pattern 005 followed for `isChannelIdentity`.

### 3. Handler — `directory-node.ts`

Dispatch `channel_epoch_seal_submit` beside the `seal_unilateral` case to a new
`#processChannelEpochSealSubmit(stream, authedPubkeyHex, frame)`. Steps, each a named
rejection (`channel_epoch_seal_rejected` with the 009 reason set):

1. `isChannelIdentity(authedPubkeyHex)` must be true → else `not_a_channel`. **The
   authenticated stream identity must equal the seal's `channel_pubkey`** — a stranger cannot
   submit for a channel it does not hold (the `#processSealUnilateral` stranger defence).
2. `decodeChannelEpochSeal(frame.seal)` ok → else `seal_invalid`; `notarization` must be null.
3. `verifyChannelEpochSealSignature(seal)` → else `publisher_signature_invalid`.
4. Continuity against the store: `getChannelHighWaterMark`; if none, require
   `epoch_index === 0` and `first_seq === 1`; else require `epoch_index === hwm.epoch_index
   + 1` and `first_seq === hwm.last_seq + 1` (`epoch_not_next`) and `prev_epoch_root` equal
   to the stored `epoch_root` (`prev_root_mismatch`). If the SAME (channel, epoch, root) is
   already recorded → reply `_notarized` with the stored notarization (idempotent resubmit).
5. Rate limit: at most one accepted submit per channel per 60s (in-memory map keyed by
   channel pubkey, same style as the directory's other per-identity limiters) →
   `rate_limited` with `detail` carrying retry seconds.
6. FROST: run the threshold signing over `buildChannelEpochSealTbs(seal)` exactly as
   `#processSealUnilateral` runs it for the session TBS (same `signRawMessage` call shape,
   same ceremony-id/peer plumbing, same quorum semantics: T = majority — one node down still
   succeeds). Failure → `ceremony_failed`.
7. `recordChannelEpoch(...)`; then reply `channel_epoch_seal_notarized` with the group
   signature. Emit `channel.epoch.notarized` (fields `correlationId`, `channel_pubkey`,
   `epoch_index`, `leaf_count`, `nodeId`); rejections emit `channel.epoch.submit_rejected`
   with `reason`.

Frame codecs go in `packages/directory/src/directory-frames.ts` beside the seal encoders
(`encodeChannelEpochSealNotarized`, `encodeChannelEpochSealRejected`), and
`decodeInboundSignalingFrame` learns the submit frame.

### 4. High-water mark lookup

New inbound frame `channel_hwm_lookup { channel_pubkey }` (declare it in protocol-types? —
NO: this order cannot change the client repo. Declare the shape locally in
`directory-frames.ts` for now and record in *Newly discovered* that Tier 4's client order
must add the protocol-types declaration; the directory decodes it structurally) → reply
`channel_hwm_result { channel_pubkey, epoch_index, epoch_root, last_seq }` or
`channel_hwm_error { reason: "unknown_channel" | "no_epochs" }`. Any authenticated stream may
ask — the mark is public by design. Rate-limit like `discovery_lookup`.

### Observability

`channel.epoch.notarized`, `channel.epoch.submit_rejected`, `channel.hwm.lookup` (debug).

---

## ⚠️ WHAT MUST NOT CHANGE

- **The stream identity must equal the seal's channel pubkey.** Without this, any registered
  identity can submit seals for any channel — the exact hole `#processSealUnilateral`'s
  comment documents and closes.
- **Continuity is enforced against the STORE, not against what the submitter claims.** A
  publisher cannot skip an epoch or rewrite `prev_epoch_root`; steps 4's checks are the
  directory's half of "the channel cannot rewrite history."
- **Threshold semantics are the standing ones (T = majority). Do not require all nodes.**
- **`channel_epochs` is append-only.** No UPDATE, no DELETE.
- **Fail closed on store errors** — a lookup error rejects (`seal_invalid` with detail), it
  never proceeds to sign.

---

## Tests — write ALL of these first, confirm ALL red, then implement

Unit: `packages/directory/src/__tests__/m16-channel-epoch-continuity.test.ts` — extract the
continuity rule (step 4) into a pure function `checkEpochContinuity(hwm, seal)` in a new
`packages/directory/src/channel-epoch-continuity.ts` and test it exhaustively:
1. first-ever seal must be epoch 0 / first_seq 1 (two violations, each named);
2. next epoch accepted; 3. skipped epoch → `epoch_not_next`; 4. wrong prev root →
`prev_root_mismatch`; 5. seq gap → `epoch_not_next`; 6. identical resubmit → `duplicate`.
7. Store round-trip on the in-memory stub: record → get → hwm arithmetic (`last_seq`).

Live (spine harness, `packages/e2e-tests/src/spine/m16-epoch-notarize.spine.test.ts` — 009
wrote the skeleton; complete it here):
8. register a channel, publish 3, seal → daemon logs `channel.epoch.notarized`;
   `psqlSpine` shows one `channel_epochs` row with `leaf_count 3`.
9. **one directory node stopped** (`restartDirectory`/stop on the cluster) → a second epoch
   still notarizes (T = majority).
10. a plain (non-channel) agent submits a well-formed seal → `not_a_channel` in the
    directory log.
11. `channel_hwm_lookup` from a third agent returns epoch 1 / last_seq 6 after two epochs.

---

## Definition of Done

1. Migration, numbering bump, terraform edit, AE specs, store methods (three places),
   handler, codecs, and hwm lookup exist as specified.
2. Tests 1–7 red-then-green (journal); guard tests green.
3. **Revert test:** drop the stream-identity check and confirm test 10 goes red; restore.
   Drop the prev-root check and confirm test 4 goes red; restore. Quote both.
4. Gate passes in `trustless-cello`: `pnpm run test` → `pnpm run lint` → `pnpm run typecheck`.
5. **Enforcer:** tests 8–11 (separate OS processes via the spine harness). Quote the psql
   row, the majority-only notarization, and the rejection.
6. Reviewed by `cello-unit-reviewer`, every finding fixed, verdict quoted below and in the
   journal.
7. `status:` flipped to `complete` in the same commit as the verdict.
8. Journal note: **deploy not performed** — node roll, `terraform apply`, GCP-STATE.md are
   the planner's.

**Not in scope:** the client submit flow (009); subscriber gap detection using the hwm
(Tier 4); relay anything; the announcements channel.

---

## Traps recorded before you start

- **Two supply chains again:** the spine harness runs the client from `../cello-client`
  SOURCE; the directory builds against the PUBLISHED types. Step 0 checks node_modules.
- **Do not add a second FROST path.** `signRawMessage` with a different `framedMsg` is the
  whole change; if its parameters do not fit, §5 stop.
- **The AE guard tests replay all migrations** — Docker postgres must be running (start it).
- **`last_seq` arithmetic is `first_seq + leaf_count - 1`** — off-by-one here breaks every
  future tail-gap detection; test 7 pins it.

---

## Newly discovered

- *(planner, pre-filled)* `channel_hwm_lookup` / `channel_hwm_result` frame shapes are
  declared directory-locally in this order; the Tier 4 client order must add them to
  `core/protocol-types` and the planner must reconcile the two declarations then.
