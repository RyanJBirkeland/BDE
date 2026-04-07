import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp'),
    getName: vi.fn(() => 'BDE'),
    getVersion: vi.fn(() => '0.0.0')
  },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn(), showMessageBox: vi.fn() }
}))
import Database from 'better-sqlite3'
import { mkdirSync, rmSync, existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { vi } from 'vitest'

const TEST_DIR = join(tmpdir(), `bde-agent-history-test-${process.pid}`)
const TEST_DB_PATH = join(TEST_DIR, 'bde.db')

// Mock db.ts to use test database
vi.mock('../db', () => {
  let db: Database.Database | null = null
  return {
    getDb: () => {
      if (!db) {
        const Database = require('better-sqlite3')
        db = new Database(TEST_DB_PATH)
        ;(db as Database.Database).pragma('journal_mode = WAL')
        ;(db as Database.Database).pragma('foreign_keys = ON')
        ;(db as Database.Database).exec(`
          CREATE TABLE IF NOT EXISTS agent_runs (
            id           TEXT PRIMARY KEY,
            pid          INTEGER,
            bin          TEXT NOT NULL DEFAULT 'claude',
            task         TEXT,
            repo         TEXT,
            repo_path    TEXT,
            model        TEXT,
            status       TEXT NOT NULL DEFAULT 'running'
                           CHECK(status IN ('running','done','failed','unknown')),
            log_path     TEXT,
            started_at   TEXT NOT NULL,
            finished_at  TEXT,
            exit_code    INTEGER,
            source       TEXT DEFAULT 'external',
            cost_usd     REAL,
            tokens_in    INTEGER,
            tokens_out   INTEGER,
            cache_read   INTEGER,
            cache_create INTEGER,
            duration_ms  INTEGER,
            num_turns    INTEGER,
            sprint_task_id TEXT
          );
          CREATE INDEX IF NOT EXISTS idx_agent_runs_pid    ON agent_runs(pid);
          CREATE INDEX IF NOT EXISTS idx_agent_runs_status ON agent_runs(status);

          CREATE TABLE IF NOT EXISTS agent_events (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            agent_id   TEXT NOT NULL,
            event_type TEXT NOT NULL,
            payload    TEXT NOT NULL,
            timestamp  INTEGER NOT NULL
          );
          CREATE INDEX IF NOT EXISTS idx_agent_events_agent_id ON agent_events(agent_id);
        `)
      }
      return db
    },
    closeDb: () => {
      db?.close()
      db = null
    }
  }
})

// Mock homedir to use test directory
vi.mock('os', async () => {
  const actual = await vi.importActual('os')
  return { ...actual, homedir: () => TEST_DIR }
})

describe('agent-history (SQLite)', () => {
  let agentHistory: typeof import('../agent-history')

  beforeAll(() => {
    mkdirSync(TEST_DIR, { recursive: true })
    mkdirSync(join(TEST_DIR, '.bde'), { recursive: true })
  })

  beforeEach(async () => {
    // Clear tables between tests
    const { getDb } = await import('../db')
    const db = getDb()
    db.exec('DELETE FROM agent_runs')
    db.exec('DELETE FROM agent_events')

    // Re-import with fresh state
    agentHistory = await import('../agent-history')
  })

  afterAll(async () => {
    const { closeDb } = await import('../db')
    closeDb()
    rmSync(TEST_DIR, { recursive: true, force: true })
  })

  it('createAgentRecord inserts into SQLite and creates log file', async () => {
    const meta = await agentHistory.createAgentRecord({
      id: 'test-1',
      pid: 1234,
      bin: 'claude',
      model: 'sonnet',
      repo: 'bde',
      repoPath: '/tmp/bde',
      task: 'fix bug',
      startedAt: '2026-03-16T10:00:00.000Z',
      finishedAt: null,
      exitCode: null,
      status: 'running',
      source: 'bde',
      costUsd: null,
      tokensIn: null,
      tokensOut: null,
      sprintTaskId: null
    })

    expect(meta.id).toBe('test-1')
    expect(meta.logPath).toContain('output.log')
    expect(existsSync(meta.logPath)).toBe(true)

    // Verify it's in SQLite
    const { getDb } = await import('../db')
    const row = getDb().prepare('SELECT * FROM agent_runs WHERE id = ?').get('test-1') as any
    expect(row).toBeTruthy()
    expect(row.pid).toBe(1234)
    expect(row.status).toBe('running')
  })

  it('listAgents returns agents ordered by started_at DESC', async () => {
    await agentHistory.createAgentRecord({
      id: 'a1',
      pid: null,
      bin: 'claude',
      model: 'sonnet',
      repo: 'bde',
      repoPath: '',
      task: 'first',
      startedAt: '2026-03-16T09:00:00.000Z',
      finishedAt: null,
      exitCode: null,
      status: 'running',
      source: 'bde',
      costUsd: null,
      tokensIn: null,
      tokensOut: null,
      sprintTaskId: null
    })
    await agentHistory.createAgentRecord({
      id: 'a2',
      pid: null,
      bin: 'claude',
      model: 'opus',
      repo: 'bde',
      repoPath: '',
      task: 'second',
      startedAt: '2026-03-16T10:00:00.000Z',
      finishedAt: null,
      exitCode: null,
      status: 'done',
      source: 'bde',
      costUsd: null,
      tokensIn: null,
      tokensOut: null,
      sprintTaskId: null
    })

    const all = await agentHistory.listAgents()
    expect(all).toHaveLength(2)
    expect(all[0].id).toBe('a2') // newer first
    expect(all[1].id).toBe('a1')
  })

  it('listAgents filters by status', async () => {
    await agentHistory.createAgentRecord({
      id: 'r1',
      pid: null,
      bin: 'claude',
      model: 'sonnet',
      repo: 'bde',
      repoPath: '',
      task: 'run',
      startedAt: '2026-03-16T10:00:00.000Z',
      finishedAt: null,
      exitCode: null,
      status: 'running',
      source: 'bde',
      costUsd: null,
      tokensIn: null,
      tokensOut: null,
      sprintTaskId: null
    })
    await agentHistory.createAgentRecord({
      id: 'd1',
      pid: null,
      bin: 'claude',
      model: 'sonnet',
      repo: 'bde',
      repoPath: '',
      task: 'done',
      startedAt: '2026-03-16T09:00:00.000Z',
      finishedAt: '2026-03-16T09:30:00.000Z',
      exitCode: 0,
      status: 'done',
      source: 'bde',
      costUsd: null,
      tokensIn: null,
      tokensOut: null,
      sprintTaskId: null
    })

    const running = await agentHistory.listAgents(100, 'running')
    expect(running).toHaveLength(1)
    expect(running[0].id).toBe('r1')
  })

  it('updateAgentMeta updates SQLite row', async () => {
    await agentHistory.createAgentRecord({
      id: 'u1',
      pid: 100,
      bin: 'claude',
      model: 'sonnet',
      repo: 'bde',
      repoPath: '',
      task: 'test',
      startedAt: '2026-03-16T10:00:00.000Z',
      finishedAt: null,
      exitCode: null,
      status: 'running',
      source: 'bde',
      costUsd: null,
      tokensIn: null,
      tokensOut: null,
      sprintTaskId: null
    })

    await agentHistory.updateAgentMeta('u1', {
      status: 'done',
      finishedAt: '2026-03-16T10:30:00.000Z',
      exitCode: 0
    })

    const meta = await agentHistory.getAgentMeta('u1')
    expect(meta?.status).toBe('done')
    expect(meta?.exitCode).toBe(0)
    expect(meta?.finishedAt).toBe('2026-03-16T10:30:00.000Z')
  })

  it('appendLog writes to disk file', async () => {
    const record = await agentHistory.createAgentRecord({
      id: 'log1',
      pid: null,
      bin: 'claude',
      model: 'sonnet',
      repo: 'bde',
      repoPath: '',
      task: 'logging',
      startedAt: '2026-03-16T10:00:00.000Z',
      finishedAt: null,
      exitCode: null,
      status: 'running',
      source: 'bde',
      costUsd: null,
      tokensIn: null,
      tokensOut: null,
      sprintTaskId: null
    })

    await agentHistory.appendLog('log1', 'hello ')
    await agentHistory.appendLog('log1', 'world')

    const content = readFileSync(record.logPath, 'utf-8')
    expect(content).toBe('hello world')
  })

  it('readLog returns content from disk with byte offset', async () => {
    await agentHistory.createAgentRecord({
      id: 'read1',
      pid: null,
      bin: 'claude',
      model: 'sonnet',
      repo: 'bde',
      repoPath: '',
      task: 'reading',
      startedAt: '2026-03-16T10:00:00.000Z',
      finishedAt: null,
      exitCode: null,
      status: 'running',
      source: 'bde',
      costUsd: null,
      tokensIn: null,
      tokensOut: null,
      sprintTaskId: null
    })

    await agentHistory.appendLog('read1', 'hello world')

    const full = await agentHistory.readLog('read1')
    expect(full.content).toBe('hello world')
    expect(full.nextByte).toBe(11)

    const partial = await agentHistory.readLog('read1', 6)
    expect(partial.content).toBe('world')
    expect(partial.nextByte).toBe(11)
  })

  it('getAgentMeta returns null for non-existent id', async () => {
    const meta = await agentHistory.getAgentMeta('nonexistent')
    expect(meta).toBeNull()
  })

  it('hasAgent returns true/false correctly', async () => {
    await agentHistory.createAgentRecord({
      id: 'exists1',
      pid: null,
      bin: 'claude',
      model: 'sonnet',
      repo: 'bde',
      repoPath: '',
      task: 'test',
      startedAt: '2026-03-16T10:00:00.000Z',
      finishedAt: null,
      exitCode: null,
      status: 'running',
      source: 'bde',
      costUsd: null,
      tokensIn: null,
      tokensOut: null,
      sprintTaskId: null
    })

    expect(await agentHistory.hasAgent('exists1')).toBe(true)
    expect(await agentHistory.hasAgent('nope')).toBe(false)
  })

  it('findAgentByPid finds running agent by PID', async () => {
    await agentHistory.createAgentRecord({
      id: 'pid1',
      pid: 9999,
      bin: 'claude',
      model: 'sonnet',
      repo: 'bde',
      repoPath: '',
      task: 'test',
      startedAt: '2026-03-16T10:00:00.000Z',
      finishedAt: null,
      exitCode: null,
      status: 'running',
      source: 'bde',
      costUsd: null,
      tokensIn: null,
      tokensOut: null,
      sprintTaskId: null
    })
    await agentHistory.createAgentRecord({
      id: 'pid2',
      pid: 8888,
      bin: 'claude',
      model: 'sonnet',
      repo: 'bde',
      repoPath: '',
      task: 'done',
      startedAt: '2026-03-16T09:00:00.000Z',
      finishedAt: '2026-03-16T09:30:00.000Z',
      exitCode: 0,
      status: 'done',
      source: 'bde',
      costUsd: null,
      tokensIn: null,
      tokensOut: null,
      sprintTaskId: null
    })

    const found = await agentHistory.findAgentByPid(9999)
    expect(found?.id).toBe('pid1')

    const notFound = await agentHistory.findAgentByPid(8888)
    expect(notFound).toBeNull() // status is 'done', not 'running'
  })

  it('importAgent creates record and appends log content', async () => {
    const imported = await agentHistory.importAgent(
      { bin: 'codex', status: 'done', source: 'external' },
      'imported log content'
    )

    expect(imported.bin).toBe('codex')
    expect(imported.status).toBe('done')

    const log = await agentHistory.readLog(imported.id)
    expect(log.content).toBe('imported log content')
  })

  it('pruneOldAgents removes oldest agents beyond maxCount', async () => {
    // Create 5 agents
    for (let i = 0; i < 5; i++) {
      await agentHistory.createAgentRecord({
        id: `prune-${i}`,
        pid: null,
        bin: 'claude',
        model: 'sonnet',
        repo: 'bde',
        repoPath: '',
        task: `task ${i}`,
        startedAt: `2026-03-${String(10 + i).padStart(2, '0')}T10:00:00.000Z`,
        finishedAt: null,
        exitCode: null,
        status: 'done',
        source: 'bde',
        costUsd: null,
        tokensIn: null,
        tokensOut: null,
        sprintTaskId: null
      })
    }

    await agentHistory.pruneOldAgents(3)

    const remaining = await agentHistory.listAgents()
    expect(remaining).toHaveLength(3)
    // Should keep the 3 newest (prune-4, prune-3, prune-2)
    expect(remaining.map((a) => a.id)).toEqual(['prune-4', 'prune-3', 'prune-2'])
  })

  it('pruneOldAgents also removes agent_events for pruned agents', async () => {
    const { getDb } = await import('../db')
    const db = getDb()

    // Create 4 agents
    for (let i = 0; i < 4; i++) {
      await agentHistory.createAgentRecord({
        id: `evt-prune-${i}`,
        pid: null,
        bin: 'claude',
        model: 'sonnet',
        repo: 'bde',
        repoPath: '',
        task: `task ${i}`,
        startedAt: `2026-03-${String(10 + i).padStart(2, '0')}T10:00:00.000Z`,
        finishedAt: null,
        exitCode: null,
        status: 'done',
        source: 'bde',
        costUsd: null,
        tokensIn: null,
        tokensOut: null,
        sprintTaskId: null
      })
    }

    // Insert events for the two oldest agents (evt-prune-0 and evt-prune-1)
    db.prepare(
      'INSERT INTO agent_events (agent_id, event_type, payload, timestamp) VALUES (?, ?, ?, ?)'
    ).run('evt-prune-0', 'agent:started', '{}', 1000)
    db.prepare(
      'INSERT INTO agent_events (agent_id, event_type, payload, timestamp) VALUES (?, ?, ?, ?)'
    ).run('evt-prune-1', 'agent:completed', '{}', 2000)

    // Prune down to 2 (removes evt-prune-0 and evt-prune-1)
    await agentHistory.pruneOldAgents(2)

    // Agent records should be gone
    const remaining = await agentHistory.listAgents()
    expect(remaining).toHaveLength(2)
    expect(remaining.map((a) => a.id)).toEqual(['evt-prune-3', 'evt-prune-2'])

    // Events for pruned agents should be gone
    const eventsLeft = db.prepare('SELECT COUNT(*) as cnt FROM agent_events').get() as {
      cnt: number
    }
    expect(eventsLeft.cnt).toBe(0)
  })

  describe('readLog with maxBytes and totalBytes', () => {
    it('returns totalBytes in the response', async () => {
      await agentHistory.createAgentRecord({
        id: 'log-test-1',
        pid: null,
        bin: 'claude',
        model: 'opus',
        repo: 'bde',
        repoPath: '/tmp',
        task: 'test',
        startedAt: new Date().toISOString(),
        finishedAt: null,
        exitCode: null,
        status: 'running',
        source: 'bde',
        costUsd: null,
        tokensIn: null,
        tokensOut: null,
        sprintTaskId: null
      })
      await agentHistory.appendLog('log-test-1', 'Hello World -- this is a test log')
      const result = await agentHistory.readLog('log-test-1', 0)
      expect(result.totalBytes).toBeGreaterThan(0)
      expect(result.content).toContain('Hello World')
    })

    it('respects maxBytes parameter', async () => {
      await agentHistory.createAgentRecord({
        id: 'log-test-2',
        pid: null,
        bin: 'claude',
        model: 'opus',
        repo: 'bde',
        repoPath: '/tmp',
        task: 'test',
        startedAt: new Date().toISOString(),
        finishedAt: null,
        exitCode: null,
        status: 'running',
        source: 'bde',
        costUsd: null,
        tokensIn: null,
        tokensOut: null,
        sprintTaskId: null
      })
      await agentHistory.appendLog('log-test-2', 'A'.repeat(10000))
      const result = await agentHistory.readLog('log-test-2', 0, 100)
      expect(result.content.length).toBeLessThanOrEqual(100)
      expect(result.totalBytes).toBe(10000)
      expect(result.nextByte).toBe(100)
    })
  })

  describe('reconcileRunningAgentRuns', () => {
    it('skips rows with null sprint_task_id (adhoc/assistant agents)', async () => {
      // Adhoc agent — no sprint_task_id, owned by adhocSessions map
      await agentHistory.createAgentRecord({
        id: 'adhoc-1',
        pid: null,
        bin: 'claude',
        model: 'opus',
        repo: 'bde',
        repoPath: '/tmp',
        task: 'help me',
        startedAt: new Date().toISOString(),
        finishedAt: null,
        exitCode: null,
        status: 'running',
        source: 'adhoc',
        costUsd: null,
        tokensIn: null,
        tokensOut: null,
        sprintTaskId: null
      })

      // Reconciler is told no sprint task is active. The adhoc row must
      // remain 'running' regardless — it isn't a sprint-task agent.
      const cleaned = agentHistory.reconcileRunningAgentRuns(() => false)
      expect(cleaned).toBe(0)

      const { getDb } = await import('../db')
      const row = getDb()
        .prepare('SELECT status FROM agent_runs WHERE id = ?')
        .get('adhoc-1') as { status: string }
      expect(row.status).toBe('running')
    })

    it('finalizes sprint-task rows whose task is not in the active set', async () => {
      await agentHistory.createAgentRecord({
        id: 'sprint-orphan',
        pid: null,
        bin: 'claude',
        model: 'sonnet',
        repo: 'bde',
        repoPath: '/tmp',
        task: 'do thing',
        startedAt: new Date().toISOString(),
        finishedAt: null,
        exitCode: null,
        status: 'running',
        source: 'bde',
        costUsd: null,
        tokensIn: null,
        tokensOut: null,
        sprintTaskId: 'task-123'
      })

      const cleaned = agentHistory.reconcileRunningAgentRuns(() => false)
      expect(cleaned).toBe(1)

      const { getDb } = await import('../db')
      const row = getDb()
        .prepare('SELECT status FROM agent_runs WHERE id = ?')
        .get('sprint-orphan') as { status: string }
      expect(row.status).toBe('failed')
    })

    it('keeps sprint-task rows whose task is still in the active set', async () => {
      await agentHistory.createAgentRecord({
        id: 'sprint-alive',
        pid: null,
        bin: 'claude',
        model: 'sonnet',
        repo: 'bde',
        repoPath: '/tmp',
        task: 'do thing',
        startedAt: new Date().toISOString(),
        finishedAt: null,
        exitCode: null,
        status: 'running',
        source: 'bde',
        costUsd: null,
        tokensIn: null,
        tokensOut: null,
        sprintTaskId: 'task-456'
      })

      const cleaned = agentHistory.reconcileRunningAgentRuns(
        (taskId) => taskId === 'task-456'
      )
      expect(cleaned).toBe(0)

      const { getDb } = await import('../db')
      const row = getDb()
        .prepare('SELECT status FROM agent_runs WHERE id = ?')
        .get('sprint-alive') as { status: string }
      expect(row.status).toBe('running')
    })
  })

  describe('finished_at timestamps are written as parseable UTC ISO-with-Z', () => {
    // Regression for the "7h 0m" duration bug. SQLite's `datetime('now')`
    // returns local-time text with no `Z` suffix, which JavaScript's
    // `new Date(...)` parses as LOCAL time, shifting all duration
    // computations in the renderer by the user's TZ offset. The finalize
    // functions now use parameterized JS-side `new Date().toISOString()`.
    async function createRunningAgent(id: string, sprintTaskId?: string): Promise<void> {
      await agentHistory.createAgentRecord({
        id,
        pid: null,
        bin: 'claude',
        model: 'sonnet',
        repo: 'bde',
        repoPath: '/tmp',
        task: 'reg test',
        startedAt: new Date().toISOString(),
        finishedAt: null,
        exitCode: null,
        status: 'running',
        source: 'bde',
        costUsd: null,
        tokensIn: null,
        tokensOut: null,
        sprintTaskId: sprintTaskId ?? null
      })
    }

    async function readFinishedAt(id: string): Promise<string> {
      const { getDb } = await import('../db')
      const row = getDb()
        .prepare('SELECT finished_at FROM agent_runs WHERE id = ?')
        .get(id) as { finished_at: string }
      return row.finished_at
    }

    it('finalizeAllRunningAgentRuns writes ISO-with-Z', async () => {
      await createRunningAgent('finalize-all-1')

      agentHistory.finalizeAllRunningAgentRuns()
      const ts = await readFinishedAt('finalize-all-1')

      // Canonical ISO 8601 UTC: ends with Z, has T separator, parseable
      expect(ts).toMatch(/T/)
      expect(ts.endsWith('Z')).toBe(true)
      expect(Number.isNaN(new Date(ts).getTime())).toBe(false)
    })

    it('finalizeStaleAgentRuns writes ISO-with-Z', async () => {
      // Create a running row with an old started_at so the staleness cutoff fires
      const oldStart = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      await agentHistory.createAgentRecord({
        id: 'finalize-stale-1',
        pid: null,
        bin: 'claude',
        model: 'sonnet',
        repo: 'bde',
        repoPath: '/tmp',
        task: 'old',
        startedAt: oldStart,
        finishedAt: null,
        exitCode: null,
        status: 'running',
        source: 'bde',
        costUsd: null,
        tokensIn: null,
        tokensOut: null,
        sprintTaskId: null
      })

      agentHistory.finalizeStaleAgentRuns(60 * 1000) // anything older than 1 min
      const ts = await readFinishedAt('finalize-stale-1')

      expect(ts).toMatch(/T/)
      expect(ts.endsWith('Z')).toBe(true)
      expect(Number.isNaN(new Date(ts).getTime())).toBe(false)
    })

    it('reconcileRunningAgentRuns writes ISO-with-Z', async () => {
      await createRunningAgent('reconcile-1', 'task-xyz')

      agentHistory.reconcileRunningAgentRuns(() => false)
      const ts = await readFinishedAt('reconcile-1')

      expect(ts).toMatch(/T/)
      expect(ts.endsWith('Z')).toBe(true)
      expect(Number.isNaN(new Date(ts).getTime())).toBe(false)
    })

    it('finalize timestamp matches wall-clock UTC within 5s (not shifted by TZ)', async () => {
      // The bug presented as a 7-hour shift. This test would catch any
      // shift larger than a few seconds — including the original bug,
      // any future TZ regression, and any clock-source mistake.
      await createRunningAgent('clock-check-1')

      const before = Date.now()
      agentHistory.finalizeAllRunningAgentRuns()
      const after = Date.now()

      const stored = new Date(await readFinishedAt('clock-check-1')).getTime()
      // Allow 5 seconds of slack on either side for test scheduling jitter
      expect(stored).toBeGreaterThanOrEqual(before - 5000)
      expect(stored).toBeLessThanOrEqual(after + 5000)
    })
  })

  describe('backfillUtcTimestamps', () => {
    it('rewrites broken `YYYY-MM-DD HH:MM:SS` rows to ISO-with-Z', async () => {
      // Insert a row directly with the broken format that older
      // datetime('now') writers produced.
      const { getDb } = await import('../db')
      const db = getDb()
      db.prepare(
        `INSERT INTO agent_runs (id, pid, bin, task, repo, repo_path, model, status, log_path, started_at, finished_at, exit_code, source)
         VALUES (?, NULL, 'claude', 'broken', 'bde', '/tmp', 'sonnet', 'failed', '/tmp/log', ?, ?, NULL, 'bde')`
      ).run('broken-ts-1', '2026-04-07T02:29:39.417Z', '2026-04-07 02:30:01')

      const fixed = agentHistory.backfillUtcTimestamps()
      expect(fixed).toBe(1)

      const row = db
        .prepare('SELECT finished_at FROM agent_runs WHERE id = ?')
        .get('broken-ts-1') as { finished_at: string }
      expect(row.finished_at).toBe('2026-04-07T02:30:01Z')
      expect(Number.isNaN(new Date(row.finished_at).getTime())).toBe(false)
    })

    it('does not touch already-canonical ISO-with-Z rows', async () => {
      const { getDb } = await import('../db')
      const db = getDb()
      db.prepare(
        `INSERT INTO agent_runs (id, pid, bin, task, repo, repo_path, model, status, log_path, started_at, finished_at, exit_code, source)
         VALUES (?, NULL, 'claude', 'already-fixed', 'bde', '/tmp', 'sonnet', 'done', '/tmp/log', ?, ?, NULL, 'bde')`
      ).run('already-iso-1', '2026-04-07T02:29:39.417Z', '2026-04-07T02:30:01.000Z')

      const fixed = agentHistory.backfillUtcTimestamps()
      expect(fixed).toBe(0)

      const row = db
        .prepare('SELECT finished_at FROM agent_runs WHERE id = ?')
        .get('already-iso-1') as { finished_at: string }
      expect(row.finished_at).toBe('2026-04-07T02:30:01.000Z')
    })

    it('does not touch null finished_at rows', async () => {
      const { getDb } = await import('../db')
      const db = getDb()
      db.prepare(
        `INSERT INTO agent_runs (id, pid, bin, task, repo, repo_path, model, status, log_path, started_at, finished_at, exit_code, source)
         VALUES (?, NULL, 'claude', 'still-running', 'bde', '/tmp', 'sonnet', 'running', '/tmp/log', ?, NULL, NULL, 'bde')`
      ).run('null-ts-1', '2026-04-07T02:29:39.417Z')

      const fixed = agentHistory.backfillUtcTimestamps()
      expect(fixed).toBe(0)

      const row = db
        .prepare('SELECT finished_at FROM agent_runs WHERE id = ?')
        .get('null-ts-1') as { finished_at: string | null }
      expect(row.finished_at).toBeNull()
    })

    it('is idempotent', async () => {
      const { getDb } = await import('../db')
      const db = getDb()
      db.prepare(
        `INSERT INTO agent_runs (id, pid, bin, task, repo, repo_path, model, status, log_path, started_at, finished_at, exit_code, source)
         VALUES (?, NULL, 'claude', 'broken', 'bde', '/tmp', 'sonnet', 'failed', '/tmp/log', ?, ?, NULL, 'bde')`
      ).run('idempotent-1', '2026-04-07T02:29:39.417Z', '2026-04-07 02:30:01')

      expect(agentHistory.backfillUtcTimestamps()).toBe(1)
      expect(agentHistory.backfillUtcTimestamps()).toBe(0)
      expect(agentHistory.backfillUtcTimestamps()).toBe(0)
    })
  })
})
