/**
 * TaskTemplatesSection — manage named prompt prefix templates for sprint tasks.
 */
import { useCallback, useEffect, useState } from 'react'
import { Trash2, Plus, RotateCcw } from 'lucide-react'
import { toast } from '../../stores/toasts'
import { Button } from '../ui/Button'
import type { TaskTemplate } from '../../../../shared/types'

export function TaskTemplatesSection(): React.JSX.Element {
  const [templates, setTemplates] = useState<TaskTemplate[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    window.api.templates.list().then((list) => {
      setTemplates(list)
      setLoaded(true)
    })
  }, [])

  const saveTemplate = useCallback(async (template: TaskTemplate) => {
    await window.api.templates.save(template)
    const list = await window.api.templates.list()
    setTemplates(list)
  }, [])

  const handleNameChange = useCallback(
    (index: number, name: string) => {
      const t = templates[index]
      saveTemplate({ ...t, name })
    },
    [templates, saveTemplate]
  )

  const handlePrefixChange = useCallback(
    (index: number, promptPrefix: string) => {
      const t = templates[index]
      saveTemplate({ ...t, promptPrefix })
    },
    [templates, saveTemplate]
  )

  const handleAdd = useCallback(async () => {
    await window.api.templates.save({ name: '', promptPrefix: '' })
    const list = await window.api.templates.list()
    setTemplates(list)
  }, [])

  const handleRemove = useCallback(
    async (index: number) => {
      const t = templates[index]
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

  if (!loaded) return <section className="settings-section" />

  return (
    <section className="settings-section">
      <h2 className="settings-section__title bde-section-title">Task Templates</h2>
      <div className="settings-templates">
        {templates.map((t, i) => (
          <div key={i} className="settings-template-row">
            <div className="settings-template-row__header">
              <input
                className="settings-field__input"
                placeholder="Template name"
                value={t.name}
                disabled={!!t.isBuiltIn}
                onChange={(e) => handleNameChange(i, e.target.value)}
              />
              {t.isBuiltIn && (
                <span
                  style={{
                    fontSize: '11px',
                    padding: '2px 6px',
                    borderRadius: '9999px',
                    background: 'var(--bde-info-dim)',
                    color: 'var(--bde-info)'
                  }}
                >
                  Built-in
                </span>
              )}
              <Button
                variant="icon"
                size="sm"
                onClick={() => handleRemove(i)}
                title={t.isBuiltIn ? 'Reset to default' : 'Remove template'}
                aria-label={t.isBuiltIn ? 'Reset to default' : 'Remove template'}
                type="button"
              >
                {t.isBuiltIn ? <RotateCcw size={14} /> : <Trash2 size={14} />}
              </Button>
            </div>
            <textarea
              className="settings-field__input settings-template-row__prefix"
              placeholder="Prompt prefix..."
              value={t.promptPrefix}
              onChange={(e) => handlePrefixChange(i, e.target.value)}
              rows={3}
            />
          </div>
        ))}
        {templates.length === 0 && (
          <span className="settings-repos__empty">No templates configured</span>
        )}
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={handleAdd}
        type="button"
        className="settings-repos__add-btn"
      >
        <Plus size={14} /> Add Template
      </Button>
    </section>
  )
}
