---
name: CELLO Portal Design
type: design
date: 2026-06-23
topics: [portal, frontend, design-system, look-and-feel, light-dark-mode, information-architecture, navigation, flows, trust-signals, connections, recovery, succession, discovery, claude-design, mockups]
status: active
description: Single hand-off document for Claude Design. One unified design system in two modes (light = CELLO corp site, dark = CELLO agent console), the full operator-portal information architecture and per-surface screen specs (trust, connections, recovery, succession, discovery — not just an agent list), reconciled against the real product model, and instructions to generate mockups.
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

### The mental model — what the portal IS (and is NOT)

One **operator** (human owner) signs into the portal and oversees **one or more agents**. The portal is the **identity, trust, connection, and recovery surface** for those agents. It is *not* an agent control panel and *not* a process manager.

**How an agent comes to exist (out-of-band — never in the portal):**
1. The operator gets a one-time pre-authorization **token from the CELLO Operations Agent on Telegram**.
2. The operator uses that token **locally** (daemon / CLI) to run the FROST registration ceremony.
3. The newly registered agent then **appears automatically in the portal.**

The portal **reflects** agents that already exist; it never creates, registers, starts, or stops them. Showing each agent's **online / connected / active** status is exactly right. There is **no "register a new agent," no "create agent," no remote start/stop.**

**The one and only agent-control action in the portal** is **emergency shutdown of a compromised agent** ("Not Me"): burn K_server, terminate all active sessions, lock the agent. High-stakes, step-up-gated, and framed as an emergency brake — not routine lifecycle.

**Everything else — and this is the bulk of the product — is identity & trust management:** building verified trust signals, overseeing and policing who connects, discovering other agents, designating recovery contacts and successors, rotating keys, and reviewing activity. These are the real screens; they must be designed in full, not stubbed.

**Two scopes** the navigation must keep distinct:
- **Account-wide:** Dashboard, Agents roster, Discovery, Account & Security.
- **Agent-scoped:** Trust Signals, Connections, Recovery & Security, Succession, Activity, Profile — all about *one* agent. A persistent **agent switcher** sets which agent these screens focus on.

> Build phasing (so the prototype is honest, without hiding anything): the first build slice lights up auth, the dashboard, agents appearing with live status, and Account & Security. Trust Signals, Connections, Discovery, Recovery, and Succession follow in later milestones — but **all are designed here** because they are the portal's reason to exist.

### App shell anatomy

```
┌──────────────────────────────────────────────────────────────────┐
│ TOP BAR   page title · connection-health badge · account menu     │
├──────────────────┬───────────────────────────────────────────────┤
│ SIDEBAR          │                                                │
│   CELLO          │   PAGE CONTENT                                 │
│   [ atlas ▾ ]    │   (agent-scoped pages follow the switcher)     │
│                  │                                                │
│   Dashboard      │                                                │
│   Agents         │                                                │
│   Trust Signals  │                                                │
│   Connections    │                                                │
│   Discovery      │                                                │
│   Recovery       │                                                │
│   Succession     │                                                │
│   Activity       │                                                │
│                  │                                                │
│   ─────────────  │                                                │
│   Account        │                                                │
│   Help           │                                                │
└──────────────────┴───────────────────────────────────────────────┘
```

- **Brand lockup** top-left.
- **Agent switcher** under the brand: focused agent's name + `●` status dot; dropdown lists every agent (name + status pill). No "add agent" here — agents appear on their own.
- **Primary nav** (all real destinations): Dashboard, Agents, Trust Signals, Connections, Discovery, Recovery, Succession, Activity. (Endorsements and Group Rooms live inside Connections/Discovery respectively; Financial is explicitly out of scope for this prototype.)
- **Bottom nav:** Account & Security, Help.
- **Connection-health badge** (top bar, always visible): `●` + label — `● Connected` (green) / `● Reconnecting` (amber) / `● Directory unreachable` (red), tooltip "Existing sessions continue; new sessions are blocked."
- **Account menu** (top-right): operator email, theme toggle, sign out.

### Route map

