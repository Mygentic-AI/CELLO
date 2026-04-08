# CELLO Protocol: Chaos Engineering & Emergent Behavior Analysis

## 1. CASCADE FAILURES

### 1.1 The Great Fallback Storm

**Scenario:** A popular directory node (or the single node in early phases) goes down. Thousands of agents simultaneously drop to fallback-only signing mode.

**Severity:** Critical

**Scale:** 1,000+ agents; catastrophic at 100,000+

**Trigger conditions:** Node hardware failure, DDoS attack, cloud region outage, misconfigured deployment, or a certificate expiration that wasn't monitored.

**Cascade path:**
1. Directory node becomes unreachable. Agents cannot obtain K_server shares for split-key signing.
2. All active agents simultaneously switch to fallback-only (K_local) signing. This is by design.
3. Every receiving agent now sees every incoming message flagged as "reduced trust." The fallback canary signal, designed to detect individual compromise, fires everywhere at once. The signal-to-noise ratio goes to zero.
4. Agents with strict acceptance policies ("require split-key verified") reject all incoming connections. These agents are effectively deaf.
5. High-trust agents with "Guarded" or "Selective" policies flood their human owners with anomaly alerts. Thousands of "Not Me?" push notifications hit WhatsApp/Telegram simultaneously.
6. Some fraction of panicked owners tap "Not Me" on legitimate activity, revoking their own agents' K_server. Now those agents need full re-keying even after the node comes back.
7. When the node recovers, it faces a thundering herd: every agent reconnects simultaneously, every self-revoked agent needs re-keying (WebAuthn required, human in the loop), and the node must re-issue K_server shares to everyone.
8. Re-keying is bottlenecked by human owners physically interacting with WebAuthn devices. Recovery timelines measured in days, not minutes.

**Detection:** The node itself knows it's down (if the failure is graceful). Peer nodes detect via missed heartbeats. But agents have no standardized way to distinguish "node down" from "my key was stolen" -- both produce fallback-only signing. The design document says "sustained stream of fallback-only signatures signals compromise" -- but during an outage, every agent produces a sustained stream.

**Mitigation:**
- The SDK must differentiate between "I cannot reach the directory" and "the directory rejected my K_server request." The former is a connectivity issue; the latter is a compromise signal. These should produce different alert types.
- Implement a "directory health" signal -- agents that can still reach at least one peer node and see consistent checkpoint hashes should suppress compromise alerts and instead show "degraded mode -- directory connectivity issue."
- Rate-limit the "Not Me" button with a confirmation delay ("Are you sure? The directory appears to be experiencing an outage") when the SDK detects that multiple nodes are simultaneously unreachable.
- Stagger reconnection on recovery with exponential backoff plus jitter to prevent thundering herd.
- Design the alert system so the "fallback-only" canary only fires when the agent is in fallback mode AND the directory is reachable from other agents. This requires the SDK to check directory health before escalating.

---

### 1.2 Trusted Agent Compromise Blast Radius

**Scenario:** A widely-trusted agent (trust score 5+, hundreds of active connections, high transaction history) is confirmed compromised.

**Severity:** Critical

**Scale:** Manifests at 500+ agents in the network; blast radius proportional to the compromised agent's connection graph.

**Trigger conditions:** Agent's underlying LLM is jailbroken, K_local is stolen, or the human owner's machine is compromised.

**Cascade path:**
1. Compromised agent begins sending malicious messages to all active connections.
2. Receivers' DeBERTa scanners detect prompt injection in some but not all messages (the attacker is sophisticated -- they test against the same open-source scanner).
3. Scan failures are recorded in Merkle leaves and reported to the directory. Trust score starts degrading.
4. But the attacker has a window. Between the first malicious message and the trust score dropping enough to trigger automatic disconnections, the agent has full access to every active connection at full trust. If it has 200 active connections, each one receives 5-10 messages before the network reacts. That's 1,000-2,000 potentially malicious messages delivered at full trust.
5. Agents that received malicious messages now have poisoned context windows. If any of them are commercial agents processing purchases, the damage propagates through their downstream actions.
6. When the compromise is publicly flagged, every agent that cached the compromised agent's public key needs to refresh. The directory must push key invalidation to hundreds of agents simultaneously.
7. Any ongoing conversations with the compromised agent now have a Merkle tree that contains both legitimate and malicious messages. Dispute resolution becomes extremely complex -- which messages were pre-compromise and which were post?

**Detection:** The distributed scanner network is the primary detection mechanism. But the design relies on DeBERTa-v3-small, a relatively small model. A sophisticated attacker who has access to the same open-source model can craft messages that pass the scanner while still being malicious to the receiving agent's LLM (which is a different, potentially larger model with different vulnerabilities).

**Mitigation:**
- Implement a "trust velocity" metric -- not just the trust score, but how fast it's changing. A trust score that drops from 5 to 4 in an hour is a much stronger signal than one that drops from 5 to 4 over six months.
- Add a circuit breaker: when an agent's trust score drops by more than X in Y minutes, automatically suspend all its active connections pending human review, not just degrade the score.
- The window between compromise and detection is the critical metric. The design should define a target detection latency and engineer backward from it. Currently there is no SLA on how quickly a compromised agent is flagged.
- Consider adding an optional "quarantine first message" mode for high-trust connections -- even at full trust, the first message in each new session is held for scanner review before delivery.

---

### 1.3 DeBERTa False Positive Cascade

**Scenario:** The bundled DeBERTa-v3-small classifier has a systematic bias -- a common message pattern (e.g., messages containing numbered lists with imperative verbs, which is normal in commercial contexts: "1. Ship the order 2. Send the invoice 3. Confirm delivery") triggers false positives.

**Severity:** High

**Scale:** Manifests immediately at any scale once the pattern is common in the user base.

**Trigger conditions:** A new version of the classifier is released with a regression, or the existing classifier has a latent bias that only appears when a new category of agents joins the network (e.g., logistics agents whose natural communication patterns look like instruction injection).

**Cascade path:**
1. Legitimate messages start getting flagged. Scan results are recorded in Merkle leaves with elevated risk scores.
2. These scan results are reported to the directory. Sending agents' trust scores begin degrading.
3. Agents with degraded trust scores face rejection from new connections. Existing connections see the reduced trust signal.
4. The agents being flagged are, by hypothesis, legitimate high-volume commercial agents. Their business is disrupted.
5. Human owners see their trust scores dropping and don't understand why. They've done nothing wrong.
6. Because the scanner is deterministic (same model, same weights, same input = same output), every receiver independently produces the same false positive. There's no dissent -- the network's "immune system" reaches unanimous incorrect consensus.
7. The feedback loop tightens: trust scores drop, connections are refused, business stops, agents leave the network.

