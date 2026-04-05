/**
 * SettingsView -- sidebar + content layout for application configuration.
 * Each section renders a self-contained component. Sections are grouped by category.
 */
import { useState } from 'react'
import { motion } from 'framer-motion'
import {
  Palette,
  Link,
  GitBranch,
  FileText,
  Cpu,
  DollarSign,
  Brain,
  Shield,
  Webhook,
  Keyboard
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
import { WebhooksSection } from '../components/settings/WebhooksSection'
import { KeybindingsSettings } from '../components/settings/KeybindingsSettings'
import { VARIANTS, SPRINGS, REDUCED_TRANSITION, useReducedMotion } from '../lib/motion'

const SECTIONS: SettingsSection[] = [
  { id: 'connections', label: 'Connections', icon: Link, category: 'Account' },
  { id: 'permissions', label: 'Permissions', icon: Shield, category: 'Account' },
  { id: 'repositories', label: 'Repositories', icon: GitBranch, category: 'Projects' },
  { id: 'templates', label: 'Templates', icon: FileText, category: 'Projects' },
  { id: 'agentManager', label: 'Agent Manager', icon: Cpu, category: 'Pipeline' },
  { id: 'webhooks', label: 'Webhooks', icon: Webhook, category: 'Pipeline' },
  { id: 'cost', label: 'Cost & Usage', icon: DollarSign, category: 'Pipeline' },
  { id: 'appearance', label: 'Appearance', icon: Palette, category: 'App' },
  { id: 'keybindings', label: 'Keybindings', icon: Keyboard, category: 'App' },
  { id: 'memory', label: 'Memory', icon: Brain, category: 'App' }
]

type SectionId = (typeof SECTIONS)[number]['id']

const SECTION_MAP: Record<string, () => React.JSX.Element> = {
  connections: ConnectionsSection,
  permissions: AgentPermissionsSection,
  repositories: RepositoriesSection,
  templates: TaskTemplatesSection,
  agentManager: AgentManagerSection,
  webhooks: WebhooksSection,
  cost: CostSection,
  memory: MemorySection,
  appearance: AppearanceSection,
  keybindings: KeybindingsSettings
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
  webhooks: { title: 'Webhooks', subtitle: 'External event notifications', wide: false },
  cost: { title: 'Cost & Usage', subtitle: 'Agent execution costs and history', wide: true },
  memory: { title: 'Memory', subtitle: 'Agent memory files', wide: true },
  appearance: { title: 'Appearance', subtitle: 'Theme and visual preferences', wide: false },
  keybindings: { title: 'Keybindings', subtitle: 'Customize keyboard shortcuts', wide: false }
}

export default function SettingsView(): React.JSX.Element {
  const reduced = useReducedMotion()
  const [activeId, setActiveId] = useState<SectionId>('connections')
  const ActiveSection = SECTION_MAP[activeId]
  const meta = SECTION_META[activeId]

  return (
    <div className="stg-layout">
      <SettingsSidebar sections={SECTIONS} activeId={activeId} onSelect={setActiveId} />
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
      <div aria-live="polite" className="sr-only">
        {meta.title} settings
      </div>
    </div>
  )
}
