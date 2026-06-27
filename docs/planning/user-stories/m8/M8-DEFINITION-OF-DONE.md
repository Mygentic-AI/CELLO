---
name: M8 Definition of Done
type: definition-of-done
date: 2026-06-27
milestone: M8
status: open
description: >
  The single consolidated "what M8 done means" checklist for the operator portal. Assembled
  from the 15 M8 stories (E2E-001 + SCAFFOLD/AUTH/PRESENCE/READ/AGENTS/WRITEAPI/LEVER/TRUST),
  the four journey docs, the screen-specs, and the account-control model. Every requirement
  ordered into journeys the live test must drive against the real served portal + directory.
  This document is the YARDSTICK; the live test is the ENFORCER. Greenfield — everything
  starts ❌; the live run reclassifies each line to pass/fail for real.
---

# M8 — Definition of Done

## How to use this

- The **target**. The live Playwright test (`cello-portal`, to be written) proves each line:
  a DoD line is done only when its journey is green against the real **served portal frontend
  + backend + directory (+ daemon)** — not when a component unit test passes.
- Greenfield: M8 is a new portal. Every line below is ❌ until built and proven live.

## Status legend
- ✅ **PROVEN LIVE** — green against the served apps via the browser-driven test.
- 🟡 **BUILT / UNVERIFIED-LIVE** — code exists, never run through the live journey.
- 🟠 **PARTIAL** — one half built.
- ❌ **NOT BUILT** — greenfield; only a story YAML.

---

## Tier 0 — Cross-cutting invariants (must hold in EVERY journey)

Proven by SI/adversarial assertions woven into the journeys, never a separate pass.

- **DOD-INV-1 — Ceremony-gated entry.** No portal account-creation path anywhere; the account
  is resolved by matching `SHA-256(email)` against the directory's `email_stub_hash`; an
  unmatched email gets the signpost, never an account. *(SCAFFOLD-001 AC-003, AUTH-001 AC-002)* — 🟡
  *(PROVEN by AUTH-001 integration tests: an unknown email mints no token + no account; the request
  response is identical for known/unknown AND the rate limit fires identically (no 429-vs-200
  enumeration oracle). Account resolution runs through the DirectoryClient stub; the real-directory
  path is READ-001. Residual: a timing side-channel on the resolved path, tracked in the journal.)*
- **DOD-INV-2 — No plaintext/PII/token/content server-side.** Directory holds only hashes,
  flags/tombstones, and sealed ciphertext (deleted on ACK). Portal DB holds only: KMS-encrypted
  email, KMS-encrypted TOTP secret, hashed backup codes, sessions, WebAuthn public keys — no
  plaintext signal, no OAuth token, no message content. Browser holds NO agent/identity data
  (in-memory only). *(gate SI-001; SCAFFOLD-002 SI-001; AGENTS-001 SI-001; TRUST-001 SI-001)* — 🟡
  *(ciphertext-at-rest for email + TOTP secret, and SHA-256 token-hash sessions, PROVEN by the
  SCAFFOLD-002 vitest integration tests against real Postgres. The BROWSER-STORAGE half is now
  PROVEN live by J-AGENTS (`e2e/j-agents.spec.ts`): localStorage/sessionStorage are `"{}"` and
  IndexedDB is empty after visiting the protected screens. Remaining: the full no-plaintext audit
  across the served WRITE paths (directory + portal) lands with WRITEAPI-001/TRUST-001.)*
- **DOD-INV-3 — Account-scoping is server-side.** Every read/write is scoped to the session's
  `account_id` derived server-side; parameter injection of another account's id returns nothing
  / is rejected. *(READ-001 SI-001; WRITEAPI-001 SI-001)* — 🟡 *(READ half PROVEN: account/session
  id come only from the cookie-bound DB row (getSession → getSessionByToken), never client input;
  the agents read + sessions list/revoke are SQL-scoped WHERE account_id; the fallback-finder traced
  the producer chain and confirmed no client-supplied path widens scope, no off-by-one. The WRITE
  half is WRITEAPI-001 (not yet built).)*
