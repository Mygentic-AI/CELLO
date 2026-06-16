// CELLO Story Implementation Workflow
//
// Invoke via scriptPath (NOT by name — the registered name resolves a stale copy
// that ignores args). Example:
//   Workflow({ scriptPath: ".../cello-story-implementation.js",
//              args: { storyId: "CELLO-M7-SESSION-002",
//                      gatePackages: ["@cello-protocol/client", "@cello-protocol/directory"] } })
//
// ARGS (all optional except storyId; defaults preserve historical client-only behavior):
//   storyId            REQUIRED — e.g. "CELLO-M7-SESSION-002" (the "CELLO-" prefix is added if missing)
//   gatePackages       string[] of @cello-protocol/* package names to gate.
//                      Default ["@cello-protocol/client"]. Packages are grouped by repo
//                      automatically: directory/relay/interfaces/operations-agent/e2e-tests →
//                      trustless-cello; everything else → cello-client. Pass the server-side
//                      package(s) for any story that touches the directory or relay, or the
//                      gate runs green while server code is never tested/typechecked.
//   model              coder model. Default "opus".
//   reviewModel        code reviewer + sprint reviewer model. Default "sonnet".
//   utilityModel       preflight / worktree / severity-gate model. Default "haiku".
//   reviewAndFixOnly   true → skip setup + initial implementation; run review+fix rounds only.
//                      If a worktree branch exists, diffs main...STORY_ID; else diffs by story ID in git log.
//   skipCodeReview     true → run sprint reviewer only.
//   skipSprintReview   true → run code reviewer only.
//   maxRounds          max review rounds before stopping. Default 2. Each reviewer converges
//                      independently — a converged reviewer is skipped in later rounds.
//   milestone          override milestone dir (e.g. "m7"). Default: auto-detected from storyId.
//   repo / clientRepo  override repo paths. Default: the local trustless-cello / cello-client checkouts.
//
// This workflow COMMITS on the per-story worktree branches but NEVER merges or pushes.
// If a reviewer still has above-low findings on the final round, they are returned in
// `unresolved` and status is "needs-attention" — the orchestrator reviews and decides;
// it does not merge.

export const meta = {
  name: 'cello-story-implementation',
  description: 'Implement a single CELLO story: preflight → worktree → sprint coder → review rounds (exit when both reviewers agree all findings are low)',
  phases: [
    { title: 'Preflight', detail: 'Verify story YAML exists — abort instantly if deleted/missing' },
    { title: 'Setup', detail: 'Create git worktrees in both repos (idempotent)' },
    { title: 'Implement', detail: 'Sprint coder: full SPARC cycle' },
    { title: 'Review', detail: 'Code review → fix → sprint review → fix → consensus gate (exits when all findings low)' },
  ],
}

// ─── ARGS NORMALIZATION ──────────────────────────────────────────────────────
// IMPORTANT: in this runtime `args` arrives as a JSON STRING, not a parsed object.
// Accessing `args.storyId` directly yields undefined — which is the historical bug
// that made every `args.X ? args.X : DEFAULT` fall through to its hardcoded default
// (the "arg slots that never fill"). Parse it here so the real arguments take effect.
let A = {}
if (args && typeof args === 'object') {
  A = args
} else if (typeof args === 'string' && args.trim()) {
  try {
    A = JSON.parse(args)
  } catch (e) {
    log(`ABORT: args was a string but not valid JSON: ${e.message}`)
    return { status: 'aborted', reason: 'args is not valid JSON' }
  }
}

if (!A.storyId) {
  log('ABORT: no storyId provided. Pass args.storyId, e.g. { storyId: "CELLO-M7-SESSION-002" }.')
  return { status: 'aborted', reason: 'storyId is required' }
}

const RAW_ID = A.storyId
const STORY_ID = RAW_ID.startsWith('CELLO-') ? RAW_ID : `CELLO-${RAW_ID}`
const CODER_MODEL = A.model || 'opus'
const REVIEW_MODEL = A.reviewModel || 'sonnet'
const UTILITY_MODEL = A.utilityModel || 'haiku'
const REVIEW_ONLY = A.reviewAndFixOnly === true
const SKIP_CODE_REVIEW = A.skipCodeReview === true
const SKIP_SPRINT_REVIEW = A.skipSprintReview === true
const MAX_ROUNDS = A.maxRounds ? A.maxRounds : 2
const GATE_PACKAGES = Array.isArray(A.gatePackages) && A.gatePackages.length
  ? A.gatePackages
  : ['@cello-protocol/client']

