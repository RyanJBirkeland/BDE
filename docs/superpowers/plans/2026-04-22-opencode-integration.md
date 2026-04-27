# Opencode Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `'opencode'` as a per-agent-type backend option in Settings → Models, routing supported agent types (Pipeline, Adhoc, Assistant, Reviewer) through `opencode run --format json` instead of the Anthropic SDK.

**Architecture:** A new `opencode-wire.ts` pure-translation layer converts opencode's JSON event stream to synthetic Anthropic-format wire messages, which `spawn-opencode.ts` yields from an `AgentHandle`. The pipeline path routes through `sdk-adapter.ts`; the adhoc/assistant path gets an opencode branch inside `adhoc-agent.ts`. All downstream machinery (drain loop, `mapRawMessage`, cost tracking, Code Review Station) is unchanged.

**Tech Stack:** Node.js `child_process.spawn`, TypeScript strict, Vitest, React + TypeScript (renderer).

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Create | `src/main/agent-manager/opencode-wire.ts` | Pure translation: one opencode JSON line → `SDKWireMessage[]` |
| Create | `src/main/agent-manager/spawn-opencode.ts` | Spawn process, pipe stdout through wire translator, return `AgentHandle` |
| Create | `src/main/agent-manager/__tests__/opencode-wire.test.ts` | Unit tests for the translation layer |
| Modify | `src/shared/types/backend-settings.ts` | Add `'opencode'` to `BackendKind`; add `opencodeExecutable?: string` |
| Modify | `src/main/agent-manager/backend-selector.ts` | Add opencode defaults and `opencodeExecutable` to settings shape |
| Modify | `src/main/agent-manager/__tests__/backend-selector.test.ts` | Extend existing tests to cover opencode |
| Modify | `src/main/agent-manager/sdk-adapter.ts` | Add `'opencode'` branch routing to `spawnOpencode` |
| Modify | `src/main/adhoc-agent.ts` | Opencode branch for adhoc/assistant multi-turn sessions |
| Modify | `src/renderer/src/components/settings/ModelsSection.tsx` | Add opencode radio + model field + executable path field |
| Modify | `docs/modules/agent-manager/index.md` | Add rows for new files |
| Modify | `docs/modules/shared/index.md` | Update `backend-settings.ts` entry |

---

## Task 1: Wire Translation Layer

**Files:**
- Create: `src/main/agent-manager/opencode-wire.ts`
- Create: `src/main/agent-manager/__tests__/opencode-wire.test.ts`

- [ ] **Step 1.1: Write failing tests for `translateOpencodeEvent`**

