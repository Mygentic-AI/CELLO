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
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as relayPackage from "../index.js";

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

describe("createRelayNode's libp2p policy", () => {
  const src = readFileSync(join(SRC, "relay-node.ts"), "utf-8");

  it("gives up the authority to abort a client link on a failed keepalive ping", () => {
    // The relay owes its clients no liveness verdict — the reservation TTL does that — and one
    // slow ping over a WAN hop is not a dead peer.
    expect(src).toMatch(/connectionMonitor:\s*\{[^}]*abortConnectionOnPingFailure:\s*false/s);
  });

  it("keeps PINGING — the traffic is the keepalive against network-level reapers", () => {
    // Disabling the monitor outright would silence the only traffic on an idle relay link and
    // hand it to the first NAT conntrack table that collects idle flows.
    expect(src).not.toMatch(/connectionMonitor:\s*\{[^}]*enabled:\s*false/s);
  });

  it("still raises the reservation ceiling and drops the relayed-connection limits", () => {
    expect(src).toMatch(/maxReservations:\s*4096/);
    expect(src).toMatch(/applyDefaultLimit:\s*false/);
  });
});
