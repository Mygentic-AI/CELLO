# CELLO Protocol: Adversarial Operational Security Review

**Reviewer:** Operational Security & Supply Chain Specialist
**Date:** 2026-04-08
**Document reviewed:** `docs/planning/cello-design.md`
**Scope:** Supply chain attacks, insider threats, infrastructure compromise

---

## Executive Summary

This review examines the CELLO protocol design from the perspective of three attacker profiles: a compromised insider/rogue operator, a nation-state targeting infrastructure, and a supply chain attacker. The design document demonstrates strong architectural thinking on cryptographic verification and trust layering, but has significant gaps in operational security, supply chain hardening, and real-world threat modeling for the infrastructure layer. Several findings are critical.

---

## 1. SDK Supply Chain Attacks

### 1.1 npm Provenance Circumvention via CI Pipeline Compromise

- **Severity:** Critical
- **Attacker profile:** Supply chain attacker / nation-state
- **Attack description:**
  1. Attacker compromises a GitHub Actions runner (via a malicious action in the dependency chain, a poisoned runner image, or a compromised GitHub token).
  2. The compromised CI build produces a backdoored `@cello/mcp-server` package.
  3. npm provenance attestation is generated *by the compromised CI* -- it truthfully links the backdoored package to the compromised build. Provenance passes verification because provenance proves "this was built by CI," not "CI was honest."
  4. Sigstore signing also passes -- the ephemeral signing certificate is issued to the GitHub Actions OIDC identity, which is legitimate.
  5. `npm audit signatures` returns clean. Users install a backdoored SDK that exfiltrates K_local on first run.
- **Likelihood:** Medium-High. The `tj-actions/changed-files` supply chain attack (March 2025) compromised 23,000+ repositories through exactly this vector. GitHub Actions supply chain attacks are a proven, repeating pattern. The CELLO SDK is a high-value target because it handles cryptographic keys.
- **Impact:** Total compromise of every agent that installs the update. K_local exfiltration means the attacker can impersonate agents, and if combined with K_server compromise, full identity theft.
- **Mitigation:**
  - Pin ALL GitHub Actions dependencies to full SHA hashes, not tags or versions
  - Use a hardened, self-hosted runner with immutable base image
  - Require multi-party approval for CI pipeline changes (not just code changes)
  - Implement binary transparency: publish build hashes to an independent transparency log (not just npm/Sigstore) that can be cross-verified
  - The design doc's "reproducible builds" claim needs a concrete verification mechanism -- who actually rebuilds and checks? A reproducible build that nobody reproduces is security theater

### 1.2 Reproducible Builds Are Aspirational for JavaScript/TypeScript

- **Severity:** High
- **Attacker profile:** Supply chain attacker
- **Attack description:**
  1. The design doc claims "anyone can clone the repo, run the build, and verify they get the same output as the published package."
  2. In practice, JavaScript/TypeScript builds are notoriously non-deterministic. Differences in Node.js version, npm version, OS, filesystem ordering, timestamps in generated files, terser/esbuild non-determinism, and source map generation all produce different outputs.
  3. An attacker can introduce a subtle backdoor that is difficult to detect because nobody can actually reproduce the build to compare.
- **Likelihood:** High that reproducibility will fail in practice; medium that this is actively exploited.
- **Impact:** The reproducible builds claim is the "anyone can verify" promise. If it doesn't work in practice, users have only npm provenance (which proves CI built it, not that CI was honest) and Sigstore (same limitation).
- **Mitigation:**
  - Use a hermetic build environment (Nix, Bazel) that pins every dependency including the toolchain
  - Publish the exact build environment definition alongside the package
  - Run an independent rebuild bot that continuously verifies published packages match source
  - Until reproducibility is proven, do not claim it -- it's more honest and more secure to say "we provide provenance and signing, and we're working toward reproducible builds"

### 1.3 DeBERTa Model Supply Chain Poisoning

