import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PlannerAssistant, parseActionMarkers } from '../PlannerAssistant'

// Mock useRepoOptions to return a single repo by default
vi.mock('../../../hooks/useRepoOptions', () => ({
  useRepoOptions: () => [{ label: 'fleet', owner: '', color: '' }]
}))

// Mock useTaskWorkbenchStore — only needs getState for ActionCard's handleEditFirst
vi.mock('../../../stores/taskWorkbench', () => ({
  useTaskWorkbenchStore: {
    getState: () => ({
      resetForm: vi.fn(),
      setField: vi.fn()
    })
  }
}))

// Extend the global window.api mock with workbench-specific methods
beforeEach(() => {
  const existing = (window.api as Record<string, Record<string, unknown>>).workbench ?? {}
  const existingSprint = (window.api as Record<string, Record<string, unknown>>).sprint ?? {}
  Object.assign(window.api, {
    workbench: {
      ...existing,
      chatStream: vi.fn().mockResolvedValue(undefined),
      onChatChunk: vi.fn().mockReturnValue(() => {})
    },
    sprint: {
      ...existingSprint,
      update: vi.fn().mockResolvedValue({})
    }
  })
})

const mockEpic = {
  id: 'epic-1',
  name: 'Test Epic',
  goal: 'Test goal',
  status: 'draft' as const,
  icon: '📋',
  accent_color: '#4a9eff',
  depends_on: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString()
}

describe('parseActionMarkers', () => {
  it('extracts create-task actions from text', () => {
    const input = 'Hello\n[ACTION:create-task]{"title":"Add auth","spec":"..."}[/ACTION]\nWorld'
    const result = parseActionMarkers(input)
    // After replacement + trim: 'Hello\n\nWorld'.trim() → 'Hello\n\nWorld'
    // We test the action is extracted, and clean text has no ACTION markers
    expect(result.cleanText).not.toContain('[ACTION:')
    expect(result.actions).toHaveLength(1)
    expect(result.actions[0].type).toBe('create-task')
    expect(result.actions[0].payload.title).toBe('Add auth')
  })

  it('handles malformed JSON gracefully', () => {
    const input = '[ACTION:create-task]{bad json}[/ACTION]'
    const result = parseActionMarkers(input)
    expect(result.cleanText).toBe('')
    expect(result.actions).toHaveLength(0)
  })

  it('extracts multiple actions', () => {
    const input =
      '[ACTION:create-task]{"title":"T1"}[/ACTION][ACTION:create-epic]{"name":"E1"}[/ACTION]'
    const result = parseActionMarkers(input)
    expect(result.actions).toHaveLength(2)
  })

  it('ignores unknown action types', () => {
    const input = '[ACTION:unknown-type]{"title":"T1"}[/ACTION]valid text'
    const result = parseActionMarkers(input)
    expect(result.actions).toHaveLength(0)
    expect(result.cleanText).toBe('valid text')
  })
})

