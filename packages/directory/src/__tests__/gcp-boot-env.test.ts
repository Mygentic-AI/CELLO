/**
 * M12 DOD-NODE-DIR-GCP-1 — GCP boot environment resolution.
 *
 * A GCP directory node has no ECS-style secret injector: nothing populates NODE_PRIVATE_KEY or the
 * database password into the container's environment. The node fetches them itself from Secret
 * Manager at boot, using the workload identity attached to the VM.
 *
 * Flyway (a JVM process in the entrypoint) needs the same database credentials as the node, so the
 * resolution happens ONCE and is emitted as shell `export` lines the entrypoint evaluates. That is
 * the only reason this produces text rather than setting process.env directly.
 *
 * Secrets are the subject here, so every test below is really asking one of two questions:
 * does an absent/blank secret stop the boot, and can a secret escape into somewhere it should not.
 */

import { describe, it, expect } from "vitest";
import { buildGcpBootEnv, type SecretAccessor } from "../gcp-boot-env.js";

/** Records what was requested so tests can assert the node asks for exactly what it needs. */
function fakeSecrets(values: Record<string, string>): SecretAccessor & { requested: string[] } {
  const requested: string[] = [];
  return {
    requested,
    async access(name: string): Promise<string> {
      requested.push(name);
      const v = values[name];
      if (v === undefined) throw new Error(`NOT_FOUND: ${name}`);
      return v;
    },
  };
}

const DB_JSON = JSON.stringify({
  username: "cello_service",
  password: "p@ss w/ord:special",
  host: "10.10.0.7",
  port: 5432,
  dbname: "cello_dev",
});

function baseEnv(): NodeJS.ProcessEnv {
  return {
    CELLO_GSM_DB_CREDENTIALS: "projects/cello-infra/secrets/db-creds/versions/latest",
    CELLO_GSM_NODE_KEY: "projects/cello-infra/secrets/node-key/versions/latest",
    CELLO_GSM_TRANSPORT_KEY: "projects/cello-infra/secrets/transport-key/versions/latest",
    CELLO_GSM_INTERNAL_API_KEY: "projects/cello-infra/secrets/internal-api-key/versions/latest",
    CELLO_GSM_PREAUTH_ISSUER_KEY: "projects/cello-infra/secrets/preauth-issuer-key/versions/latest",
  };
}

function baseValues(): Record<string, string> {
  return {
    "projects/cello-infra/secrets/db-creds/versions/latest": DB_JSON,
    "projects/cello-infra/secrets/node-key/versions/latest": "aa".repeat(32),
    "projects/cello-infra/secrets/transport-key/versions/latest": "bb".repeat(32),
    "projects/cello-infra/secrets/internal-api-key/versions/latest": "internal-key-value",
    "projects/cello-infra/secrets/preauth-issuer-key/versions/latest": "cc".repeat(32),
  };
}

