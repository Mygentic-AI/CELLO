---
name: Agent Identity, Lifecycle & Discovery Model
type: discussion
date: 2026-06-25
topics: [identity, account, key-rotation, succession, agent-removal, revocation, discovery, pseudonyms, petnames, connection-policy, anti-surveillance]
status: design-settled-in-principle
description: >
  The model for what an agent identity IS, how its name relates to it, how keys rotate, what
  it means to remove/retire an agent (without enabling evidence destruction), and how peers
  discover each other without building a surveillance graph. Developed alongside the M8 portal
  design session; cross-references its account-control model, auth journey, and M10 connection
  policy. Design discussion only — no pseudocode.
---

# Agent Identity, Lifecycle & Discovery Model

## 1. Context — how we got here

This started as verification, not design. We were testing the M7 persistence + onboarding work end
to end: a brand-new operator (Andre) walked through the published client — install → `cello login`
→ `cello status` → `cello create-agent Ms_Chelly` → token from the Telegram ops-agent → `cello
register Ms_Chelly`. Registration succeeded (agent_id `04faa2a5…`, primary_pubkey `38411853…`), and
we went to confirm it landed correctly.

Locally it had everything (K_local seed, FROST signing share, ML-DSA keys, registration record,
agent↔user link). In the directory, us-east-1 had her profile **and** the server-side FROST share —
the DKG completed. But the cross-region check showed her profile on us-east-1 only; eu-central-1 and
ap-northeast-1 had nothing. That pulled us into a logical-replication incident *(root cause and
repair recorded in `infra/STATE.md` and memory — a directory wipe done with piecemeal `TRUNCATE`s
wedged all six subscriptions via `pubtruncate`; not re-documented here)*.

The replication fix restored forward flow but did not back-fill Ms_Chelly's rows. The natural next
question — "re-register her" — exposed the real gap this log addresses:

- You cannot re-register the same name with a new key (the directory enforces `UNIQUE(k_local_pubkey)`,
  the token is single-use, and the client reports `already_registered`).
- There is no way to delete or retire an agent (no CLI command, no MCP tool, no daemon handler).
- The name is a local-only label that the directory never stores.

In other words: **CELLO has no agent identity-lifecycle model.** That is what we designed.

This was developed in parallel with the **M8 portal-design session**, which independently settled an
account-control model, an auth journey, and an M10 connection-policy model. Those threads slot
together; §7 maps the seams.

---

## 2. The core model — four layers

Four distinct things, four jobs. What each is, where it lives, who can see it.

**Account — who owns the agents (private).** One per operator (`account_id`; tied to hashed
phone/email from registration). Never advertised, never discovered. Its only job is ownership and
control: it is what the operator authenticates as (portal magic-link / WebAuthn — M8 Journey 01) to
create, rotate, or retire agents. It is the private root of authority, not an identity others
interact with.

**Agent — the thing others talk to (key-based).** Each agent is a keypair. The private half
(`k_local` seed) never leaves the operator's machine. Two public values matter: `k_local_pubkey`
(the base key) and **`primary_pubkey`** (the FROST group key from the registration DKG). The
`primary_pubkey` is the **load-bearing public identity** — when a counterparty "trusts Ms_Chelly,"
they trust this key, because a signature under it requires *both* the client's share *and* a
**threshold of the directory nodes' shares** (T-of-N across sovereign nodes — see the threshold-model
note in §5). Neither side can forge it alone; that split is the whole CELLO guarantee. The directory
stores the binding `account ↔ k_local_pubkey ↔ primary_pubkey ↔ agent_id` but **no human name**. The
key is shareable and verifiable, but it is not in any browsable list — you resolve an agent you
already hold a key for, you do not search for one.

**Petname — your local label for someone else's key (local only).** A petname is a label *you*
author, on *your* machine, mapping a key → a name meaningful to you. It lives only in the local store;
it is never in the directory. You *can* share it, but only as a *hint* inside an introduction: when
you introduce Bob's agent to Carol, you hand Carol Bob's **key** plus your suggested label; Carol
keeps it, renames it, or ignores it. The key is what is authoritative and what travels; the name
rides along as a convenience and is never looked up.

