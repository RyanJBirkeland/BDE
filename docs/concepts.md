# FLEET Concepts

This document explains the four core concepts you need to understand to use FLEET effectively: **Tasks**, **Specs**, **Epics**, and **Dependencies**. It also covers how FLEET's six agent types differ and how to drive FLEET programmatically via MCP.

---

## Tasks

A task is the basic unit of work in FLEET. Each task represents one piece of work for one pipeline agent — from a bug fix to a small feature to a refactor. One task becomes one Claude Code session in one isolated git worktree.

### Task status lifecycle

```
backlog → queued → active → review → done
                ↑              ↓
              queued ← (revision requested)
                                ↓
                          merged / PR opened
```

| Status     | Meaning                                                                 |
|------------|-------------------------------------------------------------------------|
| `backlog`  | Created but not yet ready to run                                        |
| `blocked`  | Has unsatisfied hard dependencies — waiting on upstream tasks           |
| `queued`   | Ready; the Agent Manager drain loop will claim it within ~30s           |
| `active`   | An agent is currently working on it                                     |
| `review`   | Agent finished; worktree preserved; awaiting human action in Code Review |
| `done`     | Work merged (locally or via PR)                                         |
| `failed`   | Agent exhausted retries — see logs for diagnosis                        |
| `error`    | Fast-fail: 3 failures within 30s — likely a configuration problem       |
| `cancelled`| Discarded by human or PR closed without merging                         |

### One feature per task

Tasks are intentionally small. A pipeline agent given a multi-feature spec will attempt everything and frequently time out. The right question isn't "how much can I fit in one task?" but "what's the smallest useful slice of work a well-written spec can describe?"

---

## Writing a Task Spec

A spec is the set of written instructions a pipeline agent executes. **The agent reads your spec once and follows it literally. Spec quality is code quality.**

The agent is told to trust the spec over its own knowledge. If you prescribe a non-idiomatic pattern, the agent will use it. If your steps are ambiguous, the agent will guess. If a step presents two options, the agent will pick one — not necessarily the right one.

Spend time on your specs.

### Required sections

Every spec must contain these four `##` headings. The validator rejects specs that are missing any of them.

```markdown
## Context

## Files to Change

## Implementation Steps

## How to Test
```

Headings are matched case-insensitively but must otherwise match exactly (`## Context`, not `## Background`).

#### `## Context`

Why this change is needed. What problem it solves. What the agent must understand about the codebase before starting. Include:

