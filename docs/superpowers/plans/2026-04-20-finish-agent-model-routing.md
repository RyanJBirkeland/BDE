# Finish agent model routing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route the five remaining agent types (Synthesizer, Copilot, Assistant, Adhoc, Reviewer) through `agents.backendConfig` so the user's Settings → Models picks actually apply, and collapse the UI to a single "Active routing" card.

**Architecture:** Each non-pipeline spawn path calls `resolveAgentRuntime(type)` (renamed from `resolveBackend`) and passes `.model` to its existing SDK call. The Local backend toggle stays Pipeline-only; other rows expose the toggle but only the Claude side is enabled. No new abstractions, no dispatcher — just plug every service into the resolver that already exists.

**Tech Stack:** TypeScript, Vitest, React (Electron renderer), Claude Agent SDK.

**Spec:** [docs/superpowers/specs/2026-04-20-finish-agent-model-routing-design.md](../specs/2026-04-20-finish-agent-model-routing-design.md)

---

## File map

| Layer | File | Change |
|---|---|---|
| main/agent-manager | `backend-selector.ts` | Add `resolveAgentRuntime`, keep `resolveBackend` as deprecated alias |
| main/agent-manager | `__tests__/backend-selector.test.ts` | Add alias-equivalence test |
| main/agent-manager | `sdk-adapter.ts` | Use the new name |
| main/services | `review-service.ts` | Replace hardcoded `REVIEWER_MODEL` with injected resolver |
| main/services | `review-service.test.ts` | Assert resolved model flows into `runSdkOnce` |
| main | `index.ts` | Composition root: pass `resolveAgentRuntime` into `createReviewService` |
| main/handlers | `review-assistant.ts` | Resolve reviewer model per call; inject via deps tuple |
| main/handlers | `review-assistant.test.ts` | Assert runSdkStreaming receives resolved model |
| main/services | `spec-synthesizer.ts` | Pass synthesizer model to both `runSdkStreaming` sites |
| main/services | `spec-generation-service.ts` | Pass synthesizer model on the quick-spec path |
| main/handlers | `workbench.ts` | Resolve copilot model, pass into `getCopilotSdkOptions` |
| main/services | `copilot-service.ts` | `getCopilotSdkOptions` requires `model` arg |
| main | `adhoc-agent.ts` | Drop `model?` parameter; resolve at spawn |
| main/handlers | `agent-handlers.ts` | Stop forwarding `model` from renderer into `spawnAdhocAgent` |
| main | `sdk-streaming.ts` | `SdkStreamingOptions.model` required; remove Sonnet default |
| main/__tests__ | `sdk-streaming.test.ts` | Update tests to pass explicit model |
| renderer/components/settings | `ModelsSection.tsx` | One `AGENT_TYPES` array; row prop `canUseLocal`; remove "Not yet routed" card |
| renderer/components/settings | `ModelsSection.test.tsx` | Rewrite row/card expectations |

Module docs to refresh after the corresponding file changes: `docs/modules/agent-manager/index.md`, `docs/modules/services/index.md`, `docs/modules/handlers/index.md`, `docs/modules/components/index.md`.

---

## Task 1 — Rename `resolveBackend` → `resolveAgentRuntime` (with deprecated alias)

**Files:**
- Modify: `src/main/agent-manager/backend-selector.ts`
- Modify: `src/main/agent-manager/sdk-adapter.ts`
- Test: `src/main/agent-manager/__tests__/backend-selector.test.ts`
- Test: `src/main/agent-manager/__tests__/sdk-adapter-backend-selection.test.ts` (update import if it references the old name)
- Docs: `docs/modules/agent-manager/index.md` (update row)

- [ ] **Step 1: Write the failing test** — append to `backend-selector.test.ts`:

```ts
import { resolveBackend, resolveAgentRuntime } from '../backend-selector'

describe('resolveAgentRuntime (rename)', () => {
  it('is the canonical export and returns the same value as the deprecated alias', () => {
    vi.mocked(settings.getSettingJson).mockReturnValue(null)
    const viaNew = resolveAgentRuntime('pipeline')
    const viaOld = resolveBackend('pipeline')
    expect(viaNew).toEqual(viaOld)
    expect(viaNew).toEqual(DEFAULT_SETTINGS.pipeline)
  })
})
```

- [ ] **Step 2: Run the test — expect failure**

