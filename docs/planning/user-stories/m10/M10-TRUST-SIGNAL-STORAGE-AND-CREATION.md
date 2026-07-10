---
name: m10-trust-signal-storage-and-creation
type: design
date: 2026-07-10
topics: [m10, trust-signals, storage, hashing, canonical-cbor, endorsement-mother, dumb-directory, scan-before-hash, supersession, extensibility, provenance, psi]
status: active
description: >
  HOW trust signals are stored, created, hashed, scanned, and verified across the three parties
  (directory / holder / recipient). The taxonomy says WHAT the signals are; this says how they live.
  Core decisions: a dumb directory that only matches hashes; a generic content-addressed envelope where
  the signal TYPE is data not schema; scan-before-hash at a per-node creation chokepoint ("Endorsement
  Mother"); canonical CBOR as the hashed form; supersede-never-mutate for renewal.
---

# M10 — Trust Signal Storage & Creation

> **Parent:** [[M10-TRUST-SIGNAL-TAXONOMY]] is the source of truth for *what* the signals are (the four
> classes, the type list). **This document is *how* they are stored, created, and verified.** It does not
> restate the taxonomy. The frontend/portal and M8 journey docs are scaffold, **not** authoritative —
> where they disagree, they are corrected to match M10.

## 0. Decided vs open

**Decided (this design session, 2026-07-10):**
- The **directory is dumb** — it matches hashes and nothing else (§2). Hash-only, directory-mediated:
  the earlier signed-vs-hash-only fork is **resolved in favour of hash-only**.
- A **generic content-addressed envelope** where the signal *type* is data, not schema (§3).
- **Scan before hash**, at a creation chokepoint, per-node, deterministic (§6, §7).
- Portal composes portal-issued + agent-issued signals; the directory self-issues directory-issued (§6).
- **Canonical CBOR** is the hashed form; JSON is a display/LLM projection only (§5).
- **Supersede, never mutate** for renewal/override (§3).
- **No single score, ever** — inherited hard rule from the taxonomy. Tier is not a signal.
- **Agent-scoped, not daemon-level** — a signal shared with one agent is invisible to co-resident
  agents; cross-agent trust propagates only by explicit endorsement + PSI (§10).
- **The recipient does not persist the subject's signals** — it holds the *relationship*; the subject
  holds its own reputation and re-presents the current set each time (§9). The recipient-side
  `trust_signals` table is an **optional cache**, never source of truth.
- **Tier never auto-downgrades** — signals inform tier decisions; a revoked signal that earned a tier
  surfaces a *review prompt*, it does not silently change the tier (§9).
- **PSI is client-side, two-party, directory-relayed** (§11) — a round-2 negotiation item (not a round),
  one-sided output, the asker learns *which* contacts vouched, set-size is an accepted leak, terms are
  protocol constants never per-session negotiated.

**Open (flagged, not decided):**
1. Does the **recipient re-scan**, or fully trust the creation-time scan? (§8) — leaning: trust it;
   optional pass/block re-scan as cheap defence-in-depth.
2. Which classes **persist vs mint-on-request**? Class 3 (track record) is directory-computed and may
   never be stored client-side (§6).
3. The exact **"suspect" consequence** policy for a rejected endorsement submission (§7).

**Plus the full gap register in §14** — reviewed 2026-07-10; items 14.1–14.3 must be resolved before
any M10 story YAML is written.

---

## 1. Three storage locations

| location | holds | its job |
| :-- | :-- | :-- |
| **Directory** | the **hash** + mutable status (`revoked?`, `revoked_at`) | the **notary**: "this hash is a real signal about X, not revoked" — never the content, persisted |
| **Holder** (local SQLCipher) | the plaintext blob + hash + issuer + expiry | your **wallet**: what you can present |
| **Recipient** (local SQLCipher, in *their* contact row for you) | the plaintext you presented + hash + **`verified_at`** | **evidence**, re-checkable |

The recipient cell is why this milestone sits on the address-book work: a received signal is a
`trust_signals` row FK'd to the recipient's contact record for the subject — which is exactly why that
table must key on `agent_id` ([[2026-07-10_agent-id-joinkey]]) and be born on the address-book schema
([[2026-07-10_contact-address-book-design]]).

---

## 2. The dumb directory — two checks, no logic

At introduction, the sharing agent forwards its trust signals as `{ hash, blob }` pairs. For each, the
directory does exactly two mechanical checks:

1. `hash(blob the agent forwarded) == hash the agent claims`?
2. `that hash ∈ what the directory stored for this subject`, and not revoked?

Both pass → the introduction carries the signal. **No signature verification, no content evaluation, no
schema knowledge.** The directory matches bytes. All intelligence lives at *creation* (§6); the directory
only remembers hashes.

**This resolves the signed-vs-hash-only fork toward hash-only, directory-mediated.** Authenticity is not
an offline signature the recipient checks — it is *"this hash is in the directory,"* and the only way a
hash gets into the directory is through the scanned creation chokepoint. **Notarized ⇒ scanned-clean at
birth.** Issuer authenticity (that `issuer = Bob` is really Bob) comes from the creation chokepoint
authenticating the submitter, carried forward by the hash — no separate signature needed.

**Conscious tradeoff:** the directory **sees the blob transiently** at introduction (it must, to hash it).
It *persists* only hashes — PII-free storage holds — but it is **not content-blind** in the moment. The
blind alternative (peer-to-peer + issuer signatures + directory answers yes/no on a hash) buys blindness
at the cost of exactly the verification logic we are keeping out of the directory. Simplicity wins here,
deliberately. If blindness later becomes a hard requirement, that is the fork to reopen.

---

## 3. The generic envelope — type is data, not schema

Extensibility, flexibility, retirement, and renewal all break if a signal type is a column, a DB-enforced
enum, or a table-per-type — because then every new or altered signal is a migration on every operator's
SQLCipher disk (the unrecoverable-migration problem). So the storage layer holds a **generic
content-addressed envelope** and treats the signal content as an opaque typed blob it never reads:

```
trust_signals(
  signal_hash      PK,      -- content address = hash(canonical envelope); renewal = new hash = new row
  subject          <agent_id / pubkey>,
  issuer_kind      TEXT,    -- portal | directory | agent          (the three types, as DATA)
  issuer_pubkey    TEXT,
  type             TEXT,    -- 'linkedin' | 'endorsement' | 'connection_bond' | …   (DATA, not schema)
  schema_version   INT,     -- payload shape version
  payload          BLOB,    -- canonical, opaque to storage, interpreted by (type, version)
  issued_at, expires_at,
  supersedes_hash  TEXT,    -- prior version this renews
  status           TEXT     -- active | superseded | revoked | expired   (mutable; see §4)
)
```

- **Extensibility** — a new type or class is a new *string* plus client code to read its payload. Zero
  schema migration. A whole new Class 5 adds no columns.
- **Flexibility** — `schema_version`. A `linkedin` payload evolves `{age}` → `{age, connections}` at v2;
  v1 signals still verify because their hash is over *their* bytes. **Never re-interpret old bytes under a
  new schema — introduce a version.** Append-only at the type level.
- **Retirement** — a **type registry** (code- or directory-level), *not* the row schema, marks a type
  `active | deprecated | retired`. Existing instances still verify; recipients down-weight retired types.
- **Renewal / override** — **supersession, never mutation.** You do not edit the 1-year signal to say 3
  years; its hash and signature are over the old value and the directory holds the old hash. You issue a
  new signal carrying `supersedes_hash`; the old goes `status = superseded`. The "logical signal" is a
  chain of content-addressed versions, newest-active — the same shape as the moniker rename and
  endorsement revocation. The recipient learns of the update through freshness re-check (§8), not a push.

> 🚧 **GUARDRAIL (the smell we fight everywhere).** The opaque payload means SQL cannot query *into* a
> signal (`WHERE linkedin.age > 2y` is impossible). That is intended — evaluation is application-layer,
> per type. Someone will want to "optimize" by hoisting a payload field into a real column. **Forbidden.**
> It re-hardcodes the type into the schema and destroys every extensibility property above — the exact
> `agent_name`-as-join-key mistake ([[2026-07-10_agent-id-joinkey]]). The type stays in the payload.

---

## 4. What goes in the hash — the mandatory-disclosure set

**Whatever is in the hash, the sharer is compelled to disclose truthfully** — a hashed field cannot be
omitted or altered at share time without breaking the match. So the hash preimage *is* the mandatory
disclosure set. The generative rule: **hash what the issuer commits to at birth and can never change;
leave out everything that changes after.**

**IN the hash (the immutable claim — all compelled on share):**
- **subject** — the single most important field. Without it, a signal about Alice can be presented as
  being about Bob (transplant). Binding subject into the hash is the transplant defence.
- **issuer_pubkey** + **issuer_kind** — binds the signal to its author; forging "the portal issued this"
  becomes impossible.
- **type**, **schema_version** — you cannot present a `linkedin` blob as an `endorsement`, or reinterpret
  v1 bytes as v2.
- **payload** — the claim itself.
- **issued_at** — the disclosure-forcing example: out of the hash, a sharer hides a stale signal's age;
  in it, they cannot.
- **expires_at** — the issuer's committed validity window.
- **supersedes_hash** — so a renewal's "this replaces H_prev" cannot be forged.

**OUT of the hash:**
- **status / revocation** — the one field everyone *wants* in the hash and categorically cannot have,
  because it is **mutable**. And that single mutable field is **the entire reason the directory exists**:
  it is the mutable-status oracle for otherwise-immutable objects. Everything else the sharer proves
  themselves; only "is this still good *right now*" needs the notary.
- **class** — deliberately out, for flexibility. Derive it from `type` via the registry; hashing it would
  freeze the classification and a future reclassification would invalidate every old signal.
- **local `verified_at`** — the recipient's freshness bookmark, purely local.

The hash is a **birth certificate**: immutable, maximal on the claim, compelling full disclosure of it.
The only things left out are what changes over the signal's life (revocation) and what is local.

---

## 5. Canonical CBOR — the load-bearing detail

Four parties re-hash the blob and must agree **byte-for-byte**: the issuer at creation, the directory at
storage and at each introduction, the gateway when it verifies (§8), and the recipient at verification.
**Naive JSON will not reproduce a hash** — key order, whitespace, number formatting (`1` vs `1.0`),
Unicode normalization, and integer-vs-string all differ across languages and libraries, and the hash
silently fails to match.

- The **hashed/signed form is canonical CBOR** (deterministic map ordering, defined number encoding) —
  the protocol already uses CBOR for its frames.
- **JSON is a lossy display projection** derived from the canonical form, used to hand the signal to an
  LLM to reason over (something it works with natively). It is never hashed.

Pick this now. Retrofitting a canonical form after signals are in the wild breaks every existing hash.

---

## 6. Creation — scan BEFORE hash

The scan-vs-hash collision (a scanner that alters flagged content breaks the hash) exists only if you scan
*after* hashing. **Scan at creation, before the hash exists**, and the collision vanishes: the scanner is
free to reject or pass, and only clean content is ever hashed. There is no hash to break because there is
no hash yet.

The three issuer flows:
- **Portal-issued** (Class 1 OAuth/identity, Class 4 economic) — the portal (via its portal agent)
  verifies the underlying fact, composes the plaintext, scans it, and on pass hashes it and stores the
  hash in the directory. Structured payloads, low injection surface.
- **Agent-issued** (Class 2 endorsements) — free text authored by another operator. The one genuine
  injection surface. Goes through the endorsement-intake chokepoint (§7) at creation.
- **Directory-issued** (Class 3 track record) — the carve-out to "the portal composes everything." The
  directory computes these from history it already holds and **self-notarizes** them; no free text, no
  scan, and possibly **no client-side persistence** (mint-on-request — open decision §0.2). Confirm the
  intended split.

---

## 7. Endorsement Mother — the endorsement-intake role

BotFather-shaped, but corrected for a federated system. The concrete instantiation of the creation
chokepoint for agent-issued endorsements.

**Flow.** Bob writes an endorsement *for Alice* and connects to the endorsement-intake role: *"here is my
endorsement for pubkey X."* The role runs it through the deterministic scanner. On pass → hash it,
notarize the hash in the directory keyed to **Alice's** pubkey, and deliver the plaintext blob to
**Alice** (the subject holds and later presents it — Bob's role ends at submission). On fail → reject,
and (graduated, see below) flag the submitter.

**The submitter-accountability incentive is the load-bearing mechanism.** Submitting garbage costs *the
endorser* reputation, not the target — so the rational move is never to submit injection, and the scanner
defends against carelessness, not a flood. The incentive is self-aligning: a bad endorsement harms its
author, so there is no "poison my enemy by endorsing them badly" attack.

**No LLM.** The intake role runs the *deterministic* scanner suite (injection patterns, secrets, charset,
length, URL handling), consistent with the shipped scanner being rule-based (LLM moderation is Day-2).
Bytes in, pass/reject out.

**Three constraints (accepted 2026-07-10):**
1. **Per-node role, NOT a singleton.** A single Endorsement Mother is a central censor and a single point
   of failure — it contradicts the sovereign-node invariant. Make endorsement-intake a **standard role
   every directory node runs**; an endorser routes to any node; all behave identically. Keep the name for
   the *capability*, not one identity.
2. **Versioned, byte-identical deterministic scanner across nodes.** Otherwise the same endorsement passes
   at node A and fails at node B — a correctness bug *and* a censorship-by-node-shopping surface. The
   scanner is a versioned shared component; a node's scanner version travels with its decision. Same
   family of constraint as §5's canonical encoding.
3. **Graduated suspect-flag, above the reject threshold.** A deterministic scanner has false positives.
   *Reject always* (fail-closed, correct), but *flag as suspect only on a pattern* — repeated rejects, or
   an egregious single hit (a real credential, a clear injection payload) — never on one heuristic
   near-miss. A reputational penalty on a false positive is a real harm; keep the two consequences on
   different thresholds.

**What it scans for:** injection patterns (primary), secrets, a constrained charset (a sentence — broader
than `MONIKER_RE`, but no control chars, no markup), a length cap, and URL handling (a link in an
endorsement is a phishing/exfil vector — sanitize or forbid).

---

## 8. Surviving the gateway

Because trust signals are hash-anchored, the gateway's normal *surgical redaction* is **incoherent** —
any edit breaks the hash, so redact and block collapse to the same outcome. Trust signals are therefore
**screened in pass/block mode only, never altered.** They are not exempt from screening; the surgical
tool is simply meaningless, so the only remediation is exclusion.

- **Machine-issued (portal, directory): provenance replaces the scan.** A hash matching a non-revoked
  directory record is a *cryptographic proof* that a trusted issuer produced these exact bytes — strictly
  stronger than the heuristic guess a content scan makes. No content re-scan needed.
- **Agent-issued (endorsements): scanned at creation** (§7), so a validly-hashed endorsement was already
  scanned clean. The **recipient re-scan is optional defence-in-depth** (pass/block only) — open decision
  §0.1. Leaning: trust the creation scan; allow an optional recipient pass/block gate, but it is not
  load-bearing.

**Delivery invariant:** a trust signal reaches the consuming LLM only after its gate(s) pass, and **byte-
for-byte or not at all** — no partial, no cleaned delivery. That preserves the hash *and* the screening
guarantee simultaneously, which is only possible *because* the verdict is binary. The JSON projection
handed to the LLM frames each agent-issued claim as an untrusted, quoted third-party statement
("Bob says: …"), never as instruction — the charset + framing are the real injection defence, the scanner
is the weakest of the three layers.

---

## 9. Flows — four scenarios collapse to one

Trust-sharing has an obvious set of cases: first contact; a known contact sharing more; an *updated*
signal (supersession); a *new* signal on an existing agent. **From the recipient's side they are one
operation** — "evaluate the initiator's current full set against my policy" — because of one decision:
**the recipient does not remember what a subject showed it last time.** The distinctions are real, but
they live on the *subject's* side (what they've accumulated) or in the recipient's *existing
relationship* (does it already have a tier for this pubkey), never in the sharing mechanics.

**Why this is right, not just simple:** *your trust signals are yours to carry, not others' to hoard.*
If every recipient stored copies of your set, your reputation would scatter across everyone's databases —
stale copies everywhere, and a disclosure leak (whoever you showed can dump what you revealed). Instead:

- **Subject (Alice)** holds her own signals — her wallet, the stateful holder.
- **Recipient (Bob)** holds the **relationship** — the contact row (tier, moniker, met-how, last-seen),
  optionally a cached *verdict* ("as of last session Alice cleared my known-tier bar") with a freshness
  stamp — **never the signal data, and never relied upon.** The default flow works with zero cache.

This is the moniker principle inverted: your name for a contact is yours; their reputation is theirs.

| case | what the recipient does |
| :-- | :-- |
| **First contact + signals** | Unknown subject presents its set; recipient evaluates against its *unknown-sender* policy. Accept → unknown→known, contact row created. Reject, or a second round ("also provide X?"). |
| **First contact, shares nothing** | No-signals policy applies → typically reject for an unknown. Sharing is *selective disclosure*: share all, some, or none; the recipient's policy may demand specific signals — that is the second round. |
| **Known contact, new/added signals** | Current full set is richer; the recipient already has a tier. New signals matter only for *elevation* (known→whitelisted) — otherwise informational. |
| **Updated signal (supersession)** | The current version is presented; with no persistence there is no "it updated" event and none is needed. The old hash is superseded at the directory; a stale copy fails freshness. |

**Two edge cases this handles cleanly, one it does not:**

- **Omitted / dropped signal — handled, no history needed.** If the recipient's policy requires signal X
  and the subject doesn't present it, they fail — whether they never had it or dropped it is irrelevant.
  **Policy-on-current-set is robust to omission without remembering anything.**
- **Selective disclosure — a feature.** A subject doesn't dump its full identity on every stranger; a
  demanding recipient triggers the two-round negotiation. Both sides have agency.
- **Tier staleness — the one it does not handle.** If a signal that earned `whitelisted` is later
  revoked, the tier is now based on something that no longer holds — but **tier is the operator's
  sacrosanct decision and must not auto-downgrade** (same rule as the moniker). Resolution: signals
  *inform* tier decisions but never change them; a revocation of a signal a contact was elevated on
  **surfaces a review prompt** ("the signal you whitelisted Alice on was revoked — review?"). Same shape
  as the rename notice — the system tells you, you decide. Auto-downgrade would let a third party
  (whoever revokes) silently mutate your address book.

---

## 10. Scoping — agent-unique, never daemon-level

**Q: same daemon, multiple agents (Ms_Chelly, Alice). Bob shares signals with Ms_Chelly. Can Alice see or
benefit from them?** **A: no — agent-scoped.** Bob shared with Ms_Chelly's *identity*; the disclosure and
everything Ms_Chelly derives from it belong to Ms_Chelly's agent, not the daemon and not Alice. Three
reasons, all pointing the same way:

1. **Consent.** Bob's share was *selective disclosure to Ms_Chelly* — he may show his LinkedIn to a
   professional contact and withhold it from a personal one. Alice seeing it violates Bob's per-recipient
   choice. He disclosed to an agent, not a machine.
2. **Sovereign-identity no-bleed — literally the `agent_id` bug one layer up.** Ms_Chelly and Alice are
   distinct pubkey identities that merely co-reside. Alice benefiting is *one identity reading another's
   social graph through shared daemon storage* — the same anti-pattern as the retire-reuse history bleed
   we rebuilt seven tables to kill ([[2026-07-10_agent-id-joinkey]]).
3. **Deliberate separation.** Co-resident agents are different personas *on purpose*; merging their trust
   knowledge defeats the reason they are two agents.

**The legitimate "let Alice benefit" want is delivered explicitly, through the trust system itself, not
through storage bleed.** Ms_Chelly *endorses* Bob (a Class 2 agent-issued signal); when Bob later connects
to Alice, PSI reveals that Bob's endorsers overlap with Alice's contacts — namely Ms_Chelly. **The
network-graph class IS the cross-agent trust channel.** Trust propagates by explicit vouching, never by
shared storage — and the architecture already has that consent-respecting channel, which is exactly why
the leaky one is unnecessary.

- **The schema enforces this for free:** the recipient-side `trust_signals` cache FKs to a *per-agent*
  contact row keyed on `agent_id`, so a query scoped by Alice's `agent_id` structurally cannot see
  Ms_Chelly's contacts or their signals. The join-key fix is the enforcement mechanism, not just a
  correctness fix.
- **Security bonus:** agent-scoping *contains the blast radius* — a compromised Ms_Chelly exposes
  Ms_Chelly's trust graph, not Alice's. Daemon-level would make one compromised agent a window into every
  co-resident agent's relationships, the fattest target on the machine.

---

## 11. PSI — the network-graph exchange (Class 2)

The endorsement-overlap signal: compute `{subject's endorsers} ∩ {evaluator's contacts}` — *"how many
people I already trust vouch for you, and which"* — without either party revealing their full social
graph. See [[M10-TRUST-SIGNAL-TAXONOMY]] Class 2. This section fixes the semantics and policy; the concrete
cryptographic construction is still to be chosen (see the end).

### Where it runs — client-side, two-party, never the directory

- **Both clients, peer-to-peer.** PSI is a two-party computation *by definition* — there is no version
  where one side does it alone; half the input is the other party's set, in locked form.
- **The directory NEVER computes it.** To compute an intersection you need both sets; a directory that
  touched both social graphs — even ephemerally, even discarding after — *is* the surveillance layer the
  project rejects, and running a set computation violates `INV-DIR-DUMB`. Ephemerality does not rescue it:
  *seeing* the graphs is the violation.
- **The directory brokers + dumb-relays**, over the **existing handshake path** (no new transport). It sees
  locked blobs (ciphertext) and metadata — that a PSI happened, and set sizes (it can count blobs) — but
  **never the graphs, and stores nothing.** PSI is even more hands-off than a static signal: no hash to
  check, pure pipe.
- **Pre-session.** Runs during the brokered introduction; its result gates whether the full session forms.

### The handshake — PSI is a round-2 ITEM, not a round

The two-round budget (§9) counts **negotiation turns, not messages.**
- Round 1: initiator offers signals. Round 2: the receiver sends a **bundle** of demands
  (e.g. *"profile URL + signal X + run the endorser PSI"*); the initiator satisfies the bundle.
- PSI's own multi-message crypto exchange runs **underneath** round 2, as transport — it does **not**
  consume a negotiation round. Consent is a round-2 list item: the receiver proposes PSI, the initiator
  agrees or declines in the same response.
- **Front-loaded / one-shot.** With no round 3, the receiver declares every demand up front and cannot see
  the PSI result and *then* re-demand. This is itself an anti-probing defence.

### Fixed terms — protocol constants, NEVER per-session negotiable

(Negotiating terms per exchange would need a round to converge, spilling past two — so they are global.)
- **One-sided output.** Only the evaluator (the asker, holding contacts) learns the result. The subject
  (holding endorsers) learns nothing about the evaluator's contacts.
- **Granularity = WHICH.** The evaluator learns *which* of their own contacts vouched — their own contacts,
  no leak to them beyond the fact of the vouch. The subject's **non-matching** endorsers are never revealed.
- **Set-size = accepted leak.** The evaluator learns the subject's total endorser count (blobs are
  countable). **Not padded** — the count is itself a trust signal (more endorsers ≈ more vouched-for), so
  the disclosure is justified. The same count is visible to the directory-relay; accepted.

