import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import api from '../api/client'
import { workspaceApi } from '../api/workspace'
import TopBar from '../components/TopBar'
import useLayout from '../components/ui/useLayout'
import Avatar from '../components/ui/Avatar'
import QuickTools from '../components/workspace/QuickTools'

const SUMMARY = [
  { key: 'clients', label: 'Clients', href: '/clients' },
  { key: 'organizations', label: 'Organizations', href: '/organizations' },
  { key: 'open_tasks', label: 'Open tasks', href: '/today' },
  { key: 'overdue_tasks', label: 'Overdue tasks', href: '/today' },
  { key: 'appointments_next_seven_days', label: 'Upcoming appointments', href: '/scheduling' },
]

export default function OverviewPage() {
  const { openMenu, openNotifications } = useLayout()
  const [overview, setOverview] = useState(null)
  const [toolHistory, setToolHistory] = useState([])
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    Promise.all([workspaceApi.getOverview(), api.get('/history?limit=8')]).then(([summary, history]) => {
      if (!alive) return
      setOverview(summary)
      setToolHistory(Array.isArray(history) ? history : [])
    }).catch(() => { if (alive) setError('Overview could not be loaded. Try refreshing the page.') })
    return () => { alive = false }
  }, [])

  const activity = [
    ...(overview?.recent_activity || []).map((item) => ({ id: `workspace-${item.id}`, kind: 'Workspace', title: item.summary, date: item.created_at, href: item.client_id ? `/clients/${item.client_id}` : null })),
    ...toolHistory.map((item) => ({ id: `tool-${item.id}`, kind: 'Tool', title: `${item.action_type || 'Action'}${item.client_name ? ` · ${item.client_name}` : ''}`, date: item.created_at, href: item.client_id ? `/clients/${item.client_id}` : '/history' })),
  ].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 10)
  const recentClients = overview?.recent_clients || []

  return <>
    <TopBar crumbs={['Daily', 'Overview']} onMenuClick={openMenu} onNotificationsClick={openNotifications} />
    <main className="page"><div className="page-head"><div><div className="eyebrow">Across your workspace</div><h1 className="page-title">Overview</h1><p className="page-sub">Clients, organizations, open work, and recent activity in one place.</p></div><Link to="/today" className="btn accent">Go to Today</Link></div>
      {error && <p role="alert" className="workspace-error">{error}</p>}
      {!overview && !error && <p role="status">Loading Overview…</p>}
      {overview && <>
        <div className="workspace-summary">{SUMMARY.map((item) => <Link to={item.href} className="card workspace-summary-card" key={item.key}><span>{item.label}</span><strong>{overview[item.key]}</strong></Link>)}</div>
        <div className="today-grid"><div className="today-main">
          <section className="card workspace-section"><div className="between"><h2>Recent activity</h2><Link to="/activity">View activity</Link></div>{activity.length ? <ul className="workspace-list">{activity.map((item) => <li className="workspace-list-row" key={item.id}><span className="workspace-tag">{item.kind}</span><div className="workspace-row-copy">{item.href ? <Link to={item.href}>{item.title}</Link> : <strong>{item.title}</strong>}<small>{new Date(item.date).toLocaleString()}</small></div></li>)}</ul> : <p className="workspace-empty">No activity yet. Your work will appear here.</p>}</section>
          <section className="card workspace-section"><div className="between"><h2>Recently updated clients</h2><Link to="/clients">View clients</Link></div>{recentClients.length ? <ul className="workspace-list">{recentClients.map((client) => <li className="workspace-list-row" key={client.id}><Avatar name={client.full_name} size="sm" /><div className="workspace-row-copy"><Link to={`/clients/${client.id}`}>{client.full_name}</Link><small>Updated {new Date(client.updated_at || client.created_at).toLocaleDateString()}</small></div></li>)}</ul> : <p className="workspace-empty">No clients yet. <Link to="/clients/new">Add your first client</Link>.</p>}</section>
        </div><aside className="today-rail"><QuickTools /><section className="card workspace-section"><h2>More views</h2><div className="workspace-tools"><Link className="workspace-tool" to="/analytics">Analytics</Link><Link className="workspace-tool" to="/feedback">Feedback</Link><Link className="workspace-tool" to="/leads">Leads</Link><Link className="workspace-tool" to="/plan">Deadline planner</Link></div></section></aside></div>
      </>}
    </main>
  </>
}
