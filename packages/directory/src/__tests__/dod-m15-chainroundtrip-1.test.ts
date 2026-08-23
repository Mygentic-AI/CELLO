/**
 * DOD-M15-CHAINROUNDTRIP-1 — a chained row hashes what the database will actually return.
 *
 * ─── The class ─────────────────────────────────────────────────────────────────────────────────
 *
 * `insertWithChain` hashes the record the CALLER supplies. `verifyChain` hashes `SELECT *`. Where a
 * column's stored type round-trips to a different JavaScript value, those two serializations differ
 * and the row **can never verify** — no tamper, no deletion, no fixture involved.
 *
 * ONE instance, found by measuring every chained table after a fully green suite:
 *
 *   sessions  BREAK at 6  — `uuid`, written as undashed hex, returned dashed. FIXED here.
 *
 * **`seal_notarizations` was recorded as a second instance and it is NOT one.** It was red because
 * `persist-018` SI-003 tampers a row to prove the verifier catches a tamper, and never put it back
 * — so the chain was reporting a tamper that really happened, exactly as designed. That test now
 * restores in a `finally`, and this enforcer covers the table like any other.
 *
 * The reason that cost three wrong diagnoses is worth more than the fix: a red chain looks the same
 * whether the data is wrong or the check is wrong, and I kept looking for a defect in the writer
 * because the writer is where a defect WOULD be. Nothing about the evidence pointed there. The
 * question that resolved it in one query was "which value is different, and who wrote it?"
 *
 * ─── Why the existing tests could not catch either ─────────────────────────────────────────────
 *
 * `federation-001` AC-012 truncates `sessions` and writes a `randomUUID()` — the DASHED form, which
 * round-trips trivially. It is a shape production never produces. That is the hollow-test question
 * "is the fixture the shape that BREAKS, or a neighbouring shape that works?" answered the wrong
 * way, and it is why this defect survived in a suite that has a test named for exactly this table.
 *
 * So every test here goes through the PRODUCTION entry point with the PRODUCTION value shape. None
 * builds a record by hand — a hand-built record would test the normalisation against itself.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID, randomBytes } from "node:crypto";
import { PgDirectoryStore } from "../adapters/pg-directory-store.js";
import {
  serializeRecord,
  computeChainHash,
  CHAIN_GENESIS,
  HASH_CHAINED_TABLES,
} from "../hash-chain.js";
import type { Logger } from "@cello-protocol/interfaces";

const isLocal = process.env["CELLO_ENV"] === "local";
const DATABASE_URL =
  process.env["DATABASE_URL"] ?? "postgresql://postgres:dev@localhost:5433/cello_dev";
const describeIntegration = isLocal ? describe : describe.skip;

function silentLogger(): Logger {
  return { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
}

/** Comments are prose. A guard that reads code must not be satisfiable by writing a comment. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/**
 * ─── WHY THESE TWO SCANNERS EXIST ──────────────────────────────────────────────────────────────
 *
 * The first version of the guard below sliced fixed windows — 1400 characters for the statement,
 * 700 for the handler — and both read straight past the end of the thing they were meant to be
 * reading. Review proved three bypasses by execution, including the one that matters most: revert
 * this unit's own headline fix to `.catch(() => {})` and the guard stayed GREEN, because the
 * 700-char window ran on into an unrelated `this.#logger?.info(...)` four lines below. A guard that
 * cannot catch the defect it was written for is worse than no guard: it retires the suspicion.
 *
 * So the extents are computed, not guessed. Both scanners track quote state so a bracket inside a
 * string literal cannot skew the depth count.
 */

/** Index of the bracket that closes the one opening at `open`, or -1 if unbalanced. */
function matchingClose(text: string, open: number): number {
  const opens: Record<string, string> = { "(": ")", "{": "}", "[": "]" };
  const stack: string[] = [];
  let quote: string | null = null;
  let escaped = false;
  for (let i = open; i < text.length; i++) {
    const c = text[i]!;
    if (quote !== null) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
    const close = opens[c];
    if (close !== undefined) { stack.push(close); continue; }
    if (c === ")" || c === "}" || c === "]") {
      if (stack.pop() !== c) return -1;
      if (stack.length === 0) return i;
    }
  }
  return -1;
}