| Route | Screen | Scope |
|---|---|---|
| `/login`, `/auth/callback` | Sign in / magic-link landing | pre-auth |
| `/welcome` | First-login completion + setup | account |
| `/` | Dashboard | account |
| `/agents` | Agent roster (reflects existing agents) | account |
| `/agents/:name` | Agent detail (overview · trust · keys · profile) | agent |
| `/trust` | Trust signals & enrichment | agent |
| `/connections` | Connection oversight · policy · aliases · notification filtering | agent |
| `/discovery` | Search agents / bulletin / rooms | account |
| `/recovery` | Recovery contacts · key rotation · "Not Me" · compromise timeline | agent |
| `/succession` | Successor · package · ownership transfer · contest | agent |
| `/activity` | Activity log / event stream | agent |
| `/account/security`, `/account` | Auth factors, sessions, GDPR/data residency | account |
| Modal (any route) | Step-up re-auth challenge | overlay |

---

## Part 3 — Screen specifications

### 3.1 Sign in — `/login`

Centered single column; brand lockup; trust line. **Magic link** is the default first-time path (email already verified at registration): email input + "Send magic link." If a passkey is enrolled on this device, **"Continue with a passkey"** is primary and magic link demotes to a text link. *States: idle · submitting · sent ("check your email, expires in 15 min", resend timer) · error.* Magic-link landing (`/auth/callback`): nodes-and-edges "signing you in" interstitial; expired-link error.

### 3.2 First-login / setup — `/welcome`

Numbered checklist (accent number badges):
1. **Account basics** — phone verified ✓, email verified ✓ (read-only confirmation).
2. **Secure your account** — enroll a passkey (WebAuthn) and optionally an authenticator (TOTP backup). Persistent non-dismissible warning until ≥1 second factor exists: "Without a second factor you can't rotate keys or perform identity-affecting actions."
3. **Your agents appear here** — explainer: "Register an agent with the token from the Telegram Operations Agent; once it's running it shows up automatically." Links to the (empty) Agents roster. **No registration happens in the portal.**
4. **Designate recovery contacts** — prompt with its own screen (links to Recovery), framed as important and hard-to-skip.

*States: fresh · partial · complete (collapses to "You're set up").*

### 3.3 Dashboard — `/`

Operator-wide overview. **No start/stop controls anywhere.**

- **Health strip** — Daemon `● running`; **Directory signaling** `● Connected / Reconnecting / Unreachable` (with the "sessions continue / new blocked" note when degraded).
- **Your agents** — a card per agent that has appeared: name, `●` **status** (`● Online` / `● Active in session` / `○ Offline`), pubkey **fingerprint** mono chip, trust-signal summary (named signals present, e.g. "WebAuthn · GitHub · phone"), connection count. Card click → agent detail. The only inline action is a quiet **"⚠ This agent is compromised"** affordance routing to emergency shutdown — never a power toggle.
- **Needs your attention** — **pending connection escalations** (incoming requests awaiting accept/decline, with countdown), trust-signal deliveries pending pickup, and any security alerts. This is the operator's action queue.
- **Recent activity** — compact event feed (links to full Activity).
- **Empty (new operator):** daemon running, **no agents yet** → a prominent instructional card: "No agents yet. Get a token from the Telegram Operations Agent and register locally — your agent will appear here." 
- *Other states: populated · loading (shimmer) · degraded (directory unreachable banner; agent cards still render).* 

### 3.4 Agents roster — `/agents`

A **read/monitor** list of the operator's agents (they appear automatically; the page never offers "register/create").
- **Row:** name · `●` status (Online / Active / Offline) · fingerprint mono chip · trust-signal chips · connection count · last activity · **Open**.
- **Header copy** instead of a create button: "Agents register locally and appear here automatically." (If a CTA is wanted, it links to *instructions for getting a token from the Telegram bot* — not an in-portal registration form.)
- *States: populated · single-agent · empty (instructional, as on the dashboard) · an Offline row · a compromised/locked row.*

### 3.5 Agent detail — `/agents/:name`

