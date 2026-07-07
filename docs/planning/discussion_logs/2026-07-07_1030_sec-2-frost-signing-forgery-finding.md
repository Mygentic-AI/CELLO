---
name: SEC-2 — FROST signing forgery (problem statement)
type: security-finding
date: 2026-07-07
topics: [security, frost, signing, forgery, directory, threshold, vulnerability]
status: open-needs-decision
description: >
  Standalone, dense statement of SEC-2: a pre-existing critical forgery hole in CELLO's FROST
  signing path. Anyone who knows an agent's PUBLIC key can make the directory nodes produce a
  valid threshold signature over an arbitrary message. States the vulnerability only; the fix
  options live in the companion proposal doc.
---

# SEC-2 — FROST signing forgery

## One line

**Anyone who knows an agent's *public* `k_local_pubkey` can get CELLO's directory nodes to produce
a valid threshold signature over an arbitrary message — i.e. forge that agent's signatures**
(session establishment, conversation seals, and — once it ships — device-transfer attestations).

## The vulnerability — three facts that combine

1. **The FROST *signing* stream is unauthenticated.** The `/cello/frost/1.0.0` frames that ask a
   directory to contribute a partial signature — `frost_commit_request` and `frost_sign_request` —
   have no caller authentication. The only gate is an `#isAgentPaused` honor-check
   (`directory-node.ts:1249, 1289`). There is no K_local challenge (the *signaling* stream has one,
   `CELLO-DIR-AUTH-v1`), no check of the connecting peer, no capability. A self-declared
   `peerIdString` in the frame is never compared to the actual connection.

2. **The directory signs arbitrary bytes.** `signRawMessage` (`frost-handler.ts:592-598`) computes
   its partial over whatever `framedMsg` bytes the client supplied, with no binding to a session
   the directory brokered or a message it authorized. Whatever arrives gets signed against the
   agent's group key.

3. **The directories alone meet the threshold.** The group is `(T, N+1)` — N directory nodes plus
   the client — with `T = majority(N) ≤ N`, and the directory refuses registration unless the
   directory quorum `|Q| ≥ T` (`directory-node.ts:2676`). So T directory partials alone aggregate
   to a signature that verifies against the agent's `primary_pubkey`. **The client's own share is
   never required.** (The honest coordinator always includes its own partial, but that is
   honest-path behaviour, not a cryptographic requirement.)

## The attack

An attacker who knows only the agent's public key + epoch (any enrolled agent's is discoverable):

1. Dials `/cello/frost/1.0.0` on T directory nodes, sends `frost_commit_request` → collects T nonce
   commitments.
2. Assembles the commitment list, picks an **arbitrary** `framedMsg`, sends `frost_sign_request` to
   the same T → collects T partial signatures.
3. Aggregates them → a valid threshold signature over attacker-chosen bytes against the agent's
   `primary_pubkey`.

No step requires a secret the attacker doesn't already have.

## Reachability — no network mitigation

The directory ALB is `internet-facing` (`cello-ecs-directory.yaml:223`) with the libp2p listener on
the public endpoint (`/ip4/0.0.0.0/tcp/8080/ws`); libp2p multiplexes all protocols over one
connection. Any internet party completes the Noise handshake (which authenticates peers but does
not *authorize* — no allowlist) and can then open `/cello/frost/1.0.0`. There is no ALB
per-protocol filter and no in-code gate. **The exploit is open to anyone who can reach the
directory = the internet.**

## Impact

A forged signature is indistinguishable from a genuine one — it verifies against the agent's group
public key. That undermines the core trust guarantee: an attacker can impersonate an agent's
cryptographic identity (establish sessions as it, produce seals as it). It defeats the
"relatively safe" launch pillar at the most fundamental layer — authenticity of signatures.

## The one exception

The degenerate single-directory back-compat config (N=1, forced 2-of-2): there the directory
shareholders (1) are fewer than T (2), so the client's share *is* required and the hole does not
apply. Every real multi-directory config (N≥2, `T = majority(N)`) is exposed.

## Status of the evidence

Confirmed by three independent code-reads (a ceremony-gate feasibility pass, a FROST-threshold-model
check, and an adversarial confirm-or-refute that specifically hunted for a saving gate and found
none), with file:line at every decision point. **No live proof-of-concept has been executed** — the
code path is unambiguous but the attack was not run against a live node.

## Provenance

**Pre-existing.** Lives in the M2/M6B/federation FROST signing path; NOT introduced by M8C or the
Tier-5 (multi-daemon) work. Found while scoping DOD-PRIMARY-1's ceremony-gate.

## Not this doc's job

The fix (authenticate the frost signing stream; optionally bind `framedMsg` to a brokered session;
phased client-then-directory rollout) and the migration risk are in the companion proposal, not
here. This document states only the problem.

## Related Documents

- [[2026-07-07_0640_sec-2-frost-signing-auth-fix-proposal]] — the fix options, migration, recommendation
- [[M8C-DEFINITION-OF-DONE]] — SEC-2 entry under "Tracked, not M8C-fruit"
- [[M8C-BUILD-JOURNAL]] — Entry 39 (how it was found, full confirmation trail)
- [[M8C-DECISIONS]] — D20 (DOD-PRIMARY-1's ceremony-gate parked on this fix)
