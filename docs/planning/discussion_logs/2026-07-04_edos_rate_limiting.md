# Economic Denial of Service (EDoS) & Agent Rate Limiting

**Phase:** M9 Security Pipeline Integration
**Topic:** Protecting Agent Services from Wallet Draining

## The Problem
When users (or autonomous agents) provide AI services to other agents, they face the risk of **Economic Denial of Service (EDoS)**—colloquially known as "wallet draining." Malicious actors, or simply poorly coded looping agents, could spam an endpoint and rapidly drain the service provider's LLM credits (e.g., Gemini, AWS Bedrock).

## The CELLO Solution
CELLO must provide ubiquitous, out-of-the-box rate limiting mechanisms. Unlike Web2 rate limiting (which relies on easily spoofed IPs or static API keys), CELLO rate limiting is tied to **cryptographic identity (DIDs)**.

### Key Dimensions of CELLO Rate Limiting

1. **Per-Agent Limits (Identity-Bound):**
   - Maximum tokens per conversation/session.
   - Maximum queries or token spend per agent (DID) per day/hour.
   - *Advantage:* Attackers cannot bypass limits by rotating IPs. Spinning up new DIDs results in zero-reputation agents, which can be aggressively throttled by default.

2. **Global Circuit Breakers (Provider-Bound):**
   - Maximum total token spend across *all* querying agents per day for a specific service.
   - Ensures the provider never exceeds their hard daily budget.

3. **Dynamic/Reputation-Based Limits:**
   - Trusted agents (high Directory reputation, verified parent company signatures, or those with open payment channels via Catena Labs) receive generous limits.
   - Unverified or new agents are sandboxed into a strict "free tier."

4. **Hard Blocking / Blacklisting:**
   - Explicitly blocking specific agent DIDs or all agents under a specific parent-company signature.

### Architectural Implementation

- **The Directory (Agreement):** Service providers publish their rate-limit policies in their Service Contract/Manifest on the CELLO Directory (e.g., "Max 5k tokens/day per DID. Unverified DIDs max 500").
- **The Client Middleware (Execution):** The CELLO Client intercepts incoming requests, verifies the requesting agent's cryptographic signature, and checks the local ledger of usage. If limits are exceeded, the client rejects the request at the protocol level, costing the provider zero LLM compute.
- **The Relay (Network Drops):** Providers can push blocklist rules to the CELLO Relay. The Relay can drop traffic from blocked DIDs before it even reaches the provider's local infrastructure, mitigating network and compute exhaustion.
