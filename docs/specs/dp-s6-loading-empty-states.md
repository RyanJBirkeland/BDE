# DP-S6: Loading & Empty State Polish

**Epic:** Design Polish
**Priority:** P2
**Depends on:** DP-S1

---

## Problem

Loading states and empty states are inconsistent across views. Some views have polished skeleton loaders, others have nothing. Some use the `<EmptyState>` component, others use raw `<div>` elements. None of the empty states have actionable CTAs.

### Loading State Audit

| View         | Has Loading? | Implementation                                           | Gap                                             |
| ------------ | ------------ | -------------------------------------------------------- | ----------------------------------------------- |
| Sessions     | No           | No skeleton or spinner while initial session list loads  | Sidebar shows nothing during first fetch        |
| Sprint       | Yes          | `sprint-board__skeleton` shimmer bars                    | Good                                            |
| Terminal     | No           | N/A — terminals mount immediately                        | Acceptable                                      |
| DiffView     | Yes          | Two skeleton divs (sidebar + content)                    | Good, but uses inline `style={{}}`              |
| MemoryView   | No           | No indicator while file list loads or file content loads | Sidebar and editor both blank                   |
| CostView     | Yes          | 4 stat skeletons + 2 chart skeletons                     | Good                                            |
| SettingsView | No           | N/A — form renders immediately                           | Acceptable (config loaded async but form shows) |

### Empty State Audit

| View / Component          | Has EmptyState? | Text                                                        | Action CTA? | Gap                                                   |
| ------------------------- | --------------- | ----------------------------------------------------------- | ----------- | ----------------------------------------------------- |
| Sessions (no selection)   | Yes             | "Select a session" / "Choose a session from the list"       | No          | Should offer "Start Agent" button                     |
| Sessions (no sessions)    | No              | Falls through to "Select a session"                         | No          | Should say "No agents running" with "Spawn Agent" CTA |
| Sprint/KanbanColumn       | Yes             | Per-column labels (e.g., "No queued tasks")                 | No          | Could offer "Add Task" in backlog column              |
| Sprint/PRList             | Yes             | "No open PRs"                                               | No          | Acceptable                                            |
| DiffView sidebar          | Raw div         | "No changes — working tree is clean"                        | No          | Should use `<EmptyState>` with icon                   |
| DiffView content          | Yes             | "No changes vs origin/main"                                 | No          | Acceptable                                            |
| MemoryView (no files)     | Yes             | "No memory files found"                                     | No          | Should offer "Create File" CTA                        |
| MemoryView (no selection) | Yes             | "Select a file to view"                                     | No          | Acceptable                                            |
| CostView (no data)        | Yes             | "No session data yet" / "Costs will appear once agents run" | No          | Acceptable                                            |

---

## Solution

### 1. Add loading skeletons to Sessions sidebar

When sessions are loading for the first time (empty array + loading), show 4-5 skeleton bars:

```tsx
// In AgentList or SessionsView
{
  loading && agents.length === 0 && (
    <div className="session-list__loading">
      {[...Array(5)].map((_, i) => (
        <div key={i} className="bde-skeleton session-list__skeleton" />
      ))}
    </div>
  )
}
```

Add CSS:

```css
.session-list__skeleton {
  height: 48px;
  margin: 4px 8px;
  border-radius: var(--bde-radius-md);
}
```

### 2. Add loading states to MemoryView

- **File list loading**: Show skeleton bars in sidebar while `loadFiles()` runs
- **File content loading**: Show a skeleton or spinner in the editor area while `openFile()` runs

### 3. Fix DiffView sidebar empty state

Replace the raw `<div className="git-sidebar__empty">` (`DiffView.tsx:355`) with `<EmptyState>`:

```tsx
<EmptyState
  icon={<CheckCircle size={24} />}
  title="Working tree is clean"
  description="No uncommitted changes"
/>
```

### 4. Add action CTAs to key empty states

| Location                     | CTA                                                             |
| ---------------------------- | --------------------------------------------------------------- |
| Sessions "Select a session"  | Add "Spawn Agent" button that opens SpawnModal                  |
| Sessions (no agents at all)  | New empty state: "No agents running" with "Spawn Agent" CTA     |
| MemoryView "No memory files" | Add "Create File" button that triggers `setNewFilePrompt(true)` |
| KanbanColumn Backlog empty   | Add "Add Task" text link                                        |

### 5. Convert DiffView loading to CSS classes

Replace `DiffView.tsx:297-299` inline styles with CSS classes:

```css
.diff-view__loading-grid {
  display: flex;
  gap: 12px;
  width: 100%;
  height: 100%;
  padding: 12px;
}

.diff-view__loading-sidebar {
  width: 260px;
  flex-shrink: 0;
}
```

---

## Files to Modify

| File                                                  | Change                                                                   |
| ----------------------------------------------------- | ------------------------------------------------------------------------ |
| `src/renderer/src/views/SessionsView.tsx`             | Add action CTA to empty state, handle "no agents" case                   |
| `src/renderer/src/views/MemoryView.tsx`               | Add loading skeletons, add "Create File" CTA                             |
| `src/renderer/src/views/DiffView.tsx`                 | Replace raw empty div with `<EmptyState>`, convert loading inline styles |
| `src/renderer/src/assets/sessions.css`                | Add `.session-list__skeleton` and `.session-list__loading`               |
| `src/renderer/src/assets/main.css`                    | Add `.diff-view__loading-grid` classes, `.memory-sidebar__loading`       |
| `src/renderer/src/components/sprint/KanbanColumn.tsx` | Add "Add Task" CTA in backlog empty state                                |

## Acceptance Criteria

- [ ] Sessions sidebar shows skeleton bars during initial load
- [ ] MemoryView sidebar shows skeleton bars during file list load
- [ ] MemoryView editor shows spinner/skeleton while file content loads
- [ ] DiffView sidebar uses `<EmptyState>` component, not raw div
- [ ] Sessions empty state has "Spawn Agent" action button
- [ ] Memory empty state has "Create File" action button
- [ ] No `style={{}}` in DiffView loading section
- [ ] All empty states use the `<EmptyState>` component consistently
- [ ] `npm run build` and `npm test` pass
