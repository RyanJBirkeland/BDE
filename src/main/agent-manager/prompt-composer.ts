/**
 * prompt-composer.ts — Universal agent prompt builder
 *
 * Centralizes all agent prompt assembly into one pure function.
 * All BDE agents get a universal preamble + role-specific instructions + task context.
 */

import { pipelinePersonality } from '../agent-system/personality/pipeline-personality'
import { assistantPersonality } from '../agent-system/personality/assistant-personality'
import { copilotPersonality } from '../agent-system/personality/copilot-personality'
import { synthesizerPersonality } from '../agent-system/personality/synthesizer-personality'
import { adhocPersonality } from '../agent-system/personality/adhoc-personality'
import type { AgentPersonality } from '../agent-system/personality/types'
import { getAllMemory } from '../agent-system/memory'
import { getUserMemory } from '../agent-system/memory/user-memory'
import { getAllSkills } from '../agent-system/skills'

export type AgentType = 'pipeline' | 'assistant' | 'adhoc' | 'copilot' | 'synthesizer'

export interface BuildPromptInput {
  agentType: AgentType
  taskContent?: string // spec, prompt, or user message
  branch?: string // git branch for pipeline/adhoc agents
  playgroundEnabled?: boolean // whether to include playground instructions
  messages?: Array<{ role: string; content: string }> // for copilot chat
  formContext?: { title: string; repo: string; spec: string } // for copilot
  codebaseContext?: string // for synthesizer (file tree, relevant files)
  retryCount?: number // 0-based retry count
  previousNotes?: string // failure notes from previous attempt
  maxRuntimeMs?: number | null // max runtime in ms
  upstreamContext?: Array<{ title: string; spec: string; partial_diff?: string }> // completed upstream task specs + diffs
  crossRepoContract?: string | null // cross-repo API contract documentation
}

// ---------------------------------------------------------------------------
// Universal Preamble (all agents get this)
// ---------------------------------------------------------------------------

const UNIVERSAL_PREAMBLE = `You are a BDE (Birkeland Development Environment) agent.

## Who You Are
- You are an autonomous coding agent spawned by BDE's agent manager
- You work in git worktrees — never modify the main checkout directly
- Your work will be reviewed via PR before merging to main

## Hard Rules
- NEVER push to, checkout, or merge into \`main\`. Only push to your assigned branch.
- NEVER commit secrets, .env files, or oauth tokens
- Your worktree has NO node_modules. Run \`npm install\` as your FIRST action before reading any files or running any commands.
- Use the project's commit format: \`{type}: {description}\` (feat:, fix:, chore:)
- Prefer editing existing files over creating new ones
- Use TypeScript strict mode conventions

## MANDATORY Pre-Commit Verification (DO NOT SKIP)
Before EVERY commit, you MUST run ALL of these and they MUST pass:
1. \`npm run typecheck\` — TypeScript must compile with zero errors
2. \`npm test\` — All renderer tests must pass (currently 2563+ tests)
3. \`npm run lint\` — Must have zero errors (warnings are OK)

If ANY check fails, fix the issue before committing. Do NOT commit with failing tests,
type errors, or lint errors. If you cannot fix a failure, do NOT commit — report the
issue instead.

This is non-negotiable. The CI pipeline runs these same checks and will reject your PR
if they fail. Broken tests waste everyone's time.`

// ---------------------------------------------------------------------------
// Operational Appendix (conditional sections)
// ---------------------------------------------------------------------------

function buildBranchAppendix(branch: string): string {
  return `

## Git Branch
You are working on branch \`${branch}\`. Commit and push ONLY to this branch.
Do NOT checkout, merge to, or push to \`main\`. The CI/PR system handles integration.
If you need to push, use: \`git push origin ${branch}\``
}

// ---------------------------------------------------------------------------
// Retry Context
// ---------------------------------------------------------------------------

const MAX_RETRIES_FOR_DISPLAY = 3

function buildRetryContext(retryCount: number, previousNotes?: string): string {
  const attemptNum = retryCount + 1
  const maxAttempts = MAX_RETRIES_FOR_DISPLAY + 1
  const notesText = previousNotes
    ? `Previous attempt failed: ${previousNotes}`
    : 'No failure notes from previous attempt.'
  return `\n\n## Retry Context\nThis is attempt ${attemptNum} of ${maxAttempts}. ${notesText}\nDo NOT repeat the same approach. Analyze what went wrong and try a different strategy.\nIf the previous failure was a test/typecheck error, fix that specific error first.`
}

