/**
 * Dev Playground HTML sanitization — removes XSS vectors before broadcasting
 * to renderer. Used by auto-detected pipeline agent HTML writes.
 */
import DOMPurify from 'dompurify'
import { JSDOM } from 'jsdom'

// Create DOMPurify instance for sanitizing playground HTML
const window = new JSDOM('').window
const purify = DOMPurify(window)

// Strip url() from inline styles to prevent CSS-based external resource loading.
// Background-image, border-image, and similar properties can exfiltrate data or
// load attacker-controlled content even without <script> tags.
purify.addHook('afterSanitizeAttributes', (node) => {
  const style = (node as HTMLElement).getAttribute?.('style')
  if (style) {
    const stripped = style.replace(/url\s*\([^)]*\)/gi, 'none')
    if (stripped !== style) {
      ;(node as HTMLElement).setAttribute('style', stripped)
    }
  }
})

/**
 * Explicit allowlist for playground HTML tags.
 *
 * Includes interactive and visual tags needed for legitimate playground use
 * (canvas, svg, audio, video, form controls) while blocking dangerous
 * embedding tags (iframe, embed, object) and <style> blocks that can be
 * used for CSS exfiltration via background-image URLs.
 */
const PLAYGROUND_ALLOWED_TAGS = [
  // Document structure
  'html',
  'head',
  'body',
  'title',
  // Text / heading
  'p',
  'br',
  'span',
  'div',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  // Lists
  'ul',
  'ol',
  'li',
  // Inline formatting
  'strong',
  'em',
  'b',
  'i',
  'u',
  's',
  'code',
  'pre',
  'blockquote',
  // Links and media
  'a',
  'img',
  // Tables
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'td',
  'th',
  'caption',
  'colgroup',
  'col',
  // Forms (needed for interactive playgrounds)
  'form',
  'input',
  'button',
  'label',
  'textarea',
  'select',
  'option',
  'optgroup',
  'fieldset',
  'legend',
  // Visual / interactive (core playground use cases)
  'canvas',
  'svg',
  'g',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'text',
  'tspan',
  'defs',
  'use',
  'symbol',
  'marker',
  'linearGradient',
  'radialGradient',
  'stop',
  'clipPath',
  'mask',
  'filter',
  'feBlend',
  'feColorMatrix',
  'feComposite',
  'feFlood',
  'feGaussianBlur',
  'feMerge',
  'feMergeNode',
  'feOffset',
  'feTile',
  'audio',
  'video',
  'source',
  'track',
  // Layout helpers
  'section',
  'article',
  'header',
  'footer',
  'nav',
  'aside',
  'main',
  'figure',
  'figcaption',
  'details',
  'summary',
  'dialog',
  'hr',
  'sub',
  'sup',
  'abbr',
  'address',
  'cite',
  'dfn',
  'kbd',
  'samp',
  'var',
  'mark',
  'time',
  'progress',
  'meter',
  'output'
]

/**
 * Attributes allowed on playground tags.
 * <style> tag is excluded from PLAYGROUND_ALLOWED_TAGS to prevent CSS exfiltration
 * via background-image URLs. Inline `style` attributes are permitted for layout.
 */
const PLAYGROUND_ALLOWED_ATTR = [
  // Common
  'id',
  'class',
  'style',
  'title',
  'lang',
  'dir',
  'tabindex',
  'hidden',
  'data-*',
  // Links / media
  'href',
  'src',
  'alt',
  'width',
  'height',
  'loading',
  // Forms
  'type',
  'name',
  'value',
  'placeholder',
  'disabled',
  'checked',
  'readonly',
  'required',
  'min',
  'max',
  'step',
  'maxlength',
  'minlength',
  'pattern',
  'for',
  'action',
  'method',
  'enctype',
  'autocomplete',
  'multiple',
  'selected',
  // Media
  'controls',
  'loop',
  'muted',
  'preload',
  'poster',
  // SVG
  'xmlns',
  'viewBox',
  'fill',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-dasharray',
  'stroke-dashoffset',
  'opacity',
  'transform',
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'd',
  'points',
  'offset',
  'stop-color',
  'stop-opacity',
  'gradientUnits',
  'gradientTransform',
  'spreadMethod',
  'fx',
  'fy',
  'clip-path',
  'mask',
  'filter',
  'href',
  'xlink:href',
  'font-size',
  'font-family',
  'font-weight',
  'text-anchor',
  'dominant-baseline',
  // Canvas / misc
  'charset',
  'async',
  'defer',
  'crossorigin',
  'integrity',
  // Details/dialog
  'open'
]

/**
 * Sanitizes HTML content to remove XSS vectors — strips dangerous embedding
 * tags (iframe, embed, object), <style> blocks (CSS exfiltration risk), event
 * handlers (onclick, onerror, etc.), and javascript: URLs.
 * Safe to render in an iframe with sandbox="allow-scripts".
 *
 * Throws if DOMPurify encounters a fatal error — callers should catch and drop
 * the playground event rather than broadcasting unsanitized HTML.
 */
/**
 * URI allowlist for `src` and `href` attributes.
 * Permits safe schemes (https, http, mailto, data URIs, relative paths) while
 * blocking dangerous execution schemes such as `javascript:` and `vbscript:`.
 * The sandbox attribute on the playground iframe already prevents navigation
 * to external URLs from taking effect.
 */
const PLAYGROUND_ALLOWED_URI_REGEXP =
  /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i

export function sanitizePlaygroundHtml(rawHtml: string): string {
  return purify.sanitize(rawHtml, {
    ALLOWED_TAGS: PLAYGROUND_ALLOWED_TAGS,
    ALLOWED_ATTR: PLAYGROUND_ALLOWED_ATTR,
    ALLOW_DATA_ATTR: true,
    ALLOW_UNKNOWN_PROTOCOLS: false,
    ALLOWED_URI_REGEXP: PLAYGROUND_ALLOWED_URI_REGEXP,
    RETURN_DOM: false
  }) as string
}
