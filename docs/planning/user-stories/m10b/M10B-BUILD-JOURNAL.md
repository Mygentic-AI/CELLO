---
name: M10B Build Journal
type: build-journal
date: 2026-07-28
milestone: M10B
status: active
topics: [m10b, endorsements, attestations, trust-signals, build-journal]
description: >
  Evidence, forensics, and decisions-in-flight for M10B (endorsements and attestations — the
  client-supplied source). The DoD is the scoreboard; this is where proofs, run output, and
  anything a run got wrong actually live. One entry per unit, plus one per Type Playbook run.
---

# M10B — Build Journal

> Convention (carried from M10): a DoD tag flip carries ONE line of evidence plus `→ Entry N`.
> The full proof lives here. A playbook run is one entry, not a story.

---

## Entry 0 — Milestone opened (2026-07-28)

**Why M10B exists as its own milestone.** M10 closed on 2026-07-16 with v1 done
(`DOD-T4-JOURNEY-1`). Endorsements were fenced OUT of v1 by `M10-D1` and parked in M10's post-v1
section. The 2026-07-27 policy surface audit then took the endorsement decisions (D-19, D-22
through D-27), and D-29 followed on 2026-07-28. That is enough settled design to open the work,
and enough scope to not belong appended to a closed milestone.

**The framing correction that produced this milestone's shape (Andre, 2026-07-28).** The first
draft of this scope described endorsements as introducing a new *issuer* — new keys, new custody,
a new chokepoint. That is wrong, and spec §6's 2026-07-11 amendment says so directly: all three
issuer flows route through the portal backend at launch, and the directory's authorized-issuer key
set collapses to portal keys.

Andre's statement of the correct model, recorded because it is the milestone's thesis:

> *"You have to break it up into three groups. There is the group that mints the trust signal and
> passes it onto the directory, then in turn creates an envelope to deliver it to the client. That
> is the part that we intended to build universally and work in one shot. But then there is a kind
> of an oracle. So who produces the trust signals for GitHub? Who produces the trust signals for
> the telephone, the hash, the portal security? Those are all done by the portal itself. Who
> creates the trust signals for usage? Those are done by the directory, but the minting is the
> same. The directory provides the raw information, the portal mints it. In a similar way, the
> client provides the raw information, the endorsement, but it's still the portal that mints it.
> … The thing that is changing is we're adding a third variant."*

So: **one universal mint→notarize→deliver pipe, three raw-plaintext sources.** Portal-researched
(GitHub, phone, email, portal security), directory-supplied (usage / track record), and — new —
client-supplied (endorsements). M10B adds the third arm. It does not add an issuer, a key, a
chokepoint, or a write path.

**Why it still bumps cello-client and trustless-cello, without violating INV-ZERO-BUMP.** The
Type Playbook's contract is that a new type must not touch either repo. M10B touches both — but
not because of the type. Two new *mechanisms* drive it, and spec §15.3 already names a new
presentation mechanism as a legitimate bump:

1. **Consent.** An object authored by a third party can now land in your wallet unbidden, so
   presentability requires the subject's explicit acceptance (D-23). No M10 signal had this state —
   every signal you held was minted about you, for you, at your own action.
2. **Issuer-side withdrawal.** The creator — not the subject, not the portal — can retract it, and
   the retraction must reach people already holding a copy (D-19). M10's revocation is role-based
   portal authority; this is a different authority model.

`DOD-END-INV-ZEROBUMP` holds the line: every new construct keys on `issuer_kind`, the consent
state, or the issuer's identity — all already data. A branch on the literal string `"endorsement"`
is a blocking review finding. `DOD-END-PLAYBOOK-1` is the falsifiable proof, in the canary's
tradition: a second client-sourced type must go end-to-end with empty diffs in both repos.

**Inherited defect this milestone must close.** `DOD-REVOKE-1` review F6, deferred by M10 with
*"revisit with intake"*: revoke authorises on the generic `submitter` role and writes a `portal`
tombstone regardless of the target's real `issuer_kind`. Harmless while every signal is
portal-issued; the moment a person can issue an endorsement, one submitter key can tombstone
someone else's. Carried as `DOD-END-REVOKE-2`, and without it D-19 is nominal.

**Next unit:** `DOD-END-ARCH-1` — the determination. It gates every build line, and it carries the
three flagged forks (endorser-learns-of-refusal, where `same_operator` lives, and the
attestation-vs-endorsement vocabulary).

---

## Entry 1 — DoD review + every open fork closed (2026-07-28)

**What this was.** A pre-build read of the DoD against the code as it actually is, looking for what
would stall or mislead an unsupervised overnight run. Andre then answered every open fork in one pass,
so the milestone starts with nothing parked. Decisions landed in the DoD as `M10B-D2` … `M10B-D8`; this
entry records what the review found and what was verified, not the decisions themselves.

