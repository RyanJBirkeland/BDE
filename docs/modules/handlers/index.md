# Handlers

IPC handler modules. Thin wrappers — receive IPC calls, delegate to services, return results.
Source: `src/main/handlers/`

| Module | Purpose | Key Exports |
|--------|---------|-------------|
| `git-handlers.ts` | Git and GitHub IPC handlers — source control, PR polling, GitHub API proxy. Includes `git:checkInstalled` which runs `git --version` to verify the CLI is present (returns `true`/`false`). | `registerGitHandlers`, `GitHandlersDeps` |
| `window-handlers.ts` | Window and playground IPC handlers — external URL gating, window title, open-in-browser for playground HTML, re-sanitize user-edited HTML (`playground:sanitize`) | `registerWindowHandlers` |
| `synthesizer-handlers.ts` | IPC handlers for AI spec generation and revision (`synthesizer:generate`, `synthesizer:revise`, `synthesizer:cancel`). Validates request payloads before delegating to `spec-synthesizer` service. | `registerSynthesizerHandlers` |
| `agent-handlers.ts` | Agent lifecycle IPC handlers — spawn adhoc agents, steer/kill agents, list/read agent history, promote to code review | `registerAgentHandlers`, `PromoteToReviewResult` |
| `review-assistant.ts` | Chat stream IPC handler for the interactive code review assistant | `registerReviewAssistantHandler`, `ChatStreamDeps`, `buildChatStreamDeps` |
| `sprint-local.ts` | Sprint task lifecycle IPC handlers — create, update, queue, log reads, dependency management. `sprint:update` validates status strings against `TASK_STATUSES` (unrecognized values rejected at the IPC boundary) and validates transitions via `isValidTransition` before delegating to the data layer. `sprint:create` enforces required spec sections server-side for `queued` tasks (synchronous, no model call) and rejects tasks whose `repo` is not present in the configured repositories (checked via `getRepoPaths()` before DB write, throws with a human-readable message pointing to Settings > Repositories). | `registerSprintLocalHandlers` |
| `sprint-spec.ts` | Sprint spec I/O and path validation — validates relative spec file paths for containment and existence. Error messages use repo-agnostic language. | `validateSpecPath`, `GeneratePromptRequest`, `GeneratePromptResponse` |
| `planner-import.ts` | Markdown plan import — parses H1/H2/H3 plan files into epics + tasks, validates repo against configured list | `registerPlannerImportHandlers`, `parsePlanMarkdown`, `importPlanFile` |
| `auth-handlers.ts` | Auth and onboarding prerequisite IPC handlers — `auth:status` check (Claude CLI + token), `onboarding:checkGhCli` (gh CLI availability, version, and authentication status via `gh auth status`) | `registerAuthHandlers`, `registerOnboardingHandlers` |
| `config-handlers.ts` | Settings CRUD and profiles IPC handlers. `settings:get` blocks sensitive keys (returns `null`). `settings:hasSecret` checks presence of sensitive keys without exposing plaintext. `settings:getEncryptionStatus` returns safeStorage encryption availability on the system. Path-validates `agentManager.worktreeBase`. | `registerConfigHandlers` |