**Public bio / discovery portal — opt-in public presentation (separate from the key).** For an agent
whose owner *wants* to be found by strangers (a business advertising, a commerce agent), the owner
opts in to publish a public bio: a human-readable profile that points to the agent's key. It is a
separate layer on top of the key, never the key itself, and it is opt-in — private agents (the
default) appear in no list anywhere; only deliberately-published agents show up.

**Governing principle: name ≠ identity.** The key is the identity; names and bios are disposable
labels on top. Every surviving prior-art system enforces this (§6).

**What you share.** You share the agent's **public key** (`primary_pubkey`), optionally with a
*suggested* name. You do not share the account (that links all your agents and exposes who controls
them), and you do not need `agent_id` (an opaque directory handle that, alone, forces the recipient
to trust the directory's mapping — the key skips that trust) or the petname (yours, local). The
analogy is a phone number, but self-authenticating: routing and proof fused, no trusted middleman.
Because `primary_pubkey` is a 64-character hex string, in practice it is shared *as a carrier* (QR
code, contact link, or a friendly handle that resolves to it) — but the payload is always the key.

---

## 3. Identity ⇄ name decoupling — decisions

- **DECIDED:** the **account is the anchor**; the key is a rotatable credential under it. (Consistent
  with the M8 account-control model: the account is a directory-side identity grouping of agents.)
- **DECIDED:** **names stay local** (the petname model); they are *not* stored in the directory. This
  is precisely what keeps the directory from becoming a who-knows-whom map.
- The local↔directory split, stated plainly: the directory's job is *given a key, verify it and route
  to it* — it works in keys, not names. The *name→key* step happens off the directory: locally (your
  petnames), via an introduction (a trusted peer hands you a key + label), or via the opt-in bio.

---

## 4. Key rotation

- **DECIDED:** rotation is an **account-authorized re-key**, not a re-registration. A plain
  re-register with a new key would be a disconnected stranger (the directory has no name; it keys by
  the key) plus a stranded orphan profile — not continuity.
- **DECIDED:** the **`agent_id` stays the same** across rotations. "Succession" is a **key-epoch chain
  under the stable `agent_id`**: `primary_pubkey` P1 → P2 → …, each with an epoch number, timestamp,
  and the authority/reason for the transition.
- **DECIDED:** the directory keeps the **full key-epoch history** (append the new epoch, never
  overwrite the old) — for forensics and tamper-evidence. A sealed record made under P1 must remain
  resolvable to "P1, epoch 1, of agent_id X."
- **DECIDED:** **reputation binds to the stable `agent_id`**, not the rotating key — so a rotation
  does not reset accumulated reputation, and the epoch history lets anyone verify which key held that
  reputation at any moment. (Reconciles with the M8 "directory = identity facts + reputation
  accumulation.")
- **Why not root succession in the old key.** If continuity were "the old key signs the new key,"
  then a *stolen* key could sign a rotation to the attacker's key — a hostile takeover — and
  containing that would force new-`agent_id`-with-a-break semantics. Because the **account** authorizes
  rotation (the owner re-authenticates via the portal), a thief holding the old key cannot
  authenticate as the account, so cannot hijack the identity, and the `agent_id` can stay stable. The
  M8 Journey 01 strong-auth requirement (TOTP floor + WebAuthn) is exactly what makes this safe.
- Two reasons to rotate — routine hygiene and compromise recovery — both account-authorized.
- **Milestone:** M10 (succession).

---

## 5. Agent removal / retirement

- **DECIDED:** removal is **revocation, not erasure** — capability dies, accountability survives.

- **Threshold model (grounding).** The intended design is **T-of-N threshold signing across multiple
  sovereign directory nodes** — no single node is mandatory, and the threshold is specifically meant to
  survive node outages (the sovereign-node invariant in CLAUDE.md: security *and* redundancy). The
  current code's **2-of-2** (client + one directory node) is a **known, unfixed stopgap, not the design**
  (see [[2026-06-03_1200_frost-dkg-single-directory-gap|FROST DKG Single-Directory Gap]]). This section
  designs for T-of-N and treats 2-of-2 as a transient bug.

- **The three-position lever.** Under T-of-N no single node is mandatory, so the lever is **not** "one
  node refuses to co-sign." It is an **account-authorized, replicated revocation flag** (a
  suspended/tombstone fact) that **every sovereign node independently honors** by refusing to contribute
  its share. Since a signature needs a threshold of nodes and the honest ones all refuse, **no threshold
  forms** — the agent cannot sign. The property we care about still holds: this works **even when the
  operator's own device is the compromise**, because the block is **server-side across the federation,
  independent of the client share** (a thief with the laptop and the client share still cannot assemble a
  threshold).
  - **Pause** — set the replicated revocation flag; every node refuses its share; **reversible** (clear
    the flag); share material left intact. The lightweight "Not Me — pause."
  - **Retire** — orderly **drain** of in-flight sessions (stop accepting new ones, let existing ones
    finish sealing), then set the flag *and* **destroy the server-side share material across the
    federation** + tombstone (`reason=voluntary`).
  - **Burn** — instantly set the flag *and* **destroy the share material federation-wide** + tombstone
    (`reason=compromise`). The emergency "Not Me — kill."
  - The grounding moves from "single mandatory co-signer" (the 2-of-2 artifact) to **"a T-of-N
    federation honoring a replicated revocation."**

- **What "remove" means at the directory level**, decomposed: (1) set a **replicated revocation flag**
  that every node honors (pause) and/or **destroy the server-side share material federation-wide**
  (retire/burn) → freezes or kills the ability to assemble a threshold signature; (2) append a **signed
  tombstone** → peers reject *new* interactions (the directory is append-only and hash-chained, so this
  is a tombstone, never a row delete); (3) **preserve all history**.

- **The accountability constraint** (the load-bearing requirement Andre raised). You must not be able
  to "delete to hide guilt" — do something malicious, then delete the agent so an ephemeral inference
  finds nothing. The architecture already defeats this, and the design leans on it rather than
  reinventing it:
  - The damning evidence is not in the deleter's own store — it is the **sealed, tamper-proof records
    held by every counterparty**, which you cannot reach into. Self-deletion destroys none of it.
  - The directory tombstone keeps the identity binding (`agent_id ↔ primary_pubkey ↔ account`)
    resolvable forever, so an investigator can still answer "who was that key?"
  - The retirement is itself a **signed, timestamped, append-only event**, so "retired thirty seconds
    after the suspicious session" is a visible, non-repudiable signal, not a vanishing act.
  - **Rule:** burn kills *future capability*, never *past accountability*.

- **DECIDED:** retirement never blocks an in-flight or retrospective ephemeral inference; open matters
  against an agent survive every mode. Grace (the drain) is for finishing work, never for delaying
  accountability.

- **Execution path** (reconciles with the M8 "no central control plane"): the account **authorizes**
  (portal auth) → **every honest sovereign node executes** by honoring the replicated revocation flag
  (refusing its share), and burn additionally destroys share material federation-wide → the directory
  **records** the identity-fact change (epoch or tombstone, replicated). No central control plane is
  needed; it is an identity-layer authorization that every node independently enforces.

- **OPEN:** is the voluntary **retire** reversible during the drain, or one-way once requested?
  (Pause is reversible by definition; this is specifically about the drain-then-destroy path.)
- **OPEN (M8-owned scope):** which positions ship in the M8 Agents-list emergency lever vs later
  (M15?). **Scope note (T-of-N):** even **pause** is *not* free — it needs the replicated-flag plumbing
  (a revocation-flag table + a check in the ceremony/co-signing path + replication), so it is a
  contained addition, not a property that falls out of the threshold structure for nothing.

---

## 6. Discovery & pseudonyms

The problem: reach an agent you hold no key for, without creating squatting, impersonation, Sybil
attacks, or a who-talks-to-whom surveillance surface (the anti-surveillance value is the binding
constraint).

### Prior art (condensed; sources at the end)

- **Zooko's triangle** is not "solved" by anyone. Every system that claims to (Namecoin, ENS,
  Farcaster-onchain) pays by becoming a public, scrapable global registry — by construction the
  social-graph surveillance artifact CELLO exists to avoid. The only real escape is to **split the
  name into layers** so each layer needs only two of {human-meaningful, secure, decentralized}.
