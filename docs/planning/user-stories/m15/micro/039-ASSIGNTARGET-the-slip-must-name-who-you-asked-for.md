---
name: 039-ASSIGNTARGET — The permission slip must name who you asked for
type: micro-work-order
date: 2026-09-06
status: complete
dod_line: DOD-M15-ASSIGN-TARGET-1
dod_effect: closes
description: >
  The session assignment is verified as FROST-signed by this agent's own group key, and is never
  compared to the pubkey the operator actually typed. A colluding quorum can name an impostor, the
  assignment verifies perfectly, and the daemon dials them — and because the dialer speaks first,
  the opening message is disclosed before the wrong-signer check can fire on their reply. Compare
  the two local values before anything dials. CLOSES DOD-M15-ASSIGN-TARGET-1.
---

# **<ins>MICRO</ins>** WORK ORDER 039-ASSIGNTARGET — The slip must name who you asked for

> ## THE RULES OF A MICRO WORK ORDER
>
> 1. **Read [[M15-PROCEDURE]] IN FULL before you start.** It binds you — the gate, the review
>    dispatch, the invariants, how tests are run. **Do not read `M15-DEFINITION-OF-DONE.md` or
>    `M15-BUILD-JOURNAL.md`**; this order carries everything you need from them.
> 2. **MICRO means small.** One mission. Follow it to its end. **Never grow the mission.**
> 3. **Found something else?** Write it under *Newly discovered* at the foot of this file and
>    **keep going**. Do not fix it. Do not investigate it.
> 4. **500 lines, hard cap.** This one should be nowhere near it.
> 5. **Standard procedure still applies:** implement → review (`cello-unit-reviewer`) → fix every
>    finding → commit. Commit per fix, push after every commit. **Closing a unit means flipping this
>    file's `status:` frontmatter to `complete` in the SAME commit as the verdict.**
> 6. **Done is done.** When the Definition of Done below is met, stop.

---

## The rule this exists to enforce

**Andre, 2026-09-06**, reducing it to one sentence:

> *"The very first thing you send might be sent to someone else."*

---

## What is true today — read in code 2026-09-06, do not re-derive

`outbound-sessions.ts:487` calls `verifyAssignmentSignature`, which establishes three things: the
assignment is FROST-signed, the named signer is **this agent's own** threshold group key, and the
signature verifies over the recomputed TBS. All three hold.

**It never establishes that the assignment is about the person the operator named.** Every consumer
of `participant_b.pubkey` on the client was checked: it builds the TBS and configures the relay. It
is **never compared to `targetHex`**.

The comment already sitting at that call site states the bound in writing — a threshold of this
agent's own directories, colluding, can sign an assignment naming the wrong counterparty — and points
downstream to the ingest-time wrong-signer check as the answer.

### Why "it is caught at their first message" is not enough

It is caught. `#verifyAuthorshipClaim` compares the message signer against `counterparty_pubkey`,
which comes from the operator's own request and is untouched by anything the directory returned, and
**freezes** the session. That check works.

**But the dialer speaks first.** The send path
(`session-content-handlers.ts` ~310-360) gates on params, ownership, revival, the read cursor, size
and the screener — **there is no precondition requiring a verified inbound message.** So the real
sequence is:

1. The assignment names an impostor.
2. We dial them and hand over the session node.
3. **We send our opening message.** It reaches them over an authenticated channel; they read it.
4. They reply.
5. *Now* it freezes.

The freeze protects us from being deceived by their answer. It does nothing about what we already
disclosed. **The exposure is exactly one message — and one message is usually the reason the call was
made.**

### Broadcast removes even that bound

The detection depends on *their reply*. A broadcast is send-first by design and expects no reply per
recipient, so a substituted recipient who simply stays quiet is **never detected at all** and keeps
receiving everything. One message and a freeze becomes an open subscription. This is why the line is
worth closing before broadcast is built rather than after.

---

## The fix — four lines, everything already in scope

Measured at the site, so do not go looking for plumbing that is not needed:

- `outbound-sessions.ts:487` sits inside `runSessionRequestOverSignaling`, which **already takes
  `targetHex` as a parameter** (line ~226) — the pubkey the operator typed, validated as 64 hex at
  ~696.
- The directory sets `participant_a` = initiator and `participant_b` = target
  (`directory-node.ts:4415-4416`). The mapping is unambiguous.
- **Both sides of the comparison are local values.** Neither is influenced by anything the directory
  returned. Nothing is fetched. There is no wire change.

After `verified.ok` and **before** the function returns the assignment to anything that dials:

1. `hex(assignment.participant_b.pubkey)` must equal `targetHex` — case-insensitive.
2. `hex(assignment.participant_a.pubkey)` must equal this agent's own pubkey. **The companion check,
   same place, same cost** — it closes the mirror case where the assignment puts someone else in our
   seat.
3. Either mismatch REFUSES with its own named reason and operator guidance. Two distinct reasons: a
   substituted counterparty and a substituted self are different events and a person reading the
   refusal needs to know which happened.

