# EpicDetail.tsx Decomposition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decompose EpicDetail.tsx (746L) into EpicHeader, EpicProgress, TaskRow, TaskList, and thin EpicDetail facade.

**Architecture:** EpicDetail currently owns header rendering, progress metrics, task-list rendering with drag/drop, and inline spec editing. The refactor extracts each concern into its own file: EpicHeader renders the icon/name/goal/overflow menu; EpicProgress calculates and renders progress; TaskList manages drag state and task ordering; TaskRow handles individual task rendering and inline spec editing; EpicDetail becomes a thin facade that composes them.

**Tech Stack:** TypeScript, React, Electron (renderer process), Vitest

---

## Task 1: Create EpicHeader

**Files:**
- Create: `src/renderer/src/components/planner/EpicHeader.tsx`
- Modify: `src/renderer/src/components/planner/EpicDetail.tsx`

- [ ] Read `src/renderer/src/components/planner/EpicDetail.tsx` and identify lines 305–456 (header section: icon box, name/goal, overflow menu with Edit/Ready/Completed/Delete)
- [ ] Create `src/renderer/src/components/planner/EpicHeader.tsx` with:
  - Props interface: `{ group: TaskGroup; isReady: boolean; isCompleted: boolean; onEdit: () => Promise<void>; onToggleReady: () => void; onMarkCompleted: () => void; onDelete: () => Promise<void> }`
  - State: `showOverflowMenu`, `menuRef`, `menuItemsRef`
  - Handlers: `handleMenuKeyDown`, `handleEdit`, `handleDelete`, `handleToggleReady`, `handleMarkCompleted`
  - Hooks: `useEffect` for click-outside, `useRef`, `useState`, `useCallback`
  - Render: the exact markup from lines 304–456, unchanged
- [ ] In EpicDetail.tsx, replace lines 305–456 with `<EpicHeader group={group} isReady={isReady} isCompleted={isCompleted} onEdit={handleEdit} onToggleReady={handleToggleReady} onMarkCompleted={handleMarkCompleted} onDelete={handleDelete} />`
- [ ] Add `EpicHeader` to EpicDetail imports
- [ ] Run `npm run typecheck` from repo root — fix any errors before continuing
- [ ] Run `npm test` — all tests must pass
- [ ] Commit: `git add -A && git commit -m "refactor: extract EpicHeader from EpicDetail"`

---

## Task 2: Create EpicProgress

**Files:**
- Create: `src/renderer/src/components/planner/EpicProgress.tsx`
- Modify: `src/renderer/src/components/planner/EpicDetail.tsx`

- [ ] Read EpicDetail.tsx and identify progress calculation logic: lines 120–153 (counts memo, tasksNeedingSpecs, tasksReadyToQueue, progressPercent, progressColor)
- [ ] Create `src/renderer/src/components/planner/EpicProgress.tsx` with:
  - Props interface: `{ tasks: SprintTask[]; tasksNeedingSpecs: number; tasksReadyToQueue: number }`
  - Internal: compute `counts`, `progressPercent`, `progressColor` via useMemo
  - Render: lines 459–496 (progress bar, status breakdown, readiness warning)
- [ ] In EpicDetail.tsx, delete the useMemo blocks for counts, progressPercent, progressColor, tasksNeedingSpecs, tasksReadyToQueue
- [ ] Replace lines 459–496 with `<EpicProgress tasks={tasks} tasksNeedingSpecs={tasksNeedingSpecs} tasksReadyToQueue={tasksReadyToQueue} />`
- [ ] Add `EpicProgress` to EpicDetail imports
- [ ] Run `npm run typecheck` — fix any errors
- [ ] Run `npm test` — all tests must pass
- [ ] Commit: `git add -A && git commit -m "refactor: extract EpicProgress from EpicDetail"`

---

## Task 3: Create TaskRow

**Files:**
- Create: `src/renderer/src/components/planner/TaskRow.tsx`
- Modify: `src/renderer/src/components/planner/EpicDetail.tsx`

