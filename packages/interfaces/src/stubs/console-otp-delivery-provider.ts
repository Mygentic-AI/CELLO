/**
 * ConsoleOtpDeliveryProvider — OtpDeliveryProvider stub for CELLO_ENV=local.
 *
 * Prints the OTP to stdout instead of sending an email.
 * Used in local development so the registration flow can be exercised without
 * an AWS SES account or email service.
 *
 * Zero external dependencies. No network calls. No configuration required.
 *
 * Phase P — Pseudocode:
 *   sendOtp(emailAddress, otp):
 *     process.stdout.write("[CELLO OTP] email=" + emailAddress + " otp=" + otp + "\n")
 */

import type { OtpDeliveryProvider } from "../otp-delivery-provider.js";

/**
 * ConsoleOtpDeliveryProvider — implements OtpDeliveryProvider for local development.
 * Prints the OTP to stdout. Use in CELLO_ENV=local only.
 */
export class ConsoleOtpDeliveryProvider implements OtpDeliveryProvider {
  /**
   * Print the OTP to stdout.
   * In local development, the developer reads the OTP from the console output.
   */
  async sendOtp(emailAddress: string, otp: string): Promise<void> {
    process.stdout.write(`[CELLO OTP] email=${emailAddress} otp=${otp}\n`);
  }
}