Create `src/main/agent-manager/__tests__/opencode-wire.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { translateOpencodeEvent } from '../opencode-wire'

const SESSION = 'ses_test123'

describe('translateOpencodeEvent', () => {
  it('returns empty array for step_start', () => {
    const line = JSON.stringify({
      type: 'step_start',
      timestamp: 1000,
      sessionID: SESSION,
      part: { id: 'prt_1', messageID: 'msg_1', sessionID: SESSION, type: 'step-start' }
    })
    expect(translateOpencodeEvent(line)).toEqual([])
  })

  it('maps text event to an assistant message with text content block', () => {
    const line = JSON.stringify({
      type: 'text',
      timestamp: 2000,
      sessionID: SESSION,
      part: {
        id: 'prt_2',
        messageID: 'msg_1',
        sessionID: SESSION,
        type: 'text',
        text: 'Hello world',
        time: { start: 1999, end: 2000 }
      }
    })
    const result = translateOpencodeEvent(line)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'Hello world' }]
      }
    })
  })

  it('maps tool_use event to assistant tool_use + user tool_result pair', () => {
    const line = JSON.stringify({
      type: 'tool_use',
      timestamp: 3000,
      sessionID: SESSION,
      part: {
        type: 'tool',
        tool: 'apply_patch',
        callID: 'call_abc123',
        state: {
          status: 'completed',
          input: { patchText: '*** Begin Patch\n+hello\n*** End Patch' },
          output: 'Success. Updated the following files:\nA src/foo.ts'
        },
        id: 'prt_3',
        sessionID: SESSION,
        messageID: 'msg_1'
      }
    })
    const result = translateOpencodeEvent(line)
    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{
          type: 'tool_use',
          name: 'apply_patch',
          id: 'call_abc123',
          input: { patchText: '*** Begin Patch\n+hello\n*** End Patch' }
        }]
      }
    })
    expect(result[1]).toMatchObject({
      type: 'user',
      message: {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: 'call_abc123',
          content: 'Success. Updated the following files:\nA src/foo.ts',
          is_error: false
        }]
      }
    })
  })

  it('maps step_finish with reason=stop to a result message with cost', () => {
    const line = JSON.stringify({
      type: 'step_finish',
      timestamp: 4000,
      sessionID: SESSION,
      part: {
        id: 'prt_4',
        reason: 'stop',
        messageID: 'msg_1',
        sessionID: SESSION,
        type: 'step-finish',
        tokens: { total: 200, input: 150, output: 50, reasoning: 0, cache: { write: 0, read: 0 } },
        cost: 0.0012
      }
    })
    const result = translateOpencodeEvent(line)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      type: 'result',
      cost_usd: 0.0012,
      stop_reason: 'end_turn'
    })
  })

  it('returns empty array for step_finish with reason=tool-calls (intermediate step)', () => {
    const line = JSON.stringify({
      type: 'step_finish',
      timestamp: 5000,
      sessionID: SESSION,
      part: {
        id: 'prt_5',
        reason: 'tool-calls',
        messageID: 'msg_1',
        sessionID: SESSION,
        type: 'step-finish',
        tokens: { total: 100, input: 80, output: 20, reasoning: 0, cache: { write: 0, read: 0 } },
        cost: 0
      }
    })
    expect(translateOpencodeEvent(line)).toEqual([])
  })

  it('maps error event to an assistant text message', () => {
    const line = JSON.stringify({
      type: 'error',
      timestamp: 6000,
      sessionID: SESSION,
      error: { name: 'UnknownError', data: { message: 'Model not found: bad/model' } }
    })
    const result = translateOpencodeEvent(line)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'Error: Model not found: bad/model' }]
      }
    })
  })

  it('returns empty array for unknown event types', () => {
    const line = JSON.stringify({ type: 'unknown_future_type', sessionID: SESSION })
    expect(translateOpencodeEvent(line)).toEqual([])
  })

  it('returns empty array for invalid JSON', () => {
    expect(translateOpencodeEvent('not json{')).toEqual([])
  })

  it('returns empty array for empty line', () => {
    expect(translateOpencodeEvent('')).toEqual([])
    expect(translateOpencodeEvent('   ')).toEqual([])
  })

  it('extracts sessionID from text event', () => {
    const line = JSON.stringify({
      type: 'text',
      timestamp: 7000,
      sessionID: 'ses_extracted',
      part: { id: 'prt_6', messageID: 'msg_2', sessionID: 'ses_extracted', type: 'text', text: 'Hi', time: { start: 6999, end: 7000 } }
    })
    expect(extractOpencodeSessionId(line)).toBe('ses_extracted')
  })
})

import { extractOpencodeSessionId } from '../opencode-wire'

describe('extractOpencodeSessionId', () => {
  it('returns undefined for invalid JSON', () => {
    expect(extractOpencodeSessionId('bad')).toBeUndefined()
  })

  it('returns undefined when sessionID field is missing', () => {
    expect(extractOpencodeSessionId(JSON.stringify({ type: 'text' }))).toBeUndefined()
  })
})
```

- [ ] **Step 1.2: Run tests to verify they fail**

```bash
cd /path/to/worktree  # use your actual worktree path
npm run test:main -- opencode-wire --reporter=verbose 2>&1 | head -30
```

Expected: FAIL — `Cannot find module '../opencode-wire'`

- [ ] **Step 1.3: Implement `opencode-wire.ts`**

Create `src/main/agent-manager/opencode-wire.ts`:

