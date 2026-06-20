---
name: Client Data Custody and Encryption at Rest — M7 J-PERSIST decisions
type: discussion
date: 2026-06-20
topics: [persistence, data-custody, conversation-history, encryption-at-rest, sqlcipher, envelope-encryption, daemon, transcript, dispute, abuse-report, m7, j-persist]
status: open
description: >
  Records the design decisions (D-B1..D-B4) behind the new M7 J-PERSIST journey:
  the client must be the data custodian of its own readable conversation logs.
  The live daemon today persists only the cryptographic hash chain
  (session_tree_leaves) — the readable plaintext transcript lives in an in-memory
  buffer that is evicted on shutdown. Separately, and verified against the
  m7-rehome branch, the live daemon does NOT encrypt at rest: it uses plain
  node:sqlite and plaintext key files; SQLCipher exists only in the dead
  core/client stack. Both gaps land in one story, CELLO-M7-PERSIST-LOG-001.
---

# Client Data Custody and Encryption at Rest — M7 J-PERSIST

## Why this exists

CELLO's product promise is **"your data stays local — we are a hash custodian,
not a data custodian."** The server side honours this correctly: the directory
and relay hold only Merkle trees / MMR (hashes), never plaintext (DOD-INV-3).
But the promise has a second half that is **owed, not built**: the **client is
supposed to be the data custodian of its own conversation logs** — so the
operator can resolve disputes, report malicious behaviour, and simply know what
was said.

`CONTEXT.md:35` states an Agent "Accumulates its own conversation history and
endorsements." The intent is in the canonical glossary. The implementation is
not there. This is a genuine gap, not an intentional omission. (The *server*-side
non-storage of plaintext is intentional and correct; the *client*-side storage is
the part that was never finished.)

## Verified current state (m7-rehome, HEAD 0afce25)

Checked against the branch under active development, not main:

- **Hash chain is durable.** `core/daemon/src/session-node-manager.ts:334` —
  `session_tree_leaves(session_id, leaf_index, leaf_kind, leaf_hash_hex,
  created_at)`. Only `leaf_hash_hex` is stored — the SHA-256 leaf hashes. A fresh
  daemon rebuilds each tree from these rows so the *transcript structure* survives
  a restart. This is the authoritative Merkle transcript.
- **Readable plaintext is NOT durable.** The decrypted message plaintext lives in
  the in-memory `#receivedContent = new Map<string, ReceivedContentEntry[]>()`
  (`session-node-manager.ts:199`), drained by `cello_receive`, and explicitly
  cleared on shutdown — `#receivedContent.clear()` at :1000, with the comment
  *"plaintext must not survive shutdown in memory"*. `#evictSessionCaches`
  (:918) deletes the per-session buffer on teardown. There is no `messages`
  table and no content store. After a restart the operator has the hash chain but
  cannot read a single message they sent or received.

So today: you can prove *what the bytes were* (hashes), but you cannot *read the
conversation* after a restart. That defeats dispute resolution and abuse
reporting, both of which require the readable text.

## Encryption-at-rest finding (verified, and broader than the transcript)

While confirming the above I checked the daemon's at-rest encryption posture,
because the persistence story has to state it. The finding is decisive and
nuanced:

- **The live daemon does NOT encrypt at rest.** Every DB open in `core/daemon` is
  plain `node:sqlite` `DatabaseSync` (`session-node-manager.ts:280`). There is no
  `PRAGMA key`, no SQLCipher binding, and **no sqlcipher dependency in
  `core/daemon/package.json`.**
- **SQLCipher is real — but only in the dead stack.** `@signalapp/sqlcipher` and
  `@journeyapps/sqlcipher` are dependencies of **`core/client`**, whose
  `ClientStatePersistence` genuinely uses SQLCipher. That is the M6-era
  in-process `CelloClient` stack, which no production binary runs.
- **The daemon dropped it deliberately, with no home.** The smoking gun is the
  daemon's own comment at `core/daemon/src/registration-persistence.ts:6-16`:
  *"…deliberately does NOT drag the client's SQLCipher ClientStatePersistence into
  the daemon … consistent with the daemon's existing plaintext K_local `key` file.
  **Encryption-at-rest for the daemon is a separate future concern and is
  intentionally NOT introduced piecemeal here.**"* The K_local key, the FROST
  signing share, and the ML-DSA secret key are written as **plaintext files**
  (0o600, atomic) — file permissions only, not encryption.
