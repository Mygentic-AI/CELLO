import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HttpWaitlistGateClient } from "../http-waitlist-gate-client.js";

/**
 * The gate over HTTP (DOD-GCP-GATE-1).
 *
 * Every test here is about ONE property: a gate that cannot answer must REFUSE.
 * The transport changed from a Lambda invoke to an HTTP POST, and the whole risk
 * of that change is that a failure mode which used to throw now looks like a
 * decision. So the refusals are enumerated rather than sampled.
 */

const logger = () => {
  const errors: Array<{ event: string; context: unknown }> = [];
  return {
    errors,
    logger: {
      info: () => {},
      warn: () => {},
      error: (event: string, context: unknown) => errors.push({ event, context }),
      debug: () => {},
    } as never,
  };
};

const client = (fetchImpl: typeof fetch, log = logger()) =>
  new HttpWaitlistGateClient({
    baseUrl: "https://api.cello.mygentic.ai/",
    internalToken: "s3cret",
    logger: log.logger,
    fetchImpl,
  });

const respond = (status: number, body: unknown) =>
  vi.fn(async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status }));

describe("HttpWaitlistGateClient", () => {
  it("posts to the internal gate path carrying the internal token", async () => {
    const fetchImpl = respond(200, { allowed: true, reason: "already_linked" });
    await client(fetchImpl as never).check("tg-1");

    const [url, init] = (fetchImpl as never as ReturnType<typeof vi.fn>).mock.calls[0];
    // The trailing slash on baseUrl must not produce a double slash — the
    // internal surface matches on an exact path prefix.
    expect(url).toBe("https://api.cello.mygentic.ai/internal/waitlist-gate");
    expect((init as RequestInit).headers).toMatchObject({ "x-cello-internal-token": "s3cret" });
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ telegram_id: "tg-1" });
  });

  it("reads alreadyLinked from what the gate said, not from a hardcoded value", async () => {
    const burned = await client(respond(200, { allowed: true, reason: "token_burned" }) as never).check("tg-1");
    expect(burned).toEqual({ allowed: true, alreadyLinked: false });

    const linked = await client(respond(200, { allowed: true, reason: "already_linked" }) as never).check("tg-1");
    expect(linked).toEqual({ allowed: true, alreadyLinked: true });
  });

  it("passes the gate's own refusal wording through instead of flattening it", async () => {
    const decision = await client(
      respond(200, { allowed: false, error: "token_already_used", message: "That token has already been used." }) as never,
    ).check("tg-1");

    expect(decision).toEqual({
      allowed: false,
      error: "token_already_used",
      message: "That token has already been used.",
    });
  });

  // ── the refusals ──────────────────────────────────────────────────────────

  it("REFUSES when the gate is unreachable", async () => {
    const log = logger();
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });

    await expect(client(fetchImpl as never, log).check("tg-1")).rejects.toThrow(/could not be reached/);
    expect(log.errors[0]?.event).toBe("waitlist.gate.unreachable");
  });

  it("REFUSES on a timeout rather than hanging the conversation", async () => {
    const log = logger();
    const fetchImpl = vi.fn(async (_url: unknown, init: RequestInit) => {
      // Never resolves on its own; only the abort signal ends it. A gate that
      // hangs is worse than one that refuses — nothing resolves and nothing is
      // logged.
      return await new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    });

    const c = new HttpWaitlistGateClient({
      baseUrl: "https://api.cello.mygentic.ai",
      internalToken: "s3cret",
      logger: log.logger,
      timeoutMs: 10,
      fetchImpl: fetchImpl as never,
    });

    await expect(c.check("tg-1")).rejects.toThrow(/could not be reached/);
  });

  it("REFUSES a 500 rather than reading it as a denial", async () => {
    const log = logger();
    await expect(client(respond(500, { error: "boom" }) as never, log).check("tg-1")).rejects.toThrow(
      /did not return a decision/,
    );
    expect(log.errors[0]?.event).toBe("waitlist.gate.not_a_decision");
  });

  it("REFUSES a 200 that carries no boolean `allowed`", async () => {
    // The exact shape the gate engineered: a 409 constraint_violation is
    // deliberately emitted WITHOUT an `allowed` key so it cannot be read as an
    // answer. Reading it as one turned a database fault into "you are not
    // invited".
    const log = logger();
    await expect(
      client(respond(200, { error: "constraint_violation" }) as never, log).check("tg-1"),
    ).rejects.toThrow(/did not return a decision/);
    expect(log.errors[0]?.event).toBe("waitlist.gate.not_a_decision");
  });

  it("REFUSES a 409 constraint_violation specifically, and never calls it a denial", async () => {
    const log = logger();
    await expect(
      client(respond(409, { error: "constraint_violation" }) as never, log).check("tg-1"),
    ).rejects.toThrow(/did not return a decision/);
  });

  it("REFUSES unparseable output", async () => {
    const log = logger();
    await expect(client(respond(200, "<html>502 Bad Gateway</html>") as never, log).check("tg-1")).rejects.toThrow(
      /unreadable/,
    );
    expect(log.errors[0]?.event).toBe("waitlist.gate.unparseable");
  });

  it("names OUR misconfiguration separately from a decision about the user", async () => {
    // 401 and 503 come from the internal surface's own guard: the token was
    // wrong, or the service was deployed without one. Neither is a statement
    // about the person registering, and neither may reach them as "not invited".
    for (const status of [401, 503]) {
      const log = logger();
      await expect(
        client(respond(status, { error: "internal_token_not_configured" }) as never, log).check("tg-1"),
      ).rejects.toThrow(/deployment fault, not a decision about the user/);
      expect(log.errors[0]?.event).toBe("waitlist.gate.misconfigured");
    }
  });

  it("redeem refuses on the same terms as check", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    await expect(client(fetchImpl as never).redeem("tg-1", "tok")).rejects.toThrow(/could not be reached/);
  });

  it("redeem sends the token and reports a refusal without inventing a reason", async () => {
    const fetchImpl = respond(200, { allowed: false, error: "token_expired", message: "That token expired." });
    const result = await client(fetchImpl as never).redeem("tg-1", "tok-9");

    expect(JSON.parse((fetchImpl as never as ReturnType<typeof vi.fn>).mock.calls[0][1].body)).toEqual({
      telegram_id: "tg-1",
      token: "tok-9",
    });
    expect(result).toEqual({ redeemed: false, error: "token_expired", message: "That token expired." });
  });
});

