---
name: first-message-witness-workorder
type: workorder
date: 2026-07-31
topics: [receipt-integrity, relay-ordering, seal, session-establishment, daemon, m8c]
status: open
description: >
  Work order for the §7a fix — a session's first message is sent before the relay has registered
  the session, the submission is rejected, and the message is never witnessed. The certificate is
  built exclusively from relay-witnessed leaves, so the sealed receipt omits the conversation's
  opening message and is issued anyway. Proposed DoD ID: DOD-FIRSTMSG-WITNESS-1.
---

# Work order — the first message never reaches the relay, and the receipt is short one message

**Proposed DoD ID: `DOD-FIRSTMSG-WITNESS-1`** (open the line in
`docs/planning/user-stories/m8c/M8C-DEFINITION-OF-DONE.md` before starting).

**Repos:** the fix is in `cello-client` (`core/daemon`). The DoD line and this work order live in
`trustless-cello`. Read both sides before assuming the change is confined to one.

**Ranked #1 on [[launch-triage]] as of 2026-07-31.** Ship this alone, and before the next `latest`
promotion — landing it pre-promotion costs operators one upgrade instead of two.

---

## 1. The defect, and why it is a receipt defect rather than a bookkeeping one

`sendContent` submits the message-leaf hash to the relay **before** attempting direct delivery. That
ordering is correct and deliberate: the relay is the ordering authority, and an offline recipient
must still get a canonical sequence.

When the relay does not yet hold the session, it answers `session_not_found`. The daemon logs
`session.relay.hash.submit.failed` and **carries on** — `orderingS1`/`orderingS2` stay undefined,
nothing is queued, and nothing is ever resubmitted. The daemon then appends the leaf to its local
tree anyway, which is also deliberate (losing content is worse than mis-ordering it).

The consequence is permanent for that conversation: the relay's counter never counted that message,
so the local record sits **exactly one position ahead of the relay's** for the rest of the session.
Every subsequent message logs `session.content.sequence_behind_tree`.

**Why this is severe.** The bilateral certificate is rebuilt **exclusively from relay-witnessed
leaves**. The directory's `processSeal` is called in-process by the relay, rebuilds the tree from
the relay's leaf log, and cross-checks its own `recomputedRoot` against the relay's running root.
**Neither party's local tree is an input at any point.** The unwitnessed first message is by
definition absent from that rebuild.

So the sealed receipt for an affected conversation is a receipt over the conversation **minus its
opening message** — and it is still issued, still verifies, and nothing reconciles the two records.
Both parties' local transcripts contain a message the notarized record does not.

## 2. The evidence

From `~/.cello/daemon.log` (JSON lines, one object per line; group by `sessionId`):

| group | sessions | drifted |
|---|---|---|
| Same-machine, no failed submission | 91 | **0** |
| Same-machine, failed submission, conversation continued | 16 | **16** |
| Same-machine, failed submission, ended after one message | 10 | 0 |
| Remote counterparty | 24 | **0** |

Not a rate — 100% of "first message beat the relay and the conversation carried on." The ten that
stopped after one message never drifted because nothing came after to be misplaced. Same-machine
only, because local delivery is instant while relay registration is a round trip to another region;
a remote counterparty cannot win that race. **Same-machine is the solo multi-agent wedge — the daily
use and the demo.**

Events to grep: `session.relay.hash.submit.failed` and `session.content.unwitnessed` (the cause, at
the session's first message), then `session.content.sequence_behind_tree` (the symptom, carrying
`canonicalSeq` + `nextExpected`; the offset is always 1).

Classification trick: count distinct `agentName` values in `transcript.message.recorded` per session
— 2 means loopback/same-machine, 1 means remote. In a loopback conversation every message produces
two `transcript.message.recorded` events, so halve the count for real messages.

## 3. Where the code is

**Line numbers are hints; the symbol names are the anchor.** Verified 2026-07-31.

| what | where |
|---|---|
| The submit-then-send path; the failure is logged and execution continues | `core/daemon/src/session-node-manager.ts:3144-3169` in `sendContent` (`:3117`) |
| The comment stating why the hash submit MUST precede direct delivery — preserve this property | `core/daemon/src/session-node-manager.ts:3128-3141` |
| `submitMessageHash` / `submitLeaf` | `core/daemon/src/session-relay-client.ts:755`, `:763` |
| Local relay-session handler registration | `core/daemon/src/session-node-manager.ts:1985` `client.registerSession` |
| Where a witness is recorded when one DOES arrive | `core/daemon/src/session-node-manager.ts:3834` `recordWitnessedSequence` |
| The unwitnessed-append branch + its "weaker guarantee" comment | `core/daemon/src/session-node-manager.ts:3789-3811` (`session.content.unwitnessed`) |
| The strict in-order gate and the `sequence_behind_tree` contradiction branch (the symptom) | `core/daemon/src/session-node-manager.ts:3737-3785` |
| Relay side: the guard that rejects, and the session state it needs | `trustless-cello/packages/relay/src/relay-node.ts:1041` (`session_not_found`); state carries `assignment.participant_a/b` |
| Relay side: sequence assignment (the authority — do not move this) | `trustless-cello/packages/relay/src/relay-node.ts:1125-1131` |

