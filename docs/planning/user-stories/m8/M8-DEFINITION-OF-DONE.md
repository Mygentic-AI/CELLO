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
  unmatched email gets the signpost, never an account. *(SCAFFOLD-001 AC-003, AUTH-001 AC-002)* — ✅
  *(PROVEN LIVE by J-INV1 (`e2e/j-inv1.spec.ts`, 2/2, served portal): an UNMATCHED email gets
  {sent:true} (identical to a matched one — no 200-vs-404/error oracle), mints NO code/token, and can
  never establish a session; a directory-known (ceremony-minted) email DOES resolve to a usable
  code → session. No portal account-creation path; resolution is SHA-256(email) vs the directory's
  email_stub_hash. Backed by the AUTH-001 integration tests (request identical for known/unknown, the
  429 fires identically — no rate-limit oracle) + READ-001's real-directory path. NOTE (defense-in-
  depth, NOT a done-condition clause): a micro-timing residual remains — the matched path does extra
  DB writes (mint), so response time differs slightly. The EXPLOITABLE oracle (response/status/rate-
  limit) is closed; the timing delta is dominated by network jitter and is not closed with fake
  equalizing "dummy work" (which wouldn't truly constant-time DB I/O). Tracked as a hardening item.)*
- **DOD-INV-2 — No plaintext/PII/token/content server-side.** Directory holds only hashes,
  flags/tombstones, and sealed ciphertext (deleted on ACK). Portal DB holds only: KMS-encrypted
  email, KMS-encrypted TOTP secret, hashed backup codes, sessions, WebAuthn public keys — no
  plaintext signal, no OAuth token, no message content. Browser holds NO agent/identity data
  (in-memory only). *(gate SI-001; SCAFFOLD-002 SI-001; AGENTS-001 SI-001; TRUST-001 SI-001)* — ✅
  *(PROVEN across all three surfaces. PORTAL DB: ciphertext-at-rest for email + TOTP secret, and
  SHA-256 token-hash sessions (SCAFFOLD-002 vitest vs real Postgres); the trust-signal handoff keeps
  no plaintext (sealed before it leaves; the log carries the hash only). DIRECTORY: the write seam
  accepts only hashes/flags/sealed-ciphertext — a smuggled raw email + OAuth token are rejected AND
  absent from every byte of the seam tables (WRITEAPI-001 live SI-001 dump); the pickup ciphertext is
  ack-DELETED so none lingers, and the plaintext credential id is absent from the directory tables
  (J-TRUST live dump) — only the daemon's encrypted DB holds the recovered plaintext (sealed to
  k_local, SI-001). BROWSER: localStorage/sessionStorage `"{}"` + empty IndexedDB (J-AGENTS).)*
- **DOD-INV-3 — Account-scoping is server-side.** Every read/write is scoped to the session's
  `account_id` derived server-side; parameter injection of another account's id returns nothing
  / is rejected. *(READ-001 SI-001; WRITEAPI-001 SI-001)* — ✅ *(READ half: account/session id come
  only from the cookie-bound DB row (getSession → getSessionByToken), never client input; the agents
  read + sessions list/revoke are SQL-scoped WHERE account_id; the fallback-finder traced the producer
  chain and confirmed no client-supplied path widens scope, no off-by-one. WRITE half PROVEN by
  WRITEAPI-001 (live): the seam derives scoping from the ownership check (agent_profiles.account_id),
  NOT a request field — account A writing account B's agent is rejected (403 not_owner, nothing
  persisted), an unauthenticated write is 401, and the portal suspend route only ever asserts the
  session's own account_id. Cross-account injection returns nothing / is rejected on both halves.)*
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
  node withholding. *(LEVER-001 SI-001, AC-003; [[project_threshold_t_of_n_not_2_of_2]])* — 🟡
  *(CORE PROVEN by J-SUSPEND: a suspended agent cannot sign even with a valid client share, and the
  block is SERVER-SIDE (the directory refuses; nothing the client holds helps — SI-001). The
  MECHANISM is T-of-N-correct: each node independently consults its OWN replicated `agent_suspensions`
  copy and refuses its FROST share at the share gate (`#handleFrostStream` commit+sign frames) +
  the session-init gate — no node is a mandatory co-signer. The explicit "a single node continuing
  to offer its share does not let it sign" distinction (the anti-2-of-2 proof) needs a ≥3-node
  cluster and is DOD-LEVER-3 / AC-003, pending the multi-node harness. Current daemon path is the
  2-of-2 stopgap, so J-SUSPEND cannot yet distinguish threshold-refusal from single-node refusal.)*
