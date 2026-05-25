/**
 * OtpDeliveryProvider — interface for sending OTP codes to email addresses.
 *
 * Phase A — Architecture note:
 *   The registration state machine calls this interface to deliver OTPs.
 *   The concrete transport (SES, SMTP, console print) is hidden behind this boundary.
 *
 *   Local stub: ConsoleOtpDeliveryProvider (prints OTP to stdout, CELLO_ENV=local)
 *   Production implementation: SesOtpDeliveryProvider (AWS SES, M6 OPS-AGENT-004)
 */
export interface OtpDeliveryProvider {
  /**
   * Deliver a one-time password to the specified email address.
   * The caller has already formatted the OTP; this method only transports it.
   * Throws if delivery fails — the caller is responsible for retry/rate-limit logic.
   */
  sendOtp(emailAddress: string, otp: string): Promise<void>;
}
