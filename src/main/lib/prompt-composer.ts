/** prompt-composer.ts — Thin dispatcher; routes to agent-type-specific prompt builders. */

import { buildPipelinePrompt } from '../agent-manager/prompt-pipeline'
import { buildAssistantPrompt, buildAdhocPrompt } from '../agent-manager/prompt-assistant'
import { buildCopilotPrompt } from '../agent-manager/prompt-copilot'
import { buildSynthesizerPrompt } from '../agent-manager/prompt-synthesizer'
import { buildReviewerPrompt } from '../agent-manager/prompt-composer-reviewer'
import { createLogger } from '../logger'
import type { AgentType, BuildPromptInput } from '../../shared/types'

export { classifyTask, type TaskClass } from '../agent-manager/prompt-pipeline'
export type { AgentType, BuildPromptInput }

const logger = createLogger('prompt-composer')

type PromptBuilder = (input: BuildPromptInput) => string

/** Registry mapping each agent type to its prompt builder. Add new agent types here. */
const PROMPT_BUILDERS: Record<AgentType, PromptBuilder> = {
  pipeline: buildPipelinePrompt,
  assistant: buildAssistantPrompt,
  adhoc: buildAdhocPrompt,
  copilot: buildCopilotPrompt,
  synthesizer: buildSynthesizerPrompt,
  reviewer: buildReviewerPrompt
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

  logger.info(
    `[prompt-composer] Assembled prompt: ${prompt.length} chars for agent type '${agentType}'`
  )

  return prompt
}
