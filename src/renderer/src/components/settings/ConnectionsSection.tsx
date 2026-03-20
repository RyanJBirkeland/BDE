/**
 * ConnectionsSection — gateway, GitHub, and task runner credential management.
 */
import { useCallback, useEffect, useState } from 'react'
import { useGatewayStore } from '../../stores/gateway'
import { toast } from '../../stores/toasts'
import { Badge } from '../ui/Badge'
import { CredentialForm, type CredentialField } from './CredentialForm'

const GATEWAY_FIELDS: CredentialField[] = [
  { key: 'url', label: 'URL', type: 'url', placeholder: 'ws://127.0.0.1:18789' },
  { key: 'token', label: 'Token', type: 'token', placeholder: 'Paste gateway token', savedPlaceholder: 'Token saved — enter new value to change' },
]

const GITHUB_FIELDS: CredentialField[] = [
  { key: 'token', label: 'Personal Access Token', type: 'token', placeholder: 'ghp_...', savedPlaceholder: 'Token saved — enter new value to change' },
]

const TASK_RUNNER_FIELDS: CredentialField[] = [
  { key: 'url', label: 'URL', type: 'url', placeholder: 'http://127.0.0.1:18799' },
  { key: 'key', label: 'API Key', type: 'token', placeholder: 'Paste API key', savedPlaceholder: 'Key saved — enter new value to change' },
]

