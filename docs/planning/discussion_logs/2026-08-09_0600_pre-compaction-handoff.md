---
name: pre-compaction-handoff
type: discussion
date: 2026-08-09
topics: [compaction, handoff, m14, document-types, publishing, launch-triage, relay, seal]
description: >
  Cold-start handoff written before compaction. Exact version and deployment state, the one piece of
  work that is committed and unpublished, what the next context builds first, and the design
  decisions that are settled and must not be re-opened.
---

# Pre-compaction handoff — 2026-08-09

Read this cold and you can start working. It records STATE and DECISIONS. The reasoning behind each
lives in the documents it points to; do not re-derive it.

---

## 1. The one thing that needs doing before anything else — DONE, awaiting promotion

**The close-time seal pull is published and NOT yet promoted.** `DOD-TERMINAL-STATE-DIVERGENCE-1`,
cello-client `f6af6b5`, shipped as **`daemon 0.0.151` / `cli 0.0.158`** on tag `v0.0.223`.

Gate was green before the bump (3403 tests, lint, typecheck, build). `smoke-tag` green. Verified
against the tarball rather than the commit log: `recovered_on_close`, `asked_none_exists`,
`pull.none_on_close` and `MAY_ALREADY_BE_SEALED` are all present in `0.0.151`'s
`dist/close-session-handler.js`, and **absent** from `0.0.150` — which is the control that proves the
change is new rather than assumed. `cli@0.0.158` cross-pins `daemon@0.0.151` as a real version.

**What is left: Andre promotes.** Until he runs the seven `dist-tag` lines, `latest` still resolves to
`daemon 0.0.150` and no operator has this fix.

## 2. Exact state, 2026-08-09

**Published AND promoted to `latest` (beta and latest agree on every package):**

| package | version |
|---|---|
| `connect` | 0.0.135 |
| `cli` | 0.0.157 |
| `daemon` | 0.0.150 |
| `gateway` | 0.0.28 |
| `crypto` | 0.0.44 |
| `transport` | 0.0.50 |
| `protocol-types` | 0.0.48 |

Andre is on `latest` with **no pins**. Never propose one.

**Infrastructure:** both relays run image **`relay:0cf04b0c`** (reconnect + directory probe + the
health check that reports `degraded` at HTTP 200). Deployed and verified 2026-08-08.
`infra/GCP-STATE.md` is current.

**Repos:** both `main`, both pushed, nothing unpushed. `trustless-cello` carries one unrelated
pre-existing modification (`packages/e2e-tests/src/spine/j-gcp-live.spine.test.ts`) that was already
dirty at session start — not mine, leave it.

**Standing background machinery: none.** No crons, no watchdogs, no background tasks. Nothing is
waiting on a timer.

## 3. What was finished in the stretch before this

Told properly in three places; this is only the index.

- **The document verbs** — nine defects on a line that had shipped and passed every test, two of them
  work-destroying. [[M14-BUILD-JOURNAL]] Entry 36.
- **The relay stopped notarizing fleet-wide and reported itself healthy.**
  [[2026-08-08_1130_relay-stops-notarizing-fleet-wide]]. Fixed, deployed, verified.
- **A session that sealed itself three seconds after opening while both operators were away**, then
  accepted 68 minutes of work it could never record.
  [[2026-08-09_0400_a-conversation-that-was-never-recordable]]. Cause and symptom fixed, published,
  promoted, proven live.
- Both summarised in [[M14-BUILD-JOURNAL]] Entry 37.

## 4. What the next context builds

**`DOD-DOC-TYPES-1`** — [[M14-DEFINITION-OF-DONE]] § *Next unit*, and [[launch-triage]] item 19.

Order: (1) the file extension follows the document type, (2) `html`, (3) `plaintext` as an explicit
alias of `text`, (4) `json` on the map root with a per-key merge and a deterministic serialiser.

Andre's framing, which is the reason this is high on the list: *"structured data is super important —
the whole use case of working on shared goals depends on JSON."* Today agents can share prose and
cannot share structure.

## 5. Settled. Do not re-open any of these.

- **Schema-free for V1.** Andre, explicitly. No validation, no declared shape.
- **CBOR: considered, not recommended.** It buys canonical bytes a deterministic serialiser already
  gives, and costs the property that makes these files useful — that a human or an agent can open one
  and read it. Argument recorded on triage item 19.
- **The deterministic serialiser is needed now, not later.** The CRDT determines the map STATE, not
  the STRING it is printed as. The moment anyone quotes the document, everyone must produce the same
  bytes.
- **What a receipt attests to.** It commits to an ordered set of signed updates both parties agreed
  on; replaying them yields exactly one document, so provenance is proven and final content IS
  determined. Two limits survive: it is a **verifier, not a carrier** (it holds hashes and cannot
  reconstruct a document whose payloads are gone), and what it determines is the map state rather
  than any particular rendering of it.
- **Paste-and-agree.** Sending the rendered document in a message and getting an explicit "yes, I
  agree" back attests the VALUES, needs no code, and is what the certificate's own legibility block
  prescribes — agreement is always a separate signed act. Carry the document root beside the text so
  the peer verifies they are agreeing about the same document. Triage item 19.
- **Threshold `T = majority(N)`.** Closed long ago, in writing, repeatedly. Never raise it.

## 6. Standing rules that have already cost time when forgotten

- **`/cello-publish` before every publish**, for THAT publish. Hook-enforced.
- **Andre runs the promotion**, and gets all seven lines.
- **Never `pkill -f cello-daemon`** — it kills the production daemon and every live agent with it.
  Use `cello logout` / `cello login`.
- **Commit by explicit path, never `git add -A`** — a second agent shares this worktree.
- **Relay and directory rolls go one node at a time** with `terraform apply -target`. An untargeted
  apply replaces the whole fleet.
- **`infra/GCP-STATE.md` is updated immediately after every GCP change**, never batched.
- **A green marker in the triage means the code is fixed and says nothing about whether an operator
  has it.** The banner at the top of the open list tracks the difference.

## 7. The handoff Andre asked for

The launch triage is the handoff surface. His intent: *"another agent can look at the launch triage
and begin pulling down things and working on them"* — specifically the sealing and small-UX items,
worked in a separate session while this one continues M14.

[[launch-triage]] was rewritten for that: it names both repos, the publish procedure, that promotions
are his, the node-by-node roll rule, and it carries the built-but-not-shipped banner. It is
self-sufficient — a fresh context needs nothing else to start on it.

## Related

- [[launch-triage]] — the handoff surface; item 19 is the next build
- [[M14-DEFINITION-OF-DONE]] — § *Next unit* is the buildable form of item 19
- [[M14-BUILD-JOURNAL]] — Entries 36 and 37
- [[M14-PROCEDURE]] — the unit loop
