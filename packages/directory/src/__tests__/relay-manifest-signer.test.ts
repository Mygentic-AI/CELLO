/**
 * M12 DOD-NODE-DIR-GCP-1 — the relay manifest trust anchor.
 *
 * This value decides which signatures the node will accept on the relay pool manifest, and the
 * manifest decides which relays it brokers sessions through. Getting it wrong in the permissive
 * direction would let someone else redirect every session the node arranges, so the tests below
 * care most about which way the default can fail.
 */

import { describe, it, expect } from "vitest";
import { resolveRelayManifestSigner } from "../relay-manifest-signer.js";
import type { Logger } from "@cello-protocol/interfaces";

function makeLogger(): Logger & { events: Array<{ event: string; ctx: unknown }> } {
  const events: Array<{ event: string; ctx: unknown }> = [];
  const rec = (event: string) => (ctx: unknown) => { events.push({ event, ctx }); };
  return {
    events,
    info: (e: string, c: unknown) => rec(e)(c),
    warn: (e: string, c: unknown) => rec(e)(c),
    error: (e: string, c: unknown) => rec(e)(c),
    debug: (e: string, c: unknown) => rec(e)(c),
  } as unknown as Logger & { events: Array<{ event: string; ctx: unknown }> };
}

const OWN = "ab".repeat(32);
const OTHER = "cd".repeat(32);

describe("DOD-NODE-DIR-GCP-1: resolveRelayManifestSigner", () => {
  it("an EXPLICIT value always wins — the derivation never overrides configuration", () => {
    const logger = makeLogger();
    const r = resolveRelayManifestSigner(OTHER, OWN, logger);
    expect(r).toEqual({ pubkeyHex: OTHER, source: "configured" });
    // Nothing announced: this is the ordinary path.
    expect(logger.events).toHaveLength(0);
  });

  it("derives the node's OWN key when unset, and says so", () => {
    // A derived trust anchor must never be silent — an operator reading the log has to be able to
    // tell "verifying against a key someone chose" from "verifying against my own".
    const logger = makeLogger();
    const r = resolveRelayManifestSigner(undefined, OWN, logger);
    expect(r).toEqual({ pubkeyHex: OWN, source: "derived_from_node_key" });
    expect(logger.events.map((e) => e.event)).toContain("relay.manifest.signer.derived");
  });

  it("treats a blank or whitespace value as unset rather than as an empty anchor", () => {
    // An empty string would otherwise reach RelayPoolManager as a signer key, where it can only
    // produce verification failures with a confusing cause.
    for (const blank of ["", "   ", "\n"]) {
      const r = resolveRelayManifestSigner(blank, OWN, makeLogger());
      expect(r.source).toBe("derived_from_node_key");
    }
  });

  it("trims a configured value — a trailing newline from a secret store is not a different key", () => {
    const r = resolveRelayManifestSigner(`${OTHER}\n`, OWN, makeLogger());
    expect(r).toEqual({ pubkeyHex: OTHER, source: "configured" });
  });

  it("THROWS when neither a configured value nor a usable own key exists", () => {
    // No anchor at all. A relay manifest verified against nothing is worse than no relay manifest,
    // so this must stop the boot rather than resolve to something.
    for (const bad of ["", "not-hex", "ab".repeat(16)]) {
      expect(() => resolveRelayManifestSigner(undefined, bad, makeLogger())).toThrow(
        /no trust anchor/,
      );
    }
  });

  it("the derived value can only cause REFUSAL, never acceptance of another node's manifest", () => {
    // The safety argument for defaulting at all: if this node were meant to trust a manifest
    // signed by a different node, deriving self makes it reject that manifest. There is no input
    // for which the derivation widens what the node accepts.
    const derived = resolveRelayManifestSigner(undefined, OWN, makeLogger());
    expect(derived.pubkeyHex).toBe(OWN);
    expect(derived.pubkeyHex).not.toBe(OTHER);
  });
});
