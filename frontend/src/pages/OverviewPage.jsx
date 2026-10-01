import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion, MotionConfig } from 'framer-motion'
import { CaretRight, Clock } from '@phosphor-icons/react'
import api from '../api/client'
import { workspaceApi } from '../api/workspace'
import TopBar from '../components/TopBar'
import Avatar from '../components/ui/Avatar'
import HfTile from '../components/ui/HfTile'
import PageHead from '../components/ui/PageHead'
import useLayout from '../components/ui/useLayout'
import { ActivityRow, activityFromTool, activityFromWorkspace } from '../components/workspace/ActivityRow'

const CARDS = [
  { key: 'clients', label: 'Clients', to: '/clients', target: 'Clients', icon: 'clients' },
  { key: 'organizations', label: 'Organizations', to: '/organizations', target: 'Organizations', icon: 'orgs' },
  { key: 'open_tasks', label: 'Open tasks', to: '/follow-ups', target: 'Follow-ups', icon: 'follow' },
  { key: 'overdue_tasks', label: 'Overdue tasks', to: '/today', target: 'Today', icon: 'today', alert: true },
  { key: 'appointments_next_seven_days', label: 'Upcoming appointments', to: '/scheduling', target: 'Scheduling', icon: 'cal' },
  { key: 'active_enrollments', label: 'Active enrollments', to: '/enrollments', target: 'Enrollments', icon: 'enroll' },
  { key: 'open_issues', label: 'Open issues', to: '/issues', target: 'Issues', icon: 'issues' },
]
const EASE = [0.22, 1, 0.36, 1]
const DAY_MS = 86400000

