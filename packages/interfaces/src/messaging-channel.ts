/**
 * MessagingChannel — interface for inbound/outbound messaging adapters.
 *
 * Phase A — Architecture note:
 *   The registration state machine engine imports only this interface.
 *   It does not know whether it is talking to Telegram, WhatsApp, CLI, or
 *   a future channel. The engine is fully decoupled from channel specifics.
 *
 *   Local stub: CliAdapter (reads from stdin, writes to stdout, CELLO_ENV=local)
 *   Production implementations: TelegramAdapter (M6), WhatsApp deferred post-M6
 */

/**
 * ChannelIdentity — identifies the origin of an inbound message.
 * The `channel` field is the discriminant.
 *
 * phoneNumber is optional because CLI channels have no phone number.
 * channelUserId is always present — it is the channel-native identifier
 * used to route replies back to the sender.
 */
export type ChannelIdentity =
  | { channel: "telegram"; channelUserId: string; phoneNumber?: string }
  | { channel: "whatsapp"; channelUserId: string; phoneNumber?: string }
  | { channel: "cli"; channelUserId: string; phoneNumber?: string };

/**
 * MessagingChannel — single interface, multiple channel implementations.
 *
 * The registration state machine engine and all business logic import
 * MessagingChannel only. The engine does not know which channel it is using.
 */
export interface MessagingChannel {
  /** Send a text message to the user identified by the channel-native `to` address. */
  send(to: string, message: string): Promise<void>;

  /**
   * Register a handler for inbound messages.
   * Called once at startup. `from` is the channel-native sender identifier.
   */
  onMessage(handler: (from: string, message: string) => void): void;

  /**
   * Resolve the full channel identity for a given channel-native sender address.
   * Used to extract phone number and channel type after an inbound message arrives.
   */
  resolveIdentity(from: string): Promise<ChannelIdentity>;
}
