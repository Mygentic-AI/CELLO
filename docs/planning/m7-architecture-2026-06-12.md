---
name: M7 Architecture Overview
type: reference
date: 2026-06-12
topics: [daemon, architecture, flow, libp2p, frost, tuf, manifest, session, transport, m7]
status: superseded-in-part
description: >
  Master architecture and flow reference for CELLO post-M7. Covers component
  layout, libp2p primitives in use, the TUF-aligned manifest model, every major
  protocol flow from onboarding through seal, and the SQLCipher data model.
  Supersedes all pre-M7 architecture documents for the client side. NOTE: its
  network-exposure security claims (ephemeral Peer IDs defeat DDoS, connectionGater
  rejects all non-counterparty peers) were verified against the code on 2026-08-21
  and found FALSE. See the correction banner below.
---

# CELLO Architecture — M7

> ## ⛔ CORRECTION — 2026-08-21: the network-exposure security claims in this document are FALSE
>
> A code audit on 2026-08-21 checked this document's transport security claims against
> what actually runs. **The component layout, protocol flows, and data model in this
> document remain accurate. The security claims about network exposure do not.**
>
> **What this document claims — and why each is wrong:**
>
> | Claim | Reality |
> |---|---|
> | "DDoS and cross-session linking are both defeated" (§Key Invariants) | Neither is defeated. The claim only ever described the **session node**, which binds loopback and was never reachable from the internet. The node that *is* reachable — the standing receiver — is per-agent, lives as long as the daemon, and is not covered by the ephemerality argument at all. |
> | "Each session node accepts exactly one peer. All others rejected before Noise" (§Key Invariants, §3) | True of session nodes; **false of the standing receiver**, which is the only node an outsider can reach. It is created with `allowedPeerId: null`, which the gater treats as *allow everyone*. |
> | "the rejected peer learns nothing — not even that CELLO is running" (§3) | Nobody is rejected on the standing receiver, so nothing is withheld. `identify` answers with the public key, listen addresses, and protocol list. |
> | Implied: the client is not dialable by strangers | Since 2026-07-14 the standing receiver takes a **circuit-relay reservation at agent-online, before any session exists**, and the relay installs no filter on who may dial a reservation holder. Every online agent is reachable from the internet, NAT irrelevant. |
>
> **The rationale in §1 was itself retracted.** This document justifies ephemerality as
> anti-DDoS. That justification was withdrawn on 2026-08-18: address secrecy was never
> the control, because the Noise handshake proves possession of the private key — a learned
> id is an address, not a credential. The governing rule is now *"leave nothing open that
> is no longer needed"*; the control is the **bound**, not the secrecy. The original (April
> 2026) rationale was **privacy/unlinkability**, not DDoS — see
> [[2026-04-11_1400_libp2p-dht-and-peer-connectivity]].
>
> **Do not cite this document for any security property.** For the current state see
> [[2026-08-17_2036_interrupted-sessions-why-they-cannot-resume]] (the retraction) and the
> 2026-08-21 relay/transport exposure audit.

> **This document reflects the system as it will exist after M7 is fully implemented.**
> All component stories (DAEMON-001 through DIR-PING-001) are specified; implementation
> is the next phase. Use this as the reference for understanding how everything fits
> together.

---

## 1. What Changed in M7

Before M7, each agent ran its own `CelloClient` with its own persistent libp2p node.
Two Claude sessions meant two processes, two directory connections, and two sets of
FROST shares in memory at the same time — with no coordination.

M7 rearchitects the client from the ground up around three insights:

1. **DDoS / unlinkability gap** — a persistent per-agent Peer ID means counterparties
   retain your network address across sessions. A session-scoped ephemeral node is the
   correct fix: after the session closes, the address is permanently dead.

2. **Multi-session concurrency** — multiple Claude sessions cannot share one cello-mcp
   process without conflicting over agent state, keys, and the IPC socket. A daemon
   model with per-connection current-agent state is required.

3. **Directory trust gap** — handshake steps 5–6 (directory → client authentication)
   were never implemented. The client trusted "it responded" — not a verified identity.
   A TUF-aligned signed manifest and per-node Ed25519 verification close this gap.

---

## 2. Component Map

