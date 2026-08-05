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

- **Current unit:** DOD-DOC-LEAF-1 — BOTH halves built. Client half done, merged, published,
  promoted. Server half implemented + pass-one findings fixed (Entry 5). **Review pass TWO is in
  flight** — the line does not flip until its verdict is quoted here.
- **Nothing is blocked.** Andre ran the `latest` promotion; all seven packages verified resolving,
  both installed binaries match (cli 0.0.123, connect 0.0.117).
- **Next after this unit closes:** merge `m14/leaf-1-server`, flip DOD-DOC-LEAF-1 to ✅, then
  DOD-DOC-FUZZ-1 (branch `m14/fuzz-1` already created; Yjs facts measured in Entry 4).
- **Published + promoted to `latest`:** crypto 0.0.39 · protocol-types 0.0.41 · transport 0.0.43 ·
  daemon 0.0.120 · cli 0.0.123 · connect 0.0.117 · gateway 0.0.23 (unbumped). Tag `v0.0.180`.
- **Review budget:** pass two is the HARD CAP for this unit. Anything surviving it becomes an AC
  on a later unit — never a third pass.
- **HEAD:** trustless-cello `m14/leaf-1-server` @ 2ea07d90 · cello-client `main` @ 288c8b8

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

---

## Entry 4 — 2026-08-04 — Publish cascade STAGED and verified; `latest` promotion awaits Andre

`/cello-publish` loaded for THIS publish (not carried from earlier in the session).

**Merged first:** cello-client `m14/leaf-1` → `main` (`--no-ff`), because the client half is
reviewed-green and a publish must come from main. The DoD line is still ❌ — merging a reviewed
unit and closing a DoD line are different acts.

### The cascade, and two corrections to the skill's package list

Computed from the actual `dependencies` of each `core/*/package.json` rather than the skill's
prose list, which is stale in two ways worth recording:

- **`@cello-protocol/client` no longer exists** as a package — there is no `core/client`
  directory. `client@0.0.50` sits on npm as an artifact of its last publish. The skill's step-5
  and step-6 loops still name it.
- **`gateway` is in CI's publish list but absent from the skill's.** CI publishes seven:
  crypto, protocol-types, transport, **gateway**, daemon, cli, adapter-claude-code(connect).
  `.github/workflows/ci.yml:285-291` is the authority.

| package | was | published |
|---|---|---|
| crypto | 0.0.38 | **0.0.39** |
| protocol-types | 0.0.40 | **0.0.41** |
| transport | 0.0.42 | **0.0.43** |
| daemon | 0.0.119 | **0.0.120** |
| cli | 0.0.122 | **0.0.123** |
| connect | 0.0.116 | **0.0.117** |
| gateway | 0.0.23 | *unbumped* |

`gateway` was left alone deliberately: it declares **no** CELLO dependency (`re2-wasm` only) and
had no source change, so a bump would republish byte-identical content and buy nothing. Every
package that transitively depends on crypto **was** bumped, satisfying the cascade invariant.

### Tag drift, confirmed again

Highest existing tag was **`v0.0.179`** while connect was at **0.0.116** — a 63-version gap. The
tag is a monotonic CI trigger and nothing more. Took the next free counter, **`v0.0.180`**, and
verified it was unused before pushing. Deriving the tag from any package version would have
collided.

### CI (run 30931111833, tag `v0.0.180`) — all green

`Build and Test: success` → `Publish (tag release): success` → `Published-artifact smoke test
(tag): success`. Both cross-repo E2E gate jobs `skipped` (they are `if: false` — the disabled
OIDC path, expected).

### Verified against the BINARIES, not the CI status

- `npm pack @cello-protocol/crypto@0.0.39` → `dist/hashing.js` exports `docLeafHash`,
  `rejectLeafHash`, `opaqueLeafHash`; the **F1 internal-node guard** is present in the shipped
  file (`grep "internal-node domain"` → 1); `dist/merkle.js` carries the F3 default case
  (`grep "unrecognized leaf kind"` → 1). The security fix is in the artifact operators get, not
  just in main.
- `npm pack @cello-protocol/daemon@0.0.120` → `dist/session-tree.js` and
  `dist/session-node-manager.js` both carry `sessionTreeLeafKindFromDb`, and the log event
  `session.tree.leaf_kind.unrecognized` ships in `session-node-manager.js`.
- **Cross-pins are real versions, no `workspace:*` anywhere:** cli→daemon `0.0.120`,
  connect→crypto `0.0.39` + transport `0.0.43`, daemon→crypto `0.0.39` + gateway `0.0.23` +
  transport `0.0.43` + protocol-types `0.0.41`.

### BLOCKED — the one thing that is not mine

The `latest` promotion is operator-run (Andre), always. Until it runs, `trustless-cello` cannot
resolve the new crypto from the `latest` dist-tag, so **T1–T7 (the relay/directory half of
DOD-DOC-LEAF-1) stay blocked** and the DoD line stays ❌. Per [[M14-PROCEDURE]] §3a this is a
park-and-work-another-line, not a stop: DOD-DOC-FUZZ-1 (P0, no cross-repo dependency) is picked
up meanwhile on branch `m14/fuzz-1`.

The exact command set is prepared and handed over; it is not run here.

### Yjs dependency facts (measured now, consumed by DOD-DOC-FUZZ-1)

From the npm registry, not from memory: `yjs@13.6.32` — 2.31 MB unpacked, 135 files, exactly one
dependency (`lib0@0.2.117`, 2.41 MB, which depends only on `isomorphic.js@0.2.5`, 4.9 KB). Total
three packages, ~4.72 MB unpacked. **No `install`, `preinstall`, or `postinstall` script in any
of the three** — pure JS, no native compile, so it adds no build step to an operator's install
(heavy-local-node doctrine: the cost is download size, not compile time). Engine floor
`node >=16`, well under the project's Node 24.

---

## Entry 5 — 2026-08-04 — DOD-DOC-LEAF-1 server half: built, reviewed, three blocking findings fixed

**Unblocked by:** Andre's `latest` promotion. Verified all seven packages resolve and both
installed binaries match (`cli` 0.0.123, `connect` 0.0.117) before starting.

**Branch:** `m14/leaf-1-server` — 7fb09780 (implementation) → 2ea07d90 (review fixes). Both pushed.

### What the server half does (T1–T6)

- **T1/T2 relay.** `RELAY_LEAF_KINDS` (byte→domain) and `RELAY_LEAF_HASHERS` (domain→hash fn) in
  `relay-types.ts` are the single registry; `relay-node.ts` reads both. The relay computes leaf
  hashes ITSELF from the kind byte, so admitting a document leaf needed the allow-list AND the
  hash map — two copies of that pairing is exactly how a wire byte and a hash domain drift apart.
  `0x01` is absent by construction and asserted absent by test. AC-008's guard test is AMENDED
  (0x04/0x05 out of the invalid set, 0x06 added, 0x01 retained).
- **T3 directory.** `seal-unilateral-verify` mapped every non-`0x02` byte to `"msg"`. It now
  refuses what it cannot name (`unilateral_leaf_kind_unknown`) — deliberately the OPPOSITE of
  crypto's tolerant `opaque` kind, because this site AUTHORIZES a seal while that one only
  recomputes a root. Same byte, two sites, two correct answers; both commits say so out loud.
- **T4** `directory-frames` gains a shape-level one-byte range check that deliberately does NOT
  duplicate the meaningful-byte set.
- **T5/T6** covered by the two defects below plus the `RelaySealLeafKind` widening.

### Two real defects found by the new tests, before review

1. **A peer's document leaf marked a malicious unanswered tail as `answered`.** Document updates
   arrive mechanically from the peer's daemon with no agent involved, so this let a daemon satisfy
   the unanswered-tail check on its operator's behalf — the precise property `answered` exists to
   expose.
2. **A document leaf broke the trailing-ceremony walk**, downgrading both live sealers to `absent`.

My first fix for (1) excluded everything except `msg` and broke AC-004's deliberate "a lone
trailing ctrl leaf counts as a reply" property. **The existing test caught it.** Narrowed to
`doc`/`reject` only. Worth remembering: the falsification step belongs BEFORE the edit, not at
the test run.

### Review pass one — three blocking findings, all real, all fixed in 2ea07d90

Reviewer's own summary: *"I do not think I am rubber-stamping this one."*

- **F1 — a valid bilateral seal could be destroyed by an unrelated background sync.**
  `verifySealLeaves` matched the ceremony POSITIONALLY (last two must be ctrl). Reachable, not
  theoretical: the relay flips a session out of `active` only once BOTH ctrl leaves exist
  (`relay-node #maybeSubmitBilateralSeal`), so while the first SEAL is outstanding a document
  submit is still accepted — giving `[msg(A), ctrl(A), doc(B), ctrl(B)]`. Reproduced end-to-end
  through `processSeal` (`seal_leaves_invalid`) before fixing. The same positional assumption
  derived the seal INITIATOR as `leaves[length-2]` → wrong party named, wrong `primary_pubkey`
  resolved for the FROST ceremony. Both now read `findSealCeremonyPair`, which locates the pair
  BY KIND. Reviewer's note on the error string is the durable lesson: `seal_leaves_invalid` names
  *where the check fired*, not why, and nothing logged the document leaf — an operator would go
  hunting for a broken SEAL ceremony or a malicious client.
