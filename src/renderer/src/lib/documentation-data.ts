import { Layers, PenLine, GitMerge, Bot, Plug } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export interface DocBadge {
  label: string
  variant: 'pass' | 'fail'
}

export interface DocSection {
  heading: string
  body: string
  codeBlock?: { language: string; content: string; filename?: string }
  table?: { headers: string[]; rows: string[][] }
  badges?: DocBadge[]
}

export interface DocTopic {
  id: string
  label: string
  icon: LucideIcon
  description: string
  sections: DocSection[]
}

export const DOCUMENTATION_TOPICS: DocTopic[] = [
  {
    id: 'epics',
    label: 'Epics',
    icon: Layers,
    description:
      'An Epic is a named collection of related sprint tasks organised around a shared goal. Use Epics to coordinate multi-task work and express dependencies between phases.',
    sections: [
      {
        heading: 'What an Epic is',
        body:
          'An Epic in FLEET is a named group of sprint tasks that share a goal — for example "Payments Redesign", "Auth v2", or "Performance Pass". Epics are not GitHub issues or Jira epics. They exist inside FLEET to organise tasks for coordinated queuing, dependency management, and progress tracking.\n\nAn Epic has a title, an optional description, an icon, and an accent colour. Tasks belong to at most one Epic. You can reorder tasks within an Epic by dragging them.'
      },
      {
        heading: 'Epic lifecycle',
        body:
          'An Epic moves through four statuses as its tasks progress:\n\n- **draft** — being planned; tasks may still be created or edited\n- **ready** — tasks are fully specced; the Epic is ready to queue\n- **in-pipeline** — at least one task is active or queued\n- **completed** — all tasks have reached a terminal status\n\nStatus transitions happen automatically as the underlying tasks change. You cannot manually force an Epic\'s status; it reflects the state of its tasks.'
      },
      {
        heading: 'Epic dependencies',
        body:
          'One Epic can depend on another. FLEET supports three dependency conditions:\n\n- **on_success** — the downstream Epic stays blocked until every task in the upstream Epic reaches `done`. If any upstream task fails, the downstream Epic remains blocked.\n- **always** — the downstream Epic unblocks as soon as the upstream Epic reaches `completed`, regardless of whether tasks succeeded or failed.\n- **manual** — the downstream Epic waits until a human explicitly clicks "Mark Complete" on the upstream Epic. Use this when a human review step is required between phases.\n\nCycle detection runs at creation time. FLEET rejects dependency graphs with cycles.'
      },
      {
        heading: 'When to use Epics vs. standalone tasks',
        body:
          'Use an Epic when you have three or more related tasks that form a logical unit of work and benefit from phased execution or dependency ordering. Single tasks that stand alone do not need an Epic — adding one just creates overhead.\n\nA good heuristic: if you would describe the work as a project with phases ("first migrate the schema, then update the API layer, then update the UI"), use an Epic with dependencies between the phase tasks.'
      }
    ]
  },
  {
    id: 'writing-specs',
    label: 'Writing a Task Spec',
    icon: PenLine,
    description:
      'A task spec is the single source of truth for what a pipeline agent does. The agent reads it once and executes it literally — spec quality directly determines code quality.',
    sections: [
      {
        heading: 'Required sections',
        body:
          'Every spec must contain these four `##` headings, in any order. The validator rejects specs that are missing any of them.\n\n- `## Context` — why this change is needed; what problem it solves; what the agent must understand about the codebase before starting\n- `## Files to Change` — explicit list of every file that will be modified, with a brief note on what each file gets\n- `## Implementation Steps` — numbered, prescriptive steps the agent executes in order\n- `## How to Test` — exact commands or actions to verify the work is complete\n\nHeadings are matched case-insensitively, but the text must match exactly (e.g. `## Context`, not `## Background` or `## Overview`).'
      },
      {
        heading: 'Scope guidelines',
        body:
          '**200–500 words** is the target. Under 200 words is usually too vague for the agent to execute without guessing. Over 500 words often means the task is doing too much — split it.\n\n**One feature per task.** If the spec says "and also..." anywhere, that is a signal to split into two tasks. Agents given multi-feature specs attempt everything and frequently time out.\n\n**Include exact file paths.** Agents waste 15–20% of their turn budget on file exploration when paths are missing. Name the file, not the concept.'
      },
      {
        heading: 'Files to Change format',
        body:
          'Each entry in `## Files to Change` must include a path token containing `/` or a file extension. This is validated automatically.',
        badges: [
          {
            label: '`src/main/services/auth-service.ts` — add `refreshToken()` method',
            variant: 'pass'
          },
          { label: '`auth service` — update the refresh method', variant: 'fail' },
          {
            label: '`internal/task/repository.go` — extend `list()` with date-range clauses',
            variant: 'pass'
          },
          { label: '`repository` — update list query', variant: 'fail' }
        ]
      },
      {
        heading: 'Implementation Steps format',
        body:
          'Steps must be a numbered list. Each step is a concrete directive — not a question, not an option. Steps must not present alternatives. The validator checks for this.',
        badges: [
          {
            label:
              'Add `DueBefore *time.Time` to the `TaskFilter` struct in `internal/task/filter.go`.',
            variant: 'pass'
          },
          {
            label:
              'Either add the field to `TaskFilter` or create a separate `DateFilter` struct.',
            variant: 'fail'
          },
          {
            label:
              'Extend `SpecValidator.validate()` in `src/shared/spec-validation.ts` to check the prescriptiveness rule.',
            variant: 'pass'
          },
          {
            label:
              'Decide whether to extend the existing validator or add a new one for this rule.',
            variant: 'fail'
          }
        ]
      },
      {
        heading: 'The prescriptiveness rule',
        body:
          'Steps must not present alternatives, even without the banned words. The validator pattern-matches on "alternatives presented" semantically, not just a word list.\n\n**Banned phrases** (cause immediate validation failure): `decide`, `choose`, `consider`, `if you prefer`, `depending on your preference`, `you could also`, `either...or`.\n\n**The broader rule**: if a step gives the agent two or more paths to the same goal, it fails. Pick one and specify it. The agent will follow the spec literally — give it one literal path.'
      },
      {
        heading: 'The idiom-first principle',
        body:
          'Before prescribing a code shape, grep the codebase for the existing pattern. If the codebase uses `.as(String.class)` for type casting in nine Specifications, do not spec `criteriaBuilder.function("CAST", String.class, ...)` from memory.\n\nThe pipeline agent is told to trust the spec over its own knowledge. If the spec prescribes a non-idiomatic pattern, the agent will use it — and the reviewer will flag it. Spend the time upfront to find the codebase\'s idiom.'
      },
      {
        heading: 'Worked example',
        body:
          'This is a complete, validator-passing spec for an imaginary `task-tracker-api` project. Use it as a template.',
        codeBlock: {
          language: 'markdown',
          filename: 'task-tracker-api — example spec',
          content: `## Context

The task list endpoint (\`GET /tasks\`) does not support filtering by due date. Users need to narrow results to tasks due within a date range for dashboard widgets and report exports. The existing \`TaskFilter\` struct and \`TaskRepository.list()\` method accept optional filter fields — add \`due_before\` and \`due_after\` to both.

## Files to Change

- \`internal/task/filter.go\` — Add \`DueBefore\` and \`DueAfter\` fields to \`TaskFilter\`
- \`internal/task/repository.go\` — Extend \`list()\` SQL query with optional date-range clauses
- \`internal/task/handler.go\` — Parse \`due_before\` and \`due_after\` query params, validate ISO-8601 format, pass to filter
- \`internal/task/handler_test.go\` — Add table-driven test cases for valid ranges, invalid format (expect 400), and empty result set

## Implementation Steps

1. Add \`DueBefore *time.Time\` and \`DueAfter *time.Time\` to the \`TaskFilter\` struct in \`filter.go\`.
2. In \`repository.go\`, append \`AND due_at <= ?\` and \`AND due_at >= ?\` clauses to the list query when the fields are non-nil. Use the existing parameterized query builder — do not concatenate strings.
3. In \`handler.go\`, extract \`due_before\` and \`due_after\` from \`r.URL.Query()\`. Parse each with \`time.Parse(time.RFC3339, ...)\`. Return HTTP 400 with message \`"due_before must be ISO-8601"\` if parsing fails.
4. Pass the parsed \`*time.Time\` values into \`TaskFilter\` and call \`repo.List(ctx, filter)\`.
5. In \`handler_test.go\`, add three test cases to the existing \`TestListTasks\` table: valid range returning two tasks, \`due_before\` with invalid format expecting status 400, and a range with no matching tasks expecting an empty array (not null).

## How to Test

Run \`go test ./internal/task/... -run TestListTasks\` — all cases must pass. Then start the server with \`go run ./cmd/server\` and confirm \`GET /tasks?due_before=2026-06-01T00:00:00Z\` returns only tasks due before June.`
        }
      }
    ]
  },
  {
    id: 'dependencies',
    label: 'Task Dependencies',
    icon: GitMerge,
    description:
      'Tasks can declare dependencies on other tasks. FLEET enforces ordering, auto-blocks downstream tasks, and automatically resolves them when upstream work completes.',
    sections: [
      {
        heading: 'Hard vs. soft dependencies',
        body:
          '**Hard dependency**: the downstream task stays `blocked` until the upstream task reaches `done`. If the upstream task fails, the downstream task remains blocked indefinitely until a human intervenes.\n\n**Soft dependency**: the downstream task unblocks regardless of the upstream outcome — success, failure, or cancellation. Use soft dependencies when you want execution ordering but do not require the upstream work to succeed before proceeding.'
      },
      {
        heading: 'Auto-blocking at creation time',
        body:
          'When you create a task with `depends_on` pointing to a task that has not yet completed, FLEET immediately sets the new task to `blocked` status. You do not need to set the status manually. The drain loop will not pick up `blocked` tasks — they wait until their dependencies are satisfied.'
      },
      {
        heading: 'Automatic resolution',
        body:
          'When a task reaches a terminal status (`done`, `failed`, `cancelled`, or `error`), FLEET evaluates every task that depends on it. Any downstream task whose dependencies are now fully satisfied is automatically transitioned from `blocked` to `queued`. The agent manager drain loop then picks it up within 30 seconds.\n\nThis resolution only triggers through the FLEET IPC handlers and terminal service. Direct SQLite writes (`UPDATE sprint_tasks SET status=\'done\'`) bypass the terminal service and will not resolve dependents.'
      },
      {
        heading: 'Cycle detection',
        body:
          'FLEET maintains an in-memory dependency index and rejects any dependency that would create a cycle. The rejection happens at creation time — you will see an error before the task is saved. There is no way to create a cycle through normal use.'
      }
    ]
  },
  {
    id: 'agent-types',
    label: 'Agent Types',
    icon: Bot,
    description:
      'FLEET spawns six types of AI agents, each with a different role, capability set, and spawn trigger. Choose the right type for the work at hand.',
    sections: [
      {
        heading: 'Quick reference',
        body:
          'Each agent type is optimised for a specific context. The table below covers the key distinguishing properties.',
        table: {
          headers: ['Type', 'Spawned by', 'Interactive', 'Tools', 'Best for'],
          rows: [
            [
              'Pipeline',
              'Agent Manager (automatic)',
              'No',
              'Full',
              'Executing sprint tasks autonomously'
            ],
            [
              'Adhoc',
              'Agents view (manual)',
              'Yes — multi-turn',
              'Full',
              'One-off coding tasks outside the pipeline'
            ],
            [
              'Assistant',
              'Agents view (manual)',
              'Yes — multi-turn',
              'Full',
              'Questions, exploration, code advice'
            ],
            [
              'Copilot',
              'Task Workbench',
              'Yes — chat',
              'None (text only)',
              'Drafting and refining task specs'
            ],
            [
              'Synthesizer',
              'Task Workbench',
              'No — single turn',
              'None (text only)',
              'Generating structured specs from codebase context'
            ],
            [
              'Reviewer',
              'Code Review Station',
              'Configurable',
              'Read-only',
              'Reviewing completed agent work'
            ]
          ]
        }
      },
      {
        heading: 'Pipeline agents',
        body:
          'Pipeline agents are spawned automatically by the Agent Manager when a task transitions to `queued`. They run in an isolated git worktree, execute the task spec, commit their work, and transition the task to `review` when done. They do not interact with users during execution.\n\nEach pipeline agent has a 1-hour watchdog timeout by default. Tasks can override this via the `max_runtime_ms` field. Three failures within 30 seconds of starting mark the task `error` (fast-fail detection).'
      },
      {
        heading: 'Adhoc and Assistant agents',
        body:
          'Adhoc and Assistant agents are spawned manually from the Agents view. Both run multi-turn sessions and have full tool access. The difference is framing: Adhoc is for concrete implementation tasks; Assistant is for exploration, questions, and advice.\n\nBoth run in a dedicated worktree under `~/.fleet/worktrees-adhoc/` so their changes stay isolated from the main repo tree. Dev Playground is always enabled for these agents — any `.html` file they write renders inline in the app.'
      },
      {
        heading: 'Copilot and Synthesizer',
        body:
          'Copilot is a text-only chat assistant in the Task Workbench. It helps you draft and refine specs through conversation but cannot use tools, open URLs, or read files. It is limited to approximately 500 words per response.\n\nSynthesizer is a single-turn agent that generates a complete structured spec from a file tree and relevant code snippets you provide. It outputs markdown with the required `##` sections. Use it when you want a spec seeded from actual codebase context.'
      }
    ]
  },
  {
    id: 'mcp-integration',
    label: 'MCP Integration',
    icon: Plug,
    description:
      'FLEET exposes a local MCP server for external agents — Claude Code in another project, Cursor, Codex CLI — to create and manage tasks programmatically.',
    sections: [
      {
        heading: 'Getting started',
        body:
          'Enable the MCP server in Settings → Connections → Local MCP Server. The server runs at `http://127.0.0.1:18792/mcp` by default. Your bearer token is shown in Settings after enabling.\n\nTo configure Claude Code as an MCP client, add this to your project\'s MCP config:\n\n```json\n{\n  "mcpServers": {\n    "fleet": {\n      "url": "http://127.0.0.1:18792/mcp",\n      "headers": { "Authorization": "Bearer <paste-from-settings>" }\n    }\n  }\n}\n```'
      },
      {
        heading: 'Always call meta.specGuidelines first',
        body:
          'Before drafting a spec to pass to `tasks.create`, call `meta.specGuidelines`. It returns the complete spec-writing rule set as markdown — required sections, structural rules, the prescriptiveness rule, the idiom-first principle, and a worked example. Including this in your planning context before writing the spec significantly reduces validation failures.'
      },
      {
        heading: 'Validation workflow',
        body:
          'The recommended sequence for creating a task via MCP:\n\n1. Call `meta.specGuidelines` — read the rules\n2. Draft the spec following the guidelines\n3. Call `tasks.validateSpec` with your draft — fix any issues the validator reports\n4. Call `tasks.create` with the validated spec\n\n`tasks.validateSpec` runs the full validator chain (structural checks, prescriptiveness, file paths, numbered steps) and returns issues with codes and messages. It is safe to call repeatedly without side effects.'
      },
      {
        heading: 'Revision pathway limitation',
        body:
          'When a task is in `review` status and you call `tasks.update` with `status: "queued"`, the task re-queues for another agent run. However, this MCP path does **not** populate the structured `<revision_feedback>` block that the in-app "Request Revision" button populates.\n\nThe in-app revision provides the agent with a structured block containing the reviewer\'s specific feedback, framed as "a human reviewed your previous work and found the following issues." The MCP re-queue path skips this framing entirely.\n\nIf you need the agent to act on specific revision feedback, include that feedback in the spec text before re-queuing — update `spec` and `status` in the same `tasks.update` call.'
      },
      {
        heading: 'Available tools',
        body:
          'The MCP server exposes tools across three namespaces:\n\n**meta** — read-only introspection: `meta.repos`, `meta.taskStatuses`, `meta.dependencyConditions`, `meta.specGuidelines`\n\n**tasks** — full task CRUD: `tasks.list`, `tasks.get`, `tasks.create`, `tasks.update`, `tasks.cancel`, `tasks.history`, `tasks.validateSpec`\n\n**epics** — Epic CRUD and membership: `epics.list`, `epics.get`, `epics.create`, `epics.update`, `epics.delete`, `epics.addTask`, `epics.removeTask`, `epics.setDependencies`\n\nAll mutations route through the same services the UI uses — validation, dependency auto-blocking, status-transition checks, audit trail, and renderer broadcast are all preserved.'
      }
    ]
  }
]

export function renderToMarkdown(topics: DocTopic[]): string {
  return topics.map(topicToMarkdown).join('\n\n---\n\n')
}

function topicToMarkdown(topic: DocTopic): string {
  const lines: string[] = [`# ${topic.label}`, '', topic.description, '']

  for (const section of topic.sections) {
    lines.push(`## ${section.heading}`, '', section.body, '')

    if (section.codeBlock) {
      const lang = section.codeBlock.language
      const filename = section.codeBlock.filename ? ` — ${section.codeBlock.filename}` : ''
      lines.push(`\`\`\`${lang}${filename}`, section.codeBlock.content, '```', '')
    }

    if (section.table) {
      const { headers, rows } = section.table
      lines.push(`| ${headers.join(' | ')} |`)
      lines.push(`| ${headers.map(() => '---').join(' | ')} |`)
      for (const row of rows) {
        lines.push(`| ${row.join(' | ')} |`)
      }
      lines.push('')
    }

    if (section.badges) {
      for (const badge of section.badges) {
        const prefix = badge.variant === 'pass' ? '✅ PASS' : '❌ FAIL'
        lines.push(`${prefix}: ${badge.label}`)
      }
      lines.push('')
    }
  }

  return lines.join('\n')
}
