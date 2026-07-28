/**
 * DOD-MULTIADDR-1 — buildBootstrapMultiaddr tests.
 *
 * The advertised bootstrap multiaddr must be CONFIGURATION, not a hardcoded
 * /dns4/{host}/tcp/80/ws template. On AWS (plain HTTP:80/ws) the defaults must reproduce the
 * pre-M12 string byte-for-byte; on GCP behind TLS the port/transport must be settable to
 * 443/wss; and an explicit override must round-trip a wss-shaped endpoint.
 */

import { describe, it, expect } from "vitest";
import { buildBootstrapMultiaddr } from "../node-registry.js";

const PEER = "12D3KooWExamplePeerId";

describe("DOD-MULTIADDR-1: buildBootstrapMultiaddr", () => {
  it("AWS back-compat: hostname + defaults reproduce the pre-M12 /tcp/80/ws string exactly", () => {
    const addr = buildBootstrapMultiaddr({ hostname: "directory-us1.cello.mygentic.ai", peerId: PEER });
    expect(addr).toBe(`/dns4/directory-us1.cello.mygentic.ai/tcp/80/ws/p2p/${PEER}`);
  });

  it("GCP+TLS: port 443 + transport wss produces a wss multiaddr", () => {
    const addr = buildBootstrapMultiaddr({
      hostname: "directory.gcp-usc1.cello.mygentic.ai",
      peerId: PEER,
      port: "443",
      transport: "wss",
    });
    expect(addr).toBe(`/dns4/directory.gcp-usc1.cello.mygentic.ai/tcp/443/wss/p2p/${PEER}`);
  });

  it("explicit override is used verbatim, with /p2p/ appended when absent", () => {
    const addr = buildBootstrapMultiaddr({
      peerId: PEER,
      explicit: "/dns4/d.example.com/tcp/443/wss",
    });
    expect(addr).toBe(`/dns4/d.example.com/tcp/443/wss/p2p/${PEER}`);
  });

  it("explicit override already carrying /p2p/ is left untouched", () => {
    const full = `/dns4/d.example.com/tcp/443/wss/p2p/${PEER}`;
    expect(buildBootstrapMultiaddr({ peerId: PEER, explicit: full })).toBe(full);
  });

  it("local dev fallback: routeable-izes 0.0.0.0 and appends /p2p/", () => {
    const addr = buildBootstrapMultiaddr({
      peerId: PEER,
      fallbackWsAddr: "/ip4/0.0.0.0/tcp/8080/ws",
    });
    expect(addr).toBe(`/ip4/127.0.0.1/tcp/8080/ws/p2p/${PEER}`);
  });

  it("returns undefined when nothing is configured (no hostname, no explicit, no fallback)", () => {
    expect(buildBootstrapMultiaddr({ peerId: PEER })).toBeUndefined();
  });

  it("rejects an unknown transport loudly (closes the domain — no silent /tcp/80/foo)", () => {
    expect(() =>
      buildBootstrapMultiaddr({ hostname: "d.example.com", peerId: PEER, transport: "wsx" }),
    ).toThrow(/transport/i);
  });

  it("an https/wss endpoint round-trips through the explicit path (the unverified-manifest question)", () => {
    // A GCP node whose manifest endpoint is https:// advertises a wss multiaddr; the explicit
    // override is exactly how that value reaches /bootstrap unchanged.
    const addr = buildBootstrapMultiaddr({
      peerId: PEER,
      explicit: "/dns4/directory.gcp-euw1.cello.mygentic.ai/tcp/443/wss",
    });
    expect(addr).toContain("/wss/");
    expect(addr).toContain(`/p2p/${PEER}`);
  });
});
