/**
 * 038-KEYBIND — a TEMPORARY declaration of the three wire fields this order adds, so the directory
 * can be written against them before the npm cascade that publishes them.
 *
 * ⚠️ **DELETE THIS FILE at the re-pin.** It exists for exactly one reason: `@cello-protocol/*` is
 * consumed here from npm, and the version carrying these fields is published at the END of this
 * order (the DoD's version cascade), after both repos are written and reviewed. Publishing first
 * would ship a client that REFUSES every assignment from a directory that does not yet send the
 * binding — the "one contract, one batch" rule in the milestone procedure, broken.
 *
 * ⚠️ **AND IT IS A CLAIM, NOT A FACT.** Nothing checks these declarations against what
 * protocol-types actually publishes; if they drift, this repo compiles against a shape the wire does
 * not have. That is the whole reason its lifetime is one commit. The moment
 * `packages/directory/package.json` resolves a protocol-types that carries these fields, this file
 * is removed and `tsc --build` is what proves the shapes agree.
 *
 * The field documentation lives in `cello-client/core/protocol-types/src/` — it is not duplicated
 * here, because two copies of a rationale is how the two copies stop agreeing.
 */

// The empty export makes this file a MODULE, which is what turns the block below into a module
// AUGMENTATION rather than an ambient module DECLARATION. Without it, TypeScript treats the block as
// a replacement for the whole package's types and every other field on AgentProfile disappears.
export {};

declare module "@cello-protocol/protocol-types" {
  interface AgentProfile {
    /** Hex 64-byte Ed25519 signature by K_local over (k_local_pubkey, primary_pubkey). */
    key_binding?: string;
  }

  interface DkgComplete {
    /** Hex 64-byte Ed25519 signature by K_local over (k_local_pubkey, primary_pubkey). */
    key_binding: string;
  }

  interface SessionAssignmentFrost {
    /** 64-byte signature by participant_a's K_local over (participant_a.pubkey, signer_pubkey). */
    participant_a_key_binding?: Uint8Array;
    /** participant_b's 32-byte FROST group public key. */
    participant_b_primary_pubkey?: Uint8Array;
    /** 64-byte signature by participant_b's K_local over (participant_b.pubkey, its group key). */
    participant_b_key_binding?: Uint8Array;
  }
}
