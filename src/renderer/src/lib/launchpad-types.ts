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
  choices?: string[]
  /** Pre-selected default answer */
  default?: string
  /** Whether an answer is required before advancing. Defaults to true. */
  required?: boolean
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
    model?: ClaudeModelId
    repo?: string
  }
  /** true = shipped with the app, cannot be deleted (only hidden) */
  builtIn?: boolean
  /** User has hidden this template from the grid */
  hidden?: boolean
  /** Display sort position (lower = first) */
  order: number
}

/** A recently-spawned task stored in localStorage */
export interface RecentTask {
  /** The full assembled prompt text */
  prompt: string
  /** Which template was used (if any) — matches PromptTemplate.id */
  templateId?: string
  /** Repository name (e.g. "BDE") */
  repo: string
  /** Model id (e.g. "sonnet") */
  model: string
  /** Timestamp in ms (Date.now()) */
  timestamp: number
}

/** localStorage key for recent task history */
export const RECENT_TASKS_KEY = 'bde-spawn-history'

/** Maximum number of recent tasks to store */
export const RECENT_TASKS_LIMIT = 20