### Policy — who agrees to run PSI (deterministic floor + LLM discretion)

The agree/decline decision is **security-sensitive** — probing, DoS, and the counterparty's endorsement
free-text is an injection surface. So:
- **Deterministic code floor, non-negotiable:** rate-limit PSI per counterparty (anti-probing), tier gates,
  set-size caps. An LLM is manipulable; it must not be able to loosen these.
- **LLM / config discretion layers on top and may only make the decision MORE restrictive** — decline where
  code allows, never bypass the floor. Same shape as `INV-TIER-BOUND`.

### Probing defence (the killer attack)

Repeated or colluding PSI runs reconstruct the subject's endorser set one intersection at a time. Defences,
all deterministic: **rate-limit per counterparty**, the **two-round front-loading** (one shot, no adaptive
re-demand), and **cache the result** so a repeat ask returns the same answer, not a fresh leak.

### Still open

The concrete **PSI construction** (DH-based, OT-based, …) is unchosen. The technique is real and deployed
(private contact discovery, breach checking), and this section fixes what it must *deliver*; a specific
protocol with its performance/leakage/malicious-party tradeoffs must be selected before build.

---

## 12. Invariants

- **INV-DIR-DUMB** — the directory performs only the two hash checks (§2). Any content evaluation,
  signature logic, or schema knowledge added to the directory is a violation.
