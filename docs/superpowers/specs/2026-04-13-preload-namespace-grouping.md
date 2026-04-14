# Preload Namespace Grouping

**Date:** 2026-04-13  
**Status:** Draft  
**Audit IDs:** F-t3-pre-1 through F-t3-pre-4  
**Effort:** M — mechanical renames across 131 renderer files, straightforward but large  
**Dependencies:** None. Unblocks F-t3-pre-2 (onBroadcast consistency) and F-t3-pre-4 (type declaration split).

## Problem

`window.api` exposes 76 flat top-level properties. 10 domains are already namespaced (`settings`, `claudeConfig`, `webhooks`, `github`, `sprint`, `groups`, `agents`, `agentManager`, `cost`, `review`, etc.). 40+ properties remain flat top-level, mixing git ops, memory ops, file system ops, PR ops, auth, synthesizer, and window/clipboard utilities at the same level.

**Consequences:**
- Autocomplete on `window.api.` returns an undifferentiated wall of names — `gitStatus`, `readFile`, `listMemoryFiles`, and `authStatus` all at the same depth.
- The `onBroadcast` factory in `src/preload/index.ts` cannot be applied consistently because broadcast-style event subscriptions (`onDirChanged`, `onPrListUpdated`, `onGitHubError`) are scattered at the top level rather than inside their domain namespace.
- `src/preload/index.d.ts` is a 497-line monolith; splitting it requires domain grouping first.
- New handlers added to flat domains (e.g., a new git op) have no obvious namespace home and drift to top-level by default.

## Solution

**Big-bang migration.** Group all flat properties into domain namespaces in one PR. Update all 131 renderer consumer files. No backwards-compat aliases — the flat names are removed.

Rationale for big-bang over shim: an alias layer would need to live permanently or be cleaned up in a second PR. The 131 files are touched by pipeline agents who already know the codebase; the changes are mechanical (search-and-replace per domain). TypeScript catches every missed rename at `typecheck` time, making the migration verifiable.

## New API Shape

### Properties moved into new or expanded namespaces

**`api.git` (new namespace — was flat)**
```
getRepoPaths()          ← was api.getRepoPaths
status(repo)            ← was api.gitStatus
diff(repo, opts)        ← was api.gitDiff
stage(repo, path)       ← was api.gitStage
unstage(repo, path)     ← was api.gitUnstage
commit(repo, msg)       ← was api.gitCommit
push(repo, opts)        ← was api.gitPush
branches(repo)          ← was api.gitBranches
checkout(repo, branch)  ← was api.gitCheckout
detectRemote(repo)      ← was api.gitDetectRemote
fetch(repo)             ← was api.gitFetch
pull(repo)              ← was api.gitPull
```
Names drop the `git` prefix since the namespace provides it.

**`api.memory` (new namespace — was flat)**
```
listFiles()             ← was api.listMemoryFiles
readFile(path)          ← was api.readMemoryFile
writeFile(path, c)      ← was api.writeMemoryFile
search(query)           ← was api.searchMemory
getActiveFiles()        ← was api.getActiveMemoryFiles
setFileActive(p, a)     ← was api.setMemoryFileActive
```

**`api.fs` (new namespace — was flat)**
```
openFileDialog(opts)    ← was api.openFileDialog
readAsBase64(path)      ← was api.readFileAsBase64
readAsText(path)        ← was api.readFileAsText
openDirDialog()         ← was api.openDirectoryDialog
readDir(path)           ← was api.readDir
readFile(path)          ← was api.readFile
writeFile(path, c)      ← was api.writeFile
watchDir(path)          ← was api.watchDir
unwatchDir()            ← was api.unwatchDir
createFile(path)        ← was api.createFile
createDir(path)         ← was api.createDir
rename(old, new)        ← was api.rename
deletePath(path)        ← was api.deletePath
stat(path)              ← was api.stat
listFiles(path, opts)   ← was api.listFiles
onDirChanged(cb)        ← was api.onDirChanged
```

