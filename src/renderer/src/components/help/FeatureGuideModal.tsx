import { useEffect, useRef, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X } from 'lucide-react'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { VARIANTS, SPRINGS, REDUCED_TRANSITION, useReducedMotion } from '../../lib/motion'
import { FEATURE_GUIDES, FEATURE_GUIDE_ORDER } from '../../lib/feature-guide-data'
import { usePanelLayoutStore } from '../../stores/panelLayout'
import type { View } from '../../stores/panelLayout'
import { Button } from '../ui/Button'
import { Kbd } from '../ui/Kbd'
import './FeatureGuideModal.css'

interface FeatureGuideModalProps {
  open: boolean
  onClose: () => void
}

export function FeatureGuideModal({ open, onClose }: FeatureGuideModalProps): React.JSX.Element {
  const reduced = useReducedMotion()
  const dialogRef = useRef<HTMLDivElement>(null)
  const [selectedView, setSelectedView] = useState<View>('dashboard')
  const setView = usePanelLayoutStore((s) => s.setView)

  useFocusTrap(dialogRef, open)

  // Reset selected view when modal closes
  useEffect(() => {
    if (!open && selectedView !== 'dashboard') {
      // Use setTimeout to avoid setState during render
      const timer = setTimeout(() => setSelectedView('dashboard'), 0)
      return () => clearTimeout(timer)
    }
    return undefined
  }, [open, selectedView])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    },
    [onClose]
  )

  const handleGoToView = useCallback(
    (view: View) => {
      setView(view)
      onClose()
    },
    [setView, onClose]
  )

  const guide = FEATURE_GUIDES[selectedView]
  const Icon = guide.icon

  return (
    <AnimatePresence>
      {open && (
        <>
          <div className="feature-guide__overlay elevation-3-backdrop" onClick={onClose} />
          <motion.div
            ref={dialogRef}
            className="feature-guide glass-modal elevation-3"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={handleKeyDown}
            variants={VARIANTS.scaleIn}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={reduced ? REDUCED_TRANSITION : SPRINGS.snappy}
            role="dialog"
            aria-modal="true"
            aria-label="Feature guide"
          >
            <div className="feature-guide__header">
              <h2 className="feature-guide__title">FLEET Feature Guide</h2>
              <button
                className="feature-guide__close"
                onClick={onClose}
                aria-label="Close"
                type="button"
              >
                <X size={20} />
              </button>
            </div>

            <div className="feature-guide__body">
              <nav className="feature-guide__sidebar" aria-label="View navigation">
                {FEATURE_GUIDE_ORDER.map((view) => {
                  const viewGuide = FEATURE_GUIDES[view]
                  const ViewIcon = viewGuide.icon
                  return (
                    <button
                      key={view}
                      className={`feature-guide__nav-item ${selectedView === view ? 'feature-guide__nav-item--active' : ''}`}
                      onClick={() => setSelectedView(view)}
                      type="button"
                    >
                      <ViewIcon size={16} className="feature-guide__nav-icon" />
                      <span className="feature-guide__nav-label">{viewGuide.label}</span>
                      <span className="feature-guide__nav-shortcut">
                        <Kbd>{viewGuide.shortcut}</Kbd>
                      </span>
                    </button>
                  )
                })}
              </nav>

              <div className="feature-guide__content">
                <div className="feature-guide__content-header">
                  <div className="feature-guide__content-icon">
                    <Icon size={24} />
                  </div>
                  <div>
                    <h3 className="feature-guide__content-title">{guide.label}</h3>
                    <p className="feature-guide__content-description">{guide.description}</p>
                  </div>
                </div>

                <section className="feature-guide__section">
                  <h4 className="feature-guide__section-title">Key Features</h4>
                  <ul className="feature-guide__list">
                    {guide.features.map((feature, idx) => (
                      <li key={idx} className="feature-guide__list-item">
                        {feature}
                      </li>
                    ))}
                  </ul>
                </section>

                <section className="feature-guide__section">
                  <h4 className="feature-guide__section-title">Usage</h4>
                  <p className="feature-guide__usage">{guide.usage}</p>
                </section>

                <div className="feature-guide__actions">
                  <Button variant="primary" onClick={() => handleGoToView(selectedView)}>
                    Go to {guide.label} <Kbd>{guide.shortcut}</Kbd>
                  </Button>
                </div>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
