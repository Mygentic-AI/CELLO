---
name: contact-address-book-design
type: design
date: 2026-07-10
topics: [contacts, address-book, monikers, tiers, trust-signals, endorsements, sync, portal, sovereignty, option-c]
status: active
description: >
  The data model the inbound state matrix presumes but never specifies. Separates "who I know" from
  "who I let in": one contacts table, an ordered tier (blocked < unknown < known < whitelisted < vip)
  that governs REACHABILITY only and never screening, a name that is independent of tier and
  sacrosanct once stored, and the rename-detection mechanism that makes Option C workable. The daemon
  owns the address book; the portal is a lens, never a store. Trust signals live in their own table,
  keyed on the pubkey, never as columns on contacts.
---

# The Contact Record — Address Book Design

> **Parent:** [[2026-07-08_inbound-state-matrix]] defines *behaviour* — four sender tiers against four
> availability states, and the protocol response at each intersection. It is a decision table, and it is
> silent on where a tier is stored, what a contact record contains, or who grants VIP. **This document is
> the data model that matrix presumes.** It does not restate it.

## 0. Why this exists

Today a contact is:

```sql
contacts(agent_name, pubkey, added_at, moniker)   -- PRIMARY KEY (agent_name, pubkey)
```

Four fields and a nickname. That is **a whitelist, not an address book.** A whitelist answers one
question: auto-accept, yes or no. An address book answers *who is this, how do I know them, what have we
done together, and what do others say about them.*

The gap is not cosmetic. **The address book is the only surface on which the trust layer is ever
visible.** Signals with nowhere to render are signals nobody sees, and CELLO's differentiator stays
invisible no matter how good the cryptography is.

And CELLO cannot borrow what WhatsApp, Signal and Telegram borrow. **Their contact list is the phone's
address book** — identity arrives from outside, already populated, already meaningful. A CELLO contact
bootstraps from a 64-character hex string and nothing else. The self-declared name, and later the
endorsements, are not garnish. They are the **replacement for the phone book**.

**Live evidence (2026-07-10):** `Ms_Chelly` and `CELLO_Support` exchanged **nine sealed sessions** in one
morning and neither could name the other. See [[M8C-MONIKER-SPEC]] §13.

---

## 1. DECIDED — one table; tier governs reachability, not safety

**Problem.** `contacts` membership currently means four things at once: you know them, they auto-accept,
they skip unknown-sender screening, and they skip the anti-spam cap. And `cello_contact_set_moniker`
refuses on a non-contact (`contact_not_found` → "Add it first"). **So to remember who someone is, you must
grant them auto-accept.** There is no way to write "this pubkey is Alice" without also writing "always let
Alice in."

That is exactly what the parent matrix forbids: it distinguishes **Known (Neutral)** from **Whitelisted
(Friendly)** and gives them different rows.

**Decision.** One table. Add an **ordered tier**:

```
blocked  <  unknown  <  known  <  whitelisted  <  vip
```

- **A name is not a trust level.** You can know exactly who someone is and want nothing from them. You
  must be able to name a `blocked` contact, or the block list is a wall of hex.
- **Row absence means "never seen." Tier `unknown` means "seen, not yet classified."** Different states.
  A stranger presenting trust signals gets a row at `unknown` — that is not an endorsement of them.
- **A `blocked` sender is refused indistinguishably from an `unknown` one.** A different response would be
  an oracle: anyone could probe whether they are on your list. `Generic Reject` looks identical either way.
- The `isContact()` call sites split into `isKnown()` (display, provenance) and `isAutoAccept()` (policy).

### The two invariants (review against these)

> **INV-TIER-SCREEN.** Tier NEVER bypasses the security gateway. Every inbound message, from every tier,
> passes `screenInbound`. A tier check must never appear as a condition on a screening call.
>
> **INV-TIER-BOUND.** Tier may *raise* a bound. It may never *remove* one. Any limit expressed as "exempt
> entirely" is a defect, not a policy.

**Why (Andre, 2026-07-10):** *a VIP can be compromised* — and a VIP is the most valuable thing to
compromise, precisely because trust is where exemptions accumulate. Every capability granted by tier is a
capability an attacker inherits the moment they take that account. **The trust gradient and the scrutiny
gradient must not point the same way.** An uncapped VIP is an unbounded write primitive handed to whoever
steals a friend's key.

So the sender axis answers **who gets through and how loudly** — never **who gets inspected**. Screening is
orthogonal, applies to everyone always, and never appears in the matrix.

