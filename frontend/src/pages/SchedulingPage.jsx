import { useEffect, useState } from 'react'
import TopBar from '../components/TopBar'
import useLayout from '../components/ui/useLayout'
import { workspaceApi } from '../api/workspace'

export default function SchedulingPage() {
  const { openMenu, openNotifications } = useLayout()
  const [appointments, setAppointments] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let alive = true
    workspaceApi.listAppointments().then((data) => { if (alive) setAppointments(data) }).catch(() => { if (alive) setError('Scheduling could not be loaded.') })
    return () => { alive = false }
  }, [])
  return <><TopBar crumbs={['Workspace', 'Scheduling']} onMenuClick={openMenu} onNotificationsClick={openNotifications} /><main className="page"><div className="page-head"><div><h1 className="page-title">Scheduling</h1><p className="page-sub">Your meetings and upcoming appointments.</p></div></div>{error && <p role="alert">{error}</p>}{!appointments && !error && <p role="status">Loading appointments…</p>}{appointments && <section className="card workspace-section">{appointments.length ? <ul>{appointments.map((item) => <li key={item.id}>{item.title}</li>)}</ul> : <p>No appointments scheduled.</p>}</section>}</main></>
}