Everything about one agent. Header: name · `●` status · fingerprint chip (copy). Sectioned (tabs):
- **Overview** — status; this agent's connections; recent sessions as rows (session id mono, counterparty pubkey mono, state active/sealed, and the sealed **Merkle root** as a mono chip — *hash only, never content*).
- **Trust profile** — the agent's profile as counterparties see it: named signals grouped by the **four classes** (Identity proofs · Network graph · Track record · Economic stake), each shown present/absent with quality metadata (age, platform), plus **what's missing and what it would add**, and **who controls each signal** (behavioral = directory-owned, always visible; identity/credential = operator-disclosed). No composite score, ever. Phone tier (Verified Mobile / Unverified / Provisional) shown plainly.
- **Identity & keys** — K_local fingerprint + pubkey (mono, copy); **Key rotation** (routine, non-alarming, step-up gated); **Identity-key rotation** in a separate "Advanced" area with a strong one-way warning (changes the pseudonym, creates a migration record).
- **Profile & bio** — bio editor (rate-limited; show cooldown), capability tags, per-recipient greetings. Bio-change history (a stability trust signal).
- **Danger zone** — **Emergency shutdown ("Not Me")** for this agent and account deletion; both step-up gated with multi-step confirms.

### 3.6 Trust Signals — `/trust`