- **INV-HASH-WRITE-CHOKEPOINT** — a hash enters the directory's store **only** through a scanned creation
  chokepoint (portal agent / endorsement-intake role) or the directory's own computation. If any agent
  can self-insert a hash, "notarized ⇒ scanned" collapses and an attacker notarizes un-scanned injection.
- **INV-SUPERSEDE-NOT-MUTATE** — a signal is never edited in place; a changed fact is a new
  content-addressed signal that supersedes the old (§3).
- **INV-CANONICAL** — everything hashed is canonical CBOR; every party re-serializes identically (§5).
- **INV-RECEIPT-FRESH** — a recipient's stored signal is a point-in-time receipt; freshness (revocation,
  supersession) is re-checked on use, never trusted from cache indefinitely.
- **INV-NO-SCORE** — signals are independent and named; never collapsed into a score/level/rank.
- **INV-AGENT-SCOPED** — a signal shared with one agent is invisible to co-resident agents; the only
  cross-agent trust channel is explicit endorsement + PSI (§10). Enforced by the per-agent (`agent_id`)
  `trust_signals` FK.
- **INV-RECIPIENT-STATELESS** — the recipient holds the *relationship*, not the subject's signals; any
  stored signal is an optional, freshness-re-checked cache, never source of truth (§9).
