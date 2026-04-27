import type { View } from '../stores/panelLayout'
import type { LucideIcon } from 'lucide-react'
import { VIEW_REGISTRY } from './view-registry'

export interface FeatureGuide {
  view: View
  label: string
  icon: LucideIcon
  shortcut: string
  description: string
  features: string[]
  usage: string
}

export const FEATURE_GUIDES: Record<View, FeatureGuide> = {
  dashboard: {
    view: 'dashboard',
    label: VIEW_REGISTRY.dashboard.label,
    icon: VIEW_REGISTRY.dashboard.icon,
    shortcut: VIEW_REGISTRY.dashboard.shortcut,
    description:
      'Overview of task pipeline health, agent execution metrics, and recent activity. Your command center for monitoring FLEET.',
    features: [
      'Status counters showing active, queued, blocked, and completed tasks',
      'Pipeline flow visualization across all task stages',
      'Charts for hourly completions, cost trends, and success rates',
      'Activity feed of recent agent events and completions',
      'Real-time cost tracking and 24h totals'
    ],
    usage: 'Use Dashboard as your starting point to assess system health and identify bottlenecks.'
  },
  agents: {
    view: 'agents',
    label: VIEW_REGISTRY.agents.label,
    icon: VIEW_REGISTRY.agents.icon,
    shortcut: VIEW_REGISTRY.agents.shortcut,
    description:
      'Interactive agent sessions. Spawn adhoc agents for one-off tasks or launch the FLEET Assistant for conversational help.',
    features: [
      'Multi-turn conversations with agent sessions',
      'Dev Playground for HTML rendering (visual prototyping, UI tools)',
      'Session history with agent metadata and model info',
      'Real-time streaming responses with tool use visibility',
      'Spawn button for adhoc tasks and assistant mode toggle'
    ],
    usage:
      'Spawn agents for tasks outside the pipeline, or use assistant mode for guidance and recommendations.'
  },
  ide: {
    view: 'ide',
    label: VIEW_REGISTRY.ide.label,
    icon: VIEW_REGISTRY.ide.icon,
    shortcut: VIEW_REGISTRY.ide.shortcut,
    description:
      'Integrated code editor with Monaco, file explorer, and terminal. Full-featured development environment inside FLEET.',
    features: [
      'Monaco editor with syntax highlighting and multi-tab interface',
      'File explorer tree with expand/collapse state persistence',
      'Multi-tab integrated terminal with split panes',
      'Keyboard shortcuts for open, save, close, sidebar toggle',
      'State persistence for open tabs and active file'
    ],
    usage:
      'Use IDE for code editing, terminal commands, and file management without leaving FLEET. Cmd+B toggles sidebar, Cmd+J toggles terminal.'
  },
  sprint: {
    view: 'sprint',
    label: VIEW_REGISTRY.sprint.label,
    icon: VIEW_REGISTRY.sprint.icon,
    shortcut: VIEW_REGISTRY.sprint.shortcut,
    description:
      'Execution monitoring view. Watch tasks flow through stages as a vertical pipeline with real-time status updates.',
    features: [
      'Three-zone layout: backlog, pipeline stages, task detail drawer',
      'Task dependency visualization with hard and soft edges',
      'Status transitions: backlog → queued → blocked → active → review → done',
      'Real-time agent progress with commit history',
      'Task detail drawer with full specs, commits, and agent logs'
    ],
    usage:
      'Monitor pipeline execution here. Tasks progress automatically as agents complete work. Click a task to see details.'
  },
  'code-review': {
    view: 'code-review',
    label: VIEW_REGISTRY['code-review'].label,
    icon: VIEW_REGISTRY['code-review'].icon,
    shortcut: VIEW_REGISTRY['code-review'].shortcut,
    description:
      'Human-in-the-loop review interface. Inspect agent work before integration with diffs, commits, and conversation logs.',
    features: [
      'Review queue showing all tasks awaiting human approval',
      'Diff inspection with syntax highlighting (additions, deletions, context)',
      'Commit history for all changes in the agent branch',
      'Conversation tab with full agent chat log',
      'Actions: merge locally, create PR, request revision, discard'
    ],
    usage:
      'Review agent work here before integration. Agents stop at review status instead of auto-merging.'
  },
  git: {
    view: 'git',
    label: VIEW_REGISTRY.git.label,
    icon: VIEW_REGISTRY.git.icon,
    shortcut: VIEW_REGISTRY.git.shortcut,
    description:
      'Git workflow interface for staging, committing, and pushing across configured repositories.',
    features: [
      'Multi-repo support with repository and branch selectors',
      'File sections: staged, modified (unstaged), untracked',
      'Stage/unstage individual files or entire sections',
      'Commit and push with loading state feedback',
      'Inline diff preview drawer for any file'
    ],
    usage: 'Use Source Control for manual git operations. Auto-refreshes every 30s while visible.'
  },
  settings: {
    view: 'settings',
    label: VIEW_REGISTRY.settings.label,
    icon: VIEW_REGISTRY.settings.icon,
    shortcut: VIEW_REGISTRY.settings.shortcut,
    description:
      'Application configuration organized into 9 tabs. Manage connections, repos, agents, and appearance.',
    features: [
      'Connections: GitHub token and Claude API auth',
      'Repositories: Add/remove repos with local paths',
      'Agent: SDK model selection and API key display',
      'Agent Manager: Max concurrent agents, worktree paths, runtime limits',
      'Appearance: Theme toggle, motion preferences'
    ],
    usage:
      'Configure FLEET here. Most settings persist to SQLite. Agent Manager changes require app restart.'
  },
  planner: {
    view: 'planner',
    label: VIEW_REGISTRY.planner.label,
    icon: VIEW_REGISTRY.planner.icon,
    shortcut: VIEW_REGISTRY.planner.shortcut,
    description:
      'Task planning and epic management. Break down large features into coordinated task sequences with dependencies.',
    features: [
      'Epic creation with multi-task planning',
      'Dependency graph visualization',
      'Task ordering and relationship management',
      'Spec templates for common task patterns',
      'Integration with Task Workbench for execution'
    ],
    usage:
      'Use Planner for multi-step features. Create epics with dependencies, then queue tasks from Task Workbench.'
  }
}

export const FEATURE_GUIDE_ORDER: View[] = [
  'dashboard',
  'agents',
  'ide',
  'sprint',
  'code-review',
  'git',
  'planner',
  'settings'
]
