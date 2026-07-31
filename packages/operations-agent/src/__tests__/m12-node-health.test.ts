/**
 * M12 `DOD-MOVE-OPSAGENT-1` — per-node health, with NO cross-cloud database connection.
 *
 * The ops agent asserts a schema version against ONE database. In a three-node consortium that means
 * migration drift on the other two is invisible: each sovereign node runs its own Cloud SQL and its
 * own Flyway, so "the schema is right" is a per-node fact, not a global one. A node a migration behind
 * accepts writes and diverges quietly — the failure this exists to surface.
 *
 * It reads each node's `/health` (which already reports `nodeId` and `schemaVersion`) rather than
 * opening three database connections. That is the DoD's "node-local API or equivalent", and it is the
 * difference between a monitor that needs credentials for every node's database and one that needs
 * none.
 */

import { describe, it, expect, vi } from "vitest";
import { checkNodeHealth, summariseNodeHealth, runNodeSweep } from "../node-health.js";
import { buildHealthReport } from "../server.js";

function fetchReturning(byUrl: Record<string, { status: number; body?: unknown }>): typeof fetch {
  return vi.fn(async (input: string | URL) => {
    const url = String(input);
    const hit = Object.entries(byUrl).find(([k]) => url.includes(k));
    if (!hit) throw new Error(`ECONNREFUSED ${url}`);
    const [, res] = hit;
    return {
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      json: async () => res.body ?? {},
    } as Response;
  }) as unknown as typeof fetch;
}

const URLS = ["http://10.0.0.1:9090", "http://10.0.0.2:9090", "http://10.0.0.3:9090"];

describe("checkNodeHealth", () => {
  it("reports every node's id and schema version", async () => {
    const out = await checkNodeHealth(URLS, {
      fetchFn: fetchReturning({
        "10.0.0.1": { status: 200, body: { status: "ok", nodeId: "gcp-use1", schemaVersion: 56 } },
        "10.0.0.2": { status: 200, body: { status: "ok", nodeId: "gcp-usc1", schemaVersion: 56 } },
        "10.0.0.3": { status: 200, body: { status: "ok", nodeId: "gcp-euw1", schemaVersion: 56 } },
      }),
    });
    expect(out.map((n) => n.nodeId)).toEqual(["gcp-use1", "gcp-usc1", "gcp-euw1"]);
    expect(out.every((n) => n.reachable && n.schemaVersion === 56)).toBe(true);
  });

  it("a node that is DOWN is reported as unreachable, and the others still report", async () => {
    // One node being down must not blind the monitor to the other two — that is the same redundancy
    // property the consortium itself has.
    const out = await checkNodeHealth(URLS, {
      fetchFn: fetchReturning({
        "10.0.0.1": { status: 200, body: { status: "ok", nodeId: "gcp-use1", schemaVersion: 56 } },
        "10.0.0.3": { status: 200, body: { status: "ok", nodeId: "gcp-euw1", schemaVersion: 56 } },
      }),
    });
    expect(out.filter((n) => n.reachable)).toHaveLength(2);
    const down = out.find((n) => !n.reachable);
    expect(down?.url).toBe("http://10.0.0.2:9090");
    // Unknown, not zero: a missing version must never compare equal to a real one.
    expect(down?.schemaVersion).toBeNull();
  });

  it("treats a non-200 as unreachable rather than trusting the body", async () => {
    const out = await checkNodeHealth(["http://10.0.0.1:9090"], {
      fetchFn: fetchReturning({ "10.0.0.1": { status: 503, body: { status: "degraded", schemaVersion: 56 } } }),
    });
    expect(out[0]?.reachable).toBe(false);
    expect(out[0]?.schemaVersion).toBeNull();
  });

  it("does not invent a version when the payload omits or malforms it", async () => {
    const out = await checkNodeHealth(["http://10.0.0.1:9090", "http://10.0.0.2:9090"], {
      fetchFn: fetchReturning({
        "10.0.0.1": { status: 200, body: { status: "ok", nodeId: "a" } },
        "10.0.0.2": { status: 200, body: { status: "ok", nodeId: "b", schemaVersion: "fifty-six" } },
      }),
    });
    expect(out[0]?.schemaVersion).toBeNull();
    expect(out[1]?.schemaVersion).toBeNull();
  });
});

