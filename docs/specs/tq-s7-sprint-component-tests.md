# TQ-S7: Sprint Component Tests

**Epic:** Testing & QA
**Priority:** P1
**Estimate:** Large
**Type:** Component Test

---

## Problem

The Sprint feature has 11 components totaling 1,420 LOC with **zero tests**. This is the largest untested surface area in the renderer. The components handle:

- **Kanban board** with drag-and-drop (via @dnd-kit)
- **Task CRUD** against Supabase (create, update status, delete)
- **AI spec generation** via gateway RPC
- **GitHub PR integration** (list, display, link to tasks)
- **Spec editing** in a slide-out drawer
- **Agent log viewing** in a separate drawer

### Component Inventory

| Component | File | LOC | Responsibility | Risk |
|-----------|------|-----|----------------|------|
| SprintCenter | `sprint/SprintCenter.tsx` | 271 | Main container: task polling, CRUD, drawer state | High |
| KanbanBoard | `sprint/KanbanBoard.tsx` | 83 | 4-column DnD board | Medium |
| KanbanColumn | `sprint/KanbanColumn.tsx` | 73 | Single column with drop zone | Medium |
| NewTicketModal | `sprint/NewTicketModal.tsx` | 243 | Create task form with AI spec generation | High |
| TaskCard | `sprint/TaskCard.tsx` | 115 | Kanban card with context menu | Medium |
| SpecDrawer | `sprint/SpecDrawer.tsx` | 222 | Read/edit task spec | Medium |
| LogDrawer | `sprint/LogDrawer.tsx` | 106 | Agent run output viewer | Medium |
| PRList | `sprint/PRList.tsx` | 148 | GitHub PR list with polling | High |
| AddCardForm | `sprint/AddCardForm.tsx` | 88 | Quick-add form | Low |
| AgentStatusChip | `sprint/AgentStatusChip.tsx` | 35 | Status badge | Low |
| PRSection | `sprint/PRSection.tsx` | 36 | PR list container | Low |

### Key Dependencies

- **@dnd-kit/core** + **@dnd-kit/sortable** — drag-and-drop library
- **Supabase** — task data via gateway RPC or direct fetch
- **Gateway RPC** — AI spec generation (`rpc.call('generate-spec', ...)`)
- **GitHub API** — PR listing via `lib/github-api.ts`

---

## Test Plan

### Priority Tiers

**Tier 1 (must have):** SprintCenter, NewTicketModal, PRList
**Tier 2 (should have):** KanbanBoard, TaskCard, SpecDrawer
**Tier 3 (nice to have):** KanbanColumn, LogDrawer, AddCardForm, AgentStatusChip, PRSection

### Mocking Strategy

```ts
// Mock Supabase/gateway RPC
vi.mock('../../lib/rpc', () => ({
  rpcCall: vi.fn(),
}))

// Mock GitHub API
vi.mock('../../lib/github-api', () => ({
  listOpenPRs: vi.fn().mockResolvedValue([]),
}))

// Mock window.api
window.api = {
  getGitHubToken: vi.fn().mockResolvedValue('gh-token'),
  getSupabaseConfig: vi.fn().mockResolvedValue({ url: 'https://example.supabase.co', anonKey: 'key' }),
  getRepoPaths: vi.fn().mockResolvedValue({ BDE: '/path/to/bde' }),
}

// Mock data factories
function makeTask(overrides = {}) {
  return {
    id: crypto.randomUUID(),
    title: 'Test task',
    status: 'todo',
    priority: 'medium',
    spec: null,
    created_at: new Date().toISOString(),
    ...overrides,
  }
}
```

### Test Cases

#### SprintCenter.test.tsx

**File to create:** `src/renderer/src/components/sprint/__tests__/SprintCenter.test.tsx`

```
✓ renders loading state while fetching tasks
✓ renders KanbanBoard with fetched tasks
✓ fetches tasks on mount via RPC
✓ polls for task updates at POLL_SPRINT_INTERVAL
✓ cleans up polling interval on unmount
✓ opens NewTicketModal when "New Ticket" button clicked
✓ opens SpecDrawer when task card clicked
✓ updates task status via RPC on drag-and-drop completion
✓ handles RPC error gracefully (shows toast)
✓ deletes task via RPC and removes from list
```

#### NewTicketModal.test.tsx

**File to create:** `src/renderer/src/components/sprint/__tests__/NewTicketModal.test.tsx`