/** Index of the `;` that ends the statement beginning at `start`, at bracket depth zero. */
function statementEnd(text: string, start: number): number {
  let depth = 0;
  let quote: string | null = null;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i]!;
    if (quote !== null) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
    if (c === "(" || c === "{" || c === "[") depth += 1;
    else if (c === ")" || c === "}" || c === "]") depth -= 1;
    else if (c === ";" && depth === 0) return i;
  }
  return text.length;
}

/**
 * NOT `describeIntegration` — this one needs no database, so it also holds on a machine where the
 * integration tests skip. The rule it protects is a source rule, not a runtime one.
 */
describe("DOD-M15-CHAINROUNDTRIP-1: a discarded store write cannot come back", () => {
  it("every fire-and-forget store write reports its failure to the logger", () => {
    /**
     * `canonicalUuid` is safe on unrecognised input BECAUSE Postgres rejects it loudly rather than
     * the value being coerced into a hash chain. That argument only holds if somebody hears the
     * rejection. It did not hold when this unit started: the sole production caller was
     *
     *     void this.#store.writeSessionWithParticipants(...).catch(() => {});
     *
     * which discarded the uuid syntax error AND the SI-001 ownership violation — a security guard
     * whose alarm was connected to nothing.
     *
     * Fire-and-forget itself is correct and this guard does not object to it: session delivery must
     * not block on the database. What it bans is fire-and-forget-and-SILENT. Written as a source
     * walk rather than a behavioural test because the shape is one character wide, is trivially
     * reintroduced by anyone tidying a catch block, and covers every future call site rather than
     * the one that happened to be wrong.
     */
    const src = dirname(fileURLToPath(import.meta.url));
    const file = join(src, "..", "directory-node.ts");
    const text = stripComments(readFileSync(file, "utf8"));

    /**
     * The ONE legitimate exemption: a callee that logs the failure itself. `recordNotarization`
     * logs `notarization.write.failed` with `{ sessionId, reason, attempt }` on BOTH of its retry
     * attempts before rethrowing, so its callers' `.catch()` really does have nothing left to say.
     *
     * I verified that by reading the method, not by trusting the `/* logged inside *​/` comment at
     * the call site — a comment asserting a safety property is how these survive review. Counted,
     * so a third silent notarization write cannot hide behind a reason checked for two.
     */
    const LOGS_INTERNALLY: Record<string, { count: number; why: string }> = {
      recordNotarization: {
        count: 2,
        why: "logs notarization.write.failed at ERROR on attempt 1 and 2, then rethrows",
      },
    };
    const exempted: Record<string, number> = {};

    // The handler must CALL the logger, not merely mention it: `.catch(() => { const _x =
    // this.#logger; })` is a token match and reports nothing. `#logger` is the only reporting
    // channel this class has — `console` is banned project-wide.
    const LOGS_THE_FAILURE = /this\.#logger\??\.(error|warn)\s*\(/;

    const silent: string[] = [];
    const marker = "void this.#store.";
    for (let i = text.indexOf(marker); i !== -1; i = text.indexOf(marker, i + 1)) {
      const stmt = text.slice(i, statementEnd(text, i));
      const method = /void this\.#store\.(\w+)/.exec(stmt)?.[1] ?? "<unknown>";

      // The TAIL `.catch()` — the last one in the statement — is the handler that sees every
      // rejection in the chain. An inner `.catch()` inside a `.then()` does not qualify.
      const catchAt = stmt.lastIndexOf(".catch(");
      if (catchAt === -1) {
        silent.push(`${method} — no .catch() at all: the rejection becomes an unhandled promise`);
        continue;
      }
      const openParen = stmt.indexOf("(", catchAt);
      const closeParen = matchingClose(stmt, openParen);
      if (closeParen === -1) {
        silent.push(`${method} — could not parse the .catch() handler; the guard will not guess`);
        continue;
      }
      const handler = stmt.slice(openParen, closeParen + 1);

      if (LOGS_THE_FAILURE.test(handler)) continue;
      if (LOGS_INTERNALLY[method]) {
        exempted[method] = (exempted[method] ?? 0) + 1;
        continue;
      }
      silent.push(`${method} — .catch() does not report to #logger: the failure is discarded`);
    }

    // A shrink is as wrong as a growth: if a call site went away, the count comes down with it,
    // deliberately. An exemption that silently covers fewer sites than it claims is a stale reason.
    for (const [method, { count, why }] of Object.entries(LOGS_INTERNALLY)) {
      expect(
        exempted[method] ?? 0,
        `${method} is exempted for ${count} call site(s) because it ${why}. The count no longer ` +
          `matches — re-read the method and confirm the reason still holds before adjusting this.`,
      ).toBe(count);
    }

    expect(
      silent,
      `These writes fail without telling anyone:\n  ${silent.join("\n  ")}\n\n` +
        `A store write whose failure is discarded means the operator's first evidence is a ` +
        `missing row hours later, with nothing connecting it to the cause. Keep the write ` +
        `non-blocking — log the rejection instead of dropping it.`,
    ).toEqual([]);
  });
});

