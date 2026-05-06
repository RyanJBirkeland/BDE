import { describe, it, expect } from 'vitest'
import { renderMarkdown } from '../render-markdown'

describe('renderMarkdown', () => {
  describe('headings', () => {
    it('converts # to h1', () => {
      expect(renderMarkdown('# Hello')).toContain('<h1>Hello</h1>')
    })

    it('converts ## to h2', () => {
      expect(renderMarkdown('## World')).toContain('<h2>World</h2>')
    })

    it('converts ### to h3', () => {
      expect(renderMarkdown('### Section')).toContain('<h3>Section</h3>')
    })
  })

  describe('inline formatting', () => {
    it('converts **text** to <strong>', () => {
      expect(renderMarkdown('**bold**')).toContain('<strong>bold</strong>')
    })

    it('converts *text* to <em>', () => {
      expect(renderMarkdown('*italic*')).toContain('<em>italic</em>')
    })

    it('converts `code` to <code>', () => {
      expect(renderMarkdown('`snippet`')).toContain('<code>snippet</code>')
    })
  })

  describe('lists', () => {
    it('converts - item to <li> inside <ul>', () => {
      const result = renderMarkdown('- item one')
      expect(result).toContain('<li>item one</li>')
      expect(result).toContain('<ul>')
    })
  })

  describe('paragraphs', () => {
    it('wraps plain text in <p> tags', () => {
      expect(renderMarkdown('hello world')).toContain('<p>hello world</p>')
    })

    it('converts double newlines to paragraph breaks', () => {
      const result = renderMarkdown('first\n\nsecond')
      expect(result).toContain('</p><p>')
    })
  })

  describe('XSS sanitization', () => {
    it('strips <script> tags', () => {
      const result = renderMarkdown('<script>alert("xss")</script>')
      expect(result).not.toContain('<script>')
      expect(result).not.toContain('alert')
    })

    it('strips javascript: href attributes', () => {
      const result = renderMarkdown('<a href="javascript:alert(1)">click</a>')
      expect(result).not.toContain('javascript:')
    })

    it('strips onerror event handlers', () => {
      const result = renderMarkdown('<img src="x" onerror="alert(1)">')
      expect(result).not.toContain('onerror')
    })
  })

  describe('protocol allowlist', () => {
    it('preserves http: href', () => {
      const result = renderMarkdown('<a href="http://example.com">link</a>')
      expect(result).toContain('href="http://example.com"')
    })

    it('preserves https: href', () => {
      const result = renderMarkdown('<a href="https://example.com">link</a>')
      expect(result).toContain('href="https://example.com"')
    })

    it('removes data: href', () => {
      const result = renderMarkdown('<a href="data:text/html,<h1>x</h1>">link</a>')
      expect(result).not.toContain('href="data:')
    })

    it('removes javascript: href', () => {
      const result = renderMarkdown('<a href="javascript:alert(1)">link</a>')
      expect(result).not.toContain('href="javascript:')
    })

    it('removes relative path href', () => {
      const result = renderMarkdown('<a href="/foo">link</a>')
      expect(result).not.toContain('href="/foo"')
    })
  })

  describe('edge cases', () => {
    it('returns empty string for empty input', () => {
      expect(renderMarkdown('')).toBe('')
    })

    it('returns plain text unchanged (no markdown)', () => {
      const result = renderMarkdown('just plain text')
      expect(result).toContain('just plain text')
    })
  })
})
