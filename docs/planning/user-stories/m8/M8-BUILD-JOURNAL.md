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
