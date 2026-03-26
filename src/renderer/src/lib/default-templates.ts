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
        default: 'Entire repo',
      },
      {
        id: 'focus',
        label: 'What should I prioritize?',
        type: 'multi-choice',
        choices: ['Dead code', 'Naming & readability', 'SOLID violations', 'Magic numbers', 'All of the above'],
        default: 'All of the above',
      },
      {
        id: 'action',
        label: 'Should I auto-fix issues or just report them?',
        type: 'choice',
        choices: ['Report only', 'Auto-fix safe changes', 'Auto-fix everything'],
        default: 'Auto-fix safe changes',
      },
    ],
    promptTemplate:
      'Perform a comprehensive clean code audit on {{scope}} of this repository.\n\n' +
      'Focus on: {{focus}}.\n\n' +
      'Action mode: {{action}}.\n\n' +
      'For auto-fix: apply changes where the fix is clearly correct. For changes that require judgment ' +
      'or could alter behavior, report them with file path and line number but do not modify.\n\n' +
      'Use the project\'s existing conventions in CLAUDE.md. Run `npm test` after changes to verify nothing breaks. ' +
      'Commit fixes in logical groups with descriptive messages.',
    builtIn: true,
    order: 0,
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
        label: 'Describe the bug — what\'s happening vs what should happen?',
        type: 'text',
        required: true,
      },
      {
        id: 'repro',
        label: 'How can the bug be reproduced?',
        type: 'text',
        required: false,
      },
      {
        id: 'area',
        label: 'Where do you suspect the issue is?',
        type: 'text',
        required: false,
      },
    ],
    promptTemplate:
      'Fix the following bug:\n\n' +
      '**Problem:** {{description}}\n\n' +
      '{{repro}}\n\n' +
      '{{area}}\n\n' +
      'Investigate the root cause, implement a fix, add a regression test, and verify existing tests still pass. ' +
      'Commit with a descriptive message explaining what was broken and why.',
    builtIn: true,
    order: 1,
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
        required: true,
      },
      {
        id: 'files',
        label: 'Any specific files or areas to modify?',
        type: 'text',
        required: false,
      },
      {
        id: 'tests',
        label: 'What testing approach should I use?',
        type: 'choice',
        choices: ['TDD — write tests first', 'Tests after implementation', 'No tests needed'],
        default: 'TDD — write tests first',
      },
    ],
    promptTemplate:
      'Implement the following feature:\n\n' +
      '**Feature:** {{feature}}\n\n' +
      '{{files}}\n\n' +
      'Testing approach: {{tests}}.\n\n' +
      'Follow the existing code patterns and conventions in CLAUDE.md. Keep the implementation focused — ' +
      'build only what was requested, no extras. Commit in logical increments.',
    builtIn: true,
    order: 2,
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
        required: true,
      },
      {
        id: 'testType',
        label: 'What type of tests?',
        type: 'choice',
        choices: ['Unit tests', 'Integration tests', 'Both unit and integration'],
        default: 'Unit tests',
      },
      {
        id: 'goal',
        label: 'Any specific coverage goal or scenarios to cover?',
        type: 'text',
        required: false,
      },
    ],
    promptTemplate:
      'Write {{testType}} for: {{target}}\n\n' +
      '{{goal}}\n\n' +
      'Follow the existing test patterns in the codebase (vitest + testing-library for renderer, ' +
      'vitest for main process). Test real behavior, not implementation details. Cover happy path, ' +
      'error cases, and edge cases. Run `npm test` to verify all tests pass.',
    builtIn: true,
    order: 3,
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
        required: true,
      },
      {
        id: 'focus',
        label: 'What should I focus on?',
        type: 'multi-choice',
        choices: ['Correctness', 'Performance', 'Security', 'Code style', 'Test coverage', 'All of the above'],
        default: 'All of the above',
      },
      {
        id: 'strictness',
        label: 'How strict should the review be?',
        type: 'choice',
        choices: ['Lenient — only flag real issues', 'Standard', 'Strict — flag everything'],
        default: 'Standard',
      },
    ],
    promptTemplate:
      'Review the following code: {{target}}\n\n' +
      'Focus areas: {{focus}}\n\n' +
      'Strictness level: {{strictness}}\n\n' +
      'For each issue found, provide: file path, line number, severity (critical/warning/suggestion), ' +
      'and a clear explanation of the problem and recommended fix. Group findings by file.',
    builtIn: true,
    order: 4,
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
        required: true,
      },
      {
        id: 'type',
        label: 'What kind of refactoring?',
        type: 'choice',
        choices: ['Extract/split — break up large file', 'Rename/reorganize', 'Simplify complex logic', 'Remove duplication', 'Other'],
        default: 'Simplify complex logic',
      },
      {
        id: 'constraints',
        label: 'Any constraints or things to preserve?',
        type: 'text',
        required: false,
      },
    ],
    promptTemplate:
      'Refactor the following code: {{target}}\n\n' +
      'Refactoring type: {{type}}\n\n' +
      '{{constraints}}\n\n' +
      'Preserve all existing behavior — this is a refactoring, not a feature change. Run tests after ' +
      'each change to verify nothing breaks. Commit in small, logical increments. Follow existing ' +
      'patterns and conventions in CLAUDE.md.',
    builtIn: true,
    order: 5,
  },
]
