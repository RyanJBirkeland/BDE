# Type-Aware Spec Validation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Task Workbench validation profile-aware so different task types (Feature, Test, Refactor, etc.) get appropriate check strictness, with a confirmation-dialog override for advisory failures.

**Architecture:** Define validation profiles in shared layer (`spec-validation.ts`), thread `specType` through the store → hooks → handlers → DB. Structural and semantic checks consult the profile to determine behavior (required/advisory/skip). Advisory failures surface in confirmation dialog instead of blocking.

**Tech Stack:** TypeScript, Zustand, Vitest, better-sqlite3, Agent SDK (for semantic checks)

**Spec:** `docs/superpowers/specs/2026-03-26-type-aware-validation-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/shared/spec-validation.ts` | Modify | Add `SpecType`, `CheckBehavior`, `ValidationProfile`, `VALIDATION_PROFILES`, `getValidationProfile()` |
| `src/shared/types.ts` | Modify | Add `spec_type` to `SprintTask` interface |
| `src/main/db.ts` | Modify | Add migration v16 for `spec_type` column |
| `src/main/data/sprint-queries.ts` | Modify | Add `spec_type` to `UPDATE_ALLOWLIST` |
| `src/renderer/src/stores/taskWorkbench.ts` | Modify | Add `specType` state + `setSpecType` action |
| `src/renderer/src/hooks/useReadinessChecks.ts` | Modify | Accept `specType`, apply profile to structural checks |
| `src/renderer/src/components/task-workbench/SpecEditor.tsx` | Modify | Wire type buttons to `setSpecType()` |
| `src/renderer/src/components/task-workbench/WorkbenchActions.tsx` | Modify | Profile-aware `canQueue`/`canLaunch` logic |
| `src/renderer/src/components/task-workbench/WorkbenchForm.tsx` | Modify | Thread `specType` through semantic checks, confirmation dialog, task creation |
| `src/main/spec-semantic-check.ts` | Modify | Accept `specType`, skip/contextualize checks |
| `src/main/handlers/workbench.ts` | Modify | Thread `specType` through `workbench:checkSpec` |
| `src/shared/__tests__/spec-validation.test.ts` | Create | Profile tests |
| `src/renderer/src/hooks/__tests__/useReadinessChecks.test.ts` | Modify | Profile-aware structural check tests |
| `src/renderer/src/components/task-workbench/__tests__/WorkbenchActions.test.tsx` | Modify | Advisory vs required button state tests |

---

### Task 1: Validation Profiles in Shared Layer

**Files:**
- Modify: `src/shared/spec-validation.ts`
- Create: `src/shared/__tests__/spec-validation.test.ts`

- [ ] **Step 1: Write tests for validation profiles**

