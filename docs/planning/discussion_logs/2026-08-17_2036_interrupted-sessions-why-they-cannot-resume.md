---
name: Interrupted sessions — why they cannot resume, and what each case actually needs
type: discussion
date: 2026-08-17
topics: [sessions, interrupted, resume, peer-id, libp2p, seal, unilateral-seal, caps, adr-0001, messaging-spine]
description: >
  Investigation into why CELLO sessions end up permanently "interrupted" and can never be resumed.
  Establishes the measured population, the three distinct causes (laptop close, reconnect, daemon
  restart), and what each one actually requires. Finds that the transport identity is discarded by
  a choice we make, not by any constraint, and that ADR-0001 does not forbid a per-session stable
  identity. Ends with a per-case plan and the invariants Andre ruled during the discussion.
---

# Interrupted sessions — why they cannot resume

**Andre's framing, and it is the right one:** *"the actual real term for it is broken. To make it
interrupted, we have to make it resumable."*

A state you can only leave by giving up on it is not an interruption.

---

## 1. What is actually happening, measured

All figures from Andre's own daemon — `~/.cello/daemon.log` (405,925 records, 2026-08-01 →
2026-08-17) and the live `sessions.db` (13 MB, 507 rows).

### The outcome of every session ever

| status | count | |
|---|---|---|
| `sealed` | 339 | 67% — got a receipt |
| `abandoned` | 137 | 27% — **no receipt** |
| `seal_interrupted_pending` | 26 | 5% — stuck mid-seal |
| `active` | 5 | current |

**The 137 abandoned carry 3,576 messages and produced nothing.** 121 of them hold real content.

### The abandoned ARE the interrupted, cashed out

From `session.force_abandoned`, which records what the session was immediately before:

- **37 were `interrupted`**
- 3 were `seal_interrupted_pending`
- 16 were `active`

**71% of force-abandons were sessions in a state with no exit.** 38 were flagged at the time as
possibly forfeiting a real seal.

So the 27% is not a separate failure mode. It is the interrupted problem, realised: you cannot
resolve them, you want them out of the list, you force them, the receipt dies.

### 26 are stuck mid-seal, some for 10 days

`seal_interrupted_pending` sessions idle **0.5 to 10.5 days**, carrying 2–14 messages each. They
started sealing and never finished. **Nothing retries them and there is no path out.**

### It was a trickle; it became a flood

Sessions created per day, and the share that got a receipt:

| day | sessions | % sealed |
|---|---|---|
| 08-05 → 08-15 | 16–48 | 63–96% |
| **08-16** | **67** | **43%** |
| **08-17** | **169** | 73% |

**08-16 is the day it turned** — the document work with the deletions and changes. Volume ~4×, and
the receipt rate roughly halved.

Andre: *"it wasn't one, but it has become one because of all the errors."* The data agrees. **But
the no-exit defect was there at 12/day too — it just did not hurt at that rate.** With a stranger
cap of 3, a handful of unresolvable sessions is enough to lock a peer out entirely.

### Corrections to figures stated earlier in the session

- **"93% never resolved" was WRONG.** That counted `session.node.created` events, which include node
  rebuilds and handoffs, not distinct session rows. The real figure is 67% sealed.
- **"a one-way trapdoor with no exit" was WRONG.** `interrupted → sealed` exists via the unilateral
  seal and was observed working (session `a0b81f4d`, 17:00:01Z). What it lacks is anything that
  *triggers* it.
- **The 11-minute blocking close is the ACTIVE path, not the interrupted one.** Two different
  branches with opposite behaviour — see §3.

---

## 2. Nothing is lost. The session is un-introduced.

Close the laptop, restart the daemon — all of this survives on disk, both sides:

- the session id, the counterparty pubkey
- every leaf of the chain (`session_tree_leaves`)
- the whole transcript
- held content (`held_content`, durable since DOD-M12B-STRAND-1)

**The record is intact.** What is lost is a TCP connection and, sometimes, a transport identity.

The two parties can no longer *find* each other. Each session runs on its own libp2p node with its
own keypair; the only thing that ever told each side the other's address was the session assignment,
handed out **once**, at creation.

