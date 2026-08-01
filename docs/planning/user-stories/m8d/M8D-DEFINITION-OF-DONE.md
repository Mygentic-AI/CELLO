---
name: M8D Definition of Done
type: definition-of-done
date: 2026-08-01
milestone: M8D
status: active
topics: [m8d, co-attendance, multi-session, agent-identity, message-delivery, read-before-write, cursor, daemon, definition-of-done]
description: >
  The yardstick for M8D (co-attendance — several sessions driving ONE agent identity without stealing
  each other's messages). Design is already decided and recorded in
  2026-07-31_1043_two-sessions-one-agent-co-attendance: co-attendance, not exclusivity. This document
  turns that decision into enforceable lines. The enforcer is a fixture with TWO attached connections
  on one agent, plus a live two-session `claude --channels` journey — a line is ✅ only when both
  sessions' outcomes are asserted, never on a single-session unit test.
---

# M8D — Definition of Done

**Spec of record:** [[2026-07-31_1043_two-sessions-one-agent-co-attendance]]. Every line below cites
the section it comes from. That document also carries the code anchors (§10) — do not go searching.

## How to use this
- **🪶 This is a SMALL milestone — four lines, one repo, no crypto/schema/protocol change. The design
  is already decided and validated; this document is the plan.** Do not re-derive the spec, do not
  review it, do not open a determination unit. Read [[M8D-PROCEDURE]]'s 🪶 rule once, then start
  coding. The check: *would I be doing this if this line had been handed to me inside M8C?*
- This is the **target**. Find the lowest-numbered line not ✅; that's the next unit.
- **Read [[M8D-PROCEDURE]] FIRST** — it is self-contained (the two-stop rule, the small-milestone rule,
  read order, severity triage, reviewer dispatch lenses, publish sequencing, the design-note cap, the
  watchdog crons). No other milestone's procedure needs reading.
- **Evidence discipline:** a flipped tag carries ONE line of evidence plus `→ Journal Entry N`. Full
  proofs live in [[M8D-BUILD-JOURNAL]]. This document stays a scoreboard.
- **The enforcer is TWO connections, always.** Every line here is about what the *second* session
  sees. A test that attaches one connection proves nothing in this milestone. Extend
  `packages/e2e-tests/src/session-fixture.ts` with non-breaking `opts` for a second connection on the
  same agent — a from-scratch fixture is a blocking review finding (CLAUDE.md).
- **In-context hop:** lines whose behavior ends inside Claude's context (the arrival alert, the
  attendance count, the refusal text) are ✅ only after a **live two-session `claude --channels`
  journey on one agent**. Vitest green ≠ done.
- Every line carries **observability ACs**: named `domain.noun.verb` events, required context fields,
  correlationId threading, error-path coverage. Missing events are blocking (/cello-review Step 4c).
- Client-side only — everything ships via the publish cascade (/cello-publish). A line needing a
  published `connect` is not ✅ until the published artifact works.

## Status legend
✅ PROVEN (enforcer-green) · 🟡 BUILT/UNVERIFIED-LIVE · 🟠 PARTIAL · ❌ NOT BUILT · 🅿️ PARKED

---

## Scope fence — read before opening any line

**M8D is client + daemon only.** The relay, the directory, the portal and the certificate path are
all out. §5 of the spec settled that the relay is a **true sequencer** — it assigns `seq` from its own
counter and rejects a `last_seen_seq` ahead of it, and all of an agent's sessions share ONE
strictly-serialized relay stream. **Two sessions on one identity therefore cannot fork the chain.**
What co-attendance risks is purely **semantic**: a message perfectly signed, correctly chained,
non-repudiable — and conversationally stale. No crypto, no schema, no migration.

