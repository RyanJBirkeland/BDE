# Models Settings Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a new "Models" tab in BDE's Settings that lets a user configure, per agent type, whether to route to Claude or a local model and which model ID to use, plus the shared local endpoint URL.

**Architecture:** One new IPC channel (`agents:testLocalEndpoint`) for the reachability check. One new renderer component (`ModelsSection`) that loads `agents.backendConfig` on mount, renders a Local-endpoint card + 6 agent-type rows (Pipeline active, the other 5 disabled as "Not yet routed"), and saves the entire `BackendSettings` object in one atomic write. Persistence is entirely unchanged — the M8 schema in `src/main/agent-manager/backend-selector.ts` already stores everything we need. One entry added to the settings sidebar.

**Tech Stack:** TypeScript, React (function components + hooks), Electron IPC (`safeHandle` / `typedInvoke`), Zustand (settings nav store), Vitest + React Testing Library, lucide-react icons, existing `SettingsCard` / `Button` UI primitives.

**Spec:** `docs/specs/models-settings-tab-spec.md` (committed as `b316ae71`, approved 2026-04-17).

---

## File Map

| File | Change |
|------|--------|
| `src/shared/ipc-channels/agent-channels.ts` | Add `agents:testLocalEndpoint` to `AgentChannels` interface |
| `src/main/handlers/agent-handlers.ts` | Register `safeHandle('agents:testLocalEndpoint', …)` |
| `src/main/handlers/__tests__/agent-handlers-test-endpoint.test.ts` | **New** — unit tests for the handler |
| `src/preload/api-agents.ts` | Add `testLocalEndpoint` to the exported `agents` object |
| `src/renderer/src/test-setup.ts` | Add `testLocalEndpoint: vi.fn()` to the mocked `window.api.agents` |
| `src/renderer/src/stores/settingsNav.ts` | Add `'models'` to the `SettingsSectionId` union |
| `src/renderer/src/components/settings/ModelsSection.tsx` | **New** — main component |
| `src/renderer/src/components/settings/ModelsSection.css` | **New** — segmented-control styles only |
| `src/renderer/src/components/settings/__tests__/ModelsSection.test.tsx` | **New** — RTL tests |
| `src/renderer/src/views/SettingsView.tsx` | Add `models` entry to `SECTIONS`, `SECTION_MAP`, `SECTION_META`; import `Network` icon |
| `src/renderer/src/components/settings/__tests__/SettingsView.test.tsx` | Add assertion that `Models` sidebar entry renders |
| `src/renderer/src/views/__tests__/SettingsView.test.tsx` | Add assertion that clicking `Models` shows the section |

---

## Task 1: Add `agents:testLocalEndpoint` IPC channel type

Adds the typed channel entry. This is pure TypeScript — no runtime code runs; compilation alone verifies the plumbing is consistent.

**Files:**
- Modify: `src/shared/ipc-channels/agent-channels.ts`

- [ ] **Step 1: Add the channel to the `AgentChannels` interface**

In `src/shared/ipc-channels/agent-channels.ts`, inside the `AgentChannels` interface (after the existing `agents:promoteToReview` entry, before `agent:latestCacheTokens`), add:

```ts
  'agents:testLocalEndpoint': {
    args: [args: { endpoint: string }]
    result:
      | { ok: true; latencyMs: number; modelCount: number }
      | { ok: false; error: string }
  }
```

The file already re-exports `AgentChannels` from `index.ts`, which is intersected into `IpcChannelMap` — no further wiring is required for the type to be visible app-wide.

- [ ] **Step 2: Run typecheck to confirm the channel type is consistent**

Run:
```bash
cd $REPO_ROOT && npm run typecheck
```

Expected: no errors. If the test-setup mock or any existing code references this channel with the wrong shape, this will surface it.

- [ ] **Step 3: Commit**

```bash
cd $REPO_ROOT
git add src/shared/ipc-channels/agent-channels.ts
git commit -m "feat(ipc): add agents:testLocalEndpoint channel type"
```

---

## Task 2: Implement the `testLocalEndpoint` handler (TDD)

Main-process handler that makes a `GET {endpoint}/models` request with a 2-second timeout and returns `{ ok, latencyMs, modelCount }` on success or `{ ok: false, error }` on any failure. Never throws across the IPC boundary.

**Files:**
- Create: `src/main/handlers/__tests__/agent-handlers-test-endpoint.test.ts`
- Modify: `src/main/handlers/agent-handlers.ts`

### Step-by-step

- [ ] **Step 1: Write the failing test file**

Create `src/main/handlers/__tests__/agent-handlers-test-endpoint.test.ts`:

```ts
/**
 * agents:testLocalEndpoint — HTTP GET {endpoint}/models with a 2s timeout.
 * Returns { ok: true, latencyMs, modelCount } on 200 with a valid body;
 * { ok: false, error: string } otherwise. Never throws.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { testLocalEndpoint } from '../agent-handlers'

const originalFetch = globalThis.fetch

describe('testLocalEndpoint', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('returns ok with modelCount for a well-formed 200 response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ id: 'qwen' }, { id: 'gemma' }, { id: 'codestral' }] })
    }) as unknown as typeof fetch

    const result = await testLocalEndpoint('http://localhost:1234/v1')

    expect(result).toEqual({
      ok: true,
      latencyMs: expect.any(Number),
      modelCount: 3
    })
  })

  it('returns an error string on a non-200 response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => ({})
    }) as unknown as typeof fetch

    const result = await testLocalEndpoint('http://localhost:1234/v1')

    expect(result).toEqual({ ok: false, error: expect.stringContaining('502') })
  })

  it('returns an error string when the body is not the expected shape', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => '<html>proxy page</html>'
    }) as unknown as typeof fetch

    const result = await testLocalEndpoint('http://localhost:1234/v1')

    expect(result).toEqual({ ok: false, error: expect.stringMatching(/shape|data/i) })
  })

  it('returns an error string on connection refusal', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(
      Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } })
    ) as unknown as typeof fetch

    const result = await testLocalEndpoint('http://localhost:1234/v1')

    expect(result).toEqual({ ok: false, error: expect.stringMatching(/ECONNREFUSED|refused/i) })
  })

  it('returns a timeout error when fetch aborts', async () => {
    globalThis.fetch = vi.fn().mockImplementation(() => {
      return Promise.reject(new DOMException('The operation was aborted.', 'AbortError'))
    }) as unknown as typeof fetch

    const result = await testLocalEndpoint('http://localhost:1234/v1')

    expect(result).toEqual({ ok: false, error: expect.stringMatching(/timeout/i) })
  })

  it('never throws — returns a structured error for unexpected throws', async () => {
    globalThis.fetch = vi.fn().mockImplementation(() => {
      throw new TypeError('invalid URL')
    }) as unknown as typeof fetch

    const result = await testLocalEndpoint('not-a-url')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(typeof result.error).toBe('string')
      expect(result.error.length).toBeGreaterThan(0)
    }
  })
})
```

- [ ] **Step 2: Run the test to confirm it fails**

Run:
```bash
cd $REPO_ROOT && npx vitest run src/main/handlers/__tests__/agent-handlers-test-endpoint.test.ts
```

Expected: FAIL — `testLocalEndpoint` is not exported from `../agent-handlers`.

- [ ] **Step 3: Add the `testLocalEndpoint` function and register the handler**

In `src/main/handlers/agent-handlers.ts`:

1. At the bottom of the imports block, ensure there are no new imports needed (the handler uses globals only).

