import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { EditorPane } from '../EditorPane'

vi.mock('@monaco-editor/react', () => ({
  default: ({ value }: { value?: string }) => <div data-testid="monaco-editor">{value}</div>,
  loader: { config: vi.fn() },
}))
vi.mock('../../../stores/theme', () => ({
  useThemeStore: vi.fn((selector: (s: { theme: string }) => unknown) => selector({ theme: 'dark' })),
}))
vi.mock('../../../lib/monaco-theme', () => ({
  getMonacoTheme: vi.fn(() => ({ base: 'vs-dark', inherit: true, rules: [], colors: {} })),
  getLightMonacoTheme: vi.fn(() => ({ base: 'vs', inherit: true, rules: [], colors: {} })),
}))

beforeEach(() => { vi.clearAllMocks() })

describe('EditorPane', () => {
  it('shows empty state when no file is open', () => {
    render(<EditorPane filePath={null} content={null} language="plaintext" />)
    expect(screen.getByText('Open a file from the sidebar to start editing')).toBeInTheDocument()
  })
  it('shows empty state when content is null even with filePath', () => {
    render(<EditorPane filePath="/project/file.ts" content={null} language="typescript" />)
    expect(screen.getByText('Open a file from the sidebar to start editing')).toBeInTheDocument()
  })
  it('renders Monaco editor when file is open', () => {
    render(<EditorPane filePath="/project/file.ts" content="const x = 1" language="typescript" />)
    expect(screen.getByTestId('monaco-editor')).toBeInTheDocument()
  })
  it('passes content to Monaco editor', () => {
    render(<EditorPane filePath="/project/file.ts" content="hello world" language="typescript" />)
    expect(screen.getByTestId('monaco-editor')).toHaveTextContent('hello world')
  })
})
