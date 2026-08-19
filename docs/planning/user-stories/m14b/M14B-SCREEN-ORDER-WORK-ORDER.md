---
name: M14B Screening Order Work Order
type: work-order
date: 2026-08-19
milestone: M14B
topics: [m14b, documents, screening, injection-boundary, gateway, document-gate, ordering]
status: open
description: >
  Reorders inbound document screening so cheap authorization runs before content work, and so
  content screening happens where the content is READABLE — the shadow copy's projected diff —
  rather than at the wire, where a document frame is a signed binary envelope and the text
  screener is judging garbage. Derived from a full code trace on 2026-08-19.
---

# M14B — Screening Order Work Order

## Why this exists

A document update arriving today passes through 36 steps. The shared message screener runs at
steps 4–12, **before** the document layer has established anything about the sender, and it runs on
the raw frame bytes — a signed CBOR envelope wrapping a binary CRDT update.

Three consequences, all measured against the code on 2026-08-19:

1. **The shared screener's content rules are inert for documents.** Its three rewriting steps
   (invisible-character strip, lookalike normalisation, chat-template marker strip) produce a
   `redact` verdict whose rewritten bytes the document path deliberately discards — correctly,
   because rewriting inside a signed envelope destroys it rather than cleaning it. So they are
   computed and thrown away.
2. **What remains judges garbage.** The bytes are decoded as UTF-8 in non-fatal mode, so the
   language allowlist and the injection-pattern matcher see the typed text mixed with replacement
   characters from signatures and hashes. The language check has never fired. The pattern matcher
   only ever records a flag.
3. **The readable text exists, and nothing screens it.** The gate builds a shadow copy, applies the
   update to it, and computes a projected diff carrying the before-and-after text. The only rule
   that reads that text is a ten-codepoint denylist plus the content profile agreed at consent.

Separately, the document layer's cheapest checks — do we know this document, is this author still a
member, has it ended, does the signature verify — all sit *after* the entire shared screener. The
architectural reason is real and is the lever: **at step 4 nothing knows the frame is a document
yet.** Classification happens at step 14, when the bytes reach the document router.

## The ordering we want

Cheap, content-free authorization first. Then the shadow copy — which is inert, and cannot reach the
operator or their agent until admitted. Then content screening, on the projected text, refusing
rather than rewriting.

## Units

### DOD-DOC-SCREEN-CLASSIFY-1 — identify a document frame before the shared content screener

A classify-only entry point on the document frame router (the discriminator read is already
implemented and module-private; it must not become a second copy of that rule). At session ingest,
a frame that classifies as document traffic skips the shared screener's **content** steps and keeps
its **size cap**.

- The skip is logged by name, so its absence is visible rather than assumed.
- The frame still takes its leaf, at its canonical position, with kind `doc`. Ordering and the
  hold/release path are untouched.
- **Stated cost:** documents lose the language allowlist. It has never fired, and it was judging
  mojibake. Recorded here rather than discovered later.
- **Falsification owed before implementing:** confirm no terminal-block path is load-bearing for
  document frames today (a terminal block currently appends a `msg`-kind leaf without delivering —
  if that ever fires for a document, the leaf kind is already wrong).

### DOD-DOC-SCREEN-CONTENT-1 — screen the projected text, at the shadow

After the gate admits, and before the update is applied to the live document, the projected diff's
inserted text is screened by the **existing gateway screen** — the same program, the same detectors
the message path uses — and a `block` verdict becomes a gate refusal with the reason carried.

- Reuses what exists: the gateway already exposes this verb, and this time it is handed real text.
- A `redact` verdict cannot be honoured on a replica, so a rewrite-worthy finding is a **refusal**.
  There is no third outcome, matching the document path's existing contract.
- The refused envelope is quarantined by the existing mechanism — held, never discarded.
- The gate's `validate` is synchronous; the screen is not. The call therefore lands in the inbound
  receive path around the gate verdict, not inside the gate, so no gate refactor is required.

### DOD-DOC-SCREEN-CLASSIFIER-1 — wire the semantic classifier

The IN-002 scanner (`protectai/deberta-v3-small-prompt-injection-v2`) is fully implemented, tested,
and has an installer and a manifest — and nothing constructs it. The gateway builds its inbound
screener with no arguments, so it falls back to a null classifier that reports itself unavailable
and is skipped. This is system-wide, not document-specific: no inbound content anywhere is judged
for meaning today.

- Fetch, verify, construct, and pass the scanner to the inbound screener.
- **Pin the model digests.** The manifest carries `sha256: null` for every file and a floating
  `revision: "main"`; integrity currently rests on file size alone. Both are corners that get cut
  when a feature is switched on in a hurry.
- Once wired, `DOD-DOC-SCREEN-CONTENT-1` inherits it with no further change — the document path
  calls the same screen.

## Order

CLASSIFY-1 → CONTENT-1 → CLASSIFIER-1. The first two are independent of the model and deliver the
reordering on their own; the third turns on judgement of meaning everywhere at once.

## Related

- [[M14B-DEFINITION-OF-DONE]] — Tier SCREEN carries these lines
- [[M14B-BUILD-JOURNAL]] — the 2026-08-19 trace and its evidence
