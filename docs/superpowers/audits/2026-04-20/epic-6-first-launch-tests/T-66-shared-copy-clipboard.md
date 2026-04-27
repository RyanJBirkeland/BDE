# T-66 · Extract shared `copyToClipboard` helper used by onboarding steps

**Severity:** P3 · **Audit lens:** clean-code

## Context

Multiple onboarding step components reimplement the same `copyToClipboard` helper (write to `navigator.clipboard`, show a toast on success, show a fallback toast on failure). At minimum, `src/renderer/src/components/onboarding/steps/AuthStep.tsx:25` and `src/renderer/src/components/onboarding/steps/GhStep.tsx:8` have near-identical copies. Classic duplication smell.

## Files to Change

- `src/renderer/src/lib/copy-to-clipboard.ts` (new — shared helper)
- `src/renderer/src/components/onboarding/steps/AuthStep.tsx` (import the shared helper)
- `src/renderer/src/components/onboarding/steps/GhStep.tsx` (import the shared helper)
- Any other onboarding step with its own `copyToClipboard` — grep first:
  ```bash
  grep -rn "function copyToClipboard\|const copyToClipboard" src/renderer/src/components/onboarding/
  ```

## Implementation

Create `src/renderer/src/lib/copy-to-clipboard.ts`:

```ts
import { toast } from '../stores/toasts'

/**
 * Copy a string to the system clipboard with standard FLEET toast feedback.
 * Succeeds silently with a "Copied to clipboard" toast; on failure, shows
 * a "Could not copy — please copy manually" error toast so the user knows
 * to fall back.
 */
export async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    toast.success('Copied to clipboard')
  } catch {
    toast.error('Could not copy — please copy manually')
  }
}
```

Adjust toast strings if the existing helpers use slightly different ones; pick the most common phrasing and keep it consistent across all consumers.

Update each onboarding step to import `copyToClipboard` from the new module and delete the local implementation.

## How to Test

```bash
npm run typecheck
npm test -- onboarding
npm run lint
```

Existing onboarding tests (AuthStep, GhStep) should still pass since the visible behavior is unchanged. If any test mocks `navigator.clipboard.writeText`, it will continue to work — the helper calls the same API.

## Acceptance

- `src/renderer/src/lib/copy-to-clipboard.ts` exists and exports `copyToClipboard`.
- AuthStep, GhStep, and any other onboarding step import it instead of defining their own.
- Existing onboarding tests pass.
- Full suite green.
