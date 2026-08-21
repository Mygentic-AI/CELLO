---
name: Live P2P exposure — what ephemeral Peer IDs actually bought, and the gaps found chasing it
type: discussion
date: 2026-08-21
topics: [transport, libp2p, relay, peer-id, ephemeral, standing-receiver, connection-gater, ddos, attack-surface, unlinkability, privacy, content-injection, seal, merkle-root, session-assignment, directory-auth, threat-model, security]
status: open-needs-decision
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
  to the other.
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

## Part 10 — The pattern behind three of these findings

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
NAT traversal too, because the punch must dial *from* the listening port. See Decisions Made 6.

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

**Not verified:** that circuit reservations need no listening socket was reasoned from how
circuit-relay-v2 works, not confirmed against this libp2p version in our tree. Confirm before
treating it as decided. This is Outstanding Design Decision 2 below.

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

## What Needs to Be Built or Modified

1. **Pin the direct-path content frame to the dialing peer.** Require `remotePeerId` to equal the
   session's counterparty Peer ID, and make `session_id` required-and-equal. The session-abandon
   handler three blocks above already does exactly this — copy it.

2. **Make the identity proof a gate, not a log line.** A missing, malformed, **or** mismatched sender
   proof must all take the same hard-fail path. Sequence position may stay soft; identity may never
   be. Applies to the direct content path and to the seal ingest path from the previous
   investigation.

3. **Gate the standing receiver on the session assignment — assignment-named dialers only.** Refuse
   any dialer whose Peer ID is not named in a live, directory-signed assignment. The responder always
   receives the offer and reports its Peer ID *before* the counterparty dials, so the assignment
   always exists in time. **Settled 2026-08-21** — no trusted-tier bypass, because the gate sees a
   transport Peer ID that is freshly minted per session and unknowable in advance; trust tiers do
   their work one layer up at session acceptance. Depends on item 4. Superseded in scope if
   Outstanding Design Decision 2 lands on binding no socket at all.

4. **Verify the directory's signature on the session assignment client-side.** Currently the parser
   only checks that signatures are 64 bytes. Item 3 is worthless without this.

5. **Close existing connections when the gate narrows.** Promotion currently sets the allowed peer
   for future connections only. It must also disconnect every peer not on the new list.

6. **Drop unauthenticated idle connections.** A connection that has completed the handshake but
   authenticated to nothing and done nothing should be closed on a timer.

7. **Stop the directory-facing node listening at all.** It currently binds `/ip4/0.0.0.0/tcp/0` —
   a real open port on every interface — while registering **no protocol handler**, and the
   directory **never dials a client**. It has no reason to accept inbound connections. An empty
   listen configuration removes it from the attack surface entirely: no socket, no port, nothing to
   scan and nothing to gate. This is strictly stronger than filtering who may connect.

   *Fallback only if something turns out to need inbound there:* install the existing
   `DirectoryConnectionGater`, which is written but constructed only in tests. Do not treat the
   gater as the primary fix — not listening is the fix.

8. **Require session context for relay access.** No relay service without a directory-issued
   assignment naming the caller as a participant — including for collecting parked content, where the
   original session's assignment is the credential.

9. **Fix the liveness query.** Require the caller to be a named participant in the session it asks
   about, and scope the answer to that session rather than a global map.

10. **Have the relay verify that an authenticating key is a registered agent**, rather than accepting
    any Ed25519 keypair.

11. **Add rate limiting to the relay** — per peer and per pubkey, on authentication, hash submission,
    gap-fill, liveness query, and content-park deposit. Bound the content-park store per depositor.

12. **Re-enable the per-session idle timer in the production relay binary**, and restore a duration
    and byte cap on relayed connections.

13. **Fix the two relay-client leaks** — graceful shutdown must close relay clients, and the
    seal-only detached path must unregister its session.

14. **Add replay protection to the directory-admin relay frames** — a nonce or timestamp in the
    signed body.

15. **Bind the receipt to the transcript.** The client must verify the certified root against its own
    tree before accepting or co-signing a certificate. See Outstanding Design Decision 1 for the
    three shapes this can take.

16. **Implement `cello_get_inclusion_proof`.** Currently a `not_implemented` stub; it is what lets an
    operator prove a specific message sits under a sealed root.

17. **Give an agent reservations with more than one relay.** Inbound reachability currently rests on a
    single relay, which is also the cheapest way to take the agent offline.

