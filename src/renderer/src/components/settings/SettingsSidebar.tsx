/**
 * SettingsSidebar — categorized sidebar navigation for Settings.
 * Groups sections by category, supports keyboard navigation with roving tabindex.
 */
import { useRef } from 'react'
import type { LucideIcon } from 'lucide-react'

export interface SettingsSection {
  id: string
  label: string
  icon: LucideIcon
  category: string
}

interface SettingsSidebarProps {
  sections: SettingsSection[]
  activeId: string
  onSelect: (id: string) => void
}

/** Groups sections by category, preserving array order */
function groupByCategory(sections: SettingsSection[]): Array<{ category: string; items: SettingsSection[] }> {
  const seen: string[] = []
  const map: Record<string, SettingsSection[]> = {}

  for (const section of sections) {
    if (!map[section.category]) {
      seen.push(section.category)
      map[section.category] = []
    }
    map[section.category].push(section)
  }

  return seen.map(category => ({ category, items: map[category] }))
}

export function SettingsSidebar({ sections, activeId, onSelect }: SettingsSidebarProps): JSX.Element {
  const navRef = useRef<HTMLElement>(null)
  const groups = groupByCategory(sections)

  function getAllItems(): HTMLElement[] {
    if (!navRef.current) return []
    return Array.from(navRef.current.querySelectorAll<HTMLElement>('[role="link"]'))
  }

  function handleKeyDown(e: React.KeyboardEvent, id: string): void {
    const items = getAllItems()
    const currentIndex = items.findIndex(el => el.dataset.id === id)
    if (currentIndex === -1) return

    let nextIndex: number | null = null

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        nextIndex = currentIndex < items.length - 1 ? currentIndex + 1 : 0
        break
      case 'ArrowUp':
        e.preventDefault()
        nextIndex = currentIndex > 0 ? currentIndex - 1 : items.length - 1
        break
      case 'Home':
        e.preventDefault()
        nextIndex = 0
        break
      case 'End':
        e.preventDefault()
        nextIndex = items.length - 1
        break
      case 'Enter':
        e.preventDefault()
        onSelect(id)
        return
    }

    if (nextIndex !== null) {
      const nextItem = items[nextIndex]
      const nextId = nextItem.dataset.id
      if (nextId) {
        onSelect(nextId)
        nextItem.focus()
      }
    }
  }

  return (
    <nav ref={navRef} role="navigation" aria-label="Settings sections">
      {groups.map(({ category, items }) => (
        <div key={category} className="stg-sidebar__group">
          <div className="stg-sidebar__category">{category}</div>
          {items.map(section => {
            const Icon = section.icon
            const isActive = section.id === activeId
            return (
              <div
                key={section.id}
                role="link"
                data-id={section.id}
                className={`stg-sidebar__item${isActive ? ' stg-sidebar__item--active' : ''}`}
                aria-current={isActive ? 'page' : undefined}
                tabIndex={isActive ? 0 : -1}
                onClick={() => onSelect(section.id)}
                onKeyDown={e => handleKeyDown(e, section.id)}
              >
                <Icon size={14} />
                <span>{section.label}</span>
              </div>
            )
          })}
        </div>
      ))}
    </nav>
  )
}