- **Petname systems** (Stiegler / Miller / Bryce) are that escape, and CELLO already *is* one: the
  key/account is the secure-global *pointer*, the local human label is the *petname*, and a signed
  introduction over an existing session is the *edge name*. The one missing piece is the
  introduction/vouching primitive.
- **AT Protocol / Bluesky**: handle = a domain you control, resolving to a stable DID; software always
  references the DID, the handle is portable presentation. Domain-control defeats squatting. Cost:
  domains are public and correlatable.
- **Nostr (NIP-05)**: `npub` key is the identity; `name@domain` is an optional, explicitly
  non-authoritative verification label. The lookup leaks who-looks-up-whom to the domain.
- **Signal usernames**: discoverable handles with an **OPRF / ZK, enumeration-resistant** lookup —
  someone who already knows your exact handle can resolve it, but the server cannot enumerate the
  namespace or see the plaintext queried. The existence proof that "look me up by a name" need not
  build a scrapable directory.
- **did:web / WebFinger / OIDC discovery**: the de-facto "domain → cryptographic doc" pattern; robust
  against squatting, but every variant leaks the lookup to the resolving server and treats identity
  as public.
- **Keybase**: proof-based identity tying a key to existing accounts — and a **survivorship lesson**:
  acquired by Zoom (2020), then orphaned. An identity system tied to one operator can strand every
  user. CELLO's sovereign-federated, account-anchored design is partly an answer to this.
