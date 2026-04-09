/**
 * CSS deduplication service.
 *
 * Pure functions — no side effects, no file I/O.
 * Parses CSS into blocks, identifies exact duplicates (same selector + body),
 * flags near-duplicates (same selector, different body), and rebuilds the CSS
 * with duplicates removed (keeping last occurrence for correct cascade priority).
 */

export interface CssBlock {
  type: 'rule' | 'keyframes' | 'media' | 'comment' | 'other'
  selector: string
  body: string
  /** Parent at-rule string (e.g. '@media (max-width: 768px)') or '' for top-level */
  context: string
  /** Original raw text of this block as it appeared in the source */
  raw: string
}

export interface DedupResult {
  deduplicated: string
  removed: CssBlock[]
  warnings: string[]
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Collapse whitespace and normalize property separators for comparison. */
function normalizeBody(body: string): string {
  return body
    .replace(/\/\*.*?\*\//gs, '') // strip comments
    .replace(/\s+/g, ' ')
    .replace(/\s*:\s*/g, ':')
    .replace(/\s*;\s*/g, ';')
    .replace(/\s*\{\s*/g, '{')
    .replace(/\s*\}\s*/g, '}')
    .trim()
}

/** Normalise a selector for use as a dedup key. */
function normalizeSelector(selector: string): string {
  return selector.replace(/\s+/g, ' ').trim()
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

interface ParsedMediaBlock extends CssBlock {
  type: 'media'
  _inner: CssBlock[]
}

type ParsedBlock = CssBlock | ParsedMediaBlock

type IndexedBlock = CssBlock & { originalIndex: number; _inner?: CssBlock[] }

/**
 * Lightweight brace-balanced CSS parser.
 *
 * Extracts top-level blocks from `css`. When `context` is non-empty the
 * blocks are understood to be nested inside that at-rule (e.g. @media).
 *
 * Handles:
 *   - Block comments  /* ... *\/
 *   - @keyframes name { … }
 *   - @media / @supports / other at-rules with a body { … }
 *   - Plain selector { … } rules
 */
function parseCssBlocks(css: string, context: string): ParsedBlock[] {
  const blocks: ParsedBlock[] = []
  let i = 0
  const len = css.length

  while (i < len) {
    // Skip whitespace
    if (/\s/.test(css[i])) {
      i++
      continue
    }

    // Block comment
    if (css[i] === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2)
      const commentEnd = end === -1 ? len : end + 2
      blocks.push({
        type: 'comment',
        selector: '',
        body: '',
        context,
        raw: css.slice(i, commentEnd)
      })
      i = commentEnd
      continue
    }

    // Find end of selector / at-rule header (up to first '{' or ';')
    const headerStart = i
    let headerEnd = i

    // Scan forward to locate the opening brace or semicolon
    while (headerEnd < len && css[headerEnd] !== '{' && css[headerEnd] !== ';') {
      headerEnd++
    }

    if (headerEnd >= len) {
      // Trailing content with no brace — treat as 'other'
      const remaining = css.slice(i).trim()
      if (remaining) {
        blocks.push({ type: 'other', selector: '', body: '', context, raw: remaining })
      }
      break
    }

    if (css[headerEnd] === ';') {
      // At-rule without body (e.g. @import, @charset) — treat as 'other'
      const raw = css.slice(headerStart, headerEnd + 1)
      blocks.push({ type: 'other', selector: '', body: '', context, raw })
      i = headerEnd + 1
      continue
    }

    // css[headerEnd] === '{'
    const selector = css.slice(headerStart, headerEnd).trim()

    // Find matching closing brace
    let depth = 1
    const bodyStart = headerEnd + 1
    let j = bodyStart

    while (j < len && depth > 0) {
      if (css[j] === '{') depth++
      else if (css[j] === '}') depth--
      j++
    }

    const body = css.slice(bodyStart, j - 1)
    const raw = css.slice(headerStart, j)

    // Determine block type
    const selectorNorm = normalizeSelector(selector)

    if (/^@keyframes\s+/i.test(selectorNorm)) {
      // @keyframes <name>
      const nameMatch = selectorNorm.match(/^@keyframes\s+(\S+)/i)
      const name = nameMatch ? nameMatch[1] : selectorNorm
      blocks.push({ type: 'keyframes', selector: name, body, context, raw })
    } else if (/^@media\b|^@supports\b/i.test(selectorNorm)) {
      // @media / @supports — recurse into body for inner dedup
      const innerBlocks = parseCssBlocks(body, selectorNorm)
      blocks.push({
        type: 'media',
        selector: selectorNorm,
        body,
        context,
        raw,
        _inner: innerBlocks
      } as ParsedMediaBlock)
    } else {
      blocks.push({ type: 'rule', selector: selectorNorm, body, context, raw })
    }

    i = j
  }

  return blocks
}

// ---------------------------------------------------------------------------
// Dedup logic
// ---------------------------------------------------------------------------

type BlockWithIndex = IndexedBlock

interface DedupBlocksResult {
  kept: BlockWithIndex[]
  removed: CssBlock[]
  warnings: string[]
}

/**
 * Deduplicate a flat list of blocks (all sharing the same context level).
 *
 * - Exact duplicates (same selector + normalised body): keep last, remove rest.
 * - Near-duplicates (same selector, different body): warn, keep all.
 * - Other block types (media, comment, other): pass through unchanged.
 */
function dedupBlocks(blocks: BlockWithIndex[]): DedupBlocksResult {
  const removed: CssBlock[] = []
  const warnings: string[] = []

  type KeyEntry = { block: BlockWithIndex; idx: number }
  const keyMap = new Map<string, KeyEntry[]>()

  for (let idx = 0; idx < blocks.length; idx++) {
    const block = blocks[idx]
    if (block.type !== 'rule' && block.type !== 'keyframes') continue

    const key = `${block.context}|||${block.selector}`
    const existing = keyMap.get(key) ?? []
    existing.push({ block, idx })
    keyMap.set(key, existing)
  }

  const removeSet = new Set<number>()

  for (const entries of keyMap.values()) {
    if (entries.length <= 1) continue

    // Group by normalised body
    const byBody = new Map<string, KeyEntry[]>()
    for (const entry of entries) {
      const normBody = normalizeBody(entry.block.body)
      const group = byBody.get(normBody) ?? []
      group.push(entry)
      byBody.set(normBody, group)
    }

    if (byBody.size === 1) {
      // All occurrences are exact duplicates — keep last, remove the rest
      const lastIdx = entries[entries.length - 1].idx
      for (const { block, idx } of entries) {
        if (idx !== lastIdx) {
          removeSet.add(idx)
          removed.push(block)
        }
      }
    } else {
      // Near-duplicates: same selector, different bodies — warn, keep all
      const selector = entries[0].block.selector
      const context = entries[0].block.context
      const ctxLabel = context ? ` (inside ${context})` : ''
      warnings.push(
        `Near-duplicate selector "${selector}"${ctxLabel} — ${byBody.size} different definitions found. All kept.`
      )
    }
  }

  const kept = blocks.filter((_, idx) => !removeSet.has(idx))
  return { kept, removed, warnings }
}

// ---------------------------------------------------------------------------
// Rebuild output
// ---------------------------------------------------------------------------

interface MediaBlockDeduped {
  block: BlockWithIndex
  dedupedInner: DedupBlocksResult
}

function processMediaBlock(block: BlockWithIndex): MediaBlockDeduped {
  const inner = block._inner ?? []
  const innerWithIdx: BlockWithIndex[] = inner.map((b, i) => ({ ...b, originalIndex: i }))
  const dedupedInner = dedupBlocks(innerWithIdx)
  return { block, dedupedInner }
}

function buildMediaRaw(processed: MediaBlockDeduped): string {
  const { block, dedupedInner } = processed
  const headerMatch = block.raw.match(/^([^{]*)/)
  const header = headerMatch ? headerMatch[1].trim() : block.selector
  const innerCss = dedupedInner.kept.map((b) => b.raw).join('\n')
  return `${header} {\n${innerCss}\n}`
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function deduplicateCss(css: string): DedupResult {
  if (!css.trim()) {
    return { deduplicated: '', removed: [], warnings: [] }
  }

  const parsed = parseCssBlocks(css, '')
  const blocksWithIdx: BlockWithIndex[] = parsed.map((b, i) => ({ ...b, originalIndex: i }))

  const { kept, removed: topRemoved, warnings: topWarnings } = dedupBlocks(blocksWithIdx)

  // Process @media blocks to dedup their inner rules
  const mediaDeduped = new Map<number, MediaBlockDeduped>()
  for (const block of kept) {
    if (block.type === 'media') {
      mediaDeduped.set(block.originalIndex, processMediaBlock(block))
    }
  }

  // Collect inner removals and warnings
  const innerRemoved: CssBlock[] = []
  const innerWarnings: string[] = []
  for (const processed of mediaDeduped.values()) {
    innerRemoved.push(...processed.dedupedInner.removed)
    innerWarnings.push(...processed.dedupedInner.warnings)
  }

  // Rebuild output
  const parts: string[] = []
  for (const block of kept) {
    if (block.type === 'media') {
      const processed = mediaDeduped.get(block.originalIndex)
      parts.push(processed ? buildMediaRaw(processed) : block.raw)
    } else {
      parts.push(block.raw)
    }
  }

  return {
    deduplicated: parts.join('\n'),
    removed: [...topRemoved, ...innerRemoved],
    warnings: [...topWarnings, ...innerWarnings]
  }
}
