import { useEffect, useState } from 'react'
import api from '../api/client'
import TopBar from '../components/TopBar'
import useLayout from '../components/ui/useLayout'
import { workspaceApi } from '../api/workspace'
import { addCalendarDays, dateInZone, localToUtc } from '../api/workspaceTime'
import QuickCreateModal from '../components/workspace/QuickCreateModal'

export default function SchedulingPage() {
  const { openMenu, openNotifications } = useLayout()
  const [appointments, setAppointments] = useState(null)
  const [clients, setClients] = useState([])
  const [organizations, setOrganizations] = useState([])
  const [zone, setZone] = useState(null)
  const [start, setStart] = useState(null)
  const [creating, setCreating] = useState(null)
  const [error, setError] = useState('')
  const refresh = () => workspaceApi.listAppointments(`starts_before=${encodeURIComponent(localToUtc(addCalendarDays(start, 7), '00:00', zone))}`).then(setAppointments)
  useEffect(() => {
    let alive = true
    Promise.all([workspaceApi.getPreferences(), api.get('/clients'), workspaceApi.listOrganizations(true)]).then(([preferences, clientData, orgData]) => {
      if (alive) { setZone(preferences.timezone_name); setStart(dateInZone(new Date(), preferences.timezone_name)); setClients(clientData); setOrganizations(orgData) }
    }).catch(() => { if (alive) setError('Scheduling could not be loaded.') })
    return () => { alive = false }
  }, [])
  useEffect(() => {
    if (!zone || !start) return
    let alive = true
    workspaceApi.listAppointments(`starts_before=${encodeURIComponent(localToUtc(addCalendarDays(start, 7), '00:00', zone))}`).then((items) => {
      if (alive) setAppointments(items)
    }).catch(() => { if (alive) setError('Scheduling could not be loaded.') })
    return () => { alive = false }
  }, [start, zone])
  async function status(item, action) {
    try {
      if (action === 'complete') await workspaceApi.completeAppointment(item.id)
      else await workspaceApi.cancelAppointment(item.id)
      await refresh()
    } catch { setError('Appointment could not be updated.') }
  }
  const days = start ? Array.from({ length: 7 }, (_, index) => addCalendarDays(start, index)) : []
  return <><TopBar crumbs={['Workspace', 'Scheduling']} onMenuClick={openMenu} onNotificationsClick={openNotifications} /><main className="page"><div className="page-head"><div><h1 className="page-title">Scheduling</h1><p className="page-sub">A clear view of the next seven days{zone ? ` · ${zone}` : ''}.</p></div><button className="btn accent" disabled={!start} onClick={() => setCreating({ startDate: start, endDate: start })}>New Appointment</button></div>
    <div className="workspace-agenda-controls"><button className="btn" disabled={!start} onClick={() => setStart(addCalendarDays(start, -7))}>Previous week</button><button className="btn" disabled={!zone} onClick={() => setStart(dateInZone(new Date(), zone))}>Today</button><button className="btn" disabled={!start} onClick={() => setStart(addCalendarDays(start, 7))}>Next week</button></div>
    {error && <p role="alert" className="workspace-error">{error}</p>}{!appointments && !error && <p role="status">Loading appointments…</p>}
    {appointments && <div className="workspace-agenda">{days.map((day) => {
      const dayStart = new Date(localToUtc(day, '00:00', zone))
      const dayEnd = new Date(localToUtc(addCalendarDays(day, 1), '00:00', zone))
      const entries = appointments.filter((item) => item.status === 'scheduled' && new Date(item.starts_at) < dayEnd && new Date(item.ends_at) > dayStart)
      return <section className="card workspace-section" key={day}><div className="between"><h2>{new Date(`${day}T12:00:00Z`).toLocaleDateString(undefined, { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' })}</h2><button className="btn sm ghost" aria-label={`Add appointment on ${day}`} onClick={() => setCreating({ startDate: day, endDate: day })}>+</button></div>
        {entries.length ? <ul className="workspace-list">{entries.map((item) => <li className="workspace-list-row" key={item.id}><div className="workspace-row-copy"><strong>{item.title}</strong><small>{new Intl.DateTimeFormat(undefined, { timeZone: zone, hour: 'numeric', minute: '2-digit' }).format(new Date(item.starts_at))}{item.client_name ? ` · ${item.client_name}` : ''}</small></div><div className="workspace-row-actions"><button className="btn sm ghost" onClick={() => status(item, 'complete')}>Complete</button><button className="btn sm ghost" onClick={() => status(item, 'cancel')}>Cancel</button></div></li>)}</ul> : <p className="workspace-empty">No meetings</p>}
      </section>
    })}</div>}
    {creating && <QuickCreateModal mode="appointment" initialValues={creating} clients={clients} organizations={organizations} timeZone={zone} onClose={() => setCreating(null)} onCreated={async () => { setCreating(null); await refresh() }} />}
  </main></>
}
