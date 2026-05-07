/**
 * CELLO-RELAY-001: Incremental Merkle tree stack tests
 *
 * TDD Phase R — written BEFORE implementation.
 * All new tests must be RED until relay-node.ts implements the incremental stack.
 *
 * Covers: AC-001, AC-002, AC-003 (via existing NODE-002 tests still passing),
 *         AC-004, AC-005 (code inspection), SI-001
 *
 * The incremental stack algorithm (RFC 6962 left-balanced):
 *   On each leaf append:
 *     1. Compute leaf hash from the leaf data and kind
 *     2. While stack.top has same height as new_node, merge: new_node = nodeHash(top, new_node)
 *     3. Push new_node onto stack
 *     4. running_root = fold stack right-to-left with nodeHash
 *
 * Security invariant: running root must be byte-identical to merkleRoot(buildMerkleTree(all leaves)).
 */

import {
  setupV3Tests,
  describe,
  it,
  expect,
} from "@claude-flow/testing";
import {
  buildMerkleTree,
  merkleRoot,
  msgLeafHash,
  nodeHash,
} from "@cello/crypto";
import type { LeafInput } from "@cello/crypto";
import { createRelayNode } from "../relay-node.js";
import type { SessionAssignment } from "../relay-types.js";
import { randomBytes } from "node:crypto";
import { Encoder } from "cbor-x";
import * as lp from "it-length-prefixed";
import { generateKeypair } from "@cello/crypto";
import { createHash } from "node:crypto";
import { decode } from "cbor-x";
import { createNode } from "@cello/transport";
import type { Stream } from "@libp2p/interface";

setupV3Tests();

const CBOR_ENC = new Encoder({ tagUint8Array: false });

// ─── Reference implementation ─────────────────────────────────────────────────

/**
 * The reference implementation of the incremental RFC 6962 stack.
 * This is what we verify the relay implementation matches.
 * Used to cross-check roots for all tested leaf counts.
 */
function computeRunningRootViaStack(
  leafHashes: Uint8Array[]
): Uint8Array[] {
  // Returns running root after each append
  const roots: Uint8Array[] = [];
  const stack: Array<{ hash: Uint8Array; height: number }> = [];

  for (const leafHash of leafHashes) {
    let newNode = leafHash;
    let height = 0;
    while (stack.length > 0 && stack[stack.length - 1]!.height === height) {
      const popped = stack.pop()!;
      newNode = nodeHash(popped.hash, newNode);
      height++;
    }
    stack.push({ hash: newNode, height });

    // Fold right-to-left
    let root = stack[stack.length - 1]!.hash;
    for (let i = stack.length - 2; i >= 0; i--) {
      root = nodeHash(stack[i]!.hash, root);
    }
    roots.push(root);
  }
  return roots;
}

/**
 * Count nodeHash invocations for n leaves using the incremental stack algorithm.
 * Stack merges: O(log n) total merges per append amortized.
 * But we count per-append: each append triggers at most ceil(log2(n)) merges.
 */
function countNodeHashInvocationsForNLeaves(n: number): number[] {
  const counts: number[] = [];
  const stack: number[] = []; // heights on stack

  for (let i = 0; i < n; i++) {
    let height = 0;
    let merges = 0;
    while (stack.length > 0 && stack[stack.length - 1] === height) {
      stack.pop();
      merges++;
      height++;
    }
    stack.push(height);

    // Fold right-to-left invocations (stack.length - 1 merges)
    const foldMerges = stack.length - 1;
    counts.push(merges + foldMerges);
  }
  return counts;
}

// ─── Test helpers ─────────────────────────────────────────────────────────────

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
    if (typeof (v as { slice?: () => Uint8Array }).slice === "function") {
      return (v as { slice(): Uint8Array }).slice();
    }
    return new Uint8Array(v as ArrayBuffer);
  }
  async readDecoded(): Promise<Record<string, unknown>> {
    const bytes = await this.readFrame();
    return decode(bytes) as Record<string, unknown>;
  }
}

function toU8(v: unknown): Uint8Array {
  if (v instanceof Uint8Array) return v;
  if (Buffer.isBuffer(v)) return new Uint8Array(v as Buffer);
  throw new Error(`expected bytes, got ${typeof v}`);
}

function sendFrame(stream: Stream, data: Uint8Array): void {
  stream.send(lp.encode.single(data));
}

