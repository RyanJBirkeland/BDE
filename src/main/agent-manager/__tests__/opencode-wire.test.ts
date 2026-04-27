import { describe, it, expect } from 'vitest'
import { translateOpencodeEvent, extractOpencodeSessionId } from '../opencode-wire'

// Real event shapes captured from live opencode runs
const STEP_START_LINE =
  '{"type":"step_start","timestamp":1776922157414,"sessionID":"ses_abc","part":{"id":"prt_1","messageID":"msg_1","sessionID":"ses_abc","type":"step-start"}}'

const TEXT_LINE =
  '{"type":"text","timestamp":1776922161960,"sessionID":"ses_abc","part":{"id":"prt_2","messageID":"msg_1","sessionID":"ses_abc","type":"text","text":"Hello.","time":{"start":1776922161875,"end":1776922161959}}}'

const STEP_FINISH_STOP_LINE =
  '{"type":"step_finish","timestamp":1776922162124,"sessionID":"ses_abc","part":{"id":"prt_3","reason":"stop","messageID":"msg_1","sessionID":"ses_abc","type":"step-finish","tokens":{"total":14984,"input":14617,"output":47,"reasoning":320,"cache":{"write":0,"read":0}},"cost":0.042}}'

const STEP_FINISH_TOOL_CALLS_LINE =
  '{"type":"step_finish","timestamp":1776922162124,"sessionID":"ses_abc","part":{"id":"prt_3","reason":"tool-calls","messageID":"msg_1","sessionID":"ses_abc","type":"step-finish","tokens":{"total":100,"input":80,"output":20,"reasoning":0,"cache":{"write":0,"read":0}},"cost":0.001}}'

const TOOL_USE_LINE =
  '{"type":"tool","timestamp":1776922320554,"sessionID":"ses_abc","part":{"type":"tool","tool":"apply_patch","callID":"call_zErW","state":{"status":"completed","input":{"patchText":"*** Begin Patch\\n+hello\\n*** End Patch"},"output":"Success. Updated the following files:\\nA test.txt"},"id":"prt_4","sessionID":"ses_abc","messageID":"msg_2"}}'

const ERROR_LINE =
  '{"type":"error","timestamp":1776922149919,"sessionID":"ses_abc","error":{"name":"UnknownError","data":{"message":"Model not found: anthropic/claude-haiku-4-5."}}}'

describe('translateOpencodeEvent', () => {
  describe('step_start events', () => {
    it('returns empty array for step_start', () => {
      expect(translateOpencodeEvent(STEP_START_LINE)).toEqual([])
    })
  })

  describe('text events', () => {
    it('returns a single assistant message with a text content block', () => {
      const result = translateOpencodeEvent(TEXT_LINE)

      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Hello.' }]
        }
      })
    })
  })

  describe('tool_use events', () => {
    it('returns assistant tool_use message followed by user tool_result message for a completed call', () => {
      const result = translateOpencodeEvent(TOOL_USE_LINE)

      expect(result).toHaveLength(2)

      expect(result[0]).toEqual({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              name: 'apply_patch',
              id: 'call_zErW',
              input: { patchText: '*** Begin Patch\n+hello\n*** End Patch' }
            }
          ]
        }
      })

      expect(result[1]).toEqual({
        type: 'user',
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'call_zErW',
              content: 'Success. Updated the following files:\nA test.txt',
              is_error: false
            }
          ]
        }
      })
    })

    it('sets is_error true when tool call status is not completed', () => {
      const failedToolUseLine =
        '{"type":"tool","timestamp":100,"sessionID":"ses_abc","part":{"type":"tool","tool":"bash","callID":"call_fail","state":{"status":"error","input":{"command":"ls"},"output":"permission denied"},"id":"prt_5","sessionID":"ses_abc","messageID":"msg_3"}}'

      const result = translateOpencodeEvent(failedToolUseLine)

      expect(result).toHaveLength(2)
      expect(result[1]).toMatchObject({ message: { content: [{ is_error: true }] } })
    })

    it('falls back to empty object when tool state input is absent', () => {
      const noInputLine =
        '{"type":"tool","timestamp":100,"sessionID":"ses_abc","part":{"type":"tool","tool":"bash","callID":"call_noinput","state":{"status":"completed","output":"done"},"id":"prt_6","sessionID":"ses_abc","messageID":"msg_4"}}'

      const result = translateOpencodeEvent(noInputLine)

      expect(result).toHaveLength(2)
      expect(result[0]).toMatchObject({ message: { content: [{ input: {} }] } })
    })

    it('falls back to empty string when tool state output is absent', () => {
      const noOutputLine =
        '{"type":"tool","timestamp":100,"sessionID":"ses_abc","part":{"type":"tool","tool":"bash","callID":"call_noout","state":{"status":"completed","input":{}},"id":"prt_7","sessionID":"ses_abc","messageID":"msg_5"}}'

      const result = translateOpencodeEvent(noOutputLine)

      expect(result).toHaveLength(2)
      expect(result[1]).toMatchObject({ message: { content: [{ content: '' }] } })
    })
  })

  describe('step_finish events', () => {
    it('returns a result message with cost_usd when reason is stop', () => {
      const result = translateOpencodeEvent(STEP_FINISH_STOP_LINE)

      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({
        type: 'result',
        cost_usd: 0.042,
        stop_reason: 'end_turn'
      })
    })

    it('returns empty array when reason is tool-calls', () => {
      expect(translateOpencodeEvent(STEP_FINISH_TOOL_CALLS_LINE)).toEqual([])
    })
  })

  describe('error events', () => {
    it('returns an assistant text message with Error: prefix', () => {
      const result = translateOpencodeEvent(ERROR_LINE)

      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Error: Model not found: anthropic/claude-haiku-4-5.' }]
        }
      })
    })
  })

  describe('unknown event types', () => {
    it('returns empty array for an unrecognized type', () => {
      const unknownLine = '{"type":"session_start","sessionID":"ses_abc","data":{}}'
      expect(translateOpencodeEvent(unknownLine)).toEqual([])
    })
  })

  describe('malformed input', () => {
    it('returns empty array for invalid JSON', () => {
      expect(translateOpencodeEvent('not json at all')).toEqual([])
    })

    it('returns empty array for an empty string', () => {
      expect(translateOpencodeEvent('')).toEqual([])
    })

    it('returns empty array for a whitespace-only string', () => {
      expect(translateOpencodeEvent('   \t\n  ')).toEqual([])
    })
  })
})

describe('extractOpencodeSessionId', () => {
  it('returns the sessionID from a valid event line', () => {
    expect(extractOpencodeSessionId(TEXT_LINE)).toBe('ses_abc')
  })

  it('returns undefined for invalid JSON', () => {
    expect(extractOpencodeSessionId('not json')).toBeUndefined()
  })

  it('returns undefined when sessionID field is missing', () => {
    const noSessionId = '{"type":"text","timestamp":100}'
    expect(extractOpencodeSessionId(noSessionId)).toBeUndefined()
  })

  it('returns undefined for an empty string', () => {
    expect(extractOpencodeSessionId('')).toBeUndefined()
  })
})
