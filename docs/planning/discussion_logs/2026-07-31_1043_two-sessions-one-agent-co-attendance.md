---
name: two-sessions-one-agent-co-attendance
type: discussion
date: 2026-07-31
topics: [co-attendance, multi-session, agent-identity, read-before-write, message-delivery, relay-ordering, seal-integrity, content-dedup, daemon]
description: >
  Two sessions on one agent silently steal each other's messages, because a multicast doorbell feeds a
  destructive single-consumer queue. Decision: co-attendance, not exclusivity. Also settles that the relay
  is a true sequencer, and traces two receipt-integrity defects found on the way — one fixed, one open.
---

# Two sessions, one agent

**Status: design decided (co-attendance). Two implementation defects proven and unfixed. All four
§9 open items CLOSED by third-party validation on 2026-07-31 (code anchors re-verified, §7c resolved
from the live log) — see §7c and §9.**

> ### Build order — DECIDED 2026-07-31, after post-M12 verification
>
> **§7a goes first, on its own, and before the next `latest` promotion.** It fires deterministically
> (16 of 16 — every conversation where the first message beat relay registration and then continued),
> it is same-machine-only, and same-machine IS the solo multi-agent wedge: Andre's daily use and the
> demo. Per §7d the consequence is that **the certificate omits the conversation's opening message
> while still being issued**. A trust product survives clunky UX; it does not survive a receipt that
> quietly isn't over the whole conversation. The fix is producer-side and contained.
>
> *Practical reason for "before the promotion" specifically:* a daemon fix that lands before the
> pending promotion costs operators one upgrade instead of two. After it, §7a needs its own
> publish-and-upgrade round.
>
> **Co-attendance and §7b come after.** Co-attendance changes delivery semantics across several
> surfaces and earns a real test pass; §7b has had zero observed instances since its producer was
> closed, so it is latent rather than bleeding. Both are forgivable at launch — a session stealing a
> sibling's message is visible and workable-around; a receipt missing its first message is neither.
>
> This order is also the one §7b's own fix *requires*: keying dedup on relay position inherits a
> broken key while §7a's drift persists (recorded against `DOD-FRONTIER-STRAND-1` in
> [[M8C-DEFINITION-OF-DONE]]).
>
> ### ⚠ Post-M12 verification — what moved
>
> Verified against post-M12 code on 2026-07-31. **The co-attendance surface is untouched by M12** —
> the queue, the doorbell, the cursor and `use_agent` are all client/daemon-side and exactly where
> this document says. M12 moved directories, relay, portal and ops-agent; it did not touch delivery.
> §5's premise re-checked and holds: the relay still assigns `seq` from its own counter and still
> rejects a `last_seen_seq` ahead of it, so two sessions on one identity still cannot collide.
>
> **§7c/§7d are the exception — not wrong, but written against a world M12 changed. Re-read them
> against current code before implementing, and treat their line numbers as stale (the symbol names
> still anchor).** Three changes:
> 1. The relay now asks the **brokering directory per session** and follows a **seal redirect** to
>    the node that can finish the seal — §7c describes two close paths; there is now a hop inside one
>    of them.
> 2. The certificate-root code was **refactored**: `recomputedRoot` is real and still cross-checked
>    against the relay's root, but no longer at the cited lines.
> 3. `seal_notarizations` now **replicates by anti-entropy**, which it did not when this was written.

> **Picking this up cold? Go to §10 first.** Every claim below is anchored to a file and symbol there,
> grouped by section, along with the log events to grep. You should not need to search for anything.

## 1. The symptom

Two Claude sessions drive the same agent on the same daemon. A message arrives. One session gets it;
the other is told nothing arrived. Neither is told the other exists.

This was logged once before, incidentally, and left open:
[[2026-07-29_1730_coworker-session-scoped-mcp-calls-fail]] closes with *"Two sessions silently shared
one agent identity and neither side was warned."* No work item was ever raised from it. This is that
work item.

## 2. Root cause — a multicast wake-up feeding a single-consumer queue

Three mechanisms, individually reasonable:

1. **Attachment is unrestricted and uncounted.** `cello_use_agent` checks the agent exists and that
   *this* connection doesn't already hold it. It never looks at any other connection. `isAttended()`
   returns a boolean on first match — the daemon deliberately never counts.
