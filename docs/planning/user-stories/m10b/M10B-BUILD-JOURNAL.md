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

---

## Entry 4 — DESIGN NOTE — `DOD-END-ARCH-1` (written before any code) — 2026-07-28

**Target behavior (one sentence).** Bob's daemon seals a signed endorsement to the portal's intake key
and drops it at any directory node; the portal drains it, proves who wrote it from the signature alone,
scans it, mints it through the unchanged chokepoint, and it arrives in Alice's wallet needing her
consent before anyone else can ever see it.

**Spec anchors.** Spec §6 (three issuer flows + the 2026-07-11 amendment), §7 (intake + its four
constraints), §14.1/§14.2 (notarized ⇒ scanned-at-birth; revocation), §14.7 (freshness/TTL re-check),
§15.3 (what legitimately bumps the client), §4 (mandatory-disclosure hash preimage). Policy: D-19,
D-22..D-27, D-29, M10-D5, M10-D22. Milestone: `M10B-D2`..`D10`. Crypto: Ed25519 → RFC 8032, CBOR →
RFC 8949, SHA-256 → FIPS 180-4. **Clauses the spec does NOT pin, decided here:** where the portal
intake key is published (D-11 below), how revoke authority is evaluated when the target row is absent
(D-12), and that the LLM-facing projection must split by `issuer_kind` (D-13).

### The verifications — first, because three of them change the plan

**V1 — the notarization path needs NOTHING. Confirmed, and the reason is `M10B-D2` itself.**
§4 first-action 2 asked whether `DOD-DIR-WRITE-1`'s authorized-issuer model is seam-ready for
`issuer_kind: agent`. The question dissolves: under the sealed-queue ingress the **portal remains the
only `submitter`-role key that ever calls the chokepoint.** Bob never submits. `issuer_kind: agent`
lives *inside the envelope*, which `signal-write.ts` treats as opaque bytes it re-hashes and stores —
it writes `envelope.issuer_kind` straight through to the column (`signal-write.ts:272–277`) with no
validation, no enum, no branch. `SignalIssuerKind = "portal" | "agent"` already exists in
`protocol-types/src/trust-signal.ts:54`, and `issuer_kind` is in the hash preimage. So the write path
is not "seam-ready" — it is *already done*, and touching it would be the mistake.

**V2 — `DOD-END-REVOKE-2` is real, and worse-shaped than the DoD describes.** Verified at
`signal-write.ts:561–649`. `revokeSignal` authorises with `verifySignedRequest(..., "submitter")` —
any active submitter-role key — and then writes a tombstone that **hardcodes `'portal'` as
`issuer_kind` and `'(tombstone)'` as `issuer_pubkey`** (line 635). It never reads the target record at
all. The moment an agent-issued endorsement exists, one submitter key tombstones anyone's endorsement.

The complication the DoD does not mention: **the revoke path deliberately does not look the target up.**
Blind-insert is load-bearing — it is the F3/F4 fix, so a revoke that arrives before its record under
mesh replication still converges (`signal-write.ts:607–629`). So "check the requester against the
record's `issuer_pubkey`" cannot simply be added at write time: at that moment the record may not be
here. This is the central design problem of Tier 3, and it is settled by D-12 below.

**V3 — `DOD-END-INV-UNTRUSTED` requires a change the DoD assigns to nobody.** The LLM-facing
projection is `projectTrustSignals` (`cello-client/core/daemon/src/inbound-sessions.ts:78–98`). Two
facts:
- The framing axis **already exists and is already correct**: `issuer: s.issuerKind === "portal" ?
  "platform-verified" : "peer-claimed"` (line 88). It keys on `issuer_kind`, not type — zero-bump-legal
  as-is.
- But the payload is handed over as **`claim: decodeCbor(s.payload)`** — one field, same shape for every
  issuer — under a blanket `directory_attestation` sentence that opens *"The following trust signals
  were each verified by the CELLO directory…"*.

For a portal signal that is accurate. For an endorsement it is the exact failure `DOD-END-INV-UNTRUSTED`
forbids: Bob's free text, in a field named `claim`, under a sentence an LLM reads as "verified", with
one adjacent enum value as the only counterweight. **The payload split alone does not fix this** — a
correctly split payload still arrives as an undifferentiated `claim` object. The projection must split
too. That is D-13.

**V4 — supporting facts, each checked rather than assumed:**
- `expires_at: null` is handled correctly. `listPresentable` filters
  `(expires_at IS NULL OR expires_at > ?)` (`trust-signal-store.ts:437`), so D-26's no-expiry
  endorsements are never read as already-expired. **ARCH-1's expiry item closes with no work.**
- The manifest can carry the intake key without a format break. `canonicalManifestBody` builds the
  signed body from `Object.keys(manifest)` minus `signatures`, sorted (`crypto/src/manifest.ts:74–84`)
  — an **open** field set, so a new top-level field is automatically inside the officer signatures, and
  old manifests (which lack it) still verify byte-for-byte. Precedent for optional additive fields:
  `role?` and `peerId?` on `ConsortiumNode`.
- The wallet store takes a consent column on its existing additive-migration pattern —
  `ensureTrustSignalSchema` already does try/catch `ALTER TABLE … ADD COLUMN`
  (`trust-signal-store.ts:184–188`), and the table is content-addressed on `signal_hash` alone.
- The portal's mint seam is a set of `compose*(…) → ComposedSignal` functions feeding one
  `buildSubmission(composed, signer)` (`cello-portal/src/server/trust/mint.ts:71–78, 262`). The third
  arm is one more `compose*` — no change to `buildSubmission` or `submission-signer.ts`.
- Latest directory migration is **V48**; the queue is **V49**, and
  `OpsAgentExpectedMigrationVersion` goes to **49**.

**Producer/consumer chain.**

| Thing | Producer | Consumer | If wrong |
| :-- | :-- | :-- | :-- |
| submission signature | Bob's daemon (agent key) | portal drain | `issuer_pubkey` becomes forgeable → INV-ATTRIBUTION dies, permanently, inside the hash |
| seal to intake key | Bob's daemon | portal drain | directory can read endorsements → INV-CONSENT + D-24 die at the operator layer |
| intake key + key id | manifest (officer-signed) | Bob's daemon | absent → daemon MUST refuse (`ABSENT IS NOT FINE`), never send unsealed |
| queue row | directory (V49) | portal drain | plaintext/subject in a column → the directory learns who endorsed whom |
| `same_operator` fact | portal, at intake, pre-hash | recipient rendering | composed after hashing → unhashed ⇒ relabellable ⇒ D-27 unenforceable |
| consent state | Alice's daemon | `listPresentable` | defaults to accepted → a rogue endorsement is presentable before she ever sees it |
| `issuer_kind` framing | portal (in hash) | `projectTrustSignals` | merged into `claim` → INV-UNTRUSTED dies quietly (V3) |

**The seam (files, both repos).**
- `cello-client/core/daemon` — new: compose+sign+seal+submit; manifest intake-key read; consent column,
  transitions, pending surface; `listPresentable` consent filter; `projectTrustSignals` split.
- `trustless-cello/packages/directory` — new: V49 queue table + repository (mirroring
  `pickup-repository.ts`'s shape: drain oldest-first, ack-deletes, node-scoped sweep); `revokeSignal`
  authority (D-12). **`submitSignal` is not touched.**
- `cello-portal/src/server/trust` — new: drain loop, scanner, `composeEndorsement`, quota.
  `buildSubmission` / `submission-signer.ts` / `directory-submit.ts` untouched.

**Invariants at stake, and the property that prevents each violation.**
- **INV-ATTRIBUTION** — `issuer_pubkey` is *derived from the verified signature over the submission
  body*, never read from a field. There is no request field to trust: the drain's only input is a
  sealed blob, and the identity falls out of verifying it. Same posture as `accepting_node`.
- **INV-CONSENT** — consent is a column on the wallet row and `listPresentable` filters on it, so
  presentability is gated at the one place that decides what may leave the daemon. Refused and pending
  are indistinguishable to third parties because *neither is ever offered*, and no count or error
  differs between them.
- **INV-UNTRUSTED** — the endorser's words live in their own namespaced payload field and their own
  projection field; the portal's `claim` string is composed by the portal and never interpolates
  operator text. Enforced by D-13 + a test that asserts the endorser's bytes never appear inside
  `claim`.
- **INV-NO-SELF-STANDING** — account-subject same-operator refused at intake; agent-subject minted with
  the `same_operator` fact *inside the hash*, and every count predicate excludes it. Quota is
  per-account, so agent-farming does not multiply the cap.
- **INV-ZEROBUMP** — every new construct keys on `issuer_kind`, consent state, or issuer identity. No
  new code learns the string `endorsement`. Specifically: consent is required for `issuer_kind: agent`
  (not for `type == "endorsement"`), the queue is named for consent state, and the projection splits on
  `issuer_kind`. `DOD-END-PLAYBOOK-1` is the falsification.

**Approach + rejected alternative.** Take the ingress exactly as `M10B-D2` fixes it and add nothing to
the notarization path (V1). The one genuinely new distribution problem — the intake key — rides the
manifest, because it is already the client's authenticated, polled, officer-signed source of
consortium-level facts and its canonical body is open-ended (V4), so the key arrives *signed* with no
new trust root and no new endpoint. **Rejected:** serving the intake key from the directory's
`/bootstrap` or a new HTTP route. It is less code, but the key would arrive unauthenticated over the
same channel an attacker would need to compromise anyway — and a substituted intake key means every
endorsement Bob writes is sealed to the attacker. An unauthenticated key-distribution channel for a
sealing key is not a shortcut, it is the whole vulnerability. **Also rejected:** pinning the intake key
in client config — it makes rotation a client release.

**Falsification pass (what I actually checked before proposing any of this).**
1. *Does the call site have the method on the INTERFACE?* The daemon already polls and verifies
   manifests (`http-manifest-poll.ts`) and holds the verified object, so reading one more field needs
   no new interface — checked the poll module, not just the type.
2. *Does the fix location match where responsibility lives?* For V3 I checked whether the payload split
   alone suffices. It does not: `projectTrustSignals` decodes the whole payload into `claim`
   regardless of shape, so a split payload still arrives undifferentiated. The projection is where the
   responsibility actually sits.
3. *What redundancy would this create?* A consent column plus the existing `default_present` are two
   different questions ("may it be presented at all" vs "include it by default"). Conflating them is
   the trap; they stay separate, and `listPresentable` — which is eligibility, not selection — is the
   one that gains the consent filter.
4. *What else breaks?* Adding `consent_state` with `DEFAULT 'accepted'` preserves every existing
   portal-issued row's behavior; only the delivery path writes `'pending'`, and only for
   `issuer_kind: agent`. If it defaulted to `'pending'`, every phone/email signal already in every
   wallet would silently become unpresentable — a data-loss-shaped bug with no error.
5. *Can revoke's authority check be added at write time?* No — proven above (V2): the target row may
   not exist at that node. That falsification is what produced D-12.

**Decisions this note makes.**
- **M10B-D11 — the portal intake key is published in the consortium manifest**, as an optional
  top-level field carrying `{key_id, pubkey}`. Rotation = publish a new manifest version with the new
  key; the daemon's existing poll rolls forward (with its `manifest_version_rollback` guard). **Queued
  submissions are not stranded** because every queue row records the `key_id` it was sealed to, and the
  portal keeps a rotated-out private key until no undrained row references it — retention is driven by
  the queue, not by a timer. Absent key ⇒ the daemon REFUSES to submit and names the reason; it never
  falls back to unsealed.
- **M10B-D12 — revoke authority is evaluated where the record is, not where the revoke lands.** The
  tombstone keeps its unconditional blind INSERT (preserving F3/F4 convergence) but records **the
  requester's real identity** instead of the hardcoded `'portal'`/`'(tombstone)'`. The authority join
  moves into `signal_records_effective`: a tombstone kills a record only if the record's
  `issuer_kind = 'portal'` (any submitter-role key — key rotation must keep working, determination
  §3.5), **or** the tombstone's requester pubkey equals the record's `issuer_pubkey`. An unauthorised
  tombstone is inert rather than rejected, which is what lets ordering stay free. Consequence to test:
  a tombstone that arrives before its record must become effective the moment the record replicates in.
- **M10B-D13 — `projectTrustSignals` splits on `issuer_kind`.** `portal` keeps today's shape. `agent`
  emits the portal's attested wrapper in the attested position and the endorser's words in a distinctly
  named untrusted field, with per-signal framing; and the blanket `directory_attestation` sentence is
  reworded to state what the directory actually verified (this hash was notarized and is active) rather
  than implying the content is true. Keys on `issuer_kind`, so it is zero-bump-legal and it generalises
  to the whole client-sourced family, not to `endorsement`.
- **M10B-D14 — consent is required by `issuer_kind: agent`, never by type.** New column
  `consent_state` on `wallet_trust_signals`, `DEFAULT 'accepted'` so existing rows are untouched; the
  delivery path writes `'pending'` for agent-issued signals; `listPresentable` filters on it. This is
  the generalisation `M10B-D1` demands — every future client-sourced type inherits consent for free.

**Nothing parked.**

**Test plan sketch (red first).**
- **Directory (V49 + revoke):** a schema test asserting the queue has no plaintext/subject/PII column
  (mirrors the `DOD-DIR-WRITE-1` posture test); revoke tests for the four D-12 cases — portal record +
  any submitter (kills), agent record + its own issuer (kills), agent record + a *different* submitter
  (**inert** — the F6 regression, and it must still pass if the record arrives after the tombstone),
  tombstone-before-record (becomes effective on replication).
- **Client:** consent default preserves existing rows; a pending signal is absent from
  `listPresentable`; a refused signal is absent by every path; `projectTrustSignals` on an agent-issued
  signal never places the endorser's bytes inside `claim` (**the revert test**: reverting D-13 makes
  this red).
- **Portal:** signature-derived `issuer_pubkey` (a submission claiming a different pubkey in its body
  is either impossible to express or ignored); scan-before-hash; quota per account across two agents.
- **Enforcers:** `DOD-END-JOURNEY-1` for the end-to-end, `DOD-END-PLAYBOOK-1` for zero-bump. Both run
  on the local spine harness — no AWS (Entry 3).

**Owed to the deploy (hibernated — Entry 3):** V49 + the revoke change are directory-side, so they will
be written, locally proven and committed, and land 🟡 pending the one batched deploy.

---

## Entry 5 — DESIGN NOTE — `DOD-END-SCAN-1` (written before any code) — 2026-07-28

**Target behavior (one sentence).** Bob's endorsement text is run through a deterministic, versioned,
fail-closed rule suite at the portal *before* it is hashed; on pass the version that cleared it travels
inside the signed submission, and on fail the submission is rejected naming which check refused it.

**Spec anchors.** Spec §6 ("scan BEFORE hash" — the collision vanishes because only clean content is
ever hashed), §7 ("**No LLM.** The intake role runs the *deterministic* scanner suite (injection
patterns, secrets, charset, length, URL handling) … Bytes in, pass/reject out"), §7 constraint 2
(versioned, byte-identical, "the scanner is a versioned shared component"), §7 constraint 3 (reject
always / flag only on a pattern — that half is `DOD-END-ACCOUNTABILITY-1`, not this line), §14.1
("notarized ⇒ scanned-clean-at-birth"). Policy D-16. `DOD-DIR-WRITE-1` already makes `scanner_version`
a **signed** field precisely because the directory cannot re-run the scan and a forged version "is a
lie stored as evidence."

### The findings — the shipped scanner is reusable, but not the way you would first reach for it

**F1 — the DeBERTa Layer-2 scanner is disqualified, by spec and by posture, and this needed checking
rather than assuming "we already have a scanner."** `core/gateway/src/detect/injection-scanner.ts` is an
in-process DeBERTa-v3-small ONNX classifier. Three independent reasons it cannot be intake's scanner:
1. Spec §7 says **"No LLM"** and "rule-based"; a transformer classifier is exactly what that excludes.
2. It **degrades open by design**: *"When it is absent, Layer-2 is OFF and Layer-1 still runs — the
   gateway degrades gracefully, it never fails closed on a missing optional model."* Intake must
   fail **closed**. A scanner that can be silently OFF cannot back a signed `scanner_version`
   assertion — the record would claim it was scanned when it was not.
3. Its verdicts are score-thresholded (`BLOCK_THRESHOLD` 70 / `FLAG_THRESHOLD` 35) over a model whose
   weights are downloaded per-operator with a pinned hash. "Byte-identical across nodes" (§7
   constraint 2) is not a property that survives that.

**F2 — the Layer-1 detectors ARE the right basis, and they are already shared-component-shaped.**
`detect/injection-patterns.ts` compiles a role-marker / override / persona / jailbreak / fake-turn
corpus through **RE2** (`linear-regex.ts`), so a crafted submission cannot cause catastrophic
backtracking — a real consideration when the input is attacker-authored free text. `detect/secrets.ts`
carries the gitleaks rule set. Both are pure, deterministic, and already exported from the package
root. `@cello-protocol/gateway` is **public** (`0.0.6`, not private) with exactly one runtime dep
(`re2-wasm`, WASM — no native compile), so consuming it from the portal is cheap.

**F3 — but the gateway's verdict SEMANTICS are the opposite of intake's, and copying them would be a
silent category error.** From `injection-patterns.ts`: *"Step-9 reports the matches as a signal … it is
not, by itself, an auto-block. CELLO is not a moderation tool; this surfaces evidence, it does not
police content."* That is correct for the inbound gateway — the operator's agent decides. Intake is the
other posture entirely: §7 is reject-always, fail-closed. **So intake reuses the rule CORPUS and owns
its own verdict policy.** Reusing `InboundScreener`'s disposition would produce a scanner that passes
its tests and never rejects anything.

**F4 — a barrel import drags `node:sqlite` into the portal. Verified.** `gateway/src/index.ts:37–40`
re-exports `GatewayConfigStore` and `GatewayRecordStore`, and both do a static
`import { DatabaseSync } from "node:sqlite"` (`config/config-store.ts:21`, `records/record-store.ts:19`)
— the two known CLAUDE.md violations. The package `exports` map today exposes only `"."` and
`"./package.json"`, so there is **no deep-import escape**: `import { scanInjectionPatterns } from
"@cello-protocol/gateway"` evaluates the whole barrel and pulls `node:sqlite`, the gateway server, and
the sidecar spawner into a Next.js server bundle. Consequence: **the gateway needs an additive
`"./detect"` subpath export** before the portal can consume it. Small, non-breaking, and it is the
correct package boundary anyway.

**F5 — there is no scanner version constant anywhere today.** Grepped `injection-patterns.ts` and
`secrets.ts`: nothing. The only version string in the system is the portal's
`INTERNAL_SCANNER_VERSION = "portal-internal-v1"` (`mint.ts:60`), which exists to record that internal
facts had no external content to scan. So versioning is net-new work, and its design matters more than
it looks — see D-15.

**Producer/consumer chain.**

