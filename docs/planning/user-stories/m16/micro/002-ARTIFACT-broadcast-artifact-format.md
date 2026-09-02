---
name: 002-ARTIFACT — The broadcast artifact wire format
type: micro-work-order
date: 2026-09-02
status: open
source: DOD-M16-ARTIFACT-1
description: >
  Define the signed broadcast artifact in core/protocol-types: the frozen field set (supersedes
  present from day one, extension slot reserved), canonical CBOR-array encoding, title
  validation, decode-with-reasons, signature helpers, and the leaf hash that puts an artifact
  into the channel log. Follows the trust-signal.ts house pattern exactly.
---

# **<ins>MICRO</ins>** WORK ORDER 002-ARTIFACT — The broadcast artifact wire format

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

A broadcast in M16 is a **signed artifact, not a conversation**: the channel signs a message
once; every subscriber verifies it against the channel's public key. Nothing of that artifact
exists yet. This order defines it — and because this is a wire format, what you freeze here is
what every daemon speaks forever. The field set below was decided and is not yours to amend:
`supersedes` exists from day one even though nothing uses it yet, and one extension slot is
reserved (a future co-signature) and must be `null` in v1.

**Repo: `/Users/andrep/Documents/code/cello-client`. Everything happens in
`core/protocol-types` (one new source file, one new test file, barrel exports).**

**The exemplar to imitate is `core/protocol-types/src/trust-signal.ts`** — read it first. It
shows the house shape for a signed structure: a `*_DOMAIN` constant, a fixed field list, CBOR
encoding, decode that validates everything, `hash` imported from `@cello-protocol/crypto`
(that import is established precedent — see line 39 of trust-signal.ts). One rule it embodies:
**every hashed or signed structure is a CBOR ARRAY with the domain string in slot 0 — never a
map.** The repo's CBOR encoder (`core/protocol-types/src/cbor.ts`) is only deterministic for
arrays; a map's key order is not canonical, and a guard test fails the build if you add a
second encoder.

---

## The work

### New file: `core/protocol-types/src/broadcast-artifact.ts`

```ts
import { msgLeafHash, verify } from "@cello-protocol/crypto";
import type { KeyProvider } from "@cello-protocol/crypto";
import { encodeCbor, decodeCbor } from "./cbor.js";
import { MAX_CONTENT_BYTES } from "./limits.js";

export const BROADCAST_ARTIFACT_DOMAIN = "cello-broadcast-artifact-v1";
export const MAX_BROADCAST_TITLE_CHARS = 200;
export const MAX_BROADCAST_BODY_BYTES = MAX_CONTENT_BYTES; // same ceiling as session content

export interface BroadcastArtifact {
  /** Channel identity: 32-byte Ed25519 public key. */
  channel_pubkey: Uint8Array;
  /** Monotonic per-channel sequence number, starting at 1. */
  seq: number;
  /** Which epoch this artifact belongs to, starting at 0. */
  epoch_index: number;
  /** Human/agent-readable title. First-class: digests render it without opening the body. */
  title: string;
  /** Group-key-encrypted body. Opaque bytes at this layer. */
  body_ciphertext: Uint8Array;
  /** Sequence this artifact replaces, or null. Present from v1; semantics minimal. */
  supersedes: number | null;
  /** Previous epoch's sealed root (32 bytes) — non-null ONLY on the first artifact of an
   *  epoch with epoch_index >= 1; null otherwise. */
  prev_epoch_root: Uint8Array | null;
  /** Reserved extension slot (future co-signature). MUST be null in v1; decode rejects
   *  anything else. */
  ext: null;
  /** Ed25519 signature by channel_pubkey over buildBroadcastArtifactTbs(...). */
  signature: Uint8Array;
}

export type BroadcastDecodeReason =
  | "not_cbor" | "wrong_shape" | "wrong_domain" | "bad_channel_pubkey" | "bad_seq"
  | "bad_epoch_index" | "bad_title" | "body_too_large" | "bad_supersedes"
  | "bad_prev_epoch_root" | "ext_not_null" | "bad_signature_shape";

export function validateBroadcastTitle(title: unknown):
  { ok: true } | { ok: false; reason: "bad_title"; detail: string };
export function buildBroadcastArtifactTbs(a: Omit<BroadcastArtifact, "signature">): Uint8Array;
export function signBroadcastArtifact(
  keyProvider: KeyProvider, fields: Omit<BroadcastArtifact, "signature" | "channel_pubkey">,
): Promise<BroadcastArtifact>;             // pubkey from keyProvider; throws RangeError on bad fields
export function encodeBroadcastArtifact(a: BroadcastArtifact): Uint8Array;
export function decodeBroadcastArtifact(bytes: Uint8Array):
  { ok: true; artifact: BroadcastArtifact } | { ok: false; reason: BroadcastDecodeReason; detail: string };
export function verifyBroadcastArtifact(a: BroadcastArtifact): boolean;   // never throws
export function broadcastArtifactLeafHash(a: BroadcastArtifact): Uint8Array;
```