- **Private contact discovery / unlinkable pseudonyms** (Signal SGX+ORAM, PSI/OPRF, anonymous
  credentials / BBS+): the primitives that let a directory answer a lookup without learning the query
  or building a graph, and that let one identity present context-specific, *unlinkable* pseudonyms.

Universal rule across the survivors: **the human name is never authoritative; the key is.**

### DECIDED — layered discovery model

- **Default: introductions** (signed edge names) — pure petname. A trusted agent vouches a key +
  nickname to you; the introducer is cryptographically accountable. Covers the dominant case — most
  agent-to-agent contact arrives through an existing trusted relationship.
- **Opt-in: oblivious exact-match handle** (Signal pattern) — for genuine cold-start (two parties who
  share a handle out-of-band but hold no key). Stored OPRF-hashed/ZK-verified, exact-match only,
  non-enumerable, directory blind to both namespace and query.
- **Niche opt-in: domain-anchored public handle** (Bluesky pattern) — for explicitly-public agents;
  resolves via DNS/`.well-known`, bypassing the directory entirely.
- **Public bio portal** = the opt-in public layer; Andre's first-principles design converged exactly
  with the prior art, because key-as-identity + opt-in-separate-layer is the only arrangement that is
  "findable when you want to be" without "surveillable when you don't."
- **Rejected:** any plaintext directory-held name registry.

### Discovery ⇄ connection-policy unification (the whitelisting link)

Discovery answers "how did they reach me," connection policy answers "do I accept them" — two halves
of one flow. The layers map 1:1 onto the M10 connection-policy review-handling classes:

- **introduced → "known / whitelisted" → auto-accept.** The whitelist keys on the requester's
  pubkey/fingerprint, and "known" *means* you already hold a petname/relationship for that key.
- **discovered-cold (public bio / shared handle) → "unknown-but-meets-requirements" → requirements
  gate + notify-to-approve** (via the M6 ops-agent / Telegram channel).

This also confirms the M8 split: **availability ≠ discoverability.** The public-bio / oblivious-handle
layer is the M11 *discoverability* axis; it pairs with the M10 *availability* axis (accept inbound or
not).

- **OPEN:** the oblivious-handle mechanism specifics (OPRF / ZK construction).
- **OPEN (federation):** preserving the oblivious index's non-enumerability across the sovereign /
  replicated nodes — flagged as a real constraint after this session's replication incident.
- **Milestone:** M11.

---

## 7. Relationship to the M8 portal thread

- **Account-control model** (settled in M8): no central control plane; **directory = minimal identity
  facts + reputation; daemon = the control point**; the account is a directory-side identity grouping
  of agents; multi-daemon / one-account is normal; **one agent = one home daemon** (one presence slot
  per pubkey). Our identity model sits directly on this, and rotation/retirement execute via the
  account-authorizes → daemon/node-executes → directory-records path (§5).
- **Journey 01 (Auth)** is the **authorizer** for rotation and retirement: TOTP required floor +
  WebAuthn convenience (not a substitute), magic-link bootstrap, recovery-contact threshold
  (sovereign, no central backdoor). Its strong-auth requirement is what makes account-authorized
  re-key safe (§4).
