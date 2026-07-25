/**
 * Dist freshness gate — verifies compiled artifacts match source expectations.
 *
 * These imports resolve through each package's "exports" field in package.json,
 * which points to dist/. If dist is stale (not rebuilt after source changes),
 * these tests fail — catching the class of bug where vitest passes (transpiles
 * source on the fly) but agents see outdated tool registrations.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../../../..");

// WAS dist/server.js, and that file NO LONGER SHIPS.
//
// The comment here used to say "the bin is just a thin launcher that imports
// server.js; tool names live in server.js". Both halves stopped being true when
// the client moved to the daemon/IPC shape: `server.js` was removed from the
// package, and tool registration now lives in `ipc-proxy.js`. The suite kept
// asserting against a path that does not exist, so `readFileSync` threw at
// collection — FOUR failing suites in the gate, none of them reporting a failed
// test, which is the shape people learn to scroll past.
//
// Verified against the INSTALLED package (connect@0.0.71), not against source
// and not by reasoning about names: counting QUOTED tool literals per file gives
// bin/cello-mcp.js 33, ipc-proxy.js 1 ("cello_use_agent") and channel-params.js
// 3 (the channel event names). The bin is the registration site now — retarget
// it there, and note that "the bin is just a thin launcher" is exactly the kind
// of comment that outlives the thing it described.
//
// An unquoted grep pointed at ipc-proxy.js first; the tool names appear there
// only in prose. Matching on `"name"` is the difference between a mention and a
// registration, which is the whole point of reading the artifact.
const CLIENT_DIST = resolve(
  root,
  "packages/e2e-tests/node_modules/@cello-protocol/connect/dist/bin/cello-mcp.js",
);

describe("dist freshness: @cello-protocol/connect", () => {
  const distContent = readFileSync(CLIENT_DIST, "utf-8");

  it("registers cello_receive (any-session)", () => {
    expect(distContent).toContain('"cello_receive"');
  });

  it("no longer registers cello_receive_session — it was REMOVED, not renamed", () => {
    // This assertion used to require the tool. connect@0.0.71 ships exactly one
    // receive tool, `cello_receive`, and does not mention `cello_receive_session`
    // anywhere in the bin. Flipped rather than deleted: a removed tool that
    // reappears is a regression somebody should hear about, and dropping the
    // line silently would have left nothing watching for it.
    expect(distContent).not.toContain('"cello_receive_session"');
  });

  it("does NOT register the deprecated cello_receive_any", () => {
    expect(distContent).not.toContain('"cello_receive_any"');
  });

  it("registers all expected tools", () => {
    // Tools present in @cello-protocol/connect@0.0.71 (the pinned e2e-tests version).
    // Update this list whenever the pinned version is bumped and new tools are added.
    const expectedTools = [
      "cello_await_session",
      "cello_backup",
      "cello_close_session",
      "cello_get_inclusion_proof",
      "cello_get_sealed_receipt",
      "cello_initiate_session",
      "cello_list_sessions",
      "cello_receive",
      "cello_restore",
      "cello_send",
      "cello_status",
    ];
    for (const tool of expectedTools) {
      expect(distContent, `missing tool: ${tool}`).toContain(`"${tool}"`);
    }
  });
});
