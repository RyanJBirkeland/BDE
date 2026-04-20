# T-63 · Assert `SAMPLE_FIRST_TASK` passes readiness validation

**Severity:** P1 · **Audit lens:** testing

## Context

`src/renderer/src/components/onboarding/steps/sample-first-task.ts:9` has a comment promising the spec "follows the Feature template so readiness checks pass." No test verifies this. If `SPEC_TEMPLATES` in `src/shared/constants.ts` adds or renames a required heading, the onboarding "Create your first task" button silently regresses — the user's first experience becomes a validation failure.

## Files to Change

- `src/renderer/src/components/onboarding/steps/__tests__/sample-first-task.test.ts` (new)
- Reference: `src/shared/constants.ts` (`SPEC_TEMPLATES`) and the readiness validator (likely `src/main/services/spec-validation.ts` or `src/shared/spec-validation.ts`).

## Implementation

Create the test. Import `SAMPLE_FIRST_TASK` and the readiness validator. Assert the structural readiness check returns `{ ok: true }` (or whatever the success shape is — inspect the validator's return type).

```ts
import { describe, it, expect } from 'vitest'
import { SAMPLE_FIRST_TASK } from '../sample-first-task'
import { validateSpec } from '<path-to-validator>'

describe('SAMPLE_FIRST_TASK', () => {
  it('passes readiness validation', () => {
    const result = validateSpec(SAMPLE_FIRST_TASK.spec, SAMPLE_FIRST_TASK.specType)
    expect(result.ok).toBe(true)
  })

  it('includes every required section for its spec_type', () => {
    const required = SPEC_TEMPLATES[SAMPLE_FIRST_TASK.specType].requiredSections
    for (const section of required) {
      expect(SAMPLE_FIRST_TASK.spec).toMatch(new RegExp(`^##\\s+${section}`, 'm'))
    }
  })
})
```

If the readiness validator is async (e.g. does a semantic check via SDK), only assert the synchronous/structural branch — mock or skip the semantic call. The goal is to catch structural drift, not exercise the LLM path.

If `SAMPLE_FIRST_TASK.specType` is not exported or is implicit, export it.

## How to Test

```bash
npm test -- sample-first-task
npm run typecheck
npm run lint
```

## Acceptance

- Test file exists and both cases pass.
- Adding a required section to `SPEC_TEMPLATES[SAMPLE_FIRST_TASK.specType]` without updating `sample-first-task.ts` causes the test to fail loudly.
- Full suite green.
