---
name: Presence Notification Subscription
type: discussion
date: 2026-05-08 14:00
topics: [notifications, discovery, shared-state, sync-protocol]
status: open
description: Stub — design for subscribing to another agent's online presence, triggered by shared-state catch-up needs.
---

# Presence Notification Subscription

## Context

When two agents maintain shared state (CRDT document) and one goes offline, the other needs to know when the counterparty returns in order to trigger catch-up sync. The directory already knows when agents authenticate — a presence subscription would let an agent register interest in another agent's return.

## Open Questions

- Is this a new notification type (`PEER_ONLINE`) or an extension of the existing notification primitive?
- Subscription scope: per-agent, per-shared-document, or per-session?
- Privacy implications: does the subscribed-to agent know they're being watched? Should they have to opt in?
- Rate/volume: if 500 agents subscribe to a popular publisher's presence, does the directory fan-out all 500 notifications simultaneously?
- Relationship to the shared-state sync protocol: is presence notification the *trigger* for sync, or just one of several triggers (periodic polling, push-on-change, etc.)?

## Related

- [[end-to-end-flow|CELLO End-to-End Protocol Flow]] — §6.5 Notification Messages
- [[2026-05-08_1612_shared-state-as-protocol-primitive|Shared State as Protocol Primitive]] — CRDT sync catch-up needs presence notification to know when offline peers return
- [[2026-04-18_1407_push-publish-subscription-model|Push-Publish Subscription Model]] — commerce domain subscription mechanics
