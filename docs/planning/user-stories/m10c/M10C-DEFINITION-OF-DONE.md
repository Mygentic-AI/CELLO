---
name: M10C Definition of Done
type: definition-of-done
date: 2026-09-04
milestone: M10C
status: open
topics: [m10c, trust-signals, x, twitter, oauth, pkce, portal, compose-screen, zero-bump, definition-of-done]
description: >
  The yardstick and sole status authority for M10C (new trust signal types, starting with X).
  X is the first type where the operator COMPOSES their own signal from a fixed catalogue rather
  than receiving whatever the portal decided to say. Portal-only by the zero-bump contract.
  Read M10C-PROCEDURE first; evidence lives in M10C-BUILD-JOURNAL, never here.
---

# M10C Definition of Done — New Trust Signal Types

**Read [[M10C-PROCEDURE]] first.** This document is the scoreboard; the procedure is how to work it.
Evidence, proofs, reviewer verdicts and run output live in [[M10C-BUILD-JOURNAL]], never here.

**Tags:** ❌ not started · 🟡 implemented, not yet reviewed · ✅ done (written AND reviewed, with the
reviewer's verdict quoted in the journal) · 🅿️ parked with a trigger.

## Position relative to launch

**M10C is OUTSIDE the launch gate. Nothing here blocks launch.** By the standing test — a
prospective customer cannot get the core value, or loses trust — the launch intent is two agents
connecting and communicating safely. A second social signal type is new capability. If Andre rules
otherwise for a specific line, that ruling is recorded here at the top.

## What this milestone is

M10 built the trust-signal machinery and proved it with GitHub. Adding a type is supposed to be a
portal-only change ([[M10-TYPE-PLAYBOOK]]). **M10C is the first real test of that claim since
GitHub, and the first type where the operator decides what their own signal says.**

GitHub mints a fixed pair the moment OAuth returns. X does not: the operator lands on a compose
screen, ticks what they want disclosed from a catalogue we control, watches the plaintext change,
and presses Mint. The floor they cannot go below is enforced by the floor not being a checkbox.

---

## ⛔ THE CONTRACTS ARE PINNED HERE, AND THEY ARE WHY THE THREE ORDERS ARE PARALLEL

The three work orders below can be worked **at the same time, by three sessions, in any order**.
That is only true because the seams between them are decided *here*, by the planner, as data and
signatures — not discovered by whoever gets there first. **A coder who changes one of these three
contracts has broken the other two orders and must stop and say so, not adapt.**

### Contract 1 — `XProfileSnapshot` (produced by 001, consumed by 002 and 003)

```ts
export interface XProfileSnapshot {
  xUserId: string;            // X's stable numeric id, as a string. Survives handle changes.
  username: string;           // handle, no leading @
  createdAt: string;          // ISO 8601, exactly as X returned it
  followers: number;
  following: number;
  posts: number;
  listed: number;
  verifiedFollowers: number;
  identityVerified: boolean;  // X checked a government ID. NEVER the paid blue check.
  protectedAccount: boolean;
  readAt: number;             // epoch SECONDS when we pulled this from X. Not the mint time.
}
```

`readAt` is the whole reason a free re-mint stays truthful — see Contract 3.

### Contract 2 — the field catalogue (literal data; 002 implements it, 003 renders it)

`anon` / `id` say whether a field may appear in that signal: `locked` (always, not a checkbox),
`optional` (a checkbox, default OFF), `never` (no checkbox is offered at all).

| key | label | anon | id | bullet fragment |
|---|---|---|---|---|
| `account_age` | Account age | locked | locked | *(in the lead sentence, not a bullet)* |
| `handle` | Handle | never | locked | *(lead)* |
| `x_user_id` | X user ID | never | locked | *(lead)* |
| `display_name` | Display name | **never** | optional | `display name "Acme Agent"` |
| `followers` | Followers | optional | optional | `4,210 followers` |
| `verified_followers` | Verified followers | optional | optional | `312 of those followers are verified accounts` |
| `following` | Following | optional | optional | `follows 180 accounts` |
| `posts` | Posts | optional | optional | `9,877 posts` |
| `listed` | Public lists | optional | optional | `appears on 64 public lists` |
| `identity_verified` | ID-verified by X | optional | optional | `X has verified their government-issued ID` |
| `protected` | Protected account | optional | optional | `the account is protected — posts are visible only to approved followers` |

**`display_name` is `never` for anon, and that is the pattern, not a special case.** Anything that
carries identity — handle, display name, profile URL, numeric id — gets no anonymous checkbox. Not
greyed out: **absent**. A tick that de-anonymises the anonymous signal would be notarized that way
permanently, and a hash cannot be un-said.

Andre has ruled that "anonymous" is the correct word for a signal carrying no name and no id, and
that triangulation from the optional figures is a cost a discloser may choose to accept
(2026-09-04). **Do not re-open this and do not soften the label in UI copy.**

### Contract 3 — composition signature and output shape (002 implements, 003 calls)

```ts
export type XFieldKey = "account_age" | "handle" | "x_user_id" | "display_name"
  | "followers" | "verified_followers" | "following" | "posts" | "listed"
  | "identity_verified" | "protected";

export interface XTickSelection {
  anon: readonly XFieldKey[];
  id: readonly XFieldKey[];
}

export function composeXSignals(
  accountId: string,
  snapshot: XProfileSnapshot,
  ticks: XTickSelection,
  opts?: { issuedAt?: number },
): { anon: ComposedSignal; id: ComposedSignal };
```

Types are `x_anon` and `x_id`, `subject_kind: "account"`, both — same as GitHub, so every agent
under the account may present them.

**The plaintext shape is fixed:**

```
This operator has had an X account since May 2013 — 13 years, 4 months old at the time of minting.
Profile figures below were read from X on 12 March 2026:
• 4,210 followers
• 312 of those followers are verified accounts
• X has verified their government-issued ID
```

and the `x_id` lead instead reads:

```
This operator owns the X account @acmeagent (X user ID 1234567890), held since May 2013 — 13 years,
4 months old at the time of minting.
```

Four things about that text are load-bearing:

1. **The creation date is the anchor and it never goes stale.** Rendered at MONTH granularity
   (`May 2013`), never the exact timestamp — a to-the-second creation time is a far sharper
   fingerprint and buys a reader nothing.
2. **The age is computed live at every mint** from `createdAt`, so it is always true, including on
   a free re-mint months later.
3. **The "read from X on" line covers the bullets only, and carries `readAt`, NOT the mint time.**
   A free re-mint advances the mint time and the age but not the figures. One date over both would
   assert that a six-month-old follower count was measured today.
4. **With no optional fields ticked, the "read from X on" line is omitted entirely** — it would be
   a date attached to nothing.

---

## Tier 1 — the three parallel orders

### `DOD-M10C-XPROFILE-1` ❌ An operator connects X and the portal holds their profile

`micro/001-XPROFILE-oauth-and-profile-read.md`

OAuth 2.0 authorization-code **with PKCE** (X rejects anything else), one authenticated
`GET /2/users/me` carrying every field in Contract 1, normalized and persisted as an
`XProfileSnapshot`. The token is discarded immediately, as GitHub's is; no `offline.access`, no
refresh token stored.

**Refresh is an explicit, rate-limited, billed act.** One pull per account per 7 days, and the
interval is a named constant with its reason beside it. **Signing in must never touch the X API** —
the existing login-mint path bills nothing today and must keep billing nothing.

### `DOD-M10C-XCOMPOSE-1` ❌ The portal composes both claim texts from the operator's ticks

`micro/002-XCOMPOSE-compose-the-two-signals.md`

`composeXSignals` per Contract 3: pure, no I/O, no network, no database. Renders the fixed plaintext
shape, carries the same facts as structured payload fields beside the prose, and refuses a
selection that names a field the catalogue marks `never` for that signal.

The floor is structural: `account_age` (both) and `handle` + `x_user_id` (`x_id`) are added
unconditionally and **cannot be expressed as absent by any input**.

### `DOD-M10C-XSCREEN-1` ❌ The operator sees what they are about to say, and changes it

`micro/003-XSCREEN-compose-screen-and-mint.md`

The four-column table (field · what it says · anon tick · id tick), nothing ticked by default, the
two claim texts rendering live below it as ticks change, and two distinct buttons — **Mint** (free)
and **Refresh from X** (billed, weekly, and inside the window it says when it unlocks rather than
failing on click).

The mint route takes **field keys, never values**: a request carries which boxes were ticked and
the values come from our stored snapshot. A request naming a `never` field is refused.

---

## Tier 2 — the enforcer

### `DOD-M10C-XLIVE-1` ❌ The live journey, on a real X account

Not ✅ until it has run end-to-end with a real X developer app and real credits: connect → compose
screen → tick a selection → mint → both signals notarized at the directory and replicated → sealed
delivery to a real agent's wallet → presented at a real introduction → the recipient re-derives the
hash and an LLM reads the claim with `issuer_kind: portal` framing.

Negative half, same bar: a tampered payload fails the recipient's re-hash; a second mint retires the
first pair in the wallet (type-dedup on receipt, `putWalletSignal`); a `never` field submitted
directly to the mint route is refused.

**Zero-bump proof:** `git status --porcelain` clean in `cello-client` AND `trustless-cello` for the
entire run. If either is dirty, the machinery was not generic and that is a finding, not a fix.

---

## Tier 3 — the procedure debt this milestone pays

### `DOD-M10C-PLAYBOOK-1` ❌ The Type Playbook is brought up to this milestone's standards

[[M10-TYPE-PLAYBOOK]] is the runbook for adding a type and it predates the review discipline now in
[[M10C-PROCEDURE]]: no severity triage, no fail-loudly invariants, no reviewer dispatch, no
made-to-fail requirement, and
it still assumes browser extraction for external providers — which X disproves, since the profile
comes from an authenticated API read in the portal process.

Update it from what M10C actually did, in the same commit as the finding, per the playbook's own
rule. **Two things it does not currently say and must:** a type may be operator-composed from a
catalogue rather than portal-dictated, and a provider whose API costs money needs a rate limit and a
"never bill on login" rule.

---

## Not in scope, explicitly

LinkedIn or any third provider (it gets its own order once X has run the playbook); changing
GitHub's mint to use a compose screen; the directory's superseded-row tidiness noted below; any
change to the envelope, the hash preimage, the directory, or the daemon.

## Carried, not lost

- **The directory keeps stale notarizations live.** The wallet retires an old signal on receipt
  (type-dedup), so nothing stale is ever presented — but the portal never tells the directory the
  old one was replaced, so `signal_records` accumulates live-but-unpresented rows, and revoking
  "my X signal" retires only the newest hash. Measured on GitHub in August: 17 notarized against 15
  recorded. **Ledger tidiness, not a trust defect. Andre ruled 2026-09-04 that the add-don't-replace
  behaviour is wanted.** Revisit only if revocation completeness becomes a real requirement.

---

## Related Documents

- [[M10C-PROCEDURE]] — how to work this milestone
- [[M10C-BUILD-JOURNAL]] — evidence, verdicts, run output
- [[M10-TYPE-PLAYBOOK]] — the runbook `DOD-M10C-PLAYBOOK-1` repays
- [[M10-TRUST-SIGNAL-TAXONOMY]] — the type catalogue and class definitions
- [[M10-TRUST-SIGNAL-STORAGE-AND-CREATION]] — spec-of-record for the envelope and the mint