- **Severity:** Critical
- **Attacker profile:** Supply chain attacker / nation-state
- **Attack description:**
  1. The SDK downloads a ~100MB DeBERTa-v3-small INT8 model on first run.
  2. The design doc does not specify: where the model is downloaded from (HuggingFace Hub? An S3 bucket? npm?), how the model is verified after download, what happens if the download source is compromised, or whether the model hash is pinned in the SDK.
  3. If the model is downloaded from HuggingFace Hub, an attacker who compromises the HuggingFace account (or performs a repository takeover after a rename) can serve a poisoned model.
  4. A poisoned classifier could be trained to pass all injection attacks from a specific pattern, effectively creating a backdoor in the entire network's security layer.
  5. Since every agent in the network uses the same classifier, a single poisoned model compromises the entire ecosystem's prompt injection defense.
- **Likelihood:** Medium. HuggingFace model supply chain attacks are an active research area. Model poisoning that preserves general accuracy while failing on specific inputs is a well-documented technique.
- **Impact:** Complete bypass of Layer 2 prompt injection defense across the entire CELLO network.
- **Mitigation:**
  - Pin the model hash (SHA-256) in the SDK source code
  - Bundle the model in the npm package itself rather than downloading at runtime (100MB is large but acceptable for a security-critical dependency)
  - If the model must be downloaded, download from multiple mirrors and verify consensus
  - Sign the model with a key held by CELLO, not the upstream model provider
  - Publish model evaluation benchmarks against a known attack corpus; if the model's detection rate drops, it's poisoned

### 1.4 Transitive Dependency Compromise

- **Severity:** High
- **Attacker profile:** Supply chain attacker
- **Attack description:**
  1. The SDK depends on libp2p, crypto libraries (likely tweetnacl or noble-ed25519), WebSocket libraries, and JSON schema validators.
  2. Any transitive dependency can be compromised. The `event-stream` attack (2018), `ua-parser-js` attack (2021), and `colors.js` sabotage (2022) demonstrate this is routine.
  3. A compromised dependency in the crypto path could leak K_local or weaken signature generation. A compromised dependency in the WebSocket path could exfiltrate hashes. A compromised dependency in libp2p could intercept P2P traffic.
  4. The design doc mentions npm provenance for the CELLO package itself but says nothing about the provenance or integrity of dependencies.
- **Likelihood:** High. This is the most common supply chain vector in the npm ecosystem.
- **Impact:** Variable -- from K_local theft to silent message interception, depending on which dependency is compromised.
- **Mitigation:**
  - Use `npm audit` in CI with a zero-tolerance policy for critical/high vulnerabilities
  - Pin all dependency versions with a lockfile and verify lockfile integrity in CI
  - Minimize the dependency tree ruthlessly -- every dependency is attack surface
  - Consider vendoring critical crypto dependencies
  - Use Socket.dev or similar for real-time dependency supply chain monitoring
  - The design doc should address this explicitly -- "SDK Supply Chain Integrity" section only covers the CELLO package itself, not its dependencies

### 1.5 Dependency Confusion Attack on `@cello/mcp-server`

- **Severity:** Medium
- **Attacker profile:** Opportunistic / supply chain
- **Attack description:**
  1. If any CELLO packages use an npm scope (`@cello/`) that is not properly claimed and protected, an attacker could register a similar package or exploit private registry misconfigurations.
  2. If enterprise users run private npm registries alongside the public registry, an attacker can publish a higher-version `@cello/mcp-server` to the public registry that gets preferred over the internal one.
- **Likelihood:** Low-Medium (the scoped package approach mitigates the basic case, but enterprise configurations vary).
- **Impact:** Installation of a malicious package in place of the legitimate one.
- **Mitigation:**
  - Claim the `@cello` npm scope immediately and protect it with 2FA
  - Document correct registry configuration for enterprise users
  - Publish scope configuration guidance for private registry setups

