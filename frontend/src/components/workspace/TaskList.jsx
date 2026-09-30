import { AnimatePresence, motion } from 'framer-motion'
import { RecordLinks } from '../ui/HfTile'

const EASE = [0.22, 1, 0.36, 1]

function dueLabel(dueAt, timeZone) {
  const due = new Date(dueAt)
  const dayKey = (date) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
  const time = new Intl.DateTimeFormat(undefined, { timeZone, hour: 'numeric', minute: '2-digit' }).format(due)
  if (dayKey(due) === dayKey(new Date())) return time
  const day = new Intl.DateTimeFormat(undefined, { timeZone, weekday: 'short', month: 'short', day: 'numeric' }).format(due)
  return `${day} · ${time}`
}

// A titled group of tasks; checking one completes it and animates it out.
export default function TaskList({ title, tasks, onToggle, timeZone, emptyText = 'Nothing here right now.', tone }) {
  const now = new Date()
  return <section className="card workspace-section ws-tasks">
    <div className="between"><h2 className={tone === 'neg' && tasks.length ? 'td-neg' : ''}>{title}</h2><span className="workspace-count">{tasks.length}</span></div>
    {tasks.length ? <ul className="workspace-list">
      <AnimatePresence initial={false}>
        {tasks.map((task) => {
          const overdue = task.due_at && new Date(task.due_at) < now
          return <motion.li
            className="workspace-list-row"
            id={`task-${task.id}`}
            tabIndex={-1}
            key={task.id}
            aria-label={task.title}
            layout="position"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, x: 24, transition: { duration: 0.22 } }}
            transition={{ duration: 0.28, ease: EASE }}
          >
            <input type="checkbox" aria-label={`Complete ${task.title}`} checked={task.status === 'completed'} onChange={() => onToggle(task)} />
            <div className="workspace-row-copy"><strong>{task.title}</strong><RecordLinks record={task} /></div>
            {task.client_archived && <span className="status-label">Archived client</span>}
            {task.due_at && <span className={`td-when${overdue ? ' neg' : ''}`}>{dueLabel(task.due_at, timeZone)}</span>}
          </motion.li>
        })}
      </AnimatePresence>
    </ul> : <p className="workspace-empty">{emptyText}</p>}
  </section>
}
