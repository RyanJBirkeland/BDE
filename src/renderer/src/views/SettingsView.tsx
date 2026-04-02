/**
 * SettingsView -- tab container for application configuration.
 * Each tab renders a self-contained section component.
 */
import { useState } from 'react'
import { motion } from 'framer-motion'
import { Palette, Plug, GitBranch, FileText, Bot, Info, Cpu, DollarSign, Brain, Shield } from 'lucide-react'
import { AppearanceSection } from '../components/settings/AppearanceSection'
import { ConnectionsSection } from '../components/settings/ConnectionsSection'
import { RepositoriesSection } from '../components/settings/RepositoriesSection'
import { TaskTemplatesSection } from '../components/settings/TaskTemplatesSection'
import { AgentRuntimeSection } from '../components/settings/AgentRuntimeSection'
import { AgentPermissionsSection } from '../components/settings/AgentPermissionsSection'
import { AgentManagerSection } from '../components/settings/AgentManagerSection'
import { CostSection } from '../components/settings/CostSection'
import { MemorySection } from '../components/settings/MemorySection'
import { AboutSection } from '../components/settings/AboutSection'
import { VARIANTS, SPRINGS, REDUCED_TRANSITION, useReducedMotion } from '../lib/motion'

const TABS = [
  { id: 'connections', label: 'Connections', icon: Plug },
  { id: 'repositories', label: 'Repositories', icon: GitBranch },
  { id: 'templates', label: 'Templates', icon: FileText },
  { id: 'agent', label: 'Agent', icon: Bot },
  { id: 'permissions', label: 'Permissions', icon: Shield },
  { id: 'agentManager', label: 'Agent Manager', icon: Cpu },
  { id: 'cost', label: 'Cost', icon: DollarSign },
  { id: 'memory', label: 'Memory', icon: Brain },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'about', label: 'About', icon: Info }
] as const

type TabId = (typeof TABS)[number]['id']

const SECTION_MAP: Record<TabId, () => React.JSX.Element> = {
  connections: ConnectionsSection,
  repositories: RepositoriesSection,
  templates: TaskTemplatesSection,
  agent: AgentRuntimeSection,
  permissions: AgentPermissionsSection,
  agentManager: AgentManagerSection,
  cost: CostSection,
  memory: MemorySection,
  appearance: AppearanceSection,
  about: AboutSection
}

export default function SettingsView(): React.JSX.Element {
  const reduced = useReducedMotion()
  const [activeTab, setActiveTab] = useState<TabId>('connections')
  const ActiveSection = SECTION_MAP[activeTab]

  const handleTabKeyDown = (e: React.KeyboardEvent, index: number) => {
    let nextIndex = index
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault()
      nextIndex = (index + 1) % TABS.length
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault()
      nextIndex = (index - 1 + TABS.length) % TABS.length
    } else if (e.key === 'Home') {
      e.preventDefault()
      nextIndex = 0
    } else if (e.key === 'End') {
      e.preventDefault()
      nextIndex = TABS.length - 1
    } else {
      return
    }
    setActiveTab(TABS[nextIndex].id)
    // Focus the newly active tab button
    const tabList = e.currentTarget.parentElement
    const nextButton = tabList?.children[nextIndex] as HTMLElement | undefined
    nextButton?.focus()
  }

  return (
    <motion.div
      className="settings-view settings-view--column"
      variants={VARIANTS.fadeIn}
      initial="initial"
      animate="animate"
      transition={reduced ? REDUCED_TRANSITION : SPRINGS.snappy}
    >
      <div className="settings-view__header">
        <span className="settings-view__header-title text-gradient-aurora">Settings</span>
      </div>
      <div className="settings-view__tabs" role="tablist" aria-label="Settings sections">
        {TABS.map(({ id, label, icon: Icon }, index) => (
          <button
            key={id}
            role="tab"
            aria-selected={activeTab === id}
            tabIndex={activeTab === id ? 0 : -1}
            className={`settings-tab ${activeTab === id ? 'settings-tab--active' : ''}`}
            onClick={() => setActiveTab(id)}
            onKeyDown={(e) => handleTabKeyDown(e, index)}
            type="button"
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>
      <div
        className="settings-view__scroll"
        role="tabpanel"
        aria-label={`${TABS.find((t) => t.id === activeTab)?.label} settings`}
      >
        <ActiveSection />
      </div>
    </motion.div>
  )
}
