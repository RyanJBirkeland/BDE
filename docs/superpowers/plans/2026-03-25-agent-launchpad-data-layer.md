# Agent Launchpad — Data Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the data layer (types, default templates, prompt assembly, Zustand store) for the Agent Launchpad feature, fully tested and ready for UI components to consume.

**Architecture:** Shared types define the PromptTemplate and RecentTask interfaces. A pure utility module handles prompt template interpolation and history migration. A Zustand store provides CRUD for templates (backed by SQLite settings table via IPC). Six built-in templates ship as code constants. All modules are independently testable with no UI dependencies.

**Tech Stack:** TypeScript, Zustand, Vitest, `window.api.settings.getJson` / `setJson` IPC

**Spec:** `docs/superpowers/specs/2026-03-25-agent-launchpad-design.md`

---

## File Map

| File                                                        | Action | Responsibility                                                       |
| ----------------------------------------------------------- | ------ | -------------------------------------------------------------------- |
| `src/renderer/src/lib/launchpad-types.ts`                   | Create | PromptTemplate, TemplateQuestion, RecentTask interfaces + constants  |
| `src/renderer/src/lib/default-templates.ts`                 | Create | 6 built-in PromptTemplate definitions with full question schemas     |
| `src/renderer/src/lib/prompt-assembly.ts`                   | Create | `assemblePrompt()` interpolation + `migrateHistory()` old→new format |
| `src/renderer/src/lib/__tests__/prompt-assembly.test.ts`    | Create | Tests for assemblePrompt and migrateHistory                          |
| `src/renderer/src/stores/promptTemplates.ts`                | Create | Zustand store: load, save, delete, reorder, hide templates           |
| `src/renderer/src/stores/__tests__/promptTemplates.test.ts` | Create | Store tests with mocked window.api                                   |

---

### Task 1: Create Launchpad Type Definitions

**Files:**

- Create: `src/renderer/src/lib/launchpad-types.ts`

- [ ] **Step 1: Create the type definitions file**

Create the file `src/renderer/src/lib/launchpad-types.ts` with this exact content:

```ts
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
```

- [ ] **Step 2: Verify the file compiles**

Run: `cd ~/worktrees/bde/feat/agent-launchpad && npx tsc --noEmit 2>&1 | head -20`

Expected: No errors. The file only imports types so there are no runtime dependencies to resolve.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/lib/launchpad-types.ts
git commit -m "feat(launchpad): add PromptTemplate, TemplateQuestion, RecentTask type definitions"
```

---

### Task 2: Create Default Built-In Templates

**Files:**

- Create: `src/renderer/src/lib/default-templates.ts`

- [ ] **Step 1: Create the default templates file**

Create the file `src/renderer/src/lib/default-templates.ts` with this exact content:

```ts
// src/renderer/src/lib/default-templates.ts
//
// Built-in prompt templates that ship with BDE.
// These are merged with user-created templates on load.
// Users can hide but not delete built-in templates.

import type { PromptTemplate } from './launchpad-types'

