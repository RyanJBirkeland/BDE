import { motion } from 'framer-motion'
import { VARIANTS, SPRINGS, REDUCED_TRANSITION, useReducedMotion } from '../lib/motion'
import { TaskWorkbench } from '../components/task-workbench/TaskWorkbench'

export default function TaskWorkbenchView() {
  const reduced = useReducedMotion()
  return (
    <motion.div
      style={{ height: '100%' }}
      variants={VARIANTS.fadeIn}
      initial="initial"
      animate="animate"
      transition={reduced ? REDUCED_TRANSITION : SPRINGS.snappy}
    >
      <TaskWorkbench />
    </motion.div>
  )
}
