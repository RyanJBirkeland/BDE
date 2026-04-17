# RBT Backend Integration

**Status:** 📋 Planned
**Relates to:** `pluggable-agent-backends-spec.md` (the design that foresaw this)
**Companion repo:** `rbt-coding-agent` at `~/Projects/git-repos/rbt-coding-agent` (M0–M7.5 complete)

## Goal

Make the `rbt-coding-agent` framework one of BDE's spawnable agent backends, selectable **per agent type** via settings, with silent per-call fallback to the existing Claude SDK path when the local backend is unreachable. The framework ships a pre-built adapter at `rbt-coding-agent/adapters/bde` whose `spawnBdeAgent(opts)` returns an `AgentHandle` that is structurally compatible with BDE's own `AgentHandle`.

After this work, a user can:

1. Open BDE settings.
2. Flip "Pipeline backend" from `claude` to `local`, set a local model (e.g. `openai/qwen/qwen3.6-35b-a3b`).
3. Submit a Pipeline task — it runs against their local LM Studio instead of Claude.
4. Everything else (Synthesizer, Copilot, Assistant, Adhoc, Reviewer) continues to use Claude exactly as today.

The integration is built per-agent-type from day one, so future expansion (e.g. "Synthesizer can also be local if you point at a 70B model") is just exposing a row in the UI — no architectural change.

## Success criteria

1. `rbt-coding-agent` is added as a `file:` dependency. `pnpm install` resolves it. BDE builds clean.
2. A `backend-selector` resolves `(agentType, settings) → { backend: 'claude' | 'local', model: string }`. Settings key is per-agent-type.
3. `spawnAgent()` consults the selector; when `backend === 'local'`, routes through a new `spawnLocalAgent` that wraps `spawnBdeAgent` from rbt-coding-agent.
4. On local-spawn failure (preflight throws, LM Studio unreachable, Aider missing), `spawnAgent` logs the reason, emits a visible "fell back to Claude" marker on the event stream, and completes the spawn via the existing Claude path. The setting stays `local` for future calls — one failure does not auto-disable.
5. Downstream consumers (drain loop, event mapper, cost tracker, watchdog, playground detection) are **unchanged**. The M3 adapter emits `SDKWireMessage`-shaped objects that BDE's existing code already handles.
6. Unit tests cover: the selector's per-agent-type routing table, the local adapter's opt forwarding, the fallback-on-failure path. Colocated in `__tests__/` folders per BDE convention.
7. Manual end-to-end run: Pipeline task routes to local Qwen, events persist correctly in BDE's agent-event storage, UI shows the run completing.

## Out of scope

- **Non-Pipeline routing.** The selector supports any agent type returning `local`, but only Pipeline currently flows through `spawnAgent`. Other types (Adhoc, Copilot, etc.) have their own dedicated spawn paths and will continue going to Claude. Consolidating all spawn paths through `spawnAgent` is a later refactor.
- **Settings UI.** Schema extension + SQLite persistence only. The UI row gets added when the developer settings panel is next updated, or via a separate follow-up.
- **Automatic model discovery.** User picks the local model string manually. No "scan LM Studio and populate a dropdown" — that's future.
- **Cost tracking beyond `$0`.** Local runs carry `cost_usd = 0`. BDE's existing cost pipeline handles that without special cases.
- **Steering through the local backend.** Aider's `--message` mode is one-shot; `AgentHandle.steer()` on the rbt-coding-agent side already returns `{ delivered: false, error: ... }` as documented. Same behavior in BDE.

## Architecture

### Data flow for a Pipeline spawn after M8

```
run-agent.ts
  └─ spawnAndWireAgent(prompt, cwd, pipelineTuning, ...)
      └─ spawnAgent({ ...opts, agentType: 'pipeline' })
          ├─ resolveBackend('pipeline', settings)       // new
          │   └─ { backend: 'local', model: 'openai/...' }
          ├─ spawnLocalAgent(opts)                      // new
          │   └─ spawnBdeAgent(opts) from rbt-coding-agent
          │       └─ spawn() → spawnAiderSession()
          │           └─ AgentHandle with SDKWireMessage stream
          └─ (returns AgentHandle; drain loop consumes as today)
```

If `spawnLocalAgent` throws: catch, log, emit fallback marker, call existing `spawnViaSdk` / `spawnViaCli` path.

### Data flow for any other spawn — unchanged

Adhoc / Copilot / Synthesizer / Assistant / Reviewer go through their own spawn helpers (`spawnAdhocAgent`, `copilot-service`, etc.). They never hit `spawnAgent`. No changes there.

