# BDE Full Audit — Synthesis Report
**Date:** 2026-04-14  
**Lenses:** Architecture (arch, clean, ipc) · Security (inject, sandbox, oauth) · Performance (perf, sqlite) · Agent/Testing (agent, test)  
**Total source findings:** 66 across 10 lenses

---

## 1. Top 10 Ranked Actions

Score = (Severity × Confidence) / Effort  
Critical=4, High=3, Medium=2, Low=1 · High=3, Medium=2, Low=1 · S=1, M=2, L=4

| Rank | Finding ID(s) | Title | Score | Sev | Conf | Eff | One-line fix |
|------|---------------|-------|-------|-----|------|-----|--------------|
| 1 | F-t2-sandbox-1 + F-t2-sandbox-2 | DOMPurify playground has no ALLOWED_TAGS whitelist | **(4×3)/1 = 12.0** | Critical | High | S | Pass explicit `ALLOWED_TAGS` + `ALLOWED_ATTR` config to `sanitizePlaygroundHtml()`; drop `<style>`, `<iframe>`, `<embed>`, `<object>` |
| 2 | F-t2-inject-1 | Git checkout handler accepts unvalidated branch names | **(4×3)/1 = 12.0** | Critical | High | S | Add `validateGitRef(branch)` in the `git:checkout` safeHandle before calling `gitCheckout()` |
| 3 | F-t2-inject-2 + F-t2-inject-4 | Branch names interpolated into git log/diff and git pull without validation | **(3×3)/1 = 9.0** | High | High | S | Call `validateGitRef(branch)` at top of `generatePrBody()` and in the `git:pull` handler |
| 4 | F-t3-sqlite-1 | Missing indices on `started_at` and `completed_at` cause full table scans on every health-check | **(3×3)/1 = 9.0** | High | High | S | Add migration: `CREATE INDEX idx_sprint_tasks_started_at` + `idx_sprint_tasks_completed_at` (composite with status for health-check) |
| 5 | F-t4-agent-4 | Drain loop fetches task list then spawns without re-validating status — double-spawn risk | **(3×3)/1 = 9.0** | High | High | S | In `_validateAndClaimTask()`, re-fetch task from repo and bail if status is no longer `queued` |
| 6 | F-t4-agent-8 + F-t4-agent-1 | Agent events not flushed before status transitions or shutdown — events lost | **(3×3)/1 = 9.0** | High | High | S | Call `flushAgentEventBatcher()` immediately after `resolveAgentExit()` in `finalizeAgentRun()`; wait for agent promises before flush in `stop()` |
| 7 | F-t2-sandbox-3 | Open-in-browser writes raw HTML to predictable `/tmp` path and never deletes it | **(4×3)/2 = 6.0** | Critical | High | M | Re-sanitize HTML before writing; use `randomBytes(16)` filename; schedule deletion after 5 min |
| 8 | F-t3-sqlite-3 + F-t3-sqlite-4 | SQLite pragma uses string interpolation; `updateTaskMergeableState` iterates instead of bulk-inserting audit trail | **(3×3)/1 = 9.0** tied — tiebreak: Effort S wins | High | High | S | Replace `db.pragma(\`user_version = ${v}\`)` with `db.prepare('PRAGMA user_version = ?').run(v)`; replace per-task `recordTaskChanges` loop with `recordTaskChangesBulk` |
| 9 | F-t2-oauth-2 | GitHub token stored in plaintext SQLite | **(3×3)/2 = 4.5** | High | High | M | Delegate to `gh` CLI keychain storage or encrypt the `github.token` settings column |
| 10 | F-t4-agent-5 | Cascade cancellation runs without a transaction — partial failures leave orphaned blocked tasks | **(3×3)/2 = 4.5** | High | High | M | Pass a real `runInTransaction` callback from agent-manager to `handleTaskTerminal` so cascade cancellations are atomic |

**Tie-breaking note:** Ranks 3–8 all compute 9.0. Tie-broken by Severity desc then Effort asc (S beats M beats L). Where Severity and Effort are identical the order is editorial based on blast radius.

---

## 2. Cross-Cutting Themes

### Theme A: Validation Exists But Is Not Applied Consistently
**Contributing findings:** F-t2-inject-1, F-t2-inject-2, F-t2-inject-4, F-t1-ipc-4, F-t3-sqlite-3

