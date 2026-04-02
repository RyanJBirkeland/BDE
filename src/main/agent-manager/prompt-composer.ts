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
- Run \`npm install\` if node_modules/ is missing or incomplete before starting work
- Run tests after changes: \`npm test\` and \`npm run typecheck\`
- Use the project's commit format: \`{type}: {description}\` (feat:, fix:, chore:)
- Prefer editing existing files over creating new ones
- Use TypeScript strict mode conventions`

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

const PLAYGROUND_INSTRUCTIONS = `

## Dev Playground

You have access to a Dev Playground for previewing frontend UI natively in BDE.
When you want to show a visual preview:

1. Write a self-contained HTML file (inline all CSS and JS, no external dependencies)
2. The preview will automatically appear inline in the BDE chat when you write .html files

Keep playgrounds focused on one component or layout at a time. Do NOT run
\`open\` or start a localhost server — BDE renders the HTML natively.`

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
  const { agentType, taskContent, branch, playgroundEnabled, messages, codebaseContext } = input

  // Start with universal preamble
  let prompt = UNIVERSAL_PREAMBLE

  // Inject personality
  const personality = getPersonality(agentType)
  prompt += '\n\n## Voice\n' + personality.voice
  prompt += '\n\n## Your Role\n' + personality.roleFrame
  prompt += '\n\n## Constraints\n' + personality.constraints.map((c) => `- ${c}`).join('\n')

  // Inject memory (all agents get this)
  prompt += '\n\n## BDE Conventions\n'
  prompt += getAllMemory()

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

  return prompt
}
