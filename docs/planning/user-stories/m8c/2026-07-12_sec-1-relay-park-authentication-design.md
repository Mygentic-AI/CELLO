---
name: sec-1-relay-park-authentication-design
type: design
date: 2026-07-12
topics: [security, sec-1, relay, content-park, store-and-forward, authentication, non-repudiation, crypto, m8c]
status: design-complete-awaiting-approval
description: >
  SPARC S+P+A design pass for SEC-1 — the relay-park content authentication gap. Establishes the
  threat model (the RELAY ITSELF is the primary adversary, not a passing stranger), traces the full
  producer/consumer chain to file:line, FALSIFIES the DoD's option (a) (rejecting bare-content
  envelopes silently kills the crash backstop), and recommends option (b+): a mandatory per-message
  sender signature INSIDE the sealed envelope, verified on recovery against the session's
  counterparty key, fail-closed. Single-repo (cello-client daemon); no relay/directory change; no
  deploy. No code written yet.
---

# SEC-1 — relay-park content authentication (design pass)

> **Status: design only. No code written.** Per the work order: design → review → approve → TDD.
> Reported back to Ms_Chelly before implementation.

## 1. The defect, stated precisely

**A party who can deposit into an agent's relay mailbox can inject content into an existing session,
have it attributed to the honest counterparty, written into the hash-chained transcript, and then
*notarized by the bilateral seal*.**

The last clause is the severity. This is not "a fake message appears in a chat window." It is a
forged message that ends up **inside the Merkle tree the FROST seal attests to** — so the victim's
own notarized receipt certifies that the counterparty said something they never said. SEC-1 attacks
**non-repudiation, which is the product**.

## 2. Producer / consumer chain (traced, not assumed)

The deposit path, and every gate that does *not* fire:

1. **Deposit is fully open — no sender identity on the wire at all.**
   `cello-client core/daemon/src/content-park-client.ts:81-98` — the `content_park_deposit` frame is
   `{recipient_pubkey, content_hash, session_id, ciphertext}`. No sender field, no signature.
   The relay agrees: `trustless-cello packages/relay/src/content-park.ts:151` handles deposit with
   **no** `#authenticateCaller` call (pull `:271` and confirm `:323` *do* authenticate — but only as
   the **recipient**, which does nothing to constrain who *wrote* the entry).

2. **The justification for that openness is a category error — and it is written in both repos.**
   `content-park-client.ts:77-79`: *"Deposit is OPEN by design — the blob is E2E-encrypted to the
   recipient, so an unauthenticated deposit cannot leak plaintext."* Mirrored at
   `relay/src/content-park.ts:13`. Both sentences are **true and irrelevant**: they argue
   **confidentiality** to justify skipping **authenticity**. Encryption stops an attacker *reading*
   the mailbox. It does nothing to stop them *writing* to it. `sealToRecipient` is an anonymous
   public-key seal — **anyone holding the recipient's public key can produce a valid ciphertext.**

3. **Recovery decrypts and ingests with no sender check.**
   `daemon.ts:4003-4068` (`recoverParkedFromRelay`): unseal → `decodeParkEnvelope` → `ingestReceivedContent`.

4. **The envelope's signature check is OPTIONAL, and the attacker chooses whether it applies.**
   `session-node-manager.ts:3864-3881` (`decodeParkEnvelope`) falls back to *"treating the whole
   plaintext as raw content (no ordering record)"*. `daemon.ts:4029` only calls
   `recordOrderingRecord` **`if (env.structure1Cbor && env.structure2Cbor)`**. Omit them → zero
   verification. This is a **downgrade attack on an opt-in signature**: the verification code is
   correct and is simply skipped by not providing the input.

5. **Even when it runs, that check gates ORDERING — never ingest.**
   `#recordFrameOrdering` (`session-node-manager.ts:3898-3958`) is genuinely good: it verifies the
   sender's Ed25519 signature over `structure1Cbor`, binds it to the content hash, and **fail-closed
   requires the signer to be this session's `counterparty_pubkey`** (`:3934-3942`). But every failure
   branch is a bare `return` — and its own docblock says so (`:3841-3843`): *"any failure … is logged
   and ignored — the content still ingests."* **The one place that authenticates the sender cannot
   reject the message.**

6. **Attribution is taken from the session row, not from the envelope.**
   `session-node-manager.ts:3264`: `const senderPubkey = entry?.counterpartyPubkey ?? record.counterparty_pubkey;`
   The injected bytes are stamped with the **honest counterparty's pubkey** — the daemon never asks
   who actually deposited them, because nothing on the wire could tell it.

7. **The forged leaf is then notarized.** `#appendVerifiedContent` writes the Merkle leaf; the
   bilateral seal signs the root.

**What the attacker must supply:** the victim's public key (discoverable — it is the directory's
lookup key), a live `session_id` for a session in `active`/`interrupted` state, and reachability to
the relay. `contentHash` is `sha256(0x00 || content)` — they compute it themselves (`:3248`).
Hash-dedup (`:3278`) and the committed-state check (`:3238`) bound *replay*, not *injection*.

