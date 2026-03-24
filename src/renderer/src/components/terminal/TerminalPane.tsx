import { useEffect, useRef } from 'react'
import { Terminal } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import { SearchAddon } from 'xterm-addon-search'
import { WebLinksAddon } from 'xterm-addon-web-links'
import { useTerminalStore } from '../../stores/terminal'
import { useThemeStore } from '../../stores/theme'
import { getTerminalTheme } from '../../lib/terminal-theme'
import { tokens } from '../../design-system/tokens'
import 'xterm/css/xterm.css'

/** Module-level map so TerminalView can call clear() on the active instance */
const terminalInstances = new Map<string, Terminal>()
const searchAddons = new Map<string, SearchAddon>()

export function clearTerminal(tabId: string): void {
  terminalInstances.get(tabId)?.clear()
}

export function getSearchAddon(tabId: string): SearchAddon | undefined {
  return searchAddons.get(tabId)
}

interface TerminalPaneProps {
  tabId: string
  shell?: string
  visible: boolean
}

export function TerminalPane({ tabId, shell, visible }: TerminalPaneProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const cleanupRef = useRef<(() => void) | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const termRef = useRef<Terminal | null>(null)

  useEffect(() => {
    if (!containerRef.current) return

    const term = new Terminal({
      theme: getTerminalTheme(),
      fontFamily: tokens.font.code,
      fontSize: 13,
      lineHeight: 1.5,
      cursorBlink: true
    })

    const fitAddon = new FitAddon()
    const searchAddon = new SearchAddon()
    term.loadAddon(fitAddon)
    term.loadAddon(searchAddon)
    term.loadAddon(new WebLinksAddon())
    term.open(containerRef.current)
    // Defer initial fit so the container has settled to its final layout size
    requestAnimationFrame(() => fitAddon.fit())

    termRef.current = term
    fitAddonRef.current = fitAddon
    terminalInstances.set(tabId, term)
    searchAddons.set(tabId, searchAddon)

    window.api.terminal.create({ cols: term.cols, rows: term.rows, shell }).then((id) => {
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
      terminalInstances.delete(tabId)
      searchAddons.delete(tabId)
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

  // React to theme changes for existing terminal instances
  useEffect(() => {
    const unsub = useThemeStore.subscribe(() => {
      const term = termRef.current
      if (term) {
        requestAnimationFrame(() => {
          term.options.theme = getTerminalTheme()
        })
      }
    })
    return unsub
  }, [])

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        padding: tokens.space[2],
        boxSizing: 'border-box',
        display: visible ? 'block' : 'none'
      }}
    />
  )
}
