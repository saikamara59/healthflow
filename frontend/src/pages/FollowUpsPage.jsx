import { useEffect, useState } from 'react'
import api from '../api/client'
import TopBar from '../components/TopBar'
import useLayout from '../components/ui/useLayout'
import { workspaceApi } from '../api/workspace'
import TaskList from '../components/workspace/TaskList'
import QuickCreateModal from '../components/workspace/QuickCreateModal'

export default function FollowUpsPage() {
  const { openMenu, openNotifications } = useLayout()
  const [tasks, setTasks] = useState(null)
  const [clients, setClients] = useState([])
  const [organizations, setOrganizations] = useState([])
  const [zone, setZone] = useState('UTC')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const refresh = () => workspaceApi.listTasks('is_follow_up=true&status=open').then(setTasks)
  useEffect(() => {
    let alive = true
    Promise.all([workspaceApi.listTasks('is_follow_up=true&status=open'), api.get('/clients'), workspaceApi.listOrganizations(true), workspaceApi.getPreferences()]).then(([items, clientData, orgData, preferences]) => {
      if (!alive) return
      setTasks(items); setClients(clientData); setOrganizations(orgData); setZone(preferences.timezone_name)
    }).catch(() => { if (alive) setError('Follow-ups could not be loaded.') })
    return () => { alive = false }
  }, [])
  async function complete(task) {
    try { await workspaceApi.completeTask(task.id); await refresh() } catch { setError('Follow-up could not be completed.') }
  }
  const now = new Date()
  const dateKey = (date) => new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
  const todayKey = dateKey(now)
  const groups = { overdue: [], today: [], upcoming: [], unscheduled: [] }
  for (const task of tasks || []) {
    if (!task.due_at) groups.unscheduled.push(task)
    else if (new Date(task.due_at) < now) groups.overdue.push(task)
    else if (dateKey(new Date(task.due_at)) === todayKey) groups.today.push(task)
    else groups.upcoming.push(task)
  }
  return <><TopBar crumbs={['Workspace', 'Follow-ups']} onMenuClick={openMenu} onNotificationsClick={openNotifications} /><main className="page"><div className="page-head"><div><h1 className="page-title">Follow-ups</h1><p className="page-sub">Promises and next steps to keep moving.</p></div><button className="btn accent" onClick={() => setCreating(true)}>New Follow-up</button></div>
    {error && <p role="alert" className="workspace-error">{error}</p>}{!tasks && !error && <p role="status">Loading follow-ups…</p>}
    {tasks && <div className="workspace-stack"><TaskList title="Overdue" tasks={groups.overdue} onToggle={complete} timeZone={zone} /><TaskList title="Today" tasks={groups.today} onToggle={complete} timeZone={zone} /><TaskList title="Upcoming" tasks={groups.upcoming} onToggle={complete} timeZone={zone} /><TaskList title="Unscheduled" tasks={groups.unscheduled} onToggle={complete} timeZone={zone} /></div>}
    {creating && <QuickCreateModal mode="task" initialValues={{ is_follow_up: true }} clients={clients} organizations={organizations} timeZone={zone} onClose={() => setCreating(false)} onCreated={async () => { setCreating(false); await refresh() }} />}
  </main></>
}
