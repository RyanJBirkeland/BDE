/**
 * SettingsView -- tab container for application configuration.
 * Each tab renders a self-contained section component.
 */
import { useState } from 'react'
import { Palette, Plug, GitBranch, FileText, Bot, Info } from 'lucide-react'
import { AppearanceSection } from '../components/settings/AppearanceSection'
import { ConnectionsSection } from '../components/settings/ConnectionsSection'
import { RepositoriesSection } from '../components/settings/RepositoriesSection'
import { TaskTemplatesSection } from '../components/settings/TaskTemplatesSection'
import { AgentRuntimeSection } from '../components/settings/AgentRuntimeSection'
import { AboutSection } from '../components/settings/AboutSection'

const TABS = [
  { id: 'connections', label: 'Connections', icon: Plug },
  { id: 'repositories', label: 'Repositories', icon: GitBranch },
  { id: 'templates', label: 'Templates', icon: FileText },
  { id: 'agent', label: 'Agent', icon: Bot },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'about', label: 'About', icon: Info },
] as const

type TabId = (typeof TABS)[number]['id']

const SECTION_MAP: Record<TabId, () => React.JSX.Element> = {
  connections: ConnectionsSection,
  repositories: RepositoriesSection,
  templates: TaskTemplatesSection,
  agent: AgentRuntimeSection,
  appearance: AppearanceSection,
  about: AboutSection,
}

export default function SettingsView(): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<TabId>('connections')
  const ActiveSection = SECTION_MAP[activeTab]

  return (
    <div className="settings-view settings-view--column">
      <div className="settings-view__header">
        <span className="settings-view__header-title">Settings</span>
      </div>
      <div className="settings-view__tabs">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            className={`settings-tab ${activeTab === id ? 'settings-tab--active' : ''}`}
            onClick={() => setActiveTab(id)}
            type="button"
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>
      <div className="settings-view__scroll">
        <ActiveSection />
      </div>
    </div>
  )
}