export const DEFAULT_TEMPLATES: PromptTemplate[] = [
  {
    id: 'builtin-clean-code',
    name: 'Clean Code',
    icon: '\u{1F9F9}',
    accent: 'cyan',
    description: 'Audit & remediate',
    questions: [
      {
        id: 'scope',
        label: 'Which area of the codebase should I focus on?',
        type: 'choice',
        choices: ['Entire repo', 'Specific directory', 'Changed files only'],
        default: 'Entire repo'
      },
      {
        id: 'focus',
        label: 'What should I prioritize?',
        type: 'multi-choice',
        choices: [
          'Dead code',
          'Naming & readability',
          'SOLID violations',
          'Magic numbers',
          'All of the above'
        ],
        default: 'All of the above'
      },
      {
        id: 'action',
        label: 'Should I auto-fix issues or just report them?',
        type: 'choice',
        choices: ['Report only', 'Auto-fix safe changes', 'Auto-fix everything'],
        default: 'Auto-fix safe changes'
      }
    ],
    promptTemplate:
      'Perform a comprehensive clean code audit on {{scope}} of this repository.\n\n' +
      'Focus on: {{focus}}.\n\n' +
      'Action mode: {{action}}.\n\n' +
      'For auto-fix: apply changes where the fix is clearly correct. For changes that require judgment ' +
      'or could alter behavior, report them with file path and line number but do not modify.\n\n' +
      "Use the project's existing conventions in CLAUDE.md. Run `npm test` after changes to verify nothing breaks. " +
      'Commit fixes in logical groups with descriptive messages.',
    builtIn: true,
    order: 0
  },
  {
    id: 'builtin-fix-bug',
    name: 'Fix Bug',
    icon: '\u{1F41B}',
    accent: 'pink',
    description: 'Debug & repair',
    questions: [
      {
        id: 'description',
        label: "Describe the bug — what's happening vs what should happen?",
        type: 'text',
        required: true
      },
      {
        id: 'repro',
        label: 'How can the bug be reproduced?',
        type: 'text',
        required: false
      },
      {
        id: 'area',
        label: 'Where do you suspect the issue is?',
        type: 'text',
        required: false
      }
    ],
    promptTemplate:
      'Fix the following bug:\n\n' +
      '**Problem:** {{description}}\n\n' +
      '{{repro}}\n\n' +
      '{{area}}\n\n' +
      'Investigate the root cause, implement a fix, add a regression test, and verify existing tests still pass. ' +
      'Commit with a descriptive message explaining what was broken and why.',
    builtIn: true,
    order: 1
  },
  {
    id: 'builtin-new-feature',
    name: 'New Feature',
    icon: '\u{2728}',
    accent: 'blue',
    description: 'Build from spec',
    questions: [
      {
        id: 'feature',
        label: 'Describe the feature you want built.',
        type: 'text',
        required: true
      },
      {
        id: 'files',
        label: 'Any specific files or areas to modify?',
        type: 'text',
        required: false
      },
      {
        id: 'tests',
        label: 'What testing approach should I use?',
        type: 'choice',
        choices: ['TDD — write tests first', 'Tests after implementation', 'No tests needed'],
        default: 'TDD — write tests first'
      }
    ],
    promptTemplate:
      'Implement the following feature:\n\n' +
      '**Feature:** {{feature}}\n\n' +
      '{{files}}\n\n' +
      'Testing approach: {{tests}}.\n\n' +
      'Follow the existing code patterns and conventions in CLAUDE.md. Keep the implementation focused — ' +
      'build only what was requested, no extras. Commit in logical increments.',
    builtIn: true,
    order: 2
  },
  {
    id: 'builtin-write-tests',
    name: 'Write Tests',
    icon: '\u{1F9EA}',
    accent: 'orange',
    description: 'Coverage boost',
    questions: [
      {
        id: 'target',
        label: 'Which files or components should I write tests for?',
        type: 'text',
        required: true
      },
      {
        id: 'testType',
        label: 'What type of tests?',
        type: 'choice',
        choices: ['Unit tests', 'Integration tests', 'Both unit and integration'],
        default: 'Unit tests'
      },
      {
        id: 'goal',
        label: 'Any specific coverage goal or scenarios to cover?',
        type: 'text',
        required: false
      }
    ],
    promptTemplate:
      'Write {{testType}} for: {{target}}\n\n' +
      '{{goal}}\n\n' +
      'Follow the existing test patterns in the codebase (vitest + testing-library for renderer, ' +
      'vitest for main process). Test real behavior, not implementation details. Cover happy path, ' +
      'error cases, and edge cases. Run `npm test` to verify all tests pass.',
    builtIn: true,
    order: 3
  },
  {
    id: 'builtin-code-review',
    name: 'Code Review',
    icon: '\u{1F50D}',
    accent: 'cyan',
    description: 'PR feedback',
    questions: [
      {
        id: 'target',
        label: 'What should I review? (PR number, branch name, or file paths)',
        type: 'text',
        required: true
      },
      {
        id: 'focus',
        label: 'What should I focus on?',
        type: 'multi-choice',
        choices: [
          'Correctness',
          'Performance',
          'Security',
          'Code style',
          'Test coverage',
          'All of the above'
        ],
        default: 'All of the above'
      },
      {
        id: 'strictness',
        label: 'How strict should the review be?',
        type: 'choice',
        choices: ['Lenient — only flag real issues', 'Standard', 'Strict — flag everything'],
        default: 'Standard'
      }
    ],
    promptTemplate:
      'Review the following code: {{target}}\n\n' +
      'Focus areas: {{focus}}\n\n' +
      'Strictness level: {{strictness}}\n\n' +
      'For each issue found, provide: file path, line number, severity (critical/warning/suggestion), ' +
      'and a clear explanation of the problem and recommended fix. Group findings by file.',
    builtIn: true,
    order: 4
  },
  {
    id: 'builtin-refactor',
    name: 'Refactor',
    icon: '\u{1F4E6}',
    accent: 'red',
    description: 'Restructure code',
    questions: [
      {
        id: 'target',
        label: 'What code needs to be refactored?',
        type: 'text',
        required: true
      },
      {
        id: 'type',
        label: 'What kind of refactoring?',
        type: 'choice',
        choices: [
          'Extract/split — break up large file',
          'Rename/reorganize',
          'Simplify complex logic',
          'Remove duplication',
          'Other'
        ],
        default: 'Simplify complex logic'
      },
      {
        id: 'constraints',
        label: 'Any constraints or things to preserve?',
        type: 'text',
        required: false
      }
    ],
    promptTemplate:
      'Refactor the following code: {{target}}\n\n' +
      'Refactoring type: {{type}}\n\n' +
      '{{constraints}}\n\n' +
      'Preserve all existing behavior — this is a refactoring, not a feature change. Run tests after ' +
      'each change to verify nothing breaks. Commit in small, logical increments. Follow existing ' +
      'patterns and conventions in CLAUDE.md.',
    builtIn: true,
    order: 5
  }
]
```

- [ ] **Step 2: Verify the file compiles**

Run: `cd ~/worktrees/bde/feat/agent-launchpad && npx tsc --noEmit 2>&1 | head -20`

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/lib/default-templates.ts
git commit -m "feat(launchpad): add 6 built-in prompt templates with question schemas"
```

