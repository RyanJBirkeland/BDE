/**
 * LocalMcpServerSection — toggle, port, token management, and config copy for the local MCP server.
 */
import './LocalMcpServerSection.css'
import { useCallback, useEffect, useState } from 'react'
import { toast } from '../../stores/toasts'
import { SettingsCard } from './SettingsCard'
import { MCP_DEFAULT_PORT } from '../../../../shared/mcp-constants'

export function LocalMcpServerSection(): React.JSX.Element {
  const [enabled, setEnabled] = useState(false)
  const [port, setPort] = useState(MCP_DEFAULT_PORT)
  const [token, setToken] = useState<string | null>(null)
  const [revealed, setRevealed] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    window.api.settings.get('mcp.enabled').then((v) => setEnabled(v === 'true'))
    window.api.settings.get('mcp.port').then((v) => {
      const parsed = Number(v)
      if (!isNaN(parsed) && parsed > 0) setPort(parsed)
    })
    window.api.mcp.getToken().then(setToken)
  }, [])

  const handleToggleEnabled = useCallback(
    async (next: boolean): Promise<void> => {
      setEnabled(next)
      try {
        await window.api.settings.set('mcp.enabled', next ? 'true' : 'false')
      } catch (e) {
        setEnabled(!next)
        toast.error(`Failed to update MCP enabled: ${e instanceof Error ? e.message : 'Unknown error'}`)
      }
    },
    []
  )

  const handlePortChange = useCallback(async (next: number): Promise<void> => {
    setPort(next)
    try {
      await window.api.settings.set('mcp.port', String(next))
    } catch (e) {
      toast.error(`Failed to update MCP port: ${e instanceof Error ? e.message : 'Unknown error'}`)
    }
  }, [])

  const handleRegenerate = useCallback(async (): Promise<void> => {
    if (
      !confirm(
        'Regenerate the MCP token? Any agent using the old token will be rejected.'
      )
    ) {
      return
    }
    setBusy(true)
    try {
      const next = await window.api.mcp.regenerateToken()
      setToken(next)
      setRevealed(true)
      toast.success('MCP token regenerated')
    } catch (e) {
      toast.error(`Failed to regenerate token: ${e instanceof Error ? e.message : 'Unknown error'}`)
    } finally {
      setBusy(false)
    }
  }, [])

  const handleCopyToken = useCallback((): void => {
    if (!token) return
    navigator.clipboard.writeText(token)
    toast.success('Token copied to clipboard')
  }, [token])

  const handleCopyClaudeConfig = useCallback((): void => {
    if (!token) return
    const snippet = JSON.stringify(
      {
        mcpServers: {
          bde: {
            url: `http://127.0.0.1:${port}/mcp`,
            headers: { Authorization: `Bearer ${token}` }
          }
        }
      },
      null,
      2
    )
    navigator.clipboard.writeText(snippet)
    toast.success('Claude Code config copied to clipboard')
  }, [token, port])

  const maskedToken = token ? token.replace(/./g, '•') : 'loading…'

  return (
    <SettingsCard
      title="Local MCP Server"
      subtitle="Expose BDE tasks and epics to local MCP-speaking agents over http://127.0.0.1"
    >
      <label className="settings-readonly-toggle">
        <input
          type="checkbox"
          className="settings-readonly-toggle__input"
          checked={enabled}
          onChange={(e) => handleToggleEnabled(e.target.checked)}
        />
        <div className="settings-readonly-toggle__body">
          <div className="settings-readonly-toggle__title">Enable MCP server</div>
          <div className="settings-readonly-toggle__desc">
            When enabled, BDE listens on localhost for MCP tool calls from Claude Code, Cursor, and
            compatible agents.
          </div>
        </div>
      </label>

      <div className="settings-field">
        <label className="settings-field__label" htmlFor="mcp-port">
          Port
        </label>
        <input
          id="mcp-port"
          type="number"
          className="settings-field__input"
          min={1024}
          max={65535}
          value={port}
          onChange={(e) => handlePortChange(Number(e.target.value))}
        />
        <div className="settings-field__hint">Port changes take effect immediately.</div>
      </div>

      <div className="settings-field">
        <span className="settings-field__label">Bearer token</span>
        <div className="mcp-token-row">
          <code className="mcp-token">{token !== null ? (revealed ? token : maskedToken) : 'loading…'}</code>
          <button type="button" onClick={() => setRevealed((r) => !r)}>
            {revealed ? 'Hide' : 'Reveal'}
          </button>
          <button type="button" onClick={handleCopyToken} disabled={!token}>
            Copy token
          </button>
          <button type="button" onClick={handleRegenerate} disabled={busy}>
            {busy ? 'Regenerating…' : 'Regenerate'}
          </button>
        </div>
      </div>

      <div className="settings-field">
        <button type="button" onClick={handleCopyClaudeConfig} disabled={!token}>
          Copy Claude Code config
        </button>
      </div>
    </SettingsCard>
  )
}
