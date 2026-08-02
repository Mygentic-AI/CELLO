/**
 * J-PERSIST — DOD-LOG-1 (PERSIST-LOG-001), live binaries. The durable, encrypted-at-rest,
 * readable conversation transcript survives a daemon RESTART.
 *
 * The daemon persists the hash chain (session_tree_leaves) but the readable plaintext lived only
 * in an in-memory buffer evicted on shutdown — so after a restart you had a chain of opaque hashes,
 * not a readable conversation. This test proves the new durable transcript store: A and B exchange
 * messages, B's daemon is KILLED and restarted on the same CELLO_DIR, and B reads the full
 * transcript back — sent + received, in canonical order — via cello_get_transcript. INV-3: the
 * relay and directory never saw the plaintext (only hashes/ciphertext), and it is encrypted at rest.
 *
 * Anchored to the binary — real cello-directory + cello-relay + cello-daemon + cello-mcp.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";
import {
  startSpineCluster,
  startDaemon,
  provisionAgent,
  connectMcp,
  cello,
  registerAgent,
  CELLO_CLIENT_ROOT,
  type SpineCluster,
  type Proc,
  type McpConn,
  writeSignedManifestTo,
  writeConsortiumManifest,
} from "./live-harness.js";
import { spineDirectoryNode, spineNodeKeypair } from "./auth-manifest.js";

// PERSIST-002: the daemon DB is now SQLCipher-encrypted, so the test opens it through the SAME
// keyed adapter the daemon uses (dynamic-imported from the local build the harness spawns). It reads
// `<dbPath>.key` itself. Minimal surface: prepare/all/get/close.
type KeyedStmt = { all(...p: unknown[]): unknown[]; get(...p: unknown[]): unknown };
type KeyedDb = { prepare(sql: string): KeyedStmt; close(): void };
async function openEncryptedDb(dbPath: string): Promise<KeyedDb> {
  const mod = (await import(
    pathToFileURL(join(CELLO_CLIENT_ROOT, "core/daemon/dist/sqlcipher-db.js")).href
  )) as { openEncryptedDatabaseAtPath(p: string): KeyedDb };
  return mod.openEncryptedDatabaseAtPath(dbPath);
}
import { contentHashHex } from "./content-seal-fixture.js";

let cluster: SpineCluster;
const daemons: Proc[] = [];
const dirs: string[] = [];
const mcpConns: McpConn[] = [];

beforeAll(async () => {
  // A THREE-node consortium with a signed manifest — the pattern j-content / j-unilateral use.
  // Without the DIRECTORY-side manifest the daemon never learns its own node id, so two LOCAL
  // agents are routed down the CROSS-NODE path and cello_initiate_session dies on
  // `discovery_node_unresolvable` before any clause runs. Without the CLIENT-side manifest
  // (startLocalDaemon below) registration's FROST DKG has no consortium and register-agent exits 1.
  // One node cannot satisfy the DKG threshold, hence directoryCount: 3.
  const holder = mkdtempSync(join(tmpdir(), "cello-persist-consortium-"));
  dirs.push(holder);
  const consortiumManifestPath = join(holder, "consortium-manifest.json");
  cluster = await startSpineCluster({
    directoryCount: 3,
    directoryNodeKeysHex: [0, 1, 2].map((i) => spineNodeKeypair(i).privateKeyHex),
    directoryConsortiumManifestPath: consortiumManifestPath,
    onDirectoryUrlsReady: (urls) => {
      writeSignedManifestTo(consortiumManifestPath, urls.map((url, i) => spineDirectoryNode(i, url)));
    },
  });
}, 180_000);

/**
 * A daemon that KNOWS ITS OWN NODE — which is what lets two local agents talk to each other.
 *
 * The client manifest is written OUTSIDE `CELLO_DIR`, unlike the other spine files' copies of this
 * helper. This file asserts DOD-STORE-1 — that no flat-file state exists under `CELLO_DIR`, because
 * everything must live in the encrypted store — and dropping a manifest in there breaks that
 * invariant with test scaffolding. The invariant is right; the scaffolding moves.
 */
