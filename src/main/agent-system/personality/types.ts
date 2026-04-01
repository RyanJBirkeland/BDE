/**
 * Agent personality definition - voice, role, constraints, patterns
 */
export interface AgentPersonality {
  voice: string          // Tone and style guidelines
  roleFrame: string      // Identity framing ("You are a...")
  constraints: string[]  // Hard boundaries and rules
  patterns: string[]     // Communication and behavior patterns
}

export type AgentType = 'pipeline' | 'assistant' | 'adhoc' | 'copilot' | 'synthesizer'