## 3. Threat model — the relay is the adversary, and that is the whole point

Ranked by capability, not by imagination:

| Adversary | Has session_id? | Has recipient pubkey? | Can deposit? | Verdict |
|---|---|---|---|---|
| **The relay operator** | **Yes — plaintext field in every deposit** | **Yes — it is the mailbox key** | It *serves* the pull | **Total forgery, at will** |
| The directory operator | Yes (it brokers sessions) | Yes | Yes | Total forgery |
| The real counterparty | Yes | Yes | Yes | Can backdate/append to a session it is already in (lesser) |
| A stranger | Needs to learn a 16-byte id | Yes | Yes | Gated on session_id leakage |

The top row is the finding. **CELLO's stated pitch is peer-to-peer trust "without trusting a
centralized platform."** The relay is supposed to be a dumb, untrusted store-and-forward buffer —
`INV-3` says it never sees plaintext, and that invariant *holds*. But confidentiality was mistaken
for the whole job: **a relay that cannot read your messages can still write them for you, and get
them notarized.** A malicious relay operator forging a signed, receipted admission into someone's
transcript is precisely the attack the protocol exists to make impossible.

This also settles the "is it exploitable?" question that would otherwise stall triage: it does not
depend on a session-id leak, because the party best placed to exploit it is handed the session id by
the protocol itself.

## 4. FALSIFICATION — the DoD's option (a) is WRONG as written

> DoD option (a): *"reject bare-content envelopes on recovery — require every parked entry to carry
> the ordering record."*

**This silently breaks the crash backstop and loses real messages.** There is a *legitimate
production path that parks bare content on purpose*:

`daemon.ts:1741-1774` (`startupParkFn`, the CELLO-M7-MSG-001 AC-004/AC-005 crash backstop) re-parks
un-acked content after a sender crash, and calls `encodeParkEnvelope(entry.contentBlob)` **with no
ordering record** — with the reason stated at `:1759-1761`: *"the durable awaiting queue does not
persist the ordering record."* Confirmed against the schema: `retry-queue.ts:118` /`:429` persist
only `(agentId, sessionId, contentHash, contentBlob)`.

So the ordering record is **structurally unavailable** at re-park time. Option (a) would make the
recipient reject exactly those messages — **message loss on the very path built to prevent message
loss**, and silent (the sender already believes it dispatched). Bare-content is not dead legacy or a
test artifact; it is a live degraded path. The DoD's own instruction to falsify before choosing was
correct, and it fires.

**(a) is salvageable only as (a′)**: persist the ordering record in `retry_queue` (schema migration)
so every park carries one. But that inherits a deeper problem — the ordering record embeds the
**relay-assigned sequence**, so it only exists once the relay has already witnessed the message.
Making authenticity depend on the relay's ordering makes the *relay* a precondition for trusting
content — while the relay is the adversary. **Wrong dependency direction.** Rejected.

## 5. RECOMMENDATION — option (b+): a mandatory sender signature inside the seal

**Bind authenticity to the sender's own key, not to the relay's ordering record.** The sender always
holds `K_local` — before, during, and after a crash. Nothing about this needs the relay's
cooperation, which is the property we want, because the relay is the threat.

**Envelope v2** (`encodeParkEnvelope`), signed with the sender's K_local, sealed to the recipient as
today. The signature rides **inside** the seal, so the relay can neither read it, strip it, nor forge
it:

```
signed_stmt = SHA-256( "CELLO-PARK-CONTENT-v1"           // domain separator — no cross-protocol replay
                     || session_id(16)                    // cannot be moved to another session
                     || recipient_pubkey(32)              // cannot be moved to another mailbox
                     || content_hash(32) )                // cannot be moved to other content
park_sig    = Ed25519_sign(K_local_sender, signed_stmt)   // RFC 8032
envelope    = [2, content, structure1|null, structure2|null, sender_pubkey(32), park_sig(64)]
```

**On recovery, fail closed** (`recoverParkedFromRelay`, before `ingestReceivedContent`):
1. Envelope must be v2 and carry `sender_pubkey` + `park_sig` → else **reject, do not ingest**.
2. `park_sig` must verify over the recomputed `signed_stmt` → else reject.
3. **`sender_pubkey` MUST equal this session's `counterparty_pubkey`** → else reject.
   (Reuse the exact fail-closed cross-check already written at `session-node-manager.ts:3934-3942` —
   the logic is right, it is simply not load-bearing today.)
4. Only then ingest. The existing hash cross-check, dedup, and committed-state guards stay.

Rejections are **loud** (`content.recover.unauthenticated` at WARN, with sessionId + contentHash) and
the entry is **not confirm-deleted** — a forged entry must not be able to quietly evict itself, and a
genuine bug must not silently eat mail.

