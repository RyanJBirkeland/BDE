import { useState, useCallback, useEffect, useMemo } from 'react'
import { motion } from 'framer-motion'
import { FileCode2 } from 'lucide-react'
import { EmptyState } from '../components/ui/EmptyState'
import { PRStationList } from '../components/pr-station/PRStationList'
import { PRStationDetail } from '../components/pr-station/PRStationDetail'
import { PRStationActions } from '../components/pr-station/PRStationActions'
import { PRStationDiff } from '../components/pr-station/PRStationDiff'
import { PRStationFilters, type PRFilters } from '../components/pr-station/PRStationFilters'
import { ReviewSubmitDialog } from '../components/pr-station/ReviewSubmitDialog'
import { Button } from '../components/ui/Button'
import { ConfirmModal, useConfirm } from '../components/ui/ConfirmModal'
import { getPrMergeability, type PrMergeability } from '../lib/github-api'
import { usePendingReviewStore } from '../stores/pendingReview'
import type { OpenPr } from '../../../shared/types'
import { REPO_OPTIONS } from '../lib/constants'
import { VARIANTS, SPRINGS, REDUCED_TRANSITION, useReducedMotion } from '../lib/motion'

type DetailTab = 'info' | 'diff'

export default function PRStationView() {
  const reduced = useReducedMotion()
  const [selectedPr, setSelectedPr] = useState<OpenPr | null>(null)
  const [removedKeys, setRemovedKeys] = useState<Set<string>>(new Set())
  const [mergeability, setMergeability] = useState<PrMergeability | null>(null)
  const [activeTab, setActiveTab] = useState<DetailTab>('info')
  const [showReviewDialog, setShowReviewDialog] = useState(false)
  const [allPrs, setAllPrs] = useState<OpenPr[]>([])
  const [filters, setFilters] = useState<PRFilters>({ repo: null, sort: 'updated' })
  const prKey = selectedPr ? `${selectedPr.repo}#${selectedPr.number}` : ''
  const pendingCount = usePendingReviewStore((s) =>
    prKey ? (s.pendingComments[prKey] ?? []).length : 0
  )

  const repos = useMemo(
    () => [...new Set(allPrs.map((pr) => pr.repo))],
    [allPrs]
  )

  const filteredPrs = useMemo(() => {
    let result = allPrs
    if (filters.repo !== null) {
      result = result.filter((pr) => pr.repo === filters.repo)
    }
    if (filters.sort === 'created') {
      result = [...result].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      )
    } else if (filters.sort === 'title') {
      result = [...result].sort((a, b) => a.title.localeCompare(b.title))
    } else {
      // 'updated' — default order from the poller (already sorted by updated_at desc)
      result = [...result].sort(
        (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
      )
    }
    return result
  }, [allPrs, filters])

  const { confirm, confirmProps } = useConfirm()

  const handleRemovePr = useCallback(
    (pr: OpenPr) => {
      setRemovedKeys((prev) => {
        const next = new Set(prev)
        next.add(`${pr.repo}-${pr.number}`)
        // Evict oldest entries when the set grows beyond a reasonable bound
        if (next.size > 200) {
          let toDelete = next.size - 200
          for (const key of next) {
            if (toDelete <= 0) break
            next.delete(key)
            toDelete--
          }
        }
        return next
      })
      setSelectedPr(null)
    },
    []
  )

  /**
   * Attempt to select a PR, showing a confirmation if there are pending comments
   * on the current PR (informational — comments are persisted to localStorage).
   */
  const handleSelectPr = useCallback(async (pr: OpenPr) => {
    if (pendingCount > 0 && selectedPr && pr.number !== selectedPr.number) {
      const ok = await confirm({
        title: 'Pending review comments',
        message: `You have ${pendingCount} pending comment${pendingCount > 1 ? 's' : ''} on this PR. Your comments are saved and will be here when you return. Switch PRs anyway?`,
        confirmLabel: 'Switch PR',
        variant: 'default',
      })
      if (!ok) return
    }

    setSelectedPr(pr)
  }, [pendingCount, selectedPr, confirm])

  useEffect(() => {
    if (!selectedPr) {
      setMergeability(null)
      return
    }
    setMergeability(null)
    const repo = REPO_OPTIONS.find((r) => r.label === selectedPr.repo)
    if (!repo) return
    const controller = new AbortController()
    getPrMergeability(repo.owner, repo.label, selectedPr.number, controller.signal)
      .then((m) => {
        if (!controller.signal.aborted) setMergeability(m)
      })
      .catch(() => {
        // AbortError expected on cleanup; non-abort errors leave mergeability null
      })
    return () => {
      controller.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prKey])

  return (
    <motion.div className="pr-station-wrapper" style={{ display: 'flex', flexDirection: 'column', height: '100%' }} variants={VARIANTS.fadeIn} initial="initial" animate="animate" transition={reduced ? REDUCED_TRANSITION : SPRINGS.snappy}>
      <div className="pr-station__view-header">
        <span className="pr-station__view-title text-gradient-aurora">PR Station</span>
      </div>
      <div className="pr-station" style={{ flex: 1, minHeight: 0 }}>
      <div className="pr-station__list-panel">
        <PRStationFilters filters={filters} repos={repos} onChange={setFilters} />
        <PRStationList
          selectedPr={selectedPr}
          onSelectPr={handleSelectPr}
          removedKeys={removedKeys}
          prs={filteredPrs}
          onPrsChange={setAllPrs}
        />
      </div>
      <div className="pr-station__detail-panel">
        {selectedPr ? (
          <>
            <div className="pr-station__detail-header">
              <span className="pr-station__detail-title">
                #{selectedPr.number} — {selectedPr.title}
              </span>
              <div className="pr-station__tabs">
                <button
                  className={`pr-station__tab${activeTab === 'info' ? ' pr-station__tab--active' : ''}`}
                  onClick={() => setActiveTab('info')}
                >
                  Info
                </button>
                <button
                  className={`pr-station__tab${activeTab === 'diff' ? ' pr-station__tab--active' : ''}`}
                  onClick={() => setActiveTab('diff')}
                >
                  Diff
                </button>
              </div>
            </div>
            {pendingCount > 0 && (
              <div className="pr-review-banner">
                <span className="pr-review-banner__count">{pendingCount}</span>
                <span>pending comment{pendingCount > 1 ? 's' : ''}</span>
                <Button
                  className="pr-review-banner__submit"
                  variant="primary"
                  size="sm"
                  onClick={() => setShowReviewDialog(true)}
                >
                  Submit Review
                </Button>
              </div>
            )}
            {activeTab === 'info' ? (
              <div className="pr-station__detail-content">
                <PRStationDetail
                  key={`${selectedPr.repo}-${selectedPr.number}`}
                  pr={selectedPr}
                  mergeability={mergeability}
                  onMerged={handleRemovePr}
                />
                <PRStationActions
                  pr={selectedPr}
                  mergeability={mergeability}
                  onRemovePr={handleRemovePr}
                />
              </div>
            ) : (
              <PRStationDiff pr={selectedPr} />
            )}
          </>
        ) : (
          <EmptyState
            icon={<FileCode2 size={32} strokeWidth={1} />}
            title="Select a PR to view details"
          />
        )}
      </div>
      {showReviewDialog && selectedPr && (
        <ReviewSubmitDialog
          pr={selectedPr}
          prKey={prKey}
          onClose={() => setShowReviewDialog(false)}
          onSubmitted={() => {
            const pr = selectedPr
            setSelectedPr(null)
            setTimeout(() => setSelectedPr(pr), 0)
          }}
        />
      )}
    </div>
    <ConfirmModal {...confirmProps} />
    </motion.div>
  )
}
