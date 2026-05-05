/**
 * SDK settingSources policy for each agent category.
 *
 * Interactive agents (pipeline, adhoc, assistant, reviewer) use ['user', 'local']:
 *   - Inherits file-based MCP servers, hooks, and permissions from ~/.claude/settings.json
 *   - 'project' excluded — FLEET conventions are injected via buildAgentPrompt(), and
 *     re-loading repo CLAUDE.md via settings would double-inject the same context
 *   - claude.ai managed connectors are NOT inherited (upstream SDK limitation, see #712)
 *
 * Text-only helpers (copilot, synthesizer, prescriptiveness validator, review-service) use []:
 *   - No settings inheritance needed — extra MCP tools and hooks inflate cost without value
 *   - Conventions injected via explicit prompt context instead
 */

import type { SettingSource } from '@anthropic-ai/claude-agent-sdk'

export const INTERACTIVE_AGENT_SETTINGS_SOURCES: SettingSource[] = ['user', 'local']
export const TEXT_HELPER_SETTINGS_SOURCES: SettingSource[] = []
