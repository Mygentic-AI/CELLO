---
name: 003-SEALTYPE — The channel-epoch-seal receipt type
type: micro-work-order
date: 2026-09-02
status: open
source: DOD-M16-SEAL-TYPE-1
depends_on: [002-ARTIFACT]
description: >
  Define the unilateral channel-epoch-seal receipt in core/protocol-types: the publisher's
  signed commitment to one epoch's tree root, the slot the directory's notarization fills, the
  reserved co-signature extension, the honesty statement of what it proves and does not, and
  the chain-link check between consecutive epochs. The two-party session seal is not touched.
---

# **<ins>MICRO</ins>** WORK ORDER 003-SEALTYPE — The channel-epoch-seal receipt

> ## THE RULES OF A MICRO WORK ORDER
>
> 1. **Read [[M16-PROCEDURE]] IN FULL before you start.** It binds you: the gate, the watchdog
>    cron (§4a — arm it now), the review dispatch, one session = one order. **Do not read
>    `M16-DEFINITION-OF-DONE.md`, `M16-BUILD-JOURNAL.md`, or any design log** — this order
>    carries everything you need from them.
> 2. **MICRO means small.** One mission. Never grow it.
> 3. **Found something else?** Write it under *Newly discovered* at the foot of this file and
>    keep going. Do not fix it. Do not investigate it.
> 4. **500 lines, hard cap** on this file.
> 5. **Standard procedure applies in full:** tests first (all red) → implement (all green) →
>    review (`cello-unit-reviewer`) → fix every finding → commit per fix, push per commit.
>    Flip this file's `status:` to `complete` in the SAME commit as the reviewer's verdict.
> 6. **Done is done.**

---

## The problem, plainly

A CELLO session seal is a TWO-party artifact: both participants approve it. A broadcast
channel has no counterparty — its epoch seal is a ONE-party record: the publisher commits to
the epoch's tree root, and the directory threshold-notarizes that the commitment existed at a
time. That is genuinely weaker than a session seal, and the receipt must SAY so rather than
borrow the stronger receipt's clothes. This order defines that receipt as a **new type**, in
the pattern the repo already uses for honest labeling: `core/protocol-types/src/session.ts`
has `SealLegibility` with `attests: "receipt"`, `implies_assent: false`, and an exported
disclaimer string — copy that idea, not that code.

**The one thing this order must not do is touch the session seal.** The temptation will be to
"generalize" shared seal code. Do not. The session seal's meaning everywhere else depends on
it staying exactly what it is.

**Repo: `/Users/andrep/Documents/code/cello-client`. Everything happens in
`core/protocol-types` (one new source file, one new test file, barrel exports).** Read
`core/protocol-types/src/broadcast-artifact.ts` (order 002, merged before you started) — this
file follows the same conventions: CBOR ARRAY with domain in slot 0, decode-with-reasons that
never throws, `verify` imported from `@cello-protocol/crypto`.

---

## The work

### New file: `core/protocol-types/src/channel-epoch-seal.ts`

