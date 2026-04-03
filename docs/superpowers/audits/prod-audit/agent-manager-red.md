# Agent Manager -- Red Team Audit

**Date:** 2026-03-29
**Scope:** 35 files in Agent Manager (18 source + 17 test)
**Persona:** Red Team (Security)

---

## Cross-Reference with March 28 Audit

### Previously Reported -- Now Fixed

- **main-process-sd S1 (Worktree lock TOCTOU race)**: The lock acquisition in `worktree.ts:41-83` now uses `writeFileSync(lockFile, pid, { flag: 'wx' })` for atomic creation, checks liveness of existing lock holders via `process.kill(pid, 0)`, and re-acquires atomically after cleaning stale locks. The TOCTOU window is reduced to near-zero for the single-process BDE use case. Tests in `worktree.test.ts` cover corrupted locks, dead PIDs, and alive PIDs.

- **UX-1 (Agent failure notes not actionable)**: Error notes now include actionable recovery guidance across all terminal paths: `handleWatchdogVerdict` in `index.ts:148,166`, fast-fail-exhausted in `run-agent.ts:379`, and empty-prompt in `run-agent.ts:145`. Verified via `index-extracted.test.ts` assertions on note content.

### Previously Reported -- Still Open

- **SEC-1 (Renderer sandbox disabled)**: Still present. Agents spawn via `permissionMode: 'bypassPermissions'` in `sdk-adapter.ts:46-47` and CLI fallback at `sdk-adapter.ts:108-109`. While this is within the main process (not renderer), the disabled renderer sandbox means a compromised renderer could interact with the agent manager's IPC surface.

- **SEC-5 (CORS wildcard on Queue API)**: Not in scope for this audit but still relevant -- the Queue API that the agent manager reads tasks from has CORS `*`. An attacker on a browser tab could inject tasks that the agent manager would execute with full file system access.

- **ARCH-6 (Fragile onStatusTerminal wiring)**: Still present. `task-terminal-service.ts` provides a unified service, but the agent manager's `onTaskTerminal` in `index.ts:280-289` uses a different path when `config.onStatusTerminal` is set vs. not set. The dual-path logic remains.

### New Findings

(See below)

---

## Findings

### AM-RED-1: Agents Run with bypassPermissions + Full Filesystem Access

- **Severity:** critical
- **Effort:** L (4hr+)
- **File(s):** `src/main/agent-manager/sdk-adapter.ts:46-47`, `src/main/agent-manager/sdk-adapter.ts:108-109`
- **Description:** Both the SDK path and CLI fallback spawn agents with `permissionMode: 'bypassPermissions'` and `allowDangerouslySkipPermissions: true`. The agent's working directory is a git worktree, but the agent has unrestricted tool access to the entire filesystem. A malicious or confused task spec could instruct the agent to read `~/.ssh/`, `~/.bde/oauth-token`, `~/.aws/credentials`, or any other sensitive file on the system, then exfiltrate data by writing it to a file that gets committed and pushed.
- **Evidence:**
  ```typescript
  // sdk-adapter.ts:40-51
  const queryResult = sdk.query({
    prompt: opts.prompt,
    options: {
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true
    }
  })
  ```
  The CLI fallback at line 108-109 passes `'--permission-mode', 'bypassPermissions'`.
- **Recommendation:** Add a `permittedPaths` or `sandboxPaths` constraint to the SDK options limiting agent filesystem access to the worktree directory and its parent repo. Until the SDK supports path sandboxing, add an allowlist to the prompt in `prompt-composer.ts:buildAgentPrompt()` instructing agents to only access files within the worktree, and add post-commit hooks in `completion.ts:autoCommitIfDirty()` that scan `git diff --cached` for files outside the worktree or containing credential patterns before pushing.

### AM-RED-2: OAuth Token Passed via Environment Variable to Spawned Agent Processes