2. **The doorbell is multicast.** `dispatchCelloMessage` loops every connection and pushes to each one
   where that agent is current. One message, N wake-ups.
3. **The content queue is destructive and single-consumer.** `#receivedContent` is keyed
   `(agentName, sessionId)` — not by connection. `takeReceivedContent` is `buf.shift()`.

Both sessions are woken. Both enter the poll loop (20 ms tick). Whichever hits the next tick first
gets the message and **removes** it.

**The loser's answer is indistinguishable from silence:**
`{ ok: true, content: null, guidance: "No content arrived within timeout_ms…" }` — identical to a
quiet counterparty. **The plain blocking receive logs nothing at all**, on either outcome, so the
theft leaves no trace anywhere.

### 2b. And then it replies blind

The send gate is `connectionCursor >= currentSeq || unreadReceived === 0`. The winner's read calls
`advanceLastDeliveredSeq`, which is **agent-scoped** — so `unreadReceived` drops to zero for *both*
sessions and the loser's reply is permitted although it never saw the message.

That is `DOD-CURSOR-DURABLE-1` behaving exactly as its own §6 predicted: *"Window 2 can reply
context-blind to something it never saw."* The trade was made deliberately, to unblock stateless
clients. It is the right call for that problem and the wrong shape for this one.

Note `launch-triage.md` lists the reply guard under **"Already solid — confirmed working"**. That
rests on `DOD-CURSOR-1`, whose own DoD text says the two-window scenario was never run. **That line
needs correcting.**

## 3. The decision — co-attendance, not exclusivity

**Rejected: one session per agent.** Reasons, in order of weight:

- **It is not the simple option, it only sounds like one.** Connections die constantly — daemon
  restart, MCP reconnect, laptop sleep (the daemon bounced twice during this very discussion). Every
  one either strands the agent behind a dead claim or needs a takeover protocol. The hard part isn't
  skipped, it's relocated.
- **It buys no cryptographic property.** The seal attests the *identity*, not the seat —
  `attestation_mode: "live"` says a live counterparty authored the messages, not which client did.
  Exclusivity is local hygiene, not a trust guarantee.
- **It fixes the wrong half.** The command-line path has no live connection to key exclusivity on;
  its identity is a file (§6). Daemon-side exclusivity leaves that untouched.
- **It forecloses listener mode** — several sessions watching one agent's conversation live. Free
  under co-attendance, needs a second mechanism invented under exclusivity.

**Chosen: co-attendance.** Its mechanism subsumes exclusivity (which becomes a flag on top), and the
turn-taking that looks hairy is the existing guard working properly rather than a new state machine:
`currentSeq` counts every leaf including sends, so A's reply raises the bar, B is refused, B reads,
B sees A already answered, B decides. No global barrier — a stale session blocks only itself.

### 3b. What co-attendance requires that we did not have

**Catch-up must include your own side's messages.** Receiving only ever returns the *counterparty's*
messages. A sibling session's reply is in the record but never delivered through that path. So the
second session reads the counterparty's message, is still one short of the bar, asks again, gets
nothing, and is stuck — it can never clear the bar that way.

That is the same shape as the bug that stopped command-line sessions replying: a rule satisfiable
only through a door the caller isn't pointed at. It would hit the second session **every time a
sibling replies first**, which is the common case. Catching up has to mean *"everything since my
bookmark, whoever wrote it"* — which the second session needs anyway, to decide whether it still has
anything to add.

*(Validation 2026-07-31: partially corrected. The "stuck forever" claim is overstated — a
both-directions catch-up door already exists: `cello_get_transcript` returns sent + received and
advances both the connection cursor and the persisted watermark via `safeCursorAdvance` /
`safeWatermarkAdvance` (`session-read-handlers.ts:130-146`, whose comment names exactly this
sibling-send scenario). And under the *current* gate the second session is never blocked at all —
the `unreadReceived === 0` authority passes once anyone has read (§2b). The real spec requirement
stands in weakened form: `cello_receive since_seq` alone cannot clear a tightened cursor bar, so the
spec must either extend `since_seq` to both directions or route catch-up through the transcript
path.)*

## 4. The send window — a race that makes a strict gate theatre

Between the gate passing and the message being recorded there are **two awaits** — the security
screening (a round trip to the gateway process) and the send itself (relay submission plus
delivery). **The gate is never re-checked after either.**

