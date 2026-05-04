export type {
  MessageEnvelope,
  MessageEnvelopeV1,
  EnvelopeError,
  BuildResult,
  BuildResultV1,
  ValidateResult,
  DeserializeResult,
  DeserializeResultV1,
} from "./types.js";

export {
  buildEnvelope,
  serializeEnvelope,
  deserializeEnvelope,
  validateEnvelope,
  buildEnvelopeV1,
  serializeEnvelopeV1,
  deserializeEnvelopeV1,
  validateEnvelopeV1,
  extractStructure1,
} from "./envelope.js";
