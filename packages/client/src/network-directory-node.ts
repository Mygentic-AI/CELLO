/**
 * NetworkDirectoryNode — DirectoryNodeStub backed by a real libp2p connection.
 *
 * Implements the DirectoryNodeStub interface by dialing the directory node's
 * /cello/frost/1.0.0 endpoint. Used in live e2e mode instead of InProcessDirectoryNodeStub.
 *
 * Wire protocol (one stream per operation, CBOR + it-length-prefixed):
 *   frost_bootstrap:      push share material to directory (called from bootstrapKeyShares)
 *   frost_commit_request: ask directory to generate a nonce commitment
 *   frost_sign_request:   ask directory to compute a partial signature
 */

import { Encoder, decode as cborDecode } from "cbor-x";
import * as lp from "it-length-prefixed";
import { ed25519_FROST, FrostThresholdSigner } from "@cello-protocol/crypto";
import { bootstrapKeyShares, storeDkgResult } from "@cello-protocol/crypto/frost/frost-threshold-signer.js";
import type { CelloNode } from "@cello-protocol/transport";
import type {
  DirectoryNodeStub,
  StubCommitment,
  StubSignParams,
  BootstrapResult,
} from "@cello-protocol/crypto/frost/types.js";
import type {
  DkgRound1Broadcast,
  DkgRound2Share,
  FrostDkgRound1Response,
  FrostDkgRound2Response,
  FrostDkgRound3Response,
} from "@cello-protocol/protocol-types";

const FROST_PROTOCOL_ID = "/cello/frost/1.0.0";
const CBOR_ENC = new Encoder({ tagUint8Array: false });

// ─── NetworkDirectoryNode ─────────────────────────────────────────────────────

export class NetworkDirectoryNode implements DirectoryNodeStub {
  readonly id: string;

  readonly #node: CelloNode;
  readonly #directoryPeerId: string;
  readonly #directoryMultiaddrs: string[];

  // Set during bootstrapKeyShares — used to identify which agent's share to retrieve
  #agentPubkeyHex: string | null = null;
  #epochId: string | null = null;

  // Stored during receiveShare — used by tests to get the FrostPublic for signRound calls
  #lastPub: Parameters<DirectoryNodeStub["receiveShare"]>[1] | null = null;

  constructor(opts: {
    id: string;
    node: CelloNode;
    directoryPeerId: string;
    directoryMultiaddrs: string[];
  }) {
    this.id = opts.id;
    this.#node = opts.node;
    this.#directoryPeerId = opts.directoryPeerId;
    this.#directoryMultiaddrs = opts.directoryMultiaddrs;
  }

  isReachable(): boolean {
    // For the network path, optimistically return true at pre-ceremony check time.
    // Actual reachability is discovered during generateCommitment/signRound.
    return true;
  }

  /** Return the FrostPublic from the last receiveShare call. Used by tests to construct signRound params. */
  getLastPub(): Parameters<DirectoryNodeStub["receiveShare"]>[1] | null {
    return this.#lastPub;
  }

  async receiveShare(...[secret, pub]: Parameters<DirectoryNodeStub["receiveShare"]>): Promise<void> {
    this.#lastPub = pub;
    if (!this.#agentPubkeyHex || !this.#epochId) {
      throw new Error("NetworkDirectoryNode: setBootstrapContext must be called before receiveShare");
    }

    // Serialize FrostSecret: { identifier, signingShare }
    const secretSerialized = {
      identifier: (secret as unknown as { identifier: string }).identifier,
      signingShare: (secret as unknown as { signingShare: Uint8Array }).signingShare,
    };

    // Serialize FrostPublic: { signers, commitments[], verifyingShares{} }
    const pubSerialized = {
      signers: (pub as unknown as { signers: { min: number; max: number } }).signers,
      commitments: (pub as unknown as { commitments: Uint8Array[] }).commitments,
      verifyingShares: (pub as unknown as { verifyingShares: Record<string, Uint8Array> }).verifyingShares,
    };

    const frame = CBOR_ENC.encode({
      type: "frost_bootstrap",
      agentPubkey: this.#agentPubkeyHex,
      epochId: this.#epochId,
      secret: secretSerialized.signingShare,
      identifier: secretSerialized.identifier,
      commitments: pubSerialized.commitments,
      verifyingShares: pubSerialized.verifyingShares,
      signers: pubSerialized.signers,
    });

    const stream = await this.#openStream();
    try {
      stream.send(lp.encode.single(frame));
      // Read the response before closing — directory sends frost_bootstrap_ok
      for await (const chunk of lp.decode(stream)) {
        const bytes = chunk instanceof Uint8Array ? chunk : (chunk as unknown as { slice(): Uint8Array }).slice();
        const resp = cborDecode(bytes) as { type: string };
        if (resp.type !== "frost_bootstrap_ok") {
          throw new Error(`NetworkDirectoryNode: unexpected bootstrap response: ${resp.type}`);
        }
        break;
      }
    } finally {
      stream.close().catch(() => {});
    }
  }

