/**
 * prompt-pipeline.ts — Pipeline agent prompt builder
 */

import { pipelinePersonality } from '../agent-system/personality/pipeline-personality'
import { selectUserMemory } from '../agent-system/memory'
import {
  CODING_AGENT_PREAMBLE,
  PLAYGROUND_INSTRUCTIONS,
  buildPersonalitySection,
  truncateSpec,
  buildUpstreamContextSection,
  buildBranchAppendix,
  buildRetryContext,
  buildScratchpadSection,
  buildCrossRepoContractSection
} from './prompt-sections'
import type { BuildPromptInput } from '../lib/prompt-composer'
import { PROMPT_TRUNCATION } from './prompt-constants'
import { getConfiguredRepos } from '../paths'

type PipelinePromptProfile = 'bde' | 'minimal'

function getRepoPromptProfile(repoName: string | null | undefined): PipelinePromptProfile {
  if (!repoName) return 'bde'
  try {
    const repo = getConfiguredRepos().find((r) => r.name.toLowerCase() === repoName.toLowerCase())
    return repo?.promptProfile ?? 'bde'
  } catch {
    return 'bde'
  }
}

// ---------------------------------------------------------------------------
// Task Class — heuristic classifier + output cap hints
// ---------------------------------------------------------------------------

export type TaskClass = 'fix' | 'refactor' | 'doc' | 'audit' | 'generate'

/**
 * Classify a pipeline task based on keywords in its content.
 * Used to inject a per-class output-token hint so agents don't over-generate.
 * Classification is heuristic — false negatives default to 'generate'.
 */