## File-by-file plan

### New file: `src/main/agent-manager/backend-selector.ts`

```ts
import type { AgentType } from '../agent-system/personality/types'
import { getSettingJson, setSettingJson } from '../settings'

export type BackendKind = 'claude' | 'local'

export interface AgentBackendConfig {
  backend: BackendKind
  model: string
}

export type BackendSettings = Record<AgentType, AgentBackendConfig> & {
  localEndpoint: string
}

const SETTING_BACKEND_CONFIG = 'agents.backendConfig'

const DEFAULT_SETTINGS: BackendSettings = {
  pipeline:    { backend: 'claude', model: 'claude-opus-4-7' },
  synthesizer: { backend: 'claude', model: 'claude-opus-4-7' },
  copilot:     { backend: 'claude', model: 'claude-opus-4-7' },
  assistant:   { backend: 'claude', model: 'claude-opus-4-7' },
  adhoc:       { backend: 'claude', model: 'claude-opus-4-7' },
  reviewer:    { backend: 'claude', model: 'claude-opus-4-7' },
  localEndpoint: 'http://localhost:1234/v1'
}

export function loadBackendSettings(): BackendSettings {
  return getSettingJson<BackendSettings>(SETTING_BACKEND_CONFIG) ?? DEFAULT_SETTINGS
}

export function saveBackendSettings(next: BackendSettings): void {
  setSettingJson(SETTING_BACKEND_CONFIG, next)
}

export function resolveBackend(
  agentType: AgentType,
  settings: BackendSettings = loadBackendSettings()
): AgentBackendConfig {
  return settings[agentType]
}
```

Shape reason: BDE's settings store is SQLite-backed with JSON-serialized values (see `src/main/settings.ts`). One key, one JSON blob, typed getter. Matches the existing `SETTING_SUPABASE_URL`-style pattern.

The exact default Claude model string should be whatever BDE's current default is — I'll read it from the existing config rather than hard-coding during implementation.

### New file: `src/main/agent-manager/local-adapter.ts`

```ts
import type { AgentHandle } from './types'
import type { Logger } from '../logger'

/**
 * Thin pass-through: BDE's spawnAgent opts map 1:1 onto rbt-coding-agent's
 * SpawnOptions. The framework's adapter already emits SDKWireMessage-shaped
 * handles, so BDE's drain loop consumes them transparently.
 */
export async function spawnLocalAgent(opts: {
  prompt: string
  cwd: string
  model: string
  endpoint: string
  logger?: Logger
}): Promise<AgentHandle> {
  const { spawnBdeAgent } = await import('rbt-coding-agent/adapters/bde')

  const previousBase = process.env.OPENAI_API_BASE
  process.env.OPENAI_API_BASE = opts.endpoint
  try {
    return await spawnBdeAgent({
      prompt: opts.prompt,
      cwd: opts.cwd,
      model: opts.model
    }) as unknown as AgentHandle
  } finally {
    if (previousBase === undefined) delete process.env.OPENAI_API_BASE
    else process.env.OPENAI_API_BASE = previousBase
  }
}
```

Notes:
- Dynamic `import()` so the Electron main bundler treats `rbt-coding-agent` as a runtime dependency without eager-loading (keeps cold-start fast and avoids bundler quirks if the dep is temporarily missing during dev).
- `OPENAI_API_BASE` is scoped around the spawn — rbt-coding-agent's preflight reads it. Restoring after the call avoids polluting global env for Claude spawns in the same process.
- The `as unknown as AgentHandle` cast acknowledges that the framework's `AgentHandle` and BDE's `AgentHandle` are structurally identical but nominally distinct types across the package boundary. If TypeScript's structural matching accepts it without the cast, drop the cast.

### Modified file: `src/main/agent-manager/sdk-adapter.ts`

Minimal surgery on `spawnAgent` only. Current signature adds `agentType: AgentType`:

