import type {
  WaitlistGateClient,
  WaitlistGateDecision,
  WaitlistTokenRedemption,
} from "../waitlist-gate-client.js";

/**
 * LocalWaitlistGateClient — admits everybody, and says so on every call.
 *
 * It exists so a developer without AWS credentials can still walk the
 * registration flow end to end. That makes it the most dangerous stub in the
 * repo, because it is the one whose silent use would let anybody onto the
 * network: the production gate's entire job is to refuse.
 *
 * Two things guard against that, and both are deliberate rather than
 * decorative:
 *
 *   1. It WARNS on every single call, not once at construction. A one-time
 *      warning scrolls out of a log; a per-call one is impossible to miss in
 *      the record of a session that admitted somebody.
 *   2. `server.ts` selects it only under `CELLO_ENV=local`, and that selection
 *      is the composition root's job — this class does not read the
 *      environment, so it cannot decide to be safe on its own.
 */
export class LocalWaitlistGateClient implements WaitlistGateClient {
  readonly #warn: (message: string, context?: Record<string, unknown>) => void;

  constructor(warn?: (message: string, context?: Record<string, unknown>) => void) {
    this.#warn =
      warn ??
      ((message, context) => {
        // eslint-disable-next-line no-console -- stub of last resort; the real
        // logger is injected by the composition root when one exists.
        console.warn(message, context ?? {});
      });
  }

  async check(telegramId: string): Promise<WaitlistGateDecision> {
    this.#warn("waitlist.gate.STUB_ADMITS_EVERYONE", {
      telegramId,
      detail:
        "LocalWaitlistGateClient is in use — the waitlist gate is NOT being enforced. " +
        "This must never appear outside CELLO_ENV=local.",
    });
    return { allowed: true, alreadyLinked: true };
  }

  async redeem(telegramId: string, token: string): Promise<WaitlistTokenRedemption> {
    this.#warn("waitlist.gate.STUB_ADMITS_EVERYONE", {
      telegramId,
      tokenLength: token.length,
      detail:
        "LocalWaitlistGateClient is in use — no token was burned and no account was linked.",
    });
    return { redeemed: true };
  }
}
