import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, act } from '@testing-library/react'

// All vi.mock calls are hoisted — cannot reference variables declared outside them.
// Use vi.hoisted() to create shared mocks.

const mocks = vi.hoisted(() => {
  const mockWrite = vi.fn()
  const mockDispose = vi.fn()
  const mockLoadAddon = vi.fn()
  const mockOpen = vi.fn()
  const mockClear = vi.fn()
  const mockOnData = vi.fn(() => ({ dispose: vi.fn() }))
  const mockFocus = vi.fn()
  const mockFit = vi.fn()
  const mockSetPtyId = vi.fn()
  const mockThemeSubscribe = vi.fn(() => vi.fn())

  return {
    mockWrite,
    mockDispose,
    mockLoadAddon,
    mockOpen,
    mockClear,
    mockOnData,
    mockFocus,
    mockFit,
    mockSetPtyId,
    mockThemeSubscribe,
    terminalInstance: {
      cols: 80,
      rows: 24,
      write: mockWrite,
      dispose: mockDispose,
      loadAddon: mockLoadAddon,
      open: mockOpen,
      clear: mockClear,
      onData: mockOnData,
      focus: mockFocus,
      options: {} as Record<string, unknown>,
    },
  }
})

vi.mock('xterm', () => ({
  Terminal: class {
    cols = 80
    rows = 24
    options = {} as Record<string, unknown>
    write = mocks.mockWrite
    dispose = mocks.mockDispose
    loadAddon = mocks.mockLoadAddon
    open = mocks.mockOpen
    clear = mocks.mockClear
    onData = mocks.mockOnData
    focus = mocks.mockFocus
  },
}))

vi.mock('xterm-addon-fit', () => ({
  FitAddon: class {
    fit = mocks.mockFit
  },
}))

vi.mock('xterm-addon-search', () => ({
  SearchAddon: class {},
}))

vi.mock('xterm-addon-web-links', () => ({
  WebLinksAddon: class {},
}))

vi.mock('xterm/css/xterm.css', () => ({}))

vi.mock('../../../stores/terminal', () => ({
  useTerminalStore: {
    getState: () => ({ setPtyId: mocks.mockSetPtyId }),
  },
}))

vi.mock('../../../stores/theme', () => ({
  useThemeStore: {
    subscribe: mocks.mockThemeSubscribe,
  },
}))

vi.mock('../../../lib/terminal-theme', () => ({
  getTerminalTheme: () => ({ background: '#000', foreground: '#fff' }),
}))

vi.mock('../../../design-system/tokens', () => ({
  tokens: {
    space: { 2: '0.5rem' },
    font: { code: 'monospace' },
  },
}))

import { TerminalPane, clearTerminal, getSearchAddon } from '../TerminalPane'

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(function (cb) {
    cb(0)
    return 0
  })

  window.api = {
    terminal: {
      create: vi.fn().mockResolvedValue('pty-1'),
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      onData: vi.fn(() => vi.fn()),
      onExit: vi.fn(),
    },
  } as unknown as typeof window.api

  global.ResizeObserver = class {
    observe = vi.fn()
    unobserve = vi.fn()
    disconnect = vi.fn()
  } as unknown as typeof ResizeObserver
})

describe('TerminalPane', () => {
  it('renders a container div', () => {
    const { container } = render(
      <TerminalPane tabId="tab-1" visible={true} />
    )
    expect(container.firstChild).toBeInstanceOf(HTMLDivElement)
  })

  it('hides container when visible is false', () => {
    const { container } = render(
      <TerminalPane tabId="tab-1" visible={false} />
    )
    const div = container.firstChild as HTMLDivElement
    expect(div.style.display).toBe('none')
  })

  it('shows container when visible is true', () => {
    const { container } = render(
      <TerminalPane tabId="tab-1" visible={true} />
    )
    const div = container.firstChild as HTMLDivElement
    expect(div.style.display).toBe('block')
  })

  it('creates a terminal instance and opens it in the container', () => {
    render(<TerminalPane tabId="tab-1" visible={true} />)
    expect(mocks.mockOpen).toHaveBeenCalled()
    expect(mocks.mockLoadAddon).toHaveBeenCalledTimes(3) // fit, search, weblinks
  })

  it('calls window.api.terminal.create with cols, rows, shell, and cwd', () => {
    render(
      <TerminalPane tabId="tab-1" shell="/bin/zsh" cwd="/home" visible={true} />
    )
    expect(window.api.terminal.create).toHaveBeenCalledWith({
      cols: 80,
      rows: 24,
      shell: '/bin/zsh',
      cwd: '/home',
    })
  })

  it('sets ptyId in store after terminal.create resolves', async () => {
    render(<TerminalPane tabId="tab-1" visible={true} />)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
    expect(mocks.mockSetPtyId).toHaveBeenCalledWith('tab-1', 'pty-1')
  })

  it('subscribes to theme store changes', () => {
    render(<TerminalPane tabId="tab-1" visible={true} />)
    expect(mocks.mockThemeSubscribe).toHaveBeenCalled()
  })

  it('cleans up terminal on unmount', async () => {
    const { unmount } = render(
      <TerminalPane tabId="tab-1" visible={true} />
    )
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
    unmount()
    expect(mocks.mockDispose).toHaveBeenCalled()
  })

  it('passes shell and cwd as undefined when not provided', () => {
    render(<TerminalPane tabId="tab-1" visible={true} />)
    expect(window.api.terminal.create).toHaveBeenCalledWith({
      cols: 80,
      rows: 24,
      shell: undefined,
      cwd: undefined,
    })
  })

  it('calls fit on requestAnimationFrame after open', () => {
    render(<TerminalPane tabId="tab-1" visible={true} />)
    expect(mocks.mockFit).toHaveBeenCalled()
  })

  it('registers onData listener for pty data', async () => {
    render(<TerminalPane tabId="tab-1" visible={true} />)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
    expect(window.api.terminal.onData).toHaveBeenCalledWith('pty-1', expect.any(Function))
  })

  it('registers onExit listener for pty', async () => {
    render(<TerminalPane tabId="tab-1" visible={true} />)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
    expect(window.api.terminal.onExit).toHaveBeenCalledWith('pty-1', expect.any(Function))
  })
})

describe('clearTerminal', () => {
  it('clears the terminal instance for a known tabId', () => {
    render(<TerminalPane tabId="tab-clear" visible={true} />)
    clearTerminal('tab-clear')
    expect(mocks.mockClear).toHaveBeenCalled()
  })

  it('does nothing for unknown tabId', () => {
    mocks.mockClear.mockClear()
    clearTerminal('unknown-tab')
    expect(mocks.mockClear).not.toHaveBeenCalled()
  })
})

describe('getSearchAddon', () => {
  it('returns search addon for existing tabId', () => {
    render(<TerminalPane tabId="tab-search" visible={true} />)
    const addon = getSearchAddon('tab-search')
    expect(addon).toBeDefined()
  })

  it('returns undefined for unknown tabId', () => {
    expect(getSearchAddon('nonexistent')).toBeUndefined()
  })
})