const REPO = A.repo || '/Users/andrep/Documents/code/trustless-cello'
const CLIENT_REPO = A.clientRepo || '/Users/andrep/Documents/code/cello-client'
const WORKTREE_BRANCH = STORY_ID
const WORKTREE_PATH = `${REPO}/.claude/worktrees/${STORY_ID}`
const CLIENT_WORKTREE = `${CLIENT_REPO}/.claude/worktrees/${STORY_ID}`

// Packages that live in trustless-cello (server side). Everything else → cello-client.
const SERVER_PKG_SET = new Set([
  '@cello-protocol/directory',
  '@cello-protocol/relay',
  '@cello-protocol/interfaces',
  '@cello-protocol/operations-agent',
  '@cello-protocol/e2e-tests',
])

// Auto-detect milestone directory from story ID (M6B-005 → m6b, DEMO-001 → m6, M7-SESSION-002 → m7)
const MILESTONES = ['m9', 'm7', 'm6b', 'm6', 'm5', 'm4', 'm3', 'm2', 'm1', 'm0']
const idWithoutPrefix = STORY_ID.replace('CELLO-', '')

function detectMilestone(id) {
  for (const m of MILESTONES) {
    if (id.toLowerCase().startsWith(m + '-')) return m
  }
  return 'm6'
}

const MILESTONE_DIR = A.milestone || detectMilestone(idWithoutPrefix)
const STORY_YAML = `${REPO}/docs/planning/user-stories/${MILESTONE_DIR}/${STORY_ID}.yaml`

const VITEST_FLAGS = '-- --pool-options.threads.maxThreads=1 --pool-options.threads.minThreads=1'

// Committed-as-you-go is a resilience requirement: a power loss or network drop must
// never cost more than the last unit of work. Injected into every coder prompt.
const COMMIT_DISCIPLINE = `COMMIT DISCIPLINE — mandatory (resilience against power/network loss):
- Commit incrementally as you go, not just at the end. After each major portion is done — failing tests written (red), an interface/module implemented, a gate turning green — make a commit right then.
- Never go more than one meaningful unit of work without committing. If this session dies, work must resume from the last commit, not from scratch.
- Commit messages explain what was done and why (e.g. "test(${STORY_ID}): red tests for unilateral seal notarization").
- Always make a final commit when the implementation/fixes are complete and gates are green.
- Commits are free history, not a "done" marker — committing early and often is required, not optional.`

// ─── PREFLIGHT ───────────────────────────────────────────────────────────────
phase('Preflight')
const preflight = await agent(
  `Check if this file exists: ${STORY_YAML}
If it exists, return: { "exists": true }
If it does NOT exist, return: { "exists": false, "reason": "Story YAML not found" }`,
  { label: 'preflight-check', phase: 'Preflight', model: UTILITY_MODEL, schema: { type: 'object', properties: { exists: { type: 'boolean' }, reason: { type: 'string' } }, required: ['exists'] } }
)

if (!preflight || !preflight.exists) {
  log(`ABORT: ${STORY_YAML} does not exist. Story was likely deleted — nothing to implement.`)
  return { storyId: STORY_ID, status: 'skipped', reason: preflight && preflight.reason || 'Story YAML not found' }
}

log(`Story YAML confirmed. Proceeding with ${STORY_ID}. Gate packages: ${GATE_PACKAGES.join(', ')}.`)

// ─── WORKTREE DETECTION (review-only mode) ───────────────────────────────────
// Detect whether a worktree branch exists. In review-only mode this determines
// whether we diff against a branch or search git log by story ID.
let worktreeExists = false
if (REVIEW_ONLY) {
  const detection = await agent(
    `Check if this git worktree path exists: ${WORKTREE_PATH}
Run: ls ${WORKTREE_PATH} 2>/dev/null && echo EXISTS || echo MISSING
Return: { "exists": true } if it exists, { "exists": false } if not.`,
    { label: 'worktree-detection', phase: 'Preflight', model: UTILITY_MODEL, schema: { type: 'object', properties: { exists: { type: 'boolean' } }, required: ['exists'] } }
  )
  worktreeExists = detection && detection.exists === true
  log(worktreeExists
    ? `Worktree found at ${WORKTREE_PATH}. Diffing against main...${WORKTREE_BRANCH}.`
    : `No worktree found. Implementation is on main. Diffing by story ID in git log.`)
}

// Where work happens: worktrees normally, repo roots in review-only-on-main mode.
const useWorktrees = !REVIEW_ONLY || worktreeExists
const CLIENT_WORK_PATH = useWorktrees ? CLIENT_WORKTREE : CLIENT_REPO
const SERVER_WORK_PATH = useWorktrees ? WORKTREE_PATH : REPO

