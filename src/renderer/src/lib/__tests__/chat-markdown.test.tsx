import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { renderContent, renderInline, renderUserContent } from '../chat-markdown'

// Mock TicketEditor to avoid pulling in full component tree
vi.mock('../../components/sprint/TicketEditor', () => ({
  TicketEditor: ({ initialTickets }: { initialTickets: Array<{ title: string }> }) => (
    <div data-testid="ticket-editor">
      {initialTickets.map((t, i) => (
        <span key={i}>{t.title}</span>
      ))}
    </div>
  )
}))

vi.mock('../../stores/toasts', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() }
}))

describe('renderContent — tickets-json detection', () => {
  it('renders TicketEditor for valid tickets-json code block', () => {
    const json = JSON.stringify([
      { title: 'Add auth', prompt: 'Implement OAuth', repo: 'bde', priority: 1 }
    ])
    const text = `Here are the tickets:\n\n\`\`\`tickets-json\n${json}\n\`\`\``

    render(<>{renderContent(text)}</>)

    expect(screen.getByTestId('ticket-editor')).toBeInTheDocument()
    expect(screen.getByText('Add auth')).toBeInTheDocument()
  })

  it('falls back to code block for malformed JSON', () => {
    const text = '```tickets-json\n{invalid json\n```'

    render(<>{renderContent(text)}</>)

    expect(screen.queryByTestId('ticket-editor')).not.toBeInTheDocument()
    expect(screen.getByText('{invalid json')).toBeInTheDocument()
  })

  it('renders regular code blocks normally', () => {
    const text = '```typescript\nconst x = 1\n```'

    render(<>{renderContent(text)}</>)

    expect(screen.queryByTestId('ticket-editor')).not.toBeInTheDocument()
    expect(screen.getByText('const x = 1')).toBeInTheDocument()
  })

  it('does not detect tickets-json without closing fence', () => {
    const json = JSON.stringify([{ title: 'Test', prompt: 'Do it', repo: 'bde', priority: 1 }])
    const text = `\`\`\`tickets-json\n${json}`

    render(<>{renderContent(text)}</>)

    // Without closing fence, the regex won't match — text is rendered as plain text
    expect(screen.queryByTestId('ticket-editor')).not.toBeInTheDocument()
  })

  it('handles mixed content with tickets-json and regular code blocks', () => {
    const json = JSON.stringify([
      { title: 'Build feature', prompt: 'Do the work', repo: 'bde', priority: 1 }
    ])
    const text = `Some text\n\n\`\`\`typescript\nconst a = 1\n\`\`\`\n\nMore text\n\n\`\`\`tickets-json\n${json}\n\`\`\`\n\nEnd`

    render(<>{renderContent(text)}</>)

    expect(screen.getByText('const a = 1')).toBeInTheDocument()
    expect(screen.getByTestId('ticket-editor')).toBeInTheDocument()
    expect(screen.getByText('Build feature')).toBeInTheDocument()
  })

  it('renders plain text without any code blocks', () => {
    render(<>{renderContent('Just plain text here')}</>)
    expect(screen.getByText('Just plain text here')).toBeInTheDocument()
  })

  it('renders inline code within plain text', () => {
    render(<>{renderContent('Use `npm install` to install deps')}</>)
    expect(screen.getByText('npm install')).toBeInTheDocument()
  })

  it('falls back to code block for tickets-json with empty array', () => {
    const text = '```tickets-json\n[]\n```'
    render(<>{renderContent(text)}</>)
    expect(screen.queryByTestId('ticket-editor')).not.toBeInTheDocument()
    // Falls through to code block render
    expect(screen.getByText('[]')).toBeInTheDocument()
  })

  it('falls back when tickets-json items missing required fields', () => {
    const text = '```tickets-json\n[{"title":"only title"}]\n```'
    render(<>{renderContent(text)}</>)
    expect(screen.queryByTestId('ticket-editor')).not.toBeInTheDocument()
  })

  it('renders text before and after code block', () => {
    const text = 'Before\n```js\nconsole.log()\n```\nAfter'
    render(<>{renderContent(text)}</>)
    expect(screen.getByText(/Before/)).toBeInTheDocument()
    expect(screen.getByText('console.log()')).toBeInTheDocument()
    expect(screen.getByText(/After/)).toBeInTheDocument()
  })
})

describe('renderInline', () => {
  it('renders plain text without inline code unchanged', () => {
    render(<>{renderInline('Hello world')}</>)
    expect(screen.getByText('Hello world')).toBeInTheDocument()
  })

  it('renders inline code with code element', () => {
    render(<>{renderInline('Use `git status` here')}</>)
    expect(screen.getByText('git status')).toBeInTheDocument()
    const codeEl = screen.getByText('git status')
    expect(codeEl.tagName).toBe('CODE')
  })

  it('renders text before and after inline code', () => {
    render(<>{renderInline('Run `npm test` now')}</>)
    expect(screen.getByText(/Run/)).toBeInTheDocument()
    expect(screen.getByText('npm test')).toBeInTheDocument()
    expect(screen.getByText(/now/)).toBeInTheDocument()
  })

  it('renders multiple inline code segments', () => {
    render(<>{renderInline('Use `foo` and `bar`')}</>)
    expect(screen.getByText('foo')).toBeInTheDocument()
    expect(screen.getByText('bar')).toBeInTheDocument()
  })

  it('renders empty text as empty fragment', () => {
    const { container } = render(<>{renderInline('')}</>)
    expect(container.textContent).toBe('')
  })
})

describe('renderUserContent', () => {
  it('renders plain user message text', () => {
    render(<>{renderUserContent('Hello, please fix this bug')}</>)
    expect(screen.getByText('Hello, please fix this bug')).toBeInTheDocument()
  })

  it('renders inline image from data URL', () => {
    const text = '![screenshot](data:image/png;base64,abc123)'
    const { container } = render(<>{renderUserContent(text)}</>)
    const img = container.querySelector('img')
    expect(img).toBeInTheDocument()
    expect(img?.getAttribute('alt')).toBe('screenshot')
    expect(img?.getAttribute('src')).toBe('data:image/png;base64,abc123')
  })

  it('renders file attachment block', () => {
    const text = '📄 README.md\n```markdown\n# My Project\n```'
    const { container } = render(<>{renderUserContent(text)}</>)
    expect(container.querySelector('.chat-msg__file-block')).toBeInTheDocument()
    expect(screen.getByText('# My Project')).toBeInTheDocument()
  })

  it('renders mixed image and text content', () => {
    const text = 'Here is the screenshot:\n![img](data:image/png;base64,xyz)\nDoes this help?'
    const { container } = render(<>{renderUserContent(text)}</>)
    expect(container.querySelector('img')).toBeInTheDocument()
  })

  it('shows text before image attachment', () => {
    const text = 'Look at this: ![img](data:image/png;base64,abc)'
    render(<>{renderUserContent(text)}</>)
    expect(screen.getByText('Look at this:')).toBeInTheDocument()
  })
})