**The finding that mattered most: the ingress shape had no plumbing on either candidate path, and the
DoD presented it as a fork for the coder to settle.** Verified rather than assumed:

- cello-portal has **no transport stack** — `package.json` carries `@cello-protocol/crypto` and
  `protocol-types` only; no libp2p, no `client`, no `transport`. A "portal-backed intake agent" in
  spec §7's literal sense means running a persistent libp2p daemon inside a Next.js app on Fargate.
- The daemon has **no portal-facing anything** — no portal URL, no portal HTTP client, no portal
  package, in any `core/*/src`. A daemon→portal call would be the first such coupling in the system.

So both candidates were greenfield, and the DoD asked a coder to pick one at 3am under a spec sentence
that reads like a mandate. That is how a night gets burned.

**Andre's call, and why it beat the recommendation.** The initial recommendation here was the direct
signed portal API call (smallest diff). Andre pushed back — *"shouldn't this go through the directory…
I'm kind of loath to put that directly into the portal"* — and the instinct was right. The deciding
argument is the **migration trap**, which the small-diff framing had missed: spec §7's destination is
per-node intake, and the amendment's promise that moving there is *"a routing change, not a migration"*
holds only if the CLIENT's wire contract already points at the directory. With a daemon→portal call,
moving intake later changes every installed client — stranding exactly the operators the launch-triage
lens says not to strand. Full reasoning and the rejected alternatives: `M10B-D2`.

**Six other gaps, all closed in the DoD:**

1. `DOD-END-PLAYBOOK-1` demanded "a SECOND client-sourced type" while the scope fence called a second
   type scope creep. Resolved the way M10's canary did — a throwaway (`client_canary`), registry-retired
   after the run, with an explicit "do not reach into the parked commercial family" fence.
2. Delivery to a subject who never acted was unspecified. Andre: it is the existing pickup path, no new
   trigger — if the daemon is down the envelope sits and lands on next start. Added, with the
   subject-offline case as journey step (a2). The one genuinely new thing is cross-account fan-out.
3. The D-8a anonymous-default clause was unimplementable — an endorsement has no anonymous variant, and
   a spec-fidelity reviewer would have blocked on it. Closed by `M10B-D8`.
4. Observability ACs were declared blocking on every line but named on one. The DoD now delegates the
   full event set to each unit's design note, which is where it can actually be enforced.
5. How Bob names an account subject when he only holds an agent pubkey — required by journey case (c),
   answerable nowhere. Scoped into the determination with a working answer (portal resolves agent →
   account; no account handle crosses the wire).
6. `DOD-END-SUSPEND-1` named no mechanism. It rides the same TTL-re-check as withdrawal, with
   reversibility as the distinguishing constraint, plus a verify-first note on whether the directory can
   join a suspended account to its agents' issued signals.

**Two calls made here rather than escalated.** The quota is enforced **per account**, not per agent —
Andre's number stands, but a per-agent cap is bypassed by spinning up agents, which is the identical
farming hole `INV-NO-SELF-STANDING` exists to close. And a re-issue after refusal **counts** against the
quota, or refuse-and-retry is an unbounded loop. Both recorded in `M10B-D6`.

**One inherited inconsistency to close when `DOD-END-QUOTA-1` lands:** `server-infrastructure.md` G-17
still specifies 10 endorsements/month per agent. `M10B-D6` supersedes it. Two live numbers for one knob
is how the wrong one gets implemented.

**Next unit:** `DOD-END-ARCH-1`, now narrower — the shape is decided, and what it owes is the detail
those decisions opened: intake-key distribution and rotation, queue ack/poison and retention, account-
subject naming, the payload split, where the consent state physically lives, and expiry.

---

## Entry 2 — G-17 reconciled; two residual gaps closed; implementation-ready (2026-07-28)

**G-17 fixed in `server-infrastructure.md`** (both the spec line and the gap table). Was *10 new
endorsements per month per owner (phone number), at the directory*; now *100 per rolling 30 days per
owner, cap and window configurable, enforced at the portal*. Two things worth recording:

- **The per-owner scope was already correct in the original.** G-17 read *"per owner (phone number) —
  shared across all agents under that owner to prevent farming via multiple agents."* So `M10B-D6`'s
  per-ACCOUNT enforcement is not a reinterpretation of Andre's number — it restores the original intent,
  which the M10B DoD had drifted from by phrasing the open question as "per agent." Good outcome from
  checking the source rather than reasoning from the DoD's own summary.
- **Enforcement moved layers.** G-17 put the limit at the directory, which was coherent when the
  directory accepted endorsements directly. Under the §6 2026-07-11 amendment the directory notarizes a
  hash and cannot read what it stores — it literally cannot count endorsements. The quota has to live
  where minting happens.

