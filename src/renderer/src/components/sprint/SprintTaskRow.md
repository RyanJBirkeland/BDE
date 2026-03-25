# SprintTaskRow

A primitive, reusable component for rendering task rows in the Sprint Center task list.

## Design Philosophy

SprintTaskRow is built as a **V2 primitive component** with:
- **Low coupling**: Not tied to specific sections or contexts
- **High cohesion**: Single responsibility - render a task row
- **Composable**: Flexible props for different use cases
- **Token-based styling**: Uses design system tokens for consistency

## Features

- ✅ Four variants: `backlog`, `blocked`, `done`, `failed`
- ✅ Conditional action buttons based on provided handlers
- ✅ Priority editor with popover
- ✅ Accessible (ARIA labels, keyboard support)
- ✅ Responsive hover states
- ✅ Selection state support
- ✅ Dimmed state for cancelled/failed tasks

## Usage

### Basic Example

```tsx
import { SprintTaskRow } from '@/components/sprint/SprintTaskRow'
import type { SprintTask } from '@/shared/types'

function MyTaskTable({ tasks }: { tasks: SprintTask[] }) {
  return (
    <table>
      <thead>
        <tr>
          <th>Title</th>
          <th>Pri</th>
          <th>Repo</th>
          <th>Created</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {tasks.map((task) => (
          <SprintTaskRow
            key={task.id}
            task={task}
            variant="backlog"
            onViewSpec={(task) => console.log('View spec', task)}
            onPushToSprint={(task) => console.log('Push to sprint', task)}
          />
        ))}
      </tbody>
    </table>
  )
}
```

### Backlog Variant

Shows: Title | Priority | Repo | Created Date | Actions

```tsx
<SprintTaskRow
  task={task}
  variant="backlog"
  onViewSpec={handleViewSpec}
  onPushToSprint={handlePushToSprint}
  onMarkDone={handleMarkDone}
  onUpdatePriority={handleUpdatePriority}
  onEditInWorkbench={handleEditInWorkbench}
/>
```

### Done Variant

Shows: Title | Repo | Completed Date | PR Link | Actions

```tsx
<SprintTaskRow
  task={task}
  variant="done"
  onViewSpec={handleViewSpec}
  onViewOutput={handleViewOutput}
  onRerun={handleRerun} // Only shown if no PR
/>
```

### Failed Variant

Shows: Title | Repo | Cancelled Date | PR Link | Actions

```tsx
<SprintTaskRow
  task={task}
  variant="failed"
  dimmed={true}
  onViewOutput={handleViewOutput}
  onPushToSprint={handleRetry}
/>
```

### Blocked Variant

Shows: Title (with BLOCKED badge) | Priority | Repo | Created Date | Actions

```tsx
<SprintTaskRow
  task={task}
  variant="blocked"
  onViewSpec={handleViewSpec}
  onPushToSprint={handlePushToSprint}
  onMarkDone={handleMarkDone}
  onUpdatePriority={handleUpdatePriority}
  onEditInWorkbench={handleEditInWorkbench}
/>
```

## Props

### Required Props

| Prop | Type | Description |
|------|------|-------------|
| `task` | `SprintTask` | The task data to display |
| `variant` | `'backlog' \| 'done' \| 'failed' \| 'blocked'` | Determines which columns and actions to show |

### Optional Props

| Prop | Type | Description |
|------|------|-------------|
| `selected` | `boolean` | Whether the row is selected (for bulk operations) |
| `dimmed` | `boolean` | Whether to dim the row (typically for failed/cancelled tasks) |
| `onClick` | `(task: SprintTask) => void` | Custom click handler (overrides onViewSpec) |

### Action Handlers

Only the actions you provide will be rendered. This makes the component flexible and prevents rendering unnecessary buttons.

| Handler | Shown In | Description |
|---------|----------|-------------|
| `onViewSpec` | All | View task specification |
| `onViewOutput` | All | View task output/logs |
| `onPushToSprint` | backlog, blocked, failed | Move task to sprint (or retry for failed) |
| `onMarkDone` | backlog, blocked | Mark task as done |
| `onRerun` | done | Re-run task (only shown if no PR) |
| `onUpdatePriority` | backlog, blocked | Update task priority (enables priority editor) |
| `onEditInWorkbench` | backlog, blocked | Open task in workbench |

## Styling

SprintTaskRow uses **inline styles with design tokens** for maximum portability and theme compatibility. All colors, spacing, and typography reference the design system tokens.

### Tokens Used

- `tokens.color.*` - All colors
- `tokens.space.*` - Spacing
- `tokens.size.*` - Font sizes
- `tokens.font.*` - Font families
- `tokens.radius.*` - Border radius
- `tokens.shadow.*` - Shadows
- `tokens.transition.*` - Transitions

## Accessibility

- ✅ Semantic HTML (`<tr>`, `<td>`, `<button>`)
- ✅ ARIA labels for icon buttons
- ✅ `aria-selected` for selection state
- ✅ Keyboard accessible (tab navigation, click handlers)
- ✅ Proper button titles for tooltips

## Testing

Comprehensive test coverage includes:
- All four variants
- Action button visibility and interactions
- Priority popover functionality
- Selection state
- PR links
- Accessibility attributes

Run tests:
```bash
npm test -- SprintTaskRow.test.tsx
```

## Migration from TaskTable Row Components

The old TaskTable used inline row components (`BacklogRow`, `DoneRow`, etc.). SprintTaskRow consolidates these into a single, flexible primitive.

### Before (old pattern)

```tsx
// Inside TaskTable.tsx
function BacklogRow({ task, onPushToSprint, onViewSpec, ... }) {
  return (
    <tr>
      <td>{task.title}</td>
      {/* ... hardcoded structure */}
    </tr>
  )
}
```

### After (new pattern)

```tsx
import { SprintTaskRow } from './SprintTaskRow'

<SprintTaskRow
  task={task}
  variant="backlog"
  onPushToSprint={onPushToSprint}
  onViewSpec={onViewSpec}
/>
```

## Future Enhancements

Potential improvements:
- [ ] Keyboard shortcuts (e.g., `d` to mark done, `s` to push to sprint)
- [ ] Drag handle for reordering
- [ ] Inline editing for title
- [ ] Custom column configuration
- [ ] Performance optimizations with React.memo
