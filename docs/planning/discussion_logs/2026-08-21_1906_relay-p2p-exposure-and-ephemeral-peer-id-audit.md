---
name: Live P2P exposure — what ephemeral Peer IDs actually bought, and the gaps found chasing it
type: discussion
date: 2026-08-21
topics: [transport, libp2p, relay, peer-id, ephemeral, standing-receiver, connection-gater, ddos, attack-surface, unlinkability, privacy, content-injection, seal, merkle-root, session-assignment, directory-auth, threat-model, security]
status: decided-pending-build
description: >
  Investigation into whether making libp2p Peer IDs ephemeral (stood up per session, torn down at
  close) actually reduced the attack surface for retail users with no firewall in front of them —
  and what live P2P really exposes. Finds the ephemerality was applied to the one node that was
  never reachable, while the two nodes that ARE reachable were left out of the argument. Confirms
  the anti-DDoS rationale was already retracted on 2026-08-18 but never propagated, leaving false
  security claims marked "current" in the architecture reference and repeated verbatim in investor
  and GTM material. Finds five gaps: a stranger can inject content into a live session and have it
  attributed to the legitimate counterparty; the relay answers "is agent X online?" to anyone for
  any pubkey; the relay-facing session assignment is signed by one directory rather than a
  threshold; the client never verifies the directory's signature on a session assignment at all;
  and the relay has almost no abuse controls. Also establishes that NOBODY verifies the sealed root
  against the local transcript on the normal seal path — each side's code comments defer the check
  to the other. All seven design decisions ruled inline. 39 build items,
  two of which are live-deployment verifications that cannot be answered by reading code.
---

# Live P2P exposure — what ephemeral Peer IDs actually bought, and the gaps found chasing it

## Why this investigation happened

The question was simple: we decided to make peer-to-peer identities ephemeral — stand them up when
a session needs one, tear them down when it closes — rather than give each agent one fixed libp2p
Peer ID. The stated reason was that the client is open source and sits on the operator's machine,
so anyone can modify it, and ephemeral identities would shrink the denial-of-service surface.

Blockchain-style node operators put firewalls and DDoS scrubbing in front of their infrastructure.
Retail users do not. So: **what does the ephemeral setup and teardown actually give us?**

The doubt that prompted this: we still hold connections to directories, so we probably still have
open ports — just with different Peer IDs. And separately, three things that were never confirmed:

1. Does the ephemeral design prevent monitoring of a connection?
2. Does it stop an agent you had a session with from dialling you directly later, skipping the
   directory entirely?
3. Can someone fake being a directory?

The investigation ran the design record first, then verified every claim against code.

**The short answer: the instinct was right and the lever was wrong.** The node we made ephemeral
cannot be reached from the internet. The two nodes that can be reached are not covered by the
ephemerality argument anywhere in the record. And chasing that gap turned up five defects, two of
which are launch-blocking.

---

## Part 1 — What the design record says we built

The decision was made three times, for two different reasons, and the second reason was later
withdrawn.

**April 2026 — the reason was privacy.** The original rationale
([[2026-04-11_1400_libp2p-dht-and-peer-connectivity]]) is unlinkability: a passive observer
watching traffic sees a different Peer ID each session and cannot tell that Monday's conversation
and Tuesday's involve the same agent. The same document states the limit plainly — the directory
*does* know the mapping, because it handles signalling. That is a known, accepted cost. **DDoS is
not mentioned anywhere in the original rationale.**

One constraint hangs off this: relay operators must be different entities from directory operators,
precisely so that no single party can undo the unlinkability.

**June 2026 — the rationale silently changed to anti-DDoS.** The transport audit
([[2026-06-11_0822_transport-security-audit-and-libp2p-primitives]]) and the daemon architecture
decision ([[2026-06-11_1030_daemon-transport-architecture]]) reframed ephemerality as defence
against flooding and against "Peer ID mining" — an observer cataloguing who is active by watching
stable addresses over time. That reframe drove the entire M7 daemon rebuild: splitting the
directory connection from the session connection, inventing the standing receiver, tearing sessions
down at close. It is also the only place the alternative — one fixed identity per agent — is named
and rejected on its own terms.

**August 18th 2026 — the anti-DDoS half was retracted.**
([[2026-08-17_2036_interrupted-sessions-why-they-cannot-resume]], corrections dated 08-18.) The
retraction, verbatim:

> against **flooding**, secrecy of the id was never the control anyway: libp2p's Noise handshake
> proves possession of the private key, so a learned id is an address, not a credential. The
> exposure is the open connection and the reachable endpoint.

What replaced it is a narrower rule, quoted in the current definition of done as Andre's words:

> Leave nothing open that is no longer needed. […] It is an open connection that a malicious agent
> can farm for.

**The control is the bound, not the secrecy.** That distinction is correct and it is the one that
matters for everything below.

**The seed ruling is implemented correctly.** The stored key that lets a session keep a stable
address is tied to the *session*, never to the agent. A per-agent seed would have been exactly the
permanent tracking handle the design exists to avoid. The standing receiver mints a seed, that seed
*moves* with the receiver when it is promoted into a session node at handoff, and a fresh receiver
is built behind it. Each advertised Peer ID serves exactly one session. Holding a seed is not
stabilising an identity.

### The retraction never propagated — and the false claims are still being read as current

The June documents were never amended. As of the start of this investigation,
[[m7-architecture-2026-06-12]] was still marked `status: current` and still listed, in its Key
Invariants table:

> **Ephemeral session Peer IDs** — After seal, a recorded session address leads nowhere. DDoS and
> cross-session linking are both defeated.

That is false. It describes the session node, which cannot be reached from the internet, so nothing
was ever defended. The node that *is* reachable — the standing receiver — is per-agent, lives as
long as the daemon, and its address does not die at seal. The document does not mention it.

The same table claims each session node "accepts exactly one peer. All others rejected before Noise
— they learn nothing." True of session nodes. False of the standing receiver, which is the only node
an outsider can reach and which accepts everyone.

**These documents are the upstream source of claims now sitting in outward-facing material.** The
investor competitive analysis states: *"No counterparty can contact an agent using anything from a
previous session — for DDoS, for tracking, for correlation across sessions. There is no stable
network handle to target."* The GTM messaging framework compresses it to *"No persistent endpoint to
DDoS."* Both are false as the code runs today.

**Action taken during this investigation:** both June documents were marked with correction banners,
their false rows struck through and replaced with what the code does, and `m7-architecture` moved
from `status: current` to `status: superseded-in-part` (commit `d683099f`). The architecture content
in both is accurate and was left untouched; only the security claims were marked. **The
investor and GTM material lives in the private drafts repo and has not been corrected — that is a
separate repo with its own remote, and an outward-facing decision.**

---

## Part 2 — What actually runs on an operator's machine

The daemon opens three kinds of network identity, not one. This is the part that reframes the whole
question.

### The directory connection

The client dials the directory. **The directory never dials a client.** Everything the directory
later tells you — someone wants to talk, a seal completed, presence changes — is pushed back down
the connection you opened. Every outbound dial in the directory package goes to a relay or to a
sibling directory for anti-entropy; there is no path that dials an agent.

This confirms the reasoning that prompted the investigation: **the directory needing to reach you
does not require you to be dialable.**

But this node still binds `/ip4/0.0.0.0/tcp/0` — a real open port on every network interface. It
does not need to. A `DirectoryConnectionGater` class exists in the codebase to filter who may
connect to it; it is constructed **only in tests**. Production installs no gater on this node at
all.

Its Peer ID is freshly generated on every connect and rotates constantly, so it is genuinely
ephemeral — but rotating the identity of an open port does not close the port.

### The standing receiver

This is the door people knock on. One per online agent, alive as long as the agent is online. It
binds all interfaces **and** takes a circuit-relay reservation so that agents behind home routers can
still be reached.

**Its connection gate is created with `allowedPeerId: null`, which the gater treats as *allow
everyone*.**

### The session node

The ephemeral one. The one the entire design argument is about. A freshly created session node
binds **loopback only** — `127.0.0.1`. Only programs on the same machine can connect to it. It is
not on the network at all.

This is correct for what it is: the session node is a *dialer*. It makes outgoing connections to the
counterparty or the relay. Nothing ever needs to call it.

### The consequence

**We rotated the address of a node nobody could dial, and left the two nodes anybody can dial out of
the argument entirely.** That is the answer to the original question.

No Peer ID or seed is persisted anywhere — seeds live in memory and are zeroed on teardown. Good for
unlinkability. It also means the bounded-revival property only survives a laptop sleep, not a daemon
restart.

---

## Part 3 — The July change that inverted the exposure posture

This is the pivot, and it explains why intuition and code disagreed.

**Before 2026-07-14, ordinary users were dialable by nobody.** The standing receiver bound loopback
and announced `127.0.0.1` to the world. Hole punching had never once executed, because its
precondition was never built. From
[[2026-07-14_DOD-NAT-REACHABILITY-1-inbound-is-impossible]]:

> Only agents with a **public routable IP** and **two hand-set env vars** can be reached. Everyone
> else — every laptop, every home connection, every corporate network — announces `127.0.0.1` and is
> dialable by nobody.

The DDoS surface was genuinely zero — not because ephemerality closed it, but because inbound simply
did not work.

**On 2026-07-14 that was fixed and proven live.** The standing receiver now binds routable and takes
a circuit-relay reservation **at agent-online, before any session exists**. A fresh agent is
reachable from the internet immediately, NAT irrelevant.