```typescript
// src/shared/__tests__/spec-validation.test.ts
import { describe, it, expect } from 'vitest'
import { getValidationProfile, validateStructural, type SpecType } from '../spec-validation'

describe('getValidationProfile', () => {
  it('returns feature profile by default (null specType)', () => {
    const profile = getValidationProfile(null)
    expect(profile.specPresent.behavior).toBe('required')
    expect(profile.specPresent.threshold).toBe(50)
    expect(profile.specStructure.behavior).toBe('required')
  })

  it('returns feature profile for "feature"', () => {
    const profile = getValidationProfile('feature')
    expect(profile.specPresent.behavior).toBe('required')
    expect(profile.specPresent.threshold).toBe(50)
  })

  it('returns relaxed profile for "test"', () => {
    const profile = getValidationProfile('test')
    expect(profile.specPresent.behavior).toBe('advisory')
    expect(profile.specPresent.threshold).toBe(20)
    expect(profile.specStructure.behavior).toBe('advisory')
    expect(profile.filesExist.behavior).toBe('skip')
  })

  it('returns relaxed profile for "refactor"', () => {
    const profile = getValidationProfile('refactor')
    expect(profile.specPresent.threshold).toBe(30)
    expect(profile.specStructure.behavior).toBe('advisory')
    expect(profile.scope.behavior).toBe('advisory')
  })

  it('returns relaxed profile for "audit"', () => {
    const profile = getValidationProfile('audit')
    expect(profile.specPresent.behavior).toBe('advisory')
    expect(profile.specStructure.behavior).toBe('advisory')
    expect(profile.filesExist.behavior).toBe('skip')
  })

  it('performance and ux alias to feature profile', () => {
    const perf = getValidationProfile('performance')
    const feat = getValidationProfile('feature')
    expect(perf).toEqual(feat)
  })
})

describe('validateStructural with specType', () => {
  it('enforces 50-char min for feature', () => {
    const result = validateStructural({ title: 'Fix', repo: 'BDE', spec: 'Short', status: 'queued' })
    expect(result.valid).toBe(false)
  })

  it('uses 20-char threshold for test type', () => {
    const result = validateStructural({
      title: 'Fix',
      repo: 'BDE',
      spec: 'Run integration tests for auth',
      status: 'queued',
      specType: 'test'
    })
    // 30 chars > 20 threshold, and structure is advisory for test
    expect(result.valid).toBe(true)
  })

  it('still requires title and repo for all types', () => {
    const result = validateStructural({ title: '', repo: '', spec: 'x', specType: 'test' })
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('title is required')
  })

  it('treats advisory failures as warnings not errors', () => {
    const result = validateStructural({
      title: 'Test',
      repo: 'BDE',
      spec: 'Run tests',
      status: 'queued',
      specType: 'test'
    })
    // 'Run tests' is only 9 chars < 20 threshold, but advisory -> warning
    expect(result.valid).toBe(true)
    expect(result.warnings.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/shared/__tests__/spec-validation.test.ts`
Expected: FAIL — `getValidationProfile` does not exist, `specType` param not accepted

- [ ] **Step 3: Implement validation profiles**

Add to `src/shared/spec-validation.ts`:

```typescript
// --- Spec Types ---

export type SpecType = 'feature' | 'bugfix' | 'refactor' | 'test' | 'performance' | 'ux' | 'audit' | 'infra'

export type CheckBehavior = 'required' | 'advisory' | 'skip'

export interface CheckConfig {
  behavior: CheckBehavior
  threshold?: number // for spec-present (char count) or spec-structure (heading count)
}

export interface ValidationProfile {
  specPresent: CheckConfig
  specStructure: CheckConfig
  clarity: CheckConfig
  scope: CheckConfig
  filesExist: CheckConfig
}

const FEATURE_PROFILE: ValidationProfile = {
  specPresent: { behavior: 'required', threshold: 50 },
  specStructure: { behavior: 'required', threshold: 2 },
  clarity: { behavior: 'required' },
  scope: { behavior: 'required' },
  filesExist: { behavior: 'required' }
}

const REFACTOR_PROFILE: ValidationProfile = {
  specPresent: { behavior: 'required', threshold: 30 },
  specStructure: { behavior: 'advisory', threshold: 1 },
  clarity: { behavior: 'required' },
  scope: { behavior: 'advisory' },
  filesExist: { behavior: 'advisory' }
}

const TEST_PROFILE: ValidationProfile = {
  specPresent: { behavior: 'advisory', threshold: 20 },
  specStructure: { behavior: 'advisory', threshold: 1 },
  clarity: { behavior: 'advisory' },
  scope: { behavior: 'advisory' },
  filesExist: { behavior: 'skip' }
}

const LIGHTWEIGHT_PROFILE: ValidationProfile = {
  specPresent: { behavior: 'advisory', threshold: 20 },
  specStructure: { behavior: 'advisory', threshold: 1 },
  clarity: { behavior: 'advisory' },
  scope: { behavior: 'advisory' },
  filesExist: { behavior: 'skip' }
}

const VALIDATION_PROFILES: Record<SpecType, ValidationProfile> = {
  feature: FEATURE_PROFILE,
  bugfix: { ...FEATURE_PROFILE },
  refactor: REFACTOR_PROFILE,
  test: TEST_PROFILE,
  performance: FEATURE_PROFILE,
  ux: FEATURE_PROFILE,
  audit: LIGHTWEIGHT_PROFILE,
  infra: LIGHTWEIGHT_PROFILE
}

export function getValidationProfile(specType: SpecType | null | undefined): ValidationProfile {
  if (!specType) return FEATURE_PROFILE
  return VALIDATION_PROFILES[specType] ?? FEATURE_PROFILE
}
```

