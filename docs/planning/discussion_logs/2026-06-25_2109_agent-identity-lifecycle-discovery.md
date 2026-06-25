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
they trust this key, because a signature under it requires *both* the client's share *and* a directory
node's share. Neither side can forge it alone; that split is the whole CELLO guarantee. The directory
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

- **The three-position lever.** The mechanism falls out of the 2-of-2 FROST split: the directory node
  is a *mandatory co-signer*, so it can control the agent's ability to sign without touching the
  operator's device. This is what makes the lever enforceable *even when the operator's own device is
  the thing compromised* (a thief with the laptop and the client share still cannot sign, because the
  node refuses).
  - **Pause** — the node **withholds** its co-signing. The agent cannot sign while paused; the share
    is intact; **reversible**. The lightweight "Not Me — pause."
  - **Retire** — orderly **drain** of in-flight sessions (stop accepting new ones, let existing ones
    finish sealing), then the node **destroys** its share + tombstone (`reason=voluntary`).
  - **Burn** — the node **instantly destroys** its share + tombstone (`reason=compromise`). The
    emergency "Not Me — kill."

- **What "remove" means at the directory level**, decomposed: (1) destroy or withhold the server FROST
  share → kills or freezes the ability to sign; (2) append a **signed tombstone** → peers reject *new*
  interactions (the directory is append-only and hash-chained, so this is a tombstone, never a row
  delete); (3) **preserve all history**.

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
  (portal auth) → the daemon/node **executes** (the daemon holds/exports the client share; the node
  withholds or destroys its share) → the directory **records** the identity-fact change (epoch or
  tombstone). No central control plane is needed; it is an identity-layer authorization triggering a
  local action that updates directory identity facts.

- **OPEN:** is the voluntary **retire** reversible during the drain, or one-way once requested?
  (Pause is reversible by definition; this is specifically about the drain-then-destroy path.)
- **OPEN (M8-owned scope):** which positions ship in the M8 Agents-list emergency lever vs later
  (M15?). Pause and burn are cheap and node-enforced; the orderly drain is the heavier one.

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
- **Privacy tension to settle between the two threads:** the directory holding the **connection graph
  by fingerprint** (M8 Journey 02, replicated to every node) vs "the directory must not be a
  who-talks-to-whom map" (§6). Is edges-by-pubkey (no names, no content) an acceptable line, or does it
  need the same oblivious treatment as discovery?
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
- [[2026-04-13_1200_discovery-system-design|Discovery System Design]] — §6 extends this with the petname/introductions → oblivious-handle → public-bio layering and the prior-art synthesis.
- [[2026-05-20_0354_multi-agent-account-architecture|Single-Account, Multi-Agent Architecture]] — the account-as-anchor basis for §2–§3.
- [[2026-05-21_1456_identity-as-governance-foundation|Identity as the Foundation of Governance]] — the identity foundations this model rests on.
- [[2026-04-08_1800_account-compromise-and-recovery|Account Compromise, Recovery, and Web-of-Trust Connections]] — compromise/recovery, tied to rotation-under-compromise (§4) and removal (§5).
- [[2026-04-14_1300_connection-request-flow-and-trust-relay|Connection Request Flow]] — the connection-policy known-vs-unknown handling unified with discovery in §6.
- [[portal-design|CELLO Portal Design]] — the M8 portal thread this was developed alongside (§7).
- [[01-onboarding-and-authentication|M8 Journey 01 — Onboarding & Auth]] — the account auth that authorizes rotation/retirement (§4, §7).
- [[02-agents|M8 Journey 02 — Agents]] — the observe surface + where the suspend/burn lever lives (§5, §7).
