import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import type {
  Logger,
  WaitlistGateClient,
  WaitlistGateDecision,
  WaitlistTokenRedemption,
} from "@cello-protocol/interfaces";

/**
 * LambdaWaitlistGateClient — asks `cello-waitlist-gate-{env}` whether a Telegram
 * account may register (DOD-TELEGRAM-GATE-1).
 *
 * The ops-agent deliberately does NOT read the waitlist database. It runs in the
 * directory's VPC and holds directory credentials; giving it waitlist ones too
 * would put every waitlist row one bug away from a Telegram bot. So it asks a
 * question over a narrow IAM grant — `lambda:InvokeFunction` on this one
 * function, and nothing else (see `InvokeWaitlistGate` in cello-iam.yaml).
 *
 * FAIL CLOSED, ALWAYS. Every failure path here throws. An unreachable gate is
 * indistinguishable from a gate that would have refused, and admitting on
 * "could not check" would mean a Lambda outage silently opens the network to
 * anybody who messages the bot. That is the one behaviour the two-door design
 * exists to prevent, so it is not a default that can be configured away.
 */
export class LambdaWaitlistGateClient implements WaitlistGateClient {
  readonly #lambda: LambdaClient;
  readonly #functionName: string;
  readonly #logger: Logger;

  constructor(opts: { region: string; functionName: string; logger: Logger; client?: LambdaClient }) {
    this.#lambda = opts.client ?? new LambdaClient({ region: opts.region });
    this.#functionName = opts.functionName;
    this.#logger = opts.logger;
  }

  async check(telegramId: string): Promise<WaitlistGateDecision> {
    const body = await this.#invoke({ telegram_id: telegramId }, "check");

    if (body.allowed === true) {
      // Populated from what the gate actually said, not hardcoded. The previous
      // version returned alreadyLinked:true unconditionally — asserting
      // something it had not checked, for a field nothing read.
      return { allowed: true, alreadyLinked: body.reason === "already_linked" };
    }
    // The Lambda's own wording, passed through. It names four distinct
    // refusals; re-writing them here would flatten them into one.
    return {
      allowed: false,
      error: String(body.error ?? "gate_refused"),
      message: String(body.message ?? "This Telegram account is not linked to CELLO yet."),
    };
  }

  async redeem(telegramId: string, token: string): Promise<WaitlistTokenRedemption> {
    const body = await this.#invoke({ telegram_id: telegramId, token }, "redeem");

    if (body.allowed === true) {
      return { redeemed: true };
    }
    return {
      redeemed: false,
      error: String(body.error ?? "gate_refused"),
      message: String(body.message ?? "That token could not be redeemed."),
    };
  }

  async #invoke(payload: Record<string, unknown>, op: string): Promise<Record<string, unknown>> {
    let response;
    try {
      response = await this.#lambda.send(
        new InvokeCommand({
          FunctionName: this.#functionName,
          Payload: Buffer.from(JSON.stringify(payload)),
        }),
      );
    } catch (error) {
      // Transport failure. Named, then rethrown — never converted to a decision.
      this.#logger.error("waitlist.gate.unreachable", {
        op,
        functionName: this.#functionName,
        detail: error instanceof Error ? error.message : String(error),
      });
      throw new Error(
        `The waitlist gate could not be reached (${op}). Registration is refused rather than ` +
          `allowed, because "could not check" is not "permitted".`,
      );
    }

    if (response.FunctionError) {
      // The function ran and threw. Its payload carries the stack, so it is
      // logged rather than discarded — this is the moment somebody needs it.
      const raw = response.Payload ? Buffer.from(response.Payload).toString() : "";
      this.#logger.error("waitlist.gate.threw", { op, functionName: this.#functionName, detail: raw });
      throw new Error(`The waitlist gate failed (${op}). Registration is refused.`);
    }

    const raw = response.Payload ? Buffer.from(response.Payload).toString() : "{}";
    let envelope: { statusCode?: number; body?: string };
    try {
      envelope = JSON.parse(raw) as { statusCode?: number; body?: string };
    } catch {
      this.#logger.error("waitlist.gate.unparseable", { op, detail: raw.slice(0, 400) });
      throw new Error(`The waitlist gate returned something unreadable (${op}). Registration is refused.`);
    }

    // A DECISION IS 200 PLUS A BOOLEAN `allowed`. NOTHING ELSE.
    //
    // The first version threw only on 5xx and treated everything else as a
    // decision. That defeated, one hop later, the exact thing the Lambda
    // engineered: `_sqlstate.classify` returns 409 `constraint_violation` for a
    // SQLSTATE-23 database fault, deliberately WITHOUT an `allowed` key so it
    // cannot be read as an answer. Read as one, `allowed !== true` became
    // `allowed: false`, and a database integrity error reached the user as
    // "you are not invited" — logged at INFO as `token_required`, pointing the
    // operator at the waitlist instead of the database.
    //
    // So the shape is checked, not just the status. Anything that is not a
    // decision is a failure, and a failure refuses.
    const body: Record<string, unknown> = envelope.body
      ? (JSON.parse(envelope.body) as Record<string, unknown>)
      : {};

    if (envelope.statusCode !== 200 || typeof body.allowed !== "boolean") {
      this.#logger.error("waitlist.gate.not_a_decision", {
        op,
        statusCode: envelope.statusCode,
        error: body.error,
        detail:
          "The gate returned something that is not an allow/deny answer. Treated as a failure, " +
          "not as a refusal — a fault must never reach the user as 'you are not invited'.",
      });
      throw new Error(
        `The waitlist gate did not return a decision (${op}, status ${envelope.statusCode ?? "none"}` +
          `${body.error ? `, ${String(body.error)}` : ""}). Registration is refused.`,
      );
    }

    return body;
  }
}
