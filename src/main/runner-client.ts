/**
 * Runner client — HTTP client for the task-runner's Runner API.
 * All agent operations are proxied through the task-runner instead of
 * being executed locally via the Agent SDK.
 */
import { getSetting } from './settings'

interface RunnerConfig {
  url: string
  apiKey: string
}

function getRunnerConfig(): RunnerConfig {
  const runnersJson = getSetting('runners')
  const runners = runnersJson
    ? JSON.parse(runnersJson)
    : [{ url: 'http://127.0.0.1:18799', apiKey: '' }]
  return runners[0]
}

async function runnerFetch(path: string, opts?: RequestInit): Promise<Response> {
  const { url, apiKey } = getRunnerConfig()
  return fetch(`${url}${path}`, {
    ...opts,
    headers: {
      ...opts?.headers,
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      'Content-Type': 'application/json'
    }
  })
}

export async function listAgents(): Promise<unknown> {
  const res = await runnerFetch('/agents')
  if (!res.ok) {
    throw new Error(`listAgents failed: ${res.status} ${await res.text()}`)
  }
  return res.json()
}

export async function getAgent(id: string): Promise<unknown> {
  const res = await runnerFetch(`/agents/${id}`)
  if (!res.ok) return null
  return res.json()
}

export async function steerAgent(
  agentId: string,
  message: string
): Promise<{ ok: boolean; error?: string }> {
  const res = await runnerFetch(`/agents/${agentId}/steer`, {
    method: 'POST',
    body: JSON.stringify({ message })
  })
  if (!res.ok) {
    throw new Error(`steerAgent failed: ${res.status} ${await res.text()}`)
  }
  return res.json()
}

export async function killAgent(agentId: string): Promise<{ ok: boolean; error?: string }> {
  const res = await runnerFetch(`/agents/${agentId}/kill`, { method: 'POST' })
  if (!res.ok) {
    throw new Error(`killAgent failed: ${res.status} ${await res.text()}`)
  }
  return res.json()
}

export function getAgentLogUrl(agentId: string): string {
  const { url, apiKey } = getRunnerConfig()
  return `${url}/agents/${agentId}/log${apiKey ? `?token=${apiKey}` : ''}`
}

export function getEventsUrl(): string {
  const { url, apiKey } = getRunnerConfig()
  return `${url}/events${apiKey ? `?token=${apiKey}` : ''}`
}
