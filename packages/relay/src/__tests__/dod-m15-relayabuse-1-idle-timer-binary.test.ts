/**
 * DOD-M15-RELAYABUSE-1 — the per-session idle timer, PROVEN FROM THE BINARY.
 *
 * M7-SESSION-001's per-session idle timer (relay-node.ts's #sessionIdleTimer* methods) has worked
 * since M7 — it was never the code. It was that `bin/relay.ts`, the production composition root,
 * never passed `sessionIdleTimeoutMs` into `createRelayNode()`. So the only thing reclaiming an idle
 * session in production was the hourly CELLO-M6B-009 sweep against its 24h default.
 *
 * A test against `relay-node.ts`'s factory function, or against `CreateRelayNodeOptions`, would
 * prove the FEATURE works and say nothing about whether the PRODUCTION BINARY passes it — which is
 * exactly the gap that shipped, and exactly the "asserted only by a comment" shape this milestone
 * exists to catch. This spawns the COMPILED `dist/bin/relay.js` (the same artifact `npm run start`
 * launches — `pnpm run typecheck` builds `dist/`, and anything launching the shipped binary runs
 * `dist/`, not source) as a real OS process, records a real session assignment over the wire, and
 * proves the relay tears the session down on its own once it goes idle — not merely that a log line
 * printed a plausible number (a config value that never reached the relay would still let that log
 * line print; behaviour is the only proof this order asked for).
 */
import { describe, it, expect, afterEach } from "vitest";
import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, createHash } from "node:crypto";
import { Encoder, decode } from "cbor-x";
import * as lp from "it-length-prefixed";
import { generateKeypair } from "@cello-protocol/crypto";
import { createNode } from "@cello-protocol/transport";
import type { Stream } from "@libp2p/interface";
import { RELAY_PROTOCOL_ID } from "../relay-node.js";
import { testOnlineToken } from "./helpers/online-token.js";

type RelayChild = ChildProcessByStdio<null, Readable, Readable>;

const RELAY_BIN = join(import.meta.dirname, "..", "..", "dist", "bin", "relay.js");
const CBOR_ENC = new Encoder({ tagUint8Array: false });
const AUTH_DOMAIN = "CELLO-RELAY-AUTH-v1";

class StreamReader {
  readonly #iter: AsyncIterator<Uint8Array>;
  constructor(stream: Stream) {
    const gen = lp.decode(stream);
    this.#iter = (gen as AsyncIterable<unknown>)[Symbol.asyncIterator]() as AsyncIterator<Uint8Array>;
  }
  async readFrame(): Promise<Uint8Array> {
    const { value, done } = await this.#iter.next();
    if (done || value === undefined) throw new Error("stream ended");
    const v = value as unknown;
    if (v instanceof Uint8Array) return v;
    if (typeof (v as { slice?: () => Uint8Array }).slice === "function") return (v as { slice(): Uint8Array }).slice();
    return new Uint8Array(v as ArrayBuffer);
  }
  async readDecoded(): Promise<Record<string, unknown>> {
    return decode(await this.readFrame()) as Record<string, unknown>;
  }
}

function sendFrame(stream: Stream, data: Uint8Array): void {
  stream.send(lp.encode.single(data));
}