```ts
/**
 * opencode-wire — translates opencode --format json events to synthetic
 * Anthropic SDK wire messages consumed by agent-event-mapper.mapRawMessage.
 *
 * Pure functions: no I/O, no side effects, fully unit-testable.
 */

interface OpencodeTextPart {
  type: 'text'
  text: string
}

interface OpencodeToolState {
  status: string
  input: unknown
  output: string
}

interface OpencodeToolPart {
  type: 'tool'
  tool: string
  callID: string
  state: OpencodeToolState
}

interface OpencodeStepFinishPart {
  reason: 'stop' | 'tool-calls'
  tokens: { total: number; input: number; output: number }
  cost: number
}

interface OpencodeErrorPayload {
  name: string
  data?: { message?: string }
}

type OpencodeEvent =
  | { type: 'step_start'; sessionID: string }
  | { type: 'text'; sessionID: string; part: OpencodeTextPart }
  | { type: 'tool_use'; sessionID: string; part: OpencodeToolPart }
  | { type: 'step_finish'; sessionID: string; part: OpencodeStepFinishPart }
  | { type: 'error'; sessionID: string; error: OpencodeErrorPayload }
  | { type: string; sessionID?: string }

function parseEvent(line: string): OpencodeEvent | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  try {
    const parsed = JSON.parse(trimmed)
    if (typeof parsed !== 'object' || parsed === null || typeof parsed.type !== 'string') return null
    return parsed as OpencodeEvent
  } catch {
    return null
  }
}

function assistantText(text: string): object {
  return {
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'text', text }] }
  }
}

function assistantToolUse(name: string, id: string, input: unknown): object {
  return {
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'tool_use', name, id, input }] }
  }
}

function userToolResult(toolUseId: string, content: string, isError: boolean): object {
  return {
    type: 'user',
    message: {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: toolUseId, content, is_error: isError }]
    }
  }
}

/**
 * Translates one line of opencode --format json output into zero or more
 * synthetic Anthropic SDK wire messages that agent-event-mapper.mapRawMessage
 * already knows how to consume.
 */
export function translateOpencodeEvent(line: string): object[] {
  const event = parseEvent(line)
  if (!event) return []

  switch (event.type) {
    case 'step_start':
      return []

    case 'text': {
      const part = (event as { type: 'text'; part: OpencodeTextPart }).part
      if (typeof part?.text !== 'string') return []
      return [assistantText(part.text)]
    }

    case 'tool_use': {
      const part = (event as { type: 'tool_use'; part: OpencodeToolPart }).part
      if (!part?.tool || !part?.callID || !part?.state) return []
      const isError = part.state.status !== 'completed'
      return [
        assistantToolUse(part.tool, part.callID, part.state.input ?? {}),
        userToolResult(part.callID, part.state.output ?? '', isError)
      ]
    }

    case 'step_finish': {
      const part = (event as { type: 'step_finish'; part: OpencodeStepFinishPart }).part
      if (!part || part.reason !== 'stop') return []
      return [{ type: 'result', cost_usd: part.cost ?? 0, stop_reason: 'end_turn' }]
    }

    case 'error': {
      const err = (event as { type: 'error'; error: OpencodeErrorPayload }).error
      const message = err?.data?.message ?? err?.name ?? 'Unknown opencode error'
      return [assistantText(`Error: ${message}`)]
    }

    default:
      return []
  }
}

/**
 * Extracts the opencode sessionID from a raw event line.
 * Returns undefined if the line is invalid JSON or lacks the field.
 */
export function extractOpencodeSessionId(line: string): string | undefined {
  const event = parseEvent(line)
  if (!event) return undefined
  return typeof event.sessionID === 'string' ? event.sessionID : undefined
}
```

- [ ] **Step 1.4: Run tests to verify they pass**

```bash
npm run test:main -- opencode-wire --reporter=verbose
```

Expected: all tests PASS

- [ ] **Step 1.5: Commit**

```bash
git add src/main/agent-manager/opencode-wire.ts \
        src/main/agent-manager/__tests__/opencode-wire.test.ts
git commit -m "feat(opencode): add opencode event → SDK wire message translation layer"
```

---

## Task 2: Spawn Adapter

**Files:**
- Create: `src/main/agent-manager/spawn-opencode.ts`

- [ ] **Step 2.1: Implement `spawn-opencode.ts`**

Create `src/main/agent-manager/spawn-opencode.ts`:

```ts
/**
 * opencode CLI spawn adapter.
 *
 * Spawns `opencode run "<prompt>" --format json [--dir <cwd>] [-m <model>]
 * [-s <sessionId>]`, pipes stdout through opencode-wire.ts, and yields
 * synthetic Anthropic SDK wire messages so the downstream drain loop and
 * agent-event-mapper can consume opencode sessions without modification.
 */
import { spawn } from 'node:child_process'
import type { AgentHandle, SteerResult } from './types'
import type { Logger } from '../logger'
import { translateOpencodeEvent, extractOpencodeSessionId } from './opencode-wire'

export interface OpencodeSpawnOptions {
  readonly prompt: string
  readonly cwd: string
  readonly model: string
  readonly sessionId?: string
  readonly executable?: string
  readonly logger?: Logger
}

export async function spawnOpencode(opts: OpencodeSpawnOptions): Promise<AgentHandle> {
  const executable = opts.executable || 'opencode'
  const args = buildArgs(opts)

  const child = spawn(executable, args, {
    cwd: opts.cwd,
    stdio: ['ignore', 'pipe', 'pipe']
  })

  let capturedSessionId = opts.sessionId ?? ''

  child.stderr.setMaxListeners(5)
  child.stderr.on('data', (chunk: Buffer) => {
    if (handle.onStderr) {
      for (const line of chunk.toString().split('\n')) {
        const trimmed = line.trim()
        if (trimmed) handle.onStderr(trimmed)
      }
    }
  })

  async function* generateMessages(): AsyncIterable<unknown> {
    let buffer = ''
    for await (const chunk of child.stdout) {
      buffer += (chunk as Buffer).toString()
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.trim()) continue
        if (!capturedSessionId) {
          const sid = extractOpencodeSessionId(line)
          if (sid) capturedSessionId = sid
        }
        for (const msg of translateOpencodeEvent(line)) {
          yield msg
        }
      }
    }
    if (buffer.trim()) {
      for (const msg of translateOpencodeEvent(buffer)) {
        yield msg
      }
    }
  }

  const handle: AgentHandle = {
    messages: generateMessages(),
    get sessionId() {
      return capturedSessionId
    },
    abort() {
      child.kill('SIGTERM')
    },
    async steer(_message: string): Promise<SteerResult> {
      return { delivered: false, error: 'steer not supported for opencode backend' }
    }
  }

  return handle
}

function buildArgs(opts: OpencodeSpawnOptions): string[] {
  const args = ['run', opts.prompt, '--format', 'json']
  if (opts.model) args.push('--model', opts.model)
  if (opts.cwd) args.push('--dir', opts.cwd)
  if (opts.sessionId) args.push('--session', opts.sessionId)
  return args
}
```