```ts
import { verify } from "@cello-protocol/crypto";
import type { KeyProvider } from "@cello-protocol/crypto";
import { encodeCbor, decodeCbor } from "./cbor.js";

export const CHANNEL_EPOCH_SEAL_DOMAIN = "cello-channel-epoch-seal-v1";

/** What this receipt proves, and what it does not. Rendered wherever the receipt is shown. */
export const CHANNEL_EPOCH_SEAL_ATTESTS = {
  attests: "publisher-commitment",
  counterparty_approved: false,
  disclaimer:
    "One-party record. The publisher committed to this exact epoch tree, and the directory " +
    "consortium notarized that the commitment existed at this time. No counterparty approved " +
    "the contents; notarization attests existence and timing, not truth.",
} as const;

export interface ChannelEpochSeal {
  /** Channel identity: 32-byte Ed25519 public key. */
  channel_pubkey: Uint8Array;
  /** Which epoch this seals, starting at 0. */
  epoch_index: number;
  /** Merkle root over the epoch's artifact leaf hashes (32 bytes). */
  epoch_root: Uint8Array;
  /** Sequence number of the FIRST artifact in this epoch (>= 1). */
  first_seq: number;
  /** Number of artifacts in this epoch (>= 1 — empty epochs never seal). */
  leaf_count: number;
  /** Previous epoch's epoch_root (32 bytes); null ONLY when epoch_index === 0. */
  prev_epoch_root: Uint8Array | null;
  /** Unix ms timestamp the publisher sealed at. */
  sealed_at: number;
  /** Publisher's Ed25519 signature over buildChannelEpochSealTbs(...). */
  publisher_signature: Uint8Array;
  /** Directory threshold notarization over the same TBS; null until the directory signs
   *  (Tier 1 fills this). Opaque bytes at this layer. */
  notarization: Uint8Array | null;
  /** Reserved extension slot (future conclave co-signature). MUST be null in v1. */
  cosig_ext: null;
}

export type EpochSealDecodeReason =
  | "not_cbor" | "wrong_shape" | "wrong_domain" | "bad_channel_pubkey" | "bad_epoch_index"
  | "bad_epoch_root" | "bad_first_seq" | "bad_leaf_count" | "bad_prev_epoch_root"
  | "bad_sealed_at" | "bad_publisher_signature" | "bad_notarization" | "cosig_ext_not_null";

export type EpochChainReason =
  | "channel_mismatch" | "epoch_index_not_next" | "prev_root_mismatch" | "seq_not_contiguous";

export function buildChannelEpochSealTbs(
  s: Omit<ChannelEpochSeal, "publisher_signature" | "notarization" | "cosig_ext">,
): Uint8Array;
export function signChannelEpochSeal(
  keyProvider: KeyProvider,
  fields: Omit<ChannelEpochSeal, "publisher_signature" | "notarization" | "cosig_ext" | "channel_pubkey">,
): Promise<ChannelEpochSeal>;   // pubkey from provider; notarization null; throws RangeError on bad fields
export function encodeChannelEpochSeal(s: ChannelEpochSeal): Uint8Array;
export function decodeChannelEpochSeal(bytes: Uint8Array):
  { ok: true; seal: ChannelEpochSeal } | { ok: false; reason: EpochSealDecodeReason; detail: string };
export function verifyChannelEpochSealSignature(s: ChannelEpochSeal): boolean;  // never throws
export function checkEpochChainLink(prev: ChannelEpochSeal, next: ChannelEpochSeal):
  { ok: true } | { ok: false; reason: EpochChainReason; detail: string };       // never throws
```

Semantics, exactly:

- **TBS** = `encodeCbor([CHANNEL_EPOCH_SEAL_DOMAIN, channel_pubkey, epoch_index, epoch_root,
  first_seq, leaf_count, prev_epoch_root, sealed_at])` — one array, that order, domain slot 0.
  The notarization and cosig_ext are NOT in the TBS: the publisher's signature and the
  directory's notarization both sign the same 8-slot TBS, so the directory countersigns the
  publisher's exact commitment.
- **Encoded seal** = a CBOR array of 11: the 8 TBS slots + `publisher_signature` +
  `notarization` + `cosig_ext`.
- **`decodeChannelEpochSeal` validates everything, never throws** (wrap `decodeCbor`), in
  order: `not_cbor`; array of exactly 11 (`wrong_shape`); domain match (`wrong_domain`);
  pubkey 32 bytes; epoch_index safe integer ≥ 0; epoch_root 32 bytes; first_seq safe integer
  ≥ 1; leaf_count safe integer ≥ 1; prev_epoch_root null-iff-`epoch_index === 0`, else 32
  bytes (`bad_prev_epoch_root` covers both violations); sealed_at safe integer ≥ 0;
  publisher_signature 64 bytes; notarization null or a Uint8Array of 1..4096 bytes
  (`bad_notarization` — opaque, only bounded); cosig_ext exactly null.
- **`verifyChannelEpochSealSignature`** = `verify(channel_pubkey, tbs, publisher_signature)`.
  It deliberately does NOT check the notarization — that verification needs the consortium
  key and lands in Tier 1. Name the function with "Signature" so no caller mistakes it for
  full verification.
- **`checkEpochChainLink(prev, next)`** — pure structure comparison, no crypto: pubkeys
  byte-equal (`channel_mismatch`); `next.epoch_index === prev.epoch_index + 1`
  (`epoch_index_not_next`); `next.prev_epoch_root` byte-equals `prev.epoch_root`
  (`prev_root_mismatch`); `next.first_seq === prev.first_seq + prev.leaf_count`
  (`seq_not_contiguous`). Check in that order, return the first failure.
- **`signChannelEpochSeal`** validates fields (same rules as decode; `RangeError` with the
  reason on first violation), signs the TBS, returns the seal with `notarization: null` and
  `cosig_ext: null`.

### Wire it up

- `core/protocol-types/src/index.ts`: explicit named exports — the domain constant,
  `CHANNEL_EPOCH_SEAL_ATTESTS`, the interface and both reason types (as `export type`), and
  all six functions.
- Tests: `core/protocol-types/src/__tests__/channel-epoch-seal.test.ts` (no tsconfig.test.json
  exists in this package — do not create one).

