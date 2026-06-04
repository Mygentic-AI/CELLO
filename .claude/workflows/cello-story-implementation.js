// CELLO Story Implementation Workflow
// Usage: pass { storyId: "CELLO-M6B-005", model: "opus" } as args
// model: "opus" | "sonnet" (default: "opus") — controls sprint coder; reviews always use sonnet
// reviewOnly: true — skip setup and implementation; run review rounds only
//   If a worktree branch exists for the story, diffs against main...STORY_ID
//   If no worktree exists (implementation landed on main), diffs by story ID in git log
// skipCodeReview: true — run sprint reviewer only (no code reviewer)
// skipSprintReview: true — run code reviewer only (no sprint reviewer)
// maxRounds: N — maximum review rounds before stopping (default: 3)
//   Each reviewer tracks convergence independently — a converged reviewer is
//   skipped in subsequent rounds even if the other is still iterating.

export const meta = {
  name: 'cello-story-implementation',
  description: 'Implement a single CELLO story: preflight → worktree → sprint coder → review rounds (exit when both reviewers agree all findings are low)',
  phases: [
    { title: 'Preflight', detail: 'Verify story YAML exists — abort instantly if deleted/missing' },
    { title: 'Setup', detail: 'Create git worktrees in both repos (idempotent)' },
    { title: 'Implement', detail: 'Sprint coder: full SPARC cycle' },
    { title: 'Review', detail: 'Code review → fix → sprint review → fix → consensus gate (up to 3 rounds, exits when all findings low)' },
  ],
}

// ─── ARGS NORMALIZATION ──────────────────────────────────────────────────────
const CODER_MODEL = args && args.model ? args.model : 'opus'
const REVIEW_ONLY = args && args.reviewOnly === true
const SKIP_CODE_REVIEW = args && args.skipCodeReview === true
const SKIP_SPRINT_REVIEW = args && args.skipSprintReview === true
const MAX_ROUNDS = args && args.maxRounds ? args.maxRounds : 3
const RAW_ID = args && args.storyId ? args.storyId : 'CELLO-M6B-005'
const STORY_ID = RAW_ID.startsWith('CELLO-') ? RAW_ID : `CELLO-${RAW_ID}`
const REPO = '/Users/andrep/Documents/code/trustless-cello'
const CLIENT_REPO = '/Users/andrep/Documents/code/cello-client'
const WORKTREE_BRANCH = STORY_ID
const WORKTREE_PATH = `${REPO}/.claude/worktrees/${STORY_ID}`
const CLIENT_WORKTREE = `${CLIENT_REPO}/.claude/worktrees/${STORY_ID}`

// Auto-detect milestone directory from story ID (M6B-005 → m6b, DEMO-001 → m6, M6-E2E-001 → m6)
const MILESTONES = ['m9', 'm7', 'm6b', 'm6', 'm5', 'm4', 'm3', 'm2', 'm1', 'm0']
const idWithoutPrefix = STORY_ID.replace('CELLO-', '')

function detectMilestone(id) {
  for (const m of MILESTONES) {
    if (id.toLowerCase().startsWith(m + '-')) return m
  }
  return 'm6'
}

const MILESTONE_DIR = detectMilestone(idWithoutPrefix)
const STORY_YAML = `${REPO}/docs/planning/user-stories/${MILESTONE_DIR}/${STORY_ID}.yaml`

// ─── PREFLIGHT ───────────────────────────────────────────────────────────────
phase('Preflight')
const preflight = await agent(
  `Check if this file exists: ${STORY_YAML}
If it exists, return: { "exists": true }
If it does NOT exist, return: { "exists": false, "reason": "Story YAML not found" }`,
  { label: 'preflight-check', phase: 'Preflight', model: 'haiku', schema: { type: 'object', properties: { exists: { type: 'boolean' }, reason: { type: 'string' } }, required: ['exists'] } }
)

if (!preflight || !preflight.exists) {
  log(`ABORT: ${STORY_YAML} does not exist. Story was likely deleted — nothing to implement.`)
  return { storyId: STORY_ID, status: 'skipped', reason: preflight && preflight.reason || 'Story YAML not found' }
}

log(`Story YAML confirmed. Proceeding with ${STORY_ID}.`)

// ─── WORKTREE DETECTION (review-only mode) ───────────────────────────────────
// Detect whether a worktree branch exists. In review-only mode this determines
// whether we diff against a branch or search git log by story ID.
let worktreeExists = false
if (REVIEW_ONLY) {
  const detection = await agent(
    `Check if this git worktree path exists: ${WORKTREE_PATH}
Run: ls ${WORKTREE_PATH} 2>/dev/null && echo EXISTS || echo MISSING
Return: { "exists": true } if it exists, { "exists": false } if not.`,
    { label: 'worktree-detection', phase: 'Preflight', model: 'haiku', schema: { type: 'object', properties: { exists: { type: 'boolean' } }, required: ['exists'] } }
  )
  worktreeExists = detection && detection.exists === true
  log(worktreeExists
    ? `Worktree found at ${WORKTREE_PATH}. Diffing against main...${WORKTREE_BRANCH}.`
    : `No worktree found. Implementation is on main. Diffing by story ID in git log.`)
}

// Build context and diff instructions based on where the implementation lives
const CLIENT_WORK_PATH = (!REVIEW_ONLY || worktreeExists) ? CLIENT_WORKTREE : CLIENT_REPO

