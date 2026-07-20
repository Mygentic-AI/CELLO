---
name: Waitlist & Analytics Technical Architecture
type: architecture-research
date: 2026-07-18
topics: [waitlist, postgres, analytics, email, aws, architecture, growth]
status: active
description: >
  Technical architecture best practices for self-hosted waitlist, points engine,
  multi-touch attribution, and email drip campaigns using AWS and OSS. Sourced via Perplexity.
---

# Waitlist, Referral, and Analytics Engine Architecture

Here’s a complete, no-SaaS, AWS-native + open-source architecture for your waitlist, referral, and analytics engine, tailored to your stack (Postgres, AWS SES, Lambda, TypeScript/Rust).

## 0. High-level architecture

You’ll run four logical layers:

1. **Frontend / Landing page** (Next.js/React, static on S3/CloudFront or ECS)
2. **Tracking & Attribution Layer**
   - Client-side: UTM capture, first/last touch, multi-touch history in `localStorage`
   - Server-side: API to persist touchpoints + signup events to Postgres
3. **Waitlist & Points Engine**
   - Postgres schema for users, referrals, points, queue position
   - Background jobs (Lambda + EventBridge / pg_cron) for point accrual, queue recompute
4. **Email Automation**
   - AWS SES for delivery
   - Lambda + SQS (or EventBridge Scheduler) for transactional + drip emails

## 1. Inbound tracking & attribution

### 1.1. Tracking model
Attribute each signup to First touch, Last touch, and Multi-touch (full journey).
Data needed per touchpoint: `user_anon_id` (stable anonymous ID in localStorage), `timestamp`, `url`, `referrer`, UTM params, Custom params (`ref=creator_id`).

### 1.2. Client-side implementation
1. Generate/persist anonymous ID (`wl_anon_id`) in `localStorage`.
2. Parse URL params on every page load.
3. Maintain multi-touch history in an array in `localStorage`, appending new meaningful hits.
4. Send full journey array on signup to the backend.

### 1.3. Server-side schema & API
Core Postgres tables needed:
- `waitlist_users`: id, email, anon_id, status, points_total, queue_position
- `waitlist_touchpoints`: waitlist_user_id, anon_id, ts, utm_*, ref
- `referral_codes`: code, owner_user_id
- `referrals`: referrer_user_id, referred_user_id, referral_code
- `points_ledger`: waitlist_user_id, points, reason

### 1.4. Using GA4 alongside DB
Use GA4 for high-level trends (page views, overall conversion rates) but treat your Postgres database as the primary source of truth for waitlist-specific, referral-driven attribution.

## 2. Waitlist & points engine

### 2.1. Queue model
Use a computed position based on `points_total` and `created_at` using a SQL View, rather than hardcoding. 
Rule: Show users their queue position as the primary metric, using points purely as the internal engine.

### 2.2. Points rules
Define centrally (e.g., Signup +10, Survey +20, Referral +50). Insert into ledger and update total.

## 3. Email automation (AWS-native)

### 3.1. Transactional emails (immediate)
Pattern: Lambda + SES. Frontend calls signup API -> inserts user -> pushes to SQS -> Lambda sends SES confirmation email.

### 3.2. Drip / delayed sequences
Pattern: SQS delay queues or a time-based job table (`email_jobs` with `scheduled_at`, `status`). A background Lambda (EventBridge cron) polls the table every minute, evaluates if points/time thresholds are met, and fires SES.

## 4. Multi-touch point & return visitor tracking

### 4.1. Link generator
Build a simple internal tool to take a base URL, channel, campaign, and ref_code to output standardized UTM tracking links for creators.

### 4.2. Persisting history
Cap the touchpoint array in `localStorage` (e.g., 20) and de-duplicate identical consecutive clicks. Migrate `anon_id` to `user_id` on signup.

### 4.3. Writing to Postgres
On signup, insert all touchpoints. Compute `first_touch` and `last_touch` for fast reporting.

---
*Note: This document was originally generated via Perplexity AI research on best practices for self-hosted, AWS-native tracking engines.*