### Observability

None. Pure format code — no logger, no events.

---

## ⚠️ WHAT MUST NOT CHANGE

- **`core/protocol-types/src/session.ts` is untouched. Zero lines.** No imports from it, no
  exports moved into it, no "shared seal helpers" extracted from it. The unit's review will
  check `git diff --stat` for session.ts; any change there is a blocking finding. The same
  goes for `seal-interrupted.ts`.
- **The TBS covers exactly the 8 slots listed.** Putting the notarization inside the TBS
  would make the publisher's signature depend on the directory's — circular, wrong.
- **`leaf_count >= 1` is load-bearing:** empty epochs never seal. Do not relax it to 0 to
  make a test fixture easier.
- **CBOR arrays only, domain slot 0; never a map; never a second encoder.**
- **No backward-compatibility branches** — strict v1 decode, nothing else.
- **Decode and both check functions never throw.**

---

## Tests — write ALL of these first, confirm ALL red, then implement

Same harness as order 002: `describe/it/expect` from `@claude-flow/testing`, `setupV3Tests()`,
`generateKeypair()` from `@cello-protocol/crypto`, a `makeSealFields(overrides)` helper (a
valid epoch-1 seal: epoch_index 1, epoch_root 32 pseudo-random bytes, first_seq 6, leaf_count
4, prev_epoch_root 32 bytes, sealed_at a fixed ms timestamp). Run only this file:
`pnpm vitest run src/__tests__/channel-epoch-seal.test.ts` from `core/protocol-types/`.

1. `sign → encode → decode → verify round-trips` — all fields survive; signature verifies;
   decoded `notarization` is null and `cosig_ext` is null.
2. `every TBS field is signed` — for each of the 7 non-pubkey TBS fields in turn (epoch_index,
   epoch_root byte-flip, first_seq, leaf_count, prev_epoch_root byte-flip, sealed_at, and
   channel_pubkey byte-flip), mutate one field of a valid seal and assert
   `verifyChannelEpochSealSignature` is false.
3. `notarization is OUTSIDE the publisher's signature` — take a verified seal, set
   `notarization` to 96 arbitrary bytes; `verifyChannelEpochSealSignature` is STILL true.
   (This pins the TBS boundary; it would fail if a coder put slot 9 into the TBS.)
4. `decode rejects each malformation with its named reason` — one case per
   `EpochSealDecodeReason`, exact reason string asserted: random bytes; a 10-element array;
   wrong domain string; 31-byte pubkey; epoch_index -1; 16-byte epoch_root; first_seq 0;
   leaf_count 0; epoch_index 0 WITH a prev_epoch_root; epoch_index 1 WITHOUT one; sealed_at
   -5; 63-byte publisher_signature; notarization of 5000 bytes; notarization of 0 bytes;
   cosig_ext = "later".
5. `epoch 0 shape` — a genesis seal (epoch_index 0, prev_epoch_root null, first_seq 1)
   round-trips and verifies.
6. `chain link accepts the true successor` — build seal A (epoch 0, first_seq 1, leaf_count
   5) and seal B (epoch 1, first_seq 6, prev_epoch_root = A.epoch_root);
   `checkEpochChainLink(A, B)` is `ok: true`.
7. `chain link rejects each break with its named reason` — from the A/B pair, four variants:
   B signed for a different channel → `channel_mismatch`; B with epoch_index 2 →
   `epoch_index_not_next`; B whose prev_epoch_root is A's root with one byte flipped →
   `prev_root_mismatch`; B with first_seq 7 → `seq_not_contiguous`. Exact reasons asserted.
8. `a gap hidden between epochs is caught` — A has leaf_count 5 (seqs 1..5); B claims
   first_seq 8 (silently dropping 6 and 7) with a correct prev_root and index;
   `checkEpochChainLink` returns `seq_not_contiguous`. **This is the property the receipt
   chain exists for — an artifact the publisher dropped between epochs is structurally
   visible.**
9. `signChannelEpochSeal enforces field rules` — leaf_count 0 throws `RangeError`;
   epoch_index 1 with prev_epoch_root null throws `RangeError`.
10. `the honesty statement is exported and immutable in shape` —
    `CHANNEL_EPOCH_SEAL_ATTESTS.counterparty_approved === false` and the disclaimer string
    contains "No counterparty". (Guards against the constant being edited into a stronger
    claim later without a test noticing.)

---

## Definition of Done

1. The module exists with exactly the listed exports; the index barrel exports them.
2. All ten tests exist, went red first (journal the red run), now green.
3. **Revert test:** remove the `first_seq` continuity check from `checkEpochChainLink` and
   confirm tests 7 (seq case) and 8 go red for that reason; restore. Then include
   `notarization` in the TBS array and confirm test 3 goes red; restore. Quote both runs.
