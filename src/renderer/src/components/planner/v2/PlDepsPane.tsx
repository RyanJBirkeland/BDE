import { useState } from 'react'
import type { TaskGroup, EpicDependency } from '../../../../../shared/types'

interface PlDepsPaneProps {
  epicId: string
  deps: EpicDependency[]
  groups: TaskGroup[]
  onAdd: (upstreamId: string) => Promise<void>
  onRemove: (upstreamId: string) => Promise<void>
  onChangeCondition: (upstreamId: string, condition: EpicDependency['condition']) => Promise<void>
}

const CONDITION_LABEL: Record<EpicDependency['condition'], string> = {
  on_success: 'on success',
  always: 'always',
  manual: 'manual'
}

export function nextDependencyCondition(
  current: EpicDependency['condition']
): EpicDependency['condition'] {
  if (current === 'on_success') return 'always'
  if (current === 'always') return 'manual'
  return 'on_success'
}

export function PlDepsPane({
  epicId,
  deps,
  groups,
  onAdd,
  onRemove,
  onChangeCondition
}: PlDepsPaneProps): React.JSX.Element {
  const [cycleError, setCycleError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  const epicLookup = new Map(groups.map((g) => [g.id, g]))
  const addableEpics = groups
    .filter((g) => g.id !== epicId && !deps.some((d) => d.id === g.id))
    .sort((a, b) => a.name.localeCompare(b.name))

  async function handleCycleCondition(dep: EpicDependency): Promise<void> {
    setCycleError(null)
    try {
      await onChangeCondition(dep.id, nextDependencyCondition(dep.condition))
    } catch (err) {
      setCycleError(err instanceof Error ? err.message : String(err))
    }
  }

  async function handleRemove(upstreamId: string): Promise<void> {
    setCycleError(null)
    await onRemove(upstreamId)
  }

  async function handleAdd(upstreamId: string): Promise<void> {
    setCycleError(null)
    setAdding(true)
    try {
      await onAdd(upstreamId)
    } catch {
      setCycleError('Adding this dependency would create a cycle.')
    } finally {
      setAdding(false)
    }
  }

  return (
    <div
      style={{
        padding: '20px 28px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        overflowY: 'auto',
        flex: 1
      }}
    >
      {deps.length === 0 && addableEpics.length === 0 && (
        <span style={{ fontSize: 12, color: 'var(--fg-4)' }}>
          No dependencies — this epic runs independently.
        </span>
      )}

      {deps.map((dep) => {
        const upstream = epicLookup.get(dep.id)
        return (
          <div
            key={dep.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '8px 12px',
              background: 'var(--surf-1)',
              border: '1px solid var(--line)',
              borderRadius: 6
            }}
          >
            <span
              style={{
                flex: 1,
                fontSize: 13,
                color: upstream ? 'var(--fg)' : 'var(--fg-4)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}
            >
              {upstream ? upstream.name : dep.id}
            </span>
            <button
              onClick={() => void handleCycleCondition(dep)}
              title="Click to change condition"
              style={{
                height: 22,
                padding: '0 8px',
                border: '1px solid var(--line)',
                borderRadius: 999,
                background: 'transparent',
                fontSize: 11,
                color: 'var(--fg-2)',
                cursor: 'pointer',
                fontFamily: 'var(--font-mono)',
                flexShrink: 0
              }}
            >
              {CONDITION_LABEL[dep.condition]}
            </button>
            <button
              onClick={() => void handleRemove(dep.id)}
              aria-label="Remove dependency"
              style={{
                width: 22,
                height: 22,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: 'none',
                background: 'transparent',
                color: 'var(--fg-3)',
                cursor: 'pointer',
                fontSize: 18,
                lineHeight: 1,
                flexShrink: 0
              }}
            >
              ×
            </button>
          </div>
        )
      })}

      {cycleError && (
        <span style={{ fontSize: 11, color: 'var(--st-failed)' }}>{cycleError}</span>
      )}

      {addableEpics.length > 0 && (
        <select
          defaultValue=""
          disabled={adding}
          onChange={(e) => {
            const val = e.target.value
            if (val) {
              void handleAdd(val)
              e.target.value = ''
            }
          }}
          style={{
            marginTop: 4,
            height: 30,
            padding: '0 8px',
            border: '1px solid var(--line)',
            borderRadius: 6,
            background: 'var(--surf-1)',
            color: 'var(--fg-2)',
            fontSize: 12,
            cursor: adding ? 'not-allowed' : 'pointer'
          }}
        >
          <option value="" disabled>
            + Add dependency…
          </option>
          {addableEpics.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      )}
    </div>
  )
}
