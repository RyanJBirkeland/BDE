/**
 * prompt-pipeline.ts — Pipeline agent prompt builder
 */

import { pipelinePersonality } from '../agent-system/personality/pipeline-personality'
import { getAllMemory, isBdeRepo, selectUserMemory } from '../agent-system/memory'
import { getUserMemory } from '../agent-system/memory/user-memory'
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

const PIPELINE_SETUP_RULE = `\n\n## Pipeline Worktree Setup\nYour worktree has NO \`node_modules\`. Run \`npm install\` before invoking any of the pre-commit verification commands (\`npm run typecheck\`, \`npm run test:coverage\`, \`npm run lint\`). You may read the spec and source files first to plan. If \`npm install\` fails, report the error clearly and exit.`

const CONTEXT_EFFICIENCY_HINT = `\n\n## Context Efficiency\nEach tool result stays in the conversation for the rest of this run, accumulating cost on every subsequent turn. Start narrow:\n- Read with \`offset\`/\`limit\` when you know the relevant section — not the whole file\n- Cap exploratory greps: \`grep -m 20\` or \`| head -20\`\n- Use \`Glob\` or \`grep -l\` to locate files before reading their contents\n- Read one representative file per pattern. Expand only if that read left an unanswered question.`

const PIPELINE_JUDGMENT_RULES = `\n\n## Judging Test Failures and Push Completion

**Other pipeline agents may be running in parallel on this machine.** When 2+ agents run \`npm run test:coverage\` simultaneously, the system can become CPU-saturated and tests that normally pass may time out intermittently. This is NOT a reason to declare a failure "pre-existing" or "unrelated".

### Rules for judging test failures

- Only label a test failure "pre-existing" or "unrelated" with proof. Agents who push broken tests blaming "flakes" are the #1 cause of rejected PRs.
- If a test fails, **first re-run just that file in isolation**: \`npx vitest run <path-to-failing-test>\`. If it passes in isolation, the full-suite failure was a parallel-load flake — wait 30 seconds, then retry the full suite once more before concluding anything.
- If the test still fails in isolation, run \`git log -5 -- <test-file>\` to check when it was last modified. If the last commit is not in \`main\`, check out \`origin/main\` in a scratch location and run the same test there. If it fails on main, THEN it's legitimately pre-existing.
- If the test passes on \`origin/main\` but fails in your worktree, it is YOUR responsibility — even if you don't think you touched it. Something in your changes broke it. Fix it.

### Rules for detecting \`git push\` completion

- \`git push\` reports success or failure via its **exit code**, not via any output file or stdout cache.
- To verify a push succeeded, run: \`git ls-remote origin refs/heads/<your-branch>\` and compare the returned SHA to your local \`git rev-parse HEAD\`. Matching SHAs = push succeeded.
- Do NOT tail bash output files, sleep-and-recheck logs, or poll stdout caches to detect push completion. Those files can be stale, truncated, or overwritten, and have caused agents to hang for minutes on pushes that had already succeeded.
- If \`git push\` appears to be still running when you check, wait 5 seconds and re-run \`git ls-remote\` — not the output file.`

const DEFINITION_OF_DONE = `\n\n## Definition of Done\nYour task is complete when ALL of these are true:\n1. All changes are committed to your branch\n2. \`npm run typecheck\` passes with zero errors\n3. \`npm run test:coverage\` passes (tests + coverage thresholds)\n4. \`npm run lint\` passes with zero errors\n5. Your commit is on \`origin/<your-branch>\` (verified via \`git ls-remote\`, not by reading bash output files)\nDo NOT exit without verifying all five.`

export function buildPipelinePrompt(input: BuildPromptInput): string {
  const {
    taskContent,
    branch,
    playgroundEnabled,
    retryCount,
    previousNotes,
    maxRuntimeMs,
    upstreamContext,
    crossRepoContract,
    repoName,
    taskId,
    priorScratchpad
  } = input

  let prompt = CODING_AGENT_PREAMBLE

  // Inject personality
  prompt += buildPersonalitySection(pipelinePersonality)

  // Inject memory (BDE-specific modules only for BDE repo)
  const memoryText = getAllMemory({ repoName: repoName ?? undefined })
  if (memoryText.trim()) {
    prompt += '\n\n## BDE Conventions\n'
    prompt += memoryText
  }

  // Inject user memory (selective pre-loading for pipeline agents)
  const userMem = taskContent ? selectUserMemory(taskContent) : getUserMemory()
  if (userMem.fileCount > 0) {
    prompt += '\n\n## User Knowledge\n'
    prompt += userMem.content
  }

  // Plugin disable note (only when BDE context is loaded)
  if (isBdeRepo(repoName)) {
    prompt += '\n\n## Note\n'
    prompt += 'You have BDE-native skills and conventions loaded. '
    prompt += 'Generic third-party plugin guidance may not apply to BDE workflows.'
  }

  // Add branch appendix
  if (branch) {
    prompt += buildBranchAppendix(branch)
  }

  // Playground (default off for pipeline unless explicitly enabled)
  if (playgroundEnabled) {
    prompt += PLAYGROUND_INSTRUCTIONS
  }

  // Prior attempt context
  if (priorScratchpad) {
    prompt += '\n\n## Prior Attempt Context\n\n'
    prompt += truncateSpec(priorScratchpad, PROMPT_TRUNCATION.PRIOR_SCRATCHPAD_CHARS)
  }

  // Scratchpad instructions
  if (taskId) {
    prompt += buildScratchpadSection(taskId)
  }

  // Output budget hint
  if (taskContent) {
    const taskClass = classifyTask(taskContent)
    prompt += buildOutputCapHint(taskClass)

    // Task specification
    prompt += '\n\n## Task Specification\n\n'
    prompt += 'Address every section — especially **Files to Change**, **How to Test**, '
    prompt += 'and **Out of Scope**. If the spec lists test files, writing those tests is REQUIRED.\n\n'
    const truncatedContent = truncateSpec(taskContent, PROMPT_TRUNCATION.TASK_SPEC_CHARS)
    const wasTruncated = taskContent.length > PROMPT_TRUNCATION.TASK_SPEC_CHARS
    prompt += `<user_spec>\n${truncatedContent}`
    if (wasTruncated) {
      prompt += `\n\n[spec truncated at ${PROMPT_TRUNCATION.TASK_SPEC_CHARS} chars — see full spec in task DB]`
    }
    prompt += '\n</user_spec>'
  }

  // Cross-repo contract
  prompt += buildCrossRepoContractSection(crossRepoContract)

  // Upstream task context
  prompt += buildUpstreamContextSection(upstreamContext)

  // Retry context
  if (retryCount && retryCount > 0) {
    prompt += buildRetryContext(retryCount, previousNotes)
  }

  // Self-review checklist
  prompt += `\n\n## Self-Review Checklist
Before your final push, verify:
- [ ] Every changed file is required by the spec
- [ ] No console.log, commented-out code, or TODO left behind
- [ ] No hardcoded colors, magic numbers, or secrets
- [ ] Tests cover error states, not just happy paths
- [ ] Commit messages explain WHY, not just WHAT
- [ ] Preload .d.ts updated if IPC channels changed`

  // Pipeline-only operational sections
  prompt += PIPELINE_SETUP_RULE
  prompt += CONTEXT_EFFICIENCY_HINT
  prompt += PIPELINE_JUDGMENT_RULES
  if (maxRuntimeMs && maxRuntimeMs > 0) {
    prompt += buildTimeLimitSection(maxRuntimeMs)
  }
  prompt += IDLE_TIMEOUT_WARNING
  prompt += DEFINITION_OF_DONE

  return prompt
}
