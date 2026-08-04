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