2. Above the `registerAgentHandlers` function (but still inside the file, below the `PromoteToReviewResult` interface), add the exported implementation:

```ts
export async function testLocalEndpoint(
  endpoint: string
): Promise<
  | { ok: true; latencyMs: number; modelCount: number }
  | { ok: false; error: string }
> {
  const started = Date.now()
  try {
    const trimmed = endpoint.replace(/\/$/, '')
    const response = await fetch(`${trimmed}/models`, {
      signal: AbortSignal.timeout(2000)
    })
    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status}` }
    }
    const body = (await response.json()) as unknown
    if (
      typeof body !== 'object' ||
      body === null ||
      !Array.isArray((body as { data?: unknown }).data)
    ) {
      return { ok: false, error: 'Unexpected response shape — no data array' }
    }
    return {
      ok: true,
      latencyMs: Date.now() - started,
      modelCount: (body as { data: unknown[] }).data.length
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { ok: false, error: 'timeout after 2s' }
    }
    const cause = (err as { cause?: { code?: string } })?.cause
    if (cause?.code) {
      return { ok: false, error: cause.code }
    }
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: message }
  }
}
```

3. Inside the `registerAgentHandlers` function, after the `agents:promoteToReview` handler registration (near line 134) and before `agent:latestCacheTokens`, add:

```ts
  safeHandle('agents:testLocalEndpoint', (_e, args: { endpoint: string }) =>
    testLocalEndpoint(args.endpoint)
  )
```

- [ ] **Step 4: Run the test to confirm it passes**

Run:
```bash
cd $REPO_ROOT && npx vitest run src/main/handlers/__tests__/agent-handlers-test-endpoint.test.ts
```

Expected: PASS — all 6 tests green.

- [ ] **Step 5: Run typecheck to confirm no type drift**

Run:
```bash
cd $REPO_ROOT && npm run typecheck
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
cd $REPO_ROOT
git add src/main/handlers/agent-handlers.ts src/main/handlers/__tests__/agent-handlers-test-endpoint.test.ts
git commit -m "feat(handlers): testLocalEndpoint handler for LM Studio reachability"
```

---

## Task 3: Expose `testLocalEndpoint` on the preload

Preload wiring is a one-line addition inside the existing `agents` object. The mock in `test-setup.ts` also needs the new function so renderer tests don't see `undefined`.

**Files:**
- Modify: `src/preload/api-agents.ts`
- Modify: `src/renderer/src/test-setup.ts`

- [ ] **Step 1: Add `testLocalEndpoint` to the preload `agents` object**

In `src/preload/api-agents.ts`, inside the `export const agents = { … }` block (around line 37-48), add a new method after `promoteToReview`:

```ts
export const agents = {
  list: (args: { limit?: number; status?: string }): Promise<IpcChannelMap['agents:list']['result']> =>
    typedInvoke('agents:list', args),
  readLog: (args: { id: string; fromByte?: number }): Promise<IpcChannelMap['agents:readLog']['result']> =>
    typedInvoke('agents:readLog', args),
  import: (args: {
    meta: Partial<AgentMeta>
    content: string
  }): Promise<IpcChannelMap['agents:import']['result']> => typedInvoke('agents:import', args),
  promoteToReview: (agentId: string): Promise<IpcChannelMap['agents:promoteToReview']['result']> =>
    typedInvoke('agents:promoteToReview', agentId),
  testLocalEndpoint: (
    endpoint: string
  ): Promise<IpcChannelMap['agents:testLocalEndpoint']['result']> =>
    typedInvoke('agents:testLocalEndpoint', { endpoint })
}
```

- [ ] **Step 2: Add `testLocalEndpoint` to the renderer test-setup mock**

In `src/renderer/src/test-setup.ts`, locate the `agents: {` block (around line 177). Add `testLocalEndpoint` after `spawnLocal`:

```ts
  agents: {
    list: vi.fn().mockResolvedValue([]),
    getMeta: vi.fn().mockResolvedValue(null),
    readLog: vi.fn().mockResolvedValue({ content: '', nextByte: 0 }),
    import: vi.fn().mockResolvedValue({}),
    markDone: vi.fn().mockResolvedValue(undefined),
    getProcesses: vi.fn().mockResolvedValue([]),
    spawnLocal: vi
      .fn()
      // (existing mock body preserved)
      ,
    testLocalEndpoint: vi.fn().mockResolvedValue({ ok: true, latencyMs: 1, modelCount: 0 })
  },
```

Preserve any existing trailing fields after the current `spawnLocal` mock — only insert the new line. Read the actual block before editing to confirm ordering.

- [ ] **Step 3: Run typecheck + test suite to confirm nothing regressed**

Run:
```bash
cd $REPO_ROOT && npm run typecheck && npm test -- --run
```

Expected: typecheck clean; all 3654+ tests still passing.

- [ ] **Step 4: Commit**

```bash
cd $REPO_ROOT
git add src/preload/api-agents.ts src/renderer/src/test-setup.ts
git commit -m "feat(preload): expose agents.testLocalEndpoint"
```

---

## Task 4: Add `'models'` to `SettingsSectionId`

One-line change to the Zustand union type so later tasks can set `activeSection: 'models'` without a cast.

**Files:**
- Modify: `src/renderer/src/stores/settingsNav.ts`

- [ ] **Step 1: Add `'models'` to the union**

Replace the `SettingsSectionId` export in `src/renderer/src/stores/settingsNav.ts`:

```ts
export type SettingsSectionId =
  | 'connections'
  | 'repositories'
  | 'agents'
  | 'models'
  | 'templates'
  | 'memory'
  | 'appearance'
  | 'about'
```

- [ ] **Step 2: Typecheck**

Run:
```bash
cd $REPO_ROOT && npm run typecheck
```

Expected: no errors. (No consumer code references `'models'` yet; the union is additive.)

- [ ] **Step 3: Commit**

```bash
cd $REPO_ROOT
git add src/renderer/src/stores/settingsNav.ts
git commit -m "feat(settings-nav): add 'models' to SettingsSectionId union"
```

---

## Task 5: Scaffold `ModelsSection` with the Local-endpoint card (TDD)

First vertical slice: the component renders its heading + a shared Local-endpoint card with an endpoint text input. No agent rows yet, no save button state — just prove the component can mount, load the stored endpoint, and render it.

**Files:**
- Create: `src/renderer/src/components/settings/ModelsSection.tsx`
- Create: `src/renderer/src/components/settings/ModelsSection.css`
- Create: `src/renderer/src/components/settings/__tests__/ModelsSection.test.tsx`

### Step-by-step

- [ ] **Step 1: Write the failing test**

Create `src/renderer/src/components/settings/__tests__/ModelsSection.test.tsx`:

```tsx
/**
 * ModelsSection — per-agent-type backend + model picker UI.
 * Loads `agents.backendConfig` on mount; composes the full BackendSettings
 * object on save.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

vi.mock('../../../stores/toasts', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() }
}))

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(window.api.settings.getJson).mockResolvedValue(null)
  vi.mocked(window.api.settings.setJson).mockResolvedValue(undefined)
})

import { ModelsSection } from '../ModelsSection'

describe('ModelsSection — scaffold', () => {
  it('renders the Local backend heading', () => {
    render(<ModelsSection />)
    expect(screen.getByText('Local backend')).toBeInTheDocument()
  })

  it('renders the endpoint text input with the default placeholder', () => {
    render(<ModelsSection />)
    const input = screen.getByPlaceholderText('http://localhost:1234/v1')
    expect(input).toBeInTheDocument()
  })

  it('populates the endpoint from loaded settings', async () => {
    vi.mocked(window.api.settings.getJson).mockResolvedValue({
      pipeline: { backend: 'claude', model: 'claude-sonnet-4-5' },
      synthesizer: { backend: 'claude', model: 'claude-sonnet-4-5' },
      copilot: { backend: 'claude', model: 'claude-sonnet-4-5' },
      assistant: { backend: 'claude', model: 'claude-sonnet-4-5' },
      adhoc: { backend: 'claude', model: 'claude-sonnet-4-5' },
      reviewer: { backend: 'claude', model: 'claude-sonnet-4-5' },
      localEndpoint: 'http://localhost:9999/v1'
    })
    render(<ModelsSection />)
    await waitFor(() => {
      expect(screen.getByDisplayValue('http://localhost:9999/v1')).toBeInTheDocument()
    })
  })
})
```

- [ ] **Step 2: Run the test to confirm it fails**

Run:
```bash
cd $REPO_ROOT && npx vitest run src/renderer/src/components/settings/__tests__/ModelsSection.test.tsx
```

Expected: FAIL — cannot resolve `../ModelsSection`.

- [ ] **Step 3: Create the CSS file**

Create `src/renderer/src/components/settings/ModelsSection.css`:

```css
/* ModelsSection — segmented control for backend toggle. */
.models-seg {
  display: inline-flex;
  border: 1px solid var(--bde-border);
  border-radius: 6px;
  overflow: hidden;
}

.models-seg__btn {
  padding: 4px 12px;
  font-size: 12px;
  background: transparent;
  color: var(--bde-text-2);
  border: none;
  cursor: pointer;
}

.models-seg__btn[aria-checked='true'] {
  background: var(--bde-accent);
  color: var(--bde-text-1);
}

.models-seg__btn:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.models-row {
  padding: 10px 0;
  border-top: 1px solid var(--bde-border-subtle, var(--bde-border));
}

.models-row:first-child {
  border-top: none;
}

.models-row[aria-disabled='true'] {
  opacity: 0.55;
}

.models-row__label {
  font-weight: 600;
  font-size: 13px;
  margin-bottom: 2px;
}

.models-row__desc {
  font-size: 11px;
  color: var(--bde-text-2);
  margin-bottom: 8px;
}

.models-row__controls {
  display: flex;
  gap: 16px;
  align-items: center;
  flex-wrap: wrap;
}

.models-row__controls label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}