**`api.pr` (expand existing — currently has pollPrStatuses, checkConflictFiles as flat)**
```
pollStatuses(prs)       ← was api.pollPrStatuses
checkConflictFiles(i)   ← was api.checkConflictFiles
onListUpdated(cb)       ← was api.onPrListUpdated
getList()               ← was api.getPrList
refreshList()           ← was api.refreshPrList
onGitHubError(cb)       ← was api.onGitHubError
```
Note: `api.github` (fetch, isConfigured) stays separate — it's a different concern (API proxy vs PR lifecycle).

**`api.window` (new namespace — was flat)**
```
readClipboardImage()    ← was api.readClipboardImage
openExternal(url)       ← was api.openExternal
openPlaygroundInBrowser(html) ← was api.openPlaygroundInBrowser
setTitle(title)         ← was api.setTitle
```

**`api.auth` (new namespace — was flat)**
```
status()                ← was api.authStatus
```

**`api.synthesizer` (new namespace — was flat)**
```
generate(args)          ← was api.synthesizeSpec
revise(args)            ← was api.reviseSpec
cancel(args)            ← was api.cancelSynthesis
onChunk(cb)             ← was api.onSynthesizerChunk
```

**`api.sprint` (expand existing)**
```
sprint.onExternalChange(cb) ← was api.onExternalSprintChange
```

**`api.agents` (expand existing — absorb flat agent process ops)**
```
agents.getProcesses()       ← was api.getAgentProcesses
agents.spawnLocal(args)     ← was api.spawnLocalAgent
agents.steer(id, msg, imgs) ← was api.steerAgent
agents.kill(id)             ← was api.killAgent
agents.getLatestCacheTokens(runId) ← was api.getLatestCacheTokens
agents.tailLog(args)        ← was api.tailAgentLog
```
The existing `agents.list/readLog/import/promoteToReview` and `agents.events` (was `agentEvents`) remain. `agentManager` namespace is unchanged.

### Namespaces unchanged
`settings`, `claudeConfig`, `webhooks`, `github`, `cost`, `dashboard`, `system`, `workbench`, `terminal`, `tearoff`, `review`, `repoDiscovery`, `planner`, `groups`, `agentManager`, `agents` (structure preserved, expanded above).

## Architecture

### Preload layer changes

**`src/preload/index.ts`** — restructure the `api` object literal. Move flat exports into their namespaces. The `api-*.ts` source files stay the same; only what's assembled in `index.ts` changes. Where a flat export's name was redundant with its domain (e.g., `gitStatus` → `status`), the api-file export is renamed at the assembly point via destructuring:

```typescript
import {
  getRepoPaths,
  gitStatus as status,
  gitDiff as diff,
  // ...
} from './api-git'

const api = {
  git: { getRepoPaths, status, diff, ... },
  // ...
}
```

This keeps `api-git.ts` internals unchanged — the rename lives only in `index.ts`.

**`src/preload/index.d.ts`** — restructure the `Window['api']` type declaration to match. The current flat properties must be removed and replaced with typed namespace objects. New/modified `api` members:

```typescript
// NEW: api.git (replaces 12 flat git* properties)
git: {
  getRepoPaths: () => Promise<IpcResult<'git:getRepoPaths'>>
  status: (...args: IpcArgs<'git:status'>) => Promise<IpcResult<'git:status'>>
  diff: (...args: IpcArgs<'git:diff'>) => Promise<IpcResult<'git:diff'>>
  stage: (...args: IpcArgs<'git:stage'>) => Promise<IpcResult<'git:stage'>>
  unstage: (...args: IpcArgs<'git:unstage'>) => Promise<IpcResult<'git:unstage'>>
  commit: (...args: IpcArgs<'git:commit'>) => Promise<IpcResult<'git:commit'>>
  push: (...args: IpcArgs<'git:push'>) => Promise<IpcResult<'git:push'>>
  branches: (...args: IpcArgs<'git:branches'>) => Promise<IpcResult<'git:branches'>>
  checkout: (...args: IpcArgs<'git:checkout'>) => Promise<IpcResult<'git:checkout'>>
  detectRemote: (...args: IpcArgs<'git:detectRemote'>) => Promise<IpcResult<'git:detectRemote'>>
  fetch: (...args: IpcArgs<'git:fetch'>) => Promise<IpcResult<'git:fetch'>>
  pull: (...args: IpcArgs<'git:pull'>) => Promise<IpcResult<'git:pull'>>
}

// NEW: api.memory (replaces 6 flat memory* properties)
memory: {
  listFiles: () => Promise<IpcResult<'memory:listFiles'>>
  readFile: (...args: IpcArgs<'memory:readFile'>) => Promise<IpcResult<'memory:readFile'>>
  writeFile: (...args: IpcArgs<'memory:writeFile'>) => Promise<IpcResult<'memory:writeFile'>>
  search: (...args: IpcArgs<'memory:search'>) => Promise<IpcResult<'memory:search'>>
  getActiveFiles: () => Promise<IpcResult<'memory:getActiveFiles'>>
  setFileActive: (...args: IpcArgs<'memory:setFileActive'>) => Promise<IpcResult<'memory:setFileActive'>>
}

// NEW: api.fs (replaces ~16 flat fs properties)
fs: {
  openFileDialog: (...args: IpcArgs<'fs:openFileDialog'>) => Promise<IpcResult<'fs:openFileDialog'>>
  readAsBase64: (...args: IpcArgs<'fs:readFileAsBase64'>) => Promise<IpcResult<'fs:readFileAsBase64'>>
  readAsText: (...args: IpcArgs<'fs:readFileAsText'>) => Promise<IpcResult<'fs:readFileAsText'>>
  openDirDialog: () => Promise<IpcResult<'fs:openDirectoryDialog'>>
  readDir: (...args: IpcArgs<'fs:readDir'>) => Promise<IpcResult<'fs:readDir'>>
  readFile: (...args: IpcArgs<'fs:readFile'>) => Promise<IpcResult<'fs:readFile'>>
  writeFile: (...args: IpcArgs<'fs:writeFile'>) => Promise<IpcResult<'fs:writeFile'>>
  watchDir: (...args: IpcArgs<'fs:watchDir'>) => Promise<IpcResult<'fs:watchDir'>>
  unwatchDir: () => Promise<IpcResult<'fs:unwatchDir'>>
  createFile: (...args: IpcArgs<'fs:createFile'>) => Promise<IpcResult<'fs:createFile'>>
  createDir: (...args: IpcArgs<'fs:createDir'>) => Promise<IpcResult<'fs:createDir'>>
  rename: (...args: IpcArgs<'fs:rename'>) => Promise<IpcResult<'fs:rename'>>
  deletePath: (...args: IpcArgs<'fs:delete'>) => Promise<IpcResult<'fs:delete'>>
  stat: (...args: IpcArgs<'fs:stat'>) => Promise<IpcResult<'fs:stat'>>
  listFiles: (...args: IpcArgs<'fs:listFiles'>) => Promise<IpcResult<'fs:listFiles'>>
  onDirChanged: (callback: (dirPath: string) => void) => () => void
}

// EXPANDED: api.pr (adds 6 flat pr/github-error properties)
pr: {
  pollStatuses: (...args: IpcArgs<'pr:pollStatuses'>) => Promise<IpcResult<'pr:pollStatuses'>>
  checkConflictFiles: (...args: IpcArgs<'pr:checkConflictFiles'>) => Promise<IpcResult<'pr:checkConflictFiles'>>
  onListUpdated: (cb: (payload: PrListPayload) => void) => () => void
  getList: () => Promise<IpcResult<'pr:getList'>>
  refreshList: () => Promise<IpcResult<'pr:refreshList'>>
  onGitHubError: (cb: (data: { kind: 'no-token' | 'token-expired' | 'rate-limit' | 'billing' | 'permission' | 'not-found' | 'validation' | 'server' | 'network' | 'unknown'; message: string; status?: number }) => void) => () => void
}

// NEW: api.window (replaces 4 flat clipboard/window properties)
window: {
  readClipboardImage: () => Promise<IpcResult<'clipboard:readImage'>>
  openExternal: (...args: IpcArgs<'window:openExternal'>) => Promise<IpcResult<'window:openExternal'>>
  openPlaygroundInBrowser: (...args: IpcArgs<'playground:openInBrowser'>) => Promise<IpcResult<'playground:openInBrowser'>>
  setTitle: (title: string) => void
}

// NEW: api.auth (replaces flat authStatus)
auth: {
  status: () => Promise<IpcResult<'auth:status'>>
}

// NEW: api.synthesizer (replaces 4 flat synthesizer properties)
synthesizer: {
  generate: (...args: IpcArgs<'synthesizer:generate'>) => Promise<IpcResult<'synthesizer:generate'>>
  revise: (...args: IpcArgs<'synthesizer:revise'>) => Promise<IpcResult<'synthesizer:revise'>>
  cancel: (...args: IpcArgs<'synthesizer:cancel'>) => Promise<IpcResult<'synthesizer:cancel'>>
  onChunk: (cb: (data: { streamId: string; chunk: string; done: boolean; fullText?: string; filesAnalyzed?: string[]; error?: string }) => void) => () => void
}
```