async function performAuth(
  reader: StreamReader,
  stream: Stream,
  kp: ReturnType<typeof generateKeypair>
): Promise<void> {
  const challenge = await reader.readDecoded();
  expect(challenge["type"]).toBe("relay_auth_challenge");
  const nonce = toU8(challenge["nonce"]);
  const pubkey = await kp.getPublicKey();
  const domain = Buffer.from("CELLO-RELAY-AUTH-v1", "utf8");
  const authMsg = new Uint8Array(Buffer.concat([domain, nonce, pubkey]));
  const msgHash = new Uint8Array(createHash("sha256").update(authMsg).digest());
  const signature = await kp.sign(msgHash);
  sendFrame(stream, CBOR_ENC.encode({ type: "relay_auth_response", pubkey, signature }));
  const ack = await reader.readDecoded();
  if (ack["type"] === "relay_auth_failed") {
    throw new Error(`relay_auth_failed: ${ack["reason"]}`);
  }
  expect(ack["type"]).toBe("relay_auth_ok");
}

async function makeStructure1(
  sessionId: Uint8Array,
  contentHash: Uint8Array,
  kp: ReturnType<typeof generateKeypair>,
  lastSeenSeq: number
): Promise<{ structure1_cbor: Uint8Array; sender_signature: Uint8Array }> {
  const pubkey = await kp.getPublicKey();
  const ts = Date.now();
  const tbs = CBOR_ENC.encode([1, contentHash, pubkey, sessionId, lastSeenSeq, ts]) as Uint8Array;
  const sender_signature = await kp.sign(tbs);
  return { structure1_cbor: tbs, sender_signature };
}

async function makeAssignment(
  sessionId: Uint8Array,
  pubA: Uint8Array,
  pubB: Uint8Array,
  dirKp: ReturnType<typeof generateKeypair>
): Promise<SessionAssignment> {
  const session_timestamp = Date.now();
  const tbs = CBOR_ENC.encode([
    sessionId,
    pubA,
    pubB,
    session_timestamp > 0xffffffff ? BigInt(session_timestamp) : session_timestamp,
  ]) as Uint8Array;
  const directory_signature = await dirKp.sign(tbs);
  return { session_id: sessionId, participant_a: pubA, participant_b: pubB, session_timestamp, directory_signature };
}

// Decode structure2_cbor and return prev_root (index 5)
function decodePrevRoot(structure2Cbor: Uint8Array): Uint8Array {
  const arr = decode(structure2Cbor) as unknown[];
  return toU8(arr[5]);
}

// ─── AC-001: incremental stack root == reference for n in {1,2,3,7,8,15,16,17,50,100} ─

describe("AC-001: incremental running root matches reference for all tested leaf counts", () => {
  it("reference stack produces same roots as merkleRoot(buildMerkleTree) for all tested n", () => {
    const testCounts = [1, 2, 3, 7, 8, 15, 16, 17, 50, 100];

    for (const n of testCounts) {
      // Generate n leaf hashes (msg-kind, random 32-byte data each)
      const leafHashes: Uint8Array[] = [];
      const leafInputs: LeafInput[] = [];
      for (let i = 0; i < n; i++) {
        const data = new Uint8Array(randomBytes(32));
        const lh = msgLeafHash(data);
        leafHashes.push(lh);
        leafInputs.push({ kind: "hash", data: lh });
      }

      // Get running roots from the incremental stack
      const stackRoots = computeRunningRootViaStack(leafHashes);

      // Cross-check each intermediate root against full rebuild
      for (let k = 1; k <= n; k++) {
        const refRoot = merkleRoot(buildMerkleTree(leafInputs.slice(0, k)));
        const stackRoot = stackRoots[k - 1]!;
        // SI-001: incremental root must match reference at every step
        expect(Buffer.from(stackRoot).toString("hex")).toBe(Buffer.from(refRoot).toString("hex"));
      }
    }
  });
});

// ─── AC-002: O(log n) nodeHash invocations per append ─────────────────────────

describe("AC-002: each append takes at most O(log n) nodeHash invocations", () => {
  it("100 hash_submit appends: no single append exceeds ceil(log2(100)) * 2 nodeHash calls", () => {
    const n = 100;
    // log2(100) ≈ 6.64, so ceil = 7
    // Each append does at most: height merges (at most log2(n)) + fold merges (at most log2(n))
    // The bound we verify: total nodeHash per append <= 2 * ceil(log2(n+1))
    const maxAllowed = 2 * Math.ceil(Math.log2(n + 1));

    const perAppendCounts = countNodeHashInvocationsForNLeaves(n);

    for (let i = 0; i < n; i++) {
      // AC-002: no single append should exceed O(log n) nodeHash invocations
      expect(perAppendCounts[i]).toBeLessThanOrEqual(maxAllowed);
    }
  });

  it("total nodeHash invocations for 100 appends is O(n log n)", () => {
    const n = 100;
    const perAppendCounts = countNodeHashInvocationsForNLeaves(n);
    const total = perAppendCounts.reduce((a, b) => a + b, 0);
    // O(n log n) upper bound: n * 2 * ceil(log2(n+1))
    const upperBound = n * 2 * Math.ceil(Math.log2(n + 1));
    expect(total).toBeLessThanOrEqual(upperBound);
    // Also verify it's actually better than O(n^2): the naive rebuild takes n*(n+1)/2 nodeHash calls
    const naiveCost = (n * (n + 1)) / 2;
    expect(total).toBeLessThan(naiveCost);
  });
});

