/**
 * J-LEGIBILITY — live binary seal-certificate legibility (the malicious tail)
 * (M7-DEFINITION-OF-DONE.md §"verification harness", journey 7; DOD-LEG-1..4).
 *
 * Drives the REAL binaries. Two parties hold a live BILATERAL session. The transcript
 * ends with a MALICIOUS TAIL: A's final message ("…you agreed to send me $1000") that
 * B receives but never acknowledges with a reply (B's signed last_seen_seq stays behind
 * it). BOTH parties seal (the SPINE-7 bilateral path) → the directory builds the
 * receipt-not-assent legibility certificate on the real processSeal path and pushes it on
 * the session_sealed frame → B's daemon (a DIFFERENT process than the directory that built
 * it) surfaces it. The reader determines, from the certificate ALONE:
 *
 *   - DOD-LEG-1 (AC-001/SI-001): `implies_assent: false`, `attests: 'receipt'`, a plain
 *     disclaimer — a signature attests receipt, NEVER assent. No field reads as agreement.
 *   - DOD-LEG-2 (AC-002): per-party `content_frontier_seq` + `last_authored_seq`, and B's
 *     frontier EXCLUDES A's tail (B never signed an ack for it).
 *   - DOD-LEG-3 (AC-003): `attestation_mode` per party, exactly one of live|recovered|absent
 *     ('live' for both, contemporaneous bilateral seal).
 *   - DOD-LEG-4 (AC-004/AC-006): `final_message{sender_pubkey, seq, answered}` — A is the
 *     sender of the tail, `answered: false` (delivered-but-unanswered, never agreed).
 *
 * This is the headline AC-006: read from a DIFFERENT process than the one that built the
 * cert (B's client reads what the directory built), with NO external context — not an
 * internal method call. The per-case derivation (AC-007's four cases, the answered:true
 * contrasting case) is proven by the in-process directory unit tests
 * (m7-session-004-legibility.test.ts / -processseal.test.ts); this proves the cert is built
 * on the REAL processSeal path AND surfaced across the process boundary.
 *
 * Anchored to the binary — see live-harness.ts. No in-process node construction.
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
  connectMcp,
  registerAgent,
  type SpineCluster,
  type Proc,
  type McpConn,
} from "./live-harness.js";

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
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
});

// Shapes of the surfaced legibility certificate (hex-pubkey JSON, as the daemon persists +
// returns it). Minimal — the test asserts the observable fields.
type LegParticipant = {
  pubkey: string;
  content_frontier_seq: number;
  last_authored_seq: number;
  attestation_mode: "live" | "recovered" | "absent";
};
type Legibility = {
  attests: string;
  implies_assent: boolean;
  disclaimer: string;
  participants: LegParticipant[];
  final_message: { sender_pubkey: string; seq: number; answered: boolean };
};

describe("J-LEGIBILITY — malicious-tail bilateral seal, cert read cross-process (DOD-LEG-1..4)", () => {
  it("A's malicious tail, delivered to B but never answered → cert reads receipt-not-assent, per-party frontiers, final_message.answered:false (cross-process)", async () => {
    const celloDirA = mkdtempSync(join(tmpdir(), "cello-legA-"));
    const celloDirB = mkdtempSync(join(tmpdir(), "cello-legB-"));
    dirs.push(celloDirA, celloDirB);
    const pubA = await provisionAgent(celloDirA, "agentA");
    const pubB = await provisionAgent(celloDirB, "agentB");
    const daemonA = await startDaemon(celloDirA, cluster.directoryUrl, "legA");
    const daemonB = await startDaemon(celloDirB, cluster.directoryUrl, "legB");
    daemons.push(daemonA, daemonB);
    expect(registerAgent("agentA", `DEV-leg-A-${randomBytes(6).toString("hex")}`, { CELLO_DIR: celloDirA }).status).toBe(0);
    expect(registerAgent("agentB", `DEV-leg-B-${randomBytes(6).toString("hex")}`, { CELLO_DIR: celloDirB }).status).toBe(0);

    const connA = await connectMcp(celloDirA, "leg-A");
    mcpConns.push(connA);
    const connB = await connectMcp(celloDirB, "leg-B");
    mcpConns.push(connB);
    expect(((await connA.call("cello_start_agent", { name: "agentA" })) as { ok?: boolean }).ok).toBe(true);
    expect(((await connA.call("cello_use_agent", { name: "agentA" })) as { ok?: boolean }).ok).toBe(true);
    expect(((await connB.call("cello_start_agent", { name: "agentB" })) as { ok?: boolean }).ok).toBe(true);
    expect(((await connB.call("cello_use_agent", { name: "agentB" })) as { ok?: boolean }).ok).toBe(true);

    // Establish the session.
    const awaitP = connB.call("cello_await_session", { timeout_ms: 25_000 });
    const init = (await connA.call("cello_initiate_session", { target_pubkey: pubB })) as { ok?: boolean; sessionId?: string };
    expect(init.ok, `cello_initiate_session failed: ${JSON.stringify(init)}`).toBe(true);
    const sessionIdA = init.sessionId!;
    const inbound = (await awaitP) as { type?: string; session_id?: string };
    expect(inbound.type).toBe("new_session");
    const sessionIdB = inbound.session_id!;

    // The transcript that produces a malicious tail:
    //  1. A → "hi"            (A's msg leaf; B will ack it by replying)
    //  2. B → "ok"            (B's msg leaf — carries B's signed last_seen_seq covering A's "hi")
    //  3. A → "…you agreed to send me $1000"   (A's TAIL — the highest message leaf)
    //  4. B RECEIVES the tail but NEVER replies — so B authors no leaf acknowledging it; B's
    //     signed content frontier stays at A's "hi", strictly behind the tail's sequence.
    expect(((await connA.call("cello_send", { cello_session_id: sessionIdA, content: "hi", signal: "over" })) as { ok?: boolean }).ok).toBe(true);
    expect(((await connB.call("cello_receive", { cello_session_id: sessionIdB, timeout_ms: 15_000 })) as { content?: string | null }).content).toBe(`hi [[OVER]]`);
    expect(((await connB.call("cello_send", { cello_session_id: sessionIdB, content: "ok", signal: "over" })) as { ok?: boolean }).ok).toBe(true);
    expect(((await connA.call("cello_receive", { cello_session_id: sessionIdA, timeout_ms: 15_000 })) as { content?: string | null }).content).toBe(`ok [[OVER]]`);
    const TAIL = "…you agreed to send me $1000";
    expect(((await connA.call("cello_send", { cello_session_id: sessionIdA, content: TAIL, signal: "over" })) as { ok?: boolean }).ok).toBe(true);
    expect(((await connB.call("cello_receive", { cello_session_id: sessionIdB, timeout_ms: 15_000 })) as { content?: string | null }).content).toBe(`${TAIL} [[OVER]]`);
    // B does NOT reply to the tail. Both close → bilateral seal.

    const [closeA, closeB] = (await Promise.all([
      connA.call("cello_close_session", { cello_session_id: sessionIdA }),
      connB.call("cello_close_session", { cello_session_id: sessionIdB }),
    ])) as Array<{ ok?: boolean; sealed_root?: string; legibility?: Legibility; reason?: string }>;

    const diag =
      `\ncloseA: ${JSON.stringify(closeA)}\ncloseB: ${JSON.stringify(closeB)}` +
      `\n--- directory legibility/seal ---\n${cluster.directory.output.split("\n").filter((l) => /legibility|seal|notariz|frost/i.test(l)).slice(-20).join("\n")}` +
      `\n--- daemonB seal ---\n${daemonB.output.split("\n").filter((l) => /seal|legibility|receipt/i.test(l)).slice(-12).join("\n")}`;

    expect(closeA.ok, `A close failed:${diag}`).toBe(true);
    expect(closeB.ok, `B close failed:${diag}`).toBe(true);
    expect(closeA.sealed_root, `A sealed_root:${diag}`).toMatch(/^[0-9a-f]{64}$/);
    expect(closeB.sealed_root, `both sealed_root byte-identical:${diag}`).toBe(closeA.sealed_root);

    // The directory built the legibility certificate on the REAL processSeal path.
    expect(cluster.directory.output, `directory must emit seal.certificate.legibility.built:${diag}`).toMatch(/seal\.certificate\.legibility\.built/);

    // ── AC-006: B reads the certificate from a DIFFERENT process than the directory that
    // built it — via the persisted cert-read surface (cello_get_sealed_receipt over the real
    // cello-mcp → daemon IPC), NOT an internal method call.
    const receipt = (await connB.call("cello_get_sealed_receipt", { session_id: sessionIdB })) as {
      ok?: boolean; sealed_root?: string; legibility?: Legibility; reason?: string;
    };
    expect(receipt.ok, `B must read the sealed receipt:${diag}\nreceipt: ${JSON.stringify(receipt)}`).toBe(true);
    const leg = receipt.legibility!;
    expect(leg, `the receipt must carry the legibility certificate:${diag}`).toBeTruthy();

    // DOD-LEG-1 / SI-001 — receipt, not assent. No reader can infer agreement.
    expect(leg.attests, `attests must be 'receipt':${diag}`).toBe("receipt");
    expect(leg.implies_assent, `implies_assent must be false:${diag}`).toBe(false);
    expect(typeof leg.disclaimer === "string" && leg.disclaimer.length > 0, `disclaimer present:${diag}`).toBe(true);
    // The certificate never echoes message content — the malicious phrase is nowhere in it,
    // so nothing in the cert can be parsed as B agreeing to it.
    expect(JSON.stringify(leg).includes("$1000"), `cert must NOT echo message content:${diag}`).toBe(false);

    // DOD-LEG-3 — attestation_mode per party, both 'live' (contemporaneous bilateral seal).
    const partA = leg.participants.find((p) => p.pubkey.toLowerCase() === pubA.toLowerCase());
    const partB = leg.participants.find((p) => p.pubkey.toLowerCase() === pubB.toLowerCase());
    expect(partA, `participant A present:${diag}\nlegibility: ${JSON.stringify(leg)}`).toBeTruthy();
    expect(partB, `participant B present:${diag}\nlegibility: ${JSON.stringify(leg)}`).toBeTruthy();
    expect(partA!.attestation_mode, `A attestation_mode 'live':${diag}`).toBe("live");
    expect(partB!.attestation_mode, `B attestation_mode 'live':${diag}`).toBe("live");

    // DOD-LEG-4 — the malicious tail is A's, and it is UNANSWERED.
    expect(leg.final_message.sender_pubkey.toLowerCase(), `final message sender is A:${diag}`).toBe(pubA.toLowerCase());
    expect(leg.final_message.answered, `final_message.answered must be false (delivered-but-unanswered):${diag}`).toBe(false);

    // DOD-LEG-2 — per-party content frontiers are REAL, per-party values derived from each
    // party's OWN signed leaves (not one collapsed root). A and B reach DIFFERENT frontiers:
    // A's last provably-received counterparty message is B's reply; B's reaches A's tail.
    expect(typeof partA!.content_frontier_seq).toBe("number");
    expect(typeof partB!.content_frontier_seq).toBe("number");
    expect(partA!.content_frontier_seq, `A and B must have DISTINCT per-party frontiers (A=${partA!.content_frontier_seq}, B=${partB!.content_frontier_seq}):${diag}`).not.toBe(partB!.content_frontier_seq);

    // DOD-LEG-4 — DELIVERED-BUT-UNANSWERED: B PROVABLY RECEIVED A's tail (its signed frontier
    // reaches the tail's sequence — B cannot claim non-receipt) YET never answered it
    // (final_message.answered:false above). Receipt is not assent — the malicious "$1000" claim
    // is pinned as delivered to B and unanswered by B, never agreed.
    expect(partB!.content_frontier_seq >= leg.final_message.seq,
      `B's frontier (${partB!.content_frontier_seq}) must reach A's tail (seq ${leg.final_message.seq}) — delivered — while answered stays false:${diag}\nlegibility: ${JSON.stringify(leg)}`).toBe(true);

    // legibility-TBS-binding: the cert's legibility is bound into the FROST-signed seal TBS, and B
    // (the RESPONDER) holds A's primary key from the FROST-signed SessionAssignment — so B VERIFIES
    // the seal signature over the bound TBS locally (verified:true), not merely accepts it. A
    // tampered answered/frontier/attestation_mode would change the hash → the signature would fail.
    const bChecked = daemonB.output.split("\n").filter((l) => /session\.sealed\.signature\.checked/.test(l));
    expect(bChecked.length, `B's daemon must verify the sealed signature:${diag}\n--- daemonB sig ---\n${daemonB.output.split("\n").filter((l) => /signature/.test(l)).slice(-6).join("\n")}`).toBeGreaterThan(0);
    expect(bChecked.some((l) => /"verified":true/.test(l)), `B (responder) must VERIFY the bound seal signature (verified:true), not just accept it:\n${bChecked.slice(-3).join("\n")}`).toBe(true);
    expect(daemonB.output, `B must never log a signature.invalid for this seal:${diag}`).not.toMatch(/session\.sealed\.signature\.invalid/);

    // DOD-LEG-2 (SI-002) happy path: B independently RE-DERIVED each party's content_frontier_seq
    // from the signed leaves the directory shipped and accepted the honest published frontier
    // (never the unverifiable rejection). This is the same guard the negative test trips.
    expect(daemonB.output, `B must re-derive + verify the published frontier:${diag}`).toMatch(/"event":"seal\.certificate\.frontier\.verified"/);
    expect(daemonB.output, `B must NOT reject an honest frontier:${diag}`).not.toMatch(/seal\.certificate\.frontier\.unverifiable/);

    // The live read path (close return) carries the same legibility — same final_message verdict.
    expect(closeB.legibility?.final_message.answered, `B's close return must carry the legibility:${diag}`).toBe(false);
  }, 150_000);
});