```
┌──────────────────────────────────────────────────────────────────┐
│  OPERATOR'S MACHINE                                              │
│                                                                  │
│  ┌──────────┐   stdio    ┌──────────────────────────────────┐   │
│  │ Claude   │◄──────────►│  cello-mcp (MCP adapter)         │   │
│  │ session  │            │  @cello-protocol/connect         │   │
│  │    A     │            │  thin stdio-to-IPC proxy         │   │
│  └──────────┘            └──────────┬───────────────────────┘   │
│                                     │ Unix domain socket         │
│  ┌──────────┐   stdio    ┌──────────┴───────────────────────┐   │
│  │ Claude   │◄──────────►│  cello-mcp (MCP adapter)         │   │
│  │ session  │            │  per-connection current-agent    │   │
│  │    B     │            └──────────┬───────────────────────┘   │
│  └──────────┘                       │ ~/.cello/daemon.sock       │
│                                     │                            │
│                    ┌────────────────▼──────────────────────┐    │
│                    │  DAEMON  (cello login / cello logout)  │    │
│                    │                                        │    │
│                    │  ┌─────────────────────────────────┐  │    │
│                    │  │  Agent registry                 │  │    │
│                    │  │  alice: Registered/Online/Curr  │  │    │
│                    │  │  bob:   Registered              │  │    │
│                    │  └─────────────────────────────────┘  │    │
│                    │                                        │    │
│                    │  ┌─────────────────────────────────┐  │    │
│                    │  │  SessionNodeManager             │  │    │
│                    │  │  ┌────────────┐ ┌────────────┐  │  │    │
│                    │  │  │ standing   │ │ session    │  │  │    │
│                    │  │  │ receiver   │ │ node S1    │  │  │    │
│                    │  │  │ (libp2p)   │ │ (libp2p)   │  │  │    │
│                    │  │  └────────────┘ └────────────┘  │  │    │
│                    │  └─────────────────────────────────┘  │    │
│                    │                                        │    │
│                    │  ┌─────────────────────────────────┐  │    │
│                    │  │  Directory-facing node (libp2p) │  │    │
│                    │  │  SignalingManager               │  │    │
│                    │  │  heartbeat ping/pong every 15s  │  │    │
│                    │  │  exponential backoff reconnect  │  │    │
│                    │  └────────────┬────────────────────┘  │    │
│                    │               │                        │    │
│                    │  ┌────────────▼────────────────────┐  │    │
│                    │  │  SQLCipher DB                   │  │    │
│                    │  │  ~/.cello/daemon.db             │  │    │
│                    │  │  agents / sessions / conns /    │  │    │
│                    │  │  retry_queue / seen_nonces      │  │    │
│                    │  └─────────────────────────────────┘  │    │
│                    └───────────────┬───────────────────────┘    │
│                                    │                             │
│  ~/.cello/agents/<name>/           │ libp2p TLS + Noise          │
│    key  (K_local Ed25519)          │                             │
│    manifest.json (cached)          │                             │
└────────────────────────────────────┼─────────────────────────────┘
                                     │
                    ─────────────────┼──── INTERNET ────────────────
                                     │
         ┌───────────────────────────┼──────────────────────────┐
         │  CELLO INFRASTRUCTURE     │                          │
         │                           │                          │
         │  ┌──────────────────┐  ┌──▼──────────────────┐  ┌──────────────────┐
         │  │ Directory node   │  │ Directory node       │  │ Directory node   │
         │  │ us-east-1 (AWS)  │  │ eu-central-1 (AWS)   │  │ ap-northeast-1   │
         │  │                  │  │                      │  │ (AWS)            │
         │  │ signaling stream │  │ signaling stream     │  │ signaling stream │
         │  │ FROST ceremony   │  │ FROST ceremony       │  │ FROST ceremony   │
         │  │ AutoNAT prober   │  │ AutoNAT prober       │  │ AutoNAT prober   │
         │  │ ping/pong resp.  │  │ ping/pong resp.      │  │ ping/pong resp.  │
         │  └──────────────────┘  └─────────────────────┘  └──────────────────┘
         │           │                      │                         │
         │           └──────────────────────┼─────────────────────────┘
         │                      Logical replication (M5)
         │
         │  ┌──────────────────┐
         │  │  Relay node(s)   │
         │  │  Merkle engine   │
         │  │  hash submit /   │
         │  │  leaf deliver    │
         │  └──────────────────┘
         │
         │  ┌──────────────────────────────────────────────┐
         │  │  Consortium Manifest (TUF-aligned)           │
         │  │  version, not_before, expires                │
         │  │  nodes: [ { nodeId, pubkey, multiaddr } ]    │
         │  │  threshold_sig: 3-of-5 officer keys          │
         │  └──────────────────────────────────────────────┘
         └──────────────────────────────────────────────────────────┘
```

---

## 3. libp2p Primitives in Use

CELLO uses libp2p as its peer-to-peer networking substrate. Here is what each
libp2p feature does and where CELLO uses it.

### Transport + Security + Multiplexing

```
Every libp2p connection:

  TCP/QUIC transport
       │
  Noise handshake  ← cryptographic identity of the libp2p node (Peer ID)
       │              NOT K_local — these are different keys (ADR-0001)
  yamux multiplexer ← multiple logical streams over one TCP connection
       │
  Application streams (protocol IDs):
       ├─ /cello/signaling/1.0.0   ← daemon ↔ directory (auth + ceremony)
       ├─ /cello/session/1.0.0     ← session node ↔ counterparty session node
       └─ /libp2p/autonat/2.0.0    ← AutoNAT dial-back (directory → client)
```

**Noise** authenticates the libp2p transport layer. It proves "this TCP connection
was initiated by the holder of this libp2p keypair." It does NOT prove the remote
is a legitimate CELLO directory node — that is what the consortium manifest + steps
5–6 add on top.

**yamux** means one TCP connection carries all streams. The signaling stream and
any in-flight ceremony streams all share one connection to the directory.

### AutoNAT — Dialability Self-Knowledge

```
Daemon standing receiver needs to know: am I reachable from the outside?

  Standing receiver node
       │
       │ "Please try to dial me at /ip4/X.X.X.X/tcp/4001/p2p/PEER_ID"
       ▼
  Directory node (us-east-1)   ──► dial attempt ──► success? → dialable: true
  Directory node (eu-central-1) ──► dial attempt ──► ...
  Directory node (ap-northeast-1) ──► dial attempt ──► ...

  Any single success → dialable: true, publicAddr = confirmed external address
  All fail → dialable: false → advertise circuit relay address instead
```

Directory nodes run the AutoNAT **service** protocol (responder role).
The daemon's session nodes run the AutoNAT **client** protocol.
Three independent probers in three regions — each confirms dialability from its
own network position. No cross-node coordination required.

### dcutr — Hole-Punch Upgrade

```
Session established via relay circuit:

  Alice ──► relay circuit ──► Bob
                │
                │ dcutr tries to establish direct path in background
                │ (non-blocking — session is usable immediately)
                ▼
  If hole-punch succeeds:   Alice ─────────────────────────────► Bob
                             relay removed from data path (direct)
  If hole-punch fails:      Alice ──► relay circuit ──► Bob (continues, no error)
```

