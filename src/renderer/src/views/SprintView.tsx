import { motion } from 'framer-motion'
import { VARIANTS, SPRINGS, REDUCED_TRANSITION, useReducedMotion } from '../lib/motion'
import { SprintPipeline } from '../components/sprint/SprintPipeline'
import { ErrorBoundary } from '../components/ui/ErrorBoundary'

export default function SprintView(): React.JSX.Element {
  const reduced = useReducedMotion()
  return (
    <ErrorBoundary name="SprintView">
      <motion.div
        style={{ height: '100%' }}
        variants={VARIANTS.fadeIn}
        initial="initial"
        animate="animate"
        transition={reduced ? REDUCED_TRANSITION : SPRINGS.snappy}
      >
        <SprintPipeline />
      </motion.div>
    </ErrorBoundary>
  )
}
