// CELLO Story Implementation Workflow
// Usage: pass { storyId: "CELLO-M6B-005", model: "opus" } as args
// model: "opus" | "sonnet" (default: "opus") — controls sprint coder; reviews always use sonnet

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

const WORKTREE_CONTEXT = `
EXISTING WORKTREES (do NOT recreate):
- trustless-cello: ${WORKTREE_PATH} (branch: ${WORKTREE_BRANCH})
- cello-client: ${CLIENT_WORKTREE} (branch: ${WORKTREE_BRANCH})

Story YAML: ${STORY_YAML}

CRITICAL CONSTRAINTS:
- One vitest worker only: --pool-options.threads.maxThreads=1 --pool-options.threads.minThreads=1
- All work inside worktree paths above, never on main
`

// ─── SETUP ───────────────────────────────────────────────────────────────────
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

// ─── INITIAL IMPLEMENTATION ───────────────────────────────────────────────────
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

// ─── REVIEW ROUNDS (exit early on APPROVED) ──────────────────────────────────
phase('Review')

async function runRound(roundNum) {
  const codeReviewResult = await agent(
    `Review the implementation of ${STORY_ID} for bugs, logic errors, security vulnerabilities, code quality, and project conventions.

${WORKTREE_CONTEXT}

Read the story YAML first to understand required ACs and SIs:
  ${STORY_YAML}

Run to see changes:
  cd ${WORKTREE_PATH} && git diff main...${WORKTREE_BRANCH}
  cd ${CLIENT_WORKTREE} && git diff main...${WORKTREE_BRANCH}

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
${typeof codeReviewResult === 'string' ? codeReviewResult : JSON.stringify(codeReviewResult)}

Fix every finding — critical, important, medium, AND low. No exceptions.

Run gates after fixing (targeted filter only):
  cd ${CLIENT_WORKTREE} && pnpm --filter @cello-protocol/client run test -- --pool-options.threads.maxThreads=1 --pool-options.threads.minThreads=1
  cd ${CLIENT_WORKTREE} && pnpm run lint
  cd ${CLIENT_WORKTREE} && pnpm run typecheck

Commit: "fix(${STORY_ID}): address code review findings round ${roundNum}"`,
    { label: `fix-code-r${roundNum}`, phase: 'Review', model: 'sonnet', agentType: 'cello-sprint-coder' }
  )

  const sprintReviewResult = await agent(
    `You are the CELLO sprint reviewer. Review the implementation of story ${STORY_ID}.

Working directory for gate commands: ${CLIENT_WORKTREE}

${WORKTREE_CONTEXT}

Follow instructions EXACTLY from:
${REPO}/.claude/agents/sparc/cello-review.md

This is IMPLEMENTATION REVIEW MODE. Story YAML: ${STORY_YAML}

To see changes:
  cd ${WORKTREE_PATH} && git diff main...${WORKTREE_BRANCH}
  cd ${CLIENT_WORKTREE} && git diff main...${WORKTREE_BRANCH}

DO NOT summarize or truncate. Report every finding at every severity (blocking → high → medium → low).
End with APPROVED or BLOCKED.`,
    { label: `sprint-reviewer-r${roundNum}`, phase: 'Review', model: 'sonnet', agentType: 'cello-sprint-reviewer' }
  )

  log(`Round ${roundNum} sprint review complete.`)

  await agent(
    `You are the CELLO sprint coder. Fix ALL findings from the sprint reviewer for story ${STORY_ID}.

${WORKTREE_CONTEXT}

SPRINT REVIEWER FINDINGS:
${typeof sprintReviewResult === 'string' ? sprintReviewResult : JSON.stringify(sprintReviewResult)}

Fix every finding — blocking, high, medium, AND low. No exceptions regardless of APPROVED/BLOCKED.

Run gates after fixing (targeted filter only):
  cd ${CLIENT_WORKTREE} && pnpm --filter @cello-protocol/client run test -- --pool-options.threads.maxThreads=1 --pool-options.threads.minThreads=1
  cd ${CLIENT_WORKTREE} && pnpm run lint
  cd ${CLIENT_WORKTREE} && pnpm run typecheck

Commit: "fix(${STORY_ID}): address sprint review findings round ${roundNum}"`,
    { label: `fix-sprint-r${roundNum}`, phase: 'Review', model: 'sonnet', agentType: 'cello-sprint-coder' }
  )

  // Aggregator: consensus gate — exit only if BOTH reviewers found nothing above low
  const codeReviewText = typeof codeReviewResult === 'string' ? codeReviewResult : JSON.stringify(codeReviewResult)
  const sprintReviewText = typeof sprintReviewResult === 'string' ? sprintReviewResult : JSON.stringify(sprintReviewResult)

  const gate = await agent(
    `You are a severity aggregator. Read BOTH review outputs below and answer ONE question:
Did either reviewer surface any finding at severity ABOVE low (i.e. blocking, high, or medium)?

CODE REVIEWER OUTPUT:
${codeReviewText}

SPRINT REVIEWER OUTPUT:
${sprintReviewText}

Rules:
- If EITHER reviewer has at least one finding at blocking, high, or medium severity → return { "allLow": false }
- If ALL findings across BOTH reviewers are low/trivial (or there are zero findings) → return { "allLow": true }
- When in doubt, return { "allLow": false }`,
    { label: `gate-r${roundNum}`, phase: 'Review', model: 'haiku', schema: { type: 'object', properties: { allLow: { type: 'boolean' } }, required: ['allLow'] } }
  )

  const canExit = gate && gate.allLow === true
  return { round: roundNum, canExit, codeReview: codeReviewResult, sprintReview: sprintReviewResult }
}

const rounds = []
for (let i = 1; i <= 3; i++) {
  const result = await runRound(i)
  rounds.push(result)
  if (result.canExit) {
    log(`All findings low/trivial after round ${i}. Exiting early.`)
    break
  }
  if (i < 3) log(`Findings above low in round ${i}. Continuing to round ${i + 1}.`)
}

log(`Done — ${rounds.length} round(s) completed.`)

return {
  storyId: STORY_ID,
  worktrees: { trustlessCello: WORKTREE_PATH, celloClient: CLIENT_WORKTREE },
  rounds,
  status: 'done',
}