const PLAYGROUND_INSTRUCTIONS = `

## Dev Playground

You have access to a Dev Playground for previewing frontend UI natively in BDE.
When you want to show a visual preview:

1. Write a self-contained HTML file (inline all CSS and JS, no external dependencies)
2. The preview will automatically appear inline in the BDE chat when you write .html files

Keep playgrounds focused on one component or layout at a time. Do NOT run
\`open\` or start a localhost server — BDE renders the HTML natively.`

// ---------------------------------------------------------------------------
// Pipeline-Specific Sections
// ---------------------------------------------------------------------------

function buildTimeLimitSection(maxRuntimeMs: number): string {
  const minutes = Math.round(maxRuntimeMs / 60_000)
  return `\n\n## Time Management\nYou have a maximum of ${minutes} minutes. You will be killed with NO WARNING if you exceed this.\nBudget 70% for implementation, 30% for testing and verification.\nCommit early — uncommitted work is LOST if you are terminated.`
}

const IDLE_TIMEOUT_WARNING = `\n\n## Idle Timeout Warning\nYou will be TERMINATED if you produce no output for 15 minutes. If running long commands (npm install, test suites), emit a progress message before and after.`

const DEFINITION_OF_DONE = `\n\n## Definition of Done\nYour task is complete when ALL of these are true:\n1. All changes are committed to your branch\n2. \`npm run typecheck\` passes with zero errors\n3. \`npm test\` passes\n4. \`npm run lint\` passes with zero errors\nDo NOT exit without running all four checks.`

// ---------------------------------------------------------------------------
// Native System Support
// ---------------------------------------------------------------------------

/**
 * Get personality for agent type
 */
function getPersonality(agentType: AgentType): AgentPersonality {
  switch (agentType) {
    case 'pipeline':
      return pipelinePersonality
    case 'assistant':
      return assistantPersonality
    case 'adhoc':
      return adhocPersonality
    case 'copilot':
      return copilotPersonality
    case 'synthesizer':
      return synthesizerPersonality
  }
}

// ---------------------------------------------------------------------------
// Main Prompt Builder
// ---------------------------------------------------------------------------

/**
 * Build agent prompt with universal preamble, personality, memory, skills, and task content.
 *
 * This is the universal prompt builder for all BDE agents (pipeline, assistant, adhoc,
 * copilot, synthesizer). All agent spawning paths must use this function instead of
 * inline prompt assembly.
 *
 * **Native System:**
 * Injects for every agent type:
 * - Personality (voice, roleFrame, constraints) specific to the agent type
 * - Memory modules (IPC conventions, testing patterns, architecture rules)
 * - Skills (ONLY for assistant/adhoc agents — pipeline agents do not get skills)
 *
 * **Conditional Sections:**
 * - Branch info appended if `branch` is provided
 * - Playground instructions appended if `playgroundEnabled` is true
 * - Copilot conversation appended if `messages` array is provided
 * - Synthesizer codebase context appended if `codebaseContext` is provided
 *
 * @param input - Prompt configuration object
 * @param input.agentType - Type of agent: pipeline, assistant, adhoc, copilot, synthesizer
 * @param input.taskContent - Spec, prompt, or user message (optional)
 * @param input.branch - Git branch for pipeline/adhoc agents (optional)
 * @param input.playgroundEnabled - Whether to include playground instructions (optional)
 * @param input.messages - Copilot chat message history (optional)
 * @param input.formContext - Copilot form context (title, repo, spec) (optional)
 * @param input.codebaseContext - Synthesizer codebase context (file tree, relevant files) (optional)
 * @returns Complete prompt string ready for agent spawning
 */
