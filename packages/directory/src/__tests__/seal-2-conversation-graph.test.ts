/**
 * SEAL-2 — relationship-graph producer (Sybil / relationship-farming defense).
 *
 * The directory's seal-completion path must populate conversation_seals + conversation_participation
 * + conversation_attestations so the analytics graph (conversation_graph_edges / pseudonym_stats) can
 * detect reputation-farming clusters. These tables had NO write method; this proves the new
 * recordConversationSeal populates them atomically + hash-chained, and that the ANALYTICS graph-edge
 * query genuinely derives an edge from the rows.
 *
 * PRIVACY: stores relationship metadata + the sealed root HASH only — never content (INV-3).
 *
 * test_type: integration — CELLO_ENV=local + Docker Postgres (clean flyway-migrated DB).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { PgDirectoryStore } from "../adapters/pg-directory-store.js";
import type { Logger, ConversationSealRecord } from "@cello-protocol/interfaces";

const isLocal = process.env["CELLO_ENV"] === "local";
const DATABASE_URL = process.env["DATABASE_URL"] ?? "postgresql://postgres:dev@localhost:5433/cello_dev";
const describeIntegration = isLocal ? describe : describe.skip;

function noopLogger(): Logger {
  const fn = () => { /* swallow */ };
  return { debug: fn, info: fn, warn: fn, error: fn } as unknown as Logger;
}

function makeSeal(over?: Partial<ConversationSealRecord>): ConversationSealRecord {
  const pA = Buffer.from(randomBytes(32)).toString("hex");
  const pB = Buffer.from(randomBytes(32)).toString("hex");
  return {
    conversationId: randomUUID(),
    merkleRootHex: Buffer.from(randomBytes(32)).toString("hex"),
    closeType: "MUTUAL_SEAL",
    closeTimestampMs: Date.now(),
    parties: [
      { pseudonym: pA, attestation: "DELIVERED", sealSignatureHex: Buffer.from(randomBytes(64)).toString("hex") },
      { pseudonym: pB, attestation: "DELIVERED", sealSignatureHex: Buffer.from(randomBytes(64)).toString("hex") },
    ],
    ...over,
  };
}

let pool: pg.Pool;

beforeAll(async () => {
  if (!isLocal) return;
  pool = new pg.Pool({ connectionString: DATABASE_URL });
  await pool.query("SELECT 1");
});
afterAll(async () => { if (isLocal) await pool?.end(); });
beforeEach(async () => {
  if (!isLocal) return;
  await pool.query("TRUNCATE conversation_seals, conversation_participation, conversation_attestations RESTART IDENTITY CASCADE");
});

