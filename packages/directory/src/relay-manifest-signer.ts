/**
 * M12 DOD-NODE-DIR-GCP-1 — which key signs the relay pool manifest this node trusts.
 *
 * `RELAY_MANIFEST_SIGNER_PUBKEY` is the Ed25519 PUBLIC key the node verifies its relay manifest
 * against. On AWS it is `/cello/{env}/directory/manifest-signer-pubkey`, set per region by
 * deploy.sh from that region's own node key — so its value has always been "this node's own public
 * key". A node reads its own regional bucket and verifies a manifest it published itself.
 *
 * A first node in a new region has no one to inherit that value from, and requiring an operator to
 * paste in a key the node already holds is a step that exists only to be got wrong. So when the
 * variable is absent the node derives it from its own key.
 *
 * This is a derivation, not a fallback, and its failure mode is what makes it safe: if a node were
 * ever meant to trust a manifest signed by a DIFFERENT node, deriving self would make it REJECT
 * that manifest. The default can cause refusal, never acceptance. An explicit value always wins.
 */

import type { Logger } from "@cello-protocol/interfaces";

export interface RelayManifestSigner {
  /** The Ed25519 public key, hex. */
  pubkeyHex: string;
  /** How it was determined — recorded so a derived trust anchor is never silent. */
  source: "configured" | "derived_from_node_key";
}

export function resolveRelayManifestSigner(
  configured: string | undefined,
  ownPublicKeyHex: string,
  logger: Logger,
): RelayManifestSigner {
  const trimmed = configured?.trim();
  if (trimmed) {
    return { pubkeyHex: trimmed, source: "configured" };
  }
  if (!/^[0-9a-fA-F]{64}$/.test(ownPublicKeyHex)) {
    // Not recoverable: with no configured value and no usable own key there is no trust anchor,
    // and a relay manifest verified against nothing is worse than no relay manifest.
    throw new Error(
      "RELAY_MANIFEST_SIGNER_PUBKEY is unset and this node's own public key is not 32-byte hex — no trust anchor for the relay manifest",
    );
  }
  logger.info("relay.manifest.signer.derived", {
    reason: "RELAY_MANIFEST_SIGNER_PUBKEY unset — verifying against this node's OWN key, which is what the per-region AWS value has always held",
    pubkey: ownPublicKeyHex,
  });
  return { pubkeyHex: ownPublicKeyHex.toLowerCase(), source: "derived_from_node_key" };
}
