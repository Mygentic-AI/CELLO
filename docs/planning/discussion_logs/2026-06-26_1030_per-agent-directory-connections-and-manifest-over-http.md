---
name: Per-agent directory connections and manifest-over-HTTP
type: discussion
date: 2026-06-26
topics: [daemon, keystone, directory-connection, manifest, TUF, sovereign-nodes, agent-identity, signaling]
status: active
description: >
  Resolves the "keystone" design fork surfaced while debugging the Demo1 registration
  timeout. The daemon's single directory signaling connection borrowed the primary
  agent's identity; removing that agent stranded the connection (still authenticated as
  the removed agent). A verification pass proved every frame on the authenticated
  signaling stream is agent-scoped EXCEPT the manifest poll. Decision: delete the
  keystone — every agent operates its own directory connection authenticated as itself —
  and rehome the one daemon-level operation (manifest poll) to unauthenticated HTTP.
  Locks the invariant: nothing agent-specific ever goes in the consortium manifest.
---

# Per-agent directory connections and manifest-over-HTTP

## The bug that started it

Removing `Ms_Chelly` (an operator's agent) then registering a fresh agent (`Demo1`)
on the same daemon timed out. Directory logs showed the token consumed and the
`key.encrypted` step (K_server share computed), then nothing — no `dkg_complete`,
no `register_success`, no error. Separately, `Ms_Chelly`'s pubkey was observed
pinging the directory **six minutes after her removal**. A logout/login fixed it.

## Why — the keystone model

The directory has no concept of "the daemon." It only knows agents. Each signaling
connection authenticates by an agent signing a directory challenge
(`SHA-256("CELLO-DIR-AUTH-v1" ‖ nonce ‖ pubkey)`, `signaling-connect.ts`). The daemon
has no identity of its own, so its single directory-facing connection — the
**keystone** — borrowed the **primary** agent's identity (the lexicographically-first
loaded agent; `daemon.ts` `getAuthIdentity`).

The keystone carried three things: (1) the primary agent's own register/session/seal
frames; (2) the **manifest poll** (`pollScheduler`, DOD-AUTH-2); (3) it doubled as the
"directory door" reconnect loop. When the primary agent was removed, the code cleared
`primaryAgent` but never tore down + re-established the connection under a new identity —
so the keystone lingered, still authenticated as the removed agent, and a subsequent
registration had no working directory door. This is the "worst of both worlds": not a
clean per-agent model, and not a real first-class daemon link.

## The verification pass — is everything on the authenticated stream agent-scoped?

Enumerated all 19 frame types the directory dispatches on `/cello/signaling/1.0.0`
(`directory-node.ts`). **18 of 19 are strictly agent-scoped** — each carries or acts on
one agent's identity, dispatched keyed by the authenticated pubkey: `register_request`,
`dkg_complete`, `session_request`, `session_offer_accept`, the six `seal_*` frames,
`connection_request`/`response`, `disclosure_request`/`response`, `peer_info_announce`,
`revoke_agent`. `ping` is per-connection keepalive (each agent pings its own line).

**The one exception is `manifest_poll_request`.** It returns the consortium manifest —
the directory node roster — which is the same for every agent, not anything about a
specific one. The directory's handler ignores the caller's identity; it just returns the
public manifest. On the client the poll scheduler is wired only to the keystone. So the
manifest poll is the single daemon-level operation, and it had no home except a borrowed
agent identity.

## Decision

**Delete the keystone. Go full per-agent.**

1. Every agent (including the former "primary") gets its own `SignalingManager`
   authenticated as itself. Remove `primaryAgent`, the keystone `getAuthIdentity`,
   `wireKeystonePrimary`, `keystoneDispose`, and the shared keystone `signalingManager`.
   The per-agent path already exists (`getAgentSignaling`) and wires six of the needed
   handlers; this unifies the primary onto it.
2. **Close SPINE-5.** Inbound `session_assignment` handling is currently attached only to
   the keystone, so a non-primary agent can register but not *receive* inbound sessions on
   its own stream. Move those handlers into per-agent wiring.