.models-status {
  font-size: 11px;
  margin-top: 6px;
}

.models-status--ok {
  color: var(--bde-success, #3ccf6a);
}

.models-status--err {
  color: var(--bde-danger, #e06060);
}

.models-save-row {
  display: flex;
  justify-content: flex-end;
  padding: 12px 0;
}
```

- [ ] **Step 4: Create the minimal component to pass the three scaffold tests**

Create `src/renderer/src/components/settings/ModelsSection.tsx`:

```tsx
/**
 * ModelsSection — per-agent-type backend + model routing.
 *
 * Loads the composite `agents.backendConfig` setting on mount, renders:
 *   1. a shared Local backend card (endpoint URL + test connection),
 *   2. an Active routing card (Pipeline row — the only type wired today),
 *   3. a Not yet routed card (five disabled rows for future types).
 *
 * Saves the entire BackendSettings object in one atomic setJson call.
 */
import './ModelsSection.css'
import { useEffect, useState } from 'react'
import { SettingsCard } from './SettingsCard'

const DEFAULT_LOCAL_ENDPOINT = 'http://localhost:1234/v1'

interface AgentBackendConfig {
  backend: 'claude' | 'local'
  model: string
}

interface BackendSettings {
  pipeline: AgentBackendConfig
  synthesizer: AgentBackendConfig
  copilot: AgentBackendConfig
  assistant: AgentBackendConfig
  adhoc: AgentBackendConfig
  reviewer: AgentBackendConfig
  localEndpoint: string
}

export function ModelsSection(): React.JSX.Element {
  const [localEndpoint, setLocalEndpoint] = useState(DEFAULT_LOCAL_ENDPOINT)

  useEffect(() => {
    async function load(): Promise<void> {
      const stored = (await window.api.settings.getJson(
        'agents.backendConfig'
      )) as Partial<BackendSettings> | null
      if (stored?.localEndpoint) setLocalEndpoint(stored.localEndpoint)
    }
    void load()
  }, [])

  return (
    <div className="settings-cards-list">
      <SettingsCard title="Local backend" subtitle="LM Studio, Ollama, or any OpenAI-compatible server.">
        <label className="settings-field">
          <span className="settings-field__label">Endpoint URL</span>
          <input
            className="settings-field__input"
            type="text"
            value={localEndpoint}
            onChange={(e) => setLocalEndpoint(e.target.value)}
            placeholder={DEFAULT_LOCAL_ENDPOINT}
          />
        </label>
      </SettingsCard>
    </div>
  )
}
```

- [ ] **Step 5: Run the test to confirm it passes**

Run:
```bash
cd $REPO_ROOT && npx vitest run src/renderer/src/components/settings/__tests__/ModelsSection.test.tsx
```

Expected: PASS — all 3 scaffold tests green.

- [ ] **Step 6: Commit**

```bash
cd $REPO_ROOT
git add src/renderer/src/components/settings/ModelsSection.tsx \
        src/renderer/src/components/settings/ModelsSection.css \
        src/renderer/src/components/settings/__tests__/ModelsSection.test.tsx
git commit -m "feat(settings): scaffold ModelsSection with local endpoint card"
```

---

## Task 6: Render the six agent-type rows (TDD)

Add the *Active routing* card (Pipeline only) and *Not yet routed* card (the other 5 types, disabled). Labels and descriptions come from a frozen const. No backend toggle behaviour yet — just the rendered shape.

**Files:**
- Modify: `src/renderer/src/components/settings/ModelsSection.tsx`
- Modify: `src/renderer/src/components/settings/__tests__/ModelsSection.test.tsx`

- [ ] **Step 1: Add the failing test**

Append to `src/renderer/src/components/settings/__tests__/ModelsSection.test.tsx`:

```tsx
describe('ModelsSection — agent type rows', () => {
  it('renders all six agent-type labels', () => {
    render(<ModelsSection />)
    expect(screen.getByText('Pipeline')).toBeInTheDocument()
    expect(screen.getByText('Synthesizer')).toBeInTheDocument()
    expect(screen.getByText('Copilot')).toBeInTheDocument()
    expect(screen.getByText('Assistant')).toBeInTheDocument()
    expect(screen.getByText('Adhoc')).toBeInTheDocument()
    expect(screen.getByText('Reviewer')).toBeInTheDocument()
  })

  it('marks the Pipeline row as active and the others as not-yet-routed', () => {
    render(<ModelsSection />)
    const pipelineRow = screen.getByTestId('models-row-pipeline')
    expect(pipelineRow).not.toHaveAttribute('aria-disabled', 'true')

    const synthRow = screen.getByTestId('models-row-synthesizer')
    expect(synthRow).toHaveAttribute('aria-disabled', 'true')

    const notRoutedNotes = screen.getAllByText(/Not yet routed/i)
    expect(notRoutedNotes.length).toBeGreaterThanOrEqual(5)
  })

  it('renders card headings for Active routing and Not yet routed', () => {
    render(<ModelsSection />)
    expect(screen.getByText('Active routing')).toBeInTheDocument()
    expect(screen.getByText('Not yet routed')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the test to confirm it fails**

Run:
```bash
cd $REPO_ROOT && npx vitest run src/renderer/src/components/settings/__tests__/ModelsSection.test.tsx
```

Expected: FAIL — new `describe` block fails because the rows don't exist.

- [ ] **Step 3: Add the row rendering to `ModelsSection.tsx`**

Replace the entire contents of `src/renderer/src/components/settings/ModelsSection.tsx` with:

```tsx
/**
 * ModelsSection — per-agent-type backend + model routing.
 *
 * Loads the composite `agents.backendConfig` setting on mount, renders:
 *   1. a shared Local backend card (endpoint URL + test connection),
 *   2. an Active routing card (Pipeline row — the only type wired today),
 *   3. a Not yet routed card (five disabled rows for future types).
 *
 * Saves the entire BackendSettings object in one atomic setJson call.
 */
import './ModelsSection.css'
import { useEffect, useState } from 'react'
import { SettingsCard } from './SettingsCard'

const DEFAULT_LOCAL_ENDPOINT = 'http://localhost:1234/v1'
const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-4-5'

type AgentTypeId =
  | 'pipeline'
  | 'synthesizer'
  | 'copilot'
  | 'assistant'
  | 'adhoc'
  | 'reviewer'

interface AgentTypeMeta {
  id: AgentTypeId
  label: string
  description: string
}

const ACTIVE_TYPES: AgentTypeMeta[] = [
  { id: 'pipeline', label: 'Pipeline', description: 'Executes sprint tasks end-to-end.' }
]

const NOT_YET_ROUTED_TYPES: AgentTypeMeta[] = [
  { id: 'synthesizer', label: 'Synthesizer', description: 'Drafts spec documents from task titles.' },
  { id: 'copilot', label: 'Copilot', description: 'Interactive pair-programming agent.' },
  { id: 'assistant', label: 'Assistant', description: 'One-shot Q&A over the repo.' },
  { id: 'adhoc', label: 'Adhoc', description: 'Freeform agent runs outside the sprint pipeline.' },
  { id: 'reviewer', label: 'Reviewer', description: 'Reviews PRs before merge.' }
]

interface AgentBackendConfig {
  backend: 'claude' | 'local'
  model: string
}

interface BackendSettings {
  pipeline: AgentBackendConfig
  synthesizer: AgentBackendConfig
  copilot: AgentBackendConfig
  assistant: AgentBackendConfig
  adhoc: AgentBackendConfig
  reviewer: AgentBackendConfig
  localEndpoint: string
}

const DEFAULT_ROW: AgentBackendConfig = { backend: 'claude', model: DEFAULT_CLAUDE_MODEL }

function defaultBackendSettings(): BackendSettings {
  return {
    pipeline: { ...DEFAULT_ROW },
    synthesizer: { ...DEFAULT_ROW },
    copilot: { ...DEFAULT_ROW },
    assistant: { ...DEFAULT_ROW },
    adhoc: { ...DEFAULT_ROW },
    reviewer: { ...DEFAULT_ROW },
    localEndpoint: DEFAULT_LOCAL_ENDPOINT
  }
}

export function ModelsSection(): React.JSX.Element {
  const [settings, setSettings] = useState<BackendSettings>(defaultBackendSettings)

  useEffect(() => {
    async function load(): Promise<void> {
      const stored = (await window.api.settings.getJson(
        'agents.backendConfig'
      )) as Partial<BackendSettings> | null
      if (!stored) return
      setSettings((prev) => ({ ...prev, ...stored }))
    }
    void load()
  }, [])

  return (
    <div className="settings-cards-list">
      <SettingsCard
        title="Local backend"
        subtitle="LM Studio, Ollama, or any OpenAI-compatible server."
      >
        <label className="settings-field">
          <span className="settings-field__label">Endpoint URL</span>
          <input
            className="settings-field__input"
            type="text"
            value={settings.localEndpoint}
            onChange={(e) =>
              setSettings((s) => ({ ...s, localEndpoint: e.target.value }))
            }
            placeholder={DEFAULT_LOCAL_ENDPOINT}
          />
        </label>
      </SettingsCard>

      <SettingsCard title="Active routing" subtitle="Types wired through spawnAgent today.">
        {ACTIVE_TYPES.map((type) => (
          <AgentTypeRow key={type.id} type={type} disabled={false} />
        ))}
      </SettingsCard>

      <SettingsCard
        title="Not yet routed"
        subtitle="Configuration preserved for when each type is wired through spawnAgent."
      >
        {NOT_YET_ROUTED_TYPES.map((type) => (
          <AgentTypeRow key={type.id} type={type} disabled={true} />
        ))}
      </SettingsCard>
    </div>
  )
}

interface AgentTypeRowProps {
  type: AgentTypeMeta
  disabled: boolean
}

function AgentTypeRow({ type, disabled }: AgentTypeRowProps): React.JSX.Element {
  return (
    <div
      className="models-row"
      data-testid={`models-row-${type.id}`}
      aria-disabled={disabled || undefined}
    >
      <div className="models-row__label">{type.label}</div>
      <div className="models-row__desc">{type.description}</div>
      {disabled && <div className="models-row__desc">Not yet routed.</div>}
    </div>
  )
}
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run:
```bash
cd $REPO_ROOT && npx vitest run src/renderer/src/components/settings/__tests__/ModelsSection.test.tsx
```

Expected: PASS — scaffold + row tests all green.

- [ ] **Step 5: Commit**

```bash
cd $REPO_ROOT
git add src/renderer/src/components/settings/ModelsSection.tsx \
        src/renderer/src/components/settings/__tests__/ModelsSection.test.tsx
git commit -m "feat(settings): render six agent-type rows (Pipeline active, rest disabled)"
```

---

## Task 7: Backend toggle + model picker (TDD)

Each row gets a segmented control (Claude | Local) and a conditional model picker — `<select>` for Claude, `<input type="text">` for Local. Toggling backend resets the model to that backend's default. Disabled rows render the controls but all disabled.

**Files:**
- Modify: `src/renderer/src/components/settings/ModelsSection.tsx`
- Modify: `src/renderer/src/components/settings/__tests__/ModelsSection.test.tsx`

- [ ] **Step 1: Add the failing tests**

Append to `ModelsSection.test.tsx`:

```tsx
import userEvent from '@testing-library/user-event'

describe('ModelsSection — backend toggle + model picker', () => {
  it('renders a Claude/Local segmented control on the Pipeline row', () => {
    render(<ModelsSection />)
    const pipelineRow = screen.getByTestId('models-row-pipeline')
    const claudeBtn = pipelineRow.querySelector('button[role="radio"][data-value="claude"]')
    const localBtn = pipelineRow.querySelector('button[role="radio"][data-value="local"]')
    expect(claudeBtn).toBeInTheDocument()
    expect(localBtn).toBeInTheDocument()
  })

  it('renders a Claude model select with the three known IDs by default', () => {
    render(<ModelsSection />)
    const pipelineRow = screen.getByTestId('models-row-pipeline')
    const select = pipelineRow.querySelector('select') as HTMLSelectElement
    expect(select).toBeInTheDocument()
    const options = Array.from(select.options).map((o) => o.value)
    expect(options).toEqual([
      'claude-sonnet-4-5',
      'claude-opus-4-7',
      'claude-haiku-4-5'
    ])
  })

  it('switches to a free-text input when Local is selected and resets model to empty', async () => {
    const user = userEvent.setup()
    render(<ModelsSection />)
    const pipelineRow = screen.getByTestId('models-row-pipeline')
    const localBtn = pipelineRow.querySelector(
      'button[role="radio"][data-value="local"]'
    ) as HTMLButtonElement
    await user.click(localBtn)

    await waitFor(() => {
      const input = pipelineRow.querySelector(
        'input[placeholder="openai/qwen/qwen3.6-35b-a3b"]'
      ) as HTMLInputElement
      expect(input).toBeInTheDocument()
      expect(input.value).toBe('')
    })
  })

  it('switches back to Claude resets model to claude-sonnet-4-5', async () => {
    const user = userEvent.setup()
    render(<ModelsSection />)
    const pipelineRow = screen.getByTestId('models-row-pipeline')

    const localBtn = pipelineRow.querySelector(
      'button[role="radio"][data-value="local"]'
    ) as HTMLButtonElement
    await user.click(localBtn)

    const claudeBtn = pipelineRow.querySelector(
      'button[role="radio"][data-value="claude"]'
    ) as HTMLButtonElement
    await user.click(claudeBtn)

    await waitFor(() => {
      const select = pipelineRow.querySelector('select') as HTMLSelectElement
      expect(select.value).toBe('claude-sonnet-4-5')
    })
  })

  it('disables all controls on a Not-yet-routed row', () => {
    render(<ModelsSection />)
    const synthRow = screen.getByTestId('models-row-synthesizer')
    const buttons = synthRow.querySelectorAll('button[role="radio"]')
    buttons.forEach((btn) => expect(btn).toBeDisabled())
    const select = synthRow.querySelector('select') as HTMLSelectElement | null
    if (select) expect(select).toBeDisabled()
  })
})
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run:
```bash
cd $REPO_ROOT && npx vitest run src/renderer/src/components/settings/__tests__/ModelsSection.test.tsx
```

Expected: FAIL — no segmented control or select in the rendered rows.

- [ ] **Step 3: Extend `ModelsSection.tsx` with `BackendToggle`, `ModelPicker`, and lift row config state to the parent**

Replace the existing `ModelsSection.tsx` with:

```tsx
/**
 * ModelsSection — per-agent-type backend + model routing.
 *
 * Loads the composite `agents.backendConfig` setting on mount, renders:
 *   1. a shared Local backend card (endpoint URL + test connection),
 *   2. an Active routing card (Pipeline row — the only type wired today),
 *   3. a Not yet routed card (five disabled rows for future types).
 *
 * Saves the entire BackendSettings object in one atomic setJson call.
 */
import './ModelsSection.css'
import { useEffect, useState } from 'react'
import { SettingsCard } from './SettingsCard'

const DEFAULT_LOCAL_ENDPOINT = 'http://localhost:1234/v1'
const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-4-5'
const DEFAULT_LOCAL_MODEL = ''
const LOCAL_MODEL_PLACEHOLDER = 'openai/qwen/qwen3.6-35b-a3b'
const CLAUDE_MODELS = ['claude-sonnet-4-5', 'claude-opus-4-7', 'claude-haiku-4-5'] as const

type AgentTypeId =
  | 'pipeline'
  | 'synthesizer'
  | 'copilot'
  | 'assistant'
  | 'adhoc'
  | 'reviewer'

type BackendKind = 'claude' | 'local'

interface AgentTypeMeta {
  id: AgentTypeId
  label: string
  description: string
}

const ACTIVE_TYPES: AgentTypeMeta[] = [
  { id: 'pipeline', label: 'Pipeline', description: 'Executes sprint tasks end-to-end.' }
]

const NOT_YET_ROUTED_TYPES: AgentTypeMeta[] = [
  { id: 'synthesizer', label: 'Synthesizer', description: 'Drafts spec documents from task titles.' },
  { id: 'copilot', label: 'Copilot', description: 'Interactive pair-programming agent.' },
  { id: 'assistant', label: 'Assistant', description: 'One-shot Q&A over the repo.' },
  { id: 'adhoc', label: 'Adhoc', description: 'Freeform agent runs outside the sprint pipeline.' },
  { id: 'reviewer', label: 'Reviewer', description: 'Reviews PRs before merge.' }
]

interface AgentBackendConfig {
  backend: BackendKind
  model: string
}

interface BackendSettings {
  pipeline: AgentBackendConfig
  synthesizer: AgentBackendConfig
  copilot: AgentBackendConfig
  assistant: AgentBackendConfig
  adhoc: AgentBackendConfig
  reviewer: AgentBackendConfig
  localEndpoint: string
}

const DEFAULT_ROW: AgentBackendConfig = { backend: 'claude', model: DEFAULT_CLAUDE_MODEL }

function defaultBackendSettings(): BackendSettings {
  return {
    pipeline: { ...DEFAULT_ROW },
    synthesizer: { ...DEFAULT_ROW },
    copilot: { ...DEFAULT_ROW },
    assistant: { ...DEFAULT_ROW },
    adhoc: { ...DEFAULT_ROW },
    reviewer: { ...DEFAULT_ROW },
    localEndpoint: DEFAULT_LOCAL_ENDPOINT
  }
}

export function ModelsSection(): React.JSX.Element {
  const [settings, setSettings] = useState<BackendSettings>(defaultBackendSettings)

  useEffect(() => {
    async function load(): Promise<void> {
      const stored = (await window.api.settings.getJson(
        'agents.backendConfig'
      )) as Partial<BackendSettings> | null
      if (!stored) return
      setSettings((prev) => ({ ...prev, ...stored }))
    }
    void load()
  }, [])

  function updateRow(id: AgentTypeId, next: AgentBackendConfig): void {
    setSettings((s) => ({ ...s, [id]: next }))
  }

  return (
    <div className="settings-cards-list">
      <SettingsCard
        title="Local backend"
        subtitle="LM Studio, Ollama, or any OpenAI-compatible server."
      >
        <label className="settings-field">
          <span className="settings-field__label">Endpoint URL</span>
          <input
            className="settings-field__input"
            type="text"
            value={settings.localEndpoint}
            onChange={(e) =>
              setSettings((s) => ({ ...s, localEndpoint: e.target.value }))
            }
            placeholder={DEFAULT_LOCAL_ENDPOINT}
          />
        </label>
      </SettingsCard>

      <SettingsCard title="Active routing" subtitle="Types wired through spawnAgent today.">
        {ACTIVE_TYPES.map((type) => (
          <AgentTypeRow
            key={type.id}
            type={type}
            value={settings[type.id]}
            onChange={(next) => updateRow(type.id, next)}
            disabled={false}
          />
        ))}
      </SettingsCard>

      <SettingsCard
        title="Not yet routed"
        subtitle="Configuration preserved for when each type is wired through spawnAgent."
      >
        {NOT_YET_ROUTED_TYPES.map((type) => (
          <AgentTypeRow
            key={type.id}
            type={type}
            value={settings[type.id]}
            onChange={(next) => updateRow(type.id, next)}
            disabled={true}
          />
        ))}
      </SettingsCard>
    </div>
  )
}

interface AgentTypeRowProps {
  type: AgentTypeMeta
  value: AgentBackendConfig
  onChange: (next: AgentBackendConfig) => void
  disabled: boolean
}

function AgentTypeRow({ type, value, onChange, disabled }: AgentTypeRowProps): React.JSX.Element {
  function toggleBackend(next: BackendKind): void {
    if (next === value.backend) return
    onChange({
      backend: next,
      model: next === 'claude' ? DEFAULT_CLAUDE_MODEL : DEFAULT_LOCAL_MODEL
    })
  }

  return (
    <div
      className="models-row"
      data-testid={`models-row-${type.id}`}
      aria-disabled={disabled || undefined}
    >
      <div className="models-row__label">{type.label}</div>
      <div className="models-row__desc">{type.description}</div>
      {disabled && <div className="models-row__desc">Not yet routed.</div>}
      <div className="models-row__controls">
        <BackendToggle
          value={value.backend}
          onChange={toggleBackend}
          disabled={disabled}
          rowId={type.id}
        />
        <ModelPicker
          backend={value.backend}
          model={value.model}
          onChange={(model) => onChange({ ...value, model })}
          disabled={disabled}
        />
      </div>
    </div>
  )
}

interface BackendToggleProps {
  value: BackendKind
  onChange: (next: BackendKind) => void
  disabled: boolean
  rowId: string
}

function BackendToggle({ value, onChange, disabled, rowId }: BackendToggleProps): React.JSX.Element {
  return (
    <div role="radiogroup" aria-label={`${rowId} backend`} className="models-seg">
      <button
        type="button"
        role="radio"
        aria-checked={value === 'claude'}
        data-value="claude"
        disabled={disabled}
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
        disabled={disabled}
        onClick={() => onChange('local')}
        className="models-seg__btn"
      >
        Local
      </button>
    </div>
  )
}

interface ModelPickerProps {
  backend: BackendKind
  model: string
  onChange: (next: string) => void
  disabled: boolean
}

function ModelPicker({ backend, model, onChange, disabled }: ModelPickerProps): React.JSX.Element {
  if (backend === 'claude') {
    return (
      <select
        className="settings-field__input"
        value={model || DEFAULT_CLAUDE_MODEL}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        aria-label="Claude model"
      >
        {CLAUDE_MODELS.map((id) => (
          <option key={id} value={id}>
            {id}
          </option>
        ))}
      </select>
    )
  }
  return (
    <input
      className="settings-field__input"
      type="text"
      value={model}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      placeholder={LOCAL_MODEL_PLACEHOLDER}
      aria-label="Local model"
    />
  )
}
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run:
```bash
cd $REPO_ROOT && npx vitest run src/renderer/src/components/settings/__tests__/ModelsSection.test.tsx
```

Expected: PASS — scaffold + rows + toggle/picker tests all green.

- [ ] **Step 5: Commit**

```bash
cd $REPO_ROOT
git add src/renderer/src/components/settings/ModelsSection.tsx \
        src/renderer/src/components/settings/__tests__/ModelsSection.test.tsx
git commit -m "feat(settings): backend toggle + conditional model picker per row"
```

---

## Task 8: Save orchestration (TDD)

Add a `dirty` flag + `saving` flag + Save button below all cards. Save composes the full `BackendSettings` object and calls `setSettingJson('agents.backendConfig', next)` exactly once; on success, shows a toast and clears the dirty flag.

**Files:**
- Modify: `src/renderer/src/components/settings/ModelsSection.tsx`
- Modify: `src/renderer/src/components/settings/__tests__/ModelsSection.test.tsx`

- [ ] **Step 1: Add the failing tests**

Append to `ModelsSection.test.tsx`:

```tsx
describe('ModelsSection — save orchestration', () => {
  it('renders a Save button initially disabled', () => {
    render(<ModelsSection />)
    const btn = screen.getByRole('button', { name: /save changes/i })
    expect(btn).toBeDisabled()
  })

  it('enables Save after the user edits the endpoint', async () => {
    const user = userEvent.setup()
    render(<ModelsSection />)
    const endpoint = screen.getByPlaceholderText('http://localhost:1234/v1') as HTMLInputElement
    await user.clear(endpoint)
    await user.type(endpoint, 'http://localhost:4321/v1')
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /save changes/i })).not.toBeDisabled()
    })
  })

  it('Save calls setJson with the full BackendSettings object once and clears dirty', async () => {
    const user = userEvent.setup()
    render(<ModelsSection />)
    const pipelineRow = screen.getByTestId('models-row-pipeline')
    const localBtn = pipelineRow.querySelector(
      'button[role="radio"][data-value="local"]'
    ) as HTMLButtonElement
    await user.click(localBtn)

    const localInput = pipelineRow.querySelector(
      'input[placeholder="openai/qwen/qwen3.6-35b-a3b"]'
    ) as HTMLInputElement
    await user.type(localInput, 'openai/qwen/qwen3.6-35b-a3b')

    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => {
      expect(window.api.settings.setJson).toHaveBeenCalledTimes(1)
      expect(window.api.settings.setJson).toHaveBeenCalledWith(
        'agents.backendConfig',
        expect.objectContaining({
          pipeline: { backend: 'local', model: 'openai/qwen/qwen3.6-35b-a3b' },
          synthesizer: { backend: 'claude', model: 'claude-sonnet-4-5' },
          localEndpoint: 'http://localhost:1234/v1'
        })
      )
    })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /save changes/i })).toBeDisabled()
    })
  })
})
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run:
```bash
cd $REPO_ROOT && npx vitest run src/renderer/src/components/settings/__tests__/ModelsSection.test.tsx
```

