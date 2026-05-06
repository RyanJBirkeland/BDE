/**
 * Private section components used exclusively by TaskDetailDrawerV2.
 * Kept separate to satisfy the <150 line constraint on the main file.
 */
import React from 'react'
import type { SprintTask } from '../../../../shared/types'
import { DrawerSection } from './primitives/DrawerSection'
import { MiniStat } from './primitives/MiniStat'
import { StatusDot } from '../ui/StatusDot'
import { statusToDotKind } from '../../lib/task-status'

// Security: BRANCH_PUSHED_PATTERN uses regex group captures to extract exactly the
// branch name and repo slug from the notes string. By extracting via groups rather
// than splitting on whitespace, any trailing tokens (injection attempts like
// "extra-garbage owner/repo") are silently ignored — only the captured groups
// are used to construct the URL, which is then individually validated by
// GH_REPO_PATTERN and GH_BRANCH_PATTERN before use.
export const GH_REPO_PATTERN = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/
export const GH_BRANCH_PATTERN = /^[a-zA-Z0-9/_.-]+$/
export const BRANCH_PUSHED_PATTERN = /Branch\s+(\S+)\s+pushed\s+to\s+(\S+)/

const textPretty = { textWrap: 'pretty' } as React.CSSProperties

export function SpecSection({
  task,
  onOpenSpec
}: {
  task: SprintTask
  onOpenSpec: () => void
}): React.JSX.Element {
  return (
    <DrawerSection eyebrow="BRIEF" title="Spec">
      {task.spec ? (
        <>
          <p
            style={{
              fontSize: 12,
              color: 'var(--fg-2)',
              lineHeight: 1.5,
              margin: 0,
              ...textPretty
            }}
          >
            {task.spec.length > 300 ? task.spec.substring(0, 300) + '…' : task.spec}
          </p>
          <button
            onClick={onOpenSpec}
            style={{
              alignSelf: 'flex-start',
              height: 24,
              padding: '0 var(--s-2)',
              background: 'transparent',
              border: '1px solid var(--line)',
              borderRadius: 'var(--r-md)',
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              color: 'var(--fg-2)',
              cursor: 'pointer'
            }}
          >
            edit spec ↗
          </button>
        </>
      ) : (
        <div
          style={{
            border: '1px dashed var(--line)',
            borderRadius: 'var(--r-md)',
            padding: 'var(--s-3)',
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--s-2)'
          }}
        >
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-4)' }}>
            No spec yet
          </span>
          <button
            onClick={onOpenSpec}
            style={{
              marginLeft: 'auto',
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              color: 'var(--fg-3)',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer'
            }}
          >
            Generate
          </button>
        </div>
      )}
    </DrawerSection>
  )
}

interface LiveRunSectionProps {
  task: SprintTask
  elapsed: string
  progressPct: number
  costUsd: number | null
}

export function LiveRunSection({
  task,
  elapsed,
  progressPct,
  costUsd
}: LiveRunSectionProps): React.JSX.Element {
  return (
    <DrawerSection eyebrow="LIVE" title="Agent run">
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        <span className="fleet-pulse" style={{ width: 6, height: 6, flexShrink: 0 }} />
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            color: 'var(--fg)',
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}
        >
          {task.title}
        </span>
        <span
          style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-2)', flexShrink: 0 }}
        >
          {progressPct}%
        </span>
      </div>
      <div style={{ height: 2, background: 'var(--surf-3)', borderRadius: 1 }}>
        <div
          style={{ height: '100%', width: `${progressPct}%`, background: 'var(--st-running)' }}
        />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--s-1)' }}>
        <MiniStat label="ELAPSED" value={elapsed || '—'} />
        <MiniStat label="COST" value={costUsd != null ? `$${costUsd.toFixed(2)}` : '—'} />
        {/* TODO(phase-3.5): needs token count from events */}
        <MiniStat label="TOKENS" value="—" />
      </div>
    </DrawerSection>
  )
}

interface DependenciesSectionProps {
  task: SprintTask
  depTasks: Array<{ id: string; title: string; status: SprintTask['status'] }>
  onSelectTask: (id: string) => void
}

