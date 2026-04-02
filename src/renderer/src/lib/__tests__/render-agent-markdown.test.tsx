import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { renderAgentMarkdown } from '../render-agent-markdown'

describe('renderAgentMarkdown', () => {
  it('renders plain text unchanged', () => {
    render(<>{renderAgentMarkdown('Hello world')}</>)
    expect(screen.getByText('Hello world')).toBeInTheDocument()
  })

  it('renders **bold** text as strong element', () => {
    const { container } = render(<>{renderAgentMarkdown('This is **important** text')}</>)
    const strong = container.querySelector('.console-md-bold')
    expect(strong).toBeInTheDocument()
    expect(strong?.textContent).toBe('important')
  })

  it('renders `code` as code element', () => {
    const { container } = render(<>{renderAgentMarkdown('Run `npm install` first')}</>)
    const code = container.querySelector('.console-md-code')
    expect(code).toBeInTheDocument()
    expect(code?.textContent).toBe('npm install')
  })

  it('renders ## heading as block heading', () => {
    const { container } = render(<>{renderAgentMarkdown('## Step 5: Verify')}</>)
    const heading = container.querySelector('.console-md-heading')
    expect(heading).toBeInTheDocument()
    expect(heading?.textContent).toBe('Step 5: Verify')
  })

  it('handles mixed markdown', () => {
    const { container } = render(
      <>{renderAgentMarkdown('✅ **Step 4 PASSED**: Run `npm test` to verify')}</>
    )
    expect(container.querySelector('.console-md-bold')?.textContent).toBe('Step 4 PASSED')
    expect(container.querySelector('.console-md-code')?.textContent).toBe('npm test')
  })

  it('returns empty fragment for empty string', () => {
    const { container } = render(<>{renderAgentMarkdown('')}</>)
    expect(container.textContent).toBe('')
  })

  it('preserves text without markdown unchanged', () => {
    render(<>{renderAgentMarkdown('No special formatting here')}</>)
    expect(screen.getByText('No special formatting here')).toBeInTheDocument()
  })

  it('handles heading mid-text (only at line start)', () => {
    const { container } = render(
      <>{renderAgentMarkdown('Result\n## Next Step\nDo the thing')}</>
    )
    const heading = container.querySelector('.console-md-heading')
    expect(heading).toBeInTheDocument()
    expect(heading?.textContent).toBe('Next Step')
  })

  it('does not render script tags as HTML', () => {
    const { container } = render(
      <>{renderAgentMarkdown('<script>alert("xss")</script>')}</>
    )
    expect(container.querySelector('script')).toBeNull()
    // React auto-escapes, so script tag text appears as literal text
    expect(container.textContent).toContain('<script>')
  })
})