- **INV-PSI-CLIENT-SIDE** — PSI computes on the two clients; the directory brokers/relays only, never
  computes, never sees the graphs (§11). A directory that participates in the set computation is a
  violation.
- **INV-PSI-FIXED-TERMS** — PSI's disclosure terms (one-sided, which-granularity, set-size-accepted) are
  protocol constants, never negotiated per session — negotiating them would break the two-round budget
  (§11).

---

## 13. Cross-milestone dependencies

- **Address book + `agent_id` join key.** The `trust_signals` table FKs to the recipient's contact row;
  it must be born on `agent_id` and on the address-book schema. **M10 storage cannot be designed until
  [[2026-07-10_agent-id-joinkey]] lands and [[2026-07-10_contact-address-book-design]]'s tables exist.**
- **M9 gateway.** If recipient re-scan is adopted, the gateway needs a **no-redact, pass/block** verdict
  mode for hash-anchored content (M9-FEED-001 today is redact/allow/block/warn). Flag in both milestones.
- **PSI** (Class 2 endorsement intersection) is now designed here — see §11 (semantics + policy). The
  concrete cryptographic construction remains to be chosen.

## 14. Known gaps — logged 2026-07-10, decisions still owed

A design-review pass against the full signal lifecycle found these undecided. **14.1–14.3 are
blocking: resolve before any M10 story YAML is written.** The rest can be resolved during story
writing, but each needs an explicit decision — none may be silently defaulted.