describeIntegration("DOD-M15-CHAINROUNDTRIP-1: the production write shape verifies", () => {
  let pool: pg.Pool;
  let store: PgDirectoryStore;

  beforeAll(() => {
    pool = new pg.Pool({ connectionString: DATABASE_URL });
    store = new PgDirectoryStore(pool, silentLogger());
  });
  afterAll(async () => { await pool.end(); });

  it("sessions: a row written with the UNDASHED hex the daemon sends still verifies", async () => {
    /**
     * THE PRODUCTION SHAPE. `directory-node.ts` calls `writeSessionWithParticipants(sessionIdHex,
     * …)` where `sessionIdHex` is 32 hex characters with no dashes. The column is `uuid`, so
     * Postgres stores the canonical dashed form and returns it that way — and the chain hash was
     * computed over the undashed string.
     *
     * `writeSession` has NO production caller, so this path is the only way session rows are ever
     * written. Every one of them has been a hole.
     */
    const sessionIdHex = randomBytes(16).toString("hex");
    expect(sessionIdHex).not.toContain("-"); // the shape under test, stated so it cannot drift

    await store.writeSessionWithParticipants(
      sessionIdHex,
      "chainroundtrip-node",
      randomBytes(32).toString("hex"),
      randomBytes(32).toString("hex"),
    );

    const result = await store.verifyChain("sessions");
    expect(
      result.valid,
      `sessions does not verify after a write through the production path (break at ` +
        `${String(result.breakAtSequence)}). The value hashed at insert is not the value the ` +
        `database returns.`,
    ).toBe(true);
  });

  it("sessions: the DASHED form verifies too — the fix must not trade one shape for the other", async () => {
    // The shape `federation-001` AC-012 uses. It passed before this unit and must still pass: a
    // normalisation that only handles hex would break every caller that already sends a UUID.
    const sessionId = randomUUID();
    await store.writeSessionWithParticipants(
      sessionId,
      "chainroundtrip-node",
      randomBytes(32).toString("hex"),
      randomBytes(32).toString("hex"),
    );
    const result = await store.verifyChain("sessions");
    expect(result.valid, "the dashed form regressed").toBe(true);
  });

  it("sessions: every id form POSTGRES accepts verifies — including the braced ones", async () => {
    /**
     * The normaliser is only safe if it covers every shape Postgres will silently canonicalise.
     * Anything it misses is stored as something other than what was hashed: a new unverifiable row
     * rather than a loud error, which is the exact defect this unit exists to close.
     *
     * These four forms were checked against the running database — Postgres accepts all of them
     * and returns the canonical dashed lowercase form for each. Driven through the production
     * entry point rather than calling the normaliser directly, because a direct test would only
     * prove the function agrees with itself; what matters is whether the ROW verifies.
     */
    const hex = randomBytes(16).toString("hex");
    const d = (h: string): string =>
      `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;

    const forms: Array<[string, string]> = [
      ["undashed hex — what the daemon actually sends", hex],
      ["uppercase", hex.toUpperCase()],
      ["braced, undashed", `{${hex}}`],
      ["braced and dashed, uppercase", `{${d(hex).toUpperCase()}}`],
    ];

    for (const [label, form] of forms) {
      // A fresh id per form: the same id twice would collide on the primary key and the second
      // write would be a no-op that trivially "verifies".
      const fresh = randomBytes(16).toString("hex");
      const shaped = form.replace(hex, fresh).replace(hex.toUpperCase(), fresh.toUpperCase());
      await store.writeSessionWithParticipants(
        shaped,
        "chainroundtrip-node",
        randomBytes(32).toString("hex"),
        randomBytes(32).toString("hex"),
      );
      const result = await store.verifyChain("sessions");
      expect(
        result.valid,
        `a session id in the "${label}" form (${shaped}) produced a row that cannot verify ` +
          `(break at ${String(result.breakAtSequence)}). Postgres accepted and canonicalised it, ` +
          `so the value hashed at insert is not the value the database returns.`,
      ).toBe(true);
    }
  });

  it("seal_notarizations: a row whose bytea columns are Uint8Array still verifies", async () => {
    /**
     * THE CONSTRAINT: `recordNotarization` must keep converting every byte field with
     * `Buffer.from(...)` before it builds the record it hashes. `node-pg` returns `bytea` as a
     * Buffer, which serializes as `{"type":"Buffer",…}`; a `Uint8Array` does not. Drop that
     * conversion and every notarization row becomes unverifiable the moment it is written —
     * silently, because nothing verifies chains at runtime.
     *
     * This is a CONTROL, not a repro. It passes before and after this unit, by design. It is here
     * because that `Buffer.from` looks like redundant ceremony to anyone tidying the writer, and
     * three separate diagnoses of an unrelated red chain went looking at it first.
     */
    await store.recordNotarization({
      session_id: randomBytes(16),
      sealed_root: randomBytes(32),
      participant_a_pubkey: randomBytes(32),
      participant_b_pubkey: randomBytes(32),
      close_timestamp: Date.now(),
      frost_signature: randomBytes(64),
    });

    // Scoped to THIS row rather than the whole table, so a failure points at the notarization
    // writer and not at whoever last wrote to a shared table. The enforcer below covers the table.
    const { rows } = await pool.query<Record<string, unknown>>(
      `SELECT * FROM seal_notarizations ORDER BY id ASC`,
    );
    expect(rows.length, "the notarization was not written").toBeGreaterThan(0);
    const mine = rows[rows.length - 1]!;
    const prev = rows.length === 1 ? CHAIN_GENESIS : String(rows[rows.length - 2]!["chain_hash"]);
    expect(
      computeChainHash(serializeRecord(mine, "seal_notarizations"), prev),
      `the row recordNotarization just wrote does not chain to the row before it — the production ` +
        `writer has stopped normalising its bytea fields to Buffer`,
    ).toBe(String(mine["chain_hash"]));
  });

  it("EVERY hash-chained table verifies — the enforcer", async () => {
    /**
     * C1, and the only assertion that can prove the CLASS is closed rather than two instances of
     * it. Scoped to nothing: `verifyChain` over each table exactly as an operator or an auditing
     * node would run it.
     *
     * If this goes red for a table this file never touched, that is the point — it means something
     * else writes a value that does not survive its own column type, and finding that is worth
     * more than a green run.
     */
    /**
     * ─── THE LIST IS DERIVED, NEVER TYPED OUT ──────────────────────────────────────────────────
     *
     * Iterating a hand-maintained copy is the hollow shape this milestone keeps finding: add an
     * eleventh chained table and a typed-out loop just gets SHORTER. It never goes red, so the one
     * table nobody remembered to wire is precisely the one table nobody checks.
     *
     * Driving it off `HASH_CHAINED_TABLES` inverts that — the enforcer covers what the SYSTEM
     * says is chained, and any exemption has to be written down here in `EXEMPT` where a reader
     * trips over it, rather than expressed as an absence nobody can see.
     */
    const EXEMPT = new Set<string>([]); // empty, and it must stay that way — see below
    const tables = HASH_CHAINED_TABLES.filter((t) => !EXEMPT.has(t));
    expect(
      tables.length,
      "the enforcer is not covering every chained table — an exemption was added without a reason",
    ).toBe(HASH_CHAINED_TABLES.length);

    const broken: string[] = [];
    for (const t of tables) {
      const r = await store.verifyChain(t as never);
      if (!r.valid) broken.push(`${t} (break at ${String(r.breakAtSequence)})`);
    }
    expect(
      broken,
      `These hash-chained tables cannot verify: ${broken.join("; ")}. A chain that never verified ` +
        `cannot distinguish a tamper from a type that round-trips differently, which is the whole ` +
        `point of having it.`,
    ).toEqual([]);
  });
});