---

## 2. Insider Threats from Consortium Operators

### 2.1 Home Node Operator Deanonymization via Hash-Phone Correlation

- **Severity:** Critical
- **Attacker profile:** Insider (rogue home node operator)
- **Attack description:**
  1. The home node stores: phone numbers for notifications, WebAuthn credentials, K_server shares, and OAuth tokens.
  2. The home node also receives hash relay data (sees when hashes arrive) and sends phone notifications ("Your agent started a conversation with SupplyBot").
  3. A rogue home node operator can trivially correlate: hash arrival times with notification dispatch times, building a complete map of "phone number X's agent is talking to agent Y at time Z."
  4. This is not a side-channel -- the home node *must* have this data to function. The correlation is architectural.
  5. The operator can sell this metadata: who is talking to whom, when, how often, and the identity of the human owner (phone number + social verifier signals).
- **Likelihood:** High. This requires zero technical sophistication -- just database access that the operator already has.
- **Impact:** Complete deanonymization of all conversations for agents homed on that node.
- **Mitigation:**
  - The design doc does not address this. It needs to.
  - Consider separating the notification function from the hash relay function so no single operator has both phone numbers and conversation metadata
  - Implement cryptographic notification routing where the home node cannot see which conversation triggered the notification
  - At minimum, acknowledge this as an accepted risk and ensure operator agreements include strong contractual and legal penalties for metadata exploitation
  - Consider rotating home nodes periodically so no single operator accumulates a long history

### 2.2 Operator Vetting Is Undefined

- **Severity:** High
- **Attacker profile:** Insider / nation-state (placing an operative as a node operator)
- **Attack description:**
  1. The design doc says operators are "vetted, audited, and accountable" but provides zero specifics.
  2. Who vets them? What are the criteria? What legal jurisdiction? What audit cadence? What are the consequences of violation?
  3. A nation-state can create a legitimate-looking entity that passes any reasonable vetting process and operates a node for years before activating.
  4. Without a defined legal framework, there is no recourse when an operator violates trust.
- **Likelihood:** Medium. Nation-states routinely compromise infrastructure through legitimate-looking entities.
- **Impact:** A compromised operator has access to everything described in 2.1, plus the ability to serve tampered data to clients (though Merkle proofs limit this).
- **Mitigation:**
  - Define the vetting process explicitly: background checks, corporate verification, multi-jurisdiction diversity requirement
  - Require node operators to be in different legal jurisdictions so no single government can compel all operators
  - Publish operator identities (transparency)
  - Define a legal framework: operator agreements with specific data handling requirements, audit rights, and penalty clauses
  - Require regular third-party security audits of operator infrastructure

### 2.3 Rogue Operator Selling Metadata

- **Severity:** High
- **Attacker profile:** Insider (financially motivated)
- **Attack description:**
  1. Even a non-home-node operator sees: all hash relay traffic (who is talking to whom, when), checkpoint data, connection request routing, and trust score queries.
  2. This metadata is commercially valuable: which agents are doing business together, transaction patterns, competitive intelligence.
  3. The design doc has no monitoring or audit mechanism to detect unauthorized data access by operators.
  4. The append-only log creates a permanent record -- data once observed cannot be unobserved.
- **Likelihood:** Medium-High. Financial incentive is strong, detection is difficult.
- **Impact:** Privacy breach for all users of the network. Reputational destruction for CELLO if discovered.
- **Mitigation:**
  - Implement technical controls: encrypt metadata at rest so operators cannot read it without multi-party decryption
  - Implement access logging on operator infrastructure that is replicated to other operators (mutual surveillance)
  - Consider PIR (Private Information Retrieval) techniques for directory queries so operators cannot see what agents are searching for
  - Require operators to run on hardware with attestation (SGX/TDX/SEV) -- though this trades one trust problem for another (trusting Intel/AMD)

---