dcutr runs on session nodes only (not the standing receiver — it is a receiver,
not a dialer). Failure is non-fatal. The session continues over relay regardless.

> **⛔ STALE — corrected 2026-08-21.** Two things in the paragraph above are wrong.
>
> **1. DCUtR is on EVERY node, unconditionally**, and has been since 2026-07-14. The exclusion was
> removed that day (the standing receiver is the inbound side of a relayed connection, and the
> inbound side is what starts the upgrade — so excluding it was backwards). The code comment at
> `core/transport/src/node.ts` says so explicitly.
>
> **2. DCUtR never succeeds anyway.** `@libp2p/tcp` has **no port reuse** — no `localPort`, no
> `localAddress`, no `SO_REUSEPORT`; the option type does not carry them. A real hole punch requires
> the punch dial to leave from the *listening* port so the NAT mapping matches the advertised
> address. This transport dials from a fresh ephemeral port every time, so what runs is a timed
> direct dial, not a simultaneous-open punch. It succeeds only against a target that was already
> dialable — i.e. when no punch was needed. `DOD-TRANSPORT-PATH-1`: *"We have never once observed a
> successful hole punch in production."*
>
> **Consequence:** "the session continues over relay regardless" is not a fallback — for any session
> crossing a NAT boundary it is **the only path**. Same-machine and same-LAN sessions are direct
> because the address is directly dialable, no punch involved. See the 2026-08-21 live P2P exposure
> audit.

### Circuit Relay

When AutoNAT confirms not-dialable, the session node obtains a circuit relay
reservation from a CELLO relay node. The circuit relay address
(`/p2p-circuit/p2p/PEER_ID`) goes into the SessionAssignment.
Content still flows peer-to-peer via the relay — the relay sees only Merkle
structure (signed hashes), never content.

### connectionGater — Per-Session Allow-One

```
Each ephemeral session node has a connectionGater configured at creation:

  Inbound connection from PEER_ID_X
       │
  connectionGater.denyInboundConnection(connection)
       │
       ├─ PEER_ID_X == counterparty_session_peer_id? → ALLOW (Noise handshake proceeds)
       └─ anything else?                             → DENY (before Noise, no info leaked)
```

This is simpler and stronger than a shared-node allowlist. Because the gate fires
before the Noise handshake, the rejected peer learns nothing — not even that CELLO
is running.

> **⛔ FALSE as implemented (verified 2026-08-21).** This describes the *session node*.
> The **standing receiver** — the only node an outsider can actually reach — is built with
> `allowedPeerId: null`, and `#denyIfNotAllowed` returns *allow* when that is null. Nobody
> is rejected, so nobody "learns nothing": any peer completes the Noise handshake and
> `identify` answers with the pubkey, addresses, and protocol list.
>
> Two further gaps in the same mechanism:
> - **Narrowing the gate does not disconnect anyone.** When the receiver is promoted into a
>   session and `setAllowedPeer` narrows it, connections established *before* the narrowing
>   survive — libp2p's gater runs only at connection establishment. A peer who dialled the
>   open receiver earlier is still attached when `/cello/content/1.0.0` is registered.
> - **`DirectoryConnectionGater` is dead code.** It exists but is constructed only in tests,
>   so the directory-facing node (which binds `/ip4/0.0.0.0/tcp/0`) has no peer filtering at all.
>
> The intended gate is *"refuse any dialer whose peer id is not named in a live,
> directory-signed session assignment"* — workable because the responder always receives the
> offer and reports its peer id **before** the counterparty dials. That check is not implemented,
> and it depends on first verifying the assignment's signature, which the client also does not do.

---

## 4. The Consortium Manifest and TUF

CELLO's directory trust model is a direct subset of **TUF (The Update Framework)**
— the CNCF standard used by Sigstore, Google, and Chainguard for software supply
chain security. CELLO arrived at this design independently and then confirmed TUF
as the canonical reference.

### The Trust Chain

```
  Client binary (at build time)
  └─ Bakes in: 5 consortium root public keys (Ed25519)
               "No two officers subject to same jurisdiction's compelled-disclosure law"

       │ CELLO DOES NOT TRUST NETWORK REACHABILITY
       │ CELLO TRUSTS CRYPTOGRAPHIC PROOF

       ▼
  consortium manifest (JSON, bundled in npm package)
  ┌─────────────────────────────────────────────────────┐
  │  version:      42                                   │  ← monotonic; client rejects rollback
  │  not_before:   "2026-06-01T00:00:00Z"              │
  │  expires:      "2026-12-31T23:59:59Z"              │  ← client refuses to connect if expired
  │  nodes: [                                           │
  │    { nodeId: "dir-us-east-1",                      │
  │      pubkey: "abc123...",   ← per-node Ed25519 key │
  │      multiaddr: "/dns4/..." },                      │
  │    { nodeId: "dir-eu-central-1", ... },             │
  │    { nodeId: "dir-ap-northeast-1", ... }            │
  │  ]                                                  │
  │  threshold_sig: <3-of-5 officer Ed25519 signatures> │  ← client verifies all 3
  └─────────────────────────────────────────────────────┘

       ▼
  Each directory node's Ed25519 key (manifest.nodes[].pubkey)
  is used in handshake step 6 to verify the directory's identity
```

### Why Each TUF Property Matters