describe("a node that answers headers then STALLS the body", () => {
  it("is bounded by the per-node budget, not by undici's 300s body timeout", async () => {
    // The sweep is awaited on the startup path, so an unbounded body read could keep the health port
    // from ever opening — Cloud Run then kills the instance and restarts it. A sick directory would
    // take down the registration path, which is the exact failure this design claims to avoid.
    const hangingFetch = (async (_u: string, init?: { signal?: AbortSignal }) => ({
      ok: true,
      status: 200,
      json: () =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
        }),
    })) as unknown as typeof fetch;

    const started = Date.now();
    const out = await checkNodeHealth(["http://10.0.0.9:9090"], { fetchFn: hangingFetch, timeoutMs: 60 });
    expect(Date.now() - started, "must not wait on the body past the budget").toBeLessThan(2_000);
    expect(out[0]?.reachable).toBe(false);
    expect(out[0]?.reason).toMatch(/timeout/i);
  });

  it("names the CAUSE rather than collapsing everything into 'unreachable'", async () => {
    // A live node serving 503 and a node that is not there are different problems in different
    // subsystems. Reporting both as "unreachable" sends an operator to check a VM that is fine.
    const out = await checkNodeHealth(["http://10.0.0.1:9090", "http://10.0.0.7:9090"], {
      fetchFn: fetchReturning({ "10.0.0.1": { status: 503 } }),
    });
    expect(out[0]?.reason).toBe("HTTP 503");
    expect(out[1]?.reason, "a refused connection is not an HTTP status").not.toMatch(/HTTP 5/);

    // And the cause survives into the operator-visible line.
    expect(summariseNodeHealth(out, 56).detail).toContain("HTTP 503");
  });
});

describe("summariseNodeHealth", () => {
  const ok = [
    { url: "u1", nodeId: "gcp-use1", reachable: true, schemaVersion: 56 },
    { url: "u2", nodeId: "gcp-usc1", reachable: true, schemaVersion: 56 },
    { url: "u3", nodeId: "gcp-euw1", reachable: true, schemaVersion: 56 },
  ];

  it("is healthy when every reachable node is at the expected version", () => {
    expect(summariseNodeHealth(ok, 56)).toEqual({ healthy: true, detail: "3/3 nodes at schema 56" });
  });

  it("NAMES the drifted node — 'drift detected' is not actionable", () => {
    const drifted = [...ok.slice(0, 2), { ...ok[2]!, schemaVersion: 55 }];
    const s = summariseNodeHealth(drifted, 56);
    expect(s.healthy).toBe(false);
    expect(s.detail).toContain("gcp-euw1");
    expect(s.detail).toContain("55");
  });

  it("is UNHEALTHY when a node is unreachable — silence is not agreement", () => {
    // The tempting reading is "the nodes I can see agree, so we are fine". A node that cannot be
    // reached is a node whose schema is unknown, and unknown is not healthy.
    const down = [...ok.slice(0, 2), { url: "u3", nodeId: null, reachable: false, schemaVersion: null }];
    const s = summariseNodeHealth(down, 56);
    expect(s.healthy).toBe(false);
    expect(s.detail).toMatch(/unreachable/i);
  });

  it("is unhealthy when there are no nodes configured at all", () => {
    // Otherwise "nothing to check" reports as green, which is how a monitor silently stops monitoring.
    expect(summariseNodeHealth([], 56).healthy).toBe(false);
  });
});

