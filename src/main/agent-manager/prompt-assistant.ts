/**
 * prompt-assistant.ts — Assistant and adhoc agent prompt builder
 */

import { assistantPersonality } from '../agent-system/personality/assistant-personality'
import { adhocPersonality } from '../agent-system/personality/adhoc-personality'
import { getAllMemory, isBdeRepo } from '../agent-system/memory'
import { getUserMemory } from '../agent-system/memory/user-memory'
import { getAllSkills } from '../agent-system/skills'
import {
  CODING_AGENT_PREAMBLE,
  PLAYGROUND_INSTRUCTIONS,
  buildPersonalitySection,
  buildUpstreamContextSection,
  buildBranchAppendix
} from './prompt-sections'
import type { BuildPromptInput } from './prompt-composer'

export function buildAssistantPrompt(input: BuildPromptInput): string {
  const { taskContent, branch, playgroundEnabled, upstreamContext, crossRepoContract, repoName } =
    input

  let prompt = CODING_AGENT_PREAMBLE

  // Inject personality (assistant or adhoc)
  const personality = input.agentType === 'assistant' ? assistantPersonality : adhocPersonality
  prompt += buildPersonalitySection(personality)

  // Inject memory
  const memoryText = getAllMemory({ repoName: repoName ?? undefined })
  if (memoryText.trim()) {
    prompt += '\n\n## BDE Conventions\n'
    prompt += memoryText
  }

  // Inject user memory (full load for interactive agents)
  const userMem = getUserMemory()
  if (userMem.fileCount > 0) {
    prompt += '\n\n## User Knowledge\n'
    prompt += userMem.content
  }

  // Inject skills (BDE-specific, interactive agents only)
  if (isBdeRepo(repoName)) {
    prompt += '\n\n## Available Skills\n'
    prompt += getAllSkills()

    prompt += '\n\n## Note\n'
    prompt += 'You have BDE-native skills and conventions loaded. '
    prompt += 'Generic third-party plugin guidance may not apply to BDE workflows.'
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
    prompt += '\n\n## Task\n\n<user_task>\n' + taskContent + '\n</user_task>'
  }

  // Cross-repo contract
  if (crossRepoContract && crossRepoContract.trim()) {
    prompt += '\n\n## Cross-Repo Contract\n\n'
    prompt += 'This task involves API contracts with other repositories. '
    prompt += 'Follow these contract specifications exactly:\n\n'
    prompt += `<cross_repo_contract>\n${crossRepoContract}\n</cross_repo_contract>`
  }

  // Upstream task context
  prompt += buildUpstreamContextSection(upstreamContext)

  return prompt
}
