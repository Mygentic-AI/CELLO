import type { JobScheduler, ScheduledJob } from "../job-scheduler.js";

/** In-process setTimeout job scheduler for CELLO_ENV=local. */
export class LocalJobScheduler implements JobScheduler {
  readonly #handlers = new Map<string, (job: ScheduledJob) => Promise<void>>();
  readonly #timers = new Map<string, ReturnType<typeof setTimeout>>();

  async schedule(jobId: string, runAt: number, payload: unknown): Promise<string> {
    const delay = Math.max(0, runAt - Date.now());
    const timer = setTimeout(() => {
      this.#timers.delete(jobId);
      const type = (payload as { type?: string })?.type ?? "";
      const handler = this.#handlers.get(type);
      if (handler) {
        handler({ jobId, runAt, payload }).catch(() => undefined);
      }
    }, delay);
    this.#timers.set(jobId, timer);
    return jobId;
  }

  async cancel(jobId: string): Promise<void> {
    const timer = this.#timers.get(jobId);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.#timers.delete(jobId);
    }
  }

  onJob(type: string, handler: (job: ScheduledJob) => Promise<void>): void {
    this.#handlers.set(type, handler);
  }
}
