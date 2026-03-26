import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import {
  LayoutDashboard,
  Terminal,
  SquareTerminal,
  GitBranch,
  GitPullRequest,
  Brain,
  DollarSign,
  Settings,
  GitCommitHorizontal,
  Pin,
  type LucideIcon
} from 'lucide-react'
import { GlassPanel } from '../neon/GlassPanel'
import type { View } from '../../stores/ui'

// Icon mapping from ActivityBar NAV_ITEMS
const VIEW_ICONS: Record<View, LucideIcon> = {
  dashboard: LayoutDashboard,
  agents: Terminal,
  ide: SquareTerminal,
  sprint: GitBranch,
  'pr-station': GitPullRequest,
  git: GitCommitHorizontal,
  memory: Brain,
  cost: DollarSign,
  settings: Settings,
  'task-workbench': GitBranch // Using GitBranch as fallback for task-workbench
}

const VIEW_LABELS: Record<View, string> = {
  dashboard: 'Dashboard',
  agents: 'Agents',
  ide: 'IDE',
  sprint: 'Task Pipeline',
  'pr-station': 'PR Station',
  git: 'Source Control',
  memory: 'Memory',
  cost: 'Cost Tracker',
  settings: 'Settings',
  'task-workbench': 'Task Workbench'
}

interface OverflowMenuProps {
  unpinnedViews: View[]
  anchorRect: DOMRect | null
  onPin: (view: View) => void
  onActivate: (view: View) => void
  onClose: () => void
}

export function OverflowMenu({
  unpinnedViews,
  anchorRect,
  onPin,
  onActivate,
  onClose
}: OverflowMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)

  // Handle click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }

    // Add small delay to avoid immediate close from the trigger click
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside)
    }, 0)

    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [onClose])

  // Handle Escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [onClose])

  if (!anchorRect) return null

  // Position above the trigger button
  const style: React.CSSProperties = {
    top: anchorRect.top - 8, // 8px gap above
    left: anchorRect.left + anchorRect.width / 2,
    transform: 'translate(-50%, -100%)'
  }

  const handleItemClick = (view: View) => {
    onActivate(view)
    onClose()
  }

  const handlePinClick = (e: React.MouseEvent, view: View) => {
    e.stopPropagation()
    onPin(view)
  }

  const handleCustomizeClick = () => {
    onActivate('settings')
    onClose()
  }

  return createPortal(
    <div ref={menuRef} className="overflow-menu" style={style}>
      <GlassPanel accent="purple" style={{ padding: '8px' }}>
        {unpinnedViews.length === 0 ? (
          <div
            style={{
              padding: '12px',
              fontSize: '11px',
              color: 'rgba(255, 255, 255, 0.4)',
              textAlign: 'center'
            }}
          >
            All views are pinned
          </div>
        ) : (
          <div>
            {unpinnedViews.map((view) => {
              const Icon = VIEW_ICONS[view]
              const label = VIEW_LABELS[view]

              return (
                <div
                  key={view}
                  className="overflow-menu__item"
                  onClick={() => handleItemClick(view)}
                >
                  <Icon size={14} strokeWidth={1.5} />
                  <span>{label}</span>
                  <button
                    className="overflow-menu__item-pin"
                    onClick={(e) => handlePinClick(e, view)}
                    aria-label={`Pin ${label} to sidebar`}
                    title="Pin to sidebar"
                  >
                    <Pin size={12} />
                  </button>
                </div>
              )
            })}
          </div>
        )}

        <div
          style={{
            marginTop: '8px',
            paddingTop: '8px',
            borderTop: '1px solid rgba(191, 90, 242, 0.2)'
          }}
        >
          <button
            className="overflow-menu__item"
            onClick={handleCustomizeClick}
            style={{
              width: '100%',
              textAlign: 'left',
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              fontSize: '11px',
              fontStyle: 'italic'
            }}
          >
            <Settings size={14} strokeWidth={1.5} />
            <span>Customize sidebar...</span>
          </button>
        </div>
      </GlassPanel>
    </div>,
    document.body
  )
}