```ts
import type { AgentType } from '../agent-system/personality/types'
import { resolveBackend, loadBackendSettings } from './backend-selector'
import { spawnLocalAgent } from './local-adapter'

export async function spawnAgent(opts: {
  prompt: string
  cwd: string
  model: string
  agentType: AgentType       // NEW — required
  maxBudgetUsd?: number
  logger?: Logger
  pipelineTuning?: PipelineSpawnTuning
}): Promise<AgentHandle> {
  if (opts.pipelineTuning) {
    assertCwdIsInsideWorktreeBase(opts.cwd)
  }

  const settings = loadBackendSettings()
  const resolved = resolveBackend(opts.agentType, settings)

  if (resolved.backend === 'local') {
    try {
      return await spawnLocalAgent({
        prompt: opts.prompt,
        cwd: opts.cwd,
        model: resolved.model,
        endpoint: settings.localEndpoint,
        logger: opts.logger
      })
    } catch (err) {
      opts.logger?.warn(
        `[agent-manager] local backend for ${opts.agentType} failed; falling back to Claude`,
        { error: (err as Error).message }
      )
      // fall through to Claude path
    }
  }

  return spawnClaudeAgent({
    prompt: opts.prompt,
    cwd: opts.cwd,
    model: resolved.backend === 'claude' ? resolved.model : opts.model,
    maxBudgetUsd: opts.maxBudgetUsd,
    logger: opts.logger,
    pipelineTuning: opts.pipelineTuning
  })
}
```

Where `spawnClaudeAgent` is the existing body of `spawnAgent` — the SDK-then-CLI fallback block — extracted into its own function. That refactor is purely internal; public signature stays a single `spawnAgent`.

### Modified file: `src/main/agent-manager/spawn-sdk.ts` or wherever `spawnAndWireAgent` lives

The single pipeline callsite passes `agentType: 'pipeline'`:

```ts
const handle = await spawnAgent({
  prompt,
  cwd,
  model,
  agentType: 'pipeline',   // NEW
  logger,
  maxBudgetUsd,
  pipelineTuning
})
```

Requires finding the exact callsite. Grep for `spawnAgent(` under `src/main/agent-manager/` and `src/main/` — per reconnaissance the call site is inside `run-agent.ts`'s `spawnAndWireAgent` plus any test doubles. Expected count: 1–3 real call sites + mock usages.

### Modified file: `src/main/agent-manager/spawn-with-timeout` wrapper

`spawnWithTimeout` also calls `spawnAgent`. Update its signature to accept + forward `agentType`.

### Modified file: `package.json`

```diff
  "dependencies": {
+   "rbt-coding-agent": "file:../rbt-coding-agent",
    ...
  }
```

Then `pnpm install` at BDE's root. Verify TypeScript resolves `rbt-coding-agent/adapters/bde` (subpath export), no bundler complaints.

## Fallback semantics

When `spawnLocalAgent` throws — either synchronously during preflight (`InvalidCwdError`, `UnknownModelError`) or asynchronously during subprocess start — `spawnAgent` catches, logs via `opts.logger`, and proceeds down the Claude path. The caller sees a normal `AgentHandle`; downstream consumers see an ordinary Claude-SDK run.

Things we do *not* do on fallback:

- We don't flip the setting. One failure isn't evidence the user's local setup is broken; it might be a transient LM Studio restart.
- We don't surface a modal dialog. The log line + (optional) a toast notification from BDE's existing notification layer is enough.
- We don't retry the local path. If it failed, move on.

If BDE has an existing "agent event" ribbon where we could surface "ran on Claude (local unavailable)", that's a good place. If not, the logger line is the MVP.

## Tests — `__tests__/` colocated, vitest, `vi.mock()`

### `src/main/agent-manager/__tests__/backend-selector.test.ts`

```ts
describe('resolveBackend', () => {
  it('returns the per-agent-type config from settings', () => { ... })
  it('falls back to defaults when no settings have been saved', () => { ... })
  it('honours pipeline=local even if other types are claude', () => { ... })
})
```

Mock `../settings` via `vi.mock`. Six cases × two branches ≈ 8–10 test cases.

### `src/main/agent-manager/__tests__/local-adapter.test.ts`

```ts
describe('spawnLocalAgent', () => {
  it('forwards prompt/cwd/model to spawnBdeAgent', () => { ... })
  it('scopes OPENAI_API_BASE to the spawn and restores the previous value', () => { ... })
  it('propagates spawnBdeAgent errors', () => { ... })
})
```

Mock `rbt-coding-agent/adapters/bde` via `vi.mock`. Return a fake `AgentHandle` for success paths; throw for the error case.

### `src/main/agent-manager/__tests__/sdk-adapter.test.ts` (extend existing)

```ts
describe('spawnAgent — backend selection', () => {
  it('routes through spawnLocalAgent when settings say local', () => { ... })
  it('routes through Claude path when settings say claude', () => { ... })
  it('falls back to Claude when local throws, logging the reason', () => { ... })
})
```

## Downstream — zero changes, verified

