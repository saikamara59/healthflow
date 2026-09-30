import { useState } from 'react'
import { dateInZone } from '../../api/workspaceTime'
import HfTile, { RecordLinks } from '../ui/HfTile'

function dueLabel(task, timeZone, localDate) {
  if (!task.due_at) return null
  const due = new Date(task.due_at)
  const sameDay = dateInZone(due, timeZone) === localDate
  const options = sameDay ? { timeZone, hour: 'numeric', minute: '2-digit' } : { timeZone, weekday: 'short', month: 'short', day: 'numeric' }
  return new Intl.DateTimeFormat(undefined, options).format(due)
}

function TaskRow({ task, onToggle, timeZone, localDate }) {
  const when = dueLabel(task, timeZone, localDate)
  return <li className="workspace-list-row" id={`task-${task.id}`} tabIndex={-1} aria-label={task.title}>
    <input type="checkbox" aria-label={`Complete ${task.title}`} checked={task.status === 'completed'} onChange={() => onToggle(task)} />
    <div className="workspace-row-copy"><strong>{task.title}</strong><RecordLinks record={task} /></div>
    <div className="td-row-meta">
      {task.client_archived && <span className="status-label">Archived client</span>}
      {task.is_follow_up && <span className="workspace-tag">Follow-up</span>}
      {task.priority === 'high' && <span className="chip warn">High</span>}
      {when && <span className={`td-when${task.is_overdue ? ' neg' : ''}`}>{when}</span>}
    </div>
  </li>
}

// One labeled group inside the Tasks card. The heading's grandparent is the group
// itself, so the group (and only its rows) can be located from the heading.
function TaskGroup({ title, tasks, tone, emptyText, children, ...rowProps }) {
  return <div className="td-group">
    <div><h3 className={`workspace-subheading${tone === 'neg' ? ' td-neg' : ''}`}>{title} · {tasks.length}</h3></div>
    {tasks.length
      ? <ul className="workspace-list">{tasks.map((task) => <TaskRow key={task.id} task={task} {...rowProps} />)}</ul>
      : <p className="workspace-empty workspace-small">{emptyText}</p>}
    {children}
  </div>
}

export default function TodayTasks({ searchResult, overdue, dueToday, other, hasMoreOther, revealOther, onToggle, onToggleSearchResult, timeZone, localDate, moreButton }) {
  const [expanded, setExpanded] = useState(false)
  // A search deep link to one of these tasks keeps the group open so the row can be focused.
  const otherOpen = expanded || revealOther
  const rowProps = { timeZone, localDate }
  const otherCount = `${other.length}${hasMoreOther ? '+' : ''}`
  return <section className="card workspace-section" aria-labelledby="today-tasks-heading">
    <div className="between">
      <h2 id="today-tasks-heading" className="ws-h2"><HfTile icon="today" color="cost" />Tasks</h2>
      <span className="workspace-count">{overdue.length + dueToday.length} open today</span>
    </div>
    {searchResult && <TaskGroup title="Search result" tasks={[searchResult]} onToggle={onToggleSearchResult} {...rowProps} />}
    <TaskGroup title="Overdue" tone="neg" tasks={overdue} onToggle={onToggle} emptyText="Nothing overdue." {...rowProps} />
    <TaskGroup title="Due today" tasks={dueToday} onToggle={onToggle} emptyText="No other tasks due today." {...rowProps} />
    {otherOpen && <TaskGroup title="Other open tasks" tasks={other} onToggle={onToggle} emptyText="No other open tasks." {...rowProps}>{moreButton}</TaskGroup>}
    <div className="td-foot">
      <button type="button" className="td-link" aria-expanded={otherOpen} disabled={revealOther} onClick={() => setExpanded(!expanded)}>
        {otherOpen ? 'Hide other open tasks' : `${otherCount} other open task${other.length === 1 && !hasMoreOther ? '' : 's'}`}
      </button>
    </div>
  </section>
}
