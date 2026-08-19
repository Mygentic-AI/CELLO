/**
 * Seal-alert notifier — Pub/Sub push → Telegram.
 *
 * The last link in the chain that ends "nothing watches anything". A log sink filters the fleet's
 * UNRECOVERABLE seal failures into a topic; this reads them and sends one legible message.
 *
 * ── THE ACK CONTRACT, WHICH IS THE ONLY SUBTLE PART ──────────────────────────────────────────────
 * Pub/Sub retries anything that is not 2xx, forever, with backoff. So the status code decides
 * whether a failure is retried or dropped, and getting it backwards is how you either lose alerts
 * silently or hammer Telegram in a loop:
 *
 *   2xx on a message we CANNOT ever process (undecodable, not our shape) — retrying a malformed
 *        message just replays the same failure until the topic's retention expires.
 *   2xx on a message we deliberately SUPPRESSED — it was handled; throttling is a decision, not an
 *        error.
 *   5xx ONLY when Telegram itself failed — that is transient and worth retrying, and it is the one
 *        case where dropping the message would lose a real alert.
 *
 * ── WHAT THIS DOES NOT DO ────────────────────────────────────────────────────────────────────────
 * It never reads a secret at request time — both are loaded once at boot from the environment,
 * which Cloud Run populates from Secret Manager. A per-request secret fetch would put Secret
 * Manager on the alerting path, so an outage there would silence alerts about the outage.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { formatAlert, Throttle, type LogEntry } from "./format.js";

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

    let entry: LogEntry;
    try {
      const envelope = JSON.parse(await readBody(req)) as { message?: { data?: string } };
      const data = envelope.message?.data;
      if (typeof data !== "string") throw new Error("no message.data");
      entry = JSON.parse(Buffer.from(data, "base64").toString("utf8")) as LogEntry;
    } catch (err: unknown) {
      // ACK. This message can never be parsed, so retrying replays the same failure until the
      // topic's retention expires. Logged loudly because a filter change could make this constant.
      log("seal.notifier.undecodable", { reason: err instanceof Error ? err.message : String(err) });
      res.writeHead(204).end();
      return;
    }

    if (BOT_TOKEN === "" || CHAT_ID === "") {
      // NACK. This is our own misconfiguration and it is fixable without losing the alert — a
      // redeploy with the secrets bound will deliver the retry. Acking here would discard real
      // alerts for as long as the misconfiguration lasted, silently.
      log("seal.notifier.unconfigured", {
        hasToken: BOT_TOKEN !== "", hasChatId: CHAT_ID !== "",
        impact: "alert NOT delivered and NOT acked; Pub/Sub will retry once secrets are bound",
      });
      res.writeHead(503).end();
      return;
    }

    const { text, key } = formatAlert(entry);
    const decision = throttle.decide(key, Date.now());

    if (decision.action === "suppress") {
      log("seal.notifier.suppressed", { key, event: entry.jsonPayload?.["event"] });
      res.writeHead(204).end();
      return;
    }

    const outgoing = decision.action === "notice" ? decision.text : text;
    const sent = await sendTelegram(outgoing);
    if (!sent.ok) {
      log("seal.notifier.send.failed", { key, reason: sent.reason });
      res.writeHead(503).end();   // transient — retry
      return;
    }
    log("seal.notifier.sent", { key, kind: decision.action, event: entry.jsonPayload?.["event"] });
    res.writeHead(204).end();
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