**No document anywhere assesses what that did to the exposure.** The fix was treated purely as a
functional launch blocker — inbound sessions did not work, now they do. Nothing records that the
client went from unreachable-by-anyone to reachable-by-anyone-holding-the-address, on a node that
lives as long as the daemon rather than as long as a session.

That is the moment the ephemerality argument stopped covering the real surface. Nobody noticed
because the argument had already been quietly replaced once.

**Compounding it:** an agent reserves with exactly **one** relay. Its entire inbound reachability
rests on that relay — a known-open item, deliberately left when the reachability fix closed. Which
reverses the DDoS story completely: the cheapest way to take an agent offline is not to flood the
agent, it is to flood the single relay holding its reservation. That is a concentrated,
well-known, infrastructure-shaped target — the opposite of the diffuse, unaddressable surface the
pitch describes.

---

## Part 4 — Finding 1: a stranger can put words in your counterparty's mouth

**This is the serious one.** Walked as the sequence an operator would actually live through:

**Step 1 — a connection arrives at the standing receiver's open port.** It is accepted. Normally a
firewall or an IP allowlist would drop connections from unrecognised sources. There is neither.
Nothing sits in front of this port.

**Step 2 — the encrypted handshake completes.** Both sides prove they hold the private key for the
identity they claim. What this proves is that the dialer owns *some* key — not that they are anyone
you know. The mechanism to check that exists (the connection gater) and is switched on, but
configured with an empty allowlist, which the code reads as allow-all.

**Step 3 — the connection sits open indefinitely.** Nothing drops a connection that has not
authenticated to anything and is not doing anything.

**Step 4 — the stranger asks what you can do.** `identify` answers with your public key, your listen
addresses, and your protocol list. Standard libp2p, on by default.

**Step 5 — the stranger waits.** No CELLO protocol is registered on an unclaimed receiver, so there
is nothing to attack yet. They simply hold the connection open. This does not block anyone else and
does not let them eavesdrop — every connection is separately encrypted. **It is a foothold placed
before the door narrows.**

**Step 6 — a real session starts with someone else.** The receiver is promoted into a session node
and the gate narrows to the one legitimate counterparty. **But libp2p's gater runs only at
connection establishment. Narrowing it does not disconnect anyone already attached.** The stranger
is still inside.

**Step 7 — the content protocol activates on that node, and the stranger can use it.**

### Why the message is accepted

On the direct path, the content frame handler performs **no check of who sent it**. The session-id
check only fires if the field is present as a string — omit it and the check passes. Three blocks
above in the same file, the session-abandon handler does both checks correctly, and carries a
comment reading *"treating a missing field as agreement is how a guard stops guarding."* The content
branch was never given either check.

The attacker sends `{ type: "content_frame", content_bytes, content_hash }` and nothing else. No
signature of any kind is involved.

The only integrity check at ingest compares the content against its own hash — both supplied by the
attacker. The code says so itself: *"this comparison only catches wire corruption of a single frame
— it does NOT prove the content matches what the sender independently committed."*

There **is** a real signature check — the relay ordering record — and it works: it verifies the
signature and confirms the signer is the expected counterparty. **It is not a gate.** It returns
null, the failure is written to the log, and the content ingests anyway. And if the attacker simply
omits the ordering fields, that check never runs at all.

### Why the message sticks

**The stored record has no sender signature and no sender field.** The transcript row records the
message and a direction — "sent" or "received." That is the entire attribution. The Merkle leaf is a
content hash and a kind byte. Nothing else.

Sender attribution is read from local session state, not from the frame. So the stranger's text is
filed as having come from the person you are actually talking to, and **nothing in the local record
could ever expose it as fake.**

### What it costs the operator

Your agent reads and acts on text a stranger wrote, believing a trusted party said it. That is the
prompt-injection pillar of "relatively safe," defeated below the layer where all screening lives —
blocked contacts, per-sender caps, trust tiers all sit on the *signalling* channel and this path
never touches them.

Two side effects on the same connection: a forged delivery acknowledgement has **no checks at all**
and cancels the timer that would otherwise park an undelivered message, so a stranger can silently
drop your messages. The session-abandon frame *is* properly pinned, so they cannot kill the session.

### The fix already exists on the other path

Messages that arrive via the relay fuse the authentication check into the ingest and **refuse the
message when it fails**. Only the direct path logs and continues. One road already does it
correctly.

To be explicit, because the phrasing has confused before: **nothing about the relay path is blocked
or restricted.** The relay path works and is the safe one. When hole punching fails and you fall
back to the relay, you are better protected. It is the direct connection that is unsafe.

---

## Part 5 — What the seal does and does not catch

The natural follow-on question: does the seal expose the injected message?

### The certificate stays clean

The leaves the directory certifies come from the **relay's** log, and the relay only accepts leaves
signed by the key that authenticated the connection. The attacker cannot sign as the counterparty,
so the injected message never enters the certified root. The directory's per-leaf signature check is
real, and a bad leaf fails the **whole** seal rather than being skipped. The attack simply routes
around it — a receiver never submits hashes for content it *receives*, only for content it sends.

### But the outcome depends on which seal path runs

| Situation | Result |
|---|---|
| Counterparty present, closes within the bilateral window (default 660s) | **Seal succeeds.** Certificate valid. Local transcript poisoned. |
| Counterparty absent, unilateral seal | **Seal rejected** — the reported root does not match. Permanent; no receipt for that conversation, ever. |
| No relay in the session | **Seal rejected** — leaf counts do not match. Terminal. |

**The attacker picks the outcome by timing.** Injection plus a prompt close gives a certified session
containing a lie. Injection plus an absent counterparty destroys the seal.

### The system notices and does nothing

The local record is now one leaf ahead of the relay. The next message the victim sends logs an
**error** and sets an internal "diverged" flag. That flag has exactly one consumer: the text
`cello status` prints. **It does not gate closing the session.**

The readiness check that would catch this looks in the wrong direction — it counts leaves the relay
has that we lack, not extra local leaves the relay never witnessed. An injected leaf is structurally
invisible to it.

### The deeper finding: the receipt is not bound to the transcript

This came out of a direct question — *when we seal, shouldn't we verify that our own transcript
agrees with the root that got certified?*

**It is not verified. On the normal path, nobody does it.**

The flow as an operator would live it:

1. You and your counterparty talk. Your daemon appends each message to your own local Merkle tree.
2. You close. Your daemon computes your tree's root, puts it inside a SEAL leaf — but **SHA-256
   hashes it first** and sends only that hash. Your actual root never leaves your machine.
3. The relay hands the directory its leaf list. The directory builds a root from **its own leaf
   encoding**, in a hash domain its own code says the client cannot reproduce.
4. The directory threshold-signs that root and pushes you a certificate.
5. Your daemon takes the sealed root off the wire, feeds it into the signature check, confirms the
   directory signed *those bytes*, and stores it. **It never asks whether that is the root of your
   transcript.** The root it computed one step earlier is discarded.

So the receipt proves the directory signed something. It does not prove the directory signed **your
conversation**.

The worst moment is co-signing: the client pulls the sealed root off the wire and folds it into the
bytes its own key signs. In between are dozens of lines carefully re-deriving and rejecting inflated
message frontiers — and zero lines about the root. **Your key signs a root you never checked.**

**Both sides defer the check to the other.** The directory:

> M1 DEBT: directory **should also verify** that each SEAL leaf's payload final_root matches the
> Merkle root… **Deferred to a follow-on story since clients perform this verification locally
> (AC-001)**

The client:

> Merkle-ROOT agreement is **deliberately NOT compared at this layer**… true root agreement belongs
> to the FROST seal against the directory-held tree.

The client check the directory defers to does not exist. And the directory's stated reason is
structurally impossible today — the SEAL leaf's `final_root` only exists inside a SHA-256 pre-image
that is never transmitted. The term appears exactly once in the whole directory repo: in that
comment.

### What IS checked, and is real

- **The unilateral path has a genuine root check.** When the counterparty vanished, the client sends
  a reported root and the directory recomputes in the **client's** hash domain and compares. This is
  the one place the loop closes, and it is done correctly.
- **Frontier inflation, both paths.** The client independently re-derives each party's highest
  provably-received message from signed leaves and refuses a certificate claiming more. Solid.
- **Every leaf's signature and the causal chain**, directory-side, with whole-seal failure on
  mismatch.
- **Leaf counts on two side paths** — the relay-unavailable seal, and a returning absent party which
  refuses to ratify unless it holds at least `leaf_count - 1` leaves. Its comment: *"This count gate
  is the bar until exact root-reproduction… lands."*

### What is not

- Sealed root versus local root — **nowhere**, on any path, in daemon, CLI, gateway, or tests.
- Leaf count versus local leaf count on the bilateral path.
- `cello_get_inclusion_proof` — which would let an operator prove a message sits under the sealed
  root — is a `not_implemented` stub.
- **`seal_attempt` is dead code.** The directory has a complete handler that compares *both parties'*
  reported roots and rejects on mismatch. Nothing anywhere sends one. The relay has a test asserting
  it never appears. The single frame designed to solve exactly this problem has no sender.

### A green test that proves less than it looks

Ten spine tests assert that both sides ended with the same sealed root. They did not both compute
it — **they both received the same bytes from the same certificate.** It proves the directory sent
one value to two parties. It says nothing about either party's transcript. Every one of these stays
green if the directory certifies a root over a completely different leaf set.

