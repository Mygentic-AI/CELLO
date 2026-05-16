/**
 * Logger — structured logging interface for M4+ services (PERSIST-001).
 *
 * Events use the domain.noun.verb taxonomy (e.g. "session.started").
 * Every async flow mints one correlationId and threads it through all events.
 * No console.log in implementation code — all logging goes through this interface.
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
  error(event: string, context?: LogContext): void;
}
