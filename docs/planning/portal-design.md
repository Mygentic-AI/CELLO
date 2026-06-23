---
name: CELLO Portal Design
type: design
date: 2026-06-23
topics: [portal, frontend, design-system, look-and-feel, light-dark-mode, information-architecture, navigation, flows, M8, claude-design, mockups, authentication, dashboard, multi-agent]
status: active
description: Single hand-off document for Claude Design. One unified design system in two modes (light = CELLO corp site, dark = CELLO agent console), the full M8 portal information architecture, detailed per-screen specs and flows reconciled against the real M6/M7 code, and instructions to generate mockups.
---

# CELLO Operator Portal — Design Brief

The interface where a human owner manages their CELLO agents. Scope is **M8 — the portal skeleton**: authentication, an operator dashboard, agent health/status, and multi-agent account management. It is the first web surface in a protocol that until now has been terminal-and-bot only.

**Three invariants that shape every screen:**

- **No message content, ever.** The portal is a protocol-event and identity surface, not a chat client. Conversations appear only as tamper-proof hash fingerprints — never decoded transcripts. (Content viewing is a future companion-app feature, out of scope here.)
- **Calm sovereignty, never alarm.** CELLO's pitch is *trust you own* — security without surveillance. Routine operations read as ordinary and in-control, not as emergencies.
- **Never invent numbers.** Real data or an honest empty state. No fabricated "trust score: 87." Trust is shown as **named signals**, never a single composite score.

---

## Part 1 — Look & Feel: one system, two modes

CELLO already exists in two finished surfaces that form a matched **light/dark pair**, not two directions:

- **Light mode** = the CELLO **corporate site** (`corp-cello-site`): cool, near-white, soft-shadow, polished.
- **Dark mode** = the CELLO **agent console** (`cello-agent/frontend`): warm charcoal, Claude-Code-lineage, surface-layered, console-native.

Same stack family (Next.js + Tailwind + Lucide), one shared pink brand accent. The portal is an operator *console*, so **dark is its natural home mode** — but **both modes are first-class** and must be designed.

### Color tokens

Pink accent is the single signature color across both modes — used **sparingly**: primary actions, the active/"current" state, key figures, micro-labels. Everything else neutral.

| Role | Light (cool, corp) | Dark (warm, agent) | Notes |
|---|---|---|---|
| **Accent / primary** | `#D91E8A` (`hsl 330 85% 48%`) | `#DB2777` (`hsl 330 67% 51%`) | The CELLO pink; brightens slightly in dark |
| Accent light | `#FBEAF3` | `#F084B6` | Tints, selected states |
| Accent dark / hover | `#B5176F` | `#B5176F` | Gradient end, accent hover |
| **Page background** | `#FFFFFF` | `#262524` (`bg-100`) | Light = white; dark = warm charcoal |
| Surface / raised | `#FAF5F8` | `#302F2D` (`bg-000`) | Sidebar, bands, raised surfaces |
| **Card** | `#FFFFFF` | `#1F1D1D` (`bg-200`) | Card / panel fill |
| Deep / inset | `#F1ECEF` | `#141413` (`bg-300`) | Wells, code blocks, deepest layer |
| **Text primary** | `#17171C` | `#FBF9F2` (warm cream) | Headings, primary text |
| Text secondary | `#55555C` | `#C4BFB3` | Body copy |
| Text muted | `#86868F` | `#9E9990` | Captions, metadata |
| **Border / divider** | `#E7DCE3` | `rgba(221,214,196,0.22)` | Light = soft pink-grey; dark = translucent warm ~22% |

**Supporting accents (both modes):** Teal `#2BB8A8` (secondary/info), Navy `#00247D` (tertiary/charts). Never let them compete with the pink.

**Status colors (both modes):** Green `#459315` (online/connected/running), Amber `#EAB308` (registered/reconnecting), Red `#FE8181` (lost/failed/error), **Accent pink = "current"** (the agent active for a connection).

### Typography — one type system across both modes (fonts do NOT switch with theme)

