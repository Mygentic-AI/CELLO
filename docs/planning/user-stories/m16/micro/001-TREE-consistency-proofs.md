---
name: 001-TREE — Consistency proofs in @cello-protocol/crypto
type: micro-work-order
date: 2026-09-02
status: open
source: DOD-M16-CT-1
description: >
  Add RFC 6962 consistency proofs (prove a log at size n is a genuine extension of the log at
  size m) to core/crypto, next to the existing Merkle inclusion machinery. Pure functions, no
  I/O, no new dependencies. This is the property the whole M16 broadcast design was decided on:
  a channel can prove it never rewrote its history.
---

# **<ins>MICRO</ins>** WORK ORDER 001-TREE — Consistency proofs

> ## THE RULES OF A MICRO WORK ORDER
>
> 1. **Read [[M16-PROCEDURE]] IN FULL before you start.** It binds you: the gate, the watchdog
>    cron (§4a — arm it now, before touching code), the review dispatch, one session = one order.
>    **Do not read `M16-DEFINITION-OF-DONE.md`, `M16-BUILD-JOURNAL.md`, or any design log** — this
>    order carries everything you need from them.
> 2. **MICRO means small.** One mission. Follow it to its end. **Never grow the mission.**
> 3. **Found something else?** Write it under *Newly discovered* at the foot of this file and
>    **keep going**. Do not fix it. Do not investigate it.
> 4. **500 lines, hard cap** on this file. Minimal without omitting anything.
> 5. **Standard procedure applies in full:** tests first (all red) → implement (all green) →
>    review (`cello-unit-reviewer`) → fix every finding → commit per fix, push after every commit.
>    **Closing this unit means flipping this file's `status:` frontmatter to `complete` in the
>    SAME commit as the reviewer's verdict.**
> 6. **Done is done.** When the Definition of Done below is met, stop.

---

## The problem, plainly

M16 gives a broadcast channel one publisher-side log, sealed in chained epochs. The trust claim
that decided the whole design is: **the channel can prove it never rewrote its history** — that
the log at time T2 is a genuine *extension* of the log at time T1, nothing inserted, removed, or
rewritten.

