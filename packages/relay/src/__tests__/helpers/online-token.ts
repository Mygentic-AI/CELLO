/**
 * DOD-M15-RELAYSLOTS-1 — test helper: the directory-issued online token.
 *
 * The relay now refuses any `relay_auth_response` that does not carry a token proving the
 * authenticating key belongs to a registered agent. Every relay test that authenticates therefore
 * has to mint one, and they all mint it the same way: sign for the agent's own public key with the
 * directory keypair the test already created to construct the relay.
 *
 * This lives here rather than being written out fifteen times so that a future change to the token —
 * a field, a lifetime, a domain — moves one file instead of drifting between suites, which is how a
 * test suite quietly stops exercising the shape production actually sends.
 *
 * ⚠️ NOT a way to bypass the check. It produces a genuine token from a genuine directory key; a test
 * that wants a REFUSAL mints a deliberately wrong one inline, where the wrongness is visible.
 */

import { mintOnlineToken, ONLINE_TOKEN_ISSUE_LIFETIME_MS } from "@cello-protocol/interfaces";
import type { generateKeypair } from "@cello-protocol/crypto";

type Keypair = ReturnType<typeof generateKeypair>;

/**
 * Mint a valid token for `agentKp`, signed by `dirKp`.
 *
 * `dirKp` must be the keypair whose public half the relay under test was constructed with, or the
 * relay will (correctly) refuse with `online_token_signature_invalid`.
 */
export async function testOnlineToken(
  dirKp: Keypair,
  agentKp: Keypair,
  ttlMs: number = ONLINE_TOKEN_ISSUE_LIFETIME_MS,
): Promise<Uint8Array> {
  return mintOnlineToken({
    agentPubkey: await agentKp.getPublicKey(),
    expiresAtMs: Date.now() + ttlMs,
    sign: async (tbs) => dirKp.sign(tbs),
  });
}