- **The "SQLCipher table" comments in the daemon are aspirational.** `retry-queue.ts`,
  `nonce-dedup.ts`, and `session-tree.ts` describe their tables as "SQLCipher
  table" — inherited spec language from DAEMON-003, not what the code does. The
  `retry_queue.content_blob` already holds **plaintext message content** at rest.

Net: at-rest encryption **regressed in the daemon migration** and became a
deferral with no home — exactly the RC-1 pattern the postmortem warns about. It
is broader than the new transcript store: session metadata, the retry-queue
content blob, and the key files are all plaintext on disk today.

## Decisions

### D-B1 — Scope: a journey, not a single line. (CONFIRMED — Andre, 2026-06-20)

Persistence/data-custody becomes a new M7 journey, **J-PERSIST**, because "store
the readable text," "produce a verifiable dispute bundle," and "produce an abuse
report bundle" are distinct capabilities that share one persisted substrate.
New DoD lines: `DOD-LOG-1` (durable readable transcript survives restart),
`DOD-LOG-2` (dispute-export bundle), `DOD-LOG-3` (abuse-report bundle), and a
`J-PERSIST` row in the verification harness.

### D-B2 — What is stored: the readable transcript first; trust/endorsement records separate.

In scope now: the **readable transcript** — sent + received plaintext, per
session, in canonical sequence order, joinable to the existing `session_tree_leaves`
hash chain (so each stored message is provably the message behind a committed
leaf). Out of scope for this story (separate later work): the trust/endorsement
records and the pseudonym / conversation-participation layer (`CONTEXT.md:92`).
Rationale: the transcript is the load-bearing capability for dispute and abuse
reporting; bundling the endorsement graph in would widen the story without
serving those two jobs.

### D-B3 — Encryption at rest: in scope of the persistence story; SQLCipher OR envelope+sqlite.

Per the finding above, at-rest encryption is genuinely absent in the live daemon.
The J-PERSIST story delivers it as part of storing the transcript — it is not
acceptable to add a readable plaintext store on top of an unencrypted DB. Two
acceptable mechanisms (Andre, 2026-06-20), implementer's choice per a recorded
trade-off in the story:
- **SQLCipher** — the dependency already exists in the workspace (`@signalapp/sqlcipher`);
  re-establishes whole-DB encryption the dead stack already had. Cost: a native
  binding the daemon currently avoids (install size / compile — see the heavy-local-node
  notes in CLAUDE.md), and it replaces `node:sqlite`.
- **Envelope encryption + node:sqlite** — encrypt blob columns (transcript text,
  retry-queue content) at the application layer with a key derived from
  `identity_key`. `CONTEXT.md:64` already specifies this design surface:
  *"identity_key … Backs … the local DB key."* Keeps `node:sqlite`; no native dep.
The story records this as a closed decision *that it is encrypted*, and leaves the
mechanism to the implementer with the trade-off written down. The story must note
it closes a **pre-existing deferred gap broader than the transcript** (retry-queue
content blob, session metadata) — not only the new store.

### D-B4 — This does NOT reverse the in-memory eviction rule.

The current rule — *"plaintext must not survive shutdown in memory"* — is a **RAM
hygiene** rule (don't leave decrypted plaintext in a long-lived process's heap),
**not** a ban on encrypted disk storage. J-PERSIST adds a deliberate
encrypted-at-rest store; the in-memory buffer is still drained and cleared on
teardown. The story states this explicitly so it does not read as reversing a
privacy invariant. DOD-INV-3 (relay never sees plaintext) is **preserved and
asserted**: the readable transcript is local-only; the relay/directory logs still
show only hashes.

## What this unblocks

- `CELLO-M7-PERSIST-LOG-001` — the client durable conversation-log store.
- The dispute-resolution and abuse-report journeys (DOD-LOG-2/3), which need the
  readable text to exist before they can bundle it.

## Related

- [[CONTEXT]] — "conversation history and endorsements" (§Agent), "identity_key …
  backs the local DB key" (§Keys), conversation-participation table (§pseudonym).
- [[POSTMORTEM-seal-and-content-delivery-gaps]] — RC-1 (deferrals with no home);
  the at-rest encryption deferral is an instance.
- `core/daemon/src/registration-persistence.ts` — the explicit "encryption-at-rest
  is a separate future concern" comment.
