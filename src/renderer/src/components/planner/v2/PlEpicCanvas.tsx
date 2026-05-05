import { useState } from 'react'
import type { TaskGroup, SprintTask } from '../../../../../shared/types'
import { PlEpicHero } from './PlEpicHero'
import { PlTaskListPane } from './PlTaskListPane'
import { PlSpecPane } from './PlSpecPane'
import { PlQueueBar } from './PlQueueBar'

interface Props {
  epic: TaskGroup
  tasks: SprintTask[]
  selectedTaskId: string | null
  onSelectTask: (id: string) => void
  assistantOpen: boolean
  onAddTask: () => void
  onEditInWorkbench: (task: SprintTask) => void
  onEditEpic: () => void
  onToggleReady: () => void
  onTogglePause: () => void
  onQueueAll: () => void
  onAskAssistantDraft: (message: string) => void
  onSaveSpec: (taskId: string, spec: string) => Promise<void>
}

const TABS = ['Tasks', 'Spec', 'Dependencies', 'Activity'] as const
type Tab = (typeof TABS)[number]

export function PlEpicCanvas({
  epic,
  tasks,
  selectedTaskId,
  onSelectTask,
  assistantOpen,
  onAddTask,
  onEditInWorkbench,
  onEditEpic,
  onToggleReady,
  onTogglePause,
  onQueueAll,
  onAskAssistantDraft,
  onSaveSpec
}: Props): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<Tab>('Tasks')

  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg)',
        borderRight: assistantOpen ? '1px solid var(--line)' : 'none'
      }}
    >
      <PlEpicHero epic={epic} tasks={tasks} onEditEpic={onEditEpic} onToggleReady={onToggleReady} />

      <PlEpicTabBar
        tabs={TABS}
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        taskCount={tasks.length}
        dependencyCount={epic.depends_on?.length ?? 0}
      />

      {activeTab === 'Tasks' ? (
        <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
          <PlTaskListPane
            tasks={tasks}
            selectedTaskId={selectedTaskId}
            onSelectTask={onSelectTask}
            onAddTask={onAddTask}
          />
          <PlSpecPane
            tasks={tasks}
            taskId={selectedTaskId}
            onEditInWorkbench={onEditInWorkbench}
            onAskAssistantDraft={onAskAssistantDraft}
            onSaveSpec={onSaveSpec}
          />
        </div>
      ) : (
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          <span style={{ fontSize: 12, color: 'var(--fg-4)' }}>{activeTab} — coming soon</span>
        </div>
      )}

      <PlQueueBar
        tasks={tasks}
        isPaused={epic.is_paused}
        onQueueAll={onQueueAll}
        onTogglePause={onTogglePause}
      />
    </div>
  )
}

function PlEpicTabBar({
  tabs,
  activeTab,
  onSelectTab,
  taskCount,
  dependencyCount
}: {
  tabs: readonly Tab[]
  activeTab: Tab
  onSelectTab: (tab: Tab) => void
  taskCount: number
  dependencyCount: number
}): React.JSX.Element {
  const badgeFor = (tab: Tab): number | null => {
    if (tab === 'Tasks') return taskCount
    if (tab === 'Dependencies') return dependencyCount || null
    return null
  }

  return (
    <div
      style={{
        height: 38,
        padding: '0 28px',
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        borderBottom: '1px solid var(--line)',
        flexShrink: 0
      }}
    >
      {tabs.map((tab) => {
        const isActive = tab === activeTab
        const badge = badgeFor(tab)
        return (
          <button
            key={tab}
            onClick={() => onSelectTab(tab)}
            style={{
              position: 'relative',
              height: 38,
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              padding: '0 2px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 12,
              color: isActive ? 'var(--fg)' : 'var(--fg-3)',
              fontWeight: isActive ? 500 : 400
            }}
          >
            {tab}
            {badge != null && (
              <span
                style={{
                  fontSize: 10,
                  fontFamily: 'var(--font-mono)',
                  color: isActive ? 'var(--fg-2)' : 'var(--fg-4)',
                  background: 'var(--surf-1)',
                  border: '1px solid var(--line)',
                  borderRadius: 999,
                  padding: '1px 6px'
                }}
              >
                {badge}
              </span>
            )}
            {isActive && (
              <span
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  bottom: -1,
                  height: 2,
                  background: 'var(--accent)',
                  borderRadius: 2
                }}
              />
            )}
          </button>
        )
      })}
    </div>
  )
}