export function DependenciesSection({
  task,
  depTasks,
  onSelectTask
}: DependenciesSectionProps): React.JSX.Element {
  return (
    <DrawerSection eyebrow="GRAPH" title="Dependencies">
      {(task.depends_on ?? []).map((dep) => {
        const depTask = depTasks.find((t) => t.id === dep.id)
        return (
          <button
            key={dep.id}
            onClick={() => onSelectTask(dep.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--s-2)',
              padding: '4px 0',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              width: '100%',
              textAlign: 'left'
            }}
          >
            <StatusDot kind={depTask ? statusToDotKind(depTask.status) : 'queued'} size={6} />
            <span
              style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--fg-4)', flexShrink: 0 }}
            >
              {dep.id.substring(0, 8)}
            </span>
            <span
              style={{
                fontSize: 11,
                color: 'var(--fg-2)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}
            >
              {depTask?.title ?? dep.id}
            </span>
          </button>
        )
      })}
    </DrawerSection>
  )
}

interface MetadataSectionProps {
  task: SprintTask
  agentRunId: string | null
  onViewAgents: (agentId: string) => void
}

export function MetadataSection({
  task,
  agentRunId,
  onViewAgents
}: MetadataSectionProps): React.JSX.Element {
  return (
    <DrawerSection eyebrow="META" title="Details">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-1)' }}>
        <MetaRow label="Created" value={formatTimestamp(task.created_at)} />
        {task.started_at && <MetaRow label="Started" value={formatTimestamp(task.started_at)} />}
        {task.completed_at && (
          <MetaRow label="Completed" value={formatTimestamp(task.completed_at)} />
        )}
        {task.pr_url && task.pr_number && (
          <MetaRow label="PR" value={`#${task.pr_number} (${task.pr_status ?? 'unknown'})`} />
        )}
        {agentRunId && (
          <button
            onClick={() => onViewAgents(agentRunId)}
            style={{
              alignSelf: 'flex-start',
              height: 24,
              padding: '0 var(--s-2)',
              background: 'transparent',
              border: '1px solid var(--line)',
              borderRadius: 'var(--r-md)',
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              color: 'var(--fg-2)',
              cursor: 'pointer',
              marginTop: 'var(--s-1)'
            }}
          >
            View in Agents →
          </button>
        )}
      </div>
    </DrawerSection>
  )
}

function MetaRow({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div style={{ display: 'flex', gap: 'var(--s-2)', alignItems: 'baseline' }}>
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          color: 'var(--fg-4)',
          flexShrink: 0,
          minWidth: 64
        }}
      >
        {label}
      </span>
      <span style={{ fontSize: 11, color: 'var(--fg-2)' }}>{value}</span>
    </div>
  )
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

interface BranchOnlySectionProps {
  notes: string | null | undefined
  ghConfigured: boolean
}

export function BranchOnlySection({
  notes,
  ghConfigured
}: BranchOnlySectionProps): React.JSX.Element {
  return (
    <DrawerSection eyebrow="PR" title="Branch pushed">
      <span
        data-testid="branch-only-section"
        style={{ fontSize: 11, color: 'var(--st-failed)' }}
      >
        PR creation failed after retries
      </span>
      {ghConfigured && buildBranchOnlyPrLink(notes)}
    </DrawerSection>
  )
}

export function buildBranchOnlyPrLink(notes: string | null | undefined): React.ReactNode {
  if (!notes) return null
  const match = notes.match(BRANCH_PUSHED_PATTERN)
  if (!match) return null
  const [, branch, ghRepo] = match
  if (!branch || !ghRepo) return null
  if (!GH_REPO_PATTERN.test(ghRepo)) return null
  if (!GH_BRANCH_PATTERN.test(branch)) return null
  const href = `https://github.com/${encodeURIComponent(ghRepo)}/pull/new/${encodeURIComponent(branch)}`
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      style={{
        alignSelf: 'flex-start',
        height: 24,
        padding: '0 var(--s-2)',
        background: 'var(--accent)',
        color: 'var(--accent-fg)',
        border: 'none',
        borderRadius: 'var(--r-md)',
        fontFamily: 'var(--font-mono)',
        fontSize: 10,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        textDecoration: 'none'
      }}
    >
      Create PR →
    </a>
  )
}
