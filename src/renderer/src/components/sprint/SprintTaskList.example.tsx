/**
 * SprintTaskList Usage Example
 *
 * This file demonstrates how to integrate the SprintTaskList component
 * into the Sprint Center redesign.
 */

import { useState } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { SprintTaskList } from './SprintTaskList'
import { useSprintTasks } from '../../stores/sprintTasks'
import { useSprintUI } from '../../stores/sprintUI'
import { useShallow } from 'zustand/react/shallow'

/**
 * Example 1: Basic Usage
 *
 * Simple left-pane task list with task selection.
 */
export function BasicSprintTaskListExample() {
  const tasks = useSprintTasks((s) => s.tasks)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)

  return (
    <div style={{ height: '600px', width: '400px' }}>
      <SprintTaskList
        tasks={tasks}
        selectedTaskId={selectedTaskId}
        onSelectTask={(task) => setSelectedTaskId(task.id)}
      />
    </div>
  )
}

/**
 * Example 2: With Repo Filter
 *
 * Task list filtered by repository.
 */
export function FilteredSprintTaskListExample() {
  const tasks = useSprintTasks((s) => s.tasks)
  const { repoFilter, selectedTaskId, setSelectedTaskId } = useSprintUI(
    useShallow((s) => ({
      repoFilter: s.repoFilter,
      selectedTaskId: s.selectedTaskId,
      setSelectedTaskId: s.setSelectedTaskId
    }))
  )

  return (
    <div style={{ height: '600px', width: '400px' }}>
      <SprintTaskList
        tasks={tasks}
        selectedTaskId={selectedTaskId}
        onSelectTask={(task) => setSelectedTaskId(task.id)}
        repoFilter={repoFilter}
      />
    </div>
  )
}

/**
 * Example 3: Split Layout (Recommended Pattern)
 *
 * Left pane: SprintTaskList
 * Right pane: Task details/spec view
 */
export function SprintCenterWithTaskList() {
  const tasks = useSprintTasks((s) => s.tasks)
  const { repoFilter, selectedTaskId, setSelectedTaskId } = useSprintUI(
    useShallow((s) => ({
      repoFilter: s.repoFilter,
      selectedTaskId: s.selectedTaskId,
      setSelectedTaskId: s.setSelectedTaskId
    }))
  )

  const selectedTask = selectedTaskId ? (tasks.find((t) => t.id === selectedTaskId) ?? null) : null

  return (
    <div style={{ height: '100vh' }}>
      <Group orientation="horizontal">
        {/* Left pane: Task list */}
        <Panel defaultSize={30} minSize={20} maxSize={50}>
          <SprintTaskList
            tasks={tasks}
            selectedTaskId={selectedTaskId}
            onSelectTask={(task) => setSelectedTaskId(task.id)}
            repoFilter={repoFilter}
          />
        </Panel>

        <Separator
          style={{
            width: '4px',
            background: 'var(--bde-border)',
            cursor: 'col-resize',
            flexShrink: 0
          }}
        />

        {/* Right pane: Task details */}
        <Panel defaultSize={70} minSize={50}>
          <div style={{ padding: '16px' }}>
            {selectedTask ? (
              <div>
                <h2>{selectedTask.title}</h2>
                <p>Status: {selectedTask.status}</p>
                <p>Repo: {selectedTask.repo}</p>
                <p>Priority: P{selectedTask.priority}</p>
                {selectedTask.spec && (
                  <div>
                    <h3>Spec</h3>
                    <pre>{selectedTask.spec}</pre>
                  </div>
                )}
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '40px', color: 'var(--bde-text-muted)' }}>
                Select a task to view details
              </div>
            )}
          </div>
        </Panel>
      </Group>
    </div>
  )
}

/**
 * Integration Notes:
 *
 * 1. The SprintTaskList component is designed to be a primitive that can be
 *    composed into larger layouts.
 *
 * 2. It manages its own internal state (search query, status filter) but
 *    accepts selectedTaskId from parent for coordination with other views.
 *
 * 3. The onSelectTask callback allows parent components to respond to
 *    task selection (e.g., open a spec drawer, navigate to task details).
 *
 * 4. The repoFilter prop allows integration with the existing repo filter
 *    UI in the Sprint Center toolbar.
 *
 * 5. The component follows the V2 primitive design philosophy:
 *    - Low coupling: No direct dependencies on specific layouts or views
 *    - High cohesion: All filtering/search logic is self-contained
 *    - Single responsibility: Display and filter a list of tasks
 */