| TUF Property | What It Prevents | How CELLO Implements It |
|---|---|---|
| **t-of-n root keys in binary** | Single key compromise doesn't break trust | 5 officer keys, threshold 3, baked into binary |
| **version monotonicity** | Replay of old valid manifests pointing at decommissioned nodes | Client stores last-seen version in SQLCipher; rejects any manifest with lower version |
| **`not_before` / `expires`** | Stale manifest used indefinitely after nodes rotate | Client refuses directory connection when holding expired manifest |
| **Threshold signature** | Single officer can't unilaterally rotate node keys | 3-of-5 signatures required to publish a valid manifest |
| **In-band root key rotation** | Officers leave, lose keys — no forced binary update | New manifest signed by 3 existing keys adds replacement key, removes old one |
| **Periodic polling** | Client stuck on stale manifest when nodes change | Daemon polls every 6–12 hours (randomized — no thundering herd) |

### Where the Manifest Lives

```
  Build time:   bundled in @cello-protocol/connect npm package
  Runtime:      ~/.cello/manifest.json (last-validated cached copy)
  SQLCipher:    last_seen_manifest_version (prevents rollback across restarts)
  Background:   daemon polls directory signaling stream every 6–12 hours
```

---

## 5. Onboarding Flow

Registration is M0-era and unchanged by M7. What changes: `cello login` now
starts a daemon instead of a CelloClient, and K_local is stored per-agent.

```
  K_local storage change:
  Before M7:  ~/.cello/key          (single agent)
  After M7:   ~/.cello/agents/<name>/key   (one directory per agent)

  Backwards compat: legacy ~/.cello/key treated as agent named "default"
```

```
REGISTRATION FLOW (unchanged from M0/M5):

  Operator                 cello CLI              Directory cluster
     │                        │                         │
     │── cello register ──────►                         │
     │                        │── FROST DKG request ───►│
     │                        │                         │ Round 1: each directory node
     │                        │                         │ generates key share commitments
     │                        │◄─ Round 1 responses ───│
     │                        │                         │
     │                        │── Round 2 messages ────►│
     │                        │◄─ Round 2 responses ───│
     │                        │                         │
     │                        │  K_local + K_server_X   │
     │                        │  shares held by 3/3     │
     │                        │  directory nodes        │
     │                        │                         │
     │                        │── Registration record ──►│
     │                        │   (primary_pubkey,      │
     │                        │    agent_profiles row)  │
     │                        │                         │
     │◄─── Registration OK ───│                         │
     │                        │                         │
     │  ~/.cello/agents/<name>/key  ← K_local saved
     │  ~/.cello/agents/<name>/frost_shares ← saved
```

---

## 6. Daemon Startup Flow (`cello login`)

```
  cello login
       │
       ▼
  Is daemon already running?
  ├─ YES → connect to ~/.cello/daemon.sock (connect-or-start, not kill-and-replace)
  └─ NO  → spawn daemon process
                │
                ▼
         ┌─── MANIFEST VERIFICATION ──────────────────────────────────────┐
         │                                                                 │
         │  1. Load bundled manifest from npm package                      │
         │  2. Call verifyManifest(manifest, CONSORTIUM_ROOT_KEYS, 3)      │
         │     └─ Checks: threshold_sig valid (3-of-5 officer keys)        │
         │                version >= last_seen_version (SQLCipher)         │
         │                not_before <= now < expires                      │
         │  3. On failure:                                                 │
         │     manifest_expired       → refuse to connect, clear error     │
         │     manifest_sig_invalid   → refuse to connect, clear error     │
         │     manifest_version_rollback → refuse, clear error             │
         │  4. On success: emit directory.auth.manifest.verified           │
         │                 persist new version to SQLCipher                │
         └────────────────────────────────────────────────────────────────┘
                │
                ▼
         ┌─── DIRECTORY CONNECTION + 7-STEP HANDSHAKE ────────────────────┐
         │                                                                 │
         │  Daemon                           Directory node                │
         │    │                                   │                        │
         │    │── connect (libp2p Noise) ─────────►│                      │
         │    │── (1) pubkey: "I'm TravelBot" ────►│                      │
         │    │◄─ (2) challenge nonce ─────────────│                      │
         │    │── (3) sign(nonce + agentId +        │                      │
         │    │        directoryNodeId + ts)  ─────►│                      │
         │    │         (Ed25519, K_local)           │                      │
         │    │                                   (4) verify signature     │
         │    │                                   against registered pubkey│
         │    │◄─ (5) directory signs its own  ────│                      │
         │    │       challenge response            │                      │
         │    │       { type: "signaling_auth_ok",  │                      │
         │    │         nodeId, sig: Ed25519 }      │                      │
         │    │                                     │                      │
         │    │  (6) client verifies sig against     │                      │
         │    │      manifest.nodes[nodeId].pubkey   │                      │
         │    │      → mismatch: directory_challenge_failed → disconnect   │
         │    │      → match: emit directory.auth.challenge.verified       │
         │    │                                     │                      │
         │    │  ══════════ (7) authenticated ══════│                      │
         │    │             session established      │                      │
         └────────────────────────────────────────────────────────────────┘
                │
                ▼
         Load all agent identities from ~/.cello/agents/
         → each appears in Registered state (NOT auto-started Online)
         → operator must call cello_start_agent explicitly
                │
                ▼
         Validate persisted connection records against live directory
         (verified / stale / gone classification)
                │
                ▼
         Scan SQLCipher for sessions with status='active' left by prior SIGKILL
         → mark interrupted, source: 'daemon_restart'
         → surface in interrupted_sessions on cello status
                │
                ▼
         Create standing receiver node for each Online agent
         → run AutoNAT probe using directory nodes as probers
         → determine dialability before accepting any inbound session
                │
                ▼
         Start SignalingManager heartbeat (ping every 15s)
         Start background manifest poll task (first poll in 6–12 hours)
                │
                ▼
         DAEMON READY — cello status reports:
           daemon: running
           directory_signaling: connected
           agents: [{ name, state: 'registered' }, ...]
           interrupted_sessions: [...]   ← if any
```