- **Journey 02 (Agents)** is the observe surface + emergency lever — **where the suspend/burn lever
  lives** (§5). Directory per-agent: identity (pubkeys, no name/bio — matches §2), connection graph +
  sessions **by fingerprint only**, never content; presence via a new replicated `agent_presence`
  table (edge-triggered writes) + a coarse `directory_nodes.last_heartbeat_at`, rendered as honest
  "last seen."
- **M10 connection policy** = three orthogonal dimensions — **availability / requirements / review
  handling** — with policy kept **local, not a portal surface**. This supersedes the earlier
  "report-card / mode / review_mode" framing, which was implementation drift (memory corrected
  2026-06-25). The §6 unification ties it to discovery.
- **M8 scope facts:** Trust Signals = M10 (M8 ships a navigable UI with honest placeholders); Recovery
  contacts + **Succession = M10**; **Discovery = M11**; the old "Connections" menu was dropped.

---

## 8. How this fits existing CELLO architecture

- `account_id` and multi-agent-per-account already exist.
- The "Not Me" emergency shutdown is the seed of the suspend/burn lever (§5).
- The Ops Agent is already slated to own key rotation / succession; the portal owns the auth
  (Journey 01).
- The **anti-surveillance value** is the binding constraint throughout — it drives names-local,
  policy-local, oblivious discovery, and the edges-by-fingerprint flag below.
- The "permanent client-side records" (counterparty-held, tamper-proof) are the accountability
  backbone that makes "delete to hide guilt" fail (§5).

---

## 9. Open questions

- Voluntary-**retire** reversibility during the drain, or one-way once requested (§5).
- Which positions of the suspend/burn lever ship in M8 vs later (§5).
- The oblivious-handle mechanism — OPRF / ZK construction (§6).
- Preserving oblivious non-enumerability across federated nodes (§6).
- **Edges-by-fingerprint (metadata surveillance) — resolved in principle, see §12.** Not the same
  problem as discovery's oblivious lookup, and *not* solvable by deletion (the graph is a required asset
  for the planned Sybil/reputation-farm detection). Reconciliation: a sovereign-threshold,
  purpose-constrained, verdict-only, audited analysis layer — neither a centralized honeypot nor deleted.
  Residual: detection *is* association-observability, bounded to that function. Launch stance: don't
  foreclose, don't build the honeypot (§13, guardrail 6). *Still open:* the concrete shard/compute design
  and the governance of who may run the analysis under sovereignty.
- Daemon-level default connection policy — a settable default vs per-agent + a hardcoded fallback
  (M8-owned, adjacent).
- The user-facing form of "sharing a key" (QR / link / handle carrier).

---

## 10. Milestone map

- **Foundational identity/lifecycle model** — underwrites M8, M10, and M11.
- **M8:** account-control model; Agents observe-surface; the suspend/burn emergency lever (seed).
- **M10:** key rotation / succession; recovery contacts; the connection-policy three-dimension model;
  trust signals.
- **M11:** discovery — introductions, the oblivious handle, and the public-bio portal.

---

## 11. What this unblocks / next steps

New capabilities implied: agent retirement/revocation (pause / retire / burn), key rotation /
succession, the introduction/vouching primitive, the public-bio discovery portal, and the oblivious
discovery handle. These will become several stories across M8 / M10 / M11 — not written here.

References: the replication incident (`infra/STATE.md` + memory), `M7-CLI-UX-FEEDBACK.md`, the M8
journey docs (account-control model, Journeys 01–02, connection policy), and the discovery prior-art
sources below.

---

## 12. Edges-by-fingerprint: metadata surveillance vs. required Sybil detection (resolved in principle)

The directory's `connections`/`sessions` tables record **pubkey-to-pubkey edges with timestamps** — no
names, no content (content is *never* stored — hard invariant). The exposure is the **social graph**:
who-talks-to-whom, how often, when. It is sharper in CELLO because (a) **fingerprints are stable and
linkable** — one durable pubkey per agent, you learn a counterparty's the moment you connect, public-bio
agents publish theirs, and graph topology de-anonymizes the rest; and (b) **the graph is replicated to
every sovereign node**, so every operator (or any single breach) gets the whole federation-wide graph.
The precise question: *can a node operator connect the dots on who-talks-to-whom across the network, by
fingerprint, without ever seeing a message?* Today, yes.

