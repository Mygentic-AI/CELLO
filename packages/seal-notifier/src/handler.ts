/**
 * What the notifier DOES with a Pub/Sub push, separated from the HTTP plumbing that carries it.
 *
 * EXTRACTED SO IT CAN BE TESTED. Every decision that matters lives here — which payload shape this
 * is, which formatter renders it, whether it outranks the global cap, and above all WHICH HTTP
 * STATUS comes back, because that status is what decides whether Pub/Sub retries or drops. When
 * this logic sat inside the `createServer` callback the only way to reach it was to bind a socket,
 * so nothing tested it: a review found that the whole routing path could be reverted with every
 * test still green.
 *
 * ── THE ACK CONTRACT, WHICH IS THE ONLY SUBTLE PART ──────────────────────────────────────────────
 * Pub/Sub retries anything that is not 2xx, forever, with backoff. So the status code decides
 * whether a failure is retried or dropped, and getting it backwards is how you either lose alerts
 * silently or hammer Telegram in a loop:
 *
 *   204 on a message we CANNOT ever process (undecodable, or not one of our two shapes) — retrying
 *        a malformed message just replays the same failure until the topic's retention expires.
 *   204 on a message we deliberately SUPPRESSED — it was handled; throttling is a decision, not an
 *        error.
 *   503 ONLY when Telegram itself failed, or when our own secrets are unbound — both are fixable
 *        without losing the alert, and both are cases where dropping it would lose a real one.
 */
import { formatAlert, formatIncident, classifyPayload, type Throttle, type LogEntry } from "./format.js";

export interface HandlerDeps {
  botToken: string;
  chatId: string;
  throttle: Throttle;
  now: () => number;
  /** Injected so a test never reaches the network, and so the send failure path is reachable. */
  send: (text: string) => Promise<{ ok: true } | { ok: false; reason: string }>;
  log: (event: string, fields?: Record<string, unknown>) => void;
}

/** Returns the HTTP status to answer Pub/Sub with. See the ack contract above. */
export async function handleEnvelope(body: string, deps: HandlerDeps): Promise<number> {
  // TWO PAYLOAD SHAPES ARRIVE HERE. The log sink delivers a Cloud Logging LogEntry; the node-health
  // alert policies deliver a Monitoring incident through a Pub/Sub notification channel on the same
  // topic. They share no fields, so the shape is decided once, here, and never guessed at later.
  let payload: Record<string, unknown>;
  try {
    const envelope = JSON.parse(body) as { message?: { data?: string } };
    const data = envelope.message?.data;
    if (typeof data !== "string") throw new Error("no message.data");
    payload = JSON.parse(Buffer.from(data, "base64").toString("utf8")) as Record<string, unknown>;
  } catch (err: unknown) {
    deps.log("seal.notifier.undecodable", { reason: err instanceof Error ? err.message : String(err) });
    return 204;
  }

  const shape = classifyPayload(payload);
  if (shape === "unknown") {
    // ACK, same reasoning as undecodable: it parsed, but it is neither of the two things this
    // service knows how to say out loud, and no number of retries changes that. Named separately so
    // the logs distinguish "not JSON" from "not ours" — different causes, different investigations.
    deps.log("seal.notifier.unrecognised", { keys: Object.keys(payload).slice(0, 8) });
    return 204;
  }

  if (deps.botToken === "" || deps.chatId === "") {
    // NACK. Our own misconfiguration, fixable without losing the alert — a redeploy with the
    // secrets bound delivers the retry. Acking would discard real alerts for as long as the
    // misconfiguration lasted, silently.
    deps.log("seal.notifier.unconfigured", {
      hasToken: deps.botToken !== "",
      hasChatId: deps.chatId !== "",
      impact: "alert NOT delivered and NOT acked; Pub/Sub will retry once secrets are bound",
    });
    return 503;
  }

  // Only the log branch may be read as a LogEntry. Reading `jsonPayload` off an incident yields
  // undefined, which previously overwrote this log line's own `event` field via the spread.
  const logEntry: LogEntry | undefined = shape === "log" ? (payload as LogEntry) : undefined;
  const sourceEvent = logEntry?.jsonPayload?.["event"];

  // A LOST RECEIPT OUTRANKS A HOT NODE. Node health shares this chat's global cap now, and a
  // capacity-stalled roll can produce a dozen node-health messages in an hour. This is the one
  // event that must not be dropped behind them. It keeps its per-key cooldown.
  const priority = sourceEvent === "relay.seal.rejected" ? "critical" : "normal";

  const { text, key } = shape === "incident" ? formatIncident(payload) : formatAlert(payload as LogEntry);
  const decision = deps.throttle.decide(key, deps.now(), priority);

  if (decision.action === "suppress") {
    deps.log("seal.notifier.suppressed", { key, shape, priority, sourceEvent });
    return 204;
  }

  const outgoing = decision.action === "notice" ? decision.text : text;
  const sent = await deps.send(outgoing);
  if (!sent.ok) {
    deps.log("seal.notifier.send.failed", { key, shape, reason: sent.reason });
    return 503; // transient — retry
  }

  deps.log("seal.notifier.sent", { key, kind: decision.action, shape, priority, sourceEvent });
  return 204;
}
