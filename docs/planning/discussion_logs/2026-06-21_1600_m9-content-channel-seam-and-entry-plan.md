---
name: M9 Content-Channel Seam and Entry Plan
type: discussion
date: 2026-06-21 16:00
topics: [security-architecture, m9, security-gateway, daemon, content-channel, prompt-injection, hooks, directory-attestation, hash-chain, msg-001, ingest-chokepoint, m7-dependency]
status: active
description: >
  How M9 (the security gateway) begins, grounded in where it attaches to the M7
  daemon content channel. M9 looks independent (separate gateway package, no portal/
  discovery/social-trust dependency) but it is NOT independent of the daemon's inbound
  and outbound content channels — and those channels are being finalized right now in
  MSG-001-3b on branch m7-rehome. This log records the daemon seam (ingestReceivedContent
  inbound / sendContent outbound), the co-design decision taken with the MSG-001-3b coder
  to keep the inbound funnel unified, the dependency gate, and the process apparatus M9
  needs (and does not need) to copy from M7.
---

# M9 Content-Channel Seam and Entry Plan

This is the "how do we begin M9" design record. It builds on the canonical M9 gateway
design ([[2026-05-28_1000_security-layer-v3-extensibility-and-split-gateway|Security Layer
V3]]) and connects it to the concrete daemon the gateway must hook — the M7 daemon as it
exists on `m7-rehome`. V3 specifies everything *inside* the gateway. This log specifies
*where the daemon calls the gateway*, which V3 never did, and that is the thing that makes
M9 non-trivial to start.

## Why M9 is not as independent as the roadmap suggests

The roadmap marks M9 "largely independent — can run in parallel with M8 and M10; the
gateway has no dependency on portal, discovery, or social trust." That is true of the
gateway's *internals*. It is false of the gateway's *attachment point*. M9's pipeline must
intercept every byte of agent content as it enters and leaves the daemon — so M9 is
coupled to the daemon's inbound and outbound content channels. Those channels were being
rebuilt in M7 (the daemon redesign) and, specifically, the store-and-forward content path
is being finalized **now** in MSG-001-3b. M9 cannot land its first live journey against a
channel that is still wet.

## The seam (verified against `m7-rehome`, both confirmed by the MSG-001-3b coder)

The daemon calls the gateway twice per message — once outbound (V3 Layers 3–4 + outbound
hooks), once inbound (V3 Layers 1–2 + inbound hooks). The two call sites:

- **Outbound chokepoint — `sendContent`.** `cello_send` (`core/daemon/src/daemon.ts:2616`)
  → `sessionNodeManager.sendContent(...)` (`session-node-manager.ts:1406`). All agent
  plaintext passes here. The 1 MB cap check sits just before it. Park/retry is a *backstop
  after* `sendContent`, so there is no second egress to guard; the park deposit carries
  already-sealed ciphertext (plaintext already passed the egress at `sendContent`). The
  gateway's returned (possibly redacted) content is what gets hashed, sealed, sent, and
  committed as the Merkle leaf. A `block` verdict means no `sendContent`, no leaf, session
  stays active.

- **Inbound chokepoint — `ingestReceivedContent`.** `#handleContentStream`
  (`session-node-manager.ts:1769`) → `ingestReceivedContent(...)` (`:1548`) →
  `#receivedContent` buffer → `cello_receive` (`daemon.ts:2707`). Plaintext is in the clear
  here; this is the one place the gateway can scan inbound content before the agent sees
  it. `ingestReceivedContent` already does the content_hash cross-check (the DOD-MSG-7
  tamper gate), the not-active rejection, the leaf/sequence assignment, and the buffer push
  — so it is the natural home for the inbound gateway call and, later, the fail-open/closed
  policy hook.