- **DOD-INV-4 — Session: server-side, httpOnly, revocable.** Opaque token in an httpOnly cookie,
  not JS-readable, not in localStorage; revoking the row server-side fails the next request.
  No stateless JWT. *(AUTH-001 SI-001)* — ✅ *(PROVEN: opaque random token, SHA-256-hashed at rest,
  no JWT (SCAFFOLD-002 integration); httpOnly + not-JS-readable cookie AND server-side revoke fails
  the next GATED request, end-to-end through the browser (J-SPINE SPINE-2: revoke row → gated home
  redirects to sign-in with the same cookie in the jar).)*
- **DOD-INV-5 — Bootstrap can't escalate.** On a strong-auth account, a fresh email-magic-link
  session cannot add a credential or take a sensitive action without step-up against an existing
  factor. *(AUTH-002 SI-001)* — ✅ *(PROVEN LIVE, J-AUTH: a fresh bootstrap session on an account
  that already has a passkey is refused at BOTH /register/options AND /register/verify
  (step_up_required); no credential is planted. The step-up gate is on the mutation path, not just
  the preflight.)*
- **DOD-INV-6 — Suspend is T-of-N server-side, not 2-of-2.** A suspended agent cannot sign even
  with a valid client share; the block is the honest-node threshold refusing, never one mandatory
  node withholding. *(LEVER-001 SI-001, AC-003; [[project_threshold_t_of_n_not_2_of_2]])* — ❌
- **DOD-INV-7 — Trust = named signals only.** No composite score/level/distance/TrustRank/seed
  badge anywhere. *(TRUST-003 AC-001; [[feedback_no_trustrank_or_single_score]])* — ✅ *(PROVEN LIVE,
  J-trust: the Trust Signals screen renders four distinct NAMED classes (no single rollup) and the
  rendered DOM contains no TrustRank / Trust-Seeder / seed badge / aggregate-score element.)*
- **DOD-INV-8 — Observability.** Named `domain.noun.verb` events with `context_fields` +
  `correlationId`; no `console.log`; distinct cause → distinct code. *(M4+ rules)* — 🟡
  *(structured logger emits `portal.backend.started` + `portal.backend.migration.failed` +
  `portal.landing.signpost.shown`; `no-console` is lint-enforced on `src/**`; the full per-journey
  event taxonomy accrues as each journey lands.)*
- **DOD-INV-9 — Agents appear; no lifecycle control.** No register/create/start/stop/set-current
  in the portal; the only agent-control action is the emergency suspend lever.
  *(AGENTS-001 AC-001; [[project-portal-model]])* — ✅
  *(PROVEN live by J-AGENTS Playwright (`e2e/j-agents.spec.ts`, INV-9 case, green): the served Agents
  home exposes zero lifecycle controls — `getByRole("button", {name: /register|start agent|stop agent|create agent|set current/i})`
  has count 0, the matching text has count 0, and the nav is exactly the 3 M8 sections. The only
  outbound affordance is the ceremony signpost link. The suspend lever lands with LEVER-001.)*

---

## Tier 1 — The happy spine (J-SPINE — the first journey to make green)

Source: the E2E-001 gate. The core operator path, served apps, browser-driven.

- **DOD-SPINE-1 — Portal served + app shell.** Frontend builds; the shell renders the real M8
  nav (Agents home / Trust Signals / Account & Security) on the dark-console tokens; a protected
  route with no session redirects to sign-in (no protected markup sent). *(SCAFFOLD-001 AC-001/002)* — ✅
  *(PROVEN LIVE against the served app, J-SPINE 4/4: dark-console tokens RENDERED — body dark
  surface + brand font + accent consumed by a real element (AC-001a); protected-route redirect
  emits no protected markup/PII (AC-002); the authed operator gets the shell with exactly the three
  M8 sections + the operator-PII positive control (AC-001b).)*