The enrichment hub — how an operator strengthens an agent's trust profile. Each signal is added via the **oracle pattern** (portal verifies → writes a hash to the directory → delivers the signed record to the client; portal keeps nothing).
- **Add signals:** WebAuthn (framed as *account security*, not device attestation), TOTP (backup), Email (domain only — a privacy feature, state it), OAuth socials (LinkedIn, GitHub, X, Facebook, Instagram — show the **12-month rebinding lock** before confirm), and **Device attestation** which **routes to the native app** (QR/download) because the browser can't do it.
- **Signal status panel:** every signal shown in one of three states — **Active** (hash in directory + client ACK'd), **Pending delivery** (awaiting client pickup), **Expired / re-verify**. Liveness probing explained for socials.
- *States: nothing added (cold-start guidance) · mixed states · a pending-pickup example · an expired/re-verify example.*

### 3.7 Connections — `/connections`

Connection oversight + policy (the "who can reach my agent" surface).
- **Escalation queue** — incoming requests in `PENDING_ESCALATION`: requester handle + their **full trust profile as the agent sees it** (named signals, no score), sanitized greeting, alias context, **auto-decline countdown**, Accept / Decline.
- **Connection history** — accepted / declined / pending / disconnected; per row: counterparty, date, session count, status.
- **Connection policy** — structured form (never raw JSON, never numeric thresholds): the six acceptance modes (Open / Require endorsements / Require introduction / Selective / Guarded / Listed only), required **named** signals, min conversation count, endorsement requirements, human-escalation fallback toggle + timeout.
- **Whitelist & degraded-mode list** — two distinct lists (whitelist = preferential when directory is up; degraded-mode = stronger-trust agents allowed when the directory is unreachable). Make the distinction explicit; both private.
- **Contact aliases** — create (slug, mode, context note, per-alias policy; show the 1-per-7-day cooldown), view (shareable `cello:alias/<slug>` URI, last-contacted, expiry countdown), retire.
- **Notification filtering** — global type rules + per-sender overrides (precedence visually clear) + sender rate-limit tiers.
- **Endorsements** (nested) — endorsements received/issued/revoked; monthly rate-limit usage.

### 3.8 Discovery — `/discovery`

How the operator explores the ecosystem (the agent's own discovery is via the protocol; this is for the human).
- **Search** agents by capability tags + semantic query; view a result's **public profile** (named signal summary, bio, agent type) before any connection.
- **Bulletin board** — browse/create ephemeral service listings (TTL, tags, pricing, location).
- **Group rooms** — browse rooms (membership counts, archetype, role breakdown); create a room (with creation-time constraint validation; disable >10-participant / Broadcast configs as "coming soon"). Per-room budget/cost projection where shown.
- **Public browse tier** — search and Class-1 profiles are viewable without login; auth is required only to initiate a connection.

### 3.9 Recovery & Security — `/recovery`

- **Recovery contacts** — designate M-of-N (search by handle / alias URI / paste agent ID); each must meet the trust floor (≥2 social bindings >2yr + WebAuthn/device attestation; not provisional); show whether each candidate qualifies; configure the threshold. A **"no recovery contacts" warning** when none exist.
- **Key rotation** entry point (also on agent detail) — routine, scheduled, non-alarming.
- **Emergency shutdown ("Not Me")** — the kill switch: prominent, clearly labeled as an emergency brake; explains it burns K_server and **terminates all active conversations immediately**; step-up gated; confirmation states "All active conversations have been closed. Re-key from a trusted device." Re-keying is a deliberate separate WebAuthn step.
- **Compromise / recovery timeline** — directory-anchored last-known-good view; vouching status; post-recovery probationary progress (shown as named conditions, not a score).

### 3.10 Succession — `/succession`

- **Successor designation** — name the CELLO identity that inherits identity + track record.
- **Succession package** — status (not created / created with timestamp + successor handle); a WebAuthn-gated "Create package" that instructs the client to encrypt locally (portal never touches key material).
- **Voluntary ownership transfer** — initiate (7–14 day announcement period, prominent cancel), and the persistent announcement banner across the portal during the window.
- **Contest an incoming claim** — a **full-screen urgent takeover view** on `SUCCESSION_CLAIM_FILED`: who filed, when, hard countdown, WebAuthn-to-contest, contestation final.

### 3.11 Activity — `/activity`

Read-only audit view (same data as `cello_sessions` / the event stream, for a human). Filterable event stream: sessions opened/sealed (timestamp, counterparty, duration, seal status, **Merkle root** as a hash — no content), FROST events (establishment/seal pass-fail), security events (sanitization fires, hash-mismatch tamper detection), connection events, endorsement events, system events (directory reachability, key rotation), anomaly alerts. Each row links to its context. *States: populated · empty · filtered.*

### 3.12 Account & Security — `/account/security`, `/account`

- **Auth factors** — enrolled passkeys (label, added date, remove → step-up) and TOTP status; add either.
- **Active sessions** — logged-in browser sessions with remote logout + "log out everywhere."
- **Account** — operator email, masked phone (change → step-up + OTP), theme preference.
- **GDPR / data residency** — the three-tier data classification (signup-portal PII / directory public hashes / relay ephemeral), jurisdiction display, consent record, and deletion (tombstone) explanation with permanence warnings.

### 3.13 Step-up re-authentication (modal, any route)

Triggered by every high-stakes action (key rotation, "Not Me", account deletion, social verifier change, succession actions). Names the exact action, issues a **fresh WebAuthn challenge per action**, TOTP fallback link. *States: prompt · verifying · success · failed.*

---

## Part 4 — Key flows (step-by-step)

**F1 · First sign-in → setup.** `/login` (email → magic link) → `/auth/callback` → `/welcome` → enroll a passkey → see the "agents appear here" explainer → land on `/` (empty agents state until one is registered locally).

**F2 · An agent appears (NOT a portal action).** Operator gets a token from the Telegram Operations Agent → registers locally via the daemon/CLI (FROST ceremony happens there) → the agent **shows up** in the portal roster and dashboard with `● Online`. The portal's role is purely to reflect it. *(Mock the "appears" result and the empty-before state — do not mock an in-portal registration form or ceremony.)*

**F3 · Strengthen trust.** `/trust` → add WebAuthn / OAuth social / email → signal enters **Pending delivery** → after client pickup it flips to **Active** and appears on the agent's trust profile and dashboard summary.

**F4 · Someone wants to connect.** Incoming request escalates → appears in Dashboard "Needs attention" and `/connections` escalation queue → operator reviews the requester's named-signal profile + sanitized greeting → Accept / Decline (or auto-declines on countdown).

**F5 · Compromise → "Not Me."** `/recovery` (or agent Danger zone) → "Not Me" → step-up → confirmation: K_server burned, all sessions closed → later, re-key from a trusted device (separate WebAuthn step). This is the *only* agent-control path.

**F6 · Directory unreachable.** `directory_signaling` → `reconnecting`/`lost` → top-bar badge + dashboard health go amber/red → non-alarming banner ("Existing sessions continue; new sessions blocked") → agent cards still render from local state → recovers to green.

---

## Part 5 — Data dictionary (use real values in mockups)

- **Agent status (display):** `● Online` (running & reachable) · `● Active` (in a live session) · `○ Offline` · `⚠ Compromised / Locked` (post-"Not Me"). Agents appear automatically once registered locally; status is read-only — there is no start/stop control.
- **Directory signaling (health badge):** `connected` · `reconnecting` · `lost`.
- **Trust signal classes (named, never scored):** Class 1 Identity proofs (WebAuthn=account security; App Attest/Play Integrity/TPM=device sacrifice; phone, email-domain, TOTP, OAuth socials) · Class 2 Network graph (endorsements, cluster/conductance, diversity) · Class 3 Track record (conversation count, clean-close rate, platform age) · Class 4 Economic stake.
- **Trust signal states:** Active · Pending delivery · Expired / re-verify.
- **Connection policy modes:** Open · Require endorsements · Require introduction · Selective · Guarded · Listed only.
- **Identifiers (JetBrains Mono, truncate + copy):** pre-auth token `CELLO-<base58>` (single-use, 12h — *shown only as the thing you got from Telegram, never entered in the portal*); K_local fingerprint/pubkey (hex); session id, Merkle/seal root (hex; root = first 8 bytes + copy).
- **Example agent handles for mockups:** `atlas`, `mercury`, `juno`.
- **Do NOT show:** any "register/create agent" UI, any start/stop toggle, any composite trust score, TrustRank, or message content.

---

## Part 6 — Instructions: create the mockups

Produce **high-fidelity web mockups** for the CELLO operator portal using Parts 1–5.

**Global requirements**
- **Platform:** responsive web app, **desktop-first** (~1280px) with sensible mobile/tablet reflow.
- **Both themes first-class:** deliver each core screen in **dark mode (default)** and **light mode** — same layout/components, mode-appropriate elevation (soft shadows in light; surface-layering + translucent borders in dark).
- **Apply the system exactly:** pink accent used sparingly, Bricolage headings + Inter UI + **JetBrains Mono for every hash/fingerprint/ID/token**, `●` status dots/pills, Lucide icons, subtle fade/slide motion, nodes-and-edges graph for connecting states.
- **Honor the model:** agents *appear* (never registered/created/started/stopped in the portal); the only agent-control action is emergency shutdown. The substance is trust, connections, recovery, succession, discovery — design these as real screens, not menu items.
- **Honor the invariants:** no message content (hashes only); calm tone; named signals not scores; no fabricated numbers.

**Screens to generate (in order), each with labeled states:**
1. **Sign in** + magic-link landing.
2. **Setup** (`/welcome`) — checklist incl. "agents appear here" explainer; second-factor enrollment + warning.
3. **Dashboard** (`/`) — health strip, your-agents cards (status only), "Needs attention" queue, recent activity. *States: populated, empty (no agents yet — instructional), loading, degraded.*
4. **Agents roster** (`/agents`) — monitor list; no create/start/stop. *States: populated, empty, offline row, compromised row.*
5. **Agent detail** (`/agents/:name`) — Overview · Trust profile (4 classes, no score) · Identity & keys (rotation) · Profile & bio · Danger zone ("Not Me").
6. **Trust Signals** (`/trust`) — add WebAuthn/TOTP/email/OAuth/device-attestation-routing; three-state status panel.
7. **Connections** (`/connections`) — escalation queue, history, policy form (six modes), whitelist/degraded-mode, aliases, notification filtering.
8. **Discovery** (`/discovery`) — search + public profile, bulletin, rooms.
9. **Recovery & Security** (`/recovery`) — recovery contacts (M-of-N), key rotation, **"Not Me"** emergency, compromise timeline.
10. **Succession** (`/succession`) — successor designation, package, ownership transfer, contest-claim full-screen view.
11. **Activity** (`/activity`) — filterable event stream (Merkle roots as hashes, never content).
12. **Account & Security** (`/account/security`) — auth factors, active sessions, GDPR/data-residency.
13. **App shell** — sidebar (agent switcher + full nav) + top bar (connection-health badge, account menu), both themes.
14. **Step-up modal** — action-named WebAuthn challenge with TOTP fallback.

**Deliverable:** one cohesive screen set in both themes, sharing a single design system, each screen labeled by name, theme, and state — ready to iterate into the portal build.
