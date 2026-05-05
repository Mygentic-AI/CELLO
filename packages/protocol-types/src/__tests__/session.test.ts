/**
 * CELLO-SESSION-002 SI-004: computeGenesisPrevRoot tests
 *
 * TDD Phase R — written BEFORE implementation (RED first).
 *
 * genesis prev_root = SHA-256(min(A,B) || max(A,B) || session_id || timestamp_be8)
 * where pubkeys are sorted bytewise-lexicographically and timestamp is an 8-byte
 * big-endian unsigned integer (milliseconds since Unix epoch) per RFC 4648 / FIPS 180-4.
 *
 * Test vectors pinned in packages/protocol-types/test/vectors/genesis-prev-root.json.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  setupV3Tests,
  describe,
  it,
  expect,
} from "@claude-flow/testing";
import { computeGenesisPrevRoot } from "../session.js";

setupV3Tests();

const __dirname = dirname(fileURLToPath(import.meta.url));
const VECTORS = JSON.parse(
  readFileSync(resolve(__dirname, "../../test/vectors/genesis-prev-root.json"), "utf8")
) as {
  fixtures: Array<{
    inputs: {
      pubkey_a_hex: string;
      pubkey_b_hex: string;
      session_id_hex: string;
      session_timestamp_ms: number;
    };
    expected_genesis_prev_root_hex: string;
  }>;
};

describe("CELLO-SESSION-002: computeGenesisPrevRoot", () => {
  // ─── SI-004: pinned test vectors ──────────────────────────────────────────

  it("SI-004/fixture-1: A < B — matches pinned genesis_prev_root hex", () => {
    const f = VECTORS.fixtures[0];
    const result = computeGenesisPrevRoot(
      Buffer.from(f.inputs.pubkey_a_hex, "hex"),
      Buffer.from(f.inputs.pubkey_b_hex, "hex"),
      Buffer.from(f.inputs.session_id_hex, "hex"),
      f.inputs.session_timestamp_ms,
    );
    expect(Buffer.from(result).toString("hex")).toBe(f.expected_genesis_prev_root_hex);
  });

  it("SI-004/fixture-2: args in reversed order produces identical result (deterministic sort)", () => {
    const f = VECTORS.fixtures[1];
    const result = computeGenesisPrevRoot(
      Buffer.from(f.inputs.pubkey_a_hex, "hex"),
      Buffer.from(f.inputs.pubkey_b_hex, "hex"),
      Buffer.from(f.inputs.session_id_hex, "hex"),
      f.inputs.session_timestamp_ms,
    );
    expect(Buffer.from(result).toString("hex")).toBe(f.expected_genesis_prev_root_hex);
  });

  it("SI-004/fixture-3: distinct inputs produce distinct result matching pinned hex", () => {
    const f = VECTORS.fixtures[2];
    const result = computeGenesisPrevRoot(
      Buffer.from(f.inputs.pubkey_a_hex, "hex"),
      Buffer.from(f.inputs.pubkey_b_hex, "hex"),
      Buffer.from(f.inputs.session_id_hex, "hex"),
      f.inputs.session_timestamp_ms,
    );
    expect(Buffer.from(result).toString("hex")).toBe(f.expected_genesis_prev_root_hex);
  });

  // ─── Result shape ─────────────────────────────────────────────────────────

  it("returns exactly 32 bytes (SHA-256 output)", () => {
    const result = computeGenesisPrevRoot(
      new Uint8Array(32).fill(0x01),
      new Uint8Array(32).fill(0x02),
      new Uint8Array(16).fill(0x03),
      1700000000000,
    );
    expect(result.length).toBe(32);
    expect(result).toBeInstanceOf(Uint8Array);
  });

  // ─── Sorting invariant ────────────────────────────────────────────────────

  it("calling with (A, B) and (B, A) always produces the same bytes", () => {
    const a = new Uint8Array(32).fill(0xcc);
    const b = new Uint8Array(32).fill(0x44); // 0x44 < 0xcc
    const sid = new Uint8Array(16).fill(0x55);
    const ts = 1746000000000;

    const r1 = computeGenesisPrevRoot(a, b, sid, ts);
    const r2 = computeGenesisPrevRoot(b, a, sid, ts);
    expect(Buffer.from(r1).toString("hex")).toBe(Buffer.from(r2).toString("hex"));
  });

  it("different session_id produces different result", () => {
    const a = new Uint8Array(32).fill(0x01);
    const b = new Uint8Array(32).fill(0x02);
    const ts = 1700000000000;

    const r1 = computeGenesisPrevRoot(a, b, new Uint8Array(16).fill(0xaa), ts);
    const r2 = computeGenesisPrevRoot(a, b, new Uint8Array(16).fill(0xbb), ts);
    expect(Buffer.from(r1).toString("hex")).not.toBe(Buffer.from(r2).toString("hex"));
  });

  it("different timestamp produces different result", () => {
    const a = new Uint8Array(32).fill(0x01);
    const b = new Uint8Array(32).fill(0x02);
    const sid = new Uint8Array(16).fill(0xaa);

    const r1 = computeGenesisPrevRoot(a, b, sid, 1700000000000);
    const r2 = computeGenesisPrevRoot(a, b, sid, 1700000000001);
    expect(Buffer.from(r1).toString("hex")).not.toBe(Buffer.from(r2).toString("hex"));
  });

  // ─── BigInt timestamp support ─────────────────────────────────────────────

  it("accepts BigInt timestamp and produces the same result as number", () => {
    const a = new Uint8Array(32).fill(0x01);
    const b = new Uint8Array(32).fill(0x02);
    const sid = new Uint8Array(16).fill(0x03);
    const ts = 1700000000000;

    const r1 = computeGenesisPrevRoot(a, b, sid, ts);
    const r2 = computeGenesisPrevRoot(a, b, sid, BigInt(ts));
    expect(Buffer.from(r1).toString("hex")).toBe(Buffer.from(r2).toString("hex"));
  });

  // ─── Preimage construction (internal contract check) ─────────────────────

  it("preimage matches SHA-256(min || max || sid || be8) computed independently", () => {
    const a = Buffer.from("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "hex");
    const b = Buffer.from("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "hex");
    const sid = Buffer.from("eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", "hex");
    const ts = 1700000000000;
    const tsBe = Buffer.alloc(8);
    tsBe.writeBigUInt64BE(BigInt(ts));

    const expectedPreimage = Buffer.concat([a, b, sid, tsBe]);
    const expected = createHash("sha256").update(expectedPreimage).digest();

    const result = computeGenesisPrevRoot(a, b, sid, ts);
    expect(Buffer.from(result).toString("hex")).toBe(expected.toString("hex"));
  });
});