BDE's downstream code (drain loop, event mapper, cost tracker, watchdog, playground detection) consumes `SDKWireMessage` objects. The rbt-coding-agent adapter emits them in the flat top-level shape BDE expects:

- `{ type: 'system', session_id }` on start.
- `{ type: 'assistant', message: { role, content: [...] } }` for assistant text + tool use.
- `{ type: 'tool_result', tool_name, content, is_error }` top-level — which is what `detectPlaygroundWrite()` inspects (it reads `m.type === 'tool_result'`, `m.tool_name`, `m.input?.file_path`, all top-level — see `playground-handler.ts:42–58`). Adapter matches.
- `{ type: 'result', exit_code, cost_usd: 0, total_cost_usd: 0, model }` on end.

M3's live-integration test (`tests/integration/framework-behavior.test.ts` in rbt-coding-agent) already exercises this path end-to-end against real Qwen. No surprises expected.

## Rollout

- Ship with `backend: 'claude'` for every agent type in `DEFAULT_SETTINGS`. No behavior change for existing users.
- Developer (Ryan) flips `pipeline.backend` to `'local'` manually (via SQL against the `settings` table, or a dev panel), points `model` at `openai/qwen/qwen3.6-35b-a3b`, dogfoods.
- Once stable, a later change exposes the toggle in the settings UI.
- Default never changes to `local`; it's always opt-in.

## Known risks

| Risk | Mitigation |
|---|---|
| `file:` dependency + Electron bundler surprises | Use dynamic `import()` inside `spawnLocalAgent` so the dep loads at runtime, not during bundling. Verify after `pnpm install` |
| rbt-coding-agent's `AgentHandle` and BDE's `AgentHandle` are nominally distinct types | Structural typing + a `as unknown as AgentHandle` cast at the boundary. If structural match holds without cast, drop it |
| `OPENAI_API_BASE` leaks across concurrent spawns | Scope it around the spawn via `try/finally`. If concurrent local spawns become a thing, pass per-call env via a different mechanism |
| Claude-path fallback produces a confusingly different result than a local run | Log + event marker; user sees which backend actually handled the run |
| Adding `agentType` as a required field breaks existing `spawnAgent` callers | Only one real call site (pipeline) + some test mocks. Update all in the same commit |
| Pipeline worktree assertion (`assertCwdIsInsideWorktreeBase`) runs before backend selection | Preserved behavior — asserting on cwd is independent of which backend runs. Runs unchanged for both paths |

## Decisions resolved at kickoff

1. **Per-agent-type or global?** Per-agent-type. Settings keys `pipeline / synthesizer / copilot / assistant / adhoc / reviewer`, each with its own `backend + model`.
2. **Only Pipeline wired in M8?** Yes. Other types' spawn paths aren't consolidated yet; their rows in settings are for future expansion.
3. **Fallback on local failure?** Silent Claude fallback per call, logged. Setting stays `local`.
4. **Defaults?** Every type starts `claude` with BDE's existing default model. Zero behavior change at ship.
5. **Dependency mechanism?** `file:../rbt-coding-agent`. Dynamic `import()` at call time to sidestep bundler quirks.
6. **Settings UI?** Not in M8. Schema + SQLite persistence; UI lands later.

## Completion checklist

- [ ] `BDE/package.json` adds `"rbt-coding-agent": "file:../rbt-coding-agent"`, `pnpm install` succeeds
- [ ] `src/main/agent-manager/backend-selector.ts` created with `resolveBackend`, `loadBackendSettings`, `saveBackendSettings`, typed exports
- [ ] `src/main/agent-manager/local-adapter.ts` created with `spawnLocalAgent`
- [ ] `src/main/agent-manager/sdk-adapter.ts` modified: extract existing body into `spawnClaudeAgent`, add `agentType` to `spawnAgent` opts, route through selector + fallback
- [ ] `spawnWithTimeout` + pipeline call site(s) pass `agentType: 'pipeline'`
- [ ] Three `__tests__/` files for selector / local-adapter / sdk-adapter backend routing
- [ ] `pnpm test` green in BDE
- [ ] Manual end-to-end: Pipeline task routes to local Qwen with LM Studio running; events reach event mapper; UI shows completion
- [ ] Manual fallback test: LM Studio off, task routes to Claude with a "fell back" log
- [ ] Single BDE commit: `feat: route Pipeline through rbt-coding-agent when configured (M8)` (or matching BDE convention)
- [ ] rbt-coding-agent side: `package.json` version 0.1.0, README note; one commit there
- [ ] Neither pushed until user confirms