17a. **Put infrastructure-level volumetric DDoS protection in front of the relay.** Every abuse
    control on this list is application-layer — it changes who is *admitted*, not how much traffic
    *arrives*. A gate runs after the TCP connection is made and the handshake has begun; it does
    nothing against raw flooding. The relay is public-facing on GCP with its port open to
    `0.0.0.0/0`, and [[server-infrastructure]] already states the requirement — *"relay nodes must
    implement raw-volume DDoS mitigation at the infrastructure level"* — which is not built. Cloud
    Armor or equivalent. **This is the only item on the list that addresses actual denial of
    service**; everything else addresses unauthorised access.

18. **Fix the directory-authentication fail-open.** The challenge must not be silently skipped when
    the directory URL fails a byte-exact match against a bundled endpoint. Resolve the bootstrap
    coordinate over an authenticated channel rather than plaintext HTTP.

19. **Replace the seal spine tests that assert both sides received the same certificate bytes** with
    tests that assert each side's *own* tree matches the certified root.

19a. **Add application-layer content encryption on the live path, independent of libp2p.** Today live
    content is plaintext inside the transport's Noise session — confidentiality is real but it is
    *libp2p's* key agreement over *libp2p's* ephemeral transport keys. **CELLO therefore cannot
    upgrade its own confidentiality guarantee.** The driver is post-quantum readiness: migrating to PQ
    primitives must not wait on libp2p's timeline or accept libp2p's algorithm choices. The threat is
    harvest-now-decrypt-later — every cross-NAT conversation is relayed today, so it is recordable at
    fixed endpoints today, and adding the layer later does not protect traffic already sent. The
    parked-content seal is a working in-tree pattern to extend. Shape is Outstanding Design
    Decision 5.

19b. **Salt the content hash.** It is currently an unsalted SHA-256 of the plaintext, submitted to the
    relay and stored. A relay holding those hashes can *guess* a message and confirm the guess —
    which defeats content privacy for short predictable messages ("yes", "approved", a price, a
    name). Use a per-session salt derived alongside the session key, so the hash stays deterministic
    for both participants and useless to anyone else. **This is a wire change** — it alters what is
    submitted and what the directory verifies, so it must be sequenced with the seal work in item 15
    rather than shipped independently.

20. **Correct the outward-facing claims** in the investor competitive analysis and the GTM messaging
    framework. The June internal documents were corrected in `d683099f`; the drafts repo was not.

    **These claims do not become true once the list above is built — they become _partially_ true,
    and the difference matters.** After every fix:

    - ✅ "No stranger can open a session with you or send you content" — true
    - ✅ "Nothing from a previous session lets someone reach you" — true
    - ✅ "No unauthenticated inbound surface" — true
    - ❌ "No persistent endpoint" — **false**; gating changes who gets in, not that the endpoint exists
    - ❌ "No persistent endpoint to DDoS" — **false**, and structurally so

    The second point is the one to internalise: **a gate does not stop a flood.** It runs at the
    encrypted-connection layer, after the TCP connection is made and the handshake has begun. Packets
    still arrive; connections are still opened. Application-layer authorization and volumetric denial
    of service are different problems, and only item 17a addresses the second.

    **The claim that is both true and strong is about _authorization_, not _addressability_** — e.g.
    *"strangers cannot reach your agent; only counterparties the directory has authorized."* Anything
    promising the absence of an endpoint is unachievable for a system that accepts incoming
    connections at all, and should not be written again.

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

**So the only client-side defence is not being addressable — which is Outstanding Design Decision 2.**

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

## Outstanding Design Decisions

**1. How to bind the receipt to the transcript.**

The certified root lives in the directory's leaf-encoding domain; the client's root lives in the
content-hash domain. They are different numbers by construction, so this is a protocol change, not a
missing comparison. Three shapes:

- **(a) Switch the bilateral certified root to the content-hash domain**, as the unilateral path
  already does. A one-line client comparison then works. Cost: previously sealed receipts are in the
  old domain.
- **(b) Revive `seal_attempt`.** The directory handler is written and tested; only the client sender
  is missing. It compares both parties' reported roots and catches divergence *before* notarization.
- **(c) Ship a reported root on the bilateral submit too** and reuse the unilateral verification path
  that already works.

**Original recommendation was (c), then (b) — on the grounds that (a) pays a migration cost on every
existing receipt. That reasoning was wrong for our situation and is superseded; see Decisions Made.**

**2. Whether the daemon should bind a listening socket at all.** *(Raised after the first draft — see
Part 11.)*

- **(a) Keep the open port** — accept direct inbound dials, and gate them on the assignment.
- **(b) Bind nothing** — accept inbound only via relay circuit, which needs no listening socket.
  Zero listening sockets on the whole daemon.
- **(c) Bind nothing by default, opt in** — operators with public IPs who want direct inbound set an
  env var; everyone else has no port.

