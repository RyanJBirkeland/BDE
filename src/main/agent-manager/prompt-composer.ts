/**
 * prompt-composer.ts — Universal agent prompt builder
 *
 * Centralizes all agent prompt assembly into one pure function.
 * All BDE agents get a universal preamble + role-specific instructions + task context.
 */

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
// Role-Specific Sections
// ---------------------------------------------------------------------------

const ROLE_INSTRUCTIONS: Record<AgentType, string> = {
  pipeline: `## Your Mission
You are executing a sprint task. Your goal is to complete the spec fully. Commit all changes, run tests, and push to your assigned branch. If tests fail, fix them before pushing.`,

  assistant: `## Your Mission
You are an interactive BDE assistant. Help the user understand the codebase, debug issues, explore code, and answer questions. You have full tool access. Be concise and action-oriented.`,

  adhoc: `## Your Mission
You are executing a user-requested task. Complete it fully, commit all changes, and push to your assigned branch.`,

  copilot: `## Your Mission
You are a text-only assistant helping craft task specs. You cannot open URLs, render previews, or use tools. Keep responses focused and under 500 words. Use markdown for structure.`,

  synthesizer: `## Your Mission
You are generating a task specification from codebase context and user answers. Output well-structured markdown with ## headings.`
}

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
// Main Prompt Builder
// ---------------------------------------------------------------------------

export function buildAgentPrompt(input: BuildPromptInput): string {
  const { agentType, taskContent, branch, playgroundEnabled, messages, codebaseContext } = input

  // Start with universal preamble
  let prompt = UNIVERSAL_PREAMBLE

  // Add role-specific instructions
  prompt += '\n\n' + ROLE_INSTRUCTIONS[agentType]

  // Add conditional operational appendices
  if (branch) {
    prompt += buildBranchAppendix(branch)
  }

  if (playgroundEnabled) {
    prompt += PLAYGROUND_INSTRUCTIONS
  }

  // Add task content based on agent type
  if (agentType === 'copilot' && messages) {
    // For copilot, build chat-style prompt with message history
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