- **Severity:** high
- **Effort:** S (< 1hr)
- **File(s):** `src/main/agent-manager/sdk-adapter.ts:16-18`, `src/main/env-utils.ts:49-55`
- **Description:** The OAuth token is set as `ANTHROPIC_API_KEY` in the environment of every spawned agent process. Environment variables of child processes are readable by any process running as the same user via `ps eww` on macOS. Additionally, if the agent runs shell commands or spawns subprocesses, the token is inherited by the entire process tree. A compromised or misbehaving agent can trivially exfiltrate the token.
- **Evidence:**
  ```typescript
  // sdk-adapter.ts:14-19
  const token = getOAuthToken()
  if (token) {
    env.ANTHROPIC_API_KEY = token
  }
  ```
- **Recommendation:** Investigate whether the SDK supports file-based token passing (e.g., `ANTHROPIC_API_KEY_FILE`). If not, minimize the token's scope by creating per-agent short-lived tokens if the auth system supports it. At minimum, add `ANTHROPIC_API_KEY` to the prompt-composer's `## Hard Rules` section instructing agents to never read, log, or output environment variables.

### AM-RED-3: Task Title Used Unsanitized in Git Commit Messages and PR Bodies

- **Severity:** high
- **Effort:** S (< 1hr)
- **File(s):** `src/main/agent-manager/completion.ts:106`, `src/main/agent-manager/completion.ts:172-175`
- **Description:** While `branchNameForTask()` sanitizes the title for branch names, the original `task.title` is used directly as a git commit message in `autoCommitIfDirty()`. The `body` parameter for PR creation comes from `generatePrBody()` which includes git log output that could contain attacker-controlled commit messages. Although `execFile` (argument array) prevents shell injection, a task title containing GitHub markdown injection (e.g., image tags referencing external URLs for tracking, or `[text](javascript:...)`) would appear in the PR body on GitHub.
- **Evidence:**
  ```typescript
  // completion.ts:106
  await execFile('git', ['commit', '-m',
    `${title}\n\nAutomated commit by BDE agent manager`], ...)
  ```
  ```typescript
  // completion.ts:172-175
  await execFile('gh', ['pr', 'create',
    '--title', title, '--body', body, ...], ...)
  ```
- **Recommendation:** Add a `sanitizeTitle(title: string): string` function in `worktree.ts` that strips control characters (chars < 0x20 except newline), backticks, and HTML tags. Call it in `_mapQueuedTask()` at `index.ts:305`. Apply the same sanitization to commit messages and PR titles in `completion.ts`.

### AM-RED-4: git push --no-verify Bypasses Pre-Push Security Hooks

- **Severity:** medium
- **Effort:** S (< 1hr)
- **File(s):** `src/main/agent-manager/completion.ts:323`
- **Description:** Agent-generated code is pushed with `--no-verify`, skipping pre-push hooks. If the repository has pre-push hooks that check for leaked secrets (e.g., `git-secrets`, `detect-secrets`, or `trufflehog`), these are bypassed. Agent-committed code goes directly to a PR branch without any local secret scanning.
- **Evidence:**
  ```typescript
  // completion.ts:323
  await execFile('git', ['push', '--no-verify', 'origin', branch], {
    cwd: worktreePath,
    env: buildAgentEnv()
  })
  ```
- **Recommendation:** Remove `--no-verify` from the push command, or add a dedicated secret-scanning step in `resolveSuccess()` between `autoCommitIfDirty()` and the push. For example, add a `scanForSecrets(worktreePath, logger)` function that runs `git diff --cached --name-only` and rejects files matching patterns like `*.pem`, `*.key`, `.env*`. The CLAUDE.md documents `--no-verify` as intentional ("agent code is reviewed via PR"), but the risk is that secrets are visible in the remote branch before PR review.

### AM-RED-5: Playground HTML Files Served Without Sanitization (XSS via Agent Output)

