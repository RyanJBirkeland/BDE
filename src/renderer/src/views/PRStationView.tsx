import { useState, useCallback, useEffect } from 'react'
import { FileCode2 } from 'lucide-react'
import { PRStationList } from '../components/pr-station/PRStationList'
import { PRStationDetail } from '../components/pr-station/PRStationDetail'
import { PRStationActions } from '../components/pr-station/PRStationActions'
import { PRStationDiff } from '../components/pr-station/PRStationDiff'
import { getPrMergeability, type PrMergeability } from '../lib/github-api'
import type { OpenPr } from '../../../shared/types'
import { REPO_OPTIONS } from '../lib/constants'

type DetailTab = 'info' | 'diff'

export default function PRStationView() {
  const [selectedPr, setSelectedPr] = useState<OpenPr | null>(null)
  const [removedKeys, setRemovedKeys] = useState<Set<string>>(new Set())
  const [mergeability, setMergeability] = useState<PrMergeability | null>(null)
  const [activeTab, setActiveTab] = useState<DetailTab>('info')

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

  const prKey = selectedPr ? `${selectedPr.repo}#${selectedPr.number}` : null

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
                <PRStationDetail key={`${selectedPr.repo}-${selectedPr.number}`} pr={selectedPr} />
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
