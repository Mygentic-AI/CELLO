/**
 * Seal-alert notifier — Pub/Sub push → Telegram.
 *
 * The last link in the chain that ends "nothing watches anything". Two producers feed one chat: a
 * log sink filtering the fleet's UNRECOVERABLE seal failures, and the node-health alert policies
 * publishing Monitoring incidents through a Pub/Sub notification channel.
 *
 * THIS FILE IS PLUMBING ONLY — socket, secrets, and the Telegram call. Every decision lives in
 * `handler.ts` (which shape, which formatter, which HTTP status) and in `format.ts` (what a person
 * reads), because both of those are testable and a `createServer` callback is not.
 *
 * It never reads a secret at request time — both are loaded once at boot from the environment,
 * which Cloud Run populates from Secret Manager. A per-request fetch would put Secret Manager on
 * the alerting path, so an outage there would silence the alerts about the outage.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Throttle } from "./format.js";
import { handleEnvelope } from "./handler.js";

const PORT = Number(process.env["PORT"] ?? "8080");
const BOT_TOKEN = process.env["TELEGRAM_BOT_TOKEN"] ?? "";
const CHAT_ID = process.env["TELEGRAM_CHAT_ID"] ?? "";

const throttle = new Throttle();

/** Structured, so these lines are queryable next to the fleet's own. Never logs the token. */
function log(event: string, fields: Record<string, unknown> = {}): void {
  process.stdout.write(JSON.stringify({ event, ts: new Date().toISOString(), ...fields }) + "\n");
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function sendTelegram(text: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: CHAT_ID, text, disable_web_page_preview: true }),
    signal: AbortSignal.timeout(10_000),
  }).catch((err: unknown) => {
    return { ok: false, status: 0, _thrown: err instanceof Error ? err.message : String(err) } as never;
  });

  const thrown = (res as unknown as { _thrown?: string })._thrown;
  if (thrown !== undefined) return { ok: false, reason: `fetch_failed: ${thrown}` };
  if (!res.ok) return { ok: false, reason: `http_${res.status}` };

  const body = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string };
  // Telegram answers 200 with ok:false for an invalid chat or a blocked bot, so the HTTP status
  // alone is not success — treating it as success would report delivery for messages nobody got.
  if (body.ok !== true) return { ok: false, reason: `telegram_refused: ${body.description ?? "unknown"}` };
  return { ok: true };
}

const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  void (async () => {
    if (req.method === "GET" && req.url === "/health") {
      // Liveness, never readiness — a health check conditional on Telegram being reachable would
      // take the notifier out of service for the exact failure it exists to report.
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok", configured: BOT_TOKEN !== "" && CHAT_ID !== "" }));
      return;
    }
    if (req.method !== "POST") { res.writeHead(405).end(); return; }

    const status = await handleEnvelope(await readBody(req), {
      botToken: BOT_TOKEN,
      chatId: CHAT_ID,
      throttle,
      now: () => Date.now(),
      send: sendTelegram,
      log,
    });
    res.writeHead(status).end();
  })();
});

server.listen(PORT, () => {
  log("seal.notifier.started", {
    port: PORT,
    // Says whether it CAN alert without ever revealing what with. A notifier that boots happily
    // with no credentials is the shape that looks healthy and reports nothing.
    configured: BOT_TOKEN !== "" && CHAT_ID !== "",
  });
});
