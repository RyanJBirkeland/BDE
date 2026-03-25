import { useState, useRef } from 'react';
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
  MoreHorizontal,
  type LucideIcon,
} from 'lucide-react';
import { SidebarItem } from './SidebarItem';
import { OverflowMenu } from './OverflowMenu';
import { useSidebarStore, getUnpinnedViews } from '../../stores/sidebar';
import { usePanelLayoutStore, getOpenViews } from '../../stores/panelLayout';
import { useUIStore, type View } from '../../stores/ui';

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
  'task-workbench': GitBranch, // Using GitBranch as fallback for task-workbench
};

const VIEW_LABELS: Record<View, string> = {
  dashboard: 'Dashboard',
  agents: 'Agents',
  ide: 'IDE',
  sprint: 'Sprint Center',
  'pr-station': 'PR Station',
  git: 'Source Control',
  memory: 'Memory',
  cost: 'Cost Tracker',
  settings: 'Settings',
  'task-workbench': 'Task Workbench',
};

const VIEW_SHORTCUTS: Record<View, string> = {
  dashboard: '⌘1',
  agents: '⌘2',
  ide: '⌘3',
  sprint: '⌘4',
  'pr-station': '⌘5',
  git: '⌘6',
  memory: '⌘7',
  cost: '⌘8',
  settings: '⌘9',
  'task-workbench': '⌘0',
};

interface NeonSidebarProps {
  model?: string;
}

export function NeonSidebar({ model }: NeonSidebarProps) {
  const [overflowOpen, setOverflowOpen] = useState(false);
  const moreButtonRef = useRef<HTMLButtonElement>(null);

  const pinnedViews = useSidebarStore((s) => s.pinnedViews);
  const { pinView, unpinView } = useSidebarStore();

  const root = usePanelLayoutStore((s) => s.root);
  const focusedPanelId = usePanelLayoutStore((s) => s.focusedPanelId);
  const { splitPanel, addTab } = usePanelLayoutStore();

  const activeView = useUIStore((s) => s.activeView);
  const setView = useUIStore((s) => s.setView);

  const openViews = getOpenViews(root);
  const unpinnedViews = getUnpinnedViews(pinnedViews);

  const handleActivate = (view: View) => {
    setView(view);
  };

  const handleContextAction = (action: string, view: View) => {
    switch (action) {
      case 'unpin':
        unpinView(view);
        break;
      case 'open-right':
        if (focusedPanelId) {
          splitPanel(focusedPanelId, 'horizontal', view);
        }
        break;
      case 'open-below':
        if (focusedPanelId) {
          splitPanel(focusedPanelId, 'vertical', view);
        }
        break;
      case 'open-tab':
        if (focusedPanelId) {
          addTab(focusedPanelId, view);
        }
        break;
      case 'close-all':
        // TODO: Implement close all functionality
        break;
    }
  };

  const handlePin = (view: View) => {
    pinView(view);
  };

  const toggleOverflow = () => {
    setOverflowOpen(!overflowOpen);
  };

  return (
    <div className="neon-sidebar">
      <nav className="neon-sidebar__nav">
        {pinnedViews.map((view) => {
          const Icon = VIEW_ICONS[view];
          const label = VIEW_LABELS[view];
          const shortcut = VIEW_SHORTCUTS[view];
          const isActive = activeView === view;
          const isOpen = openViews.includes(view) && !isActive;

          return (
            <SidebarItem
              key={view}
              view={view}
              icon={<Icon size={18} strokeWidth={1.5} />}
              label={label}
              shortcut={shortcut}
              isActive={isActive}
              isOpen={isOpen}
              onActivate={handleActivate}
              onContextAction={handleContextAction}
            />
          );
        })}

        {/* More button */}
        {unpinnedViews.length > 0 && (
          <button
            ref={moreButtonRef}
            className="sidebar-item"
            onClick={toggleOverflow}
            aria-label="More views"
            aria-expanded={overflowOpen}
          >
            <MoreHorizontal size={18} strokeWidth={1.5} />
          </button>
        )}
      </nav>

      <div className="neon-sidebar__footer">
        {model && (
          <div className="sidebar-model-badge">
            {model}
          </div>
        )}
      </div>

      {/* Overflow menu */}
      {overflowOpen && moreButtonRef.current && (
        <OverflowMenu
          unpinnedViews={unpinnedViews}
          anchorRect={moreButtonRef.current.getBoundingClientRect()}
          onPin={handlePin}
          onActivate={(view) => {
            handleActivate(view);
            setOverflowOpen(false);
          }}
          onClose={() => setOverflowOpen(false)}
        />
      )}
    </div>
  );
}
