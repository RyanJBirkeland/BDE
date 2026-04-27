# Readiness Validation Unification — Implementation Plan (RC4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One task-creation validator used by both the UI form (IPC) and MCP server, with an explicit `skipReadinessCheck` option for admin/batch tooling. Eliminate the extra strict-heading layer the MCP currently adds on top of the shared service.

**Architecture:** `createTaskWithValidation` in `sprint-service.ts` is the single policy surface. The MCP handler currently does its own spec-structure check after calling this; remove that extra layer and expose `skipReadinessCheck` via the MCP schema instead.

**Spec reference:** `docs/superpowers/specs/2026-04-20-pipeline-pain-points-design.md` § Root Cause 4.

---

### Task 1: Locate the MCP extra-strict readiness layer

- [ ] **Step 1: Find it**

Run:
```bash
grep -n "Spec quality checks\|SpecParser\|RequiredSectionsValidator\|## Overview" src/main/mcp-server/ src/main/services/sprint-service.ts --include="*.ts" -r
```

Expected: `sprint-service.ts` has its own `SpecParser` + `RequiredSectionsValidator` check inside `createTaskWithValidation`. The MCP `tasks.create` handler may wrap it or may rely on it. Confirm which.

- [ ] **Step 2: Read `createTaskWithValidation` end-to-end**

Open `src/main/services/sprint-service.ts` and read the function body. Note what validators it runs and in what order:
1. `validateTaskCreation` (structural — required fields, no forbidden keys)
2. Optional spec-structure check when `status === 'queued'`
3. Repo-path existence

The MCP handler at `src/main/mcp-server/tools/tasks.ts` calls this service directly. No additional layer is needed — the spec quality check is already in the service. So the "MCP is stricter" observation from the audit was actually about the single service being stricter than the UI's code path.

Verify by searching whether the UI form skips the spec-structure check:
```bash
grep -n "createTaskWithValidation\|RequiredSectionsValidator" src/main/handlers/ --include="*.ts"
```

- [ ] **Step 3: Document findings as a comment in the plan**

Write a 3–5-line note here (inline in the plan, as a reviewer comment or PR description) describing the actual shape of the current paths. The remaining tasks in this plan assume:

> `createTaskWithValidation` is the single validator. Both IPC and MCP call it. The difference is the *input* — the UI form pre-validates on the client side, so the service's structural check is effectively advisory; the MCP client has no client-side check, so the service's check IS the user-facing check. Fix: expose `skipReadinessCheck` through the service so batch/admin flows can opt out explicitly, and log when it's used.

If your investigation contradicts this note, update the note and adjust subsequent tasks accordingly before continuing.

- [ ] **Step 4: No commit**

Investigation-only.

---

### Task 2: Add `skipReadinessCheck` to `createTaskWithValidation`

**Files:**
- Modify: `src/main/services/sprint-service.ts`
- Modify: `src/main/services/__tests__/sprint-service.test.ts` (or the nearest existing test file for this function)

- [ ] **Step 1: Write the failing test**

```typescript
describe('createTaskWithValidation — skipReadinessCheck', () => {
  it('rejects a queued task with insufficient headings by default', () => {
    expect(() =>
      createTaskWithValidation(
        {
          title: 'missing sections',
          repo: 'fleet',
          status: 'queued',
          spec: '## Only one section\nbody'
        },
        { logger }
      )
    ).toThrow(/Spec quality|sections/i)
  })

  it('accepts the same task when skipReadinessCheck is true, and logs it', () => {
    const warn = vi.fn()
    // The function accepts any spec quality when skip is true, but still
    // enforces structural validation (required fields, configured repo).
    const row = createTaskWithValidation(
      {
        title: 'missing sections',
        repo: 'fleet',
        status: 'queued',
        spec: '## Only one section\nbody'
      },
      { logger: { ...logger, warn } },
      { skipReadinessCheck: true }
    )
    expect(row).toBeDefined()
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/skipReadinessCheck/))
  })

  it('still enforces required fields even with skipReadinessCheck', () => {
    expect(() =>
      createTaskWithValidation(
        { title: '', repo: 'fleet' },
        { logger },
        { skipReadinessCheck: true }
      )
    ).toThrow(/title/i)
  })
})
```

(Reuse the existing test harness for `sprint-service` — stub `validateTaskCreation`, `listGroups`, `getRepoPaths`, `createTask` as the existing tests do.)

- [ ] **Step 2: Run tests to verify failure**

Run: `npm run test:main -- sprint-service`
Expected: the skip-case tests FAIL (option not supported).

- [ ] **Step 3: Extend the function signature**

```typescript
export interface CreateTaskWithValidationOpts {
  /**
   * Skip the spec-structure check (required headings, min length) that
   * runs for queued tasks. Structural validation (required fields,
   * configured repo) always runs. Use for batch/admin tooling with
   * hand-validated specs; logged at warn level when true.
   */
  skipReadinessCheck?: boolean
}

export function createTaskWithValidation(
  input: mutations.CreateTaskInput,
  deps: CreateTaskWithValidationDeps,
  opts: CreateTaskWithValidationOpts = {}
): SprintTask {
  const validation = validateTaskCreation(input, { /* unchanged */ })
  if (!validation.valid) {
    throw new Error(`Spec quality checks failed: ${validation.errors.join('; ')}`)
  }

  if (validation.task.status === 'queued' && validation.task.spec && !opts.skipReadinessCheck) {
    const parsed = new SpecParser().parse(validation.task.spec)
    const sectionErrors = new RequiredSectionsValidator()
      .validate(parsed)
      .filter((issue) => issue.severity === 'error')
    if (sectionErrors.length > 0) {
      throw new Error(`Spec quality checks failed: ${sectionErrors[0].message}`)
    }
  }

  if (opts.skipReadinessCheck) {
    deps.logger.warn('createTaskWithValidation: skipReadinessCheck=true (batch/admin path)')
  }

  // ... rest unchanged (repo-path check, createTask) ...
}
```

