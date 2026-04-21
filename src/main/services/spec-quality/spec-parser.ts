import type { ISpecParser } from '../../../shared/spec-quality/interfaces'
import type { ParsedSection, ParsedSpec } from '../../../shared/spec-quality/types'

/**
 * Matches ## and ### headings only (not # h1 or #### deeper).
 * Group 1 = hashes, Group 2 = heading text.
 */
const HEADING_PATTERN = /^(#{2,3})\s+(.+)$/

export class SpecParser implements ISpecParser {
  parse(raw: string): ParsedSpec {
    const wordCount = raw.trim() === '' ? 0 : raw.trim().split(/\s+/).length
    const sections = this.parseSections(raw)
    return { raw, wordCount, sections }
  }

  private parseSections(raw: string): ParsedSection[] {
    if (raw.trim() === '') {
      return []
    }

    const lines = raw.split('\n')
    const sections: ParsedSection[] = []

    let currentSection: { heading: string; level: number; contentLines: string[] } | null = null

    for (const line of lines) {
      const match = HEADING_PATTERN.exec(line)
      if (match !== null && match[1] && match[2] !== undefined) {
        const hashes = match[1]
        const headingText = match[2]
        const level = hashes.length

        // Flush the previous section
        if (currentSection !== null) {
          sections.push({
            heading: currentSection.heading,
            level: currentSection.level,
            content: currentSection.contentLines.join('\n').trim()
          })
        }

        currentSection = {
          heading: `${hashes} ${headingText}`,
          level,
          contentLines: []
        }
      } else if (currentSection !== null) {
        currentSection.contentLines.push(line)
      }
    }

    // Flush the last section
    if (currentSection !== null) {
      sections.push({
        heading: currentSection.heading,
        level: currentSection.level,
        content: currentSection.contentLines.join('\n').trim()
      })
    }

    return sections
  }
}
