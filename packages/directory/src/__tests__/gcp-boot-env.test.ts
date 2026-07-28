/**
 * M12 DOD-NODE-DIR-GCP-1 — GCP boot environment resolution.
 *
 * A GCP directory node has no ECS-style secret injector: nothing populates NODE_PRIVATE_KEY or the
 * database password into the container's environment. The node fetches them itself from Secret
 * Manager, using the workload identity attached to the VM.
 *
 * Flyway (a JVM process in the entrypoint) needs the same database credentials as the node, so the
 * resolution happens ONCE and is emitted as shell `export` lines the entrypoint evaluates. That is
 * the only reason this produces text rather than setting process.env directly.
 *
 * Secrets are the subject, so these tests keep asking two questions: can a wrong/absent/blank
 * secret reach a running node, and can a secret value escape into somewhere it should not.
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

const REF = {
  db: "projects/cello-infra/secrets/db-creds/versions/latest",
  dbApp: "projects/cello-infra/secrets/db-app-creds/versions/latest",
  node: "projects/cello-infra/secrets/node-key/versions/latest",
  transport: "projects/cello-infra/secrets/transport-key/versions/latest",
  internal: "projects/cello-infra/secrets/internal-api-key/versions/latest",
  preauth: "projects/cello-infra/secrets/preauth-issuer-key/versions/latest",
};

// Distinguishable values: every assertion below can tell WHICH secret landed in WHICH variable.
const VAL = {
  node: "aa".repeat(32),
  transport: "bb".repeat(32),
  internal: "cc".repeat(32),
  preauth: "dd".repeat(32),
};

/** The schema owner — Flyway's credential. */
const DB_ADMIN_JSON = JSON.stringify({
  username: "postgres",
  password: "adm1n-pw",
  host: "10.10.0.7",
  port: 5432,
  dbname: "cello_dev",
});

/** The node's runtime credential — restricted, under RLS. */
const DB_APP_JSON = JSON.stringify({
  username: "cello_service",
  password: "p@ss w/ord:special",
  host: "10.10.0.7",
  port: 5432,
  dbname: "cello_dev",
});

function baseEnv(): NodeJS.ProcessEnv {
  return {
    CELLO_GSM_DB_CREDENTIALS: REF.db,
    CELLO_GSM_DB_APP_CREDENTIALS: REF.dbApp,
    CELLO_GSM_NODE_KEY: REF.node,
    CELLO_GSM_TRANSPORT_KEY: REF.transport,
    CELLO_GSM_INTERNAL_API_KEY: REF.internal,
    CELLO_GSM_PREAUTH_ISSUER_KEY: REF.preauth,
  };
}

function baseValues(): Record<string, string> {
  return {
    [REF.db]: DB_ADMIN_JSON,
    [REF.dbApp]: DB_APP_JSON,
    [REF.node]: VAL.node,
    [REF.transport]: VAL.transport,
    [REF.internal]: VAL.internal,
    [REF.preauth]: VAL.preauth,
  };
}

