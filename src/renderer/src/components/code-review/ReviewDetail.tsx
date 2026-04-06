import { useCodeReviewStore, type ReviewTab } from '../../stores/codeReview'
import { ChangesTab } from './ChangesTab'
import { CommitsTab } from './CommitsTab'
import { ConversationTab } from './ConversationTab'
import { EmptyState } from '../ui/EmptyState'
import { useRovingTabIndex } from '../../hooks/useRovingTabIndex'

const TABS: { key: ReviewTab; label: string }[] = [
  { key: 'changes', label: 'Changes' },
  { key: 'commits', label: 'Commits' },
  { key: 'conversation', label: 'Conversation' }
]

export function ReviewDetail(): React.JSX.Element {
  const selectedTaskId = useCodeReviewStore((s) => s.selectedTaskId)
  const activeTab = useCodeReviewStore((s) => s.activeTab)
  const setActiveTab = useCodeReviewStore((s) => s.setActiveTab)

  const activeIndex = TABS.findIndex((tab) => tab.key === activeTab)
  const { getTabProps } = useRovingTabIndex({
    count: TABS.length,
    activeIndex,
    onSelect: (index) => setActiveTab(TABS[index].key)
  })

  if (!selectedTaskId) {
    return (
      <div className="cr-detail cr-detail--empty">
        <EmptyState
          title="No task selected"
          description="Select a task from the review queue to inspect changes, commits, and conversation."
        />
      </div>
    )
  }

  return (
    <div className="cr-detail">
      <div className="cr-detail__tabs" role="tablist">
        {TABS.map((tab, index) => (
          <button
            key={tab.key}
            role="tab"
            aria-selected={activeTab === tab.key}
            className={`cr-detail__tab${activeTab === tab.key ? ' cr-detail__tab--active' : ''}`}
            onClick={() => setActiveTab(tab.key)}
            {...getTabProps(index)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="cr-detail__content" role="tabpanel">
        {activeTab === 'changes' && <ChangesTab />}
        {activeTab === 'commits' && <CommitsTab />}
        {activeTab === 'conversation' && <ConversationTab />}
      </div>
    </div>
  )
}