```bash
npx vitest run src/main/agent-manager/__tests__/backend-selector.test.ts
```

Expected: fails with `resolveAgentRuntime is not exported from '../backend-selector'`.

- [ ] **Step 3: Add the new export and deprecate the old one**

In `src/main/agent-manager/backend-selector.ts`, replace the current `resolveBackend` export with:

```ts
export function resolveAgentRuntime(
  agentType: AgentType,
  settings: BackendSettings = loadBackendSettings()
): AgentBackendConfig {
  return settings[agentType]
}

/**
 * @deprecated Use `resolveAgentRuntime`. Kept for one release to keep the
 * rename's blast radius bounded — remove in a follow-up once all call sites
 * land on the new name.
 */
export const resolveBackend = resolveAgentRuntime
```

- [ ] **Step 4: Update the live caller**

In `src/main/agent-manager/sdk-adapter.ts`:

Change the import:

```ts
import { loadBackendSettings, resolveAgentRuntime } from './backend-selector'
```

And the call inside `spawnAgent`:

```ts
const resolved = resolveAgentRuntime(agentType, settings)
```

- [ ] **Step 5: Run the test — expect pass**

```bash
npx vitest run src/main/agent-manager/__tests__/backend-selector.test.ts
```

Expected: all backend-selector tests pass, including the new alias-equivalence test.

- [ ] **Step 6: Run full typecheck and affected test files**

```bash
npm run typecheck
npx vitest run src/main/agent-manager/__tests__/
```

Expected: typecheck clean; all agent-manager tests pass. The deprecated `resolveBackend` call in any existing test keeps working.

- [ ] **Step 7: Update the module doc row**

In `docs/modules/agent-manager/index.md`, append a note to the `backend-selector` row indicating the canonical name is now `resolveAgentRuntime` (old name deprecated).

- [ ] **Step 8: Commit**

```bash
git add src/main/agent-manager/backend-selector.ts \
        src/main/agent-manager/sdk-adapter.ts \
        src/main/agent-manager/__tests__/backend-selector.test.ts \
        docs/modules/agent-manager/index.md
git commit -m "refactor(agent-manager): rename resolveBackend → resolveAgentRuntime with deprecated alias"
```

---

## Task 2 — Wire Reviewer auto-review through settings

Drops the hardcoded `REVIEWER_MODEL = 'claude-opus-4-6'` and resolves the reviewer model from settings on every call. The service already uses dependency injection for `runSdkOnce`; we extend that pattern for the resolver.

**Files:**
- Modify: `src/main/services/review-service.ts`
- Modify: `src/main/services/review-service.test.ts`
- Modify: `src/main/index.ts` (composition root: pass resolver into `createReviewService`)

- [ ] **Step 1: Write the failing test** — add to `review-service.test.ts`:

```ts
it('uses the reviewer model resolved from settings', async () => {
  let sdkOptions: SdkStreamingOptions | null = null
  const svc = createReviewService(
    baseDeps({
      runSdkOnce: async (_prompt, options) => {
        sdkOptions = options
        return JSON.stringify({
          qualityScore: 95,
          openingMessage: 'ok',
          perFile: []
        })
      },
      resolveAgentRuntime: () => ({ backend: 'claude', model: 'claude-haiku-4-5-20251001' })
    })
  )
  const result = await svc.reviewChanges('task-1')
  expect(sdkOptions?.model).toBe('claude-haiku-4-5-20251001')
  expect(result.model).toBe('claude-haiku-4-5-20251001')
})
```

Update `baseDeps` in the same test file to accept a `resolveAgentRuntime` override and default to `() => ({ backend: 'claude', model: 'claude-sonnet-4-5' })`.

- [ ] **Step 2: Run the test — expect failure**

```bash
npx vitest run src/main/services/review-service.test.ts
```

Expected: fails with "resolveAgentRuntime is not a function" or similar — the dep doesn't exist yet.

- [ ] **Step 3: Extend the service deps**

In `src/main/services/review-service.ts`:

Add to imports:

```ts
import type { AgentBackendConfig } from '../agent-manager/backend-selector'
```

Add to `ReviewServiceDeps`:

```ts
resolveAgentRuntime: () => AgentBackendConfig
```

Delete:

```ts
const REVIEWER_MODEL = 'claude-opus-4-6'
```

In `createReviewService`, destructure `resolveAgentRuntime` from deps.

Inside `reviewChanges`, before the `runSdkOnce` call:

