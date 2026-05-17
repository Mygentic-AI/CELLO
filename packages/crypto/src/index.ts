export type { KeyProvider, PublicKey, Signature, KeyFileCorruptError } from "./types.js";
export { InMemoryKeyProvider, FileKeyProvider, generateKeypair, verify } from "./ed25519.js";
export type { MlDsaPublicKey, MlDsaSignature, MlDsaKeyPair, MlDsaKeyProvider } from "./ml-dsa.js";
export {
  InMemoryMlDsaKeyProvider,
  FileMlDsaKeyProvider,
  mlDsaKeygen,
  mlDsaSign,
  mlDsaVerify,
  mlDsaEnsureLoaded,
} from "./ml-dsa.js";
export { hash, msgLeafHash, nodeHash, ctrlLeafHash, buildRelayAckTbs } from "./hashing.js";
export type { MerkleTree, LeafInput } from "./merkle.js";
export { buildMerkleTree, merkleRoot, inclusionProof, verifyInclusion } from "./merkle.js";
export type {
  IThresholdSigner,
  ThresholdSignature,
  ThresholdSignatureOk,
  ThresholdSignatureError,
  FrostThresholdSignerConfig,
  FrostContext,
  BootstrapResult,
} from "./frost/index.js";
export {
  CONTEXT_SESSION_ESTABLISHMENT,
  CONTEXT_SEAL,
  FrostThresholdSigner,
  MockThresholdSigner,
} from "./frost/index.js";

// SESSION-004: standalone FROST verify (no signer instance needed — used by counterparty client)
export { verifyFrostSignature } from "./frost/frost-threshold-signer.js";

// REG-001: re-export ed25519_FROST for DKG coordinator in @cello/client
export { ed25519_FROST } from "@noble/curves/ed25519.js";
