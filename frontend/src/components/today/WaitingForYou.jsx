import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { workspaceApi } from '../../api/workspace'
import HfTile from '../ui/HfTile'
import { PlanLogo } from '../ui/OrgLogo'

const SHOWN = 3

function formatDeadline(date) {
  return new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', month: 'short', day: 'numeric' }).format(new Date(`${date}T12:00:00Z`))
}

// Items that need the broker's action: enrollments ready to record as submitted,
// and open Issues with a deadline (soonest first).
async function loadWaiting() {
  const [ready, open, inProgress] = await Promise.all([
    workspaceApi.listEnrollments('status=ready_to_submit'),
    workspaceApi.listIssues('status=open'),
    workspaceApi.listIssues('status=in_progress'),
  ])
  const enrollments = ready.map((item) => ({
    key: `enrollment-${item.id}`, icon: 'enroll', plan: item.plan_name, to: '/enrollments',
    title: `Record ${item.plan_name} enrollment as submitted`, detail: item.client_name,
  }))
  const issues = [...open, ...inProgress].filter((item) => item.deadline).sort((a, b) => a.deadline.localeCompare(b.deadline)).map((item) => ({
    key: `issue-${item.id}`, icon: 'appeal', to: '/issues',
    title: item.title, detail: `${item.client_name} · ${formatDeadline(item.deadline)} deadline`,
  }))
  return [...enrollments, ...issues]
}

export default function WaitingForYou() {
  const [items, setItems] = useState(null)
  useEffect(() => {
    let alive = true
    loadWaiting().then((rows) => { if (alive) setItems(rows) }).catch(() => { if (alive) setItems([]) })
    return () => { alive = false }
  }, [])

  return <section className="card workspace-section" aria-labelledby="today-waiting-heading">
    <div className="between">
      <h2 id="today-waiting-heading" className="ws-h2"><HfTile icon="approve" />Waiting for you</h2>
      {items?.length > 0 && <Link className="td-link" to="/approvals">All {items.length}</Link>}
    </div>
    {items === null && <p className="workspace-empty workspace-small" role="status">Loading…</p>}
    {items?.length === 0 && <p className="workspace-empty workspace-small">Nothing needs your sign-off.</p>}
    {items?.length > 0 && <ul className="workspace-list">{items.slice(0, SHOWN).map((item) => <li className="workspace-list-row td-wait" key={item.key}>
      {item.plan ? <PlanLogo planName={item.plan} size={26} /> : <HfTile icon={item.icon} />}
      <div className="workspace-row-copy"><strong>{item.title}</strong><small>{item.detail}</small></div>
      <Link className="btn sm" to={item.to} aria-label={`Review ${item.title}`}>Review</Link>
    </li>)}</ul>}
  </section>
}