**Recommendation: (c), pending the verification named in Part 11.** It gives retail users — who are
behind NAT, already relayed, and have no firewall — an attack surface of literally nothing, while
preserving direct inbound for the deployments that can actually use it. (b) is the strongest security
position but removes a capability some deployments legitimately want, and it puts the relay in the
path for every inbound session, which is a privacy regression the record already treats as a real
trade. (a) keeps a port open on every laptop in order to serve a minority of deployments.

**Blocking prerequisite:** confirm that a circuit reservation genuinely requires no listening socket
in this libp2p version. If it does require one, (b) and (c) both collapse and (a) is the only option.

**3. Whether the relay should learn agent registration state.**

Making the relay check that an authenticating key is a real agent, and that a caller is a participant
in the session it asks about, requires the relay to consult the directory — which cuts against the
relay being cheap, stateless and numerous, and against keeping it extractable as a standalone
enterprise deliverable.

- **(a) Relay queries the directory** for registration and participation.
- **(b) Relay verifies a directory-signed credential the caller presents**, learning nothing itself.

**Recommendation: (b).** It delivers the same guarantee with no new relay-to-directory dependency, no
new state, and no per-request latency — the caller already holds the assignment, so it can simply
present it. It also preserves the extractability property: a private enterprise relay stays a
signature-verifier rather than becoming a directory client. (a) would make every relay a stateful
participant in the consortium, which is the opposite of the intended cost model.

**4. Whether the relay-facing assignment should require a threshold.**

One directory currently signs it. The narrowing factors in Part 7 mean the practical exposure is
small, but the trust model says a threshold should be required and here it is not.

- **(a) Leave it.** Document the single-node authority as a known, bounded property.
- **(b) Require T directory signatures** on the relay-facing assignment.
- **(c) Introduce a directory-consortium threshold key**, which does not currently exist.

**Recommendation: (a) for launch, revisit with the sortition work.** The practical reach of a forged
relay assignment is a relay-side session record and a Peer ID binding, gated behind also being an
authenticated participant — it cannot make the permanent record lie. Against that, (b) adds a
multi-node round-trip to every session establishment, on the latency-sensitive path, for a
bounded gain. (c) is a substantially larger change. The right time to reopen it is alongside the
cryptographic-sortition work already decided, since that is when directory-side threshold mechanics
are being touched anyway. **This should be recorded as a known bounded property rather than silently
left.**

**5. What shape the application-layer content encryption should take** *(build item 19a).*

The stated intent was "both sides derive the same key, and the key is never transmitted." That
describes a **static-static** agreement between the two agents' long-term identity keys. It is the
obvious reading and **it has a trap in it**, which is why this is a decision rather than a build note.

- **(a) Static-static** — derive one key from both agents' long-term identity keys.
- **(b) Per-session ephemeral handshake** — each side mints a fresh keypair per session, agrees a
  session key, and discards the ephemerals at close. Messages are AEAD-sealed under that key.
- **(c) (b) plus hybrid post-quantum** — run a classical X25519 agreement and a PQ key-encapsulation
  agreement, and mix both into the session key.

**Recommendation: (b) now, structured so (c) is a drop-in later.**

**Why not (a), which is the intuitive answer.** A key derived only from long-term identity keys gives
the same key forever. **It has no forward secrecy** — anyone who ever obtains an agent's identity key
can decrypt every conversation that agent ever had, including traffic recorded years earlier. That is
strictly worse than what runs today, because the current transport layer *does* use fresh ephemeral
keys per connection. [[design-problems]] already claims forward secrecy as a structural property;
option (a) would quietly remove it while appearing to strengthen the system. **Adding our own
encryption layer must not cost the property the existing one provides.**

(c) is the destination and is the whole reason for doing this work — but the PQ half should be added
as a second contribution mixed into the same derivation, not designed for now. Building (b) with the
derivation written to accept an additional shared secret makes (c) an addition rather than a rewrite.

**Note the interaction with build item 19b:** the per-session salt for the content hash should come
out of this same derivation. One handshake, two outputs.

---

## Decisions Made (Andre, 2026-08-21)

**1. Receipt binding: option (a) — move the bilateral certified root into the content-hash domain.**
**This reverses the recommendation above, and the reversal is the point.** The only argument for (c)
was avoiding a migration on previously sealed receipts. We are in alpha with one user and everything
is being wiped before launch, so there is no data to preserve and that argument is void. With the
migration cost removed, (a) is strictly better: the client's check becomes a one-line comparison of
two hashes it already holds, both seal paths use a single hash domain, and the unilateral path stops
being a special case. Alpha is precisely when this is free.