Expected: FAIL — no Save button yet.

- [ ] **Step 3: Add save state + button**

In `src/renderer/src/components/settings/ModelsSection.tsx`:

1. At the top of the file, add:

```tsx
import { useCallback, useEffect, useState } from 'react'
import { Button } from '../ui/Button'
import { toast } from '../../stores/toasts'
```

(Replace the existing `import { useEffect, useState } from 'react'`.)

2. Inside the `ModelsSection` component, after the existing `useState` and `useEffect`, add the dirty + saving state and the save handler. Replace the function body so the full component looks like:

```tsx
export function ModelsSection(): React.JSX.Element {
  const [settings, setSettings] = useState<BackendSettings>(defaultBackendSettings)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    async function load(): Promise<void> {
      const stored = (await window.api.settings.getJson(
        'agents.backendConfig'
      )) as Partial<BackendSettings> | null
      if (!stored) return
      setSettings((prev) => ({ ...prev, ...stored }))
    }
    void load()
  }, [])

  function updateSettings(next: BackendSettings): void {
    setSettings(next)
    setDirty(true)
  }

  function updateRow(id: AgentTypeId, next: AgentBackendConfig): void {
    updateSettings({ ...settings, [id]: next })
  }

  function updateEndpoint(next: string): void {
    updateSettings({ ...settings, localEndpoint: next })
  }

  const handleSave = useCallback(async (): Promise<void> => {
    setSaving(true)
    try {
      await window.api.settings.setJson('agents.backendConfig', settings)
      setDirty(false)
      toast.success('Model routing saved')
    } catch {
      toast.error('Failed to save model routing')
    } finally {
      setSaving(false)
    }
  }, [settings])

  return (
    <div className="settings-cards-list">
      <SettingsCard
        title="Local backend"
        subtitle="LM Studio, Ollama, or any OpenAI-compatible server."
      >
        <label className="settings-field">
          <span className="settings-field__label">Endpoint URL</span>
          <input
            className="settings-field__input"
            type="text"
            value={settings.localEndpoint}
            onChange={(e) => updateEndpoint(e.target.value)}
            placeholder={DEFAULT_LOCAL_ENDPOINT}
          />
        </label>
      </SettingsCard>

      <SettingsCard title="Active routing" subtitle="Types wired through spawnAgent today.">
        {ACTIVE_TYPES.map((type) => (
          <AgentTypeRow
            key={type.id}
            type={type}
            value={settings[type.id]}
            onChange={(next) => updateRow(type.id, next)}
            disabled={false}
          />
        ))}
      </SettingsCard>

      <SettingsCard
        title="Not yet routed"
        subtitle="Configuration preserved for when each type is wired through spawnAgent."
      >
        {NOT_YET_ROUTED_TYPES.map((type) => (
          <AgentTypeRow
            key={type.id}
            type={type}
            value={settings[type.id]}
            onChange={(next) => updateRow(type.id, next)}
            disabled={true}
          />
        ))}
      </SettingsCard>

      <div className="models-save-row">
        <Button
          variant="primary"
          size="sm"
          onClick={handleSave}
          disabled={!dirty || saving}
          loading={saving}
          type="button"
        >
          {saving ? 'Saving…' : 'Save changes'}
        </Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run:
```bash
cd $REPO_ROOT && npx vitest run src/renderer/src/components/settings/__tests__/ModelsSection.test.tsx
```

Expected: PASS — save orchestration tests green along with all earlier tests.

- [ ] **Step 5: Commit**

```bash
cd $REPO_ROOT
git add src/renderer/src/components/settings/ModelsSection.tsx \
        src/renderer/src/components/settings/__tests__/ModelsSection.test.tsx