**Exclusivity is rejected, permanently — do not re-raise it** (§3). One session per agent is not the
simple option, it only sounds like one: connections die constantly (daemon restart, MCP reconnect,
laptop sleep), so every death either strands the agent behind a dead claim or needs a takeover
protocol — the hard part is relocated, not skipped. It buys **no cryptographic property** (the seal
attests the identity, not the seat). It fixes the wrong half (the CLI path has no live connection to
key exclusivity on — §6). And it forecloses **listener mode**, which co-attendance gets for free.
Exclusivity, if ever wanted, becomes a flag on top of co-attendance — never the mechanism.

### Ordering — M8D opens BEHIND two M8C lines

The spec's build-order block (decided 2026-07-31) puts receipt integrity first, and M8D is
deliberately second:

| Order | Line | Where | Why first |
|---|---|---|---|
| 1 | `DOD-FIRSTMSG-WITNESS-1` | [[M8C-DEFINITION-OF-DONE]] | ✅ shipped in daemon `0.0.106`, **ACs 7 + 8 still owed** (blocked on spine-suite rot). A certificate that omits the conversation's opening message is unforgivable; a stolen message is visible and workable-around. |
| 2 | `DOD-FRONTIER-STRAND-1` | [[M8C-DEFINITION-OF-DONE]] | ❌ open. Its position-keyed dedup fix inherits a broken key while §7a's drift persists. |
| 3 | **M8D — this document** | here | Changes delivery semantics across several surfaces and earns a real test pass. |

**`DOD-COATTEND-VISIBLE-1` is the exception** — it is the launch-gate slice per [[launch-triage]] §6
and does not wait behind the receipt work. It is cheap, additive, and converts a silent failure into
a visible one.

> **Fence re-confirmed CLOSED, 2026-08-01.** `DOD-FRONTIER-STRAND-1` is still ❌ open, and
> `DOD-FIRSTMSG-WITNESS-1`'s ACs 7–8 are still owed. Both stay in [[M8C-DEFINITION-OF-DONE]]; M8D
> does not adopt them. **Tier 1 therefore does not open**, and Tier 0 + `DOD-RECEPTIONIST-AGENT-1`
> are the whole of what M8D can work today.
>
> The thing actually blocking ACs 7–8 is spine-suite rot: 66 call sites across 20 `*.spine.test.ts`
> files still invoke `cello register <name> <token>`, a verb the CLI replaced with `create-agent` +
> `register-agent`. It is a migration, not a rename — each site becomes two commands — and M8C's DoD
> already calls it its own unit of work. **Deliberately NOT taken inside M8D**: it fails M8D's scope
> fence (no two-connection fixture run can observe it), it needs live docker-compose Postgres +
> Flyway to verify, and folding it in would entangle M8D's tag flips with M8C's. Recorded here as
> the fence, owned there.

---

## Tier 0 — LAUNCH GATE: make the theft visible

- **DOD-COATTEND-VISIBLE-1** 🟡 BUILT/UNVERIFIED-LIVE (2026-08-01) — **the launch half of §2.**

  > ACs 1–5 + 7 enforcer-green (9 clauses, two connections, real daemon + IPC; 2386/11 gate clean at
  > `0f37607`). **AC 6 owed** — the live two-session `claude --channels` journey, which also needs a
  > `connect` beta publish (the doorbell body is shim-side). Review caught the discriminator firing
  > with no sibling present; fixed + pinned by C8. → Entry 2
 Today the
  loser of a race gets `{ ok: true, content: null, guidance: "No content arrived within timeout_ms…" }`
  — **word-for-word identical to a quiet counterparty** — and the plain blocking receive path
  **writes nothing to the log on either outcome**, so the theft leaves no trace anywhere. Nobody, in
  the session or reading the log afterwards, can tell "nothing arrived" from "your sibling took it."

  This line does **not** change delivery. It changes what the operator is told.

  **ACs:**
  1. "Nothing arrived" and "another attached session took it" are **different answers** on the
     `cello_receive` return — distinct `guidance`, and a machine-readable discriminator, not a
     rewording of the same string.
  2. The **attendance count** is carried on `cello_use_agent`, on `cello_status`, and on the arrival
     alert. `isAttended()` returns a boolean on first match and deliberately never counts
     (`daemon.ts:846`); counting is additive and must not change any existing attendance decision.
  3. The blocking receive **logs on both outcomes** — today the only event in that path is
     `session.receive.since_seq` (`session-content-handlers.ts:390`), which is the *other* branch.
     Name the events in the unit's design note before code.
  4. A second session attaching to an already-attended agent is told so at attach time. Attach is
     **not refused** — that would be exclusivity by the back door.
  5. Test: two connections on one agent, one message; the loser's return is asserted to be
     distinguishable from the quiet-counterparty case, and both outcomes appear in the log.
  6. Live: a two-session `claude --channels` journey where the second session reports being
     un-alone in its own words.
  7. **Doc correction (§2b):** [[launch-triage]] lists the reply guard under *"Already solid —
     confirmed working."* That rests on `DOD-CURSOR-1`, whose own DoD text says the two-window
     scenario was never run. Correct that line — it is currently claiming proof that does not exist.

