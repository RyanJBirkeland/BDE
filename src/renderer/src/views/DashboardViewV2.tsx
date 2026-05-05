import './DashboardV2.css'
import { useDashboardData } from '../components/dashboard/hooks/useDashboardData'
import { MissionBriefBand } from '../components/dashboard/MissionBriefBand'
import { ActiveAgentsCard } from '../components/dashboard/LiveColumn/ActiveAgentsCard'
import { PipelineGlanceCard } from '../components/dashboard/LiveColumn/PipelineGlanceCard'
import { ThroughputCard } from '../components/dashboard/LiveColumn/ThroughputCard'
import { AttentionCard } from '../components/dashboard/TriageColumn/AttentionCard'
import { ReviewQueueCard } from '../components/dashboard/TriageColumn/ReviewQueueCard'
import { RecentCompletionsCard } from '../components/dashboard/TriageColumn/RecentCompletionsCard'
import { KPIStrip } from '../components/dashboard/KPIStrip'
import { PerAgentStats } from '../components/dashboard/StatsAccordion/PerAgentStats'
import { PerRepoStats } from '../components/dashboard/StatsAccordion/PerRepoStats'

export default function DashboardViewV2(): React.JSX.Element {
  const { metrics, actions } = useDashboardData()
  const totalAttention =
    metrics.partitions.failed.length + metrics.partitions.blocked.length

  return (
    <main className="dashboard-v2" role="main" aria-label="Dashboard">
      <MissionBriefBand
        briefHeadlineParts={metrics.briefHeadlineParts}
        stats={metrics.stats}
        onOpenReview={actions.openReviewView}
        onOpenPlanner={actions.openPlannerView}
        onNewTask={actions.openNewTask}
      />

      <div className="dashboard-v2__columns">
        {/* Live column */}
        <div className="dashboard-v2__live-col">
          <ActiveAgentsCard
            agents={metrics.activeAgents}
            capacity={metrics.capacity}
            onOpenAgents={actions.openAgentsView}
            onSpawnOne={actions.openPlannerView}
          />
          <PipelineGlanceCard
            partitions={metrics.partitions}
            stats={metrics.stats}
            onOpenPipeline={actions.openPipelineView}
          />
          <ThroughputCard throughputData={metrics.throughputData} />
        </div>

        {/* Triage column */}
        <div className="dashboard-v2__triage-col">
          <AttentionCard
            items={metrics.attentionItems}
            totalCount={totalAttention}
            onOpenPipeline={(filter) =>
              actions.openPipelineView(filter === 'failed' ? 'failed' : 'blocked')
            }
            onOpenReview={actions.openReviewView}
            onRetryTask={actions.retryTask}
          />
          <ReviewQueueCard
            tasks={metrics.partitions.pendingReview}
            onOpenReview={actions.openReviewView}
          />
          <RecentCompletionsCard
            completions={metrics.recentCompletions}
            taskTokenMap={metrics.taskTokenMap}
          />
        </div>
      </div>

      <KPIStrip
        successRate7dAvg={metrics.successRate7dAvg}
        successRateWeekDelta={metrics.successRateWeekDelta}
        avgDuration={metrics.avgDuration}
        tokenAvg={metrics.tokenAvg}
        tokenTrendData={metrics.tokenTrendData}
        avgCostPerTask={metrics.avgCostPerTask}
        failureRate={metrics.failureRate}
        successTrendData={metrics.successTrendData}
      />

      <div className="dashboard-v2__stats">
        <PerAgentStats rows={metrics.perAgentStats} />
        <PerRepoStats rows={metrics.perRepoStats} />
      </div>
    </main>
  )
}