export function buildAgentPrompt(input: BuildPromptInput): string {
  const {
    agentType,
    taskContent,
    branch,
    playgroundEnabled,
    messages,
    codebaseContext,
    retryCount,
    previousNotes,
    maxRuntimeMs,
    upstreamContext,
    crossRepoContract
  } = input

  // Start with universal preamble
  let prompt = UNIVERSAL_PREAMBLE

  // Inject personality
  const personality = getPersonality(agentType)
  prompt += '\n\n## Voice\n' + personality.voice
  prompt += '\n\n## Your Role\n' + personality.roleFrame
  prompt += '\n\n## Constraints\n' + personality.constraints.map((c) => `- ${c}`).join('\n')

  // Inject behavioral patterns if defined
  if (personality.patterns && personality.patterns.length > 0) {
    prompt += '\n\n## Behavioral Patterns\n' + personality.patterns.map((p) => `- ${p}`).join('\n')
  }

  // Inject memory (all agents get this)
  prompt += '\n\n## BDE Conventions\n'
  prompt += getAllMemory()

  // Inject user memory (files toggled active in Settings > Memory)
  const userMem = getUserMemory()
  if (userMem.fileCount > 0) {
    prompt += '\n\n## User Knowledge\n'
    prompt += userMem.content
  }

  // Inject skills (interactive agents only)
  if (agentType === 'assistant' || agentType === 'adhoc') {
    prompt += '\n\n## Available Skills\n'
    prompt += getAllSkills()
  }

  // Plugin disable note
  prompt += '\n\n## Note\n'
  prompt += 'You have BDE-native skills and conventions loaded. '
  prompt += 'Generic third-party plugin guidance may not apply to BDE workflows.'

  // Add conditional operational appendices
  if (branch) {
    prompt += buildBranchAppendix(branch)
  }

  if (playgroundEnabled) {
    prompt += PLAYGROUND_INSTRUCTIONS
  }

  // Add task content based on agent type
  if (agentType === 'copilot' && messages) {
    // For copilot, add form context if available, then message history
    if (input.formContext) {
      const { title, repo, spec } = input.formContext
      prompt += '\n\n## Task Context\n\n'
      prompt += `Title: "${title}"\nRepo: ${repo}\n`
      if (spec) {
        prompt += `\nSpec draft:\n${spec}\n`
      } else {
        prompt += '\n(no spec yet)\n'
      }
    }

    prompt += '\n\n## Conversation\n\n'
    for (const msg of messages) {
      prompt += `**${msg.role}**: ${msg.content}\n\n`
    }
  } else if (agentType === 'synthesizer' && codebaseContext) {
    // For synthesizer, include codebase context before task content
    prompt += '\n\n## Codebase Context\n\n' + codebaseContext
    if (taskContent) {
      prompt += '\n\n## Generation Instructions\n\n' + taskContent
    }
  } else if (taskContent) {
    // For pipeline, assistant, adhoc: append task content
    prompt += '\n\n' + taskContent
  }

  // Inject cross-repo contract documentation when provided
  if (crossRepoContract && crossRepoContract.trim()) {
    prompt += '\n\n## Cross-Repo Contract\n\n'
    prompt += 'This task involves API contracts with other repositories. '
    prompt += 'Follow these contract specifications exactly:\n\n'
    prompt += crossRepoContract
  }

  // Inject upstream task context when provided
  if (upstreamContext && upstreamContext.length > 0) {
    prompt += '\n\n## Upstream Task Context\n\n'
    prompt += 'This task depends on the following completed tasks:\n\n'
    for (const upstream of upstreamContext) {
      const cappedSpec =
        upstream.spec.length > 500 ? upstream.spec.slice(0, 500) + '...' : upstream.spec
      prompt += `### ${upstream.title}\n\n${cappedSpec}\n\n`

      // Include partial diff if available (salvaged partial progress from upstream task)
      if (upstream.partial_diff) {
        const MAX_DIFF_CHARS = 2000
        const truncated = upstream.partial_diff.length > MAX_DIFF_CHARS
        const cappedDiff = truncated
          ? upstream.partial_diff.slice(0, MAX_DIFF_CHARS) + '\n\n[... diff truncated]'
          : upstream.partial_diff
        prompt += `<details>\n<summary>Partial changes from upstream task</summary>\n\n\`\`\`diff\n${cappedDiff}\n\`\`\`\n</details>\n\n`
      }
    }
  }

  // Inject retry context for pipeline agents on retry attempts
  if (agentType === 'pipeline' && retryCount && retryCount > 0) {
    prompt += buildRetryContext(retryCount, previousNotes)
  }

  // Self-review checklist (pipeline only)
  if (agentType === 'pipeline') {
    prompt += `\n\n## Self-Review Checklist
Before your final push, verify:
- [ ] Every changed file is required by the spec
- [ ] No console.log, commented-out code, or TODO left behind
- [ ] No hardcoded colors, magic numbers, or secrets
- [ ] Tests cover error states, not just happy paths
- [ ] Commit messages explain WHY, not just WHAT
- [ ] Preload .d.ts updated if IPC channels changed`
  }

  // Pipeline-only sections: time limit, idle warning, definition of done
  if (agentType === 'pipeline') {
    if (maxRuntimeMs && maxRuntimeMs > 0) {
      prompt += buildTimeLimitSection(maxRuntimeMs)
    }
    prompt += IDLE_TIMEOUT_WARNING
    prompt += DEFINITION_OF_DONE
  }

  return prompt
}
