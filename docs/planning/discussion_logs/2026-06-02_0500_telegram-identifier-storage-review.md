---
name: Telegram Identifier Storage Review
type: discussion
date: 2026-06-02
topics: [privacy, security, telegram, registration, operations-agent, database]
status: open
description: Review of what Telegram identifiers we store, their exposure risk, and whether to add username storage. Concludes with action items for a security review of channel_user_id protection.
---

# Telegram Identifier Storage Review

## Context

The Operations Agent registration flow captures Telegram identifiers during phone verification. This discussion examines what we store, what's exposed in a breach scenario, and whether we should additionally store the Telegram username.

## What We Store Today

| Telegram Identifier | Column | What's Stored | Purpose |
|---|---|---|---|
| Phone number | `phone_stub_hash` | SHA-256 hash only — raw number discarded immediately | Account deduplication (one active registration per phone) |
| Numeric User ID (`from.id`) | `channel_user_id` | Stored as plaintext string (e.g. "987654321") | Send messages via Bot API; match inbound messages to registration records |
| Username (@handle) | — | **Not stored** | — |

## Breach Exposure Analysis: `channel_user_id`

If the `registrations` table is exfiltrated, an attacker obtains a list of Telegram numeric user IDs — effectively a CELLO membership list.

**What can an attacker do with numeric user IDs?**

| Action | Via Bot API | Via MTProto/TDLib (user account) |
|---|---|---|
| Send messages | Only if user previously started the attacker's bot | Yes — can message anyone by numeric ID directly |
| Resolve to username/profile | Limited | Yes — `getUser` returns full profile |
| Phishing/spam | Blocked by prior-interaction requirement | Possible — message appears as "unknown contact" with accept/block prompt |

The primary risk is phishing via MTProto: an attacker creates a regular Telegram account, uses the numeric IDs to message users ("Your CELLO agent needs re-registration, click here"), and relies on social engineering past the accept/block prompt.

## Should We Store the Username?

**Operational value of storing username:**
- Human review of suspicious accounts — a human can type `@username` into Telegram and see the profile (photo, bio, account age) to make a judgment call. You cannot navigate to a profile by numeric ID in the Telegram client UI.
- Admin dashboard readability — `@andre_p` is meaningful; `987654321` is not.
- Broadcast targeting — segment by user identity for update notifications.

**Privacy impact of adding username:**
- Negligible. The numeric ID is already the deanonymization vector. Anyone with the numeric ID can resolve it to a username via MTProto's `getUser`. Storing the username doesn't increase the breach blast radius — it just saves the attacker one API call.

**Recommendation:** Store Telegram username as a nullable informational field. It provides operational value without worsening privacy posture. Usernames can change (they're mutable), so never use as a key or stable identifier — the numeric ID remains the canonical reference.

**Implementation:** Either add to `state_data` JSONB (no migration, available now) or add a `channel_username TEXT` column in a future migration if queryability is needed.

## Security Review: Protection of `channel_user_id`

Current protections around the `registrations` table:

- **RDS encryption at rest** — enabled (AWS-managed key or CMK via `cello-kms.yaml`)
- **RLS policies** — only `cello_service` and `cello_ops_agent` roles can access; no DELETE permitted
- **Network isolation** — RDS is in private subnets, no public endpoint
- **Secrets Manager** — RDS credentials rotated via Lambda; no hardcoded passwords
- **KMS envelope encryption** — used for FROST key shares and envelope keys; **unclear if applied to the RDS storage layer beyond AWS's default encryption**

**Action items:**

1. **Review whether RDS uses the CELLO CMK or AWS-managed key.** If AWS-managed, consider switching to the `cello-dev-master-key` CMK for explicit key control and audit trail. This affects whether we can revoke access to the underlying storage independently of IAM.

2. **Confirm no unintended access paths to `channel_user_id`.** The field is in `registrations`, which is accessible by `cello_service` (directory) and `cello_ops_agent` (operations agent). Verify that no other role or service has read access — particularly the relay, which should never see registration data.

3. **Consider application-level encryption of `channel_user_id`.** This would mean a DB breach alone doesn't expose the IDs — you'd also need the application-level encryption key. Trade-off: adds complexity to the query path (can't index or query by encrypted value without decryption). Given current threat model (small user base, strong network isolation, rotated credentials), this is likely overkill now but should be revisited as the network grows.

**Assessment:** The data is likely well-secured given the existing layers (network isolation, RLS, credential rotation, encryption at rest). A focused review should confirm these protections are correctly applied to the `registrations` table specifically, and that no access path has been inadvertently opened during M5/M6 infrastructure changes.