// ─── GATE BLOCK (repo-aware, derived from gatePackages) ──────────────────────
// test + typecheck filter per package (every package defines those scripts);
// lint + build run at the repo root (per-package lint/build are inconsistent —
// only cello-client root defines build; trustless-cello has no build).
function buildGateBlock() {
  const clientFilters = GATE_PACKAGES.filter((p) => !SERVER_PKG_SET.has(p))
  const serverFilters = GATE_PACKAGES.filter((p) => SERVER_PKG_SET.has(p))
  const blocks = []

  if (clientFilters.length) {
    const f = clientFilters.map((p) => `--filter ${p}`).join(' ')
    blocks.push(`  # cello-client gates
  cd ${CLIENT_WORK_PATH} && pnpm ${f} run test ${VITEST_FLAGS}
  cd ${CLIENT_WORK_PATH} && pnpm ${f} run typecheck
  cd ${CLIENT_WORK_PATH} && pnpm run lint
  cd ${CLIENT_WORK_PATH} && pnpm run build`)
  }

  if (serverFilters.length) {
    const f = serverFilters.map((p) => `--filter ${p}`).join(' ')
    blocks.push(`  # trustless-cello gates
  cd ${SERVER_WORK_PATH} && pnpm ${f} run test ${VITEST_FLAGS}
  cd ${SERVER_WORK_PATH} && pnpm ${f} run typecheck
  cd ${SERVER_WORK_PATH} && pnpm run lint`)
  }

  return blocks.join('\n\n')
}

const GATE_BLOCK = buildGateBlock()

// ─── DIFF INSTRUCTIONS + WORKTREE CONTEXT ────────────────────────────────────
const DIFF_INSTRUCTIONS = useWorktrees
  ? `Run to see changes:
  cd ${WORKTREE_PATH} && git diff main...${WORKTREE_BRANCH}
  cd ${CLIENT_WORKTREE} && git diff main...${WORKTREE_BRANCH}`
  : `Run to see changes (implementation is on main — find commits by story ID):
  cd ${REPO} && git log --oneline --grep="${STORY_ID}" | head -10
  cd ${REPO} && git show <commit-hash> for each relevant commit
  cd ${CLIENT_REPO} && git log --oneline --grep="${STORY_ID}" | head -10
  cd ${CLIENT_REPO} && git show <commit-hash> for each relevant commit`

const WORKTREE_CONTEXT = useWorktrees
  ? `
EXISTING WORKTREES (do NOT recreate):
- trustless-cello: ${WORKTREE_PATH} (branch: ${WORKTREE_BRANCH})
- cello-client: ${CLIENT_WORKTREE} (branch: ${WORKTREE_BRANCH})

Story YAML: ${STORY_YAML}

CRITICAL CONSTRAINTS:
- One vitest worker only: --pool-options.threads.maxThreads=1 --pool-options.threads.minThreads=1
- All work inside worktree paths above, never on main
`
  : `
WORKING DIRECTORIES (implementation landed on main — no worktree):
- trustless-cello: ${REPO} (main branch)
- cello-client: ${CLIENT_REPO} (main branch)

Story YAML: ${STORY_YAML}

CRITICAL CONSTRAINTS:
- One vitest worker only: --pool-options.threads.maxThreads=1 --pool-options.threads.minThreads=1
- Work in repo root paths above; commits go on main
`

const GATE_INSTRUCTIONS = `Run gates (targeted — not all packages):
${GATE_BLOCK}

All gates must be clean before committing.`