**A doc trap found while verifying, now annotated in the DoD.** The 2026-04-10 origin log is in the
DoD's Related Documents, and it specifies **two protocol types** — `connection_endorsement` (gated at
the connection layer) versus `attestation` (informational). A coder reading it as current would build
that split, which is a direct `DOD-END-INV-ZEROBUMP` violation. It is superseded by `M10B-D7`: one type,
with the gating that split was for now done by floor predicates over `issuer_kind`/tier/count. The
Related Documents entry now marks all three of that log's superseded parts, and names this one as the
trap. General lesson, and it is the reason to annotate rather than delete: a linked historical document
is an instruction to an agent, not just provenance ([[project_audit_what_ships_not_what_compiles]]).

**Two residual questions closed rather than escalated** (`M10B-D9`, `M10B-D10`), both surfaced by asking
what a coder would hit at 3am that no document answers:

1. **Who consents to an ACCOUNT-subject endorsement?** D-23 says the subject accepts; for an agent
   subject that is obvious, for an account it is not. Chosen: any one agent under the account, in
   MCP/CLI, because M10's account-level signals already fan out to every agent — consent following the
   same shape adds no new concept and needs no portal surface.
2. **Must the endorser have met the subject?** No. A relationship gate would break the bootstrap case
   endorsements exist for, and it is unnecessary: a stranger's endorsement is worth nothing to the
   recipient anyway, since value comes from the recipient's own tier join on the issuer.

**State: implementation-ready.** Every fork opened by the DoD is closed, nothing is parked pending an
answer, and the first unit (`DOD-END-ARCH-1`) has a bounded question list rather than an architecture
choice. What remains inside the determination is engineering detail a competent coder settles and
journals — not decisions requiring Andre.

---

## Entry 3 — the hibernation gap (2026-07-28)

Andre is about to hibernate the dev environment and asked whether the overnight run can still proceed.
It can — but the docs would have handled it badly, and the failure mode was worse than a stall.

**The gap.** `M10B-PROCEDURE.md` had zero occurrences of "hibernat", while its REALITY CHECK said
flatly *"AWS + publish actions are AUTHORIZED (dev deploys, ECS, SSM, migrations)."* An unsupervised
coder reads that as a green light and runs `infra/deploy.sh` against a torn-down stack. Per global
CLAUDE.md that **corrupts the inventory `wake.sh` restores from** — `hibernate.sh` DELETES the ALBs,
NAT gateways and ssmmessages endpoints and rebuilds them on wake from `hibernation-state.json`, so a
CFN mutation in between writes state that file has no record of. The secondary failure is cheaper but
likelier: an hour spent debugging a blackholed endpoint as if it were a code bug.

**Verified, not assumed:**

- **`infra/hibernation-state.json` is NOT a liveness signal.** It currently reads
  `hibernated_at: 2026-07-27T19:26:18Z` while the environment is demonstrably UP — `wake.sh` never
  clears the file. The reliable check is DNS: `hibernate.sh` UPSERTs every dir/relay/portal name to a
  TEST-NET-2 (`198.51.100.x`) blackhole, deliberately, so the names resolve instead of seeding negative
  DNS caches (the 2026-07-24 post-wake incident). `dig +short directory-us1.cello.mygentic.ai` → real
  ALB IPs = live. Confirmed live at the time of writing.
- **The live journey does NOT need AWS.** `packages/e2e-tests/src/spine/live-harness.ts` brings up
  docker-compose Postgres + Flyway and runs real directory/relay/daemon binaries on localhost. M10's
  T2 and T3 journeys (Entries 46–47) went green exactly this way. The one M10 journey that did need
  deployed infra — `DOD-T1-JOURNEY-1` — is also the one that never got past 🟠. So "live, across real
  processes" means real OS processes, not deployed AWS, and `DOD-END-JOURNEY-1` /
  `DOD-END-PLAYBOOK-1` are reachable hibernated.
- **ECS Exec dies with hibernation** — the ssmmessages VPC interface endpoint is deleted, so
  `cello-db-query` and `cello-portal-db-query` fail. This one needed calling out by name because it
  presents as a broken skill rather than as a hibernated environment.
- **KMS keys are KEPT** through hibernation, so the portal's real signer still works from local
  credentials against a local Postgres.

**What actually blocks:** the batched directory deploy (`DOD-END-QUEUE-1` migration +
`DOD-END-REVOKE-2`), the portal deploy, the two DB-query skills, and the demo agent. That is it —
everything else in M10B is local work.

**Written up as `M10B-PROCEDURE` §2e** (with a pointer from the REALITY CHECK bullet that would
otherwise mislead, and one from the DoD's status legend). The rule it lands on: a hibernated
environment is not a stopping condition any more than a cron tick is — the affected lines go 🟡 with
the pending deploy command journaled next to the deferred `latest` promotion, and the run pulls the
next DoD line in the same turn. **Waking the environment is Andre's call, never the run's** — it costs
money and reaches outward.