---

## Tier 1 — the redesign

- **DOD-COATTEND-1** ❌ NOT BUILT (raised 2026-08-01) — **per-session delivery.** A message can no
  longer be taken by the wrong session: delivery reads a **durable record against a per-session
  bookmark** instead of popping a shared queue.

  **Root cause, proven (§2)** — three mechanisms, individually reasonable:
  1. **Attachment is unrestricted and uncounted.** `cello_use_agent` checks the agent exists and that
     *this* connection doesn't already hold it; it never looks at any other connection
     (`agent-handlers.ts:322-375`).
  2. **The doorbell is multicast.** `dispatchCelloMessage` loops every connection where that agent is
     current and pushes to each (`notification-dispatcher.ts:154-176`). One message, N wake-ups.
  3. **The content queue is destructive and single-consumer.** `#receivedContent` is keyed
     `(agentName, sessionId)` — **not by connection** (`session-node-manager.ts:260`) — and
     `takeReceivedContent` is `buf.shift()` (`:3932`).

  Both sessions are woken, both enter the 20 ms poll loop, whichever hits the next tick first gets
  the message and **removes** it.

  > **Inherited from Tier 0 — do not adopt its assumption unexamined (review finding, 2026-08-01).**
  > `attendance` counts connections that **SELECTED** this agent. It is not the set of connections
  > that can **CONSUME** its content: `resolveCurrentAgent` lets a connection operate on the sole
  > online agent *without* attending it, and such a connection's `cello_receive` drains the same
  > shared buffer. So a genuine thief can be invisible to the count. Tier 0 only reports, so this is
  > a labelling matter there; Tier 1 assigns **bookmarks**, and a bookmark keyed on attendance would
  > silently exclude exactly that connection.

  **ACs:**
  1. Delivery is driven by a **per-connection bookmark over the durable record**, not by draining a
     shared buffer. Two attached sessions each receive the same message; neither removes it from the
     other's view.
  2. The multicast doorbell **stays multicast** — it is correct. The queue is what changes.
  3. **No message is lost when a connection dies** with unread content — the durable record is the
     source of truth, so a reconnecting session resumes from its bookmark.
  4. `DOD-INV-CONTENTFREE` still holds: nothing about this line may put content or content-derived
     text on a push.
  5. Listener mode falls out for free: N sessions may attach and all see the conversation. Assert it
     with three connections, not two — it is the property exclusivity would have cost us.
  6. Test: two connections, one message, **both** receive it; then a third attaches mid-conversation
     and catches up from its own bookmark.
  7. Live: two-session `claude --channels` journey on one agent — both sessions see the counterparty's
     message.

