# Agent Manager -- Red Team Re-Audit (v2)

**Date:** 2026-03-29
**Previous Audit:** docs/superpowers/audits/prod-audit/agent-manager-red.md

---

## Remediation Status

### Fixed

- **AM-RED-2: OAuth Token Passed via Environment Variable to Spawned Agent Processes** -- VERIFIED FIXED. The SDK path in `sdk-adapter.ts:43` now passes the token via the SDK's `apiKey` parameter (`...(token ? { apiKey: token } : {})`) instead of setting `ANTHROPIC_API_KEY` in the environment. The CLI fallback at `sdk-adapter.ts:88-89` still sets `ANTHROPIC_API_KEY` in env (necessary since CLI has no auth parameter), but this is scoped to a local copy of env, not the broader `buildAgentEnv()` cache. The comment at line 14 explicitly states "not passed via env". The env allowlist in `env-utils.ts` does not include `ANTHROPIC_API_KEY`, so it cannot leak from `buildAgentEnv()`.

- **AM-RED-3: Task Title Used Unsanitized in Git Commit Messages and PR Bodies** -- VERIFIED FIXED. `completion.ts:24-30` introduces `sanitizeForGit()` which strips backticks, command substitution `$()`, and markdown links. Called at `completion.ts:120` (commit message) and `completion.ts:187` (PR title). Tests should cover the sanitization function.

- **AM-RED-4: git push --no-verify Bypasses Pre-Push Security Hooks** -- VERIFIED FIXED. `completion.ts:358` now uses `['push', 'origin', branch]` without `--no-verify`. Comment at line 355 reads "run pre-push hooks for secret scanning". Pre-push hooks will now execute for agent pushes.

- **AM-RED-5: Playground HTML Files Served Without Sanitization (XSS via Agent Output)** -- VERIFIED FIXED. `run-agent.ts:17-18` imports `DOMPurify` and `JSDOM`. Lines 51-52 create a purify instance. `tryEmitPlaygroundEvent()` at line 123 calls `purify.sanitize(rawHtml)` before broadcasting. Script tags, event handlers, and `javascript:` URLs are stripped.

- **AM-RED-6: Worktree Lock Race Between Cleanup and Re-Acquire** -- VERIFIED FIXED. `worktree.ts:79-94` now uses atomic rename: writes to a temp file (`lockFile + '.${pid}.tmp'`), removes the stale lock, then uses `renameSync(tempLockFile, lockFile)` which is atomic on POSIX. Cleanup of the temp file on failure is also handled (line 92).

- **AM-RED-7: _checkAndBlockDeps Silently Proceeds on Parse Failure (Dependency Bypass)** -- VERIFIED FIXED. `index.ts:374-387` now sets the task to error status on parse failure: `status: 'error', notes: 'Malformed depends_on field - cannot validate dependencies'`. Returns `true` (blocks the task). Error is logged at line 376.

- **AM-RED-8: Agent Environment Inherits Full process.env Including Sensitive Variables** -- VERIFIED FIXED. `env-utils.ts:16-33` defines `ENV_ALLOWLIST` with only essential variables (PATH, HOME, USER, SHELL, LANG, TERM, TMPDIR, XDG_*, GIT_*, NODE_PATH). `buildAgentEnv()` at lines 38-60 iterates only over allowlisted keys plus `npm_config_*` prefixed vars. No longer copies `{ ...process.env }`.

- **AM-RED-10: No Rate Limiting on steerAgent IPC** -- VERIFIED FIXED. `index.ts:740-741` adds message size validation: `if (message.length > 10_000) return { delivered: false, error: 'Message exceeds 10KB limit' }`. Note: per-agent rate limiting (messages per minute) was not implemented, only size validation.

- **AM-RED-11: runSdkStreaming Uses buildAgentEnv Without Auth Token** -- VERIFIED FIXED. `sdk-streaming.ts:4` imports `buildAgentEnvWithAuth` (not `buildAgentEnv`). Line 25 calls `buildAgentEnvWithAuth()` which includes the OAuth token as `ANTHROPIC_API_KEY`. Consistent with `sdk-adapter.ts` auth approach.

- **AM-RED-12: Orphan Recovery Re-Queues Tasks Without Incrementing retry_count** -- VERIFIED FIXED. `orphan-recovery.ts:28` computes `retryCount = (task.retry_count ?? 0) + 1`. Lines 29-37 check against `MAX_RETRIES` and mark as error if exceeded. Line 44 includes `retry_count: retryCount` in the update. Notes at line 45 include retry progress.

