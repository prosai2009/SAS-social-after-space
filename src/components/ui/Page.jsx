import { motion } from 'framer-motion'

// Shared page transition — fast crossfade, no blur (blur over the animated
// city backdrop caused visible repaint stutter).
export default function Page({ className = '', children }) {
  return (
    <motion.div
      className={`page-inner ${className}`}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.16, ease: 'easeOut' }}
    >
      {children}
    </motion.div>
  )
}
