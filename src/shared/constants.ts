/**
 * Centralized status constants — single source of truth.
 * Use these instead of raw string literals to prevent typos and enable refactoring.
 */

// Task status constants — re-exported from the canonical source so all
// consumers have a stable import path without duplicating the string values.
export { TASK_STATUS } from './task-statuses'
export type { TaskStatus as TaskStatusValue } from './task-state-machine'

export const PR_STATUS = {
  OPEN: 'open',
  MERGED: 'merged',
  CLOSED: 'closed',
  DRAFT: 'draft',
  BRANCH_ONLY: 'branch_only'
} as const

export type PrStatusValue = (typeof PR_STATUS)[keyof typeof PR_STATUS]

export const AGENT_STATUS = {
  RUNNING: 'running',
  DONE: 'done',
  ERROR: 'error',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  UNKNOWN: 'unknown'
} as const

export type AgentStatusValue = (typeof AGENT_STATUS)[keyof typeof AGENT_STATUS]

/** Default task templates seeded on first access. */
export const DEFAULT_TASK_TEMPLATES = [
  {
    name: 'Bug Fix',
    promptPrefix:
      '## Bug Description\n\nWhat is the symptom? Include:\n- Exact reproduction steps\n- Expected vs actual behavior\n- Error messages (if any)\n\n## Root Cause\n\nWhat code is causing it?\n- File: `src/.../file.ts`\n- Function: `functionName()`\n- Description of the bug\n\n## Fix\n\nExact change to make (include before/after code if possible)\n\n## Files to Change\n\n- `src/.../file.ts` — describe the change\n- `src/.../file.test.ts` — add regression test\n\n## How to Test\n\n1. Run `npm test` — all tests pass\n2. Run `npm run typecheck` — no errors\n3. Regression test description\n\n## Out of Scope\n\n- (list items NOT to change)\n'
  },
  {
    name: 'Feature',
    promptPrefix:
      '## Problem\n\nWhat user-facing problem does this solve?\n\n## Solution\n\nDescribe the feature:\n- What the user sees or can do\n- How it works at a high level\n- Key components or modules involved\n\n## Files to Change\n\n- `path/to/file.ts` — describe the change\n- `path/to/file.test.ts` — describe the tests\n\n## How to Test\n\n1. Run the test suite — all tests pass\n2. Run the type checker — zero errors\n3. Manual verification steps\n\n## Out of Scope\n\n- (list items NOT to change)\n'
  },
  {
    name: 'Refactor',
    promptPrefix:
      '## What is Being Refactored\n\nCurrent state — describe the problem (duplication, complexity, wrong abstraction)\n- File(s): `src/.../current.ts`\n- Function(s): `currentFunc()`\n\n## Target State\n\nAfter refactoring:\n- Extracted to: `src/.../extracted.ts`\n- Interface: describe the new API surface\n- Migration: how existing callers switch\n\n## Files to Change\n\n- `src/.../extracted.ts` — create with extracted logic\n- `src/.../original.ts` — replace inline code with import\n- Update all callers and their tests\n\n## Behavioral Invariants\n\nThese behaviors MUST NOT change:\n- (list observable behaviors to preserve)\n\n## How to Test\n\n1. `npm run typecheck` — zero errors\n2. `npm test` — all existing tests still pass\n3. `npm run lint`\n\n## Out of Scope\n\n- Behavioral changes (this is a pure refactor)\n'
  },
  {
    name: 'Test Coverage',
    promptPrefix:
      '## What to Test\n\nComponent/module: `src/.../target.ts`\nCurrent coverage: ~N%\nTarget coverage: >= M%\n\n## Test Strategy\n\n- Unit tests for: (list functions/branches)\n- Edge cases: (empty arrays, null inputs, error states)\n- Branch coverage targets: (specific if/else and ternary branches)\n\n## Files to Create/Modify\n\n- `src/.../__tests__/target.test.ts` — add tests\n\n## Specific Branches to Cover\n\n1. `functionName()` line N: when condition is true vs false\n2. Error handling: when `apiCall()` throws\n\n## Coverage Thresholds\n\nCI thresholds: 72% stmts, 66% branches, 70% functions, 74% lines\nThis task should NOT lower any threshold.\n\n## How to Verify\n\n1. `npm run test:coverage` — thresholds pass\n2. Check coverage report for the specific file\n'
  }
] as const
