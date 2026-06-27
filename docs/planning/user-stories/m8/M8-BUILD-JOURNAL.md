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
