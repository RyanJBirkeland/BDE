/**
 * Integration test: IPC channel registration completeness.
 *
 * Reads source files at test time and verifies that every channel defined in
 * IpcChannelMap (src/shared/ipc-channels.ts) has a corresponding handler
 * registration via safeHandle() or ipcMain.handle()/ipcMain.on().
 *
 * This catches drift between the type definitions and actual handler wiring
 * without needing to boot Electron.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

/** Root of the src directory, resolved relative to this test file. */
const srcRoot = join(__dirname, '..', '..', '..')

/**
 * Parse IpcChannelMap channel names from ipc-channels.ts.
 *
 * Channels appear as string-literal keys inside interface bodies, e.g.:
 *   'sprint:list': { args: ...; result: ... }
 *
 * We match quoted strings that look like IPC channel names (word:word pattern).
 */
function extractExpectedChannels(): Set<string> {
  const source = readFileSync(join(srcRoot, 'shared', 'ipc-channels.ts'), 'utf-8')

  // Match channel name keys inside the domain interfaces.
  // Pattern: lines starting with optional whitespace, then a quoted 'domain:action' key followed by ':'
  const channelPattern = /^\s+'([a-z][\w-]*:[a-zA-Z][\w-]*)'\s*:/gm
  const channels = new Set<string>()
  let match: RegExpExecArray | null
  while ((match = channelPattern.exec(source))) {
    channels.add(match[1])
  }
  return channels
}

/**
 * Scan all main-process source files for safeHandle / ipcMain.handle / ipcMain.on
 * registrations and return the set of channel names found.
 */
function extractRegisteredChannels(): Set<string> {
  const channels = new Set<string>()

  // Files that register handlers:
  //   - src/main/handlers/*.ts  (handler modules)
  //   - src/main/fs.ts          (registerFsHandlers)
  //   - src/main/index.ts       (unlikely, but check anyway)
  const handlerDir = join(srcRoot, 'main', 'handlers')
  const handlerFiles = readdirSync(handlerDir)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && !f.includes('__tests__'))
    .map((f) => join(handlerDir, f))

  // Also include top-level files that register handlers
  const topLevelFiles = ['fs.ts', 'index.ts', 'tearoff-manager.ts'].map((f) =>
    join(srcRoot, 'main', f)
  )

  const allFiles = [...handlerFiles, ...topLevelFiles]

  // Patterns that register IPC handlers:
  //   safeHandle('channel:name', ...)
  //   ipcMain.handle('channel:name', ...)
  //   ipcMain.on('channel:name', ...)
  const handlePattern = /(?:safeHandle|ipcMain\.handle|ipcMain\.on)\s*\(\s*'([^']+)'/g

  for (const filePath of allFiles) {
    let source: string
    try {
      source = readFileSync(filePath, 'utf-8')
    } catch {
      continue // file may not exist in worktree
    }

    let m: RegExpExecArray | null
    while ((m = handlePattern.exec(source))) {
      channels.add(m[1])
    }
  }

  return channels
}

describe('IPC Registration Completeness', () => {
  const expectedChannels = extractExpectedChannels()
  const registeredChannels = extractRegisteredChannels()

  it('extracts a non-trivial number of expected channels from IpcChannelMap', () => {
    // Sanity check: we should find 85+ channels. If this drops, the regex broke.
    // Current count: 88 (as of PR #528)
    expect(expectedChannels.size).toBeGreaterThanOrEqual(85)
  })

  it('extracts a non-trivial number of registered channels from handler files', () => {
    // Current count: 89 (87 safeHandle/ipcMain.handle + 2 ipcMain.on fire-and-forget)
    // As of PR #528 (removed 5 channels) and PR #520 (added agent:spawnAssistant)
    expect(registeredChannels.size).toBeGreaterThanOrEqual(85)
  })

  it('every IpcChannelMap channel has a registered handler', () => {
    // agent:event is a broadcast-only channel (main -> renderer via webContents.send),
    // not an invokable handler, so it is excluded from the check.
    //
    // Note: Some channels are server-side only and not exposed in preload:
    // - sprint:getChanges, sprint:batchUpdate (Queue API internal)
    // - playground:show (dev-only IPC)
    const broadcastOnly = new Set(['agent:event'])

    const missing = [...expectedChannels]
      .filter((ch) => !broadcastOnly.has(ch))
      .filter((ch) => !registeredChannels.has(ch))
      .sort()

    expect(missing, `Unregistered IPC channels:\n  ${missing.join('\n  ')}`).toEqual([])
  })

  it('no handler registers a channel that is not in IpcChannelMap', () => {
    // Channels registered via ipcMain.on that are NOT in the type map are
    // internal/fire-and-forget channels (e.g. window:setTitle, terminal:write).
    // We allow those but flag safeHandle channels that drift from the type map.
    const allowedExtras = new Set([
      'window:setTitle', // ipcMain.on, fire-and-forget
      'terminal:write', // ipcMain.on, fire-and-forget
      'tearoff:returnToMain', // ipcMain.on, fire-and-forget (no typed result)
      'tearoff:dropComplete', // ipcMain.on, fire-and-forget (cross-window drag)
      'tearoff:dragCancelFromRenderer', // ipcMain.on, fire-and-forget (cross-window drag)
      'tearoff:returnAll', // ipcMain.on, fire-and-forget (bulk return all tabs)
      'tearoff:viewsChanged' // ipcMain.on, fire-and-forget (renderer notifies main of open views)
    ])

    const extras = [...registeredChannels]
      .filter((ch) => !expectedChannels.has(ch))
      .filter((ch) => !allowedExtras.has(ch))
      .sort()

    expect(
      extras,
      `Handlers registered for channels not in IpcChannelMap:\n  ${extras.join('\n  ')}`
    ).toEqual([])
  })
})
