import React, { useEffect, useState } from 'react'
import { Download } from 'lucide-react'

const ICON_BTN_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  padding: '0 var(--s-2)',
  height: 28,
  background: 'none',
  border: '1px solid var(--line)',
  borderRadius: 'var(--r-md)',
  color: 'var(--fg-2)',
  fontSize: 12,
  cursor: 'pointer',
  flexShrink: 0,
  whiteSpace: 'nowrap',
}

export type ExportFormat = 'json' | 'csv'

interface ExportDropdownProps {
  onExport: (format: ExportFormat) => Promise<void>
}

export function ExportDropdown({ onExport }: ExportDropdownProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    if (!open) return
    const handleOutsideClick = (): void => setOpen(false)
    document.addEventListener('click', handleOutsideClick)
    return () => document.removeEventListener('click', handleOutsideClick)
  }, [open])

  const handleSelect = async (format: ExportFormat): Promise<void> => {
    setOpen(false)
    setExporting(true)
    try {
      await onExport(format)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={(e) => {
          e.stopPropagation()
          setOpen(!open)
        }}
        disabled={exporting}
        title="Export tasks"
        aria-label="Export sprint tasks"
        style={ICON_BTN_STYLE}
      >
        <Download size={13} />
      </button>
      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + var(--s-1))',
            right: 0,
            background: 'var(--surf-2)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--r-md)',
            padding: 'var(--s-1)',
            zIndex: 50,
            minWidth: 80,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
          }}
        >
          {(['json', 'csv'] as const).map((fmt) => (
            <button
              key={fmt}
              onClick={() => void handleSelect(fmt)}
              disabled={exporting}
              style={{
                padding: '3px var(--s-2)',
                background: 'none',
                border: 'none',
                borderRadius: 'var(--r-sm)',
                color: 'var(--fg)',
                fontSize: 12,
                cursor: 'pointer',
                textAlign: 'left',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--surf-3)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'none'
              }}
            >
              {fmt.toUpperCase()}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
