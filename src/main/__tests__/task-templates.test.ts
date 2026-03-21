import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'

let db: Database.Database

vi.mock('../db', () => ({
  getDb: () => db,
}))

vi.mock('../settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../settings')>()
  return {
    ...actual,
    getSettingJson: vi.fn(),
  }
})

vi.mock('../config', () => ({
  getGitHubToken: vi.fn().mockReturnValue(null),
}))

vi.mock('../paths', () => ({
  getSpecsRoot: vi.fn().mockReturnValue(null),
  BDE_DIR: '/tmp/bde-test',
  BDE_DB_PATH: '/tmp/bde-test/bde.db',
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn(),
  },
}))

import { getSettingJson } from '../settings'
import type { TaskTemplate, ClaimedTask } from '../../shared/types'
import { DEFAULT_TASK_TEMPLATES } from '../../shared/constants'

// Capture handlers registered via ipcMain.handle
const handlers = new Map<string, Function>()
const { ipcMain } = await import('electron')
vi.mocked(ipcMain.handle).mockImplementation((channel: string, handler: Function) => {
  handlers.set(channel, handler)
  return undefined as never
})

const fakeEvent = {} as Electron.IpcMainInvokeEvent

describe('task template resolution in claimTask', () => {
  beforeEach(() => {
    handlers.clear()
    db = new Database(':memory:')
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    db.exec(`
      CREATE TABLE IF NOT EXISTS agent_runs (
        id TEXT PRIMARY KEY,
        pid INTEGER,
        bin TEXT NOT NULL DEFAULT 'claude',
        task TEXT,
        repo TEXT,
        repo_path TEXT,
        model TEXT,
        status TEXT NOT NULL DEFAULT 'running',
        log_path TEXT,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        exit_code INTEGER,
        source TEXT NOT NULL DEFAULT 'bde'
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
      CREATE TABLE IF NOT EXISTS sprint_tasks (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        title TEXT NOT NULL,
        prompt TEXT NOT NULL DEFAULT '',
        repo TEXT NOT NULL DEFAULT 'bde',
        status TEXT NOT NULL DEFAULT 'backlog',
        priority INTEGER NOT NULL DEFAULT 1,
        spec TEXT,
        notes TEXT,
        pr_url TEXT,
        pr_number INTEGER,
        pr_status TEXT,
        pr_mergeable_state TEXT,
        agent_run_id TEXT REFERENCES agent_runs(id),
        template_name TEXT,
        started_at TEXT,
        completed_at TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
    `)
    vi.clearAllMocks()
  })

  afterEach(() => {
    db.close()
  })

  async function registerAndClaim(taskId: string): Promise<ClaimedTask | null> {
    // Re-register handlers each test (fresh handlers map)
    const mod = await import('../handlers/sprint-local')
    mod.registerSprintLocalHandlers()
    const handler = handlers.get('sprint:claimTask')
    if (!handler) throw new Error('sprint:claimTask handler not registered')
    return handler(fakeEvent, taskId) as ClaimedTask | null
  }

  it('returns templatePromptPrefix when template_name matches a saved template', async () => {
    db.prepare(
      "INSERT INTO sprint_tasks (id, title, template_name) VALUES ('t1', 'Fix bug', 'bugfix')"
    ).run()

    const templates: TaskTemplate[] = [
      { name: 'bugfix', promptPrefix: 'You are fixing a bug.' },
      { name: 'feature', promptPrefix: 'You are building a feature.' },
    ]
    vi.mocked(getSettingJson).mockReturnValue(templates)

    const result = await registerAndClaim('t1')

    expect(result).not.toBeNull()
    expect(result!.templatePromptPrefix).toBe('You are fixing a bug.')
    expect(result!.template_name).toBe('bugfix')
  })

  it('returns null templatePromptPrefix when template_name does not match any template', async () => {
    db.prepare(
      "INSERT INTO sprint_tasks (id, title, template_name) VALUES ('t2', 'Unknown', 'nonexistent')"
    ).run()

    const templates: TaskTemplate[] = [
      { name: 'bugfix', promptPrefix: 'You are fixing a bug.' },
    ]
    vi.mocked(getSettingJson).mockReturnValue(templates)

    const result = await registerAndClaim('t2')

    expect(result).not.toBeNull()
    expect(result!.templatePromptPrefix).toBeNull()
  })

  it('returns null templatePromptPrefix when task has no template_name', async () => {
    db.prepare(
      "INSERT INTO sprint_tasks (id, title) VALUES ('t3', 'No template')"
    ).run()

    const result = await registerAndClaim('t3')

    expect(result).not.toBeNull()
    expect(result!.templatePromptPrefix).toBeNull()
    expect(result!.template_name).toBeNull()
  })

  it('falls back to DEFAULT_TASK_TEMPLATES when settings key does not exist', async () => {
    db.prepare(
      "INSERT INTO sprint_tasks (id, title, template_name) VALUES ('t4', 'Build it', 'feature')"
    ).run()

    vi.mocked(getSettingJson).mockReturnValue(null)

    const result = await registerAndClaim('t4')

    expect(result).not.toBeNull()
    const expected = DEFAULT_TASK_TEMPLATES.find((t) => t.name === 'feature')
    expect(result!.templatePromptPrefix).toBe(expected!.promptPrefix)
  })

  it('returns null for non-existent task', async () => {
    const result = await registerAndClaim('nonexistent')
    expect(result).toBeNull()
  })
})