`SAFE_REF_PATTERN` / `validateGitRef()` exists in `src/main/lib/review-paths.ts` and is used in the review path, but is not called in the git:checkout or git:pull IPC handlers, nor in `generatePrBody()`. Similarly, `UPDATE_ALLOWLIST` exists but batch handlers re-implement validation inline. The codebase has the right tools; the problem is call-site gaps. Systemic cause: validation helpers live in a library module with no enforcement that callers use them.

### Theme B: Agent Event Persistence Is Fragile Under Concurrency
**Contributing findings:** F-t4-agent-1, F-t4-agent-8, F-t4-agent-4, F-t4-agent-5, F-t4-agent-6

Events are batched (100 ms timer) for SQLite efficiency, but the flush contract is not enforced at every status-transition boundary. Drain loop fetches state without re-validating freshness. Cascade cancellations are not transactional. Retry counters for fast-fail vs. normal exit diverge. Systemic cause: the agent lifecycle is a distributed state machine spread across `run-agent.ts`, `completion.ts`, `terminal-handler.ts`, and `resolve-dependents.ts` with no single ownership point.

### Theme C: Playground / Agent HTML Is Under-Sanitized
**Contributing findings:** F-t2-sandbox-1, F-t2-sandbox-2, F-t2-sandbox-3, F-t2-sandbox-4, F-t2-sandbox-5, F-t2-sandbox-8

DOMPurify is called without an explicit allowlist (relying on permissive defaults), the `<style>` tag is not blocked (enabling CSS exfiltration), and the "Open in Browser" path writes to a predictable `/tmp` path with no cleanup. All five issues share a root cause: `playground-sanitize.ts` was added as a safety shim but was never tightened after the feature shipped.

### Theme D: Broad Zustand Subscriptions Cause Cascading Re-renders
**Contributing findings:** F-t3-perf-1, F-t3-perf-2, F-t3-perf-5, F-t3-perf-6

ReviewQueue, Sidebar, SprintPipeline, and WorkbenchForm all subscribe to the entire `s.tasks` array and recompute derived state (filter, sort, count) synchronously on every store change. Any task update — including unrelated field changes from polling — invalidates the memo and re-runs expensive operations. Systemic cause: scoped selectors and `useShallow` were not standardized as the pattern when these components were written.

### Theme E: Data Layer Has Zero Test Coverage on Critical Paths
**Contributing findings:** F-t4-test-2, F-t4-test-3, F-t4-test-7, F-t4-test-4

`sprint-queue-ops.ts`, `sprint-pr-ops.ts`, `sprint-maintenance.ts`, and `completion.ts` manage the most critical task state mutations in the system and have no meaningful tests. IPC handler tests verify mock wiring, not behavior. Systemic cause: test infrastructure favors mocking over in-memory SQLite fixtures, making real integration tests harder to write than mock-heavy unit tests.

---

## 3. Quick Wins

All findings with Score >= 6.0 AND Effort = S:

| Finding ID(s) | Score | Fix description |
|---------------|-------|-----------------|
| F-t2-sandbox-1 + F-t2-sandbox-2 | 12.0 | Add `ALLOWED_TAGS` whitelist to `sanitizePlaygroundHtml()` and exclude `<style>`, `<iframe>`, `<embed>` |
| F-t2-inject-1 | 12.0 | Add one `validateGitRef(branch)` call in the `git:checkout` IPC handler |
| F-t2-inject-2 + F-t2-inject-4 | 9.0 | Add `validateGitRef(branch)` at the top of `generatePrBody()` and in the `git:pull` handler |
| F-t3-sqlite-1 | 9.0 | Add two-index migration (`started_at`, `completed_at`) — one small migration file |
| F-t4-agent-4 | 9.0 | Re-fetch task from repo inside `_validateAndClaimTask()` before proceeding with spawn |
| F-t4-agent-8 + F-t4-agent-1 | 9.0 | Call `flushAgentEventBatcher()` after `resolveAgentExit()` and after all agent promises settle in `stop()` |
| F-t3-sqlite-3 + F-t3-sqlite-4 | 9.0 | One-line pragma fix; swap per-task loop for `recordTaskChangesBulk()` |
| F-t2-inject-4 (standalone) | — | Already covered in F-t2-inject-2 merge above |
| F-t1-arch-5 | (4×3)/1 = 12.0? No — Severity Medium → (2×3)/1 = 6.0 | Move raw SQL cleanup in `bootstrap.ts` into `SprintTaskMaintenanceService.cleanTestArtifacts()` |
| F-t1-clean-3 | (2×3)/1 = 6.0 | Extract `logCleanupWarning(taskId, worktreePath, err, logger)` to deduplicate 4 copy-pasted worktree cleanup error handlers |
| F-t1-clean-7 | (1×3)/1 = 3.0 | Below threshold |
| F-t3-sqlite-5 | (2×2)/1 = 4.0 | Below threshold |
| F-t4-agent-2 | (3×3)/1 = 9.0 (Effort S) | In cascade error path, re-throw from `onTaskTerminal` catch block instead of silently continuing with stale dependency index |