## 3. Node Compromise Cascades

### 3.1 Threshold Key Compromise: 2-of-3 Gives Everything

- **Severity:** Critical
- **Attacker profile:** Nation-state / sophisticated attacker
- **Attack description:**
  1. The design doc specifies 2-of-3 threshold for K_server shares.
  2. Compromising 2 of 3 nodes gives the attacker every agent's K_server.
  3. Combined with K_local theft (from a compromised agent or supply chain attack on the SDK), this gives full identity theft.
  4. At consortium sizes of 3-5 nodes, compromising 2 nodes is realistic for a well-resourced attacker.
- **Likelihood:** Medium for a nation-state; Low for other attackers. But the consequences are catastrophic.
- **Impact:** Total identity theft of any agent in the network.
- **Mitigation:**
  - The threshold must be higher. 3-of-5 at minimum, ideally 5-of-7 or higher.
  - Node operators MUST be in different jurisdictions, different cloud providers, and different legal regimes
  - Per-agent threshold -- not all agents need to use the same threshold. High-value agents should require higher thresholds
  - Hardware Security Modules (HSMs) for K_server share storage
  - Rate limiting on K_server share requests

### 3.2 Single Node Compromise Blast Radius

- **Severity:** High
- **Attacker profile:** Any attacker who compromises one node
- **Attack description:**
  1. A single compromised node exposes:
     - K_server shares for all agents (1 of N shares -- not immediately useful, but reduces the threshold by 1)
     - For agents homed on that node: phone numbers, WebAuthn credentials, OAuth tokens
     - All hash relay traffic passing through that node (metadata)
     - All append-only log data (complete history of all identity operations)
  2. The WebAuthn credentials and OAuth tokens for homed agents are particularly dangerous.
  3. Phone numbers enable SIM-swap attacks against agent owners.
- **Likelihood:** Medium. Single-node compromise is realistic through cloud provider access, unpatched vulnerabilities, or insider access.
- **Impact:** For non-homed agents: metadata exposure + threshold reduction. For homed agents: potential full account takeover.
- **Mitigation:**
  - WebAuthn credentials should NEVER be stored by the home node. WebAuthn is designed so the relying party stores only public keys, not private credentials. The design doc's phrasing "WebAuthn credentials" needs clarification.
  - OAuth tokens should be short-lived and not stored at rest. Signal scores should be computed at OAuth time and tokens discarded.
  - Encrypt all homed agent data with a key that requires multi-node cooperation to derive
  - Implement canary mechanisms for node compromise detection

### 3.3 Append-Only Log Poisoning Before Detection

- **Severity:** High
- **Attacker profile:** Compromised node operator
- **Attack description:**
  1. A compromised node can inject fraudulent entries into the append-only log before other nodes detect the divergence.
  2. The detection mechanism is a periodic checkpoint heartbeat ("every N minutes"). Between checkpoints, the compromised node has a window to inject entries.
  3. If the attacker can inject a fake identity entry, clients that query that node before the next checkpoint will receive tampered data.
- **Likelihood:** Medium. Requires node compromise but the window between checkpoints is exploitable.
- **Impact:** Temporary ability to serve fake identity data to clients.
- **Mitigation:**
  - Reduce checkpoint interval to minimize the window
  - Require entries to be co-signed by multiple nodes before being accepted (consensus on writes, not just reads)
  - Clients should query multiple nodes for any new entry and require consistency before trusting it
  - Implement real-time entry propagation with immediate cross-node verification

### 3.4 Compromised Node During Migration

- **Severity:** High
- **Attacker profile:** Any attacker
- **Attack description:**
  1. During home node migration, the agent's data is being transferred from a compromised node.
  2. The compromised node can serve corrupted data during migration, race to exploit credentials while migration is in progress, or delay/block the migration.