The repo already has the other half. `core/crypto/src/merkle.ts` builds RFC-6962-shaped trees and
does **inclusion** proofs ("message 47 is in this tree"). What does not exist anywhere in the
repo — verified 2026-09-02 — is the **consistency** proof ("the tree of size n extends the tree
of size m"). This order adds it: two pure functions, no I/O, no storage, no network, no new
dependencies.

**Repo: `/Users/andrep/Documents/code/cello-client`. Everything in this order happens in
`core/crypto`.** Nothing in `trustless-cello` changes.

---

## The work

### New file: `core/crypto/src/consistency.ts`

Implements RFC 6962 §2.1.2 (proof generation) and the verification algorithm of RFC 9162
§2.1.4.2. Cite both RFC section numbers in the file's top comment. Exact exports:

```ts
import { nodeHash } from "./hashing.js";

/**
 * Consistency proof that leafHashes[0:oldSize) is a prefix of the log leafHashes[0:n).
 * leafHashes are 32-byte LEAF hashes (already domain-prefixed by the caller, as everywhere
 * in merkle.ts's { kind: "hash" } leaves). Throws RangeError if oldSize < 1, oldSize > n,
 * or any hash is not 32 bytes. Returns [] when oldSize === n.
 */
export function consistencyProof(
  leafHashes: readonly Uint8Array[],
  oldSize: number,
): Uint8Array[];

/**
 * Verify that (newSize, newRoot) extends (oldSize, oldRoot). Never throws; malformed
 * input returns false. oldSize === newSize requires an empty proof and equal roots.
 */
export function verifyConsistency(
  oldSize: number,
  oldRoot: Uint8Array,
  newSize: number,
  newRoot: Uint8Array,
  proof: readonly Uint8Array[],
): boolean;
```

### The algorithms — implement EXACTLY this, no variations

Internal helpers (not exported): `largestPowerOfTwoBelow(n)` (`k = 1; while (k * 2 < n) k *= 2;
return k;`), `isPowerOfTwo(m)` (`m > 0 && (m & (m - 1)) === 0`), `subtreeRoot(leafHashes, lo,
hi)` (RFC 6962 MTH: one leaf → that hash; else split at `lo + largestPowerOfTwoBelow(hi - lo)`
and `nodeHash(left, right)`), and `constantTimeEqual(a, b)` (length check, then XOR-accumulate
every byte, compare accumulator to 0 — same shape as the private one in `merkle.ts`; write a
local copy here, do not modify `merkle.ts`).

**Generation** (recursive, over absolute ranges; called as `subProof(oldSize, 0, n, true)`):

```
subProof(m, lo, hi, isOriginalSubtree):
  n = hi - lo
  if m == n:
    if isOriginalSubtree: return []                    // caller already knows this root
    else:                 return [subtreeRoot(lo, hi)]
  k = largestPowerOfTwoBelow(n)
  if m <= k: return subProof(m, lo, lo + k, isOriginalSubtree) ++ [subtreeRoot(lo + k, hi)]
  else:      return subProof(m - k, lo + k, hi, false) ++ [subtreeRoot(lo, lo + k)]
```

**Verification** (iterative; all sizes fit in a JS number — epochs cap at 1,000 leaves; still
use `>>> 1` for shifts and `& 1` for LSB):

```
verifyConsistency(m, oldRoot, n, newRoot, proof):
  if any hash (roots or proof entries) is not 32 bytes: return false
  if m < 1 or n < 1 or m > n: return false
  if m == n: return proof.length == 0 && constantTimeEqual(oldRoot, newRoot)
  path = isPowerOfTwo(m) ? [oldRoot, ...proof] : proof
  if path.length == 0: return false
  fn = m - 1; sn = n - 1
  while (fn & 1) == 1: fn = fn >>> 1; sn = sn >>> 1
  fr = path[0]; sr = path[0]
  for each c in path[1..end]:
    if sn == 0: return false
    if (fn & 1) == 1 or fn == sn:
      fr = nodeHash(c, fr); sr = nodeHash(c, sr)
      if (fn & 1) == 0: while fn != 0 and (fn & 1) == 0: fn = fn >>> 1; sn = sn >>> 1
    else:
      sr = nodeHash(sr, c)
    fn = fn >>> 1; sn = sn >>> 1
  return constantTimeEqual(fr, oldRoot) and constantTimeEqual(sr, newRoot) and sn == 0
```

**Worked example to check yourself against** (7 leaves L0..L6, old size 3): the proof MUST be
exactly `[L2, L3, H(L0,L1), MTH(L4..L6)]` in that order, where `H` is `nodeHash` and
`MTH(L4..L6) = nodeHash(nodeHash(L4, L5), L6)`. If your generator produces anything else for
this case, stop and re-read the pseudocode — do not "fix" the verifier to match.

### Wire it up

- `core/crypto/src/index.ts`: add `export { consistencyProof, verifyConsistency } from
  "./consistency.js";` next to the existing merkle exports. Match the file's existing style.
- `core/crypto/tsconfig.test.json`: **add the new test file to the explicit `"files"` list.**
  This file lists every test individually; a test file missing from it silently escapes
  `tsc --build`. This is a known repo trap, not optional.

### Observability

None. These are pure functions in a crypto library — no logger, no events. Do not add any.

---

## ⚠️ WHAT MUST NOT CHANGE

- **Do not modify `merkle.ts` or `hashing.ts` in any way.** You import `nodeHash`; that is the
  entire contact surface. If you believe something there must change, that is a §5 stop.
- **Do not "normalize" the tree shape.** This repo's trees promote an odd last node upward
  (left-balanced). That IS the RFC 6962 shape — subtree splitting at the largest power of two
  below n produces identical roots. If your implementation ever duplicates an odd node instead
  of promoting it, it is wrong. Do not add duplication "for compatibility."
- **No new dependencies.** `package.json` does not change. No `node:crypto`, no library for
  power-of-two math, nothing.
- **No compatibility branches, no versioned variants** of the proof format (M16-PROCEDURE §0:
  alpha, nothing to preserve). One algorithm, exactly as specified.
- **`verifyConsistency` never throws** — malformed input is `false`. `consistencyProof` throws
  `RangeError` on bad input (matching `inclusionProof`'s existing behavior).

---

## Tests — write ALL of these first, confirm ALL red, then implement

**File: `core/crypto/src/__tests__/consistency.test.ts`.** Copy the harness conventions of
`core/crypto/src/__tests__/merkle.test.ts` exactly: `describe/it/expect` imported from
`@claude-flow/testing` (NOT from `vitest`), `setupV3Tests()` called after imports. Real SHA-256
throughout — no mocks (crypto is never mocked in this repo). Build reference trees and roots
with the EXISTING, separately-tested `buildMerkleTree` + `merkleRoot` over `{ kind: "hash" }`
leaves — that is the independent oracle. Make distinct leaf hashes as
`msgLeafHash(new TextEncoder().encode("leaf-" + i))` (import `msgLeafHash` from the package).

Run only this file while iterating: from `core/crypto/`,
`pnpm vitest run src/__tests__/consistency.test.ts` — never the whole suite in a loop.

1. `exhaustive: every (m, n) with 1 <= m <= n <= 32 round-trips` — for each pair, build
   `leafHashes` of length n, `proof = consistencyProof(leafHashes, m)`,
   `oldRoot = merkleRoot(buildMerkleTree(first m as hash-leaves))`, `newRoot` likewise over all
   n; assert `verifyConsistency(m, oldRoot, n, newRoot, proof) === true`. This single test is
   the correctness core; it must iterate ALL 528 pairs, not a sample.
2. `worked example m=3 n=7 produces the exact RFC path` — assert the proof deep-equals
   `[L2, L3, nodeHash(L0,L1), nodeHash(nodeHash(L4,L5),L6)]` element by element (compare hex
   strings of each entry). This pins the generator independently of the verifier.
3. `m === n requires empty proof and equal roots` — `consistencyProof(leaves, n)` returns `[]`;
   `verifyConsistency(n, root, n, root, [])` is true; same call with a single extra 32-byte
   entry in the proof is false; `verifyConsistency(n, root, n, otherRoot, [])` is false.
4. `power-of-two boundary m=4 n=7` — proof is exactly `[MTH(L4..L6)]` (one entry); verifies
   true. (Exercises the oldRoot-prepend branch of the verifier.)
5. `tampered newRoot fails` — flip one byte of newRoot for (m=5, n=13); verify returns false.
6. `tampered oldRoot fails` — same shape, flip oldRoot instead.
7. `tampered proof entry fails` — flip one byte of each proof entry in turn for (m=5, n=13);
   every variant returns false. Loop over entries — one flipped entry per verify call.
8. `truncated and extended proofs fail` — for (m=5, n=13): drop the last entry → false; append
   a duplicate of the last entry → false.
9. `a rewritten history fails` — build leaves of length 13, compute oldRoot over the first 5;
   then REPLACE leaf 2 and rebuild the full tree of 13 for newRoot, with the proof generated
   from the rewritten leaves; `verifyConsistency(5, oldRoot, 13, newRoot, proof)` is false.
   **This is the property the unit exists for — the assertion is on the rewritten-history case
   by name, not on a generic mismatch.**
10. `malformed input returns false, never throws` — each of: m=0; n=0; m>n; a 31-byte oldRoot;
    a 31-byte proof entry; empty proof with m<n. Assert `false` (wrap in expect, no try/catch
    needed — the function must not throw).
11. `consistencyProof rejects bad input with RangeError` — oldSize=0, oldSize=n+1, and a
    33-byte leaf hash each throw `RangeError`.

---

## Definition of Done

1. `consistencyProof` and `verifyConsistency` exist in `core/crypto/src/consistency.ts`, are
   exported from the package index, and implement exactly the algorithms above (RFC section
   numbers cited in the file comment).
2. All eleven tests above exist with the names given, went RED before implementation (state
   this in the journal with the red run's output), and are GREEN after.
3. **The revert test:** with the implementation done, break it on purpose — swap the two
   arguments of one `nodeHash` call in `subtreeRoot` — and confirm tests 1 and 2 go red for
   that reason; then restore. Do the same to the verifier (remove the `sn == 0` final check)
   and confirm test 8's extended-proof case goes red. Quote both red runs in the journal.
4. The new test file is listed in `core/crypto/tsconfig.test.json` `"files"`.
5. Gate passes in `cello-client`: `pnpm run test` → `pnpm run lint` → `pnpm run typecheck`.
6. **Enforcer (separate OS process):** after `pnpm run typecheck` (which emits `dist/`), run
   the check below from the repo root as a standalone node process — it imports only the BUILT
   package and proves a rewritten history is rejected end to end. Paste its output (`EXTEND ok
   / REWRITE rejected`) into the journal.

   ```bash
   node --input-type=module -e '
   import { buildMerkleTree, merkleRoot, msgLeafHash, consistencyProof, verifyConsistency }
     from "./core/crypto/dist/index.js";
   const enc = (s) => msgLeafHash(new TextEncoder().encode(s));
   const leaves = Array.from({length: 12}, (_, i) => enc("leaf-" + i));
   const asTree = (hs) => buildMerkleTree(hs.map((h) => ({ kind: "hash", data: h })));
   const oldRoot = merkleRoot(asTree(leaves.slice(0, 5)));
   const newRoot = merkleRoot(asTree(leaves));
   const ok = verifyConsistency(5, oldRoot, 12, newRoot, consistencyProof(leaves, 5));
   const rewritten = leaves.slice(); rewritten[2] = enc("history-rewritten");
   const bad = verifyConsistency(5, oldRoot, 12, merkleRoot(asTree(rewritten)),
     consistencyProof(rewritten, 5));
   console.log(ok ? "EXTEND ok" : "EXTEND FAILED");
   console.log(bad ? "REWRITE ACCEPTED (BUG)" : "REWRITE rejected");
   if (!ok || bad) process.exit(1);'
   ```
7. Reviewed by `cello-unit-reviewer` (give it this file as the spec and the commit range),
   every finding fixed, verdict quoted below and in the journal.
8. This file's `status:` flipped to `complete` in the same commit as the verdict.

**Not in scope:** epoch chaining, the channel log, the `channel-epoch-seal` receipt type
(order 003), any storage or wire format, any change outside `core/crypto`, npm publishing
(planner/Andre work — your job ends at committed-and-pushed).

---

## Traps recorded before you start

- **The verifier's shift loop is where implementations die.** The inner `while` after a
  combining step runs ONLY when the pre-combine LSB of `fn` was 0 (i.e. the `fn == sn` case);
  then both counters shift once more unconditionally. Follow the pseudocode line by line and
  check yourself against the worked example before writing any test expectations of your own.
- **Do not derive expected proofs by running your own code** — that asserts nothing. Expected
  values come from the existing `merkleRoot` oracle (tests 1, 4, 9) or from hand-built
  `nodeHash` expressions (test 2).
- **`@claude-flow/testing`, not `vitest`, for describe/it/expect** — and `setupV3Tests()` after
  imports. Copying the import line from a random other repo's test will typecheck and then fail
  in CI.
- **The stale-dist trap:** `core/*/dist/` in the tree may be older than `src/`. The enforcer in
  DoD 6 must run AFTER the typecheck build in the same session, or it tests last week's code.
- **Constant-time comparison is not paranoia theatre** — `merkle.ts` does it for every hash
  compare and the reviewer will flag `Buffer.compare`/`===` on hashes. Use the local
  `constantTimeEqual`.

---

## Newly discovered

*(add findings here — symptom, file, one-line consequence, five lines max each; keep going)*
