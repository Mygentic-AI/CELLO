/**
 * M12 DOD-NODE-DIR-GCP-1 — docker-entrypoint.sh, the GCP branch.
 *
 * This is the seam between the TypeScript and the shell, and it is where the riskiest line in the
 * unit lives: an `eval` over whatever the secret resolver printed. The tests EXECUTE the script
 * with a stubbed `node` on PATH rather than grepping it, because the defect this file exists to
 * prevent — `eval "$(cmd)"` reporting eval's exit status instead of cmd's, so `set -e` never
 * fires — is invisible to any amount of reading.
 *
 * Flyway is stubbed too: the subject is the boot-environment block, not the migration.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ENTRYPOINT = resolve(import.meta.dirname, "../../docker-entrypoint.sh");

let binDir: string;

/** Put an executable stub on PATH ahead of the real thing. */
function stub(name: string, body: string): void {
  const p = join(binDir, name);
  writeFileSync(p, `#!/bin/sh\n${body}\n`);
  chmodSync(p, 0o755);
}

beforeAll(() => {
  binDir = mkdtempSync(join(tmpdir(), "cello-entrypoint-bin-"));
  // The entrypoint's last act is `exec node <dist path>`; stubbing `node` covers both that and the
  // gcp-boot-env invocation, so each test overrides `node` with what it needs.
  stub("flyway", 'echo "FLYWAY_RAN url=$FLYWAY_URL user=$FLYWAY_USER"');
});

afterAll(() => {
  rmSync(binDir, { recursive: true, force: true });
});

interface Run { stdout: string; code: number }

function runEntrypoint(env: Record<string, string>): Run {
  try {
    const stdout = execFileSync("sh", [ENTRYPOINT], {
      env: { PATH: `${binDir}:${process.env["PATH"]}`, ...env },
      encoding: "utf8",
      stdio: "pipe",
      timeout: 20_000,
    });
    return { stdout, code: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return { stdout: (e.stdout ?? "") + (e.stderr ?? ""), code: e.status ?? 1 };
  }
}

/**
 * The boot-env resolver's stdout is evaluated, and the real binary lives at an absolute path
 * inside the image. `node` is stubbed to answer for that path and to exec nothing else.
 */
function nodeStub(bootEnvBody: string): void {
  // `;;` on its own line: a stub body ending in a heredoc terminator would otherwise produce
  // `EOF ;;`, which does not terminate the heredoc and silently swallows the rest of the script.
  stub(
    "node",
    `case "$1" in
  *gcp-boot-env.js)
${bootEnvBody}
    ;;
  *)
    echo "DIRECTORY_STARTED db=$DATABASE_URL"
    ;;
esac`,
  );
}

const GCP_ENV = { CELLO_ENV: "dev", CELLO_CLOUD: "gcp" };

describe("DOD-NODE-DIR-GCP-1: docker-entrypoint.sh GCP branch", () => {
  it("REFUSES TO BOOT when secret resolution exits non-zero", () => {
    // The defect this guards: `eval "$(cmd)"` takes eval's status, not cmd's, so `set -e` does not
    // abort. The node would then run Flyway and start against no database.
    nodeStub('echo "{\\"event\\":\\"directory.gcp.boot_env.failed\\"}" >&2; exit 1');
    const r = runEntrypoint(GCP_ENV);

    expect(r.code).toBe(1);
    // …and it must NOT claim success on the way down.
    expect(r.stdout).not.toContain("boot_env.resolved");
    expect(r.stdout).not.toContain("FLYWAY_RAN");
    expect(r.stdout).not.toContain("DIRECTORY_STARTED");
  });

  it("does not report an AWS cause for a GCP secrets failure", () => {
    // Before the guard, the terminal line named RDS_CREDENTIALS_SECRET_ARN — an AWS Secrets
    // Manager ARN — on a node holding no AWS credentials, and blamed a migration that never ran.
    nodeStub("exit 1");
    const r = runEntrypoint(GCP_ENV);
    expect(r.stdout).not.toContain("RDS_CREDENTIALS_SECRET_ARN");
    expect(r.stdout).toContain("boot_env.failed");
  });

  it("REFUSES to evaluate output that is not an export assignment", () => {
    // stdout is eval'd, so a stray line executes. The binary promises to emit only exports; this
    // is the enforcement, because a promise in a comment is not a control.
    nodeStub(`echo "touch ${join(binDir, "PWNED")}"`);
    const r = runEntrypoint(GCP_ENV);

    expect(r.code).toBe(1);
    expect(r.stdout).toContain("not an export assignment");
    expect(() => execFileSync("test", ["-e", join(binDir, "PWNED")])).toThrow();
  });

  it("evaluates a well-formed environment and PRESERVES the Flyway URL it was given", () => {
    // The regression: the AWS-path derivation below re-built FLYWAY_URL from DATABASE_URL,
    // appending `?sslmode=no-verify` — a libpq value pgjdbc rejects, failing the first migration.
    nodeStub(`cat <<'EOF'
export DATABASE_URL='postgresql://cello_service:pw@10.10.0.7:5432/cello_dev?sslmode=no-verify'
export FLYWAY_URL='jdbc:postgresql://10.10.0.7:5432/cello_dev'
export FLYWAY_USER='cello_service'
export FLYWAY_PASSWORD='pw'
EOF`);
    const r = runEntrypoint(GCP_ENV);

    expect(r.code).toBe(0);
    expect(r.stdout).toContain("boot_env.resolved");
    const flywayLine = r.stdout.split("\n").find((l) => l.startsWith("FLYWAY_RAN"))!;
    expect(flywayLine).toBe("FLYWAY_RAN url=jdbc:postgresql://10.10.0.7:5432/cello_dev user=cello_service");
    // pgjdbc rejects libpq's `no-verify`, so the JDBC URL must carry no sslmode at all…
    expect(flywayLine).not.toContain("sslmode");
    // …while the node receives the libpq URL, which DOES.
    expect(r.stdout).toContain("DIRECTORY_STARTED db=postgresql://cello_service:pw@10.10.0.7:5432/cello_dev?sslmode=no-verify");
  });

  it("treats CELLO_CLOUD=GCP the same as gcp — directory.ts lowercases before validating", () => {
    // A case mismatch between the two halves would pass validation in the node and skip resolution
    // here, producing the AWS-shaped failure above for a purely cosmetic reason.
    nodeStub(`echo "export DATABASE_URL='postgresql://u:p@h:5432/d'"`);
    const r = runEntrypoint({ CELLO_ENV: "dev", CELLO_CLOUD: "GCP" });
    expect(r.stdout).toContain("boot_env.resolving");
  });

  it("leaves the AWS path untouched — no resolution attempted when CELLO_CLOUD is unset", () => {
    nodeStub("echo SHOULD_NOT_RUN");
    const r = runEntrypoint({
      CELLO_ENV: "dev",
      DATABASE_URL: "postgresql://u:p@awshost:5432/cello_dev",
    });
    expect(r.code).toBe(0);
    expect(r.stdout).not.toContain("boot_env");
    // The AWS derivation still produces the JDBC URL from DATABASE_URL, exactly as before.
    expect(r.stdout).toContain("FLYWAY_RAN url=jdbc:postgresql://awshost:5432/cello_dev user=u");
  });
});