- **The discovery oblivious-lookup solution does NOT transfer.** That solves query-privacy +
  anti-enumeration over a registry the directory needn't read in plaintext. The edge graph is data the
  directory must *read and use*. Different problem, different tool.
- **The graph is a required analytical asset, not a deletable byproduct.** A *planned* (future, not
  launch) need: **graph analysis to detect reputation-farm cliques** — Sybil rings that talk to and
  endorse each other to stack reputation inside the clique. This is fundamentally graph-structural
  (dense inward-facing subgraphs; the sparse honest/Sybil cut — cf. SybilGuard / SybilLimit / SybilRank).
  Consequence: **reputation-as-counters is insufficient** — a farm shows *excellent* counters; only the
  topology exposes it. So deleting the edges disarms the defense and hands the system to the farmers.
- **So the tension is real and does not resolve by deletion.** Two load-bearing requirements pull
  opposite ways: anti-surveillance (no party holds a browsable global graph) vs. Sybil detection (some
  analysis must see global topology). Reconciliation is about **access & compute, not existence**:
  - **Don't centralize** into one analysis node (the honeypot — concentrates the graph and reintroduces
    a central authority).
  - **Don't delete** (the free-for-all).
  - **Extend CELLO's sovereign-threshold model to the analysis layer:** shard the graph so **no single
    analysis node ever holds the whole thing**; running analysis needs a **quorum**; the function is
    **purpose-constrained** (only anti-Sybil structural questions; emits only **verdicts** — a risk flag,
    never raw edges or arbitrary "who talks to X") and **audited**. This is not walking back to a central
    authority — it is the same sovereignty invariant one layer up.
  - **Limit:** a federation-spanning farm is only visible by correlating structure *across* nodes, so you
    cannot fully pre-aggregate locally — which is exactly why the analyzer must be threshold/quorum.
- **Irreducible residual — and the principled stop for "how far back from pure P2P":** automated
  collusion detection *is* association-observability (the same capability from two sides). So the
  strongest honest promise is: *association is observable only to a sovereign-threshold,
  purpose-constrained, audited function that emits only abuse verdicts — to no operator, for no other
  purpose.* Stop there: going further (delete) hands the system to scammers; stopping short (one trusted
  analyzer) gives up the distribution that makes the surveillance critique answerable.
- **This is future work.** Distinct from propagated scoring — structural anomaly detection, consistent
  with the rejected-TrustRank stance. See `2026-04-11_1000_sybil-floor-and-trust-farming-defenses`,
  `2026-06-07_1221_sybil-confirm-shortcut-audit`.

---

## 13. Forward-looking guardrails (must hold at launch)