- [ ] **Step 4: Run tests**

Run: `npm run test:main -- sprint-service`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/sprint-service.ts src/main/services/__tests__/sprint-service.test.ts
git commit -m "feat(sprint-service): add skipReadinessCheck option for batch/admin use"
```

---

### Task 3: Expose `skipReadinessCheck` via the MCP `tasks.create` schema

**Files:**
- Modify: `src/main/mcp-server/schemas.ts`
- Modify: `src/main/mcp-server/tools/tasks.ts`
- Modify: `src/main/mcp-server/tools/tasks.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tasks.test.ts`:

```typescript
it('tasks.create forwards skipReadinessCheck to the delegate', async () => {
  const deps = fakeDeps()
  const { server, call } = mockServer()
  registerTaskTools(server, deps)
  await call('tasks.create', {
    title: 'batch task',
    repo: 'fleet',
    status: 'queued',
    spec: '## Only one section\nbody',
    skipReadinessCheck: true
  })
  const call0 = (deps.createTaskWithValidation as any).mock.calls[0]
  const opts = call0[2] // third argument is opts
  expect(opts).toEqual(expect.objectContaining({ skipReadinessCheck: true }))
})

it('tasks.create defaults skipReadinessCheck to false', async () => {
  const deps = fakeDeps()
  const { server, call } = mockServer()
  registerTaskTools(server, deps)
  await call('tasks.create', { title: 't', repo: 'fleet' })
  const call0 = (deps.createTaskWithValidation as any).mock.calls[0]
  const opts = call0[2] ?? {}
  expect(opts.skipReadinessCheck ?? false).toBe(false)
})
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npm run test:main -- tools/tasks`
Expected: FAIL — field not recognized (zod strips unknown keys) or delegate not called with opts.

- [ ] **Step 3: Add the field to the schema**

Append to `TaskWriteFieldsSchema` in `schemas.ts`:

```typescript
skipReadinessCheck: z.boolean().optional()
```

- [ ] **Step 4: Forward the option in the handler**

In `tasks.ts` where `tasks.create` calls `deps.createTaskWithValidation`:

```typescript
const input: CreateTaskInput = TaskCreateSchema.parse(rawArgs)
const { skipReadinessCheck, ...createInput } = input as CreateTaskInput & {
  skipReadinessCheck?: boolean
}
const row = deps.createTaskWithValidation(createInput, { logger: deps.logger }, { skipReadinessCheck })
```

Also update the `TaskToolsDeps.createTaskWithValidation` signature in `tasks.ts` to accept an optional third argument (`opts`).

- [ ] **Step 5: Run tests**

Run: `npm run test:main -- tools/tasks`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/mcp-server/schemas.ts src/main/mcp-server/tools/tasks.ts src/main/mcp-server/tools/tasks.test.ts
git commit -m "feat(mcp): expose skipReadinessCheck on tasks.create for batch/admin flows"
```

---

### Task 4: Add machine-readable error codes to validation failures

**Files:**
- Modify: `src/main/services/sprint-service.ts`
- Modify: `src/main/services/__tests__/sprint-service.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
it('validation errors carry a machine-readable code', () => {
  try {
    createTaskWithValidation({ title: '', repo: 'fleet' }, { logger })
    expect.fail('should have thrown')
  } catch (err) {
    expect(err).toMatchObject({
      code: 'spec-structural',
      message: expect.stringMatching(/title/i)
    })
  }
})

it('readiness failures carry code spec-readiness', () => {
  try {
    createTaskWithValidation(
      { title: 't', repo: 'fleet', status: 'queued', spec: '## Only one section' },
      { logger }
    )
    expect.fail('should have thrown')
  } catch (err) {
    expect(err).toMatchObject({ code: 'spec-readiness' })
  }
})
```

- [ ] **Step 2: Run tests to verify failure**

- [ ] **Step 3: Introduce a `TaskValidationError` with a `code` field**

```typescript
export class TaskValidationError extends Error {
  readonly code: 'spec-structural' | 'spec-readiness' | 'repo-not-configured'
  constructor(code: TaskValidationError['code'], message: string) {
    super(message)
    this.code = code
    this.name = 'TaskValidationError'
  }
}
```

Replace the three existing `throw new Error(...)` sites in `createTaskWithValidation` with `throw new TaskValidationError(code, message)` using the appropriate code.

- [ ] **Step 4: Run tests**

Run: `npm run test:main -- sprint-service`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/sprint-service.ts src/main/services/__tests__/sprint-service.test.ts
git commit -m "feat(sprint-service): add TaskValidationError with machine-readable codes"
```

---

### Task 5: Full-suite regression

- [ ] **Step 1: Run everything**

```bash
npm run typecheck && npm test && npm run test:main && npm run lint
```

Expected: all green.

- [ ] **Step 2: Commit nothing — verification step.**

---

## Self-Review Notes

- Spec coverage: `skipReadinessCheck` consolidation (Tasks 2, 3); machine-readable codes (Task 4).
- Placeholders: Task 1 step 3 asks for an in-plan note — this is an investigation artifact, not a code placeholder.
- Type consistency: `CreateTaskWithValidationOpts` used in Tasks 2–3; `TaskValidationError` used in Task 4.
