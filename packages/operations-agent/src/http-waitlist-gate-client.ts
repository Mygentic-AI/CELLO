import type {
  Logger,
  WaitlistGateClient,
  WaitlistGateDecision,
  WaitlistTokenRedemption,
} from "@cello-protocol/interfaces";

/**
 * HttpWaitlistGateClient — the gate over HTTP, for the waitlist on Cloud Run
 * (DOD-GCP-GATE-1).
 *
 * WHY THIS REPLACES THE LAMBDA CLIENT. `LambdaWaitlistGateClient` invokes
 * `cello-waitlist-gate-{env}` in us-east-1 through the AWS SDK. From Cloud Run
 * that cannot work and never could: the service holds `SES_CREDENTIALS` for the
 * SES client explicitly and has no `AWS_ACCESS_KEY_ID`, so the SDK's credential
 * chain finds nothing. It had not failed in production only because it had
 * never been called — zero `waitlist.gate` log lines in the thirty days before
 * the port. The transport moves; the RULE does not move, and neither does where
 * it is evaluated: the ops-agent still asks a question and never touches the
 * waitlist database.
 *
 * FAIL CLOSED, ALWAYS — unchanged, and this is the property the rewrite exists
 * to preserve rather than to revisit. Every failure path throws. An unreachable
 * gate is indistinguishable from a gate that would have refused, and admitting
 * on "could not check" would mean an outage silently opens the network to
 * anybody who messages the bot. That is the one behaviour the two-door design
 * exists to prevent, so it is not a default that can be configured away.
 *
 * A DECISION IS 200 PLUS A BOOLEAN `allowed`. NOTHING ELSE. Carried over
 * verbatim from the Lambda client, because it was learned the hard way there:
 * the first version threw only on 5xx and read everything else as a decision,
 * which defeated one hop later the exact thing the gate engineered —
 * `_sqlstate.classify` returns 409 `constraint_violation` for a SQLSTATE-23
 * fault, deliberately WITHOUT an `allowed` key so it cannot be read as an
 * answer. Read as one, `allowed !== true` became `allowed: false`, and a
 * database integrity error reached the user as "you are not invited", logged at
 * INFO, pointing the operator at the waitlist instead of the database.
 */
export class HttpWaitlistGateClient implements WaitlistGateClient {
  readonly #baseUrl: string;
  readonly #token: string;
  readonly #logger: Logger;
  readonly #timeoutMs: number;
  readonly #fetch: typeof fetch;

  constructor(opts: {
    baseUrl: string;
    internalToken: string;
    logger: Logger;
    timeoutMs?: number;
    fetchImpl?: typeof fetch;
  }) {
    this.#baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.#token = opts.internalToken;
    this.#logger = opts.logger;
    // A human is waiting in a Telegram chat. Long enough for a cold Cloud SQL
    // connection, short enough that "the bot is broken" is not the experience.
    this.#timeoutMs = opts.timeoutMs ?? 10_000;
    this.#fetch = opts.fetchImpl ?? fetch;
  }

  async check(telegramId: string): Promise<WaitlistGateDecision> {
    const body = await this.#post({ telegram_id: telegramId }, "check");

    if (body.allowed === true) {
      // Populated from what the gate actually said, not hardcoded.
      return { allowed: true, alreadyLinked: body.reason === "already_linked" };
    }
    // The gate's own wording, passed through. It names four distinct refusals;
    // re-writing them here would flatten them into one.
    return {
      allowed: false,
      error: String(body.error ?? "gate_refused"),
      message: String(body.message ?? "This Telegram account is not linked to CELLO yet."),
    };
  }

  async redeem(telegramId: string, token: string): Promise<WaitlistTokenRedemption> {
    const body = await this.#post({ telegram_id: telegramId, token }, "redeem");

    if (body.allowed === true) {
      return { redeemed: true };
    }
    return {
      redeemed: false,
      error: String(body.error ?? "gate_refused"),
      message: String(body.message ?? "That token could not be redeemed."),
    };
  }

  async #post(payload: Record<string, unknown>, op: string): Promise<Record<string, unknown>> {
    const url = `${this.#baseUrl}/internal/waitlist-gate`;
    let response: Response;

    // A timeout is not optional here. Without one a hung connection holds the
    // Telegram conversation open indefinitely, which is a worse failure than a
    // refusal because nothing ever resolves and nothing is logged.
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), this.#timeoutMs);

    try {
      response = await this.#fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-cello-internal-token": this.#token,
        },
        body: JSON.stringify(payload),
        signal: abort.signal,
      });
    } catch (error) {
      // Transport failure. Named, then rethrown — never converted to a decision.
      this.#logger.error("waitlist.gate.unreachable", {
        op,
        url,
        detail: error instanceof Error ? error.message : String(error),
      });
      throw new Error(
        `The waitlist gate could not be reached (${op}). Registration is refused rather than ` +
          `allowed, because "could not check" is not "permitted".`,
      );
    } finally {
      clearTimeout(timer);
    }

    const raw = await response.text();

    // 401/503 from the internal surface are OUR misconfiguration, not the
    // caller's, and they must not read as a refusal to the person registering.
    // The internal surface answers 503 `internal_token_not_configured` when the
    // service is deployed without its credential and 401 when the token is
    // wrong — both mean the gate never evaluated anything.
    if (response.status === 401 || response.status === 503) {
      this.#logger.error("waitlist.gate.misconfigured", {
        op,
        url,
        status: response.status,
        detail: raw.slice(0, 400),
      });
      throw new Error(
        `The waitlist gate rejected this service's own credentials (${op}, status ` +
          `${response.status}). Registration is refused. This is a deployment fault, not a ` +
          `decision about the user.`,
      );
    }

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      this.#logger.error("waitlist.gate.unparseable", { op, url, detail: raw.slice(0, 400) });
      throw new Error(`The waitlist gate returned something unreadable (${op}). Registration is refused.`);
    }

    if (response.status !== 200 || typeof body.allowed !== "boolean") {
      this.#logger.error("waitlist.gate.not_a_decision", {
        op,
        url,
        status: response.status,
        error: body.error,
        detail:
          "The gate returned something that is not an allow/deny answer. Treated as a failure, " +
          "not as a refusal — a fault must never reach the user as 'you are not invited'.",
      });
      throw new Error(
        `The waitlist gate did not return a decision (${op}, status ${response.status}` +
          `${body.error ? `, ${String(body.error)}` : ""}). Registration is refused.`,
      );
    }

    return body;
  }
}
