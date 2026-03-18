import { useState, useCallback, useEffect } from 'react'
import { FileCode2 } from 'lucide-react'
import { PRStationList } from '../components/pr-station/PRStationList'
import { PRStationActions } from '../components/pr-station/PRStationActions'
import { PRStationDiff } from '../components/pr-station/PRStationDiff'
import { getPrMergeability, type PullRequest, type PrMergeability } from '../lib/github-api'
import { REPO_OPTIONS } from '../lib/constants'

type DetailTab = 'info' | 'diff'

export default function PRStationView() {
  const [selectedPr, setSelectedPr] = useState<PullRequest | null>(null)
  const [removedKeys, setRemovedKeys] = useState<Set<string>>(new Set())
  const [mergeability, setMergeability] = useState<PrMergeability | null>(null)
  const [activeTab, setActiveTab] = useState<DetailTab>('diff')

  const handleRemovePr = useCallback(
    (pr: PullRequest) => {
      setRemovedKeys((prev) => new Set(prev).add(`${pr.repo}-${pr.number}`))
      setSelectedPr(null)
    },
    []
  )

  useEffect(() => {
    if (!selectedPr) {
      setMergeability(null)
      return
    }
    const repo = REPO_OPTIONS.find((r) => r.label === selectedPr.repo)
    if (!repo) return
    let cancelled = false
    getPrMergeability(repo.owner, repo.label, selectedPr.number).then((m) => {
      if (!cancelled) setMergeability(m)
    })
    return () => {
      cancelled = true
    }
  }, [selectedPr?.number, selectedPr?.repo])

  return (
    <div className="pr-station">
      <div className="pr-station__list-panel">
        <PRStationList
          selectedPr={selectedPr}
          onSelectPr={setSelectedPr}
          removedKeys={removedKeys}
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
            {activeTab === 'info' ? (
              <div className="pr-station__detail-content">
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
          <div className="pr-station__empty-detail">
            <FileCode2 size={32} strokeWidth={1} />
            <span>Select a PR to view details</span>
          </div>
        )}
      </div>
    </div>
  )
}
