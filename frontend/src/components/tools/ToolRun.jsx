import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Bank, BookOpenText, Check, Database, FileText, IdentificationCard, Pill, Scales, Sparkle, User } from '@phosphor-icons/react'

// How long each step shows before the next one starts while a request is in
// flight. Purely a pacing choice: the last step never completes until the
// server answers, so the panel cannot claim work finished that has not.
const STEP_MS = 650

function StepIcon({ state }) {
  if (state === 'done') return <span className="fl-ic done" aria-hidden="true"><Check size={11} weight="bold" /></span>
  if (state === 'now') return <span className="fl-ic now" aria-hidden="true"><i /></span>
  return <span className="fl-ic" aria-hidden="true" />
}

/**
 * Step-by-step progress for a tool request. `steps` are [label, detail] pairs
 * describing what the endpoint actually does. Steps advance on a timer while
 * `running`, holding on the final step until `running` turns false.
 */
export function RunSteps({ steps, running, title = 'Working on it' }) {
  const [index, setIndex] = useState(0)
  useEffect(() => {
    if (!running) return undefined
    setIndex(0)
    const timer = setInterval(() => setIndex((value) => Math.min(value + 1, steps.length - 1)), STEP_MS)
    return () => clearInterval(timer)
  }, [running, steps.length])
  const current = running ? index : steps.length
  return (
    <div className="card workspace-section fl-run" role="status" aria-live="polite">
      <div className="between"><h2>{title}</h2><span className="workspace-small">{Math.min(current, steps.length)} of {steps.length} steps</span></div>
      <ol className="fl-steps">
        {steps.map(([label, detail], position) => {
          const state = position < current ? 'done' : position === current ? 'now' : 'wait'
          return (
            <li key={label} className={`fl-step ${state}`}>
              <StepIcon state={state} />
              <div><strong>{label}</strong>{detail && <small>{detail}</small>}</div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function sourceIcon(label) {
  const text = label.toLowerCase()
  if (text.includes('nppes') || text.includes('npi')) return IdentificationCard
  if (text.includes('rxnav') || text.includes('formular') || text.includes('drug')) return Pill
  if (text.includes('guidance') || text.includes('lcd')) return Scales
  if (text.includes('cms') || text.includes('medicare')) return Bank
  if (text.includes('benefit') || text.includes('document')) return BookOpenText
  if (text.includes('denial')) return FileText
  if (text.includes('claude') || text.includes('ai ')) return Sparkle
  if (text.includes('client') || text.includes('you')) return User
  return Database
}

export function SourceChip({ label, detail }) {
  const Glyph = sourceIcon(label)
  return (
    <span className="src-chip" title={detail ? `${label} · ${detail}` : label}>
      <Glyph size={14} weight="duotone" aria-hidden="true" />
      <b>{label}</b>{detail && <small>{detail}</small>}
    </span>
  )
}

export function SourceRow({ items, lead = 'Sources' }) {
  return <div className="src-row"><span className="src-lead">{lead}</span>{items.map(([label, detail]) => <SourceChip key={label} label={label} detail={detail} />)}</div>
}

// Fades results in once the run finishes.
export function ToolResults({ show, children }) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1] }}>
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** One-line progress for a chat answer: the current step and "n of m". */
export function RunStepsCompact({ steps }) {
  const [index, setIndex] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setIndex((value) => Math.min(value + 1, steps.length - 1)), STEP_MS)
    return () => clearInterval(timer)
  }, [steps.length])
  return (
    <div className="fl-compact" role="status" aria-live="polite">
      <StepIcon state="now" />
      <span>{steps[index][0]}</span>
      <small>{index + 1} of {steps.length}</small>
    </div>
  )
}
