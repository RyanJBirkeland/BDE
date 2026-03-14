import { useEffect, useRef } from 'react'
import { Terminal } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import { WebLinksAddon } from 'xterm-addon-web-links'
import { useTerminalStore } from '../../stores/terminal'
import 'xterm/css/xterm.css'

interface TerminalPaneProps {
  tabId: string
  visible: boolean
}

export function TerminalPane({ tabId, visible }: TerminalPaneProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const cleanupRef = useRef<(() => void) | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const termRef = useRef<Terminal | null>(null)

  useEffect(() => {
    if (!containerRef.current) return

    const term = new Terminal({
      theme: {
        background: '#0A0A0A',
        foreground: '#E8E8E8',
        cursor: '#00D37F',
        selectionBackground: 'rgba(0, 211, 127, 0.3)',
        black: '#1A1A1A',
        brightBlack: '#555555'
      },
      fontFamily: '"JetBrains Mono", "Fira Code", monospace',
      fontSize: 13,
      lineHeight: 1.5,
      cursorBlink: true
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.loadAddon(new WebLinksAddon())
    term.open(containerRef.current)
    fitAddon.fit()

    termRef.current = term
    fitAddonRef.current = fitAddon

    window.api.terminal.create({ cols: term.cols, rows: term.rows }).then((id) => {
      useTerminalStore.getState().setPtyId(tabId, id)

      const removeDataListener = window.api.terminal.onData(id, (data) => term.write(data))
      term.onData((data) => window.api.terminal.write(id, data))

      const container = containerRef.current!
      const observer = new ResizeObserver(() => {
        fitAddon.fit()
        window.api.terminal.resize(id, term.cols, term.rows)
      })
      observer.observe(container)

      window.api.terminal.onExit(id, () => {
        term.write('\r\n[Process exited]\r\n')
      })

      cleanupRef.current = (): void => {
        removeDataListener()
        observer.disconnect()
        window.api.terminal.kill(id)
      }
    })

    return () => {
      cleanupRef.current?.()
      term.dispose()
      termRef.current = null
      fitAddonRef.current = null
    }
  }, [tabId])

  useEffect(() => {
    if (!visible || !fitAddonRef.current || !termRef.current) return
    const timer = setTimeout(() => {
      fitAddonRef.current?.fit()
      termRef.current?.focus()
    }, 50)
    return () => clearTimeout(timer)
  }, [visible])

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        padding: '8px',
        boxSizing: 'border-box',
        display: visible ? 'block' : 'none'
      }}
    />
  )
}