Then update `validateStructural()` to accept `specType?: SpecType | null` and use profile thresholds/behaviors. Advisory failures go to `warnings[]` instead of `errors[]`. Keep existing `status === 'backlog'` relaxation logic — it takes precedence (backlog skips spec checks entirely regardless of profile).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/shared/__tests__/spec-validation.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/shared/spec-validation.ts src/shared/__tests__/spec-validation.test.ts
git commit -m "feat: add validation profiles to spec-validation"
```

---

### Task 2: Data Model — SprintTask Interface + Migration + Allowlist

**Files:**
- Modify: `src/shared/types.ts:31-57` (SprintTask interface)
- Modify: `src/main/db.ts` (add migration v16)
- Modify: `src/main/data/sprint-queries.ts:45-68` (UPDATE_ALLOWLIST)

- [ ] **Step 1: Add `spec_type` to SprintTask interface**

In `src/shared/types.ts`, add after `max_runtime_ms` (line 53):

```typescript
spec_type?: string | null
```

- [ ] **Step 2: Add migration v16**

In `src/main/db.ts`, add to end of `migrations` array:

```typescript
{
  version: 16,
  description: 'Add spec_type column to sprint_tasks',
  up: (db) => {
    const cols = (db.pragma('table_info(sprint_tasks)') as { name: string }[]).map((c) => c.name)
    if (!cols.includes('spec_type')) {
      db.exec('ALTER TABLE sprint_tasks ADD COLUMN spec_type TEXT')
    }
  }
}
```

- [ ] **Step 3: Add `spec_type` to UPDATE_ALLOWLIST**

In `src/main/data/sprint-queries.ts`, add `'spec_type'` to the `UPDATE_ALLOWLIST` set (after `'max_runtime_ms'`).

- [ ] **Step 4: Run existing tests**

Run: `npm test -- --run` and `npm run test:main -- --run`
Expected: All existing tests PASS (no behavior change yet)

- [ ] **Step 5: Commit**

```bash
git add src/shared/types.ts src/main/db.ts src/main/data/sprint-queries.ts
git commit -m "feat: add spec_type column to sprint_tasks (migration v16)"
```

---

### Task 3: Store + SpecEditor — Wire specType Through UI

**Files:**
- Modify: `src/renderer/src/stores/taskWorkbench.ts`
- Modify: `src/renderer/src/components/task-workbench/SpecEditor.tsx`

- [ ] **Step 1: Add `specType` to store**

In `src/renderer/src/stores/taskWorkbench.ts`:

1. Add import: `import type { SpecType } from '../../../shared/spec-validation'`
2. Add to `TaskWorkbenchState` interface (in the Form section, after `playgroundEnabled`):
   ```typescript
   specType: SpecType | null
   ```
3. Add action to interface:
   ```typescript
   setSpecType: (type: SpecType | null) => void
   ```
4. Add `'specType'` to `defaults()` Pick type union and add to return object:
   ```typescript
   specType: null
   ```
5. Add to `loadTask`:
   ```typescript
   specType: (task.spec_type as SpecType) ?? null
   ```
6. Add action implementation in the store creator:
   ```typescript
   setSpecType: (type) => set({ specType: type }),
   ```

- [ ] **Step 2: Wire SpecEditor type buttons to setSpecType**

In `src/renderer/src/components/task-workbench/SpecEditor.tsx`:

1. Add import: `import type { SpecType } from '../../../../shared/spec-validation'`
2. Add store selector:
   ```typescript
   const setSpecType = useTaskWorkbenchStore((s) => s.setSpecType)
   ```
3. Add `specType` key to `SPEC_TEMPLATES`:
   ```typescript
   const SPEC_TEMPLATES: Record<string, { label: string; spec: string; specType: SpecType }> = {
     feature: { label: 'Feature', specType: 'feature', spec: '## Problem\n\n## Solution\n\n## Files to Change\n\n## Out of Scope\n' },
     bugfix: { label: 'Bug Fix', specType: 'bugfix', spec: '## Bug Description\n\n## Root Cause\n\n## Fix\n\n## Files to Change\n\n## How to Test\n' },
     refactor: { label: 'Refactor', specType: 'refactor', spec: "## What's Being Refactored\n\n## Target State\n\n## Files to Change\n\n## Out of Scope\n" },
     test: { label: 'Test', specType: 'test', spec: '## What to Test\n\n## Test Strategy\n\n## Files to Create\n\n## Coverage Target\n' }
   }
   ```
4. Update button onClick:
   ```tsx
   onClick={() => { setField('spec', tmpl.spec); setSpecType(tmpl.specType) }}
   ```

- [ ] **Step 3: Run existing tests**

Run: `npm test -- --run`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/stores/taskWorkbench.ts src/renderer/src/components/task-workbench/SpecEditor.tsx
git commit -m "feat: wire specType through store and SpecEditor buttons"
```

