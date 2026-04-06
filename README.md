# BDE

**An Electron desktop app for orchestrating autonomous Claude Code agents at scale.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![status: experimental](https://img.shields.io/badge/status-experimental-orange.svg)]()

BDE is a desktop control room for [Claude Code](https://docs.claude.com/en/docs/claude-code). You write specs, BDE queues them, spawns Claude Code sessions in isolated git worktrees, monitors their progress, and presents finished work for review. Multiple agents run in parallel without stepping on each other. You stay in control — nothing merges without a human gate.

It is not a replacement for Claude Code. It is the infrastructure around it: a task queue, a fleet manager, a review station, and a dashboard.

---

## Why BDE

Claude Code is a powerful coding agent. What it does not have out of the box is a queue, parallelism, isolation, or a review gate. Running multiple sessions manually means juggling terminal tabs, remembering which branch is which, mentally tracking dependencies, and catching failures by accident. The agents do the coding — but you end up doing all the project management in your head.

BDE externalizes that meta-work. One screen shows every concurrent session, every queued task, every blocked dependency, and every completed diff waiting for review.

- **Run many Claude Code agents in parallel** against tasks you have queued in advance
- **Each agent in an isolated git worktree** so concurrent work never touches your checkout
- **Human-in-the-loop review station** — agents stop at `review`, you choose merge / PR / revise / discard
- **Dependency-aware pipeline** — declare hard or soft dependencies between tasks; downstream work unblocks automatically as upstream completes
- **Built-in code review, IDE, source control, and dashboard** — no need to context-switch out of the app to evaluate or commit work
- **Smart retry and failure handling** — automatic retries, fast-fail detection, and watchdog timers per task

---

![BDE screenshot](docs/assets/screenshot-placeholder.png)

> Screenshot coming soon — see [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for architecture diagrams and the internal mental model.

---

## Quick start

### Prerequisites

- macOS (Apple Silicon recommended; Intel may work but is unsupported)
- Node.js 22+
- [Claude Code CLI](https://docs.claude.com/en/docs/claude-code) installed and authenticated (`claude login`)
- `git` and the [GitHub CLI](https://cli.github.com) (`gh`)
- An Anthropic Pro or Team subscription — Claude Code requires a subscription, not just an API key

### Install

```bash
git clone https://github.com/RyanJBirkeland/BDE.git
cd BDE
npm install
npm run dev          # development with HMR
# OR
npm run build:mac    # produces an unsigned DMG in ./release/
```

> **Note about the unsigned DMG:** macOS Gatekeeper will block it on first launch. Right-click the app and choose **Open** to allow it through.

---

## Your first task

1. **Open BDE.** A one-time onboarding wizard runs on first launch and checks for Claude Code, `git`, and `gh`.
2. **Configure a repository** in **Settings -> Repositories**, or use the inline form during onboarding.
3. **Open Task Workbench** (`Cmd+0`) and either click *Create your first task* on the welcome screen or write a spec from scratch.
4. **Click Queue Now.** The task enters the Sprint Pipeline and Agent Manager will claim it as soon as a slot is free.
5. **Watch the Sprint Pipeline** (`Cmd+4`) as the agent works, then inspect the diff in **Code Review** (`Cmd+5`) and merge, open a PR, request a revision, or discard.

---

## Status

BDE is in **active development** — expect breaking changes between commits. Schemas, IPC channels, and UI surfaces all move quickly.

It is **not currently accepting outside pull requests.** See [CONTRIBUTING.md](./CONTRIBUTING.md) for the current policy and how to file issues. Watch the repo or check recent commits to follow along.

---

## Documentation

- [Feature reference](./docs/BDE_FEATURES.md) — every view, every agent type, every flow
- [Architecture](./docs/architecture.md) — the full architecture write-up
- [Development guide](./docs/DEVELOPMENT.md) — diagrams, mental model, project structure, build commands
- [Security policy](./SECURITY.md)
- [Contributing](./CONTRIBUTING.md)
- [License](./LICENSE)

---

## Tech stack

- **Electron** + electron-vite — desktop shell and bundling
- **React 19** + **TypeScript 5.9** — renderer UI
- **Zustand** — client state management
- **Monaco editor** — built-in IDE
- **SQLite** via better-sqlite3 — local-first storage at `~/.bde/bde.db`
- **@anthropic-ai/claude-agent-sdk** — agent spawning

---

## License

MIT — see [LICENSE](./LICENSE).

---

## Acknowledgments

BDE is built on top of [Claude Code](https://docs.claude.com/en/docs/claude-code) and the [Claude Agent SDK](https://docs.anthropic.com/en/docs/agents-and-tools/claude-code/sdk). Every agent BDE spawns is a Claude Code session — BDE only handles the steering.

Built by Ryan Birkeland — and yes, much of BDE was written by Claude Code sessions orchestrated through BDE itself.
