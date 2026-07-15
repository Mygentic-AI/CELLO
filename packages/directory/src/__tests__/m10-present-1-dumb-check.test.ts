/**
 * DOD-PRESENT-1 — directory dumb check: membership + status.
 *
 * The directory sits on the session-brokering path. When the initiator's session_request
 * carries trust_signals, the directory checks each hash against signal_records_effective:
 * (1) the hash was notarized (exists), (2) effective_status = 'active'. Non-survivors are
 * stripped; nothing is written. INV-STATELESS-RECIPIENT + INV-DIR-DUMB + INV-ZERO-BUMP.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { randomBytes } from "node:crypto";
import { checkPresentedSignals } from "../signal-present.js";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://postgres:dev@localhost:5433/cello_dev";

let pool: pg.Pool;

beforeAll(async () => {
  pool = new pg.Pool({ connectionString: DATABASE_URL });
  // Ensure the schema is there (Flyway runs before tests in CI; locally via pnpm db:up + migrate).
  const check = await pool.query("SELECT 1 FROM information_schema.tables WHERE table_name = 'signal_records'");
  expect(check.rows.length, "signal_records must exist — run flyway migrate first").toBeGreaterThan(0);
});

afterAll(async () => {
  await pool?.end();
});

function randomHash(): string {
  return randomBytes(32).toString("hex");
}

async function seedSignal(hash: string, opts: { status?: string; node?: string; subject?: string } = {}): Promise<void> {
  const status = opts.status ?? "active";
  const node = opts.node ?? "test-node";
  const subject = opts.subject ?? `acct-${randomBytes(4).toString("hex")}`;
  await pool.query(
    `INSERT INTO signal_records (signal_hash, accepting_node, subject_kind, subject, issuer_kind, issuer_pubkey, type, status, scanner_version, is_tombstone)
     VALUES ($1, $2, 'account', $3, 'portal', $4, 'email', $5, '1.0', false)
     ON CONFLICT DO NOTHING`,
    [hash, node, subject, randomBytes(32).toString("hex"), status],
  );
}

describe("DOD-PRESENT-1 — directory dumb check (checkPresentedSignals)", () => {
  it("passes an active notarized signal through", async () => {
    const h = randomHash();
    await seedSignal(h);
    const result = await checkPresentedSignals(pool, [h]);
    expect(result).toEqual([h]);
  });

  it("strips a hash that was never notarized (membership check)", async () => {
    const bogus = randomHash();
    const result = await checkPresentedSignals(pool, [bogus]);
    expect(result).toEqual([]);
  });

  it("strips a revoked signal", async () => {
    const h = randomHash();
    await seedSignal(h, { status: "revoked" });
    const result = await checkPresentedSignals(pool, [h]);
    expect(result).toEqual([]);
  });

  it("strips a superseded signal", async () => {
    const oldH = randomHash();
    const newH = randomHash();
    await seedSignal(oldH);
    // Insert a non-revoked replacement that supersedes oldH
    await pool.query(
      `INSERT INTO signal_records (signal_hash, accepting_node, subject_kind, subject, issuer_kind, issuer_pubkey, type, status, supersedes_hash, scanner_version, is_tombstone)
       VALUES ($1, 'test-node', 'account', 'acct-x', 'portal', $2, 'email', 'active', $3, '1.0', false)`,
      [newH, randomBytes(32).toString("hex"), oldH],
    );
    const result = await checkPresentedSignals(pool, [oldH]);
    expect(result).toEqual([]);
  });

  it("handles mixed: one active, one revoked, one unknown — returns only the active", async () => {
    const active = randomHash();
    const revoked = randomHash();
    const unknown = randomHash();
    await seedSignal(active);
    await seedSignal(revoked, { status: "revoked" });
    const result = await checkPresentedSignals(pool, [active, revoked, unknown]);
    expect(result).toEqual([active]);
  });

  it("returns empty array for empty input", async () => {
    const result = await checkPresentedSignals(pool, []);
    expect(result).toEqual([]);
  });

  it("preserves order of surviving hashes", async () => {
    const h1 = randomHash();
    const h2 = randomHash();
    const h3 = randomHash();
    await seedSignal(h1);
    await seedSignal(h2);
    await seedSignal(h3);
    const result = await checkPresentedSignals(pool, [h3, h1, h2]);
    expect(result).toEqual([h3, h1, h2]);
  });

  it("writes NOTHING to signal_records (INV-STATELESS-RECIPIENT)", async () => {
    const h = randomHash();
    await seedSignal(h);
    const before = await pool.query("SELECT count(*)::int AS c FROM signal_records");
    await checkPresentedSignals(pool, [h]);
    const after = await pool.query("SELECT count(*)::int AS c FROM signal_records");
    expect(after.rows[0].c).toBe(before.rows[0].c);
  });

  it("is type-blind — an unknown type presents identically (INV-ZERO-BUMP / INV-TYPE-CARRY)", async () => {
    const h = randomHash();
    // Seed with an entirely unknown type string
    await pool.query(
      `INSERT INTO signal_records (signal_hash, accepting_node, subject_kind, subject, issuer_kind, issuer_pubkey, type, status, scanner_version, is_tombstone)
       VALUES ($1, 'test-node', 'account', 'acct-x', 'portal', $2, 'never_seen_before_xyz', 'active', '1.0', false)`,
      [h, randomBytes(32).toString("hex")],
    );
    const result = await checkPresentedSignals(pool, [h]);
    expect(result).toEqual([h]);
  });
});
