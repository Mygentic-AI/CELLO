---
name: SEC-2 — FROST signing-stream authentication fix proposal
type: discussion
date: 2026-07-07
topics: [security, frost, signing, authentication, directory, migration, launch-blocker]
status: proposal-awaiting-andre
description: >
  Decision-ready options analysis for fixing SEC-2, the pre-existing critical forgery hole in
  CELLO's FROST signing path (directory nodes are a blind signing oracle over an unauthenticated,
  internet-reachable stream). Three fix options with tradeoffs, the migration/rollout problem, and
  a recommendation. Not implemented — the fix is a cross-repo hot-path change with a forced
  client/directory compatibility break that needs Andre's architectural sign-off.
---

# SEC-2 — Fixing the FROST signing-stream forgery hole

## Status

**Proposal. Not implemented.** SEC-2 is confirmed (three independent code-reads, file:line) and
its severity is resolved UP: the frost protocol is internet-reachable, so nothing stands between an
attacker and the oracle. This doc lays out the fix options so Andre can pick the approach; the
implementation is a coordinated cross-repo migration that must not be slammed in headless. Full
finding: `M8C-DEFINITION-OF-DONE.md` → "Tracked, not M8C-fruit" → SEC-2, and `M8C-BUILD-JOURNAL.md`
Entry 39.

## The hole, in one paragraph (recap)

The `/cello/frost/1.0.0` *signing* frames (`frost_commit_request`, `frost_sign_request`) carry no
authentication — only an `#isAgentPaused` honor-check (`directory-node.ts:1249, 1289`). The
directory signs the arbitrary client-supplied `framedMsg` bytes verbatim (`frost-handler.ts:
592-598`) with no binding to a session it brokered. The FROST group is `(T, N+1)` with
`T = majority(N) ≤ N` and the directory enforces quorum `|Q| ≥ T`, so **T directory partials alone
reach threshold without the client's share**. The directory ALB is internet-facing and libp2p
multiplexes all protocols over one connection, so any internet party can dial the frost protocol.
Net: **anyone who knows an agent's public `k_local_pubkey` + epoch can drive T directories to sign
an arbitrary message against that agent's `primary_pubkey`** — forging session-establishment, seals,
and (once Tier 5 ships) primary-release attestations. The honest coordinator always includes its
own partial, but that is honest-path behavior, not a cryptographic requirement.

## What a fix must achieve

A directory node must only contribute its FROST partial when it can be sure the request comes from
a party entitled to sign for that agent — i.e. a holder of the agent's K_local **private** key (the
legitimate daemon), not merely someone who knows the public key. Equivalently: an attacker holding
only the public `k_local_pubkey` must be unable to obtain a partial.

## Option A — Authenticate the frost signing stream (K_local challenge)

Require a party opening `/cello/frost/1.0.0` (or sending a signing frame on it) to prove possession
of the agent's K_local private key, using the **same `CELLO-DIR-AUTH-v1` Ed25519 challenge-response
the signaling stream already runs** (`directory-node.ts:202`, verify ~1681). An attacker with only
the public key cannot answer the challenge.

Two sub-shapes:
- **A1 — per-connection auth.** Authenticate the libp2p *connection* once (the directory tracks
  which K_local a connection proved), and the frost handler checks the connection's authenticated
  identity before `generateCommitment`/`signRawMessage`. Cleaner, no per-round handshake latency,
  but requires the directory to carry per-connection auth state and the frost handler to read
  `stream.connection` identity (it currently reads nothing about the connection). Note the client
  opens a *fresh stream per node per round* (`network-directory-node.ts:254, 263`) — per-connection
  auth means the auth is established once on the connection the streams are multiplexed over.
- **A2 — per-stream/per-request auth.** Carry a fresh signed challenge in (or before) each signing
  frame. Simpler to reason about statelessly, but adds a challenge round-trip (or a signature
  verify) to every ceremony round on the hot path.

**Tradeoff:** A closes the hole directly and is the minimal conceptual change (reuse an existing
auth primitive). It authenticates "a holder of K_local's private key" — which after Tier-5 pairing
is BOTH the Primary and the Standby (both hold K_local). So A alone does not distinguish Primary
from Standby; that finer distinction is the Tier-5 ceremony-gate (daemon_id), which layers on top of
A. **A is the prerequisite for the ceremony-gate (D20).**