describe("DOD-NODE-DIR-GCP-1: buildGcpBootEnv", () => {
  it("binds each secret to the RIGHT variable — not merely to some variable", async () => {
    // Asserting only that `export NODE_PRIVATE_KEY=` appears would stay green if two rows of the
    // binding table were swapped, booting the node with its identity seed as its transport key.
    // The values are distinguishable so the binding itself is what is under test.
    const { script } = await buildGcpBootEnv(baseEnv(), fakeSecrets(baseValues()));

    expect(script).toContain(`export NODE_PRIVATE_KEY='${VAL.node}'`);
    // Same key, bound twice, exactly as the AWS task definition binds it.
    expect(script).toContain(`export CELLO_DIRECTORY_NODE_KEY_HEX='${VAL.node}'`);
    expect(script).toContain(`export CELLO_DIRECTORY_TRANSPORT_KEY_HEX='${VAL.transport}'`);
    expect(script).toContain(`export INTERNAL_API_KEY='${VAL.internal}'`);
    expect(script).toContain(`export CELLO_PREAUTH_ISSUER_KEY_HEX='${VAL.preauth}'`);
  });

  it("URL-ENCODES the password in DATABASE_URL but passes Flyway the RAW value", async () => {
    // The two consumers disagree by design: a connection URL must be percent-encoded, and Flyway's
    // env vars are not URL-decoded, so encoding them corrupts the password. The AWS entrypoint
    // learned this the hard way; the GCP path must not relearn it.
    const { script } = await buildGcpBootEnv(baseEnv(), fakeSecrets(baseValues()));
    expect(script).toContain(
      `export DATABASE_URL='postgresql://cello_service:${encodeURIComponent("p@ss w/ord:special")}@10.10.0.7:5432/cello_dev?sslmode=no-verify'`,
    );
    // Flyway gets the SCHEMA OWNER, the node gets the restricted role — they are different
    // credentials on purpose. Running the node as the owner bypasses every RLS policy and the
    // UPDATE/DELETE revokes that make the seal tables append-only.
    expect(script).toContain(`export FLYWAY_USER='postgres'`);
    expect(script).toContain(`export FLYWAY_PASSWORD='adm1n-pw'`);
  });

  it("gives Flyway a JDBC URL with NO sslmode — pgjdbc rejects libpq's 'no-verify'", async () => {
    // pgjdbc accepts only disable|allow|prefer|require|verify-ca|verify-full and throws
    // `Invalid sslmode value: no-verify`. Cloud SQL enforces TLS server-side (ENCRYPTED_ONLY),
    // so the JDBC URL carries no sslmode at all. Getting this wrong fails the FIRST migration on
    // a brand-new node, which is the least debuggable moment there is.
    const { script } = await buildGcpBootEnv(baseEnv(), fakeSecrets(baseValues()));
    const line = script.split("\n").find((l) => l.startsWith("export FLYWAY_URL="))!;
    expect(line).toBe("export FLYWAY_URL='jdbc:postgresql://10.10.0.7:5432/cello_dev'");
    expect(line).not.toContain("sslmode");
  });

  it("ENCODES every URL component, not just the password", async () => {
    // A username containing '@' would otherwise produce a URL that parses to a different host.
    const values = baseValues();
    values[REF.dbApp] = JSON.stringify({
      username: "svc@node", password: "pw", host: "10.10.0.7", port: 5432, dbname: "cello_dev",
    });
    const { script } = await buildGcpBootEnv(baseEnv(), fakeSecrets(values));
    const line = script.split("\n").find((l) => l.startsWith("export DATABASE_URL="))!;
    expect(line).toContain("svc%40node");
    expect(new URL(line.slice("export DATABASE_URL='".length, -1)).hostname).toBe("10.10.0.7");
  });

  it("SINGLE-QUOTES values and escapes embedded quotes so a password cannot break out into a command", async () => {
    // The output is eval'd by the entrypoint. A password containing a quote and a shell
    // metacharacter must stay a value, not become an instruction.
    const values = baseValues();
    values[REF.db] = JSON.stringify({
      username: "postgres",
      password: "a'b; touch /tmp/pwned #",
      host: "10.10.0.7",
      port: 5432,
      dbname: "cello_dev",
    });
    const { script } = await buildGcpBootEnv(baseEnv(), fakeSecrets(values));
    const line = script.split("\n").find((l) => l.startsWith("export FLYWAY_PASSWORD="))!;
    // POSIX single-quote escaping: ' becomes '\'' — the payload never leaves quoted context.
    expect(line).toBe(`export FLYWAY_PASSWORD='a'\\''b; touch /tmp/pwned #'`);
  });

  it("REFUSES when two DISTINCT key purposes point at the SAME secret", async () => {
    // A copy-pasted MIG template pointing the transport key at the node-key resource would
    // otherwise boot cleanly, with one key serving as both the node's long-term identity and its
    // libp2p transport key. This is the only place the DoD's "fresh transport key, never copied"
    // is enforced in code.
    const env = baseEnv();
    env["CELLO_GSM_TRANSPORT_KEY"] = REF.node;
    await expect(buildGcpBootEnv(env, fakeSecrets(baseValues()))).rejects.toThrow(
      /must not share one secret/,
    );
  });

  it("fetches each distinct secret EXACTLY once when two variables legitimately share one", async () => {
    // NODE_PRIVATE_KEY and CELLO_DIRECTORY_NODE_KEY_HEX are the same key by design. Both must be
    // exported, from ONE fetch — a second access only doubles the audit trail.
    const secrets = fakeSecrets(baseValues());
    const { script } = await buildGcpBootEnv(baseEnv(), secrets);
    expect(secrets.requested.filter((n) => n === REF.node)).toHaveLength(1);
    expect(script).toContain(`export NODE_PRIVATE_KEY='${VAL.node}'`);
    expect(script).toContain(`export CELLO_DIRECTORY_NODE_KEY_HEX='${VAL.node}'`);
  });

  it("REFUSES when a REQUIRED secret reference is missing — naming the variable", async () => {
    const env = baseEnv();
    delete env["CELLO_GSM_TRANSPORT_KEY"];
    await expect(buildGcpBootEnv(env, fakeSecrets(baseValues()))).rejects.toThrow(
      /CELLO_GSM_TRANSPORT_KEY/,
    );
  });

  it("REFUSES when the APPLICATION database reference is missing — it must not fall back to the owner", async () => {
    // The whole point of two credentials is that the node never connects as the schema owner.
    // Falling back would silently restore the exact configuration this split exists to remove:
    // the owner bypasses every RLS policy and the UPDATE/DELETE revokes on the seal tables.
    const env = baseEnv();
    delete env["CELLO_GSM_DB_APP_CREDENTIALS"];
    await expect(buildGcpBootEnv(env, fakeSecrets(baseValues()))).rejects.toThrow(
      /CELLO_GSM_DB_APP_CREDENTIALS/,
    );
  });

  it("never gives the node the SCHEMA OWNER's credential", async () => {
    const { script } = await buildGcpBootEnv(baseEnv(), fakeSecrets(baseValues()));
    const dbUrl = script.split("\n").find((l) => l.startsWith("export DATABASE_URL="))!;
    expect(dbUrl).toContain("cello_service");
    expect(dbUrl).not.toContain("postgres:");   // the ROLE, not the postgresql:// scheme
    expect(dbUrl).not.toContain("adm1n-pw");
  });

  it("REFUSES when the database credential reference is missing", async () => {
    const env = baseEnv();
    delete env["CELLO_GSM_DB_CREDENTIALS"];
    await expect(buildGcpBootEnv(env, fakeSecrets(baseValues()))).rejects.toThrow(
      /CELLO_GSM_DB_CREDENTIALS/,
    );
  });

  it("SKIPS the optional pre-auth issuer key, reporting it rather than failing or silently omitting", async () => {
    // One issuer identity is shared across regions — it is the single key here that is NOT
    // per-node. Requiring it would force that cross-region signing identity into every node's
    // Secret Manager, including nodes that never issue a capability.
    const env = baseEnv();
    delete env["CELLO_GSM_PREAUTH_ISSUER_KEY"];
    const { script, skipped } = await buildGcpBootEnv(env, fakeSecrets(baseValues()));
    expect(skipped).toEqual(["CELLO_PREAUTH_ISSUER_KEY_HEX"]);
    expect(script).not.toContain("CELLO_PREAUTH_ISSUER_KEY_HEX");
    // …and the rest still resolves.
    expect(script).toContain(`export NODE_PRIVATE_KEY='${VAL.node}'`);
  });

  it("REFUSES when Secret Manager returns an EMPTY secret rather than exporting a blank key", async () => {
    // An empty transport key would start the node with an unstable peer id; an empty node key
    // would produce a garbage identity. Both must stop the boot, not degrade it.
    const values = baseValues();
    values[REF.transport] = "";
    await expect(buildGcpBootEnv(baseEnv(), fakeSecrets(values))).rejects.toThrow(/EMPTY secret/);
  });

  it("REFUSES when Secret Manager denies access — the silent-403 trap must be loud", async () => {
    const secrets: SecretAccessor = {
      async access(name: string): Promise<string> {
        if (name === REF.node) throw new Error("PERMISSION_DENIED: secretmanager.versions.access");
        return baseValues()[name] ?? "";
      },
    };
    await expect(buildGcpBootEnv(baseEnv(), secrets)).rejects.toThrow(/PERMISSION_DENIED/);
  });

  it("REFUSES a database credential secret that is not the expected JSON shape, WITHOUT quoting it", async () => {
    // Node embeds an excerpt of the input in a JSON SyntaxError message, and the input here is a
    // credential blob — so the parse error must be replaced, not wrapped.
    const values = baseValues();
    values[REF.db] = "s3cr3t-looking-garbage";
    await expect(buildGcpBootEnv(baseEnv(), fakeSecrets(values))).rejects.toThrow(
      /CELLO_GSM_DB_CREDENTIALS secret is not JSON/,
    );
    await expect(buildGcpBootEnv(baseEnv(), fakeSecrets(values))).rejects.not.toThrow(
      /s3cr3t-looking-garbage/,
    );
  });

  it("REFUSES a database credential JSON missing a required field", async () => {
    const values = baseValues();
    values[REF.db] = JSON.stringify({
      username: "cello_service", password: "x", host: "10.10.0.7", // no port, no dbname
    });
    await expect(buildGcpBootEnv(baseEnv(), fakeSecrets(values))).rejects.toThrow(/port|dbname/);
  });

  it("emits ONLY export lines — the caller evaluates this, so anything else would execute", async () => {
    const { script } = await buildGcpBootEnv(baseEnv(), fakeSecrets(baseValues()));
    for (const line of script.split("\n").filter((l) => l !== "")) {
      expect(line).toMatch(/^export [A-Z_][A-Z0-9_]*='/);
    }
    // The secret REFERENCES are not exported: exactly one component resolves secrets, and leaking
    // the resource names invites a second, unaudited fetch path.
    expect(script).not.toContain("CELLO_GSM_");
    expect(script).not.toContain("versions/latest");
  });
});
