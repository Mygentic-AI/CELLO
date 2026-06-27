/**
 * J-TRUST — CELLO-M8-TRUST-001 (DOD-SPINE-6 / DOD-TRUST-1/2), live binaries.
 *
 * The trust-signal pipe end-to-end at the daemon-pickup scope: a sealed signal seeded into the
 * directory (the hash to the identity tree, the ciphertext to the pickup queue, exactly as the portal
 * writes them) is DELIVERED to the agent's daemon on reconnect, OPENED with k_local, HASH-VERIFIED
 * against the directory anchor, STORED locally, and ACKed — after which the directory holds NO
 * ciphertext (only the hash). Stub-resistant: the ciphertext is sealed to A's real k_local pubkey, so
 * only A's daemon (a separate process holding the seed) can open it; the store assertion reads the
 * daemon's OWN encrypted SQLCipher DB (j-persist pattern).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { randomBytes, createHash } from "node:crypto";
import {
  startSpineCluster,
  startDaemon,
  connectMcp,
  cello,
  psqlSpine,
  CELLO_CLIENT_ROOT,
  type SpineCluster,
  type Proc,
  type McpConn,
} from "./live-harness.js";

type KeyedStmt = { get(...p: unknown[]): unknown };
type KeyedDb = { prepare(sql: string): KeyedStmt; close(): void };
async function openEncryptedDb(dbPath: string): Promise<KeyedDb> {
  const mod = (await import(
    pathToFileURL(join(CELLO_CLIENT_ROOT, "core/daemon/dist/sqlcipher-db.js")).href
  )) as { openEncryptedDatabaseAtPath(p: string): KeyedDb };
  return mod.openEncryptedDatabaseAtPath(dbPath);
}

// Seal + hash with the SAME local crypto build the daemon opens/verifies with.
async function loadSealer(): Promise<{
  sealToRecipient: (pub: Uint8Array, plaintext: Uint8Array) => Uint8Array;
  hash: (d: Uint8Array) => Uint8Array;
}> {
  const crypto = (await import(pathToFileURL(join(CELLO_CLIENT_ROOT, "core/crypto/dist/index.js")).href)) as {
    sealToRecipient: (pub: Uint8Array, plaintext: Uint8Array) => Uint8Array;
    hash: (d: Uint8Array) => Uint8Array;
  };
  return { sealToRecipient: crypto.sealToRecipient, hash: crypto.hash };
}

const hexToBytes = (h: string): Uint8Array => new Uint8Array(Buffer.from(h, "hex"));

let cluster: SpineCluster;
const daemons: Proc[] = [];
const dirs: string[] = [];
const mcpConns: McpConn[] = [];

beforeAll(async () => {
  cluster = await startSpineCluster({});
}, 180_000);

afterAll(async () => {
  for (const c of mcpConns) await c.close();
  for (const d of daemons) await d.stop();
  await cluster?.stop();
  for (const dir of dirs) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});

type Status = { directory_signaling?: string };
const status = (dir: string): Status => JSON.parse(cello(["status"], { CELLO_DIR: dir }).stdout) as Status;
const waitConnected = async (dir: string): Promise<void> => {
  for (let i = 0; i < 50; i++) {
    if ((status(dir).directory_signaling ?? "") === "connected") return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`directory_signaling never connected for ${dir}`);
};

describe("J-TRUST — sealed signal pickup end-to-end (CELLO-M8-TRUST-001 DOD-SPINE-6)", () => {
  it("AC-001/002: a seeded sealed signal is opened+verified+stored by the daemon; the directory then holds only the hash", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cello-trust-"));
    dirs.push(dir);
    daemons.push(await startDaemon(dir, cluster.directoryUrl, "trust"));
    const c = JSON.parse(cello(["create-agent", "tagent"], { CELLO_DIR: dir }).stdout) as { pubkey: string };
    const pubA = c.pubkey;
    await waitConnected(dir);
    expect(cello(["register", "tagent", `DEV-trust-${randomBytes(6).toString("hex")}`], { CELLO_DIR: dir }).status).toBe(0);

    const agentId = psqlSpine(`SELECT agent_id FROM agent_profiles WHERE k_local_pubkey = '${pubA}'`);
    expect(agentId, "A must have a directory agent_id after registration").toMatch(/\S/);

    // Seed the pipe AS THE PORTAL writes it: the hash → identity tree, the ciphertext → pickup queue.
    const { sealToRecipient, hash } = await loadSealer();
    const record = { type: "webauthn", credentialId: `cred-${randomBytes(4).toString("hex")}`, enrolledAt: 1700000000 };
    const jsonBytes = new TextEncoder().encode(JSON.stringify(record));
    const signalHash = Buffer.from(hash(jsonBytes)).toString("hex");
    const sealed = sealToRecipient(hexToBytes(pubA), jsonBytes);
    const sealedHex = Buffer.from(sealed).toString("hex");

    psqlSpine(
      `INSERT INTO identity_tree_entries (agent_id, signal_kind, signal_hash, updated_at) ` +
      `VALUES ('${agentId}', 'webauthn', '${signalHash}', now()) ` +
      `ON CONFLICT (agent_id, signal_kind) DO UPDATE SET signal_hash = EXCLUDED.signal_hash`,
    );
    psqlSpine(
      `INSERT INTO pickup_queue (agent_id, signal_kind, ciphertext) ` +
      `VALUES ('${agentId}', 'webauthn', decode('${sealedHex}', 'hex'))`,
    );
    expect(psqlSpine(`SELECT count(*)::int FROM pickup_queue WHERE agent_id = '${agentId}' AND acked_at IS NULL`)).toBe("1");

    // Restart the daemon so its registered agent reconnects fresh → the directory's reconnect drain
    // delivers the seeded pickup over a new authenticated stream.
    await daemons[daemons.length - 1].stop();
    const d2 = await startDaemon(dir, cluster.directoryUrl, "trust2");
    daemons.push(d2);
    // Bring the agent online (so its per-agent signaling authenticates → directory drains the pickup).
    const conn = await connectMcp(dir, "trust-A");
    mcpConns.push(conn);
    expect(((await conn.call("cello_start_agent", { name: "tagent" })) as { ok?: boolean }).ok).toBe(true);
    await waitConnected(dir);

    // The daemon (a separate process) opens with k_local, verifies the hash, stores, and ACKs.
    let got: string;
    try {
      got = await d2.waitForLine(/daemon\.trust_signal\.received/, 25_000);
    } catch (e) {
      const dirOut = cluster.directory.output.split("\n").filter((l) => /trust_signal|pickup/i.test(l)).slice(-10).join("\n");
      const dOut = d2.output.split("\n").filter((l) => /trust_signal|pickup/i.test(l)).slice(-10).join("\n");
      throw new Error(`no daemon.trust_signal.received.\n--- directory trust logs ---\n${dirOut}\n--- daemon trust logs ---\n${dOut}\n${(e as Error).message}`);
    }
    expect(got, "the daemon must receive + verify the signal").toMatch(/verified.*true|"verified":true/);

    // AC-002: after the ACK the pickup queue holds NO ciphertext for this agent; the hash anchor remains.
    let pq = "1";
    for (let i = 0; i < 20; i++) {
      pq = psqlSpine(`SELECT count(*)::int FROM pickup_queue WHERE agent_id = '${agentId}'`);
      if (pq === "0") break;
      await new Promise((r) => setTimeout(r, 250));
    }
    expect(pq, "the pickup queue must be empty after the daemon ACK").toBe("0");
    expect(psqlSpine(`SELECT signal_hash FROM identity_tree_entries WHERE agent_id = '${agentId}' AND signal_kind = 'webauthn'`)).toBe(signalHash);

    // SI-001 / store: the daemon's OWN encrypted DB holds the recovered plaintext under the hash anchor.
    const db = await openEncryptedDb(join(dir, "sessions.db"));
    try {
      const row = db
        .prepare("SELECT signal_kind, payload FROM trust_signals WHERE signal_hash = ?")
        .get(signalHash) as { signal_kind: string; payload: Uint8Array } | undefined;
      expect(row, "the daemon must have stored the verified signal").toBeDefined();
      expect(row!.signal_kind).toBe("webauthn");
      expect(JSON.parse(new TextDecoder().decode(new Uint8Array(row!.payload)))).toEqual(record);
    } finally {
      db.close();
    }

    // The plaintext credentialId is absent from the directory's pickup queue + identity tree (dump).
    const credId = record.credentialId;
    const dumpHash = createHash("sha256");
    dumpHash.update(credId);
    const treeDump = psqlSpine(`SELECT coalesce(string_agg(signal_hash, ','), '') FROM identity_tree_entries WHERE agent_id = '${agentId}'`);
    expect(treeDump).not.toContain(credId);
  }, 150_000);
});
