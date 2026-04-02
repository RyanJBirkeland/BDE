# BDE Full-App Audit — Agent Team Prompt

> Copy-paste this into a new Claude Code session from `~/projects/BDE`

---

```
Create an agent team to perform a comprehensive audit of the BDE Electron app codebase.

## Team Structure

Spawn 15 teammates organized into 5 domain groups, each with 3 personas. Each persona brings a different lens. Teammates within a group MUST read and challenge each other's findings — agree, disagree, or build on what others find. Cross-group communication is encouraged when issues span domains.

Use Sonnet for all teammates to manage token costs.

### Personas

- **AX (Architectural Engineer)**: Evaluates system design, module boundaries, coupling/cohesion, data flow direction, abstraction leaks, process boundary violations (main/renderer/preload), IPC surface bloat, scalability concerns. Thinks in terms of dependency graphs and separation of concerns.
- **Senior Dev (SD)**: Evaluates code quality, security vulnerabilities, race conditions, error handling, type safety, dead code, memory leaks, test coverage gaps, anti-patterns, performance issues. Reads every line critically.
- **Product Manager (PM)**: Evaluates UX completeness, user journeys, empty/loading/error states, missing feedback, confusing flows, broken workflows, feature gaps, onboarding friction. Thinks from the user's perspective.

### Group 1 — Sprint & Tasks (Task Pipeline + Task Workbench)

**Scope**:
- Views: `src/renderer/src/views/SprintView.tsx`, `src/renderer/src/views/TaskWorkbenchView.tsx`
- Components: `src/renderer/src/components/sprint/` (33 files), `src/renderer/src/components/task-workbench/` (6 files)
- Stores: `src/renderer/src/stores/sprintTasks.ts`
- CSS: `sprint-pipeline-neon.css`, `task-workbench-neon.css`, `sprint-neon.css`

**Key questions**:
- AX: Is the sprint/task-workbench boundary clean? Are there circular deps between pipeline monitoring and task creation?
- SD: Are optimistic updates race-safe? Is the pendingUpdates TTL mechanism correct? Any XSS in task rendering?
- PM: Is the task creation → pipeline monitoring flow intuitive? What happens when tasks error? Can users recover?

### Group 2 — Code & Review (PR Station + Source Control)

**Scope**:
- Views: `src/renderer/src/views/PRStationView.tsx`, `src/renderer/src/views/GitTreeView.tsx`
- Components: `src/renderer/src/components/pr-station/` (11 files), `src/renderer/src/components/diff/` (4 files), `src/renderer/src/components/git-tree/` (5 files)
- Stores: `src/renderer/src/stores/gitTree.ts`, `src/renderer/src/stores/pendingReview.ts`
- Lib: `src/renderer/src/lib/github-api.ts`, `src/renderer/src/lib/github-cache.ts`
- CSS: `pr-station-neon.css`, `diff-neon.css`

**Key questions**:
- AX: Does the GitHub API proxy layer (renderer → IPC → main → GitHub) have clean boundaries? Is the cache layer well-placed?
- SD: Any token/credential leaks through IPC? Race conditions in pendingReview persistence? Memory issues with large diffs?
- PM: Is the PR review workflow complete? Can you review, comment, merge without leaving BDE? What's missing?

### Group 3 — Workspace (IDE + Agents + Terminal)

**Scope**:
- Views: `src/renderer/src/views/IDEView.tsx`, `src/renderer/src/views/AgentsView.tsx`
- Components: `src/renderer/src/components/ide/` (10 files), `src/renderer/src/components/agents/` (24 files), `src/renderer/src/components/terminal/` (10 files)
- Stores: `src/renderer/src/stores/ide.ts`, `src/renderer/src/stores/agentEvents.ts`, `src/renderer/src/stores/agents.ts`
- Handlers: `src/main/handlers/ide-fs-handlers.ts`
- CSS: `ide-neon.css`, `agents-neon.css`

**Key questions**:
- AX: Is the IDE file I/O properly sandboxed? How clean is the agent event pipeline (raw SDK → mapper → store → UI)?
- SD: Path traversal in ide-fs-handlers? Memory leaks from Monaco or xterm? Dead code in agents/ (AgentTimeline, TimelineBar)?
- PM: Is the agent console useful for monitoring long-running tasks? Can users intervene/steer? IDE empty state?

### Group 4 — Shell & Design System (Dashboard + Settings + Layout + Neon Primitives + UI)

**Scope**:
- Views: `src/renderer/src/views/DashboardView.tsx`, `src/renderer/src/views/SettingsView.tsx`
- Components: `src/renderer/src/components/layout/` (7 files), `src/renderer/src/components/neon/` (16 files), `src/renderer/src/components/ui/` (15 files), `src/renderer/src/components/panels/` (4 files), `src/renderer/src/components/dashboard/` (5 files), `src/renderer/src/components/settings/`
- Design: `src/renderer/src/design-system/tokens.ts`
- CSS: `base.css`, `neon.css`, `neon-shell.css`
- App shell: `src/renderer/src/App.tsx`

**Key questions**:
- AX: Is there a coherent design system or are neon/ and ui/ two competing systems? Is the panel layout architecture sound?
- SD: Any keyboard shortcut conflicts? ErrorBoundary coverage complete? Zustand selector anti-patterns?
- PM: Does the dashboard provide actionable info? Is settings discoverable? Navigation intuitive for new users?

### Group 5 — Main Process (Agent Manager + Queue API + Data Layer)

**Scope**:
- Agent Manager: `src/main/agent-manager/` (13 files)
- Queue API: `src/main/queue-api/` (9 files)
- Data: `src/main/data/` (8 files)
- Services: `src/main/services/` (4 files)
- Core: `src/main/db.ts`, `src/main/index.ts`, `src/main/env-utils.ts`, `src/main/logger.ts`, `src/main/auth-guard.ts`
- IPC: `src/main/handlers/` (all handler files), `src/shared/ipc-channels.ts`, `src/preload/index.ts`
- Types: `src/shared/types.ts`

**Key questions**:
- AX: Is the repository pattern consistently applied? Are process boundaries (main/preload/renderer) respected? IPC surface — is it minimal or bloated?
- SD: SQL injection in sprint-queries? Auth bypass in Queue API? Race conditions in drain loop claiming? Proper error propagation through IPC? WAL mode edge cases?
- PM: (Less relevant for main process, but) Are error messages surfaced to users meaningful? Is the Queue API contract clear for external consumers?

## Output Format

Each teammate writes their findings to `docs/superpowers/audits/` as:
- `{group}-{persona}.md` (e.g., `sprint-tasks-ax.md`, `code-review-sd.md`, `main-process-pm.md`)

Each report should have:
1. **Executive Summary** (3-5 sentences)
2. **Critical Issues** (must fix — security, data loss, crashes)
3. **Significant Issues** (should fix — architecture, UX, performance)
4. **Minor Issues** (nice to fix — code quality, consistency)
5. **Responses to Teammates** — explicitly agree/disagree/build on findings from the other 2 personas in your group

After all 15 teammates complete, synthesize into `docs/superpowers/audits/synthesis-final-report.md` with:
- Prioritized issue list across all groups
- Cross-cutting themes
- Recommended action items (grouped by effort: quick wins, medium, large)

## Rules

- READ the code thoroughly — don't skim. Open and read every file in your scope.
- Be SPECIFIC — cite file paths, line numbers, and code snippets.
- CHALLENGE your teammates — if the AX flags coupling but the code is actually well-bounded, say so.
- Don't duplicate findings — if a teammate already found it, reference their finding and add your perspective.
- Focus on what MATTERS — skip trivial style issues. Prioritize security > architecture > UX > code quality.
```
