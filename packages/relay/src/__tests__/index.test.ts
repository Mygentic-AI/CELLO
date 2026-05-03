import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stat, rm, mkdir } from "node:fs/promises";
import { privateKeyFromProtobuf } from "@libp2p/crypto/keys";
import { loadOrGenerateRelayKey } from "../index.js";

describe("loadOrGenerateRelayKey", () => {
  it("generates a key file with 0o600 permissions when none exists", async () => {
    const dir = join(tmpdir(), `relay-key-test-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    const keyPath = join(dir, "relay-key");
    try {
      await loadOrGenerateRelayKey(keyPath);
      const s = await stat(keyPath);
      expect(s.mode & 0o777).toBe(0o600);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("returns the same key on second load (PeerID is stable)", async () => {
    const dir = join(tmpdir(), `relay-key-test-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    const keyPath = join(dir, "relay-key");
    try {
      const key1 = await loadOrGenerateRelayKey(keyPath);
      const key2 = await loadOrGenerateRelayKey(keyPath);
      // Compare via protobuf round-trip — same bytes means same key
      const { privateKeyToProtobuf } = await import("@libp2p/crypto/keys");
      expect(Buffer.from(privateKeyToProtobuf(key1)).toString("hex")).toBe(
        Buffer.from(privateKeyToProtobuf(key2)).toString("hex")
      );
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("throws on corrupt key file (wrong bytes)", async () => {
    const dir = join(tmpdir(), `relay-key-test-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    const keyPath = join(dir, "relay-key");
    try {
      const { writeFile } = await import("node:fs/promises");
      await writeFile(keyPath, Buffer.from("not a valid protobuf key"), { mode: 0o600 });
      await expect(loadOrGenerateRelayKey(keyPath)).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("produces a key that round-trips through privateKeyFromProtobuf", async () => {
    const dir = join(tmpdir(), `relay-key-test-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    const keyPath = join(dir, "relay-key");
    try {
      const { privateKeyToProtobuf } = await import("@libp2p/crypto/keys");
      const key = await loadOrGenerateRelayKey(keyPath);
      const encoded = privateKeyToProtobuf(key);
      const decoded = privateKeyFromProtobuf(encoded);
      expect(Buffer.from(privateKeyToProtobuf(decoded)).toString("hex")).toBe(
        Buffer.from(encoded).toString("hex")
      );
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});