async function startLocalDaemon(celloDir: string, label: string): Promise<Proc> {
  const nodes = [0, 1, 2].map((i) => spineDirectoryNode(i, cluster.directoryUrls[i]));
  const manifestDir = mkdtempSync(join(tmpdir(), `cello-manifest-${label}-`));
  dirs.push(manifestDir);
  return startDaemon(celloDir, cluster.directoryUrls[0], label, {
    manifestEnv: writeConsortiumManifest(manifestDir, label, nodes),
  });
}

afterAll(async () => {
  for (const c of mcpConns) await c.close();
  for (const d of daemons) await d.stop();
  await cluster?.stop();
  for (const dir of dirs) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});

type Transcript = { ok?: boolean; messages?: Array<{ sequence: number; direction: string; text: string }> };

describe("J-PERSIST — durable encrypted transcript survives restart (DOD-LOG-1)", () => {
  it("A↔B exchange → kill+restart B's daemon → B reads the full transcript back in order; relay/directory never saw plaintext", async () => {
    const dirA = mkdtempSync(join(tmpdir(), "cello-perA-"));
    const dirB = mkdtempSync(join(tmpdir(), "cello-perB-"));
    dirs.push(dirA, dirB);
    const pubB = await provisionAgent(dirB, "agentB");
    await provisionAgent(dirA, "agentA");
    const daemonA = await startLocalDaemon(dirA, "perA");
    let daemonB = await startLocalDaemon(dirB, "perB");
    daemons.push(daemonA, daemonB);
    expect(registerAgent("agentA", `DEV-per-A-${randomBytes(6).toString("hex")}`, { CELLO_DIR: dirA }).status).toBe(0);
    expect(registerAgent("agentB", `DEV-per-B-${randomBytes(6).toString("hex")}`, { CELLO_DIR: dirB }).status).toBe(0);

    const connA = await connectMcp(dirA, "per-A");
    let connB = await connectMcp(dirB, "per-B1");
    mcpConns.push(connA, connB);
    for (const [c, n] of [[connA, "agentA"], [connB, "agentB"]] as const) {
      expect(((await c.call("cello_start_agent", { name: n })) as { ok?: boolean }).ok).toBe(true);
      expect(((await c.call("cello_use_agent", { name: n })) as { ok?: boolean }).ok).toBe(true);
    }

    const awaitP = connB.call("cello_await_session", { timeout_ms: 25_000 });
    const init = (await connA.call("cello_initiate_session", { target_pubkey: pubB })) as { ok?: boolean; sessionId?: string };
    expect(init.ok, `initiate failed: ${JSON.stringify(init)}`).toBe(true);
    const sessionId = init.sessionId!;
    expect(((await awaitP) as { type?: string }).type).toBe("new_session");

    // Distinctive plaintext needles so the INV-3 check is unambiguous.
    const M1 = "PERSIST-NEEDLE-alpha hello from A";   // A → B (B: received)
    const M2 = "PERSIST-NEEDLE-bravo hi back from B"; // B → A (B: sent)
    const M3 = "PERSIST-NEEDLE-charlie second from A"; // A → B (B: received)
    expect(((await connA.call("cello_send", { cello_session_id: sessionId, content: M1, signal: "over" })) as { ok?: boolean }).ok).toBe(true);
    expect(((await connB.call("cello_receive", { cello_session_id: sessionId, timeout_ms: 15_000 })) as { content?: string | null }).content).toBe(`${M1} [[OVER]]`);
    expect(((await connB.call("cello_send", { cello_session_id: sessionId, content: M2, signal: "over" })) as { ok?: boolean }).ok).toBe(true);
    expect(((await connA.call("cello_receive", { cello_session_id: sessionId, timeout_ms: 15_000 })) as { content?: string | null }).content).toBe(`${M2} [[OVER]]`);
    expect(((await connA.call("cello_send", { cello_session_id: sessionId, content: M3, signal: "over" })) as { ok?: boolean }).ok).toBe(true);
    expect(((await connB.call("cello_receive", { cello_session_id: sessionId, timeout_ms: 15_000 })) as { content?: string | null }).content).toBe(`${M3} [[OVER]]`);

    // ── KILL B's daemon and restart it on the SAME CELLO_DIR (the in-memory buffer is gone). ──
    await connB.close();
    await daemonB.stop();
    daemonB = await startLocalDaemon(dirB, "perB-restart");
    daemons.push(daemonB);
    // startDaemon already waited for daemon.started; the transcript store is keyed by
    // (agent, session_id) independent of session status, so no interrupted-detection wait is needed.
    expect(cello(["login"], { CELLO_DIR: dirB }).status).toBe(0);
    connB = await connectMcp(dirB, "per-B2");
    mcpConns.push(connB);
    expect(((await connB.call("cello_start_agent", { name: "agentB" })) as { ok?: boolean }).ok).toBe(true);
    expect(((await connB.call("cello_use_agent", { name: "agentB" })) as { ok?: boolean }).ok).toBe(true);

    // ── The transcript is recovered from the durable, encrypted store — NOT just hashes. ──
    const tr = (await connB.call("cello_transcript", { cello_session_id: sessionId })) as Transcript;
    expect(tr.ok, `transcript read failed: ${JSON.stringify(tr)}`).toBe(true);
    const msgs = tr.messages ?? [];
    // B's transcript: received M1, sent M2, received M3 — three readable messages after a restart.
    const texts = msgs.map((m) => m.text);
    // The `[[OVER]]` suffix is part of the content, not decoration: the shim appends the turn signal
    // IN-BAND (`${content} ${token}`), so the durable row holds it and MUST — the transcript has to
    // round-trip what actually went on the wire, or the certificate and the readable history
    // disagree. These assertions predated in-band signals and compared the bare payloads.
    const withSignal = (m: string) => `${m} [[OVER]]`;
    expect(texts, `B must recover all three messages after restart:\n${JSON.stringify(msgs, null, 2)}`)
      .toEqual([M1, M2, M3].map(withSignal));
    // Direction is honest.
    expect(msgs.map((m) => m.direction)).toEqual(["received", "sent", "received"]);

    // ── JOINED TO THE HASH CHAIN (the kernel, not a loose dump): each transcript row's `sequence`
    // must be the COMMITTED leaf index of the very leaf that carries that message's content hash.
    // We read session_tree_leaves straight from the daemon's on-disk DB and cross-check by hash —
    // so an impl that keyed the transcript by a loose counter (decoupled from the Merkle chain)
    // fails here, not just a sorted-order check. ──
    // PERSIST-002: the DB is SQLCipher-encrypted, so open it through the daemon's own keyed adapter.
    const db = await openEncryptedDb(join(dirB, "sessions.db"));
    try {
      // JOIN ON agent_id, NOT agent_name (REMOVE-001 / DOD-AGENT-ID-JOINKEY-1). `agent_id` is the
      // identity; `agent_name` is a mutable display label and is not even a column on this table
      // any more — the query used to read `WHERE agent_name = ?` and now fails with
      // `no such column: agent_name`. Resolve the name through `agents`, which is the one place the
      // mapping lives, then key everything else off the id.
      const agentIdRow = db
        .prepare("SELECT agent_id FROM agents WHERE agent_name = ?")
        .get("agentB") as { agent_id: string } | undefined;
      expect(agentIdRow?.agent_id, "agentB must exist in the identity store after restart").toBeTruthy();
      const leafRows = db
        .prepare(
          `SELECT leaf_index, leaf_hash_hex FROM session_tree_leaves
           WHERE agent_id = ? AND session_id = ? AND leaf_kind = 'msg' ORDER BY leaf_index ASC`,
        )
        .all(agentIdRow!.agent_id, sessionId) as Array<{ leaf_index: number; leaf_hash_hex: string }>;
      const leafIndexByHash = new Map(leafRows.map((r) => [r.leaf_hash_hex.toLowerCase(), r.leaf_index]));
      // There is a committed msg leaf for each of the three messages.
      expect(leafRows.length, `expected 3 committed msg leaves in B's tree, saw ${leafRows.length}`).toBe(3);
      for (const m of msgs) {
        const hashHex = contentHashHex(Buffer.from(m.text)).toLowerCase();
        const committedLeafIndex = leafIndexByHash.get(hashHex);
        expect(committedLeafIndex, `transcript message "${m.text.slice(0, 12)}…" must have a committed msg leaf`).toBeDefined();
        expect(
          m.sequence,
          `transcript sequence for "${m.text.slice(0, 12)}…" must equal its COMMITTED leaf index (chain join)`,
        ).toBe(committedLeafIndex);
      }

      // ── DOD-STORE-1 (PERSIST-002): B's IDENTITY reloaded from the encrypted store after the restart
      // — its K_local seed + the FROST signing share are durably in the `agents` row (the share is
      // what lets B sign; the can't-sign-zombie fix). B already operated post-restart above (the whole
      // transcript read works), which only succeeds if the daemon loaded B's identity from the DB. ──
      const agentRow = db
        .prepare("SELECT k_local_pubkey, k_local_seed, frost_signing_share FROM agents WHERE agent_name = ?")
        .get("agentB") as { k_local_pubkey: string; k_local_seed: Uint8Array; frost_signing_share: Uint8Array | null };
      expect(agentRow, "agentB must be a row in the encrypted agents table after restart").toBeDefined();
      expect(agentRow.k_local_pubkey).toBe(pubB);
      expect(agentRow.k_local_seed?.length, "K_local seed must be the 32-byte Ed25519 seed").toBe(32);
      expect(agentRow.frost_signing_share, "the FROST share must be durably persisted (signs after restart)").not.toBeNull();
    } finally {
      db.close();
    }

    // ── INV-3: the relay + directory NEVER saw the plaintext (only hashes/ciphertext). ──
    for (const needle of [M1, M2, M3]) {
      expect(cluster.relay.output, "relay must never see plaintext").not.toContain(needle);
      expect(cluster.directory.output, "directory must never see plaintext").not.toContain(needle);
    }

    // ── DOD-STORE-1: the WHOLE daemon DB is SQLCipher-encrypted at rest — no plaintext needles AND no
    // SQLite header magic (the header itself is ciphertext) — and NO flat-file state exists under
    // CELLO_DIR (identity migrated into the DB): the only files are the DB(+wal/shm/key), lock, log,
    // sock. No agents/<name>/key, no *.json, no transcript-key. ──
    const allFiles = readdirSync(dirB, { recursive: true }).map((f) => String(f));
    const dbBytes = readFileSync(join(dirB, "sessions.db"));
    expect(dbBytes.subarray(0, 15).toString("latin1"), "the at-rest DB header must be ciphertext, not 'SQLite format 3'").not.toBe("SQLite format 3");
    for (const f of allFiles) {
      if (!/sessions\.db/.test(f)) continue;
      const raw = readFileSync(join(dirB, f)).toString("latin1");
      for (const needle of [M1, M2, M3]) {
        expect(raw, `plaintext "${needle}" must NOT appear in the at-rest DB file ${f}`).not.toContain(needle);
      }
    }
    // No flat-file identity state survived the migration.
    const offenders = allFiles.filter(
      (f) => /(^|\/)key$/.test(f) || f.endsWith(".json") || f.endsWith(".transcript-key"),
    );
    expect(offenders, `no flat-file state may exist under CELLO_DIR (DOD-STORE-1): ${offenders.join(", ")}`).toEqual([]);
  }, 150_000);
});