Direct P2P content is plaintext-in-the-clear at both sites (Noise protects the wire, not
the daemon's view), so the gateway sees real content in both directions.

## The gap, and the co-design decision (taken 2026-06-21 with the MSG-001-3b coder)

The direct path is clean. The offline / store-and-forward path was not:

- **Outbound park:** fine. Already screened at `sendContent` before parking.
- **Inbound pull:** as built in MSG-001-3b increment 1, `content_park_pull` returns
  **ciphertext** to the caller; decryption was downstream of the daemon. A message parked
  while B was offline and pulled later would therefore **bypass `ingestReceivedContent`** —
  reaching the agent with no inbound screening. That is an injection bypass: a peer parks a
  poisoned message, B comes online, pulls it, and the gateway never saw it.

**Decision.** MSG-001-3b increment 3 (the receive-path wiring) routes the recovery path
`pull → openSealed (inside the daemon) → ingestReceivedContent(plaintext, hash)` — the same
inbound funnel as direct receive, landing in the same `#receivedContent` buffer at the
already-assigned canonical sequence. It does **not** hand ciphertext to the agent. This is
not new scope: DOD-MSG-4 ("recovery not desync") already wants pull → openSealed → verify
content_hash → accept at the assigned sequence → deliver. The decision only pins *how* it
delivers: through `ingestReceivedContent`, never around it.

The coder confirmed this is their plan and is strictly less code than the ciphertext-out
alternative. Four refinements from that exchange (full Q&A archived outside the vault):

1. **The leaf-append inside `ingestReceivedContent` becomes dedup-aware** (append-if-new,
   else reconcile to the witnessed sequence — DOD-MSG-4/5). Crucially the **chokepoint
   stays unconditional**: scan + cross-check + buffer always run; only the append is
   conditional. M9 hooks the chokepoint and is insulated from the dedup detail.
2. **The inbound seam has no schema dependency.** Only the *outbound* startup-flush park
   needs the persisted per-session relay endpoint (the in-memory-only finding the coder
   flagged). Inbound pull works off the recipient's already-connected per-agent relay
   client plus a reconnect notify. Two pieces of work, not one.
3. **Sequence-then-content on the park path.** For recovered messages the sequence is
   assigned when the hash is witnessed; the content arrives later. M9's attestation keys on
   the `appendSessionLeaf` leaf index and must **not** assume content and sequence land
   atomically on the recovery path.
4. **The single-inbound-funnel acceptance criterion is owned by the MSG-001-3b coder**, in
   `j-content.spine.test.ts` increment 3: *a parked message, once pulled, is observed at the
   same inbound chokepoint (`session.content.received` with its assigned `sequenceNumber`)
   as a direct message, before `cello_receive` returns it — proving it did not arrive as raw
   ciphertext around the funnel.* That one test is the M9 inbound seam, secured for free
   while the channel is still being written.

## How M9 attaches to the V3 gateway

A thin daemon-side adapter — `SecurityGatewayClient` interface in `packages/interfaces/`,
local stub for `CELLO_ENV=local`, per the mandatory adapter pattern — wrapping V3's
`SecurityRequest`/`SecurityResponse`. Two methods: `screenOutbound(req)` at the `cello_send`
site, `screenInbound(req)` at the `ingestReceivedContent` site. Local mode = in-process
sidecar; enterprise = mTLS to a remote gateway. The daemon stores `record_hash` locally;
**the gateway writes the `SecurityAttestation` to the directory directly** — the client
never holds that write path. That split is the load-bearing property of V3 (an attacker who
controls the client cannot forge what the gateway attested).

The V3 `cello_receive` envelope gains a `security_context` (notes + transformations_applied);
the inbound gateway call populates it. The agent's system prompt is instructed to treat
`caution`/`warning` notes with skepticism — notes are advisory, not gates.

## Directory dependency (the real cross-repo cost)

V3's `SecurityAttestation` is a new directory record type and ingest API. M7 explicitly
ships **no** new Flyway migrations, so **M9 owns the first new directory migration since
M5**: a hash-chained, sovereign-node-faithful, RLS-enforced `security_attestations` table
plus the gateway ingest endpoint. Per the migration-integrity rules this schema must be
designed complete up front and `OpsAgentExpectedMigrationVersion` bumped. This is the part
of M9 that touches the live directory and triggers the 25–30 min deploy — a true story, not
a hotfix.

## What is stale in the existing M9 stories

`overview.md` + SCAN-001/002/003, REDACT-001/002/003/004, MONITOR-001 were written
2026-05-16, pre-V3 and pre-daemon. The overview already flags the V3 relocation (pipeline
moves out of the `client` package into the gateway). It does **not** yet flag the daemon
seam. Every story needs a rewrite-pass note: its hook is `ingestReceivedContent` (inbound)
or `sendContent` (outbound), expressed against the daemon, not the dead `client` package.

## First live journey and proposed journey decomposition

Begin M9 the way M7 is being rebuilt — live-binary journeys against the real gateway +
daemon + directory, not unit-green claims.

- **J-SCREEN (first target).** Two agents in a live session (the J-SPINE cluster); a local
  gateway sidecar running Layer 1. A sends a message carrying a known injection token →
  Layer 1 sanitizes → B's `cello_receive` envelope carries the `security_context` note →
  the sanitized form is what B sees. **Then the seam test:** A parks a message for offline B
  → B comes online → B pulls → *the same Layer 1 screening fires on the recovered message*
  (proving the inbound funnel is unified) → relay logs show ciphertext only (INV-3). That
  second half is the test that fails if the co-design constraint was not honored, and it
  overlaps the MSG-001-3b increment-3 AC by design.
- **J-SCAN** → Layer 2 (DeBERTa-v3-small INT8, in-process, no network — the no-LLM
  invariant) live on inbound.
- **J-GATE / J-REDACT** → Layers 3–4 (outbound gate + redaction) live on `sendContent`.
- **J-HOOK** → one sync `gate` hook + one async `observe` hook, HMAC auth, redact
  no-inject enforcement.
- **J-ATTEST** → security pass record → `record_hash` → directory `SecurityAttestation`;
  nightly verification detects a tampered/deleted/suppressed record.

## Dependency gate / sequencing

```
MSG-001-3b increment 3  ──(lands with single-inbound-funnel AC)──►  content channel FROZEN
                                                                          │
                            ┌─────────────────────────────────────────────┤
                            ▼                                             ▼
   M9 directory story (SecurityAttestation + migration,                M9 gateway pkg/repo
   schema designed complete, OpsAgent version bumped)                  + SecurityGatewayClient
                            └──────────────────────┬─────────────────────┘  adapter + stub
                                                   ▼
                          J-SCREEN (Layer 1 live) → J-SCAN → J-GATE/REDACT → J-HOOK → J-ATTEST
```

- **Unblocked now (no M7 dependency):** gateway repo/package skeleton, the
  `SecurityGatewayClient` interface + local stub, and the `SecurityAttestation` directory
  schema *design*.
- **Gated:** J-SCREEN (M9's first live journey) blocks only on MSG-001-3b increment 3
  landing with its AC. No schema coupling on the inbound side (refinement 2). This is a
  known, owned line of the build thread's work — not a coordination risk.

## Process apparatus — does M9 copy M7's three documents?

M7 runs on a trio: `M7-DEFINITION-OF-DONE.md` (yardstick), the live binary test (enforcer),
`M7-BUILD-JOURNAL.md` (audit trail), with `M7-PROCEDURE.md` as the runbook. **M9 should
reuse the *method*, not blindly clone the *trio*.** The trio is in large part a
post-*collapse* recovery apparatus — it exists because M7's scope was scattered across many
docs, parallel-agent sprawl buried the milestone, and a dead stack diverged from production.
M9 has none of those conditions: its scope is already consolidated (V3 + overview + the
story YAMLs), it is a clean separate gateway package, and there is no dead stack to retire.

Recommendation:

- **M9 Definition of Done — YES, create it (high value).** M9 is multi-component (6 layers +
  hooks + hash chain + directory attestation) and the M7 experience proved that vitest-green
  ≠ done — the live multi-process gate is what matters. An M9 DoD that maps each layer/story
  to a live journey (J-SCREEN → J-ATTEST) against the real gateway binary, carries honest
  status tags, and forbids silent deferral is the right yardstick. It also supersedes the
  stale story-level scope by stating the daemon seam once, authoritatively.
- **M9 Build Journal — YES, but create it at first build, not now.** An empty journal is
  noise. Start it with the first build unit (J-SCREEN), reusing M7's append-only convention
  (one entry per unit; never edit a prior entry; front-load before coding).
- **M9 Procedure — NO full clone.** Most of `M7-PROCEDURE.md` is collapse-recovery-specific
  (one-thread-no-sprawl, dead-stack retirement, salvage rules). The reusable disciplines
  (red-first live test, per-unit review at every severity, commit-constantly, anchor-to-the-
  binary) already live in `CLAUDE.md` and SPARC. Capture the few M9-specific working rules
  (no-LLM invariant in the base layers; gateway writes attestations, client never does;
  redact no-inject enforcement) as a short section in the M9 DoD rather than a separate
  167-line runbook.

So the M9 doc set is: **this discussion log** (the why/how-to-begin), **an M9 DoD** (the
live-journey yardstick, to draft next), and **an M9 Build Journal started at first build**.

## Related documents

- [[2026-05-28_1000_security-layer-v3-extensibility-and-split-gateway]] — canonical gateway
  design (interface contract, hook architecture, hash chain, split deployment, Day 1/Day 2)
- [[user-stories/m9/overview.md]] — M9 implementation scope and layer→story map (needs the
  daemon-seam note added)
- [[user-stories/m7/M7-DEFINITION-OF-DONE]] — the DoD model M9's DoD will follow; DOD-MSG-1..8
  are the content-path lines M9's seam depends on
- [[user-stories/m7/M7-BUILD-JOURNAL]] — MSG-001-3b build state; increments 1–3 and the
  single-inbound-funnel AC
- [[2026-05-16_1130_security-layer-improvements-from-production-reference]] — the six
  production gaps feeding M9 (RE2, entropy, PII types, honey tokens, policy gate, audit
  streaming)
- [[M8C-MILESTONE-NOTES|M8C Milestone Notes]] — verified (2026-07-05) that the m9-build→main
  merge is textually conflict-free but the seam needs a semantic re-prove post-merge (all
  M8B-era content paths through the gateway)
