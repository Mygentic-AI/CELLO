/**
 * The seal-leaf shapes BOTH the directory and the relay speak.
 *
 * Moved here from `packages/directory/src/directory-types.ts` by `031-RELAYREPLAY` for the same
 * reason `relay-online-token.ts` lives here: the directory and the relay are the two readers, and
 * `@cello-protocol/interfaces` is the only workspace package both of them import — so the two
 * halves cannot drift apart. A relay that is handed a conversation it did not witness verifies the
 * carried chain with the SAME code the directory uses at seal time; a second copy would drift, and
 * the failure mode of a drifted seal verifier is that one witness accepts a chain the other refuses.
 *
 * `directory-types.ts` re-exports every name below, so existing directory call sites and tests are
 * unchanged. There is one definition, here.
 */

import type { Structure2 } from "@cello-protocol/protocol-types";

/**
 * FED-OPTIONB-SEAL-001: a client-carried leaf for the directory's OFFLINE unilateral-tree rebuild. The
 * relay receipt fields (relay_id/relay_timestamp/relay_signature) are present ONLY for the present party's
 * own leaves (the relay signed an ACK over content_hash→seq → the teeth that pin order); the absent party's
 * leaves carry none (pinned by their sender_signature + sequence contiguity).
 */
export interface SealUnilateralLeaf {
  sequence_number: number;
  leaf_kind: number;                 // 0x00 message / 0x02 control (SEAL)
  structure2_cbor: Uint8Array;       // the relay's committed Structure2 (CBOR)
  structure1_cbor: Uint8Array;       // the sender-signed Structure1 (CBOR)
  relay_id?: string;                 // hex of the relay ack-signing pubkey (own leaves)
  relay_timestamp?: number;          // Unix ms in the relay ACK TBS (own leaves)
  relay_signature?: Uint8Array;      // 64-byte relay ACK signature (own leaves)
  /**
   * `DOD-M15-SEALWIRE-1` bullets 3+4: the ctrl leaf's SEAL payload bytes, when a relay carries them.
   * Absent means a relay that has not deployed the change — never "verified". See
   * `seal-final-root.ts` for what these bytes make checkable and why the directory cannot check it
   * without them.
   */
  content_bytes?: Uint8Array;
}

/**
 * A leaf domain the directory can see in a carried chain (DOD-DOC-LEAF-1). "doc" (0x04) and
 * "reject" (0x05) are document-collaboration leaves; only "ctrl" (0x02) is a SEAL ceremony leaf.
 */
export type RelaySealLeafKind = "msg" | "ctrl" | "doc" | "reject";

export interface RelaySealLeaf {
  kind: RelaySealLeafKind;
  s2: Structure2;
  structure1_cbor: Uint8Array;
  /**
   * The ctrl leaf's PAYLOAD BYTES — `DOD-M15-SEALWIRE-1` bullets 3 and 4. Present only on `ctrl`
   * leaves, and only from a relay that carries them.
   *
   * Without these the directory holds a SHA-256 of the SEAL payload and nothing else, so the
   * client's signed `final_root` is unrecoverable and the only root check available compares the
   * relay against itself. See `seal-final-root.ts` for why that is circular and what these bytes fix.
   *
   * ⚠️ OPTIONAL, AND ABSENT MEANS "a relay that has not deployed this yet" — never "verified".
   * Receiver-first: the directory tolerates and verifies the new shape before any relay depends on
   * it being read. Collapsing absent into a pass is the same failure Decision #15 spends a wire
   * discriminator preventing.
   */
  content_bytes?: Uint8Array;
}

export interface RelaySealData {
  leaves: RelaySealLeaf[];
  seq_count: number;
  merkle_root: Uint8Array;
}