- **DOD-INV-7 — Trust = named signals only.** No composite score/level/distance/TrustRank/seed
  badge anywhere. *(TRUST-003 AC-001; [[feedback_no_trustrank_or_single_score]])* — ✅ *(PROVEN LIVE,
  J-trust: the Trust Signals screen renders four distinct NAMED classes (no single rollup) and the
  rendered DOM contains no TrustRank / Trust-Seeder / seed badge / aggregate-score element.)*
- **DOD-INV-8 — Observability.** Named `domain.noun.verb` events with `context_fields` +
  `correlationId`; no `console.log`; distinct cause → distinct code. *(M4+ rules)* — ✅
  *(All journeys landed; audited across M8. NO console.* in implementation — `no-console` is
  lint-enforced (a real passing gate; every M8 file passed lint) and a grep confirms the only console
  calls are doc-comments + one local dev-bin runner. Events follow `domain.noun.verb` throughout
  (portal.agent.suspend.requested/rejected/failed, portal.trust_signal.handed_off, directory.write.
  accepted/rejected/failed, frost.ceremony.refused.revoked, daemon.trust_signal.received/hash_mismatch,
  share.destroyed, key.burned, …). The async/multi-process flows thread `correlationId` (the suspend
  route, the write seam, the trust pipe — the daemon pickup uses the pickup id as the correlation
  handle). Error paths use DISTINCT codes (not_owner / invalid_payload / invalid_hash /
  invalid_ciphertext / burned_immutable / agent_suspended / hash_mismatch / open_failed) — never a
  generic catch-all. Per-event context_fields were asserted by each story's own observability ACs as it
  landed; this is the cross-cutting confirmation.)*
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
  fresh), fingerprint-primary. *(PRESENCE-001; READ-001; AGENTS-001)* — ✅ *(RESTORED 2026-06-28: the
  served-portal journey is now a REPRODUCIBLE STANDING gate — the directory auto-bring-up the done-auditor
  flagged as unbuilt is now built.)*
  *(`npm run test:e2e:real-dir -- j-spine` (cello-portal) brings up a REAL local directory — Docker
  Postgres + Flyway (V37) + the standalone internal-API harness `createInternalApiServer`
  (account-by-email-stub / agents-by-account; the genuine directory code, no libp2p/KMS/stub) — seeds the
  operator, and drives the SERVED portal through a browser: SPINE-3 (`e2e/j-spine.spec.ts:147`) goes GREEN
  end-to-end (portal → real directory internal API → directory Postgres → a ceremony-registered agent
  appears online with directory-derived presence; the logs show real account.lookup.hit + agents.lookup.ok
  count:1). SPINE-2 in the same run exercises real account resolution. This is deterministic and repeatable
  (clean schema each run), not a one-time manual demo. Also standing-proven at the component boundary
  (real Postgres): `read-001-agents-by-account` + `presence-001-repository`. REMAINING (the close gate,
  unchanged): the cross-node "from ANY node" / 3-region guarantee needs the live ≥2-node AWS cluster
  (DOD-E2E-1) — the single-directory served journey is now standing; multi-region is the final gate.)*
- **DOD-SPINE-4 — Suspend blocks signing.** Pause (step-up) → the agent cannot complete a FROST
  ceremony even with its client share → un-pause restores. *(LEVER-001 AC-001)* — ✅
  *(PROVEN LIVE by J-SUSPEND (`packages/e2e-tests/src/spine/j-suspend.spine.test.ts`, 1/1, real
  binaries cross-process): agent A registers (real DKG → a valid FROST client share) and is online;
  the reversible pause flag is set in the directory's replicated `agent_suspensions` (keyed by A's
  directory agent_id, exactly as the write seam writes it); A's OWN `cello_initiate_session` then
  fails with `agent_suspended` — the directory refuses server-side even though A holds a valid client
  share — and after clearing the flag the retry no longer returns `agent_suspended` (reversible).
  Positive control before the pause pins the refusal to the flag. Step-up gating is the portal-lever
  half, DOD-LEVER-4.)*
