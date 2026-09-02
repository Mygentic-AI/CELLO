---
name: Live proof of 002–008 against the deployed fleet
type: discussion
date: 2026-09-02
topics: [verification, relay, encryption, deployment, m15]
description: >
  Adversarial verification of every M15 micro work order that went live on 7befcc95, run against the
  production GCP fleet rather than against tests. Includes the proof that message bodies are
  ciphertext on the wire — read off the relay's own disk — and a record of the two checks that
  produced false results before positive controls caught them.
---

# Live proof of 002–008 on the deployed fleet

Run overnight 2026-09-01/02, immediately after the whole fleet rolled onto `7befcc95`. Andre's
instruction was "prove prove prove" — so **every claim below cites an observation from the RUNNING
system**: a production relay's disk, the fleet's logs, or a live session. Nothing here rests on a
unit test.

## The rule that shaped this document

**A negative is worthless without a positive control.** Twice tonight a check returned a clean-looking
answer that meant nothing, and both times the control caught it:

1. Grepping the relay container for deleted frame names returned **0 for everything** — including
   `discard_session`, which must be present. The path was wrong; I had searched nothing. A report
   without the control would have read "all deleted, confirmed".
2. `grep -c "salt.persist.failed"` returned **44**, which looked like a persistence fault. Those
   lines were `content.cross_check.failed` whose *guidance text* mentions the string. There are zero
   real persist failures.

Every proof below therefore names what would have shown up had the mechanism been broken.

---

## 008-RELAY — an unregistered key cannot hold a reservation slot

**The adversarial test.** A freshly minted Ed25519 keypair — what a flood costs, i.e. nothing —
asked each production relay for a circuit reservation without ever authenticating:

| relay | reached the relay | slot granted |
|---|---|---|
| `relay-use1` (34.139.119.165) | ✅ `dialed_ok`, 1 live connection | ❌ **refused** |
| `relay-euw1` (34.77.112.231) | ✅ connected | ❌ **refused** |

**Positive control, taken in the same minutes:** `CELLO_Coder_1`, `CELLO_Support`, `Miss_Chelly`,
`CELLO_Coder_H` and `Miss_Chelly_H` all read `standing_receiver_reachability: reserved` on those same
relays. So the refusal is not "reservations are broken tonight" — the relay was granting slots to
agents that prove themselves, and refusing the one that would not, at the same time.

**Both ends of the handshake, independently observed:**
- client: `session.standing_receiver.prove.result … proven: true`
- relay: `relay.auth.reservation_proof` for `ce0fa3d0` and `f8d518ca`
- relay: `relay.reservation.denied … reason: not_authenticated`, at **debug**, carrying the corrected
  impact text ("expected. A receiver asks for its slot, is refused, authenticates, and asks again").
  That is the review fix for finding 3 — don't log the happy path as an attack — running in prod.

### The failover was tested by a real outage, not a fixture

At **20:31:16** `Miss_Chelly_H` tried to prove itself to the europe-west1 relay and the stream died:
`Unexpected EOF - stream closed while reading 0/1 bytes`. **That relay was me, rolling it that
minute.** Its client classified it `no_relay_verdict / tryAnotherRelay: true`, logged
`relay_proof_refused`, moved to the other relay rather than retrying the dead one, and held a
reservation again at **20:35:03** — unattended, no intervention. That is the clause-9 path the
review had found untested, exercised by a genuine transient on its first night.

---

## 007-CRYPTO — bodies are ciphertext on the wire

**This is the proof Andre asked for specifically, and it is a measurement, not an inference.**

Method: force a message to park at a relay (open a session, remove the receiver mid-session), then
read the relay's own parked-content file on disk in `us-east1-d`.

- Sent: *"The seventeen purple hexagons argued with Tuesday about marmalade, and the lighthouse
  agreed with neither of them."*
- Relay holds: `/mnt/disks/cello-wal/content/f8d518ca…/713ab930…__1788295441346__777.entry`,
  **777 ciphertext bytes**
- Canary **absent from the raw file**
- Canary **absent after base64-decoding the `ct` field** — all five needles (`purple hexagons`,
  `marmalade`, `lighthouse`, `Tuesday`, `seventeen`) return `False`
- **36.4% printable ASCII** (283/777). English prose runs ~99%.
- Opening bytes: `f383e4e108b1fb7abc777c5de2b78f5826b18eb0f2b55e50b71e57c7aaeef134`

**The positive control that makes the absence mean something:** my own transcript holds the sentence
in full at `createdAt 1788295441326` — **20 ms before** the relay file's own timestamp,
`1788295441346`. Same message, same instant: **plaintext at the endpoint, opaque at the relay.**

> **A prior attempt failed in a way worth keeping.** The first canary was a high-entropy marker
> (`ZQ7X-CANARY-…`) and our OWN outbound gateway redacted it before it left the machine:
> `stage: exfil, disposition: redact, category: exfil:encoded`. The exfiltration defence fired on a
> real message, mine, unprompted. The replacement canary is deliberately natural language.

