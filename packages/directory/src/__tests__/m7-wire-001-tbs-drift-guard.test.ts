/**
 * CELLO-M7-WIRE-001 / H-2: TBS de-duplication drift guard
 *
 * The directory no longer carries its own copy of the encoder. `buildAssignmentTbs` holds one
 * thing — the rule for deciding whether the M7 session endpoints are KNOWN — and delegates every
 * byte to `buildSessionEstablishmentTbs` in @cello-protocol/protocol-types, which is also what the
 * client-side verifier calls.
 *
 * WHAT THIS GUARD IS FOR, NOW THAT THE ENCODER IS SHARED. Comparing the directory's bytes against
 * the published builder's would be vacuous — same function, both sides. The thing that can still
 * drift is the ARITY the directory chooses: which layout it signs for a given set of endpoint
 * values. Get that wrong and the client rebuilds a different layout and the signature fails, with
 * nothing on either side naming the cause. So each case below fixes the endpoint values, then
 * asserts the directory reaches the SAME layout the client's verifier would reach from the
 * assignment those values produce.
 *
 * The client's parser maps an empty peer id back to `undefined` before verifying
 * (session-assignment-parser.ts), which is why "unknown endpoint" must reach the short layout on
 * BOTH sides and why the empty-argument cases below are the load-bearing ones.
 */

import {
  setupV3Tests,
  describe,
  it,
  expect,
} from "@claude-flow/testing";
import { randomBytes } from "node:crypto";
import { buildSessionEstablishmentTbs } from "@cello-protocol/protocol-types";
import { buildAssignmentTbs } from "../directory-node.js";

setupV3Tests();

describe("H-2: session-establishment TBS drift guard", () => {
  const sessionId = new Uint8Array(randomBytes(16));
  const pubA = new Uint8Array(randomBytes(32));
  const pubB = new Uint8Array(randomBytes(32));
  const genesisPrevRoot = new Uint8Array(randomBytes(32));

  it("5-field legacy path is byte-identical to the published protocol-types helper", () => {
    const timestamp = 1_700_000_000_000; // > 0xffffffff → BigInt encoding

    // Local helper with empty M7 args falls back to the 5-field legacy layout.
    const local = buildAssignmentTbs(
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

    const local = buildAssignmentTbs(
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

  it("known endpoints reach the SAME long layout the client verifier reaches", () => {
    // The hand-pinned reference array this case used to carry is gone. It existed only because the
    // published package had no long-layout helper to import, and its own comment called it what it
    // was: a self-consistency pin, not a cross-repo guard — a coordinated edit to both the
    // directory and the pinned array would have passed while drifting from the client. The helper
    // is published now, so this compares against the real thing.
    const timestamp = 1_700_000_000_000; // > 0xffffffff → BigInt
    const initiatorPeerId = "12D3KooWInitiatorPeerId";
    const counterpartyPeerId = "12D3KooWCounterpartyPeerId";
    // Intentionally unsorted: the published helper sorts before JSON.stringify, and a directory
    // that stopped delegating would have to reproduce that to stay equal.
    const initiatorAddrs = ["/ip4/10.0.0.2/tcp/4001", "/ip4/10.0.0.1/tcp/4001"];
    const counterpartyAddrs = ["/ip4/10.0.0.3/tcp/4001"];
    const transportMode: "direct" | "relay" = "direct";

    const local = buildAssignmentTbs(
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

    const published = buildSessionEstablishmentTbs(
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

    expect(Buffer.from(local).equals(Buffer.from(published))).toBe(true);

    // ARITY IS THE PROPERTY, and equality alone does not pin it: if the directory silently took the
    // short path here, so would this expectation's own `published` call only if it were built the
    // same wrong way — it is not, but a reader cannot see that from an equals() alone. Assert the
    // long layout was actually reached by proving it differs from the short one.
    const short = buildSessionEstablishmentTbs(sessionId, pubA, pubB, genesisPrevRoot, timestamp);
    expect(Buffer.from(local).equals(Buffer.from(short))).toBe(false);
  });

  it("falls back to 5-field layout when any M7 field is empty", () => {
    const timestamp = 1_700_000_000_000;
    // counterparty peer id empty → must fall back to the 5-field legacy layout.
    const local = buildAssignmentTbs(
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
