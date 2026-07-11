---
name: address-book-implementation-spec
type: story
date: 2026-07-10
topics: [contacts, address-book, tiers, reachability, option-c, rename, away-messages, settings, abuse-bounds, overnight]
status: active
description: >
  Executable spec for the contact address book — the five-tier reachability model, Option C rename
  detection, per-tier/per-contact answering messages, and a daemon-side settings store — built on the
  agent_id join-key that shipped in daemon@0.0.45. Design source: 2026-07-10_contact-address-book-design.md.
  Written to be executed COLD by an autonomous overnight agent: every decision is baked in; there is no one
  to ask. When in doubt, choose the tighter/safer option, implement it, and flag it — never block, never
  loosen.
---

# Address Book — Implementation Spec

> **Design source (read first):** [[2026-07-10_contact-address-book-design]] — the *why* and the decisions.
> This is the *how*: DoD lines, ACs, build order, tests. Where the two differ, THIS spec wins (it carries
> the final locked values). Follow [[M8C-PROCEDURE]] for the per-unit loop and gate.

## Standing rules for this run (overnight, no operator available)

- **No decision is open.** Everything below is locked (Andre, 2026-07-10). If you hit a fork this spec does
  not cover: **take the more conservative / fail-safe / tighter option, implement it, and flag it loudly**
  in the commit message and a summary — never block waiting for an answer, never resolve an ambiguity in
  the *permissive* direction. Security defaults tighten, never loosen.
