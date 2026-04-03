# FC-S6: SpawnModal missing loading guard and delayed agent appearance

## Problem Statement

Two related UX issues in the agent spawn flow:

1. **No loading guard on submit:** `SpawnModal` fetches `repoPaths` asynchronously on mount (`useEffect` at line 34), but the submit button is enabled immediately. If the user fills in the form and clicks "Spawn" before the fetch resolves, `repoPaths` is `{}`, and the submit handler shows a confusing error toast: `Repo path not found for "BDE" — check git.ts REPO_PATHS`.

2. **Spawned agent doesn't appear immediately:** After a successful spawn, the new agent process doesn't appear in `AgentList` until the next `getAgentProcesses` poll cycle (every 5 seconds). There is no immediate `fetchProcesses()` call after spawn, creating a jarring delay where the user spawns an agent and sees nothing happen in the sidebar.

## Root Cause

1. `SpawnModal.tsx:34` — `useEffect` fetches `repoPaths` on mount. The `loading` state is not tracked. Submit at lines 89-93 checks `repoPaths[repo]` which is undefined before the fetch completes.

2. `SpawnModal.tsx:94-110` — after `spawnLocalAgent` resolves, only `addSpawnedAgent()` is called (which updates `localAgentsStore.spawnedAgents`). But `AgentList` derives its ACTIVE group from `processes` (returned by `getAgentProcesses`), which is polled separately. No imperative `fetchProcesses()` is triggered after spawn.

## Files to Change

| File                                                  | Change                                                                                                            |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `src/renderer/src/components/sessions/SpawnModal.tsx` | Add `repoPathsLoading` state; disable submit button while loading; call `fetchProcesses()` after successful spawn |
| `src/renderer/src/stores/localAgents.ts`              | Export `fetchProcesses` or provide a `refreshProcesses()` action that can be called imperatively                  |

## Implementation Notes

### Loading guard (SpawnModal.tsx)

```typescript
const [repoPathsLoading, setRepoPathsLoading] = useState(true)

useEffect(() => {
  window.api
    .getRepoPaths()
    .then(setRepoPaths)
    .catch(() => toast.error('Failed to load repo paths'))
    .finally(() => setRepoPathsLoading(false))
}, [])
```

Disable the submit button:

```typescript
<button disabled={repoPathsLoading || isSpawning || !task.trim()}>
  {repoPathsLoading ? 'Loading...' : isSpawning ? 'Spawning...' : 'Spawn Agent'}
</button>
```

### Immediate agent appearance

After the `spawnLocalAgent` call resolves successfully, trigger a process list refresh. Either:

**Option A:** Import and call `fetchProcesses` from `localAgentsStore`:

```typescript
await useLocalAgentsStore.getState().fetchProcesses()
```

**Option B:** If `fetchProcesses` is not exported, add a `refreshProcesses` action to the store that simply calls `getAgentProcesses` and updates state.

Option A is simpler if `fetchProcesses` is already a store action.

## Success Criteria

1. Open SpawnModal → submit button shows "Loading..." and is disabled until repo paths load
2. If repo paths fail to load, an error toast is shown
3. Submit an agent → agent appears in AgentList sidebar within 1 second (not waiting for 5s poll)
4. The spawned agent's log viewer opens automatically (existing behavior preserved)
