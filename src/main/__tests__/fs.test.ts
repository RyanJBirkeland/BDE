import { describe, it, expect } from 'vitest'
import { join, resolve } from 'path'
import { homedir } from 'os'
import { validateMemoryPath, validateLogPath } from '../fs'

const MEMORY_ROOT = resolve(homedir(), '.openclaw/workspace/memory')
const AGENT_LOGS_ROOT = resolve(homedir(), '.bde/agent-logs')

describe('validateMemoryPath', () => {
  it('accepts a simple relative path', () => {
    const result = validateMemoryPath('notes.md')
    expect(result).toBe(join(MEMORY_ROOT, 'notes.md'))
  })

  it('accepts a nested relative path', () => {
    const result = validateMemoryPath('subdir/notes.md')
    expect(result).toBe(join(MEMORY_ROOT, 'subdir/notes.md'))
  })

  it('rejects path traversal with ..', () => {
    expect(() => validateMemoryPath('../../../etc/passwd')).toThrow(
      'Path traversal blocked'
    )
  })

  it('rejects path traversal with embedded ..', () => {
    expect(() => validateMemoryPath('subdir/../../etc/passwd')).toThrow(
      'Path traversal blocked'
    )
  })

  it('rejects absolute path outside root', () => {
    expect(() => validateMemoryPath('/etc/passwd')).toThrow(
      'Path traversal blocked'
    )
  })

  it('rejects path that starts with the root as a prefix but is a sibling directory', () => {
    // e.g. ~/.openclaw/workspace/memory-evil/secret
    expect(() => validateMemoryPath('../memory-evil/secret')).toThrow(
      'Path traversal blocked'
    )
  })
})

describe('validateLogPath', () => {
  it('accepts a path under ~/.bde/agent-logs/', () => {
    const logPath = join(AGENT_LOGS_ROOT, 'agent-1/log.txt')
    const result = validateLogPath(logPath)
    expect(result).toBe(logPath)
  })

  it('accepts a path under /tmp/', () => {
    const logPath = '/tmp/bde-agents/agent-1/log.txt'
    const result = validateLogPath(logPath)
    expect(result).toBe(resolve(logPath))
  })

  it('rejects path traversal escaping agent-logs', () => {
    const logPath = join(AGENT_LOGS_ROOT, '../../.ssh/id_rsa')
    expect(() => validateLogPath(logPath)).toThrow('Path traversal blocked')
  })

  it('rejects arbitrary absolute path', () => {
    expect(() => validateLogPath('/etc/shadow')).toThrow(
      'Path traversal blocked'
    )
  })

  it('rejects path outside allowed roots', () => {
    expect(() => validateLogPath('/var/log/system.log')).toThrow(
      'Path traversal blocked'
    )
  })

  it('rejects path that is a prefix sibling of agent-logs', () => {
    // e.g. ~/.bde/agent-logs-evil/secret
    const evilPath = resolve(homedir(), '.bde/agent-logs-evil/secret')
    expect(() => validateLogPath(evilPath)).toThrow('Path traversal blocked')
  })
})
