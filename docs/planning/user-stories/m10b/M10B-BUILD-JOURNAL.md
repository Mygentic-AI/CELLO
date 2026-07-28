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