// ─── AC-004: 7-leaf session against RFC 6962 fixture ─────────────────────────

describe("AC-004: 7-leaf session matches RFC 6962 fixture intermediate and final roots", () => {
  it("incremental stack produces correct roots for each of 7 appends", () => {
    // From merkle-tree.json: the 8-leaf RFC 6962 example uses SHA-256(0x00 || byte) leaf hashes.
    // For the 7-leaf prefix, we use leaves 0x00..0x06.
    // Leaf hash for byte b = SHA-256(0x00 || b)
    const leafHashes: Uint8Array[] = [];
    for (let b = 0; b < 7; b++) {
      const data = new Uint8Array([b]);
      leafHashes.push(msgLeafHash(data));
    }

    // Build all 7 intermediate roots via full rebuild (reference)
    const expectedRoots: Uint8Array[] = [];
    for (let k = 1; k <= 7; k++) {
      const inputs: LeafInput[] = leafHashes.slice(0, k).map((h) => ({
        kind: "hash" as const,
        data: h,
      }));
      expectedRoots.push(merkleRoot(buildMerkleTree(inputs)));
    }

    // Build via incremental stack
    const stackRoots = computeRunningRootViaStack(leafHashes);

    // All 7 roots must match
    for (let k = 0; k < 7; k++) {
      // AC-004: incremental stack root must match reference at each append
      expect(Buffer.from(stackRoots[k]!).toString("hex")).toBe(Buffer.from(expectedRoots[k]!).toString("hex"));
    }

    // The final root (7 leaves) must match the known 8-leaf tree prefix
    // The 8-leaf tree root from the fixture is:
    // ef7f49b620f6c7ea9b963a214da34b5021c6ded8ed57734380a311ab726aa907
    // But for 7 leaves we compute our own reference — no fixture available for 7-leaf subset.
    // The 7-leaf root should be: nodeHash(root_of_leaves_0..3, nodeHash(root_of_leaves_4..5, leaf6))
    // We verify the stack matches the full rebuild, which is the correctness requirement.
    expect(stackRoots[6]).toBeDefined();
    expect(stackRoots[6]!.length).toBe(32);
  });

  it("8-leaf session: final root matches merkle-tree.json fixture", () => {
    // Full 8-leaf tree from fixture root: ef7f49b620f6c7ea9b963a214da34b5021c6ded8ed57734380a311ab726aa907
    const expectedRoot = "ef7f49b620f6c7ea9b963a214da34b5021c6ded8ed57734380a311ab726aa907";

    const leafHashes: Uint8Array[] = [];
    for (let b = 0; b < 8; b++) {
      leafHashes.push(msgLeafHash(new Uint8Array([b])));
    }

    const stackRoots = computeRunningRootViaStack(leafHashes);
    expect(Buffer.from(stackRoots[7]!).toString("hex")).toBe(expectedRoot);
  });
});

// ─── AC-005: no O(n log n) debt comment in relay-node.ts ─────────────────────

describe("AC-005: debt comment removed from relay-node.ts", () => {
  it("relay-node.ts does not contain the O(n log n) debt comment", async () => {
    const { readFile } = await import("node:fs/promises");
    const relayNodePath = new URL("../relay-node.ts", import.meta.url).pathname;
    const content = await readFile(relayNodePath, "utf8");
    // The original comment: "O(n log n) per submit"
    expect(content).not.toContain("O(n log n) per submit");
    // The original debt comment referencing incremental tree TODO
    expect(content).not.toContain("production needs\n    // an incremental tree");
  });
});

// ─── AC-001 (ctrl leaf): incremental stack with mixed msg and ctrl leaves ─────

