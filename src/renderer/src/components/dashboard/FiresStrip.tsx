import React from 'react'

interface LoadSaturation {
  load1: number
  cpuCount: number
}

interface FiresStripProps {
  failed: number
  blocked: number
  stuck: number
  loadSaturated: LoadSaturation | null
  onClick: (kind: 'failed' | 'blocked' | 'stuck' | 'load') => void
}

const buttonStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: '#fca5a5',
  cursor: 'pointer',
  fontFamily: 'inherit',
  fontSize: 'inherit',
  padding: '2px 6px',
  borderRadius: 3
}

export function FiresStrip({
  failed,
  blocked,
  stuck,
  loadSaturated,
  onClick
}: FiresStripProps): React.JSX.Element | null {
  if (failed === 0 && blocked === 0 && stuck === 0 && loadSaturated === null) {
    return null
  }

  const segments: React.JSX.Element[] = []

  if (failed > 0) {
    segments.push(
      <button
        key="failed"
        type="button"
        aria-label={`${failed} failed task${failed === 1 ? '' : 's'}`}
        style={buttonStyle}
        onClick={() => onClick('failed')}
      >
        {failed} failed
      </button>
    )
  }

  if (blocked > 0) {
    segments.push(
      <button
        key="blocked"
        type="button"
        aria-label={`${blocked} blocked task${blocked === 1 ? '' : 's'}`}
        style={buttonStyle}
        onClick={() => onClick('blocked')}
      >
        {blocked} blocked
      </button>
    )
  }

  if (stuck > 0) {
    segments.push(
      <button
        key="stuck"
        type="button"
        aria-label={`${stuck} stuck task${stuck === 1 ? '' : 's'}`}
        style={buttonStyle}
        onClick={() => onClick('stuck')}
      >
        {stuck} stuck &gt;1h
      </button>
    )
  }

  if (loadSaturated) {
    segments.push(
      <button
        key="load"
        type="button"
        aria-label={`load ${Math.round(loadSaturated.load1)} / ${loadSaturated.cpuCount} cores`}
        style={buttonStyle}
        onClick={() => onClick('load')}
      >
        load {Math.round(loadSaturated.load1)} / {loadSaturated.cpuCount} cores
      </button>
    )
  }

  const withSeparators: React.JSX.Element[] = []
  segments.forEach((seg, i) => {
    if (i > 0) {
      withSeparators.push(
        <span key={`sep-${i}`} style={{ color: '#7f1d1d' }} aria-hidden="true">
          ·
        </span>
      )
    }
    withSeparators.push(seg)
  })

  return (
    <div
      role="region"
      aria-label="Dashboard alerts"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '8px 12px',
        marginBottom: 10,
        background: 'rgba(220, 38, 38, 0.08)',
        border: '1px solid #7f1d1d',
        borderRadius: 6,
        fontFamily: 'ui-monospace, Menlo, monospace',
        fontSize: 11,
        color: '#fca5a5'
      }}
    >
      <strong style={{ marginRight: 6 }}>⚠ ATTENTION</strong>
      {withSeparators}
    </div>
  )
}
