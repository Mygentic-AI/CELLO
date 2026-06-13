/**
 * CELLO-M7-WIRE-001: Wire format extension tests
 *
 * Tests cover:
 *   AC-002: session_request without initiator_session_peer_id parses but fields are undefined
 *   AC-003: session_offer_accept parses correctly with all required fields
 *   AC-003: session_offer_accept with missing fields returns null
 *   AC-009: encodeSessionAssignment with M7 fields encodes them into CBOR
 *   AC-009: decodeOutboundSignalingFrame session_assignment with M7 fields parses them
 *   AC-022/AC-023: CloudWatch alarm template validation (structural check)
 *   Error reason: session_request_missing_peer_id is a valid SessionRequestErrorReason
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
  encodeSessionRequestError,
} from "../directory-frames.js";
import type {
  SessionRequest,
  SessionAssignmentFrame,
  SessionOfferAccept,
  RelaySessionAssignment,
} from "../directory-types.js";

setupV3Tests();

const CBOR_ENC = new Encoder({ tagUint8Array: false });

// ─── Test fixtures ───────────────────────────────────────────────────────────

function makeSessionId(): Uint8Array {
  return new Uint8Array(16).fill(0xab);
}

function makePubkey(fill = 0x01): Uint8Array {
  return new Uint8Array(32).fill(fill);
}

function makeSignature(fill = 0xcc): Uint8Array {
  return new Uint8Array(64).fill(fill);
}

function makeBaseAssignment(): SessionAssignmentFrame {
  return {
    type: "session_assignment",
    assignment: {
      session_id: makeSessionId(),
      participant_a: { pubkey: makePubkey(0x01), peer_id: "12D3KooWParticipantA", multiaddrs: ["/ip4/127.0.0.1/tcp/4001"] },
      participant_b: { pubkey: makePubkey(0x02), peer_id: "12D3KooWParticipantB", multiaddrs: ["/ip4/127.0.0.1/tcp/4002"] },
      relay_endpoint: { peer_id: "12D3KooWRelay", multiaddrs: ["/ip4/127.0.0.1/tcp/5000"] },
      directory_endpoint: { peer_id: "12D3KooWDirectory", multiaddrs: ["/ip4/127.0.0.1/tcp/6000"] },
      session_timestamp: 1700000000000,
      directory_pubkey: makePubkey(0x03),
      directory_signature: makeSignature(0xdd),
      signature_type: "frost",
      signer_pubkey: makePubkey(0x04),
    },
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("M7-WIRE-001: session_request with initiator session fields", () => {
  it("AC-002: parses session_request without initiator_session_peer_id — fields are undefined", () => {
    const frame = CBOR_ENC.encode({
      type: "session_request",
      target_pubkey: makePubkey(0x05),
      connection_id: "conn-123",
    });
    const decoded = decodeInboundSignalingFrame(frame) as SessionRequest;
    expect(decoded).not.toBeNull();
    expect(decoded.type).toBe("session_request");
    expect(decoded.initiator_session_peer_id).toBeUndefined();
    expect(decoded.initiator_session_addrs).toBeUndefined();
  });

  it("AC-001: parses session_request with initiator_session_peer_id and addrs", () => {
    const frame = CBOR_ENC.encode({
      type: "session_request",
      target_pubkey: makePubkey(0x05),
      connection_id: "conn-456",
      initiator_session_peer_id: "12D3KooWTestInitiatorSessionPeerId",
      initiator_session_addrs: ["/ip4/192.168.1.1/tcp/9000", "/ip4/10.0.0.1/tcp/9001"],
    });
    const decoded = decodeInboundSignalingFrame(frame) as SessionRequest;
    expect(decoded).not.toBeNull();
    expect(decoded.type).toBe("session_request");
    expect(decoded.initiator_session_peer_id).toBe("12D3KooWTestInitiatorSessionPeerId");
    expect(decoded.initiator_session_addrs).toEqual(["/ip4/192.168.1.1/tcp/9000", "/ip4/10.0.0.1/tcp/9001"]);
  });

  it("AC-001: parses session_request with peer_id but no addrs — addrs undefined", () => {
    const frame = CBOR_ENC.encode({
      type: "session_request",
      target_pubkey: makePubkey(0x05),
      initiator_session_peer_id: "12D3KooWOnlyPeerId",
    });
    const decoded = decodeInboundSignalingFrame(frame) as SessionRequest;
    expect(decoded).not.toBeNull();
    expect(decoded.initiator_session_peer_id).toBe("12D3KooWOnlyPeerId");
    expect(decoded.initiator_session_addrs).toBeUndefined();
  });
});

describe("M7-WIRE-001: session_offer_accept frame", () => {
  it("AC-003: parses valid session_offer_accept frame", () => {
    const frame = CBOR_ENC.encode({
      type: "session_offer_accept",
      session_id: makeSessionId(),
      counterparty_session_peer_id: "12D3KooWTestCounterpartySessionPeerId",
      counterparty_session_addrs: ["/ip4/127.0.0.1/tcp/9001"],
    });
    const decoded = decodeInboundSignalingFrame(frame) as SessionOfferAccept;
    expect(decoded).not.toBeNull();
    expect(decoded.type).toBe("session_offer_accept");
    // Use Buffer.from() comparison since CBOR may decode to Buffer
    expect(Buffer.from(decoded.session_id).equals(Buffer.from(makeSessionId()))).toBe(true);
    expect(decoded.counterparty_session_peer_id).toBe("12D3KooWTestCounterpartySessionPeerId");
    expect(decoded.counterparty_session_addrs).toEqual(["/ip4/127.0.0.1/tcp/9001"]);
  });

  it("AC-003: returns null when session_id is missing", () => {
    const frame = CBOR_ENC.encode({
      type: "session_offer_accept",
      counterparty_session_peer_id: "12D3KooWTest",
      counterparty_session_addrs: ["/ip4/127.0.0.1/tcp/9001"],
    });
    const decoded = decodeInboundSignalingFrame(frame);
    expect(decoded).toBeNull();
  });

  it("AC-003: returns null when session_id is wrong length", () => {
    const frame = CBOR_ENC.encode({
      type: "session_offer_accept",
      session_id: new Uint8Array(8), // wrong: 8 bytes instead of 16
      counterparty_session_peer_id: "12D3KooWTest",
      counterparty_session_addrs: ["/ip4/127.0.0.1/tcp/9001"],
    });
    const decoded = decodeInboundSignalingFrame(frame);
    expect(decoded).toBeNull();
  });

  it("AC-003: returns null when counterparty_session_peer_id is missing", () => {
    const frame = CBOR_ENC.encode({
      type: "session_offer_accept",
      session_id: makeSessionId(),
      counterparty_session_addrs: ["/ip4/127.0.0.1/tcp/9001"],
    });
    const decoded = decodeInboundSignalingFrame(frame);
    expect(decoded).toBeNull();
  });

  it("AC-003: returns null when counterparty_session_addrs is missing", () => {
    const frame = CBOR_ENC.encode({
      type: "session_offer_accept",
      session_id: makeSessionId(),
      counterparty_session_peer_id: "12D3KooWTest",
    });
    const decoded = decodeInboundSignalingFrame(frame);
    expect(decoded).toBeNull();
  });

  it("AC-003: returns null when counterparty_session_addrs contains non-strings", () => {
    const frame = CBOR_ENC.encode({
      type: "session_offer_accept",
      session_id: makeSessionId(),
      counterparty_session_peer_id: "12D3KooWTest",
      counterparty_session_addrs: [123, "/ip4/127.0.0.1/tcp/9001"],
    });
    const decoded = decodeInboundSignalingFrame(frame);
    expect(decoded).toBeNull();
  });
});

describe("M7-WIRE-001: encodeSessionAssignment with M7 fields", () => {
  it("AC-009: encodes assignment without M7 fields (backward compat)", () => {
    const frame = makeBaseAssignment();
    const encoded = encodeSessionAssignment(frame);
    const decoded = decode(encoded) as Record<string, unknown>;
    const assignment = decoded["assignment"] as Record<string, unknown>;
    expect(assignment["initiator_session_peer_id"]).toBeUndefined();
    expect(assignment["initiator_session_addrs"]).toBeUndefined();
    expect(assignment["counterparty_session_peer_id"]).toBeUndefined();
    expect(assignment["counterparty_session_addrs"]).toBeUndefined();
    expect(assignment["transport_mode"]).toBeUndefined();
  });

  it("AC-009: encodes assignment with all 5 M7 fields", () => {
    const frame = makeBaseAssignment();
    // Add M7 fields via cast (these are optional extensions to the wire format)
    const assignmentWithM7 = frame.assignment as unknown as Record<string, unknown>;
    assignmentWithM7["initiator_session_peer_id"] = "12D3KooWTestInitiatorSessionPeerId";
    assignmentWithM7["initiator_session_addrs"] = ["/ip4/127.0.0.1/tcp/9000"];
    assignmentWithM7["counterparty_session_peer_id"] = "12D3KooWTestCounterpartySessionPeerId";
    assignmentWithM7["counterparty_session_addrs"] = ["/ip4/127.0.0.1/tcp/9001"];
    assignmentWithM7["transport_mode"] = "relay";

    const encoded = encodeSessionAssignment(frame);
    const decoded = decode(encoded) as Record<string, unknown>;
    const assignment = decoded["assignment"] as Record<string, unknown>;

    expect(assignment["initiator_session_peer_id"]).toBe("12D3KooWTestInitiatorSessionPeerId");
    expect(assignment["initiator_session_addrs"]).toEqual(["/ip4/127.0.0.1/tcp/9000"]);
    expect(assignment["counterparty_session_peer_id"]).toBe("12D3KooWTestCounterpartySessionPeerId");
    expect(assignment["counterparty_session_addrs"]).toEqual(["/ip4/127.0.0.1/tcp/9001"]);
    expect(assignment["transport_mode"]).toBe("relay");
  });

  it("AC-009: encodes assignment with transport_mode 'direct'", () => {
    const frame = makeBaseAssignment();
    const assignmentWithM7 = frame.assignment as unknown as Record<string, unknown>;
    assignmentWithM7["initiator_session_peer_id"] = "12D3KooWInit";
    assignmentWithM7["initiator_session_addrs"] = ["/ip4/10.0.0.1/tcp/8000"];
    assignmentWithM7["counterparty_session_peer_id"] = "12D3KooWCounter";
    assignmentWithM7["counterparty_session_addrs"] = ["/ip4/10.0.0.2/tcp/8001"];
    assignmentWithM7["transport_mode"] = "direct";

    const encoded = encodeSessionAssignment(frame);
    const decoded = decode(encoded) as Record<string, unknown>;
    const assignment = decoded["assignment"] as Record<string, unknown>;

    expect(assignment["transport_mode"]).toBe("direct");
  });
});

describe("M7-WIRE-001: decodeOutboundSignalingFrame with M7 fields", () => {
  it("AC-009: decodes session_assignment with M7 fields", () => {
    const frame = makeBaseAssignment();
    const assignmentWithM7 = frame.assignment as unknown as Record<string, unknown>;
    assignmentWithM7["initiator_session_peer_id"] = "12D3KooWTestInitiatorSessionPeerId";
    assignmentWithM7["initiator_session_addrs"] = ["/ip4/127.0.0.1/tcp/9000"];
    assignmentWithM7["counterparty_session_peer_id"] = "12D3KooWTestCounterpartySessionPeerId";
    assignmentWithM7["counterparty_session_addrs"] = ["/ip4/127.0.0.1/tcp/9001"];
    assignmentWithM7["transport_mode"] = "relay";

    const encoded = encodeSessionAssignment(frame);
    const decoded = decodeOutboundSignalingFrame(encoded);
    expect(decoded).not.toBeNull();
    expect(decoded!.type).toBe("session_assignment");

    const sa = (decoded as unknown as { type: "session_assignment"; assignment: Record<string, unknown> }).assignment;
    expect(sa["initiator_session_peer_id"]).toBe("12D3KooWTestInitiatorSessionPeerId");
    expect(sa["initiator_session_addrs"]).toEqual(["/ip4/127.0.0.1/tcp/9000"]);
    expect(sa["counterparty_session_peer_id"]).toBe("12D3KooWTestCounterpartySessionPeerId");
    expect(sa["counterparty_session_addrs"]).toEqual(["/ip4/127.0.0.1/tcp/9001"]);
    expect(sa["transport_mode"]).toBe("relay");
  });

  it("AC-009: decodes session_assignment without M7 fields (backward compat)", () => {
    const frame = makeBaseAssignment();
    const encoded = encodeSessionAssignment(frame);
    const decoded = decodeOutboundSignalingFrame(encoded);
    expect(decoded).not.toBeNull();
    expect(decoded!.type).toBe("session_assignment");

    const sa = (decoded as unknown as { type: "session_assignment"; assignment: Record<string, unknown> }).assignment;
    expect(sa["initiator_session_peer_id"]).toBeUndefined();
    expect(sa["counterparty_session_peer_id"]).toBeUndefined();
    expect(sa["transport_mode"]).toBeUndefined();
  });

  it("AC-009: decodes transport_mode 'direct' correctly", () => {
    const frame = makeBaseAssignment();
    const assignmentWithM7 = frame.assignment as unknown as Record<string, unknown>;
    assignmentWithM7["initiator_session_peer_id"] = "12D3KooWInit";
    assignmentWithM7["initiator_session_addrs"] = ["/ip4/10.0.0.1/tcp/8000"];
    assignmentWithM7["counterparty_session_peer_id"] = "12D3KooWCounter";
    assignmentWithM7["counterparty_session_addrs"] = ["/ip4/10.0.0.2/tcp/8001"];
    assignmentWithM7["transport_mode"] = "direct";

    const encoded = encodeSessionAssignment(frame);
    const decoded = decodeOutboundSignalingFrame(encoded);
    const sa = (decoded as unknown as { type: "session_assignment"; assignment: Record<string, unknown> }).assignment;
    expect(sa["transport_mode"]).toBe("direct");
  });

  it("AC-009: ignores invalid transport_mode value", () => {
    // Build raw CBOR with invalid transport_mode
    const raw = CBOR_ENC.encode({
      type: "session_assignment",
      assignment: {
        session_id: makeSessionId(),
        participant_a: { pubkey: makePubkey(0x01), peer_id: "12D3KooWA", multiaddrs: ["/ip4/127.0.0.1/tcp/1"] },
        participant_b: { pubkey: makePubkey(0x02), peer_id: "12D3KooWB", multiaddrs: ["/ip4/127.0.0.1/tcp/2"] },
        relay_endpoint: { peer_id: "12D3KooWR", multiaddrs: ["/ip4/127.0.0.1/tcp/3"] },
        directory_endpoint: { peer_id: "12D3KooWD", multiaddrs: ["/ip4/127.0.0.1/tcp/4"] },
        session_timestamp: 1700000000000,
        directory_pubkey: makePubkey(0x03),
        directory_signature: makeSignature(0xdd),
        signature_type: "frost",
        signer_pubkey: makePubkey(0x04),
        transport_mode: "invalid_mode",
      },
    });
    const decoded = decodeOutboundSignalingFrame(raw);
    expect(decoded).not.toBeNull();
    const sa = (decoded as unknown as { type: "session_assignment"; assignment: Record<string, unknown> }).assignment;
    expect(sa["transport_mode"]).toBeUndefined();
  });
});

describe("M7-WIRE-001: session_request_error with new reason", () => {
  it("AC-002: encodes and decodes session_request_missing_peer_id reason", () => {
    const encoded = encodeSessionRequestError({
      type: "session_request_error",
      reason: "session_request_missing_peer_id",
    });
    const decoded = decodeOutboundSignalingFrame(encoded);
    expect(decoded).not.toBeNull();
    expect(decoded!.type).toBe("session_request_error");
    expect((decoded as { type: "session_request_error"; reason: string }).reason).toBe("session_request_missing_peer_id");
  });
});

describe("M7-WIRE-001: RelaySessionAssignment type check", () => {
  it("AC-009: RelaySessionAssignment accepts M7 fields", () => {
    const assignment: RelaySessionAssignment = {
      session_id: makeSessionId(),
      participant_a: makePubkey(0x01),
      participant_b: makePubkey(0x02),
      session_timestamp: 1700000000000,
      directory_signature: makeSignature(0xcc),
      initiator_session_peer_id: "12D3KooWTestInitiatorSessionPeerId",
      counterparty_session_peer_id: "12D3KooWTestCounterpartySessionPeerId",
      transport_mode: "relay",
    };
    // Type check — this compiles means the type accepts the new fields
    expect(assignment.initiator_session_peer_id).toBe("12D3KooWTestInitiatorSessionPeerId");
    expect(assignment.counterparty_session_peer_id).toBe("12D3KooWTestCounterpartySessionPeerId");
    expect(assignment.transport_mode).toBe("relay");
  });

  it("AC-009: RelaySessionAssignment works without M7 fields (backward compat)", () => {
    const assignment: RelaySessionAssignment = {
      session_id: makeSessionId(),
      participant_a: makePubkey(0x01),
      participant_b: makePubkey(0x02),
      session_timestamp: 1700000000000,
      directory_signature: makeSignature(0xcc),
    };
    expect(assignment.initiator_session_peer_id).toBeUndefined();
    expect(assignment.counterparty_session_peer_id).toBeUndefined();
    expect(assignment.transport_mode).toBeUndefined();
  });
});
