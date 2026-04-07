/**
 * Dev Playground HTML sanitization — removes XSS vectors before broadcasting
 * to renderer. Used by both manual playground:show IPC and auto-detected
 * pipeline agent HTML writes.
 */
import DOMPurify from 'dompurify'
import { JSDOM } from 'jsdom'

// Create DOMPurify instance for sanitizing playground HTML
const window = new JSDOM('').window
const purify = DOMPurify(window)

/**
 * Sanitizes HTML content to remove XSS vectors — strips script tags,
 * event handlers (onclick, onerror, etc.), and javascript: URLs.
 * Safe to render in an iframe with sandbox="allow-scripts".
 */
export function sanitizePlaygroundHtml(rawHtml: string): string {
  return purify.sanitize(rawHtml)
}
