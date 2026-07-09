/**
 * MONIKER-2 — the offer carries the initiator's outbound name (M8C-MONIKER-SPEC §MONIKER-2).
 *
 * Tests are written RED-first per SPARC Phase R.
 *
 * The directory is a PASS-THROUGH for the moniker: it bounds the field at decode
 * (type string, 1–64 chars — junk never enters #processSessionRequest) but does
 * not judge the charset; the RECEIVER is the validation authority (a hostile
 * operator can modify their own daemon, so receiver-side validation is the only
 * one that counts — spec §3). The moniker rides the assignment OUTSIDE the TBS:
 * it is an unverified hint (spec §2 makes no integrity claim), and adding it to
 * the signed portion would break existing FROST verification.
 */

import {
  setupV3Tests,
  describe,
  it,
  expect,
} from "@claude-flow/testing";
import { Encoder, decode } from "cbor-x";
import {
  decodeInboundSignalingFrame,
  decodeOutboundSignalingFrame,
  encodeSessionAssignment,
} from "../directory-frames.js";
import type { SessionRequest, SessionAssignmentFrame } from "../directory-types.js";

setupV3Tests();

const CBOR_ENC = new Encoder({ tagUint8Array: false });

function makeAssignment(moniker?: string): SessionAssignmentFrame {
  return {
    type: "session_assignment",
    assignment: {
      session_id: new Uint8Array(16).fill(1),
      participant_a: { pubkey: new Uint8Array(32).fill(2), peer_id: "pa", multiaddrs: ["/a"] },
      participant_b: { pubkey: new Uint8Array(32).fill(3), peer_id: "pb", multiaddrs: ["/b"] },
      relay_endpoint: { peer_id: "relay", multiaddrs: ["/relay"] },
      directory_endpoint: { peer_id: "dir", multiaddrs: ["/dir"] },
      session_timestamp: 1234567890,
      directory_pubkey: new Uint8Array(32).fill(4),
      directory_signature: new Uint8Array(64).fill(5),
      signature_type: "single",
      initiator_session_peer_id: "ipeer",
      initiator_session_addrs: ["/i"],
      counterparty_session_peer_id: "cpeer",
      counterparty_session_addrs: ["/c"],
      transport_mode: "relay",
      ...(moniker !== undefined ? { moniker } : {}),
    },
  } as SessionAssignmentFrame;
}

describe("MONIKER-2 AC1b — session_request decode carries a bounded moniker", () => {
  function decodeRequest(extra: Record<string, unknown>): SessionRequest {
    const frame = CBOR_ENC.encode({
      type: "session_request",
      target_pubkey: new Uint8Array(32).fill(9),
      initiator_session_peer_id: "ipeer",
      initiator_session_addrs: ["/i"],
      ...extra,
    });
    return decodeInboundSignalingFrame(frame) as SessionRequest;
  }

  it("carries a present moniker through the typed allowlist decoder", () => {
    const decoded = decodeRequest({ moniker: "Wonderland_Alice" });
    expect(decoded.type).toBe("session_request");
    expect(decoded.moniker).toBe("Wonderland_Alice");
  });

  it("an absent moniker decodes as undefined (older client — AC4 backward compat)", () => {
    const decoded = decodeRequest({});
    expect(decoded.type).toBe("session_request");
    expect(decoded.moniker).toBeUndefined();
  });

  it("bounds the field: non-string, empty, and >64-char values decode as undefined", () => {
    expect(decodeRequest({ moniker: 42 }).moniker).toBeUndefined();
    expect(decodeRequest({ moniker: "" }).moniker).toBeUndefined();
    expect(decodeRequest({ moniker: "A".repeat(65) }).moniker).toBeUndefined();
  });

  it("does NOT judge the charset — pass-through role, the receiver is the authority", () => {
    // A 64-char-bounded string with disallowed characters still passes the directory:
    // rejecting here would let the directory silently rewrite what the receiver sees logged.
    expect(decodeRequest({ moniker: "not a valid name" }).moniker).toBe("not a valid name");
  });
});

describe("MONIKER-2 AC1b — session_assignment carries the moniker to the responder", () => {
  it("encode → decode round-trips a present moniker", () => {
    const bytes = encodeSessionAssignment(makeAssignment("Wonderland_Alice"));
    const decoded = decodeOutboundSignalingFrame(bytes) as {
      type: string;
      assignment: { moniker?: string };
    };
    expect(decoded.type).toBe("session_assignment");
    expect(decoded.assignment.moniker).toBe("Wonderland_Alice");
  });

  it("an absent moniker is OMITTED from the wire (never an empty string)", () => {
    const bytes = encodeSessionAssignment(makeAssignment());
    // Raw CBOR check: the key must not exist at all.
    const raw = decode(bytes) as { assignment: Record<string, unknown> };
    expect("moniker" in raw.assignment).toBe(false);
    const decoded = decodeOutboundSignalingFrame(bytes) as {
      type: string;
      assignment: { moniker?: string };
    };
    expect(decoded.assignment.moniker).toBeUndefined();
  });

  it("the moniker rides OUTSIDE the signed portion — encoding with and without it leaves every signed field byte-identical", () => {
    const withM = decode(encodeSessionAssignment(makeAssignment("Wonderland_Alice"))) as {
      assignment: Record<string, unknown>;
    };
    const withoutM = decode(encodeSessionAssignment(makeAssignment())) as {
      assignment: Record<string, unknown>;
    };
    delete withM.assignment["moniker"];
    expect(withM.assignment).toEqual(withoutM.assignment);
  });
});