git commit -m "feat(settings): save BackendSettings atomically from ModelsSection"
```

---

## Task 9: Test-connection flow (TDD)

Adds the "Test connection" button to the Local backend card with four visible states (idle / in-flight / ok / fail). Editing the endpoint clears any stale result.

**Files:**
- Modify: `src/renderer/src/components/settings/ModelsSection.tsx`
- Modify: `src/renderer/src/components/settings/__tests__/ModelsSection.test.tsx`

- [ ] **Step 1: Add the failing tests**

Append to `ModelsSection.test.tsx`:

```tsx
describe('ModelsSection — test connection', () => {
  it('shows success state after a reachable endpoint returns', async () => {
    const user = userEvent.setup()
    vi.mocked(window.api.agents.testLocalEndpoint).mockResolvedValue({
      ok: true,
      latencyMs: 18,
      modelCount: 4
    })

    render(<ModelsSection />)
    await user.click(screen.getByRole('button', { name: /test connection/i }))

    await waitFor(() => {
      expect(screen.getByText(/Reachable — 4 models loaded/i)).toBeInTheDocument()
    })
  })

  it('shows error state when the endpoint is unreachable', async () => {
    const user = userEvent.setup()
    vi.mocked(window.api.agents.testLocalEndpoint).mockResolvedValue({
      ok: false,
      error: 'ECONNREFUSED'
    })

    render(<ModelsSection />)
    await user.click(screen.getByRole('button', { name: /test connection/i }))

    await waitFor(() => {
      expect(screen.getByText(/ECONNREFUSED/i)).toBeInTheDocument()
    })
  })

  it('disables the Test button while the check is in flight', async () => {
    const user = userEvent.setup()
    let resolve: (v: { ok: true; latencyMs: number; modelCount: number }) => void = () => {}
    const pending = new Promise<{ ok: true; latencyMs: number; modelCount: number }>(
      (r) => (resolve = r)
    )
    vi.mocked(window.api.agents.testLocalEndpoint).mockReturnValue(pending)

    render(<ModelsSection />)
    const btn = screen.getByRole('button', { name: /test connection/i })
    await user.click(btn)

    await waitFor(() => {
      expect(btn).toBeDisabled()
    })

    resolve({ ok: true, latencyMs: 1, modelCount: 1 })
  })

  it('clears any stale result when the endpoint is edited', async () => {
    const user = userEvent.setup()
    vi.mocked(window.api.agents.testLocalEndpoint).mockResolvedValue({
      ok: true,
      latencyMs: 5,
      modelCount: 2
    })

    render(<ModelsSection />)
    await user.click(screen.getByRole('button', { name: /test connection/i }))
    await waitFor(() => {
      expect(screen.getByText(/Reachable — 2 models loaded/i)).toBeInTheDocument()
    })

    const endpoint = screen.getByPlaceholderText('http://localhost:1234/v1') as HTMLInputElement
    await user.type(endpoint, 'X')

    await waitFor(() => {
      expect(screen.queryByText(/Reachable — 2 models loaded/i)).toBeNull()
    })
  })
})
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run:
```bash
cd $REPO_ROOT && npx vitest run src/renderer/src/components/settings/__tests__/ModelsSection.test.tsx
```