⚠️ **`checkUnknownSenderAcceptanceBound` currently reads "Known contacts are exempt entirely (bounded only
by disk)."** That is the exact shape INV-TIER-BOUND forbids. Fix when the tier lands.

### 1a. DECIDED — an accepted stranger becomes `known`, and is offered the upgrade

**Andre, 2026-07-10: Option 3.**

Accepting a session today adds the sender to `contacts`, which auto-accepts them forever after. That
conflates **"I answered your call"** with **"I gave you my keys"** — and the conflation is invisible: nobody
sees the moment a one-off conversation became a standing invitation. The cost of a mistaken accept is
unbounded future access, granted silently.

- **On accept → tier `known`.** They reach you when you are attended; they get the answering machine when
  you are away; they get a `Generic Reject` when you are offline. Exactly the parent matrix's
  `Known (Neutral)` row.
- **The operator is then offered the upgrade**, explicitly:
  `Accepted. Add Alice to your whitelist so she can reach you when you're away?  cello_contact_set_tier …`
- **Existing rows migrate to `whitelisted`**, preserving today's behaviour. Silently revoking access that
  people already rely on is a worse failure than grandfathering a permissive default for a handful of
  contacts. The grandfathering is honest: they can be listed and demoted at leisure.

The parent matrix already assumes this split — it reserves the relay mailbox for `Whitelisted` and `VIP`,
and gives `Known (Neutral)` a `Generic Reject` when the receiver is offline. **Accepting a session was
never meant to mean whitelisting.**

---

## 2. DECIDED — the daemon owns it; the portal is a lens

**The daemon's SQLCipher DB is the source of truth.** The portal is a lightweight web interface with
direct access only to what is in the **directory**. It never holds PII, contacts, or anything like them.
To display an address book it **syncs from the local daemon temporarily**, draws the data in, uses it, and
keeps nothing. **If the daemon is offline, the information is not accessible.** That is the trade, and it
is the same trade the directory already makes by storing email and phone as hash-only stubs.

The counter-argument, accepted with open eyes: **a lost laptop is a lost social graph** unless the operator
has taken a backup (`cello_backup` / `cello_restore`). That is the hardware-wallet trade.

**Three things that make "temporary" real rather than aspirational:**

1. **The portal must be prevented from keeping it, not merely intended not to.** Drawn-in contacts live in
   browser memory for the life of the tab: no `localStorage`, no `sessionStorage`, no server-side session,
   no logging, no analytics payload, **no error-reporter breadcrumbs**. That last one is how this leaks in
   practice — an exception reporter captures a component's props and the address book lands on a third
   party's server.
2. **The loopback bridge is a security boundary and a well-known way to get owned.** If the daemon exposes
   an HTTP listener on `127.0.0.1` so a browser can reach it, **every website you visit can also reach
   it** (the Zoom/Spotify local-server class of bug). It needs a bearer token paired once by the operator,
   a strict `Origin` allowlist, and no ambient authority. Unauthenticated, any tab enumerates your
   contacts, your tiers, and everyone you have blocked.
3. **The JavaScript that reads your local contacts is served by our server.** A compromised portal build
   could exfiltrate what it draws in. Inherent to any web UI over local data. Honest mitigations:
   subresource integrity, reproducible builds, and eventually the option of a UI served by the daemon
   itself, which has no such exposure.

### Multi-daemon sync — user-initiated, deferred

Not built now. Lands with the Tier 5 multi-daemon work ([[M8C-DEFINITION-OF-DONE]] `DOD-PORTAB-1`).

**Sync is a separate operation with its own code.** The contact record does not anticipate it; merge
semantics live in the sync tool, not the schema. On conflict the operator is asked which side supersedes,
with an option to make it a standing rule ("always let daemon A supersede B").

> **The one carve-out.** A standing supersede rule may resolve anything EXCEPT a change that increases
> reachability. Names, notes, downgrades, `known → known`: silent. **Any tier increase, and every
> `blocked` entry, always asks.** Otherwise sync becomes a privilege-escalation path and the attacker's
> move is to get one write on the machine you care about least.

`last_offered_moniker` (§3) is a **per-machine observation** and never enters a merge — each daemon knows
only what *it* was told.

*Pleasing consequence:* the sync can run **over CELLO itself**, as a session between the operator's own two
agents. The transfer then produces a sealed, notarized transcript of exactly what moved — an address-book
transfer with a receipt, from the protocol it is an address book for.

