---
name: M7 State of the Union
type: state-of-the-union
date: 2026-06-18
milestone: M7
status: open
description: >
  The cold-start brief after the great collapse. Read this FIRST. It tells the whole
  M7 arc — how we were chugging along, what we discovered, the four stories that
  followed, the dead-stack orphaning they caused, the branch sprawl that followed THAT,
  and the collapse that brought everything back to one ground truth in main — and then
  measures the current ground truth against the original vision in `outline.md` (the
  yardstick). It is the BASIS for the pick-through, not the pick-through itself. No
  investigation has been done here; this sets it up.
---

# M7 — State of the Union (post-collapse, 2026-06-18)

> **How to use this.** This is the single document a fresh session should read to
> understand where M7 actually is. It has three parts: **(1) the arc** — how we got
> here; **(2) the scorecard** — current ground truth vs the `outline.md` Milestone
> Close Gate; **(3) the shortlist** — what's parked / missing / superseded / unverified.
> The yardstick for everything is `outline.md` ("here's what we wanted"). The
> investigation ("what do we *actually* have, line by line") is the NEXT job — this
> document is its starting map, not its conclusion. Where I am not certain, it says so.

---

## Part 1 — The arc: how a healthy milestone degraded into a debacle

### 1. Chugging along
M7 (daemon architecture + ephemeral session transport) was progressing story by story.
A dozen stories were written, implemented, reviewed, and merged to main:
DAEMON-001/002/003, MANIFEST-001/002, MCP-001/002, SIGNAL-001, WIRE-001, SESSION-001,
DIR-PING-001, CICD-001. The per-story process (SPARC → sprint-coder → code-reviewer →
sprint-reviewer) was being followed. This part was healthy.

### 2. The discovery (the postmortem)
Tracing one real user journey out loud — *"A is chatting with B, A closes the laptop, B
keeps talking, it times out and seals — what does A actually have an hour later?"* —
surfaced three system-level gaps that **lived between stories** and so passed every
per-story gate: (1) a unilateral seal produced no signed certificate; (2) missed message
*content* was never resent — the session was killed instead; (3) the unilateral→bilateral
upgrade depended on recovery that was only half-built. Two process root causes were named:
**RC-1** deferrals had no home (they evaporated into discussion logs), **RC-2**
verification stopped at the story boundary (nothing owned the end-to-end adversarial
journey). Full detail: `POSTMORTEM-seal-and-content-delivery-gaps.md`. The design for the
fix was then worked end-to-end and **closed** (postmortem Part 4): content uses the relay
store-and-forward queue when direct fails or B is offline; flush is TTF-based, not
close-based; liveness is read off the session path; the seal stays honest regardless.

### 3. The four stories
The postmortem spawned four stories: **MSG-001** (content delivery: ACK + queue),
**SESSION-002** (unilateral seal → notarization), **SESSION-003** (peer↔peer session
liveness), **SESSION-004** (seal certificate legibility). The design was settled; these
were meant to close the gaps.

### 4. The new problem the four caused — dead-stack orphaning
The four were spec'd against `core/client` — the in-process `CelloClient` stack
(`session-manager.ts`, `seal-manager.ts`, `relay-stream-manager.ts`). But M7 had already
turned `cello-mcp` into a thin IPC proxy and moved the live path into the **daemon** — so
that `CelloClient` stack is **dead in production** (no shipped binary constructs it; the
daemon doesn't import it). Implementing the four against it meant building real code onto a
stack nothing runs, and in places **partially re-implementing systems that already existed
live** instead of wiring into them. This is RC-2 recurring one layer down. The response
(confirmed with Andre): **Option A** — the daemon owns the session core (Merkle tree +
send/receive + active seal), not a hosted `CelloClient`. That decision in turn required new
foundation work that wasn't in the original slate: **Keystone** (wire the daemon to the
directory at startup — the shipped binary booted without dialing it), **Registration**
(re-home `cello_register` + FROST DKG into the daemon), and **DAEMON-004** (the daemon
session-core itself). Full detail: `DAEMON-MIGRATION-AUDIT-AND-HANDOVER.md`.

### 5. The problem THAT caused — branch sprawl
Now there were many branches and worktrees in flight at once (Keystone, Registration,
DAEMON-004, the four stories, TRANSPORT-001 — ~7–8 per repo). Nothing was being merged to
main. Consequences, all observed: work was **redone** because a branch couldn't see that a
connector already existed in another branch; work **didn't sync** with older work; and the
agent (me) kept **asking about things that were already done elsewhere**. The sprawl itself
became the bug — entropy increasing every session.

