# AX-S6: Store Type Hygiene

**Epic:** Architecture & DX
**Priority:** P1
**Size:** M (Medium)
**Depends on:** None

---

## Problem

The audit found several type hygiene issues across Zustand stores and the preload bridge that reduce type safety and leave dead state fields:

### 1. Terminal Tab: `isAgentTab` duplicates `kind` (Dead Field)

**File:** `src/renderer/src/stores/terminal.ts`

`TerminalTab` has both `kind: 'shell' | 'agent'` and `isAgentTab: boolean`. These always agree — `isAgentTab` is redundant:

```typescript
interface TerminalTab {
  kind: 'shell' | 'agent'
  isAgentTab: boolean // ← always equals kind === 'agent'
  shell?: string // only meaningful for kind === 'shell'
  agentId?: string // only meaningful for kind === 'agent'
  agentSessionKey?: string // only meaningful for kind === 'agent'
}
```

This should be a discriminated union where each variant carries only its relevant fields.

### 2. SubAgent Status: String Catch-All

**File:** `src/renderer/src/stores/sessions.ts`

```typescript
interface SubAgent {
  status: 'running' | 'completed' | 'failed' | 'timeout' | 'done' | string
  // ...
}
```

The `| string` catch-all defeats exhaustive switch/case checking. The `useUnifiedAgents.ts:normalizeStatus()` function already maps unknown values to `'unknown'` — the type should reflect this.

### 3. Sprint List: `unknown[]` Return Type

**File:** `src/preload/index.ts:89`

```typescript
sprint: {
  list: (): Promise<unknown[]> => ipcRenderer.invoke('sprint:list'),
}
```

The renderer casts this to `SprintTask[]` in `SprintCenter.tsx`. The type should be explicit at the preload boundary.

### 4. Dead State Fields

| Field                 | Store             | Issue                                                                            |
| --------------------- | ----------------- | -------------------------------------------------------------------------------- |
| `lastUpdated: number` | `localAgents.ts`  | Set on every fetch, never read by UI                                             |
| `loading: boolean`    | `agentHistory.ts` | Set to `false` in `finally` on first fetch, never meaningfully `true` after init |

### 5. focusedPaneIndex Not Validated

**File:** `src/renderer/src/stores/splitLayout.ts`

`focusedPaneIndex` can be 0-3 regardless of `splitMode`. In `'single'` mode, only index 0 is valid. No validation enforces this.

## Design

### Fix 1: Discriminated Union for TerminalTab

```typescript
interface BaseTab {
  id: string
  title: string
  ptyId?: number | null
}

interface ShellTab extends BaseTab {
  kind: 'shell'
  shell: string
}

interface AgentTab extends BaseTab {
  kind: 'agent'
  agentId: string
  agentSessionKey: string
}

type TerminalTab = ShellTab | AgentTab
```

Remove `isAgentTab` field. Replace all `tab.isAgentTab` checks with `tab.kind === 'agent'`.

### Fix 2: Closed SubAgent Status Union

```typescript
type SubAgentStatus = 'running' | 'completed' | 'failed' | 'timeout' | 'done' | 'unknown'

interface SubAgent {
  status: SubAgentStatus
  // ...
}
```

In `fetchSessions()`, normalize unknown status values to `'unknown'` at parse time (before storing in state), not at render time.

### Fix 3: Typed Sprint List

Define `SprintTask` in `src/shared/types.ts` (or import from an existing definition):

```typescript
export interface SprintTask {
  id: string
  title: string
  prompt: string
  repo: string
  status: 'backlog' | 'queued' | 'active' | 'done' | 'cancelled'
  priority: number
  spec: string | null
  notes: string | null
  pr_url: string | null
  pr_number: number | null
  pr_status: string | null
  agent_run_id: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}
```

Update preload:

```typescript
sprint: {
  list: (): Promise<SprintTask[]> => ipcRenderer.invoke('sprint:list'),
}
```

### Fix 4: Remove Dead State

**`localAgents.ts`:** Remove `lastUpdated` from state and `fetchProcesses()`.

**`agentHistory.ts`:** Remove `loading` boolean. If a loading indicator is needed during initial fetch, use `agents.length === 0 && isFetching` instead.

### Fix 5: Validate focusedPaneIndex

In `setSplitMode()`:

```typescript
setSplitMode: (mode) =>
  set((s) => {
    const maxIndex = mode === 'single' ? 0 : mode === '2-pane' ? 1 : 3
    return {
      splitMode: mode,
      splitPanes: mode === 'single' ? [s.splitPanes[0], null, null, null] : s.splitPanes,
      focusedPaneIndex: Math.min(s.focusedPaneIndex, maxIndex)
    }
  })
```

## Files to Change

| File                                                  | Change                                       |
| ----------------------------------------------------- | -------------------------------------------- |
| `src/renderer/src/stores/terminal.ts`                 | Discriminated union, remove `isAgentTab`     |
| `src/renderer/src/stores/sessions.ts`                 | Closed status union, normalize at parse time |
| `src/renderer/src/stores/localAgents.ts`              | Remove `lastUpdated`                         |
| `src/renderer/src/stores/agentHistory.ts`             | Remove `loading`                             |
| `src/renderer/src/stores/splitLayout.ts`              | Validate `focusedPaneIndex` on mode change   |
| `src/shared/types.ts`                                 | Add `SprintTask` interface                   |
| `src/preload/index.ts`                                | Type `sprint.list` return as `SprintTask[]`  |
| `src/preload/index.d.ts`                              | Update declaration                           |
| Renderer components using `isAgentTab`                | Replace with `kind === 'agent'`              |
| Renderer components using `loading` from agentHistory | Replace with `isFetching` or derived check   |

## Acceptance Criteria

- [ ] `isAgentTab` field removed — all checks use `tab.kind === 'agent'`
- [ ] `SubAgent.status` is a closed union (no `| string`)
- [ ] `sprint.list` returns `Promise<SprintTask[]>` in preload
- [ ] `lastUpdated` removed from localAgents store
- [ ] `loading` removed from agentHistory store
- [ ] `focusedPaneIndex` clamped on split mode change
- [ ] `npm run build` passes with no new `any` or `as` casts
- [ ] `npm test` passes

## Risks

- **`isAgentTab` removal:** Need to find and update all consumers. Use `grep -rn 'isAgentTab' src/` to enumerate.
- **`loading` removal:** If any component shows a spinner based on `loading`, it needs to switch to `isFetching`. Verify with `grep -rn 'loading' src/renderer/src/` scoped to agentHistory usage.