- **Severity:** medium
- **Effort:** M (1-4hr)
- **File(s):** `src/main/agent-manager/run-agent.ts:89-125`
- **Description:** `tryEmitPlaygroundEvent()` reads arbitrary HTML files written by the agent and broadcasts them via IPC as `agent:playground` events. The HTML content is read raw and sent to the renderer without any sanitization. Combined with SEC-1 (renderer sandbox disabled), agent-generated HTML with malicious scripts could gain full Node.js access in the renderer. A malicious task spec could instruct the agent to write an HTML file containing script tags that spawn processes.
- **Evidence:**

  ```typescript
  // run-agent.ts:107-108
  const html = await readFile(absolutePath, 'utf-8')
  const filename = basename(absolutePath)

  const event: AgentEvent = {
    type: 'agent:playground',
    filename,
    html, // unsanitized raw HTML
    sizeBytes: stats.size,
    timestamp: Date.now()
  }
  broadcast('agent:event', { agentId: taskId, event })
  ```

- **Recommendation:** Sanitize HTML in `tryEmitPlaygroundEvent()` before broadcasting. Use DOMPurify or a similar library to strip script tags, event handlers (`onclick`, `onerror`, etc.), and `javascript:` URLs. Alternatively, ensure the renderer's PlaygroundModal uses `sandbox="allow-same-origin"` without `allow-scripts`. This finding compounds SEC-4 from the March audit.

### AM-RED-6: Worktree Lock Race Between Cleanup and Re-Acquire

- **Severity:** medium
- **Effort:** S (< 1hr)
- **File(s):** `src/main/agent-manager/worktree.ts:78-83`
- **Description:** After determining a lock is stale (held by dead PID), the code does `rmSync(lockFile)` followed by `writeFileSync(lockFile, pid, { flag: 'wx' })`. Between the `rmSync` and `writeFileSync`, another process could create the lock file, causing the `writeFileSync` to throw with EEXIST. This is a minor TOCTOU window that only matters with concurrent BDE instances.
- **Evidence:**
  ```typescript
  // worktree.ts:78-83
  try {
    rmSync(lockFile)
  } catch {
    /* already gone */
  }
  writeFileSync(lockFile, String(process.pid), { flag: 'wx' })
  ```
- **Recommendation:** Use atomic rename instead: `writeFileSync(lockFile + '.tmp', String(process.pid)); renameSync(lockFile + '.tmp', lockFile)`. `renameSync` is atomic on POSIX filesystems and overwrites the target, eliminating the TOCTOU window. Implement this in `acquireLock()` at `worktree.ts:41`.

### AM-RED-7: \_checkAndBlockDeps Silently Proceeds on Parse Failure (Dependency Bypass)

- **Severity:** medium
- **Effort:** S (< 1hr)
- **File(s):** `src/main/agent-manager/index.ts:327-351`
- **Description:** If the `depends_on` field contains malformed JSON, the outer catch block at line 348 silently swallows the error and returns `false`, allowing the task to proceed without dependency checking. An attacker with Queue API access could craft a task with intentionally malformed `depends_on` to bypass dependency blocking entirely.
- **Evidence:**
  ```typescript
  // index.ts:347-351
  } catch {
    // If dep parsing fails, proceed without blocking
  }
  return false
  ```
  Test at `index-methods.test.ts:444-448` explicitly validates this behavior: "returns false when dep parsing fails (invalid JSON)".
- **Recommendation:** Change the catch block in `_checkAndBlockDeps()` to set the task to error status rather than silently proceeding: `this.logger.error(...); try { this.repo.updateTask(taskId, { status: 'error', notes: 'Malformed depends_on field - cannot validate dependencies' }); } catch {} return true;`. Update the test at `index-methods.test.ts:444` to expect `true` and verify the task is set to error.

### AM-RED-8: Agent Environment Inherits Full process.env Including Sensitive Variables