---

### Task 3: Create Prompt Assembly Utilities

**Files:**

- Create: `src/renderer/src/lib/prompt-assembly.ts`
- Create: `src/renderer/src/lib/__tests__/prompt-assembly.test.ts`

- [ ] **Step 1: Write the tests first**

Create the file `src/renderer/src/lib/__tests__/prompt-assembly.test.ts` with this exact content:

```ts
import { describe, it, expect } from 'vitest'
import { assemblePrompt, migrateHistory } from '../prompt-assembly'
import type { PromptTemplate, RecentTask } from '../launchpad-types'

const mockTemplate: PromptTemplate = {
  id: 'test-1',
  name: 'Test',
  icon: '🧪',
  accent: 'cyan',
  description: 'Test template',
  questions: [
    { id: 'scope', label: 'Scope?', type: 'choice', choices: ['All', 'Some'] },
    { id: 'focus', label: 'Focus?', type: 'text' }
  ],
  promptTemplate: 'Audit {{scope}} focusing on {{focus}}.',
  order: 0
}

describe('assemblePrompt', () => {
  it('replaces all {{variable}} placeholders with answers', () => {
    const result = assemblePrompt(mockTemplate, { scope: 'Entire repo', focus: 'naming' })
    expect(result).toBe('Audit Entire repo focusing on naming.')
  })

  it('replaces multiple occurrences of the same variable', () => {
    const template: PromptTemplate = {
      ...mockTemplate,
      promptTemplate: '{{scope}} first, then {{scope}} again.'
    }
    const result = assemblePrompt(template, { scope: 'All' })
    expect(result).toBe('All first, then All again.')
  })

  it('leaves unanswered optional placeholders as empty string', () => {
    const result = assemblePrompt(mockTemplate, { scope: 'All' })
    expect(result).toBe('Audit All focusing on .')
  })

  it('trims leading/trailing whitespace from result', () => {
    const template: PromptTemplate = {
      ...mockTemplate,
      promptTemplate: '  {{scope}}  '
    }
    const result = assemblePrompt(template, { scope: 'All' })
    expect(result).toBe('All')
  })

  it('collapses triple+ newlines left by empty optional fields', () => {
    const template: PromptTemplate = {
      ...mockTemplate,
      promptTemplate: 'Line one.\n\n{{focus}}\n\nLine three.'
    }
    const result = assemblePrompt(template, { focus: '' })
    expect(result).toBe('Line one.\n\nLine three.')
  })

  it('handles empty answers object', () => {
    const result = assemblePrompt(mockTemplate, {})
    expect(result).toBe('Audit  focusing on .')
  })
})

describe('migrateHistory', () => {
  it('converts string[] to RecentTask[]', () => {
    const old = ['Fix the bug', 'Add feature']
    const result = migrateHistory(old)
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({
      prompt: 'Fix the bug',
      repo: '',
      model: '',
      timestamp: 0
    })
    expect(result[1]).toEqual({
      prompt: 'Add feature',
      repo: '',
      model: '',
      timestamp: 0
    })
  })

  it('returns RecentTask[] as-is if already migrated', () => {
    const already: RecentTask[] = [
      { prompt: 'Fix bug', repo: 'BDE', model: 'sonnet', timestamp: 1000 }
    ]
    const result = migrateHistory(already)
    expect(result).toEqual(already)
  })

  it('returns empty array for null/undefined', () => {
    expect(migrateHistory(null)).toEqual([])
    expect(migrateHistory(undefined)).toEqual([])
  })

  it('returns empty array for invalid data', () => {
    expect(migrateHistory('not an array' as unknown)).toEqual([])
    expect(migrateHistory(42 as unknown)).toEqual([])
  })

  it('filters out non-string entries in legacy array', () => {
    const mixed = ['valid', 42, null, 'also valid'] as unknown as string[]
    const result = migrateHistory(mixed)
    expect(result).toHaveLength(2)
    expect(result[0].prompt).toBe('valid')
    expect(result[1].prompt).toBe('also valid')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ~/worktrees/bde/feat/agent-launchpad && npx vitest run src/renderer/src/lib/__tests__/prompt-assembly.test.ts 2>&1 | tail -10`

