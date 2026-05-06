import { describe, it, expect, vi, beforeEach } from 'vitest'
import { killPipelineAgent, triggerDrain } from '../agentManager'

describe('agentManager service', () => {
  beforeEach(() => {
    vi.mocked(window.api.agentManager.kill).mockResolvedValue({ ok: true })
    vi.mocked(window.api.agentManager.triggerDrain).mockResolvedValue(undefined)
  })

  it('killPipelineAgent delegates to window.api.agentManager.kill', async () => {
    await killPipelineAgent('task-1')
    expect(window.api.agentManager.kill).toHaveBeenCalledWith('task-1')
  })

  it('triggerDrain delegates to window.api.agentManager.triggerDrain', async () => {
    await triggerDrain()
    expect(window.api.agentManager.triggerDrain).toHaveBeenCalled()
  })
})
