// CELLO Story Implementation Workflow
// Usage: pass { storyId: "CELLO-M6B-005" } as args
// This is the FULL workflow: worktree creation + initial implementation + 3 review rounds

export const meta = {
  name: 'cello-story-implementation',
  description: 'Implement a single CELLO story: worktree → sprint coder → 3 rounds of (code review → fix → sprint review → fix)',
  phases: [
    { title: 'Setup', detail: 'Create git worktrees in both repos (idempotent — skips if already present)' },
    { title: 'Implement', detail: 'Sprint coder: full SPARC cycle, initial implementation' },
    { title: 'Round 1', detail: 'Code review → fix → sprint review → fix' },
    { title: 'Round 2', detail: 'Code review → fix → sprint review → fix' },
    { title: 'Round 3', detail: 'Code review → fix → sprint review → fix' },
  ],
}

const STORY_ID = args && args.storyId ? args.storyId : 'CELLO-M6B-005'
const REPO = '/Users/andrep/Documents/code/trustless-cello'
const CLIENT_REPO = '/Users/andrep/Documents/code/cello-client'
const WORKTREE_BRANCH = STORY_ID
const WORKTREE_PATH = `${REPO}/.claude/worktrees/${STORY_ID}`
const CLIENT_WORKTREE = `${CLIENT_REPO}/.claude/worktrees/${STORY_ID}`
const STORY_YAML = `${REPO}/docs/planning/user-stories/m6b/${STORY_ID}.yaml`

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
  { label: 'create-worktrees', phase: 'Setup' }
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
  { label: 'sprint-coder-initial', phase: 'Implement', agentType: 'cello-sprint-coder' }
)

// ─── ROUND HELPER ─────────────────────────────────────────────────────────────
async function runRound(roundNum) {
  phase(`Round ${roundNum}`)

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
    { label: `code-reviewer-round-${roundNum}`, phase: `Round ${roundNum}`, agentType: 'feature-dev:code-reviewer' }
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
    { label: `fix-code-review-round-${roundNum}`, phase: `Round ${roundNum}`, agentType: 'cello-sprint-coder' }
  )

  log(`Round ${roundNum} code review fixes applied.`)

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
    { label: `sprint-reviewer-round-${roundNum}`, phase: `Round ${roundNum}`, agentType: 'cello-sprint-reviewer' }
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
    { label: `fix-sprint-review-round-${roundNum}`, phase: `Round ${roundNum}`, agentType: 'cello-sprint-coder' }
  )

  log(`Round ${roundNum} complete.`)
  return { round: roundNum, codeReview: codeReviewResult, sprintReview: sprintReviewResult }
}

// ─── THREE ROUNDS ─────────────────────────────────────────────────────────────
const round1 = await runRound(1)
const round2 = await runRound(2)
const round3 = await runRound(3)

log('All 3 rounds complete.')

return {
  storyId: STORY_ID,
  worktrees: { trustlessCello: WORKTREE_PATH, celloClient: CLIENT_WORKTREE },
  rounds: [round1, round2, round3],
  status: 'done',
}
