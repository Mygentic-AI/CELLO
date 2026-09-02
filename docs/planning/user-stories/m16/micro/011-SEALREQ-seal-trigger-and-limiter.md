---
name: 011-SEALREQ — Requested seals, the local half: trigger and limiter
type: micro-work-order
date: 2026-09-02
status: open
source: DOD-M16-SEALREQ-1
depends_on: [008-EPOCH]
description: >
  A subscriber needing provable evidence NOW can ask the publisher to seal early. The
  transport for that request (a relay frame) does not exist until Tier 3, so this order
  builds the publisher-side half that everything else calls into: a requestSeal entry point
  with the settled limiter — at most one honored request per channel per hour, further
  requests inside the window are no-ops against the just-sealed root — plus the daemon IPC
  verb so the publisher itself can trigger a seal. The relay-borne request lands on this
  entry point in Tier 3.
---

# **<ins>MICRO</ins>** WORK ORDER 011-SEALREQ — Requested seals: trigger and limiter

> ## THE RULES OF A MICRO WORK ORDER
>
> 1. **Read [[M16-PROCEDURE]] IN FULL before you start.** It binds you: the gate, the watchdog
>    cron (§4a — arm it now), the review dispatch, one session = one order. **Do not read
>    `M16-DEFINITION-OF-DONE.md`, `M16-BUILD-JOURNAL.md`, or any design log.**
> 2. **MICRO means small.** One mission. Never grow it.
> 3. **Found something else?** *Newly discovered* at the foot, five lines, keep going.
> 4. **500 lines, hard cap** on this file.
> 5. **Standard procedure applies in full:** tests first → implement → review
>    (`cello-unit-reviewer`) → fix every finding → commit per fix, push per commit. Flip
>    `status:` to `complete` in the SAME commit as the verdict.
> 6. **Done is done.**

---

## The problem, plainly

Before an epoch is sealed, a subscriber has authenticity but no proof against equivocation.
So a subscriber may ASK for a seal. But a seal costs a directory threshold signature, and
"anyone can make the publisher burn one" is a grinding lever — hence the settled rule: **a
request is honored at most once per channel per hour; inside the window it is a no-op that
simply reports the most recent seal.** The publisher's own explicit seal goes through the
same entry point and the same limiter.

**Repo: `/Users/andrep/Documents/code/cello-client`, `core/daemon`.** You consume
`ChannelEpochSealer` (008). The relay-borne request frame is Tier 3; this order exposes the
function it will call plus a daemon IPC verb.

---

## The work

### New file: `core/daemon/src/channel-seal-request.ts`

```ts
export const SEAL_REQUEST_WINDOW_MS = 60 * 60 * 1000;

export type SealRequestOutcome =
  | { honored: true; epoch_index: number; epoch_root: Uint8Array; leaf_count: number }
  | { honored: false; reason: "rate_limited"; latest_epoch_index: number | null; latest_epoch_root: Uint8Array | null; retry_after_ms: number }
  | { honored: false; reason: "epoch_empty"; latest_epoch_index: number | null; latest_epoch_root: Uint8Array | null }
  | { honored: false; reason: "channel_unknown" | "key_unavailable" };

export class ChannelSealRequestGate {
  constructor(deps: { sealer: ChannelEpochSealer; sealStore: ChannelEpochSealStore; logger: Logger; now: () => number });
  /** requester: "publisher" or the requesting subscriber's pubkey hex (Tier 3 supplies it). */
  requestSeal(channelPubkeyHex: string, requester: string, correlationId: string): Promise<SealRequestOutcome>;
}
```

Semantics: keep an in-memory `Map<channelPubkeyHex, lastHonoredAtMs>`. On a request: if
`now - lastHonoredAt < WINDOW` → `rate_limited` with the latest seal's index/root from
`sealStore.latest(ch)` and `retry_after_ms`; emit `channel.seal_request.rate_limited`
(fields `correlationId`, `channel_pubkey`, `requester`, `retry_after_ms`). Otherwise call
`sealer.sealNow(ch, correlationId)`: on `sealed: true` → set `lastHonoredAt = now`, emit
`channel.seal_request.honored` (fields + `requester`, `epoch_index`), return honored; on
`epoch_empty` → do NOT consume the window (nothing was sealed), return `epoch_empty` with
the latest seal info; other refusals pass through. **The window is consumed only by an
honored request.**

### IPC verb

