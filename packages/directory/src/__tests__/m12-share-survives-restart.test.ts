/**
 * M12 — a FROST share must survive the process that created it.
 *
 * ─── Why this test exists ────────────────────────────────────────────────────────────────────
 * On 2026-07-29 no FROST share had ever persisted on GCP. `SI-003` demanded
 * `ciphertext.length === plaintext + 28` (raw AES-256-GCM), but Cloud KMS returns its own wrapped
 * blob whose length is not a fixed function of plaintext length, so EVERY share write threw. The
 * write is fire-and-forget, so nothing surfaced: registration returned ok, the DKG named every
 * validator a signer, and the agent worked — until the directory process restarted, at which point
 * `sharesLoaded: 0` and every session died with `AGENT_NOT_BOOTSTRAPPED`. A single deploy would
 * have done that to every registered user.
 *
 * The fix shipped with an assertion that the encrypted WRITE succeeds. That is still green about
 * the wrong noun, just a nearer one: **the write succeeding is not the share surviving.** Only a
 * reader that does not already hold the value in memory can tell those apart — which is what this
 * test is. It builds a store, writes a share, then throws that store away and builds a NEW one over
 * the same rows, exactly as a restarted process does.
 *
 * The provider here is deliberately KMS-SHAPED — variable-length, longer than plaintext + 28 — so
 * the original bug cannot pass this file. A test using an AES-GCM-shaped provider would have gone
 * green throughout the entire outage.
 */

import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import type pg from "pg";
import { EncryptedPgShareStore } from "../encrypted-share-store.js";
import { PersistentShareStore } from "../persistent-share-store.js";
import type { LocalShare } from "../share-store.js";
import type { Logger } from "@cello-protocol/interfaces";

const silent: Logger = {
  info: () => {}, warn: () => {}, error: () => {}, debug: () => {},
} as unknown as Logger;

/**
 * The smallest thing that behaves like `agent_key_shares`: rows survive, and the ROWS are the only
 * thing carried across the simulated restart. Nothing else is shared between the two stores.
 */
function makeRowStore() {
  const rows = new Map<string, { agent_id: string; epoch_id: string; encrypted_share: Buffer }>();
  const pool = {
    query: async (sql: string, params?: unknown[]) => {
      if (/^\s*INSERT INTO agent_key_shares/i.test(sql)) {
        const [agent_id, epoch_id, encrypted_share] = params as [string, string, Buffer];
        rows.set(`${agent_id}:${epoch_id}`, { agent_id, epoch_id, encrypted_share });
        return { rows: [], rowCount: 1 };
      }
      if (/SELECT .*FROM agent_key_shares/i.test(sql)) {
        return { rows: [...rows.values()], rowCount: rows.size };
      }
      return { rows: [], rowCount: 0 };
    },
  } as unknown as pg.Pool;
  return { pool, rows };
}

/**
 * KMS-shaped envelope: a wrapped blob with a header and trailer, NOT plaintext + 28. Round-trips
 * exactly, so a share that survives here survived for the right reason.
 */
const HEADER = Buffer.from("kms-wrapped-v1:");
function kmsProvider() {
  return {
    encrypt: async (pt: Uint8Array) => new Uint8Array(Buffer.concat([HEADER, Buffer.from(pt), randomBytes(64)])),
    decrypt: async (ct: Uint8Array) => new Uint8Array(Buffer.from(ct).subarray(HEADER.length, Buffer.from(ct).length - 64)),
    rotate: async () => {},
  } as never;
}

/** A share whose secret is a plain byte container — enough to prove identity across the boundary. */
function makeShare(marker: number): LocalShare {
  const signingShare = new Uint8Array(32).fill(marker);
  return { secret: { signingShare } as never, pub: { verifyingShare: new Uint8Array(32).fill(marker ^ 0xff) } as never };
}

describe("M12: a FROST share survives the process that created it", () => {
  const AGENT = "a".repeat(64);
  const EPOCH = `${AGENT}:epoch:1`;

  it("a share written by one store is READABLE by a fresh store over the same rows", async () => {
    const { pool, rows } = makeRowStore();

    // ── process 1: deal the share and await durability ──
    const first = new PersistentShareStore(new EncryptedPgShareStore(pool, kmsProvider(), silent), silent);
    await first.storeShareDurable(AGENT, EPOCH, makeShare(0x5a));
    expect(first.getShare(AGENT, EPOCH)).toBeDefined(); // in memory — the weaker claim
    expect(rows.size).toBe(1);                          // and on "disk"

    // ── process 2: a store that has NEVER seen this share in memory ──
    const restarted = new PersistentShareStore(new EncryptedPgShareStore(pool, kmsProvider(), silent), silent);
    expect(restarted.getShare(AGENT, EPOCH)).toBeUndefined(); // nothing cached yet — proves the boundary is real

    const { loaded, failed } = await restarted.loadShares();
    expect(failed).toBe(0);
    expect(loaded).toBe(1);

    const recovered = restarted.getShare(AGENT, EPOCH);
    expect(recovered).toBeDefined();
    // Byte-identical, not merely present: a share that loads but decodes wrong cannot co-sign, and
    // would fail later as AGENT_NOT_BOOTSTRAPPED with no hint that persistence was the cause.
    expect(Array.from((recovered!.secret as unknown as { signingShare: Uint8Array }).signingShare))
      .toEqual(Array.from(new Uint8Array(32).fill(0x5a)));
  });

  it("getMaxEpoch after restart reports the epoch actually held, not undefined", async () => {
    // getMaxEpoch is what now distinguishes "never in this agent's DKG quorum" from "holds shares,
    // wrong epoch" in the AGENT_NOT_BOOTSTRAPPED logs. If it does not survive a restart, the fleet
    // reports the wrong shareState for every pre-restart agent and the diagnosis inverts.
    const { pool } = makeRowStore();
    const first = new PersistentShareStore(new EncryptedPgShareStore(pool, kmsProvider(), silent), silent);
    await first.storeShareDurable(AGENT, EPOCH, makeShare(0x11));

    const restarted = new PersistentShareStore(new EncryptedPgShareStore(pool, kmsProvider(), silent), silent);
    expect(restarted.getMaxEpoch(AGENT)).toBeUndefined(); // before load
    await restarted.loadShares();
    expect(restarted.getMaxEpoch(AGENT)).toBe(1);
  });

  it("a write REJECTED by SI-003 does not silently look like a stored share", async () => {
    // The original defect in one assertion. A provider returning the plaintext unchanged must be
    // refused, and — this is the part that mattered — the row must NOT exist afterwards, so a
    // restart cannot recover something that was never encrypted.
    const { pool, rows } = makeRowStore();
    const passthrough = { encrypt: async (pt: Uint8Array) => pt, decrypt: async (ct: Uint8Array) => ct, rotate: async () => {} } as never;
    const store = new PersistentShareStore(new EncryptedPgShareStore(pool, passthrough, silent), silent);

    await expect(store.storeShareDurable(AGENT, EPOCH, makeShare(0x22))).rejects.toThrow(/PLAINTEXT unchanged/);
    expect(rows.size).toBe(0);
  });
});