- [ ] **Step 2.2: Typecheck**

```bash
npm run typecheck 2>&1 | head -30
```

Expected: zero errors (or only pre-existing errors unrelated to these files)

- [ ] **Step 2.3: Commit**

```bash
git add src/main/agent-manager/spawn-opencode.ts
git commit -m "feat(opencode): add opencode CLI spawn adapter"
```

---

## Task 3: Backend Settings Types + Selector

**Files:**
- Modify: `src/shared/types/backend-settings.ts`
- Modify: `src/main/agent-manager/backend-selector.ts`
- Modify: `src/main/agent-manager/__tests__/backend-selector.test.ts`

- [ ] **Step 3.1: Write failing tests for new opencode settings fields**

Add to the end of `src/main/agent-manager/__tests__/backend-selector.test.ts`:

```ts
describe('opencode backend kind', () => {
  beforeEach(() => {
    vi.mocked(settings.getSettingJson).mockReset()
  })

  it('DEFAULT_SETTINGS has claude backend for all agent types (backward compat)', () => {
    for (const type of ['pipeline', 'synthesizer', 'copilot', 'assistant', 'adhoc', 'reviewer'] as const) {
      expect(DEFAULT_SETTINGS[type].backend).toBe('claude')
    }
  })

  it('DEFAULT_SETTINGS.opencodeExecutable is "opencode"', () => {
    expect(DEFAULT_SETTINGS.opencodeExecutable).toBe('opencode')
  })

  it('mergeWithDefaults fills opencodeExecutable from defaults when stored value is missing', () => {
    vi.mocked(settings.getSettingJson).mockReturnValue({
      pipeline: { backend: 'opencode', model: 'opencode/gpt-5-nano' }
    })
    const result = loadBackendSettings()
    expect(result.opencodeExecutable).toBe('opencode')
  })

  it('mergeWithDefaults honours stored opencodeExecutable override', () => {
    vi.mocked(settings.getSettingJson).mockReturnValue({
      opencodeExecutable: '/usr/local/bin/opencode'
    })
    expect(loadBackendSettings().opencodeExecutable).toBe('/usr/local/bin/opencode')
  })

  it('resolveAgentRuntime returns opencode backend config when set', () => {
    const s: BackendSettings = {
      ...DEFAULT_SETTINGS,
      pipeline: { backend: 'opencode', model: 'opencode/gpt-5-nano' }
    }
    expect(resolveAgentRuntime('pipeline', s)).toEqual({
      backend: 'opencode',
      model: 'opencode/gpt-5-nano'
    })
  })
})
```

- [ ] **Step 3.2: Run to verify they fail**

```bash
npm run test:main -- backend-selector --reporter=verbose 2>&1 | tail -20
```

Expected: FAIL on opencode-related assertions (type error or assertion failure)

- [ ] **Step 3.3: Update `backend-settings.ts`**

Open `src/shared/types/backend-settings.ts` and apply these changes:

```ts
export type BackendKind = 'claude' | 'local' | 'opencode'

export interface AgentBackendConfig {
  backend: BackendKind
  model: string
}

export interface BackendSettings {
  pipeline: AgentBackendConfig
  synthesizer: AgentBackendConfig
  copilot: AgentBackendConfig
  assistant: AgentBackendConfig
  adhoc: AgentBackendConfig
  reviewer: AgentBackendConfig
  localEndpoint: string
  opencodeExecutable: string
}
```

- [ ] **Step 3.4: Update `backend-selector.ts`**

Open `src/main/agent-manager/backend-selector.ts` and apply these changes:

1. Update `DEFAULT_SETTINGS` to add `opencodeExecutable`:

```ts
export const DEFAULT_SETTINGS: BackendSettings = {
  pipeline: { backend: 'claude', model: DEFAULT_CONFIG.defaultModel },
  synthesizer: { backend: 'claude', model: DEFAULT_CONFIG.defaultModel },
  copilot: { backend: 'claude', model: DEFAULT_CONFIG.defaultModel },
  assistant: { backend: 'claude', model: DEFAULT_CONFIG.defaultModel },
  adhoc: { backend: 'claude', model: DEFAULT_CONFIG.defaultModel },
  reviewer: { backend: 'claude', model: DEFAULT_CONFIG.defaultModel },
  localEndpoint: DEFAULT_LOCAL_ENDPOINT,
  opencodeExecutable: 'opencode'
}
```