Semantics, exactly:

- **TBS** = `encodeCbor([BROADCAST_ARTIFACT_DOMAIN, channel_pubkey, seq, epoch_index, title,
  body_ciphertext, supersedes, prev_epoch_root, ext])` — one array, that order, domain slot 0.
  `null` values are encoded as CBOR null, never omitted and never sentinel numbers.
- **Encoded artifact** = the same array with `signature` appended as slot 9.
- **`validateBroadcastTitle`**: must be a string; non-empty; at most `MAX_BROADCAST_TITLE_CHARS`
  code points (count with `[...title].length`, NOT `title.length` — surrogate pairs); no
  control characters (the regex `/[\u0000-\u001F\u007F]/u` must not match: NUL through US, plus DEL). Everything else is allowed.
- **`decodeBroadcastArtifact` validates every field and never throws.** In order: CBOR decodes
  (`not_cbor`); is an array of exactly 10 elements (`wrong_shape`); slot 0 equals the domain
  (`wrong_domain`); pubkey is a 32-byte Uint8Array (`bad_channel_pubkey`); seq is a safe
  integer ≥ 1 (`bad_seq`); epoch_index a safe integer ≥ 0 (`bad_epoch_index`); title passes
  `validateBroadcastTitle` (`bad_title`); body is a Uint8Array ≤ `MAX_BROADCAST_BODY_BYTES`
  (`body_too_large`); supersedes is null OR a safe integer with `1 <= supersedes < seq`
  (`bad_supersedes`); prev_epoch_root is null or exactly 32 bytes, and MUST be null when
  `epoch_index === 0` (`bad_prev_epoch_root`); ext is exactly null (`ext_not_null`); signature
  is 64 bytes (`bad_signature_shape`). Decode does NOT verify the signature — that is
  `verifyBroadcastArtifact`, kept separate so a caller can report shape and signature failures
  differently.
- **`verifyBroadcastArtifact`** = `verify(a.channel_pubkey, buildBroadcastArtifactTbs(a),
  a.signature)` — crypto's `verify` already never throws.
- **`signBroadcastArtifact`** runs the same field validation as decode (throw `RangeError`
  with the reason string on the first violation), builds the TBS, signs via
  `keyProvider.sign`, returns the complete artifact.
- **`broadcastArtifactLeafHash`** = `msgLeafHash(encodeBroadcastArtifact(a))` — the leaf
  commits to the SIGNED artifact (signature included), so the channel log commits to exactly
  what subscribers received.

### Wire it up

- `core/protocol-types/src/index.ts`: explicit named exports (this barrel uses no wildcards —
  match its style): the two constants, the interface (as `export type`),
  `BroadcastDecodeReason` (as `export type`), and all seven functions.
- Tests: `core/protocol-types/src/__tests__/broadcast-artifact.test.ts`. This package has
  **no `tsconfig.test.json`** (unlike core/crypto) — do not create one; the existing test
  wiring picks up `src/__tests__/*.test.ts`.

### Observability

None. Pure format code — no logger, no events. Do not add any.

---

## ⚠️ WHAT MUST NOT CHANGE

- **The field order and slot count are frozen the moment this merges.** No reordering, no
  "helpful" extra fields, no version negotiation, no second format variant. If a field seems
  missing, that is a §5 stop, not an addition.
