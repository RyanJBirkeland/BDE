import { motion } from 'framer-motion'
import { VARIANTS, SPRINGS, REDUCED_TRANSITION, useReducedMotion } from '../lib/motion'
import { TaskWorkbench } from '../components/task-workbench/TaskWorkbench'
import { ErrorBoundary } from '../components/ui/ErrorBoundary'
import { GitHubOptedOutBanner } from '../components/GitHubOptedOutBanner'

export default function TaskWorkbenchView(): React.JSX.Element {
  const reduced = useReducedMotion()
  return (
    <ErrorBoundary name="TaskWorkbenchView">
      <motion.div
        style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
        variants={VARIANTS.fadeIn}
        initial="initial"
        animate="animate"
        transition={reduced ? REDUCED_TRANSITION : SPRINGS.snappy}
      >
        <GitHubOptedOutBanner />
        <div style={{ flex: 1, minHeight: 0 }}>
          <TaskWorkbench />
        </div>
      </motion.div>
    </ErrorBoundary>
  )
}