Similarly, the directory's own root-mismatch check rebuilds a root and compares it to the relay's —
using identical code over the identical leaf array. That catches an arithmetic bug, not a relay that
dropped or reordered a leaf.

### Scope discipline

No working attack against the seal has been demonstrated. The per-leaf signatures, prev-root chain
and causal checks constrain what a relay can fabricate, and they were not falsified. **The property
that can be stated flatly is: the receipt is not bound to the transcript, and if the two ever
diverged, nothing in the system would say so.**

---

## Part 6 — Finding 2: the relay is a public presence oracle

The relay accepts a liveness query asking *"is this agent connected right now?"* That handler has
**no participant check and no session check**. The frame carries a session id; the handler never
looks at it. It answers from a **global** map.

Anyone can authenticate to the relay with a throwaway keypair, because **the relay never asks a
directory whether a pubkey belongs to a registered agent**. Any Ed25519 key authenticates. There is
no rate limiting. The port is open to `0.0.0.0/0`.

So with a list of agent public keys, an attacker polls continuously and builds a live map of who is
active, when, and how often. **This is precisely the "Peer ID mining" the June audit worried about —
except it needs no Peer IDs, no session, and no traffic observation.** It walks in the front door and
asks.

Every bit of cross-session unlinkability the ephemeral design bought is bypassed by this one frame.

**Andre's proposed fix, recorded because it is the right shape:** the relay should ask the directory
whether the key is a real agent; there should be rate limiting; and more fundamentally, **you should
have no business talking to a relay at all unless the directory has issued you an assignment for a
session with a specific counterparty.**

The caveat he raised — you may have parked content waiting after being away a day — has an answer:
the assignment for *that* session already exists and was issued when the session started. You present
the assignment you already hold to collect parked messages. You are not exempt from the rule; you are
using a credential you already have.

---

## Part 7 — Finding 3: two assignment signatures, one of them single-node

When the directory brokers a session it produces **two** differently-signed artifacts:

- **The client-facing assignment**, carrying a FROST threshold signature.
- **A separate relay-facing assignment**, signed with a **single** directory node's own key, which
  the relay verifies against any key in a configured consortium set.

### Why — and it is not what it looks like

The naming misleads. The signature on the client's copy sits in a field called `directory_signature`,
but **it is not a directory's signature at all** — it is the *initiating agent's*, made with that
agent's own threshold key. From [[M8B-BUILD-JOURNAL]]:

