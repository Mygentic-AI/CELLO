/**
 * J-CONTENT — live binary content delivery (M7-DEFINITION-OF-DONE.md §"verification
 * harness", journey 5; DOD-MSG-* / MSG-001-3b).
 *
 * INCREMENT 1 — the daemon↔relay content-park TRANSPORT in isolation. A message must
 * survive the recipient being OFFLINE: the sender DEPOSITS ciphertext keyed to the
 * recipient's pubkey into the relay's store-and-forward mailbox; when the recipient comes
 * online it PULLS its parked entries (proving identity via the relay's auth challenge).
 * The relay holds CIPHERTEXT only (INV-3 — it is a hash custodian, not a data custodian).
 *
 * This increment proves the transport round-trip directly (via the daemon's content-park
 * IPC handlers, the same approach DOD-RETRY-1 used) BEFORE the send/receive-path
 * integration (increment 2: cello_send parks when B is offline; increment 3: B pulls +
 * verifies + accepts on online) and recovery/dedup (DOD-MSG-4/5).
 *
 * Anchored to the binary — see live-harness.ts. The deposit/pull cross the REAL relay binary.
 *
 * Run: pnpm --filter @cello-protocol/e2e-tests test:spine
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  startSpineCluster,
  startDaemon,
  provisionAgent,
  ipcCall,
  type SpineCluster,
  type Proc,
} from "./live-harness.js";

let cluster: SpineCluster;
const daemons: Proc[] = [];
const dirs: string[] = [];

beforeAll(async () => {
  cluster = await startSpineCluster();
}, 180_000);

afterAll(async () => {
  for (const d of daemons) await d.stop();
  await cluster?.stop();
  for (const dir of dirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
});

interface PullResult {
  ok?: boolean;
  entries?: Array<{ contentHash: string; sessionId: string; ciphertext: string }>;
}

describe("J-CONTENT — relay store-and-forward, live (DOD-MSG-3 / MSG-001-3b)", () => {
  it("DOD-MSG-3 (transport) — deposit ciphertext for an offline recipient → recipient pulls the SAME bytes", async () => {
    const dirA = mkdtempSync(join(tmpdir(), "cello-msgA-"));
    const dirB = mkdtempSync(join(tmpdir(), "cello-msgB-"));
    dirs.push(dirA, dirB);
    await provisionAgent(dirA, "agentA");
    const pubB = await provisionAgent(dirB, "agentB"); // recipient K_local (the mailbox key)
    const daemonA = await startDaemon(dirA, cluster.directoryUrl, "msgA");
    const daemonB = await startDaemon(dirB, cluster.directoryUrl, "msgB");
    daemons.push(daemonA, daemonB);

    const sessionId = randomBytes(16).toString("hex");
    const contentHash = randomBytes(32).toString("hex");
    const ciphertext = randomBytes(160).toString("hex"); // opaque to the relay (sealed in increment 2)

    // A deposits FOR B while B has never connected for content — pure store-and-forward.
    const dep = (await ipcCall(dirA, "content_park_deposit", {
      relayMultiaddr: cluster.relayMultiaddr,
      recipientPubkey: pubB,
      contentHash,
      sessionId,
      ciphertext,
    })) as { ok?: boolean; reason?: string };
    expect(dep.ok, `deposit failed: ${JSON.stringify(dep)}`).toBe(true);

    // B pulls — proving ownership of pubB via the relay's Ed25519 auth challenge.
    const pull = (await ipcCall(dirB, "content_park_pull", {
      relayMultiaddr: cluster.relayMultiaddr,
      recipientPubkey: pubB,
    })) as PullResult;
    expect(pull.ok, `pull failed: ${JSON.stringify(pull)}`).toBe(true);

    const got = (pull.entries ?? []).find((e) => e.contentHash === contentHash);
    expect(got, `B must receive the parked entry:\n${JSON.stringify(pull)}`).toBeTruthy();
    // Round-trip integrity through the real relay: B gets the EXACT bytes A deposited.
    expect(got!.ciphertext, "the recipient pulls the same ciphertext the sender deposited").toBe(ciphertext);
    expect(got!.sessionId, "the parked entry carries the session id").toBe(sessionId);

    // INV-3: the relay witnessed a deposit it could store + serve, but it only ever held
    // CIPHERTEXT — the random blob is opaque, and the relay logs byte counts, not content.
    // (The round-trip itself proves the relay received+stored+served; this is corroboration.)
    expect(cluster.relay.output).toMatch(/"event":"content\.park\.received"|content\.park\.received/);
  }, 60_000);
});