- **Headings / display:** **Bricolage Grotesque** (700/800), tight negative letter-spacing.
- **UI / body:** **Inter** (system-ui fallback).
- **Cryptographic & machine data:** **JetBrains Mono** — for *all* hashes, public-key fingerprints, agent IDs, Merkle roots, pre-auth tokens. Non-negotiable for these values.
- Scale: H1 `3.5rem/1.08/-0.02em` · H2 `2.5rem/1.15/-0.02em` · H3 `1.25rem/1.4` · body `16px/1.6`.
- **Eyebrow label:** `text-xs`, semibold, `tracking-widest`, UPPERCASE, accent-colored.

> One decision to confirm: heading font — Bricolage (brand-forward, recommended) vs. system-ui (console-native). Everything else in the type system is settled.

### Shape, elevation, motion

- **Radius:** base `0.5rem`; cards `0.75–1rem`.
- **Elevation differs by mode (the point of a good pair):** Light = soft layered shadows (`0 1px 3px /0 2px 8px` rgba black), deepening on hover, optional pink glow on focal elements. Dark = *no heavy shadows*; convey depth by **surface layering** (`bg-100`→`bg-200`→`bg-300`, raised `bg-000`) + the ~22% translucent border.
- **Container:** centered, max ~1280px, `1.5rem` gutters.
- **Motion (subtle, shared):** `fade-in` ~0.5s, `slide-up` ~0.6s on entry; shimmer skeletons for loading. **Signature animation:** the agent console's **nodes-and-edges graph** (pulsing nodes + drawing edges) for session establishment / FROST ceremony / "connecting." A pink streaming cursor and a slow-pulsing green `●` mark active/running.

### Component primitives

- **Uniform cards:** one surface fill per mode, soft border, rounded; light gets a soft shadow, dark gets surface-layer contrast. **Never color-code cards to signal importance** — emphasis comes from position, size, copy. (Explicitly rejected on the corp site as confusing.)
- **`●` status dot:** tiny bullet colored by status, pulsing when running — the core state primitive.
- **Status pill:** `●` dot + label (`● Online`, `● Current`, `● Reconnecting`).
- **Mono data chip:** fingerprint/hash/ID/token in JetBrains Mono, truncated (first 8 bytes) with copy-to-clipboard; full value on copy.
- **Buttons:** primary solid accent / outline secondary / ghost tertiary.
- **Sidebar nav:** left rail on the raised surface; active item uses accent.
- **Empty states:** first-class and instructive.
- **Icons:** Lucide, consistent thin weight.

---

## Part 2 — Information Architecture & Navigation

### The mental model

One **operator** (human owner) signs into the portal and manages **one or more agents**. Agents run inside a single long-running local process (`cello-daemon`) that loads each agent's keys from `~/.cello/agents/<name>/key`. The daemon reports the live state of *all* agents at once.

Two scopes therefore exist, and the navigation must keep them distinct:

- **Account-wide** screens (Dashboard, Agents roster, Account & Security) — about the operator and the whole daemon.
- **Agent-scoped** screens (Agent detail; later Trust Signals, Connections, etc.) — about one agent. A persistent **agent switcher** sets which agent these screens focus on.

> Terminology trap to avoid in the UI: the portal's "focused agent" (which agent you're *looking at*) is a UI concept. The daemon's **`current`** state (which agent is *active for a given connection*) is a protocol concept. Don't conflate them — the switcher changes focus; it does not set the daemon `current`.

### App shell anatomy

```
┌────────────────────────────────────────────────────────────────┐
│ TOP BAR: page title · connection-health badge · account menu   │
├────────────────┬───────────────────────────────────────────────┤
│ SIDEBAR        │                                               │
│  ── brand      │  PAGE CONTENT                                 │
│  [Agent ▾]     │  (scoped to the focused agent where relevant) │
│                │                                               │
│  Dashboard     │                                               │
│  Agents        │                                               │
│  ┄ Coming soon │                                               │
│   Trust Signals│                                               │
│   Connections  │                                               │
│   Discovery    │                                               │
│   Recovery     │                                               │
│   Succession   │                                               │
│                │                                               │
│  ── bottom ──  │                                               │
│  Account &     │                                               │
│   Security     │                                               │
│  Help          │                                               │
└────────────────┴───────────────────────────────────────────────┘
```