Expected: FAIL — `Cannot find module '../prompt-assembly'`

- [ ] **Step 3: Create the implementation**

Create the file `src/renderer/src/lib/prompt-assembly.ts` with this exact content:

```ts
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
export function assemblePrompt(template: PromptTemplate, answers: Record<string, string>): string {
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
      timestamp: 0
    }))
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd ~/worktrees/bde/feat/agent-launchpad && npx vitest run src/renderer/src/lib/__tests__/prompt-assembly.test.ts 2>&1 | tail -15`

Expected: All 11 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/lib/prompt-assembly.ts src/renderer/src/lib/__tests__/prompt-assembly.test.ts
git commit -m "feat(launchpad): add assemblePrompt and migrateHistory utilities with tests"
```

---

### Task 4: Create Prompt Templates Zustand Store

**Files:**

- Create: `src/renderer/src/stores/promptTemplates.ts`
- Create: `src/renderer/src/stores/__tests__/promptTemplates.test.ts`

- [ ] **Step 1: Write the tests first**

Create the file `src/renderer/src/stores/__tests__/promptTemplates.test.ts` with this exact content:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PromptTemplate } from '../../lib/launchpad-types'

// Mock window.api.settings before importing store
const mockGetJson = vi.fn()
const mockSetJson = vi.fn()

Object.defineProperty(window, 'api', {
  value: {
    ...(window as unknown as { api: Record<string, unknown> }).api,
    settings: {
      get: vi.fn(),
      set: vi.fn(),
      getJson: mockGetJson,
      setJson: mockSetJson,
      delete: vi.fn()
    }
  },
  writable: true,
  configurable: true
})

// Import AFTER mocks are set up
import { usePromptTemplatesStore } from '../promptTemplates'
import { DEFAULT_TEMPLATES } from '../../lib/default-templates'

describe('promptTemplatesStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset store state
    usePromptTemplatesStore.setState({
      templates: [],
      loading: false
    })
  })

  describe('loadTemplates', () => {
    it('loads defaults when no user templates exist', async () => {
      mockGetJson.mockResolvedValue(null)

      await usePromptTemplatesStore.getState().loadTemplates()

      const { templates, loading } = usePromptTemplatesStore.getState()
      expect(loading).toBe(false)
      expect(templates).toHaveLength(DEFAULT_TEMPLATES.length)
      expect(templates[0].id).toBe('builtin-clean-code')
      expect(mockGetJson).toHaveBeenCalledWith('prompt_templates')
    })

    it('merges user templates with built-ins', async () => {
      const userTemplate: PromptTemplate = {
        id: 'user-1',
        name: 'My Custom',
        icon: '🚀',
        accent: 'purple',
        description: 'Custom task',
        questions: [],
        promptTemplate: 'Do the thing.',
        order: 10
      }
      mockGetJson.mockResolvedValue([userTemplate])

      await usePromptTemplatesStore.getState().loadTemplates()

      const { templates } = usePromptTemplatesStore.getState()
      // Should have all built-ins + the user template
      expect(templates.length).toBe(DEFAULT_TEMPLATES.length + 1)
      expect(templates.find((t) => t.id === 'user-1')).toBeDefined()
    })

    it('preserves user hidden state on built-in templates', async () => {
      const hiddenBuiltIn = { ...DEFAULT_TEMPLATES[0], hidden: true }
      mockGetJson.mockResolvedValue([hiddenBuiltIn])

      await usePromptTemplatesStore.getState().loadTemplates()

      const { templates } = usePromptTemplatesStore.getState()
      const cleanCode = templates.find((t) => t.id === 'builtin-clean-code')
      expect(cleanCode?.hidden).toBe(true)
    })

    it('sorts by order field', async () => {
      const userFirst: PromptTemplate = {
        id: 'user-first',
        name: 'First',
        icon: '1',
        accent: 'cyan',
        description: '',
        questions: [],
        promptTemplate: '',
        order: -1 // before all built-ins
      }
      mockGetJson.mockResolvedValue([userFirst])

      await usePromptTemplatesStore.getState().loadTemplates()

      const { templates } = usePromptTemplatesStore.getState()
      expect(templates[0].id).toBe('user-first')
    })
  })

  describe('saveTemplate', () => {
    it('adds a new template and persists to settings', async () => {
      mockGetJson.mockResolvedValue(null)
      await usePromptTemplatesStore.getState().loadTemplates()

      const newTemplate: PromptTemplate = {
        id: 'user-new',
        name: 'New One',
        icon: '🆕',
        accent: 'orange',
        description: 'Brand new',
        questions: [],
        promptTemplate: 'Do something new.',
        order: 99
      }

      await usePromptTemplatesStore.getState().saveTemplate(newTemplate)

      const { templates } = usePromptTemplatesStore.getState()
      expect(templates.find((t) => t.id === 'user-new')).toBeDefined()
      expect(mockSetJson).toHaveBeenCalledWith(
        'prompt_templates',
        expect.arrayContaining([expect.objectContaining({ id: 'user-new' })])
      )
    })

    it('updates an existing template by id', async () => {
      const existing: PromptTemplate = {
        id: 'user-1',
        name: 'Old Name',
        icon: '🔧',
        accent: 'cyan',
        description: 'Old',
        questions: [],
        promptTemplate: 'Old prompt.',
        order: 10
      }
      mockGetJson.mockResolvedValue([existing])
      await usePromptTemplatesStore.getState().loadTemplates()

      await usePromptTemplatesStore.getState().saveTemplate({
        ...existing,
        name: 'New Name'
      })

      const { templates } = usePromptTemplatesStore.getState()
      const updated = templates.find((t) => t.id === 'user-1')
      expect(updated?.name).toBe('New Name')
    })
  })

  describe('deleteTemplate', () => {
    it('removes a user template', async () => {
      const userTemplate: PromptTemplate = {
        id: 'user-del',
        name: 'Delete Me',
        icon: '🗑️',
        accent: 'red',
        description: '',
        questions: [],
        promptTemplate: '',
        order: 10
      }
      mockGetJson.mockResolvedValue([userTemplate])
      await usePromptTemplatesStore.getState().loadTemplates()

      await usePromptTemplatesStore.getState().deleteTemplate('user-del')

      const { templates } = usePromptTemplatesStore.getState()
      expect(templates.find((t) => t.id === 'user-del')).toBeUndefined()
    })

    it('does not delete built-in templates', async () => {
      mockGetJson.mockResolvedValue(null)
      await usePromptTemplatesStore.getState().loadTemplates()

      await usePromptTemplatesStore.getState().deleteTemplate('builtin-clean-code')

      const { templates } = usePromptTemplatesStore.getState()
      expect(templates.find((t) => t.id === 'builtin-clean-code')).toBeDefined()
    })
  })

  describe('hideBuiltIn', () => {
    it('toggles hidden state on a built-in template', async () => {
      mockGetJson.mockResolvedValue(null)
      await usePromptTemplatesStore.getState().loadTemplates()

      await usePromptTemplatesStore.getState().hideBuiltIn('builtin-clean-code')

      const { templates } = usePromptTemplatesStore.getState()
      expect(templates.find((t) => t.id === 'builtin-clean-code')?.hidden).toBe(true)

      // Toggle back
      await usePromptTemplatesStore.getState().hideBuiltIn('builtin-clean-code')
      const after = usePromptTemplatesStore.getState().templates
      expect(after.find((t) => t.id === 'builtin-clean-code')?.hidden).toBeFalsy()
    })
  })

  describe('reorderTemplates', () => {
    it('reorders templates by id array and persists', async () => {
      mockGetJson.mockResolvedValue(null)
      await usePromptTemplatesStore.getState().loadTemplates()

      const ids = usePromptTemplatesStore
        .getState()
        .templates.map((t) => t.id)
        .reverse()
      await usePromptTemplatesStore.getState().reorderTemplates(ids)

      const { templates } = usePromptTemplatesStore.getState()
      expect(templates.map((t) => t.id)).toEqual(ids)
      expect(templates[0].order).toBe(0)
      expect(templates[1].order).toBe(1)
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ~/worktrees/bde/feat/agent-launchpad && npx vitest run src/renderer/src/stores/__tests__/promptTemplates.test.ts 2>&1 | tail -10`

