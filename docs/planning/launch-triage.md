---
name: Launch Triage
type: triage
date: 2026-07-12
topics: [launch, security, backup, daemon-lifecycle, telegram, config, primary-standby, triage]
status: open
description: >
  The nine remaining items surfaced in the 2026-07-11/12 open-items reassessment, ranked by
  what they actually risk or prevent — not by build status. Plain-language explanation +
  existing designation for each, so this doc works as both a punch list and a lookup table
  into M8C-DEFINITION-OF-DONE / M8C-ONBOARDING-IMPROVEMENTS. Suggested order below is Ms_Chelly's
  first pass; Andre sets the real priority after reading it.
---

# Launch Triage

Nine open items, sorted most → least important by what goes wrong if left alone. Each has a
plain-language explanation and its existing designation (use the designation to find the full
technical writeup in the linked source doc).

**How to use this:** read top to bottom, then tell me the real priority order — this first pass
is my ranking, not a decision.

---

## 1. A stranger can plant a fake message in your mailbox using nothing but your public key

**Designation: `SEC-1`** — ✅ **DONE — fixed, reviewed, published, and promoted to `latest` 2026-07-12,
live for every default install.** Only remaining step: reinstall the EC2 demo agent (known laggard)
to pick up the new binary.

When your agent is offline, someone can leave you a message by dropping it at a relay server —
an offline mailbox you pick up from when you reconnect. The problem: your public key isn't a
secret, it's how people find and reach you. Depositing something in that mailbox was built to
not require proving you're a real, known sender — and some of the message formats that can land
there skip the sender-signature check entirely. Put together: anyone who knows your public key
can plant a message that comes back looking like it's from a real contact. This is live and
unpatched today, not hypothetical. Found by a reviewer during unrelated work, correctly flagged,
never designed against.

**Turned out worse than this description:** the design pass found the relay server itself — not
just a random stranger — is the party best placed to pull this off, since the protocol hands it
everything it needs automatically. Fix: every message you leave for pickup now gets signed with
your own key before it's sealed, so the relay can't fake it, and a pickup only succeeds if that
signature checks out. Independently verified by Ms_Chelly against the actual code and test suite
before publishing, not taken on report. Full trail: [[M8C-DEFINITION-OF-DONE]] → `SEC-1`.

Source: [[M8C-DEFINITION-OF-DONE]] → `SEC-1`.

---

## 2. Two copies of the background process can run at once, and the obvious fix makes it worse

**Designation: `DOD-DAEMON-CLEANUP-1` / `DOD-SINGLE-DAEMON-1`** — ✅ **DONE 2026-07-13**, published
(`v0.0.99`), awaiting `latest` promotion only.

The daemon is the background process holding your keys and talking to the network — normally
exactly one runs. A startup-timing bug can leave two running at once, both pointed at the same
database. If that happens and you try to fix it by killing the process that looks extra, you can
kill the *real* one instead — leaving nothing running, with no error message explaining why.
Not an attack; a silent, self-inflicted failure mode triggered by an ordinary restart or crash.

**Fixed with a real OS-level lock** (a genuine POSIX file lock, not a deletable file this time) —
a second daemon now fails immediately and says so by name instead of silently duplicating. Review
caught the sharpest bug before it shipped: the "shut down my agent" command itself was trusting the
exact broken logic this fix removes, so it could report "nothing running" while your agent was
still live on the network.

Source: [[M8C-DEFINITION-OF-DONE]] → "🔴 Daemon singleton — multiple daemons, one database."

---

## 3. There is currently no way to back up or recover your identity

**Designation: `DOD-CUSTODY-DAEMON-1`**

`backup` and `restore` exist as commands, but nothing behind them actually works — call either
one and it reports "not implemented." If your machine is lost, stolen, or dies, that agent and
everything it knows is gone permanently. No safety net exists today. Real work to fix: the logic
needs to move out of the wrong place (the chat-tool layer) and into the daemon itself as a real
capability.

Source: [[M8C-DEFINITION-OF-DONE]] → `DOD-CUSTODY-DAEMON-1`.

---

## 4. ~~We've built the defense against forged signing requests, but never watched it actually reject one live~~

