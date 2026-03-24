/**
 * SprintView — Scrum Planning Center with Kanban board, spec drawer, and PR list.
 * Replaces the old read-only SprintBoard + PRList split layout.
 */
import { motion } from 'framer-motion'
import { VARIANTS, SPRINGS, REDUCED_TRANSITION, useReducedMotion } from '../lib/motion'
import { SprintCenter } from '../components/sprint/SprintCenter'

export default function SprintView() {
  const reduced = useReducedMotion()
  return (
    <motion.div
      style={{ height: '100%' }}
      variants={VARIANTS.fadeIn}
      initial="initial"
      animate="animate"
      transition={reduced ? REDUCED_TRANSITION : SPRINGS.snappy}
    >
      <SprintCenter />
    </motion.div>
  )
}
