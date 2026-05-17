/**
 * Logger — structured logging interface for M4+ services (PERSIST-001).
 *
 * Events use the domain.noun.verb taxonomy (e.g. "session.started").
 * Every async flow mints one correlationId and threads it through all events.
 * No console.log in implementation code — all logging goes through this interface.
 *
 * Canonical spec (pipeline discussion log 2026-05-16_0753):
 *   info(event, context)
 *   warn(event, context)
 *   error(event, error, context)  — preferred form: Error object is first-class, enables stack extraction
 *   error(event, context)         — legacy form: backward-compatible for callers without an Error object
 *
 * The two error() call forms are unified in a single interface method via union typing.
 * Implementations must handle both: when the second argument is an Error instance, extract
 * message and stack into the context; when it is a LogContext, treat it as context directly.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogContext {
  [key: string]: unknown;
}

/** Structured logger injected at the composition root. Never imported directly from a module. */
export interface Logger {
  debug(event: string, context?: LogContext): void;
  info(event: string, context?: LogContext): void;
  warn(event: string, context?: LogContext): void;
  /**
   * Log an error-level event.
   *
   * Preferred form (canonical spec): error(event, error, context?)
   *   Pass the Error object as the second argument so implementations can extract
   *   message and stack trace for structured logging.
   *
   * Legacy form (backward-compatible): error(event, context?)
   *   For call sites that do not have an Error object.
   *
   * Implementations must handle both forms via the union second parameter.
   */
  error(event: string, errorOrContext?: Error | LogContext, context?: LogContext): void;
}
