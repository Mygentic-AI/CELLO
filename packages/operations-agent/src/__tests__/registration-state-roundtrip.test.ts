import { describe, expect, it } from "vitest";
import { rowToRecord } from "../registration/repository.js";
import type { RegistrationState } from "@cello-protocol/interfaces";

/**
 * EVERY state in the union must survive a round trip through the row mapper.
 *
 * This file exists because AWAITING_WAITLIST_TOKEN shipped without a case in
 * `deserializeState`, and the `default:` branch turns an unknown state into
 * `{state: "FAILED"}`. The consequence was total: a gated user's record came
 * back as FAILED, the engine dropped it as terminal, and the handler that
 * redeems waitlist tokens was DEAD CODE in production — a user was told "send
 * your token" and then ignored forever, unable even to start over, because the
 * row still held their slot until the seven-day sweep.
 *
 * Thirteen tests passed while that was true. All of them faked the repository,
 * so not one round-tripped a row. A fake that cannot reproduce the failure is
 * not covering the thing it appears to cover — the same lesson as FakeSES
 * accepting a parameter the real API rejects.
 *
 * So: enumerate the union, and fail when a state has no mapping. Adding a state
 * without a mapper case now fails here rather than in production.
 */

const ALL_STATES: RegistrationState["state"][] = [
  "INITIAL",
  "AWAITING_WAITLIST_TOKEN",
  "AWAITING_CONTACT",
  "PHONE_CONFIRMED",
  "AWAITING_EMAIL",
  "AWAITING_EMAIL_OTP",
  "EMAIL_CONFIRMED",
  "PRE_AUTH_TOKEN_ISSUED",
  "EXPIRED",
  "FAILED",
];

function row(state: string) {
  return {
    id: "reg-1",
    phone_stub_hash: "h",
    channel: "telegram",
    channel_user_id: "tg-1",
    state,
    state_data: {},
    email_domain: null,
    otp_hash: null,
    otp_salt: null,
    otp_expires_at: null,
    otp_attempt_count: 0,
    created_at: new Date(),
    updated_at: new Date(),
    expires_at: new Date(Date.now() + 1000),
    chain_hash: "c",
  } as never;
}

describe("every declared state survives the row mapper", () => {
  it.each(ALL_STATES)("%s round-trips to itself", (state) => {
    const record = rowToRecord(row(state));

    expect(record.state).toBe(state);
  });

  it("a genuinely unknown state still degrades to FAILED", () => {
    // The default branch is correct FOR A LEGACY ROW. What it must not do is
    // absorb a state somebody just added — which is what the enumeration above
    // now prevents.
    const record = rowToRecord(row("SOME_STATE_FROM_2019"));

    expect(record.state).toBe("FAILED");
  });
});
