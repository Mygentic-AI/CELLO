---
name: 007-PUBLOG — The publisher-side channel log store
type: micro-work-order
date: 2026-09-02
status: open
source: DOD-M16-PUBLOG-1
depends_on: [001-TREE, 002-ARTIFACT, 004-IDENTITY-WIRE]
description: >
  The daemon's append-only channel log: one SQLCipher store per daemon holding every artifact a
  local channel identity has published, keyed on channel pubkey + seq, immutable rows, and a
  root recomputed over the current epoch's leaves on every append. This log is the durable
  copy the whole repair design stands on. Copies the session-seal-leaf-store pattern.
---

# **<ins>MICRO</ins>** WORK ORDER 007-PUBLOG — The publisher-side channel log

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

A channel publishes a signed artifact once and it is delivered many times. The publisher
keeps ONE append-only log of everything it published — not one per subscriber — and that log
is the durable copy: when a relay loses content, subscribers repair from this log. Nothing
stores it today. This order builds the store and the append operation; it does NOT seal
epochs (008), talk to the directory (009/010), or deliver anything (Tier 3).

**Repo: `/Users/andrep/Documents/code/cello-client`, all in `core/daemon`.** The pattern to
copy is `core/daemon/src/session-seal-leaf-store.ts`: a `CREATE TABLE IF NOT EXISTS` constant,
a class taking `(db: DaemonDatabase, logger: Logger)` that runs the DDL in its constructor,
and `INSERT OR IGNORE` so a position can never be overwritten. Read it first.

---

## The work

### New file: `core/daemon/src/channel-log-store.ts`

```ts
import type { DaemonDatabase } from "./sqlcipher-db.js";
import type { Logger } from "@cello-protocol/interfaces"; // match seal-leaf-store's import exactly
import { buildMerkleTree, merkleRoot } from "@cello-protocol/crypto";
import { encodeBroadcastArtifact, decodeBroadcastArtifact, broadcastArtifactLeafHash }
  from "@cello-protocol/protocol-types";
import type { BroadcastArtifact } from "@cello-protocol/protocol-types";

export const CHANNEL_LOG_CREATE_SQL = `
  CREATE TABLE IF NOT EXISTS channel_log (
    channel_pubkey   TEXT    NOT NULL,   -- hex, the channel identity (stable key)
    seq              INTEGER NOT NULL,   -- 1-based, monotonic per channel
    epoch_index      INTEGER NOT NULL,
    leaf_hash        BLOB    NOT NULL,   -- broadcastArtifactLeafHash(artifact), 32 bytes
    artifact_cbor    BLOB    NOT NULL,   -- encodeBroadcastArtifact(artifact)
    title            TEXT    NOT NULL,   -- denormalized for digests; never the source of truth
    published_at     INTEGER NOT NULL,   -- unix ms
    PRIMARY KEY (channel_pubkey, seq)
  );
  CREATE TABLE IF NOT EXISTS channel_epoch_state (
    channel_pubkey        TEXT    NOT NULL PRIMARY KEY,
    open_epoch_index      INTEGER NOT NULL,   -- the epoch currently accepting leaves
    open_epoch_first_seq  INTEGER NOT NULL,   -- seq of first leaf in the open epoch (0 = none yet)
    open_epoch_opened_at  INTEGER NOT NULL,   -- unix ms of first leaf in open epoch (0 = none yet)
    prev_epoch_root       BLOB,               -- sealed root of open_epoch_index - 1; NULL for epoch 0
    next_seq              INTEGER NOT NULL    -- the seq the next append will take
  );