3. **Rehome the manifest poll to unauthenticated HTTP.** The directory serves the current
   signed manifest at `GET /manifest` (the same health server / `BootstrapTargetGroup`
   that already serves `/bootstrap` and `/agent-lookup` unauthenticated). The client polls
   it over HTTP and verifies the threshold signature against locally-pinned
   `CELLO_CONSORTIUM_ROOT_KEYS`. This runs daemon-level, even with **zero agents**.

Result: removing any agent drops only its own connection — no stranding. There is no
daemon identity and no standing daemon↔directory connection; the only daemon-level
directory interaction is a stateless signed-manifest fetch.

## Why unauthenticated HTTP is safe (not a downgrade)

The manifest is **self-authenticating public data**:

- **Contents** are the public node roster only: `{nodeId, pubkey, region, provider,
  endpoint}` per node + `{version, not_before, expires, signatures}`. Every field is
  public by nature — endpoints must be dialable, pubkeys are public keys, the officer
  signatures are the security mechanism. Nothing secret, nothing per-agent.
- **Integrity** is the threshold signature, verified client-side against root keys pinned
  **locally** (`CELLO_CONSORTIUM_ROOT_KEYS` + an initial `FileManifestProvider`). The
  network is never the trust source — TUF-shaped roll-forward. Authenticating the *fetch*
  protected a document that already protects itself.
- **Precedent**: `/bootstrap` and `/agent-lookup` are already unauthenticated on the same
  server (the latter returns an agent's `k_local_pubkey` — more identity-revealing than
  the roster), behind the ALB/WAF.

What we take on, and the mitigation:
- **No per-agent rate-limiting** → IP-based at the ALB/WAF; the body is small, static,
  cacheable (could be S3/CloudFront, like the relay manifest already is).
- **Withholding/staleness by a network attacker** (the signature stops forgery, not
  withholding) → serve over HTTPS, keep `expires` windows short, rely on the existing
  anti-rollback check. Same risk the S3 relay manifest already carries, handled the same
  way. **Privacy improves**: the directory no longer learns which agent is polling.

## The invariant this locks in

This is safe **specifically because** the manifest is public, self-authenticating data
with a locally-pinned trust root. **Nothing agent-specific ever goes in the consortium
manifest.** If the manifest ever needed to carry per-operator assignments, private
endpoints, or anything agent-scoped, this analysis flips and unauthenticated HTTP becomes
wrong. The rule is load-bearing and is asserted as a security invariant in CELLO-M7-CONN-001.

## DoD lines touched

- **DOD-AUTH-2** (manifest TUF poll): the transport moves from the keystone signaling
  stream to HTTP; the TUF semantics (threshold-verify, anti-rollback, refuse-expired) are
  preserved unchanged.
- **DOD-ONBOARD-1** (keystone runtime election): superseded — there is no keystone to
  elect; a fresh `create-agent` simply brings up that agent's own connection. The
  onboarding outcome (fresh install → create-agent → connected, no restart) is preserved.
- **DOD-SPINE-4** SPINE-5 follow-on (non-primary inbound session routing): closed by this
  story.

Story: **CELLO-M7-CONN-001**. Sovereign-node invariant: no agent's connection is ever
authenticated as another agent; the daemon never holds a connection authenticated as a
removed agent.

---

## Related Documents

- [[2026-06-11_1030_daemon-transport-architecture|Daemon Transport Architecture]] — defined the original keystone / directory-door model this story replaces.
- [[2026-06-11_1459_implementing-directory-bidirectional-authentication|Directory Bidirectional Auth]] — the challenge/response handshake that makes every signaling connection agent-scoped (the basis for the verification pass).
- [[2026-06-25_2109_agent-identity-lifecycle-discovery|Agent Identity Lifecycle]] — the removal/retire model whose Demo1 stranding bug surfaced this redesign.
- [[2026-06-11_0822_transport-security-audit-and-libp2p-primitives|Transport Security Audit]] — sovereign-node / relay-identity context for the manifest's self-authenticating trust model.
