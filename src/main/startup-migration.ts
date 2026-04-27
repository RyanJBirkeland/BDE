import { existsSync, mkdirSync } from 'node:fs'
import { cp } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'

const legacyDir = join(homedir(), '.bde')
const newDir = join(homedir(), '.fleet')

/**
 * On first launch after the BDE→FLEET rename, copies ~/.bde to ~/.fleet.
 * Non-destructive — the old directory is left intact for manual cleanup.
 * Safe to call on every launch; no-ops when ~/.fleet already exists.
 */
export async function migrateRuntimeDir(): Promise<void> {
  if (existsSync(newDir)) return
  if (!existsSync(legacyDir)) {
    mkdirSync(newDir, { recursive: true })
    return
  }
  await cp(legacyDir, newDir, { recursive: true })
}
