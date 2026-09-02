/**
 * THE ROUTING, WHICH HAD NO TESTS AT ALL.
 *
 * A review measured it: every test for the incident work called `formatIncident` directly, so the
 * whole of the server's behaviour — which formatter is chosen, what status Pub/Sub is answered
 * with, whether a lost receipt outranks a hot node — could be reverted with the suite still green.
 * These tests exist to make that revert fail.
 *
 * The ack contract is the sharp end: a wrong status either drops a real alert forever or retries a
 * broken one until the topic's retention expires. It is asserted here per branch.
 */
import { describe, it, expect } from "vitest";
import { handleEnvelope, type HandlerDeps } from "../handler.js";
import { Throttle } from "../format.js";

/** Pub/Sub delivers the payload base64-encoded inside a push envelope. */
function envelope(payload: unknown): string {
  return JSON.stringify({ message: { data: Buffer.from(JSON.stringify(payload)).toString("base64") } });
}

function deps(over: Partial<HandlerDeps> = {}): HandlerDeps & { sent: string[]; logs: string[] } {
  const sent: string[] = [];
  const logs: string[] = [];
  const d = {
    botToken: "t",
    chatId: "c",
    throttle: new Throttle(),
    now: () => 1_700_000_000_000,
    send: async (text: string) => {
      sent.push(text);
      return { ok: true } as const;
    },
    log: (event: string) => {
      logs.push(event);
    },
    ...over,
  };
  return Object.assign(d, { sent, logs });
}

const INCIDENT = {
  incident: {
    state: "open",
    policy_name: "Directory node burning CPU for an hour",
    condition_name: "Directory node over 0.25 cores for 60 minutes",
    observed_value: "0.4",
    threshold_value: "0.25",
    metric: { labels: { instance_name: "cello-gcp-use1-4cgj" } },
    resource: { labels: { zone: "us-east1-d" } },
  },
};

const SEAL_REJECTED = {
  jsonPayload: { event: "relay.seal.rejected", sessionId: "abc", reason: "connection_lost" },
  resource: { labels: { zone: "us-east1-b" } },
  timestamp: "2026-09-02T00:00:00Z",
};

describe("handleEnvelope — which formatter runs", () => {
  it("an incident is rendered as an incident, NOT as a relay repair failure", async () => {
    // THE REGRESSION THIS CATCHES is what the old code actually did: an incident fell through to
    // formatAlert, which read no fields it recognised and announced "a connection repair FAILED —
    // the next seal over this link will fail". A directory CPU problem sent to the relay.
    const d = deps();
    expect(await handleEnvelope(envelope(INCIDENT), d)).toBe(204);
    expect(d.sent).toHaveLength(1);
    expect(d.sent[0]).toContain("Directory node burning CPU for an hour");
    expect(d.sent[0]).not.toContain("connection repair FAILED");
    expect(d.sent[0]).not.toContain("unknown_event");
  });

  it("a seal log entry still renders as a seal alert", async () => {
    const d = deps();
    expect(await handleEnvelope(envelope(SEAL_REJECTED), d)).toBe(204);
    expect(d.sent[0]).toContain("could NOT be sealed");
  });
});

describe("handleEnvelope — the ack contract, per branch", () => {
  it("ACKs a payload that is neither shape, because no retry can ever fix it", async () => {
    const d = deps();
    expect(await handleEnvelope(envelope({ nonsense: true }), d)).toBe(204);
    expect(d.sent).toHaveLength(0);
    expect(d.logs).toContain("seal.notifier.unrecognised");
  });

  it("ACKs undecodable input, and says so with a DIFFERENT event than 'not ours'", async () => {
    const d = deps();
    expect(await handleEnvelope("{not json", d)).toBe(204);
    expect(d.logs).toContain("seal.notifier.undecodable");
    expect(d.logs).not.toContain("seal.notifier.unrecognised");
  });

  it("NACKs when the secrets are unbound — the alert is real and a redeploy will deliver the retry", async () => {
    const d = deps({ botToken: "" });
    expect(await handleEnvelope(envelope(INCIDENT), d)).toBe(503);
    expect(d.logs).toContain("seal.notifier.unconfigured");
  });

  it("NACKs when Telegram itself fails, so the alert is retried rather than dropped", async () => {
    const d = deps({ send: async () => ({ ok: false, reason: "http_500" }) });
    expect(await handleEnvelope(envelope(INCIDENT), d)).toBe(503);
    expect(d.logs).toContain("seal.notifier.send.failed");
  });

  it("ACKs a deliberate suppression — throttling is a decision, not an error", async () => {
    const d = deps();
    await handleEnvelope(envelope(INCIDENT), d);
    expect(await handleEnvelope(envelope(INCIDENT), d)).toBe(204); // same key, inside the cooldown
    expect(d.sent).toHaveLength(1);
    expect(d.logs).toContain("seal.notifier.suppressed");
  });

  it("checks the shape BEFORE the secrets, so a junk message is not retried forever on a misconfigured service", async () => {
    const d = deps({ botToken: "" });
    expect(await handleEnvelope(envelope({ nonsense: true }), d)).toBe(204);
  });
});

describe("handleEnvelope — a lost receipt outranks a hot node", () => {
  it("a refused seal is delivered even after node health has spent the whole hourly cap", async () => {
    // THE STARVATION THIS PREVENTS, and it is reachable: node health sends two messages per
    // incident (open and close), so a capacity-stalled roll across three nodes and two policies is
    // twelve messages against a cap of eight. Without priority the refused seal — the one alert
    // this channel was built for — is silently dropped behind them.
    const d = deps();
    for (let i = 0; i < 10; i += 1) {
      const inc = structuredClone(INCIDENT) as typeof INCIDENT & { incident: { policy_name: string } };
      inc.incident.policy_name = `noisy policy ${i}`;
      await handleEnvelope(envelope(inc), d);
    }
    const beforeSeal = d.sent.length;

    expect(await handleEnvelope(envelope(SEAL_REJECTED), d)).toBe(204);
    expect(d.sent).toHaveLength(beforeSeal + 1);
    expect(d.sent[d.sent.length - 1]).toContain("could NOT be sealed");
  });

  it("but node health IS capped, so the cap still exists", async () => {
    const d = deps();
    for (let i = 0; i < 10; i += 1) {
      const inc = structuredClone(INCIDENT) as typeof INCIDENT & { incident: { policy_name: string } };
      inc.incident.policy_name = `noisy policy ${i}`;
      await handleEnvelope(envelope(inc), d);
    }
    // Eight real sends plus one suppression notice — never all ten.
    expect(d.sent.length).toBeLessThan(10);
    expect(d.logs).toContain("seal.notifier.suppressed");
  });

  it("a critical alert still respects its OWN per-key cooldown, so one bad link cannot flood", async () => {
    const d = deps();
    await handleEnvelope(envelope(SEAL_REJECTED), d);
    await handleEnvelope(envelope(SEAL_REJECTED), d);
    expect(d.sent).toHaveLength(1);
  });
});
