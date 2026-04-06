/**
 * Sample spec used by the "Create your first task" button on the onboarding
 * DoneStep. Follows the Feature template (see `SPEC_TEMPLATES` in SpecEditor)
 * so readiness checks pass. Target files are clearly marked as placeholders
 * the user should update.
 */
import type { SpecType } from '../../../../../shared/spec-validation'

export const SAMPLE_FIRST_TASK: {
  title: string
  repo: string
  spec: string
  specType: SpecType
} = {
  title: 'Add an entry-point comment to the project',
  repo: 'BDE',
  specType: 'feature',
  spec: `## Problem

New contributors opening this repository don't have an obvious "start here"
pointer — the main entry file lacks a top-of-file comment explaining what the
process does and where execution begins.

## Solution

Add a short, friendly block comment at the top of the project's main entry
file that:

- Names the process ("main process", "renderer", "CLI entry", etc.)
- Describes in 1-2 sentences what it does
- Mentions the first function or block that runs at startup

Keep it under 10 lines. Do not change any runtime behavior.

## Files to Change

- \`REPLACE_WITH_ENTRY_FILE\` — e.g. \`src/main/index.ts\`, \`src/index.ts\`,
  or \`bin/cli.ts\`. Update this path before queuing.

## How to Test

- Run \`npm run typecheck\` — must still pass.
- Run \`npm test\` — no test changes expected.
- Visually confirm the comment appears at the very top of the file.

## Out of Scope

- Refactoring or renaming anything in the file.
- Adding comments to other files.
`
}