Register `cello_channel_seal` (params `{ agent: <channel agent name> }`) in the same place
and shape as the other `cello_*` IPC handlers (read `register-handler.ts` for the shape).
It resolves the channel pubkey via the identity store (must be a channel — `isChannelAgent`
— else error `not_a_channel`), calls `requestSeal(ch, "publisher", correlationId)`, and
returns the outcome verbatim (bytes hex-encoded). No MCP tool yet (Tier 5).

### Observability

`channel.seal_request.honored`, `channel.seal_request.rate_limited`; `sealNow`'s own events
already cover the seal. No `console.log`.

---

## ⚠️ WHAT MUST NOT CHANGE

- **One honored request per channel per hour — for everyone, including the publisher.** No
  "publisher bypass." The limiter protects the directory, and the publisher's own daemon is
  a client that can be scripted.
- **A rate-limited request is not an error to the requester** — it returns the latest sealed
  root so the requester can verify against SOMETHING. Do not return an empty refusal.
- **An empty epoch does not consume the window.** Otherwise a no-op request could deny a real
  one an hour later.
- **State is in memory only.** A daemon restart resets the window; that is accepted (the
  directory has its own limiter, order 010 step 5). Do not add a table.
- **No relay code, no subscriber-side code, no MCP tool.**

---

## Tests — write ALL of these first, confirm ALL red, then implement

New file `core/daemon/src/__tests__/channel-seal-request.test.ts` (add to
`core/daemon/tsconfig.test.json`). Real encrypted DB, real keys, controllable `now`, 008's
sealer constructed directly (no scheduler), 007's publish helper.

1. `first request with leaves is honored` — publish 2; request → honored, epoch 0,
   leaf_count 2; `channel.seal_request.honored` logged with `requester`.
2. `second request inside the window is rate-limited and reports the latest seal` — publish
   1 more; request at +30min → `rate_limited`, `latest_epoch_index` 0, root equals the first
   seal's root, `retry_after_ms` 1_800_000; the new leaf is NOT sealed (open epoch still has
   1 leaf).
3. `request at exactly one hour is honored` — `now` = first + 3_600_000 → honored, epoch 1.
4. `empty epoch does not consume the window` — fresh channel, no leaves: request →
   `epoch_empty`; publish 1; request immediately → honored (window was not consumed).
5. `publisher and subscriber share one window` — honored as "publisher"; a request as
   `"ab..."` (a subscriber pubkey) at +1min → `rate_limited`.
6. `two channels have independent windows` — honor on A; request on B immediately → honored.
7. `IPC cello_channel_seal on a non-channel agent errors not_a_channel` — through the
   handler with a plain seeded agent.
8. `IPC cello_channel_seal on a channel returns the honored outcome` — hex-encoded root
   matches the store's latest.

---

## Definition of Done

1. Gate class, IPC verb, and events exist as specified.
2. All eight tests exist, went red first (journal), now green; file in `tsconfig.test.json`.
3. **Revert test:** make the window consume on `epoch_empty` and confirm test 4 goes red;
   restore. Change `<` to `<=` in the window check and confirm test 3's exact-hour case goes
   red; restore. Quote both.
4. Gate passes: `pnpm run test` → `pnpm run lint` → `pnpm run typecheck`.
5. **Enforcer (separate OS processes):** spawn the real daemon (`helpers/spawn-real-daemon.ts`)
   with a seeded channel and two pre-published leaves; over the real IPC socket call
   `cello_channel_seal` twice back-to-back; assert the first returns `honored: true` and the
   second `rate_limited` with a non-zero `retry_after_ms`. Quote both replies.
6. Reviewed by `cello-unit-reviewer`, every finding fixed, verdict quoted below and in the
   journal.
7. `status:` flipped to `complete` in the same commit as the verdict.

**Not in scope:** the relay frame that carries a subscriber's request (Tier 3 — it will call
`requestSeal` with the subscriber's pubkey); the MCP tool (Tier 5); directory-side limiting
(010 has its own).

---

## Traps recorded before you start

- **Boundary is `>= WINDOW` honors, `< WINDOW` limits** — test 3 pins the exact hour.
- **Do not seal inside the rate-limited branch "to be helpful."** Returning the latest seal
  is the help; sealing is what the limiter exists to prevent.
- **`core/daemon/tsconfig.test.json`; `@claude-flow/testing`; `setupV3Tests()`.**

---

## Newly discovered

*(add findings here — symptom, file, one-line consequence, five lines max each; keep going)*