`;

export interface AppendResult {
  seq: number; epoch_index: number; leaf_index: number; epoch_root: Uint8Array; leaf_count: number;
}

export class ChannelLogStore {
  constructor(db: DaemonDatabase, logger: Logger);
  /** Idempotent: creates channel_epoch_state row {epoch 0, first_seq 0, opened_at 0, prev NULL, next_seq 1}. */
  ensureChannel(channelPubkeyHex: string): void;
  /** What the NEXT append will be assigned — the publisher signs with these before appending. */
  nextPosition(channelPubkeyHex: string): { seq: number; epoch_index: number; prev_epoch_root: Uint8Array | null; first_in_epoch: boolean };
  /** Append an already-signed artifact. Throws ChannelLogError (codes below) — never silently skips. */
  append(channelPubkeyHex: string, artifact: BroadcastArtifact, publishedAtMs: number): AppendResult;
  /** Leaf hashes of the open epoch in seq order; [] when the epoch has no leaves. */
  openEpochLeafHashes(channelPubkeyHex: string): Uint8Array[];
  /** Merkle root over openEpochLeafHashes (merkleRoot(buildMerkleTree(hash-leaves))). */
  openEpochRoot(channelPubkeyHex: string): { root: Uint8Array; leaf_count: number; first_seq: number; opened_at: number };
  /** Range read for repair (Tier 4) and for verification tests. Inclusive, seq order. */
  readRange(channelPubkeyHex: string, fromSeq: number, toSeq: number): BroadcastArtifact[];
  /** Called by 008 after a seal: advances to epoch+1 with prev_epoch_root = sealedRoot. */
  closeEpoch(channelPubkeyHex: string, sealedRoot: Uint8Array): void;
}

export class ChannelLogError extends Error {
  code: "channel_unknown" | "seq_not_next" | "epoch_mismatch" | "prev_root_mismatch"
      | "position_taken" | "artifact_invalid";
}
```

**`append` semantics, exactly:** (1) `channel_epoch_state` row must exist (`channel_unknown`).
(2) `artifact.seq === next_seq` (`seq_not_next`). (3) `artifact.epoch_index ===
open_epoch_index` (`epoch_mismatch`). (4) If this is the first leaf of the open epoch
(`open_epoch_first_seq === 0`): `artifact.prev_epoch_root` must byte-equal the state row's
`prev_epoch_root` (both null for epoch 0); otherwise `artifact.prev_epoch_root` must be null
(`prev_root_mismatch`). (5) Re-decode `encodeBroadcastArtifact(artifact)` through
`decodeBroadcastArtifact` and require `ok` (`artifact_invalid` — the store never trusts an
in-memory object). (6) `INSERT OR IGNORE` the row; if no row was written → `position_taken`
(never overwrite). (7) In the SAME transaction (`BEGIN`/`COMMIT` through the db handle, as
other stores do): bump `next_seq`, and if first-in-epoch set `open_epoch_first_seq`/
`open_epoch_opened_at`. (8) Return the recomputed open-epoch root and counts. Emit
`channel.artifact.appended` (fields: `correlationId` if the caller passes one via an optional
last param, `channel_pubkey`, `seq`, `epoch_index`, `leaf_count`) via the logger.

`closeEpoch`: sets `open_epoch_index += 1`, `open_epoch_first_seq = 0`,
`open_epoch_opened_at = 0`, `prev_epoch_root = sealedRoot`. It does NOT check that the
sealed root matches the open root — 008 owns that and passes the root it sealed.

### Wire it up

Construct the store where `SessionSealLeafStore` is constructed (grep its single
construction site in `session-node-manager.ts` / `daemon.ts`) and expose it on the same owner
the way that store is exposed. No IPC handlers in this order.

### Observability

One event, `channel.artifact.appended`, fields above. No `console.log`.

---

## ⚠️ WHAT MUST NOT CHANGE

- **Rows are immutable.** `INSERT OR IGNORE`, never `INSERT OR REPLACE`, never `UPDATE
  channel_log`. A "fix-up" path that rewrites a published artifact would make the whole
  consistency-proof claim (001) a lie.
- **Every check in `append` throws its named code.** No "log a warning and append anyway,"
  no auto-correcting a wrong seq to the next one. A caller who signed the wrong position
  must re-sign; that is by design.
- **The store never signs and never decides positions on its own** — `nextPosition` reports,
  the publisher signs, `append` verifies. Do not fold signing into the store.
- **Keyed on `channel_pubkey`, never on an agent NAME.** (The channel is the daemon's own
  identity; its pubkey is the stable key.)
- **No new dependencies; no `node:sqlite`; DDL only through the existing `DaemonDatabase`.**
- **Do not touch `session-seal-leaf-store.ts`** — you copy its shape, you do not refactor it.

---

## Tests — write ALL of these first, confirm ALL red, then implement

