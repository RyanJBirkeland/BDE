# E1-PR4: Type the IPC channel map

## Prereqs

- E1-PR2 should be merged first (it changes git-handlers.ts, which this PR also touches).
- E1-PR3 should be merged first (it changes config.ts exports, which affects handler signatures).

If building on top of unmerged PRs is acceptable, this can be started in parallel and rebased.

## What This PR Does

`src/shared/ipc-channels.ts` defines `IpcChannelMap` with only 9 typed channels out of ~54 total IPC registrations. This PR adds all remaining channels to the map, converts all `safeHandle()` calls to use the typed overload, converts all preload `ipcRenderer.invoke()` calls to use `typedInvoke()`, and removes the untyped `safeHandle` overload.

---

### Step 1. Extend `IpcChannelMap` in `src/shared/ipc-channels.ts`

Open `src/shared/ipc-channels.ts`. After the existing entries (ending at line 77 with `'terminal:create'`), add entries for every remaining channel. Import additional types as needed at the top.

Add to the imports at line 12:

```ts
import type { SpawnLocalAgentArgs, SpawnLocalAgentResult, AgentMeta, AgentCostRecord, AgentRunCostRow, CostSummary, SprintTask, PrListPayload } from './types'
```

Add to `IpcChannelMap` before the closing `}`:

```ts
  // --- Git (remaining) ---
  'git:getRepoPaths': {
    args: []
    result: Record<string, string>
  }
  'git:stage': {
    args: [cwd: string, files: string[]]
    result: void
  }
  'git:unstage': {
    args: [cwd: string, files: string[]]
    result: void
  }
  'git:commit': {
    args: [cwd: string, message: string]
    result: void
  }
  'git:push': {
    args: [cwd: string]
    result: string
  }
  'git:branches': {
    args: [cwd: string]
    result: { current: string; branches: string[] }
  }
  'git:checkout': {
    args: [cwd: string, branch: string]
    result: void
  }

  // --- PR ---
  'pr:pollStatuses': {
    args: [prs: { taskId: string; prUrl: string }[]]
    result: { taskId: string; merged: boolean; state: string; mergedAt: string | null; mergeableState: string | null }[]
  }
  'pr:checkConflictFiles': {
    args: [input: { owner: string; repo: string; prNumber: number }]
    result: { prNumber: number; files: string[]; baseBranch: string; headBranch: string }
  }
  'pr:getList': {
    args: []
    result: PrListPayload
  }
  'pr:refreshList': {
    args: []
    result: PrListPayload
  }

  // --- Agents ---
  'local:getAgentProcesses': {
    args: []
    result: { pid: number; bin: string; args: string; cwd: string | null; startedAt: number; cpuPct: number; memMb: number }[]
  }
  'local:sendToAgent': {
    args: [args: { pid: number; message: string }]
    result: { ok: boolean; error?: string }
  }
  'local:isInteractive': {
    args: [pid: number]
    result: boolean
  }
  'local:tailAgentLog': {
    args: [args: { logPath: string; fromByte?: number }]
    result: { content: string; nextByte: number }
  }
  'agent:steer': {
    args: [args: { agentId: string; message: string }]
    result: { ok: boolean; error?: string }
  }
  'agent:kill': {
    args: [agentId: string]
    result: { ok: boolean; error?: string }
  }
  'agent:killLocal': {
    args: [pid: number]
    result: { ok: boolean; error?: string }
  }
  'agents:list': {
    args: [args: { limit?: number; status?: string }]
    result: AgentMeta[]
  }
  'agents:readLog': {
    args: [args: { id: string; fromByte?: number }]
    result: { content: string; nextByte: number }
  }
  'agents:import': {
    args: [args: { meta: Partial<AgentMeta>; content: string }]
    result: AgentMeta
  }

  // --- Cost ---
  'cost:summary': {
    args: []
    result: CostSummary
  }
  'cost:agentRuns': {
    args: [args: { limit?: number }]
    result: AgentRunCostRow[]
  }
  'cost:getAgentHistory': {
    args: [args?: { limit?: number; offset?: number }]
    result: AgentCostRecord[]
  }

  // --- Sprint ---
  'sprint:list': {
    args: []
    result: SprintTask[]
  }
  'sprint:create': {
    args: [task: { title: string; repo: string; prompt?: string; notes?: string; spec?: string; priority?: number; status?: string }]
    result: unknown
  }
  'sprint:update': {
    args: [id: string, patch: Record<string, unknown>]
    result: unknown
  }
  'sprint:delete': {
    args: [id: string]
    result: { ok: boolean }
  }
  'sprint:readSpecFile': {
    args: [filePath: string]
    result: string
  }
  'sprint:generatePrompt': {
    args: [args: { taskId: string; title: string; repo: string; templateHint: string }]
    result: { taskId: string; spec: string; prompt: string }
  }
  'sprint:healthCheck': {
    args: []
    result: SprintTask[]
  }
  'sprint:readLog': {
    args: [agentId: string, fromByte?: number]
    result: { content: string; status: string; nextByte: number }
  }

  // --- Window ---
  'window:openExternal': {
    args: [url: string]
    result: void
  }

  // --- Memory ---
  'memory:listFiles': {
    args: []
    result: { path: string; name: string; size: number; modifiedAt: number }[]
  }
  'memory:readFile': {
    args: [path: string]
    result: string
  }
  'memory:writeFile': {
    args: [path: string, content: string]
    result: void
  }

  // --- File system ---
  'fs:openFileDialog': {
    args: [opts?: { filters?: { name: string; extensions: string[] }[] }]
    result: string[] | null
  }
  'fs:readFileAsBase64': {
    args: [path: string]
    result: { data: string; mimeType: string; name: string }
  }
  'fs:readFileAsText': {
    args: [path: string]
    result: { content: string; name: string }
  }

  // --- Gateway RPC ---
  'gateway:invoke': {
    args: [tool: string, args: Record<string, unknown>]
    result: unknown
  }
  'gateway:getSessionHistory': {
    args: [sessionKey: string]
    result: unknown
  }

  // --- Terminal (remaining) ---
  'terminal:resize': {
    args: [args: { id: number; cols: number; rows: number }]
    result: void
  }
  'terminal:kill': {
    args: [id: number]
    result: void
  }
```