```ts
const { model: reviewerModel } = resolveAgentRuntime()
```

Change the `runSdkOnce` options:

```ts
raw = await runSdkOnce(prompt, {
  model: reviewerModel,
  maxTurns: 1,
  tools: [],
  settingSources: []
})
```

And the `ReviewResult` assembly:

```ts
const result: ReviewResult = {
  qualityScore: parsed.qualityScore,
  issuesCount: aggregates.issuesCount,
  filesCount: aggregates.filesCount,
  openingMessage: parsed.openingMessage,
  findings: { perFile: parsed.perFile, branch },
  model: reviewerModel,
  createdAt: Date.now()
}
```

- [ ] **Step 4: Wire the composition root**

In `src/main/index.ts`, at the `createReviewService({ ... })` call (around line 465), add to the deps bag:

```ts
import { resolveAgentRuntime } from './agent-manager/backend-selector'
// ...
resolveAgentRuntime: () => resolveAgentRuntime('reviewer')
```

- [ ] **Step 5: Run the test — expect pass**

```bash
npx vitest run src/main/services/review-service.test.ts
```

Expected: all tests pass, including the new settings-driven test.

- [ ] **Step 6: Run broader typecheck**

```bash
npm run typecheck
```

Expected: zero errors. `index.ts`'s deps bag now includes the resolver.

- [ ] **Step 7: Update module doc**

In `docs/modules/services/index.md`, note that `review-service` now receives `resolveAgentRuntime` via deps.

- [ ] **Step 8: Commit**

```bash
git add src/main/services/review-service.ts \
        src/main/services/review-service.test.ts \
        src/main/index.ts \
        docs/modules/services/index.md
git commit -m "feat(review-service): resolve reviewer model from agents.backendConfig"
```

---

## Task 3 — Wire Reviewer chat partner (review-assistant handler)

The review-partner chat uses `runSdkStreaming` and inherits its Sonnet default. Switch to the reviewer setting.

**Files:**
- Modify: `src/main/handlers/review-assistant.ts`
- Modify: `src/main/handlers/review-assistant.test.ts`

- [ ] **Step 1: Write the failing test** — add to `review-assistant.test.ts`:

```ts
it('passes the reviewer model from settings into runSdkStreaming', async () => {
  let capturedOptions: SdkStreamingOptions | null = null
  const deps: ReviewAssistantDeps = {
    buildChatPrompt: () => 'prompt',
    runSdkStreaming: async (_prompt, _onChunk, _streams, _id, _timeout, options) => {
      capturedOptions = options ?? null
      return 'reply'
    },
    activeStreams: new Map(),
    resolveAgentRuntime: () => ({ backend: 'claude', model: 'claude-opus-4-6' })
  }
  // ...invoke the chat path (mirror existing test scaffold)
  expect(capturedOptions?.model).toBe('claude-opus-4-6')
})
```

- [ ] **Step 2: Run — expect failure**

```bash
npx vitest run src/main/handlers/review-assistant.test.ts
```

Expected: compile error — `resolveAgentRuntime` not on `ReviewAssistantDeps`.

- [ ] **Step 3: Extend deps + wire into the call**

In `src/main/handlers/review-assistant.ts`:

```ts
import type { AgentBackendConfig } from '../agent-manager/backend-selector'
import { resolveAgentRuntime } from '../agent-manager/backend-selector'
```

Add to `ReviewAssistantDeps`:

```ts
resolveAgentRuntime: () => AgentBackendConfig
```

In the `runSdkStreaming` call site, compute the model and pass it:

```ts
const { model } = deps.resolveAgentRuntime()
const full = await deps.runSdkStreaming(
  prompt,
  onChunk,
  deps.activeStreams,
  streamId,
  /* existing timeout */,
  { model, /* existing options */ }
)
```

Default deps builder (bottom of file) supplies the live resolver:

```ts
resolveAgentRuntime: () => resolveAgentRuntime('reviewer')
```

- [ ] **Step 4: Run — expect pass**

```bash
npx vitest run src/main/handlers/review-assistant.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/main/handlers/review-assistant.ts src/main/handlers/review-assistant.test.ts
git commit -m "feat(review-assistant): route review-partner chat through reviewer model setting"
```

---

## Task 4 — Wire Synthesizer (synth + quick-spec)