- **DOD-COATTEND-CATCHUP-1** ❌ NOT BUILT (raised 2026-08-01) — **catch-up means everything since my
  bookmark, whoever wrote it (§3b).** Receiving only ever returns the *counterparty's* messages: the
  `since_seq` branch filters `direction === "received"` (`session-content-handlers.ts:366-394`), so a
  **sibling session's reply is in the record but never delivered through that path**. The second
  session reads the counterparty's message, is still short of the bar, asks again, gets nothing.

  That is the same shape as the bug that stopped command-line sessions replying: a rule satisfiable
  only through a door the caller isn't pointed at.

  > **Corrected by validation 2026-07-31 — do not implement against the original framing.** The
  > "stuck forever" claim was overstated. A both-directions catch-up door **already exists**:
  > `cello_get_transcript` returns sent + received and advances both the connection cursor and the
  > persisted watermark via `safeCursorAdvance` / `safeWatermarkAdvance`
  > (`session-read-handlers.ts:130-146`, whose comment names exactly this sibling-send scenario). And
  > under the *current* gate the second session is never blocked at all — the `unreadReceived === 0`
  > authority passes once anyone has read. The requirement stands in **weakened** form: `cello_receive
  > since_seq` alone cannot clear a tightened cursor bar.

  **ACs:**
  1. The spec **picks one door and says so**: either extend `since_seq` to both directions, or route
     catch-up through the transcript path and point every caller at it. Shipping neither — leaving two
     half-doors — fails this line.
  2. Whichever is chosen, a session that has fallen behind a **sibling's send** can reach the bar
     through the documented path, with no dead end.
  3. `safeCursorAdvance` still refuses to advance past a gap (`:33-36`) — catch-up must not become a
     way to skip an unread leaf.
  4. Test: session A replies; session B, which never saw A's reply, catches up through the documented
     door and clears the bar. Red before green.

- **DOD-COATTEND-SENDWINDOW-1** ❌ NOT BUILT (raised 2026-08-01) — **the send gate is re-checked in
  the same synchronous window as the append (§4).**

  Between the gate passing and the message being recorded there are **two awaits** — the security
  screening (`securityGateway.screenOutbound`, a round trip to the gateway process) and the send
  itself (`sessionNodeManager.sendContent`, relay submit + delivery). **The gate is never re-checked
  after either** (`session-content-handlers.ts` ~140, ~229, append at `:262`). Two sessions can both
  be cleared, both wait, and both write: nothing changed between them, because no leaf was appended.
  The counterparty gets two replies to one message — both correctly signed and ordered, the record
  coherent, the conversation not.

  **The pattern to copy already exists inbound** (`session-node-manager.ts:3682-3695`): a post-await
  re-check in the same synchronous window as the write, with an explicit comment that *"adding any
  further await between here and the append reopens the window."*

  **ACs:**
  1. The gate is re-evaluated after the last await, in the same synchronous window as
     `appendSessionLeaf`. No await may be introduced between the re-check and the append; say so in a
     comment, as the inbound sibling does.
  2. The second writer is **refused, loudly** — `session.send.blocked` names which authority refused
     (it already logs both — `:109`).
  3. `advanceLastDeliveredSeq` being **agent-scoped** (`:421`) is the reason the loser's send is
     permitted today (§2b). Whatever tightening this line makes must be stated against that, not
     around it — this is `DOD-CURSOR-DURABLE-1` behaving exactly as its own §6 predicted, a
     deliberate trade for stateless clients that is right for that problem and wrong for this one.
  4. **This line and `DOD-COATTEND-CATCHUP-1` land together or not at all.** Tightening the gate
     without a working catch-up door strands the second session; closing the window without
     tightening produces a strict-looking rule the race walks straight through.
  5. Test: two connections both pass the gate, both proceed through a stalled screening await; exactly
     one append occurs and the other is refused with the naming event.