**Designation: `SEC-2`** — ✅ **DONE 2026-07-12.** Sent two real forged signing requests at the live
directory (no signature; a signature from the wrong key) impersonating a real agent by public key
alone. Both were refused, confirmed both in the response AND independently in the directory's own
server-side log. Enforcement is proven, not just believed.

Source: [[M8C-DEFINITION-OF-DONE]] → `SEC-2`.

---

## 5. The security-screening layer keeps its own records on disk unencrypted

**Designation: `DOD-CRYPTO-AT-REST-1`**

The layer that screens every message for injection/secrets/PII keeps a record of every decision
it makes, plus its own settings, in a database on disk — and that database is plain, unencrypted
text, even though the design explicitly said it should be encrypted like everything else here.
No private keys are exposed by this. Someone would need direct access to your machine's disk to
read it — but it shouldn't be readable even then.

Source: [[M8C-DEFINITION-OF-DONE]] → `DOD-CRYPTO-AT-REST-1`.

---

## 6. The Telegram sign-up messages give wrong or unclear instructions in a few spots

**Designation: `D-ENVVAR` (+ the rest of Phase 1 in `M8C-ONBOARDING-IMPROVEMENTS`)**

The registration bot tells a new user to set something that doesn't actually exist, among a few
other unclear or inconsistent messages along that flow. A literal first-time follower gets stuck
with no next step. Not a security issue — a bad first impression. Fixing it is tedious rather
than hard: several message rewrites plus the tests that check the exact wording, in one repo.

Source: [[M8C-ONBOARDING-IMPROVEMENTS]] → Phase 1 (items 1–4, O1–O5), decision `D-ENVVAR`.

---

## 7. A handful of small features are on hold, waiting on a shared settings system that doesn't exist yet

**Designation: `DOD-CONFIG-1`** (parked: `D14`, `D15`, `D16`, `D17`)

Several conveniences are built in spirit but can't ship standalone because there's no general
settings store yet to hold them: a custom away-message, a "go fully silent" privacy mode, custom
expiry times for pending session requests, and letting your trusted contacts (and only them) see
your online status. None of these are safety gaps — they're missing knobs, deliberately paused
rather than built as one-offs that would need to be rebuilt when the real settings system lands.

Source: [[M8C-DEFINITION-OF-DONE]] → `DOD-CONFIG-1`, parked decisions `D14`–`D17`.

---

## 8. Telegram phone notifications are built and tested, but never proven on a real phone

**Designation: `DOD-TGDOOR-1`**

The doorbell-to-Telegram feature (session requests, unread messages, state changes pushed to
your phone) is built and passes its test suite, but it's the one Tier-3 feature that can't be
smoke-tested without a real Telegram bot token — so it's never been watched working end-to-end
on an actual phone. Low risk either way; just unverified.

Source: [[M8C-DEFINITION-OF-DONE]] → `DOD-TGDOOR-1`.

---

## 9. Running the same agent from two devices at once is mostly unbuilt

**Designation: `DOD-PRIMARY-1`** (+ `DOD-POLICY-1`, `DOD-PORTAB-1`)

The design for this exists and the directory-side security core is built and tested, but the
actual enforcement that stops two devices from fighting over control isn't wired in, the
handshake between your two devices doesn't exist, syncing your data between them doesn't exist,
and nobody has run a "kill the active device, does the backup cleanly take over" test. This
entire feature is deliberately out of scope for now — one agent on one device works completely
fine without any of it.

Source: [[M8C-DEFINITION-OF-DONE]] → `DOD-PRIMARY-1`, `DOD-POLICY-1`, `DOD-PORTAB-1`.

---

## Already solid — confirmed working, no action needed

Real-time chat notifications, catching up on everything missed while offline, agents
auto-starting at login, the read-before-reply guard, auto-away-replies, spam/abuse limits on
strangers, session-request expiry, and the caller-ID name feature (proven to resist a deliberate
attack). Also: the "can't receive messages right after signing up" bug is already fixed — it
looked open in an earlier checklist, but the fix shipped 2026-07-07 and is confirmed present in
the currently-promoted `latest` daemon.

---

## Related Documents

- [[M8C-DEFINITION-OF-DONE]] — full technical detail and status for every designation above
- [[M8C-ONBOARDING-IMPROVEMENTS]] — the Telegram/CLI onboarding checklist (item 6)
- [[protocol-map]] — where these fit relative to the overall milestone sequence
