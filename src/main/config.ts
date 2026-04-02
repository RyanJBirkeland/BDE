import { getSetting } from './settings'

export function getGitHubToken(): string | null {
  return getSetting('github.token') ?? process.env['GITHUB_TOKEN'] ?? null
}

export function getEventRetentionDays(): number {
  return parseInt(getSetting('agent.eventRetentionDays') ?? '30', 10)
}
