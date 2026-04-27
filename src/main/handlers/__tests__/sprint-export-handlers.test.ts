import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ipcMain } from 'electron'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), on: vi.fn() }
}))
vi.mock('../../services/sprint-service', () => ({
  getTask: vi.fn(),
  listTasks: vi.fn()
}))
vi.mock('../../data/task-changes', () => ({
  getTaskChanges: vi.fn()
}))
vi.mock('../../services/csv-export', () => ({
  formatTasksAsCsv: vi.fn(() => 'id,title\n')
}))
vi.mock('fs/promises', () => ({
  writeFile: vi.fn()
}))
vi.mock('../../shared/time', () => ({
  nowIso: vi.fn(() => '2026-04-25T00:00:00.000Z')
}))

import { registerSprintExportHandlers } from '../sprint-export-handlers'
import type { ExportHandlersDeps } from '../sprint-export-handlers'
import { getTask, listTasks } from '../../services/sprint-service'
import { getTaskChanges } from '../../data/task-changes'
import { writeFile } from 'fs/promises'

type HandlerFn = (e: unknown, ...args: unknown[]) => Promise<unknown>

function extractHandler(channel: string): HandlerFn {
  const call = vi.mocked(ipcMain.handle).mock.calls.find(([ch]) => ch === channel)
  if (!call) throw new Error(`Handler for ${channel} not registered`)
  return call[1] as HandlerFn
}

const mockDialog = {
  showSaveDialog: vi.fn(),
  showOpenDialog: vi.fn()
}

const deps: ExportHandlersDeps = { dialog: mockDialog }

beforeEach(() => {
  vi.clearAllMocks()
  registerSprintExportHandlers(deps)
})

const MOCK_TASK = {
  id: 't1',
  title: 'Test task',
  status: 'done',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z'
}

describe('sprint:exportTaskHistory', () => {
  it('happy path: writes JSON file and returns success', async () => {
    vi.mocked(getTask).mockReturnValue(MOCK_TASK as never)
    vi.mocked(getTaskChanges).mockReturnValue([])
    mockDialog.showSaveDialog.mockResolvedValue({ canceled: false, filePath: '/tmp/out.json' })
    vi.mocked(writeFile).mockResolvedValue()

    const handler = extractHandler('sprint:exportTaskHistory')
    const result = await handler(null, 't1')

    expect(result).toEqual({ success: true, path: '/tmp/out.json' })
    expect(writeFile).toHaveBeenCalledWith('/tmp/out.json', expect.stringContaining('"id": "t1"'), 'utf-8')
  })

  it('returns { success: false } when user cancels save dialog', async () => {
    vi.mocked(getTask).mockReturnValue(MOCK_TASK as never)
    vi.mocked(getTaskChanges).mockReturnValue([])
    mockDialog.showSaveDialog.mockResolvedValue({ canceled: true })

    const handler = extractHandler('sprint:exportTaskHistory')
    const result = await handler(null, 't1')

    expect(result).toEqual({ success: false })
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('throws when task is not found', async () => {
    vi.mocked(getTask).mockReturnValue(null)

    const handler = extractHandler('sprint:exportTaskHistory')
    await expect(handler(null, 'unknown-id')).rejects.toThrow('not found')
  })

  it('propagates IO error when writeFile fails', async () => {
    vi.mocked(getTask).mockReturnValue(MOCK_TASK as never)
    vi.mocked(getTaskChanges).mockReturnValue([])
    mockDialog.showSaveDialog.mockResolvedValue({ canceled: false, filePath: '/tmp/out.json' })
    vi.mocked(writeFile).mockRejectedValue(new Error('disk full'))

    const handler = extractHandler('sprint:exportTaskHistory')
    await expect(handler(null, 't1')).rejects.toThrow('disk full')
  })
})

describe('sprint:exportTasks', () => {
  it('happy path JSON: writes JSON file', async () => {
    vi.mocked(listTasks).mockReturnValue([MOCK_TASK as never])
    mockDialog.showSaveDialog.mockResolvedValue({ canceled: false, filePath: '/tmp/tasks.json' })
    vi.mocked(writeFile).mockResolvedValue()

    const handler = extractHandler('sprint:exportTasks')
    const result = await handler(null, 'json')

    expect(result).toEqual({ filePath: '/tmp/tasks.json', canceled: false })
    expect(writeFile).toHaveBeenCalledWith(
      '/tmp/tasks.json',
      expect.stringContaining('"title"'),
      'utf-8'
    )
  })

  it('returns { filePath: null, canceled: true } when user cancels', async () => {
    vi.mocked(listTasks).mockReturnValue([])
    mockDialog.showSaveDialog.mockResolvedValue({ canceled: true })

    const handler = extractHandler('sprint:exportTasks')
    const result = await handler(null, 'csv')

    expect(result).toEqual({ filePath: null, canceled: true })
  })
})
