---
name: 2026-08-09 Landing Page Social Proof & Multiplayer Reframing Spec
type: discussion
date: 2026-08-09
updated: 2026-08-09
topics: [landing-page, marketing, social-proof, multiplayer, problem-diagnosis, testimonials]
status: active
description: >
  Implementation specification for updating cello.mygentic.ai landing page:
  reframing the problem cards around "Your agents aren't multiplayer because...",
  removing redundant "About / How It Works" section, and adding 3 authentic vertical
  quote cards (Aaron Epstein, Reid Hoffman, Greg Isenberg) without meta-labels.
---

# 2026-08-09 — Landing Page Social Proof & Multiplayer Reframing Spec

## 1. Overview & Architectural Decisions

Following our landing page strategy sessions and audit against Max's 5-step framework:

1. **Top of Fold**: The top of the fold is shipped and performing (`<Hero />` with `<VerifiedConnection />` animated 5-stage live session).
2. **About / How It Works Removal**: The redundant "About CELLO" / "How It Works" text block is removed from the homepage. A dedicated navigation link at the top takes visitors to the full technical breakdown page, keeping the homepage fast and scannable.
3. **Problem Cards Reframed ("Multiplayer")**: The problem section is reframed around the core "multiplayer" narrative: *"Your agents aren't multiplayer because..."*
4. **Social Proof Cards (No Defensive Labels)**: Three vertical 9:16 quote cards are added directly beneath the problem cards. Do NOT add meta-labels like "Industry Consensus" or "What Experts Agree On"—the faces and authentic quotes carry full authority on their own.

---

## 2. Updated Homepage Section Flow

```
1. HERO (Top of Fold)
   ├── Headline & Email CTA
   └── Right Panel: <VerifiedConnection /> (Animated 5-stage live session)

2. PRODUCT DEMO VIDEO (Screencast)
   └── [Feature-flagged slot below hero; renders once 90s screencast exists]

3. PROBLEM DIAGNOSIS (Reframed Around Multiplayer)
   ├── Section Header: "Your agents aren't multiplayer because..."
   ├── Card 1: They have no fixed identity
   ├── Card 2: They have no direct, secure line
   └── Card 3: They have no sovereign paper trail

4. SOCIAL PROOF QUOTE CARDS (No Section Header)
   └── 3 Vertical 9:16 Reel Cards side-by-side:
       ├── 1. Aaron Epstein (Y Combinator): "AI usage is going multiplayer."
       ├── 2. Reid Hoffman (LinkedIn): "Have your agent talk to my agent, and they'll figure it out."
       └── 3. Greg Isenberg (Late Checkout): "Over the next 10 years, you're going to have a market of billions of customers, aka agents with millions of wallets that want to use your services."

5. ICP ALIGNMENT MATRIX ("Is It For You?")
   └── "This is for you if..." vs "This is NOT for you if..."

6. FINAL CTA & WAITLIST SIGNUP
```

---

## 3. Section 1 Copy: Problem Diagnosis ("Multiplayer")

### Section Subhead
> **"Your AI agents aren't multiplayer because..."**

### Card 1: Identity
* **Title**: **They have no fixed identity.**
* **Body**: Without a permanent address or verifiable public key, agents can't discover or recognize each other. Every session starts as an anonymous stranger from scratch.

### Card 2: Transport & Security
* **Title**: **They have no direct, secure line.**
* **Body**: To collaborate today, you are forced to act as a manual data cable—copy-pasting transcripts between chat windows or routing private company data through central cloud middlemen.

### Card 3: Auditability & Privacy
* **Title**: **They have no sovereign paper trail.**
* **Body**: Agents can't share state or log their handoffs without forfeiting data privacy to a third-party server—leaving you with zero cryptographic proof of what was actually said or agreed upon.

---

## 4. Section 2: Social Proof Quote Cards (Assets & Component Spec)

### Asset Paths in Repo
Assets have been generated from authentic video screenshots and placed in the corporate site repository:
* `public/images/testimonials/aaron-epstein-multiplayer.png`
* `public/images/testimonials/reid-hoffman-agent-talk.png`
* `public/images/testimonials/greg-isenberg-billions-agents.png`

Also backed up in docs planning:
* `docs/planning/discussion_logs_drafts/web-corporate-site/mockups/aaron-epstein-multiplayer.png`
* `docs/planning/discussion_logs_drafts/web-corporate-site/mockups/reid-hoffman-agent-talk.png`
* `docs/planning/discussion_logs_drafts/web-corporate-site/mockups/greg-isenberg-billions-agents.png`

### Card Specifications

#### Card 1: Aaron Epstein
* **Image**: `/images/testimonials/aaron-epstein-multiplayer.png`
* **Name**: Aaron Epstein
* **Title**: General Partner, Y Combinator
* **Verbatim Subtitle**: *"AI usage is going multiplayer."*
* **Aspect Ratio**: 9:16 vertical reel card

#### Card 2: Reid Hoffman
* **Image**: `/images/testimonials/reid-hoffman-agent-talk.png`
* **Name**: Reid Hoffman
* **Title**: Co-founder, LinkedIn
* **Verbatim Subtitle**: *"Have your agent talk to my agent, and they'll figure it out."*
* **Aspect Ratio**: 9:16 vertical reel card

#### Card 3: Greg Isenberg
* **Image**: `/images/testimonials/greg-isenberg-billions-agents.png`
* **Name**: Greg Isenberg
* **Title**: CEO, Late Checkout
* **Verbatim Subtitle**: *"Over the next 10 years, you're going to have a market of billions of customers, aka agents with millions of wallets that want to use your services."*
* **Aspect Ratio**: 9:16 vertical reel card

### Component Implementation Guidelines (`Testimonials.tsx` / `SocialProof.tsx`)
* Render the 3 cards in a responsive grid (`grid-cols-1 md:grid-cols-3 gap-6`).
* Use dark rounded container cards (`rounded-2xl border border-neutral-800 bg-neutral-900/50 overflow-hidden`).
* Do NOT display any section header title above the grid (e.g. no "Industry Consensus", no "Testimonials"). Let the cards speak directly for themselves.

---

## 5. Verification & Checklist for Coder Subagents

- [ ] Remove `Layers.tsx` / "About CELLO" from `app/page.tsx` (top navigation link handles deep technical description).
- [ ] Update `ProblemDiagnosis.tsx` header to `"Your AI agents aren't multiplayer because..."` and update the 3 card titles/bodies to Identity, Transport, and Paper Trail.
- [ ] Update `Testimonials.tsx` to render the 3 vertical image cards using the assets in `/public/images/testimonials/`.
- [ ] Ensure no section header text is rendered above the quote cards.
- [ ] Verify responsive layout across mobile, tablet, and desktop views.