- **Brand lockup** top-left (CELLO wordmark).
- **Agent switcher** directly under the brand: shows the focused agent's name + `●` state dot; dropdown lists every loaded agent (name, state pill) and a "Register agent" action at the bottom.
- **Primary nav:** Dashboard, Agents (active in M8). Below a thin "Coming soon" divider: Trust Signals, Connections, Discovery, Recovery, Succession — visible, dimmed, non-clickable with a small "soon" tag. They exist so the IA is correct from day one; their interiors are out of scope.
- **Bottom nav:** Account & Security, Help.
- **Connection-health badge** (top bar, always visible): a `●` + label driven by `directory_signaling` — `● Connected` (green), `● Reconnecting` (amber), `● Directory unreachable` (red) with a tooltip: "Existing sessions continue; new sessions are blocked."
- **Account menu** (top-right): operator email, theme toggle (light/dark), sign out.

### Route map (M8)

| Route | Screen | Scope |
|---|---|---|
| `/login` | Sign in (magic link / passkey) | pre-auth |
| `/auth/callback` | Magic-link landing | pre-auth |
| `/welcome` | First-login completion + onboarding | account |
| `/` | Dashboard home | account |
| `/agents` | Agent roster | account |
| `/agents/register` | Register agent by token + ceremony | account |
| `/agents/:name` | Agent detail | agent |
| `/account/security` | Auth factors, active sessions | account |
| `/account` | Account info | account |
| Modal (any route) | Step-up re-auth challenge | overlay |

---

## Part 3 — Screen specifications

Backing tags: ✅ **Backed** (real code/data today) · 🔧 **Needs API** (sensible UI, endpoint not built) · 🎨 **Greenfield** (no code; pure design).

> The portal-facing APIs do not exist yet (live data is in the local daemon; persisted data in the remote directory; neither exposes a portal API). For mockups this is fine — but build the dashboard around the **real daemon fields** in Part 5, not invented metrics.

### 3.1 Sign in — `/login` — 🎨

- **Purpose:** authenticate the operator into the portal.
- **Layout:** centered single column on a plain background; brand lockup; a short trust line ("Manage your CELLO agents").
- **Contents:**
  - Email input + **"Send magic link"** primary button (magic link is the default first-time path; email was verified at registration).
  - If the operator has a passkey enrolled on this device: **"Continue with a passkey"** primary, magic link demoted to secondary text link.
  - Fine print: "We'll email you a one-time sign-in link."
- **States:** idle · submitting (button spinner) · **sent** ("Check your email — link expires in 15 minutes," with a resend timer) · error (unknown email, rate-limited).

### 3.2 Magic-link landing — `/auth/callback` — 🎨

- Brief interstitial: the **nodes-and-edges animation** + "Signing you in…", then redirect (to `/welcome` first time, `/` thereafter). Error state: "This link has expired — request a new one."

### 3.3 Step-up re-authentication (modal) — 🎨

- **Trigger:** any high-stakes action (e.g. retire an agent, change a security factor).
- **Contents:** names the exact action being authorized ("Authorize: retire agent *atlas*"), a WebAuthn prompt (passkey/biometric), and a **"Use authenticator code instead" (TOTP)** fallback link. A fresh challenge is issued **per action**, not once per session.
- **States:** prompt · verifying · success (dismiss, proceed) · failed (retry / fallback).

### 3.4 Second-factor enrollment — within `/welcome` and `/account/security` — 🎨

- Two cards: **Passkey (WebAuthn)** — "Add a passkey" → platform prompt → success shows device label + added date. **Authenticator app (TOTP)** — QR code + manual secret, then a 6-digit verify field; positioned as a *backup*, not the primary factor.
- **Persistent warning banner** until at least one factor exists: "Add a second factor to protect identity-affecting actions." Non-dismissible until resolved.

