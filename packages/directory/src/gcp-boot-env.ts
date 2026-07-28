/**
 * M12 DOD-NODE-DIR-GCP-1 — resolve a GCP directory node's boot secrets.
 *
 * On AWS, ECS injects secrets into the task environment (`ValueFrom`) and the entrypoint fetches
 * only the database credentials. A GCP node running under Container-Optimized OS has no equivalent:
 * container environment comes from instance metadata, which is readable by anything holding
 * `compute.instances.get`, so secrets must not travel that way. The node fetches them itself with
 * the workload identity attached to its VM.
 *
 * Flyway runs in the entrypoint, before the node process exists, and needs the same database
 * credentials. Resolving once and emitting shell `export` lines for the entrypoint to evaluate
 * keeps a single fetch path — two independent resolvers is how the two ends drift apart.
 *
 * Every failure here is fatal. A blank transport key yields an unstable peer id; a blank node key
 * yields a garbage identity; a wrong database credential yields a node answering queries against
 * nothing. None of those may degrade quietly (M12-PROCEDURE §5, ABSENT IS NOT FINE).
 */

/** The one capability this module needs from Secret Manager. Injected so it is testable. */
export interface SecretAccessor {
  /** Resolve a secret VERSION resource name to its payload. Throws if absent or inaccessible. */
  access(resourceName: string): Promise<string>;
}

interface Binding {
  /** Environment variable the node reads. */
  readonly target: string;
  /** Environment variable naming this secret's Secret Manager version resource. */
  readonly refVar: string;
  /**
   * Distinct key purposes must resolve to distinct secrets. Two bindings sharing a purpose are
   * declaring "these are the same key" — the only such pair is the node's Ed25519 key, which the
   * AWS task definition also binds twice.
   */
  readonly purpose: string;
  /** A node without this secret cannot function. False only where absence is a valid topology. */
  readonly required: boolean;
}

const SECRET_BINDINGS: readonly Binding[] = [
  { target: "NODE_PRIVATE_KEY", refVar: "CELLO_GSM_NODE_KEY", purpose: "node-key", required: true },
  { target: "CELLO_DIRECTORY_NODE_KEY_HEX", refVar: "CELLO_GSM_NODE_KEY", purpose: "node-key", required: true },
  { target: "CELLO_DIRECTORY_TRANSPORT_KEY_HEX", refVar: "CELLO_GSM_TRANSPORT_KEY", purpose: "transport-key", required: true },
  { target: "INTERNAL_API_KEY", refVar: "CELLO_GSM_INTERNAL_API_KEY", purpose: "internal-api-key", required: true },
  // The pre-auth issuer is ONE identity shared across regions (see bin/directory.ts) — it is the
  // single key here that is deliberately not per-node. Requiring it would force that cross-region
  // signing identity to be copied into every node's Secret Manager, including nodes that will never
  // issue a capability. A node without it simply issues no pre-auth capabilities, which is a valid
  // topology; the skip is announced by the caller so the weaker configuration is never silent.
  { target: "CELLO_PREAUTH_ISSUER_KEY_HEX", refVar: "CELLO_GSM_PREAUTH_ISSUER_KEY", purpose: "preauth-issuer-key", required: false },
];

/**
 * Two database credentials, because there are two roles and the difference is load-bearing.
 *
 * `CELLO_GSM_DB_CREDENTIALS` is the SCHEMA OWNER (`postgres`) — Flyway's, for DDL.
 * `CELLO_GSM_DB_APP_CREDENTIALS` is what the NODE connects as (`cello_service`), which
 * V2__directory_schema.sql builds the append-only guarantee around: RLS policies are
 * `TO cello_service` and UPDATE/DELETE are REVOKEd from it. Connecting the node as the owner
 * bypasses every one of those — no table declares FORCE ROW LEVEL SECURITY — so the two must
 * never collapse into one, and an absent app credential must REFUSE rather than fall back.
 */
const DB_CREDENTIALS_REF = "CELLO_GSM_DB_CREDENTIALS";
const DB_APP_CREDENTIALS_REF = "CELLO_GSM_DB_APP_CREDENTIALS";

interface DbCredentials {
  username: string;
  password: string;
  host: string;
  port: number | string;
  dbname: string;
}

/** Result of a resolution: the shell fragment, plus what was deliberately left out. */
export interface GcpBootEnv {
  /** Newline-separated `export NAME='value'` lines. Nothing else — the caller evaluates this. */
  script: string;
  /** Targets skipped because an OPTIONAL secret reference was absent. */
  skipped: string[];
}

/**
 * Quote a value for POSIX `eval`. Single quotes suppress every expansion, and an embedded single
 * quote is closed, escaped and reopened (`'\''`) so a password can never leave quoted context and
 * become a command.
 */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function parseDbCredentials(raw: string, refVar: string): DbCredentials {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // The SyntaxError is deliberately discarded, not wrapped: Node embeds an excerpt of the input
    // in its message, and the input here is a credential blob.
    throw new Error(
      `${refVar} secret is not JSON — expected {username, password, host, port, dbname}`,
    );
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(
      `${refVar} secret is not a JSON object — expected {username, password, host, port, dbname}`,
    );
  }
  const c = parsed as Record<string, unknown>;
  for (const field of ["username", "password", "host", "port", "dbname"] as const) {
    const v = c[field];
    if (v === undefined || v === null || v === "") {
      throw new Error(`${refVar} secret is missing required field '${field}'`);
    }
  }
  return c as unknown as DbCredentials;
}