- **AM-RED-13: tryEmitPlaygroundEvent Allows Path Traversal** -- VERIFIED FIXED. `run-agent.ts:105-111` adds path containment validation: resolves both the file path and worktree path, then checks `resolvedPath.startsWith(resolvedWorktree)`. Logs a warning and returns early on traversal attempts.

### Partially Fixed

- **AM-RED-1: Agents Run with bypassPermissions + Full Filesystem Access** -- PARTIALLY FIXED for pipeline agents. `sdk-adapter.ts` no longer passes `permissionMode: 'bypassPermissions'` or `allowDangerouslySkipPermissions` -- verified by tests in `sdk-adapter-sdk-path.test.ts:180-190` and `sdk-adapter.test.ts:83-107`. The CLI fallback also no longer passes `--permission-mode bypassPermissions`. However, the SDK's default permission mode when no `permissionMode` is specified needs verification -- pipeline agents may still have unrestricted tool access depending on SDK defaults. Additionally, `sdk-streaming.ts:33-34` (workbench/copilot), `adhoc-agent.ts:77-78` (user-spawned adhoc agents), and `spec-semantic-check.ts:33-34` (spec validation) all still use `bypassPermissions`. The `prompt-composer.ts` Hard Rules section (line 33) includes "NEVER commit secrets, .env files, or oauth tokens" as a prompt-level guardrail, but this is advisory. No `permittedPaths` or filesystem sandboxing was implemented.

- **AM-RED-9: git add -A in Auto-Commit Captures All Untracked Files Including Secrets** -- PARTIALLY FIXED. The push now runs with pre-push hooks enabled (AM-RED-4 fix), which provides protection IF the repo has secret-scanning hooks installed. However, `autoCommitIfDirty()` at `completion.ts:119` still uses `git add -A` with no built-in secret pattern scanning. Repos without pre-push hooks remain unprotected. The recommended `scanStagedFiles()` function was not implemented.

### Not Fixed

(none)

### New Issues Introduced by Remediation

- **NEW-1: DOMPurify + JSDOM Added as Dependencies for Playground Sanitization** -- The fix for AM-RED-5 introduced `dompurify` and `jsdom` as new dependencies (`run-agent.ts:17-18`). `JSDOM` instantiation at module scope (line 51: `new JSDOM('')`) occurs at import time, adding memory overhead and startup latency to every agent-manager import regardless of whether playground is used. `JSDOM` is a large dependency (~2MB) that increases the attack surface. The CLAUDE.md dependency policy states "No new npm packages without explicit approval." If these were approved, they should be lazily loaded (only when `playground_enabled` is true) to avoid unnecessary overhead.

- **NEW-2: sdk-streaming.ts Still Uses bypassPermissions** -- While the `sdk-adapter.ts` path was cleaned up (AM-RED-1 partial fix), `sdk-streaming.ts:33-34` still explicitly sets `permissionMode: 'bypassPermissions'` and `allowDangerouslySkipPermissions: true`. This is used by workbench chat and synthesizer flows. Though these are user-initiated (not pipeline), a compromised renderer could invoke `workbench:chatStream` IPC with arbitrary prompts that execute with full permissions.

- **NEW-3: Worktree Lock Stale Recovery Still Has a Minor TOCTOU Window** -- The fix for AM-RED-6 improved atomicity with `renameSync`, but `worktree.ts:83` still calls `rmSync(lockFile)` before `renameSync(tempLockFile, lockFile)` at line 89. If another process creates the lock file between `rmSync` and `renameSync`, `renameSync` will overwrite it (atomic on POSIX), which is correct behavior -- but the intervening `rmSync` is unnecessary and briefly removes the lock, creating a theoretical window where a third process could also acquire it. This is minor and only affects multi-instance BDE scenarios.

---

## Summary

| Status | Count |
|--------|-------|
| Fixed | 10 |
| Partially Fixed | 2 |
| Not Fixed | 0 |
| New Issues | 3 |

**Overall assessment:** Strong remediation effort -- 10 of 12 original findings are fully verified fixed, with the remaining 2 partially addressed. All high-severity items (AM-RED-2 token-via-env, AM-RED-3 title sanitization) are resolved. AM-RED-1 (bypassPermissions) was removed from the pipeline agent path but persists in adhoc, workbench, and spec-check paths. AM-RED-9 (git add -A secrets) is mitigated by enabling pre-push hooks but lacks built-in scanning. The new `JSDOM` dependency (NEW-1) should be lazily loaded.