New file `core/daemon/src/__tests__/channel-log-store.test.ts` — **add it to
`core/daemon/tsconfig.test.json`'s `files` list.** Open a real encrypted test DB the way
`core/daemon/src/__tests__/helpers/encrypted-db.ts` provides (read it; reuse it). Sign
artifacts with `signBroadcastArtifact` + `generateKeypair()` — real crypto, no mocks. A helper
`publish(store, kp, overrides)` that calls `nextPosition`, signs, appends, keeps tests short.
Run only this file.

1. `ensureChannel is idempotent` — call twice; one state row; next_seq is 1.
2. `first append lands at seq 1 epoch 0 with a real root` — result.seq 1, epoch 0,
   leaf_count 1, and `epoch_root` equals `merkleRoot(buildMerkleTree([{kind:"hash", data:
   broadcastArtifactLeafHash(a)}]))` recomputed inline.
3. `three appends: root equals independent recomputation over all three leaf hashes` —
   recompute with the crypto primitives directly; byte-equal.
4. `seq_not_next` — sign seq 5 when next is 2 → throws with that code; store unchanged
   (next_seq still 2, readRange empty beyond 1).
5. `epoch_mismatch` — artifact epoch_index 1 while open epoch is 0 → named code.
6. `prev_root_mismatch, both directions` — first leaf of epoch 0 carrying a non-null
   prev_epoch_root → code; after `closeEpoch(root0)`, first leaf of epoch 1 with null
   prev_epoch_root → code; with the WRONG root → code; with `root0` → succeeds.
7. `position_taken` — append the same signed artifact twice → second throws
   `position_taken` (seq must be re-signed anyway, but the guard is the INSERT OR IGNORE);
   row count unchanged.
8. `artifact_invalid` — an object whose title has a control char (built by hand, not via
   sign) → `artifact_invalid`; nothing written.
9. `closeEpoch advances state` — after 3 appends and `closeEpoch(root)`, nextPosition reports
   epoch 1, first_in_epoch true, prev_epoch_root = root; openEpochLeafHashes is `[]`;
   readRange(1,3) still returns the three epoch-0 artifacts (history is kept).
10. `readRange returns decoded artifacts in seq order and verifies` — every returned artifact
    passes `verifyBroadcastArtifact`.
11. `two channels do not interfere` — appends to channel A do not move channel B's next_seq.

---

## Definition of Done

1. Store, error class, DDL, and wiring exist exactly as specified.
2. All eleven tests exist, went red first (journal), now green; test file listed in
   `tsconfig.test.json`.
3. **Revert test:** change `INSERT OR IGNORE` to `INSERT OR REPLACE` and confirm test 7 goes
   red; restore. Remove check (4) and confirm test 6 goes red; restore. Quote both.
4. Gate passes: `pnpm run test` → `pnpm run lint` → `pnpm run typecheck`.
5. **Enforcer (separate OS processes):** process A (a node script importing from
   `core/daemon/dist` and `core/crypto/dist`) opens a temp encrypted DB, appends 4 artifacts,
   prints the root hex, and exits; process B reopens the SAME DB file, reads range 1..4,
   verifies every artifact, recomputes the root from the leaf hashes, and prints `ROOT match`
   or `ROOT MISMATCH`. Durability across processes is the property. Quote the run.
6. Reviewed by `cello-unit-reviewer`, every finding fixed, verdict quoted below and in the
   journal.
7. `status:` flipped to `complete` in the same commit as the verdict.

**Not in scope:** sealing/cap enforcement (008); directory notarization (009/010); any relay
or delivery; IPC/MCP tools; subscriber-side storage (Tier 3); npm publishing.

---

## Traps recorded before you start

- **The state row and the log row must change in ONE transaction** — a crash between them
  leaves `next_seq` wrong forever. Use the db handle's transaction the way other stores do;
  do not "add a repair on startup" instead.
- **`nextPosition` before signing, `append` after** — the artifact's seq is INSIDE the
  signature, so the store cannot assign it. Tests 4/5 exist because the obvious shortcut
  (store assigns seq) is wrong.
- **`openEpochRoot` over zero leaves**: `merkleRoot` of an empty tree is `sha256("")` by the
  crypto package's convention — that is fine to return, but `leaf_count` 0 must be visible so
  008 never seals it.
- **`core/daemon/tsconfig.test.json` explicit files list.**
- **`@claude-flow/testing`, not `vitest`; `setupV3Tests()`.**

---

## Newly discovered

*(add findings here — symptom, file, one-line consequence, five lines max each; keep going)*
