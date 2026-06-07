/**
 * SecurityAlertProvider — interface for delivering security alerts to operators.
 *
 * Phase A — Architecture note:
 *   Security alerts are sent to the operator's active messaging channel
 *   (e.g., the same Telegram chat where they registered). The interface
 *   is designed for extension — downstream stories add new SecurityAlert variants.
 *
 *   Local stub: ConsoleSecurityAlertProvider (logs alert to stdout, CELLO_ENV=local)
 *   Production implementation: ChannelSecurityAlertProvider (routes to operator's
 *                              active channel — implemented in post-M6 lifecycle stories)
 */

/**
 * SecurityAlert — a discriminated union of security event types.
 * The `type` field is the discriminant.
 *
 * FALLBACK_CANARY: fired when a canary-trap event triggers (prompt injection detection).
 * REGISTRATION_COMPLETE: fired when a new agent is registered (audit trail for the operator).
 *
 * Downstream stories add variants here. The switch in consumers should include a
 * default branch to handle unknown future variants gracefully.
 */
export type SecurityAlert =
  | { type: "FALLBACK_CANARY"; triggeredAt: Date }
  | {
      type: "REGISTRATION_COMPLETE";
      phoneStubHash: string;
      emailStubHash: string;
      completedAt: Date;
    };

/**
 * SecurityAlertProvider — delivers security alerts to the operator's
 * out-of-band notification channel.
 */
export interface SecurityAlertProvider {
  /**
   * Send a security alert to the operator identified by accountId.
   * The provider resolves the appropriate delivery channel for the account.
   * Throws if delivery fails — the caller decides whether to retry.
   */
  sendAlert(accountId: string, alert: SecurityAlert): Promise<void>;
}
