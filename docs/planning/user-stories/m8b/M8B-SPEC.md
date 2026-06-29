---
name: M8B Federation Milestone — Spec
type: spec
date: 2026-06-29
milestone: M8B
status: active
topics: [federation, t-of-n, frost, dkg, directory-relay, option-b, relay-signed-ordering, cross-node-replication, share-refresh, overnight]
description: >
  The design reference for M8B — the CELLO federation milestone. Goal: make "any directory,
  any relay, no single mandatory node" real. T-of-N is the spine; everything else hangs off it.
  Pairs with M8B-DEFINITION-OF-DONE.md (the yardstick), M8B-PROCEDURE.md (the runbook),
  M8B-BUILD-JOURNAL.md (the audit trail + status board), M8B-DECISIONS.md (every fork + choice).
  Authored 2026-06-29 ~20:00 with Andre awake; he resolved all forks (see §3 + DECISIONS).
---

# M8B Federation Milestone — Spec

## 1. The goal

Make the sovereign-node invariant REAL end to end: **any directory, any relay, and no single node
is mandatory** for any ceremony. Today every signing surface is a 2-of-2 stopgap (client + one
mandatory directory node) and the directory→relay path is same-region-pinned. M8B removes both.

T-of-N is the spine. Once "any T of N directories co-sign" is real, the directory↔relay fix, the
seal, the suspend/burn security, and the M8 cross-node items all become coherent rather than stopgaps.

## 2. Current reality (verified in code 2026-06-29 — build on this, do not re-derive)

**T-of-N — crypto & protocols are LIVE and genuinely T-of-N; the limit is wiring.**
- Primitive `@noble/curves` ed25519_FROST (RFC 9591) — arbitrary T-of-N, no clamp (`core/crypto/src/frost/`).
- DKG: real 3-round interactive VSS DKG (`runNetworkDkg`, `network-directory-node.ts:567`; directory `frost-handler.ts:702-859`). Already loops over `opts.directoryNodes`.
- Ceremony: client is coordinator; built-in node-exclusion/retry (`frost-threshold-signer.ts:322-510`).
- **2-of-2 is exactly:** hardcoded `participants:1, threshold:2` at `registration-manager.ts:263` (`directoryNodes:[dirNode]`) + `session-ceremony.ts:166` (`directoryNodeStubs=[stub]`) + directory `directory-node.ts:2309-2310`; fed by a single-endpoint resolver (`directory-bootstrap.ts:95`) and a placeholder one-node manifest (`consortium-manifest.json`).
- **Share refresh/rotation: NOT-BUILT** (epoch is a frozen `:epoch:1` literal).
- Suspend honor-check: live + fail-closed per node (`directory-node.ts:1080-1111`), but one node can't distinguish quorum-refusal from single-node-refusal.

**Directory↔relay — same-region-pinned + relay ordering unsigned.**
- `recordAssignment` / `getSealLeaves` / `confirmSeal` go directory→relay over port 4001, SG-locked to the same-region directory (`network-relay-adapter.ts`). The startup default pins `relays[0]` (alphabetical = ap1); only a local relay re-registration repoints it → breaks on every directory restart.
- Relay's ordering (Structure2 `sequence_number`) is an **unsigned, unauthenticated** field. The relay-signed ACK machinery (PERSIST-012) is fully built but stranded in the **dead `core/client` stack**; the live daemon's ACKs are unsigned.
- Relay exposure (all 3 regions): client port **4002 is public via ALB:80**; directory port **4001 is private same-region SG**. SGs can't cross regions — the structural block on cross-region directory→relay.

**Cross-node directory state — mutable per-node state not replicated.**
- `agent_presence` + `directory_nodes` excluded from `cello_pub` → agents owned by another region read offline. `pickup_queue` (WebAuthn ciphertext) not replicated (BIGSERIAL collision) → undelivered cross-node. (M8 handoff doc items #1/#2.)

**The unifying disease:** in-memory / node-local state pinned on one node and never rebuilt or
replicated. Fix family: replicate (directory↔directory via cello_pub) or route-through-signed-
artifacts (directory↔relay via the client).

## 3. Target architecture (decisions baked — see DECISIONS for the forks)

**T-of-N via client-as-coordinator relay (DECIDED).** The client (already the coordinator) discovers
N directory nodes from a real signed consortium manifest, runs DKG with all N (relaying DKG round-2
unicast shares between nodes — shares are VSS-verifiable so the client can't tamper), and signs/seals
with any T of N (existing exclusion/retry). Each directory node ends holding its OWN K_server share for
the same group key. **Directories never talk to each other for signing** — the client is the hub. This
sidesteps cross-region directory↔directory (which SGs can't express). Quorum-aware suspend refusal
becomes meaningful (≥ N−T+1 refusals ⇒ no signature).

**FROST share refresh/rotation (IN SCOPE — widest).** Proactive refresh/resharing so a slowly-
compromised node set can't accumulate ≥T shares; real epoch rollover replacing the frozen literal.

**Directory↔relay = Option B (DECIDED).** Directory FROST-signs the assignment and returns it to the
client; client presents it to whatever relay(s) it picks; relay verifies vs the consortium group key.
Directory NEVER dials a relay — delete `recordAssignment`/`#relay` pin/`getSealLeaves`/`confirmSeal` as
directory→relay calls. **Relay-signed ordering (un-defer DOD-MSG-4 Finding 2):** port PERSIST-012's
signed-ACK + immutable receipt store from the dead stack into the live daemon AND have the relay sign
its ordering record (Structure2: sequence_number + prev_root + content_hash). The client carries the
relay-signed receipts to the directory; the directory rebuilds + verifies the tree offline at seal — no
directory→relay call. Sovereign-node invariant preserved (directory trusts the relay's SIGNATURE, not
the client). The chain + strict-in-order receiver gate (both live today) stay the security floor.

**Cross-node replication = replicate (DECIDED, M8 option 1).** Add `agent_presence` + `directory_nodes`
to `cello_pub` (natural-key PK → clean UPDATE replication). Change `pickup_queue.id` to UUID, add it to
`cello_pub`, gate `sweepUndeliverablePickups` to the owning node. Sovereign write-ownership preserved.

## 4. Tracks & dependency order (units → DoD lines in M8B-DEFINITION-OF-DONE.md)

- **Track A — T-of-N spine (critical path):** MANIFEST → DKG → SIGN → (SUSPEND, REFRESH).
- **Track B — Directory↔relay (Option B):** RELAYSIG → OPTIONB-SETUP → OPTIONB-SEAL. Depends on A (group key) + MANIFEST.
- **Track C — Cross-node state:** PRESENCE, PICKUP. Independent.
- **Track D — Proof & deploy:** SPINE (3-directory harness — the enforcer, built FIRST) → DEPLOY (publish beta + dev deploy + live-cluster proof).

## 5. Out of scope tonight (your-return / separate)
- Demo-agent standing-receiver one-session bug (cello-client; contained; fold in only if time).
- VPC interface-endpoint cleanup (21 redundant; cost only; verify route tables first).
- Promotion of npm packages to `latest` (beta only unless fully dev-verified).

## 6. Definition of done
The federation journeys (2-of-3 DKG, T-of-N seal with a node down, quorum suspend-refusal, share
refresh, Option B with no directory→relay, cross-node presence + pickup) are GREEN — first on the local
3-directory spine, then against the live dev 3-region cluster. No single node mandatory for any
ceremony. STATE.md / journal / decisions current.