- **Severity:** medium
- **Effort:** M (1-4hr)
- **File(s):** `src/main/env-utils.ts:17-24`
- **Description:** `buildAgentEnv()` starts with `{ ...process.env }` and only modifies `PATH`. This means every environment variable in the Electron main process is passed to spawned agent subprocesses, including any `DATABASE_URL`, `AWS_SECRET_ACCESS_KEY`, `GITHUB_TOKEN`, or other secrets that may be set in the user's shell environment.
- **Evidence:**
  ```typescript
  // env-utils.ts:18-23
  export function buildAgentEnv(): Record<string, string | undefined> {
    if (_cachedEnv) return { ..._cachedEnv }
    const env = { ...process.env } // copies ALL env vars
    // ...only modifies PATH...
    _cachedEnv = env
    return { ..._cachedEnv }
  }
  ```
- **Recommendation:** Create an allowlist of environment variables that agents need in `buildAgentEnv()`: `PATH`, `HOME`, `USER`, `SHELL`, `LANG`, `TERM`, `TMPDIR`, `XDG_*`, `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`, `GIT_COMMITTER_NAME`, `GIT_COMMITTER_EMAIL`, `NODE_PATH`, `npm_config_*`. Build `env` by picking only these keys from `process.env` instead of copying everything.

### AM-RED-9: git add -A in Auto-Commit Captures All Untracked Files Including Secrets

- **Severity:** medium
- **Effort:** S (< 1hr)
- **File(s):** `src/main/agent-manager/completion.ts:105`
- **Description:** `autoCommitIfDirty()` uses `git add -A` which stages ALL files in the worktree, including any secrets the agent may have written. While the repo's `.gitignore` excludes common patterns, agent-created files with non-standard names (e.g., `tokens.txt`, `creds.json`, `key.pem`) would be committed and pushed.
- **Evidence:**
  ```typescript
  // completion.ts:105
  await execFile('git', ['add', '-A'], { cwd: worktreePath, env: buildAgentEnv() })
  ```
- **Recommendation:** Add a pre-push scan after `git add -A` in `autoCommitIfDirty()` that checks staged files for secret patterns. After the `git add -A` call, run `git diff --cached --name-only` and check filenames against a deny-list (`*.pem`, `*.key`, `*credential*`, `*secret*`, `.env*`, `oauth-token`). If matches are found, unstage them with `git reset HEAD -- <file>` and log a warning. Implement as a `scanStagedFiles(worktreePath: string, logger: Logger)` function in `completion.ts`.

### AM-RED-10: No Rate Limiting on steerAgent IPC

- **Severity:** low
- **Effort:** S (< 1hr)
- **File(s):** `src/main/agent-manager/index.ts:678-681`
- **Description:** `steerAgent()` forwards user messages directly to the agent with no rate limiting, message size validation, or input sanitization. A compromised renderer could flood the agent with steer messages or inject extremely large payloads that consume memory.
- **Evidence:**
  ```typescript
  // index.ts:678-681
  async steerAgent(taskId: string, message: string): Promise<SteerResult> {
    const agent = this._activeAgents.get(taskId)
    if (!agent) return { delivered: false, error: 'Agent not found' }
    return agent.handle.steer(message)
  }
  ```
- **Recommendation:** Add message size validation at the top of `steerAgent()`: `if (message.length > 10_000) return { delivered: false, error: 'Message exceeds 10KB limit' }`. Consider adding a per-agent rate limiter (max 10 messages per minute) using a timestamp array in the `ActiveAgent` record.

### AM-RED-11: runSdkStreaming Uses buildAgentEnv Without Auth Token

- **Severity:** low
- **Effort:** S (< 1hr)
- **File(s):** `src/main/sdk-streaming.ts:25-26`
- **Description:** `runSdkStreaming()` calls `buildAgentEnv()` which does NOT include the OAuth token. This is inconsistent with `sdk-adapter.ts` which explicitly sets `ANTHROPIC_API_KEY`. The SDK query relies on whatever ambient credential it can find, which may fail or use an unexpected credential source.
- **Evidence:**
  ```typescript
  // sdk-streaming.ts:25-26
  const sdk = await import('@anthropic-ai/claude-agent-sdk')
  const env = buildAgentEnv() // no auth token
  ```
  vs. `sdk-adapter.ts:12-18` which adds `env.ANTHROPIC_API_KEY = token`.