describeIntegration("SEAL-2: conversation_seals/_participation/_attestations producer", () => {
  it("writes all three tables atomically with the right shape", async () => {
    const store = new PgDirectoryStore(pool, noopLogger());
    const seal = makeSeal({ closeType: "SEAL_UNILATERAL" });
    seal.parties[1]!.attestation = "ABSENT"; // unilateral: B absent

    await store.recordConversationSeal(seal, { correlationId: "seal2" });

    const cs = await pool.query(`SELECT close_type, encode(decode(merkle_root,'hex'),'hex') AS root, participant_count FROM conversation_seals WHERE conversation_id = $1`, [seal.conversationId]);
    expect(cs.rows).toHaveLength(1);
    expect(cs.rows[0]!.close_type).toBe("SEAL_UNILATERAL");
    expect(cs.rows[0]!.participant_count).toBe(2);

    const cp = await pool.query<{ party_pseudonym: string }>(`SELECT party_pseudonym FROM conversation_participation WHERE conversation_id = $1 ORDER BY party_pseudonym`, [seal.conversationId]);
    expect(cp.rows.map((r) => r.party_pseudonym).sort()).toEqual([seal.parties[0]!.pseudonym, seal.parties[1]!.pseudonym].sort());

    const ca = await pool.query<{ participant_pseudonym: string; attestation: string }>(`SELECT participant_pseudonym, attestation FROM conversation_attestations WHERE conversation_id = $1`, [seal.conversationId]);
    expect(ca.rows).toHaveLength(2);
    const byPseudo = Object.fromEntries(ca.rows.map((r) => [r.participant_pseudonym, r.attestation]));
    expect(byPseudo[seal.parties[0]!.pseudonym]).toBe("DELIVERED");
    expect(byPseudo[seal.parties[1]!.pseudonym]).toBe("ABSENT");
  });

  it("PRIVACY (INV-3): the three tables hold ONLY metadata columns — no content-bearing column", async () => {
    // CR/test-attacker note: privacy is enforced structurally (the input type + schema have no content
    // field). This pins it behaviorally — if a content-bearing column were ever added to any of the
    // three tables, this assertion fails. The graph stores relationship metadata + the sealed root
    // HASH only, never conversation content.
    const cols = async (t: string) =>
      (await pool.query<{ column_name: string }>(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`, [t])).rows.map((r) => r.column_name).sort();
    expect(await cols("conversation_seals")).toEqual(
      ["chain_hash", "close_reason_code", "close_type", "conversation_id", "id", "merkle_root", "participant_count", "seal_date"].sort(),
    );
    expect(await cols("conversation_participation")).toEqual(["chain_hash", "conversation_id", "id", "party_pseudonym"].sort());
    expect(await cols("conversation_attestations")).toEqual(
      ["attestation", "attested_at", "chain_hash", "conversation_id", "id", "participant_pseudonym", "seal_signature"].sort(),
    );
    // And merkle_root is the sealed root HASH (hex), never content — a recorded seal's value is exactly
    // the 64-hex root we passed in.
    const store = new PgDirectoryStore(pool, noopLogger());
    const seal = makeSeal();
    await store.recordConversationSeal(seal, { correlationId: "privacy" });
    const root = (await pool.query<{ merkle_root: string }>(`SELECT merkle_root FROM conversation_seals WHERE conversation_id = $1`, [seal.conversationId])).rows[0]!.merkle_root;
    expect(root).toBe(seal.merkleRootHex);
    expect(root).toMatch(/^[0-9a-f]{64}$/);
  });

  it("the analytics graph-edge query derives exactly one edge between the two parties", async () => {
    const store = new PgDirectoryStore(pool, noopLogger());
    const seal = makeSeal();
    await store.recordConversationSeal(seal, { correlationId: "edge" });

    // The exact Phase-2 graph_edges derivation — kept byte-identical to analytics-job.ts #readGraphEdges
    // (which is private, so it cannot be imported). If that production query changes, update this copy.
    const edges = await pool.query<{ pseudonym_a: string; pseudonym_b: string; edge_weight: string }>(
      `SELECT LEAST(p1.party_pseudonym, p2.party_pseudonym) AS pseudonym_a,
              GREATEST(p1.party_pseudonym, p2.party_pseudonym) AS pseudonym_b,
              COUNT(DISTINCT p1.conversation_id)::text AS edge_weight
       FROM conversation_participation p1
       JOIN conversation_participation p2 ON p1.conversation_id = p2.conversation_id AND p1.party_pseudonym < p2.party_pseudonym
       JOIN conversation_seals cs ON cs.conversation_id = p1.conversation_id
       GROUP BY pseudonym_a, pseudonym_b`,
    );
    expect(edges.rows).toHaveLength(1);
    const [a, b] = [seal.parties[0]!.pseudonym, seal.parties[1]!.pseudonym].sort();
    expect(edges.rows[0]!.pseudonym_a).toBe(a);
    expect(edges.rows[0]!.pseudonym_b).toBe(b);
    expect(edges.rows[0]!.edge_weight).toBe("1");
  });

  it("two sealed conversations between the SAME pair → edge weight 2 (the Sybil cluster signal)", async () => {
    const store = new PgDirectoryStore(pool, noopLogger());
    const pA = Buffer.from(randomBytes(32)).toString("hex");
    const pB = Buffer.from(randomBytes(32)).toString("hex");
    for (let i = 0; i < 2; i++) {
      await store.recordConversationSeal(makeSeal({
        parties: [
          { pseudonym: pA, attestation: "DELIVERED", sealSignatureHex: "00" },
          { pseudonym: pB, attestation: "DELIVERED", sealSignatureHex: "00" },
        ],
      }), { correlationId: `pair-${i}` });
    }
    const edges = await pool.query<{ edge_weight: string }>(
      `SELECT COUNT(DISTINCT p1.conversation_id)::text AS edge_weight
       FROM conversation_participation p1
       JOIN conversation_participation p2 ON p1.conversation_id = p2.conversation_id AND p1.party_pseudonym < p2.party_pseudonym
       GROUP BY LEAST(p1.party_pseudonym,p2.party_pseudonym), GREATEST(p1.party_pseudonym,p2.party_pseudonym)`,
    );
    expect(edges.rows).toHaveLength(1);
    expect(edges.rows[0]!.edge_weight).toBe("2");
  });

  it("all three tables stay hash-chain valid across multiple seals", async () => {
    const store = new PgDirectoryStore(pool, noopLogger());
    await store.recordConversationSeal(makeSeal(), { correlationId: "c1" });
    await store.recordConversationSeal(makeSeal(), { correlationId: "c2" });
    for (const table of ["conversation_seals", "conversation_participation", "conversation_attestations"] as const) {
      const result = await store.verifyChain(table);
      expect(result.valid, `${table} chain must be valid`).toBe(true);
    }
  });

  it("a duplicate conversation_id is benign — no throw, no second seal row (best-effort)", async () => {
    const store = new PgDirectoryStore(pool, noopLogger());
    const seal = makeSeal();
    await store.recordConversationSeal(seal, { correlationId: "dup-1" });
    // Second write for the SAME conversation_id — must NOT throw (best-effort), no second row.
    await expect(store.recordConversationSeal(seal, { correlationId: "dup-2" })).resolves.toBeUndefined();
    const cnt = await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM conversation_seals WHERE conversation_id = $1`, [seal.conversationId]);
    expect(cnt.rows[0]!.n).toBe("1");
  });
});
