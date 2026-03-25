import { useState, type ReactNode } from 'react';
import { NeonTooltip } from '../neon/NeonTooltip';
import type { View } from '../../stores/ui';

interface SidebarItemProps {
  view: View;
  icon: ReactNode;
  label: string;
  shortcut: string;
  isActive: boolean;
  isOpen: boolean;
  onActivate: (view: View) => void;
  onContextAction: (action: string, view: View) => void;
}

interface ContextMenuState {
  x: number;
  y: number;
}

export function SidebarItem({
  view,
  icon,
  label,
  shortcut,
  isActive,
  isOpen,
  onActivate,
  onContextAction,
}: SidebarItemProps) {
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY });
  };

  const closeContextMenu = () => {
    setContextMenu(null);
  };

  const handleMenuAction = (action: string) => {
    onContextAction(action, view);
    closeContextMenu();
  };

  return (
    <>
      <NeonTooltip label={label} shortcut={shortcut}>
        <button
          draggable
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('application/bde-panel', JSON.stringify({ viewKey: view }));
            e.dataTransfer.setData('text/plain', label);
          }}
          className={`sidebar-item${isActive ? ' sidebar-item--active' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            onActivate(view);
          }}
          onContextMenu={handleContextMenu}
          aria-label={label}
          aria-current={isActive ? 'page' : undefined}
        >
          {icon}
          {isOpen && !isActive && <span className="sidebar-item__open-dot" />}
        </button>
      </NeonTooltip>

      {contextMenu && (
        <>
          {/* Invisible overlay to catch outside clicks */}
          <div
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 999,
            }}
            onClick={closeContextMenu}
            onContextMenu={(e) => {
              e.preventDefault();
              closeContextMenu();
            }}
          />
          <div
            role="menu"
            aria-label="Sidebar item options"
            style={{
              position: 'fixed',
              top: contextMenu.y,
              left: contextMenu.x,
              zIndex: 1000,
              backgroundColor: 'rgba(10, 0, 21, 0.9)',
              border: '1px solid var(--neon-purple-border)',
              borderRadius: '8px',
              backdropFilter: 'blur(16px) saturate(180%)',
              padding: '4px 0',
              minWidth: '200px',
            }}
          >
            {[
              { label: 'Unpin from sidebar', action: 'unpin' },
              { label: 'Open to Right', action: 'open-right' },
              { label: 'Open Below', action: 'open-below' },
              { label: 'Open in New Tab', action: 'open-tab' },
              { label: 'Close All', action: 'close-all' },
            ].map(({ label: menuLabel, action }) => (
              <button
                key={action}
                role="menuitem"
                onClick={(e) => {
                  e.stopPropagation();
                  handleMenuAction(action);
                }}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '8px 12px',
                  background: 'none',
                  border: 'none',
                  color: 'rgba(255, 255, 255, 0.6)',
                  fontSize: '12px',
                  cursor: 'pointer',
                  transition: 'background 100ms ease, color 100ms ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--neon-purple-surface)';
                  e.currentTarget.style.color = '#fff';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'none';
                  e.currentTarget.style.color = 'rgba(255, 255, 255, 0.6)';
                }}
              >
                {menuLabel}
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
}
