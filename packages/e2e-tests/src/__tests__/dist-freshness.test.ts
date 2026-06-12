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

// dist/server.js is the MCP server module in @cello-protocol/connect — this is
// the file that registers all tool handlers. The bin (cello-mcp.js) is just a
// thin launcher that imports server.js; tool names live in server.js.
const CLIENT_DIST = resolve(root, "packages/e2e-tests/node_modules/@cello-protocol/connect/dist/server.js");

describe("dist freshness: @cello-protocol/connect", () => {
  const distContent = readFileSync(CLIENT_DIST, "utf-8");

  it("registers cello_receive (any-session)", () => {
    expect(distContent).toContain('"cello_receive"');
  });

  it("registers cello_receive_session (session-locked)", () => {
    expect(distContent).toContain('"cello_receive_session"');
  });

  it("does NOT register the deprecated cello_receive_any", () => {
    expect(distContent).not.toContain('"cello_receive_any"');
  });

  it("registers all expected tools", () => {
    // Tools present in @cello-protocol/connect@0.0.30 (the pinned e2e-tests version).
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
      "cello_receive_session",
      "cello_restore",
      "cello_send",
      "cello_status",
    ];
    for (const tool of expectedTools) {
      expect(distContent, `missing tool: ${tool}`).toContain(`"${tool}"`);
    }
  });
});