- **F2 — the same positional assumption in `sealCeremonyLeafIndices`** would have reopened the
  malicious-tail hole the moment F1 was fixed (with a doc leaf present it excluded nothing, so the
  counterparty's own SEAL leaf satisfied `answered`). Latent ONLY because F1 rejected those seals
  first. Now shares the one helper. Load-bearing beyond display: `answered` is folded into the
  FROST-signed seal TBS via `bindLegibilityToTbs`, so a wrong value is SIGNED and the client's
  independent re-derive diverges.
- **F3 — a silent drop this milestone's own crypto bump created.** `seal_submission`'s leaf `kind`
  was a raw `as` cast off `/cello/directory-relay/1.0.0`, which authenticates only
  `relay_register` — and `kind` selects the HASH DOMAIN. Two holes: `LeafInput`'s `kind: "hash"`
  uses its data AS the leaf hash with no domain prefix (the one ingress that bypasses domain
  separation entirely), and `buildMerkleTree` now THROWS where crypto 0.0.33 silently coerced —
  a throw that landed in `catch { stream.close() }` with no log and no error frame. Now validated
  before Merkle reconstruction (`validateSealSubmissionLeaves`, one bad leaf voids the whole
  submission) and the catch logs `directory.relay.admin_stream.failed`.

**Also caught by review:** my re-pin claim was FALSE. The commit said protocol-types 0.0.41 /
transport 0.0.43; the lockfile still resolved 0.0.35 / 0.0.37 because my last surgical update
named only crypto. All four are now correct. Lesson: verify the lockfile, do not restate intent.

### The `@types/node` incident (self-inflicted, worth keeping)

My first re-pin used `pnpm update --latest`, which dragged `@types/node` 25.6.2 → 26.1.2 while
25.6.2 remained elsewhere. Two copies produce `IncomingMessage is not assignable to
IncomingMessage` at every `node:http` call site. I could not tell from a `git stash` whether it
pre-existed (stashing reverts the lockfile but NOT `node_modules`), so I restored the baseline and
MEASURED: even a single-package `pnpm update` re-resolves that floating range. Fixed with a
`pnpm.overrides` pin — the mechanism this repo already uses for `@libp2p/interface` — documented
under a top-level `"//"` key (pnpm REJECTS non-selector keys inside `overrides`), including the
warning that it wins silently over four packages' declared `^25.6.2`.

### Hollow tests I wrote, and the one that taught me something

Pass one found four tests that passed on reverted code. The instructive one: my
"each leaf kind produces a DIFFERENT root" test built a FRESH fixture per kind, so the roots
differed because the SESSIONS differed (genesis_prev_root folds in session_id) — it passed with
every kind mapped to `msgLeafHash`.

Rewriting it surfaced a real structural fact: **the relay computes a root by two different
routes.** The incremental `running_root` uses `RELAY_LEAF_HASHERS` and is folded into every
Structure2's `prev_root` — the value the parties SIGN. `getSealLeaves` REBUILDS the root with
`buildMerkleTree` from the kinds. A test asserting the rebuilt root does not exercise the
incremental path at all. So the new test asserts the **signed `prev_root` of a following leaf**,
which is the one that catches an all-`msgLeafHash` registry. Verified: the rebuild-based
assertion passes under that bypass; the `prev_root` one fails.

The three legibility tests each asserted the SAFE half of their property (a party stays `absent`)
and so passed on reverted code; they now assert the half at risk (a party stays `live`). H6 was
re-pointed from an unreachable shape (doc AFTER both ctrls — the relay is already sealing) to the
reachable one (doc BETWEEN). Every rewritten test verified red on revert.

### Gates (committed tree, both repos)

trustless-cello: `test` **1253 passed / 531 skipped / 7 todo, 124 files** · `lint` clean ·
`typecheck` clean (no `build` script in this repo — `typecheck` IS `tsc --build`).
cello-client: unchanged since the published 288c8b8.

### Status

Server half is IMPLEMENTED and fixed; **review pass two is in flight** and this line does not flip
until its verdict is quoted. Pass two is the HARD CAP — anything surviving it becomes an AC on a
later unit, never a third pass.

---

## Entry 6 — 2026-08-04 — DOD-DOC-LEAF-1 ✅ CLOSED (both repos, two review passes)

**Merged:** `m14/leaf-1-server` → `main` (efcfb117). cello-client half merged earlier (9903731).
**DoD line flipped to ✅.** Review budget for this unit is SPENT — two passes, the hard cap.

### Pass two's verdict, in its own words

> **Blocking for this unit: F-A only.** It is the same defect class F1 was written to close, on
> the more common kind byte, and the fix that closes it is a variant of the helper the commit
> already introduced. … I do not think this is a rubber stamp: the diff touches seal
> verification, FROST initiator resolution and an unauthenticated crypto ingress, and I found a
> live seal-destroying condition the fix's own rationale covers but its implementation does not.

### F-A — the lesson of this unit

My fix for pass one's F1 **reintroduced F1 on a different kind byte.** `findSealCeremonyPair`
broke its backward walk on a `msg` leaf, so `[msg, ctrl, msg, ctrl]` found one ctrl leaf and the
seal was rejected. And that shape is *commoner* than the document one it fixed: the relay keeps a
session `active` until BOTH ctrl leaves exist, so a message the peer had already queued before it
saw the first SEAL lands between them. An ordinary in-flight crossing destroyed a valid seal.

**Root cause: I unified two questions that need opposite answers.** "Which leaves are the
ceremony" must be transparent to everything in between. "Who is live" must NOT be — a ctrl leaf
sitting behind a content message is a stale seal attempt, not a contemporaneous acknowledgement.
One walk cannot serve both, and sharing it is what produced the bug. They are separate now, and
the comment on each says why it is not the other.

The generalisable form, worth carrying into P1/P2: **when a fix consolidates several call sites
onto one helper, the helper inherits the semantics of whichever site it was extracted from.**
Extracting from the liveness walk gave verification the liveness rule. Ask, per consumer, whether
the shared rule is actually its rule.

### Also fixed in pass two

- **F-C** — `verifySealLeaves` now requires the ceremony to CLOSE the log. An honest relay cannot
  append after the second SEAL leaf (already `sealing`), so a trailing leaf means a crafted
  submission — and each one would otherwise be folded into the FROST-notarized root while bound
  to nothing in the ceremony.
- **F-D** — the `answered` exclusion covered only the matched pair, so a RETRIED SEAL leaf from
  one party (the relay adjudicates only once senders are distinct; nothing dedupes the extra)
  still marked a malicious unanswered tail as answered. Now every ctrl leaf in the closing region
  is excluded — **but only when a bilateral pair exists**, because AC-004 deliberately counts a
  LONE trailing ctrl as a reply. Both halves pinned by test.
- **F-E** — deleted the unreachable positional fallback in the initiator derivation. It silently
  revived the exact rule this unit removed.
- **F-F** — the relay-admin catch logged but sent no error frame, so the relay reported
  `no_response` and re-dialled another directory that failed identically. Half of F3's fix was
  missing; it now returns `seal_processing_failed` with the detail.
- **F-B** — deleted two stale comments still asserting "the last two leaves are both ctrl".
  That sentence is how the positional assumption survived in three places.

### Carried forward as a new parked DoD line — DOD-DOC-SEALAUTH-1

Pre-existing, outside this unit, and NOT a document concern — but it is why F-C had to refuse
trailing leaves rather than tolerate them:
1. `seal_submission` on `/cello/directory-relay/1.0.0` is accepted from **any dialer** — only
   `relay_register` authenticates that stream.
2. `leaves[0].s2.prev_root` is taken as the genesis anchor **unvalidated**, so a dialer who has
   observed a session's leaf log can submit a self-consistent **suffix** of it as a seal.

### A test-count scare worth recording

A full-suite run mid-session reported **135 files / 1040 tests** against a baseline of **159 /
1253** — 24 files apparently uncollected, which would mean my relay changes were never exercised.
Investigated rather than re-run-and-hope: `vitest list` returned an **identical 124-file set**
with and without my changes, and two consecutive full runs then reported 159 / 1256 / zero
failures. So the collected set never changed. The anomalous run took **96s vs 37s**, which points
at resource contention (a review subagent and a `pnpm install` were running alongside it) — but
that cause is inference, not proof. What IS established: the file set is identical and the suite
is green. Recorded because "the count dropped" is exactly the signal that should never be
waved away.

### Final gates

trustless-cello: `test` **1256 passed / 531 skipped / 7 todo, 124 files** (twice, stable) ·
`lint` clean · `typecheck` clean.
cello-client: `test` 2496 passed · lint · typecheck · build clean (at the published 288c8b8).

### Next

**DOD-DOC-FUZZ-1** on cello-client `m14/fuzz-1` — Yjs added to the daemon, the hostile-input
measurement pass written (garbage, every prefix of a valid update, every single-byte corruption,
a maximal varint, 2000-deep nesting), each case classifying returned/threw/**hung** because a
hang is the one failure mode `cap, catch, contain` cannot contain. Not yet run.

---

## Entry 7 — 2026-08-04 — DOD-DOC-FUZZ-1: Yjs hostile-input measurement (review in flight)

**Branch:** cello-client `m14/fuzz-1` @ 6a8ba6b (pushed). **Status: IMPLEMENTED, not DONE** —
the unit reviewer is running; the DoD line stays ❌ until its verdict is quoted.

### Why this unit exists

§16.7-7's posture is **cap, catch, contain**: a pre-parse size cap before Yjs sees the bytes, a
wrapped apply so a malformed update becomes an ordinary rejection, structural limits on the
shadow. That posture is sound **only if** `Y.applyUpdate`'s real failure mode is a THROW. A
crash, a hang, or unbounded allocation are not containable by a try/catch — and the receive path
is reached by peer-controlled bytes with no agent in the loop. So the DoD made measuring this a
precondition of designing the gate around it.

### Measured — yjs 13.6.32, not assumed

| Hostile shape | Outcome |
|---|---|
| Random garbage, 2000 trials, 1–64 bytes | **2000/2000 threw.** Zero silently accepted |
| Every prefix of a valid 35-byte update (35 cuts) | **35/35 threw** |
| Every single-byte corruption of a valid update | contained, no hang |
| Maximal 10-byte varint claiming a huge length | neither hung nor allocated (heap bounded) |
| 2000-deep nested maps | **applied successfully in 2ms** |
| Anything | **nothing hung** |

**Verdict on §16.7-7: the posture holds.** Throws are the failure mode; a try/catch contains
them. No sandbox process needed for V1, as the spec assumed — now measured rather than hoped.

### Two findings that become DOD-DOC-GATE-1 ACs

1. **The gate needs a FLOOR, not just a cap.** An empty or one-byte update throws
   `Unexpected end of array` — a *decoder* error naming Yjs internals, not a protocol fault. The
   minimal valid update is **two bytes** (`[0,0]`, the empty encoded state). Without a floor, a
   peer sending an empty update gets a quarantine reason that means nothing to its operator, and
   the no-silent-drop record carries Yjs's wording instead of ours.
   *My test originally asserted empty was a no-op. The measurement corrected me* — which is the
   point of measuring rather than reasoning about it.
2. **Depth is entirely the gate's job.** Yjs does not reject nesting depth at all: 2000 levels
   applied in 2ms. And the size cap does **not** bound depth usefully — 2000 levels cost 23,880
   bytes (~12 bytes/level), so a 1 MiB update carries roughly **87,000 levels**. §16.7-6's
   "nesting depth" limit is therefore load-bearing, not a nicety, and its default must be chosen
   against this measurement.

### Yjs dependency facts (recorded once, heavy-local-node doctrine)

Three packages total: `yjs@13.6.32` (2.31 MB unpacked, 135 files) → `lib0@0.2.117` (2.41 MB) →
`isomorphic.js@0.2.5` (4.9 KB). **~4.7 MB unpacked, and NO `install`/`preinstall`/`postinstall`
script in any of the three** — pure JS, no native compile. The operator cost is download size
only; it adds no build time to `npm install`, which is the constraint that actually matters for a
locally-installed node.

### Open question handed to the reviewer

`classify()` measures wall-clock against a budget and reports `"hung"` — but a genuinely hung
`Y.applyUpdate` would block the event loop and never return, so `classify` may be **incapable**
of reporting a hang, making those assertions decorative and the vitest timeout the real
protection. Asked explicitly. If confirmed, the hang claims in this entry need weakening to
"no case exceeded its budget", and the honest protection is the suite timeout.

### Gates (cello-client, all four)

`test` **2508 passed / 11 skipped** · `lint` clean · `typecheck` clean · `build` clean.

---

## Entry 8 — 2026-08-04 — DOD-DOC-FUZZ-1 reviewed: Entry 7's conclusion was INCOMPLETE

**Commit:** cello-client `m14/fuzz-1` @ bde087a (pushed). Review pass ONE of two.

### ⚠️ Entry 7 is superseded on its central claim

Entry 7 concluded: *"the posture holds — throws are the failure mode; a try/catch contains
them."* That is true of the shapes I fuzzed and **materially incomplete**. I measured the THROW
class and declared the posture sound. The class that actually defeats it is the **ACCEPT class**:
`Y.applyUpdate` returns *normally* for input it cannot integrate.

Reviewer, verbatim: *"the shapes tested exclude the class that actually defeats cap, catch,
contain, and the assertions do not pin any of the headline numbers."* Both halves were right.

### The finding that changes the gate's design

An update whose dependencies the receiver lacks **does not throw**. It returns `ok`, contributes
nothing, and is **retained in `doc.store.pendingStructs`** awaiting predecessors that may never
arrive. Measured: 49 well-formed, sub-cap updates — every one accepted, zero content, all
retained. A peer streams these until the daemon dies.

**All three legs of §16.7-7 pass this input.** The size cap sees a small update. The try/catch
sees success. "Structural limits checked on the shadow" has nothing to check, because the shadow
is *empty*. This is not a gap in the implementation of the posture; it is a gap in the posture.

Three more accept-class shapes, each measured and each now a GATE-1 AC:
- **No document identity.** A valid update for a DIFFERENT document merges silently. Binding an
  update to its document is entirely out-of-band work the gate must do.
- **Silent format confusion.** V2-format bytes are accepted by the v1 decoder and drop all
  content, no error either way.
- **The encoding is MALLEABLE.** Trailing bytes past the decoder's cursor are ignored, so
  unlimited byte strings map to identical document state. **This touches DOD-DOC-LEAF-1, which
  I closed earlier today:** a `0x04` leaf over *received bytes* is not a canonical commitment —
  a peer can pad an update to change its leaf hash without changing the document, and two honest
  peers holding identical state can produce different leaves. The fix belongs in GATE-1/
  ENVELOPE-1 (hash the re-encoded shadow state; reject trailing bytes), not in the leaf registry,
  so LEAF-1 stays ✅ — but the property it was assumed to have is weaker than assumed.

### My assertions were the other half of the problem

`expect(typeof res.ok).toBe("boolean")` is a tautology the type system already guarantees — and
it was the ONLY containment check in the garbage, all-zero and truncation tests. So **neither
headline number in Entry 7 was actually asserted**, and a Yjs that silently accepted garbage —
the single worst reversal for a shadow-apply gate — would have kept the file green. They now
count outcomes and assert totals, on a fresh document per trial (the old one reused a single doc
across 120 trials, so contamination was never checked either).

### Three detectors that could not fire, now fixed

- **`classify()` could never report a hang.** `Y.applyUpdate` is synchronous, so a true infinite
  loop never returns and the function's own clock read is unreachable. My Entry 7 suspicion was
  right and the file's comment claimed the opposite. Renamed `classifyWithBudget` → `"slow"`, the
  header states plainly that only the per-test timeout catches a real hang, and timeouts dropped
  120s → 15s so it fires fast instead of four minutes late and unattributed.
- **The allocation bound measured the wrong counter.** `heapUsed` EXCLUDES typed-array backing
  stores — verified: a 200 MiB `Uint8Array` moves it by **0.0 MiB** while `arrayBuffers` moves by
  200. A decoder doing `new Uint8Array(hugeLength)` — precisely the amplification the test is
  named for — was invisible to it. Now measures `arrayBuffers + external`.
- **The depth test asserted "returned or threw"**, so a future Yjs that recursed and blew the
  stack would throw a catchable `RangeError`, read as "threw", and stay green — swallowing the
  exact receive-side stack-exhaustion reversal. It now asserts success and **walks all 2000
  levels** so "applied" means more than "did not error".

### Numbers corrected

- `validUpdate()` is **84 bytes**, not the 35 Entry 7 recorded. That 35 came from a throwaway
  measurement script using a smaller document than the committed helper — a real discipline
  failure: I journaled a number from a different artifact than the one I shipped. Now pinned by
  assertion so drift breaks the build.
- The reviewer and I disagree on the 2000-deep update: it reports 31,880 bytes, I measure
  **23,880** directly, twice. Both of us are ~an order of magnitude from mattering — the point is
  that depth is cheap in bytes (≈12 B/level here, so ~87k levels per MiB) — but the disagreement
  is recorded rather than smoothed over, and the test now pins `< 40,000` so either way a drift
  is caught.

### Benign shapes, recorded so the coverage question is closed

500,000-character single string: applies in ~0 ms. 5,000 distinct clientIDs: applies in 3 ms
(20,000 applies in 12 ms but takes ~31 s to *construct*, which is test cost, not receive cost —
the fleet size is chosen for construction and only the apply is timed).

### `yjs` moved to devDependencies

Its only importer is this test file. Shipping 4.7 MB to every operator for a gate that does not
exist yet fails **no consumer, no ship**. It returns to `dependencies` when DOD-DOC-GATE-1
imports it.

### Gates

cello-client: `test` **2512 passed / 11 skipped** · `lint` · `typecheck` · `build` all clean.
Fuzz suite alone: 16 tests, 2.3 s (was 36 s).

### Status

**IMPLEMENTED, not DONE.** One review pass used; one remains (the cap). The DoD line stays ❌
until a verdict is quoted.

---

## Entry 9 — 2026-08-04 — DOD-DOC-FUZZ-1 ✅ CLOSED (two review passes, the cap)

**Merged:** cello-client `m14/fuzz-1` → `main` (746fc4f). Review budget SPENT.

### Pass two's verdict, in its own words

> **HOLLOW TESTS FOUND** — F2 and F6 fail the revert test outright; F1 fails it in the opposite
> direction (it goes red when nothing broke); F4 leaves the file's headline claim unasserted. …
> I am not rubber-stamping — the two hollow tests are in the two places the unit's entire value
> sits.

### The finding I would have shipped: a FALSE claim behind a FLAKY test

Entry 8 recorded "random garbage is ALWAYS rejected". **False.** About **1 in 100,000** random
buffers is ACCEPTED — any buffer starting `00 00` is a valid EMPTY update whose remaining bytes
are ignored **as trailing bytes**. This file's own trailing-byte finding falsifies its own
garbage finding, and only the rarity of the prefix hid it.

Worse than wrong: **flaky**. `expect(rejected).toBe(total)` over 120 trials goes red roughly
**1 CI run in 650** with nothing broken — and it would have been read as noise, not as the
finding. A flaky assertion guarding a false claim is the worst of both.

The true property is **containment, not rejection**: garbage may be accepted, but it never
contributes CONTENT. That is now what is asserted (three buckets: rejected / accepted-inert /
accepted-with-content, the last pinned at zero), and "accepted-but-inert" is recorded rather
than denied.

### The 23,880 vs 31,880 disagreement: RESOLVED — we were both right

Pass one measured 31,880 bytes for the 2000-deep update; I measured 23,880, twice, and recorded
the disagreement rather than smoothing it. Pass two found the cause: **the size is a function of
the document's random clientID.** Every item's parent reference encodes the clientID as a
varint, so a 1-byte clientID gives 23,880 and a 5-byte one gives 31,880. Yjs mints a random
uint32, so **production effectively always sees the 5-byte case** (a random uint32 is <128 with
probability ~3e-8). My figure came from a pinned small clientID — i.e. from a document
production will never produce.

**This had already propagated into GATE-1's AC (f)**, which said ~12 B/level and ~87k levels per
MiB. Corrected to **~16 B/level, ~65k levels**, with the reason recorded so nobody re-derives the
optimistic number. The test now pins the clientID and asserts the exact byte count.

*The lesson: recording a disagreement instead of resolving it is better than smoothing it over,
and worse than finding out why. Two measurements that differ are a fact about the SYSTEM.*

### An AC that implied completeness it did not have

Pass two found two more accept-class shapes, one of which **falsifies AC (a) as I wrote it**:

- **Colliding clientID.** Yjs identifies authorship by clientID alone. An attacker writing under
  a client's ID silently wins, and the honest client's real update is then accepted-and-dropped.
  The result is a **splice of two authors who never collaborated** — measured: the honest update's
  overlapping clock range is discarded and only its TAIL survives, appending a stray character to
  the forged text. **`pendingStructs` is `null` throughout**, so AC (a)'s pending-set rule cannot
  see it at all. AC (a) now says what it does not cover, and AC (h) requires binding the clientID
  to the peer's identity out of band.
- **Delete-everything.** A **10-byte** well-formed update wipes a document's entire content.
  Structural limits are UPPER bounds, so a shrinking update passes all of them. Now AC (i) —
  `append_only` needed a measurement behind it, not just an intention.

### Three more of my own assertions that could not fire

- The allocation test **never reached the allocation path**: `ff×9 7f` throws in the varint
  decoder in 0 ms, so no length is produced. A lib0 that dropped its length bounds-check would
  have kept it green. Now also sends a well-formed update declaring an in-range 1e8 string length
  — the amplification a hostile peer actually sends — and lib0 does bounds-check it.
- **Retention — the DoS claim itself — was unasserted.** `pendingStructs.missing` is keyed by
  client and there is one source client, so `missing.size` is always 1. Now measures that the
  retained buffer GROWS (61 bytes after 5 updates, 415 after 49).
- **Idempotence compared the document to itself**, so a first apply that silently did nothing
  would have passed. Expected values pinned.

### Carried to GATE-1 / ENVELOPE-1 (not a third pass — the cap is on REVIEWS, not on fixing)

Everything above was FIXED, not carried. What remains is genuinely downstream: `docLeafHash` now
carries a **preimage contract** in its doc comment — `data` must be re-encoded canonical state,
never received bytes — because the malleability finding means a leaf over received bytes is not a
canonical commitment. LEAF-1 stays ✅ (pass two agreed: LEAF-1 defines leaf KINDS and the
domain-separated hash; the preimage is the producer's choice, and the producer has not shipped).

### Final state

`test` **2514 passed / 11 skipped** · `lint` · `typecheck` · `build` clean. Fuzz suite: 18 tests,
2.6 s. GATE-1 now carries **nine measured ACs** (a)–(i) that it would otherwise have been built
against as assumptions.

### Next

**DOD-DOC-STORE-1** — the SQLCipher document store (three tables, append-only envelope log,
snapshot rebuildable from the log). The existing store pattern to follow is
`core/daemon/src/trust-signal-store.ts` (idempotent `CREATE TABLE IF NOT EXISTS`, `DaemonDatabase`
injected, no `node:sqlite`).

---

## Entry 10 — 2026-08-04 — DOD-DOC-STORE-1 opened: clause checklist + falsification

**Branch:** cello-client `m14/store-1`. **Target (one sentence):** the daemon can durably record
a document, its append-only envelope log, and a materialized Yjs snapshot — and can throw the
snapshot away and rebuild it byte-identically from the log alone.

### Clause checklist

- [ ] S1. New module `core/daemon/src/document-store.ts`, following `trust-signal-store.ts`:
      idempotent `CREATE TABLE IF NOT EXISTS`, injected `DaemonDatabase`, **no `node:sqlite`**.
- [ ] S2. `documents` — `document_id` (PK), peer `agent_id`, properties, status.
- [ ] S3. `document_envelopes` — APPEND-ONLY: hash, signature, `doc_prev_hash`, `epoch_id`,
      state vector, `payload` **NULLABLE** (purge-ready, §16.7-12). Withdrawal and rejection
      records are ROWS here, never edits to existing rows.
- [ ] S4. `document_snapshots` — Yjs binary + state vector + **last-applied envelope index**
      (§14: "with them it is a lookup", without them rebuilding means working out from scratch
      where the snapshot sits relative to the log).
- [ ] S5. Keyed on `agent_id`/`document_id` ONLY. `agent_name` appears nowhere — not in a PK,
      a JOIN, or a WHERE (repo rule; the M7 tables' `agent_name` joins are a known defect,
      `DOD-AGENT-ID-JOINKEY-1`, not a precedent).
- [ ] S6. **Snapshot rebuildable from the log** — proven by deleting the snapshot, rebuilding,
      and getting a BYTE-IDENTICAL Yjs state + state vector.
- [ ] S7. Per-sender `doc_prev_hash` chain verification on read; a broken or missing link
      REFUSES loudly, naming the gap (never a silent skip).
- [ ] S8. Seam fields present and serialization-tested in lieu of a consumer
      ([[M14-PROCEDURE]] §5): `epoch_id` (constant 0, NOT omitted), `doc_prev_hash`, nullable
      payload.
- [ ] S9. Gates green in cello-client (`test` → `lint` → `typecheck` → `build`).

### Falsification pass (procedure §2 step 3) — before any code

- **Does the interface expose what I need?** `DaemonDatabase` gives `exec`/`prepare` only. That
  is what `trust-signal-store.ts` uses, so the idempotent-DDL pattern applies unchanged. No new
  interface surface needed. ✔
- **Does responsibility live here?** The store PERSISTS; it does not apply Yjs updates. So the
  rebuild function is the open question: rebuilding means replaying payloads through
  `Y.applyUpdate`, which is the ENGINE's job (DOD-DOC-ENGINE-1, P1). Resolution: the store
  exposes the log in order and accepts an injected replay function; the store owns
  *what to replay and in what order*, the engine owns *how to apply*. That keeps `yjs` out of
  the store's production imports (it is a devDependency again after FUZZ-1) and keeps the P0/P1
  boundary honest — STORE-1 must not quietly build ENGINE-1.
- **What breaks elsewhere?** Nothing reads these tables yet; the module is additive. The DB
  handle is shared, so the DDL must be idempotent and must not collide with existing table
  names — `documents`, `document_envelopes`, `document_snapshots` are unused today (checked).
- **Redundancy check:** `session_tree_leaves` already stores leaf hashes per session. The
  document envelope log is a DIFFERENT axis — per DOCUMENT, spanning sessions (§9.1: "the
  document log is the set of 0x04/0x05 envelopes for a document_id, extracted from however many
  sealed sessions they transited"). Not a duplicate; do not try to reuse the session tables.

### Carried in from DOD-DOC-FUZZ-1 (measured, so the store does not re-assume it)

- **Never persist or restore a Yjs clientID** (§14). FUZZ-1 measured what a collision does: the
  colliding writer silently wins and the honest client's update is accepted-and-dropped, leaving
  a splice of two authors, with an EMPTY pending set. The store therefore stores the snapshot
  BINARY and the state vector — never a clientID to restore into a live `Y.Doc`.
- **The state vector is the integration checkpoint**, and `document_snapshots.last_applied_index`
  is what makes "where does this snapshot sit in the log" a lookup rather than a derivation.

---

## Entry 11 — 2026-08-04 — DOD-DOC-STORE-1 ✅ CLOSED. **P0 IS COMPLETE.**

**Merged:** cello-client `m14/store-1` → `main`. Two review passes, the cap. Five blocking
findings across them, all fixed — including one I introduced *while fixing another*.

### The lesson of this unit: a "backstop" that silently loses data

Pass one told me to make the log index atomic and to add CHECK constraints. I did both, on an
`INSERT OR IGNORE` statement. **`OR IGNORE` suppresses CHECK, UNIQUE and NOT NULL as well as the
conflict it is aimed at** — so neither constraint refused anything. A malformed `kind`, or a
colliding `log_index`, was DROPPED and reported to the caller as an already-seen duplicate.

On an append-only log whose entire premise is completeness, I had traded a non-deterministic
*ordering* bug for silent *data loss*, and called it a backstop. Pass two proved it by execution
rather than reading:

```
appendEnvelope bad kind returned: false     log length: 0
UNIQUE(log_index) collision, distinct hash: changes = 0
```

Fixed by scoping the conflict clause to the envelope hash alone (`ON CONFLICT … DO NOTHING`), so
everything else throws and `false` means exactly one thing. **The generalisable form: a
conflict-resolution clause is not a local decision. `OR IGNORE` is a blanket amnesty for every
constraint on the table, and adding a constraint later silently enrols it.**

### The verifier accepted a shape it was wired in to catch

Pass one's F1 wired chain verification into the read path — every rebuild now goes through it, so
it is the only thing between a crafted log and a persisted snapshot. Pass two then found it still
accepted **a detached cycle sitting beside a valid genesis chain**: one root, every link
resolving, no duplicate predecessor. Counting roots and predecessors cannot see that shape, and
`doc_prev_hash` is peer-controlled.

Replaced the structural heuristics with **reachability** — walk forward from the single genesis
and require the walk to cover every envelope that sender authored. One check subsumes
duplicate-genesis, mid-chain fork, and every cycle shape. *Structural invariants checked as a
list of symptoms will always miss a shape; check the property itself.*

### Also fixed

- **H3** `createDocument` silently discarded an out-of-set status (same `OR IGNORE` mechanism),
  leaving the caller believing the document existed and the failure surfacing later as a
  foreign-key error on the first append — pointing at the wrong statement entirely.
- **M4** I changed `ReplayFn` to take rows *so the engine could exclude a withdrawn update*, then
  filtered out exactly those rows before calling it (withdrawals carry no payload). The
  justification and the code disagreed. The engine now receives the whole ordered log.
- **M6** an envelope for an uncreated document surfaced as `FOREIGN KEY constraint failed` —
  naming neither the document, the owner, nor the missing row. It names its own cause now.
- **M5** the empty-log test passed identically under the code it replaced (`[].length - 1` is
  also `-1`), so it was not coverage of anything. A SPARSE-index test is the shape that tells
  `log.at(-1).logIndex` apart from `log.length - 1`; verified red on revert.

### A false red, traced rather than attributed

The full suite went red on `ed25519.test.ts` — keygen 453ms against a 200ms AC. I did not touch
crypto. Rather than call it flaky: it passed 3/3 in isolation, and the **baseline without my
changes failed it too**, so it was neither mine nor real. Root cause: the AC times the FIRST
keygen in the process, which also pays one-time noble-curves initialization — so it measures
module load as much as key generation, and a loaded machine blows the budget. Fixed with a
warm-up call so it measures the steady-state property the AC means; **the 200ms bound is
unchanged**. Recorded because this false red will otherwise be re-chased.

### Scope limit — stated, not buried

This unit proves **the log is sufficient input** to rebuild. It does **not** prove the fold is
correct: the replay stand-in is byte concatenation, which is associative and order-only, while
Yjs merge is neither. Byte-identical rebuild against a real `Y.Doc` is now an explicit AC on
DOD-DOC-ENGINE-1, along with two more the reviews surfaced (the engine must exclude withdrawn
updates from the fold, and must verify linkage before trusting materialized state).

### Gates

`test` **2545 passed / 11 skipped, 232 files** · `lint` · `typecheck` · `build` clean.

### 🎉 TIER P0 IS COMPLETE

| Unit | State |
|---|---|
| DOD-DOC-LEAF-1 | ✅ both repos, published + promoted |
| DOD-DOC-FUZZ-1 | ✅ nine measured ACs handed to GATE-1 |
| DOD-DOC-STORE-1 | ✅ three ACs handed to ENGINE-1 |

Next: **Tier P1**, starting at **DOD-DOC-ENGINE-1** — the daemon's Y.Doc lifecycle, now carrying
three inherited ACs. `yjs` returns to `dependencies` there (it went to devDependencies in FUZZ-1
under "no consumer, no ship"; ENGINE-1 is the consumer).

---

## Entry 12 — 2026-08-04 — DOD-DOC-ENGINE-1 implemented (P1 opened; review in flight)

**Branch:** cello-client `m14/engine-1` @ d90959b. **IMPLEMENTED, not DONE** — the DoD line stays
❌ until a verdict is quoted.

### The unit in one line

The engine owns HOW to apply; the store owns what to replay and in what order. Every guard in it
answers a MEASUREMENT from DOD-DOC-FUZZ-1 rather than a guess about Yjs.

### The three inherited ACs, now proven

- **(i) byte-identical rebuild against a real `Y.Doc`.** STORE-1 could only prove the log is
  sufficient *input*, because its replay stand-in was byte concatenation — associative and
  order-only, which Yjs merge is neither. Here a document is built through real Yjs updates, each
  captured as an envelope, and the rebuilt state vector is asserted byte-identical to the live
  one's. The fold is now proven, not assumed.
- **(ii) a withdrawn update is excluded from the fold.** Verified red when the filter is removed.
- **(iii) rebuilding through the store refuses over a chain that does not verify.**

### Guards, and the measurement each answers

| Guard | The measurement it answers |
|---|---|
| Pre-parse size cap | bytes never reach Yjs on length alone |
| **Two-byte floor** | an empty/1-byte update throws `Unexpected end of array` — a DECODER string naming Yjs internals, not a protocol fault |
| Wrapped apply → one typed reason, decoder string as `detail` | lib0 messages describe where the decoder gave up, never what the peer did wrong |
| **Pending-set check after every apply** | the ACCEPT class: Yjs returns SUCCESS for an update whose dependencies never arrive, contributes nothing, and retains it forever. A try/catch sees only success |
| Shadow-apply before the real one | Yjs has no atomic-apply mode; a partially-resolving update would leave the caller's document in a state nobody chose |

### `replay` REFUSES rather than skipping

A payload that will not apply means the log is corrupt. Folding the rest would produce a document
that reads as complete while missing operations — the silent divergence the whole two-layer design
exists to prevent. Flagged to the reviewer as a genuine trade: it may mean one bad envelope makes
a document unopenable, and I asked what the operator's path back should be.

### clientID rule pinned in BOTH directions (§14)

Twenty fresh documents get twenty distinct clientIDs, and `restore` mints a NEW one rather than
resuming under the snapshot's. FUZZ-1 measured the cost of getting this wrong, which is why it is
tested rather than merely commented.

### `yjs` returns to `dependencies`

FUZZ-1 moved it to devDependencies under "no consumer, no ship". This unit is the consumer.

### Gates

`test` **2562 passed / 11 skipped, 233 files** · `lint` · `typecheck` · `build` clean.
(One lint error caught and fixed on the way: an unused `Y` import in the test after the engine
absorbed every direct Yjs call — which is the shape the unit wants, the test driving the engine's
surface rather than Yjs's.)

---

## Entry 13 — 2026-08-04 — ENGINE-1 review: **the acceptance criterion itself was wrong**

**Fix commit:** cello-client `m14/engine-1` @ 85b084b. Review pass one of two.

### The finding, and why it goes deeper than a bug

The reviewer found that excluding a withdrawn envelope from the fold breaks the document. Checking
the spec before fixing showed something worse: **the AC I wrote was wrong.**

§16.4: withdrawing "rolls the change back locally (**Yjs undo**) and writes a withdrawal record
into the log **beside** the original envelope — marked withdrawn, **never deleted, so the log
stays intact**." §3.2 says the same of rejection: supersession is "**inverses, not erasure**."

So the undo is an ordinary update *in* the log, and replay simply applies every payload in order.
A withdrawal record excludes nothing. I had written AC (ii) from the previous unit's review
comment instead of from the spec, and then implemented the AC faithfully. **The DoD line is
corrected in place with the spec citation**, because leaving a wrong AC in the yardstick is worse
than the bug it produced.

### Two HIGH findings that DISSOLVE with the exclusion logic

Neither needed a guard; both were consequences of doing the wrong thing carefully.

1. **Non-leaf withdrawal made a document permanently unrebuildable.** Yjs operations are causally
   chained, so excluding any but the LAST envelope strands every later one on structs that never
   arrive. Measured across three inserts: withdrawing the first or the middle refused to rebuild.
   And because live Y.Doc state deliberately does not survive a restart, the document would work
   until the next daemon start and be **permanently unopenable after it**, with no operator path
   back short of hand-editing SQLCipher.
   **My test withdrew the leaf — the single case that worked.** A test that exercises only the
   shape the implementation happens to handle is not coverage; it is a mirror.
2. **Any sender could erase any other sender's content.** The withdrawn set was built from
   `kind` + `referencesEnvelopeHash` with no authorship check — and I verified nothing upstream
   supplies one: `appendEnvelope` writes the reference verbatim, `verifyChainLinkage` never reads
   it. So a counterparty could append a payload-free row naming my envelope and silently drop my
   contribution from every rebuild, with a log that still verifies.

Both are now covered by tests that trigger the adversarial condition — a non-leaf withdrawal and a
cross-sender one — neither of which the original tests could reach.

### Also fixed

- **A purged `update` row was silently skipped.** A withdrawal legitimately carries no payload;
  an `update` whose bytes are gone (§16.7-12) is an operation that WAS part of the document. The
  `continue` treated them identically, producing a short document reported as a clean rebuild
  with a lower applied-count that nothing compares against. It refuses.
- **`restore()` bypassed every guard in its own file** — the one method that reads bytes off disk,
  and a corrupt snapshot row surfaced as `Unexpected end of array`, the exact lib0 string the
  module header says must never be a reason. Typed reason now, decoder string as detail, plus a
  pending-set check so an incomplete snapshot cannot restore short and silent.
- **Refusals were returned but never logged.** A return value no caller reads is not observable,
  and the unit's blocking criterion says a declined update must be.
- **The shadow document is reused across a fold** — one per envelope made replay quadratic in
  document size, on every cold start where the snapshot is missing.
- **`readText`/`insertText` → `readTextRoot`/`insertIntoTextRoot`.** `documentType` admits json
  and xml, where that root is empty; the old names would have returned `""` indistinguishable
  from an empty document.
- **`DocumentUpdateResult` is a discriminated union**, so a refusal that forgets its reason is a
  type error rather than a `!` assertion.
- **AC (i) now asserts BYTE identity**, which is what it says — a state vector is only
  clientID→clock, so structurally different state with equal clocks would have passed.

### Carried forward (reviewer's, and mine)

- The pending-set guard **refuses a legitimate out-of-order update** that Yjs would buffer and
  resolve on the next state-vector exchange. Correct for replay, where a gap means corruption;
  a live-receive path wanting buffer-and-re-request needs its own entry point. The precondition
  is now stated in the method contract — **DOD-DOC-DELIVERY-1 must not route live receives
  through `applyUpdate` without deciding this.**
- Trailing-byte malleability stays the gate's job, not the engine's — but it means
  `envelopeHash` is not a stable identifier for document state, so hash-based dedupe cannot
  recognise a re-encoded duplicate.
- `DocumentEngine` still has **zero non-test importers**. The "no consumer, no ship" clock is
  running on the engine itself now; DOD-DOC-WRITE-1 is the consumer.

### Gates

`test` **2567 passed / 11 skipped, 233 files** · `lint` · `typecheck` · `build` clean.

---

## Entry 14 — 2026-08-04 — DOD-DOC-WRITE-1 scoped (opens when ENGINE-1's pass two lands)

Prepared while the engine's second review runs, so the unit can start on the verdict rather than
after it. **Nothing implemented yet.**

### The design, in the spec's own terms (§16.2)

> "The daemon materializes each document as a real file in a workspace directory. The agent edits
> it with its ordinary tools; the human can open the same file. On publish, the daemon diffs the
> file against the last-known projection and converts the diff into Yjs operations."

**No new editing surface exists.** That is the load-bearing sentence: the agent uses Read/Edit on
an ordinary file, and the CRDT is entirely the daemon's business. It is also why diff coarseness
is acceptable — publish-on-intent (§5) already makes updates coarse intentional batches, so
diff-granularity operations are the granularity the design wants.

### The insight to preserve — two mechanisms are one mechanism

§16.2's incoming direction: fold the agent's unpublished file edits into the `Y.Doc` as local
operations FIRST, then merge the incoming update, then rewrite the file. If the merge touched
regions the agent had unpublished edits in, **that is precisely §4.1's overlap flag**. The flag is
not a separate feature to compute — it falls out of the fold order. Getting the order wrong loses
the flag and silently clobbers the agent's unpublished work.

### Clause checklist

- [ ] W1. Per-agent workspace directory; each document a real file, keyed on
      `agent_id`/`document_id` (never a name — a filename is display, the id is identity).
- [ ] W2. **Publish:** diff the file against the last-known projection → Yjs operations.
      Text diff for text types, key diff for JSON (`documentType` decides, and after ENGINE-1's
      review the text accessors are explicitly text-root-only, so a JSON document must not be
      routed through them).
- [ ] W3. **Admission, in this order:** fold unpublished local edits as local ops → merge the
      incoming update → rewrite the file. Order is the whole design; a test pins it.
- [ ] W4. Overlap flag computed from whether the merge touched regions holding unpublished local
      edits — derived from the fold, not tracked separately.
- [ ] W5. Round-trip: edit → publish → apply on a second doc → materialize → identical content.
- [ ] W6. Concurrent edits on both sides → both converge → overlap flag true **exactly when**
      regions overlap (the DoD says exactly when, so the negative case is as load-bearing as the
      positive).
- [ ] W7. Gates green.

### Falsification, before any code

- **Does the engine expose what this needs?** It has create/apply/encode/snapshot/restore and
  text-root accessors. It does NOT have a diff, and it should not — diffing is the write path's
  job, and the engine stays the Yjs boundary. WRITE-1 supplies ops TO the engine.
- **Whose job is the file?** Not the store's (it persists envelopes and snapshots, not files) and
  not the engine's (it is the Yjs boundary). A third module. This keeps the "no consumer" clock
  honest: WRITE-1 is the engine's first real importer.
- **What breaks?** Nothing yet — no production path reaches any of the three modules. The risk is
  the opposite: three modules and still no caller, so the wiring unit (P2's DELIVERY-1/TOOLS-1)
  must not be deferred indefinitely or M14 becomes a library nobody calls.
- **Carried in from ENGINE-1's review:** `applyUpdate` REFUSES an out-of-order update rather than
  buffering it. The admission path folds local edits before merging, so it must not hand the
  engine an update whose predecessors are absent — if the write path ever receives out of order,
  that is DELIVERY-1's contract to fix, not something to paper over here.

---

## Entry 15 — 2026-08-04 — DOD-DOC-ENGINE-1 ✅ CLOSED (two passes; P1's first unit done)

**Merged:** cello-client `m14/engine-1` → `main` (ebfc136).

### I flagged the fix I was least sure of, and it was the one that was wrong

Pass one's correction replaced the exclusion logic; my replacement reused a scratch document
across a fold for performance. I told the reviewer it was the fix I trusted least and asked them
to **measure rather than reason**. Both of my claims for it were false:

- **`Y.applyUpdate` MERGES; it does not reset.** A scratch doc re-seeded from an *empty* document
  still holds the previous trial's operations — measured: a shadow holding `"AAA"`, re-seeded from
  an empty doc, still reads `"AAA"`. My docstring asserted the opposite as the safety argument.
- With that residue present, an update whose dependencies the target lacks reports an **EMPTY
  pending set** — so the one guard that catches the accept class goes green on exactly the input
  it exists to refuse, and the caller's document is left short while the call returns `ok`.
  Unreachable today *only* because `replay` aborts on first failure, keeping the two documents in
  lockstep. **The safety rested on a caller property, not the property I had written down.**
- The performance justification was also wrong: at 200/400/800 envelopes, reuse buys a *shrinking*
  constant (2.4× → 1.26×), not the asymptotic fix I claimed. Both folds are O(n·|doc|) because
  `encodeStateAsUpdate` runs per envelope either way.

**The fix is to remove the trial from `replay` entirely.** Atomicity buys nothing there — a
failure discards the whole document — so it applies straight to the doc and checks the pending set
after each apply. The public `applyUpdate` keeps a FRESH trial per call, where the caller's
document genuinely must survive a refusal. That deletes the hazard instead of documenting around
it.

*The lesson, and it is the second time this milestone: a comment asserting a safety property is
not the property. "Safe because X" is a claim to be measured like any other — and the two times I
have written one without measuring, it was false.*

### Also fixed

- **The refusal logging had ZERO coverage.** Deleting the log calls left all 2 567 tests green —
  so the fix for "a return value nobody reads is not observable" was *itself* unobservable. Now
  asserted with a recording logger, verified red on revert.
- An incomplete snapshot threw `document_update_unresolved_dependencies`. There is no update — it
  has its own class now.
- Two comments survived the withdrawal correction still asserting the deleted rule; a reader hits
  them before the corrected docblock and reintroduces exclusion.
- A CHECK constraint enforces that only an `update` may carry a payload, making replay's skip of
  payload-free audit rows provably safe rather than conventionally safe.
- **Stale `dist` orphans:** the built artifact still exported the old `readText` name. Worth
  recording the mechanism — `rm -rf dist` alone is NOT enough, because `tsc --build` reads its
  incremental state and does nothing. It needs `--force`, and deleting dist without it leaves the
  whole workspace unbuildable until you notice.

### Carried onto later units (not deferred silently)

- **The engine exposes no delete/undo accessor**, so §16.4's withdraw ("a Yjs undo") has nothing
  that PRODUCES an inverse update — the engine only proves replay applies what it is handed. On
  DOD-DOC-WRITE-1's line now.
- **`applyUpdate` refuses an out-of-order update rather than buffering** — right for replay, wrong
  for a live receive, which Yjs would buffer and resolve on the next state-vector exchange. Also
  on WRITE-1's line, flagged for DELIVERY-1.
- **Byte identity is proven single-writer only.** The harder property — byte identity across an
  interleaved multi-writer log — is untested and belongs to a later unit.
- **`replay` is not epoch-scoped** (`getEnvelopeLog` reads the whole log; `epoch_id` exists as a
  column and is never filtered). Harmless in V1 where epoch is constant 0, and the engine failing
  loud on a purged pre-epoch envelope is exactly what should happen if M14B misses it — recorded
  as an M14B AC.

### Gates

`test` **2573 passed / 11 skipped, 233 files** · `lint` · `typecheck` · `build` clean (after a
`--force` rebuild).

### Next

**DOD-DOC-WRITE-1** — scoped and falsified in Entry 14, now carrying two inherited constraints.

---

## Entry 16 — 2026-08-05 — DOD-DOC-WRITE-1 implemented (review in flight)

**Branch:** cello-client `m14/write-1` @ 5b563c2. **IMPLEMENTED, not DONE.**

### A flaky test that was a real bug

The overlap assertion passed roughly **three runs in four**. The temptation is to call that test
noise; it was a defect in my code, and finding it took a trace rather than a re-run.

I measured the local edit in **PRE-fold coordinates** and compared it against merge deltas
reported in **POST-fold coordinates**. Two different coordinate systems. And the reason it was
*intermittent* rather than always-wrong: **Yjs breaks ties between concurrent inserts by
clientID, which is random.** When the local fold deletes the characters an incoming insert was
anchored to, Yjs re-homes that insert to the boundary of the local edit — and *which side* of the
boundary depends on the draw.

Traced concretely: local edit occupied `[4,9)`, the incoming insert landed at `[9,14)`. Adjacent,
so strict inequality said "no overlap" — for the case where both sides rewrote the same word.

Fix: the fold reports where the local edit **ended up**, and the endpoint comparison is
**inclusive**. Verified across eight consecutive runs. *This is the third time this milestone that
Yjs's random clientID produced a nondeterministic result that read as something else — the deep-
nesting byte count, the collision splice, and now this. It is worth treating "random clientID" as
a standing suspect whenever a Yjs-adjacent result is intermittent.*

### The design, and what is easy to lose

§16.2's fold order — local edits in as operations, THEN merge, THEN rewrite the file — is the
whole unit. Reverse the first two and the agent's unpublished work is destroyed silently, because
the file gets rewritten from a document that never saw it. And the overlap flag is not a separate
feature to compute: it *is* whether the merge touched what the fold had just written. Two
mechanisms, one mechanism.

### Refusals

Publishing an unmaterialized document names the missing file; malformed JSON on disk refuses
rather than half-applying (a broken file must not corrupt the CRDT); an unsupported document type
refuses rather than silently doing nothing.

### Flagged to the reviewer, unresolved by me

- Is **inclusive** overlap right, or does it now fire for genuinely adjacent-but-disjoint edits?
  The DoD says "true EXACTLY when regions overlap", so a false positive is a real failure — it
  trains agents to ignore the flag.
- **`#typeOf` infers the type from the document's shape** because the caller does not thread the
  store's authoritative `documentType` through yet. An empty JSON document infers as text.
- **`#projection` is in-memory** and dies with the daemon — asked what breaks after a restart.
- Whether a **single-range diff** is actively harmful to merge quality versus a minimal edit
  script.

### Gates

`test` **2588 passed / 11 skipped, 234 files** · `lint` · `typecheck` clean.

---

## Entry 17 — 2026-08-05 — WRITE-1 pass-one findings applied; the unreproducible failure, caught

**Commits:** cello-client `m14/write-1` @ 17c8095 (fixes) and 1d89571 (the flake). Pass two in
flight.

### The intermittent failure — found by capturing, not by re-running

Earlier I recorded a single test failure I could not reproduce in four full runs and could not
name. Rather than let that stand, I ran the suite three more times **redirecting full output to
files** instead of grepping a live stream. Run 3 caught it:

```
× DOD-DOC-FUZZ-1 … EVERY prefix of a valid update is rejected — counted, and the size is pinned
  AssertionError: expected 83 to be 84
```

**Root cause: a random clientID — and I had already diagnosed this exact mechanism in the exact
same file.** `validUpdate()` built its document with Yjs's random clientID, and every item
reference encodes that clientID as a varint, so a draw below 2²⁸ encodes in four bytes rather than
five and the update is 83 bytes instead of 84. That is ~1 run in 16, matching the observed rate.

The deep-nesting measurement in this same file hit the identical problem, was diagnosed, and was
pinned. **This one was missed because nothing connected the two.** The fix now states the reason
at the helper rather than at the assertion, so the next size expectation added to this file sees
why the clientID is fixed. Eight consecutive runs green.

**This is the FOURTH time in M14 that Yjs's random clientID produced a nondeterministic result
that read as something else**: the deep-nesting byte count, the collision splice, the write-path
overlap coin flip, and now this. The standing rule, earned four times: *if a Yjs-adjacent result
is intermittent or two measurements disagree, suspect the clientID before anything else.*

### WRITE-1's pass one — three measured routes to losing the agent's work

Every finding was measured against the built artifact by the reviewer, not argued.

1. **JSON overlap was hardcoded `false`.** Local regions were recorded only on the text branch and
   the observer watched only the text root, so a map merge produced nothing to compare. Measured:
   with `{"k":"MINE"}` unpublished on disk and the peer sending `k="THEIRS"`, Y.Map's clientID
   tie-break destroyed the agent's edit **12 runs in 20** — and the flag said nothing. The JSON
   path now has its own region model: the fold reports the keys it wrote, the merge observes the
   map, overlap is the intersection.
2. **The projection was write-only.** §16.2 says publish diffs "the last-known projection"; mine
   was written three times and never read, so the real baseline was the doc's own text. Those
   diverge precisely where it matters — `admit` merges into the doc and rewrites the file as two
   steps, so a crash between them leaves a stale file beside an advanced doc, and diffing that
   reads the peer's admitted paragraph as an agent deletion **and publishes the deletion as
   deliberate intent**. Persisted now, and a stale file REFUSES rather than diffing.
3. **The document type was inferred from the doc's shape**, so an EMPTY JSON document inferred as
   text: publish looked for a `.md` that does not exist and reported `document_file_missing` —
   wrong path, wrong advice, for a fault four frames up. Admit skipped the fold, wrote a phantom
   `.md`, and set up the next publish to delete the peer's keys. `documentType` is a required
   parameter now and the inference is gone.

Also: the single-range diff **resurrected text a peer deliberately deleted** whenever a publish
batch held two separated edits — which publish-on-intent makes the normal case, not the exception.
§16.2's licence for coarseness covers granularity of intent, not rewriting spans the agent never
touched. Replaced with line-level hunks. And the overlap flag was sensitive to the peer's insert
LENGTH rather than its position, because local regions were never shifted into the merge's
coordinate system.

### Test quality

The overlap assertion survived the BROKEN comparison **17 runs in 40** — the same coin flip,
merely landing on the lucky face more often. Every concurrent case now pins both clientIDs and
runs both orderings. JSON admission went from zero tests to five.

---

## Entry 18 — 2026-08-05 — DOD-DOC-WRITE-1 ✅ CLOSED. P1 is complete.

**Merged** to cello-client `main` @ 30f6e99, rebased onto five commits another session had landed
there (relay-keepalive and park-drain). No file overlap; combined tree green at **2640 tests**.

### Pass two: my fix for pass one CORRUPTED CONTENT

Pass one's F4 said a single-range diff resurrects text a peer deleted. I replaced it with a
hand-rolled line diff — prefix/suffix trim over lines. Pass two measured it publishing text that
was **not what the file said** in four of six ordinary markdown edits:

```
append-line   : want "para one.\npara two.\npara three."  got "para one.\npara two.para three."
insert-middle : want "a\nNEW\nb\nc"                        got "a\nNEWb\nc"
delete-last   : want "a\nb"                                got "a\nb\n"
delete-middle : want "a\nc"                                got "a\n\nc"
```

The separator between the head run and the changed run was never accounted for, so the newline
was dropped and the offset overshot by one. Worse, every line-count change fell into a fallback
branch that emitted ONE hunk for the whole changed span — reproducing F4 exactly, the harm the
rewrite existed to remove. Adding a single line to the agent's edit was enough to trigger it.

**Replaced with a real LCS over line CHUNKS** — each line carrying its own trailing newline,
except the last. That representation is why newline handling now falls out instead of being
special-cased: appending to `"a\nb"` turns the chunk `"b"` into `"b\n"` + `"c"`, so the LCS sees
the last line as changed and the hunk replaces `"b"` with `"b\nc"`. Seven edit shapes round-trip,
each asserted `want === got`.

*The lesson: I hand-rolled a diff because a real one felt like scope. A diff is a solved problem
with a known-correct algorithm, and "coarse but correct" turned out to be neither.*

### The guards pass two found missing

- **The stale-baseline check refused only when the file was ALSO untouched**, which let through
  the one state that matters: the doc advanced past the projection AND the agent edited the file.
  Hunks are offsets into the projection applied to the doc's text, so that publishes
  projection-offset hunks into a longer document and mutilates the peer's admitted paragraph.
  The condition is now the invariant itself — the baseline must equal the document.
- **`admit` substituted `""` for a missing projection.** Deleting the sidecar diffed the whole
  file in as an insert at offset 0 of a document that already held it — the body DUPLICATED into
  the CRDT and out to the peer, permanently. It refuses. And the sidecar moved into a
  dot-directory: it had been sitting in the agent's own workspace, which §16.2's "no new editing
  surface" premise forbids.
- **Any read error was read as "never materialized, nothing to lose"**, and the file was then
  overwritten with the merged projection. Only ENOENT means that.
- **The mtime guard is now a content re-read** — second-granularity filesystems hide a save inside
  the merge window, and a failing `stat` read as "unchanged".
- **The overlap flag treated a peer deletion as a range in OLD coordinates** while the local
  region had already shifted into new ones, so any edit within N characters after a deletion read
  as overlapping. Inserts and deletes are compared differently now, and **the asymmetry is the
  point**: a re-homed insert landing on the local edit's boundary IS overlap (Yjs put it there
  when the fold deleted its anchor); a deletion landing there is not, it merely shifted the region.

### The clientID rule, now enforced (Andre asked)

**Production: no.** §14 forbids deriving or persisting one; FUZZ-1 measured the splice.
**Tests: yes, and it must be** — everything asserted about a Yjs result is a SIZE (varint width)
or an ORDER (tie-break). Four M14 incidents were this one mechanism. `yjs-determinism.test.ts`
states both answers and **fails if a document test asserts an exact length over an encoded update
without pinning**.

Two things measured writing it:
- **Yjs RE-MINTS a clientID when it applies an update authored under that same id** ("Changed the
  client-id because another client seems to be using it") — a real built-in defence, and a trap:
  pinning a test doc to its base's id silently defeats the pinning. My first demo did exactly that
  and produced identical results both ways.
- My first guard flagged two innocent files because its regex matched any multi-digit number
  rather than a byte length. **A guard with false positives gets disabled**, so it now asks the
  narrow question.

### 🎉 TIER P1 IS COMPLETE

| Unit | State |
|---|---|
| DOD-DOC-ENGINE-1 | ✅ |
| DOD-DOC-WRITE-1 | ✅ |
| DOD-DOC-GATE-1 | next — nine measured ACs (a)–(i) |
| DOD-DOC-REJECT-1 | after the gate |
| DOD-DOC-SCREEN-1 | 🅿️ blocked on the screening audit (Andre's call) |

---

## Entry 19 — 2026-08-05 — DOD-DOC-GATE-1: a working forgery against the rule written to stop it

**Commits:** cello-client `m14/gate-1` @ b0031cd (implementation) → 080e47b (pass-one fixes).
Pass two in flight. **IMPLEMENTED, not DONE.**

### The finding

Pass one built a **working forgery** against AC (h). My rule asked whether a clientID was NEW,
which exempted every client already in the accepted state — **including the document owner's own**.
Integrate the accepted state, then take the owner's clientID, and the update was ADMITTED and
attributed to the owner ("FORGED honest content"), with an EMPTY pending set so rule (a) could not
see it either. Setting the clientID after integration sidesteps Yjs's own "Changed the client-id"
guard; a hand-rolled encoder needs no trick at all.

My test passed because it used `999_999` — novel AND unbound, the one class the rule caught.

**The right question is authorship, not novelty:** every client whose CLOCK ADVANCED must be bound
to the sender. A peer never legitimately advances another client's clock — that is what authorship
MEANS in Yjs. *Generalisable: a rule phrased as "is this thing new?" is a proxy; the property was
"did this party do this?" A proxy passes its own test and fails the attack.*

### Four more, all measured

- **`append_only` was a COMPLETE NO-OP for json documents.** It diffed only the text root, while a
  json document's content is exactly the map the write path projects from. An 8-byte update
  emptied the map with `deletedChars` 0 and was admitted.
- **The trailing-byte detector refused HONEST peers.** It compared against the canonical DELTA, and
  legitimate updates are larger: a peer batching several transactions (the normal shape for an
  append-only log under publish-on-intent) and a full-state update (what a sync with no state
  vector sends) were both refused as `document_update_trailing_bytes` — an ATTACK LABEL on a benign
  encoding, sending an operator to hunt a malicious peer while the document quietly stops
  converging. `Y.diffUpdate` strips slack and is a real detector; `Y.mergeUpdates` PRESERVES
  padding and is not.
- **Only one of Yjs's two pending sets was read.** An update carrying a delete set for structs
  never seen leaves `pendingStructs` null, fills `pendingDs`, and retains forever — the same
  unbounded growth (a) exists to stop. The engine had the identical gap.
- **Depth was measured on one root.** And `doc.toJSON()` is not sufficient: it returns each root's
  key but does NOT recurse into a root never instantiated as a concrete type — measured, 30 levels
  reported as 1. Each root is instantiated and walked now.

Plus: the rate limit counted ADMISSIONS, so a peer sending only invalid updates was never limited
while each attempt cost a full encode+apply of the whole document; and "held, never discarded" was
a comment while the bytes died with the caller's stack frame — the verdict now carries them, which
DOD-DOC-REJECT-1 needs to reference from a `0x05` leaf.

### The test-quality lesson, stated plainly

Every test in the original suite **survived the revert test** — and five bugs shipped green anyway,
because each rule's test picked the input class that rule got RIGHT. Surviving a revert proves a
test is connected to its code; it does not prove the test chose the adversarial case. *The revert
test is necessary and not sufficient: ask separately which input class this rule gets WRONG.*

### Carried to DOD-DOC-ENVELOPE-1 as BLOCKING ACs

The gate enforces three bindings no property of the bytes can establish, so each is only as
trustworthy as the signature covering it. All three must be inside the signed TBS: `document_id`,
the update encoding, and **the sender's clientID**. The third is load-bearing beyond security:
§14 requires that nothing persists a clientID, so a restarted peer mints a fresh one and the gate
would refuse it forever. **The rule is correct only if the binding is LEARNABLE**, and the envelope
is where it is learned. Recorded on ENVELOPE-1's DoD line.

---

## Entry 20 — 2026-08-05 — DOD-DOC-GATE-1 ✅ CLOSED. The depth rule was INVERTED.

**Merged** to cello-client `main` @ a523fe4. Two review passes, the cap. **Nine measured ACs
enforced.**

### Pass two: my own guard defeated the rule it guarded

A recursive depth walk throws `RangeError` past roughly a thousand levels, and the bare `catch`
around it returned **0**. So 30 levels were refused and **5,000 were admitted** — the deeper the
attack, the more certain it passed.

Worse: it converted the gate's own fail-safe into an admission. Nesting placed under a root the
gate names threw where `validate()`'s catch-all could quarantine it — safe. The attacker simply
picks a different root name, and the inner `catch` turns that same fail-safe into an ADMIT.

*The generalisable form: a `catch` that returns a benign default inside a security check does not
degrade the check, it INVERTS it. The failure it swallows is exactly the signal that the input was
extreme.*

### The same pattern, three times in one unit

Pass one named it and I reproduced it twice more while fixing:

1. (h) was tested with a clientID that was novel AND unbound — the one class the rule caught.
   Pass one's forgery used the owner's own.
2. My (f) fix instantiated roots via `doc.getMap(name)`, which **MIGRATES** an uninstantiated root
   to a map in place — so an Array-shaped root became an empty map and reported depth 0. The
   identical bypass, reached with a different type.
3. My (i) fix moved from ONE hardcoded root to TWO. A peer chooses its own root names — that is
   the whole threat model — so an append-only document was still unprotected everywhere else.

**Both (f) and (i) are now solved by asking a better question rather than by widening a list.**
`append_only` reads the UPDATE'S OWN DELETE SET: root-agnostic, type-agnostic, and a map-key
rewrite deletes the old item so §16.7-1's "deletes OR EDITS" falls out for free. Depth walks Yjs's
item graph structurally, iteratively, bailing at the limit.

*When a fix is "add the other case to the list", the list is the bug.*

### A false accusation I had not noticed

The projection-diff `append_only` compared top-level keys with `JSON.stringify`, so **growth inside
a nested entry read as a REWRITE** — refusing the very append the feature is named for, and telling
the operator content was *removed* when nothing was. Same class as the trailing-byte label on a
batched update: an attack message for a benign shape, which sends an operator hunting a hostile
peer while the document stops converging. The delete-set basis admits it correctly.

### Carried to DOD-DOC-REJECT-1

- The gate returns the quarantined BYTES on every refusal, **copied not aliased** (a caller reusing
  a pooled read buffer would otherwise leave REJECT-1 hashing bytes that are no longer the ones
  refused, into a `0x05` leaf, silently). REJECT-1 persists them.
- **Rule (h) binds INSERTIONS only.** A Yjs delete set carries no clientID and advances no clock,
  so a BOUND peer can delete the owner's content and the gate sees nothing. Legitimate CRDT
  behaviour for an authorized writer — but `append_only` is then the only thing between a bound
  peer and erasure, and it defaults off. REJECT-1 decides whether that is a rejectable event.

### Gates

`test` **2683 passed / 11 skipped** · `lint` · `typecheck` clean.

### Milestone state

P0 ✅ (3 units) · P1: ENGINE ✅ WRITE ✅ GATE ✅ · **REJECT-1 next** · SCREEN-1 🅿️ (Andre's call).

---

## Entry 20 — DOD-DOC-REJECT-1: a rejection is an AUTHORED ACT, and I filed it as a genesis

The unit builds the refusal half of §3.2: a refused update is never silently dropped, it produces a
`0x05` rejection leaf, the sender may supersede once, and a second refusal stalls the document.

### The defect that would have destroyed documents, on the normal path

Every rejection wrote `docPrevHash: null` under **this agent's own sender id**. Two rejections were
therefore two GENESIS rows for one sender, and `verifyChainLinkage` — correctly — refuses a chain
with two roots. The retry protocol *guarantees* at least two rejections before a stall, so this was
not an edge case; it was the ordinary path. And because `rebuildSnapshot` is how a document survives
a daemon restart, the document worked until the next restart and was **permanently unopenable**
after it. The log is append-only. There is no repair.

My tests missed it because all three rounds rejected the **same** envelope hash, which collapsed to
one row. The protocol produces distinct envelopes per round — the original, its supersession, that
supersession's — so the tests now do too.

*Fourth unit running where the tests picked exactly the input class the code handles.* The pattern is
stable enough to state as a rule: **when a test constructs its own inputs, ask what the PROTOCOL
would have produced, not what makes the assertion readable.** A rejection is an act this agent
authored; it belongs in this agent's chain, like every other act it authors.

### Two states for one fact, and the restart picks the wrong one

The stall flag and the round counter lived in memory while the document's status lived in the store.
After a restart the row said `stalled` while the daemon accepted updates on it, the held bytes were
gone, and the counter restarted from zero. A system reporting two contradictory states about itself
is worse than one reporting the wrong state, because neither reader is obviously wrong. Both now
derive from the store; there is one fact and one place it lives.

The quarantined bytes were in that same Map — so the persisted `0x05` leaf **referenced something
that did not survive the process that wrote it**. They needed their own table. `document_envelopes`
genuinely cannot hold them: its CHECK forbids a payload on a non-`update` row, and storing them AS
an update row would be worse, because `replay` applies every payload in order and deliberately does
not honour references — the refused content would come back on every rebuild. A comment of mine
claimed replay honoured them. It never did. Deleted.

### The rollback that undid the victim's work

`rollback()` discarded `UndoManager.undo()`'s return and reported success in three cases where it
undid nothing or the wrong thing. The damaging one: a sender that kept editing after a rejection
arrived had its **legitimate** work undone while the refused content stayed — so the supersession
re-ships the refused bytes, is refused again, and the document stalls citing the peer while the
operator's writing is gone. It now refuses with `document_rollback_out_of_order` unless the tracked
entry is exactly the top of the undo stack.

That guard earned its keep within minutes of existing: my first attempt to scope the UndoManager to
`doc.share` handed it the **untyped root placeholders**, a different object from the typed getter
used for edits, so `undo()` silently did nothing. Without the guard that is a green test suite over
a rollback that never rolls back.

### Decision — the policy record is written DAEMON-side (§3.2 "both sides")

The open routing question was: the gateway record store's `source` discriminator, or a daemon-side
write? **Daemon-side.** The gateway's record store is for SCREENING verdicts, and most V1 rejection
reasons are not screening at all — `append_only`, the receiver-local limits, malformed updates,
unresolved dependencies. Routing them through a screening store files structural protocol events as
policy verdicts and couples this unit to a schema owned by a component that is not involved. With
SCREEN-1 parked, that coupling would also be built speculatively. When SCREEN-1 lands, a rejection
whose reason came from a screening rule can ADDITIONALLY write a gateway record — the discriminator
exists for exactly that. Adding it later costs nothing; removing a premature coupling costs a
migration. Both halves now emit: `document.rejection.sent` and `document.rejection.received`, so a
log reader can tell who refused whom, and the receiving operator sees the reason rather than an
unexplained failure to converge.

### Decision — a bound peer deleting the owner's content IS rejectable

Carried from GATE-1. A Yjs delete set carries no clientID and advances no clock, so the authorship
rules cannot see a deletion at all. That is legitimate CRDT behaviour for an authorized writer, but
it means `append_only` — which defaults OFF — is the only thing between a bound peer and erasing the
document. Decided: erasure by a bound peer is a rejectable event, not a silently-accepted one. It is
the delete set that triggers rule (h), which is why (h) is derived from the delete set rather than
from a projection diff.

### Also fixed

No more fabricated crypto: the signature and state vector are required inputs rather than all-zero
placeholders, which in an immutable log are indistinguishable from a real signature that fails to
verify. The gate's `rule` and `limit` reach the quarantine row, so an operator can see which rule
refused and what number was exceeded. A duplicate rejection no longer advances the round.
`clearQuarantine` only announces an admission that actually happened.

### Gates

`test` **2703 passed / 11 skipped** · `lint` · `typecheck` clean.

### Milestone state

P0 ✅ (3 units) · P1: ENGINE ✅ WRITE ✅ GATE ✅ REJECT ✅ · SCREEN-1 🅿️ (Andre's call) ·
**P2 next: HANDSHAKE-1, ENVELOPE-1, DELIVERY-1, LIFECYCLE-1, NOTIFY-1.**

---

## Entry 21 — REJECT-1 pass two, and a spec clause that is wrong

Two review passes are the cap, and pass two earned it: it proved a two-way fork by *running both
branches* rather than reasoning about them, and both were broken.

### §9's effectiveness rule is unsound as written

§9 says an update leaf is effective iff no rejection leaf references it, and replay applies the
effective ones. Implemented literally that loses data. Measured — sender publishes a base, a refused
update, then rolls back and supersedes; replay skipping the refused leaf gives

    text "agreed base. "        pendingStructs PRESENT    pendingDs PRESENT

The supersession is causally stacked on the refused operations: the rollback is a *deletion* of
those structs and the new work is positioned after them. Drop them and everything later is pending
forever, so the document reads as complete and is silently missing the legitimate work — with no
error on any path. §16.7-5 had already retired §9's "document-log order" phrasing; this retires its
effectiveness phrasing on the same kind of evidence.

**What is sound: the receiver never writes the refused payload.** Nothing to subtract at replay
because nothing was added. The peer's supersession, computed against the RECEIVER's state vector per
§3.2 step 3, is self-contained — same fixture:

    text "agreed base. clean text. "   pendingStructs null   pendingDs null   converged true

The refused bytes *do* travel again inside that supersession, carrying their own inverses — which is
precisely "inverses, not erasure". They net to zero and survive as tombstones.

I had the code right in Entry 20 and the reasoning wrong: I wrote that replay "deliberately does not
honour references", as if the choice were indifference. The reason is causality, and stating it
wrongly is how the next person un-fixes it.

### The other branch: a chain that could not be walked

Not logging the refused envelope leaves the peer chaining its supersession onto a hash our log never
holds — `document_chain_broken`, document refuses to rebuild, and an operator sent to debug the chain
layer for a rejection-protocol event. The quarantine now carries the refused envelope's own author
and chain link and the verifier bridges across it. `rejectedDocPrevHash` is **required**: optional, it
would default every refused envelope to a genesis stub and manufacture the exact fork the bridge
exists to prevent. It caught two bad fixtures on its first run.

### One key, three rounds, two rounds lost

The quarantine was keyed on the REFUSED envelope. Re-refusing one envelope for a new reason appended
a new leaf, advanced the round, and dropped the new bytes, rule and limit with **no log line at
all** — three leaves, one row. The stall message then told the operator "the most recent reason was"
and printed the OLDEST. Keyed on the rejection leaf now, one leaf one row, with `holdQuarantined`
returning a boolean so a no-op is visible rather than assumed impossible.

*A silent `DO NOTHING` on a composite key is only correct if the key really is the identity of the
thing. It was the identity of the thing being rejected, not of the rejection.*

### The retry bound existed only on the side that never loops

`recordIncomingRejection` wrote nothing and counted nothing: its round came from rejections this
agent AUTHORED, which on a pure publisher is zero forever. So the publisher — the only side that
*can* loop — had no counter and no stop, and could supersede into a frozen document indefinitely.
Now a durable table, the round derived from it, and the publisher stalls on the same threshold the
receiver stops accepting on. `countRejections` is also scoped per rejecting agent: a mutual exchange
puts both directions' leaves in one log, and the unscoped count stalled a document at half its
rounds the moment the peer also rejected something.

### Tests that asserted nothing

- **Mutual rejection** used two *documents* owned by one agent — so it asserted that a composite
  primary key distinguishes two different keys. Any implementation passes. Now two stores, as two
  daemons, each reaching its own stall without advancing the other's.
- **The leaf test** built the exact state the §9 defect breaks and stopped one line short of
  `rebuildSnapshot`. It now asserts the rebuild carries no refused content.
- **The erasure test** asserted that `reject()` accepts a string. No detection exists anywhere, so
  it was green against nothing; renamed to say it records a decision.
- `expect(REJECTION_RETRY_LIMIT).toBe(1)` asserted a constant against its own literal. Deleted —
  and the constant is now `MAX_REJECTED_ROUNDS = 3`, because a "retry limit" of 1 compared as
  `round > LIMIT + 1` permitted two retries under a name that said one.

### ENVELOPE-1, pass one

`epoch_id` was in the TBS with **no test**: deleting it from the array left all 27 green, under a
test whose name claimed to cover it. The concatenation-forgery test compared two values of one
non-adjacent field — a naive unframed concatenation passes it unchanged. And there was no frozen
vector, so the field ORDER was entirely unpinned: swapping two slots keeps the suite green while
changing every signature the module will ever produce. There is a golden vector now; it is the
artifact a second implementation conforms against.

A redelivered envelope reported a chain gap. Delivery derives pending from the log and retries
across restarts, so redelivery is *designed* behaviour — its `doc_prev_hash` is the predecessor while
the head is its own hash. `{ duplicate: true }` now, which agrees with §16.7-5's set-based replay and
with the store's own `ON CONFLICT DO NOTHING`. The two chain verifiers also share one vocabulary;
a second set of strings for the same two failures means a policy-log query keyed on one silently
misses the other.

### Gates

`test` **2744 passed / 11 skipped** · `lint` · `typecheck` clean.

### Milestone state

P0 ✅ · P1: ENGINE ✅ WRITE ✅ GATE ✅ REJECT ✅ · SCREEN-1 🅿️ (Andre's call) ·
P2: ENVELOPE ✅ · **HANDSHAKE-1 next**, then DELIVERY-1, LIFECYCLE-1, NOTIFY-1.