4. `git diff --stat` for the unit's commits shows **no change to
   `core/protocol-types/src/session.ts` or `seal-interrupted.ts`** — state this in the
   journal explicitly.
5. Gate passes in `cello-client`: `pnpm run test` → `pnpm run lint` → `pnpm run typecheck`.
6. **Enforcer (two separate OS processes):** process A signs a two-epoch chain and writes both
   seals; process B (dist imports only) decodes, verifies the publisher signature on each,
   verifies the chain link, then proves a dropped-sequence forgery is caught:

   ```bash
   node --input-type=module -e '
   import { generateKeypair } from "./core/crypto/dist/index.js";
   import { signChannelEpochSeal, encodeChannelEpochSeal } from "./core/protocol-types/dist/index.js";
   import { writeFileSync } from "node:fs";
   const kp = generateKeypair();
   const root0 = new Uint8Array(32).fill(1), root1 = new Uint8Array(32).fill(2);
   const a = await signChannelEpochSeal(kp, { epoch_index: 0, epoch_root: root0, first_seq: 1,
     leaf_count: 5, prev_epoch_root: null, sealed_at: 1000 });
   const b = await signChannelEpochSeal(kp, { epoch_index: 1, epoch_root: root1, first_seq: 6,
     leaf_count: 3, prev_epoch_root: root0, sealed_at: 2000 });
   const forged = await signChannelEpochSeal(kp, { epoch_index: 1, epoch_root: root1, first_seq: 8,
     leaf_count: 3, prev_epoch_root: root0, sealed_at: 2000 });
   writeFileSync("/tmp/m16-003-a.bin", encodeChannelEpochSeal(a));
   writeFileSync("/tmp/m16-003-b.bin", encodeChannelEpochSeal(b));
   writeFileSync("/tmp/m16-003-forged.bin", encodeChannelEpochSeal(forged));
   console.log("CHAIN written");'
   node --input-type=module -e '
   import { decodeChannelEpochSeal, verifyChannelEpochSealSignature, checkEpochChainLink }
     from "./core/protocol-types/dist/index.js";
   import { readFileSync } from "node:fs";
   const rd = (p) => { const d = decodeChannelEpochSeal(readFileSync(p));
     if (!d.ok) { console.log("DECODE FAILED", p, d.reason); process.exit(1); } return d.seal; };
   const a = rd("/tmp/m16-003-a.bin"), b = rd("/tmp/m16-003-b.bin"), f = rd("/tmp/m16-003-forged.bin");
   if (!verifyChannelEpochSealSignature(a) || !verifyChannelEpochSealSignature(b)) {
     console.log("SIG FAILED"); process.exit(1); }
   const link = checkEpochChainLink(a, b);
   console.log(link.ok ? "CHAIN ok" : "CHAIN FAILED"); if (!link.ok) process.exit(1);
   const forgedLink = checkEpochChainLink(a, f);
   console.log(forgedLink.ok ? "GAP ACCEPTED (BUG)" : "GAP rejected: " + forgedLink.reason);
   if (forgedLink.ok) process.exit(1);'
   ```
7. Reviewed by `cello-unit-reviewer` (this file is the spec; give it the commit range), every
   finding fixed, verdict quoted below and in the journal.
8. `status:` flipped to `complete` in the same commit as the verdict.

**Not in scope:** producing epoch roots from real artifact logs (Tier 1 combines this with
orders 001/002); directory notarization and its verification (Tier 1); the conclave
co-signature (parked — the null slot is its whole v1 footprint); any daemon/relay/directory
code; npm publishing (planner/Andre).

---

## Traps recorded before you start

- **Do not import anything from `session.ts`** — not even a type that "looks reusable." The
  two seal families must stay independently evolvable, and the review checks the diff.
- **Notarization bounds (1..4096 bytes when non-null)** are shape bounds on an opaque slot,
  not verification. Do not attempt FROST verification here; you do not have the consortium
  key and it is not this order.
- **`prev_epoch_root` null-iff-genesis has two failure directions** (present at 0, absent at
  1+) — test 4 covers both; keep both in decode.
- **Expected values come from this spec or from hand-built comparisons**, never from running
  your own implementation and pasting its output into the test.
- **`@claude-flow/testing`, not `vitest`; `setupV3Tests()` after imports.**
- **Stale dist:** run the enforcer after this session's typecheck build.

---

## Newly discovered

*(add findings here — symptom, file, one-line consequence, five lines max each; keep going)*