  async generateCommitment(): Promise<StubCommitment> {
    if (!this.#agentPubkeyHex || !this.#epochId) {
      throw new Error("NetworkDirectoryNode: setBootstrapContext must be called before generateCommitment");
    }

    const frame = CBOR_ENC.encode({
      type: "frost_commit_request",
      agentPubkey: this.#agentPubkeyHex,
      epochId: this.#epochId,
      peerIdString: this.#node.getPeerId(),
    });

    const stream = await this.#openStream();
    try {
      stream.send(lp.encode.single(frame));
      await stream.close();

      for await (const chunk of lp.decode(stream)) {
        const bytes = chunk instanceof Uint8Array ? chunk : (chunk as unknown as { slice(): Uint8Array }).slice();
        const resp = cborDecode(bytes) as {
          type: string;
          ok: boolean;
          reason?: string;
          nodeId?: string;
          nonceCommitment?: StubCommitment["nonceCommitment"];
        };

        if (!resp.ok) {
          throw new Error(`NetworkDirectoryNode: commit request failed: ${resp.reason}`);
        }

        return {
          nodeId: resp.nodeId!,
          nonceCommitment: resp.nonceCommitment!,
          nonces: null as unknown as StubCommitment["nonces"],
        };
      }
    } finally {
      stream.close().catch(() => {});
    }

    throw new Error("NetworkDirectoryNode: no response to frost_commit_request");
  }

  async signRound(params: StubSignParams): Promise<Uint8Array | null> {
    if (!this.#agentPubkeyHex || !this.#epochId) {
      throw new Error("NetworkDirectoryNode: setBootstrapContext must be called before signRound");
    }

    const frame = CBOR_ENC.encode({
      type: "frost_sign_request",
      agentPubkey: this.#agentPubkeyHex,
      epochId: this.#epochId,
      framedMsg: params.msg, // already framed (context\0tbs) by the coordinator
      commitmentList: params.commitmentList,
      ceremonyId: params.ceremonyId,
      // Use ceremonyId as peerIdString to match directory's markInFlight registration
      peerIdString: params.ceremonyId,
    });

    const stream = await this.#openStream();
    try {
      stream.send(lp.encode.single(frame));
      await stream.close();

      for await (const chunk of lp.decode(stream)) {
        const bytes = chunk instanceof Uint8Array ? chunk : (chunk as unknown as { slice(): Uint8Array }).slice();
        const resp = cborDecode(bytes) as {
          type: string;
          ok: boolean;
          reason?: string;
          partialSignature?: Uint8Array;
        };

        if (!resp.ok) {
          return null; // treat as timeout — coordinator will exclude this node
        }

        const sig = resp.partialSignature;
        if (!sig) return null;
        return sig instanceof Uint8Array ? sig : new Uint8Array(sig as unknown as ArrayBuffer);
      }
    } finally {
      stream.close().catch(() => {});
    }

    return null;
  }

  // Called by the network-aware bootstrapKeyShares before distributing shares
  setBootstrapContext(agentPubkeyHex: string, epochId: string): void {
    this.#agentPubkeyHex = agentPubkeyHex;
    this.#epochId = epochId;
  }

