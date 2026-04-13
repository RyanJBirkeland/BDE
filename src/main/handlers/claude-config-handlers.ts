import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { safeHandle } from '../ipc-utils'

const CLAUDE_DIR = join(homedir(), '.claude')
const SETTINGS_PATH = join(CLAUDE_DIR, 'settings.json')

export function registerClaudeConfigHandlers(): void {
  safeHandle('claude:getConfig', async () => {
    if (!existsSync(SETTINGS_PATH)) return {}
    try {
      return JSON.parse(readFileSync(SETTINGS_PATH, 'utf-8'))
    } catch {
      return {}
    }
  })

  safeHandle('claude:setPermissions', async (_e, permissions: { allow: string[]; deny: string[] }) => {
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
    }
  )
}
