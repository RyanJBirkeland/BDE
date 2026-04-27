# Opencode Integration Design

**Date:** 2026-04-22
**Status:** Approved

## Overview

Add `'opencode'` as a first-class agent backend alongside `'claude'` and `'local'`. Users choose their backend per agent type in Settings → Models. The experience is identical regardless of backend — same streaming output, same cost tracking, same Code Review Station flow.

Opencode is an open-source AI coding agent (`opencode run`) that supports 75+ LLM providers via OpenAI-compatible APIs. It runs locally, is installed on the machine, and is invoked non-interactively via `opencode run "<prompt>" --format json`.

## Scope

**In scope:** Pipeline, Adhoc, Assistant, Reviewer agent types.

**Out of scope (follow-up):** Synthesizer and Copilot. Both bypass `AgentHandle` and call the Anthropic SDK directly for streaming — enabling opencode for those types needs a separate spawn path that does not exist yet. Settings UI will show them as Claude-only with an explanatory tooltip.

## Architecture

The integration adds a new `spawn-opencode.ts` adapter that bridges opencode's CLI event stream into BDE's existing `AgentHandle` contract. All downstream machinery — drain loop, watchdog, `consumeMessages`, `agent-event-mapper`, cost tracker, Code Review Station — is unchanged.

### Backend kind

```ts
// src/shared/types/backend-settings.ts
export type BackendKind = 'claude' | 'local' | 'opencode'

export interface BackendSettings {
  // ... existing fields ...
  opencodeExecutable?: string  // defaults to 'opencode' (PATH lookup)
}
```

### Spawn path

```
drain loop
  → spawnWithTimeout()
    → spawnAgent({ backend: 'opencode' })
      → spawnOpencode(prompt, cwd, model, sessionId?)
        → child_process: opencode run "<prompt>" --format json --dir <cwd> -m <model> [-s <sessionId>]
        → opencode-wire.ts translates each JSON line → SDKWireMessage[]
        → AgentHandle.messages emits translated messages
  → consumeMessages()        [unchanged]
    → mapRawMessage()        [unchanged]
      → AgentEvent[] → broadcast + SQLite
```

### Multi-turn sessions (Adhoc / Assistant)

Opencode issues a `sessionID` in its first event. `spawn-opencode.ts` captures it and exposes it as `handle.sessionId`. After the first turn completes, `adhoc-agent.ts` reads `handle.sessionId` and stores it. On subsequent turns it passes the stored ID as `opts.sessionId` into `spawnAgent`, which forwards it to `spawnOpencode` as `--session <id>` so opencode resumes the same conversation. This is transparent to the user — the experience matches the Claude SDK's `resume: sessionId` behaviour.

`spawnAgent`'s opts interface gains `sessionId?: string` to carry this value through. The pipeline path never sets it (each task is a fresh session).

## New Files

### `src/main/agent-manager/opencode-wire.ts`

Pure translation layer — no side effects, no process spawning. Takes a single opencode JSON event string and returns zero or more synthetic Anthropic-format `SDKWireMessage` objects. Fully unit-testable with fixture data.

**Translation table:**

| Opencode event | Synthetic wire messages emitted |
|---|---|
| `step_start` | `message_start` |
| `text` | `content_block_start(text)` + `content_block_delta` + `content_block_stop` |
| `tool_use` (completed) | `content_block_start(tool_use)` + `message_delta(tool_use)` + `message_stop` + synthetic `user` message with `tool_result` |
| `step_finish` (reason=`stop`, last step) | `message_delta(end_turn)` + `message_stop` |
| `step_finish` (reason=`tool-calls`) | `message_delta(tool_use)` + `message_stop` |
| `error` | synthetic assistant `text` block with the error message |

Cost data: `step_finish.part.tokens` (input/output/total) and `part.cost` (USD float) are mapped directly into `message_delta.usage` so BDE's existing cost tracker picks them up without modification.

### `src/main/agent-manager/spawn-opencode.ts`

Spawns the opencode process, pipes stdout line-by-line through `opencode-wire.ts`, and yields synthetic wire messages via an async generator. Returns an `AgentHandle`.

```ts
export interface OpencodeSpawnOptions {
  readonly prompt: string
  readonly cwd: string
  readonly model: string            // format: "provider/model"
  readonly sessionId?: string       // omit on first turn
  readonly executable?: string      // defaults to 'opencode'
  readonly logger?: Logger
}

export async function spawnOpencode(opts: OpencodeSpawnOptions): Promise<AgentHandle>
```

`abort()` sends SIGTERM to the child process.

`steer()` returns `{ delivered: false, error: 'steer not supported for opencode backend' }` — the CLI is one-shot per invocation.

## Modified Files

### `src/main/agent-manager/backend-selector.ts`

- Add `opencode` config to `DEFAULT_SETTINGS` (backend=`'claude'` so existing users are unaffected)
- Add `opencodeExecutable` to `BackendSettings` with default `'opencode'`
- `mergeWithDefaults` fills in the new field

### `src/main/agent-manager/sdk-adapter.ts`

Add a `'opencode'` branch in `spawnAgent()`:

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

### `src/renderer/src/components/settings/ModelsSection.tsx`

- Add `'opencode'` to `BackendKind` radio options for in-scope agent types
- When `'opencode'` is selected: show model field (placeholder: `opencode/gpt-5-nano`) and optional executable path field (placeholder: `opencode`)
- Synthesizer and Copilot rows: disable the `'opencode'` radio with tooltip "Opencode support for this agent type is coming in a future update"
- `supportsOpencode` flag on each `AgentTypeMeta` (mirrors existing `supportsLocal`)

## Error Handling

| Scenario | Handling |
|---|---|
| `opencode` not on PATH / bad executable | Throws at spawn time → task marked `error` with message pointing to Settings |
| Opencode emits `{"type":"error"}` event | Translated to synthetic assistant error text → existing failure classifier handles it |
| Process exits non-zero | `messages` iterator closes with error → same watchdog/retry path as Claude |
| Model not found | Opencode emits `error` immediately → classified as `error`, not retried (fast-fail) |
| `steer()` called | Returns `{ delivered: false }` — documented limitation |
| Session ID missing on first event | `handle.sessionId` returns empty string; adhoc-agent skips resumption — next turn starts a fresh opencode session |

## Testing

**`opencode-wire.test.ts`** — unit tests for the translation layer using fixture JSON lines captured from the real opencode event stream (step_start, text, tool_use, step_finish, error). No process spawning.

**`ModelsSection.test.tsx`** — extend existing tests to cover the `'opencode'` radio rendering and disabled-state behaviour for synthesizer/copilot.

No new integration tests needed. The existing pipeline integration tests cover `consumeMessages` / `mapRawMessage`; the translator is the only net-new logic requiring dedicated coverage.

## Migration

Zero impact on existing users. `mergeWithDefaults` fills `opencode` config as `{ backend: 'claude', model: DEFAULT_MODEL }` for all agent types, so stored settings from before this change continue to work without any migration script.

## Open Questions

None — all design decisions were made during brainstorming.