/** Spawn the compiled relay binary in a throwaway local sandbox; resolve once its listen addr is known. */
function spawnRelayBinary(extraEnv: Record<string, string>): {
  child: RelayChild;
  relayAddr: Promise<string>;
  configLine: Promise<Record<string, unknown> | null>;
  cleanupDir: () => void;
} {
  const sandbox = mkdtempSync(join(tmpdir(), "cello-relay-idle-timer-test-"));
  const healthPort = 20_000 + Math.floor(Math.random() * 20_000);
  const child = spawn(process.execPath, [RELAY_BIN], {
    env: {
      ...process.env,
      CELLO_ENV: "local",
      CELLO_RELAY_KEY_FILE: join(sandbox, "relay-key"),
      CELLO_RELAY_TRANSPORT_KEY_FILE: join(sandbox, "relay-transport-key"),
      CELLO_RELAY_LISTEN_ADDR: "/ip4/127.0.0.1/tcp/0",
      CELLO_RELAY_HEALTH_PORT: String(healthPort),
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let resolveAddr: (v: string) => void;
  const relayAddr = new Promise<string>((r) => { resolveAddr = r; });
  // The structured line the binary logs declaring the idle timeout ACTUALLY IN FORCE. Captured so a
  // test can assert the DEFAULT, not merely that an env override is plumbed through.
  let resolveConfig: (v: Record<string, unknown> | null) => void;
  const configLine = new Promise<Record<string, unknown> | null>((r) => { resolveConfig = r; });
  let resolved = false;
  let configResolved = false;
  const stdoutBuf: string[] = [];
  const onData = (buf: Buffer) => {
    const text = buf.toString("utf8");
    stdoutBuf.push(text);
    if (!configResolved) {
      for (const raw of text.split("\n")) {
        if (!raw.includes("relay.config.session_idle_timeout")) continue;
        try {
          const o = JSON.parse(raw.trim()) as Record<string, unknown>;
          if (o["event"] === "relay.config.session_idle_timeout") { configResolved = true; resolveConfig(o); }
        } catch { /* interleaved non-JSON protocol log line — keep looking */ }
      }
    }
    if (resolved) return;
    // protocol-log.ts's plain-text format: "...  [RELAY] Started — peer <id>, relay <multiaddr>"
    const m = /\[RELAY\]\s+Started — peer \S+, relay (\S+)/.exec(text);
    if (m?.[1]) { resolved = true; resolveAddr(m[1]); }
  };
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);
  setTimeout(() => {
    if (!resolved) { resolved = true; resolveAddr(`__TIMEOUT__ captured output: ${stdoutBuf.join("")}`); }
    if (!configResolved) { configResolved = true; resolveConfig(null); }
  }, 15_000);

  return { child, relayAddr, configLine, cleanupDir: () => { try { rmSync(sandbox, { recursive: true, force: true }); } catch { /* best effort */ } } };
}

async function authedStream(
  node: Awaited<ReturnType<typeof createNode>>,
  relayPeerId: string,
  kp: ReturnType<typeof generateKeypair>,
  // DOD-M15-RELAYSLOTS-1: the production binary under test refuses an auth with no directory-issued
  // token, so this mints one from the same key the binary was configured with.
  dirKp: ReturnType<typeof generateKeypair>,
): Promise<{ stream: Stream; reader: StreamReader }> {
  const stream = await node.newStream(relayPeerId, RELAY_PROTOCOL_ID);
  const reader = new StreamReader(stream);
  const challenge = await reader.readDecoded();
  expect(challenge["type"]).toBe("relay_auth_challenge");
  const nonce = challenge["nonce"] as Uint8Array;
  const pubkey = await kp.getPublicKey();
  const authMsg = new Uint8Array(Buffer.concat([Buffer.from(AUTH_DOMAIN, "utf8"), nonce, pubkey]));
  const msgHash = new Uint8Array(createHash("sha256").update(authMsg).digest());
  const signature = await kp.sign(msgHash);
  sendFrame(stream, CBOR_ENC.encode({
    type: "relay_auth_response",
    pubkey,
    signature,
    online_token: await testOnlineToken(dirKp, kp),
  }));
  const ack = await reader.readDecoded();
  expect(ack["type"]).toBe("relay_auth_ok");
  return { stream, reader };
}

describe("DOD-M15-RELAYABUSE-1 — the production relay BINARY passes the idle timer", () => {
  let activeChild: RelayChild | undefined;
  let activeCleanup: (() => void) | undefined;
  let activeClientNode: Awaited<ReturnType<typeof createNode>> | undefined;

  afterEach(async () => {
    activeChild?.kill("SIGTERM");
    activeChild = undefined;
    if (activeClientNode) { try { await activeClientNode.stop(); } catch { /* cleanup */ } }
    activeClientNode = undefined;
    activeCleanup?.();
    activeCleanup = undefined;
  });

  it("precondition: dist/bin/relay.js exists (run `pnpm run typecheck` first — it builds dist/)", () => {
    expect(existsSync(RELAY_BIN), `${RELAY_BIN} is missing — build the relay package before running this test`).toBe(true);
  });

  it("★ the DEFAULT idle timeout is 24h — a reclaimer, not a conversation timeout", async () => {
    /**
     * Review gap this closes: the behavioural test below sets `RELAY_SESSION_IDLE_TIMEOUT_MS=500`,
     * so it proves the env plumbing and says NOTHING about the default. Change the default to any
     * value — including the 1 hour that was a live regression, destroying sessions of agents who
     * had merely gone quiet — and that test stays green. This pins the shipped number, with NO env
     * var set, from the running binary.
     */
    const { child, configLine, cleanupDir } = spawnRelayBinary({});
    activeChild = child;
    activeCleanup = cleanupDir;

    const line = await configLine;
    expect(line, "the binary must declare the idle timeout it is running with").not.toBeNull();
    expect(
      line!["sessionIdleTimeoutMs"],
      "24h. Lower is a conversation timeout, not a reclaimer: the teardown is not surfaced to either " +
        "agent, so a quiet pair loses its session and only finds out when the next send fails.",
    ).toBe(86_400_000);
  }, 20_000);

  it("a session recorded on the REAL BINARY is torn down on its own once idle — session_interrupted, reason timeout", async () => {
    // The directory identity is OURS in this test (not the binary's ephemeral NODE_ENV=test one) so
    // we can sign a real client-presented assignment and prove real session behaviour end to end.
    const dirKp = generateKeypair();
    const dirPubkeyHex = Buffer.from(await dirKp.getPublicKey()).toString("hex");

    const { child, relayAddr, cleanupDir } = spawnRelayBinary({
      CELLO_DIRECTORY_PUBKEY: dirPubkeyHex,
      RELAY_SESSION_IDLE_TIMEOUT_MS: "500", // short, deliberately — this test is about behaviour, not the production default
    });
    activeChild = child;
    activeCleanup = cleanupDir;

    const addr = await relayAddr;
    expect(addr.startsWith("__TIMEOUT__"), `relay binary never logged its listen address: ${addr}`).toBe(false);
    const relayPeerId = addr.split("/p2p/").pop()!;

    const clientKp = generateKeypair();
    const otherKp = generateKeypair();
    const pubA = await clientKp.getPublicKey();
    const pubB = await otherKp.getPublicKey();

    const clientNode = await createNode({ keyProvider: clientKp, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    activeClientNode = clientNode;
    await clientNode.start();
    await clientNode.dial(addr);
    const { stream, reader } = await authedStream(clientNode, relayPeerId, clientKp, dirKp);

    // Record a real session assignment over the wire — the client-presented path (Option B), the
    // one live way a session gets recorded in production.
    const sessionId = new Uint8Array(randomBytes(16));
    const sessionTimestamp = Date.now();
    const tsEncoded = sessionTimestamp > 0xffffffff ? BigInt(sessionTimestamp) : sessionTimestamp;
    const assignmentTbs = CBOR_ENC.encode([sessionId, pubA, pubB, tsEncoded]) as Uint8Array;
    const assignment_signature = await dirKp.sign(assignmentTbs);
    sendFrame(stream, CBOR_ENC.encode({
      type: "client_record_assignment",
      session_id: sessionId,
      participant_a: pubA,
      participant_b: pubB,
      session_timestamp: tsEncoded,
      assignment_signature,
    }));
    const assignmentAck = await reader.readDecoded();
    expect(assignmentAck["type"], "assignment must be accepted before the idle timer means anything").toBe("assignment_ok");

    // M7-SESSION-001 AC-002: the idle timer starts when the assignment is recorded. If
    // bin/relay.ts never passed sessionIdleTimeoutMs (the exact defect this order fixes), this
    // relay would have no timer running at all, and this read would hang past its deadline —
    // the ONLY thing that would otherwise reclaim this session is the 24h sweep.
    const interrupted = await reader.readDecoded();
    expect(interrupted["type"]).toBe("session_interrupted");
    expect(interrupted["reason"]).toBe("timeout");
  }, 20_000);
});