| Thing | Producer | Consumer | If wrong |
| :-- | :-- | :-- | :-- |
| rule corpus | `@cello-protocol/gateway/detect` | portal intake | drift between versions ⇒ same text passes here, fails there (§7 constraint 2's node-shopping bug) |
| `scanner_version` | derived from the corpus (D-15) | signed submission → `signal_records` | a stale/hand-bumped value is a lie stored as permanent evidence |
| pass/reject verdict | intake scanner | drain → mint | reject-that-passes breaks §14.1's "scanned-clean-at-birth" for every downstream consumer |
| reject reason | intake scanner | the submitting agent | a bare `intake_rejected` sends the operator guessing (§5b) |

**The seam.** `cello-client/core/gateway` — additive `"./detect"` subpath export (no source change to
the detectors themselves). `cello-portal/src/server/trust/` — a new `intake-scan.ts` owning the verdict
policy, the charset/length/URL checks §7 names but the gateway does not implement, and the version
derivation; consumed by `DOD-END-INGRESS-1`'s drain before it calls `composeEndorsement`. **It must not
know** what a signal type is, who the subject is, or anything about the envelope — bytes in, verdict
out.

**Invariants at stake.**
- **INV-UNTRUSTED** — the scanner is what makes "scanned-clean-at-birth" true; it does not do the
  framing (that is `M10B-D13`), but a scanner that clean-and-continues would launder attacker text into
  a signed payload. Hence reject-only, never sanitize-and-pass (D-16 and §6 both say so).
- **INV-ZEROBUMP** — the scanner takes bytes and returns a verdict. It never sees `type`. There is
  nothing here to make type-shaped, and a reviewer should confirm the signature really is
  `(text) => verdict` and not `(signal) => verdict`.
- **INV-ATTRIBUTION** — not at stake directly, but the scanner runs *after* signature verification in
  the drain, so a rejected submission is still attributable for `DOD-END-ACCOUNTABILITY-1`. Ordering is
  load-bearing: scan-then-attribute would give an anonymous reject.

**Approach + rejected alternatives.** Consume the deterministic Layer-1 corpus from
`@cello-protocol/gateway/detect` as a shared versioned component (§7 constraint 2's literal ask), add
the checks §7 names that the gateway does not carry (constrained charset, length cap, URL handling),
and own the reject policy at the portal. **Rejected: reimplement the corpus in the portal.** It is less
cross-repo friction and it is exactly the failure §7 constraint 2 exists to prevent — two corpora drift,
and the same endorsement passes one and fails the other. **Rejected: put the scanner in
`@cello-protocol/protocol-types`** (which the portal already depends on, so no new dependency). It
would force `re2-wasm` onto every protocol-types consumer, and a wire-format package is the wrong home
for a policy component. **Rejected: reuse `InboundScreener` wholesale** — F3.

**Falsification pass.**
1. *Does the call site have access?* No — checked the `exports` map, not just the source tree. Deep
   imports are blocked, so this design REQUIRES the subpath export first (F4). Had I not checked, this
   would have failed at the portal's first import.
2. *Does the fix location match responsibility?* The verdict policy sits at the portal, not in the
   gateway, because the gateway's own doc comment says it deliberately does not police content (F3).
   Pushing intake's fail-closed policy into the shared package would change the gateway's behavior for
   its existing consumer.
3. *What redundancy?* `INTERNAL_SCANNER_VERSION` already exists for the portal-composed arms and stays
   exactly as-is — the endorsement arm gets its own version string. Two arms, two provenances, one
   field; that is the field working as designed, not duplication.
4. *What else breaks?* Adding a subpath export cannot break existing consumers (the `"."` entry is
   untouched). But it is a cello-client change ⇒ a gateway version bump ⇒ a publish, which is
   **deferred tonight** (§2e-1). So `DOD-END-SCAN-1`'s portal half lands 🟡 behind a publish the same
   way the directory lines land 🟡 behind a deploy.

**Decisions this note makes.**
- **M10B-D15 — `scanner_version` is DERIVED FROM THE RULE CORPUS, never hand-maintained.** Shape:
  `intake-v1+<first 12 hex of sha256 over the canonical serialization of the active rule set>` (pattern
  ids + sources, secret rule ids, charset class, length cap, URL policy). A hand-bumped constant is a
  version that silently goes stale the first time someone edits a regex and forgets — and because the
  directory cannot re-run the scan, that stale value is notarized as evidence of a scan that did not
  happen. Deriving it makes drift impossible by construction, and it gives §7 constraint 2 a
  mechanically checkable definition of "byte-identical": two intakes agree iff their derived versions
  agree. Test: mutating one pattern source changes the version.
- **M10B-D16 — intake reuses the gateway's rule CORPUS but owns its own VERDICT POLICY.** The gateway
  surfaces evidence and never auto-blocks by design; intake rejects, fail-closed. Reusing the corpus
  satisfies §7 constraint 2; reusing the disposition would produce a scanner that never refuses
  anything.
- **M10B-D17 — `@cello-protocol/gateway` gains an additive `"./detect"` subpath export**, and the
  portal imports ONLY that. Barrel import is forbidden: it pulls `node:sqlite` (VERBOTEN, CLAUDE.md),
  the gateway HTTP server, and the sidecar spawner into a Next.js Fargate app. This also makes the
  gateway a **sixth** cello-client package the other repos pin, so the cross-repo version-bump AC
  discipline now covers it.

**Nothing parked.**

**Test plan sketch (red first).**
- Version derivation: mutating a single pattern source changes `scanner_version`; the same corpus in
  two processes derives the same string.
- Reject cases, each naming its own cause: a role-marker injection, a live-shaped secret, a control
  character, over-length, a URL under the chosen policy. `intake_rejected` alone is a failing
  assertion — the reason must name the check.
- Fail-closed: an unavailable/uninitialised rule engine REFUSES; it must not pass content through.
  (This is the F1 posture inversion, asserted directly.)
- Scan-before-hash ordering: a rejected submission produces **no** envelope and **no** hash anywhere.
- Zero-bump: the scanner's signature takes text, not a signal.
- **Revert test:** each reject case must go green only because of the check it targets.
- Enforcer: `DOD-END-JOURNEY-1` end-to-end; the unit itself is harness-provable offline.

---

## Entry 6 — FINDING (blocker for `DOD-END-DELIVER-1`) — the delivery path SILENTLY DROPS the second endorsement — 2026-07-28

**Not a design note — a defect found while reading the producer of the path the DoD says to reuse.**
It has to be recorded before it is lost, because it falsifies a sentence in the DoD.

**What the DoD says.** `DOD-END-DELIVER-1`: *"Reuses the generic delivery path … with no type-specific
handling"*, and `M10B-D2`/Andre are explicit that delivery needs **no new trigger and no new
transport** — the M10-D22 sealed pickup path behaving exactly as it does for every other signal.

**What the path actually does.** `enqueuePickup`
(`packages/directory/src/agent-write-repository.ts:101–114`) upserts:

```sql
INSERT INTO pickup_queue (agent_id, signal_kind, ciphertext, owning_node_id, signal_hash) …
ON CONFLICT (agent_id, signal_kind) WHERE acked_at IS NULL
DO UPDATE SET ciphertext = EXCLUDED.ciphertext, signal_hash = EXCLUDED.signal_hash, created_at = now()
```

backed by a DB-enforced partial unique index (`V37__pickup_queue_one_pending_per_kind.sql:30–31`):
**one pending pickup per `(agent_id, signal_kind)`.**

**The consequence.** Two different people endorse Alice while her daemon is offline. Both deliveries are
`(alice_agent, 'endorsement')`. The second **overwrites the first**, and the first endorsement is gone —
no error, no log, and the portal's write reports success. Worse, journey case **(a2) is precisely the
scenario that triggers it**: (a2) exists to prove a subject who is offline at mint loses nothing.

**Why it was correct before and is wrong now.** V37's stated rationale is sound for M10: it *"mirrors
`identity_tree_entries`' PK (agent_id, signal_kind) — the single anchor per kind — so the queue and the
anchor agree on cardinality"*, and it closes a real READ-COMMITTED race where two concurrent enqueues
both survived and re-armed a `hash_mismatch` poison pill. Every M10 signal is genuinely one-per-kind:
one phone, one email, a track_record that supersedes its predecessor. **Endorsements are inherently
many-per-kind** — that is the whole point of a count predicate (`DOD-END-COUNT-1`, `min_count` floors).
So an invariant that was a faithful model of the data has become a silent data-loss bug against the new
data. This is the M10→M10B seam that "reuse the generic path" hid.

**Proposed resolution (assigned to `DOD-END-DELIVER-1`'s design note; NOT decided here).** Re-key the
partial unique index and the `ON CONFLICT` target on **`(agent_id, signal_kind, signal_hash)`** —
content-addressed, matching `wallet_trust_signals`' own PK (`signal_hash`) and the fact that the wallet
is content-addressed *"which is what makes duplicate delivery a no-op"*. Then many endorsements coexist
as distinct pending rows, and a genuine re-enqueue of the identical envelope still dedups, so V37's
poison-pill race stays closed.

**What that costs, stated plainly rather than glossed:** it drops the *replacement* behavior for
supersession — a re-minted phone signal would leave the old pending row instead of overwriting it. That
is acceptable **only because supersession is already carried correctly elsewhere**: `supersedes_hash` is
inside the envelope, `signal_records_effective` marks the predecessor superseded, and the daemon
cascades it on receipt — all three proven green by M10 Entry 47's `j-track-record` journey. The pickup
row's replacement is a second, weaker mechanism doing the same job. **But that reasoning must be tested,
not asserted:** V37 also exists to stop a stale row re-firing `hash_mismatch` forever, and whether that
poison pill can return under content-addressing is the specific question the DELIVER-1 note must answer
before this index changes. Do not ship the index change on the strength of this paragraph.

**Zero-bump note.** The fix keys on `signal_hash`, which is content, not type. No branch on
`'endorsement'` appears anywhere in it — the cardinality change applies to every signal family
uniformly, which is the correct generalisation.

**Scope impact.** This is a **directory migration** (V50, after the queue's V49), so it joins the one
batched deploy and lands 🟡 tonight. It also means `DOD-END-DELIVER-1` is NOT the free ride the DoD
implies — it has real directory work, and the DoD's "no new transport" claim survives while its "no
type-specific handling / reuses the generic path unchanged" claim does not.

---

## Entry 7 — `DOD-END-ARCH-1` REVIEW: four blocking findings, all upheld; D-12 and D-14 replaced — 2026-07-28

`cello-unit-reviewer` (no model override) returned **do not flip 🟡 → ✅**, with four blocking findings.
It independently re-derived every code claim in Entry 4 and all of them held. The findings are against
the **decisions**, not the evidence — which is the right outcome for a determination review, and it
means Entry 4's verification work stands while three of its conclusions do not.

**Both findings I could falsify, I tried to falsify, and could not:**
- §5a really does say, verbatim: *"a missing or unrecognized consent state must make an endorsement
  UNPRESENTABLE, never presentable-by-default; a missing operator-linkage lookup must refuse the mint,
  never mint unflagged"* (`M10B-PROCEDURE.md:469–470`). `M10B-D14` violated the milestone's own rule.
- The agent-pubkey → account resolution genuinely does not exist. The directory has
  `/internal/agents-by-account` (the **forward** direction) and the reverse join lives in SQL at
  `internal-api-server.ts:791` but is not exposed on any route.

**One correction to the reviewer, on a point of fact.** It reports V1 and `M10B-D12` as "in direct
contradiction" because D-12 is write-path work while V1 says the write path "needs NOTHING". V1 was
scoped to the **notarization/submit** path (`submitSignal`), and `DOD-END-REVOKE-2` was always
separately scoped as directory work inside the same batched deploy. So that specific criticism is
overstated. **The substance of F4(a) stands entirely** and is the most valuable finding of the review —
it is just not a contradiction with V1.

### F1 (upheld) — the account resolution is missing, and it blocks four lines, not one

The reviewer is right that Entry 4 declared this clause settled without addressing it, and right that
the blast radius is bigger than the DoD frames: `DOD-END-SUBJECTKIND-1` (both branches — `same_operator`
needs *both* parties' accounts), `DOD-END-QUOTA-1` (a per-**account** quota, from a submission whose
only identity is an agent pubkey — without the lookup the cap degrades to per-agent, which is precisely
the farming hole `INV-NO-SELF-STANDING` exists to close), `DOD-END-SUSPEND-1`, and `M10B-D3`'s
composition point. Under §5a every mint refuses today.

**Where the reviewer under-sold it: this is not net-new architecture.** There is an exact working
precedent — `/internal/account-by-email-stub`, consumed through `resolveAccountByEmailStub` on the
`DirectoryClient` interface with all three implementations already in place (`http-client.ts:47`,
`failover-client.ts:24`, `stub-client.ts:62`, plus the interface at `client.ts:62`). The new route is
that shape with a different lookup column, and it inherits the failover the sovereign-node invariant
requires for free. → **`M10B-D18`**.

### F2 (upheld) — there is no return path to the submitter, and it is a decision of D-11's weight

Entry 4 gave the intake key a full decision with rejected alternatives and gave the *reverse* direction
nothing — while three DoD lines require a named cause to reach the submitting agent
(`DOD-END-INGRESS-1`, `DOD-END-QUOTA-1`, `DOD-END-SUBJECTKIND-1`). The reviewer's error-path trace is
correct and is the thing to keep: Bob's last log line is `signal.submission.queued`, and 24 hours later
the row is swept. **A designed-in silent failure on the milestone's primary flow.** I had noticed this
question while reading `pickup_queue` and did not carry it into the note — that is the actual process
failure here, and it is why "Nothing parked" was wrong. → **`M10B-D19`**.

### F3 (upheld) — `DEFAULT 'accepted'` is fail-open, on a false dichotomy

The reviewer dissolved my falsification-pass #4 with one line of SQL: `DEFAULT 'pending'` **plus a
backfill `UPDATE` in the same migration** preserves every existing row *and* leaves future inserts
fail-closed. My reasoning evaluated only the migration-time consequence and never the ongoing-insert
one — with `DEFAULT 'accepted'`, `INV-CONSENT` holds only because the delivery path *remembers* to
write `'pending'`, so any second write path (`cello_restore`, a future client-sourced type, a refactor)
silently makes an unconsented signal presentable. That is the silent-fallback shape on the milestone's
headline invariant. → **`M10B-D14` REPLACED**.

### F4 (upheld, and the review's best finding) — D-12 made withdrawal impossible

The argument, which I missed entirely: `revokeSignal` gates on `verifySignedRequest(..., "submitter")`,
and per V1 **the portal is the only submitter — Bob never submits.** So Bob's withdrawal reaches the
directory signed by the *portal's* key. D-12's predicate (`tombstone.requester == record.issuer_pubkey`)
therefore never matches for an agent-issued record, and **every withdrawal is inert, silently.**
`DOD-END-WITHDRAW-1` and D-19 — one of the two mechanisms `M10B-D1` says the milestone *is* — become a
no-op that raises no error.

F4(b) (a tombstone-only hash would read `active`, so the directory would confirm a hash it has only
ever seen a revocation for — F4 reborn) and F4(c) (`BOOL_OR(… = MIN(…) FILTER …)` is a **nested
aggregate**, which SQL forbids) are both correct. → **`M10B-D12` REPLACED by `M10B-D12r`**, worked
through below because it is the milestone's most safety-critical view.

**Why `M10B-D12r` works where D-12 did not.**
1. **Bob's identity reaches the directory by being self-certifying, not by being the transport signer.**
   The revoke body carries an inner authorization signed by the *claimed issuer's* key over
   `(domain-tag ‖ signal_hash)`. The directory verifies that signature standalone — **no record lookup,
   so the blind INSERT and its F3/F4 ordering freedom survive untouched.** The transport signer stays
   the portal; the *authority* is Bob's.
2. **A new `revoker_pubkey` column**, not an overload of `issuer_pubkey`. The reviewer is right that
   overloading it collides with the view's placeholder treatment and with
   `CHECK (issuer_kind IN (…))`.
3. **The view is expressible in one aggregation level.** Not `BOOL_OR(x = MIN(y))` but array overlap:
   `ARRAY_AGG(revoker_pubkey) FILTER (WHERE is_tombstone) && ARRAY_AGG(issuer_pubkey) FILTER (WHERE NOT is_tombstone)`
   — two aggregates combined by an operator, which is legal, unlike an aggregate inside an aggregate.
4. **Tombstone-only stays fail-closed** (closing F4(b)): if the group has no non-tombstone row, the
   tombstone is effective, exactly as today. It converges when the record replicates in — and it
   converges in the **deny → allow** direction, which is the safe direction for a late correction.
   **The accepted residual, stated rather than buried:** a daemon that checked during that window
   recorded `revoked`, and client-side revocation is terminal, so an unauthorized tombstone can
   permanently kill a signal in that daemon. This is bounded by who can write a tombstone at all — only
   a `submitter`-role key, i.e. the portal — so the read-time check is **defense-in-depth against a
   compromised or second submitter key**, while primary enforcement is the portal verifying Bob's inner
   authorization before it signs. That bound must be written into the DoD line, not left implicit.

### Test-teeth findings — all three upheld, and they change the test plan

- The schema-posture test must assert **the exact column set**, not the absence of named columns. As
  sketched it passes against a column called `meta` holding the same data — it fails the revert test.
  `DOD-DIR-WRITE-1`'s posture test already does it the strict way; match it.
- The attribution test must construct **hostile CBOR bytes** carrying an `issuer_pubkey` field and
  assert the minted record uses the signature-derived value. "Impossible to express" is a type-level
  claim, not a test.
- The D-13 projection test is correctly revert-testable — **keep it**, and add the inverse (a `portal`
  signal must still land in `claim`), or an implementation that drops `claim` for everyone passes.
- F7's default direction is now an explicit AC: an **unrecognized `issuer_kind` must fall to the
  untrusted framing**, never to `platform-verified`. Today's ternary does the safe thing by accident;
  D-13's rewrite must do it on purpose. (The DB `CHECK` admits `directory` while the TS union does not
  — pre-existing, logged.)

**Status: `DOD-END-ARCH-1` stays 🟡 and Tier 1 does not start.** Four decisions land or change
(`M10B-D12r`, `D14r`, `D18`, `D19`), the DoD status line that falsely claimed the account-resolution
clause was settled is corrected, and the determination goes back for a second review pass. Not flipping
a tag on a unit whose reviewer said do not flip it is the whole point of having the reviewer.

---

## Entry 8 — DESIGN NOTE — `DOD-END-QUEUE-1` (written before any code) — 2026-07-28

**Closes the three `DOD-END-ARCH-1` clauses the review found unsettled** (exact table shape, ack/poison
semantics, drained-row retention), so read it as part of the determination rather than after it.

**Target behavior (one sentence).** A directory node accepts a sealed blob it cannot read, holds it
until the portal drains it, and then forgets it — while a directory operator with full database access
learns nothing about who endorsed whom.

**Spec anchors.** `M10B-D2` (the queue exists at all), `M10B-D11` (`key_id` on the row),
`M10B-D19` (the sealed return path, `submission_id`), spec §2 (the dumb directory), `INV-DIR-DUMB`,
`DOD-END-DISCOVER-1` (*"the negative test targets everyone else, including the sealed submission queue,
which must not let a directory operator infer who endorsed whom"*), M10-D22 (the mirror-image posture).

### The exact column set — and it is deliberately smaller than `pickup_queue`'s

```sql
-- V49
CREATE TABLE submission_queue (
  submission_id   TEXT        PRIMARY KEY,   -- sha256 of the SIGNED submission body (see D-20)
  intake_key_id   TEXT        NOT NULL,      -- which portal intake key this is sealed to (M10B-D11)
  ciphertext      BYTEA       NOT NULL,      -- the sealed blob; opaque, never opened here
  owning_node_id  TEXT        NOT NULL,      -- node-scoped sweeps, mirroring pickup_queue
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Five columns, and the absences are the design.** No `agent_id`, no submitter, no subject, no
`signal_kind`, no `type`, no plaintext, no reason column, no `acked_at`. Compare `pickup_queue`, which
carries `agent_id` because delivery must be *addressed* — the submission queue is not addressed, it is
**collected**, so it needs no addressee. That difference is what makes the privacy property achievable
rather than aspirational.

Per the review's test-teeth finding, the schema test asserts **the exact column set**, not the absence
of named columns — an absence-list passes trivially against a column called `meta` holding the same
data.

**No `submitting_agent_id`, and the tradeoff is stated rather than hidden.** Persisting it would give a
directory operator "Bob submitted five endorsements" — not *to whom*, but still the metadata shape
`DOD-END-DISCOVER-1` is written against. Flood protection therefore runs at the **authenticated write
handler** off the live connection identity, never off a persisted column. Accepted cost: a node restart
resets flood counters. That is tolerable because it is not the real limit — `DOD-END-QUOTA-1` at the
portal is, and it is per-account and durable.

**The reply needs no routing column either.** The portal opens the seal, learns Bob's agent identity
from the verified signature, and seals the result to him over the existing pickup path (`M10B-D19`).
The daemon correlates it by `submission_id` **inside** the sealed reply. Nothing about the pairing is
ever in the clear.

### Replication: NO. The queue is not consortium state.

`submission_queue` is **not** added to `cello_pub`. Precedent for a deliberately unreplicated table
exists — `V40__pre_auth_nonce_bindings.sql` says so in its header and explains why. Reasons here:
1. **Exactly-once gets far simpler.** A replicated queue means the portal can drain the same row from
   node B while its ack to node A is still in flight — a double-drain, hence a double-mint and double
   quota consumption.
2. **Fewer copies of a sealed secret.** Replication would put Bob's blob on all three nodes.
3. It is a mailbox, not shared state. Replicating it would be the directory *composing* something.

**Cost, accepted:** a submission written to a node that then dies permanently is lost. It is not lost
in the ordinary outage case — it waits — and the daemon's retry (below) covers the rest. Losing an
unminted submission is recoverable by re-submitting; the thing that must never be lost is a *notarized*
record, and that is `signal_records`, which **is** replicated.

**Consequence for the portal: it drains every node, it does not fail over between them.** Failover
means "try until one succeeds"; draining means "collect from all". This is a different usage of
`FailoverDirectoryClient` and the drain must not be built on `#tryEach`, which would silently collect
from one node and call it done. That is a specific, easy, silent bug and it goes in the reviewer
dispatch for `DOD-END-INGRESS-1`.

### Exactly-once, ack, and poison

**Exactly-once is a PORTAL-side property, not a queue-side one, and pretending otherwise is how this
gets built wrong.** Even with a perfect queue the portal can crash between minting and acking, then
re-drain the same row. So: the portal keeps a processed-submissions table keyed on `submission_id` with
its outcome, and a mint is idempotent on it. The queue's job is only at-least-once delivery.

**`submission_id` = sha256 of the signed submission body** (`M10B-D20`). Content-derived, so a daemon
retry to a different node produces the *same* id and the portal mints once — which is what makes
retry-on-node-failure safe rather than a duplication mechanism. It cannot be chosen by the submitter to
collide with someone else's, because it is a hash of bytes they signed. And a legitimate re-issue after
a refusal has a different `issued_at` inside the signed body, so it gets a different id and correctly
does **not** dedup.

**Three terminal outcomes, all of which remove the row exactly once:**

| Outcome | Meaning | Row | Reply to submitter |
| :-- | :-- | :-- | :-- |
| **minted** | opened, verified, scanned, minted | DELETE | sealed `accepted` + the signal hash |
| **rejected** | opened and attributed, then refused (scan / quota / same-operator / `operator_linkage_unresolved`) | DELETE | sealed refusal **naming the check** |
| **poison** | cannot be opened or the signature does not verify | DELETE | **none possible** — see below |

**Poison is the honest edge case, and it must not be papered over.** If the blob will not open, or the
inner signature fails, the portal **does not know who sent it** — the identity is derived from the
signature, so an unverifiable submission is unattributable by construction. There is nobody to reply
to. The row is deleted with a directory-side and portal-side log event only
(`signal.ingress.poison` + the cause), never retried, and never left to block the queue. The DoD's
"with its reason preserved" is satisfiable for *rejected* and not for *poison*, and saying so is better
than inventing a reply channel to an unknown party.

**Retention.** A drained row is DELETEd, matching `ackPickupDelete`'s hard delete and its reason ("no
sealed ciphertext lingers"). An **undrained** row is swept by a node-scoped sweep mirroring
`sweepUndeliverablePickups`, but at a TTL that must be **longer than the intake-key retention window**
(review F5) — otherwise the sweep and the key rotation can strand a submission between them. And
because a swept row generates no reply, **the daemon owns its own timeout**: if no sealed result
arrives within its own window it reports `submission_result_timeout` locally, naming the node it wrote
to. That closes the review's "swept unanswered" gap from the only side that can close it.

**Invariants at stake.** `INV-DIR-DUMB` — the directory never opens, parses, or interprets the blob;
the schema has nowhere to put anything it learned. `INV-CONSENT`/`DOD-END-DISCOVER-1` — no column pairs
a submitter with a subject, so the operator-inference test has nothing to find. `INV-ZEROBUMP` — there
is no `type` or `signal_kind` column here at all; the queue cannot branch on something it does not
store.

**Approach + rejected alternative.** Mirror `pickup_queue`'s *operational* shape (node-scoped, hard
delete on ack, sweep for the undrained) while carrying strictly less identity. **Rejected: reuse
`pickup_queue` itself with a direction flag.** It would inherit `agent_id NOT NULL` — the exact column
the privacy property requires be absent — and V37's one-pending-per-`(agent_id, signal_kind)` index,
which Entry 6 already shows is wrong for many-per-kind objects. Reusing it would import both defects to
save one migration.

**Falsification pass.**
1. *Does the drain have what it needs?* The portal reaches directory internal routes over
   `DirectoryClient`; this adds a route in the same family as `/internal/account-by-email-stub`. Checked
   the interface has three implementations that all must gain the method, or the stub client diverges
   from production and the local harness proves nothing.
2. *Does responsibility sit right?* Exactly-once was initially drafted as a queue property; it cannot
   be, because the portal-crash window sits outside the queue entirely. Moved to the portal.
3. *Redundancy?* `submission_id` as PK also serves as the natural dedup key for a daemon retry — one
   mechanism, two jobs, rather than a separate nonce.
4. *What else breaks?* Not replicating means the portal's drain loop must enumerate nodes from the
   manifest rather than take the first healthy one. If that is built on `#tryEach` it silently drains
   one node forever — named above as a dispatch item.

**Decisions this note makes.**
- **M10B-D20 — `submission_id` is the sha256 of the signed submission body, and it is the PK.**
  Content-derived so a retry to another node dedups at the portal; different across a legitimate
  re-issue because `issued_at` is inside the signed body; uncollidable because the submitter would have
  to sign someone else's bytes.
- **M10B-D21 — `submission_queue` is NOT replicated (`cello_pub` unchanged), and the portal drains
  every node rather than failing over between them.** Reasons and the accepted loss case above.
- **M10B-D22b — poison is unattributable by construction and therefore gets no reply.** Named
  explicitly so nobody builds a fake return channel for it. (Suffixed `b` to avoid colliding with
  M10's D-22.)

**Nothing parked.**

**Test plan sketch (red first).** Exact-column-set assertion (not an absence list). A `cello_pub`
membership test asserting `submission_queue` is absent — replication is a property that gets added by
accident. Retry-to-another-node produces one mint, two queue rows, one processed record. Re-issue after
refusal produces a *different* `submission_id`. Poison leaves the queue and emits its event with no
reply attempted. Sweep TTL exceeds intake-key retention (asserted on the constants, so the F5 window
cannot silently invert). Drain enumerates all nodes — the revert test here is a two-node fixture where
a `#tryEach`-based drain collects only one.

---

## Entry 9 — DESIGN NOTE — `DOD-END-DELIVER-1` (written before any code) — 2026-07-28

**This note exists to answer the one question Entry 6 deliberately refused to answer**, plus the
cross-account fan-out the DoD names as the only genuinely new thing in delivery.

**Target behavior (one sentence).** Two different people endorse Alice while her daemon is offline;
when she next starts, **both** endorsements are waiting, pending her decision, and nothing errored.

**Spec anchors.** M10-D22 (the sealed pickup transport), `M10B-D14r` (consent state), spec §7 (*"Bob's
role ends at submission"*), journey cases (a2) and (b). Entry 6 is the finding this closes.

### Entry 6's open question, now ANSWERED — the poison pill cannot return

Entry 6 proposed re-keying the pickup uniqueness on `(agent_id, signal_kind, signal_hash)` but refused
to ship it, because `V37__pickup_queue_one_pending_per_kind.sql` exists for **two** reasons and only one
of them was obviously satisfied. Both are now checked against the code as it actually is.

**Reason 1 — the poison pill. It is structurally impossible now.** V37's stated fear: a stale
undelivered row *"hashes to the SUPERSEDED identity-tree anchor and re-fires `hash_mismatch` forever."*
That failure needs a **separate anchor** for the row's hash to disagree with. There isn't one:
- `V48__drop_identity_tree_entries.sql` **dropped the anchor table outright** — *"M10's architecture
  replaced this with a self-contained delivery (`pickup_queue.signal_hash`, V47) anchored to
  `signal_records` (V46)."*
- Zero live references remain: `grep identity_tree_entries packages/directory/src` outside tests
  returns nothing.
- The daemon's surviving `hash_mismatch` (`trust-signal-store.ts:328–331`) now compares the delivered
  envelope against **the claimed hash carried on its own pickup row**. A mismatch therefore means the
  row's hash disagrees with the row's own ciphertext — corruption or tampering, never staleness. A
  stale-but-internally-consistent row cannot produce it.

So the poison pill was a property of the **JOIN**, and M10 removed the JOIN. V37 outlived its reason by
one migration.

**Reason 2 — the READ COMMITTED race. Preserved exactly.** V37's other job was stopping two concurrent
same-`(agent, kind)` enqueues from both surviving. Under `(agent_id, signal_kind, signal_hash)` two
concurrent enqueues of the *same* content still collide on the unique index and one takes the
`DO UPDATE` — the duplicate-row race stays closed. Two concurrent enqueues of *different* content both
survive, which is now the required behavior rather than the bug.

**Therefore `M10B-D23`** (below): re-key it. Entry 6's caution is discharged by evidence, not by
argument.

### The genuinely new thing: cross-account fan-out

Every M10 delivery seals to the *subject's own* agents, and the subject is the account that caused the
mint. An endorsement inverts this: the portal mints because **Bob** submitted, and seals to **Alice's**
agents. Two consequences worth stating because they are easy to get wrong:
1. The fan-out set is resolved from the **subject**, never from the submitter — the same
   `listAgents(accountId)` the portal already has, but keyed off the resolved subject account
   (`M10B-D18`). Using the submitter's set would deliver Bob's endorsement to Bob.
2. For `subject_kind: agent` the fan-out is a single agent; for `subject_kind: account` it is every
   agent under the account, and per `M10B-D9` **consent is recorded once per signal, not once per
   agent** — four agents must not produce four consent states for one object. The delivery is
   per-agent; the decision is per-signal.

**Invariants at stake.** `INV-CONSENT` — delivery lands `pending` (`M10B-D14r`), so an undecided
endorsement is unpresentable from the instant it arrives, with no window where the default is wrong.
`INV-AGENT-SCOPED` — the fan-out is bounded by the subject's own account; a mis-resolved subject is a
cross-tenant delivery, so the resolution failure must **refuse**, never fall back to the submitter.
`INV-ZEROBUMP` — the re-key is on `signal_hash`, which is content; the cardinality change applies to
every signal family uniformly and no branch on `'endorsement'` appears.

**Approach + rejected alternative.** Change the uniqueness, keep everything else. **Rejected: leave V37
alone and give endorsements a distinct `signal_kind` per submission** (e.g. `endorsement:<hash>`) so
they never collide. It needs no migration — and it is a type-shaped hack that smuggles content into a
kind field, breaks the kind's meaning for every other consumer, and would be a blocking
`INV-ZEROBUMP` finding. Cheap and wrong.

**Falsification pass.**
1. *Does the drain still work?* `drainPickupForAgent` orders by `created_at, id` and has no per-kind
   assumption — it returns rows, plural, already. Checked the query, not the comment.
2. *Responsibility?* The cardinality belongs in the schema, not in application code: V37's own header
   says app-level supersede alone was best-effort under READ COMMITTED. Keep it DB-enforced, just with
   the right key.
3. *Redundancy?* Supersession is now expressed once (via `supersedes_hash` → `signal_records_effective`
   → the daemon cascade, proven by M10 Entry 47), instead of twice with the weaker copy silently
   dropping data.
4. *What else breaks?* A re-minted phone signal now leaves its predecessor's pending row instead of
   overwriting it, so the daemon may receive both. That is safe — the wallet is content-addressed, both
   rows verify, and the cascade marks the older superseded — but it is the assertion the test plan has
   to prove rather than assume.

**Decisions this note makes.**
- **M10B-D23 — `pickup_queue`'s pending uniqueness re-keys to `(agent_id, signal_kind, signal_hash)`**
  (V50, riding the same batched deploy). Both of V37's rationales are discharged: the poison pill needed
  the `identity_tree_entries` anchor, which V48 dropped, and the duplicate-row race stays closed because
  identical content still collides. Without this, the second endorsement of any subject is **silently
  destroyed** (Entry 6).
- **M10B-D24 — the fan-out set is resolved from the SUBJECT's account, and a failed resolution
  REFUSES delivery** with a named cause rather than falling back to any other agent set. Per §5a, and
  because the fallback failure mode here is a cross-tenant delivery of a third party's endorsement.

**Nothing parked.**

**Test plan sketch (red first).** **The headline test, and it must be red first against today's schema:**
two distinct endorsements for one offline subject → both rows persist → both arrive on next start →
both land `pending`. Re-mint of the same envelope still dedups to one row. Concurrent enqueues of
identical content produce one row (V37's race, still closed). A superseding phone signal delivered
alongside its predecessor leaves the wallet with the predecessor marked `superseded` — the M10 Entry 47
behavior, asserted so the V50 change cannot regress it silently. Account-subject fan-out to three agents
produces three deliveries and **one** consent state (`M10B-D9`). A subject whose account will not
resolve gets a refusal, not a delivery.

---

## Entry 10 — SECOND REVIEW: three of four replacement decisions do not survive contact with the code — 2026-07-28

Second `cello-unit-reviewer` pass on `DOD-END-ARCH-1`. Verdict: **still 🟡, Tier 1 still does not
start.** Twelve findings, seven of them HIGH-blocking. The pass **ran live Postgres 18** to falsify one
of my decisions rather than arguing about it, which is the standard the rest of this milestone should
be held to.

**The honest summary: Entry 7 replaced four bad decisions with three that are also wrong, and one that
is right but incomplete.** Each failed the same way — I reasoned about a mechanism instead of reading
its consumer.

### What I verified myself before accepting (the two load-bearing ones)

- **`listPresentable` is dead code. Confirmed.** `grep` across `cello-client/core`, excluding tests and
  `dist`, finds only its own definition and two comments. The live presentation path is
  `listAllActive`, called once, at `outbound-sessions.ts:186`. So `M10B-D14r` put the consent filter in
  a function nothing calls — it would have shipped as dead code with a green suite while the live path
  presented unconsented endorsements.
- **And it drags an M10 defect out with it.** `listAllActive` takes **no `agentId`/`accountId`** and
  the call site passes none. The subject scoping that `listPresentable` implements (M10-D5/M10-D14 —
  account-subject rows presentable by any agent under the account, agent-subject only by its own
  subject) **is not enforced on the live wire path at all.** Every active wallet signal is offered
  regardless of which agent is presenting. That is `INV-AGENT-SCOPED`, live, today, in M10 — not M10B.
  Per the standing rule that a real defect found outside the diff gets fixed rather than deferred, it
  is now `DOD-END-SCOPE-FIX-1` and it must land **before** the consent column, or consent is bolted on
  top of a scoping hole.
- **Consequence for Entry 4:** my `expires_at` verification cited `trust-signal-store.ts:437` — inside
  the dead function. The conclusion survives (the live `listAllActive` carries the identical
  `expires_at IS NULL OR expires_at > ?` predicate) but the citation was to code that never runs.
  Corrected to `:505`. **Verifying against a function without checking it has callers is the exact
  mistake this milestone keeps making.**

### The decisions that fail, and why

**`M10B-D12r` — fails OPEN, proven on Postgres, reopening the defect it claimed to close.**
`ARRAY_AGG(x) FILTER (WHERE p)` over zero matching rows returns **`NULL`, not `'{}'`**; `NULL && anything`
is `NULL`; a `NULL` `WHEN` falls through to `ELSE 'active'`. So a tombstone-only group reads **`active`**
— the directory would confirm as live a hash it has only ever seen a revocation for, which is F4(b)
verbatim. My clause 4 asserted the opposite. Two more fail-opens I did not see: legacy tombstones have
`revoker_pubkey IS NULL` and `{NULL} && {'bobkey'}` is `false`, so **the migration silently un-revokes
every existing revocation**; and array overlap *is* exact-pubkey matching, so dropping the
`issuer_kind='portal'` escape strands every portal record the moment the KMS key rotates — which
`signal-write.ts:539–546` exists to prevent and which struck-D-12 had kept. → **`M10B-D12r2`**.

**`M10B-D19` — unbuildable on its stated carrier, at both ends.** I claimed the result "rides the
M10-D22 sealed pickup path". It cannot: `deliverSignal` refuses to enqueue anything whose
`signal_hash` is not already a notarized non-tombstone record (`signal-write.ts:459–465`), and a
refusal notice has no record — notarizing one to pass the gate would write every rejection into
replicated `signal_records`, destroying D-19's own privacy rationale. At the far end the daemon funnels
every pickup through `decodeTrustSignalEnvelope`, a fixed 11-element CBOR array, so a `submission_result`
throws and **returns without ACK** — and since ACK is what deletes, the row is redelivered forever
while occupying the one pending slot. And V37's upsert would destroy the second result anyway, which is
the very failure F2 was raised to close, re-created by my chosen carrier. → **`M10B-D25`** (also
renamed: `M10B-D19` collided with spec `D-19`, referenced bare twice in the same file).

**`M10B-D14r` — the backfill clobbers real consent decisions on every daemon boot.** The client DB has
**no migration versioning at all**, and `ensureTrustSignalSchema` runs on every `startDaemon` with a
bare `catch {}`. My literal text — `ALTER …; UPDATE … SET consent_state = 'accepted';` as siblings —
makes the UPDATE unconditional and unguarded: **an operator who refuses an endorsement has it flipped
back to `accepted` on the next restart**, silently, and it becomes presentable. The repo already has
the correct pattern with a comment warning against exactly this (`contacts-tier-migration.ts:116–177`:
`PRAGMA table_info` birth gate, ALTER + backfill in one transaction, **rethrow** on failure, and no
column DEFAULT so the backfill has a real discriminator). Adopting it means dropping
`NOT NULL DEFAULT 'pending'`. → **`M10B-D14r2`**.

**One correction to the reviewer, and it matters for accuracy:** D-14r justified itself partly on
"`cello_restore`, a backup import" as a second write path. The reviewer is right that this path does
not exist — `cello_backup`/`cello_restore` are stubs. The conclusion (fail-closed) is still correct;
the *reason* was a future hazard stated as a present defect, and it should have been labelled as one.

**`M10B-D18` — premise fully verified, conclusion still does not follow.** The reviewer checked the
`account-by-email-stub` precedent line by line and it holds, including that the failover genuinely
loops all candidates rather than degrading to null. But **`agent_profiles.account_id` is nullable by
design** (`V23`: *"pre-M6 agents have no account. NULL means 'not yet linked'"*), and two live paths
reach NULL — registration without a pre-auth token, and a swallowed resolution failure that logs
`preauth.account.link.failed` and proceeds deliberately. So under §5a's absent⇒refuse, **an entire
class of registered agents can never issue an endorsement**, and their quota is uncomputable. →
**`M10B-D26`** must decide which, in writing.

### Corrections to Entry 8 (the queue note)

- **My retention rule was backwards.** I wrote sweep TTL **longer** than the key-retention window; that
  is the direction that *guarantees* the stranding, because a row can outlive the key it is sealed to
  and become undecryptable → poison → no reply → silent loss. Safe is `T ≤ W`. Worse, it contradicts
  `M10B-D11`, which already had the correct queue-driven form, and I replaced it with an inverted
  timer-driven one. Neither constant exists to assert over. → **`M10B-D27`**.
- **`owning_node_id` has no consumer on an unreplicated table** — its whole purpose (`V39`) is stopping
  a non-converged replica from sweeping rows it did not write, which cannot arise here. NO CONSUMER, NO
  SHIP: dropped. And my "mirrors `sweepUndeliverablePickups`" claim was simply wrong — that sweep is
  not age-based at all, it targets `signal_hash IS NULL` legacy orphans, so a normal pickup row is
  never swept.
- **`submission_id` is caller-supplied and unverifiable at the directory** — the directory cannot open
  the seal, so it cannot check the PK. D-20 described what the id *is*, not what anyone *checks*. A
  daemon writing the same body under two ids to two nodes gets **two mints**. The portal must derive
  the id from the opened body and treat the row's id as a routing hint only.
- **Flood protection** is sound on the libp2p signaling frame (challenge-response yields a verified
  `authedPubkeyHex`) and collapses on HTTP, where `verifySignedRequest` only proves "some submitter-role
  key signed this". The note must say *signaling frame*, and note the `getAgentIdByPubkey` hop.

### H8 — PARKED, and it is the one Andre needs to see

Entry 8 justified the queue's five-column minimalism as what makes `DOD-END-DISCOVER-1` achievable.
**That justification is falsified by the notarization path sitting next to it.** `signal_records`
stores `subject` and `issuer_pubkey` **in plaintext**, is **replicated to all three sovereign nodes**,
and `subject` is the counterparty's `k_local_pubkey` — there is even an index on it. So the moment an
endorsement is *minted*, `SELECT subject, issuer_pubkey FROM signal_records WHERE issuer_kind='agent'`
hands any directory operator **the complete endorsement graph**. The queue's minimalism protects the
pairing only for submissions that are *refused*.

`DOD-END-DISCOVER-1`'s stated defense — *"the directory's fingerprint is useless without the text, and
only the subject holds the text"* — is true of the **payload** and false of the **parties**. D-24 says
"nothing about you is discoverable"; who endorsed you is discoverable to every node operator.

**This is parked, not decided, because the resolution is a policy call and both options are
expensive:** either `DOD-END-DISCOVER-1` is rescoped in writing to "content is undiscoverable; the
existence and parties of a notarized signal are visible to node operators" — which is arguably already
true of every M10 signal and may be the honest reading of a federated notary — or the mint stops
storing plaintext parties for `issuer_kind: agent`, which is a change to the hash-adjacent storage
model and a migration. It is out of the reviewed diff (V46 pre-exists M10B) and it does not block
Tier 1 mechanically, but it is load-bearing for a milestone whose whole premise is consent and
non-discoverability. **Andre's call.** → `DOD-END-DISCOVER-1` is marked 🅿️ pending it.

### Status

`DOD-END-ARCH-1` **stays 🟡**, now on its second failed review. Six decisions land or change
(`D-12r2`, `D-14r2`, `D-25`, `D-26`, `D-27`, plus the D-20 correction), one new unit is created
(`DOD-END-SCOPE-FIX-1`), and one architectural question is parked for Andre. Tier 1 does not start.
Two failed review passes on a determination is not a process failure — it is the determination doing
its job before any code exists to throw away.

---

## Entry 11 — `M10B-D12r3`: the revoke expression, RUN rather than argued — 2026-07-28

The second review falsified `M10B-D12r` by running it on Postgres instead of reasoning about it. So
`M10B-D12r2` got the same treatment before it went any further — against local docker-compose Postgres,
the six group shapes the review enumerated, comparing three candidate expressions against today's
`BOOL_OR(status = 'revoked')`.

**`D12r2` (my three ordered branches) was still wrong.** It fixed tombstone-only (h1: `active` →
`revoked`) and the rotated-portal-key case (h6), but **h5 — an agent-issued record with a LEGACY
tombstone (`revoker_pubkey IS NULL`) — still read `active`.** That is the silent un-revocation the
review warned about, surviving in the fix that was supposed to close it.

I nearly dismissed it: `issuer_kind: agent` does not exist in production yet, so no legacy tombstone
can target an agent record and h5 is unreachable today. That is exactly the reasoning §5a forbids —
*"a defect even when it is currently unreachable; unreachable is a property of today's SQL, not of the
code."*

**The fix is a fourth branch, ordered second:** `BOOL_OR(is_tombstone AND revoker_pubkey IS NULL)` →
`revoked`. A tombstone with no recorded revoker was written under the old role-based rule and had its
authority checked under that rule; it keeps its old semantics rather than being re-judged by a rule
that did not exist when it was written.

**Measured, all six shapes (`d12r3` vs. today):**

| group | today | D-12r | D-12r2 | **D-12r3** |
| :-- | :-- | :-- | :-- | :-- |
| h1 tombstone only | revoked | **active** ⚠️ | revoked | **revoked** |
| h2 record only | active | active | active | **active** |
| h3 revoker = issuer | revoked | revoked | revoked | **revoked** |
| h4 revoker ≠ issuer (**the F6 defect**) | revoked | active | active | **active** ✅ |
| h5 legacy tombstone, NULL revoker | revoked | **active** ⚠️ | **active** ⚠️ | **revoked** |
| h6 portal record, rotated KMS key | revoked | **active** ⚠️ | revoked | **revoked** |

**`D-12r3` differs from today's behavior on exactly one row — h4 — and h4 is the defect being fixed.**
That is the strongest evidence this change can have: the blast radius is one case, it is the intended
one, and every convergence and rotation property V46 and `signal-write.ts` fought for is preserved
unchanged.

**Method note, because it is the lesson of the whole determination.** Three consecutive versions of
this expression were wrong, and each was wrong in a way that reads fine in prose: `NULL` aggregates
falling through a `CASE`, `{NULL} && {'x'}` being `false`, a legacy row judged by a rule younger than
it is. None of those are visible by inspection; all three took ten seconds to expose by running them.
**Any SQL that decides a security property gets run against real Postgres before it enters a decision,
not after a reviewer catches it.** That now applies to `signal_records_effective`'s real definition
too — this validated the *expression*, not yet its substitution into V46's actual `CASE`, which is the
first task when Tier 3 starts.

---

## Entry 12 — `M10B-D25r`: the return path gets a DECIDED carrier — 2026-07-28

`M10B-D25` named two candidates and picked neither, which is a decision-shaped hole, not a decision.
Closing it, against the code.

**What the signaling layer actually is.** `directory-frames.ts` holds ~25 outbound encoders, each a
plain `{type: "…"}` canonical-CBOR map, plus an `InboundSignalingFrame` union. It is an **open,
additive set** — adding a frame kind is one encoder, one union member, one handler. And there is an
**exact structural precedent for what D-25 needs**: `trust_signal_pickup` (outbound, pushed on the
reauth hook at `directory-node.ts:2020–2038`) paired with `TrustSignalAck` (inbound, whose ack deletes
the row). That is the same push-then-ack-deletes shape a submission result requires.

**So: a new frame kind, plus its own table.** The frame alone is not enough — the stream is only live
on reauth, so a result produced while Bob is offline needs somewhere to sit.

**The asymmetry with the submission queue, which is the interesting part.** `M10B-D21` says
`submission_queue` is **not** replicated. `submission_results` **must be**. The reason is not
inconsistency, it is direction:
- The submission queue is **collected** — one consumer (the portal) that can poll every node, so a row
  can sit on exactly one node and still be found.
- The result queue is **delivered** — the consumer is a daemon that reconnects to *whichever node it
  likes*. A result stranded on the node the portal happened to write to would simply never arrive.

That is precisely why `pickup_queue` is replicated, and the result queue inherits the same posture,
including the same accepted convergence cost.

**Shape:** `submission_results (agent_id, submission_id, sealed_result BYTEA, created_at)`, PK
`(agent_id, submission_id)`. **One row per event — explicitly NO supersede-by-kind**, which is the
defect that killed `M10B-D19` (V37's upsert would have destroyed the second refusal, re-creating the
silent failure F2 was raised to close). The ack deletes scoped to `(submission_id, agent_id)`, mirroring
`ackPickupDelete`'s account-scoped delete — that scoping exists because an id-only delete lets any
authenticated agent wipe other agents' undelivered rows, and the same hole would exist here.

**Client-side sink, which `M10B-D19` never acknowledged.** `wallet_trust_signals` is envelope-shaped
(11 fixed columns + bookkeeping) and cannot hold `{outcome, cause, detail}`. So this needs a **new
daemon table** — a SQLCipher migration on operators' machines, under `M10B-D14r2`'s rules
(`contacts-tier-migration.ts` pattern: birth gate, one transaction, rethrow). Worth stating plainly
because it is the second client migration this milestone now owes, and client migrations are the
riskiest thing here — they run unattended on machines we cannot inspect.

**Residual I am not going to pretend is solved (related to the parked H8).** For a *minted*
submission the portal delivers the envelope to Alice and the result to Bob at nearly the same instant.
A node operator sees a `pickup_queue` row `(Alice, H)` and a `submission_results` row
`(Bob, submission_id)` seconds apart. `submission_id` is a hash of Bob's signed body and does **not**
equal `H`, so there is no direct join — but the timing correlation is real and it partially re-creates
the pairing on metadata alone. Decoupling (batching, jitter, deferring the success result to Bob's next
reconnect regardless of timing) is available and not free. **Logged as a residual against the parked
`DOD-END-DISCOVER-1` question rather than silently claimed as handled** — it is the same underlying
issue, and it should be resolved once, with Andre's answer, not twice by guessing.

**Falsification.** Does the reauth hook have what a second drain needs? Yes — it already resolves
`getAgentIdByPubkey(authedPubkeyHex)` at `:2018` for the pickup drain, so the result drain reuses that
lookup rather than adding one. Does a new outbound frame break old daemons? An unknown `type` must be
ignored rather than fatal on the daemon's inbound path — **that is the one thing to verify before
building**, because if unknown frames throw, shipping this frame to an un-upgraded daemon breaks its
signaling stream, and every operator upgrades on their own schedule (CLAUDE.md: "upgrades are not
transparent"). Named as the first task of the unit, not assumed here.

---

## Entry 13 — `M10B-D28`: the WITHDRAWAL carrier — the half of F4/H6 that D-12r3 did not touch — 2026-07-28

`M10B-D12r3` fixed the revoke *predicate* and proved it on Postgres. `M10B-D25r` fixed the *result*
path (portal → Bob). **Neither carries Bob's withdrawal to the portal in the first place** — the second
review's H6, and it is a transport hole exactly like the one that killed `M10B-D19`. Closing it before
a third reviewer has to say so again.

**The problem.** `DOD-END-SURFACE-1` puts *"withdraw one I issued"* in MCP/CLI, so the withdrawal
originates in the **daemon**. `M10B-D2` establishes the daemon never talks to the portal. `M10B-D12r3`
assumes the portal verifies Bob's inner authorization before signing the revoke — and nothing decided
how the portal obtains it. Entry 8 designed the submission queue exclusively around mint-shaped
outcomes (minted / rejected / poison), with no notion of an action.

**The answer is one field, and the pattern already exists one layer down.** `signal-write.ts` already
discriminates its request bodies on an `op`: `SignalSubmitRequest {v:1, op:"submit", …}` and
`SignalRevokeRequest {v:1, op:"revoke", signal_hash, issued_at}`. The sealed submission body takes the
same shape — `{v:1, op:"submit"|"withdraw", …}` — and a withdrawal rides the queue it already has.

**Why this is not a `INV-ZEROBUMP` violation, stated because it looks adjacent to one.** `op` is an
*operation*, not a signal *type*. The directory already branches on `op` and always has. Nothing here
tests a `type` string, and a future client-sourced type inherits both ops for free. The forbidden thing
is branching on what a signal *means*; branching on what the caller is *asking for* is what a protocol
verb is.

**Replay, which the second review raised and D-12r3 did not answer.** The inner TBS as sketched was
`(domain-tag ‖ signal_hash)` — no timestamp, no nonce, no target node — i.e. **a permanent bearer
capability to revoke that hash at every node forever.** `SignalRevokeRequest` already carries
`issued_at` and the outer path already bounds it with `CLOCK_SKEW_SECONDS = 600`. So the inner
authorization does the same: **TBS = `(domain-tag ‖ signal_hash ‖ issued_at)`, bounded by the same
window.** No new primitive — `buildSignalRequestTbs` is a byte-for-byte template — and the new domain
tag must not collide with `CELLO-TSIG-v1` or `CELLO-TSIG-REQ-v1`. Because the daemon and the portal
must build these bytes identically, the builder belongs in `@cello-protocol/protocol-types`, not a
local copy on each side. That is a third cello-client package touched, and it joins the publish debt.

**The tombstone must be self-certifying at rest, which is the subtler half.** `M10B-D12r3` verifies the
inner authorization at write time and then records only `revoker_pubkey`. But **logical replication
applies rows; it never re-runs `revokeSignal`** — so a peer node accepts whatever `revoker_pubkey` the
originating node wrote. One compromised node could write any revoker it liked and the other two would
treat it as authoritative, which is precisely where the read-time defense-in-depth stops working. So
the tombstone **persists the inner signature alongside the pubkey**, and a node may re-verify what it
was handed. This is the difference between "we checked it once" and "anyone can check it" — and for a
federated notary the second is the only one worth having.

**Falsification.** Does the queue's five-column shape still hold? Yes — `op` lives **inside** the
sealed body, which is opaque `ciphertext` to the directory. The queue schema does not change and gains
no discriminator column, so `DOD-END-QUEUE-1`'s exact-column-set test is unaffected and the directory
still cannot tell a withdrawal from an endorsement. Does the portal need a new route? No — it drains
the same queue and branches after opening. Does `DOD-END-QUOTA-1` count withdrawals? **No** — the quota
caps issuance, and a withdrawal issues nothing; counting it would penalise the correct behavior of
retracting a bad endorsement. Stated because it is exactly the kind of thing that gets implemented as
"every op counts" by default.

**Decision → `M10B-D28`.** Nothing parked.

---

## Entry 14 — THIRD REVIEW: my own measured table was attached to the wrong clause — 2026-07-28

Third pass. **Still 🟡.** Eight of the twelve second-pass findings are closed, including the two I most
expected to fail (H1's unknown-frame safety and H6's withdrawal carrier — both checked hard and found
sound). Four remain, and the worst one is mine.

### F3 — the DoD mandated an expression that fixes NOTHING, citing a table measured on a different one

`M10B-D12r3`'s DoD text says the new branches **"supplement `BOOL_OR(r.status = 'revoked')`, never
replace it."** Entry 11's six-shape table was measured on the **replacement** form. Those are different
expressions, and the difference is the entire fix.

The mechanism is in `signal-write.ts:634–641`: a tombstone is inserted with `status='revoked'` while
**the real notarization row is deliberately left `active`**. So `BOOL_OR(r.status='revoked')` fires on
*every* tombstone regardless of authority. Retain it as a leading branch and the authority branches can
never be reached.

**Re-run, on Postgres, both readings side by side:**

| shape | today | **supplement** (what the DoD mandates) | **replace + fifth branch** |
| :-- | :-- | :-- | :-- |
| h4 revoker ≠ issuer (**the F6 defect**) | revoked | **revoked** ❌ no-op | **active** ✅ |
| h7 real row carrying `status='revoked'` | revoked | revoked | **revoked** ✅ |

**A coder following the DoD ships a no-op and cites my green table as proof it works.** That is the
exact failure mode this milestone keeps producing, in its most dangerous form yet: not an unverified
claim, but *measured evidence attached to a clause it does not test*. The table was never wrong; the
sentence next to it was, and the sentence is what gets built.

Two more from the same finding, both correct:
- **The branch-order claim was misstated.** All branches yield `'revoked'`, so among themselves order is
  immaterial. What *is* load-bearing and went unstated: the revoke branches must precede the
  **supersession** branches, or a revoked-and-superseded record reads `superseded` — contradicting
  V46's own rule that revoked is the strongest statement.
- **A seventh shape regresses** and I never tested it: a real (non-tombstone) row carrying
  `status='revoked'` reads `revoked` today and `active` under the bare replacement. No writer produces
  it now — but `UPDATE` is granted, `'revoked'` is in the `CHECK`, and `signal-write.ts:293` already
  does `UPDATE … SET status='superseded'`. **This is the identical argument I used to justify branch 2
  for h5, and I failed to apply it to my own expression.** Fifth branch:
  `BOOL_OR(status='revoked' AND NOT is_tombstone)`. → **`M10B-D12r4`**, measured above.

So "differs from today on exactly one of six shapes" was true only of the six shapes I chose to test.

### F1 — `submission_results`' primary key can wedge ALL federation

`M10B-D25r` gave it PK `(agent_id, submission_id)` and made it replicated. V46's header documents
exactly this trap, measured: a subscriber's apply worker **enforces** PK/UNIQUE, so a duplicate stops
**the entire subscription** — all published tables, not just the offending one.

And the path is the designed one: the portal reaches the directory through an ordered failover list, so
write-to-A → response lost → fail over to B → two rows, identical natural key, both replicate, apply
worker errors. `ON CONFLICT DO NOTHING` does not help — replication applies the **row**, not the
statement.

**My "inherits the same accepted convergence cost as `pickup_queue`" was wrong**, and instructively so:
`pickup_queue` is safe for a reason unrelated to replication — it is `id BIGSERIAL PRIMARY KEY`, and
`setup-replication.sh` staggers every BIGSERIAL into a per-node residue class precisely so cross-node
collision cannot occur. A natural key inherits none of that. I asserted an inherited property the
precedent does not have. → **`M10B-D25r2`**: PK `(agent_id, submission_id, writing_node)`, mirroring
V46's own `(signal_hash, accepting_node)`; dedupe on the drain; ack deletes all copies.

### F4 — `M10B-D26r`'s refusal points at a flow that does not exist

Two errors. **The blast-radius claim is false**, and falsified by the very code D-26r cites: a pre-auth
registration whose `resolveAccountId` throws is caught, logged `preauth.account.link.failed`, falls
through with `accountId` still `null`, and returns `register_success`. So a single transient DB error at
registration produces an account-less agent on the *modern* path, not just the legacy one.

**And there is no repair path.** `linkAgentToAccount()` exists and `V28` grants the UPDATE it needs —
with **zero production callers**, and no portal route touching `agent_profiles.account_id` at all. So
`operator_linkage_unresolved` telling the operator to "link an account in the portal" points at nothing.
That is precisely the error-fidelity failure the decision claimed to avoid. → **`M10B-D26r2`**: the
refuse-at-intake choice stands, the false claim is withdrawn, and wiring `linkAgentToAccount()` to a
portal route becomes a prerequisite of the refusal being honest.

### F5 — `DOD-END-SCOPE-FIX-1` cannot start, and it is sequenced first

`listPresentable`'s SQL needs `opts.accountId`. **`accountId` does not exist anywhere in the daemon's
production code** — which is *why* the function has no callers. `M10B-D18` resolves agent→account on a
directory route **for the portal**, not for the daemon.

**Fourth time this milestone: a mechanism named without checking its inputs exist.** The pattern is now
unmistakable and it is the single most useful thing this determination has produced about how I work.
→ SCOPE-FIX-1 rescoped to the **`subject_kind='agent'` half**, which needs no account and closes the
agent-subject scoping hole immediately; the account-subject half is explicitly deferred behind a named
prerequisite (where the daemon obtains its `accountId`) rather than assumed.

### F6 — `M10B-D28`'s persisted signature has no consumer

D-28 argued a compromised node could forge `revoker_pubkey`, and fixed it by persisting the inner
signature. **Nothing verifies it** — `M10B-D12r4`'s read path is a SQL view, and a view cannot check
Ed25519. So the forged tombstone still reads `revoked` everywhere; the column makes forgery detectable
in principle and prevents nothing. NO CONSUMER, NO SHIP. Corrected: the persisted signature is
**audit evidence, not a defense**, and it is labelled as such — with verify-on-read named as the
follow-up that would make it a defense. Claiming a mitigation that mitigates nothing is worse than
naming the residual.

### F2 / F7 — smaller, taken

`decodeInboundSignalingFrame` returning `null` sends `not_authenticated`, so an upgraded daemon acking
to a **not-yet-deployed directory node** — routine, since nodes deploy independently per region — gets
an auth-flavoured name for a version-skew bug, and the operator debugs keys for a day. Directory nodes
being sovereign makes this the normal case during a rollout, not an edge. Recorded on D-25r as a known
skew symptom with `unsupported_frame` as the fix. And the ARCH-1 line itself still describes Entry 7's
world — updated.

### The pattern, stated plainly because it is the finding above all the others

Four of this milestone's blocking findings are the same mistake: **I name a mechanism and reason about
its behavior without reading whether its inputs exist or who consumes its output.** `listPresentable`
(no callers), `accountId` (does not exist in the daemon), the pickup path (envelope-shaped decode),
`linkAgentToAccount` (no callers), the persisted signature (no verifier). The determination has caught
every one *before a line of code was written*, which is what it is for — but the cheaper fix is the
habit: **for every mechanism named in a decision, grep its callers and its inputs before writing the
sentence, not after a reviewer asks.**

---

## Entry 15 — F3 CLOSED: `M10B-D12r4` verified inside V46's REAL view — 2026-07-28

F3 asked for the corrected expression to be re-measured **inside V46's real `CASE`**, with the
supersession ordering, rather than as a standalone fragment. Done, against local Postgres 18, on the
actual view shape read from `V46__signal_records.sql:197–221`.

**Why the real view mattered and the fragment could not suffice.** V46's supersession branch is a
**correlated `EXISTS` subquery**, not an aggregate —
`EXISTS (SELECT 1 FROM signal_records s WHERE s.supersedes_hash = r.signal_hash AND s.status <> 'revoked')`.
A standalone test of the revoke branches cannot exercise it at all, so the one ordering the third
review identified as load-bearing — revoke must precede supersession — was **untestable in the previous
fixture by construction**.

**Nine shapes, eleven rows, new expression vs. V46 as it stands today:**

| hash | shape | V46 today | `D-12r4` |
| :-- | :-- | :-- | :-- |
| h1 | tombstone only | revoked | revoked |
| h2 | record only | active | active |
| h3 | revoker = issuer | revoked | revoked |
| **h4** | **revoker ≠ issuer (the F6 defect)** | **revoked** | **active** ← the only change |
| h5 | legacy tombstone, NULL revoker | revoked | revoked |
| h6 | portal record, rotated KMS key | revoked | revoked |
| h7 | real non-tombstone row carrying `status='revoked'` | revoked | revoked |
| **h8** | **revoked AND superseded** | **revoked** | **revoked** |
| h8s | the successor row | active | active |
| h9 | superseded only | superseded | superseded |
| h9s | the successor row | active | active |

**Exactly one row changes, and it is the defect being fixed.** Three things this proves that the
previous table could not:
- **h8 — the ordering is right.** A record that is both revoked and superseded still reads `revoked`,
  honoring V46's rule that revoked is the strongest statement. Had the revoke group been placed after
  the supersession branches it would read `superseded`, and a withdrawn endorsement that happened to
  have a successor would quietly downgrade to a weaker status.
- **h9 — supersession is untouched.** The five new branches do not swallow the supersession path.
- **h7 — the fifth branch works**, closing the regression the third review found in the bare
  replacement.

**F3 is closed.** The other three (F1 `submission_results` PK, F4 `linkAgentToAccount` wiring, F5
`SCOPE-FIX-1` rescope) are recorded as decisions and prerequisites in the DoD; none needs measurement —
they need building.

**Method note, now a standing rule for this milestone:** *a SQL expression is verified inside the real
view it will live in, never as a fragment.* Four versions of this expression were wrong and each looked
correct in isolation; the fragment test caught two, and only the real-view test could have caught the
ordering.

---

## Entry 16 — FOURTH REVIEW: closest yet, and my own fix was a security hole — 2026-07-28

Fourth pass. **Still 🟡, but the reviewer said explicitly it is withholding the flip on substance, not
caution** — and it independently re-derived F3 from V46's source rather than trusting Entry 15, plus
attacked F1's ack-delete mechanism as asked and found it **sound**.

**What is genuinely closed:** F3 (confirmed by independent re-derivation — `supplement` is a no-op on
h4, `no_fifth` regresses h7, `wrong_order` downgrades h8; all three of Entry 15's claims verify). F1's
mechanism (the publication carries DELETE with no `WITH` clause and REPLICA IDENTITY defaults to the
PK, so the ack's delete **does** replicate — no node keeps a copy forever). F2, F6, F7.

### HIGH-1 — my `D-26r2` prerequisite was an authorization bypass on the kill switch

I mandated wiring `linkAgentToAccount()` to a portal route. **I did not read its body.** Verified now
(`pre-auth-token-repository.ts:500–547`):
- It is `UPDATE agent_profiles SET account_id = $1 WHERE k_local_pubkey = $2` — **no ownership check**,
  and `k_local_pubkey` is a *public* value anyone can read from the directory.
- `resolveAccountId` **creates** an account for whatever phone stub is supplied; it never binds to the
  caller's session.
- `agent_profiles.account_id` is the authorization root for the **kill switch** — the write seam
  derives scoping from it *"NOT from a request field"*, and it fronts pause/**burn**, which is
  monotonic and terminal.

Composed: attacker's phone stub + victim's public `k_local_pubkey` → the victim's agent is reassigned
to the attacker's account → the attacker can **permanently burn it**. The unused `agentProfileId` in
the params interface is the tell that nobody had read the body.

**This is the fifth instance of the pattern Entry 14 named — and the first where the un-read mechanism
is a privilege-granting write.** I named the pattern, wrote a rule about it, and then committed it
again in the very edit that responded to the review. That is worth recording plainly: naming a habit
does not fix it; the fix is the grep, every time, before the sentence. → `DOD-END-ACCOUNTLINK-1`, a
real line with ACs including a negative test.

### The rest

- **HIGH-2 — `submission_results` had no clause adding it to `PUBLICATION_TABLES`.** `D-25r2`'s entire
  correctness rests on the results being replicated, and the mechanism that replicates them is a
  hand-maintained list in a shell script that nothing in the DoD mentioned. Build it without that step
  and the feature passes single-node tests and **silently delivers nothing**. Added as a required
  clause. (This is also why the `identity_tree_entries` fix earlier tonight mattered — same list.)
- **HIGH-3 — `D-25r2`'s PK named a column its own column list omitted**, and my edit spliced a
  sentence in half. The table is now stated once, authoritatively, with `writing_node` present.
- **HIGH-4 — `SCOPE-FIX-1` named the wrong join key.** `subject` for an agent-subject row is the
  **`k_local_pubkey` hex**, not the daemon's device-local UUID `agent_id`. And the existing fixture
  seeds `subject` with the UUID — so a coder following my wording would copy the fixture, go green, and
  match **zero** production rows, silently un-presenting every agent-subject signal. On the unit
  sequenced first. The fixture convention has to be fixed before the test is written, or the test does
  not survive the revert test.
- **MEDIUM-1 — a TENTH shape changes**: `issuer_kind='directory'` records become unrevocable, because
  branch 4 tests only `'portal'`. V46 deliberately admits `'directory'` and nothing issues it today —
  **the identical §5a argument I used twice to add branches 2 and 5, and failed to apply a third
  time.** So "exactly one row changes" was again scoped to the shapes I chose.
- **MEDIUM-2 — `D-12r4` breaks V46's documented monotonicity invariant.** An unauthorized tombstone
  that lands first reads `revoked`, then reads `active` when the real record replicates in —
  `revoked → active` through ordinary convergence, with no write. V46's header claims this cannot
  happen. The header must be amended in the same migration.
- **MEDIUM-4** — the dedupe tiebreak: V46 can use a bare `MIN()` because content-addressing makes the
  copies identical; `sealed_result` is **not** content-addressed. Tiebreak named (lowest
  `writing_node`).
- **LOW-1** — the supersession list omitted `D-25`, `D-25r`, `D-26`. Now a complete table.

**Assessment.** Four passes, and the shape of the findings has changed: passes 1–3 found broken
*designs*; this one found mostly broken *editing* — a spliced sentence, a column named but not
declared, an incomplete supersession list — plus one genuine security defect and two scoping misses.
That is the profile of a determination approaching done. The reviewer's own read: *"none of that needs
a fifth measurement pass. It is a single editing session, and the only one with real design content is
F4."* Agreed.

---

## Entry 17 — correction TO the fourth review: V46's header cannot be amended — 2026-07-28

The fourth review's MEDIUM-2 fix said to *"amend V46's header comment in the same migration"* so the
documented monotonicity invariant matches `M10B-D12r4`'s behavior. **That instruction is unsafe and I
am not taking it**, for a reason the review did not check.

**V46 is an APPLIED migration** — the directory is at V48 — and **Flyway checksums the entire file,
comments included**. Editing V46 would:
1. produce a checksum error on every node's Flyway run,
2. crash-loop the ops-agent, which validates the migration version against
   `OpsAgentExpectedMigrationVersion`, and
3. violate two of the repo's own hard rules from the M5 retrospective — *"Never modify an applied
   migration"*, and the standing AC that *"Flyway reports zero checksum errors on all prior migrations
   (V1 through V[N-1])"*.

This is exactly the FEDERATION-002 shape the M5 retrospective was written about.

**The corrected superseding statement goes in the NEW migration's header** — the one that replaces the
view — stating what it changes about V46's claim and why. That is the only place it *can* go, and on
reflection the better place regardless: the migration that changes the behavior is the one a later
reader will be looking at when they wonder why the behavior differs from V46's prose.

**Worth noting for the record:** this is the first finding in four passes where the reviewer's proposed
*fix* was wrong rather than its diagnosis. The diagnosis (D-12r4 does break V46's stated monotonicity,
and that must be documented) is correct and stands. Reviewers are held to the same standard as the
work: verify the proposed remedy, not just the finding.

---

## Entry 18 — fifth review pass DIED on the session quota — NO VERDICT — 2026-07-29 (~00:5x)

The fifth `cello-unit-reviewer` dispatch terminated early: *"Agent terminated early due to an API
error: You've hit your session limit · resets 1:30am."* It got as far as *"I'll read the three commits
and the current DoD/journal state"* and produced nothing else.

**A killed reviewer is NOT a pass.** Recording this explicitly because the failure mode is obvious and
tempting: five dispatches, four verdicts, and a fifth that "didn't find anything" — except it didn't
look. `DOD-END-ARCH-1` therefore stays **🟡 on four verdicts, not five**, and the flip question is
**unanswered**, not answered favourably.

**State for whoever picks this up (a later cron firing, or Andre):**
- Every finding from all four completed passes has a recorded fix in the DoD. The fourth reviewer's own
  closing read was *"none of that needs a fifth measurement pass. It is a single editing session, and
  the only one with real design content is F4."* **That editing session is done** — commits `1921f5da`,
  `83ecf62b`, `a555ad47`, `ba971512`.
- So the fifth pass was **confirmation, not discovery**. Re-dispatch it after the quota resets; the
  brief is in the session history and asks it to rule CLOSED/NOT-CLOSED on each fourth-pass finding
  plus the one question that matters: *is this good enough to build against* — with each remaining item
  labelled DESIGN gap (settle before code) or IMPLEMENTATION detail (settle in the unit).
- **Two things still need Andre**, unchanged: the parked `DOD-END-DISCOVER-1` policy question (the
  endorsement graph is readable in plaintext by any node operator once minted), and the fact that
  nothing has been pushed — 35 commits sit on local `main`.

**Honest assessment of the night, since this is a natural place to make one.** The determination
consumed the entire session and never flipped. That is not obviously wrong — it caught, before any code
existed: a revoke predicate that would have silently made every withdrawal inert; a consent default
that would have flipped refused endorsements back to accepted on daemon restart; a return path that was
unbuildable at both ends; a primary key that could have wedged all federation; and a portal route that
would have let anyone permanently burn someone else's agent. Any one of those found *after*
implementation costs more than this night did.

But the counter-case deserves stating rather than being argued away: **five review passes on a
document is a lot of passes**, and the last one was confirmation. If the sixth also finds only editing
errors, the right call is to flip on the fourth reviewer's standard — *"would a competent coder
following this build the right thing, with the remaining unknowns named as unknowns"* — and let the
per-unit reviews catch the rest, which is what they are for. Determinations are supposed to converge,
not to be polished indefinitely; the launch-triage lens applies to process too.

---

## Entry 19 — `DOD-END-SCOPE-FIX-1`: the fixture trap, root-caused; the fix is three lines — 2026-07-29

Traced the fourth review's HIGH-4 fixture trap to its source before writing any test, so the
implementing session starts from evidence rather than a warning.

**The trap, confirmed.** `seedAgents` (`__tests__/helpers/seed-agents.ts:35–59`) returns
**`name → agent_id`** — a UUID from `store.createAgent`. `trust-signal-store.test.ts` then uses those
UUIDs as `subject` for `subjectKind: "agent"` rows (`:150–151`). In production `subject` holds the
**K_local pubkey hex** (the directory joins `ap.k_local_pubkey = sr.subject`). So the fixture asserts a
convention the wire does not use, and a scoping predicate written to match it passes green while
matching **zero** production rows.

**The fix is small, which is the good news.** `seedAgents` **already derives the real pubkey** —
`const pubkeyHex = Buffer.from(await new InMemoryKeyProvider(seed).getPublicKey()).toString("hex")`
(`:53`) — and stores it. It simply does not return it. So: return `name → { agentId, pubkeyHex }` (or a
second map), and point the agent-subject fixtures at `pubkeyHex`. No new key material, no invented
values — and the helper's own header already warns that a pubkey disagreeing with its seed *"is not a
shortcut — it is a corrupt identity that would surface as a baffling failure much later,"* which is
exactly the class of bug this fixture would have produced from the other direction.

**Order of work for the implementing session, red-first:**
1. Extend `seedAgents` to return the pubkey it already computes. Mechanical, no behavior change.
2. Re-point the agent-subject fixtures in `trust-signal-store.test.ts` at `pubkeyHex`. **Expect
   existing tests to go red here** — that redness is the defect surfacing, not a regression, and it is
   the first honest signal that `listPresentable`'s scoping was only ever exercised against the wrong
   key.
3. Only then write the new scoping test against `listAllActive`, and implement.

**Scope reminder:** the agent-subject half only (`M10B` fourth review F5). The account-subject half
stays deferred behind its named prerequisite — the daemon has no `accountId` anywhere in production
code, and inventing one is a separate decision.

---

## Entry 21 — `DOD-END-ARCH-1` CLOSED on four passes; `DOD-END-SCOPE-FIX-1` BUILT — 2026-07-29

Two things, and the first exists so the second could happen.

### `DOD-END-ARCH-1` → ✅ (`M10B-D29`)

Entry 18 named the standard and this applies it: four completed passes, a fifth that died on the
quota, and a fourth reviewer whose own closing read was *"none of that needs a fifth measurement
pass."* Re-dispatching to confirm an editing session is the review trap in a different hat — the cap
(`M10B-PROCEDURE` §3) says remaining findings become **ACs on the units they affect**, so each of the
four was placed on its owning unit rather than held against the determination:

| open item | now owned by |
| :-- | :-- |
| F1 — `submission_results` PK needs its node component | `M10B-D25r2`'s authoritative table → `DOD-END-INGRESS-1` |
| HIGH-2 — `submission_results` must join `PUBLICATION_TABLES` | the required clause on `M10B-D25r2` |
| F4 — `linkAgentToAccount` is an authorization bypass | its own line, `DOD-END-ACCOUNTLINK-1`, with a negative test |
| MEDIUM-1/2 — `directory` issuer_kind + the monotonicity statement | `M10B-D12r4` → `DOD-END-REVOKE-2` |
| F5 — SCOPE-FIX-1 rescope | built, below |

Unchanged: `DOD-END-DISCOVER-1` stays 🅿️ — it is a policy call and it is Andre's.

### `DOD-END-SCOPE-FIX-1` — BUILT (commit `4f3e835`, cello-client)

**Clause checklist, the yardstick the reviewer received:**

| # | clause | evidence |
| :-- | :-- | :-- |
| C1 | scoping lands on the LIVE path, not the dead one | predicate is in `listAllActive`; `listPresentable` untouched but for its param name |
| C2 | in the SQL, not a JS branch | `AND (subject_kind <> 'agent' OR subject = ?)` |
| C3 | scopes on the K_local pubkey, not the `agent_id` UUID | call site resolves `loadedAgents.find(a => a.name === agentName).pubkey` |
| C4 | fixture convention fixed FIRST; test survives the revert | `seedAgentKeys` added; a test asserts the UUID matches **nothing** |
| C5 | agent-subject half only; account half deferred, not faked | stated in `listAllActive`'s doc comment with the prerequisite named |
| C6 | absent presenter ⇒ REFUSE | `throw` on empty/absent, asserted both ways |
| C7 | nothing type-shaped | the predicate keys on `subject_kind`, which is envelope data |

**The defect, restated from the code rather than the DoD:** the wallet is daemon-wide (M10-D14: no
agent column at all — the envelope's own `subject` decides who may present it). `listAllActive` never
looked at `subject`, so on a daemon holding Alice and Bob, **Bob's session offered Alice's
agent-subject signals to Bob's counterparties**. Live, in M10, today.

**Red first, and the red was informative.** Re-pointing the fixtures from `agent_id` to `pubkeyHex`
turned 10 tests red before a line of implementation existed — exactly what Entry 19 predicted, and
the first honest signal that the scoping had only ever been exercised against the wrong key.

**The revert test, on the load-bearing assertion:** revert the SQL predicate and
`listAllActive({presentingAgentPubkeyHex: bobPubkey})` returns Alice's signal too, so the assertion
fails. The trap test is the stronger one — pass the UUID and the result must be **empty**, which is
red both if the predicate is missing (returns everything) and if it were written against `agent_id`
(returns the row).

**One deliberate non-deletion.** `listPresentable` remains dead code, and deleting it was tempting.
It is the only implementation of the ACCOUNT-subject half, which is deferred behind a named
prerequisite — deleting it would delete the design along with the code and leave the deferred half
with nothing to come back to. Its doc comment now says it has no callers and why it is kept, so it
cannot be mistaken for the live path again (which is how this defect survived M10 in the first place).

**Gate: 2044 tests, lint, typecheck, build — all green** in cello-client. And the gate debt Entry 20
recorded against `DOD-END-QUEUE-1`/`DOD-END-DELIVER-1` is discharged too: trustless-cello runs green
on all four.

---

## Entry 22 — DESIGN NOTE — `DOD-END-SUBMIT-1` (written before any code) — 2026-07-29

**Two repos, stated up front (§2a):** cello-client (protocol-types + daemon) and trustless-cello
(directory frame handler). The queue TABLE exists (Entry 20) and **nothing writes to it** — the wire
path is this unit.

**Target behavior (one sentence).** Bob's daemon composes an endorsement, signs it with his agent
key, seals it to the portal's intake key, and hands it to a directory node that cannot read it — and
if any part of that is unavailable it refuses and says which part, rather than sending anything
unsealed.

**Spec anchors.** `M10B-D2` (the ingress IS this queue; the daemon never calls the portal), `M10B-D11`
(the intake key rides the manifest; absent ⇒ refuse), `M10B-D20` (`submission_id` = sha256 of the
signed body, a routing HINT the directory cannot verify), `M10B-D21` (unreplicated ⇒ the submitter's
failover across nodes is what covers a dead node), `M10B-D28` (the sealed body is `op`-discriminated;
the TBS builder lives in `@cello-protocol/protocol-types` so daemon and portal produce identical
bytes; `issued_at` inside the TBS bounds replay). Crypto: Ed25519 → RFC 8032, CBOR → RFC 8949,
SHA-256 → FIPS 180-4.

### The verifications — done before the sentences, which is the habit Entry 14 said was missing

- **V1 — the sealing primitive exists and is the right one.** `sealToRecipient(recipientEd25519Pub,
  plaintext)` / `openSealed`, exported from `@cello-protocol/crypto`
  (`content-seal.ts:89`, `index.ts:64`). This is the same primitive the M10-D22 pickup path uses, so
  the queue really is its mirror image rather than a new crypto surface.
- **V2 — the daemon already holds the verified manifest object, so reading one more field needs no
  new interface.** `manifestProvider.getCurrentManifest()` returns a cached, signature-verified
  `ConsortiumManifest`, with a live precedent at `register-handler.ts:137`. Checked the provider, not
  just the type.
- **V3 — but `ConsortiumManifest` is CLOSED, and `M10B-D11` reads as though it were not.** The
  protocol-types interface (`manifest.ts:78–86`) has **no index signature**: `version`, `not_before`,
  `expires`, `nodes`, `signatures`. So the intake key is an additive change to that interface, not a
  free-form field. D-11's *signature-coverage* claim is unaffected and still holds — coverage comes
  from crypto's `canonicalManifestBody` building the signed body from `Object.keys(manifest)`, and
  crypto's own `ConsortiumManifestInput` **does** carry `[key: string]: unknown` (`manifest.ts:38`).
  Two different types, one open and one closed; only the closed one needs editing.
- **V4 — the inbound frame set is genuinely additive, and it lives in the DIRECTORY repo.**
  `packages/directory/src/directory-frames.ts:389` is a plain union with a `decodeInboundSignalingFrame`
  switch. The daemon does **not** need an encoder: it sends raw CBOR maps through
  `signaling.sendRaw({type: …})`, exactly as `session_request` does. So "adding a frame kind" is one
  union member and one decoder case on the directory side, and a literal map on the daemon side.
- **V5 — the queue repository is ready and unwired.** `enqueueSubmission(db, {submissionId,
  intakeKeyId, ciphertext}) → boolean` (`submission-queue-repository.ts:62`), **zero callers**. Its
  boolean is the censorship signal Entry 20's review added, and this unit is the consumer that makes
  it non-dead: the handler must distinguish `queued` from `duplicate`.

**Producer/consumer chain.**

| Thing | Producer | Consumer | If wrong |
| :-- | :-- | :-- | :-- |
| intake key `{key_id, pubkey}` | consortium manifest (officer-signed) | Bob's daemon | absent ⇒ MUST refuse; a fallback to unsealed hands the directory every endorsement |
| submitter signature over the TBS | Bob's daemon (K_local) | the PORTAL, at drain | unverified ⇒ anyone mints an endorsement attributed to anyone, permanently, inside the hash |
| sealed ciphertext | Bob's daemon | portal intake key | sealed to the wrong key ⇒ undecryptable poison with no reply (unattributable, `M10B-D22b`) |
| `submission_id` | daemon (sha256 of signed body) | directory PK / portal dedupe | a HINT only — the directory cannot open the seal to check it (`M10B-D20` correction) |
| queued/duplicate boolean | `enqueueSubmission` | the frame handler's event | collapsed ⇒ a censorship attack is silent (Entry 20) |

**The seam.**
- `@cello-protocol/protocol-types` — the submission body type, the canonical CBOR encoder, the TBS
  builder, and `intake_key?` on `ConsortiumManifest`. It lives here because **the portal must rebuild
  these bytes identically** and the portal depends on protocol-types and crypto only.
- `cello-client/core/daemon` — compose → sign → seal → send, with failover across nodes; the manifest
  intake-key read; the refusal paths.
- `trustless-cello/packages/directory` — one inbound frame kind, one handler calling
  `enqueueSubmission`. **`submitSignal`/notarization is NOT touched** (Entry 4 V1).

**Invariants at stake, and the property that prevents each violation.**
- **INV-ATTRIBUTION.** Stated precisely, because a reviewer will otherwise read the body as
  caller-supplied: **Ed25519 has no key recovery** (RFC 8032), so "derive `issuer_pubkey` from the
  signature" cannot mean literal recovery. The body carries the submitter pubkey, and it is
  **worthless until the signature over the TBS verifies against it** — a body claiming P with a valid
  signature by P proves possession of P's private key. The AC is therefore: the pubkey is never read
  except as the verification key, and never trusted before that verification succeeds.
- **INV-CONSENT / DOD-END-DISCOVER-1.** The directory sees `{submission_id, intake_key_id,
  ciphertext}` and nothing else — no submitter, no subject. Enforced by the schema (Entry 20), and
  this unit must not add a field to the frame that the table would then want.
- **INV-ZEROBUMP.** Nothing here learns the string `endorsement`. The discriminator is `op`
  (`M10B-D28`) — a protocol verb, not a signal type — and `subject_kind`, which is envelope data. A
  second client-sourced type sends the identical frame.
- **§5a ABSENT IS NOT FINE.** Three refusal paths, each naming its own cause: no intake key in the
  manifest, no manifest at all, every node unreachable. None of them may degrade to sending.

**Approach + rejected alternative.** Sign, then seal, then send with failover; the id is content-
derived so a retry to a second node is a strict no-op rather than a double-mint. **Rejected: seal
then sign.** Signing the ciphertext would bind Bob's identity to bytes he cannot prove the meaning
of, and the portal would have to open before it could attribute — inverting the order that makes an
unopenable blob *unattributable poison* rather than a wrongly-attributed submission. **Also
rejected: an HTTP route on the directory** — the daemon has no directory HTTP client for authenticated
writes, and the signaling stream already carries a challenge-response-authenticated identity that
flood protection needs (Entry 10's correction: `verifySignedRequest` over HTTP proves only "some
submitter-role key", the signaling frame yields a verified `authedPubkeyHex`).

**Falsification pass.**
1. *Does the call site have the method on the INTERFACE?* Yes — V2, checked the provider and a live
   caller, not the type alone.
2. *Does responsibility sit right?* The TBS builder is in protocol-types, not the daemon, because a
   local copy on each side is exactly how two implementations drift into producing different bytes
   for the same submission (`M10B-D28`).
3. *What redundancy?* `submission_id` is both the PK and the retry dedupe key — one mechanism, two
   jobs, rather than a separate nonce.
4. *What else breaks?* A new frame kind reaching a directory node that has not deployed it:
   `decodeInboundSignalingFrame` returns `null` and the node replies `not_authenticated`, which is an
   auth-flavoured name for a version-skew bug (`M10B-D25r`'s F2). Directory nodes are sovereign and
   deploy per region, so this is the NORMAL rollout case. The daemon must not read that reply as an
   auth failure — it fails over to the next node and reports the skew.

**Decisions this note makes.**
- **M10B-D30 — the frame is `submission_write` and its ack is `submission_write_result`, carrying
  `{stored: boolean}`.** The boolean is `enqueueSubmission`'s return value and this is its named
  consumer (NO CONSUMER, NO SHIP): `stored: false` means the id was already present, which is usually
  the submitter's own retry and is also the shape of the single-node censorship attack Entry 20
  identified. The daemon logs `signal.submission.queued` vs `signal.submission.duplicate` and does
  **not** treat duplicate as success on a node it has not written to before.
- **M10B-D31 — the submission TBS domain tag is `CELLO-SUBMIT-v1`.** Distinct from `CELLO-TSIG-v1`
  (the envelope preimage, protocol-types) and `CELLO-TSIG-REQ-v1` (the directory request, verified to
  live in `signal-write.ts`), so a signature over one can never be replayed as the other.
  TBS = `CELLO-SUBMIT-v1 ‖ canonical-CBOR(body-without-signature)`, and `issued_at` is inside the
  body, so the existing clock-skew bound applies to it (`M10B-D28`).

**Nothing parked.**

**Test plan sketch (red first).**
- Refusal, each naming its own cause and each asserting **nothing was sent**: manifest absent;
  manifest present with no `intake_key`; all nodes unreachable. A bare `submission_failed` is a
  failing assertion.
- **Never unsealed:** a test that the bytes handed to the transport are not the plaintext body — the
  revert test being that removing the seal call makes it red.
- Attribution: the signature verifies against the pubkey in the body, and a body whose pubkey is
  swapped for another agent's fails verification. (Portal-side enforcement is `DOD-END-INGRESS-1`;
  this unit proves the bytes it emits are verifiable.)
- Determinism: the same body signed twice yields the same `submission_id`; a re-issue with a
  different `issued_at` yields a different one.
- Failover: node A refuses/times out ⇒ the daemon writes to node B, and the id is identical.
- Directory side: an authenticated `submission_write` lands a row; an UNauthenticated one does not;
  a duplicate id returns `stored: false` and does not overwrite the ciphertext.
- Zero-bump: nothing in the diff branches on a type string.
- Enforcer: `DOD-END-JOURNEY-1` end-to-end; the unit itself is harness-provable offline.

**Owed:** a protocol-types change ⇒ the publish cascade (deferred, §2c); a directory change ⇒ the one
batched deploy (hibernated, §2e). Both land 🟡 until then.

---

## Entry 20 — `DOD-END-QUEUE-1` and `DOD-END-DELIVER-1` BUILT — 2026-07-29

**Two units, 20 tests green against real Postgres.** Evidence, since the DoD only carries one line each.

**`DOD-END-QUEUE-1` — V51 + `submission-queue-repository.ts` + 9 tests.** Four columns; the absences are
the design. Not replicated (M10B-D21). Green: exact column set; no submitter/subject/kind/type/payload/
reason column under any name; absent from `PUBLICATION_TABLES` with a parse-proving control; **no UPDATE
grant**; enqueue returns whether the row was stored; retry-is-a-strict-no-op under mismatched bytes;
sweep refuses a destructive TTL; oldest-first drain; intake-keys-in-use; idempotent delete.

**`DOD-END-DELIVER-1` — V52 + `enqueuePickup` re-key + 5 tests.** Two endorsements for one offline
subject now both survive. Carries a **revert proof**: a test that rebuilds V37's old index on a scratch
table and demonstrates the second endorsement being destroyed, so the fix cannot be silently reverted.

**Revived `trust-001-pickup-repository.live` — RED since V48 (2026-07-25), four days, unnoticed.** It
seeded `identity_tree_entries`, which V48 dropped. Triaged by SUBJECT: the pickup repository is alive,
so re-pointed rather than deleted — the hash rides the pickup row (V47), as production does. Every
unchanged assertion preserved verbatim. **Why nobody noticed: the file is gated on `CELLO_ENV=local`, so
CI is green with zero of its assertions executing.** That is true of ~20 sibling files, and it means
"green" in CI says nothing about this layer.

**Review (ONE pass, per the new cap) — findings fixed, not re-reviewed:**
- `enqueueSubmission` returned `void`, so a write that did not happen was indistinguishable from one
  that did. That is a **single-node censorship primitive**: `submission_id` is visible in the clear to
  the receiving node, so it can be copied and pre-inserted with garbage at the other two, and the
  submitter's failover retries — the safety mechanism — all resolve to "already present" with no event
  anywhere. Byte-comparison cannot detect it (a legitimate re-seal produces different bytes under the
  same id). Now returns boolean; residual written down.
- `sweepStaleSubmissions` destroyed the **entire queue** on `ttlHours <= 0`. Now refuses loud.
- Two tests failed the revert test: the absence test passed against a table that does not exist, and
  the oldest-first test proved only lexical ordering. Both fixed.

**The migration-gap guard in `deploy.sh` is the highest-value thing here.** V49/V50 belong to the M12
branch; main has V51/V52. Deploying with a gap SUCCEEDS — the damage lands on the next merge, when
Flyway finds unapplied migrations below the current version and aborts under `set -e`, killing the
entrypoint before `exec node`, **in all three regions at once**. The preflight only ever took the
maximum version, so a gap was invisible by construction. Now blocks on gaps and duplicates.

### Procedure violations in this session, recorded because the pattern matters more than the code

1. **TDD order inverted.** SPARC is absolute: tests first, confirm red, then implement. I wrote both
   migrations and the repository *before* their tests, and proved behaviour with ad-hoc SQL instead of a
   red test. The tests pass — but they were written against code that already existed, which is the
   weaker artifact, and it is exactly how a test ends up shaped to the implementation rather than to the
   requirement. Two of the four review findings were hollow tests; that is not a coincidence.
2. **Completion gate skipped.** Committed on targeted vitest alone — no lint, no typecheck, no build —
   and changed `enqueueSubmission`'s return type without typechecking its callers. Owed before these
   units can go past 🟡.
3. **Ending turns on reports.** The procedure says a status line is *"never the last thing a turn does"*,
   and I did it repeatedly. Reporting in is not a stopping condition.

---

## Entry 23 — TWO SESSIONS ARE LIVE ON M10B; two findings on Entry 22's wire contract — 2026-07-29

**Read this before trusting the entry numbering.** A second session was working this milestone at the
same time as this one. Evidence, not inference: at 07:02 `HEAD` was `a98f528b`; `0f4cb7d8` (07:01) and
`5dcde312` (07:05) appeared underneath while this session was reading, and `submission.ts` +
`m10b-submission.test.ts` arrived in the working tree untracked, written by neither of my hands.
I appended a SECOND Entry 22 and a SECOND `M10B-D30` before noticing. **Both are withdrawn** — the
numbering that stands is Entry 22's (`M10B-D30` = the frame names, `M10B-D31` = the domain tag). This
entry keeps only what was additive.

`M10B-PROCEDURE` §5d says **one thread, one coder**, and two coders on one unit is precisely the hazard
it names. So this session is **off `DOD-END-SUBMIT-1`** and does not touch `cello-client`
`protocol-types` or the daemon further; the other session owns it.

### Finding 1 (HIGH, design — cheapest to fix now, before the portal arm exists)

**The submission TBS carries no signal type, and `DOD-END-PLAYBOOK-1` cannot be satisfied without
one.** `submission.ts`'s header states the omission as a zero-bump property: *"nothing that names a
signal TYPE… A second client-sourced type sends this identical structure (INV-ZEROBUMP)."* Identical
structure is the problem, not the property: if two client-sourced types are byte-indistinguishable on
the wire, the portal has nothing to mint them apart by, so **every submission through this arm mints
the same type.**

`DOD-END-PLAYBOOK-1` requires *"a SECOND client-sourced type … taken from nothing to live end-to-end**
**as a pure Type Playbook run — `git diff --stat` empty in cello-client AND trustless-cello."* With no
type on the wire, expressing `client_canary` from a client requires a client change, and the proof
fails **by construction** — the same failure mode the line exists to detect, arriving as a wire
change rather than a missing feature.

**INV-ZEROBUMP forbids BRANCHING on a type, not CARRYING one.** `trust-signal.ts` says so in its own
words: *"`type` is an OPAQUE STRING here and everywhere in the client and the directory: never an
enum, never switched on."* The envelope carries `type` in slot 5 for exactly this reason, and it is
what makes zero-bump work rather than what threatens it. Carrying an opaque `signal_type` the client
never reads keeps the invariant and makes the playbook run reachable.

**Stated as the cost if it is left:** a wire-format change after the first submission is signed is a
breaking signature change (the field set is CLOSED and the arity is checked), so this is far cheaper
now than after `DOD-END-INGRESS-1` verifies its first body.

### Finding 2 (constraint on `DOD-END-INGRESS-1`, discovered while falsifying the seal)

**The portal's intake private key cannot live in KMS.** `sealToRecipient` seals to an Ed25519
*public* key, which is what the daemon holds — that part is fine. But its counterpart `openSealed`
derives the X25519 scalar from the Ed25519 **seed** (`content-seal.ts`: `ed25519SeedToMontgomeryScalar`,
RFC 8032 §5.1.5 + RFC 7748 clamping). KMS never exports a private key and does not perform X25519
ECDH, so the intake key cannot be a KMS key the way `submission-signer.ts`'s signing key is. It has to
be a secret-held raw seed with its own custody and rotation story. `M10B-D11` settles *distribution*
of the public half and is silent on custody of the private half; INGRESS-1 owns it.

### Also checked, additive to Entry 22's falsification pass

`ConsortiumManifest` (`core/protocol-types/src/manifest.ts:78`) has **no index signature**, so the
optional `intake_key` field is a real additive change to that interface — and therefore rides the
publish cascade. Verification itself needs no change: `ConsortiumManifestInput` in crypto *does* carry
`[key: string]: unknown`, and `canonicalManifestBody` builds the signed body from `Object.keys` minus
`signatures`, so officer signatures cover the new field automatically and older manifests still verify
byte-for-byte (`M10B-D11`, confirmed independently here).

---

## Entry 24 — handoff: four `DOD-END-SCOPE-FIX-1` findings the other session's pass did not cover — 2026-07-29

Context in [[#Entry 23]]: two sessions ran M10B concurrently. Both reviewed `4f3e835`, independently
and with the same verdict on the big three — **F1** (a malformed presenter returns `[]` instead of
refusing), **F2** (`--include` validated against the unscoped wallet, so it silently no-ops), and
**F3** (no log when the predicate drops every row) were already fixed in the working tree by the
session that owns the unit, with reasoning that matches finding-for-finding. This session's pass is
therefore redundant on those, and they are NOT re-raised.

**These four are not addressed in that working tree, and they are recorded here so they are not lost
when it commits.** They are ACs on whoever next touches this unit, per the review cap's own rule.

**F4 (HIGH, pre-existing, `core/protocol-types/src/trust-signal.ts:228`) — `subject` has no
lowercase-hex validator, and this unit just made byte-equality on it load-bearing.** `toPreimage`
validates `issuer_pubkey` as lowercase hex, with the reason spelled out in its own comment: *"Hex has
a case, and 'AABB' and 'aabb' are the same key but different preimage bytes."* For
`subject_kind: "agent"`, `subject` **is** a pubkey hex and gets only an NFC check. An uppercase-hex
subject therefore encodes, hashes, notarizes and stores cleanly — and is then invisible on both
sides: `wallet_trust_signals.subject` is `TEXT` with no `COLLATE NOCASE`, so SQLite's BINARY
collation makes the new `subject = ?` predicate miss it, and the directory's
`JOIN agent_profiles ap ON ap.k_local_pubkey = sr.subject` (`internal-api-server.ts:791`) misses it
too. Not hypothetical here: `trust-signal-store.ts:321–323` already names *"a directory version-skew
emitting uppercase hex"* as a real condition. **Fix:** the same lowercase-hex check on `subject` when
`subject_kind === "agent"`, at the one place both sides of the wire share.

**F5 (MEDIUM) — the naming inversion that let the M10 defect survive is preserved, and slightly
worsened.** `listAllActive` **no longer returns all active rows** — it returns a scoped subset, and it
is the live path, so its name now actively misdescribes it. `listPresentable` still holds the
authoritative name and is still dead; its new doc comment is honest but only reaches someone who
opens the file, while anyone who greps `listPresentable` to ask *"where is presentation scoping
enforced?"* gets the same wrong answer M10 gave. Keeping the dead function is defensible (it is the
only implementation of the deferred account half); keeping the names is not. **Fix:** rename to
`listPresentableForAgent` and `listPresentableWithAccountScope_DEFERRED`. Verified free: neither is
re-exported from `core/daemon/src/index.ts`, `package.json`'s `exports` map exposes only `.`, and
there is no consumer in trustless-cello or cello-portal.

**F6 (MEDIUM) — the unit's headline claim has zero test coverage, and the bypass is easy.** Nothing
in the repo exercises `runSessionRequestOverSignaling`'s presentation block — no test imports
`createOutboundSessions`. Change `outbound-sessions.ts` to pass `agentRec.agent_id`, `agentName`, or
`targetHex` instead of `agentRec.pubkey`: it typechecks (all `string`), lint/typecheck/build pass,
**all 2044 tests stay green**, and every agent-subject signal is silently un-presented forever. The
required parameter stops a caller OMITTING the identity; it cannot distinguish the right value from a
wrong one, which is the entire subject of the fourth review's HIGH-4. F1's format check converts that
bypass from silent to a loud throw at runtime — the cheap 80% — but the real assertion is a
`session_request` frame captured from a stub `SignalingManager` on a daemon holding two agents, with
`trust_signals` containing only the presenter's hash.

**F7 (LOW) — the call-site `throw` is unreachable in production and untested.** `negotiate` already
resolves the same lookup over the same live `loadedAgents` and returns `agent_not_found` first; the
only path to the new throw is a `cello_delete_agent` splice landing inside an in-flight negotiation.
Fine as defence in depth — but the falsification rule asks "would this create redundancy?", so it
should say that it is deliberate rather than look like a missed duplicate.

**Not a finding, recorded for the standing zero-bump lens:** `putWalletSignal`'s
`!s.type.endsWith("_id")` default-present heuristic (`trust-signal-store.ts:285`) is type-shaped. It
is pre-existing, untouched, and a generic suffix convention rather than a per-type enum — so not an
INV-ZEROBUMP violation, but it is the kind of thing that becomes one quietly.

---

## Entry 25 — `DOD-END-SCOPE-FIX-1` reviewed and CLOSED; the handed-off F4 fixed, but not as proposed — 2026-07-29

**One review pass, per the cap.** Verdict: SPEC FAITHFUL on all seven clauses, tests have teeth (all
three new ones survive the revert test), removals proven. Four findings, all fixed, none re-reviewed.

| finding | fix |
| :-- | :-- |
| HIGH-1 — the fixture trap was still live in the OTHER repo, taking down the only e2e coverage of the call site | both spine journeys now seed the agent subject with the presenting agent's real pubkey |
| MEDIUM-2 — a zero-row presentation emitted no log at all | `signal.presentation.none_eligible` with `heldTotal` |
| MEDIUM-3 — the guard rejected empty but accepted wrong-SHAPED | lowercase-hex shape check; the trap test now asserts a THROW, not a quiet `[]` |
| MEDIUM-4 — `--include` validated against the daemon-wide wallet | new scoped `listPresentableTypes()` |
| LOW-5 — the call-site lookup is unreachable via the built-in negotiator | KEPT as defense-in-depth (the negotiator is injectable), and said so rather than silently declining |

**HIGH-1 is the one worth remembering.** The unit fixed the UUID-as-subject fixture convention in
cello-client and stopped at the repo boundary — while the only tests anywhere that exercise the
presentation CALL SITE live in trustless-cello's spine journeys, and both seeded an agent subject with
a random `agent-…` string. So the change would have gone green in its own repo and red in the only
place that proves it works. `cello-client` has no test importing `createOutboundSessions` at all.

### The handed-off F4, and why I did not take the proposed fix

The other live session (Entry 24) handed off four findings its pass caught and mine did not. F4 is
real and I fixed it: `subject` for an agent-subject row IS a pubkey hex, hex has a case, and this unit
made byte-equality on it load-bearing in two places at once — the daemon's `subject = ?` under
SQLite's BINARY collation, and the directory's case-sensitive `k_local_pubkey` join.

**Its proposed fix was a lowercase-hex validator on `subject` in `toPreimage`, mirroring the one
`issuer_pubkey` already has. I took it, and backed it out.** 32 tests went red, and the informative
one was the NFC test: the encoder deliberately treats `subject` as an arbitrary NFC string, because
for an ACCOUNT subject it is one — an opaque account id with no canonical case. A conditional "hex if
agent, any string if account" rule makes a byte-agreement component enforce a semantic convention, and
it would reject envelopes that component is contracted to encode. **The red was the shape of the fix
being wrong, not fixture debt to sweep** — which is the same lesson four review passes kept producing,
arriving this time as a test failure instead of a reviewer.

Fixed instead where the comparison lives and where the failure is mine: `lower(subject)` in the
predicate. Case-insensitive comparison is the correct equality for hex, not a fallback. **The residual
is written into the code rather than claimed closed:** the directory's join is still case-sensitive,
so an uppercase subject that ever got minted stays invisible there. Constraining the value at its
PRODUCER (the portal's mint) spans three components and is its own decision.

**Still owed from Entry 24, as ACs on whoever next touches this:** F5 (rename, so grepping for where
scoping is enforced stops giving M10's wrong answer) and F6 (no test imports `createOutboundSessions`,
so a wrong VALUE — `agentName` instead of the pubkey — still passes every unit test; only the spine
journeys catch it).

### Process note: TWO SESSIONS RAN M10B CONCURRENTLY, and it cost real work

Both sessions reviewed the same commit, both wrote an Entry 22, and one had to withdraw its own. My
spine-test fix was swept into the other session's commit because it ran `git add -A` over a working
tree it did not own. Nothing was lost this time — that is luck, not process.
`M10B-PROCEDURE` §5d is explicit: *"One thread. One coder (the main loop). NO parallel implementation
agents."* Two sessions on one repo violates it in the most expensive way available, because the
collisions are in the shared audit trail. **Surfaced to Andre rather than worked around.**

---

## Entry 26 — `DOD-END-SUBMIT-1` BUILT across all three layers — 2026-07-29

The queue table has existed since Entry 20 with **nothing writing to it**. This closes that: the
wire contract, the daemon that composes/signs/seals/sends, and the directory frame that accepts.

**Clause checklist (the yardstick the reviewer received):**

| # | clause | where |
| :-- | :-- | :-- |
| C1 | composes `(subject_kind, subject, body)` and SIGNS with the agent key | `composeSealedSubmission` |
| C2 | seals the WHOLE submission; no path emits unsealed | structural — there is no code path in `signal-submission.ts` that returns plaintext |
| C3 | writes over the existing channel; the daemon never talks to the portal | `submission_write` on the signaling stream |
| C4 | "standard failover across nodes" | `M10B-D32` below — a finding, not a simplification |
| C5 | no intake key ⇒ refuse, naming the reason | four refusal reasons, extended to malformed |
| C6 | `signal.submission.sealed` / `.queued` / `.refused` | all present; `.duplicate` added (see below) |
| C7 | INV-ATTRIBUTION | `submitter_pubkey` read from the KeyProvider; no parameter exists to override it |
| C8 | INV-ZEROBUMP | the discriminator is `op`, a protocol verb; nothing knows a signal type |

**Three things worth keeping.**

**1. INV-ATTRIBUTION is structural rather than enforced.** There is no `submitterPubkey` parameter —
the field is read from the signing `KeyProvider`, so a caller cannot name someone else because there
is nowhere to put the lie. Two tests prove it with real Ed25519 (the pubkey equals the signer's own
public half; the signature verifies over the canonical TBS), and a third gives the check teeth by
verifying the same bytes against a different key and requiring `false`.

Stated in the code where someone will be when they are tempted: **Ed25519 has no key recovery**
(RFC 8032), so "derive `issuer_pubkey` from the signature" cannot mean literal recovery. The pubkey
is present in the body and is *worthless until the signature verifies against it*. Reading it before
that is the forgery hole.

**2. `submission_id` is derived from the PLAINTEXT, never the ciphertext.** Sealing is randomised, so
a ciphertext-derived id would change on every re-seal and a failover retry would look like a second
submission — two mints, double quota consumption. The test pins exactly this: two composes of one
body produce **different ciphertext and the same id**.

**3. The error-substitution trap, caught before it shipped.** A directory node that has not deployed
this frame kind has its decoder return `null` and replies `not_authenticated` (`M10B-D25r` F2).
Passing that through would send an operator to debug KEYS for a day over a rollout artefact — and
because directory nodes are sovereign and deploy per region, an upgraded daemon meeting an older node
is the **normal** rollout case, not an edge. Mapped to `submission_unsupported_by_node`, and the test
asserts the guidance does *not* tell them to check their key.

**What the directory learns: nothing.** The frame carries exactly three fields, asserted by an
exact-key-set test — because if the FRAME carried a submitter or a subject, the table would want a
column for it and the privacy property would erode from the wire inward. `authedPubkeyHex` is used
for logging only, truncated, never persisted. The operator's body text is never logged anywhere; the
`signal.submission.sealed` event carries a byte count instead, because that log line would otherwise
be the one place an operator's words about a third party existed in the clear on disk.

**Gates:** cello-client 2081 tests, lint, typecheck, build. trustless-cello 922 tests, lint,
typecheck. **🟡 — the directory half rides the batched deploy** (hibernated), and protocol-types
joins the publish debt.

**Not yet wired to an operator surface** — `composeSealedSubmission`/`sendSealedSubmission` have no
caller until `DOD-END-SURFACE-1`. Staged deliberately, and stated rather than left for a reviewer to
notice.

### `M10B-D32` — "standard failover across nodes" is the SignalingManager's reconnect, not a client-side fan-out

`DOD-END-SUBMIT-1` says the daemon writes to a directory node *"with the standard failover across
nodes, since submission must not die on one node being down."* That reads like a client-side
multi-node write. **Verified before building, and it is not one.**

The daemon holds a **single** signaling stream. Registration — the closest precedent — sends
`register_request` to the connected node carrying `reachable_node_ids`, and the **directory** picks
the quorum and fans out (`registration-manager.ts:190–200`). There is no client-side multi-node write
path in the daemon at all.

So "standard failover" is the existing reconnect (`getFailoverEndpoint` / `failoverEndpointResolver`),
and building a bespoke fan-out here would duplicate the SignalingManager. **A retry after that
reconnect is safe for exactly the reason `M10B-D20` exists:** `submission_id` is content-derived, so
the same body handed to a second node is stored once and minted once.

**The accepted loss is `M10B-D21`'s, unchanged and already written down:** the queue is deliberately
unreplicated, so a submission written to a node that then dies permanently is lost — recoverable by
re-submitting, and the thing that must never be lost is the *notarized record*, which lives in
replicated `signal_records`.

**Stated honestly: nothing retries yet.** The retry is a property of the design, not a line of code,
until `DOD-END-SURFACE-1` gives this an operator-facing caller. Recorded so it is an AC there rather
than an assumption here.

---

## Entry 27 — `DOD-END-SUBMIT-1` reviewed: 8 findings, all fixed — 2026-07-29

One pass, per the cap. The crypto half came through clean — *"the TBS-as-array discipline, the closed
field set, the refusal ladder, and the real-crypto tests are right"* — and the weakness was uniformly
in **the send path's ack correlation and the directory half shipping untested**.

| # | finding | fix |
| :-- | :-- | :-- |
| F1 | guidance claimed a retry NO CODE performs | say what is true — not delivered, re-submitting is safe; retry is an AC on `DOD-END-SURFACE-1` |
| F2 | the skew mapping was over-certain | `not_authenticated` has THREE producers; NAME the ambiguity |
| F3 | ack correlation broken on 2 of 3 paths | every resolve path id-gated; `not_authenticated` is advisory only |
| F4 | directory half had ZERO tests | 7 tests, incl. the cross-repo contract |
| F5 | comment claimed flood protection that does not exist | say it is OWED; bound the row size |
| F6 | one log line joined submitter → submission_id | split the events; correct "never persisted" |
| F7 | `directory_unreachable` exit label | carry the transport's own cause |
| — | two HOLLOW tests | both rewritten (below) |

**F2 is the one worth remembering, because it is the same defect I had just fixed, one level up.** I
caught the error-substitution trap (a node replies `not_authenticated` for an unknown frame, which
reads as an auth failure) and then *substituted my own certainty for it*: the guidance asserted
version skew and stated "NOT an authentication problem". But `not_authenticated` has **three**
producers — an un-deployed node, a deployed node rejecting a malformed frame (i.e. our own bug), and
a frame that genuinely arrived before auth completed. In the third case my message sends the operator
away from the actual cause and toward a deploy that will never fix it. **Naming a cause is only an
improvement when the mapping is one-to-one; otherwise the honest move is to name the ambiguity and
order it by likelihood.**

### The second hollow test, which I wrote while fixing the first

The reviewer caught that the "unregisters its handler" test asserted only that
`registerInboundHandler` *returned* a function — true of any stub — and passed with
`finally { unregister() }` deleted. Fair, and fixed by counting handlers across all five terminal
paths.

It also observed that the INV-ATTRIBUTION tests **cannot see their own invariant**: the guarantee is
the ABSENCE of a parameter, so `submitter_pubkey: opts.submitterPubkey ?? signerPubkey` passes every
one of them. So I added a `@ts-expect-error` compile-time assertion in the test file — **and it would
have asserted nothing at all**, because `core/daemon/tsconfig.json` excludes `src/__tests__`. A
hollow test in compile-time clothing, written in the act of fixing a hollow test.

The guard now lives in `signal-submission.ts`, which `tsc` does read, and **I proved it bites** rather
than assuming: adding a `submitterPubkey` field to the options makes the build fail with the
invariant's name in the error text. The runtime tests now say plainly that they cannot observe the
invariant, instead of implying they do.

**Standing consequence, worth more than this unit:** a `@ts-expect-error` in ANY `src/__tests__` file
in `core/daemon` is decorative. Type-level guards belong in the source tree.

### Two ACs handed forward, both blocking on `DOD-END-SURFACE-1`

1. **Nothing retries.** `M10B-D32` establishes that failover is the SignalingManager's reconnect, and
   that a retry is *safe* because `submission_id` is content-derived — but no code performs one, and
   nothing calls this module yet. The safety property is real; the retry is not, until the surface
   lands.
2. **Nothing generates the manifest's `intake_key`.** Verified: no generator, fixture, or deployed
   manifest sets it, so against every real manifest today `composeSealedSubmission` returns
   `intake_key_absent`. Correct behavior, and it means this ships as a permanently-refusing feature
   until manifest generation gains an owner. Named here so it is not discovered live.

**Gates:** cello-client 2086 tests; trustless-cello 929 tests; lint + typecheck green in both.

---

## Entry 28 — `DOD-END-REVOKE-2` BUILT: V53 + the inner authorization — 2026-07-29

The M10 defect this milestone inherited (`DOD-REVOKE-1` review F6, deferred with *"revisit with
intake"*): revoke authorises on the generic `submitter` role and writes a tombstone that never reads
its target, so the moment a person can issue an endorsement, **one submitter key can tombstone
anyone's**. Without it, D-19 is nominal.

### The measurement came first, and it earned itself again

Four consecutive versions of this expression were wrong and **every one read correctly in prose**.
So, per the standing rule from Entries 11/15: ten shapes, eighteen rows, run on live Postgres inside
V46's **real** view shape — including its correlated-`EXISTS` supersession branch, which a fragment
fixture cannot exercise at all.

**Exactly one shape changes, and it is the defect:** `revoker ≠ issuer` goes `revoked → active`.
h1, h2, h3, h5, h6, h7, h8, h8s, h9, h9s, h10 are all identical to today.

Then each branch was proven **load-bearing by counterfactual**, and each failed exactly where
predicted:

| counterfactual | what breaks |
| :-- | :-- |
| supplement instead of replace | h4 stays `revoked` — **the fix is a NO-OP** (the third review's F3, confirmed) |
| drop the real-row-revoked branch | h7 regresses `revoked → active` |
| revoke branches after supersession | h8 downgrades `revoked → superseded` |
| branch 4 without `'directory'` | h10 becomes **permanently unrevocable** (fourth review MEDIUM-1) |

Finally the migration itself was applied to a **clean database built from main's migrations** and the
ten shapes re-run through the real view — same result. The shared `cello_dev` could not be used: it
carries the M12 branch's V49/V50 and a V51 checksum mismatch, which is precisely the collision
Entry 20 documented. A throwaway DB is the workaround; the collision is not fixed.

### The write half, and why the inner signature exists at all

`M10B-D12r4`'s predicate needs a revoker to compare, and the reason one cannot simply be taken from
the transport signer is the fourth review's best finding: **the portal is the only `submitter` key,
so Bob's withdrawal arrives signed by the PORTAL.** A predicate comparing transport signer to record
issuer would never match an agent-issued record, and every agent withdrawal would be silently inert.

So the revoke body carries an authorization signed by the **claimed issuer**, verified **standalone —
no record lookup**, which is what preserves the blind INSERT and its arrival-order freedom. The TBS
is `(domain ‖ signal_hash ‖ issued_at)`; `issued_at` is inside it because without a timestamp the
authorization is a **permanent bearer capability** to revoke that hash at every node forever.

**An authorization that does not verify is REFUSED, never recorded unverified.** Recording it would
be laundering by storage: the view compares pubkeys and cannot check Ed25519, so every peer node
receiving the row through replication would trust whatever the originating node wrote. Its reason,
`revoker_authorization_invalid`, is deliberately **distinct from `signature_invalid`** — they name
two different keys, and collapsing them sends an operator to rotate the portal's submitter key over a
bad agent signature.

### What is NOT closed, stated rather than implied

- **`revoker_signature` is AUDIT EVIDENCE, not a defense** (`M10B-D28`, third review F6). Nothing
  verifies it; the read path is a SQL view and a view cannot check Ed25519. A forged tombstone from a
  compromised node still reads `revoked` on all three. The column makes forgery detectable *in
  principle* and prevents nothing. **The compromised-node case remains OPEN** — closing it needs a
  verifier (a subscriber-side validation pass, or verify-on-read before serving a `revoked` verdict).
- **V46 is not amended, and must not be.** It is applied; Flyway checksums the whole file, comments
  included; editing it crash-loops the ops-agent in three regions (Entry 17). The superseding
  statement about V46's documented monotonicity — an unauthorised tombstone that lands first now
  reads `revoked`, then `active` once the real record replicates in — lives in V53's header.
- **`DOD-END-WITHDRAW-1` still needs its carrier wired** (`M10B-D28`'s `op: "withdraw"` through the
  submission queue). The authority model is now real; the operator-facing path to invoke it is not.

**Gate:** 929 tests, lint, typecheck green. 🟡 — rides the batched directory deploy with V51/V52.

---

## Entry 29 — `DOD-END-ACCEPT-1`: inputs VERIFIED before the design note — 2026-07-29

Not a design note. This is the step Entry 14 named as the milestone's recurring defect — *"I name a
mechanism and reason about its behavior without reading whether its inputs exist"* — done first, so
the note that follows is built on checked ground rather than on `M10B-D14r2`'s summary of it.

**All four inputs exist and are as described:**

1. **The migration pattern is real and is the right one.** `migrateContactsAddTierMetadata`
   (`contacts-tier-migration.ts:131`) is exactly what `M10B-D14r2` mandates: a `PRAGMA table_info`
   **birth gate**, columns added with **NO DEFAULT** (so the backfill has a real discriminator —
   with a DEFAULT the backfill matches nothing), and the ALTER + backfill in **one
   `BEGIN…COMMIT`**. Its header states the failure that shape prevents, and it is the same one
   consent faces: a crash between the ALTER committing and the backfill would let the next boot see
   the column, skip the one-time step forever, and silently mis-set every existing row.
2. **The one-time gate is tied to COLUMN BIRTH, not to NULL-ness** — a distinction consent needs
   exactly as much: a NULL appearing later must read as the *tighter* default, never be promoted.
3. **`CREATE_WALLET_SQL` is the fresh-database DDL** (`trust-signal-store.ts:151`) and must gain the
   column too, or fresh and migrated databases diverge. The repo already has the
   **"fresh == migrated"** convention to assert that (`dod-tier-1-migration.test.ts:21`).
4. **The hazard `M10B-D14r2` warns about is REAL and I read it.** `ensureTrustSignalSchema` ends in a
   bare `catch {}` — *"Column already exists — safe to ignore"* (`trust-signal-store.ts:186`) — and
   it runs on **every** `startDaemon`. So a consent migration written as a sibling `ALTER`/`UPDATE`
   inside that function would have its failures swallowed, and an unconditional backfill would
   **flip a refused endorsement back to `accepted` on the next restart**, silently, making it
   presentable. That is why the consent migration gets its own function on the contacts-tier
   pattern, with a **rethrow**, and does not join `ensureTrustSignalSchema`'s try/catch.

**One consequence worth stating now, before it gets designed around:** `listAllActive` — the live
presentation path, just scoped by `DOD-END-SCOPE-FIX-1` — is where the consent predicate belongs
(`AND consent_state = 'accepted'` in the SQL). `listPresentable` is still dead, and `M10B-D14r2`
already corrected D-14r's error of naming it. The two predicates now stack in the same WHERE clause,
which is the reason SCOPE-FIX-1 was sequenced first: consent bolted on top of an unscoped path would
have passed its own negative tests against a path that was never scoped.

**Next:** the design note proper, then red-first.

---

## Entry 30 — REVOKE-2 review: the fix contained its own bypass, and my measurement missed it — 2026-07-29

One pass. It found the unit's **headline defect still live**, inside the branch I had added to be
careful. This is the most important entry in the milestone so far, because of *how* it survived.

### F1 — the "legacy tombstone" branch defeated the entire unit

`BOOL_OR(is_tombstone AND revoker_pubkey IS NULL) → 'revoked'`, sitting above the exact-pubkey
branch. The reasoning read as conservative: a tombstone written before V53 had its authority checked
under the old rule, so keep its old semantics.

**A missing revoker is not a property of age.** Nothing distinguishes a pre-V53 tombstone from one
written a minute ago with the two optional fields left out. So any submitter could still kill any
agent-issued endorsement by *omitting* something — the exact attack the line exists to stop.

And it was live, not theoretical: the **only** revoke producer in the system,
`cello-portal/src/server/trust/directory-submit.ts`, sends no revoker at all. Every revoke reaching a
deployed directory took the NULL path, so the exact-pubkey branch was **unreachable in production**.

**The justification was also false**, and measuring is what showed it. Branch 4's institutional
escape already carries every legacy revocation. Removing the NULL branch changes **exactly one
shape**:

| shape | with the "legacy" branch | without it |
| :-- | :-- | :-- |
| portal record + NULL tombstone | revoked | **revoked** |
| directory record + NULL tombstone | revoked | **revoked** |
| **agent record + NULL tombstone** | **revoked** | **active** ← the fix |

Checked against the data too, not only the logic: `signal_records` holds 264 rows, **zero
agent-issued and zero tombstones** — there is no legacy agent tombstone to grandfather.

### Why my own measurement did not catch it, which is the lesson

Entry 28 says *"measured, not argued"* and it was — ten shapes, live Postgres, counterfactuals per
branch. It still shipped the bypass, because **I chose the shapes**. My h5 fixture was an *agent*
record with a NULL-revoker tombstone, and I asserted `revoked` and called it correct. The
measurement faithfully confirmed what I already believed.

**A measurement only tests the hypotheses you thought to write down.** Counterfactuals ask "does this
branch do something?" — the question that catches this is "what does this branch do that the OTHERS
DO NOT?", which is what the reviewer ran. A branch whose behavior is fully covered by another branch
is not conservative; it is either dead or a hole, and here it was a hole. That belongs beside the
Entry 15 rule rather than replacing it: measure inside the real view, **and** measure each branch's
*marginal* contribution.

The test was the worst part: it **pinned the bypass as correct behavior**, so a future reviewer
reading the suite would have found the hole documented as intended. Two further hollow tests from the
same review: the "no inner authorization" case used a *portal* envelope and never checked
`effective_status` (an implementation letting any submitter kill any endorsement passed it verbatim),
and the audit-evidence test asserted `is_nullable = 'YES'` — true of any column nothing ever writes.

### Also fixed

- **A false comment (F2).** The inner-auth TBS was described as a "byte-identical local copy per the
  M7-WIRE-001 convention, with a drift guard". That convention covers a copy of a builder that
  already exists upstream; this has **no counterpart**, so no drift guard is possible and the
  sentence asserted a safety net that does not exist. Corrected, and shipping the builder in
  `@cello-protocol/protocol-types` is now an AC on `DOD-END-WITHDRAW-1`.

### Carried forward as ACs — named, not silently deferred

- **F2 (design gap):** `issued_at` is inside the inner TBS *and* is what the directory skew-checks at
  600s. A withdrawal travels daemon → queue → portal drain → portal revoke, so Bob must sign over an
  `issued_at` the *portal* will submit with, which he cannot know — and a drain lagging >10min kills
  the withdrawal as `stale_request`. Needs a validity window rather than an instant. → `DOD-END-INGRESS-1` / `DOD-END-SURFACE-1`.
- **F3:** `MIN(issuer_kind)` is now an *authority* predicate, not a descriptive aggregate. One node
  disagreeing about `issuer_kind` silently makes a portal record permanently unrevocable everywhere.
  `MIN()` picking the stricter side is right for forgery; the defect is that disagreement is resolved
  silently rather than surfaced.
- **F4 (pre-existing, V46):** `s.status <> 'revoked'` in the supersession EXISTS is **inert** — since
  revocation became a tombstone, the real row stays `active`. So withdrawing a *successor* leaves its
  predecessor `superseded` forever: re-endorse then withdraw, and **both** endorsements are
  unpresentable with nothing saying so.
- **F5:** `revoker_pubkey` is validated lowercase-64-hex; the envelope's `issuer_pubkey` is not
  validated to the same shape at every entry point. Branch 5 is an exact string comparison across the
  two.
- **F8 (unmeasured):** two new columns on a table in `PUBLICATION_TABLES`, with three regions
  deploying in parallel. A V53 node writing while a peer is on V52 should stall that peer's whole
  subscription until it migrates. Neither local Postgres runs `wal_level=logical`, so this needs one
  measured check **before the batched deploy**.
- **An inert revoke returns `{ok: true, revoked_rows: 1}`.** Deliberate for arrival-order freedom,
  but the caller is told "revoked" when the truth is "recorded, currently inert" — the portal would
  show a user their endorsement is withdrawn when it is not.

---

## Entry 31 — review F4 fixed: a withdrawal no longer destroys the endorsement it replaced — 2026-07-29

Taken immediately rather than carried, because it is a real defect in the milestone's own headline
mechanism and V53 is the migration that rewrites this CASE — the cheap moment is now.

**Reproduced first, on live Postgres, before touching anything:** Bob endorses (v1), re-endorses (v2
supersedes v1), then withdraws v2 → **v2 `revoked`, v1 `superseded`. Both unpresentable.** Alice has
nothing and no path says so. V46's guard `s.status <> 'revoked'` — commented *"a REVOKED replacement
supersedes nothing"* — has been **inert since revocation became a tombstone**, because the real row's
status stays `'active'`. It is a comment describing a constraint the code stopped enforcing.

**The naive repair is an attack.** "Ignore a successor that has any tombstone" lets Mallory tombstone
v2 and *resurrect* v1 — an unauthorised write changing what a third party can present. So the
successor has to be judged by the **same** authority rules as the record itself, which is a
self-reference the CASE cannot express.

**Resolution (`M10B-D33`):** compute revoked-ness ONCE in a CTE, then let the supersession branch
consult it. No recursion, one definition of authority, and the successor is judged exactly as the
record is.

**Measured, all four shapes:**

| shape | before | after |
| :-- | :-- | :-- |
| successor withdrawn by its own issuer | predecessor `superseded` | **predecessor `active`** ← the fix |
| successor tombstoned by MALLORY | `superseded` | **`superseded`** (no resurrection) |
| ordinary supersession | `superseded` | `superseded` |
| revoked AND superseded | `revoked` | `revoked` (ordering preserved) |

All three shapes are now permanent regression tests. 45 integration tests green against a rebuilt
V53; 932 in the default gate; lint and typecheck clean.

**F5 also fixed (same session).** `toPreimage` pins `issuer_pubkey` to lowercase-hex-even-length —
enough for hash agreement, but it does not pin LENGTH, while `revoker_pubkey` is validated as 64 hex.
Branch 4 compares them exactly, so a short-but-well-formed agent key notarized cleanly and was then
**permanently unrevocable**, with the issuer's own withdrawal silently inert *and returning success*.
Now refused at submit as `envelope_invalid`, naming the consequence rather than the rule. Not
normalized on read — the value is inside the hash.

**Still open from the same review, and each needs a decision rather than a keystroke:**

- **F2 — withdrawal's `issued_at` cannot survive the queue hop.** It is inside the inner TBS *and* is
  what the directory skew-checks at 600s, but the withdrawal travels daemon → queue → portal drain →
  portal revoke. Bob must sign over an `issued_at` the *portal* will submit with, which he cannot
  know; and a drain lagging >10 min kills the withdrawal as `stale_request`. Needs a validity
  *window*, not an instant. → `DOD-END-INGRESS-1` / `DOD-END-SURFACE-1`.
- **F3 — `MIN(issuer_kind)` is now an authority predicate, not a descriptive aggregate.** One node
  disagreeing silently makes a portal record permanently unrevocable everywhere. `MIN()` picking the
  stricter side is right for the forgery direction; the defect is that disagreement is *resolved
  silently* instead of surfaced.
- **F8 — replication column-skew, UNMEASURED.** Two new columns on a published table, three regions
  deploying in parallel. A V53 node writing while a peer is on V52 should stall that peer's entire
  subscription until it migrates. Neither local Postgres runs `wal_level=logical`. **One measured
  check is owed BEFORE the batched deploy** — this is the item most likely to bite at wake.
- **An inert revoke returns `{ok: true, revoked_rows: 1}`.** Deliberate (arrival-order freedom), but
  the caller is told "revoked" when the truth is "recorded, currently inert" — the portal would show
  an operator their endorsement is withdrawn when it is not.

---

## Entry 32 — `DOD-END-ACCEPT-1` reviewed: consent stopped DISPLAY but not ERASURE — 2026-07-29

One pass, nine findings, all fixed. The migration design held under attack — the reviewer could not
construct a sequence that resurrects a refusal — but the unit failed the DoD's own words,
*"cannot be presented by any path"*, in two directions I had not thought to look.

### The two that mattered were found by RUNNING the store, not reading it

**F1 — a rogue PENDING endorsement superseded the subject's ACCEPTED one.** The consent gate works:
the rogue lands `pending` and is unpresentable. But its *insert* ran the type-dedup supersession, so
Alice's own accepted endorsement was marked `superseded` and she presented **nothing**. The stranger
still decided what her counterparties saw — he just erased instead of speaking. **Consent that blocks
display but permits deletion closes half the threat**, and the half it leaves open is the one that
looks like nothing happened.

**F2 — any issuer could supersede any row by naming its hash** (pre-existing since M10).
`supersedes_hash` was honoured with no authority check, so a third party who could get one signal
delivered could kill phone, email, anything. This is the daemon-side twin of what V54 fixes in the
directory: *an unauthorised write must not change what a third party can present.*

Both now require the SAME ISSUER — for an agent the key IS the identity — and supersession is
deferred while unconsented, then re-applied through the identical path on acceptance so the effect is
not silently dropped.

**F3 — the consent predicate landed on one of three read paths.** `listPresentableTypes` is the LIVE
validator for `--include`, so `--include endorsement` on a wallet holding only a pending endorsement
validated fine and then presented nothing. That is precisely the lie `DOD-END-SCOPE-FIX-1` removed
along the scoping dimension, reintroduced along the consent one — two units in a row, same shape.

### And a hollow test I wrote WHILE fixing the hollow tests

My first F1/F2 regressions drove `putWalletSignal` — which does not supersede at all — so
"the rogue did not supersede" held trivially. They passed. **The CONTROL test caught it by failing:**
"the same issuer's re-issue still supersedes" went red, because nothing was superseding anything.

That is twice today a control caught a hollow negative (the other was `DOD-END-REVOKE-2`'s legacy-
tombstone case). The pattern is worth stating as a rule: **a negative assertion is only as good as the
positive one beside it.** "X does not happen" is satisfied by an implementation where nothing happens,
and the paired positive is what distinguishes the two. Write them together or the negative is
decoration.

### The rest

F4 the operator surface reported success it could not deliver (`wallet_enable_signal` returned
`ok:true` on a pending row); F5 the backfill had no `WHERE` and was true only by RELEASE TIMING, not
by code; F6 a bare `ROLLBACK` that destroys the real error on `SQLITE_FULL` **and** suppresses the
event added for exactly that failure — the pattern this file claims to follow guards it, and I copied
the shape minus its two most important lines; F7 `BEGIN IMMEDIATE` + re-read under the lock; F8 the
declared type said non-null over a nullable column; F9 a stray semicolon.

**Published state, stated because it matters operationally:** `daemon@0.0.79` reached `latest` and is
installed, and it is the build WITHOUT these fixes. Neither F1 nor F2 is reachable there — both need
an agent-issued endorsement delivered into a wallet, and nothing can issue one until
`DOD-END-SUBMIT-1` has an operator surface — so this is a prompt follow-up, not an incident.
`daemon@0.0.80` + `cli@0.0.81` carry the fixes.

**Gate:** 2105 tests, lint, typecheck, build green.

---

## Entry 33 — `DOD-END-SURFACE-1` begins: the consent verbs, and three guards that caught dead code — 2026-07-29

**What went in.** The operator half of consent: the `cello_use_agent` nudge, `cello_consent_list` /
`_accept` / `_refuse` at MCP+CLI parity, and the M10B-D4 refusal message. Commits `3744b19`,
`bd58925`, `7fe7faf` in cello-client (pushed; they sit on top of the M12 agent's `fb9c23f` cascade,
so they are NOT in the promoted `latest` — they ride the next one).

**The nudge, and why it does not mark anything notified.** `cello_use_agent` reads
`countUnnotifiedConsent` and returns `pending_consent` + guidance. It is a COUNT and nothing else.
Marking notified on selection would record the operator as told about something they were never
shown; the nudge is a number, the LIST is what shows the items, and `cello_consent_list` is what
records that they saw them. That keeps `M10B-D5`'s two lifetimes apart — the notification goes
quiet once seen, the DECISION persists until made. A failed read returns
`pending_consent: "unknown"` rather than silence (§5a): silence is exactly how an endorsement dies
unnoticed, so an unknown is surfaced as an unknown.

**The refusal message is a third OP, not a new structure.** `SubmissionOp` gains `refuse` next to
`submit`/`withdraw`. `op` is a protocol verb — what the caller is ASKING FOR — which is the axis
INV-ZEROBUMP permits, unlike branching on what a signal MEANS. The widening adds no field and
reorders nothing, so **every signature already made over a `submit` or `withdraw` body still
verifies**; a test pins the arity equality so a later change that breaks it cannot pass quietly
(§5b: is any signature or hash over these bytes? Yes — hence the check). Subject is the target
signal hash, exactly as for a withdrawal: both verbs act on an existing signal instead of asserting
a fact about a party.

**Order is the invariant.** The refusal is recorded BEFORE anything that can fail, and every failure
path returns the refusal with `issuer_notified: false`. A refusal contingent on the network would
leave a signal Alice believes she rejected sitting in an unrefused state, and she would retry
against a signal already refused. The test asserts the source POSITIONS of `setConsentState` versus
compose/send rather than prose about ordering.

**This is `composeSealedSubmission`'s first real caller**, which closes one of the two ACs
`DOD-END-SUBMIT-1` handed forward ("nothing retries yet — the safety property is real but has no
caller"). It needs the manifest's intake key at request time, so `verifyStartupManifest` now returns
the verified manifest object — set ONLY on the path where signatures, validity window, and
anti-rollback all passed. A sealing key read off an unverified manifest is a key an attacker chose:
it would seal the operator's words to the attacker instead of the portal.

### Three guards caught real defects, in the order they fired

This is the part worth keeping, because each guard caught something a human reading the diff would
have called fine.

1. **The daemon vocabulary SOURCE AUDIT** failed the first commit: my nudge guidance named
   `cello_consent_list_pending`, a tool that did not exist — the guidance was written before the
   tool was built. Exactly the audit-what-ships case: a string the daemon shows an operator is a
   promise about the surface.
2. **The name-parity rule** (MCP name ≡ `cello_` + CLI verb) then rejected
   `cello_consent_list_pending` against `cello consent list`. Renamed the TOOL rather than bending
   the CLI verb to match a suffix carrying no meaning — there is nothing else to list.
3. **`KNOWN_COMMANDS`** rejected an unlisted `consent` command. That guard exists so that adding a
   CLI verb is deliberate; adding it to the list is the deliberation.

### The defect none of them could catch, and the gap it exposes

The verbs shipped **dead on both surfaces**. The daemon reads `params?.hash_prefix`; the MCP tool
and the CLI both sent `signal_hash`. Every accept and every refuse would have returned
`invalid_prefix`.

All three guards above were green across it, and that is the point: **parity of NAMES is not parity
of CALLS.** They check that a tool exists, that its name matches its CLI verb, and that a name shown
to an operator resolves to something real. None of them looks at arguments. A verb can be perfectly
named, correctly listed, fully documented, and completely non-functional.

The fix went to `hash_prefix` rather than moving the handler to `signal_hash`: the handler
deliberately takes a prefix of ≥8 hex chars, matching `cello trust-signals view <hash>`, and an
operator reading a hash off `cello consent list` should not have to paste 64 characters to act on it.

The new test (`m10b-surface-1-consent-params.test.ts`) is a source audit: it extracts every
`params?.<name>` a handler reads and asserts each surface sends only names in that set. Revert-tested
both times it changed. It also needed fixing twice while being written, which is itself a finding
worth recording — the first extractor assumed an inline object literal and broke the moment both
call sites built params conditionally, and the second mistook a function's own opening brace for an
object literal, making a type annotation (`params:`) look like a parameter being sent. **A source
audit is code, and it fails in the ways code fails.** Both times it was generalised rather than
loosened, and the revert test was re-run after each change to prove it still bites.

### State

- Gate: 2143 tests, lint, typecheck, build — all green in cello-client.
- `cello-unit-reviewer` dispatched on `fb9c23f..HEAD` with the four claimed clauses; findings and
  fixes land in the next entry.
- **Clauses still owed on this line:** issue an endorsement for a counterparty; read a refusal
  message as the ISSUER (the daemon-side drain of the `refuse` op); list held signals + status;
  withdraw; per-counterparty include/omit at presentation; quota visibility (`DOD-END-QUOTA-1`).

---

## Entry 34 — SURFACE-1 reviewed: the surface said "read this" and returned a byte count — 2026-07-29

`cello-unit-reviewer` on `fb9c23f..HEAD`, no model override. 14 findings, all addressed
(cello-client `a5a2183`). Two are worth the milestone's memory; one I corrected rather than applied.

### F2 — the clause's whole purpose was unmet while three tests were green

`cello_consent_list` returned `payload_bytes: 412`. Both surfaces — the MCP `accept` description and
the CLI `consent` help, **both added by the same diff** — instructed the operator to *read the
plaintext before accepting*. So an operator who followed the instruction received a number and
accepted blind, on a claim someone else had written about them. That is the entire point of
`DOD-END-ACCEPT-1` ("someone could create a rogue endorsement that says you're a piece of shit"),
and it was missing while the tests, the name-parity audits and the vocabulary audit were all green.

The plaintext was reachable the whole time — `wallet_view_signal` decodes it four hundred lines
away. Nothing pointed at it. **A surface that instructs and a handler that does not comply is a
worse failure than a surface that says nothing**, because the operator acts on the instruction.

### F5 — a check that was true at startup and quietly stopped being true

`verifyStartupManifest` verifies signatures, validity window and anti-rollback ONCE, at daemon start.
The daemon then holds that object for its whole lifetime; nothing refreshes it. `composeSealedSubmission`
checked that `intake_key` was **present and well-formed** — never that the manifest was still inside
its window.

Three weeks on, the portal rotates the intake key and publishes v+1; this daemon seals to the retired
key, a directory node accepts it, and the operator is told the message was sent. The portal cannot
open it and — since identity is derived from the signature inside the seal — cannot even attribute
it. The message vanishes with no error anywhere.

The generalisable form: **§5a's "absent is not fine" has a time dimension.** A verification result is
not a fact, it is a fact *with an expiry*, and the check belongs where the key is USED, not only
where it was fetched. Now refuses `manifest_expired`, naming the manifest and the instant.

### The one I corrected — F13

The review called `consent_notified_at` (milliseconds) an outlier "among epoch-seconds siblings" and
proposed converting it. Backwards: the store's own convention block says hashed ENVELOPE fields are
seconds and LOCAL BOOKKEEPING is milliseconds (`received_at`, `verified_at`). Converting would have
*introduced* the inconsistency. Documented in that block instead. Worth recording that a reviewer's
premise is checkable and sometimes wrong — the fix here was to read the convention the file already
stated, not to act on the finding as written.

### The hollow tests, which is the finding I would keep if I could keep only one

**The nudge had ZERO coverage.** Deleting the entire block from `cello_use_agent` left the whole repo
green, because the tests I wrote exercised the three STORE methods it calls. They were real tests of
real code — just not of the code the clause added. An implementation that computed the count and
never attached it to the response passed everything.

And the refusal-message test pinned SOURCE TEXT only. Four wrong implementations passed it, including
one that seals with a **different agent's key provider** — which is INV-ATTRIBUTION itself, the thing
the compile-time guard was written to protect. The guard proves no *override parameter* exists; it
cannot prove the right provider was passed.

Both are the same mistake in different clothes: **testing what the code is made of instead of what it
does.** Fixed with a live-daemon test over a real socket, a direct pin on the guidance-key class, and
behavioural tests that compose → seal → open → decode so attribution is asserted on BYTES. Residual
gap stated rather than papered over: no end-to-end test drives the refuse HANDLER with a live
signaling stream; the handler-to-transport hop is still source-audit only.

### Also: F1, and why the fix was a rule rather than a patch

The nudge told CLI operators to run `cello_consent_list` — untypeable. `renderForSurface` rewrites
only keys in a literal set of three, and `pending_consent_guidance` was not one. The class of bug is
"a handler invents a new `*_guidance` key without knowing a registry exists", so the fix closes the
class: any key ending in `guidance` is an instruction. Patching the single key would have left the
next handler to rediscover it.

### Published

Two cascades, because the first shipped before the review ran: `v0.0.135`
(daemon 0.0.82 / cli 0.0.83 / connect 0.0.92, verified against the tarballs — real cross-pins, no
`workspace:*`) and `v0.0.136` (daemon 0.0.83 / cli 0.0.84 / connect 0.0.93) carrying the fixes.
Republishing was not optional: npm version ≡ published content, and leaving 0.0.82 in place with
different source would hand anyone who installed it the blind-consent build permanently.

**`latest` promotion is Andre's and is NOT run here** — prepared in the handoff below.

---

## Entry 35 — the issue verb, and why it is not called `cello_endorse` — 2026-07-29

`cello_trust_signals_issue` / `cello trust-signals issue <pubkey> <text…>` (cello-client `3e71255`).
Severity-1 in this milestone's own triage — *"Bob's agent supplies an endorsement for Alice"* — and
until now the submission machinery built by `DOD-END-SUBMIT-1` had no way for an operator to invoke
it. A mechanism reachable only by daemon IPC is the `DOD-SETTINGS-SURFACE-1` mistake repeated.

**The naming was the design decision.** `cello_endorse` is the obvious name and it would have baked
the type into the operator surface permanently — a per-type construct in cello-client, which is
exactly what the zero-bump lens is instructed to flag. The verb is type-free instead, and it is
type-free *by construction* rather than by discipline: **the submission wire carries no type field
at all.** `SubmissionBody` is `{v, op, subject_kind, subject, submitter_pubkey, body, issued_at}` —
the PORTAL decides what it mints. So a second client-sourced type needs no new verb, no new
parameter, and no client change, which is precisely what `DOD-END-PLAYBOOK-1` has to demonstrate
with an empty client diff. The proof got easier because the surface refused to learn the type.

**The refactor came first, deliberately.** `refuse` and `issue` are the same journey with a different
`op`. Rather than write the second copy, the compose→seal→send path was extracted to
`submitForAgent`, which owns every guard: the online check (so sending never brings a stopped agent
online as a side effect), the body cap (so an oversized paste never dies in the transport wearing a
transport's error label), the key-provider lookup, and the forwarding of compose/send causes. **A
second hand-written copy is how two paths that must agree stop agreeing** — the next verb would have
inherited whichever subset its author remembered. INV-ATTRIBUTION holds inside the helper by
construction: the provider is looked up from the selected agent and there is no parameter through
which a caller could name another identity.

Behaviour preservation is the spec for a refactor, so the refusal source-audits were **re-pointed at
the shared path rather than deleted** (§5b — triage by subject-under-test, never by file), plus four
assertions covering the guards once in the place they now live.

**Refused at the source, with actionable reasons:** a subject that is not 64 hex chars, an empty
body, and SELF-issuance. The portal is the real enforcer of `INV-NO-SELF-STANDING` (only it sees
account linkage), but an agent endorsing *itself* is detectable here with certainty, and refusing
early beats a silent rejection at intake minutes later.

The success response says **`queued`, never "issued"** — the portal must still drain, authenticate,
scan and mint, and the subject must then ACCEPT before anyone else sees it. Three steps that have
not happened.

**The exhaustive SKILL.md audit paid for itself immediately**, failing the build on this verb being
undocumented. It had been a fixed sample of six tool names until Entry 34 rewrote it to run off
`DUAL_SURFACE_VERBS`; the first thing it caught was a gap predating this milestone
(`cello_dismiss`), and the second was this one.

### PREPARED FOR ANDRE — the `latest` promotion (NOT run here)

Two cascades published to **beta** and verified against the tarballs (real cross-pins, no
`workspace:*`, the changed symbols present in `dist/`): `v0.0.135` then `v0.0.136`.

`latest` still points at the M12 agent's earlier set, so none of M10B's consent or issue surface is
on the default install path yet. The promotion is operator-run, always:

```bash
npm dist-tag add @cello-protocol/connect@0.0.93 latest
npm dist-tag add @cello-protocol/cli@0.0.84 latest
npm dist-tag add @cello-protocol/daemon@0.0.83 latest
npm dist-tag add @cello-protocol/gateway@0.0.9 latest
npm dist-tag add @cello-protocol/crypto@0.0.27 latest
npm dist-tag add @cello-protocol/transport@0.0.31 latest
npm dist-tag add @cello-protocol/protocol-types@0.0.29 latest
```

**Do not run this yet if the issue-verb review is still open** — `3e71255` landed AFTER `v0.0.136`,
so the issue verb is not in any published artifact. A third cascade is owed once that review's
findings are fixed, and promoting before it would put the reviewed-consent surface on `latest` while
the issue verb exists only in git.

---

## Entry 36 — issue-verb review: two claims the code made about itself were false — 2026-07-29

`cello-unit-reviewer` on `3e71255`. 8 findings, all fixed (cello-client `3d6a223`). The pattern in the
two blocking ones is worth naming, because it is not "the code is wrong" — it is **the code asserting
a property it does not have.**

### F2 — INV-ATTRIBUTION held by CONVENTION while the comment claimed CONSTRUCTION

`submitForAgent` carried: *"the key provider is looked up from the SELECTED agent's name and there is
no parameter to pass a different identity."* There was one — `sel: { name, pubkey }`, caller-supplied,
declared on the line immediately below. Both call sites passed the correctly-resolved selection, so
there was no live bug. The invariant was true; the reason given for it was not.

And the test that "pinned" it asserted `expect(helper).not.toMatch(/opts\.(keyProvider|submitterPubkey)/)`
— **the absence of two identifiers that had never existed in that function.** It could not fail. It
would have passed against an implementation that took a caller-supplied identity, which is the exact
thing it was written to forbid.

The fix makes the claim true rather than softening it: the helper takes `connectionId` and calls
`resolveSelectedAgent` itself, so there is no identity input left to get wrong.

**Why this is worse than an ordinary bug.** The next verb — withdraw — is written by someone who
reads that comment. "There is no parameter to pass a different identity" tells them the shape is safe
to copy, so they pass an agent name out of `params` without re-resolving, and nothing in the file, the
tests, or the type system stops them. **A false security comment is load-bearing in the wrong
direction.**

### F1 — the shared path was extracted, and one behaviour did not come with it

`stored: false` means a directory node reports it already held this submission id: either a benign
retry or single-node censorship, indistinguishable from the client. The refuse path branched on it
and warned. The issue path — *eleven lines later in the same function* — emitted `stored` as a bare
field, and the CLI prints only `guidance`, so an operator would never see it at all.

The commit that introduced this contains a comment saying that collapsing the two "destroys the only
information that could ever tell them apart", immediately above a path that collapses them.

The fix puts the warning **inside** `submitForAgent` rather than at the second call site. The
generalisable form: **when you extract a shared path, the guards that move are obvious and the
REPORTING that did not move is not.** A guard omitted at one call site is a bug; a guard omitted in
the shared path is a bug available to every future caller.

### F5 — a certainty claim that was one agent deep

The self-issuance guard compared the subject against `sel.pubkey` — the *selected* agent — under a
comment describing it as "detectable right here with certainty". The daemon holds `loadedAgents`:
every agent on the machine. An operator running two of their own agents could issue from one about
the other and pass straight through. **Solo multi-agent is CELLO's first wedge**, so that is the most
likely way to reach this check, not the least. Now checks every loaded agent and names which one.

### F7 — three behaviour moves the refactor did not surface, recorded here because that is the rule

Behaviour preservation is a refactor's spec, so a move that is *arguably better* still has to be
stated rather than normalised away:

1. The 4000-char cap now runs **after** the account-subject gate, previously before — so an oversized
   message on an account-subject item returns `account_subject_message_unsupported` rather than
   `message_too_long`. More correct; still a change.
2. Send-failure guidance lost its trailing *"Retrying is safe — the submission id is derived from the
   content."* Three of four send branches already carry retry advice inside their own guidance, so
   the loss lands only on `submission_refused_by_node`, where retrying is the wrong advice anyway.
   Net improvement, unstated until now.
3. Offline guidance went from *"refuse again with the same message"* to *"try again"* — necessarily
   generic once shared.

### What the guards caught, and what they could not

The reviewer verified the full guard inventory survived the extraction intact, line by line against
the pre-image, and confirmed the parameter names matched character-for-character (the `bd58925`
dead-verb class). What **nothing** caught: the deliverable had no behavioural test at all — renaming
`subject_pubkey` in the handler would have left the whole suite green.

So the milestone now has a structural guard it lacked: **every tool in `DUAL_SURFACE_VERBS` must
resolve to a real daemon handler.** Name-parity checked the CLI and the MCP shim against the
vocabulary; nothing checked the vocabulary against the DAEMON. Revert-tested by mistyping the proxied
method name.

### Also landed — per-counterparty include/omit (a `DOD-END-SURFACE-1` clause)

`contact_signal_prefs`, keyed on `agent_id` — never `agent_name`, which is a mutable display label
reusable after retirement and would silently hand a NEW agent the retired one's disclosure choices.
Applied LAST at presentation and only ever to **narrow**: consent is enforced upstream in SQL, so an
explicit `present: true` cannot resurrect something consent excluded. `null` CLEARS a choice, which
is a distinct state from `false` — without the distinction an operator could never undo an omission
without knowing what the default had been.

### Note on the shared checkout

A second session is working in the same `cello-client` tree (it landed `DOD-M9C-STORE-1`, the gateway
SQLCipher work, as `449bbba`). Staging is now file-by-file rather than `git add -A`; the six earlier
M10B commits were checked and contain none of its files.

---

### 2026-07-29 — Entry 37: DESIGN NOTE — `DOD-END-SCAN-1` (written before any code)

**Target behavior (one sentence).** A submission's plaintext body is judged by a deterministic,
versioned rule corpus BEFORE it is hashed, and on any hit the submission is REJECTED with the reason
named — never cleaned, never partially accepted — while the exact rule set that judged it is recorded
in a `scanner_version` derived from the corpus itself.

**Spec anchors.** Spec §7 constraints 2 (versioned shared component, byte-identical across nodes) and
3 (reject always, fail-closed). Policy D-16 (concealment with no innocent use refuses on sight;
legitimate encodings are decoded and judged). `M10B-D15` (derived `scanner_version`), `M10B-D16`
(shared corpus, portal-owned verdict), `M10B-D17` (the `./detect` subpath). SHA-256 → FIPS 180-4.

**Producer/consumer chain.**
- *Rule corpus* — produced by `@cello-protocol/gateway/detect` (`compileInjectionPatterns`,
  `compileSecretRules`, RE2-backed, no I/O, no model). Consumed by the portal's intake. If the corpus
  changes, `scanner_version` changes with it — that is the whole point of deriving it.
- *`scanner_version`* — produced HERE by hashing the canonical serialization of the active rule set.
  Consumed by `mint.ts` and stored by the directory as a SIGNED field. If it were hand-maintained and
  went stale, the directory would notarize evidence of a scan that did not happen — the directory
  cannot re-run the scan, which is precisely why `DOD-DIR-WRITE-1` made the field signed.
- *Verdict* — produced here, consumed by the ingress drain loop, which acks the row and (for an
  attributable submission) reports the cause back to the submitter.

**The seam.** `src/server/trust/submission-scan.ts` in cello-portal, between
`authenticateSubmission` (Entry 36's step 2) and `mint.ts`. It imports from
`@cello-protocol/gateway/detect` and NEVER the package barrel — the barrel pulls
`GatewayConfigStore`/`GatewayRecordStore`, the HTTP server and the sidecar spawner into a Next.js
Fargate app. It must not know what a signal TYPE is: it judges bytes, and the same call judges the
body of an endorsement, a withdrawal and a refusal message identically.

**Invariants at stake.**
- `INV-UNTRUSTED` — the scanner never rewrites the body. A "cleaned" body would be the portal
  restating the submitter's words in its own voice, which is exactly how framing dies quietly. Reject
  or pass, nothing in between.
- `INV-ZEROBUMP` — no branch on signal type. The corpus judges text.
- `INV-ATTRIBUTION` — untouched; the scanner runs AFTER authentication and never re-derives identity.
- Fail-closed (§5a) — an unrecognised verdict, an uncompiled corpus, or a thrown detector must
  REJECT. A scanner that can be silently off cannot back a signed `scanner_version`; that is the same
  reasoning that excluded the Layer-2 ONNX classifier (`M10B-D16`), and it applies to our own failure
  modes too.

**Approach + rejected alternative.** Compile the corpus once at module load, derive `scanner_version`
from its canonical serialization, and expose one `scanSubmissionBody(body)` returning
`{ ok: true, scannerVersion }` or `{ ok: false, reason, scannerVersion }`. **Rejected: reusing the
gateway's `InboundScreener` disposition.** Its stated posture is the OPPOSITE of intake's — "not, by
itself, an auto-block; CELLO is not a moderation tool; this surfaces evidence, it does not police
content" — so reusing it produces a scanner that passes its own tests and never refuses anything.
The corpus is shared; the policy is the portal's. **Also rejected: scanning after hashing**, which
would notarize the hash of content that is then rejected, leaving a permanent record of a signal
that was never minted.

**Falsification pass.** Checked before writing code: `@cello-protocol/gateway` is NOT currently a
portal dependency — it must be added, and `./detect` is a real exports entry (verified in the
package's `exports` map, not assumed). `compileInjectionPatterns` is async-ready
(`injectionPatternsReady`), so the module cannot judge before the corpus is compiled and must refuse
rather than pass while it is warming. Redaction (`redactSecrets`) exists and must NOT be used for its
rewriting behaviour — only its FINDINGS matter here, because rewriting is the thing INV-UNTRUSTED
forbids.

**Decisions this note makes.**
1. Charset class, length cap and URL policy are part of the hashed corpus serialization, so changing
   any of them changes `scanner_version` — they are rules, not configuration.
2. The length cap at intake is independent of the client's 4000-char submit cap: the client cap is a
   courtesy to the operator, this one is a protocol constraint, and the portal must not trust a
   client-side bound it did not enforce.

**Test plan sketch.** Red-first: an injection payload is rejected with `scanner_injection_pattern`;
a live-looking credential is rejected with `scanner_secret`; control characters and markup are
rejected; an over-long body is rejected; a normal sentence PASSES (the positive control without which
"reject everything" would pass every negative test); the same body scanned twice yields the same
`scanner_version`; a body is never mutated. Enforcer: the ingress path, and ultimately
`DOD-END-JOURNEY-1` case (a) where a refusal message is scanned on the same path.

---

## Entry 38 — `DOD-END-INGRESS-1` and `DOD-END-SCAN-1`, and a subpath that was inert — 2026-07-29

Three repos moved. Directory: the drain surface. Portal: the drain client, the authentication step,
the scanner. cello-client: the corpus made enumerable, then made *usable*.

### The directory: two routes, because the split IS the exactly-once property

`DOD-END-QUEUE-1` built the mailbox and its repository; **nothing exposed it**, so every submission
the client surface reported as "queued" sat in a table nobody read.

`POST /internal/submissions/drain` READS; it does not delete. `POST /internal/submissions/ack`
removes, after the portal reaches a TERMINAL outcome (minted, rejected, poison — all three delete,
differing only in what goes back to the submitter). Delete-on-read is the obvious single-route design
and it turns **every crash into a silent loss** of a submission whose operator was told it was
queued — and since the ciphertext is opaque to the directory, nothing downstream could ever notice.
Revert-tested: putting the delete back into drain fails the crash-recovery assertion.

Auth is required even though the payload is opaque. The SET of queued ids, their arrival order and
their intake key ids is traffic analysis — how much, how often, against which key generation.
*"It is encrypted"* is not a reason to serve it to anyone.

### The portal: what "derive `issuer_pubkey` from the signature" actually means

Written down because the phrase invites a wrong implementation. **Ed25519 has no key recovery**
(RFC 8032), so it cannot mean recovering a key from signature bytes. It means the body CLAIMS a key
and that claim is worth **nothing** until the signature verifies against it. The operational rule the
code enforces: `submitter_pubkey` is never read for any purpose before `verify` returns true — only
shape-checked. Tested directly with the forgery: Mallory writes a body claiming Bob's pubkey and
signs it with her own.

Every failure RETURNS rather than throwing, because the caller drains a batch and one poisoned row
must not stop the rest — a single malformed submission that aborted the drain would be a trivial
denial of service against every other submitter.

### `scanner_version` is derived, and that required making the corpus enumerable

`M10B-D15` says derive it; nothing could. Added `injectionPatternIds`, `secretRuleIds` and
`detectorCorpusDigest` to the `./detect` subpath — over the **ACTIVE** set, not the source list,
because `compileSecretRules` deliberately skips a rule that will not compile under RE2. That
distinction is what makes §7's "byte-identical across nodes" mechanically checkable instead of
aspirational: **two intakes agree iff their derived versions agree.** Sorted before hashing, so a
mere reorder does not fake a rule change.

### THE FINDING WORTH KEEPING — the subpath was complete-looking and inert

`./detect` never exported `initLinearRegex`. **The corpus cannot compile without it.** Omit it and
`compileInjectionPatterns` runs happily, leaves `compiled` null, and `scanInjectionPatterns` returns
`[]` for every input — every rule silently matching nothing. A consumer installing that gets a
scanner **that cheerfully passes a prompt-injection payload**, which is strictly worse than one that
fails to load, because it reports success.

Two things made it invisible:
1. **From inside the monorepo it works**, because the gateway's own startup calls `initLinearRegex`
   before anything else. Nothing in cello-client exercised the subpath as an outside consumer would.
2. **The exports map deliberately offers no deep-import escape** (that narrowness is the point of
   `M10B-D17`), so there was no workaround — the omission was fatal rather than annoying.

It surfaced only when the portal's scanner was built against the PUBLISHED package. Generalised:
**a narrow entry point has to be tested from outside, as a consumer, or "narrow" and "broken" are
indistinguishable.** The pinned export-list guard I wrote earlier caught every ADDITION deliberately;
it could not catch an omission, because it only checks that the listed names are present.

### Published

`v0.0.138` (gateway 0.0.11 — corpus digest) and `v0.0.139` (gateway 0.0.12 — the initializer).
0.0.11 is on npm and is the unusable one; anyone reading this should use **0.0.12 or later**.

### State

- Directory drain routes: 6 integration tests green, **NOT deployed** — rides the next directory
  deploy (~25–30 min, 3 regions). No migration, so nothing to renumber against the other session.
- Portal: drain client (7 tests) + `authenticateSubmission` (6 tests) green and pushed.
- Portal scanner: written, **not yet verified** — it needs gateway 0.0.12, which was publishing as
  this entry was written.
- Neither `DOD-END-INGRESS-1` nor `DOD-END-SCAN-1` has had its `cello-unit-reviewer` pass yet. Both
  are owed one before either tag flips.
