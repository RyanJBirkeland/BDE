# Preload Bridge God Module Audit — Team 3 (Shared IPC)
**Date:** 2026-04-13  
**Scope:** Preload bridge (src/preload/) responsibilities, namespace design, and onBroadcast pattern consistency  
**Files Examined:**
- `/Users/ryan/projects/BDE/src/preload/index.ts`
- `/Users/ryan/projects/BDE/src/preload/index.d.ts` (497 lines)
- `/Users/ryan/projects/BDE/src/preload/api-*.ts` (6 domain modules)
- `/Users/ryan/projects/BDE/src/preload/ipc-helpers.ts`

---

## F-t3-pre-1: Flat Namespace with 76 Top-Level API Properties

**Severity:** High  
**Category:** Flat Namespace, Missing Domain Grouping  
**Location:** `/Users/ryan/projects/BDE/src/preload/index.ts:88-209`  
**Evidence:**
The `api` object exposes 76 properties: 17 grouped (settings, webhooks, github, agents, cost, sprint, groups, planner, templates, terminal, dashboard, system, workbench, tearoff, review, repoDiscovery, agentManager, claudeConfig), but 59 flat at the root level:
- readClipboardImage, openExternal, openPlaygroundInBrowser, setTitle (window)
- getRepoPaths, gitStatus, gitDiff, gitStage, gitUnstage, gitCommit, gitPush, gitBranches, gitCheckout, gitDetectRemote, gitFetch, gitPull (git)
- listMemoryFiles, readMemoryFile, writeMemoryFile, searchMemory, getActiveMemoryFiles, setMemoryFileActive (memory)
- getAgentProcesses, spawnLocalAgent, steerAgent, killAgent, getLatestCacheTokens, tailAgentLog, agentEvents (agents)
- pollPrStatuses, checkConflictFiles, onPrListUpdated, getPrList, refreshPrList, onGitHubError (PR)
- onDirChanged, openFileDialog, readFileAsBase64, readFileAsText, openDirectoryDialog, readDir, readFile, writeFile, watchDir, unwatchDir, createFile, createDir, rename, deletePath, stat, listFiles (file system)
- onExternalSprintChange, authStatus, synthesizeSpec, reviseSpec, cancelSynthesis, onSynthesizerChunk (misc broadcast/mutations)

**Impact:**
- **Discovery friction:** Renderer code must know 76 API names, making discoverability harder (no IDE autocomplete grouping hint until typing).
- **Maintenance risk:** Adding new APIs pollutes the root namespace. Hard to enforce domain boundaries.
- **Cognitive load:** Type checking and reasoning about "what domains exist" requires scanning a flat list in index.d.ts.
- **Inconsistency:** Some domains (git, memory, filesystem) are flat despite being cohesive entities. Others (sprint, workbench, tearoff) are grouped, creating unpredictable patterns.

**Recommendation:**
Group all flat functions by domain:
- Create `window`, `fs`, `git`, `memory`, `pr` namespace objects in `api-*` files.
- Export as top-level `api.window.readClipboardImage()`, `api.fs.readFile()`, `api.git.status()`, etc.
- Preserve existing grouped APIs (sprint, workbench, etc.). Update index.d.ts to mirror the grouped structure.
- Expected outcome: Reduce top-level properties from 76 to ~18 domain groups.

**Effort:** M  
**Confidence:** High

---

## F-t3-pre-2: Inconsistent onBroadcast Pattern — Custom Listener Logic in api-agents and api-utilities

**Severity:** High  
**Category:** Missing onBroadcast Pattern  
**Location:** `/Users/ryan/projects/BDE/src/preload/api-agents.ts:42-61` and `/Users/ryan/projects/BDE/src/preload/api-utilities.ts:102-109`  
**Evidence:**
Two domain modules bypass the `onBroadcast<T>()` factory:

1. **agentEvents.onEvent** (api-agents.ts:42-61):
   - Manually registers two separate listeners (`agent:event` and `agent:event:batch`).
   - Applies custom batch debouncing/aggregation logic (iterates payloads, calls callback once per item).
   - Doesn't use `onBroadcast<BroadcastChannels['agent:event']>()`.

2. **terminal.onData** (api-utilities.ts:102-109):
   - Manually registers listener with string concatenation: `'terminal:data:' + id`.
   - Doesn't use `onBroadcast<T>()`.
   - Couples preload layer to Electron's dynamic channel naming.