---

## 7. Three Agent States

```
                    ┌─────────────────────────────────────┐
                    │         REGISTERED                  │
                    │  identity in ~/.cello/agents/<name> │
                    │  FROST complete, known to network   │
                    │  NOT online from this daemon        │
                    └─────────────┬───────────────────────┘
                                  │ cello_start_agent
                                  ▼
                    ┌─────────────────────────────────────┐
                    │           ONLINE                    │
                    │  directory connection active        │
                    │  can receive session requests       │
                    │  standing receiver node running     │◄───────────────┐
                    └─────────────┬───────────────────────┘                │
                                  │ cello_use_agent          cello_use_agent│
                                  │ (per connection)         (switch away) │
                                  ▼                                         │
                    ┌─────────────────────────────────────┐                │
                    │           CURRENT                   │──────────────►─┘
                    │  per-connection state               │
                    │  this MCP connection's tool calls   │
                    │  route to this agent                │
                    │  one current agent per connection   │
                    └─────────────────────────────────────┘

  Multiple agents can be Online simultaneously.
  Each IPC connection (Claude session) has its own independent Current agent.
  Switching Current in connection A does not affect connection B.

  agent_state_changed notifications → ALL IPC connections (broadcast)
  agent_current_changed notifications → triggering connection ONLY
  session_state_changed notifications → connections where affected agent is Current
```

---

## 8. Session Flow — Happy Path

```
  Alice (connection A)              Directory               Bob (standing receiver)
       │                               │                           │
       │── cello_initiate_session ─────►                           │
       │   (counterparty_pubkey: Bob)  │                           │
       │                               │── SessionRequest ────────►│
       │                               │   (Alice's session PeerID │
       │                               │    + multiaddr)           │
       │                               │                           │
       │                               │── SessionOfferAccept ─────│
       │                               │   (Bob's session PeerID   │
       │                               │    + multiaddr)           │
       │                               │                           │
       │                    FROST CEREMONY (session establishment) │
       │                               │                           │
       │                    context: "cello-frost-session-establishment-v1"
       │                    TBS: [session_id, alice_pubkey,        │
       │                          bob_pubkey, genesis_prev_root,   │
       │                          timestamp,                       │
       │                          alice_session_peer_id,           │
       │                          alice_session_addrs,             │
       │                          bob_session_peer_id,             │
       │                          bob_session_addrs,               │
       │                          transport_mode]                  │
       │                               │                           │
       │◄── SessionAssignment ─────────│────────────────────────── │
       │    (FROST-signed, carries     │                           │
       │     both session Peer IDs,    │                           │
       │     multiaddrs,               │                           │
       │     transport_mode)           │                           │
       │                               │                           │
       │  TRANSPORT SELECTION (see §9) │                           │
       │       │                       │                           │
       │  Creates ephemeral session node (fresh Peer ID, fresh libp2p keypair)
       │       │                       │                           │
       │       │                       │         Bob's standing receiver consumed
       │       │                       │         New standing receiver spawned immediately
       │       │                       │                           │
       │◄─────────── direct P2P or relay circuit ────────────────►│
       │                  session established                      │
```

### Message Exchange

```
  Alice                    Relay node                   Bob
    │                          │                          │
    │  cello_send(content)     │                          │
    │  signs Structure 1 leaf  │                          │
    │  TBS: [protocol_version, │                          │
    │        content_hash,     │                          │
    │        sender_pubkey,    │                          │
    │        session_id,       │                          │
    │        last_seen_seq,    │                          │
    │        timestamp]        │                          │
    │── hash_submit ──────────►│                          │
    │   (signed hash only,     │                          │
    │    content stays local)  │                          │
    │                          │ assigns seq number        │
    │                          │ builds Merkle tree leaf   │
    │                          │ computes prev_root        │
    │                          │── leaf_deliver ──────────►│
    │                          │   Structure 2             │
    │                          │   (Structure 1 + seq +    │
    │                          │    prev_root)             │
    │                          │                          │
    │                          │         Bob calls cello_receive
    │                          │         content retrieved from local queue
    │                          │         (content travels direct, never via relay)

  Key point: the relay sees session Peer IDs and signed hashes — never content,
  never K_local keys. Content travels on the direct P2P or circuit relay path
  SEPARATE from the Merkle hash submission.
```

---

## 9. Transport Selection

```
                    SessionAssignment arrives
                           │
                    Read transport_mode field
                    (FROST-signed — authoritative;
                     never infer from address format)
                           │
              ┌────────────┴─────────────┐
              │ 'direct'                 │ 'relay'
              ▼                         ▼
       Dial counterparty          Dial relay circuit
       session Peer ID            address
       directly (TCP/QUIC)              │
              │                         │
         Success?                  relay connected
              │                         │
         ┌────┴────┐                    │
         │ YES     │ NO                 │
         ▼         ▼                    ▼
    session via  WARN: direct_    session via relay
    direct P2P   dial_failed      circuit
                 falling_back           │
                 _to_relay              │
                      │                 │
                      ▼                 ▼
                  dial relay ─────► dcutr hole-punch
                  circuit           attempt (background,
                      │             non-blocking)
                      │                 │
                  Success?         ┌────┴────┐
                      │            │ YES     │ NO
                  ┌───┴───┐        ▼         ▼
                  │ YES   │ NO  upgrade to  continue
                  ▼       ▼    direct P2P  via relay
              session  ERROR:              (no error)
              via relay relay_fallback
                         _also_failed
```