---

## 4. Security Hotlist

All security findings ranked by severity (inject + sandbox + oauth lenses):

| Priority | Finding | Severity | Effort | Description |
|----------|---------|----------|--------|-------------|
| 1 | F-t2-sandbox-1 | Critical | S | DOMPurify called with zero config — `<iframe>`, `<embed>`, `<object>` allowed by default |
| 2 | F-t2-sandbox-3 | Critical | M | Open-in-browser writes agent HTML to predictable `/tmp` path with no sanitization re-check and no cleanup |
| 3 | F-t2-inject-1 | Critical | S | `git:checkout` handler passes renderer-supplied branch name directly to git — flag injection possible |
| 4 | F-t2-sandbox-2 | High | S | `<style>` tag permitted by DOMPurify defaults — CSS exfiltration via `background-image: url(...)` |
| 5 | F-t2-inject-2 | High | S | Branch names interpolated into `git log`/`git diff` range arguments without `validateGitRef()` |
| 6 | F-t2-inject-3 | High | M | `sanitizeForGit()` does visual escaping only — newline injection enables git trailer poisoning |
| 7 | F-t2-sandbox-4 | High | M | CSS pseudo-elements (`:before`/`:after`) not blocked — content attribute can expose data-attributes |
| 8 | F-t2-oauth-2 | High | M | GitHub Personal Access Token stored in plaintext SQLite `settings` table |
| 9 | F-t2-inject-4 | Medium | S | `git:pull` handler passes unvalidated branch name — same vector as F-t2-inject-1 |
| 10 | F-t2-sandbox-5 | Medium | M | Production CSP contains `unsafe-inline` for `style-src` — weakens DOMPurify protection |
| 11 | F-t2-oauth-1 | Medium | S | OAuth token file read without max-length bound — crafted large file causes memory exhaustion |
| 12 | F-t2-oauth-3 | Medium | M | OAuth token cached for 5 min with no IPC invalidation — stale token used after manual rotation |
| 13 | F-t2-inject-4 (pull) | Medium | S | Already merged into entry 9 above |
| 14 | F-t2-sandbox-6 | Medium | S | `render-markdown.ts` DOMPurify config lacks explicit `javascript:` URL block test |
| 15 | F-t1-ipc-5 | High | L | TOCTOU race in IDE path validation — symlink swap between `realpathSync()` and the actual write |
| 16 | F-t2-inject-5 | Medium | M | VACUUM INTO path constructed via template literal — currently escaped but fragile |
| 17 | F-t2-inject-6 | Medium | M | Grep query passed as regex without `-F` flag — ReDoS risk from user input |
| 18 | F-t2-oauth-4 | Medium | M | Webhook secrets returned to renderer in IPC response and stored in plaintext |
| 19 | F-t2-sandbox-8 | Medium | S | Playground sanitization error not caught before broadcast — malformed HTML may reach renderer unsanitized |
| 20 | F-t2-oauth-5 | Low | M | No OAuth expiry check before agent spawn — expired token causes wasted API calls before refresh |

**Immediate actions for owner (today):**  
F-t2-sandbox-1 (10 lines), F-t2-inject-1 (1 line), F-t2-inject-2 + F-t2-inject-4 (2 lines), F-t2-oauth-1 (1 line check), F-t2-sandbox-3 (re-sanitize + random filename + cleanup).

---

## 5. Deferred / Out of Scope