export default function OverviewPage() {
  const { openMenu, openNotifications } = useLayout()
  const [overview, setOverview] = useState(null)
  const [toolHistory, setToolHistory] = useState([])
  const [upcoming, setUpcoming] = useState([])
  const [zone, setZone] = useState(undefined)
  const [error, setError] = useState('')
  const [historyWarning, setHistoryWarning] = useState('')

  useEffect(() => {
    let alive = true
    const now = new Date()
    const week = `ends_after=${encodeURIComponent(now.toISOString())}&starts_before=${encodeURIComponent(new Date(now.getTime() + 7 * DAY_MS).toISOString())}`
    Promise.allSettled([workspaceApi.getOverview(), api.get('/history?limit=8'), workspaceApi.listAppointments(week), workspaceApi.getPreferences()]).then(([summary, history, appointments, preferences]) => {
      if (!alive) return
      if (summary.status === 'rejected') {
        setError('Overview could not be loaded. Try refreshing the page.')
        return
      }
      setOverview(summary.value)
      setToolHistory(history.status === 'fulfilled' && Array.isArray(history.value) ? history.value : [])
      if (history.status === 'rejected') setHistoryWarning('Tool activity could not be loaded. Workspace activity is still available.')
      if (appointments.status === 'fulfilled' && Array.isArray(appointments.value)) {
        setUpcoming(appointments.value
          .filter((item) => item.status === 'scheduled' && new Date(item.starts_at) >= now)
          .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at))
          .slice(0, 4))
      }
      if (preferences.status === 'fulfilled') setZone(preferences.value.timezone_name)
    })
    return () => { alive = false }
  }, [])

  const activity = [
    ...(overview?.recent_activity || []).map(activityFromWorkspace),
    ...toolHistory.map(activityFromTool),
  ].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 8)
  const recentClients = overview?.recent_clients || []
  const workload = overview ? [
    ['Follow-ups', overview.open_follow_ups],
    ['Other tasks', Math.max(0, overview.open_tasks - overview.open_follow_ups)],
    ['Unscheduled', overview.unscheduled_tasks],
  ] : []
  const maxLoad = Math.max(1, ...workload.map(([, count]) => count))
  const when = (iso) => new Intl.DateTimeFormat(undefined, { timeZone: zone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(iso))

  return <MotionConfig reducedMotion="user">
    <TopBar crumbs={['Daily', 'Overview']} onMenuClick={openMenu} onNotificationsClick={openNotifications} />
    <main className="page wide ws-page-in">
      <PageHead
        icon="overview"
        eyebrow="Whole workspace"
        title="Overview"
        sub="A read-only summary of your clients, work, and recent activity. Select a card to open its list."
        actions={<Link to="/today" className="btn accent"><Clock size={15} weight="duotone" /> Go to Today</Link>}
      />
      {error && <p role="alert" className="workspace-error">{error}</p>}
      {historyWarning && <p role="alert" className="workspace-error">{historyWarning}</p>}
      {!overview && !error && <p role="status" className="workspace-empty">Loading Overview…</p>}
      {overview && <>
        <div className="ov-cards">
          {CARDS.map((card, index) => {
            const count = overview[card.key]
            return <motion.div key={card.key} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.32, ease: EASE, delay: index * 0.035 }}>
              <Link to={card.to} className={`card ov-card${card.alert && count ? ' neg' : ''}`}>
                <span className="ov-card-top"><HfTile icon={card.icon} /><small>{card.label}</small></span>
                <strong>{count}</strong>
                <span className="ov-card-go">Open {card.target} <CaretRight size={12} weight="bold" /></span>
              </Link>
            </motion.div>
          })}
        </div>
        <div className="today-grid">
          <div className="today-main">
            <section className="card workspace-section">
              <div className="between"><h2>Recent activity</h2><Link className="td-link" to="/activity">View activity</Link></div>
              {activity.length ? <ul className="workspace-list">{activity.map((item) => <ActivityRow key={item.id} item={item} />)}</ul> : <p className="workspace-empty">No activity yet. Your work will appear here.</p>}
            </section>
            <section className="card workspace-section">
              <div className="between"><h2>Recently updated clients</h2><Link className="td-link" to="/clients">View clients</Link></div>
              {recentClients.length ? <ul className="workspace-list">{recentClients.map((client) => <li className="workspace-list-row" key={client.id}><Avatar name={client.full_name} size="sm" /><div className="workspace-row-copy"><Link to={`/clients/${client.id}`}>{client.full_name}</Link><small>Updated {new Date(client.updated_at || client.created_at).toLocaleDateString()}</small></div></li>)}</ul> : <p className="workspace-empty">No clients yet. <Link to="/clients/new">Add your first client</Link>.</p>}
            </section>
          </div>
          <aside className="today-rail">
            <section className="card workspace-section">
              <h2>Workload</h2>
              {workload.map(([label, count], index) => (
                <div key={label} className="ov-bar">
                  <div className="between"><span>{label}</span><strong className="mono">{count}</strong></div>
                  <div className="ws-bar"><motion.span initial={{ width: 0 }} animate={{ width: `${(count / maxLoad) * 100}%` }} transition={{ duration: 0.7, ease: EASE, delay: 0.15 + index * 0.08 }} /></div>
                </div>
              ))}
              <h3 className="workspace-subheading">Next 7 days</h3>
              {upcoming.length ? <ul className="workspace-list">{upcoming.map((item) => <li key={item.id} className="workspace-list-row"><div className="workspace-row-copy"><Link to={`/scheduling?appointment=${item.id}`}>{item.title}</Link><small>{when(item.starts_at)}{item.client_name ? ` · ${item.client_name}` : ''}</small></div></li>)}</ul> : <p className="workspace-empty">No meetings in the next week.</p>}
            </section>
            <section className="card workspace-section">
              <h2>More views</h2>
              <div className="workspace-tools">
                <Link className="workspace-tool" to="/analytics">Analytics</Link>
                <Link className="workspace-tool" to="/feedback">Feedback</Link>
                <Link className="workspace-tool" to="/leads">Leads</Link>
                <Link className="workspace-tool" to="/plan">Deadline planner</Link>
              </div>
            </section>
          </aside>
        </div>
      </>}
    </main>
  </MotionConfig>
}
