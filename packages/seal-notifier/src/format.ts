/**
 * Turning a log entry into a message a person reads on their phone.
 *
 * SEPARATE FROM THE SERVER ON PURPOSE. This is the only part with judgement in it — what an
 * operator needs to see at a glance, and what to suppress — so it is the only part worth testing
 * hard. The server around it is plumbing.
 */

/** The shape Cloud Logging delivers through the sink. Everything is optional; nothing is trusted. */
export interface LogEntry {
  timestamp?: string;
  resource?: { labels?: Record<string, string> };
  jsonPayload?: Record<string, unknown>;
}

export interface Formatted {
  text: string;
  /** Coalescing key — repeats of the same key inside the window collapse into one message. */
  key: string;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/**
 * WHAT AN OPERATOR NEEDS AT A GLANCE, in this order: what broke, where, and whether it is the
 * known failure or something new.
 *
 * Deliberately NOT the whole log entry. A phone notification that has to be scrolled is one that
 * gets dismissed, and the entry is one query away for anyone who wants it — the session id is in
 * the message precisely so that query is easy.
 */
export function formatAlert(entry: LogEntry): Formatted {
  const p = entry.jsonPayload ?? {};
  const event = str(p["event"]) ?? "unknown_event";
  const zone = str(entry.resource?.labels?.["zone"]) ?? "unknown-zone";
  const session = str(p["sessionId"]);
  const reason = str(p["reason"]);
  const peer = str(p["peerId"]);
  const eviction = str(p["eviction"]);
  const adjudicator = str(p["adjudicator"]);
  const broker = str(p["brokerPeerId"]);
  // A SELF-TEST MUST ANNOUNCE ITSELF STRUCTURALLY. The first synthetic alert was distinguishable
  // only by an odd-looking session id, which is exactly the kind of "obvious if you look" that
  // stops being obvious at 2am — and an operator who mistakes a drill for an outage once will
  // mistake an outage for a drill later.
  const selftest = p["selftest"] === true;

  const lines: string[] = [];

  if (selftest) {
    lines.push("🧪 TEST — NOT A REAL FAILURE. Nothing is wrong.");
    lines.push("Sent deliberately to prove the alerting path works.");
    lines.push("");
  }

  if (event === "relay.seal.rejected") {
    // The one that actually cost something. Say so in the first line — this is a lost receipt, not
    // a warning about one.
    lines.push("🔴 CELLO — a conversation could NOT be sealed");
    lines.push("A receipt was lost. Both agents will report a timeout.");
  } else {
    // A repair ran and did not repair. No receipt is lost YET, but the next seal through this link
    // will fail, so it is worth waking up for.
    lines.push("🟠 CELLO — a connection repair FAILED");
    lines.push("No receipt lost yet; the next seal over this link will fail.");
  }

  lines.push("");
  lines.push(`when:  ${str(entry.timestamp) ?? "unknown"}`);
  lines.push(`where: ${zone}`);
  if (session) lines.push(`session: ${session}`);
  if (peer) lines.push(`peer:  ${peer}`);
  if (reason) lines.push(`why:   ${reason}`);
  // THE FIRST BRANCH OF ANY DIAGNOSIS. `adjudicator` says which directory the relay asked — the
  // one that brokered the session, its statically configured fallback, or a redirect it was sent
  // on — and `broker` says who that resolved to. Without them the alert can announce the failure
  // but not narrow it, and the first question an operator asks is one it cannot answer.
  if (adjudicator) lines.push(`asked: ${adjudicator}${broker ? ` (${broker})` : ""}`);

  // THE LINE THAT SAYS WHETHER THIS IS THE KNOWN BUG OR A NEW ONE. `eviction` is what M12 Tier P5
  // added; reading it is the difference between "the fix ran and was not enough" and "the fix never
  // ran", and those send an operator to completely different places.
  if (eviction === "evicted") {
    lines.push("");
    lines.push("The dead connection WAS evicted and the retry still failed —");
    lines.push("so this is not a stale handle on our side. Look at the directory.");
  } else if (eviction === "unavailable") {
    lines.push("");
    lines.push("The node could NOT evict — it is running a transport that predates");
    lines.push("hangUp. This node was rolled without the fix.");
  } else if (eviction === "failed") {
    lines.push("");
    lines.push("Eviction itself errored, so the dead connection may still be registered.");
  }

  lines.push("");
  lines.push(`event: ${event}`);

  // Coalesce on what makes two alerts THE SAME PROBLEM rather than the same text: the event and
  // the link it happened on. A session id would make every occurrence unique and defeat it.
  return { text: lines.join("\n"), key: `${event}|${zone}|${peer ?? "-"}` };
}

/**
 * ANTI-FLOOD. Andre's constraint was explicit: alerting he will not mute.
 *
 * Two independent limits, because they fail differently:
 *   - per-key cooldown — the same link failing repeatedly is ONE problem, not forty messages.
 *   - global cap — a fleet-wide fault trips many keys at once, which the per-key limit cannot see.
 *
 * When the global cap trips, one suppression notice is sent and then silence until the window
 * rolls. **The notice matters more than the suppression**: silently dropping alerts would make a
 * major outage look quieter than a minor one, which is the failure mode that makes people stop
 * trusting a channel.
 *
 * IN-MEMORY, AND THE LIMIT IS STATED: Cloud Run may run several instances or cold-start, so this
 * throttles per instance rather than globally. That is adequate for "do not flood me" and is not a
 * correctness mechanism — no alert is ever the ONLY record; the log entry is durable either way.
 */
export class Throttle {
  readonly #cooldownMs: number;
  readonly #windowMs: number;
  readonly #maxPerWindow: number;
  readonly #lastSent = new Map<string, number>();
  #windowStart = 0;
  #sentThisWindow = 0;
  #suppressedThisWindow = 0;
  #noticeSent = false;

  constructor(opts?: { cooldownMs?: number; windowMs?: number; maxPerWindow?: number }) {
    this.#cooldownMs = opts?.cooldownMs ?? 15 * 60_000;
    this.#windowMs = opts?.windowMs ?? 60 * 60_000;
    this.#maxPerWindow = opts?.maxPerWindow ?? 8;
  }

  /** `send` — deliver it. `suppress` — drop silently. `notice` — deliver THIS text instead. */
  decide(key: string, now: number): { action: "send" | "suppress" } | { action: "notice"; text: string } {
    if (now - this.#windowStart >= this.#windowMs) {
      this.#windowStart = now;
      this.#sentThisWindow = 0;
      this.#suppressedThisWindow = 0;
      this.#noticeSent = false;
    }

    const last = this.#lastSent.get(key);
    if (last !== undefined && now - last < this.#cooldownMs) {
      this.#suppressedThisWindow += 1;
      return { action: "suppress" };
    }

    if (this.#sentThisWindow >= this.#maxPerWindow) {
      this.#suppressedThisWindow += 1;
      if (this.#noticeSent) return { action: "suppress" };
      this.#noticeSent = true;
      return {
        action: "notice",
        text:
          "🔕 CELLO — alert flood suppressed\n\n" +
          `More than ${this.#maxPerWindow} distinct failures in the last hour, so further alerts ` +
          "are held until the window rolls.\n\n" +
          "This many at once is itself the signal: something fleet-wide, not one bad link. " +
          "Go and read the logs rather than waiting for more messages.",
      };
    }

    this.#lastSent.set(key, now);
    this.#sentThisWindow += 1;
    return { action: "send" };
  }
}