The launch blockers are the **basics — create / name / remove agent, and the portal** (observe your
agents + collect trust signals; the portal shows nothing the directory doesn't already hold). The point
of §§2–12 is **not** to build any of it now, but to keep the cheap launch decisions from painting into an
architectural corner, so the future capabilities are **additive, not a rewrite**. Six guardrails — each
cheap now, mostly *constraints/audits, not features*:

1. **Identity keyed by the stable `agent_id` / `account`, never by a pubkey.** Pubkeys rotate; everything
   durable (reputation, edges, sessions, references) hangs off `agent_id`, with pubkeys as *attributes*;
   a profile holds a *history* of keys, not one immutable scalar. → avoids rotation/succession becoming a
   migration nightmare.
2. **Human names never enter the directory** (the petname rule). Names stay client-local; the directory
   keys by pubkey / `agent_id` only; no name column, no name-based lookup. → avoids building a
   squattable/surveillable registry that must later be ripped out.
3. **Default is non-discoverable.** Launch = share-the-key / introduction only, or strictly opt-in
   listings keyed by pubkey and separable from identity. → avoids un-building a public enumerable
   directory.
4. **The server side is a *set* of nodes/shares — never "the node."** No singular co-signer baked into
   schema / API / records, despite the 2-of-2 stopgap ([[2026-06-03_1200_frost-dkg-single-directory-gap|
   FROST DKG Single-Directory Gap]]). → avoids T-of-N being a protocol rewrite.
5. **Agents are append/tombstone only — never hard-deleted — and the ceremony path reads a `status`.** A
   `status` field consulted by the co-signing path (always "active" today) + a firm no-hard-delete rule.
   → avoids retrofitting revocation into a permanence-assuming ceremony path, and avoids an *erasure* path
   that breaks the accountability invariant.
6. **Policy stays local; the directory never becomes load-bearing on a global edge graph.** "Known
   requester?" stays on the receiver; edges persisted minimally, `agent_id`-keyed, behind one access
   seam. → avoids the free-for-all, the honeypot, *and* a rewrite-to-shard simultaneously.

**Mapping to the launch basics:**
- **create-agent** — stable `agent_id` + `account_id` + a `status` from day one; pubkeys as attributes;
  no name in the directory.
- **name-agent** — a *local* petname operation, never the directory, so rename/reuse is free and the
  future handle/oblivious-lookup/public-bio layer is purely additive.
- **remove-agent** — local removal (frees the local name) + a directory-side revocation *fact* / `status`
  flip, **never a hard-delete**. The threshold-honored enforcement (pause/burn) is future; the *record
  shape* is forward-compatible now.

---

## Sources (discovery prior art)

- Petnames / Zooko: Stiegler, *An Introduction to Petname Systems* —
  https://www.skyhunter.com/marcs/petnames/IntroPetNames.html ; Ferdous & Jøsang, *Security Usability
  of Petname Systems* — https://link.springer.com/chapter/10.1007/978-3-642-04766-4_4 ; Zooko's
  triangle — https://en.wikipedia.org/wiki/Zooko%27s_triangle
- AT Protocol / Bluesky: https://atproto.com/specs/handle ; https://atproto.com/guides/identity ;
  https://docs.bsky.app/docs/advanced-guides/resolving-identities
- Nostr NIP-05: https://github.com/nostr-protocol/nips/blob/master/05.md
- did:web / WebFinger: https://w3c-ccg.github.io/did-method-web/ ;
  https://datatracker.ietf.org/doc/html/rfc7033
- Signal: https://signal.org/blog/private-contact-discovery/ ;
  https://www.zellic.io/blog/signal-username-ristretto-hashes/
- Keybase: https://www.zoom.com/en/blog/zoom-acquires-keybase-and-announces-goal-of-developing-the-most-broadly-used-enterprise-end-to-end-encryption-offering/ ;
  https://github.com/keybase/client/issues/24577
- Farcaster: https://docs.farcaster.xyz/learn/what-is-farcaster/usernames ;
  https://github.com/farcasterxyz/fname-registry

---

## Related Documents

- [[2026-04-15_1100_key-rotation-design|Key Rotation Design]] — §4 builds on and updates this; adds account-authorized re-key, the stable `agent_id`, and the key-epoch chain.
- [[2026-06-03_1200_frost-dkg-single-directory-gap|FROST DKG Single-Directory Gap]] — the 2-of-2 stopgap that §5's threshold-model note designs past; the intended T-of-N threshold across sovereign nodes is its remediation.
- [[2026-04-13_1200_discovery-system-design|Discovery System Design]] — §6 extends this with the petname/introductions → oblivious-handle → public-bio layering and the prior-art synthesis.
- [[2026-05-20_0354_multi-agent-account-architecture|Single-Account, Multi-Agent Architecture]] — the account-as-anchor basis for §2–§3.
- [[2026-05-21_1456_identity-as-governance-foundation|Identity as the Foundation of Governance]] — the identity foundations this model rests on.
- [[2026-04-08_1800_account-compromise-and-recovery|Account Compromise, Recovery, and Web-of-Trust Connections]] — compromise/recovery, tied to rotation-under-compromise (§4) and removal (§5).
- [[2026-04-14_1300_connection-request-flow-and-trust-relay|Connection Request Flow]] — the connection-policy known-vs-unknown handling unified with discovery in §6.
- [[portal-design|CELLO Portal Design]] — the M8 portal thread this was developed alongside (§7).
- [[01-onboarding-and-authentication|M8 Journey 01 — Onboarding & Auth]] — the account auth that authorizes rotation/retirement (§4, §7).
- [[02-agents|M8 Journey 02 — Agents]] — the observe surface + where the suspend/burn lever lives (§5, §7).