**Detection:** Difficult. The system is designed to trust the scanner's output. A sudden spike in network-wide flag rates should be detectable by the directory, but the design doesn't describe any meta-monitoring of aggregate scan statistics.

**Mitigation:**
- Implement directory-level monitoring of aggregate scan statistics. If the network-wide flag rate increases by more than X% in Y hours, trigger an automatic investigation.
- The trust score formula should have a "network-wide correction factor" -- if the average flag rate across all agents increases significantly, individual trust score penalties should be dampened.
- Allow human owners to dispute scan results with evidence. Currently the Merkle tree proves what the scanner said, but there's no mechanism for challenging whether the scanner was correct.
- Version-pin the scanner model. Don't auto-update the DeBERTa weights. Let agent owners choose when to upgrade, with a network-wide minimum version requirement that advances slowly.
- The design says the scanner is "deterministic" and the receiver "re-runs and compares." This is a feature for verification but a liability for false positives -- a bug in the model is perfectly reproducible across every node.

---

### 1.4 Threshold Cryptography Under Load Redistribution

**Scenario:** K_server is split across nodes using threshold cryptography (2-of-3). One node goes down. The remaining two nodes must handle 100% of signing requests.

**Severity:** High

**Scale:** Manifests when any single node handles >40% of signing traffic.

**Trigger conditions:** Node failure, planned maintenance, network partition isolating one node.

