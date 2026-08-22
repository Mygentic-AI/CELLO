/**
 * describeCause — say SOMETHING about a cause, never nothing.
 *
 * Extracted from `bin/directory.ts` so it can be tested without booting a directory: that file is an
 * entrypoint with top-level side effects, and a test that imports it starts a node.
 *
 * ─── Why this exists ───────────────────────────────────────────────────────────────────────────
 *
 * The unreachable-database path reported `err.message` directly, which is right until the message is
 * empty — and pg does throw errors with an empty message. The operator then read, verbatim, on the
 * way to `exit(1)`:
 *
 *   {"event":"directory.db.unavailable","level":"error","host":"localhost","port":"5433",
 *    "database":"cello_dev","nodeId":"local","env":"local","reason":""}
 *
 * The loudest line the process emits, carrying no cause at all. Observed while wiring up the compose
 * Postgres, and it bought a wrong first guess about which credential was at fault.
 *
 * A blank message is not a reason to fall silent: pg attaches a `code` — `ECONNREFUSED`, `28P01`
 * (bad password), `3D000` (no such database) — that names the fault exactly. This falls back through
 * the code, then the constructor name, then a literal statement that the error carried nothing, so
 * the field is never empty and the reader always learns whether the silence is ours or the driver's.
 */
export function describeCause(err: unknown): string {
  if (err instanceof Error) {
    if (err.message) return err.message;
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string" && code) return `${err.constructor.name} with no message, code ${code}`;
    return `${err.constructor.name} with no message and no code`;
  }
  const s = String(err);
  return s === "" ? "a non-Error value that stringifies to nothing was thrown" : s;
}