**Why not authenticate the deposit at the relay instead?** Two reasons, and this is the load-bearing
architectural call:
- **It does not fix the actual threat.** The relay is the adversary; asking the relay to check
  signatures leaves it free to accept its own forgeries. Only an **end-to-end** signature the
  *recipient* verifies defends against a malicious relay.
- **It leaks metadata we currently do not leak.** Deposit is anonymous today; requiring a sender
  signature *at the relay* would hand the relay a sender→recipient social graph. The e2e fix keeps
  the relay blind **and** makes it powerless. Strictly better on both axes.

**Consequence: this is a `cello-client` daemon-only change.** No relay change, no directory change,
**no `deploy.sh`, no infra.** (Answering the work order's cross-repo question with a reason, not an
assumption: the relay-side fix is the wrong instinct.)

**And it fixes the crash backstop cleanly, with no schema migration:** `startupParkFn` re-signs at
re-park time from `(sessionId, recipient_pubkey, contentHash)` — all three already persisted in
`retry_queue` — using the owning agent's `K_local`, which it already resolves (`:1745-1756`). Bare
content stays legal; **unsigned** content does not.

## 6. Acceptance criteria (draft — for the story)

- **AC1** Every park deposit — live hook (`daemon.ts:1696`) **and** crash backstop
  (`daemon.ts:1741`) — emits a v2 envelope carrying `sender_pubkey` + a valid `park_sig`.
- **AC2** Recovery **rejects and does not ingest** an entry that is: bare/v1, missing the signature,
  carrying an invalid signature, or signed by any key **other than the session's
  `counterparty_pubkey`**. Fail-closed on unknown counterparty. Logged
  `content.recover.unauthenticated`; **not** confirm-deleted.
- **AC3 (the SEC-1 regression test — red first).** An adversary holding **only** the victim's public
  key + a live `session_id` deposits a well-formed sealed entry. Recovery **refuses** it; nothing
  enters the transcript; no leaf is appended; the seal root is unchanged. *This test must be proven
  to fail against today's code* — it is the whole point.
- **AC4** Signature is domain-separated and bound to `(session_id, recipient_pubkey, content_hash)`:
  a signature lifted from one session/mailbox/message does not verify in another. One negative test
  per binding.
- **AC5** The crash backstop still delivers: sender enqueues → crashes → restarts → re-parks →
  recipient recovers and ingests. (Guards the exact regression option (a) would have shipped.)
- **AC6** `INV-3` intact — the relay still never sees plaintext; the signature is inside the seal.
- **AC7** Observability: `content.park.signed` (deposit), `content.recover.verified` /
  `content.recover.unauthenticated` (recovery, with reason), correlationId threaded.

## 7. The one open decision for Andre (do not decide unilaterally)

**Migration: enforce immediately, or ship tolerant-then-enforce?**

The signature is produced and verified by the *same package* (the daemon) on both ends, so an
**old sender → new recipient** pairing yields a v1 envelope that AC2 now **rejects**. That is
correct behavior against an attacker and **message loss** against a lagging peer.

- **Option 1 — enforce immediately (recommended).** The fleet is effectively Andre's four local
  agents plus the EC2 demo agent. Publish daemon, promote, upgrade the demo agent, done. Clean;
  no dead tolerant branch to remember to remove later. Risk: any un-upgraded peer's parked mail is
  refused (loudly — it is logged, not silent, and the sender's entry is not deleted).
- **Option 2 — SEC-2's rollout shape.** Ship signing + *verify-if-present* first, promote, then a
  second release flips to fail-closed. Safer for a real fleet; **but it leaves the vulnerability
  fully open for the entire interim**, since an attacker just omits the signature — the exact
  downgrade this bug already is.

**Recommendation: Option 1.** Option 2's tolerant window is not a mitigation of SEC-1; it is SEC-1.
The known laggard (the EC2 demo agent) is a *known* laggard and can be upgraded in the same pass.

## 8. Scope discipline (launch triage)

Not launch-blocking by the "can a customer get the core value" test — but it is squarely in the
**"or they lose trust"** half of *ruin*. A notary whose receipts can be forged by the infrastructure
it runs on has no product. The fix is **narrow**: one envelope format, one signature, one verify,
one repo, no deploy, no migration. It does not open a rabbit hole — and the falsification in §4 is
what keeps it from becoming one (option (a) would have looked cheaper and shipped a silent
message-loss bug).

## Related

- [[M8C-DEFINITION-OF-DONE]] — SEC-1 (Tracked, not M8C-fruit); SEC-2 (the FROST-stream auth fix,
  the closest precedent — same shape: an unauthenticated stream that a public key was enough to abuse)
- [[launch-triage]] — item 1
- `CELLO-M7-MSG-001` (3b) — the park/pickup design that introduced the bare-content path
- `DOD-MSG-4` — the ordering record whose verification logic §5 promotes to load-bearing