**EXPANDED `api.sprint`** — add one member to the existing type:
```typescript
sprint: {
  // ...all existing members unchanged...
  onExternalChange: (cb: () => void) => () => void  // ← new, replaces top-level onExternalSprintChange
}
```

**EXPANDED `api.agents`** — add these members to the existing type. Remove the corresponding flat top-level declarations:
```typescript
agents: {
  // existing members unchanged:
  list: (...args: IpcArgs<'agents:list'>) => Promise<IpcResult<'agents:list'>>
  readLog: (...args: IpcArgs<'agents:readLog'>) => Promise<IpcResult<'agents:readLog'>>
  import: (...args: IpcArgs<'agents:import'>) => Promise<IpcResult<'agents:import'>>
  promoteToReview: (...args: IpcArgs<'agents:promoteToReview'>) => Promise<IpcResult<'agents:promoteToReview'>>
  // new members (were flat):
  getProcesses: () => Promise<IpcResult<'local:getAgentProcesses'>>
  spawnLocal: (...args: IpcArgs<'local:spawnClaudeAgent'>) => Promise<IpcResult<'local:spawnClaudeAgent'>>
  steer: (agentId: string, message: string, images?: Array<{ data: string; mimeType: string }>) => Promise<IpcResult<'agent:steer'>>
  kill: (...args: IpcArgs<'agent:kill'>) => Promise<IpcResult<'agent:kill'>>
  getLatestCacheTokens: (runId: string) => Promise<IpcResult<'agent:latestCacheTokens'>>
  tailLog: (...args: IpcArgs<'local:tailAgentLog'>) => Promise<IpcResult<'local:tailAgentLog'>>
  events: {
    onEvent: (callback: (payload: { agentId: string; event: AgentEvent }) => void) => () => void
    getHistory: (agentId: string) => Promise<AgentEvent[]>
  }
}
```

### Renderer migration

All 131 files with `window.api.*` calls need their call sites updated. The migration is mechanical: each flat name maps to exactly one new path (see table above). TypeScript enforces completeness — `npm run typecheck` will fail on any missed rename.

