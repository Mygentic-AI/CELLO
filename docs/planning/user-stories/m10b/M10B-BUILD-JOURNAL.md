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
