/**
 * prompt-assistant.ts — Assistant and adhoc agent prompt builder
 */

import { assistantPersonality } from '../agent-system/personality/assistant-personality'
import { adhocPersonality } from '../agent-system/personality/adhoc-personality'
import { selectUserMemory } from '../agent-system/memory'
import { selectSkills } from '../agent-system/skills'
import {
  CODING_AGENT_PREAMBLE,
  PLAYGROUND_INSTRUCTIONS,
  buildPersonalitySection,
  buildUpstreamContextSection,
  buildBranchAppendix,
  truncateSpec,
  buildCrossRepoContractSection
} from './prompt-sections'
import { PROMPT_TRUNCATION } from './prompt-constants'
import type { BuildPromptInput } from '../lib/prompt-composer'

export function buildAssistantPrompt(input: BuildPromptInput): string {
  const { taskContent, branch, playgroundEnabled, upstreamContext, crossRepoContract } = input

  let prompt = CODING_AGENT_PREAMBLE

  // Inject personality (assistant or adhoc)
  const personality = input.agentType === 'assistant' ? assistantPersonality : adhocPersonality
  prompt += buildPersonalitySection(personality)

  // Response format guidance (assistant only)
  if (input.agentType === 'assistant') {
    prompt +=
      '\n\n## Response Format\n\nAnswer the direct question first. Show code or examples second. Explain trade-offs only if relevant. Keep explanations under 200 words unless the user asks for depth.'
  }

  // Inject user memory filtered to task context (empty when no task provided)
  const userMem = taskContent
    ? selectUserMemory(taskContent)
    : { content: '', totalBytes: 0, fileCount: 0 }
  if (userMem.fileCount > 0) {
    prompt += '\n\n## User Knowledge\n'
    prompt += userMem.content
  }

  // Inject skills (interactive agents only)
  const skills = selectSkills(taskContent ?? '')
  if (skills.trim()) {
    prompt += '\n\n## Available Skills\n'
    prompt += skills
  }

  // Add branch appendix if provided
  if (branch) {
    prompt += buildBranchAppendix(branch)
  }

  // Playground (default on for assistant/adhoc)
  const effectivePlayground = playgroundEnabled ?? true
  if (effectivePlayground) {
    prompt += PLAYGROUND_INSTRUCTIONS
  }

  // Task content
  if (taskContent) {
    prompt +=
      '\n\n## Task\n\n<user_task>\n' +
      truncateSpec(taskContent, PROMPT_TRUNCATION.ASSISTANT_TASK_CHARS) +
      '\n</user_task>'
  }

  // Cross-repo contract
  prompt += buildCrossRepoContractSection(crossRepoContract)

  // Upstream task context
  prompt += buildUpstreamContextSection(upstreamContext)

  return prompt
}