---

## 3. DECIDED — Option C's mechanics: the stored name is sacrosanct

Extends [[M8C-MONIKER-SPEC]] §13, and corrects it in two places.

**The rule (Andre, 2026-07-10).** You meet someone unknown; they offer a moniker. You may adopt it, or
store a different name, or store nothing. **Once you have stored a name it is yours and is never
overridden by default.** If they later offer a different name you are *notified*, and given the command to
adopt it if you wish.

### C is a choice, not a side-effect — which dissolves §13's two open conditions

§13 has the name move into contacts *automatically when the session is accepted*. It is a **deliberate
act** instead. Therefore:

- **Provenance stops being a problem.** Everything in the address book was chosen by you. There is nothing
  to mark, and `whoKnown` keeps meaning exactly what it means: *did I name them.*
- **Auto-accept stops being a problem.** A whitelisted or VIP sender is accepted with nobody in the loop,
  so **nothing is stored**. No name is ever written without a human.

The cost is that `(self-declared)` persists until you act — today's symptom. C pays for it honestly: you
are **told**, with the command to fix it. One mechanism, two triggers:

- *First sighting:* `"Alice" (self-declared) wants to connect. To save this name: cello_contact_set_moniker …`
- *Rename:* `Alice now calls herself "Alice_Corp". To adopt it: cello_contact_set_moniker …`

⚠️ Open UX question: is the first-sighting prompt wanted on **every** unknown sender? It is a nudge
attached to every stranger's connect, and the parent matrix wants unknown senders kept quiet. It may belong
only after the first accepted session, not on the doorbell.

### Rename detection — the field records what THEY claimed, not what you decided

The naive check (`offered ≠ stored moniker`) is unusable: you save her as `Mum`, she keeps offering
`Alice` because that was always her outbound name, and you are told **"Alice has changed her name"** on
every session forever. Nothing changed. You renamed her.

```sql
contacts(… moniker, last_offered_moniker …)
              ^ yours   ^ the last claim you were SHOWN
```

**Update `last_offered_moniker` every time an offer arrives** — unconditionally, adopted or not. Notify only
when the incoming offer differs from it.

1. You call her `Mum`. `last_offered = "Alice"`.
2. She offers `Alice_Corp`. Differs → **notify once**. Set `last_offered = "Alice_Corp"`.
3. You decide no, and do nothing.
4. Next session she offers `Alice_Corp` again. Matches → **silent, forever.**

**There is no refusal to store, because there is no refusal.** The record answers only "have I already been
shown this claim?"

**AC (the failure mode):** the update happens when the offer is **seen**, not when the notice is **read**.
Otherwise an operator who never reads the notice is re-notified every session — the tedium reintroduced
through the back door.

**Why the notice exists at all:** with no pet name you never need one — every doorbell already shows the
current self-declared name. **It is your pet name that hides their claim.** The notice is the only channel
through which a change can reach you. Which scopes it: **rename notices exist only for contacts you have
personally named**, and therefore cannot be spammed by strangers.

### Two corrections to §13

1. **The box does not fully retire.** §13 says it exists only between the knock and the accept. The offered
   name must keep arriving on **every** offer so it can be compared against `last_offered_moniker`. It stays
   transient and is never a display source once a name is stored — but the wire field is permanent.
2. **`MONIKER-2` AC3 ("never auto-write the offered name to contacts") is PRESERVED, not changed.** §13
   expected to change it. Because storage is a deliberate act, AC3 stands as written.

### Open, unresolved

- **Silence is not a rename.** A peer who offered `Alice` and now offers nothing (older client, or cleared
  it) must not fire a notice, and must not clear `last_offered_moniker`. Absence of a claim is not a claim.
- **The notice must render the new name as a claim** — quoted, marked, with the pubkey. It is the one place
  an unverified string is put in front of the operator at the exact moment they are asked to *adopt* it,
  which is when a name-shaped lure is most valuable. The charset prevents structural mischief; the framing
  prevents social mischief.
- **Collisions become visible.** Dismissed for notifications (the pubkey rides along, [[M8C-MONIKER-SPEC]]
  §11) — but an address book listing two contacts both named `Alice` is a different experience, and it is
  where the fingerprint must resurface.

---

## 4. DECIDED — the columns land NOW; the signal table does not

**`contacts` gains three nullable columns now**, before there are operators to migrate:

