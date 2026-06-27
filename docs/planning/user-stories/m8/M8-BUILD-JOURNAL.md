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