### Step 2. Convert all `safeHandle()` calls to typed versions

Go through each handler file and ensure channel names match `IpcChannelMap` keys exactly. Remove the `TODO: AX-S1` comments.

Files to update:
- `src/main/handlers/git-handlers.ts` — lines 69–92: remove TODO comments, channel names already match
- `src/main/handlers/agent-handlers.ts` — all `safeHandle` calls
- `src/main/handlers/cost-handlers.ts` — all `safeHandle` calls
- `src/main/handlers/cost.ts` — all `safeHandle` calls
- `src/main/handlers/sprint.ts` — lines 64–171: all `safeHandle` calls
- `src/main/handlers/terminal-handlers.ts` — all `safeHandle` calls
- `src/main/handlers/window-handlers.ts` — all `safeHandle` calls
- `src/main/handlers/config-handlers.ts` — already typed
- `src/main/handlers/gateway-handlers.ts` — all `safeHandle` calls
- `src/main/fs.ts` — all `safeHandle` calls

For each file, the channel string must exactly match a key in `IpcChannelMap`. The TypeScript compiler will enforce argument types once the untyped overload is removed.

### Step 3. Convert all preload `ipcRenderer.invoke()` calls to `typedInvoke()`

In `src/preload/index.ts`, replace every raw `ipcRenderer.invoke('channel', ...)` call with `typedInvoke('channel', ...)`. There are approximately 44 calls that need conversion (lines 27–228).

For example, line 27:

```ts
// BEFORE:
getRepoPaths: (): Promise<Record<string, string>> => ipcRenderer.invoke('git:getRepoPaths'),

// AFTER:
getRepoPaths: () => typedInvoke('git:getRepoPaths'),
```

The return type annotation can be removed because `typedInvoke` infers it from `IpcChannelMap`.

Repeat for every `ipcRenderer.invoke()` call. The `ipcRenderer.send()` calls (like `terminal:write` and `window:setTitle`) are fire-and-forget push events — leave those as-is for now.

### Step 4. Update `src/preload/index.d.ts` to derive types from `IpcChannelMap`

In `src/preload/index.d.ts`, update method signatures to use `IpcChannelMap` types wherever possible. Many already do (lines 14–17, 44, 56–57). Convert the remaining ones.

### Step 5. Remove the untyped `safeHandle` overload

In `src/main/ipc-utils.ts`, delete the untyped overload (lines 19–22):

```ts
// DELETE these lines:
export function safeHandle<TArgs extends unknown[] = unknown[]>(
  channel: string,
  handler: (e: Electron.IpcMainInvokeEvent, ...args: TArgs) => unknown
): void
```

This leaves only the typed overload (lines 8–14). Any channel not in `IpcChannelMap` will now be a compile error.

### Step 6. Remove all `TODO: AX-S1` comments

```bash
grep -rn "AX-S1" src/ --include="*.ts" --include="*.tsx"
```

Delete every line containing `TODO: AX-S1`.

### Step 7. Build and test

```bash
npm run typecheck
npm test
npm run build
```

This step will likely surface type mismatches where handler arg types don't match the map. Fix each one. This is the main work of this PR — the compiler is now your guide.

### Step 8. Commit and open PR

```bash
git checkout -b refactor/e1-pr4-type-ipc-channels
git add src/shared/ipc-channels.ts src/preload/index.ts src/preload/index.d.ts src/main/ipc-utils.ts src/main/handlers/ src/main/fs.ts
git commit -m "feat: complete IpcChannelMap — all 54 IPC channels typed, untyped overload removed"
gh pr create --base main --title "E1-PR4: Type the IPC channel map — 100% coverage" --body "## Summary
- IpcChannelMap expanded from 9 to 54 channels (100% coverage)
- All safeHandle() calls use typed overload
- All preload ipcRenderer.invoke() calls converted to typedInvoke()
- Untyped safeHandle overload removed — channel typos are now compile errors
- All TODO: AX-S1 markers removed

## Test plan
- [ ] npm run typecheck passes (this is the main verification)
- [ ] npm test passes
- [ ] npm run build succeeds
- [ ] Smoke test: navigate all 6 views, spawn an agent, open a diff"
```

Stop after opening the PR. Do not merge.