  /** Open a /cello/frost/1.0.0 stream to this directory node. Used by DKG coordinator. */
  async openStream(): Promise<import("@libp2p/interface").Stream> {
    return this.#openStream();
  }

  async #openStream(): Promise<import("@libp2p/interface").Stream> {
    // Ensure we have a connection to the directory node
    try {
      return await this.#node.newStream(this.#directoryPeerId, FROST_PROTOCOL_ID);
    } catch {
      // Try dialing first if not connected
      await this.#node.dial(this.#directoryMultiaddrs[0]!);
      return await this.#node.newStream(this.#directoryPeerId, FROST_PROTOCOL_ID);
    }
  }
}

// ─── DKG round methods on NetworkDirectoryNode ───────────────────────────────

// These methods are used by runNetworkDkg to execute the 3 DKG rounds
// over /cello/frost/1.0.0 streams. They are internal to the DKG coordinator flow.

/**
 * Run DKG round 1 with this directory node.
 * Opens a new stream, sends frost_dkg_round1_request, returns the broadcast.
 */
async function dkgRound1WithNode(
  node: NetworkDirectoryNode,
  agentPubkeyHex: string,
  epochId: string,
  signers: { min: number; max: number },
  preAuthToken?: string,
): Promise<DkgRound1Broadcast> {
  const frame = CBOR_ENC.encode({
    type: "frost_dkg_round1_request",
    agentPubkey: agentPubkeyHex,
    epochId,
    signers,
    // OPS-AGENT-001: include preAuthToken when present (mandatory in M6+)
    ...(preAuthToken !== undefined ? { preAuthToken } : {}),
  });
  const stream = await node.openStream();
  try {
    stream.send(lp.encode.single(frame));
    for await (const chunk of lp.decode(stream)) {
      const bytes = chunk instanceof Uint8Array ? chunk : (chunk as unknown as { slice(): Uint8Array }).slice();
      const resp = parseDkgRound1Response(bytes);
      if (!resp) throw new Error("dkgRound1: invalid response");
      if (!resp.ok) throw new Error(`dkgRound1 failed: ${resp.reason}`);
      return resp.broadcast;
    }
  } finally {
    stream.close().catch(() => {});
  }
  throw new Error("dkgRound1: no response received");
}

/**
 * Run DKG round 2 with this directory node.
 * Opens a new stream, sends frost_dkg_round2_request, returns sharesForOthers.
 */
async function dkgRound2WithNode(
  node: NetworkDirectoryNode,
  agentPubkeyHex: string,
  epochId: string,
  othersRound1: DkgRound1Broadcast[],
): Promise<DkgRound2Share[]> {
  const frame = CBOR_ENC.encode({
    type: "frost_dkg_round2_request",
    agentPubkey: agentPubkeyHex,
    epochId,
    othersRound1: othersRound1.map((b) => ({
      identifier: b.identifier,
      commitment: b.commitment,
      proofOfKnowledge: b.proofOfKnowledge,
    })),
  });
  const stream = await node.openStream();
  try {
    stream.send(lp.encode.single(frame));
    for await (const chunk of lp.decode(stream)) {
      const bytes = chunk instanceof Uint8Array ? chunk : (chunk as unknown as { slice(): Uint8Array }).slice();
      const resp = parseDkgRound2Response(bytes);
      if (!resp) throw new Error("dkgRound2: invalid response");
      if (!resp.ok) throw new Error(`dkgRound2 failed: ${resp.reason}`);
      return resp.sharesForOthers;
    }
  } finally {
    stream.close().catch(() => {});
  }
  throw new Error("dkgRound2: no response received");
}

/**
 * Run DKG round 3 with this directory node.
 * Opens a new stream, sends frost_dkg_round3_request, returns shareCommitment.
 */
