/**
 * 017-TBS — what the directory SIGNS must be reconstructible from what it SENDS.
 *
 * ─── Why this file exists, and why it is not another builder-vs-builder test ───────────────────
 *
 * Every other test in this unit stops at the builder: it hands the same arguments to two functions
 * and checks they agree. That can never catch the failure this file is about, because the failure
 * is not in the builder at all — it is in the gap between the bytes that were signed and the bytes
 * that go on the wire.
 *
 * The production path is: build the TBS → FROST-sign it → ENCODE the assignment frame → the client
 * decodes it → the client REBUILDS the TBS from the decoded fields → verify. `encodeSessionAssignment`
 * sits in the middle of that chain and constructs its output as an explicit field-by-field literal.
 * A field the directory signs but the encoder does not copy is simply gone: the client rebuilds a
 * shorter layout, the signature does not verify, and the session is refused. Nothing reports an
 * encoder — the operator is told the assignment failed to verify, which points at the directory's
 * key or at their counterparty's identity, not at a missing key in a CBOR object.
 *
 * That is exactly what happened here: `high_stakes` and `prior_relay_id` were added to the TBS and
 * to the assignment object, and the encoder — a different file, untouched by that change — dropped
 * both. Found by review, not by any test, because no test crossed the encode boundary.
 *
 * ─── What this asserts ────────────────────────────────────────────────────────────────────────
 *
 * The round trip, with the client's own rules applied on the way back: encode → CBOR-decode →
 * rebuild the TBS the way `assignment-verify.ts` does → compare against the bytes that were signed.
 * If they differ, the session would be refused in production.
 */

import { setupV3Tests, describe, it, expect } from "@claude-flow/testing";
import { randomBytes } from "node:crypto";
import { decode } from "cbor-x";
import { buildSessionEstablishmentTbs } from "@cello-protocol/protocol-types";
import { encodeSessionAssignment } from "../directory-frames.js";
import { buildAssignmentTbs } from "../directory-node.js";

setupV3Tests();

const SESSION_ID = new Uint8Array(randomBytes(16));
const PUB_A = new Uint8Array(randomBytes(32));
const PUB_B = new Uint8Array(randomBytes(32));
const GENESIS = new Uint8Array(randomBytes(32));
const TS = 1_700_000_000_000;

const INIT_PEER = "12D3KooWInitiator";
const INIT_ADDRS = ["/ip4/10.0.0.1/tcp/4001"];
const CP_PEER = "12D3KooWCounterparty";
const CP_ADDRS = ["/ip4/10.0.0.2/tcp/4001"];

/** The assignment the directory hands to the encoder, carrying the two 017 fields. */
function assignmentWith(highStakes: boolean, priorRelayId: string): Record<string, unknown> {
  return {
    session_id: SESSION_ID,
    participant_a: { pubkey: PUB_A, peer_id: "12D3KooWA", multiaddrs: [] },
    participant_b: { pubkey: PUB_B, peer_id: "12D3KooWB", multiaddrs: [] },
    relay_endpoint: { peer_id: "12D3KooWRelay", multiaddrs: ["/ip4/127.0.0.1/tcp/1"] },
    directory_endpoint: { peer_id: "12D3KooWDir", multiaddrs: ["/ip4/127.0.0.1/tcp/2"] },
    session_timestamp: TS,
    directory_pubkey: new Uint8Array(32).fill(0xdd),
    directory_signature: new Uint8Array(64).fill(0xee),
    signature_type: "frost",
    signer_pubkey: new Uint8Array(32).fill(0xcc),
    initiator_session_peer_id: INIT_PEER,
    initiator_session_addrs: INIT_ADDRS,
    counterparty_session_peer_id: CP_PEER,
    counterparty_session_addrs: CP_ADDRS,
    transport_mode: "relay",
    high_stakes: highStakes,
    prior_relay_id: priorRelayId,
  };
}

/**
 * Rebuild the TBS the way the CLIENT does, from decoded wire fields only.
 *
 * The two reads below are the client's, copied deliberately rather than referenced: an empty peer
 * id means "endpoint unknown" and becomes `undefined`, while `high_stakes: false` and
 * `prior_relay_id: ""` are ANSWERS and are read by TYPE. Getting either wrong picks a different
 * layout, which is the whole failure mode.
 */