describe("resolveAdapters refuses to start a gate it cannot reach", () => {
  const base = {
    env: "dev" as const,
    telegramBotToken: "t",
    sesCredentials: { accessKeyId: "k", secretAccessKey: "s" },
    sesFromAddress: "noreply@cello.mygentic.ai",
    directoryInternalUrl: "http://10.0.0.1:8081",
    directoryApiKey: "k",
  };

  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of ["WAITLIST_GATE", "WAITLIST_SERVICE_URL", "INTERNAL_INVOKE_TOKEN"]) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("throws at BOOT when the gate is on but has no URL or token", async () => {
    const { resolveAdapters } = await import("../server.js");
    // The alternative is a client that builds fine and then refuses every
    // admission — correctly, since it fails closed, but with the fault
    // surfacing in a user's Telegram chat instead of in the deploy.
    expect(() => resolveAdapters({ ...base, logger: logger().logger })).toThrow(
      /WAITLIST_SERVICE_URL and\/or INTERNAL_INVOKE_TOKEN are not/,
    );
  });

  it("throws when only ONE of the two is set", async () => {
    const { resolveAdapters } = await import("../server.js");
    process.env["WAITLIST_SERVICE_URL"] = "https://api.cello.mygentic.ai";
    expect(() => resolveAdapters({ ...base, logger: logger().logger })).toThrow(/INTERNAL_INVOKE_TOKEN/);
  });

  it("does NOT throw when the gate is deliberately disabled", async () => {
    const { resolveAdapters } = await import("../server.js");
    // The opt-out is the sanctioned way to run without a gate. Refusing here
    // too would make the escape hatch unusable and invite someone to weaken the
    // assertion instead.
    process.env["WAITLIST_GATE"] = "disabled";
    const adapters = resolveAdapters({ ...base, logger: logger().logger });
    expect(adapters.waitlistGate).toBeUndefined();
  });
});
