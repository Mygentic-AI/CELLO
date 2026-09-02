/**
 * The notifier's only judgement lives in formatting and throttling, so it is the only part tested
 * hard. The server around it is plumbing.
 *
 * The throttle tests matter more than they look: Andre's constraint was alerting he will not mute,
 * and an alert channel dies the first time it floods.
 */
import { describe, it, expect } from "vitest";
import { formatAlert, formatIncident, classifyPayload, Throttle, type LogEntry } from "../format.js";

function entry(payload: Record<string, unknown>, zone = "us-east1-b"): LogEntry {
  return { timestamp: "2026-08-19T14:00:00Z", resource: { labels: { zone } }, jsonPayload: payload };
}

describe("formatAlert — what an operator reads on their phone", () => {
  it("a refused seal says a receipt was LOST, not that one might be", () => {
    const { text } = formatAlert(entry({
      event: "relay.seal.rejected",
      sessionId: "df2a2a0892cfd35973f70016aaf27ece",
      reason: 'connection_lost: The connection muxer is "closed" and not "open"',
    }));
    // The distinction is the whole message. A failed repair is a warning; a refused seal already
    // cost the operator a receipt and both agents are about to report a timeout.
    expect(text).toContain("could NOT be sealed");
    expect(text).toContain("A receipt was lost");
    expect(text).toContain("df2a2a0892cfd35973f70016aaf27ece");
  });

  it("a failed repair says NO receipt is lost yet — it is a warning, not a loss", () => {
    const { text } = formatAlert(entry({
      event: "relay.directory.redial.outcome", recovered: false, peerId: "12D3KooWExample",
    }));
    expect(text).toContain("repair FAILED");
    expect(text).toContain("No receipt lost yet");
  });

  it("names WHICH SIDE the fault is on when the eviction succeeded and the retry still failed", () => {
    const { text } = formatAlert(entry({
      event: "relay.directory.redial.outcome", recovered: false, eviction: "evicted",
    }));
    // This is the line that sends an operator to the right place. Evicted-and-still-failed means
    // the stale handle was NOT the problem — the exact wrong conclusion this whole milestone was
    // built on twice.
    expect(text).toContain("not a stale handle on our side");
  });

  it("says the node is running old code when it could not evict", () => {
    const { text } = formatAlert(entry({
      event: "relay.directory.redial.outcome", recovered: false, eviction: "unavailable",
    }));
    expect(text).toContain("rolled without the fix");
  });

  it("survives a log entry with almost nothing in it", () => {
    // The sink delivers whatever matched. A formatter that throws takes the alert with it.
    const { text, key } = formatAlert({});
    expect(text).toContain("CELLO");
    expect(key.length).toBeGreaterThan(0);
  });

  it("coalesces on the LINK, not the session — else every occurrence is unique", () => {
    const a = formatAlert(entry({ event: "relay.seal.rejected", sessionId: "aaa", peerId: "p1" }));
    const b = formatAlert(entry({ event: "relay.seal.rejected", sessionId: "bbb", peerId: "p1" }));
    // Same link failing twice is ONE problem. Keying on the session would make the cooldown
    // useless, which is how a channel floods and gets muted.
    expect(a.key).toBe(b.key);
  });

  it("does not coalesce across different zones", () => {
    const a = formatAlert(entry({ event: "relay.seal.rejected", peerId: "p1" }, "us-east1-b"));
    const b = formatAlert(entry({ event: "relay.seal.rejected", peerId: "p1" }, "europe-west1-b"));
    expect(a.key).not.toBe(b.key);
  });
});

describe("the three fields added after the first real message was read", () => {
  it("a self-test says so in the FIRST line, not by an odd-looking session id", () => {
    const { text } = formatAlert(entry({
      event: "relay.seal.rejected", selftest: true, sessionId: "SYNTHETIC-SELFTEST",
    }));
    // The first synthetic alert was distinguishable only by squinting at the session id. An
    // operator who mistakes a drill for an outage once will mistake an outage for a drill later.
    expect(text.split("\n")[0]).toContain("TEST — NOT A REAL FAILURE");
    expect(text).toContain("Nothing is wrong");
  });

  it("a REAL alert carries no test marker anywhere", () => {
    const { text } = formatAlert(entry({ event: "relay.seal.rejected", sessionId: "abc" }));
    expect(text).not.toContain("TEST");
    expect(text).not.toContain("Nothing is wrong");
  });

  it("names WHICH directory was asked — the first branch of any diagnosis", () => {
    const { text } = formatAlert(entry({
      event: "relay.seal.rejected",
      adjudicator: "redirect",
      brokerPeerId: "12D3KooWExQLMbvaioVqQCPkc1ZZgJ5kdoePymtMrg46ugMBs5zi",
    }));
    // broker / configured / redirect are three quite different failures. Without this the alert
    // announces a problem it cannot narrow, and the first question asked is one it cannot answer.
    expect(text).toContain("asked: redirect");
    expect(text).toContain("ugMBs5zi");
  });

  it("carries the FULL session id when the relay sends one", () => {
    const full = "df2a2a0892cfd35973f70016aaf27ece";
    const { text } = formatAlert(entry({ event: "relay.seal.rejected", sessionId: full }));
    // 8 hex characters is enough to grep and NOT enough to run `cello sealed-receipt` or
    // `cello transcript`, which is the whole point of putting it in a notification.
    expect(text).toContain(full);
    expect(full.length).toBe(32);
  });
});