*General rule this illustrates, worth carrying forward:* a recommendation that survives only on
backward-compatibility grounds is not a recommendation — re-derive it against an empty database.

**Confirmed by Andre on re-reading: proceed with option (a), the bilateral certified root moves to
the content-hash domain.**

**2. Listening socket: DECIDED — keep it and gate it (option (a)).** The verification in Part 11 came
back and reversed the draft recommendation. Removing the socket would buy nothing on NAT traversal,
because hole punching cannot fire either way — `@libp2p/tcp` has no port reuse. What the socket
actually serves is same-machine and same-LAN connections, which the launch intent explicitly names.
And if hole punching is ever fixed, the socket becomes required for it, since the punch must dial from
the listening port. Both reasons point the same way.

**3. Relay authorization: option (b) — the relay verifies a directory-signed credential the caller
presents, and learns nothing itself.** Keeps the relay a signature-verifier rather than a stateful
consortium participant, adds no relay-to-directory dependency or per-request latency, and preserves
the extractability property that lets an enterprise run its own relay
([[project_relay_is_future_enterprise_deliverable|relay as future enterprise deliverable]]).

**4. Relay-facing assignment signature: option (a) for launch — accept the single-node signature as a
known, bounded property and document it as such. Hardening to follow.** The choice between (b)
requiring T directory signatures and (c) introducing a directory-consortium threshold key **needs a
deeper evaluation and is deliberately not being made now.** Natural time to do that evaluation is
alongside the cryptographic-sortition work, when directory-side threshold mechanics are already open.

**6. Hole punching is broken and its repair is a scoped project, not a mystery.** Root cause is
identified — no TCP port reuse in the JavaScript libp2p transport, so DCUtR is a timed direct dial
rather than a simultaneous-open punch. Andre confirms this matches observed behaviour: he has never
seen a successful punch, only same-machine direct connections or relayed ones. Three candidate routes
(patch TCP port reuse / QUIC / WebRTC), none evaluated. **Sequencing ruling: do not start this until
the relay-encryption question is settled**, because that decides whether hole punching is a scheduled
improvement or a launch blocker.

**7. The perception problem is distinct from the technical one, and is the reason the encryption
question is urgent.** Andre's framing, recorded because it sets the bar for what may be claimed:

> The public position has always been that most peer-to-peer connections end up direct — roughly
> 80–90% — and that the remaining 10–20% fall back to the relay. Public material has been careful to
> say the relay does not see conversations *in most cases*, and to disclose the fallback. That is
> transparent and defensible.
>
> **If the real number is "everything except sessions on your own laptop", the disclosure becomes a
> lie.** Not because the architecture changed, but because the fallback turned out to be the primary
> path.

So the technical question — can the relay decrypt what passes through it — determines whether this is
a performance problem or a truthfulness problem.

**9. The relay-encryption question is answered and the perception problem dissolves.** The relay
cannot read message content on any path — verified. So even though every cross-NAT conversation is
relayed for its whole duration, *"the relay never sees your conversations"* remains **true**. The
disclosure about a relay fallback stays defensible; what needs revising is the **frequency** claim
(the 80–90% direct figure describes hole punching that has never worked), not the confidentiality
claim. **Hole-punching repair is therefore a scheduled improvement, not a launch blocker** — which
resolves the sequencing question in Decision 6.

**10. Application-layer content encryption on the live path must be built, and the reason is
post-quantum independence.** Andre's ruling: peer-to-peer content confidentiality must not depend on
libp2p. *"At some point in the not too distant future we may upgrade a portion of our cryptographic
libraries and processes to become quantum computing resistant. We don't want to have encryption
between two peers passing messages through the relay dependent on libp2p."* Build item 19a; shape is
Outstanding Design Decision 5. Note this is time-sensitive rather than deferrable — relayed traffic
recorded today is decryptable later, so the window for protecting a given conversation closes when it
is sent, not when the fix ships.

**11. Salt the content hash.** Build item 19b. An unsalted plaintext hash lets a relay confirm guessed
messages. Sequenced with the seal work, since it is a wire change.

**12. The audit document is known-broken and its rewrite is already intended before launch.** Not a
new finding — it was written as a placeholder. Recorded so the rewrite starts from corrected facts:
four cited paths no longer exist, and the application-layer encryption claim is true only of parked
content.

**13. Settled, moved out of design decisions and into the build list: the standing receiver's gate
admits assignment-named dialers only.** Not a genuine X-versus-Y choice — a trusted-tier bypass
cannot work at this layer, because the gate sees a transport Peer ID that is freshly minted per
session and unknowable in advance. Trust tiers already do their work one layer up at session
acceptance. See build item 3.

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
