/**
 * DOD-RELAY-KEEPALIVE-1 — the relay's libp2p defaults are the product, not a detail.
 *
 * Three of libp2p's defaults are wrong for a node whose entire job is carrying CELLO sessions,
 * and each one has already cost a live outage:
 *
 *  1. `maxReservations: 15` — every agent needs a reservation and every daemon restart mints a
 *     fresh peer id, so the slots are gone almost immediately; the relay then completes the
 *     handshake and grants nothing, and agents come up looking healthy and reachable by nobody.
 *  2. `applyDefaultLimit: true` — relayed connections capped at 2 minutes / 128 KiB. Where the
 *     hole punch fails, the relayed connection is not a fallback, it IS the session.
 *  3. `abortConnectionOnPingFailure: true` — one slow keepalive ping aborts the whole connection.
 *     This is the 2026-08-04 defect: healthy client↔relay links dying every 60-90 seconds.
 *
 * (1) and (2) are fixed in `createRelayNode`. This file exists because they were fixed there and
 * a SECOND factory in the same package kept running the defaults — `startRelay`, which the
 * production binary never used and which sat exported under the most obvious name in the API for
 * anyone reaching for "start a relay". It is deleted; these tests keep it deleted and pin (3).
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import * as relayPackage from "../index.js";
import { createRelayNode } from "../relay-node.js";
import { generateKeypair } from "@cello-protocol/crypto";
import { WAN_PING_TIMEOUT_FLOOR_MS } from "@cello-protocol/transport";

const SRC = join(import.meta.dirname, "..");

describe("the relay package exposes exactly ONE way to build a relay", () => {
  it("no `startRelay` export survives — the factory that ran libp2p's default reservation limits", () => {
    expect(
      Object.keys(relayPackage),
      "startRelay built a relay from bare createLibp2p with maxReservations 15 and the 2-minute / " +
      "128 KiB relayed-connection limit applied. It had no callers and every property createRelayNode " +
      "exists to set was wrong in it. If it is back, so is the footgun.",
    ).not.toContain("startRelay");
    expect(relayPackage).toHaveProperty("createRelayNode");
  });

  it("and it is gone from the BUILT artifact too, not just the source", () => {
    // §5: deadness is proven on the built artifact, because that is what would ship. `import
    // "../index.js"` resolves to index.TS under vitest, so the export check above never looks at
    // dist/ — a stale build could still carry the factory. Skipped when dist/ has not been built.
    const dist = join(SRC, "..", "dist", "index.js");
    if (!existsSync(dist)) return;
    const built = readFileSync(dist, "utf-8");
    const exportsStartRelay = /export\s*\{[^}]*\bstartRelay\b/.test(built) || /\bstartRelay\s*as\b/.test(built);
    expect(exportsStartRelay, "dist/index.js still exports startRelay — rebuild, or it ships").toBe(false);
  });

  it("no other call site in the package builds a libp2p node of its own", () => {
    // createRelayNode goes through @cello-protocol/transport's createNode, which is where the
    // reservation and connection-monitor policy lives. A direct createLibp2p in this package is
    // by definition a node that skipped all of it.
    const index = readFileSync(join(SRC, "index.ts"), "utf-8");
    const relayNode = readFileSync(join(SRC, "relay-node.ts"), "utf-8");
    for (const [name, src] of [["index.ts", index], ["relay-node.ts", relayNode]] as const) {
      expect(src, `${name} must not construct libp2p directly — go through createNode`).not.toContain("createLibp2p(");
    }
  });
});

describe("createRelayNode's libp2p policy — asserted on the RUNNING node, not on its source", () => {
  /**
   * These were regex-over-source assertions and a review showed exactly what that hides: the
   * relay's `connectionMonitor` option is only honoured by @cello-protocol/transport >= 0.0.44,
   * and against the previously published transport the option was DISCARDED IN SILENCE — correct
   * source, correct regex, defective relay, green suite. Asking the built node what policy it is
   * running cannot be fooled that way, and it fails loudly on an old transport.
   */
  it("gives up the authority to abort a client link on a failed keepalive ping", async () => {
    // The relay owes its clients no liveness verdict — the reservation TTL does that — and one
    // slow ping over a WAN hop is not a dead peer.
    const dirPubkey = await generateKeypair().getPublicKey();
    const { node, stop } = await createRelayNode({ directoryPubkey: dirPubkey });
    try {
      const policy = node.getConnectionMonitorPolicy();
      expect(policy.abortConnectionOnPingFailure).toBe(false);
    } finally {
      await stop();
    }
  }, 30_000);

  it("keeps PINGING — the traffic is the keepalive against network-level reapers", async () => {
    // Disabling the monitor outright would silence the only traffic on an idle relay link and
    // hand it to the first NAT conntrack table that collects idle flows.
    const dirPubkey = await generateKeypair().getPublicKey();
    const { node, stop } = await createRelayNode({ directoryPubkey: dirPubkey });
    try {
      expect("enabled" in node.getConnectionMonitorPolicy()).toBe(false);
      expect(node.getConnectionMonitorPolicy().pingTimeout?.minTimeout).toBeGreaterThanOrEqual(30_000);
    } finally {
      await stop();
    }
  }, 30_000);

  it("REFUSES to start on a transport that would silently ignore the policy", () => {
    // The module-load guard in relay-node.ts. If this symbol is gone from the transport, the
    // import above throws at load and this file cannot even run — which is the point: a relay that
    // cannot enforce its keepalive policy must not come up pretending it has.
    expect(typeof WAN_PING_TIMEOUT_FLOOR_MS).toBe("number");
  });

  it("still raises the reservation ceiling and drops the relayed-connection limits", () => {
    // Kept as a source assertion deliberately: these two reach libp2p through circuitRelayServer's
    // own init, which the node exposes no accessor for. The behavioural counterpart already exists
    // — nat-reachability-relay-limits.test.ts proves maxReservations is honoured against a live
    // relay — so this is a cheap tripwire on top of a real test, not a substitute for one.
    const src = readFileSync(join(SRC, "relay-node.ts"), "utf-8");
    expect(src).toMatch(/maxReservations:\s*4096/);
    expect(src).toMatch(/applyDefaultLimit:\s*false/);
  });
});
