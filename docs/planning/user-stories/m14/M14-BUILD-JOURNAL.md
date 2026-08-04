---
name: M14 Build Journal
type: build-journal
date: 2026-08-04
milestone: M14
status: open
topics: [m14, collaborative-state, crdt, yjs, documents, build-journal]
description: >
  Append-only audit trail for M14 (federated collaborative state V1). Entries at END OF FILE,
  verified after writing. The DoD is the scoreboard; full proofs, forensics, and run output
  live here.
---

# M14 Build Journal

## RESUME STATE (overwrite in place — the only mutable block)

- **Current unit:** DOD-DOC-LEAF-1 — **client half DONE** (written AND reviewed; all findings
  applied — Entry 3). The DoD line stays ❌ until the trustless-cello half is green too.
- **Branches:** cello-client `m14/leaf-1` @ 2f5b8a1 (pushed, unmerged — merges when the whole
  unit is green). trustless-cello half not started.
- **Next action:** the publish cascade (`/cello-publish`, loaded for that publish) — the
  trustless-cello half compiles against the new crypto. Its final `latest` promotion is Andre's.
- **Next red after this unit:** DOD-DOC-FUZZ-1 (interleavable while the publish waits; Yjs
  dependency facts already measured — see Entry 3's note in the next entry).
- **Parked/waiting:** nothing blocked yet.
- **HEAD:** trustless-cello `main` @ c8c2857f · cello-client `m14/leaf-1` @ 2f5b8a1

---

## Entry 1 — 2026-08-04 — DOD-DOC-LEAF-1 opened: clause checklist + seam survey

**Target (one sentence):** every component that names a Merkle leaf kind — client crypto, client
daemon, relay, directory — recognizes `0x04` (doc-op) and `0x05` (rejection) with domain-separated
hashing, and every place that previously coerced an unknown byte now either maps it explicitly or
(where a tree is rebuilt) hashes it as opaque bytes.

### Clause checklist (the reviewer receives this)

cello-client:
- [ ] C1. `core/crypto/src/hashing.ts`: `DOC_LEAF = 0x04`, `REJECT_LEAF = 0x05` constants +
      `docLeafHash`, `rejectLeafHash` (SHA-256(prefix ‖ data), RFC 6962 §2.1 domain separation,
      beside `MSG_LEAF`/`CTRL_LEAF`).
- [ ] C2. `core/crypto/src/merkle.ts`: `LeafInput` union gains `{kind:"doc"}` and
      `{kind:"reject"}`; `buildMerkleTree` maps them to the new hash fns.
- [ ] C3. Verifier tolerance (§16.7-10): `LeafInput` gains `{kind:"opaque"; prefix:number}` so a
      tree rebuild can include an unrecognized kind byte without erroring (hash =
      SHA-256(prefix ‖ data)); test: a tree with an opaque 0x06 leaf builds + roots
      deterministically.
- [ ] C4. `core/daemon/src/session-relay-client.ts`: `LEAF_KIND_DOC = 0x04`,
      `LEAF_KIND_REJECT = 0x05` beside `LEAF_KIND_MSG`/`LEAF_KIND_CTRL`.
- [ ] C5. `core/daemon/src/session-tree.ts`: `SessionTreeLeafKind` gains `"doc" | "reject"`.
- [ ] C6. `session_tree_leaves` (TEXT kind) round-trip: `#loadTreeFromDb`
      (session-node-manager.ts:4376) replaces the `=== "ctrl" ? "ctrl" : "msg"` coercion with an
      explicit map; an unknown stored kind REFUSES loudly naming the value (own-DB corruption /
      version skew, ABSENT IS NOT FINE).
- [ ] C7. `session_seal_leaves` (INTEGER kind) round-trip: store/read passes 0x04/0x05 through
      unaltered — pinned by test.
- [ ] C8. cello-client gates green (`pnpm run test` → `lint` → `typecheck` → `build`).
- [ ] C9. Publish AC: changed packages (crypto at minimum; daemon if its build is cut) published
      via `/cello-publish` — skill loaded for THIS publish; `latest` promotion is Andre's.

trustless-cello (compiles against the published crypto — sequenced after C9):
- [ ] T1. `relay-node.ts:1136`: allow-list admits {0x00, 0x02, 0x04, 0x05}; leaf-hash selection
      becomes a 4-way map (`docLeafHash`/`rejectLeafHash`); `leaf_log` kind type widened.
- [ ] T2. `relay-node.test.ts:525` guard test AMENDED: 0x04/0x05 move from the invalid set to
      accepted cases; 0x01 (internal-node prefix), 0x03, 0xff, 0x10 stay refused.
- [ ] T3. `seal-unilateral-verify.ts:75`: unknown-byte→"msg" coercion becomes an explicit map
      {0x00:"msg", 0x02:"ctrl", 0x04:"doc", 0x05:"reject"}; anything else →
      `{ok:false, reason:"unilateral_leaf_kind_unknown"}`.
- [ ] T4. `directory-frames.ts:746`: `leaf_kind` gains the range check (integer, 0–255) at the
      shape layer; kind-set semantics stay in seal-unilateral-verify.
- [ ] T5. `verifySealLeaves` + `seal-legibility.ts` discriminate ceremony ctrl (0x02) from
      document leaves: with distinct kinds, ctrl detection stays 0x02-only; tests pin that a
      0x04/0x05 leaf neither fakes a ceremony leaf nor becomes `final_message`; decide + journal
      whether doc leaves count for `answered` (proposed: NO — only content replies answer).
- [ ] T6. Directory tree rebuilds (directory-node.ts:4401/4436/4857/4931, relay-node.ts:665/706)
      pass widened kinds through `LeafInput` — compile + test coverage via T2/T5 paths.
- [ ] T7. trustless-cello re-pin: `pnpm install` after the publish lands; gates green.
- [ ] T8. Wire-batching AC (§2c): relay/directory deploy BEFORE or WITH the first published
      client that submits a 0x04 leaf. No client submits 0x04 until P2/P3, so the constraint is
      recorded here and enforced at DOD-DOC-SHIP-1.

### Seam survey (verified in code today)

- Client hashing/merkle exactly as the DoD describes (hashing.ts:4-6, merkle.ts:99 closed union).
  `session-tree.ts` kinds are metadata; the stored hash already encodes the prefix.
- The reload coercion at session-node-manager.ts:4376 is real (`r.leaf_kind === "ctrl" ? "ctrl"
  : "msg"`) — a stored "doc" kind would silently become "msg" on restart. C6 kills it.
- `session_seal_leaves.leaf_kind` is INTEGER and passes through untyped numbers already
  (session-seal-leaf-store.ts:109); C7 is a pin, not a change.
- Relay computes leaf hashes ITSELF from the kind byte (relay-node.ts:1180-1182) — the earlier
  session's claim that the relay is pass-through was wrong and stays wrong; the allow-list AND
  the hash map both need the new kinds.
- Directory rebuilds trees passing `l.kind` straight into `LeafInput` (4855, 4931, 4401) — the
  union widening in crypto flows through with no directory-side mapping code, EXCEPT
  seal-unilateral-verify.ts:75 which is the one place a raw byte maps to a kind string (T3).
- `sealCeremonyLeafIndices` / `trailingSealCtrlAuthors` / `verifySealLeaves` all discriminate on
  `kind !== "ctrl"` — correct once 0x04/0x05 stop coercing to "ctrl"/"msg"; the invariant comment
  at seal-legibility.ts:109-114 names exactly this change.

### Falsification pass (procedure §2 step 3)

- *Does the crypto interface expose what the relay needs?* It will: relay already imports
  `msgLeafHash`/`ctrlLeafHash` from `@cello-protocol/crypto` — the new fns land beside them.
- *Cross-repo reach:* trustless-cello refs are `latest` dist-tag; the re-pin (T7) cannot resolve
  the new crypto until Andre promotes. Expected wait → interleave DOD-DOC-FUZZ-1 there (the
  procedure anticipates exactly this).
- *What breaks elsewhere?* The `LeafInput` union widening is additive — existing narrowing on
  `kind === "ctrl"` / `"hash"` keeps working; `buildMerkleTree`'s final `else` branch (msg) must
  NOT swallow the new kinds silently — implementation uses an explicit switch. The
  `SessionTreeLeafKind` widening touches `appendLeafHash` callers: all pass literals "msg"/"ctrl"
  today, no break.
- *Redundancy check:* the relay's allow-list and directory-frames' range check guard DIFFERENT
  trust boundaries (relay=submit-time, directory=carried-chain admission) — both stay.

### Decision (in-unit, journaled per T5)

- `answered` in seal legibility: document-operation (0x04) and rejection (0x05) leaves do NOT
  count as an answer to the final content message — only `msg` leaves do. Rationale: `answered`
  exists for the malicious-unanswered-tail question, a conversational property; a mechanical
  document delivery from the peer's daemon proves nothing about the agent replying. Test pins it.

---

## Entry 2 — 2026-08-04 — DOD-DOC-LEAF-1 client half IMPLEMENTED (review in flight)

**Status: IMPLEMENTED, NOT DONE.** The cello-client clauses are written and gate-green; the
unit reviewer is running on the diff as this is written, and its verdict is not yet in. The DoD
line stays ❌ until the verdict is quoted here.

**Commit:** cello-client `m14/leaf-1` @ e78ba0e (pushed). 12 files, +354/−25.

### What landed (C1–C8)

- **C1** `core/crypto/src/hashing.ts` — `DOC_LEAF = 0x04`, `REJECT_LEAF = 0x05`;
  `docLeafHash` / `rejectLeafHash` = SHA-256(prefix ‖ data), RFC 6962 §2.1 domain separation,
  beside `msgLeafHash`/`ctrlLeafHash`.
- **C2/C3** `core/crypto/src/merkle.ts` — `LeafInput` gains `doc`, `reject`, and
  `opaque{prefix,data}`. `buildMerkleTree`'s kind dispatch is now an **exhaustive switch**. The
  previous shape was `if ctrl … if hash … return msgLeafHash(data)` — a trailing default that
  would have silently hashed a new kind under the message domain. That is exactly the
  cross-type substitution domain separation exists to prevent, so the default had to go.
  `opaqueLeafHash(prefix, data)` is the §16.7-10 verifier tolerance: a tree walk that meets a
  kind byte this build does not know hashes it as opaque bytes instead of erroring. Prefix is
  validated 0–255 — a truncated byte would alias another domain.
- **C4** `core/daemon/src/session-relay-client.ts` — `LEAF_KIND_DOC` / `LEAF_KIND_REJECT`.
  No production consumer yet (the submitter arrives in P2), so they ship under the §5 seam
  exception with a **serialization pin test**: each wire byte reproduces its domain's leaf hash
  exactly (`opaqueLeafHash(LEAF_KIND_DOC, d) === docLeafHash(d)`), the four bytes are distinct,
  and neither collides with the RFC 6962 internal-node prefix `0x01`. The wire byte and the hash
  prefix are one agreement; if they drift, roots diverge silently.
- **C5/C6** `session-tree.ts` — `SessionTreeLeafKind` gains `"doc" | "reject"`, and
  `sessionTreeLeafKindFromDb` replaces the reload coercion at session-node-manager.ts:4376. The
  old line read `r.leaf_kind === "ctrl" ? "ctrl" : "msg"`. A stored `"doc"` would have come back
  as `"msg"` on the next daemon start — the tree would replay under the wrong domain, diverge
  from the counterparty's root, and no error would surface anywhere. The new mapper REFUSES an
  unrecognized value naming it (ABSENT IS NOT FINE).
- **C7** `session_seal_leaves` INTEGER `leaf_kind` — verified to pass 0x04/0x05 through with no
  coercion anywhere in the store; pinned by a new round-trip test rather than changed.
- **C8 Gates (cello-client, all four, in order):** `test` **2491 passed / 11 skipped, 230 files**
  · `lint` clean · `typecheck` clean · `build` clean. New crypto exports confirmed present in the
  BUILT artifact (`core/crypto/dist/index.d.ts:5`, `dist/hashing.js:48`), not just source.

### Test evidence (red-first observed)

- Crypto: 17 failures before implementation (missing exports), 126 passed after.
- Daemon: 2 failures before (`sessionTreeLeafKindFromDb` absent), then green; the
  `session_seal_leaves` round-trip test passed on first run, which is the correct result — it
  pins existing behavior (C7 is a claim to verify, not a change to make) and is labeled as such.
- Fixtures for both new domains are **independently computed** from Node native crypto inside
  the test (`SHA-256(0x04)` / `SHA-256(0x05)`) and cross-checked against the vector file, so a
  wrong fixture cannot make them pass. The vector-count guard was extended to cover the two new
  arrays — deleting a vector silently drops coverage without it.

### The one design call I flagged to the reviewer

`sessionTreeLeafKindFromDb` **throws** inside `#loadTreeFromDb`. Argument for: an unknown stored
kind means own-DB corruption or a downgrade below the writing build, and both must be loud —
silently relabeling is the worse failure by a wide margin. Argument against: throwing in a
reload path could turn one stale row into an unrecoverable daemon start. It is asked as an
explicit lens in the review dispatch; the verdict lands in Entry 3.

### Sequencing note (why the trustless-cello half is not in this commit)

The relay and directory changes import `docLeafHash`/`rejectLeafHash` from
`@cello-protocol/crypto`, which trustless-cello consumes from npm at the `latest` dist-tag —
never `workspace:*`. So the second half is blocked behind the publish cascade, and the publish
cascade's final step (the `latest` promotion) is Andre's alone. No client submits a `0x04` leaf
until P2/P3, so the wire-batching AC (relay allow-list ships BEFORE or WITH the first 0x04
client) is not yet at risk; it is enforced at DOD-DOC-SHIP-1.

---

## Entry 3 — 2026-08-04 — DOD-DOC-LEAF-1 client half REVIEWED; all findings applied

**Reviewer:** `cello-unit-reviewer`, one pass, no model override, read-only, on commit e78ba0e.

**Verdict, in its own words:**
> **SPEC: DEVIATIONS FOUND** — C6's refusal is a design deviation from the line's intent, resting
> on a rationale (root divergence) that the code contradicts. Not journaled. [blocking]
> **NO SILENT FALLBACKS** — the diff removes one … and adds none. The problem is the opposite:
> over-refusal (F2). **HOLLOW TESTS FOUND** [blocking] — the changed line at
> `session-node-manager.ts:4376` fails THE REVERT TEST … **REMOVALS PROVEN**.
> "Am I rubber-stamping? No — this diff touches crypto and persistence, and I found a real
> domain-separation hole (F1) and a real availability trade (F2) in exactly those places. F1 is
> the one I would not ship without fixing."

Per-clause: C1, C2, C4, C5, C7 **implemented** (C7's claim independently verified);
C3 **implemented with a domain-separation defect** (F1); C6 **deviated** (F2).

**Fix commit:** cello-client `m14/leaf-1` @ 2f5b8a1 (pushed). Four findings + both blocking
test findings, all applied. Nothing deferred.

### F1 (HIGH) — the seam's own hole. Real, and I missed it.

`opaqueLeafHash` accepted **any** byte 0–255 — including `0x01`, the RFC 6962 internal-node
domain. `nodeHash(l, r) = SHA-256(0x01 ‖ l ‖ r)` over two 32-byte children; a leaf submitted
with kind byte `0x01` and a 64-byte payload hashes to **exactly** the same bytes. That is
§2.1.3 tree-shape forgery: two differently-shaped transcripts — one with a message inserted or
hidden — can be made to root-match a sealed root, and the inclusion proof verifies.

The reviewer's argument for fixing it in the primitive rather than at the wire is the part I
want on the record: tolerance exists **precisely** to accept a byte the verifier does not
recognize, and in the trustless-cello half that byte is attacker-controlled input. The DoD's
stated mitigation there is `directory-frames.ts:746` "gains the range check" — and a 0–255
range check does not exclude `0x01`. The guard cannot live at the boundary; it has to live
where the hash is computed.

Fixed in `opaqueLeafHash`, with a test that **first proves the aliasing** (asserts the forged
64-byte leaf hash equals `nodeHash(left, right)`) and then asserts the refusal — so the test
would go green for the wrong reason if the domains ever stopped colliding.

### F2 (HIGH) — my design call was wrong, and the rationale I wrote for it was false

I wrote that relabeling an unknown stored kind "changes the domain the tree replays under,
which diverges the root." **It cannot.** `SessionTree.rootHex()` maps every leaf to
`{ kind: "hash" }` — the stored 32-byte hash already encodes its prefix, so the label never
reaches root computation. I verified this independently before acting: the *only* production
consumer of `SessionTreeLeafKind` is `content_leaf_count` at `session-read-handlers.ts:102`.

And the throw was worse than the thing it prevented. `#loadTreeFromDb` is reached through
`getSessionTree`, which throws **before** `#trees.set` (confirmed at session-node-manager.ts
:3062-3068) — so it repeats on every call, forever. `getSessionTree` gates send, receive,
`appendSessionLeaf`, the frontier check, `rootWithAppendedHex`, and both seal flows. One stale
row would have made a session permanently unsendable **and unsealable**, with no repair
command, to protect a display counter.

The unit had also adopted **tolerance in crypto and fatality in the daemon for the identical
question** — an old build meeting a kind a newer build wrote. Now consistent: an unrecognized
value reloads as `"unknown"`, the call site logs `session.tree.leaf_kind.unrecognized` with
agent/session/leafIndex/value, and `"unknown"` cannot be authored (`appendLeafHash` takes
`WritableSessionTreeLeafKind`, which excludes it by type). Loud without being an outage.

### F3 (MEDIUM) — the exhaustive switch had no `default`

Exhaustiveness over `LeafInput` is compile-time only, and the trustless-cello rebuild sites map
`l.kind` off decoded wire/persisted state. Without a `default`, an invalid runtime value put
`undefined` into hash math — surfacing inside `nodeHash` as a length error naming nothing, and
pointing at the wrong subsystem. Now throws naming the kind, the index, and the remedy
(`use { kind: "opaque", prefix }`), while keeping `never`-narrowing.

### The two blocking test findings

- **The changed line had no test.** Reverting `session-node-manager.ts:4376` to the old
  coercion left **every test in the diff green** — the mapper was tested directly, the
  substitution at the call site was not. Added a restart-reload test in
  `daemon-004-ipc.test.ts` on the existing AC-007 pattern: append `msg`/`doc`/`reject`, stop the
  daemon, restart over the same `celloDir`, assert the labels survive the reload and that
  exactly one leaf counts as content. **Verified red under the reverted line** before keeping it.
- **C7 renamed** to `(characterization) leaf_kind INTEGER already round-trips 0x04/0x05 — no
  coercion to add`. It pins existing behavior rather than proving a fix, and the name now says
  so instead of a comment.

### F4 (LOW) — fixture-file churn

My JSON rewrite had re-encoded every pre-existing em dash as `—` — 20 unrelated changed
lines that would have misdirected `git blame` on the M0 vectors. Reverted the file and inserted
the four fixtures surgically; the diff is now +24 lines, nothing else touched.

### Noted, not actioned (correctly out of scope)

- `core/crypto/src/index.ts:30,78-79` exports `MockThresholdSigner`, `makeTestManifest`, and
  `TEST_DIRECTORY_NODE_KEYPAIR` from the **production** barrel with no `NODE_ENV` guard. A mock
  signer one wiring slip from forged-but-valid output. Pre-existing, outside this diff — logged
  here so it is not lost. **Candidate for its own unit.**
- `opaque` has **no reachable production path inside cello-client** — `rootHex()` uses
  `kind: "hash"` for everything, so the client never needs the prefix. That is correct, not a
  gap: the pre-hashed leaf makes tolerance free on this side. Its consumer is the
  trustless-cello half.
- **Two sites, same byte, opposite correct answers** (to be named explicitly in the P2 commit
  so a later reader does not "harmonize" them): `seal-unilateral-verify.ts` must **reject** an
  unknown byte because it is authorizing a seal; a pure root **recomputation** must **tolerate**
  it via `opaque`.

### Gates after fixes (cello-client, all four, in order)

`test` **2496 passed / 11 skipped, 230 files** · `lint` clean · `typecheck` clean · `build` clean.

### Status

Client half is **DONE** (written AND reviewed, findings applied, gates green). The DoD line
DOD-DOC-LEAF-1 stays **❌** because the trustless-cello half has not been built — it is one
line, not two, and it does not flip until both repos are green. Next: the publish cascade
(`/cello-publish`, loaded for THAT publish), which the trustless-cello half compiles against.
