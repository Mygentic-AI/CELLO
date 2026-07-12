/**
 * buildMinimalPackageCbor — shared e2e helper.
 *
 * Lifted from packages/e2e-tests/src/__tests__/connreq-002-session-006-e2e.test.ts
 * (DOD-LEGACY-MCP-1, 2026-07-12). The legacy in-process MCP server used to build the
 * ConnectionPackage internally for `cello_request_connection`; with that server deleted,
 * building the package CBOR is the caller's job in every e2e test that opens a connection.
 *
 * Crypto refs: Ed25519 → RFC 8032, ML-DSA-44 → NIST FIPS 204.
 */

import { generateKeypair, mlDsaKeygen } from "@cello-protocol/crypto";
import {
  encodeConnectionPackage,
  buildPseudonymBinding,
} from "@cello-protocol/protocol-types";
import type { ConnectionPackage } from "@cello-protocol/protocol-types";

export async function buildMinimalPackageCbor(
  keyProvider: ReturnType<typeof generateKeypair>,
  mlDsaProvider: Awaited<ReturnType<typeof mlDsaKeygen>>,
  primaryPubkeyHex?: string,
  createdAt?: number,
): Promise<Uint8Array> {
  const kLocalPubkey = new Uint8Array(await keyProvider.getPublicKey());
  const primaryPubkey = primaryPubkeyHex
    ? Buffer.from(primaryPubkeyHex, "hex")
    : new Uint8Array(32);
  const mlDsaPubkey = new Uint8Array(await mlDsaProvider.getPublicKey());
  const bindingResult = await buildPseudonymBinding(
    {
      pseudonym_label: "test-agent",
      k_local_pubkey: kLocalPubkey,
      primary_pubkey: new Uint8Array(primaryPubkey),
      ml_dsa_pubkey: mlDsaPubkey,
      created_at: createdAt ?? Date.now(),
    },
    mlDsaProvider,
  );
  if (!bindingResult.ok) throw new Error("buildPseudonymBinding failed");
  const pkg: ConnectionPackage = {
    pseudonym_binding: bindingResult.binding,
    endorsements: [],
    attestations: [],
  };
  return encodeConnectionPackage(pkg);
}
