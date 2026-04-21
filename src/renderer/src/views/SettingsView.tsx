/**
 * SettingsView -- sidebar + content layout for application configuration.
 * Each section renders a self-contained component. Sections are grouped by category.
 */
import './SettingsView.css'
import { motion } from 'framer-motion'
import { Palette, Link, GitBranch, FileText, Cpu, Brain, Info, Network } from 'lucide-react'
import { SettingsSidebar } from '../components/settings/SettingsSidebar'
import type { SettingsSection } from '../components/settings/SettingsSidebar'
import { SettingsPageHeader } from '../components/settings/SettingsPageHeader'
import { AppearanceSection } from '../components/settings/AppearanceSection'
import { ConnectionsSection } from '../components/settings/ConnectionsSection'
import { RepositoriesSection } from '../components/settings/RepositoriesSection'
import { TaskTemplatesSection } from '../components/settings/TaskTemplatesSection'
import { AgentManagerSection } from '../components/settings/AgentManagerSection'
import { ModelsSection } from '../components/settings/ModelsSection'
import { MemorySection } from '../components/settings/MemorySection'
import { AboutSection } from '../components/settings/AboutSection'
import { VARIANTS, SPRINGS, REDUCED_TRANSITION, useReducedMotion } from '../lib/motion'
import { useSettingsNavStore } from '../stores/settingsNav'
import { ErrorBoundary } from '../components/ui/ErrorBoundary'

const SECTIONS: SettingsSection[] = [
  { id: 'connections', label: 'Connections', icon: Link, category: 'Account' },
  { id: 'repositories', label: 'Repositories', icon: GitBranch, category: 'Projects' },
  { id: 'templates', label: 'Templates', icon: FileText, category: 'Projects' },
  { id: 'agents', label: 'Agents', icon: Cpu, category: 'Pipeline' },
  { id: 'models', label: 'Models', icon: Network, category: 'Pipeline' },
  { id: 'memory', label: 'Memory', icon: Brain, category: 'App' },
  { id: 'appearance', label: 'Appearance & Shortcuts', icon: Palette, category: 'App' },
  { id: 'about', label: 'About & Usage', icon: Info, category: 'App' }
]

const SECTION_MAP: Record<string, () => React.JSX.Element> = {
  connections: ConnectionsSection,
  repositories: RepositoriesSection,
  templates: TaskTemplatesSection,
  agents: AgentManagerSection,
  models: ModelsSection,
  memory: MemorySection,
  appearance: AppearanceSection,
  about: AboutSection
}

const SECTION_META: Record<string, { title: string; subtitle: string; wide: boolean }> = {
  connections: {
    title: 'Connections',
    subtitle: 'Manage authentication tokens, API access, and webhooks',
    wide: false
  },
  repositories: { title: 'Repositories', subtitle: 'Configure project repositories', wide: false },
  templates: { title: 'Templates', subtitle: 'Task prompt templates', wide: false },
  agents: {
    title: 'Agents',
    subtitle: 'Pipeline execution settings and agent permissions',
    wide: false
  },
  models: {
    title: 'Models',
    subtitle: 'Route each agent type to Claude or a local model',
    wide: false
  },
  memory: { title: 'Memory', subtitle: 'Agent memory files', wide: true },
  appearance: {
    title: 'Appearance & Shortcuts',
    subtitle: 'Theme, notifications, and keyboard shortcuts',
    wide: false
  },
  about: { title: 'About & Usage', subtitle: 'Version info and API usage history', wide: true }
}

export default function SettingsView(): React.JSX.Element {
  const reduced = useReducedMotion()
  const activeId = useSettingsNavStore((s) => s.activeSection)
  const setActiveSection = useSettingsNavStore((s) => s.setActiveSection)
  const ActiveSection = SECTION_MAP[activeId]
  const meta = SECTION_META[activeId]

  const handleSelect = (id: string): void => {
    setActiveSection(id as typeof activeId)
  }

  if (!ActiveSection || !meta) {
    return (
      <ErrorBoundary name="SettingsView">
        <div className="stg-layout">
          <div className="view-layout">
            <SettingsSidebar sections={SECTIONS} activeId={activeId} onSelect={handleSelect} />
          </div>
        </div>
      </ErrorBoundary>
    )
  }

  return (
    <ErrorBoundary name="SettingsView">
      <div className="stg-layout">
        <div className="view-layout">
          <SettingsSidebar sections={SECTIONS} activeId={activeId} onSelect={handleSelect} />
          <motion.div
            className="stg-content view-content"
            key={activeId}
            variants={VARIANTS.fadeIn}
            initial="initial"
            animate="animate"
            transition={reduced ? REDUCED_TRANSITION : SPRINGS.snappy}
          >
            <div className={`stg-content__inner${meta.wide ? ' stg-content__inner--wide' : ''}`}>
              <SettingsPageHeader title={meta.title} subtitle={meta.subtitle} />
              <ActiveSection />
            </div>
          </motion.div>
        </div>
        <div aria-live="polite" className="sr-only">
          {meta.title} settings
        </div>
      </div>
    </ErrorBoundary>
  )
}
