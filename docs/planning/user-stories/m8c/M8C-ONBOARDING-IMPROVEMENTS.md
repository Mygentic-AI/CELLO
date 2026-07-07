---
name: M8C Onboarding Improvements
type: checklist
date: 2026-07-07
milestone: M8C
status: open
topics: [onboarding, registration, telegram, ops-agent, cli, privacy, ux, copy]
description: >
  Living checklist of onboarding UX/copy improvements found by walking the real registration
  flow with Andre (2026-07-07). Built up stage by stage — Phase 1 = Telegram registration bot,
  Phase 2 = CLI agent registration (to come). When the walk-through is complete this becomes the
  single source for a one-shot onboarding mini-sprint, and is wired into M8C-DEFINITION-OF-DONE,
  M8C-DECISIONS, and M8C-BUILD-JOURNAL. Nothing here is implemented yet — this is the plan.
---

# M8C — Onboarding Improvements (living checklist)

We walked the real onboarding flow live and are collecting every improvement into this one doc.
Each item has: **where** (file:line), **now** (current text/behavior), **proposed** (the fix), and a
**status** box. We implement the whole set in ONE pass + ONE ops-agent redeploy once the walk-through
is done — not piecemeal.

**Status legend:** ⬜ agreed, not built · 🟡 drafted, needs Andre's ok · ✅ built + shipped

---

## Decisions locked (apply to everything below)

- **D-PII — no PII in the directory; email & phone are hash-only.** Directories are federated and may
  become publicly replicable (blockchain-like), so the registration/directory layer stores only SHA-256
  stub hashes — never a recoverable email/phone. The portal separately holds the recoverable (KMS-
  encrypted) email, but only AFTER the user logs into the portal (not required to use CELLO). See
  [[M8C-DECISIONS]] (to add) + memory `project_no_pii_in_directory_hash_only`.
- **D-PROMISE — scope the privacy claim to the DIRECTORY layer, never "CELLO as a whole."** A user sees
  one system; if we say "we only keep a hash of your email" they'll be confused when a portal email
  arrives post-login. So the promise is always "the directories where your agent is found hold only
  hashes," and we make NO absolute "we'll never email you" claim (the portal does, post-login). Phone
  "we'll never call you" IS safe — phone is hash-only everywhere (portal has no phone).
- **D-ENVVAR — the token handoff instruction is a real bug (fix in item 4).** The bot says set
  `CELLO_REGISTRATION_TOKEN`; the CLI reads NOTHING by that name — it takes the token as a positional
  arg (`cello register <agent> <token>`) or `CELLO_PREAUTH_TOKEN`. A literal follower is dead in the
  water. Cross-repo drift.

---

## Phase 1 — Telegram registration bot (ops-agent)

The path: `/start` → (existing-account CONFIRM) → share phone → provide email → 6-digit OTP →
pre-auth token. All copy lives in `packages/operations-agent/src/`.

### Happy-path messages

- ⬜ **1. Existing-account CONFIRM — split into two sequential messages.** *(engine.ts:301)*
  - **Now:** one dense message — "You already have a CELLO agent registered to this number. Both
    agents will work independently under the same account. To register an additional agent, reply
    CONFIRM. Otherwise, ignore this message."
  - **Proposed (two `channel.send` calls):**
    - ① *"There are already one or more agents registered to this account. You can register additional
      agents, but each must use the same account — the same phone number and the same email you
      registered with before."*
    - ② *"Reply CONFIRM to proceed using that same phone number and email. Otherwise, ignore this
      message."*
  - Rationale: separate the explanation from the instruction.

- ⬜ **2. Phone ask — add directory-scoped privacy note.** *(state-machine.ts:202 new user / :256 returning)*
  - **Now:** *"Welcome! Please share your phone number to begin registration."*
  - **Proposed** (keeps the `CONTACT_PROMPT_PREFIX` share-contact button):
    > Welcome to CELLO! Let's set up your agent. To begin, share your phone number using the button below.
    >
    > A note on privacy: the directories where your agent can be found never hold your actual phone
    > number or email — only irreversible hashes of them. Those hashes keep each unique to you while
    > leaving nothing in the shared, federated records worth stealing. No one, CELLO staff included,
    > will ever call you — the registration system holds a hash of your number, never the number itself.
  - Returning user (:256): same paragraph, opener "Welcome back to CELLO!".
  - **Verified accurate:** phone hashed at `state-machine.ts:299` (SI-002); no recoverable phone anywhere.

