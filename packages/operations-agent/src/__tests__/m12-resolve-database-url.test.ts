/**
 * M12 — the ops agent needs A DATABASE, not a description of an RDS instance.
 *
 * The startup gate demanded RDS_CREDENTIALS in every non-local environment and then, three lines
 * later, preferred DATABASE_URL and discarded them. On GCP there is no RDS to take credentials from,
 * so a correctly-configured agent refused to start with `RDS_CREDENTIALS required for CELLO_ENV=dev`
 * — an error naming a variable whose value it would never have used.
 *
 * The check was inline in main() behind `env !== "local"`, so the only way to exercise it was to boot
 * the process and read the exit code. That is why it survived: nothing could test it.
 */

import { describe, it, expect } from "vitest";
import { resolveDatabaseUrl } from "../server.js";

const RDS = JSON.stringify({ username: "u", password: "p@ss/word" });

describe("resolveDatabaseUrl", () => {
  it("uses DATABASE_URL alone, with no RDS_* anything", () => {
    // The GCP shape: one connection string, no RDS in the picture.
    const r = resolveDatabaseUrl("dev", { DATABASE_URL: "postgresql://a:b@10.0.0.1:5432/cello" });
    expect(r).toEqual({ ok: true, url: "postgresql://a:b@10.0.0.1:5432/cello" });
  });

  it("prefers DATABASE_URL over RDS_* when both are present", () => {
    // Which one wins has to be unambiguous — a deployment carrying both leftover RDS vars and a new
    // url must connect to exactly one database, and it must be the explicit one.
    const r = resolveDatabaseUrl("dev", {
      DATABASE_URL: "postgresql://a:b@10.0.0.1:5432/cello",
      RDS_CREDENTIALS: RDS,
      RDS_ENDPOINT: "old.rds.amazonaws.com",
    });
    expect(r).toEqual({ ok: true, url: "postgresql://a:b@10.0.0.1:5432/cello" });
  });

  it("still assembles a url from RDS_* when there is no DATABASE_URL", () => {
    // The AWS path is not deleted — it is what that deployment runs on until it is gone.
    const r = resolveDatabaseUrl("dev", {
      RDS_CREDENTIALS: RDS,
      RDS_ENDPOINT: "db.example",
      RDS_PORT: "5432",
      RDS_DB_NAME: "cello_dev",
    });
    expect(r.ok).toBe(true);
    // The password is percent-encoded: an unescaped '@' or '/' silently redirects the connection to
    // a different host or database rather than failing.
    expect((r as { url: string }).url).toBe("postgresql://u:p%40ss%2Fword@db.example:5432/cello_dev");
  });

  it("refuses a deployed env with NEITHER, and names both routes", () => {
    const r = resolveDatabaseUrl("production", {});
    expect(r.ok).toBe(false);
    // Naming only RDS_CREDENTIALS sends a GCP operator looking for an RDS instance that does not
    // exist — which is exactly what happened.
    expect((r as { reason: string }).reason).toMatch(/DATABASE_URL/);
    expect((r as { reason: string }).reason).toMatch(/RDS_CREDENTIALS/);
    expect((r as { reason: string }).reason).toMatch(/production/);
  });

  it("refuses malformed RDS_CREDENTIALS rather than connecting as the default user", () => {
    // Falling through to the `cello_ops_agent`/empty-password default would produce an auth failure
    // far from the JSON that caused it.
    const r = resolveDatabaseUrl("dev", { RDS_CREDENTIALS: "{not json" });
    expect(r.ok).toBe(false);
    expect((r as { reason: string }).reason).toMatch(/parse/i);
  });

  it("allows local to fall back with no credentials at all", () => {
    // A fresh checkout runs against a local Postgres without being configured first.
    const r = resolveDatabaseUrl("local", {});
    expect(r.ok).toBe(true);
    expect((r as { url: string }).url).toContain("@localhost:5432/cello_dev");
  });
});
