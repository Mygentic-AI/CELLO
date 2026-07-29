/**
 * M12 — two defects the live GCP consortium surfaced, both invisible locally.
 *
 * 1. `endpoint` is the HTTP base, NOT the libp2p address. On AWS one ALB port fronts both, so
 *    deriving the dial address from `endpoint` worked by coincidence. On a node with no load
 *    balancer they are different listeners, and anti-entropy dialled the HTTP server.
 * 2. A thrown non-Error rendered as "[object Object]", so a round that could not reach a peer
 *    reported a cause that told an operator nothing.
 */

import { describe, it, expect } from "vitest";
import { manifestEntryMultiaddr, describeThrown } from "../ae-sync-service.js";

const PEER = "12D3KooWMH58hm8xpuwgwaNSvnvXBuc126jfuUMVbrGNcU2MeEAX";

describe("M12: manifestEntryMultiaddr", () => {
  it("an EXPLICIT multiaddr wins over anything derivable from the endpoint", () => {
    // The GCP case: /bootstrap is on 9090, the WS listener is on 8080. Deriving from the endpoint
    // dials the HTTP server and every round fails while manifest, endpoint and peerId are all
    // individually correct.
    expect(manifestEntryMultiaddr("http://34.75.172.108:9090", PEER, "/ip4/34.75.172.108/tcp/8080/ws"))
      .toBe(`/ip4/34.75.172.108/tcp/8080/ws/p2p/${PEER}`);
  });

  it("does not double-append /p2p when the explicit multiaddr already carries it", () => {
    const withP2p = `/ip4/34.75.172.108/tcp/8080/ws/p2p/${PEER}`;
    expect(manifestEntryMultiaddr("http://34.75.172.108:9090", PEER, withP2p)).toBe(withP2p);
  });

  it("derives from the endpoint unchanged when no multiaddr is present — AWS must not move", () => {
    expect(manifestEntryMultiaddr("https://directory-us1.cello.mygentic.ai", PEER))
      .toBe(`/dns4/directory-us1.cello.mygentic.ai/tcp/443/wss/p2p/${PEER}`);
    expect(manifestEntryMultiaddr("http://directory-us1.cello.mygentic.ai", PEER))
      .toBe(`/dns4/directory-us1.cello.mygentic.ai/tcp/80/ws/p2p/${PEER}`);
    expect(manifestEntryMultiaddr("http://127.0.0.1:4000", PEER))
      .toBe(`/ip4/127.0.0.1/tcp/4000/ws/p2p/${PEER}`);
  });
});

describe("M12: describeThrown", () => {
  it("NEVER renders a thrown object as [object Object]", () => {
    // The live symptom: antientropy.round.failed reason "[object Object]".
    for (const thrown of [{ code: "ERR_DIAL", message: "all addresses failed" }, { a: 1 }, {}]) {
      expect(describeThrown(thrown)).not.toBe("[object Object]");
      expect(describeThrown(thrown).length).toBeGreaterThan(0);
    }
  });

  it("surfaces code and message from a thrown plain object", () => {
    expect(describeThrown({ code: "ERR_DIAL", message: "all addresses failed" }))
      .toContain("ERR_DIAL");
  });

  it("unwraps an AggregateError's inner reasons — the outer message is usually generic", () => {
    const agg = new AggregateError([new Error("ECONNREFUSED 9090"), new Error("timeout")], "dial failed");
    const out = describeThrown(agg);
    expect(out).toContain("ECONNREFUSED 9090");
    expect(out).toContain("timeout");
  });

  it("keeps a plain Error's message exactly", () => {
    expect(describeThrown(new Error("boom"))).toBe("boom");
  });
});
