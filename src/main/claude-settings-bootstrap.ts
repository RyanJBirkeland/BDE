/**
 * claude-settings-bootstrap.ts — Ensures Claude Code has sensible default
 * permissions so BDE-spawned agents don't stall on permission prompts.
 *
 * Checks ~/.claude/settings.json on startup. If permissions aren't configured,
 * applies BDE's recommended defaults (allow standard tools, deny destructive ops).
 * Never overwrites existing user configuration.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { createLogger } from './logger'

const log = createLogger('claude-settings')

const CLAUDE_DIR = join(homedir(), '.claude')
const SETTINGS_PATH = join(CLAUDE_DIR, 'settings.json')

// Minimal permissions BDE agents need to function without stalling
const BDE_DEFAULT_PERMISSIONS = {
  allow: [
    'Read',
    'Write',
    'Edit',
    'Glob',
    'Grep',
    'Bash',
    'Agent',
    'WebFetch',
    'WebSearch',
    'NotebookEdit'
  ],
  deny: [
    'Bash(rm -rf /*)',
    'Bash(rm -rf ~*)',
    'Bash(sudo rm *)',
    'Bash(sudo dd *)',
    'Bash(mkfs*)',
    'Bash(dd if=*)',
    'Bash(chmod -R 777 /*)'
  ]
}

interface ClaudeSettings {
  permissions?: {
    allow?: string[]
    deny?: string[]
  }
  [key: string]: unknown
}

/**
 * Ensures ~/.claude/settings.json has permissions configured.
 * Returns true if defaults were applied, false if existing config was preserved.
 */
export function ensureClaudeSettings(): boolean {
  try {
    // Ensure ~/.claude/ directory exists
    if (!existsSync(CLAUDE_DIR)) {
      mkdirSync(CLAUDE_DIR, { recursive: true })
    }

    // Read existing settings
    let settings: ClaudeSettings = {}
    if (existsSync(SETTINGS_PATH)) {
      try {
        settings = JSON.parse(readFileSync(SETTINGS_PATH, 'utf-8'))
      } catch {
        log.warn('[claude-settings] Failed to parse existing settings.json — preserving file')
        return false
      }
    }

    // Check if permissions are already configured
    const hasPermissions = settings.permissions?.allow && settings.permissions.allow.length > 0
    if (hasPermissions) {
      log.info(
        `[claude-settings] Permissions already configured (${settings.permissions!.allow!.length} allow rules)`
      )
      return false
    }

    // Apply BDE defaults — preserve any other settings
    settings.permissions = {
      ...settings.permissions,
      allow: BDE_DEFAULT_PERMISSIONS.allow,
      deny: [
        ...(settings.permissions?.deny ?? []),
        ...BDE_DEFAULT_PERMISSIONS.deny.filter(
          (rule) => !(settings.permissions?.deny ?? []).includes(rule)
        )
      ]
    }

    writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + '\n')
    log.info(`[claude-settings] Applied BDE default permissions to ${SETTINGS_PATH}`)
    return true
  } catch (err) {
    log.error(`[claude-settings] Failed to bootstrap settings: ${err}`)
    return false
  }
}
