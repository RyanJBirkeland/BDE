/**
 * Attachment handling: file picking, reading, and message building.
 * Pure logic — no React components.
 */
import type { Attachment } from '../../../shared/types'

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp'])
const MAX_ATTACHMENTS = 5

const LANG_MAP: Record<string, string> = {
  ts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  jsx: 'jsx',
  py: 'python',
  sh: 'bash',
  css: 'css',
  html: 'html',
  json: 'json',
  md: 'markdown',
  txt: '',
}

function getExtension(filename: string): string {
  const dot = filename.lastIndexOf('.')
  return dot >= 0 ? filename.slice(dot + 1).toLowerCase() : ''
}

function isImageFile(filename: string): boolean {
  return IMAGE_EXTENSIONS.has(getExtension(filename))
}

function getLanguage(filename: string): string {
  return LANG_MAP[getExtension(filename)] ?? ''
}

/** Open native file dialog, read selected files, return Attachment objects. */
export async function pickAndReadFiles(
  existing: Attachment[]
): Promise<Attachment[]> {
  const remaining = MAX_ATTACHMENTS - existing.length
  if (remaining <= 0) return []

  const paths = await window.api.openFileDialog()
  if (!paths || paths.length === 0) return []

  const toRead = paths.slice(0, remaining)
  const results: Attachment[] = []

  for (const filePath of toRead) {
    const name = filePath.split('/').pop() ?? filePath
    if (isImageFile(name)) {
      const { data, mimeType } = await window.api.readFileAsBase64(filePath)
      results.push({
        path: filePath,
        name,
        type: 'image',
        data,
        mimeType,
        preview: `data:${mimeType};base64,${data}`,
      })
    } else {
      const { content } = await window.api.readFileAsText(filePath)
      results.push({
        path: filePath,
        name,
        type: 'text',
        content,
      })
    }
  }

  return results
}

/**
 * Build a message string for local agents (stdin).
 * Text files prepended as fenced code blocks, images appended as base64 markdown.
 */
export function buildLocalAgentMessage(
  text: string,
  attachments: Attachment[]
): string {
  const parts: string[] = []

  for (const att of attachments) {
    if (att.type === 'text' && att.content) {
      const lang = getLanguage(att.name)
      parts.push(`\`\`\`${lang}\n// ${att.name}\n${att.content}\n\`\`\``)
    }
  }

  parts.push(text)

  for (const att of attachments) {
    if (att.type === 'image' && att.data && att.mimeType) {
      parts.push(`\n![${att.name}](data:${att.mimeType};base64,${att.data})`)
    }
  }

  return parts.join('\n\n')
}

/**
 * Build agent message payload with multimodal content array.
 */
export function buildGatewayPayload(
  sessionKey: string,
  text: string,
  attachments: Attachment[]
): Record<string, unknown> {
  if (attachments.length === 0) {
    return {
      sessionKey,
      message: text,
      idempotencyKey: crypto.randomUUID(),
    }
  }

  // Build multimodal content array
  const content: unknown[] = []

  // Text file contents prepended to user message
  const textParts: string[] = []
  for (const att of attachments) {
    if (att.type === 'text' && att.content) {
      const lang = getLanguage(att.name)
      textParts.push(`\`\`\`${lang}\n// ${att.name}\n${att.content}\n\`\`\``)
    }
  }
  textParts.push(text)
  content.push({ type: 'text', text: textParts.join('\n\n') })

  // Image attachments as base64 image blocks
  for (const att of attachments) {
    if (att.type === 'image' && att.data && att.mimeType) {
      content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: att.mimeType,
          data: att.data,
        },
      })
    }
  }

  return {
    sessionKey,
    content,
    idempotencyKey: crypto.randomUUID(),
  }
}

/**
 * Build a display-friendly version of message content for optimistic rendering.
 * Images become inline markdown refs, text files become code blocks.
 */
export function buildDisplayContent(
  text: string,
  attachments: Attachment[]
): string {
  const parts: string[] = []

  for (const att of attachments) {
    if (att.type === 'text' && att.content) {
      const lang = getLanguage(att.name)
      parts.push(`📄 ${att.name}\n\`\`\`${lang}\n${att.content}\n\`\`\``)
    }
  }

  if (text) parts.push(text)

  for (const att of attachments) {
    if (att.type === 'image' && att.preview) {
      parts.push(`![${att.name}](${att.preview})`)
    }
  }

  return parts.join('\n\n')
}
