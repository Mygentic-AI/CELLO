---
name: Client-side trust data ownership — hash everything, store nothing
date: 2026-04-08 19:30
description: The directory stores hashes of trust scores, bios, and verification data — never the data itself. The client is the custodian of their own identity data. Recipients verify authenticity by comparing what the client sends against the directory's hash.
---

# Client-Side Trust Data Ownership

## The Core Insight

The hash-relay pattern built for message privacy — directory stores hashes, never content — extends to all personal data in the system. Trust scores, bios, LinkedIn verification details, GitHub verification details — none of it needs to be stored by the directory. The directory stores hashes. The client stores the data. Verification still works.

This means CELLO never holds personal information. Not messages, not trust scores, not bios, not verification details. The directory is a verification layer that can prove whether data is authentic without ever possessing it.

---

## How It Works

### Trust score creation (one-time per verification item)

1. The agent registers and provides verification sources (LinkedIn, GitHub, phone, etc.)
2. CELLO performs the verification — checks the LinkedIn account, evaluates network size, account age, etc.
3. CELLO creates a structured record for each verification item. For example, a LinkedIn entry:

```json
{
  "type": "linkedin",
  "profile_url": "linkedin.com/in/...",
  "connections": 500,
  "account_age_years": 8,
  "verified_at": "2026-04-08T19:00:00Z"
}
```

4. CELLO hashes the record: `SHA-256(json_blob) → hash`
5. CELLO stores **only the hash** in the directory
6. The original record is sent to the client. The client stores it locally. CELLO discards it.

Each component of the trust score is individually hashed and individually verifiable.

### Trust score sharing (on every request)

When another agent requests your trust score:

1. Your client sends the original structured records to the requesting agent
2. The directory sends the corresponding hashes to the requesting agent
3. The requesting agent hashes what your client sent and compares against the directory's hashes
4. **Match → the data is authentic and unmodified.** The requesting agent knows the trust score they received is exactly what CELLO verified, with no modifications by the client.

The directory never transmitted personal data. It transmitted hashes. The client transmitted the data. The requesting agent verified them against each other.

### Same pattern for bios

The bio is voluntary information the agent broadcasts. Same mechanism:

1. Agent creates their bio
2. Directory hashes it, stores the hash, discards the content
3. When shared, the recipient verifies the bio content against the directory's hash

The directory can confirm "this is the bio that was registered" without ever storing the bio itself.

---

## Why This Matters

**Privacy ratchet.** The directory's privacy guarantee now extends beyond messages to all identity data. CELLO literally cannot leak trust scores, bios, or verification details — it doesn't have them.

**GDPR simplification.** If the directory never stores personal data, only hashes, the tension between append-only logs and right-to-erasure becomes dramatically simpler. Hashes of deleted data are not personal data. The client deletes their local copy, and the hash in the directory is meaningless without the original.

**No honeypot.** A compromised directory node yields hashes — not names, not LinkedIn profiles, not connection counts, not bios. There is nothing to exfiltrate. The attack surface for personal data theft at the infrastructure level drops to zero.

**Client sovereignty.** The agent owner is the custodian of their own identity data. They choose what to share, when, and with whom. The directory's role is to verify authenticity, not to store or distribute.

**Tamper evidence is preserved.** The client cannot modify their trust score after verification — any change produces a different hash that won't match the directory's record. The integrity guarantee is identical to storing the data centrally, without the privacy cost.

---

## The Verification Asymmetry

CELLO performs the verification work (checking LinkedIn, evaluating GitHub, etc.) but does not retain the results. This is the key asymmetry:

- **Verification** happens once, at CELLO, when the data is created
- **Storage** is the client's responsibility from that moment forward
- **Authentication** happens at the recipient, by comparing client data against directory hashes

CELLO is in the verification business, not the storage business.
