# AX-S1: Typed IPC Channel Map

**Epic:** Architecture & DX
**Priority:** P1
**Size:** L (Large)
**Depends on:** AX-S2 (remove dead channels first)

---

## Problem

The IPC bridge has no compile-time type safety. The `safeHandle()` utility in `src/main/ipc-utils.ts:4-16` uses `any[]` args and `any` return:

```typescript
// src/main/ipc-utils.ts:6
handler: (e: Electron.IpcMainInvokeEvent, ...args: any[]) => any
```

This means:

1. Channel names are unchecked strings — a typo in `'local:spawnClaudeAgent'` compiles fine
2. Payload shapes are not validated between preload and main — the preload declares `(args: SpawnLocalAgentArgs)` but the handler receives `...args: any[]`
3. Return types are implicitly `any` — a handler returning the wrong shape is invisible to TypeScript
4. The 44 IPC channels are manually synchronized between `src/preload/index.ts` and `src/main/handlers/*.ts`

## Goal

Define a single `IpcChannelMap` type that maps every channel name to its `(request, response)` tuple. Both `safeHandle()` and the preload bridge derive their types from this map, providing end-to-end compile-time safety.

## Design

### 1. Define the channel map in `src/shared/ipc-channels.ts`

```typescript
// src/shared/ipc-channels.ts
import type { AgentMeta, SpawnLocalAgentArgs, SpawnLocalAgentResult } from './types'

export interface IpcChannelMap {
  // Config
  'get-gateway-config': { args: []; result: { url: string; token: string } }
  'get-github-token': { args: []; result: string | null }
  'save-gateway-config': { args: [url: string, token: string]; result: void }
  'get-supabase-config': { args: []; result: { url: string; anonKey: string } | null }

  // Git client
  'git:status': {
    args: [cwd: string]
    result: { files: { path: string; status: string; staged: boolean }[] }
  }
  'git:diff': { args: [cwd: string, file?: string]; result: string }
  'git:stage': { args: [cwd: string, files: string[]]; result: void }
  'git:unstage': { args: [cwd: string, files: string[]]; result: void }
  'git:commit': { args: [cwd: string, message: string]; result: void }
  'git:push': { args: [cwd: string]; result: string }
  'git:branches': { args: [cwd: string]; result: { current: string; branches: string[] } }
  'git:checkout': { args: [cwd: string, branch: string]; result: void }

  // ... (all 38+ live channels)

  // Terminal
  'terminal:create': {
    args: [opts: { cols: number; rows: number; shell?: string }]
    result: number
  }
  'terminal:resize': { args: [opts: { id: number; cols: number; rows: number }]; result: void }
  'terminal:kill': { args: [id: number]; result: void }
}
```

### 2. Derive `safeHandle()` from the map

```typescript
// src/main/ipc-utils.ts
import type { IpcChannelMap } from '../shared/ipc-channels'

export function safeHandle<K extends keyof IpcChannelMap>(
  channel: K,
  handler: (
    e: Electron.IpcMainInvokeEvent,
    ...args: IpcChannelMap[K]['args']
  ) => IpcChannelMap[K]['result'] | Promise<IpcChannelMap[K]['result']>
): void {
  ipcMain.handle(channel, async (e, ...args) => {
    try {
      return await handler(e, ...(args as IpcChannelMap[K]['args']))
    } catch (err) {
      console.error(`[IPC:${channel}] unhandled error:`, err)
      throw err
    }
  })
}
```

### 3. Derive preload API from the map

```typescript
// src/preload/index.ts
type PreloadApi = {
  [K in keyof IpcChannelMap]: (
    ...args: IpcChannelMap[K]['args']
  ) => Promise<IpcChannelMap[K]['result']>
}
```

The actual preload object can keep its current nested structure (`api.agents.list`, `api.terminal.create`) by grouping channels by prefix. The channel map remains flat.

### 4. Fire-and-forget channels

`terminal:write` and `set-title` use `ipcMain.on()` (no return value). Define a separate `IpcFireAndForgetMap`:

```typescript
export interface IpcFireAndForgetMap {
  'terminal:write': { args: [opts: { id: number; data: string }] }
  'set-title': { args: [title: string] }
}
```

## Files to Change

| File                         | Change                                                               |
| ---------------------------- | -------------------------------------------------------------------- |
| `src/shared/ipc-channels.ts` | **New** — channel map type definitions                               |
| `src/shared/types.ts`        | Add any missing payload types (e.g., `TailLogArgs`, `TailLogResult`) |
| `src/main/ipc-utils.ts`      | Replace `any` with generic `K extends keyof IpcChannelMap`           |
| `src/preload/index.ts`       | Derive API types from channel map                                    |
| `src/preload/index.d.ts`     | Regenerate from channel map                                          |
| `src/main/handlers/*.ts`     | Update `safeHandle` calls — TypeScript will surface mismatches       |

## Acceptance Criteria

- [ ] `safeHandle()` has zero `any` types
- [ ] A channel name typo in any handler file causes a compile error
- [ ] A payload shape mismatch between preload and handler causes a compile error
- [ ] `npm run build` passes with no new `any` suppressions
- [ ] No behavioral changes — pure type refactor

## Risks

- **Large surface area:** 38+ channels to type. Mitigated by: doing AX-S2 first (removes 8 dead channels), then typing remaining 36.
- **Nested preload API:** The `api.agents.*` / `api.terminal.*` structure doesn't directly map from a flat channel map. May need a `ChannelGroup` utility type.