export function classifyTask(taskContent: string): TaskClass {
  const lower = taskContent.toLowerCase()
  if (/\b(bug fix|bugfix|fixes #|fix:|\bfix\b.*issue|\bfix\b.*error|\bfix\b.*crash)/.test(lower))
    return 'fix'
  if (/\b(refactor|cleanup|clean up|reorganize|restructure|simplify|consolidate)/.test(lower))
    return 'refactor'
  if (/\b(doc(ument|s|umentation)?|readme|changelog|comment|jsdoc|tsdoc|add docs)/.test(lower))
    return 'doc'
  if (/\b(audit|review|investigate|profile|measure|benchmark|analyze|analyse)/.test(lower))
    return 'audit'
  return 'generate'
}

/** Soft output-token cap per task class (guidance in the prompt, not enforced by SDK). */
const TASK_CLASS_CAP: Record<TaskClass, number> = {
  fix: 4_000,
  refactor: 4_000,
  doc: 2_000,
  audit: 2_000,
  generate: 8_000
}

function buildOutputCapHint(taskClass: TaskClass): string {
  const cap = TASK_CLASS_CAP[taskClass]
  return `\n\n## Output Budget\nThis task is classified as **${taskClass}**. Keep output ≤${cap.toLocaleString()} tokens. Focus on precise, targeted changes — avoid generating boilerplate, verbose comments, or re-stating existing code that doesn't need to change.`
}

function buildTimeLimitSection(maxRuntimeMs: number): string {
  const minutes = Math.round(maxRuntimeMs / 60_000)
  return `\n\n## Time Management\nYou have a maximum of ${minutes} minutes. You will be killed with NO WARNING if you exceed this.\nBudget 70% for implementation, 30% for testing and verification.\nCommit early — uncommitted work is LOST if you are terminated.`
}

const IDLE_TIMEOUT_WARNING = `\n\n## Idle Timeout Warning\nYou will be TERMINATED if you produce no output for 15 minutes. If running long commands (npm install, test suites), emit a progress message before and after.`

const RULES_OF_ENGAGEMENT = `\n\n### Rules of engagement

TRUST THE SPEC. The task's spec below is the complete description of what to change. Do NOT run reconnaissance commands — no \`git log\`, \`git status\`, \`git diff\`, \`git ls-remote\`, \`git reflog\`, \`git log --grep\`, or similar. If the spec says "change X to Y in file Z", just open Z, make the change, and move on.

Use \`Bash\` only for:
- \`npm run typecheck\` (verification)
- \`npm test\` (verification)
- The specific verification command the spec tells you to run

Skip exploring directories outside the file list. The spec is the source of truth; the codebase may contain conflicting context but your job is to execute the spec as written.`

const TESTING_GUIDANCE = `\n\n### Testing guidance

After making code changes, search for tests that reference the symbols you changed (selectors, placeholder text, function names, ARIA attributes, className values). Common locations:
- \`<name>.test.tsx\` next to the component
- \`__tests__/<name>.test.tsx\` in a sibling directory

Update failing tests to match your changes. Run \`npm run typecheck\` and (when relevant) \`npm test\` in your worktree before committing. If you cannot reconcile a test with the new code, flag it in the commit body rather than deleting the test.`

const PIPELINE_SETUP_RULE = `\n\n## Pipeline Worktree Setup\nYour worktree has NO \`node_modules\`. Run \`npm install\` before invoking any of the pre-commit verification commands (\`npm run typecheck\`, \`npm test\`, \`npm run lint\`). You may read the spec and source files first to plan. If \`npm install\` fails, report the error clearly and exit.`

const CONTEXT_EFFICIENCY_HINT = `\n\n## Context Efficiency\nEach tool result stays in the conversation for the rest of this run, accumulating cost on every subsequent turn. Start narrow:\n- Read with \`offset\`/\`limit\` when you know the relevant section — not the whole file\n- Cap exploratory greps: \`grep -m 20\` or \`| head -20\`\n- Use \`Glob\` or \`grep -l\` to locate files before reading their contents\n- Read one representative file per pattern. Expand only if that read left an unanswered question.`

const PUSH_FAILURE_GUIDANCE = `\n\n## When git push Fails

The pre-push hook runs the full test suite automatically. If \`git push\` exits non-zero:
1. Read the error — it names the specific test file or check that failed
2. Fix that failure locally (\`npx vitest run <failing-file>\` or \`npm run typecheck\` to debug)
3. Commit the fix: \`git add <files> && git commit -m "fix: resolve pre-push hook failure"\`
4. Push again — do NOT retry the push without fixing the failure first`

const PIPELINE_JUDGMENT_RULES = `\n\n## Judging Test Failures and Push Completion

### Rules for judging test failures

You only run targeted tests (\`npx vitest run <your-test-file>\`), not the full suite. If your targeted test fails:
- Fix the failure. Do not retry the same test repeatedly — read the error, understand it, fix it.
- If you did not touch any test files, skip test verification entirely.
- Do NOT run \`npm test\` or \`npm run test:main\` to check for regressions — the pre-push hook does this.

### Rules for detecting \`git push\` completion

- \`git push\` reports success or failure via its **exit code**, not via any output file or stdout cache.
- To verify a push succeeded, run: \`git ls-remote origin refs/heads/<your-branch>\` and compare the returned SHA to your local \`git rev-parse HEAD\`. Matching SHAs = push succeeded.
- Do NOT tail bash output files, sleep-and-recheck logs, or poll stdout caches to detect push completion. Those files can be stale, truncated, or overwritten, and have caused agents to hang for minutes on pushes that had already succeeded.
- If \`git push\` appears to be still running when you check, wait 5 seconds and re-run \`git ls-remote\` — not the output file.`

const DEFINITION_OF_DONE = `\n\n## Definition of Done\nYour task is complete when ALL of these are true:\n1. All changes are committed to your branch\n2. \`npm run typecheck\` passes with zero errors\n3. \`npx vitest run <your-test-file>\` passes for each test file you created or modified (skip if no test files touched)\n4. \`npm run lint\` passes with zero errors\n5. Your commit is on \`origin/<your-branch>\` (verified via \`git ls-remote\`, not by reading bash output files)\n6. \`docs/modules/\` updated for every source file you created or modified — add a row to the layer \`index.md\`; update the \`<module>.md\` detail file if exports or observable behavior changed\nDo NOT run \`npm test\` — the pre-push hook runs the full suite. Only run the specific test files you touched.\nDo NOT exit without verifying all six.`

const MINIMAL_PIPELINE_PREAMBLE = `You are an autonomous coding agent working in a git worktree. Follow the task specification below exactly.

## Rules
- Read each file you need to edit before modifying it.
- Only modify files explicitly named in the spec's "Files to Change" section.
- Use the EXACT names, symbols, and strings the spec specifies. Do not paraphrase.
- Commit every change with a meaningful conventional-commit subject (e.g. \`fix: off-by-one in paginate\`).
- Match the surrounding code style of each file you touch.
- Exit once every item in the spec's success criteria holds.
`

function buildMinimalPipelinePrompt(input: BuildPromptInput): string {
  const { taskContent, branch, taskId } = input
  let prompt = MINIMAL_PIPELINE_PREAMBLE

  if (branch) prompt += buildBranchAppendix(branch)
  if (taskId) prompt += buildScratchpadSection(taskId)

  if (taskContent) {
    prompt += '\n\n## Task Specification\n\n'
    const truncated = truncateSpec(taskContent, PROMPT_TRUNCATION.TASK_SPEC_CHARS)
    prompt += `<user_spec>\n${truncated}\n</user_spec>`
  }

  return prompt
}

export function buildPipelinePrompt(input: BuildPromptInput): string {
  const profile = getRepoPromptProfile(input.repoName)
  if (profile === 'minimal') {
    return buildMinimalPipelinePrompt(input)
  }

  const {
    taskContent,
    branch,
    playgroundEnabled,
    retryCount,
    previousNotes,
    maxRuntimeMs,
    upstreamContext,
    crossRepoContract,
    taskId,
    priorScratchpad,
    revisionFeedback
  } = input

  let prompt = CODING_AGENT_PREAMBLE

  // Rules of engagement — placed before personality/memory so the "trust the spec,
  // no reconnaissance" directive frames everything the agent reads downstream.
  prompt += RULES_OF_ENGAGEMENT

  // Inject personality
  prompt += buildPersonalitySection(pipelinePersonality)

  // Inject user memory (selective pre-loading for pipeline agents)
  const userMem = selectUserMemory(taskContent ?? '')
  if (userMem.fileCount > 0) {
    prompt += '\n\n## User Knowledge\n'
    prompt += userMem.content
  }

  // Add branch appendix
  if (branch) {
    prompt += buildBranchAppendix(branch)
  }

  // Playground (default off for pipeline unless explicitly enabled)
  if (playgroundEnabled) {
    prompt += PLAYGROUND_INSTRUCTIONS
  }

  // Scratchpad instructions (setup — must come before task spec so agent knows to check it first)
  if (taskId) {
    prompt += buildScratchpadSection(taskId)
  }

  // Classify once — used for both the output-budget hint and judgment-rules gating
  const taskClass: TaskClass = taskContent ? classifyTask(taskContent) : 'generate'

  // Upstream context first so the agent understands the API surface before reading its own spec
  prompt += buildUpstreamContextSection(upstreamContext)

  // Cross-repo contract (adjacent to upstream context — both shape what APIs are available)
  prompt += buildCrossRepoContractSection(crossRepoContract)

  // Output budget hint
  if (taskContent) {
    prompt += buildOutputCapHint(taskClass)

    // Task specification
    prompt += '\n\n## Task Specification\n\n'
    prompt += 'Address every section — especially **Files to Change**, **How to Test**, '
    prompt +=
      'and **Out of Scope**. If the spec lists test files, writing those tests is REQUIRED.\n\n'
    const truncatedContent = truncateSpec(taskContent, PROMPT_TRUNCATION.TASK_SPEC_CHARS)
    const wasTruncated = taskContent.length > PROMPT_TRUNCATION.TASK_SPEC_CHARS
    prompt += `<user_spec>\n${truncatedContent}`
    if (wasTruncated) {
      prompt += `\n\n[spec truncated at ${PROMPT_TRUNCATION.TASK_SPEC_CHARS} chars — see full spec in task DB]`
    }
    prompt += '\n</user_spec>'
  }

  // Prior attempt scratchpad (after spec so the agent can cross-reference what it tried vs what's asked)
  if (priorScratchpad) {
    prompt += '\n\n## Prior Attempt Context\n\n'
    prompt += truncateSpec(priorScratchpad, PROMPT_TRUNCATION.PRIOR_SCRATCHPAD_CHARS)
  }

  // Retry context (after spec and scratchpad — failure notes are most useful with full task context in mind)
  // Emitted when there is an auto-retry in progress OR human revision feedback to act on.
  prompt += buildRetryContext(retryCount ?? 0, previousNotes, revisionFeedback ?? undefined)

  // Self-review checklist
  prompt += `\n\n## Self-Review Checklist
Before your final push, verify:
- [ ] Every changed file is required by the spec
- [ ] No console.log, commented-out code, or TODO left behind
- [ ] No hardcoded colors, magic numbers, or secrets
- [ ] Tests cover error states, not just happy paths
- [ ] Commit messages explain WHY, not just WHAT
- [ ] Preload .d.ts updated if IPC channels changed`

  // Definition of Done directly after self-review so it's read before operational boilerplate
  prompt += DEFINITION_OF_DONE

  // Testing guidance — sits adjacent to Definition of Done so the test-update
  // expectation is read alongside the verification checklist.
  prompt += TESTING_GUIDANCE

  // Operational sections (setup, efficiency, push mechanics)
  prompt += PIPELINE_SETUP_RULE
  prompt += CONTEXT_EFFICIENCY_HINT
  // Test failure / push mechanics judgment rules only relevant for code-changing tasks.
  // Doc, audit, and generation tasks don't trigger test regressions or need flake guidance.
  if (taskClass === 'fix' || taskClass === 'refactor') {
    prompt += PIPELINE_JUDGMENT_RULES
  }
  // Pre-push hook failure guidance applies to all tasks that push code.
  prompt += PUSH_FAILURE_GUIDANCE
  if (maxRuntimeMs && maxRuntimeMs > 0) {
    prompt += buildTimeLimitSection(maxRuntimeMs)
  }
  prompt += IDLE_TIMEOUT_WARNING

  return prompt
}
