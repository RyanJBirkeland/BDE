/**
 * SettingsView -- sidebar + content layout for application configuration.
 * Each section renders a self-contained component. Sections are grouped by category.
 */
import { motion } from 'framer-motion'
import { Group, Panel, Separator } from 'react-resizable-panels'
import {
  Palette,
  Link,
  GitBranch,
  FileText,
  Cpu,
  DollarSign,
  Brain,
  Shield,
  Info,
  Keyboard,
  Bell
} from 'lucide-react'
import { SettingsSidebar } from '../components/settings/SettingsSidebar'
import type { SettingsSection } from '../components/settings/SettingsSidebar'
import { SettingsPageHeader } from '../components/settings/SettingsPageHeader'
import { AppearanceSection } from '../components/settings/AppearanceSection'
import { ConnectionsSection } from '../components/settings/ConnectionsSection'
import { RepositoriesSection } from '../components/settings/RepositoriesSection'
import { TaskTemplatesSection } from '../components/settings/TaskTemplatesSection'
import { AgentPermissionsSection } from '../components/settings/AgentPermissionsSection'
import { AgentManagerSection } from '../components/settings/AgentManagerSection'
import { CostSection } from '../components/settings/CostSection'
import { MemorySection } from '../components/settings/MemorySection'
import { AboutSection } from '../components/settings/AboutSection'
import { KeybindingsSettings } from '../components/settings/KeybindingsSettings'
import { NotificationsSection } from '../components/settings/NotificationsSection'
import { VARIANTS, SPRINGS, REDUCED_TRANSITION, useReducedMotion } from '../lib/motion'
import { useSettingsNavStore } from '../stores/settingsNav'

const SECTIONS: SettingsSection[] = [
  { id: 'connections', label: 'Connections', icon: Link, category: 'Account' },
  { id: 'permissions', label: 'Permissions', icon: Shield, category: 'Account' },
  { id: 'repositories', label: 'Repositories', icon: GitBranch, category: 'Projects' },
  { id: 'templates', label: 'Templates', icon: FileText, category: 'Projects' },
  { id: 'agentManager', label: 'Agent Manager', icon: Cpu, category: 'Pipeline' },
  { id: 'cost', label: 'Cost & Usage', icon: DollarSign, category: 'Pipeline' },
  { id: 'appearance', label: 'Appearance', icon: Palette, category: 'App' },
  { id: 'notifications', label: 'Notifications', icon: Bell, category: 'App' },
  { id: 'keybindings', label: 'Keybindings', icon: Keyboard, category: 'App' },
  { id: 'memory', label: 'Memory', icon: Brain, category: 'App' },
  { id: 'about', label: 'About', icon: Info, category: 'App' }
]

const SECTION_MAP: Record<string, () => React.JSX.Element> = {
  connections: ConnectionsSection,
  permissions: AgentPermissionsSection,
  repositories: RepositoriesSection,
  templates: TaskTemplatesSection,
  agentManager: AgentManagerSection,
  cost: CostSection,
  memory: MemorySection,
  appearance: AppearanceSection,
  keybindings: KeybindingsSettings,
  notifications: NotificationsSection,
  about: AboutSection
}

const SECTION_META: Record<string, { title: string; subtitle: string; wide: boolean }> = {
  connections: {
    title: 'Connections',
    subtitle: 'Manage authentication tokens and API access',
    wide: false
  },
  permissions: { title: 'Permissions', subtitle: 'Tool access and security rules', wide: false },
  repositories: { title: 'Repositories', subtitle: 'Configure project repositories', wide: false },
  templates: { title: 'Templates', subtitle: 'Task prompt templates', wide: false },
  agentManager: { title: 'Agent Manager', subtitle: 'Pipeline execution settings', wide: false },
  cost: { title: 'Cost & Usage', subtitle: 'Agent execution costs and history', wide: true },
  memory: { title: 'Memory', subtitle: 'Agent memory files', wide: true },
  appearance: { title: 'Appearance', subtitle: 'Theme and visual preferences', wide: false },
  keybindings: { title: 'Keybindings', subtitle: 'Customize keyboard shortcuts', wide: false },
  notifications: {
    title: 'Notifications',
    subtitle: 'Desktop and in-app notification preferences',
    wide: false
  },
  about: { title: 'About', subtitle: 'Version and application info', wide: false }
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

  return (
    <div className="stg-layout">
      <Group orientation="horizontal" style={{ flex: 1, height: '100%' }}>
        <Panel defaultSize={18} minSize={12} maxSize={30}>
          <SettingsSidebar sections={SECTIONS} activeId={activeId} onSelect={handleSelect} />
        </Panel>
        <Separator className="panel-separator" />
        <Panel minSize={50}>
          <motion.div
            className="stg-content"
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
        </Panel>
      </Group>
      <div aria-live="polite" className="sr-only">
        {meta.title} settings
      </div>
    </div>
  )
}
