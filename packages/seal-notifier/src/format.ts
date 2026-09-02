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

  /**
   * `send` — deliver it. `suppress` — drop silently. `notice` — deliver THIS text instead.
   *
   * PRIORITY EXISTS BECAUSE ONE CHAT NOW CARRIES TWO CLASSES OF ALERT, and without it the less
   * serious one can starve the more serious one. The global cap is 8 an hour across ALL keys. Node
   * health sends TWO messages per incident (open and close), so a capacity-stalled roll — three
   * nodes, two policies, both states — is 12 messages against that cap, and a `relay.seal.rejected`
   * arriving behind them would be dropped. A lost receipt is the most serious thing this channel
   * carries; it must not be silenced by a hot node.
   *
   * `critical` therefore bypasses the GLOBAL CAP ONLY. It still respects the per-key cooldown, so
   * one repeatedly-failing link cannot flood on its own — which is the limit that was actually
   * protecting against a flood in the first place.
   */
  decide(
    key: string,
    now: number,
    priority: "critical" | "normal" = "normal",
  ): { action: "send" | "suppress" } | { action: "notice"; text: string } {
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

    if (priority !== "critical" && this.#sentThisWindow >= this.#maxPerWindow) {
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

/**
 * ── THE SECOND PAYLOAD SHAPE ─────────────────────────────────────────────────────────────────────
 *
 * The node-health alert policies (sustained CPU, heap ceiling) reach Telegram through a Pub/Sub
 * NOTIFICATION CHANNEL that publishes into the SAME topic the log sink feeds. So one subscription
 * and one service carry two payloads that share no fields at all.
 *
 * WHY ONE TOPIC RATHER THAN TWO: one destination, one service, one thing to keep alive. A second
 * topic would add a subscription and an IAM binding that can rot independently, for no gain.
 *
 * ⚠️ AN EARLIER VERSION OF THIS COMMENT GAVE A DIFFERENT AND FALSE REASON — that two topics would
 * mean two Throttles and a doubled budget. They would not: `throttle` is a module-level singleton
 * and the service is pinned to `max_instance_count = 1`, so two subscriptions onto the SAME service
 * share the SAME budget. A second budget needs a second SERVICE, not a second topic. Rewritten
 * rather than deleted because the wrong reason argued the opposite of the real trade-off, which is
 * this: one shared route means node health and seal failures draw on one global cap. That is why
 * `decide()` takes a priority — see the Throttle below.
 */

/** Which of the two shapes this is — or neither, which the caller ACKs rather than retrying. */
export function classifyPayload(payload: unknown): "incident" | "log" | "unknown" {
  if (typeof payload !== "object" || payload === null) return "unknown";
  const o = payload as Record<string, unknown>;
  // Checked as an OBJECT, not merely present. `incident: "open"` would otherwise reach the
  // formatter, which would read every field off a string and send a message full of "unknown".
  const incident = o["incident"];
  if (typeof incident === "object" && incident !== null) return "incident";
  const json = o["jsonPayload"];
  if (typeof json === "object" && json !== null) return "log";
  return "unknown";
}

function rec(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
}

/**
 * A Cloud Monitoring incident, as a person reads it on a phone.
 *
 * DELIBERATELY DOES NOT INLINE THE POLICY'S `documentation` BLOCK, which is where the remedy steps
 * live: measured at 1,231 and 1,332 characters, and this file's standing rule is that a
 * notification which has to be scrolled is one that gets dismissed. The console link IS the
 * affordance — one tap, and that documentation is the first thing on the page.
 */
export function formatIncident(payload: Record<string, unknown>): Formatted {
  const inc = rec(payload["incident"]);
  const closed = str(inc["state"]) === "closed";

  // NOT a plausible-sounding default. `policy_name` is always present in a real incident, so the
  // only way to reach this is a payload that is not what we think it is — and a fallback reading
  // like an ordinary headline would hide exactly that. Absence has to look like absence.
  const policy = str(inc["policy_name"]) ?? "⚠️ UNNAMED POLICY — payload missing policy_name";
  const condition = str(inc["condition_name"]);
  const summary = str(inc["summary"]);
  const url = str(inc["url"]);
  const observed = str(inc["observed_value"]);
  const threshold = str(inc["threshold_value"]);

  // READ, not assumed. Both node-health policies are WARNING today, but the payload carries this
  // and a future CRITICAL policy on this channel must not render as a warning.
  const critical = str(inc["severity"])?.toUpperCase() === "CRITICAL";

  const metricLabels = rec(rec(inc["metric"])["labels"]);
  const resourceLabels = rec(rec(inc["resource"])["labels"]);

  // node_id first, instance_name second, and instance_id NEVER. `node_id` survives a roll, so it is
  // the identity an operator can act on; the numeric instance id is the one field here that names
  // the machine while telling them nothing they can use.
  const who = str(metricLabels["node_id"]) ?? str(metricLabels["instance_name"]);
  const zone = str(resourceLabels["zone"]);

  const lines: string[] = [];

  if (closed) {
    // ⚠️ DO NOT SAY "RECOVERED, NOTHING TO DO" — Monitoring closing an incident is not the same as
    // the thing being fixed. Both policies carry `auto_close = 86400s`, and the memory condition
    // carries EVALUATION_MISSING_DATA_ACTIVE, so a directory process that DIES stops emitting,
    // opens an incident, stays dead, and has that incident auto-closed 24 hours later. Claiming
    // recovery there would announce health on the single failure most worth being told about.
    //
    // `started_at`/`ended_at` are unix seconds and both are in the payload, so the two cases are
    // distinguishable for free rather than guessed at.
    const started = Number(inc["started_at"]);
    const ended = Number(inc["ended_at"]);
    const autoClosed = Number.isFinite(started) && Number.isFinite(ended) && ended - started >= 86_400;

    if (autoClosed) {
      lines.push(`⌛ CELLO — ${policy}: incident AUTO-CLOSED after 24h`);
      lines.push("This is NOT a recovery. Monitoring times incidents out; the condition may still hold.");
      lines.push("Check the node before assuming it is well.");
    } else {
      lines.push(`✅ CELLO RECOVERED — ${policy}`);
      lines.push("The condition returned to normal. Sent so the open alert is not left hanging.");
    }
  } else if (!observed) {
    // ⚠️ AN ABSENT MEASUREMENT IS A DIFFERENT FAILURE, AND THE POLICY NAME DESCRIBES THE WRONG ONE.
    // This is the EVALUATION_MISSING_DATA_ACTIVE path: the node has reported nothing. Leading with
    // "approaching its heap ceiling" would send an operator to read a memory trend for a process
    // that is not running. The `value:` line also vanishes on this path, taking with it the one
    // structural cue that this is not a threshold breach — so the headline has to carry it.
    lines.push(`🟠 CELLO — ${who ?? "a directory node"} has STOPPED REPORTING`);
    lines.push("Monitoring has no data for it. The usual cause is the directory process being dead");
    lines.push("or crash-looping — check that it is running before reading anything into the policy.");
    lines.push(`(raised by: ${policy})`);
  } else {
    // 🔴 only when the payload SAYS critical. In this chat 🔴 means something was actually lost, and
    // spending it on "a node is running hot" is how the red one stops meaning anything.
    lines.push(`${critical ? "🔴" : "🟠"} CELLO — ${policy}`);
    if (condition) lines.push(condition);
  }

  lines.push("");
  if (who) lines.push(`node:  ${who}`);
  if (zone) lines.push(`where: ${zone}`);
  // A measurement with nothing to compare it against is not information. Both or neither.
  if (observed && threshold) lines.push(`value: ${observed}  (threshold ${threshold})`);
  if (summary) {
    lines.push("");
    lines.push(summary);
  }
  if (url) {
    lines.push("");
    lines.push(url);
  }

  // STATE IS IN THE KEY, and it has to be: the per-key cooldown is 15 minutes, so an incident that
  // opens and recovers inside that window would have its RECOVERY suppressed, leaving the chat
  // believing a node is still sick. `who` is in the key for the same reason one scale down — one
  // node breaching must never mute another node breaching the same policy.
  //
  // ⚠️ THIS RESTS ON AN INVARIANT NOBODY WOULD OTHERWISE SEE: a re-open needs a full `duration` of
  // violation, and both policies' durations (3,600 s and 1,800 s) EXCEED the 15-minute cooldown, so
  // open→closed→open cannot collapse onto a suppressed key. A future policy with a duration shorter
  // than the cooldown breaks that silently — the chat's last word would be RECOVERED on a sick node.
  return {
    text: lines.join("\n"),
    key: `${policy}|${who ?? zone ?? "-"}|${closed ? "closed" : "open"}`,
  };
}