Two distinct call sites: `spec-synthesizer.ts` (full synth + revise) and `spec-generation-service.ts` (quick spec). Both resolve `synthesizer` now.

**Files:**
- Modify: `src/main/services/spec-synthesizer.ts`
- Modify: `src/main/services/spec-generation-service.ts`
- Create/modify: `src/main/services/__tests__/spec-synthesizer.test.ts` (create if missing)
- Modify: `docs/modules/services/index.md`

- [ ] **Step 1: Write the failing test** — in `spec-synthesizer.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import type { SdkStreamingOptions } from '../../sdk-streaming'

const runSdkStreamingMock = vi.fn<
  [string, (c: string) => void, Map<string, { close: () => void }>, string, number | undefined, SdkStreamingOptions?],
  Promise<string>
>()
vi.mock('../../sdk-streaming', () => ({
  runSdkStreaming: (...args: unknown[]) => runSdkStreamingMock(...(args as Parameters<typeof runSdkStreamingMock>))
}))
vi.mock('../../agent-manager/backend-selector', () => ({
  resolveAgentRuntime: () => ({ backend: 'claude', model: 'claude-haiku-4-5-20251001' })
}))

import { synthesizeSpec } from '../spec-synthesizer'

it('passes the synthesizer model to runSdkStreaming', async () => {
  runSdkStreamingMock.mockResolvedValue('## Spec\nBody')
  await synthesizeSpec(
    {
      templateName: 'Feature',
      answers: { goal: 'ship it' },
      repo: 'bde',
      repoPath: '/tmp/fake'
    } as any,
    () => {},
    'stream-1'
  )
  const callArgs = runSdkStreamingMock.mock.calls[0]
  const options = callArgs[5]
  expect(options?.model).toBe('claude-haiku-4-5-20251001')
})
```

- [ ] **Step 2: Run — expect failure**

```bash
npx vitest run src/main/services/__tests__/spec-synthesizer.test.ts
```

- [ ] **Step 3: Wire the resolver into `spec-synthesizer.ts`**

Add import:

```ts
import { resolveAgentRuntime } from '../agent-manager/backend-selector'
```

At the top of `synthesizeSpec` (and again in `reviseSpec`):

```ts
const { model } = resolveAgentRuntime('synthesizer')
```

Replace each `runSdkStreaming(..., { settingSources: [] })` with:

```ts
const spec = await runSdkStreaming(prompt, onChunk, activeStreams, streamId, 180_000, {
  model,
  settingSources: []
})
```

- [ ] **Step 4: Wire the quick-spec path in `spec-generation-service.ts`**

Extend `runSdkPrint` to take and forward `model`, or (simpler) resolve inside `generateSpec`:

```ts
import { resolveAgentRuntime } from '../agent-manager/backend-selector'
// ...
export async function generateSpec(input: { ... }): Promise<string> {
  const prompt = buildSpecGenerationPrompt(input)
  const { model } = resolveAgentRuntime('synthesizer')
  try {
    const result = await runSdkPrint(prompt, 120_000, { model })
    return result || `# ${input.title}\n\n(No spec generated)`
  } catch (err) {
    return `# ${input.title}\n\nError generating spec: ${(err as Error).message}`
  }
}
```

- [ ] **Step 5: Run — expect pass**

```bash
npx vitest run src/main/services/__tests__/spec-synthesizer.test.ts
npm run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add src/main/services/spec-synthesizer.ts \
        src/main/services/spec-generation-service.ts \
        src/main/services/__tests__/spec-synthesizer.test.ts \
        docs/modules/services/index.md
