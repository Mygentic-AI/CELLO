---
name: M10B — Client-Supplied Endorsements
type: milestone-writeup
date: 2026-07-31
milestone: M10B
status: active
description: >
  M10B lets one agent vouch for another in its own words. The endorsement is sealed so the directory
  cannot read it, screened and minted by the portal, and inert in the subject's wallet until they
  accept or refuse it. Written incrementally as lines close.
topics: [endorsements, attestations, trust-signals, consent, portal-ingress, m10b]
---

# M10B — Client-Supplied Endorsements

M10 gave CELLO the trust-signal machinery: canonical envelopes, dumb directory notarization,
zero-bump extensibility. Every signal it carried came from **the portal** — GitHub account age,
phone, email, TOTP. Machine-verified facts about you.

M10B adds the third source: **a person vouching for a person.** That is a different thing wearing
the same bytes, and most of this milestone's difficulty came from places where that distinction was
not honoured.

---

## What shipped

**The journey, end to end.** Bob endorses Alice in his own words. It is sealed to the portal's
intake key — the directory holds it and cannot read it. The portal drains, authenticates, screens
and mints; the directory notarizes; it is delivered to Alice **pending**. It is inert until she
decides: nothing pending is presented, counted, or visible to a counterparty. She accepts, and only
then can Charlie see it — and when he does, he sees **Bob's voice, not CELLO's**. Or she refuses,
and her reasoning travels back to Bob, who can correct and re-submit.

Proven live and by `j-end.spine.test.ts` — 10 hops against real daemons, a real directory, real
Postgres, and the portal's own ingress modules loaded across the repo boundary rather than
re-implemented.

**Attestations as their own primitive.** `cello attestations issue|issued`, `cello
attestation-consent`, and the matching MCP verbs. On the wire an attestation IS a trust signal, and
that is exactly why the two shared a name — which made the person-to-person primitive read as the
fifth subcommand of a wallet listing. The wire type string (`endorsement`) is untouched; only the
operator-facing verbs moved. Supersedes `M10B-D7`, deliberately (Andre, 2026-07-31).

**Same-operator co-ownership.** An endorsement between two agents belonging to one person is minted
and **flagged**, not refused — useful if you already trust that operator, worthless as independent
corroboration. An account-subject submission from the same operator IS refused, by name. Self-
endorsement is refused at the source, including two agents on one daemon, which is the farming shape
and also the ordinary one given solo multi-agent is the first wedge.

**The outcome return path.** A submitter used to learn nothing: minted, refused, rejected by the
scan and unattributable all looked identical. `submission_results` (V56) carries the outcome back,
sealed to the issuer, write-once, and the fan-out collects it from every node in the consortium.

---

## Bugs found and fixed

### An inclusion list cannot fail for the entry that is missing

**Symptom.** `cello trust-signals results` shipped CLI-only. `wallet_list_issued` shipped with no
surface at all. Both with a green gate.

**Root cause.** The parity test iterated a hand-maintained list of verbs and asked "is each one
wired up?". Omitting an entry makes the loop **shorter, never red**. The one thing nobody wired is
the one thing unchecked.

**Fix.** Invert it: scan `handlers.set("cello_…")` across the daemon as ground truth and demand each
capability be reachable from BOTH surfaces or exempted in writing. Two sibling tests cover the same
class — every `helpForSpec()` literal must resolve, and a denylist of retired verb names must appear
in no shipping source. The denylist found a sixth dead reference the moment it ran.

**Rule.** When a test iterates a curated list, it cannot fail for the item that is missing. Iterate
what the system HAS; keep exemptions explicit and reasoned.

### The results fan-out had never reached a node

**Symptom.** `unreachable_nodes` listed all three regions. Then, once a hibernated environment was
awake and the network verifiably healthy, it still listed all three.

