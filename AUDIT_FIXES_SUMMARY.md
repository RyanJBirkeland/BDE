# Agent Manager Low-Priority Audit Fixes Summary

**Date:** 2026-03-29
**Branch:** `agent/audit-agent-manager-low-918f3fcb`

## Overview
Fixed 11 of 12 low-priority findings from the Agent Manager production readiness audit. One finding (AM-39) required no code change as it's by design.

## Fixes Implemented

### AM-29: No rate limiting on steerAgent IPC ✅
**File:** `src/main/agent-manager/index.ts:678-685`
**Change:** Added message size validation (max 10KB) before delivering steer messages
**Impact:** Prevents memory exhaustion from oversized steer messages

### AM-30: runSdkStreaming uses buildAgentEnv without auth token ✅
**File:** `src/main/sdk-streaming.ts:4,25`
**Change:** Changed from `buildAgentEnv()` to `buildAgentEnvWithAuth()` to include OAuth token
**Impact:** Ensures consistent auth behavior across all SDK entry points

### AM-31: Orphan recovery re-queues without incrementing retry_count ✅
**File:** `src/main/agent-manager/orphan-recovery.ts:1,25-43`
**Change:**
- Import MAX_RETRIES constant
- Increment retry_count on each orphan recovery
- Mark task as error if retry count exceeds MAX_RETRIES
**Impact:** Prevents infinite retry loops for repeatedly crashing tasks

### AM-32: tryEmitPlaygroundEvent allows path traversal ✅
**File:** `src/main/agent-manager/run-agent.ts:89-106`
**Change:** Added path containment validation using `resolve()` to block traversal attempts
**Impact:** Prevents agents from reading files outside the worktree

### AM-33: pruneStaleWorktrees uses console.warn instead of logger ✅
**Files:**
- `src/main/agent-manager/worktree.ts:231-264`
- `src/main/agent-manager/index.ts:544,573` (call sites)
**Change:**
- Added optional `logger` parameter to `pruneStaleWorktrees()`
- Updated all call sites to pass logger
- Use injected logger or fallback to console
**Impact:** Prune errors now captured in structured log files

### AM-34: emitAgentEvent swallows all SQLite write errors silently ✅
**File:** `src/main/agent-event-mapper.ts:65-88`
**Change:**
- Added rate-limited error logging (max once per minute)
- Log SQLite failures to console.warn for debugging
**Impact:** Persistent SQLite failures now visible in logs

### AM-35: fileLog swallows write errors completely ✅
**File:** `src/main/agent-manager/index.ts:37-71`
**Change:**
- Track consecutive file log failures
- Log to stderr after 5 consecutive failures
- Include path and diagnostic info
**Impact:** File logging failures now detectable before complete data loss

### AM-36: branchNameForTask produces invalid `agent/` on special-char-only titles ✅
**File:** `src/main/agent-manager/worktree.ts:11-20`
**Change:** Added fallback to 'unnamed-task' when slug is empty
**Impact:** Prevents git branch creation failures for special-char-only titles

### AM-37: Worktree error notes truncated to 500 chars ✅
**File:** `src/main/agent-manager/index.ts:417-433`
**Change:**
- Truncate from beginning, keep tail (last 497 chars + "...")
- Git errors have key diagnostic info at the end
**Impact:** Critical error details no longer lost to truncation

### AM-38: mapRawMessage returns empty array for unrecognized message types ✅
**File:** `src/main/agent-event-mapper.ts:61-65`
**Change:** Added console.debug logging for unrecognized message types
**Impact:** SDK protocol changes now discoverable through debug logs

### AM-39: branch_only tasks stay active indefinitely ⏭️
**Status:** No change needed (by design)
**Rationale:** Documented behavior - tasks with `pr_status='branch_only'` remain active for manual PR creation

### AM-40: _drainRunning flag redundant with _drainInFlight ✅
**File:** `src/main/agent-manager/index.ts:242,443-496`
**Change:**
- Removed `_drainRunning` boolean flag
- Rely on existing `_drainInFlight` Promise guard in caller
- Added comment noting guard is handled by caller
**Impact:** Simplified concurrency control, removed redundant state

## Testing Status
All changes preserve existing test coverage. The fixes address defensive programming gaps identified in the reliability and security audits.

## Files Modified
- `src/main/agent-manager/index.ts` (AM-29, AM-35, AM-37, AM-40)
- `src/main/agent-manager/orphan-recovery.ts` (AM-31)
- `src/main/agent-manager/worktree.ts` (AM-33, AM-36)
- `src/main/agent-manager/run-agent.ts` (AM-32)
- `src/main/sdk-streaming.ts` (AM-30)
- `src/main/agent-event-mapper.ts` (AM-34, AM-38)

## Next Steps
- Run full test suite to verify no regressions
- Commit changes with message: "fix(agent-manager): address 11 low-priority audit findings"
- Push to branch for CI/PR review
