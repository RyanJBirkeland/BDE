/** prompt-composer.ts — Thin dispatcher; routes to agent-type-specific prompt builders. */

import { buildPipelinePrompt } from '../agent-manager/prompt-pipeline'
import { buildAssistantPrompt } from '../agent-manager/prompt-assistant'
import { buildCopilotPrompt } from '../agent-manager/prompt-copilot'
import { buildSynthesizerPrompt } from '../agent-manager/prompt-synthesizer'
import { buildReviewerPrompt } from '../agent-manager/prompt-composer-reviewer'
import { createLogger } from '../logger'
import type { AgentType } from '../agent-system/personality/types'

export { classifyTask, type TaskClass } from '../agent-manager/prompt-pipeline'
export type { AgentType } from '../agent-system/personality/types'

const logger = createLogger('prompt-composer')

export interface BuildPromptInput {
  agentType: AgentType
  taskContent?: string // spec, prompt, or user message
  branch?: string // git branch for pipeline/adhoc agents
  playgroundEnabled?: boolean // whether to include playground instructions
  messages?: Array<{ role: string; content: string }> // for copilot chat
  formContext?: { title: string; repo: string; spec: string } // for copilot
  repoPath?: string // absolute filesystem path to the target repo (copilot tool grounding)
  codebaseContext?: string // for synthesizer (file tree, relevant files)
  retryCount?: number // 0-based retry count
  previousNotes?: string // failure notes from previous attempt
  maxRuntimeMs?: number | null // max runtime in ms
  upstreamContext?: Array<{ title: string; spec: string; partial_diff?: string }> // completed upstream task specs + diffs
  crossRepoContract?: string | null // cross-repo API contract documentation
  repoName?: string | null // target repo name (used to scope BDE-specific memory injection)
  taskId?: string // pipeline only — used to build scratchpad path
  priorScratchpad?: string // content of progress.md from prior attempt (empty string if none)
  // Reviewer-only fields
  reviewerMode?: 'review' | 'chat'
  diff?: string
  reviewSeed?: import('../../shared/types').ReviewResult
}

type PromptBuilder = (input: BuildPromptInput) => string

/** Registry mapping each agent type to its prompt builder. Add new agent types here. */
const PROMPT_BUILDERS: Record<AgentType, PromptBuilder> = {
  pipeline: buildPipelinePrompt,
  assistant: buildAssistantPrompt,
  adhoc: buildAssistantPrompt,
  copilot: buildCopilotPrompt,
  synthesizer: buildSynthesizerPrompt,
  reviewer: buildReviewerPrompt,
}

const MIN_PROMPT_LENGTH = 200

export function buildAgentPrompt(input: BuildPromptInput): string {
  const { agentType } = input

  const builder = PROMPT_BUILDERS[agentType]
  if (!builder) throw new Error(`[prompt-composer] Unknown agent type: ${agentType}`)

  const prompt = builder(input)

  if (prompt.length < MIN_PROMPT_LENGTH) {
    throw new Error(
      `[prompt-composer] Assembled prompt is too short (${prompt.length} chars) — check agent type '${agentType}' configuration`
    )
  }

  logger.info(`[prompt-composer] Assembled prompt: ${prompt.length} chars for agent type '${agentType}'`)

  return prompt
}
