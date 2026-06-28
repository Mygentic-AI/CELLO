---
name: M8 Build Journal
type: journal
date: 2026-06-27
milestone: M8
status: open
description: >
  Append-only build journal for M8 (the operator portal). One entry per unit of work. NEVER
  edit a prior entry. This is the live-state + audit-trail follow-through doc: a fresh context
  (post-compaction or new session) reads the kickoff entry + the last few entries to resume,
  with NO dependence on any chat history. Pairs with M8-DEFINITION-OF-DONE.md (target) and
  M8-PROCEDURE.md (runbook). See M8-PROCEDURE.md §0 for read order, §1 for entry contents.
---

# M8 Build Journal (append-only)

> Newest entries at the BOTTOM. Never edit/delete a prior entry. Each entry: DoD-ID, what was
> red, what was found, commit hashes, reviewer outcome, blockers, decisions.

---

## 2026-06-27 — M8 kickoff (planning complete; self-contained resume state; no code yet)

This entry is written to be **read cold** — a new session needs only this + the M8 stories +
the journey docs to resume. No chat history required.

### What M8 is
The **CELLO operator portal** — a hosted web app where an operator magic-links in, sees their
agents appear with truthful presence, manages strong auth, views a four-class trust-signal
scaffold, and can emergency-suspend a compromised agent. M8 = "Portal Skeleton" per the
implementation roadmap. **Greenfield.** Everything in the DoD is ❌ until built + proven live.

### The core product model (do not violate — these are settled)
- **Agents APPEAR; the portal never creates/registers/starts/stops them.** Identity is minted
  in the Telegram ceremony; the portal only reflects it. The ONLY agent-control action is the
  emergency **suspend/burn lever** ("Not me"). *(See [[project-portal-model]].)*
- **Hosted portal = reads directory-derived facts only**, never local daemon state. The
  per-agent detail page and the live operational Dashboard are DEFERRED (need a future
  portal→daemon channel) — at M8 the **Agents home IS the landing page** (Dashboard folded in).
- **No message content, no plaintext PII, no token ever rests server-side.** Directory holds
  hashes/flags/sealed-ciphertext; the portal DB holds only KMS-encrypted email + TOTP secret,
  hashed backup codes, sessions, WebAuthn public keys; the browser caches in-memory only.
- **Suspend is T-of-N across sovereign nodes, NOT 2-of-2.** The 2-of-2 in current code is a
  known stopgap bug. The lever is an account-authorized replicated revocation flag every honest
  node honors. *(See [[project_threshold_t_of_n_not_2_of_2]].)*
- **Trust = named signals only, never a composite score / TrustRank.**

### Ratified scoping decisions (2026-06-26, Andre)
1. **Repo:** the portal lives in its own **private repo `cello-portal`** in the Mygentic-AI org
   — **already created: https://github.com/Mygentic-AI/cello-portal** (empty). Distinct from
   `cello-client` (public client) and `trustless-cello` (server-side + IaC).
2. **Hosting:** AWS **us-east-1** — frontend on a static/edge host, backend on ECS.
3. **Portal↔directory auth:** the existing directory `/internal/pre-authorize` **API-key**
   pattern, extended for the read + write API (no new mTLS).

### The three repos (where each story's work lands)
- **`cello-portal`** (new) — the bulk: frontend (Next.js App Router, dark-console design system,
  app shell, the 4 screens) + backend (its OWN PostgreSQL, KMS, magic-link/sessions, WebAuthn,
  TOTP) + the Playwright live test. Stories: SCAFFOLD-001/002, AUTH-001..006, AGENTS-001,
  READ-001 (portal half), TRUST-003.
- **`trustless-cello/packages/directory`** — agent_presence + node-liveness (PRESENCE-001), the
  read/write API (READ/WRITEAPI), the trust identity-tree + ephemeral pickup queue + the
  revocation honor-check (TRUST-001 directory half, LEVER-001). NOTE: **`agent_revocations`
  table already exists (V32, deployed all 3 regions)** — the lever's record shape is in place.
  The `/internal/pre-authorize` API-key pattern is the template for the portal API.
- **`cello-client/core/daemon`** — the trust-signal sealed-box pickup flow (TRUST-001 daemon
  half: pull ciphertext over signaling → `openSealed(k_local)` → verify hash → store → ACK).
  The sealed box already exists: `core/crypto/src/content-seal.ts` (`sealToRecipient`/
  `openSealed`, Ed25519-based). Seal target = the agent's `k_local_pubkey` (no new key).
  A cello-client change → version-bump cascade (TRUST-001 AC-004/005; tag-push/publish = Andre).

### Planning artifacts (all on `main`, trustless-cello, `docs/planning/user-stories/m8/`)
- **Journeys** (design + decisions): `journeys/01-onboarding-and-authentication.md`,
  `journeys/02-agents.md` (agents + home + lever + Dashboard fold), `journeys/03-trust-signals.md`,
  `journeys/04-trust-signal-mechanism.md`. Account-control model: identity-lifecycle log
  `discussion_logs/2026-06-25_2109_agent-identity-lifecycle-discovery.md` §7.
- **`outline.md`** — the 14 component stories + E2E, dependency waves, ratified scoping.
- **15 story YAMLs** — `CELLO-M8-{E2E,SCAFFOLD-001/002,AUTH-001/002/003/004/006,PRESENCE-001,
  READ-001,AGENTS-001,WRITEAPI-001,LEVER-001,TRUST-001,TRUST-003}.yaml`. These ARE the stories;
  contained sub-work is the loop, not new stories.