Expected: FAIL — `Cannot find module '../promptTemplates'`

- [ ] **Step 3: Create the store implementation**

Create the file `src/renderer/src/stores/promptTemplates.ts` with this exact content:

```ts
// src/renderer/src/stores/promptTemplates.ts
//
// Zustand store for prompt template CRUD.
// Templates are persisted to SQLite settings table via IPC.
// Built-in defaults are merged with user templates on load.

import { create } from 'zustand'
import type { PromptTemplate } from '../lib/launchpad-types'
import { DEFAULT_TEMPLATES } from '../lib/default-templates'

const SETTINGS_KEY = 'prompt_templates'

interface PromptTemplatesState {
  templates: PromptTemplate[]
  loading: boolean
  loadTemplates: () => Promise<void>
  saveTemplate: (template: PromptTemplate) => Promise<void>
  deleteTemplate: (id: string) => Promise<void>
  reorderTemplates: (orderedIds: string[]) => Promise<void>
  hideBuiltIn: (id: string) => Promise<void>
}

/**
 * Merges user-saved templates with built-in defaults.
 *
 * - Built-in templates always exist (from DEFAULT_TEMPLATES).
 * - If a user has a saved version of a built-in (same id), user's version wins
 *   (preserves hidden state, order overrides, etc.).
 * - User-created templates (non-builtin ids) are appended.
 * - Result is sorted by `order` field.
 */
function mergeTemplates(userTemplates: PromptTemplate[]): PromptTemplate[] {
  const userMap = new Map(userTemplates.map((t) => [t.id, t]))
  const merged: PromptTemplate[] = []

  // Add all built-ins, applying user overrides if they exist
  for (const builtin of DEFAULT_TEMPLATES) {
    const userVersion = userMap.get(builtin.id)
    if (userVersion) {
      // User has overridden this built-in (e.g., hidden it or reordered)
      merged.push({ ...builtin, ...userVersion, builtIn: true })
      userMap.delete(builtin.id)
    } else {
      merged.push({ ...builtin })
    }
  }

  // Add remaining user-created templates
  for (const userTemplate of userMap.values()) {
    merged.push(userTemplate)
  }

  // Sort by order
  merged.sort((a, b) => a.order - b.order)

  return merged
}

/** Extracts only user-modified data for persistence (not raw built-in defaults). */
function toPersistedTemplates(templates: PromptTemplate[]): PromptTemplate[] {
  return templates.filter((t) => {
    // Always persist user-created templates
    if (!t.builtIn) return true
    // Persist built-ins only if user modified them (hidden, reordered, etc.)
    const defaultVersion = DEFAULT_TEMPLATES.find((d) => d.id === t.id)
    if (!defaultVersion) return true
    return t.hidden || t.order !== defaultVersion.order
  })
}

export const usePromptTemplatesStore = create<PromptTemplatesState>((set, get) => ({
  templates: [],
  loading: false,

  loadTemplates: async () => {
    set({ loading: true })
    try {
      const saved = await window.api.settings.getJson<PromptTemplate[]>(SETTINGS_KEY)
      const merged = mergeTemplates(saved ?? [])
      set({ templates: merged, loading: false })
    } catch {
      // If settings load fails, fall back to defaults
      set({ templates: [...DEFAULT_TEMPLATES], loading: false })
    }
  },

  saveTemplate: async (template) => {
    const { templates } = get()
    const existing = templates.findIndex((t) => t.id === template.id)

    let updated: PromptTemplate[]
    if (existing >= 0) {
      updated = templates.map((t) => (t.id === template.id ? template : t))
    } else {
      updated = [...templates, template]
    }

    set({ templates: updated })
    await window.api.settings.setJson(SETTINGS_KEY, toPersistedTemplates(updated))
  },

  deleteTemplate: async (id) => {
    const { templates } = get()
    const target = templates.find((t) => t.id === id)

    // Cannot delete built-in templates
    if (!target || target.builtIn) return

    const updated = templates.filter((t) => t.id !== id)
    set({ templates: updated })
    await window.api.settings.setJson(SETTINGS_KEY, toPersistedTemplates(updated))
  },

  reorderTemplates: async (orderedIds) => {
    const { templates } = get()
    const idToTemplate = new Map(templates.map((t) => [t.id, t]))
    const reordered = orderedIds
      .map((id, index) => {
        const t = idToTemplate.get(id)
        return t ? { ...t, order: index } : undefined
      })
      .filter((t): t is PromptTemplate => t !== undefined)

    set({ templates: reordered })
    await window.api.settings.setJson(SETTINGS_KEY, toPersistedTemplates(reordered))
  },

  hideBuiltIn: async (id) => {
    const { templates } = get()
    const updated = templates.map((t) =>
      t.id === id && t.builtIn ? { ...t, hidden: !t.hidden } : t
    )
    set({ templates: updated })
    await window.api.settings.setJson(SETTINGS_KEY, toPersistedTemplates(updated))
  }
}))
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd ~/worktrees/bde/feat/agent-launchpad && npx vitest run src/renderer/src/stores/__tests__/promptTemplates.test.ts 2>&1 | tail -15`

