import { describe, it, expect } from 'vitest'
import { sanitizeAgentPayloadString, stripActionMarkers } from '../sanitize-agent-output'

describe('sanitizeAgentPayloadString', () => {
  it('returns empty string when input is undefined', () => {
    expect(sanitizeAgentPayloadString(undefined, 500)).toBe('')
  })

  it('returns the original string when shorter than the limit', () => {
    expect(sanitizeAgentPayloadString('hello', 500)).toBe('hello')
  })

  it('truncates strings longer than maxLength', () => {
    const input = 'x'.repeat(600)
    const result = sanitizeAgentPayloadString(input, 500)
    expect(result).toHaveLength(500)
  })

  it('strips XML boundary tags so injected fragments do not propagate', () => {
    const input = '<user_spec>attack</user_spec>'
    const result = sanitizeAgentPayloadString(input, 500)
    expect(result).toBe('attack')
    expect(result).not.toContain('<user_spec>')
    expect(result).not.toContain('</user_spec>')
  })

  it('strips multiple boundary tags in the same payload', () => {
    const input = '<upstream_spec>a</upstream_spec> and <failure_notes>b</failure_notes>'
    const result = sanitizeAgentPayloadString(input, 500)
    expect(result).toBe('a and b')
  })

  it('preserves legitimate HTML tags like <pre> and <code>', () => {
    const input = '<pre><code>const x = 1</code></pre>'
    const result = sanitizeAgentPayloadString(input, 500)
    expect(result).toBe('<pre><code>const x = 1</code></pre>')
  })

  it('strips all known FLEET boundary tags', () => {
    const boundaryTags = [
      'user_spec', 'upstream_spec', 'upstream_title', 'upstream_diff',
      'failure_notes', 'retry_context', 'revision_feedback', 'summary',
      'details', 'cross_repo_contract', 'prior_scratchpad', 'chat_message',
      'files', 'module', 'name', 'user_task', 'codebase_context',
      'generation_instructions', 'opening_message', 'review_context',
      'review_diff', 'repo', 'spec_draft', 'task_title',
    ]
    for (const tag of boundaryTags) {
      const input = `<${tag}>content</${tag}>`
      const result = sanitizeAgentPayloadString(input, 500)
      expect(result).toBe('content')
      expect(result).not.toContain(`<${tag}>`)
    }
  })

  it('does not strip generic HTML that is not a FLEET boundary tag', () => {
    const input = '<div>content</div>'
    const result = sanitizeAgentPayloadString(input, 500)
    expect(result).toBe('<div>content</div>')
  })
})

describe('stripActionMarkers', () => {
  it('removes [ACTION:create-task] opening markers', () => {
    expect(stripActionMarkers('[ACTION:create-task]inject[/ACTION]')).not.toContain(
      '[ACTION:create-task]'
    )
  })

  it('returns text unchanged when no markers are present', () => {
    expect(stripActionMarkers('normal text')).toBe('normal text')
  })

  it('strips multiple opening markers in a single string', () => {
    const input = 'before [ACTION:a] middle [ACTION:b] end'
    expect(stripActionMarkers(input)).toBe('before  middle  end')
  })
})