**The signed `transport_mode` field is the only authority.** The transport
selector never parses address format to infer the mode. This is a security
property: `transport_mode` is FROST-signed; an inferred mode could be manipulated
by controlling the address strings.

---

## 10. FROST Bookends

FROST appears exactly twice per session: once to open, once to close.

### Opening — Session Establishment

```
  Initiator (Alice)          Directory (3 nodes)
       │                          │
       │── initiate FROST ────────►│
       │   ceremony               │ Each node independently
       │                          │ generates its round 1
       │                          │ output using K_server_X
       │◄─ round 1 outputs ───────│
       │                          │
       │── round 2 messages ──────►│
       │◄─ round 2 outputs ───────│
       │                          │
       │  Combine: K_local + K_server_X shares
       │  → combined FROST signature
       │
       TBS array (context: "cello-frost-session-establishment-v1"):
       [ session_id, alice_pubkey, bob_pubkey, genesis_prev_root, timestamp,
         alice_session_peer_id, alice_session_addrs,
         bob_session_peer_id, bob_session_addrs,
         transport_mode ]
       → embedded in SessionAssignment
       → counterparty verifies against alice's primary_pubkey
```

### Closing — Seal Ceremony

```
  Alice          Relay          Directory (3 nodes)         Bob
    │               │                  │                      │
    │ cello_close_session               │                      │
    │               │                  │                      │
    │── SEAL leaf ──►                  │                      │
    │   (signed by  │                  │                      │
    │    K_local)   │── SEAL leaf ────►│                      │
    │               │   (relay hands   │                      │
    │               │   full sequence  │ Recomputes Merkle     │
    │               │   to directory)  │ tree; verifies all    │
    │               │                  │ signatures and        │
    │               │                  │ causal chain          │
    │               │                  │                      │
    │               │◄─ seal_verified ─│                      │
    │               │                  │                      │
    │── FROST ceremony ───────────────►│                      │
    │   (seal initiator coordinates)   │                      │
    │                                  │ Embeds FROST sig in   │
    │                                  │ SealNotarization      │
    │                                  │                      │
    │◄─ session_sealed ────────────────│─────────────────────►│
    │   SealNotarization               │   Both parties        │
    │   (sealed_root, frost_sig)       │   receive it          │
    │                                  │                      │
    │  TBS (context: "cello-frost-seal-v1"):
    │  [ session_id, sealed_root, leaf_count, timestamp ]
    │  → domain context prevents establishment sig replay as seal
```

### Seal-Interrupted Variant (M7 extension)

When a session was interrupted before seal:

```
  Alice                 Directory signaling              Bob
    │                   (pass-through router)              │
    │                          │                           │
    │── SealInterruptedRequest ─►── forward to Bob ───────►│
    │   (sessionId, leafCount,  │                           │
    │    nonce)                 │                           │
    │                           │                           │
    │◄─ SealInterruptedAck ──────◄─ from Bob ──────────────│
    │   (signed SEAL-INTERRUPTED │                           │
    │    control leaf:           │                           │
    │    sessionId, leafCount,   │                           │
    │    merkleRootAtInterruption│                           │
    │    signerPubkey)           │                           │
    │                           │                           │
    │  verify Bob's K_local sig  │                           │
    │  append SEAL-INTERRUPTED  │                           │
    │  leaf to Merkle tree      │                           │
    │                           │                           │
    │  run normal FROST seal ceremony (unchanged) ──────────►
    │  context: "cello-frost-seal-v1"
    │  merkleRootAtInterruption (includes SEAL-INTERRUPTED leaf)
```

---

## 11. Signaling Stream Resilience

The SignalingManager owns the connection between the daemon and the directory.
It is the most important connection in the system — all FROST ceremonies, session
negotiations, and manifest polls flow through it.

```
  HEARTBEAT (prevents silent stream death):

  Daemon                     Directory
    │                            │
    │──── ping { ts: N } ───────►│  (every 15 seconds)
    │◄─── pong { ts: N } ────────│  (within 1 second)
    │                            │
    If no pong within 15s → stream declared dead
    Maximum detection time: 30s (one full ping-pong cycle)
```

```
  STATE MACHINE:

  ┌──────────────────────────────────────────────────────────────────┐
  │                                                                  │
  │          heartbeat timeout / stream error                        │
  │                  ┌────────────────────┐                         │
  │                  │                    │                         │
  │  ┌───────────┐   │   ┌─────────────────────────┐               │
  │  │ CONNECTED │───┴──►│    RECONNECTING          │               │
  │  └───────────┘       │                          │               │
  │       ▲              │  attempt 1: wait 1s      │               │
  │       │              │  attempt 2: wait 2s      │               │
  │       │              │  attempt 3: wait 4s      │               │
  │       │              │  attempt 4: wait 8s      │               │
  │       │              │  ...doubles each time... │               │
  │       │              │  cap: 60s max wait       │               │
  │       │              │  max: 10 attempts        │               │
  │       │              │                          │               │
  │       │              │  Each attempt: try next  │               │
  │       │              │  node from manifest list │               │
  │       │              │  (round-robin, not fixed)│               │
  │       │              └──────────┬───────────────┘               │
  │       │                         │                               │
  │       │    reconnect success    │  10 attempts exhausted        │
  │       └─────────────────────────┘         │                     │
  │                                           ▼                     │
  │                                    ┌──────────┐                 │
  │                                    │   LOST   │                 │
  │                                    │ operator │                 │
  │                                    │ must run │                 │
  │                                    │ cello    │                 │
  │                                    │ logout + │                 │
  │                                    │ login    │                 │
  │                                    └──────────┘                 │
  └──────────────────────────────────────────────────────────────────┘
```