| Finding | Reason to defer |
|---------|----------------|
| F-t1-arch-1 (AgentOrchestrationService) | High value but L effort refactor — the existing code works correctly; defer until after reliability gaps are closed |
| F-t1-clean-5 (resolveSuccess/resolveFailure unification) | L effort, behavioral risk — the bifurcation is a code smell but not a bug; defer to a dedicated refactor sprint |
| F-t1-clean-4 (TaskQueueingPolicy service) | Medium confidence — the inconsistency between single-task and batch queuing paths is real but not causing user-visible failures today |
| F-t2-sandbox-7 (performance timing side-channels in iframe) | Theoretical attack requiring a sophisticated local attacker; mitigating requires breaking playground functionality |
| F-t3-sqlite-6 (getDailySuccessRate CTE function-call overhead) | Only matters at 50K+ tasks; not the current scale; defer until dashboard latency becomes user-visible |
| F-t3-sqlite-2 (unbounded listTasks) | Medium confidence + M effort caller audit required; document limit expectation but don't change API until there is a measured latency problem |
| F-t4-test-1 (replace vi.mock with in-memory SQLite integration tests) | L effort; correct long-term direction but would require a dedicated test-infrastructure sprint |
| F-t4-agent-3 (AbortController for playground I/O) | Race condition requires 10+ agents + stalled filesystem; medium confidence, workaround is acceptable |
| F-t4-agent-7 (_processingTasks guard window) | Medium confidence race; requires specific timing; addressable after higher-priority lifecycle fixes ship |
| F-t1-clean-9 (failure registry testability) | Low confidence improvement; current pattern works fine |
| F-t1-clean-10 (terminal handler callback) | Low severity; good enough as-is |
| F-t2-sandbox-9 (dev CSP localhost) | Dev-only, low threat model relevance |
| F-t2-oauth-5 (token expiry pre-check) | Low severity; the existing 45-min proactive refresh covers the common case |

---

## 6. Open Questions

**Q1 — Is F-t2-inject-1 truly "Critical" or just "High"?**  
The inject lens rates it Critical. However, `execFileAsync` with argument arrays does prevent shell metacharacter injection. The residual risk is git's own range/flag parsing of positional arguments. In practice, the Source Control view calls `git:checkout` only with branches that already exist in the repo (fetched via `git:branches`), so the renderer input is semi-trusted. The fix (one line) is worth doing regardless, but the blast radius is smaller than the label suggests.

**Q2 — F-t2-sandbox-1 vs. playground usability**  
The sandbox lens recommends a strict ALLOWED_TAGS whitelist that excludes `<canvas>`, `<video>`, `<audio>`, and `<svg>`. The agent system documentation explicitly advertises "interactive playgrounds" including CSS theme builders and animations. Blocking these tags would break legitimate use cases. The right answer is probably a tiered allowlist (interactive subset that still excludes `<iframe>`, `<embed>`, `<object>`) rather than the minimal structure-only list proposed. Owner should decide the scope before implementing.

**Q3 — F-t1-ipc-5 (TOCTOU symlink race): false positive?**  
The IPC lens rates this High. The attack window is <100μs and requires the renderer to be executing concurrent file operations with a symlink swap. In Electron's single-renderer-process model this is extremely difficult to exploit from an untrusted party. A previous audit (2026-04-13) did not flag this. Recommend verifying with a proof-of-concept test before treating as High; may be Low in practice.

**Q4 — F-t3-sqlite-3 (user_version pragma interpolation): actionable or theoretical?**  
`migration.version` is always a hardcoded integer from a TypeScript module, never user-supplied. The finding is technically correct (defense-in-depth violation) but there is zero practical attack path today. The fix is one line and harmless, so it should be applied, but it should not be treated as meaningful security debt — it's a code style issue.

**Q5 — F-t4-test-2 vs. existing sprint-queries.test.ts**  
The test lens reports 14 data modules without tests, but the existing `sprint-queries.test.ts` may already cover some of these via the barrel re-export. Verify the actual coverage report before prioritizing test authoring work — the lens analyzed file presence, not executed line coverage.

**Q6 — Lenses disagreed on severity of F-t1-arch-1 (scattered orchestration)**  
The architecture lens rates this High. The clean code lens identifies related symptoms (resolveAgentExit doing 4 things, ConsumeMessagesResult overloaded) as separate Medium findings. The agent lens finds runtime consequences of the same scattering (event flush ordering, cascade transaction gaps). These are the same root problem viewed at three levels of abstraction. The real fix is the reliability issues (agent lens), not the structural refactor (arch lens), which is why F-t4-agent-5 and F-t4-agent-8 rank higher in the Top 10 than F-t1-arch-1.