### 6. The collapse (where the formal process stopped)
To escape the sprawl we went **integration-first**, and from here we **stopped following
the per-story process**: a mechanical **dead-code reachability gate** (`scripts/reachability.mjs`)
to tell live code from the dead `core/client` stack; a **7-branch assembly** into one base
(taking each branch's live daemon/transport/protocol halves, excluding its dead `core/client`
changes); **seam-by-seam** in-process verification of the session lifecycle (seams 1a–4);
then the **merge + prune to main**. The goal was no longer "ship the stories correctly" — it
was **get to one ground truth, even if buggy or broken**, so we could stop drowning.

### 7. Where we are now
Both repos are **`main` only** and **pushed**. The sprawl is gone. We have one ground truth.
We have **not** been following the stories; the story files and the COORDINATION Claims table
are partly stale relative to what the code actually does. Picking up the pieces — reconciling
code-reality against the stories and the outline — is the next job.

---

## Part 2 — The scorecard: outline vision vs. current ground truth

The yardstick is `outline.md`'s **Milestone Close Gate** (9 points — "here's what we wanted").
Honest status of each against what's in main today. **Critical caveat:** the close gate is a
**live multi-process** test, and **that live run has NEVER happened.** Everything below marked
"in-process" or "built" is unproven against the gate as written.

| # | Gate (what we wanted) | Where it stands | Gap |
|---|---|---|---|
| 1 | `cello login` → daemon up, directory connected, connections verified | Daemon + CLI built; Keystone wires the directory dial | **Never run against a real directory live;** directory-proves-itself (step 6) OFF; "connections verified" = M3 pass-through port only |
| 2 | Two sessions via IPC, independent current-agent | Built + merged (MCP-001/002), per-connection multiplexing | Lowest-risk item; believe solid (reviewed as a merged story) |
| 3 | Two agents exchange messages, ephemeral nodes, distinct Peer IDs | **Proven in-process** (seams 3/4: two daemons, real libp2p, distinct ephemeral Peer IDs) | **In-process only — never live multi-process.** This IS the goal and it has not run for real |
| 4 | Direct P2P where NAT permits; relay fallback where not | Direct path built + proven in-process (TRANSPORT-001 + seams) | **Relay fallback NOT wired in the daemon** (the offline path, MSG-001-3b); dcutr/relay-circuit dial via N_A not done; NAT selection untested live |
| 5 | Daemon stop → session `interrupted` in DB; surfaced at login | Built + reviewed + merged (SESSION-001) | Believe solid; not re-verified post-collapse |
| 6 | Retry queue across disconnect, drains in order, nonce dedup, survives restart | **Partial.** Queue persistence + nonce dedup (DAEMON-003) + TTF/startup-flush (MSG-001 ph2) in main | **The reconnect-drain-and-actually-redeliver-content path is MISSING** (MSG-001-3b). "Survives restart" built; "delivers the missed content" not wired |
| 7 | Signaling killed → reconnect w/ backoff; status transitions; queued ops drain | Built + merged (SIGNAL-001 + DIR-PING-001) | Depends on Keystone reaching a real directory; **never tested live** |
| 8 | Directory steps 5–6 pass; rogue node rejected | Manifest schema + client verification built (MANIFEST-001/002) | **Step 6 (directory proves itself) is OFF;** rogue-node rejection unverified; directory-side production key/manifest wiring status **uncertain** |
| 9 | `cello_list_agents` shows registered/online/current correctly | Built + merged (MCP-001 + Registration adds `registered`) | Believe solid; not re-verified post-collapse |

**Also in the outline, not in the 9 but load-bearing:**
- **Registration / onboarding** (re-homed into the daemon): built on the Registration branch,
  now in main. **Never live-tested** (no real DKG against the directory end-to-end in this era).
- **Application-level delivery receipt** (the outline insists this is M7, not deferred): the
  ACK ladder + size cap are **in main** (MSG-001 ph2/3a); the durable park-and-recover half is
  the missing MSG-001-3b.
- **The live two-agent demo** (`E2E-001`, the actual close gate): **never run.**

