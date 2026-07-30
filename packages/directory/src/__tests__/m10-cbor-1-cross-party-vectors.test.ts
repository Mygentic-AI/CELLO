/**
 * M10 / DOD-CBOR-1 + DOD-INV-CANONICAL — the CROSS-PARTY half, from the DIRECTORY's side.
 *
 * cello-client proves the envelope encoder agrees with RFC 8949 on a hand-derived vector. That is
 * necessary and not sufficient: the property M10 actually depends on is that the PORTAL (at mint),
 * the DIRECTORY (at submission, and again at presentation), and the CLIENT (on receipt, and at
 * verification) all derive the SAME signal_hash from the same envelope — forever, across three repos
 * that upgrade independently.
 *
 * This file is the directory's half of that check. It re-derives every frozen vector using the
 * SHIPPED @cello-protocol/protocol-types — the exact artifact the directory runs in production, not
 * a local copy — and asserts byte-for-byte agreement.
 *
 * THE FAILURE THIS CATCHES IS VERSION SKEW, and it is otherwise invisible. If trustless-cello pins an
 * older protocol-types than the portal, the two silently disagree about the preimage; a perfectly
 * valid signal then fails the directory's re-hash (INV-CHOKEPOINT) or its presentation check, and
 * surfaces in production as an intermittent, per-node `hash_mismatch` on signals that are fine. It
 * would look like a network or database fault. It is neither.
 *
 * If this file goes red, DO NOT regenerate the vectors to make it pass. The vectors are frozen: a
 * change to the envelope that moves these bytes is a PROTOCOL BREAK that invalidates every signal
 * ever minted (spec §5's retrofit warning). Red here means the directory and the vectors disagree —
 * find out which one moved.
 */

import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { walkCborArray, isCborFloat } from "./cbor-item-walker.js";
import {
  encodeTrustSignalEnvelope,
  hashTrustSignalEnvelope,
  verifyTrustSignalHash,
  TRUST_SIGNAL_DOMAIN,
  type TrustSignalEnvelope,
} from "@cello-protocol/protocol-types";

/**
 * Resolve the vectors out of the INSTALLED package, not a checked-in copy.
 *
 * This is load-bearing. A vendored copy in this repo would drift from the published one — and
 * drifting copies of the canonical form is the exact disease this unit exists to cure. The vectors
 * are reachable only because protocol-types' `exports` map opens `./test/vectors/*` (added in
 * 0.0.23; before that the files shipped in the tarball but Node refused the subpath with
 * ERR_PACKAGE_PATH_NOT_EXPORTED — shipping-but-unreachable, which looks done and is not).
 */
const require_ = createRequire(import.meta.url);
const VECTORS_PATH = join(
  dirname(require_.resolve("@cello-protocol/protocol-types/package.json")),
  "test", "vectors", "trust-signal-envelope-canonical.json",
);

interface Vector {
  name: string;
  envelope: {
    subject_kind: "account" | "agent";
    subject: string;
    issuer_kind: "portal" | "agent";
    issuer_pubkey: string;
    type: string;
    schema_version: number;
    payload: string;           // hex in the file; RAW BYTES in the preimage
    issued_at: number;
    expires_at: number | null;
    supersedes_hash: string | null; // hex in the file; RAW BYTES in the preimage
    same_operator: boolean;
  };
  preimage_hex: string;
  signal_hash_hex: string;
}

const bytes = (h: string): Uint8Array => new Uint8Array(Buffer.from(h, "hex"));
const hex = (b: Uint8Array): string => Buffer.from(b).toString("hex");

const toEnvelope = (v: Vector): TrustSignalEnvelope => ({
  ...v.envelope,
  payload: bytes(v.envelope.payload),
  supersedes_hash: v.envelope.supersedes_hash === null ? null : bytes(v.envelope.supersedes_hash),
});

const loaded = JSON.parse(readFileSync(VECTORS_PATH, "utf8")) as { vectors: Vector[] };