---

### Task 4: Profile-Aware Structural Checks

**Files:**
- Modify: `src/renderer/src/hooks/useReadinessChecks.ts`
- Modify: `src/renderer/src/hooks/__tests__/useReadinessChecks.test.ts`

- [ ] **Step 1: Write tests for profile-aware structural checks**

Add to `src/renderer/src/hooks/__tests__/useReadinessChecks.test.ts`:

```typescript
describe('computeStructuralChecks with specType', () => {
  it('test type: short spec is warn (advisory) not fail', () => {
    const checks = computeStructuralChecks(
      { title: 'Test auth', repo: 'BDE', spec: 'Run auth tests' },
      'test'
    )
    const specPresent = checks.find((c) => c.id === 'spec-present')
    // 14 chars < 20 threshold, but advisory -> warn not fail
    expect(specPresent?.status).toBe('warn')
  })

  it('test type: no headings is warn (advisory) not fail', () => {
    const checks = computeStructuralChecks(
      { title: 'Test', repo: 'BDE', spec: 'Run the integration test suite for authentication module' },
      'test'
    )
    const structure = checks.find((c) => c.id === 'spec-structure')
    expect(structure?.status).toBe('warn')
  })

  it('feature type: short spec is fail (required)', () => {
    const checks = computeStructuralChecks(
      { title: 'Add feature', repo: 'BDE', spec: 'Short' },
      'feature'
    )
    const specPresent = checks.find((c) => c.id === 'spec-present')
    expect(specPresent?.status).toBe('fail')
  })

  it('null specType defaults to feature profile (required)', () => {
    const checks = computeStructuralChecks(
      { title: 'Fix', repo: 'BDE', spec: 'Short' },
      null
    )
    const specPresent = checks.find((c) => c.id === 'spec-present')
    expect(specPresent?.status).toBe('fail')
  })

  it('refactor type: uses 30-char threshold', () => {
    const spec = 'Refactor the auth module code here'  // 34 chars > 30
    const checks = computeStructuralChecks(
      { title: 'Refactor', repo: 'BDE', spec },
      'refactor'
    )
    const specPresent = checks.find((c) => c.id === 'spec-present')
    expect(specPresent?.status).toBe('pass')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/src/hooks/__tests__/useReadinessChecks.test.ts`
Expected: FAIL — `computeStructuralChecks` doesn't accept a second parameter

- [ ] **Step 3: Update computeStructuralChecks to accept specType**

