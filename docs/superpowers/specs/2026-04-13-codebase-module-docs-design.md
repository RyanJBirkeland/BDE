# Design: Codebase Module Documentation System

**Date:** 2026-04-13  
**Status:** Draft

---

## Overview

BDE's codebase spans ~150+ source files across main process, renderer, and shared layers. There is no lightweight reference for agents or humans to understand what a module does, what it exports, or what it depends on — without reading source code. This system establishes a `docs/modules/` tree organized by architectural layer, grown organically as agents touch files.

---

## Goals

- Every touched module has a doc before it lands on `main`
- Docs are lightweight: purpose, public API, key dependencies — no more
- The tree is traversable by both humans and agents via a master TOC
- Zero friction for agents: adding a table row fulfills the minimum requirement

---

## Directory Structure

```
docs/modules/
  README.md                        ← Master TOC, links all layer indexes
  services/
    index.md                       ← Summary table for all services
    task-terminal-service.md       ← Created when agent first touches the file
    auto-review-service.md
    ...
  handlers/
    index.md
    agent-handlers.md
    ...
  data/
    index.md
    sprint-task-repository.md
    ...
  agent-manager/
    index.md
    run-agent.md
    prompt-composer.md
    ...
  components/
    index.md                       ← Single flat table with a Group column
    SprintPipeline.md
    DashboardView.md
    ...
  views/
    index.md
  stores/
    index.md
  hooks/
    index.md
  shared/
    index.md
  lib/
    main/
      index.md                     ← Main-process utilities
    renderer/
      index.md                     ← Renderer utilities
```

---

## Layer Mapping

| Layer | Source path(s) |
|---|---|
| `services/` | `src/main/services/` |
| `handlers/` | `src/main/handlers/` |
| `data/` | `src/main/data/` |
| `agent-manager/` | `src/main/agent-manager/` |
| `components/` | `src/renderer/src/components/**` (flat index, Group column for domain) |
| `views/` | `src/renderer/src/views/` |
| `stores/` | `src/renderer/src/stores/` |
| `hooks/` | `src/renderer/src/hooks/` |
| `shared/` | `src/shared/` |
| `lib/main/` | `src/main/lib/` |
| `lib/renderer/` | `src/renderer/src/lib/` |

---

## Layer Index Format

Each `index.md` is a Markdown table. One row per module in that layer.

```markdown
# Services

| Module | Purpose | Key Exports |
|--------|---------|-------------|
| [task-terminal-service](task-terminal-service.md) | Unified terminal resolution — all terminal status paths converge here | `onStatusTerminal()` |
| auto-review-service | Rule evaluation for the review auto-check IPC handler | `checkAutoReview()` |
```

- Modules with their own detail file get a hyperlink in the Module column.
- Modules without a detail file yet are plain text — the row alone satisfies the pre-commit requirement.
- **Components layer:** include a `Group` column (e.g. `sprint`, `dashboard`, `ui`) instead of subdirectory indexes.
- **File renames:** update the row's module name and link. **File deletions:** remove the row.

```markdown
# Components

| Module | Group | Purpose | Key Exports |
|--------|-------|---------|-------------|
| [SprintPipeline](SprintPipeline.md) | sprint | Three-zone pipeline execution view | `SprintPipeline` (default) |
| TaskDetailDrawer | sprint | Drawer showing task details and actions | `TaskDetailDrawer` (default) |
```

---

## Module Detail File Format

Create a detail file when a module has new or changed exports, or changed observable behavior. A row in the index is sufficient for minor edits (formatting, bug fixes with no API change).

```markdown
# <module-name>

**Layer:** <layer>
**Source:** `<relative-path>`

## Purpose
One or two sentences describing what this module does.

## Public API
- `exportedFunction(args)` — brief description
- `ExportedType` — brief description
```

For React components, list the default export and any named exports (types, hooks, sub-components):

```markdown
## Public API
- `SprintPipeline` (default) — renders the three-zone pipeline execution view
- `SprintPipelineProps` — prop type for the component
```