async function dkgRound3WithNode(
  node: NetworkDirectoryNode,
  agentPubkeyHex: string,
  epochId: string,
  sharesForMe: DkgRound2Share[],
  allRound1: DkgRound1Broadcast[],
): Promise<Uint8Array> {
  const frame = CBOR_ENC.encode({
    type: "frost_dkg_round3_request",
    agentPubkey: agentPubkeyHex,
    epochId,
    sharesForMe: sharesForMe.map((s) => ({
      identifier: s.signerIdentifier,
      targetIdentifier: s.targetIdentifier,
      signingShare: s.signingShare,
    })),
    allOthersRound1: allRound1.map((b) => ({
      identifier: b.identifier,
      commitment: b.commitment,
      proofOfKnowledge: b.proofOfKnowledge,
    })),
  });
  const stream = await node.openStream();
  try {
    stream.send(lp.encode.single(frame));
    for await (const chunk of lp.decode(stream)) {
      const bytes = chunk instanceof Uint8Array ? chunk : (chunk as unknown as { slice(): Uint8Array }).slice();
      const resp = parseDkgRound3Response(bytes);
      if (!resp) throw new Error("dkgRound3: invalid response");
      if (!resp.ok) throw new Error(`dkgRound3 failed: ${resp.reason}`);
      return resp.shareCommitment;
    }
  } finally {
    stream.close().catch(() => {});
  }
  throw new Error("dkgRound3: no response received");
}

// ─── DKG response parsers (client-side decoders) ──────────────────────────────

function parseDkgRound1Response(bytes: Uint8Array): FrostDkgRound1Response | null {
  let obj: unknown;
  try { obj = cborDecode(bytes); } catch { return null; }
  if (typeof obj !== "object" || obj === null) return null;
  const o = obj as Record<string, unknown>;
  if (o["type"] !== "frost_dkg_round1_response") return null;
  if (o["ok"] === true) {
    const raw = o["broadcast"];
    if (typeof raw !== "object" || raw === null) return null;
    const b = raw as Record<string, unknown>;
    const identifier = typeof b["identifier"] === "string" ? b["identifier"] : null;
    const proofOfKnowledge = toU8(b["proofOfKnowledge"]);
    const commitment = parseU8Array(b["commitment"]);
    if (!identifier || !proofOfKnowledge || !commitment) return null;
    return { type: "frost_dkg_round1_response", ok: true, broadcast: { identifier, commitment, proofOfKnowledge } };
  }
  const reason = o["reason"];
  if (reason !== "already_in_progress" && reason !== "internal_error") return null;
  return { type: "frost_dkg_round1_response", ok: false, reason };
}

function parseDkgRound2Response(bytes: Uint8Array): FrostDkgRound2Response | null {
  let obj: unknown;
  try { obj = cborDecode(bytes); } catch { return null; }
  if (typeof obj !== "object" || obj === null) return null;
  const o = obj as Record<string, unknown>;
  if (o["type"] !== "frost_dkg_round2_response") return null;
  if (o["ok"] === true) {
    const rawShares = o["sharesForOthers"];
    if (!Array.isArray(rawShares)) return null;
    const sharesForOthers: DkgRound2Share[] = [];
    for (const item of rawShares) {
      if (typeof item !== "object" || item === null) return null;
      const s = item as Record<string, unknown>;
      // Accept both "signerIdentifier" (protocol-types canonical) and "identifier" (new wire)
      const signerIdentifier =
        typeof s["signerIdentifier"] === "string" ? s["signerIdentifier"] :
        typeof s["identifier"] === "string" ? s["identifier"] : null;
      const targetIdentifier = typeof s["targetIdentifier"] === "string" ? s["targetIdentifier"] : null;
      const signingShare = toU8(s["signingShare"]);
      if (!signerIdentifier || !targetIdentifier || !signingShare) return null;
      sharesForOthers.push({ signerIdentifier, targetIdentifier, signingShare });
    }
    return { type: "frost_dkg_round2_response", ok: true, sharesForOthers };
  }
  const reason = o["reason"];
  if (reason !== "round1_not_complete" && reason !== "verification_failed" && reason !== "internal_error") return null;
  return { type: "frost_dkg_round2_response", ok: false, reason };
}

