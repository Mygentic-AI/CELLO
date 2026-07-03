/**
 * DevNonceBinder — in-memory NonceBinder for CELLO_ENV=local and tests (M8B-PREAUTH-CAP).
 *
 * Same idempotent bind-to-epoch semantics as PgNonceBinder, backed by a Map instead of the local
 * pre_auth_nonce_bindings table. Process-lifetime only (no persistence) — fine for local dev.
 */
import type { NonceBinder, NonceBindResult } from "../nonce-binder.js";

export class DevNonceBinder implements NonceBinder {
  readonly #bindings = new Map<string, string>(); // nonce → epochId

  async bind(nonce: string, epochId: string): Promise<NonceBindResult> {
    const existing = this.#bindings.get(nonce);
    if (existing === undefined) {
      this.#bindings.set(nonce, epochId);
      return { bound: true };
    }
    if (existing === epochId) return { bound: true }; // idempotent — same registration
    return { bound: false, reason: "NONCE_ALREADY_BOUND" };
  }
}
