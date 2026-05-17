import type { Logger, LogContext } from "../logger.js";

/** Writes one structured JSON line per call to stdout. Injected at composition root. */
export class StdoutLogger implements Logger {
  #write(level: string, event: string, context?: LogContext): void {
    const line = JSON.stringify({ event, level, timestamp: new Date().toISOString(), ...context });
    process.stdout.write(line + "\n");
  }

  debug(event: string, context?: LogContext): void { this.#write("debug", event, context); }
  info(event: string, context?: LogContext): void  { this.#write("info",  event, context); }
  warn(event: string, context?: LogContext): void  { this.#write("warn",  event, context); }

  error(event: string, errorOrContext?: Error | LogContext, context?: LogContext): void {
    // Supports both overload forms:
    //   error(event, error, context?) — preferred: Error is first-class
    //   error(event, context?)        — legacy: no Error object
    if (errorOrContext instanceof Error) {
      const ctx: LogContext = {
        error: errorOrContext.message,
        stack: errorOrContext.stack,
        ...context,
      };
      this.#write("error", event, ctx);
    } else {
      this.#write("error", event, errorOrContext);
    }
  }
}