- **Likelihood:** Medium. Migration is an inherently vulnerable state transition.
- **Impact:** Extended compromise window, potential data corruption during migration.
- **Mitigation:**
  - Migration should not depend on the compromised node at all -- the agent should reverify from scratch on the new node
  - The new node should reconstruct the agent's state from the replicated append-only log, not from the compromised home node
  - Implement a "migration lockout" that prevents the old home node from performing any operations once migration is initiated

---

## 4. Infrastructure Attacks

### 4.1 Cloud Provider Access = Full Access

- **Severity:** Critical
- **Attacker profile:** Nation-state / cloud provider insider
- **Attack description:**
  1. Directory nodes run on cloud infrastructure (AWS/GCP/Azure).
  2. Cloud providers have physical access to the hardware. Employees with sufficient privileges can access any VM, any database, any KMS key.
  3. If K_server shares are stored in cloud KMS (AWS KMS, GCP Cloud KMS), the cloud provider can access the key material -- KMS is designed to prevent *customer* mistakes, not *provider* access.
- **Likelihood:** Medium for nation-state targeting; Low for cloud provider insider acting independently.
- **Impact:** Complete compromise of all agents on that node.
- **Mitigation:**
  - Use dedicated HSMs (AWS CloudHSM, not AWS KMS) where the customer holds the keys and the cloud provider cannot access them. CloudHSM is FIPS 140-2 Level 3 certified; standard KMS is not.
  - Better: require node operators to use self-managed HSMs (e.g., YubiHSM) that are not cloud-hosted
  - Distribute nodes across multiple cloud providers so no single provider can access a threshold of shares
  - The design doc should explicitly state: "cloud KMS is not sufficient for K_server protection"

### 4.2 DNS as Single Point of Failure

- **Severity:** High
- **Attacker profile:** Nation-state / sophisticated attacker
- **Attack description:**
  1. Agents need to find directory nodes. If DNS is used, DNS hijacking gives the attacker control over which nodes agents connect to.
  2. Even with a signed node list, the initial bootstrap still needs to come from somewhere -- trust-on-first-use (TOFU) problem.
  3. If the CELLO domain is seized, the entire network loses its bootstrap mechanism.
- **Likelihood:** Medium. DNS hijacking and domain seizures are well-documented.
- **Impact:** Complete disruption of the network, or redirection of agents to malicious nodes.
- **Mitigation:**
  - Hardcode initial node list in the SDK (signed, verifiable)
  - Use certificate pinning for directory node connections
  - Support multiple bootstrap mechanisms (DNS, hardcoded, peer exchange, DHT)
  - Register the domain with a registrar that provides registry lock

### 4.3 DDoS Against Directory WebSocket Servers

- **Severity:** Medium
- **Attacker profile:** Opportunistic / competitor
- **Attack description:**
  1. All agents maintain persistent WebSocket connections. A DDoS attack takes down hash relay, activity notifications, connection routing, and K_server share distribution.
  2. WebSocket connections are stateful and more expensive to maintain than HTTP requests, making them more vulnerable to resource exhaustion.
- **Likelihood:** Medium. DDoS-for-hire services are cheap and readily available.
- **Impact:** Network-wide degradation to reduced trust mode.
- **Mitigation:**
  - Use DDoS protection services for WebSocket endpoints
  - Implement connection rate limiting per IP and per agent
  - Geographic distribution of nodes
  - Consider a UDP-based hash relay protocol as a fallback

---

## 5. Update Mechanism Attacks

### 5.1 Malicious SDK Update Push

- **Severity:** Critical
- **Attacker profile:** Supply chain attacker / insider
- **Attack description:**
  1. The SDK installs via `npx @cello/mcp-server`, which by default fetches the latest version.
  2. An attacker who compromises npm publish credentials can push a malicious update that is immediately installed by every agent that restarts or reinstalls.
  3. The design doc's install instruction bakes in the `npx` pattern, which means automatic updates with no review step.