Expected: FAIL — no Test connection button yet.

- [ ] **Step 3: Add the test-connection state and button**

In `src/renderer/src/components/settings/ModelsSection.tsx`:

1. Define the test-connection state variant type near the top of the file (above `ModelsSection`):

```tsx
type TestConnState =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'ok'; modelCount: number; latencyMs: number }
  | { kind: 'fail'; error: string }
```

2. Inside the `ModelsSection` function, add the state and handler (right after the existing `const [saving, setSaving] = useState(false)`):

```tsx
const [testConn, setTestConn] = useState<TestConnState>({ kind: 'idle' })

const handleTestConnection = useCallback(async (): Promise<void> => {
  setTestConn({ kind: 'pending' })
  const result = await window.api.agents.testLocalEndpoint(settings.localEndpoint)
  if (result.ok) {
    setTestConn({ kind: 'ok', modelCount: result.modelCount, latencyMs: result.latencyMs })
  } else {
    setTestConn({ kind: 'fail', error: result.error })
  }
}, [settings.localEndpoint])
```

3. Modify `updateEndpoint` to clear the test-connection result:

```tsx
function updateEndpoint(next: string): void {
  updateSettings({ ...settings, localEndpoint: next })
  setTestConn({ kind: 'idle' })
}
```

4. Inside the Local backend `<SettingsCard>`, below the existing endpoint `<label>`, add:

```tsx
        <div className="models-row__controls" style={{ marginTop: '8px' }}>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={handleTestConnection}
            disabled={testConn.kind === 'pending'}
            loading={testConn.kind === 'pending'}
          >
            Test connection
          </Button>
          <TestConnIndicator state={testConn} />
        </div>
```

5. Below the `ModelsSection` export, add the `TestConnIndicator` component:

```tsx
function TestConnIndicator({ state }: { state: TestConnState }): React.JSX.Element | null {
  if (state.kind === 'idle') return null
  if (state.kind === 'pending') {
    return (
      <span className="models-status" aria-live="polite">
        Testing…
      </span>
    )
  }
  if (state.kind === 'ok') {
    return (
      <span className="models-status models-status--ok" aria-live="polite">
        ✓ Reachable — {state.modelCount} models loaded ({state.latencyMs} ms)
      </span>
    )
  }
  return (
    <span className="models-status models-status--err" aria-live="polite">
      ✕ {state.error}
    </span>
  )
}
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run:
```bash
cd $REPO_ROOT && npx vitest run src/renderer/src/components/settings/__tests__/ModelsSection.test.tsx
```

Expected: PASS — test-connection tests green along with all earlier tests.

- [ ] **Step 5: Commit**

```bash
cd $REPO_ROOT
git add src/renderer/src/components/settings/ModelsSection.tsx \
        src/renderer/src/components/settings/__tests__/ModelsSection.test.tsx