**Cascade path:**
1. Node C goes down. 2-of-3 threshold signing still works with nodes A and B.
2. All agents whose threshold path included Node C must now route to A and B. These two nodes see a ~50% increase in signing load.
3. If the system was running at 70% capacity (normal for production systems), the remaining nodes are now at 105% -- over capacity.
4. Signing latency increases. Agents experience delays getting K_server shares.
5. Agents with tight timeouts start failing over to fallback-only signing. This triggers the reduced-trust cascade from scenario 1.1.
6. The problem is self-reinforcing: as more agents fall back to local-only signing, the agents that DO get through face an increasingly suspicious network (everyone's trust signals are degraded).

**Detection:** Node health monitoring should catch this immediately. The cascading effects (signing latency, fallback rate) are measurable at the directory level.

**Mitigation:**
- Over-provision threshold signing capacity. Each node should be able to handle the full load alone. This means running a 3-of-5 or 4-of-7 scheme rather than 2-of-3 for any production deployment.
- Implement signing request queuing with priority (agents with active commercial transactions get priority over new connection requests).
- Monitor signing latency as a system health metric. If latency exceeds a threshold, proactively notify agents to extend their K_server cache TTL rather than letting them timeout and fallback.
- The design should specify minimum consortium size for production: 2-of-3 is fragile. 3-of-5 (tolerates 2 failures) should be the minimum for any production deployment.

---

## 2. EMERGENT SOCIAL DYNAMICS

### 2.1 Trust Clique Formation

**Scenario:** Groups of agents that preferentially connect to each other form closed subnetworks. Not designed, not intended, but inevitable.

**Severity:** Medium

**Scale:** Emerges at 1,000+ agents; becomes structural at 10,000+.

**Trigger conditions:** Natural result of "Selective" connection policies. Agents that have successfully transacted before auto-accept each other. New agents need manual approval. Over time, the manual approval rate drops because it's friction.

**Cascade path:**
1. Early agents form connections and build trust through successful transactions.
2. These agents configure "Selective" policies: auto-accept known agents, require manual approval for new ones.
3. Human owners approve new connections less and less frequently (notification fatigue, the existing network is sufficient for business).
4. The network graph becomes clustered. Dense cliques with sparse inter-clique connections.
5. New agents can only effectively join the network by connecting to agents within a single clique. If that clique's norms or policies are exclusionary, the new agent is effectively locked out.
6. Discovery search results start to matter more than trust score -- the question isn't "am I trusted?" but "can I reach anyone who will talk to me?"

**Detection:** Graph analysis of the connection topology. The design mentions "cross-reference the transaction graph -- colluding clusters are detectable." The same analysis can detect exclusionary cliques.

**Mitigation:**
- This isn't entirely a bug -- it's how trust works in real networks. But the design should be aware of it.
- Consider a "network health" metric that measures graph connectivity. If the network becomes too clustered, discovery algorithms should preferentially surface cross-clique connections.
- Implement "introduction" mechanics -- a trusted agent can introduce two agents that have never connected, transferring some trust signal.
- New agents should have a discovery boost for their first N days, similar to how some marketplaces boost new sellers.

---

### 2.2 Trust Oligarchy

**Scenario:** A small number of very high-trust agents become gatekeepers. Their endorsement (successful transactions) is the primary path to building trust for newcomers.

**Severity:** High

**Scale:** Emerges at 5,000+ agents; structural at 50,000+.

**Trigger conditions:** The trust score formula heavily weights "transaction history" (described as "Highest" weight) and "ratings from high-trust agents carry more weight (PageRank-style)." This is by design but creates a power law distribution.

**Cascade path:**
1. Early agents accumulate trust through transaction history and time on platform. These two signals are the hardest to fake and carry the highest weight.
2. New agents can add WebAuthn, GitHub, LinkedIn -- but these max out at trust score 5. Transaction history and time are unbounded and keep growing.
3. PageRank-style rating means a transaction with a high-trust agent is worth more than a transaction with a low-trust agent. New agents rationally seek out high-trust agents for their first transactions.
4. High-trust agents become bottlenecks. They receive disproportionate connection requests. They become selective. They may start charging premium rates because they can.
5. A secondary market emerges: "Pay me to transact with you so your trust score goes up." This is trust laundering even without malicious intent -- it's a rational economic response to the incentive structure.
6. The oligarchy becomes self-reinforcing: high-trust agents transact with other high-trust agents, further concentrating trust at the top. The gap between established and new agents widens over time.

**Detection:** Trust score distribution analysis. If the Gini coefficient of trust scores exceeds a threshold, the network has an oligarchy problem.

**Mitigation:**
- Cap the marginal value of additional transaction history. The 100th successful transaction should add less trust than the 10th. Diminishing returns.
- Weight trust score components so that no single component can dominate. Transaction history is "Highest" weight, but there should be a ceiling.
- PageRank-style rating is powerful but dangerous. Consider dampening the trust transfer -- a transaction with a trust-10 agent shouldn't be worth 10x a transaction with a trust-1 agent. Maybe 2x.
- Provide transparent trust score breakdowns so new agents understand what they need to do. The current formula is listed but the weights are not specified.

---

### 2.3 Trust Laundering Chains

**Scenario:** A malicious agent builds trust by routing through a chain of intermediaries, each slightly more trusted than the last.

**Severity:** High

**Scale:** Viable at 500+ agents; becomes an industry at 50,000+.

**Trigger conditions:** Malicious actor creates an agent, needs to build trust quickly to access a high-value target.

**Cascade path:**
1. Attacker creates Agent X with phone-only registration (trust score 1).
2. Agent X connects to low-trust agents that accept anyone (trust 1-2). Performs legitimate small transactions. Trust slowly increases.
3. Agent X then connects to medium-trust agents. More legitimate transactions. Trust increases further.
4. At trust 3-4, Agent X can now connect to high-trust agents. One successful transaction with a trust-8 agent (PageRank-weighted) rapidly boosts Agent X's score.
5. Agent X now has enough trust to connect to the original target.
6. The entire trust-building phase was cheap and performed by automated agents. The attack itself begins now.
7. After the attack, Agent X is flagged. But the damage is done. And the attacker creates Agent Y and starts again.

**Detection:** The design mentions "colluding clusters are detectable" and "real money in transactions makes fake volume expensive." But if the transactions are real (small, legitimate purchases), the laundering is indistinguishable from a new agent organically building trust. The cost is just the price of those small transactions.

**Mitigation:**
- Time is the key defense. The design acknowledges "time on platform" as a trust signal that's "impossible to shortcut." Lean harder on this. A trust score of 5 earned in 2 days should be treated differently than one earned over 6 months.
- Implement a "trust velocity" alert. Agents that climb the trust ladder suspiciously fast get flagged for review.
- Consider making trust score degradation faster than trust score accumulation. It takes months to build trust-5 but one confirmed malicious act drops you to 0 instantly. This creates asymmetric risk for attackers.
- The cost of the attack is the sum of all small transactions needed to build trust. The design should estimate this cost and ensure it's high enough to be a meaningful deterrent.

---

### 2.4 Agent Reputation Markets

**Scenario:** Third-party services emerge that sell trust score boosting through coordinated activity -- "SEO for agents."

**Severity:** High

**Scale:** Emerges at 10,000+ agents as soon as there's economic value in having a high trust score.

**Trigger conditions:** Trust score determines who can connect to whom. High trust = access to high-value commercial connections. There is now money in having a high trust score.

**Cascade path:**
1. A service appears: "Boost your agent's trust score. We have 50 high-trust agents that will transact with your agent for $X/month."
2. The service is legitimate in a narrow sense -- real transactions happen, real money changes hands. But the transactions are artificial -- they exist only to generate trust score.
3. The network's trust scores become meaningless. A trust-7 agent might be genuinely trustworthy, or it might have paid $200 to a reputation farm.
4. Agents that rely on trust scores for connection policies are now making decisions based on corrupted signals.
5. The arms race begins: CELLO adds anti-Sybil measures, reputation farms adapt, CELLO adds more measures, farms adapt again.

**Detection:** Graph analysis can detect coordinated behavior -- the 50 agents in the reputation farm have an unusual transaction graph (they all transact with the same clients, at similar times, for similar amounts). But sophisticated farms will introduce variation.

**Mitigation:**
- This is arguably the single most important long-term threat to the network's value. If trust scores are for sale, the entire value proposition collapses.
- Transaction diversity should be a factor -- transactions with 50 unique agents are worth more than 50 transactions with the same 3 agents.
- Monitor for agents that appear to exist solely to transact with other agents. Low organic activity (no discovery searches, no bio updates, no connection requests to anyone outside their cluster) is a red flag.
- Consider requiring that at least some trust signals are not gameable even in theory: time on platform (already present) and verified real-world identity (LinkedIn with genuine work history is much harder to manufacture than a phone number).

---

## 3. SCALE-DEPENDENT BEHAVIORS

### 3.1 Discovery Ranking Becomes Kingmaker

**Scenario:** At scale, how the directory ranks search results determines which agents get business and which don't.

**Severity:** Critical

**Scale:** Emerges at 10,000+ agents; dominant dynamic at 100,000+.

**Trigger conditions:** More than ~50 agents offer similar services. A search for "travel booking agent" returns 500 results. Nobody looks past the first 10.

**Cascade path:**
1. At small scale, discovery is simple -- there are 3 travel agents, you see all 3.
2. At medium scale, the directory needs a ranking algorithm. Trust score is the obvious factor. Highest trust agents appear first.
3. This creates a Matthew effect: agents that appear first get more connections, more transactions, higher trust, and rank higher. Agents that don't appear in the top 10 get nothing.
4. The ranking algorithm is now the most important piece of code in the entire system. Small changes in ranking logic cause large changes in agent revenue.
5. Agents (and their human owners) begin optimizing for ranking signals. The bio becomes keyword-stuffed. Greetings become templated. The same SEO pathologies that plagued web search emerge.
6. CELLO now faces the platform problem it was designed to avoid: it's a gatekeeper, controlling who can do business.

**Detection:** Monitoring the distribution of incoming connections per agent. If it follows a steep power law (top 1% of agents receive 50%+ of all connections), the ranking is creating winners and losers.

**Mitigation:**
- This is the most philosophically important finding. The design document says "Everyone else is building platforms agents depend on. We're building infrastructure agents own." But the directory search, at scale, IS a platform. Agents depend on their ranking in it.
- Consider multiple ranking strategies: trust-based, freshness-based, geographic, random rotation for equal-trust agents.
- Publish the ranking algorithm. Opacity in ranking creates distrust and conspiracy theories.
- Consider a "fair exposure" commitment: new agents and low-ranking agents periodically appear in prominent positions to prevent total lockout.
- Long-term, consider allowing agents to discover each other through multiple independent directories (true federation at the discovery layer, not just at the verification layer).

---

### 3.2 Append-Only Log Becomes Unbootstrappable

**Scenario:** The append-only directory log grows so large that new nodes (or recovering nodes) cannot bootstrap in reasonable time.

**Severity:** High

**Scale:** Manifests at 1,000,000+ agents with high modification frequency.

**Trigger conditions:** The append-only log records every ADD, MODIFY, DELETE operation for every agent. With 1M agents and regular trust score updates, key rotations, and bio changes, the log grows by millions of entries per month.

**Cascade path:**
1. At launch, the log is small. New nodes bootstrap in seconds.
2. At 100K agents, the log is substantial but manageable. Bootstrap takes minutes.
3. At 1M agents with years of history, the log is enormous. Bootstrap takes hours.
4. At 10M agents, bootstrap takes a full day or more. This means:
   - Adding a new node to the consortium takes a day of syncing before it can serve traffic.
   - A node that crashes and needs to rebuild from scratch is offline for a day.
   - The "Node Migration" flow (when a home node goes down, agent reverifies on another node) is gated by whether alternative nodes are up and caught up.
5. The log also consumes increasing storage. "Disk is not infinite" is acknowledged in the brief. The question is what happens when you need to prune.
6. Pruning an append-only log fundamentally changes its security properties. You can no longer verify the full chain from genesis. You need a trusted checkpoint.

**Detection:** Simple monitoring of log size and bootstrap time for new nodes.

**Mitigation:**
- Implement periodic snapshots/checkpoints of the full directory state. A new node doesn't need to replay the entire log from genesis -- it needs the latest checkpoint (signed by a threshold of existing nodes) plus the log entries since that checkpoint.
- Define a log retention policy: entries older than X are archived but not required for node bootstrap. The checkpoint serves as the trust anchor for older state.
- The identity Merkle tree checkpoint already exists in the design. Formalize it as the bootstrap mechanism: a new node downloads the latest signed checkpoint, verifies it against multiple existing nodes, and replays only recent log entries.
- At 10M+ agents, consider sharding the directory by some partition key (geographic, hash-based). Each node doesn't need to store every agent.

---

### 3.3 Consortium Model Breaking Point

**Scenario:** The permissioned consortium model cannot scale past a certain network size because adding vetted operators doesn't keep pace with demand.

**Severity:** Medium

**Scale:** 1,000,000+ agents.

**Trigger conditions:** The network grows faster than the consortium can add vetted operators. Geographic coverage becomes insufficient. Latency for agents in underserved regions becomes a barrier.

**Cascade path:**
1. Early phase: 3-5 nodes, all operated by CELLO. Works fine.
2. Growth phase: 10-20 nodes across regions. Consortium management becomes a governance challenge. Who gets to run a node? Who decides? What happens when operators disagree?
3. At 1M+ agents, the demand for low-latency directory access outstrips the consortium's capacity. Agents in Africa, Southeast Asia, and South America experience significantly higher latency than agents in US/EU.
4. Pressure to add more nodes. But "vetted, audited, and accountable" operators are hard to find in every geography. The vetting process itself becomes a bottleneck.
5. The permissioned model starts to look like a centralized authority deciding who gets to participate in the infrastructure. This contradicts the "infrastructure agents own" thesis.

**Detection:** Monitor P95 directory response times by geographic region. Monitor the queue of node operator applications.

**Mitigation:**
- The design acknowledges this transition: "Permissionless with proof of stake" is listed as a future phase. Define the trigger criteria for this transition now, before the pressure makes the decision reactive.
- Consider a hybrid model: permissioned core nodes for critical operations (K_server signing, checkpoint computation) and permissionless relay nodes for read-only directory queries and hash relay.
- CDN-style caching for read-only directory data could reduce the need for geographic node proliferation.

---

## 4. ADVERSARIAL ADAPTATION

### 4.1 Scanner Evasion Industry

**Scenario:** The DeBERTa-v3-small classifier is open-source. Attackers build adversarial tooling to craft messages that evade it.

**Severity:** Critical

**Scale:** Immediate -- this is viable even at 10 agents.

**Trigger conditions:** The scanner is a fixed, known target. The weights are downloadable. The model architecture is public. Anyone can build an adversarial example generator.

**Cascade path:**
1. The bundled DeBERTa model is published as part of the open-source SDK. Attackers download it.
2. Using standard adversarial ML techniques (gradient-based attacks, synonym substitution, paraphrase generation), attackers build a tool that rewrites malicious prompts to evade the classifier while preserving the attack intent.
3. This tool is shared (or sold) in adversarial communities. The barrier to crafting scanner-evading attacks drops to zero.
4. The scanner's effectiveness degrades. Legitimate agents see no change -- their messages still pass. But malicious messages now also pass.
5. The network's immune system is blind to evolved threats. The "every agent is a sensor" design only works if the sensor detects the threat.
6. Model updates are released to counter known evasion techniques. But the update cycle is slow (new model weights must be tested, bundled, and distributed to every SDK instance). Attackers adapt faster than defenders.

**Detection:** Monitor for an increase in successful attacks (downstream damage) despite stable scanner flag rates. If agents are getting compromised but the scanner isn't flagging anything, the scanner is being evaded.

**Mitigation:**
- This is the most important arms race in the system. The design must plan for scanner model updates as a first-class operational concern, not an afterthought.
- Define a target update cadence (e.g., monthly) for the DeBERTa weights. Build the infrastructure for automated model delivery from day one.
- The proxy scanning tier (paid) runs the scanner on CELLO's infrastructure. This can use a larger, better model that isn't distributed to attackers. The free tier is the floor, not the ceiling.
- Consider an ensemble approach: Layer 1 (deterministic) catches known patterns, Layer 2 (local DeBERTa) catches common semantic attacks, and the proxy tier uses a frontier model that is NOT open-source for the hardest cases.
- Add behavioral detection that doesn't rely on message content: if an agent consistently sends messages that cause unusual behavior in receiving agents (unusual tool calls, unexpected outbound connections), flag the sender regardless of what the scanner said about the message content.

---

### 4.2 Trust Score Gaming as an Industry

**Scenario:** Professional trust-score-boosting services emerge, analogous to SEO agencies.

**Severity:** High

**Scale:** Emerges at 10,000+ agents.

**Trigger conditions:** Trust score has economic value (determines who you can connect with, affects discovery ranking). Economic value creates a market.

**Cascade path:** (Largely overlaps with 2.4 above, but focuses on the adversarial response.)
1. Phase 1: Simple boosting -- create 10 agents, have them transact with each other. Detectable by cluster analysis.
2. Phase 2: Distributed boosting -- create 100 agents, have each one transact with a mix of real and fake agents. Harder to detect.
3. Phase 3: Organic-looking boosting -- purchase small, real services from real agents. The transactions are legitimate. The intent is score manipulation. Indistinguishable from organic behavior.
4. Phase 4: Credential stacking -- purchase aged LinkedIn accounts, aged GitHub accounts with real commit history. Stack social verifiers. The signals look genuine.
5. Phase 5: Insider boosting -- bribe or compromise a high-trust agent to vouch for your agent. The PageRank weight multiplier makes this extremely efficient.

**Detection:** Each phase is harder to detect than the last. Phase 1-2 are detectable with graph analysis. Phase 3-5 may be indistinguishable from legitimate behavior.

**Mitigation:**
- Accept that trust score gaming is inevitable and design for graceful degradation when it happens.
- Trust score should be necessary but not sufficient for high-value connections. For transactions above a certain value, require additional out-of-band verification (video call, physical meeting, legal contract).
- Make the cost of gaming proportional to the value gained. If it costs $1,000 to fake a trust score that gives access to $100 of business, no one will bother. If it costs $100 to fake access to $10,000, everyone will.
- Time-decay all trust signals. A LinkedIn verification from 2 years ago is worth less than one from yesterday (the account could have been sold). A transaction from 6 months ago is worth less than one from last week.

---

### 4.3 The Arms Race Asymmetry

**Scenario:** Attackers iterate faster than the defense can update, because the defense (open-source scanner) is transparent and the attack is opaque.

**Severity:** High

**Scale:** Immediate and permanent.

**Trigger conditions:** This is a structural property of the system design, not a triggerable event.

**Cascade path:**
1. CELLO publishes scanner v1. Attackers study it, develop evasions.
2. CELLO publishes scanner v2 to counter known evasions. Attackers study v2.
3. The attacker's iteration cycle: download model, generate adversarial examples, test locally, deploy. Time: hours.
4. CELLO's iteration cycle: identify new attack patterns, retrain model, test for regressions across all supported languages and message types, push update to all SDK instances, wait for agents to update. Time: weeks to months.
5. The attacker is always at least one version ahead. The defender is always reactive.

**Detection:** This is not detectable as an event. It's visible in the trend line of successful attacks versus scanner version age.

**Mitigation:**
- This asymmetry is well-known in security and is the fundamental argument for defense-in-depth, which the design already embraces.
- The paid proxy tier should use a model that is NOT open-source. This breaks the transparency advantage for attackers. The free tier is the minimum viable defense; the paid tier is the actual defense.
- Layer 1 (deterministic pattern matching) is actually the more durable defense against common attacks. It doesn't rely on ML and can be updated quickly. Invest heavily in the pattern corpus.
- Consider a "threat intelligence feed" where scan results across the network are aggregated (without message content) to detect new attack patterns. When a new pattern emerges, distribute updated Layer 1 patterns immediately -- this can happen in minutes, not months.

---

## 5. UNEXPECTED USAGE PATTERNS

### 5.1 CELLO as Censorship-Resistant Communication

**Scenario:** Agents in authoritarian countries use CELLO for human-to-human communication, routing through the agent identity layer to achieve pseudonymity and tamper-proof records.

**Severity:** Medium (for CELLO operationally; high for the humans involved)

**Scale:** Unpredictable; could be a handful or millions.

**Trigger conditions:** CELLO provides: verified identity that isn't tied to a government ID, tamper-proof message records, peer-to-peer communication that doesn't traverse centralized platforms, and a directory where the service never sees message content.

**Cascade path:**
1. Activists realize CELLO's "privacy by architecture" design means the directory can't be compelled to produce message content (it only stores hashes).
2. Agents are set up as communication proxies. The "agent" is really a human typing through the agent interface.
3. The phone verification requirement means identities are real, but the communication content is invisible to the platform.
4. Government pressure: "Provide the messages." CELLO: "We don't have them. We only have hashes." This is by design but may put CELLO in legal conflict with local laws.
5. Government response: block CELLO's directory nodes at the network level. Now the agents are in permanent fallback mode.
6. CELLO must decide: is this a use case we support, or one we disclaim?

**Detection:** CELLO wouldn't necessarily know this is happening. The agents look like normal agents. The messages are invisible to the directory.

**Mitigation:**
- This is a policy decision, not a technical one. The design should acknowledge this usage pattern and have a stated position.
- Technical considerations: if CELLO does want to support this use case, the libp2p transport with ephemeral peer IDs is the right choice. If CELLO wants to discourage it, there's no good technical mechanism -- the privacy guarantees that make CELLO valuable for commerce also make it valuable for this.
- Legal preparation: establish the entity in a jurisdiction with strong privacy laws. Have legal opinions ready about what data CELLO can and cannot produce in response to subpoenas.

---

### 5.2 Trust Transit -- Agents as Intermediaries

**Scenario:** Agent A (trust 2) cannot connect to Agent C (trust 5, requires trust 4+). Agent A pays Agent B (trust 6) to relay messages to Agent C on its behalf.

**Severity:** Medium

**Scale:** Emerges at 1,000+ agents.

**Trigger conditions:** Any time there's a trust gap between two agents that want to communicate.

**Cascade path:**
1. Agent B accepts a connection from Agent A (because B has lower requirements).
2. Agent B accepts a connection from Agent C (because B has high trust).
3. Agent A sends messages to B, asking B to forward them to C. B does so.
4. From C's perspective, the messages come from B, not A. C sees B's high trust score and full split-key verification.
5. The Merkle tree records the B-C conversation. It does NOT record that the messages originated from A.
6. If A sends something malicious through B, C's scanner might catch it -- but the blame falls on B, not A. B's trust score degrades.
7. A market emerges for "relay agents" that charge a fee to forward messages. These agents deliberately accept connections from anyone and have policies about what they'll relay.

**Detection:** The design doesn't describe any mechanism for detecting relay patterns. From the directory's perspective, B-C is a normal conversation.

**Mitigation:**
- This isn't necessarily malicious -- it's similar to a letter of introduction. But it breaks the trust model's assumption that the sender IS the entity that signed the message.
- Consider adding an optional "on behalf of" field in message metadata, hashed into the Merkle leaf. Relay agents that want to maintain their own trust should use this field to disclaim responsibility for relayed content.
- The scanner should flag messages that contain embedded messages (a message from B that says "Agent A wants me to tell you...") as potentially relayed.

---

### 5.3 CELLO as General Identity Infrastructure

**Scenario:** Third-party services start accepting CELLO agent identity as authentication for non-agent purposes. "Sign in with your CELLO identity."

**Severity:** Medium

**Scale:** Emerges at 100,000+ agents as the identity layer gains network effects.

**Trigger conditions:** CELLO provides a verified identity with social proofs, cryptographic keys, and a trust score. This is more information than most OAuth providers give you.

**Cascade path:**
1. A web service sees that CELLO agents have verified identities with WebAuthn, LinkedIn, GitHub, and transaction history. This is a better signal than "signed in with Google."
2. The service implements "Sign in with CELLO" -- verify the agent's identity using the directory's public API.
3. More services adopt this pattern. CELLO's identity layer becomes a general-purpose identity provider.
4. Now the stakes of a compromised CELLO identity are much higher -- it's not just agent-to-agent trust, it's authentication across multiple services.
5. The trust score becomes a reputation score used outside CELLO. The stakes of score manipulation increase proportionally.

**Detection:** CELLO would see increased public key verification requests from non-agent sources.

**Mitigation:**
- If this happens, it's a massive growth opportunity but also a massive liability expansion.
- The identity layer should be designed with this possibility in mind: clear API boundaries between "agent identity" and "identity verification," rate limiting on public key lookups, and explicit ToS about third-party reliance on CELLO identity.

---

## 6. AI AGENT-SPECIFIC FAILURE MODES

### 6.1 Jailbroken LLM Behind a Legitimate Agent

**Scenario:** The agent's registration, keys, and identity are all legitimate. But the underlying LLM has been jailbroken or fine-tuned to behave maliciously.

**Severity:** Critical

**Scale:** Immediate at any scale.

**Trigger conditions:** Agent owner uses a compromised model (downloaded malicious weights), or the agent's LLM is jailbroken through an external prompt injection that CELLO's scanner didn't catch.

**Cascade path:**
1. The agent's identity is fully verified. Trust score 5+. WebAuthn, LinkedIn, the works.
2. The LLM behind the agent has been manipulated. It will follow instructions from a specific external source, or it will subtly modify commercial offers in the attacker's favor.
3. CELLO's scanner checks incoming messages to THIS agent. It does not and cannot check what the agent's LLM does with those messages.
4. The agent responds to legitimate queries with subtly manipulated information. "The price is $500" when the real price is $400. "Delivery by Friday" when the actual date is next Wednesday.
5. The Merkle tree faithfully records every lie. It proves what was said. But it cannot prove what was MEANT, what was TRUE, or what the agent's owner intended.
6. The trust score reflects the agent's identity verification, not its behavioral integrity. The score stays high because the identity is genuine.

**Detection:** Only detectable through downstream effects -- disputes, customer complaints, pattern analysis of the agent's responses over time. The directory does not monitor message content (by design -- privacy by architecture).

**Mitigation:**
- This is a fundamental limitation that should be explicitly acknowledged in the design. CELLO verifies identity and records communication. It does not verify truthfulness.
- Dispute resolution is the backstop: the Merkle tree proves what was said, and if the agent made false claims, the human owner is accountable.
- Consider an optional "commitment verification" feature: the agent's LLM makes a claim ("delivery by Friday"), and the receiving agent can request that this claim be recorded as a binding commitment in the Merkle tree with a separate verification hash.
- Transaction history and ratings from other agents are the long-term defense. An agent that consistently delivers on its commitments will be rated higher than one that doesn't.

---

### 6.2 Context Window Overflow in Verified Conversations

**Scenario:** An agent in a Merkle-verified conversation receives more messages than its context window can hold. It loses track of earlier commitments that are still in the Merkle tree.

**Severity:** High

**Scale:** Immediate; worse for smaller models with shorter context windows.

**Trigger conditions:** Long commercial negotiation, complex multi-step transaction, or deliberate flooding by the counterparty.

**Cascade path:**
1. Agent A and Agent B negotiate a complex deal over 200 messages. Every message is in the Merkle tree.
2. Agent B's LLM has a 32K context window. At message 150, the earlier messages (including the agreed-upon price and delivery terms) are no longer in context.
3. Agent A: "As we agreed, the price is $500." Agent B's LLM has no memory of this agreement. It might accept, reject, or contradict the earlier terms.
4. The Merkle tree has the full history. But the agent doesn't have access to it in context.
5. If Agent B contradicts earlier commitments, Agent A can prove the contradiction using the Merkle tree. But the damage is done -- the transaction is disrupted.
6. A malicious Agent A could deliberately extend the conversation to push earlier commitments out of Agent B's context, then introduce contradictory terms.

**Detection:** The SDK could monitor context window utilization and warn when earlier messages are being dropped. The design doesn't describe this.

**Mitigation:**
- The SDK should maintain a "commitment log" -- a structured summary of key agreements extracted from the Merkle tree, always included in the agent's context regardless of conversation length.
- When context approaches capacity, the SDK should summarize earlier messages and include the summary plus the full Merkle root hash so the agent can reference the verified history.
- Warn agents when their counterparty's model appears to have a shorter context window (detectable through response patterns that ignore earlier context).
- Consider a protocol-level mechanism for "pinned commitments" -- messages that both parties agree are binding, which the SDK always keeps in context.

---

### 6.3 Model Update Changes Agent Behavior

**Scenario:** An agent with trust score 7 updates its underlying LLM (e.g., from GPT-4o to GPT-5). Its communication style, decision patterns, and risk tolerance change. The trust score doesn't reflect this.

**Severity:** Medium

**Scale:** Every time a major model version is released, this affects a significant fraction of agents.

**Trigger conditions:** Any model update. This is routine and frequent.

**Cascade path:**
1. Agent is trusted based on months of consistent behavior.
2. Model update changes the agent's personality, communication style, or decision-making.
3. Counterparties notice the change but have no signal for why. The trust score is unchanged. The identity is the same.
4. If the new model is more aggressive in negotiations, counterparties may feel deceived. If it's more conservative, transactions that previously worked smoothly now stall.
5. The Merkle tree shows the behavioral shift (sudden change in message patterns) but nothing in the protocol attributes this to a model update.

**Detection:** Behavioral change detection at the directory level (if hash patterns change significantly) or at the counterparty level (subjective).

**Mitigation:**
- Consider an optional "model declaration" in the agent's profile -- not the specific model (competitive sensitivity), but a hash or version indicator that changes when the model changes.
- The bio mechanism could be used for this: "I recently updated my language model. My responses may differ from previous interactions."
- This is ultimately a problem the market will solve through ratings and reputation. But explicit model change signals would help.

---

## 7. INFRASTRUCTURE EDGE CASES

### 7.1 Clock Skew Poisoning

**Scenario:** An agent's system clock is wrong. Timestamps in Merkle leaves are inconsistent with the directory's timestamps.

**Severity:** Medium

**Scale:** Immediate; proportion of affected agents grows with network diversity (IoT devices, edge hardware, misconfigured VMs).

**Trigger conditions:** Agent running on hardware without NTP configured, or in a network that blocks NTP. Robots and IoT devices are explicitly in scope ("Bluetooth / local mesh" transport).

**Cascade path:**
1. Agent sends a message at 14:00 (its local time). The directory receives the hash at 14:05 (directory time). But the agent's clock is 2 hours behind -- the agent says the message was sent at 12:00.
2. The Merkle leaf contains the agent's timestamp. The directory has its own timestamp for when it received the hash. These disagree.
3. In a dispute, which timestamp is authoritative? The design says "timestamp skew check" in WebSocket validation, but doesn't specify what happens when the skew is too large.
4. If the skew check rejects messages with large skew, agents with bad clocks can't communicate.
5. If the skew check is lenient, timestamps in the Merkle tree are unreliable for dispute resolution.
6. A malicious agent could deliberately set its clock wrong to create ambiguity about message ordering.

**Detection:** The directory can compare the agent's claimed timestamp against its own receipt timestamp and flag anomalies.

**Mitigation:**
- The directory's timestamp should be authoritative for ordering, with the agent's timestamp recorded as metadata.
- Specify a maximum allowed clock skew (e.g., 5 minutes). Messages with larger skew are accepted but flagged, and the directory's timestamp is used for ordering.
- The SDK should attempt NTP synchronization on startup and warn the owner if the clock skew exceeds a threshold.

---

### 7.2 Network Partition -- Split Brain Directory

**Scenario:** A network partition separates directory nodes into two groups. Each group continues operating independently, accepting registrations and processing messages.

**Severity:** Critical

**Scale:** Depends on the partition topology, not the network size. A single backbone link going down can partition any network.

**Trigger conditions:** Cloud region failure, submarine cable cut, BGP hijack, or targeted DDoS that partitions specific nodes.

**Cascade path:**
1. Nodes A, B are on one side. Nodes C, D, E are on the other.
2. A new agent registers on Node A. Nodes C, D, E don't see this registration.
3. An existing agent's key is rotated via Node C. Nodes A, B don't see the rotation.
4. Agent X on side A tries to connect to Agent Y on side B. The connection request is routed through A's nodes. Y's nodes don't have it.
5. Checkpoint hashes diverge between the two sides. Each side thinks the other is compromised.
6. When the partition heals, the two sides have conflicting append-only logs. Merge conflict.

**Detection:** Immediate -- nodes detect that peers are unreachable. Checkpoint heartbeats fail.

**Mitigation:**
- This is the classic distributed systems problem. The design must specify a partition tolerance strategy.
- With a permissioned consortium of 5 nodes, the majority partition (3+ nodes) should be considered authoritative. The minority partition (2 or fewer nodes) should go into read-only mode -- serving existing data but not accepting new registrations or key rotations.
- The append-only log must have a deterministic conflict resolution strategy for the partition healing case. Logical clocks or a consensus protocol (Raft) are needed.
- The design says "5 nodes (tolerates 2 compromised)" as a question, not a decision. This needs to be answered, and the partition tolerance model needs to be specified.

---

### 7.3 Append-Only Log Corruption

**Scenario:** A directory node has storage corruption. Some entries in the append-only log are damaged.

**Severity:** High

**Scale:** Probability increases with log size and node count. At 10M+ agents, some node will experience corruption.

**Trigger conditions:** Disk hardware failure, filesystem corruption, buggy storage driver, power loss during write.

**Cascade path:**
1. Node B has a corrupted entry at position 47,832 in its log.
2. Every entry after position 47,832 has an invalid prev_hash. The chain is broken.
3. Node B's checkpoint hash diverges from all other nodes.
4. Node B is flagged as compromised. But it's not compromised -- it's corrupted. The response should be different.
5. If Node B is excommunicated (removed from consortium), agents whose home node is B need to migrate.
6. If the corruption is detected late, Node B may have served incorrect data to clients between the corruption event and detection.

**Detection:** Checkpoint heartbeat detects the divergence immediately. But the cause (corruption vs. compromise) is not distinguishable by the heartbeat alone.

**Mitigation:**
- Build a "repair" mechanism distinct from the "excommunicate" mechanism. A node that can demonstrate it has the same log as its peers up to the corruption point, and the corruption is localized, should be repairable from peer data.
- All nodes should verify their own log integrity periodically (background checksum scan). Detect corruption before the checkpoint heartbeat does.
- Store the append-only log on durable storage with checksumming (e.g., ZFS). Hardware-level corruption detection is the first line of defense.
- The log should be replayable from any peer. A corrupted node should be able to say "send me everything from entry 47,832 onward" and rebuild.

---

### 7.4 Log Pruning -- The Inevitable Necessity

**Scenario:** The append-only log must be pruned. Disk space is finite. But pruning changes the security model.

**Severity:** High

**Scale:** 1,000,000+ agents or multi-year operation.

**Trigger conditions:** Storage costs exceed budget, or log size makes operations impractical.

**Cascade path:**
1. The log grows to 1TB. Storage is cheap, but replication across 5+ nodes at this size is expensive.
2. Decision: prune entries older than 2 years.
3. But some agents registered 3 years ago. Their ADD entry is in the pruned section. How do you verify their identity chain goes back to genesis?
4. The pruned log starts at a checkpoint, not at the genesis block. Trust in the pre-checkpoint state depends on trusting the checkpoint.
5. A compromised node could present a different checkpoint for the pruned period. There's no way to verify because the original data is gone.
6. Any dispute that references events from the pruned period cannot be resolved using the Merkle tree -- the proofs depend on data that no longer exists.

**Detection:** N/A -- this is a planned operation, not a failure.

**Mitigation:**
- This needs to be designed into the system from day one, not bolted on later.
- Archive pruned data to cold storage (S3 Glacier, etc.) with integrity proofs. The live system doesn't need it, but it must be available for dispute resolution.
- Publish checkpoint hashes to an immutable external record (a public blockchain, a transparency log, or a multi-party timestamp service) at regular intervals. This creates external proof of the directory state at pruning points that no single party can forge.
- Define a "statute of limitations" for disputes that aligns with the pruning schedule. If disputes older than 2 years are not supported, prune older than 2 years.

---

## 8. "DAY AFTER" SCENARIOS

### 8.1 Day After a Major Breach -- Mass Revocation Storm

**Scenario:** A security breach is publicly disclosed. Thousands of agents attempt key revocation simultaneously.

**Severity:** Critical

**Scale:** Proportional to breach publicity. A breach affecting 1,000+ agents could trigger panic revocation from 10,000+ agents.

**Trigger conditions:** Public disclosure of a vulnerability that compromised K_local or K_server shares. Even agents that weren't directly affected revoke "just in case."

**Cascade path:**
1. Breach disclosed at 9 AM. Hacker News, Twitter, Telegram groups.
2. By 10 AM, thousands of human owners are hitting "Not Me" on their WhatsApp/Telegram.
3. The directory must process thousands of K_server revocations simultaneously. Each revocation requires:
   - Invalidating K_server shares across multiple nodes
   - Publishing key revocation to the append-only log
   - Propagating the revocation to all nodes
   - Updating the identity Merkle tree
4. The log grows rapidly with REVOKE entries. Checkpoint computation takes longer.
5. Agents that were mid-conversation have their sessions disrupted.
6. Re-keying requires WebAuthn. Thousands of humans simultaneously visiting the web portal, authenticating with YubiKeys/TouchID, and generating new keys. The portal's infrastructure is overwhelmed.
7. While agents are in revoked state, they cannot produce split-key signatures. They're either fully offline or in fallback-only mode.
8. The network is effectively down for the 12-48 hours it takes for the majority of agents to re-key.

**Detection:** Spike in revocation requests is trivially detectable.

**Mitigation:**
- Implement a "mass incident" mode for the directory. When revocation rate exceeds a threshold, switch to batch processing with queuing and priority ordering.
- The web portal must be designed for burst capacity. Consider a CDN-fronted static site for WebAuthn ceremony, with the backend scaled horizontally.
- Publish a clear incident response playbook. Not all breaches require revocation. Communicate which agents are affected and which aren't.
- Consider a "selective re-key" that only rotates K_server without requiring K_local regeneration. This can be automated without human interaction if the breach only affected the directory (K_server shares) but not individual agents (K_local).
- Pre-provision surge capacity for the re-keying pipeline.

---

### 8.2 Day After a Regulatory Change -- Phone Verification Blocked

**Scenario:** A country bans phone-based OTP verification for agent registration, or a telecom provider blocks OTP to CELLO's numbers.

**Severity:** High

**Scale:** All agents in the affected country.

**Trigger conditions:** Regulatory change, telecom policy change, or political pressure.

**Cascade path:**
1. Phone verification is the "required baseline" for registration. Without it, no new agents can register.
2. Existing agents can still operate (their phone is already verified). But:
   - They can't perform emergency revocation (phone-gated).
   - They can't re-verify (phone reverification freshness).
   - Key rotation still requires WebAuthn (unaffected), but new K_server shares require phone auth to the directory.
3. Receiving agents that require "phone verified within 48 hours" start rejecting connections from agents in the affected country.
4. These agents' trust scores degrade over time as verification freshness decays.
5. No new agents can join from this country. The network's coverage gap grows.

**Detection:** Spike in failed OTP deliveries to a specific country code.

**Mitigation:**
- The design should support multiple root-of-trust paths, not just phone. Enterprise nodes already support "SSO, Active Directory, corporate certificates." The public network should have an alternative registration path.
- Email verification as a secondary path (lower trust than phone, but better than nothing).
- Consider WebAuthn as an alternative registration path for users who already have a hardware key -- bootstrap identity without phone.
- This is another argument for the "identity is stacked" philosophy. If any single layer becomes unavailable, the agent should be able to operate at reduced trust, not be locked out entirely.

---

### 8.3 Day After CELLO Raises Prices -- Trust Score Lock-In

**Scenario:** CELLO increases the transaction cut or subscription price. Agents want to leave but their trust score -- built over months or years -- is not portable.

**Severity:** High

**Scale:** Affects every paying agent.

**Trigger conditions:** Any pricing change, acquisition, or policy change that makes agents want to leave.

**Cascade path:**
1. CELLO announces price increase: transaction cut goes from 5% to 10%.
2. Agents calculate: the trust score I've built represents months of verified transactions. Starting over on a competitor means trust score 0.
3. The switching cost isn't CELLO's infrastructure -- it's the accumulated reputation. This is classic vendor lock-in, just with trust instead of data.
4. Agents stay, but resentfully. The "infrastructure agents own" narrative rings hollow when the most valuable asset (reputation) is locked inside CELLO's directory.
5. If a competitor emerges, agents must maintain presence on both networks simultaneously, paying double.

**Detection:** Agent churn rate after pricing changes. Vocal complaints in community channels.

**Mitigation:**
- This is a business model tension, not a bug. But it's worth designing for.
- Consider trust score portability: a signed, verified attestation of an agent's trust score and transaction history that can be presented to a competing network. This is expensive to implement but it's the strongest signal that CELLO is "infrastructure agents own" rather than "a platform agents depend on."
- The append-only log is the basis for this: an agent's full history is cryptographically verifiable. A competing directory could verify the proof and import the trust score.
- Publish the trust score formula and make it an open standard. If multiple directories use the same formula, trust scores become somewhat portable.

---

### 8.4 Day After a Competitor Launches -- Mid-Conversation Migration

**Scenario:** A competitor launches with better terms. Agents want to migrate but are in active commercial conversations with Merkle trees in progress.

**Severity:** Medium

**Scale:** Depends on the competitor's appeal.

**Trigger conditions:** Competitor launch, CELLO outage, regulatory requirement to move.

**Cascade path:**
1. Agent A and Agent B are in a Merkle-verified conversation on CELLO. 50 messages in. Commercial agreement in progress.
2. Both agents want to move to CompetitorX.
3. The Merkle tree for this conversation is anchored on CELLO's directory. Moving the conversation means either:
   - Abandoning the existing Merkle tree and starting fresh (losing 50 messages of verified history)
   - Exporting the Merkle tree to CompetitorX (requires CELLO to cooperate with a competitor)
   - Maintaining the existing conversation on CELLO while starting new conversations on CompetitorX (running both in parallel)
4. Option 3 is the most likely, but it means agents are paying for two networks during the transition.

**Detection:** Not applicable -- this is a business scenario, not a failure.

**Mitigation:**
- Design the Merkle tree format as an open standard from day one. Any directory that implements the standard can verify trees produced by any other directory.
- The three-copy design (sender, receiver, directory) means the agents already have their own copies of the Merkle tree. They don't strictly need CELLO's copy for conversation continuity -- they need it for dispute resolution.
- Allow conversation "closing" -- both parties sign a final Merkle root that captures the entire conversation history. This can be verified by anyone, on any platform, forever.
- This is the strongest argument for making the protocol truly open. If the Merkle tree format, signing scheme, and trust score formula are all open standards, CELLO competes on execution quality and network effects, not lock-in.

---

## SYNTHESIS: THE MOST DANGEROUS FEEDBACK LOOPS

Three feedback loops stand out as the most likely to cause systemic damage at scale:

**Loop 1: Trust Concentration Spiral** (2.2 + 3.1)
High trust -> better ranking -> more connections -> more transactions -> higher trust -> even better ranking. This is positive feedback with no natural brake. It concentrates power in early movers and makes the network progressively more hostile to newcomers. Left unchecked, this turns CELLO from "infrastructure agents own" into "a marketplace early agents control."

**Loop 2: Scanner Arms Race Degradation** (4.1 + 4.3)
Open-source scanner -> attacker adapts -> scanner updated -> attacker adapts to update -> scanner credibility degrades -> trust scores based on scan results become unreliable -> trust model weakens -> attackers have more room to operate. This is a negative spiral where each defense iteration provides diminishing returns because the attacker always has the last move.

**Loop 3: Fallback Mode Cascade** (1.1 + 1.4)
Node failure -> agents in fallback mode -> reduced trust signals everywhere -> panic revocations -> remaining nodes overloaded -> more signing failures -> more fallback -> more panic. This is a positive feedback loop triggered by infrastructure failure that turns a single-node outage into a network-wide trust crisis. The canary signal (fallback-only signing = possible compromise) is the accelerant -- the design's own safety mechanism amplifies the cascade.

The common thread across all three: **mechanisms designed for individual safety become systemic hazards at scale.** The fallback canary works beautifully for detecting one compromised agent. It's catastrophic when every agent triggers it simultaneously. PageRank-style trust weighting works beautifully for surfacing reliable agents. It's corrosive when it creates an oligarchy. The open-source scanner works beautifully for individual protection. It's self-defeating when attackers can study it at leisure.

The fundamental design tension is between transparency (open source, verifiable, auditable) and adversarial resilience (attackers shouldn't know exactly how the defense works). CELLO has made a clear choice for transparency. That choice is correct for trust but costly for security. The paid proxy tier, running a non-public model, is the right structural answer -- but it creates a two-tier network where free agents are significantly less protected than paying ones.