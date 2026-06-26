---
name: m8-outline
type: outline
date: 2026-06-26
topics: [m8, portal, outline, stories, dependency-order, scaffold, auth, agents, trust-signals, write-api]
status: draft
description: >
  The M8 (Portal Skeleton) story map — every work unit in dependency order,
  scaffold-first, derived from journeys 01–04, the account-control model, and the
  portal-backend technical decisions. The plan you review before any story YAML is
  written. Stories follow the CELLO format (E2E-first, observability ACs).
---

# M8 — Portal Skeleton: Story Outline

The full M8 story set on one page, in dependency order. Derived from the M8 journey docs
([[01-onboarding-and-authentication]], [[02-agents]], [[03-trust-signals]],
[[04-trust-signal-mechanism]]), the account-control model (identity-lifecycle log §7), and
the portal-backend decisions (dedicated Postgres, server-side sessions, in-memory client
cache, email-yes / Telegram-via-ops-agent). Review this before the story YAMLs are written.

## The milestone claim (E2E-first anchor)

> A stranger installs the client, registers an agent via the ceremony, **magic-links into the
> portal**, enrolls **WebAuthn**, and sees the agent **appear with live presence**; enrolls a
> second agent and sees both; can **suspend** one via the lever; and the **Trust Signals**
> section shows the four-class scaffold with the WebAuthn signal **live** and the rest honest
> placeholders.

This is `CELLO-M8-E2E-001` — written first, verified last (milestone-close gate, live
multi-process smoke test).

## Cross-cutting (apply to every story, not separate stories)

- **Observability (M4+):** named `domain.noun.verb` events with required context fields +
  `correlationId` threading + error-path coverage. e.g. `portal.session.started`,
  `portal.agent.suspended`, `portal.trust_signal.handed_off`, `directory.presence.transition`.
- **The invariant:** **no plaintext / PII / token / message content ever persisted
  server-side** except the bare email (KMS-encrypted) in the portal backend. Everything
  written to the directory is hashes / flags / sealed ciphertext (it all replicates).
- **Where the work lives** (per story): **portal** = greenfield frontend + backend ·
  **directory** = `trustless-cello/packages/directory` · **daemon** = `cello-client`.

## Scoping decisions (RATIFIED 2026-06-26)

- **Repo:** the portal lives in its own **private repo `cello-portal`** in the Mygentic-AI org
  — distinct from `cello-client` (public, client) and `trustless-cello` (server-side + IaC).
- **Hosting:** AWS **us-east-1** — frontend on a static/edge host, backend on ECS.
- **Portal ↔ directory auth:** the existing `/internal/pre-authorize` **API-key** pattern,
  extended for the read + write API (no new mTLS machinery).

---

## Stories, in dependency order

### Wave 0 — Foundation (parallel)
| ID | Title | Where | Depends |
|---|---|---|---|
| `CELLO-M8-SCAFFOLD-001` | Portal frontend: Next.js app, light/dark design system as code, app shell (nav + top bar), routing, auth-gated layout, **stranger signpost landing** | portal | — |
| `CELLO-M8-SCAFFOLD-002` | Portal backend: service + dedicated **PostgreSQL** + migrations + KMS envelope encryption + secrets | portal | — |
| `CELLO-M8-PRESENCE-001` | `agent_presence` (mutable upsert) + edge-triggered writer (hook `#streams`) + `directory_nodes.last_heartbeat_at` + startup reconciliation + the "online = row online AND node fresh" read rule | directory | — |

### Wave 1 — Auth core
| ID | Title | Where | Depends |
|---|---|---|---|
| `CELLO-M8-AUTH-001` | Magic-link bootstrap + **server-side sessions**: email link + 6-digit code, durable session, sessions table, email delivery, email-hash → `account_id` resolution | portal | SCAFFOLD-001/002 |

### Wave 2 — Strong auth + read path
| ID | Title | Where | Depends |
|---|---|---|---|
| `CELLO-M8-AUTH-002` | WebAuthn enrollment + login (multi-credential, per-device; `@simplewebauthn`) | portal | AUTH-001 |
| `CELLO-M8-AUTH-003` | TOTP enrollment + verification + **backup codes** (`otplib`) | portal | AUTH-001 |
| `CELLO-M8-READ-001` | Authenticated portal → directory **read path**, `account_id`-scoped (agents, presence, sessions-by-fingerprint) | portal + directory | AUTH-001, PRESENCE-001 |

