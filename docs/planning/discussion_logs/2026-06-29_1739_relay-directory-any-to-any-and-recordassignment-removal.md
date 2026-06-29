---
name: Relay/Directory Any-to-Any — Removing the Directory→Relay recordAssignment Dial
type: discussion
date: 2026-06-29
topics: [relay, directory, federation, sovereign-nodes, session-assignment, relay_unavailable, transport, FROST]
status: proposed
description: >
  Root-causes the recurring `relay_unavailable` failure and specifies the durable fix:
  delete the directory→relay `recordAssignment` dial entirely. The directory authorizes a
  SESSION (FROST-signs the assignment); the client carries that signed assignment to the
  relay(s) it picks; the relay verifies it against the consortium group key. This realizes
  the foundational any-relay/any-directory vision and closes a live unverified-assignment
  security hole. Derived live on 2026-06-29 from a demo-agent connectivity test plus code
  reads across both repos; no prior document held this fix.
---

# Relay/Directory Any-to-Any — Removing the Directory→Relay recordAssignment Dial

## Why this exists

`relay_unavailable` on session initiation has recurred for months. Each time it has been
"fixed" by bouncing a relay, and each time it comes back on the next directory restart.
This log pins the actual root cause and specifies a fix that removes the failure class
entirely, instead of papering it over again. It also records that the any-relay/any-directory
property is **foundational and documented from day one** — it keeps getting silently
minimized in implementation, and that minimization is the bug.

## The vision (foundational, not a later idea)

- `cello-initial-design.md:1229` — "No single node has a privileged relationship with a
  specific agent — a client may prefer a recently-used node for latency, but can move to any
  other node at any time."
- `cello-initial-design.md:1234` — "Discovery, verification, FROST ceremonies, and hash relay
  work on any directory node… There is no node migration procedure because there is no
  privileged node to migrate from."
- `server-infrastructure.md:207` — "there is no 'primary' directory node for signing
  purposes. Any t-of-n nodes can participate; the client selects the set."
- `server-infrastructure.md:268` — "Backup selection for relay nodes is dynamic per session:
  agent picks 2–3 lowest-latency relay nodes at session establishment."
- `protocol-map.md:67/164` — "All directory data is fully federated across all nodes… No
  single node has a privileged relationship with any agent."

The principle: **the client picks the nodes; the directory only signs.** Any directory, any
relay. The agent picks its relay(s) at session establishment.

## Root cause of the recurring `relay_unavailable`

Evidence-backed against the live us-east-1 dev cluster on 2026-06-29:

1. Session brokering defaults to `transport_mode = 'relay'` (`directory-node.ts:2884`). In
   relay mode the directory calls `recordAssignment` on a single pinned `#relay`
   `NetworkRelayAdapter` to register the assignment WITH a relay over the network.
2. That adapter is initialized to `registryResult.relays[0]` (`bin/directory.ts:568`) — the
   alphabetically-first SSM region. `aws ssm get-parameters-by-path` returns lexically:
   `aws-ap-northeast-1` < `aws-eu-central-1` < `aws-us-east-1`. So the **us-east-1 directory
   pins its recordAssignment target to the ap-northeast-1 relay**, which it cannot dial
   (`Could not connect to ws://relay-ap1…`) → `relay.record_assignment.transport_error` →
   `relay_unavailable` on every session.
3. The only thing that ever corrects the adapter is the LOCAL relay re-registering
   (`relay_register` handler → `updateMultiaddr`, `directory-node.ts:904-914`) to its
   VPC-internal IP. After a directory restart the relay never re-registers (no reconnect
   logic), so the adapter stays pinned to ap1 until the relay is manually bounced.
4. Separately, `pickRelay()` (the relay ADVERTISED to the client) reads the S3 manifest pool
   (us1 only) — so the directory tells the client "use us1" while recording the assignment
   against "ap1". Two code paths, two relay sources, disagreeing.