function rebuildTbsAsClientWould(wire: Record<string, unknown>): Uint8Array {
  const str = (v: unknown) => (typeof v === "string" && v !== "" ? v : undefined);
  const arr = (v: unknown) => (Array.isArray(v) ? (v as string[]) : undefined);
  const mode = wire["transport_mode"];
  return buildSessionEstablishmentTbs(
    SESSION_ID,
    PUB_A,
    PUB_B,
    GENESIS,
    TS,
    str(wire["initiator_session_peer_id"]),
    arr(wire["initiator_session_addrs"]),
    str(wire["counterparty_session_peer_id"]),
    arr(wire["counterparty_session_addrs"]),
    mode === "direct" || mode === "relay" ? mode : undefined,
    typeof wire["high_stakes"] === "boolean" ? wire["high_stakes"] : undefined,
    typeof wire["prior_relay_id"] === "string" ? wire["prior_relay_id"] : undefined,
  );
}

function wireFieldsOf(assignment: Record<string, unknown>): Record<string, unknown> {
  const bytes = encodeSessionAssignment({ type: "session_assignment", assignment } as never);
  const frame = decode(bytes) as { assignment: Record<string, unknown> };
  return frame.assignment;
}

describe("017-TBS: the signed bytes survive the wire", () => {
  for (const [label, highStakes, priorRelayId] of [
    ["fresh, standard tier (the common case)", false, ""],
    ["fresh, high stakes", true, ""],
    ["resume, standard tier", false, "a".repeat(64)],
    ["resume, high stakes", true, "b".repeat(64)],
  ] as Array<[string, boolean, string]>) {
    it(`${label}: the client rebuilds exactly what the directory signed`, () => {
      const signed = buildAssignmentTbs(
        SESSION_ID, PUB_A, PUB_B, GENESIS, TS,
        INIT_PEER, INIT_ADDRS, CP_PEER, CP_ADDRS, "relay",
        highStakes, priorRelayId,
      );
      const rebuilt = rebuildTbsAsClientWould(wireFieldsOf(assignmentWith(highStakes, priorRelayId)));

      // Not "both are 12 fields" — the actual bytes. A signature is over bytes.
      expect(Buffer.from(rebuilt).equals(Buffer.from(signed))).toBe(true);
    });
  }

  it("both fields are ON THE WIRE as values — false and \"\" included", () => {
    // Named separately from the round trip because the round trip could in principle be satisfied
    // by both sides being wrong in the same direction. This one says the bytes are actually there.
    const wire = wireFieldsOf(assignmentWith(false, ""));
    expect(wire["high_stakes"]).toBe(false);
    expect(wire["prior_relay_id"]).toBe("");
  });

  /**
   * ONE EMPTY FIELD AT A TIME, one case per clause of the encoder's `onLongLayout`.
   *
   * The first version of this test emptied BOTH counterparty fields at once, which left all four
   * clauses individually mutation-proof: delete any one of them and the other three still gated the
   * single case. That is the identical defect the drift guard was pulled up for one commit earlier,
   * reproduced in the file written to fix it — so it is worth naming rather than quietly widening.
   *
   * What is being protected: on the short layout these two fields are NOT in the TBS. Shipping them
   * anyway puts values on the wire that no signature covers, and a MITM could flip `high_stakes`
   * with nothing able to detect it. Same reason `transport_mode` is gated.
   */
  it.each([
    ["initiator peer id unknown",    { initiator_session_peer_id: "" }],
    ["initiator addrs unknown",      { initiator_session_addrs: [] }],
    ["counterparty peer id unknown", { counterparty_session_peer_id: "" }],
    ["counterparty addrs unknown",   { counterparty_session_addrs: [] }],
  ] as Array<[string, Record<string, unknown>]>)(
    "does NOT put the two fields on the wire when they are NOT signed — %s",
    (_label, override) => {
      const wire = wireFieldsOf({ ...assignmentWith(true, "a".repeat(64)), ...override });
      expect(wire["high_stakes"], "unsigned on the short layout — must not ship").toBeUndefined();
      expect(wire["prior_relay_id"], "unsigned on the short layout — must not ship").toBeUndefined();
    },
  );

  it("a real prior relay id reaches the wire unchanged", () => {
    const priorRelayId = "a".repeat(64);
    expect(wireFieldsOf(assignmentWith(true, priorRelayId))["prior_relay_id"]).toBe(priorRelayId);
    expect(wireFieldsOf(assignmentWith(true, priorRelayId))["high_stakes"]).toBe(true);
  });
});