In `src/renderer/src/hooks/useReadinessChecks.ts`:

1. Add import: `import { getValidationProfile, type SpecType } from '../../../shared/spec-validation'`
2. Update `computeStructuralChecks` signature to accept optional second param:
   ```typescript
   export function computeStructuralChecks(form: FormSnapshot, specType?: SpecType | null): CheckResult[]
   ```
3. Get profile at top of function:
   ```typescript
   const profile = getValidationProfile(specType ?? null)
   ```
4. Update `spec-present` check: use `profile.specPresent.threshold ?? MIN_SPEC_LENGTH` instead of `MIN_SPEC_LENGTH`. If `profile.specPresent.behavior === 'advisory'`, downgrade `fail` to `warn`.
5. Update `spec-structure` check: use `profile.specStructure.threshold ?? MIN_HEADING_COUNT` instead of `MIN_HEADING_COUNT`. If `profile.specStructure.behavior === 'advisory'`, downgrade `fail` to `warn`. If `behavior === 'skip'`, omit from results.
6. Update the `useReadinessChecks` hook to read `specType` from store:
   ```typescript
   const specType = useTaskWorkbenchStore((s) => s.specType)
   // in useEffect:
   const checks = computeStructuralChecks({ title, repo, spec }, specType)
   ```
   Add `specType` to the `useEffect` dependency array.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/renderer/src/hooks/__tests__/useReadinessChecks.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/hooks/useReadinessChecks.ts src/renderer/src/hooks/__tests__/useReadinessChecks.test.ts
git commit -m "feat: profile-aware structural checks based on specType"
```

---

### Task 5: Profile-Aware Button Logic + Confirmation Dialog

**Files:**
- Modify: `src/renderer/src/components/task-workbench/WorkbenchActions.tsx`
- Modify: `src/renderer/src/components/task-workbench/WorkbenchForm.tsx`
- Modify: `src/renderer/src/components/task-workbench/__tests__/WorkbenchActions.test.tsx`

- [ ] **Step 1: Write tests for advisory vs required button state**

Add to `src/renderer/src/components/task-workbench/__tests__/WorkbenchActions.test.tsx`:

```typescript
it('Queue Now enabled when advisory checks are warn status (test profile)', () => {
  useTaskWorkbenchStore.setState({
    specType: 'test',
    structuralChecks: [
      { id: 'title-present', label: 'Title', tier: 1, status: 'pass', message: 'OK' },
      { id: 'repo-selected', label: 'Repo', tier: 1, status: 'pass', message: 'OK' },
      { id: 'spec-present', label: 'Spec', tier: 1, status: 'warn', message: 'Short spec (advisory)' },
      { id: 'spec-structure', label: 'Structure', tier: 1, status: 'warn', message: 'No headings (advisory)' }
    ]
  })
  render(<WorkbenchActions {...defaultProps} />)
  expect(screen.getByText('Queue Now')).not.toBeDisabled()
})