function parseDkgRound3Response(bytes: Uint8Array): FrostDkgRound3Response | null {
  let obj: unknown;
  try { obj = cborDecode(bytes); } catch { return null; }
  if (typeof obj !== "object" || obj === null) return null;
  const o = obj as Record<string, unknown>;
  if (o["type"] !== "frost_dkg_round3_response") return null;
  if (o["ok"] === true) {
    const sc = o["shareCommitment"];
    // shareCommitment comes as raw bytes (CBOR-encoded Uint8Array)
    const shareCommitment = typeof sc === "string"
      ? new Uint8Array(Buffer.from(sc, "hex"))
      : sc instanceof Uint8Array ? sc
      : Buffer.isBuffer(sc) ? new Uint8Array(sc as Buffer)
      : null;
    if (!shareCommitment || shareCommitment.length !== 32) return null;
    return { type: "frost_dkg_round3_response", ok: true, shareCommitment };
  }
  const reason = o["reason"];
  if (reason !== "round2_not_complete" && reason !== "share_verification_failed" && reason !== "internal_error") return null;
  return { type: "frost_dkg_round3_response", ok: false, reason };
}

function toU8(v: unknown): Uint8Array | null {
  if (v instanceof Uint8Array) return v;
  if (Buffer.isBuffer(v)) return new Uint8Array(v as Buffer);
  return null;
}

function parseU8Array(v: unknown): Uint8Array[] | null {
  if (!Array.isArray(v)) return null;
  const result: Uint8Array[] = [];
  for (const item of v) {
    const b = toU8(item);
    if (!b) return null;
    result.push(b);
  }
  return result;
}

// ─── bootstrapNetworkKeyShares ────────────────────────────────────────────────

/**
 * Network-aware FROST bootstrap for live e2e mode.
 *
 * Runs trustedDealer locally, then pushes each directory node's share over the
 * /cello/frost/1.0.0 network protocol. Returns a FrostThresholdSigner configured
 * to use NetworkDirectoryNodes, plus the primaryPubkey.
 *
 * NODE_ENV=test guard is kept because this still uses the trustedDealer shortcut.
 * Real DKG (M3) will replace this entirely.
 */
export async function bootstrapNetworkKeyShares(
  agentPubkey: Uint8Array,
  opts: {
    threshold: number;
    participants: number;
    directoryNodes: NetworkDirectoryNode[];
  },
): Promise<{ signer: FrostThresholdSigner; primaryPubkey: Uint8Array }> {
  // bootstrapKeyShares uses trustedDealer — a test-harness shortcut, not real DKG (M3+).
  // This function inherits that constraint. The caller (cello-mcp.ts) guards with NODE_ENV=test.
  if (process.env.NODE_ENV !== "test") {
    throw new Error("bootstrapNetworkKeyShares uses trustedDealer which is test-only. Real DKG (M3) required in production.");
  }
  const agentPubkeyHex = Buffer.from(agentPubkey).toString("hex");
  const epochId = `${agentPubkeyHex}:epoch:1`;

  // Set context on all nodes so receiveShare knows which agent/epoch to use
  for (const node of opts.directoryNodes) {
    node.setBootstrapContext(agentPubkeyHex, epochId);
  }

  // bootstrapKeyShares runs trustedDealer and calls node.receiveShare() on each node.
  // For NetworkDirectoryNode, receiveShare() sends the share over the network.
  const result: BootstrapResult = await bootstrapKeyShares(agentPubkey, {
    threshold: opts.threshold,
    participants: opts.participants,
    directoryNodeStubs: opts.directoryNodes,
  });

  const signer = new FrostThresholdSigner(
    {
      threshold: opts.threshold,
      participants: opts.participants,
      directoryNodeStubs: opts.directoryNodes,
    },
    agentPubkey,
  );

  return { signer, primaryPubkey: result.primaryPubkey };
}

// ─── runNetworkDkg ─────────────────────────────────────────────────────────────

