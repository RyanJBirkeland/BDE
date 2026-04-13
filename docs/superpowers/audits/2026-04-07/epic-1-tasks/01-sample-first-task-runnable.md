# Make the onboarding sample task runnable as-shipped

## Problem

The "Create your first task" button on the onboarding DoneStep ships a sample spec whose `## Files to Change` section is the literal placeholder string `REPLACE_WITH_ENTRY_FILE — e.g. src/main/index.ts`. New users hit "Create First Task," queue it, and the pipeline agent thrashes because the file path is unparseable. This is the 30-second demo moment for every new install and it currently fails.

## Solution

Replace the placeholder with a real, working sample task that any pipeline agent can complete unmodified on the BDE repo. The sample is BDE-specific (`repo: 'BDE'`), so we can hardcode `src/main/index.ts` — that file exists and is the documented main process entry point.

Edit `SAMPLE_FIRST_TASK.spec` so:

- `## Files to Change` lists the literal path `src/main/index.ts` (not a placeholder)
- The "Solution" section's "Update this path before queuing" sentence is removed
- The task body still asks for a short top-of-file comment (≤10 lines, no behavior change)
- Do NOT change `title`, `repo`, or `specType`

## Files to Change

- `src/renderer/src/components/onboarding/steps/sample-first-task.ts` — replace the `REPLACE_WITH_ENTRY_FILE` block (lines 35-38) and the "Update this path before queuing" instruction. The rest of the spec stays.

## How to Test

1. `npm run typecheck` — must pass
2. `npm test` — must pass
3. Open `src/renderer/src/components/onboarding/steps/sample-first-task.ts` and verify the spec body contains `src/main/index.ts` with no `REPLACE_WITH_*` placeholder anywhere
4. `grep -r "REPLACE_WITH_ENTRY_FILE" src/` — must return zero matches

## Out of Scope

- Changing the spec template format
- Touching any other onboarding step
- Adding tests for the sample content (not worth the maintenance)
