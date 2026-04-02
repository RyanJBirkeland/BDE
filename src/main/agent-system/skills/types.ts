/**
 * BDE skill definition - structured guidance for interactive agents
 */
export interface BDESkill {
  id: string              // Unique identifier (e.g., 'system-introspection')
  trigger: string         // When to suggest this skill
  description: string     // What it helps with
  guidance: string        // Markdown content (instructions, examples)
  capabilities?: string[] // Optional: IPC calls, DB queries this skill enables
}
