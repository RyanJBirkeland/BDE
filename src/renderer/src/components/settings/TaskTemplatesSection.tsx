/**
 * TaskTemplatesSection — manage named prompt prefix templates for sprint tasks.
 */
import { useCallback, useEffect, useState } from 'react'
import { Trash2, Plus, RotateCcw } from 'lucide-react'
import { toast } from '../../stores/toasts'
import { Button } from '../ui/Button'
import type { TaskTemplate } from '../../../../shared/types'
import { SettingsCard } from './SettingsCard'

export function TaskTemplatesSection(): React.JSX.Element {
  const [templates, setTemplates] = useState<TaskTemplate[]>([])
  const [loaded, setLoaded] = useState(false)
  const [pendingChanges, setPendingChanges] = useState<Map<number, TaskTemplate>>(new Map())

  useEffect(() => {
    window.api.templates.list().then((list) => {
      setTemplates(list)
      setLoaded(true)
    })
  }, [])

  // Debounced save: 500ms after last change
  useEffect(() => {
    if (pendingChanges.size === 0) return
    const timer = setTimeout(async () => {
      for (const [, template] of pendingChanges) {
        await window.api.templates.save(template)
      }
      const list = await window.api.templates.list()
      setTemplates(list)
      setPendingChanges(new Map())
    }, 500)
    return () => clearTimeout(timer)
  }, [pendingChanges])

  const handleNameChange = useCallback(
    (index: number, name: string) => {
      const t = templates[index]
      if (!t) return
      const updated: TaskTemplate = { ...t, name }
      // Update local state immediately
      setTemplates((prev) => prev.map((item, i) => (i === index ? updated : item)))
      // Mark as pending for debounced save
      setPendingChanges((prev) => new Map(prev).set(index, updated))
    },
    [templates]
  )

  const handlePrefixChange = useCallback(
    (index: number, promptPrefix: string) => {
      const t = templates[index]
      if (!t) return
      const updated: TaskTemplate = { ...t, promptPrefix }
      // Update local state immediately
      setTemplates((prev) => prev.map((item, i) => (i === index ? updated : item)))
      // Mark as pending for debounced save
      setPendingChanges((prev) => new Map(prev).set(index, updated))
    },
    [templates]
  )

  const handleAdd = useCallback(async () => {
    await window.api.templates.save({ name: '', promptPrefix: '' })
    const list = await window.api.templates.list()
    setTemplates(list)
  }, [])

  const handleRemove = useCallback(
    async (index: number) => {
      const t = templates[index]
      if (!t) return
      if (t.isBuiltIn) {
        await window.api.templates.reset(t.name)
        toast.success('Template reset to default')
      } else {
        await window.api.templates.delete(t.name)
        toast.success('Template removed')
      }
      const list = await window.api.templates.list()
      setTemplates(list)
    },
    [templates]
  )

  if (!loaded) {
    return (
      <div className="bde-loading-skeleton">
        <div className="bde-loading-skeleton__row" />
        <div className="bde-loading-skeleton__row" />
        <div className="bde-loading-skeleton__row" />
      </div>
    )
  }

  return (
    <div className="settings-cards-list">
      {templates.length === 0 && (
        <span className="settings-repos__empty">No templates configured</span>
      )}

      {templates.map((t, i) => (
        <SettingsCard
          key={i}
          title={t.name || 'Untitled Template'}
          status={t.isBuiltIn ? { label: 'Built-in', variant: 'info' } : undefined}
          footer={
            <div className="settings-card-footer-actions">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleRemove(i)}
                title={t.isBuiltIn ? 'Reset to default' : 'Remove template'}
                aria-label={t.isBuiltIn ? 'Reset to default' : 'Remove template'}
                type="button"
              >
                {t.isBuiltIn ? <RotateCcw size={14} /> : <Trash2 size={14} />}
                {t.isBuiltIn ? 'Reset' : 'Delete'}
              </Button>
            </div>
          }
        >
          <div className="settings-template-row">
            <input
              className="settings-field__input"
              placeholder="Template name"
              aria-label="Template name"
              value={t.name}
              disabled={!!t.isBuiltIn}
              onChange={(e) => handleNameChange(i, e.target.value)}
            />
            <textarea
              className="settings-field__input settings-template-row__prefix"
              placeholder="Prompt prefix..."
              aria-label="Prompt prefix"
              value={t.promptPrefix}
              onChange={(e) => handlePrefixChange(i, e.target.value)}
              rows={3}
            />
          </div>
        </SettingsCard>
      ))}

      <Button
        variant="ghost"
        size="sm"
        onClick={handleAdd}
        type="button"
        className="settings-repos__add-btn"
      >
        <Plus size={14} /> Add Template
      </Button>
    </div>
  )
}