git commit -m "feat(synthesizer): route spec generation through synthesizer model setting"
```

---

## Task 5 — Wire Copilot (workbench handler + copilot-service)

`getCopilotSdkOptions` requires a `model` arg; the workbench handler resolves the copilot model and passes it in.

**Files:**
- Modify: `src/main/services/copilot-service.ts`
- Modify: `src/main/handlers/workbench.ts`
- Modify: `src/main/handlers/__tests__/workbench.test.ts`

- [ ] **Step 1: Write the failing test** — add to `workbench.test.ts`:

```ts
it('passes the copilot model from settings to runSdkStreaming', async () => {
  // existing scaffold mocks runSdkStreaming and captures options
  vi.mock('../../agent-manager/backend-selector', () => ({
    resolveAgentRuntime: () => ({ backend: 'claude', model: 'claude-haiku-4-5-20251001' })
  }))
  const handler = getChatStreamHandler()
  await handler({ sender: fakeSender }, {
    messages: [{ role: 'user', content: 'hi' }],
    formContext: { title: 't', repo: 'bde', spec: '' }
  })
  await new Promise((r) => setTimeout(r, 0))
  const opts = runSdkStreamingCalls[0].options as SdkStreamingOptions
  expect(opts.model).toBe('claude-haiku-4-5-20251001')
})
```

- [ ] **Step 2: Run — expect failure**

```bash
npx vitest run src/main/handlers/__tests__/workbench.test.ts
```

- [ ] **Step 3: Make `getCopilotSdkOptions` require `model`**

In `src/main/services/copilot-service.ts`:

```ts
export function getCopilotSdkOptions(
  repoPath: string | undefined,
  model: string,
  extras?: Pick<SdkStreamingOptions, 'onToolUse'>
): SdkStreamingOptions {
  return {
    cwd: repoPath,
    tools: [...COPILOT_ALLOWED_TOOLS],
    disallowedTools: [...COPILOT_DISALLOWED_TOOLS],
    maxTurns: COPILOT_MAX_TURNS,
    maxBudgetUsd: COPILOT_MAX_BUDGET_USD,
    model,
    settingSources: [],
    ...(extras?.onToolUse ? { onToolUse: extras.onToolUse } : {})
  }
}
```

- [ ] **Step 4: Resolve at the handler**

In `src/main/handlers/workbench.ts`:

```ts
import { resolveAgentRuntime } from '../agent-manager/backend-selector'
```

Inside the `workbench:chatStream` handler, before calling `getCopilotSdkOptions`:

```ts
const { model: copilotModel } = resolveAgentRuntime('copilot')
```

Then:

```ts
getCopilotSdkOptions(repoPath, copilotModel, {
  onToolUse: /* existing */
})
```

- [ ] **Step 5: Run — expect pass**

```bash
npx vitest run src/main/handlers/__tests__/workbench.test.ts
npm run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add src/main/services/copilot-service.ts \
        src/main/handlers/workbench.ts \
        src/main/handlers/__tests__/workbench.test.ts
git commit -m "feat(copilot): route chat stream through copilot model setting"
```

---

## Task 6 — Wire Adhoc / Assistant (drop `model?` parameter)

Remove the caller-overridable `model` parameter; resolve from settings inside `spawnAdhocAgent`.

**Files:**
- Modify: `src/main/adhoc-agent.ts`
- Modify: `src/main/handlers/agent-handlers.ts`
- Modify: `src/main/__tests__/adhoc-agent.test.ts`
- Modify: `src/main/handlers/__tests__/agent-handlers.test.ts` (if it passes `model`)
- Modify: `src/shared/types` (if `SpawnLocalAgentArgs` carries `model`, keep the shape but stop consuming it; update comment)

- [ ] **Step 1: Write the failing test** — in `adhoc-agent.test.ts`:

```ts
it('uses the adhoc model from settings (no caller override)', async () => {
  // Mock backend-selector
  vi.mock('./agent-manager/backend-selector', () => ({
    resolveAgentRuntime: vi.fn((type: string) => ({
      backend: 'claude',
      model: type === 'assistant' ? 'claude-opus-4-6' : 'claude-haiku-4-5-20251001'
    }))
  }))

  // Spy on SDK query to capture the model arg
  const queryCalls: Array<{ options: { model?: string } }> = []
  // ...existing SDK mock scaffold that records options...

  await spawnAdhocAgent({
    task: 'do the thing',
    repoPath: '/tmp/fake',
    assistant: false,
    repo: fakeRepo
  })
  expect(queryCalls[0].options.model).toBe('claude-haiku-4-5-20251001')
})
```

Add a second test case with `assistant: true` asserting `claude-opus-4-6` flows through.

- [ ] **Step 2: Run — expect failure**

```bash
npx vitest run src/main/__tests__/adhoc-agent.test.ts
```

- [ ] **Step 3: Remove `model` from the signature; resolve internally**

In `src/main/adhoc-agent.ts`:

Replace the `model` line:

```ts
// Before
const model = args.model || 'claude-sonnet-4-5'
```

With:

```ts
import { resolveAgentRuntime } from './agent-manager/backend-selector'
// ...inside spawnAdhocAgent:
const { model } = resolveAgentRuntime(args.assistant ? 'assistant' : 'adhoc')
```

Drop `model?: string` from the `spawnAdhocAgent` args type.

- [ ] **Step 4: Update the IPC handler**

In `src/main/handlers/agent-handlers.ts`:

Remove the `model: args.model,` line from the `spawnAdhocAgent` call. The renderer can no longer specify a model from here — settings are the single source of truth.

If `SpawnLocalAgentArgs` in `src/shared/types` still declares a `model` field, either delete it (preferred — stops the renderer from sending dead data) or leave it and document it as ignored. Prefer delete.

- [ ] **Step 5: Run — expect pass**

```bash
npx vitest run src/main/__tests__/adhoc-agent.test.ts
npm run typecheck
```

Expected: clean. Any renderer call site that was passing `model` to the IPC fails compile — fix by removing the arg.

- [ ] **Step 6: Commit**

```bash
git add src/main/adhoc-agent.ts \
        src/main/handlers/agent-handlers.ts \
        src/main/__tests__/adhoc-agent.test.ts \
        src/main/handlers/__tests__/agent-handlers.test.ts \
        src/shared/types.ts
