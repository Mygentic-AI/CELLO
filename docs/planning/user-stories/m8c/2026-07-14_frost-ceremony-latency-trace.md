---
name: frost-ceremony-latency-trace
type: analysis
date: 2026-07-14
topics: [frost, latency, session-establishment, federation, scaling, threshold-signing, directory]
status: open
description: >
  DOD-FROST-PARALLEL-1 — a full two-sided trace of session establishment (client daemon log +
  directory CloudWatch), every hop, no aggregation. Session setup is ~4.1s at ONE directory. The
  crypto is 41ms of it. The client walks the directory roster SERIALLY (an explicit "NOT
  Promise.all"), so each added directory costs ~700ms of setup. This is a GATE ON NODE EXPANSION,
  not a perf nice-to-have.
---

# `DOD-FROST-PARALLEL-1` — the ceremony is serial, and that gates the federation

> **This is not a latency optimisation. It is a precondition for adding directory nodes.**
> At today's N=1 the setup is ~4.1s and Andre has explicitly accepted that ("four seconds to create a
> session is not bad"). The serial roster walk costs nothing when there is one node. It costs
> everything at ten. **Fix it BEFORE the federation grows, not after** — after means every agent
> already registered under the old threshold.

## How this was measured (so it can be re-run, and so nobody re-derives it)

Two agents on ONE daemon (`Ms_Chelly` → `Ms_Chelly_Hermes`), driven entirely from bash so **no LLM
turn contaminates the stamps**. Session `fe1badd51a0cff4931fc6f294a96bc36`, 2026-07-14 ~10:19 UTC.
Both sides' logs pulled: the client daemon (`~/.cello/daemon.log`) and the directory
(CloudWatch `/ecs/cello-directory-dev`, us-east-1).

**Two clocks.** The directory's clock runs AHEAD of the client's. Proof, not assumption: the client
logs `assignment.received` at `…355810` while the directory logs *sending* it at `…356265` — you
cannot receive something 455 ms before it is sent. Solving the round trip in both directions gives
**one-way network latency ≈ 165 ms** and **clock skew ≈ 630 ms**. Deltas WITHIN one machine are
exact; cross-machine deltas are skew-corrected and approximate.

**A note on method that cost an hour:** the first attempt measured this through the MCP tools and got
41 seconds — of which ~28 s was one model composing a message and ~13 s was the other model getting
around to reading it. **The wire was 2 ms.** Tool-level stamps measure the LLM, not CELLO. The daemon
log is the only honest instrument. Do not repeat that mistake.

## The full trace — every hop, in causal order

`[C]` = client (your Mac) · `[D]` = directory (us-east-1) · `~165ms` = a network crossing

```
[C] 351670  CLI process connects to daemon (IPC accepted)
[C] 351671  IPC connected                                          +1ms
[C] 351672  agent switched to Ms_Chelly                            +1ms
            → discovery lookup sent                                          ~165ms →
[D]         profile read (cache_hit)
[D]         discovery.lookup — target online, owningNode us-east-1  +2ms
            ← discovery result                                               ~165ms ←
[C] 352023  discovery result in hand              (351 ms round trip)
            → session_offer sent                                             ~165ms →
[D] 352836  session request received: 178d420b → 77d0c806
[D] 352837  session_request.enter — target stream found            +1ms
[D] 352837  signer lookup — ClientDelegatedSigner found            +0ms
            → directory pushes session_offer to the TARGET agent            ~165ms →
[C] 352381  session.offer.accepted — target accepts, sends accept back
[D] 353181  [FROST] Ceremony begin                        (345 ms after the session request)
[D] 353182  ceremony_request SENT to client — now WAITING           +1ms
            ← ceremony_request                                               ~165ms ←
[C] 353981  frost.directory.commitment.start   ← request arrived
[C] 353981  frost.directory.stream.opening     ← opens a BRAND NEW libp2p stream
[C] 354332  frost.directory.stream.open.ok                       +351ms   ⚠️ STREAM OPEN #1
            → commit_request                                                 ~165ms →
[D] 355135  commit_request received
[D] 355141  generateCommitment.enter                                +6ms
[D] 355141  getShare — share found                                  +0ms
[D] 355141  share_lookup ok                                         +0ms
[D] 355141  nonce_sweep — 0 expired                                 +0ms
[D] 355142  nonce_generated                                         +1ms
[D] 355142  generateCommitment.success                              +0ms
[D] 355142  commit_response SENT                                    +0ms
            ── the directory's actual commitment crypto: 7 ms ──
            ← commit_response                                                ~165ms ←
[C] 354678  frost.directory.commitment.response  ← commitment in hand
[C] 354678  frost.directory.sign.start                              +0ms
[C] 354679  frost.directory.sign.stream.opening ← opens a SECOND BRAND NEW stream
[C] 355021  frost.directory.stream.open.ok                        +342ms   ⚠️ STREAM OPEN #2
            → sign_request (framedMsg 454 bytes, commitmentList=2)           ~165ms →
[D] 355830  sign_request received
[D] 355837  signRawMessage.enter                                    +7ms
[D] 355837  conflict_check                                          +0ms
[D] 355837  nonce_lookup — pending found, not expired               +0ms
[D] 355837  share_from_nonce                                        +0ms
[D] 355837  calling_signShare                                       +0ms
[D] 355864  signShare_success — 32-byte signature                  +27ms
[D] 355864  sign_response SENT                                      +0ms
            ── the actual FROST signing: 34 ms ──
            ← sign_response                                                  ~165ms ←
[C] 355406  frost.directory.sign.response  ← signature in hand
[C] 355442  session.ceremony.participated                          +36ms
            → ceremony_result                                                ~165ms →
[D] 356264  ceremony_result received
[D] 356265  Assignment issued                                       +1ms
[D] 356265  session_assignment SENT to INITIATOR                    +0ms
[D] 356266  session_assignment SENT to TARGET                       +1ms
[D] 356266  Delivery complete — both got it                         +0ms
[D] 356272  persisted to Postgres                                   +6ms
            ← session_assignment                                             ~165ms ←
[C] 355809  assignment received (unverified)
[C] 355810  negotiate.assignment.received                           +1ms
[C] 355810  session.node.created ×2 (both agents)                   +0ms
[C] 355811  inbound.accepted                                        +1ms
[C] 355815  standing receivers created                              +4ms
[C] 355818  session.transport.connected            ← SESSION LIVE   +3ms
```

## Where the ~4.1 seconds goes

| | |
|---|---|
| Two brand-new libp2p stream opens, **in series** | **693 ms** |
| Network crossings (12 of them, ~165 ms each to us-east-1) | **~2,000 ms** |
| Directory waiting for the target to accept the offer | 345 ms |
| Discovery lookup round trip | 351 ms |
| CLI + daemon + IPC startup | ~490 ms |
| Assignment delivery + session-node setup | ~410 ms |
| **The directory's actual cryptography (commitment + signing)** | **41 ms** |

**The cryptography is 1% of the cost.** Everything else is network round trips and stream opens. The
thing everyone assumes is expensive is the cheapest thing in the trace.

## The defect: the client walks the roster SERIALLY

`core/crypto/src/frost/frost-threshold-signer.ts:484` (Round 1, commitments) and the matching Round 2
(signatures):

```js
// "Round 1: generate fresh nonces + commitment list. Gather per-stub (NOT Promise.all) so a stub
//  that FAILS or REFUSES its commitment … is added to ceremonyExcluded and the attempt retried
//  with the survivors …"
for (const s of selected) {
  r = await Promise.race([s.generateCommitment(), commitTimeout]);
}
```

**The comment's reasoning is CORRECT and must be preserved.** A node that refuses (SUSPENDED) or hangs
(silent drop / hung TCP) must be routed around, excluded, and the round retried with survivors — that
is `DOD-SUSPEND-1` and the sovereign-node availability invariant. A naive `Promise.all` would reject
the whole ceremony on one bad node, which is exactly the failure the comment exists to prevent.

**But that reasoning does not require SERIALISM.** `Promise.allSettled` delivers the identical
exclusion semantics — fire every commitment at once, collect what came back, exclude the failures and
timeouts, retry with the survivors — while paying the cost of the **slowest** node instead of the
**sum** of all of them. Both rounds parallelise for the same reason: commitments are independent of
one another, and signature shares are independent once the commitment list is fixed. That is FROST's
shape.

## Why this gates node expansion

Today `commitmentList = 2` — the client (which holds a share) plus **one** directory. One node, so
the serial loop costs nothing, and setup is ~4.1 s.

At **N=10** with `T = majority(10) = 6`, the client needs **5 directory stubs** plus itself, walked
one at a time. Each costs a stream open (~350 ms) plus a commit round trip (~330 ms), then a signing
round trip (~350 ms):

- Round 1 (commitments): 5 × ~680 ms ≈ **3.4 s**
- Round 2 (signatures):  5 × ~350 ms ≈ **1.75 s**

**≈ 5 seconds ADDED**, and that uses the 165 ms measured to us-east-1 — the far regions
(ap-northeast-1) are slower. Session setup goes from ~4 s to **9–12 s**.

**Andre's bar (2026-07-14): "four seconds is not bad; ten seconds is getting long; anything under a
few seconds is fine."** The serial walk crosses that line at roughly **3–4 directories** — well before
10. So this is not a "later" item; it is the thing that decides whether the federation can grow at all.

## The work

- [ ] **F1. Parallelise Round 1 (commitments)** — `Promise.allSettled` over `selected`, preserving the
      per-node timeout race and the exclude-and-retry-with-survivors path exactly as it is today.
      **The exclusion semantics are the point; do not simplify them away while making it parallel.**
- [ ] **F2. Parallelise Round 2 (signatures)** — same shape, same constraint.
- [ ] **F3. Reuse ONE FROST stream for commit + sign** instead of opening a second (~350 ms per
      directory today; ~1.75 s at N=10). Largely absorbed by F1/F2 once the rounds are parallel, but
      it is the difference between "hidden behind the slowest node" and "not paid at all".
- [ ] **F4 (optional). Keep a warm FROST stream** to each directory, opened at `agent.online` rather
      than at ceremony time — takes the stream open off the critical path entirely.
- [ ] **F5. Prove it with the same instrument.** Re-run the bash-driven, no-LLM trace above against a
      MULTI-node consortium roster and put the before/after table in this document. A green unit test
      does not measure latency; the two-sided log does.

## Two other things this trace surfaced (not latency, logged so they are not lost)

- **`session.relay.hash.submit.failed` fires on EVERY session**, client-side, and is swallowed — the
  session proceeds regardless. A silent failure on the tamper-evidence path. Not diagnosed.
- **The directory floods production CloudWatch with `frost.debug.*` and raw `[DEBUG]
  ClientDelegatedSigner:` lines**, including share/nonce internals. That is noise and it is logging
  crypto internals into a log group. Worth a pass before anyone calls the directory production-ready.

## Not in scope

The **CLI's ~490 ms Node boot per invocation** (`cello status` costs that doing no protocol work at
all) is real felt latency for any bash-driven agent, but it is not session establishment and does not
scale with nodes. Separate item if it ever matters.

## Related

- [[M8C-DEFINITION-OF-DONE]] — where `DOD-FROST-PARALLEL-1` is tracked.
- `core/crypto/src/frost/frost-threshold-signer.ts` — the serial loop, and the comment explaining the
  exclusion semantics that must survive the fix.
