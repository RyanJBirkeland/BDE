# Decompose preload/index.ts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split preload/index.ts (467L) into 7 domain files, re-assembling in index.ts with an identical `window.api` shape — zero renderer changes required.

**Architecture:** Each domain file (e.g., `api-sprint.ts`) defines a namespaced object containing IPC-wrapped methods for its domain. Domain files are pure — they only call `typedInvoke` and `onBroadcast` helpers. `preload/index.ts` imports all domains and assembles them into the `api` object, then exposes via `contextBridge`. No behavior change anywhere.

**Tech Stack:** TypeScript, Electron preload, contextBridge

---

## Task 1: Create api-settings.ts

**Files:**
- Create: `src/preload/api-settings.ts`
- Modify: `src/preload/index.ts`

- [ ] Read `src/preload/index.ts` and identify settings domain: `settings.*` object (~9 methods) and `claudeConfig.*` object (~2 methods)
- [ ] Create `src/preload/api-settings.ts`:
  - Copy the `typedInvoke` helper from index.ts (or import it if extracted to a shared helper file)
  - Export `settings` object with all settings methods — each wraps `typedInvoke('settings:*', ...)`
  - Export `claudeConfig` object with all claudeConfig methods — each wraps `typedInvoke('claude:*', ...)`
- [ ] In `src/preload/index.ts`:
  - Add: `import { settings, claudeConfig } from './api-settings'`
  - Remove the inline `settings` and `claudeConfig` object definitions
  - Add `settings, claudeConfig` to the `api` object
- [ ] Run `npm run typecheck` — fix any errors
- [ ] Run `npm test` — all tests must pass
- [ ] Commit: `git add -A && git commit -m "refactor: extract settings and claudeConfig to api-settings.ts"`

---

## Task 2: Create api-git.ts

**Files:**
- Create: `src/preload/api-git.ts`
- Modify: `src/preload/index.ts`

- [ ] Identify git domain in index.ts: `getRepoPaths`, `gitStatus`, `gitDiff`, `gitStage`, `gitUnstage`, `gitCommit`, `gitPush`, `gitBranches`, `gitCheckout`, `gitDetectRemote`, `gitFetch`, `gitPull` (and any others prefixed with `git`)
- [ ] Create `src/preload/api-git.ts`:
  - Copy `typedInvoke` helper
  - Export all git methods with identical signatures
  - Each wraps `typedInvoke('git:*', ...)` with correct channel names
- [ ] In `src/preload/index.ts`:
  - Add: `import { getRepoPaths, gitStatus, gitDiff, gitStage, gitUnstage, gitCommit, gitPush, gitBranches, gitCheckout, gitDetectRemote, gitFetch, gitPull } from './api-git'`
  - Remove inline git method definitions
  - Add all git methods to the `api` object
- [ ] Run `npm run typecheck` — fix any errors
- [ ] Run `npm test` — all tests must pass
- [ ] Commit: `git add -A && git commit -m "refactor: extract git operations to api-git.ts"`

---

## Task 3: Create api-sprint.ts

**Files:**
- Create: `src/preload/api-sprint.ts`
- Modify: `src/preload/index.ts`

- [ ] Identify sprint domain in index.ts: `sprint.*` object (~16+ methods) and `groups.*` object (~9+ methods)
- [ ] Create `src/preload/api-sprint.ts`:
  - Copy `typedInvoke` helper
  - Import any needed types from `../shared/types` (e.g., `BatchOperation`, `EpicDependency`)
  - Export `sprint` object with all sprint methods — each wraps `typedInvoke('sprint:*', ...)`
  - Export `groups` object with all group methods — each wraps `typedInvoke('groups:*', ...)`
- [ ] In `src/preload/index.ts`:
  - Add: `import { sprint, groups } from './api-sprint'`
  - Remove inline `sprint` and `groups` object definitions
  - Add `sprint, groups` to `api` object
- [ ] Run `npm run typecheck` — fix any errors
- [ ] Run `npm test` — all tests must pass
- [ ] Commit: `git add -A && git commit -m "refactor: extract sprint and groups to api-sprint.ts"`

---

## Task 4: Create api-memory.ts

**Files:**
- Create: `src/preload/api-memory.ts`
- Modify: `src/preload/index.ts`

- [ ] Identify memory domain in index.ts: `listMemoryFiles`, `readMemoryFile`, `writeMemoryFile`, `searchMemory`, `getActiveMemoryFiles`, `setMemoryFileActive`
- [ ] Create `src/preload/api-memory.ts`:
  - Copy `typedInvoke` helper
  - Export all 6 memory methods — each wraps `typedInvoke('memory:*', ...)`
