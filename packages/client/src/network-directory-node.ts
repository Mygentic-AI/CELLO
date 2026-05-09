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
import { bootstrapKeyShares } from "@cello/crypto/frost/frost-threshold-signer.js";
import { FrostThresholdSigner } from "@cello/crypto";
import type { CelloNode } from "@cello/transport";
import type {
  DirectoryNodeStub,
  StubCommitment,
  StubSignParams,
  BootstrapResult,
} from "@cello/crypto/frost/types.js";

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
