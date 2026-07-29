/**
 * The portal's REAL ingress modules, made importable from the spine lane.
 *
 * WHY THIS FILE EXISTS AT ALL. Every earlier spine journey simulates the portal by seeding
 * `signal_records` directly — `j-canary` says so in its own comment, and it was sound there: the
 * portal's role was to insert a row, and what was under test was the directory's genericity.
 *
 * M10B inverts that. The portal's INGRESS is the thing under test — drain the queue, open the seal,
 * verify the signature and derive the issuer FROM it, scan, compose with the two voices kept apart,
 * mint, deliver. A journey written on the old pattern would seed the directory, skip every one of
 * those, and go green. It would certify the client-supplied source while exercising none of it, and
 * look exactly like a passing journey — which is why this indirection is worth having.
 *
 * The alternative was re-implementing the pipeline inside the test. That is the "byte-identical local
 * copy on each side" `M10B-D28` forbids for the submission wire, applied to the pipeline instead —
 * and the copy that drifts is always the one nobody runs in production.
 *
 * The relative depth is deliberate and load-bearing: `@`-prefixed vite aliases collide with the
 * portal's own `@/*` alias (a `@portal/x` specifier matches the `@` entry first and resolves to
 * `<src>portal/x`), so the path is spelled out once, here, rather than six levels deep in each test.
 * `vitest.spine.config.ts` supplies the `@` and `server-only` aliases the portal modules need.
 */
export {
  drainAndMint,
  IngressUnavailableError,
  type IngressDeps,
  type IngressResult,
} from "../../../../../cello-portal/src/server/trust/submission-ingress";

export { prepareIntakeScanner, scanSubmissionBody } from "../../../../../cello-portal/src/server/trust/submission-scan";
export { authenticateSubmission } from "../../../../../cello-portal/src/server/trust/submission-intake";
