/**
 * Tests for the idempotent bind-to-epoch single-use semantics (M8B-PREAUTH-CAP), against DevNonceBinder.
 * PgNonceBinder shares the exact same contract (verified live via the directory integration path).
 */
import { describe, it, expect } from "vitest";
import { DevNonceBinder } from "../stubs/dev-nonce-binder.js";

describe("NonceBinder — bind-to-epoch single-use", () => {
  it("binds an unseen nonce", async () => {
    const b = new DevNonceBinder();
    expect(await b.bind("nonceA", "agent1:epoch:1")).toEqual({ bound: true });
  });

  it("is idempotent when the SAME nonce is re-presented for the SAME epoch (the other N-1 nodes / retries)", async () => {
    const b = new DevNonceBinder();
    await b.bind("nonceA", "agent1:epoch:1");
    expect(await b.bind("nonceA", "agent1:epoch:1")).toEqual({ bound: true });
    expect(await b.bind("nonceA", "agent1:epoch:1")).toEqual({ bound: true });
  });

  it("rejects re-use of a nonce for a DIFFERENT epoch (replay into a second agent)", async () => {
    const b = new DevNonceBinder();
    await b.bind("nonceA", "agent1:epoch:1");
    expect(await b.bind("nonceA", "agent2:epoch:1")).toEqual({
      bound: false,
      reason: "NONCE_ALREADY_BOUND",
    });
  });

  it("keeps distinct nonces independent", async () => {
    const b = new DevNonceBinder();
    expect(await b.bind("nonceA", "agent1:epoch:1")).toEqual({ bound: true });
    expect(await b.bind("nonceB", "agent2:epoch:1")).toEqual({ bound: true });
  });
});
