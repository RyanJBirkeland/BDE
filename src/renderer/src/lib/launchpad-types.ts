// src/renderer/src/lib/launchpad-types.ts
//
// Shared type definitions for the Agent Launchpad feature.
// Used by: default-templates.ts, prompt-assembly.ts, promptTemplates store,
// and all launchpad UI components.

import type { NeonAccent } from '../components/neon/types'
import type { ClaudeModelId } from '../../../shared/models'

/** A single question in a prompt template's configuration flow */
export interface TemplateQuestion {
  /** Variable name used in promptTemplate interpolation, e.g. "scope" */
  id: string
  /** Display label shown to the user, e.g. "Which area should I focus on?" */
  label: string
  /** Input type: single choice, free text, or multi-select */
  type: 'choice' | 'text' | 'multi-choice'
  /** Available options for choice/multi-choice types */
  choices?: string[] | undefined
  /** Pre-selected default answer */
  default?: string | undefined
  /** Whether an answer is required before advancing. Defaults to true. */
  required?: boolean | undefined
}

/** A reusable prompt template that powers a quick-action tile */
export interface PromptTemplate {
  /** Unique identifier — crypto.randomUUID() for user-created, prefixed 'builtin-' for defaults */
  id: string
  /** Display name shown on tile, e.g. "Clean Code Audit" */
  name: string
  /** Emoji icon for the tile */
  icon: string
  /** Neon accent color for tile styling */
  accent: NeonAccent
  /** Short description below the tile name */
  description: string
  /** Ordered list of questions asked during the configure phase */
  questions: TemplateQuestion[]
  /**
   * Prompt template string with {{variableId}} placeholders.
   * Each variableId corresponds to a question.id in the questions array.
   * Example: "Perform a {{action}} on {{scope}} focusing on {{focus}}"
   */
  promptTemplate: string
  /** Optional default overrides for model and repo */
  defaults?: {
    model?: ClaudeModelId | undefined
    repo?: string | undefined
  }
  /** true = shipped with the app, cannot be deleted (only hidden) */
  builtIn?: boolean | undefined
  /** User has hidden this template from the grid */
  hidden?: boolean | undefined
  /** Display sort position (lower = first) */
  order: number
}
