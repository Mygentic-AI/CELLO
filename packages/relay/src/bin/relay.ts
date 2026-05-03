#!/usr/bin/env node
import { homedir } from "node:os";
import { join } from "node:path";
import { startRelay } from "../index.js";

const keyPath = process.env["CELLO_RELAY_KEY_FILE"] ?? join(homedir(), ".cello", "relay-key");
const listenAddr = process.env["CELLO_RELAY_LISTEN_ADDR"] ?? "/ip4/0.0.0.0/tcp/4001";

let relay: Awaited<ReturnType<typeof startRelay>>;
try {
  relay = await startRelay({ keyPath, listenAddress: listenAddr });
} catch (err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`cello-relay: startup error: ${msg}\n`);
  process.exit(1);
}

for (const addr of relay.listenAddresses()) {
  process.stdout.write(`cello-relay listening on ${addr}\n`);
}

const shutdown = () => {
  relay.stop().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`cello-relay: stop error: ${msg}\n`);
  }).finally(() => process.exit(0));
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
