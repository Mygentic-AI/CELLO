/**
 * The relay's park-deposit refusal codes — **MIRRORED, and the mirror is guarded.**
 *
 * ─── Why a mirror rather than an import ───────────────────────────────────────────────────────
 *
 * The canonical definition is `RELAY_PARK_REFUSALS` in `@cello-protocol/protocol-types`
 * (`core/protocol-types/src/content-delivery.ts` in cello-client). The relay consumes that package
 * from npm, so it cannot import a symbol that has not been published yet — the same situation, and
 * the same resolution, as `CONTENT_PARK_PROTOCOL_ID` and `CONTENT_PARK_AUTH_DOMAIN` above it.
 *
 * ⚠️ **THE MIRROR IS THE RISK, WHICH IS WHY IT IS PINNED.** Before this file the strings were inline
 * literals in two repos that agreed only because someone checked once. A rename on either side would
 * have gone green everywhere: the relay would refuse with a new string, the client's branch would
 * stop matching, and the operator would fall through to the generic *"the relay link is back"*
 * wording — the precise defect `DOD-M15-RELAYABUSE-1` removed, reintroduced by a change nobody would
 * call a protocol change. `content-park-auth-parity.test.ts` now fails on that drift.
 *
 * ⚠️ **THESE ARE WIRE VALUES.** The string is the contract, not the key. Renaming a key costs
 * nothing; changing a value breaks every deployed peer on the other side.
 *
 * When protocol-types is next published with the canonical export, delete this file and import it.
 */
export const RELAY_PARK_REFUSALS = {
  /** The relay is throttling this depositor. Self-clears; the relay says when via `retry_after_ms`. */
  RATE_LIMITED: "rate_limited",
  /** The relay's parked-content store is at a global bound. Another relay may still accept. */
  STORE_FULL: "content_store_full",
  /** This RECIPIENT's mailbox is at its own bound — another relay would refuse it too. */
  RECIPIENT_FULL: "content_store_recipient_full",
} as const;
