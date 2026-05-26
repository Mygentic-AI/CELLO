/**
 * ConsoleSecurityAlertProvider — SecurityAlertProvider stub for CELLO_ENV=local.
 *
 * Logs security alerts to stdout instead of routing them to the operator's
 * messaging channel. Used in local development so security alert flows can be
 * tested without a live Telegram or messaging channel.
 *
 * Zero external dependencies. No network calls. No configuration required.
 *
 * Phase P — Pseudocode:
 *   sendAlert(accountId, alert):
 *     process.stdout.write("[CELLO ALERT] accountId=" + accountId + " " + JSON.stringify(alert) + "\n")
 */

import type { SecurityAlertProvider, SecurityAlert } from "../security-alert-provider.js";

/**
 * ConsoleSecurityAlertProvider — implements SecurityAlertProvider for local development.
 * Prints security alerts to stdout. Use in CELLO_ENV=local only.
 */
export class ConsoleSecurityAlertProvider implements SecurityAlertProvider {
  /**
   * Print a security alert to stdout.
   * In local development, the developer reads the alert from console output.
   */
  async sendAlert(accountId: string, alert: SecurityAlert): Promise<void> {
    process.stdout.write(
      `[CELLO ALERT] accountId=${accountId} ${JSON.stringify(alert)}\n`,
    );
  }
}