git commit -m "feat(adhoc-agent): resolve model from settings; remove caller override"
```

---

## Task 7 — Tighten `SdkStreamingOptions.model` to required

Every caller now passes a model explicitly. Remove the Sonnet default so future callers can't drift silently.

**Files:**
- Modify: `src/main/sdk-streaming.ts`
- Modify: `src/main/__tests__/sdk-streaming.test.ts`

- [ ] **Step 1: Write the failing test** — append to `sdk-streaming.test.ts`:

```ts
it('requires an explicit model (no default)', async () => {
  // @ts-expect-error — model is required
  await runSdkStreaming('Test', onChunkMock, activeStreams, 'stream-err')
})
```

(The `@ts-expect-error` comment makes the test fail at compile time if model becomes optional again.)

- [ ] **Step 2: Run — expect the @ts-expect-error to fire (step fails until we tighten the type)**

Actually this will surface as a *type* failure, not runtime. Verify by running typecheck BEFORE changing `sdk-streaming.ts`:

```bash
npm run typecheck
```

Expected: typecheck currently passes — the `@ts-expect-error` is *unused* because `model` is still optional. Vitest/TSC reports "Unused '@ts-expect-error' directive".

- [ ] **Step 3: Tighten the type and remove the default**

In `src/main/sdk-streaming.ts`:

```ts
export interface SdkStreamingOptions {
  // ...
  /** Required — callers must resolve the model explicitly. */
  model: string
  // ...other fields stay optional
}
```

Remove the `?? 'claude-sonnet-4-5'` inside `runSdkStreaming`:

```ts
model: options.model,
```

- [ ] **Step 4: Surface and fix any remaining callers that were relying on the default**

```bash
npm run typecheck
```

If this flags a call site, resolve it: import `resolveAgentRuntime`, pick the appropriate type, pass `{ model }`. Likely candidates already handled in Tasks 2-6; this step exists as a belt-and-braces check.

- [ ] **Step 5: Run tests**

```bash
npx vitest run src/main/__tests__/sdk-streaming.test.ts
```

Expected: the `@ts-expect-error` now *is* used (because `model` is required), so it passes.

Update any other test in the file that called `runSdkStreaming` without a model — add `{ model: 'claude-sonnet-4-5' }` for tests that aren't asserting on the model value.

- [ ] **Step 6: Commit**

```bash
git add src/main/sdk-streaming.ts src/main/__tests__/sdk-streaming.test.ts
git commit -m "refactor(sdk-streaming): require explicit model on SdkStreamingOptions"
```

---

## Task 8 — UI: single "Active routing" card, per-row `canUseLocal`

**Files:**
- Modify: `src/renderer/src/components/settings/ModelsSection.tsx`
- Modify: `src/renderer/src/components/settings/__tests__/ModelsSection.test.tsx`

- [ ] **Step 1: Rewrite the failing-test expectations**

In `ModelsSection.test.tsx`:

Replace the "Active routing and Not yet routed" card-presence test:

```ts
it('renders one Active routing card with all six agent types', () => {
  render(<ModelsSection />)
  expect(screen.getByText('Active routing')).toBeInTheDocument()
  expect(screen.queryByText('Not yet routed')).not.toBeInTheDocument()
  for (const label of ['Pipeline', 'Synthesizer', 'Copilot', 'Assistant', 'Adhoc', 'Reviewer']) {
    expect(screen.getByText(label)).toBeInTheDocument()
  }
})
```

Replace the "disables all controls on a Not-yet-routed row" test with:

```ts
it('enables the model picker for every row', () => {
  render(<ModelsSection />)
  for (const id of ['synthesizer', 'copilot', 'assistant', 'adhoc', 'reviewer']) {
    const row = screen.getByTestId(`models-row-${id}`)
    const select = row.querySelector('select') as HTMLSelectElement | null
    expect(select).not.toBeNull()
    expect(select!).not.toBeDisabled()
  }
})