export function ConnectionsSection(): React.JSX.Element {
  const status = useGatewayStore((s) => s.status)
  const reconnect = useGatewayStore((s) => s.reconnect)

  // Gateway state
  const [gwUrl, setGwUrl] = useState('')
  const [gwToken, setGwToken] = useState('')
  const [hasExistingGwToken, setHasExistingGwToken] = useState(false)
  const [gwDirty, setGwDirty] = useState(false)
  const [gwSaving, setGwSaving] = useState(false)
  const [gwTesting, setGwTesting] = useState(false)
  const [gwTestResult, setGwTestResult] = useState<'success' | 'error' | null>(null)

  // GitHub state
  const [ghToken, setGhToken] = useState('')
  const [hasExistingGhToken, setHasExistingGhToken] = useState(false)
  const [ghDirty, setGhDirty] = useState(false)
  const [ghTesting, setGhTesting] = useState(false)
  const [ghTestResult, setGhTestResult] = useState<'success' | 'error' | null>(null)

  // Task Runner state
  const [trUrl, setTrUrl] = useState('')
  const [trKey, setTrKey] = useState('')
  const [hasExistingTrKey, setHasExistingTrKey] = useState(false)
  const [trDirty, setTrDirty] = useState(false)
  const [trTesting, setTrTesting] = useState(false)
  const [trTestResult, setTrTestResult] = useState<'success' | 'error' | null>(null)

  // Load initial values
  useEffect(() => {
    window.api.getGatewayUrl().then(({ url, hasToken }) => {
      setGwUrl(url)
      setHasExistingGwToken(hasToken)
    })
    window.api.settings.get('github.token').then((v) => {
      setHasExistingGhToken(!!v)
    })
    window.api.settings.get('taskRunner.url').then((v) => {
      setTrUrl(v ?? 'http://127.0.0.1:18799')
    })
    window.api.settings.get('taskRunner.apiKey').then((v) => {
      setHasExistingTrKey(!!v)
    })
  }, [])

  // Gateway handlers
  const handleGwChange = useCallback((key: string, value: string) => {
    if (key === 'url') setGwUrl(value)
    else setGwToken(value)
    setGwDirty(true)
    setGwTestResult(null)
  }, [])

  const handleGwSave = useCallback(async () => {
    setGwSaving(true)
    try {
      await window.api.saveGatewayConfig(gwUrl, gwToken || undefined)
      setGwDirty(false)
      if (gwToken) setHasExistingGwToken(true)
      setGwToken('')
      toast.success('Gateway config saved')
      await reconnect()
    } catch {
      toast.error('Failed to save gateway config')
    } finally {
      setGwSaving(false)
    }
  }, [gwUrl, gwToken, reconnect])

  const handleGwTest = useCallback(async () => {
    setGwTesting(true)
    setGwTestResult(null)
    try {
      await window.api.testGatewayConnection(gwUrl, gwToken || undefined)
      setGwTestResult('success')
      toast.success('Gateway connection OK')
    } catch {
      setGwTestResult('error')
      toast.error('Gateway connection failed')
    } finally {
      setGwTesting(false)
    }
  }, [gwUrl, gwToken])

  // GitHub handlers
  const handleGhChange = useCallback((_key: string, value: string) => {
    setGhToken(value)
    setGhDirty(true)
    setGhTestResult(null)
  }, [])

  const handleGhSave = useCallback(async () => {
    if (!ghToken) return
    await window.api.settings.set('github.token', ghToken)
    setHasExistingGhToken(true)
    setGhToken('')
    setGhDirty(false)
    toast.success('GitHub token saved')
  }, [ghToken])

  const handleGhTest = useCallback(async () => {
    setGhTesting(true)
    setGhTestResult(null)
    try {
      const result = await window.api.github.fetch('/user')
      setGhTestResult(result.ok ? 'success' : 'error')
      if (result.ok) {
        toast.success('GitHub token valid')
      } else {
        toast.error('GitHub token invalid')
      }
    } catch {
      setGhTestResult('error')
      toast.error('GitHub test failed')
    } finally {
      setGhTesting(false)
    }
  }, [])

  // Task Runner handlers
  const handleTrChange = useCallback((key: string, value: string) => {
    if (key === 'url') setTrUrl(value)
    else setTrKey(value)
    setTrDirty(true)
    setTrTestResult(null)
  }, [])

  const handleTrSave = useCallback(async () => {
    await window.api.settings.set('taskRunner.url', trUrl)
    if (trKey) {
      await window.api.settings.set('taskRunner.apiKey', trKey)
      setHasExistingTrKey(true)
      setTrKey('')
    }
    setTrDirty(false)
    toast.success('Task runner config saved')
  }, [trUrl, trKey])

  const handleTrTest = useCallback(async () => {
    setTrTesting(true)
    setTrTestResult(null)
    try {
      await window.api.sprint.healthCheck()
      setTrTestResult('success')
      toast.success('Task runner reachable')
    } catch {
      setTrTestResult('error')
      toast.error('Task runner unreachable')
    } finally {
      setTrTesting(false)
    }
  }, [])

  return (
    <section className="settings-section">
      <h2 className="settings-section__title bde-section-title">Connections</h2>

      <CredentialForm
        title="Gateway"
        fields={GATEWAY_FIELDS}
        values={{ url: gwUrl, token: gwToken }}
        hasExisting={{ token: hasExistingGwToken }}
        onChange={handleGwChange}
        onSave={handleGwSave}
        onTest={handleGwTest}
        dirty={gwDirty}
        saveDisabled={!gwDirty || gwSaving || !gwUrl || (!gwToken && !hasExistingGwToken)}
        testDisabled={gwTesting || !gwUrl || (!gwToken && !hasExistingGwToken)}
        saving={gwSaving}
        testing={gwTesting}
        testResult={gwTestResult}
        statusBadge={
          <Badge
            variant={status === 'connected' ? 'success' : status === 'error' ? 'danger' : status === 'connecting' ? 'warning' : 'muted'}
            size="sm"
          >
            {status.charAt(0).toUpperCase() + status.slice(1)}
          </Badge>
        }
      />

      <CredentialForm
        title="GitHub"
        fields={GITHUB_FIELDS}
        values={{ token: ghToken }}
        hasExisting={{ token: hasExistingGhToken }}
        onChange={handleGhChange}
        onSave={handleGhSave}
        onTest={handleGhTest}
        dirty={ghDirty}
        saveDisabled={!ghDirty || !ghToken}
        testDisabled={ghTesting || (!ghToken && !hasExistingGhToken)}
        saving={false}
        testing={ghTesting}
        testResult={ghTestResult}
      />

      <CredentialForm
        title="Task Runner"
        fields={TASK_RUNNER_FIELDS}
        values={{ url: trUrl, key: trKey }}
        hasExisting={{ key: hasExistingTrKey }}
        onChange={handleTrChange}
        onSave={handleTrSave}
        onTest={handleTrTest}
        dirty={trDirty}
        saveDisabled={!trDirty}
        testDisabled={trTesting || !hasExistingTrKey}
        saving={false}
        testing={trTesting}
        testResult={trTestResult}
      />
    </section>
  )
}
