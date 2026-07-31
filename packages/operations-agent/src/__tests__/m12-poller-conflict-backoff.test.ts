/**
 * M12 — a TRANSIENT Telegram poll conflict must be survived, not treated as fatal.
 *
 * Telegram allows one `getUpdates` poller per bot and answers 409 to a second. The adapter treated
 * that as unrecoverable and called `process.exit(1)`, which is right for the deployment it was
 * written for — one long-lived VM, where a second poller means a genuine misconfiguration.
 *
 * On Cloud Run it is a crash loop. Every revision rollout OVERLAPS: the old instance is still polling
 * while the new one starts, so the new one gets 409 and exits, the autoscaler restarts it, and it
 * conflicts again. Both revisions die repeatedly and the bot — the ONLY thing that issues
 * registration capabilities to a human — is down for as long as the rollout takes to give up.
 *
 * The overlap is self-resolving: the old revision is torn down within a minute. So a conflict is
 * survivable if it clears, and fatal only if it does not — which is the real distinction between
 * "a deploy is in progress" and "somebody started a second ops agent". Both halves are asserted here,
 * because backing off forever would silently tolerate exactly the misconfiguration the exit existed
 * to catch.
 */

import { describe, it, expect, vi } from "vitest";
import { TelegramAdapter } from "../telegram-adapter.js";

const silent = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

function adapterWith(
  responses: Array<{ status: number; body?: unknown }>,
  opts: { onFatal: () => void; cycle?: boolean },
) {
  let i = 0;
  const fetchFn = vi.fn(async () => {
    // Default CLAMPS to the last entry (a sequence that settles). `cycle` repeats the whole list,
    // which is what models two pollers trading the slot indefinitely.
    const idx = opts.cycle ? i++ % responses.length : Math.min(i++, responses.length - 1);
    const r = responses[idx]!;
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => r.body ?? { ok: true, result: [] },
    } as Response;
  }) as unknown as typeof fetch;

  const adapter = new TelegramAdapter({
    token: "test-token",
    logger: silent as never,
    fetch: fetchFn,
    // Injected so the test does not kill the runner, and so "did it give up?" is observable.
    onFatalConflict: opts.onFatal,
    conflictGraceMs: 200,
    conflictRetryMs: 10,
  } as never);
  return { adapter, fetchFn };
}

describe("a Telegram poll conflict during a rollout", () => {
  it("SURVIVES a conflict that clears — the deploy overlap must not kill the bot", async () => {
    const onFatal = vi.fn();
    // 409 twice (the old revision still holds the poll), then it is torn down and we win.
    const { adapter } = adapterWith(
      [{ status: 409 }, { status: 409 }, { status: 200, body: { ok: true, result: [] } }],
      { onFatal },
    );

    await adapter.pollOnce();
    await adapter.pollOnce();
    await adapter.pollOnce();

    expect(onFatal, "a transient conflict is a rollout, not a misconfiguration").not.toHaveBeenCalled();
  });

  it("is STILL FATAL when the conflict does not clear — a real second poller", async () => {
    // The half that keeps the original guard meaningful. Without it, two ops agents would poll each
    // other into a livelock forever and every update would go to whichever won the race.
    const onFatal = vi.fn();
    const { adapter } = adapterWith([{ status: 409 }], { onFatal });

    const deadline = Date.now() + 2_000;
    while (!onFatal.mock.calls.length && Date.now() < deadline) {
      await adapter.pollOnce();
    }

    expect(onFatal, "a conflict that outlives the grace window is a second deployment").toHaveBeenCalled();
  });

  it("a SUSTAINED alternating conflict is still fatal — a second poller does not conflict continuously", async () => {
    // THE ONE THAT MATTERS, and the one the first version of this fix got wrong.
    //
    // A real second poller does not produce uninterrupted 409s. Telegram terminates the pending
    // request when a new one arrives, so two instances trade the slot: whenever one is busy handling
    // an update, the other's long poll completes with 200. An implementation that zeroes the window
    // on any single success therefore never fires, and two ops agents run against each other forever
    // with updates going to whoever won each race. The earlier test asserted that behaviour as if it
    // were the requirement; this asserts the opposite.
    const onFatal = vi.fn();
    const { adapter } = adapterWith([{ status: 409 }, { status: 200, body: { ok: true, result: [] } }], {
      onFatal,
      cycle: true, // 409, 200, 409, 200, … — the shape a real second poller produces
    });

    const deadline = Date.now() + 3_000;
    while (!onFatal.mock.calls.length && Date.now() < deadline) {
      await adapter.pollOnce(); // alternates 409, 200, 409, 200, …
    }

    expect(onFatal, "alternating conflicts must still reach the fatal path").toHaveBeenCalled();
  });

  it("a conflict run ENDS once conflicts genuinely stop", async () => {
    // The other half: after a real rollout the old instance is gone and every poll succeeds, so the
    // run must clear. Without this the process would eventually exit over a conflict that ended
    // minutes earlier.
    const onFatal = vi.fn();
    const { adapter } = adapterWith(
      [{ status: 409 }, { status: 200, body: { ok: true, result: [] } }],
      { onFatal },
    );

    await adapter.pollOnce();                                   // conflict run starts
    await new Promise((r) => setTimeout(r, 250));               // quiet for longer than the window
    await adapter.pollOnce();                                   // a success after real quiet → clears
    await new Promise((r) => setTimeout(r, 250));
    await adapter.pollOnce();

    expect(onFatal, "a run that genuinely ended must not resurface").not.toHaveBeenCalled();
  });

});
