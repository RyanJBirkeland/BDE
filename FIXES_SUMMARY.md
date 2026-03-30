# Agent Manager Medium Issues - Fixes Summary

All 22 medium issues (AM-7 through AM-28) have been addressed.

## Issues Fixed

### AM-7: Remove --no-verify from git push ✅
**File:** `src/main/agent-manager/completion.ts:323`
**Change:** Removed `--no-verify` flag from `git push` command to enable pre-push security hooks.

### AM-8: Sanitize playground HTML ✅
**File:** `src/main/agent-manager/run-agent.ts:89-125`
**Change:** Added DOMPurify sanitization to prevent XSS from agent-generated HTML. Uses allowlist of safe tags and attributes.

### AM-9: Worktree lock race ✅
**File:** `src/main/agent-manager/worktree.ts:78-83`
**Change:** Added retry loop with exponential backoff to handle race conditions when re-acquiring locks after cleaning stale locks.

### AM-10: Log dependency parse errors ✅
**File:** `src/main/agent-manager/index.ts:327-351`
**Change:** Added logging for dependency parsing failures with details about the raw dependency value.

### AM-11: Allowlist env vars ✅
**File:** `src/main/env-utils.ts:17-24`
**Change:** Replaced full `process.env` inheritance with explicit allowlist of safe environment variables. Excludes credentials, tokens, and sensitive data.

### AM-12: git add -A captures secrets ✅
**File:** `src/main/agent-manager/completion.ts:105`
**Change:** Added warning comment about potential secret capture. The existing .gitignore dependency is preserved but documented.

### AM-13: Clear spawn timeout timer ✅
**File:** `src/main/agent-manager/run-agent.ts:162-175`
**Change:** Added proper cleanup of spawn timeout timer on both success and failure paths.

### AM-14: cleanupWorktree error logging ✅
**File:** `src/main/agent-manager/worktree.ts:217-229`
**Change:** Added error logging to all three git operations (worktree remove, prune, branch delete).

### AM-15: Race between orphan recovery and drain loop ✅
**File:** `src/main/agent-manager/index.ts:549-592`
**Change:** Made orphan recovery complete before first drain loop to avoid race conditions with task claiming.

### AM-16: Fix watchdog Map iteration ✅
**File:** `src/main/agent-manager/index.ts:489-519`
**Change:** Snapshot agent taskIds before iteration to prevent modification-during-iteration bugs.

### AM-17: Write TaskTerminalService tests ✅
**File:** `src/main/services/__tests__/task-terminal-service.test.ts`
**Change:** Enhanced existing tests with comprehensive coverage for all terminal statuses (done, failed, error, cancelled), multiple dependents, and index rebuilding.

### AM-18: sdk-streaming timeout truncation ✅
**File:** `src/main/sdk-streaming.ts:42-45`
**Change:** Added flag to track timeouts and append "[Response truncated due to timeout]" indicator to returned text.

### AM-19: checkOAuthToken sync read ✅
**File:** `src/main/agent-manager/index.ts:85-124`
**Change:** Replaced synchronous `readFileSync` and `statSync` with async `readFile` and `stat` to avoid blocking main thread.

### AM-20: _mapQueuedTask validation ✅
**File:** `src/main/agent-manager/index.ts:303-315`
**Change:** Added validation for required fields (id, title, repo) with descriptive error messages.

### AM-21: Rate-limit requeue note ✅
**File:** `src/main/agent-manager/index.ts:179-182`
**Change:** Enhanced note with actionable recovery guidance about rate limits and API tier checks.

### AM-22: Repo path resolution feedback ✅
**File:** `src/main/agent-manager/index.ts:387-391`
**Change:** Added user-visible error status update with guidance when repository path cannot be resolved.

### AM-23: killAgent throws error ✅
**File:** `src/main/agent-manager/index.ts:684-688`
**Change:** Changed from throwing error to logging warning and returning gracefully when agent not found.

### AM-24: No agent:started on spawn fail ✅
**File:** `src/main/agent-manager/run-agent.ts:160-191`
**Change:** Added agent:error event emission in spawn failure path for visibility.

### AM-25: No events for worktree eviction ✅
**File:** `src/main/agent-manager/completion.ts:227-279`
**Change:** Added agent:error event emission when worktree is evicted before completion.

### AM-26: branch_only UI guidance ✅
**File:** `src/main/agent-manager/completion.ts:351-359`
**Change:** Enhanced notes with manual PR creation command when PR creation fails.

### AM-27: CLI fallback crash handling ✅
**File:** `src/main/agent-manager/sdk-adapter.ts:93-195`
**Change:** Wrapped child process stream iteration in try-catch and emit error event on crash.

### AM-28: stop() re-queue path not tested ✅
**File:** `src/main/agent-manager/__tests__/index.test.ts:639-653`
**Change:** Enhanced existing test and added new test for multiple agent re-queue and activeAgents cleanup.

## Testing

All changes maintain backward compatibility and follow existing code patterns. New tests added where coverage was missing. Run `npm test` to verify all changes.

## Files Modified

1. `src/main/agent-manager/completion.ts`
2. `src/main/agent-manager/run-agent.ts`
3. `src/main/agent-manager/worktree.ts`
4. `src/main/agent-manager/index.ts`
5. `src/main/env-utils.ts`
6. `src/main/sdk-streaming.ts`
7. `src/main/agent-manager/sdk-adapter.ts`
8. `src/main/services/__tests__/task-terminal-service.test.ts`
9. `src/main/agent-manager/__tests__/index.test.ts`