- **`screen-specs.md`** — the designer brief (per-screen purpose/elements/states + design system).
- **Mockups** — `mookups/M8 Portal (standalone).html` (bundled; render in a browser). FOUR
  screens: Sign-in/signpost, Agents home, Trust Signals, Account & Security. Dark console;
  fonts JetBrains Mono + Lora; pink accent (#db2777). **The top menu bar in the mockup is a
  NAVIGATOR for switching screens/states — NOT part of the site.** The real shell = LEFT sidebar
  (Cello mark; nav: Agents / Trust Signals / Account & Security; the signed-in user + "end-to-end
  encrypted" footer at the bottom) + main content. Agents are fingerprint-primary with OPTIONAL
  labels (some show "no label yet"). Design-system token source: `cello-agent/frontend/src/app/
  globals.css` (dark) and `corp-cello-site` (light) — pull exact tokens at SCAFFOLD-001 time.

### Implementation model (M8-PROCEDURE.md — read it FIRST)
Mirrors M7: three artifacts (DoD yardstick / live test enforcer / this journal). Red-driven
per-unit loop: lowest non-green DoD line → falsify-first → red-first → implement min → confirm
floor (tests/typecheck/lint) → commit → review the unit (`feature-dev:code-reviewer` opus +
`cello-test-attacker`; + `cello-fallback-finder` on persistence/crypto/auth/write-API/revocation)
→ fix every finding → flip DoD tag + journal entry. **Hard rules:** ONE thread, ONE coder
(direct — no parallel implementer agents), one branch per repo, commit constantly, **NEVER merge
to main / NEVER push** (Andre's; trustless-cello push = live deploy). Vitest one-worker-foreground.
The live test = Playwright driving the **served** portal + directory (anchor to the running app,
never in-process component imports).

### Next red (the first unit of actual work)
Write **J-SPINE** (M8-PROCEDURE.md §4): a Playwright test in `cello-portal` that serves the real
portal frontend + backend + a local directory (Docker Postgres + Flyway, the `CELLO_ENV=local`
recipe — see the `/cello-chat` node-operator path + M7's J-SPINE design note in
`m7/M7-BUILD-JOURNAL.md` for the directory/relay local bring-up), and drives the browser through:
open portal → magic-link sign-in → Agents home → an agent appears with presence → four-class
trust scaffold → suspend lever. Assert DOD-SPINE-1..6. It will be almost all red — that is the
map. Anchor to the served app, not components.

Before SCAFFOLD-001 code: the very first sub-steps are bootstrapping `cello-portal` (Next.js App
Router + TypeScript + Tailwind + the design-system tokens from the mockup/source repos + Playwright)
on an assembly branch, and standing up the backend skeleton + its Postgres + migration framework
(SCAFFOLD-002). Then grow J-SPINE journey-by-journey.

### Branch / where work happens
- `cello-portal`: an assembly branch (e.g. `m8-assembly`) — NOT main; never pushed without Andre.
- `trustless-cello` (directory code) + `cello-client` (daemon): one branch each; never pushed.
- **These planning/process docs (M8-PROCEDURE/DoD/JOURNAL + stories) live on `trustless-cello`
  `main`** and ARE pushed (Andre authorized doc pushes). Code is NOT.

### Reviewer outcome / blockers
N/A (docs only this entry; no code, no tests run). No blocker needing Andre — scoping is
ratified, the repo is created, mockups are in hand. Ready to start J-SPINE.

---

## 2026-06-27 — J-SPINE bootstrap: scaffold + backend foundation + spine map (SCAFFOLD-001/002)

**Repo / branch / HEAD.** `cello-portal` (cloned from the empty GitHub repo), branch
**`m8-assembly`** (never pushed), HEAD **`f0c3997`**. Four commits from empty: scaffold baseline
→ shell+backend-foundation → spine harness → review fixes. Code is committed locally only.

**Architecture decision (settled).** cello-portal is a **single Next.js 16 App Router full-stack
app** — `app/api/*` + `src/server/*` (server-only) are the backend (SCAFFOLD-002); route group
`(app)` is the protected shell + screens (SCAFFOLD-001); public `sign-in` is the signpost.
Dedicated Postgres (docker-compose); a checksummed SQL-file migration runner on `pg`; KMS via a
local `EnvelopeCipher` adapter (prod swaps AWS KMS). Mirrors `cello-agent`'s full-stack Next
pattern; deploys as a standalone Node server on ECS; splitting the API onto its own service later
is a reversible refactor. Stack: Next 16.2.9 / React 19.2.4 / Tailwind 4.3.1 / TS 5.9. Dark-console
tokens ported verbatim from `cello-agent/frontend/src/app/globals.css` (JetBrains Mono + Lora, pink
`#db2777`).

**What was built.**
- *Frontend (SCAFFOLD-001):* dark-console design system as code; left-sidebar `AppShell` with
  exactly the three M8 sections (no register/start/stop, no "coming soon"); `proxy`-gated protected
  routes (Next 16 renamed `middleware`→`proxy`); sign-in + stranger signpost (Telegram ceremony +
  GitHub, no account-creation form); Agents-home / Trust-Signals / Account section scaffolds.
- *Backend foundation (SCAFFOLD-002):* composition-root `config.ts` (portal Postgres is the ONLY DB
  connection — no directory DB); lazy `pg` pool (bounded, max 10); `EnvelopeCipher` (AES-256-GCM
  per-field data key, HMAC-wrapped under the master key); checksummed migration runner +
  `0001_init` (account / sessions / webauthn_credentials / totp_secrets / backup_codes /
  magic_link_tokens); server-side opaque-token session store (SHA-256-hashed at rest, revocable);
  structured `domain.noun.verb` logger (process.stdout, `no-console` lint-enforced on `src/**`);
  self-migrate-on-boot via `instrumentation.ts`.
- *Live test (J-SPINE):* Playwright drives the **served** portal (real build + Node server + own
  Postgres, brought up inside `webServer.command`). Anchored to the running app — no in-process
  component/handler imports. All six spine lines present; SPINE-3..6 are `fixme` with explicit
  unblock notes (the local directory cluster + daemon).

**Live-test run (the map, not a claim) — HEAD `f0c3997`:**
- `DOD-SPINE-1 AC-001a` (dark-console tokens RENDERED — computed body bg dark + brand font +
  accent **consumed** by the submit button = `rgb(219,39,119)`) — **✓ green**.
- `DOD-SPINE-1 AC-002` (protected route → redirect to /sign-in; no protected markup/PII; body < 1KB)
  — **✓ green**.
- `DOD-SPINE-1 AC-001b` (authed shell renders the three sections) — **✗ red** (awaits login/SPINE-2).
- `DOD-SPINE-2` (magic-link → durable session) — **✗ red** (endpoints not built).
- `DOD-SPINE-3..6` — fixme (the visible map).
- *SCAFFOLD-002 integration tests (vitest, real Postgres):* **4/4 green** — migration idempotency
  + enumerated schema; **ciphertext-at-rest** for email + TOTP secret (raw column ≠ plaintext,
  round-trips); no directory DB connection; opaque/hashed/revocable sessions (revoke fails next read).
- Floor: `typecheck` clean, `lint` clean, `build` green.

**Reviewers (all three, read-only, on the full unit up to `f0c3997`) — every finding fixed:**
- *fallback-finder* — HIGH: `CELLO_ENV` cast without an allow-list could run production under the
  source-published all-zeros dev KMS key → **fixed** (validate the four envs; dev key only under
  `env=local`; dev/staging/prod require `PORTAL_KMS_MASTER_KEY`). MED: instrumentation silently
  skipped migration on missing DB → **fixed** (build-phase guard only; `process.exit(1)` on migrate
  failure). LOW: orphaned-account label → **fixed** (redirect). Clean paths confirmed: kms, session,
  migrate, the auth gate.
- *code-reviewer (opus)* — verified DOD-INV-1/2/4 + no-directory-DB + proxy-gate CORRECT. HIGH: no
  automated SCAFFOLD-002 integration tests + `pnpm test` errored → **fixed** (4 integration tests
  added; vitest config). MED: KMS key only enforced in prod (= fallback HIGH, same fix); webServer
  raced DB bring-up → **fixed** (DB folded into `webServer.command`). LOW: unguarded `last_seen`
  write → **fixed** (fire-and-forget); is-the-throw-blocking → **fixed** (`process.exit(1)`).
- *test-attacker* — BLOCKING: AC-001a was hollow (a declared-but-unconsumed CSS var would pass) →
  **fixed** (assert computed rendered styles + accent consumed by a real element). AC-002 hardened
  (PII-value absent + body size). Re-ran red→green.

**DoD flips (honest, partial where partial).** `DOD-SPINE-1` → 🟠 (tokens + redirect proven LIVE;
authed-shell half red until SPINE-2). `DOD-INV-2` → 🟡 (ciphertext-at-rest proven by integration
tests; served-path + browser-storage audit pending). `DOD-INV-4` → 🟡 (opaque/hashed/revocable
proven; httpOnly-cookie half proven when login lands). `DOD-INV-8` → 🟡 (three events emitted +
`no-console` enforced; full taxonomy accrues per journey).

**Next red (one sentence).** `DOD-SPINE-2` — build the AUTH-001 magic-link request/verify endpoints
+ account resolution via the directory `email_stub_hash`, and stand up the local directory cluster
in the J-SPINE harness seeded with a known operator + agent — which turns SPINE-2 green and unblocks
SPINE-1 AC-001b (authed shell).

**Blocker needing Andre.** None. (No deploy, no merge, no design fork. Code stays on `m8-assembly`,
unpushed. These planning-doc updates go to `trustless-cello` main, which is authorized.)

---

## 2026-06-27 — SPINE-2 LIVE: magic-link → durable session (AUTH-001); 3 reviewers, all fixed

**Repo / branch / HEAD.** `cello-portal` branch `m8-assembly`, HEAD **`d73f55f`** (pushed to origin —
Andre confirmed cello-portal has no CI, so the branch is pushed freely). `cello-portal` is no longer
unpushed (the earlier "never push code" rule was about the trustless-cello deploy; this repo has no
pipeline).

**Directory map (Explore agent).** The directory's `user_accounts` table has `account_id` (UUID PK) +
`email_stub_hash` (SHA-256 of lowercase+trim email, V30). Internal API = raw-`http`,
header `x-cello-internal-api-key` exact-match against `INTERNAL_API_KEY`, default port 8081, and it
runs INDEPENDENTLY of the FROST/libp2p stack (so a lightweight account-read endpoint is feasible for
READ-001). `agent_presence` does NOT exist yet (confirms PRESENCE-001 builds it). `agent_profiles`
has `account_id` (V23) + `agent_id` (V27).

**What was built (AUTH-001 / SPINE-2 portal half).** Magic-link request/verify behind a
**DirectoryClient** seam (M4 adapter): interface + real HTTP adapter (to the contract above; the
`/internal/account-by-email-stub` endpoint itself is READ-001) + an env-seeded local stub, selected
by a fail-loud composition root (stub only under `CELLO_ENV=local`). requestMagicLink resolves the
account by `email_stub_hash`, persists the KMS-encrypted account row on match, issues a hashed
one-time link + 6-digit code; verify atomically consumes (`FOR UPDATE SKIP LOCKED`) and sets the
opaque httpOnly session cookie. Two route handlers with distinct reason+guidance; events
`portal.auth.magic_link.*` + `portal.session.started`.

**Live-test run (the map) — HEAD `d73f55f`:** J-SPINE **4/4 green** — SPINE-1 (AC-001a tokens RENDERED,
AC-002 redirect-no-PII, AC-001b authed shell + operator-PII positive control) AND SPINE-2 (`/` gated →
request → code → verify → durable opaque httpOnly session → gated Agents home → live cookie
server-side-revocable). SPINE-3..6 fixme. **vitest 12/12** (4 SCAFFOLD-002 + 8 AUTH-001: unknown-email
no-token/no-account, no-enumeration response parity, no-enumeration rate-limit parity, single-use
sequential, single-use CONCURRENT (→ exactly 1 session), expiry, attempt-cap-BLOCKS, request
rate-limit). Floor: typecheck + lint clean.

**Reviewers (all three, on the SPINE-2 unit) — every finding fixed:**
- *code-reviewer (opus)* — HIGH (DOD-INV-1): the per-email rate limit counted issued tokens (which
  exist only for resolved emails) → a 429-known-vs-200-unknown **enumeration oracle**. Fixed: new
  `magic_link_requests` table (migration **0002**, hash-only) records every request → the limit fires
  identically for known/unknown. HIGH: `devCode` returned in dev+staging → restricted to `local` only.
  MED: open redirect via protocol-relative `next` (`//evil.com`) → reject `//`. MED: timing
  side-channel on the resolved path → **tracked residual** (alpha-acceptable; noted on DOD-INV-1).
  LOW: verify GET swallowed all errors → rethrow non-`MagicLinkError`; reason leak → unified to
  `invalid`/`rate_limited`; explicit `FOR UPDATE SKIP LOCKED`; dead `no_account` branch dropped.
  Verified-correct: directory outage surfaces (not flattened to "no account"); cookie flags; no
  plaintext at rest.
- *fallback-finder* — same `devCode` + `CELLO_ENV`-unset findings; the latter fixed by requiring
  `CELLO_ENV` when `NODE_ENV=production`. http-client 200-without-`account_id` → now throws.
  Confirmed the auth GRANT path is fully honest (nothing fails into a session).
- *test-attacker* — 4 blocking test-quality gaps, all closed: no-enumeration (response + rate-limit
  parity), CONCURRENT single-use, attempt-cap actually BLOCKS, and SPINE-2 now proves `/` is gated
  AND the live cookie session is server-side-revocable end-to-end.

**DoD flips.** `DOD-SPINE-1` → ✅ (J-SPINE 4/4). `DOD-SPINE-2` → 🟠 (portal half live end-to-end;
real-directory resolution = READ-001). `DOD-INV-1` → 🟡 (ceremony-gated + no-enumeration proven by
AUTH-001 tests; real directory = READ-001; timing residual tracked). `DOD-INV-4` → ✅ (opaque httpOnly
cookie + server-side revoke fails the next gated request, proven live + integration). `DOD-AUTH-7` →
🟡 (single-use/concurrent/expiry/cap/rate-limit proven by AUTH-001 integration tests).

**Cron.** A 30-minute watchdog (`fd223740`, fires :07/:37, session-only) is running per Andre's
request — each fire: apply finished reviewers, advance the lowest non-green DoD line, drift-check
✅ flips, commit/push, never block.

**Next red (one sentence).** `READ-001` — add the directory `/internal/account-by-email-stub` endpoint
(trustless-cello, directory-side) + the account/agents read path, stand up a real directory + Postgres
in the J-SPINE harness seeded with the known operator + an agent, swap the harness to the HTTP adapter
→ flips SPINE-2 to ✅ and lights up SPINE-3 (agents appear with presence).

**Blocker needing Andre.** None.

---

## 2026-06-27 — READ-001 endpoint done; harness bring-up sequenced with PRESENCE-001; pivot to J-AUTH

**Directory endpoint (READ-001 first deliverable).** Added `POST /internal/account-by-email-stub` to
the directory's internal API (`packages/directory/src/internal-api-server.ts`) — API-key protected
(`x-cello-internal-api-key`), `SELECT account_id FROM user_accounts WHERE email_stub_hash=$1`, 200
`{account_id}` / 404 / 401 / 400. Exactly the contract the portal `HttpDirectoryClient` targets.
In-process contract test (real HTTP server + recording stub pool, no docker) — **5/5 green**.
Worktree `trustless-cello-m8-read001`, branch `m8-read-001`, commits `57483b4f` + `aceab8ce` (kept
LOCAL — a trustless-cello feature branch is not pushed; only main/docs are).

**Sequencing decision (deliberate).** The rest of READ-001 — spawning the real directory + a
Flyway-migrated Postgres inside the J-SPINE Playwright harness, seeding `user_accounts`, and swapping
the portal off the stub onto the HTTP adapter — is a heavyweight cross-repo lift, and it ALSO needs
PRESENCE-001's `agent_presence` for SPINE-3. Rather than stand the directory up twice (a fragile
half-harness for SPINE-2 now, then again for SPINE-3), I'm batching the real-directory harness
bring-up with PRESENCE-001 so it serves SPINE-2 (account resolution) AND SPINE-3 (agents + presence)
in one step. SPINE-2 stays honestly 🟠 until then; the endpoint is ready and contract-locked.

**Next red.** Advance the next fully-unblocked tier — **J-AUTH: AUTH-002 (WebAuthn enroll/login,
multi-credential, step-up) + AUTH-003 (TOTP + backup codes)** — pure portal-backend, no directory.
Then the batched directory-harness + PRESENCE-001 step lights up SPINE-2 ✅ and SPINE-3.

---

## 2026-06-27 — AUTH-002 LIVE: WebAuthn enroll/login/step-up; 3 reviewers, all fixed

**Repo / branch / HEAD.** `cello-portal` `m8-assembly` HEAD `18c2dec` (pushed). 16 commits, granular.

**Built (AUTH-002 / J-AUTH).** WebAuthn enroll / usernameless login / step-up with
`@simplewebauthn/server` v13. Server-side single-use challenges (migration `0003`, cookie-keyed);
discoverable-credential login (resolve account from the asserted credential id, verify against the
stored public key); step-up window model; the bootstrap-can't-escalate gate on BOTH /register/options
and /register/verify. UI: a passkey panel on Account (SSR list, add/remove with step-up) +
usernameless passkey sign-in. `@simplewebauthn/browser` client glue.

**Live-test run — HEAD `18c2dec`:** **J-AUTH 7/7** via a Chrome CDP virtual authenticator (real
ceremonies): enroll → sign-out → usernameless login; FORGED-assertion-for-a-known-credential rejected
(proves real signature verification, deterministic — replaced a flaky route-interception version);
multi-credential (device A platform + device B usb, removing A leaves B); SI-001 at /options AND the
mutation path /verify; step-up-gated removal; and per-op window expiry (a 2nd op after `ageStepUp()`
needs a fresh step-up). Full e2e **11/11** (4 J-SPINE + 7 J-AUTH), stable across runs; vitest 12/12;
typecheck + lint + build clean.

**Reviewers (all three, on the AUTH-002 unit) — every finding fixed:**
- *code-reviewer (opus)* — NO blocking/high; crypto invariants all verified correct (verify against
  stored key, counter regression, single-use challenges, SI-001 not bypassable, cookie flags). Fixed:
  userVerification 'required' on all 3 ceremonies (was 'preferred', mismatched the v13 verify default);
  finishRegistration catches the credential_id UNIQUE violation → `already_registered` (was a raw 500);
  flagged the login-stamps-step-up window (kept — window model is the AC-003 spec, now proven per-op).
- *fallback-finder* — MED: WEBAUTHN_RP_ID/ORIGIN defaulted to localhost everywhere → now fail loud
  outside `local`. Confirmed the auth grant path is fully honest (every `verified` checked; no
  throw-into-success; challenge single-use/purpose/expiry enforced; step-up gate denies on null).
- *test-attacker* — 3 blocking hollow-test gaps, all closed: AC-001 negative (forged assertion
  rejected — was indistinguishable from a no-verify stub); SI-001 mutation path (gate /verify, not just
  /options — added the gate + the test); per-op step-up (window expiry vs once-per-session flag).

**Also (AUTH-003 in flight).** The TOTP + backup-codes service is built (otplib v13 functional API —
`generateSecret`/`generateURI`/`verifySync` with `epochTolerance`; KMS-encrypted secret; hashed
single-use backup codes). Endpoints/UI/tests next.

**DoD flips.** `DOD-AUTH-1` ✅, `DOD-AUTH-2` ✅, `DOD-INV-5` ✅ (all proven live, J-AUTH).

**Next red.** Finish AUTH-003 (TOTP enroll/verify + backup codes endpoints + UI + integration/live
tests → DOD-AUTH-3), then AUTH-004 (strong-auth enforcement) + AUTH-006 (Account screen), then the
batched PRESENCE-001 + real-directory-harness step (SPINE-2 ✅ + SPINE-3).

**Blocker needing Andre.** None.

---

## 2026-06-27 — AUTH-003 LIVE: TOTP + backup codes; 3 reviewers, 2 HIGH + all fixed

**Repo / branch / HEAD.** `cello-portal` `m8-assembly` HEAD `c32e4bc` (pushed). 21 commits, granular.

**Built (AUTH-003 / J-TOTP).** TOTP (otplib v13 functional API — `generateSecret`/`generateURI`/
`verifySync`, ±1 step) + one-time backup codes. Secret KMS-encrypted at rest; backup codes 80-bit,
sha256-hashed (account-bound), single-use. 5 endpoints (enroll/start, enroll/verify, verify,
backup-codes/issue, backup-code/verify) + a TotpPanel on the Account screen. Migrations: `0003`
(webauthn challenges, from AUTH-002) and **`0004`** (TOTP replay column + auth_verify_attempts).

**Live-test run — HEAD `c32e4bc`:** **J-TOTP 4/4** against the served portal (the test plays the
authenticator app, generating RFC-6238 codes): AC-001 enroll-with-current-code + fresh-login
verify-after-load + the bootstrap→strong auth_level TRANSITION (wrong code stays bootstrap);
DOD-INV-5 enroll gate (bootstrap refused at start AND verify once a factor exists); TOTP verify
rate-limit (5 fails → 429); AC-002 backup-code single-use + strong-auth upgrade. **vitest 19/19**
(scaffold + magic-link + TOTP). Full e2e **15/15** (J-SPINE 4 + J-AUTH 7 + J-TOTP 4); build +
typecheck + lint clean.

**Reviewers (all three) — 2 HIGH + every finding fixed:**
- *code-reviewer (opus)* — HIGH-1: a malformed/empty code threw in otplib → HTTP 500 on a normal
  typo; guarded (`/^\d{6}$/`) → clean `invalid_code`. HIGH-2 (DOD-INV-5): TOTP enroll was an
  unguarded escalation/downgrade (a bootstrap session could plant/reset a strong factor with no
  step-up — AUTH-002 gated WebAuthn but TOTP had no equivalent); added a shared `hasStrongFactor()`
  (passkey OR confirmed TOTP) gating BOTH TOTP enroll endpoints, and aligned the WebAuthn register
  gate to the same cross-factor predicate. MED: replay protection (last_used_time_step + atomic
  conditional UPDATE) + verify rate-limit. MED: 40→80-bit codes. LOW: transactional issuance.
- *fallback-finder* — NO silent fallbacks (every absence denies, KMS/DB failures throw loud,
  single-use atomic); flagged the 40-bit entropy (fixed).
- *test-attacker* — 4 hollow-test gaps, all closed: SI-001 secret assertion now proves KEYED
  encryption (different master key can't decrypt) not reversible encoding; backup-hash assertion now
  recompute-equality + 64-hex; concurrent double-spend test (spends once); strong-auth transition
  asserted (positive + negative, not just HTTP status).

**DoD flip.** `DOD-AUTH-3` ✅.

**Next red.** The J-AUTH tier is essentially complete (DOD-AUTH-1/2/3 ✅, INV-4/5 ✅). Remaining
M8: AUTH-004 (7-day strong-auth grace + waiver / admin override → DOD-AUTH-4), AUTH-006 (Account &
Security screen → DOD-AUTH-5), AUTH-001 signpost assertion (DOD-AUTH-6); then the batched
**PRESENCE-001 + real-directory harness** (flips SPINE-2 ✅ + lights SPINE-3), LEVER-001 (SPINE-4),
TRUST-001/003 (SPINE-5/6), E2E close gate.

**Blocker needing Andre.** None.

---

## 2026-06-27 — READ-001 (account resolution) LIVE + SPINE-2 ✅

**What was built.** The READ-001 account-resolution path, proven end-to-end against the REAL
directory (not the stub):
- *Directory side* (worktree `m8-read-001`, commits `57483b4f` endpoint, `aceab8ce` in-process
  contract test, `b958f74b` `internal-api-only` standalone runner, + the live test): a live
  integration test stands up `createInternalApiServer` with a real pg pool to the directory
  Postgres (the running `cello-postgres:18` on :5433, 29 migrations, `user_accounts.email_stub_hash`
  present), seeds a `user_accounts` row, and hits `/internal/account-by-email-stub` over real HTTP —
  resolves by email_stub_hash, 404 unknown, 401 no-key. **3/3.**
- *Portal side* (`cello-portal`): a gated (READ001_LIVE) integration test runs the portal's real
  `HttpDirectoryClient` against the live directory internal-api — resolves the operator, null for
  unknown, THROWS on 401 (auth failure not flattened to null). **3/3.**
- *End-to-end* (`cello-portal` `a771985`): an opt-in harness mode — when `DIRECTORY_API_URL` is set,
  the served portal resolves accounts via the real HTTP adapter instead of the stub. Ran J-SPINE
  against the live directory (seeded operator): **5/5**, SPINE-2 included — the served portal's
  magic-link flow resolved the account through the real directory in the browser. Default harness
  keeps the stub for suite robustness.

**DoD flip.** `DOD-SPINE-2` → ✅ (proven live against the served portal + the real directory).

**What remains for the directory tier.** SPINE-3 (agents appear with presence) needs PRESENCE-001
(the `agent_presence` table doesn't exist yet) + the agents read endpoint, plus auto-bring-up of the
directory in the harness (currently the real-directory mode assumes the directory is up + seeded;
full automation is the E2E close gate). The `m8-read-001` directory branch is LOCAL (a trustless-cello
feature branch is not pushed).

**Next red.** PRESENCE-001 (`agent_presence` + node-liveness + the presence read rule) → then
AGENTS-001 / the agents read endpoint → SPINE-3. Plus AUTH-004 (7-day grace) / AUTH-006 (Account
screen) remain in J-AUTH. LEVER-001 (SPINE-4), TRUST-001/003 (SPINE-5/6), E2E close gate after.

**Blocker needing Andre.** None.

---

## 2026-06-27 — PRESENCE-001 migration foundation (V33 designed + validated)

**What was built (the careful migration-first step, per the M5 migration-integrity rules).** The
V33 `agent_presence` migration (worktree `m8-read-001`, commit `0ba1d49e`):
- `agent_presence` — a MUTABLE upsert table (agent_id PK, owning_node_id, online, last_seen_at,
  updated_at; no chain_hash — high-churn presence, not append-only). Written ONLY by the owning
  node (sovereign, the `sessions.owning_node_id` pattern); cross-node writes prevented in app code.
  cello_service full-DML RLS (idempotent policy), index on owning_node_id.
- `directory_nodes.last_heartbeat_at` — the per-node liveness guard for the presence read rule
  (online iff the presence row is online AND the owning node's heartbeat is fresh → a crashed
  node's stale rows age out to last-seen).
- SSM `OpsAgentExpectedMigrationVersion` 32→33 (mandatory per the migration rule).

**Validated.** The V33 SQL applies cleanly against the REAL directory schema (the running
`cello-postgres:18` at V29+) in a rolled-back transaction — agent_presence created, last_heartbeat_at
added, RLS policy + 2 indexes + GRANT all valid. (Full flyway-checksum apply against a fully-migrated
DB is pending the directory bring-up plumbing — the running DB is from another compose project, so
`compose run flyway` collides on :5433; this is a harness-orchestration detail, not a migration
defect.)

**What remains for PRESENCE-001 (next, deliberately separate — directory federation internals +
multi-node e2e).** (1) Node-code wiring in `directory-node.ts`: edge-triggered upserts at the
#streams add/remove sites (one write per connect/disconnect transition, none per heartbeat tick) +
a per-node `last_heartbeat_at` refresh (~30-60s) + startup reconciliation (mark owned rows offline
at boot). (2) The account-scoped agents read endpoint (READ-001 agents half) applying the presence
read rule. (3) The multi-node e2e for AC-002/003/004 (transition-write-count, replication read from
a different node, node-liveness guard, sovereign write-ownership) — needs a ≥2-node federation
harness. These light SPINE-3.

**Migration-version note.** V33 is the next free number after V32. The parallel M9 effort
(`m9-build`) is the security gateway and (as far as I can see) adds no directory migrations; if it
does, a renumber would be needed — flagged for coordination. The `m8-read-001` branch is LOCAL.

**Blocker needing Andre.** None.

---

## 2026-06-27 — SPINE-3 ✅: agents appear with directory-derived presence (PRESENCE-001 + READ-001 + AGENTS-001)

**What was built + proven.**
- *Directory (m8-read-001):* V33 agent_presence migration (keyed by k_local_pubkey) + the presence
  repository + the read rule, proven 5/5 against real schema (presence-001-repository: AC-002
  connect→online, AC-003 dark-node→last-seen, AC-004 sovereign ownership, reconcile, edge-triggered
  single-row). Node-code wired at the REAL #streams hook sites (connect 1334 → upsertPresenceOnline,
  disconnect 1822 → upsertPresenceOffline; fire-and-forget so a presence hiccup never breaks auth),
  a 45s per-node heartbeat in start() (cleared on stop), and startup reconciliation in
  bin/directory.ts. `/internal/agents-by-account` endpoint (read rule, node freshness 120s) +
  in-process contract test 3/3.
- *Portal (cello-portal):* DirectoryClient.listAgents (HTTP adapter + stub seeded via
  PORTAL_DIRECTORY_STUB_AGENTS); getAccountAgents with honest degradation; the Agents home renders
  fingerprint-primary agent rows + StatusDot (directory-derived) + last-seen, empty→ceremony, no
  lifecycle controls.

**Live-test run — cello-portal `78b67ec`:** J-SPINE against the REAL directory (DIRECTORY_API_URL +
a seeded ceremony-registered agent online on a freshly-heartbeating node) — **6/6**, SPINE-3
included: the agent appears in the Agents home with presence computed by the real read rule
(portal HttpDirectoryClient → directory agents endpoint → directory Postgres). The first run
correctly read OFFLINE once the seeded node's heartbeat aged past the 120s window — the
node-liveness guard working. Default (stub) mode: e2e green, SPINE-3 + the live-directory tests
skipped (gated). vitest 19 passed + 3 skipped.

**Applied V33 to the running dev directory DB** via psql (the container has pre-existing flyway
drift at V30 — schema ahead of history, not my migration's fault; V33 adds only new objects so it
applies cleanly). The real-directory internal-api (8099) re-spawned with the agents endpoint.

**DoD flips.** `DOD-SPINE-3` ✅. `DOD-READ-1` ✅ (account-scoped read live). `DOD-READ-2` ✅ (read
rule live). `DOD-PRES-1/2/3` 🟡 (migration + repo + read rule + sovereign ownership + node-code
proven at integration/repo layer; the live ≥2-node assertions — exactly-two-writes-per-lifecycle,
readable-from-a-different-node, live dark-node — are the E2E close gate). `DOD-READ-3` 🟡 (degraded
path coded; focused test pending).

**Next red.** The directory-unreachable degraded-path test (DOD-READ-3 → ✅), then the remaining
J-AUTH (AUTH-004 grace, AUTH-006 account screen), LEVER-001 (SPINE-4), TRUST-001/003 (SPINE-5/6),
the multi-node PRESENCE e2e + directory cluster auto-bring-up, and the E2E close gate.

**Blocker needing Andre.** None.

---

## 2026-06-27 — AUTH-006 ✅: active sessions + log-out-everywhere (DOD-AUTH-5)

The Account & Security screen now manages active sessions on top of the factors (WebAuthn + TOTP
panels from AUTH-002/003). session store: listSessions (active, marks the current device) +
revokeOtherSessionsById. Endpoints GET /api/account/sessions (portal.sessions.listed) + POST
/api/account/sessions/revoke-others (portal.session.revoked, scope=others). SessionsPanel (SSR list
+ "Log out everywhere"). **J-account AC-001 (1/1):** two contexts (two devices) on one account; "log
out everywhere" from A → B's next request is bounced to sign-in (B's cookie unchanged → server-side
revocation across sessions, exactly why sessions are stateful), A stays in. Factor-removal step-up
(AC-002) is already proven by AUTH-002 (J-AUTH AC-003). Full default e2e green; build/typecheck/lint
clean. `DOD-AUTH-5` ✅. cello-portal `1281ef4`.

---

## 2026-06-27 — TRUST-003 ✅ (SPINE-5 / INV-7) + INV-3 read-half proven

**TRUST-003 — four-class Trust Signals scaffold.** Four named classes (Identity proofs / Network
graph / Track record / Economic stake) in order, Class-1 sub-groups distinct (account-security /
verified-contacts / social / device-sacrifice). WebAuthn/TOTP/email are LIVE (real account state —
the WebAuthn cell flips active after a real enrollment); the rest are honest "coming soon"
placeholders with no working control / no fabricated data. NEVER a composite / TrustRank / seed
badge. **J-trust 3/3.** `DOD-SPINE-5` ✅, `DOD-INV-7` ✅, `DOD-TRUST-5` ✅. cello-portal `11fc900`.

**AUTH-006 review (fallback-finder): NO silent fallbacks** — account-scoping tight (account/session
id come only from the cookie-bound DB row, no client-supplied path, no off-by-one); revoke-others
keeps exactly the current session; the only swallow is the cosmetic last_seen telemetry (correctly
isolated from auth). That also confirms DOD-INV-3's READ half → flipped 🟡 (read-scoping server-side
proven; the WRITE half is WRITEAPI-001, not yet built).

**Remaining.** AUTH-004 (7-day grace), AGENTS-001 polish (alerts/posture + browser-storage SI),
WRITEAPI-001 + LEVER-001 (SPINE-4), TRUST-001 (SPINE-6 pipe), the multi-node PRESENCE e2e + directory
auto-bring-up, E2E close gate.

---

## 2026-06-27 — AUTH-004 ✅: 7-day strong-auth grace + hard wall + admin waiver (DOD-AUTH-4)

Migration 0005 adds account.strong_auth_waiver (admin/support-set; NO portal surface writes it →
operators cannot self-grant). isStrongAuthWalled(accountId) = no strong factor (passkey OR confirmed
TOTP) AND account age > 7 days AND no waiver. The agents + trust-signals pages compute it
server-side and redirect to /account when walled (no client bypass); the Account screen is the
reachable destination with a hard 2FA-required banner. **J-grace 4/4:** within-grace accessible;
past-grace gated to the wall; enrolling a passkey lifts it; an admin waiver lifts it without 2FA.
vitest 20 passed (0005 applied + asserted); full default e2e 24 passed. `DOD-AUTH-4` ✅. cello-portal
`1641b00`. (AUTH-007 single-use/expiry/rate-limit is integration-proven 🟡; the magic-link OTP
endpoints are exercised live by login.)

**Remaining.** AGENTS-001 polish (alerts/posture + browser-storage SI → DOD-AGENT-1/2, DOD-INV-9),
WRITEAPI-001 + LEVER-001 (SPINE-4, INV-6), TRUST-001 (SPINE-6 pipe, INV-2 browser-storage half), the
multi-node PRESENCE e2e + directory auto-bring-up, E2E close gate.

---

## 2026-06-27 — DOD-INV-9 ✅ + DOD-AGENT-2 ✅ (J-AGENTS); INV-2 browser-half proven; AUTH-004 wall centralized

**J-AGENTS Playwright (`e2e/j-agents.spec.ts`, 2/2 green).** Two invariant cases proven live against
the served portal:
- *INV-9 — agents appear, no lifecycle control:* the Agents home exposes zero register/start/stop/
  create/set-current controls (button + text counts both 0), and the nav is exactly the 3 M8
  sections. The only outbound affordance is the ceremony signpost. `DOD-INV-9` ❌ → ✅.
- *AGENT-2/INV-2 browser half — no identity data in web storage:* after visiting the Agents home and
  the Account screen, `localStorage`/`sessionStorage` are `"{}"` and `indexedDB.databases()` is
  length 0. The session rides an httpOnly cookie only. `DOD-AGENT-2` ❌ → ✅, and `DOD-INV-2`'s
  browser-storage half flipped from pending to PROVEN (its note now scopes the residual to the
  served WRITE paths under WRITEAPI-001/TRUST-001). cello-portal `ac83cf1`.

**AUTH-004 fallback-finder hardening (centralize the wall).** The fallback-finder (`ad26edca`) found
NO silent fallbacks but raised one MEDIUM: the strong-auth wall was enforced PER-PAGE — each (app)
server component opted in by calling `isStrongAuthWalled`. A new (app) route added without that call
would be silently ungated (fail-open by omission). Fixed: the proxy now forwards `x-cello-pathname`
(a layout can't read the pathname), and `(app)/layout.tsx` enforces the wall centrally for every
route except `/account` (the wall destination). Removed the now-redundant per-page checks from the
agents home and trust-signals pages. The default is now fail-closed: a new route is gated unless it
explicitly is `/account`. typecheck + lint clean; **J-grace re-run 4/4 green** (centralized gate
holds). cello-portal `b66cf32`.

**Remaining.** AGENTS-001 polish (alerts/posture header → DOD-AGENT-1), WRITEAPI-001 + LEVER-001
(SPINE-4, INV-6 suspend lever), TRUST-001 (SPINE-6 pipe, INV-2 server-write half), the multi-node
PRESENCE e2e + directory auto-bring-up, E2E close gate.

---

## 2026-06-27 — WRITEAPI-001 ✅: the directory write seam (DOD-WRITE-1)

The portal's one authenticated, account-scoped directory write endpoint — `POST /internal/agent-write`
(`internal-api-server.ts`), the shared seam that blocks LEVER-001 (revocation flag) and TRUST-001
(trust-signal hash + sealed ciphertext). Built schema-first.

**Schema (V34, schema-first per M5 #4).** One migration reserves all three target tables so the two
consumers build in parallel: `agent_suspensions` (MUTABLE reversible pause flag — mirrors
agent_presence V33; a pause must be clearable, so it can't live in the append-only permanent
agent_revocations V32), `identity_tree_entries` (trust-signal hash), `pickup_queue` (sealed
ciphertext). RLS permissive for cello_service with app-level scoping (matches V33). All three added
to cello_pub (everything written replicates to every sovereign node); pickup_queue's BIGSERIAL-under-
replication concern flagged for TRUST-001. SSM OpsAgentExpectedMigrationVersion 33→34.

**Seam discipline.** Auth (x-cello-internal-api-key). Account-scoping is DERIVED from
`isAgentOwnedByAccount` (agent_profiles.account_id) — not a request field — so A cannot write B's
agent (403, nothing persisted). Payload discipline is structural: `validateWritePayload` enforces a
strict per-kind schema with NO free-text slot — revocation_flag = {mode∈pause|clear}, trust_signal_hash
= {signalKind∈allowlist, signalHash=64-hex}, trust_signal_ciphertext = {ciphertext: base64, ≥48 bytes,
not all-printable}. Unknown kind / extra key / non-hex / all-printable → 422, nothing persisted.
Validation runs BEFORE any DB touch. directory.write.accepted/.rejected with distinct reason +
correlationId.

**Proof.** Contract test 11/11 (real HTTP + recording stub pool: auth, ownership, every reject
persists nothing). Live test 5/5 against the real directory Postgres (:5433): pause→paused=true +
authorized_by_account, clear→false; cross-account 403; hash→identity_tree; ciphertext→pickup_queue;
**SI-001 dump — a smuggled raw email + OAuth token are rejected AND absent from every byte of the
three seam tables.** typecheck + lint clean.

**Reviews.** cello-fallback-finder: NO SILENT FALLBACKS (fail-closed at every gate; ownership error
not swallowed; no permissive default; rejections persist nothing). Applied its one note — capped
readBody at 256KB across all internal endpoints. feature-dev:code-reviewer (opus) dispatched.

**Portal half.** `DirectoryClient.writeAgent` added to the interface + both adapters. HttpDirectoryClient
distinguishes a deliberate REJECTION (4xx → DirectoryWriteRejectedError with the directory's machine
reason) from an outage (5xx/transport → DirectoryUnreachableError) — never flattening a refusal into
success. StubDirectoryClient records writes for introspection. `DOD-WRITE-1` ✅. directory branch
m8-read-001 (local); cello-portal `fefcf9b` (pushed, no CI).

**Next.** LEVER-001 — the FROST honor-check (frost-handler share gate reads agent_suspensions,
mirroring the agent_revocations soft-refuse) + the portal per-row pause lever (step-up-gated) →
DOD-SPINE-4 + DOD-INV-6 + DOD-LEVER-1/4. AC-003 strict-T-of-N distinct-error + AC-002 burn share-
destruction are the heavier cross-repo / multi-node parts (marked honestly when reached).

---

## 2026-06-27 — LEVER-001 directory honor-check ✅: pause blocks signing (DOD-SPINE-4, DOD-LEVER-1)

The reversible suspend lever's enforcement core — a PAUSED agent cannot complete a FROST ceremony,
server-side, even with a valid client share. Cross-repo: directory + cello-client daemon.

**Directory honor-check (two gates, defense-in-depth).** `isAgentSuspended(kLocalPubkeyHex)` added to
the DirectoryStore interface + pg adapter + in-memory stub. The pg impl reads the LIVE replicated
`agent_suspensions` row (async, one indexed join) — NOT an in-memory cache: a pause is mutable and a
security control, so a stale cache must never let a paused agent sign. Two gates:
- session-init gate (`directory-node.ts`, mirrors the existing `agent_revoked` soft-refuse): a paused
  TARGET or INITIATOR → `session_request_error reason=agent_suspended`. `agent_suspended` added to the
  directory-local `SessionRequestErrorReason`.
- FROST share gate (`#handleFrostStream` commit + sign frames, `#isAgentPaused`): an honest node
  refuses its share (`reason=AGENT_SUSPENDED`) so no threshold forms. Fails CLOSED on a read error
  (refuse + `frost.suspend_check.failed`); other healthy nodes still serve (redundancy preserved).
  `frost.ceremony.refused.revoked` logged.

**Daemon (cello-client, branch m8-lever-001).** `agent_suspended` added to the daemon's known-reason
set (`session-assignment-parser.ts`) so the directory's refusal surfaces DISTINCTLY to the MCP instead
of mapping to the generic `directory_unreachable` — parallel to `agent_revoked`. Local rebuild; the
npm publish cascade is Andre-gated (operators get it on publish).

**Proof — J-SUSPEND (`packages/e2e-tests/src/spine/j-suspend.spine.test.ts`, 1/1, ~42s).** Real
binaries cross-process: A registers (real DKG → valid client share) + online; set the replicated
pause flag in `agent_suspensions` keyed by A's directory agent_id; A's OWN `cello_initiate_session`
fails with exactly `agent_suspended` (directory refuses server-side, valid share doesn't help —
SI-001); un-pause → no longer `agent_suspended` (reversible). Positive control before the pause pins
the refusal to the flag. typecheck + lint clean; m6b-002 + writeapi tests green. (First run surfaced
`directory_unreachable` — the daemon didn't know the new reason yet; the daemon fix + rebuild is what
made it `agent_suspended`, confirming the directory was already refusing correctly.)

**Tags.** `DOD-SPINE-4` ✅, `DOD-LEVER-1` ✅. `DOD-INV-6` 🟡 (server-side block + per-node honor-check
mechanism proven; the strict "one node continuing doesn't help" anti-2-of-2 distinction needs a
≥3-node cluster — DOD-LEVER-3/AC-003). `DOD-LEVER-3` 🟡 (distinct-error half done; strict T-of-N
pending multi-node). directory branch m8-read-001 `54861044`; cello-client m8-lever-001 `0eb70a9`.

**Env note.** The spine harness owns docker postgres on :5433; I stopped `trustless-cello-postgres-1`
(the dev cello_dev DB) to free the port. The default portal e2e uses the directory STUB (no :5433
dep), so j-grace/j-agents are unaffected. Restart that container (after stopping the spine one) if
portal real-directory mode is needed again.

**Next (LEVER-001 remaining).** Portal per-row pause lever — API route (owner-only, step-up-gated via
isStepUpFresh) + UI button on the Agents home → DOD-LEVER-4 (SI-002 owner-only/step-up). Then the
heavier deferred parts: DOD-LEVER-2 burn (federation-wide share destruction) + DOD-LEVER-3 strict
multi-node T-of-N.

---

## 2026-06-27 — LEVER-001 portal lever ✅ (J-LEVER): per-row Pause/Resume (DOD-AGENT-1 lever, DOD-LEVER-4 owner/step-up)

The portal half of the suspend lever — the ONE agent-control action (DOD-INV-9).

**Read extension (additive).** `agents-by-account` now returns `agent_id` (the seam's write key) and
`paused` (LEFT JOIN agent_suspensions) alongside k_local_pubkey. Portal `AgentPresence` gains both;
http-client + stub map them. No WRITEAPI rework. READ-001 tests green.

**Route** `POST /api/agents/suspend {agentId, mode}`: accountId from the session (never the client);
requires a fresh WebAuthn step-up when the account has a strong factor (mirrors the enroll gate);
routes through `DirectoryClient.writeAgent` → the account-scoped seam, which re-proves ownership
(SI-002 — cross-account `not_owner` rejected, proven by WRITEAPI-001 live). Distinguishes a directory
rejection (not_owner→403, invalid→422) from an outage (503). portal.agent.suspend.requested/.rejected.

**UI** `SuspendLever` client island per Agents-home row: Pause/Resume + a paused badge, driven by the
agent's directory `paused`. Not rendered when agent_id is null (not suspendable). On step_up_required
it prompts to verify a passkey.

**Proof — J-LEVER (`e2e/j-lever.spec.ts`, 2/2):** the home renders exactly one per-row Pause lever
(INV-9 still green — no register/start/stop/set-current); within grace (no strong factor) Pause needs
no step-up and round-trips: Pause → read reflects paused (Resume + badge) → Resume clears it. Stub
reflects writes via globalThis (Next bundles the route + page RSC separately, so a plain field
wouldn't cross the write→read boundary). Regression: j-agents + j-grace 6/6 green with the seeded
agent (the lever does not trip INV-9).

**Tags.** `DOD-AGENT-1` 🟡 (list + presence + per-row lever + empty-state proven; alerts strip +
posture header remain). `DOD-LEVER-4` 🟡 (owner-only seam + step-up gate built; within-grace path
proven; the step-up-REQUIRED + cross-account route e2e + burn remain). directory branch m8-read-001;
cello-portal `f5cb778` (pushed).

**LEVER-001 status.** Enforcement core ✅ (J-SUSPEND, DOD-SPINE-4/LEVER-1). Portal lever ✅ (J-LEVER).
Remaining: step-up-required e2e, burn (DOD-LEVER-2), strict multi-node T-of-N (DOD-LEVER-3 second half).

---

## 2026-06-27 — TRUST-001 portal seal pipeline (the pipe's source; cross-process halves pending)

The portal half of the trust-signal pipe — proven in isolation; the directory delivery + daemon
pickup + ACK are the cross-process halves that flip SPINE-6.

**Mapping (Explore agent).** Confirmed the reuse pattern + signatures: the directory's existing
notification path (`pg-notification-queue.ts` enqueue/drainUndelivered/acknowledge + the reconnect
drain in `directory-node.ts` ~L1472/L1516-1580) is what the pickup_queue delivery mirrors;
`@cello-protocol/crypto` exports `sealToRecipient(pubkey, plaintext)` / `openSealed(seed, blob)` /
`hash(bytes)` / `generateKLocalSeed` / `InMemoryKeyProvider`; the portal hooks in at
`webauthn/register/verify`; `listAgents` already returns `kLocalPubkey` + `agentId`. **Design answer
(D-multi-agent):** an account-level signal seals to EVERY addressable agent (one sealed copy each, so
each can prove enrollment + independently verify/ACK).

**Built — `src/server/trust/handoff.ts`.** `handTrustSignal(accountId, signal)`: canonical JSON →
`hash` → for each agent with a `kLocalPubkey`+`agentId`, `sealToRecipient(k_local)` → write the hash
(`trust_signal_hash`) + sealed ciphertext (`trust_signal_ciphertext`) through the WRITEAPI seam, then
discard the plaintext. Best-effort (a directory failure never fails the local enrollment — the signal
is re-mintable). Wired into the WebAuthn enroll verify route. `portal.trust_signal.handed_off` carries
the signalHash ONLY, never the plaintext.

**Proof — `test/trust-handoff.test.ts` (3/3, real Ed25519 keypairs).** SI-001: only the agent's
k_local SEED opens the ciphertext (a wrong seed → null); the opaque blob does not contain the
plaintext secret; the written hash is the exact anchor the daemon recomputes from the recovered JSON.
Account-level signal seals to every agent, each copy bound to its own key (B's seed cannot open A's
copy). typecheck + lint clean; j-grace + j-lever 6/6 (enrollment path unaffected). Added
`@cello-protocol/crypto@^0.0.11`.

**Tags.** `DOD-TRUST-1` 🟡, `DOD-TRUST-2` 🟡 (portal source half proven: seal-to-k_local + no
server-side plaintext at the portal). REMAINING for SPINE-6/DOD-TRUST-1: the DIRECTORY delivery
(drain pickup_queue on reconnect over signaling + ACK-DELETE, reusing the notification path —
DOD-TRUST-3) and the DAEMON pickup (`openSealed` → recompute+verify hash → store → ACK,
`daemon.trust_signal.received verified:true`) — both cross-process, proven by a J-TRUST spine test;
plus the cello-client publish cascade (DOD-TRUST-4, Andre-gated) + the trustless-cello dep update
(DOD-TRUST-5... actually DOD-TRUST-4 publish / AC-005 dep-update). cello-portal `6aad444` (pushed).

---

## 2026-06-27 — TRUST-001 directory delivery foundation: V35 + pickup drain/ACK (DOD-TRUST-3 mechanics)

The directory-delivery half's foundation — schema + queue mechanics, proven live. The directory-node
reconnect wiring + daemon pickup + J-TRUST spine are the final interlocking cross-process piece.

**V35 — pickup_queue.signal_kind.** The daemon must verify openSealed(ciphertext) recomputes to the
directory's hash (AC-001). The hash is authoritative in identity_tree_entries, so the pickup delivery
JOINs it by (agent_id, signal_kind) — but V34's pickup_queue lacked signal_kind. V35 adds it (V34
already applied → new migration, not a modify). The seam's trust_signal_ciphertext payload now carries
{ciphertext, signalKind}; the hash stays SINGLE-SOURCED in the identity tree (never denormalized onto
the queue). SSM expected migration 34→35. Threaded through the portal (AgentWrite + wire + handoff).
WRITEAPI contract 12/12 + live 5/5 (cello_spine) green.

**Pickup drain + ACK-delete (`pickup-repository.ts`).** drainPickupForAgent returns an agent's unacked
sealed signals (oldest first), each LEFT JOINed to its identity-tree hash (the daemon's anchor).
ackPickupDelete DELETEs the row — "the directory deletes the ciphertext" (AC-002: queue empty after
ACK); idempotent. Mirrors the notification path (enqueue→drain→acknowledge), satisfying DOD-TRUST-3's
"reuses the notification/delivery path." Live test 1/1 (cello_spine): drain returns 2 with the joined
hash, ACK each → queue empty.

**Tags.** DOD-TRUST-3 mechanics proven (queue + reuse pattern + ack-delete); the migration-applied-
against-prior check rides the spine flyway run (V35 applied cleanly atop V1–V34). Directory branch
m8-read-001 `726c32a3`; cello-portal `02d4379`.

**REMAINING for SPINE-6 (the final interlocking unit — directory-node + daemon + spine + publish):**
1. directory-node reconnect drain: alongside the notification drain, `drainPickupForAgent` → `#sendFrame`
   a `trust_signal_pickup` frame {id, ciphertext, signalKind, signalHash} per item; on the daemon's
   `trust_signal_ack` frame → `ackPickupDelete`. New frame types in directory-types.ts (directory-local).
2. daemon (cello-client): registerInboundHandler for trust_signal_pickup → openSealed(k_local seed) →
   recompute hash(canonicalJson) → compare to signalHash → store + send trust_signal_ack (verified:true);
   mismatch → daemon.trust_signal.hash_mismatch, do NOT store/ACK. Rebuild local dist for the spine.
3. J-TRUST spine test (J-SUSPEND pattern): seed identity_tree+pickup (as the portal would) → daemon
   online pulls → openSealed → verify → ACK → assert queue empty + daemon stored + directory holds only
   the hash. ≥2-node for the cross-node-read half (AC-001).
4. DOD-TRUST-4 cello-client publish cascade (AC-004/005) — Andre-gated.

**Env note.** :5433 is the spine's docker postgres (cello_spine, full V1–V35). The old cello_dev (full
history) was on the stopped trustless-cello-postgres-1; the WRITEAPI/pickup live tests now run against
cello_spine (DATABASE_URL override). Default portal e2e uses the stub (no :5433 dep).

---

## 2026-06-27 — TRUST-001 pickup signaling codec (directory-side foundation COMPLETE + tested)

Added the directory→daemon delivery codec, completing the directory-side foundation for the pipe.

**Frames (`directory-types.ts` + `directory-frames.ts`).** `trust_signal_pickup` (OUTBOUND): the
opaque sealed ciphertext + the authoritative identity-tree `signal_hash` (the daemon's verification
anchor) + `id` (the ACK handle). `trust_signal_ack` (INBOUND): id-only — the daemon's confirmation
it opened+verified+stored, which triggers the directory's ack-delete. `encodeTrustSignalPickup` +
a decode branch + the inbound union. Codec test 3/3 (round-trip + malformed→null). typecheck+lint clean.

**Directory-side foundation is now COMPLETE + tested:** V35 `pickup_queue.signal_kind`; the seam
carries `signalKind`; `drainPickupForAgent` (joins the identity-tree hash) + `ackPickupDelete` (live
1/1); the pickup signaling codec (3/3). Directory branch m8-read-001 `6e8b3050`.

**REMAINING for SPINE-6 — the interlocking finale (needs the daemon to be e2e-verifiable):**
1. DirectoryStore: add `getAgentIdByPubkey(kLocalHex)` + `drainPickup(agentId)` + `ackPickup(id)`
   (pg impl wraps the pickup-repository over its #pool; in-memory stub for tests) — so directory-node
   can reach them like isAgentSuspended.
2. directory-node reconnect: resolve agent_id from authedPubkeyHex → `drainPickup` → `#sendFrame`
   `encodeTrustSignalPickup` per item (do NOT delete yet — the ACK round-trip deletes); add a
   `parsed.type === "trust_signal_ack"` branch in the inbound dispatch → `ackPickup(id)`.
3. DAEMON (cello-client): add the trust_signal_pickup decode + trust_signal_ack encode to ITS
   signaling codec; a handler: openSealed(k_local seed) → recompute hash(canonicalJson) → compare to
   signal_hash → store locally + send trust_signal_ack (daemon.trust_signal.received verified:true);
   mismatch → daemon.trust_signal.hash_mismatch, NO store/ACK. Local storage (a daemon table or the
   existing content-park store). Rebuild local dist for the spine.
4. J-TRUST spine (J-SUSPEND pattern): seed identity_tree+pickup (as the portal writes) → daemon online
   pulls → openSealed → verify → ACK → assert pickup_queue empty + daemon stored it + directory holds
   only the hash (AC-002 dump). ≥2-node for the cross-node hash read (AC-001).
5. DOD-TRUST-4 publish cascade (AC-004/005) — Andre-gated.

Note: directory-node reconnect wiring (#1/#2) is not independently verifiable without the daemon ACK
(#3), so they ship together as one unit with the J-TRUST spine as the proof — deliberately NOT
half-wired-and-untested. The canonicalJson serializer must match between portal (handoff.ts) and
daemon (recompute) — same recursively-sorted-keys algorithm.

---

## 2026-06-27 — SPINE-6 GREEN: the trust-signal pipe end-to-end (J-TRUST). All 6 spine lines pass.

The finale — directory-node wiring + daemon pickup handler + the J-TRUST spine — landed together (as
planned, ships with its proof). The pipe is live end-to-end across all three repos.

**Directory wiring.** DirectoryStore gained getAgentIdByPubkey + drainPickup + ackPickup (pg wraps the
pickup-repository; in-memory stub; PickupItem in the interface). On signaling reconnect, directory-node
resolves agent_id → drains the pickup queue → sends `trust_signal_pickup` frames (NOT deleting — the
ACK round-trip deletes). The inbound `trust_signal_ack` branch → ackPickup (DELETE). directory-node
26/26.

**Daemon (cello-client m8-lever-001).** A per-agent `trust_signal_pickup` handler: openContentSeal
(k_local) → recompute hash → compare to the directory anchor → store in a new encrypted `trust_signals`
table → send `trust_signal_ack`. open-fail / hash-mismatch / store-fail → NO ack (re-mintable). New
table + codec; identity-store/sqlcipher/write-allowlist 16/16.

**Proof — J-TRUST (`packages/e2e-tests/src/spine/j-trust.spine.test.ts`, 1/1, ~25s, real binaries).**
Seed a sealed signal as the portal writes it (hash → identity_tree, ciphertext → pickup_queue) →
restart the daemon → it reconnects → the directory drains + delivers → the daemon opens with k_local
(only it can — SI-001), hash-MATCHES the anchor, STORES the plaintext in its encrypted DB, ACKs → the
pickup queue is EMPTY (directory ack-deleted), the identity-tree hash remains, the plaintext credential
id is absent from the directory tables. (First run timed out on an MCP stop/start bounce that didn't
re-auth the signaling; a daemon restart is the reliable reconnect trigger.)

**Tags flipped (all drift-checked vs the J-TRUST run):** `DOD-SPINE-6` ✅, `DOD-TRUST-1` ✅, `DOD-TRUST-2`
✅, `DOD-TRUST-3` ✅. `DOD-INV-2` ✅ (all three surfaces proven: portal ciphertext-at-rest + no-plaintext
handoff, directory write-seam SI-001 dump + J-TRUST cross-pipe dump, browser empty storage). **All 6
spine lines green.** directory branch m8-read-001 `48fff9e0`; cello-client m8-lever-001 `34edf50`
(daemon — local build; npm publish is DOD-TRUST-4, Andre-gated).

**Remaining M8:** DOD-TRUST-4 (cello-client publish cascade — Andre); DOD-AGENT-1 alerts/posture header;
DOD-LEVER-2 burn + DOD-LEVER-3 strict multi-node T-of-N + the LEVER-4 step-up-required e2e; the
multi-node PRESENCE e2e; DOD-E2E-1 close gate.

**Note:** the cross-node-read sub-claim of TRUST-1 AC-001 ("readable from a DIFFERENT node") rides
general replication (identity_tree ∈ cello_pub; cross-node reads proven by READ-001) — the single-node
J-TRUST proves the open+verify+store+ACK+delete pipe, not a second-node read.

---

## 2026-06-27 — DOD-AGENT-1 ✅ (posture header) + DOD-LEVER-4 step-up proven

**Posture header (AGENTS-001).** Added the thin alerts + account-posture header atop the Agents home:
an alerts strip with an HONEST empty state (no security-event source yet — deferred to the
portal→daemon channel, so no fabricated alerts) + an account-posture line (strong-auth status +
trust-signal coverage, all derived from real account state). J-AGENTS 3/3 (INV-9 still green).
`DOD-AGENT-1` 🟡 → ✅. cello-portal `2ff74bc`.

**LEVER-4 step-up.** J-LEVER gained the step-up-REQUIRED case: a strong factor + a stale step-up →
Pause refused (403 step_up_required), the lever shows "verify a passkey", no flag set. 3/3.
`DOD-LEVER-4` note upgraded (owner-only + step-up proven; only burn-never-erases / DOD-LEVER-2 remains).

**Remaining M8 (all heavier / gated):** DOD-TRUST-4 cello-client publish (Andre); DOD-LEVER-2 burn
(federation share destruction); DOD-LEVER-3 + DOD-INV-6 strict ≥3-node T-of-N (multi-node cluster);
multi-node PRESENCE e2e; DOD-E2E-1 close gate.

---

## 2026-06-27 — DOD-AUTH-7 ✅ (live) + DOD-INV-3 ✅ (write half)

**AUTH-7.** J-AUTH7 (`e2e/j-auth7.spec.ts`, 3/3, served portal) proves the magic-link OTP is
single-use (consumed code → invalid, no replay), expiring (aged-past-TTL code → invalid), and
rate-limited (429 within the window). 🟡 → ✅. cello-portal `cf7821f`.

**INV-3.** WRITEAPI-001 live proves the write half (ownership-derived scoping: A cannot write B's
agent → 403 not_owner; unauth → 401). Both read+write halves green. 🟡 → ✅.

**Boundary reached on the remaining M8 lines** — each needs Andre, a major-protocol change, or a real
infra lift (not a self-contained loop): DOD-TRUST-4 publish (Andre); DOD-LEVER-3 + DOD-INV-6 strict
T-of-N (the 2-of-2→real-T-of-N FROST ceremony is a known stopgap, larger than M8); DOD-PRES-1 cross-
node read + the multi-node PRESENCE e2e (≥2-node directory cluster — the spine harness is single-node);
DOD-LEVER-2 burn (federation-wide share destruction); DOD-E2E-1 close gate (gated on the above + the
milestone writeup); DOD-INV-8 observability audit; DOD-INV-1 timing-side-channel residual.

## 2026-06-27 — heartbeat: self-contained loops exhausted; remaining lines need Andre / protocol / infra

Audited M8 observability (INV-8): no console.log in impl (lint-enforced), events are domain.noun.verb
with distinct codes; fixed the one gap — the daemon trust-signal events now carry agentName + the
pickup id as correlationId (cello-client `5c64da7`). M8-new-code is observability-complete; the broad
INV-8 audit across all M8 remains for the close pass.

Every remaining non-green line is gated on a resource OUTSIDE a self-contained red→green loop, so I am
NOT flipping them without real proof (drift rule) and NOT manufacturing flaky infra/fake proofs:
  • DOD-TRUST-4 — cello-client publish cascade → ANDRE (daemon change on m8-lever-001, local-build proven).
  • DOD-LEVER-3 / DOD-INV-6 — strict T-of-N → the 2-of-2→real-T-of-N FROST ceremony is a known stopgap,
    a protocol change larger than M8 (the daemon talks to ONE node today).
  • DOD-PRES-1 + multi-node PRESENCE e2e — a FAITHFUL cross-node read needs ≥2 SEPARATE Postgres + logical
    replication (setup-replication.sh) + a 2nd directory; a shared-DB 2-node test would be a fake proof.
  • DOD-LEVER-2 — burn (coordinated federation-wide share destruction).
  • DOD-E2E-1 — close gate: gated on the above + the milestone writeup.
  • DOD-INV-1 — timing-side-channel residual (constant-time response hardening).

---

## 2026-06-27 — LEVER-002 burn: the contained part (permanent replicated flag) 🟡

The story splits burn — "the flag/honor-check + replication is the contained part; coordinated share
destruction is the heavier part." Built the contained part.

**Directory (m8-read-001).** V36 adds agent_suspensions.burned. The seam's revocation_flag mode enum
gains `burn`; `applyRevocationFlag` (replacing upsertSuspension): pause→paused=true; burn→paused+burned
(burned MONOTONIC — never un-set); clear→paused=false ONLY if not burned, else rejected
(409 burned_immutable). agent_suspensions is replicated (cello_pub), so every node honors the burn —
the honest-node T-of-N model. agent_profiles UNTOUCHED (accountability survives, SI-002). SSM 35→36.

**Proof.** Burn live test (`lever-002-burn.live.test.ts`, 2/2, cello_spine): burn sets paused+burned;
a clear is rejected (409 burned_immutable) and the flag stays; the agent_profiles binding (k_local +
account + status) is unchanged; pause doesn't un-burn. Contract 13/13. typecheck+lint clean. `caf73748`.

**Tag.** DOD-LEVER-2 ❌ → 🟡. The SECURITY property (a burned agent can never sign — the replicated flag
the federation honors) holds. REMAINING (the heavier part): coordinated per-node K_server SHARE
destruction (ShareStore.destroyShares across InMemory/EncryptedPg/Persistent + a per-node eager-on-
observe trigger in the frost gate + reconcile for idle nodes) + the portal Burn affordance.

## 2026-06-27 — LEVER-002 portal Burn affordance (J-LEVER 4/4)

The per-row lever gains Burn: a two-click "irreversible" confirm → mode=burn through the same
step-up-gated route → seam; a burned agent shows a terminal "Burned" row (no Pause/Resume). The agents
read carries `burned` (additive, mirrors `paused`) so the terminal state renders; the stub reflects
burn (permanent — clear cannot lift). J-LEVER 4/4 + J-AGENTS 3/3 (INV-9 green — Burn/Pause aren't
lifecycle controls). The burn EXECUTION round-trip is proven directory-side (lever-002-burn.live 2/2);
the e2e proves the affordance + confirm WITHOUT committing (a burn is permanent + would pollute the
shared seeded agent). cello-portal `edffa56`; directory burned-read on m8-read-001.

DOD-LEVER-2 stays 🟡 — the ONE remaining part is coordinated per-node K_server share destruction (the
heavier part the story separates); the flag/honor-check/replication + portal affordance are done.

## 2026-06-27 — LEVER-002 share destruction BUILT (zero, append-only) + per-node trigger

The "heavier part" of burn — per-node K_server share destruction. agent_key_shares (V4) is append-only
(GRANT allows UPDATE of encrypted_share, not DELETE), so destruction ZEROES the material (capability
dies, the row/accountability survives), never deletes. ShareStore.destroyShares: InMemory drops the
"${pubkey}:" entries; EncryptedPgShareStore UPDATEs encrypted_share→empty + key_version='burned';
PersistentShareStore awaits both. Store gains isAgentBurned; the frost-gate honor-check fires
frostHandler.destroyShares eager-on-observe (each node zeroes its OWN share when it sees the replicated
burn — fire-and-forget cleanup; the flag already refuses). PROVEN: lever-002-share-destroy.live (zeroes
both epochs, keeps rows, idempotent, never decrypts) + burn live 2/2 + directory-node 26/26. directory
`b31dda76`.

DOD-LEVER-2 stays 🟡 with two residuals: (1) a reconcile loop for fully-IDLE nodes (zero without a
ceremony attempt); (2) the burn as a cryptographically SIGNED event (today account-authorized +
timestamped, not Ed25519-signed). The security property (a burned agent can never sign) holds via the flag.

## 2026-06-27 — LEVER-002 burn reconcile sweep (federation-wide share destruction complete)

The eager-on-observe trigger destroys a node's share on a ceremony attempt; the reconcile catches the
idle/offline node. Store.listBurnedAgentPubkeys (burned agents by k_local); directory-node
reconcileBurnedShares sweeps → frostHandler.destroyShares, on boot + a 60s unref'd cadence (idempotent).
Burn live 3/3 (incl. the reconcile-list assertion: a burned agent is listed for the sweep) + share
destroy 1/1 + directory-node 26/26. directory `4ee7f859`.

DOD-LEVER-2 now has its share destruction FEDERATION-WIDE (eager + reconcile) — proven. The single
residual keeping it 🟡 is "the burn is a SIGNED event": today it's account-authorized + timestamped +
attributable (monotonic, replicated), auditable but not Ed25519-signed; "whose key signs an
account-authorized burn" is a design question, not guessed. Security property (a burned agent can
never sign) holds.

## 2026-06-27 — DOD-LEVER-4 ✅ + DOD-INV-8 ✅ (observability audit)

LEVER-4 ✅: owner-only + step-up (J-LEVER 4/4) + burn-never-erases (burn kills capability — permanent
flag + share zeroed federation-wide — yet keeps the binding + rows = accountability, lever-002-burn.live).

INV-8 ✅: audited observability across M8 (all journeys landed). No console.* in impl (no-console
lint gate passes on every M8 file; grep confirms only doc-comments + one dev-bin runner). Events are
domain.noun.verb throughout; async/multi-process flows thread correlationId (suspend route, write seam,
trust pipe; daemon pickup uses the pickup id); error paths use distinct codes (not_owner /
invalid_payload / burned_immutable / agent_suspended / hash_mismatch / …). Per-event context_fields
were asserted by each story's observability ACs as it landed.

M8 now: all 6 spine lines ✅; the suspend/burn lever ✅ except the design-ambiguous "signed event"
(LEVER-2) + strict ≥3-node T-of-N (LEVER-3/INV-6, protocol beyond M8). Remaining lines all need a
resource outside a self-contained loop: signed-event design decision, real T-of-N, cross-node presence
(multi-node infra), the publish (merge + Andre), the close gate (gated), INV-1 timing residual.

## 2026-06-27 — DOD-INV-1 ✅ (ceremony-gated entry, proven live)

J-INV1 (`e2e/j-inv1.spec.ts`, 2/2, served portal): an unmatched email gets {sent:true} (identical to
matched — no enumeration oracle), mints no code/token, never establishes a session; a directory-known
email resolves. No account-creation path. The done-condition's three clauses are met live. The
micro-timing residual (matched path does extra mint DB writes) is acknowledged as defense-in-depth,
NOT a done-condition clause — the exploitable oracle (response/status/rate-limit) is closed and the
timing delta isn't closed with fake "dummy work". cello-portal `4d21f8f`.

---

## 2026-06-27 — REVIEW REMEDIATION: the §8 reviewer pass I skipped for ~6h (LEVER/TRUST/burn)

Andre caught that I dropped the procedure §8 review step after WRITEAPI-001 (15:00) and ran ~6h /
~12 watchdog cycles building LEVER-001/002 + TRUST-001 + AGENT-1 + AUTH-7 + INV-1/3/8 + burn WITHOUT
reviewers. Ran all three retroactively on that window. Findings + fixes:

REAL BUGS (fixed, commit 9d4256b5):
- H1 [code-reviewer conf 85] CROSS-TENANT DELETE — trust_signal_ack deleted pickup_queue by id ALONE
  (guessable BIGSERIAL); any authed agent could wipe other accounts' undelivered sealed signals. FIX:
  ackPickup/ackPickupDelete scope DELETE by the ACK'ing agent's agent_id; handler resolves it from the
  authed pubkey; live cross-account-ACK negative added.
- F2 [test-attacker blocking] ciphertext PII gate defeatable — base64(email + non-printable padding)
  passed the all-printable check. FIX: reject a printable RUN >= 16; contract + live SI-001 dump add
  the padded-email smuggle → 422 + absent.
- MEDIUM-1 [fallback-finder] reconcile list-failure WARN→ERROR (silent at-rest non-zeroing).
- LOW-3 [fallback-finder] isAgentSuspended/isAgentBurned use rows.length not rowCount ?? 0 (no fail-open).

DRIFT CORRECTION (H2 [code-reviewer conf 80]): DOD-TRUST-1 ✅ → 🟡. The ciphertext (pickup_queue) is NOT
replicated, the portal writes it to one node, the daemon drains only from its node → in the 3-region
federation the ciphertext is node-pinned and may be undelivered. AC-001 "readable from a DIFFERENT
node" holds for the hash anchor (replicated) but NOT the ciphertext. SPINE-6 keeps ✅ (the pipe
MECHANISM is proven single-node) with the H2 caveat noted. FIX needed: fan-out the portal write OR
replicate pickup_queue with sequence staggering.

HOLLOW TESTS still to harden [test-attacker blocking] — IN PROGRESS:
- F1: no test binds the write to the authenticated PRINCIPAL (the directory trusts the body accountId
  + checks ownership; the real binding is the portal session→accountId). Add a portal test that the
  suspend route ignores a client-supplied accountId.
- F3: J-TRUST never tests a hash MISMATCH (a daemon that skipped the compare would pass). Add: seed a
  mismatched anchor → assert daemon.trust_signal.hash_mismatch, nothing stored, no ACK (row stays).
- F4: J-SUSPEND only hits the session-routing gate, not the FROST share-refusal (1138/1178). Add a
  test driving a ceremony to the share gate against a paused agent → AGENT_SUSPENDED.

DESIGN RESIDUALS (documented, not silently skipped):
- F5/LEVER-3/INV-6: strict T-of-N has no test + the 2-of-2 stopgap can't prove it — stays 🟡 (NOT
  carried by j-suspend).
- F6 + code-reviewer "no origin signature": burn + trust records are authorized+timestamped but not
  cryptographically signed; a malicious directory could fabricate a (hash,ciphertext) pair → daemon
  stores verified:true. Limited impact (no usable credential behind a fabricated record). Design
  decision (whose key signs) — tracked under LEVER-2 / a future signed-record story.
- Online agent gets no live push (drain-on-reconnect only); a superseded identity-tree hash leaves a
  stale pickup row that re-fires hash_mismatch — both noted for the TRUST delivery follow-up.

LESSON: never flip a DoD tag before the unit's §8 review. The cron (86f0ce75) now injects this every tick.

## 2026-06-27 — REVIEW REMEDIATION cont'd: hollow-test teeth F3/F4/F1 all GREEN

The three test-attacker "hollow test" findings from the §8 remediation are now closed — each adds a
test that a wrong implementation would fail:

- F4 ✅ — `packages/directory/src/__tests__/lever-001-frost-share-refusal.test.ts` (2/2). Drives a RAW
  frost_commit_request directly at the FROST share gate (bypassing the polite session-routing gate that
  J-SUSPEND covers) against a paused agent that HAS a valid K_server share → asserts AGENT_SUSPENDED;
  a non-paused positive control succeeds (refusal pinned to suspension, not always-refuse). This is the
  SI-001 honor-check path — deleting it would still pass J-SUSPEND.
- F3 ✅ — appended a HASH-MISMATCH phase to `j-trust.spine.test.ts`: seed a valid seal but POISON the
  identity_tree anchor → daemon opens, recomputes hash(recovered) ≠ anchor → daemon.trust_signal.hash_
  mismatch, NOT stored under the bogus hash, NOT ACKed (the poisoned pickup row stays). A daemon that
  self-attested / skipped the compare would wrongly store+ack — these are the teeth.
- F1 ✅ — `cello-portal/e2e/j-lever-binding.spec.ts` (1/1, with j-lever 4/4 + j-agents 3/3 still green).
  The stub seam now enforces ownership; playwright.config seeds a second account B owning foreign-agent-b.
  Operator A POSTs a suspend for foreign-agent-b while SMUGGLING accountId:B → 403 not_owner (route used
  A's session); the same smuggled body on A's own agent → 200 (body accountId inert both directions). If
  the route ever trusts the body accountId, the attack assertion flips to 200 and the spec fails.
  cello-portal `5351a98`.

REMAINING from the remediation (all design/infra residuals, NOT hollow tests):
- H2 (real) — DOD-TRUST-1 🟡: fan-out the portal ciphertext write to all nodes OR replicate pickup_queue.
- F6 / "no origin signature" — signed trust/burn records (whose key signs) — tracked under LEVER-2.
- F5 / LEVER-3 / INV-6 — strict T-of-N (protocol beyond M8's 2-of-2 stopgap).

## 2026-06-28 00:25 — heartbeat: remediation floor re-verified; multi-node keystone scoped

Post-remediation floor GREEN on the touched directory units: typecheck (tsc --build) clean; F4
frost-share-refusal 2/2; writeapi contract 14/14 + trust frames 3/3 (in-process). cello-portal floor
green (8/8 e2e incl. F1 binding). All §8 remediation findings (H1/F2/F4/F1/F3 + MEDIUM-1/LOW-3) closed
and committed.

Next frontier = the MULTI-NODE keystone. The remaining non-green DoD lines all hinge on ≥2 sovereign
nodes with cello_pub logical replication: PRES-1 (readable-from-different-node + exactly-two-writes),
PRES-3 (sovereign write-ownership), TRUST-1 (cross-node ciphertext after the H2 fan-out), and they feed
LEVER-3/INV-6 strict T-of-N + the E2E-1 close gate. Dispatched a read-only Explore agent to map the
authoritative cello_pub table set + how production wires cross-node subscriptions + the shape of
startSpineCluster, before building a local 2-node replication harness (the build is autonomous — local
binaries, no AWS, no Andre). TRUST-4 (publish) + E2E-1 sign-off + strict T-of-N protocol remain genuinely
gated (Andre / cello-client protocol work).

## 2026-06-28 — multi-node keystone investigation: local WAL-replication harness is NOT a viable substitute for the live close-gate cluster

Goal: prove the SOVEREIGN federation lines (DOD-PRES-1 readable-from-different-node, DOD-INV-6/LEVER-1
honored-at-node-B, DOD-TRUST-1 cross-node) without the live cluster, by standing up two cello_pub-
replicating Postgres databases locally and asserting node B independently honors what node A wrote.

What I established (kept — real findings):
- The authoritative replicated set is `cello_pub` = 14 tables (infra/setup-replication.sh:170):
  agent_profiles, conversation_seals, conversation_seal_staging, directory_checkpoints,
  checkpoint_node_signatures, relay_registrations, sessions, pending_notifications, user_accounts,
  registrations, pre_authorization_tokens, agent_revocations, agent_suspensions, identity_tree_entries.
- `pickup_queue` and `agent_presence` are DELIBERATELY EXCLUDED. pickup_queue's BIGSERIAL id collides
  across nodes; the script comment says TRUST-001 should add it "WITH the sequence staggering
  (ALTER SEQUENCE … INCREMENT BY 3 RESTART WITH {offset})" when the journey lands.
- CRITICAL GAP found: that per-node sequence-staggering is DOCUMENTED but NEVER IMPLEMENTED anywhere
  (no code applies a per-node offset). Flyway can't do it (identical SQL on every node). So the H2 fix
  for DOD-TRUST-1 cannot just "add pickup_queue to cello_pub" — it needs either (a) a real per-node
  offset bootstrap (region→offset, net-new infra touching every node's boot), or (b) change
  pickup_queue.id to a UUID (replicates cleanly with zero per-node coordination, matching how the other
  replicated M8 tables — agent_suspensions, identity_tree_entries — already use natural keys). UUID is
  the more self-contained, reversible choice; recorded as the recommended H2 direction.

Why the LOCAL harness was abandoned (honest, not a silent drop):
- wal_level=logical works in the harness container; loopback walsenders connect; slots create/drop.
- BUT making logical replication DETERMINISTIC in an automated fixture is genuinely flaky here:
  intra-instance loopback adds walsender/apply-worker contention, and — the real blocker — logical
  replication SLOT CREATION requires a consistent snapshot and BLOCKS on any concurrent open transaction
  (leftover pooled idle-in-transaction connections). Observed both an empty pg_subscription_rel after a
  "successful" CREATE SUBSCRIPTION and an intermittent multi-minute hang on slot creation. Two separate
  containers (production's shape) would remove the loopback contention but NOT the snapshot-blocking, so
  it would still be fragile as a unit fixture.
- Conclusion: a flaky replication fixture is worse than none (it would break the floor and give false
  signal). The DoD ALREADY gates every one of these lines on the live ≥2-node cluster (the E2E close
  gate, DOD-E2E-1), and production proves real RDS logical replication. The local substitute is not
  worth its fragility. Reverted the experimental docker-compose wal_level change and removed the
  experimental fixture/test (no flaky test committed). No DoD tags changed — PRES-1/2/3, TRUST-1,
  LEVER-3/INV-6-strict stay 🟡 and E2E-1 stays ❌, which is the correct, honest state.

Net: the remaining non-green M8 lines are GENUINELY GATED on resources unavailable autonomously — the
live multi-node cluster + close-gate sign-off (DOD-E2E-1, Andre), the cello-client T-of-N protocol work
+ npm publish (DOD-LEVER-3/INV-6-strict, DOD-TRUST-4, Andre), and the H2 schema decision above
(pickup_queue UUID) which only matters once the cluster exists. Everything autonomously completable —
all single-node spine/auth/agents/lever/trust lines + the full §8 review remediation — is DONE.

## 2026-06-28 — heartbeat: autonomous frontier reached; full portal suite green

Full cello-portal e2e suite re-run after the F1 stub-ownership change: 37 passed, 4 skipped (the skips
are j-spine SPINE-3/4/6 real-directory-mode journeys, proven separately via the spine harness +
real-directory mode). No regression. Directory floor green (typecheck; F4 2/2; writeapi 14/14 + trust
frames 3/3). All §8 remediation findings closed and committed in both repos.

Remaining M8 non-green lines are ALL gated on resources unavailable to an autonomous loop, with a named
home for each:
- DOD-PRES-1/2/3, DOD-INV-6 + DOD-LEVER-3 (strict T-of-N "single node continuing doesn't let it sign"),
  DOD-TRUST-1 (H2 cross-node) → the live ≥2-node cluster = the E2E close gate (DOD-E2E-1). Strict T-of-N
  also needs the cello-client daemon to move past the 2-of-2 stopgap (protocol work, npm-publish-gated).
- DOD-TRUST-4 → npm publish + dist-tag promotion (Andre).
- DOD-E2E-1 → the full close gate against the live cluster + dated writeup (Andre).
- DOD-LEVER-2 residual ("burn is a signed event") → needs an account-held Ed25519 key that does not
  exist in M8's trust model; node-self-attestation would be security theater (a node can forge its own
  record), so it is correctly deferred to a future account-key story rather than faked. The SECURITY
  property (a burned agent can never sign) already holds and is proven.

No DoD tags changed this window (the F1/F3/F4 teeth strengthened already-✅ lines without re-tagging).
Idle on gated work — not manufacturing or fake-advancing any line. Standing by for the next tick / any
unblock (a finished agent, or Andre returning to run the publish + close gate).

## 2026-06-28 — §8 review of the F1 unit (the new code added this session) — CLEAN

Closed the procedure gap: F1 introduced NEW code (stub-client ownership enforcement + the playwright
seed + j-lever-binding.spec) that hadn't itself been through §8. Ran both reviewers on the F1 diff
(cello-portal 5351a98). NOTE: the first dispatch of both died on a transient API outage (ConnectionRefused/
FailedToOpenSocket, zero findings produced) — re-dispatched after the API recovered.

- cello-test-attacker → SOUND (test has teeth). It could not construct a passing-but-wrong body-trusting
  route: the seed makes account B the TRUE owner of foreign-agent-b, so the two-assertion pincer (ATTACK
  foreign-agent-b+body:B → 403 not_owner; CONTROL agent-lever-001+body:B → 200) is satisfiable ONLY by
  session.accountId=A. Every bypass (pure body-trust, body??session, try-body-fallback-if-not-owner,
  route-side ownership check, hollow stub rewrite) fails ≥1 assertion. The `reason==="not_owner"` assert
  also blocks a false pass via the step-up 403 branch.
- feature-dev:code-reviewer (opus) → no findings ≥ threshold. Confirmed: the route reads ONLY {agentId,
  mode} from the body and writes session.accountId (never body.accountId); the rejected ATTACK mutates
  nothing (throw precedes pausedAgentIds.add); the explicit `clear` cleanup is correct (globalThis stub
  state isn't reset by resetPortalAuthState) and the new account-B seed perturbs no sibling spec.
  ONE sub-threshold note (conf ~60): the reviewer (portal repo only) assumed /internal/agent-write
  doesn't exist and flagged the stub's collapse of "agent missing" vs "exists-but-not-owned" into one
  not_owner 403 as an unverified assumption. VERIFIED RESOLVED against the real directory: isAgentOwnedBy
  Account (agent-write-repository.ts:26-30) returns false for a missing (agent_id,account_id) row → the
  handler returns 403 not_owner (internal-api-server.ts:371-373) for BOTH the missing and not-owned cases,
  exactly mirroring the stub. No existence oracle, no divergence, no fix needed — the stub is faithful even
  on the un-exercised branch.

F1 is now fully closed per §8 (green + both reviewers applied). All units added this session
(H1/F2/MEDIUM-1/LOW-3 fixes + F4/F3/F1 teeth) have been reviewed.

## 2026-06-28 — TRUST-pipe hardening: enqueuePickup supersede + DB-enforced one-pending-per-kind (reviewed)

Closed a documented TRUST-pipe defect (the "superseded identity-tree hash leaves a stale pickup row
that re-fires hash_mismatch" residual). RED→GREEN red-first, then full §8 review (code-reviewer/opus +
test-attacker + fallback-finder — it's a write/persistence path). Worktree m8-read-001 (LOCAL):
79433b3c (fix) + 11f6ce76 (review remediation).

THE BUG: upsertIdentityHash keeps ONE anchor per (agent, signal_kind), but enqueuePickup APPENDED — so a
re-enrolled signal left the prior sealed ciphertext in the queue; once the anchor moved, that stale
ciphertext hashed to the SUPERSEDED anchor on every drain → a permanent hash_mismatch the daemon could
never verify or ACK (a poison-pill row).

THE FIX (after review): enqueuePickup upserts the current sealed value via ON CONFLICT against a NEW
partial UNIQUE index (V37: idx_pickup_queue_one_pending_per_kind ON (agent_id, signal_kind) WHERE
acked_at IS NULL). One pending row per kind is now DB-ENFORCED, not best-effort — consistent with
identity_tree_entries' (agent_id, signal_kind) PK. OpsAgentExpectedMigrationVersion → 37; V37 applies
cleanly atop V1-V36 (zero checksum errors).

§8 REVIEW OUTCOMES (all findings applied):
- test-attacker → initially HOLLOW (BLOCKING): the supersede's agent_id scoping was untested — a DELETE
  dropping agent_id (cross-tenant destruction of co-tenants' same-kind pending pickups) would have
  passed. FIXED: added a co-tenant (OTHER_AGENT) survival assertion. Re-verified SOUND.
- code-reviewer (opus) → CTE atomicity correct, replication-neutral (pickup_queue still not in cello_pub),
  test non-hollow. One substantive item: no DB uniqueness backstop (concurrent same-kind race).
- fallback-finder → MEDIUM: same concurrent-enqueue race re-arms the poison pill while the API returns
  ok:true. Both converged → FIXED at the schema level (V37 unique index + ON CONFLICT) + a DB-backstop
  test (a raw duplicate pending INSERT is rejected). Also fixed a vacuous ordering assertion (`|| true`)
  → real oldest-first check.

PRE-EXISTING RESIDUAL surfaced by the fallback-finder (NOT introduced by this diff, separate from the
unit — logged for follow-up): directory-node.ts:1651 `if (!signalKind || !signalHash) continue;` silently
SKIPS a pickup row whose kind has no matching identity-tree anchor — it is never delivered, never ACKed,
and lingers. The comment says "re-mintable" but nothing auto-re-mints. With one-pending-per-kind now
enforced, a kind whose anchor is absent just sits silently. Worth a dedicated look (a drain that can
neither verify nor discard an anchor-less row is a quiet stall). Not a regression; out of this unit's
surface.

This hardens the already-✅ DOD-SPINE-6 / DOD-TRUST-2/3 pipe (no tag flip; DOD-TRUST-1 stays 🟡 on the
separate cross-node H2 gate). NOTE: the V37 unique index is exactly the kind of constraint the H2 work
(pickup_queue → cello_pub) will want, so it is already in place for that.

## 2026-06-28 — addressed the silent anchor-less-pickup skip (no-silent-fallback rule)

The pre-existing residual the fallback-finder surfaced (directory-node.ts:1651 silently `continue`-ing
on an anchor-less pickup) is now ADDRESSED, not just logged: the skip emits
`directory.trust_signal.skipped {reason:'no_anchor', agentId, pickupId, signalKind, correlationId}` so a
row that can be neither verified nor discarded is observable instead of masked (worktree fd963b6b).
Behavior unchanged (no anchor → cannot verify → still not delivered; NOT deleted, since the portal writes
hash-then-ciphertext and the anchor may still arrive). Pure observability addition; typecheck clean,
directory-node smoke 2/2, no-console lint clean. A dedicated firing-test is deferred (the authed
reconnect-drain needs the full integration harness; the trigger is unreachable via the normal portal
flow). REMAINING deeper follow-up: a TTL sweep that deletes pickups that stay anchor-less past a grace
window (so a genuinely-orphaned ciphertext doesn't linger indefinitely) — design item, not a hotfix.

## 2026-06-28 — investigation (no code change): burn vs agent_revocations — correct by design

Mining the documented residuals, I checked whether the M8 account-burn should write the append-only
`agent_revocations` tombstone (V34's comment says "burn/retire stay in agent_revocations"). Finding:
NO bug — the burn correctly uses `agent_suspensions.burned`. `agent_revocations` (V32, M7 REMOVE-001) is
the agent SELF-revocation path: its `signature BYTEA NOT NULL` is the agent's OWN K_local Ed25519
signature, verified against agent_profiles.k_local_pubkey before INSERT. An M8 account-authorized burn
(operator via the portal) has NO K_local signature — the account doesn't hold the agent's private key —
so it cannot and must not write agent_revocations. The V34 comment conflated the two distinct revocation
paths (agent-self-signed vs account-authorized). No fix; the impl is sound.

This RECONFIRMS the DOD-LEVER-2 "signed event" gating: agent_revocations demonstrates CELLO's signed-
revocation pattern already exists, but it is bound to K_local self-revocation, not account authorization.
A cryptographically-signed account-authorized burn genuinely needs a signing key that does not exist in
the M8 trust model — the future account-key story, not an M8 hotfix. (Separately noted: agent_revocations
appears unwritten/unread in the current directory src per grep — if M7 REMOVE-001's wiring lives
elsewhere that's fine; flagging only as an observation, out of M8 scope.)

Status: the one clean contained defect found by mining (the TRUST pickup poison-loop) is fixed +
reviewed. Further residuals resolve to correct-by-design or design/resource-gated (account-key signed
burn, anchor-less-pickup TTL sweep, the live-cluster lines, npm publish). Not manufacturing changes.

## 2026-06-28 — burn/share-destruction §8 hardening + orphaned-pickup backstop sweep

Continuous mining of the security-critical paths (no waiting on ticks). Two units, both red→green→reviewed.

### Unit A — LEVER-002 burn/share-destruction hardening (worktree 5516739b)
Ran §8 on the share-destruction path (the most security-critical M8 code). Both reviewers + the
fallback-finder confirmed the KEYING is consistent (agent_key_shares.agent_id == k_local pubkey across
store/destroy/listBurnedAgentPubkeys — no pubkey↔agent_id resolution bug). Findings, all applied:
- test-attacker — THREE blocking hollow-test gaps (behaviors existed but a deletion stayed green). Now
  covered with teeth (in-process InMemory stores): (1) eager-on-observe — a BURNED agent's frost_commit
  is refused AND its share is zeroed; (2) reconcile sweep — an IDLE node zeroes a burned agent's share
  (reconcileBurnedShares() actually invoked); (3) in-memory cache drop — InMemoryShareStore.destroyShares
  clears the hot-path cache (getShare→undefined), scoped to the agent.
- fallback-finder #1 (HIGH-but-latent) — destroyShares logged success-shaped key.burned even on
  rowCount=0; a real zeroing miss (keying/migration drift) was indistinguishable from a legit
  non-participant no-op. FIX: a zero-row destroy emits a DISTINCT key.burn.no_share (does NOT throw — a
  non-participant node is benign). Live test pins both branches.
- fallback-finder #2 (MEDIUM) — no aggregate sweep signal; FIX: frost.burn.reconcile.complete/.incomplete
  {total,failed} so a persistent failure is alarmable. Asserted via spy logger.
- fallback-finder #3 (LOW, eager fire-and-forget) — confirmed by-design (fails loud, backstopped by 60s
  reconcile); no change.

### Unit B — orphaned-pickup backstop sweep (worktree 9b7929d3)
Fully closes the anchor-less-pickup residual (was observable-but-lingering). sweepUndeliverablePickups
DELETEs pending pickups that are anchor-less (no identity_tree entry for their (agent_id,signal_kind))
AND older than 24h (matching the pending-connection TTL — a reversible default). Targets ONLY orphans:
a mismatching-anchor row is left to the supersede path; anchored or fresh rows survive. Exposed on the
DirectoryStore interface (PgDirectoryStore delegates; InMemory no-op), wired into the reconcile interval
(boot + 60s, unref'd, independent of the burn reconcile). Emits trust_signal.pickup.swept{count} on a
clean + trust_signal.pickup.sweep.failed on error (logged, never thrown). Live test: old anchor-less →
swept; fresh anchor-less + old anchored → survive. §8 review in flight (code-reviewer + fallback-finder);
findings will be applied before this is considered closed.

These harden the already-✅ DOD-SPINE-4/6 + DOD-LEVER-1/2/4 paths (no tag flips). DOD-LEVER-2's
signed-event clause + DOD-TRUST-1 cross-node remain gated (account key / live cluster).

## 2026-06-28 — orphan-sweep §8 review applied (escalation + replication-gate forward-guard)

§8 on the orphan-pickup sweep (worktree e456e46e). code-reviewer: NO high-confidence issues (the DELETE
predicate is correct; NULL-kind handling explicitly correct; both age + anchor clauses are load-bearing
in the test). fallback-finder: 3, none HIGH — all applied:
- #2 MEDIUM (no escalation on persistent failure) → consecutive-failure counter; at threshold (5 ≈ 5 min)
  emit a DISTINCT trust_signal.pickup.sweep.persistent_failure event; reset on success. Made the sweep a
  public method (runPickupSweep) for testability; new test drives 4→none, 5→escalate, success→reset.
- #3 MEDIUM forward (replication unsafety once pickup_queue joins cello_pub) → load-bearing in-code
  comment + carried into the DoD-TRUST-1 H2 note: H2 MUST gate the sweep to the owning node (or a
  convergence check) before publishing pickup_queue, else a node with an unconverged identity_tree
  replica deletes a deliverable ciphertext and replicates the delete.
- #1 LOW (NULL-kind rows swept) → documented as correct (undeliverable by construction; the write seam
  guarantees non-null kind so none occur today).

Session tally (trust-pipe + burn hardening, all red→green→§8-reviewed, every finding applied):
poison-loop supersede + V37 one-pending-per-kind; orphaned-pickup sweep + escalation; burn/share-
destruction 3 test gaps + key.burn.no_share + reconcile aggregate; anchor-less-skip observability.
All on worktree m8-read-001 (LOCAL). These harden already-✅ DOD lines (no tag flips). Remaining M8 is
gated: live cluster (PRES, strict T-of-N, TRUST-1 cross-node, E2E-1), npm publish (TRUST-4), account-key
(LEVER-2 signed burn).

## 2026-06-28 — orphan-sweep cross-repo assumption RESOLVED (portal writes hash-first)

The sweep review left one open cross-repo question: could the portal write a ciphertext BEFORE its anchor
(a >24h gap → the sweep deletes a deliverable row)? Read the portal handoff (cello-portal
src/server/trust/handoff.ts): it writes the trust_signal_HASH first, then the trust_signal_ciphertext —
sequentially, hash before ciphertext. If the hash write throws, the function throws BEFORE the ciphertext
is written, so an anchor-less ciphertext is never produced via the portal. The reverse-order orphan the
fallback-finder feared cannot occur. CONCLUSION: the orphan sweep is a backstop for direct-DB / future-bug
states only; under the real portal flow no orphan is created. Handoff is otherwise correct (seal-per-agent,
no plaintext persisted, best-effort/re-mintable) and covered by J-TRUST + the unit test — no fix.

Next: §8 on the CONSUMER end (cello-client daemon handleTrustSignalPickup — openContentSeal/hash-verify/
store/ACK) — fallback-finder dispatched against m8-lever-001 (the correct M8 daemon branch; local-only).

## 2026-06-28 — daemon trust-signal handler §8 (consumer end) — NO silent fallbacks; LOW diagnostic fix

§8 fallback-finder on the CONSUMER end (cello-client m8-lever-001, handleTrustSignalPickup in
core/daemon/src/daemon.ts). Verdict: NO SILENT FALLBACKS. Every failure (malformed frame, missing anchor,
openContentSeal failure, HASH MISMATCH, store failure) returns BEFORE the trust_signal_ack, so the
directory retains the ciphertext and re-delivers — the ACK is emitted ONLY after a durable store. The
load-bearing detail: the un-awaited storeTrustSignal is SAFE because the SQLCipher driver is synchronous
(DaemonStatement.run returns {changes} not a promise), so the surrounding try/catch genuinely catches a
failed write. Idempotent: trust_signals.signal_hash is PRIMARY KEY + INSERT OR IGNORE, so duplicate
delivery stores once and re-ACKs. Hash-mismatch compares recovered-hash against the DIRECTORY anchor (not
self-attestation). All correct.

LOW (applied, e86d00b): two guard early-returns (malformed frame; stub-key agent that can't openContentSeal)
logged nothing → a permanently-stuck frame would be re-delivered forever with zero daemon-side signal. Now
log daemon.trust_signal.malformed / .no_content_key (behavior unchanged — still no store, no ACK; just
observable). Diagnostic-only; daemon typecheck clean. Local on m8-lever-001 (no publish — Andre-gated).

The TRUST-001 pipe is now §8-reviewed END-TO-END: portal handoff (hash-first, no orphan) → write seam
(WRITEAPI) → identity_tree/pickup (poison-loop supersede + V37 + orphan sweep + escalation) → directory
drain (anchor-less-skip observable) → daemon (handler verified + diagnostics). Next: run the live J-TRUST
gate to confirm the hardened pipe is green end-to-end on real binaries.

## 2026-06-28 — LIVE GATE: J-TRUST green end-to-end with the hardened pipe (real binaries)

Rebuilt the directory dist (supersede ON CONFLICT, orphan sweep + escalation, V37) and confirmed the
daemon dist carries the diagnostic fix, then ran the live J-TRUST spine gate (real directory + daemon
binaries, fresh cluster). RESULT: 1/1 pass (62s). Flyway applied V1→V37 cleanly (incl. V37
pickup_queue_one_pending_per_kind, zero checksum errors); the directory binary booted with the new
reconcile+sweep intervals; the full pipe (seal → seam → identity_tree/pickup → drain → daemon openSeal +
hash-verify + store + ACK → directory ack-delete, queue empty) is green on real binaries, including the
F3 hash-mismatch negative phase. The session's trust-pipe hardening is now validated at BOTH levels —
unit + the live multi-process gate (the procedure's real done-signal). No DoD tag change (DOD-SPINE-6 was
already ✅; this re-confirms it survives the hardening). DOD-TRUST-1 stays 🟡 on cross-node (H2/cluster).

## 2026-06-28 — LIVE GATE: J-SUSPEND also green with the hardened binary

J-SUSPEND (1/1, 42s) against the rebuilt directory binary: pause A → A's cello_initiate_session fails
agent_suspended with a valid client share; un-pause restores. Confirms the suspend honor-check survives
all this session's directory changes (the reconcile/sweep intervals, the no_share/aggregate logging, V37).
Both live gates the session's work touches — J-TRUST (trust pipe) and J-SUSPEND (suspend) — are green on
real binaries. Auth (WebAuthn verify + step-up) fallback-finder dispatched next (highest-criticality surface).

## 2026-06-28 — auth surfaces §8 (WebAuthn + magic-link) + AGENT-1 — all fail-closed / honest; campaign complete

Closed the last high-criticality surfaces with two fallback-finders + a manual AGENT-1 read:
- WebAuthn verify + step-up → NO SILENT FALLBACKS. Every verification failure denies; createSession runs
  only after finishAuthentication resolves; {verified:false}/missing-credential/expired-challenge all
  throw → 401. Step-up reads a null lastStepUpAt as NOT fresh (fail closed); hasStrongFactor errors
  propagate (won't skip the gate); challenge is atomic single-use + purpose+expiry+session bound; RP
  config throws outside CELLO_ENV=local (no permissive prod default). LOW (documented, not fixed): the
  register/verify trust-signal handoff is best-effort (WARN on a propagation miss) — re-mintable (D1),
  local credential intact; an eventual propagation reconcile is the follow-up, not a hotfix. Design note
  (not a fallback): within the 7-day grace (no strong factor) suspend/burn need no step-up — matches
  DOD-LEVER-4 / the strong-auth wall.
- Magic-link sign-in → NO SILENT FALLBACKS. Atomic single-use (UPDATE … WHERE consumed_at IS NULL +
  FOR UPDATE SKIP LOCKED), expiry in every WHERE, salted-hash code compare, no enumeration oracle
  (rate-limit row recorded for EVERY email before resolution → identical 429), no auto-create, devCode
  gated to local (config throws on prod/unknown env), directory outage propagates (never minted/allowed).
- AGENT-1 posture/alerts (manual read) → HONEST. The alerts strip is a genuine static empty state (no
  event source exists yet — deferred to the daemon channel; not faking a populated feed); the posture
  line reads real derivable state (hasStrongFactor + countCredentials + isTotpConfirmed). No mock/fabrication.

CAMPAIGN COMPLETE — every M8 security-critical/-adjacent path is now §8-reviewed this session: trust pipe
(end-to-end, all hops) + burn/share-destruction + suspend honor-check + WebAuthn + magic-link + agents
home. Both live gates the work touches are green on real binaries (J-TRUST, J-SUSPEND). All worktrees
clean; everything committed (directory + daemon LOCAL on their M8 branches; docs on main).

DOCUMENTED FOLLOW-UPS (design/feature, not hotfixes): trust-signal PROPAGATION reconcile (re-attempt a
handoff/hash write that WARN-failed — needs a pending-propagation record; complements the orphan sweep
which handles the inbound side). REMAINING M8 stays gated: live ≥2-node cluster (PRES-1/2/3, strict
T-of-N INV-6/LEVER-3, TRUST-1 cross-node, E2E-1), npm publish (TRUST-4), account Ed25519 key (LEVER-2
signed burn). None are autonomously completable without those resources or your sign-off.

## 2026-06-28 — WebAuthn finder LOW fixed: transient-only retry on the trust-signal handoff

Closed the one actionable LOW from the auth review with a real fix (not just docs): the best-effort handoff
now retries DirectoryUnreachableError (transport/5xx) up to 3× with a small backoff, but rethrows
DirectoryWriteRejectedError (4xx) immediately. A single transient directory blip during enrollment no
longer silently drops the trust signal; permanent-failure behavior is unchanged (exhausts → throws →
caller best-effort WARN; still re-mintable, D1). Tests: fails-twice-then-succeeds lands both writes; a 4xx
is attempted exactly once. cello-portal 584d051; handoff 5/5; portal e2e 37/37 (no regression).

This downgrades the remaining trust-signal PROPAGATION reconcile follow-up to LOW value — the retry covers
the common transient case; only a SUSTAINED outage during the whole enrollment still defers to re-mint (D1,
acceptable). A pending-propagation record + retry job remains a documented (now low-priority) follow-up.

SESSION SECURITY CAMPAIGN — fully closed: every M8 security path §8-reviewed, every finding at every
severity applied (incl LOWs: handoff retry, daemon malformed/no_content_key logs, directory anchor-less
skip log, key.burn.no_share, reconcile aggregate + sweep escalation). Live gates green (J-TRUST, J-SUSPEND).
Remaining M8 gated: live cluster (PRES/strict-T-of-N/TRUST-1 cross-node/E2E-1), npm publish (TRUST-4),
account key (LEVER-2 signed burn).

## 2026-06-28 — session/scoping §8 (fail-closed) + LOWs applied; H2 confirmed cluster-gated

§8 fallback-finder on the session lifecycle + revocation + account-scoping (DOD-INV-3/4): fail-closed
surface — opaque hashed token, revoked_at IS NULL + expires_at > now() on every request (NULL expiry reads
as expired → deny), account_id session-derived everywhere (never body/param/header), no JWT, no session
cache, gate redirects on null session/account. No HIGH/MEDIUM. Three LOWs applied (cello-portal a3120f9):
- listAgents 200-without-agents-array → now throws (contract violation, matching resolveAccountByEmailStub)
  instead of papering it as an empty home; a genuine zero-agent account ({agents:[]}) is unaffected.
- strong-auth-wall missing-account → was return false (fail-OPEN on the 2FA gate); now throws (fail closed
  + loud). Dead in practice (layout redirects on null account first) but future-proofed.
- paused/burned ?? false → documented as benign forward-compat (cosmetic badge; authoritative enforcement
  is the federation honor-check, DOD-INV-6).
Floor: typecheck; portal unit 25/25; e2e 37/37.

H2 (DOD-TRUST-1 cross-node) — FINAL determination: confirmed genuinely cluster-gated, not avoidance. The
daemon needs NO change (the pickup id is already string-typed on the wire, so UUID is transparent), so H2
would be directory-only — BUT its value-bearing part is the REPLICATION semantics: cross-node upsert
conflicts against the V37 (agent_id,signal_kind) partial unique index when pickup_queue joins cello_pub,
ack-DELETE propagation, and the owning-node sweep gate under replica lag. None are verifiable single-node.
Shipping the UUID migration + cello_pub membership blind would be an unverified schema+replication change
(violates migration-integrity). So H2's implementation correctly waits for the live ≥2-node cluster
(DOD-E2E-1). The recommended shape is recorded in the DoD-TRUST-1 note (UUID id + owning-node sweep gate).

CAMPAIGN: §8 now covers EVERY M8 surface (trust pipe end-to-end, burn/share-destruction, suspend,
WebAuthn, magic-link, agents-home, session/scoping); every finding at every severity applied; J-TRUST +
J-SUSPEND live-gated green. Running cello-done-auditor as an independent honesty check on the DoD ✅ claims.

## 2026-06-28 — done-auditor: ONE real over-claim caught → DOD-SPINE-3 ✅→🟡 (honest correction)

Ran cello-done-auditor as an independent honesty check on the DoD ✅ claims (anchored to the test FILES,
not the prose). Verdict: 8 EARNED, 1 OVER-CLAIMED, 2 inherited-caveat. (The first dispatch died on a
transient API outage at 21min; re-ran clean.)

OVER-CLAIM (corrected):
- DOD-SPINE-3 ✅ → 🟡. The served-portal "agent appears with presence" journey (e2e/j-spine.spec.ts:147)
  is `test.skip(!process.env.DIRECTORY_API_URL)` — opt-in, DEFAULT-SKIPPED (it IS one of the "4 skipped"
  in every standing e2e run I've done), and the directory auto-bring-up that would make it standing is
  unbuilt (global-setup, → DOD-E2E-1). The "6/6 with DIRECTORY_API_URL set" was a one-time opt-in demo
  (journal claim), not a reproducible standing gate. What IS standing-live (real Postgres): the read RULE
  via read-001-agents-by-account + presence-001-repository. So the logic is component-live-proven; the
  served end-to-end + cross-node = the close gate. Tag honestly 🟡.
- DOD-READ-1 / DOD-READ-2: notes corrected (they cited the now-🟡 SPINE-3). Kept ✅ — each has its OWN
  standing LIVE proof (read-001-agents-by-account / presence-001-repository, real Postgres) of the
  account-scoped read + the online/fresh rule; the served-render + cross-node aspects are gated (noted).
- DOD-AGENT-1: kept ✅ with a caveat — its "list + presence" sub-claim inherits SPINE-3 🟡 (served render
  gated); everything else (the suspend lever, alerts strip, posture, INV-9) is standing-proven by default
  (J-LEVER/J-AGENTS).

EARNED, verified by the auditor against the test source (NOT over-claimed): DOD-SPINE-2 (session/httpOnly/
revoke live by default; real-directory hop honestly disclosed as opt-in), DOD-SPINE-4/LEVER-1 (J-SUSPEND:
suspended agent with a VALID share refused server-side, positive control + reversible), DOD-SPINE-6/
TRUST-2 (J-TRUST: openSeal+hash-verify+store+ACK+delete cross-process + hash-mismatch negative + no-
plaintext dump), DOD-AUTH-1 (real forged-assertion-rejected via CDP virtual authenticator), DOD-INV-2
(live SI-001 seam-table dump + browser-storage empty). INV-6 + TRUST-1 already-honest 🟡.

Net: proven-live count corrected 32→31 of 41 (~76%). This is the honest-status discipline working — an
all-✅ tier is exactly where an over-claim hid (a skip-gated served journey reading as PROVEN LIVE).

## 2026-06-28 — SPINE-3 auto-bring-up investigated → close-gate prep (the pieces + the 3 constraints)

Attempted to advance the lowest autonomously-touchable non-green line (DOD-SPINE-3) by auto-bringing-up
the directory in the portal e2e. The pieces EXIST: `packages/directory/src/bin/internal-api-only.ts` is a
libp2p-free runner (pg pool + createInternalApiServer only; env DATABASE_URL, INTERNAL_API_KEY,
INTERNAL_API_PORT) built explicitly for "the cello-portal J-SPINE harness." But a LEGITIMATE standing ✅
hits three constraints that make it the close gate's (DOD-E2E-1) job, not an autonomous one:
1. ORDERING — the served portal reads DIRECTORY_API_URL at playwright-config eval, BEFORE webServer start;
   globalSetup is not guaranteed to precede webServer. So the directory must come up on a FIXED port inside
   webServer.command (like portal-postgres :55432), not in globalSetup. Plus cello_dev must be migrated to
   V37 (it currently is NOT — only cello_spine is kept current by the spine harness).
2. CROSS-REPO PATH — the only directory dist carrying V37 + this session's changes is the WORKTREE
   (../trustless-cello-m8-read001/packages/directory/dist); hardcoding that worktree name is machine-specific.
3. REPRODUCIBILITY — graceful-skip-when-absent means it passes only on this machine, which is NOT a
   reproducible standing gate → would not honestly earn ✅ (it'd be the same one-time opt-in demo the
   DoD note already describes). A true standing gate needs the close gate to orchestrate both repos.

CLOSE-GATE TODO (recorded so DOD-E2E-1 can wire it directly): (a) migrate cello_dev to V{latest} in the
portal webServer.command; (b) spawn internal-api-only against cello_dev on a fixed port with
INTERNAL_API_KEY; (c) set DIRECTORY_API_URL/KEY + READ001_LIVE in playwright.config directoryEnv (fixed
port, config-eval); (d) seed the operator account + an online ceremony agent (seedDirectoryAgentOnline
exists in e2e/helpers.ts); (e) drop the test.skip on j-spine SPINE-3. Then SPINE-3 + the served halves of
READ-1/2 become standing-✅. The directory-location path should be an env var, not hardcoded.

CONCLUSION: no clean autonomous unit legitimately advances a non-green DoD line — H2 ships unverifiable
replication; SPINE-3 auto-bring-up is machine-specific (not a reproducible gate). Both correctly wait for
the live cluster / close gate. The autonomous security+honesty campaign is complete; remaining lines are
gated on the cluster, npm publish, an account-key story, and the E2E-001 close-gate orchestration above.

## 2026-06-28 — decisions: #3 (account-key) taken as reversible default; #1/#2 await Andre's go

Per the autonomy rule (pick the reversible option, continue, never block):
- #3 ACCOUNT-KEY / DOD-LEVER-2 signed-event — DECIDED (reversible default, Andre may override): DEFER to a
  future account-key story; ACCEPT the account-authorized-but-unsigned burn for M8. The security property
  (burned agent can never sign) holds + is proven; the signed-event adds only tamper-proof attribution
  (audit nicety). An account Ed25519 key is real new protocol surface (lifecycle/recovery) better done
  deliberately. LEVER-2 stays 🟡 BY DECISION (contained + share-destruction parts done; signed-event = named
  M10/M11 follow-up). DoD note updated.
- #1 CLUSTER + #2 PUBLISH — NOT autonomously executable: both are outward-facing / hard-to-reverse (npm
  publish burns a version forever; AWS deploy = live infra + cost) AND were gated by Andre this session
  ("cello-client m8-lever-001 stays LOCAL — Andre-gated"; infra deploys = live-grenade, foreground, never
  from local). Directionally there is no reason to say no — they just need Andre's explicit "go", at which
  point: publish = version-cascade + tag → CI beta (then latest-promotion); cluster = deploy.sh per the
  region-expansion procedure. Both are flagged and ready; not started unilaterally.

Drift check this window: clean (no ✅ flips; SPINE-3 was a 🟡 downgrade last window). Lowest non-green
(INV-6 strict T-of-N, then SPINE-3) are cluster/close-gate-gated. No autonomous DoD advance remains.

## 2026-06-28 — SPEC INVERSION found (step-up is WebAuthn-only) → DOD-AUTH-2 + DOD-LEVER-4 ✅→🟡

Andre's intuition ("maybe things were built assuming everyone has WebAuthn") caught a real spec inversion.
journey-01 D6 is explicit: TOTP is the required, recoverable FLOOR; WebAuthn is a convenience LAYER
("not an equal alternative… not a substitute for 2FA"); step-up is "against an existing strong factor".
The IMPLEMENTATION inverted this: the only step-up route is `webauthn/stepup`; the suspend route message
and SuspendLever.tsx both hard-code "verify a passkey". So a TOTP-only operator (the spec's PRIMARY user)
cannot complete a sensitive action (burn/suspend, factor change) through the product after the 5-min
window — dead-ended at "verify a passkey" they don't have. NOT a hard lockout (/totp/verify on an existing
session incidentally calls markStrongAuth → stamps last_step_up_at, so the gate IS factor-agnostic), but
there is no TOTP step-up UX.

WHY IT SLIPPED THROUGH (the lesson): AUTH-002 built WebAuthn step-up first → the DoD then CODIFIED the
wrong assumption ("a fresh WebAuthn step-up" in DOD-AUTH-2 + DOD-LEVER-4) → tests exercised only the
WebAuthn path or the no-factor grace, never a TOTP-only account at a sensitive action → every review,
incl. the cello-done-auditor run earlier today, anchored to the tests + DoD, which agreed with each other.
Internal consistency (test ↔ DoD) cannot catch a SHARED wrong assumption. Nobody read journey-01 D6 against
the step-up implementation. LESSON saved to memory: anchor ≥1 review to the SOURCE journey/spec, and a DoD
line's wording must come from the spec, not the implementation (else the DoD just launders the bug).

CORRECTION: DOD-AUTH-2 ✅→🟡 and DOD-LEVER-4 ✅→🟡 (step-up half only; owner-only + burn-never-erases remain
proven). Proven-live count 31→29 of 41 (~71%). FIX (next unit, autonomous + portal-side + testable): add a
first-class TOTP step-up (a route that verifies a current TOTP code on the session → recordStepUp) +
factor-agnostic messaging ("re-verify your second factor", not "passkey") + the SuspendLever / step-up UI
offering the factor the operator actually has. Then re-prove DOD-AUTH-2/LEVER-4 for a TOTP-only account and
restore ✅.

## 2026-06-28 — ⛔ IMPLEMENTATION GATED pending Andre's alignment — see the remediation record

The M8 step-up SPEC INVERSION (WebAuthn-only step-up vs journey-01 D6 "TOTP is the floor") and its full
exploration — threat model, the corrected two-layer signed-revocation design, both audits' findings, the
DoD corrections, the remediation plan, and the open decisions — are captured in the authoritative,
compaction-safe pick-up doc:

  docs/planning/discussion_logs/2026-06-28_0700_m8-totp-floor-stepup-inversion-remediation.md

STATUS: exploration complete, **NO implementation started** (2 premature edits were reverted; tree clean).
Andre explicitly gated the work — align on the approach BEFORE touching code. Do NOT start the step-up fix
(tasks #18/#19/#20) on a watchdog tick; it is blocked on Andre's sign-off of §8/§9 of the remediation doc.
This overrides the watchdog default. Resume point after compaction = that remediation doc.