describe("node health is REPORTED, never a startup gate", () => {
  const base = {
    dbConnected: true,
    migrationVersion: 56,
    expectedMigrationVersion: 56,
    telegramConnected: true,
  };

  it("a DEGRADED consortium still leaves the agent healthy enough to run", () => {
    // The one that matters. `healthy: false` exits the process at startup, and this agent is the ONLY
    // thing that issues registration capabilities to a human. Refusing to start because one of three
    // sovereign nodes is unreachable turns a survivable outage into a total one — the exact failure
    // the redundancy invariant exists to prevent, arriving through the monitor instead of the protocol.
    const report = buildHealthReport({
      ...base,
      nodeHealth: { healthy: false, detail: "unreachable: gcp-euw1" },
    });
    expect(report.healthy, "a down directory must NOT stop the ops agent starting").toBe(true);
    // But it is visible, not swallowed.
    expect(report.checks.nodes).toBe("unreachable: gcp-euw1");
  });

  it("still fails on the things that genuinely make it unable to work", () => {
    // The gate is not toothless: no database, no agent.
    expect(buildHealthReport({ ...base, dbConnected: false }).healthy).toBe(false);
    expect(buildHealthReport({ ...base, telegramConnected: false }).healthy).toBe(false);
    expect(buildHealthReport({ ...base, migrationVersion: 55 }).healthy).toBe(false);
  });

  it("omits the nodes check entirely when no sweep was configured", () => {
    // Absent rather than "ok" — a check that was never run must not read as one that passed.
    expect(buildHealthReport(base).checks.nodes).toBeUndefined();
  });
});

describe("runNodeSweep — the WIRING, not just the pure functions", () => {
  function recordingLogger() {
    const calls: Array<{ level: string; event: string; detail: Record<string, unknown> }> = [];
    const at = (level: string) => (event: string, detail?: Record<string, unknown>) =>
      calls.push({ level, event, detail: detail ?? {} });
    return { calls, info: at("info"), warn: at("warn") };
  }

  it("emits ops_agent.nodes.degraded at warn, NAMING the drifted node", async () => {
    // Until this existed the entire sweep could be deleted from the server and every test in this
    // file still passed — the only production consumer was the only untested part.
    const logger = recordingLogger();
    const summary = await runNodeSweep("http://10.0.0.1:9090,http://10.0.0.2:9090", 56, logger, {
      fetchFn: fetchReturning({
        "10.0.0.1": { status: 200, body: { status: "ok", nodeId: "gcp-use1", schemaVersion: 56 } },
        "10.0.0.2": { status: 200, body: { status: "ok", nodeId: "gcp-usc1", schemaVersion: 55 } },
      }),
    });

    expect(summary?.healthy).toBe(false);
    const degraded = logger.calls.find((c) => c.event === "ops_agent.nodes.degraded");
    expect(degraded?.level).toBe("warn");
    expect(String(degraded?.detail["detail"])).toContain("gcp-usc1");
  });

  it("emits ops_agent.nodes.ok when the consortium agrees", async () => {
    const logger = recordingLogger();
    const summary = await runNodeSweep("http://10.0.0.1:9090", 56, logger, {
      fetchFn: fetchReturning({ "10.0.0.1": { status: 200, body: { status: "ok", nodeId: "a", schemaVersion: 56 } } }),
    });
    expect(summary?.healthy).toBe(true);
    expect(logger.calls.find((c) => c.event === "ops_agent.nodes.ok")?.level).toBe("info");
  });

  it("an UNSET DIRECTORY_HEALTH_URLS is announced, not silent", async () => {
    // The failure this closes: the caller used to skip the sweep entirely when the variable was
    // empty, so a typo'd terraform value produced no log at all — and the "no nodes configured"
    // branch written to catch exactly that was unreachable from production.
    const logger = recordingLogger();
    const summary = await runNodeSweep(undefined, 56, logger);
    expect(summary).toBeNull();
    const disabled = logger.calls.find((c) => c.event === "ops_agent.nodes.sweep_disabled");
    expect(disabled, "a monitor that stops monitoring must say so").toBeDefined();
    expect(disabled?.level).toBe("warn");
  });

  it("treats a whitespace-only value as unset rather than sweeping an empty url", async () => {
    const logger = recordingLogger();
    expect(await runNodeSweep("  , ,  ", 56, logger)).toBeNull();
    expect(logger.calls.some((c) => c.event === "ops_agent.nodes.sweep_disabled")).toBe(true);
  });
});
