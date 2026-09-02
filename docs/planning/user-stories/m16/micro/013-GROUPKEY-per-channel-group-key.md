---
name: 013-GROUPKEY — Per-channel group key: body encryption and per-member wrapping
type: micro-work-order
date: 2026-09-02
status: draft
source: DOD-M16-GROUPKEY-1
depends_on: [002-ARTIFACT]
description: >
  DRAFT — see the planner pre-issue checklist. Every channel body is encrypted to a
  per-channel symmetric group key with a generation counter; the key is wrapped per member to
  the member's public key for delivery at join (012) and re-key (014). Pure crypto in
  core/crypto: generate, encrypt/decrypt a body, wrap/unwrap a key bundle. The relay never
  reads content — same posture as sessions.
---

# **<ins>MICRO</ins>** WORK ORDER 013-GROUPKEY — The per-channel group key (DRAFT)

> ## ⚠️ PLANNER PRE-ISSUE CHECKLIST
> - [ ] Name the AEAD primitive sessions already use for content
>       (`core/crypto/src/session-content-seal.ts` / `content-seal.ts`) — exact function names
>       and nonce discipline; this order must reuse it, never a second AEAD.
> - [ ] Name the asymmetric key-agreement primitive (`core/crypto/src/session-key-agreement.ts`)
>       and confirm an Ed25519 identity key can be used for a static ECDH wrap (or whether the
>       repo already derives an X25519 key from it — cite the function). If not, the wrap must
>       use the session's existing agreed key at join time instead of a static wrap — DECIDE and
>       write it here.
> - [ ] Replace every "≈" with exact file:function; enumerate tests to exact assertions.

> ## THE RULES OF A MICRO WORK ORDER
> 1. Read [[M16-PROCEDURE]] IN FULL first; arm the watchdog cron; do not read the DoD, the
>    journal, or any design log. 2. One mission, never grown. 3. *Newly discovered* at the
>    foot. 4. 500 lines hard cap. 5. Tests first → implement → review (`cello-unit-reviewer`)
>    → fix every finding → commit per fix, push per commit; `status:` flips in the verdict
>    commit. 6. Done is done.

---

## The problem, plainly
"The relay never reads content" is a load-bearing claim across CELLO. A broadcast body in
plaintext on the relay would be a second, weaker posture. So every channel body is encrypted
to a group key that members receive at join. Ejection (014) rotates it. This order is the
cryptography only — no storage, no frames, no daemon code.

**Repo: `cello-client`, `core/crypto` only.** RFCs cited in pseudocode per SPARC: the AEAD's
RFC (RFC 8439 if ChaCha20-Poly1305 / XChaCha per the existing primitive), X25519 → RFC 7748,
HKDF → RFC 5869.

## The work — `core/crypto/src/channel-group-key.ts`
```ts
export interface GroupKey { generation: number; key: Uint8Array /* 32 */ }
export function generateGroupKey(generation: number): GroupKey;               // CSPRNG
export function encryptBody(gk: GroupKey, channelPubkey: Uint8Array, seq: number, plaintext: Uint8Array): Uint8Array;
  // AEAD with associated data = CBOR array ["cello-broadcast-body-v1", channel_pubkey, seq, generation];
  // output = CBOR array [generation, nonce, ciphertext] — generation in the clear so a member picks the right key
export function decryptBody(keys: readonly GroupKey[], channelPubkey: Uint8Array, seq: number, body: Uint8Array):
  { ok: true; plaintext: Uint8Array; generation: number } | { ok: false; reason: "unknown_generation" | "auth_failed" | "malformed" };
export function wrapGroupKeyFor(gk: GroupKey, channelPubkey: Uint8Array, memberPubkey: Uint8Array, senderKeys: ≈): Uint8Array;   // the key bundle, per member
export function unwrapGroupKey(bundle: Uint8Array, channelPubkey: Uint8Array, myKeys: ≈): { ok: true; gk: GroupKey } | { ok: false; reason: string };
```
Nonce: random 24-byte per encryption if the primitive is XChaCha (never a counter shared
across daemons). Associated data binds body to channel + seq + generation so a body cannot
be transplanted between positions or channels.

## ⚠️ WHAT MUST NOT CHANGE
- **One AEAD, the one sessions use.** No second cipher, no new dependency.
- **Associated data is not optional** — a ciphertext moved to another seq must fail
  `auth_failed` (test).
- **`decryptBody` never throws; `unknown_generation` is a distinct reason** (Tier 3 uses it
  to detect "I missed a re-key").
- **Keys never touch a logger.** No event carries key bytes; `generation` only.
- **No backward compat, no key-format versions beyond the domain string.**

## Tests (properties fixed; enumerate at issue)
round trip; wrong key generation → unknown_generation; transplanted seq → auth_failed;
transplanted channel → auth_failed; tampered ciphertext → auth_failed; wrap/unwrap round trip
for member A; member B cannot unwrap A's bundle; malformed bundle → reason; two encryptions
of the same plaintext differ (nonce); RFC-vector test for the AEAD via the existing primitive's
own vectors (do not re-vector it). Add the test file to `core/crypto/tsconfig.test.json`.

## Enforcer
Two node processes over dist: A generates + wraps for B's pubkey + encrypts a body and writes
both; B unwraps and decrypts; B then tries the ciphertext at seq+1 → `auth_failed`.

## Not in scope
Join/delivery/eject flows (012/014/Tier 3); storage of keys (015 subscription row holds the
member's unwrapped keys by generation); publishing.

## Newly discovered
*(five lines max each; keep going)*
