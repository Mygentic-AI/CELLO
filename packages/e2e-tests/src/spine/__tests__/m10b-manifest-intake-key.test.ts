/**
 * M10B-D11 — the portal intake key rides the consortium manifest, and its signature coverage is
 * AUTOMATIC.
 *
 * That automatic coverage is the entire reason the manifest was chosen as the channel for a SEALING
 * key. The rejected alternative was serving it from `/bootstrap` or a new HTTP route — less code, and
 * the vulnerability itself: an unauthenticated distribution channel for a sealing key means a
 * substituted key seals every endorsement to the attacker.
 *
 * So the claim under test is not "the field exists" — it is "an officer signature actually covers it,
 * and manifests without it still verify". Asserted, because M10B-D11 states it as verified, and a
 * claim nobody re-checks is how a signed field quietly stops being signed.
 */
import { describe, it, expect } from "vitest";
import { makeSignedManifest, CONSORTIUM_ROOT_KEYS, CONSORTIUM_THRESHOLD, type ConsortiumNodeEntry } from "../auth-manifest.js";
import { verifyManifest } from "@cello-protocol/crypto";

const NODES: ConsortiumNodeEntry[] = [
  { nodeId: "n1", pubkey: "aa".repeat(32), region: "us-east-1", provider: "aws", endpoint: "http://localhost:1" },
];
const INTAKE = { key_id: "intake-2026-07", pubkey: "bb".repeat(32) };

describe("M10B-D11 — intake_key in the consortium manifest", () => {
  it("verifies with the key present — the officer signatures cover the new field", () => {
    const m = makeSignedManifest(NODES, { intakeKey: INTAKE });
    expect(m.intake_key).toEqual(INTAKE);
    expect(verifyManifest(m as never, CONSORTIUM_ROOT_KEYS, CONSORTIUM_THRESHOLD).ok).toBe(true);
  });

  it("a TAMPERED intake key breaks verification — the coverage is real, not nominal", () => {
    // The revert test for the whole decision. If the canonical body did NOT include the new field, an
    // attacker could swap the sealing key and the officer signatures would still verify — which is
    // exactly the vulnerability the manifest channel was chosen to avoid.
    const m = makeSignedManifest(NODES, { intakeKey: INTAKE });
    const tampered = { ...m, intake_key: { key_id: INTAKE.key_id, pubkey: "cc".repeat(32) } };
    expect(verifyManifest(tampered as never, CONSORTIUM_ROOT_KEYS, CONSORTIUM_THRESHOLD).ok).toBe(false);
  });

  it("a manifest WITHOUT the key still verifies — the field is additive, not a format break", () => {
    // Every manifest in the world today lacks it. If adding the field changed the signed body of
    // manifests that omit it, this change would invalidate all of them at once.
    const m = makeSignedManifest(NODES);
    expect(m.intake_key).toBeUndefined();
    // Not an explicit `undefined`: that would appear in Object.keys and change the signed body.
    expect("intake_key" in m).toBe(false);
    expect(verifyManifest(m as never, CONSORTIUM_ROOT_KEYS, CONSORTIUM_THRESHOLD).ok).toBe(true);
  });
});
