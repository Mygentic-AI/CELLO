/**
 * CELLO Transport — protocols.ts
 *
 * Protocol ID constants for the CELLO transport layer.
 */

/**
 * CELLO M0 stream protocol identifier.
 * Used for all CELLO envelope exchanges in the walking skeleton (M0) milestone.
 * Stream framing: it-length-prefixed varint-prefixed frames
 * (unsigned varint per https://github.com/multiformats/unsigned-varint).
 */
export const CELLO_PROTOCOL_ID = "/cello/m0/1.0.0";

/**
 * Circuit Relay v2 HOP protocol identifier.
 * Read from @libp2p/circuit-relay-v2 package (RELAY_V2_HOP_CODEC constant).
 * Value: '/libp2p/circuit/relay/0.2.0/hop'
 * Source: @libp2p/circuit-relay-v2 v4.2.3, src/constants.ts
 */
export const CIRCUIT_RELAY_V2_HOP_PROTOCOL_ID = "/libp2p/circuit/relay/0.2.0/hop";