Compare to consistent usage:
- `onDirChanged: onBroadcast<BroadcastChannels['fs:dirChanged']>('fs:dirChanged')`
- `onGitHubError: onBroadcast<BroadcastChannels['github:error']>('github:error')`

**Impact:**
- **Maintainability:** Two separate patterns for the same problem (broadcast subscriptions) makes code harder to reason about.
- **Type safety:** agentEvents lacks type inference on the payload shape (would catch errors at compile time if using onBroadcast).
- **Refactor risk:** Changing ipcRenderer.on/off logic requires hunting down multiple implementations.
- **Coupling:** terminal.onData couples the preload to Electron's low-level event system instead of abstracting via the onBroadcast factory.

**Recommendation:**
1. Refactor `agentEvents.onEvent` to use `onBroadcast<BroadcastChannels['agent:event']>()` and handle batch consolidation *inside* the handler returned by onBroadcast, or expose both channels separately with consistent factory calls.
2. Refactor `terminal.onData` to:
   - Either create a new `onTerminalData` broadcast channel registered in ipc-channels/broadcast-channels.ts, or
   - Extend `onBroadcast<T>()` to accept a dynamic channel suffix (e.g., `onBroadcast('terminal:data:', id)` internally uses string concat but encapsulates the coupling).
3. Document in ipc-helpers.ts that all broadcast subscriptions must use `onBroadcast<T>()` or get explicit approval for exceptions.

**Effort:** M  
**Confidence:** High

---

## F-t3-pre-3: Type Declaration Sprawl — 497-line index.d.ts Mixes Unrelated Domains

**Severity:** Medium  
**Category:** Type Declaration Sprawl, God Type  
**Location:** `/Users/ryan/projects/BDE/src/preload/index.d.ts:1-497`  
**Evidence:**
A single 497-line `declare global` block defines all 76+ APIs. The file is monolithic:
- Lines 1-80: Imports + setup (IpcChannelMap, helpers, type re-exports).
- Lines 27-497: Single `interface Window.api` containing all domains flatly.
- Subsections exist as comments ("// Settings CRUD", "// Git client", etc.) but no structural separation.

Examples of unrelated domains in one interface:
- Lines 52-71: settings (CRUD).
- Lines 73-80: claudeConfig (CLI config access).
- Lines 101-105: github API proxy.
- Lines 107-127: agent spawning + streaming.
- Lines 138-150: git client.
- Lines 152-160: agents history audit trail.
- Lines 162-170: cost analytics.

**Impact:**
- **Readability:** A 497-line interface is hard to navigate, even with comments.
- **Type extraction:** Consumers must wait for the entire type file to load (no lazy type loading in TypeScript).
- **Refactoring friction:** Moving a domain requires editing the giant interface and updating all downstream types.
- **Documentation:** Comments are the only grouping mechanism; no structural hints about which APIs are related.
- **IDE experience:** Autocomplete suggests all 76+ properties equally, no hierarchy.

**Recommendation:**
1. Split index.d.ts into domain-focused type files:
   - `types/window-api.d.ts`, `types/git-api.d.ts`, `types/sprint-api.d.ts`, etc.
   - Each exports a domain interface (e.g., `export interface GitApi { gitStatus(...), gitCommit(...), ... }`).
2. In index.d.ts, import and intersect domain interfaces into a single composite Api type:
   ```typescript
   export interface Api extends WindowApi, GitApi, SprintApi, ... {}
   declare global {
     interface Window {
      api: Api
    }
   }
   ```
3. Update JSDoc comments in each domain file to document responsibilities.
4. Expected outcome: Each domain type file is <100 lines, easier to review and maintain.

**Effort:** M  
**Confidence:** High

---

## F-t3-pre-4: ipcRenderer.send() Calls Scattered Across api-utilities and api-agents