```markdown
## Key Dependencies
- `other-module.ts` — why it's needed
```

**What to omit:** implementation details, inline code, history, TODO lists, anything that duplicates source comments.

---

## Master TOC Format

`docs/modules/README.md` lists all eleven layer indexes with a one-line description and a link.

```markdown
# BDE Module Documentation

| Layer | Description |
|-------|-------------|
| [Services](services/index.md) | Domain services — business logic that IPC handlers delegate to |
| [Handlers](handlers/index.md) | IPC handlers — thin wrappers over services |
| [Data](data/index.md) | Repository and query layer — SQLite access |
| [Agent Manager](agent-manager/index.md) | Pipeline agent lifecycle orchestration |
| [Components](components/index.md) | React UI components, grouped by domain |
| [Views](views/index.md) | Top-level view components (one per app view) |
| [Stores](stores/index.md) | Zustand state stores |
| [Hooks](hooks/index.md) | React hooks |
| [Shared](shared/index.md) | Types, IPC channels, constants shared across processes |
| [Lib — Main](lib/main/index.md) | Utility functions for the main process |
| [Lib — Renderer](lib/renderer/index.md) | Utility functions for the renderer process |
```

---

## CLAUDE.md Instruction (pre-commit gate)

The following section must be added to `CLAUDE.md` in the BDE project under **Build & Test**, near the existing pre-commit checklist.

### Module Documentation (MANDATORY pre-commit)

Before every commit, update `docs/modules/` for every file you created or modified:

1. **Minimum requirement:** ensure the module has a row in its layer `index.md`. Add one if missing.
2. **If you changed exports or behavior:** update or create the individual `<module>.md` detail file and link it from the index row.

**Layer → doc path mapping:**

| If you touched... | Update docs in... |
|---|---|
| `src/main/services/*` | `docs/modules/services/index.md` |
| `src/main/handlers/*` | `docs/modules/handlers/index.md` |
| `src/main/data/*` | `docs/modules/data/index.md` |
| `src/main/agent-manager/*` | `docs/modules/agent-manager/index.md` |
| `src/renderer/src/components/**` | `docs/modules/components/index.md` (use Group column for domain) |
| `src/renderer/src/views/*` | `docs/modules/views/index.md` |
| `src/renderer/src/stores/*` | `docs/modules/stores/index.md` |
| `src/renderer/src/hooks/*` | `docs/modules/hooks/index.md` |
| `src/shared/*` | `docs/modules/shared/index.md` |
| `src/main/lib/*` | `docs/modules/lib/main/index.md` |
| `src/renderer/src/lib/*` | `docs/modules/lib/renderer/index.md` |

**Module doc template:**

```markdown
# <module-name>

**Layer:** <layer>
**Source:** `<relative-path>`

## Purpose
One or two sentences.

## Public API
- `exportedThing` — what it does

## Key Dependencies
- `dependency.ts` — why
```

Do not document implementation details, private functions, or anything already clear from the source. Keep it to what a caller needs to know.

---

## Bootstrapping

On first implementation:

1. Create `docs/modules/README.md` with the master TOC table — populate the one-line description for each layer now (see Master TOC Format above). Don't leave descriptions blank.
2. Create each `docs/modules/<layer>/index.md` with the correct column headers for that layer (include the `Group` column for `components/`). Leave the table body empty.
3. Create `docs/modules/lib/main/index.md` and `docs/modules/lib/renderer/index.md` separately.
4. Add the CLAUDE.md instruction.
5. Agents fill in rows and detail files as they touch code going forward. No bulk backfill required.

The system grows organically. Untouched modules simply have no row yet — that's acceptable. The invariant is: **if it was touched in a commit, it has a row.**

---

## Non-Goals

- Not a full API reference — keep docs light (purpose, exports, dependencies only)
- Not auto-generated — agent-authored prose beats scraped signatures
- Not a replacement for CLAUDE.md architecture notes — those stay in CLAUDE.md
- No enforcement CI check (the pre-commit instruction in CLAUDE.md is the gate)