const DIFF_INSTRUCTIONS = (!REVIEW_ONLY || worktreeExists)
  ? `Run to see changes:
  cd ${WORKTREE_PATH} && git diff main...${WORKTREE_BRANCH}
  cd ${CLIENT_WORKTREE} && git diff main...${WORKTREE_BRANCH}`
  : `Run to see changes (implementation is on main — find commits by story ID):
  cd ${REPO} && git log --oneline --grep="${STORY_ID}" | head -10
  cd ${REPO} && git show <commit-hash> for each relevant commit
  cd ${CLIENT_REPO} && git log --oneline --grep="${STORY_ID}" | head -10
  cd ${CLIENT_REPO} && git show <commit-hash> for each relevant commit`

const WORKTREE_CONTEXT = (!REVIEW_ONLY || worktreeExists)
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
    { label: 'create-worktrees', phase: 'Setup', model: 'haiku' }
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

Run gates using targeted filter (not all packages):
  cd ${CLIENT_WORKTREE} && pnpm --filter @cello-protocol/client run test -- --pool-options.threads.maxThreads=1 --pool-options.threads.minThreads=1
  cd ${CLIENT_WORKTREE} && pnpm run lint
  cd ${CLIENT_WORKTREE} && pnpm run typecheck

All gates must be clean before committing.
Commit with: "feat(${STORY_ID}): <one-line summary>"

Return: files changed, gate results, commit hash, assumptions made.`,
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
    { label: `code-reviewer-r${roundNum}`, phase: 'Review', model: 'sonnet', agentType: 'feature-dev:code-reviewer' }
  )

  log(`Round ${roundNum} code review complete.`)

  await agent(
    `You are the CELLO sprint coder. Fix ALL findings from the code reviewer for story ${STORY_ID}.

${WORKTREE_CONTEXT}

CODE REVIEWER FINDINGS:
${typeof result === 'string' ? result : JSON.stringify(result)}

Fix every finding — critical, important, medium, AND low. No exceptions.

Run gates after fixing (targeted filter only):
  cd ${CLIENT_WORK_PATH} && pnpm --filter @cello-protocol/client run test -- --pool-options.threads.maxThreads=1 --pool-options.threads.minThreads=1
  cd ${CLIENT_WORK_PATH} && pnpm run lint
  cd ${CLIENT_WORK_PATH} && pnpm run typecheck

Commit: "fix(${STORY_ID}): address code review findings round ${roundNum}"`,
    { label: `fix-code-r${roundNum}`, phase: 'Review', model: 'sonnet', agentType: 'cello-sprint-coder' }
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
    { label: `gate-code-r${roundNum}`, phase: 'Review', model: 'haiku', schema: { type: 'object', properties: { allLow: { type: 'boolean' } }, required: ['allLow'] } }
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
    { label: `sprint-reviewer-r${roundNum}`, phase: 'Review', model: 'sonnet', agentType: 'cello-sprint-reviewer' }
  )

  log(`Round ${roundNum} sprint review complete.`)

  await agent(
    `You are the CELLO sprint coder. Fix ALL findings from the sprint reviewer for story ${STORY_ID}.

${WORKTREE_CONTEXT}

SPRINT REVIEWER FINDINGS:
${typeof result === 'string' ? result : JSON.stringify(result)}

Fix every finding — blocking, high, medium, AND low. No exceptions regardless of APPROVED/BLOCKED.

Run gates after fixing (targeted filter only):
  cd ${CLIENT_WORK_PATH} && pnpm --filter @cello-protocol/client run test -- --pool-options.threads.maxThreads=1 --pool-options.threads.minThreads=1
  cd ${CLIENT_WORK_PATH} && pnpm run lint
  cd ${CLIENT_WORK_PATH} && pnpm run typecheck

Commit: "fix(${STORY_ID}): address sprint review findings round ${roundNum}"`,
    { label: `fix-sprint-r${roundNum}`, phase: 'Review', model: 'sonnet', agentType: 'cello-sprint-coder' }
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
    { label: `gate-sprint-r${roundNum}`, phase: 'Review', model: 'haiku', schema: { type: 'object', properties: { allLow: { type: 'boolean' } }, required: ['allLow'] } }
  )

  return { result, converged: gate && gate.allLow === true }
}

// Independent convergence state — a converged reviewer is never re-run
let codeConverged = SKIP_CODE_REVIEW
let sprintConverged = SKIP_SPRINT_REVIEW
const rounds = []

for (let i = 1; i <= MAX_ROUNDS; i++) {
  const roundData = { round: i }

  if (!codeConverged) {
    const { result, converged } = await runCodeReview(i)
    roundData.codeReview = result
    codeConverged = converged
    if (converged) log(`Round ${i}: code reviewer converged (all findings low). Will not re-run.`)
  } else {
    log(`Round ${i}: code reviewer already converged — skipping.`)
  }

  if (!sprintConverged) {
    const { result, converged } = await runSprintReview(i)
    roundData.sprintReview = result
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

if (!codeConverged || !sprintConverged) {
  log(`Reached max rounds (${MAX_ROUNDS}). Code converged: ${codeConverged}. Sprint converged: ${sprintConverged}.`)
}

log(`Done — ${rounds.length} round(s) completed.`)

return {
  storyId: STORY_ID,
  worktrees: { trustlessCello: WORKTREE_PATH, celloClient: CLIENT_WORKTREE },
  rounds,
  status: 'done',
}
