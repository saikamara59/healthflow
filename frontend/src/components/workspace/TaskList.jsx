export default function TaskList({ title, tasks, onToggle, emptyText = 'Nothing here right now.' }) {
  return <section className="card workspace-section">
    <div className="between"><h2>{title}</h2><span className="workspace-count">{tasks.length}</span></div>
    {tasks.length ? <ul className="workspace-list">{tasks.map((task) => <li className="workspace-list-row" key={task.id} aria-label={task.title}>
      <input type="checkbox" aria-label={`Complete ${task.title}`} checked={task.status === 'completed'} onChange={() => onToggle(task)} />
      <div className="workspace-row-copy"><strong>{task.title}</strong><small>{[task.client_name, task.organization_name, task.due_at && new Date(task.due_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })].filter(Boolean).join(' · ')}</small></div>
      {task.is_follow_up && <span className="workspace-tag">Follow-up</span>}
    </li>)}</ul> : <p className="workspace-empty">{emptyText}</p>}
  </section>
}