**Not yet traced, and the first thing to establish:** who creates the relay's session state, and
when, relative to the client's first `sendContent`. The relay's `#store.getSession` returns nothing
at the moment of the first submit, and the state carries a directory-issued `assignment` — so trace
the producer of that state before choosing a fix. Map it as producer → consumer.

⚠ The relay/directory line numbers above may have shifted in M12 (a per-session brokering-directory
lookup and a seal-redirect hop landed). Symbols hold; re-grep rather than trusting the lines.

## 4. Scope

**In scope:** every message the relay must witness is either witnessed, or the send fails loudly.
Two shapes were named in the design; pick one on the evidence, don't assume:

- **(a) Wait** — the first message does not go out until the relay session exists.
- **(b) Resubmit** — the unwitnessed hash is retried once registration lands, and the local leaf
  reconciles to the assigned sequence.

**Out of scope — do not fix these in this change**, even though they are adjacent and you will see
them:

- The content-hash duplicate detection (§7b of the co-attendance log, `DOD-FRONTIER-STRAND-1`). It
  depends on this landing first — keying dedup on relay position inherits a broken key while the
  drift exists — but it is a separate unit.
- Co-attendance / two sessions on one agent. Separate milestone (M8D).
- The `sequence_behind_tree` branch itself. It is the symptom's alarm, not the defect. Leave it
  logging.

## 5. Hard constraints — violating any of these fails review

1. **Never lose content.** The current append-anyway behaviour exists because losing a message is
   worse than mis-ordering it. A fix that drops content when the relay refuses is wrong.
2. **The relay stays the ordering authority.** The client must never assign its own canonical
   sequence. See `relay-node.ts:1125-1131` — `seq` comes from the relay's counter, `prevRoot` from
   its own tree, and a `last_seen_seq` ahead of the counter is rejected.
3. **A relay outage must not make the inbox unreadable.** There is an explicit comment on the
   unwitnessed-append branch about exactly this. "The relay is unreachable" and "the relay has not
   registered this session yet" are different states with different correct behaviours — the fix
   must tell them apart rather than collapsing them.
4. **Sovereign-node invariant.** No assumption that all nodes are up; route around a down node.
5. **The hash submit keeps running BEFORE direct delivery.** Reversing that order breaks the
   offline-recipient park path, which has no other source of a sequence.

## 6. Falsify before you implement

Per the repo's debugging discipline, attempt to prove your fix wrong before writing it:

- If you choose **wait**: what happens when the relay never registers the session? A bounded wait
  with a named failure, or an unbounded hang? Which surface reports it?
- If you choose **resubmit**: can the same hash be submitted twice and produce two leaves? The
  receiver's dedup is content-keyed today (that is §7b), so a double-submit is not harmless.
- Does the fix change behaviour when the counterparty is offline? That path relies on the hash being
  witnessed even though direct delivery never completes.
- Does it change the first message of a **remote** session, which never drifts today? A fix that
  adds latency to the common path to repair the same-machine path is a bad trade — say so if that
  is what it does.
- State explicitly which falsification attempts you made and what survived.

## 7. Process

Non-negotiable, per `.claude/CLAUDE.md`:

- **SPARC.** Read the spec, write pseudocode, define interfaces, then TDD.
- **TDD is absolute:** write the failing tests first, confirm red, then implement, then confirm
  green. No implementation before red tests exist.
- **No mocks for crypto operations.**
- **Test fixture discipline:** extend `packages/e2e-tests/src/session-fixture.ts` with new `opts`
  fields carrying non-breaking defaults. Writing a fixture from scratch is a blocking finding.
- **Gate sequence, in order:** `pnpm run test` → `pnpm run lint` → `pnpm run typecheck` →
  `pnpm run build`.
- **Review:** dispatch `cello-unit-reviewer` with the DoD line ID and the diff. No model override.
  Fix every finding before committing. One review pass; two is the hard cap.
- **Commit with the story ID.** Commit and push after the fix and after each doc update — do not
  batch.
- **Do NOT publish or promote.** Version bump and publish go through the `/cello-publish` skill, and
  the `latest` promotion is Andre's to run. Prepare, do not execute.

## 8. Done means

- A test that reproduces the race — a first message submitted before the relay holds the session —
  and demonstrates the leaf ends up witnessed (or the send fails loudly), red before green.
- A live same-machine session whose first message beats registration produces **zero**
  `session.content.sequence_behind_tree` events, asserted on the daemon log, not on a unit test.
- The sealed certificate's leaf count equals the transcript's message count for that session.
- The gate sequence green on the committed tree, and the reviewer's findings resolved.
- `DOD-FIRSTMSG-WITNESS-1` flipped in the M8C DoD with one line of evidence, and
  [[launch-triage]] item 1 updated.

## 9. Source

- [[2026-07-31_1043_two-sessions-one-agent-co-attendance]] §7a (the defect and the data), §7d (what
  the certificate is actually built from — this is what makes §7a severe), and the build-order block
  at the top of that document.
- [[launch-triage]] item 1.
