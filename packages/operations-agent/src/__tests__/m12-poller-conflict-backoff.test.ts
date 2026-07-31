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

function adapterWith(responses: Array<{ status: number; body?: unknown }>, opts: { onFatal: () => void }) {
  let i = 0;
  const fetchFn = vi.fn(async () => {
    const r = responses[Math.min(i++, responses.length - 1)]!;
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

  it("resets the grace window once a poll succeeds", async () => {
    // Otherwise conflicts accumulated across unrelated rollouts over the process's whole lifetime
    // would eventually trip the fatal path during a perfectly ordinary deploy.
    const onFatal = vi.fn();
    const { adapter } = adapterWith(
      [{ status: 409 }, { status: 200, body: { ok: true, result: [] } }, { status: 409 }],
      { onFatal },
    );

    await adapter.pollOnce();
    await adapter.pollOnce();
    await new Promise((r) => setTimeout(r, 250)); // longer than the grace window
    await adapter.pollOnce();

    expect(onFatal, "the success in between must clear the earlier conflict").not.toHaveBeenCalled();
  });
});