**Severity:** Medium  
**Category:** Logic in Preload, Missing Abstraction  
**Location:** `/Users/ryan/projects/BDE/src/preload/api-utilities.ts:19,98,104-105,108,153,165,170,172,174` and `/Users/ryan/projects/BDE/src/preload/api-agents.ts:54-55,57-58`  
**Evidence:**
Direct `ipcRenderer.send()` calls for fire-and-forget messages:
- `ipcRenderer.send('window:setTitle', title)` (api-utilities:19).
- `ipcRenderer.send('terminal:write', { id, data })` (api-utilities:98).
- `ipcRenderer.on('terminal:data:' + id, listener)` (api-utilities:104-105, dynamic channel).
- `ipcRenderer.once('terminal:exit:' + id, cb)` (api-utilities:108).
- `ipcRenderer.send('tearoff:returnToMain', ...)`, `tearoff:dropComplete`, `tearoff:dragCancelFromRenderer`, `tearoff:returnAll`, `tearoff:viewsChanged` (api-utilities:153,165,170,172,174).
- `ipcRenderer.on()` / `ipcRenderer.removeListener()` in agentEvents (api-agents:54-58).

These bypass both `typedInvoke()` (request/reply) and `onBroadcast()` (main→renderer), exposing low-level Electron APIs directly in domain modules.

**Impact:**
- **Type safety:** send() calls are not type-checked. No compile-time validation of channel names or payload shapes.
- **Inconsistency:** Request/reply uses typedInvoke, broadcasts use onBroadcast, but one-way messages use raw send(). Three patterns for three IPC directions.
- **Coupling:** Domain modules directly depend on `ipcRenderer` (Electron API), making preload layer harder to abstract or test.
- **Maintainability:** Changing a channel name requires grep-ing domain modules, not just updating IpcChannelMap.

**Recommendation:**
1. Create a `safeOn()` factory in ipc-helpers.ts mirroring `typedInvoke()` and `onBroadcast()`:
   ```typescript
   export function safeOn<K extends keyof IpcChannelMap>(
     channel: K,
     handler: (...args: IpcChannelMap[K]['args']) => void
   ): () => void {
     ipcRenderer.on(channel, (_e, ...args) => handler(...args))
     return () => ipcRenderer.removeListener(channel, handler)
   }
   ```
2. Convert all send() calls to use safeOn() or a typed variant.
3. For fire-and-forget (window:setTitle, tearoff:*, terminal:write), document the intent and ensure the channel name is enforced at compile time via IpcChannelMap.

**Effort:** M  
**Confidence:** High

---

## F-t3-pre-5: agentEvents Custom Batch Aggregation Logic Belongs in Main Process

**Severity:** Medium  
**Category:** Logic in Preload  
**Location:** `/Users/ryan/projects/BDE/src/preload/api-agents.ts:42-62`  
**Evidence:**
The `agentEvents.onEvent()` handler manually aggregates two broadcast channels:
```typescript
export const agentEvents = {
  onEvent: (callback: (payload: BroadcastChannels['agent:event']) => void): (() => void) => {
    const handler = (_e, payload) => callback(payload)
    const batchHandler = (_e, payloads: BroadcastChannels['agent:event:batch']) => {
      for (const p of payloads) {
        callback(p)  // <-- custom aggregation logic
      }
    }
    ipcRenderer.on('agent:event', handler)
    ipcRenderer.on('agent:event:batch', batchHandler)
    return () => {
      ipcRenderer.removeListener('agent:event', handler)
      ipcRenderer.removeListener('agent:event', batchHandler)
    }
  },
  getHistory: ...
}
```

This is batch debouncing/coalescence logic that should live in the main process, not the preload bridge.

**Impact:**
- **Responsibility creep:** The preload bridge is supposed to be a thin pass-through; instead it contains business logic (batch consolidation).
- **Inconsistency:** Other broadcast handlers (onPrListUpdated, onSynthesizerChunk) don't do aggregation; no clear pattern.
- **Testability:** Batch logic is harder to test in the preload layer (Electron context); cleaner to test in main process.
- **Duplication:** If multiple renderer windows subscribe, the aggregation logic runs in each preload context, wasting CPU.

**Recommendation:**
1. Move batch aggregation logic to the main process (agent-manager.ts or agent-event-manager.ts).
2. Main process decides whether to send individual events or batches based on internal state.
3. Preload simply exposes two separate subscriptions:
   - `onEvent: onBroadcast<BroadcastChannels['agent:event']>('agent:event')`
   - `onEventBatch: onBroadcast<BroadcastChannels['agent:event:batch']>('agent:event:batch')`