Two sessions can both be cleared, both wait, and both write. Nothing changes between them: no leaf
has been appended, so the second's check sees exactly what the first saw. The counterparty gets two
replies to one message — both correctly signed and ordered, the record coherent, the conversation
not.

The **inbound** path was hardened against precisely this and says so: *"Adding any further await
between here and the append reopens the window."* The outbound path never got the same treatment.
Fix: re-check in the same synchronous window as the append — the pattern already used twice inbound.

**Tightening the gate without closing this window produces a strict-looking rule the race walks
straight through.** They land together or not at all.

## 5. Settled: the relay IS a true sequencer

Concurrent writes were the main worry about co-attendance. They are covered, by a stronger mechanism
than expected.

On `hash_submit` the relay **ignores the sender's claimed position entirely**: `seq = seq_counter + 1`
from its own counter, `prevRoot = state.running_root` from its own tree, then signs. The sender may
only declare `last_seen_seq`, and claiming to have seen more than exists is rejected outright.

- **Two parties writing at once cannot fork the record.** The relay serializes them.
- **Two sessions on one identity cannot collide at all.** All of an agent's sessions share ONE relay
  stream and submissions on it are strictly one-at-a-time — serialized before reaching the counter.
- **The local record is written after the relay assigns**, deliberately, so a message occupies the
  same position whether it went straight through or sat parked.

So the chain cannot fork from co-attendance. What co-attendance risks is **semantic**: a message
perfectly signed, correctly chained, non-repudiable — and conversationally stale. That is the right
kind of failure to have.

## 6. The command-line selection is one machine-wide file

`~/.cello/current-agent` — present, in use, written by `use-agent`, cleared only by `stop-agent`
naming that agent. Every `cello` process in every terminal shares it.

Not a security problem (an agent name, and the ENOENT-only catch is deliberately careful). It is a
**shared-state** problem, and it carries no liveness: nothing ever writes "I'm finished," so a crash
leaves it stale. That is fine for a *preference* — "the last agent you chose" is still a good default
after a crash — and it is why exclusivity must never live in a file. **A file cannot carry a liveness
claim, because no process is alive to retract it.** Only the daemon has that signal.

**The receptionist writes it.** `cello-receptionist.md` runs `cello use-agent "$AGENT_NAME"` then
polls `cello inbox --scope current` every 10 s, each poll a fresh process re-reading the global file.
**Two receptionists for two agents will fight over it** — whichever ran `use-agent` last owns it, and
both then report on that agent. Their own guard comment names the symptom (*"announcing another
agent's callers as if they were this one's"*) and guards the wrong cause: it catches an empty name at
startup, never a concurrent overwrite mid-loop.

Fix: `cello inbox --agent "$NAME" --scope current`, and stop writing the shared file. The receptionist
*skill* already tells its operator to pass the agent explicitly "which another session or an MCP
reconnect can change underneath you." The subagent doesn't follow its own advice.

**Weighting, recorded deliberately:** the receptionist is a last-resort workaround for harnesses with
no event injection and no long-polling (Cowork can schedule at most hourly, and has no hooks). Andre
wants **as few users as possible** depending on it. It gets the two-line fix and nothing is built on
top of it. It does not get a vote on the architecture.

## 7. Found on the way — receipt integrity

Investigating ordering turned up two defects that are **independent of the co-attendance decision**
and outrank it on the "would this ruin a customer" test.

### 7a. Position drift — loopback only, deterministic, and NOT benign (see §7d)

The branch that fires when the relay says a message belongs at a position the local record has passed
— its own comment says the invariant "is at risk" — **has fired 32 times in the live log**, always off
by exactly one, sometimes on every message of a conversation.

**Cause, proven.** The session's **first** message is sent before the relay has registered the
session; the submission is rejected `session_not_found`; the daemon records the message anyway
(deliberate — losing content is worse than a mis-order); the relay's counter therefore never counts
it, and the local record stays exactly one ahead **for the life of the conversation**.

| group | sessions | drifted |
|---|---|---|
| Same-machine, no failed submission | 91 | **0** |
| Same-machine, failed submission, conversation continued | 16 | **16** |
| Same-machine, failed submission, ended after one message | 10 | 0 |
| Remote counterparty | 24 | **0** |

Not a rate — 100% of "first message beat the relay and the conversation carried on." The ten that
stopped after one message never drifted because nothing came after to be misplaced. Same-machine only
because local delivery is instant while relay registration is a round trip to another region; a
remote counterparty cannot win that race.

Seal rate is unaffected: 75% with the drift, 72% without.

**⚠ That measurement was the wrong question, and this line originally called the drift benign on the
strength of it.** §7d establishes that the certificate is built **exclusively from relay-witnessed
leaves**. The drifted message is by definition the one the relay never witnessed (its submission was
rejected `session_not_found`) and it was never resubmitted — the persistent off-by-one is itself the
proof the relay's counter never counted it.

**So the certificate for an affected conversation omits its opening message.** Both parties' local
transcripts contain it; the notarized record does not; nothing anywhere reconciles the two. Certificates
kept being issued at the normal rate — over a record short one message. Rate was never the measure.

This is a receipt-integrity defect, not a bookkeeping one, and it is the strongest argument for fixing
the producer (make the first message wait for relay registration, or resubmit on registration) rather
than tolerating the drift.

### 7b. The lost receipts — identical content, deduplicated on one side only

Two conversations were **rejected with `leaf_count_mismatch`**, the two sides disagreeing on how
many messages exist. Operator text: *"The two sides have divergent session histories and cannot
form a bilateral commitment."* *(Correction 2026-07-31: only one — `dbb93dfc…` — actually ended
with no receipt. The other, `1c9ad6a8…`, sealed three minutes after its rejection via the relay
auto-ack path, which performs no comparison at all — see §7c.)*

