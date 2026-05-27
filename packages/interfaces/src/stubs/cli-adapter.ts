/**
 * CliAdapter — MessagingChannel stub for CELLO_ENV=local.
 *
 * Reads inbound messages from stdin (line by line) and writes outbound messages
 * to stdout. Used in local development and testing so the registration state
 * machine can be exercised without a Telegram or WhatsApp connection.
 *
 * Zero external dependencies. No network calls. No configuration required.
 *
 * Phase P — Pseudocode:
 *   send(to, message):
 *     process.stdout.write("[CELLO CLI] to=" + to + " message=" + message + "\n")
 *
 *   onMessage(handler):
 *     store handler reference; attach readline interface to stdin if not yet done;
 *     on 'line' event: call handler("cli-stdin", line.trim())
 *
 *   resolveIdentity(from):
 *     return { channel: 'cli', channelUserId: from }
 */

import type { MessagingChannel, ChannelIdentity } from "../messaging-channel.js";

/** Sentinel prefix for contact-prompt messages — strip before sending to any channel. */
const CONTACT_PROMPT_PREFIX = "__REQUEST_CONTACT__:";

/**
 * CliAdapter — implements MessagingChannel for local development.
 * send() writes to stdout; onMessage() registers a stdin line reader.
 * resolveIdentity() returns a fixed cli ChannelIdentity.
 */
export class CliAdapter implements MessagingChannel {
  #messageHandler: ((from: string, message: string) => void | Promise<void>) | undefined = undefined;
  #readlineStarted = false;

  /** Write a message to stdout in a structured format. Strips contact-prompt sentinel prefix. */
  async send(to: string, message: string): Promise<void> {
    const text = message.startsWith(CONTACT_PROMPT_PREFIX)
      ? message.slice(CONTACT_PROMPT_PREFIX.length)
      : message;
    process.stdout.write(`[CELLO CLI] to=${to} message=${text}\n`);
  }

  /**
   * Register the inbound message handler.
   * Attaches a readline interface to stdin on first call.
   * Each line received from stdin is dispatched as a message from "cli-stdin".
   */
  onMessage(handler: (from: string, message: string) => void | Promise<void>): void {
    this.#messageHandler = handler;
    if (!this.#readlineStarted) {
      this.#readlineStarted = true;
      // Only set up readline if stdin is a TTY or pipe — avoid hanging in test environments
      if (process.stdin.readable && !process.stdin.destroyed) {
        process.stdin.setEncoding("utf8");
        process.stdin.on("data", (chunk: string) => {
          const lines = chunk.split("\n");
          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.length > 0 && this.#messageHandler) {
              this.#messageHandler("cli-stdin", trimmed);
            }
          }
        });
      }
    }
  }

  /**
   * Resolve channel identity for a CLI sender.
   * Always returns channel: 'cli' with the original `from` string as channelUserId.
   * CLI channels have no phone number.
   */
  async resolveIdentity(from: string): Promise<ChannelIdentity> {
    return { channel: "cli", channelUserId: from };
  }
}
