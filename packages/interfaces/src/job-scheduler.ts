/**
 * JobScheduler — interface for scheduling deferred or recurring work (PERSIST-001).
 *
 * Production implementation: EventBridgeJobScheduler (AWS EventBridge, CELLO_ENV=dev+).
 * Local stub: LocalJobScheduler (in-process setTimeout, CELLO_ENV=local).
 */
export interface ScheduledJob {
  jobId: string;
  runAt: number; // Unix ms
  payload: unknown;
}

export interface JobScheduler {
  /**
   * Schedule a job to run at the given Unix-ms timestamp.
   * Returns the jobId (may be the provided one or a generated one).
   */
  schedule(jobId: string, runAt: number, payload: unknown): Promise<string>;

  /** Cancel a previously scheduled job. No-op if already fired or not found. */
  cancel(jobId: string): Promise<void>;

  /**
   * Register a handler for jobs of a given type (discriminated by payload.type).
   * Each handler is called once per job execution.
   */
  onJob(type: string, handler: (job: ScheduledJob) => Promise<void>): void;
}