describe("Throttle — alerting Andre will not mute", () => {
  it("sends the first, suppresses a repeat of the same link inside the cooldown", () => {
    const t = new Throttle({ cooldownMs: 1000, windowMs: 60_000, maxPerWindow: 100 });
    expect(t.decide("k", 0).action).toBe("send");
    expect(t.decide("k", 500).action).toBe("suppress");
    expect(t.decide("k", 1500).action).toBe("send");
  });

  it("does not let one noisy link silence a different one", () => {
    const t = new Throttle({ cooldownMs: 10_000, windowMs: 60_000, maxPerWindow: 100 });
    expect(t.decide("link-a", 0).action).toBe("send");
    expect(t.decide("link-a", 100).action).toBe("suppress");
    // A second link failing is new information and must get through.
    expect(t.decide("link-b", 200).action).toBe("send");
  });

  it("caps a fleet-wide storm and SAYS it is holding messages back", () => {
    const t = new Throttle({ cooldownMs: 0, windowMs: 60_000, maxPerWindow: 2 });
    expect(t.decide("a", 0).action).toBe("send");
    expect(t.decide("b", 1).action).toBe("send");

    const third = t.decide("c", 2);
    // A NOTICE, not silence. Dropping the rest quietly would make a fleet-wide outage look
    // quieter than a single bad link — the failure that teaches people to distrust a channel.
    expect(third.action).toBe("notice");
    if (third.action !== "notice") throw new Error("unreachable");
    expect(third.text).toContain("flood suppressed");
    expect(third.text).toContain("fleet-wide");

    // and only ONE notice per window, or the suppression itself becomes the flood
    expect(t.decide("d", 3).action).toBe("suppress");
    expect(t.decide("e", 4).action).toBe("suppress");
  });

  it("recovers when the window rolls, so a bad hour does not silence the next one", () => {
    const t = new Throttle({ cooldownMs: 0, windowMs: 1000, maxPerWindow: 1 });
    expect(t.decide("a", 0).action).toBe("send");
    expect(t.decide("b", 10).action).toBe("notice");
    expect(t.decide("c", 20).action).toBe("suppress");
    // New window — alerting must come back on its own. A throttle that latches is an outage.
    expect(t.decide("d", 1100).action).toBe("send");
  });
});

/**
 * MONITORING INCIDENTS — the second payload shape on the same topic.
 *
 * The node-health alert policies publish through a Pub/Sub notification channel into the SAME topic
 * the log sink feeds. The two payloads have nothing in common, so the discriminator and the
 * formatter are where this goes wrong, and both are tested here.
 */
describe("classifyPayload — the two shapes on one topic", () => {
  it("a Monitoring incident is recognised as one", () => {
    expect(classifyPayload({ incident: { incident_id: "x", state: "open" } })).toBe("incident");
  });

  it("a log entry is NOT mistaken for an incident", () => {
    expect(classifyPayload({ jsonPayload: { event: "relay.seal.rejected" } })).toBe("log");
  });

  it("an unrecognisable payload is neither, so the caller can ACK it instead of retrying forever", () => {
    expect(classifyPayload({ nonsense: true })).toBe("unknown");
    expect(classifyPayload(null)).toBe("unknown");
    // `incident` present but not an object is not an incident — a string here would otherwise
    // reach the formatter and read every field off a primitive.
    expect(classifyPayload({ incident: "open" })).toBe("unknown");
  });
});

function incident(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    incident: {
      incident_id: "0.abc123",
      state: "open",
      policy_name: "Directory node approaching its heap ceiling",
      condition_name: "Directory node RSS over 60% of the V8 ceiling",
      summary: "RSS for gcp-use1 is above the threshold of 2634547",
      url: "https://console.cloud.google.com/monitoring/alerting/incidents/0.abc123",
      started_at: 1_788_000_000,
      observed_value: "2700000",
      threshold_value: "2634547",
      resource: { type: "gce_instance", labels: { zone: "us-east1-d", instance_id: "8675309" } },
      metric: { type: "logging.googleapis.com/user/cello_directory_node_rss_kb", labels: { node_id: "gcp-use1" } },
      documentation: { content: "A directory node's resident memory has passed 60%..." },
      ...over,
    },
  };
}

