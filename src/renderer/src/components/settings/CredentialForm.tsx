/**
 * CredentialForm — reusable form for managing credential fields
 * (URL + token combos) with test-connection and save actions.
 */
import { useCallback, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { toast } from '../../stores/toasts'

export interface CredentialField {
  key: string
  label: string
  type: 'url' | 'token'
  placeholder?: string
  /** Placeholder shown when a saved value already exists */
  savedPlaceholder?: string
}

export interface CredentialFormProps {
  title: string
  fields: CredentialField[]
  values: Record<string, string>
  hasExisting: Record<string, boolean>
  onChange: (key: string, value: string) => void
  onSave: () => Promise<void>
  onTest?: () => Promise<void>
  dirty: boolean
  saveDisabled?: boolean
  testDisabled?: boolean
  saving?: boolean
  testing?: boolean
  testResult?: 'success' | 'error' | null
  /** Extra content rendered between the title and first field */
  statusBadge?: React.ReactNode
}

export function CredentialForm({
  title,
  fields,
  values,
  hasExisting,
  onChange,
  onSave,
  onTest,
  dirty,
  saveDisabled,
  testDisabled,
  saving,
  testing,
  testResult,
  statusBadge
}: CredentialFormProps): React.JSX.Element {
  const [visible, setVisible] = useState<Record<string, boolean>>({})

  const toggleVisibility = useCallback((key: string) => {
    setVisible((prev) => ({ ...prev, [key]: !prev[key] }))
  }, [])

  const handleSave = useCallback(async () => {
    try {
      await onSave()
      toast.success('Settings saved')
    } catch {
      toast.error('Failed to save settings')
    }
  }, [onSave])

  return (
    <div className="settings-connection">
      <span className="settings-connection__label">{title}</span>

      {fields.map((field) => (
        <label key={field.key} className="settings-field">
          <span className="settings-field__label">
            {field.label}
            {!hasExisting[field.key] && (
              <span
                style={{ color: 'var(--bde-color-danger, #ef4444)', marginLeft: 2 }}
                aria-hidden="true"
              >
                *
              </span>
            )}
          </span>
          {field.type === 'token' ? (
            <div className="settings-field__password">
              <input
                className="settings-field__input"
                type={visible[field.key] ? 'text' : 'password'}
                value={values[field.key] ?? ''}
                onChange={(e) => onChange(field.key, e.target.value)}
                placeholder={
                  hasExisting[field.key]
                    ? (field.savedPlaceholder ?? 'Token saved — enter new value to change')
                    : (field.placeholder ?? '')
                }
              />
              <Button
                variant="icon"
                size="sm"
                className="settings-field__toggle"
                onClick={() => toggleVisibility(field.key)}
                title={visible[field.key] ? 'Hide' : 'Show'}
                aria-label={visible[field.key] ? 'Hide' : 'Show'}
                type="button"
              >
                {visible[field.key] ? <EyeOff size={14} /> : <Eye size={14} />}
              </Button>
            </div>
          ) : (
            <input
              className="settings-field__input"
              type="text"
              value={values[field.key] ?? ''}
              onChange={(e) => onChange(field.key, e.target.value)}
              placeholder={field.placeholder ?? ''}
            />
          )}
        </label>
      ))}

      <div className="settings-field__row">
        {statusBadge ? (
          <div className="settings-field__status">{statusBadge}</div>
        ) : (
          <div className="settings-field__status" />
        )}
        <div className="settings-field__actions">
          {onTest && (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={onTest}
                disabled={testDisabled ?? testing}
                loading={testing}
                type="button"
              >
                Test
              </Button>
              {testResult && (
                <Badge variant={testResult === 'success' ? 'success' : 'danger'} size="sm">
                  {testResult === 'success' ? 'OK' : 'Failed'}
                </Badge>
              )}
            </>
          )}
          <Button
            variant="primary"
            size="sm"
            onClick={handleSave}
            disabled={saveDisabled ?? (!dirty || saving)}
            loading={saving}
            type="button"
          >
            Save
          </Button>
        </div>
      </div>
    </div>
  )
}