**Cause, proven.** The away autoresponder fired twice with **identical text**. The sender appended it;
the receiver hashed it, found that hash already at position 0, concluded redelivery, and **did not
append**. One side three leaves, the other two — diverged permanently, every later message at a
different position on each side.

The rule it breaks is stated as design intent: **"a content_hash satisfies AT MOST ONE Merkle leaf,
exactly once."** That is false whenever two genuinely distinct messages match.

**Believed fixed.** Last occurrence 23 July; `DOD-INBOX-ONESHOT-1` (23–24 July) makes the second reply
a *different* rejection text and closes the session, so the greeting can't repeat. Evidence is
consistent, not conclusive: two clean conversations since, and the pre-fix population also contains
clean cases.

**What was closed is a producer, not the check.** Duplicate detection still matches on content alone,
and the check **spans both parties' messages** — so any two identical messages by either side collide.
Andre's point: two instances of the same model, same incoming message, similar context, make an
identical reply far likelier than the human baseline, and the wrap/over convention encourages exactly
the terse turns most likely to match byte-for-byte. Zero observed instances; the failure is silent,
destroys a receipt, and gets likelier precisely as same-model agent-to-agent grows — which is the
wedge.

**The discriminator already exists.** The relay assigns every submission a unique position.
Redelivery carries the *same* position; a genuinely new identical message carries a *new* one. Key
the rule on position, not content. Every legitimate case in the log (all park-recovery after a
liveness drop) carries the original position and would still be caught. Scope note: the map from
content hash to canonical position is *also* hash-keyed, so it's one assumption in at least two
places.

### 7c. ✅ RESOLVED (2026-07-31, third-party validation) — the worse possibility is the true one

