/**
 * M12 DOD-NODE-DIR-GCP-1 — the node's backup script.
 *
 * This backup is the ONLY copy of a node's FROST shares that exists off the VM: anti-entropy never
 * syncs `agent_key_shares` (DOD-INV-SHARES-LOCAL), and Cloud SQL's own automated backups die with
 * the instance. So the property under test is not "does it upload" — it is **does it ever report
 * success without a real dump behind it**, because that failure is invisible until a restore.
 *
 * The tests EXECUTE the script with stubbed `pg_dump`/`curl`, because the defect that motivated
 * them is invisible to reading: a shell pipeline reports the LAST command's exit status, so
 * `pg_dump … | gzip > f || fail` reported gzip's success and swallowed pg_dump's failure. Live,
 * that produced a 20-byte "backup" from a client/server version mismatch.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const SCRIPT = resolve(import.meta.dirname, "../../scripts/pg-backup-to-gcs.sh");

let binDir: string;

function stub(name: string, body: string): void {
  const p = join(binDir, name);
  writeFileSync(p, `#!/bin/sh\n${body}\n`);
  chmodSync(p, 0o755);
}

/**
 * `curl` serves three different roles in the script: metadata token, Secret Manager access, and
 * the upload. One stub answers all three by inspecting the URL, and records the upload.
 */
function stubCurl(uploadBehaviour = "exit 0"): void {
  stub(
    "curl",
    `for a in "$@"; do
  case "$a" in
    *metadata.google.internal*) echo '{"access_token":"fake-token"}'; exit 0 ;;
    *secretmanager.googleapis.com*) printf '{"payload":{"data":"%s"}}' "$(printf '{"username":"u","password":"p","host":"h","port":5432,"dbname":"d"}' | base64 | tr -d '\\n')"; exit 0 ;;
    *storage.googleapis.com/upload*) echo "$a" > "${"$"}{UPLOAD_MARKER}"; ${uploadBehaviour} ;;
  esac
done
exit 0`,
  );
}

/**
 * A dump whose COMPRESSED size clears the plausibility floor. Repeated identical DDL lines gzip to
 * a few hundred bytes, which trips the guard — the fixture has to look like a real schema dump.
 */
function stubRealisticDump(): void {
  stub("pg_dump", `i=0; while [ $i -lt 400 ]; do echo "CREATE TABLE t$i (id bigint primary key, payload text default '$(head -c 64 /dev/urandom | od -An -tx1 | tr -d ' \\n')');"; i=$((i+1)); done`);
}

beforeAll(() => {
  binDir = mkdtempSync(join(tmpdir(), "cello-backup-bin-"));
  stub("gzip", 'exec /usr/bin/gzip "$@"');
});

afterAll(() => {
  rmSync(binDir, { recursive: true, force: true });
});

interface Run { out: string; code: number }

function runBackup(env: Record<string, string> = {}): Run {
  try {
    const out = execFileSync("sh", [SCRIPT], {
      env: {
        PATH: `${binDir}:${process.env["PATH"]}`,
        CELLO_GSM_DB_CREDENTIALS: "projects/p/secrets/db/versions/latest",
        CELLO_BACKUP_BUCKET: "cello-backups-test",
        NODE_ID: "gcp-use1",
        UPLOAD_MARKER: join(binDir, "uploaded"),
        ...env,
      },
      encoding: "utf8",
      stdio: "pipe",
      timeout: 20_000,
    });
    return { out, code: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return { out: (e.stdout ?? "") + (e.stderr ?? ""), code: e.status ?? 1 };
  }
}

describe("DOD-NODE-DIR-GCP-1: pg-backup-to-gcs.sh", () => {
  it("FAILS when pg_dump fails, even though the compression step succeeds", () => {
    // The live bug: `pg_dump … | gzip > f` reports gzip's status. pg_dump aborted on a
    // client/server version mismatch, gzip happily compressed nothing, and the script carried on
    // with a 20-byte file. Reproduced here with the same shape — pg_dump writes nothing to stdout,
    // errors on stderr, exits non-zero.
    stub("pg_dump", 'echo "pg_dump: error: aborting because of server version mismatch" >&2; exit 1');
    stubCurl();
    const r = runBackup();

    expect(r.code).toBe(1);
    expect(r.out).toContain("directory.backup.failed");
    expect(r.out).toContain("pg_dump failed");
    expect(r.out).not.toContain("directory.backup.complete");
  });

  it("REFUSES to upload an implausibly small dump — a plausible-looking empty backup is the worst outcome", () => {
    // Belt and braces behind the above: even if pg_dump exits 0, a near-empty dump must not
    // replace a real backup history with something that looks fine until a restore.
    stub("pg_dump", "exit 0"); // exits clean, writes nothing
    stubCurl();
    const r = runBackup();

    expect(r.code).toBe(1);
    expect(r.out).toContain("implausibly small");
    expect(r.out).not.toContain("directory.backup.complete");
  });

  it("completes and uploads when pg_dump produces a real dump", () => {
    stubRealisticDump();
    stubCurl();
    const r = runBackup();

    expect(r.code).toBe(0);
    expect(r.out).toContain("directory.backup.complete");
    expect(r.out).toContain("gcp-use1/");
  });

  it("FAILS when the upload fails — a dump that never left the VM is not a backup", () => {
    stubRealisticDump();
    stubCurl("exit 22"); // curl's HTTP-error exit code
    const r = runBackup();

    expect(r.code).toBe(1);
    expect(r.out).toContain("upload to gs://cello-backups-test");
    expect(r.out).not.toContain("directory.backup.complete");
  });

  it("REFUSES when required configuration is absent, naming the variable", () => {
    stub("pg_dump", "exit 0");
    stubCurl();
    for (const missing of ["CELLO_GSM_DB_CREDENTIALS", "CELLO_BACKUP_BUCKET"]) {
      const r = runBackup({ [missing]: "" });
      expect(r.code, missing).toBe(1);
      expect(r.out, missing).toContain(missing);
    }
  });

  it("REFUSES a credential secret missing a field rather than dumping from a half-built DSN", () => {
    stub("pg_dump", "exit 0");
    stub(
      "curl",
      `for a in "$@"; do
  case "$a" in
    *metadata.google.internal*) echo '{"access_token":"t"}'; exit 0 ;;
    *secretmanager.googleapis.com*) printf '{"payload":{"data":"%s"}}' "$(printf '{"username":"u","password":"p"}' | base64 | tr -d '\\n')"; exit 0 ;;
  esac
done
exit 0`,
    );
    const r = runBackup();
    expect(r.code).toBe(1);
    expect(r.out).toContain("directory.backup.failed");
  });
});