> **This is the AGENT authorizing the session (signed with the initiator's primary_pubkey), NOT a
> directory authorization of the relay assignment.**

And, decisively:

> There is NO directory-consortium FROST group key — the agent's primary_pubkey FROST key authorizes
> the SEAL, not the relay assignment; the directories hold per-node keys + the agents' K_server
> shares.

So the two blobs authorize two different things: the **agent** authorizing this session, and a
**directory** authorizing relay service. The relay cannot use the first because it is not a directory
saying anything, and there is no consortium-wide threshold key available to sign the second with.

**History:** it began as an artifact in May — the relay already had an older Ed25519 verification
path, threshold signing arrived for the client only, and a second signature was minted rather than
changing the relay. On 2026-06-29 the plan of record was to delete it and have the relay verify the
threshold signature against "the consortium group key"
([[2026-06-29_1739_relay-directory-any-to-any-and-recordassignment-removal]]). On 2026-07-01 that
plan was **refuted**, correctly, because that key does not exist. **So it is a real constraint,
correctly identified — not an oversight.**

The relay's key set comes from environment variables. A known-parked item notes that if the
extra-keys variable is empty, the relay silently accepts only one directory. Worth confirming what
production actually has set.

The relay deliberately records *which* directory signed, so it can call that same directory back at
seal time. That is a good property and it is why the check is written as it is.

### The part that was never examined — and a correction

**There is no rationale anywhere** for the property that one compromised directory can mint a relay
assignment while the client-facing artifact needs a threshold. Nobody weighed it.

**This was initially over-ranked in this investigation and is corrected here.** Two things narrow it
substantially:

- The relay only accepts an assignment presented by a stream authenticated as **a participant named
  in it**. A rogue directory cannot mint assignments for arbitrary pairs and use them.
- The sealed record is unaffected — content leaves carry their own signer key.

What a forged relay assignment buys is a session record at the relay and a Peer ID binding. **It is a
real inconsistency in the trust model — one node holding authority where the design says a threshold
should — but it is a coherence problem, not the escalation it was first described as.**

---

## Part 8 — Finding 4: the client never verifies the directory's signature on an assignment

Confirmed still open. The parser shape-validates only, asserting the signatures are 64 bytes long.
The comment states it outright — assignments are accepted on trust, verification deferred — and names
a downstream verification site that **does not exist in the tree.**

This is the session-establishment gap scoped in
[[2026-08-21_1135_tofn-decoupling-and-seal-integrity-gaps]], now confirmed unfixed.

**It becomes load-bearing because of Finding 1's fix.** The proposed gate on the standing receiver
is *"refuse any dialer whose Peer ID is not named in a live, directory-signed session assignment."*
That gate is only as good as the signature on the assignment. **Fixing the gate without fixing the
signature check just relocates the trust to an unverified document. Order matters: verify the
assignment first, then gate on it.**

---

## Part 9 — Finding 5: the relay has almost no abuse controls

- **No rate limiting of any kind** — not on authentication attempts, not on hash submission, not on
  gap-fill, not on the liveness query, not on content-park deposits.
- **Content-park deposit is entirely unauthenticated, by explicit design** — anyone may park
  ciphertext for any recipient. With 4 MiB frames, no rate limit, and a 256 MB store, it is
  trivially fillable for every user at once.
- **No connection gater on the relay**, so circuit-relay reservations are granted to any peer up to
  4096, and the hook that would restrict who may dial a reservation holder is never installed.
- **The default limit capping relayed-connection duration and bytes is deliberately disabled.**
- **The per-session idle timer is dead in production** — the feature exists but the production binary
  never passes it, so only a 24-hour sweep runs.
- **Two relay-client leaks:** graceful shutdown never closes relay clients, and the seal-only
  detached-transport path registers a session that is never unregistered, so a cached relay client
  is never closed for the process lifetime.
- The old directory-admin push path still exists and authenticates against a single pinned key, with
  **no nonce and no timestamp** in the signed body — no replay protection. The directory no longer
  dials it, but the handler is live.

---

## Part 10 — The pattern behind four of these findings

The same defect shape has now been found four times, across two investigations:

1. Seal co-signers do not re-verify content ([[2026-08-21_1135_tofn-decoupling-and-seal-integrity-gaps]]).
2. The live-ingest signer check fires correctly and its result is discarded (same doc).
3. The direct-path content frame — the same discarded check, plus a second hole: **omit the proof
   entirely and no check runs at all.**
4. The sealed root is signed without ever being compared to the local tree.

**The shape is: an identity or integrity proof is computed, evaluated correctly, and then not acted
on.** In three of the four, a comment nearby asserts the safety property the code does not enforce.

The omission case in (3) is exactly the loophole Andre predicted during the previous investigation —
that missing or malformed proof must count as failure, not only mismatched proof. It is now confirmed
in the wild.

**This is one pattern, not four bugs.** Any fix list that treats them separately will leave the next
instance to be found later.

---

## Part 11 — Does the standing receiver need to exist, and does it need to listen?

Raised by Andre after reading the above, and it reframes the whole exposure question.

**The mental model in the design record is accurate.** A pre-made node sits ready; an inbound session
consumes it; it becomes that session's node; a fresh receiver is built behind it. The stated reason
is latency — the address is already known, already registered with the relay, already reachability-
checked, so the directory can hand it out immediately.

There is a second, more structural reason: **the responder must report its Peer ID to the directory
before the directory can issue the initiator's assignment.** Creating a node on demand adds a
round-trip to every session setup. The pre-made receiver removes it.

**But the standing receiver is doing two jobs that got conflated:**

1. Being a **pre-warmed node** so session setup is fast.
2. Being the **open listening surface** that accepts inbound connections.

**Job 2 is the entire attack surface in Part 4. And job 2 is only needed for _direct_ dials.**

**Relay-mediated inbound requires no listening socket.** A circuit reservation works by the reserving
peer dialling the relay *outbound* and holding that connection open; inbound connections arrive back
over it. That is precisely why it works for peers behind NAT.

So there is a third option nobody has weighed: **accept inbound only through the relay and bind
nothing at all.** The daemon would then have **zero listening sockets** — outbound to the directory,
outbound to the relay, and that is the entire network surface. Every finding in Part 4 becomes
unreachable, because there is no port to dial.

### Does this force all content through the relay? No — and this is the crux

**The relay circuit is used to _establish_ the connection, not to carry it.** The designed sequence:

1. The counterparty reaches you through the relay circuit. A connection exists, relayed.
2. **Hole punching upgrades that connection to direct.** Both sides simultaneously dial using the
   address information they exchanged; the outbound attempt punches the hole that admits the inbound
   packet.
3. Traffic flows peer-to-peer. The relay leaves the path.

That is exactly the stated architecture — *the relay is the introduction, not the channel*. Removing
the listening socket does not touch it. It removes the **other** way in: a stranger dialling your port
directly, which is the entire Part 4 attack surface.

**For a NAT'd user the listening socket is already doing no inbound work.** It binds to a private
address nothing on the internet can route to — that was precisely the pre-July finding. The **circuit
reservation** is what makes NAT'd users reachable today; the open port is just sitting there. So for
the overwhelming majority of users, removing it costs nothing.

**What it does cost:** operators with public routable IPs lose direct inbound dials. Hence the
opt-in recommendation rather than outright removal.

### VERIFIED 2026-08-21 — hole punching does not work, with or without a listening socket

The verification above was run. Results, which change the recommendation:

**1. A reservation works fine with no listening socket.** Confirmed in the circuit-relay package —
reserving is purely outbound (dial the relay, hold the connection), and inbound delivery is gated on
the reservation plus a live connection, not on any listener. A `/p2p-circuit` entry must appear in
`addresses.listen`, but that entry opens **no socket**. CELLO's transport already supports that shape.

**2. Hole punching cannot fire from a zero-listen node — but it cannot fire from a listening node
either.** The reason is decisive: **`@libp2p/tcp` has no port reuse at all.** No `localPort`, no
`localAddress`, no `SO_REUSEPORT` — the option type does not even carry them, and a grep for any of
them across the package returns nothing.

**Why that is fatal.** A real hole punch works because the punch dial leaves from the *listening*
port, so the NAT mapping it creates matches the address the peer was told to dial. This library dials
from a fresh ephemeral port every time. The mapping is at the wrong address. So what js-libp2p calls
DCUtR is not a simultaneous-open punch — **it is a timed direct dial**, which succeeds only when the
target was already dialable, in which case no punch was needed.

**The record already said so and it was not connected to this question.** The 2026-07-14 live proof
notes DCUtR did not fire, and `DOD-TRANSPORT-PATH-1` states plainly: *"We have never once observed a
successful hole punch in production."* Go-libp2p does perform TCP simultaneous open, so the mechanism
is real — the JavaScript implementation simply does not implement it.

**3. No UPnP/NAT-PMP anywhere.** Not in the service map, not in `core/`, not in the package store. No
router ports are being opened automatically. That concern is closed.

**4. CORRECTION — this document previously asserted that DCUtR is omitted from the standing
receiver. That was false and is retracted.** DCUtR is registered on **every** node, unconditionally,
and has been since 2026-07-14. The claim was copied from
[[2026-07-14_DOD-NAT-REACHABILITY-1-inbound-is-impossible]], which describes the state *before* a fix
that landed the same day. **This is exactly the failure mode Part 1 of this document is about — a
stale claim read as current — committed inside the document recording it.**
[[m7-architecture-2026-06-12]] carries the same stale assertion and needs the same correction.

### What the listening socket actually buys — and the resulting decision

| Case | Path today |
|---|---|
| Two agents, same machine | **Direct.** No punch needed — the receiver's address is directly dialable. |
| Two agents, same LAN | **Direct.** Same reason. |
| Across the internet, either side NAT'd | **Relayed for the entire conversation.** Always. |

Removing the listening socket would cost:

1. **Nothing on hole punching** — it cannot fire either way.
2. **Nothing on outbound direct dials to publicly-reachable agents** — that is an outbound dial and
   survives with zero sockets.
3. **Same-machine, same-LAN, and inbound to publicly-hosted agents.** These are the socket's real
   job.

**Point 3 is launch-critical.** The launch intent explicitly names *"your own two agents connect too —
across different devices, or even two sessions on the same device."* That is LAN and loopback, which
is precisely what the socket serves.

**Decision: keep the socket, gate it on the assignment.** Two independent reasons — it is load-bearing
for local and LAN connections today, and if hole punching is ever fixed it becomes load-bearing for
NAT traversal too, because the punch must dial *from* the listening port. See Design Decision 2.

### Correction to a claim made earlier in this investigation

An earlier framing that "everything goes through the relay" was **wrong and is retracted**. The
accurate statement is: **everything that crosses a NAT boundary goes through the relay.** Same-machine
and same-LAN sessions are direct and always have been — which is why two agents on one laptop
connected successfully back when the relay was not yet working.

### The follow-on this opens

Making hole punching work is now a scoped engineering question rather than a mystery. Three candidate
routes, none of them evaluated:

- **Patch TCP port reuse.** Node's connect accepts a local port and address, so the shape exists;
  whether Node permits binding a client socket to a port an active listener holds is unverified.
  Smallest change if it works.
- **QUIC.** UDP hole punching is materially more reliable than TCP and is where NAT traversal
  actually lives in practice. libp2p has a QUIC transport.
- **WebRTC.** Purpose-built, with ICE and STUN. libp2p has a transport for it.

This deserves its own investigation. **It should not start before the relay-encryption question
below is answered**, because that determines whether hole punching is a scheduled improvement or a
launch blocker.

**Answering the question directly: the standing receiver is not needed for the directory to reach
you** — that path is outbound and already works. It is needed to accept a counterparty's dial. The
real question is whether accepting *direct* dials is worth an open port at all.

**Since verified — see the VERIFIED block below.** A reservation genuinely needs no listening
socket. It is moot under Design Decision 2, which kept the socket for other reasons; if option (b) is
ever reopened, this is the settled half of it.

---

## Part 12 — Volumetric denial of service: what is actually defensible

Everything else in this document is about **unauthorized access** — who is admitted. This is about
**flooding** — how much traffic arrives. They are separate problems with separate answers, and
conflating them is what produced the false claims in the first place.

**Against the relay: solvable, and it is ordinary infrastructure work.** Scrubbing in front of the
public endpoint (Cloud Armor or equivalent), plus reservations with more than one relay so a single
one going down does not take agents offline. Build items 17 and 17a. This is a bought problem, not a
research problem.

**Against a user's machine: nothing at the application layer helps.** Once packets arrive at a home
connection the link is saturated before any of our code runs. Rate limiting, gating, authentication —
all of it executes after the damage.

**So the only client-side defence is not being addressable — which is Design Decision 2.**

This is the convergence worth seeing: **relay-mediated inbound _is_ the volumetric DDoS defence for
clients.** It moves the addressable endpoint off the operator's laptop and onto infrastructure that
can have scrubbing in front of it. An attacker holding only a circuit address must flood the relay to
reach the agent — and the relay is precisely the thing that can be defended. The surface is not
irreducible; the choice is whether it sits on a laptop or on a machine we control.

**The one limit no architecture removes:** a direct peer-to-peer connection exposes the operator's IP
address to the counterparty. Routing requires it. So anyone an agent has talked to directly can flood
it afterwards regardless of ports, gates or ephemerality.
[[2026-06-11_1030_daemon-transport-architecture]] §7 concedes this and offers relay routing as the
mitigation for operators who do not want to reveal their network location — a correct escape hatch
that needs to become a documented, surfaced choice rather than a footnote. Nothing in the shipped
client documentation currently discloses that direct sessions reveal the operator's IP.

---

## Part 13 — Can the relay read your messages? No. But the live path depends on libp2p to say so

Verified 2026-08-21, in response to the question raised by Part 11: if everything crossing a NAT
boundary is relayed, does that make "the relay never sees your conversations" untrue?

**It does not. The relay cannot read message content on any path.**

### The three paths

**Relayed connections.** The relay is a **blind byte pipe** — the hop handler joins the two streams
and passes bytes; the only inspection is byte-counting for a transfer limit. **The encrypted session
is negotiated between the two agents _through_ that pipe**, not between each agent and the relay. The
relay holds neither session key.

It also cannot substitute itself for the destination. The peer identity each side demands is the
**last** `/p2p` component of the circuit address — the destination, not the relay — and the
handshake hard-fails on mismatch. The destination's identity arrives on the directory's signed
assignment, not from the relay, so the relay cannot inject its own key into the address either.

There is no bypass: encryption is skipped only on an explicit flag CELLO never sets, and Noise is
registered as the sole encrypter with no plaintext option imported.

**Parked messages (offline mailbox).** Sealed before reaching the relay: ephemeral X25519 key
agreement to the recipient's long-term identity key, HKDF, AES-256-GCM. The relay stores the blob
verbatim and hands it back on pull. **There is no decryption code and no key anywhere in the relay
package.** Deposit being unauthenticated is safe because a sender signature over
`(session_id, recipient_pubkey, content_hash)` sits *inside* the seal, and recovery fails closed on a
missing, bad, or wrong-signer envelope.

**Hash submission.** Hashes only. The frame type has no content field.

### The design intent — partly built, differently shaped

The stated intent was that two parties derive a shared key without transmitting it.

**For parked content: built, and genuinely unreadable by the relay.** But the shape is
*ephemeral-to-static*, not a shared key between the two agents' long-term identities. The sender mints
a throwaway key per message; only the recipient's identity participates. Two consequences worth
knowing: the **sender cannot reopen its own parked message**, and the seal is anonymous — which is
exactly why a separate sender signature had to be added inside it.

**For live conversations: there is no application-layer encryption at all.** Content rides plaintext
inside the transport's Noise session. That session performs end-to-end key agreement between the two
agents, so the confidentiality property holds — **but it is libp2p's key agreement over ephemeral
transport keys, not CELLO's over agent identity keys.**

### Why that dependency is a problem — the post-quantum argument

Confidentiality on the live path rests entirely on one layer, and **we do not control that layer.**

The driver is quantum resistance. If the encryption protecting peer-to-peer content is libp2p's, then
migrating to post-quantum primitives happens on libp2p's timeline, with libp2p's algorithm choices,
and only when they ship. **CELLO cannot upgrade its own confidentiality guarantee.**

**This is not a "later" problem, and that is the part that makes it urgent.** The threat is
*harvest-now-decrypt-later*: an adversary recording relayed traffic **today** can decrypt it once
quantum capability arrives. Every cross-NAT conversation is currently relayed, so every one of them
is recordable at a known, fixed set of endpoints. Traffic sent today is retroactively at risk. Adding
the layer later does not protect what has already crossed the wire.

The primitive already exists in the tree — the parked-content seal is a working X25519 + HKDF +
AES-GCM envelope. The work is extending an application-layer envelope to the live path, under a key
CELLO derives, so the algorithm is ours to change.

### Two things the claim does not cover

**Metadata.** The relay sees who talks to whom, when, how often, and message sizes. That is inherent
to its role and is already acknowledged in the day-zero review; it should be stated rather than left
for a follow-up question to expose.

**The content hash is unsalted.** It is a SHA-256 of the plaintext, so a relay that *guesses* a
message can confirm the guess. For short predictable content — "yes", "approved", a price, a name —
that is a real leak against an adversary who holds the stored hashes.

### The audit document

[[AUDIT-ME]] proves these true claims badly: four of its seven cited file paths no longer exist
(pre-repo-split layout), and its supporting detail for the encryption claim is wrong — it says content
is additionally encrypted at the application layer, which is true only for parked content, and cites
the database backup file as evidence.

**Known and already scheduled** — it was written as a placeholder with the intent to redo it before
launch. Recorded here so the rewrite has the corrected facts to work from.

---

## Scorecard against the four original hypotheses

**"Ephemeral Peer IDs reduced the DDoS surface."** No. The node made ephemeral binds loopback and was
never reachable. The exposure is on the two long-lived nodes the argument never covered. The record
had already retracted this on 2026-08-18; the retraction never propagated.

**"It prevents monitoring of the connection."** Partly, and eroding from two directions. Cross-session
unlinkability against a passive network observer is genuine. The relay's liveness query hands out
equivalent information for free. And the standing receiver now holds a long-lived reservation with
one relay, giving that relay a persistent per-agent handle it did not have in the April model — the
model that made operator separation a protocol constraint specifically to prevent this.

**"It stops a former counterparty dialling you directly later."** **This one works.** Session
identities are per-session, memory-only, zeroed at close, lost on restart. Nobody can re-dial a dead
session. The irony is that the Finding 1 attack does not need to — it uses the *standing receiver's*
address, which the ephemerality argument never covered.

**"Can someone fake being a directory?"** A real hole, unrelated to ephemerality. A good design exists
— a signed roster compiled into the client, plus a challenge the directory must answer with its
roster key. But **the challenge only runs when the resolved directory URL byte-matches a bundled
endpoint.** A DNS name pointing at the same machine does not match, and the client then skips
directory authentication entirely, silently. That is why the production directory URL is a raw IP
address: the fail-open is known and worked around with string matching rather than fixed. Underneath,
the dial coordinate comes from a plaintext HTTP endpoint on port 9090.

**Not confirmed from code:** whether the challenge is active in the live deployment. It depends on a
runtime URL match. Two log events discriminate it.

---

## Design Decisions

Each entry states the choice that had to be made, the options weighed, and what was decided.
All seven are ruled. Decision 4 carries a deliberately deferred follow-on, scheduled with a trigger
(build item 35). Decisions 6 and 7 were surfaced by the completeness review and ruled the same day.

---

### 1. How to bind the receipt to the transcript

The certified root lives in the directory's leaf-encoding domain; the client's root lives in the
content-hash domain. They are different numbers by construction, so this is a protocol change, not a
missing comparison.

- **(a) Switch the bilateral certified root to the content-hash domain**, as the unilateral path
  already does. A one-line client comparison then works. Cost: previously sealed receipts are in the
  old domain.
- **(b) Revive `seal_attempt`.** The directory handler is written and tested; only the client sender
  is missing. It compares both parties' reported roots and catches divergence *before* notarization.
- **(c) Ship a reported root on the bilateral submit too** and reuse the unilateral verification path
  that already works.

The first recommendation was (c), on the grounds that (a) pays a migration cost on every existing
receipt. **That reasoning was wrong for our situation.** We are in alpha with one user and everything
is wiped before launch, so there is no data to preserve and the only argument for (c) evaporates.

> **DECIDED: (a).** Move the bilateral certified root into the content-hash domain. The client's check
> becomes a one-line comparison of two hashes it already holds, both seal paths use a single hash
> domain, and the unilateral path stops being a special case. Alpha is precisely when this is free.
>
> *Rule this illustrates, worth carrying forward:* a recommendation that survives only on
> backward-compatibility grounds is not a recommendation — re-derive it against an empty database.

---

### 2. Whether the daemon should bind a listening socket at all

*(Raised after the first draft — see Part 11.)*

- **(a) Keep the open port** — accept direct inbound dials, and gate them on the assignment.
- **(b) Bind nothing** — accept inbound only via relay circuit, which needs no listening socket.
- **(c) Bind nothing by default, opt in** — operators with public IPs set an env var; everyone else
  has no port.

The first recommendation was (c), on the assumption that removing the socket cost only direct inbound
dials while hole punching continued to deliver direct content. **The verification in Part 11 killed
that assumption:** hole punching cannot fire at all, with or without a socket, because
`@libp2p/tcp` has no port reuse.

> **DECIDED: (a).** Keep the socket and gate it on the assignment. Two independent reasons. First,
> removing it buys nothing on NAT traversal, since punching cannot fire either way — what the socket
> actually serves is same-machine and same-LAN connections, which the launch intent explicitly names
> (*"your own two agents connect too — across different devices, or two sessions on the same
> device"*). Second, if hole punching is ever repaired the socket becomes **required** for it, because
> the punch must dial *from* the listening port.

---

### 3. Whether the relay should learn agent registration state

Making the relay check that an authenticating key is a real agent, and that a caller is a participant
in the session it asks about, requires the relay to consult the directory — which cuts against the
relay being cheap, stateless and numerous, and against keeping it extractable as a standalone
enterprise deliverable.

- **(a) Relay queries the directory** for registration and participation.
- **(b) Relay verifies a directory-signed credential the caller presents**, learning nothing itself.

> **DECIDED: (b).** Same guarantee with no new relay-to-directory dependency, no new state, and no
> per-request latency — the caller already holds the assignment, so it simply presents it. It also
> preserves extractability: a private enterprise relay stays a signature-verifier rather than becoming
> a directory client. (a) would make every relay a stateful participant in the consortium, which is
> the opposite of the intended cost model.

---

### 4. Whether the relay-facing assignment should require a threshold

One directory currently signs it. The narrowing factors in Part 7 mean the practical exposure is
small, but the trust model says a threshold should be required and here it is not.

- **(a) Leave it.** Document the single-node authority as a known, bounded property.
- **(b) Require T directory signatures** on the relay-facing assignment.
- **(c) Introduce a directory-consortium threshold key**, which does not currently exist.

> **DECIDED: (a) for launch, hardening to follow.** The practical reach of a forged relay assignment
> is a relay-side session record and a Peer ID binding, gated behind also being an authenticated
> participant — it cannot make the permanent record lie. Against that, (b) adds a multi-node
> round-trip to every session establishment on the latency-sensitive path, for a bounded gain, and
> (c) is substantially larger. **This must be recorded as a known bounded property, not silently
> left.**
>
> **The choice between (b) and (c) is deliberately not being made now and needs a deeper
> evaluation.** Natural time for it is alongside the cryptographic-sortition work, when directory-side
> threshold mechanics are already open.

---

### 5. What shape the application-layer content encryption should take

*(Drives build items 19a and 19b.)*

The stated intent was "both sides derive the same key, and the key is never transmitted." That
describes a **static-static** agreement between the two agents' long-term identity keys. It is the
obvious reading and **it has a trap in it**, which is why this is a decision rather than a build note.

- **(a) Static-static** — derive one key from both agents' long-term identity keys.
- **(b) Per-session ephemeral handshake** — each side mints a fresh keypair per session, agrees a
  session key, and discards the ephemerals at close. Messages are AEAD-sealed under that key.
- **(c) (b) plus hybrid post-quantum** — run a classical X25519 agreement and a PQ key-encapsulation
  agreement, and mix both into the session key.

**Why not (a), which is the intuitive answer.** A key derived only from long-term identity keys gives
the same key forever. **It has no forward secrecy** — anyone who ever obtains an agent's identity key
can decrypt every conversation that agent ever had, including traffic recorded years earlier. That is
strictly worse than what runs today, because the current transport layer *does* use fresh ephemeral
keys per connection. [[design-problems]] already claims forward secrecy as a structural property;
option (a) would quietly remove it while appearing to strengthen the system. **Adding our own
encryption layer must not cost a property the existing one already provides.**

> **DECIDED: (b), with the post-quantum hook built in from the start.** Concretely:
>
> - Each side mints a fresh keypair per session, the two agree a session key, and the ephemerals are
>   destroyed at session close. This keeps the "never transmitted" property that was the original
>   intent **and** keeps forward secrecy.
> - **The key derivation must accept an additional shared secret from day one**, before there is a PQ
>   contribution to put in it. Hybrid PQ then becomes mixing a second agreed secret into the same
>   derivation — an addition, not a rewrite. Since PQ independence is the entire reason for this work,
>   omitting the hook would defeat it.
> - **The content-hash salt (build item 19b) comes out of this same handshake.** One agreement, two
>   outputs: the message-sealing key and the per-session salt.

---

### 6. Whether the transcript record should carry per-message sender proof

*Surfaced by the completeness review and ruled the same day, 2026-08-21.*

Part 4 established that the stored record has **no sender signature and no sender field**. A
transcript row holds the message and a direction — "sent" or "received" — and the Merkle leaf holds a
content hash and a kind byte. Attribution comes entirely from local session state.

Items 1–5 stop the injection at ingest. **Neither makes the stored record self-describing**, which
leaves two consequences: anything ingested before the fix can never be audited, and any *future*
ingest defect is again undetectable after the fact, because the record carries no independent
evidence of who spoke.

- **(a) Accept it.** Once ingest is gated, session state *is* the authority for attribution. No
  per-message signature is stored. Record as a known bounded property.
- **(b) Store the sender's signature with each leaf**, so the record proves authorship independently
  of whatever gate was in force when it was written.

The first recommendation was (a) — accept it, on the grounds that (b) is a wire and schema change
touching the seal path for a property items 1–5 already deliver at the boundary. **That was the same
mistake as Decision 1's first pass**: weighing a migration cost that does not exist yet.

> **DECIDED: (b).** Store the sender's signature with each leaf so the record proves authorship
> independently of whatever gate was in force when it was written.
>
> Andre's reasoning, and it generalises: **a schema change is cheapest now and never gets cheaper.**
> With no users, no transcripts worth preserving and no seals in the wild, adding the field costs a
> migration of nothing. Adding it later means adding a field to directories and clients that breaks
> past transcripts and seals — precisely the migration trap this project already warns about. Every
> such issue surfaced and fixed before there are clients is one that never becomes a stranding event.
>
> This also removes the limitation (a) would have accepted: the transcript becomes able to prove who
> authored a message on its own, rather than depending on the gate having been correct at ingest
> time. That matters the moment a transcript is shown to anyone other than its owner.
>
> **Sequence with build items 11 and 30** — all three are wire changes to the seal path and should
> land as one protocol change, not three.

---

### 7. Whether the relay's long-lived per-agent handle is accepted or mitigated

*Surfaced by the completeness review and ruled the same day, 2026-08-21.*

The standing receiver holds a **relay reservation from agent-online, independent of any session**. For
an agent that is not constantly in sessions, that receiver identity is stable for long stretches and
is known to that one relay. The April design made relay/directory operator separation a *protocol
constraint* specifically so that no single party could correlate an agent across sessions — the
reservation hands one party a persistent per-agent handle it did not have in that model.

Build item 26 (reservations with several relays) is an **availability** fix and does not address this.

- **(a) Accept it** as an inherent cost of relay-mediated inbound reachability, and disclose it
  alongside the metadata disclosure in build item 36.
- **(b) Rotate the receiver identity on a timer** when no session has consumed it, so an idle agent
  does not present one stable handle indefinitely.
- **(c) Spread reservations across several relays** so no single relay sees a continuous handle —
  which item 26 would deliver as a side effect.

> **DECIDED: (a) plus (c) as a side effect of item 26.** (b) is theatre — the relay sees the
> reconnection either way and can link old and new identities by timing, so rotating against a party
> that watches continuously buys nothing for real cost. (c) is genuinely useful and is already being
> built for availability, so the linkability benefit is free. What matters is that this is **stated**
> rather than left as an unexamined erosion of a property the design record treats as a protocol
> constraint.
>
> **Two caveats that decide whether (c) delivers anything at all, raised by Andre:**
>
> 1. **We run only two relays.** "Spread across relays" is technically true at N=2 and weak. The
>    mitigation scales with relay count, so it is partial until the relay fleet grows.
> 2. **Relay selection may not be random — and if it is deterministic, (c) delivers nothing.** If an
>    agent's relay is chosen by a stable rule (first reachable, lowest index, nearest region) then it
>    reserves with the *same* relay every time and that relay sees a continuous handle regardless of
>    how many relays exist. Andre's assessment is that selection is probably **not** random. **This is
>    unverified and is now build item 33** — it must be checked before (c) is treated as a mitigation
>    rather than an assumption.

---


---

## What Needs to Be Built or Modified

Grouped by what they achieve. Dependencies are called out where order matters.

### A — Close the injection path

1. **Pin the direct-path content frame to the dialing peer.** Require `remotePeerId` to equal the
   session's counterparty Peer ID, and make `session_id` required-and-equal. The session-abandon
   handler three blocks above already does exactly this — copy it.

2. **Pin the direct-path delivery acknowledgement too — and audit every other handler on that
   protocol.** The ack handler performs no sender check and no session check, and a forged ack cancels
   the park-on-undelivered timer, so a stranger holding an open connection can make an operator's
   messages vanish while they appear delivered. Item 1 alone does not close this — it is scoped to the
   content frame. Apply the same gate, then check **every** frame handler registered on the session
   protocol rather than only the two named here.

3. **Make the identity proof a gate, not a log line.** A missing, malformed, **or** mismatched sender
   proof must all take the same hard-fail path. Sequence position may stay soft; identity may never
   be. Applies to the direct content path and to the seal ingest path from the previous
   investigation.

4. **Sweep for the checked-then-ignored pattern rather than fixing four instances.** Part 10 states
   that this is one pattern, not four bugs, and that a list which fixes instances individually leaves
   the next one to be found later — items 1–3 and 11 fix exactly the four known instances. For every
   frame handler and every verification call in daemon, directory and relay, answer two questions:
   does a failed check take a hard-fail path, and does a **missing or malformed** proof take the same
   path as a mismatched one? Fix every hit, and **rewrite — do not delete — every nearby comment that
   asserts a property the code does not enforce**; in three of the four known instances that comment
   is why the gap survived review.

5. **Close existing connections when the gate narrows.** Promotion currently sets the allowed peer for
   future connections only. It must also disconnect every peer not on the new list. Without this,
   items 1–4 still leave a pre-positioned connection attached when the content protocol activates.

### B — Shrink the network surface

6. **Verify the directory's signature on the session assignment client-side.** Currently the parser
   only checks that signatures are 64 bytes. **Item 7 is worthless without this** — gating on an
   unverified document just relocates the trust. Do this first.

7. **Gate the standing receiver on the session assignment — assignment-named dialers only.** Refuse
   any dialer whose Peer ID is not named in a live, directory-signed assignment. The responder always
   receives the offer and reports its Peer ID *before* the counterparty dials, so the assignment
   always exists in time. No trusted-tier bypass: the gate sees a transport Peer ID minted per session
   and unknowable in advance, and trust tiers do their work one layer up at session acceptance
   (Design Decision 2). **This also closes the `identify` disclosure in Part 4 step 4** — a stranger
   currently receives the agent's public key, listen addresses and protocol list — which has no other
   mitigation on the list. Depends on item 6.

8. **Stop the directory-facing node listening at all.** It currently binds `/ip4/0.0.0.0/tcp/0` — a
   real open port on every interface — while registering **no protocol handler**, and the directory
   **never dials a client**. It has no reason to accept inbound connections. An empty listen
   configuration removes it from the attack surface entirely: no socket, no port, nothing to scan and
   nothing to gate. Strictly stronger than filtering who may connect.

   *Fallback only if something turns out to need inbound there:* install the existing
   `DirectoryConnectionGater`, which is written but constructed only in tests. Not listening is the
   fix; the gater is the consolation prize.

9. **Drop unauthenticated idle connections.** A connection that has completed the handshake but
   authenticated to nothing and done nothing should be closed on a timer.

10. **Install a connection gater on the relay, including the reservation-dial restriction hook.**
    Reservations are granted to any peer up to the 4096 cap, and the libp2p hook that restricts who
    may dial *through* to a reservation holder is never installed — so an agent's circuit address is
    dialable by anyone who learns it. **This is the relay-side twin of item 7**, and without it item 7
    only closes the direct route while the circuit route stays open. Gate reservation grants on the
    same directory-signed credential as item 19, and restrict circuit dials to the assignment-named
    counterparty.

### C — Bind the receipt to the transcript

11. **Bind the receipt to the transcript, client-side.** The client must verify the certified root
    against its own tree before accepting or co-signing a certificate. Shape is settled — Design
    Decision 1(a), move the bilateral certified root into the content-hash domain, which makes this a
    one-line comparison of two hashes the client already holds. Once both roots live in one domain,
    root equality implies leaf-set equality, so this also covers the missing bilateral leaf-count
    check noted in Part 5.

12. **Have the directory verify the SEAL leaf's `final_root` too.** Its own comment defers this to a
    client check that does not exist, and the check is structurally impossible today because
    `final_root` survives only inside a SHA-256 pre-image that is never transmitted. Decision 1(a)
    removes that obstacle. **Ship this with item 11 and delete the deferral comment** — fixing one
    side of a mutual deferral and leaving the other half pointing at it is how this gap was created.

13. **Make the diverged flag act.** Local/relay leaf divergence is already detected on the next send,
    and today it only changes what `cello status` prints. It must block the session from sealing and
    surface as a hard error. This is the cheapest item on the list and it fires **before** the seal —
    item 11 catches the same divergence later, by a different mechanism. A detection that reaches only
    a status string is not a control.

14. **Make the seal-readiness check symmetric.** It counts only leaves the relay holds that we lack.
    It must also fail when the local tree holds leaves the relay never witnessed — which is the
    direction an injected or forged leaf actually appears in, and therefore the one this whole
    investigation is about.

15. **Replace the directory's circular root check.** The directory recomputes the root from the same
    leaf array the relay supplied, using the same code — so it validates arithmetic, not the relay. It
    cannot detect a relay that dropped or reordered a leaf. Compare against something the relay did
    not supply: the parties' own reported roots (which item 11 makes available in one hash domain), or
    an independently reconstructed per-leaf signature chain.

16. **Delete the dead `seal_attempt` path.** Decision 1 chose the content-hash-domain comparison over
    reviving it, so the directory's complete-but-unreachable handler, its tests, and the relay test
    asserting the frame never appears should go with item 11. A fully written seal handler with no
    sender reads as abandoned work to anyone auditing the repo — and this repo is read by prospective
    adopters.

17. **Implement `cello_get_inclusion_proof`.** Currently a `not_implemented` stub; it is what lets an
    operator prove a specific message sits under a sealed root.

18. **Replace the seal spine tests.** Ten tests assert both sides ended with the same sealed root;
    both sides in fact received the same bytes from the same certificate, so they would stay green if
    the directory certified a root over a completely different leaf set. Replace with tests asserting
    each side's **own** tree matches the certified root.

### D — Relay authorization and abuse controls

19. **Require session context for relay access.** No relay service without a directory-issued
    assignment naming the caller as a participant — including for collecting parked content, where the
    original session's assignment is the credential the caller already holds.

20. **Fix the liveness query.** Require the caller to be a named participant in the session it asks
    about, and scope the answer to that session rather than a global map.

21. **Have the relay verify that an authenticating key is a registered agent**, rather than accepting
    any Ed25519 keypair.

22. **Add rate limiting to the relay** — per peer and per pubkey, on authentication, hash submission,
    gap-fill, liveness query, and content-park deposit. Bound the content-park store per depositor.

23. **Re-enable the per-session idle timer in the production relay binary**, and restore a duration
    and byte cap on relayed connections.

24. **Fix the two relay-client leaks** — graceful shutdown must close relay clients, and the seal-only
    detached path must unregister its session.

25. **Delete the directory-admin push handler, or justify keeping it.** It is live but has no caller —
    the directory no longer dials it. Adding replay protection (a nonce or timestamp in the signed
    body, which it lacks) hardens a code path nothing uses. **Deleting it is cheaper and strictly
    safer**; if it is kept, the reason belongs in the code.

26. **Give an agent reservations with more than one relay.** Inbound reachability currently rests on a
    single relay, which is also the cheapest way to take the agent offline.

27. **Put infrastructure-level volumetric DDoS protection in front of the relay.** Every other abuse
    control here is application-layer — it changes who is *admitted*, not how much traffic *arrives*.
    A gate runs after the TCP connection is made and the handshake has begun; it does nothing against
    raw flooding. The relay is public-facing on GCP with its port open to `0.0.0.0/0`, and
    [[server-infrastructure]] already states the requirement — *"relay nodes must implement raw-volume
    DDoS mitigation at the infrastructure level"* — which is not built. Cloud Armor or equivalent.
    **This is the only item on the list that addresses actual denial of service**; everything else
    addresses unauthorised access.

28. **Fix the directory-authentication fail-open.** The challenge must not be silently skipped when
    the directory URL fails a byte-exact match against a bundled endpoint. Resolve the bootstrap
    coordinate over an authenticated channel rather than plaintext HTTP. Scope this **after** item 33.

### E — Own the encryption

29. **Add application-layer content encryption on the live path, independent of libp2p.** Today live
    content is plaintext inside the transport's Noise session — confidentiality is real but it is
    *libp2p's* key agreement over *libp2p's* ephemeral transport keys, so **CELLO cannot upgrade its
    own confidentiality guarantee.** The driver is post-quantum readiness: migrating to PQ primitives
    must not wait on libp2p's timeline or accept libp2p's algorithm choices. The threat is
    harvest-now-decrypt-later — every cross-NAT conversation is relayed today, so it is recordable at
    fixed endpoints today, and adding the layer later does not protect traffic already sent. The
    parked-content seal is a working in-tree pattern to extend. Shape settled in Design Decision 5:
    per-session ephemeral handshake with a PQ hook in the derivation. Not static-static — that would
    void forward secrecy.

30. **Salt the content hash.** Currently an unsalted SHA-256 of the plaintext, submitted to the relay
    and stored, so a relay holding those hashes can *guess* a message and confirm the guess — which
    defeats content privacy for short predictable messages ("yes", "approved", a price, a name). Use a
    per-session salt from the same handshake as the session key (Design Decision 5) — one agreement,
    two outputs. **This is a wire change**; sequence it with item 11 rather than shipping it alone.

### F — Verify against the live deployment (cannot be answered by reading code)

31. **Confirm which directory-authentication path actually fires in production.** The challenge runs
    only when the resolved directory URL byte-matches a bundled endpoint, and the production URL is a
    raw IP specifically to satisfy that match. Two log events discriminate challenge-ran from
    challenge-skipped. **Read them on the live daemon before scoping item 28** — if it is skipping,
    the production client is not authenticating the directory at all, and item 28 moves from hardening
    to launch-blocking.

32. **Confirm the relay's configured directory-key set in production.** The keys come from environment
    variables, and a known-parked item notes that if the extra-keys variable is empty the relay
    silently accepts assignments from **one** directory only — so a session brokered by either of the
    other two would be unusable. That is a single-region dependency inside a system whose premise is
    routing around a dead node. Verify the deployed value, and make an empty set fail startup loudly
    rather than degrade silently.

33. **Confirm how an agent's relay is selected.** Decision 7 accepts the relay's long-lived per-agent
    handle on the basis that spreading reservations across relays (item 26) erodes it as a side
    effect. **That holds only if selection actually spreads.** If the rule is deterministic — first
    reachable, lowest index, nearest region — an agent reserves with the same relay every time and
    that relay sees a continuous handle no matter how many relays exist, so item 26 delivers
    availability and nothing else. Read the selection code, and note the mitigation is weak at the
    current fleet size of two regardless. If selection is deterministic, either make it spread or
    withdraw the linkability claim in Decision 7.

### G — Correct the record

34. **Correct the outward-facing claims** in the investor competitive analysis and the GTM messaging
    framework. The June internal documents were corrected in `d683099f`; the drafts repo was not.

    **These claims do not become true once the list above is built — they become _partially_ true,
    and the difference matters.** After every fix:

    - ✅ "No stranger can open a session with you or send you content" — true
    - ✅ "Nothing from a previous session lets someone reach you" — true
    - ✅ "No unauthenticated inbound surface" — true
    - ❌ "No persistent endpoint" — **false**; gating changes who gets in, not that the endpoint exists
    - ❌ "No persistent endpoint to DDoS" — **false**, and structurally so

    **A gate does not stop a flood.** It runs at the encrypted-connection layer, after the TCP
    connection is made and the handshake has begun. Packets still arrive; connections are still
    opened. Application-layer authorization and volumetric denial of service are different problems,
    and only item 27 addresses the second.

    **The claim that is both true and strong is about _authorization_, not _addressability_** — e.g.
    *"strangers cannot reach your agent; only counterparties the directory has authorized."* Anything
    promising the absence of an endpoint is unachievable for a system that accepts incoming
    connections at all, and should not be written again.

    **Also correct the frequency claim.** Material citing an 80–90% direct-connection rate describes
    hole punching that has never worked (item 39). The *confidentiality* disclosure survives — the
    relay cannot read relayed content — but "most sessions are direct" does not.

35. **Record the single-node relay assignment as a known bounded property.** Decision 4 chose to leave
    it and explicitly required that it be written down rather than silently left — this item is that
    requirement. Put it in the threat-model/protocol reference: one directory node's key signs the
    relay-facing assignment while the client-facing artifact requires a threshold; practical reach is
    a relay-side session record and a Peer ID binding, gated behind also being an authenticated
    participant named in the assignment; it cannot make the permanent record lie. Include the deferred
    (b)-versus-(c) evaluation as an open item scheduled with the cryptographic-sortition work, so it
    has a trigger rather than resurfacing as a fresh discovery.

36. **Disclose the IP exposure, and surface relay-only routing as an operator choice.** A direct
    session reveals the operator's IP address to the counterparty permanently — no gate, port change
    or ephemeral identity removes it, and anyone who has talked to you directly can flood you
    afterwards with no protocol remedy. (a) State this in the shipped client documentation, which
    currently says nothing about it. (b) Promote relay-only routing from a footnote in the
    architecture record to a real operator setting.

37. **State the relay's metadata visibility** in shipped documentation and outward-facing material.
    The relay sees who talks to whom, when, how often, and message sizes. This is inherent to its role
    and cannot be removed; the day-zero review already acknowledges it. Write it beside the true claim
    that the relay cannot read message content, so it is a disclosed property rather than something a
    customer's follow-up question exposes.

38. **Rewrite the audit document.** Already intended before launch; recorded here so the rewrite starts
    from corrected facts. Four of its seven cited file paths no longer exist (pre-repo-split layout),
    and its supporting detail for the encryption claim is wrong — it states content is additionally
    encrypted at the application layer, which is true only for parked content, and cites the database
    backup file as evidence. **The claims themselves are true; the document proves them badly**, which
    for a trust-infrastructure product whose evaluators point a coding agent at the repo is worse than
    publishing nothing.

### H — Scheduled, explicitly not launch-blocking

39. **Repair hole punching.** Root cause identified: `@libp2p/tcp` has no port reuse, so DCUtR is a
    timed direct dial rather than a simultaneous-open punch, and it has never succeeded in production.
    Three candidate routes, none evaluated: patch TCP port reuse (Node's connect accepts a local port
    and address, but whether it permits binding to a port an active listener holds is unverified);
    adopt QUIC (UDP hole punching is materially more reliable and is where NAT traversal actually
    lives); adopt WebRTC (purpose-built, with ICE and STUN). **Not a launch blocker** — the relay
    cannot read relayed content (Part 13), so the confidentiality claim survives while every cross-NAT
    conversation is relayed. The claim that must be corrected regardless is the frequency one — item
    34.

---

## How These Collapse into Units of Work

The A–H groups above are organised by **what a fix achieves**, which is how to read the list. That is
not how it ships. A unit of work has to be one repo (or an explicitly coordinated cross-repo change),
independently reviewable, and independently deployable — a different axis, and on that axis the
grouping above misfiles several items. Item 10 sits under "network surface" but is relay code
belonging with the relay auth work; items 24 and 28 sit under "relay" but are client code; and the
seal change is one protocol change currently spread across four groups.

**39 items collapse into 18 units.** Cross-repo units carry the standing rule: a change to a
cello-client package needs an explicit version-bump acceptance criterion plus the corresponding
`package.json` update in trustless-cello, or the two sides silently run different code.

### Phase 0 — run before scoping anything else

**U1 · Live-deployment verification spike** — items **31, 32, 33**
*No repo. No code.* Three questions that cannot be answered by reading source, whose answers change
the scope of other units. Item 31 decides whether U13 is hardening or launch-blocking. Item 32 may
expose a silent single-directory dependency in the relay. Item 33 decides whether U12 delivers the
linkability mitigation Decision 7 assumes, or only availability. **Do these first — they are hours,
and they re-price the rest.**

### Phase 1 — launch-blocking

**U2 · Direct-path frame handler hardening** — items **1, 2, 3, 5**
*cello-client.* One diff across the session content handler and the connection gater. Pin the content
frame and the delivery ack to the dialing peer, make missing/malformed/mismatched proof share one
hard-fail path, and disconnect peers when the gate narrows. Grouped because they are the same
handlers and the same file, and because fixing any subset leaves the injection path open.

**U3 · Assignment verification and receiver gating** — items **6, 7**
*cello-client.* Item 6 must land first, but they ship together: gating on an unverified assignment
just relocates the trust, so a release containing 7 without 6 is worse than neither.

**U4 · Client transport surface reduction** — items **8, 9**
*cello-client, transport package.* Stop the directory-facing node listening; drop unauthenticated idle
connections. Small, independent, no protocol impact.

**U5 · Relay authorization** — items **10, 19, 20, 21**
*trustless-cello, relay package.* One authorization surface: require a directory-signed assignment for
relay service, scope the liveness query to named participants, verify the authenticating key is a real
agent, and install the connection gater plus the reservation-dial hook. **Depends on U3** — the client
must be presenting a verified assignment before the relay can require one.

### Phase 2 — the seal protocol change

**U6 · Per-session key agreement** — item **29**
*cello-client, crypto + daemon.* The per-session ephemeral handshake from Decision 5, with the PQ hook
in the derivation. **Ships before U7** because it produces both outputs U7 consumes: the message
sealing key and the per-session hash salt.

**U7 · The seal wire change** — items **11, 12, 15, 16, 18, 30**, plus Decision 1(a) and Decision 6
*Both repos — the largest and most coupled unit on the list.* Move the bilateral certified root into
the content-hash domain; client verifies the certified root against its own tree; directory verifies
the SEAL leaf's `final_root`; replace the directory's circular root check; store the sender's
signature with each leaf; salt the content hash; delete the dead `seal_attempt` path; replace the
misleading spine tests. **These cannot be split.** Every one is a change to the same wire format or
depends on the domain change, and shipping any of them alone leaves the two sides disagreeing about
what a root means. Needs version-bump ACs on both sides.

**U8 · Seal detection gates** — items **13, 14**
*cello-client.* Make the diverged flag block sealing instead of changing a status string; make the
readiness check symmetric. **Independent of U7's wire change** — both act on signals that already
exist — so this can ship first and starts catching divergence immediately.

**U9 · Inclusion proof** — item **17**
*cello-client.* Depends on U7 for a root domain the client can reproduce.

### Parallel tracks — no dependency on the above

**U10 · Relay abuse controls** — items **22, 23, 25**
*trustless-cello, relay package.* Rate limiting, re-enable the idle timer and relayed-connection caps,
delete the dead directory-admin handler. Independent of U5, though both touch the relay so batch the
deploy.

**U11 · Client relay-client lifecycle** — item **24**
*cello-client.* The two leaks. Small and standalone.

**U12 · Multi-relay reservations** — item **26**, plus whatever item 33 returns
*Both repos.* Availability first; the linkability benefit Decision 7 claims is real only if U1's item
33 shows selection actually spreads.

**U13 · Directory authentication hardening** — item **28**
*cello-client, bootstrap path.* Close the fail-open; authenticate the bootstrap coordinate.
**Scope set by U1's item 31** — if the challenge is being skipped in production today, this moves into
Phase 1.

**U14 · Relay infrastructure DDoS protection** — item **27**
*trustless-cello, Terraform.* Cloud Armor or equivalent. Entirely different discipline from every
other unit — infrastructure, not protocol — so it parallelises cleanly with anything.

**U15 · Claims and documentation** — items **34, 35, 36(a), 37, 38**
*Drafts repo, vault, cello-client docs.* Correct the outward-facing claims, record the single-node
relay assignment as a known bounded property, disclose the IP exposure and the relay's metadata
visibility, rewrite the audit document. No code, no dependencies, and **the only track that can start
immediately** — the claims are wrong today regardless of what gets built.

**U16 · Relay-only routing as an operator setting** — item **36(b)**
*cello-client.* The feature half of item 36. Small, and it is the escape hatch that makes the IP
disclosure in U15 actionable rather than just a warning.

### Deferred

**U17 · Hole punching repair** — item **39**
*Research spike, then cello-client transport.* Route selection first (patch TCP port reuse / QUIC /
WebRTC), then implementation. Explicitly not launch-blocking.

**U18 · Checked-then-ignored sweep** — item **4**
*Both repos. Unknown scope — an audit exercise, not a fix.* **Run after U2 and U7**, so the four known
instances are already closed and the sweep is hunting the unknown fifth rather than rediscovering
what is already on this list.

### What this changes about sequencing

Three things fall out of the mapping that were not visible in the flat list:

1. **U1 is free and re-prices two other units.** It should run before anything is scoped.
2. **U6 must precede U7**, which was not obvious when the encryption work sat in its own group — the
   handshake produces the salt the seal wire change consumes.
3. **U8 can ship immediately and independently.** It is the cheapest work on the entire list and it
   starts catching transcript divergence before the much larger U7 lands.

---


---

## Related Documents

- [[2026-08-21_1135_tofn-decoupling-and-seal-integrity-gaps]] — the companion investigation from
  earlier the same day; Findings 1 and 4 here are the same defect pattern found on different paths,
  and Part 10 unifies them
- [[2026-04-11_1400_libp2p-dht-and-peer-connectivity]] — the April origin of ephemeral Peer IDs; the
  privacy rationale, and the accepted directory-correlation cost
- [[2026-06-11_0822_transport-security-audit-and-libp2p-primitives]] — the June audit that reframed
  ephemerality as anti-DDoS; also the first record that inbound filtering was absent
- [[2026-06-11_1030_daemon-transport-architecture]] — the architecture decision that created the
  signalling/session node split and the standing receiver; its "Security Properties Achieved" table
  was corrected during this investigation
- [[m7-architecture-2026-06-12]] — the reference doc that carried the false invariants as `current`;
  moved to `superseded-in-part`
- [[2026-08-17_2036_interrupted-sessions-why-they-cannot-resume]] — the 2026-08-18 retraction of the
  anti-DDoS rationale and the per-session-seed ruling
- [[2026-07-14_DOD-NAT-REACHABILITY-1-inbound-is-impossible]] — the pre-fix state; every laptop
  announced loopback and was dialable by nobody
- [[2026-07-31_1200_incident-standing-receiver-not-reregistered-on-reconnect]] — an earlier failure
  arising from the same two-node split
- [[2026-06-29_1739_relay-directory-any-to-any-and-recordassignment-removal]] — the plan to collapse
  the two assignment signatures, later refuted
- [[M8B-BUILD-JOURNAL]] — the 2026-07-01 decision that kept the per-node relay signature, with the
  reasoning quoted in Part 7
- [[2026-07-07_1030_sec-2-frost-signing-forgery-finding]] — an earlier unauthenticated-stream finding
  in the same family
- [[2026-07-27_2049_policy-surface-audit-touchpoints-and-open-decisions]] — the screening layer that
  the direct-path injection bypasses entirely
- [[end-to-end-flow]] — the canonical narrative the seal sections here should be reconciled against
- [[protocol-map]] — protocol domains and readiness