- ⬜ **3. Email ask — returning users use the same email (NO prefix hint).** *(state-machine.ts:317)*
  - **Now:** *"Phone verified! Please provide your email address."*
  - **Proposed:**
    - New user: *"Phone verified! Next, please provide your email address."*
    - Returning user (re-registration, `expectedEmailStubHash` set): *"Phone verified! Please enter the
      same email address you registered with the first time."*
  - **Prefix reminder ("apem…") DROPPED** — showing it would require storing plaintext/prefix on the
    registration side, exactly the PII D-PII forbids (the hash is irreversible; the recoverable copy
    lives only in the portal). Not worth a PII carve-out.

- ⬜ **4. Token delivery — split into two messages + FIX the env-var bug.** *(state-machine.ts:538 and the retry path :603)*
  - **Now:** one message ending *"Set this as CELLO_REGISTRATION_TOKEN on your agent."* — wrong var
    (D-ENVVAR); dead-ends with no next step.
  - **Proposed — message ① (instructions):**
    > Your CELLO agent registration token is ready. It's valid for 24 hours and can be used once.
    >
    > On a device with the CELLO CLI installed and logged in (run `cello login` first):
    >
    > 1) Create the local identity:
    >      `cello create-agent <agent-name>`
    >    Pick a name unique among your agents — 1–64 characters; letters, digits, '-' or '_'; no spaces.
    >
    > 2) Register it with your token (sent in the next message):
    >      `cello register <agent-name> <token>`
    >    e.g.  `cello register my-assistant CELLO-AbC1...`
    >
    > Then run `cello status` to confirm your agent is online.
    >
    > Thank you for choosing CELLO — happy agent-to-agent communicating!
  - **Proposed — message ② (token only, for clean one-tap copy):** just the raw token, nothing else.
  - **Refinement (Andre, 2026-07-07): inline the REAL token; use `[YOUR_NAME]` bracket placeholders for
    the name.** The token is the error-prone part (bake it in, verbatim); the name is the user's own
    choice (leave it a placeholder). Show the commands with a one-line "replace this" comment above each:
    ```
    # Replace [YOUR_NAME] with a name for your agent — letters, numbers, _ and - only, no spaces.
    cello create-agent [YOUR_NAME]
    # Use the SAME name; the token is already filled in.
    cello register [YOUR_NAME] CELLO-kJaZQVqMpuVx2A5bE2kzNemwvH6LNbxT5
    ```
    **Why brackets, not `<angle>`:** `[` and `]` fail the name charset `^[a-zA-Z0-9_-]{1,64}$`, so a
    blind copy-paste is cleanly REJECTED (with the name-rule error) instead of creating a junk-named
    agent literally called `[YOUR_NAME]` — a built-in fail-safe. (Open shape for message ②: keep it the
    bare token, or make it the bare inlined `cello register [YOUR_NAME] CELLO-kJaZ…` line for one-tap copy.)
  - **Verified accurate:** name rule `^[a-zA-Z0-9_-]{1,64}$` (cli-args.ts:45); register takes the token
    positionally (cli.ts:81); `cello login` required before create-agent/register (commands.ts:221).

### Error / edge-path messages (found by reading the branches, not walked live)

- ⬜ **O1. Pre-auth server error — misleading, actually a bug.** *(state-machine.ts:497 and :567)*
  - **Now:** *"…This is not something you can fix by retrying…"* — but the code DOES auto-retry (state
    EMAIL_CONFIRMED → `#retryPreAuth` on the next message). The message contradicts the behavior.
  - **Proposed:** *"CELLO hit a temporary server error finishing your registration. Reply anything to
    try again. If it keeps happening, please contact support."*

- ⬜ **O2. OTP-failure wording — inconsistent across three branches.** *(state-machine.ts:394, :401, :408)*
  - **Now:** three different phrasings; `:401` ("request a new one") never says HOW.
  - **Proposed:** standardize to *"…please re-enter your email address to get a new code."* and state the
    code lifetime at issuance (:374): *"A 6-digit code has been sent to X — it's valid for 15 minutes."*

- ⬜ **O3. Rate-limit — give the wait duration.** *(state-machine.ts:347)*
  - **Now:** *"…Please wait before trying again."* (no duration).
  - **Proposed:** *"Too many code requests. Please wait up to an hour before trying again."* (window = 1h).

- ⬜ **O4. Email-continuity rejection — explain why.** *(state-machine.ts:456)*
  - **Now:** *"You must use the same email address as your original registration. Please try again."*
  - **Proposed:** *"For security, additional agents on this account must use the same email as your
    original registration. Please re-enter that email."*