### Wave 3 — Enforcement, account screen, agents home, write seam
| ID | Title | Where | Depends |
|---|---|---|---|
| `CELLO-M8-AUTH-004` | Strong-auth enforcement: 7-day grace, waiver request, per-account admin override | portal | AUTH-002/003 |
| `CELLO-M8-AUTH-006` | Account & Security screen (factors, active sessions, log-out-everywhere, email, masked-phone reconcile) | portal | AUTH-001..004 |
| `CELLO-M8-AGENTS-001` | **Agents home / M8 landing page**: agent list + presence (online/last-seen) + alerts strip + account-posture header | portal | READ-001, SCAFFOLD-001 |
| `CELLO-M8-WRITEAPI-001` | Directory **write API** seam: authenticated, `account_id`-scoped, hashes/flags/ciphertext-only, never plaintext/PII/tokens | directory | READ-001 |

### Wave 4 — Lever + trust mechanism
| ID | Title | Where | Depends |
|---|---|---|---|
| `CELLO-M8-LEVER-001` | **Suspend/burn lever** (pause / retire / burn): revocation honor-check in the ceremony/co-signing path + replication (`agent_revocations` V32 exists) + portal trigger (step-up) + lever UI on the Agents home | directory + portal | WRITEAPI-001, AGENTS-001, AUTH-002 |
| `CELLO-M8-TRUST-001` | **Trust-signal handoff mechanism** (the general pipe) + **WebAuthn as first live signal**: stateless portal pipeline (verify → JSON → hash → seal to `k_local` → write hash + ciphertext) + directory identity-tree table + ephemeral pickup queue + daemon pickup flow (`openSealed` → verify → store → ACK); proven end-to-end by WebAuthn enrollment | portal + directory + daemon | WRITEAPI-001, AUTH-002 |

### Wave 5 — Trust signals UI
| ID | Title | Where | Depends |
|---|---|---|---|
| `CELLO-M8-TRUST-003` | **Trust Signals UI**: four-class placeholder scaffold; WebAuthn cell live (via TRUST-001), rest honest placeholders; no composite/TrustRank | portal | SCAFFOLD-001, TRUST-001 |

### Gate
| ID | Title | Where | Depends |
|---|---|---|---|
| `CELLO-M8-E2E-001` | M8 milestone sign-off — the live smoke test of the milestone claim above | all | everything |

---

## Sequencing summary

```
Wave 0:  SCAFFOLD-001 | SCAFFOLD-002 | PRESENCE-001        (parallel)
Wave 1:  AUTH-001
Wave 2:  AUTH-002 | AUTH-003 | READ-001
Wave 3:  AUTH-004 | AUTH-006 | AGENTS-001 | WRITEAPI-001
Wave 4:  LEVER-001 | TRUST-001
Wave 5:  TRUST-003
Gate:    E2E-001  (written first, verified last)
```

14 stories (signpost folded into SCAFFOLD-001; WebAuthn-as-signal folded into TRUST-001).
The portal frontend (SCAFFOLD/AUTH/AGENTS/TRUST-UI) and the server-side work
(PRESENCE/WRITEAPI/LEVER/TRUST pipe) parallelize across the portal and directory repos.

## Explicitly NOT in M8 (no stories)

- **Per-agent detail page** (J02 D9 — deferred to the daemon channel).
- **Standalone operational Dashboard** (J02 D11 — folded into the Agents home; the real one
  is deferred to the daemon channel).
- **Connections / connection-policy UI** (dropped / local-only).
- **Trust-signal connectors** — LinkedIn / GitHub / device OAuth + scrape + eval (**M10**;
  M8 builds only the pipe + WebAuthn).
- **Bio, recovery contacts, succession, endorsements, discovery, contact aliases,
  notification center** (M10 / M11).
- **Register / start / stop / set-current an agent** (rejected — agents appear).

## Notes for the story-writing pass

- Each story carries its observability ACs and the no-plaintext invariant as ACs, per the
  cross-cutting section.
- `LEVER-001` and `TRUST-001` both consume `WRITEAPI-001` — keep the write seam's discipline
  (hashes/flags/ciphertext only) as a shared, tested contract.
- The **per-screen design specs** (for the visual-design process) are a separate deliverable:
  Sign-in / signpost, Account & Security, Agents home (+ lever), Trust Signals scaffold.