### Blocking

- **14.1 — Federation: this doc pretends "the directory" is one thing.** §2, §7, and
  `INV-HASH-WRITE-CHOKEPOINT` all speak of a singular directory, but CELLO is a T-of-N
  sovereign-node system. Undecided: where a hash is notarized (one node or quorum), and how
  hash + mutable status replicate across nodes. Critically, the chokepoint invariant **collapses
  under the federation threat model** — a single compromised node can skip its scanner and insert
  un-scanned hashes, killing "notarized ⇒ scanned-clean." Either notarization needs T-of-N
  attestation, or the invariant must be honestly weakened to "scanned by the accepting node."
- **14.2 — The revocation write path.** Mutable status is the entire reason the directory exists
  (§4), yet how status *changes* is undesigned. Who may revoke which signal — issuer, subject,
  both? Authenticated how? (There are no signatures in this design: creation-time authentication
  carries the hash in, but revocation is a **later** write by someone claiming to be the issuer.)
  And how does a revocation propagate across nodes (couples to 14.1)?
- **14.3 — Class 2 presentation vs PSI: a live tension, not just a gap.** §2 says signals travel
  as `{hash, blob}` pairs; an endorsement blob contains `issuer_pubkey`, so presenting it directly
  reveals the endorser. §11's PSI exists precisely so non-matching endorsers are never revealed.
  Decide: do endorsements travel **only** through PSI, or may they also be presented as plain
  blobs? If both paths exist, PSI's privacy guarantee is decorative.