it('Queue Now disabled when required checks fail (feature profile)', () => {
  useTaskWorkbenchStore.setState({
    specType: 'feature',
    structuralChecks: [
      { id: 'title-present', label: 'Title', tier: 1, status: 'pass', message: 'OK' },
      { id: 'repo-selected', label: 'Repo', tier: 1, status: 'pass', message: 'OK' },
      { id: 'spec-present', label: 'Spec', tier: 1, status: 'fail', message: 'Too short' }
    ]
  })
  render(<WorkbenchActions {...defaultProps} />)
  expect(screen.getByText('Queue Now')).toBeDisabled()
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/src/components/task-workbench/__tests__/WorkbenchActions.test.tsx`
Expected: FAIL — first test fails because current logic treats all tier 1 warns/fails equally via `allTier1Pass`

- [ ] **Step 3: Update WorkbenchActions canQueue/canLaunch logic**

In `src/renderer/src/components/task-workbench/WorkbenchActions.tsx`:

1. Add imports:
   ```typescript
   import { getValidationProfile, type ValidationProfile } from '../../../../shared/spec-validation'
   ```
2. Read `specType` from store:
   ```typescript
   const specType = useTaskWorkbenchStore((s) => s.specType)
   ```
3. Replace `allTier1Pass` logic with profile-aware version:
   ```typescript
   const profile = getValidationProfile(specType)

   // Map check IDs to profile keys for lookup
   const PROFILE_KEY_MAP: Record<string, keyof ValidationProfile> = {
     'spec-present': 'specPresent',
     'spec-structure': 'specStructure',
     clarity: 'clarity',
     scope: 'scope',
     'files-exist': 'filesExist'
   }

   // A check blocks queuing only if profile says 'required' AND status is 'fail'
   const hasRequiredTier1Fail = structural.some((c) => {
     if (c.status !== 'fail') return false
     const profileKey = PROFILE_KEY_MAP[c.id]
     if (!profileKey) return true // title-present, repo-selected — always required
     return profile[profileKey].behavior === 'required'
   })

   const hasRequiredSemanticFail = semantic.some((c) => {
     if (c.status !== 'fail') return false
     const profileKey = PROFILE_KEY_MAP[c.id]
     if (!profileKey) return true
     return profile[profileKey].behavior === 'required'
   })

   const canSave = titlePasses
   const canQueue = !hasRequiredTier1Fail && !tier3HasFails
   const canLaunch = !hasRequiredTier1Fail && !hasRequiredSemanticFail && !tier3HasFails
   ```

- [ ] **Step 4: Update WorkbenchForm confirmation dialog**

In `src/renderer/src/components/task-workbench/WorkbenchForm.tsx`:

1. Add state for dynamic confirm message:
   ```typescript
   const [queueConfirmMessage, setQueueConfirmMessage] = useState('')
   ```

2. In `handleSubmit`, after operational checks pass (around line 152), collect ALL warnings (operational + advisory structural/semantic):
   ```typescript
   const allStructural = useTaskWorkbenchStore.getState().structuralChecks
   const allSemantic = useTaskWorkbenchStore.getState().semanticChecks
   const advisoryWarnings = [...allStructural, ...allSemantic].filter((c) => c.status === 'warn')
   const opWarnings = opChecks.filter((c) => c.status === 'warn')
   const allWarnings = [...advisoryWarnings, ...opWarnings]
   if (allWarnings.length > 0) {
     const lines = allWarnings.map((c) => `\u2022 ${c.label}: ${c.message}`)
     setQueueConfirmMessage(
       `The following checks have warnings:\n\n${lines.join('\n')}\n\nQueue anyway?`
     )
     useTaskWorkbenchStore.setState({ checksExpanded: true })
     setShowQueueConfirm(true)
     setSubmitting(false)
     return
   }
   ```

3. Update ConfirmModal to use dynamic message:
   ```tsx
   <ConfirmModal
     open={showQueueConfirm}
     title="Queue with warnings?"
     message={queueConfirmMessage || 'Some checks have warnings. Queue anyway?'}
     confirmLabel="Queue Anyway"
     onConfirm={handleConfirmedQueue}
     onCancel={() => setShowQueueConfirm(false)}
   />
   ```

4. Include `spec_type` in task creation payload. In the `createTask` input object:
   ```typescript
   spec_type: useTaskWorkbenchStore.getState().specType ?? undefined
   ```
   And similarly in the `updateTask` calls.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/renderer/src/components/task-workbench/__tests__/WorkbenchActions.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/task-workbench/WorkbenchActions.tsx \
  src/renderer/src/components/task-workbench/WorkbenchForm.tsx \
  src/renderer/src/components/task-workbench/__tests__/WorkbenchActions.test.tsx
git commit -m "feat: profile-aware button logic + advisory confirmation dialog"
```

---

### Task 6: Profile-Aware Semantic Checks

**Files:**
- Modify: `src/main/spec-semantic-check.ts`
- Modify: `src/main/handlers/workbench.ts`
- Modify: `src/renderer/src/components/task-workbench/WorkbenchForm.tsx`

- [ ] **Step 1: Update checkSpecSemantic to accept specType**

In `src/main/spec-semantic-check.ts`:

1. Add import at top:
   ```typescript
   import { getValidationProfile, type SpecType } from '../shared/spec-validation'
   ```
   Note: verify the relative path — from `src/main/` to `src/shared/` is `../shared/`. Check existing imports in the file for the correct pattern.

2. Update `checkSpecSemantic` signature:
   ```typescript
   export async function checkSpecSemantic(input: {
     title: string
     repo: string
     spec: string
     specType?: SpecType | null
   }): Promise<SemanticCheckSummary>
   ```

3. At top of function body, get profile and determine which checks to run:
   ```typescript
   const profile = getValidationProfile(input.specType ?? null)
   const runClarity = profile.clarity.behavior !== 'skip'
   const runScope = profile.scope.behavior !== 'skip'
   const runFiles = profile.filesExist.behavior !== 'skip'
   ```

4. Add spec type context to AI prompt:
   ```typescript
   const typeContext = input.specType
     ? `\nTask type: ${input.specType}. Adjust expectations accordingly — ${input.specType} tasks may have different structure/scope requirements than feature tasks.`
     : ''
   ```
   Append `typeContext` to the prompt string.

5. For skipped checks, return `pass` directly without querying:
   ```typescript
   if (!runFiles) {
     results.filesExist = { status: 'pass', message: 'Skipped (not required for this task type)' }
   }
   ```

- [ ] **Step 2: Thread specType through workbench:checkSpec handler**

In `src/main/handlers/workbench.ts`, update the `workbench:checkSpec` handler (around line 422):

```typescript
safeHandle(
  'workbench:checkSpec',
  async (_e, input: { title: string; repo: string; spec: string; specType?: string }) => {
    const summary = await checkSpecSemantic(input)
    return summary.results
  }
)
```

The handler just passes through — `specType` is already in the input object.

- [ ] **Step 3: Update WorkbenchForm to pass specType in semantic check call**

In `src/renderer/src/components/task-workbench/WorkbenchForm.tsx`, update the semantic check IPC call (around line 57):

```typescript
const specType = useTaskWorkbenchStore.getState().specType
const result = await window.api.workbench.checkSpec({ title, repo, spec, specType })
```

Add `specType` to the `useEffect` dependency array for the semantic check debounce (currently depends on `spec, title, repo`). Read it reactively:

```typescript
const specType = useTaskWorkbenchStore((s) => s.specType)
```

And include in the dependency array of the semantic check useEffect.

- [ ] **Step 4: Run all tests**

Run: `npm test -- --run` and `npm run test:main -- --run`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/spec-semantic-check.ts src/main/handlers/workbench.ts \
  src/renderer/src/components/task-workbench/WorkbenchForm.tsx
git commit -m "feat: profile-aware semantic checks with specType context"
```

---

### Task 7: Full Integration Test + Final Verification

**Files:**
- All modified files from Tasks 1-6

- [ ] **Step 1: Run full renderer test suite**

Run: `npm test -- --run`
Expected: All tests PASS

- [ ] **Step 2: Run main process tests**

Run: `npm run test:main -- --run`
Expected: All tests PASS

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: No type errors

- [ ] **Step 4: Run build**

Run: `npm run build`
Expected: Clean build, no errors

- [ ] **Step 5: Verify handler count test**

Check `src/main/handlers/__tests__/workbench.test.ts` — the handler count should NOT change since we modified the `workbench:checkSpec` handler's payload shape, not added new handlers. Confirm the test still passes (it ran in Step 2).

- [ ] **Step 6: Commit any remaining fixes**

If any tests or typecheck issues were found and fixed:

```bash
git add -A
git commit -m "chore: integration fixes for type-aware validation"
```
