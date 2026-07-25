/**
 * WaitlistGateClient — the admission gate between a Telegram account and a CELLO
 * registration (DOD-TELEGRAM-GATE-1).
 *
 * WHY THIS IS AN INTERFACE AND NOT A DIRECT CALL. The gate's rules live in a
 * Lambda that owns the waitlist database (`cello-waitlist-gate-{env}`), and the
 * operations agent must not reach that database itself — the ops-agent runs in
 * the directory's VPC and has no business holding waitlist credentials. So the
 * agent asks a question and receives an answer; it never evaluates the rule.
 *
 * The consequence worth stating: **a gate that cannot be reached must REFUSE,
 * never admit.** An unreachable gate is indistinguishable from a gate that would
 * have said no, and the whole point of M11's two-door design is that nobody
 * joins the network without passing one of the two doors. Implementations
 * therefore throw on transport failure rather than returning a permissive
 * default, and the caller is expected to fail closed.
 *
 * Local stub: LocalWaitlistGateClient (admits everybody, loudly — it exists so a
 * developer without AWS can still run the registration flow, and it says so on
 * every call).
 * Production implementation: LambdaWaitlistGateClient.
 */

/**
 * The answer to "may this Telegram account register?".
 *
 * `allowed: false` carries a machine-readable `error` AND the operator-facing
 * `message` the Lambda composed. The message is passed through verbatim rather
 * than re-worded here: the gate goes to real trouble to name each refusal
 * ("that token has already been used", "that token expired"), and rewriting it
 * at this layer would flatten four distinct causes into one.
 */
export type WaitlistGateDecision =
  | { allowed: true; alreadyLinked: boolean }
  | { allowed: false; error: string; message: string };

/**
 * The result of redeeming a waitlist token for a Telegram account.
 *
 * On success the gate has ALREADY burned the token, linked the account, and
 * written the agent bridge — it is not a validation call the caller then acts
 * on. That is deliberate: splitting "check" from "burn" across a network
 * boundary is what lets the same token be redeemed twice.
 */
export type WaitlistTokenRedemption =
  | { redeemed: true }
  | { redeemed: false; error: string; message: string };

export interface WaitlistGateClient {
  /**
   * Is this Telegram account already admitted?
   *
   * Called on a user's FIRST message, before any registration record exists.
   * Returns `allowed: true` for an account already in `telegram_accounts` (by
   * a burned token, or a staff override), and `allowed: false` with
   * `error: "token_required"` for one that is not.
   *
   * MUST throw rather than return a decision if the gate cannot be reached.
   */
  check(telegramId: string): Promise<WaitlistGateDecision>;

  /**
   * Redeem a waitlist token, admitting this Telegram account.
   *
   * Atomic in the Lambda: the token is burned, the account linked, and the
   * agent bridge written in one transaction, so two simultaneous redemptions of
   * one token produce exactly one winner.
   *
   * MUST throw rather than return a redemption if the gate cannot be reached.
   */
  redeem(telegramId: string, token: string): Promise<WaitlistTokenRedemption>;
}