describe('PlannerAssistant', () => {
  it('renders nothing when open is false', () => {
    const { container } = render(
      <PlannerAssistant
        open={false}
        onClose={vi.fn()}
        epic={mockEpic}
        tasks={[]}
        onOpenWorkbench={vi.fn()}
      />
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when epic is null', () => {
    const { container } = render(
      <PlannerAssistant
        open={true}
        onClose={vi.fn()}
        epic={null}
        tasks={[]}
        onOpenWorkbench={vi.fn()}
      />
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders the assistant when open and epic provided', () => {
    render(
      <PlannerAssistant
        open={true}
        onClose={vi.fn()}
        epic={mockEpic}
        tasks={[]}
        onOpenWorkbench={vi.fn()}
      />
    )
    expect(screen.getByText('Planning Assistant')).toBeInTheDocument()
  })

  it('calls onClose when close button clicked', async () => {
    const onClose = vi.fn()
    render(
      <PlannerAssistant
        open={true}
        onClose={onClose}
        epic={mockEpic}
        tasks={[]}
        onOpenWorkbench={vi.fn()}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('sends a message when Enter is pressed', async () => {
    render(
      <PlannerAssistant
        open={true}
        onClose={vi.fn()}
        epic={mockEpic}
        tasks={[]}
        onOpenWorkbench={vi.fn()}
      />
    )
    const textarea = screen.getByPlaceholderText(/ask the assistant/i)
    await userEvent.type(textarea, 'Hello{Enter}')
    expect(
      (window.api as Record<string, Record<string, unknown>>).workbench.chatStream
    ).toHaveBeenCalled()
  })
})

describe('update-spec action cards', () => {
  it('renders show-changes toggle when update-spec action arrives', async () => {
    // Capture the chunk listener so we can fire it after chatStream resolves
    let capturedChunkListener: ((data: { chunk: string; done: boolean; streamId: string }) => void) | null = null
    vi.mocked(window.api.workbench.onChatChunk).mockImplementation((cb) => {
      capturedChunkListener = cb as typeof capturedChunkListener
      return () => {}
    })
    vi.mocked(window.api.workbench.chatStream).mockImplementation(async () => {
      // Fire the stream events after chatStream is invoked
      if (capturedChunkListener) {
        capturedChunkListener({ chunk: '[ACTION:update-spec]{"taskId":"task-123","spec":"## New\\nUpdated content"}[/ACTION]', done: false, streamId: 'x' })
        capturedChunkListener({ chunk: '', done: true, streamId: 'x' })
      }
      return undefined
    })

    const mockTask = {
      id: 'task-123',
      title: 'My Task',
      spec: '## Old\nOld content',
      status: 'backlog'
    } as import('../../../../../shared/types').SprintTask

    render(
      <PlannerAssistant
        open
        onClose={vi.fn()}
        epic={mockEpic}
        tasks={[mockTask]}
        onOpenWorkbench={vi.fn()}
      />
    )

    const textarea = screen.getByPlaceholderText(/ask the assistant/i)
    await userEvent.type(textarea, 'update spec')
    await userEvent.keyboard('{Enter}')

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /show changes/i })).toBeInTheDocument()
    }, { timeout: 2000 })
  })

  it('renders Apply All button when 2+ pending update-spec actions exist', async () => {
    let capturedChunkListener: ((data: { chunk: string; done: boolean; streamId: string }) => void) | null = null
    vi.mocked(window.api.workbench.onChatChunk).mockImplementation((cb) => {
      capturedChunkListener = cb as typeof capturedChunkListener
      return () => {}
    })
    vi.mocked(window.api.workbench.chatStream).mockImplementation(async () => {
      if (capturedChunkListener) {
        capturedChunkListener({
          chunk: '[ACTION:update-spec]{"taskId":"t1","spec":"spec1"}[/ACTION]\n[ACTION:update-spec]{"taskId":"t2","spec":"spec2"}[/ACTION]',
          done: false,
          streamId: 'x'
        })
        capturedChunkListener({ chunk: '', done: true, streamId: 'x' })
      }
      return undefined
    })

    const tasks = [
      { id: 't1', title: 'Task 1', spec: 'old1', status: 'backlog' } as import('../../../../../shared/types').SprintTask,
      { id: 't2', title: 'Task 2', spec: 'old2', status: 'backlog' } as import('../../../../../shared/types').SprintTask
    ]

    render(
      <PlannerAssistant
        open
        onClose={vi.fn()}
        epic={mockEpic}
        tasks={tasks}
        onOpenWorkbench={vi.fn()}
      />
    )

    const textarea = screen.getByPlaceholderText(/ask the assistant/i)
    await userEvent.type(textarea, 'update all')
    await userEvent.keyboard('{Enter}')

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /apply all/i })).toBeInTheDocument()
    }, { timeout: 2000 })
  })
})
