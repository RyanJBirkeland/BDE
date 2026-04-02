import { motion } from 'framer-motion'
import { VARIANTS, SPRINGS, REDUCED_TRANSITION, useReducedMotion } from '../lib/motion'
import { SprintPipeline } from '../components/sprint/SprintPipeline'

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
      <SprintPipeline />
    </motion.div>
  )
}