- The business reason for the change
- Any relevant constraints or invariants the agent must respect
- Pointers to related code the agent should be aware of (but not explore — give file paths if there's something specific)

#### `## Files to Change`

An explicit list of every file that will be modified, with a brief note on what each file gets. Each entry must include a path token containing `/` or a file extension.

**✅ Good entries:**
```
- `src/main/services/auth-service.ts` — add `refreshToken()` method
- `internal/task/repository.go` — extend `list()` with date-range clauses
- `src/renderer/src/components/settings/ConnectionsSection.tsx` — add token expiry display
```

**❌ Bad entries:**
```
- auth service — update the refresh method
- repository — update list query
- settings component — show expiry
```

The bad entries lack path tokens. The agent can't find them without searching, which wastes turn budget.

#### `## Implementation Steps`

Numbered, prescriptive steps. Each step is a concrete directive — not a question, not an option. The agent executes them in order.

**The prescriptiveness rule** is strictly enforced: steps must not present alternatives. If a step says "X or Y" or "either...or" or "decide between", it fails validation. Pick one approach and specify it.

**Banned phrases** (cause validation failure): `decide`, `choose`, `consider`, `if you prefer`, `depending on your preference`, `you could also`.

**✅ Good steps:**
```
1. Add `DueBefore *time.Time` and `DueAfter *time.Time` to the `TaskFilter` struct in `filter.go`.
2. In `repository.go`, append `AND due_at <= ?` and `AND due_at >= ?` clauses when the fields are non-nil.
3. Return HTTP 400 with message `"due_before must be ISO-8601"` if parsing fails.
```

**❌ Bad steps:**
```
1. Either add the fields to `TaskFilter` or create a new `DateFilter` struct.
2. You could add the SQL clauses to the existing query or create a separate query builder.
3. Decide whether to return 400 or 422 for invalid date formats.
```

#### `## How to Test`

Exact commands or actions to verify the work is complete. This is what the agent runs before transitioning to review.

```
Run `go test ./internal/task/... -run TestListTasks` — all cases must pass.
Then start the server with `go run ./cmd/server` and confirm `GET /tasks?due_before=2026-06-01T00:00:00Z` returns only tasks due before June.
```

### Scope guidelines

- **200–500 words** is the sweet spot. Under 200 is usually too vague. Over 500 usually means the task does too much.
- **One feature per task.** If the spec says "and also..." anywhere, split it into two tasks.
- **Exact file paths.** Agents waste 15–20% of their turn budget on file exploration when paths are missing.
- **No exploration language.** "Investigate", "find issues", "explore the options" cause agents to thrash. Give explicit instructions.

### The idiom-first principle

Before prescribing a code shape, check what the codebase already does. If the codebase uses `.as(String.class)` for type casting across nine Specifications, do not spec `criteriaBuilder.function("CAST", String.class, ...)` from memory — even if that's technically valid.

The agent is told to trust the spec over its own knowledge. If you prescribe a non-idiomatic pattern, the agent will use it, and the reviewer will flag it. Spend the time upfront to find the codebase's idiom.

### Worked example

This is a complete, validator-passing spec for an imaginary `task-tracker-api` project. Use it as a template for structure and level of detail.

---

```markdown
## Context

The task list endpoint (`GET /tasks`) does not support filtering by due date. Users need to
narrow results to tasks due within a date range for dashboard widgets and report exports.
The existing `TaskFilter` struct and `TaskRepository.list()` method accept optional filter
fields — add `due_before` and `due_after` to both.

## Files to Change

- `internal/task/filter.go` — Add `DueBefore` and `DueAfter` fields to `TaskFilter`
- `internal/task/repository.go` — Extend `list()` SQL query with optional date-range clauses
- `internal/task/handler.go` — Parse `due_before` and `due_after` query params, validate
  ISO-8601 format, pass to filter
- `internal/task/handler_test.go` — Add table-driven test cases for valid ranges,
  invalid format (expect 400), and empty result set

## Implementation Steps

1. Add `DueBefore *time.Time` and `DueAfter *time.Time` to the `TaskFilter` struct in `filter.go`.
2. In `repository.go`, append `AND due_at <= ?` and `AND due_at >= ?` clauses to the list
   query when the fields are non-nil. Use the existing parameterized query builder — do not
   concatenate strings.
3. In `handler.go`, extract `due_before` and `due_after` from `r.URL.Query()`. Parse each
   with `time.Parse(time.RFC3339, ...)`. Return HTTP 400 with message
   `"due_before must be ISO-8601"` if parsing fails.
4. Pass the parsed `*time.Time` values into `TaskFilter` and call `repo.List(ctx, filter)`.
5. In `handler_test.go`, add three test cases to the existing `TestListTasks` table: valid
   range returning two tasks, `due_before` with invalid format expecting status 400, and a
   range with no matching tasks expecting an empty array (not null).

## How to Test

Run `go test ./internal/task/... -run TestListTasks` — all cases must pass. Then start the
server with `go run ./cmd/server` and confirm `GET /tasks?due_before=2026-06-01T00:00:00Z`
returns only tasks due before June.
```

---

### Pre-flight validation

Before creating a task, run the spec through the validator. In the Task Workbench, use the readiness checks. Via MCP, call `tasks.validateSpec` before `tasks.create`. The validator catches missing sections, path-free file entries, non-numbered steps, and banned prescriptiveness phrases before the agent sees the spec.

---

## Epics

An Epic is a named group of related sprint tasks organised around a shared goal — for example "Payments Redesign", "Auth v2", or "Performance Pass".

Epics are **not** GitHub issues or Jira epics. They exist inside FLEET to:
- Group tasks for coordinated queuing (queue the entire phase at once)
- Track progress across many tasks with a single progress bar
- Express dependencies between phases of work

### Epic lifecycle

An Epic's status is derived from its tasks — you cannot set it manually.

| Status       | Meaning                                                    |
|--------------|------------------------------------------------------------|
| `draft`      | Tasks are still being planned or edited                    |
| `ready`      | All tasks are specced and ready to queue                   |
| `in-pipeline`| At least one task is active or queued                      |
| `completed`  | All tasks have reached a terminal status                   |

### Epic dependencies

One Epic can wait on another. Three dependency conditions are supported:

| Condition    | Meaning                                                                              |
|--------------|--------------------------------------------------------------------------------------|
| `on_success` | The downstream Epic stays `blocked` until every task in the upstream Epic is `done`. If any upstream task fails, the downstream remains blocked. |
| `always`     | The downstream Epic unblocks when the upstream Epic `completed`, regardless of task outcomes. |
| `manual`     | The downstream Epic waits until a human explicitly clicks "Mark Complete". Use this when human review is required between phases. |

Cycle detection runs at creation time. FLEET rejects dependency graphs with cycles.

### When to use Epics vs. standalone tasks

Use an Epic when you have three or more related tasks that form a logical unit of work and benefit from phased execution or dependency ordering. Single tasks that stand alone don't need an Epic.

A useful heuristic: if you would describe the work as "first X, then Y, then Z", use an Epic with tasks ordered accordingly.

---

## Task Dependencies

Tasks can declare dependencies on other tasks independently of Epics.

### Hard dependencies

A hard dependency blocks the downstream task until the upstream task reaches `done`. If the upstream task fails, the downstream task remains `blocked` indefinitely until a human intervenes (retrying the upstream, or manually removing the dependency).

Use hard dependencies when the downstream task genuinely cannot proceed without the upstream work being correct.

### Soft dependencies

A soft dependency unblocks the downstream task regardless of the upstream outcome — success, failure, or cancellation. The downstream task moves from `blocked` to `queued` when the upstream task reaches any terminal status.

Use soft dependencies when you want execution ordering (upstream should run first) but the downstream task can proceed even if the upstream didn't succeed.

### Automatic blocking and resolution

**At creation time:** When you create a task with `depends_on` pointing to a task that has not yet completed, FLEET immediately sets the new task to `blocked`. No manual action required.

**At terminal time:** When a task reaches a terminal status (`done`, `failed`, `cancelled`, or `error`), FLEET evaluates every task that depends on it and automatically transitions any task whose dependencies are now fully satisfied from `blocked` to `queued`. The Agent Manager drain loop picks it up within ~30 seconds.

This resolution only triggers through FLEET's IPC handlers. Direct SQLite writes bypass the terminal service and will not resolve dependents.

### Cycle detection

FLEET rejects any dependency that would create a cycle at creation time. There is no way to create a cycle through normal use.

---

## Agent Types

FLEET spawns six types of AI agents. Each is a Claude Code session, but with different configuration, framing, and tool access.

| Type          | Spawned by                   | Interactive       | Tool access | Worktree   |
|---------------|------------------------------|-------------------|-------------|------------|
| **Pipeline**  | Agent Manager (automatic)    | No                | Full        | Isolated   |
| **Adhoc**     | Agents view (manual)         | Yes — multi-turn  | Full        | Dedicated  |
| **Assistant** | Agents view (manual)         | Yes — multi-turn  | Full        | Dedicated  |
| **Copilot**   | Task Workbench               | Yes — chat        | None        | None       |
| **Synthesizer** | Task Workbench             | No — single turn  | None        | None       |
| **Reviewer**  | Code Review Station          | Configurable      | Read-only   | Review     |

### Pipeline agents

Pipeline agents are the core of FLEET. They are spawned automatically when a task enters the `queued` state, work in an isolated git worktree, execute the task spec, commit their work, and transition the task to `review`.

They are non-interactive — no back-and-forth. They run to completion (or failure) and stop. The spec is their only instruction; the review gate is their only output path.

Key facts:
- Each pipeline agent gets `~/.fleet/worktrees/<repo>/<task-id>/` as its worktree
- Default watchdog timeout: 1 hour (overridable per task via `max_runtime_ms`)
- Auto-retry up to 3 times on failure; 3 failures within 30s = fast-fail to `error`
- Worktree is preserved at `review` status for human inspection

### Adhoc and Assistant agents

Both are spawned manually from the Agents view and run multi-turn sessions with full tool access. The difference is framing: Adhoc is for concrete implementation work ("add this feature to the codebase"), Assistant is for exploration and advice ("what's the best approach for X?").

Both run in a dedicated worktree under `~/.fleet/worktrees-adhoc/`. Dev Playground is always enabled — any `.html` file they write renders inline in the app.

### Copilot

A text-only chat assistant in the Task Workbench, used for drafting and refining specs through conversation. Copilot cannot use tools, open URLs, or read files — it works only from what you tell it in the conversation. ~500 word responses.

Use Copilot to talk through a spec before writing it, or to iterate on the wording of specific sections.

### Synthesizer

A single-turn agent that generates a complete structured spec from a file tree and relevant code snippets you provide. It outputs markdown with the required `##` sections. Use it when you want a spec seeded from actual codebase context rather than written from scratch.

### Reviewer

Spawned from the Code Review Station against a completed agent's worktree. Produces either a structured JSON review or an interactive conversation, depending on how it's configured. Does not commit code.

---

## MCP Integration

FLEET exposes a local MCP server for external agents — Claude Code in another project, Cursor, Codex CLI — to create and manage tasks programmatically.

### Setup

Enable in Settings → Connections → Local MCP Server. The server runs at `http://127.0.0.1:18792/mcp`. Your bearer token is shown in Settings after enabling.

To configure Claude Code as an MCP client:

```json
{
  "mcpServers": {
    "fleet": {
      "url": "http://127.0.0.1:18792/mcp",
      "headers": { "Authorization": "Bearer <paste-from-settings>" }
    }
  }
}
```

### Recommended workflow

Before drafting a spec via MCP, call `meta.specGuidelines` — it returns the complete rule set as markdown. Then:

1. Call `meta.specGuidelines` — read the rules
2. Draft your spec
3. Call `tasks.validateSpec` — fix any issues
4. Call `tasks.create` — create the task

`tasks.validateSpec` is safe to call repeatedly; it has no side effects.

### Available tools

**meta** — `meta.repos`, `meta.taskStatuses`, `meta.dependencyConditions`, `meta.specGuidelines`

**tasks** — `tasks.list`, `tasks.get`, `tasks.create`, `tasks.update`, `tasks.cancel`, `tasks.history`, `tasks.validateSpec`

**epics** — `epics.list`, `epics.get`, `epics.create`, `epics.update`, `epics.delete`, `epics.addTask`, `epics.removeTask`, `epics.setDependencies`

### Revision pathway limitation

When you call `tasks.update { status: "queued" }` to re-queue a task in `review`, the agent reruns but does **not** receive the structured revision feedback that the in-app "Request Revision" button provides. If you need the agent to act on specific feedback, include it in the `spec` field in the same `tasks.update` call.
