---
name: daemon-singleton-defects
type: design
date: 2026-07-10
topics: [daemon, lifecycle, lockfile, orphan, flock, singleton, corruption, logout, connectOrStart]
status: active
description: >
  Two linked defects that let multiple daemons run at once on one machine, each writing the same
  SQLite database. An exiting daemon unlinks the lock and socket unconditionally, even when a
  DIFFERENT daemon now owns them — so killing an orphan disarms the healthy daemon and the next
  `cello login` spawns another. Nothing at startup prevents a second instance. Observed live
  2026-07-10 with three daemons running simultaneously; two held sessions.db open together.
---

# Daemon Singleton — Two Linked Defects

> **Observed live, not theorised.** 2026-07-10 on Andre's machine: three `cello-daemon` processes
> running at once (`99812`, `32946`, `33102`). `lsof` confirmed **two of them held `sessions.db` open
> simultaneously**. Killing the orphan left the healthy daemon alive with **no lock file and no socket** —
> unreachable, unstoppable by `cello logout`, and invisible to `cello login`.

## 1. The cascade, and why it is self-propagating

1. A daemon exits (crash, `kill`, orphaned restart) and its shutdown handler unlinks
   `~/.cello/daemon.lock` and `~/.cello/daemon.sock` — **without checking whether it still owns them.**
   A *different* daemon may have written that lock minutes ago.
2. `cello logout` reads the lock, finds none, and reports **"No daemon running."** It is telling the
   truth by its own lights. `DOD-LOGOUT-WAIT-1` does not help: there is nothing to wait for.
3. `cello login` → `connectOrStart` sees no lock and **spawns a second daemon** beside the live one.
4. Two daemons now write `sessions.db`. Kill either one, and step 1 removes the survivor's lock.
   **Go to 2.**

**Killing an orphan sabotages the healthy daemon.** That is the trap: the obvious recovery action makes
it worse, silently.

## 2. What is actually at risk

**Not** SQLite file corruption. WAL mode is multi-process safe; the storage layer holds.

**Everything above it**, because the application assumes a single writer:

- **Two daemons run the same agents.** Both bring the same agents online, both open a directory
  signaling stream for the same pubkey, both create standing receivers. A `session_offer` reaches
  whichever stream the directory picks. *This is the exact shape that makes
  `standing_receiver_unavailable` fire — see [[M8C-PHANTOM-SESSION-FIX-PLAN]]. We cannot rule out that
  orphans contributed to that race.*
- **Hash-chain leaves.** Sequence numbers and Merkle leaf indices are allocated read-compute-write. Two
  processes can allocate the same index. That is a broken transcript, and **the seal attests to it.**
- **FROST shares.** Two processes holding one share, both able to participate in a ceremony.
  `DOD-INV-ONE-PRIMARY` forbids this *across machines*; we have been violating it on **one**.
- **Double-accept.** Both daemons can accept the same inbound session.

**Observed damage: none.** Sessions sealed cleanly, transcripts were consistent. But nothing tells an
operator there are two daemons, and the trigger is the restart sequence our own docs prescribe, plus any
crash. `CLAUDE.md` already warns: *"Orphan processes compete for the lock and corrupt ceremony state."*

---

## 3. `DOD-DAEMON-CLEANUP-1` — stop the propagation (do this first)

*An exiting daemon must not disarm a daemon it does not own.*

- **AC1** On shutdown, the daemon unlinks `daemon.lock` **only if the lock's `pid` equals its own pid**.
  Otherwise it leaves the file alone and logs `daemon.lock.not_ours` at **info** with both pids.
- **AC2** On shutdown, the daemon removes `daemon.sock` **only if it created that socket** (it is the
  listener). Never a blind `unlink`.
- **AC3** A daemon that finds, at startup, a lock whose pid is alive **must not** delete it (that path
  already exists in `connectOrStart`'s `socket_unreachable` branch — verify it cannot fire against a
  live, healthy daemon).
- **SI** The failure is loud. A daemon that declines to remove a lock says so.

**Test (red first).** Start daemon A (real spawned binary — an in-process daemon shares the test's pid and
cannot reproduce this; that trap already bit `DOD-LOGOUT-WAIT-1`'s first AC2). Start daemon B. Kill A.
Assert: the lock still exists, its pid is B's, `daemon.sock` still exists, and B still answers.

**Size:** two conditions. Near-zero risk. **This is the propagation mechanism — without it, every attempt
to recover from an orphan creates another one.**

---

## 4. `DOD-SINGLE-DAEMON-1` — make the class impossible

*The lock file is advisory and removable. It is not a lock.*

- **AC1** At startup the daemon acquires an **exclusive OS-level lock** (`flock` / `O_EXLOCK`) on a
  lockfile (or the DB) and **holds it for its entire lifetime**. The OS releases it on process death, so
  no stale state survives a crash.
- **AC2** A second instance fails to acquire it and **exits immediately, non-zero**, naming the holding
  pid: `another daemon is already running (pid N)`. It never opens the DB, never registers agents, never
  connects to the directory.
- **AC3** `connectOrStart` treats "lock held by a live process" as *connect*, never as *spawn*. Spawning
  is only correct when the lock is genuinely free.
- **AC4** The advisory `daemon.lock` JSON may remain for its metadata (`pid`, `socketPath`, `version`),
  but **it must never be the thing that decides whether a daemon may start.**
- **SI** Failing to start is the loud, correct outcome. Two daemons is the silent, wrong one.

**Test (red first).** Spawn a real daemon. Spawn a second against the same `CELLO_DIR`. Assert the second
exits non-zero, names the first's pid, and that `lsof` shows only ONE process holding `sessions.db`.
Then `kill -9` the first (no clean shutdown) and assert a third starts fine — proving the OS released the
lock and no stale file blocks recovery. **`kill -9` is the case a file-existence lock always gets wrong.**

**Size:** small, but it touches startup and deserves real tests.

---

## 5. Why `DOD-LOGOUT-WAIT-1` did not prevent this

It guarantees *its own* logout waits for the daemon **it can see**. It cannot stop a daemon whose lock has
already been deleted by someone else — `logout` looks up the lock, finds nothing, and correctly says
"No daemon running." The bug is not in `logout`. It is that **a daemon's identity is recorded in a file
any other daemon will happily delete.**

## 6. Triage

- **`DOD-DAEMON-CLEANUP-1`:** two lines, no risk, and it removes the trap where recovery makes things
  worse. Take it now.
- **`DOD-SINGLE-DAEMON-1`:** the durable fix. Every incident on 2026-07-10 would have been prevented by
  it. Small, but touches startup — do it properly, right after.

Neither is launch-blocking on the "can two agents connect" test. Both are close to unforgivable on the
"do I trust this thing with my identity" test, because the failure is **silent**, the trigger is the
restart sequence we document, and the recovery action propagates it.

## Related Documents

- [[M8C-PHANTOM-SESSION-FIX-PLAN]] — the `standing_receiver_unavailable` race; a second daemon with its
  own standing receivers is the same shape, and may have contributed.
- [[M8C-DEFINITION-OF-DONE]] — `DOD-LOGOUT-WAIT-1` (why it does not cover this),
  `DOD-INV-ONE-PRIMARY` (the cross-machine version of this invariant).
- [[M8C-BUILD-JOURNAL]] — Entry 84, the orphan that cost a manual `kill`.
