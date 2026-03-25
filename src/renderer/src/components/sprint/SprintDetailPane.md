# SprintDetailPane Component

A context-aware right-side detail panel for the Sprint Center redesign. Displays comprehensive task information, agent details, PR status, and contextual actions based on task state.

## Features

- **Context-Aware Display**: Shows relevant information based on task status (queued, active, done, blocked, etc.)
- **Collapsible Sections**: Metadata, Dependencies, Spec, Agent Info, PR Info, and Notes sections can be expanded/collapsed
- **Action Buttons**: Contextual actions (Launch, Stop, Rerun, Mark Done, Edit, Delete) based on task state
- **Spec Editing**: Inline spec viewer/editor with save functionality
- **Agent Integration**: Link to agent details and live event streaming
- **PR Integration**: PR status, mergeable state, and direct link to GitHub
- **Dependency Visualization**: Shows hard/soft dependencies with status indicators

## Usage

### Basic Integration

```tsx
import { SprintDetailPane } from './components/sprint/SprintDetailPane'
import { Panel, Separator } from 'react-resizable-panels'

function SprintCenter() {
  const [selectedTask, setSelectedTask] = useState<SprintTask | null>(null)

  return (
    <Group orientation="horizontal" style={{ height: '100%' }}>
      <Panel defaultSize={65} minSize={40}>
        {/* Main sprint board content */}
      </Panel>

      {selectedTask && (
        <>
          <Separator style={{ width: '4px', background: 'var(--bde-border)' }} />
          <Panel defaultSize={35} minSize={20}>
            <SprintDetailPane
              task={selectedTask}
              onClose={() => setSelectedTask(null)}
              onLaunch={handleLaunch}
              onStop={handleStop}
              onRerun={handleRerun}
              onMarkDone={handleMarkDone}
              onDelete={handleDelete}
              onSaveSpec={handleSaveSpec}
              onEditInWorkbench={handleEditInWorkbench}
            />
          </Panel>
        </>
      )}
    </Group>
  )
}
```

### Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `task` | `SprintTask \| null` | Yes | The task to display details for, or null to show empty state |
| `onClose` | `() => void` | Yes | Callback when close button is clicked |
| `onLaunch` | `(task: SprintTask) => void` | No | Callback to launch queued task |
| `onStop` | `(task: SprintTask) => void` | No | Callback to stop active task |
| `onRerun` | `(task: SprintTask) => void` | No | Callback to rerun failed/completed task |
| `onMarkDone` | `(task: SprintTask) => void` | No | Callback to mark task as done |
| `onDelete` | `(taskId: string) => void` | No | Callback to delete task |
| `onSaveSpec` | `(taskId: string, spec: string) => void` | No | Callback to save spec changes |
| `onUpdateTitle` | `(patch: { id: string; title: string }) => void` | No | Callback to update task title |
| `onEditInWorkbench` | `(task: SprintTask) => void` | No | Callback to open task in workbench |

### Task States and Actions

The component automatically shows contextual actions based on task status:

#### Queued Tasks
- **Launch**: Start the agent
- **Mark Done**: Skip agent execution
- **Edit**: Open in task workbench
- **Delete**: Remove task

#### Active Tasks
- **Stop**: Kill the running agent
- **Mark Done**: Force complete
- **Edit**: Open in task workbench
- **View Output**: (available via Agent section)

#### Done Tasks
- **Re-run**: Re-execute if no PR exists
- **View PR**: Open PR in GitHub (if exists)

#### Failed Tasks
- **Re-run**: Retry the task
- **Edit**: Modify and retry
- **Delete**: Remove task

#### Blocked Tasks
- Shows dependency status and blocking reason
- Actions appear once unblocked

## Sections

### Metadata
Always visible. Shows:
- Repository
- Priority (P0-P9)
- Created/Started/Completed timestamps
- Retry count

### Dependencies
Visible when `depends_on` is not empty. Shows:
- List of dependency tasks
- Status indicator (✓ for done, ○ for pending)
- Current status badge

### Specification
Visible when `spec` or `prompt` exists. Shows:
- Markdown-rendered spec content
- Edit button (when `onSaveSpec` is provided)
- Inline editor mode

### Agent Run
Visible when `agent_run_id` exists. Shows:
- Agent ID (truncated)
- Latest event (thinking, tool-call, or message)
- "Open in Agents View" button

### Pull Request
Visible when `pr_url` exists. Shows:
- PR number
- Status badge (Merged, Open, Closed)
- Mergeable state with conflict indicator
- "View PR" button

### Notes
Visible when `notes` is not empty. Shows:
- Plain text notes content
- Pre-formatted with word-wrap

## Styling

The component uses the design system tokens from `design-system/tokens.ts`:
- Colors: Adapts to light/dark theme via CSS variables
- Spacing: 4px base scale
- Typography: UI font for text, code font for IDs/technical content
- Transitions: Smooth expand/collapse animations

## Accessibility

- All interactive elements have proper ARIA labels
- Keyboard navigation supported
- Focus management on open/close
- Screen reader friendly with semantic HTML

## Testing

Comprehensive test suite in `__tests__/SprintDetailPane.test.tsx`:
- Empty state rendering
- Task state-based action buttons
- Section expansion/collapse
- Callbacks and event handlers
- Dependency visualization
- PR and agent integration
