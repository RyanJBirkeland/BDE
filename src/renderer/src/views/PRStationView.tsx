import { useState, useCallback, useEffect } from 'react'
import { FileCode2 } from 'lucide-react'
import { PRStationList } from '../components/pr-station/PRStationList'
import { PRStationActions } from '../components/pr-station/PRStationActions'
import { getPrMergeability, type PullRequest, type PrMergeability } from '../lib/github-api'
import { REPO_OPTIONS } from '../lib/constants'

export default function PRStationView() {
  const [selectedPr, setSelectedPr] = useState<PullRequest | null>(null)
  const [removedKeys, setRemovedKeys] = useState<Set<string>>(new Set())
  const [mergeability, setMergeability] = useState<PrMergeability | null>(null)

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
          <div className="pr-station__detail-content">
            <div className="pr-station__detail-placeholder">
              <FileCode2 size={32} strokeWidth={1} />
              <span className="pr-station__detail-title">
                #{selectedPr.number} — {selectedPr.title}
              </span>
              <span className="pr-station__detail-hint">Detail panel coming soon</span>
            </div>
            <div className="pr-station__detail-footer">
              <PRStationActions
                pr={selectedPr}
                mergeability={mergeability}
                onRemovePr={handleRemovePr}
              />
            </div>
          </div>
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
