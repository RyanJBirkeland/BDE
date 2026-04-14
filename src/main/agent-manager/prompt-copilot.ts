/**
 * prompt-copilot.ts — Copilot agent prompt builder
 */

import { copilotPersonality } from '../agent-system/personality/copilot-personality'
import { getUserMemory } from '../agent-system/memory/user-memory'
import {
  SPEC_DRAFTING_PREAMBLE,
  PLAYGROUND_INSTRUCTIONS,
  buildPersonalitySection,
  buildUpstreamContextSection
} from './prompt-sections'
import type { BuildPromptInput } from './prompt-composer'

export function buildCopilotPrompt(input: BuildPromptInput): string {
  const { messages, playgroundEnabled, upstreamContext } = input

  let prompt = SPEC_DRAFTING_PREAMBLE

  // Inject personality
  prompt += buildPersonalitySection(copilotPersonality)

  // Inject user memory
  const userMem = getUserMemory()
  if (userMem.fileCount > 0) {
    prompt += '\n\n## User Knowledge\n'
    prompt += userMem.content
  }

  // Playground (default off for copilot)
  if (playgroundEnabled) {
    prompt += PLAYGROUND_INSTRUCTIONS
  }

  // Spec-drafting mode framing
  prompt += '\n\n## Mode: Spec Drafting\n\n'
  prompt +=
    'You are helping the user draft a task SPEC, not execute the task. ' +
    'Your goal is to help them write a clear, complete spec that a pipeline ' +
    'agent can later execute. Use your read-only Read, Grep, and Glob tools ' +
    'to explore the target repo whenever you need ground-truth answers about ' +
    'files, APIs, or existing patterns.'

  // Target repository pinning
  if (input.repoPath) {
    prompt += '\n\n## Target Repository\n\n'
    prompt += `All your tool calls operate inside this repository:\n\n\`${input.repoPath}\`\n\n`
    prompt +=
      'When using Grep or Glob, scope searches to this path. ' +
      'When using Read, prefer paths relative to this root.'
  }

  // Form context
  if (input.formContext) {
    const { title, repo, spec } = input.formContext
    prompt += '\n\n## Task Context\n\n'
    prompt += `Title:\n<task_title>\n${title}\n</task_title>\nRepo: ${repo}\n`
    if (spec) {
      prompt += `\nSpec draft:\n<spec_draft>\n${spec}\n</spec_draft>\n`
    } else {
      prompt += '\n(no spec yet)\n'
    }
  }

  // Conversation history
  if (messages) {
    const MAX_HISTORY_TURNS = 10
    const cappedConversationHistory =
      messages.length > MAX_HISTORY_TURNS
        ? messages.slice(messages.length - MAX_HISTORY_TURNS)
        : messages
    if (messages.length > MAX_HISTORY_TURNS) {
      prompt += `\n\n## Conversation (last ${MAX_HISTORY_TURNS} of ${messages.length} turns)\n\n`
    } else {
      prompt += '\n\n## Conversation\n\n'
    }
    for (const msg of cappedConversationHistory) {
      prompt += `**${msg.role}**: <chat_message>${msg.content}</chat_message>\n\n`
    }
  }

  // Upstream task context
  prompt += buildUpstreamContextSection(upstreamContext)

  return prompt
}
