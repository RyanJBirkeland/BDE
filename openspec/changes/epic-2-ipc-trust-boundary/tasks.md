## 1. T-26 — Validate full `CreateTaskInput` and `WorkflowTemplate` shapes at the IPC boundary

- [x] 1.1 Create `src/main/handlers/sprint-ipc-schemas.ts`. Import `z` from `zod`. Import `TaskWriteFieldsSchema` and `TaskDependencySchema` from `../../main/mcp-server/schemas`. Import `WorkflowStep` and `WorkflowTemplate` from `../../shared/workflow-types`. Define and export `CreateTaskInputSchema` as an alias or re-export of `TaskWriteFieldsSchema` (the field sets are identical). Define and export `WorkflowStepSchema` as a `z.object` covering all `WorkflowStep` fields (`title`, `prompt?`, `spec?`, `repo`, `dependsOnSteps?`, `depType?`, `playgroundEnabled?`, `model?`). Define and export `WorkflowTemplateSchema` as a `z.object` with `name: z.string().min(1)`, `description: z.string()`, `steps: z.array(WorkflowStepSchema).min(1)`.

- [x] 1.2 In `src/main/handlers/sprint-local.ts`, import `CreateTaskInputSchema` and `WorkflowTemplateSchema` from `./sprint-ipc-schemas`. In `parseSprintCreateArgs`, replace the manual `title`/`repo` checks with a `CreateTaskInputSchema.parse(task)` call. The parse result is the typed `CreateTaskInput` — return it directly without an `as unknown as` cast. Remove the now-redundant manual field checks for `title` and `repo` (the schema covers them).

- [x] 1.3 In `src/main/handlers/sprint-local.ts`, in `parseCreateWorkflowArgs`, replace the manual `name`/`tasks` checks with a `WorkflowTemplateSchema.parse(template)` call. Note: `WorkflowTemplate` uses `steps`, not `tasks` — the existing check (`!Array.isArray(template.tasks)`) was checking the wrong field name; the schema check corrects this silently. Return the parse result directly without an `as unknown as` cast.

- [x] 1.4 Create `src/main/handlers/__tests__/sprint-local-parse.test.ts`. Add tests for `parseSprintCreateArgs`:
  - "accepts a minimal valid task (title + repo)" — verify the returned object has the correct shape.
  - "throws when title is missing" — call with `{ repo: 'fleet' }`, assert a `ZodError` (or Error) is thrown with a message mentioning `title`.
  - "throws when repo is empty string" — call with `{ title: 'T', repo: '' }`, assert an error is thrown.
  - "throws when depends_on contains an element with invalid type" — call with `{ title: 'T', repo: 'fleet', depends_on: [{ id: 'x', type: 'invalid' }] }`, assert error.

- [x] 1.5 Add tests for `parseCreateWorkflowArgs` in the same file:
  - "accepts a valid workflow template" — verify name, description, and steps are returned.
  - "throws when name is missing" — call with `{ description: 'd', steps: [] }`, assert error.
  - "throws when steps is empty" — call with `{ name: 'n', description: 'd', steps: [] }`, assert error (schema enforces `min(1)`).
  - "throws when a step is missing repo" — call with a template whose first step omits `repo`, assert error.

## 2. T-63 — Narrow `sprint:update` patch type to `SprintTaskPatch`

- [x] 2.1 In `src/shared/types/task-types.ts`, after `GENERAL_PATCH_FIELDS`, define and export `SprintTaskPatch` as:
  ```ts
  export type SprintTaskPatch = Partial<Pick<SprintTask,
    'title' | 'prompt' | 'repo' | 'spec' | 'notes' | 'priority' |
    'template_name' | 'playground_enabled' | 'max_runtime_ms' | 'model' | 'max_cost_usd'
  >>
  ```
  Use the snake_case field names from `SprintTask` that correspond to the camelCase keys in `GENERAL_PATCH_FIELDS`. (Verify the exact field names in `SprintTask` — use `template_name`, `playground_enabled`, `max_runtime_ms`, `model`, `max_cost_usd`.)