### The honest summary of Part 2
The **foundations** (gates 1,2,5,7,9 — daemon, IPC multiplexing, interrupted handling,
signaling resilience, agent states) are largely **built, merged, and once-reviewed**. The
**live end-to-end** (gate 3 live, gate 4 relay fallback, gate 6 content redelivery, gate 8
step-6) is **in-process-only, partial, missing, or off.** And **none of the 9 has been
verified by the live multi-process run the gate actually requires.**

---

## Part 3 — The shortlist: parked / missing / superseded / unverified

What the pick-through must resolve. Sources: this doc, the postmortem, the audit/handover,
COORDINATION's log, `PRUNE-LEDGER.md`, the reachability findings.

### Built but NOT in main (parked — recoverable from `PRUNE-LEDGER.md`)
- **trustless-cello SESSION-003 server half** (`e081efe`) — directory/relay session-path liveness.
- **trustless-cello SESSION-004 server half** (`f466946`) — directory seal-certificate legibility.
  (Their cello-client/protocol halves ARE in main; only the directory/relay sides are parked.)

### Genuinely not built
- **MSG-001-3b (DAEMON-CONTENT-WIRING)** — the offline-recovery relay content path + recovery
  + durable park, native in the daemon (Option A). **The single biggest missing capability** —
  it's "A sends, B isn't there." Design is closed (postmortem Part 4); only the daemon wiring
  is unwritten (sender + relay halves already in main).
- **SESSION-002** — unilateral seal → notarization, client/daemon side. Greenfield (only YAML).
- **SESSION-004 client legibility logic** — greenfield (only the protocol-types schema exists).

### Open design decision (do not build blind)
- **WIRE-001 initiate ordering ("seam 5").** Today `cello_initiate_session` creates the
  session node AFTER negotiating, but the directory generates the `session_id` — so a
  single-round production negotiator can't produce a complete assignment. The fix is a
  session-offer round; its correct shape depends on the directory side, which doesn't exist
  yet. Seam 4 works around it (the test supplies the peer id on the push).

### Deferred / off / unverified
- **Directory bidirectional auth step 6** — OFF (Keystone shipped with verify off).
- **Inbound-assignment FROST signature verification** — deferred (seam 2 accepts on trust,
  logs `session.inbound.assignment.unverified`); belongs with SESSION-004.
- **The dead `core/client` stack is STILL in main** — 26 files, unreferenced by any binary,
  but the **E2E fixture still drives it** ("E2E green" has been validating the dead stack, not
  the daemon). Slated for deletion once the daemon is the proven live path; not deleted.
- **Code review** — per the 2026-06-18 COORDINATION entry: only seams 2–4 were reviewed.
  The foundation re-home, the assembly as integrated, the four stories' salvage, and the
  collapse were not (or not re-reviewed). **Verified-green ≠ reviewed.**
- **trustless-cello full test suite** has a pre-existing single-worker hang on `m7-session-001`
  ordering (reproduced on clean main — orthogonal, but it blocks a clean full-suite run).

### What "verified green" actually means right now
cello-client main `c7210c4`: daemon **342 tests**, workspace typecheck, lint, dead-code gate —
all green. trustless-cello main: typecheck clean after the RELAY merge. **That is unit/in-process
green only.** No live multi-process run, no real directory, no real two-agent conversation has
happened in this era.

---

## Part 4 — The open question this document sets up (NOT answered here)

Given one ground truth in main: **what do we actually have?** Specifically, for each capability
the outline promised — is it *real* (works on the live path), *test-seam-green* (passes because a
test drives an internal seam or injects a fake), or *dead-stack-green* (passes because the E2E
fixture still exercises the orphaned `CelloClient`)? What is genuinely broken? And what is the
shortest path from this state to the outline's actual goal: **two of your own agents, registered
via Telegram, talking to each other through the daemon, live, end-to-end.**

That triage is the next session's job. This document is where it starts.

### Pointers
- `outline.md` — the vision + the 9-point Milestone Close Gate (the yardstick).
- `POSTMORTEM-seal-and-content-delivery-gaps.md` — the gaps + the closed content/seal design (Parts 3–4).
- `DAEMON-MIGRATION-AUDIT-AND-HANDOVER.md` — the dead-stack finding + the build spine (keystone→registration→sessions→live test).
- `COORDINATION.md` — per-story Claims (partly stale) + the full dated log incl. the collapse + the code-review-gap entry.
- `PRUNE-LEDGER.md` — every deleted branch + hash; the two parked server halves.