```
  OUTBOUND QUEUE DURING RECONNECT:

  Two-tier model:

  MCP tool calls (LLM-initiated):
    → return immediately with:
      { ok: false, reason: 'signaling_reconnecting',
        guidance: 'Wait for directory_signaling: connected before retrying' }
    → NOT queued (LLM needs actionable response now)

  Daemon-internal protocol ops (FROST ceremony, manifest poll):
    → queued in FIFO order (up to 64 ops)
    → held pending until stream restored
    → drained in FIFO order after reconnect before any new ops
    → if queue full: reject with signaling_queue_full
```

---

## 12. Interrupted Session Handling

Three distinct detection paths — each produces `source` field in
`session.interrupted.detected` log event:

```
  PATH 1: Graceful daemon shutdown (SIGTERM / cello logout)
  ─────────────────────────────────────────────────────────
  Before shutdown: mark all 'active' sessions → 'interrupted'
  source field at next login: not applicable (already marked)
  The sessions are already marked before the process exits.


  PATH 2: SIGKILL (daemon killed without cleanup)
  ─────────────────────────────────────────────────────────
  After SIGKILL: 'active' rows remain in SQLCipher (never updated)
  At next cello login: DAEMON-002 scans for 'active' rows
    → marks each 'interrupted', source: 'daemon_restart'
  Surfaced in interrupted_sessions on cello status.


  PATH 3: Remote disconnect (relay detects peer dropout)
  ─────────────────────────────────────────────────────────
  Relay detects B's stream close → sends session_interrupted frame to A
    { type: 'session_interrupted', sessionId, reason: 'peer_disconnected' }
  A's daemon receives frame → marks 'interrupted', source: 'relay_frame'
  If relay itself crashes before sending frame:
    A's daemon detects relay stream close → marks 'interrupted', source: 'stream_close'
```

```
  STATUS FIELD IN cello status:

  interrupted_sessions: [
    {
      sessionId: "abc...",
      agentName: "alice",
      counterpartyPubkey: "def...",
      messageCount: 7,        ← leaves at interruption
      interruptedAt: "2026-06-12T14:30:00Z"
    }
  ]

  Operator choices:
  1. cello seal <session-id>  → bilateral seal-interrupted flow (see §10)
  2. cello discard <session-id> → mark discarded, no seal
```

---

## 13. SQLCipher Data Model

All client-side persistent state lives in `~/.cello/daemon.db` (SQLCipher —
AES-256-GCM encrypted at rest, key derived from K_local).

```
  ┌──────────────────────────────────────────────────────────────────┐
  │  TABLE: agents                                                   │
  │  One row per registered agent                                    │
  │  ─────────────────────────────────────────────────────────────  │
  │  agent_name        TEXT PK                                       │
  │  k_local_pubkey    TEXT    ← K_local public key hex              │
  │  frost_shares      BLOB    ← serialized FROST share state        │
  │  primary_pubkey    TEXT    ← group public key from DKG           │
  │  state             TEXT    ← 'registered' | 'online'            │
  │  created_at        TEXT                                          │
  │                                                                  │
  │  Survives restart: YES. This is the agent's identity.            │
  └──────────────────────────────────────────────────────────────────┘

  ┌──────────────────────────────────────────────────────────────────┐
  │  TABLE: connections                                              │
  │  One row per known counterparty                                  │
  │  ─────────────────────────────────────────────────────────────  │
  │  counterparty_pubkey  TEXT PK                                    │
  │  display_name         TEXT                                       │
  │  status               TEXT  ← 'verified' | 'unverified' |       │
  │                                'stale' | 'gone'                  │
  │  last_verified_at     TEXT                                       │
  │                                                                  │
  │  Survives restart: YES. Re-validated at cello login.             │
  └──────────────────────────────────────────────────────────────────┘

  ┌──────────────────────────────────────────────────────────────────┐
  │  TABLE: sessions                                                 │
  │  One row per session (active, sealed, interrupted, discarded)    │
  │  ─────────────────────────────────────────────────────────────  │
  │  session_id            TEXT PK                                   │
  │  agent_name            TEXT FK → agents                         │
  │  counterparty_pubkey   TEXT                                      │
  │  status                TEXT  ← 'active' | 'sealed' |            │
  │                                 'interrupted' | 'discarded'      │
  │  message_count         INTEGER  ← leaves at last known state    │
  │  merkle_root           TEXT     ← root at seal / interruption   │
  │  frost_notarization    BLOB     ← SealNotarization (if sealed)  │
  │  interrupted_at        TEXT                                      │
  │  created_at / updated_at                                         │
  │                                                                  │
  │  Survives restart: YES. Active rows scanned at login for SIGKILL │
  └──────────────────────────────────────────────────────────────────┘

  ┌──────────────────────────────────────────────────────────────────┐
  │  TABLE: retry_queue                (DAEMON-003)                  │
  │  FIFO per session, max 1000 entries, oldest evicted              │
  │  ─────────────────────────────────────────────────────────────  │
  │  id              INTEGER PK                                      │
  │  session_id      TEXT FK → sessions                             │
  │  message_payload BLOB    ← serialized (Uint8Array fields typed) │
  │  attempts        INTEGER                                         │
  │  created_at      TEXT                                            │
  │                                                                  │
  │  Survives restart: YES. Drained when peer reconnects.            │
  │  Serialization: Uint8Array fields use Buffer.toString('hex')     │
  │  before persist; restored with Buffer.from(hex, 'hex').          │
  └──────────────────────────────────────────────────────────────────┘

  ┌──────────────────────────────────────────────────────────────────┐
  │  TABLE: session_seen_nonces        (DAEMON-003)                  │
  │  Per-session LRU, max 10,000 entries per session                 │
  │  ─────────────────────────────────────────────────────────────  │
  │  session_id  TEXT                                                │
  │  nonce       TEXT    ← hex                                       │
  │  seen_at     TEXT                                                │
  │  PRIMARY KEY (session_id, nonce)                                 │
  │                                                                  │
  │  Survives restart: YES. Prevents replay after daemon restart.    │
  └──────────────────────────────────────────────────────────────────┘

  ┌──────────────────────────────────────────────────────────────────┐
  │  TABLE: manifest_state                                           │
  │  Single row — manifest version monotonicity enforcement          │
  │  ─────────────────────────────────────────────────────────────  │
  │  last_seen_version  INTEGER   ← reject any manifest with lower  │
  │  updated_at         TEXT                                         │
  │                                                                  │
  │  Survives restart: YES. Critical for rollback prevention.        │
  └──────────────────────────────────────────────────────────────────┘

  EPHEMERAL (in-memory only — NOT in SQLCipher):
  ─────────────────────────────────────────────
  Session nodes (libp2p)     ← fresh Peer ID per session; gone on daemon stop
  Standing receiver node     ← recreated at startup for each Online agent
  Directory-facing node      ← recreated at startup; Peer ID changes each reconnect
  Outbound signaling queue   ← 64-op FIFO; lost on daemon stop (by design)
  Per-connection current-agent state ← per IPC connection; lost on disconnect
```