/**
 * Resolve every boot secret and render the shell fragment the entrypoint evaluates.
 *
 * @param env  the process environment holding the `CELLO_GSM_*` secret references
 * @param secrets  Secret Manager access
 * @throws if a required reference is unset, any secret is empty, access is denied, two distinct key
 *         purposes resolve to the SAME secret, or the database credential JSON is the wrong shape
 */
export async function buildGcpBootEnv(
  env: NodeJS.ProcessEnv,
  secrets: SecretAccessor,
): Promise<GcpBootEnv> {
  // ── Which references are present, and do they describe distinct keys? ─────────────────────
  const purposeToResource = new Map<string, string>();
  const skipped: string[] = [];
  for (const b of SECRET_BINDINGS) {
    const ref = env[b.refVar];
    if (!ref) {
      if (b.required) {
        throw new Error(
          `${b.refVar} is not set — a GCP directory node cannot resolve its boot secrets without it`,
        );
      }
      skipped.push(b.target);
      continue;
    }
    const already = purposeToResource.get(b.purpose);
    if (already !== undefined && already !== ref) {
      throw new Error(
        `${b.refVar} and another binding disagree about the '${b.purpose}' secret — one purpose, one secret`,
      );
    }
    purposeToResource.set(b.purpose, ref);
  }

  // Distinct purposes MUST be distinct secrets. Without this, a copy-pasted MIG template pointing
  // CELLO_GSM_TRANSPORT_KEY at the node-key resource would boot cleanly with one key serving as
  // both the node's long-term identity and its libp2p transport key — and the DoD line's "fresh
  // transport key … never copied" has no other enforcement point in the code.
  const seen = new Map<string, string>();
  for (const [purpose, resource] of purposeToResource) {
    const collidesWith = seen.get(resource);
    if (collidesWith !== undefined) {
      throw new Error(
        `'${purpose}' and '${collidesWith}' both resolve to the secret ${resource} — distinct key purposes must not share one secret`,
      );
    }
    seen.set(resource, purpose);
  }

  // ── Fetch: one request per distinct secret ────────────────────────────────────────────────
  const dbRef = env[DB_CREDENTIALS_REF];
  if (!dbRef) {
    throw new Error(
      `${DB_CREDENTIALS_REF} is not set — Flyway cannot run its migrations without the schema owner`,
    );
  }
  const dbAppRef = env[DB_APP_CREDENTIALS_REF];
  if (!dbAppRef) {
    throw new Error(
      `${DB_APP_CREDENTIALS_REF} is not set — the node must connect as its restricted role, never as the schema owner`,
    );
  }
  const resolved = new Map<string, string>();
  for (const resourceName of new Set<string>([dbRef, dbAppRef, ...purposeToResource.values()])) {
    const value = await secrets.access(resourceName);
    if (!value) {
      throw new Error(
        `${resourceName} resolved to an EMPTY secret — refusing to boot with blank key material`,
      );
    }
    resolved.set(resourceName, value);
  }

  // ── Render ────────────────────────────────────────────────────────────────────────────────
  const lines: string[] = [];
  for (const b of SECRET_BINDINGS) {
    const resource = purposeToResource.get(b.purpose);
    if (resource === undefined) continue; // optional and absent — recorded in `skipped`
    lines.push(`export ${b.target}=${shellQuote(resolved.get(resource)!)}`);
  }

  const admin = parseDbCredentials(resolved.get(dbRef)!, DB_CREDENTIALS_REF);
  const app = parseDbCredentials(resolved.get(dbAppRef)!, DB_APP_CREDENTIALS_REF);

  // The NODE's connection — the restricted role.
  // Every component is encoded, not just the password: a username containing '@' or ':' would
  // otherwise produce a URL that parses to a different host.
  const enc = encodeURIComponent;
  const appHostPortName = `${enc(app.host)}:${enc(String(app.port))}/${enc(app.dbname)}`;
  // Cloud SQL presents a Google-managed certificate chain. Node's pg treats `sslmode=require` as
  // verify-full, so `no-verify` keeps the connection encrypted without pinning a chain the node has
  // no copy of — same reasoning as the RDS path.
  lines.push(
    `export DATABASE_URL=${shellQuote(
      `postgresql://${enc(app.username)}:${enc(app.password)}@${appHostPortName}?sslmode=no-verify`,
    )}`,
  );

  // FLYWAY's connection — the schema owner, because migrations are DDL and the runtime role has
  // none. pgjdbc does NOT accept libpq's `no-verify` (`Invalid sslmode value`), so this URL carries
  // no sslmode at all; Cloud SQL requires TLS server-side regardless (ENCRYPTED_ONLY). Flyway's env
  // vars are also not URL-decoded, so they carry the RAW username and password — percent-encoding
  // them would authenticate with a different string.
  lines.push(
    `export FLYWAY_URL=${shellQuote(`jdbc:postgresql://${admin.host}:${admin.port}/${admin.dbname}`)}`,
  );
  lines.push(`export FLYWAY_USER=${shellQuote(admin.username)}`);
  lines.push(`export FLYWAY_PASSWORD=${shellQuote(admin.password)}`);

  return { script: lines.join("\n") + "\n", skipped };
}
