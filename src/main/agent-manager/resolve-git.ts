/**
 * Git binary resolution for packaged Electron builds.
 *
 * Why this exists: execFile('git', ...) resolves the binary name against
 * process.env.PATH. Packaged macOS .app bundles launched from Finder inherit
 * only /etc/paths — users whose git comes from Homebrew miss /opt/homebrew/bin
 * and /usr/local/bin.
 *
 * This helper probes well-known locations in priority order and returns
 * the first usable absolute path, or `undefined` if none is found.
 * Mirrors the pattern in resolve-node.ts.
 */
import { existsSync } from 'node:fs'

const HOMEBREW_APPLE_SILICON_GIT = '/opt/homebrew/bin/git'
const HOMEBREW_INTEL_GIT = '/usr/local/bin/git'
const XCODE_CLT_GIT = '/Library/Developer/CommandLineTools/usr/bin/git'
const SYSTEM_GIT = '/usr/bin/git'

export function resolveGitExecutable(): string | undefined {
  if (existsSync(HOMEBREW_APPLE_SILICON_GIT)) return HOMEBREW_APPLE_SILICON_GIT
  if (existsSync(HOMEBREW_INTEL_GIT)) return HOMEBREW_INTEL_GIT
  if (existsSync(XCODE_CLT_GIT)) return XCODE_CLT_GIT
  if (existsSync(SYSTEM_GIT)) return SYSTEM_GIT
  return undefined
}
