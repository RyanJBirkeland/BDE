# Sprint 2: Data Integrity & Operations — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Protect data from loss, improve CI gates, harden concurrency primitives.

**Architecture:** Add SQLite backup, proper log rotation, CI improvements, shutdown safety, and atomic locking.

**Tech Stack:** TypeScript, Node.js, better-sqlite3, GitHub Actions, Vitest

---

## Tasks

### Task 1: Database Backup via VACUUM INTO

Add periodic backup of `~/.bde/bde.db` to `~/.bde/bde.db.backup`.

### Task 2: Proper Log Rotation

Replace truncation with rename-before-truncate in `logger.ts`. Keep 1 generation.

### Task 3: Agent Manager Log Rotation

Add rotation to agent-manager's `fileLog()` (currently grows unbounded).

### Task 4: Add test:main and lint to CI

Add `npm run lint` and `npm run test:main` to `.github/workflows/ci.yml`.

### Task 5: Fix build:mac to include typecheck

Change `build:mac` script to run typecheck before vite build.

### Task 6: Shutdown Re-queues Active Tasks

After aborting agents in `stop()`, mark remaining active tasks as `queued` with `claimed_by: null`.

### Task 7: WIP Limit Atomic Enforcement

Move WIP check into `claimTask()` as a single SQL transaction.

### Task 8: Worktree Lock O_EXCL

Use `writeFileSync` with `{ flag: 'wx' }` for atomic lock acquisition.

### Task 9: Periodic agent_events Pruning

Add a recurring prune interval (not just startup).
