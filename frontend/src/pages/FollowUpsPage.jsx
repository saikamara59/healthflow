import { useEffect, useState } from 'react'
import TopBar from '../components/TopBar'
import useLayout from '../components/ui/useLayout'
import { workspaceApi } from '../api/workspace'

export default function FollowUpsPage() {
  const { openMenu, openNotifications } = useLayout()
  const [tasks, setTasks] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let alive = true
    workspaceApi.listTasks('is_follow_up=true&status=open').then((data) => { if (alive) setTasks(data) }).catch(() => { if (alive) setError('Follow-ups could not be loaded.') })
    return () => { alive = false }
  }, [])
  return <><TopBar crumbs={['Workspace', 'Follow-ups']} onMenuClick={openMenu} onNotificationsClick={openNotifications} /><main className="page"><div className="page-head"><div><h1 className="page-title">Follow-ups</h1><p className="page-sub">Promises and next steps to keep moving.</p></div></div>{error && <p role="alert">{error}</p>}{!tasks && !error && <p role="status">Loading follow-ups…</p>}{tasks && <section className="card workspace-section">{tasks.length ? <ul>{tasks.map((task) => <li key={task.id}>{task.title}</li>)}</ul> : <p>No open follow-ups.</p>}</section>}</main></>
}