**NOT proven, stated plainly:** 007 also claims the throwaway key is *signed* so a relay cannot
substitute its own and read everything. Demonstrating that needs an active man-in-the-middle against
our own relay; I did not build one. What is proven is that the relay cannot read what it carries.

---

## 006-CRYPTO — the throwaway key is minted per session and destroyed

**Conservation, which is stronger than "the event fired":**

| | count |
|---|---|
| `session.ephemeral.minted` | 5 |
| `session.ephemeral.destroyed` | 4 |
| outstanding | **1** |
| open sessions reported by the daemon | **1** |

The books balance. Every ephemeral key that is not accounted for by an open session has been
destroyed.

**Destruction observed in the close sequence**, in order:
`seal.leaf.submitted → awaiting_counterparty → ceremony.participated → frost.signature.sent →
sealed.root.checked → sealed.signature.checked → certificate.frontier.verified →
session.seed.destroyed → seal.completed → session.ephemeral.destroyed → session.node.destroyed`

---

## 002-RELAY — a circuit address is not dialable by whoever learns it

**Adversarial test.** A stranger with a fresh keypair, given a real circuit address of a real
reservation holder (`CELLO_Coder_1`'s receiver), tried to dial through it. No session assignment
names that stranger.

- Stranger **reached the relay** (`reached_relay: true`) — so a refusal cannot be a network failure
- Dial through: **`failed to connect via relay with status PERMISSION_DENIED`**
- Relay's own record: `relay.circuit.dial_denied`, `reason: no_session_assignment_names_both_peers`,
  `destinationBindingCount: 0`

Both ends agree, and the reason string is the specific one the gater emits.

---

## 003-RELAY — the idle timer is ON in production

003 existed because the per-session idle timer was implemented and **the production binary never
passed it**. From both relays' own boot logs on `7befcc95`:

```
relay.config.session_idle_timeout   sessionIdleTimeoutMs = 86400000
relay.config.idle_sweep             maxIdleMs = 86400000, sweepIntervalMs = 3600000
relay.config.circuit_limits         (data + duration limits present)
relay.config.content_ttl            contentTtlDays = 30
```

The value the binary never used to supply is now in the running config, logged by the relay itself.

---

## 004-RELAY — the dead admin frames are gone from what ships

Audited inside the **running container** (`/app/packages/relay/dist`), counting live dispatch sites
(`=== "x"` / `case "x"`), not textual mentions:

| frame | dispatch sites | expected |
|---|---|---|
| `confirm_seal` | **0** | deleted |
| `reject_seal` | **0** | deleted |
| `record_assignment` | **0** | deleted |
| `discard_session` | 3 | kept — **positive control** |
| `get_seal_leaves` | 1 | kept — **positive control** |
| `client_record_assignment` | 2 | live, different frame |

The names still appear in the bundle as *comments* recording the removal ("RETIRED", "were REMOVED",
"frame (removed)"), which is the project's convention. Counting raw string hits would have reported
`record_assignment: 34` and looked like a failure — `client_record_assignment` contains it.

---

## 005-RELAY — checks act on their results

005 swept for security checks that run, get the right answer, and are then ignored. Four checks were
observed **acting** in production tonight:

1. The reservation gate **refused** an unproven peer (008, both relays).
2. The dial-through gate **refused** a stranger with `PERMISSION_DENIED` (002).
3. The content-hash cross-check **refused an unverifiable message and did not ingest it** —
   `content.recover.ingest_failed`, "NOT ingested and NOT shown". A checked-then-ignored version
   would have accepted it.
4. The outbound exfil filter **redacted** a payload rather than flagging and sending.

---

## Findings

**Fixed tonight:** the Hermes EC2 runbooks named a public IP that changed at a relaunch on
2026-08-19. SSH to the old address times out and looks exactly like a security-group problem — the
rule was already present. Both runbooks now carry the current address plus the lookup by instance ID,
so the next change self-corrects.

**Cosmetic, not fixed:** `relay.manifest.version.stale` fires at debug when
`currentVersion == receivedVersion` — i.e. on the no-op case. The name says "stale" when nothing is
wrong. Low priority, but it is the class of thing this milestone keeps finding.

**Worth a look, unverified:** the three directories report manifest `currentVersion` of 21, 22 and 23.
That may be per-node by design; I did not confirm either way and am not claiming drift.

**Known behaviour, encountered deliberately:** a session whose salt agreement has not completed
before the first hashed message enters a terminal `already_hashing` state, and mail parked for it can
never be verified (`content_hash_salt_unavailable` → `session.salt.split /
suspended_but_unerasable`). My canary test created this on purpose by removing the receiver
mid-session. The repair is documented in the guidance: start a new session.

---

## Related

- [[008-RELAY-reservation-slot-flooding]]
- [[GCP-STATE]] — the fleet record for this roll
