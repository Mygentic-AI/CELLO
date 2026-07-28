/**
 * M12 DOD-NODE-DIR-GCP-1 — resolve a GCP directory node's boot secrets.
 *
 * On AWS, ECS injects secrets into the task environment (`ValueFrom`) and the entrypoint fetches
 * only the database credentials. A GCP node running under Container-Optimized OS has no equivalent:
 * container environment comes from instance metadata, which is readable by anything holding
 * `compute.instances.get`, so secrets must not travel that way. The node fetches them itself with
 * the workload identity attached to the VM.
 *
 * Flyway runs in the entrypoint, before the node process exists, and needs the same database
 * credentials. Resolving once and emitting shell `export` lines for the entrypoint to evaluate
 * keeps a single fetch path — two independent resolvers is how the two ends drift apart.
 *
 * Every failure here is fatal by design. A blank transport key yields an unstable peer id; a blank
 * node key yields a garbage identity; a wrong database credential yields a node that answers
 * queries against nothing. None of those may degrade quietly (M12-PROCEDURE §5, ABSENT IS NOT FINE).
 */

/** The one capability this module needs from Secret Manager. Injected so it is testable. */
export interface SecretAccessor {
  /** Resolve a secret VERSION resource name to its payload. Throws if absent or inaccessible. */
  access(resourceName: string): Promise<string>;
}

/**
 * Target environment variable → the env var naming its Secret Manager version resource.
 *
 * `NODE_PRIVATE_KEY` and `CELLO_DIRECTORY_NODE_KEY_HEX` deliberately share one secret: they are the
 * same Ed25519 key, and the AWS task definition binds both to the same secret ARN. Keeping the
 * duplication visible here beats a node whose two halves disagree about its own identity.
 */
const SECRET_BINDINGS: ReadonlyArray<readonly [target: string, refVar: string]> = [
  ["NODE_PRIVATE_KEY", "CELLO_GSM_NODE_KEY"],
  ["CELLO_DIRECTORY_NODE_KEY_HEX", "CELLO_GSM_NODE_KEY"],
  ["CELLO_DIRECTORY_TRANSPORT_KEY_HEX", "CELLO_GSM_TRANSPORT_KEY"],
  ["INTERNAL_API_KEY", "CELLO_GSM_INTERNAL_API_KEY"],
  ["CELLO_PREAUTH_ISSUER_KEY_HEX", "CELLO_GSM_PREAUTH_ISSUER_KEY"],
];

/** Env var naming the secret that holds the database credential JSON. */
const DB_CREDENTIALS_REF = "CELLO_GSM_DB_CREDENTIALS";

interface DbCredentials {
  username: string;
  password: string;
  host: string;
  port: number | string;
  dbname: string;
}

/**
 * Quote a value for POSIX `eval`. Single quotes suppress every expansion, and an embedded single
 * quote is closed, escaped and reopened (`'\''`) so a password can never leave quoted context and
 * become a command.
 */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function requireRef(env: NodeJS.ProcessEnv, refVar: string): string {
  const ref = env[refVar];
  if (!ref) {
    throw new Error(
      `${refVar} is not set — a GCP directory node cannot resolve its boot secrets without it`,
    );
  }
  return ref;
}

function parseDbCredentials(raw: string): DbCredentials {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      `${DB_CREDENTIALS_REF} secret is not JSON — expected {username, password, host, port, dbname}`,
    );
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(
      `${DB_CREDENTIALS_REF} secret is not a JSON object — expected {username, password, host, port, dbname}`,
    );
  }
  const c = parsed as Record<string, unknown>;
  for (const field of ["username", "password", "host", "port", "dbname"] as const) {
    const v = c[field];
    if (v === undefined || v === null || v === "") {
      throw new Error(`${DB_CREDENTIALS_REF} secret is missing required field '${field}'`);
    }
  }
  return c as unknown as DbCredentials;
}

/**
 * Resolve every boot secret and render the shell fragment the entrypoint evaluates.
 *
 * @param env  the process environment holding the `CELLO_GSM_*` secret references
 * @param secrets  Secret Manager access
 * @returns newline-separated `export NAME='value'` lines
 * @throws if any reference is unset, any secret is empty, access is denied, or the database
 *         credential JSON is the wrong shape — all of which must stop the boot
 */
export async function buildGcpBootEnv(
  env: NodeJS.ProcessEnv,
  secrets: SecretAccessor,
): Promise<string> {
  // One fetch per DISTINCT secret: two of the bindings share a resource, and re-reading it only
  // doubles the access-audit trail.
  const refVars = new Set<string>([DB_CREDENTIALS_REF, ...SECRET_BINDINGS.map(([, r]) => r)]);
  const resolved = new Map<string, string>();
  for (const refVar of refVars) {
    const resourceName = requireRef(env, refVar);
    if (resolved.has(resourceName)) continue;
    const value = await secrets.access(resourceName);
    if (!value) {
      throw new Error(
        `${refVar} resolved to an EMPTY secret — refusing to boot with blank key material`,
      );
    }
    resolved.set(resourceName, value);
  }

  const lines: string[] = [];
  for (const [target, refVar] of SECRET_BINDINGS) {
    lines.push(`export ${target}=${shellQuote(resolved.get(env[refVar]!)!)}`);
  }

  const db = parseDbCredentials(resolved.get(env[DB_CREDENTIALS_REF]!)!);
  const hostPortName = `${db.host}:${db.port}/${db.dbname}`;
  // Cloud SQL presents a Google-managed certificate chain. Node's pg treats `sslmode=require` as
  // verify-full, so `no-verify` is what keeps the connection encrypted without pinning a chain the
  // node has no copy of — same reasoning as the RDS path.
  lines.push(
    `export DATABASE_URL=${shellQuote(
      `postgresql://${db.username}:${encodeURIComponent(db.password)}@${hostPortName}?sslmode=no-verify`,
    )}`,
  );
  // Flyway's env vars are NOT URL-decoded, so they carry the RAW password. Percent-encoding here
  // would authenticate with a different string than the node uses.
  lines.push(`export FLYWAY_URL=${shellQuote(`jdbc:postgresql://${hostPortName}`)}`);
  lines.push(`export FLYWAY_USER=${shellQuote(db.username)}`);
  lines.push(`export FLYWAY_PASSWORD=${shellQuote(db.password)}`);

  return lines.join("\n") + "\n";
}