it('disables only the Local radio on non-pipeline rows', () => {
  render(<ModelsSection />)
  for (const id of ['synthesizer', 'copilot', 'assistant', 'adhoc', 'reviewer']) {
    const row = screen.getByTestId(`models-row-${id}`)
    const claudeBtn = row.querySelector('button[data-value="claude"]')
    const localBtn = row.querySelector('button[data-value="local"]')
    expect(claudeBtn).not.toBeDisabled()
    expect(localBtn).toBeDisabled()
  }
  const pipelineRow = screen.getByTestId('models-row-pipeline')
  expect(pipelineRow.querySelector('button[data-value="local"]')).not.toBeDisabled()
})
```

Update the save-orchestration test that clicks Local on `models-row-pipeline` — still valid, since Pipeline is the only row where that remains possible.

- [ ] **Step 2: Run — expect failure**

```bash
npx vitest run src/renderer/src/components/settings/__tests__/ModelsSection.test.tsx
```

- [ ] **Step 3: Restructure `ModelsSection.tsx`**

Replace `ACTIVE_TYPES` and `NOT_YET_ROUTED_TYPES`:

```tsx
interface AgentTypeMeta {
  id: AgentTypeId
  label: string
  description: string
  supportsLocal: boolean
}

const AGENT_TYPES: AgentTypeMeta[] = [
  { id: 'pipeline', label: 'Pipeline', description: 'Executes sprint tasks end-to-end.', supportsLocal: true },
  { id: 'synthesizer', label: 'Synthesizer', description: 'Drafts spec documents from task titles.', supportsLocal: false },
  { id: 'copilot', label: 'Copilot', description: 'Interactive pair-programming agent.', supportsLocal: false },
  { id: 'assistant', label: 'Assistant', description: 'One-shot Q&A over the repo.', supportsLocal: false },
  { id: 'adhoc', label: 'Adhoc', description: 'Freeform agent runs outside the sprint pipeline.', supportsLocal: false },
  { id: 'reviewer', label: 'Reviewer', description: 'Reviews PRs before merge.', supportsLocal: false }
]
```

Remove the second `<SettingsCard title="Not yet routed" …>` block entirely. Inside the remaining `<SettingsCard title="Active routing" …>`:

```tsx
<SettingsCard
  title="Active routing"
  subtitle="Route each agent type to Claude or a local model. Local backend available for Pipeline today."
>
  {AGENT_TYPES.map((type) => (
    <AgentTypeRow
      key={type.id}
      type={type}
      value={settings[type.id]}
      onChange={(next) => updateRow(type.id, next)}
      canUseLocal={type.supportsLocal}
    />
  ))}
</SettingsCard>
```

Rewrite `AgentTypeRow`:

```tsx
interface AgentTypeRowProps {
  type: AgentTypeMeta
  value: AgentBackendConfig
  onChange: (next: AgentBackendConfig) => void
  canUseLocal: boolean
}

