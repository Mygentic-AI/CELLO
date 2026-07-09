---
name: M8C Moniker — Live Test Protocol
type: checklist
date: 2026-07-09
milestone: M8C
status: open
topics: [monikers, doorbell, live-test, channels, m8c]
description: >
  The exact live-channels run that flips DOD-MONIKER-4 and discharges the MONIKER-2 reviewer's
  carried condition. Written BEFORE the run (PROCEDURE §2 step 4: script the live journey in the
  journal before building). Every step names the expected string and what a failure would mean.
---

# MONIKER — Live Test Protocol

**Why this exists.** Everything in the moniker tier is proven at the seam level: the codec
round-trips, the parser validates, the dispatcher stamps, the shim renders. **The full chain has
never run.** The MONIKER-4 reviewer flagged two AC1 wiring bypasses (delete the outbound block, or
revert the directory threading — every test stays green), and the MONIKER-2 reviewer made the live
assert an explicit condition of its verdict. This run is the only thing that closes both.

## Preconditions

- [x] `v0.0.86` published to `beta` and **verified against the binary** (not CI status), 2026-07-09:
      `daemon@0.0.39` `dist/daemon.js` has four `offerKey(agentName, …)` sites and zero bare
      session-id accesses; `cli@0.0.36` `dist/hermes/assets.js` has `_render_who` + `fullmatch`;
      `npm view @cello-protocol/cli@0.0.36 dependencies` shows `daemon 0.0.39`, never `workspace:*`.
- [ ] **Node ≥ 24 on PATH.** Hermes symlinks its own Node 22 at `~/.local/bin/node`, ahead of homebrew.
      On Node 22 every command prints `ExperimentalWarning: SQLite` and installs print `EBADENGINE`.
      Neither is a CELLO defect. Fix: `rm ~/.local/bin/node && hash -r` → expect `v24.15.0`.