- [x] 2.2 In `src/shared/types/index.ts`, add `SprintTaskPatch` to the export list for `task-types`.

- [x] 2.3 In `src/shared/ipc-channels/sprint-channels.ts`, import `SprintTaskPatch` from `'../types'`. Change the `sprint:update` channel `args` from `[id: string, patch: Record<string, unknown>]` to `[id: string, patch: SprintTaskPatch]`.

- [x] 2.4 Run `npm run typecheck` and fix any call sites in the renderer that now receive a type error on the `patch` argument. Expected sites: any `window.api.sprint.update(id, patch)` call where `patch` was typed as `Record<string, unknown>` or a broader object. Narrow the type or add an explicit `satisfies SprintTaskPatch` check at each call site.

## 3. T-25 — Validate all `BatchImportTask` fields in `parseBatchImportArgs`

- [x] 3.1 In `src/main/handlers/sprint-ipc-schemas.ts` (created in task 1.1), add and export `BatchImportTaskSchema`:
  ```ts
  export const BatchImportTaskSchema = z.object({
    title: z.string().min(1),
    repo: z.string().min(1),
    prompt: z.string().optional(),
    spec: z.string().optional(),
    status: z.string().optional(),
    dependsOnIndices: z.array(z.number().int().min(0)).optional(),
    depType: z.enum(['hard', 'soft']).optional(),
    playgroundEnabled: z.boolean().optional(),
    model: z.string().optional(),
    tags: z.array(z.string().min(1)).optional(),
    priority: z.number().int().min(0).max(10).optional(),
    templateName: z.string().optional(),
  })
  ```

- [x] 3.2 In `src/main/handlers/sprint-batch-handlers.ts`, import `BatchImportTaskSchema` from `./sprint-ipc-schemas`. In `parseBatchImportArgs`, replace the manual per-element `title`/`repo` checks with a call to `BatchImportTaskSchema.parse(item)` inside the `tasks.forEach` loop. If parse throws, re-throw with the element index: `throw new Error(\`tasks[${i}]: ${err.message}\`)`. Return `[tasks as unknown as BatchImportTask[]]` — after per-element Zod parsing the cast is safe (every element satisfies the interface). Alternatively, return `[tasks.map(item => BatchImportTaskSchema.parse(item)) as BatchImportTask[]]` to avoid the cast entirely.

- [x] 3.3 In `src/main/handlers/__tests__/sprint-batch-parse.test.ts` (new file), add tests for `parseBatchImportArgs`:
  - "accepts a minimal valid array (title + repo only)" — verify return.
  - "accepts an element with all optional fields populated" — spot-check `depType`, `playgroundEnabled`, `tags`.
  - "throws when an element has an invalid depType" — pass `depType: 'weak'`, assert error message includes element index.
  - "throws when an element has a non-integer priority" — pass `priority: 1.5`, assert error.
  - "throws when an element has a non-boolean playgroundEnabled" — pass `playgroundEnabled: 'yes'`, assert error.

## 4. T-50 — Remove `@ts-ignore` from the non-context-isolated preload branch

- [x] 4.1 In `src/preload/index.ts`, locate the `else` branch at line ~252:
  ```ts
  } else {
    // @ts-ignore (define in dts)
    window.api = api
  }
  ```
  Replace with:
  ```ts
  } else {
    (window as unknown as { api: typeof api }).api = api
  }
  ```
  Remove the `// @ts-ignore` comment and the `// (define in dts)` comment. The cast is self-documenting.

- [x] 4.2 Run `npm run typecheck` to verify zero errors introduced by this change.

- [x] 4.3 Run `npm run lint` to verify no lint errors (ESLint rules may flag `@ts-ignore` — their absence should not cause a new error).