- **Likelihood:** Medium-High. npm credential theft is common. The `npx` auto-update pattern maximizes blast radius.
- **Impact:** Immediate compromise of every agent that reinstalls or restarts.
- **Mitigation:**
  - Change the default install instruction to pin a specific version: `npx @cello/mcp-server@1.2.3`
  - Implement update notification in the SDK rather than auto-update
  - Require multi-party approval for npm publishes
  - Implement staged rollout: new versions deploy to 1% first, with anomaly monitoring
  - Consider code signing the SDK binary with a key not stored in CI

### 5.2 Signed Node List Key Compromise

- **Severity:** Critical
- **Attacker profile:** Insider / nation-state
- **Attack description:**
  1. The node list is "a signed document, periodically refreshed." The signing keys for the node list are the keys to the kingdom.
  2. An attacker who compromises these keys can add malicious nodes, remove legitimate nodes, or redirect the entire network.
  3. The design doc does not specify: who holds these keys, how they are protected, what the signing ceremony is, or what happens if they are compromised.
- **Likelihood:** Medium. Key management is the hardest problem in cryptography, and the doc leaves it unspecified.
- **Impact:** Complete network takeover.
- **Mitigation:**
  - The node list signing must use threshold signatures from the consortium itself (not a single key)
  - The signing keys must be stored in HSMs, not in software
  - Define a key ceremony process: multi-party, audited, documented
  - Publish the node list signing public key in multiple out-of-band locations

### 5.3 DeBERTa Model Update Poisoning

- **Severity:** High
- **Attacker profile:** Supply chain attacker
- **Attack description:**
  1. The model is downloaded on "first run." But what about model updates? As attack techniques evolve, the classifier needs retraining.
  2. The design doc does not specify a model update mechanism.
  3. A subtle model poisoning -- one that preserves 99% accuracy but fails on a specific attack pattern -- would be very difficult to detect.
- **Likelihood:** Medium. Model update supply chains are less mature than code supply chains.
- **Impact:** Targeted bypass of prompt injection defense.
- **Mitigation:**
  - Pin model versions to SDK versions
  - Publish model evaluation benchmarks with every release
  - Implement model integrity verification: hash check on every load
  - Consider a model transparency log similar to certificate transparency

---

## 6. Operational Security of the CELLO Organization

### 6.1 Bus Factor and Key Person Risk

- **Severity:** High
- **Attacker profile:** Insider / any attacker targeting individuals
- **Attack description:**
  1. If one person holds npm publish credentials, CI pipeline access, signing keys, and domain registration -- compromising that person compromises everything.
  2. Social engineering, physical coercion, or incapacitation of the key person is a single point of failure.
- **Likelihood:** Medium for social engineering; Low for physical coercion.
- **Impact:** Complete compromise of the SDK supply chain and organizational infrastructure.
- **Mitigation:**
  - Distribute critical credentials across multiple individuals from day one
  - Use hardware security keys for all critical accounts
  - Implement a succession plan
  - Store critical secrets in a multi-party vault
  - Require two-person authorization for npm publishes and CI pipeline changes

### 6.2 CI Pipeline as Crown Jewel

- **Severity:** High
- **Attacker profile:** Supply chain attacker / insider
- **Attack description:**
  1. The CI pipeline has the npm publish token, Sigstore signing capability, and access to build the SDK.
  2. GitHub Actions secrets are accessible to anyone who can modify the workflow file.
  3. GitHub Actions has a known attack surface: `pull_request_target` events, workflow injection, and OIDC token theft.
- **Likelihood:** Medium-High. CI pipeline attacks are a top supply chain vector.
- **Impact:** Malicious SDK publication with valid provenance and signatures.
- **Mitigation:**
  - Use GitHub's environment protection rules with manual approval for production deployments
  - Never use `pull_request_target` for workflows with access to secrets
  - Use CODEOWNERS to protect workflow files
  - Consider a separate, more restricted CI system for the publish step