---

## Three ways to get this wrong, ruled out in writing

1. **Putting the check inside `verifyAssignmentSignature`.** That function's job is the signature and
   it takes no target. Passing `targetHex` into it to make the check fit there widens a crypto
   function's contract for a comparison that has nothing to do with signatures. Do it at the call
   site, where `targetHex` already lives.
2. **Comparing raw bytes without normalising case.** `targetHex` is operator input — `~696` accepts
   `[0-9a-fA-F]{64}`. A case-sensitive compare turns a correct session into a refusal.
3. **Logging and continuing.** This is a REFUSAL, not a warning. A mismatch means the permission slip
   is about someone else; there is no degraded mode in which proceeding is correct.

---

## Definition of Done

1. After the signature verifies and before anything dials, `participant_b.pubkey` is compared to
   `targetHex` and `participant_a.pubkey` to this agent's own pubkey.
2. Each mismatch refuses with its **own** named reason and guidance — not a shared one.
3. The comparison is case-insensitive on both.
4. Tests: an assignment naming a different counterparty is refused **before any dial occurs**; an
   assignment naming a different participant A is refused; a correct assignment is unaffected; the
   refusal reasons are distinct.
5. The "no dial occurred" assertion is real — a test that only checks the return value would pass
   against an implementation that refuses *after* dialling, which is the whole defect.
6. The bound stated in the comment at the call site is updated: the substitution is now caught here,
   not only downstream at ingest.
7. Gate green (`pnpm run test`, `lint`, `typecheck`), reviewer verdict quoted.

---

## Explicitly out of scope

- `DOD-M15-KEYBIND-1` (order 038). Adjacent and independent — that one proves a group key belongs to
  an identity; this one checks a field on a document our own key signed. Neither blocks the other.
- `DOD-M15-CEREMONY-BLIND-1`. The client refusing to co-sign does not close this, because a colluding
  threshold can sign without the client at all. This line is the verify-side answer.
- Broadcast itself. This order only makes broadcast safe to build later.

---

## Closed 2026-09-06

**Reviewer verdict (`cello-unit-reviewer`), quoted:** *"SPEC: FAITHFUL · NO SILENT FALLBACKS ·
ERRORS NAME THEIR CAUSE · TESTS HAVE TEETH · REMOVALS PROVEN · NO COMPATIBILITY DEBT. **No blocking
findings.** F1 and F2 are worth fixing before close; F3–F5 are one-line edits."* All five fixed,
commit per fix.

**Commits (cello-client, `main`):** `925f46c` implementation + tests · `d049190` F1+F4 guidance ·
`8e57c10` F3 comment · `d8fb4dc` F2 identity object · `fa09754` F5 test assertion.

**Gate:** `pnpm run test` exit 0 (4970 passed, 11 skipped — the unset `CELLO_E2E_LIVE` suites),
`pnpm run lint` exit 0, `pnpm run typecheck` exit 0 (which is the build in this repo).

### The premise in this order's own analysis was WRONG, and the correction is the useful part

This order argued the exposure was **one plaintext message**. Review measured it and it does not
hold in this tree: on the initiator side the content key is agreed from a peer ephemeral that must
verify against the **session's** counterparty record, which is the operator's own `target_pubkey` —
**not `participant_b`**. A substituted counterparty cannot sign a passing half, and a send with no
agreed key throws; content encryption has no degraded mode. **No plaintext ever left the machine,
and the broadcast "open subscription" argument does not hold either.**

**What was actually wrong is a better argument than the one that was written**, and it is why the
line still closed rather than being downgraded:

1. **Error substitution.** A substituted counterparty surfaced to the operator as
   `session.key.refused`, whose guidance blames *"something in the middle of your connection
   substituting its own key"* — the relay and the network accused for a fault that was entirely the
   directory's, sending the operator to investigate the wrong party.
2. **The dial itself discloses.** The impostor gets our session peer id and, on a direct address,
   our IP — permanently — before anything has failed.
3. **The seal anchor disagreed with the session.** `recordSessionGenesis` anchors the transcript to
   `participant_a`/`participant_b` while the session's own counterparty record holds what the
   operator asked for. Refusing here keeps the two provably equal.

Both the call-site comment and the test header were rewritten to say this instead. Left as a record
because a reader who later deleted the ephemeral binding would otherwise believe this guard was
holding a line it never held.

---

## Newly discovered

*(append here; do not fix)*

- **`session.discovery.unsupported_fallback` is a path for a directory that does not exist**
  (`cello-client/core/daemon/src/outbound-sessions.ts`, the exhausted-discovery branch). It exists
  for a directory node that does not answer `discovery_lookup`; there is no such node, and reaching
  it costs 19 seconds of retries before falling through. Found by review while checking which call
  sites the new tests reach. **POST-LAUNCH** — it is dead weight on a path nothing takes, not
  something a customer meets.