- **DOD-SPINE-5 — Trust scaffold renders.** The four-class trust UI: WebAuthn live, rest honest
  placeholders, no composite. *(TRUST-003 AC-001)* — ✅ *(PROVEN LIVE, J-trust 3/3: four named
  classes render in order with Class-1 sub-groups distinct; the WebAuthn cell reflects REAL state
  (not-set-up fresh → active after a real enrollment); the rest are honest placeholders; no
  composite/TrustRank/seed element.)*
- **DOD-SPINE-6 — WebAuthn signal flows the pipe.** Enrolling WebAuthn writes a hash to the
  directory identity tree + sealed ciphertext to the pickup queue → the daemon pulls,
  `openSealed`, verifies, stores, ACKs → the directory deletes the ciphertext. *(TRUST-001 AC-001)* — ✅
  *(PROVEN LIVE by J-TRUST (`packages/e2e-tests/src/spine/j-trust.spine.test.ts`, 1/1, real binaries
  cross-process): a sealed signal seeded exactly as the portal writes it (hash → identity_tree_entries,
  ciphertext → pickup_queue) is DELIVERED to the agent's daemon on reconnect (the directory drains the
  pickup queue → `trust_signal_pickup` frame), the daemon `openContentSeal`s it with k_local (only A's
  daemon can — SI-001), recomputes the hash and MATCHES the directory anchor, STORES the recovered
  plaintext in its encrypted `trust_signals` table, and ACKs (`trust_signal_ack`) — after which the
  pickup queue is EMPTY for that agent (directory ack-deleted) and the identity-tree hash remains. The
  store assertion reads the daemon's OWN encrypted SQLCipher DB. The portal SOURCE (enroll → seal →
  write) is unit-proven separately (`test/trust-handoff.test.ts`). The pipe MECHANISM is proven; the
  PRODUCTION multi-node delivery caveat (the ciphertext is node-pinned — pickup_queue not replicated)
  is the DOD-TRUST-1 🟡 / code-reviewer-H2 gap, not a mechanism failure.)*

---

## Tier 2 — Authentication (J-AUTH)

- **DOD-AUTH-1 — WebAuthn enroll / login / multi-credential.** Enroll a passkey (verified against
  the stored public key) upgrades authLevel; a second device enrolls independently; removing one
  doesn't affect the other. *(AUTH-002 AC-001/002)* — ✅ *(PROVEN LIVE via a Chrome CDP virtual
  authenticator, J-AUTH 7/7: enroll → sign out → usernameless passkey login; a FORGED assertion for
  a known credential is rejected (real signature verification, not a stub); device B (usb) enrolls
  independently of device A, removing A leaves B.)*
