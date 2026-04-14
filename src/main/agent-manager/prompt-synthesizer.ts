/**
 * prompt-synthesizer.ts — Synthesizer agent prompt builder
 */

import { synthesizerPersonality } from '../agent-system/personality/synthesizer-personality'
import { getUserMemory } from '../agent-system/memory/user-memory'
import {
  SPEC_DRAFTING_PREAMBLE,
  PLAYGROUND_INSTRUCTIONS,
  buildPersonalitySection,
  buildUpstreamContextSection
} from './prompt-sections'
import type { BuildPromptInput } from './prompt-composer'

const SYNTHESIZER_SPEC_REQUIREMENTS = `

## Spec Quality Requirements

You MUST produce a spec with ALL four of the following sections, in this exact order:

### 1. \`## Overview\`
2–3 sentences: what this task does and why. No implementation details here.

### 2. \`## Files to Change\`
Bulleted list of exact file paths (e.g. \`src/main/foo.ts\`). Include every file the
pipeline agent will need to touch. Maximum 10 files.

### 3. \`## Implementation Steps\`
Numbered list (1., 2., 3. ...). Each step MUST be a concrete action:
- GOOD: "Add function \`validateFoo()\` to \`src/main/foo.ts\`"
- GOOD: "Update the import in \`src/bar.ts\` to include \`FooType\`"
- BAD: "Decide how to handle the error"
- BAD: "Investigate existing patterns"
- BAD: "Consider using X or Y"
- BAD: "Research the best approach"

No exploration, analysis, or decision steps. Maximum 15 steps.

### 4. \`## How to Test\`
Concrete commands or steps to verify the change works. Examples:
- "Run \`npm test\` — all tests must pass"
- "Open Settings tab and verify X appears"
- "Run \`npm run typecheck\` — zero errors"

## Additional Constraints

- Keep the total spec under 500 words
- The pipeline agent receiving this spec will EXECUTE instructions only — it must not
  need to make any design decisions. Every decision must be made in this spec.
- Do not leave open questions, options, or alternatives in the spec. Pick one approach
  and describe it concretely.

## Validation Reminder

Before outputting the spec, review each Implementation Step and confirm it is a concrete
action, not a thinking/analysis step. Replace any vague step with an explicit instruction.`

export function buildSynthesizerPrompt(input: BuildPromptInput): string {
  const { codebaseContext, taskContent, playgroundEnabled, upstreamContext } = input

  let prompt = SPEC_DRAFTING_PREAMBLE

  // Inject personality
  prompt += buildPersonalitySection(synthesizerPersonality)

  // Inject spec quality requirements (the core enforcement block)
  prompt += SYNTHESIZER_SPEC_REQUIREMENTS

  // Inject user memory
  const userMem = getUserMemory()
  if (userMem.fileCount > 0) {
    prompt += '\n\n## User Knowledge\n'
    prompt += userMem.content
  }

  // Playground (default off for synthesizer)
  if (playgroundEnabled) {
    prompt += PLAYGROUND_INSTRUCTIONS
  }

  // Codebase context
  if (codebaseContext) {
    prompt += '\n\n## Codebase Context\n\n<codebase_context>\n' + codebaseContext + '\n</codebase_context>'
  }

  // Generation instructions
  if (taskContent) {
    prompt += '\n\n## Generation Instructions\n\n<generation_instructions>\n' + taskContent + '\n</generation_instructions>'
  }

  // Upstream task context
  prompt += buildUpstreamContextSection(upstreamContext)

  return prompt
}
