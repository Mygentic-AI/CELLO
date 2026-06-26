/**
 * CELLO-M7-REMOVE-001 — agent-revocation TBS drift guard.
 *
 * The directory verifies revocations with a LOCAL copy of buildAgentRevocationTbs because the published
 * @cello-protocol/protocol-types does not yet export it (M7-WIRE-001 convention). This test pins the
 * directory builder's canonical CBOR layout against an explicit reference array, so any change to field
 * order/encoding fails here. Field order is load-bearing: a silent change would break verification of
 * every revocation (the daemon signs with the protocol-types copy; the directory verifies with this one).
 *
 * This is a self-consistency pin, NOT a true cross-repo guard: the real cross-boundary check is the live
 * j-remove spine (the daemon signs, the directory verifies, AC-002 re-verifies the stored signature). Once
 * protocol-types publishes buildAgentRevocationTbs, import it directly here, compare against it, and delete
 * this reference array (per the comment in directory-node.ts).
 */

import { setupV3Tests, describe, it, expect } from "@claude-flow/testing";
import { Encoder } from "cbor-x";
import { buildAgentRevocationTbs, AGENT_REVOCATION_DOMAIN } from "../directory-node.js";

setupV3Tests();

const CBOR_ENC = new Encoder({ tagUint8Array: false });

describe("CELLO-M7-REMOVE-001: agent-revocation TBS drift guard", () => {
  const agentId = "a1b2c3d4e5f600112233445566778899";
  const kLocalPubkeyHex = "11".repeat(32);
  const epochId = "";
  const reason = "voluntary";

  it("matches the pinned canonical CBOR layout for a large (BigInt) timestamp", () => {
    const revokedAt = 1_700_000_000_000; // > 0xffffffff → BigInt encoding
    const local = buildAgentRevocationTbs(agentId, kLocalPubkeyHex, epochId, reason, revokedAt);
    const expected = CBOR_ENC.encode([
      AGENT_REVOCATION_DOMAIN,
      agentId,
      kLocalPubkeyHex,
      epochId,
      reason,
      BigInt(revokedAt),
    ]) as Uint8Array;
    expect(Buffer.from(local).equals(Buffer.from(expected))).toBe(true);
  });

  it("matches the pinned canonical CBOR layout for a small (uint32) timestamp", () => {
    const revokedAt = 1_000; // <= 0xffffffff → plain number encoding
    const local = buildAgentRevocationTbs(agentId, kLocalPubkeyHex, epochId, reason, revokedAt);
    const expected = CBOR_ENC.encode([
      AGENT_REVOCATION_DOMAIN,
      agentId,
      kLocalPubkeyHex,
      epochId,
      reason,
      revokedAt,
    ]) as Uint8Array;
    expect(Buffer.from(local).equals(Buffer.from(expected))).toBe(true);
  });

  it("the domain tag is bound as the first field (no cross-protocol replay)", () => {
    expect(AGENT_REVOCATION_DOMAIN).toBe("CELLO-REVOKE-v1");
    const tbs = buildAgentRevocationTbs(agentId, kLocalPubkeyHex, "", "", 1);
    // A different domain must produce different bytes.
    const other = CBOR_ENC.encode(["CELLO-OTHER-v1", agentId, kLocalPubkeyHex, "", "", 1]) as Uint8Array;
    expect(Buffer.from(tbs).equals(Buffer.from(other))).toBe(false);
  });
});