- [ ] Read EpicDetail.tsx and identify inline spec editing state: lines 64–69 (`editingTaskId`, `editingSpec`, `saving`, `textareaRef`), and handlers lines 217–255 (`handleTaskClick`, `handleCancelEdit`, `handleSaveEdit`, `handleSpecKeyDown`, `useEffect` for textarea focus)
- [ ] Create `src/renderer/src/components/planner/TaskRow.tsx` with:
  - Props: `{ task: SprintTask; isEditing: boolean; editingSpec: string; saving: boolean; onEditStart: (task: SprintTask) => void; onCancelEdit: () => void; onSaveEdit: (spec: string) => Promise<void>; onEdit: (taskId: string) => void; isDragging: boolean; isDragOver: boolean; onDragStart: ...; onDragOver: ...; onDragLeave: ...; onDrop: ...; onDragEnd: ...; onSpecChange: (spec: string) => void }`
  - Internal: `textareaRef`, `useEffect` for textarea focus, `handleSpecKeyDown`
  - Render: lines 525–651 (task row with conditional editing view)
- [ ] In EpicDetail.tsx, delete lines 217–255 (inline spec handlers and useEffect)
- [ ] Replace task row render logic with `<TaskRow task={task} isEditing={isEditing} ... />`
- [ ] Add `TaskRow` to EpicDetail imports
- [ ] Run `npm run typecheck` — fix any errors
- [ ] Run `npm test` — all tests must pass
- [ ] Commit: `git add -A && git commit -m "refactor: extract TaskRow from EpicDetail"`

---

## Task 4: Create TaskList

**Files:**
- Create: `src/renderer/src/components/planner/TaskList.tsx`
- Modify: `src/renderer/src/components/planner/EpicDetail.tsx`

- [ ] Read EpicDetail.tsx and identify drag state: lines 62–63 (`draggedTaskId`, `dragOverTaskId`), drag handlers lines 260–301, and task splitting lines 155–164 (`outstandingTasks`, `completedTasks`)
- [ ] Create `src/renderer/src/components/planner/TaskList.tsx` with:
  - Props: `{ tasks: SprintTask[]; editingTaskId: string | null; editingSpec: string; saving: boolean; loading: boolean; onEditStart: ...; onCancelEdit: ...; onSaveEdit: ...; onEditTask: ...; onAddTask: ...; onReorderTasks?: ...; onSpecChange: ... }`
  - Internal state: `draggedTaskId`, `dragOverTaskId`
  - Derived: `outstandingTasks`, `completedTasks` via useMemo
  - Handlers: `handleDragStart`, `handleDragOver`, `handleDragLeave`, `handleDrop`, `handleDragEnd`
  - Render: entire task list section (lines 507–715) including outstanding tasks, "Add task" button, completed section
- [ ] In EpicDetail.tsx, delete drag state (lines 62–63), task splitting memos (lines 155–164), and drag handlers (lines 260–301)
- [ ] Replace lines 507–715 with `<TaskList tasks={tasks} ... />`
- [ ] Add `TaskList` to EpicDetail imports
- [ ] Run `npm run typecheck` — fix any errors
- [ ] Run `npm test` — all tests must pass
- [ ] Commit: `git add -A && git commit -m "refactor: extract TaskList from EpicDetail"`

---

## Task 5: Finalize EpicDetail Facade

**Files:**
- Modify: `src/renderer/src/components/planner/EpicDetail.tsx`

- [ ] Review EpicDetail.tsx — it should now contain only:
  - Props interface (unchanged)
  - Epic-level callbacks: `handleEdit`, `handleDelete`, `handleToggleReady`, `handleMarkCompleted`
  - Spec editing coordinators: `handleTaskClick`, `handleCancelEdit`, `handleSaveEdit`
  - State: `editingTaskId`, `editingSpec`, `saving`
  - Render: compose `<EpicHeader>`, `<EpicProgress>`, `<TaskList>`, `<EpicDependencySection>`
- [ ] Expected file size: ≤100 lines
- [ ] Run `npm run typecheck` — fix any errors
- [ ] Run `npm test` — all tests must pass
- [ ] Run `npm run lint` — zero lint errors
- [ ] Commit: `git add -A && git commit -m "refactor: epic-detail decomposition complete"`

---

## Verification

- `npm run typecheck` — zero errors
- `npm test` — zero regressions
- Each new file ≤200 lines; `EpicDetail.tsx` ≤100 lines