git commit -m "feat(settings): Test connection button with ok/fail/pending states"
```

---

## Task 10: Wire `ModelsSection` into `SettingsView` and sidebar

Adds the sidebar entry + makes the section reachable. Updates the two existing SettingsView tests to assert `Models` renders.

**Files:**
- Modify: `src/renderer/src/views/SettingsView.tsx`
- Modify: `src/renderer/src/components/settings/__tests__/SettingsView.test.tsx`
- Modify: `src/renderer/src/views/__tests__/SettingsView.test.tsx`

- [ ] **Step 1: Add the failing test to the component-level `SettingsView.test.tsx`**

Open `src/renderer/src/components/settings/__tests__/SettingsView.test.tsx` and append a new test inside the existing `describe('SettingsView', …)` block:

```tsx
  it('renders the Models sidebar entry', () => {
    render(<SettingsView />)
    expect(screen.getAllByText('Models').length).toBeGreaterThanOrEqual(1)
  })

  it('switches to Models section on sidebar click', async () => {
    const user = userEvent.setup()
    render(<SettingsView />)
    const modelsLinks = screen.getAllByText('Models')
    await user.click(modelsLinks[0])
    expect(screen.getByText('Local backend')).toBeInTheDocument()
    expect(screen.getByText('Active routing')).toBeInTheDocument()
  })
```

- [ ] **Step 2: Run the test to confirm it fails**

Run:
```bash
cd $REPO_ROOT && npx vitest run src/renderer/src/components/settings/__tests__/SettingsView.test.tsx
```

Expected: FAIL — `Models` is not in the sidebar.

- [ ] **Step 3: Register `models` in `SettingsView.tsx`**

In `src/renderer/src/views/SettingsView.tsx`:

1. In the `import` from `lucide-react`, add `Network`:

```ts
import { Palette, Link, GitBranch, FileText, Cpu, Brain, Info, Network } from 'lucide-react'
```

2. Add the import for `ModelsSection` next to the other section imports:

```ts
import { ModelsSection } from '../components/settings/ModelsSection'
```

3. Add the new entry to `SECTIONS` (place it directly after the `agents` entry):

```ts
const SECTIONS: SettingsSection[] = [
  { id: 'connections', label: 'Connections', icon: Link, category: 'Account' },
  { id: 'repositories', label: 'Repositories', icon: GitBranch, category: 'Projects' },
  { id: 'templates', label: 'Templates', icon: FileText, category: 'Projects' },
  { id: 'agents', label: 'Agents', icon: Cpu, category: 'Pipeline' },
  { id: 'models', label: 'Models', icon: Network, category: 'Pipeline' },
  { id: 'memory', label: 'Memory', icon: Brain, category: 'App' },
  { id: 'appearance', label: 'Appearance & Shortcuts', icon: Palette, category: 'App' },
  { id: 'about', label: 'About & Usage', icon: Info, category: 'App' }
]
```

4. Add the entry to `SECTION_MAP`:

```ts
const SECTION_MAP: Record<string, () => React.JSX.Element> = {
  connections: ConnectionsSection,
  repositories: RepositoriesSection,
  templates: TaskTemplatesSection,
  agents: AgentManagerSection,
  models: ModelsSection,
  memory: MemorySection,
  appearance: AppearanceSection,
  about: AboutSection
}
```

5. Add the entry to `SECTION_META`:

```ts
  models: {
    title: 'Models',
    subtitle: 'Route each agent type to Claude or a local model',
    wide: false
  },
```

Place it directly after the `agents` entry, matching the alphabetical-ish grouping the file already uses.

- [ ] **Step 4: Run the tests to confirm they pass**

Run:
```bash
cd $REPO_ROOT && npx vitest run src/renderer/src/components/settings/__tests__/SettingsView.test.tsx
```

Expected: PASS — all 5+ tests green.

- [ ] **Step 5: Update the view-level `SettingsView.test.tsx` if it asserts on section lists**

Open `src/renderer/src/views/__tests__/SettingsView.test.tsx` and read it. If it enumerates the sidebar entries (similar to the component-level test), add an assertion:

```tsx
expect(screen.getAllByText('Models').length).toBeGreaterThanOrEqual(1)
```

If the view-level test is purely structural and doesn't list sections, no change is needed. Run:

```bash
cd $REPO_ROOT && npx vitest run src/renderer/src/views/__tests__/SettingsView.test.tsx
```

Expected: PASS. If anything breaks because the file enumerates the union type literally, update it to include `'models'`.

- [ ] **Step 6: Full test sweep**

Run:
```bash
cd $REPO_ROOT && npm run typecheck && npm test -- --run
```

Expected: typecheck clean; all renderer + main tests pass.

- [ ] **Step 7: Commit**

```bash
cd $REPO_ROOT
git add src/renderer/src/views/SettingsView.tsx \
        src/renderer/src/components/settings/__tests__/SettingsView.test.tsx \
        src/renderer/src/views/__tests__/SettingsView.test.tsx
git commit -m "feat(settings): wire Models tab into SettingsView sidebar"
```

---

## Task 11: Manual verification

Quick human-in-the-loop check that the UI reads and writes correctly against a real SQLite store.

- [ ] **Step 1: Build and start BDE**

```bash
cd $REPO_ROOT && npm run dev
```

- [ ] **Step 2: Open Settings → Models**

Confirm:
- `Models` entry appears under `Pipeline` in the sidebar, between `Agents` and `Memory`.
- `Local backend` card shows the default endpoint `http://localhost:1234/v1`.
- `Active routing` shows a Pipeline row with Claude/Local toggle + `claude-sonnet-4-5` selected in the dropdown.
- `Not yet routed` shows 5 rows with all controls disabled and the `Not yet routed.` note.
- `Save changes` button is disabled.

- [ ] **Step 3: Toggle Pipeline to Local, enter a model, Save**

- Click `Local` on the Pipeline row.
- Confirm the dropdown becomes a text input with placeholder `openai/qwen/qwen3.6-35b-a3b`.
- Type `openai/qwen/qwen3.6-35b-a3b`.
- Click `Save changes`.
- Confirm the Save button becomes disabled again and a success toast appears.

- [ ] **Step 4: Inspect SQLite**

```bash
sqlite3 ~/Library/Application\ Support/bde/bde.sqlite \
  "SELECT value FROM settings WHERE key = 'agents.backendConfig';"
```

Expected: JSON with `pipeline.backend == "local"`, `pipeline.model == "openai/qwen/qwen3.6-35b-a3b"`, and all other types still `{ backend: "claude", model: "claude-sonnet-4-5" }`.

- [ ] **Step 5: Test connection against a running LM Studio (optional)**

If LM Studio is running with a model loaded:
- Click `Test connection`.
- Expect `✓ Reachable — N models loaded (M ms)`.

If not:
- Click `Test connection`.
- Expect `✕ ECONNREFUSED` or similar.

- [ ] **Step 6: Reload the app, confirm the saved values persist**

Quit BDE, reopen, navigate back to Models. Confirm Pipeline still shows Local + the model ID you set.

No commit at this step — manual verification only.

---

## Self-Review Summary

- **Spec coverage:** Every goal (G1–G5) and every numbered test in the spec's Testing section maps to a task above. The sidebar placement, three-card layout, single Save button, model picker conditional, disabled rows, test-connection state machine, and shared endpoint are all implemented across Tasks 5–10.
- **Placeholder scan:** No TBDs or "add appropriate error handling" / "similar to earlier" references. Every code step contains the actual code.
- **Type consistency:** `BackendSettings`, `AgentBackendConfig`, `AgentTypeId`, `BackendKind`, and `TestConnState` are defined once in `ModelsSection.tsx` and used consistently. The IPC channel args/result shape in Task 1 matches the handler return type in Task 2 and the preload wrapper in Task 3.
- **Out-of-scope items deliberately not covered:** `agentManager.defaultModel` cleanup, auto-populating local model IDs, per-workspace overrides. All called out in the spec's `Open questions / future work` section.