/**
 * Run a real 3-round FROST DKG ceremony with directory nodes over /cello/frost/1.0.0.
 *
 * Production path for key establishment. The client acts as DKG coordinator:
 *   Round 1: All nodes generate their secret polynomials. Client does the same.
 *   Round 2: Client collects all round1 broadcasts and distributes them to all nodes.
 *            All nodes compute shares for every other participant.
 *   Round 3: Client routes round2 shares to recipients and all nodes finalize.
 *            All nodes return shareCommitment = group public key.
 *
 * Validates that all nodes derive the same primary_pubkey before returning.
 *
 * After a successful DKG:
 *   - Each directory node has its FrostSecret stored (via dkgRound3)
 *   - The client's local share is stored via storeDkgResult
 *   - Returns a FrostThresholdSigner for future signing ceremonies
 *
 * Crypto reference: RFC 9591 (FROST DKG)
 *
 * @param agentPubkey - client's Ed25519 K_local public key (32 bytes)
 * @param opts.threshold - minimum signers required (t in t-of-n)
 * @param opts.directoryNodes - the n directory nodes (each will hold a share)
 */
export async function runNetworkDkg(
  agentPubkey: Uint8Array,
  opts: {
    threshold: number;
    participants: number;
    directoryNodes: NetworkDirectoryNode[];
    /** OPS-AGENT-001: Pre-authorization token to present in Round 1 frame. */
    preAuthToken?: string;
  },
): Promise<{ signer: FrostThresholdSigner; primaryPubkey: Uint8Array }> {
  const agentPubkeyHex = Buffer.from(agentPubkey).toString("hex");
  // Client identifier: same derivation as used in bootstrapKeyShares for consistency
  const clientIdStr = `client:${agentPubkeyHex}`;
  const clientIdentifier = ed25519_FROST.Identifier.derive(clientIdStr);
  const epochId = `${agentPubkeyHex}:epoch:1`;

  // Total participants = directory nodes + 1 (client)
  // threshold is the signing threshold (t-of-n where n = directoryNodes.length + 1)
  const signers = { min: opts.threshold, max: opts.participants + 1 };

  // ─── Round 1 ────────────────────────────────────────────────────────────────
  // Client runs DKG.round1 locally; all directory nodes run round1 via streams.
  // RFC 9591 §5.1

  const clientR1 = ed25519_FROST.DKG.round1(clientIdentifier, signers);
  const clientRound1Broadcast: DkgRound1Broadcast = {
    identifier: clientR1.public.identifier,
    commitment: clientR1.public.commitment.map((c: Uint8Array) => new Uint8Array(c)),
    proofOfKnowledge: new Uint8Array(clientR1.public.proofOfKnowledge),
  };

  // Directory nodes run round1 in parallel
  const nodeRound1Broadcasts = await Promise.all(
    opts.directoryNodes.map((node) =>
      dkgRound1WithNode(node, agentPubkeyHex, epochId, signers, opts.preAuthToken)
    )
  );

  // allRound1 = client + all directory node broadcasts
  const allRound1: DkgRound1Broadcast[] = [clientRound1Broadcast, ...nodeRound1Broadcasts];

  // ─── Round 2 ────────────────────────────────────────────────────────────────
  // Client runs DKG.round2 locally (receives others' round1 → generates shares for others).
  // All directory nodes run round2 in parallel.
  // RFC 9591 §5.2

  // For the client, othersRound1 = all directory nodes' broadcasts
  const clientOthersRound1 = nodeRound1Broadcasts.map((b) => ({
    identifier: b.identifier,
    commitment: b.commitment.map((c) => new Uint8Array(c)),
    proofOfKnowledge: new Uint8Array(b.proofOfKnowledge),
  }));
  const clientR2 = ed25519_FROST.DKG.round2(clientR1.secret, clientOthersRound1);

  // For each directory node, othersRound1 = all other participants EXCEPT that node itself
  const nodeRound2Results = await Promise.all(
    opts.directoryNodes.map((node, i) => {
      // Each node receives round1 from everyone EXCEPT itself
      const othersForNode = allRound1.filter((_, j) =>
        j !== i + 1  // i+1 because index 0 is the client
      );
      return dkgRound2WithNode(node, agentPubkeyHex, epochId, othersForNode);
    })
  );

  // ─── Route round2 shares ─────────────────────────────────────────────────────
  // Collect all shares (client-generated + node-generated), route to recipients.
  // Each participant needs shares from all OTHER participants.
  // sharesForClient: shares where targetIdentifier === clientIdentifier
  // sharesForNode[i]: shares where targetIdentifier === nodeRound1Broadcasts[i].identifier

  // Build a map: targetIdentifier → accumulated DkgRound2Share[]
  const sharesForAll = new Map<string, DkgRound2Share[]>();

  // Add client's shares (for each directory node)
  const clientSharesRecord = clientR2 as Record<string, { identifier: string; signingShare: Uint8Array }>;
  for (const [targetId, share] of Object.entries(clientSharesRecord)) {
    const shares = sharesForAll.get(targetId) ?? [];
    shares.push({
      signerIdentifier: clientIdentifier,
      targetIdentifier: targetId,
      signingShare: new Uint8Array(share.signingShare),
    });
    sharesForAll.set(targetId, shares);
  }

  // Add directory node shares (for client and other directory nodes)
  for (const nodeShares of nodeRound2Results) {
    for (const share of nodeShares) {
      const shares = sharesForAll.get(share.targetIdentifier) ?? [];
      shares.push(share);
      sharesForAll.set(share.targetIdentifier, shares);
    }
  }

  // ─── Round 3 ────────────────────────────────────────────────────────────────
  // Client runs DKG.round3 locally.
  // All directory nodes run round3 in parallel.
  // RFC 9591 §5.3

  // Client's round3: receives shares addressed to clientIdentifier
  const clientSharesForMe = (sharesForAll.get(clientIdentifier) ?? []).map((s) => ({
    identifier: s.signerIdentifier,  // SENDER's identifier (for round3 matching)
    signingShare: new Uint8Array(s.signingShare),
  }));
  const clientKey = ed25519_FROST.DKG.round3(clientR1.secret, clientOthersRound1, clientSharesForMe);

  // Directory nodes' round3: parallel
  const nodeCommitments = await Promise.all(
    opts.directoryNodes.map((node, i) => {
      const nodeId = nodeRound1Broadcasts[i]!.identifier;
      const nodeSharesForMe = sharesForAll.get(nodeId) ?? [];
      const allOthersForNode = allRound1.filter((_, j) => j !== i + 1);
      return dkgRound3WithNode(node, agentPubkeyHex, epochId, nodeSharesForMe, allOthersForNode);
    })
  );

  // ─── Verify all nodes agree on primary_pubkey ─────────────────────────────
  const primaryPubkey = new Uint8Array(clientKey.public.commitments[0]);
  const primaryPubkeyHex = Buffer.from(primaryPubkey).toString("hex");

  for (const nodeCommitment of nodeCommitments) {
    const nodeHex = Buffer.from(nodeCommitment).toString("hex");
    if (nodeHex !== primaryPubkeyHex) {
      // Clean up client secret to avoid leaking state
      try { ed25519_FROST.DKG.clean(clientR1.secret); } catch { /* ignore */ }
      throw new Error(
        `DKG failed: node commitment ${nodeHex.slice(0, 16)}… does not match client primary_pubkey ${primaryPubkeyHex.slice(0, 16)}…`
      );
    }
  }

  // ─── Store client's local DKG share ──────────────────────────────────────
  // storeDkgResult is the production key storage path (no NODE_ENV guard).
  storeDkgResult(agentPubkeyHex, clientKey.secret, clientKey.public);

  // Clean up DKG secret now that it's been safely stored
  try { ed25519_FROST.DKG.clean(clientR1.secret); } catch { /* ignore */ }

  // Set signing context on each directory node so generateCommitment/signRound can
  // identify which agent's share to use in future FROST signing ceremonies.
  for (const node of opts.directoryNodes) {
    node.setBootstrapContext(agentPubkeyHex, epochId);
  }

  // ─── Build FrostThresholdSigner ───────────────────────────────────────────
  const signer = new FrostThresholdSigner(
    {
      threshold: opts.threshold,
      participants: opts.participants,
      directoryNodeStubs: opts.directoryNodes,
    },
    agentPubkey,
  );

  return { signer, primaryPubkey };
}