> **⚠ Post-M12: the two close paths described here still exist, but there is now a hop inside one of
> them** — the relay asks the brokering directory per session and follows a **seal redirect** to the
> node that can finish the seal. Line numbers stale, symbols hold. The finding (the auto-ack path
> never compares the parties' trees) is unaffected; the path it travels is longer.

**The both-parties-present path does not catch what the interrupted path does.** There are two
bilateral close paths, and only one compares the parties' state:

1. **Directory-signaling close** (`seal_interrupted_request` → `inbound-seal-request.ts:108`) —
   compares leaf counts against local state. This is the only path that can notice divergence, and
   it is the path the observed `leaf_count_mismatch` rejections came through.
2. **Relay auto-ack close** (`submitSealLeaf` → `session.seal.autoacknowledged` → FROST ceremony) —
   each party independently submits a SEAL ctrl leaf over **its own** root
   (`session-node-manager.ts:3281`); **nothing ever compares the two parties' trees to each
   other.** The auto-ack gate refuses only on `#contentDesynced` (observed tamper), not on
   divergence.

**Proof from the live log.** Session `1c9ad6a8…` (divergent, one of the two `leaf_count_mismatch`
sessions) was rejected `leaf_count_mismatch` via path 1 at 08:17:29 on 2026-07-23 — and **sealed
successfully via path 2 three minutes later** (08:20:45 `session.seal.leaf.submitted` ×2 →
`autoacknowledged` → `session.seal.completed`, sealed root `2aa6dc6b…`). The same divergent session:
one path rejects it, the other notarizes it.

Second proof: session `05f3fb04…` ended with the two sides' trees at **different roots** at leaf 14
(`0111cd4b…` vs `2dbaeebd…`), yet sealed — and the certificate's `sealedRoot` (`104840…`) matches
**neither** side's local root. At least one party therefore holds a certificate whose root its own
record cannot reproduce. The certificate root is derived from the relay-witnessed chain, and each
client's `frontier.verified` check verifies against relay-shipped signed leaves — never against its
own local tree — so local divergence is invisible to the entire live-close verification chain.

Re-run of the log analysis (loopback sessions, divergence = conflicting roots at the same leaf index
or a leaf index appended on only one side): **12 divergent conversations, 10 sealed, 1 never
attempted a seal, 1 (`dbb93dfc…`) rejected with no receipt.** So "two conversations were
force-abandoned with no receipt" (§7b) overcounts by one: `1c9ad6a8…` did get a receipt, through
path 2.

**Consequence for the spec:** "receipts are safe when both parties are present" is true only in the
sense that a certificate gets issued — not that the certificate matches both parties' records. The
seal attests the relay-witnessed chain; a locally-divergent party still gets (and verifies) the
certificate. Fixing the divergence *producers* (§7a drift, §7b content-dedup) is therefore the real
fix; adding a party-vs-party root comparison to the auto-ack path would only convert silent
divergence into seal failures.

### 7d. ✅ Residue closed — what computes the certificate's root, and what it therefore attests

> **⚠ Line numbers below are pre-M12 and stale; the symbols hold.** The certificate-root code was
> refactored during M12 — `recomputedRoot` is still real and still cross-checked against the relay's
> root, but not at the cited lines. The *conclusion* of this section is unaffected. Re-read against
> current code before implementing. See the build-order block at the top.

**Both, cross-checked.** `processSeal` (`packages/directory/src/directory-node.ts:4740-4760`) is
called **in-process by the relay** once both SEAL leaves are submitted, receiving the relay's leaf log
*and* the relay's running root. The directory then rebuilds the tree **from scratch** over
`encodeStructure2` of each relay-witnessed leaf and **refuses to take the relay's word for it**:

```ts
const recomputedRoot = merkleRoot(buildMerkleTree(leafInputs));
if (!bufEqual(recomputedRoot, relayRoot)) → merkle_root_mismatch
```

— then verifies each leaf's Structure-1 signature, the `prev_root` chain, and the `last_seen_seq`
causal chain. Two independent computations of the same root that must agree; the directory does not
trust the relay. That is a good property, and it is not the one people assume it is.

**Neither party's local record is an input at any point.** `reported_root` never enters this path —
it appears only in the separate seal-*attempt* flow (PERSIST-014, `:3996`) and in the unilateral
rebuild. So the certificate attests **the relay-witnessed leaf sequence, independently rebuilt and
signature-verified**. It does not attest that either participant's transcript matches it.

This is why there is no comparison to add on the auto-ack path: the client's tree is not merely
unchecked, it is **outside the model**. Introducing it would be a protocol change, not a fix.

**And it inverts §7a's conclusion — see below.**

## 8. What changes for the operator

1. A message can no longer be taken by the wrong session — delivery reads a durable record against a
   per-session bookmark instead of popping a shared queue.
2. Silence stops being ambiguous — "nothing arrived" and "another session took it" become different
   answers.
3. You find out when you're not alone — attach, status, and the arrival alert all carry the count.
4. Receiving leaves a trace in the log; today it writes nothing on either outcome.
5. Catching up shows everything since your bookmark, whoever wrote it (§3b).
6. Before any session may reply it must have caught up on everything since it last looked, including
   a sibling's reply — and the re-check happens in the same step as the write (§4).
7. The receptionist stops re-pointing other terminals (§6).
8. `launch-triage.md`'s "reply guard confirmed working" line is corrected (§2b).

## 9. Open items

| # | Item | Status |
|---|---|---|
| 1 | Why seven divergent conversations sealed anyway (§7c) | ✅ **CLOSED 2026-07-31** — the auto-ack close path never compares the parties' trees; proven live (`1c9ad6a8…` rejected then sealed). See §7c. |
| 2 | Catch-up deadlock across a sibling's reply (§3b) | ✅ **Closed by code reading** — `cello_get_transcript` is the both-directions catch-up door: it advances the cursor AND the persisted watermark (`session-read-handlers.ts:137-146`), and its own comment names the second-connection sibling-send case as its purpose. No deadlock today (the `unreadReceived === 0` authority also passes); under a tightened gate the transcript path is the designated door — the spec should either point at it or extend `since_seq` to both directions. Still untested at runtime. |
| 3 | Whether `--scope current` honours an explicit `--agent` | ✅ **CLOSED — it does.** `--agent` replays `cello_use_agent` on the CLI's fresh connection (`parity-commands.ts:133-153`) without writing the shared file; the daemon's scope-current handler reads that connection's current agent (`notification-handlers.ts:51`). The §6 receptionist fix works as written. Caveat: the replay fails loud (`selected_agent_offline`) rather than auto-starting an offline agent — correct for the receptionist. |
| 4 | `--agent` declared `consumesValue: false` on most commands, `true` on one | ✅ **CLOSED — deliberate, documented at `registry.ts:217-223`**: `splitAgentFlag` owns the value; `consumesValue: false` keeps `--agent --bogus` fail-loud. The lone `true` (registry.ts:509) loses that protection for its command — a one-line harmonization, not a defect. |

## 10. Where to look — code anchors

**Line numbers are hints; the symbol names are the anchor.** Everything below was read directly during
this investigation on 2026-07-31 except the three marked ⚠, which come from earlier vault documents
and were not re-verified. Repo roots: `cello-client/` (client + daemon + CLI),
`trustless-cello/` (relay + directory).

### The interception itself (§2)

| what | where |
|---|---|
| The shared content queue — keyed `(agentName, sessionId)`, **not** by connection | `core/daemon/src/session-node-manager.ts:260` `#receivedContent` |
| The destructive drain — `buf.shift()` | `core/daemon/src/session-node-manager.ts:3932` `takeReceivedContent` |
| Where `cello_receive` pops it | `core/daemon/src/session-content-handlers.ts:419` |
| The 20 ms poll loop, and the benign "nothing arrived" return that hides the theft | `core/daemon/src/session-content-handlers.ts:~470-483` |
| The multicast doorbell — loops every connection where the agent is current | `core/daemon/src/notification-dispatcher.ts:154-176` `dispatchCelloMessage` |
| Producer side: buffer push then doorbell | `core/daemon/src/session-node-manager.ts:3855-3890` `#appendVerifiedContent` |

**Note:** the plain blocking receive has **no logging on either outcome** — the only log in that path
is `session.receive.since_seq` (`session-content-handlers.ts:390`), which is the other branch. Adding
observability here is item 4 of §8.

### Attachment — no exclusivity, no count (§2, §3)

| what | where |
|---|---|
| `cello_use_agent` — checks existence and *this* connection only; never consults another | `core/daemon/src/agent-handlers.ts:322-375` |
| `isAttended()` — boolean on first match, deliberately never counts | `core/daemon/src/daemon.ts:846` |
| Per-connection state init (`currentAgent: null` on connect) | ⚠ `core/daemon/src/daemon.ts:919` |

### The reply gate and the send window (§2b, §4)

| what | where |
|---|---|
| The gate, its two authorities, and the long comment stating the trade | `core/daemon/src/session-content-handlers.ts:80-130` (`caughtUp` at ~103) |
| `session.send.blocked` — logs both authorities so you can tell which refused | `core/daemon/src/session-content-handlers.ts:109` |
| **Await 1** — security screening, a round trip to the gateway process | `session-content-handlers.ts` ~line 140, `securityGateway.screenOutbound` |
| **Await 2** — relay submit + direct delivery | `session-content-handlers.ts` ~line 229, `sessionNodeManager.sendContent` |
| The append — no gate re-check between it and either await | `core/daemon/src/session-content-handlers.ts:262` `appendSessionLeaf` |
| Sender advances its own cursor | `core/daemon/src/session-content-handlers.ts:271` |
| **Agent-scoped** read watermark advanced on receive — why the loser's send is permitted | `core/daemon/src/session-content-handlers.ts:421` `advanceLastDeliveredSeq` |

**The pattern the fix should copy** is already in the same file's inbound sibling — a post-await
re-check in the same synchronous window as the write, with an explicit comment that any further await
reopens the window: `core/daemon/src/session-node-manager.ts:3682-3695`.

### The catch-up gap (§3b)

| what | where |
|---|---|
| `since_seq` branch — reads the durable transcript, filters `direction === "received"` (this is the gap: a sibling's send is never returned) | `core/daemon/src/session-content-handlers.ts:366-394` |
| `safeCursorAdvance` — deliberately refuses to advance past a gap, e.g. a sibling's sent leaf | `core/daemon/src/session-content-handlers.ts:33-36` (interface), call sites at `:388`, `:427` |

### Relay ordering — the sequencer (§5)

| what | where |
|---|---|
| **The whole answer**: `last_seen_seq` sanity check, `seq = state.seq_counter + 1`, `prevRoot = state.running_root` | `trustless-cello/packages/relay/src/relay-node.ts:1125-1131` |
| "the relay is the Structure-2 ordering authority" + `relay.hash.submitted` | `trustless-cello/packages/relay/src/relay-node.ts:1182-1195` |
| One stream per **agent**, submits globally FIFO-serialized — why two sessions on one identity cannot collide | `core/daemon/src/session-relay-client.ts:1-28` (header comment) |

### Ordering, drift and held content (§7a)

| what | where |
|---|---|
| The strict in-order gate, the hold-and-release, and the `sequence_behind_tree` contradiction branch | `core/daemon/src/session-node-manager.ts:3737-3785` |
| `#witnessedSeq` — hash → canonical position. **Also hash-keyed**, so it shares §7b's assumption | `core/daemon/src/session-node-manager.ts:288` |
| `#heldContent` — out-of-order arrivals, not yet durable leaves | `core/daemon/src/session-node-manager.ts:294`, released by `#releaseHeld` at `:3902` |

### Duplicate detection (§7b)

| what | where |
|---|---|
| **The rule**, stated as design intent: *"a content_hash satisfies AT MOST ONE Merkle leaf, exactly once"* + the `indexOfHash` scan | `core/daemon/src/session-node-manager.ts:3557-3566` |
| The post-screening re-check (second dedup site) | `core/daemon/src/session-node-manager.ts:3682-3695` |
| The one-shot rule that closed the *producer* | `docs/planning/user-stories/m8c/M8C-DEFINITION-OF-DONE.md` → `DOD-INBOX-ONESHOT-1` (line ~2123) |

### Persistence and rebuild (needed for §7c)

| what | where |
|---|---|
| Append → `INSERT INTO session_tree_leaves` + keeps `sessions.message_count` in sync | `core/daemon/src/session-node-manager.ts:2993-3020` |
| Rebuild from disk, ordered by leaf index | `core/daemon/src/session-node-manager.ts:4141-4152` `#loadTreeFromDb` |

### Seal paths — start here for §7c

> **⚠ Every `trustless-cello/packages/directory` line number in this table is PRE-M12 and stale.**
> The seal path moved during M12: a per-session brokering-directory lookup plus a **seal redirect**
> hop, a refactor of the certificate-root code, and `seal_notarizations` now replicating by
> anti-entropy. Symbol names (`processSeal`, `rootsMatch`, `recomputedRoot`) are the anchor — grep
> for those, not the lines. `core/daemon` rows are unaffected: M12 did not touch the client.

| what | where |
|---|---|
| The client seals over **its own** record | `core/daemon/src/seal-flows.ts:371` `getSessionTreeRootHex` |
| `leaf_count_mismatch` — the check the two failures hit | `core/daemon/src/inbound-seal-request.ts:101-108` |
| Carried leaves are **relay-witnessed only** (own from `hash_submit_ack`, counterparty from `leaf_deliver`) — why an unwitnessed message breaks a unilateral rebuild | `core/daemon/src/session-seal-leaf-store.ts:1-16` |
| **The bilateral certificate's root (§7d)** — called in-process by the relay; rebuilds from the relay's leaf log and cross-checks against the relay's running root. **Neither party's tree is an input.** | `trustless-cello/packages/directory/src/directory-node.ts:4740-4760` `processSeal` |
| ⚠ `rootsMatch` — party-vs-party, but this is the seal-**attempt** frame (PERSIST-014). It only acks or notifies; it does NOT notarize. Easy to mistake for the bilateral path | `trustless-cello/packages/directory/src/directory-node.ts:3996` |
| Unilateral: rebuild + verify against `reported_root` | `trustless-cello/packages/directory/src/directory-node.ts:4027, 4118-4121` |
| The auto-ack path that compares nothing (§7c path 2) — refuses only on observed tamper | `core/daemon/src/session-node-manager.ts:3281` `submitSealLeaf` / `#contentDesynced` |
| Client-side frontier re-derivation | `core/daemon/src/seal-coordinator.ts:160-185` |

### The command-line selection file (§6)

| what | where |
|---|---|
| Why it persists — the per-invocation current-agent problem | `core/cli/src/parity-commands.ts:12-28` |
| The path: `~/.cello/current-agent` | `core/cli/src/parity-commands.ts:44-46` |
| Read / write / clear | `core/cli/src/parity-commands.ts:56-83` |
| Only writer (`use-agent`) and only clearer (`stop-agent`) | `core/cli/src/parity-commands.ts:314-338` |
| The receptionist's bash loop that writes it every time | `plugins/cello/agents/cello-receptionist.md` |
| `inbox` command definition (`--agent`, `--scope`) — for open item 3 | `core/cli/src/registry.ts:659-680` |
| ⚠ `contactCommand` doesn't replay the selection — `settings set` / `moniker set` write to the wrong agent on a multi-agent machine | ⚠ `core/cli/src/commands.ts:590` (from [[2026-07-13_dead-code-and-defect-reduction-workplan]] §1.3) |

### Reproducing the evidence from the live log

Everything quantitative in §7 came from `~/.cello/daemon.log` (JSON lines, one object per line — parse
with `json.loads`, group by `sessionId`). The events that matter:

| event | what it tells you |
|---|---|
| `session.content.sequence_behind_tree` | the drift; carries `canonicalSeq` + `nextExpected` (offset is always 1) |
| `session.relay.hash.submit.failed` + `session.content.unwitnessed` | the **cause** of the drift — always at the session's first message |
| `session.content.deduplicated` | carries `contentHashHex` + the existing position; cross-reference against `content.recovered` (legitimate) vs `session.away.response.sent` (the §7b bug) |
| `session.tree.appended` | `leafIndex` + `newRootHex` + `correlationId` — **the divergence is visible as one side appending without the other**, and identical roots prove identical records |
| `transcript.message.recorded` | carries `agentName` — count distinct agents per session to classify **loopback (2) vs remote (1)** |
| `leaf_count_mismatch` (in `reason`) | the two lost receipts |
| `seal.certificate.frontier.verified` / `session.sealed.received` | seal outcomes, for the control comparison |

**Two classification tricks used throughout:** distinct `agentName` values per session separates
same-machine from remote conversations; and in a loopback conversation every message produces **two**
`transcript.message.recorded` events (one per local agent), so halve the count to get real messages.

## Related

- [[M8D-DEFINITION-OF-DONE]] — **the milestone this document is the spec-of-record for** (opened
  2026-08-01). §2/§3/§3b/§4/§6/§8 become four DoD lines there; §7a and §7b stay in
  [[M8C-DEFINITION-OF-DONE]] as `DOD-FIRSTMSG-WITNESS-1` and `DOD-FRONTIER-STRAND-1`.
- [[M8D-PROCEDURE]] — how to work it; §10's anchors are the map it tells the coder to use
- [[2026-07-29_1730_coworker-session-scoped-mcp-calls-fail]] — where this was first seen and left open
- [[2026-07-01_1030_command-surface-and-notifications-design]] — Gap 1, the group-chat model, and the
  decision to use read-before-write rather than attendance locking
- [[2026-07-11_cursor-durable-read-before-write-design]] — the per-connection → per-agent relaxation,
  whose §6 predicted §2b exactly
- [[2026-07-10_daemon-singleton-defects]] — the multi-daemon version of one identity in two places
  (fixed 2026-07-13)
- [[M8C-PHANTOM-SESSION-FIX-PLAN]] — the first-connect race; §7a is the same family under another name
