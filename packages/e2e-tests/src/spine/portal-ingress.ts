import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { PORTAL_ROOT } from "./live-harness.js";

/**
 * The portal's REAL ingress, loaded across the repo boundary.
 *
 * WHY THE JOURNEY MUST DRIVE THE REAL THING. Every earlier spine journey simulates the portal by
 * seeding `signal_records` directly — `j-canary` says so in its own comment, and it was sound there:
 * the portal's role was to insert a row, and the directory's genericity was what was under test.
 *
 * M10B inverts that. The portal's INGRESS is the thing under test — drain, open the seal, verify the
 * signature and derive the issuer FROM it, scan, compose with the two voices kept apart, mint,
 * deliver. A journey written on the old pattern would skip every one of those and still go green,
 * certifying the client-supplied source while exercising none of it. Re-implementing the pipeline in
 * the test would be the "byte-identical local copy on each side" that `M10B-D28` forbids for the
 * submission wire, applied to the pipeline — and the copy that drifts is the one nobody runs.
 *
 * WHY A DYNAMIC IMPORT WITH LOCAL TYPES, rather than a static one. Two repos are two compilation
 * units: a static import drags the portal's whole graph into this `tsc` program, where its `@/*`
 * alias does not resolve and its files sit outside `rootDir`. Both were tried; neither is worth
 * bending a tsconfig for. `j-canary` already loads cello-client's crypto exactly this way, so this
 * is the harness convention rather than a new idea.
 *
 * The types below are a LOCAL MIRROR of the portal's, deliberately narrow — only what the journey
 * uses. Drift between them surfaces as a failure in the journey, which is precisely where a mismatch
 * between two repos should surface.
 */

/** One sealed row as the directory hands it over. */
export interface QueuedSubmission {
  submissionId: string;
  intakeKeyId: string;
  ciphertext: Uint8Array;
}

export interface IngressResult {
  drained: number;
  minted: number;
  rejected: number;
  poison: number;
  duplicates: number;
  unhandledOps: number;
  nodeErrors: Array<{ nodeIndex: number; reason: string }>;
}

export interface PortalIngress {
  /** Compile the intake rule corpus. The pass refuses to run until this has succeeded. */
  prepareIntakeScanner(): Promise<void>;
  /** One drain pass: authenticate -> dedupe -> scan -> compose -> mint -> deliver -> ack. */
  drainAndMint(deps: {
    client: unknown;
    intakeSeeds: ReadonlyMap<string, Uint8Array>;
    signer: unknown;
    directoryBaseUrl: string;
    limit?: number;
    signalType?: string;
  }): Promise<IngressResult>;
}

const portalModule = (rel: string): string =>
  pathToFileURL(join(PORTAL_ROOT, "src/server/trust", rel)).href;

/**
 * Load the portal's ingress. Fails LOUD if the modules are not reachable — a journey that quietly
 * fell back to seeding the directory would be the false green this indirection exists to prevent.
 */
export async function loadPortalIngress(): Promise<PortalIngress> {
  const ingress = (await import(portalModule("submission-ingress.ts"))) as Pick<PortalIngress, "drainAndMint">;
  const scan = (await import(portalModule("submission-scan.ts"))) as Pick<PortalIngress, "prepareIntakeScanner">;
  if (typeof ingress.drainAndMint !== "function" || typeof scan.prepareIntakeScanner !== "function") {
    throw new Error(
      "[portal-ingress] the portal's ingress modules did not export what J-END drives — refusing to " +
        "run a journey that would otherwise appear to pass while testing nothing",
    );
  }
  return { drainAndMint: ingress.drainAndMint, prepareIntakeScanner: scan.prepareIntakeScanner };
}
