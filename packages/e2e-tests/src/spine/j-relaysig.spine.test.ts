/**
 * J-RELAYSIG — M8B relay-signed ordering receipts (DOD-RELAYSIG-1), live binaries.
 *
 * The relay is the ordering/witness authority: it assigns a canonical sequence to each submitted
 * content-hash leaf and signs an ACK over it (PERSIST-012). DOD-RELAYSIG-1 ports the client-side receipt
 * verification + immutable store from the dead core/client into the LIVE daemon. Flow: A→B session, A sends
 * a message → the leaf hash is submitted to the relay → the relay signs the ACK → the daemon VERIFIES the
 * signature (self-consistent: the signature binds the sequence, so a forged sequence is rejected — that
 * negative is covered in the crypto unit suite) and DURABLY STORES the receipt. We then query
 * `cello receipts agentA` and assert ≥1 receipt is present with a well-formed relay_id (64-hex), a
 * sequence number, and a 64-byte signature — a stored receipt EXISTS only because verifyRelayAck passed
 * (#captureReceipt rejects-without-storing on a bad signature).
 *
 * Anchored to the binaries — real cello-directory ×3 + relay + cello-daemon/cello/cello-mcp.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import {
  startSpineCluster,
  startDaemon,
  provisionAgent,
  connectMcp,
  cello,
  registerAgent,
  writeConsortiumManifest,
  writeSignedManifestTo,
  type SpineCluster,
  type Proc,
  type McpConn,
} from "./live-harness.js";
import { spineDirectoryNode, spineNodeKeypair } from "./auth-manifest.js";
import { buildRelayAckTbs, verify } from "@cello-protocol/crypto";

const unhex = (h: string): Uint8Array => Uint8Array.from(Buffer.from(h, "hex"));

let cluster: SpineCluster;
const daemons: Proc[] = [];
const agentDirs: string[] = [];
const mcpConns: McpConn[] = [];

beforeAll(async () => {
  const holder = mkdtempSync(join(tmpdir(), "cello-relaysig-consortium-"));
  agentDirs.push(holder);
  const consortiumManifestPath = join(holder, "consortium-manifest.json");
  cluster = await startSpineCluster({
    directoryCount: 3,
    directoryNodeKeysHex: [0, 1, 2].map((i) => spineNodeKeypair(i).privateKeyHex),
    directoryConsortiumManifestPath: consortiumManifestPath,
    onDirectoryUrlsReady: (urls) => {
      writeSignedManifestTo(consortiumManifestPath, urls.map((url, i) => spineDirectoryNode(i, url)));
    },
  });
}, 300_000);

afterAll(async () => {
  for (const c of mcpConns) await c.close();
  for (const d of daemons) await d.stop();
  await cluster?.stop();
  for (const dir of agentDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
});

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe("J-RELAYSIG — relay-signed ordering receipts (DOD-RELAYSIG-1)", () => {
  it("the daemon verifies the relay's signed ACK and durably stores an immutable receipt", async () => {
    const celloDir = mkdtempSync(join(tmpdir(), "cello-relaysig-"));
    agentDirs.push(celloDir);
    await provisionAgent(celloDir, "agentA");
    const pubB = await provisionAgent(celloDir, "agentB");
    const nodes = [0, 1, 2].map((i) => spineDirectoryNode(i, cluster.directoryUrls[i]));
    const manifestEnv = writeConsortiumManifest(celloDir, "relaysig", nodes);
    const daemon = await startDaemon(celloDir, cluster.directoryUrls[0], "relaysig", { manifestEnv });
    daemons.push(daemon);
    const env = { CELLO_DIR: celloDir };

    let connected = false;
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      try {
        if ((JSON.parse(cello(["status"], env).stdout.trim()) as { directory_signaling?: string }).directory_signaling === "connected") {
          connected = true;
          break;
        }
      } catch {
        /* not JSON yet */
      }
      await sleep(250);
    }
    expect(connected, "signaling never connected").toBe(true);

    for (const name of ["agentA", "agentB"]) {
      const r = registerAgent(name, `DEV-relaysig-${name}-${randomBytes(6).toString("hex")}`, env);
      expect(r.status, `register ${name} failed: ${r.stdout}`).toBe(0);
    }

    const connA = await connectMcp(celloDir, "relaysig-A");
    mcpConns.push(connA);
    const connB = await connectMcp(celloDir, "relaysig-B");
    mcpConns.push(connB);
    for (const [conn, name] of [[connA, "agentA"], [connB, "agentB"]] as const) {
      expect(((await conn.call("cello_start_agent", { name })) as { ok?: boolean }).ok).toBe(true);
      expect(((await conn.call("cello_use_agent", { name })) as { ok?: boolean }).ok).toBe(true);
    }

    // A→B session + a message: the message-leaf hash is submitted to the relay, which signs the ACK.
    const awaitP = connB.call("cello_await_session", { timeout_ms: 25_000 });
    let init = (await connA.call("cello_initiate_session", { target_pubkey: pubB })) as { ok?: boolean; sessionId?: string; reason?: string };
    for (let i = 0; i < 20 && !init.ok && init.reason === "standing_receiver_unavailable"; i++) {
      await sleep(300);
      init = (await connA.call("cello_initiate_session", { target_pubkey: pubB })) as { ok?: boolean; sessionId?: string; reason?: string };
    }
    expect(init.ok, `initiate failed: ${JSON.stringify(init)}`).toBe(true);
    const sessionIdA = init.sessionId!;
    const inbound = (await awaitP) as { type?: string; session_id?: string };
    expect(inbound.type, `B must accept the session: ${JSON.stringify(inbound)}`).toBe("new_session");
    const sessionIdB = inbound.session_id!;

    expect(((await connA.call("cello_send", { session_id: sessionIdA, content: "relay receipt proof" })) as { ok?: boolean }).ok).toBe(true);
    expect(((await connB.call("cello_receive", { session_id: sessionIdB, timeout_ms: 15_000 })) as { content?: string | null }).content).toBe("relay receipt proof");

    // Give the relay ACK round-trip + receipt store a moment to settle.
    await sleep(1500);

    // ─── The daemon stored a VERIFIED relay receipt for A (it stores only when verifyRelayAck passes) ───
    const receiptsOut = JSON.parse(cello(["receipts", "agentA"], env).stdout.trim()) as {
      ok?: boolean;
      receipts?: Array<{ hash_hex?: string; relay_id?: string; sequence_number?: number; signature_hex?: string; session_id?: string }>;
    };
    expect(receiptsOut.ok, `cello receipts failed: ${JSON.stringify(receiptsOut)}`).toBe(true);
    const receipts = receiptsOut.receipts ?? [];
    expect(receipts.length, `daemon must have stored ≥1 verified relay receipt after the send: ${JSON.stringify(receiptsOut)}`).toBeGreaterThanOrEqual(1);
    const r0 = receipts[0] as { hash_hex: string; relay_id: string; sequence_number: number; signature_hex: string; timestamp: number };
    // Well-formed.
    expect(r0.hash_hex, `receipt hash: ${JSON.stringify(r0)}`).toMatch(/^[0-9a-f]{64}$/);
    expect(r0.relay_id, `receipt relay_id (= relay ack-signing pubkey hex): ${JSON.stringify(r0)}`).toMatch(/^[0-9a-f]{64}$/);
    expect(r0.signature_hex, `receipt signature (64-byte Ed25519): ${JSON.stringify(r0)}`).toMatch(/^[0-9a-f]{128}$/);
    expect(typeof r0.sequence_number, `receipt sequence number: ${JSON.stringify(r0)}`).toBe("number");
    // END-TO-END TEETH: independently RE-VERIFY the stored receipt's Ed25519 signature over the relay's
    // canonical TBS = SHA-256(hash || seq_BE4 || ts_BE8) against the relay_id-derived pubkey. The daemon
    // stores ONLY signature-verified receipts (#captureReceipt/evaluateRelayAck), so a genuine signature
    // here proves the daemon stored a real relay attestation — not a fabricated/garbage row.
    const tbs = buildRelayAckTbs(unhex(r0.hash_hex), r0.sequence_number, r0.timestamp);
    expect(verify(unhex(r0.relay_id), tbs, unhex(r0.signature_hex)), `the stored receipt's relay signature must re-verify: ${JSON.stringify(r0)}`).toBe(true);

    // The directory log confirms the relay actually signed (PERSIST-012) — the receipt is its attestation.
    const stored = daemon.output.split("\n").some((l) => /relay\.receipt\.stored/.test(l));
    expect(stored, "daemon must log relay.receipt.stored (a verified, durably stored receipt)").toBe(true);
  }, 240_000);
});
