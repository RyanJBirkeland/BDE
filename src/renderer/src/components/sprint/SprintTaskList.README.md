# SprintTaskList Component

A filterable left-pane task list for the Sprint Center redesign. Provides a focused, searchable view of sprint tasks with status and repository filtering.

## Features

- 🔍 **Full-text search** across task titles, specs, and notes
- 🏷️ **Status filters**: All, Backlog, To Do, In Progress, Awaiting Review, Blocked, Done, Failed
- 🎯 **Repository filtering** integration (optional)
- ✨ **Visual indicators**: Status badges, priority badges, PR numbers, repo dots
- ⚡ **Responsive**: Smooth animations and hover states
- ♿ **Accessible**: Semantic HTML, ARIA labels, keyboard navigation
- 🧩 **Composable**: V2 primitive design for flexible integration

## Usage

### Basic Example

```tsx
import { SprintTaskList } from './components/sprint/SprintTaskList'

function MySprintView() {
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const tasks = useSprintTasks((s) => s.tasks)

  return (
    <SprintTaskList
      tasks={tasks}
      selectedTaskId={selectedTaskId}
      onSelectTask={(task) => setSelectedTaskId(task.id)}
    />
  )
}
```

### With Repo Filter

```tsx
<SprintTaskList
  tasks={tasks}
  selectedTaskId={selectedTaskId}
  onSelectTask={(task) => setSelectedTaskId(task.id)}
  repoFilter="BDE"  // Only show BDE tasks
/>
```

## Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `tasks` | `SprintTask[]` | Yes | Array of sprint tasks to display |
| `selectedTaskId` | `string \| null` | Yes | ID of currently selected task (for highlighting) |
| `onSelectTask` | `(task: SprintTask) => void` | Yes | Callback when a task is clicked |
| `repoFilter` | `string \| null` | No | Optional repository filter (e.g., "BDE", "feast") |

## Component Structure

```
SprintTaskList
├── Header (title + count badge)
├── Search Input (with clear button)
├── Status Filter Chips (with counts)
└── Task List Items
    ├── Task Header (repo dot + title)
    ├── Task Meta (status badge + repo badge + priority badge)
    └── Task Footer (timestamp + PR number)
```

## Filtering Logic

The component applies filters in this order:

1. **Repo Filter** (if provided): Filters tasks by repository name
2. **Status Filter**: Partitions tasks into categories (backlog, todo, in-progress, etc.)
3. **Search Query**: Full-text search across title, spec, notes, and repo fields

Tasks are then sorted:
- **Backlog/Todo/All**: By priority (ascending)
- **Other statuses**: By updated_at (descending)

## Status Mapping

| Task Status | Display Status | Badge Variant |
|-------------|----------------|---------------|
| `backlog` | Backlog | `muted` |
| `queued` | Todo | `info` |
| `active` | Active | `warning` |
| `active` + `pr_status: open` | Review | `info` |
| `done` + `pr_status: open` | Review | `info` |
| `done` | Done | `success` |
| `blocked` | Blocked | `danger` |
| `failed` / `error` / `cancelled` | Failed | `danger` |

## Styling

The component uses BEM-style CSS classes prefixed with `sprint-task-list`:

- `.sprint-task-list` - Root container
- `.sprint-task-list__header` - Header section
- `.sprint-task-list__search` - Search input container
- `.sprint-task-list__filters` - Status filter chips container
- `.sprint-task-list__filter-chip` - Individual filter chip
- `.sprint-task-list__filter-chip--active` - Active filter chip
- `.sprint-task-list__items` - Scrollable task list
- `.sprint-task-list-item` - Individual task item
- `.sprint-task-list-item--selected` - Selected task item

All styles are defined in `src/renderer/src/assets/sprint.css`.

## Design Philosophy

This component follows the **V2 primitive component system** principles:

### Low Coupling
- No direct dependencies on specific layouts or views
- State is managed locally (search, filters) or passed as props (selected task)
- Can be used standalone or composed into complex layouts

### High Cohesion
- All filtering and search logic is self-contained
- Task display logic is encapsulated
- No side effects or external state mutations

### Single Responsibility
- Display and filter a list of sprint tasks
- Handle task selection via callback
- Does not manage task creation, deletion, or updates

## Integration Points

### Sprint Center Integration

```tsx
import { Group, Panel, Separator } from 'react-resizable-panels'
import { SprintTaskList } from './SprintTaskList'
import { SpecDrawer } from './SpecDrawer'

function SprintCenter() {
  const tasks = useSprintTasks((s) => s.tasks)
  const { selectedTaskId, setSelectedTaskId, repoFilter } = useSprintUI(
    useShallow((s) => ({
      selectedTaskId: s.selectedTaskId,
      setSelectedTaskId: s.setSelectedTaskId,
      repoFilter: s.repoFilter,
    }))
  )

  return (
    <Group orientation="horizontal">
      <Panel defaultSize={30} minSize={20} maxSize={50}>
        <SprintTaskList
          tasks={tasks}
          selectedTaskId={selectedTaskId}
          onSelectTask={(task) => setSelectedTaskId(task.id)}
          repoFilter={repoFilter}
        />
      </Panel>
      <Separator />
      <Panel defaultSize={70}>
        {/* Main content area */}
      </Panel>
    </Group>
  )
}
```

## Keyboard Navigation

- **Type to search**: Focus search input and type
- **Esc**: Clear search (when search input is focused)
- **Tab**: Navigate through filter chips and task items
- **Enter/Space**: Activate filter chip or select task
- **Click**: Select task or activate filter

## Accessibility

- Semantic HTML structure (`<button>`, `<input>`, etc.)
- ARIA labels for screen readers
- Keyboard navigation support
- Focus indicators
- Color-blind friendly badge variants

## Performance

- **Memoization**: Uses `useMemo` for expensive filtering operations
- **Animation**: Staggered fade-in animations with `animation-delay`
- **Virtualization**: Not currently implemented (add if list grows beyond ~100 items)
- **Debouncing**: Search is instant (consider adding debounce if performance issues arise)

## Testing

Test file: `src/renderer/src/components/sprint/__tests__/SprintTaskList.test.tsx`

Key test scenarios:
- Renders all tasks correctly
- Filters by search query
- Filters by status
- Filters by repository
- Handles task selection
- Highlights selected task
- Displays empty states
- Shows PR numbers and priority badges

## Future Enhancements

- [ ] Virtual scrolling for large task lists (500+ items)
- [ ] Drag-and-drop task reordering
- [ ] Bulk task selection with checkboxes
- [ ] Custom sort options (priority, date, alphabetical)
- [ ] Saved filter presets
- [ ] Keyboard shortcuts for quick filtering (1-9 for status)
- [ ] Task grouping (by repo, by priority, by date)
- [ ] Collapsible status sections

## Related Components

- **SprintCenter**: Parent container for Sprint Center redesign
- **SprintToolbar**: Top toolbar with repo filter chips
- **TaskTable**: Legacy table view (being replaced)
- **KanbanBoard**: Kanban view (complementary to task list)
- **SpecDrawer**: Task detail drawer (opens when task is selected)

## Changelog

### v1.0.0 (2026-03-25)
- Initial implementation
- Full-text search
- Status and repository filtering
- Responsive design with animations
- Comprehensive test coverage