---

## 14. MCP Adapter and IPC

```
  Claude session (process A)              Claude session (process B)
       │                                          │
       │  stdio JSON-RPC (MCP protocol)           │  stdio JSON-RPC
       ▼                                          ▼
  cello-mcp binary                          cello-mcp binary
  (thin proxy)                              (thin proxy)
       │                                          │
       │  Unix domain socket                      │
       │  ~/.cello/daemon.sock                    │
       └───────────────────┬──────────────────────┘
                           │
                     ┌─────▼──────────────────────────────┐
                     │  Daemon IPC handler                │
                     │                                    │
                     │  Connection A state:               │
                     │    currentAgent: 'alice'           │
                     │    connectionId: 'conn-001'        │
                     │                                    │
                     │  Connection B state:               │
                     │    currentAgent: 'bob'             │
                     │    connectionId: 'conn-002'        │
                     │                                    │
                     │  NotificationDispatcher            │
                     │  routing table:                    │
                     │  ┌──────────────────────────────┐ │
                     │  │ agent_state_changed          │ │
                     │  │   → ALL connections          │ │
                     │  │ agent_current_changed        │ │
                     │  │   → triggering conn ONLY     │ │
                     │  │ session_state_changed        │ │
                     │  │   → connections where agent  │ │
                     │  │     is Current               │ │
                     │  └──────────────────────────────┘ │
                     └────────────────────────────────────┘
```

---

## 15. What the Operator Sees

```
  $ cello login
  Daemon started. Connected to directory (eu-central-1).
  1 agent registered: alice
  Run `cello start alice` or call cello_start_agent to bring alice online.

  $ cello start alice
  alice is now Online. Standing receiver ready.

  $ cello status
  {
    "daemon": "running",
    "directory_signaling": "connected",
    "agents": [
      { "name": "alice", "state": "online", "standing_receiver_ready": true }
    ],
    "connections": [ ... ],
    "interrupted_sessions": []
  }

  [In Claude Code — alice is set as Current by the MCP adapter]
  [Session initiated — ephemeral session node created]
  [Messages exchanged — content travels P2P or via relay]
  [Seal ceremony — FROST notarization produced]
  [Session node torn down — that Peer ID is permanently gone]

  $ cello logout
  Graceful shutdown. Active sessions marked interrupted.
  Daemon stopped.
```

---

## Key Invariants

| Invariant | What It Means |
|---|---|
| **Sovereign directory nodes** | 3 nodes, 3 regions, independently operated. No single node can complete a FROST ceremony. No region failure takes down the system. |
| ~~**Ephemeral session Peer IDs**~~ ⛔ **FALSE** | ~~After seal, a recorded session address leads nowhere. DDoS and cross-session linking are both defeated.~~ **Neither is defeated.** True only of the session node, which binds loopback and was never reachable. The reachable node (standing receiver) is per-agent, lives as long as the daemon, and its address does not die at seal. Verified 2026-08-21. |
| ~~**connectionGater per session node**~~ ⛔ **FALSE** | ~~Each session node accepts exactly one peer. All others rejected before Noise — they learn nothing.~~ **The standing receiver accepts everyone** (`allowedPeerId: null` = allow-all), and narrowing the gate at promotion does not close connections already open. Verified 2026-08-21. |
| **transport_mode is FROST-signed** | The dial strategy cannot be influenced by controlling address strings. Only the signed field is authoritative. |
| **Manifest version monotonicity** | An attacker who serves a stale manifest gains nothing — the client rejects it and disconnects. |
| **No auto-seal on session_interrupted** | The relay frame is unsigned. A malicious relay cannot force FROST ceremony consumption. Operator must explicitly seal. |
| **Never docker push from local** | All image pushes via CI/CD only. ECR replication for cross-region. |
| **Batch directory/relay pipeline pushes** | WIRE-001 + SESSION-001 + MANIFEST-002 always pushed together. One 25-30 min pipeline run, not three. |
