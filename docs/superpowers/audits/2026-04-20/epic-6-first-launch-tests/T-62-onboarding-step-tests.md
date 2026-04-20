# T-62 · Add tests for `WelcomeStep`, `GitStep`, `RepoStep`

**Severity:** P1 · **Audit lens:** testing

## Context

`src/renderer/src/components/onboarding/steps/{WelcomeStep,GitStep,RepoStep}.tsx` have no test files. `AuthStep`, `GhStep`, `DoneStep`, and `OnboardingWizard` do. First-launch UX is the most install-critical surface, and `RepoStep` (~200 LOC — repo add, remote detection, validation) is the biggest uncovered component in the onboarding flow. A bug there strands users before they can create their first task.

## Files to Change

- `src/renderer/src/components/onboarding/__tests__/WelcomeStep.test.tsx` (new)
- `src/renderer/src/components/onboarding/__tests__/GitStep.test.tsx` (new)
- `src/renderer/src/components/onboarding/__tests__/RepoStep.test.tsx` (new)

## Implementation

Follow the pattern in `AuthStep.test.tsx` and `GhStep.test.tsx`. Use vitest + `@testing-library/react`. Mock `window.api` where needed.

### WelcomeStep.test.tsx

1. **Renders the welcome copy** — heading, subheading, a "next" or "start" button.
2. **Clicking next advances** — calls the `onNext` (or equivalent) prop once; button disabled state during async work if present.

### GitStep.test.tsx

Mock `window.api.system.checkGit` (or whatever the IPC is — read the component).

1. **Shows loading state while checking** — initial render calls `checkGit`; a spinner/pending indicator is visible.
2. **Git present** — mock resolves `{ ok: true, version: '2.43.0' }`; version surface + next button enabled.
3. **Git missing** — mock resolves `{ ok: false }`; error message + install-instructions link; next button disabled or gated.

### RepoStep.test.tsx

Mock `window.api.settings.getJson('repos')`, `window.api.system.openDirDialog`, `window.api.git.detectRemote`, `window.api.settings.setJson`.

1. **Renders empty state** — no repos yet; "Add a repo" CTA visible.
2. **Browse opens dir dialog** — click Browse; `openDirDialog` called; return value populates the path field.
3. **Detect remote auto-fills Name/Owner/Repo** — `detectRemote` returns `{ owner: 'x', repo: 'y' }`; the corresponding inputs populate.
4. **Validation rejects empty name** — try to add without a name; error surfaces; `settings.setJson` not called.
5. **Successful add persists** — fill all fields; click Add; `settings.setJson('repos', [..., new])` called with the correct shape (zod-validated if T-68 landed).
6. **Shows existing repos from settings** — preload `repos` with a fixture; the list renders them.
7. **Remove existing repo** — click remove; confirmation (if any); `settings.setJson` called with the repo removed.

Avoid asserting on visual styling. Assert on text content, button states, and IPC calls.

## How to Test

```bash
npm test -- WelcomeStep GitStep RepoStep
npm run typecheck
npm run lint
```

## Acceptance

- Three new test files exist, one per step, with the cases above.
- All cases pass.
- No shared state leaking between test cases (use `beforeEach` cleanup).
- Full suite green.
