// Cross-node topology — discovery frame codec + visiting-auth flag (item 1 + item 3 wire).
// Pure-unit: exercises the CBOR encode/decode contracts settled in
// docs/planning/discussion_logs/2026-07-04_1730_cross-node-session-topology.md §"Item 1 / Item 3".
// No Postgres, no network — runs in the default `pnpm run test` gate.

import { describe, it, expect } from "vitest";
import { decode as cborDecode } from "cbor-x";
import {
  decodeInboundSignalingFrame,
  encodeDiscoveryLookupResult,
  encodeDiscoveryLookupError,
} from "../directory-frames.js";
import { Encoder } from "cbor-x";

const ENC = new Encoder({ tagUint8Array: false });
const PUBKEY = new Uint8Array(32).fill(7);
const SIG = new Uint8Array(64).fill(9);

describe("cross-node discovery frame codec (item 1)", () => {
  it("decodes a well-formed discovery_lookup request", () => {
    const bytes = ENC.encode({ type: "discovery_lookup", target_pubkey: PUBKEY });
    const parsed = decodeInboundSignalingFrame(bytes);
    expect(parsed?.type).toBe("discovery_lookup");
    expect(parsed && "target_pubkey" in parsed && Buffer.from((parsed as { target_pubkey: Uint8Array }).target_pubkey)).toEqual(
      Buffer.from(PUBKEY),
    );
  });

  it("rejects discovery_lookup with a wrong-length target_pubkey (returns null, no fabrication)", () => {
    const bytes = ENC.encode({ type: "discovery_lookup", target_pubkey: new Uint8Array(31) });
    expect(decodeInboundSignalingFrame(bytes)).toBeNull();
  });

  it("rejects discovery_lookup missing target_pubkey", () => {
    const bytes = ENC.encode({ type: "discovery_lookup" });
    expect(decodeInboundSignalingFrame(bytes)).toBeNull();
  });

  it("encodes discovery_lookup_result (online) round-trippable, owning_node_ids preserved", () => {
    const bytes = encodeDiscoveryLookupResult({
      type: "discovery_lookup_result",
      target_pubkey: PUBKEY,
      state: "online",
      owning_node_ids: ["aws-eu-central-1"],
    });
    const o = cborDecode(bytes) as Record<string, unknown>;
    expect(o["type"]).toBe("discovery_lookup_result");
    expect(o["state"]).toBe("online");
    expect(o["owning_node_ids"]).toEqual(["aws-eu-central-1"]);
    expect(Buffer.from(o["target_pubkey"] as Uint8Array)).toEqual(Buffer.from(PUBKEY));
  });

  it("encodes discovery_lookup_result (offline) with an empty owning_node_ids list", () => {
    const bytes = encodeDiscoveryLookupResult({
      type: "discovery_lookup_result",
      target_pubkey: PUBKEY,
      state: "offline",
      owning_node_ids: [],
    });
    const o = cborDecode(bytes) as Record<string, unknown>;
    expect(o["state"]).toBe("offline");
    expect(o["owning_node_ids"]).toEqual([]);
  });

  it("encodes discovery_lookup_result (unknown_agent)", () => {
    const bytes = encodeDiscoveryLookupResult({
      type: "discovery_lookup_result",
      target_pubkey: PUBKEY,
      state: "unknown_agent",
      owning_node_ids: [],
    });
    const o = cborDecode(bytes) as Record<string, unknown>;
    expect(o["state"]).toBe("unknown_agent");
  });

  it("encodes discovery_lookup_error (never a fabricated offline/unknown)", () => {
    const bytes = encodeDiscoveryLookupError({ type: "discovery_lookup_error", reason: "lookup_failed" });
    const o = cborDecode(bytes) as Record<string, unknown>;
    expect(o["type"]).toBe("discovery_lookup_error");
    expect(o["reason"]).toBe("lookup_failed");
  });
});

describe("visiting-auth flag on signaling_auth_response (item 3)", () => {
  it("decodes visiting:true through the typed allowlist decoder", () => {
    const bytes = ENC.encode({ type: "signaling_auth_response", pubkey: PUBKEY, signature: SIG, visiting: true });
    const parsed = decodeInboundSignalingFrame(bytes);
    expect(parsed?.type).toBe("signaling_auth_response");
    expect((parsed as { visiting?: boolean }).visiting).toBe(true);
  });

  it("omits visiting when the field is absent (backward compatible — old clients)", () => {
    const bytes = ENC.encode({ type: "signaling_auth_response", pubkey: PUBKEY, signature: SIG });
    const parsed = decodeInboundSignalingFrame(bytes);
    expect(parsed?.type).toBe("signaling_auth_response");
    expect((parsed as { visiting?: boolean }).visiting).toBeUndefined();
  });

  it("treats visiting:false as not-visiting (undefined)", () => {
    const bytes = ENC.encode({ type: "signaling_auth_response", pubkey: PUBKEY, signature: SIG, visiting: false });
    const parsed = decodeInboundSignalingFrame(bytes);
    expect((parsed as { visiting?: boolean }).visiting).toBeUndefined();
  });
});