- **Never hash or sign a CBOR map.** Arrays only, domain slot 0. The guard test
  `no-multiple-cbor-encoders.test.ts` also means: import `encodeCbor`/`decodeCbor` from
  `./cbor.js`, never instantiate cbor-x yourself.
- **Do not modify `cbor.ts`, `limits.ts`, `trust-signal.ts`, or any existing file except the
  index barrel.**
- **No backward-compatibility branches** (M16-PROCEDURE §0): there are no old artifacts to
  read. One decoder, strict, rejecting everything that is not exactly v1.
- **Do not weaken a validation to make a test pass.** If your test and the spec disagree, the
  spec above wins; fix the test.
- **`decodeBroadcastArtifact` and `verifyBroadcastArtifact` never throw** — including on
  adversarial CBOR (wrap the `decodeCbor` call; cbor-x throws on garbage).

---

## Tests — write ALL of these first, confirm ALL red, then implement

Harness: copy `core/protocol-types/src/__tests__/moniker.test.ts`'s import style —
`describe/it/expect` from `@claude-flow/testing`, `setupV3Tests()` after imports. Keys: build a
real signer with `generateKeypair()` from `@cello-protocol/crypto` (crypto is a declared
dependency) — crypto is never mocked. A helper `makeFields(overrides)` returning valid fields
(seq 3, epoch_index 1, title "Deploy finished", small body, supersedes null, a 32-byte
prev_epoch_root only when explicitly overridden to epoch-first shape, ext null) keeps each
test to one line of setup. Run only this file while iterating: from `core/protocol-types/`,
`pnpm vitest run src/__tests__/broadcast-artifact.test.ts`.

1. `sign → encode → decode → verify round-trips` — decode returns `ok: true`, every field
   deep-equals what was signed, `verifyBroadcastArtifact` is true.
2. `encoding is deterministic` — encode the same artifact twice; byte arrays are identical.
3. `every field is signed` — for EACH of the eight non-signature fields in turn, decode a
   valid artifact, mutate that one field (seq+1; epoch_index+1; title + "x"; one body byte
   flipped; supersedes null→1; prev_epoch_root null→32 zero bytes with epoch_index bumped to
   1 so shape stays valid; channel_pubkey one byte flipped; ext stays null — skip ext), and
   assert `verifyBroadcastArtifact` is false. Loop over cases; one mutation per assertion.
4. `title validation` — each of: empty string → refused; 200 emoji (astral, e.g. "🚨".repeat(200))
   → OK (code points, not UTF-16 units); 201 code points → refused; embedded NUL ("\u0000"), newline ("\n"),
   and DEL ("\u007F") → each refused; a plain 200-char ASCII title → OK.
5. `decode rejects each malformation with its named reason` — one case per
   `BroadcastDecodeReason`: random bytes → `not_cbor`; a CBOR array of 9 → `wrong_shape`;
   domain slot "cello-trust-signal-v1" → `wrong_domain`; 31-byte pubkey →
   `bad_channel_pubkey`; seq 0 → `bad_seq`; seq 1.5 → `bad_seq`; epoch_index -1 →
   `bad_epoch_index`; control-char title → `bad_title`; body of
   `MAX_BROADCAST_BODY_BYTES + 1` → `body_too_large`; supersedes === seq → `bad_supersedes`;
   supersedes 0 → `bad_supersedes`; prev_epoch_root of 16 bytes → `bad_prev_epoch_root`;
   epoch_index 0 with a 32-byte prev_epoch_root → `bad_prev_epoch_root`; ext = 7 →
   `ext_not_null`; 63-byte signature → `bad_signature_shape`. Assert the exact reason string
   for every case, not just `ok: false`.
6. `adversarial CBOR does not throw` — feed decode: empty bytes, a CBOR map, a CBOR int, and
   1KB of 0xFF; each returns `ok: false`, nothing throws.
7. `signBroadcastArtifact enforces the same rules` — signing with seq 0 throws `RangeError`;
   with a 201-code-point title throws `RangeError`.
8. `wrong key fails verify` — sign with keypair A, replace channel_pubkey with keypair B's
   public key; verify is false.
