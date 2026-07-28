#!/usr/bin/env node
/**
 * M12 DOD-NODE-DIR-GCP-1 — emit a GCP directory node's boot environment.
 *
 * Run by docker-entrypoint.sh as `eval "$(node dist/bin/gcp-boot-env.js)"` BEFORE Flyway, so both
 * Flyway and the node process see the same resolved database credentials.
 *
 * stdout carries ONLY the shell `export` lines — it is evaluated, so anything else printed there
 * would execute. Diagnostics go to stderr. Any failure exits non-zero, and `set -e` in the
 * entrypoint turns that into a refusal to start rather than a node running on half an environment.
 */

import { buildGcpBootEnv, type SecretAccessor } from "../gcp-boot-env.js";

async function main(): Promise<void> {
  // Lazy import (M12-D5): this binary only ever runs on a GCP node, and nothing else should pull
  // the Google SDK into its module graph.
  const { SecretManagerServiceClient } = await import("@google-cloud/secret-manager");
  const client = new SecretManagerServiceClient();

  const secrets: SecretAccessor = {
    async access(resourceName: string): Promise<string> {
      const [version] = await client.accessSecretVersion({ name: resourceName });
      const data = version.payload?.data;
      if (data === undefined || data === null) return "";
      return typeof data === "string" ? Buffer.from(data, "base64").toString("utf8") : Buffer.from(data).toString("utf8");
    },
  };

  process.stdout.write(await buildGcpBootEnv(process.env, secrets));
}

main().catch((err: unknown) => {
  // The reason may name a secret RESOURCE but never a secret VALUE — buildGcpBootEnv is written to
  // that rule, and this is the boundary where it would otherwise reach a log sink.
  process.stderr.write(
    JSON.stringify({
      event: "directory.gcp.boot_env.failed",
      level: "error",
      reason: err instanceof Error ? err.message : String(err),
    }) + "\n",
  );
  process.exit(1);
});