### 3.5 First-login / onboarding — `/welcome` — 🔧

- **Purpose:** orient a brand-new operator and route them to first actions.
- **Layout:** a welcome header + a vertical **checklist of numbered steps** (accent-pink number badges):
  1. **Account basics** — phone verified ✓, email verified ✓, baseline keys issued ✓ (all green checks; read-only confirmation).
  2. **Secure your account** — enroll a passkey (links to 3.4). Open until done.
  3. **Bring your agent online** — links to register/confirm (3.7) or, if an agent already loaded, "Go to your agent."
  4. **Recovery contacts** — *Coming soon* (dimmed; sets expectation without a dead end).
- **States:** fresh (nothing done) · partial (some checks complete) · complete (collapses to a "You're set up" summary with a "Go to dashboard" button).

### 3.6 Dashboard home — `/` — ✅ (anchor on real daemon fields)

- **Purpose:** at-a-glance health of the daemon and all agents; recent activity.
- **Layout regions (top to bottom):**
  1. **Health strip** — three compact tiles:
     - **Daemon** — `● running` (green) / not running (red).
     - **Directory signaling** — `● Connected` / `● Reconnecting` / `● Unreachable`, with the "sessions continue / new blocked" note when degraded.
     - **Standing receiver** — `● Ready` / `● Not ready` (the pre-created node that accepts incoming sessions).
  2. **Agents panel** — a card per loaded agent: name, `●` state pill (`registered`/`online`/`current`/`load_failed`), pubkey **fingerprint** mono chip, and inline quick actions (Bring online / Stop / Set current / Open). The **current** agent's card carries the pink accent edge.
  3. **Live metrics row** — small stat tiles: **Active connections** (count from `connections[]`), **Retry queue depth** (`retryQueueDepth`), **Interrupted sessions** (`interrupted_sessions[]` count, each expandable to session id + counterparty).
  4. **Event feed** 🔧 — a reverse-chronological timeline using the **real** event set only: `agent_state_changed` (e.g. "*atlas* came online"), `agent_current_changed` ("current switched *atlas* → *mercury* on connection X"), `session_state_changed` ("session …7f3a sealed"), inbound `cello_message` / `cello_session_request`. Each row: `●` status glyph, timestamp, plain-language line, optional mono id chip. Filter chips by type.
  5. **Pending actions** 🔧 — connection requests awaiting a decision (slot; show empty in M8 mockups unless illustrating the populated case).
  6. **Security alerts** 🎨 — a calm panel; stub contents ("No alerts").
- **States:**
  - **Populated** — 2–3 agents, one `online`, one `current`, a few events.
  - **Empty (new operator)** — daemon running, one `registered` agent, no connections, empty feed with an instructive "Bring your agent online to start" prompt.
  - **Loading** — shimmer skeletons on each panel.
  - **Degraded** — `directory_signaling: lost`: amber/red health strip, a banner explaining existing sessions continue but new ones are blocked; agent cards still render from local state.

### 3.7 Register / confirm an agent — `/agents/register` — 🔧

- **Purpose:** turn a pre-authorization token into a live, key-bearing agent via the FROST ceremony.
- **Step 1 — Token entry:** explanation ("Paste the one-time token from the CELLO Operations Agent on Telegram"), a **mono token input** (`CELLO-…` format), inline validation (format + not-expired; tokens expire in 12 hours). Help text linking to how to get a token from the bot.
- **Step 2 — Ceremony:** the **nodes-and-edges animation** with labeled progress steps: *Validating token → Generating local key → FROST round 1 → FROST round 2 → Finalizing*. Honest, non-alarming copy; no fake speed.
- **Step 3 — Success:** confirmation card — agent name, new **K_local fingerprint** (mono chip), state now `registered`/`online`, and a "Go to agent" button.
- **States:** entry · validating · invalid/expired token (clear recovery copy: "Request a fresh token from the bot") · ceremony in progress · ceremony failed (retry) · success.

