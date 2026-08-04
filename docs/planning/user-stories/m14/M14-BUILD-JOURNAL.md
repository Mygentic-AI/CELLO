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

- **Current unit:** DOD-DOC-LEAF-1 (in progress — Entry 1)
- **Branches:** `m14/leaf-1` in cello-client (to create); trustless-cello work follows after
  crypto publish
- **Next red after this:** DOD-DOC-FUZZ-1
- **Parked/waiting:** nothing yet
- **HEAD:** trustless-cello `main` @ 44bff9fc (docs ahead of that as committed)

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