**And the directory still knows where both of you are** — `#peerInfo` is a live registry of every
connected agent's peer id and multiaddrs, updated on every connect. It is exactly where the original
assignment sourced them.

There is simply **no verb to ask again**. `session_request` mints a fresh random id every time
(`directory-node.ts`: `const session_id = new Uint8Array(randomBytes(16))`). Asking always produces a
*different* session.

---

## 3. Why the exit is never taken

`interrupted` and `active` take **different close paths**, and they fail differently.

**ACTIVE session** (`close-session-handler.ts` ~775): submits the seal leaf, then waits
`CELLO_SEAL_BILATERAL_TIMEOUT_MS` — **default 660,000 ms = 11 minutes** — before escalating to the
unilateral seal. Measured end to end: seal leaf 16:48:55.137 → ceremony 17:00:01.508 = **11m 06s**,
matching the constant. It succeeds and produces a real notarized receipt. **The IPC call blocks for
the whole 11 minutes and says nothing.**

**INTERRUPTED session** (`close-session-handler.ts` ~630): sends a bilateral request, retries once
after discovery, then attempts the unilateral seal. If the directory's delivery-grace window has not
elapsed it answers `seal_unilateral_too_early` and the close returns:

> *"Your SEAL leaf is recorded, but the counterparty has not closed and the directory's
> delivery-grace window has not yet elapsed… **Retry `cello_close_session` after the grace period**,
> or once the counterparty closes."*

**It fails fast and asks a human to come back.** Nothing is scheduled. The response even carries
`remainingSeconds` — the daemon knows exactly when it would succeed and does nothing with it.

That is Andre's lived experience, exactly: *"try to close it, fail to close it, come back eleven
minutes later and try to close it and it does."*

**The trap:** force it and lose the receipt; leave it and fill the cap. Both exits are bad.

---

## 4. Why the identities die — it is a choice

`core/transport/src/node.ts`:

```ts
// ADR-0001: generate a fresh keypair for libp2p transport identity.
const transportKey = opts.transportPrivateKey
  ? await generateKeyPairFromSeed("Ed25519", opts.transportPrivateKey)  // a seed CAN be passed
  : await generateKeyPair("Ed25519");                                    // we never pass one
```

**`createNode` already accepts a seed. The daemon never supplies one.** The mechanism for a stable
identity is built and unused.

### What ADR-0001 actually says

Read in full (`docs/adr/0001-peer-id-separate-from-k-local.md`). Its subject is that the peer id must
**not** be derived from K_local — because `KeyProvider` never exposes private bytes (hardware-backed
providers) and libp2p's Noise needs DH keys, not signing keys.

On ephemerality it says only:

> *"Peer IDs are ephemeral — **fresh per session**, derived from ephemeral keypairs the client
> generates **at session establishment**."*
>
> *"The Peer ID is a **transport routing identifier only**."*
>
> *"Receivers verify message authenticity via the envelope signature (K_local), not via the Peer ID."*

**A per-session seed satisfies every word of it.** Still fresh per session, still unlinkable across
sessions, still unrelated to K_local. It stops being re-minted *mid-session*, which the ADR never
asked for — and since the peer id carries no trust claim, stabilising it within a session weakens no
stated property.

**The anti-DDoS rationale is NOT in the ADR.** Andre's reasoning — a learnable peer id lets someone
route around the directory and flood a node directly — is real but unrecorded. It needs writing down
properly if it is going to constrain the design.

**Andre's ruling on scope:** *"if you keep a seed, the seed must be related to the session. Not the
agent."* A per-agent seed would produce one permanent peer id for everything that agent does, which
is precisely the correlatable identifier to avoid.

### The standing receiver is the exception

The standing receiver is **per-agent by construction** — it is the door everyone knocks on — so a
stable identity there *is* an agent-wide identifier. It must NOT be stabilised.

And it is where the damage actually is. The codebase already knows, and says so twice:

> *"`counterpartySessionPeerId` is recorded ONCE at session establishment and never refreshed, while
> a standing receiver is rebuilt with a fresh libp2p keypair on every signaling reconnect and every
> lost reservation… every send in this direction parks forever while the reverse direction works
> fine."*

A defect the code worked around with better logging rather than fixing.

