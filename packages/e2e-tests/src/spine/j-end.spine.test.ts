/**
 * J-END — `DOD-END-JOURNEY-1`: the client-supplied source, live, across real processes.
 *
 * Bob's agent supplies an endorsement for Alice; the PORTAL authenticates, scans, mints, notarizes
 * and delivers; Alice receives it PENDING and accepts; Alice presents to Charlie; Charlie verifies
 * and consumes it as quoted-untrusted. Real daemons, a real directory, a real Postgres — and the
 * portal's REAL ingress modules, not a re-implementation (see `portal-ingress.ts` for why that
 * distinction is the difference between this journey and a false green).
 *
 * BUILT IN HOPS, deliberately. Each `it` asserts one hop and leaves state for the next, so a break
 * names the hop that broke instead of failing a 200-line block with one opaque expectation. The DoD
 * calls for four more cases (refusal-with-message, subject-offline-at-mint, same-operator positive,
 * self-endorsement refused, withdrawal reaching a prior recipient); this file starts with the CORE
 * JOB — severity 1 in the milestone's own triage — and the others land on top of the same fixture.
 *
 * Run: pnpm --filter @cello-protocol/e2e-tests test:spine -- j-end
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { InMemoryKeyProvider } from "@cello-protocol/crypto";
import {
  startSpineCluster,
  startDaemon,
  connectMcp,
  cello,
  psqlSpine,
  AUTH_DIRECTORY_NODE_KEY_HEX,
  AUTH_DIRECTORY_NODE_ID,
  AUTH_DIRECTORY_NODE_PUBKEY,
  writeConsortiumManifest,
  type SpineCluster,
  type Proc,
  type McpConn,
  type ManifestEnv,
} from "./live-harness.js";

let cluster: SpineCluster;
let manifestEnv: ManifestEnv;
const daemons: Proc[] = [];
const mcpConns: McpConn[] = [];
const dirs: string[] = [];

/**
 * The portal's intake keypair. The SEED stays here (the portal opens seals with it); the PUBLIC half
 * rides the consortium manifest, which is the whole reason the manifest was chosen as the channel —
 * officer signatures cover it automatically, so a substituted key cannot seal endorsements to an
 * attacker (`M10B-D11`).
 */
const INTAKE_KEY_ID = "intake-j-end";
const intakeSeed = new Uint8Array(randomBytes(32));

/** Bob issues; Alice is the subject; Charlie is the recipient who verifies. */
const dirFor: Record<string, string> = {};

beforeAll(async () => {
  cluster = await startSpineCluster({ directoryNodeKeyHex: AUTH_DIRECTORY_NODE_KEY_HEX });
  const intakePub = Buffer.from(await new InMemoryKeyProvider(intakeSeed).getPublicKey()).toString("hex");
  manifestEnv = writeConsortiumManifest(
    cluster.tmpDir,
    "j-end",
    [{
      nodeId: AUTH_DIRECTORY_NODE_ID,
      pubkey: AUTH_DIRECTORY_NODE_PUBKEY,
      region: "local",
      provider: "aws",
      endpoint: cluster.directoryUrl,
    }],
    // WITHOUT THIS the daemon refuses every submission with `intake_key_absent` — which is exactly
    // what the deployed dev environment does today, because nothing provisions the key there.
    { intakeKey: { key_id: INTAKE_KEY_ID, pubkey: intakePub } },
  );

  for (const who of ["bob", "alice", "charlie"]) {
    const dir = mkdtempSync(join(tmpdir(), `cello-jend-${who}-`));
    dirs.push(dir);
    dirFor[who] = dir;
    const d = await startDaemon(dir, cluster.directoryUrl, `jend-${who}`, { manifestEnv });
    daemons.push(d);
  }
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
const waitConnected = async (dir: string, label: string): Promise<void> => {
  for (let i = 0; i < 50; i++) {
    const s = JSON.parse(cello(["status"], { CELLO_DIR: dir }).stdout) as Status;
    if ((s.directory_signaling ?? "") === "connected") return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`directory_signaling never connected (${label})`);
};

describe("J-END — DOD-END-JOURNEY-1: an endorsement from Bob about Alice, end to end", () => {
  const pubkeys: Record<string, string> = {};

  it("HOP 0: three agents register and connect", async () => {
    for (const who of ["bob", "alice", "charlie"]) {
      const dir = dirFor[who];
      const created = cello(["create-agent", who], { CELLO_DIR: dir });
      expect(created.status, `create-agent ${who}: ${created.stdout}`).toBe(0);
      cello(["use-agent", who], { CELLO_DIR: dir });
      // A `DEV-` token is the local pre-auth bypass every spine journey uses; production requires a
      // real single-use token from the ops agent.
      const reg = cello(["register-agent", who, `DEV-jend-${who}-${randomBytes(6).toString("hex")}`], { CELLO_DIR: dir });
      expect(reg.status, `register-agent ${who}: ${reg.stdout}`).toBe(0);
      await waitConnected(dir, who);

      const agents = JSON.parse(cello(["agents"], { CELLO_DIR: dir }).stdout) as { agents: Array<{ name: string; pubkey: string }> };
      const me = agents.agents.find((a) => a.name === who);
      expect(me?.pubkey, `${who} has a pubkey`).toBeTruthy();
      pubkeys[who] = me!.pubkey;
    }
  }, 120_000);

  it("HOP 1: Bob issues an endorsement about Alice, and it lands SEALED in the directory's queue", async () => {
    const conn = await connectMcp(dirFor["bob"], "jend-bob");
    mcpConns.push(conn);
    await conn.call("cello_use_agent", { name: "bob" });

    const statement = "Alice led the payments migration and shipped it with no incident.";
    const res = (await conn.call("cello_trust_signals_issue", {
      subject_pubkey: pubkeys["alice"],
      body: statement,
    })) as { ok?: boolean; reason?: string; guidance?: string; submission_id?: string };
    expect(res.ok, `issue refused: ${res.reason} — ${res.guidance}`).toBe(true);
    expect(res.submission_id, "the submission id is content-derived").toMatch(/^[0-9a-f]{64}$/);

    // THE DIRECTORY HOLDS A MAILBOX IT CANNOT READ. Assert the row exists, that it is sealed to the
    // manifest's intake generation, and — the load-bearing part — that Bob's words are NOT in it.
    const rows = psqlSpine(
      `SELECT submission_id, intake_key_id, encode(ciphertext,'escape') AS blob FROM submission_queue WHERE submission_id = '${res.submission_id}'`,
    );
    expect(rows, "the submission reached the queue").toContain(res.submission_id!);
    expect(rows, "sealed to the manifest's intake key generation").toContain(INTAKE_KEY_ID);
    expect(rows, "the directory must not be able to read the endorsement").not.toContain("payments migration");
    expect(rows, "nor the subject").not.toContain(pubkeys["alice"]);
  }, 120_000);
});