2. Update `mergeWithDefaults` to include `opencodeExecutable`:

```ts
function mergeWithDefaults(stored: Partial<BackendSettings>): BackendSettings {
  return {
    pipeline: stored.pipeline ?? DEFAULT_SETTINGS.pipeline,
    synthesizer: stored.synthesizer ?? DEFAULT_SETTINGS.synthesizer,
    copilot: stored.copilot ?? DEFAULT_SETTINGS.copilot,
    assistant: stored.assistant ?? DEFAULT_SETTINGS.assistant,
    adhoc: stored.adhoc ?? DEFAULT_SETTINGS.adhoc,
    reviewer: stored.reviewer ?? DEFAULT_SETTINGS.reviewer,
    localEndpoint: stored.localEndpoint ?? DEFAULT_SETTINGS.localEndpoint,
    opencodeExecutable: stored.opencodeExecutable ?? DEFAULT_SETTINGS.opencodeExecutable
  }
}
```

- [ ] **Step 3.5: Run tests to verify they pass**

```bash
npm run test:main -- backend-selector --reporter=verbose
```

Expected: all tests PASS

- [ ] **Step 3.6: Typecheck**

```bash
npm run typecheck 2>&1 | head -30
```

Expected: zero errors

- [ ] **Step 3.7: Commit**

```bash
git add src/shared/types/backend-settings.ts \
        src/main/agent-manager/backend-selector.ts \
        src/main/agent-manager/__tests__/backend-selector.test.ts
git commit -m "feat(opencode): add opencode BackendKind and opencodeExecutable setting"
```

---

## Task 4: Pipeline Routing in `sdk-adapter.ts`

**Files:**
- Modify: `src/main/agent-manager/sdk-adapter.ts`

- [ ] **Step 4.1: Add import and opencode branch to `spawnAgent`**

In `src/main/agent-manager/sdk-adapter.ts`:

1. Add import at the top (after existing imports):

```ts
import { spawnOpencode } from './spawn-opencode'
```

2. In `spawnAgent`, add the opencode branch right after the `if (resolved.backend === 'local')` block and before the `const modelForClaude = ...` line:

```ts
  if (resolved.backend === 'opencode') {
    const handle = await spawnOpencode({
      prompt: opts.prompt,
      cwd: opts.cwd,
      model: resolved.model,
      sessionId: opts.sessionId,
      executable: settings.opencodeExecutable,
      logger: opts.logger
    })
    return annotateHandle(handle, 'opencode', resolved.model)
  }
```

3. Update `annotateHandle`'s `backend` parameter type (it's currently inferred from `'claude' | 'local'` — add `'opencode'`):

```ts
function annotateHandle(
  handle: AgentHandle,
  backend: 'claude' | 'local' | 'opencode',
  resolvedModel: string
): AgentHandle {
  return Object.assign(handle, { backend, resolvedModel })
}
```

4. Add `sessionId?: string` to `spawnAgent`'s opts interface (needed for pipeline retry and adhoc pass-through):

```ts
export async function spawnAgent(opts: {
  prompt: string
  cwd: string
  model: string
  maxBudgetUsd?: number | undefined
  logger?: Logger | undefined
  agentType?: AgentType | undefined
  pipelineTuning?: PipelineSpawnTuning | undefined
  worktreeBase?: string | undefined
  sessionId?: string | undefined          // ← add this
}): Promise<AgentHandle> {
```

- [ ] **Step 4.2: Typecheck**

```bash
npm run typecheck 2>&1 | head -30
```

Expected: zero errors

- [ ] **Step 4.3: Run existing sdk-adapter tests**

```bash
npm run test:main -- sdk-adapter --reporter=verbose
```

Expected: all existing tests still PASS

- [ ] **Step 4.4: Commit**

```bash
git add src/main/agent-manager/sdk-adapter.ts
git commit -m "feat(opencode): route pipeline agents to opencode spawn adapter"
```

---

## Task 5: Adhoc / Assistant Multi-Turn Support

**Files:**
- Modify: `src/main/adhoc-agent.ts`

The adhoc agent manages its own multi-turn session loop via `sdk.query()` with `resume: sessionId`. For opencode, each turn is a separate `opencode run --session <id>` invocation. We add an opencode branch inside the `AdhocSession` factory.

- [ ] **Step 5.1: Add the opencode branch to `spawnAdhocAgent`**

In `src/main/adhoc-agent.ts`:

1. Add imports near the top (alongside existing imports):

```ts
import { spawnOpencode } from './agent-manager/spawn-opencode'
import { mapRawMessage } from './agent-event-mapper'
import { loadBackendSettings } from './agent-manager/backend-selector'
```

(Note: `mapRawMessage` and `loadBackendSettings` may already be imported — check before adding)

2. After the `const { model } = resolveAgentRuntime(...)` line at the top of `spawnAdhocAgent`, add backend detection:

```ts
const agentType = args.assistant ? 'assistant' : 'adhoc'
const { model, backend } = resolveAgentRuntime(agentType)
const settings = loadBackendSettings()
```

(Replace the existing `const { model } = resolveAgentRuntime(...)` line with the above.)

3. Locate the section in `spawnAdhocAgent` that defines and registers the `AdhocSession`. Add an opencode-specific branch **before** the existing SDK-based session creation:

```ts
  // --- Opencode multi-turn path ---
  if (backend === 'opencode') {
    let opencodeSessionId: string | undefined

    const session: AdhocSession = {
      async send(message: string): Promise<void> {
        const handle = await spawnOpencode({
          prompt: message,
          cwd: worktreePath,
          model,
          sessionId: opencodeSessionId,
          executable: settings.opencodeExecutable,
          logger: log
        })

        // Capture session ID from first event for subsequent turns
        for await (const rawMsg of handle.messages) {
          if (!opencodeSessionId && handle.sessionId) {
            opencodeSessionId = handle.sessionId
          }
          const events = mapRawMessage(rawMsg)
          for (const event of events) {
            emitAgentEvent(agentId, event)
          }
        }
      },
      close() {
        // opencode run exits when done; nothing to close
      }
    }

    adhocSessions.set(agentId, session)
    await importAgent({ ... })  // same as existing SDK path — keep the importAgent call here
    return { agentId, worktreePath, branch }
  }
  // --- end opencode path, fall through to SDK path below ---
```

> **Implementation note:** The exact location of the `importAgent` call and the return statement must match what the existing SDK path does. Read the existing `spawnAdhocAgent` return shape from the current code — it returns `SpawnLocalAgentResult`. The opencode branch must register the session in `adhocSessions` and call `importAgent` with the same args before returning.

- [ ] **Step 5.2: Typecheck**

```bash
npm run typecheck 2>&1 | head -30
```

Expected: zero errors

- [ ] **Step 5.3: Run adhoc-agent tests**

```bash
npm test -- adhoc-agent --reporter=verbose 2>&1 | tail -30
```

Expected: all existing tests still PASS

- [ ] **Step 5.4: Commit**

```bash
git add src/main/adhoc-agent.ts
git commit -m "feat(opencode): add opencode multi-turn support for adhoc/assistant agents"
```

---

## Task 6: Settings UI

**Files:**
- Modify: `src/renderer/src/components/settings/ModelsSection.tsx`
- Modify: `src/renderer/src/components/settings/__tests__/ModelsSection.test.tsx`

- [ ] **Step 6.1: Write failing tests for opencode radio rendering**

Open `src/renderer/src/components/settings/__tests__/ModelsSection.test.tsx` and add:

```tsx
describe('opencode backend option', () => {
  it('renders opencode radio button for pipeline row', () => {
    // render ModelsSection with a pipeline row set to opencode
    // assert the opencode radio is present and checked
    // This test structure mirrors existing BackendToggle tests in the file
  })

  it('opencode radio is disabled for synthesizer and copilot rows', () => {
    // assert disabled attribute on opencode radio for non-supported types
  })

  it('shows model text field and executable field when opencode is selected', () => {
    // assert both fields render when backend === 'opencode'
  })
})
```

> **Note:** Look at the existing test file structure and mirror the render setup exactly — it likely uses `@testing-library/react` with `render()`. Add tests that follow the same pattern as the existing `BackendToggle` tests.

- [ ] **Step 6.2: Run to verify they fail**

```bash
npm test -- ModelsSection --reporter=verbose 2>&1 | tail -20
```

Expected: FAIL (tests not yet implemented correctly, or components not yet updated)

- [ ] **Step 6.3: Update `ModelsSection.tsx`**

Apply these changes to `src/renderer/src/components/settings/ModelsSection.tsx`:

1. Add `supportsOpencode` flag to `AgentTypeMeta`:

```ts
interface AgentTypeMeta {
  id: AgentTypeId
  label: string
  description: string
  supportsLocal: boolean
  supportsOpencode: boolean
}
```

2. Update `AGENT_TYPES` array — opencode supported for pipeline, adhoc, assistant, reviewer; not synthesizer or copilot:

```ts
const AGENT_TYPES: AgentTypeMeta[] = [
  { id: 'pipeline', label: 'Pipeline', description: 'Executes sprint tasks end-to-end.', supportsLocal: true, supportsOpencode: true },
  { id: 'synthesizer', label: 'Synthesizer', description: 'Drafts spec documents from task titles.', supportsLocal: false, supportsOpencode: false },
  { id: 'copilot', label: 'Copilot', description: 'Interactive pair-programming agent.', supportsLocal: false, supportsOpencode: false },
  { id: 'assistant', label: 'Assistant', description: 'One-shot Q&A over the repo.', supportsLocal: false, supportsOpencode: true },
  { id: 'adhoc', label: 'Adhoc', description: 'Freeform agent runs outside the sprint pipeline.', supportsLocal: false, supportsOpencode: true },
  { id: 'reviewer', label: 'Reviewer', description: 'Reviews PRs before merge.', supportsLocal: false, supportsOpencode: true }
]
```

3. Update `defaultBackendSettings()` to include `opencodeExecutable`:

```ts
function defaultBackendSettings(): BackendSettings {
  return {
    pipeline: { ...DEFAULT_ROW },
    synthesizer: { ...DEFAULT_ROW },
    copilot: { ...DEFAULT_ROW },
    assistant: { ...DEFAULT_ROW },
    adhoc: { ...DEFAULT_ROW },
    reviewer: { ...DEFAULT_ROW },
    localEndpoint: DEFAULT_LOCAL_ENDPOINT,
    opencodeExecutable: 'opencode'
  }
}
```

4. Add `opencodeExecutable` state and update the settings card. Add a new `SettingsCard` for opencode configuration (below the existing local backend card, before the active routing card):

```tsx
<SettingsCard
  title="Opencode backend"
  subtitle="Path to the opencode binary. Defaults to 'opencode' (PATH lookup)."
>
  <label className="settings-field">
    <span className="settings-field__label">Executable path</span>
    <input
      className="settings-field__input"
      type="text"
      value={settings.opencodeExecutable ?? 'opencode'}
      onChange={(e) =>
        setSettings((s) => ({ ...s, opencodeExecutable: e.target.value }))
      }
      placeholder="opencode"
    />
  </label>
</SettingsCard>
```

5. Update `AgentTypeRow` to pass `canUseOpencode`:

```tsx
{AGENT_TYPES.map((type) => (
  <AgentTypeRow
    key={type.id}
    type={type}
    value={settings[type.id]}
    onChange={(next) => updateRow(type.id, next)}
    canUseLocal={type.supportsLocal}
    canUseOpencode={type.supportsOpencode}
  />
))}
```

6. Update `AgentTypeRowProps`:

```ts
interface AgentTypeRowProps {
  type: AgentTypeMeta
  value: AgentBackendConfig
  onChange: (next: AgentBackendConfig) => void
  canUseLocal: boolean
  canUseOpencode: boolean
}
```

7. Update `AgentTypeRow` component to pass `canUseOpencode` to `BackendToggle`:

```tsx
function AgentTypeRow({ type, value, onChange, canUseLocal, canUseOpencode }: AgentTypeRowProps): React.JSX.Element {
  function toggleBackend(next: BackendKind): void {
    if (next === value.backend) return
    const defaultModel = next === 'claude' ? DEFAULT_CLAUDE_MODEL : ''
    onChange({ backend: next, model: defaultModel })
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
          canUseOpencode={canUseOpencode}
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

8. Update `BackendToggleProps` and `BackendToggle` to add the opencode radio:

```ts
interface BackendToggleProps {
  value: BackendKind
  onChange: (next: BackendKind) => void
  canUseLocal: boolean
  canUseOpencode: boolean
  rowId: string
}

const OPENCODE_UNSUPPORTED_TOOLTIP = 'Opencode support for this agent type is coming in a future update'