### Must be decided during story writing

- **14.4 — The recipient's policy layer.** §9 leans on "evaluate against my policy" throughout,
  but the policy is undesigned: the `SignalRequirementPolicy` shape, the round-2 demand-bundle
  format, and who evaluates — deterministic code, LLM, or the floor+discretion split §11 uses for
  PSI. Without this, the four flows in §9 cannot actually run.
- **14.5 — Chokepoint enforcement mechanics.** What *technically* stops an agent from calling the
  directory's write API directly? The invariant names the rule; the auth model (capability,
  allowlisted issuer keys, portal-only route?) is unchosen.
- **14.6 — Subject key rotation / succession.** `subject` is hash-bound to a pubkey; rotate or
  succeed the key and every signal is about the old identity. Re-issue everything, or a succession
  link the recipient follows? Reconcile with the succession doc's rule that Class 1/2 do not
  transfer.
- **14.7 — Freshness semantics under node failure.** `INV-RECEIPT-FRESH` says "re-checked on use"
  with no cadence defined (per session? TTL?), and no behaviour defined when the directory is
  unreachable: fail-open contradicts the invariant, fail-closed contradicts availability-as-
  first-class. Needs an explicit call.
- **14.8 — Type registry governance + first payload schemas.** The registry carries retirement
  and class derivation (§3, §4) but has no home — code, directory, or protocol constant? Who
  admits a new type? And no v1 payload is defined for even the launch types (`linkedin`,
  `endorsement`, `connection_bond`).
- **14.9 — Wallet loss / backup.** The holder's plaintext blobs exist nowhere else — the directory
  has only hashes. Lose the SQLCipher DB, lose your reputation. Is `trust_signals` in the existing
  backup/restore path, and is that acceptable as the *only* recovery story?
- **14.10 — Smaller but real.** Per-type validity windows and who re-verifies at expiry (re-run
  OAuth?); whether Class 3 source data actually exists directory-side to compute from (seal
  records — probably yes, verify); backfilling the four already-live M8 signals (WebAuthn / TOTP /
  phone / email) into envelopes; concrete rate limits for the endorsement-intake role; and stating
  out loud that a subject can silently discard unflattering endorsements (believed yes by design —
  selective disclosure — which means all presented signals are effectively positive-only).

---

## Related Documents

- [[M10-TRUST-SIGNAL-TAXONOMY]] — parent; *what* the signals are (source of truth).
- [[2026-07-10_contact-address-book-design]] — the `trust_signals` table's home; issuer types, the
  directory-is-notary shape.
- [[2026-07-10_agent-id-joinkey]] — the join-key fix this storage is born on top of.
- `.claude/CLAUDE.md` — "join on the stable key" and the no-`node:sqlite` rules that govern the schema.
