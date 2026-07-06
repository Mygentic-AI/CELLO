---
name: token-ux-short-claim-code-spec
type: implementation-plan
date: 2026-07-06
topics: [registration, pre-auth-capability, token-ux, claim-code, signaling, directory-migration, ops-agent]
status: planned
description: Execute-ready spec for #2b — a short claim-code the agent redeems for the pre-auth capability, so the operator never handles the 570-char blob. #2a (whitespace-tolerant parse, SHIPPED v0.0.71) already fixes the acute copy-paste fragility; this is the ergonomic follow-up. Additive (existing capability-blob path stays intact).
---

# #2b — Short claim-code + redeem (execute-ready spec)

## Why (and why it's separate from #2a)
Registration hands the operator a ~570-char base64 capability blob to paste as `CELLO_REGISTRATION_TOKEN`.
**#2a (SHIPPED, crypto 0.0.16 / v0.0.71) made the client parse whitespace-tolerantly** — the acute
copy-paste-wrap-mangling pain is fixed; the blob is robust today. #2b replaces what the operator *sees*
with a short typeable claim-code the agent redeems under the hood — the self-verifying capability still
does the real work at DKG. Cosmetic, forgivable, additive.

## Grounded facts (verified 2026-07-06)
- The **directory** issues/signs the capability at `POST /internal/pre-authorize` (internal-api-server.ts:75,
  returns `{ token: capability, expiresAt }` via `issuePreAuthCapability`, pre-auth-token-repository.ts).
  `/internal/` is ops-agent→directory only (SG-restricted), NOT client-reachable.
- The **client** reaches the directory **only over libp2p signaling frames** (registration-manager.ts:
  `sendSignalingFrame` → `SignalingManager.sendRaw`, CBOR/lp-encoded). No client-reachable directory HTTP.
- Therefore the redeem MUST be a new **signaling frame**, not an HTTP call.
- Next Flyway migration = **V43** (V42 is the latest). OpsAgentExpectedMigrationVersion must bump to 43.
- Replication is healthy post-reset; a natural TEXT-keyed table replicates cleanly (no BIGSERIAL stagger
  needed — the collision fix only matters for BIGSERIAL ids).

## Design
**Storage (directory, V43, REPLICATED):**
```
CREATE TABLE capability_claim_codes (
  code            TEXT PRIMARY KEY,          -- short, e.g. CELLO-<base32(10)>, ~16 chars
  capability      TEXT NOT NULL,             -- the full base64url capability blob
  expires_at      TIMESTAMPTZ NOT NULL,      -- = capability.expires_at
  redeemed_at     TIMESTAMPTZ,               -- set on first redeem (optional single-use)
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```
Natural TEXT key → safe to replicate so the client can redeem against ANY node it's connected to. Add
`capability_claim_codes` to `PUBLICATION_TABLES` in setup-replication.sh + REFRESH (the script already does).
RLS: cello_service INSERT + SELECT + UPDATE(redeemed_at). No BIGSERIAL → no stagger.

**Issuance (directory):** in the `/internal/pre-authorize` capability branch, after building the capability,
generate `code` (crypto-random base32, prefix `CELLO-`), INSERT `{code, capability, expires_at}`, and return
`{ token: capability, claim_code: code, expiresAt }` (keep `token` for back-compat).

**Redeem (directory, NEW signaling frame):** handler for `{ type: "redeem_claim_code", code }` → SELECT
capability WHERE code=$1 AND expires_at>now() → reply `{ type: "claim_code_redeemed", capability }` (or
`{ ok:false, reason: "claim_code_not_found"|"claim_code_expired" }`). Optionally set redeemed_at (single-use).
Wire in directory-node.ts alongside the other inbound handlers. Frame defs in protocol-types if framed there.

**Client (cello-client daemon):** where `CELLO_REGISTRATION_TOKEN` is read, detect a claim-code vs a blob
(heuristic: starts with `CELLO-` / not valid base64url-JSON). If a code: send `redeem_claim_code` over
directory signaling, await `claim_code_redeemed`, use the returned capability. Else: use the blob directly
(unchanged — this is the additive part; #2a already robustifies the blob path). Timeout → clear error.

**Ops-agent:** state-machine.ts:536/599 — send the `claim_code` (short) instead of the blob. Keep a note
that the code expires with the capability. (directory-pre-auth-client.requestToken returns claim_code now.)

## Sequence (SPARC + TDD, per cello rules)
1. Directory: V43 migration + repo (insert/lookup) + issuance change + redeem frame handler. Tests red first.
   Bump `OpsAgentExpectedMigrationVersion` default → 43 in cello-ssm-parameters.yaml (migration rule).
2. protocol-types (if frames live there): add the two frame shapes → publish cascade includes it.
3. Client: redeem-on-code path + tests (extend session-fixture).
4. ops-agent: relay the short code + tests.
5. Both reviewers on each repo's diff; fix every finding. Gate (test/lint/typecheck/build).
6. cello-publish cascade (client + protocol-types) → beta → binary-verify.
7. Deploy directory (batch ALL directory changes into ONE commit → ONE ~25-30min 3-region deploy) +
   ops-agent. 4-min DEEP deploy-watch cron. After directory deploy: bump the ops-agent SSM
   expected-migration-version to 43 (the CI-doesn't-run-deploy.sh hazard). setup-replication.sh re-run to
   add capability_claim_codes to the publication.
8. Verify: register via a short code end-to-end on all 3 regions; the capability redeems + DKG succeeds.

## Risk notes
- ADDITIVE: the capability-blob path stays; a #2b bug can't break existing registration (blob still works).
- Touches the launch-critical registration path + a directory migration + 2 deploys — do it with a clear
  head, not at the tail of a huge context. Batch directory changes into one deploy.
- Single-use: the capability's nonce is already single-use downstream (NonceBinder); making the CODE
  single-use (redeemed_at) is optional hardening, not required for correctness.
