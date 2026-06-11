---
name: implementing-directory-bidirectional-authentication
type: discussion
date: 2026-06-11
topics: [security, directory, authentication, bootstrap, manifest, tuf, key-management, certificate-pinning, bidirectional-auth, consortium-keys]
status: closed
description: >
  How to correctly implement directory bidirectional authentication. The design
  has always specified a 7-step mutual challenge-response (end-to-end-flow.md
  §3.1); this log audits the current code, identifies TUF (The Update Framework)
  as the canonical standard for the signed manifest and root key model, and
  resolves four open design questions: root key rotation, manifest replay
  prevention, revocation latency SLA, and jurisdiction of key holders.
---

# Implementing Directory Bidirectional Authentication

The design has always specified mutual authentication between client and directory node. This log audits what is currently in place, identifies the correct implementation approach using TUF as the canonical reference, and resolves the open design questions needed before stories can be written.

## 1. Current State

Steps 1–4 (client→directory) are implemented. Steps 5–6 (directory→client) are not.

The design specifies a 7-step mutual challenge-response in two canonical documents:

- `end-to-end-flow.md §3.1`
- `server-infrastructure.md §Authentication`

```
1. Agent connects, sends pubkey: "I'm TravelBot"
2. Directory issues 256-bit CSPRNG challenge nonce
3. Agent signs: nonce + agent_ID + directory_node_ID + timestamp  (Ed25519, K_local)
4. Directory verifies signature against registered public key
5. Directory signs its own challenge response with its node key        ← NOT IMPLEMENTED
6. Agent verifies directory's signature against consortium-pinned keys ← NOT IMPLEMENTED
7. Authenticated session established
```

**What is implemented (steps 1–4):**
- `cello-client/packages/core/transport/src/signaling-manager.ts:500–519` — client signs the nonce
- `trustless-cello/packages/directory/src/directory-node.ts:1052–1099` — directory issues nonce and verifies client signature

**What is not implemented (steps 5–6):**
- After verifying the client, the directory sends `signaling_auth_ok` — a plain `{ type: "signaling_auth_ok" }` frame with no signature, no node key, no proof of identity
- `signaling-manager.ts:521–529` — client checks only that the frame type is `"signaling_auth_ok"` and proceeds
- No consortium-pinned node keys exist anywhere in the client source
- No Peer ID validation — the client trusts "I dialled this address and it responded"

**Partial mitigation (does not close the gap):**
Later, during seal operations (`seal-manager.ts:546`), the client verifies the directory's FROST signature on a `SessionAssignment`. But this is deep inside an active session — not during the initial connection handshake where the attack surface lives. A MITM at the network layer would pass the handshake completely and only fail at seal time, by which point session content has already been exchanged.

---

## 2. What the Client Currently Trusts

The client's trust model for directory connections is currently:

> "I dialled this address. It responded with `signaling_auth_ok`. Therefore it is a legitimate directory node."

This is implicit trust based on network reachability, not cryptographic verification. An attacker who can influence any level of the bootstrap fallback chain — a stale manifest, a hijacked DNS record, a lapsed Elastic IP — can present a rogue node that passes the current handshake without any valid credentials.

---

## 3. Where the Client Is Supposed to Get Directory Node Keys

The design specifies a signed manifest bootstrap model documented in:
- `agent-client.md:301–309`
- `server-infrastructure.md:222–228, 292–297`
- `discussion_logs/2026-04-11_1400_libp2p-dht-and-peer-connectivity.md:30–59`

**Three-level fallback:**
1. Signed JSON manifest bundled in the npm package — verified locally against a consortium public key constant in the client source
2. DNS seeds (`bootstrap1.cello.network`, etc.)
3. Hardcoded Elastic IP redirectors — minimal servers returning the current signed manifest

**The trust anchor:** A single consortium public key baked into the client binary at build time, verified via Sigstore/OIDC provenance. The manifest lists individual directory node keys. Nodes rotate; the manifest is updated and re-signed. The binary is only updated when the consortium root key itself changes.

**None of this is implemented.** No manifest file exists, no bootstrap mechanism exists, no consortium key constant exists in the client source, and no individual node keys are verified during the handshake.

---

## 4. TUF — The Canonical Standard for This Problem

External research (Perplexity) identified **TUF (The Update Framework)** as the battle-tested standard that matches the CELLO bootstrap model.

### What TUF Is

TUF is a security framework that protects software update delivery against compromised servers, compromised keys, and replay attacks. It is a CNCF project used in production by Sigstore, Google, and Chainguard. Implementations exist in Python, Go, JavaScript, and Rust.

```
┌─────────────────────────────────────────┐
│  Client binary                          │
│  └─ Bakes in: N root public keys       │
└─────────────────────────────────────────┘
         ↓
┌─────────────────────────────────────────┐
│  root.json (signed manifest)            │
│  └─ Lists all trusted keys + threshold │
│  └─ Signed by: t-of-n root keys        │
│  └─ Contains: version + expires        │
└─────────────────────────────────────────┘
         ↓
┌─────────────────────────────────────────┐
│  targets.json (node list)               │
│  └─ Lists nodes + their public keys    │
│  └─ Signed by: separate online keys    │
└─────────────────────────────────────────┘
```

### Why CELLO's current design is a partial, undocumented TUF implementation