| column | meaning |
| :-- | :-- |
| `tier` | `blocked` / `unknown` / `known` / `whitelisted` / `vip` — §1 |
| `last_offered_moniker` | the last claim this peer showed us — §3 |
| `provenance` | how the row arose: I initiated / I accepted / imported / introduced by ⟨pubkey⟩ |

**Why now:** this is client-side SQLite on operators' disks. `CLAUDE.md` calls client-side migrations
*"unrecoverable without manual intervention"* when they fail. You have **one** user. Every user added makes
reshaping this table more expensive and more dangerous. Nullable columns cost nothing today and make the
trust milestone **additive** rather than a migration of everybody's address book. None of the three is
speculative: `tier` is the parent matrix's own sender axis, `last_offered_moniker` falls out of §3, and
`provenance` records something the daemon already knows and throws away.

### The free win — no new data at all

`sessions` already carries `counterparty_pubkey`, `status`, `created_at`, `updated_at`, `message_count`,
`sealed_root_hex`, `seal_legibility`. So *"how many sealed sessions do I share with this contact, when did
we last speak, is any transcript notarized"* is **a `JOIN` away**. No new tables, no protocol change, no
migration. It is the cheapest thing on this list and it is most of what makes an address book feel like it
knows who these people are.

---

## 5. Trust signals — their own table, keyed on the pubkey

**Andre, 2026-07-10:** trust signals do **not** live in `contacts`. They go in their own table. An agent may
share many at once — ten, fifteen. Each is a row with its own key and a foreign key to the contact that owns
it. **`contacts` gets no trust-signal columns.** That is what keeps `contacts` small and stable, and what
makes §4 safe.

**One refinement, and it decides whether a stranger's signals can be stored at all.** If the FK references a
`contacts` **row**, you must already have a contact before you can hold a signal about someone. But signals
arrive **from strangers** — that is exactly when they are most useful, because they are what you would use
to *decide* whether to accept.

**Key on the pubkey.** It is already the identity anchor (§11): the thing every frame carries and the thing
that survives a name change. `contacts` is *your annotation* of a pubkey; `trust_signals` are *claims about*
that pubkey. Both are children of the key, not of each other. A stranger's signals then land with nothing
else required, and if you later name and tier them, the signals are already there, joined on the same column.

It also resolves the self-versus-other question with no second table: **a signal about your own agent is one
whose subject is your own pubkey.** No special case.

### OPEN — does a signal record who ISSUED it?

A signal an agent shares **about itself** and an endorsement a third party **signs about them** are the same
row only if there is an `issuer` column. Without one they are indistinguishable — and the moniker taught us
that this distinction is the whole ballgame:

| who asserted it | rendering |
| :-- | :-- |
| I did | plain — my own judgement |
| they did (`issuer == subject`) | `(self-declared)` — a claim |
| a third party did | `(vouched by X)` — worth exactly what X is worth |

If it is signed, **store the exact wire bytes**: a signature cannot be re-verified over a re-serialized
payload. Canonical encoding in, canonical encoding stored. Getting that wrong is unrecoverable later.

And if the trust-signal design includes something purely **behavioural and locally derived** — "this peer has
never broken a seal" — that has no issuer and no signature. It is an **observation**, not an attestation, and
observations and attestations are different kinds of thing. **That may be the real split**, and it is not
self-versus-other at all.

⚠️ **Blocked on reading the existing trust-signal documentation before any schema is proposed.** Everything
above about signals was derived from the wire semantics, not from those docs.

---

## 6. What is NOT decided

- **The `trust_signals` / `attestations` shape** — pending the doc read (§5).
- **`tier` needs somewhere to persist per-agent policy**, which is `DOD-CONFIG-1` (❌). The column can land
  without it; the *policy* that reads it cannot.
- **The first-sighting prompt** — every unknown sender, or only after a first accepted session (§3).
- **Nothing here is launch work.** Two agents connect, talk and seal today. The columns land now only
  because the migration is cheap at one user and expensive at a thousand.

## Related Documents

- [[2026-07-08_inbound-state-matrix]] — the parent. Behaviour; this is its data model.
- [[M8C-MONIKER-SPEC]] — §11 the pubkey anchor, §13 Option C and its live evidence.
- [[M8C-DEFINITION-OF-DONE]] — `DOD-CONTACT-1` (the whitelist this extends), `DOD-CONFIG-1`, `DOD-PORTAB-1`.
- [[M8C-DECISIONS]] — CC-1, the deliberate-trust boundary `MONIKER-2` AC3 preserves.