### 3.8 Agents roster — `/agents` — ✅

- **Purpose:** manage all of the operator's agents.
- **Layout:** page header with a **"Register agent"** primary button; a **table/list** of agents.
- **Row contents:** name · `●` **state pill** (`registered`/`online`/`current`/`load_failed`) · fingerprint mono chip · last-activity (if available) · **row actions** (Bring online / Stop / Set current / Open detail). `load_failed` rows show an error affordance ("Couldn't load keys — view details").
- **States:** populated · single-agent · empty (CTA to register) · a `load_failed` row example.

### 3.9 Agent detail — `/agents/:name` — ✅/🔧

- **Purpose:** everything about one agent.
- **Header:** agent name · `●` state pill · fingerprint mono chip (copy) · primary state action (Bring online / Stop / Set current).
- **Sections (tabs or stacked):**
  - **Overview** ✅ — current state; this agent's active connections (from `connections[]` filtered to it); its sessions (active / sealed / interrupted) shown as rows with session id (mono), counterparty pubkey (mono), state, and seal/Merkle-root chip where sealed (hash only — never content).
  - **Identity & keys** ✅/🔧 — K_local fingerprint + full pubkey (mono, copy) ✅; **Key status** ("FROST share health", "last rotation date") 🔧 — *not exposed by any tool today*: render as labeled rows reading "Not available" rather than inventing values.
  - **Profile** 🔧 — editable name, description, capability tags (the directory stores these; no write API yet — show the form and a "Save" that's clearly part of a future API).
  - **Danger zone** 🔧 — **Deactivate / retire** this agent; gated behind step-up re-auth (3.3) with a confirm.
- **States:** online · registered (offline) · current · load_failed (keys couldn't load — show the error and a retry) · loading.

### 3.10 Account & Security — `/account/security` — 🎨

- **Auth factors:** list of enrolled passkeys (device label, added date, remove → step-up) and TOTP status (enrolled / not). "Add passkey" / "Set up authenticator."
- **Active sessions:** list of logged-in browser sessions (device, location-ish, last active) with **remote logout** per session and "Log out everywhere."
- **Account info** (`/account`): operator email, masked phone, theme preference. Identity-affecting changes route through step-up.

---

## Part 4 — Key flows (step-by-step)

**F1 · First sign-in → set up.** `/login` (enter email → magic link) → email link → `/auth/callback` (signing-in animation) → `/welcome` → enroll a passkey (3.4) → confirm/register an agent (3.7) → land on `/` with one agent.

**F2 · Register an agent from a token.** Get a `CELLO-…` token from the Telegram Operations Agent → `/agents/register` → paste token (validates, 12h expiry) → FROST ceremony (animated steps) → success shows the new fingerprint → agent appears in the roster and dashboard.

**F3 · Operate an agent.** From the dashboard or roster: **Bring online** (`registered → online`) → optionally **Set current** (`online → current`, pink highlight) → **Stop** (`→ registered`). Each transition emits an `agent_state_changed` / `agent_current_changed` event that appears in the feed.

**F4 · Step-up for a sensitive action.** Click a high-stakes action (e.g. retire agent) → step-up modal (3.3) names the action → passkey prompt (or TOTP fallback) → on success the action proceeds; on cancel nothing changes.

**F5 · Directory goes unreachable.** `directory_signaling` flips to `reconnecting`/`lost` → the top-bar badge and dashboard health strip go amber/red → a non-alarming banner: "Directory unreachable. Existing sessions continue; new sessions are blocked." Agent cards still render from local daemon state. When it recovers, badge returns to green and a `● Connected` event lands in the feed.

---

## Part 5 — Data dictionary (use real values in mockups)

**Daemon status (`cello_status`, the dashboard's source):**
- `daemon`: `"running"`
- `directory_signaling`: `"connected" | "reconnecting" | "lost"`
- `agents[]`: each has a name and a **state** — `"registered" | "online" | "current" | "load_failed"`
- `connections[]`: active connections (counterparty info)
- `standing_receiver_ready`: `true | false`
- `retryQueueDepth`: integer (pending outbound retries; usually `0`)
- `interrupted_sessions[]`: sessions that dropped and may resume (session id + counterparty)

**Agent states — meaning (for the pills):**
- `registered` — loaded/known but dormant (amber).
- `online` — live on the network (green).
- `current` — the agent active for a given connection (accent pink). Per-connection; an agent can be current on one connection and merely online elsewhere.
- `load_failed` — keys failed to load (red).

**Real event types (the only ones to show in the feed):** `agent_state_changed` (`state: online|offline`, `reason`), `agent_current_changed` (`from`/`to` agent), `session_state_changed` (`sessionId`, `state`, `counterpartyPubkey`), inbound `cello_message`, inbound `cello_session_request`. *(Do not mock the large legacy notification taxonomy — it does not exist.)*

**Identifiers (all JetBrains Mono, truncate + copy):**
- Pre-auth token: `CELLO-<base58>` (single-use, 12-hour expiry).
- K_local fingerprint / pubkey: hex.
- Session id, Merkle/seal root: hex (root shown as first 8 bytes + copy).

**Example agent names for mockups:** `atlas`, `mercury`, `juno` (lowercase, single words).

---

## Part 6 — Instructions: create the mockups

Produce **high-fidelity web mockups** for the CELLO operator portal using Parts 1–5.

**Global requirements**
- **Platform:** responsive web app, **desktop-first** (~1280px primary) with sensible mobile/tablet reflow.
- **Both themes are first-class.** Deliver each core screen in **dark mode (the console's natural default) and light mode** — same layout/components, mode-appropriate elevation (soft shadows in light; surface-layering + translucent borders in dark).
- **Apply the system exactly:** pink accent used sparingly, Bricolage headings + Inter UI + **JetBrains Mono for every hash/fingerprint/ID/token**, `●` status dots and pills, Lucide icons, subtle fade/slide motion, and the **nodes-and-edges graph** for connecting/ceremony states.
- **Use the real data** from Part 5 — real agent states, real status fields, real event types, example names `atlas`/`mercury`/`juno`. No fabricated metrics or scores.
- **Honor the invariants:** no message content (hashes only); calm tone; named signals not scores.

**Screens to generate (in order), each with its labeled states:**
1. **Sign in** (`/login`) — magic-link request; passkey variant. *States: idle, sent, error.*
2. **Magic-link landing** (`/auth/callback`) — signing-in animation; expired-link error.
3. **Onboarding** (`/welcome`) — numbered setup checklist. *States: fresh, partial, complete.*
4. **Second-factor enrollment** — passkey + TOTP cards; persistent warning banner.
5. **Step-up modal** — action-named WebAuthn challenge with TOTP fallback.
6. **Dashboard home** (`/`) — health strip, agents panel, live-metrics row, event feed, pending/security stubs. *States: populated, empty (new operator), loading, degraded (directory unreachable).*
7. **Register agent** (`/agents/register`) — token entry → FROST ceremony (nodes-and-edges) → success. *States: entry, invalid/expired token, in-progress, failed, success.*
8. **Agents roster** (`/agents`) — table with state pills + row actions + Register CTA. *States: populated, empty, load_failed row.*
9. **Agent detail** (`/agents/:name`) — header + Overview / Identity & keys / Profile / Danger zone. *States: online, registered, current, load_failed, loading. Show "Not available" placeholders for FROST-health / last-rotation.*
10. **Account & Security** (`/account/security`) — auth factors, active sessions with remote logout.
11. **App shell** — sidebar (agent switcher + nav + "Coming soon" group) and top bar (connection-health badge, account menu) shown in both themes.

**Deliverable:** one cohesive screen set in both themes, sharing a single design system, with each screen labeled by name, theme, and state — ready to iterate into the M8 portal build.