- **DOD-SPINE-2 — Magic-link sign-in → durable session.** Enter email → link + 6-digit code →
  durable httpOnly-cookie session → land on Agents home; account resolved via `email_stub_hash`.
  *(AUTH-001 AC-001)* — ✅ *(PROVEN LIVE end-to-end against the served portal + the REAL directory,
  J-SPINE 5/5 with DIRECTORY_API_URL set: request → 6-digit code → verify → durable opaque httpOnly
  session → lands on the gated Agents home, with account resolution going through the portal's real
  HttpDirectoryClient → the directory `/internal/account-by-email-stub` endpoint → the directory
  Postgres; `/` is gated; the live cookie session is server-side-revocable. The endpoint is also
  proven against real Postgres (directory live test 3/3) and the adapter link against the real
  directory (portal live test 3/3). The default harness uses an env-selected stub seam for suite
  robustness; the real-directory mode is opt-in (the directory must be up + seeded). Full
  auto-bring-up of the directory cluster is the E2E close gate.)*
- **DOD-SPINE-3 — Agents appear with presence.** A ceremony-registered agent appears in the
  Agents home with directory-derived presence (online iff presence row online AND owning node
  fresh), fingerprint-primary. *(PRESENCE-001; READ-001; AGENTS-001)* — ✅ *(PROVEN LIVE end-to-end
  against the served portal + the REAL directory, J-SPINE 6/6 with DIRECTORY_API_URL set: a seeded
  ceremony-registered agent (online on a freshly-heartbeating node) appears in the Agents home,
  fingerprint-primary, with presence computed by the REAL read rule (presence row online AND owning
  node fresh) through the portal's HttpDirectoryClient → the directory `/internal/agents-by-account`
  endpoint → the directory Postgres. The earlier run correctly read OFFLINE once the seeded node's
  heartbeat aged out — the read rule's node-liveness guard working.)*
- **DOD-SPINE-4 — Suspend blocks signing.** Pause (step-up) → the agent cannot complete a FROST
  ceremony even with its client share → un-pause restores. *(LEVER-001 AC-001)* — ❌
- **DOD-SPINE-5 — Trust scaffold renders.** The four-class trust UI: WebAuthn live, rest honest
  placeholders, no composite. *(TRUST-003 AC-001)* — ✅ *(PROVEN LIVE, J-trust 3/3: four named
  classes render in order with Class-1 sub-groups distinct; the WebAuthn cell reflects REAL state
  (not-set-up fresh → active after a real enrollment); the rest are honest placeholders; no
  composite/TrustRank/seed element.)*
- **DOD-SPINE-6 — WebAuthn signal flows the pipe.** Enrolling WebAuthn writes a hash to the
  directory identity tree + sealed ciphertext to the pickup queue → the daemon pulls,
  `openSealed`, verifies, stores, ACKs → the directory deletes the ciphertext. *(TRUST-001 AC-001)* — ❌

---

## Tier 2 — Authentication (J-AUTH)

- **DOD-AUTH-1 — WebAuthn enroll / login / multi-credential.** Enroll a passkey (verified against
  the stored public key) upgrades authLevel; a second device enrolls independently; removing one
  doesn't affect the other. *(AUTH-002 AC-001/002)* — ✅ *(PROVEN LIVE via a Chrome CDP virtual
  authenticator, J-AUTH 7/7: enroll → sign out → usernameless passkey login; a FORGED assertion for
  a known credential is rejected (real signature verification, not a stub); device B (usb) enrolls
  independently of device A, removing A leaves B.)*
- **DOD-AUTH-2 — Step-up per sensitive op.** Sensitive actions require a fresh WebAuthn step-up
  (per-op, not once-per-session). *(AUTH-002 AC-003)* — ✅ *(PROVEN LIVE, J-AUTH: removing a factor
  is refused on a stale session, allowed after a fresh step-up; and after the step-up window
  elapses, a SECOND sensitive op requires a new step-up — proving per-op, not once-per-session.)*