9. `leaf hash commits to the signature` — two artifacts identical except signed by different
   keypairs (same fields, pubkey swapped accordingly) have different
   `broadcastArtifactLeafHash`; and the hash equals `msgLeafHash(encodeBroadcastArtifact(a))`
   recomputed inline (pins the definition).
10. `supersedes survives the wire` — an artifact with `supersedes: 2`, seq 3 round-trips with
    `supersedes === 2` (the field is live on the wire even though nothing consumes it yet).

---

## Definition of Done

1. The module exists with exactly the exports listed, and the index barrel exports them.
2. All ten tests exist, went red first (journal the red run), now green.
3. **Revert test:** break the TBS on purpose — swap `seq` and `epoch_index` in
   `buildBroadcastArtifactTbs` only (not in encode) — and confirm tests 1 and 3 go red;
   restore. Then make `decodeBroadcastArtifact` skip the title check and confirm test 5's
   `bad_title` case goes red; restore. Quote both red runs in the journal.
4. Gate passes in `cello-client`: `pnpm run test` → `pnpm run lint` → `pnpm run typecheck`.
5. **Enforcer (two separate OS processes):** after the typecheck build, run — process A signs
   and writes the artifact; process B decodes and verifies from the BUILT dist, then proves
   one flipped byte kills it. Paste the output (`SIGNED ok / VERIFY ok / TAMPER rejected`).

   ```bash
   node --input-type=module -e '
   import { generateKeypair } from "./core/crypto/dist/index.js";
   import { signBroadcastArtifact, encodeBroadcastArtifact } from "./core/protocol-types/dist/index.js";
   import { writeFileSync } from "node:fs";
   const kp = generateKeypair();
   const a = await signBroadcastArtifact(kp, { seq: 1, epoch_index: 0, title: "Enforcer run",
     body_ciphertext: new TextEncoder().encode("opaque"), supersedes: null,
     prev_epoch_root: null, ext: null });
   writeFileSync("/tmp/m16-002-artifact.bin", encodeBroadcastArtifact(a));
   console.log("SIGNED ok");'
   node --input-type=module -e '
   import { decodeBroadcastArtifact, verifyBroadcastArtifact } from "./core/protocol-types/dist/index.js";
   import { readFileSync } from "node:fs";
   const bytes = readFileSync("/tmp/m16-002-artifact.bin");
   const d = decodeBroadcastArtifact(bytes);
   if (!d.ok || !verifyBroadcastArtifact(d.artifact)) { console.log("VERIFY FAILED"); process.exit(1); }
   console.log("VERIFY ok");
   const t = new Uint8Array(bytes); t[t.length - 1] ^= 0xff;
   const dt = decodeBroadcastArtifact(t);
   const bad = dt.ok && verifyBroadcastArtifact(dt.artifact);
   console.log(bad ? "TAMPER ACCEPTED (BUG)" : "TAMPER rejected");
   if (bad) process.exit(1);'
   ```
6. Reviewed by `cello-unit-reviewer` (this file is the spec; give it the commit range), every
   finding fixed, verdict quoted below and in the journal.
7. `status:` flipped to `complete` in the same commit as the verdict.

**Not in scope:** group-key encryption (the body is opaque bytes here); the channel log and
epoch sealing (orders 001/003 and Tier 1); any daemon, relay, or directory code; the
`channel-epoch-seal` receipt (003); npm publishing (planner/Andre — you end at
committed-and-pushed).

---

## Traps recorded before you start

- **`title.length` counts UTF-16 units, not characters.** "🚨" has length 2. Use
  `[...title].length`. Test 4 exists to catch exactly this.
- **cbor-x throws on malformed input** — decode must try/catch around `decodeCbor` and return
  `not_cbor`. Test 6 exists for this.
- **`supersedes < seq` needs seq already validated** — validate in the listed order or the
  comparison reads garbage.
- **Do not derive test expectations from your own encoder** — expected reasons come from this
  spec; expected hashes are recomputed inline from the primitive (test 9).
- **`@claude-flow/testing`, not `vitest`, for describe/it/expect**, plus `setupV3Tests()`.
- **Stale dist:** the enforcer imports `dist/` — run it only after this session's typecheck
  build, or you are testing last week's package.

---

## Newly discovered

*(add findings here — symptom, file, one-line consequence, five lines max each; keep going)*
