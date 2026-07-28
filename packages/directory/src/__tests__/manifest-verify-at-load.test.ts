/**
 * M12 §1b — the directory VERIFIES its consortium manifest at load (DOD-AE-APPEND-1 prerequisite).
 *
 * The pre-M12 premise ("the store is only a transport; clients verify") ends here: the manifest is
 * the AE channel's trust anchor (pinned pubkeys + peerIds), so the directory itself must refuse a
 * manifest that is unsigned, under-signed, tampered, duplicated, or rolled back. Real Ed25519
 * signatures over the REAL canonicalManifestBody (RFC 8032) — no mocked crypto.
 *
 * Contract under test (verify mode):
 *  - construction: a valid threshold-signed manifest loads; tampered / under-threshold / duplicate
 *    nodeId/pubkey/peerId all throw LOUDLY (startup misconfiguration).
 *  - reload: a bad replacement (tampered or rolled-back version) is REJECTED with a cause-naming
 *    warn and the previous VERIFIED manifest stays active; a valid newer one is adopted.
 *  - transport-only mode (no verify opts) keeps the old behavior (M7 compat until every caller
 *    migrates).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ed25519 } from "@noble/curves/ed25519.js";
import { canonicalManifestBody, type ConsortiumManifestInput } from "@cello-protocol/crypto";
import { FileDirectoryManifestStore } from "../file-directory-manifest-store.js";

// Deterministic officer keys (same shape as the crypto fixture: seeds 0x01..0x03).
const OFFICER_SEEDS = [new Uint8Array(32).fill(0x01), new Uint8Array(32).fill(0x02), new Uint8Array(32).fill(0x03)];
const ROOT_KEYS = OFFICER_SEEDS.map((s) => Buffer.from(ed25519.getPublicKey(s)).toString("hex"));
const THRESHOLD = 2;

interface NodeEntry {
  nodeId: string; pubkey: string; region: string; provider: string; endpoint: string;
  role?: string; peerId?: string;
}

function makeManifest(opts?: { version?: number; nodes?: NodeEntry[]; signers?: number[] }): Record<string, unknown> {
  const nodes: NodeEntry[] = opts?.nodes ?? [
    { nodeId: "aws-use1", pubkey: "aa".repeat(32), region: "us-east-1", provider: "aws", endpoint: "https://a", role: "validator", peerId: "12D3KooWA" },
    { nodeId: "gcp-usc1", pubkey: "bb".repeat(32), region: "us-central1", provider: "gcp", endpoint: "https://b", role: "validator", peerId: "12D3KooWB" },
  ];
  const body = {
    version: opts?.version ?? 1,
    not_before: "2026-01-01T00:00:00Z",
    expires: "2027-01-01T00:00:00Z",
    nodes,
  };
  const canonical = canonicalManifestBody(body as unknown as ConsortiumManifestInput);
  const signers = opts?.signers ?? [0, 1];
  const signatures = signers.map((i) => ({
    officerIndex: i,
    signature: Buffer.from(ed25519.sign(canonical, OFFICER_SEEDS[i])).toString("hex"),
  }));
  return { ...body, signatures };
}

const logger = { info: vi.fn(), warn: vi.fn() };

describe("M12 §1b: FileDirectoryManifestStore verify-at-load", () => {
  let dir: string;
  let path: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "cello-manifest-"));
    path = join(dir, "consortium-manifest.json");
    logger.info.mockClear();
    logger.warn.mockClear();
  });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  const verify = { rootKeys: ROOT_KEYS, threshold: THRESHOLD };

  it("loads a valid threshold-signed manifest", () => {
    writeFileSync(path, JSON.stringify(makeManifest()));
    const store = new FileDirectoryManifestStore(path, logger, verify);
    expect(store.getCurrentManifest().version).toBe(1);
  });

  it("REJECTS a tampered manifest at construction (signature over different bytes)", () => {
    const m = makeManifest();
    (m.nodes as NodeEntry[])[0].pubkey = "cc".repeat(32); // tamper AFTER signing
    writeFileSync(path, JSON.stringify(m));
    expect(() => new FileDirectoryManifestStore(path, logger, verify)).toThrow(/manifest/i);
  });

  it("REJECTS an under-threshold manifest at construction (1 of 2 required)", () => {
    writeFileSync(path, JSON.stringify(makeManifest({ signers: [0] })));
    expect(() => new FileDirectoryManifestStore(path, logger, verify)).toThrow(/manifest/i);
  });

  it("REJECTS duplicate nodeId / pubkey / peerId across entries (§1c distinctness)", () => {
    const base = makeManifest().nodes as NodeEntry[]; // just for shape reference
    void base;
    const dupNode = (mut: (n: NodeEntry[]) => void): Record<string, unknown> => {
      const nodes: NodeEntry[] = [
        { nodeId: "aws-use1", pubkey: "aa".repeat(32), region: "r1", provider: "aws", endpoint: "https://a", role: "validator", peerId: "12D3KooWA" },
        { nodeId: "gcp-usc1", pubkey: "bb".repeat(32), region: "r2", provider: "gcp", endpoint: "https://b", role: "validator", peerId: "12D3KooWB" },
      ];
      mut(nodes);
      return makeManifest({ nodes });
    };
    for (const [label, m] of [
      ["nodeId", dupNode((n) => { n[1].nodeId = "aws-use1"; })],
      ["pubkey", dupNode((n) => { n[1].pubkey = "aa".repeat(32); })],
      ["peerId", dupNode((n) => { n[1].peerId = "12D3KooWA"; })],
    ] as const) {
      writeFileSync(path, JSON.stringify(m));
      expect(() => new FileDirectoryManifestStore(path, logger, verify), `dup ${label}`).toThrow(/duplicate/i);
    }
  });

  it("reload: a TAMPERED replacement is rejected, the previous VERIFIED manifest stays active, warn names the cause", () => {
    writeFileSync(path, JSON.stringify(makeManifest({ version: 1 })));
    const store = new FileDirectoryManifestStore(path, logger, verify);

    const bad = makeManifest({ version: 2 });
    (bad.nodes as NodeEntry[])[0].pubkey = "dd".repeat(32); // tamper
    writeFileSync(path, JSON.stringify(bad));

    expect(store.getCurrentManifest().version).toBe(1); // last-good stays active
    expect(logger.warn).toHaveBeenCalledWith(
      "directory.manifest.verify.failed",
      expect.objectContaining({ reason: expect.stringContaining("manifest") }),
    );
  });

  it("reload: a valid NEWER version is adopted", () => {
    writeFileSync(path, JSON.stringify(makeManifest({ version: 1 })));
    const store = new FileDirectoryManifestStore(path, logger, verify);
    writeFileSync(path, JSON.stringify(makeManifest({ version: 2 })));
    expect(store.getCurrentManifest().version).toBe(2);
  });

  it("reload: a valid but ROLLED-BACK version is rejected (anti-rollback), last-good stays", () => {
    writeFileSync(path, JSON.stringify(makeManifest({ version: 3 })));
    const store = new FileDirectoryManifestStore(path, logger, verify);
    writeFileSync(path, JSON.stringify(makeManifest({ version: 2 }))); // validly signed, older
    expect(store.getCurrentManifest().version).toBe(3);
    expect(logger.warn).toHaveBeenCalledWith(
      "directory.manifest.verify.failed",
      expect.objectContaining({ reason: expect.stringContaining("rollback") }),
    );
  });

  it("transport-only mode (no verify opts) still loads an UNSIGNED manifest (M7 compat)", () => {
    const m = makeManifest();
    (m as { signatures: unknown[] }).signatures = []; // unsigned
    writeFileSync(path, JSON.stringify(m));
    const store = new FileDirectoryManifestStore(path, logger);
    expect(store.getCurrentManifest().version).toBe(1);
  });
});