describe("DOD-INV-CANONICAL — the DIRECTORY agrees with the frozen envelope vectors", () => {
  it("guards against a vacuous pass — the vectors really were loaded from the INSTALLED package", () => {
    expect(VECTORS_PATH).toContain("node_modules");
    expect(loaded.vectors.length).toBeGreaterThanOrEqual(7);
  });

  it.each(loaded.vectors.map((v) => [v.name, v] as const))(
    "re-derives the frozen preimage and hash: %s",
    (_name, v) => {
      const env = toEnvelope(v);
      expect(hex(encodeTrustSignalEnvelope(env)), "preimage bytes").toBe(v.preimage_hex);
      expect(hex(hashTrustSignalEnvelope(env)), "signal_hash").toBe(v.signal_hash_hex);
      expect(verifyTrustSignalHash(env, bytes(v.signal_hash_hex))).toBe(true);
    },
  );

  it("derives the hash with a SHA-256 the directory computes ITSELF, not the library's", () => {
    // Independent arithmetic: node's own crypto over the frozen preimage must reproduce the frozen
    // hash. If the library's hash and node's disagree, the library is not doing what it says.
    for (const v of loaded.vectors) {
      const own = createHash("sha256").update(Buffer.from(v.preimage_hex, "hex")).digest("hex");
      expect(own, v.name).toBe(v.signal_hash_hex);
    }
  });

  it("binds the domain tag the directory expects", () => {
    expect(TRUST_SIGNAL_DOMAIN).toBe("CELLO-TSIG-v1");
  });

  it("NO frozen preimage contains an IEEE float — checked by CBOR FRAMING, not by grepping hex", () => {
    // The defect DOD-CBOR-1's review caught: cbor-x encodes a JS number above 2^32 as a float64
    // (`fb`), which no conforming CBOR implementation in another language reproduces. A 100-year
    // expiry reaches that band TODAY. The directory asserts it independently, because the directory
    // is one of the parties that would silently disagree.
    //
    // The check WALKS the CBOR items rather than grepping the hex for `fb`. The naive grep is wrong
    // and fired a false alarm on the very first real vector: in `... 1a 696ac4fb 5820 1111...`, the
    // `fb` is the last byte of a uint32's VALUE, not a header, and the regex matched straight across
    // the item boundary. A hex search does not know where items begin — so it cries wolf, and its
    // confidence is false in both directions.
    for (const v of loaded.vectors) {
      const items = walkCborArray(bytes(v.preimage_hex));
      const floats = items.filter(isCborFloat);
      expect(floats, `IEEE float item(s) in preimage: ${v.name}`).toEqual([]);
    }
  });

  it("the timestamp slots are CBOR UNSIGNED INTEGERS in every vector, whatever their magnitude", () => {
    // Positive form of the same property, and the one that actually pins the fix: slots 8/9
    // (issued_at, expires_at) must be major type 0 (uint) — or null, for a signal that never expires.
    // A far-future expiry must be a uint64 (`1b`), never a float64.
    const ISSUED_AT = 8, EXPIRES_AT = 9;
    for (const v of loaded.vectors) {
      const items = walkCborArray(bytes(v.preimage_hex));
      expect(items).toHaveLength(12); // fixed arity — M10-D17 (12 since M10B appended same_operator)
      expect(items[ISSUED_AT].major, `issued_at must be a uint: ${v.name}`).toBe(0);
      const exp = items[EXPIRES_AT];
      const isNull = exp.major === 7 && exp.ai === 22;
      expect(isNull || exp.major === 0, `expires_at must be a uint or null: ${v.name}`).toBe(true);
    }

    const farFuture = loaded.vectors.find((v) => v.name.startsWith("FAR-FUTURE"));
    expect(farFuture, "the far-future vector must not be removed").toBeDefined();
    const ff = walkCborArray(bytes(farFuture!.preimage_hex))[EXPIRES_AT];
    expect(ff.major).toBe(0);   // unsigned integer...
    expect(ff.ai).toBe(27);     // ...encoded as a uint64 (8-byte argument), i.e. `1b`, not `fb`
  });

  it("an UNKNOWN type hashes exactly like a known one — the directory never gates on type", () => {
    // INV-TYPE-CARRY at the directory: a type this code has never seen must hash, store, and serve
    // identically. If someone adds a type enum to the directory, this still passes — but the schema
    // test (V46) and the zero-bump canary will not.
    const unknown = loaded.vectors.find((v) => v.envelope.type === "some_type_invented_next_year");
    expect(unknown, "the unknown-type vector must not be removed").toBeDefined();
    expect(hex(hashTrustSignalEnvelope(toEnvelope(unknown!)))).toBe(unknown!.signal_hash_hex);
  });
});