---

## 7. Data Retention and Legal Pressure

### 7.1 Append-Only Log vs. GDPR Right to Deletion

- **Severity:** High
- **Attacker profile:** Legal / regulatory
- **Attack description:**
  1. The directory is an append-only log. Entries are never deleted.
  2. GDPR Article 17 grants the right to erasure. A European agent owner can request deletion of all their personal data.
  3. The append-only log by design cannot fulfill this request. Phone numbers, public keys, trust score history, and all identity operations remain forever.
  4. Non-compliance can result in fines up to 4% of global revenue.
- **Likelihood:** High. GDPR enforcement is active and increasing.
- **Impact:** Regulatory fines, forced architectural changes, or forced shutdown in EU markets.
- **Mitigation:**
  - Design a "logical deletion" mechanism: append a deletion marker, then all nodes cryptographically erase the associated personal data while maintaining hash chain integrity
  - Separate personal data from the hash chain: the log stores hashes of identity operations, but the actual personal data is stored separately and can be deleted
  - Consult with a privacy lawyer before launch

### 7.2 Government Compulsion of Consortium Operators

- **Severity:** High
- **Attacker profile:** Nation-state (via legal process)
- **Attack description:**
  1. A government can compel a consortium operator to serve modified data, provide all metadata, install a backdoor, or secretly add a government-controlled node.
  2. A National Security Letter or similar instrument can include a gag order.
  3. If nodes are concentrated in one jurisdiction, a single legal order can compel them all.
- **Likelihood:** Medium-High. This is routine for governments. Lavabit, Silent Circle, and numerous other services have faced this.
- **Impact:** Mass surveillance of the network, targeted attacks, or forced shutdown.
- **Mitigation:**
  - Require consortium operators distributed across multiple legal jurisdictions (minimum 3, no single jurisdiction holding a threshold of nodes)
  - Publish a transparency report
  - Implement a warrant canary (if legally permissible)
  - Design for compulsion resistance: even a cooperative operator should not be able to provide useful data beyond what's already public

### 7.3 Law Enforcement Hash-to-Content Demand

- **Severity:** Medium
- **Attacker profile:** Nation-state (via legal process)
- **Attack description:**
  1. The directory stores "only hashes, never content." But in dispute resolution, a party provides plaintext and the service confirms it matches.
  2. Law enforcement can compel one party to provide plaintext, then use the directory's hashes to confirm completeness.
  3. The hash relay itself is a metadata honeypot.
- **Likelihood:** High. This is standard law enforcement technique.
- **Impact:** The "privacy by architecture" claim is overstated. The directory enables content verification when one party is compromised.
- **Mitigation:**
  - Be precise about privacy claims: "The directory never sees content, but it can confirm content when provided by a party"
  - Consider optional end-to-end encrypted metadata

---

## Summary of Critical Findings

| # | Finding | Severity | Most Likely Attacker |
|---|---------|----------|---------------------|
| 1.1 | CI pipeline compromise bypasses all provenance/signing guarantees | Critical | Supply chain |
| 1.3 | DeBERTa model download is unspecified and unpinned | Critical | Supply chain |
| 2.1 | Home node operator can trivially deanonymize all conversations | Critical | Insider |
| 3.1 | 2-of-3 threshold is too low for K_server protection | Critical | Nation-state |
| 4.1 | Cloud KMS is insufficient for K_server share protection | Critical | Nation-state |
| 5.1 | `npx` default install has no version pinning | Critical | Supply chain |
| 5.2 | Node list signing key management is unspecified | Critical | Insider/Nation-state |

The design assumes the infrastructure and supply chain are trustworthy while building a system designed to be trustless. The protocol doesn't need to trust any single agent -- but it implicitly trusts npm, GitHub Actions, cloud providers, the CI pipeline, the model provider, and the consortium operators. Each of these is a point of failure that the adversarial model should address explicitly.