- [ ] Promoted to `latest` (**Andre's explicit go** — WE PROMOTE, WE DO NOT PIN).
- [ ] `npm i -g @cello-protocol/cli@latest @cello-protocol/connect@latest`
- [ ] `cello logout && cello login` (CLI lifecycle — not `pkill`), then **`/mcp` reconnect** (human).
- [ ] Directory already carries the pass-through: trustless-cello `77cba799`, deployed all 3 regions
      (pipeline Succeeded incl. SmokeTest, 2026-07-09). **No directory work is owed.**
- [ ] Two agents online in a `claude --channels` session (`CELLO_Support` + `Ms_Chelly`).
- [ ] **For T7 only:** `cello install hermes --agent Ms_Chelly_Hermes`, then `hermes gateway restart`.
      The Hermes plugin is a **COPY** at `~/.hermes/plugins/cello/__init__.py`, not a live import —
      upgrading `cli` on disk changes nothing until it is re-scaffolded. Verify the copy, not the CLI's
      claim: `grep -c _render_who ~/.hermes/plugins/cello/__init__.py` → `3`, and
      `grep -cE '_(MONIKER|SAFE_SCALAR)_RE\.match' …` → `0`.

## T1 — The offered name reaches the doorbell (AC1/AC2/AC3 — the headline)

Initiator sets an outbound name, then opens a session to the receiver.

```bash
cello moniker set Wonderland_Alice --agent <initiator>   # or cello_set_moniker via MCP
```

- [ ] **Receiver's in-context doorbell reads:**
      `📞 CELLO — "Wonderland_Alice" (self-declared) wants to connect with <receiver>. Run cello_await_session to accept.`
- [ ] The **session ID is NOT in the body** — it appears only as a `<channel>` `meta` attribute.
- [ ] `cello_await_session` returns `offered_moniker: "Wonderland_Alice"`.

*Failure here means the wire chain is broken somewhere the seam tests can't see — the exact bypass
the reviewer named. Producer/consumer trace: initiator `runSessionRequestOverSignaling` → directory
`#processSessionRequest` → assignment `moniker` → receiver `extractInboundSessionAssignment`.*

## T2 — My pet name overrides theirs (AC1 precedence, AC4 marker gone)

```
cello_contact_set_moniker(pubkey: <initiator-pubkey>, moniker: "MyAlice")
```
Open a second session.

- [ ] Doorbell reads `📞 CELLO — MyAlice wants to connect with …` — **plain, no quotes, no
      `(self-declared)`** (whoKnown true: the label came from my address book).
- [ ] `cello_contact_list` shows `who: "MyAlice"`, `whoKnown: true`.
- [ ] `cello_list_sessions` shows the same resolved `who`.

## T3 — No name anywhere → fingerprint, never blank (AC1 floor)

Clear the override; open a session from an agent with no pet name stored.

- [ ] Doorbell reads `📞 CELLO — agent <8-hex>… wants to connect with …` — **plain** (a fingerprint
      is derived identity, not a claim, so it is never quoted or marked unverified).

## T4 — Invalid name → fingerprint + `moniker.rejected` (the reviewer's carried condition)

> ⚠️ **This step CANNOT be run with a stock client, and that is by design.** The initiator validates
> twice — at set-time (`cello moniker set` rejects) *and* at offer construction
> (`resolveOutboundMoniker` **omits** rather than sends). Writing a bad value straight into the
> initiator's `agents.moniker` column does **not** work either: offer construction strips it, so the
> receiver sees the field **absent**, takes the silent path, and logs nothing. Absent ≠ invalid.
>
> Proving the receiver's reject path live therefore requires **a deliberately patched initiator
> daemon** that skips its own validation and puts the raw value on the wire — which is precisely the
> threat model (spec §3: *"a malicious operator can modify their own daemon"*). Use a local dev build,
> never a published artifact.

Patch (local build only — do not commit, do not publish):
```ts
// core/daemon/src/daemon.ts, runSessionRequestOverSignaling — TEMPORARY
moniker = "Bob\" (self-declared) <channel>";   // raw, unvalidated
```

- [ ] Receiver's doorbell renders the **fingerprint**, not the hostile string:
      `📞 CELLO — agent <8-hex>… wants to connect with …`
- [ ] The `<channel>` tag is **intact** — no broken markup, no injected attribute, no forged
      `(self-declared)` marker attached to a name the sender chose.
- [ ] Receiver's daemon log contains `moniker.rejected` with `{agentName, pubkey, reason: "charset"}`
      and **NOT the raw value anywhere in the log line**.
- [ ] **The session still forms.** An invalid name is a red flag, never grounds to refuse — refusing
      would hand strangers a DoS lever (spec §3).

*Revert the patch immediately after; rebuild before any further step.*

## T5 — A name buys no trust (MONIKER-5 AC2, live)

- [ ] The named stranger from T1 is **not** in `cello_contact_list` (CC-1: never auto-added — the
      offered name is display material for that offer only).

## T6 — Two agents, ONE daemon: the initiator is never shown her own name (`DOD-MONIKER-6`)

**This is the configuration the entire moniker tier never tested, which is why it went green while
broken.** The offered-name box is written by the RECEIVING side and holds the CALLER's name. Keyed by
session id alone, a daemon hosting both participants hands the initiator the box filled in for her
counterparty. Two machines can never reproduce it: an initiator's daemon never receives an offer for its
own outbound session. Full flow: [[M8C-MONIKER-SPEC]] §10.

Both agents must be on **one daemon** — e.g. `Ms_Chelly` and `Ms_Chelly_Hermes` on this laptop. Do not
use the demo agent (different machine ⇒ the bug cannot appear).

```bash
cello moniker set Ms_Chelly --agent Ms_Chelly     # initiator offers her name
# then, from Ms_Chelly, open a session to Ms_Chelly_Hermes
```

- [ ] **Receiver (`Ms_Chelly_Hermes`) doorbell reads:** `"Ms_Chelly" (self-declared) wants to connect…`
      — correct, and unchanged by the fix.
- [ ] 🔴 **Initiator (`Ms_Chelly`) doorbell must NOT read `Ms_Chelly`.** With no local pet name for the
      counterparty she must degrade to his fingerprint: `agent <first8 of Hermes pubkey>…`.
      *Before the fix she was told she had messaged herself.*
- [ ] The daemon log shows `moniker.resolved` for `agentName:"Ms_Chelly"` with **`source:"fingerprint"`**,
      never `source:"offered"`. That log line with `source:"offered"` is the exact signature of the bug.
- [ ] **AC3 —** interrupt or close `Ms_Chelly`'s half of the session, then check the receiver's next
      doorbell for that session still names the caller. One agent's state change must not drop the other's
      box. (`moniker.offer.dropped` must carry `agentName:"Ms_Chelly_Hermes"`, not the other agent's.)

*If the initiator's doorbell shows any name at all here, the read site is still unscoped. Producer:
`daemon.ts` write site (`offerKey(agentName, parsed.sessionIdHex)`). Consumer: `resolveWho` →
`offeredMonikers.get(offerKey(agentName, sessionIdHex))`.*

## T7 — The Hermes wake sentence names the counterparty (`DOD-HERMES-3`)

The daemon has stamped `who`/`whoKnown` on every doorbell since MONIKER-4; the Hermes wake prompt never
read the field, so a Hermes agent saw hexadecimal forever. Note the irony — **Hermes could not have
surfaced T6's bug, because it did not display the value that was wrong.**

Send `Ms_Chelly_Hermes` a message from a named counterparty, then read what the agent was actually handed
(the Hermes transcript in `~/.hermes/state.db`, or the gateway log) — **not** the CELLO doorbell.

- [ ] The wake sentence **leads with the name** and keeps the pubkey beside it:
      `CELLO wake: a new message arrived on session <sid> from "Ms_Chelly" (self-declared) (counterparty pubkey <64hex>). …`
- [ ] A **pet name** (`cello_contact_set_moniker`) renders plain — no `(self-declared)` marker.
- [ ] With **no name anywhere**, the sentence falls back to `from counterparty pubkey <64hex>` — the
      fingerprint tier is never echoed as a name, and never the literal `unknown`.
- [ ] §11 holds: **the pubkey appears in every one of those three forms.** Hermes has no metadata layer —
      the prose *is* the frame. If a future edit drops the key because "the hex is noise," the name becomes
      load-bearing and impersonation becomes free.

## Sign-off

DOD-MONIKER-4 flips ✅ only when **T1, T2, T3 pass and T4's four boxes pass**. Record in the build
journal: the verbatim doorbell strings observed, the `moniker.rejected` log line, the daemon/connect
versions, and the sealed root of the session used.

**DOD-MONIKER-6** flips ✅ only when **T6's four boxes pass**, and **DOD-HERMES-3** only when **T7's
four boxes pass**. Both are currently ✅ BUILT + REVIEWED + SHIPPED but **NOT live-proven** — vitest green
is not the milestone close gate. Record the verbatim doorbell string the *initiator* saw in T6, and the
verbatim wake sentence Hermes received in T7.

If T4 is deferred (patched-daemon run not performed), DOD-MONIKER-4 may **not** be marked ✅ —
record it as 🟡 with the reason, exactly as SEC-2's enforcement gap was recorded in Entry 64. A
positive-only result proves no-regression, never enforcement.

## Related Documents

- [[M8C-MONIKER-SPEC]] — the spec and the DoD lines
- [[M8C-BUILD-JOURNAL]] — Entries 65–70 (the build trail)
- [[M8C-LIVE-TEST-CHECKLIST]] — the milestone's other live gates
- [[M8C-PROCEDURE]] — §2c publish/deploy sequencing and the two human-only steps