if (!REVIEW_ONLY) {
  // ─── SETUP ─────────────────────────────────────────────────────────────────
  phase('Setup')
  await agent(
    `Create git worktrees for story ${STORY_ID} — IDEMPOTENT, do not destroy existing work.

  For each repo, check if the worktree already exists before creating it:

  trustless-cello:
    cd ${REPO}
    if git worktree list | grep -q "${STORY_ID}"; then
      echo "worktree already exists, skipping"
    else
      mkdir -p ${REPO}/.claude/worktrees
      git worktree add ${WORKTREE_PATH} -b ${WORKTREE_BRANCH}
    fi

  cello-client:
    cd ${CLIENT_REPO}
    if git worktree list | grep -q "${STORY_ID}"; then
      echo "worktree already exists, skipping"
    else
      mkdir -p ${CLIENT_REPO}/.claude/worktrees
      git worktree add ${CLIENT_WORKTREE} -b ${WORKTREE_BRANCH}
    fi

  Verify both worktrees exist with: git worktree list in each repo.
  Report which were created vs already present.`,
    { label: 'create-worktrees', phase: 'Setup', model: UTILITY_MODEL }
  )

  // ─── INITIAL IMPLEMENTATION ───────────────────────────────────────────────
  phase('Implement')
  await agent(
    `You are the CELLO sprint coder. Implement story ${STORY_ID} completely.

${WORKTREE_CONTEXT}

DO NOT create new worktrees. Work exclusively inside the existing worktrees above.

Follow the cello-sprint-coder agent instructions exactly as defined in:
${REPO}/.claude/agents/sparc/cello-sprint-coder.md

Full SPARC cycle required: Specification → Pseudocode → Architecture → Refinement (TDD red→green) → Gate sequence.

${COMMIT_DISCIPLINE}

${GATE_INSTRUCTIONS}
Final commit when complete: "feat(${STORY_ID}): <one-line summary>"

Return: files changed, gate results, ALL commit hashes (incremental + final), assumptions made.`,
    { label: 'sprint-coder-initial', phase: 'Implement', model: CODER_MODEL, agentType: 'cello-sprint-coder' }
  )
}

// ─── REVIEW ROUNDS ───────────────────────────────────────────────────────────
phase('Review')

// Each reviewer runs independently and tracks its own convergence.
// A converged reviewer is skipped in all subsequent rounds — it does not
// re-run just because the other reviewer is still iterating.

async function runCodeReview(roundNum) {
  const result = await agent(
    `Review the implementation of ${STORY_ID} for bugs, logic errors, security vulnerabilities, code quality, and project conventions.

${WORKTREE_CONTEXT}

Read the story YAML first to understand required ACs and SIs:
  ${STORY_YAML}

${DIFF_INSTRUCTIONS}

Report ALL issues with confidence >= 80. Group: Critical → Important → Medium → Low.
Include file path and line number for every issue.
Check that every AC and SI in the story YAML has a corresponding implementation and test.
Do not summarize or truncate.`,
    { label: `code-reviewer-r${roundNum}`, phase: 'Review', model: REVIEW_MODEL, agentType: 'feature-dev:code-reviewer' }
  )

  log(`Round ${roundNum} code review complete.`)

  await agent(
    `You are the CELLO sprint coder. Fix ALL findings from the code reviewer for story ${STORY_ID}.

${WORKTREE_CONTEXT}

CODE REVIEWER FINDINGS:
${typeof result === 'string' ? result : JSON.stringify(result)}

Fix every finding — critical, important, medium, AND low. No exceptions.

${COMMIT_DISCIPLINE}

${GATE_INSTRUCTIONS}
Final commit for this round: "fix(${STORY_ID}): address code review findings round ${roundNum}"`,
    { label: `fix-code-r${roundNum}`, phase: 'Review', model: REVIEW_MODEL, agentType: 'cello-sprint-coder' }
  )

  const gate = await agent(
    `You are a severity aggregator. Read the code reviewer output below and answer ONE question:
Did the reviewer surface any finding at severity ABOVE low (i.e. blocking, high, or medium)?

CODE REVIEWER OUTPUT:
${typeof result === 'string' ? result : JSON.stringify(result)}

Rules:
- If there is at least one finding at blocking, high, or medium severity → return { "allLow": false }
- If ALL findings are low/trivial (or there are zero findings) → return { "allLow": true }
- When in doubt, return { "allLow": false }`,
    { label: `gate-code-r${roundNum}`, phase: 'Review', model: UTILITY_MODEL, schema: { type: 'object', properties: { allLow: { type: 'boolean' } }, required: ['allLow'] } }
  )

  return { result, converged: gate && gate.allLow === true }
}