4. Or, if batch is purely an optimization, main process batches internally and only sends single-event broadcasts to preload.

**Effort:** M  
**Confidence:** Medium

---

## F-t3-pre-6: Inconsistent Broadcast Handler Signatures in index.d.ts

**Severity:** Low  
**Category:** Type Declaration Sprawl  
**Location:** `/Users/ryan/projects/BDE/src/preload/index.d.ts:275,280-296,299,304,341-350,375,392-418`  
**Evidence:**
Broadcast handler signatures vary inconsistently:

1. **onDirChanged** (line 275):
   ```typescript
   onDirChanged: (callback: (dirPath: string) => void) => () => void
   ```
   Terse callback signature.

2. **onGitHubError** (line 280):
   ```typescript
   onGitHubError: (cb: (data: { kind: '...', message: string, status?: number }) => void) => () => void
   ```
   Named parameter `data`, union type literal for `kind`.

3. **onPrListUpdated** (line 299):
   ```typescript
   onPrListUpdated: (cb: (payload: PrListPayload) => void) => () => void
   ```
   Named parameter `payload`.

4. **agentEvents.onEvent** (line 125):
   ```typescript
   onEvent: (callback: (payload: { agentId: string; event: AgentEvent }) => void) => () => void
   ```
   Named parameter `callback`.

5. **workbench.onChatChunk** (line 341):
   ```typescript
   onChatChunk: (cb: (data: { streamId: string; ... }) => void) => () => void
   ```
   Named parameter `data`.

6. **tearoff.onTabRemoved** (line 392):
   ```typescript
   onTabRemoved: (cb: (payload: { sourcePanelId: string; ... }) => void) => () => void
   ```
   Named parameter `cb` with `payload` type.

**Impact:**
- **API inconsistency:** Callers must remember which handlers use `cb`, `callback`, `data`, or `payload` as the parameter name.
- **IDE autocomplete confusion:** No clear naming convention helps developers remember the pattern.
- **Documentation burden:** Requires boilerplate comments in index.d.ts to explain that `cb` and `callback` are equivalent.

**Recommendation:**
Standardize all broadcast handler signatures in index.d.ts:
- Use `listener` or `callback` consistently (pick one).
- Use `payload` for the data parameter name across all handlers.
- Example:
  ```typescript
  onDirChanged: (listener: (payload: string) => void) => () => void
  onGitHubError: (listener: (payload: { kind: '...'; message: string; status?: number }) => void) => () => void
  onPrListUpdated: (listener: (payload: PrListPayload) => void) => () => void
  ```

**Effort:** S  
**Confidence:** High

---

## Summary Table

| Finding | Severity | Category | Effort | Confidence |
|---------|----------|----------|--------|-----------|
| F-t3-pre-1: Flat Namespace (76 props) | High | Flat Namespace | M | High |
| F-t3-pre-2: Inconsistent onBroadcast | High | Missing Pattern | M | High |
| F-t3-pre-3: 497-line Type File | Medium | Type Sprawl | M | High |
| F-t3-pre-4: Scattered ipcRenderer.send() | Medium | Logic in Preload | M | High |
| F-t3-pre-5: Batch Logic in Preload | Medium | Logic in Preload | M | Medium |
| F-t3-pre-6: Inconsistent Handler Signatures | Low | Type Declarations | S | High |

---

## Key Takeaways

1. **The preload bridge is taking on too much responsibility:** The flat namespace (76 properties) and 497-line type file suggest the bridge is acting as a monolithic facade rather than a thin IPC pass-through.

2. **Pattern consistency is broken:** Three separate approaches to IPC (typedInvoke, onBroadcast, raw ipcRenderer) are scattered across domain modules, making it easy to apply the wrong pattern.

3. **Business logic is leaking into preload:** Batch aggregation in agentEvents and custom listener logic in terminal.onData belong in the main process, not the preload.

4. **Refactoring would unlock clarity:** Grouping the namespace by domain (api.git.*, api.sprint.*, etc.), splitting the type file by domain, and enforcing onBroadcast+safeOn patterns would reduce cognitive overhead and make future maintenance easier.

**Estimated Total Effort:** 3-4 weeks (L) to fully address all findings; prioritize F-t3-pre-1 and F-t3-pre-2 (namespace grouping + pattern consistency) as high-value, foundation-setting work.

