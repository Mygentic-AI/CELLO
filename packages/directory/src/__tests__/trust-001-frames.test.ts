// TRUST-001 — signaling codec for the pickup delivery frames.
import { describe, it, expect } from "vitest";
import { decode, encode } from "cbor-x";
import { encodeTrustSignalPickup, decodeInboundSignalingFrame } from "../directory-frames.js";

describe("TRUST-001 — pickup signaling frames", () => {
  it("encodeTrustSignalPickup carries the ciphertext + anchor hash + ack handle (decodable by the daemon)", () => {
    const ciphertext = Uint8Array.from({ length: 80 }, (_, i) => (i * 13 + 5) % 256);
    const bytes = encodeTrustSignalPickup({
      type: "trust_signal_pickup",
      id: "42",
      signal_kind: "webauthn",
      signal_hash: "a".repeat(64),
      ciphertext,
    });
    const decoded = decode(bytes) as {
      type: string;
      id: string;
      signal_kind: string;
      signal_hash: string;
      ciphertext: Uint8Array;
    };
    expect(decoded.type).toBe("trust_signal_pickup");
    expect(decoded.id).toBe("42");
    expect(decoded.signal_kind).toBe("webauthn");
    expect(decoded.signal_hash).toBe("a".repeat(64));
    expect(Buffer.compare(Buffer.from(decoded.ciphertext), Buffer.from(ciphertext))).toBe(0);
  });

  it("decodeInboundSignalingFrame round-trips a trust_signal_ack", () => {
    
    const frame = decodeInboundSignalingFrame(encode({ type: "trust_signal_ack", id: "42" }));
    expect(frame).toEqual({ type: "trust_signal_ack", id: "42" });
  });

  it("a trust_signal_ack with no id is rejected (null)", () => {
    
    expect(decodeInboundSignalingFrame(encode({ type: "trust_signal_ack" }))).toBeNull();
  });
});
