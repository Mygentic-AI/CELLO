/**
 * Tests for the idempotent bind-to-AGENT single-use semantics (M8B-PREAUTH-CAP), against DevNonceBinder.
 * PgNonceBinder shares the exact same contract (verified live via the directory integration path).
 *
 * Binding is keyed on the agent K_local pubkey — NOT the client-supplied epoch — because the epoch is
 * attacker-controlled on the wire. The "reject a second, different agent" test below is the exact
 * single-use bypass a code review caught (one capability must never register two agents).
 */
import { describe, it, expect } from "vitest";
import { DevNonceBinder } from "../stubs/dev-nonce-binder.js";

const AGENT_A = "a".repeat(64); // K_local pubkey hex
const AGENT_B = "b".repeat(64);

describe("NonceBinder — bind-to-agent single-use", () => {
  it("binds an unseen nonce to an agent", async () => {
    const b = new DevNonceBinder();
    expect(await b.bind("nonceA", AGENT_A)).toEqual({ bound: true });
  });

  it("is idempotent when the SAME nonce is re-presented for the SAME agent (the other N-1 nodes / retries)", async () => {
    const b = new DevNonceBinder();
    await b.bind("nonceA", AGENT_A);
    expect(await b.bind("nonceA", AGENT_A)).toEqual({ bound: true });
    expect(await b.bind("nonceA", AGENT_A)).toEqual({ bound: true });
  });

  it("rejects re-use of a nonce for a DIFFERENT agent (the single-use bypass — one capability, two agents)", async () => {
    const b = new DevNonceBinder();
    await b.bind("nonceA", AGENT_A);
    expect(await b.bind("nonceA", AGENT_B)).toEqual({
      bound: false,
      reason: "NONCE_ALREADY_BOUND",
    });
  });

  it("keeps distinct nonces independent", async () => {
    const b = new DevNonceBinder();
    expect(await b.bind("nonceA", AGENT_A)).toEqual({ bound: true });
    expect(await b.bind("nonceB", AGENT_B)).toEqual({ bound: true });
  });
});