| TUF feature | CELLO design | Implementation status |
|---|---|---|
| t-of-n root keys in binary | Single consortium key constant | Not implemented |
| Signed manifest with version + expires | Signed JSON manifest (version/expires unspecified) | Not implemented |
| In-band root key rotation | No mechanism | Not specified |
| Periodic manifest polling | Not specified | Not implemented |
| Client rejects expired manifest | Not specified | Not implemented |

The CELLO design invented a subset of TUF independently. The correct move is to explicitly adopt TUF's model rather than continue reinventing it without its security properties.

---

## 5. Four Gaps — Resolved Designs

### Gap 1: Root Key Rotation Has No In-Band Mechanism

**Problem:** A single consortium public key is baked into the binary. If it needs rotation — officer departure, key compromise, YubiKey loss — every client in the wild must update their npm package. Clients that do not update are permanently stuck trusting the old key.

**TUF solution:** Embed all N officer public keys in the binary (e.g., all 5 for a 3-of-5 threshold). Rotation is in-band: sign a new manifest with 3 existing keys that adds a replacement key and removes the old one. The client validates the new manifest against the 3 still-trusted keys, then updates its local key state. No binary update required.

**Resolution:** The binary must contain all N root public keys, not one. The manifest must be signed by a threshold of them (3-of-5 at Alpha). This is the direct equivalent of TUF's `root.json` model.

---

### Gap 2: Manifest Replay Not Prevented

**Problem:** A valid, correctly-signed manifest from six months ago is cryptographically indistinguishable from a current one. An attacker controlling a DNS seed or a lapsed Elastic IP could serve a stale manifest pointing clients at decommissioned or compromised nodes.

**Resolution:** The manifest schema must include three fields:

```json
{
  "version": 42,
  "not_before": "2026-06-01T00:00:00Z",
  "expires": "2026-12-31T23:59:59Z",
  "nodes": [ ... ]
}
```

Client enforcement rules:
- Reject any manifest with `version ≤ current_trusted_version`
- Reject any manifest where `expires` is in the past
- Persist `current_trusted_version` locally; never downgrade

This matches TUF's version + expiry model and Certificate Transparency's SCT timestamp requirements.

---

### Gap 3: Node Revocation Latency Undefined

**Problem:** If a directory node is compromised, revoking it requires the 3-of-5 officers to convene, sign a new manifest removing it, and publish it. The acceptable latency window is unspecified. During that window, all clients continue trusting the compromised node.

**Certificate Transparency reference:** The CT specification defines a Maximum Merge Delay (MMD) of 24–48 hours — the maximum time a log operator has to incorporate a submitted certificate. This is the standard for revocation latency in comparable systems.

**Resolution:**
- Define a 24-hour SLA: from compromise discovery to new manifest publication
- Manifest `expires` must be set to no more than 7 days from signing date
- Clients that hold an expired manifest must refuse to connect to any directory node — they cannot trust their node list is current
- Clients must poll for a fresh manifest every 6–12 hours while running

---

### Gap 4: Jurisdiction of Key Holders Not Required

**Problem:** The 3-of-5 threshold is cryptographically sound but not legally sound. Three officers in a single jurisdiction compelled by a court order can produce a valid-but-malicious manifest that all clients accept.

**Resolution:** The governance document for the Alpha officer key ceremony must explicitly require that no two of the 5 key holders are subject to the same jurisdiction's compelled-disclosure law. At minimum: key holders must be distributed across at least 3 distinct legal jurisdictions. This is a governance requirement, not a code requirement, but it must be documented as a hard constraint on officer selection — not a preference.

---

## 6. Additional Mechanism: Automatic Manifest Polling

The current design only checks the manifest at startup. A revoked node stays trusted for the lifetime of a running client process.

**Recommended addition:** The client should poll for a fresh manifest every 6–12 hours during normal operation. On each poll:
1. Fetch manifest from the same three-level fallback chain
2. Verify threshold signature
3. Check version ≥ current trusted version
4. Check `not_before` ≤ now ≤ `expires`
5. If valid and version is higher: update local node list and persist new version number

This closes the gap between startup-time bootstrap and a long-running process that would otherwise never learn about a revoked node.

---

## 7. Summary — Open Items Requiring Stories

**Implementation gap (needs a story before any directory connection is trustworthy):**
- Directory→client auth: steps 5–6 of the handshake are missing. Directory must sign its challenge response; client must verify against pinned node keys.

**Manifest and bootstrap (needs stories):**
1. Define manifest schema — add `version`, `not_before`, `expires`, threshold signature fields
2. Produce initial signed manifest and embed in npm package with N root keys as binary constants
3. Implement client-side manifest verification — threshold signature check, version enforcement, expiry enforcement
4. Implement client-side handshake step 6 — verify directory node key against manifest on every connection
5. Implement manifest polling (6–12 hour cadence)
6. Document officer key ceremony governance with jurisdiction requirements

**Not a story (governance):**
- 24-hour revocation SLA — define in operational runbook, not in code
- Jurisdiction requirement for key holders — define in officer onboarding documentation

---

## References

- [[transport-security-audit-and-libp2p-primitives]] — identified bidirectional auth as unaudited; this log closes that open item
- [[libp2p-dht-and-peer-connectivity]] — original bootstrap design; open question on manifest update cadence noted but never answered
- `end-to-end-flow.md §3.1` — canonical 7-step auth specification
- `server-infrastructure.md §Authentication, §Node signing keys (GAP G-9 RESOLVED), §Bootstrap` — node key governance and bootstrap design
- `agent-client.md:301–309` — client-side bootstrap and connection establishment
- TUF specification: https://theupdateframework.github.io/specification/latest/
