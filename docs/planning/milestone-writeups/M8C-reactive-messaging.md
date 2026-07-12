---
name: M8C — Reactive Messaging & Command Surface
type: milestone-writeup
date: 2026-07-05
updated: 2026-07-12
milestone: M8C
status: open — core tiers built and published, awaiting live confirmation & Tier 5
description: >
  M8C introduces reactive doorbells, legibility (monikers), CLI/MCP parity, inbox reconciliation, 
  away responses, async relay parking (leave-a-message), and the foundation for multi-daemon 
  Primary/Standby device linking.
---

# M8C — Reactive Messaging & Command Surface

**Started:** 2026-07-05 · **Status:** Tiers 1-4 built, awaiting Andre's live confirmation. Tier 5 in progress.

M8C bridges the gap between active polling and passive presence by introducing push notifications, out-of-band message parking, and a major overhaul of the operator's command surface.

## What was delivered

- **Content-Free Doorbells:** In-context `claude/channel` push notifications for session requests and messages, carrying routing metadata but zero message content (`DOD-INV-CONTENTFREE`).
- **Legible Identity (Monikers):** Unverified, caller-ID-style agent names transmitted on the wire, validated at the boundary, and resolved locally. The pubkey remains the absolute identity.
- **Inbox & Reconciliation:** `cello_check_notifications` recovers any push loss. A per-agent, per-session watermark ensures stateful unread tracking.
- **CLI/MCP Parity & Onboarding:** Extensive CLI `--help` improvements, grouped commands, explicit next-step guidance, and exact vocabulary alignment between MCP tools and CLI commands.
- **Async Foundation (Leave-a-message):** When an agent is unreachable, the sender can park the message at a relay via `pickup_queue`. The recipient pulls parked messages on reconnect.
- **Privacy & Contact Control:** Operator-configurable away texts, strict whitelisting, and abuse bounds (size/rate capping).

## What remains
- **Tier 5 (Multi-daemon Primary/Standby):** The primary-transfer design is settled, directory-side arbitration is built, but the ceremony-gate and daemon-side pairing handshake are pending.
- **M9 Integration Merge:** Deferred to after M8C channels work.
- **Live confirmations:** Tiers 1-4 wait on the final live AWS confirmations from Andre on the published beta artifacts (`v0.0.96`/`v0.0.97`).