- **DOD-AUTH-2 — Step-up per sensitive op.** Sensitive actions require a fresh step-up against a
  STRONG FACTOR — a passkey OR a confirmed TOTP code (per-op, not once-per-session). *(AUTH-002 AC-003/AC-004)* — ✅
  *(RESTORED 2026-06-28 after the Violation-A spec inversion was fixed. The step-up GATE was always
  factor-agnostic (isStepUpFresh keys on last_step_up_at, which both /webauthn/stepup/verify AND
  /totp/verify stamp); the bug was UI-only — the only step-up affordance ran the WebAuthn ceremony, so a
  TOTP-only operator (journey-01 D6's PRIMARY recoverable factor) was dead-ended at "verify a passkey".
  FIXED: a factor-aware StepUpDialog fetches the operator's LIVE factors and offers the one(s) they hold
  — passkey ceremony AND/OR TOTP code — with factor-agnostic copy. PROVEN LIVE (J-AUTH 9/9): per-op
  step-up (AC-003); +AC-004 F1 catch-22 BOTH directions — a passkey operator adds the TOTP floor via a
  passkey step-up, and a TOTP-only operator adds their first passkey via a TOTP code (stub-resistant:
  stepup-passkey count 0 for the TOTP-only holder, stepup-totp-code count 0 for the passkey-only holder
  — both factors pinned in both directions). The step-up is server-enforced on retry (the dialog cannot
  bypass it). Reviewed clean — code-reviewer APPROVED, fallback-finder NO-FALLBACKS, test-attacker gap
  (hasTotp asserted present-only) FIXED then SOUND.)*
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
  waiver flag (scoped, not global) lifts it; no self-grant, no client bypass. The required factor is
  the RECOVERABLE FLOOR (TOTP) — a passkey does NOT lift the cliff (journey-01 D6). *(AUTH-004)* — ✅
  *(CORRECTED + RE-PROVEN 2026-06-28 after the Violation-B spec inversion: the cliff previously lifted
  on hasStrongFactor (passkey OR TOTP), letting a passkey-only account clear it — the device-loss
  lockout D6 exists to prevent. Now keys on hasRecoverableFloor (= confirmed TOTP). PROVEN LIVE, J-grace
  5/5: within the 7-day grace no-2FA is accessible; past it the app routes redirect server-side to the
  Account wall (gate computed server-side from account age + hasRecoverableFloor + waiver — no client
  bypass); **a passkey does NOT lift the wall** (AC-003 — stub-resistant: the account holds a strong
  SESSION factor yet stays walled); **TOTP (the recoverable floor) lifts it**; a per-account admin
  waiver (migration 0005, no portal surface writes it → no self-grant) lifts it without TOTP. Backed by
  the strong-auth-wall integration test (7/7 vs real Postgres: passkey-only/two-passkeys past grace stay
  walled, TOTP lifts, waiver lifts, within-grace allows). Reviewed clean — code-reviewer APPROVED,
  fallback-finder NO-FALLBACKS, test-attacker TESTS-HAVE-TEETH.)*
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
- **DOD-AUTH-7 — OTP single-use, expiring, rate-limited.** *(AUTH-001 AC-003/004)* — ✅
  *(PROVEN LIVE by J-AUTH7 (`e2e/j-auth7.spec.ts`, 3/3, served portal): SINGLE-USE — a verified code
  cannot be replayed (consumed → `invalid`, no second session); EXPIRING — a code aged past its TTL
  is rejected (`invalid`); RATE-LIMITED — the request endpoint returns 429 (`rate_limited`) within the
  window. Backed by the AUTH-001 integration tests (concurrent single-use via FOR UPDATE SKIP LOCKED →
  exactly 1 session; attempt-cap that BLOCKS even a correct code after the cap).)*

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
  from any node, with no daemon-local fields. *(READ-001 AC-001/003)* — ✅ *(Note corrected on the
  2026-06-28 done-auditor check: the standing LIVE proof is the directory component test
  `read-001-agents-by-account` (real Postgres) — the account-scoped agents read returns ONLY the asserted
  account's agents (cross-account injection returns nothing) with no daemon-local fields, exactly the
  done-condition. The SERVED end-to-end is now ALSO standing (DOD-SPINE-3 ✅ via `test:e2e:real-dir` — the
  served portal reads this account's agents through the REAL directory internal API). The "from ANY node"
  cross-node guarantee remains the E2E close gate. Read LOGIC + account-scoping + served integration are
  standing-proven; only multi-region is gated.)*
- **DOD-READ-2 — Presence read rule.** Online iff row online AND owning node fresh; else last-seen.
  *(READ-001 AC-002)* — ✅ *(Note corrected on the 2026-06-28 done-auditor check: the standing LIVE
  proof is `presence-001-repository` (real Postgres) — online iff the presence row is online AND the
  owning node is fresh, else last-seen; a stale-heartbeat node ages the row to last-seen (AC-003). The
  SERVED online render is now ALSO standing (DOD-SPINE-3 ✅ via `test:e2e:real-dir` — the seeded online
  agent renders online through the real directory). The read RULE is standing-live-proven; tag stays ✅ on
  that, with the served-render aspect gated.)*
- **DOD-READ-3 — Directory-unreachable = honest empty.** Stale/empty marked, never fabricated.
  *(READ-001 DB-001)* — ✅ *(PROVEN by agents-degraded.integration: getAccountAgents against a dead
  directory returns `{ agents: [], unreachable: true }` + a portal.directory.unreachable WARN — never
  fabricated agents; the Agents home shows an honest "directory unreachable" banner.)*

---

## Tier 4 — Agents home (J-AGENTS)

- **DOD-AGENT-1 — The Agents home is the landing page.** List + presence + the per-row suspend
  affordance + alerts strip + posture header; no separate Dashboard; no register/start/stop/
  set-current; empty state routes to the ceremony. *(AGENTS-001 AC-001/002)* — ✅
  *(PROVEN. List + presence: the SERVED render is via SPINE-3, now ✅ standing (`test:e2e:real-dir` — the
  served Agents home lists the account's agents with directory-derived presence through the REAL directory;
  cross-node/multi-region remains the close gate); the read logic is also standing-live
  (read-001/presence-001 component tests). Everything ELSE in AGENT-1 is standing-proven by default:
  the per-row SUSPEND affordance (J-LEVER, 3/3: exactly one
  Pause/Resume lever, no register/start/stop/set-current — INV-9 green; Pause→read-reflects-paused→
  Resume round-trips); empty state → ceremony signpost; and the thin header (J-AGENTS, 3/3): an alerts
  strip with an HONEST empty state ("no security alerts" — no event source fabricated) + an
  account-posture line showing real derivable state (strong-auth status + trust-signal coverage). The
  live operational Dashboard (event feed/metrics) is deferred to the portal→daemon channel by design.)*
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
  doesn't help; un-pause restores. *(LEVER-001 AC-001)* — ✅
  *(PROVEN LIVE by J-SUSPEND — see DOD-SPINE-4. The directory honor-check reads the LIVE replicated
  `agent_suspensions` row (not a cache — a pause is mutable + a security control) and refuses; fails
  CLOSED on a read error so a transient fault cannot let a paused agent sign. Pause→fail→clear→succeed
  on real binaries.)*
- **DOD-LEVER-2 — Burn: permanent, accountability survives.** Destroys share material federation-
  wide; binding stays resolvable; the burn is a signed event. *(LEVER-001 AC-002)* — 🟡
  *(CONTAINED PART PROVEN (the story splits burn: "the flag/honor-check + replication is the contained
  part; coordinated share destruction is the heavier part"). The seam's revocation_flag gains mode=burn:
  it sets a PERMANENT replicated flag (paused + burned in agent_suspensions ∈ cello_pub, honored by
  every sovereign node) that a clear CANNOT lift — a clear on a burned agent is rejected
  (409 burned_immutable), so capability cannot be restored by clearing a flag; burned is monotonic. The
  agent_profiles binding (agent_id ↔ key ↔ account) is UNTOUCHED — accountability survives (SI-002).
  Proven by the burn live test (2/2, cello_spine) + contract (13/13). V36. The PORTAL Burn affordance
  is also done (J-LEVER 4/4): a per-row Burn action behind a two-click "irreversible" confirm, a
  terminal "Burned" row state, step-up-gated through the same route → seam. REMAINING (the single
  heavier part): per-node K_server SHARE DESTRUCTION is now BUILT + proven. agent_key_shares (V4) is
  APPEND-ONLY (row deletion forbidden; UPDATE-for-rotation allowed), so ShareStore.destroyShares ZEROES
  encrypted_share (capability dies; the row/accountability survives) + drops the in-memory cache
  [InMemory delete prefix; EncryptedPg UPDATE→empty + key_version='burned'; Persistent awaits both].
  The frost-gate honor-check fires frostHandler.destroyShares eager-on-observe (each node zeroes its
  OWN share when it sees the replicated burn; isAgentBurned distinguishes burn from pause). PROVEN by
  the share-destroy live test (zeroes both epochs, keeps rows, idempotent, never decrypts) + burn live
  + directory-node 26/26. The FEDERATION-WIDE guarantee is now complete: besides the eager-on-observe
  trigger, a per-node RECONCILE sweep (listBurnedAgentPubkeys → frostHandler.destroyShares, on boot +
  a 60s cadence) zeroes the share of an IDLE/offline node that was never asked to sign — proven by the
  reconcile-list live assertion. ONE residual keeps this 🟡: "the burn is a SIGNED event." Today the
  burn is account-authorized + timestamped + attributable (authorized_by_account, monotonic, replicated,
  append-only-ish) — an auditable record, but NOT cryptographically Ed25519-signed. Whose key signs an
  account-authorized burn is a genuine design question (no account Ed25519 key in this flow). DECISION
  (2026-06-28, reversible default — Andre may override): DEFER the signed-event to a future account-key
  story; ACCEPT for M8 the "account-authorized + recorded, not cryptographically signed" burn. Rationale:
  the security property that matters (a burned agent can never sign — share destroyed federation-wide)
  already holds + is proven; the signed-event adds only tamper-proof ATTRIBUTION (audit integrity of WHO
  ordered the burn), which is a nicety, not a security gap. An account signing key is real new protocol
  surface (key lifecycle, where the private key lives, recovery) better done deliberately than bolted on
  to close one M8 line. So this stays 🟡 BY DECISION — the contained + share-destruction parts are done;
  the signed-event is a named M10/M11 follow-up (account-key story), not an M8 gap.)*
- **DOD-LEVER-3 — T-of-N mechanism + distinct error.** A threshold of honest nodes refuse; a
  single node continuing doesn't let it sign; the ceremony returns a distinct revocation error.
  *(LEVER-001 AC-003)* — 🟡
  *(DISTINCT-ERROR half PROVEN: the directory refuses with `session_request_error reason=agent_suspended`
  and the daemon now recognizes it (added to the known-reason set in session-assignment-parser.ts) so
  it surfaces distinctly to the MCP — NOT folded into the generic `directory_unreachable`. J-SUSPEND
  asserts the exact `agent_suspended` reason cross-process. The STRICT T-of-N half — "a single node
  continuing to offer its share does not let it sign" — needs a ≥3-node cluster (the current daemon
  path is the 2-of-2 stopgap) and the multi-node PRESENCE/cluster harness; pending. The daemon change
  is local (branch m8-lever-001); the npm publish cascade is Andre-gated.)*
- **DOD-LEVER-4 — Owner-only, step-up, burn-never-erases.** Only the owning account after step-up
  may revoke; a different account / bare session is rejected; burn kills future capability, never
  past accountability. *(LEVER-001 SI-002)* — ✅ *(RESTORED 2026-06-28: the step-up half (which inherited
  the DOD-AUTH-2 Violation-A inversion) is FIXED — revocation step-up is now factor-aware. The SuspendLever
  opens the factor-aware StepUpDialog on 403 and retries; a TOTP-only operator (journey-01 D6's primary
  factor) completes a suspend/burn via a TOTP code, never dead-ended at "verify a passkey". OWNER-ONLY +
  burn-never-erases were always proven; the step-up-for-TOTP path is now proven too.)*
  *(OWNER-ONLY + STEP-UP PROVEN (both factors): the suspend route derives accountId from the session
  (never the client), requires a fresh step-up when the account has a strong factor, and routes through
  the account-scoped seam — which REJECTS a cross-account write (`not_owner`, WRITEAPI-001 SI-001 live:
  A cannot write B's agent, nothing persisted); a bare-session write is 401. J-LEVER (6/6) proves the
  within-grace path AND the step-up-REQUIRED path for BOTH factors: a passkey operator completes the Pause
  via a passkey step-up dialog, and a TOTP-only operator completes it via a TOTP code (stub-resistant —
  stepup-passkey count 0, agent pauses only AFTER the real server-verified step-up). Reviewed clean
  (code-reviewer APPROVED, test-attacker SOUND, fallback-finder NO-FALLBACKS). BURN-NEVER-ERASES PROVEN
  (lever-002-burn.live): burn kills future
  capability (permanent flag + share zeroed across the federation) yet NEVER erases past accountability
  — the agent_profiles binding (agent_id ↔ key ↔ account) is untouched and the zeroed share rows are
  kept. (The separate "burn as a cryptographically signed event" nuance is tracked under DOD-LEVER-2.))*

---

## Tier 6 — Trust-signal pipe + four-class UI (J-TRUST)

- **DOD-TRUST-1 — The pipe end-to-end (WebAuthn first consumer).** Hash written + readable from a
  different node; daemon `openSealed(k_local)` + hash-match + ACK; pickup queue empty after ACK.
  *(TRUST-001 AC-001)* — 🟡 *(DROPPED from ✅ on the code-review drift check — H2.)*
  *(The pipe is PROVEN end-to-end SINGLE-NODE by J-TRUST: portal seal SOURCE (unit, real Ed25519) →
  write seam → identity_tree + pickup_queue → directory drain on reconnect → daemon openSealed +
  hash-match + store + ACK → directory ack-deletes (queue empty). BLOCKER for ✅ (code-reviewer H2,
  conf 80): the CIPHERTEXT half is node-pinned — pickup_queue is deliberately NOT replicated (id-
  collision risk), the portal writes the ciphertext to ONE node, and the daemon drains only from the
  node its per-agent stream is on. In the live 3-region federation (daemon connects to / fails over to
  ANY node) the ciphertext may be on a different node than the daemon → undelivered. AC-001's "readable
  from a DIFFERENT node" therefore does NOT hold for the ciphertext (only the hash anchor, which IS in
  cello_pub, replicates). FIX needed: replicate pickup_queue (its ciphertext is sealed to k_local, so
  replicating it leaks nothing). The setup-replication comment proposes `ALTER SEQUENCE pickup_queue_id_seq
  INCREMENT BY 3 RESTART WITH {offset}` staggering — but the 2026-06-28 multi-node investigation found
  per-node staggering is DOCUMENTED yet NEVER IMPLEMENTED (no code applies an offset; Flyway can't, it
  runs identical SQL on every node). RECOMMENDED H2 DIRECTION: change `pickup_queue.id` to a UUID
  (replicates with zero per-node coordination, matching agent_suspensions/identity_tree_entries' natural
  keys), then add pickup_queue to cello_pub; the ack-DELETE (id+agent_id post-H1) replicates and cleans
  every node. Verifiable only on the live ≥2-node cluster (DOD-E2E-1) — a local intra-instance
  logical-replication harness was tried and rejected as too flaky (slot creation blocks on concurrent
  open txns); see the build journal. ALSO REQUIRED BY H2 (orphan-sweep gate, fallback-finder 2026-06-28):
  the orphan-pickup backstop sweep (sweepUndeliverablePickups) is safe ONLY while pickup_queue is
  node-local — it deletes anchor-less rows per-node against the replicated identity_tree. Once
  pickup_queue joins cello_pub, a node with an unconverged identity_tree replica could delete a
  deliverable ciphertext and replicate the delete. H2 MUST gate the sweep to the owning node (or add a
  convergence check) before publishing pickup_queue — the in-code comment on sweepUndeliverablePickups
  carries this as a blocking note.)*
- **DOD-TRUST-2 — No-plaintext across the pipe.** Directory holds only the hash; ciphertext sealed
  to k_local (directory/portal can't decrypt); portal discards plaintext + token. *(TRUST-001 AC-002, SI-001)* — ✅
  *(PROVEN: the signal is sealed to the agent's k_local — only the k_local SEED opens it (a wrong seed
  → null, unit-proven with real crypto), the opaque ciphertext carries no plaintext, and the portal
  keeps no plaintext (sealed before it leaves; the handoff log carries the hash only). J-TRUST confirms
  the cross-pipe dump LIVE: the directory holds only the hash (identity tree), the pickup queue is
  empty after the daemon ACK, and the plaintext credential id is absent from the directory tables —
  only the daemon's encrypted DB holds the recovered plaintext.)*
- **DOD-TRUST-3 — Identity-tree + pickup-queue migrations.** Applied against prior; the pickup queue
  reuses the notification delivery path. *(TRUST-001 AC-003)* — ✅
  *(PROVEN: identity_tree_entries + pickup_queue (V34) + pickup_queue.signal_kind (V35) apply cleanly
  against the full prior history — the spine flyway run reports v35 with zero checksum errors atop
  V1–V34. The pickup queue REUSES the notification delivery path: drainPickupForAgent →
  `#sendFrame` → ackPickup-DELETE mirrors pg-notification-queue's drainUndelivered/acknowledge and the
  same directory-node reconnect-drain loop. Drain/ACK proven by a live test; the full delivery by J-TRUST.)*
- **DOD-TRUST-4 — cello-client publish + dep update.** Version bump + connect bump + beta publish;
  trustless-cello dep update if consumed. *(TRUST-001 AC-004/005)* — ❌ *(tag-push/publish = Andre)*
- **DOD-TRUST-5 — Four-class UI scaffold.** Four named classes, Class-1 sub-groups distinct,
  WebAuthn/phone/email/TOTP live, rest honest placeholders, no composite, no fake data.
  *(TRUST-003 AC-001/002)* — ✅ *(PROVEN LIVE, J-trust 3/3: four named classes + distinct Class-1
  sub-groups; WebAuthn/TOTP/email live (real state, WebAuthn flips active after enrollment), phone +
  the rest honest "coming soon" placeholders with no working control / no fabricated data; no
  composite/TrustRank/seed. NOTE: the WebAuthn cell shows real ENROLLED state directly; turning
  enrollment into a directory-pipe trust signal is TRUST-001/SPINE-6, now ✅ (J-TRUST).)*

---

## Tier 7 — Close gate (J-E2E)

- **DOD-E2E-1 — The full milestone gate.** `CELLO-M8-E2E-001` green end-to-end against the served
  portal + the live directory cluster: ceremony-gated magic-link login, WebAuthn flowing a signal
  through the pipe, agents with presence, suspend blocking signing, the four-class scaffold, and
  the no-plaintext audit. The milestone writeup is updated with a dated confirmation. *(E2E-001)* — 🟡
  *(LOCAL CLOSE GATE GREEN (2026-06-28): the FULL M8 portal e2e suite passes against a REAL local
  directory — `npm run test:e2e:real-dir` → 42 passed / 3 skipped. The served portal drives, through a
  browser, against the genuine directory internal API (Docker Postgres + Flyway V37 + createInternalApiServer):
  ceremony-gated magic-link login resolving via the REAL directory (SPINE-2), WebAuthn enroll + the
  four-class scaffold with WebAuthn live (J-AUTH/J-trust), agents appearing with directory-derived
  presence (SPINE-3), and suspend/burn round-tripping through the REAL /internal/agent-write seam with
  the cross-account not_owner binding (J-LEVER). The 3 skipped are the j-spine fixmes SPINE-4 (suspend
  blocks signing) + SPINE-6 (trust pipe → daemon), both PROVEN in the cello_spine cross-process harness
  (J-SUSPEND, J-TRUST, real binaries). REMAINING for ✅: the AWS 3-region run + cross-node/replication
  aspects (PRES-2/3 from-any-node, TRUST-1 pickup_queue replication, strict T-of-N INV-6/LEVER-3) — the
  live-cluster close gate (Andre's deploy), plus the dated milestone writeup. The LOCAL served milestone
  claim is green and reproducible; only multi-region remains.)*
  *(UPDATE 2026-06-28 — THE PORTAL IS NOW DEPLOYED LIVE: `https://portal.cello.mygentic.ai` (ECS Fargate +
  ALB/ACM/Route53, RDS, us-east-1, image f6a43d8). Verified live: HTTPS /sign-in 200, HTTP→HTTPS redirect,
  protected-route redirect, the task self-migrates its RDS on boot (migrationVersion 0005), and a magic-link
  request resolves accounts through the REAL LIVE directory's `/internal/account-by-email-stub` over its
  public ALB (200 + accountResolved:false for an unknown email — proves the served-portal↔live-directory
  seam with a valid API key, no enumeration). Magic-link codes deliver via SES; a delivery-failure alarm is
  wired. So the "served portal against the live directory" DIMENSION of E2E-1 is now real (was the missing
  piece — the portal had never run on AWS). STILL 🟡, NOT ✅: the remaining cross-node aspects are
  unchanged — 3-region/from-ANY-node presence (PRES-2/3), pickup_queue replication (TRUST-1 H2), strict
  T-of-N refusal (INV-6/LEVER-3, unbuilt protocol). A full browser-driven E2E against the live cluster +
  the dated milestone-writeup confirmation are what remain for ✅.)*

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