async function runSprintReview(roundNum) {
  const result = await agent(
    `You are the CELLO sprint reviewer. Review the implementation of story ${STORY_ID}.

Working directory for gate commands: ${CLIENT_WORK_PATH}

${WORKTREE_CONTEXT}

Follow instructions EXACTLY from:
${REPO}/.claude/agents/sparc/cello-review.md

This is IMPLEMENTATION REVIEW MODE. Story YAML: ${STORY_YAML}

${DIFF_INSTRUCTIONS}

DO NOT summarize or truncate. Report every finding at every severity (blocking → high → medium → low).
End with APPROVED or BLOCKED.`,
    { label: `sprint-reviewer-r${roundNum}`, phase: 'Review', model: REVIEW_MODEL, agentType: 'cello-sprint-reviewer' }
  )

  log(`Round ${roundNum} sprint review complete.`)

  await agent(
    `You are the CELLO sprint coder. Fix ALL findings from the sprint reviewer for story ${STORY_ID}.

${WORKTREE_CONTEXT}

SPRINT REVIEWER FINDINGS:
${typeof result === 'string' ? result : JSON.stringify(result)}

Fix every finding — blocking, high, medium, AND low. No exceptions regardless of APPROVED/BLOCKED.

${COMMIT_DISCIPLINE}

${GATE_INSTRUCTIONS}
Final commit for this round: "fix(${STORY_ID}): address sprint review findings round ${roundNum}"`,
    { label: `fix-sprint-r${roundNum}`, phase: 'Review', model: REVIEW_MODEL, agentType: 'cello-sprint-coder' }
  )

  const gate = await agent(
    `You are a severity aggregator. Read the sprint reviewer output below and answer ONE question:
Did the reviewer surface any finding at severity ABOVE low (i.e. blocking, high, or medium)?

SPRINT REVIEWER OUTPUT:
${typeof result === 'string' ? result : JSON.stringify(result)}

Rules:
- If there is at least one finding at blocking, high, or medium severity → return { "allLow": false }
- If ALL findings are low/trivial (or there are zero findings) → return { "allLow": true }
- When in doubt, return { "allLow": false }`,
    { label: `gate-sprint-r${roundNum}`, phase: 'Review', model: UTILITY_MODEL, schema: { type: 'object', properties: { allLow: { type: 'boolean' } }, required: ['allLow'] } }
  )

  return { result, converged: gate && gate.allLow === true }
}

// Independent convergence state — a converged reviewer is never re-run.
// A reviewer "converges" when its review surfaced only low/trivial findings. The
// fix agent runs after EVERY review, including the final one — but the final fix is
// not re-reviewed. So if a reviewer never converged, its last review's above-low
// findings are the unverified residue we must report back, not bury under "done".
let codeConverged = SKIP_CODE_REVIEW
let sprintConverged = SKIP_SPRINT_REVIEW
let lastCodeReview = null
let lastSprintReview = null
const rounds = []

for (let i = 1; i <= MAX_ROUNDS; i++) {
  const roundData = { round: i }

  if (!codeConverged) {
    const { result, converged } = await runCodeReview(i)
    roundData.codeReview = result
    lastCodeReview = result
    codeConverged = converged
    if (converged) log(`Round ${i}: code reviewer converged (all findings low). Will not re-run.`)
  } else {
    log(`Round ${i}: code reviewer already converged — skipping.`)
  }

  if (!sprintConverged) {
    const { result, converged } = await runSprintReview(i)
    roundData.sprintReview = result
    lastSprintReview = result
    sprintConverged = converged
    if (converged) log(`Round ${i}: sprint reviewer converged (all findings low). Will not re-run.`)
  } else {
    log(`Round ${i}: sprint reviewer already converged — skipping.`)
  }

  rounds.push(roundData)

  if (codeConverged && sprintConverged) {
    log(`Both reviewers converged after round ${i}. Exiting.`)
    break
  }

  if (i < MAX_ROUNDS) log(`Round ${i} complete. Code converged: ${codeConverged}. Sprint converged: ${sprintConverged}. Continuing.`)
}

// Surface unverified residue: a reviewer that hit max rounds without converging had
// above-low findings on its final review. The fix agent attempted them but they were
// never re-reviewed — the orchestrator must see them and decide, NOT auto-merge.
const unresolved = []
if (!codeConverged) {
  unresolved.push({ reviewer: 'code-reviewer', finalFindings: typeof lastCodeReview === 'string' ? lastCodeReview : JSON.stringify(lastCodeReview) })
}
if (!sprintConverged) {
  unresolved.push({ reviewer: 'sprint-reviewer', finalFindings: typeof lastSprintReview === 'string' ? lastSprintReview : JSON.stringify(lastSprintReview) })
}

if (unresolved.length) {
  log(`⚠️ NEEDS ATTENTION: reached max rounds (${MAX_ROUNDS}) with above-low findings still on the final review from: ${unresolved.map((u) => u.reviewer).join(', ')}. The final fix pass was NOT re-reviewed. Findings are returned in \`unresolved\` — review them; do NOT merge.`)
} else {
  log(`Done — ${rounds.length} round(s) completed. Both reviewers converged (all findings low).`)
}

return {
  storyId: STORY_ID,
  gatePackages: GATE_PACKAGES,
  worktrees: { trustlessCello: WORKTREE_PATH, celloClient: CLIENT_WORKTREE },
  rounds,
  unresolved,
  status: unresolved.length ? 'needs-attention' : 'done',
}
