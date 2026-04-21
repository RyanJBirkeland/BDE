import { describe, it, expect } from 'vitest'
import {
  buildReviewerPrompt,
  buildStructuredReviewPrompt,
  buildInteractiveReviewPrompt
} from '../prompt-composer-reviewer'
import type { ReviewResult } from '../../../shared/types'

const reviewSeed: ReviewResult = {
  qualityScore: 92,
  issuesCount: 3,
  filesCount: 8,
  openingMessage: 'Overall solid. A few items to address.',
  findings: { perFile: [] },
  model: 'claude-opus-4-6',
  createdAt: 0
}

describe('buildReviewerPrompt', () => {
  describe('review mode (JSON output, no tools)', () => {
    it('contains the JSON schema instructions', () => {
      const prompt = buildReviewerPrompt({
        agentType: 'reviewer',
        reviewerMode: 'review',
        taskContent: '# Spec\nImprove auth flow.',
        diff: 'diff --git a/file.ts b/file.ts\n+ new line',
        branch: 'feat/auth'
      })
      expect(prompt).toContain('qualityScore')
      expect(prompt).toContain('perFile')
      expect(prompt).toContain('openingMessage')
      expect(prompt).toContain('"security" | "performance" | "correctness" | "style"')
    })

    it('includes the task spec content', () => {
      const prompt = buildReviewerPrompt({
        agentType: 'reviewer',
        reviewerMode: 'review',
        taskContent: '# Spec\nImprove auth flow.',
        diff: '+ newline',
        branch: 'feat/auth'
      })
      expect(prompt).toContain('Improve auth flow.')
    })

    it('includes the diff', () => {
      const prompt = buildReviewerPrompt({
        agentType: 'reviewer',
        reviewerMode: 'review',
        taskContent: '# Spec',
        diff: 'UNIQUE_DIFF_MARKER_ABC123',
        branch: 'feat/x'
      })
      expect(prompt).toContain('UNIQUE_DIFF_MARKER_ABC123')
    })
  })

  describe('chat mode (tools enabled, conversation history)', () => {
    it('includes the prior auto-review seed context', () => {
      const prompt = buildReviewerPrompt({
        agentType: 'reviewer',
        reviewerMode: 'chat',
        taskContent: '# Spec',
        diff: '+ change',
        branch: 'feat/x',
        messages: [{ role: 'user', content: 'What are the risks?' }],
        reviewSeed
      })
      expect(prompt).toContain('Overall solid. A few items to address.')
      expect(prompt).toContain('92')
    })

    it('includes the conversation history', () => {
      const prompt = buildReviewerPrompt({
        agentType: 'reviewer',
        reviewerMode: 'chat',
        taskContent: '# Spec',
        diff: '+ change',
        branch: 'feat/x',
        messages: [
          { role: 'user', content: 'UNIQUE_USER_MARKER_42' },
          { role: 'assistant', content: 'UNIQUE_ASSISTANT_MARKER_43' }
        ],
        reviewSeed
      })
      expect(prompt).toContain('UNIQUE_USER_MARKER_42')
      expect(prompt).toContain('UNIQUE_ASSISTANT_MARKER_43')
    })

    it('does NOT include the JSON schema instructions', () => {
      const prompt = buildReviewerPrompt({
        agentType: 'reviewer',
        reviewerMode: 'chat',
        taskContent: '# Spec',
        diff: '+ change',
        branch: 'feat/x',
        messages: [{ role: 'user', content: 'Hi' }],
        reviewSeed
      })
      expect(prompt).not.toContain('Respond with ONLY a valid JSON object')
    })
  })
})

describe('direct builder exports', () => {
  it('buildStructuredReviewPrompt produces JSON schema output format', () => {
    const prompt = buildStructuredReviewPrompt({
      agentType: 'reviewer',
      taskContent: 'Fix auth bug',
      diff: '+ new line',
      branch: 'fix/auth'
    })
    expect(prompt).toContain('qualityScore')
    expect(prompt).toContain('perFile')
  })

  it('buildInteractiveReviewPrompt produces conversational format', () => {
    const prompt = buildInteractiveReviewPrompt({
      agentType: 'reviewer',
      taskContent: 'Fix auth bug',
      diff: '+ new line',
      branch: 'fix/auth',
      messages: [{ role: 'user', content: 'what about line 5?' }]
    })
    expect(prompt).toContain('what about line 5?')
    expect(prompt).not.toContain('qualityScore')
  })

  it('buildReviewerPrompt delegates to correct builder by mode', () => {
    const reviewPrompt = buildReviewerPrompt({
      agentType: 'reviewer',
      reviewerMode: 'review',
      diff: '',
      taskContent: ''
    })
    const chatPrompt = buildReviewerPrompt({
      agentType: 'reviewer',
      reviewerMode: 'chat',
      diff: '',
      taskContent: ''
    })
    expect(reviewPrompt).toContain('qualityScore')
    expect(chatPrompt).not.toContain('qualityScore')
  })
})

describe('XML injection safety', () => {
  it('wraps taskContent in review_context tags (structured)', () => {
    const prompt = buildStructuredReviewPrompt({
      agentType: 'reviewer',
      taskContent: 'INJECTIONTEST_TASK',
      diff: '+ change',
      branch: 'feat/x'
    })
    expect(prompt).toContain('<review_context>')
    expect(prompt).toContain('INJECTIONTEST_TASK')
    expect(prompt).toContain('</review_context>')
  })

  it('wraps diff in review_diff tags (structured)', () => {
    const prompt = buildStructuredReviewPrompt({
      agentType: 'reviewer',
      taskContent: '',
      diff: 'INJECTIONTEST_DIFF',
      branch: 'feat/x'
    })
    expect(prompt).toContain('<review_diff>')
    expect(prompt).toContain('INJECTIONTEST_DIFF')
    expect(prompt).toContain('</review_diff>')
  })

  it('wraps taskContent in review_context tags (interactive)', () => {
    const prompt = buildInteractiveReviewPrompt({
      agentType: 'reviewer',
      taskContent: 'INJECTIONTEST_TASK2',
      diff: '',
      branch: 'feat/x',
      messages: []
    })
    expect(prompt).toContain('<review_context>')
    expect(prompt).toContain('INJECTIONTEST_TASK2')
    expect(prompt).toContain('</review_context>')
  })

  it('wraps chat messages in chat_message block tags (interactive)', () => {
    const prompt = buildInteractiveReviewPrompt({
      agentType: 'reviewer',
      taskContent: '',
      diff: '',
      branch: 'feat/x',
      messages: [{ role: 'user', content: 'INJECTIONTEST_MSG' }]
    })
    expect(prompt).toContain('<chat_message>')
    expect(prompt).toContain('INJECTIONTEST_MSG')
    expect(prompt).toContain('</chat_message>')
  })
})
