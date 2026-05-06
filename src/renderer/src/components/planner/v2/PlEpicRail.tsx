import { useMemo } from 'react'
import type { TaskGroup } from '../../../../../shared/types'

function sanitizeCssColor(value: string | null | undefined): string {
  if (!value) return 'var(--accent)'
  // Allow: CSS named colors (letters only) and hex colors with valid lengths:
  // #RGB (3), #RGBA (4), #RRGGBB (6), #RRGGBBAA (8). {3,8} would also pass
  // 5- and 7-digit hex strings which are not valid CSS.
  const isValidHex =
    /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value)
  const isValidNamed = /^[a-zA-Z]+$/.test(value)
  return isValidHex || isValidNamed ? value : 'var(--accent)'
}

interface PlEpicRailProps {
  groups: TaskGroup[]
  selectedId: string | null
  onSelect: (id: string) => void
  onNewEpic: () => void
}

const STATUS_LABEL: Record<TaskGroup['status'], string> = {
  ready: 'Ready',
  'in-pipeline': 'In pipeline',
  draft: 'Draft',
  completed: 'Done'
}

const STATUS_COLOR: Record<TaskGroup['status'], string> = {
  ready: 'var(--st-running)',
  'in-pipeline': 'var(--st-review)',
  draft: 'var(--fg-3)',
  completed: 'var(--st-done)'
}

export function PlEpicRail({ groups, selectedId, onSelect, onNewEpic }: PlEpicRailProps): React.JSX.Element {
  const { activeGroups: active, completedGroups: completed } = useMemo(() => {
    const activeGroups: TaskGroup[] = []
    const completedGroups: TaskGroup[] = []
    groups.forEach((g) => (g.status === 'completed' ? completedGroups : activeGroups).push(g))
    return { activeGroups, completedGroups }
  }, [groups])

  return (
    <div
      style={{
        width: 320,
        minWidth: 320,
        borderRight: '1px solid var(--line)',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg)'
      }}
    >
      <div
        style={{
          height: 38,
          padding: '0 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          borderBottom: '1px solid var(--line)',
          flexShrink: 0
        }}
      >
        <span
          style={{
            fontSize: 11,
            color: 'var(--fg-3)',
            textTransform: 'uppercase',
            letterSpacing: '0.08em'
          }}
        >
          Epics
        </span>
        <span style={{ fontSize: 11, color: 'var(--fg-4)', fontFamily: 'var(--font-mono)' }}>
          {active.length}
        </span>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '8px 8px 12px' }}>
        {active.map((epic) => (
          <PlEpicRailItem
            key={epic.id}
            epic={epic}
            selected={epic.id === selectedId}
            onSelect={onSelect}
          />
        ))}

        {completed.length > 0 && (
          <>
            <div
              style={{
                marginTop: 14,
                padding: '6px 12px',
                fontSize: 10,
                color: 'var(--fg-4)',
                textTransform: 'uppercase',
                letterSpacing: '0.08em'
              }}
            >
              Completed · {completed.length}
            </div>
            {completed.map((epic) => (
              <PlEpicRailItem
                key={epic.id}
                epic={epic}
                selected={epic.id === selectedId}
                onSelect={onSelect}
              />
            ))}
          </>
        )}
      </div>

      <div
        style={{
          height: 44,
          padding: '0 12px',
          display: 'flex',
          alignItems: 'center',
          borderTop: '1px solid var(--line)',
          flexShrink: 0
        }}
      >
        <button
          onClick={onNewEpic}
          style={{
            height: 28,
            width: '100%',
            borderRadius: 6,
            background: 'var(--surf-1)',
            border: '1px dashed var(--line-2)',
            color: 'var(--fg-2)',
            fontSize: 12,
            cursor: 'pointer'
          }}
        >
          + New epic
        </button>
      </div>
    </div>
  )
}

function PlEpicRailItem({
  epic,
  selected,
  onSelect
}: {
  epic: TaskGroup
  selected: boolean
  onSelect: (id: string) => void
}): React.JSX.Element {
  return (
    <button
      onClick={() => onSelect(epic.id)}
      style={{
        position: 'relative',
        width: '100%',
        textAlign: 'left',
        display: 'flex',
        gap: 12,
        alignItems: 'flex-start',
        padding: '10px 12px',
        background: selected ? 'var(--surf-2)' : 'transparent',
        border: '1px solid ' + (selected ? 'var(--line-2)' : 'transparent'),
        borderRadius: 8,
        cursor: 'pointer',
        marginBottom: 4
      }}
    >
      {selected && (
        <span
          style={{
            position: 'absolute',
            left: -1,
            top: 8,
            bottom: 8,
            width: 2,
            background: sanitizeCssColor(epic.accent_color),
            borderRadius: 2
          }}
        />
      )}

      <EpicIcon icon={epic.icon} accent={sanitizeCssColor(epic.accent_color)} size={30} fontSize={13} />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            style={{
              fontSize: 13,
              fontWeight: 500,
              color: 'var(--fg)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              flex: 1
            }}
          >
            {epic.name}
          </span>
          <span
            style={{
              fontSize: 10,
              color: STATUS_COLOR[epic.status],
              fontFamily: 'var(--font-mono)'
            }}
          >
            {STATUS_LABEL[epic.status]}
          </span>
        </div>

        {epic.goal && (
          <div
            style={{
              marginTop: 2,
              fontSize: 11,
              color: 'var(--fg-3)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}
          >
            {epic.goal}
          </div>
        )}
      </div>
    </button>
  )
}

export function EpicIcon({
  icon,
  accent,
  size,
  fontSize
}: {
  icon: string
  accent: string
  size: number
  fontSize: number
}): React.JSX.Element {
  const safeAccent = sanitizeCssColor(accent)
  return (
    <div
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: `color-mix(in srgb, ${safeAccent} 12%, transparent)`,
        color: safeAccent,
        border: `1px solid color-mix(in srgb, ${safeAccent} 30%, transparent)`,
        borderRadius: 7,
        fontSize,
        fontWeight: 600,
        fontFamily: 'var(--font-mono)'
      }}
    >
      {icon}
    </div>
  )
}