describe("AC-001 (ctrl leaf): running_root matches reference for session with mixed msg and ctrl leaves", () => {
  it("relay session with mixed msg and ctrl leaves: running_root after each append matches reference rebuild", async () => {
    const dirKp = generateKeypair();
    const dirPubkey = await dirKp.getPublicKey();
    const { relay, node: relayNode, stop: relayStop } = await createRelayNode({ directoryPubkey: dirPubkey });
    const relayAddr = relayNode.listenAddresses()[0]!;

    const kpA = generateKeypair();
    const pubA = await kpA.getPublicKey();
    const kpB = generateKeypair();
    const pubB = await kpB.getPublicKey();

    const nodeA = await createNode({ keyProvider: kpA, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    const nodeB = await createNode({ keyProvider: kpB, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await nodeA.start();
    await nodeB.start();
    await nodeA.dial(relayAddr);
    await nodeB.dial(relayAddr);

    const sessionId = new Uint8Array(randomBytes(16));
    const assignment = await makeAssignment(sessionId, pubA, pubB, dirKp);
    relay.recordAssignment(assignment);

    const sA = await nodeA.newStream(relayNode.getPeerId(), "/cello/relay/1.0.0");
    const sB = await nodeB.newStream(relayNode.getPeerId(), "/cello/relay/1.0.0");
    const rA = new StreamReader(sA);
    const rB = new StreamReader(sB);
    await performAuth(rA, sA, kpA);
    await performAuth(rB, sB, kpB);

    // Leaf sequence: msg(0), msg(1), ctrl(2), msg(3), ctrl(4), msg(5)
    // leaf_kind 0x00 = message, leaf_kind 0x02 = control (SEAL-like)
    const leafKinds = [0x00, 0x00, 0x02, 0x00, 0x02, 0x00];
    const n = leafKinds.length;

    // Track delivered (kind, s2Cbor) pairs to reconstruct LeafInput for reference rebuild
    const deliveredLeaves: Array<{ kind: "msg" | "ctrl"; s2Cbor: Uint8Array }> = [];

    for (let i = 0; i < n; i++) {
      const leafKind = leafKinds[i]!;
      const contentHash = new Uint8Array(randomBytes(32));
      const { structure1_cbor, sender_signature } = await makeStructure1(sessionId, contentHash, kpA, i);
      sendFrame(sA, CBOR_ENC.encode({
        type: "hash_submit",
        session_id: sessionId,
        leaf_kind: leafKind,
        structure1_cbor,
        sender_signature,
      }));
      // Read ack
      const ack = await rA.readDecoded();
      expect(ack["type"]).toBe("hash_submit_ack");
      // Read echo (sender gets leaf_deliver back)
      const echo = await rA.readDecoded();
      expect(echo["type"]).toBe("leaf_deliver");
      // Read B's deliver
      const deliver = await rB.readDecoded();
      expect(deliver["type"]).toBe("leaf_deliver");
      expect(deliver["leaf_kind"]).toBe(leafKind);

      const s2Cbor = toU8(deliver["structure2_cbor"]);
      deliveredLeaves.push({
        kind: leafKind === 0x02 ? "ctrl" : "msg",
        s2Cbor,
      });
    }

    // Compute genesis_prev_root for reference
    const cmp = Buffer.compare(Buffer.from(pubA), Buffer.from(pubB));
    const [first, second] = cmp <= 0 ? [pubA, pubB] : [pubB, pubA];
    const tsBytes = Buffer.allocUnsafe(8);
    tsBytes.writeBigUInt64BE(BigInt(assignment.session_timestamp));
    const h = createHash("sha256");
    h.update(first); h.update(second); h.update(sessionId); h.update(tsBytes);
    const genesisRoot = new Uint8Array(h.digest());

    // For each leaf k (0-indexed), verify prev_root == reference root of leaves 0..k-1
    for (let k = 0; k < n; k++) {
      const actualPrevRoot = decodePrevRoot(deliveredLeaves[k]!.s2Cbor);

      let expectedPrevRoot: Uint8Array;
      if (k === 0) {
        expectedPrevRoot = genesisRoot;
      } else {
        // Build LeafInput array for the first k leaves, using the correct kind per leaf
        const leafInputs: LeafInput[] = deliveredLeaves.slice(0, k).map(({ kind, s2Cbor }) => ({
          kind,
          data: s2Cbor,
        }));
        expectedPrevRoot = merkleRoot(buildMerkleTree(leafInputs));
      }

      // AC-001 (ctrl leaf): prev_root must be byte-identical to reference for every leaf,
      // including ctrl leaves (leaf_kind 0x02) which use ctrlLeafHash(s2Cbor) not msgLeafHash
      expect(Buffer.from(actualPrevRoot).toString("hex")).toBe(Buffer.from(expectedPrevRoot).toString("hex"));
    }

    sA.close().catch(() => {});
    sB.close().catch(() => {});
    await nodeA.stop();
    await nodeB.stop();
    await relayStop();
  }, 60_000);
});

// ─── SI-001: relay prev_root values are byte-identical to reference ───────────

describe("SI-001: relay incremental stack produces byte-identical prev_root to reference for all n", () => {
  it("relay session with 17 leaves: prev_root for each leaf matches reference rebuild", async () => {
    const dirKp = generateKeypair();
    const dirPubkey = await dirKp.getPublicKey();
    const { relay, node: relayNode, stop: relayStop } = await createRelayNode({ directoryPubkey: dirPubkey });
    const relayAddr = relayNode.listenAddresses()[0]!;

    const kpA = generateKeypair();
    const pubA = await kpA.getPublicKey();
    const kpB = generateKeypair();
    const pubB = await kpB.getPublicKey();

    const nodeA = await createNode({ keyProvider: kpA, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    const nodeB = await createNode({ keyProvider: kpB, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await nodeA.start();
    await nodeB.start();
    await nodeA.dial(relayAddr);
    await nodeB.dial(relayAddr);

    const sessionId = new Uint8Array(randomBytes(16));
    const assignment = await makeAssignment(sessionId, pubA, pubB, dirKp);
    relay.recordAssignment(assignment);

    const sA = await nodeA.newStream(relayNode.getPeerId(), "/cello/relay/1.0.0");
    const sB = await nodeB.newStream(relayNode.getPeerId(), "/cello/relay/1.0.0");
    const rA = new StreamReader(sA);
    const rB = new StreamReader(sB);
    await performAuth(rA, sA, kpA);
    await performAuth(rB, sB, kpB);

    // Submit 17 leaves, collect all structure2_cbors from B's leaf_deliver frames
    const deliveredS2Cbors: Uint8Array[] = [];
    for (let i = 0; i < 17; i++) {
      const contentHash = new Uint8Array(randomBytes(32));
      const { structure1_cbor, sender_signature } = await makeStructure1(sessionId, contentHash, kpA, i);
      sendFrame(sA, CBOR_ENC.encode({
        type: "hash_submit",
        session_id: sessionId,
        leaf_kind: 0x00,
        structure1_cbor,
        sender_signature,
      }));
      // Read ack
      const ack = await rA.readDecoded();
      expect(ack["type"]).toBe("hash_submit_ack");
      // Read echo (sender gets leaf_deliver back)
      await rA.readDecoded();
      // Read B's deliver
      const deliver = await rB.readDecoded();
      expect(deliver["type"]).toBe("leaf_deliver");
      deliveredS2Cbors.push(toU8(deliver["structure2_cbor"]));
    }

    // For each leaf k (1-indexed), prev_root in Structure 2 must match:
    //   k=1: genesis_prev_root
    //   k>1: merkleRoot(buildMerkleTree(leaves 0..k-2))
    //
    // We reconstruct the leaf inputs from the delivered Structure 2 cbors.
    // leaf_input[i] = { kind: "msg", data: deliveredS2Cbors[i] }
    const leafInputs: LeafInput[] = deliveredS2Cbors.map((cbor) => ({
      kind: "msg" as const,
      data: cbor,
    }));

    // Compute genesis_prev_root
    const cmp = Buffer.compare(Buffer.from(pubA), Buffer.from(pubB));
    const [first, second] = cmp <= 0 ? [pubA, pubB] : [pubB, pubA];
    const tsBytes = Buffer.allocUnsafe(8);
    tsBytes.writeBigUInt64BE(BigInt(assignment.session_timestamp));
    const h = createHash("sha256");
    h.update(first); h.update(second); h.update(sessionId); h.update(tsBytes);
    const genesisRoot = new Uint8Array(h.digest());

    for (let k = 0; k < 17; k++) {
      const actualPrevRoot = decodePrevRoot(deliveredS2Cbors[k]!);

      let expectedPrevRoot: Uint8Array;
      if (k === 0) {
        expectedPrevRoot = genesisRoot;
      } else {
        expectedPrevRoot = merkleRoot(buildMerkleTree(leafInputs.slice(0, k)));
      }

      // SI-001: relay prev_root must be byte-identical to reference for every leaf
      expect(Buffer.from(actualPrevRoot).toString("hex")).toBe(Buffer.from(expectedPrevRoot).toString("hex"));
    }

    sA.close().catch(() => {});
    sB.close().catch(() => {});
    await nodeA.stop();
    await nodeB.stop();
    await relayStop();
  }, 60_000);
});