function BackendToggle({ value, onChange, canUseLocal, canUseOpencode, rowId }: BackendToggleProps): React.JSX.Element {
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
        title={canUseLocal ? undefined : LOCAL_UNSUPPORTED_TOOLTIP}
        onClick={() => onChange('local')}
        className="models-seg__btn"
      >
        Local
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={value === 'opencode'}
        data-value="opencode"
        disabled={!canUseOpencode}
        title={canUseOpencode ? undefined : OPENCODE_UNSUPPORTED_TOOLTIP}
        onClick={() => onChange('opencode')}
        className="models-seg__btn"
      >
        Opencode
      </button>
    </div>
  )
}
```

9. Update `ModelPicker` to handle opencode backend (same text input as local, different placeholder):

```tsx
function ModelPicker({ backend, model, onChange }: ModelPickerProps): React.JSX.Element {
  if (backend === 'claude') {
    return (
      <select
        className="settings-field__input"
        value={model || DEFAULT_CLAUDE_MODEL}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Claude model"
      >
        {CLAUDE_MODELS.map((m) => (
          <option key={m.id} value={m.modelId}>
            {m.label}
          </option>
        ))}
      </select>
    )
  }
  const placeholder = backend === 'opencode' ? 'opencode/gpt-5-nano' : LOCAL_MODEL_PLACEHOLDER
  const label = backend === 'opencode' ? 'Opencode model' : 'Local model'
  return (
    <input
      className="settings-field__input"
      type="text"
      value={model}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      aria-label={label}
    />
  )
}
```

- [ ] **Step 6.4: Update the Active Routing card subtitle** to mention opencode:

Find this line in `ModelsSection.tsx`:
```tsx
subtitle="Route each agent type to Claude or a local model. Local backend is available for Pipeline today."
```
Replace with:
```tsx
subtitle="Route each agent type to Claude, a local model, or opencode. Opencode and Local are not available for Synthesizer and Copilot."
```

- [ ] **Step 6.5: Typecheck**

```bash
npm run typecheck 2>&1 | head -30
```

Expected: zero errors

- [ ] **Step 6.6: Run tests**

```bash
npm test -- ModelsSection --reporter=verbose 2>&1 | tail -30
```

Expected: all tests PASS (fix any test assertions that need updating for the new radio button)

- [ ] **Step 6.7: Run full test suite**

```bash
npm test 2>&1 | tail -20
```

Expected: all tests PASS

- [ ] **Step 6.8: Commit**

```bash
git add src/renderer/src/components/settings/ModelsSection.tsx \
        src/renderer/src/components/settings/__tests__/ModelsSection.test.tsx
git commit -m "feat(opencode): add opencode backend option to Settings → Models UI"
```

---

## Task 7: Module Documentation

**Files:**
- Modify: `docs/modules/agent-manager/index.md`
- Modify: `docs/modules/shared/index.md`

- [ ] **Step 7.1: Add rows to `docs/modules/agent-manager/index.md`**

Add these two rows to the table (after the `spawn-cli.ts` row makes sense logically):

```markdown
| `opencode-wire.ts` | Pure translation layer: converts one opencode `--format json` event line into zero or more synthetic Anthropic SDK wire messages consumable by `agent-event-mapper.mapRawMessage`. No I/O or side effects. | `translateOpencodeEvent`, `extractOpencodeSessionId` |
| `spawn-opencode.ts` | Spawns `opencode run` as a child process, pipes stdout through `opencode-wire.ts`, and returns an `AgentHandle` whose `messages` iterator yields synthetic wire messages. Captures `sessionID` from the first opencode event for multi-turn session resumption via `--session`. `steer()` returns `{ delivered: false }` (one-shot CLI). | `spawnOpencode`, `OpencodeSpawnOptions` |
```

- [ ] **Step 7.2: Update `docs/modules/shared/index.md`**

Find the row for `backend-settings.ts` and update the `BackendKind` description to include `'opencode'` and note the new `opencodeExecutable` field.

- [ ] **Step 7.3: Commit**

```bash
git add docs/modules/agent-manager/index.md \
        docs/modules/shared/index.md
git commit -m "chore: update module docs for opencode integration"
```

---

## Task 8: Final Verification

- [ ] **Step 8.1: Full typecheck**

```bash
npm run typecheck 2>&1 | tail -10
```

Expected: zero errors

- [ ] **Step 8.2: Full test suite**

```bash
npm test 2>&1 | tail -10
```

Expected: all tests PASS

- [ ] **Step 8.3: Lint**

```bash
npm run lint 2>&1 | tail -10
```

Expected: zero errors

- [ ] **Step 8.4: Verify git log**

```bash
git log --oneline -10
```

Expected: clean commit history with all feature commits present

---

## Self-Review Notes

**Spec coverage:**
- ✅ `opencode-wire.ts` translation layer (Task 1)
- ✅ `spawn-opencode.ts` CLI adapter (Task 2)
- ✅ `BackendKind = 'opencode'` + `opencodeExecutable` (Task 3)
- ✅ Pipeline routing via `sdk-adapter.ts` (Task 4)
- ✅ Adhoc/assistant multi-turn (Task 5)
- ✅ Settings UI for all supported types (Task 6)
- ✅ Disabled state for synthesizer/copilot with tooltip (Task 6, Step 6.3 item 2)
- ✅ Module docs (Task 7)
- ✅ Migration safety: DEFAULT_SETTINGS keeps `claude` for all types

**Reviewer agent type:** The reviewer uses the SDK's own `query()` call directly (not `spawnAgent`), similar to adhoc. Enabling opencode for reviewer requires the same approach as Task 5 applied to the reviewer spawn path. If the reviewer path is in `src/main/handlers/code-review-handlers.ts` or similar, a follow-up task should mirror the adhoc branch there. Check with `grep -r "reviewer\|spawnReviewer" src/main/` to locate it.
