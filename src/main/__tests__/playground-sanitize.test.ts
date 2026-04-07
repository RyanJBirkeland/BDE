import { describe, it, expect } from 'vitest'
import { sanitizePlaygroundHtml } from '../playground-sanitize'

describe('sanitizePlaygroundHtml', () => {
  it('should strip script tags', () => {
    const input = '<div>Hello</div><script>alert(1)</script><p>World</p>'
    const result = sanitizePlaygroundHtml(input)

    expect(result).not.toContain('<script')
    expect(result).not.toContain('alert(1)')
    expect(result).toContain('Hello')
    expect(result).toContain('World')
  })

  it('should strip javascript: URLs from anchor tags', () => {
    const input = '<a href="javascript:alert(1)">Click me</a>'
    const result = sanitizePlaygroundHtml(input)

    expect(result).not.toContain('javascript:')
    expect(result).toContain('Click me')
  })

  it('should strip onclick event handlers', () => {
    const input = '<button onclick="alert(\'XSS\')">Click</button>'
    const result = sanitizePlaygroundHtml(input)

    expect(result).not.toContain('onclick=')
    expect(result).not.toContain('alert')
    expect(result).toContain('Click')
  })

  it('should strip onerror event handlers from img tags', () => {
    const input = '<img src="x" onerror="alert(1)" />'
    const result = sanitizePlaygroundHtml(input)

    expect(result).not.toContain('onerror=')
    expect(result).not.toContain('alert(1)')
  })

  it('should preserve safe HTML content', () => {
    const input = `
      <div class="container">
        <h1>Title</h1>
        <p style="color: blue;">Paragraph</p>
        <a href="https://example.com">Link</a>
        <img src="image.png" alt="Image" />
      </div>
    `
    const result = sanitizePlaygroundHtml(input)

    expect(result).toContain('Title')
    expect(result).toContain('Paragraph')
    expect(result).toContain('Link')
    expect(result).toContain('https://example.com')
    expect(result).toContain('image.png')
  })

  it('should handle empty strings', () => {
    const result = sanitizePlaygroundHtml('')
    expect(result).toBe('')
  })

  it('should handle plain text without HTML', () => {
    const input = 'Just plain text'
    const result = sanitizePlaygroundHtml(input)
    expect(result).toBe('Just plain text')
  })

  it('should strip multiple types of XSS vectors in a single document', () => {
    const input = `
      <div>
        <script>console.log('evil')</script>
        <a href="javascript:void(0)">Bad link</a>
        <button onclick="steal()">Bad button</button>
        <img src="x" onerror="hack()" />
        <p>Safe content</p>
      </div>
    `
    const result = sanitizePlaygroundHtml(input)

    expect(result).not.toContain('<script')
    expect(result).not.toContain('javascript:')
    expect(result).not.toContain('onclick=')
    expect(result).not.toContain('onerror=')
    expect(result).toContain('Safe content')
  })
})