Expected: All 10 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/stores/promptTemplates.ts src/renderer/src/stores/__tests__/promptTemplates.test.ts
git commit -m "feat(launchpad): add promptTemplates Zustand store with CRUD and settings persistence"
```

---

### Task 5: Full Data Layer Verification

**Files:** None (verification only)

- [ ] **Step 1: Run all new tests together**

Run: `cd ~/worktrees/bde/feat/agent-launchpad && npx vitest run src/renderer/src/lib/__tests__/prompt-assembly.test.ts src/renderer/src/stores/__tests__/promptTemplates.test.ts 2>&1 | tail -15`

Expected: 2 test files, 21 tests, all PASS.

- [ ] **Step 2: Run typecheck**

Run: `cd ~/worktrees/bde/feat/agent-launchpad && npx tsc --noEmit 2>&1 | head -20`

Expected: No errors.

- [ ] **Step 3: Run full project test suite**

Run: `cd ~/worktrees/bde/feat/agent-launchpad && npm test 2>&1 | tail -10`

Expected: All tests pass. No regressions from the new files (they're additive — no existing files were modified).

- [ ] **Step 4: Verify file structure**

Run: `ls -la src/renderer/src/lib/launchpad-types.ts src/renderer/src/lib/default-templates.ts src/renderer/src/lib/prompt-assembly.ts src/renderer/src/lib/__tests__/prompt-assembly.test.ts src/renderer/src/stores/promptTemplates.ts src/renderer/src/stores/__tests__/promptTemplates.test.ts`

Expected: All 6 files exist.

- [ ] **Step 5: Final commit if any fixes needed**

If any test fixes were needed during verification:

```bash
git add -u
git commit -m "fix(launchpad): fix data layer test assertions"
```