---

## 5. The three cases, and what each needs

### A. Laptop close — **process survives**

macOS suspends; it does not kill. Confirmed in the log: a dozen gaps of 13–18 minutes with the same
daemon running straight through.

- Both keypairs still in memory. **Both peer ids still valid.**
- The far end's yamux keepalive (30 s) goes unanswered, so it closes the connection.
- On wake, only the TCP connection is gone. **Nothing needs recreating.**

**Needed:**
1. **Stop regenerating the receiver identity on rebuild.** The rebuild exists to get a new *relay
   reservation*, not a new identity. Hold the seed in memory and pass `transportPrivateKey`. No
   persistence — the process is alive.
2. **Re-dial.** ✅ Shipped 2026-08-17 (`DOD-M12B-REDIAL-1`) — demand-driven, cooldown-bounded.
3. **The reverse edge: `interrupted → active` on reconnect.** Today a transport event changes a
   session's status and nothing ever changes it back.

### B. Signaling / relay reconnect — **process survives**

Same mechanism, same fix. Triggers are routine: heartbeat unanswered, a write failing, a directory
or relay node restarting, a wifi hop, sleep. (Actual rebuild trigger measured: **relay reservation
lost**, not signaling reconnect — the two comments claiming otherwise have drifted from the code.)

The *address* legitimately changes on a rebuild even with a stable peer id — but that needs no fix,
because **libp2p connections are bidirectional**. Whoever wakes first dials; the dialer retains the
addresses; the receiver just accepts, and its gater still recognises a peer id we stopped changing.

**No directory verb and no re-introduction are needed for A or B.**

### C. Daemon restart — **process died**

Both keypairs are genuinely gone. Recovering them means persisting private keys to disk, which is a
real security decision for a much rarer case.

**Ruled: do not resume. Resolve.** But make it a **seal, not a force-close** — that is the whole
difference:

- force-close → session gone, **receipt gone** (the 137 sessions, 3,576 messages)
- auto-seal → session gone, **receipt kept**

On startup the daemon walks every session left open: attempt the bilateral seal (the counterparty may
be online), fall back to the unilateral seal once grace allows — ~10 minutes, in the background, and
it already knows the exact remaining time because the refusal carries it.

The operator sees nothing but a clean list and receipts on file.

---

## 6. Invariants Andre ruled during this discussion

- **A seed must be per-SESSION, never per-agent.** A per-agent seed is a permanent correlatable
  identifier for everything that agent does.
- **Idle is not interrupted.** If both daemons are reachable and nobody is talking, the session
  stays open. Ending it on inactivity is a *security* setting and must be configurable, not a
  transport side effect.
- **A re-established connection should come through a legitimate relay rather than direct**, as
  mitigation for a learnable peer id.
- **The receiving daemon may always close a session, and once it has, new messages must not come
  through — whatever the sender does.** This is an invariant, not a behaviour. It is the backstop
  that makes a learnable identity survivable.

---

## 7. Not established — do not treat as known

- **Whether the relay can serve as a rendezvous** for re-establishing an *existing* session without
  the directory. It is the obvious candidate (both sides hold reservations, and the directory is
  observably not always up — `directory.bootstrap.unavailable` recurs on 08-16), but the path has
  not been traced.
- **What the 26 `seal_interrupted_pending` sessions are waiting for**, and why nothing retries them.
  Some have been stuck 10 days. This is a separate defect from `interrupted` and has no exit at all.
- **Whether the anti-DDoS concern is real at the scale that matters**, and what mitigations
  (relay-only re-establishment, per-session caps, the close invariant above) actually buy.
- **What happens to an in-flight session when its directory node goes away** — the relay carries
  content via store-and-forward, but the introduction path is directory-only today.

---

## Related Documents

- [[M12B-DEFINITION-OF-DONE]] — the milestone this surfaced from
- [[M12B-BUILD-JOURNAL]] — Entries 17–19 carry the measurements behind §1
- [[launch-triage]] — `DOD-CAP-SELF-HEAL-1` and `DOD-M12B-CLOSE-SILENT-WAIT-1`
- `docs/adr/0001-peer-id-separate-from-k-local.md` — quoted in §4
