/**
 * Node binary resolution for packaged Electron builds.
 *
 * Why this exists: the Claude Agent SDK's `cli.js` uses `#!/usr/bin/env node`,
 * so spawning it requires a `node` binary on PATH. Packaged macOS `.app` bundles
 * inherit only `/etc/paths` — users whose `node` comes from `fnm` or `nvm` get
 * a spawn failure ("Claude Code executable not found") because those install
 * locations are never on that default PATH.
 *
 * This helper probes the well-known locations in priority order and returns
 * the first usable absolute path, or `undefined` if none is found.
 */
import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const ELECTRON_RUNTIME_KEY = 'electron' as const
const FNM_NODE_PATH = '.local/share/fnm/aliases/default/bin/node'
const NVM_NODE_VERSIONS_DIR = '.nvm/versions/node'
const NVM_NODE_SUBPATH = 'bin/node'
const HOMEBREW_APPLE_SILICON_NODE = '/opt/homebrew/bin/node'
const HOMEBREW_INTEL_NODE = '/usr/local/bin/node'

export function resolveNodeExecutable(): string | undefined {
  const electronBundledNode = findElectronBundledNode()
  if (electronBundledNode) return electronBundledNode

  const fnmNode = findFnmDefaultNode()
  if (fnmNode) return fnmNode

  const nvmNode = findHighestNvmNode()
  if (nvmNode) return nvmNode

  return findHomebrewNode()
}

function findElectronBundledNode(): string | undefined {
  if (!process.versions[ELECTRON_RUNTIME_KEY]) return undefined
  return process.execPath
}

function findFnmDefaultNode(): string | undefined {
  const candidate = join(homedir(), FNM_NODE_PATH)
  return existsSync(candidate) ? candidate : undefined
}

function findHighestNvmNode(): string | undefined {
  const versionsDir = join(homedir(), NVM_NODE_VERSIONS_DIR)
  if (!existsSync(versionsDir)) return undefined
  const highestVersionDir = pickHighestVersionDir(versionsDir)
  if (!highestVersionDir) return undefined
  const candidate = join(versionsDir, highestVersionDir, NVM_NODE_SUBPATH)
  return existsSync(candidate) ? candidate : undefined
}

function findHomebrewNode(): string | undefined {
  if (existsSync(HOMEBREW_APPLE_SILICON_NODE)) return HOMEBREW_APPLE_SILICON_NODE
  if (existsSync(HOMEBREW_INTEL_NODE)) return HOMEBREW_INTEL_NODE
  return undefined
}

function pickHighestVersionDir(versionsDir: string): string | undefined {
  try {
    const entries = readdirSync(versionsDir)
    const versionDirs = entries.filter(isSemverDirName)
    if (versionDirs.length === 0) return undefined
    return versionDirs.sort(compareSemverDescending)[0]
  } catch {
    return undefined
  }
}

function isSemverDirName(name: string): boolean {
  return /^v\d+\.\d+\.\d+/.test(name)
}

function compareSemverDescending(a: string, b: string): number {
  const partsA = parseSemver(a)
  const partsB = parseSemver(b)
  for (let i = 0; i < 3; i++) {
    const valueA = partsA[i] ?? 0
    const valueB = partsB[i] ?? 0
    if (valueA !== valueB) return valueB - valueA
  }
  return 0
}

function parseSemver(name: string): [number, number, number] {
  const match = /^v(\d+)\.(\d+)\.(\d+)/.exec(name)
  if (!match) return [0, 0, 0]
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}
