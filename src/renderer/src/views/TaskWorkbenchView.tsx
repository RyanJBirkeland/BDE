import { motion } from 'framer-motion'
import { VARIANTS, SPRINGS, REDUCED_TRANSITION, useReducedMotion } from '../lib/motion'
import { TaskWorkbench } from '../components/task-workbench/TaskWorkbench'
import { ErrorBoundary } from '../components/ui/ErrorBoundary'

export default function TaskWorkbenchView(): React.JSX.Element {
  const reduced = useReducedMotion()
  return (
    <ErrorBoundary name="TaskWorkbenchView">
      <motion.div
        style={{ height: '100%' }}
        variants={VARIANTS.fadeIn}
        initial="initial"
        animate="animate"
        transition={reduced ? REDUCED_TRANSITION : SPRINGS.snappy}
      >
        <TaskWorkbench />
      </motion.div>
    </ErrorBoundary>
  )
}
