/**
 * @cello/transport — public API
 *
 * Exports the CelloNode factory, interface, protocol constants, and error types.
 */

export { createNode } from "./node.js";
export type { CelloNode, CreateNodeOptions, CelloStreamHandler } from "./types.js";
export type {
  CelloTransportError,
  ProtocolNotSupportedError,
  ConnectionLostError,
  NodeStoppedError,
  ListenFailedError,
} from "./types.js";
export { CELLO_PROTOCOL_ID, CIRCUIT_RELAY_V2_HOP_PROTOCOL_ID } from "./protocols.js";
