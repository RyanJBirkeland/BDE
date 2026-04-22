import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { safeHandle } from '../ipc-utils'

const CLAUDE_DIR = join(homedir(), '.claude')
const SETTINGS_PATH = join(CLAUDE_DIR, 'settings.json')

const PERMISSION_RULE_PREFIXES = [
  'Bash',
  'Read',
  'Write',
  'Edit',
  'MultiEdit',
  'NotebookEdit',
  'Glob',
  'Grep',
  'WebFetch',
  'WebSearch'
] as const
const PERMISSION_RULE_MAX_CHARS = 500
const VALID_RULE_PATTERN = new RegExp(
  `^(${PERMISSION_RULE_PREFIXES.join('|')})(\\(.*\\))?$`
)

interface PermissionsInput {
  allow: string[]
  deny: string[]
}

function validatePermissionsPayload(input: unknown): PermissionsInput {
  if (!input || typeof input !== 'object') {
    throw new Error('Invalid permissions payload: expected an object')
  }
  const record = input as Record<string, unknown>
  const allow = record.allow
  const deny = record.deny
  if (!Array.isArray(allow) || !Array.isArray(deny)) {
    throw new Error('Invalid permissions payload: `allow` and `deny` must be arrays')
  }
  for (const rule of [...allow, ...deny]) {
    if (typeof rule !== 'string') {
      throw new Error('Invalid permissions payload: every rule must be a string')
    }
    if (rule.length > PERMISSION_RULE_MAX_CHARS) {
      throw new Error(
        `Invalid permissions payload: rule exceeds ${PERMISSION_RULE_MAX_CHARS} characters`
      )
    }
    if (!VALID_RULE_PATTERN.test(rule)) {
      throw new Error(
        `Invalid permissions payload: rule "${rule}" does not match a known tool prefix`
      )
    }
  }
  return { allow: allow as string[], deny: deny as string[] }
}

export function registerClaudeConfigHandlers(): void {
  safeHandle('claude:getConfig', async () => {
    if (!existsSync(SETTINGS_PATH)) return {}
    try {
      return JSON.parse(readFileSync(SETTINGS_PATH, 'utf-8'))
    } catch {
      return {}
    }
  })

  safeHandle('claude:setPermissions', async (_e, raw: unknown) => {
    const permissions = validatePermissionsPayload(raw)
    if (!existsSync(CLAUDE_DIR)) mkdirSync(CLAUDE_DIR, { recursive: true })

    let settings: Record<string, unknown> = {}
    if (existsSync(SETTINGS_PATH)) {
      try {
        settings = JSON.parse(readFileSync(SETTINGS_PATH, 'utf-8'))
      } catch {
        /* start fresh */
      }
    }

    settings.permissions = { allow: permissions.allow, deny: permissions.deny }
    writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + '\n')
  })
}