This is NOT "the directory sees no relay" — it loads relays fine and health-checks us1 green.
It is a single pinned adapter aimed at the wrong relay, corrected only by a registration
handshake that doesn't survive a directory restart.

## The durable fix — delete the directory→relay dial

The directory should not own or dial a relay at all. The directory authorizes a **session**;
the **client** carries that authorization to whatever relay(s) it picks; the **relay**
verifies it. This collapses two signatures into one and removes the entire failure class.

Today the directory makes two signatures: a FROST signature for the client (which the client
**does not even verify** — `cello-client daemon.ts:3160`, "accept directory-pushed assignments
on trust" — a real forgery hole), and a separate Ed25519 node-key signature pushed to the
relay via `recordAssignment` and verified against the relay's single pinned `#directoryPubkey`.
The fix uses only the FROST signature.

**1. Directory (`packages/directory`):** delete `recordAssignment`, the `#relay` adapter,
`updateMultiaddr`, the `relays[0]` startup pin, and the `/cello/directory-relay` path.
`session_request` brokers + FROST-signs the `SessionAssignment` and returns it. Nothing dials
a relay. (Deletes the ap1 pin, the region coupling, the registration dependency, and the
restart fragility in one move.)

**2. Client (`cello-client`, core/daemon):** (a) **verify** the FROST signature on the
received assignment — closing the deferred SESSION-004 security hole; (b) after its existing
relay nonce-challenge auth, send the FROST-signed assignment to the relay before submitting
hashes; (c) **pick its own relay(s)** — the design's 2–3 lowest-latency — instead of using a
directory-chosen `relay_endpoint`. The client already holds the FROST sig + `signer_pubkey`;
`buildSessionEstablishmentTbs` is already a shared protocol-types export.

**3. Relay (`packages/relay`):** accept the client-presented assignment on `/cello/relay/1.0.0`
after the existing nonce-challenge auth; verify the **FROST signature against the consortium
group key from the manifest the relay already polls** (NOT a pinned single directory key — that
is what makes it any-directory); then record the session inline (the exact logic
`recordAssignment` runs today; `hash_submit` already hard-depends on a recorded session, so this
keeps that precondition while changing only WHO presents it).

The assignment names participants, not a relay, so the signature does not bind a specific
relay — any relay the client picks can verify and serve it. That is any-relay/any-directory as
written.

## Feasibility (confirmed by reading both repos, 2026-06-29)

- Relay already verifies a directory signature, with a pinned directory key, over a fixed TBS;
  `hash_submit` already requires a recorded session. Moving the assignment source from
  directory-push to client-present is a protocol refactor with **zero new cryptography**
  (relay-side investigation, `packages/relay/src/relay-node.ts:485-546`).
- Client already receives the FROST-signed assignment and already auths to the relay via
  Ed25519 nonce-challenge; it just needs to forward the assignment and verify the FROST sig
  (client-side investigation, `cello-client core/daemon/src/session-relay-client.ts`,
  `daemon.ts:887/3160/466`).

## Hardening note (do not re-minimize)

The relay currently pins ONE directory key (`#directoryPubkey`). For true any-directory the
relay must verify the assignment against the **consortium FROST group key** (the same threshold
identity clients already trust via the manifest), so any directory node's assignment is
honored by any relay — not just one node's.

## Status / next step

This is a cross-repo protocol change (directory + relay + client) with a coordinated
`@cello-protocol/*` version bump and trustless-cello dependency update. It is a genuine story,
not a hotfix. Write it via `/cello-story` on Andre's go. Immediate operational unblock remains:
force-new-deployment of the regional relay so it re-registers and repoints the adapter.

Related: [[2026-04-17_1400_directory-relay-architecture-reassessment]],
[[2026-06-06_2100_sovereign-node-networking-requirements]],
[[2026-06-11_0822_transport-security-audit-and-libp2p-primitives]] (relay-identity gap, same family).