- ⬜ **O5. Brand-new-user opener** — folded into item 2 (one line on what CELLO is, before "share your
  phone"), so a cold `/start` isn't context-free.

---

## Phase 2 — CLI agent registration (`cello create-agent → register → status`)

Walked live 2026-07-07 with token `CELLO-kJaZ…` → agent **`CELLO_Feedback`** (pubkey `da0c73f8…`,
agentId `29d7488a…`, directory agent_id `3511df08…`). **Cold onboarding fundamentally WORKED** — all
three steps completed from the command guidance alone, no source-reading. Rough edges:

- ⬜ **P2-1. `register` next-step guidance is one long run-on line — make it multi-line.** *(cello-client CLI, `register` output)*
  - **Now:** *"Next: run 'cello status' to confirm 'CELLO_Feedback' is registered. 'connecting' is
    normal — registration takes a minute or two; 'connected' means ready. If it stays disconnected, run
    'cello logout' then 'cello login'."* — one dense line.
  - **Proposed:** break it up —
    ```
    Next: run  cello status  to confirm 'CELLO_Feedback' is registered.
      • 'connecting' is normal — registration takes a minute or two.
      • 'connected' means ready.
      • if it stays disconnected, run  cello logout  then  cello login.
    ```

- ⬜ **P2-2. FUNCTIONAL BUG — a freshly-registered agent is `standing_receiver_ready: false` and can't
  receive until a daemon restart.** *(cello-client daemon)*
  - **Observed:** right after `cello register CELLO_Feedback`, `cello status` showed CELLO_Feedback
    `standing_receiver_ready: false` while the two boot-time agents (CELLO_Support, Ms_Chelly) showed
    `true`. A `cello logout` → `cello login` (full daemon restart) armed it → `true`. **Recurring**
    (Andre has hit this before).
  - **Root cause — CONFIRMED (2026-07-07, code-read, producer/consumer):**
    - *Producer* of `standing_receiver_ready`: `startAgentInternal(name)` → `ensureStandingReceiverForAgent(name)`
      (`core/daemon/src/daemon.ts:1841`) — adds the agent to `onlineAgents`, reuses/opens its signaling,
      arms the standing receiver, fires `agent_state_changed`. Called by `cello_start_agent` (:1879),
      `cello_use_agent` (:2148), and login's auto-start-all.
    - *The gap*: the `cello_register` handler's success path (`daemon.ts:2333–2359`) persists the identity,
      logs `registration.succeeded`, returns `ok` — but **never calls `startAgentInternal`**. Registration
      opens the agent's signaling stream for the DKG, but the agent is never added to `onlineAgents` and
      its receiver is never armed → `standing_receiver_ready: false` until the next daemon boot (which is
      why `cello login` — auto-starts all agents — fixed it).
  - **FIX — EASY (one line).** In the register success path (after `registration.succeeded`, before the
    `return { ok: true, … }`), call the already-existing idempotent `startAgentInternal(name)` — the exact
    shared start path login/use_agent use. Arms the receiver, marks online, fires `agent_state_changed`.
    Eliminates the logout/login workaround. Register bringing the agent online is *consistent* with login
    and use_agent both auto-starting — the current offline-after-register is the inconsistency.
  - **Deploy note:** this is a **cello-client daemon** change → needs a publish cascade + local re-pin
    (heavier than the ops-agent copy redeploy). So the onboarding sprint spans BOTH repos.
  - **Impact if unfixed:** a brand-new user's very first agent can't receive inbound sessions until they
    logout/login — looks broken at the most important moment. The `register` next-step text already hints
    at the logout/login workaround (P2-1), which is the fallback if we don't ship the fix.
  - **Related:** [[project_mcp_stale_socket_after_daemon_restart]]; demo-agent standing-receiver notes in
    repo CLAUDE.md (receiver created only when the start path reaches the daemon — exactly this).

---

## Implementation notes (for the one-shot sprint)

- **Files:** `packages/operations-agent/src/registration/engine.ts` (item 1),
  `.../state-machine.ts` (items 2–4, O1–O4). Two `channel.send` calls where a message splits.
- **Tests:** the ops-agent tests assert on these exact strings — update them in the same pass
  (extend, don't rewrite). Gate: `pnpm test → lint → typecheck → build`.
- **Ship:** ops-agent code change → rebuild image → CI/CD swap (us-east-1 only; ops-agent is
  single-region). No cello-client publish (the CLI already reads the token correctly).
- **Wire-in at the end:** add an onboarding-improvement line to M8C-DEFINITION-OF-DONE, the D-PII /
  D-PROMISE / D-ENVVAR decisions to M8C-DECISIONS, and a build-journal entry when shipped.

---

## Related
- [[M8C-DEFINITION-OF-DONE]] — the cold-onboarding gate (DOD-LIVE-1) this feeds
- [[M8C-DECISIONS]] — D-PII / D-PROMISE / D-ENVVAR to be recorded here
- [[M8C-BUILD-JOURNAL]] — entry to add when the sprint ships
- [[M8C-LIVE-TEST-CHECKLIST]] — item 1 (cold onboarding) is the live test that surfaced Phase 2
