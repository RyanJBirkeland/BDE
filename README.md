<div align="center">

# FLEET

**A steering system for Claude Code at scale.**

Claude Code is a powerful coding agent. FLEET is the desktop app that turns it into a managed engineering pipeline — orchestrating multiple Claude Code sessions in parallel, each working in isolated git worktrees, with human review gates before anything touches your codebase.

You write specs. FLEET queues them, spawns Claude Code sessions, monitors progress, and presents finished work for review. You stay in control. Claude Code does the building.

[Getting Started](#getting-started) | [How It Works](#how-it-works) | [Core Concepts](#core-concepts) | [Features](#features) | [Architecture](#architecture) | [Contributing](#contributing)

<br/>

![FLEET Dashboard — pipeline health, status counters, cost tracking, and live activity feed](docs/screenshots/dashboard.png)

_Dashboard: 6 active Claude Code sessions, 21 queued, 225 completed — all visible at a glance._

</div>

---

## Why FLEET?

Claude Code is already great at writing code. What it doesn't have out of the box is:

- **A task queue** — feed it 20 specs and walk away
- **Parallel execution** — multiple Claude Code sessions running simultaneously on different tasks
- **Git worktree isolation** — each session works on its own branch in its own directory, your working tree stays clean
- **A review gate** — nothing merges without human approval
- **Dependency management** — "task B waits for task A" with automatic blocking and unblocking
- **Observability** — real-time pipeline view, cost tracking, event streams across all sessions
- **Retry and failure handling** — automatic retries, fast-fail detection, watchdog timers

FLEET adds all of this. It doesn't replace Claude Code — it wraps it in the infrastructure needed to run it as a development pipeline.

### The Cognitive Load Problem

Running AI agents manually is surprisingly exhausting. You're context-switching between terminal tabs, remembering which branch is which, mentally tracking what depends on what, catching failures by accident, and trying to review diffs while three other sessions are still running. The agents are doing the coding — but _you're_ doing all the project management in your head.

That's the kind of invisible overhead that leads to burnout. Not from the work itself, but from juggling the meta-work around it.

FLEET externalizes all of that. The Dashboard shows you pipeline health at a glance — how many sessions are active, what's blocked, what just finished, what failed. The Sprint Pipeline gives you a single visual flow of every task through every stage. Cost charts show spend trends so you're not surprised. Activity feeds surface errors the moment they happen, not when you remember to check.

The goal is simple: **you should be able to look at one screen and know exactly what's happening across all your concurrent work** — then make decisions (review, retry, reprioritize) without holding any of it in your head.

|                      | Using Claude Code directly               | Using Claude Code via FLEET                                        |
| -------------------- | ---------------------------------------- | ---------------------------------------------------------------- |
| **Sessions**         | One at a time, manually started          | Fleet running in parallel, auto-claimed from queue               |
| **Isolation**        | Works in your current checkout           | Each session gets its own git worktree                           |
| **Lifecycle**        | Open terminal → chat → hope it works     | Spec → queue → execute → review → merge                          |
| **After completion** | You manually check the diff, commit, PR  | Code Review Station: inspect diffs, merge/PR/revise in one click |
| **Coordination**     | You remember which tasks depend on which | Declarative hard/soft dependencies with auto-resolution          |
| **When it fails**    | You notice, restart manually             | Auto-retry (up to 3x), fast-fail detection, watchdog kill        |
| **Observability**    | Scroll through terminal output           | Dashboard, pipeline view, cost charts, event streams             |
| **Spend visibility** | No idea what your agents cost            | Cost dashboard with per-run, hourly, and daily analytics         |
| **Cognitive load**   | You track everything in your head        | One screen shows all concurrent work, decisions, and status      |

---

## How It Works

### The Task Lifecycle

Every piece of work flows through a structured pipeline. Tasks start as ideas and end as merged code — with human review gates at every critical point.

**The short version, in four steps:**

1. **Define tasks and dependencies** — Draft specs in Task Workbench, set hard/soft dependencies so agents tackle prerequisites first.
2. **FLEET spawns Claude Code in isolation** — Each task gets its own Claude Code session in its own git worktree. Sessions run in parallel without stepping on each other.
3. **Sessions land in the Review queue** — When a session finishes, its worktree is preserved and the task moves to `review`. No auto-push, no surprise PRs.
4. **You decide what ships** — Inspect diffs in Code Review Station, then merge locally, open a PR, request a revision, or discard.

```mermaid
flowchart TD
    A["Backlog
    Draft specs with AI copilot"] -->|Queue| B["Queued
    Ready for agent pickup"]
    B -->|Agent claims| C["Active
    Agent coding in isolated worktree"]
    C -->|Work complete| D["Review
    Human inspects diffs + commits"]

    D -->|"Merge locally"| E["Done"]
    D -->|"Create PR"| F["PR Open
    Awaiting CI + merge"]
    D -->|"Request revision"| B
    D -->|"Discard"| G["Cancelled"]

    F -->|PR merged| E
    F -->|PR closed| G

    C -->|Agent failure| H{"Retry?"}
    H -->|"< 3 attempts"| B
    H -->|"3 fast failures"| I["Error"]

    subgraph blocked ["Dependency System"]
        J["Blocked
        Waiting on upstream tasks"] -->|"Dependencies satisfied"| B
    end

    style A fill:#1a1a2e,stroke:#00ffcc,color:#00ffcc
    style B fill:#1a1a2e,stroke:#ff9f43,color:#ff9f43
    style C fill:#1a1a2e,stroke:#00d4ff,color:#00d4ff
    style D fill:#1a1a2e,stroke:#a855f7,color:#a855f7
    style E fill:#1a1a2e,stroke:#00ffcc,color:#00ffcc
    style F fill:#1a1a2e,stroke:#3b82f6,color:#3b82f6
    style G fill:#1a1a2e,stroke:#6b7280,color:#6b7280
    style H fill:#1a1a2e,stroke:#ff9f43,color:#ff9f43
    style I fill:#1a1a2e,stroke:#ef4444,color:#ef4444
    style J fill:#1a1a2e,stroke:#ef4444,color:#ef4444
```

### What Happens When a Task Runs

Each task becomes a Claude Code session. FLEET handles everything around it:

```mermaid
sequenceDiagram
    participant AM as FLEET Agent Manager
    participant WT as Git Worktree
    participant CC as Claude Code Session
    participant CR as Code Review

    AM->>AM: Drain loop detects queued task
    AM->>WT: Create isolated worktree<br/>~/.fleet/worktrees/<repo-slug>/<task-id>
    AM->>CC: Spawn Claude Code with task spec +<br/>CLAUDE.md project context

    loop Claude Code works autonomously
        CC->>WT: Read files, write code, run tests
        CC-->>AM: Stream events (tool use, output, errors)
    end

    CC->>WT: Final commit
    AM->>CR: Transition task → review
    Note over CR: Worktree preserved for<br/>human inspection

    alt Human merges
        CR->>AM: Fast-forward merge → done
    else Human creates PR
        CR->>AM: Push branch → open PR
    else Human requests revision
        CR->>AM: Return to queue → Claude Code retries
    end
```

> **FLEET doesn't have its own AI.** Every agent is a Claude Code session spawned via the [Claude Agent SDK](https://docs.anthropic.com/en/docs/agents-and-tools/claude-code/sdk). FLEET's job is steering: what runs, where it runs, when it retries, and what happens with the output.

---

## Core Concepts

Understanding four concepts is enough to be productive with FLEET.

### Task

A unit of work for a pipeline agent. Each task has a **spec** (the written instructions), a **status** (`backlog → queued → active → review → done`), and optional **dependencies** on other tasks. One task becomes one Claude Code session in one isolated git worktree.

### Spec

The instructions a pipeline agent executes. The pipeline agent reads your spec once and follows it literally — **spec quality is code quality**.

Every spec must have four `##` sections:

| Section | Purpose |
|---|---|
| `## Context` | Why the change is needed; what the agent must understand before starting |
| `## Files to Change` | Exact paths to every file that will be modified |
| `## Implementation Steps` | Numbered, prescriptive steps — no alternatives, one approach, specified |
| `## How to Test` | Exact commands to verify the work is complete |

A good spec is 200–500 words, covers one feature, and includes exact file paths. Steps must not present options ("X or Y" fails validation). → [Full spec writing guide](docs/concepts.md#writing-a-task-spec)

### Epic

A named group of related tasks organised around a shared goal. Epics exist to track progress across phases, express dependencies between task groups, and batch-queue an entire plan in one click. An Epic moves through `draft → ready → in-pipeline → completed` as its tasks progress. → [Epic reference](docs/concepts.md#epics)

### Dependency

A declared relationship between tasks. **Hard** dependencies block the downstream task until the upstream task reaches `done`. **Soft** dependencies unblock regardless of outcome. Both are set declaratively — FLEET handles blocking and resolution automatically, including cycle detection. → [Dependency reference](docs/concepts.md#task-dependencies)

---

## Features

### Task Workbench — Plan Before You Build

Draft task specs with an AI copilot, define dependencies between tasks, and run readiness checks before queuing. The copilot helps refine specs through conversation. A synthesizer can generate structured specs from codebase context.

### Sprint Pipeline — Watch Work Flow

Real-time monitoring of tasks flowing through stages. Seven visual buckets (backlog, todo, blocked, in-progress, awaiting review, done, failed) give you instant visibility into your entire pipeline.

### Agent Manager — Orchestrating Claude Code Sessions

The core of FLEET. Watches the task queue, spawns Claude Code sessions in isolated git worktrees, monitors their health, and handles the full lifecycle from start to review.

- **Parallel execution** — configurable WIP limit for concurrent Claude Code sessions
- **Worktree isolation** — each session gets its own branch in its own directory
- **Watchdog timers** — per-task runtime limits (default 1 hour)
- **Smart retry** — up to 3 attempts, with fast-fail detection (3 failures within 30s = stop trying)
- **Project context** — every session inherits your `CLAUDE.md` files, so agents know your conventions

![Agents view — multiple concurrent Claude Code sessions with live tool use streams](docs/screenshots/agents-view.png)
_Agents view: 5 active Claude Code sessions running in parallel. Each shows live tool calls, edits, and bash commands as they happen._

### Code Review Station — Human in the Loop

Agents don't push directly to main. Every completed task lands in a review queue where you inspect diffs, browse commits, read the agent's conversation log, then choose: merge locally, create a PR, request a revision, or discard.

### Task Dependencies — Declarative Coordination

Tasks can declare `hard` or `soft` dependencies on other tasks:

- **Hard** — downstream blocks until upstream succeeds
- **Soft** — downstream unblocks regardless of upstream outcome

Cycle detection at creation time. Automatic resolution when tasks complete. No manual coordination needed.

### Dev Playground — Visual Output in the IDE

When agents write HTML files, FLEET renders them inline — sandboxed with DOMPurify. Build CSS theme explorers, component playgrounds, data visualizations, and architecture diagrams without leaving the app.

### Integrated IDE

Monaco editor with file explorer, multi-tab interface, and integrated terminal. Syntax highlighting, dirty state tracking, keyboard shortcuts. Not a replacement for VS Code — a companion for quick edits and agent output inspection.

### Source Control

Git staging, committing, and pushing across multiple repos. Inline diff previews, branch selection, and error handling with retry.

### Local MCP Server (opt-in)

Expose FLEET's task and epic CRUD to external MCP-speaking agents (Claude Code, Claude Desktop, Cursor). Runs inside the Electron main process on `127.0.0.1:18792` with a bearer token at `~/.fleet/mcp-token`. Enable via Settings → Connections → Local MCP Server. All mutations route through the same services the UI uses — validation, auto-blocking, status transitions, audit trail, and broadcasts are preserved.

### Cost Tracking — Know What Your Agents Cost

Every Claude Code session's token usage and cost are logged to `cost_events`. The Dashboard surfaces per-run, hourly, and daily spend trends so you can spot expensive tasks, compare models, and catch runaway loops before the bill does. No external billing integration needed — the data comes straight from SDK usage events.

### Dashboard

Aggregated metrics at a glance: active/queued/blocked task counts, throughput over the last 24h, success-rate trend, system load, and a live activity feed. Dark and light themes supported.

<p align="center">
<img src="docs/screenshots/dashboard.png" width="90%" alt="Dashboard — overview of pipeline health, throughput, success rate, system load, and recent activity" />
</p>

### Task Planner

Group related tasks into epics with cross-epic dependencies, then send the whole batch to the pipeline with one click.

<p align="center">
<img src="docs/screenshots/task-planner.png" width="90%" alt="Task Planner — epics list on the left, epic detail with tasks and depends-on in the center" />
</p>

---

## Architecture

Local-first, open architecture, clean code. No black boxes — your tasks, diffs, costs, and events all live in a SQLite file on your machine.

```mermaid
graph TB
    subgraph Electron["Electron App"]
        subgraph Main["Main Process"]
            AM[Agent Manager]
            DB[(SQLite<br/>WAL mode)]
            IPC[IPC Handlers<br/>~138 typed channels]
            PRP[PR Poller]
            TTS[Task Terminal<br/>Service]
        end

        subgraph Renderer["Renderer Process (React)"]
            Views["8 Views<br/>Dashboard · Agents · IDE · Pipeline<br/>Code Review · Source Control<br/>Settings · Task Planner"]
            Stores[Zustand Stores]
            Panels[Panel System<br/>Split panes · Drag-and-drop<br/>Tear-off windows]
        end

        subgraph Preload["Preload Bridge"]
            Bridge[Type-safe window.api]
        end
    end

    subgraph External["Claude Code + External"]
        SDK["Claude Code
        (via Agent SDK)"]
        GH[GitHub API]
        WT[Git Worktrees<br/>~/.fleet/worktrees/]
    end

    Main <-->|IPC| Bridge
    Bridge <-->|contextBridge| Renderer
    AM -->|"Spawn sessions"| SDK
    AM -->|Create/cleanup| WT
    SDK -->|Code in| WT
    PRP -->|Poll PRs| GH
    AM -->|Read/write| DB
    IPC -->|Read/write| DB
    TTS -->|Resolve deps| AM

    style Electron fill:#0d1117,stroke:#30363d,color:#e6edf3
    style Main fill:#161b22,stroke:#00ffcc,color:#e6edf3
    style Renderer fill:#161b22,stroke:#00d4ff,color:#e6edf3
    style Preload fill:#161b22,stroke:#ff9f43,color:#e6edf3
    style External fill:#161b22,stroke:#a855f7,color:#e6edf3
```

### Tech Stack

| Layer     | Technology                                               |
| --------- | -------------------------------------------------------- |
| Framework | Electron + electron-vite                                 |
| Frontend  | React, TypeScript, Zustand                               |
| Editor    | Monaco (ESM, not CDN)                                    |
| Database  | SQLite (better-sqlite3, WAL mode)                        |
| AI Engine | Claude Code (spawned via @anthropic-ai/claude-agent-sdk) |
| Icons     | lucide-react                                             |
| Layout    | react-resizable-panels                                   |
| Testing   | Vitest (unit + integration), Playwright (E2E)            |
| CI        | GitHub Actions (typecheck + lint + coverage-gated tests) |

### Data Model

All state lives in a local SQLite database at `~/.fleet/fleet.db`. No cloud dependencies for core functionality.

| Table          | Purpose                                                       |
| -------------- | ------------------------------------------------------------- |
| `sprint_tasks` | Task specs, status, dependencies, PR links, agent assignments |
| `agent_runs`   | Agent execution audit trail — model, status, timing           |
| `agent_events` | Streaming agent events (tool use, output, errors)             |
| `cost_events`  | Token usage and cost tracking per agent run                   |
| `agent_run_turns` | Per-turn token breakdown (input, output, cache tokens)     |
| `task_changes`    | Field-level audit trail on every task mutation             |
| `settings`        | Key-value app configuration                                |

---

## Getting Started

### Prerequisites

- **Node.js** v22.12+ (native-module rebuild requires it; `^20.19.0 || >=22.12.0` in `package.json`)
- **Claude Code CLI** — installed and authenticated (`claude login`)
- **Git** and **GitHub CLI** (`gh`)
- macOS (Apple Silicon recommended; Intel supported)

### Install

```bash
git clone https://github.com/RyanJBirkeland/FLEET.git
cd FLEET
npm install
npm run dev
```

On first launch, FLEET checks for Claude Code authentication and guides you through setup.

### Build for Production

```bash
npm run build:mac    # → release/FLEET-*.dmg (unsigned)
```

### Install from DMG (macOS)

FLEET is currently distributed unsigned. macOS Gatekeeper will block the first launch until you explicitly allow it. See [INSTALL.md](./INSTALL.md) for screenshots and a troubleshooting walkthrough.

1. Double-click `FLEET-*.dmg` to mount it.
2. Drag `FLEET.app` onto `Applications` in the mounted window.
3. Open the `Applications` folder in Finder.
4. **Right-click** (or Control-click) `FLEET.app` and choose **Open**. *Do not double-click.*
5. Gatekeeper will warn "FLEET cannot be verified" — click **Open** in the dialog. The choice is remembered; subsequent launches open normally.

**Power-user shortcut** — clear the quarantine attribute in one command, then double-click to launch:

```bash
xattr -dr com.apple.quarantine /Applications/FLEET.app
```

### Run Tests

```bash
npm test             # Unit tests (vitest)
npm run test:main    # Main process integration tests
npm run test:e2e     # E2E tests (requires built app)
npm run typecheck    # TypeScript checking
npm run lint         # ESLint
```

---

## Views at a Glance

| View           | Shortcut | What it does                                                 |
| -------------- | -------- | ------------------------------------------------------------ |
| Dashboard      | `Cmd+1`  | Pipeline health, metrics, activity feed                      |
| Agents         | `Cmd+2`  | Spawn and interact with AI agents                            |
| IDE            | `Cmd+3`  | Monaco editor + file explorer + terminal                     |
| Task Pipeline  | `Cmd+4`  | Real-time task execution monitoring                          |
| Code Review    | `Cmd+5`  | Review agent diffs before merging                            |
| Source Control | `Cmd+6`  | Git staging, committing, and pushing                         |
| Settings       | `Cmd+7`  | 8 config tabs (connections, repos, templates, agents, models, memory, appearance, about) |
| Task Planner   | `Cmd+8`  | Multi-task workflow planning, epics, Task Workbench          |

The panel system supports split panes, drag-and-drop docking, and tear-off windows for multi-monitor setups.

---

## Session Types

FLEET spawns Claude Code in five different modes, depending on the context:

| Type            | Interactive      | Worktree  | What it does                                     |
| --------------- | ---------------- | --------- | ------------------------------------------------ |
| **Pipeline**    | No               | Isolated  | Autonomous task execution from the sprint queue  |
| **Adhoc**       | Yes (multi-turn) | Repo dir  | User-spawned one-off Claude Code sessions        |
| **Assistant**   | Yes (multi-turn) | Repo dir  | Conversational help and recommendations          |
| **Reviewer**    | Configurable     | Read-only | Code review against a completed agent's worktree |
| **Copilot**     | Yes (chat)       | None      | Text-only spec drafting in Task Workbench        |
| **Synthesizer** | No               | None      | Structured spec generation from codebase context |

All sessions inherit your project knowledge from `CLAUDE.md` files — same as running Claude Code in your terminal, but managed.

---

## The Mental Model

Think of it like this:

```mermaid
graph LR
    subgraph You["What you do"]
        Y1["Write specs"] --> Y2["Queue tasks"]
        Y2 --> Y3["Review finished work"]
        Y3 --> Y4["Merge / PR / Revise"]
    end

    subgraph FLEET["What FLEET does"]
        B1["Claim tasks from queue"] --> B2["Create git worktree"]
        B2 --> B3["Spawn Claude Code session"]
        B3 --> B4["Monitor health + stream events"]
        B4 --> B5["Handle completion / retry / failure"]
    end

    subgraph CC["What Claude Code does"]
        C1["Read codebase"] --> C2["Write code"]
        C2 --> C3["Run tests"]
        C3 --> C4["Commit to branch"]
    end

    You -.->|specs| FLEET
    FLEET -.->|sessions| CC
    CC -.->|finished work| You

    style You fill:#1a1a2e,stroke:#00ffcc,color:#00ffcc
    style FLEET fill:#1a1a2e,stroke:#ff9f43,color:#ff9f43
    style CC fill:#1a1a2e,stroke:#a855f7,color:#a855f7
```

**Claude Code is the engine. FLEET is the steering system.** You wouldn't manually start 8 terminal sessions, create worktrees, track which tasks depend on which, retry failures, and review diffs across branches. FLEET does that so you can focus on specs and review.

---

## Project Structure

```
src/
  main/                  # Electron main process
    agent-manager/       #   Task orchestration, worktree management, retry logic
    agent-system/        #   Native agent personalities and skills
    data/                #   Repository pattern, audit trail
    handlers/            #   IPC handler modules (~29, ~138 typed channels)
    mcp-server/          #   Opt-in local MCP server for external agents
    services/            #   Task terminal service, dependency resolution
    db.ts                #   SQLite schema + migrations
  preload/               # Type-safe IPC bridge
  renderer/src/
    views/               # Top-level views (Dashboard, Agents, IDE, Pipeline, Code Review, Settings, Planner)
    stores/              # Zustand state management
    components/          # UI components (neon design system)
    hooks/               # Shared React hooks
    lib/                 # Utilities, constants, GitHub cache
  shared/                # Types + IPC channel definitions
docs/
  concepts.md            # Core concepts: Tasks, Specs, Epics, Dependencies, Agent Types
  architecture.md        # Full architecture documentation
  FLEET_FEATURES.md      # Detailed feature reference (loaded by all agents)
  modules/               # Per-module reference docs (updated on every commit)
```

---

## Contributing

FLEET is in active development. If you're interested in contributing:

1. Fork the repo and create a feature branch (`feat/your-feature`)
2. Run `npm run typecheck && npm test && npm run lint` before committing
3. Keep PRs focused — one feature or fix per PR
4. No new npm packages without discussion in an issue first

See [CLAUDE.md](./CLAUDE.md) for detailed development conventions, gotchas, and architecture notes.

---

## License

MIT

---

<div align="center">

Built by [Ryan](https://github.com/RyanJBirkeland) — and yes, most of FLEET was built by Claude Code sessions orchestrated through FLEET itself.

</div>