- **Recommendation:** Change `sdk-streaming.ts:26` to use `buildAgentEnvWithAuth()` from `env-utils.ts` instead of `buildAgentEnv()`. This ensures consistent auth behavior across all SDK entry points.

### AM-RED-12: Orphan Recovery Re-Queues Tasks Without Incrementing retry_count

- **Severity:** low
- **Effort:** S (< 1hr)
- **File(s):** `src/main/agent-manager/orphan-recovery.ts:28-32`
- **Description:** When orphan recovery re-queues a task, it does not increment `retry_count`. A task that repeatedly crashes (causing the agent process to die without proper cleanup) will be retried indefinitely via orphan recovery, consuming API credits without bound.
- **Evidence:**
  ```typescript
  // orphan-recovery.ts:28-32
  repo.updateTask(task.id, {
    status: 'queued',
    claimed_by: null,
    notes: 'Task was re-queued by orphan recovery...'
    // retry_count NOT incremented
  })
  ```
- **Recommendation:** Increment `retry_count` in the orphan recovery update. Add a guard before re-queuing: `const retryCount = (task.retry_count ?? 0) + 1; if (retryCount >= MAX_RETRIES) { repo.updateTask(task.id, { status: 'error', notes: 'Exceeded max retries via orphan recovery', claimed_by: null }); continue; }`. Update `orphan-recovery.test.ts` to verify the new behavior.

### AM-RED-13: tryEmitPlaygroundEvent Allows Path Traversal

- **Severity:** low
- **Effort:** S (< 1hr)
- **File(s):** `src/main/agent-manager/run-agent.ts:96-97`
- **Description:** `tryEmitPlaygroundEvent()` resolves paths with `filePath.startsWith('/') ? filePath : join(worktreePath, filePath)`. If an agent writes an HTML file at an absolute path outside the worktree (e.g., `/tmp/evil.html`) or uses relative traversal (`../../etc/hosts.html`), the function would read and broadcast it. No path containment check exists.
- **Evidence:**
  ```typescript
  // run-agent.ts:96-97
  const absolutePath = filePath.startsWith('/') ? filePath : join(worktreePath, filePath)
  ```
  No test in `run-agent-playground.test.ts` validates path containment.
- **Recommendation:** Add path validation after resolving: `const resolved = path.resolve(absolutePath); if (!resolved.startsWith(path.resolve(worktreePath))) { logger.warn('[playground] Path traversal blocked: ' + filePath); return; }`. Add test cases in `run-agent-playground.test.ts` for absolute paths outside worktree and `../` traversal inputs.

---

## Summary

| Severity | Count |
| -------- | ----- |
| Critical | 1     |
| High     | 2     |
| Medium   | 5     |
| Low      | 4     |

---

## Test Coverage Gaps Masking Security Issues

1. **No tests for environment variable leakage**: No test verifies what environment variables are passed to spawned agents. `sdk-adapter.test.ts` and `sdk-adapter-sdk-path.test.ts` mock `buildAgentEnv` entirely, so the real env-passing behavior is untested.

2. **No tests for playground path traversal**: `tryEmitPlaygroundEvent` has no test that validates path containment within the worktree.

3. **No tests for steer message size/rate**: `steerAgent` tests only validate delivery, not abuse scenarios.

4. **No integration test for orphan recovery retry exhaustion**: Orphan recovery tests verify re-queuing but not what happens when `retry_count` approaches `MAX_RETRIES`.

5. **No test for autoCommitIfDirty secret detection**: `completion.test.ts` tests the git push flow but not what files get staged by `git add -A`.

6. **runSdkStreaming auth inconsistency is untested**: No test compares or validates the auth approach between `sdk-adapter.ts` and `sdk-streaming.ts`.