**Root cause.** `openVisitingConnection` returns **synchronously** and the manager dials in the
background. The fan-out called `fetchSubmissionResults` on the very next line, so every node
answered `signaling_reconnecting` before a packet left the machine. The seal-broker paths already
awaited `waitForSignalingConnected`; this call site was the only one that did not.

**The tell was the spread, not the failure:** three continents recorded unreachable **5 ms apart**.
No network failure resolves in 5 ms.

**Fix.** Await the dial, matching the reference call sites. `unreachable_nodes` now returns empty.

### A stale DNS cache spent an hour looking like a protocol failure

**Symptom.** Every cross-node session died. It presented in sequence as `counterparty_offline`, then
`directory_below_threshold`, then `ceremony_exhausted` — three errors naming three subsystems, none
of them the cause.

**Root cause.** Hibernate deletes the ALBs; wake recreates them with new IPs; the host kept serving
pre-wake addresses. libp2p still connected off the bundled manifest, so `cello status` showed every
agent `online` with a ready receiver while nothing needing the HTTP endpoint worked. `dns_error` was
in the daemon log 26 times per node from startup and never reached the operator.

**Fix.** Flushing the resolver fixed the incident. What the milestone fixed is the *reporting*: an
empty roster now reports `consortium_unresolved` rather than "no directory node answered", and each
node's failure carries its reason instead of contributing an anonymous id to a list.

**Rule.** A fact deleted at the point it was known is the most expensive kind of bug. Three of this
milestone's four hardest hours were spent re-deriving something the code already knew.

### Guidance that describes a different verb

**Symptom.** `cello attestations issued` answered "what happened to what I sent?" with an
explanation about consent decisions.

**Root cause.** A shared selected-agent resolver whose guidance named consent specifically, then
acquired new callers.

**Fix.** Verb-neutral guidance. Worse than no guidance is guidance that sends the reader to fix
something that was never wrong.

---

## What the milestone taught about its own process

Nine DoD lines were amber at the start of the closing triage. **Four were finished work wearing a
stale tag**, two belonged to M10 rather than M10B, and one was a deliberate design decision
mislabelled as debt.

The mechanism: a line records "blocked on X"; X's owner finishes X, flips X, and moves on; **nothing
walks back to the lines that named X.** So the DoD drifts *pessimistic*, every review re-discovers
finished work as remaining work, and the milestone reads as though the finish line keeps moving.
It goes unnoticed precisely because nobody audits a line claiming to be **less** done than it is.

**Standing habit this earns:** when you close a line, grep for what named it as a blocker.

A second one, cheaper to state than to learn: **the spine suite is excluded from `pnpm run test`.**
A rename verified against 2344 green unit tests shipped a broken end-to-end journey, because the
gate never opened that file. Decision (Andre, 2026-07-31): run the spine suite manually at milestone
close rather than wiring it into the default gate.

---

## What remains

- **`DOD-END-QUOTA-1`** — an operator cannot see their remaining issuance quota. The only real gap
  left in the endorsement surface (`DOD-END-SURFACE-1` is otherwise eight of nine).
- **`DOD-END-REVOKE-2`** — built; its live proof needs a minted endorsement on the deployed portal,
  which is parked behind the AWS→GCP cutover.
- **Submission retry** — a failed send to one node does not fail over. Triaged as ship-without
  ([[launch-triage]] #12).
- **The trust-signal floor** (`DOD-FLOOR-1` / `DOD-END-COUNT-1`) — built and deliberately unwired;
  switching it on would refuse counterparties who have no signals yet, which is everybody on day
  one. **M10 work, not M10B** ([[launch-triage]] #13).

## Related Documents

- [[M10B-DEFINITION-OF-DONE]] — every line, its status, and the evidence behind each tag
- [[M10B-BUILD-JOURNAL]] — the day-by-day record, including the entries this write-up compresses
- [[M10-trust-signals]] — the machinery M10B builds on
- [[launch-triage]] — where M10B's deferred items sit relative to everything else