- **Code review runs on the Fable-Five model** (operator's instruction), via the per-unit reviewer. Make
  each AC concrete enough that a review pass can verify it mechanically.
- **Client-side only** — `cello-client core/daemon`. No directory, no deploy, no publish (publish is
  Ms_Chelly's). SPARC + TDD, red-first. Real on-disk SQLCipher DB in migration tests. Never a from-scratch
  fixture — extend `session-fixture.ts`. Gate every unit: `pnpm run test && lint && typecheck && build`,
  then the reviewer, fix every finding, commit with the DoD id.

## Foundation this is built on

`contacts` was re-keyed to `agent_id` in `daemon@0.0.45` (DOD-AGENT-ID-JOINKEY-1). This spec's new columns
land on that stable key. **This migration is ADD COLUMN only** (idempotent, PRAGMA-guarded) — *not* a table
rebuild — because it adds columns and does not change the PK. Contrast the join-key migration; this one is
simple.

## The two invariants (hold in review — from the design doc)

> **INV-TIER-SCREEN** — tier NEVER bypasses the security gateway. Every inbound message, every tier, passes
> screening. **A tier check must never appear as a condition on a screening call.** Verify: none of the
> `isContact()` sites you touch gate `screenInbound`/`screenOutbound` (they gate abuse bounds and display —
> confirm before and after).
>
> **INV-TIER-BOUND** — tier may *raise* a bound, never *remove* one. No tier is unbounded; `vip` is finite.

---

## Build order (do in sequence; each is its own commit + review)

### Step 1 — schema + tier foundation

**DOD-TIER-1 — the contact record gains a tier and metadata.**
- **AC1** Idempotent PRAGMA-guarded `ALTER TABLE contacts ADD COLUMN` for: `tier INTEGER`,
  `provenance TEXT`, `last_offered_moniker TEXT`, `away_message TEXT`. All nullable. Fresh schema == migrated
  schema (assert). **`tier` MUST NOT carry a column `DEFAULT`** — a `DEFAULT 1` would set existing rows to
  `UNKNOWN` on the ALTER, and AC4's grandfather backfill (`WHERE tier IS NULL`) would then match nothing,
  silently downgrading every existing auto-accepting contact. Add with no default; backfill explicitly (AC4);
  let `getTier` normalize any residual NULL (AC3).
- **AC2** `tier` is an INTEGER with named constants, ordered so `>=` works:
  `BLOCKED=0, UNKNOWN=1, KNOWN=2, WHITELISTED=3, VIP=4`. A `TIER` enum/const map is the single source; no
  bare integers in call sites.
- **AC3** A `getTier(agentId, pubkey): number` helper is **total** — it never returns null/undefined. It
  returns the row's tier, or **`UNKNOWN`** when the row is **absent OR `tier IS NULL`**. (A row can be
  NULL-tier: created post-migration before tier-on-create is wired. In JS `null >= 0` is `true` and
  `grid[null]` is `undefined` → crash, so NULL must be normalized here, to the *tighter* `UNKNOWN`, never to
  the grandfather `WHITELISTED`.) Absence of a row = `UNKNOWN` (never seen); an explicit `tier=NULL` row =
  `UNKNOWN` (seen, unclassified); a `BLOCKED` contact is an explicit `tier=0` row.
- **AC4** Migration backfill: **existing contact rows → `WHITELISTED`** (they were auto-accepting; preserve
  behavior — grandfather, per decision 1a). `UPDATE contacts SET tier = 3 WHERE tier IS NULL`.
- **AC5** `provenance` is written on contact creation: `'initiated'` (I opened the session),
  `'accepted'` (I accepted theirs), else null for legacy. (`introduced_by:<pubkey>` / `imported` are future
  values — reserve the format, don't build the sources.)
- **SI** No behavior change yet from this step alone beyond the backfill; it is pure schema + helper.

### Step 2 — tiered reachability + bounds (security-critical; hardcoded defaults)

**DOD-TIER-2 — abuse bounds become tier-graduated (INV-TIER-BOUND).** Replace "known contacts exempt
entirely (bounded only by disk)" and the non-contact byte cap with a grid keyed by `getTier`. **Hardcode
these defaults now** (Step 4 makes them settings):

| tier | max concurrent sessions / sender | max bytes / session |
| :-- | :-- | :-- |
| `BLOCKED` | 0 | 0 |
| `UNKNOWN` | 3 | 25 MB |
| `KNOWN` | 5 | 100 MB |
| `WHITELISTED` | 20 | 500 MB |
| `VIP` | 50 | 2 GB |

Global cap on concurrent sessions from all `UNKNOWN` senders: **50** (unchanged).
- **AC1** `checkUnknownSenderAcceptanceBound` uses `getTier` → the per-tier session cap. `UNKNOWN` stays at
  3 (unchanged); `KNOWN`+ get the finite caps above (replacing "unbounded").
- **AC2** The per-session byte caps (`session-node-manager.ts:2836` & `:2954`) use `getTier` → the per-tier
  byte cap. `UNKNOWN` stays 25 MB.
- **AC3** **No tier is unbounded** (INV-TIER-BOUND) — assert `VIP` is 50 / 2 GB, not `Infinity`. A test that
  a `VIP` sender is still refused past 50 concurrent sessions.
- **AC4** The grid lives behind one named constant map; the values are referenced, never inlined.

**DOD-TIER-3 — a `BLOCKED` sender is refused, indistinguishably.** Falls out of DOD-TIER-2 for free:
`BLOCKED` = 0 session cap → the *same* bound-check refusal path an over-cap `UNKNOWN` takes. **Do not add a
separate blocked branch with a distinct response** — that would be an oracle. Refused before any session
state exists.
- **AC1** An inbound session from a `BLOCKED` contact is refused with the **same reason/response** as an
  over-cap unknown — a test asserts the two responses are byte-identical.
- **AC2** No session node, no DB row, no accept, no away reply for a blocked sender.

### Step 3 — the address book itself + Option C

**DOD-TIER-4 — split `isContact()` into role-specific checks.**
- **AC1** `isAutoAccept(agentId, pubkey)` = `getTier() >= WHITELISTED`. This is the *policy* gate (auto-accept
  an inbound session).
- **AC2** `isKnown(agentId, pubkey)` = `getTier() >= KNOWN`. This is the *display/relationship* check.
- **AC3** Promotion to `KNOWN` is by **engagement, not mere accept** (DEC-AB-3 — tighter than the original
  "on accept → KNOWN"): a *committed reply* into an accepted inbound session (`provenance='accepted'`), an
  outbound *initiate* (`provenance='initiated'`), or an explicit add promotes a contact to `KNOWN`. A bare
  transport-accept of an inbound knock adds nothing — a stranger who merely knocks is not promoted
  (preserves CC-1, live-verified). (None auto-accept future inbound; that requires an explicit promote to
  `WHITELISTED`.)
- **AC4** Every former `isContact()` call site is now one of `isAutoAccept` / `isKnown` / the bounds grid —
  **and none gate a screening call** (INV-TIER-SCREEN; verify).

**DOD-CONTACT-VIEW-1 — the address book is viewable, and tiers are settable.**
- **AC1** `cello_contact_set_tier { agent, pubkey, tier }` (and a CLI `cello contact tier`) sets the tier;
  validates the tier is a known constant; refuses an unknown value.
- **AC2** `cello contact list` (and the MCP `cello_contact_list`) render, per contact: moniker/who,
  tier, provenance, and — via a **JOIN against `sessions`** — how many **sealed** sessions shared
  (`sessions.status='sealed'` count), and last-spoke (`MAX(sessions.updated_at)`). No new stored data; a
  read-side join. This is the "feels like an address book" win.
- **SI** The join is read-only and per-agent (scoped by `agent_id`); a contact with no sessions shows
  zero/never, not an error.

**DOD-RENAME-1 — Option C: the stored name is sacrosanct; renames are noticed, never auto-applied.**
- **AC1** On an inbound offer carrying a moniker, set `last_offered_moniker` to that value **once the
  session acceptance-bound check has passed** (DEC-AB-4 — tighter than the original "unconditionally, when
  the offer is SEEN"): a `BLOCKED` or over-cap peer, refused before any session state, must NOT drive the
  operator's rename baseline or push a notice into their inbox. For an accepted peer it still updates on
  offer-seen (not when a notice is read) — which is what keeps rename detection idempotent (design §3).
- **AC2** A stored local moniker (`contacts.moniker`) is **never overwritten** by an offered name. `whoLabel`
  precedence is unchanged: local pet name wins.
- **AC3** When an inbound offered moniker **differs from `last_offered_moniker`** for a contact the operator
  **has personally named** (`contacts.moniker` non-null), surface a rename notice **through
  `cello_check_notifications`** (the inbox) — NOT a new real-time push type. The notice names the contact,
  the new self-declared name (rendered as a claim, quoted, with the pubkey — it is untrusted), and the
  command to adopt it (`cello_contact_set_moniker`). Then update `last_offered_moniker`.
- **AC4** A repeated offer of the same (already-seen) name produces **no** notice (idempotent — the whole
  point). A test: offer `Alice`, name her `Mum`, offer `Alice_Corp` → one notice; offer `Alice_Corp` again →
  silent.
- **AC5** Silence is not a rename: an offer with **no** moniker must not fire a notice and must not clear
  `last_offered_moniker`.
- **Documented limitation (write it in a comment):** `last_offered_moniker` only updates on the *receiving*
  side of an offer, so rename detection works only for peers who *initiate to you*. Not a bug — a property.

### Step 4 — the settings store, then away messages

**DOD-SETTINGS-1 — a daemon-side per-agent settings store.** A SQLCipher table keyed on `agent_id`
(sibling to `telegram_settings`), holding per-agent policy: the tier bounds grid and the per-tier away
messages. **Not** M9-CFG-001's gateway store (decision ③: different domain — reachability policy, not
gateway screening; and the M9 store is unwired + plaintext). Leave a comment: *"reconcile with DOD-CONFIG-1
later; this is daemon reachability policy, not gateway config."*
- **AC1** A `settings(agent_id, key, value, updated_at)` table (or typed columns — implementer's call,
  keep it simple), on the agent_id key, in the encrypted DB.
- **AC2** `cello_settings_get/set` (or extend an existing surface) to read/write; validates keys.
- **AC3** Get-with-default: an unset key returns the hardcoded default from Step 2's grid. **Setting is
  optional; the daemon runs correctly on defaults alone.**

**DOD-TIER-BOUNDS-SETTINGS — make the grid changeable.** Step 2's bounds now read from settings, falling
back to the hardcoded grid.
- **AC1** With no settings, behavior is identical to Step 2 (defaults). With a setting, the new value takes
  effect. A test sets `known` sessions to 8 and asserts the 8th succeeds, 9th refused.
- **AC2** A setting can only be a finite positive number (or 0 for blocked) — **reject Infinity / negative**
  (INV-TIER-BOUND: a setting cannot remove a bound).

**DOD-AWAY-TIER-1 — per-tier and per-contact answering messages.** Resolve most-specific-first:
`contacts.away_message` (per contact) → per-tier away text (settings) → agent default (settings) → system
default (code).
- **AC1** An unattended agent's away response uses this resolution. A test drives all four levels and asserts
  the most-specific match wins, and that the resolution is **total** (every case yields exactly one message).
- **AC2** The per-contact `away_message` column (added in DOD-TIER-1) is settable via
  `cello_contact_set_away { agent, pubkey, message }`.
- **SI** An away message is an **outbound disclosure to a stranger** — the resolved text is screened on the
  outbound path like any content (it does not bypass the gateway).

---

## Observability ACs (M4+ rule — first-class)

Named events, with `{ agentName/agentId, pubkey, correlationId }` where applicable:
- `contact.tier.changed` (old→new tier) — on `set_tier`.
- `contact.rename.noticed` (contact renamed themselves; NOT the raw name if unverified — same rule as
  `moniker.rejected`: log the fact, not attacker-chosen text) — when a rename notice is queued.
- `session.inbound.refused.tier` (a `BLOCKED` or over-cap sender refused) — reuse/extend the existing
  abuse-bound refusal event; do not invent a blocked-specific one that leaks the tier to the sender.
- `contact.away.resolved` (which level matched) — at away-response time, debug level.

## Post-build reconciliations (2026-07-11)

After the whole-unit Fable-5 `cello-done-auditor` pass (verdict: 6 EARNED, 3 EARNED-PENDING-LIVE-SMOKE,
0 NOT-EARNED; both invariants hold):

- **AC text amended to the journaled decisions** (this file): TIER-4 **AC3** → engagement-promotes
  (DEC-AB-3); RENAME-1 **AC1** → acceptance-gated baseline (DEC-AB-4). The code was always the tighter
  version; the ACs now match so future readers don't diff code against stale text. Full rationale:
  `2026-07-10_address-book-build-log.md` (DEC-AB-1..4).
- **Operator-surface unit added before the publish cascade** (Andre's call, 2026-07-11): `cello_settings_get`
  / `cello_settings_set` as MCP tool + CLI, mirroring `cello_contact_set_tier`. Without it,
  `DOD-TIER-BOUNDS-SETTINGS` and the per-tier / agent-default away messages (`away.tier.<tier>`,
  `away.default`) would ship as dead features — reachable only over daemon IPC. The SET path validates at the
  handler boundary (valid key; bound values finite + strictly positive — reject `Infinity`/negative/0).
- **Follow-up (non-blocking, logged):** a slow-gateway **race test** for the second (re-check) byte-cap gate
  (`session-node-manager.ts` ~L3393). Both gates are code-identical today, so a re-check-only regression
  would stay green without it.

## Not in scope (deferred to later units — do NOT build)

- **DND** availability state + VIP-bypasses-DND.
- **Generic-Reject-to-initiator** as a distinct frame (D2 built the responder→directory reject).
- **Offline relay mailbox** for whitelisted/vip senders (`LEAVEMSG-1`, 🟡).
- **The `trust_signals` table** and anything M10 — this unit is the address book only. `provenance` reserves
  `introduced_by` but does not build introductions.
- **Portal integration** — the daemon owns the address book; the portal is a deferred lens (design §2).

## Related Documents

- [[2026-07-10_contact-address-book-design]] — the design (decisions, rationale).
- [[2026-07-08_inbound-state-matrix]] — the parent behavior matrix; the tier is its sender axis.
- [[2026-07-10_agent-id-joinkey]] — the foundation this is born on.
- [[M8C-PROCEDURE]] / [[M8C-DEFINITION-OF-DONE]] — the loop and the board.