```
✓ renders modal with title input and description textarea
✓ submit button disabled when title is empty
✓ creates task via RPC on submit
✓ closes modal after successful creation
✓ shows error toast on creation failure
✓ AI spec generation button calls gateway RPC
✓ shows loading spinner during AI generation
✓ populates spec field with AI-generated content
✓ handles AI generation failure gracefully
✓ template selector populates title/description from template
✓ clears form on close
```

#### KanbanBoard.test.tsx

**File to create:** `src/renderer/src/components/sprint/__tests__/KanbanBoard.test.tsx`

```
✓ renders 4 columns (todo, in_progress, review, done)
✓ distributes tasks to correct columns by status
✓ renders empty columns with drop zone
✓ task count matches tasks in each status
✓ passes onDragEnd callback to DndContext
```

#### TaskCard.test.tsx

**File to create:** `src/renderer/src/components/sprint/__tests__/TaskCard.test.tsx`

```
✓ renders task title and priority badge
✓ clicking card calls onSelect
✓ shows context menu on right-click
✓ context menu includes "Delete" option
✓ delete option calls onDelete with task ID
✓ renders agent status chip when task has agent_id
✓ truncates long titles with ellipsis
```

#### PRList.test.tsx

**File to create:** `src/renderer/src/components/sprint/__tests__/PRList.test.tsx`

```
✓ renders loading state while fetching PRs
✓ fetches PRs from GitHub API on mount
✓ renders PR title, number, and author for each PR
✓ links PR title to GitHub URL via open-external
✓ shows empty state when no PRs open
✓ polls for new PRs at POLL_PR_LIST_INTERVAL
✓ handles missing GitHub token gracefully (shows setup message)
✓ handles GitHub API errors gracefully (shows error state)
```

#### SpecDrawer.test.tsx

**File to create:** `src/renderer/src/components/sprint/__tests__/SpecDrawer.test.tsx`

```
✓ renders drawer with task spec content
✓ toggles between read and edit mode
✓ saves spec content via RPC on save button click
✓ shows save confirmation toast
✓ close button calls onClose
✓ renders markdown content in read mode
✓ shows textarea in edit mode with current spec
```

---

## Files to Create

| File | Purpose | Estimated LOC |
|------|---------|---------------|
| `src/renderer/src/components/sprint/__tests__/SprintCenter.test.tsx` | Main container tests | ~120 |
| `src/renderer/src/components/sprint/__tests__/NewTicketModal.test.tsx` | Ticket creation tests | ~110 |
| `src/renderer/src/components/sprint/__tests__/KanbanBoard.test.tsx` | Board layout tests | ~60 |
| `src/renderer/src/components/sprint/__tests__/TaskCard.test.tsx` | Card render + interaction | ~70 |
| `src/renderer/src/components/sprint/__tests__/PRList.test.tsx` | PR integration tests | ~80 |
| `src/renderer/src/components/sprint/__tests__/SpecDrawer.test.tsx` | Spec editing tests | ~70 |

## Files to Modify

None — tests only.

---

## Implementation Notes

### DnD Testing

Testing `@dnd-kit` drag-and-drop requires simulating the DnD context. Options:

1. **Mock the DnD context** — wrap tests in `<DndContext>` with a mock `onDragEnd` callback. Don't test the actual drag mechanics (that's the library's job). Instead, test that `onDragEnd` is called with the correct `active` and `over` IDs, and that the component updates state accordingly.

2. **Test the callback directly** — extract the `handleDragEnd` function and test it as a pure function (receives drag event, returns updated task list).

Recommended: Option 2 for SprintCenter, Option 1 for KanbanBoard.

### Supabase / RPC Mocking

Sprint components access data through two paths:
1. **Gateway RPC** (`rpcCall(...)`) — most operations go through this
2. **Direct Supabase fetch** — some polling queries hit Supabase directly

Mock both consistently. Use `vi.mock('../../lib/rpc')` for RPC and `global.fetch` for direct Supabase.

### Rendering

Sprint components import from `@dnd-kit/core` and `@dnd-kit/sortable`. These need jsdom support for:
- `Element.getBoundingClientRect()`
- `ResizeObserver`

Add to test setup if not already present:
```ts
global.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}))
```

## Acceptance Criteria

- [ ] SprintCenter renders with mock task data and polls correctly
- [ ] NewTicketModal creates tasks and handles AI spec generation
- [ ] KanbanBoard distributes tasks to correct columns
- [ ] TaskCard renders with correct data and handles interactions
- [ ] PRList fetches and displays GitHub PRs with error handling
- [ ] SpecDrawer toggles read/edit mode and saves changes
- [ ] All tests run in jsdom environment via `npm test`