- **DOD-RECEPTIONIST-AGENT-1** ✅ PROVEN (2026-08-01) — **the receptionist stops re-pointing
  other terminals (§6).** `~/.cello/current-agent` is one machine-wide file shared by every `cello`
  process in every terminal (`parity-commands.ts:44-83`). `cello-receptionist.md` runs
  `cello use-agent "$AGENT_NAME"` and then polls `cello inbox --scope current` every 10 s, each poll a
  fresh process re-reading that global file. **Two receptionists for two agents fight over it** —
  whichever ran `use-agent` last owns it, and both then report on that agent. Their own guard comment
  names the symptom (*"announcing another agent's callers as if they were this one's"*) and guards the
  wrong cause: it catches an empty name at startup, never a concurrent overwrite mid-loop.

  **This is a two-line fix and nothing is built on top of it.** Weighting recorded deliberately: the
  receptionist is a last-resort workaround for harnesses with no event injection and no long-polling.
  Andre wants **as few users as possible** depending on it. It gets the fix and **no vote on the
  architecture** — do not let it shape `DOD-COATTEND-1`.

  **ACs:**
  1. The receptionist subagent passes `cello inbox --agent "$NAME" --scope current` and **stops
     writing the shared file**.
  2. Verified working as written (open item 3, closed 2026-07-31): `--agent` replays
     `cello_use_agent` on the CLI's fresh connection (`parity-commands.ts:133-153`) **without** writing
     the shared file, and the daemon's scope-current handler reads that connection's current agent
     (`notification-handlers.ts:51`). The replay fails loud (`selected_agent_offline`) rather than
     auto-starting an offline agent — **correct** for the receptionist; do not "fix" it.
  3. The file itself stays — it is a good *preference* ("the last agent you chose" survives a crash).
     **It must never carry a liveness claim**: no process is alive to retract it. Only the daemon has
     that signal (§6).
  4. Test: two receptionist loops for two agents run concurrently and each reports only its own
     agent's callers.

  > All four ACs enforcer-green. AC 4 is proven at EXECUTION level — the real bash out of the
  > shipped markdown, through the built `cello` binary, two receptionists on one `CELLO_DIR`;
  > staging the old mechanism back turns it red (cross-talk) and hangs the offline case at 60 s.
  > Review found three ways it could still sleep forever and announce nobody; all fixed. No
  > in-context hop, so no live journey is owed. → Entry 3

  **Adjacent, not in this line:** `contactCommand` doesn't replay the selection, so `settings set` /
  `moniker set` write to the wrong agent on a multi-agent machine (`commands.ts:590`, from
  [[2026-07-13_dead-code-and-defect-reduction-workplan]] §1.3). Flagged, tracked there.

---

## Out of scope, deliberately

- **Exclusivity / one-session-per-agent** — rejected in §3, permanently. See the scope fence.
- **Receipt integrity** — `DOD-FIRSTMSG-WITNESS-1` and `DOD-FRONTIER-STRAND-1` stay in
  [[M8C-DEFINITION-OF-DONE]]. M8D opens behind them.
- **Party-vs-party root comparison on the seal auto-ack path** — §7c/§7d settled that the certificate
  attests the **relay-witnessed leaf sequence**, independently rebuilt and signature-verified, and
  that **neither party's local tree is an input at any point**. The client's tree is not merely
  unchecked, it is *outside the model*; introducing it would be a protocol change, not a fix. Fixing
  the divergence **producers** is the real fix, and those are the two M8C lines above.
- **Anything relay, directory, or portal side.** M12 moved those; it did not touch delivery. The
  co-attendance surface — the queue, the doorbell, the cursor, `use_agent` — is entirely
  client/daemon and exactly where the spec says (re-verified against post-M12 code 2026-07-31).

## Related

- [[2026-07-31_1043_two-sessions-one-agent-co-attendance]] — the spec of record
- [[2026-07-29_1730_coworker-session-scoped-mcp-calls-fail]] — where this was first seen and left open
- [[2026-07-11_cursor-durable-read-before-write-design]] — the per-connection → per-agent relaxation,
  whose §6 predicted the blind-reply exactly
- [[2026-07-01_1030_command-surface-and-notifications-design]] — the group-chat model, and the
  decision to use read-before-write rather than attendance locking
- [[2026-07-10_daemon-singleton-defects]] — the multi-daemon version of one identity in two places
- [[launch-triage]] §6 — the launch/redesign split this milestone implements
