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
  error(event: string, context?: LogContext): void { this.#write("error", event, context); }
}
