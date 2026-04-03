# FC-S2: Git push silently swallows failures

## Problem Statement

`gitPush()` in `src/main/git.ts:119-127` uses `spawnSync('git', ['push'])` but never checks `result.status` for non-zero exit codes. When a push is rejected (no upstream branch, authentication failure, force-push denied, remote hook rejection), `result.error` is `null` (the spawn itself succeeded), so the function falls through to return `result.stdout + result.stderr` — the git error message — as if it were a success string.

In DiffView, `doPush()` at line 189-196 sets `setPushOutput(output || 'Pushed successfully')`, so the rejection message appears in the UI with success styling. The user has no way to distinguish a successful push from a failed one.

## Root Cause

`spawnSync` does not throw on non-zero exit codes. It populates `result.status` (the exit code) and `result.stderr` (the error output). The current code only checks `result.error` (which indicates a spawn failure, e.g., `git` binary not found), not `result.status`.

## Files to Change

| File                                  | Change                                                                                                                                       |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/main/git.ts`                     | In `gitPush()`: check `result.status !== 0` and throw an Error with the stderr content                                                       |
| `src/renderer/src/views/DiffView.tsx` | In `doPush()`: catch the thrown error and display it as an error state (red banner or error toast) instead of treating all output as success |

## Implementation Notes

### git.ts changes (lines 119-127)

```typescript
export function gitPush(cwd: string): string {
  const result = spawnSync('git', ['push'], { cwd, encoding: 'utf-8' })
  if (result.error) throw new Error(result.error.message)
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `git push exited with code ${result.status}`)
  }
  return (result.stdout + result.stderr).trim() || 'Pushed successfully'
}
```

### DiffView.tsx changes (around line 189)

The `doPush` handler already has a try/catch. The catch branch should:

1. Set `pushOutput` to the error message
2. Show an error toast
3. Optionally add an `isPushError` state to render the output in red

## Success Criteria

1. Push to a repo with no upstream branch → error toast + red error text in UI
2. Push to a repo where the remote rejects (e.g., protected branch) → error toast + stderr displayed
3. Successful push → green "Pushed successfully" or actual git output
4. Unit test: mock `spawnSync` returning `status: 1` and verify `gitPush` throws