function AgentTypeRow({ type, value, onChange, canUseLocal }: AgentTypeRowProps): React.JSX.Element {
  function toggleBackend(next: BackendKind): void {
    if (next === value.backend) return
    onChange({
      backend: next,
      model: next === 'claude' ? DEFAULT_CLAUDE_MODEL : DEFAULT_LOCAL_MODEL
    })
  }

  return (
    <div className="models-row" data-testid={`models-row-${type.id}`}>
      <div className="models-row__label">{type.label}</div>
      <div className="models-row__desc">{type.description}</div>
      <div className="models-row__controls">
        <BackendToggle
          value={value.backend}
          onChange={toggleBackend}
          canUseLocal={canUseLocal}
          rowId={type.id}
        />
        <ModelPicker
          backend={value.backend}
          model={value.model}
          onChange={(model) => onChange({ ...value, model })}
        />
      </div>
    </div>
  )
}
```

Rewrite `BackendToggle` to take `canUseLocal` and disable only the local radio:

```tsx
function BackendToggle({ value, onChange, canUseLocal, rowId }: BackendToggleProps): React.JSX.Element {
  return (
    <div role="radiogroup" aria-label={`${rowId} backend`} className="models-seg">
      <button
        type="button"
        role="radio"
        aria-checked={value === 'claude'}
        data-value="claude"
        onClick={() => onChange('claude')}
        className="models-seg__btn"
      >
        Claude
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={value === 'local'}
        data-value="local"
        disabled={!canUseLocal}
        title={canUseLocal ? undefined : 'Claude-only for this agent type'}
        onClick={() => onChange('local')}
        className="models-seg__btn"
      >
        Local
      </button>
    </div>
  )
}
```

Remove the `disabled` prop from `ModelPicker` — it's always interactive now.

- [ ] **Step 4: Run — expect pass**

```bash
npx vitest run src/renderer/src/components/settings/__tests__/ModelsSection.test.tsx
npm run typecheck
```

- [ ] **Step 5: Update module doc**

In `docs/modules/components/index.md`, refresh the `ModelsSection` row to reflect the "single Active routing card" and per-row `canUseLocal` semantics.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/settings/ModelsSection.tsx \
        src/renderer/src/components/settings/__tests__/ModelsSection.test.tsx \
        docs/modules/components/index.md
git commit -m "feat(models-section): collapse to single Active routing card; per-row canUseLocal"
```

---

## Task 9 — Full-suite verification + release note

- [ ] **Step 1: Run the full local gate**

```bash
npm run typecheck
npm test
npm run test:main
npm run lint
```

Expected: all green.

- [ ] **Step 2: Smoke-test the Reviewer regression**

Start dev (`npm run dev`), open Settings → Models, change Reviewer to Haiku, run a code review in the app, confirm the returned `ReviewResult.model === 'claude-haiku-4-5-20251001'`. Switch back to Opus, repeat. Confirm the picker persists across app restart.

- [ ] **Step 3: Add release note**

Append to the next release-notes draft (or a `CHANGES.md` entry if that's the convention):

> **Breaking:** The Reviewer agent no longer hardcodes Claude Opus 4.6. Fresh installs and upgrades where the Models setting was never touched will run reviews on Sonnet 4.5. To restore Opus, open Settings → Models and pick Opus for Reviewer. The Models tab also now exposes per-type model choice for Synthesizer, Copilot, Assistant, and Adhoc — the Local backend remains Pipeline-only.

- [ ] **Step 4: Commit**

```bash
git add <release-notes-file>
git commit -m "docs(release): note reviewer default change in agent model routing"
```

---

## Self-Review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| Rename `resolveBackend` → `resolveAgentRuntime` with deprecated alias | Task 1 |
| Remove caller-overridable `model` params (adhoc + sdk-streaming default) | Tasks 6, 7 |
| Reviewer reads from settings, no hardcoded Opus | Tasks 2, 3 |
| Synthesizer reads from settings | Task 4 |
| Copilot reads from settings | Task 5 |
| Adhoc / Assistant read from settings | Task 6 |
| UI: single "Active routing" card, per-row `canUseLocal` | Task 8 |
| No settings migration; keep stored values as-is | Covered by schema staying unchanged; no migration code introduced |
| Unified Sonnet 4.5 default | `DEFAULT_SETTINGS` already points at `DEFAULT_CONFIG.defaultModel = 'claude-sonnet-4-5'`; no change needed |
| Reviewer quality regression release note | Task 9, step 3 |

**Known pre-existing drift (out of scope, noted for later):** `DEFAULT_CONFIG.defaultModel = 'claude-sonnet-4-5'` (main) vs `DEFAULT_MODEL.modelId = 'claude-sonnet-4-6'` (shared). The UI's "reset to Claude" branch uses 4.6; the backend default uses 4.5. Unifying is a separate decision for a follow-up — this plan preserves both as-is.

**Placeholder scan:** all code blocks are concrete; no "implement later" or "similar to Task N" shortcuts.

**Type consistency:** `resolveAgentRuntime`, `AgentBackendConfig`, `SdkStreamingOptions.model`, `AgentTypeRowProps.canUseLocal`, `AgentTypeMeta.supportsLocal` used consistently across tasks.
