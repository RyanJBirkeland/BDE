import { useRef } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import type * as monaco from 'monaco-editor'
import { IDEStatusBar } from '../IDEStatusBar'

vi.mock('monaco-editor', () => ({}))

const mockBranch = { current: '' }
const mockActiveCount = { current: 0 }

vi.mock('../../../stores/gitTree', () => ({
  useGitTreeStore: vi.fn((selector: (s: { branch: string }) => unknown) =>
    selector({ branch: mockBranch.current })
  )
}))

vi.mock('../../../stores/sprintTasks', () => ({
  useSprintTasks: vi.fn(() => mockActiveCount.current),
  selectActiveTaskCount: vi.fn()
}))

function Harness(): React.JSX.Element {
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  return <IDEStatusBar editorRef={editorRef} />
}

beforeEach(() => {
  mockBranch.current = ''
  mockActiveCount.current = 0
})

describe('IDEStatusBar', () => {
  it('renders FLEET version segment', () => {
    render(<Harness />)
    expect(screen.getByText(/FLEET v/)).toBeInTheDocument()
  })

  it('falls back to "main" when no branch is set', () => {
    render(<Harness />)
    expect(screen.getByText('main')).toBeInTheDocument()
  })

  it('shows the branch name from the git tree store', () => {
    mockBranch.current = 'feat/agent-rail'
    render(<Harness />)
    expect(screen.getByText('feat/agent-rail')).toBeInTheDocument()
  })

  it('renders running-agent segment when active count > 0', () => {
    mockActiveCount.current = 3
    render(<Harness />)
    expect(screen.getByText(/3 running/)).toBeInTheDocument()
  })

  it('omits the running-agent segment when no agents are active', () => {
    mockActiveCount.current = 0
    render(<Harness />)
    expect(screen.queryByText(/running/)).not.toBeInTheDocument()
  })

  it('renders static encoding segments', () => {
    render(<Harness />)
    expect(screen.getByText('UTF-8')).toBeInTheDocument()
    expect(screen.getByText('LF')).toBeInTheDocument()
    expect(screen.getByText('Spaces: 2')).toBeInTheDocument()
  })

  it('exposes role="status" for the live region', () => {
    render(<Harness />)
    expect(screen.getByRole('status', { name: /IDE status bar/i })).toBeInTheDocument()
  })
})
