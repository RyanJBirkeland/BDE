// src/renderer/src/lib/prompt-assembly.ts
//
// Pure utility functions for the Agent Launchpad feature.
// No React, no stores, no side effects — just data transformation.

import type { PromptTemplate, RecentTask } from './launchpad-types'

/**
 * Interpolates a PromptTemplate's promptTemplate string with user answers.
 *
 * - Replaces every `{{variableId}}` with the corresponding answer value.
 * - Unanswered variables become empty string (for optional questions).
 * - Collapses triple+ newlines (left by empty optionals) into double newlines.
 * - Trims leading/trailing whitespace.
 */
export function assemblePrompt(
  template: PromptTemplate,
  answers: Record<string, string>,
): string {
  let prompt = template.promptTemplate

  // Replace all {{variable}} placeholders
  for (const question of template.questions) {
    const value = answers[question.id] ?? ''
    prompt = prompt.replaceAll(`{{${question.id}}}`, value)
  }

  // Also replace any {{key}} not in questions (in case answers has extra keys)
  for (const [key, value] of Object.entries(answers)) {
    prompt = prompt.replaceAll(`{{${key}}}`, value)
  }

  // Collapse triple+ newlines into double (cleans up empty optional fields)
  prompt = prompt.replace(/\n{3,}/g, '\n\n')

  return prompt.trim()
}

/**
 * Migrates spawn history from old format (string[]) to new format (RecentTask[]).
 *
 * Old format (SpawnModal): `["Fix the bug", "Add feature"]`
 * New format (Launchpad):  `[{ prompt, repo, model, timestamp }]`
 *
 * If data is already in new format, returns it as-is.
 * Returns empty array for null, undefined, or invalid data.
 */
export function migrateHistory(data: unknown): RecentTask[] {
  if (!Array.isArray(data)) return []
  if (data.length === 0) return []

  // Check if already migrated: first element has 'prompt' property (object, not string)
  if (typeof data[0] === 'object' && data[0] !== null && 'prompt' in data[0]) {
    return data as RecentTask[]
  }

  // Legacy format: string[]
  return data
    .filter((item): item is string => typeof item === 'string')
    .map((prompt) => ({
      prompt,
      repo: '',
      model: '',
      timestamp: 0,
    }))
}
