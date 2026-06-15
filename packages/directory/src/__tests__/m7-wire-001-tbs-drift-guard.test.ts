/**
 * CELLO-M7-WIRE-001 / H-2: TBS de-duplication drift guard
 *
 * The directory builds the session-establishment TBS via the local
 * `buildSessionEstablishmentTbsM7` helper because the published
 * @cello-protocol/protocol-types@0.0.4 exports only the 5-field
 * `buildSessionEstablishmentTbs` — the 10-field M7 layout is not yet published
 * (AC-021). Until it is, this test is the safety net that catches drift:
 *
 *   - 5-field legacy path: the local helper (with empty M7 args) MUST be
 *     byte-identical to the published protocol-types helper. This proves the
 *     directory and the client (which verifies via protocol-types) agree.
 *
 *   - 10-field M7 path: the local helper MUST match the exact canonical CBOR
 *     layout the client-side verifier reconstructs. We pin that layout with an
 *     explicit reference encoding so any change to field order/encoding fails.
 *
 * If protocol-types ever ships a 10-field helper, replace the local copy with a
 * direct import and delete this guard (per the comment in directory-node.ts).
 */

import {
  setupV3Tests,
  describe,
  it,
  expect,
} from "@claude-flow/testing";
import { randomBytes } from "node:crypto";
import { Encoder } from "cbor-x";
import { buildSessionEstablishmentTbs } from "@cello-protocol/protocol-types";
import { buildSessionEstablishmentTbsM7 } from "../directory-node.js";

setupV3Tests();

const CBOR_ENC = new Encoder({ tagUint8Array: false });

describe("H-2: session-establishment TBS drift guard", () => {
  const sessionId = new Uint8Array(randomBytes(16));
  const pubA = new Uint8Array(randomBytes(32));
  const pubB = new Uint8Array(randomBytes(32));
  const genesisPrevRoot = new Uint8Array(randomBytes(32));

  it("5-field legacy path is byte-identical to the published protocol-types helper", () => {
    const timestamp = 1_700_000_000_000; // > 0xffffffff → BigInt encoding

    // Local helper with empty M7 args falls back to the 5-field legacy layout.
    const local = buildSessionEstablishmentTbsM7(
      sessionId,
      pubA,
      pubB,
      genesisPrevRoot,
      timestamp,
      "",
      [],
      "",
      [],
      "relay",
    );

    const published = buildSessionEstablishmentTbs(
      sessionId,
      pubA,
      pubB,
      genesisPrevRoot,
      timestamp,
    );

    expect(Buffer.from(local).equals(Buffer.from(published))).toBe(true);
  });

  it("5-field legacy path matches the published helper for small (uint32) timestamps", () => {
    const timestamp = 1_000; // <= 0xffffffff → plain number encoding

    const local = buildSessionEstablishmentTbsM7(
      sessionId,
      pubA,
      pubB,
      genesisPrevRoot,
      timestamp,
      "",
      [],
      "",
      [],
      "direct",
    );
    const published = buildSessionEstablishmentTbs(
      sessionId,
      pubA,
      pubB,
      genesisPrevRoot,
      timestamp,
    );
    expect(Buffer.from(local).equals(Buffer.from(published))).toBe(true);
  });

  it("10-field M7 path matches the pinned canonical CBOR layout", () => {
    const timestamp = 1_700_000_000_000; // > 0xffffffff → BigInt
    const initiatorPeerId = "12D3KooWInitiatorPeerId";
    const counterpartyPeerId = "12D3KooWCounterpartyPeerId";
    // Intentionally unsorted to confirm the helper sorts before JSON.stringify.
    const initiatorAddrs = ["/ip4/10.0.0.2/tcp/4001", "/ip4/10.0.0.1/tcp/4001"];
    const counterpartyAddrs = ["/ip4/10.0.0.3/tcp/4001"];
    const transportMode: "direct" | "relay" = "direct";

    const local = buildSessionEstablishmentTbsM7(
      sessionId,
      pubA,
      pubB,
      genesisPrevRoot,
      timestamp,
      initiatorPeerId,
      initiatorAddrs,
      counterpartyPeerId,
      counterpartyAddrs,
      transportMode,
    );

    // Reference layout the client-side verifier reconstructs. Field order and
    // encoding are load-bearing — any drift here is a silent verification break.
    const expected = CBOR_ENC.encode([
      sessionId,
      pubA,
      pubB,
      genesisPrevRoot,
      BigInt(timestamp),
      initiatorPeerId,
      JSON.stringify(initiatorAddrs.slice().sort()),
      counterpartyPeerId,
      JSON.stringify(counterpartyAddrs.slice().sort()),
      transportMode,
    ]) as Uint8Array;

    expect(Buffer.from(local).equals(Buffer.from(expected))).toBe(true);
  });

  it("falls back to 5-field layout when any M7 field is empty", () => {
    const timestamp = 1_700_000_000_000;
    // counterparty peer id empty → must fall back to the 5-field legacy layout.
    const local = buildSessionEstablishmentTbsM7(
      sessionId,
      pubA,
      pubB,
      genesisPrevRoot,
      timestamp,
      "12D3KooWInitiatorPeerId",
      ["/ip4/10.0.0.1/tcp/4001"],
      "",
      [],
      "relay",
    );
    const published = buildSessionEstablishmentTbs(
      sessionId,
      pubA,
      pubB,
      genesisPrevRoot,
      timestamp,
    );
    expect(Buffer.from(local).equals(Buffer.from(published))).toBe(true);
  });
});
