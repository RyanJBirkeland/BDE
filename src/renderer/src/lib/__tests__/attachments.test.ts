import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Attachment } from '../../../../shared/types'
import { buildLocalAgentMessage, buildDisplayContent, buildGatewayPayload } from '../attachments'

// Mock crypto.randomUUID
beforeEach(() => {
  vi.spyOn(crypto, 'randomUUID').mockReturnValue(
    'test-uuid-1234' as `${string}-${string}-${string}-${string}-${string}`
  )
})

const textAttachment: Attachment = {
  path: '/home/user/code.ts',
  name: 'code.ts',
  type: 'text',
  content: 'const x = 1;'
}

const pyAttachment: Attachment = {
  path: '/home/user/script.py',
  name: 'script.py',
  type: 'text',
  content: 'print("hello")'
}

const imageAttachment: Attachment = {
  path: '/home/user/screenshot.png',
  name: 'screenshot.png',
  type: 'image',
  data: 'iVBORw0KGgo=',
  mimeType: 'image/png',
  preview: 'data:image/png;base64,iVBORw0KGgo='
}

const unknownExtAttachment: Attachment = {
  path: '/home/user/data.xyz',
  name: 'data.xyz',
  type: 'text',
  content: 'raw data'
}

describe('buildLocalAgentMessage', () => {
  it('returns plain text when no attachments', () => {
    expect(buildLocalAgentMessage('hello', [])).toBe('hello')
  })

  it('prepends text file as fenced code block with language', () => {
    const result = buildLocalAgentMessage('check this', [textAttachment])
    expect(result).toContain('```typescript')
    expect(result).toContain('// code.ts')
    expect(result).toContain('const x = 1;')
    expect(result).toContain('check this')
  })

  it('uses correct language for python files', () => {
    const result = buildLocalAgentMessage('run this', [pyAttachment])
    expect(result).toContain('```python')
    expect(result).toContain('// script.py')
  })

  it('uses empty language tag for unknown extensions', () => {
    const result = buildLocalAgentMessage('data', [unknownExtAttachment])
    expect(result).toContain('```\n// data.xyz')
  })

  it('appends images as markdown base64 refs', () => {
    const result = buildLocalAgentMessage('look at this', [imageAttachment])
    expect(result).toContain('![screenshot.png](data:image/png;base64,iVBORw0KGgo=)')
  })

  it('puts text files before message text and images after', () => {
    const result = buildLocalAgentMessage('describe this', [textAttachment, imageAttachment])
    const textPos = result.indexOf('```typescript')
    const msgPos = result.indexOf('describe this')
    const imgPos = result.indexOf('![screenshot.png]')
    expect(textPos).toBeLessThan(msgPos)
    expect(msgPos).toBeLessThan(imgPos)
  })

  it('skips image attachments without data or mimeType', () => {
    const noData: Attachment = { path: '/img.png', name: 'img.png', type: 'image' }
    const result = buildLocalAgentMessage('test', [noData])
    expect(result).toBe('test')
  })

  it('skips text attachments without content', () => {
    const noContent: Attachment = { path: '/f.ts', name: 'f.ts', type: 'text' }
    const result = buildLocalAgentMessage('test', [noContent])
    expect(result).toBe('test')
  })
})

describe('buildDisplayContent', () => {
  it('returns just text when no attachments', () => {
    expect(buildDisplayContent('hello', [])).toBe('hello')
  })

  it('shows text file attachments with filename header', () => {
    const result = buildDisplayContent('check', [textAttachment])
    expect(result).toContain('code.ts')
    expect(result).toContain('```typescript')
    expect(result).toContain('const x = 1;')
  })

  it('shows image attachments as markdown images with preview', () => {
    const result = buildDisplayContent('look', [imageAttachment])
    expect(result).toContain('![screenshot.png](data:image/png;base64,iVBORw0KGgo=)')
  })

  it('omits empty text from output', () => {
    const result = buildDisplayContent('', [textAttachment])
    // Empty text is not pushed when falsy
    expect(result).not.toContain('\n\n\n')
  })

  it('skips images without preview', () => {
    const noPreview: Attachment = { path: '/img.png', name: 'img.png', type: 'image', data: 'abc' }
    const result = buildDisplayContent('test', [noPreview])
    expect(result).not.toContain('![')
  })
})

describe('buildGatewayPayload', () => {
  it('returns simple message payload when no attachments', () => {
    const payload = buildGatewayPayload('session-1', 'hello', [])
    expect(payload).toEqual({
      sessionKey: 'session-1',
      message: 'hello',
      idempotencyKey: 'test-uuid-1234'
    })
  })

  it('builds multimodal content array with text attachments', () => {
    const payload = buildGatewayPayload('session-1', 'check code', [textAttachment])
    expect(payload.sessionKey).toBe('session-1')
    expect(payload.idempotencyKey).toBe('test-uuid-1234')
    expect(payload.content).toBeInstanceOf(Array)

    const content = payload.content as unknown[]
    expect(content).toHaveLength(1) // Just the text block (no image)
    expect(content[0]).toEqual({
      type: 'text',
      text: expect.stringContaining('```typescript')
    })
  })

  it('includes image blocks in content array', () => {
    const payload = buildGatewayPayload('session-1', 'look', [imageAttachment])
    const content = payload.content as unknown[]
    expect(content).toHaveLength(2) // text + image
    expect(content[1]).toEqual({
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/png',
        data: 'iVBORw0KGgo='
      }
    })
  })

  it('combines text files and images in correct order', () => {
    const payload = buildGatewayPayload('s', 'msg', [textAttachment, imageAttachment])
    const content = payload.content as unknown[]
    expect(content).toHaveLength(2)
    // First is text (merged user message + code block)
    expect((content[0] as Record<string, unknown>).type).toBe('text')
    // Second is image
    expect((content[1] as Record<string, unknown>).type).toBe('image')
  })
})
