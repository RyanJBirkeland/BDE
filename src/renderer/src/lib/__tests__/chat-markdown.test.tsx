import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { renderContent } from '../chat-markdown'

// Mock TicketEditor to avoid pulling in full component tree
vi.mock('../../components/sessions/TicketEditor', () => ({
  TicketEditor: ({ initialTickets }: { initialTickets: Array<{ title: string }> }) => (
    <div data-testid="ticket-editor">
      {initialTickets.map((t, i) => (
        <span key={i}>{t.title}</span>
      ))}
    </div>
  ),
}))

vi.mock('../../stores/toasts', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

describe('renderContent — tickets-json detection', () => {
  it('renders TicketEditor for valid tickets-json code block', () => {
    const json = JSON.stringify([
      { title: 'Add auth', prompt: 'Implement OAuth', repo: 'bde', priority: 1 },
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
      { title: 'Build feature', prompt: 'Do the work', repo: 'bde', priority: 1 },
    ])
    const text = `Some text\n\n\`\`\`typescript\nconst a = 1\n\`\`\`\n\nMore text\n\n\`\`\`tickets-json\n${json}\n\`\`\`\n\nEnd`

    render(<>{renderContent(text)}</>)

    expect(screen.getByText('const a = 1')).toBeInTheDocument()
    expect(screen.getByTestId('ticket-editor')).toBeInTheDocument()
    expect(screen.getByText('Build feature')).toBeInTheDocument()
  })
})
