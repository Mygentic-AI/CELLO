/**
 * FROST threshold signing public API — CELLO-CRYPTO-003
 *
 * Exports:
 * - IThresholdSigner: the swap point interface
 * - ThresholdSignature: result type
 * - FrostThresholdSigner: FROST/Ed25519 implementation
 * - MockThresholdSigner: test double confirming the swap point
 * - CONTEXT_SESSION_ESTABLISHMENT / CONTEXT_SEAL: domain context constants
 *
 * Note: bootstrapKeyShares and clearTestShares are test-only — NOT exported
 * from this barrel. Test files import them directly from
 * ./frost-threshold-signer.js to prevent accidental use in production.
 *
 * Note: createInProcessStubs and stub types (DirectoryNodeStub, StubSignParams,
 * StubCommitment) are NOT exported from this barrel. Test files import them
 * directly from ./stubs.js and ./types.js to keep test infrastructure out of
 * the production package surface.
 */

export type {
  IThresholdSigner,
  ThresholdSignature,
  ThresholdSignatureOk,
  ThresholdSignatureError,
  FrostThresholdSignerConfig,
  FrostContext,
  BootstrapResult,
} from "./types.js";

export {
  CONTEXT_SESSION_ESTABLISHMENT,
  CONTEXT_SEAL,
} from "./types.js";

export {
  FrostThresholdSigner,
  MockThresholdSigner,
} from "./frost-threshold-signer.js";
