import { safeHandle } from '../ipc-utils'
import { getSettingJson, setSettingJson } from '../settings'
import { DEFAULT_TASK_TEMPLATES } from '../../shared/constants'
import type { TaskTemplate } from '../../shared/types'

function getTemplates(): TaskTemplate[] {
  const custom = getSettingJson<TaskTemplate[]>('templates.custom') ?? []
  const overrides = getSettingJson<Record<string, string>>('templates.overrides') ?? {}

  const builtIn = DEFAULT_TASK_TEMPLATES.map((t) => ({
    name: t.name,
    promptPrefix: overrides[t.name] ?? t.promptPrefix,
    isBuiltIn: true as const,
  }))

  return [...builtIn, ...custom.map((t) => ({ ...t, isBuiltIn: false as const }))]
}

export function registerTemplateHandlers(): void {
  safeHandle('templates:list', () => getTemplates())

  safeHandle('templates:save', (_e, template: TaskTemplate) => {
    if (template.isBuiltIn) {
      // Store as override
      const overrides = getSettingJson<Record<string, string>>('templates.overrides') ?? {}
      overrides[template.name] = template.promptPrefix
      setSettingJson('templates.overrides', overrides)
    } else {
      // Store in custom list
      const custom = getSettingJson<TaskTemplate[]>('templates.custom') ?? []
      const idx = custom.findIndex((t) => t.name === template.name)
      if (idx >= 0) {
        custom[idx] = { name: template.name, promptPrefix: template.promptPrefix }
      } else {
        custom.push({ name: template.name, promptPrefix: template.promptPrefix })
      }
      setSettingJson('templates.custom', custom)
    }

    // Also update legacy settings key for backward compatibility
    syncLegacyTemplates()
  })

  safeHandle('templates:delete', (_e, name: string) => {
    const custom = getSettingJson<TaskTemplate[]>('templates.custom') ?? []
    setSettingJson('templates.custom', custom.filter((t) => t.name !== name))
    syncLegacyTemplates()
  })

  safeHandle('templates:reset', (_e, name: string) => {
    const overrides = getSettingJson<Record<string, string>>('templates.overrides') ?? {}
    delete overrides[name]
    setSettingJson('templates.overrides', overrides)
    syncLegacyTemplates()
  })
}

/** Keep legacy `task.templates` setting in sync for existing consumers. */
function syncLegacyTemplates(): void {
  const all = getTemplates()
  setSettingJson('task.templates', all.map(({ name, promptPrefix }) => ({ name, promptPrefix })))
}