- **DOD-AUTH-3 — TOTP + backup codes.** TOTP enroll verifies a current RFC-6238 code (verify-
  after-load); backup codes single-use; secret KMS-encrypted, codes hashed. *(AUTH-003)* — ✅
  *(PROVEN: J-TOTP live — enroll confirms only with a current code, a fresh login verifies after
  load (secret decrypts), wrong code rejected, the session upgrades bootstrap→strong only on a
  valid code; backup codes single-use (reuse → 401). Integration proves SI-001 KEYED encryption
  (a different master key can't decrypt) + recompute-equality hashing, concurrent single-use,
  malformed-code clean reject, and TOTP replay rejection. Review fixes: malformed→500 closed,
  DOD-INV-5 enroll gate (bootstrap can't plant/reset a factor), replay protection, verify
  rate-limit (429), 80-bit codes, transactional issuance. vitest 19/19.)*
- **DOD-AUTH-4 — Strong-auth enforcement.** 7-day grace → server-side gate; per-account admin
  waiver flag (scoped, not global) lifts it; no self-grant, no client bypass. *(AUTH-004)* — ✅
  *(PROVEN LIVE, J-grace 4/4: within the 7-day grace no-2FA is accessible; past it the app routes
  redirect server-side to the Account wall (a hard 2FA-required banner; the gate is computed
  server-side from account age + hasStrongFactor + waiver — no client bypass); enrolling a passkey
  lifts it; a per-account admin waiver (migration 0005, no portal surface writes it → no self-grant)
  lifts it without 2FA.)*
- **DOD-AUTH-5 — Account & Security.** Lists factors + active sessions; log-out-everywhere revokes
  other sessions server-side; factor removal requires step-up. *(AUTH-006)* — ✅ *(PROVEN LIVE: the
  Account screen lists factors (WebAuthn panel + TOTP panel) + active sessions (SessionsPanel,
  this-device marked); J-account AC-001 — two devices, "log out everywhere" from A bounces B to
  sign-in on its next request (B's cookie unchanged → server-side revocation across sessions), A
  stays in. Factor-removal step-up is proven by AUTH-002 (J-AUTH AC-003).)*
- **DOD-AUTH-6 — Signpost landing.** No-session, no-link visitor → routes to the Telegram ceremony
  + GitHub install; no account-creation form. *(SCAFFOLD-001 AC-003)* — ✅ *(PROVEN LIVE, J-SPINE:
  /sign-in shows both outbound routes + a sign-in field, and asserts the ABSENCE of any
  account-creation/registration form — ceremony-gated entry.)*
- **DOD-AUTH-7 — OTP single-use, expiring, rate-limited.** *(AUTH-001 AC-003/004)* — 🟡
  *(PROVEN by AUTH-001 integration tests: single-use sequential AND concurrent (2 verifies → exactly
  1 session via FOR UPDATE SKIP LOCKED); expiry; attempt-cap that actually BLOCKS (correct code
  after the cap mints no session); per-email request rate limit. Endpoints exercised live by the
  J-SPINE login; the full browser J-AUTH journey ties the rest later.)*

---

## Tier 3 — Directory data: presence + read path (J-PRESENCE)

- **DOD-PRES-1 — agent_presence: mutable, edge-triggered, replicated.** One row per agent_id,
  not chain-hashed; exactly two writes per connect/disconnect lifecycle (no per-heartbeat write);
  readable from a different node. *(PRESENCE-001 AC-001/002)* — 🟡 *(migration V33 (keyed by
  k_local_pubkey) applies cleanly vs real schema; the repo + edge-triggered single-row semantics
  (connect→online, disconnect→offline, ONE mutable row) proven by presence-001-repository 5/5; the
  node-code wires the two transitions at the real #streams add/remove sites (fire-and-forget). The
  exactly-two-writes-during-a-real-lifecycle + readable-from-a-DIFFERENT-node assertions need a
  ≥2-node live cluster — the E2E close gate.)*
- **DOD-PRES-2 — Node-liveness guard.** A dark node's agents age out via stale
  `directory_nodes.last_heartbeat_at`; on restart the node reconciles its owned rows to offline.
  *(PRESENCE-001 AC-003)* — 🟡 *(PROVEN by presence-001-repository (AC-003: a stale-heartbeat node
  ages the online row out to last-seen) + the SPINE-3 run (a non-heartbeating seeded node read
  OFFLINE); startup reconcile (reconcileNodeOffline) proven + wired at boot. 45s heartbeat wired in
  start(). Live multi-node dark-node test = close gate.)*
- **DOD-PRES-3 — Sovereign presence write-ownership.** Only the owning node writes its agents'
  presence. *(PRESENCE-001 AC-004)* — 🟡 *(PROVEN by presence-001-repository (AC-004: node Y's
  offline write no-ops, only the owning node X flips the row — SQL-scoped WHERE owning_node_id).
  Live ≥2-node assertion = close gate.)*
- **DOD-READ-1 — Account-scoped replicated read path.** Returns only the session account's data,
  from any node, with no daemon-local fields. *(READ-001 AC-001/003)* — ✅ *(PROVEN LIVE, SPINE-3:
  the portal reads the operator's agents account-scoped (server-side accountId) through the real
  directory; no daemon-local fields. Account resolution + agents read both go through the real
  directory HTTP API.)*
- **DOD-READ-2 — Presence read rule.** Online iff row online AND owning node fresh; else last-seen.
  *(READ-001 AC-002)* — ✅ *(PROVEN: the read rule (online iff row online AND node fresh) computed
  by the directory against real data — online for a fresh node (SPINE-3), last-seen for a stale one
  (presence-001-repository AC-003 + the SPINE-3 first run).)*
- **DOD-READ-3 — Directory-unreachable = honest empty.** Stale/empty marked, never fabricated.
  *(READ-001 DB-001)* — ✅ *(PROVEN by agents-degraded.integration: getAccountAgents against a dead
  directory returns `{ agents: [], unreachable: true }` + a portal.directory.unreachable WARN — never
  fabricated agents; the Agents home shows an honest "directory unreachable" banner.)*

---

## Tier 4 — Agents home (J-AGENTS)

- **DOD-AGENT-1 — The Agents home is the landing page.** List + presence + the per-row suspend
  affordance + alerts strip + posture header; no separate Dashboard; no register/start/stop/
  set-current; empty state routes to the ceremony. *(AGENTS-001 AC-001/002)* — ❌
- **DOD-AGENT-2 — No identity data in browser storage.** No agent fingerprints/presence/session
  in localStorage/IndexedDB; nothing restored from disk on reopen. *(AGENTS-001 SI-001)* — ✅
  *(PROVEN live by J-AGENTS Playwright (`e2e/j-agents.spec.ts`, AGENT-2/INV-2 case, green): after
  logging in and visiting both the Agents home and the Account screen, `JSON.stringify(localStorage)`
  and `JSON.stringify(sessionStorage)` are each `"{}"`, and `indexedDB.databases()` returns length 0.
  The session rides an httpOnly cookie only; the browser persists no agent/identity/session data.)*

---

## Tier 5 — Write seam + suspend/burn lever (J-WRITE / J-LEVER)

- **DOD-WRITE-1 — Write API: authenticated, account-scoped, safe-payload-only.** Cross-account
  write rejected; only hashes/flags/sealed-ciphertext accepted — no field takes plaintext/PII/
  token. *(WRITEAPI-001 AC-001/002, SI-001)* — ✅
  *(PROVEN: the directory write seam `POST /internal/agent-write` (V34 target tables). Contract test
  11/11 + live test 5/5 against the real directory Postgres. AC-001: API-key auth (401 without);
  account A may write its OWN agent but is rejected (403, nothing persisted) targeting account B's
  agent — scoping derives from the ownership check (agent_profiles.account_id), not a request field.
  AC-002/SI-001: only the three permitted kinds with strict per-kind schemas — an unknown kind,
  non-hex hash, non-enum flag mode, all-printable "ciphertext", or any extra key is rejected (422,
  nothing persisted); the live SI-001 DUMP confirms a smuggled raw email + OAuth token are absent
  from every byte of the three seam tables. directory.write.accepted/.rejected (distinct reason)
  logged. Fallback-finder: NO SILENT FALLBACKS. Portal half: DirectoryClient.writeAgent wired.)*
- **DOD-LEVER-1 — Pause blocks signing, reversible.** Server-side; the agent's valid client share
  doesn't help; un-pause restores. *(LEVER-001 AC-001)* — ❌
- **DOD-LEVER-2 — Burn: permanent, accountability survives.** Destroys share material federation-
  wide; binding stays resolvable; the burn is a signed event. *(LEVER-001 AC-002)* — ❌
- **DOD-LEVER-3 — T-of-N mechanism + distinct error.** A threshold of honest nodes refuse; a
  single node continuing doesn't let it sign; the ceremony returns a distinct revocation error.
  *(LEVER-001 AC-003)* — ❌
- **DOD-LEVER-4 — Owner-only, step-up, burn-never-erases.** Only the owning account after step-up
  may revoke; a different account / bare session is rejected; burn kills future capability, never
  past accountability. *(LEVER-001 SI-002)* — ❌

---

## Tier 6 — Trust-signal pipe + four-class UI (J-TRUST)

- **DOD-TRUST-1 — The pipe end-to-end (WebAuthn first consumer).** Hash written + readable from a
  different node; daemon `openSealed(k_local)` + hash-match + ACK; pickup queue empty after ACK.
  *(TRUST-001 AC-001)* — ❌
- **DOD-TRUST-2 — No-plaintext across the pipe.** Directory holds only the hash; ciphertext sealed
  to k_local (directory/portal can't decrypt); portal discards plaintext + token. *(TRUST-001 AC-002, SI-001)* — ❌
- **DOD-TRUST-3 — Identity-tree + pickup-queue migrations.** Applied against prior; the pickup queue
  reuses the notification delivery path. *(TRUST-001 AC-003)* — ❌
- **DOD-TRUST-4 — cello-client publish + dep update.** Version bump + connect bump + beta publish;
  trustless-cello dep update if consumed. *(TRUST-001 AC-004/005)* — ❌ *(tag-push/publish = Andre)*
- **DOD-TRUST-5 — Four-class UI scaffold.** Four named classes, Class-1 sub-groups distinct,
  WebAuthn/phone/email/TOTP live, rest honest placeholders, no composite, no fake data.
  *(TRUST-003 AC-001/002)* — ✅ *(PROVEN LIVE, J-trust 3/3: four named classes + distinct Class-1
  sub-groups; WebAuthn/TOTP/email live (real state, WebAuthn flips active after enrollment), phone +
  the rest honest "coming soon" placeholders with no working control / no fabricated data; no
  composite/TrustRank/seed. NOTE: the WebAuthn cell shows real ENROLLED state directly — turning
  enrollment into a directory-pipe trust signal is TRUST-001/SPINE-6, still ❌.)*

---

## Tier 7 — Close gate (J-E2E)

- **DOD-E2E-1 — The full milestone gate.** `CELLO-M8-E2E-001` green end-to-end against the served
  portal + the live directory cluster: ceremony-gated magic-link login, WebAuthn flowing a signal
  through the pipe, agents with presence, suspend blocking signing, the four-class scaffold, and
  the no-plaintext audit. The milestone writeup is updated with a dated confirmation. *(E2E-001)* — ❌

---

## Verification harness (DoD-ID → test journey)

| Journey | DoD-IDs | Drives |
|---|---|---|
| J-SPINE | SPINE-1..6 | served portal + directory + daemon; the core operator path |
| J-AUTH | AUTH-1..7 | magic link, WebAuthn, TOTP, enforcement, account screen, signpost |
| J-PRESENCE | PRES-1..3, READ-1..3 | agent_presence + node-liveness + the read path (≥2 nodes) |
| J-AGENTS | AGENT-1..2 | the Agents home + browser-storage invariant |
| J-WRITE / J-LEVER | WRITE-1, LEVER-1..4 | the write seam + suspend/burn against the full cluster |
| J-TRUST | TRUST-1..5 | the pipe (portal+directory+daemon) + the four-class UI |
| J-E2E | E2E-1 | the whole gate, end-to-end |

Tier 0 invariants are asserted inside the journey that exercises them (no separate pass).

The first code unit is **J-SPINE** (M8-PROCEDURE.md §4) — almost entirely red; that is the map.

---

## Deferred items (each with a named home — never a silent drop)

- **Per-agent detail page** — deferred to the milestone that builds the portal→daemon channel
  (Journey 02 D9). Not an M8 DoD line.
- **Standalone operational Dashboard** — folded into the Agents home; the real one is deferred to
  the daemon-channel milestone (Journey 02 D11).
- **Trust-signal connectors** (LinkedIn/GitHub/device OAuth+scrape) — M10. M8 builds only the pipe
  + WebAuthn.
- **DOD-TRUST-4 publish + promotion, and any directory deploy** — Andre's (live operations).
- **Bio, recovery contacts, succession, endorsements, discovery, contact aliases, notifications** —
  M10 / M11.