describe("DOD-NODE-DIR-GCP-1: buildGcpBootEnv", () => {
  it("emits every variable the node and Flyway need, from Secret Manager", async () => {
    const out = await buildGcpBootEnv(baseEnv(), fakeSecrets(baseValues()));

    // The node's own reads (bin/directory.ts) …
    expect(out).toContain("export NODE_PRIVATE_KEY=");
    expect(out).toContain("export CELLO_DIRECTORY_NODE_KEY_HEX=");
    expect(out).toContain("export CELLO_DIRECTORY_TRANSPORT_KEY_HEX=");
    expect(out).toContain("export INTERNAL_API_KEY=");
    expect(out).toContain("export CELLO_PREAUTH_ISSUER_KEY_HEX=");
    // … and the database, which BOTH the node (DATABASE_URL) and Flyway (FLYWAY_*) consume.
    expect(out).toContain("export DATABASE_URL=");
    expect(out).toContain("export FLYWAY_URL=");
    expect(out).toContain("export FLYWAY_USER=");
    expect(out).toContain("export FLYWAY_PASSWORD=");
  });

  it("URL-ENCODES the password in DATABASE_URL but passes Flyway the RAW value", async () => {
    // The two consumers disagree by design: a connection URL must be percent-encoded, and Flyway's
    // env vars are not URL-decoded, so encoding them corrupts the password. The AWS entrypoint
    // learned this the hard way; the GCP path must not relearn it.
    const out = await buildGcpBootEnv(baseEnv(), fakeSecrets(baseValues()));
    expect(out).toContain(`export DATABASE_URL='postgresql://cello_service:${encodeURIComponent("p@ss w/ord:special")}@10.10.0.7:5432/cello_dev?sslmode=no-verify'`);
    expect(out).toContain(`export FLYWAY_PASSWORD='p@ss w/ord:special'`);
    expect(out).toContain("export FLYWAY_URL='jdbc:postgresql://10.10.0.7:5432/cello_dev'");
  });

  it("SINGLE-QUOTES values and escapes embedded quotes so a password cannot break out into a command", async () => {
    // The output is eval'd by the entrypoint. A password containing a quote and a shell
    // metacharacter must stay a value, not become an instruction.
    const values = baseValues();
    values["projects/cello-infra/secrets/db-creds/versions/latest"] = JSON.stringify({
      username: "cello_service",
      password: "a'b; touch /tmp/pwned #",
      host: "10.10.0.7",
      port: 5432,
      dbname: "cello_dev",
    });
    const out = await buildGcpBootEnv(baseEnv(), fakeSecrets(values));
    const line = out.split("\n").find((l) => l.startsWith("export FLYWAY_PASSWORD="))!;
    // POSIX single-quote escaping: ' becomes '\'' — the payload never leaves quoted context.
    expect(line).toBe(`export FLYWAY_PASSWORD='a'\\''b; touch /tmp/pwned #'`);
  });

  it("REFUSES when a secret reference env var is missing — naming the variable", async () => {
    const env = baseEnv();
    delete env["CELLO_GSM_TRANSPORT_KEY"];
    await expect(buildGcpBootEnv(env, fakeSecrets(baseValues()))).rejects.toThrow(
      /CELLO_GSM_TRANSPORT_KEY/,
    );
  });

  it("REFUSES when Secret Manager returns an EMPTY secret rather than exporting a blank key", async () => {
    // An empty transport key would start the node with an unstable peer id; an empty node key
    // would produce a garbage identity. Both must stop the boot, not degrade it.
    const values = baseValues();
    values["projects/cello-infra/secrets/transport-key/versions/latest"] = "";
    await expect(buildGcpBootEnv(baseEnv(), fakeSecrets(values))).rejects.toThrow(
      /transport-key|CELLO_GSM_TRANSPORT_KEY/,
    );
  });

  it("REFUSES when Secret Manager denies access — the silent-403 trap must be loud", async () => {
    const secrets: SecretAccessor = {
      async access(name: string): Promise<string> {
        if (name.includes("node-key")) throw new Error("PERMISSION_DENIED: secretmanager.versions.access");
        return baseValues()[name] ?? "";
      },
    };
    await expect(buildGcpBootEnv(baseEnv(), secrets)).rejects.toThrow(/PERMISSION_DENIED/);
  });

  it("REFUSES a database credential secret that is not the expected JSON shape", async () => {
    const values = baseValues();
    values["projects/cello-infra/secrets/db-creds/versions/latest"] = "just-a-password";
    await expect(buildGcpBootEnv(baseEnv(), values2accessor(values))).rejects.toThrow(
      /CELLO_GSM_DB_CREDENTIALS/,
    );
  });

  it("REFUSES a database credential JSON missing a required field", async () => {
    const values = baseValues();
    values["projects/cello-infra/secrets/db-creds/versions/latest"] = JSON.stringify({
      username: "cello_service", password: "x", host: "10.10.0.7", // no port, no dbname
    });
    await expect(buildGcpBootEnv(baseEnv(), values2accessor(values))).rejects.toThrow(
      /port|dbname/,
    );
  });

  it("never emits the secret REFERENCES, only the resolved values", async () => {
    // The resource names are not sensitive, but leaking them into the node's environment invites
    // a second, unaudited fetch path. Exactly one component resolves secrets.
    const out = await buildGcpBootEnv(baseEnv(), fakeSecrets(baseValues()));
    expect(out).not.toContain("CELLO_GSM_");
    expect(out).not.toContain("versions/latest");
  });

  it("requests each distinct secret EXACTLY once even though two variables share one", async () => {
    // NODE_PRIVATE_KEY and CELLO_DIRECTORY_NODE_KEY_HEX are the same key (as on AWS). Fetching it
    // twice doubles the access-audit noise for no benefit.
    const secrets = fakeSecrets(baseValues());
    await buildGcpBootEnv(baseEnv(), secrets);
    const nodeKeyFetches = secrets.requested.filter((n) => n.includes("node-key"));
    expect(nodeKeyFetches).toHaveLength(1);
  });
});

function values2accessor(values: Record<string, string>): SecretAccessor {
  return {
    async access(name: string): Promise<string> {
      const v = values[name];
      if (v === undefined) throw new Error(`NOT_FOUND: ${name}`);
      return v;
    },
  };
}