## Option B — Bind `framedMsg` to a directory-authorized context

Instead of (or in addition to) authenticating the requester, make the directory refuse to sign
arbitrary bytes: it only contributes a partial for a `framedMsg` that corresponds to something it
authorized — e.g. a session-establishment TBS for a session it is currently brokering, or a seal
TBS for a session it has a record of. The directory would reconstruct/validate the expected message
from its own state rather than signing client-supplied bytes.

**Tradeoff:** B is a stronger, more semantic defense (even an authenticated party can't get an
arbitrary signature), but it is a much bigger change: the directory currently signs "pre-framed
bytes directly, no re-framing" by design (`frost-handler.ts:524-529`), and every ceremony context
(session, seal, primary-release) would need the directory to independently know/derive the exact
expected message — which for some contexts it may not have the inputs for without new plumbing.
Higher blast radius, more likely to break legitimate flows, harder to get right.

## Option C — Both (A now, B as defense-in-depth later)

A closes the public-key-forgery hole (the launch-critical part). B hardens against a compromised or
over-broad authenticated requester. Recommended end state, but B need not gate the launch fix.

## The migration problem (why none of these can be flipped headless)

All options change the directory's acceptance criteria on the **most sensitive hot path** — every
agent, every session, every seal. If the directory starts REQUIRING the new auth/binding before
deployed client daemons produce it, **every existing agent breaks** (can't establish sessions or
seal). This is the launch-triage "migration trap."

**Phased rollout (required for any option):**
1. **Client phase.** Ship a client daemon that performs the new frost-stream auth (Option A) —
   additive; the directory does not yet require it. Publish; wait for/verify adoption. (In alpha
   with one operator this is fast, but the sequencing discipline still holds: client-then-directory.)
2. **Directory phase.** Deploy a directory that REQUIRES the auth. Now unauthenticated signing
   requests (the attacker) are refused; legitimate authenticated clients continue.
3. **(Optional) Enforcement hardening (Option B)** once A is universal.

Because directory deploys are ~25–30 min × 3 regions and clients install on version bump, the two
phases must be ordered and each verified before the next. This is exactly the coordinated cross-repo
migration that is Andre's call, not an autonomous overnight edit.

## Recommendation

**Option A1 (per-connection K_local auth on the frost stream), phased client-then-directory, with
Option B tracked as defense-in-depth follow-on.** Rationale:
- A1 reuses an existing, proven auth primitive (`CELLO-DIR-AUTH-v1`) — least new crypto, least
  likely to introduce a fresh bug on the hot path (D10 "least likely to need reversing").
- Per-connection (A1) avoids adding a handshake to every ceremony round (A2's hot-path latency).
- A is the exact prerequisite the Tier-5 ceremony-gate needs (D20) — fixing SEC-2 unblocks Tier 5's
  security core for free.
- B is genuinely valuable but is a larger, riskier change that should not gate the launch-critical
  forgery fix; land it after A is universal.

## Open questions for Andre

1. **Launch-blocking?** Given internet-reachability, is SEC-2 a hard launch blocker, or an
   accepted-risk-with-a-fast-follow given the alpha threat model (few operators, directories all
   Andre-run)? This determines urgency and whether the phased rollout compresses.
2. **A1 vs A2** — per-connection vs per-request auth on the frost stream.
3. **Scope B now or later** — is signing arbitrary authenticated bytes an acceptable residual, or
   should the directory validate `framedMsg` against brokered state before launch too?
4. Confirm the fix is a NEW security story (its own SPARC pass), not smuggled into M8C — SEC-2 is
   pre-existing and cross-cutting, larger than a channel unit.

## Related Documents

- [[M8C-DEFINITION-OF-DONE]] — SEC-2 finding (Tracked, not M8C-fruit) + D20 (ceremony-gate parked on this)
- [[M8C-BUILD-JOURNAL]] — Entry 39 (how SEC-2 was found; full confirmation trail)
- [[M8C-DECISIONS]] — D20 (ceremony-gate parked on SEC-2)
- [[M8C-PRIMARY-DESIGN]] — the Tier-5 design whose ceremony-gate depends on this fix
