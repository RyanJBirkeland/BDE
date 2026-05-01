/**
 * Config manager — hot-reload settings and update in-memory AgentManagerConfig.
 *
 * Hot-reloadable: maxConcurrent, maxRuntimeMs, maxTurns.
 * NOT hot-reloadable: worktreeBase, pollIntervalMs (require restart).
 *
 * Extracted from AgentManagerImpl.reloadConfig() so the logic is unit-testable
 * without a full manager instance.
 */

import type { AgentManagerConfig } from './types'
import type { ConcurrencyState } from './concurrency'
import type { RunAgentDeps } from './run-agent'
import type { Logger } from '../logger'
import { getSetting, getSettingJson } from '../settings'
import { setMaxSlots } from './concurrency'

function isValidMaxConcurrent(u: unknown): u is number {
  return typeof u === 'number' && u > 0 && u <= 16
}

// ---------------------------------------------------------------------------
// Deps interface
// ---------------------------------------------------------------------------

export interface ConfigManagerDeps {
  config: AgentManagerConfig
  concurrency: ConcurrencyState
  runAgentDeps: Pick<RunAgentDeps, 'maxTurns'>
  logger: Logger
}

// ---------------------------------------------------------------------------
// Hot-reload
// ---------------------------------------------------------------------------

/**
 * Re-read settings from the settings store and hot-update the in-memory
 * config for fields that are safe to change at runtime.
 *
 * Returns which fields changed and which require restart.
 */
export function reloadConfiguration(deps: ConfigManagerDeps): {
  updated: string[]
  requiresRestart: string[]
} {
  const updated: string[] = []
  const requiresRestart: string[] = []

  const newMaxConcurrent = getSettingJson<number>('agentManager.maxConcurrent', isValidMaxConcurrent)
  if (typeof newMaxConcurrent === 'number' && newMaxConcurrent !== deps.config.maxConcurrent) {
    deps.config.maxConcurrent = newMaxConcurrent
    // Update the cap in-place — preserving activeCount so in-flight agents are
    // still accounted for. If lowered below activeCount, availableSlots returns 0
    // until enough agents drain. If raised, new slots are immediately available.
    setMaxSlots(deps.concurrency, newMaxConcurrent)
    updated.push('maxConcurrent')
  }

  const newMaxRuntimeMs = getSettingJson<number>('agentManager.maxRuntimeMs')
  if (typeof newMaxRuntimeMs === 'number' && newMaxRuntimeMs !== deps.config.maxRuntimeMs) {
    deps.config.maxRuntimeMs = newMaxRuntimeMs
    updated.push('maxRuntimeMs')
  }

  const newMaxTurns = getSettingJson<number>('agentManager.maxTurns')
  if (typeof newMaxTurns === 'number' && newMaxTurns > 0 && newMaxTurns !== deps.config.maxTurns) {
    deps.config.maxTurns = newMaxTurns
    deps.runAgentDeps.maxTurns = newMaxTurns
    updated.push('maxTurns')
  }

  const newWorktreeBase = getSetting('agentManager.worktreeBase')
  if (newWorktreeBase && newWorktreeBase !== deps.config.worktreeBase) {
    requiresRestart.push('worktreeBase')
  }

  if (updated.length > 0) {
    deps.logger.info(`[agent-manager] Hot-reloaded config fields: ${updated.join(', ')}`)
  }
  if (requiresRestart.length > 0) {
    deps.logger.info(
      `[agent-manager] Config fields changed that require restart: ${requiresRestart.join(', ')}`
    )
  }
  return { updated, requiresRestart }
}