describe("formatIncident — a node-health alert on a phone", () => {
  it("leads with the POLICY NAME, because that is what says which of the two fired", () => {
    const { text } = formatIncident(incident());
    expect(text).toContain("Directory node approaching its heap ceiling");
  });

  it("names WHICH NODE on its own line, from the metric label rather than the opaque instance id", () => {
    // ASSERTS THE EXACT LINE. `gcp-use1` also appears inside the fixture's own `summary`, so a bare
    // toContain stays green with the `node:` line deleted entirely — which is precisely the
    // implementation this test exists to forbid, one that never reads metric.labels.
    const { text } = formatIncident(incident());
    expect(text).toContain("node:  gcp-use1");
    // node_id survives a roll; the numeric instance id names the machine and tells nobody anything.
    expect(text).not.toContain("8675309");
  });

  it("carries the observed value AND the threshold — a number with nothing to compare it to is noise", () => {
    // The exact line again: `2634547` is in the fixture's summary too, so asserting it alone passes
    // with the threshold stripped out of the value line.
    const { text } = formatIncident(incident());
    expect(text).toContain("value: 2700000  (threshold 2634547)");
  });

  it("a CLOSED incident that really recovered says RECOVERED", () => {
    // One hour open: a genuine recovery, not a timeout.
    const { text } = formatIncident(incident({ state: "closed", ended_at: 1_788_003_600 }));
    expect(text).toContain("✅ CELLO RECOVERED");
    expect(text).toContain("returned to normal");
  });

  it("an incident AUTO-CLOSED after 24h must NOT be reported as a recovery", () => {
    // THE FAILURE THIS PREVENTS: a directory process dies, stops emitting, the missing-data
    // condition opens an incident, the node stays dead, and Monitoring times the incident out 24h
    // later. Saying \"recovered, nothing to do\" there announces health on the single failure most
    // worth being told about.
    const { text } = formatIncident(incident({ state: "closed", started_at: 1_788_000_000, ended_at: 1_788_086_400 }));
    expect(text).toContain("AUTO-CLOSED");
    expect(text).toContain("NOT a recovery");
    expect(text).not.toContain("✅ CELLO RECOVERED");
  });

  it("a missing measurement is reported as a node that STOPPED REPORTING, not as a heap breach", () => {
    // The EVALUATION_MISSING_DATA_ACTIVE path. Leading with the policy name would send an operator
    // to read a memory trend for a process that is not running.
    const { text } = formatIncident(incident({ observed_value: undefined, threshold_value: undefined }));
    expect(text).toContain("gcp-use1 has STOPPED REPORTING");
    expect(text).not.toMatch(/^🟠 CELLO — Directory node approaching/m);
  });

  it("renders 🔴 when the payload says CRITICAL, rather than assuming every policy is a warning", () => {
    expect(formatIncident(incident({ severity: "CRITICAL" })).text).toContain("🔴");
    expect(formatIncident(incident()).text).toContain("🟠");
  });

  it("an OPEN incident is not dressed up as a recovery", () => {
    const { text } = formatIncident(incident());
    expect(text).not.toContain("RECOVERED");
  });

  it("carries the console link, because the next click is the whole affordance", () => {
    const { text } = formatIncident(incident());
    expect(text).toContain("https://console.cloud.google.com/monitoring/alerting/incidents/0.abc123");
  });

  it("open and closed for the SAME incident are different keys, so the recovery is never throttled away", () => {
    const open = formatIncident(incident()).key;
    const closed = formatIncident(incident({ state: "closed" })).key;
    expect(open).not.toBe(closed);
  });

  it("two nodes breaching the same policy are different keys — one node's alert must not mute the other's", () => {
    const a = formatIncident(incident()).key;
    const b = formatIncident(incident({ metric: { type: "m", labels: { node_id: "gcp-euw1" } } })).key;
    expect(a).not.toBe(b);
  });

  it("survives a payload missing every optional field rather than throwing on the alerting path", () => {
    // A formatter that throws here turns a real incident into an undecodable message and the
    // operator is told nothing at all.
    const { text, key } = formatIncident({ incident: { state: "open", observed_value: "1", threshold_value: "0" } });
    // AND says the policy name is missing rather than inventing a plausible one. A fallback that
    // reads like an ordinary headline hides the fact that the payload was not what we thought.
    expect(text).toContain("UNNAMED POLICY");
    expect(key.length).toBeGreaterThan(0);
  });
});