Suggested approach for a pipeline agent: process domain by domain, running `typecheck` after each domain to confirm zero errors before moving on. Order: `git` → `memory` → `fs` → `pr` → `window` → `auth` → `synthesizer` → `sprint.onExternalChange` → `agents` (flat ops).

## Files to Change

| File | Change |
|------|--------|
| `src/preload/index.ts` | Restructure `api` object literal |
| `src/preload/index.d.ts` | Restructure `Window['api']` type |
| 131 renderer files (see below) | Update call sites |

**Renderer files by domain** (from grep of `window.api.*`):

All files in `src/renderer/src/` that call any of the flat properties being namespaced. Full list derivable via:
```bash
grep -rn "window\.api\.\(git\|listMemory\|readMemory\|writeMemory\|searchMemory\|getActiveMemory\|setMemoryFile\|openFile\|readFile\|writeFile\|readDir\|watchDir\|unwatchDir\|createFile\|createDir\|rename\|deletePath\|stat\|listFiles\|onDirChanged\|pollPr\|checkConflict\|onPrList\|getPrList\|refreshPrList\|onGitHub\|readClipboard\|openExternal\|openPlayground\|setTitle\|authStatus\|synthesize\|revise\|cancelSynth\|onSynth\|onExternalSprint\|getAgentProc\|spawnLocal\|steerAgent\|killAgent\|getLatestCache\|tailAgentLog\)" src/renderer/src/
```

High-traffic files to prioritise:
- `src/renderer/src/stores/gitTree.ts` (git ops)
- `src/renderer/src/components/ide/FileSidebar.tsx` (fs ops)
- `src/renderer/src/hooks/useSingleTaskReviewActions.ts` (review + agents)
- `src/renderer/src/stores/sprintTasks.ts` (sprint + misc)
- `src/renderer/src/views/AgentsView.tsx` (agents)

## Tests to Update

Mock declarations in renderer tests use `window.api.*` paths. These require the **same domain-by-domain renames** as the production call sites — they are not automatically updated by TypeScript and must be searched explicitly.

**Pattern to find test mocks:** `vi.mock` and `vi.spyOn` calls that reference `window.api.*`, plus `Object.defineProperty(window, 'api', ...)` setup blocks in `beforeEach`.

Common patterns in this codebase:
```typescript
// Before
vi.spyOn(window.api, 'gitStatus').mockResolvedValue(...)
Object.defineProperty(window, 'api', {
  value: { gitStatus: vi.fn(), readFile: vi.fn(), authStatus: vi.fn() }
})

// After
vi.spyOn(window.api.git, 'status').mockResolvedValue(...)
Object.defineProperty(window, 'api', {
  value: { git: { status: vi.fn() }, fs: { readFile: vi.fn() }, auth: { status: vi.fn() } }
})
```

Key test files to prioritise (highest `window.api` call counts):
- `src/renderer/src/stores/__tests__/sprintTasks.test.ts` (56 occurrences)
- `src/renderer/src/stores/__tests__/taskGroups.test.ts` (44 occurrences)
- `src/renderer/src/hooks/__tests__/useReviewActions.test.ts` (19 occurrences)
- `src/renderer/src/hooks/__tests__/useReviewPartnerActions.test.ts` (20 occurrences)
- `src/renderer/src/stores/__tests__/dashboardData.test.ts` (35 occurrences)
- `src/renderer/src/components/settings/__tests__/AgentManagerSection.test.ts` (10 occurrences)
- All other `__tests__` files that define or spy on `window.api`

Run `npm test` after each domain migration to catch missed mock updates immediately.

## How to Test

```bash
npm run typecheck   # zero errors = all renames complete
npm test            # all renderer + main unit tests pass
npm run lint        # no lint regressions
```

**Smoke test in-app:** launch BDE, open Source Control (git ops), IDE file browser (fs ops), Code Review (review + pr ops), Agents view (agent ops), Settings > Connections (auth). Confirm no runtime errors in DevTools console.