- [ ] In `src/preload/index.ts`:
  - Add import, remove inline definitions, add to `api` object
- [ ] Run `npm run typecheck` — fix any errors
- [ ] Run `npm test` — all tests must pass
- [ ] Commit: `git add -A && git commit -m "refactor: extract memory operations to api-memory.ts"`

---

## Task 5: Create api-agents.ts

**Files:**
- Create: `src/preload/api-agents.ts`
- Modify: `src/preload/index.ts`

- [ ] Identify agents domain in index.ts: agent process methods (`getAgentProcesses`, `spawnLocalAgent`, `steerAgent`, `killAgent`, `getLatestCacheTokens`, `tailAgentLog`), plus `agents.*`, `agentManager.*`, `agentEvents.*` objects
- [ ] Create `src/preload/api-agents.ts`:
  - Copy `typedInvoke` and `onBroadcast` helpers
  - Import needed types from `../shared/types` and `../shared/ipc-channels/broadcast-channels`
  - Export all agent methods and objects — `agentEvents.onEvent` uses `onBroadcast` pattern for event streaming
- [ ] In `src/preload/index.ts`:
  - Add import, remove inline definitions, add to `api` object
- [ ] Run `npm run typecheck` — fix any errors
- [ ] Run `npm test` — all tests must pass
- [ ] Commit: `git add -A && git commit -m "refactor: extract agent operations to api-agents.ts"`

---

## Task 6: Create api-webhooks.ts

**Files:**
- Create: `src/preload/api-webhooks.ts`
- Modify: `src/preload/index.ts`

- [ ] Identify webhooks domain in index.ts: `webhooks.*` object (~5 methods: list, create, update, delete, test)
- [ ] Create `src/preload/api-webhooks.ts`:
  - Copy `typedInvoke` helper
  - Export `webhooks` object — each method wraps `typedInvoke('webhook:*', ...)`
- [ ] In `src/preload/index.ts`: add import, remove inline, add to `api`
- [ ] Run `npm run typecheck` — fix any errors
- [ ] Run `npm test` — all tests must pass
- [ ] Commit: `git add -A && git commit -m "refactor: extract webhooks to api-webhooks.ts"`

---

## Task 7: Create api-utilities.ts

**Files:**
- Create: `src/preload/api-utilities.ts`
- Modify: `src/preload/index.ts`

- [ ] Identify all remaining methods/objects in index.ts not assigned above: clipboard, playground, window, github, fs, pr, dashboard, system, workbench, review, synthesizer, repos, tearoff, templates, terminal, auth, and any top-level utility methods
- [ ] Create `src/preload/api-utilities.ts`:
  - Copy `typedInvoke` and `onBroadcast` helpers
  - Import needed types
  - Export all remaining methods and objects with identical signatures
  - Preserve all `onBroadcast` patterns (e.g., `onDirChanged`, `onPrListUpdated`, `onExternalSprintChange`)
- [ ] In `src/preload/index.ts`: add import, remove all remaining inline definitions, spread into `api` object
- [ ] Run `npm run typecheck` — fix any errors
- [ ] Run `npm test` — all tests must pass
- [ ] Commit: `git add -A && git commit -m "refactor: extract remaining utilities to api-utilities.ts"`

---

## Task 8: Finalize preload/index.ts

**Files:**
- Modify: `src/preload/index.ts`

- [ ] Verify `preload/index.ts` is now ~50–80 lines:
  - Imports from all 7 domain files
  - `typedInvoke`/`onBroadcast` helper definitions (or imported from a shared file)
  - `const api = { settings, claudeConfig, getRepoPaths, git*, sprint, groups, memory*, agents*, agentManager, agentEvents, webhooks, ...utilities }`
  - `contextBridge.exposeInMainWorld('api', api)`
- [ ] **Critical verification**: `window.api` shape is IDENTICAL — spot-check 10 renderer usages of `window.api.*` to confirm no breakage
- [ ] Run `npm run typecheck` — zero errors
- [ ] Run `npm test` — zero regressions
- [ ] Run `npm run lint` — zero errors
- [ ] Commit: `git add -A && git commit -m "refactor: preload/index.ts is now a thin API assembler"`

---

## Verification

- `npm run typecheck` — zero errors
- `npm test` — zero regressions
- File sizes: each `api-*.ts` ≤150 lines, `preload/index.ts` ≤80 lines
- `grep -rn "window\.api\." src/renderer/src --include="*.ts" --include="*.tsx" | head -20` — spot-check that usage patterns are unchanged
