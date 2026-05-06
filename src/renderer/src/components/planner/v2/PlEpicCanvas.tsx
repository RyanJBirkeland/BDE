import { useState } from 'react'
import type { TaskGroup, SprintTask } from '../../../../../shared/types'
import { PlEpicHero } from './PlEpicHero'
import { PlTaskListPane } from './PlTaskListPane'
import { PlSpecPane } from './PlSpecPane'
import { PlQueueBar } from './PlQueueBar'
import { PlDepsPane } from './PlDepsPane'
import { PlActivityFeed } from './PlActivityFeed'
import { useRovingTabIndex } from '../../../hooks/useRovingTabIndex'

interface PlEpicCanvasProps {
  epic: TaskGroup
  tasks: SprintTask[]
  allGroups: TaskGroup[]
  selectedTaskId: string | null
  onSelectTask: (id: string) => void
  assistantOpen: boolean
  onAddTask: () => void
  onEditInWorkbench: (task: SprintTask) => void
  onToggleReady: () => void
  onTogglePause: () => void
  onQueueAll: () => void
  onAskAssistantDraft: (message: string) => void
  onSaveSpec: (taskId: string, spec: string) => Promise<void>
  onSaveName: (name: string) => Promise<void>
  onSaveGoal: (goal: string) => Promise<void>
  onAddDependency: (upstreamId: string) => Promise<void>
  onRemoveDependency: (upstreamId: string) => Promise<void>
  onChangeCondition: (upstreamId: string, condition: import('../../../../../shared/types').EpicDependency['condition']) => Promise<void>
}

const TABS = ['Tasks', 'Spec', 'Dependencies', 'Activity'] as const
type Tab = (typeof TABS)[number]

export function PlEpicCanvas({
  epic,
  tasks,
  allGroups,
  selectedTaskId,
  onSelectTask,
  assistantOpen,
  onAddTask,
  onEditInWorkbench,
  onToggleReady,
  onTogglePause,
  onQueueAll,
  onAskAssistantDraft,
  onSaveSpec,
  onSaveName,
  onSaveGoal,
  onAddDependency,
  onRemoveDependency,
  onChangeCondition
}: PlEpicCanvasProps): React.JSX.Element {
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
      <PlEpicHero
        epic={epic}
        tasks={tasks}
        onToggleReady={onToggleReady}
        saveName={onSaveName}
        saveGoal={onSaveGoal}
      />

      <PlEpicTabBar
        tabs={TABS}
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        taskCount={tasks.length}
        dependencyCount={epic.depends_on?.length ?? 0}
      />

      {activeTab === 'Tasks' ? (
        <div
          role="tabpanel"
          id={`tabpanel-${activeTab}`}
          aria-labelledby={`tab-${activeTab}`}
          style={{ flex: 1, minHeight: 0, display: 'flex' }}
        >
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
      ) : activeTab === 'Dependencies' ? (
        <div
          role="tabpanel"
          id="tabpanel-Dependencies"
          aria-labelledby="tab-Dependencies"
          style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}
        >
          <PlDepsPane
            epicId={epic.id}
            deps={epic.depends_on ?? []}
            groups={allGroups}
            onAdd={onAddDependency}
            onRemove={onRemoveDependency}
            onChangeCondition={onChangeCondition}
          />
        </div>
      ) : activeTab === 'Activity' ? (
        <div
          role="tabpanel"
          id="tabpanel-Activity"
          aria-labelledby="tab-Activity"
          style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}
        >
          <PlActivityFeed tasks={tasks} />
        </div>
      ) : (
        <div
          role="tabpanel"
          id={`tabpanel-${activeTab}`}
          aria-labelledby={`tab-${activeTab}`}
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
  const activeIndex = tabs.indexOf(activeTab)
  const { getTabProps } = useRovingTabIndex({
    count: tabs.length,
    activeIndex,
    onSelect: (index) => {
      const tab = tabs[index]
      if (tab !== undefined) onSelectTab(tab)
    }
  })

  const badgeFor = (tab: Tab): number | null => {
    if (tab === 'Tasks') return taskCount
    if (tab === 'Dependencies') return dependencyCount || null
    return null
  }

  return (
    <div
      role="tablist"
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
      {tabs.map((tab, index) => {
        const isActive = tab === activeTab
        const badge = badgeFor(tab)
        const rovingProps = getTabProps(index)
        return (
          <button
            key={tab}
            role="tab"
            id={`tab-${tab}`}
            aria-selected={isActive}
            aria-controls={isActive ? `tabpanel-${tab}` : undefined}
            onClick={() => onSelectTab(tab)}
            tabIndex={rovingProps.tabIndex}
            onKeyDown={rovingProps.onKeyDown}
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
