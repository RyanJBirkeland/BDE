/**
 * prompt-assistant.ts — Assistant and adhoc agent prompt builders.
 *
 * Both agents share the same skeleton — only the personality and a small
 * response-format hint differ. The shared steps live in `buildInteractivePrompt`;
 * the public builders inject the per-type details.
 */

import { assistantPersonality } from '../agent-system/personality/assistant-personality'
import { adhocPersonality } from '../agent-system/personality/adhoc-personality'
import type { AgentPersonality } from '../agent-system/personality/types'
import { selectUserMemory } from '../agent-system/memory'
import { selectSkills } from '../agent-system/skills'
import {
  CODING_AGENT_PREAMBLE,
  PLANNER_TOOLS_INSTRUCTIONS,
  PLAYGROUND_INSTRUCTIONS,
  buildPersonalitySection,
  buildUpstreamContextSection,
  buildBranchAppendix,
  truncateSpec,
  escapeXmlContent,
  buildCrossRepoContractSection
} from './prompt-sections'
import { PROMPT_TRUNCATION } from './prompt-constants'
import type { BuildPromptInput } from '../../shared/types'

const ASSISTANT_RESPONSE_FORMAT =
  '\n\n## Response Format\n\nAnswer the direct question first. Show code or examples second. Explain trade-offs only if relevant. Keep explanations under 200 words unless the user asks for depth.'

export function buildAssistantPrompt(input: BuildPromptInput): string {
  return buildInteractivePrompt(input, assistantPersonality, ASSISTANT_RESPONSE_FORMAT)
}

export function buildAdhocPrompt(input: BuildPromptInput): string {
  return buildInteractivePrompt(input, adhocPersonality, '')
}

function buildInteractivePrompt(
  input: BuildPromptInput,
  personality: AgentPersonality,
  responseFormat: string
): string {
  const { taskContent, branch, playgroundEnabled, upstreamContext, crossRepoContract } = input

  let prompt = CODING_AGENT_PREAMBLE
  prompt += buildPersonalitySection(personality)
  if (responseFormat) prompt += responseFormat
  prompt += renderUserKnowledgeSection(taskContent)
  prompt += renderSkillsSection(taskContent)
  if (branch) prompt += buildBranchAppendix(branch)
  prompt += PLANNER_TOOLS_INSTRUCTIONS
  if (playgroundEnabled ?? true) prompt += PLAYGROUND_INSTRUCTIONS
  prompt += renderTaskSection(taskContent)
  prompt += buildCrossRepoContractSection(crossRepoContract)
  prompt += buildUpstreamContextSection(upstreamContext)

  return prompt
}

function renderUserKnowledgeSection(taskContent: string | undefined): string {
  const memory = taskContent
    ? selectUserMemory(taskContent)
    : { content: '', totalBytes: 0, fileCount: 0 }
  if (memory.fileCount === 0) return ''
  return '\n\n## User Knowledge\n' + memory.content
}

function renderSkillsSection(taskContent: string | undefined): string {
  const skills = selectSkills(taskContent ?? '')
  if (!skills.trim()) return ''
  return '\n\n## Available Skills\n' + skills
}

function renderTaskSection(taskContent: string | undefined): string {
  if (!taskContent) return ''
  return (
    '\n\n## Task\n\n<user_task>\n' +
    escapeXmlContent(truncateSpec(taskContent, PROMPT_TRUNCATION.ASSISTANT_TASK_CHARS)) +
    '\n</user_task>'
  )
}
