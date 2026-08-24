/**
 * CELLO-M7-MSG-001 — content-park auth construction parity guard (F4, review round 1).
 *
 * The relay declares CONTENT_PARK_PROTOCOL_ID, CONTENT_PARK_AUTH_DOMAIN, and
 * buildContentParkAuthMsg locally (packages/relay/src/content-park.ts) ONLY because
 * the relay still pins @cello-protocol/protocol-types@^0.0.3, which predates this
 * story's content-delivery module. The canonical definitions live in
 * @cello-protocol/protocol-types (core/protocol-types/src/content-delivery.ts in
 * cello-client). Until protocol-types is bumped/published (AC-023/AC-024) the two
 * copies MUST stay byte-identical, or the relay's pull/confirm auth silently stops
 * verifying the client's signature.
 *
 * This guard pins the construction INDEPENDENTLY: it reconstructs the canonical
 * domain string, protocol id, and SHA-256( utf8(domain) || nonce(32) ||
 * recipient_pubkey(32) ) message from first principles and asserts the relay's
 * exported symbols match. If anyone edits the relay's local copy (or the canonical
 * one drifts), this test fails in CI. When the import is finally switched to
 * protocol-types, this guard keeps verifying the published construction matches.
 */

import { describe, it, expect } from "vitest";
import { RELAY_PARK_REFUSALS } from "../relay-park-refusals.js";
import { createHash } from "node:crypto";
import {
  CONTENT_PARK_PROTOCOL_ID,
  CONTENT_PARK_AUTH_DOMAIN,
  buildContentParkAuthMsg,
} from "../content-park.js";

// Canonical values — these are the source of truth the relay copy must match. They
// are duplicated here on purpose: this file is the pin, not a re-export of the thing
// being pinned.
const CANONICAL_PROTOCOL_ID = "/cello/content-park/1.0.0";
const CANONICAL_AUTH_DOMAIN = "CELLO-CONTENT-PARK-AUTH-v1";

/**
 * DOD-M15-RELAYABUSE-1 — the canonical park-refusal codes, transcribed from
 * `@cello-protocol/protocol-types` (`RELAY_PARK_REFUSALS`).
 *
 * ⚠️ Transcribed on purpose, exactly like the two constants above: the point of a parity test is to
 * fail when the two sides DRIFT, and importing the very symbol under test would make it tautological.
 */
const CANONICAL_PARK_REFUSALS = {
  RATE_LIMITED: "rate_limited",
  STORE_FULL: "content_store_full",
  RECIPIENT_FULL: "content_store_recipient_full",
} as const;

function canonicalAuthMsg(nonce: Uint8Array, recipientPubkey: Uint8Array): Uint8Array {
  const domain = new TextEncoder().encode(CANONICAL_AUTH_DOMAIN);
  const msg = new Uint8Array(domain.length + nonce.length + recipientPubkey.length);
  msg.set(domain, 0);
  msg.set(nonce, domain.length);
  msg.set(recipientPubkey, domain.length + nonce.length);
  return new Uint8Array(createHash("sha256").update(msg).digest());
}

describe("content-park auth construction parity (F4)", () => {
  it("the relay protocol id matches the canonical content-park protocol id", () => {
    expect(CONTENT_PARK_PROTOCOL_ID).toBe(CANONICAL_PROTOCOL_ID);
  });

  it("the relay auth domain separator matches the canonical domain", () => {
    expect(CONTENT_PARK_AUTH_DOMAIN).toBe(CANONICAL_AUTH_DOMAIN);
  });

  it("buildContentParkAuthMsg is byte-identical to the canonical SHA-256 construction", () => {
    // Deterministic fixed vectors so a drift produces a stable, debuggable diff.
    const nonce = new Uint8Array(32).map((_, i) => (i * 7 + 3) & 0xff);
    const recipientPubkey = new Uint8Array(32).map((_, i) => (i * 5 + 1) & 0xff);

    const relay = buildContentParkAuthMsg(nonce, recipientPubkey);
    const canonical = canonicalAuthMsg(nonce, recipientPubkey);

    expect(relay.length).toBe(32);
    expect(Buffer.from(relay).toString("hex")).toBe(Buffer.from(canonical).toString("hex"));
  });

  it("the construction is sensitive to both nonce and recipient (no trivial collision)", () => {
    const nonceA = new Uint8Array(32).fill(0xaa);
    const nonceB = new Uint8Array(32).fill(0xbb);
    const rpk = new Uint8Array(32).fill(0xcc);
    const rpk2 = new Uint8Array(32).fill(0xdd);

    const a = Buffer.from(buildContentParkAuthMsg(nonceA, rpk)).toString("hex");
    const b = Buffer.from(buildContentParkAuthMsg(nonceB, rpk)).toString("hex");
    const c = Buffer.from(buildContentParkAuthMsg(nonceA, rpk2)).toString("hex");

    expect(a).not.toBe(b); // nonce affects the message
    expect(a).not.toBe(c); // recipient affects the message
  });

  /**
   * ⚠️ THE CROSS-REPO GUARD THIS FAMILY WAS MISSING. The three refusal strings were inline literals
   * in two repos, agreeing only because someone checked by hand once — and verification-once is not
   * a guard.
   *
   * What drift costs, concretely: the relay renames `rate_limited`, the client's branch stops
   * matching, and an operator being deliberately throttled by a healthy relay is told their message
   * will be re-sent *"when the relay link is back"* — a link that was never down, and a trigger that
   * will never fire. That is the exact defect `DOD-M15-RELAYABUSE-1` removed, reintroduced by an edit
   * nobody would think of as a protocol change. Every test on both sides stays green.
   */
  it("the relay's park-refusal codes match the canonical wire values", () => {
    expect(RELAY_PARK_REFUSALS.RATE_LIMITED).toBe(CANONICAL_PARK_REFUSALS.RATE_LIMITED);
    expect(RELAY_PARK_REFUSALS.STORE_FULL).toBe(CANONICAL_PARK_REFUSALS.STORE_FULL);
    expect(RELAY_PARK_REFUSALS.RECIPIENT_FULL).toBe(CANONICAL_PARK_REFUSALS.RECIPIENT_FULL);
  });

  it("and the set is COMPLETE — a new code must be added to both sides, not just one", () => {
    /**
     * A value guard alone passes if the relay quietly gains a fourth refusal the client has never
     * heard of: the client falls through to the generic outage wording for a cause that has a name.
     * Counting the keys makes adding one a two-repo edit by construction.
     */
    expect(Object.keys(RELAY_PARK_REFUSALS).sort()).toEqual(Object.keys(CANONICAL_PARK_REFUSALS).sort());
  });
});